# Contributing

Thanks for helping improve Grok Build Desktop.

## Setup

1. Install Rust, Node 20+, and Grok Build CLI.  
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
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```
