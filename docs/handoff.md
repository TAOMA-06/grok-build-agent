# Handoff — Grok Build Desktop

> 交接文档。下一轮工作先读这份，再改代码。  
> 日期：2026-08-20 · 分支：`feat/cli-0.2.118`（相对 `origin/feat/cli-0.2.118` **全部未提交**）  
> 桌面版本：`apps/desktop/package.json` → **1.1.1** · 对齐官方 Grok Build CLI **1.0.5**（分支名仍带 0.2.118，不要被名字误导）

---

## 1. 产品由用户选择（不要锁死一条路径）

默认仍是 Grok 控制台，但 **Settings 里用户自己选运行时**，后续不要把某一种组合写成唯一合法产品：

| 用户选择 | Settings | 行为 |
|---|---|---|
| **Grok 全程**（默认） | Preferred runtime = Grok Build，Mixed planning 关 | Plan / Agent / Goal 都走 `grok-acp` |
| **混合规划** | Mixed planning 开，并填写 Secondary ACP 路径 | Plan 走第二 ACP（如 Codex）；批准后交给 Grok 实施。Agent / Goal 仍走 Grok |
| **第二 ACP 全程** | Preferred runtime = Secondary ACP，Mixed planning 关 | 整段任务（含 Plan/Agent/Goal）走 `generic-acp` |

GitHub：控制台提供 commit + `gh pr create`。要不要用、用到哪一步，由用户决定。

默认 UI 仍是控制台（派任务、审 diff、apply、开 PR），不是内置 IDE；这不阻止以后加能力，也不阻止用户把第二 ACP 当主运行时。

---

## 2. 当前仓库状态

工作区相对 `origin/feat/cli-0.2.118` 有大量 **已改未提交** 文件，以及若干 **未跟踪新文件**。没有 commit。接手后先 `git status` / `git diff`，不要假设 remote 上已有这些改动。

两波已经落地、但都还在工作区里：

1. **Harness 对齐 Grok CLI 1.0.5**（含 Desktop Host 的 `GROK_CONFIG` overlay）
2. **混合规划 + GitHub PR + 控制台定位**

最近一次自动化验证（2026-08-20，本机）：

```bash
cd apps/desktop && ./node_modules/.bin/tsc --noEmit
cd apps/desktop && ./node_modules/.bin/vitest run   # 181 passed
cd apps/desktop/src-tauri && cargo test --lib        # 131 passed
```

**没有**在真实 Tauri 窗口里点过混合规划 / 开 PR。浏览器工具也不适用（这是桌面应用）。

---

## 3. 已完成：Harness 1.0.5

目标：自制 harness 跟上 Grok Build 1.0.0–1.0.5，并让 Desktop 真的加载它。

| 项 | 状态 | 要点 |
|---|---|---|
| `harness/AGENTS.md` | 已改 | 声明 1.0.5；控制台定位；`<approved_plan>` 必须实施；implementer 需要写文件 |
| `harness/plugin.json` | 已改 | 版本说明对齐 1.0.5 / workflows / GROK_CONFIG |
| `harness/personas/implementer.toml` + `roles/implementer.toml` | 已改 | `default_capability_mode = "all"`。**禁止 `execute`**：CLI 的 `execute` 会挡住文件写入 |
| 新 personas / roles | 已加 | `security-auditor`、`test-writer`、`quick-search` |
| `harness/workflows/review-changes.rhai` | 已加 | 有界多维 review → 对抗 verify。**插件不会自动发现 `workflows/`**；orchestrate skill 从 plugin 目录读脚本交给 `workflow` 工具 |
| Desktop `GROK_CONFIG` overlay | 已加 | harness 会话在 spawn 时注入 `features.codebase_indexing=true`，**不改**用户 `config.toml`。1.0.5 只允许 `features` / `models` |
| `docs/harness.md`、goldenset | 已改 | 加载规则写清楚：`AGENTS.md` 走 `_meta.rules`；skills/agents 走 `_meta.pluginDirs`；personas/roles 不是 plugin 约定 |

**Harness 加载现实（容易踩坑）：**

- Desktop 打开 Orchestrator harness（新安装默认开）→ Host 注入 rules + 能解析到的 `pluginDirs`。
- 解析失败则 **rules-only**，会话不崩。
- Desktop **不会**自动把 `harness/personas` 装进 Grok TUI 的 persona 目录。工人规则要写进 worker `prompt`，`description` 用 `[implementer]` 这类标签。
- `GROK_BUILD_HARNESS_DIR` 可覆盖路径。

---

## 4. 已完成：混合规划 + GitHub + 控制台

### 4.1 运行时约定

| ID | 角色 |
|---|---|
| `grok-acp` | 执行器。Agent / Goal / 批准后的实施 |
| `generic-acp` | 规划器。仅当 Settings 打开 **Mixed planning** 且填了 `secondaryAcpPath`（通常是 Codex ACP）时，Plan 模式走这里 |

开关：`settings.mixedPlanning`（默认 `false`）+ 非空 `secondaryAcpPath`。两者都真才算 `mixedPlanningReady`。

### 4.2 任务生命周期（必须按这个理解）

```text
用户开 Mixed planning，填规划器路径
  → 新任务用 Plan 发送
  → connect(): grokPath = secondaryAcpPath, useHarness = false, resumeSessionId = null
  → adapterId = generic-acp 写入 SessionSummary / SQLite
  → 不发 Grok 的 /plan、/goal，也不对规划器做 session/set_config_option
  → 规划器产出 plan 块（或 Grok 风格的 exit_plan_mode 请求）
  → 用户点「批准并构建」或切到 Agent 再发送
  → connect({ grokPathOverride: grok, forcePath: true, resetRemote: true })
  → 提示词包 <approved_plan>…</approved_plan>
  → adapterId = grok-acp，Grok 实施（harness 按用户设置恢复）
```

关键约束：

- **不能**在规划器 ACP 连接上 `session/load` 成 Grok 会话。handoff 必须 `resetRemote`。
- 规划器会话上的 `chooseMode` 只改本地 mode，不向 Codex 发 Grok mode RPC。
- 规划器会话即使没有 `_x.ai/exit_plan_mode`，最新 plan 卡片也要能批准。
- `adapterId` 必须落库，否则重启后无法识别规划器任务，也就不会包 `<approved_plan>`。

### 4.3 GitHub

- Host RPC：`git.pr.create`（write allowlist 已加）。
- Tauri command：`git_create_pull_request`。
- UI：Context drawer **打开 Pull Request**。工作区 **clean 时也显示**（提交后按钮不能消失）。
- 实现：`git push -u origin HEAD`（可选）+ `gh pr create`；`GH_PROMPT_DISABLED=1`；无 title/body 时 `--fill`，有 title 无 body 时补默认 body（避免非 TTY 弹编辑器）。
- Private Chat：**禁止**开 PR。
- 成功：复制 URL，并尝试 `openPath` / `window.open`。
- 诊断：`doctorStatus.github`（`gh` 是否在 PATH、是否已登录）。没有应用内 `gh auth login` 向导。

### 4.4 文案

默认描述是 Grok 控制台。Settings 必须把三种运行时写清楚，**不要**把 Secondary ACP 标成「仅调试」，也**不要**把混合规划写成唯一允许的非 Grok 路径。

---

## 5. 文件地图（从这里改）

### 混合控制

| 文件 | 职责 |
|---|---|
| `apps/desktop/src/contracts/mixedControl.ts` | 纯函数：ready / start planner / handoff / prompt wrap |
| `apps/desktop/src/contracts/mixedControl.test.ts` | 合同测试 |
| `apps/desktop/src/contracts/settings.ts` | `mixedPlanning` 字段、normalize、可执行文件解析 |
| `apps/desktop/src/contracts/session.ts` | `SessionSummary.adapterId` |
| `apps/desktop/src/features/shell/useDesktopController.ts` | connect / send / chooseMode / answerPlanApproval |
| `apps/desktop/src/features/shell/useDesktopController.test.tsx` | planner 启动、handoff、本地 mode、批准后交给 Grok |
| `apps/desktop/src/features/shell/ThreadView.tsx` | Planner 徽章、横幅、plan 卡片可批准 |
| `apps/desktop/src/features/shell/Timeline.tsx` | 规划器气泡标 `P`；Grok 标 `G` |
| `apps/desktop/src/features/shell/SettingsDialog.tsx` | Mixed planning 开关 + 缺路径警告 |
| `apps/desktop/src/features/shell/EmptyTaskState.tsx` | 「规划器出计划，Grok 执行」快捷 chip |
| `apps/desktop/src-tauri/src/config.rs` | `mixed_planning` 持久化 |
| `apps/desktop/src-tauri/src/contracts/mod.rs` | `SessionSummary.adapter_id` |
| `apps/desktop/src-tauri/src/db.rs` | `sessions.adapter_id` 列（`ensure_session_column`） |
| `apps/desktop/src-tauri/src/adapter_registry.rs` | 规划器 catalog 说明 |

### GitHub PR

| 文件 | 职责 |
|---|---|
| `apps/desktop/src-tauri/src/git_ops.rs` | `github_status`、`create_pull_request`、`pull_request_gh_args` |
| `apps/desktop/src-tauri/src/agent_host/dispatch.rs` | `git.pr.create` + doctor `github` |
| `apps/desktop/src-tauri/src/host_rpc.rs` | write allowlist |
| `apps/desktop/src-tauri/src/lib.rs` | `git_create_pull_request` 命令 |
| `apps/desktop/src/api/catalog.ts` | 前端 invoke |
| `apps/desktop/src/platform/{DesktopBridge,tauriBridge,mockBridge}.ts(x)` | bridge 方法 |
| `apps/desktop/src/features/shell/ContextDrawer.tsx` | Open PR 按钮 |
| `apps/desktop/src/contracts/review.ts` | `GitPrCreateResult` |
| `apps/desktop/src/contracts/platform.ts` | `DoctorStatus.github` |

### Harness

| 路径 | 职责 |
|---|---|
| `harness/` | 整包：AGENTS、personas、roles、skills、`workflows/review-changes.rhai` |
| `docs/harness.md` | 加载语义 |
| `apps/desktop/src-tauri/src/acp/connection.rs` | `GROK_CONFIG` env overlay |

### 同批未跟踪、相关但不是混合控制核心

这些是 harness / 1.0.5 对齐波次留下的新文件，交接时不要丢掉：

- `apps/desktop/src/contracts/{jobs,capabilityOrchestration,mcpTemplates,parityEvalRunner}.ts` + tests
- `apps/desktop/src/features/shell/CapabilityOrchestrator.tsx`
- `apps/desktop/scripts/parity-eval-runner.mjs`
- `harness/eval/results.sample.json`
- `harness/personas/{security-auditor,test-writer}.toml`
- `harness/roles/{quick-search,security-auditor,test-writer}.toml`
- `harness/workflows/`

---

## 6. 怎么手工验收

1. Settings → Agent：填规划器 ACP 路径（Codex 或 mock ACP），打开 **Mixed planning**。
2. 新任务 → Plan → 发送「只写计划，不要改代码」。应看到 Planner 徽章；诊断 / 系统消息写 harness off。
3. 出现 plan 卡片后点 **批准并构建**（或切 Agent 再发）。时间线应出现「交给 Grok」；随后工具调用应是 Grok，而不是规划器。
4. Git 项目：改动 → commit → Changes 里 **打开 Pull Request**。需要本机 `gh` 已 `gh auth login`，且分支能 push 到 origin。
5. Private Chat 任务：不应出现开 PR。
6. Settings → Diagnostics：能看到 GitHub CLI 行（找到 / 未找到 / 未登录）。

---

## 7. 已知缺口（按优先级）

### 可做，但仍未做

| 缺口 | 说明 | 建议 |
|---|---|---|
| **未提交** | 整波改动都在工作区 | 用户要发版或换机器前先 commit |
| **真实窗口未点过** | 只有单测 | 按第 6 节在 `npm run app:dev` 走一遍 |
| **规划器只回 assistant 文本、没有 plan 块** | 没有批准按钮 | 用户切 Agent 再发也能 handoff；若要更顺，可把最后一条 assistant 晋升为 plan |
| **规划器 ACP 写文件** | Desktop 的 Plan 写保护主要拦 **Grok ACP** 的 host fs。Codex 走自己的工具时，只能靠提示词 | 不要假装 host 已挡住 Codex 写操作 |
| **`preferredAdapterId = generic-acp`** | 用户可选：整段任务跑第二 ACP | 这是一等选项，不是调试开关 |
| **没有 `gh auth login` UI** | doctor 只显示状态 | 登录仍用终端 `gh auth login` |
| **没有 PR 状态 / checks** | 目前只有开 PR | 用户若要看板再做，不要默认当成禁区 |

### 默认不做（用户没要求时）

- 应用内编辑器 / 编译器（当前是控制台）
- GitHub Issues 看板（当前是 `gh pr create`）
- 把第二 ACP 设成出厂默认（出厂仍是 Grok）

### Harness 侧残留

- Desktop 不把 `harness/personas` 同步到 `~/.grok/personas`
- `workflows/*.rhai` 不会出现在 TUI `/workflows` 目录，除非拷进 `.grok/workflows/`
- 分支名 `feat/cli-0.2.118` 与实际对齐的 **1.0.5** 不一致，发版说明里要写 1.0.5

---

## 8. 下一轮建议（用户没点名时的默认）

1. **提交当前工作区**（用户明确要求再 commit）。信息建议覆盖：harness 1.0.5、`GROK_CONFIG`、mixed planning、`gh pr create`、控制台定位。
2. **Tauri 手工冒烟** 第 6 节。规划器路径没有就用 `apps/desktop/src-tauri/tests/fixtures/mock_acp_agent.py`（确认它能当 ACP stdio 用；不够就补一个只吐 plan 块的 fixture）。
3. 运行时路径由用户在 Settings 选择；不要再把产品锁回「只能 Grok」或「只能混合规划」。

---

## 9. 给下一个 agent 的起始提示

可直接粘贴：

```text
读 docs/handoff.md。产品路径由用户在 Settings 选择（Grok 全程 / 混合规划 / 第二 ACP 全程），不要锁死。
先 git status 核对分支和工作区，再动代码。
```

---

## 10. 命令速查

```bash
# 前端
cd apps/desktop
npm install
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vitest run
npm run app:dev          # GROK_BUILD_IN_PROCESS_HOST=1 tauri dev

# Host / Rust
cd apps/desktop/src-tauri
cargo test --lib

# 质量门（更慢）
cd apps/desktop && npm run check
cd src-tauri && cargo test --workspace
```

相关文档：

- 产品边界 / 架构：`docs/architecture.md`
- Harness 加载：`docs/harness.md`
- 合同：`docs/contracts.md`
- ACP：`docs/acp-mapping.md`
- 发版：`docs/release.md`
