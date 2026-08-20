# Power harness

The harness makes Grok Build **use** its strengths instead of only exposing them in the UI. It tracks Grok CLI **1.0.5** (1.0+) and Desktop platform contracts (task focus, durable verification, privacy, `GROK_CONFIG` overlay).

Desktop + harness transfer notes: [handoff.md](handoff.md).

## What it contains

| Path | Role |
|------|------|
| `AGENTS.md` | Decision table: plan vs solo vs parallel vs workflow; platform contract; review handoff |
| `agents/orchestrator.md` | Primary agent definition (plugin / profile) |
| `skills/orchestrate` | Fan-out: prefer `workflow`, else `spawn_subagent` |
| `skills/review-loop` | Lightweight implement → review → fix with file handoffs |
| `skills/ship` | Commit / PR |
| `skills/verify` | Build & test loop aligned with platform `Verify:` |
| `workflows/review-changes.rhai` | Bounded multi-dimension review → adversarial verify |
| `personas/*` | Implementer / reviewer / researcher / security-auditor / test-writer overlays |
| `roles/*` | Capability defaults including explore, plan, quick-search |

## How Desktop loads it

When **Orchestrator harness** is on (default for new installs), the ACP host injects:

```json
session/new → params._meta.rules        // AGENTS.md + verify digest (always)
session/new → params._meta.pluginDirs   // absolute path to harness/ when resolvable
```

The spawned `grok agent` process also receives a **`GROK_CONFIG`** overlay (Grok 1.0.5 allowlist: `features` / `models`). Harness sessions set `features.codebase_indexing = true` without editing the user’s `config.toml`. Reasoning effort from `StartConfig` is mirrored under `models.default_reasoning_effort` when present.

| Component | Loaded when harness is on |
|-----------|---------------------------|
| `AGENTS.md` + verify digest | Always (via `_meta.rules`) |
| `skills/*`, `agents/*` | When harness path resolves → `_meta.pluginDirs` (Grok session plugin) |
| `workflows/*.rhai` | Not a plugin convention. Orchestrate skill reads the script from the plugin directory and passes it to the `workflow` tool. Copy into `.grok/workflows/` for TUI name invocation. |
| `personas/*`, `roles/*` | Not part of plugin convention; copy into `.grok/personas` / `.grok/roles` for TUI native resolution. Desktop still injects a short role digest via `_meta.rules` so workers get narrow capability guidance without the copy step. |

**Path resolution** (`GROK_BUILD_HARNESS_DIR` override, then executable-relative, then repo `harness/` for dev). Release bundles stage harness under `Resources/harness` and next to the Agent Host binary. If resolution fails, Desktop soft-falls back to **rules-only** injection (no session crash).

Keep `AGENTS.md` cache-friendly: the host injects it once per session and relies on provider prompt cache for later turns. Avoid churning the harness body between minor releases unless behavior must change.

Workspace `AGENTS.md` / `Agents.md` (up to 32 KB) is also appended when present so project conventions travel with the session. The host reads it through a no-follow workspace file handle, accepts only a regular non-linked file, and rejects links or paths that resolve outside the workspace. Its content is XML-escaped, wrapped as untrusted repository data, and preceded by an explicit rule that it cannot override user intent, authorization, privacy, or safety policy.

Platform task contracts (`<platform_task_contract>`) are injected separately as **trusted** focus: Goal, Acceptance, Verify, Allowed path. Harness rules tell the agent to treat those as authoritative.

Handoff artifacts must stay **inside the workspace** (e.g. `.grok/scratch/<id>/`). Desktop policy often requires confirmation or denies terminal/FS paths outside the workspace or outside task `Allowed path` lists.

## How TUI users load it

```bash
grok plugin install /path/to/grok-build/harness --trust
# or copy skills into a project .grok/skills
# personas: copy harness/personas/*.toml into .grok/personas/ (or ~/.grok/personas/)
# roles:    copy harness/roles/*.toml into .grok/roles/
# workflows: copy harness/workflows/*.rhai into .grok/workflows/
```

Plugin install discovers `agents/` and `skills/` by convention. Personas and roles are discovered from `.grok/personas` / `.grok/roles` (project) and `~/.grok/personas` / `~/.grok/roles` (user). Named workflows are discovered from `.grok/workflows/` — they are not auto-loaded from the plugin directory.

## Design rules encoded in the harness

1. Ambiguous high-risk work → plan mode first (plan file only writable)
2. Research → index tools first, then `explore` subagents with thoroughness, often parallel
3. Independent impl tracks → parallel `general-purpose` workers, wave cap 8
4. Known independent review shards → `workflow` (`review-changes.rhai`) when advertised
5. Conflicting edits → `isolation: "worktree"`
6. Non-trivial quality → implementer/reviewer file handoff (`review-loop` skill)
7. Finish with verify (project scripts + platform `Verify:` lines)
8. Subagent depth is 1 — parent coordinates only
9. Personas are **prompt-injected** (not a `spawn_subagent` field); tag `description` with `[role]`
10. Implementers need file writes (`all` or omit `capability_mode`). Never `execute` for implementers.

Grok’s bundled `/design`, `/execute-plan`, and `/implement` remain the heavy DAG pipelines; this harness steers day-to-day sessions toward the same philosophy at smaller scale.

## Alignment with recent Grok / Desktop features

| Feature | Harness response |
|---------|------------------|
| Grok Build 1.0.5 / Grok 4.6 catalog | Inherit parent model; never invent slugs; effort may include `xhigh` |
| Workflows (0.2.111+, first-class in 1.0) | `orchestrate` prefers `workflow` + `review-changes.rhai` |
| Failed workflow resume (0.2.112+) | Documented; use platform resume when advertised |
| Bounded subagent fan-out (1.0.1) | Wave cap 8; excess queued |
| `GROK_CONFIG` overlay (1.0.5) | Host injects `features.codebase_indexing` for harness sessions |
| Codebase indexing default on | AGENTS prefers index/codegraph before grep |
| `/rewind` conversation-only (1.0.1) | `/undo` restores chat, not files |
| Stop kills prior-turn background subagents (0.2.117+) | Documented; Desktop cancel uses `session/cancel` |
| Plan mode does not gate child writes | Never spawn write-capable children while planning; Host still blocks parent ACP FS writes |
| Subagent personas + I/O contracts | `personas/*.toml` including security-auditor and test-writer |
| Roles | `roles/*.toml` for explore/plan/implementer/reviewer/quick-search/security/tests |
| Optional per-worker `model` | Documented; omit to inherit parent |
| `/summarize` alias for `/recap` | Documented ACP command + Desktop catalog alias |
| `/usage` token + cost | Documented ACP command in Desktop catalog |
| `/delete` session | Desktop local confirm + task delete |
| MCP enable/disable | Settings MCP cards call `grok mcp enable\|disable` |
| In-place scheduled tasks; one-time retired | Prefer Host jobs + background commands |
| Host jobs CRUD | `jobs.list` / `jobs.upsert` / `jobs.cancel` |
| Disable image/video tools | Settings → `--disallowed-tools` at process spawn |
| `wait_commands_or_subagents` | Named when advertised; else `get_command_or_subagent_output` |
| Prompt cache efficiency | Short stable `AGENTS.md` + digest-only verify/role injection |
| Host terminal policy (fail-closed v2) | Shells, interpreters, `npm run`, containers, network CLIs require confirmation |
| Privacy / Private Chat | No exfil guidance; argv-only verify preference |
| Auto verification gate | Definition of done requires real `Verify:` evidence |
