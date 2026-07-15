import { createContext, useContext } from "react";
import type {
  AgentStatus,
  CapabilitySnapshot,
  ComposerAttachment,
  PromptContent,
  PromptDispatchContext,
  ReviewSnapshot,
  RuntimeHealth,
  AgentHostHealth,
  SelectableModel,
  ModelSwitchResult,
  EffortSwitchResult,
  ModeSwitchResult,
  SessionModeState,
  McpDoctorResult,
  McpListResult,
  McpScope,
  McpServerInput,
  SessionSummary,
  Settings,
  StartConfig,
  WorktreeApplyPreview,
  WorktreeApplyRequest,
  WorktreeApplyResult,
  WorkspaceRecord,
  GitFileAction,
  GitMutationResult,
  GitCommitResult,
  GitCheckpoint,
  GitCheckpointRestorePreview,
  WorkspaceEntry,
  WorkspacePreview,
  StoredPolicyRule,
  DoctorStatus,
  ProjectionRebuildReport,
  TaskDefinition,
  ContextManifest,
  VerificationResult,
  CompletionGate,
} from "../types";
import type { WorktreeSummary } from "../api/catalog";
import type { TerminalOutput, TerminalSummary } from "../api/catalog";
import { mockDesktopBridge } from "./mockBridge";
import { tauriDesktopBridge } from "./tauriBridge";

export type DirectoryChoice = string | null;

export interface DesktopBridge {
  readonly kind: "tauri" | "mock";
  loadSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;
  runtimeHealth(grokPath?: string): Promise<RuntimeHealth>;
  ensureAgentHost(): Promise<AgentHostHealth>;
  agentHostHealth(): Promise<AgentHostHealth>;
  installCli(): Promise<Array<{ phase: string; detail: string; ok: boolean }>>;
  runLogin(grokPath?: string): Promise<string>;
  runLogout(grokPath?: string): Promise<string>;
  subscribeEvents(): Promise<Array<() => void>>;
  listWorkspaces(): Promise<WorkspaceRecord[]>;
  upsertWorkspace(path: string, name?: string): Promise<WorkspaceRecord>;
  listSessions(workspaceRoot?: string | null): Promise<SessionSummary[]>;
  loadCachedBlocks(sessionId: string): Promise<import("../types").ChatBlock[]>;
  appendCachedEvent(event: import("../api/catalog").CachedSessionEvent): Promise<void>;
  upsertSession(summary: SessionSummary): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  saveDraft(sessionId: string, draft: string): Promise<void>;
  chooseDirectory(): Promise<DirectoryChoice>;
  chooseFiles(): Promise<string[]>;
  openPath(path: string): Promise<void>;
  copyText(text: string): Promise<void>;
  listModels(grokPath?: string): Promise<SelectableModel[]>;
  inspectCapabilities(grokPath?: string, workspaceRoot?: string | null): Promise<CapabilitySnapshot>;
  startAgent(config: StartConfig): Promise<AgentStatus>;
  restartAgent(config: StartConfig): Promise<AgentStatus>;
  stopAgent(): Promise<void>;
  sendPrompt(
    connectionId: string,
    sessionId: string,
    text: string,
    content?: PromptContent[],
    dispatch?: PromptDispatchContext,
  ): Promise<unknown>;
  cancelPrompt(connectionId: string, sessionId: string): Promise<void>;
  respondServerRequest(
    connectionId: string,
    id: string | number,
    result?: unknown,
    error?: unknown,
  ): Promise<void>;
  setSessionModel(
    connectionId: string,
    sessionId: string,
    modelId: string,
  ): Promise<ModelSwitchResult>;
  setSessionEffort(
    connectionId: string,
    sessionId: string,
    effort: string,
  ): Promise<EffortSwitchResult>;
  setSessionMode(
    connectionId: string,
    sessionId: string,
    mode: import("../types").TaskMode,
  ): Promise<ModeSwitchResult>;
  confirmSessionMode(
    connectionId: string,
    sessionId: string,
    mode: import("../types").TaskMode,
  ): Promise<SessionModeState>;
  /**
   * Apply Grok Privacy Mode on the active agent (account-level coding data opt-out).
   * `privacyModeOn === true` means Privacy Mode enabled (`/privacy opt-out`).
   */
  setCodingDataPrivacy(privacyModeOn: boolean): Promise<{
    ok?: boolean;
    privacyMode?: boolean;
    codingDataRetentionOptOut?: boolean;
    result?: unknown;
  }>;
  stageAttachments(paths: string[], privateChat?: boolean): Promise<ComposerAttachment[]>;
  prepareAttachments(files: ComposerAttachment[], privateChat?: boolean): Promise<PromptContent[]>;
  listMcpServers(grokPath?: string, workspaceRoot?: string | null): Promise<McpListResult>;
  upsertMcpServer(input: McpServerInput, grokPath?: string): Promise<string>;
  removeMcpServer(
    name: string,
    options: { grokPath?: string; scope?: McpScope; workspaceRoot?: string | null },
  ): Promise<string>;
  doctorMcpServer(
    name?: string | null,
    options?: { grokPath?: string; workspaceRoot?: string | null },
  ): Promise<McpDoctorResult[]>;
  gitReview(workspaceRoot: string, privateChat?: boolean): Promise<ReviewSnapshot>;
  gitFilePatch(workspaceRoot: string, path: string, staged: boolean, privateChat?: boolean): Promise<string>;
  gitFileAction(
    workspaceRoot: string,
    path: string,
    action: GitFileAction,
    privateChat?: boolean,
  ): Promise<GitMutationResult>;
  gitHunkAction(
    workspaceRoot: string,
    path: string,
    patch: string,
    action: GitFileAction,
    privateChat?: boolean,
  ): Promise<GitMutationResult>;
  gitCommit(workspaceRoot: string, message: string, privateChat?: boolean): Promise<GitCommitResult>;
  gitCreateCheckpoint(workspaceRoot: string, privateChat?: boolean): Promise<GitCheckpoint>;
  gitCheckpointRestorePreview(
    workspaceRoot: string,
    checkpointId: string,
    privateChat?: boolean,
  ): Promise<GitCheckpointRestorePreview>;
  gitRestoreCheckpoint(
    workspaceRoot: string,
    checkpointId: string,
    privateChat?: boolean,
  ): Promise<GitCheckpoint>;
  workspaceTree(
    workspaceRoot: string,
    path?: string | null,
    privateChat?: boolean,
  ): Promise<WorkspaceEntry[]>;
  workspaceSearch(workspaceRoot: string, query: string, privateChat?: boolean): Promise<WorkspaceEntry[]>;
  workspaceRead(workspaceRoot: string, path: string, privateChat?: boolean): Promise<WorkspacePreview>;
  listPolicyRules(workspaceId?: string | null): Promise<StoredPolicyRule[]>;
  deletePolicyRule(ruleId: string): Promise<void>;
  doctorStatus(): Promise<DoctorStatus>;
  restartAgentHost(): Promise<void>;
  diagnosticBundlePreview(): Promise<string>;
  exportDiagnosticBundle(): Promise<string | null>;
  gcBlobs(): Promise<{ removed: number; reclaimedBytes: number }>;
  rebuildProjections(): Promise<ProjectionRebuildReport>;
  getTask(taskId: string): Promise<TaskDefinition | null>;
  upsertTask(task: TaskDefinition): Promise<void>;
  listContextManifests(taskId: string): Promise<ContextManifest[]>;
  saveContextManifest(manifest: ContextManifest): Promise<void>;
  listVerificationResults(taskId: string): Promise<VerificationResult[]>;
  saveVerificationResult(result: VerificationResult): Promise<void>;
  runVerification(taskId: string, workspaceRoot: string, command: string): Promise<VerificationResult>;
  terminalCreate(taskId: string, workspaceRoot: string, command: string, args: string[]): Promise<{ terminalId: string; pid: number }>;
  terminalList(taskId: string): Promise<TerminalSummary[]>;
  terminalOutput(terminalId: string, offset?: number, limit?: number): Promise<TerminalOutput>;
  terminalPorts(terminalId: string): Promise<number[]>;
  terminalInput(terminalId: string, data: string): Promise<void>;
  terminalResize(terminalId: string, columns: number, rows: number): Promise<void>;
  terminalKill(terminalId: string): Promise<void>;
  terminalRelease(terminalId: string): Promise<void>;
  taskCompletionGate(taskId: string): Promise<CompletionGate>;
  completeTask(taskId: string): Promise<CompletionGate>;
  exportTranscript(sessionId: string, format: "markdown" | "json"): Promise<string | null>;
  listWorktrees(workspaceRoot: string): Promise<WorktreeSummary[]>;
  createWorktree(req: {
    workspaceRoot: string;
    ref?: string | null;
    path?: string | null;
    branch?: string | null;
    privateChat?: boolean;
    dirtyPolicy: "clean_head" | "copy_dirty";
  }): Promise<WorktreeSummary>;
  deleteWorktree(
    path: string,
    mainWorkspace: string,
    force: boolean,
    privateChat?: boolean,
  ): Promise<void>;
  previewWorktreeApply(req: WorktreeApplyRequest): Promise<WorktreeApplyPreview>;
  applyWorktreeChanges(req: WorktreeApplyRequest): Promise<WorktreeApplyResult>;
}

function hasTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}

export const defaultDesktopBridge: DesktopBridge = hasTauriRuntime()
  ? tauriDesktopBridge
  : mockDesktopBridge;

export const DesktopBridgeContext = createContext<DesktopBridge>(defaultDesktopBridge);

export function useDesktopBridge(): DesktopBridge {
  return useContext(DesktopBridgeContext);
}
