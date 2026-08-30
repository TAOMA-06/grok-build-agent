/**
 * W0 parity goldenset loader — validates harness/eval fixtures used to score
 * Grok Build Desktop against Cursor / Codex agent loops.
 */

export type ParityDifficulty = "easy" | "medium" | "hard";

export type ParityTask = {
  id: string;
  category: string;
  title: string;
  prompt: string;
  acceptance: string[];
  verify: string[];
  difficulty: ParityDifficulty;
  compare: string[];
};

export type ParityGoldenset = {
  version: number;
  name: string;
  parityTarget: string;
  scoring: {
    pass: number;
    partial: number;
    fail: number;
    targetMedian: number;
  };
  categories: string[];
  tasks: ParityTask[];
};

export type FrozenAdvantage = {
  id: string;
  title: string;
  rule: string;
};

export type CapabilityScore = {
  axis: string;
  score: number;
  target: number;
};

export type ParityBaseline = {
  version: number;
  capturedAt: string;
  source: string;
  frozenAdvantages: FrozenAdvantage[];
  capabilityScores: CapabilityScore[];
  nextWave: string;
  mustStreams: string[];
};

const DIFFICULTIES = new Set<ParityDifficulty>(["easy", "medium", "hard"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`parity eval: ${field} must be string[]`);
  }
  return value as string[];
}

export function parseParityGoldenset(raw: unknown): ParityGoldenset {
  if (!isRecord(raw)) throw new Error("parity eval: goldenset must be an object");
  if (typeof raw.version !== "number") throw new Error("parity eval: version required");
  if (typeof raw.name !== "string" || !raw.name.trim()) {
    throw new Error("parity eval: name required");
  }
  if (typeof raw.parityTarget !== "string") {
    throw new Error("parity eval: parityTarget required");
  }
  if (!isRecord(raw.scoring)) throw new Error("parity eval: scoring required");
  const scoring = {
    pass: Number(raw.scoring.pass),
    partial: Number(raw.scoring.partial),
    fail: Number(raw.scoring.fail),
    targetMedian: Number(raw.scoring.targetMedian),
  };
  if (Object.values(scoring).some((n) => !Number.isFinite(n))) {
    throw new Error("parity eval: scoring values must be finite numbers");
  }
  const categories = asStringArray(raw.categories, "categories");
  if (!Array.isArray(raw.tasks) || raw.tasks.length < 20) {
    throw new Error("parity eval: need at least 20 tasks for a usable goldenset");
  }
  const tasks: ParityTask[] = raw.tasks.map((task, index) => {
    if (!isRecord(task)) throw new Error(`parity eval: task[${index}] invalid`);
    const difficulty = task.difficulty;
    if (typeof difficulty !== "string" || !DIFFICULTIES.has(difficulty as ParityDifficulty)) {
      throw new Error(`parity eval: task[${index}].difficulty invalid`);
    }
    const id = String(task.id ?? "").trim();
    if (!id) throw new Error(`parity eval: task[${index}].id required`);
    return {
      id,
      category: String(task.category ?? "").trim(),
      title: String(task.title ?? "").trim(),
      prompt: String(task.prompt ?? "").trim(),
      acceptance: asStringArray(task.acceptance, `task[${index}].acceptance`),
      verify: asStringArray(task.verify, `task[${index}].verify`),
      difficulty: difficulty as ParityDifficulty,
      compare: asStringArray(task.compare, `task[${index}].compare`),
    };
  });
  const ids = new Set(tasks.map((task) => task.id));
  if (ids.size !== tasks.length) {
    throw new Error("parity eval: duplicate task ids");
  }
  for (const task of tasks) {
    if (!task.category || !categories.includes(task.category)) {
      throw new Error(`parity eval: task ${task.id} category not listed`);
    }
    if (!task.title || !task.prompt || task.acceptance.length === 0) {
      throw new Error(`parity eval: task ${task.id} incomplete`);
    }
  }
  return {
    version: raw.version,
    name: raw.name,
    parityTarget: raw.parityTarget,
    scoring,
    categories,
    tasks,
  };
}

export function parseParityBaseline(raw: unknown): ParityBaseline {
  if (!isRecord(raw)) throw new Error("parity eval: baseline must be an object");
  if (typeof raw.version !== "number") throw new Error("parity eval: baseline version required");
  if (!Array.isArray(raw.frozenAdvantages) || raw.frozenAdvantages.length < 3) {
    throw new Error("parity eval: freeze at least 3 advantages");
  }
  const frozenAdvantages: FrozenAdvantage[] = raw.frozenAdvantages.map((item, index) => {
    if (!isRecord(item)) throw new Error(`parity eval: advantage[${index}] invalid`);
    return {
      id: String(item.id ?? "").trim(),
      title: String(item.title ?? "").trim(),
      rule: String(item.rule ?? "").trim(),
    };
  });
  if (frozenAdvantages.some((item) => !item.id || !item.rule)) {
    throw new Error("parity eval: advantage fields required");
  }
  if (!Array.isArray(raw.capabilityScores) || raw.capabilityScores.length === 0) {
    throw new Error("parity eval: capabilityScores required");
  }
  const capabilityScores: CapabilityScore[] = raw.capabilityScores.map((item, index) => {
    if (!isRecord(item)) throw new Error(`parity eval: score[${index}] invalid`);
    const score = Number(item.score);
    const target = Number(item.target);
    if (!Number.isFinite(score) || !Number.isFinite(target)) {
      throw new Error(`parity eval: score[${index}] must be numeric`);
    }
    return {
      axis: String(item.axis ?? "").trim(),
      score,
      target,
    };
  });
  return {
    version: raw.version,
    capturedAt: String(raw.capturedAt ?? ""),
    source: String(raw.source ?? ""),
    frozenAdvantages,
    capabilityScores,
    nextWave: String(raw.nextWave ?? ""),
    mustStreams: asStringArray(raw.mustStreams, "mustStreams"),
  };
}

/** Median of task scores in [0,1]; used for Cursor/Codex parity gate. */
export function medianScore(scores: number[]): number {
  if (scores.length === 0) return 0;
  const sorted = [...scores].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

export function meetsParityTarget(scores: number[], targetMedian: number): boolean {
  return medianScore(scores) >= targetMedian;
}

/** Advantages that must not regress while chasing Cursor/Codex parity. */
export function assertAdvantagesFrozen(baseline: ParityBaseline, requiredIds: string[]): void {
  const have = new Set(baseline.frozenAdvantages.map((item) => item.id));
  for (const id of requiredIds) {
    if (!have.has(id)) {
      throw new Error(`parity eval: frozen advantage missing: ${id}`);
    }
  }
}
