"""CLI: python -m src.agent "find remote python backend jobs and shortlist the best 3"

Streams each step. When the agent wants to write (save_to_tracker) the run pauses; answer y/n,
or resume later with:  python -m src.agent --resume <thread_id> --decision approve|reject
"""
from __future__ import annotations

import argparse
import json
import sys
import uuid

from .graph import build_graph, initial_state, resume_input, sqlite_checkpointer, stream_run


def _print(ev: dict) -> None:
    e = ev["event"]
    if e == "step":
        node = ev.get("node")
        if node == "agent":
            if ev.get("tool_calls"):
                calls = ", ".join(f"{c['name']}({c['args']})" for c in ev["tool_calls"])
                print(f"[agent] {ev.get('provider')}{' (cache)' if ev.get('cached') else ''} -> {calls}")
            elif ev.get("event") == "budget_exhausted":
                print(f"[agent] BUDGET EXHAUSTED after {ev.get('steps')} steps")
            else:
                print(f"[agent] {ev.get('provider')} -> final answer")
        elif node == "tools":
            st = "ok" if ev["ok"] else f"ERROR {ev.get('error')}"
            print(f"[tool ] {ev['tool']}: {st} attempts={ev.get('attempts')} {ev.get('result') or ''}")
        elif node == "approval":
            print(f"[human] approved={ev['approved']} rejected={ev['rejected']}")
        elif node == "reflect":
            print(f"[check] {ev['verdict']} {ev.get('issues') or ''}")
    elif e == "interrupt":
        for p in ev["payload"]:
            for item in p.get("pending", []):
                j = item["job"]
                print(f"[PAUSE] approval needed: {item['tool']} {item['args']} -> {j.get('title')} @ {j.get('company')}")
    elif e == "paused":
        print(f"[PAUSE] thread {ev['thread_id']} waiting at {ev['next']}")
    elif e == "finished":
        print(f"\n=== {ev['status']} | steps={ev['steps']} tokens={ev['tokens']} saves={ev['saves_done']} ===")
        print(ev.get("final") or "")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m src.agent")
    ap.add_argument("task", nargs="?")
    ap.add_argument("--resume", metavar="THREAD_ID")
    ap.add_argument("--decision", choices=["approve", "reject"])
    ap.add_argument("--auto", choices=["approve", "reject"], help="answer approval prompts automatically")
    ap.add_argument("--live", action="store_true", help="search live job boards instead of recorded fixtures")
    ap.add_argument("--max-steps", type=int, default=10)
    ap.add_argument("--fault", action="append", default=[], help="inject a tool fault, e.g. search_jobs=down")
    ap.add_argument("--json", action="store_true", help="print raw JSON events")
    a = ap.parse_args(argv)
    if not a.task and not a.resume:
        ap.error("give a task or --resume THREAD_ID")

    graph = build_graph(sqlite_checkpointer())
    if a.resume:
        thread, inp = a.resume, resume_input(a.decision or a.auto or "reject")
    else:
        thread = "cli-" + uuid.uuid4().hex[:8]
        faults = dict(f.split("=", 1) for f in a.fault)
        inp = initial_state(a.task, max_steps=a.max_steps, use_fixtures=not a.live, faults=faults)
    print(f"thread_id: {thread}")
    while True:
        paused = False
        for ev in stream_run(graph, inp, thread):
            print(json.dumps(ev, default=str)) if a.json else _print(ev)
            paused = paused or ev["event"] == "paused"
        sys.stdout.flush()
        if not paused:
            return 0
        if a.auto:
            ans = a.auto
        elif a.resume and a.decision:
            return 0   # one decision per --resume invocation
        elif sys.stdin.isatty():
            try:
                ans = "approve" if input("Approve this write? [y/N] ").strip().lower().startswith("y") else "reject"
            except EOFError:
                print(f"\nNo answer. Resume with: python -m src.agent --resume {thread} --decision approve|reject")
                return 0
        else:
            print(f"Resume with: python -m src.agent --resume {thread} --decision approve|reject")
            return 0
        print(f"[human] decision: {ans}")
        inp = resume_input(ans)


if __name__ == "__main__":
    sys.exit(main())
