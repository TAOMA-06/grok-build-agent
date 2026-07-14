/**
 * Session index and UI spine contracts.
 */

import type { ConnectionId, SandboxMode } from "./runtime";
import type { TaskMode } from "./mode";

export type SessionId = string;

export type SessionRunState =
  | "idle"
  | "streaming"
  | "awaiting_permission"
  | "awaiting_plan"
  | "cancelled"
  | "error"
  | "ended";

/** Lightweight row for the session sidebar / SQLite index. */
export type SessionSummary = {
  sessionId: SessionId;
  connectionId?: ConnectionId | null;
  workspaceRoot: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessagePreview?: string | null;
  runState: SessionRunState;
  /** ACP / Grok session id if different from local id. */
  remoteSessionId?: string | null;
  /** Associated worktree path when session is worktree-scoped. */
  worktreePath?: string | null;
  /** Actual cwd used by the ACP process (worktree when isolated). */
  executionRoot?: string | null;
  /** Git commit used as the worktree/apply safety baseline. */
  baseCommit?: string | null;
  mode?: TaskMode;
  permissionPolicy?: "workspace_edit" | "ask_all" | "full_auto";
  sandbox?: SandboxMode;
  archived?: boolean;
  attentionRequired?: boolean;
  appliedAt?: string | null;
  model?: string | null;
  /** Reasoning effort for this session when the model supports it. */
  reasoningEffort?: string | null;
  alwaysApprove: boolean;
  draft?: string | null;
};

export type ToolCall = {
  id: string;
  title: string;
  kind?: string;
  status: string;
  input?: unknown;
  output?: unknown;
};

/** Ordered execution-spine blocks shown in the center column. */
export type ChatBlock =
  | {
      type: "user";
      id: string;
      text: string;
      delivery?: "pending" | "queued" | "sent" | "failed";
      at?: string;
    }
  | { type: "assistant"; id: string; text: string; at?: string }
  | { type: "thought"; id: string; text: string; at?: string }
  | { type: "tool"; id: string; tool: ToolCall; at?: string }
  | { type: "plan"; id: string; text: string; at?: string }
  | {
      type: "system";
      id: string;
      text: string;
      level?: "info" | "error" | "warn";
      at?: string;
    }
  | { type: "subtask"; id: string; title: string; status: string; at?: string };

/** Per-session UI persistence (scroll, inspector, draft). */
export type SessionUiState = {
  sessionId: SessionId;
  scrollTop: number;
  draft: string;
  inspectorSelection?: InspectorSelection | null;
  collapsedToolIds: string[];
};

export type InspectorSelection =
  | { kind: "tool"; toolCallId: string }
  | { kind: "terminal"; terminalId: string }
  | { kind: "plan" }
  | { kind: "diff"; path?: string }
  | { kind: "diagnostics" };

export type AvailableCommand = {
  name: string;
  description?: string | null;
  input?: unknown;
};
