import { describe, expect, it, vi, beforeEach } from "vitest";
import { compareSemver, fetchLatestGitHubRelease, useAppUpdater } from "./updater";

describe("compareSemver", () => {
  it("correctly identifies older versions", () => {
    expect(compareSemver("1.1.1", "1.2.0")).toBeLessThan(0);
    expect(compareSemver("1.1.1", "v1.1.2")).toBeLessThan(0);
    expect(compareSemver("v1.0.0", "v1.0.1")).toBeLessThan(0);
    expect(compareSemver("1.1.9", "1.1.10")).toBeLessThan(0);
  });

  it("correctly identifies newer versions", () => {
    expect(compareSemver("1.2.0", "1.1.1")).toBeGreaterThan(0);
    expect(compareSemver("v2.0.0", "1.9.9")).toBeGreaterThan(0);
  });

  it("correctly identifies identical versions", () => {
    expect(compareSemver("1.1.1", "1.1.1")).toBe(0);
    expect(compareSemver("v1.1.1", "1.1.1")).toBe(0);
    expect(compareSemver("1.1.1", "v1.1.1")).toBe(0);
  });
});

describe("fetchLatestGitHubRelease", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("parses release payload and identifies update available", async () => {
    const mockRelease = {
      tag_name: "v1.2.0",
      name: "Release v1.2.0",
      body: "- Added in-app auto-update\n- Modern soft-edge UI",
      published_at: "2026-08-28T08:00:00Z",
      html_url: "https://github.com/TAOMA-06/grok-build-agent/releases/tag/v1.2.0",
      prerelease: false,
      assets: [
        {
          name: "Grok.Build.Desktop_1.2.0_universal.dmg",
          browser_download_url: "https://github.com/TAOMA-06/grok-build-agent/releases/download/v1.2.0/Grok.Build.Desktop_1.2.0_universal.dmg",
          size: 45000000,
        },
      ],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockRelease,
    });

    const info = await fetchLatestGitHubRelease("1.1.1");
    expect(info.hasUpdate).toBe(true);
    expect(info.version).toBe("1.2.0");
    expect(info.title).toBe("Release v1.2.0");
    expect(info.assetName).toBe("Grok.Build.Desktop_1.2.0_universal.dmg");
  });

  it("identifies when application is up to date", async () => {
    const mockRelease = {
      tag_name: "v1.1.1",
      name: "Release v1.1.1",
      body: "Current release",
      published_at: "2026-08-28T08:00:00Z",
      html_url: "https://github.com/TAOMA-06/grok-build-agent/releases/tag/v1.1.1",
      prerelease: false,
      assets: [],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockRelease,
    });

    const info = await fetchLatestGitHubRelease("1.1.1");
    expect(info.hasUpdate).toBe(false);
    expect(info.version).toBe("1.1.1");
  });
});

describe("useAppUpdater store", () => {
  it("initializes with idle phase and allows toggling dialog", () => {
    const state = useAppUpdater.getState();
    expect(state.phase).toBeDefined();

    state.setDialogOpen(true);
    expect(useAppUpdater.getState().dialogOpen).toBe(true);

    state.setDialogOpen(false);
    expect(useAppUpdater.getState().dialogOpen).toBe(false);
  });
});
