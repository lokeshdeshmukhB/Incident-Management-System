const logger = require('../services/logger');

const recentActions = new Map();
const failureTracker = new Map();

const UNSAFE_ACTIONS = new Set([
  'drop_database',
  'delete_all_logs',
  'delete_all_files',
  'stop_all_services',
  'modify_firewall_rules',
  'rotate_secrets',
  'rm_rf',
]);

const SAFE_ACTIONS = new Set([
  'restart_service',
  'cleanup_logs',
  'switch_to_fallback',
  'retry_connections',
  'scale_up_instances',
  'escalate_to_human',
]);

function isDryRunRequired(rule) {
  if (!rule || typeof rule !== 'object') return false;
  return rule.dry_run === true;
}

function isUnsafeAction(action) {
  if (!action) return false;
  return UNSAFE_ACTIONS.has(action);
}

function isKnownSafeAction(action) {
  if (!action) return false;
  return SAFE_ACTIONS.has(action);
}

function isDuplicateAction(action, service, windowMs = 30000) {
  if (!action || !service) return false;
  const key = `${action}:${service}`;
  const lastExec = recentActions.get(key);
  const now = Date.now();

  if (lastExec && now - lastExec < windowMs) {
    logger.warn(`[SafetyGuard] Duplicate suppressed: ${action} on ${service} (within ${windowMs / 1000}s)`);
    return true;
  }

  recentActions.set(key, now);
  return false;
}

function checkCircuitBreaker(windowMs = 600000, maxFailures = 5) {
  const now = Date.now();
  let recentFailures = 0;

  for (const [, { timestamp }] of failureTracker) {
    if (now - timestamp < windowMs) recentFailures++;
  }

  if (recentFailures >= maxFailures) {
    logger.error(`[SafetyGuard] CIRCUIT BREAKER: ${recentFailures} failures in ${windowMs / 60000} min. Pausing automation.`);
    return true;
  }
  return false;
}

function recordFailure(incidentId) {
  failureTracker.set(incidentId, { timestamp: Date.now() });
  if (failureTracker.size > 100) {
    const oldest = [...failureTracker.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    failureTracker.delete(oldest[0][0]);
  }
}

/**
 * Run all safety checks for a proposed action.
 * Hardened: handles null/undefined action, service, and rule gracefully.
 */
function runSafetyChecks(action, service, rule, environment = 'production') {
  const safeRule = rule && typeof rule === 'object' ? rule : {};
  const checks = [];

  // ── Guard: missing action ──
  if (!action || typeof action !== 'string' || action.trim() === '') {
    checks.push({
      check: 'missing_action',
      passed: false,
      message: 'No action specified — cannot validate safety',
    });
    return { safe: false, checks, action: action || null, service: service || null };
  }

  // ── Guard: missing service context ──
  if (!service || typeof service !== 'string' || service.trim() === '') {
    checks.push({
      check: 'missing_context',
      passed: false,
      message: 'No service context provided — cannot validate safety',
    });
    return { safe: false, checks, action, service: service || null };
  }

  // ── Guard: unknown action (not in safe OR unsafe list) ──
  if (!isKnownSafeAction(action) && !isUnsafeAction(action)) {
    checks.push({
      check: 'unknown_action',
      passed: false,
      message: `Action "${action}" is not in the known safe or unsafe list — requires review`,
    });
  }

  if (isUnsafeAction(action)) {
    checks.push({
      check: 'unsafe_action',
      passed: false,
      message: `Action "${action}" is in the unsafe list and requires human approval`,
    });
  }

  if (isDryRunRequired(safeRule)) {
    checks.push({
      check: 'dry_run',
      passed: false,
      message: `Workflow rule requires dry-run first for ${action}`,
    });
  }

  if (isDuplicateAction(action, service)) {
    checks.push({
      check: 'duplicate_guard',
      passed: false,
      message: `Same action (${action}) on ${service} was executed within last 30s`,
    });
  }

  if (checkCircuitBreaker()) {
    checks.push({
      check: 'circuit_breaker',
      passed: false,
      message: '5+ action failures in last 10 minutes. Automation paused.',
    });
  }

  if (environment === 'production' && isUnsafeAction(action)) {
    checks.push({
      check: 'production_lock',
      passed: false,
      message: `Action "${action}" blocked in production without approval token`,
    });
  }

  const allPassed = checks.length === 0 || checks.every((c) => c.passed);

  if (!allPassed) {
    logger.warn(`[SafetyGuard] Blocked: ${action} on ${service} — ${checks.filter((c) => !c.passed).map((c) => c.check).join(', ')}`);
  }

  return {
    safe: allPassed,
    checks,
    action,
    service,
  };
}

/**
 * Build the structured safety_check object for pipeline agent_outputs.
 */
function buildSafetyCheckResult(safetyResult) {
  const failedChecks = (safetyResult.checks || []).filter((c) => !c.passed);
  return {
    safe: safetyResult.safe,
    reason: safetyResult.safe
      ? 'All safety checks passed'
      : failedChecks.map((c) => c.message).join('; '),
    checks: safetyResult.checks || [],
    checked_at: new Date().toISOString(),
  };
}

module.exports = {
  runSafetyChecks,
  buildSafetyCheckResult,
  isDryRunRequired,
  isUnsafeAction,
  isKnownSafeAction,
  isDuplicateAction,
  checkCircuitBreaker,
  recordFailure,
  SAFE_ACTIONS,
  UNSAFE_ACTIONS,
};
