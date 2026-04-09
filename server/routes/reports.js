const express = require('express');
const router = express.Router();
const ReportModel = require('../models/Report');
const IncidentModel = require('../models/Incident');
const reportingAgent = require('../agents/ReportingAgent');
const logger = require('../services/logger');

router.get('/', async (req, res) => {
  try {
    const { limit, offset } = req.query;
    const result = await ReportModel.findAll({
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0,
    });
    res.json(result);
  } catch (err) {
    logger.error(`GET /api/reports error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:incident_id', async (req, res) => {
  try {
    const report = await ReportModel.findByIncidentId(req.params.incident_id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json(report);
  } catch (err) {
    logger.error(`GET /api/reports/:id error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:incident_id/regenerate', async (req, res) => {
  try {
    const incident = await IncidentModel.findByIncidentId(req.params.incident_id);
    if (!incident) return res.status(404).json({ error: 'Incident not found' });

    const agentOutputs = incident.agent_outputs || {};

    const report = await reportingAgent.run({
      incidentId: incident.incident_id,
      alert: agentOutputs.detection || {},
      detection: agentOutputs.detection || {},
      decision: agentOutputs.decision || {},
      action: agentOutputs.action || {},
      resolution: agentOutputs.resolution || {},
      timeline: [],
      mttdSec: incident.mttd_sec || 0,
      mttrSec: incident.mttr_sec || 0,
    });

    if (report.error) {
      return res.status(500).json({ error: 'Report generation failed', details: report.message });
    }

    const saved = await ReportModel.upsertByIncidentId(incident.incident_id, {
      incident_id: incident.incident_id,
      title: report.title || `Incident ${incident.incident_id}`,
      summary: report.summary,
      timeline: report.timeline,
      root_cause: report.root_cause,
      action_taken: report.action_taken,
      resolution: report.resolution,
      metrics: report.metrics,
      recommendations: report.recommendations,
    });

    res.json({ message: 'Report regenerated', report: saved });
  } catch (err) {
    logger.error(`POST /api/reports/:id/regenerate error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
