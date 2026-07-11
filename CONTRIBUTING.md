# Contributing

Thanks for helping improve Grok Build Desktop.

## Setup

1. Install Rust, Node 22+, macOS 12+, and Grok Build CLI.
2. `cd apps/desktop && npm install`  
3. `npm run tauri dev`

## Guidelines

- Keep the agent runtime in Grok Build — desktop code should be client/host only.  
- Prefer small, reviewable PRs.  
- Match existing TypeScript / Rust style.  
- Document new ACP event mappings in `docs/acp-mapping.md`.  

## Checks before PR

```bash
cd apps/desktop
npm run check

cd src-tauri
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Security-sensitive issues must use private vulnerability reporting. See `SECURITY.md`, `PRIVACY.md`, and `THREAT_MODEL.md` before changing IPC, permissions, filesystem access, process execution, or diagnostics.
