import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SessionRuntime } from "../../store";
import { ThreadView } from "./ThreadView";

vi.mock("./CommandComposer", () => ({
  CommandComposer: () => <div data-testid="composer" />,
}));

vi.mock("./EmptyTaskState", () => ({
  EmptyTaskState: () => <div data-testid="empty-task-state" />,
}));

vi.mock("./ExecutionFlightDeck", () => ({
  ExecutionFlightDeck: () => <div data-testid="execution-flight-deck" />,
}));

const recoveredSession: SessionRuntime = {
  summary: {
    sessionId: "task-recovery",
    connectionId: "connection-1",
    remoteSessionId: "remote-1",
    workspaceRoot: "/repo",
    executionRoot: "/repo/.worktrees/task-recovery",
    title: "Recover task",
    createdAt: "2026-07-16T00:00:00Z",
    updatedAt: "2026-07-16T00:00:00Z",
    runState: "idle",
    mode: "agent",
    permissionPolicy: "workspace_edit",
    sandbox: "workspace",
    archived: false,
    attentionRequired: true,
    alwaysApprove: false,
  },
  privateChat: false,
  blocks: [],
  tools: [],
  planText: "",
  draft: "",
  scrollTop: 0,
  busy: false,
  inspector: null,
  streamAssistantId: null,
  streamThoughtId: null,
  modelState: null,
  modeState: { currentMode: "agent", availableModes: [], liveSwitchSupported: false, source: "desktop" },
  availableCommands: [],
  attachments: [],
  failedSubmission: null,
  contextUsage: null,
};

const props = {
  workspaceName: "Workspace",
  models: [],
  connecting: false,
  drawerOpen: false,
  pendingPermission: null,
  pendingPlanApproval: null,
  permissionOptions: [],
  onToggleDrawer: vi.fn(),
  onOpenPath: vi.fn().mockResolvedValue(undefined),
  onSend: vi.fn().mockResolvedValue(undefined),
  onCancel: vi.fn().mockResolvedValue(undefined),
  onChooseModel: vi.fn().mockResolvedValue(undefined),
  onChooseEffort: vi.fn().mockResolvedValue(undefined),
  onChooseMode: vi.fn().mockResolvedValue({ kind: "unsupported", reason: "test" }),
  onLocalCommand: vi.fn(),
  onRetryFailed: vi.fn().mockResolvedValue(undefined),
  onAnswerPermission: vi.fn().mockResolvedValue(undefined),
  onPlanDecision: vi.fn().mockResolvedValue(undefined),
  onRename: vi.fn().mockResolvedValue(undefined),
  onArchive: vi.fn().mockResolvedValue(undefined),
  onDelete: vi.fn().mockResolvedValue(undefined),
};

describe("ThreadView", () => {
  it("keeps the recovery controls visible when a restored task has no cached blocks", () => {
    render(<ThreadView {...props} session={recoveredSession} />);

    expect(screen.getByTestId("execution-flight-deck")).toBeInTheDocument();
    expect(screen.queryByTestId("empty-task-state")).not.toBeInTheDocument();
  });

  it("shows the onboarding state only for a brand-new task", () => {
    render(<ThreadView {...props} session={null} />);

    expect(screen.getByTestId("empty-task-state")).toBeInTheDocument();
    expect(screen.queryByTestId("execution-flight-deck")).not.toBeInTheDocument();
  });
});
