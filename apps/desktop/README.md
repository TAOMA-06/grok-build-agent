# Grok Build Desktop app

Tauri 2 + React implementation of the Grok desktop task command center.

```bash
npm install
npm run app:dev
```

Use `npm run dev` for the browser MockBridge preview and `npm run check` for TypeScript, jsdom interaction tests, Vitest and the production bundle. `npm run test:coverage` reports coverage for the current shell, attachment validation and bridge/controller behavior. See the [repository README](../../README.md) for the user workflow and [architecture](../../docs/architecture.md) for bridge, state, MCP, attachment and ACP boundaries.

Tasks support Agent, Plan and Goal modes. The mode in Settings is only the default for new tasks; the composer controls the active task and persists a switch only after Grok confirms it. Plan remains read-only until its in-task approval action returns the same ACP session to Agent mode.

Each first user instruction seeds the task focus shown in the Context drawer. Economy and Balanced control the initial contract budget. The contract is then reused from immutable conversation history instead of being appended on every turn; it is injected again only when the task changes or after an explicit `/compact` boundary. Strict Privacy Shield is the default local outbound guardrail; it redacts detected text secrets and blocks high-risk attachment names before local persistence or dispatch. See [`../../PRIVACY.md`](../../PRIVACY.md).

**Privacy Mode** is on by default and maps to Grok Build `/privacy opt-out` (coding data retention opt-out). When an agent is connected and signed in, the desktop app syncs this preference via `x.ai/privacy/setCodingDataRetention`.

New tasks are **durable by default** (Private Chat off) with the **Orchestrator harness** on. First turns seed a task contract (goal, acceptance, inferred verification). Declared argv-only verification commands auto-run after successful turns when policy allows; shell, network, and destructive commands require confirmation instead. Private Chat remains available as an explicit local-ephemeral opt-in.

Prompt-cache changes must pass a weighted A/B gate against a same-turn CLI trace. Export provider usage responses as JSON or JSONL, then run `npm run benchmark:cache -- --baseline cli.jsonl --candidate desktop.jsonl`. The gate requires the desktop run to have the same turn count, a strictly higher weighted cache-hit rate, fewer uncached prompt tokens, and no higher cost when both traces include cost.

Type `/` for the Grok-compatible command directory or press `Cmd+K` for the searchable desktop palette. Commands reported by the current ACP session and user-invocable skills are merged with native desktop commands; unavailable TUI-only commands are visible but never silently sent as prompts. The complete production shell can switch between English, Simplified Chinese and the macOS system language without restarting.

The interface uses an original Mission Control visual system: a deep-space workspace, alloy settings deck, carbon command palette, launch-trajectory status rail and decorative spacecraft artwork. Motion respects `prefers-reduced-motion`. The artwork is decorative only and does not imply affiliation with or endorsement by xAI or SpaceX; see [`src/assets/README.md`](src/assets/README.md).
