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
  schemaVersion: 5;
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
    schemaVersion: 5,
    grokPath: "",
    cliPathOverride: "",
    model: "grok-build",
    defaultReasoningEffort: "medium",
    focusMode: "balanced",
    privacyMode: "strict",
    defaultMode: "agent",
    permissionPolicy: "workspace_edit",
    autoUpdateCli: true,
    alwaysApprove: false,
    useHarness: false,
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
  if (
    settings.schemaVersion === 5 &&
    defaultReasoningEffort === settings.defaultReasoningEffort &&
    focusMode === settings.focusMode &&
    privacyMode === settings.privacyMode
  ) return settings;
  return {
    ...settings,
    schemaVersion: 5,
    defaultReasoningEffort,
    focusMode,
    privacyMode,
  };
}
