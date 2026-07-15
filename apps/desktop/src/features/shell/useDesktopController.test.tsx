import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyComposerDraft } from "../../contracts";
import { DesktopBridgeContext, type DesktopBridge } from "../../platform/DesktopBridge";
import { mockDesktopBridge } from "../../platform/mockBridge";
import { defaultSettings, useAppStore, type SessionRuntime } from "../../store";
import type { SessionSummary } from "../../types";
import { useDesktopController } from "./useDesktopController";
import { STOP_ARM_MS } from "./composerTiming";

function wrapper(bridge: DesktopBridge) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <DesktopBridgeContext.Provider value={bridge}>{children}</DesktopBridgeContext.Provider>;
  };
}

function runtime(summary: SessionSummary): SessionRuntime {
  return {
    summary,
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
    modeState: { currentMode: summary.mode ?? "agent", availableModes: [], liveSwitchSupported: false, source: "desktop" },
    availableCommands: [],
    attachments: [],
    failedSubmission: null,
    contextUsage: null,
  };
}

describe("useDesktopController", () => {
  beforeEach(() => {
    useAppStore.setState({
      settings: {
        ...defaultSettings(),
        cwd: "/Users/demo/Projects/orbit",
        onboardingDone: true,
        // Most controller tests cover the durable-history path. Private Chat
        // receives its own explicit persistence test below.
        privateChat: false,
      },
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

  it("defaults a Private Chat task to ephemeral desktop state without writing history", async () => {
    useAppStore.getState().setSettings({ privateChat: true });
    const upsertSession = vi.fn().mockResolvedValue(undefined);
    const saveDraft = vi.fn().mockResolvedValue(undefined);
    const appendCachedEvent = vi.fn().mockResolvedValue(undefined);
    const getTask = vi.fn().mockResolvedValue(null);
    const upsertTask = vi.fn().mockResolvedValue(undefined);
    const sendPrompt = vi.fn().mockResolvedValue(null);
    const startAgent = vi.fn(mockDesktopBridge.startAgent);
    const createWorktree = vi.fn(mockDesktopBridge.createWorktree);
    const gitReview = vi.fn(mockDesktopBridge.gitReview);
    const prepareAttachments = vi.fn(mockDesktopBridge.prepareAttachments);
    const setCodingDataPrivacy = vi.fn(mockDesktopBridge.setCodingDataPrivacy);
    const bridge: DesktopBridge = {
      ...mockDesktopBridge,
      startAgent,
      createWorktree,
      gitReview,
      prepareAttachments,
      setCodingDataPrivacy,
      upsertSession,
      saveDraft,
      appendCachedEvent,
      getTask,
      upsertTask,
      sendPrompt,
    };
    const { result } = renderHook(
      () => useDesktopController(async () => "clean_head"),
      { wrapper: wrapper(bridge) },
    );

    await act(async () => {
      await result.current.send("keep this out of local history", [], "agent");
    });

    const sessionId = useAppStore.getState().activeSessionId;
    expect(sessionId).toBeTruthy();
    expect(useAppStore.getState().sessions[sessionId!]?.privateChat).toBe(true);
    expect(startAgent).toHaveBeenCalledWith(expect.objectContaining({ privateChat: true }));
    expect(gitReview).toHaveBeenCalledWith("/Users/demo/Projects/orbit", true);
    expect(createWorktree).toHaveBeenCalledWith(expect.objectContaining({
      privateChat: true,
      branch: `private-${sessionId!.slice(0, 8)}`,
    }));
    expect(prepareAttachments).toHaveBeenCalledWith([], true);
    expect(sendPrompt).toHaveBeenCalled();
    expect(sendPrompt).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "keep this out of local history",
      expect.any(Array),
      expect.objectContaining({ privateChat: true }),
    );
    expect(upsertSession).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(appendCachedEvent).not.toHaveBeenCalled();
    expect(getTask).not.toHaveBeenCalled();
    expect(upsertTask).not.toHaveBeenCalled();
    expect(setCodingDataPrivacy).not.toHaveBeenCalled();
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
    const sendPrompt = vi.fn().mockResolvedValue({
      usage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 82 },
      },
    });
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
    expect(useAppStore.getState().sessions[summary.sessionId]?.contextUsage?.promptCache)
      .toMatchObject({ promptTokens: 100, cachedTokens: 82, hitRatePercent: 82 });
  });

  it("keeps a started task model-pinned and offers a cache-safe fork", async () => {
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
    const setSessionModel = vi.fn();
    const restartAgent = vi.fn();
    const bridge: DesktopBridge = {
      ...mockDesktopBridge,
      setSessionModel,
      restartAgent,
      upsertSession: vi.fn().mockResolvedValue(undefined),
    };
    const { result } = renderHook(
      () => useDesktopController(async () => "clean_head"),
      { wrapper: wrapper(bridge) },
    );
    await act(async () => {
      await result.current.chooseModel("grok-4.5");
    });
    expect(useAppStore.getState().sessions.local?.summary.model).toBe("grok-build");
    expect(setSessionModel).not.toHaveBeenCalled();
    expect(restartAgent).not.toHaveBeenCalled();
    expect(result.current.pendingModelFork).toMatchObject({ modelId: "grok-4.5" });
  });

  it("changes the model in place before a task has a remote session", async () => {
    const summary: SessionSummary = {
      sessionId: "local",
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
    const setSessionModel = vi.fn();
    const bridge: DesktopBridge = {
      ...mockDesktopBridge,
      setSessionModel,
      upsertSession: vi.fn().mockResolvedValue(undefined),
    };
    const { result } = renderHook(
      () => useDesktopController(async () => "clean_head"),
      { wrapper: wrapper(bridge) },
    );
    await act(async () => {
      await result.current.chooseModel("grok-4.5");
    });
    expect(useAppStore.getState().sessions.local?.summary.model).toBe("grok-4.5");
    expect(setSessionModel).not.toHaveBeenCalled();
    expect(result.current.pendingModelFork).toBeNull();
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
    useAppStore.setState({
      sessions: { "mode-local": runtime(summary) },
      sessionOrder: ["mode-local"],
      activeSessionId: "mode-local",
      status: { running: true, connectionId: "connection", sessionId: "remote" },
    });
    await act(async () => {
      await result.current.chooseMode("plan");
    });
    expect(setSessionMode).toHaveBeenCalledWith("connection", "remote", "plan");
    expect(useAppStore.getState().sessions["mode-local"]?.summary.mode).toBe("plan");
  });

  it("defers command-fallback mode switches without auto-sending a control prompt", async () => {
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
    useAppStore.setState({
      sessions: { "rollback-local": runtime(summary) },
      sessionOrder: ["rollback-local"],
      activeSessionId: "rollback-local",
      status: { running: true, connectionId: "connection", sessionId: "remote" },
    });
    const sendPrompt = vi.fn().mockResolvedValue({});
    const bridge: DesktopBridge = {
      ...mockDesktopBridge,
      setSessionMode: vi.fn().mockResolvedValue({ kind: "command_required", command: "/plan" }),
      sendPrompt,
    };
    const { result } = renderHook(
      () => useDesktopController(async () => "clean_head"),
      { wrapper: wrapper(bridge) },
    );
    let switchResult: Awaited<ReturnType<typeof result.current.chooseMode>> | undefined;
    await act(async () => {
      switchResult = await result.current.chooseMode("plan");
    });
    expect(switchResult).toMatchObject({ kind: "switched", state: { currentMode: "plan" } });
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(useAppStore.getState().sessions["rollback-local"]?.summary.mode).toBe("plan");
    expect(useAppStore.getState().sessions["rollback-local"]?.busy).toBe(false);
  });

  it("clears busy state when cancel IPC fails and ignores late send completion", async () => {
    const summary: SessionSummary = {
      sessionId: "cancel-local",
      connectionId: "connection",
      remoteSessionId: "remote",
      workspaceRoot: "/repo",
      title: "Cancel task",
      createdAt: "now",
      updatedAt: "now",
      runState: "idle",
      model: "grok-build",
      mode: "agent",
      alwaysApprove: false,
      sandbox: "workspace",
    };
    let resolvePrompt: (value: unknown) => void = () => undefined;
    const sendPrompt = vi.fn().mockImplementation(
      () => new Promise((resolve) => {
        resolvePrompt = resolve;
      }),
    );
    const cancelPrompt = vi.fn().mockRejectedValue(
      new Error("invalid type: map, expected unit"),
    );
    useAppStore.setState({
      sessions: { "cancel-local": runtime(summary) },
      sessionOrder: ["cancel-local"],
      activeSessionId: "cancel-local",
      status: { running: true, connectionId: "connection", sessionId: "remote" },
    });
    const bridge: DesktopBridge = {
      ...mockDesktopBridge,
      sendPrompt,
      cancelPrompt,
      upsertSession: vi.fn().mockResolvedValue(undefined),
      saveDraft: vi.fn().mockResolvedValue(undefined),
      prepareAttachments: vi.fn().mockResolvedValue([]),
      appendCachedEvent: vi.fn().mockResolvedValue(undefined),
    };
    const { result } = renderHook(
      () => useDesktopController(async () => "clean_head"),
      { wrapper: wrapper(bridge) },
    );

    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = result.current.send("做个简单的测试计划，我看一下grok", [], "agent");
    });
    expect(sendPrompt).toHaveBeenCalled();
    expect(useAppStore.getState().sessions["cancel-local"]?.busy).toBe(true);
    expect(
      useAppStore.getState().sessions["cancel-local"]?.blocks.find((block) => block.type === "user"),
    ).toMatchObject({ delivery: "sent" });

    await act(async () => {
      await result.current.cancel();
    });
    expect(cancelPrompt).toHaveBeenCalledWith("connection", "remote");
    expect(useAppStore.getState().sessions["cancel-local"]?.busy).toBe(false);
    expect(useAppStore.getState().sessions["cancel-local"]?.summary.runState).toBe("cancelled");
    expect(
      useAppStore.getState().sessions["cancel-local"]?.blocks.find((block) => block.type === "user"),
    ).toMatchObject({ delivery: "sent" });

    await act(async () => {
      resolvePrompt({});
      await sendPromise;
    });
    expect(useAppStore.getState().sessions["cancel-local"]?.busy).toBe(false);
    expect(useAppStore.getState().sessions["cancel-local"]?.summary.runState).toBe("cancelled");
  });

  it("keeps a queued follow-up visible and the task busy until the active turn settles", async () => {
    const summary: SessionSummary = {
      sessionId: "queued-local",
      connectionId: "connection",
      remoteSessionId: "remote",
      workspaceRoot: "/repo",
      title: "Queued task",
      createdAt: "now",
      updatedAt: "now",
      runState: "idle",
      model: "grok-build",
      mode: "agent",
      alwaysApprove: false,
      sandbox: "workspace",
    };
    const resolvers: Array<(value: unknown) => void> = [];
    const sendPrompt = vi.fn().mockImplementation(
      () => new Promise<unknown>((resolve) => resolvers.push(resolve)),
    );
    useAppStore.setState({
      sessions: { "queued-local": runtime(summary) },
      sessionOrder: ["queued-local"],
      activeSessionId: "queued-local",
      status: { running: true, connectionId: "connection", sessionId: "remote" },
    });
    const bridge: DesktopBridge = {
      ...mockDesktopBridge,
      sendPrompt,
      upsertSession: vi.fn().mockResolvedValue(undefined),
      saveDraft: vi.fn().mockResolvedValue(undefined),
      prepareAttachments: vi.fn().mockResolvedValue([]),
      appendCachedEvent: vi.fn().mockResolvedValue(undefined),
    };
    const { result } = renderHook(
      () => useDesktopController(async () => "clean_head"),
      { wrapper: wrapper(bridge) },
    );

    let first!: Promise<void>;
    await act(async () => {
      first = result.current.send("Inspect the active task.", [], "agent");
    });
    await waitFor(() => expect(sendPrompt).toHaveBeenCalledTimes(1));

    let followUp!: Promise<void>;
    await act(async () => {
      followUp = result.current.send("Then run the focused verification.", [], "agent");
    });
    await waitFor(() => expect(sendPrompt).toHaveBeenCalledTimes(2));

    const queuedBlock = useAppStore.getState().sessions["queued-local"]?.blocks
      .find((block) => block.type === "user" && block.text.startsWith("Then run"));
    expect(queuedBlock).toMatchObject({ delivery: "queued" });
    expect(useAppStore.getState().sessions["queued-local"]?.busy).toBe(true);

    await act(async () => {
      resolvers[1]?.({});
      await followUp;
    });
    expect(queuedBlock && useAppStore.getState().sessions["queued-local"]?.blocks
      .find((block) => block.id === queuedBlock.id)).toMatchObject({ delivery: "sent" });
    expect(useAppStore.getState().sessions["queued-local"]?.busy).toBe(true);

    await act(async () => {
      resolvers[0]?.({});
      await first;
    });
    expect(useAppStore.getState().sessions["queued-local"]?.busy).toBe(false);
    expect(useAppStore.getState().sessions["queued-local"]?.summary.runState).toBe("idle");
  });

  it("ignores a premature cancel while reconnecting so the in-flight send can finish", async () => {
    const summary: SessionSummary = {
      sessionId: "race-local",
      connectionId: "stale-connection",
      remoteSessionId: "remote",
      workspaceRoot: "/repo",
      title: "Race task",
      createdAt: "now",
      updatedAt: "now",
      runState: "idle",
      model: "grok-build",
      mode: "plan",
      alwaysApprove: false,
      sandbox: "workspace",
    };
    let resolveStart: (value: unknown) => void = () => undefined;
    const startAgent = vi.fn().mockImplementation(
      () => new Promise((resolve) => {
        resolveStart = resolve;
      }),
    );
    const sendPrompt = vi.fn().mockResolvedValue({});
    const cancelPrompt = vi.fn().mockRejectedValue(new Error("agent is not running"));
    useAppStore.setState({
      sessions: { "race-local": runtime(summary) },
      sessionOrder: ["race-local"],
      activeSessionId: "race-local",
      status: { running: false },
    });
    const bridge: DesktopBridge = {
      ...mockDesktopBridge,
      startAgent,
      sendPrompt,
      cancelPrompt,
      upsertSession: vi.fn().mockResolvedValue(undefined),
      saveDraft: vi.fn().mockResolvedValue(undefined),
      prepareAttachments: vi.fn().mockResolvedValue([]),
      appendCachedEvent: vi.fn().mockResolvedValue(undefined),
      confirmSessionMode: vi.fn().mockResolvedValue({
        currentMode: "plan",
        availableModes: [],
        liveSwitchSupported: false,
        source: "acp_command",
      }),
    };
    const { result } = renderHook(
      () => useDesktopController(async () => "clean_head"),
      { wrapper: wrapper(bridge) },
    );

    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = result.current.send("inspect without writing", [], "plan");
    });
    expect(useAppStore.getState().sessions["race-local"]?.busy).toBe(true);

    await act(async () => {
      await result.current.cancel();
    });
    expect(cancelPrompt).not.toHaveBeenCalled();
    expect(useAppStore.getState().sessions["race-local"]?.busy).toBe(true);
    expect(
      useAppStore.getState().sessions["race-local"]?.blocks.some(
        (block) => block.type === "system" && String(block.text).includes("Stop signal"),
      ),
    ).toBe(false);

    await act(async () => {
      resolveStart({
        running: true,
        connectionId: "fresh-connection",
        sessionId: "remote",
      });
      await sendPromise;
    });
    expect(sendPrompt).toHaveBeenCalledWith(
      "fresh-connection",
      "remote",
      "/plan inspect without writing",
      expect.any(Array),
      expect.objectContaining({ taskId: "race-local" }),
    );
    expect(useAppStore.getState().sessions["race-local"]?.busy).toBe(false);
    expect(
      useAppStore.getState().sessions["race-local"]?.blocks.find((block) => block.type === "user"),
    ).toMatchObject({ delivery: "sent" });
  });

  it("cancels after the stop arm window without warning when the agent is not running", async () => {
    const summary: SessionSummary = {
      sessionId: "stale-cancel",
      connectionId: "stale-connection",
      remoteSessionId: "remote",
      workspaceRoot: "/repo",
      title: "Stale cancel",
      createdAt: "now",
      updatedAt: "now",
      runState: "idle",
      model: "grok-build",
      mode: "agent",
      alwaysApprove: false,
      sandbox: "workspace",
    };
    let resolveStart: (value: unknown) => void = () => undefined;
    const startAgent = vi.fn().mockImplementation(
      () => new Promise((resolve) => {
        resolveStart = resolve;
      }),
    );
    const cancelPrompt = vi.fn().mockRejectedValue(new Error("agent is not running"));
    useAppStore.setState({
      sessions: { "stale-cancel": runtime(summary) },
      sessionOrder: ["stale-cancel"],
      activeSessionId: "stale-cancel",
      status: { running: false },
    });
    const bridge: DesktopBridge = {
      ...mockDesktopBridge,
      startAgent,
      cancelPrompt,
      sendPrompt: vi.fn().mockResolvedValue({}),
      upsertSession: vi.fn().mockResolvedValue(undefined),
      saveDraft: vi.fn().mockResolvedValue(undefined),
      prepareAttachments: vi.fn().mockResolvedValue([]),
    };
    const { result } = renderHook(
      () => useDesktopController(async () => "clean_head"),
      { wrapper: wrapper(bridge) },
    );

    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = result.current.send("hello", [], "agent");
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, STOP_ARM_MS + 20));
    });
    await act(async () => {
      await result.current.cancel();
    });
    expect(cancelPrompt).not.toHaveBeenCalled();
    expect(useAppStore.getState().sessions["stale-cancel"]?.busy).toBe(false);
    expect(
      useAppStore.getState().sessions["stale-cancel"]?.blocks.some(
        (block) => block.type === "system" && String(block.text).includes("agent is not running"),
      ),
    ).toBe(false);

    await act(async () => {
      resolveStart({
        running: true,
        connectionId: "fresh-connection",
        sessionId: "remote",
      });
      await sendPromise;
    });
    expect(useAppStore.getState().sessions["stale-cancel"]?.summary.runState).toBe("cancelled");
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
    useAppStore.setState({
      sessions: { "restored-local": runtime(summary) },
      sessionOrder: ["restored-local"],
      activeSessionId: "restored-local",
      status: { running: true, connectionId: "stale-connection", sessionId: "remote" },
    });
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
    const upsertTask = vi.fn().mockResolvedValue(undefined);
    const bridge: DesktopBridge = {
      ...mockDesktopBridge,
      sendPrompt,
      confirmSessionMode,
      getTask: vi.fn().mockResolvedValue(null),
      upsertTask,
    };
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
        focusMode: "balanced",
        privacyMode: "strict",
      }),
    );
    expect(upsertTask).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "plan-local",
      goal: "inspect without writing",
    }));
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
