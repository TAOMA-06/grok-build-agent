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
