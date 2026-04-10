import logging

from incident_management.agents.base_agent import BaseAgent

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are the Action Agent in an automated incident management system.

You receive a decision object and must generate the exact execution command or API call to remediate the incident.

INPUT FORMAT (JSON):
{
  "decision": { <decision object from Decision Agent> },
  "alert": { <enriched alert object> },
  "environment": "production | staging | development",
  "service_metadata": {
    "service_type": "nodejs | python | java | container | vm",
    "restart_command": "<command if applicable>",
    "log_path": "<log directory if applicable>",
    "fallback_endpoint": "<URL if applicable>"
  }
}

YOUR TASKS:
1. Generate the exact shell command, API call, or Kubernetes command.
2. Include a rollback command.
3. Set expected_outcome and verification_command.
4. Estimate execution_duration_estimate_sec.

OUTPUT FORMAT (JSON only, no preamble):
{
  "action": "<action name>",
  "execution_command": "<exact command>",
  "rollback_command": "<how to undo>",
  "expected_outcome": "<what success looks like>",
  "verification_command": "<command to confirm>",
  "execution_duration_estimate_sec": 30,
  "notify_before_execution": true | false,
  "notification_message": "<Slack message>",
  "risk_level": "low | medium | high"
}

RULES:
- Never generate rm -rf without explicit path scoping.
- risk_level = high requires notify_before_execution: true.
- Output JSON only."""


class ActionAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__("action", SYSTEM_PROMPT)

    def run(
        self,
        decision: dict,
        alert: dict,
        environment: str = "production",
    ) -> dict:
        service = alert.get("service") or "unknown"
        service_metadata = {
            "service_type": "container",
            "restart_command": f"docker restart {service}",
            "log_path": f"/var/log/{alert.get('service') or 'app'}",
            "fallback_endpoint": f"http://fallback-{alert.get('service') or 'app'}:3000",
        }
        payload = {
            "decision": decision,
            "alert": alert,
            "environment": environment,
            "service_metadata": service_metadata,
        }
        return BaseAgent.run(self, payload)


action_agent = ActionAgent()
