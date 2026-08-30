import { create } from "zustand";

export interface AppReleaseInfo {
  version: string;
  currentVersion: string;
  hasUpdate: boolean;
  title: string;
  body: string;
  publishedAt: string;
  downloadUrl: string;
  assetName: string;
  sizeBytes: number;
  isPrerelease: boolean;
  htmlUrl: string;
}

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "up_to_date"
  | "error";

export interface UpdateState {
  phase: UpdatePhase;
  info: AppReleaseInfo | null;
  error: string | null;
  dialogOpen: boolean;
  lastChecked: number | null;
  setDialogOpen: (open: boolean) => void;
  checkForUpdates: (options?: { silent?: boolean }) => Promise<AppReleaseInfo | null>;
}

export const CURRENT_APP_VERSION = "1.1.1";
export const GITHUB_REPO = "TAOMA-06/grok-build-agent";

/**
 * Compare two semver strings: e.g. "1.1.1" vs "v1.2.0" -> -1 if v1 < v2, 1 if v1 > v2, 0 if equal.
 */
export function compareSemver(v1: string, v2: string): number {
  const clean1 = v1.replace(/^v/, "").trim();
  const clean2 = v2.replace(/^v/, "").trim();
  const parts1 = clean1.split(/[-+.]/).map((p) => parseInt(p, 10) || 0);
  const parts2 = clean2.split(/[-+.]/).map((p) => parseInt(p, 10) || 0);
  const len = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < len; i++) {
    const p1 = parts1[i] ?? 0;
    const p2 = parts2[i] ?? 0;
    if (p1 < p2) return -1;
    if (p1 > p2) return 1;
  }
  return 0;
}

/**
 * Query GitHub Releases API for the latest version and asset metadata.
 */
export async function fetchLatestGitHubRelease(
  currentVersion = CURRENT_APP_VERSION,
  repo = GITHUB_REPO,
): Promise<AppReleaseInfo> {
  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub Release API returned status ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as {
    tag_name: string;
    name: string;
    body: string;
    published_at: string;
    html_url: string;
    prerelease: boolean;
    assets?: Array<{
      name: string;
      browser_download_url: string;
      size: number;
    }>;
  };

  const remoteTag = data.tag_name || "";
  const remoteVer = remoteTag.replace(/^v/, "");
  const hasUpdate = compareSemver(currentVersion, remoteVer) < 0;

  // Find universal dmg or app archive asset
  const assets = data.assets || [];
  const macAsset =
    assets.find((a) => a.name.includes("universal.dmg") || a.name.endsWith(".dmg")) ||
    assets.find((a) => a.name.endsWith(".tar.gz") || a.name.endsWith(".zip")) ||
    assets[0];

  return {
    version: remoteVer,
    currentVersion,
    hasUpdate,
    title: data.name || `Release ${remoteTag}`,
    body: data.body || "No changelog provided for this release.",
    publishedAt: data.published_at,
    downloadUrl: macAsset?.browser_download_url || data.html_url,
    assetName: macAsset?.name || `Grok.Build.Desktop_${remoteVer}_universal.dmg`,
    sizeBytes: macAsset?.size || 45 * 1024 * 1024,
    isPrerelease: Boolean(data.prerelease),
    htmlUrl: data.html_url,
  };
}

export const useAppUpdater = create<UpdateState>((set, get) => ({
  phase: "idle",
  info: null,
  error: null,
  dialogOpen: false,
  lastChecked: null,

  setDialogOpen: (open: boolean) => {
    set({ dialogOpen: open });
  },

  checkForUpdates: async (options = { silent: false }) => {
    set({ phase: "checking", error: null });
    try {
      const info = await fetchLatestGitHubRelease(CURRENT_APP_VERSION, GITHUB_REPO);
      const isAvailable = info.hasUpdate;
      set({
        info,
        lastChecked: Date.now(),
        phase: isAvailable ? "available" : "up_to_date",
        // Only open dialog automatically if there is an update and not suppressed
        dialogOpen: isAvailable && !options.silent ? true : get().dialogOpen,
      });
      return info;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      set({ phase: "error", error: errorMsg });
      return null;
    }
  },
}));
