import json
import logging
import time
from datetime import datetime, timezone

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_groq import ChatGroq

from incident_management.config.settings import AGENT_KEY_MAP, GROQ_KEYS, MAX_RETRIES, MODEL_NAME

logger = logging.getLogger(__name__)


def _strip_json_fences(text: str) -> str:
    text = text.strip()
    if not text.startswith("```"):
        return text
    lines = text.split("\n")
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines).strip()


def parse_llm_json(text: str) -> dict:
    cleaned = _strip_json_fences(text)
    return json.loads(cleaned)


def _is_rate_limit(err: Exception) -> bool:
    msg = str(err).lower()
    return "429" in msg or "rate_limit" in msg or "rate limit" in msg


class BaseAgent:
    max_retries = MAX_RETRIES

    def __init__(self, name: str, system_prompt: str) -> None:
        self.name = name
        self.system_prompt = system_prompt

    def _key_indices_for_agent(self) -> list[int]:
        if not GROQ_KEYS:
            return []
        start = AGENT_KEY_MAP.get(self.name, 0) % len(GROQ_KEYS)
        return [((start + i) % len(GROQ_KEYS)) for i in range(len(GROQ_KEYS))]

    def _invoke_llm(self, input_data: dict) -> dict:
        if not GROQ_KEYS:
            raise RuntimeError("No Groq API keys configured (GROQ_API_KEY_1 or GROQ_API_KEY)")

        messages = [
            SystemMessage(content=self.system_prompt),
            HumanMessage(content=json.dumps(input_data, indent=2)),
        ]
        last_error: Exception | None = None
        indices = self._key_indices_for_agent()

        for key_idx in indices:
            api_key = GROQ_KEYS[key_idx]
            llm = ChatGroq(
                api_key=api_key,
                model=MODEL_NAME,
                temperature=0.1,
                max_tokens=2048,
                model_kwargs={"response_format": {"type": "json_object"}},
            )
            try:
                resp = llm.invoke(messages)
                content = getattr(resp, "content", None) or ""
                if not str(content).strip():
                    raise ValueError("Empty response from Groq")
                logger.debug("[%s] Groq call succeeded (key %s)", self.name, key_idx + 1)
                return parse_llm_json(str(content))
            except Exception as err:
                last_error = err
                if _is_rate_limit(err):
                    logger.warning(
                        "[%s] Rate limited, rotating from key %s",
                        self.name,
                        key_idx + 1,
                    )
                    continue
                raise

        raise RuntimeError(
            f"All Groq keys exhausted for {self.name}: {last_error!s}"
        ) if last_error else RuntimeError(f"No Groq keys for {self.name}")

    def run(self, input_data: dict) -> dict:
        start = time.perf_counter()
        logger.info("[%s] Starting execution", self.name)
        last_error: Exception | None = None

        for attempt in range(1, self.max_retries + 1):
            try:
                result = self._invoke_llm(input_data)
                duration_ms = int((time.perf_counter() - start) * 1000)
                logger.info("[%s] Completed in %sms", self.name, duration_ms)
                meta = {
                    "agent": self.name,
                    "duration_ms": duration_ms,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
                return {**result, "_meta": meta}
            except Exception as err:
                last_error = err
                logger.error("[%s] Attempt %s failed: %s", self.name, attempt, err)
                if attempt < self.max_retries:
                    time.sleep(1 * attempt)

        duration_ms = int((time.perf_counter() - start) * 1000)
        logger.error("[%s] All attempts failed", self.name)
        return {
            "error": True,
            "message": str(last_error) if last_error else "Unknown error",
            "_meta": {
                "agent": self.name,
                "duration_ms": duration_ms,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        }
