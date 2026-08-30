# Workbench v3 validation

Date: 2026-08-30  
Quality decision: **Conditional pass** for the local UI refactor. This is not a notarized or published release decision.

## Scope delivered

- Replaced the active three-layer shell cascade with one scoped workbench visual layer; legacy `shell.css` remains in the checkout for recovery but is no longer imported by the application.
- Added a neutral graphite / signal-white / telemetry-mint semantic token system for dark and light themes.
- Reworked project and task navigation, active-state telemetry, task header, transcript, empty state, Composer, Settings, Mission Control, command palette, Inspector, Terminal, and dialogs.
- Moved permission requests into a blocking Composer dock while keeping the Composer mounted and its draft state intact.
- Restored live macOS system-theme following.
- Prevented `full_auto` from bypassing requests that explicitly require a second confirmation.
- Folded duplicate assistant replies only inside the same user turn.
- Replaced the simulated desktop auto-updater with the truthful current capability: GitHub Release metadata check plus links to the Release page and DMG.
- Added the project-local `script/build_and_run.sh` entrypoint and `.codex/environments/environment.toml` Run action.

Design research and source revisions are recorded in `2026-08-30-opencode-codex-design-study.md`.

## Baseline protection

- Starting HEAD: `f7a9cc99a6ae40201657064d46b57fe8faa5f0da`.
- Starting tracked diff: 8 modified files, `+1207/-628`.
- Starting tracked binary-diff checksum: `8956e6e2f85c91a6a0d138f44b6232f6196ba682610f4d98f7a2c7693d6b157f`.
- Dirty-file recovery archive: `/private/tmp/grok-build-ui-baseline-f7a9cc99-20260830.tar.gz`.
- Recovery archive SHA-256: `c1cb3f2c8eec973a3db53ac25e86c216e9c3ad36b2f85c08f9ce6207866bfc74`.
- Pre-existing ` 2` duplicate files and unrelated dirty files were not deleted or rewritten.

## Automated evidence

### Frontend and production bundle

Command:

```bash
cd apps/desktop && npm run check
```

Result:

- TypeScript no-emit check passed.
- 39 Vitest files passed.
- 193 tests passed.
- Cache-hit gate self-test passed.
- Vite production build passed.

### Rust and Host

Command:

```bash
cd apps/desktop/src-tauri && cargo test --workspace
```

Result: 131 tests passed, 0 failed. Two process-cleanup messages (`kill: <pid>: No such process`) appeared after the target process had already exited; the tests still passed.

### Parity evaluation

Command:

```bash
cd apps/desktop && npm run check:parity-eval
```

Result: median `1.000` against target `0.900`, but only 14/28 tasks were scored and 14 were skipped. Status remains **PROVISIONAL**, not full parity.

### Safety and formatting

- `npm run release:check`: passed for tracked source.
- Additional token/private-key pattern scan over edited and untracked UI source, design docs, Run script, and environment config: no matches.
- `git diff --check`: passed.
- `bash -n script/build_and_run.sh`: passed.

## Visual and interaction evidence

Browser MockBridge verification covered:

- active task and empty task;
- dark and light themes;
- 900x600 minimum window;
- narrow-window Inspector overlay;
- Settings;
- Mission Control;
- command palette;
- Changes and Terminal tabs;
- terminal creation;
- browser console errors and warnings: none observed.

Real Tauri application verification:

```bash
./script/build_and_run.sh --verify
```

Result:

- release build passed;
- app-only Tauri bundle created;
- bundle identifier verified as `com.grokbuilddesktop.community`;
- `codesign --verify --deep --strict` passed;
- `grok-build-desktop` process launched from the built `.app`;
- actual macOS accessibility tree exposed projects, tasks, transcript, Composer, Settings, Inspector tabs, controls, and keyboard labels;
- duplicate cached `OK` replies displayed once after the same-turn folding fix.

Saved visual evidence:

- `.tmp-ui-preview/workbench-v3-final-real-main.jpg`
- `.tmp-ui-preview/workbench-v3-real-inspector.jpg`

## Unverified and external boundaries

- Apple notarization was skipped because no notarization credentials were available. Ad-hoc signing is local evidence only.
- No source changes were committed, pushed, or published.
- No real Grok prompt was sent during the final UI validation, avoiding an unapproved external service request and possible usage cost.
- Desktop self-update remains unimplemented; the UI now says so explicitly.
- Full parity requires recorded results for the 14 skipped agent tasks and any terminal/browser tooling they depend on.
- The checkout remains dirty and contains pre-existing duplicate/untracked files. A clean release candidate SHA has not been frozen.
