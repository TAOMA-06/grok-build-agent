import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DesktopBridge } from "../../platform/DesktopBridge";
import { DesktopBridgeContext } from "../../platform/DesktopBridge";
import { mockDesktopBridge } from "../../platform/mockBridge";
import type { SessionRuntime } from "../../store";
import { ExecutionFlightDeck } from "./ExecutionFlightDeck";

const session: SessionRuntime = {
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

function renderDeck(bridge: DesktopBridge) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <DesktopBridgeContext.Provider value={bridge}>
      <QueryClientProvider client={queryClient}>
        <ExecutionFlightDeck session={session} />
      </QueryClientProvider>
    </DesktopBridgeContext.Provider>,
  );
}

describe("ExecutionFlightDeck", () => {
  it("makes an explicitly recoverable execution visible and resumes through the bridge", async () => {
    const resumeExecution = vi.fn().mockResolvedValue({ scheduled: true });
    renderDeck({
      ...mockDesktopBridge,
      getExecution: vi.fn().mockResolvedValue({
        executionId: "execution-1",
        taskId: "task-recovery",
        workspaceId: "/repo",
        sessionId: "task-recovery",
        remoteSessionId: "remote-1",
        runtimeId: "old-connection",
        state: "recovering",
        version: 4,
        cancelEpoch: 0,
        currentIntentId: null,
        createdAt: "2026-07-16T00:00:00Z",
        updatedAt: "2026-07-16T00:01:00Z",
        completedAt: null,
      }),
      listExecutionEvents: vi.fn().mockResolvedValue([
        {
          eventId: "event-1",
          executionId: "execution-1",
          intentId: null,
          aggregateVersion: 4,
          kind: "recovery.queued",
          payload: {},
          createdAt: "2026-07-16T00:01:00Z",
        },
      ]),
      resumeExecution,
    });

    expect(await screen.findByText("Safe recovery is ready")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resume safely" }));
    await waitFor(() => {
      expect(resumeExecution).toHaveBeenCalledWith(
        "task-recovery",
        "connection-1",
        "remote-1",
      );
    });
  });
});
