import { describe, expect, it } from "vitest";
import {
  collectCacheSamples,
  compareCacheRuns,
  extractCacheSample,
  summarizeCacheSamples,
} from "./cache-hit-gate.mjs";

describe("cache-hit-gate", () => {
  it("extracts snake_case, camelCase, xAI cost ticks, and clamps invalid cache counts", () => {
    expect(extractCacheSample({
      prompt_tokens: "100",
      prompt_tokens_details: { cached_tokens: 80 },
      cost_in_usd_ticks: 50_000_000,
    })).toEqual({ promptTokens: 100, cachedTokens: 80, costUsd: 0.005 });
    expect(extractCacheSample({
      inputTokens: 50,
      inputTokensDetails: { cachedTokens: 75 },
      costUsd: 0.01,
    })).toEqual({ promptTokens: 50, cachedTokens: 50, costUsd: 0.01 });
    expect(extractCacheSample({ prompt_tokens: 0, cached_tokens: 0 })).toBeNull();
    expect(extractCacheSample(null)).toBeNull();
  });

  it("finds usage records recursively without double-counting their children", () => {
    const samples = collectCacheSamples({
      responses: [
        { usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 60 } } },
        { usage: { promptTokens: 200, cachedPromptTextTokens: 160 } },
      ],
    });
    expect(samples).toHaveLength(2);
    expect(summarizeCacheSamples(samples)).toMatchObject({
      samples: 2,
      promptTokens: 300,
      cachedTokens: 220,
      uncachedTokens: 80,
      hitRatePercent: 220 / 3,
      costUsd: null,
    });
    expect(summarizeCacheSamples([])).toMatchObject({
      samples: 0,
      hitRatePercent: 0,
      costUsd: null,
    });
  });

  it("passes only a fair run with a higher weighted hit rate and fewer misses", () => {
    const baseline = [
      { promptTokens: 100, cachedTokens: 40, costUsd: 0.02 },
      { promptTokens: 200, cachedTokens: 120, costUsd: 0.03 },
    ];
    const better = [
      { promptTokens: 90, cachedTokens: 60, costUsd: 0.015 },
      { promptTokens: 180, cachedTokens: 150, costUsd: 0.025 },
    ];
    const passed = compareCacheRuns(baseline, better);
    expect(passed.passed).toBe(true);
    expect(passed.hitRateDeltaPoints).toBeGreaterThan(0);
    expect(passed.uncachedTokenDelta).toBeLessThan(0);

    const unfair = compareCacheRuns(baseline, [better[0]]);
    expect(unfair.passed).toBe(false);
    expect(unfair.checks.sameTurnCount).toBe(false);
  });
});
