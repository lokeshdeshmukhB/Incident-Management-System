import os
from pathlib import Path

from dotenv import load_dotenv

_root = Path(__file__).resolve().parents[2]
load_dotenv(_root / "server" / ".env")
load_dotenv(_root / ".env")

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
_keys = [
    os.getenv("GROQ_API_KEY_1"),
    os.getenv("GROQ_API_KEY_2"),
    os.getenv("GROQ_API_KEY_3"),
]
GROQ_KEYS = [k for k in _keys if k]
if not GROQ_KEYS and GROQ_API_KEY:
    GROQ_KEYS = [GROQ_API_KEY]

MODEL_NAME = os.getenv("GROQ_MODEL") or "llama-3.3-70b-versatile"
MAX_RETRIES = int(os.getenv("AGENT_MAX_RETRIES", "2"))

AGENT_KEY_MAP = {
    "detection": 0,
    "resolution": 0,
    "decision": 1,
    "reporting": 1,
    "action": 2,
    "escalation": 2,
}
