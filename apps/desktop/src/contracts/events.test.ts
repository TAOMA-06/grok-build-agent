import { describe, expect, it } from "vitest";
import {
  createEventEnvelope,
  extractStructuredAcpNotification,
  isSessionEventEnvelope,
  type SessionEventEnvelope,
} from "./events";
import {
  connectionKeyString,
  emptyRuntimeSnapshot,
  type ConnectionKey,
} from "./runtime";
import type { SessionSummary } from "./session";
import type { ReviewSnapshot } from "./review";

describe("SessionEventEnvelope", () => {
  it("creates envelopes with connection, session, sequence, timestamp", () => {
    const env = createEventEnvelope({
      connectionId: "conn-a",
      sessionId: "sess-1",
      sequence: 3,
      source: "acp",
      kind: "session_update",
      payload: { sessionUpdate: "agent_message_chunk" },
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    expect(env.connectionId).toBe("conn-a");
    expect(env.sessionId).toBe("sess-1");
    expect(env.sequence).toBe(3);
    expect(env.timestamp).toBe("2026-01-01T00:00:00.000Z");
    expect(isSessionEventEnvelope(env)).toBe(true);
  });

  it("rejects malformed envelopes", () => {
    expect(isSessionEventEnvelope({})).toBe(false);
    expect(isSessionEventEnvelope({ connectionId: "x" })).toBe(false);
  });

  it("keeps parallel session streams separable by envelope fields", () => {
    const a: SessionEventEnvelope = createEventEnvelope({
      connectionId: "c1",
      sessionId: "s1",
      sequence: 1,
      source: "acp",
      kind: "chunk",
      payload: { text: "from s1" },
    });
    const b: SessionEventEnvelope = createEventEnvelope({
      connectionId: "c1",
      sessionId: "s2",
      sequence: 1,
      source: "acp",
      kind: "chunk",
      payload: { text: "from s2" },
    });
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(a.payload).not.toEqual(b.payload);
  });
});

describe("structured ACP notifications", () => {
  it("normalizes Grok Build kind/title/body notifications", () => {
    expect(extractStructuredAcpNotification({
      params: { kind: "warning", title: "Authentication changed", body: "Restart this session." },
    })).toEqual({
      text: "Authentication changed\n\nRestart this session.",
      level: "warn",
    });
  });

  it("keeps unstructured lifecycle frames out of the transcript", () => {
    expect(extractStructuredAcpNotification({ params: { status: "ready" } })).toBeNull();
  });
});

describe("RuntimeSnapshot / SessionSummary / ReviewSnapshot shapes", () => {
  it("builds empty runtime snapshot", () => {
    const snap = emptyRuntimeSnapshot("2026-01-01T00:00:00.000Z");
    expect(snap.connections).toEqual([]);
    expect(snap.updatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("stringifies connection keys by workspace + sandbox + profile", () => {
    const key: ConnectionKey = {
      workspaceRoot: "/Users/me/proj",
      sandbox: "workspace",
      alwaysApprove: false,
      powerProfile: null,
    };
    expect(connectionKeyString(key)).toBe(
      "/Users/me/proj::workspace::off::ask::default::default",
    );
  });

  it("accepts SessionSummary index rows", () => {
    const row: SessionSummary = {
      sessionId: "local-1",
      workspaceRoot: "/repo",
      title: "Fix login",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:01:00.000Z",
      runState: "idle",
      alwaysApprove: false,
    };
    expect(row.runState).toBe("idle");
  });

  it("accepts ReviewSnapshot for clean / not-a-repo", () => {
    const clean: ReviewSnapshot = {
      workspaceRoot: "/repo",
      repoRoot: "/repo",
      head: "abc",
      branch: "main",
      state: "clean",
      files: [],
      untracked: [],
      refreshedAt: "2026-01-01T00:00:00.000Z",
    };
    const missing: ReviewSnapshot = {
      workspaceRoot: "/tmp",
      state: "not_a_repo",
      files: [],
      untracked: [],
      refreshedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(clean.state).toBe("clean");
    expect(missing.state).toBe("not_a_repo");
  });
});
