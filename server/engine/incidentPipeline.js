const { v4: uuidv4 } = require('uuid');
const { runAgent } = require('../services/pythonAgentBridge');
const workflowEngine = require('./workflowEngine');
const { runHealthCheck } = require('./healthChecker');
const { executeAction } = require('../services/actionExecutor');
const { runSafetyChecks, SAFE_ACTIONS, UNSAFE_ACTIONS, recordFailure } = require('./safetyGuards');
const AlertModel = require('../models/Alert');
const IncidentModel = require('../models/Incident');
const ReportModel = require('../models/Report');
const logger = require('../services/logger');
const { notifyEscalation } = require('../services/notifier');
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
 * Treat an action as "usable" when it is a known action our executor/guards understand.
 * Unknown actions should not be executed automatically.
 */
function isUsableActionName(actionName) {
  if (!actionName || typeof actionName !== 'string') return false;
  const a = actionName.trim();
  if (!a) return false;
  if (SAFE_ACTIONS.has(a)) return true;
  if (UNSAFE_ACTIONS.has(a)) return true;
  return false;
}

/**
 * Workflow rules are suggestions/fallbacks, not overrides:
 * - Keep AI-selected action when it is usable
 * - Fall back to workflow rule action only when AI omitted/returned unusable action
 * - Never auto-set safe_to_execute=true based on workflow alignment
 * - Preserve AI escalate/unsafe flags
 */
function chooseFinalDecision(aiDecision, matchedRule) {
  const base = aiDecision && typeof aiDecision === 'object' ? { ...aiDecision } : {};
  delete base.error;
  delete base.message;

  const decision = {
    ...base,
    action: typeof base.action === 'string' ? base.action.trim() : base.action,
    safe_to_execute: base.safe_to_execute === true,
    escalate: base.escalate === true,
  };

  // Always respect explicit escalation from the model.
  if (decision.escalate) {
    if (!decision.action) decision.action = 'escalate_to_human';
    decision.safe_to_execute = false;
    logger.warn('[Pipeline] AI marked action unsafe, escalating');
    return decision;
  }

  // Keep AI action when it's usable.
  if (isUsableActionName(decision.action)) {
    logger.info(`[Pipeline] Using AI-selected action: ${decision.action}`);
    if (decision.priority == null && matchedRule?.priority != null) {
      decision.priority = matchedRule.priority;
    }
    if (decision.safe_to_execute !== true) decision.safe_to_execute = false;
    return decision;
  }

  // Fall back to workflow rule only if AI provided nothing usable.
  if (matchedRule?.action) {
    const ruleAction = String(matchedRule.action).trim();
    logger.info(`[Pipeline] Falling back to workflow rule action: ${ruleAction}`);

    const fallback = {
      ...decision,
      action: ruleAction,
      safe_to_execute: decision.safe_to_execute === true,
      escalate: decision.escalate === true,
      used_workflow_fallback: true,
    };

    if (fallback.priority == null && matchedRule.priority != null) {
      fallback.priority = matchedRule.priority;
    }

    // Hard escalation path when the rule has only "escalate_to_human".
    if (ruleAction === 'escalate_to_human') {
      return {
        ...fallback,
        action: 'escalate_to_human',
        escalate: true,
        safe_to_execute: false,
        escalation_reason:
          fallback.escalation_reason || 'Workflow rule requires human escalation.',
      };
    }

    // If the workflow suggests an unknown action, do not execute it automatically.
    if (!isUsableActionName(ruleAction)) {
      return {
        ...fallback,
        escalate: true,
        safe_to_execute: false,
        escalation_reason:
          fallback.escalation_reason ||
          `Workflow rule suggested unknown action "${ruleAction}", escalating for safety.`,
      };
    }

    if (fallback.safe_to_execute !== true) fallback.safe_to_execute = false;
    return fallback;
  }

  // No usable action from AI and no workflow fallback -> escalate.
  logger.warn('[Pipeline] No usable action from AI or workflow; escalating');
  return {
    ...decision,
    action: decision.action || 'escalate_to_human',
    escalate: true,
    safe_to_execute: false,
    escalation_reason: decision.escalation_reason || 'No usable automated action provided.',
  };
}

function applySafetyGuardOrEscalate(decision, detection, matchedRule) {
  const checked_at = new Date().toISOString();
  const environment = env?.app?.nodeEnv || process.env.NODE_ENV || 'development';

  if (!decision?.action) {
    return {
      decision: {
        ...(decision || {}),
        safety_check: { safe: false, reason: 'No action provided', checked_at },
      },
      blocked: true,
      reason: 'no_action',
    };
  }

  const safety = runSafetyChecks(decision.action, detection?.service || 'unknown', matchedRule, environment);
  const firstFailure = (safety.checks || []).find((c) => c && c.passed === false);
  const failureReason = firstFailure?.message || 'Safety guard blocked action';

  const safety_check = {
    safe: Boolean(safety.safe),
    reason: safety.safe ? 'Safety checks passed' : failureReason,
    checked_at,
    checks: safety.checks,
  };

  if (!safety.safe) {
    logger.warn(`[Pipeline] Safety check failed for action=${decision.action}: ${safety_check.reason}`);
    return {
      decision: {
        ...(decision || {}),
        safe_to_execute: false,
        escalate: true,
        escalation_reason: decision.escalation_reason || safety_check.reason,
        safety_check,
      },
      blocked: true,
      reason: 'safety_failed',
    };
  }

  return {
    decision: { ...(decision || {}), safety_check },
    blocked: false,
    reason: null,
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

    decision = chooseFinalDecision(decision, matchedRule);

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
      const safetyOutcome = applySafetyGuardOrEscalate(decision, detection, matchedRule);
      decision = safetyOutcome.decision;

      await IncidentModel.update(incidentId, {
        status: 'in_progress',
        agent_outputs: { ...incident.agent_outputs, detection, decision },
      });
      if (io) io.emit('incident:updated', { incident_id: incidentId, status: 'in_progress', decision });

      if (safetyOutcome.blocked) {
        addTimelineEvent(
          `Action blocked by safety guard: ${decision.safety_check?.reason || 'blocked'}`
        );
        actionResult = { executed: false, success: false, output_log: 'Action blocked — safety guard' };
        setActivity({
          agent: 'action',
          incident_id: incidentId,
          status: 'completed',
          result: { skipped: true, blocked: true, reason: safetyOutcome.reason },
        });
        if (io) io.emit('agent:activity', { agent: 'action', incident_id: incidentId, status: 'completed' });
      } else {
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

        if (!executionResult?.success) {
          recordFailure(incidentId);
        }

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

      const incidentForNotify = {
        incident_id: incidentId,
        service: detection.service ?? incident.service,
        alert_type: detection.alert_type ?? incident.alert_type,
        severity: detection.severity ?? incident.severity,
        retry_count: incident.retry_count ?? 0,
        status: 'escalated',
        escalation_reason: resolution.resolution_summary || decision.escalation_reason,
        failure_reason: resolution.resolution_summary,
      };
      try {
        await notifyEscalation(escalation, incidentForNotify);
      } catch (notifyErr) {
        logger.error(`[Pipeline] notifyEscalation error: ${notifyErr.message}`);
      }

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

    const retryFailReason = `Action failed after ${retryCount} retries`;
    const incidentForNotify = {
      incident_id: incidentId,
      service: detection.service,
      alert_type: detection.alert_type,
      severity: detection.severity,
      retry_count: retryCount,
      status: 'escalated',
      escalation_reason: retryFailReason,
      failure_reason: retryFailReason,
    };
    try {
      await notifyEscalation(escalation, incidentForNotify);
    } catch (notifyErr) {
      logger.error(`[Pipeline:Retry] notifyEscalation error: ${notifyErr.message}`);
    }

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

  decision = chooseFinalDecision(decision, matchedRule);

  if (decision.escalate) {
    addTimelineEvent('Decision agent recommends escalation on retry');
    await IncidentModel.update(incidentId, { status: 'escalated', escalated: true });
    if (io) io.emit('incident:updated', { incident_id: incidentId, status: 'escalated' });
    return { success: false, incident_id: incidentId, status: 'escalated' };
  }

  if (decision.safe_to_execute) {
    const safetyOutcome = applySafetyGuardOrEscalate(decision, detection, matchedRule);
    decision = safetyOutcome.decision;
    await IncidentModel.update(incidentId, { agent_outputs: { detection, decision } });
    if (io) io.emit('incident:updated', { incident_id: incidentId, decision });

    if (safetyOutcome.blocked) {
      addTimelineEvent(`Retry action blocked by safety guard: ${decision.safety_check?.reason || 'blocked'}`);
      await IncidentModel.update(incidentId, { status: 'escalated', escalated: true, retry_count: retryCount });
      if (io) io.emit('incident:updated', { incident_id: incidentId, status: 'escalated' });
      return { success: false, incident_id: incidentId, status: 'escalated', retry_count: retryCount };
    }
  }

  const actionPlan = runAgent('action', { decision, alert: detection });
  const executionResult = await executeAction(decision.action, detection.service, actionPlan.execution_command);
  if (!executionResult?.success) {
    recordFailure(incidentId);
  }
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
