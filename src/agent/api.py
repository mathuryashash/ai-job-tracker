"""FastAPI routes for the agent. Both endpoints stream NDJSON (one JSON event per line).

POST /api/agent/run     {"task": "...", "max_steps": 10, "live": false}
POST /api/agent/resume  {"thread_id": "...", "decision": "approve"|"reject", "call_ids": [...]}
GET  /api/agent/state/{thread_id}
"""
from __future__ import annotations

import json
import threading
import uuid
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/agent", tags=["agent"])
_graph = None
_lock = threading.Lock()
_ALLOWED_FAULTS = {"flaky", "down", "error_once"}


def get_graph():
    global _graph
    with _lock:
        if _graph is None:
            from .graph import build_graph, sqlite_checkpointer
            _graph = build_graph(sqlite_checkpointer())
        return _graph


def set_graph(g) -> None:
    global _graph
    _graph = g


class RunRequest(BaseModel):
    task: str = Field(..., min_length=3, max_length=2000)
    max_steps: int = Field(10, ge=1, le=25)
    live: bool = False
    faults: Dict[str, str] = Field(default_factory=dict)
    thread_id: Optional[str] = Field(None, pattern=r"^[A-Za-z0-9_-]{1,64}$")


class ResumeRequest(BaseModel):
    thread_id: str = Field(..., pattern=r"^[A-Za-z0-9_-]{1,64}$")
    decision: str = Field(..., pattern=r"^(approve|reject)$")
    call_ids: List[str] = Field(default_factory=list)


def _ndjson(gen):
    for ev in gen:
        yield json.dumps(ev, default=str) + "\n"


@router.post("/run")
def run_agent(req: RunRequest):
    from .graph import initial_state, stream_run
    bad = {k: v for k, v in req.faults.items() if v not in _ALLOWED_FAULTS}
    if bad:
        raise HTTPException(400, f"invalid fault modes: {bad}")
    thread = req.thread_id or "api-" + uuid.uuid4().hex[:10]
    g = get_graph()
    if g.get_state({"configurable": {"thread_id": thread}}).values:
        raise HTTPException(409, "thread_id already exists; use /api/agent/resume")
    st = initial_state(req.task, max_steps=req.max_steps, use_fixtures=not req.live, faults=req.faults)
    return StreamingResponse(_ndjson(stream_run(g, st, thread)), media_type="application/x-ndjson")


@router.post("/resume")
def resume_agent(req: ResumeRequest):
    from .graph import resume_input, stream_run
    g = get_graph()
    snap = g.get_state({"configurable": {"thread_id": req.thread_id}})
    if not snap.values:
        raise HTTPException(404, "unknown thread_id")
    if "approval" not in (snap.next or ()):
        raise HTTPException(409, "this run is not waiting for approval")
    return StreamingResponse(_ndjson(stream_run(g, resume_input(req.decision, req.call_ids), req.thread_id)),
                             media_type="application/x-ndjson")


@router.get("/state/{thread_id}")
def agent_state(thread_id: str):
    snap = get_graph().get_state({"configurable": {"thread_id": thread_id}})
    if not snap.values:
        raise HTTPException(404, "unknown thread_id")
    v = snap.values
    return {"thread_id": thread_id, "next": list(snap.next or ()), "status": v.get("status"),
            "steps": v.get("steps"), "tokens": v.get("tokens"), "final": v.get("final"),
            "saves_done": v.get("saves_done", 0), "trajectory": v.get("trajectory")}
