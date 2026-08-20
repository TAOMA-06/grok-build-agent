import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { useQuery } from "@tanstack/react-query";
import { Bot, Ghost, Info, Puzzle, RefreshCw, Settings2, ShieldCheck, Stethoscope, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { useEffect } from "react";
import { McpManager } from "../mcp/McpManager";
import { CapabilityOrchestrator } from "./CapabilityOrchestrator";
import { applyLocalePreference, t } from "../../i18n";
import { GbButton } from "../../components/ui/GbButton";
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

function RuntimeAdaptersPanel({
  draft,
  patch,
}: {
  draft: Settings;
  patch: (partial: Partial<Settings>) => void;
}) {
  const bridge = useDesktopBridge();
  const adaptersQuery = useQuery({
    queryKey: ["runtime-adapters", draft.cliPathOverride || draft.grokPath, draft.secondaryAcpPath],
    queryFn: () => bridge.listRuntimeAdapters(draft.cliPathOverride || draft.grokPath || undefined),
  });
  const modelsQuery = useQuery({
    queryKey: ["runtime-fallback-models", draft.cliPathOverride || draft.grokPath],
    queryFn: () => bridge.listModels(draft.cliPathOverride || draft.grokPath || undefined),
  });
  const modelOptions = modelsQuery.data ?? [];
  const fallbackConfigured = draft.fallbackModelId.trim();
  const fallbackInList = modelOptions.some((model) => model.id === fallbackConfigured);

  return (
    <section className="gb-settings-panel">
      <h3>{t.adapterCatalogTitle}</h3>
      <label>
        <span>{t.preferredAdapter}<small>{t.preferredAdapterHint}</small></span>
        <select
          value={draft.preferredAdapterId === "generic-acp" ? "generic-acp" : "grok-acp"}
          onChange={(event) => patch({ preferredAdapterId: event.target.value })}
        >
          <option value="grok-acp">{t.preferredAdapterGrok}</option>
          <option value="generic-acp">{t.preferredAdapterSecondary}</option>
        </select>
      </label>
      <label>
        <span>{t.secondaryAcpPath}<small>{t.secondaryAcpPathHint}</small></span>
        <input
          value={draft.secondaryAcpPath}
          onChange={(event) => patch({ secondaryAcpPath: event.target.value })}
          placeholder="/path/to/codex-acp"
        />
      </label>
      <label className="gb-settings-toggle">
        <input
          type="checkbox"
          checked={draft.mixedPlanning}
          onChange={(event) => patch({ mixedPlanning: event.target.checked })}
        />
        <span>{t.mixedPlanning}<small>{t.mixedPlanningHint}</small></span>
      </label>
      {draft.mixedPlanning && !draft.secondaryAcpPath.trim() && (
        <p className="gb-settings-warning" role="status">{t.mixedPlanningNeedsPath}</p>
      )}
      <label>
        <span>{t.fallbackModelId}<small>{t.fallbackModelIdHint}</small></span>
        <select
          value={draft.fallbackModelId}
          onChange={(event) => patch({ fallbackModelId: event.target.value })}
        >
          <option value="">{t.fallbackModelUnset}</option>
          {fallbackConfigured && !fallbackInList && (
            <option value={fallbackConfigured}>{fallbackConfigured}</option>
          )}
          {modelOptions.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name || model.id}
            </option>
          ))}
        </select>
      </label>
      {draft.preferredAdapterId === "generic-acp" && !draft.secondaryAcpPath.trim() && (
        <p className="gb-settings-warning" role="status">{t.adapterUnavailable}</p>
      )}
      <div className="gb-capability-groups">
        <section>
          <header>
            <strong>{t.adapterCatalogTitle}</strong>
            <span>{adaptersQuery.data?.length ?? 0}</span>
          </header>
          {(adaptersQuery.data ?? []).map((adapter) => (
            <div key={adapter.adapterId}>
              <span>
                <b>{adapter.label}</b>
                <small>{adapter.notes}</small>
              </span>
              <i>{adapter.configured ? t.adapterConfigured : t.adapterUnavailable}</i>
            </div>
          ))}
        </section>
      </div>
    </section>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
  initialTab = "general",
  onReloadAgent,
  onInsertCapabilityDraft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: SettingsTab;
  onReloadAgent?: () => void | Promise<void>;
  /** Insert a Skills/Hooks orchestration draft into the active composer. */
  onInsertCapabilityDraft?: (draft: string) => void;
}) {
  const bridge = useDesktopBridge();
  const settings = useAppStore((state) => state.settings);
  const replaceSettings = useAppStore((state) => state.replaceSettings);
  const [draft, setDraft] = useState(() => normalizeSettings(settings));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveRevision = useRef(0);
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [doctorAction, setDoctorAction] = useState<string | null>(null);
  const [bundlePreview, setBundlePreview] = useState<string | null>(null);
  const [cliUpdateBusy, setCliUpdateBusy] = useState(false);
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
  const cliUpdateQuery = useQuery({
    queryKey: ["cli-update", settings.cliPathOverride || settings.grokPath],
    queryFn: () => bridge.checkCliUpdate(settings.cliPathOverride || settings.grokPath || undefined),
    enabled: open && tab === "diagnostics",
  });
  const harnessQuery = useQuery({
    queryKey: ["harness-status"],
    queryFn: () => bridge.getHarnessStatus(),
    enabled: open && tab === "diagnostics",
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

  async function persist(next: Settings, closeWhenSaved = false) {
    const revision = ++saveRevision.current;
    const normalized = normalizeSettings(next);
    setSaving(true);
    setSaveError(null);
    replaceSettings(normalized);
    applyLocalePreference(normalized.locale);
    const write = saveQueue.current.then(() => bridge.saveSettings(normalized));
    saveQueue.current = write.catch(() => undefined);
    try {
      await write;
      if (closeWhenSaved && revision === saveRevision.current) onOpenChange(false);
    } catch (error) {
      if (revision === saveRevision.current) setSaveError(String(error));
    } finally {
      if (revision === saveRevision.current) setSaving(false);
    }
  }

  async function save() {
    await persist(draft, true);
  }

  function applyImmediately(next: Partial<Settings>) {
    const updated = normalizeSettings({ ...draft, ...next });
    setDraft(updated);
    void persist(updated);
  }

  async function applyCodingDataPrivacy(enabled: boolean) {
    const updated = normalizeSettings({
      ...draft,
      codingDataPrivacy: enabled,
      codingDataPrivacyConfigured: true,
    });
    setDraft(updated);
    await persist(updated);
    // Best-effort account sync when an agent is already running.
    try {
      await bridge.setCodingDataPrivacy(enabled);
    } catch (error) {
      const message = String(error);
      // NotRunning is expected when no agent is active; keep the local preference.
      if (/not running|NotRunning/i.test(message)) return;
      setSaveError(message);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (next) { setDraft(normalizeSettings(settings)); setSaveError(null); } onOpenChange(next); }}>
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
                <section className="gb-settings-panel">
                  <h3>{t.appearance}</h3>
                  <label><span>{t.theme}<small>{t.themeHint}</small></span><select value={draft.theme} onChange={(event) => patch({ theme: event.target.value })}><option value="dark">{t.themeDark}</option><option value="light">{t.themeLight}</option><option value="system">{t.themeSystem}</option></select></label>
                  <label><span>{t.language}<small>{t.languageHint}</small></span><select aria-label={t.language} value={draft.locale} onChange={(event) => applyImmediately({ locale: event.target.value as Settings["locale"] })}><option value="system">{t.languageSystem}</option><option value="en">{t.languageEnglish}</option><option value="zh-CN">{t.languageChinese}</option></select></label>
                </section>
                <section className="gb-settings-panel">
                  <h3 className="gb-settings-heading-icon"><Ghost size={15} /> {t.codingDataPrivacy}</h3>
                  <label className="gb-switch-row"><span>{t.codingDataPrivacy}<small>{t.codingDataPrivacyHint}</small></span><input aria-label={t.codingDataPrivacy} type="checkbox" checked={draft.codingDataPrivacy} onChange={(event) => applyCodingDataPrivacy(event.target.checked)} /></label>
                  <p className="gb-settings-copy">{draft.codingDataPrivacy ? t.codingDataPrivacyOn : t.codingDataPrivacyOff}</p>
                  <p className="gb-settings-copy">{t.codingDataPrivacyBoundary}</p>
                </section>
                <section className="gb-settings-panel">
                  <h3 className="gb-settings-heading-icon"><Ghost size={15} /> {t.privateChat}</h3>
                  <label className="gb-switch-row"><span>{t.privateChat}<small>{t.privateChatHint}</small></span><input aria-label={t.privateChat} type="checkbox" checked={draft.privateChat} onChange={(event) => applyImmediately({ privateChat: event.target.checked })} /></label>
                  <p className="gb-settings-copy">{draft.privateChat ? t.privateChatOn : t.privateChatOff}</p>
                  <p className="gb-settings-copy">{t.privateChatServiceBoundary}</p>
                </section>
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
                <section className="gb-settings-panel">
                  <h3>{t.newTasks}</h3>
                  <label><span>{t.defaultModel}<small>{t.defaultModelHint}</small></span><select value={draft.model} onChange={(event) => patch({ model: event.target.value })}>{!modelsQuery.data?.some((model) => model.id === draft.model) && <option value={draft.model}>{draft.model}</option>}{modelsQuery.data?.map((model) => <option value={model.id} key={model.id}>{model.name}</option>)}</select></label>
                  <label><span>{t.defaultReasoningEffort}<small>{t.defaultReasoningEffortHint}</small></span><select value={draft.defaultReasoningEffort} onChange={(event) => patch({ defaultReasoningEffort: event.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
                  <label><span>{t.defaultMode}<small>{t.defaultModeHint}</small></span><select value={draft.defaultMode} onChange={(event) => patch({ defaultMode: event.target.value as Settings["defaultMode"] })}><option value="agent">{t.modeAgent}</option><option value="plan">{t.modePlan}</option><option value="goal">{t.modeGoal}</option></select></label>
                  <label><span>{t.focusMode}<small>{t.focusModeHint}</small></span><select value={draft.focusMode} onChange={(event) => patch({ focusMode: event.target.value as Settings["focusMode"] })}><option value="economy">{t.focusEconomy} · {t.focusEconomyHint}</option><option value="balanced">{t.focusBalanced} · {t.focusBalancedHint}</option></select></label>
                </section>
                <section className="gb-settings-panel">
                  <h3>{t.privacyShield}</h3>
                  <label className="gb-switch-row"><span>{t.privacyShield}<small>{t.privacyShieldHint}</small></span><input aria-label={t.privacyShield} type="checkbox" checked={draft.privacyMode === "strict"} onChange={(event) => patch({ privacyMode: event.target.checked ? "strict" : "standard" })} /></label>
                  <p className="gb-settings-copy">{draft.privacyMode === "strict" ? t.privacyStrict : t.privacyStandard}</p>
                  <p className="gb-settings-copy">{t.privacyServiceBoundary}</p>
                  <label className="gb-switch-row"><span>{t.useHarness}<small>{t.useHarnessHint}</small></span><input aria-label={t.useHarness} type="checkbox" checked={draft.useHarness} onChange={(event) => applyImmediately({ useHarness: event.target.checked })} /></label>
                  <p className="gb-settings-copy">{draft.useHarness ? t.useHarnessOn : t.useHarnessOff}</p>
                  <label className="gb-switch-row"><span>{t.combineQueuedPrompts}<small>{t.combineQueuedPromptsHint}</small></span><input aria-label={t.combineQueuedPrompts} type="checkbox" checked={draft.combineQueuedPrompts} onChange={(event) => applyImmediately({ combineQueuedPrompts: event.target.checked })} /></label>
                  <label className="gb-switch-row"><span>{t.disableImageTools}<small>{t.disableImageToolsHint}</small></span><input aria-label={t.disableImageTools} type="checkbox" checked={draft.disableImageTools} onChange={(event) => applyImmediately({ disableImageTools: event.target.checked })} /></label>
                  <label className="gb-switch-row"><span>{t.disableVideoTools}<small>{t.disableVideoToolsHint}</small></span><input aria-label={t.disableVideoTools} type="checkbox" checked={draft.disableVideoTools} onChange={(event) => applyImmediately({ disableVideoTools: event.target.checked })} /></label>
                  <label><span>{t.permissions}<small>{t.permissionsHint}</small></span><select aria-label={t.permissions} value={draft.permissionPolicy} onChange={(event) => applyImmediately({ permissionPolicy: event.target.value as Settings["permissionPolicy"] })}><option value="workspace_edit">{t.permissionWorkspace}</option><option value="ask_all">{t.permissionAsk}</option><option value="full_auto">{t.permissionAuto}</option></select></label>
                  {draft.permissionPolicy === "full_auto" && (
                    <p className="gb-settings-warning" role="status">{t.permissionPolicyFullAutoWarning}</p>
                  )}
                  <label className="gb-switch-row"><span>{t.strictTerminal}<small>{t.strictTerminalHint}</small></span><input aria-label={t.strictTerminal} type="checkbox" checked={draft.strictTerminal} onChange={(event) => applyImmediately({ strictTerminal: event.target.checked })} /></label>
                  <p className="gb-settings-copy">{draft.strictTerminal ? t.strictTerminalOn : t.strictTerminalOff}</p>
                  <label className="gb-switch-row"><span>{t.keepCliUpdated}<small>{t.keepCliUpdatedHint}</small></span><input type="checkbox" checked={draft.autoUpdateCli} onChange={(event) => patch({ autoUpdateCli: event.target.checked })} /></label>
                  <details className="gb-advanced-settings"><summary>{t.advanced}</summary><label><span>{t.cliPathOverride}<small>{t.cliPathHint}</small></span><input value={draft.cliPathOverride} onChange={(event) => patch({ cliPathOverride: event.target.value, grokPath: event.target.value })} placeholder={t.autoDetect} /></label></details>
                </section>
                <RuntimeAdaptersPanel draft={draft} patch={patch} />
              </Tabs.Content>
              <Tabs.Content value="extensions">
                <div className="gb-settings-section-head"><h3>{t.extensions}</h3><button type="button" className="gb-icon-button" aria-label={t.refreshExtensions} onClick={() => void capabilitiesQuery.refetch()}><RefreshCw size={14} /></button></div>
                {capabilitiesQuery.isLoading && <div className="gb-settings-placeholder"><Puzzle size={24} /><strong>{t.readingCapabilities}</strong></div>}
                {capabilitiesQuery.data && (
                  <div className="gb-capability-groups">
                    <CapabilityOrchestrator
                      skills={capabilitiesQuery.data.skills}
                      hooks={capabilitiesQuery.data.hooks}
                      onInsertDraft={(draft) => {
                        onInsertCapabilityDraft?.(draft);
                        onOpenChange(false);
                      }}
                    />
                    {([
                      [t.skills, capabilitiesQuery.data.skills],
                      [t.agentTypes, capabilitiesQuery.data.agents],
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
                <div className="gb-settings-section-head"><h3>{t.diagnostics}</h3><button type="button" className="gb-icon-button" aria-label={t.refresh} onClick={() => { void doctorQuery.refetch(); void cliUpdateQuery.refetch(); void harnessQuery.refetch(); }}><RefreshCw size={14} /></button></div>
                <div className="gb-capability-groups"><section>
                  <header><strong>{t.harnessInspectorTitle}</strong><span>{draft.useHarness ? "on" : "off"}</span></header>
                  <div>
                    <span>
                      <b>{draft.useHarness ? t.harnessInspectorOn : t.harnessInspectorOff}</b>
                      <small>
                        {harnessQuery.data?.resolved
                          ? t.harnessInspectorPlugin
                          : t.harnessInspectorRulesOnly}
                      </small>
                    </span>
                    <i>{harnessQuery.data?.mode ?? "—"}</i>
                  </div>
                  {harnessQuery.data?.pluginPath && (
                    <p className="gb-settings-copy mono">{harnessQuery.data.pluginPath}</p>
                  )}
                  <p className="gb-settings-copy">
                    {t.harnessInspectorTrackedCli}
                    {harnessQuery.data?.trackedCli ? ` (${harnessQuery.data.trackedCli})` : ""}
                  </p>
                  {draft.useHarness && harnessQuery.data?.configOverlay !== false && (
                    <p className="gb-settings-copy">{t.harnessInspectorOverlay}</p>
                  )}
                  <button
                    type="button"
                    className="gb-button"
                    style={{ marginTop: 8 }}
                    onClick={() => void harnessQuery.refetch()}
                  >
                    {t.harnessInspectorCheck}
                  </button>
                </section></div>
                <div className="gb-capability-groups"><section>
                  <header><strong>{t.cliUpdateTitle}</strong><span>{cliUpdateQuery.data?.channel ?? "stable"}</span></header>
                  <div>
                    <span>
                      <b>{t.cliUpdateCurrent}</b>
                      <small>{cliUpdateQuery.data?.currentVersion ?? "—"}</small>
                    </span>
                    <i>{cliUpdateQuery.data?.updateAvailable ? t.updateAvailable : t.cliUpdateUpToDate}</i>
                  </div>
                  <div>
                    <span>
                      <b>{t.cliUpdateLatest}</b>
                      <small>{cliUpdateQuery.data?.latestVersion ?? "—"}</small>
                    </span>
                    <i>{cliUpdateQuery.isFetching ? t.cliUpdateChecking : ""}</i>
                  </div>
                  {cliUpdateQuery.data?.updateAvailable && (
                    <p className="gb-settings-copy">{t.cliUpdateAvailableHint}</p>
                  )}
                  <div className="row-actions" style={{ marginTop: 8, gap: 8 }}>
                    <button
                      type="button"
                      className="gb-button"
                      disabled={cliUpdateBusy || cliUpdateQuery.isFetching}
                      onClick={() => void cliUpdateQuery.refetch()}
                    >
                      {t.cliUpdateCheck}
                    </button>
                    <button
                      type="button"
                      className="gb-button primary"
                      disabled={cliUpdateBusy || !cliUpdateQuery.data?.updateAvailable}
                      onClick={() => {
                        setCliUpdateBusy(true);
                        setDoctorAction(t.cliUpdateUpdating);
                        void bridge
                          .runCliUpdate(settings.cliPathOverride || settings.grokPath || undefined)
                          .then((message) => {
                            setDoctorAction(message || t.cliUpdateUpToDate);
                            return cliUpdateQuery.refetch();
                          })
                          .catch((error) => setDoctorAction(String(error)))
                          .finally(() => setCliUpdateBusy(false));
                      }}
                    >
                      {cliUpdateBusy ? t.cliUpdateUpdating : t.cliUpdateNow}
                    </button>
                  </div>
                </section></div>
                {doctorQuery.isLoading && <div className="gb-settings-placeholder"><Stethoscope size={24} /><strong>{t.runtimeHealthTitle}</strong><p>{t.readingCapabilities}</p></div>}
                {doctorQuery.data && <div className="gb-capability-groups"><section>
                  <header><strong>{t.runtimeHealthTitle}</strong><span>{doctorQuery.data.host}</span></header>
                  <div><span><b>Agent Host</b><small>PID {doctorQuery.data.pid} · protocol {doctorQuery.data.protocolVersion}</small></span><i>{doctorQuery.data.host}</i></div>
                  <div><span><b>SQLite</b><small>{doctorQuery.data.databasePath}</small></span><i>{doctorQuery.data.database}</i></div>
                  <div><span><b>Permissions</b><small>Pending requests</small></span><i>{doctorQuery.data.pendingPermissions}</i></div>
                  <div><span><b>Blob storage</b><small>Content-addressed artifacts</small></span><i>{doctorQuery.data.blobBytes} bytes</i></div>
                  <div><span><b>Strict network isolation</b><small>Grok cannot attest enforceable isolation</small></span><i>{doctorQuery.data.strictNetworkIsolation ? "protected" : "unavailable"}</i></div>
                  <div>
                    <span>
                      <b>{t.githubCli}</b>
                      <small>{doctorQuery.data.github?.detail || (doctorQuery.data.github?.found ? "" : t.githubCliMissing)}</small>
                    </span>
                    <i>
                      {doctorQuery.data.github?.authenticated
                        ? t.adapterConfigured
                        : doctorQuery.data.github?.found
                          ? t.githubCliUnauthenticated
                          : t.githubCliMissing}
                    </i>
                  </div>
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
          <div className="gb-settings-footer">
            {saveError && <span className="gb-settings-save-error" role="alert">{saveError}</span>}
            <GbButton onClick={() => onOpenChange(false)}>{t.cancel}</GbButton>
            <GbButton variant="primary" disabled={saving} onClick={() => void save()}>{saving ? t.saving : t.saveChanges}</GbButton>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
