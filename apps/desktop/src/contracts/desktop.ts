import type { ComposerAttachment } from "./composer";
import type { RuntimeHealth } from "./runtime";
import type { SelectableModel } from "./model";
import type { ChatBlock, SessionRunState, SessionSummary } from "./session";
import type { Settings } from "./settings";
import type { WorkspaceRecord } from "./workspace";
import type { TaskMode } from "./mode";

export type BootstrapState =
  | { status: "checking" }
  | { status: "needs_cli"; health: RuntimeHealth }
  | { status: "needs_auth"; health: RuntimeHealth }
  | { status: "ready"; health: RuntimeHealth }
  | { status: "error"; message: string; detail?: string | null };

export type PermissionPolicy = "workspace_edit" | "ask_all" | "full_auto";

export type ThreadSummary = SessionSummary & {
  executionRoot?: string | null;
  baseCommit?: string | null;
  mode?: TaskMode;
  permissionPolicy?: PermissionPolicy;
  archived?: boolean;
  attentionRequired?: boolean;
  appliedAt?: string | null;
};

export type TimelineItem =
  | ChatBlock
  | {
      type: "command";
      id: string;
      command: string;
      status: "running" | "completed" | "failed";
      output?: string | null;
      at?: string;
    }
  | {
      type: "file_change";
      id: string;
      path: string;
      status: "added" | "modified" | "deleted";
      at?: string;
    }
  | {
      type: "question";
      id: string;
      title: string;
      description?: string | null;
      options: Array<{ id: string; label: string; description?: string | null }>;
      at?: string;
    }
  | {
      type: "result";
      id: string;
      title: string;
      summary: string;
      status: "completed" | "failed" | "cancelled";
      at?: string;
    };

export type CapabilityItem = {
  id: string;
  name: string;
  description?: string | null;
  source?: string | null;
  enabled?: boolean;
};

/** Read-only status from `grok inspect --json`; no external history is exposed. */
export type ExternalCompatibilityCell = {
  vendor: string;
  surface: string;
  enabled?: boolean | null;
  source?: string | null;
};

export type ExternalCompatibilitySnapshot = {
  remoteSettingsLoaded?: boolean | null;
  cells: ExternalCompatibilityCell[];
};

export type CapabilitySnapshot = {
  skills: CapabilityItem[];
  plugins: CapabilityItem[];
  hooks: CapabilityItem[];
  mcpServers: CapabilityItem[];
  commands: CapabilityItem[];
  rules: CapabilityItem[];
  externalCompat?: ExternalCompatibilitySnapshot | null;
  raw?: unknown;
};

export type AuthFlowState = {
  status: "idle" | "starting" | "waiting" | "complete" | "error";
  verificationUrl?: string | null;
  userCode?: string | null;
  message?: string | null;
};

export type MockScenario = "empty" | "running" | "permission" | "goal" | "error";

export type MockThreadFixture = {
  summary: ThreadSummary;
  blocks: ChatBlock[];
  runState: SessionRunState;
  attachments?: ComposerAttachment[];
};

export type DesktopSnapshot = {
  settings: Settings;
  health: RuntimeHealth;
  workspaces: WorkspaceRecord[];
  threads: MockThreadFixture[];
  models: SelectableModel[];
};
