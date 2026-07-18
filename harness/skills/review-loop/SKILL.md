---
name: review-loop
description: >
  Lightweight implement → review → fix loop with workspace file handoffs.
  Use for non-trivial features when quality matters but the full /implement DAG
  is overkill. Requires this skill to be installed (plugin or .grok/skills).
when-to-use: review loop, implement and review, quality pass, implementer reviewer
---

# Review Loop Skill

You coordinate only. Implementation and review happen in subagents.

**Load path note:** Desktop “Orchestrator harness” injects `AGENTS.md` only. This skill
runs when Grok discovers it via plugin install or `.grok/skills/review-loop/`.

## Setup

1. Create a **workspace-local** scratch dir (not `$TMPDIR` — Desktop policy often
   blocks or prompts on paths outside the workspace / task `Allowed path` list):

```bash
run_id=$(python3 -c "import uuid; print(uuid.uuid4().hex[:8])")
scratch=".grok/scratch/${run_id}"
mkdir -p "$scratch"
echo "$scratch"
```

2. Define stable absolute paths under the workspace:
   - `summary_file`: `<workspace>/.grok/scratch/<run_id>/summary.md`
   - `review_file`: `<workspace>/.grok/scratch/<run_id>/review.md`

3. Optionally `todo_write` phases: `implement` → `review` → `fix` → `rereview` → `verify`.

## Role prompt snippets (embed in spawn prompt)

Personas are not a `spawn_subagent` field. Paste one of these blocks into the worker prompt
(or read `personas/implementer.toml` / `personas/reviewer.toml` if this plugin is installed).

### Implementer block

```
You are an implementer. Complete only the assigned task.
- Prefer editing existing files; match project style; smallest change that works.
- Run a minimal compile/typecheck when feasible.
- Do not spawn subagents. Do not commit unless asked.
- Write summary_file with: files changed, decisions, residual risks.
With review_file: fix every Status: open (or Status: wontfix + technical rationale);
update Status to fixed/wontfix with Response; append Implementation Summary.
```

### Reviewer block

```
You are a rigorous code reviewer. Do not fix code unless asked. Do not spawn subagents.
Read summary_file and the changed code. Write review_file with issues:
Severity: bug|suggestion|nit; File: path:line; Description; Suggestion; Status: open.
Prioritize correctness, security, regressions, missing tests for new logic.
Final response: path to review_file + short verdict.
```

## Loop

### 1. Implement

`spawn_subagent`: `subagent_type: general-purpose`, `description: "[implementer] …"`.

Embed implementer block + paths. Use `isolation: "worktree"` when the parent tree must stay clean.

### 2. Review

`description: "[reviewer] …"`. Embed reviewer block + `summary_file` / `review_file`.

### 3. Decide

Count `Status: open` with severity `bug`:

- **0 open bugs** (user may accept leftover suggestions/nits): go to Verify.
- **Any open bug** (or user wants all severities fixed): resume implementer.

### 4. Fix (resume)

`resume_from: <implementer_id>`, `description: "[implementer] Fix review"`.

Address remaining opens per user policy (bugs always; suggestions/nits if requested).

### 5. Re-review

`resume_from` the reviewer. Rewrite `review_file` for remaining opens only.

Repeat until open bugs are cleared (or the user stops).

### 6. Verify

Run platform `Verify:` lines and project checks. Report evidence.

## Rules

- Tool call first, narration second — never claim a worker launched without `spawn_subagent` in the same turn.
- Keep description role tags on resume so UI labels stay correct.
- Depth is 1 — workers must not spawn children.
- Prefer one implementer transcript across fix rounds via `resume_from`.
- Prefer sequential git commands; never force-push or skip hooks.
- After the final report, delete scratch files if they hold no user-requested artifacts (leave `.grok/scratch/` if the project wants to keep the folder).
