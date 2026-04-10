const axios = require('axios');
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

async function probeDemoServiceHealth() {
  const base = env.demoSandbox.serviceUrl.replace(/\/$/, '');
  const url = `${base}/health`;
  try {
    const res = await axios.get(url, { timeout: 10000, validateStatus: () => true });
    const body = res.data || {};
    const httpOk = res.status === 200 && body.ok === true && body.status === 'healthy';
    return {
      health_check_passed: httpOk,
      verification_result: httpOk ? 'passed' : 'failed',
      demo_probe_url: url,
      metric_current_value: httpOk ? 0 : res.status,
      detail: body,
    };
  } catch (err) {
    logger.warn(`[HealthChecker] demo-api GET /health failed: ${err.message}`);
    return {
      health_check_passed: false,
      verification_result: 'failed',
      demo_probe_url: url,
      metric_current_value: null,
      error: err.message,
    };
  }
}

async function runHealthCheck(alert, actionSuccess) {
  const alertType = alert.alert_type;
  const config = SERVICE_METRICS[alertType] || { metric: 'generic', healthyBelow: 50 };

  const isDev = env.app.nodeEnv === 'development';
  const minD = Number.isFinite(env.healthCheck.delayMsMin) ? env.healthCheck.delayMsMin : isDev ? 30 : 1000;
  const maxD = Number.isFinite(env.healthCheck.delayMsMax) ? env.healthCheck.delayMsMax : isDev ? 120 : 3000;
  const delay = minD + Math.random() * Math.max(0, maxD - minD);
  await new Promise((resolve) => setTimeout(resolve, delay));

  const isDemoApi = alert.service === 'demo-api';

  if (isDemoApi && env.demoSandbox.enableRealFixes) {
    const probe = await probeDemoServiceHealth();
    const result = {
      service_responsive: probe.health_check_passed,
      metric_current_value: probe.metric_current_value,
      metric_threshold: alert.threshold,
      health_check_passed: probe.health_check_passed,
      checked_at: new Date().toISOString(),
      demo_verification: true,
      verification_result: probe.verification_result,
      demo_probe_url: probe.demo_probe_url,
    };
    logger.info(
      `[HealthChecker] demo-api real probe: ${probe.health_check_passed ? 'PASSED' : 'FAILED'} (${probe.demo_probe_url})`
    );
    return result;
  }

  // Simulated path (all non–real-sandbox services, or demo-api with real fixes off)
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

  if (isDemoApi) {
    result.demo_verification = false;
    result.verification_result = passed ? 'passed' : 'failed';
    result.remediation_note = 'Simulated health signal (ENABLE_REAL_SANDBOX_FIXES=false); not querying demo /health';
  }

  logger.info(
    `[HealthChecker] ${alert.service}: ${passed ? 'PASSED' : 'FAILED'} ` +
      `(${config.metric}: ${result.metric_current_value}, threshold: ${alert.threshold})`
  );

  return result;
}

module.exports = { runHealthCheck };
