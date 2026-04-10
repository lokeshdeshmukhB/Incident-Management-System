const express = require('express');
const crypto = require('crypto');
const AlertModel = require('../models/Alert');
const { processAlert } = require('../engine/incidentPipeline');
const logger = require('../services/logger');
const env = require('../config/env');

const router = express.Router();

function timingSafeEqualString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function normalizeDemoWebhookBody(body) {
  const ts = body.timestamp ? new Date(body.timestamp).toISOString() : new Date().toISOString();
  return {
    alert_id: body.alert_id || `ALT-DEMO-${Date.now()}`,
    alert_type: body.alert_type || 'api_failure',
    severity: body.severity || 'critical',
    service: body.service || 'demo-api',
    host: body.host || 'localhost',
    metric_value: body.metric_value != null ? Number(body.metric_value) : 500,
    threshold: body.threshold != null ? Number(body.threshold) : 200,
    timestamp: ts,
    processed: false,
    webhook_received: true,
    demo_target: 'demo-api',
  };
}

/**
 * POST /api/webhooks/demo
 * Shared secret via x-webhook-secret (must match WEBHOOK_SHARED_SECRET).
 */
router.post('/demo', async (req, res) => {
  try {
    const expected = env.demoSandbox.webhookSharedSecret;
    if (!expected || !String(expected).trim()) {
      logger.warn('[webhooks/demo] WEBHOOK_SHARED_SECRET is not configured');
      return res.status(503).json({ error: 'Demo webhook is not configured (WEBHOOK_SHARED_SECRET)' });
    }

    const provided = req.get('x-webhook-secret') || '';
    if (!timingSafeEqualString(provided, expected)) {
      logger.warn('[webhooks/demo] Invalid or missing x-webhook-secret');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const rawAlert = normalizeDemoWebhookBody(req.body || {});

    await AlertModel.create(rawAlert).catch(() => {});

    const io = req.app.get('io');
    const result = await processAlert(rawAlert, io);

    return res.status(201).json({
      message: 'Demo webhook ingested; pipeline triggered',
      alert_id: rawAlert.alert_id,
      pipeline_result: result,
    });
  } catch (err) {
    logger.error(`POST /api/webhooks/demo error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
