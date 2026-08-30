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

  it("shows a plan-mode pill when the active task is planning", () => {
    render(
      <ThreadView
        {...props}
        session={{
          ...recoveredSession,
          summary: { ...recoveredSession.summary, mode: "plan" },
          modeState: {
            currentMode: "plan",
            availableModes: [],
            liveSwitchSupported: false,
            source: "desktop",
          },
        }}
      />,
    );
    expect(screen.getByText("Plan")).toBeInTheDocument();
  });

  it("moves a host permission prompt into the blocking composer dock", () => {
    const { container } = render(
      <ThreadView
        {...props}
        session={{
          ...recoveredSession,
          // Non-empty transcript proves the prompt is docked rather than appended
          // to the scrolling timeline.
          blocks: [
            {
              id: "u1",
              type: "user",
              text: "run a shell check",
            },
          ],
        }}
        pendingPermission={{
          jsonrpc: "2.0",
          id: "platform:r1",
          method: "session/request_permission",
          params: {
            description:
              "Shell, interpreter, package script, network, or elevated tool requires confirmation",
            action: {
              argv: ["bash", "./hack.sh"],
              risk: "high",
              effect: "execute",
              tool: "terminal.create",
            },
            requiresSecondConfirmation: false,
            options: [
              { optionId: "platform:allow-once", name: "Allow once", kind: "allow_once" },
              { optionId: "platform:deny", name: "Deny", kind: "reject_once" },
            ],
          },
        }}
        permissionOptions={[
          { optionId: "platform:allow-once", name: "Allow once", kind: "allow_once" },
          { optionId: "platform:deny", name: "Deny", kind: "reject_once" },
        ]}
      />,
    );
    expect(screen.getByText(/Shell or script execution|Shell 或脚本执行/)).toBeInTheDocument();
    expect(screen.getByText(/bash \.\/hack\.sh/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allow once" })).toBeInTheDocument();
    expect(container.querySelector(".gb-composer-blocking-dock")).toBeInTheDocument();
    expect(screen.getByTestId("composer").closest(".gb-composer-shell")).toHaveAttribute("hidden");
    expect(container.querySelector(".gb-thread-scroll .gb-permission-card")).not.toBeInTheDocument();
  });
});
