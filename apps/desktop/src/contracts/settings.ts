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
  schemaVersion: 9;
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
  /** Whether this installation explicitly chose an account-level retention preference. */
  codingDataPrivacyConfigured: boolean;
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
  /**
   * When true, Host terminal policy only auto-allows pure inspection tools
   * (rg/git status/etc.). Project checks like `cargo test` / `npm test` require confirmation.
   */
  strictTerminal: boolean;
  useHarness: boolean;
  /**
   * When true, Desktop asks Grok to batch queued follow-ups into one model turn
   * (CLI `combine_queued_prompts`, 0.2.109+). Existing installs keep false until enabled.
   */
  combineQueuedPrompts: boolean;
  /** Strip image generation tools/slash commands from the spawned CLI process. */
  disableImageTools: boolean;
  /** Strip video generation tools/slash commands from the spawned CLI process. */
  disableVideoTools: boolean;
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
    schemaVersion: 9,
    grokPath: "",
    cliPathOverride: "",
    model: "grok-4.5",
    defaultReasoningEffort: "medium",
    focusMode: "balanced",
    privacyMode: "strict",
    codingDataPrivacy: true,
    codingDataPrivacyConfigured: true,
    privateChat: false,
    defaultMode: "agent",
    permissionPolicy: "workspace_edit",
    autoUpdateCli: true,
    alwaysApprove: false,
    strictTerminal: false,
    useHarness: true,
    combineQueuedPrompts: false,
    disableImageTools: false,
    disableVideoTools: false,
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
  // New installations opt out by default. Existing installs keep their account
  // setting untouched until they explicitly choose a value in Settings.
  const hasCodingDataPrivacy = Object.prototype.hasOwnProperty.call(
    settings,
    "codingDataPrivacy",
  );
  const codingDataPrivacy =
    (settings as { codingDataPrivacy?: boolean }).codingDataPrivacy === true;
  const hasCodingDataPrivacyConfigured = Object.prototype.hasOwnProperty.call(
    settings,
    "codingDataPrivacyConfigured",
  );
  const codingDataPrivacyConfigured = hasCodingDataPrivacyConfigured
    ? (settings as { codingDataPrivacyConfigured?: boolean }).codingDataPrivacyConfigured === true
    : hasCodingDataPrivacy;
  // Durable coding default: only true when explicitly enabled.
  const privateChat = settings.privateChat === true;
  // Keep legacy installs on their existing behavior; new installs use the default
  // supplied by defaultSettings above.
  const useHarness = (settings as { useHarness?: boolean }).useHarness === true;
  const strictTerminal = (settings as { strictTerminal?: boolean }).strictTerminal === true;
  const combineQueuedPrompts =
    (settings as { combineQueuedPrompts?: boolean }).combineQueuedPrompts === true;
  const disableImageTools =
    (settings as { disableImageTools?: boolean }).disableImageTools === true;
  const disableVideoTools =
    (settings as { disableVideoTools?: boolean }).disableVideoTools === true;
  if (
    settings.schemaVersion === 9 &&
    defaultReasoningEffort === settings.defaultReasoningEffort &&
    focusMode === settings.focusMode &&
    privacyMode === settings.privacyMode &&
    codingDataPrivacy === settings.codingDataPrivacy &&
    codingDataPrivacyConfigured === settings.codingDataPrivacyConfigured &&
    privateChat === settings.privateChat &&
    useHarness === settings.useHarness &&
    strictTerminal === Boolean(settings.strictTerminal) &&
    combineQueuedPrompts === Boolean(settings.combineQueuedPrompts) &&
    disableImageTools === Boolean(settings.disableImageTools) &&
    disableVideoTools === Boolean(settings.disableVideoTools)
  ) return settings;
  return {
    ...settings,
    schemaVersion: 9,
    defaultReasoningEffort,
    focusMode,
    privacyMode,
    codingDataPrivacy,
    codingDataPrivacyConfigured,
    privateChat,
    useHarness,
    strictTerminal,
    combineQueuedPrompts,
    disableImageTools,
    disableVideoTools,
  };
}
