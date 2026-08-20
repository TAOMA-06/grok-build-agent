import { describe, expect, it } from "vitest";
import {
  appendMemoryToProfile,
  asMemoryKind,
  extractMemoryProposalsFromBlocks,
  extractMemoryProposalsFromText,
  filterNewMemoryProposals,
  formatAcceptedMemories,
  formatProjectProfile,
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

  it("extracts remember and convention lines from transcript text", () => {
    const proposals = extractMemoryProposalsFromText(
      [
        "Remember: Prefer pnpm over npm in this repo",
        "Convention: Keep CompletionGate required",
        "random chatter without a cue",
      ].join("\n"),
      "msg-1",
    );
    expect(proposals.map((item) => item.kind).sort()).toEqual([
      "convention",
      "preference",
    ]);
    expect(proposals.some((item) => item.content.includes("pnpm"))).toBe(true);
  });

  it("scans blocks and filters duplicates against existing memories", () => {
    const proposals = extractMemoryProposalsFromBlocks([
      { type: "user", id: "u1", text: "/remember Always run cargo test before push" },
      { type: "assistant", id: "a1", text: "Prefer: Use worktrees for risky edits" },
      { type: "tool", id: "t1", text: "Remember: ignore tools" },
    ]);
    expect(proposals.length).toBeGreaterThanOrEqual(2);
    const fresh = filterNewMemoryProposals(proposals, [
      {
        memoryId: "x",
        kind: "preference",
        content: "Always run cargo test before push",
        sourceEventId: "u1",
        confidence: 0.9,
        state: "accepted",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ]);
    expect(fresh.every((item) => !/cargo test/i.test(item.content))).toBe(true);
    expect(fresh.some((item) => /worktrees/i.test(item.content))).toBe(true);
  });

  it("appends accepted memories into the project profile once", () => {
    const first = appendMemoryToProfile("", {
      kind: "convention",
      content: "Prefer pnpm over npm",
    });
    expect(first).toContain("## Accepted memories");
    expect(first).toContain("[convention] Prefer pnpm over npm");
    const second = appendMemoryToProfile(first, {
      kind: "convention",
      content: "Prefer pnpm over npm",
    });
    expect(second).toBe(first);
  });
});
