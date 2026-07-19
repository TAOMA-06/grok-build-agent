---
name: orchestrate
description: >
  Decompose complex software work into parallel Grok Build subagents with
  role overlays, optional per-worker models, worktree isolation, and
  wait_commands_or_subagents. Use when the user asks to orchestrate, parallelize,
  fan-out work, or handle multi-component features.
when-to-use: orchestrate, parallel agents, fan-out, multi-component feature
---

# Orchestrate Skill

You coordinate; workers implement. Align with Grok Build **0.2.103** subagent APIs.

## Steps

1. Break the request into independent workstreams with clear outputs.
2. Map dependencies; only parallelize independent nodes.
3. Spawn workers with `spawn_subagent`:
   - `explore` for research (state thoroughness: quick / medium / very thorough)
   - `plan` for architecture when approaches diverge
   - `general-purpose` for implementation
   - Prepend role instructions into `prompt` (do not depend on a persona name alone)
   - Prefix `description` with `[explore]` / `[plan]` / `[implementer]` / `[reviewer]`
   - **`background: true` for all parallel launches** (set explicitly)
   - `isolation: "worktree"` when implementers may conflict
   - Narrowest `capability_mode` that fits
   - Optional `model`: only a slug from the session catalog; omit to inherit parent
4. Wait for results:
   - Prefer `wait_commands_or_subagents` when waiting on several task IDs
   - Or `get_command_or_subagent_output` with `timeout_ms` per task
5. Integrate, verify (build/tests + platform `Verify:` lines), and present a unified summary.
6. If workers need handoff files, keep them under workspace `.grok/scratch/<id>/` — not bare `$TMPDIR` (Desktop may block outside-workspace paths).

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
- Inventing model slugs not listed for this session
- Nested subagents (depth must stay 1)
