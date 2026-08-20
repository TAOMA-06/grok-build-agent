---
name: orchestrate
description: >
  Decompose complex software work into parallel Grok Build workers. Prefer the
  workflow tool and harness review-changes script for known independent work
  lists; otherwise spawn_subagent with role overlays, optional per-worker models,
  worktree isolation, and bounded fan-out. Use when the user asks to orchestrate,
  parallelize, fan-out work, or handle multi-component features.
when-to-use: orchestrate, parallel agents, fan-out, multi-component feature, workflow
---

# Orchestrate Skill

You coordinate; workers implement. Align with Grok Build **1.0.5**.

**Tool-call discipline:** emit `workflow` or `spawn_subagent` before any
"launching workers" narration. Never end a turn claiming a launch that did not
happen in that same reply.

## Choose the engine

1. **Workflow** when the session advertises the `workflow` tool **and** the work
   list is known and independent (multi-dimension review, fixed shard list).
2. **spawn_subagent** for ad-hoc tracks, mixed agent types, or when `workflow`
   is not advertised.
3. Never nest workflows. Never ask subagents to spawn children (depth 1).

## Workflow path (preferred)

1. Resolve this SKILL.md path from the loaded skills list. The script lives at
   `<harness-root>/workflows/review-changes.rhai` — two directories above this
   file (`skills/orchestrate/` → `workflows/`).
2. `read_file` that script. If it is missing, fall back to spawn_subagent.
3. Smoke-check one path: call `workflow` with `{ script, args: { target }, validate_only: true }`.
   Iterate until metadata/compile/canned path pass.
4. Offer a real run with the same `script` and `args` (no `validate_only`).
   Watch `/workflows` if the session has that dashboard.
5. Failed runs: use platform resume (`resume_from_run_id`) when advertised.
   Budget-limited resumes need a higher `agent_budget`.

`args.target` is the diff, branch, or path to review. Pass a concrete value;
do not omit it.

## spawn_subagent path

1. Break the request into independent workstreams with clear outputs.
2. Map dependencies; only parallelize independent nodes.
3. Spawn workers with `spawn_subagent`:
   - `explore` for research (state thoroughness: quick / medium / very thorough)
   - `plan` for architecture when approaches diverge
   - `general-purpose` for implementation
   - Prepend role instructions into `prompt` (do not depend on a persona name alone)
   - Prefix `description` with `[explore]` / `[plan]` / `[implementer]` / `[reviewer]` / `[security]` / `[tests]` / `[quick-search]`
   - **`background: true` for all parallel launches** (set explicitly)
   - Cap a wave at **8** workers; queue further waves
   - `isolation: "worktree"` when implementers may conflict
   - Narrowest `capability_mode` that fits. Implementers need writes: `all` or omit. Never `execute` for implementers.
   - Optional `model`: only a slug from the session catalog; omit to inherit parent
4. Wait for results:
   - Prefer `wait_commands_or_subagents` when waiting on several task IDs and it is advertised
   - Or `get_command_or_subagent_output` with `timeout_ms` per task
5. Integrate, verify (build/tests + platform `Verify:` lines), and present a unified summary.
6. If workers need handoff files, keep them under workspace `.grok/scratch/<id>/` — not bare `$TMPDIR`.

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
- Unbounded fan-out in one wave
- Using `execute` for implementers (that mode cannot write files)
- Announcing launches without a tool call in the same reply
