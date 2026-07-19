# Power harness

The harness makes Grok Build **use** its strengths instead of only exposing them in the UI. It tracks Grok CLI **0.2.103** (and 0.2.99+) and Desktop platform contracts (task focus, durable verification, privacy).

## What it contains

| Path | Role |
|------|------|
| `AGENTS.md` | Decision table: plan vs solo vs parallel; platform contract; review handoff |
| `agents/orchestrator.md` | Primary agent definition (plugin / profile) |
| `skills/orchestrate` | Fan-out / map-reduce style workflows |
| `skills/review-loop` | Lightweight implement → review → fix with file handoffs |
| `skills/ship` | Commit / PR |
| `skills/verify` | Build & test loop aligned with platform `Verify:` |
| `personas/*` | Implementer / reviewer / researcher overlays (I/O contracts) |
| `roles/*` | Capability defaults for implementer, reviewer, explore, plan |

## How Desktop loads it

When **Orchestrator harness** is on (default for new installs), the ACP host injects:

```json
session/new → params._meta.rules        // AGENTS.md + verify digest (always)
session/new → params._meta.pluginDirs   // absolute path to harness/ when resolvable
```

| Component | Loaded when harness is on |
|-----------|---------------------------|
| `AGENTS.md` + verify digest | Always (via `_meta.rules`) |
| `skills/*`, `agents/*` | When harness path resolves → `_meta.pluginDirs` (Grok session plugin) |
| `personas/*`, `roles/*` | Not part of plugin convention; copy into `.grok/personas` / `.grok/roles` for TUI native resolution |

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
```

Plugin install discovers `agents/` and `skills/` by convention. Personas and roles are discovered from `.grok/personas` / `.grok/roles` (project) and `~/.grok/personas` / `~/.grok/roles` (user) — copy or symlink them if you want native persona resolution in the TUI.

## Design rules encoded in the harness

1. Ambiguous high-risk work → plan mode first (plan file only writable)  
2. Research → `explore` subagents with thoroughness, often parallel  
3. Independent impl tracks → parallel `general-purpose` workers  
4. Conflicting edits → `isolation: "worktree"`  
5. Non-trivial quality → implementer/reviewer file handoff (`review-loop` skill)  
6. Finish with verify (project scripts + platform `Verify:` lines)  
7. Subagent depth is 1 — parent coordinates only  
8. Personas are **prompt-injected** (not a `spawn_subagent` field); tag `description` with `[role]`  

Grok’s bundled `/design` and `/execute-plan` remain the heavy DAG pipelines; this harness steers day-to-day sessions toward the same philosophy at smaller scale. For the full multi-reviewer implement skill, use Grok’s bundled `/implement`.

## Alignment with recent Grok / Desktop features

| Feature | Harness response |
|---------|------------------|
| Subagent personas + I/O contracts | `personas/*.toml` with inputs/outputs and capability defaults |
| Roles | `roles/*.toml` for explore/plan/implementer/reviewer |
| Optional per-worker `model` (0.2.98+) | Documented in AGENTS / orchestrate; omit to inherit parent |
| `wait_commands_or_subagents` | Named in AGENTS + orchestrate skill |
| Plan mode plan file | Session plan / `.grok/plan.md` conventions |
| Goal mode / durable tasks | Honor platform contract Goal/Acceptance |
| Background + monitor | AGENTS background section; orchestrate waits |
| Prompt cache efficiency | Short stable `AGENTS.md` + digest-only verify injection |
| Privacy / Private Chat | No exfil guidance; argv-only verify preference |
| Auto verification gate | Definition of done requires real `Verify:` evidence |
| Grok 4.5 in model catalog | Surface via CLI catalog; Desktop default remains `grok-build` unless user/settings choose otherwise |
