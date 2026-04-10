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
      return { success: false, reason: 'invalid_alert', detection };
    }

    const alertId = detection.alert_id || rawAlert.alert_id || `ALT-${Date.now()}`;
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
      status: 'pending',
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

    const decision = runAgent('decision', {
      alert: detection,
      workflowRules,
      currentRetryCount: 0,
      recentIncidents,
    });

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

    const matchedRule = await workflowEngine.matchRule(detection.alert_type);

    const resolution = runAgent('resolution', {
      incidentId,
      actionResult: executionResult || actionResult,
      postActionHealth: healthResult,
      retryCount: 0,
      maxRetries: matchedRule.max_retries,
    });

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
      await IncidentModel.update(incidentId, {
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        action_taken: decision.action,
        mttd_sec: mttdSec,
        mttr_sec: mttrSec,
        agent_outputs: { detection, decision, action: actionResult, resolution },
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
      status: resolution.status === 'escalated' ? 'escalated' : 'resolved',
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
  const decision = runAgent('decision', {
    alert: detection,
    workflowRules,
    currentRetryCount: retryCount,
    recentIncidents: [],
  });

  if (decision.escalate) {
    addTimelineEvent('Decision agent recommends escalation on retry');
    await IncidentModel.update(incidentId, { status: 'escalated', escalated: true });
    if (io) io.emit('incident:updated', { incident_id: incidentId, status: 'escalated' });
    return { success: false, incident_id: incidentId, status: 'escalated' };
  }

  const actionPlan = runAgent('action', { decision, alert: detection });
  const executionResult = await executeAction(decision.action, detection.service, actionPlan.execution_command);
  const healthResult = await runHealthCheck({ ...rawAlert, ...detection }, executionResult.success);

  const resolution = runAgent('resolution', {
    incidentId,
    actionResult: executionResult,
    postActionHealth: healthResult,
    retryCount,
    maxRetries: matchedRule.max_retries,
  });

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
