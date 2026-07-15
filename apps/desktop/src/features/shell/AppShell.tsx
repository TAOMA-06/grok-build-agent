import { useQuery } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDesktopBridge } from "../../platform/DesktopBridge";
import { useAppStore, type SessionRuntime } from "../../store";
import { mergeSelectableModels } from "../../contracts/model";
import type { Settings } from "../../types";
import { t } from "../../i18n";
import { ContextDrawer } from "./ContextDrawer";
import { DirtyWorktreeDialog } from "./DirtyWorktreeDialog";
import { ProjectSidebar } from "./ProjectSidebar";
import { SettingsDialog, type SettingsTab } from "./SettingsDialog";
import { ThreadView } from "./ThreadView";
import { useDesktopController, type DirtyPolicy } from "./useDesktopController";
import { buildCommandCatalog } from "./commands";
import "./shell.css";

export function AppShell() {
  const bridge = useDesktopBridge();
  const {
    settings,
    setSettings,
    workspaces,
    setWorkspaces,
    sessions,
    sessionOrder,
    activeSessionId,
    setActiveSession,
    ensureSession,
    addBlock,
    pendingPermission,
    pendingPlanApproval,
    permissionOptions,
    setGlobalModelState,
    clearProvisionalDraft,
    removeSession,
  } = useAppStore();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandSearch, setCommandSearch] = useState("");
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [transcriptExportStatus, setTranscriptExportStatus] = useState<string | null>(null);
  const [dirtyDialogOpen, setDirtyDialogOpen] = useState(false);
  const dirtyResolver = useRef<((policy: DirtyPolicy) => void) | null>(null);
  const hydratedSessions = useRef(new Set<string>());

  const chooseDirtyPolicy = useCallback(
    () => new Promise<DirtyPolicy>((resolve) => {
      dirtyResolver.current = resolve;
      setDirtyDialogOpen(true);
    }),
    [],
  );
  const controller = useDesktopController(chooseDirtyPolicy);

  const workspacesQuery = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => bridge.listWorkspaces(),
  });
  const sessionsQuery = useQuery({
    queryKey: ["sessions"],
    queryFn: () => bridge.listSessions(null),
  });
  const modelsQuery = useQuery({
    queryKey: ["models", settings.cliPathOverride || settings.grokPath],
    queryFn: () => bridge.listModels(settings.cliPathOverride || settings.grokPath || undefined),
  });

  useEffect(() => {
    if (workspacesQuery.data) setWorkspaces(workspacesQuery.data);
  }, [setWorkspaces, workspacesQuery.data]);

  useEffect(() => {
    const rows = sessionsQuery.data;
    if (!rows) return;
    for (const row of rows) {
      ensureSession(row);
      if (!hydratedSessions.current.has(row.sessionId)) {
        hydratedSessions.current.add(row.sessionId);
        void bridge.loadCachedBlocks(row.sessionId).then((blocks) => {
          const current = useAppStore.getState().sessions[row.sessionId];
          if (!current || current.blocks.length > 0) return;
          for (const block of blocks) addBlock(row.sessionId, block);
        });
      }
    }
    if (!useAppStore.getState().activeSessionId) {
      const preferred = rows.find((row) => row.workspaceRoot === settings.cwd && !row.archived)
        ?? rows.find((row) => !row.archived);
      if (preferred) setActiveSession(preferred.sessionId);
    }
  }, [addBlock, bridge, ensureSession, sessionsQuery.data, setActiveSession, settings.cwd]);

  useEffect(() => {
    const models = modelsQuery.data;
    if (!models?.length) return;
    const current = models.find((model) => model.isDefault)?.id || settings.model || models[0]?.id || null;
    setGlobalModelState({
      currentModelId: current,
      availableModels: models,
      liveSwitchSupported: false,
      source: "cli",
    });
  }, [modelsQuery.data, setGlobalModelState, settings.model]);

  useEffect(() => {
    const theme = settings.theme === "system"
      ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
      : settings.theme;
    document.documentElement.dataset.theme = theme;
  }, [settings.theme]);

  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        clearProvisionalDraft();
        setActiveSession(null);
        setDrawerOpen(false);
      } else if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandSearch("");
        setCommandOpen(true);
      } else if (event.key === ",") {
        event.preventDefault();
        setSettingsTab("general");
        setSettingsOpen(true);
      }
    }
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [clearProvisionalDraft, setActiveSession]);

  useEffect(() => {
    function onEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (commandOpen) setCommandOpen(false);
      else if (settingsOpen) setSettingsOpen(false);
      else if (drawerOpen) setDrawerOpen(false);
    }
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [commandOpen, drawerOpen, settingsOpen]);

  const orderedSessions = useMemo(
    () => sessionOrder.map((id) => sessions[id]).filter((item): item is SessionRuntime => Boolean(item)),
    [sessionOrder, sessions],
  );
  const activeSession = activeSessionId ? sessions[activeSessionId] ?? null : null;
  const activeWorkspace = activeSession?.summary.workspaceRoot || settings.cwd;
  const activeWorkspaceRecord = workspaces.find((workspace) => workspace.path === activeWorkspace);
  const models = useMemo(() => {
    const sessionModels = activeSession?.modelState?.availableModels ?? [];
    const cliModels = modelsQuery.data ?? [];
    const configuredId = activeSession?.summary.model || settings.model;
    // Prefer CLI/cache catalog metadata (effort, window) over bare ACP stubs.
    const ordered = mergeSelectableModels(cliModels, sessionModels);
    if (configuredId && !ordered.some((model) => model.id === configuredId)) {
      ordered.push({ id: configuredId, name: configuredId, isDefault: ordered.length === 0 });
    }
    return ordered;
  }, [activeSession?.modelState?.availableModels, activeSession?.summary.model, modelsQuery.data, settings.model]);

  async function openWorkspace() {
    const path = await controller.chooseWorkspace();
    if (!path) return;
    setActiveSession(null);
    clearProvisionalDraft();
  }

  async function selectWorkspace(path: string) {
    const first = orderedSessions.find(
      (session) => session.summary.workspaceRoot === path && !session.summary.archived,
    );
    // Switch the visible workspace before crossing the IPC boundary. The active
    // session takes precedence over settings.cwd when deriving activeWorkspace,
    // so leaving the old session selected makes a slow/failed save look like the
    // project click was ignored.
    setActiveSession(first?.summary.sessionId ?? null);
    setSettings({ cwd: path });
    setDrawerOpen(false);
    await bridge.saveSettings({ ...useAppStore.getState().settings, cwd: path } satisfies Settings);
  }

  function resolveDirtyPolicy(policy: DirtyPolicy) {
    setDirtyDialogOpen(false);
    const resolve = dirtyResolver.current;
    dirtyResolver.current = null;
    resolve?.(policy);
  }

  async function renameActiveThread(title: string) {
    const id = useAppStore.getState().activeSessionId;
    const session = id ? useAppStore.getState().sessions[id] : null;
    const summary = session?.summary ?? null;
    if (!id || !summary) return;
    const next = { ...summary, title, updatedAt: new Date().toISOString() };
    useAppStore.getState().updateSummary(id, next);
    if (!session.privateChat) await bridge.upsertSession(next);
  }

  async function archiveActiveThread() {
    const id = useAppStore.getState().activeSessionId;
    const session = id ? useAppStore.getState().sessions[id] : null;
    const summary = session?.summary ?? null;
    if (!id || !summary) return;
    if (session.privateChat) {
      removeSession(id);
      setDrawerOpen(false);
      return;
    }
    const next = { ...summary, archived: !summary.archived, updatedAt: new Date().toISOString() };
    useAppStore.getState().updateSummary(id, next);
    await bridge.upsertSession(next);
    setActiveSession(null);
    setDrawerOpen(false);
  }

  async function deleteActiveThread() {
    const id = useAppStore.getState().activeSessionId;
    const session = id ? useAppStore.getState().sessions[id] : null;
    const summary = session?.summary ?? null;
    if (!id || !summary) return;
    if (summary.worktreePath) {
      await bridge.deleteWorktree(summary.worktreePath, summary.workspaceRoot, true);
    }
    if (!session.privateChat) await bridge.deleteSession(id);
    removeSession(id);
    setDrawerOpen(false);
  }

  function newTask() {
    clearProvisionalDraft();
    setActiveSession(null);
    setDrawerOpen(false);
  }

  async function runLocalCommand(commandLine: string) {
    const state = useAppStore.getState();
    const trimmed = commandLine.trim();
    const separator = trimmed.search(/\s/);
    const invoked = (separator === -1 ? trimmed : trimmed.slice(0, separator)).toLowerCase();
    const args = separator === -1 ? "" : trimmed.slice(separator).trimStart();
    const command = ({
      "/exit": "/quit",
      "/clear": "/new",
      "/sessions": "/resume",
      "/title": "/rename",
      "/m": "/model",
      "/config": "/settings",
      "/t": "/theme",
      "/ml": "/multiline",
      "/mcp": "/mcps",
    } as Record<string, string>)[invoked] ?? invoked;
    switch (command) {
      case "/quit":
        await import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().close());
        return;
      case "/new":
      case "/home":
        newTask();
        break;
      case "/resume":
        window.dispatchEvent(new Event("grok:focus-task-search"));
        break;
      case "/model":
        if (args) await controller.chooseModel(args);
        else window.dispatchEvent(new Event("grok:open-model"));
        break;
      case "/effort":
        if (args) await controller.chooseEffort(args.split(/\s+/)[0]);
        else window.dispatchEvent(new Event("grok:open-effort"));
        break;
      case "/rename":
        if (args) await renameActiveThread(args);
        else window.dispatchEvent(new Event("grok:rename-task"));
        break;
      case "/copy": {
        const active = state.activeSessionId ? state.sessions[state.activeSessionId] : null;
        const responses = (active?.blocks ?? []).filter((block) => block.type === "assistant");
        const requested = Number.parseInt(args, 10);
        const assistant = Number.isFinite(requested) && requested > 0
          ? responses[requested - 1]
          : responses[responses.length - 1];
        if (assistant?.type === "assistant") await bridge.copyText(assistant.text);
        break;
      }
      case "/find":
        window.dispatchEvent(new CustomEvent("grok:find-transcript", { detail: args }));
        break;
      case "/transcript":
        setTranscriptOpen(true);
        break;
      case "/view-plan":
        window.dispatchEvent(new Event("grok:view-plan"));
        break;
      case "/tasks":
      case "/diff":
        if (state.activeSessionId) setDrawerOpen(true);
        break;
      case "/mcps":
      case "/hooks":
      case "/plugins":
      case "/marketplace":
      case "/skills":
        setSettingsTab("extensions");
        setSettingsOpen(true);
        break;
      case "/settings":
        setSettingsTab("general");
        setSettingsOpen(true);
        break;
      case "/help":
        setCommandOpen(true);
        break;
      case "/theme": {
        const theme = (["light", "dark", "system"].includes(args) ? args : null)
          ?? (state.settings.theme === "light" ? "dark" : "light");
        state.setSettings({ theme });
        await bridge.saveSettings(useAppStore.getState().settings);
        break;
      }
      case "/compact-mode":
        state.setSettings({ compactMode: !state.settings.compactMode });
        await bridge.saveSettings(useAppStore.getState().settings);
        break;
      case "/multiline":
        state.setSettings({ multilineMode: !state.settings.multilineMode });
        await bridge.saveSettings(useAppStore.getState().settings);
        break;
      case "/timestamps":
        state.setSettings({ showTimestamps: !state.settings.showTimestamps });
        await bridge.saveSettings(useAppStore.getState().settings);
        break;
      case "/login":
        await bridge.runLogin(state.settings.cliPathOverride || state.settings.grokPath || undefined);
        break;
      case "/logout":
        await bridge.runLogout(state.settings.cliPathOverride || state.settings.grokPath || undefined);
        break;
      case "/export": {
        const active = state.activeSessionId ? state.sessions[state.activeSessionId] : null;
        if (active) {
          const transcript = active.blocks.map((block) => {
            if (block.type === "user") return `## ${t.you}\n\n${block.text}`;
            if (block.type === "assistant") return `## ${t.grok}\n\n${block.text}`;
            if (block.type === "plan") return `## ${t.plan}\n\n${block.text}`;
            return "";
          }).filter(Boolean).join("\n\n");
          await bridge.copyText(transcript);
        }
        break;
      }
    }
    state.setEffectiveDraftText("");
  }

  const commandActions = useMemo(
    () => buildCommandCatalog(activeSession?.availableCommands ?? [], []).map((descriptor) => ({
      ...descriptor,
      label: descriptor.source === "desktop" || descriptor.source === "documented"
        ? t.commands[descriptor.descriptionKey] ?? descriptor.name
        : descriptor.descriptionKey,
    })),
    [activeSession?.availableCommands, settings.locale],
  );
  const filteredCommandActions = useMemo(() => {
    const query = commandSearch.trim().toLowerCase();
    if (!query) return commandActions;
    return commandActions.filter((command) =>
      [command.name, ...command.aliases, command.label].some((value) => value.toLowerCase().includes(query)),
    );
  }, [commandActions, commandSearch]);

  return (
    <div className={[
      "gb-app",
      drawerOpen && activeSession ? "drawer-open" : "",
      settings.compactMode ? "compact-mode" : "",
    ].filter(Boolean).join(" ")}>
      <ProjectSidebar
        workspaces={workspaces}
        sessions={orderedSessions}
        activeSessionId={activeSessionId}
        activeWorkspace={activeWorkspace}
        onNewThread={() => {
          newTask();
        }}
        onSelectSession={(id) => {
          setActiveSession(id);
          setDrawerOpen(false);
        }}
        onOpenWorkspace={() => void openWorkspace()}
        onSelectWorkspace={(path) => void selectWorkspace(path)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <ThreadView
        session={activeSession}
        workspaceName={activeWorkspaceRecord?.name || activeWorkspace.split(/[\\/]/).pop() || ""}
        models={models}
        connecting={Boolean(activeSessionId && controller.connectingSessionId === activeSessionId)}
        drawerOpen={drawerOpen}
        pendingPermission={pendingPermission && activeSession && (
          !pendingPermission.sessionId
          || pendingPermission.sessionId === activeSession.summary.sessionId
          || pendingPermission.sessionId === activeSession.summary.remoteSessionId
        ) ? pendingPermission : null}
        pendingPlanApproval={pendingPlanApproval && activeSession && (
          !pendingPlanApproval.sessionId
          || pendingPlanApproval.sessionId === activeSession.summary.sessionId
          || pendingPlanApproval.sessionId === activeSession.summary.remoteSessionId
        ) ? pendingPlanApproval : null}
        permissionOptions={permissionOptions}
        onToggleDrawer={() => setDrawerOpen((value) => !value)}
        onOpenPath={(path) => bridge.openPath(path)}
        onSend={controller.send}
        onCancel={controller.cancel}
        onChooseModel={controller.chooseModel}
        onChooseEffort={controller.chooseEffort}
        onChooseMode={controller.chooseMode}
        onLocalCommand={(command) => void runLocalCommand(command)}
        onRetryFailed={controller.retryFailed}
        onAnswerPermission={controller.answerPermission}
        onPlanDecision={controller.answerPlanApproval}
        onRename={renameActiveThread}
        onArchive={archiveActiveThread}
        onDelete={deleteActiveThread}
      />
      {drawerOpen && activeSession && <ContextDrawer session={activeSession} onClose={() => setDrawerOpen(false)} />}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialTab={settingsTab}
        onReloadAgent={async () => {
          // Tool definitions are part of the provider-cached prefix. Apply MCP
          // changes to a fresh task so an existing history keeps its warm cache.
          const sessionId = await controller.createThread();
          if (sessionId) await controller.reloadActiveAgent();
        }}
      />
      <DirtyWorktreeDialog open={dirtyDialogOpen} onChoose={resolveDirtyPolicy} />
      <Dialog.Root open={commandOpen} onOpenChange={setCommandOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="gb-dialog-overlay" />
          <Dialog.Content className="gb-command-palette">
            <Dialog.Title>{t.commandPalette}</Dialog.Title>
            <Dialog.Description>{t.commandPaletteDesc}</Dialog.Description>
            <input
              className="gb-command-search"
              autoFocus
              aria-label={t.searchCommands}
              placeholder={t.searchCommands}
              value={commandSearch}
              onChange={(event) => setCommandSearch(event.target.value)}
            />
            <div className="gb-command-actions">
              {filteredCommandActions.map((command) => (
                <button type="button" key={command.name} disabled={!command.available} onClick={() => {
                  setCommandOpen(false);
                  if (command.execution === "acp") {
                    useAppStore.getState().setEffectiveDraftText(`${command.name}${command.inputHint ? " " : ""}`);
                    window.dispatchEvent(new Event("grok:focus-composer"));
                  } else {
                    void runLocalCommand(command.name);
                  }
                }}><code>{command.name}</code><span>{command.label}{command.aliases.length ? <small>{command.aliases.join(" · ")}</small> : null}</span><i>{command.available ? command.source : t.unavailable}</i></button>
              ))}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={Boolean(controller.pendingModelFork)} onOpenChange={(open) => { if (!open) controller.cancelModelFork(); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="gb-dialog-overlay" />
          <Dialog.Content className="gb-confirm-dialog">
            <Dialog.Title>{t.modelForkTitle}</Dialog.Title>
            <Dialog.Description>{controller.pendingModelFork?.reason} {t.modelForkSuffix}</Dialog.Description>
            <div className="gb-confirm-actions">
              <button type="button" className="gb-button" onClick={controller.cancelModelFork}>{t.cancel}</button>
              <button type="button" className="gb-button primary" onClick={() => void controller.confirmModelFork()}>{t.createNewTask}</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={transcriptOpen} onOpenChange={setTranscriptOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="gb-dialog-overlay" />
          <Dialog.Content className="gb-transcript-dialog">
            <Dialog.Title>{t.commands.transcript}</Dialog.Title>
            <div className="gb-transcript-body">
              {(activeSession?.blocks ?? []).map((block) => (
                <section key={block.id}>
                  <strong>{block.type === "user" ? t.you : block.type === "assistant" ? t.grok : block.type === "plan" ? t.plan : block.type}</strong>
                  {"text" in block && <p>{String(block.text)}</p>}
                </section>
              ))}
            </div>
            <div className="gb-confirm-actions">
              <button type="button" className="gb-button" onClick={() => {
                if (!activeSession || activeSession.privateChat) return;
                setTranscriptExportStatus("Exporting…");
                void bridge.exportTranscript(activeSession.summary.sessionId, "markdown").then((path) => setTranscriptExportStatus(path ? `Exported to ${path}` : null)).catch((error) => setTranscriptExportStatus(`Export failed: ${String(error)}`));
              }} disabled={!activeSession || activeSession.privateChat}>Export Markdown</button>
              <button type="button" className="gb-button" onClick={() => {
                if (!activeSession || activeSession.privateChat) return;
                setTranscriptExportStatus("Exporting…");
                void bridge.exportTranscript(activeSession.summary.sessionId, "json").then((path) => setTranscriptExportStatus(path ? `Exported to ${path}` : null)).catch((error) => setTranscriptExportStatus(`Export failed: ${String(error)}`));
              }} disabled={!activeSession || activeSession.privateChat}>Export JSON</button>
            </div>
            {activeSession?.privateChat && <p className="gb-settings-copy">{t.privateChatPersistenceUnavailable}</p>}
            {transcriptExportStatus && <p className="gb-settings-copy">{transcriptExportStatus}</p>}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
