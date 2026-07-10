# Release & signing (T15)

## Bundle identity

- Product name: **Grok Build Desktop** (community)
- Target bundle ID: `com.grokbuilddesktop.community`
- Engine: Grok Build CLI only (no reimplemented tool loop)

## Quality gates (required before tag)

```bash
cd apps/desktop && npm test && npm run build
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
grok plugin validate harness
```

GitHub Actions: `.github/workflows/ci.yml` on PR/push; release on `v*` tags.

## Local package

```bash
./scripts/build-macos.sh
# or
cd apps/desktop && npm run app:build
```

## Apple codesign & notarization

Community CI builds are **unsigned** unless you provide secrets:

| Secret | Purpose |
|--------|---------|
| `APPLE_CERTIFICATE` | Base64 `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | p12 password |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: …` |
| `APPLE_ID` | Apple ID email |
| `APPLE_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | Team ID |

Configure Tauri `bundle.macOS.signingIdentity` / notarization when secrets are available. Staple after notarization before publishing the DMG.

## SBOM / audit

- Optional: `cargo audit` and CycloneDX/SPDX SBOM attachment on Release.
- Run dependency review before public 1.0.

## Recovery expectations

- Agent crash: pending requests fail; UI can reconnect.
- CLI update failure: previous binary remains (install script not overwriting blindly on failure).
- Auth expiry: Settings → Sign in with OAuth / API key Keychain.
