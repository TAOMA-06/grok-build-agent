import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyLocalePreference, t, useTranslation } from "../../i18n";
import { DesktopBridgeContext, type DesktopBridge } from "../../platform/DesktopBridge";
import { mockDesktopBridge } from "../../platform/mockBridge";
import { defaultSettings, useAppStore } from "../../store";
import { SettingsDialog } from "./SettingsDialog";

function renderDialog(bridge: DesktopBridge) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function LocaleObserver({ children }: { children: ReactNode }) {
    useTranslation();
    return children;
  }
  return render(
    <QueryClientProvider client={client}>
      <DesktopBridgeContext.Provider value={bridge}>
        <LocaleObserver>
          <SettingsDialog open onOpenChange={vi.fn()} />
        </LocaleObserver>
      </DesktopBridgeContext.Provider>
    </QueryClientProvider>,
  );
}

describe("SettingsDialog", () => {
  beforeEach(() => {
    applyLocalePreference("zh-CN");
    useAppStore.setState({
      settings: { ...defaultSettings(), locale: "zh-CN", privacyMode: "strict" },
    });
  });

  it("applies and persists English immediately from the default settings page", async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    renderDialog({ ...mockDesktopBridge, saveSettings });

    fireEvent.change(screen.getByRole("combobox", { name: "语言" }), {
      target: { value: "en" },
    });

    await waitFor(() => {
      expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ locale: "en" }));
    });
    expect(t.settings).toBe("Settings");
    expect(screen.getByRole("checkbox", { name: "Private Chat" })).toBeChecked();
  });

  it("shows Private Chat on the default page, enables it by default, and persists changes immediately", async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    renderDialog({ ...mockDesktopBridge, saveSettings });

    const privateChat = screen.getByRole("checkbox", { name: "Private Chat（私密会话）" });
    expect(privateChat).toBeChecked();
    fireEvent.click(privateChat);

    await waitFor(() => {
      expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ privateChat: false }));
    });
    expect(screen.getByText("已关闭 · 新任务会保存在本机，用于历史记录和崩溃恢复。")).toBeInTheDocument();
  });

  it("shows Privacy Mode on by default and syncs to the agent when toggled", async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const setCodingDataPrivacy = vi.fn().mockResolvedValue({ ok: true, privacyMode: false });
    renderDialog({ ...mockDesktopBridge, saveSettings, setCodingDataPrivacy });

    const privacyMode = screen.getByRole("checkbox", { name: "Privacy Mode（隐私模式）" });
    expect(privacyMode).toBeChecked();
    fireEvent.click(privacyMode);

    await waitFor(() => {
      expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ codingDataPrivacy: false }));
      expect(setCodingDataPrivacy).toHaveBeenCalledWith(false);
    });
  });
});
