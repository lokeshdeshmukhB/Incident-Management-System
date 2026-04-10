const WorkflowRuleModel = require('../models/WorkflowRule');
const { parseWorkflows } = require('../services/csvParser');
const logger = require('../services/logger');

function normalizeWorkflowRow(row) {
  if (!row || !row.alert_type) return null;
  return {
    alert_type: row.alert_type,
    action: row.action,
    priority: row.priority ?? 1,
    max_retries: row.max_retries ?? 2,
    escalation_after: row.escalation_after ?? 3,
    dry_run: row.dry_run === true,
    notify_channel: row.notify_channel || '#ops-alerts',
  };
}

class WorkflowEngine {
  constructor() {
    this.cachedRules = null;
    this.cacheExpiry = 0;
  }

  async getRules() {
    if (this.cachedRules && Date.now() < this.cacheExpiry) {
      return this.cachedRules;
    }
    let rules = await WorkflowRuleModel.findAll();
    if (!rules.length) {
      const csvRows = await parseWorkflows();
      rules = csvRows.map(normalizeWorkflowRow).filter(Boolean);
      if (rules.length) {
        logger.info(`[WorkflowEngine] Loaded ${rules.length} workflow rules from data/workflows.csv (DB empty)`);
      }
    }
    this.cachedRules = rules;
    this.cacheExpiry = Date.now() + 30000;
    return this.cachedRules;
  }

  async matchRule(alertType) {
    const rules = await this.getRules();
    const match = rules.find((r) => r.alert_type === alertType);

    if (match) {
      logger.info(`[WorkflowEngine] Matched rule for ${alertType}: action=${match.action}`);
      return match;
    }

    logger.warn(`[WorkflowEngine] No exact rule for ${alertType}, returning default escalation`);
    return {
      alert_type: alertType,
      action: 'escalate_to_human',
      priority: 0,
      max_retries: 0,
      escalation_after: 0,
      dry_run: false,
      notify_channel: '#oncall',
    };
  }

  invalidateCache() {
    this.cachedRules = null;
    this.cacheExpiry = 0;
  }
}

module.exports = new WorkflowEngine();
