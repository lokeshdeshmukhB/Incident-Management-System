const express = require('express');
const router = express.Router();
const WorkflowRuleModel = require('../models/WorkflowRule');
const workflowEngine = require('../engine/workflowEngine');
const { parseCSV } = require('../services/csvParser');
const logger = require('../services/logger');

router.get('/', async (req, res) => {
  try {
    const rules = await WorkflowRuleModel.findAll();
    res.json(rules);
  } catch (err) {
    logger.error(`GET /api/workflows error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { alert_type, action, priority, max_retries, escalation_after, dry_run, notify_channel } = req.body;

    if (!alert_type || !action) {
      return res.status(400).json({ error: 'Missing required fields: alert_type, action' });
    }

    const rule = await WorkflowRuleModel.create({
      alert_type,
      action,
      priority: priority ?? 1,
      max_retries: max_retries ?? 2,
      escalation_after: escalation_after ?? 3,
      dry_run: dry_run ?? false,
      notify_channel: notify_channel || '#ops-alerts',
    });

    workflowEngine.invalidateCache();
    res.status(201).json(rule);
  } catch (err) {
    logger.error(`POST /api/workflows error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const rule = await WorkflowRuleModel.update(req.params.id, req.body);
    workflowEngine.invalidateCache();
    res.json(rule);
  } catch (err) {
    logger.error(`PUT /api/workflows/:id error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await WorkflowRuleModel.delete(req.params.id);
    workflowEngine.invalidateCache();
    res.json({ message: 'Rule deleted' });
  } catch (err) {
    logger.error(`DELETE /api/workflows/:id error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.post('/import', async (req, res) => {
  try {
    const { file_path } = req.body;
    if (!file_path) {
      return res.status(400).json({ error: 'Missing file_path' });
    }

    const rows = await parseCSV(file_path);
    if (rows.length === 0) {
      return res.status(400).json({ error: 'No data in CSV file' });
    }

    const rules = await WorkflowRuleModel.bulkInsert(rows);
    workflowEngine.invalidateCache();
    res.status(201).json({ message: `Imported ${rules.length} rules`, rules });
  } catch (err) {
    logger.error(`POST /api/workflows/import error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
