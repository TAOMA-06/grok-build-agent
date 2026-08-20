/**
 * Executable parity eval runner — scores goldenset task outcomes against the
 * Cursor/Codex median gate. Does not launch an agent; consumes recorded results
 * (or a smoke map of control-plane categories).
 */

import {
  medianScore,
  meetsParityTarget,
  type ParityGoldenset,
  type ParityTask,
} from "./parityEval";

export type TaskOutcome = "pass" | "partial" | "fail" | "skipped";

export type TaskResult = {
  taskId: string;
  outcome: TaskOutcome;
  notes?: string;
};

export type ScoredTaskRow = {
  taskId: string;
  category: string;
  title: string;
  outcome: TaskOutcome;
  /** Null when skipped / not scored. */
  score: number | null;
  notes?: string;
};

export type CategoryScoreSummary = {
  category: string;
  scored: number;
  skipped: number;
  median: number;
};

export type ParityRunReport = {
  goldensetName: string;
  goldensetVersion: number;
  targetMedian: number;
  scoredCount: number;
  skippedCount: number;
  /** Scores in [0,1] for scored tasks only. */
  scores: number[];
  median: number;
  /** True only when every goldenset task is scored and median ≥ target. */
  meetsTarget: boolean;
  /** True when enough scored tasks exist to compute a provisional median. */
  provisional: boolean;
  byCategory: CategoryScoreSummary[];
  rows: ScoredTaskRow[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function outcomeToScore(
  outcome: TaskOutcome,
  scoring: ParityGoldenset["scoring"],
): number | null {
  switch (outcome) {
    case "pass":
      return scoring.pass;
    case "partial":
      return scoring.partial;
    case "fail":
      return scoring.fail;
    case "skipped":
      return null;
  }
}

export function parseParityResults(raw: unknown): TaskResult[] {
  if (!isRecord(raw)) throw new Error("parity runner: results must be an object");
  const list = raw.results ?? raw.tasks;
  if (!Array.isArray(list)) {
    throw new Error("parity runner: results.results must be an array");
  }
  return list.map((item, index) => {
    if (!isRecord(item)) throw new Error(`parity runner: results[${index}] invalid`);
    const taskId = String(item.taskId ?? item.id ?? "").trim();
    const outcome = String(item.outcome ?? "").trim() as TaskOutcome;
    if (!taskId) throw new Error(`parity runner: results[${index}].taskId required`);
    if (!["pass", "partial", "fail", "skipped"].includes(outcome)) {
      throw new Error(`parity runner: results[${index}].outcome invalid`);
    }
    const notes = typeof item.notes === "string" ? item.notes : undefined;
    return { taskId, outcome, notes };
  });
}

/**
 * Control-plane smoke: categories we can claim without launching Grok.
 * Maps to `skipped` unless an explicit result overrides.
 * Smoke auto-pass is reserved for verify/git-safety/orchestration/plan when
 * `smokePassCategories` is enabled by the runner.
 */
export const CONTROL_PLANE_SMOKE_CATEGORIES = [
  "verify",
  "git-safety",
  "orchestration",
  "plan",
] as const;

export function buildSmokeResults(
  goldenset: ParityGoldenset,
  options?: { passCategories?: readonly string[] },
): TaskResult[] {
  const pass = new Set(options?.passCategories ?? CONTROL_PLANE_SMOKE_CATEGORIES);
  return goldenset.tasks.map((task) => ({
    taskId: task.id,
    outcome: pass.has(task.category) ? "pass" : "skipped",
    notes: pass.has(task.category)
      ? "control-plane smoke (fixtures + contract coverage assumed)"
      : "pending agent / manual score",
  }));
}

export function buildParityReport(
  goldenset: ParityGoldenset,
  results: TaskResult[],
): ParityRunReport {
  const byId = new Map(results.map((item) => [item.taskId, item]));
  const unknown = results.filter((item) => !goldenset.tasks.some((task) => task.id === item.taskId));
  if (unknown.length > 0) {
    throw new Error(
      `parity runner: unknown task ids: ${unknown.map((item) => item.taskId).join(", ")}`,
    );
  }

  const rows: ScoredTaskRow[] = goldenset.tasks.map((task: ParityTask) => {
    const result = byId.get(task.id);
    const outcome: TaskOutcome = result?.outcome ?? "skipped";
    return {
      taskId: task.id,
      category: task.category,
      title: task.title,
      outcome,
      score: outcomeToScore(outcome, goldenset.scoring),
      notes: result?.notes,
    };
  });

  const scores = rows
    .map((row) => row.score)
    .filter((score): score is number => score != null);
  const skippedCount = rows.length - scores.length;
  const median = medianScore(scores);
  const allScored = skippedCount === 0;
  const meetsTarget = allScored && meetsParityTarget(scores, goldenset.scoring.targetMedian);

  const categories = new Map<string, number[]>();
  const skippedByCategory = new Map<string, number>();
  for (const row of rows) {
    if (row.score == null) {
      skippedByCategory.set(row.category, (skippedByCategory.get(row.category) ?? 0) + 1);
      continue;
    }
    const list = categories.get(row.category) ?? [];
    list.push(row.score);
    categories.set(row.category, list);
  }

  const byCategory: CategoryScoreSummary[] = goldenset.categories.map((category) => {
    const scored = categories.get(category) ?? [];
    return {
      category,
      scored: scored.length,
      skipped: skippedByCategory.get(category) ?? 0,
      median: medianScore(scored),
    };
  });

  return {
    goldensetName: goldenset.name,
    goldensetVersion: goldenset.version,
    targetMedian: goldenset.scoring.targetMedian,
    scoredCount: scores.length,
    skippedCount,
    scores,
    median,
    meetsTarget,
    provisional: !allScored && scores.length > 0,
    byCategory,
    rows,
  };
}

export function formatParityReport(report: ParityRunReport): string {
  const lines = [
    `Parity eval · ${report.goldensetName} v${report.goldensetVersion}`,
    `Scored ${report.scoredCount}/${report.scoredCount + report.skippedCount}`
      + (report.skippedCount ? ` (${report.skippedCount} skipped)` : ""),
    `Median ${report.median.toFixed(3)} · target ${report.targetMedian.toFixed(3)}`
      + (report.meetsTarget
        ? " · PASS"
        : report.provisional
          ? " · PROVISIONAL"
          : " · FAIL"),
  ];
  for (const category of report.byCategory) {
    if (category.scored === 0 && category.skipped === 0) continue;
    lines.push(
      `  ${category.category}: median ${category.median.toFixed(3)}`
        + ` · scored ${category.scored} · skipped ${category.skipped}`,
    );
  }
  return lines.join("\n");
}
