const { spawnSync } = require('child_process');
const path = require('path');
const logger = require('./logger');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const DETECTION_FIELD_ALIASES = [
  ['isDuplicate', 'is_duplicate'],
  ['enrichedAt', 'enriched_at'],
];

function normalizeDetectionOutput(obj) {
  if (!obj || typeof obj !== 'object' || obj.error) return obj;
  const o = { ...obj };
  for (const [camel, snake] of DETECTION_FIELD_ALIASES) {
    if (o[snake] === undefined && o[camel] !== undefined) o[snake] = o[camel];
  }
  return o;
}

/** Groq sometimes returns camelCase despite JSON schema; pipeline expects snake_case. */
const DECISION_FIELD_ALIASES = [
  ['safeToExecute', 'safe_to_execute'],
  ['dryRunFirst', 'dry_run_first'],
  ['matchedRule', 'matched_rule'],
  ['escalationReason', 'escalation_reason'],
  ['recommendedActionDescription', 'recommended_action_description'],
  ['fallbackAction', 'fallback_action'],
];

function normalizeDecisionOutput(obj) {
  if (!obj || typeof obj !== 'object' || obj.error) return obj;
  const o = { ...obj };
  for (const [camel, snake] of DECISION_FIELD_ALIASES) {
    if (o[snake] === undefined && o[camel] !== undefined) o[snake] = o[camel];
  }
  return o;
}

const ACTION_FIELD_ALIASES = [
  ['executionCommand', 'execution_command'],
  ['rollbackCommand', 'rollback_command'],
  ['expectedOutcome', 'expected_outcome'],
  ['verificationCommand', 'verification_command'],
  ['executionDurationEstimateSec', 'execution_duration_estimate_sec'],
  ['notifyBeforeExecution', 'notify_before_execution'],
  ['notificationMessage', 'notification_message'],
  ['riskLevel', 'risk_level'],
];

function normalizeActionOutput(obj) {
  if (!obj || typeof obj !== 'object' || obj.error) return obj;
  const o = { ...obj };
  for (const [camel, snake] of ACTION_FIELD_ALIASES) {
    if (o[snake] === undefined && o[camel] !== undefined) o[snake] = o[camel];
  }
  return o;
}

const RESOLUTION_FIELD_ALIASES = [
  ['resolutionConfirmed', 'resolution_confirmed'],
  ['resolutionSummary', 'resolution_summary'],
  ['resolvedAt', 'resolved_at'],
  ['retryRecommended', 'retry_recommended'],
  ['escalationRequired', 'escalation_required'],
  ['nextAction', 'next_action'],
  ['resolutionStatus', 'status'],
];

function normalizeResolutionOutput(obj) {
  if (!obj || typeof obj !== 'object' || obj.error) return obj;
  const o = { ...obj };
  for (const [camel, snake] of RESOLUTION_FIELD_ALIASES) {
    if (o[snake] === undefined && o[camel] !== undefined) o[snake] = o[camel];
  }
  return o;
}

const ESCALATION_FIELD_ALIASES = [
  ['notificationChannels', 'notification_channels'],
  ['messageTitle', 'message_title'],
  ['messageBody', 'message_body'],
  ['escalationPriority', 'escalation_priority'],
  ['recommendedManualSteps', 'recommended_manual_steps'],
  ['escalatedAt', 'escalated_at'],
];

function normalizeEscalationOutput(obj) {
  if (!obj || typeof obj !== 'object' || obj.error) return obj;
  const o = { ...obj };
  for (const [camel, snake] of ESCALATION_FIELD_ALIASES) {
    if (o[snake] === undefined && o[camel] !== undefined) o[snake] = o[camel];
  }
  return o;
}

function resolvePythonCmd() {
  if (process.env.PYTHON) return process.env.PYTHON;
  return process.platform === 'win32' ? 'python' : 'python3';
}

/**
 * Preload Python + LangChain imports once at server start so the first real
 * agent invocation does not pay full cold-start cost (~tens of seconds on Windows).
 */
function warmupPythonAgentBridge() {
  if (process.env.PYTHON_AGENT_WARMUP === 'false') return;
  const python = resolvePythonCmd();
  const env = { ...process.env };
  const sep = path.delimiter;
  env.PYTHONPATH = env.PYTHONPATH ? `${REPO_ROOT}${sep}${env.PYTHONPATH}` : REPO_ROOT;
  const started = Date.now();
  const result = spawnSync(
    python,
    ['-c', 'import incident_management.bridge; import incident_management.agents.detection_agent'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      env,
      windowsHide: true,
    }
  );
  if (result.error) {
    logger.warn(`[pythonAgentBridge] Warmup spawn error: ${result.error.message}`);
    return;
  }
  if (result.status !== 0) {
    logger.warn(`[pythonAgentBridge] Warmup exited ${result.status}: ${(result.stderr || '').slice(0, 300)}`);
    return;
  }
  logger.info(`[pythonAgentBridge] Python agent warmup completed in ${Date.now() - started}ms`);
}

/**
 * Invoke a Python LangChain agent (stdin JSON → stdout JSON).
 * @param {'detection'|'decision'|'action'|'resolution'|'escalation'|'reporting'} agentName
 * @param {object} args camelCase keys accepted; bridge normalizes for Python
 */
function runAgent(agentName, args) {
  const python = resolvePythonCmd();
  const env = { ...process.env };
  const sep = path.delimiter;
  env.PYTHONPATH = env.PYTHONPATH ? `${REPO_ROOT}${sep}${env.PYTHONPATH}` : REPO_ROOT;

  const result = spawnSync(python, ['-m', 'incident_management.bridge'], {
    cwd: REPO_ROOT,
    input: JSON.stringify({ agent: agentName, args: args || {} }),
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
    env,
    windowsHide: true,
  });

  if (result.error) {
    logger.error(`[pythonAgentBridge] spawn error: ${result.error.message}`);
    throw result.error;
  }

  const out = (result.stdout || '').trim();
  if (result.status !== 0) {
    logger.error(`[pythonAgentBridge] exit ${result.status}: ${result.stderr || out}`);
    try {
      return out ? JSON.parse(out) : { error: true, message: 'Python bridge failed with no output' };
    } catch {
      return { error: true, message: result.stderr || 'Python bridge failed' };
    }
  }

  if (!out) {
    return { error: true, message: 'Empty response from Python bridge' };
  }

  try {
    const parsed = JSON.parse(out);
    if (agentName === 'detection') return normalizeDetectionOutput(parsed);
    if (agentName === 'decision') return normalizeDecisionOutput(parsed);
    if (agentName === 'action') return normalizeActionOutput(parsed);
    if (agentName === 'resolution') return normalizeResolutionOutput(parsed);
    if (agentName === 'escalation') return normalizeEscalationOutput(parsed);
    return parsed;
  } catch (e) {
    logger.error(`[pythonAgentBridge] Invalid JSON: ${out.slice(0, 500)}`);
    return { error: true, message: `Invalid JSON from Python bridge: ${e.message}` };
  }
}

module.exports = { runAgent, warmupPythonAgentBridge };
