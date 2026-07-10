/**
 * App settings and onboarding contracts.
 * API keys move to Keychain in T03/T12 — never log secret values.
 */

export type ThemeId = "dark" | "light" | "system" | string;

export type Settings = {
  grokPath: string;
  model: string;
  alwaysApprove: boolean;
  useHarness: boolean;
  cwd: string;
  onboardingDone: boolean;
  /**
   * @deprecated Prefer Keychain / OAuth. Present for prototype migration only.
   * Must not appear in logs.
   */
  apiKey: string;
  theme: ThemeId;
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

export type OnboardingStep =
  | "welcome"
  | "cli_check"
  | "cli_install"
  | "auth"
  | "workspace"
  | "done";

export function defaultSettings(): Settings {
  return {
    grokPath: "",
    model: "grok-build",
    alwaysApprove: false,
    useHarness: true,
    cwd: "",
    onboardingDone: false,
    apiKey: "",
    theme: "dark",
  };
}
