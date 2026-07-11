/**
 * Event envelopes for ACP / host → UI streams.
 *
 * Every event carries connectionId, sessionId, sequence, and timestamp
 * so multi-workspace / multi-session streams never cross-wire.
 */

import type { ConnectionId } from "./runtime";
import type { SessionId } from "./session";

export type EventSource =
  | "acp"
  | "runtime"
  | "git"
  | "worktree"
  | "system"
  | "extension";

/** Wire envelope for all session-scoped notifications. */
export type SessionEventEnvelope<TPayload = unknown> = {
  connectionId: ConnectionId;
  sessionId: SessionId | null;
  /** Monotonic per-connection sequence (not global). */
  sequence: number;
  /** ISO-8601 timestamp from the host when the event was emitted. */
  timestamp: string;
  source: EventSource;
  kind: string;
  payload: TPayload;
};

/** Loose ACP session/update body (agent may use camelCase or snake_case). */
export type SessionUpdate = {
  sessionUpdate?: string;
  content?: { type?: string; text?: string } | string;
  title?: string;
  kind?: string;
  status?: string;
  toolCallId?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
  text?: string;
  plan?: unknown;
  update?: SessionUpdate;
  tool_call_id?: string;
  raw_input?: unknown;
  raw_output?: unknown;
  input?: unknown;
  output?: unknown;
  [key: string]: unknown;
};

export type JsonRpcId = string | number;

/** Generic JSON-RPC server → client request (permission, fs, terminal, …). */
export type ServerRequest = {
  jsonrpc?: string;
  id: JsonRpcId;
  method: string;
  params?: unknown;
  /** Routing metadata added by the desktop host; never sent back to Grok. */
  connectionId?: string;
  sessionId?: string | null;
};

export function createEventEnvelope<T>(
  partial: Omit<SessionEventEnvelope<T>, "timestamp" | "sequence"> & {
    sequence: number;
    timestamp?: string;
  },
): SessionEventEnvelope<T> {
  return {
    connectionId: partial.connectionId,
    sessionId: partial.sessionId,
    sequence: partial.sequence,
    timestamp: partial.timestamp ?? new Date().toISOString(),
    source: partial.source,
    kind: partial.kind,
    payload: partial.payload,
  };
}

export function isSessionEventEnvelope(
  value: unknown,
): value is SessionEventEnvelope {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.connectionId === "string" &&
    typeof v.sequence === "number" &&
    typeof v.timestamp === "string" &&
    typeof v.source === "string" &&
    typeof v.kind === "string" &&
    "payload" in v
  );
}
