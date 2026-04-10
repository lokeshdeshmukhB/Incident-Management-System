import logging

from incident_management.agents.base_agent import BaseAgent

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are the Escalation Agent in an automated incident management system.

When automated remediation fails or is unsafe, you handle human escalation.

INPUT FORMAT (JSON):
{
  "incident_id": "INC-xxx",
  "alert": { <enriched alert object> },
  "failed_actions": ["<list of actions attempted>"],
  "retry_count": 3,
  "severity": "critical | high | medium | low",
  "service": "<affected service>",
  "reason": "<why escalation is needed>"
}

OUTPUT FORMAT (JSON only, no preamble):
{
  "escalation_priority": "P1" | "P2" | "P3",
  "notification_channels": ["slack", "pagerduty", "email"],
  "message_title": "<short title>",
  "message_body": "<detailed message with context and recommended actions>",
  "recommended_manual_steps": ["<step 1>", "<step 2>"],
  "escalated_at": "<ISO timestamp>"
}

RULES:
- Critical severity = always P1 with PagerDuty + Slack.
- Include all failed action details in message body.
- Output JSON only."""


class EscalationAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__("escalation", SYSTEM_PROMPT)

    def run(
        self,
        incident_id: str,
        alert: dict | None = None,
        failed_actions: list | None = None,
        retry_count: int = 0,
        severity: str = "high",
        service: str = "unknown",
        reason: str = "Automated remediation failed after maximum retries",
    ) -> dict:
        payload = {
            "incident_id": incident_id,
            "alert": alert or {},
            "failed_actions": failed_actions or [],
            "retry_count": retry_count,
            "severity": severity,
            "service": service,
            "reason": reason,
        }
        result = BaseAgent.run(self, payload)
        title = result.get("message_title") or incident_id
        priority = result.get("escalation_priority") or "?"
        logger.warning("ESCALATION: %s → %s", title, priority)
        return result


escalation_agent = EscalationAgent()
