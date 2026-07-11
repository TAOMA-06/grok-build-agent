/** Versioned control-plane contracts. Rust is the canonical schema source. */

export const HOST_PROTOCOL_VERSION = 1 as const;
export const EVENT_SCHEMA_VERSION = 1 as const;

export type TaskState =
  | "draft"
  | "preparing"
  | "running"
  | "awaiting_input"
  | "awaiting_permission"
  | "delivery_unknown"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskDefinition = {
  taskId: string;
  workspaceId: string;
  state: TaskState;
  goal?: string | null;
  constraints: string[];
  acceptance: string[];
  allowedPaths: string[];
  verificationCommands: string[];
  createdAt: string;
  updatedAt: string;
};

export type VerificationStatus = "passed" | "failed" | "not_run" | "blocked";

export type VerificationResult = {
  verificationId: string;
  taskId: string;
  turnId: string;
  command: string;
  status: VerificationStatus;
  summary?: string | null;
  exitCode?: number | null;
  createdAt: string;
};

export type ContextManifestEntry = {
  source: string;
  kind: string;
  trust: string;
  tokenEstimate: number;
  truncatedReason?: string | null;
  metadata: Record<string, unknown>;
};

export type ContextManifest = {
  manifestId: string;
  taskId: string;
  turnId: string;
  tokenBudget: number;
  entries: ContextManifestEntry[];
  createdAt: string;
};

export type CompletionGate = {
  ready: boolean;
  blockers: string[];
  verification: VerificationResult[];
};

export type ProjectionRebuildReport = {
  processedEvents: number;
  projectedEntities: number;
  lastRowid: number;
  rebuiltAt: string;
};

export type DoctorStatus = {
  host: string;
  protocolVersion: number;
  pid: number;
  database: string;
  databasePath: string;
  socket?: string | null;
  runtime: unknown;
  strictNetworkIsolation: boolean;
  pendingPermissions: number;
  blobBytes: number;
};

export type PlatformEvent<TPayload = unknown> = {
  eventId: string;
  workspaceId: string;
  taskId: string;
  sessionId: string;
  turnId?: string | null;
  runtimeId: string;
  sequence: number;
  timestamp: string;
  kind: string;
  schemaVersion: number;
  payload: TPayload;
  causationId?: string | null;
  correlationId: string;
  dedupeKey?: string | null;
};

export type DispatchState =
  | "prepared"
  | "sending"
  | "acknowledged"
  | "delivery_unknown"
  | "failed"
  | "cancelled";

export type PromptDispatch = {
  dispatchId: string;
  idempotencyKey: string;
  workspaceId: string;
  taskId: string;
  sessionId: string;
  turnId: string;
  runtimeId: string;
  state: DispatchState;
  createdAt: string;
  updatedAt: string;
  acknowledgedAt?: string | null;
  errorSummary?: string | null;
};

export type PromptDispatchContext = {
  taskId: string;
  turnId: string;
  idempotencyKey: string;
};

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type ActionEffect =
  | "read"
  | "write"
  | "execute"
  | "network"
  | "external_side_effect"
  | "destructive";

export type ActionRequest = {
  requestId: string;
  actor: string;
  workspaceId: string;
  taskId: string;
  sessionId: string;
  tool: string;
  effect: ActionEffect;
  argv: string[];
  paths: string[];
  networkTargets: string[];
  secretRefs: string[];
  risk: RiskLevel;
  deadline: string;
  metadata: Record<string, unknown>;
};

export type PolicyDecisionKind =
  | "allow_once"
  | "allow_session"
  | "allow_project"
  | "deny"
  | "require_confirmation";

export type PolicyDecision = {
  requestId: string;
  decision: PolicyDecisionKind;
  decidedAt: string;
  reason: string;
  matchedRuleIds: string[];
  requiresSecondConfirmation: boolean;
};

export function isPlatformEvent(value: unknown): value is PlatformEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.eventId === "string" && event.eventId.length > 0 &&
    typeof event.workspaceId === "string" && event.workspaceId.length > 0 &&
    typeof event.taskId === "string" && event.taskId.length > 0 &&
    typeof event.sessionId === "string" && event.sessionId.length > 0 &&
    typeof event.runtimeId === "string" && event.runtimeId.length > 0 &&
    typeof event.sequence === "number" &&
    typeof event.timestamp === "string" &&
    typeof event.kind === "string" && event.kind.length > 0 &&
    typeof event.schemaVersion === "number" && event.schemaVersion > 0 &&
    typeof event.correlationId === "string" && event.correlationId.length > 0 &&
    "payload" in event
  );
}
