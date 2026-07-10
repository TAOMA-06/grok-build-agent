# ACP ↔ UI mapping

| ACP / Grok surface | Desktop UI |
|--------------------|------------|
| `agent_message_chunk` | Assistant bubble (streamed) |
| `agent_thought_chunk` | Collapsible Thinking block |
| `tool_call` / `tool_call_update` | Tool card + status pill |
| `plan` | Plan block (approve UX planned) |
| Server permission request | Modal: Allow once / Deny |
| Process exit | Status badge offline + system line |
| `x.ai/git/*` | Reserved for Diff panel |
| `x.ai/git/worktree/*` | Reserved for Worktree panel |
| `session/new` `_meta.rules` | Orchestrator harness toggle |

Unknown `sessionUpdate` kinds are shown as system breadcrumbs so protocol drift stays visible during development.
