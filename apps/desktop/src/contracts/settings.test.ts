import { describe, expect, it } from "vitest";
import { defaultSettings, normalizeSettings, type Settings } from "./settings";

describe("settings agent defaults", () => {
  it("defaults durable coding with harness and Privacy Mode on", () => {
    const settings = defaultSettings();
    expect(settings.schemaVersion).toBe(8);
    expect(settings.codingDataPrivacy).toBe(true);
    expect(settings.codingDataPrivacyConfigured).toBe(true);
    expect(settings.privateChat).toBe(false);
    expect(settings.useHarness).toBe(true);
    expect(settings.privacyMode).toBe("strict");
  });

  it("does not change account privacy or harness preferences for legacy settings", () => {
    const legacy = {
      ...defaultSettings(),
      schemaVersion: 6 as unknown as 8,
    } as Settings;
    delete (legacy as { codingDataPrivacy?: boolean }).codingDataPrivacy;
    delete (legacy as { codingDataPrivacyConfigured?: boolean }).codingDataPrivacyConfigured;
    delete (legacy as { useHarness?: boolean }).useHarness;
    const normalized = normalizeSettings(legacy);
    expect(normalized.schemaVersion).toBe(8);
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
});
