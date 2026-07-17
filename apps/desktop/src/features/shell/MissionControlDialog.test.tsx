import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SessionRuntime } from "../../store";
import { MissionControlDialog } from "./MissionControlDialog";

function session(overrides: Partial<SessionRuntime["summary"]> & Pick<Partial<SessionRuntime>, "busy">): SessionRuntime {
  const { busy = false, ...summary } = overrides;
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
      ...summary,
    },
    privateChat: false,
    blocks: [],
    tools: [],
    planText: "",
    draft: "",
    scrollTop: 0,
    busy,
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

describe("MissionControlDialog", () => {
  it("puts operator attention ahead of active and idle work, then opens the selected task", () => {
    const onOpenSession = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <MissionControlDialog
        open
        onOpenChange={onOpenChange}
        sessions={[
          session({ sessionId: "task-idle", title: "Idle task" }),
          session({ sessionId: "task-working", title: "Working task", busy: true }),
          session({ sessionId: "task-recovery", title: "Recover task", attentionRequired: true }),
        ]}
        onOpenSession={onOpenSession}
        onNewTask={vi.fn()}
      />,
    );

    const recovery = screen.getByRole("button", { name: "Needs attention: Recover task" });
    const working = screen.getByRole("button", { name: "Working: Working task" });
    const idle = screen.getByRole("button", { name: "Ready: Idle task" });

    expect(recovery.compareDocumentPosition(working) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(working.compareDocumentPosition(idle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(recovery);
    expect(onOpenSession).toHaveBeenCalledWith("task-recovery");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
