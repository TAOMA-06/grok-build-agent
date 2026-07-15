import { describe, expect, it } from "vitest";
import { defaultSettings, normalizeSettings, type Settings } from "./settings";

describe("settings privacy defaults", () => {
  it("defaults Privacy Mode, Private Chat, and Strict Privacy Shield to on", () => {
    const settings = defaultSettings();
    expect(settings.schemaVersion).toBe(7);
    expect(settings.codingDataPrivacy).toBe(true);
    expect(settings.privateChat).toBe(true);
    expect(settings.privacyMode).toBe("strict");
  });

  it("migrates legacy settings without codingDataPrivacy to Privacy Mode on", () => {
    const legacy = {
      ...defaultSettings(),
      schemaVersion: 6 as unknown as 7,
    } as Settings;
    delete (legacy as { codingDataPrivacy?: boolean }).codingDataPrivacy;
    const normalized = normalizeSettings(legacy);
    expect(normalized.schemaVersion).toBe(7);
    expect(normalized.codingDataPrivacy).toBe(true);
    expect(normalized.privateChat).toBe(true);
  });

  it("preserves an explicit Privacy Mode off preference", () => {
    const normalized = normalizeSettings({
      ...defaultSettings(),
      codingDataPrivacy: false,
    });
    expect(normalized.codingDataPrivacy).toBe(false);
  });
});
