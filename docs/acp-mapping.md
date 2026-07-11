# ACP ↔ UI mapping

| ACP / Grok surface | Desktop UI |
|--------------------|------------|
| `agent_message_chunk` | Assistant bubble (streamed) |
| `agent_thought_chunk` | Collapsible Thinking block |
| `tool_call` / `tool_call_update` | Tool card + status pill |
| `plan` | Read-only Plan card with revise and same-session approve/build actions |
| `_meta.modelState` | Current model and searchable session model directory |
| `_meta.availableCommands` | Dynamic slash-command catalog |
| `configOptions` / `availableModes` | Agent, Plan and Goal mode selector |
| `current_mode_update` / `config_option_update` | Persist confirmed live task mode |
| `available_commands_update` | Refresh the current task's command catalog |
| Server permission request | Modal: Allow once / Deny |
| Process exit | Status badge offline + system line |
| `x.ai/git/*` | Reserved for Diff panel |
| `x.ai/git/worktree/*` | Reserved for Worktree panel |
| `session/new` `_meta.rules` | Orchestrator harness toggle |

Unknown `sessionUpdate` kinds are shown as system breadcrumbs so protocol drift stays visible during development.

Plan mode is also recorded in the Rust connection. While it is active, client-side ACP `fs/write*` requests are rejected with `PLAN_MODE_READ_ONLY`; read requests remain available. Plan therefore overrides `full_auto` for the client filesystem bridge.
