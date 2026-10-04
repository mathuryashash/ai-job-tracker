"""Tool-calling chat client for the agent.

* OpenAI-compatible chat-completions over HTTP (Groq, Gemini's OpenAI endpoint, NVIDIA NIM).
* Provider chain: Groq gpt-oss-120b (all Groq keys, rotated) -> NVIDIA NIM (only if NVIDIA_API_KEY is set)
  -> Gemini. A Groq *daily* token cap (TPD) or repeated 429s moves on to the next provider.
* Retries with exponential backoff on 429/5xx/timeouts.
* Every response is cached on disk (key = sha256 of model chain + messages + tools) so evals are
  reproducible and re-runs cost no tokens.
Keys are read from local env files into memory and never printed or logged.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import random
import re
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE_DIR = os.getenv("AGENT_LLM_CACHE", os.path.join(ROOT, ".agent", "llm_cache"))

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
NIM_URL = "https://integrate.api.nvidia.com/v1/chat/completions"

AGENT_MODEL = os.getenv("AGENT_MODEL", "openai/gpt-oss-120b")
GEMINI_MODEL = os.getenv("AGENT_GEMINI_MODEL", "gemini-3.5-flash-lite")
NIM_MODEL = os.getenv("AGENT_NIM_MODEL", "openai/gpt-oss-120b")


class LLMUnavailable(RuntimeError):
    """Every provider in the chain failed."""


# Only a *daily* cap retires a key for the run; per-minute 429s (incl. Gemini RESOURCE_EXHAUSTED) back off.
_DAILY_CAP = re.compile(r"per ?day|\bTPD\b|\bRPD\b|PerDay", re.I)


def _read_env_file(path: str) -> Dict[str, str]:
    d: Dict[str, str] = {}
    if path and os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                d[k.strip()] = v.strip().strip('"').strip("'")
    return d


def load_keys() -> Dict[str, List[str]]:
    """Collect keys from the process env, the repo's sandbox.env and AGENT_KEYS_ENV files."""
    files = [os.path.join(ROOT, ".hermes-qa", "sandbox.env"), os.path.join(ROOT, ".env")]
    files += [p for p in os.getenv("AGENT_KEYS_ENV", "").split(os.pathsep) if p]
    envs = [dict(os.environ)] + [_read_env_file(f) for f in files]
    keys: Dict[str, List[str]] = {"groq": [], "gemini": [], "nim": []}
    for e in envs:
        for prov, name in (("groq", "GROQ_API_KEY"), ("gemini", "GEMINI_API_KEY"), ("nim", "NVIDIA_API_KEY")):
            v = e.get(name)
            if v and not v.startswith("gsk_test") and v not in keys[prov]:
                keys[prov].append(v)
    return keys


@dataclass
class LLMResult:
    message: Dict[str, Any]           # OpenAI-format assistant message
    provider: str
    model: str
    usage: Dict[str, int] = field(default_factory=dict)
    cached: bool = False
    latency_s: float = 0.0


def _cache_key(model_tag: str, messages, tools, temperature) -> str:
    blob = json.dumps({"m": model_tag, "msgs": messages, "tools": tools, "t": temperature},
                      sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _for_provider(messages: List[Dict[str, Any]], prov: str) -> List[Dict[str, Any]]:
    """Gemini attaches `extra_content` (thought signatures) to tool calls; other providers reject
    unknown fields, so strip them when a conversation moves between providers."""
    if prov == "gemini":
        # Tool calls produced by another provider carry no thought signature; Gemini documents a
        # placeholder value for such injected/foreign function calls.
        out = []
        for m in messages:
            if m.get("tool_calls"):
                m = {**m, "tool_calls": [tc if tc.get("extra_content") else
                                         {**tc, "extra_content": {"google": {"thought_signature":
                                                                             "skip_thought_signature_validator"}}}
                                         for tc in m["tool_calls"]]}
            out.append(m)
        return out
    out = []
    for m in messages:
        if m.get("tool_calls"):
            m = {**m, "tool_calls": [{k: v for k, v in tc.items() if k != "extra_content"} for tc in m["tool_calls"]]}
        out.append(m)
    return out


class ChatClient:
    def __init__(self, keys: Optional[Dict[str, List[str]]] = None, cache_dir: str = CACHE_DIR,
                 use_cache: bool = True, max_retries: int = 6, base_delay: float = 2.0,
                 providers: Optional[List[str]] = None, timeout: int = 90):
        self.keys = keys if keys is not None else load_keys()
        self.cache_dir = cache_dir
        self.use_cache = use_cache
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.timeout = timeout
        self.providers = providers or [p for p in os.getenv("AGENT_PROVIDERS", "groq,nim,gemini").split(",") if p]
        self._exhausted: set = set()      # (provider, key-index) that hit a daily cap
        self._lock = threading.Lock()
        self.stats = {"calls": 0, "cache_hits": 0, "retries": 0, "fallbacks": 0}
        os.makedirs(cache_dir, exist_ok=True)

    # ------------------------------------------------------------------
    def _targets(self):
        for prov in self.providers:
            ks = self.keys.get(prov) or []
            url, model = {"groq": (GROQ_URL, AGENT_MODEL), "gemini": (GEMINI_URL, GEMINI_MODEL),
                          "nim": (NIM_URL, NIM_MODEL)}[prov]
            for i, k in enumerate(ks):
                if (prov, i) not in self._exhausted:
                    yield prov, i, k, url, model

    def chat(self, messages: List[Dict[str, Any]], tools: Optional[List[Dict]] = None,
             temperature: float = 0.0, json_mode: bool = False, cache_tag: str = "") -> LLMResult:
        tag = f"{AGENT_MODEL}|{cache_tag}|json={json_mode}"
        ck = _cache_key(tag, messages, tools, temperature)
        path = os.path.join(self.cache_dir, ck + ".json")
        if self.use_cache and os.path.exists(path):
            d = json.load(open(path, encoding="utf-8"))
            with self._lock:
                self.stats["cache_hits"] += 1
            return LLMResult(d["message"], d["provider"], d["model"], d.get("usage", {}), True, 0.0)

        errors = []
        first = True
        for prov, idx, key, url, model in list(self._targets()):
            if not first:
                with self._lock:
                    self.stats["fallbacks"] += 1
            first = False
            body: Dict[str, Any] = {"model": model, "messages": _for_provider(messages, prov),
                                    "temperature": temperature}
            if tools:
                body["tools"] = tools
                body["tool_choice"] = "auto"
            if json_mode:
                body["response_format"] = {"type": "json_object"}
            for attempt in range(self.max_retries):
                t0 = time.time()
                try:
                    r = requests.post(url, headers={"Authorization": f"Bearer {key}"}, json=body,
                                      timeout=self.timeout)
                except requests.RequestException as e:
                    errors.append(f"{prov}: {type(e).__name__}")
                    self._sleep(attempt)
                    continue
                if r.status_code == 200:
                    d = r.json()
                    msg = d["choices"][0]["message"]
                    res = LLMResult(msg, prov, model, d.get("usage") or {}, False, round(time.time() - t0, 3))
                    with self._lock:
                        self.stats["calls"] += 1
                    if self.use_cache:
                        json.dump({"message": msg, "provider": prov, "model": model, "usage": res.usage},
                                  open(path, "w", encoding="utf-8"), ensure_ascii=False)
                    return res
                text = r.text[:300].replace(key, "***")
                errors.append(f"{prov}#{idx}: HTTP {r.status_code}")
                if r.status_code == 429 and _DAILY_CAP.search(text):
                    self._exhausted.add((prov, idx))     # daily cap: skip this key for the rest of the run
                    break
                if r.status_code in (429, 500, 502, 503, 504):
                    self._sleep(attempt, r.headers.get("retry-after"))
                    continue
                # 400 from a tool-calling validation error (e.g. Groq "tool_use_failed") is worth one retry
                if r.status_code == 400 and attempt == 0 and "tool" in text.lower():
                    continue
                break   # other 4xx: try the next provider
        raise LLMUnavailable("; ".join(errors[-6:]) or "all provider keys hit their daily cap or none configured")

    def _sleep(self, attempt: int, retry_after: Optional[str] = None):
        with self._lock:
            self.stats["retries"] += 1
        try:
            ra = float(retry_after) if retry_after else 0.0
        except ValueError:
            ra = 0.0
        time.sleep(min(30.0, max(ra, self.base_delay * (2 ** attempt)) + random.random()))


_client: Optional[ChatClient] = None


def get_client() -> ChatClient:
    global _client
    if _client is None:
        _client = ChatClient()
    return _client


def set_client(c: Optional[ChatClient]) -> None:
    global _client
    _client = c
