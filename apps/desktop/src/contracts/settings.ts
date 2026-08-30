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
  schemaVersion: 10;
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
  /** Automatically check for desktop application updates from GitHub Releases on launch. */
  autoCheckAppUpdates: boolean;
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
  /**
   * Absolute path to a secondary ACP-compatible agent binary.
   * Mixed planning uses this as the Plan-mode planner (typically Codex).
   * Preferred runtime `generic-acp` uses it for the whole task.
   */
  secondaryAcpPath: string;
  /** Preferred runtime adapter: `grok-acp` (default) or `generic-acp`. */
  preferredAdapterId: "grok-acp" | "generic-acp" | string;
  /**
   * When true, Plan-mode tasks start on the secondary ACP (planner, e.g. Codex)
   * and Grok implements after approval. Executor for Agent/Goal stays Grok.
   */
  mixedPlanning: boolean;
  /**
   * Optional alternate model id for one-shot turn recovery when adapter
   * fallback is unavailable. Session-scoped only — never writes Settings.model.
   */
  fallbackModelId: string;
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
    schemaVersion: 10,
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
    autoCheckAppUpdates: true,
    alwaysApprove: false,
    strictTerminal: false,
    useHarness: true,
    combineQueuedPrompts: false,
    disableImageTools: false,
    disableVideoTools: false,
    secondaryAcpPath: "",
    preferredAdapterId: "grok-acp",
    mixedPlanning: false,
    fallbackModelId: "",
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
  const secondaryAcpPath =
    typeof (settings as { secondaryAcpPath?: string }).secondaryAcpPath === "string"
      ? (settings as { secondaryAcpPath: string }).secondaryAcpPath
      : "";
  const preferredAdapterIdRaw =
    typeof (settings as { preferredAdapterId?: string }).preferredAdapterId === "string"
      ? (settings as { preferredAdapterId: string }).preferredAdapterId.trim()
      : "";
  const preferredAdapterId =
    preferredAdapterIdRaw === "generic-acp" ? "generic-acp" : "grok-acp";
  const fallbackModelId =
    typeof (settings as { fallbackModelId?: string }).fallbackModelId === "string"
      ? (settings as { fallbackModelId: string }).fallbackModelId.trim()
      : "";
  const mixedPlanning = (settings as { mixedPlanning?: boolean }).mixedPlanning === true;
  if (
    settings.schemaVersion === 10 &&
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
    disableVideoTools === Boolean(settings.disableVideoTools) &&
    secondaryAcpPath === (settings.secondaryAcpPath ?? "") &&
    preferredAdapterId === (settings.preferredAdapterId || "grok-acp") &&
    mixedPlanning === Boolean(settings.mixedPlanning) &&
    fallbackModelId === ((settings as { fallbackModelId?: string }).fallbackModelId ?? "").trim()
  ) return settings;
  return {
    ...settings,
    schemaVersion: 10,
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
    secondaryAcpPath,
    preferredAdapterId,
    mixedPlanning,
    fallbackModelId,
  };
}

/**
 * Resolve the ACP executable for the preferred runtime adapter.
 * Secondary ACP uses `secondaryAcpPath`; primary uses CLI override / grok path.
 */
export function resolveAgentExecutable(settings: Settings): string | null {
  if (settings.preferredAdapterId === "generic-acp") {
    const secondary = settings.secondaryAcpPath.trim();
    return secondary || null;
  }
  const primary = (settings.cliPathOverride || settings.grokPath).trim();
  return primary || null;
}

/**
 * One-shot fallback executable when the preferred adapter fails to start.
 * Returns null when no alternate path is configured or it matches the preferred path.
 */
export function resolveFallbackAgentExecutable(settings: Settings): string | null {
  const preferred = resolveAgentExecutable(settings);
  if (settings.preferredAdapterId === "generic-acp") {
    const primary = (settings.cliPathOverride || settings.grokPath).trim();
    if (!primary || primary === preferred) return null;
    return primary;
  }
  const secondary = settings.secondaryAcpPath.trim();
  if (!secondary || secondary === preferred) return null;
  return secondary;
}

/** Short label for timeline notes when a start falls back. */
export function adapterFallbackLabel(settings: Settings): string {
  if (settings.preferredAdapterId === "generic-acp") {
    return "primary Grok ACP";
  }
  return "secondary ACP";
}

export type TurnLadderStep =
  | { kind: "adapter"; grokPath: string; label: string }
  | { kind: "model"; modelId: string };

/**
 * Ordered turn recovery steps: secondary ACP first (when configured), then
 * fallback model. Never mutates Settings — caller applies session overrides.
 */
export function resolveTurnLadderSteps(
  settings: Settings,
  currentModel?: string | null,
): TurnLadderStep[] {
  const steps: TurnLadderStep[] = [];
  const fallbackExe = resolveFallbackAgentExecutable(settings);
  if (fallbackExe) {
    steps.push({
      kind: "adapter",
      grokPath: fallbackExe,
      label: adapterFallbackLabel(settings),
    });
  }
  const fallbackModel = settings.fallbackModelId.trim();
  const current = (currentModel || settings.model).trim();
  if (fallbackModel && fallbackModel !== current) {
    steps.push({ kind: "model", modelId: fallbackModel });
  }
  return steps;
}

/** First ladder step only — prefer `resolveTurnLadderSteps` for multi-step recovery. */
export function resolveTurnLadderStep(
  settings: Settings,
  currentModel?: string | null,
): TurnLadderStep | null {
  return resolveTurnLadderSteps(settings, currentModel)[0] ?? null;
}

/** Skip ladder for cancel / permission noise — those are not runtime failures. */
export function isTurnLadderEligibleError(error: unknown): boolean {
  const text = String(error);
  if (!text.trim()) return false;
  if (/cancelled|canceled|aborted|user stop/i.test(text)) return false;
  if (/permission|not allowed|denied by policy/i.test(text)) return false;
  return true;
}
