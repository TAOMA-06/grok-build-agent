# Release and signing

## Published artifacts

The tag workflow builds and publishes the supported v1 target:

- macOS universal DMG and app ZIP (`arm64` + `x86_64`)
- SPDX SBOM

The GitHub Release is created only after platform build jobs succeed. The desktop app does not redistribute Grok CLI; bootstrap installs it from the fixed official x.ai source.

## CI matrix

Pull-request and main-branch CI runs frontend checks plus Rust formatting, Clippy and tests. macOS 12+ is the only supported v1 runtime and release platform.

## macOS signing and notarization

Public macOS artifacts require a Developer ID Application identity, hardened runtime, notarization, stapling and Gatekeeper validation. Required repository secrets:

| Secret | Purpose |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64 `.p12` with certificate and private key |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` export password |
| `APPLE_SIGNING_IDENTITY` | Exact Developer ID Application identity |
| `APPLE_ID` | Notarization Apple ID |
| `APPLE_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | Apple developer team ID |

Local `npm run app:build` uses an ad-hoc signature for builder-machine testing and is not a distributable notarized artifact.
It proves compilation and bundle layout only: the release-mode Host intentionally
refuses to open its shared IPC credential without `APPLE_TEAM_ID` and matching
signed Keychain entitlements.

The bundle contains two signed executables: `grok-build-desktop` (UI Broker) and
`grok-build-agent-host` (LaunchAgent sidecar). Both must contain the same
`TEAMID.com.grokbuilddesktop.community.shared` Keychain access group. The Host
is never copied out of the signed bundle.

## Release procedure

1. Merge a green main branch.
2. Update versions in `apps/desktop/package.json`, `apps/desktop/src-tauri/Cargo.toml` and `apps/desktop/src-tauri/tauri.conf.json`.
3. Create and push a signed-off tag such as `v0.1.0`.
4. Verify the macOS universal build and its artifacts.
5. Verify macOS signature, stapled ticket and Gatekeeper output before announcing the release.

## Local quality gate

```bash
cd apps/desktop
npm ci
npm run check
npm audit --omit=dev --audit-level=high

cd src-tauri
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo audit
```

When Grok CLI is installed, also verify one real device-auth and ACP task, `grok inspect --json`, Goal controls, permission response, worktree review and safe apply.

Local release helpers:

```bash
# Validate a signed/notarized app or DMG.
./scripts/verify-macos-release.sh "/path/to/Grok Build Desktop.app"

# Monitor the independent Host for the eight-hour release soak window.
./scripts/soak-agent-host.sh 28800

# Run the signed universal RC preflight and guided real-Grok/UI recovery smoke.
./scripts/verify-v1-release-candidate.sh \
  "/Applications/Grok Build Desktop.app" \
  "/path/to/disposable/test-workspace"
```

The RC verifier records architecture, signing, LaunchAgent, database integrity,
task/terminal states and process evidence. It deliberately requires an explicit
`PASS` after the eight real UI checks; credentials and user-visible permission
decisions must not be automated or silently accepted.

## Recovery expectations

- Agent crashes preserve local task history, drafts, tool events and remote session ID; only the affected task needs retry.
- `session/load` restores remote state when ACP advertises support; otherwise a fresh remote session retains the local transcript.
- A failed apply preflight performs no writes.
- CLI updates remain delegated to the official updater.
- Desktop auto-update stays disabled until the project has stable signed update metadata for every platform.
