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
  AgentHostHealth,
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
  SessionModeState,
  SelectableMode,
  ModeSource,
  ModeSwitchResult,
  CommandDescriptor,
  CommandSource,
  CommandExecution,
  ParsedSlashCommand,
} from "./contracts";

export type {
  BootstrapState,
  TaskMode,
  PermissionPolicy,
  ThreadSummary,
  TimelineItem,
  CapabilityItem,
  CapabilitySnapshot,
  AuthFlowState,
} from "./contracts";

export type {
  Settings,
  RightPanel,
  WorkbenchSurface,
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
  ComposerDraft,
  ComposerAttachment,
  PromptContent,
  AttachmentKind,
  AttachmentSource,
  AttachmentValidationCode,
  AttachmentValidationIssue,
  FailedSubmission,
} from "./contracts";

export type {
  SelectableModel,
  SessionModelState,
  ModelSource,
  ModelSwitchResult,
  EffortSwitchResult,
  SessionContextUsage,
  ReasoningEffortOption,
  ReasoningEffortLevel,
} from "./contracts";

export type {
  McpTransport,
  McpScope,
  McpServerInput,
  McpServerInfo,
  McpDoctorResult,
  McpListResult,
  McpSecretField,
  SecretFieldAction,
  McpToolSummary,
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
  StoredPolicyRule,
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
  GitFileAction,
  GitCheckpoint,
  GitMutationResult,
  GitCommitResult,
  GitCheckpointRestorePreview,
} from "./contracts";

export type {
  WorkspaceRecord,
  WorktreeSummary,
  WorktreeCreateRequest,
  WorktreeDeleteRequest,
  WorktreeApplyRequest,
  WorktreeApplyPreview,
  WorktreeApplyResult,
  WorkspaceEntry,
  WorkspacePreview,
} from "./contracts";

export type {
  TaskState,
  PlatformEvent,
  DispatchState,
  PromptDispatch,
  PromptDispatchContext,
  ExecutionState,
  ExecutionIntentState,
  ExecutionRun,
  ExecutionIntent,
  ExecutionEvent,
  ExecutionLease,
  ExecutionRecoverySummary,
  RiskLevel,
  ActionEffect,
  ActionRequest,
  PolicyDecisionKind,
  PolicyDecision,
  TaskDefinition,
  VerificationStatus,
  VerificationResult,
  ContextManifestEntry,
  ContextManifest,
  CompletionGate,
  ProjectionRebuildReport,
  DoctorStatus,
} from "./contracts";
