import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { defaultSettings, useAppStore } from "../store";
import { applyLocalePreference, resolveLocale, t, useTranslation } from "./index";

describe("locale selection", () => {
  it("uses Simplified Chinese for a Chinese system locale", () => {
    expect(resolveLocale("system", "zh-CN")).toBe("zh-CN");
  });

  it("switches all shared copy through the same dictionary keys", () => {
    applyLocalePreference("zh-CN");
    expect(t.connect).toBe("连接");
    applyLocalePreference("en");
    expect(t.connect).toBe("Connect");
  });

  it("reacts to a settings language change without restarting", () => {
    useAppStore.setState({ settings: { ...defaultSettings(), locale: "en" } });
    const { result } = renderHook(() => useTranslation());
    expect(result.current.t.settings).toBe("Settings");
    act(() => useAppStore.getState().setSettings({ locale: "zh-CN" }));
    expect(result.current.t.settings).toBe("设置");
    expect(document.documentElement.lang).toBe("zh-CN");
  });
});
