import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SessionRuntime } from "../../store";
import { ProjectSidebar } from "./ProjectSidebar";

function session(overrides: Partial<SessionRuntime["summary"]>): SessionRuntime {
  return {
    summary: {
      sessionId: "task-default",
      connectionId: null,
      remoteSessionId: null,
      workspaceRoot: "/repo",
      executionRoot: "/repo/.worktrees/task-default",
      title: "Normal task",
      createdAt: "2026-07-16T00:00:00Z",
      updatedAt: "2026-07-16T00:00:00Z",
      runState: "idle",
      mode: "agent",
      permissionPolicy: "workspace_edit",
      sandbox: "workspace",
      archived: false,
      attentionRequired: false,
      alwaysApprove: false,
      ...overrides,
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
}

describe("ProjectSidebar", () => {
  it("surfaces Host-marked recovery work ahead of idle tasks with a textual status", () => {
    render(
      <ProjectSidebar
        workspaces={[{ id: "repo", name: "repo", path: "/repo", lastOpenedAt: "2026-07-16T00:00:00Z", favorite: false }]}
        sessions={[
          session({ sessionId: "task-idle", title: "Normal task" }),
          session({ sessionId: "task-recovery", title: "Recover task", attentionRequired: true }),
        ]}
        activeSessionId={null}
        activeWorkspace="/repo"
        onNewThread={vi.fn()}
        onSelectSession={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onSelectWorkspace={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenDashboard={vi.fn()}
      />,
    );

    const recovery = screen.getByRole("button", { name: "Needs attention: Recover task" });
    const idle = screen.getByRole("button", { name: "Normal task" });

    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect(recovery.compareDocumentPosition(idle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
