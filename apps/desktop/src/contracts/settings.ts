/**
 * App settings and onboarding contracts.
 * API keys move to Keychain in T03/T12 — never log secret values.
 */

export type ThemeId = "dark" | "light" | "system" | string;

export type Settings = {
  /** Versioned renderer/host settings contract. */
  schemaVersion: 3;
  grokPath: string;
  /** Optional advanced override. Empty means use CLI discovery. */
  cliPathOverride: string;
  model: string;
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
    schemaVersion: 3,
    grokPath: "",
    cliPathOverride: "",
    model: "grok-build",
    defaultMode: "agent",
    permissionPolicy: "workspace_edit",
    autoUpdateCli: true,
    alwaysApprove: false,
    useHarness: false,
    sandbox: "workspace",
    cwd: "",
    onboardingDone: false,
    apiKey: "",
    theme: "light",
    locale: "system",
    compactMode: false,
    multilineMode: false,
    showTimestamps: false,
  };
}
import type { SandboxMode } from "./runtime";
