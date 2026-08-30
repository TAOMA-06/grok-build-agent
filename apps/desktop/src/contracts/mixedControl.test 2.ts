import { describe, expect, it } from "vitest";
import { defaultSettings } from "./settings";
import {
  GROK_ADAPTER_ID,
  PLANNER_ADAPTER_ID,
  adapterIdForStart,
  buildGrokImplementPrompt,
  isPlannerSession,
  latestPlanText,
  mixedPlanningReady,
  resolveExecutorExecutable,
  resolvePlannerExecutable,
  shouldHandoffPlannerToGrok,
  shouldStartWithPlanner,
  usesGrokControlCommands,
} from "./mixedControl";

const ready = {
  ...defaultSettings(),
  mixedPlanning: true,
  secondaryAcpPath: "/usr/local/bin/codex",
  grokPath: "/usr/local/bin/grok",
};

describe("mixed control", () => {
  it("is off until mixed planning and a planner path are both set", () => {
    expect(mixedPlanningReady(defaultSettings())).toBe(false);
    expect(mixedPlanningReady({ ...defaultSettings(), mixedPlanning: true })).toBe(false);
    expect(mixedPlanningReady(ready)).toBe(true);
  });

  it("starts the planner only in plan mode", () => {
    expect(shouldStartWithPlanner(ready, "plan")).toBe(true);
    expect(shouldStartWithPlanner(ready, "agent")).toBe(false);
    expect(shouldStartWithPlanner(ready, "goal")).toBe(false);
    expect(resolvePlannerExecutable(ready)).toBe("/usr/local/bin/codex");
    expect(resolveExecutorExecutable(ready)).toBe("/usr/local/bin/grok");
    expect(adapterIdForStart(true)).toBe(PLANNER_ADAPTER_ID);
    expect(adapterIdForStart(false)).toBe(GROK_ADAPTER_ID);
  });

  it("hands a planner session to Grok after approval", () => {
    expect(isPlannerSession({ adapterId: PLANNER_ADAPTER_ID })).toBe(true);
    expect(shouldHandoffPlannerToGrok(ready, { adapterId: PLANNER_ADAPTER_ID })).toBe(true);
    expect(shouldHandoffPlannerToGrok(ready, { adapterId: GROK_ADAPTER_ID })).toBe(false);
    expect(shouldHandoffPlannerToGrok(defaultSettings(), { adapterId: PLANNER_ADAPTER_ID })).toBe(false);
  });

  it("does not send Grok /plan or /goal control commands to the planner", () => {
    expect(usesGrokControlCommands(ready, undefined, "plan")).toBe(false);
    expect(usesGrokControlCommands(ready, { adapterId: PLANNER_ADAPTER_ID }, "agent")).toBe(false);
    expect(usesGrokControlCommands(ready, { adapterId: GROK_ADAPTER_ID }, "agent")).toBe(true);
    expect(usesGrokControlCommands(defaultSettings(), undefined, "plan")).toBe(true);
  });

  it("wraps the last plan block for Grok to implement", () => {
    const plan = latestPlanText([
      { type: "user", id: "1", text: "plan this" },
      { type: "plan", id: "2", text: "Step 1: change auth.ts" },
      { type: "assistant", id: "3", text: "ready" },
    ]);
    expect(plan).toBe("Step 1: change auth.ts");
    const prompt = buildGrokImplementPrompt(plan, "Plan approved. Proceed with the implementation.");
    expect(prompt).toContain("<approved_plan>");
    expect(prompt).toContain("Step 1: change auth.ts");
    expect(prompt).toContain("Implement it now");
  });
});
