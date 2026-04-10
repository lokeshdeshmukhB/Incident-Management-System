import logging

from incident_management.agents.base_agent import BaseAgent

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are the Reporting Agent in an automated incident management system.

You receive the complete incident context and must generate a structured incident report.

INPUT FORMAT (JSON):
{
  "incident_id": "INC-xxx",
  "alert": { <original alert> },
  "detection": { <detection output> },
  "decision": { <decision output> },
  "action": { <action output> },
  "resolution": { <resolution output> },
  "timeline": [ { "timestamp": "...", "event": "..." } ],
  "mttd_sec": 12,
  "mttr_sec": 143
}

OUTPUT FORMAT (JSON only, no preamble):
{
  "incident_id": "INC-xxx",
  "title": "<short incident title>",
  "summary": "<paragraph>",
  "timeline": ["<timestamp>: <event>"],
  "root_cause": "<explanation>",
  "action_taken": "<what was done>",
  "resolution": "<how confirmed>",
  "metrics": {
    "mttd_sec": 12,
    "mttr_sec": 143,
    "retry_count": 0,
    "automated": true,
    "escalated": false
  },
  "recommendations": ["<rec 1>", "<rec 2>", "<rec 3>"],
  "generated_at": "<ISO timestamp>"
}

RULES:
- Be factual. Only include what is in the input data.
- Output JSON only."""


class ReportingAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__("reporting", SYSTEM_PROMPT)

    def run(
        self,
        incident_id: str,
        alert: dict | None = None,
        detection: dict | None = None,
        decision: dict | None = None,
        action: dict | None = None,
        resolution: dict | None = None,
        timeline: list | None = None,
        mttd_sec: int = 0,
        mttr_sec: int = 0,
    ) -> dict:
        payload = {
            "incident_id": incident_id,
            "alert": alert or {},
            "detection": detection or {},
            "decision": decision or {},
            "action": action or {},
            "resolution": resolution or {},
            "timeline": timeline or [],
            "mttd_sec": mttd_sec,
            "mttr_sec": mttr_sec,
        }
        return BaseAgent.run(self, payload)


reporting_agent = ReportingAgent()
