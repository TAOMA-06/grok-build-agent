# Grok Build Desktop app

Tauri 2 + React implementation of the Grok desktop task command center.

```bash
npm install
npm run app:dev
```

Use `npm run dev` for the browser MockBridge preview and `npm run check` for TypeScript, jsdom interaction tests, Vitest and the production bundle. `npm run test:coverage` reports coverage for the current shell, attachment validation and bridge/controller behavior. See the [repository README](../../README.md) for the user workflow and [architecture](../../docs/architecture.md) for bridge, state, MCP, attachment and ACP boundaries.

Tasks support Agent, Plan and Goal modes. The mode in Settings is only the default for new tasks; the composer controls the active task and persists a switch only after Grok confirms it. Plan remains read-only until its in-task approval action returns the same ACP session to Agent mode.

Type `/` for the Grok-compatible command directory or press `Cmd+K` for the searchable desktop palette. Commands reported by the current ACP session and user-invocable skills are merged with native desktop commands; unavailable TUI-only commands are visible but never silently sent as prompts. The complete production shell can switch between English, Simplified Chinese and the macOS system language without restarting.
