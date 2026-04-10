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
  'restart_api_service',
  'cleanup_logs',
  'cleanup_disk_space',
  'switch_to_fallback',
  'retry_connections',
  'scale_up_instances',
  'escalate_to_human',
  'notify_admin',
]);

function isDryRunRequired(rule) {
  return rule.dry_run === true;
}

function isUnsafeAction(action) {
  return UNSAFE_ACTIONS.has(action);
}

function isDuplicateAction(action, service, windowMs = 30000) {
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

function runSafetyChecks(action, service, rule, environment = 'production') {
  const checks = [];

  if (isUnsafeAction(action)) {
    checks.push({
      check: 'unsafe_action',
      passed: false,
      message: `Action "${action}" is in the unsafe list and requires human approval`,
    });
  }

  if (isDryRunRequired(rule)) {
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

module.exports = {
  runSafetyChecks,
  isDryRunRequired,
  isUnsafeAction,
  isDuplicateAction,
  checkCircuitBreaker,
  recordFailure,
  SAFE_ACTIONS,
  UNSAFE_ACTIONS,
};
