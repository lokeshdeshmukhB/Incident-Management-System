"""Stdin/stdout JSON bridge for Node.js: python -m incident_management.bridge"""

from __future__ import annotations

import json
import logging
import sys
import traceback

from incident_management.agents.action_agent import action_agent
from incident_management.agents.decision_agent import decision_agent
from incident_management.agents.detection_agent import detection_agent
from incident_management.agents.escalation_agent import escalation_agent
from incident_management.agents.reporting_agent import reporting_agent
from incident_management.agents.resolution_agent import resolution_agent

logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger(__name__)


def _decision_args(args: dict) -> dict:
    return {
        "alert": args.get("alert"),
        "workflow_rules": args.get("workflowRules") or args.get("workflow_rules") or [],
        "current_retry_count": args.get("currentRetryCount", args.get("current_retry_count", 0)),
        "recent_incidents": args.get("recentIncidents") or args.get("recent_incidents") or [],
    }


def _resolution_args(args: dict) -> dict:
    return {
        "incident_id": args.get("incidentId") or args.get("incident_id"),
        "action_result": args.get("actionResult") or args.get("action_result") or {},
        "post_action_health": args.get("postActionHealth") or args.get("post_action_health"),
        "retry_count": args.get("retryCount", args.get("retry_count", 0)),
        "max_retries": args.get("maxRetries", args.get("max_retries", 2)),
    }


def _escalation_args(args: dict) -> dict:
    return {
        "incident_id": args.get("incidentId") or args.get("incident_id"),
        "alert": args.get("alert"),
        "failed_actions": args.get("failedActions") or args.get("failed_actions") or [],
        "retry_count": args.get("retryCount", args.get("retry_count", 0)),
        "severity": args.get("severity", "high"),
        "service": args.get("service", "unknown"),
        "reason": args.get("reason") or "Automated remediation failed after maximum retries",
    }


def _reporting_args(args: dict) -> dict:
    return {
        "incident_id": args.get("incidentId") or args.get("incident_id"),
        "alert": args.get("alert"),
        "detection": args.get("detection"),
        "decision": args.get("decision"),
        "action": args.get("action"),
        "resolution": args.get("resolution"),
        "timeline": args.get("timeline") or [],
        "mttd_sec": args.get("mttdSec", args.get("mttd_sec", 0)),
        "mttr_sec": args.get("mttrSec", args.get("mttr_sec", 0)),
    }


def dispatch(agent: str, args: dict) -> dict:
    if agent == "detection":
        return detection_agent.run(args)
    if agent == "decision":
        p = _decision_args(args)
        return decision_agent.run(**p)
    if agent == "action":
        return action_agent.run(
            decision=args["decision"],
            alert=args["alert"],
            environment=args.get("environment", "production"),
        )
    if agent == "resolution":
        p = _resolution_args(args)
        return resolution_agent.run(**p)
    if agent == "escalation":
        p = _escalation_args(args)
        return escalation_agent.run(**p)
    if agent == "reporting":
        p = _reporting_args(args)
        return reporting_agent.run(**p)
    raise ValueError(f"Unknown agent: {agent}")


def main() -> None:
    try:
        raw = sys.stdin.read()
        req = json.loads(raw)
        agent = req.get("agent")
        args = req.get("args") or {}
        if not agent:
            raise ValueError("Missing 'agent'")
        out = dispatch(agent, args)
        sys.stdout.write(json.dumps(out))
    except Exception as e:
        err = {"error": True, "message": str(e), "traceback": traceback.format_exc()}
        sys.stdout.write(json.dumps(err))
        sys.exit(1)


if __name__ == "__main__":
    main()
