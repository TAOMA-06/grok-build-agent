import { describe, expect, it } from "vitest";
import {
  buildPlanComments,
  parsePlanDocument,
  parsePlanSteps,
  planDocumentToMarkdown,
  summarizePlanProgress,
} from "./planSteps";

describe("plan steps", () => {
  it("extracts markdown list steps", () => {
    const steps = parsePlanSteps(`# Plan
- Inspect auth module
- Add tests
1. Ship release
`);
    expect(steps.map((s) => s.text)).toEqual([
      "Inspect auth module",
      "Add tests",
      "Ship release",
    ]);
    expect(steps.every((s) => s.status === "pending")).toBe(true);
  });

  it("parses ACP structured entries with status", () => {
    const doc = parsePlanDocument({
      title: "Auth fix",
      entries: [
        { content: "Locate bug", status: "completed" },
        { content: "Write regression", status: "in_progress" },
        { content: "Ship", status: "pending" },
      ],
    });
    expect(doc.source).toBe("structured");
    expect(doc.title).toBe("Auth fix");
    expect(doc.steps.map((s) => [s.text, s.status])).toEqual([
      ["Locate bug", "completed"],
      ["Write regression", "in_progress"],
      ["Ship", "pending"],
    ]);
    expect(summarizePlanProgress(doc)).toEqual({
      total: 3,
      completed: 1,
      inProgress: 1,
      pending: 1,
    });
  });

  it("parses JSON fence inside markdown", () => {
    const doc = parsePlanDocument([
      "Here is the plan:",
      "```json",
      '{"steps":[{"text":"A","status":"done"},{"text":"B","status":"todo"}]}',
      "```",
    ].join("\n"));
    expect(doc.source).toBe("structured");
    expect(doc.steps.map((s) => s.status)).toEqual(["completed", "pending"]);
  });

  it("reads checkbox markdown as completed", () => {
    const doc = parsePlanDocument("- [x] Done already\n- [ ] Still open");
    expect(doc.steps.map((s) => [s.text, s.status])).toEqual([
      ["Done already", "completed"],
      ["Still open", "pending"],
    ]);
  });

  it("round-trips structured plan to markdown", () => {
    const markdown = planDocumentToMarkdown({
      title: "Ship",
      summary: "Keep it small",
      source: "structured",
      steps: [
        { id: "step-1", index: 1, text: "Patch", status: "completed" },
        { id: "step-2", index: 2, text: "Verify", status: "pending" },
      ],
    });
    expect(markdown).toContain("# Ship");
    expect(markdown).toContain("[x] Patch");
    expect(markdown).toContain("[ ] Verify");
  });

  it("builds comments from step notes and free text", () => {
    const steps = parsePlanSteps("- One\n- Two");
    expect(buildPlanComments({
      steps,
      stepComments: { "step-1": "Need more detail" },
      freeNote: "Overall slower please",
    })).toEqual([
      "Step 1: Need more detail",
      "Overall slower please",
    ]);
  });
});
