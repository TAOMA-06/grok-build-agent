# Architecture

## Goals

1. Provide a **desktop UX** for Grok Build (not a terminal-only workflow).
2. Keep **Grok Build as the sole agent runtime** (tools, models, subagents, skills).
3. Expose ACP streams and permissions so capabilities are not “swallowed” by a thin chat wrapper.
4. Ship a **harness** that actively steers the model toward plan mode, parallel subagents, worktrees, and verification.

## Components

### Desktop shell (`apps/desktop`)

- **Frontend:** React + TypeScript + Zustand  
- **Host:** Tauri 2 (Rust)  
- **IPC:** `invoke` commands + `listen` events  

### ACP host (`src-tauri/src/acp/`)

**RuntimePool** groups child processes by `(workspaceRoot, sandbox, powerProfile)`:

```text
grok agent [--model …] [--always-approve] stdio
# cwd = normalized workspace; GROK_BUILD_SANDBOX / GROK_BUILD_POWER_PROFILE env
```

Each connection can host multiple ACP sessions. Events are emitted as
`SessionEventEnvelope` (`connectionId`, `sessionId`, `sequence`, `timestamp`, …).

Protocol flow:

1. `initialize` — advertise client capabilities (`fs`, `terminal`)
2. `session/new` — workspace `cwd`, optional `_meta.rules` / `agentProfile`
3. `session/prompt` — user turns (scoped by `sessionId`)
4. Notifications — `session/update`, `x.ai/*`, etc.
5. Server requests — e.g. permission; UI answers via `respond_server_request`
6. Process exit — fail/clear all pending requests; no orphan children after `stop`

### UI event map

| Event | Purpose |
|-------|---------|
| `acp:session_update` | Message / thought / tool / plan chunks |
| `acp:server_request` | Permission (and similar) prompts |
| `acp:status` | Process up/down, session id |
| `acp:stderr` | Debug stream from grok |
| `acp:extension` | xAI-prefixed notifications |
| `acp:error` | Parse/bridge errors |

### Harness (`harness/`)

Injected as `_meta.rules` when **use harness** is enabled. Also installable as a Grok plugin for pure TUI users. Does not replace bundled skills like `/design` or `/execute-plan`; it encourages using them.

## Non-goals

- Replacing Grok’s tool runner or model API
- Full IDE features (LSP editor, debugger)
- Cloud multi-tenant hosting of Grok
