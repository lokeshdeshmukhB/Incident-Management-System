const BaseAgent = require('./BaseAgent');

const SYSTEM_PROMPT = `You are the Resolution Agent in an automated incident management system.

You receive the result of an executed action and must determine whether the incident is truly resolved.

INPUT FORMAT (JSON):
{
  "incident_id": "INC-xxx",
  "action_result": {
    "executed": true | false,
    "success": true | false,
    "output_log": "<execution output>",
    "duration_ms": 1200,
    "error": null | "<error message>"
  },
  "post_action_health": {
    "service_responsive": true | false,
    "metric_current_value": 65.2,
    "metric_threshold": 90,
    "health_check_passed": true | false
  },
  "retry_count": 1,
  "max_retries": 2
}

YOUR TASKS:
1. Determine if the incident is resolved based on health check data.
2. If not resolved and retry_count < max_retries, recommend retrying.
3. If not resolved and retry_count >= max_retries, mark as escalated.
4. Generate a brief resolution summary.

OUTPUT FORMAT (JSON only, no preamble):
{
  "status": "resolved" | "retry" | "escalated",
  "resolution_confirmed": true | false,
  "resolution_summary": "<1-2 sentence summary of outcome>",
  "resolved_at": "<ISO timestamp or null>",
  "retry_recommended": true | false,
  "escalation_required": true | false,
  "next_action": "<what should happen next>"
}

RULES:
- status = "resolved" only if health_check_passed = true AND metric below threshold.
- Always output JSON only.`;

class ResolutionAgent extends BaseAgent {
  constructor() {
    super('resolution', SYSTEM_PROMPT);
  }

  async run({ incidentId, actionResult, postActionHealth, retryCount = 0, maxRetries = 2 }) {
    const input = {
      incident_id: incidentId,
      action_result: {
        executed: actionResult.executed ?? true,
        success: actionResult.success ?? false,
        output_log: actionResult.output_log || 'Action executed',
        duration_ms: actionResult.duration_ms || 0,
        error: actionResult.error || null,
      },
      post_action_health: postActionHealth || {
        service_responsive: true,
        metric_current_value: 45,
        metric_threshold: 90,
        health_check_passed: true,
      },
      retry_count: retryCount,
      max_retries: maxRetries,
    };

    return super.run(input);
  }
}

module.exports = new ResolutionAgent();
