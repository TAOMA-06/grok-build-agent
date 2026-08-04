import { describe, expect, it } from "vitest";
import baselineRaw from "./fixtures/parity-baseline.json";
import goldensetRaw from "./fixtures/parity-goldenset.json";
import {
  assertAdvantagesFrozen,
  medianScore,
  meetsParityTarget,
  parseParityBaseline,
  parseParityGoldenset,
} from "./parityEval";

describe("parity eval W0 fixtures", () => {
  it("loads and validates the goldenset", () => {
    const set = parseParityGoldenset(goldensetRaw);
    expect(set.tasks.length).toBeGreaterThanOrEqual(20);
    expect(set.scoring.targetMedian).toBe(0.9);
    expect(set.categories).toContain("orchestration");
    expect(set.tasks.every((task) => task.compare.includes("cursor"))).toBe(true);
  });

  it("freezes the control-plane advantages", () => {
    const baseline = parseParityBaseline(baselineRaw);
    assertAdvantagesFrozen(baseline, [
      "completion-gate",
      "agent-host-sidecar",
      "worktree-dry-run-apply",
      "plan-host-gate",
      "local-privacy-default",
    ]);
    expect(baseline.nextWave).toBe("W1");
    expect(baseline.mustStreams).toEqual([
      "A-runtime-adapter",
      "B-repo-index",
      "C-subagent-control-plane",
    ]);
  });

  it("scores median against the parity gate", () => {
    expect(medianScore([1, 0.5, 1, 0.9, 0.8])).toBe(0.9);
    expect(meetsParityTarget([1, 0.5, 0.7, 0.8, 0.85], 0.9)).toBe(false);
    expect(meetsParityTarget([1, 1, 0.9, 0.95, 0.9], 0.9)).toBe(true);
  });
});
