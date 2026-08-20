import { describe, expect, it } from "vitest";
import {
  buildHookOrchestrationEntries,
  buildSkillOrchestrationEntries,
  composeOrchestrationDraft,
  groupCapabilitiesBySource,
  skillInvocationDraft,
} from "./capabilityOrchestration";

describe("capability orchestration", () => {
  it("builds slash drafts for skills", () => {
    expect(skillInvocationDraft({
      id: "verify",
      name: "Verify",
      source: "harness",
      enabled: true,
    })).toBe("/verify");
  });

  it("groups by source and skips disabled skills", () => {
    const groups = groupCapabilitiesBySource([
      { id: "a", name: "A", source: "user", enabled: true },
      { id: "b", name: "B", source: "project", enabled: true },
      { id: "c", name: "C", source: "user", enabled: false },
    ]);
    expect(groups.map((g) => g.source)).toEqual(["project", "user"]);
    const entries = buildSkillOrchestrationEntries([
      { id: "a", name: "A", source: "user", enabled: true },
      { id: "c", name: "C", source: "user", enabled: false },
    ]);
    expect(entries).toHaveLength(1);
  });

  it("composes multi-skill orchestration drafts", () => {
    const skills = buildSkillOrchestrationEntries([
      { id: "explore", name: "Explore", enabled: true },
      { id: "verify", name: "Verify", enabled: true },
    ]);
    const hooks = buildHookOrchestrationEntries([
      { id: "pre", name: "PreTool", description: "before tool use", enabled: true },
    ]);
    const draft = composeOrchestrationDraft([...hooks, ...skills]);
    expect(draft).toContain("## Hooks to honor");
    expect(draft).toContain("/explore");
    expect(draft).toContain("/verify");
  });
});
