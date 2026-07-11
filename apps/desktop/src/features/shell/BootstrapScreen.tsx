import { Check, CircleAlert, Download, LoaderCircle, LogIn, RefreshCw, TerminalSquare } from "lucide-react";
import { useState } from "react";
import type { BootstrapState } from "../../types";
import { useDesktopBridge } from "../../platform/DesktopBridge";
import { useAppStore } from "../../store";
import { t } from "../../i18n";

export function BootstrapScreen({ state, onRefresh }: { state: BootstrapState; onRefresh: () => Promise<void> }) {
  const bridge = useDesktopBridge();
  const settings = useAppStore((store) => store.settings);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  async function install() {
    setBusy(true);
    setLog([]);
    try {
      const result = await bridge.installCli();
      setLog(result.map((item) => `${item.ok ? "✓" : "×"} ${item.detail}`));
      await onRefresh();
    } catch (error) {
      setLog([String(error)]);
    } finally {
      setBusy(false);
    }
  }

  async function login() {
    setBusy(true);
    setLog([]);
    try {
      const message = await bridge.runLogin(settings.cliPathOverride || settings.grokPath || undefined);
      if (message) setLog([message]);
      await onRefresh();
    } catch (error) {
      setLog([String(error)]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="gb-bootstrap">
      <div className="gb-bootstrap-brand"><span>G</span><strong>Grok Build</strong></div>
      <section className="gb-bootstrap-card">
        {state.status === "checking" && <><LoaderCircle className="gb-spin" size={22} /><h1>{t.bootstrapCheckingTitle}</h1><p>{t.bootstrapCheckingHint}</p></>}
        {state.status === "needs_cli" && <><div className="gb-bootstrap-icon"><TerminalSquare size={22} /></div><h1>{t.bootstrapInstallTitle}</h1><p>{t.bootstrapInstallHint}</p><button type="button" className="gb-bootstrap-primary" disabled={busy} onClick={() => void install()}><Download size={16} />{busy ? t.installing : t.installOfficial}</button></>}
        {state.status === "needs_auth" && <><div className="gb-bootstrap-icon"><LogIn size={22} /></div><h1>{t.bootstrapLoginTitle}</h1><p>{t.bootstrapLoginHint}</p><button type="button" className="gb-bootstrap-primary" disabled={busy} onClick={() => void login()}><LogIn size={16} />{busy ? t.waitingLogin : t.continueBrowser}</button></>}
        {state.status === "error" && <><div className="gb-bootstrap-icon error"><CircleAlert size={22} /></div><h1>{t.bootstrapErrorTitle}</h1><p>{state.message}</p>{state.detail && <pre className="gb-bootstrap-log">{state.detail}</pre>}<button type="button" className="gb-bootstrap-primary" onClick={() => void onRefresh()}><RefreshCw size={16} />{t.tryAgain}</button></>}
        {log.length > 0 && <pre className="gb-bootstrap-log">{log.join("\n")}</pre>}
        {(state.status === "needs_cli" || state.status === "needs_auth") && <div className="gb-bootstrap-trust"><Check size={14} /> {t.officialRuntime}</div>}
      </section>
    </main>
  );
}
