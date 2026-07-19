import { useCallback, useEffect, useState } from "react";
import { BootstrapScreen } from "./features/shell/BootstrapScreen";
import { AppShell } from "./features/shell/AppShell";
import { bootstrapStateFromHealth } from "./features/shell/bootstrap";
import { normalizeSettings } from "./contracts";
import { applyLocalePreference, t, useTranslation } from "./i18n";
import { useDesktopBridge } from "./platform/DesktopBridge";
import { useAppStore } from "./store";
import type { BootstrapState } from "./types";
import "./App.css";
import "./features/shell/shell.css";
import "./features/shell/shell-v2.css";

export default function App() {
  useTranslation();
  const bridge = useDesktopBridge();
  const {
    settings,
    replaceSettings,
    settingsLoaded,
    setSettingsLoaded,
    setHealth,
  } = useAppStore();
  const [bootstrap, setBootstrap] = useState<BootstrapState>({ status: "checking" });

  const refreshBootstrap = useCallback(async () => {
    setBootstrap({ status: "checking" });
    try {
      const current = useAppStore.getState().settings;
      const health = await bridge.runtimeHealth(current.cliPathOverride || current.grokPath || undefined);
      setHealth(health);
      setBootstrap(bootstrapStateFromHealth(health));
    } catch (error) {
      setBootstrap({ status: "error", message: t.runtimeCheckFailed, detail: String(error) });
    }
  }, [bridge, setHealth]);

  useEffect(() => {
    let unsubs: Array<() => void> = [];
    let cancelled = false;
    void (async () => {
      try {
        await bridge.ensureAgentHost();
        if (cancelled) return;
        const loaded = await bridge.loadSettings();
        if (cancelled) return;
        let s = normalizeSettings(loaded);
        applyLocalePreference(s.locale);
        replaceSettings(s);
        setSettingsLoaded(true);
        if (s.defaultReasoningEffort !== loaded.defaultReasoningEffort) {
          await bridge.saveSettings(s);
        }
        const health = await bridge.runtimeHealth(s.cliPathOverride || s.grokPath || undefined);
        if (cancelled) return;
        setHealth(health);
        const nextBootstrap = bootstrapStateFromHealth(health);
        setBootstrap(nextBootstrap);
        if (nextBootstrap.status === "ready") {
          if (!s.onboardingDone) {
            const migrated = { ...s, onboardingDone: true };
            replaceSettings(migrated);
            await bridge.saveSettings(migrated);
            s = migrated;
          }
        }
        if (cancelled) return;
        unsubs = await bridge.subscribeEvents();
      } catch (e) {
        setBootstrap({ status: "error", message: t.appStartFailed, detail: String(e) });
        setSettingsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
      for (const u of unsubs) u();
    };
  }, [bridge, replaceSettings, setSettingsLoaded, setHealth]);

  if (!settingsLoaded) {
    return (
      <div className="onboarding">
        <p className="muted">…</p>
      </div>
    );
  }

  if (bootstrap.status !== "ready" || !settings.onboardingDone) {
    return <BootstrapScreen state={bootstrap} onRefresh={refreshBootstrap} />;
  }

  return <AppShell />;
}
