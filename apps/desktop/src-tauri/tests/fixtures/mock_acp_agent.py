#!/usr/bin/env python3
"""Minimal ACP stdio mock agent for RuntimePool tests.

Speaks newline-delimited JSON-RPC. Accepts argv shaped like:
  mock_acp_agent.py agent [--model X] [--always-approve] stdio
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
import uuid

_session_counter = 0
_hang_threads: list[threading.Thread] = []


def read_line() -> str | None:
    line = sys.stdin.readline()
    if line == "":
        return None
    return line.strip()


def write_msg(msg: dict) -> None:
    sys.stdout.write(json.dumps(msg, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def respond(req_id, result=None, error=None) -> None:
    msg = {"jsonrpc": "2.0", "id": req_id}
    if error is not None:
        msg["error"] = error
    else:
        msg["result"] = result if result is not None else {}
    write_msg(msg)


def notify(method: str, params: dict) -> None:
    write_msg({"jsonrpc": "2.0", "method": method, "params": params})


def handle(req: dict) -> bool:
    """Return False to exit the process."""
    global _session_counter

    method = req.get("method")
    req_id = req.get("id")
    params = req.get("params") or {}

    if method == "initialize":
        respond(
            req_id,
            {
                "protocolVersion": 1,
                "agentCapabilities": {
                    "loadSession": True,
                    "promptCapabilities": {"image": False, "audio": False, "embeddedContext": True},
                },
                "agentInfo": {"name": "mock-acp-agent", "version": "0.0.1"},
                "authMethods": [],
                "_meta": {
                    "modelState": {
                        "currentModelId": "grok-build",
                        "availableModels": [
                            {"modelId": "grok-build", "name": "Grok Build"},
                            {"modelId": "grok-fast", "name": "Grok Fast"},
                        ],
                    },
                    "availableCommands": [
                        {"name": "compact", "description": "Compact context", "input": None},
                        {"name": "goal", "description": "Manage a goal", "input": {"hint": "<objective>"}},
                    ],
                },
            },
        )
        return True

    if method == "session/new":
        _session_counter += 1
        sid = f"mock-session-{_session_counter}-{uuid.uuid4().hex[:8]}"
        respond(req_id, {
            "sessionId": sid,
            "configOptions": [{
                "id": "mode",
                "name": "Session mode",
                "category": "mode",
                "type": "select",
                "currentValue": "agent",
                "options": [
                    {"value": "agent", "name": "Agent"},
                    {"value": "plan", "name": "Plan"},
                    {"value": "goal", "name": "Goal"},
                ],
            }],
        })
        return True

    if method == "session/load":
        sid = params.get("sessionId") or ""
        notify(
            "session/update",
            {
                "sessionId": sid,
                "update": {
                    "sessionUpdate": "agent_message_chunk",
                    "content": {"type": "text", "text": f"restored:{sid}"},
                },
            },
        )
        respond(req_id, {})
        return True

    if method == "session/cancel":
        # ACP cancellation is a notification, so no response is emitted.
        # When `_meta.toolCallIds` is present, emit per-tool cancelled updates
        # (Desktop soft subtree cancel). Otherwise treat as whole-session cancel.
        sid = params.get("sessionId") or ""
        meta = params.get("_meta") or {}
        ids = meta.get("toolCallIds") or []
        if isinstance(ids, list) and ids:
            for tid in ids:
                notify(
                    "session/update",
                    {
                        "sessionId": sid,
                        "update": {
                            "sessionUpdate": "tool_call_update",
                            "toolCallId": str(tid),
                            "status": "cancelled",
                        },
                    },
                )
        return True

    if method in ("session/set_mode", "session/set_config_option"):
        sid = params.get("sessionId") or ""
        mode = params.get("mode") or params.get("value") or "agent"
        notify(
            "session/update",
            {
                "sessionId": sid,
                "update": {
                    "sessionUpdate": "current_mode_update",
                    "currentModeId": mode,
                },
            },
        )
        respond(req_id, {"currentModeId": mode})
        return True

    if method == "session/prompt":
        sid = params.get("sessionId") or ""
        # Stream a tiny message update tagged with sessionId (outer params).
        notify(
            "session/update",
            {
                "sessionId": sid,
                "update": {
                    "sessionUpdate": "agent_message_chunk",
                    "content": {"type": "text", "text": f"echo:{sid}"},
                },
            },
        )
        respond(
            req_id,
            {
                "stopReason": "end_turn",
                "echoSessionId": sid,
            },
        )
        return True

    if method == "mock/hang":
        # Never respond — used to test pending cleanup on exit.
        def _sleep() -> None:
            time.sleep(30)

        t = threading.Thread(target=_sleep, daemon=True)
        t.start()
        _hang_threads.append(t)
        return True

    if method == "mock/exit":
        respond(req_id, {"ok": True})
        # Flush then exit so the client sees the response first.
        time.sleep(0.05)
        return False

    if method == "shutdown" or method == "exit":
        respond(req_id, {})
        return False

    if req_id is not None:
        respond(
            req_id,
            error={"code": -32601, "message": f"Method not found: {method}"},
        )
    return True


def main() -> int:
    # Consume argv; no shell command construction.
    argv = sys.argv[1:]
    # Opt-in descendant used by Rust lifecycle tests. It deliberately does not
    # share the protocol stream, so only process-group cancellation can remove
    # it when the mock ACP parent is stopped.
    if "--model" in argv and argv[argv.index("--model") + 1:argv.index("--model") + 2] == ["spawn-child"]:
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        with open(os.path.join(os.getcwd(), ".mock_acp_child_pid"), "w", encoding="utf-8") as pid_file:
            pid_file.write(str(child.pid))
    while True:
        line = read_line()
        if line is None:
            break
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not handle(req):
            break
    return 0


if __name__ == "__main__":
    sys.exit(main())
