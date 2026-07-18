---
name: verify
description: >
  Run project verification (build, typecheck, tests, lint) aligned with platform
  task-contract Verify lines, and fix failures. Use when the user asks to verify,
  check work, or after substantial edits.
when-to-use: verify, check work, run tests, self-verify
---

# Verify Skill

## Steps

1. Collect required checks:
   - Platform task contract `Verify:` lines (authoritative when present)
   - Project scripts from manifests (package.json, Cargo.toml, pyproject, go.mod, xcodeproj, etc.)
2. Prefer argv-only local commands the host can auto-run (e.g. `npm test`, `cargo test`). Avoid shell wrappers, network, and destructive git unless the user confirmed.
3. Run the tightest useful checks first (typecheck/build), then tests.
4. If failures: diagnose root cause, fix, re-run the same commands.
5. Report: commands run, pass/fail, evidence, remaining risks.

## Rules

- Prefer existing project scripts (`npm test`, `npm run check`, `cargo test`, etc.) over ad-hoc commands.
- Do not expand scope into unrelated refactors while fixing test failures.
- Do not claim done while declared platform verifications still fail.
- If a required command cannot run in this environment, say why and propose a replacement the user can approve.
