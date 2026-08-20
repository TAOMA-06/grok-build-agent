import { describe, expect, it } from "vitest";
import {
  defaultSettings,
  normalizeSettings,
  resolveAgentExecutable,
  resolveFallbackAgentExecutable,
  adapterFallbackLabel,
  resolveTurnLadderStep,
  resolveTurnLadderSteps,
  isTurnLadderEligibleError,
  type Settings,
} from "./settings";

describe("settings agent defaults", () => {
  it("defaults durable coding with harness and Privacy Mode on", () => {
    const settings = defaultSettings();
    expect(settings.schemaVersion).toBe(10);
    expect(settings.model).toBe("grok-4.5");
    expect(settings.codingDataPrivacy).toBe(true);
    expect(settings.codingDataPrivacyConfigured).toBe(true);
    expect(settings.privateChat).toBe(false);
    expect(settings.useHarness).toBe(true);
    expect(settings.combineQueuedPrompts).toBe(false);
    expect(settings.disableImageTools).toBe(false);
    expect(settings.privacyMode).toBe("strict");
    expect(settings.preferredAdapterId).toBe("grok-acp");
    expect(settings.secondaryAcpPath).toBe("");
    expect(settings.mixedPlanning).toBe(false);
  });

  it("does not change account privacy or harness preferences for legacy settings", () => {
    const legacy = {
      ...defaultSettings(),
      schemaVersion: 6 as unknown as 10,
    } as Settings;
    delete (legacy as { codingDataPrivacy?: boolean }).codingDataPrivacy;
    delete (legacy as { codingDataPrivacyConfigured?: boolean }).codingDataPrivacyConfigured;
    delete (legacy as { useHarness?: boolean }).useHarness;
    const normalized = normalizeSettings(legacy);
    expect(normalized.schemaVersion).toBe(10);
    expect(normalized.codingDataPrivacy).toBe(false);
    expect(normalized.codingDataPrivacyConfigured).toBe(false);
    expect(normalized.privateChat).toBe(false);
    expect(normalized.useHarness).toBe(false);
  });

  it("preserves explicit privateChat and harness off preferences", () => {
    const normalized = normalizeSettings({
      ...defaultSettings(),
      codingDataPrivacy: false,
      privateChat: true,
      useHarness: false,
    });
    expect(normalized.codingDataPrivacy).toBe(false);
    expect(normalized.codingDataPrivacyConfigured).toBe(true);
    expect(normalized.privateChat).toBe(true);
    expect(normalized.useHarness).toBe(false);
    expect(normalized.mixedPlanning).toBe(false);
  });

  it("preserves mixed planning when a planner path is set", () => {
    const normalized = normalizeSettings({
      ...defaultSettings(),
      mixedPlanning: true,
      secondaryAcpPath: "/usr/local/bin/codex",
    });
    expect(normalized.mixedPlanning).toBe(true);
    expect(normalized.secondaryAcpPath).toBe("/usr/local/bin/codex");
  });

  it("recognizes an existing account privacy preference when the sync marker is absent", () => {
    const legacy = {
      ...defaultSettings(),
      codingDataPrivacy: false,
    } as Settings;
    delete (legacy as { codingDataPrivacyConfigured?: boolean }).codingDataPrivacyConfigured;
    const normalized = normalizeSettings(legacy);
    expect(normalized.codingDataPrivacy).toBe(false);
    expect(normalized.codingDataPrivacyConfigured).toBe(true);
  });

  it("resolves secondary ACP executable when preferred", () => {
    expect(resolveAgentExecutable(defaultSettings())).toBeNull();
    expect(
      resolveAgentExecutable({
        ...defaultSettings(),
        preferredAdapterId: "generic-acp",
        secondaryAcpPath: "/tmp/mock-acp",
      }),
    ).toBe("/tmp/mock-acp");
    expect(
      resolveAgentExecutable({
        ...defaultSettings(),
        cliPathOverride: "/usr/local/bin/grok",
      }),
    ).toBe("/usr/local/bin/grok");
  });

  it("resolves a one-shot fallback executable when the alternate is configured", () => {
    expect(resolveFallbackAgentExecutable(defaultSettings())).toBeNull();
    expect(
      resolveFallbackAgentExecutable({
        ...defaultSettings(),
        cliPathOverride: "/usr/local/bin/grok",
        secondaryAcpPath: "/tmp/mock-acp",
      }),
    ).toBe("/tmp/mock-acp");
    expect(
      resolveFallbackAgentExecutable({
        ...defaultSettings(),
        preferredAdapterId: "generic-acp",
        secondaryAcpPath: "/tmp/mock-acp",
        cliPathOverride: "/usr/local/bin/grok",
      }),
    ).toBe("/usr/local/bin/grok");
    expect(
      resolveFallbackAgentExecutable({
        ...defaultSettings(),
        preferredAdapterId: "generic-acp",
        secondaryAcpPath: "/tmp/mock-acp",
      }),
    ).toBeNull();
    expect(adapterFallbackLabel(defaultSettings())).toContain("secondary");
  });

  it("resolves multi-step turn ladder adapter then model, and skips cancel noise", () => {
    expect(
      resolveTurnLadderSteps({
        ...defaultSettings(),
        cliPathOverride: "/usr/local/bin/grok",
        secondaryAcpPath: "/tmp/mock-acp",
        fallbackModelId: "grok-4",
        model: "grok-4.5",
      }),
    ).toEqual([
      { kind: "adapter", grokPath: "/tmp/mock-acp", label: expect.stringContaining("secondary") },
      { kind: "model", modelId: "grok-4" },
    ]);
    expect(
      resolveTurnLadderStep({
        ...defaultSettings(),
        cliPathOverride: "/usr/local/bin/grok",
        secondaryAcpPath: "/tmp/mock-acp",
        fallbackModelId: "grok-4",
      }),
    ).toMatchObject({ kind: "adapter", grokPath: "/tmp/mock-acp" });
    expect(
      resolveTurnLadderSteps({
        ...defaultSettings(),
        model: "grok-4.5",
        fallbackModelId: "grok-4",
      }),
    ).toEqual([{ kind: "model", modelId: "grok-4" }]);
    expect(
      resolveTurnLadderSteps({
        ...defaultSettings(),
        model: "grok-4",
        fallbackModelId: "grok-4",
      }),
    ).toEqual([]);
    expect(isTurnLadderEligibleError(new Error("spawn failed"))).toBe(true);
    expect(isTurnLadderEligibleError(new Error("cancelled by user"))).toBe(false);
  });
});
