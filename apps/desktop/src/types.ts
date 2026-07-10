/**
 * App-facing type barrel.
 * New code should import from `./contracts` directly; this file keeps
 * existing modules stable while contracts evolve.
 */

export type {
  AgentStatus,
  GrokProbe,
  HealthItem,
  RuntimeHealth,
  StartConfig,
  RuntimeSnapshot,
  ConnectionSnapshot,
  ConnectionKey,
  ConnectionId,
  ConnectionState,
  SandboxMode,
  PowerProfile,
  AgentCapabilitySnapshot,
  AuthMethodSummary,
} from "./contracts";

export type {
  Settings,
  RightPanel,
  ThemeId,
  OnboardingStep,
} from "./contracts";

export type {
  ToolCall,
  ChatBlock,
  SessionSummary,
  SessionId,
  SessionRunState,
  SessionUiState,
  InspectorSelection,
  AvailableCommand,
} from "./contracts";

export type {
  ServerRequest,
  SessionUpdate,
  SessionEventEnvelope,
  EventSource,
  JsonRpcId,
} from "./contracts";

export type {
  PermissionPrompt,
  PermissionOption,
  PermissionOptionKind,
  PermissionDecision,
} from "./contracts";

export type {
  ReviewSnapshot,
  ReviewFileEntry,
  ReviewFileStatus,
  FileDiff,
  DiffHunk,
  DiffLine,
  GitRepoState,
  ReviewFeedback,
} from "./contracts";

export type {
  WorkspaceRecord,
  WorktreeSummary,
  WorktreeCreateRequest,
  WorktreeDeleteRequest,
} from "./contracts";
