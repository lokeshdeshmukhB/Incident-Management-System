const fs = require('fs');
const path = require('path');
const { parseAlerts } = require('../services/csvParser');
const AlertModel = require('../models/Alert');
const { processAlert } = require('../engine/incidentPipeline');
const logger = require('../services/logger');
const env = require('../config/env');

let isPolling = false;

/** FIFO queue; pipeline runs here so CSV polls are not blocked. */
const alertQueue = [];
/**
 * Alert IDs queued or currently inside processAlert.
 * Checked FIRST (before any Supabase call) so that a Supabase outage during a
 * subsequent poll does not cause "fetch failed" errors for alerts already queued.
 */
const inFlightAlertIds = new Set();
let drainRunning = false;

async function drainAlertQueue(io) {
  if (drainRunning) return;
  drainRunning = true;
  logger.debug('[AlertJob] Drain started');

  try {
    while (alertQueue.length > 0) {
      const alert = alertQueue.shift();
      try {
        logger.info(`[AlertJob] Processing alert: ${alert.alert_id} (${alert.alert_type})`);
        await processAlert(alert, io);
      } catch (err) {
        logger.error(`[AlertJob] Pipeline error for ${alert.alert_id}: ${err.message}`);
      } finally {
        inFlightAlertIds.delete(alert.alert_id);
      }
    }
  } finally {
    drainRunning = false;
    logger.debug('[AlertJob] Drain finished');
  }
}

async function pollAlerts(io) {
  // If drain has items but isn't running (it finished and more items arrived), restart it.
  if (alertQueue.length > 0 && !drainRunning) {
    void drainAlertQueue(io);
  }

  if (isPolling) return;
  isPolling = true;

  try {
    const csvPath = path.resolve(__dirname, '../../data/alerts.csv');
    if (!fs.existsSync(csvPath)) {
      logger.debug('[AlertJob] No alerts.csv found, skipping poll');
      return;
    }

    const alerts = await parseAlerts(csvPath);

    for (const alert of alerts) {
      if (!alert.alert_id) continue;

      // ── Check in-flight FIRST (no Supabase call needed) ──
      if (inFlightAlertIds.has(alert.alert_id)) continue;

      // ── Only query Supabase for alerts not already tracked ──
      let existing = null;
      try {
        existing = await AlertModel.findByAlertId(alert.alert_id);
      } catch (dbErr) {
        logger.warn(`[AlertJob] DB check failed for ${alert.alert_id}: ${dbErr.message} — will retry next poll`);
        continue;
      }

      if (existing?.processed) continue;

      // ── Register + upsert before queuing ──
      try {
        await AlertModel.upsertByAlertId({
          alert_id: alert.alert_id,
          alert_type: alert.alert_type,
          severity: alert.severity,
          service: alert.service,
          host: alert.host,
          metric_value: alert.metric_value,
          threshold: alert.threshold,
          timestamp: alert.timestamp,
          processed: false,
        });
      } catch (dbErr) {
        logger.warn(`[AlertJob] DB upsert failed for ${alert.alert_id}: ${dbErr.message} — skipping`);
        continue;
      }

      inFlightAlertIds.add(alert.alert_id);
      alertQueue.push(alert);
      logger.info(`[AlertJob] Queued alert: ${alert.alert_id} (${alert.alert_type})`);
    }
  } catch (err) {
    logger.error(`[AlertJob] Polling error: ${err.message}`);
  } finally {
    isPolling = false;
  }

  // Kick off drain if there are items (safe to call even if already running).
  if (alertQueue.length > 0) {
    void drainAlertQueue(io);
  }
}

function startAlertPolling(io) {
  const intervalMs = env.polling.alertPollIntervalMs;
  logger.info(`[AlertJob] Starting CSV alert polling every ${intervalMs / 1000}s`);

  pollAlerts(io);

  setInterval(() => pollAlerts(io), intervalMs);
}

module.exports = { startAlertPolling, pollAlerts };
