#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

function finite(value) {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : null;
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function extractCacheSample(value) {
  const item = record(value);
  if (!item) return null;
  const details =
    record(item.prompt_tokens_details) ??
    record(item.promptTokensDetails) ??
    record(item.input_tokens_details) ??
    record(item.inputTokensDetails);
  const promptTokens = finite(
    item.prompt_tokens ?? item.promptTokens ?? item.input_tokens ?? item.inputTokens,
  );
  const cachedTokens = finite(
    details?.cached_tokens ??
      details?.cachedTokens ??
      item.cached_prompt_text_tokens ??
      item.cachedPromptTextTokens ??
      item.cached_tokens ??
      item.cachedTokens,
  );
  if (promptTokens == null || cachedTokens == null || promptTokens <= 0) return null;
  const costUsd = finite(item.cost_usd ?? item.costUsd);
  const costTicks = finite(item.cost_in_usd_ticks ?? item.costInUsdTicks);
  return {
    promptTokens,
    cachedTokens: Math.min(promptTokens, Math.max(0, cachedTokens)),
    costUsd: costUsd ?? (costTicks == null ? null : costTicks / 10_000_000_000),
  };
}

export function collectCacheSamples(value, output = []) {
  const sample = extractCacheSample(value);
  if (sample) {
    output.push(sample);
    return output;
  }
  if (Array.isArray(value)) {
    for (const child of value) collectCacheSamples(child, output);
  } else {
    const item = record(value);
    if (item) {
      for (const child of Object.values(item)) collectCacheSamples(child, output);
    }
  }
  return output;
}

export function summarizeCacheSamples(samples) {
  const totals = samples.reduce(
    (sum, sample) => ({
      promptTokens: sum.promptTokens + sample.promptTokens,
      cachedTokens: sum.cachedTokens + sample.cachedTokens,
      costUsd: sum.costUsd + (sample.costUsd ?? 0),
      pricedSamples: sum.pricedSamples + (sample.costUsd == null ? 0 : 1),
    }),
    { promptTokens: 0, cachedTokens: 0, costUsd: 0, pricedSamples: 0 },
  );
  return {
    samples: samples.length,
    promptTokens: totals.promptTokens,
    cachedTokens: totals.cachedTokens,
    uncachedTokens: totals.promptTokens - totals.cachedTokens,
    hitRatePercent:
      totals.promptTokens === 0 ? 0 : (totals.cachedTokens / totals.promptTokens) * 100,
    costUsd: totals.pricedSamples === samples.length && samples.length > 0 ? totals.costUsd : null,
  };
}

export function compareCacheRuns(baselineSamples, candidateSamples) {
  const baseline = summarizeCacheSamples(baselineSamples);
  const candidate = summarizeCacheSamples(candidateSamples);
  const checks = {
    nonEmpty: baseline.samples > 0 && candidate.samples > 0,
    sameTurnCount: baseline.samples === candidate.samples,
    higherHitRate: candidate.hitRatePercent > baseline.hitRatePercent,
    fewerUncachedTokens: candidate.uncachedTokens < baseline.uncachedTokens,
    noHigherCost:
      baseline.costUsd == null ||
      candidate.costUsd == null ||
      candidate.costUsd <= baseline.costUsd,
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    baseline,
    candidate,
    hitRateDeltaPoints: candidate.hitRatePercent - baseline.hitRatePercent,
    uncachedTokenDelta: candidate.uncachedTokens - baseline.uncachedTokens,
  };
}

async function readTrace(path) {
  const text = await readFile(path, "utf8");
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    return collectCacheSamples(JSON.parse(trimmed));
  } catch {
    const samples = [];
    for (const [index, line] of trimmed.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      try {
        collectCacheSamples(JSON.parse(line), samples);
      } catch (error) {
        throw new Error(`${path}:${index + 1}: invalid JSON: ${error}`);
      }
    }
    return samples;
  }
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function selfTest() {
  const nested = collectCacheSamples({
    result: { usage: { prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 75 } } },
  });
  assert.deepEqual(nested, [{ promptTokens: 100, cachedTokens: 75, costUsd: null }]);
  const result = compareCacheRuns(
    [
      { promptTokens: 100, cachedTokens: 20, costUsd: 0.01 },
      { promptTokens: 200, cachedTokens: 130, costUsd: 0.02 },
    ],
    [
      { promptTokens: 90, cachedTokens: 50, costUsd: 0.008 },
      { promptTokens: 190, cachedTokens: 150, costUsd: 0.018 },
    ],
  );
  assert.equal(result.passed, true);
  assert.equal(result.candidate.uncachedTokens, 80);
  process.stdout.write("cache-hit-gate self-test passed\n");
}

async function main(args) {
  if (args.includes("--self-test")) {
    selfTest();
    return;
  }
  const baselinePath = option(args, "--baseline");
  const candidatePath = option(args, "--candidate");
  if (!baselinePath || !candidatePath) {
    throw new Error(
      "usage: cache-hit-gate --baseline cli.jsonl --candidate desktop.jsonl",
    );
  }
  const result = compareCacheRuns(
    await readTrace(baselinePath),
    await readTrace(candidatePath),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.passed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
