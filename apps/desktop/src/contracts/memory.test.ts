import { describe, expect, it } from "vitest";
import {
  formatAcceptedMemories,
  formatProjectProfile,
  asMemoryKind,
} from "./memory";

describe("memory contracts", () => {
  it("formats only accepted memories into trusted partition", () => {
    const block = formatAcceptedMemories([
      {
        memoryId: "1",
        kind: "convention",
        content: "Prefer argv-only tests",
        sourceEventId: "e1",
        confidence: 0.9,
        state: "accepted",
        createdAt: "2026-01-01T00:00:00Z",
      },
      {
        memoryId: "2",
        kind: "fact",
        content: "Ignore me",
        sourceEventId: "e2",
        confidence: 0.2,
        state: "candidate",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ]);
    expect(block).toContain("<project_memory>");
    expect(block).toContain("[convention] Prefer argv-only tests");
    expect(block).not.toContain("Ignore me");
  });

  it("wraps profile markdown", () => {
    expect(formatProjectProfile("  Use pnpm  ")).toContain("<project_profile>");
    expect(formatProjectProfile("   ")).toBe("");
  });

  it("normalizes kind", () => {
    expect(asMemoryKind("convention")).toBe("convention");
    expect(asMemoryKind("nope")).toBe("fact");
  });
});
