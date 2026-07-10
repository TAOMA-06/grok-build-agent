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

When **Inject orchestrator harness** is on, the ACP host embeds `harness/AGENTS.md` into:

```json
session/new → params._meta.rules
```

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
