import { describe, expect, it } from "vitest";
import { isActiveHostJob, nextRunHint, JOB_SCHEDULE_PRESETS, type HostJob } from "./jobs";

describe("host jobs", () => {
  it("treats active and paused as actionable", () => {
    const base: HostJob = {
      jobId: "j1",
      workspaceId: "/tmp",
      kind: "agent_prompt",
      state: "active",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    expect(isActiveHostJob(base)).toBe(true);
    expect(isActiveHostJob({ ...base, state: "paused" })).toBe(true);
    expect(isActiveHostJob({ ...base, state: "cancelled" })).toBe(false);
  });

  it("maps schedule presets to labels", () => {
    expect(JOB_SCHEDULE_PRESETS.length).toBeGreaterThan(3);
    expect(nextRunHint("0 9 * * *")).toContain("Daily");
    expect(nextRunHint("")).toBeNull();
  });
});
