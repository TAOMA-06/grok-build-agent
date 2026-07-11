/**
 * Workspace and worktree contracts.
 */

export type WorkspaceId = string;

export type WorkspaceRecord = {
  id: WorkspaceId;
  /** Absolute normalized path. */
  path: string;
  name: string;
  lastOpenedAt: string;
  favorite: boolean;
};

export type WorkspaceEntry = {
  path: string;
  name: string;
  directory: boolean;
  size?: number | null;
};

export type WorkspacePreview = {
  path: string;
  content?: string | null;
  binary: boolean;
  truncated: boolean;
  size: number;
};

export type WorktreeSource = "git" | "grok" | "merged";

export type WorktreeSummary = {
  path: string;
  branch?: string | null;
  head?: string | null;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
  /** Dirty / uncommitted when known. */
  dirty?: boolean | null;
  source: WorktreeSource;
  /** Linked primary workspace path. */
  mainWorkspace?: string | null;
};

export type WorktreeCreateRequest = {
  workspaceRoot: string;
  /** Create from HEAD or an explicit ref. */
  ref?: string | null;
  path?: string | null;
  branch?: string | null;
  /**
   * When source has uncommitted changes:
   * - clean_head: worktree at clean HEAD
   * - copy_dirty: copy working tree content (explicit user choice)
   * Never silent.
   */
  dirtyPolicy: "clean_head" | "copy_dirty";
};

export type WorktreeDeleteRequest = {
  path: string;
  force: boolean;
};

export type WorktreeApplyRequest = {
  mainWorkspace: string;
  worktreePath: string;
  baseCommit: string;
};

export type WorktreeApplyPreview = {
  ready: boolean;
  reason?: string | null;
  mainHead?: string | null;
  baseCommit: string;
  files: string[];
  untracked: string[];
  patchBytes: number;
};

export type WorktreeApplyResult = {
  appliedAt: string;
  filesApplied: number;
};
