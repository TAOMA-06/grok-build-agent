---
name: verify
description: >
  Run project verification (build, typecheck, tests, lint) and fix failures.
  Use when the user asks to verify, check work, or after substantial edits.
when-to-use: verify, check work, run tests, self-verify
---

# Verify Skill

## Steps

1. Detect project tooling from manifests (package.json, Cargo.toml, pyproject, go.mod, xcodeproj, etc.).
2. Run the tightest useful checks first (typecheck/build), then tests.
3. If failures: diagnose root cause, fix, re-run.
4. Report: commands run, pass/fail, remaining risks.

## Rules

- Prefer existing project scripts (`npm test`, `cargo test`, etc.) over ad-hoc commands.
- Do not expand scope into unrelated refactors while fixing test failures.
