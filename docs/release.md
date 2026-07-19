# Release and signing

## Published artifacts

The tag workflow builds and publishes the supported v1 target:

- macOS universal DMG and app ZIP (arm64 and x86_64)
- SPDX SBOM
- SHA-256 checksums

The GitHub Release is created as a **draft** only after platform build jobs
succeed. A maintainer must inspect the draft artifacts and explicitly publish
the release. The desktop app does not redistribute Grok CLI; bootstrap installs
it from the fixed official x.ai source.

## CI matrix

Pull-request and main-branch CI runs frontend checks plus Rust formatting,
Clippy and tests. macOS 12+ is the only supported v1 runtime and release
platform.

## macOS signing and notarization

Public macOS artifacts require a paid Apple Developer Program membership, a
Developer ID Application identity, hardened runtime, notarization, stapling and
Gatekeeper validation. Ad-hoc signatures are rejected by the release preflight.

The GitHub Actions workflow imports the certificate into an ephemeral CI
keychain and derives the signing identity from it. Do not store
APPLE_SIGNING_IDENTITY as a repository secret.

Required repository secrets:

| Secret | Purpose |
| --- | --- |
| APPLE_CERTIFICATE | Base64 .p12 with certificate and private key |
| APPLE_CERTIFICATE_PASSWORD | .p12 export password |

Recommended notarization authentication uses a narrowly scoped App Store
Connect API key:

| Secret | Purpose |
| --- | --- |
| APPLE_API_ISSUER | App Store Connect issuer ID |
| APPLE_API_KEY | App Store Connect key ID |
| APPLE_API_KEY_P8 | Base64 contents of the downloaded .p8 private key |

As an alternative, notarization can use an Apple ID:

| Secret | Purpose |
| --- | --- |
| APPLE_ID | Notarization Apple ID |
| APPLE_PASSWORD | App-specific password |
| APPLE_TEAM_ID | Apple developer team ID |

Supply one complete notarization method, never certificate files or .p8 keys
in the repository. The release safety check and .gitignore reject common
certificate and private-key filenames.

One-time Apple and GitHub setup:

1. The Apple Developer Program Account Holder creates a **Developer ID
   Application** certificate for com.grokbuilddesktop.community.
2. Export that certificate *with its private key* as a password-protected
   .p12, then base64-encode it:

       openssl base64 -A -in DeveloperID.p12 -out DeveloperID.p12.base64

3. Add the base64 value and the .p12 password to the two certificate secrets
   above.
4. Prefer an App Store Connect API key with Developer access. Download the
   .p8 file once, base64-encode it with the same command, and add its issuer,
   key ID and encoded value as the three API secrets.
5. Trigger the release workflow manually once before tagging. It must complete
   signing, notarization, stapling, universal-binary checks and Gatekeeper
   assessment before it can create a draft release.

Local npm run app:build uses an ad-hoc signature for builder-machine testing
and is not a distributable notarized artifact. npm run app:build:release and
npm run app:build:universal invoke the release preflight and refuse a missing,
ad-hoc, or non-Developer-ID identity.

The bundle contains two independently signed executables:
grok-build-desktop (UI Broker) and grok-build-agent-host (LaunchAgent sidecar).
The current app does not require an application-group entitlement: the xAI API
key remains in the user Keychain and the Host IPC credential is a user-owned
0600 local file. Both executables must be Developer ID-signed with the hardened
runtime and must not contain get-task-allow.

## Release procedure

1. Add the required signing and notarization secrets to GitHub.
2. Run npm run release:check from apps/desktop. It rejects token-shaped values,
   private keys and sensitive release files.
3. Merge a green main branch.
4. Update versions in apps/desktop/package.json,
   apps/desktop/src-tauri/Cargo.toml and
   apps/desktop/src-tauri/tauri.conf.json.
5. Trigger the release workflow from GitHub Actions to validate the
   credentials and universal build before tagging.
6. Create and push a signed-off tag such as v0.1.0; the workflow creates a
   draft release only.
7. Inspect the DMG, ZIP, SBOM, checksums, stapled ticket and Gatekeeper output,
   then publish the draft after a separate source and artifact review.

## Local quality gate

    cd apps/desktop
    npm ci
    npm run check
    npm audit --omit=dev --audit-level=high

    cd src-tauri
    cargo fmt --all -- --check
    cargo clippy --workspace --all-targets -- -D warnings
    cargo test --workspace
    cargo audit

When Grok CLI is installed, also verify one real device-auth and ACP task,
Grok inspect JSON output, Goal controls, permission response, worktree review
and safe apply.

Local release commands:

    # Builder-machine smoke package only; uses an ad-hoc signature.
    npm run app:build

    # Signed/notarized build; requires a real Developer ID identity plus one
    # complete notarization credential method in the environment.
    npm run app:build:release

    # CI-equivalent universal build; also enforces the release preflight.
    npm run app:build:universal

The CI workflow records architecture, signing, notarization stapling, DMG
integrity, Gatekeeper assessment, SBOM and checksums. Credentials and
user-visible permission decisions must not be automated or silently accepted.

## Recovery expectations

- Agent crashes preserve local task history, drafts, tool events and remote
  session ID; only the affected task needs retry.
- session/load restores remote state when ACP advertises support; otherwise a
  fresh remote session retains the local transcript.
- A failed apply preflight performs no writes.
- CLI updates remain delegated to the official updater.
- Desktop auto-update stays disabled until the project has stable signed update
  metadata for every platform.
