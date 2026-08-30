# OpenCode / Codex UI design study

Date: 2026-08-30  
Scope: Grok Build Desktop UI-only refactor; preserve capability contracts and runtime behavior.

## Source boundary

- OpenCode source inspected at `anomalyco/opencode@dc4449df0d52199704ea4989a5a993ebbc605612`.
- Codex source inspected at `openai/codex@6478a751fde8884b2fdc76486fe23175a8e795d4`.
- OpenAI's official open-source inventory lists Codex CLI, SDK, and App Server. It does not list the Codex desktop client as open source. The desktop product is therefore used only as an official product reference; implementation study is limited to the open Codex TUI and App Server.

Primary references:

- OpenCode Desktop layout: https://github.com/anomalyco/opencode/blob/dev/packages/app/src/pages/layout-new.tsx
- OpenCode session workspace: https://github.com/anomalyco/opencode/blob/dev/packages/app/src/pages/session.tsx
- OpenCode prompt input: https://github.com/anomalyco/opencode/blob/dev/packages/session-ui/src/v2/components/prompt-input/index.tsx
- OpenCode titlebar tabs: https://github.com/anomalyco/opencode/blob/dev/packages/app/src/components/titlebar-tab-strip.tsx
- OpenCode theme mapping: https://github.com/anomalyco/opencode/blob/dev/packages/ui/src/theme/v2/mapping.ts
- Codex TUI bottom pane: https://github.com/openai/codex/blob/main/codex-rs/tui/src/bottom_pane/mod.rs
- Codex TUI approval overlay: https://github.com/openai/codex/blob/main/codex-rs/tui/src/bottom_pane/approval_overlay.rs
- Codex App Server approvals: https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md#approvals
- Official Codex projects and chats: https://learn.chatgpt.com/docs/projects
- Official Codex code review: https://learn.chatgpt.com/docs/code-review
- Official Codex integrated terminal: https://learn.chatgpt.com/docs/integrated-terminal
- Official Codex open-source inventory: https://learn.chatgpt.com/docs/open-source

## What the source actually teaches

### 1. The conversation is the stable spine

OpenCode keeps the titlebar and main session frame stable while Review, Files, and Terminal open as contextual work surfaces. Codex keeps the transcript and bottom interaction area stable while individual items stream through explicit lifecycle states. Grok Build should stop treating every capability as a peer navigation destination: the task conversation remains primary; secondary work appears only when needed.

### 2. A composer is a state machine, not a textarea

OpenCode separates prompt state, suggestions, attachments, model/agent controls, permission/question docks, queued follow-ups, and submission into controllers and components. Codex retains the composer even when a bottom-pane view covers it, so drafts, attachments, history, focus rules, and keyboard state survive an approval or picker.

For Grok Build this means preserving the current `CommandComposer` behavior while extracting presentation. Permission and plan approval should occupy a dedicated blocking dock immediately above the composer. They must never compete with a simultaneously active normal input.

### 3. Status is scoped, layered, and actionable

Both projects avoid a single global loading flag. Useful state exists at four levels:

1. application/runtime health;
2. project or task attention state;
3. turn state such as running, blocked, queued, failed, or complete;
4. item state for tool calls, approvals, plans, and diffs.

OpenCode additionally marks open/unread/running sessions in navigation. Codex App Server requires approval UI to use the exact `threadId`, `turnId`, `itemId`, and server-provided decisions. Grok Build must preserve the same causal precision already present in its ACP/store contracts.

### 4. Progressive disclosure beats permanent chrome

OpenCode uses a compact project list, session list, titlebar tabs, and optional panels. Terminal and Review can be resized or stacked when both are visible. Tool detail and auxiliary actions appear on demand. Codex compresses status into a small footer and reveals shortcuts, permission detail, or selectors only when relevant.

Grok Build should use:

- a compact project/task rail;
- a stable titlebar and task tab strip;
- a centered transcript with bounded reading width;
- an optional inspector for Changes, Activity, Context, Verify, Memory, Files, and Terminal;
- overlays only for global settings or destructive confirmation.

### 5. Visual hierarchy comes from semantic tokens

OpenCode V2 builds neutral and hue ramps, then maps them into semantic background, text, icon, border, overlay, state, agent, and elevation tokens. Components consume semantics rather than raw colors. Buttons use restrained 24/28/32 px heights, 13 px labels, 6 px radii, visible focus rings, ghost treatments for secondary actions, and contrast only for the primary action.

Codex detects the terminal palette, adapts to light/dark environments, and falls back safely when color fidelity is unavailable. The lesson is not to reproduce exact hex values; it is to guarantee hierarchy and contrast in every theme.

## Grok Build design decisions

1. Preserve `DesktopBridge`, `useDesktopController`, Zustand state, React Query keys, ACP events, Rust Host, SQLite, Git/worktree, PTY, MCP, and update capability boundaries.
2. Use `AppShell` as the compatibility controller while extracting a scoped workbench presentation layer.
3. Replace the current three-layer global cascade with one semantic token layer plus component-scoped styles. Do not add another global override sheet.
4. Use neutral graphite surfaces. Keep Grok Build green as a sparse identity/accent signal, not as the border and background of every component.
5. Keep the timeline visually quiet. User prompts, assistant text, plan, tool, warning, error, and permission states must remain structurally distinct without turning every block into a heavy card.
6. Keep the composer mounted and preserve draft, attachment, IME, queued follow-up, stop, retry, model, effort, mode, and privacy behavior.
7. Put Review, Files, and Terminal into resizable contextual work surfaces. Keep task contract, verification, and memory available without making them permanent visual noise.
8. Use motion only for spatial continuity or status change, and honor `prefers-reduced-motion`.
9. At the minimum 900x600 window, collapse or overlay secondary surfaces before compressing the composer or transcript below usable widths.
10. Do not describe the current desktop updater as automatic installation. It is a release-metadata check plus simulated progress until download, signature verification, replacement, and relaunch exist.

## Acceptance model

The refactor is complete only when:

- every existing capability remains reachable;
- existing TypeScript, Vitest, Rust, and production-build gates pass;
- empty, running, queued, blocked, permission, error, long-content, Review, Terminal, Settings, light, dark, system, and reduced-motion states have visual evidence;
- keyboard, Chinese IME, drag/drop, paste, focus restoration, and minimum-window behavior are exercised;
- an installed-app smoke verifies a real first turn and the critical contextual panels;
- pre-existing permission and updater limitations remain explicit rather than being hidden by the new UI.
