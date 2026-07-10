# Type contracts (T01)

Shared domain contracts for **Grok Build Community Desktop**.

| Layer | Path |
|-------|------|
| TypeScript | `apps/desktop/src/contracts/` |
| Rust (serde mirror) | `apps/desktop/src-tauri/src/contracts/` |
| App re-exports | `apps/desktop/src/types.ts` |

Wire format: **camelCase** JSON for all IPC / events.

## Core types

| Type | Purpose |
|------|---------|
| `RuntimeSnapshot` | Pool of ACP connections + active selection |
| `ConnectionKey` | `workspaceRoot + sandbox + powerProfile` |
| `SessionSummary` | Sidebar / SQLite session index row |
| `SessionEventEnvelope` | `connectionId`, `sessionId`, `sequence`, `timestamp`, `source`, `kind`, `payload` |
| `PermissionPrompt` | UI modal; options come from Agent only |
| `ReviewSnapshot` | Git status + diff index (read-only first ship) |
| `WorkspaceRecord` / `WorktreeSummary` | Workspace picker + worktree lifecycle |

## Rules

1. **Do not hardcode** permission option IDs such as `allow-once`. Use Agent `optionId` values.
2. **fs / terminal** server methods are internal handlers, never permission modals.
3. Events for parallel sessions must include envelope fields so streams cannot cross-wire.
4. API keys must not appear in logs or error strings (Keychain migration in later tasks).
5. When adding fields, update **both** TS and Rust mirrors and add a round-trip test.

## Tests

```bash
cd apps/desktop && npm test
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml contracts::
```
