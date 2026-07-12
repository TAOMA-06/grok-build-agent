# Grok Build Desktop

> A local-first, open-source macOS control plane for reliable [Grok Build](https://docs.x.ai/build/overview) coding agents.  
> 面向官方 Grok Build CLI 的本地优先、开源 macOS 桌面控制台。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: macOS 12+](https://img.shields.io/badge/platform-macOS%2012%2B%20Apple%20Silicon-black)](#download--安装)
[![GitHub Release](https://img.shields.io/github/v/release/TAOMA-06/grok-build-agent?include_prereleases)](https://github.com/TAOMA-06/grok-build-agent/releases)

English · [中文](#中文)

This is an **unofficial community project** and is **not affiliated with xAI**.  
本项目为**非官方社区项目**，与 xAI **无隶属关系**。

---

## Screenshots · 截图

<p align="center">
  <img src="docs/screenshots/01-home.png" alt="New task workspace" width="900" />
</p>

<p align="center">
  <img src="docs/screenshots/02-settings.png" alt="Settings" width="440" />
  &nbsp;
  <img src="docs/screenshots/03-commands.png" alt="Command palette" width="440" />
</p>

| | |
|---|---|
| **Workspace** · 工作区 | Start a task, pick a project, and talk to Grok in one shell. |
| **Settings** · 设置 | Theme, language (EN / 简体中文), agent and permissions. |
| **Command palette** · 命令面板 | Keyboard-first `/plan`, `/effort`, `/diff`, and more. |

---

## Download · 安装

### Apple Silicon (M1 / M2 / M3 / M4)

Download the latest **macOS arm64** build from Releases:

**→ [GitHub Releases](https://github.com/TAOMA-06/grok-build-agent/releases/latest)**

Artifact name:

- `Grok-Build-Desktop-<version>-macos-arm64.zip`

Install:

1. Unzip the archive.
2. Drag **Grok Build Desktop.app** into `/Applications`.
3. First launch: right-click the app → **Open** (ad-hoc signed; Gatekeeper may warn until you approve once).
4. Install / sign in to the official **Grok CLI** if prompted (`grok login --oauth` or device auth).

Requirements:

- macOS 12+
- Apple Silicon Mac
- Official [Grok Build CLI](https://docs.x.ai/build/overview) (not bundled)

> Universal / Intel builds and Apple notarization need signing secrets in CI. This release ships a local **arm64** package for Apple Silicon first.

---

## English

### What it is

Grok Build Desktop turns the official Grok Build CLI into a dependable desktop coding workspace. The CLI remains the execution runtime and owns Grok authentication; this app is the control plane: projects, tasks, permissions, isolated worktrees, terminals, diffs, event history, and crash recovery.

### Highlights

- Project / task sidebar with running, attention, completed, and archived states
- Independent Agent Host sidecar — closing the UI does not kill confirmed work
- Concurrent ACP sessions with crash recovery and event replay
- Automatic Git worktrees and explicit dirty-worktree choice
- Plan / Agent / Goal modes, reasoning effort, model picker, context usage
- Markdown replies, tool activity, plans, permissions, MCP manager
- No product telemetry; workspace data stays on your Mac — see [PRIVACY.md](PRIVACY.md)

### Using the app

1. Open a project folder.
2. Describe the task and send it. The app prepares a worktree (for Git projects), starts ACP, and sends the prompt.
3. Run other tasks in parallel from the sidebar.
4. Review activity and diffs in the task drawer.
5. Use **Apply to project** when ready (dry-run first; apply only when preflight passes).

### Develop from source

```bash
cd apps/desktop
npm install
npm run app:dev
```

Quality gate:

```bash
cd apps/desktop && npm run check
cd src-tauri && cargo test --workspace
```

More: [architecture](docs/architecture.md) · [release](docs/release.md) · [ACP mapping](docs/acp-mapping.md) · [SECURITY](SECURITY.md) · [THREAT_MODEL](THREAT_MODEL.md)

**Contact:** [taomahj834225@outlook.com](mailto:taomahj834225@outlook.com)

---

## 中文

### 这是什么

Grok Build Desktop 把官方 Grok Build CLI 变成可用的桌面编程工作区。CLI 仍是执行运行时并负责 Grok 登录；本应用是控制面：项目、任务、权限、隔离 worktree、终端、diff、事件历史与崩溃恢复。

### 主要能力

- 项目 / 任务侧边栏：运行中、需关注、已完成、已归档
- 独立 Agent Host：关掉窗口也不会中断已确认的任务
- 多会话 ACP，支持崩溃恢复与事件回放
- Git 项目自动 worktree，脏工作区需显式选择策略
- Plan / Agent / Goal 模式、推理强度、模型选择、上下文用量
- Markdown 回复、工具活动、计划审批、权限确认、MCP 管理
- 无产品遥测，工作区数据留在本机 — 见 [PRIVACY.md](PRIVACY.md)

### 使用流程

1. 打开一个项目文件夹。
2. 描述任务并发送。应用会为 Git 项目准备 worktree、启动 ACP 并发送提示。
3. 可在侧边栏并行开启其他任务。
4. 在任务抽屉中查看活动与文件变更。
5. 确认无误后使用 **Apply to project**（先 dry-run，预检通过才写入主仓库）。

### 下载安装（Apple 芯片）

1. 打开 [Releases](https://github.com/TAOMA-06/grok-build-agent/releases/latest)，下载 `Grok-Build-Desktop-*-macos-arm64.zip`。
2. 解压后将 **Grok Build Desktop.app** 拖入「应用程序」。
3. 首次打开：右键 → **打开**（当前为 ad-hoc 签名，需手动允许一次）。
4. 如提示缺少 CLI，按引导安装官方 Grok CLI 并完成登录。

### 从源码开发

```bash
cd apps/desktop
npm install
npm run app:dev
```

**联系方式：** [taomahj834225@outlook.com](mailto:taomahj834225@outlook.com)

---

## Repository layout · 仓库结构

```text
apps/desktop/       React + Tauri 桌面应用
docs/               架构、发布说明与 README 截图
.github/workflows/  macOS CI / 签名发布流水线
LICENSE             MIT
```

## Contributors · 贡献者

- **[TAOMA-06](https://github.com/TAOMA-06)** (maintainer · 维护者) — [taomahj834225@outlook.com](mailto:taomahj834225@outlook.com)
- **[Cursor](https://cursor.com)** (AI-assisted development · AI 辅助开发)

## License · 许可

MIT — see [LICENSE](LICENSE).
