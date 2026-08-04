import { describe, expect, it } from "vitest";
import {
  countActiveSubagents,
  extractStructuredSubagent,
  isSubagentTool,
  listSubagents,
  parseSubagentMeta,
  summarizeSubagentFleet,
} from "./subagent";

describe("subagent detection", () => {
  it("recognizes spawn_subagent style tools", () => {
    expect(isSubagentTool({
      title: "spawn_subagent",
      kind: "other",
      rawInput: { description: "[implementer] wire auth", subagent_type: "general-purpose" },
    })).toBe(true);
  });

  it("prefers structured ACP subagent meta", () => {
    const structured = extractStructuredSubagent({
      _meta: {
        subagent: {
          role: "explore",
          model: "grok-4.5",
          title: "map router",
          detail: "thoroughness: medium",
        },
      },
    });
    expect(structured?.role).toBe("explore");
    expect(structured?.model).toBe("grok-4.5");
    const meta = parseSubagentMeta({
      title: "tool",
      rawInput: {
        _meta: {
          subagent: { role: "reviewer", title: "diff pass", model: "grok-fast" },
        },
      },
    });
    expect(meta.structured).toBe(true);
    expect(meta.role).toBe("reviewer");
    expect(meta.model).toBe("grok-fast");
  });

  it("parses role tags and model", () => {
    const meta = parseSubagentMeta({
      title: "spawn_subagent",
      rawInput: {
        description: "[explore] map the router tree",
        model: "grok-4.5",
      },
    });
    expect(meta.role).toBe("explore");
    expect(meta.model).toBe("grok-4.5");
    expect(meta.title.toLowerCase()).toContain("explore");
    expect(meta.structured).toBe(false);
  });

  it("counts only active subagents", () => {
    const count = countActiveSubagents([
      { title: "spawn_subagent", status: "running", input: { description: "[plan] a" } },
      { title: "spawn_subagent", status: "completed", input: { description: "[plan] b" } },
      { title: "read_file", status: "running" },
    ]);
    expect(count).toBe(1);
  });

  it("summarizes fleet by role for Mission Control", () => {
    const fleet = summarizeSubagentFleet([
      {
        id: "1",
        title: "spawn_subagent",
        status: "running",
        input: { description: "[explore] a" },
      },
      {
        id: "2",
        title: "spawn_subagent",
        status: "running",
        input: { description: "[explore] b" },
      },
      {
        id: "3",
        title: "spawn_subagent",
        status: "completed",
        input: { description: "[implementer] c" },
      },
    ]);
    expect(fleet.active).toBe(2);
    expect(fleet.total).toBe(3);
    expect(fleet.byRole.find((row) => row.role === "explore")).toEqual({
      role: "explore",
      active: 2,
      total: 2,
    });
    expect(listSubagents([
      {
        id: "1",
        title: "spawn_subagent",
        status: "running",
        input: { description: "[explore] a" },
      },
    ])).toHaveLength(1);
  });
});
