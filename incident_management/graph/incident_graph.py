import logging
import uuid
from datetime import datetime, timezone
from typing import Annotated, TypedDict

import operator
from langgraph.graph import END, StateGraph

from incident_management.agents.action_agent import action_agent
from incident_management.agents.decision_agent import decision_agent
from incident_management.agents.detection_agent import detection_agent
from incident_management.agents.escalation_agent import escalation_agent
from incident_management.agents.reporting_agent import reporting_agent
from incident_management.agents.resolution_agent import resolution_agent

logger = logging.getLogger(__name__)


class IncidentState(TypedDict, total=False):
    raw_alert: dict
    detection: dict
    decision: dict
    action: dict
    resolution: dict
    escalation: dict
    report: dict
    retry_count: int
    incident_id: str
    timeline: Annotated[list, operator.add]
    workflow_rules: list


def _ts_event(message: str) -> dict:
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event": message,
    }


def detect_node(state: IncidentState) -> dict:
    raw = state["raw_alert"]
    detection = detection_agent.run(raw)
    ev = _ts_event("Detection completed")
    if detection.get("error") or not detection.get("valid"):
        return {"detection": detection, "timeline": [ev]}
    if detection.get("is_duplicate"):
        return {"detection": detection, "timeline": [ev, _ts_event("Duplicate alert suppressed")]}
    iid = f"INC-{uuid.uuid4().hex[:8].upper()}"
    return {
        "detection": detection,
        "incident_id": iid,
        "timeline": [ev, _ts_event(f"Incident created: {iid}")],
    }


def route_after_detect(state: IncidentState) -> str:
    d = state.get("detection") or {}
    if d.get("error") or not d.get("valid"):
        return END
    if d.get("is_duplicate"):
        return END
    return "decide"


def decide_node(state: IncidentState) -> dict:
    d = state["detection"]
    rules = state.get("workflow_rules") or []
    decision = decision_agent.run(
        alert=d,
        workflow_rules=rules,
        current_retry_count=state.get("retry_count", 0),
        recent_incidents=[],
    )
    return {
        "decision": decision,
        "timeline": [_ts_event("Decision phase completed")],
    }


def act_node(state: IncidentState) -> dict:
    decision = state["decision"]
    detection = state["detection"]
    if not decision.get("safe_to_execute") or decision.get("escalate"):
        return {
            "action": {
                "executed": False,
                "success": False,
                "output_log": "Action skipped — escalation required",
            },
            "timeline": [_ts_event("Action skipped")],
        }
    plan = action_agent.run(decision=decision, alert=detection)
    return {
        "action": plan,
        "timeline": [_ts_event(f"Action plan: {plan.get('execution_command', decision.get('action'))}")],
    }


def resolve_node(state: IncidentState) -> dict:
    incident_id = state.get("incident_id") or "INC-UNKNOWN"
    action = state.get("action") or {}
    if action.get("executed") is False and action.get("success") is False and "execution_command" not in action:
        execution = {"executed": False, "success": False, "output_log": action.get("output_log", ""), "duration_ms": 0}
    else:
        execution = {
            "executed": True,
            "success": True,
            "output_log": action.get("execution_command") or action.get("output_log") or "simulated",
            "duration_ms": 500,
            "error": None,
        }
    health = {
        "service_responsive": True,
        "metric_current_value": 42.0,
        "metric_threshold": 90.0,
        "health_check_passed": True,
    }
    resolution = resolution_agent.run(
        incident_id=incident_id,
        action_result=execution,
        post_action_health=health,
        retry_count=state.get("retry_count", 0),
        max_retries=2,
    )
    return {
        "resolution": resolution,
        "timeline": [_ts_event(f"Resolution: {resolution.get('status')}")],
    }


def route_after_resolution(state: IncidentState) -> str:
    status = (state.get("resolution") or {}).get("status")
    rc = state.get("retry_count", 0)
    if status == "resolved":
        return "report"
    if status == "retry" and rc < 2:
        return "prepare_retry"
    return "escalate"


def prepare_retry_node(state: IncidentState) -> dict:
    return {
        "retry_count": state.get("retry_count", 0) + 1,
        "timeline": [_ts_event(f"Retry {state.get('retry_count', 0) + 1}")],
    }


def escalate_node(state: IncidentState) -> dict:
    incident_id = state.get("incident_id") or "INC-UNKNOWN"
    detection = state.get("detection") or {}
    decision = state.get("decision") or {}
    esc = escalation_agent.run(
        incident_id=incident_id,
        alert=detection,
        failed_actions=[decision.get("action", "unknown")],
        retry_count=state.get("retry_count", 0),
        severity=detection.get("severity", "high"),
        service=detection.get("service", "unknown"),
        reason=(state.get("resolution") or {}).get("resolution_summary")
        or "Automated remediation failed",
    )
    return {"escalation": esc, "timeline": [_ts_event("Escalation triggered")]}


def report_node(state: IncidentState) -> dict:
    incident_id = state.get("incident_id") or "INC-UNKNOWN"
    report = reporting_agent.run(
        incident_id=incident_id,
        alert=state.get("raw_alert"),
        detection=state.get("detection"),
        decision=state.get("decision"),
        action=state.get("action"),
        resolution=state.get("resolution"),
        timeline=state.get("timeline") or [],
        mttd_sec=12,
        mttr_sec=45,
    )
    return {"report": report, "timeline": [_ts_event("Report generated")]}


def build_graph():
    g = StateGraph(IncidentState)
    g.add_node("detect", detect_node)
    g.add_node("decide", decide_node)
    g.add_node("act", act_node)
    g.add_node("resolve", resolve_node)
    g.add_node("prepare_retry", prepare_retry_node)
    g.add_node("escalate", escalate_node)
    g.add_node("report", report_node)

    g.set_entry_point("detect")
    g.add_conditional_edges("detect", route_after_detect, {"decide": "decide", END: END})
    g.add_edge("decide", "act")
    g.add_edge("act", "resolve")
    g.add_conditional_edges(
        "resolve",
        route_after_resolution,
        {"report": "report", "prepare_retry": "prepare_retry", "escalate": "escalate"},
    )
    g.add_edge("prepare_retry", "act")
    g.add_edge("escalate", "report")
    g.add_edge("report", END)
    return g.compile()
