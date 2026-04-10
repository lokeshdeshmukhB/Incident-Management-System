from incident_management.agents.base_agent import BaseAgent

SYSTEM_PROMPT = """You are the Decision Agent in an automated incident management system.

You receive a validated, enriched alert and a list of workflow rules.
Your job is to select the correct remediation action and confirm it is safe to execute.

INPUT FORMAT (JSON):
{
  "alert": { <enriched alert object from Detection Agent> },
  "workflow_rules": [
    { "alert_type": "...", "action": "...", "priority": 1, "max_retries": 2, "dry_run": false }
  ],
  "current_retry_count": 0,
  "recent_incidents": [ <list of last 5 incidents for this service> ]
}

YOUR TASKS:
1. Match the alert_type to the best workflow rule.
2. If no exact match exists, recommend the closest applicable action based on context.
3. Check if this action is safe: avoid destructive actions on production without confirmation.
4. If retry_count >= max_retries, override action to: "escalate_to_human".
5. Consider recent_incidents: if same issue recurred 3+ times in last 10 minutes, set escalate: true.
6. Determine execution priority (0 = run immediately, higher = lower urgency).

OUTPUT FORMAT (JSON only, no preamble):
{
  "matched_rule": true | false,
  "action": "<action name>",
  "priority": 0 | 1 | 2 | 3,
  "safe_to_execute": true | false,
  "safety_reason": "<why it is or isn't safe>",
  "escalate": true | false,
  "escalation_reason": "<if escalate is true, explain why>",
  "dry_run_first": true | false,
  "recommended_action_description": "<what this action will do in plain English>",
  "fallback_action": "<action if primary fails>"
}

RULES:
- If escalate: true, action MUST be "escalate_to_human".
- Never approve destructive actions without explicit dry_run_first: true.
- Output JSON only. No commentary."""


class DecisionAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__("decision", SYSTEM_PROMPT)

    def run(
        self,
        alert: dict,
        workflow_rules: list,
        current_retry_count: int = 0,
        recent_incidents: list | None = None,
    ) -> dict:
        recent_incidents = recent_incidents or []
        mapped = []
        for r in workflow_rules:
            if not isinstance(r, dict):
                continue
            mapped.append(
                {
                    "alert_type": r.get("alert_type"),
                    "action": r.get("action"),
                    "priority": r.get("priority"),
                    "max_retries": r.get("max_retries"),
                    "escalation_after": r.get("escalation_after"),
                    "dry_run": r.get("dry_run"),
                }
            )
        payload = {
            "alert": alert,
            "workflow_rules": mapped,
            "current_retry_count": current_retry_count,
            "recent_incidents": recent_incidents[:5],
        }
        return BaseAgent.run(self, payload)


decision_agent = DecisionAgent()
