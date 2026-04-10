const { v4: uuidv4 } = require('uuid');
const { runAgent } = require('../services/pythonAgentBridge');
const workflowEngine = require('./workflowEngine');
const { runHealthCheck } = require('./healthChecker');
const { executeAction } = require('../services/actionExecutor');
const AlertModel = require('../models/Alert');
const IncidentModel = require('../models/Incident');
const ReportModel = require('../models/Report');
const logger = require('../services/logger');
const { setActivity } = require('../services/agentActivityStore');
const env = require('../config/env');

/** LLM action name → workflow rule action in workflows.csv (when they differ). */
const DEV_ACTION_ALIASES = {
  cleanup_disk_space: 'cleanup_logs',
  restart_api_service: 'switch_to_fallback',
};

function decisionMatchesWorkflowRule(decisionAction, ruleAction) {
  if (!decisionAction || !ruleAction) return false;
  if (decisionAction === ruleAction) return true;
  return DEV_ACTION_ALIASES[decisionAction] === ruleAction;
}

/**
 * When the LLM omits fields, align with the matched workflow rule so action_taken and stages stay consistent.
 */
function mergeDecisionFromWorkflowRule(decision, matchedRule) {
  if (!matchedRule?.action) return decision;
  const base =
    decision && typeof decision === 'object' ? { ...decision } : {};
  delete base.error;
  delete base.message;

  if (base.action == null || base.action === '') {
    base.action = matchedRule.action;
  }
  if (base.priority == null && matchedRule.priority != null) {
    base.priority = matchedRule.priority;
  }

  if (matchedRule.action === 'escalate_to_human') {
    return {
      ...base,
      action: 'escalate_to_human',
      escalate: true,
      safe_to_execute: false,
      escalation_reason:
        base.escalation_reason || 'No automated workflow action; escalate to human.',
    };
  }

  if (base.safe_to_execute == null) base.safe_to_execute = false;
  if (base.escalate == null) base.escalate = false;

  return base;
}

/**
 * In development, if the LLM marked an action as unsafe but it matches the
 * workflow-rule action (which we trust for demo purposes), override safe_to_execute
 * so the pipeline actually executes the action and can reach "resolved".
 * Set DEV_AUTO_APPROVE_WORKFLOW_ACTIONS=false in .env to disable.
 */
function devApproveIfWorkflowMatch(decision, matchedRule) {
  if (!env.pipeline.devAutoApproveWorkflowActions) return decision;
  if (decision.safe_to_execute) return decision;
  if (!matchedRule || !matchedRule.action) return decision;
  if (matchedRule.action === 'escalate_to_human') return decision;
  if (decision.escalate) return decision;
  if (!decisionMatchesWorkflowRule(decision.action, matchedRule.action)) return decision;
  logger.info(`[Pipeline][dev] Auto-approving workflow-aligned action: ${decision.action} (rule: ${matchedRule.action})`);
  return {
    ...decision,
    safe_to_execute: true,
    escalate: false,
    escalation_reason: undefined,
  };
}

function ensureResolutionStatus(resolution, healthResult, executionResult) {
  if (resolution && resolution.status && !resolution.error) return resolution;
  const actionOk = Boolean(executionResult?.success);
  const healthOk = Boolean(healthResult?.health_check_passed);
  if (actionOk && healthOk) {
    return {
      ...resolution,
      status: 'resolved',
      resolution_summary:
        resolution?.resolution_summary || 'Post-remediation health check passed.',
    };
  }
  return {
    ...resolution,
    status: 'escalated',
    resolution_summary:
      resolution?.resolution_summary ||
      'Remediation incomplete, action skipped, or health check did not pass.',
  };
}

const activeIncidents = new Map();

async function processAlert(rawAlert, io) {
  const pipelineStart = Date.now();
  const timeline = [];

  function addTimelineEvent(event) {
    const entry = { timestamp: new Date().toISOString(), event };
    timeline.push(entry);
    logger.info(`[Pipeline] ${event}`);
  }

  try {
    // ── Stage 1: Detection ──
    addTimelineEvent('Alert received, starting detection');
    setActivity({ agent: 'detection', status: 'running' });
    if (io) io.emit('agent:activity', { agent: 'detection', status: 'running' });
    const detection = runAgent('detection', rawAlert);

    if (detection.error || !detection.valid) {
      addTimelineEvent(`Detection failed or invalid alert: ${detection.message || 'invalid schema'}`);
      setActivity({ agent: 'detection', status: 'error', message: detection.message || 'invalid alert' });
      if (io) io.emit('agent:activity', { agent: 'detection', status: 'error' });
      // Still mark the CSV row processed so it doesn't replay forever
      if (rawAlert.alert_id) await AlertModel.markProcessed(rawAlert.alert_id).catch(() => {});
      return { success: false, reason: 'invalid_alert', detection };
    }

    // Always use the original CSV alert_id as the canonical key so the polling job's
    // dedup check (findByAlertId + processed flag) works correctly across restarts.
    const alertId = rawAlert.alert_id || detection.alert_id || `ALT-${Date.now()}`;
    addTimelineEvent(`Alert classified: ${detection.alert_type} (${detection.severity}), confidence: ${detection.confidence}`);

    if (detection.is_duplicate) {
      addTimelineEvent('Duplicate alert suppressed');
      return { success: false, reason: 'duplicate', detection };
    }

    const mttdSec = Math.round((Date.now() - pipelineStart) / 1000);

    // ── Stage 2: Alert (create incident) ──
    const incidentId = `INC-${uuidv4().split('-')[0].toUpperCase()}`;
    addTimelineEvent(`Incident created: ${incidentId}`);

    // Ensure the alert exists before inserting incident (prevents FK violations on incidents.alert_id)
    await AlertModel.upsertByAlertId({
      alert_id: alertId,
      alert_type: detection.alert_type || rawAlert.alert_type,
      severity: detection.severity || rawAlert.severity || 'medium',
      service: detection.service || rawAlert.service,
      host: rawAlert.host || detection.host || 'unknown',
      metric_value: rawAlert.metric_value ?? null,
      threshold: rawAlert.threshold ?? null,
      timestamp: rawAlert.timestamp ? new Date(rawAlert.timestamp).toISOString() : new Date().toISOString(),
      processed: false,
    });

    const incident = await IncidentModel.create({
      incident_id: incidentId,
      alert_id: alertId,
      alert_type: detection.alert_type,
      service: detection.service,
      severity: detection.severity,
      status: 'in_progress',
      started_at: new Date().toISOString(),
      retry_count: 0,
      escalated: false,
      agent_outputs: { detection },
    });

    await AlertModel.markProcessed(alertId);

    if (io) {
      io.emit('incident:created', incident);
      setActivity({ agent: 'detection', incident_id: incidentId, status: 'completed' });
      io.emit('agent:activity', { agent: 'detection', incident_id: incidentId, status: 'completed' });
    }

    // ── Stage 3: Decision ──
    addTimelineEvent('Starting decision phase');
    setActivity({ agent: 'decision', incident_id: incidentId, status: 'running' });
    if (io) io.emit('agent:activity', { agent: 'decision', incident_id: incidentId, status: 'running' });
    const workflowRules = await workflowEngine.getRules();
    const recentIncidents = await IncidentModel.findRecentByService(detection.service);

    let decision = runAgent('decision', {
      alert: detection,
      workflowRules,
      currentRetryCount: 0,
      recentIncidents,
    });

    // Look up the matched rule now (needed for dev approval + resolution)
    const matchedRule = await workflowEngine.matchRule(detection.alert_type);

    decision = mergeDecisionFromWorkflowRule(decision, matchedRule);
    // In development, allow the matched workflow action to run so incidents can resolve
    decision = devApproveIfWorkflowMatch(decision, matchedRule);

    addTimelineEvent(`Decision: action=${decision.action}, safe=${decision.safe_to_execute}, priority=${decision.priority}`);

    await IncidentModel.update(incidentId, {
      status: 'in_progress',
      agent_outputs: { ...incident.agent_outputs, detection, decision },
    });

    if (io) {
      io.emit('incident:updated', { incident_id: incidentId, status: 'in_progress', decision });
      setActivity({ agent: 'decision', incident_id: incidentId, status: 'completed' });
      io.emit('agent:activity', { agent: 'decision', incident_id: incidentId, status: 'completed' });
    }

    // ── Stage 4: Action ──
    let actionResult = null;
    let executionResult = null;

    if (decision.safe_to_execute && !decision.escalate) {
      addTimelineEvent(`Executing action: ${decision.action}`);

      setActivity({ agent: 'action', incident_id: incidentId, status: 'running' });
      if (io) io.emit('agent:activity', { agent: 'action', incident_id: incidentId, status: 'running' });
      const actionPlan = runAgent('action', { decision, alert: detection });
      addTimelineEvent(`Action plan: ${actionPlan.execution_command || decision.action}`);

      executionResult = await executeAction(
        decision.action,
        detection.service,
        actionPlan.execution_command
      );

      actionResult = { ...actionPlan, ...executionResult };
      addTimelineEvent(
        `Action result: ${executionResult.success ? 'SUCCESS' : 'FAILED'} (${executionResult.duration_ms}ms)`
      );

      if (io) {
        setActivity({ agent: 'action', incident_id: incidentId, status: 'completed', result: executionResult });
        io.emit('agent:activity', {
          agent: 'action',
          incident_id: incidentId,
          status: 'completed',
          result: executionResult,
        });
      }
    } else {
      addTimelineEvent(`Action skipped: ${decision.escalation_reason || 'not safe to execute'}`);
      actionResult = { executed: false, success: false, output_log: 'Action skipped — escalation required' };
      setActivity({ agent: 'action', incident_id: incidentId, status: 'completed', result: { skipped: true } });
      if (io) io.emit('agent:activity', { agent: 'action', incident_id: incidentId, status: 'completed' });
    }

    // ── Stage 5: Resolution ──
    addTimelineEvent('Starting resolution verification');
    setActivity({ agent: 'resolution', incident_id: incidentId, status: 'running' });
    if (io) io.emit('agent:activity', { agent: 'resolution', incident_id: incidentId, status: 'running' });

    const healthResult = await runHealthCheck(
      { ...rawAlert, ...detection },
      executionResult?.success ?? false
    );

    let resolution = runAgent('resolution', {
      incidentId,
      actionResult: executionResult || actionResult,
      postActionHealth: healthResult,
      retryCount: 0,
      maxRetries: matchedRule.max_retries,
    });

    resolution = ensureResolutionStatus(resolution, healthResult, executionResult);

    addTimelineEvent(`Resolution: ${resolution.status} — ${resolution.resolution_summary || ''}`);

    if (io) {
      setActivity({ agent: 'resolution', incident_id: incidentId, status: 'completed', result: resolution });
      io.emit('agent:activity', {
        agent: 'resolution',
        incident_id: incidentId,
        status: 'completed',
        result: resolution,
      });
    }

    // Handle retry/escalation
    if (resolution.status === 'retry') {
      return await handleRetry(incidentId, rawAlert, detection, decision, matchedRule, 1, timeline, io);
    }

    if (resolution.status === 'escalated' || decision.escalate) {
      addTimelineEvent('Triggering escalation');
      setActivity({ agent: 'escalation', incident_id: incidentId, status: 'running' });
      if (io) io.emit('agent:activity', { agent: 'escalation', incident_id: incidentId, status: 'running' });
      const escalation = runAgent('escalation', {
        incidentId,
        alert: detection,
        failedActions: [decision.action],
        retryCount: 0,
        severity: detection.severity,
        service: detection.service,
        reason: resolution.resolution_summary || 'Automated remediation failed',
      });

      await IncidentModel.update(incidentId, {
        status: 'escalated',
        escalated: true,
        action_taken: decision.action,
        agent_outputs: { detection, decision, action: actionResult, resolution, escalation },
      });

      addTimelineEvent(`Escalated: ${escalation.escalation_priority} via ${(escalation.notification_channels || []).join(', ')}`);

      if (io) {
        io.emit('incident:updated', { incident_id: incidentId, status: 'escalated' });
        setActivity({ agent: 'escalation', incident_id: incidentId, status: 'completed' });
        io.emit('agent:activity', { agent: 'escalation', incident_id: incidentId, status: 'completed' });
      }
    } else {
      const mttrSec = Math.round((Date.now() - pipelineStart) / 1000);
      let escalationHandoff = null;
      if (decision.action === 'notify_admin') {
        addTimelineEvent('Escalation agent: operator notification (notify_admin workflow)');
        setActivity({ agent: 'escalation', incident_id: incidentId, status: 'running' });
        if (io) io.emit('agent:activity', { agent: 'escalation', incident_id: incidentId, status: 'running' });
        escalationHandoff = runAgent('escalation', {
          incidentId,
          alert: detection,
          failedActions: [decision.action],
          retryCount: 0,
          severity: detection.severity,
          service: detection.service,
          reason:
            resolution.resolution_summary ||
            'Workflow requires operator notification; automated remediation completed.',
        });
        addTimelineEvent(
          `Escalation handoff: ${escalationHandoff.escalation_priority || 'standard'} via ${(escalationHandoff.notification_channels || []).join(', ') || 'configured channels'}`
        );
        if (io) {
          setActivity({ agent: 'escalation', incident_id: incidentId, status: 'completed' });
          io.emit('agent:activity', { agent: 'escalation', incident_id: incidentId, status: 'completed' });
        }
      }

      const resolvedOutputs = escalationHandoff
        ? { detection, decision, action: actionResult, resolution, escalation: escalationHandoff }
        : { detection, decision, action: actionResult, resolution };

      await IncidentModel.update(incidentId, {
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        action_taken: decision.action,
        mttd_sec: mttdSec,
        mttr_sec: mttrSec,
        agent_outputs: resolvedOutputs,
      });

      if (io) {
        io.emit('incident:updated', { incident_id: incidentId, status: 'resolved', mttr_sec: mttrSec });
      }
    }

    // ── Stage 6: Reporting ──
    addTimelineEvent('Generating incident report');
    const mttrSec = Math.round((Date.now() - pipelineStart) / 1000);

    setActivity({ agent: 'reporting', incident_id: incidentId, status: 'running' });
    if (io) io.emit('agent:activity', { agent: 'reporting', incident_id: incidentId, status: 'running' });
    const report = runAgent('reporting', {
      incidentId,
      alert: rawAlert,
      detection,
      decision,
      action: actionResult,
      resolution,
      timeline,
      mttdSec,
      mttrSec,
    });

    if (!report.error) {
      await ReportModel.upsertByIncidentId(incidentId, {
        incident_id: incidentId,
        title: report.title || `Incident ${incidentId}`,
        summary: report.summary,
        timeline: report.timeline || timeline,
        root_cause: report.root_cause,
        action_taken: report.action_taken,
        resolution: report.resolution,
        metrics: report.metrics,
        recommendations: report.recommendations,
      });

      await IncidentModel.update(incidentId, { report_url: `/api/reports/${incidentId}` });
      addTimelineEvent('Report generated and saved');
    }

    if (io) {
      setActivity({ agent: 'reporting', incident_id: incidentId, status: 'completed' });
      io.emit('agent:activity', { agent: 'reporting', incident_id: incidentId, status: 'completed' });
      io.emit('incident:report_ready', { incident_id: incidentId });
    }

    logger.info(`[Pipeline] Incident ${incidentId} fully processed in ${Date.now() - pipelineStart}ms`);

    return {
      success: true,
      incident_id: incidentId,
      status: resolution.status === 'escalated' || decision.escalate ? 'escalated' : 'resolved',
      duration_ms: Date.now() - pipelineStart,
    };
  } catch (err) {
    logger.error(`[Pipeline] Fatal error: ${err.message}`);
    setActivity({ agent: 'detection', status: 'error', message: err.message });
    if (io) io.emit('agent:activity', { agent: 'detection', status: 'error' });
    return { success: false, reason: 'pipeline_error', error: err.message };
  }
}

async function handleRetry(incidentId, rawAlert, detection, prevDecision, matchedRule, retryCount, timeline, io) {
  const addTimelineEvent = (event) => {
    timeline.push({ timestamp: new Date().toISOString(), event });
    logger.info(`[Pipeline:Retry] ${event}`);
  };

  if (retryCount >= matchedRule.max_retries) {
    addTimelineEvent(`Max retries (${matchedRule.max_retries}) reached, escalating`);
    const escalation = runAgent('escalation', {
      incidentId,
      alert: detection,
      failedActions: [prevDecision.action],
      retryCount,
      severity: detection.severity,
      service: detection.service,
      reason: `Action failed after ${retryCount} retries`,
    });

    await IncidentModel.update(incidentId, {
      status: 'escalated',
      escalated: true,
      retry_count: retryCount,
      agent_outputs: { detection, escalation },
    });

    if (io) io.emit('incident:updated', { incident_id: incidentId, status: 'escalated' });
    return { success: false, incident_id: incidentId, status: 'escalated', retry_count: retryCount };
  }

  addTimelineEvent(`Retry ${retryCount}/${matchedRule.max_retries}`);

  await IncidentModel.update(incidentId, { retry_count: retryCount });

  const workflowRules = await workflowEngine.getRules();
  let decision = runAgent('decision', {
    alert: detection,
    workflowRules,
    currentRetryCount: retryCount,
    recentIncidents: [],
  });

  decision = mergeDecisionFromWorkflowRule(decision, matchedRule);
  decision = devApproveIfWorkflowMatch(decision, matchedRule);

  if (decision.escalate) {
    addTimelineEvent('Decision agent recommends escalation on retry');
    await IncidentModel.update(incidentId, { status: 'escalated', escalated: true });
    if (io) io.emit('incident:updated', { incident_id: incidentId, status: 'escalated' });
    return { success: false, incident_id: incidentId, status: 'escalated' };
  }

  const actionPlan = runAgent('action', { decision, alert: detection });
  const executionResult = await executeAction(decision.action, detection.service, actionPlan.execution_command);
  const healthResult = await runHealthCheck({ ...rawAlert, ...detection }, executionResult.success);

  let resolution = runAgent('resolution', {
    incidentId,
    actionResult: executionResult,
    postActionHealth: healthResult,
    retryCount,
    maxRetries: matchedRule.max_retries,
  });

  resolution = ensureResolutionStatus(resolution, healthResult, executionResult);

  if (resolution.status === 'retry') {
    return handleRetry(incidentId, rawAlert, detection, decision, matchedRule, retryCount + 1, timeline, io);
  }

  if (resolution.status === 'resolved') {
    addTimelineEvent(`Resolved on retry ${retryCount}`);
    await IncidentModel.update(incidentId, {
      status: 'resolved',
      resolved_at: new Date().toISOString(),
      action_taken: decision.action,
      retry_count: retryCount,
    });
    if (io) io.emit('incident:updated', { incident_id: incidentId, status: 'resolved' });
    return { success: true, incident_id: incidentId, status: 'resolved', retry_count: retryCount };
  }

  await IncidentModel.update(incidentId, { status: 'escalated', escalated: true, retry_count: retryCount });
  if (io) io.emit('incident:updated', { incident_id: incidentId, status: 'escalated' });
  return { success: false, incident_id: incidentId, status: 'escalated' };
}

module.exports = { processAlert };
