const express = require('express');
const router = express.Router();
const AlertModel = require('../models/Alert');
const { processAlert } = require('../engine/incidentPipeline');
const logger = require('../services/logger');

router.post('/', async (req, res) => {
  try {
    const rawAlert = req.body;

    if (!rawAlert.alert_type || !rawAlert.severity || !rawAlert.service) {
      return res.status(400).json({ error: 'Missing required fields: alert_type, severity, service' });
    }

    const alertRecord = {
      alert_id: rawAlert.alert_id || `ALT-${Date.now()}`,
      alert_type: rawAlert.alert_type,
      severity: rawAlert.severity,
      service: rawAlert.service,
      host: rawAlert.host || 'unknown',
      metric_value: rawAlert.metric_value || 0,
      threshold: rawAlert.threshold || 0,
      timestamp: rawAlert.timestamp || new Date().toISOString(),
      processed: false,
    };

    await AlertModel.create(alertRecord).catch(() => {});

    const io = req.app.get('io');
    const result = await processAlert(alertRecord, io);

    res.status(201).json({
      message: 'Alert ingested and pipeline triggered',
      alert_id: alertRecord.alert_id,
      pipeline_result: result,
    });
  } catch (err) {
    logger.error(`POST /api/alerts error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { severity, service, alert_type, limit, offset } = req.query;
    const result = await AlertModel.findAll({
      severity,
      service,
      alertType: alert_type,
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0,
    });
    res.json(result);
  } catch (err) {
    logger.error(`GET /api/alerts error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const alert = await AlertModel.findByAlertId(req.params.id);
    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    res.json(alert);
  } catch (err) {
    logger.error(`GET /api/alerts/:id error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
