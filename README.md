# Grok Build Desktop

> A local-first, open-source macOS control plane for reliable Grok Build coding agents.

[![CI](https://github.com/TAOMA-06/grok-build-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/TAOMA-06/grok-build-agent/actions/workflows/ci.yml)
[![Release](https://github.com/TAOMA-06/grok-build-agent/actions/workflows/release.yml/badge.svg)](https://github.com/TAOMA-06/grok-build-agent/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: macOS 12+](https://img.shields.io/badge/platform-macOS%2012%2B-black)](#install)

A project-first desktop agent for the official [Grok Build CLI](https://docs.x.ai/build/overview). It uses a Codex-style task command center—projects, parallel threads, isolated worktrees, execution activity and reviewable diffs—without requiring users to manage ACP connections, CLI arguments or free-form model IDs.

This is an unofficial community project and is not affiliated with xAI.

The app has no product telemetry and keeps local workspace data on the Mac. See [Privacy](PRIVACY.md), [Security](SECURITY.md), and the [Threat Model](THREAT_MODEL.md).

## Install

GitHub Releases publish:

- macOS universal DMG (`arm64` + `x86_64`)

macOS 12 or later is the only supported v1 platform. Windows and Linux support is not currently provided.

Grok Build CLI remains an official xAI-managed dependency and is not bundled into the app. If it is missing, the first screen downloads the fixed official installer from `https://x.ai`; authentication uses `grok login --device-auth`. Existing installations and signed-in users go directly to the workspace.

The app installs a per-user LaunchAgent so confirmed tasks and terminals continue
when the UI closes. Before deleting the app manually, remove that service with:

```bash
"/Applications/Grok Build Desktop.app/Contents/MacOS/grok-build-desktop" --uninstall-agent-host
```

## Using the app

1. Open a project folder.
2. Describe the task and send it. The app saves the project, creates the task, prepares a worktree for Git projects, starts ACP and sends the prompt as one operation.
3. Run other tasks in parallel from the sidebar. Events remain routed by connection and remote session ID.
4. Review activity and file changes from the task drawer.
5. Use **Apply to project** when ready. The app performs a no-write dry-run and only enables apply when the main workspace is clean, HEAD matches the task base commit, the patch applies cleanly and untracked files do not conflict.

Agent is the default mode. Plan is a task-level, read-only planning mode that must be approved before the same task returns to implementation. Goal exposes status, pause, resume and clear controls. The composer always shows task mode, model, sandbox and approval policy.

## Product capabilities

- Project and task sidebar with running, attention, completed and archived states
- Independent signed Agent Host sidecar: UI exit does not stop confirmed work
- Concurrent ACP sessions with crash recovery and append-only event replay
- Automatic Git worktrees and explicit dirty-worktree choice
- Markdown/GFM responses, compact tool activity, plans, subagents and inline permissions
- Attachments by picker, drag-and-drop and paste
- Changes drawer with stats, unified patches, file actions, review prompts and safe apply
- Grok capability discovery from `grok inspect --json` for Skills, Plugins, Hooks, MCP and commands
- Grok-compatible searchable slash commands merged from desktop actions, live ACP commands and skills; unsupported TUI-only commands are explicitly disabled
- Session-scoped model, sandbox and permission controls with safe new-task fallback when live model switching is unavailable
- SQLite v4 immutable control-plane events, prompt idempotency journal and explicit uncertain-delivery recovery
- Runtime-neutral Adapter contract with Grok ACP conformance coverage and versioned JSON Schema
- SHA-256 content-addressed diagnostic blobs plus redacted policy audit records
- File/hunk stage and unstage, checkpoint-before-revert and commit controls in the changes workbench
- Recoverable task-bound PTY tabs with input/resize, process-tree cancellation, output quotas and listening-port discovery
- Host-executed verification commands with immutable exit-code/output evidence; the Renderer cannot forge passed results
- Full stdio/HTTP/SSE MCP editor with user/project scope, write-only secrets, Doctor diagnostics and explicit Agent reload
- Text, code, PNG/JPEG/WebP and PDF attachments with size limits, drag/drop, paste and failure-safe draft recovery
- Dark, light and system themes; reactive system/English/Simplified Chinese preference
- Settings v3 and versioned SQLite migrations that retain existing sessions

## Development

Requirements: current Node.js/npm, Rust and the Tauri platform prerequisites.

```bash
cd apps/desktop
npm install
npm run app:dev
```

Development uses the explicit in-process Host fallback. Release bundles never
fall back: they require the packaged `grok-build-agent-host` sidecar. Public
builds also require `APPLE_TEAM_ID` so the UI and Host share only the per-install
IPC credential through a Data Protection Keychain access group.

The same interface can be previewed without Tauri; browser mode automatically uses deterministic MockBridge scenarios:

```bash
cd apps/desktop
npm run dev
```

Quality gate:

```bash
cd apps/desktop
npm run check

cd src-tauri
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

## Architecture and safety

React components depend on `DesktopBridge`, not Tauri APIs. `TauriDesktopBridge` owns production IPC and `MockDesktopBridge` supports browser testing. TanStack Query owns persistent async resources; Zustand owns live task events, drafts and UI selection. The Rust ACP host and SQLite catalog retain `session` terminology for protocol compatibility while the UI calls them tasks.

The default permission policy permits normal commands and edits inside the selected workspace. Network access, workspace-external access, credentials and dangerous actions remain approval boundaries. Commands are launched with argv arrays, secrets are redacted, and apply never writes when preflight fails.

See [architecture](docs/architecture.md), [release procedure](docs/release.md) and [ACP mapping](docs/acp-mapping.md).

## Repository layout

```text
apps/desktop/       React + Tauri desktop application
harness/            Optional legacy compatibility rules (off by default)
scripts/            Local build helpers
.github/workflows/  macOS CI and signed/notarized release jobs
docs/               Architecture, contracts and release notes
```

## License

MIT — see [LICENSE](LICENSE).
