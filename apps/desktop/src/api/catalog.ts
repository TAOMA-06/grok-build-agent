import { invoke } from "@tauri-apps/api/core";
import type {
  ReviewSnapshot,
  SessionSummary,
  SessionUiState,
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

export async function listGrokSessions(): Promise<GrokSessionHint[]> {
  return invoke("list_grok_sessions");
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

export type PluginInfo = {
  name: string;
  version?: string | null;
  enabled: boolean;
  path?: string | null;
  description?: string | null;
};

export type McpServerInfo = {
  name: string;
  command?: string | null;
  status?: string | null;
};

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
): Promise<McpServerInfo[]> {
  return invoke("list_mcp_servers", { grokPath: grokPath || null });
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
