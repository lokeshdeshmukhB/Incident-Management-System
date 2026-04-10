# Cursor Prompt: Convert MERN Agent System to Python LangGraph

## 🧠 Context

I have a **MERN-stack multi-agent incident management system** built in Node.js. It consists of 7 agent classes that form an automated pipeline to detect, decide, act, resolve, escalate, and report on infrastructure incidents. Each agent calls an LLM (Groq) with a structured system prompt and expects a strict JSON response.

I want you to **fully convert this entire system to Python using LangGraph** as the orchestration framework and **LangChain** for LLM integration.

---

## 📁 Files to Convert

| JS File | Role |
|---|---|
| `BaseAgent.js` | Abstract base class — handles LLM calls, retries, logging, metadata |
| `DetectionAgent.js` | Validates & enriches raw alert data |
| `DecisionAgent.js` | Matches alert to workflow rule, decides action |
| `ActionAgent.js` | Generates exact shell/API commands to execute |
| `ResolutionAgent.js` | Checks if action resolved the incident |
| `EscalationAgent.js` | Handles human escalation when automation fails |
| `ReportingAgent.js` | Generates final structured incident report |

---

## 🔁 Original Architecture (JS)

- All agents extend `BaseAgent`, which calls `callGroq(name, messages)` with a system prompt + JSON user input
- Each agent has a `run()` method that formats input, calls `super.run()`, and returns a JSON result
- `BaseAgent` handles **retry logic** (up to 2 retries with exponential backoff), **error handling**, and **metadata injection** (`_meta.agent`, `_meta.duration_ms`, `_meta.timestamp`)
- All agents are exported as **singletons** (e.g., `module.exports = new DecisionAgent()`)
- LLM responses are always **strict JSON** — no markdown, no preamble

---

## ✅ What I Want You to Build in Python

### 1. `base_agent.py` — Python equivalent of `BaseAgent.js`

- Create an abstract base class `BaseAgent` using Python's `abc` module
- Use `langchain_groq.ChatGroq` as the LLM (model: `llama3-70b-8192` or equivalent)
- Replicate retry logic: max 2 retries, sleep `1s * attempt` between retries using `time.sleep`
- Parse LLM response as JSON using `json.loads()` — strip markdown fences if present
- Inject `_meta` dict into every response: `{"agent": name, "duration_ms": ..., "timestamp": ...}`
- Use Python `logging` module (equivalent of the JS `logger`)
- Method signature: `def run(self, input_data: dict) -> dict`

---

### 2. `detection_agent.py` — Equivalent of `DetectionAgent.js`

**System Prompt (copy exactly):**
```
You are the Detection Agent in an automated incident management system.

Your job is to analyze incoming infrastructure alerts and produce a structured, enriched incident object.

INPUT FORMAT (JSON):
{
  "timestamp": "ISO 8601 string",
  "alert_type": "one of: high_cpu | disk_full | api_failure | service_down | memory_leak | network_timeout",
  "severity": "one of: critical | high | medium | low",
  "service": "microservice name",
  "host": "hostname",
  "metric_value": "current metric reading (number)",
  "threshold": "configured threshold (number)"
}

YOUR TASKS:
1. Validate the alert schema — if any required field is missing, flag it as INVALID and stop.
2. Enrich the alert with a human-readable description of what is happening.
3. Assess the confidence score (0.0 to 1.0) that this is a genuine incident vs a false positive.
4. Determine if this alert is a duplicate of a recent alert (same type + service within last 60 seconds).
5. Classify the urgency: IMMEDIATE (critical/high) or DEFERRED (medium/low).

OUTPUT FORMAT (JSON only, no preamble):
{
  "valid": true | false,
  "alert_id": "ALT-<timestamp-hash>",
  "alert_type": "<type>",
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
- Never guess missing values. If data is missing, set valid: false.
- Confidence < 0.6 means flag for human review but still proceed.
- Always output valid JSON. No markdown, no explanation text.
```

**`run()` method:** Accept `raw_alert: dict`, extract only the required fields, call `super().run()`

---

### 3. `decision_agent.py` — Equivalent of `DecisionAgent.js`

**System Prompt (copy exactly):**
```
You are the Decision Agent in an automated incident management system.

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
- Output JSON only. No commentary.
```

**`run()` method:** Accept `alert`, `workflow_rules: list`, `current_retry_count=0`, `recent_incidents=[]`. Map each rule to dict with keys: `alert_type, action, priority, max_retries, escalation_after, dry_run`.

---

### 4. `action_agent.py` — Equivalent of `ActionAgent.js`

**System Prompt (copy exactly):**
```
You are the Action Agent in an automated incident management system.

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
- Output JSON only.
```

**`run()` method:** Accept `decision`, `alert`, `environment="production"`. Auto-build `service_metadata` from alert data:
- `service_type = "container"`
- `restart_command = f"docker restart {alert.get('service', 'unknown')}"`
- `log_path = f"/var/log/{alert.get('service', 'app')}"`
- `fallback_endpoint = f"http://fallback-{alert.get('service', 'app')}:3000"`

---

### 5. `resolution_agent.py` — Equivalent of `ResolutionAgent.js`

**System Prompt (copy exactly):**
```
You are the Resolution Agent in an automated incident management system.

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
- Always output JSON only.
```

**`run()` method:** Accept `incident_id`, `action_result: dict`, `post_action_health: dict = None`, `retry_count=0`, `max_retries=2`. Use defaults for missing health data (same as JS version).

---

### 6. `escalation_agent.py` — Equivalent of `EscalationAgent.js`

**System Prompt (copy exactly):**
```
You are the Escalation Agent in an automated incident management system.

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
- Output JSON only.
```

**`run()` method:** Accept `incident_id`, `alert=None`, `failed_actions=[]`, `retry_count=0`, `severity="high"`, `service="unknown"`, `reason="Automated remediation failed after maximum retries"`. After calling super, log a warning: `ESCALATION: {title} → {priority}`.

---

### 7. `reporting_agent.py` — Equivalent of `ReportingAgent.js`

**System Prompt (copy exactly):**
```
You are the Reporting Agent in an automated incident management system.

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
- Output JSON only.
```

**`run()` method:** Accept all incident fields as kwargs.

---

## 🔗 LangGraph Orchestration — `incident_graph.py`

After creating the agents, wire them into a **LangGraph StateGraph**. The pipeline is:

```
detect → decide → act → resolve → (branch) → report
                                      ↓
                                  escalate → report
```

### Graph State Schema (`IncidentState`)

Create a TypedDict with these fields:
```python
{
  "raw_alert": dict,
  "detection": dict,
  "decision": dict,
  "action": dict,
  "resolution": dict,
  "escalation": dict,
  "report": dict,
  "retry_count": int,
  "incident_id": str,
  "timeline": list,
  "workflow_rules": list
}
```

### Graph Nodes

| Node Name | Agent Called | Input from State | Output to State |
|---|---|---|---|
| `detect` | DetectionAgent | `raw_alert` | `detection` |
| `decide` | DecisionAgent | `detection`, `workflow_rules`, `retry_count` | `decision` |
| `act` | ActionAgent | `decision`, `detection` | `action` |
| `resolve` | ResolutionAgent | `action`, `incident_id`, `retry_count` | `resolution` |
| `escalate` | EscalationAgent | `detection`, `decision`, `retry_count`, `incident_id` | `escalation` |
| `report` | ReportingAgent | all state fields | `report` |

### Conditional Edge (after `resolve` node)

```python
def route_after_resolution(state):
    status = state["resolution"].get("status")
    if status == "resolved":
        return "report"
    elif status == "retry" and state["retry_count"] < 2:
        return "act"  # retry
    else:
        return "escalate"
```

### Timeline Tracking

Each node should append to `state["timeline"]`:
```python
{"timestamp": datetime.utcnow().isoformat(), "event": "<description of what happened>"}
```

---

## 📦 Project Structure to Generate

```
incident_management/
├── agents/
│   ├── base_agent.py
│   ├── detection_agent.py
│   ├── decision_agent.py
│   ├── action_agent.py
│   ├── resolution_agent.py
│   ├── escalation_agent.py
│   └── reporting_agent.py
├── graph/
│   └── incident_graph.py
├── config/
│   └── settings.py          # GROQ_API_KEY from env, model name, max_retries
├── main.py                   # Entry point: accepts raw alert dict, runs graph, prints report
└── requirements.txt          # langchain, langgraph, langchain-groq, python-dotenv
```

---

## ⚙️ Configuration (`settings.py`)

```python
import os
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
MODEL_NAME = "llama3-70b-8192"
MAX_RETRIES = 2
```

---

## 🧪 `main.py` — Entry Point

Create a `main.py` that:
1. Takes a sample raw alert dict
2. Initializes the LangGraph with sample workflow rules
3. Runs the full pipeline
4. Pretty-prints the final incident report JSON

Sample input:
```python
raw_alert = {
    "timestamp": "2024-01-15T10:30:00Z",
    "alert_type": "high_cpu",
    "severity": "critical",
    "service": "payment-service",
    "host": "prod-server-01",
    "metric_value": 95.5,
    "threshold": 80
}
```

---

## 📋 requirements.txt

```
langchain>=0.2.0
langgraph>=0.1.0
langchain-groq>=0.1.0
python-dotenv>=1.0.0
```

---

## ⚠️ Important Notes for Cursor

1. **Do NOT use `async`** unless explicitly asked — keep everything synchronous for simplicity
2. All agents should be **singleton instances** at module level (mirroring `module.exports = new Agent()`)
3. Strip any markdown fences (` ```json `) from LLM responses before `json.loads()`
4. Use `logging.getLogger(__name__)` in each agent file
5. The LangGraph graph should be compiled and exported as a ready-to-invoke object
6. Keep system prompts **exactly as written above** — they are carefully engineered
7. Handle the case where LLM returns invalid JSON — log the error and return `{"error": True, "message": "..."}`
