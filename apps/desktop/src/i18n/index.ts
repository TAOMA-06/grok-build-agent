import { t as en, type Translation } from "./en";
import { zhCN } from "./zh-CN";
import { useEffect } from "react";
import { useAppStore } from "../store";

export type LocalePreference = "system" | "en" | "zh-CN";
export type ResolvedLocale = "en" | "zh-CN";

let current: Translation = en;

export function resolveLocale(
  preference: LocalePreference,
  systemLanguage = typeof navigator === "undefined" ? "en" : navigator.language,
): ResolvedLocale {
  if (preference !== "system") return preference;
  return systemLanguage.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function applyLocalePreference(preference: LocalePreference): ResolvedLocale {
  const resolved = resolveLocale(preference);
  current = resolved === "zh-CN" ? zhCN : en;
  return resolved;
}

export function translate(
  key: keyof Translation,
  params: Record<string, string | number> = {},
): string {
  const value = current[key];
  const template = typeof value === "string" ? value : String(key);
  return Object.entries(params).reduce(
    (text, [name, replacement]) => text.split(`{${name}}`).join(String(replacement)),
    template,
  );
}

export function useTranslation() {
  const preference = useAppStore((state) => state.settings.locale);
  const locale = applyLocalePreference(preference);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return { t, locale, translate };
}

/**
 * Components keep the existing `t.key` API. The app rerenders when settings
 * change, while this proxy resolves copy from the selected locale.
 */
export const t: Translation = new Proxy({} as Translation, {
  get(_target, key) {
    return current[key as keyof Translation];
  },
});

export const localeOptions: ReadonlyArray<{
  value: LocalePreference;
  labelKey: "languageSystem" | "language";
}> = [
  { value: "system", labelKey: "languageSystem" },
  { value: "en", labelKey: "language" },
  { value: "zh-CN", labelKey: "language" },
];
