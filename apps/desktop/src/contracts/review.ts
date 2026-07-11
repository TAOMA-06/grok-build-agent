/**
 * Git review / diff contracts (read-only first version).
 * First release: inspect + feedback only — no one-click discard/reset.
 */

export type GitRepoState =
  | "clean"
  | "dirty"
  | "not_a_repo"
  | "error";

export type ReviewFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "binary"
  | "conflicted";

export type ReviewFileEntry = {
  path: string;
  oldPath?: string | null;
  status: ReviewFileStatus;
  staged: boolean;
  additions: number;
  deletions: number;
  binary: boolean;
};

export type DiffHunk = {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
};

export type DiffLineKind = "context" | "add" | "del" | "meta";

export type DiffLine = {
  kind: DiffLineKind;
  text: string;
  oldLineNo?: number | null;
  newLineNo?: number | null;
};

export type FileDiff = {
  path: string;
  oldPath?: string | null;
  status: ReviewFileStatus;
  binary: boolean;
  truncated: boolean;
  hunks: DiffHunk[];
  rawPatch?: string | null;
};

/** Aggregate review snapshot for the Diff panel. */
export type ReviewSnapshot = {
  workspaceRoot: string;
  repoRoot?: string | null;
  head?: string | null;
  branch?: string | null;
  state: GitRepoState;
  files: ReviewFileEntry[];
  stagedDiff?: FileDiff[] | null;
  unstagedDiff?: FileDiff[] | null;
  untracked: string[];
  error?: string | null;
  refreshedAt: string;
};

/** User selection sent back to the agent as feedback. */
export type ReviewFeedback = {
  workspaceRoot: string;
  paths: string[];
  note?: string | null;
  includePatch: boolean;
};

export type GitFileAction = "stage" | "unstage" | "revert";

export type GitCheckpoint = {
  checkpointId: string;
  head: string;
  createdAt: string;
  files: string[];
  bytes: number;
};

export type GitMutationResult = {
  checkpoint?: GitCheckpoint | null;
};

export type GitCheckpointRestorePreview = {
  checkpoint: GitCheckpoint;
  currentHead: string;
  ready: boolean;
  reason?: string | null;
};

export type GitCommitResult = {
  commit: string;
  summary: string;
};
