const WorkflowRuleModel = require('../models/WorkflowRule');
const logger = require('../services/logger');

class WorkflowEngine {
  constructor() {
    this.cachedRules = null;
    this.cacheExpiry = 0;
  }

  async getRules() {
    if (this.cachedRules && Date.now() < this.cacheExpiry) {
      return this.cachedRules;
    }
    this.cachedRules = await WorkflowRuleModel.findAll();
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
