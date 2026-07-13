import { describe, expect, it } from "vitest";
import type { CachedSessionEvent } from "../../api/catalog";
import { normalizeCachedEvents } from "./history";

function event(sequence: number, kind: string, payload: unknown): CachedSessionEvent {
  return {
    sessionId: "local-1",
    sequence,
    timestamp: `2026-07-10T00:00:0${sequence}.000Z`,
    kind,
    payload,
  };
}

describe("normalizeCachedEvents", () => {
  it("restores user messages and merges streamed assistant chunks", () => {
    const blocks = normalizeCachedEvents([
      event(1, "user", { text: "Build the shell" }),
      event(2, "session_update", { sessionUpdate: "agent_message_chunk", content: { text: "Working " } }),
      event(3, "session_update", { sessionUpdate: "agent_message_chunk", content: { text: "on it." } }),
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: "user", text: "Build the shell" });
    expect(blocks[1]).toMatchObject({ type: "assistant", text: "Working on it." });
  });

  it("merges tool updates by tool call id", () => {
    const blocks = normalizeCachedEvents([
      event(1, "session_update", { sessionUpdate: "tool_call", toolCallId: "t1", title: "Run tests", status: "running" }),
      event(2, "session_update", { sessionUpdate: "tool_call_update", toolCallId: "t1", title: "Run tests", status: "completed", output: "ok" }),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "tool",
      tool: { id: "t1", status: "completed", output: "ok" },
    });
  });

  it("deduplicates legacy Host and Renderer copies by ACP event id", () => {
    const payload = {
      _meta: { eventId: "runtime-event-1" },
      update: { sessionUpdate: "agent_message_chunk", content: { text: "计划" } },
    };
    const blocks = normalizeCachedEvents([
      event(1, "session_update", payload),
      event(1, "session_update", payload),
    ]);
    expect(blocks).toEqual([
      expect.objectContaining({ type: "assistant", text: "计划" }),
    ]);
  });

  it("restores structured Grok system notifications", () => {
    const blocks = normalizeCachedEvents([
      event(1, "notification", {
        method: "_x.ai/session_notification",
        params: { kind: "error", title: "Session stopped", body: "Authentication expired." },
      }),
    ]);
    expect(blocks).toEqual([
      expect.objectContaining({
        type: "system",
        text: "Session stopped\n\nAuthentication expired.",
        level: "error",
      }),
    ]);
  });
});
