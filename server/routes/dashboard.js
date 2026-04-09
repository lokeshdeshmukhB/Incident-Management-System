const express = require('express');
const router = express.Router();
const IncidentModel = require('../models/Incident');
const logger = require('../services/logger');

router.get('/kpis', async (req, res) => {
  try {
    const kpis = await IncidentModel.getKPIs();
    res.json(kpis);
  } catch (err) {
    logger.error(`GET /api/dashboard/kpis error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.get('/timeline', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const data = await IncidentModel.getTimeline(days);

    const grouped = {};
    for (const incident of data) {
      const date = incident.started_at?.split('T')[0];
      if (!date) continue;
      if (!grouped[date]) {
        grouped[date] = { date, total: 0, resolved: 0, escalated: 0 };
      }
      grouped[date].total++;
      if (incident.status === 'resolved') grouped[date].resolved++;
      if (incident.status === 'escalated') grouped[date].escalated++;
    }

    res.json(Object.values(grouped).sort((a, b) => a.date.localeCompare(b.date)));
  } catch (err) {
    logger.error(`GET /api/dashboard/timeline error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.get('/agents', async (req, res) => {
  try {
    const { data: incidents } = await IncidentModel.findAll({ limit: 100 });

    const agentStats = {
      detection: { total_runs: 0, avg_duration_ms: 0 },
      decision: { total_runs: 0, avg_duration_ms: 0 },
      action: { total_runs: 0, avg_duration_ms: 0 },
      resolution: { total_runs: 0, avg_duration_ms: 0 },
      reporting: { total_runs: 0, avg_duration_ms: 0 },
      escalation: { total_runs: 0, avg_duration_ms: 0 },
    };

    for (const inc of incidents || []) {
      const outputs = inc.agent_outputs || {};
      for (const agentName of Object.keys(agentStats)) {
        if (outputs[agentName]) {
          agentStats[agentName].total_runs++;
          const dur = outputs[agentName]._meta?.duration_ms || 0;
          agentStats[agentName].avg_duration_ms += dur;
        }
      }
    }

    for (const name of Object.keys(agentStats)) {
      const s = agentStats[name];
      s.avg_duration_ms = s.total_runs > 0 ? Math.round(s.avg_duration_ms / s.total_runs) : 0;
    }

    res.json(agentStats);
  } catch (err) {
    logger.error(`GET /api/dashboard/agents error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
