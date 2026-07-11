import { buildPromptContent, defaultSettings, inferAttachmentMime } from "../contracts";
import type {
  AgentStatus,
  ChatBlock,
  ReviewSnapshot,
  RuntimeHealth,
  SelectableModel,
  SessionModelState,
  McpServerInput,
  SessionSummary,
  Settings,
  WorkspaceRecord,
} from "../types";
import type { WorktreeSummary } from "../api/catalog";
import type { DesktopBridge } from "./DesktopBridge";

const projectPath = "/Users/demo/Projects/orbit";
const now = new Date().toISOString();

const health: RuntimeHealth = {
  grok: { found: true, path: "~/.grok/bin/grok", version: "0.2.73" },
  authenticated: true,
  authMethod: "device",
  ready: true,
  checklist: [
    { id: "cli", label: "Grok CLI", ok: true, detail: "0.2.73" },
    { id: "auth", label: "Signed in", ok: true, detail: "Device auth" },
  ],
};

const workspace: WorkspaceRecord = {
  id: "mock-project",
  path: projectPath,
  name: "orbit",
  lastOpenedAt: now,
  favorite: true,
};

const summaries: SessionSummary[] = [
  {
    sessionId: "mock-running",
    connectionId: "mock-connection",
    workspaceRoot: projectPath,
    title: "Polish the agent workspace",
    createdAt: now,
    updatedAt: now,
    lastMessagePreview: "Refine the desktop shell and verify the build",
    runState: "streaming",
    remoteSessionId: "remote-running",
    worktreePath: `${projectPath}/.worktrees/polish-shell`,
    executionRoot: `${projectPath}/.worktrees/polish-shell`,
    baseCommit: "d34db33",
    model: "grok-build",
    alwaysApprove: false,
    draft: "",
  },
  {
    sessionId: "mock-complete",
    workspaceRoot: projectPath,
    title: "Audit authentication flow",
    createdAt: now,
    updatedAt: now,
    lastMessagePreview: "All checks passed",
    runState: "idle",
    remoteSessionId: "remote-complete",
    model: "grok-build",
    alwaysApprove: false,
    draft: "",
  },
];

const blocksBySession = new Map<string, ChatBlock[]>([
  [
    "mock-running",
    [
      {
        id: "u1",
        type: "user",
        text: "Turn this into a polished desktop agent and keep the Grok workflow intact.",
      },
      {
        id: "a1",
        type: "assistant",
        text: "I’m restructuring the workspace around projects and independent threads. The ACP runtime stays intact while the interface becomes quieter and easier to supervise.",
      },
      {
        id: "t1",
        type: "tool",
        tool: {
          id: "tool-1",
          title: "Inspect project architecture",
          status: "completed",
          output: "Mapped App → Workbench → ACP runtime and identified the bridge seam.",
        },
      },
      {
        id: "thought-1",
        type: "thought",
        text: "The main risk is coupling React boot to Tauri invoke, so I will introduce a typed platform bridge first.",
      },
    ],
  ],
  [
    "mock-complete",
    [
      { id: "u2", type: "user", text: "Audit the authentication flow." },
      {
        id: "a2",
        type: "assistant",
        text: "The device-auth flow is now platform-neutral and keeps API keys out of the renderer.",
      },
    ],
  ],
]);

const models: SelectableModel[] = [
  { id: "grok-build", name: "Grok Build", description: "Recommended coding agent", isDefault: true },
  { id: "grok-4.5", name: "Grok 4.5", description: "Deep reasoning", isDefault: false },
];

const settings: Settings = {
  ...defaultSettings(),
  cwd: projectPath,
  onboardingDone: true,
  theme: "light",
};

function mockReview(root: string): ReviewSnapshot {
  return {
    workspaceRoot: root,
    state: "dirty",
    branch: "grok/polish-shell-a1b2",
    head: "d34db33",
    files: [
      {
        path: "src/App.tsx",
        status: "modified",
        staged: false,
        additions: 84,
        deletions: 32,
        binary: false,
      },
      {
        path: "src/App.css",
        status: "modified",
        staged: false,
        additions: 126,
        deletions: 51,
        binary: false,
      },
    ],
    untracked: [],
    refreshedAt: now,
  };
}

export const mockDesktopBridge: DesktopBridge = {
  kind: "mock",
  async loadSettings() {
    return settings;
  },
  async saveSettings(next: Settings) {
    Object.assign(settings, next);
  },
  async runtimeHealth() {
    return health;
  },
  async ensureAgentHost() {
    return { protocolVersion: 1, pid: 1, database: "mock.sqlite", status: { running: false, sessionId: null, cwd: null, grokPath: null, lastError: null } };
  },
  async agentHostHealth() {
    return this.ensureAgentHost();
  },
  async installCli() {
    return [
      { phase: "download", detail: "Downloaded the official x.ai installer", ok: true },
      { phase: "install", detail: "Grok CLI is ready", ok: true },
    ];
  },
  async runLogin() {
    return "Signed in";
  },
  async runLogout() {
    return "Signed out";
  },
  async subscribeEvents() {
    return [];
  },
  async listWorkspaces() {
    return [workspace];
  },
  async upsertWorkspace(path, name) {
    return { ...workspace, path, name: name ?? path.split(/[\\/]/).pop() ?? path };
  },
  async listSessions(workspaceRoot) {
    return workspaceRoot ? summaries.filter((s) => s.workspaceRoot === workspaceRoot) : summaries;
  },
  async loadCachedBlocks(sessionId) {
    return blocksBySession.get(sessionId) ?? [];
  },
  async appendCachedEvent() {},
  async upsertSession(summary) {
    const index = summaries.findIndex((item) => item.sessionId === summary.sessionId);
    if (index >= 0) summaries[index] = summary;
    else summaries.unshift(summary);
  },
  async deleteSession(sessionId) {
    const index = summaries.findIndex((item) => item.sessionId === sessionId);
    if (index >= 0) summaries.splice(index, 1);
  },
  async saveDraft(sessionId, draft) {
    const summary = summaries.find((item) => item.sessionId === sessionId);
    if (summary) summary.draft = draft;
  },
  async chooseDirectory() {
    return projectPath;
  },
  async chooseFiles() {
    return [`${projectPath}/README.md`];
  },
  async openPath() {},
  async copyText(text) {
    await navigator.clipboard?.writeText(text);
  },
  async listModels() {
    return models;
  },
  async inspectCapabilities() {
    return {
      skills: [
        { id: "frontend-design", name: "Frontend design", description: "Build polished product interfaces", source: "user", enabled: true },
      ],
      plugins: [
        { id: "github", name: "GitHub", description: "Repository workflows", source: "plugin", enabled: true },
      ],
      hooks: [],
      mcpServers: [
        { id: "filesystem", name: "Filesystem", description: "Workspace tools", source: "project", enabled: true },
      ],
      commands: [
        { id: "/goal", name: "/goal", description: "Delegate a long-running objective", source: "grok", enabled: true },
        { id: "/code-review", name: "/code-review", description: "Review current changes", source: "grok", enabled: true },
        { id: "/security-review", name: "/security-review", description: "Audit security-sensitive changes", source: "plugin", enabled: true },
      ],
      rules: [
        { id: "project-rules", name: "Project rules", source: "project", enabled: true },
      ],
      raw: null,
    };
  },
  async startAgent(config) {
    return {
      running: true,
      connectionId: "mock-connection",
      sessionId: config.resumeSessionId || `remote-${crypto.randomUUID()}`,
      cwd: config.cwd,
      model: {
        currentModelId: config.model ?? "grok-build",
        availableModels: models,
        liveSwitchSupported: true,
        source: "acp",
      },
      mode: {
        currentMode: "agent",
        availableModes: [
          { id: "agent", name: "Agent" },
          { id: "plan", name: "Plan" },
          { id: "goal", name: "Goal" },
        ],
        liveSwitchSupported: true,
        source: "acp_config",
      },
      availableCommands: [
        { name: "compact", description: "Compress conversation history" },
        { name: "context", description: "Show context usage" },
        { name: "goal", description: "Manage an autonomous goal" },
      ],
    } satisfies AgentStatus;
  },
  async restartAgent(config) {
    return this.startAgent(config);
  },
  async stopAgent() {},
  async sendPrompt(_connectionId, sessionId, text, _content, _dispatch) {
    const blocks = blocksBySession.get(sessionId) ?? [];
    blocks.push({ id: crypto.randomUUID(), type: "user", text });
    blocksBySession.set(sessionId, blocks);
    return null;
  },
  async cancelPrompt() {},
  async respondServerRequest() {},
  async setSessionModel(_connectionId, _sessionId, modelId) {
    return {
      kind: "switched",
      state: {
        currentModelId: modelId,
        availableModels: models,
        liveSwitchSupported: true,
        source: "acp",
      } satisfies SessionModelState,
    } as const;
  },
  async setSessionMode(_connectionId, _sessionId, mode) {
    return {
      kind: "switched",
      state: {
        currentMode: mode,
        availableModes: [
          { id: "agent", name: "Agent" },
          { id: "plan", name: "Plan" },
          { id: "goal", name: "Goal" },
        ],
        liveSwitchSupported: true,
        source: "acp_config",
      },
    } as const;
  },
  async confirmSessionMode(_connectionId, _sessionId, mode) {
    return {
      currentMode: mode,
      availableModes: [
        { id: "agent", name: "Agent" },
        { id: "plan", name: "Plan" },
        { id: "goal", name: "Goal" },
      ],
      liveSwitchSupported: false,
      source: "acp_command",
    };
  },
  async stageAttachments(paths) {
    return paths.map((path) => {
      const name = path.split(/[\\/]/).pop() ?? path;
      const mimeType = inferAttachmentMime(name) ?? "application/octet-stream";
      return {
        id: crypto.randomUUID(),
        source: "path" as const,
        kind: mimeType.startsWith("image/") ? ("image" as const) : ("file" as const),
        name,
        mimeType,
        path,
        sizeBytes: 128,
      };
    });
  },
  async prepareAttachments(files) {
    return buildPromptContent(
      "",
      files.map((file) =>
        file.source === "path"
          ? { ...file, source: "inline" as const, textContent: "mock attachment", path: null }
          : file,
      ),
    );
  },
  async listMcpServers() {
    return {
      servers: [],
      userConfigPath: "~/.grok/config.toml",
      projectConfigPath: `${projectPath}/.grok/config.toml`,
      workspaceRoot: projectPath,
    };
  },
  async upsertMcpServer(_input: McpServerInput) {
    return "ok";
  },
  async removeMcpServer() {
    return "ok";
  },
  async doctorMcpServer(name) {
    return [{
      name: name ?? "filesystem",
      ok: true,
      summary: "Connected",
      tools: [{ name: "read_file" }],
      checkedAt: new Date().toISOString(),
    }];
  },
  async gitReview(root) {
    return mockReview(root);
  },
  async gitFilePatch(_root, path) {
    return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,3 +1,4 @@\n export default function App() {\n+  // Grok desktop shell\n }`;
  },
  async gitFileAction() {
    return {};
  },
  async gitHunkAction() {
    return {};
  },
  async gitCommit() {
    return { commit: "d34db33", summary: "mock commit" };
  },
  async gitCreateCheckpoint() {
    return {
      checkpointId: crypto.randomUUID(),
      head: "d34db33",
      createdAt: new Date().toISOString(),
      files: [],
      bytes: 0,
    };
  },
  async gitCheckpointRestorePreview(_workspaceRoot, checkpointId) {
    return {
      checkpoint: {
        checkpointId,
        head: "d34db33",
        createdAt: new Date().toISOString(),
        files: [],
        bytes: 0,
      },
      currentHead: "d34db33",
      ready: true,
      reason: null,
    };
  },
  async gitRestoreCheckpoint(_workspaceRoot, checkpointId) {
    return {
      checkpointId,
      head: "d34db33",
      createdAt: new Date().toISOString(),
      files: [],
      bytes: 0,
    };
  },
  async workspaceTree() {
    return [{ path: "src", name: "src", directory: true, size: null }];
  },
  async workspaceSearch(_workspaceRoot, query) {
    return [{ path: `src/${query}.ts`, name: `${query}.ts`, directory: false, size: 128 }];
  },
  async workspaceRead(_workspaceRoot, path) {
    return { path, content: "mock preview", binary: false, truncated: false, size: 12 };
  },
  async listPolicyRules() {
    return [];
  },
  async deletePolicyRule() {},
  async doctorStatus() {
    return {
      host: "ok",
      protocolVersion: 1,
      pid: 1,
      database: "ok",
      databasePath: "/tmp/mock.sqlite",
      socket: "/tmp/mock.sock",
      runtime: { running: true },
      strictNetworkIsolation: false,
      pendingPermissions: 0,
      blobBytes: 0,
    };
  },
  async restartAgentHost() {},
  async diagnosticBundlePreview() { return "{\n  \"privacy\": \"redacted\"\n}"; },
  async exportDiagnosticBundle() { return "/tmp/grok-build-diagnostics.json"; },
  async gcBlobs() { return { removed: 0, reclaimedBytes: 0 }; },
  async rebuildProjections() {
    return { processedEvents: 12, projectedEntities: 4, lastRowid: 12, rebuiltAt: new Date().toISOString() };
  },
  async getTask(taskId) {
    return { taskId, workspaceId: "workspace", state: "running", goal: "Complete the coding task", constraints: [], acceptance: [], allowedPaths: [], verificationCommands: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  },
  async upsertTask() {},
  async listContextManifests() { return []; },
  async saveContextManifest() {},
  async listVerificationResults() { return []; },
  async saveVerificationResult() {},
  async runVerification(taskId, _workspaceRoot, command) {
    return { verificationId: crypto.randomUUID(), taskId, turnId: "mock", command, status: "passed", summary: "mock verification", exitCode: 0, createdAt: new Date().toISOString() };
  },
  async terminalCreate() { return { terminalId: crypto.randomUUID(), pid: 1 }; },
  async terminalList() { return []; },
  async terminalOutput() { return { output: "$ ", exitCode: null, truncated: false, nextOffset: 2, hasMore: false }; },
  async terminalPorts() { return []; },
  async terminalInput() {},
  async terminalResize() {},
  async terminalKill() {},
  async terminalRelease() {},
  async taskCompletionGate() { return { ready: true, blockers: [], verification: [] }; },
  async completeTask() { return { ready: true, blockers: [], verification: [] }; },
  async exportTranscript(sessionId, format) { return `/tmp/${sessionId}.${format === "json" ? "json" : "md"}`; },
  async listWorktrees() {
    return [
      {
        path: `${projectPath}/.worktrees/polish-shell`,
        branch: "grok/polish-shell-a1b2",
        head: "d34db33",
        bare: false,
        locked: false,
        prunable: false,
        dirty: true,
        source: "git",
        mainWorkspace: projectPath,
      },
    ] satisfies WorktreeSummary[];
  },
  async createWorktree(req) {
    return {
      path: req.path ?? `${req.workspaceRoot}/.worktrees/new-thread`,
      branch: req.branch ?? "grok/new-thread",
      bare: false,
      locked: false,
      prunable: false,
      dirty: req.dirtyPolicy === "copy_dirty",
      source: "git",
      mainWorkspace: req.workspaceRoot,
    };
  },
  async deleteWorktree() {},
  async previewWorktreeApply(req) {
    const review = mockReview(req.worktreePath);
    return {
      ready: true,
      reason: null,
      mainHead: req.baseCommit,
      baseCommit: req.baseCommit,
      files: review.files.map((file) => file.path),
      untracked: review.untracked,
      patchBytes: 512,
    };
  },
  async applyWorktreeChanges() {
    return {
      appliedAt: new Date().toISOString(),
      filesApplied: 2,
    };
  },
};

export function getMockBlocks(sessionId: string): ChatBlock[] {
  return blocksBySession.get(sessionId) ?? [];
}
