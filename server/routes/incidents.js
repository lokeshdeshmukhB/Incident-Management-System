const express = require('express');
const router = express.Router();
const IncidentModel = require('../models/Incident');
const logger = require('../services/logger');

router.get('/', async (req, res) => {
  try {
    const { status, severity, service, limit, offset } = req.query;
    const result = await IncidentModel.findAll({
      status,
      severity,
      service,
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0,
    });
    res.json(result);
  } catch (err) {
    logger.error(`GET /api/incidents error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const incident = await IncidentModel.findByIncidentId(req.params.id);
    if (!incident) return res.status(404).json({ error: 'Incident not found' });
    res.json(incident);
  } catch (err) {
    logger.error(`GET /api/incidents/:id error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const allowedUpdates = ['status', 'action_taken', 'escalated', 'resolved_at'];
    const updates = {};
    for (const key of allowedUpdates) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    if (updates.status === 'resolved' && !updates.resolved_at) {
      updates.resolved_at = new Date().toISOString();
    }

    const incident = await IncidentModel.update(req.params.id, updates);
    if (!incident) return res.status(404).json({ error: 'Incident not found' });

    const io = req.app.get('io');
    if (io) io.emit('incident:updated', { incident_id: req.params.id, ...updates });

    res.json(incident);
  } catch (err) {
    logger.error(`PATCH /api/incidents/:id error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await IncidentModel.delete(req.params.id);
    res.json({ message: 'Incident archived' });
  } catch (err) {
    logger.error(`DELETE /api/incidents/:id error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
