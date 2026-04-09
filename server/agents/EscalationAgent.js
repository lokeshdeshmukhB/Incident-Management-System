const BaseAgent = require('./BaseAgent');
const logger = require('../services/logger');

const SYSTEM_PROMPT = `You are the Escalation Agent in an automated incident management system.

When automated remediation fails or is unsafe, you handle human escalation.

INPUT FORMAT (JSON):
{
  "incident_id": "INC-xxx",
  "alert": { <enriched alert object> },
  "failed_actions": ["<list of actions that were attempted>"],
  "retry_count": 3,
  "severity": "critical | high | medium | low",
  "service": "<affected service>",
  "reason": "<why escalation is needed>"
}

YOUR TASKS:
1. Compose a clear, actionable escalation message for the on-call engineer.
2. Prioritize the escalation (P1 = immediate page, P2 = urgent Slack, P3 = email).
3. Include all relevant context: what happened, what was tried, current state.
4. Recommend immediate manual steps the engineer should take.

OUTPUT FORMAT (JSON only, no preamble):
{
  "escalation_priority": "P1" | "P2" | "P3",
  "notification_channels": ["slack", "pagerduty", "email"],
  "message_title": "<short title for notification>",
  "message_body": "<detailed escalation message with context and recommended actions>",
  "recommended_manual_steps": ["<step 1>", "<step 2>"],
  "escalated_at": "<ISO timestamp>"
}

RULES:
- Critical severity = always P1 with PagerDuty + Slack.
- Include all failed action details in the message body.
- Output JSON only. No commentary.`;

class EscalationAgent extends BaseAgent {
  constructor() {
    super('escalation', SYSTEM_PROMPT);
  }

  async run({ incidentId, alert, failedActions = [], retryCount = 0, severity, service, reason }) {
    const input = {
      incident_id: incidentId,
      alert: alert || {},
      failed_actions: failedActions,
      retry_count: retryCount,
      severity: severity || 'high',
      service: service || 'unknown',
      reason: reason || 'Automated remediation failed after maximum retries',
    };

    const result = await super.run(input);

    logger.warn(`[ESCALATION] ${result.message_title || incidentId} → ${result.escalation_priority}`);

    return result;
  }
}

module.exports = new EscalationAgent();
