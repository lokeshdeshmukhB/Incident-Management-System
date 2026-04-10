from datetime import datetime, timezone

from incident_management.agents.base_agent import BaseAgent

SYSTEM_PROMPT = """You are the Detection Agent in an automated incident management system.

Your job is to analyze incoming infrastructure alerts and produce a structured, enriched incident object.

INPUT FORMAT (JSON):
{
  "alert_id": "string",
  "timestamp": "ISO 8601 string",
  "alert_type": "string (any alert type from the monitoring source — not limited to a fixed enum)",
  "severity": "one of: critical | high | medium | low",
  "service": "microservice or component name",
  "host": "hostname",
  "metric_value": "current metric reading (number; may be 0)",
  "threshold": "configured threshold (number; may be 0)"
}

YOUR TASKS:
1. If all required fields above are present in the input, you MUST set "valid": true. Only set "valid": false when a required field is actually missing or empty in the input (do not reject unknown alert_type values).
2. Enrich the alert with a human-readable description of what is happening.
3. Assess the confidence score (0.0 to 1.0) that this is a genuine incident vs a false positive.
4. Determine if this alert is a duplicate of a recent alert (same type + service within last 60 seconds).
5. Classify the urgency: IMMEDIATE (critical/high) or DEFERRED (medium/low).

OUTPUT FORMAT (JSON only, no preamble):
{
  "valid": true | false,
  "alert_id": "<echo back the exact alert_id from the input, do NOT generate a new one>",
  "alert_type": "<echo or normalize the input alert_type>",
  "severity": "<severity>",
  "service": "<service>",
  "host": "<host>",
  "description": "<1-2 sentence human-readable explanation>",
  "confidence": 0.0-1.0,
  "is_duplicate": true | false,
  "urgency": "IMMEDIATE" | "DEFERRED",
  "enriched_at": "<ISO timestamp>"
}

RULES:
- Do not invent alert_id, timestamp, or metric values; use the input. You may restate alert_type/severity/service/host from the input.
- Confidence < 0.6 means flag for human review but still proceed with valid: true if the input row is complete.
- IMPORTANT: The alert_id in the output MUST match the alert_id field from the input exactly. Never generate or invent a new alert_id.
- Always output valid JSON. No markdown, no explanation text."""


def _raw_row_complete(raw: dict) -> bool:
    """Structured sources (e.g. CSV) that include all fields must always pass detection."""
    for key in ("alert_id", "timestamp", "alert_type", "severity", "service", "host"):
        val = raw.get(key)
        if val is None or (isinstance(val, str) and not str(val).strip()):
            return False
    if raw.get("metric_value") is None or raw.get("threshold") is None:
        return False
    return True


def _apply_structured_fallback(raw: dict, result: dict) -> dict:
    out = {**result}
    out["valid"] = True
    for key in ("alert_type", "severity", "service", "host"):
        if not out.get(key):
            out[key] = raw.get(key)
    if not out.get("description"):
        out["description"] = (
            f"{raw.get('alert_type')} on service {raw.get('service')} ({raw.get('severity')})"
        )
    if out.get("confidence") is None:
        out["confidence"] = 0.85
    if not out.get("enriched_at"):
        out["enriched_at"] = datetime.now(timezone.utc).isoformat()
    if "is_duplicate" not in out or out.get("is_duplicate") is None:
        out["is_duplicate"] = False
    if not out.get("urgency"):
        sev = str(raw.get("severity", "")).lower()
        out["urgency"] = "IMMEDIATE" if sev in ("critical", "high") else "DEFERRED"
    return out


class DetectionAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__("detection", SYSTEM_PROMPT)

    def run(self, raw_alert: dict) -> dict:
        payload = {
            "alert_id": raw_alert.get("alert_id"),
            "timestamp": raw_alert.get("timestamp"),
            "alert_type": raw_alert.get("alert_type"),
            "severity": raw_alert.get("severity"),
            "service": raw_alert.get("service"),
            "host": raw_alert.get("host"),
            "metric_value": raw_alert.get("metric_value"),
            "threshold": raw_alert.get("threshold"),
        }
        result = BaseAgent.run(self, payload)
        # Hard-enforce: always echo the original alert_id regardless of what the LLM returns
        if raw_alert.get("alert_id"):
            result["alert_id"] = raw_alert["alert_id"]

        if result.get("error"):
            return result

        if _raw_row_complete(raw_alert):
            result = _apply_structured_fallback(raw_alert, result)

        return result


detection_agent = DetectionAgent()
