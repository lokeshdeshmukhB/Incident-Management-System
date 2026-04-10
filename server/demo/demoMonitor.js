/**
 * Polls the sandbox demo API and POSTs to AIMS when health flips healthy -> unhealthy.
 * Uses edge detection plus a cooldown so flaky health does not flood the pipeline.
 */
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(__dirname, '../../.env') });

const logger = (msg) => console.log(`[demo-monitor] ${msg}`);

const DEMO_BASE = (process.env.DEMO_SERVICE_URL || 'http://127.0.0.1:5055').replace(/\/$/, '');
const WEBHOOK_URL = process.env.DEMO_WEBHOOK_URL || 'http://127.0.0.1:5000/api/webhooks/demo';
const INTERVAL_MS = parseInt(process.env.DEMO_MONITOR_INTERVAL_MS || '3000', 10) || 3000;
const COOLDOWN_MS = parseInt(process.env.DEMO_MONITOR_COOLDOWN_MS || '60000', 10) || 60000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SHARED_SECRET || '';

let wasHealthy = true;
let lastWebhookAt = 0;

async function fetchHealth() {
  const res = await fetch(`${DEMO_BASE}/health`, { method: 'GET' });
  let body = {};
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  const ok = res.ok && body.ok === true && body.status === 'healthy';
  return { ok, status: res.status, body };
}

async function sendWebhook() {
  const now = new Date().toISOString();
  const alertId = `ALT-DEMO-${Date.now()}`;
  const payload = {
    alert_id: alertId,
    alert_type: 'api_failure',
    severity: 'critical',
    service: 'demo-api',
    host: 'localhost',
    metric_value: 500,
    threshold: 200,
    timestamp: now,
  };

  const headers = {
    'Content-Type': 'application/json',
  };
  if (WEBHOOK_SECRET) {
    headers['x-webhook-secret'] = WEBHOOK_SECRET;
  }

  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Webhook HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  logger(`Webhook accepted (${alertId})`);
}

async function tick() {
  try {
    const { ok, status, body } = await fetchHealth();

    if (ok) {
      if (!wasHealthy) {
        logger('Demo API recovered (healthy)');
      }
      wasHealthy = true;
      return;
    }

    if (wasHealthy) {
      wasHealthy = false;
      const now = Date.now();
      if (now - lastWebhookAt < COOLDOWN_MS) {
        logger(`Unhealthy edge detected but cooldown active (${COOLDOWN_MS}ms) — skip webhook`);
        return;
      }
      logger(`Unhealthy edge detected (HTTP ${status}) ${JSON.stringify(body)} — sending webhook`);
      await sendWebhook();
      lastWebhookAt = now;
    }
  } catch (err) {
    logger(`Poll error: ${err.message}`);
  }
}

async function main() {
  if (!WEBHOOK_SECRET) {
    logger('WARN: WEBHOOK_SHARED_SECRET is empty — demo webhook route will reject requests. Set it in .env');
  }
  logger(`Polling ${DEMO_BASE}/health every ${INTERVAL_MS}ms → ${WEBHOOK_URL}`);
  await tick();
  setInterval(tick, INTERVAL_MS);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
