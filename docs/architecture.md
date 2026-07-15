# Architecture

## Product boundary

Grok Build Desktop is a task command center around the official Grok CLI and ACP runtime. It does not replace Grok's model API or tool runner. The product owns project/task organization, worktree isolation, persistence, supervision, permissions and change review.

## Renderer

`App.tsx` only selects bootstrap or the main shell and mounts providers. The active shell is split into:

- `ProjectSidebar`: projects, active/attention/archived tasks and search
- `ThreadView`: task header, normalized timeline, inline requests and composer
- `ContextDrawer`: activity, file stats, unified patches and safe apply
- `SettingsDialog`: General, Agent, Extensions, Diagnostics and About
- `BootstrapScreen`: CLI detection, official install and device authentication

React code talks through the `DesktopBridge` contract. `TauriDesktopBridge` owns all invoke/listen, dialogs, path opening and clipboard access. `MockDesktopBridge` provides deterministic browser scenarios and never requires a Tauri global.

TanStack Query owns persistent asynchronous resources such as workspaces, sessions, models, capability snapshots and Git reviews. Zustand is limited to live ACP state, normalized timeline blocks, drafts, attachments and current UI selection.

## Task lifecycle and modes

The first send performs one logical operation:

```text
save project → create local task → inspect Git → choose dirty policy if needed
→ create isolated worktree → start/reuse keyed ACP process
→ create/load remote session → send prompt → commit the user event
```

Composer submission is transactional. The renderer keeps a snapshot of text, attachments, mode and model while connecting. A failed connection, attachment preparation or RPC restores the draft and exposes a retry action; a successful prompt marks the optimistic user block as delivered.

Each task persists one of three modes. Agent is the normal implementation mode. Plan prefers ACP `configOptions`/`session/set_config_option`, falls back to Grok's `/plan` control command, and keeps direct ACP filesystem writes blocked in the host even when the task uses full-auto approvals. Goal sends the first objective through Grok's native `/goal` command. A live mode switch is persisted only after ACP confirmation; a failed control command leaves the original mode unchanged. Approving a Plan returns the same remote session to Agent mode, preserving its context.

Git tasks run from a managed worktree. Non-Git folders run directly. Switching the visible task does not stop other tasks; inbound events are routed using `connectionId`, remote `sessionId` and sequence.

The UI says task/thread, while the ACP and SQLite contracts retain session identifiers for compatibility.

## ACP host

`src-tauri/src/acp/` manages `grok agent [--model …] [--always-approve] stdio`. `RuntimePool` keys processes by workspace, sandbox, approval policy, power profile and model. A connection may host multiple remote sessions.

Protocol order:

1. `initialize` and capability negotiation
2. ACP authentication when advertised
3. `session/new` or `session/load`
4. `session/prompt` with validated text/image/embedded-resource `PromptContent`
5. normalized `session/update` events
6. exact-session cancel and server-request responses

Internal filesystem and terminal requests are handled by the host with workspace guards. Only genuine permission requests reach the renderer. A process exit fails pending RPCs, retains local history and exposes a retryable task error.

Provider cache policy keeps the model and tool schema stable for the lifetime of a started task. Task contracts are append-only: the host injects one full contract, records later turns as `history` with zero repeated contract tokens, and refreshes only after a task-definition change or explicit compaction. MCP changes restart into a new task rather than changing the tool prefix of a warm history. Cache usage is accepted from both ACP notifications and the final `session/prompt` response.

## Persistence

Settings schema v3 stores user-facing defaults, compact/multiline/timestamp preferences and the system/English/Simplified Chinese locale, while migrating legacy `alwaysApprove`, `useHarness`, model and cwd fields. SQLite schema v4 keeps the v3 session projection for UI compatibility and adds the immutable control-plane event store, task/turn records, prompt dispatch journal, projection checkpoints, tool/permission/artifact/runtime/worktree/job/audit records, context manifests, memory candidates and blob references.

Before a v1–v3 catalog is upgraded, WAL is checkpointed and a versioned backup is created next to the database. The former 200-row event cache is imported with `legacy_partial_history=1`; it is never presented as a complete transcript. New compatibility events are written to `platform_events` without trimming, with a deterministic dedupe key. Large structured event payloads are moved to the SHA-256 content-addressed blob store.

Prompt delivery uses a persistent state machine: `prepared → sending → acknowledged`. A Host restart changes any remaining `sending` record to `delivery_unknown`. Because current Grok ACP does not advertise prompt idempotency, the desktop refuses automatic redelivery until the user explicitly resolves the uncertain attempt. UI retry keeps the same idempotency key by deriving it from the local task and message block.

The settings model is only the default for new tasks. A disconnected task persists its own model immediately; a live task persists only after ACP confirms the switch. When the CLI cannot live-switch, the renderer offers a new task with the current draft and runtime options while leaving the original task untouched.

The supported v1 data path is the macOS Application Support directory.

## Git safety

Worktrees are created without shell concatenation and require an explicit policy when the source workspace is dirty. Applying a task back to its project is a two-step operation:

1. Preview performs no writes and requires a clean main workspace, matching base commit, successful `git apply --check --binary`, safe relative untracked paths and no destination conflicts.
2. Confirmed apply repeats the entire preflight immediately before writing, applies the binary patch and copies pre-read untracked files. Copy failure reverses the tracked patch and removes files already copied.

No discard, reset-hard or automatic conflict resolution is provided.

The review API also supports file/hunk stage and unstage, tracked-file revert, commit and checkpoints. Revert always creates a checkpoint first. Checkpoints live under the repository Git directory and contain HEAD, binary working/index patches and bounded copies of regular untracked files; symlinks, unsafe relative paths, more than 1,000 files or more than 100 MB are rejected.

## Control-plane contracts and policy

Rust is the canonical source for the versioned `PlatformEvent`, `PromptDispatch`, `ActionRequest`, `PolicyDecision` and Runtime Adapter contracts. The desktop exposes their JSON Schema and mirrors their camelCase wire shapes in TypeScript. Every production event requires workspace, task, session, runtime and correlation attribution.

`GrokAcpAdapter` implements the runtime-neutral lifecycle over the existing pool and is covered by a mock-ACP conformance test for spawn, initialize, prompt, cancel and shutdown. Grok currently reports `promptIdempotency=false`, so duplicate suppression remains a platform responsibility.

ACP terminal creation is classified before process launch. Shell/interpreter inline code, network programs, publishing and destructive Git are fail-closed with `POLICY_CONFIRMATION_REQUIRED`; argv-only local commands are allowed once. Policy decisions are emitted as normalized events, redacted and copied into the append-only audit table. Native ACP permission requests are persisted, survive renderer restarts, expire fail-closed, and are marked interrupted after a Host restart when the reverse request can no longer be resumed safely.

## Production upgrade boundary

Schema v4, Adapter contracts, dispatch recovery, content-addressed blobs, baseline policy/audit and Git checkpoints are implemented.

The out-of-process Host is a distinct `grok-build-agent-host` sidecar bundled and signed beside the UI executable. It owns a separate RuntimePool, marks in-flight dispatches uncertain on startup, serves authenticated length-prefixed JSON-RPC over a mode-0600 Unix socket, verifies peer UID plus a per-install token in a shared Data Protection Keychain access group, and broadcasts ACP events. macOS LaunchAgent installation/wakeup and Tauri health negotiation are implemented. Only development builds may explicitly select the in-process fallback.

Core Runtime ownership is now cut over: Runtime start/stop/status, Prompt, cancellation, model/mode changes, raw ACP requests and permission responses are proxied through `HostClient`, and Host events are forwarded through an automatically reconnecting subscription. Closing the UI no longer owns or drops the active RuntimePool.

The Host is the SQLite/Blob single writer and owns Runtime, catalog, Git/worktree, attachment, MCP/plugin, settings/Keychain and workspace-explorer operations. Tauri is a typed RPC and event broker and never opens the catalog. Every write RPC carries request/correlation/idempotency metadata; completed results are persisted by key. Event subscriptions resume from the last accepted SQLite rowid and filter replay/live overlap.

Terminal execution uses a real PTY with input, resize, bounded output and process-group termination. Checkpoints support a no-write restore preview, refuse HEAD drift or dirty/conflicting destinations, and restore staged, working and bounded untracked state only after preflight.

Task, Session, Turn, Tool Call and Permission snapshots are projected from the immutable event stream into `entity_projections`. Doctor rebuilds into a temporary table inside one transaction, validates typed Task/Session snapshots, and replaces the current projection only after replay succeeds. Task contracts, Context Manifests, structured verification results and the completion gate are Host-owned; a Runtime completion response moves a Task to `verifying`, never directly to `completed`.

The Context Manifest records the platform task contract, user instruction and attachments actually sent for each Turn. Task contracts are injected in a separate trusted partition; repository, MCP, web and attachment content is explicitly labelled untrusted data. Allowed modification paths are enforced again by the Host on ACP filesystem writes.

Remaining release validation is environmental rather than an in-process fallback: real Grok authentication, signed/notarized installation on Intel and Apple Silicon Macs, and soak/chaos runs. Grok cannot attest direct network isolation, so Strict mode stays unavailable instead of presenting an unenforceable guarantee. Long-term Memory, Profiles, Job scheduling and additional Runtime adapters are outside coding-agent v1.

## Capability discovery

The host normalizes `grok inspect --json` into Skills, Plugins, Hooks, MCP servers, commands and rules. It also parses Grok 0.2.93's initialize `_meta.modelState` and `_meta.availableCommands`, plus session `configOptions`, `availableModes` and live catalog/mode update events.

The composer builds one command catalog in this order: desktop-native equivalents, current ACP commands, user-invocable skills and documented-but-unavailable TUI commands. Native commands win name collisions; conflicting skills use a scoped `/source:name` form. Unknown commands are blocked until the user explicitly chooses to send them as an ordinary message. `/clear` follows Grok's new-empty-task behavior; clearing only the draft is a separate composer button. The slash menu and `Cmd+K` palette expose aliases, parameter hints, source and support state.

Visible shell copy, settings, MCP forms, dialogs, ARIA labels and status messages use the shared reactive i18n dictionary. New installs follow macOS language, while settings can force English or Simplified Chinese without restarting. Grok/OS/Git/MCP diagnostic text stays verbatim and receives only localized surrounding context.

MCP configuration remains owned by Grok CLI. The Extensions settings surface edits stdio/HTTP/SSE servers through argv-only commands, supports user/project scope, preserves existing secret values inside Rust, and returns only secret key names to the renderer. Doctor processes have a 15-second timeout and their output is redacted before display. Configuration changes require an explicit Agent reload.

Attachments are limited to ten files and 20 MB total. Text/code is capped at 1 MB; PNG, JPEG, WebP and PDF are capped at 10 MB. Tauri-selected paths are read by Rust at send time and converted to embedded ACP content, while pasted browser files follow the same validation policy.

## Supported runtime

The open-source v1 supports macOS 12+ and the official Grok CLI/ACP runtime. Windows and Linux code paths are compatibility scaffolding only and carry no support or release promise.

## Non-goals for 1.0

- Full IDE/LSP/debugger
- Cloud execution or multi-tenant hosting
- Scheduled automations
- Replacing Grok's native Goal, Subagents, Skills, Plugins, Hooks, MCP or Memory
