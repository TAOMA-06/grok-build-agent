import { beforeEach, describe, expect, it } from "vitest";
import {
  handleSessionUpdate,
  resolveLocalSessionId,
  shouldHideAcpNotification,
} from "./client";
import { useAppStore } from "../store";
import type { SessionSummary } from "../types";

function session(
  sessionId: string,
  remoteSessionId: string,
  connectionId: string,
): SessionSummary {
  return {
    sessionId,
    remoteSessionId,
    connectionId,
    workspaceRoot: "/repo",
    title: sessionId,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    runState: "idle",
    alwaysApprove: false,
  };
}

describe("ACP session event routing", () => {
  beforeEach(() => {
    const foreground = session("local-foreground", "remote-1", "conn-1");
    const background = session("local-background", "remote-2", "conn-1");
    useAppStore.setState({
      sessions: {
        [foreground.sessionId]: {
          summary: foreground,
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
        },
        [background.sessionId]: {
          summary: background,
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
        },
      },
      sessionOrder: [foreground.sessionId, background.sessionId],
      activeSessionId: foreground.sessionId,
    });
  });

  it("routes an envelope to its background session, not the active session", () => {
    expect(resolveLocalSessionId("remote-2", "conn-1")).toBe(
      "local-background",
    );
  });

  it("drops an unknown envelope instead of contaminating the active session", () => {
    expect(resolveLocalSessionId("remote-unknown", "conn-unknown")).toBeNull();
  });

  it("uses the active session only for legacy non-enveloped events", () => {
    expect(resolveLocalSessionId(undefined, undefined, true)).toBe(
      "local-foreground",
    );
  });

  it("applies direct mode config and dynamic command catalog updates", () => {
    handleSessionUpdate({
      sessionUpdate: "config_option_update",
      configId: "mode",
      value: "plan",
    }, "remote-2", "conn-1");
    handleSessionUpdate({
      sessionUpdate: "available_commands_update",
      commands: [{ name: "context", description: "Inspect context" }],
    }, "remote-2", "conn-1");
    const runtime = useAppStore.getState().sessions["local-background"];
    expect(runtime?.summary.mode).toBe("plan");
    expect(runtime?.modeState.currentMode).toBe("plan");
    expect(runtime?.availableCommands).toEqual([
      { name: "context", description: "Inspect context", input: undefined },
    ]);
  });

  it("does not echo optimistic user chunks into the transcript", () => {
    handleSessionUpdate({
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "already rendered" },
    }, "remote-1", "conn-1");
    expect(useAppStore.getState().sessions["local-foreground"]?.blocks).toEqual([]);
  });

  it("keeps cache accounting when a later context update arrives", () => {
    handleSessionUpdate({
      sessionUpdate: "usage_update",
      usage: {
        input_tokens: 2_000,
        input_tokens_details: { cached_tokens: 1_500 },
      },
    } as never, "remote-2", "conn-1");
    handleSessionUpdate({
      sessionUpdate: "context_update",
      totalContextTokens: 12_000,
      contextWindowTokens: 200_000,
    }, "remote-2", "conn-1");

    expect(useAppStore.getState().sessions["local-background"]?.contextUsage)
      .toMatchObject({
        usedTokens: 12_000,
        windowTokens: 200_000,
        promptCache: {
          promptTokens: 2_000,
          cachedTokens: 1_500,
          uncachedTokens: 500,
          hitRatePercent: 75,
        },
      });
  });

  it("streams thought chunks from array-shaped ACP content", async () => {
    handleSessionUpdate({
      sessionUpdate: "agent_thought_chunk",
      content: [{ type: "text", text: "Thinking" }, { type: "text", text: " hard" }],
    } as never, "remote-1", "conn-1");
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    const thoughts = useAppStore.getState().sessions["local-foreground"]?.blocks
      .filter((block) => block.type === "thought");
    expect(thoughts).toHaveLength(1);
    expect(thoughts?.[0]).toMatchObject({ type: "thought", text: "Thinking hard" });
  });

  it("deduplicates an identical plan delivered by update and approval request", () => {
    handleSessionUpdate({
      sessionUpdate: "plan",
      content: { type: "text", text: "# Safe plan" },
    }, "remote-1", "conn-1");
    useAppStore.getState().setPlan("local-foreground", "# Safe plan");
    const plans = useAppStore.getState().sessions["local-foreground"]?.blocks
      .filter((block) => block.type === "plan");
    expect(plans).toHaveLength(1);
  });

  it("hides known xAI lifecycle notifications but preserves unknown diagnostics", () => {
    expect(shouldHideAcpNotification("_x.ai/session_notification")).toBe(true);
    expect(shouldHideAcpNotification("_x.ai/queue/changed")).toBe(true);
    expect(shouldHideAcpNotification("vendor/custom-warning")).toBe(false);
  });
});
