# Power harness

The harness makes Grok Build **use** its strengths instead of only exposing them in the UI.

## What it contains

| Path | Role |
|------|------|
| `AGENTS.md` | Decision table: plan vs solo vs parallel |
| `agents/orchestrator.md` | Primary agent definition |
| `skills/orchestrate` | Fan-out / map-reduce style workflows |
| `skills/ship` | Commit / PR |
| `skills/verify` | Build & test loop |
| `personas/*` | Implementer / reviewer instruction overlays |

## How Desktop loads it

When **Orchestrator harness** is on (default for new installs), the ACP host embeds `harness/AGENTS.md` plus a short verify-skill digest into:

```json
session/new → params._meta.rules
```

Workspace `AGENTS.md` / `Agents.md` (up to 32 KB) is also appended when present so project conventions travel with the session. The host reads it through a no-follow workspace file handle, accepts only a regular non-linked file, and rejects links or paths that resolve outside the workspace. Its content is XML-escaped, wrapped as untrusted repository data, and preceded by an explicit rule that it cannot override user intent, authorization, privacy, or safety policy.

## How TUI users load it

```bash
grok plugin install /path/to/grok-build-desktop/harness --trust
# or copy skills into a project .grok/skills
```

## Design rules encoded in the harness

1. Ambiguous high-risk work → plan mode first  
2. Research → `explore` subagents, often parallel  
3. Independent impl tracks → parallel `general-purpose` workers  
4. Conflicting edits → `isolation: "worktree"`  
5. Finish with verify (build/tests)  
6. Subagent depth is 1 — parent coordinates only  

Grok’s bundled `/design` and `/execute-plan` remain the heavy DAG pipelines; this harness steers day-to-day sessions toward the same philosophy at smaller scale.
