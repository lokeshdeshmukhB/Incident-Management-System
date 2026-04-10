const { v4: uuidv4 } = require('uuid');
const { runAgent } = require('../services/pythonAgentBridge');
const workflowEngine = require('./workflowEngine');
const { runHealthCheck } = require('./healthChecker');
const { executeAction } = require('../services/actionExecutor');
const { runSafetyChecks, buildSafetyCheckResult, recordFailure } = require('./safetyGuards');
const AlertModel = require('../models/Alert');
const IncidentModel = require('../models/Incident');
const ReportModel = require('../models/Report');
const logger = require('../services/logger');
const { notifyEscalation } = require('../services/notifier');
const { setActivity } = require('../services/agentActivityStore');
const env = require('../config/env');

// ─────────────────────────────────────────────────────────────────────────────
// Helper: AI-primary decision resolution
// ─────────────────────────────────────────────────────────────────────────────

/** LLM action name → workflow rule action aliases (when they differ). */
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
 * PRIMARY decision function — keep the AI's action unless it's missing/unusable.
 *
 * Logic:
 *  - If the LLM returned a valid, non-empty action → keep it.
 *  - Only fall back to workflow rule if the LLM returned nothing usable.
 *  - Preserve escalate_to_human workflow rule as a hard escalation fallback.
 */
function chooseFinalAction(decision, matchedRule) {
  const base =
    decision && typeof decision === 'object' ? { ...decision } : {};
  delete base.error;
  delete base.message;

  const hasValidAiAction =
    typeof base.action === 'string' && base.action.trim() !== '';

  if (hasValidAiAction) {
    logger.info(`[Pipeline] Using AI-selected action: ${base.action}`);
    return base;
  }

  // AI returned no action — fall back to workflow rule
  if (matchedRule && matchedRule.action) {
    logger.info(`[Pipeline] Falling back to workflow rule action: ${matchedRule.action}`);

    if (matchedRule.action === 'escalate_to_human') {
      return {
        ...base,
        action: 'escalate_to_human',
        escalate: true,
        safe_to_execute: false,
        escalation_reason:
          base.escalation_reason || 'No AI action available; workflow rule escalates to human.',
      };
    }

    return {
      ...base,
      action: matchedRule.action,
      // Do NOT auto-set safe_to_execute; leave it for handleUnsafeOrEscalate
    };
  }

  // No AI action, no workflow rule — escalate
  logger.warn('[Pipeline] No action from AI or workflow rules, escalating');
  return {
    ...base,
    action: 'escalate_to_human',
    escalate: true,
    safe_to_execute: false,
    escalation_reason: 'Neither AI nor workflow rules produced a usable action.',
  };
}

/**
 * Fill in missing non-action fields from the workflow rule as suggestions/defaults.
 * Does NOT override values the LLM already set.
 */
function applyWorkflowFallback(decision, matchedRule) {
  if (!matchedRule || typeof matchedRule !== 'object') return decision;
  const out = { ...decision };

  if (out.priority == null && matchedRule.priority != null) {
    out.priority = matchedRule.priority;
  }

  // Defaults that should exist
  if (out.safe_to_execute == null) out.safe_to_execute = false;
  if (out.escalate == null) out.escalate = false;

  return out;
}

/**
 * Enforce LLM safety flags — never override unsafe/escalate to safe.
 * If the LLM says escalate or unsafe, we respect that decision.
 */
function handleUnsafeOrEscalate(decision) {
  const out = { ...decision };

  // If the LLM explicitly says escalate, force the action and safety flag
  if (out.escalate === true) {
    logger.info(`[Pipeline] AI marked action for escalation: ${out.escalation_reason || 'no reason given'}`);
    out.action = 'escalate_to_human';
    out.safe_to_execute = false;
    return out;
  }

  // If the LLM says unsafe, do NOT override — respect the decision
  if (out.safe_to_execute === false) {
    logger.info(`[Pipeline] AI marked action unsafe, escalating (action: ${out.action})`);
    out.escalate = true;
    out.escalation_reason =
      out.escalation_reason || out.safety_reason || 'AI decision agent marked action as unsafe';
    return out;
  }

  return out;
}

function ensureResolutionStatus(resolution, healthResult, executionResult) {
  // Only trust the agent's "retry" routing without re-deriving status.
  // For resolved/escalated, always reconcile with action + health so LLM cannot skip verification.
  if (resolution?.status === 'retry' && !resolution?.error) {
    return resolution;
  }

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

/** api_failure for demo-api uses restart_api_service so allowlisted sandbox repair can run. */
function applyDemoApiRestartRule(rule, service, alertType) {
  if (service === 'demo-api' && alertType === 'api_failure' && rule && typeof rule === 'object') {
    return { ...rule, action: 'restart_api_service' };
  }
  return rule;
}

function augmentResolutionSummaryForDemo(resolution, executionResult, healthResult, service) {
  if (service !== 'demo-api') return resolution;
  const mode = executionResult?.real_execution ? 'real-sandbox' : 'simulated';
  const ver =
    healthResult?.verification_result || (healthResult?.health_check_passed ? 'passed' : 'failed');
  const line = `Remediation mode: ${mode}. Health verification: ${ver}.`;
  return {
    ...resolution,
    resolution_summary: [line, resolution.resolution_summary].filter(Boolean).join(' '),
  };
}

function buildDemoSandboxMeta(rawAlert, detection, actionComposite, healthResult) {
  if (detection.service !== 'demo-api') return null;
  const remediation_mode = actionComposite?.real_execution ? 'real-sandbox' : 'simulated';
  const verification_result =
    healthResult?.verification_result || (healthResult?.health_check_passed ? 'passed' : 'failed');
  return {
    webhook_received: Boolean(rawAlert.webhook_received),
    remediation_mode,
    verification_result,
    demo_target: 'demo-api',
    repair_endpoint_called: actionComposite?.repair_endpoint_called || null,
    health_probe_url: healthResult?.demo_probe_url || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main pipeline
// ─────────────────────────────────────────────────────────────────────────────

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
    let detection = runAgent('detection', rawAlert);

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

    if (rawAlert.webhook_received && rawAlert.service === 'demo-api') {
      detection = {
        ...detection,
        service: 'demo-api',
        alert_type: rawAlert.alert_type || detection.alert_type,
      };
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

    const initialOutputs =
      detection.service === 'demo-api'
        ? {
            detection,
            demo_sandbox: {
              webhook_received: Boolean(rawAlert.webhook_received),
              remediation_mode: 'pending',
              verification_result: 'pending',
              demo_target: 'demo-api',
              repair_endpoint_called: null,
            },
          }
        : { detection };

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
      agent_outputs: initialOutputs,
    });

    await AlertModel.markProcessed(alertId);

    if (io) {
      io.emit('incident:created', incident);
      setActivity({ agent: 'detection', incident_id: incidentId, status: 'completed' });
      io.emit('agent:activity', { agent: 'detection', incident_id: incidentId, status: 'completed' });
    }

    // ── Stage 3: Decision (AI-primary, workflow-secondary) ──
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

    // Look up the matched rule now (needed for fallback + resolution)
    const matchedRule = await workflowEngine.matchRule(detection.alert_type);
    const effectiveRule = applyDemoApiRestartRule(matchedRule, detection.service, detection.alert_type);

    // AI-primary decision pipeline:
    // 1. Choose final action: AI first, workflow fallback only if AI returned nothing
    decision = chooseFinalAction(decision, effectiveRule);
    // 2. Fill in missing metadata from workflow rule (priority, etc.)
    decision = applyWorkflowFallback(decision, effectiveRule);
    // 3. Enforce safety flags: never override AI's unsafe/escalate judgment
    decision = handleUnsafeOrEscalate(decision);

    if (
      detection.service === 'demo-api' &&
      detection.alert_type === 'api_failure' &&
      !decision.escalate &&
      decision.safe_to_execute === true
    ) {
      decision = { ...decision, action: 'restart_api_service' };
    }

    addTimelineEvent(`Decision: action=${decision.action}, safe=${decision.safe_to_execute}, escalate=${decision.escalate}, priority=${decision.priority}`);

    await IncidentModel.update(incidentId, {
      status: 'in_progress',
      agent_outputs: { ...(incident.agent_outputs || {}), detection, decision },
    });

    if (io) {
      io.emit('incident:updated', { incident_id: incidentId, status: 'in_progress', decision });
      setActivity({ agent: 'decision', incident_id: incidentId, status: 'completed' });
      io.emit('agent:activity', { agent: 'decision', incident_id: incidentId, status: 'completed' });
    }

    // ── Stage 4: Action (with safety guard enforcement) ──
    let actionResult = null;
    let executionResult = null;
    let safetyCheck = null;

    if (decision.safe_to_execute && !decision.escalate) {
      // ── Run safety checks BEFORE executing ──
      const safetyResult = runSafetyChecks(
        decision.action,
        detection.service,
        effectiveRule,
        env.app.nodeEnv === 'production' ? 'production' : 'development'
      );
      safetyCheck = buildSafetyCheckResult(safetyResult);

      if (!safetyResult.safe) {
        // Safety check FAILED — do not execute, escalate instead
        addTimelineEvent(`Safety check FAILED for action ${decision.action}: ${safetyCheck.reason}`);
        logger.warn(`[Pipeline] Safety check FAILED — blocking action ${decision.action} on ${detection.service}`);

        actionResult = {
          executed: false,
          success: false,
          output_log: `Action blocked by safety guard: ${safetyCheck.reason}`,
          safety_check: safetyCheck,
        };

        // Force escalation
        decision = {
          ...decision,
          safe_to_execute: false,
          escalate: true,
          escalation_reason: `Safety guard blocked action: ${safetyCheck.reason}`,
        };

        setActivity({ agent: 'action', incident_id: incidentId, status: 'completed', result: { blocked: true } });
        if (io) io.emit('agent:activity', { agent: 'action', incident_id: incidentId, status: 'completed', result: { blocked: true } });
      } else {
        // Safety check PASSED — proceed with action execution
        addTimelineEvent(`Safety check PASSED for action: ${decision.action}`);
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

        actionResult = { ...actionPlan, ...executionResult, safety_check: safetyCheck };
        addTimelineEvent(
          `Action result: ${executionResult.success ? 'SUCCESS' : 'FAILED'} (${executionResult.duration_ms}ms)`
        );

        // Record failure for circuit breaker if action failed
        if (!executionResult.success) {
          recordFailure(incidentId);
        }

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
      maxRetries: effectiveRule.max_retries,
    });

    resolution = ensureResolutionStatus(resolution, healthResult, executionResult);
    resolution = augmentResolutionSummaryForDemo(
      resolution,
      executionResult,
      healthResult,
      detection.service
    );

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
      return await handleRetry(incidentId, rawAlert, detection, decision, effectiveRule, 1, timeline, io, safetyCheck);
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
        reason: resolution.resolution_summary || decision.escalation_reason || 'Automated remediation failed',
      });

      const agentOutputs = { detection, decision, action: actionResult, resolution, escalation };
      if (safetyCheck) agentOutputs.safety_check = safetyCheck;
      const demoMeta = buildDemoSandboxMeta(rawAlert, detection, executionResult || actionResult, healthResult);
      if (demoMeta) agentOutputs.demo_sandbox = demoMeta;

      await IncidentModel.update(incidentId, {
        status: 'escalated',
        escalated: true,
        action_taken: decision.action,
        agent_outputs: agentOutputs,
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
      if (safetyCheck) resolvedOutputs.safety_check = safetyCheck;
      const demoMetaResolved = buildDemoSandboxMeta(
        rawAlert,
        detection,
        executionResult || actionResult,
        healthResult
      );
      if (demoMetaResolved) resolvedOutputs.demo_sandbox = demoMetaResolved;

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
      demo_sandbox: buildDemoSandboxMeta(rawAlert, detection, executionResult || actionResult, healthResult),
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

// ─────────────────────────────────────────────────────────────────────────────
// Retry handler
// ─────────────────────────────────────────────────────────────────────────────

async function handleRetry(incidentId, rawAlert, detection, prevDecision, matchedRule, retryCount, timeline, io, prevSafetyCheck) {
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

    const agentOutputs = { detection, escalation };
    if (prevSafetyCheck) agentOutputs.safety_check = prevSafetyCheck;

    await IncidentModel.update(incidentId, {
      status: 'escalated',
      escalated: true,
      retry_count: retryCount,
      agent_outputs: agentOutputs,
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

  // AI-primary decision pipeline (same as main flow)
  decision = chooseFinalAction(decision, matchedRule);
  decision = applyWorkflowFallback(decision, matchedRule);
  decision = handleUnsafeOrEscalate(decision);

  if (
    detection.service === 'demo-api' &&
    detection.alert_type === 'api_failure' &&
    !decision.escalate &&
    decision.safe_to_execute === true
  ) {
    decision = { ...decision, action: 'restart_api_service' };
  }

  if (decision.escalate) {
    addTimelineEvent('Decision agent recommends escalation on retry');
    await IncidentModel.update(incidentId, { status: 'escalated', escalated: true });
    if (io) io.emit('incident:updated', { incident_id: incidentId, status: 'escalated' });
    return { success: false, incident_id: incidentId, status: 'escalated' };
  }

  // ── Safety checks before retry action ──
  const safetyResult = runSafetyChecks(
    decision.action,
    detection.service,
    matchedRule,
    env.app.nodeEnv === 'production' ? 'production' : 'development'
  );
  const safetyCheck = buildSafetyCheckResult(safetyResult);

  if (!safetyResult.safe) {
    addTimelineEvent(`Safety check FAILED on retry for action ${decision.action}: ${safetyCheck.reason}`);
    await IncidentModel.update(incidentId, { status: 'escalated', escalated: true });
    if (io) io.emit('incident:updated', { incident_id: incidentId, status: 'escalated' });
    return { success: false, incident_id: incidentId, status: 'escalated', safety_check: safetyCheck };
  }

  addTimelineEvent(`Safety check PASSED on retry for action: ${decision.action}`);

  const actionPlan = runAgent('action', { decision, alert: detection });
  const executionResult = await executeAction(decision.action, detection.service, actionPlan.execution_command);

  // Record failure for circuit breaker
  if (!executionResult.success) {
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
  resolution = augmentResolutionSummaryForDemo(
    resolution,
    executionResult,
    healthResult,
    detection.service
  );

  if (resolution.status === 'retry') {
    return handleRetry(incidentId, rawAlert, detection, decision, matchedRule, retryCount + 1, timeline, io, safetyCheck);
  }

  const actionComposite = { ...actionPlan, ...executionResult };

  if (resolution.status === 'resolved') {
    addTimelineEvent(`Resolved on retry ${retryCount}`);
    const resolvedUpdate = {
      status: 'resolved',
      resolved_at: new Date().toISOString(),
      action_taken: decision.action,
      retry_count: retryCount,
    };
    if (detection.service === 'demo-api') {
      const prevRow = await IncidentModel.findByIncidentId(incidentId);
      const prevOut = prevRow?.agent_outputs || {};
      const dMeta = buildDemoSandboxMeta(rawAlert, detection, actionComposite, healthResult);
      resolvedUpdate.agent_outputs = {
        ...prevOut,
        decision,
        action: actionComposite,
        resolution,
        ...(dMeta ? { demo_sandbox: dMeta } : {}),
      };
    }
    await IncidentModel.update(incidentId, resolvedUpdate);
    if (io) io.emit('incident:updated', { incident_id: incidentId, status: 'resolved' });
    return { success: true, incident_id: incidentId, status: 'resolved', retry_count: retryCount };
  }

  const escalatedUpdate = { status: 'escalated', escalated: true, retry_count: retryCount };
  if (detection.service === 'demo-api') {
    const prevRow = await IncidentModel.findByIncidentId(incidentId);
    const prevOut = prevRow?.agent_outputs || {};
    const dMeta = buildDemoSandboxMeta(rawAlert, detection, actionComposite, healthResult);
    escalatedUpdate.agent_outputs = {
      ...prevOut,
      decision,
      action: actionComposite,
      resolution,
      ...(dMeta ? { demo_sandbox: dMeta } : {}),
    };
  }
  await IncidentModel.update(incidentId, escalatedUpdate);
  if (io) io.emit('incident:updated', { incident_id: incidentId, status: 'escalated' });
  return { success: false, incident_id: incidentId, status: 'escalated' };
}

module.exports = { processAlert };
