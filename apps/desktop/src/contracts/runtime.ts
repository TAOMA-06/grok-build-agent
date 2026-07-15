/**
 * Runtime pool contracts shared by UI and host.
 *
 * A RuntimePool key groups one ACP child process by:
 * workspace root + sandbox mode + privacy policy + power profile + model id.
 */

import type { SessionModelState } from "./model";
import type { AvailableCommand } from "./session";
import type { SessionModeState } from "./mode";

/** Optional sandbox mode passed to the Grok agent process. */
export type SandboxMode = "none" | "workspace" | "strict";

/**
 * Optional performance / resource profile.
 * Default is off (null) — profile is never silently injected.
 */
export type PowerProfile = "balanced" | "performance" | "efficiency" | null;

/** Stable identity for one ACP connection (one child process). */
export type ConnectionKey = {
  /** Absolute, normalized workspace root. */
  workspaceRoot: string;
  sandbox: SandboxMode;
  alwaysApprove: boolean;
  powerProfile: PowerProfile;
/**
   * Model id used when spawning the process.
   * Included so agents that cannot live-switch models never reuse the wrong process.
   */
  modelId?: string | null;
  /**
   * Reasoning effort used at process spawn (`--reasoning-effort`).
   * Included so live-switch failures do not reuse a process with the wrong effort.
   */
  reasoningEffort?: string | null;
  /** Process-level Grok privacy policy; prevents reuse across different CLI controls. */
  privacyMode?: import("./settings").PrivacyMode;
};

export type ConnectionId = string;

export type ConnectionState =
  | "starting"
  | "initializing"
  | "authenticating"
  | "ready"
  | "reconnecting"
  | "stopped"
  | "error";

/** Capability snapshot from ACP `initialize` / agent responses. */
export type AgentCapabilitySnapshot = {
  protocolVersion?: number | string | null;
  agentName?: string | null;
  agentVersion?: string | null;
  loadSession?: boolean;
  listSessions?: boolean;
  fs?: boolean;
  terminal?: boolean;
  authMethods: AuthMethodSummary[];
  models: string[];
  currentModelId?: string | null;
  availableCommands: AvailableCommand[];
  availableModes: SessionModeState["availableModes"];
  raw?: unknown;
};

export type AuthMethodSummary = {
  id: string;
  name: string;
  description?: string | null;
};

/** One live ACP connection inside the pool. */
export type ConnectionSnapshot = {
  connectionId: ConnectionId;
  key: ConnectionKey;
  state: ConnectionState;
  grokPath?: string | null;
  pid?: number | null;
  sessionIds: string[];
  capabilities?: AgentCapabilitySnapshot | null;
  lastError?: string | null;
  startedAt?: string | null;
  lastEventAt?: string | null;
};

/** Full runtime pool view for UI / diagnostics. */
export type RuntimeSnapshot = {
  connections: ConnectionSnapshot[];
  activeConnectionId?: ConnectionId | null;
  activeSessionId?: string | null;
  updatedAt: string;
};

/** Config used when spawning / attaching a connection. */
export type StartConfig = {
  taskId?: string | null;
  grokPath?: string | null;
  model?: string | null;
  /** CLI `--reasoning-effort` / `--effort` when the model supports it. */
  reasoningEffort?: string | null;
  alwaysApprove: boolean;
  cwd: string;
  rules?: string | null;
  agentProfile?: string | null;
  useHarness: boolean;
  sandbox?: SandboxMode;
  /** Strict is the default and applies local CLI privacy controls at process start. */
  privacyMode?: import("./settings").PrivacyMode;
  powerProfile?: PowerProfile;
  resumeSessionId?: string | null;
};

/** Process-level status (legacy single-runtime + pool-compatible). */
export type AgentStatus = {
  running: boolean;
  connectionId?: ConnectionId | null;
  sessionId?: string | null;
  cwd?: string | null;
  grokPath?: string | null;
  lastError?: string | null;
  /** Current session model snapshot when a connection is active. */
  model?: SessionModelState | null;
  mode?: SessionModeState | null;
  availableCommands?: AvailableCommand[];
};

export type GrokProbe = {
  found: boolean;
  path?: string | null;
  version?: string | null;
  error?: string | null;
};

export type HealthItem = {
  id: string;
  label: string;
  ok: boolean;
  detail?: string | null;
};

export type RuntimeHealth = {
  grok: GrokProbe;
  authenticated: boolean;
  authMethod?: string | null;
  authHint?: string | null;
  grokHome?: string | null;
  ready: boolean;
  checklist: HealthItem[];
};

export type AgentHostHealth = {
  protocolVersion: number;
  pid: number;
  database: string;
  status: AgentStatus;
};

/** Build a deterministic string key for maps / logging. */
export function connectionKeyString(key: ConnectionKey): string {
  const profile = key.powerProfile ?? "off";
  const model = key.modelId?.trim() || "default";
  const effort = key.reasoningEffort?.trim() || "default";
  const privacy = key.privacyMode === "standard" ? "standard" : "strict";
  return `${key.workspaceRoot}::${key.sandbox}::${profile}::${privacy}::${key.alwaysApprove ? "approve" : "ask"}::${model}::${effort}`;
}

export function emptyRuntimeSnapshot(now = new Date().toISOString()): RuntimeSnapshot {
  return {
    connections: [],
    activeConnectionId: null,
    activeSessionId: null,
    updatedAt: now,
  };
}
