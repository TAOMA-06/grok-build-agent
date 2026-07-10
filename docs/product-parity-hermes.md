# Product parity: Hermes-CN-Desktop → Grok Build Desktop

Reference: [Eynzof/Hermes-CN-Desktop](https://github.com/Eynzof/Hermes-CN-Desktop)

## Architecture parallel

| Hermes | Grok Build Desktop |
|--------|--------------------|
| Desktop shell (Tauri) | Same |
| Hermes-CN-Core managed runtime | External `grok` CLI + Runtime Health |
| Dashboard REST + Gateway WS | ACP stdio JSON-RPC |
| Bundled skills/plugins | `harness/` + Grok skills discovery |
| YOLO mode | Always-approve + restart |
| Onboarding | First-run wizard |
| Health / diagnostics | Runtime health panel + stderr logs |

## Status

| Surface | Status |
|---------|--------|
| Downloadable `.dmg` | Done |
| Onboarding wizard | Done (Phase A) |
| Runtime health checklist | Done (Phase A) |
| Settings persistence (app data) | Done (Phase A) |
| Workbench 3-column layout | Done (Phase A skeleton) |
| Chat + tools + plan stream | Done |
| Permission modal | Done |
| Orchestrator harness | Done (basic) |
| Plan approve UX | Planned |
| Multi-session archive | Planned |
| Skills / Memory / MCP UI | Planned |
| Diff / worktree | Planned |
| Windows installer | Planned |
| Apple notarization | Planned |

## Non-goals (Hermes-only)

- Feishu / DingTalk / WeCom onboarding
- Shipping a third-party agent core binary under our license
- PolyForm-NC license model
