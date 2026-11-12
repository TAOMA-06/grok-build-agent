# Current-state audit

Audit date: 2026-09-03
Checkout: repository root (local user path intentionally omitted from the public document)
Branch: `main`
Starting HEAD: `45947be553e95a247a36ee46305f1f4e83aca8e5`
Starting worktree: clean

## Decision

- **Product direction:** conditional pass.
- **Current source as a release candidate:** fail.
- **Exact public v1.1.1 DMG as a release artifact:** fail.

The repository contains substantial reusable product infrastructure. Rewriting it would discard solved reliability work. The correct next move is a safety/compatibility stabilization wave before additional features.

## Implemented assets worth retaining

- React/Tauri workbench with project/task navigation, task timeline, Composer, Inspector, Changes, Files, Verify, Memory, Terminal, Settings, and Mission Control.
- Typed `DesktopBridge` between renderer and platform implementation.
- Out-of-process `grok-build-agent-host` with authenticated Unix-socket RPC, event replay, per-request metadata, and renderer-independent runtime ownership.
- SQLite task/session/turn/event/projection/dispatch/tool/permission/policy/artifact/runtime/worktree/job/audit/context/verification/memory records.
- Prompt delivery journal with `prepared → sending → acknowledged` and `delivery_unknown` recovery.
- Worktree review, file/hunk actions, checkpoints, apply preview/recheck, and PR preparation.
- Terminal PTY, output bounds, process-group cancellation, secret redaction, attachment constraints, and local privacy modes.
- CompletionGate and structured verification concepts.
- macOS universal release workflow, SBOM intent, signing/notarization preflight, and release safety scan.

These assets are implemented; their release fitness is evaluated separately below.

## P0 blockers

### P0-1: managed worktree path can block its own Apply flow

Production worktrees default under the source repository at `.worktrees/<branch>` (`apps/desktop/src-tauri/src/git_ops.rs:464-490`). The product does not ensure that path is ignored.

A native Git reproduction in a disposable repository showed the main checkout reporting `?? .worktrees/audit/`. Apply preflight then rejects any non-clean main checkout (`git_ops.rs:624-632`). Existing tests pass an external worktree path and miss the production default (`git_ops.rs:1322-1332`, `1375-1390`). The adjacent `copy_dirty` path ignores some copy failures and cannot faithfully preserve deletions, renames, or staged/index state (`git_ops.rs:508-529`).

Required outcome: move managed worktrees to Application Support or another external product-owned root; define a lossless bounded dirty-state snapshot or refuse unsupported states; add a full default-create → edit → review → apply test.

### P0-2: repository-writable profile becomes trusted prompt input

The app reads `.grok/profile.md` from the selected workspace (`workspace_ops.rs:170-223`) and injects it into the platform-trusted prompt partition (`agent_host/mod.rs:2181-2227`). Default task `allowedPaths` can be broad enough for the Agent to write that file.

This permits persistent prompt injection to cross the repository/trusted-control boundary.

Required outcome: repository profile/instructions are untrusted data. A trusted project profile must live in product-controlled storage and require explicit user review to promote content.

### P0-3: CompletionGate evidence lacks immutable provenance

Current completion readiness can be true with no declared verification commands (`db.rs:2026-2080`). The result type is not strongly bound to execution root, HEAD/base, diff hash, exact command run, or artifact identity (`platform.rs:60-72`). Browser screenshot evidence can be entered through UI text and recorded as passed (`ContextDrawer.tsx:299-316`; `agent_host/mod.rs:1204-1220`).

Required outcome: a write task cannot reach Verified/Ready without immutable required checks. Every result must bind task, execution, worktree, commit/diff, command, timestamps, exit status, and artifact hash. Manual evidence remains manual and cannot impersonate automated proof.

### P0-4: runtime stop/reload can affect another task

Multi-task fallback/reload paths call a global `runtime.stop`; the Host stops the active connection rather than a connection explicitly named by the caller (`useDesktopController.ts`, `agent_host/dispatch.rs:870-872`, `acp/pool.rs:984-1015`). In a multi-task product, the active global connection may belong to a different task.

Required outcome: stop/reload/fallback requires task ID + connection ID + expected process identity and must prove another task remains alive in concurrency tests.

### P0-5: current Grok compatibility claim is behind stable and internally inconsistent

- Local CLI is 1.0.5; official stable is 1.0.13.
- Product source tracks 1.0.0–1.0.5.
- Official 1.0.6 removed `capability_mode`; the harness still instructs and configures it in multiple files.
- New installs default to `grok-4.5`, while the live 1.0.5 ACP catalog reported `grok-4.6` as current/default.
- The app has not captured or tested 1.0.12/1.0.13 hook/MCP elicitation, persistence, and permission changes.

Required outcome: a stable-version compatibility gate based on live capabilities and redacted fixtures, not a broad version string promise.

### P0-6: exact public v1.1.1 artifact fails signature validation

The [published Release](https://github.com/TAOMA-06/grok-build-agent/releases/tag/v1.1.1) names commit `493de4323c2810b096b504c4e4ea46c6cf05080f`. Asset ID `482145959`, uploaded `2026-07-19T06:13:16Z`, is 18,812,130 bytes at [this exact download URL](https://github.com/TAOMA-06/grok-build-agent/releases/download/v1.1.1/Grok.Build.Desktop_1.1.1_universal.dmg).

Direct verification of the exact download found:

- GitHub API digest and local SHA-256 match: `bd5381493d5411e9216f4abafe553eefb9f689464bc4debf7cab87573472275a`.
- `hdiutil verify` passes.
- Main and Host are both `x86_64 arm64` universal.
- Unverified signature metadata shows Hardened Runtime, Team ID `8SXB8YJ2ZN`, and a stapled-ticket marker. Metadata is not proof that either signature or ticket is valid.
- `codesign --verify --deep --strict --all-architectures` fails for the app, main executable, and Host with `invalid signature (code or signature have been modified)`.
- `spctl`/Stapler did not produce a valid acceptance. The generated entitlement is empty while the legacy RC script requires a Keychain access group, an additional contract contradiction.
- The Release contains only DMG and a checksum file, while the tag workflow is designed to collect DMG, app ZIP, SPDX SBOM, and checksums.
- Asset uploader is the user account rather than retained workflow evidence, consistent with a manual artifact path.

The locally installed/newly built arm64 ad-hoc app passes `codesign --verify`, which rules out a general local inability to verify code signatures. It does not make that local build distributable.

The verification host was macOS 27.0 build `26A5425a` using `/usr/bin/codesign`; Xcode reported 26.6 (`17F113`). The decisive commands and outcomes were:

| Command | Exit | Outcome |
| --- | ---: | --- |
| `shasum -a 256 <downloaded.dmg>` | 0 | Matched GitHub API digest |
| `hdiutil verify <downloaded.dmg>` | 0 | DMG checksum valid |
| `lipo -archs <main-or-host>` | 0 | `x86_64 arm64` |
| `codesign --verify --deep --strict --all-architectures <app>` | 1 | Invalid signature |
| `codesign --verify --strict --arch <arch> <main-or-host>` | 1 | Invalid for both binaries and both architectures |
| `xcrun stapler validate <app>` | 1 | Ticket not validated |
| `spctl --assess --type execute --verbose=4 <app>` | 1 | No valid acceptance |

Required outcome: stop treating v1.1.1 as a verified public artifact; rebuild from a clean frozen commit through the release workflow and independently re-download/re-verify every published asset. Any unpublish/replace action requires product-owner authorization.

### P0-7: side-effect idempotency keys are regenerated

Host RPC can persist results by idempotency key, but UI calls for side-effecting Git operations such as Apply, Commit, and PR preparation generate new request metadata on retry (`lib.rs:79-85`, `1523-1546`). A disconnect/retry can therefore repeat an external side effect.

Required outcome: UI creates and persists a stable operation ID plus canonical request digest before the first attempt; retry reuses both until a final result is reconciled. The Host rejects the same key with different request content.

### P0-8: byte-based UTF-8 truncation can panic

Several Host, audit, and large-diff paths truncate Rust strings at arbitrary byte offsets. Chinese, emoji, or combining text that crosses those limits can panic (`agent_host/mod.rs:2209`, `agent_host/event_bus.rs:202`, `agent_host/dispatch.rs:1173`, `git_ops.rs:269`).

Required outcome: centralize character-boundary-safe bounded text handling and cover Chinese, emoji, and combining characters across the actual 2 KB/8 KB and patch limits.

### P0-9: version identity does not bind current source

Current `main` is 24 commits and 191 changed files beyond the v1.1.1 tag, while `package.json`, `Cargo.toml`, `tauri.conf.json`, and `updater.ts` still identify the product as 1.1.1. The installed app and a newly built app can therefore share a visible version while having different executable hashes.

Required outcome: one authoritative version source, CI-enforced tag/version equality, a source SHA embedded in diagnostics/receipt, and a release rule that refuses an already-published version for different source.

## P1 important risks

- Code-index search is presented as read-only but writes `.grok/cache/symbol-defs-v1.json` inside the user's workspace (`code_index.rs:19`, `214-221`, `374-384`). Move it to Application Support.
- ACP prompt timeout is a fixed 600 seconds and activity events do not extend it; a healthy long task can become uncertain (`acp/pool.rs:21`, `600-607`; `acp/connection.rs:100-129`). Use activity-aware deadlines and explicit turn completion.
- Authentication health treats a non-empty auth file as signed in rather than validating usable runtime auth (`runtime.rs:73-103`).
- Some synchronous CLI operations run inside async Host dispatch and can block unrelated cancellation, permission, or health requests (`cli_bridge.rs:35`; `agent_host/dispatch.rs:182`).
- The Context Manifest records source/kind/trust/token estimates but not a canonical content digest, truncation range, runtime binary/capability receipt, model, or effort (`platform.rs:111`). It cannot reproduce which exact context was sent.
- The built-in CLI installer treats a downloaded script larger than 32 bytes as verified and then invokes Bash (`cli_bridge.rs:1684`, `1787`). If xAI supplies no signature/checksum contract, use a manual install handoff or an explicit supply-chain warning; file size is not integrity verification.
- Forty tracked paths contain the suffix ` 2`; 39 match another tracked file and `docs/handoff 2.md` is a divergent stale copy. They pollute search, coverage, review, and Agent context.
- The desktop self-updater only checks a GitHub Release and opens links; it does not download, validate, replace, relaunch, or roll back.
- Host Jobs have schema/UI/CRUD but lack proven due-task scheduling and execution.
- Browser evidence is manual/optional; there is no embedded browser runtime.
- Current generic/mixed ACP settings are not truly production-wired and are outside the accepted Grok-only scope.
- Architecture/RC documentation says the IPC token uses a shared Keychain access group, while implementation uses a mode-0600 config file and the RC script requires a Keychain entitlement (`docs/architecture.md`, `secrets.rs:34`, `scripts/verify-v1-release-candidate.sh:49`). Implementation, threat model, and gate must agree.
- Rust toolchain and GitHub Actions use floating versions, allowing quality results to drift without a source change.

## P2 structural debt

- Large ownership hotspots include `db.rs`, `agent_host/mod.rs`, `agent_host/dispatch.rs`, `cli_bridge.rs`, `lib.rs`, the desktop controller, and Context Drawer.
- Tauri commands, Host dispatch, and `DesktopBridge` maintain overlapping handwritten RPC maps that can drift.
- ACP/contract modules broadly allow dead code, masking abstractions that are not on the production path.
- The 4,000+ line legacy `shell.css` is not imported by the current application.
- Several declared frontend dependencies appear unused by current source. Dependency removal requires a build/test audit, not search-only deletion.

R1 should delete/quarantine obvious dead or duplicate paths and make only the most dangerous ownership split. Full RPC code generation and large-module decomposition belong after the safety invariants, so cleanup does not consume the stabilization phase.

## Current local quality evidence

### Passed in this checkout

- Clean `main` at starting HEAD.
- `npm run check`: TypeScript, 39 frontend test files / 193 tests, cache self-test, and production build.
- `cargo test --workspace`: 131 passed.
- x86_64 Rust compile check.
- harness validation.
- tracked-source release safety scan.
- `git diff --check` before planning-doc edits.
- locally built arm64 ad-hoc app bundle and its code signature.

### Failed

- `cargo fmt --all -- --check`: failed across 12 Rust files / 30 diff locations.
- `cargo clippy --workspace --all-targets -- -D warnings`: six errors.
- Exact public v1.1.1 DMG signature validation.

### Provisional or insufficient

- Parity reports 14/28 scored and 14 skipped. The smoke script labels selected categories “pass” without launching Grok and exits 0 while provisional.
- Frontend `e2e` tests are pure/helper Vitest, not installed-app journeys.
- Rust E2E relies on Python mock ACP and temporary Git/DB fixtures, not authenticated Grok.
- Source line coverage is approximately 46.5% with no enforced threshold; major UI surfaces have little or no direct coverage.
- Current `main` is 24 commits / 191 files beyond the v1.1.1 tag while product version fields remain 1.1.1. This is P0-9, not merely provisional test coverage.

### Not run or blocked

- Authenticated Grok prompt path: the current health probe reported unauthenticated; no real prompt was sent to establish whether the account can be recovered or used.
- Live 1.0.13 ACP/inference path: global CLI was not upgraded and no isolated stable binary was installed.
- Intel real-device run.
- Current-main Developer ID signing/notarization/Gatekeeper flow.
- Full crash/soak/red-team corpus.
- External competitor installed-app tests.
- Online `npm audit`: not run because network authorization was not completed.
- Current Rust advisory refresh: not run; offline Cargo audit used a 2026-08-24 advisory database and reported 18 allowed warnings.
- Full Git-history secret scanning: not run; the tracked-source heuristic is not a historical scanner.

## Baseline rule

After owner approval, R1 stabilization may start specifically to close P0s. R2 and feature expansion do not start until the R1/G1 source-safety and quality gates are green. The public Release incident may be handled in parallel only with explicit owner authorization.
