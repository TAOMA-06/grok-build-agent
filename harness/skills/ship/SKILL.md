---
name: ship
description: >
  Create a high-quality commit and optional pull request for current changes.
  Use when the user wants to commit, ship, or open a PR.
when-to-use: commit, ship, open PR, create pull request
---

# Ship Skill

## Steps

1. Inspect status and diffs (`git status`, `git diff`, `git log -5 --oneline`).
2. Summarize what changed and why.
3. Draft a conventional commit message.
4. Stage relevant files (never secrets). Commit.
5. If asked for a PR: push (with user confirmation if needed) and open with `gh pr create` when available.
6. Report commit hash and PR URL.

## Rules

- Never update git config.
- Never force-push to main/master.
- Never skip hooks unless the user explicitly requests it.
- Prefer sequential git commands on the same repo (avoid index.lock races).
