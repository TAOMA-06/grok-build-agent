import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyComposerDraft } from "../../contracts";
import { DesktopBridgeContext, type DesktopBridge } from "../../platform/DesktopBridge";
import { mockDesktopBridge } from "../../platform/mockBridge";
import { defaultSettings, useAppStore, type SessionRuntime } from "../../store";
import type { SessionSummary } from "../../types";
import { useDesktopController } from "./useDesktopController";

function wrapper(bridge: DesktopBridge) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <DesktopBridgeContext.Provider value={bridge}>{children}</DesktopBridgeContext.Provider>;
  };
}

function runtime(summary: SessionSummary): SessionRuntime {
  return {
    summary,
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
    modeState: { currentMode: summary.mode ?? "agent", availableModes: [], liveSwitchSupported: false, source: "desktop" },
    availableCommands: [],
    attachments: [],
    failedSubmission: null,
  };
}

describe("useDesktopController", () => {
  beforeEach(() => {
    useAppStore.setState({
      settings: { ...defaultSettings(), cwd: "/Users/demo/Projects/orbit", onboardingDone: true },
      sessions: {},
      sessionOrder: [],
      activeSessionId: null,
      provisionalDraft: emptyComposerDraft("grok-build"),
    });
  });

  it("restores the draft and marks the message failed when connection startup fails", async () => {
    const bridge: DesktopBridge = {
      ...mockDesktopBridge,
      startAgent: vi.fn().mockRejectedValue(new Error("connection failed")),
    };
    const { result } = renderHook(
      () => useDesktopController(async () => "clean_head"),
      { wrapper: wrapper(bridge) },
    );
    await act(async () => {
      await result.current.send("keep this draft", [], "agent");
    });
    const state = useAppStore.getState();
    const session = state.activeSessionId ? state.sessions[state.activeSessionId] : null;
    expect(session?.draft).toBe("keep this draft");
    expect(session?.failedSubmission?.text).toBe("keep this draft");
    expect(session?.blocks.find((block) => block.type === "user")).toMatchObject({ delivery: "failed" });
  });

  it("reconnects a persisted task before sending when its process is no longer live", async () => {
    const summary: SessionSummary = {
      sessionId: "persisted-local",
      connectionId: "stale-connection",
      remoteSessionId: "remote-session",
      workspaceRoot: "/repo",
      title: "Persisted task",
      createdAt: "now",
      updatedAt: "now",
      runState: "idle",
      mode: "agent",
      alwaysApprove: false,
      sandbox: "workspace",
    };
    useAppStore.setState({
      sessions: { [summary.sessionId]: runtime(summary) },
      sessionOrder: [summary.sessionId],
      activeSessionId: summary.sessionId,
      status: { running: false },
    });
    const startAgent = vi.fn().mockResolvedValue({
      running: true,
      connectionId: "fresh-connection",
      sessionId: "remote-session",
    });
    const sendPrompt = vi.fn().mockResolvedValue({});
    const bridge: DesktopBridge = { ...mockDesktopBridge, startAgent, sendPrompt };
    const { result } = renderHook(
      () => useDesktopController(async () => "clean_head"),
      { wrapper: wrapper(bridge) },
    );

    await act(async () => {
      await result.current.send("/context", [], "agent");
    });

    expect(startAgent).toHaveBeenCalledWith(expect.objectContaining({
      cwd: "/repo",
      resumeSessionId: "remote-session",
    }));
    expect(sendPrompt).toHaveBeenCalledWith(
      "fresh-connection",
      "remote-session",
      "/context",
      expect.any(Array),
      expect.objectContaining({
        taskId: "persisted-local",
        idempotencyKey: expect.stringMatching(/^prompt:persisted-local:/),
      }),
    );
  });

  it("does not persist a live model change when the agent requires a new task", async () => {
    const summary: SessionSummary = {
      sessionId: "local",
      connectionId: "connection",
      remoteSessionId: "remote",
      workspaceRoot: "/repo",
      title: "Task",
      createdAt: "now",
      updatedAt: "now",
      runState: "idle",
      model: "grok-build",
      alwaysApprove: false,
      sandbox: "workspace",
    };
    useAppStore.setState({
      sessions: { local: runtime(summary) },
      sessionOrder: ["local"],
      activeSessionId: "local",
    });
    const bridge: DesktopBridge = {
      ...mockDesktopBridge,
      setSessionModel: vi.fn().mockResolvedValue({
        kind: "new_session_required",
        reason: "unsupported",
      }),
    };
    const { result } = renderHook(
      () => useDesktopController(async () => "clean_head"),
      { wrapper: wrapper(bridge) },
    );
    await act(async () => {
      await result.current.chooseModel("grok-4.5");
    });
    expect(useAppStore.getState().sessions.local?.summary.model).toBe("grok-build");
    expect(result.current.pendingModelFork).toEqual({ modelId: "grok-4.5", reason: "unsupported" });
  });

  it("keeps provisional mode independent and persists a confirmed live mode switch", async () => {
    const setSessionMode = vi.fn().mockResolvedValue({
      kind: "switched",
      state: {
        currentMode: "plan",
        availableModes: [{ id: "agent", name: "Agent" }, { id: "plan", name: "Plan" }],
        liveSwitchSupported: true,
        source: "acp_config",
      },
    });
    const bridge: DesktopBridge = { ...mockDesktopBridge, setSessionMode };
    const { result } = renderHook(
      () => useDesktopController(async () => "clean_head"),
      { wrapper: wrapper(bridge) },
    );
    await act(async () => {
      await result.current.chooseMode("goal");
    });
    expect(useAppStore.getState().provisionalDraft.mode).toBe("goal");

    const summary: SessionSummary = {
      sessionId: "mode-local",
      connectionId: "connection",
      remoteSessionId: "remote",
      workspaceRoot: "/repo",
      title: "Mode task",
      createdAt: "now",
      updatedAt: "now",
      runState: "idle",
      model: "grok-build",
      mode: "agent",
      alwaysApprove: false,
      sandbox: "workspace",
    };
    useAppStore.setState({ sessions: { "mode-local": runtime(summary) }, sessionOrder: ["mode-local"], activeSessionId: "mode-local" });
    await act(async () => {
      await result.current.chooseMode("plan");
    });
    expect(setSessionMode).toHaveBeenCalledWith("connection", "remote", "plan");
    expect(useAppStore.getState().sessions["mode-local"]?.summary.mode).toBe("plan");
  });

  it("rolls a command-fallback mode switch back when Grok rejects the control command", async () => {
    const summary: SessionSummary = {
      sessionId: "rollback-local",
      connectionId: "connection",
      remoteSessionId: "remote",
      workspaceRoot: "/repo",
      title: "Rollback task",
      createdAt: "now",
      updatedAt: "now",
      runState: "idle",
      model: "grok-build",
      mode: "agent",
      alwaysApprove: false,
      sandbox: "workspace",
    };
    useAppStore.setState({ sessions: { "rollback-local": runtime(summary) }, sessionOrder: ["rollback-local"], activeSessionId: "rollback-local" });
    const bridge: DesktopBridge = {
      ...mockDesktopBridge,
      setSessionMode: vi.fn().mockResolvedValue({ kind: "command_required", command: "/plan" }),
      sendPrompt: vi.fn().mockRejectedValue(new Error("control command failed")),
    };
    const { result } = renderHook(
      () => useDesktopController(async () => "clean_head"),
      { wrapper: wrapper(bridge) },
    );
    let switchResult: Awaited<ReturnType<typeof result.current.chooseMode>> | undefined;
    await act(async () => {
      switchResult = await result.current.chooseMode("plan");
    });
    expect(switchResult).toMatchObject({ kind: "unsupported" });
    expect(useAppStore.getState().sessions["rollback-local"]?.summary.mode).toBe("agent");
    expect(useAppStore.getState().sessions["rollback-local"]?.busy).toBe(false);
  });

  it("reconnects a restored task when its persisted ACP connection is stale", async () => {
    const summary: SessionSummary = {
      sessionId: "restored-local",
      connectionId: "stale-connection",
      remoteSessionId: "remote",
      workspaceRoot: "/repo",
      executionRoot: "/repo",
      title: "Restored task",
      createdAt: "now",
      updatedAt: "now",
      runState: "idle",
      model: "grok-build",
      mode: "agent",
      alwaysApprove: false,
      sandbox: "workspace",
    };
    useAppStore.setState({ sessions: { "restored-local": runtime(summary) }, sessionOrder: ["restored-local"], activeSessionId: "restored-local" });
    const setSessionMode = vi.fn()
      .mockRejectedValueOnce(new Error("connection not found"))
      .mockResolvedValueOnce({
        kind: "switched",
        state: { currentMode: "plan", availableModes: [], liveSwitchSupported: true, source: "acp_config" },
      });
    const startAgent = vi.fn().mockResolvedValue({
      running: true,
      connectionId: "fresh-connection",
      sessionId: "remote",
      cwd: "/repo",
      grokPath: "grok",
      lastError: null,
      model: null,
      mode: null,
      availableCommands: [],
    });
    const bridge: DesktopBridge = { ...mockDesktopBridge, setSessionMode, startAgent };
    const { result } = renderHook(
      () => useDesktopController(async () => "clean_head"),
      { wrapper: wrapper(bridge) },
    );
    await act(async () => {
      await result.current.chooseMode("plan");
    });
    expect(startAgent).toHaveBeenCalled();
    expect(setSessionMode).toHaveBeenLastCalledWith("fresh-connection", "remote", "plan");
    expect(useAppStore.getState().sessions["restored-local"]?.summary.mode).toBe("plan");
  });

  it("prefixes the first Plan prompt and confirms mode in the same ACP session", async () => {
    const summary: SessionSummary = {
      sessionId: "plan-local",
      connectionId: "connection",
      remoteSessionId: "remote",
      workspaceRoot: "/repo",
      title: "Plan task",
      createdAt: "now",
      updatedAt: "now",
      runState: "idle",
      model: "grok-build",
      mode: "plan",
      alwaysApprove: false,
      sandbox: "workspace",
    };
    useAppStore.setState({
      sessions: { "plan-local": runtime(summary) },
      sessionOrder: ["plan-local"],
      activeSessionId: "plan-local",
      status: { running: true, connectionId: "connection", sessionId: "remote" },
    });
    const sendPrompt = vi.fn().mockResolvedValue({});
    const confirmSessionMode = vi.fn().mockResolvedValue({
      currentMode: "plan",
      availableModes: [],
      liveSwitchSupported: false,
      source: "acp_command",
    });
    const bridge: DesktopBridge = { ...mockDesktopBridge, sendPrompt, confirmSessionMode };
    const { result } = renderHook(
      () => useDesktopController(async () => "clean_head"),
      { wrapper: wrapper(bridge) },
    );
    await act(async () => {
      await result.current.send("inspect without writing", [], "plan");
    });
    expect(sendPrompt).toHaveBeenCalledWith(
      "connection",
      "remote",
      "/plan inspect without writing",
      expect.arrayContaining([expect.objectContaining({ type: "text", text: "/plan inspect without writing" })]),
      expect.objectContaining({
        taskId: "plan-local",
        idempotencyKey: expect.stringMatching(/^prompt:plan-local:/),
      }),
    );
    expect(confirmSessionMode).toHaveBeenCalledWith("connection", "remote", "plan");
  });

  it("answers Grok plan approval in the same session and resumes Agent mode", async () => {
    const summary: SessionSummary = {
      sessionId: "approval-local",
      connectionId: "connection",
      remoteSessionId: "remote",
      workspaceRoot: "/repo",
      title: "Approval task",
      createdAt: "now",
      updatedAt: "now",
      runState: "awaiting_plan",
      model: "grok-build",
      mode: "plan",
      alwaysApprove: false,
      sandbox: "workspace",
    };
    useAppStore.setState({
      sessions: { "approval-local": runtime(summary) },
      sessionOrder: ["approval-local"],
      activeSessionId: "approval-local",
      pendingPlanApproval: {
        id: "approval-request",
        method: "_x.ai/exit_plan_mode",
        connectionId: "connection",
        sessionId: "remote",
      },
    });
    const respondServerRequest = vi.fn().mockResolvedValue(undefined);
    const bridge: DesktopBridge = { ...mockDesktopBridge, respondServerRequest };
    const { result } = renderHook(
      () => useDesktopController(async () => "clean_head"),
      { wrapper: wrapper(bridge) },
    );
    await act(async () => {
      await result.current.answerPlanApproval("approve");
    });
    expect(respondServerRequest).toHaveBeenCalledWith("connection", "approval-request", {
      outcome: "approved",
      comments: [],
    });
    expect(useAppStore.getState().sessions["approval-local"]?.summary.mode).toBe("agent");
    expect(useAppStore.getState().pendingPlanApproval).toBeNull();
  });
});
