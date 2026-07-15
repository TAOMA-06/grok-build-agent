import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { useQuery } from "@tanstack/react-query";
import { Bot, Info, Puzzle, RefreshCw, Settings2, ShieldCheck, Stethoscope, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useEffect } from "react";
import { McpManager } from "../mcp/McpManager";
import { applyLocalePreference, t } from "../../i18n";
import { normalizeSettings } from "../../contracts";
import { useDesktopBridge } from "../../platform/DesktopBridge";
import { useAppStore } from "../../store";
import type { Settings } from "../../types";

export type SettingsTab = "general" | "agent" | "permissions" | "extensions" | "diagnostics" | "about";

function compatibilityVendorLabel(vendor: string) {
  const normalized = vendor.trim().toLowerCase();
  if (normalized === "claude") return "Claude Code";
  if (normalized === "codex") return "Codex";
  if (normalized === "cursor") return "Cursor";
  return vendor;
}

function compatibilitySourceLabel(source?: string | null) {
  if (source === "default") return t.compatibilityDefault;
  if (source === "remoteOrDefault") return t.compatibilityRemoteOrDefault;
  return source || t.compatibilityInherited;
}

function compatibilityStateLabel(enabled?: boolean | null) {
  if (enabled === true) return t.compatibilityEnabled;
  if (enabled === false) return t.compatibilityDisabled;
  return t.compatibilityInherited;
}

export function SettingsDialog({
  open,
  onOpenChange,
  initialTab = "general",
  onReloadAgent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: SettingsTab;
  onReloadAgent?: () => void | Promise<void>;
}) {
  const bridge = useDesktopBridge();
  const settings = useAppStore((state) => state.settings);
  const replaceSettings = useAppStore((state) => state.replaceSettings);
  const [draft, setDraft] = useState(() => normalizeSettings(settings));
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [doctorAction, setDoctorAction] = useState<string | null>(null);
  const [bundlePreview, setBundlePreview] = useState<string | null>(null);
  useEffect(() => {
    if (open) setTab(initialTab);
  }, [initialTab, open]);
  const capabilitiesQuery = useQuery({
    queryKey: ["capabilities", settings.cliPathOverride || settings.grokPath, settings.cwd],
    queryFn: () => bridge.inspectCapabilities(
      settings.cliPathOverride || settings.grokPath || undefined,
      settings.cwd || null,
    ),
    enabled: open,
  });
  const modelsQuery = useQuery({
    queryKey: ["models", draft.cliPathOverride || draft.grokPath],
    queryFn: () => bridge.listModels(draft.cliPathOverride || draft.grokPath || undefined),
    enabled: open,
  });
  const policyRulesQuery = useQuery({
    queryKey: ["policy-rules"],
    queryFn: () => bridge.listPolicyRules(),
    enabled: open && tab === "permissions",
  });
  const doctorQuery = useQuery({
    queryKey: ["doctor-status"],
    queryFn: () => bridge.doctorStatus(),
    enabled: open && tab === "diagnostics",
  });
  const externalCompatibility = capabilitiesQuery.data?.externalCompat ?? null;
  const compatibilityVendors = externalCompatibility
    ? [...new Set(externalCompatibility.cells.map((cell) => cell.vendor.toLowerCase()))]
    : [];

  function patch(next: Partial<Settings>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  async function save() {
    setSaving(true);
    try {
      const next = normalizeSettings(draft);
      replaceSettings(next);
      applyLocalePreference(next.locale);
      await bridge.saveSettings(next);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (next) setDraft(normalizeSettings(settings)); onOpenChange(next); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="gb-dialog-overlay" />
        <Dialog.Content className="gb-settings-dialog">
          <div className="gb-settings-head">
            <div><Dialog.Title>{t.settings}</Dialog.Title><Dialog.Description>{t.settingsDescription}</Dialog.Description></div>
            <Dialog.Close asChild><button type="button" className="gb-icon-button" aria-label={t.closeSettings}><X size={17} /></button></Dialog.Close>
          </div>
          <Tabs.Root className="gb-settings-tabs" value={tab} onValueChange={(value) => setTab(value as SettingsTab)}>
            <Tabs.List>
              <Tabs.Trigger value="general"><Settings2 size={15} /> {t.general}</Tabs.Trigger>
              <Tabs.Trigger value="agent"><Bot size={15} /> {t.agent}</Tabs.Trigger>
              <Tabs.Trigger value="permissions"><ShieldCheck size={15} /> {t.permissions}</Tabs.Trigger>
              <Tabs.Trigger value="extensions"><Puzzle size={15} /> {t.extensions}</Tabs.Trigger>
              <Tabs.Trigger value="diagnostics"><Stethoscope size={15} /> {t.diagnostics}</Tabs.Trigger>
              <Tabs.Trigger value="about"><Info size={15} /> {t.about}</Tabs.Trigger>
            </Tabs.List>
            <div className="gb-settings-content">
              <Tabs.Content value="general">
                <h3>{t.appearance}</h3>
                <label><span>{t.theme}<small>{t.themeHint}</small></span><select value={draft.theme} onChange={(event) => patch({ theme: event.target.value })}><option value="dark">{t.themeDark}</option><option value="light">{t.themeLight}</option><option value="system">{t.themeSystem}</option></select></label>
                <label><span>{t.language}<small>{t.languageHint}</small></span><select value={draft.locale} onChange={(event) => patch({ locale: event.target.value as Settings["locale"] })}><option value="system">{t.languageSystem}</option><option value="en">{t.languageEnglish}</option><option value="zh-CN">{t.languageChinese}</option></select></label>
              </Tabs.Content>
              <Tabs.Content value="permissions">
                <div className="gb-settings-section-head"><h3>{t.permissions}</h3><button type="button" className="gb-icon-button" aria-label={t.refresh} onClick={() => void policyRulesQuery.refetch()}><RefreshCw size={14} /></button></div>
                <p className="gb-settings-copy">Project approvals are exact-action rules. Critical operations always require confirmation.</p>
                <div className="gb-capability-groups">
                  <section>
                    <header><strong>{t.permissions}</strong><span>{policyRulesQuery.data?.length ?? 0}</span></header>
                    {policyRulesQuery.isLoading && <p>{t.readingCapabilities}</p>}
                    {policyRulesQuery.data?.length === 0 && <p>{t.noneReported}</p>}
                    {policyRulesQuery.data?.map((rule) => (
                      <div key={rule.ruleId}>
                        <span><b>{rule.action.argv.join(" ") || rule.action.tool}</b><small>{rule.scope} · {rule.action.risk} · {rule.workspaceId}</small></span>
                        <button type="button" className="gb-icon-button" aria-label={`Delete ${rule.action.tool} rule`} onClick={() => void bridge.deletePolicyRule(rule.ruleId).then(() => policyRulesQuery.refetch())}><Trash2 size={13} /></button>
                      </div>
                    ))}
                  </section>
                </div>
              </Tabs.Content>
              <Tabs.Content value="agent">
                <h3>{t.newTasks}</h3>
                <label><span>{t.defaultModel}<small>{t.defaultModelHint}</small></span><select value={draft.model} onChange={(event) => patch({ model: event.target.value })}>{!modelsQuery.data?.some((model) => model.id === draft.model) && <option value={draft.model}>{draft.model}</option>}{modelsQuery.data?.map((model) => <option value={model.id} key={model.id}>{model.name}</option>)}</select></label>
                <label><span>{t.defaultReasoningEffort}<small>{t.defaultReasoningEffortHint}</small></span><select value={draft.defaultReasoningEffort} onChange={(event) => patch({ defaultReasoningEffort: event.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
                <label><span>{t.defaultMode}<small>{t.defaultModeHint}</small></span><select value={draft.defaultMode} onChange={(event) => patch({ defaultMode: event.target.value as Settings["defaultMode"] })}><option value="agent">{t.modeAgent}</option><option value="plan">{t.modePlan}</option><option value="goal">{t.modeGoal}</option></select></label>
                <label><span>{t.focusMode}<small>{t.focusModeHint}</small></span><select value={draft.focusMode} onChange={(event) => patch({ focusMode: event.target.value as Settings["focusMode"] })}><option value="economy">{t.focusEconomy} · {t.focusEconomyHint}</option><option value="balanced">{t.focusBalanced} · {t.focusBalancedHint}</option></select></label>
                <label className="gb-switch-row"><span>{t.privacyShield}<small>{t.privacyShieldHint}</small></span><input type="checkbox" checked={draft.privacyMode === "strict"} onChange={(event) => patch({ privacyMode: event.target.checked ? "strict" : "standard" })} /></label>
                <p className="gb-settings-copy">{draft.privacyMode === "strict" ? t.privacyStrict : t.privacyStandard}</p>
                <p className="gb-settings-copy">{t.privacyServiceBoundary}</p>
                <label><span>{t.permissions}<small>{t.permissionsHint}</small></span><select value={draft.permissionPolicy} onChange={(event) => patch({ permissionPolicy: event.target.value as Settings["permissionPolicy"] })}><option value="workspace_edit">{t.permissionWorkspace}</option><option value="ask_all">{t.permissionAsk}</option><option value="full_auto">{t.permissionAuto}</option></select></label>
                <label className="gb-switch-row"><span>{t.keepCliUpdated}<small>{t.keepCliUpdatedHint}</small></span><input type="checkbox" checked={draft.autoUpdateCli} onChange={(event) => patch({ autoUpdateCli: event.target.checked })} /></label>
                <details className="gb-advanced-settings"><summary>{t.advanced}</summary><label><span>{t.cliPathOverride}<small>{t.cliPathHint}</small></span><input value={draft.cliPathOverride} onChange={(event) => patch({ cliPathOverride: event.target.value, grokPath: event.target.value })} placeholder={t.autoDetect} /></label><label className="gb-switch-row"><span>{t.legacyHarness}<small>{t.legacyHarnessHint}</small></span><input type="checkbox" checked={draft.useHarness} onChange={(event) => patch({ useHarness: event.target.checked })} /></label></details>
              </Tabs.Content>
              <Tabs.Content value="extensions">
                <div className="gb-settings-section-head"><h3>{t.extensions}</h3><button type="button" className="gb-icon-button" aria-label={t.refreshExtensions} onClick={() => void capabilitiesQuery.refetch()}><RefreshCw size={14} /></button></div>
                {capabilitiesQuery.isLoading && <div className="gb-settings-placeholder"><Puzzle size={24} /><strong>{t.readingCapabilities}</strong></div>}
                {capabilitiesQuery.data && (
                  <div className="gb-capability-groups">
                    {([
                      [t.skills, capabilitiesQuery.data.skills],
                      [t.plugins, capabilitiesQuery.data.plugins],
                      [t.hooks, capabilitiesQuery.data.hooks],
                      [t.mcp, capabilitiesQuery.data.mcpServers],
                    ] as const).map(([label, items]) => (
                      <section key={label}>
                        <header><strong>{label}</strong><span>{items.length}</span></header>
                        {items.length === 0
                          ? <p>{t.noneReported}</p>
                          : items.map((item) => <div key={item.id}><span><b>{item.name}</b><small>{item.description || item.source || t.enabled}</small></span><i>{item.source}</i></div>)}
                      </section>
                    ))}
                    {externalCompatibility && (
                      <section className="gb-external-compatibility">
                        <header><strong>{t.externalCompatibility}</strong><span>{externalCompatibility.cells.length}</span></header>
                        <p>{t.externalCompatibilityHint}</p>
                        {compatibilityVendors.length > 0 && (
                          <ul className="gb-compatibility-vendors">
                            {compatibilityVendors.map((vendor) => {
                              const cells = externalCompatibility.cells.filter(
                                (cell) => cell.vendor.toLowerCase() === vendor,
                              );
                              const sources = [...new Set(cells.map((cell) => compatibilitySourceLabel(cell.source)))];
                              return (
                                <li key={vendor}>
                                  <div className="gb-compatibility-vendor">
                                    <span><b>{compatibilityVendorLabel(vendor)}</b><small>{sources.join(" · ")}</small></span>
                                    <i>{cells.filter((cell) => cell.enabled === true).length}/{cells.length}</i>
                                  </div>
                                  <div className="gb-compatibility-chips">
                                    {cells.map((cell) => (
                                      <span
                                        className={`gb-compatibility-chip ${cell.enabled === true ? "enabled" : cell.enabled === false ? "disabled" : "inherited"}`}
                                        key={`${cell.vendor}:${cell.surface}`}
                                        title={`${cell.surface} · ${compatibilityStateLabel(cell.enabled)}`}
                                      >
                                        {cell.surface}
                                      </span>
                                    ))}
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </section>
                    )}
                  </div>
                )}
                {capabilitiesQuery.isError && <div className="gb-settings-placeholder"><Puzzle size={24} /><strong>{t.capabilitiesUnavailable}</strong><p>{String(capabilitiesQuery.error)}</p></div>}
                <McpManager onReloadAgent={onReloadAgent} />
              </Tabs.Content>
              <Tabs.Content value="diagnostics">
                <div className="gb-settings-section-head"><h3>{t.diagnostics}</h3><button type="button" className="gb-icon-button" aria-label={t.refresh} onClick={() => void doctorQuery.refetch()}><RefreshCw size={14} /></button></div>
                {doctorQuery.isLoading && <div className="gb-settings-placeholder"><Stethoscope size={24} /><strong>{t.runtimeHealthTitle}</strong><p>{t.readingCapabilities}</p></div>}
                {doctorQuery.data && <div className="gb-capability-groups"><section>
                  <header><strong>{t.runtimeHealthTitle}</strong><span>{doctorQuery.data.host}</span></header>
                  <div><span><b>Agent Host</b><small>PID {doctorQuery.data.pid} · protocol {doctorQuery.data.protocolVersion}</small></span><i>{doctorQuery.data.host}</i></div>
                  <div><span><b>SQLite</b><small>{doctorQuery.data.databasePath}</small></span><i>{doctorQuery.data.database}</i></div>
                  <div><span><b>Permissions</b><small>Pending requests</small></span><i>{doctorQuery.data.pendingPermissions}</i></div>
                  <div><span><b>Blob storage</b><small>Content-addressed artifacts</small></span><i>{doctorQuery.data.blobBytes} bytes</i></div>
                  <div><span><b>Strict network isolation</b><small>Grok cannot attest enforceable isolation</small></span><i>{doctorQuery.data.strictNetworkIsolation ? "protected" : "unavailable"}</i></div>
                </section></div>}
                {doctorQuery.isError && <div className="gb-settings-placeholder"><Stethoscope size={24} /><strong>{t.capabilitiesUnavailable}</strong><p>{String(doctorQuery.error)}</p></div>}
                <div className="gb-settings-section-head"><h3>Recovery</h3><div><button type="button" className="gb-button" onClick={() => {
                  if (!window.confirm("Restart the Agent Host? Running Runtime processes will be interrupted and uncertain prompts will not be retried automatically.")) return;
                  setDoctorAction("Restarting Agent Host…");
                  void bridge.restartAgentHost().then(() => {
                    setDoctorAction("Agent Host restarted.");
                    return doctorQuery.refetch();
                  }).catch((error) => setDoctorAction(`Agent Host restart failed: ${String(error)}`));
                }}>Restart Host</button><button type="button" className="gb-button" onClick={() => {
                  if (!window.confirm("Rebuild all event projections? Current projections are replaced only after validation succeeds.")) return;
                  setDoctorAction("Rebuilding projections…");
                  void bridge.rebuildProjections().then((report) => {
                    setDoctorAction(`Rebuilt ${report.projectedEntities} entities from ${report.processedEvents} events.`);
                    return doctorQuery.refetch();
                  }).catch((error) => setDoctorAction(`Projection rebuild failed: ${String(error)}`));
                }}>Rebuild projections</button></div></div>
                {doctorAction && <p className="gb-settings-copy">{doctorAction}</p>}
                <button type="button" className="gb-button" onClick={() => {
                  if (!window.confirm("Remove unreferenced Blob files? Referenced artifacts are retained.")) return;
                  void bridge.gcBlobs().then((result) => { setDoctorAction(`Removed ${result.removed} blobs and reclaimed ${result.reclaimedBytes} bytes.`); return doctorQuery.refetch(); }).catch((error) => setDoctorAction(String(error)));
                }}>Garbage collect blobs</button>
                <div className="gb-settings-section-head"><h3>Diagnostic bundle</h3><div><button type="button" className="gb-button" onClick={() => void bridge.diagnosticBundlePreview().then(setBundlePreview).catch((error) => setDoctorAction(String(error)))}>Preview</button><button type="button" className="gb-button" disabled={!bundlePreview} onClick={() => void bridge.exportDiagnosticBundle().then((path) => setDoctorAction(path ? `Exported diagnostics to ${path}` : null)).catch((error) => setDoctorAction(String(error)))}>Export previewed bundle</button></div></div>
                {bundlePreview && <pre className="gb-doctor-preview">{bundlePreview}</pre>}
              </Tabs.Content>
              <Tabs.Content value="about">
                <div className="gb-about-heading"><span aria-hidden>GB</span><div><h3>{t.appName}</h3><p className="gb-settings-copy">{t.aboutDescription}</p></div></div>
                <section className="gb-independence-notice">
                  <strong>{t.independenceTitle}</strong>
                  <p>{t.independenceDisclaimer}</p>
                  <p>{t.artworkDisclaimer}</p>
                </section>
              </Tabs.Content>
            </div>
          </Tabs.Root>
          <div className="gb-settings-footer"><button type="button" className="gb-button" onClick={() => onOpenChange(false)}>{t.cancel}</button><button type="button" className="gb-button primary" disabled={saving} onClick={() => void save()}>{saving ? t.saving : t.saveChanges}</button></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
