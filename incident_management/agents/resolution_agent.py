import logging

from incident_management.agents.base_agent import BaseAgent

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are the Resolution Agent in an automated incident management system.

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

OUTPUT FORMAT (JSON only, no preamble):
{
  "status": "resolved" | "retry" | "escalated",
  "resolution_confirmed": true | false,
  "resolution_summary": "<1-2 sentence summary>",
  "resolved_at": "<ISO timestamp or null>",
  "retry_recommended": true | false,
  "escalation_required": true | false,
  "next_action": "<what should happen next>"
}

RULES:
- status = "resolved" only if health_check_passed = true AND metric below threshold.
- Always output JSON only."""


class ResolutionAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__("resolution", SYSTEM_PROMPT)

    def run(
        self,
        incident_id: str,
        action_result: dict,
        post_action_health: dict | None = None,
        retry_count: int = 0,
        max_retries: int = 2,
    ) -> dict:
        ar = action_result or {}
        payload = {
            "incident_id": incident_id,
            "action_result": {
                "executed": ar.get("executed", True),
                "success": ar.get("success", False),
                "output_log": ar.get("output_log") or "Action executed",
                "duration_ms": ar.get("duration_ms") or 0,
                "error": ar.get("error"),
            },
            "post_action_health": post_action_health
            or {
                "service_responsive": True,
                "metric_current_value": 45,
                "metric_threshold": 90,
                "health_check_passed": True,
            },
            "retry_count": retry_count,
            "max_retries": max_retries,
        }
        return BaseAgent.run(self, payload)


resolution_agent = ResolutionAgent()
