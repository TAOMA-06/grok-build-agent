# Upstream and market baseline

Research cutoff: 2026-09-03
Evidence rule: official documentation and official/public source are primary. Community product capabilities below are repository or Release claims unless explicitly marked as locally verified.

## Executive conclusion

The category is already crowded. “A GUI for Grok Build” is not a defendable product.

The defendable gap is narrower:

> A Grok-native macOS coding control plane with fail-closed compatibility, safer worktree delivery, independent Review/Verify gates, crash-safe task ownership, and an exportable evidence chain.

This conclusion changes the roadmap: generic chat, model selection, Plan, sessions, worktrees, plugins, and a dashboard are baseline infrastructure, not differentiation.

## Official Grok baseline

### Current version evidence

- Local executable: `grok 1.0.5 (5115b46bc909)`.
- A live, non-installing `grok update --check --json` on 2026-09-03 returned official stable `1.0.13`, with an update available. The global CLI was not updated; this check is not claimed to leave every Grok cache/state file untouched.
- The current product explicitly tracks only 1.0.0–1.0.5.
- Official [1.0.13 changelog](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/changelogs/1.0.13.md) is dated 2026-08-28.
- Official public source is a periodic monorepo sync under [Apache-2.0](https://github.com/xai-org/grok-build); external contributions are not accepted. A specific public commit is source evidence, but the sync may lead or lag stable and must not be treated as the installed contract.

### Current live ACP evidence

A local no-prompt ACP `initialize` against 1.0.5, using an isolated temporary `GROK_HOME`, returned:

- protocol version 1;
- session list/resume/close;
- HTTP/SSE MCP capabilities;
- embedded context;
- current model `grok-4.6` plus `grok-4.5`;
- 500,000-token model metadata and model-specific reasoning choices;
- available commands including Compact, Context, Deep Research, Workflow, and Goal;
- image prompt capability `false` for that runtime handshake.

No authentication or inference request was made. This proves discovery behavior, not end-to-end task success.

### Official features we must not merely duplicate

Official docs already cover:

- [sessions, resume, fork, rewind, compact, and todos](https://docs.x.ai/build/features/sessions);
- [worktree sessions](https://docs.x.ai/build/features/worktrees);
- [Agent Dashboard](https://docs.x.ai/build/features/dashboard);
- [background commands, loops, monitors, and prompt queues](https://docs.x.ai/build/features/background-tasks);
- [subagents](https://docs.x.ai/build/features/subagents);
- [Plan, Auto, and Always-approve modes plus a large command surface](https://docs.x.ai/build/modes-and-commands);
- [Skills, Plugins, Marketplaces, Hooks, MCP and compatibility discovery](https://docs.x.ai/build/features/skills-plugins-marketplaces);
- [headless and ACP integration](https://docs.x.ai/build/cli/headless-scripting).

The [Sessions documentation](https://docs.x.ai/build/features/sessions) still describes restoring files during Rewind, while the later 1.0.1 changelog changed `/rewind` to truncate conversation history only. File restoration semantics for 1.0.13 remain **not verified** until a real stable protocol probe resolves that conflict.

### Official boundaries our product can improve

- [Sandbox](https://docs.x.ai/build/features/sandbox) is off by default.
- Official docs state macOS child-network blocking is a no-op for read-only/strict profiles and in-process model/web traffic is not blocked.
- [Plan Mode](https://docs.x.ai/build/features/plan-mode) gates edit tools, but shell redirection can still write and child agents do not inherit the parent edit gate.
- Private `x.ai/*` extensions are SpaceXAI-specific and non-exhaustive; the official [Agent-mode documentation](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/15-agent-mode.md) does not provide a stability guarantee. Clients must use capability evidence and safe fallback rather than call guessed methods.
- Stable releases move quickly. Official 1.0.6 introduced a breaking subagent change: `capability_mode` was removed in favor of agent type. The current bundled harness still uses that field in instructions, roles, personas, and workflows.
- 1.0.7–1.0.13 added richer permission choices, MCP elicitation, workflows, queue behavior, hook ask/defer/context decisions, retries, and persistence changes. These affect a desktop client even when ACP version remains `1`.

## Direct Grok desktop competition

| Product | First-party repository/Release claim | Strategic implication |
| --- | --- | --- |
| [wangyingxuan383-ai/grok-build-desktop 0.9.3](https://github.com/wangyingxuan383-ai/grok-build-desktop/releases/tag/v0.9.3) | Windows/Chinese Electron suite with accounts, Review, persistent queues, tasks, provider routing, Computer Use and extensive release claims; its stated real-CLI evidence reaches 1.0.3. | It occupies “Chinese Windows all-in-one.” Do not chase its breadth. |
| [phuryn/grok-build-vscode 4.1.2](https://github.com/phuryn/grok-build-vscode/releases/tag/v4.1.2) | VS Code plus Electron Desktop, parallel sessions, diffs, worktrees, rewind, media/voice and remote control; macOS signing/notarization is documented. Its source uses FSL-1.1-MIT. | Remote control and multi-provider breadth are not first-release battles. Use only as a product reference, not copied code. |
| [rimusz/grok-build-desktop 0.3.3](https://github.com/rimusz/grok-build-desktop/releases/tag/v0.3.3) | SwiftUI/macOS 26 client with sessions, dashboard, worktrees, review, browser/Computer Use and signed/notarized Release claims. | “Native macOS” alone is not differentiation. |
| [Rushour0/grok-build-desktop 0.11.1](https://github.com/Rushour0/grok-build-desktop/releases/tag/v0.11.1) | Cross-platform Tauri wrapper with diff, checkpoint, task panel, receipt, signing/notarization claims and upstream drift automation. | Diff plus a basic receipt is already table stakes; we need stronger provenance and fail-closed behavior. |
| [JaydenCJ/grok-build-desktop 0.4.0](https://github.com/JaydenCJ/grok-build-desktop/releases/tag/v0.4.0) | Grok-only Tauri app with streaming, queue, sessions and Skills/MCP; several review/subagent features remain on its roadmap and its license is source-available/all-rights-reserved. | It is the nearest shape to a generic Tauri wrapper. Do not converge on that feature-list strategy and do not copy its source. |
| [phuryn Desktop documentation](https://github.com/phuryn/grok-build-vscode/blob/main/docs/desktop.md) and other similarly named repos | Multiple public products already ship under “Grok Build Desktop” or “Grok Desktop.” | A distinct brand is a product requirement, not cosmetic polish. |

Community claims were not independently exercised in this phase, and this audit did not find confirmed 1.0.13 installed-app compatibility evidence for those five products. They establish competitive scope, not correctness.

## Competitive gap

Features that are not a moat:

- chat and Markdown;
- a model picker;
- a Plan toggle;
- sessions and search;
- generic worktrees;
- MCP/Skills/Plugins listing;
- a task dashboard;
- diff rendering;
- signed macOS packaging by itself.

The proposed moat is the combined system:

1. **Compatibility receipt** — exact runtime/version/capability/private-method record per task.
2. **Host-enforced Plan** — repository and subagent write escape tests, not a label.
3. **External managed worktree** — no source-checkout pollution and no nested ownership.
4. **Independent Review/Verify** — frozen diff and run provenance, with no self-certified completion.
5. **Crash-safe execution** — exact task ownership and stable idempotency keys for side-effecting operations.
6. **Release truth** — the downloaded artifact, not the build folder or Release prose, is the evidence subject.

## Naming and legal boundary

- `Grok Build Desktop` is heavily used by unrelated projects and creates search, support, and trust confusion.
- Use an independent primary brand with a descriptive subtitle such as “Coding workbench for Grok Build.”
- Keep an explicit non-affiliation statement and treat Grok/xAI marks as compatibility references only.
- Do not copy from FSL or source-available competitors. Product observation and independently implemented behavior are allowed evidence inputs; source reuse requires a per-file license decision.
- Continue to avoid bundling the official CLI in the first release. The published ACP boundary is easier to update and keeps authentication/runtime ownership clear.

## Upstream tracking policy

For each release candidate:

1. Read the official stable pointer without installing.
2. Freeze latest stable and immediately previous stable.
3. Record public source commit and `SOURCE_REV` separately.
4. Capture redacted `initialize`, `session/new`, mode/config, permission, tool, subagent, hook/MCP elicitation, cancel, completion, and resume fixtures from both stable binaries.
5. Run no-inference probes first; authenticated prompt tests are a separate gate and may consume usage.
6. Reject guessed private methods and record `Method not found` as unsupported, not as a generic runtime failure.
7. Open a compatibility change before enabling new capabilities in the UI.
8. Never upgrade the user's global CLI as part of a probe without explicit authorization and a rollback plan.

## Immediate upstream findings for R1

- Replace new-install hard-coded `grok-4.5` with live ACP model state. [Current official documentation](https://docs.x.ai/developers/grok-4-6) identifies Grok 4.6 as the Grok Build default and the local 1.0.5 ACP handshake agreed; the 1.0.13 model handshake remains not run.
- Remove the obsolete `capability_mode` contract from the harness for 1.0.6+ or version it explicitly.
- Add 1.0.12/1.0.13 fixtures and hook/MCP elicitation request handling.
- Treat prompt image support as capability-driven; local 1.0.5 ACP advertised it as unavailable.
- Reconcile `_x.ai/*` transport names and plain `x.ai/*` logical names at one tested boundary.
- Keep macOS network isolation labelled “not enforced” unless independent OS-level evidence changes.

The naming, trademark, and competitor-license conclusions here are product-policy recommendations, not legal advice.
