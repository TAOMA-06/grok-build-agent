import { describe, expect, it } from "vitest";
import { EVENT_SCHEMA_VERSION, isPlatformEvent } from "./platform";

describe("platform contracts", () => {
  it("requires complete behavior attribution", () => {
    expect(isPlatformEvent({
      eventId: "event-1",
      workspaceId: "workspace-1",
      taskId: "task-1",
      sessionId: "session-1",
      turnId: "turn-1",
      runtimeId: "runtime-1",
      sequence: 1,
      timestamp: "2026-01-01T00:00:00Z",
      kind: "turn.started",
      schemaVersion: EVENT_SCHEMA_VERSION,
      payload: {},
      correlationId: "task-1",
    })).toBe(true);
  });

  it("rejects an unattributed event", () => {
    expect(isPlatformEvent({
      eventId: "event-1",
      workspaceId: "",
      taskId: "task-1",
      sessionId: "session-1",
      runtimeId: "runtime-1",
      sequence: 1,
      timestamp: "2026-01-01T00:00:00Z",
      kind: "turn.started",
      schemaVersion: EVENT_SCHEMA_VERSION,
      payload: {},
      correlationId: "task-1",
    })).toBe(false);
  });
});
