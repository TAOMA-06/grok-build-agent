---
name: orchestrate
description: >
  Decompose complex software work into parallel Grok Build subagents.
  Use when the user asks to orchestrate, parallelize, fan-out work, or handle
  multi-component features.
when-to-use: orchestrate, parallel agents, fan-out, multi-component feature
---

# Orchestrate Skill

You coordinate; workers implement.

## Steps

1. Break the request into independent workstreams with clear outputs.
2. Map dependencies; only parallelize independent nodes.
3. Spawn workers:
   - `explore` for research
   - `general-purpose` for implementation
   - `background: true` for all parallel launches
   - `isolation: "worktree"` when implementers may conflict
4. Wait with `get_command_or_subagent_output` (or wait helpers) as results arrive.
5. Integrate, verify (build/tests), and present a unified summary.

## Worker prompt template

```
=== WORKER ===
Complete ONLY the task below. Use tools directly. Do not spawn subagents.
TASK: ...
CONTEXT: ...
SCOPE: ...
OUTPUT: ...
```

## Anti-patterns

- Spawning agents for trivial single-file fixes
- Under-specified worker prompts
- Parallelizing dependent steps
