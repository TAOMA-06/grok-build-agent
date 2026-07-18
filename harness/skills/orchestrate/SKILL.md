---
name: orchestrate
description: >
  Decompose complex software work into parallel Grok Build subagents with
  persona overlays, worktree isolation, and batch waits. Use when the user
  asks to orchestrate, parallelize, fan-out work, or handle multi-component features.
when-to-use: orchestrate, parallel agents, fan-out, multi-component feature
---

# Orchestrate Skill

You coordinate; workers implement. Align with Grok Build 0.2.99+ subagent APIs.

## Steps

1. Break the request into independent workstreams with clear outputs.
2. Map dependencies; only parallelize independent nodes.
3. Spawn workers:
   - `explore` for research (state thoroughness: quick / medium / very thorough)
   - `plan` for architecture when approaches diverge
   - `general-purpose` for implementation
   - Prepend persona instructions into `prompt` (personas are not a spawn parameter)
   - Prefix `description` with `[explore]` / `[plan]` / `[implementer]` / `[reviewer]`
   - `background: true` for all parallel launches
   - `isolation: "worktree"` when implementers may conflict
   - Narrowest `capability_mode` that fits
4. Wait for results with `get_command_or_subagent_output` (`timeout_ms` per task, or batch wait when available).
5. Integrate, verify (build/tests + platform `Verify:` lines), and present a unified summary.
6. If workers need handoff files, keep them under workspace `.grok/scratch/<id>/` — not `$TMPDIR` (Desktop may block outside-workspace paths).

## Worker prompt template

```
=== WORKER ===
Complete ONLY the task below. Use tools directly. Do not spawn subagents.
TASK: ...
CONTEXT: ...
SCOPE: files / packages you may touch
OUTPUT: what to return (paths, summary, handoff file if any)
CONSTRAINTS: platform contract Goal/Acceptance/Verify if present
```

## Multi-stage (resume)

1. Research worker finishes → spawn implementer with `resume_from` only when continuing the *same* agent type and transcript is useful.
2. Prefer a fresh implementer with a tight prompt + research summary if agent types differ.
3. For review loops, keep stable summary_file / review_file paths across rounds.

## Anti-patterns

- Spawning agents for trivial single-file fixes
- Under-specified worker prompts
- Parallelizing dependent steps
- Inventing a `persona` parameter on `spawn_subagent`
- Nested subagents (depth must stay 1)
