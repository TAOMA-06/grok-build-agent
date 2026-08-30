import type { ThemeId } from "../../contracts/settings";

export type ResolvedTheme = "light" | "dark";

export function resolveTheme(theme: ThemeId, prefersLight: boolean): ResolvedTheme {
  if (theme === "system") return prefersLight ? "light" : "dark";
  return theme === "light" ? "light" : "dark";
}
