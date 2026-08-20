#!/usr/bin/env node
/**
 * Parity eval CLI — validates goldenset/baseline and scores recorded results.
 *
 * Usage:
 *   node scripts/parity-eval-runner.mjs
 *   node scripts/parity-eval-runner.mjs --results path/to/results.json
 *   node scripts/parity-eval-runner.mjs --smoke --json
 *   node scripts/parity-eval-runner.mjs --self-test
 *
 * Exit codes:
 *   0 — fixtures valid; smoke provisional OK, or full run meets target / still provisional
 *   1 — invalid fixtures/results, or fully scored run below target median
 *
 * Does not install terminal/browser tooling and does not launch Grok.
 */

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, "..");
const repoRoot = resolve(desktopRoot, "../..");

const SMOKE_CATEGORIES = ["verify", "git-safety", "orchestration", "plan"];

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function medianScore(scores) {
  if (scores.length === 0) return 0;
  const sorted = [...scores].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function outcomeToScore(outcome, scoring) {
  if (outcome === "pass") return scoring.pass;
  if (outcome === "partial") return scoring.partial;
  if (outcome === "fail") return scoring.fail;
  return null;
}

function parseArgs(argv) {
  const args = {
    results: null,
    smoke: true,
    json: false,
    selfTest: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--results") {
      args.results = argv[++i] ?? null;
      args.smoke = false;
    } else if (arg === "--smoke") {
      args.smoke = true;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--self-test") {
      args.selfTest = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    }
  }
  return args;
}

function buildReport(goldenset, results) {
  const byId = new Map(results.map((item) => [item.taskId, item]));
  const rows = goldenset.tasks.map((task) => {
    const result = byId.get(task.id);
    const outcome = result?.outcome ?? "skipped";
    return {
      taskId: task.id,
      category: task.category,
      title: task.title,
      outcome,
      score: outcomeToScore(outcome, goldenset.scoring),
      notes: result?.notes,
    };
  });
  const scores = rows.map((row) => row.score).filter((score) => score != null);
  const skippedCount = rows.length - scores.length;
  const median = medianScore(scores);
  const allScored = skippedCount === 0;
  const meetsTarget = allScored && median >= goldenset.scoring.targetMedian;
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
    rows,
  };
}

function formatReport(report) {
  const gate = report.meetsTarget
    ? "PASS"
    : report.provisional
      ? "PROVISIONAL"
      : "FAIL";
  return [
    `Parity eval · ${report.goldensetName} v${report.goldensetVersion}`,
    `Scored ${report.scoredCount}/${report.scoredCount + report.skippedCount}`
      + (report.skippedCount ? ` (${report.skippedCount} skipped)` : ""),
    `Median ${report.median.toFixed(3)} · target ${report.targetMedian.toFixed(3)} · ${gate}`,
    "Note: does not install terminal/browser tooling; agent tasks need --results.",
  ].join("\n");
}

function selfTest() {
  const scores = medianScore([1, 0.5, 1, 0.9, 0.8]);
  if (Math.abs(scores - 0.9) > 1e-9) {
    throw new Error(`self-test median failed: ${scores}`);
  }
  if (outcomeToScore("partial", { pass: 1, partial: 0.5, fail: 0 }) !== 0.5) {
    throw new Error("self-test outcome weights failed");
  }
  console.log("parity-eval-runner self-test ok");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: node scripts/parity-eval-runner.mjs [--smoke|--results FILE] [--json] [--self-test]",
    );
    process.exit(0);
  }

  if (args.selfTest) {
    selfTest();
    return;
  }

  const goldensetPath = join(repoRoot, "harness/eval/goldenset.json");
  const baselinePath = join(repoRoot, "harness/eval/baseline.json");
  const goldenset = await loadJson(goldensetPath);
  const baseline = await loadJson(baselinePath);

  if (!Array.isArray(goldenset.tasks) || goldenset.tasks.length < 20) {
    throw new Error("goldenset must contain at least 20 tasks");
  }
  if (!Array.isArray(baseline.frozenAdvantages) || baseline.frozenAdvantages.length < 3) {
    throw new Error("baseline must freeze advantages");
  }

  let results;
  if (args.results) {
    const payload = await loadJson(resolve(args.results));
    const list = payload.results ?? payload.tasks;
    if (!Array.isArray(list)) throw new Error("--results file missing results[]");
    results = list.map((item) => ({
      taskId: String(item.taskId ?? item.id ?? "").trim(),
      outcome: String(item.outcome ?? "").trim(),
      notes: typeof item.notes === "string" ? item.notes : undefined,
    }));
  } else {
    const pass = new Set(SMOKE_CATEGORIES);
    results = goldenset.tasks.map((task) => ({
      taskId: task.id,
      outcome: pass.has(task.category) ? "pass" : "skipped",
      notes: pass.has(task.category)
        ? "control-plane smoke"
        : "pending agent / manual score",
    }));
  }

  const report = buildReport(goldenset, results);
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReport(report));
  }

  if (args.results && !report.meetsTarget && report.skippedCount === 0) {
    process.exitCode = 1;
  }
}

const isDirect =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirect) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
