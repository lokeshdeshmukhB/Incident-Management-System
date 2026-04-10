const logger = require('../services/logger');
const env = require('../config/env');

const SERVICE_METRICS = {
  high_cpu: { metric: 'cpu_percent', healthyBelow: 70 },
  disk_full: { metric: 'disk_percent', healthyBelow: 80 },
  api_failure: { metric: 'error_rate', healthyBelow: 1 },
  service_down: { metric: 'health_check', healthyAbove: 1 },
  memory_leak: { metric: 'memory_percent', healthyBelow: 80 },
  network_timeout: { metric: 'latency_ms', healthyBelow: 200 },
};

async function runHealthCheck(alert, actionSuccess) {
  const alertType = alert.alert_type;
  const config = SERVICE_METRICS[alertType] || { metric: 'generic', healthyBelow: 50 };

  const isDev = env.app.nodeEnv === 'development';
  const minD = Number.isFinite(env.healthCheck.delayMsMin) ? env.healthCheck.delayMsMin : isDev ? 30 : 1000;
  const maxD = Number.isFinite(env.healthCheck.delayMsMax) ? env.healthCheck.delayMsMax : isDev ? 120 : 3000;
  const delay = minD + Math.random() * Math.max(0, maxD - minD);
  await new Promise((resolve) => setTimeout(resolve, delay));

  // After a successful (simulated) remediation, treat health as recovered; without it, stay failed.
  const passed = Boolean(actionSuccess);

  let currentValue;
  if (passed) {
    if (config.healthyBelow) {
      currentValue = Math.random() * config.healthyBelow * 0.8;
    } else {
      currentValue = 1;
    }
  } else {
    currentValue = alert.metric_value * (0.85 + Math.random() * 0.2);
  }

  const result = {
    service_responsive: passed,
    metric_current_value: Math.round(currentValue * 10) / 10,
    metric_threshold: alert.threshold,
    health_check_passed: passed,
    checked_at: new Date().toISOString(),
  };

  logger.info(
    `[HealthChecker] ${alert.service}: ${passed ? 'PASSED' : 'FAILED'} ` +
    `(${config.metric}: ${result.metric_current_value}, threshold: ${alert.threshold})`
  );

  return result;
}

module.exports = { runHealthCheck };
