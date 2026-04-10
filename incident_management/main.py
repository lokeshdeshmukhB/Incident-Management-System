"""Run the LangGraph pipeline with a sample alert (standalone demo)."""

from __future__ import annotations

import json
import logging

from incident_management.graph.incident_graph import build_graph

logging.basicConfig(level=logging.INFO)

SAMPLE_RULES = [
    {
        "alert_type": "high_cpu",
        "action": "restart_service",
        "priority": 1,
        "max_retries": 2,
        "escalation_after": 2,
        "dry_run": False,
    },
    {
        "alert_type": "service_down",
        "action": "escalate_to_human",
        "priority": 0,
        "max_retries": 0,
        "escalation_after": 0,
        "dry_run": False,
    },
]


def main() -> None:
    raw_alert = {
        "timestamp": "2024-01-15T10:30:00Z",
        "alert_type": "high_cpu",
        "severity": "critical",
        "service": "payment-service",
        "host": "prod-server-01",
        "metric_value": 95.5,
        "threshold": 80,
    }

    graph = build_graph()
    final_state = graph.invoke(
        {
            "raw_alert": raw_alert,
            "workflow_rules": SAMPLE_RULES,
            "retry_count": 0,
            "timeline": [],
        }
    )

    report = final_state.get("report") or {}
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
