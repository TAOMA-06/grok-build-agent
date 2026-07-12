import { describe, expect, it } from "vitest";
import {
  effortOptionsForModel,
  emptyContextUsage,
  formatTokenCount,
  mergeSelectableModels,
} from "./model";
import { extractContextUsage } from "../acp/client";

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

  it("seeds catalog window when usage is unknown", () => {
    expect(emptyContextUsage(200_000)).toMatchObject({
      usedTokens: null,
      windowTokens: 200_000,
      source: "catalog",
    });
  });
});
