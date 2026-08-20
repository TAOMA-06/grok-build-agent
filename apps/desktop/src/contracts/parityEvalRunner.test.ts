import { describe, expect, it } from "vitest";
import goldensetRaw from "./fixtures/parity-goldenset.json";
import {
  buildParityReport,
  buildSmokeResults,
  formatParityReport,
  outcomeToScore,
  parseParityResults,
} from "./parityEvalRunner";
import { parseParityGoldenset } from "./parityEval";

describe("parity eval runner", () => {
  const goldenset = parseParityGoldenset(goldensetRaw);

  it("maps outcomes to scoring weights", () => {
    expect(outcomeToScore("pass", goldenset.scoring)).toBe(1);
    expect(outcomeToScore("partial", goldenset.scoring)).toBe(0.5);
    expect(outcomeToScore("fail", goldenset.scoring)).toBe(0);
    expect(outcomeToScore("skipped", goldenset.scoring)).toBeNull();
  });

  it("builds a provisional smoke report without claiming full parity", () => {
    const results = buildSmokeResults(goldenset);
    const report = buildParityReport(goldenset, results);
    expect(report.scoredCount).toBeGreaterThan(0);
    expect(report.skippedCount).toBeGreaterThan(0);
    expect(report.provisional).toBe(true);
    expect(report.meetsTarget).toBe(false);
    expect(formatParityReport(report)).toContain("PROVISIONAL");
  });

  it("passes the median gate when every task is scored high enough", () => {
    const results = goldenset.tasks.map((task) => ({
      taskId: task.id,
      outcome: "pass" as const,
    }));
    const report = buildParityReport(goldenset, results);
    expect(report.meetsTarget).toBe(true);
    expect(report.median).toBe(1);
  });

  it("parses recorded results payloads", () => {
    const parsed = parseParityResults({
      results: [
        { taskId: goldenset.tasks[0]!.id, outcome: "pass" },
        { id: goldenset.tasks[1]!.id, outcome: "partial", notes: "half" },
      ],
    });
    expect(parsed).toHaveLength(2);
    expect(parsed[1]?.outcome).toBe("partial");
  });
});
