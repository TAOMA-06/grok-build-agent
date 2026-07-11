import { invoke } from "@tauri-apps/api/core";
import type {
  ReviewSnapshot,
  CapabilitySnapshot,
  SessionSummary,
  SessionUiState,
  WorktreeApplyPreview,
  WorktreeApplyRequest,
  WorktreeApplyResult,
  WorkspaceRecord,
} from "../types";

export type WorktreeSummary = {
  path: string;
  branch?: string | null;
  head?: string | null;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
  dirty?: boolean | null;
  source: string;
  mainWorkspace?: string | null;
};

export type GrokSessionHint = {
  path: string;
  name: string;
  modifiedAt?: string | null;
};

export type CachedSessionEvent = {
  sessionId: string;
  sequence: number;
  timestamp: string;
  kind: string;
  payload: unknown;
};

export async function listWorkspaces(): Promise<WorkspaceRecord[]> {
  return invoke("list_workspaces");
}

export async function upsertWorkspace(
  path: string,
  name?: string,
): Promise<WorkspaceRecord> {
  return invoke("upsert_workspace", { path, name: name ?? null });
}

export async function listSessions(
  workspaceRoot?: string | null,
): Promise<SessionSummary[]> {
  return invoke("list_sessions", {
    workspaceRoot: workspaceRoot ?? null,
  });
}

export async function upsertSession(summary: SessionSummary): Promise<void> {
  return invoke("upsert_session", { summary });
}

export async function deleteSession(sessionId: string): Promise<void> {
  return invoke("delete_session", { sessionId });
}

export async function saveDraft(
  sessionId: string,
  draft: string,
): Promise<void> {
  return invoke("save_draft", { sessionId, draft });
}

export async function saveSessionUi(ui: SessionUiState): Promise<void> {
  return invoke("save_session_ui", { ui });
}

export async function loadSessionUi(
  sessionId: string,
): Promise<SessionUiState | null> {
  return invoke("load_session_ui", { sessionId });
}

export async function appendSessionEvent(event: CachedSessionEvent): Promise<void> {
  return invoke("append_session_event", {
    sessionId: event.sessionId,
    sequence: event.sequence,
    timestamp: event.timestamp,
    kind: event.kind,
    payload: event.payload,
  });
}

export async function listSessionEvents(sessionId: string): Promise<CachedSessionEvent[]> {
  return invoke("list_session_events", { sessionId });
}

export async function listGrokSessions(): Promise<GrokSessionHint[]> {
  return invoke("list_grok_sessions");
}

export async function inspectCapabilities(
  grokPath?: string,
  workspaceRoot?: string | null,
): Promise<CapabilitySnapshot> {
  return invoke("inspect_capabilities", {
    grokPath: grokPath || null,
    workspaceRoot: workspaceRoot ?? null,
  });
}

export async function gitReview(
  workspaceRoot: string,
): Promise<ReviewSnapshot> {
  return invoke("git_review", { workspaceRoot });
}

export async function gitFilePatch(
  workspaceRoot: string,
  path: string,
  staged: boolean,
): Promise<string> {
  return invoke("git_file_patch", { workspaceRoot, path, staged });
}

export async function gitFileAction(
  workspaceRoot: string,
  path: string,
  action: import("../types").GitFileAction,
): Promise<import("../types").GitMutationResult> {
  return invoke("git_file_action", { req: { workspaceRoot, path, action } });
}

export async function gitHunkAction(
  workspaceRoot: string,
  path: string,
  patch: string,
  action: import("../types").GitFileAction,
): Promise<import("../types").GitMutationResult> {
  return invoke("git_hunk_action", { req: { workspaceRoot, path, patch, action } });
}

export async function gitCommit(
  workspaceRoot: string,
  message: string,
): Promise<import("../types").GitCommitResult> {
  return invoke("git_commit", { req: { workspaceRoot, message } });
}

export async function gitCreateCheckpoint(
  workspaceRoot: string,
): Promise<import("../types").GitCheckpoint> {
  return invoke("git_create_checkpoint", { workspaceRoot });
}

export async function gitCheckpointRestorePreview(
  workspaceRoot: string,
  checkpointId: string,
): Promise<import("../types").GitCheckpointRestorePreview> {
  return invoke("git_checkpoint_restore_preview", { workspaceRoot, checkpointId });
}

export async function gitRestoreCheckpoint(
  workspaceRoot: string,
  checkpointId: string,
): Promise<import("../types").GitCheckpoint> {
  return invoke("git_restore_checkpoint", { workspaceRoot, checkpointId });
}

export async function workspaceTree(
  workspaceRoot: string,
  path?: string | null,
): Promise<import("../types").WorkspaceEntry[]> {
  return invoke("workspace_tree", { workspaceRoot, path: path ?? null });
}

export async function workspaceSearch(
  workspaceRoot: string,
  query: string,
): Promise<import("../types").WorkspaceEntry[]> {
  return invoke("workspace_search", { workspaceRoot, query });
}

export async function workspaceRead(
  workspaceRoot: string,
  path: string,
): Promise<import("../types").WorkspacePreview> {
  return invoke("workspace_read", { workspaceRoot, path });
}

export async function listPolicyRules(
  workspaceId?: string | null,
): Promise<import("../types").StoredPolicyRule[]> {
  return invoke("list_policy_rules", { workspaceId: workspaceId ?? null });
}

export async function deletePolicyRule(ruleId: string): Promise<void> {
  await invoke("delete_policy_rule", { ruleId });
}

export async function doctorStatus(): Promise<import("../types").DoctorStatus> {
  return invoke("doctor_status");
}

export async function restartAgentHost(): Promise<void> {
  return invoke("restart_agent_host");
}

export async function diagnosticBundlePreview(): Promise<string> {
  return invoke("diagnostic_bundle_preview");
}

export async function exportDiagnosticBundle(destination: string): Promise<{ path: string }> {
  return invoke("export_diagnostic_bundle", { destination });
}

export async function gcBlobs(): Promise<{ removed: number; reclaimedBytes: number }> {
  return invoke("gc_blobs");
}

export async function rebuildProjections(): Promise<import("../types").ProjectionRebuildReport> {
  return invoke("rebuild_projections");
}

export async function getTask(taskId: string): Promise<import("../types").TaskDefinition | null> {
  return invoke("get_task", { taskId });
}

export async function upsertTask(task: import("../types").TaskDefinition): Promise<void> {
  return invoke("upsert_task", { task });
}

export async function listContextManifests(taskId: string): Promise<import("../types").ContextManifest[]> {
  return invoke("list_context_manifests", { taskId });
}

export async function saveContextManifest(manifest: import("../types").ContextManifest): Promise<void> {
  return invoke("save_context_manifest", { manifest });
}

export async function listVerificationResults(taskId: string): Promise<import("../types").VerificationResult[]> {
  return invoke("list_verification_results", { taskId });
}

export async function saveVerificationResult(result: import("../types").VerificationResult): Promise<void> {
  return invoke("save_verification_result", { result });
}

export async function runVerification(
  taskId: string,
  workspaceRoot: string,
  command: string,
): Promise<import("../types").VerificationResult> {
  return invoke("run_verification", { taskId, workspaceRoot, command });
}

export type TerminalOutput = {
  output: string;
  exitCode: number | null;
  truncated: boolean;
  nextOffset: number;
  hasMore: boolean;
};

export async function terminalCreate(
  taskId: string,
  workspaceRoot: string,
  command: string,
  args: string[],
): Promise<{ terminalId: string; pid: number }> {
  return invoke("terminal_create", { taskId, workspaceRoot, command, args });
}

export type TerminalSummary = {
  terminalId: string;
  taskId: string;
  workspaceRoot: string;
  pid: number;
  exitCode: number | null;
};

export async function terminalList(taskId: string): Promise<TerminalSummary[]> {
  return invoke("terminal_list", { taskId });
}

export async function terminalOutput(
  terminalId: string,
  offset = 0,
  limit = 64 * 1024,
): Promise<TerminalOutput> {
  return invoke("terminal_output", { terminalId, offset, limit });
}

export async function terminalPorts(terminalId: string): Promise<number[]> {
  const result = await invoke<{ ports: number[] }>("terminal_ports", { terminalId });
  return result.ports;
}

export async function terminalInput(terminalId: string, data: string): Promise<void> {
  await invoke("terminal_input", { terminalId, data });
}

export async function terminalResize(terminalId: string, columns: number, rows: number): Promise<void> {
  await invoke("terminal_resize", { terminalId, columns, rows });
}

export async function terminalKill(terminalId: string): Promise<void> {
  await invoke("terminal_kill", { terminalId });
}

export async function terminalRelease(terminalId: string): Promise<void> {
  await invoke("terminal_release", { terminalId });
}

export async function taskCompletionGate(taskId: string): Promise<import("../types").CompletionGate> {
  return invoke("task_completion_gate", { taskId });
}

export async function completeTask(taskId: string): Promise<import("../types").CompletionGate> {
  return invoke("complete_task", { taskId });
}

export async function exportTranscript(
  sessionId: string,
  format: "markdown" | "json",
  destination: string,
): Promise<{ path: string; format: string; events: number }> {
  return invoke("export_transcript", { sessionId, format, destination });
}

export async function listWorktrees(
  workspaceRoot: string,
): Promise<WorktreeSummary[]> {
  return invoke("list_worktrees", { workspaceRoot });
}

export async function createWorktree(req: {
  workspaceRoot: string;
  ref?: string | null;
  path?: string | null;
  branch?: string | null;
  dirtyPolicy: "clean_head" | "copy_dirty";
}): Promise<WorktreeSummary> {
  return invoke("create_worktree", {
    req: {
      workspaceRoot: req.workspaceRoot,
      ref: req.ref ?? null,
      path: req.path ?? null,
      branch: req.branch ?? null,
      dirtyPolicy: req.dirtyPolicy,
    },
  });
}

export async function deleteWorktree(
  path: string,
  mainWorkspace: string,
  force: boolean,
): Promise<void> {
  return invoke("delete_worktree", {
    req: { path, force },
    mainWorkspace,
  });
}

export async function worktreeDeletePreview(
  path: string,
): Promise<{ path: string; branch?: string; dirty: boolean }> {
  return invoke("worktree_delete_preview", { path });
}

export async function previewWorktreeApply(
  req: WorktreeApplyRequest,
): Promise<WorktreeApplyPreview> {
  return invoke("worktree_apply_preview", { req });
}

export async function applyWorktreeChanges(
  req: WorktreeApplyRequest,
): Promise<WorktreeApplyResult> {
  return invoke("apply_worktree_changes", { req });
}

export type PluginInfo = {
  name: string;
  version?: string | null;
  enabled: boolean;
  path?: string | null;
  description?: string | null;
};

export type {
  McpServerInfo,
  McpServerInput,
  McpDoctorResult,
  McpListResult,
  McpScope,
  McpTransport,
} from "../contracts";

export type UpdateCheck = {
  currentVersion?: string | null;
  latestVersion?: string | null;
  updateAvailable: boolean;
  channel?: string | null;
};

export type InstallProgress = {
  phase: string;
  detail: string;
  ok: boolean;
};

export async function listPlugins(grokPath?: string): Promise<PluginInfo[]> {
  return invoke("list_plugins", { grokPath: grokPath || null });
}

export async function installPlugin(
  source: string,
  grokPath?: string,
): Promise<string> {
  return invoke("install_plugin", { source, grokPath: grokPath || null });
}

export async function uninstallPlugin(
  name: string,
  grokPath?: string,
): Promise<string> {
  return invoke("uninstall_plugin", { name, grokPath: grokPath || null });
}

export async function setPluginEnabled(
  name: string,
  enabled: boolean,
  grokPath?: string,
): Promise<string> {
  return invoke("set_plugin_enabled", {
    name,
    enabled,
    grokPath: grokPath || null,
  });
}

export async function validateHarnessPlugin(
  path: string,
  grokPath?: string,
): Promise<string> {
  return invoke("validate_harness_plugin", {
    path,
    grokPath: grokPath || null,
  });
}

export async function listMcpServers(
  grokPath?: string,
  workspaceRoot?: string | null,
): Promise<import("../contracts").McpListResult> {
  return invoke("list_mcp_servers", {
    grokPath: grokPath || null,
    workspaceRoot: workspaceRoot ?? null,
  });
}

export async function upsertMcpServer(
  input: import("../contracts").McpServerInput,
  grokPath?: string,
): Promise<string> {
  return invoke("upsert_mcp_server", {
    input,
    grokPath: grokPath || null,
  });
}

export async function removeMcpServer(
  name: string,
  options?: {
    grokPath?: string;
    scope?: import("../contracts").McpScope | null;
    workspaceRoot?: string | null;
  },
): Promise<string> {
  return invoke("remove_mcp_server", {
    name,
    grokPath: options?.grokPath || null,
    scope: options?.scope ?? null,
    workspaceRoot: options?.workspaceRoot ?? null,
  });
}

export async function doctorMcpServer(
  name?: string | null,
  options?: {
    grokPath?: string;
    workspaceRoot?: string | null;
  },
): Promise<import("../contracts").McpDoctorResult[]> {
  return invoke("doctor_mcp_server", {
    name: name ?? null,
    grokPath: options?.grokPath || null,
    workspaceRoot: options?.workspaceRoot ?? null,
  });
}

export async function checkCliUpdate(
  grokPath?: string,
): Promise<UpdateCheck> {
  return invoke("check_cli_update", { grokPath: grokPath || null });
}

export async function runCliUpdate(grokPath?: string): Promise<string> {
  return invoke("run_cli_update", { grokPath: grokPath || null });
}

export async function runCliLogin(grokPath?: string): Promise<string> {
  return invoke("run_cli_login", { grokPath: grokPath || null });
}

export async function runCliLogout(grokPath?: string): Promise<string> {
  return invoke("run_cli_logout", { grokPath: grokPath || null });
}

export async function installCliOfficial(): Promise<InstallProgress[]> {
  return invoke("install_cli_official");
}

export async function officialInstallUrl(): Promise<string> {
  return invoke("official_install_url");
}

export async function cancelPrompt(): Promise<unknown> {
  return invoke("cancel_prompt");
}
