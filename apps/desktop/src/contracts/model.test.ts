import { describe, expect, it } from "vitest";
import {
  effortOptionsForModel,
  emptyContextUsage,
  formatTokenCount,
  mergeSelectableModels,
  resolveEffortForModel,
  sanitizeDefaultReasoningEffort,
} from "./model";
import { extractContextUsage } from "../acp/client";
import { normalizeSettings, defaultSettings } from "./settings";

describe("reasoning effort helpers", () => {
  it("hides effort controls when the model does not support them", () => {
    expect(
      effortOptionsForModel({
        id: "grok-composer",
        name: "Composer",
        supportsReasoningEffort: false,
      }),
    ).toEqual([]);
  });

  it("prefers catalog effort options", () => {
    const options = effortOptionsForModel({
      id: "grok-4.5",
      name: "Grok 4.5",
      supportsReasoningEffort: true,
      reasoningEfforts: [
        { id: "low", value: "low", label: "Low" },
        { id: "high", value: "high", label: "High", default: true },
      ],
    });
    expect(options.map((item) => item.value)).toEqual(["low", "high"]);
  });

  it("merges ACP stubs with catalog effort metadata", () => {
    const merged = mergeSelectableModels(
      [{ id: "grok-4.5", name: "grok-4.5", isDefault: true }],
      [
        {
          id: "grok-4.5",
          name: "Grok 4.5",
          supportsReasoningEffort: true,
          contextWindow: 500_000,
          reasoningEfforts: [{ id: "high", value: "high", label: "High", default: true }],
        },
      ],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: "grok-4.5",
      name: "Grok 4.5",
      supportsReasoningEffort: true,
      contextWindow: 500_000,
    });
    expect(effortOptionsForModel(merged[0]).map((item) => item.value)).toEqual(["high"]);
  });

  it("maps unsupported settings defaults like xhigh onto high", () => {
    expect(sanitizeDefaultReasoningEffort("xhigh")).toBe("high");
    expect(sanitizeDefaultReasoningEffort("max")).toBe("high");
    expect(sanitizeDefaultReasoningEffort("medium")).toBe("medium");
    expect(normalizeSettings({
      ...defaultSettings(),
      defaultReasoningEffort: "xhigh",
    }).defaultReasoningEffort).toBe("high");
  });

  it("resolves preferred xhigh to the catalog default for grok-4.5", () => {
    const model = {
      id: "grok-4.5",
      name: "Grok 4.5",
      supportsReasoningEffort: true,
      reasoningEffort: "high",
      reasoningEfforts: [
        { id: "low", value: "low", label: "Low Effort" },
        { id: "medium", value: "medium", label: "Medium Effort" },
        { id: "high", value: "high", label: "High Effort", default: true },
      ],
    };
    expect(resolveEffortForModel(model, "xhigh")).toBe("high");
    expect(resolveEffortForModel(model, "low")).toBe("low");
  });
});

describe("context usage helpers", () => {
  it("formats token counts compactly", () => {
    expect(formatTokenCount(null)).toBe("—");
    expect(formatTokenCount(500)).toBe("500");
    expect(formatTokenCount(12_400)).toBe("12k");
    expect(formatTokenCount(500_000)).toBe("500k");
  });

  it("extracts usage fields from ACP-like payloads", () => {
    const usage = extractContextUsage({
      totalContextTokens: 12400,
      context_window_tokens: 500000,
      context_usage_pct: 2.48,
    });
    expect(usage).toMatchObject({
      usedTokens: 12400,
      windowTokens: 500000,
      usagePercent: 2.48,
      source: "acp",
    });
  });

  it("extracts xAI prompt-cache accounting from a nested ACP update", () => {
    const usage = extractContextUsage({
      update: {
        sessionUpdate: "usage_update",
        usage: {
          prompt_tokens: 1_000,
          prompt_tokens_details: { cached_tokens: 800 },
          cost_in_usd_ticks: 25_000_000,
        },
      },
    });
    expect(usage?.promptCache).toMatchObject({
      promptTokens: 1_000,
      cachedTokens: 800,
      uncachedTokens: 200,
      hitRatePercent: 80,
      costUsd: 0.0025,
    });
  });

  it("seeds catalog window when usage is unknown", () => {
    expect(emptyContextUsage(200_000)).toMatchObject({
      usedTokens: null,
      windowTokens: 200_000,
      source: "catalog",
    });
  });
});
