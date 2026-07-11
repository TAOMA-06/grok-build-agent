/**
 * Permission prompt contracts.
 *
 * Option IDs and labels MUST come from the Agent — never hardcode allow-once.
 */

import type { JsonRpcId, ServerRequest } from "./events";
import type { ConnectionId } from "./runtime";
import type { SessionId } from "./session";
import type { ActionRequest } from "./platform";

/** ACP PermissionOptionKind values. */
export type PermissionOptionKind =
  | "allow_once"
  | "allow_always"
  | "reject_once"
  | "reject_always"
  | string;

export type PermissionOption = {
  optionId: string;
  name: string;
  kind: PermissionOptionKind;
  description?: string | null;
};

/**
 * Normalized permission prompt for the UI.
 * Only true permission requests become PermissionPrompt;
 * fs/terminal requests are handled internally by the host.
 */
export type PermissionPrompt = {
  requestId: JsonRpcId;
  connectionId: ConnectionId;
  sessionId: SessionId | null;
  method: string;
  toolCallId?: string | null;
  title?: string | null;
  description?: string | null;
  options: PermissionOption[];
  /** Original JSON-RPC request for debugging / respond passthrough. */
  raw: ServerRequest;
  receivedAt: string;
};

export type PermissionDecision = {
  requestId: JsonRpcId;
  /** Selected optionId from Agent-provided options. */
  optionId: string;
  /** Optional free-form feedback from the user. */
  feedback?: string | null;
};

export type StoredPolicyRule = {
  ruleId: string;
  workspaceId: string;
  sessionId?: string | null;
  scope: "session" | "project";
  action: ActionRequest;
  createdAt: string;
};

/** Methods that must never be shown as permission modals. */
export const INTERNAL_SERVER_METHODS = new Set([
  "fs/read_text_file",
  "fs/write_text_file",
  "terminal/create",
  "terminal/output",
  "terminal/wait_for_exit",
  "terminal/kill",
  "terminal/release",
  "fs/readTextFile",
  "fs/writeTextFile",
]);

const PERMISSION_METHODS = new Set([
  "session/request_permission",
  "session/requestPermission",
  "request_permission",
  "requestPermission",
]);

export function isPermissionMethod(method: string): boolean {
  return (
    PERMISSION_METHODS.has(method) ||
    method.endsWith("/request_permission") ||
    method.endsWith("/requestPermission") ||
    method.includes("request_permission") ||
    method.includes("requestPermission")
  );
}

export function isInternalServerMethod(method: string): boolean {
  return INTERNAL_SERVER_METHODS.has(method);
}

/**
 * Extract PermissionOption[] from ACP params without inventing IDs.
 * Returns empty array when options are missing (UI should show error, not defaults).
 */
export function extractPermissionOptions(params: unknown): PermissionOption[] {
  if (!params || typeof params !== "object") return [];
  const p = params as Record<string, unknown>;
  const raw = p.options;
  if (!Array.isArray(raw)) return [];

  const out: PermissionOption[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const optionId = o.optionId ?? o.option_id;
    const name = o.name ?? o.label;
    if (typeof optionId !== "string" || !optionId) continue;
    if (typeof name !== "string" || !name) continue;
    out.push({
      optionId,
      name,
      kind: String(o.kind ?? "unknown"),
      description:
        typeof o.description === "string" ? o.description : null,
    });
  }
  return out;
}

export function buildPermissionPrompt(args: {
  request: ServerRequest;
  connectionId: ConnectionId;
  sessionId?: SessionId | null;
  receivedAt?: string;
}): PermissionPrompt | null {
  const { request, connectionId } = args;
  if (!isPermissionMethod(request.method)) return null;
  if (isInternalServerMethod(request.method)) return null;

  const params =
    request.params && typeof request.params === "object"
      ? (request.params as Record<string, unknown>)
      : {};
  const options = extractPermissionOptions(request.params);
  const toolCall =
    params.toolCall && typeof params.toolCall === "object"
      ? (params.toolCall as Record<string, unknown>)
      : params.tool_call && typeof params.tool_call === "object"
        ? (params.tool_call as Record<string, unknown>)
        : null;

  return {
    requestId: request.id,
    connectionId,
    sessionId: args.sessionId ?? null,
    method: request.method,
    toolCallId: toolCall
      ? String(toolCall.toolCallId ?? toolCall.tool_call_id ?? "") || null
      : null,
    title: toolCall
      ? String(toolCall.title ?? toolCall.kind ?? "") || null
      : null,
    description:
      typeof params.description === "string" ? params.description : null,
    options,
    raw: request,
    receivedAt: args.receivedAt ?? new Date().toISOString(),
  };
}
