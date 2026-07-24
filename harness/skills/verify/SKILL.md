---
name: verify
description: >
  Run project verification (build, typecheck, tests, lint) aligned with platform
  task-contract Verify lines, and fix failures. Use when the user asks to verify,
  check work, or after substantial edits.
when-to-use: verify, check work, run tests, self-verify
---

# Verify Skill

Aligned with Grok Build Desktop Host policy: prefer argv-only local commands;
shell wrappers, network, and destructive git need user confirmation and are never
auto-run by the platform.

## Steps

1. Collect required checks (priority order):
   - Platform task contract `Verify:` lines (authoritative when present)
   - Project scripts from manifests (`package.json`, `Cargo.toml`, `pyproject`, `go.mod`, `xcodeproj`, etc.)
2. Prefer argv-only commands the host can auto-run when declared:
   - Good: `cargo test`, `cargo check`, `npm test`, `npm run check`, `pytest`
   - Avoid for auto paths: `bash -c …`, `zsh -lc …`, `curl`, `docker`, destructive git
3. Run the tightest useful checks first (typecheck/build), then tests.
4. On failure: diagnose root cause, fix the **minimal** code change, re-run the **same** commands.
5. Report with evidence:
   - Commands (exact argv)
   - Pass/fail + exit codes
   - What remains unverified and why

## Definition of done

- Do **not** claim completion while declared platform verifications still fail or were skipped without explanation.
- Do **not** invent a green status without having run the check in this session.
- If a required command cannot run (missing tool, needs confirmation, environment gap), say so and propose a replacement the user can approve.

## Rules

- Prefer existing project scripts over ad-hoc one-liners.
- Do not expand scope into unrelated refactors while fixing failures.
- Stay inside the workspace / task `Allowed path` list for edits.
- Never use `--no-verify`, force-push, or `reset --hard` to “make CI green”.
