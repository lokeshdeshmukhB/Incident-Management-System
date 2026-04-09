const fs = require('fs');
const path = require('path');
const { parseAlerts } = require('../services/csvParser');
const AlertModel = require('../models/Alert');
const { processAlert } = require('../engine/incidentPipeline');
const logger = require('../services/logger');
const env = require('../config/env');

const processedAlertIds = new Set();
let isPolling = false;

async function pollAlerts(io) {
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
      if (!alert.alert_id || processedAlertIds.has(alert.alert_id)) continue;

      const existing = await AlertModel.findByAlertId(alert.alert_id).catch(() => null);
      if (existing?.processed) {
        processedAlertIds.add(alert.alert_id);
        continue;
      }

      processedAlertIds.add(alert.alert_id);
      logger.info(`[AlertJob] Processing new alert: ${alert.alert_id} (${alert.alert_type})`);

      if (!existing) {
        await AlertModel.create({
          alert_id: alert.alert_id,
          alert_type: alert.alert_type,
          severity: alert.severity,
          service: alert.service,
          host: alert.host,
          metric_value: alert.metric_value,
          threshold: alert.threshold,
          timestamp: alert.timestamp,
          processed: false,
        }).catch(() => {});
      }

      processAlert(alert, io).catch((err) => {
        logger.error(`[AlertJob] Pipeline error for ${alert.alert_id}: ${err.message}`);
      });
    }
  } catch (err) {
    logger.error(`[AlertJob] Polling error: ${err.message}`);
  } finally {
    isPolling = false;
  }
}

function startAlertPolling(io) {
  const intervalMs = env.polling.alertPollIntervalMs;
  logger.info(`[AlertJob] Starting CSV alert polling every ${intervalMs / 1000}s`);

  pollAlerts(io);

  setInterval(() => pollAlerts(io), intervalMs);
}

module.exports = { startAlertPolling, pollAlerts };
