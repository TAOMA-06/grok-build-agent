/**
 * App settings and onboarding contracts.
 * API keys move to Keychain in T03/T12 — never log secret values.
 */

import { sanitizeDefaultReasoningEffort } from "./model";
import type { SandboxMode } from "./runtime";

export type ThemeId = "dark" | "light" | "system" | string;

/** How aggressively the desktop host refreshes the task contract. */
export type FocusMode = "economy" | "balanced";

/** Local-only outbound privacy handling. This does not change xAI service settings. */
export type PrivacyMode = "strict" | "standard";

export type Settings = {
  /** Versioned renderer/host settings contract. */
  schemaVersion: 7;
  grokPath: string;
  /** Optional advanced override. Empty means use CLI discovery. */
  cliPathOverride: string;
  model: string;
  /**
   * Default reasoning effort for new sessions (Grok `--reasoning-effort`).
   * Empty means use the model catalog default / CLI config.
   */
  defaultReasoningEffort: string;
  /** Short task anchors cost less context; balanced refreshes the complete contract more often. */
  focusMode: FocusMode;
  /** Strict mode redacts detected secrets before they are persisted or sent. */
  privacyMode: PrivacyMode;
  /**
   * Grok Privacy Mode preference (account-level coding data retention opt-out).
   * When true, the desktop app asks the connected Grok agent to enable Privacy Mode
   * via `x.ai/privacy/setCodingDataRetention` (`codingDataRetentionOptOut: true`),
   * matching CLI `/privacy opt-out`. Requires login; ZDR/admin policies may lock it.
   */
  codingDataPrivacy: boolean;
  /**
   * Local-only private sessions skip durable history (drafts, transcript cache,
   * task contracts, verification). Default off so coding tasks stay durable and
   * verifiable. Separate from account-level Grok Privacy Mode above.
   */
  privateChat: boolean;
  defaultMode: import("./mode").TaskMode;
  permissionPolicy: "workspace_edit" | "ask_all" | "full_auto";
  autoUpdateCli: boolean;
  alwaysApprove: boolean;
  useHarness: boolean;
  sandbox: SandboxMode;
  cwd: string;
  onboardingDone: boolean;
  /**
   * @deprecated Prefer Keychain / OAuth. Present for prototype migration only.
   * Must not appear in logs.
   */
  apiKey: string;
  theme: ThemeId;
  locale: "system" | "en" | "zh-CN";
  compactMode: boolean;
  multilineMode: boolean;
  showTimestamps: boolean;
};

export type RightPanel =
  | "tasks"
  | "plan"
  | "health"
  | "logs"
  | "settings"
  | "diff"
  | "worktree"
  | "plugins"
  | "diagnostics";

/** Top-level workbench surface (chat spine vs full-width capability center). */
export type WorkbenchSurface = "chat" | "capabilities" | "settings";

export type OnboardingStep =
  | "welcome"
  | "cli_check"
  | "cli_install"
  | "auth"
  | "workspace"
  | "done";

export function defaultSettings(): Settings {
  return {
    schemaVersion: 7,
    grokPath: "",
    cliPathOverride: "",
    model: "grok-build",
    defaultReasoningEffort: "medium",
    focusMode: "balanced",
    privacyMode: "strict",
    codingDataPrivacy: true,
    privateChat: false,
    defaultMode: "agent",
    permissionPolicy: "workspace_edit",
    autoUpdateCli: true,
    alwaysApprove: false,
    useHarness: true,
    sandbox: "workspace",
    cwd: "",
    onboardingDone: false,
    apiKey: "",
    theme: "dark",
    locale: "system",
    compactMode: false,
    multilineMode: false,
    showTimestamps: false,
  };
}

/** Clamp persisted settings fields that can go stale across CLI/catalog changes. */
export function normalizeSettings(settings: Settings): Settings {
  const defaultReasoningEffort = sanitizeDefaultReasoningEffort(
    settings.defaultReasoningEffort,
  );
  const focusMode: FocusMode = settings.focusMode === "economy" ? "economy" : "balanced";
  const privacyMode: PrivacyMode = settings.privacyMode === "standard" ? "standard" : "strict";
  // Missing / legacy fields default to Privacy Mode ON (coding data not used for training).
  const codingDataPrivacy = (settings as { codingDataPrivacy?: boolean }).codingDataPrivacy !== false;
  // Durable coding default: only true when explicitly enabled.
  const privateChat = settings.privateChat === true;
  const useHarness = settings.useHarness !== false;
  if (
    settings.schemaVersion === 7 &&
    defaultReasoningEffort === settings.defaultReasoningEffort &&
    focusMode === settings.focusMode &&
    privacyMode === settings.privacyMode &&
    codingDataPrivacy === settings.codingDataPrivacy &&
    privateChat === settings.privateChat &&
    useHarness === settings.useHarness
  ) return settings;
  return {
    ...settings,
    schemaVersion: 7,
    defaultReasoningEffort,
    focusMode,
    privacyMode,
    codingDataPrivacy,
    privateChat,
    useHarness,
  };
}
