# Prototype baseline environment

Recorded at the first local checkpoint commit (`chore: checkpoint existing desktop prototype`).

| Tool | Version |
|------|---------|
| Grok CLI | `0.2.93` (`f00f96316d4b`) |
| Node.js | `v22.22.3` |
| rustc | `1.96.0` (`ac68faa20 2026-05-25`) |
| cargo | `1.96.0` (`30a34c682 2026-05-25`) |
| macOS | `27.0` (Build `26A5378j`) |
| Architecture | `arm64` (Apple Silicon) |

## Acceptance at checkpoint

```bash
cd apps/desktop && npm run build
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
grok plugin validate harness
```

All three succeeded at baseline time.
