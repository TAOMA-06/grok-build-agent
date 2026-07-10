import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  loadSettings,
  respondServerRequest,
  restartAgent,
  runtimeHealth,
  saveSettings,
  sendPrompt,
  startAgent,
  stopAgent,
  subscribeAcpEvents,
} from "./acp/client";
import {
  createWorktree,
  deleteWorktree,
  gitFilePatch,
  gitReview,
  listSessions,
  listWorkspaces,
  listWorktrees,
  saveDraft,
  upsertSession,
  upsertWorkspace,
  worktreeDeletePreview,
} from "./api/catalog";
import { t } from "./i18n/en";
import { useAppStore } from "./store";
import type {
  ChatBlock,
  RightPanel,
  SessionSummary,
  Settings,
} from "./types";
import "./App.css";

function safeJson(v: unknown): string {
  try {
    const s = typeof v === "string" ? v : JSON.stringify(v, null, 2);
    return s.length > 4000 ? s.slice(0, 4000) + "\n…" : s;
  } catch {
    return String(v);
  }
}

function BlockView({
  block,
  onSelectTool,
}: {
  block: ChatBlock;
  onSelectTool?: (id: string) => void;
}) {
  switch (block.type) {
    case "user":
      return (
        <div className="block user">
          <div className="label">{t.you}</div>
          <div className="body pre">{block.text}</div>
        </div>
      );
    case "assistant":
      return (
        <div className="block assistant">
          <div className="label">{t.grok}</div>
          <div className="body pre">{block.text}</div>
        </div>
      );
    case "thought":
      return (
        <details className="block thought">
          <summary>{t.thinking}</summary>
          <div className="body pre muted">{block.text}</div>
        </details>
      );
    case "tool": {
      const large =
        safeJson(block.tool.output).length > 800 ||
        safeJson(block.tool.input).length > 800;
      return (
        <button
          type="button"
          className={`block tool status-${block.tool.status}`}
          style={{ width: "100%", textAlign: "left" }}
          onClick={() => onSelectTool?.(block.tool.id)}
        >
          <div className="label">
            {t.tool} · {block.tool.title}
            <span className="pill">{block.tool.status}</span>
          </div>
          {block.tool.input != null && (
            <pre className={`code ${large ? "tool-collapsed" : ""}`}>
              {safeJson(block.tool.input)}
            </pre>
          )}
          {block.tool.output != null && (
            <pre className={`code out ${large ? "tool-collapsed" : ""}`}>
              {safeJson(block.tool.output)}
            </pre>
          )}
        </button>
      );
    }
    case "plan":
      return (
        <div className="block plan">
          <div className="label">{t.plan}</div>
          <div className="body pre">{block.text}</div>
        </div>
      );
    case "system":
      return (
        <div className={`block system ${block.level ?? "info"}`}>
          <div className="body">{block.text}</div>
        </div>
      );
    case "subtask":
      return (
        <div className="block tool">
          <div className="label">
            {t.subtask} · {block.title}
            <span className="pill">{block.status}</span>
          </div>
        </div>
      );
  }
}

function Onboarding() {
  const { settings, setSettings, health, setHealth, replaceSettings } =
    useAppStore();
  const [step, setStep] = useState(0);
  const [checking, setChecking] = useState(false);

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      setHealth(await runtimeHealth(settings.grokPath || undefined));
    } finally {
      setChecking(false);
    }
  }, [settings.grokPath, setHealth]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function finish() {
    const next = { ...settings, onboardingDone: true };
    replaceSettings(next);
    await saveSettings(next);
  }

  return (
    <div className="onboarding">
      <div className="onboarding-card">
        <h2>{t.onboardingTitle}</h2>
        <p className="hint">{t.appSubtitle}</p>
        {step === 0 && (
          <>
            <label>
              {t.grokPath}
              <input
                value={settings.grokPath}
                onChange={(e) => setSettings({ grokPath: e.target.value })}
                placeholder="~/.grok/bin/grok"
              />
            </label>
            <label>
              {t.apiKey}
              <input
                type="password"
                value={settings.apiKey}
                onChange={(e) => setSettings({ apiKey: e.target.value })}
                placeholder="Keychain"
                autoComplete="off"
              />
            </label>
            <p className="hint">{t.apiKeyHint}</p>
            <div className="row-actions">
              <button type="button" className="ghost" onClick={() => void refresh()}>
                {checking ? "…" : t.recheck}
              </button>
            </div>
            <ul className="checklist">
              {(health?.checklist ?? []).map((item) => (
                <li key={item.id} className={item.ok ? "ok" : "bad"}>
                  <strong>{item.ok ? "✓" : "✗"}</strong> {item.label}
                  {item.detail && (
                    <span className="muted"> — {item.detail}</span>
                  )}
                </li>
              ))}
            </ul>
            <div className="row-actions end">
              <button
                type="button"
                className="primary"
                disabled={!health?.grok.found}
                onClick={() => setStep(1)}
              >
                {t.onboardingNext}
              </button>
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <label>
              {t.model}
              <input
                value={settings.model}
                onChange={(e) => setSettings({ model: e.target.value })}
              />
            </label>
            <label className="row">
              <input
                type="checkbox"
                checked={settings.useHarness}
                onChange={(e) => setSettings({ useHarness: e.target.checked })}
              />
              {t.useHarness}
            </label>
            <div className="row-actions end">
              <button type="button" className="ghost" onClick={() => setStep(0)}>
                Back
              </button>
              <button type="button" className="primary" onClick={() => void finish()}>
                {t.onboardingNext}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DiffPanel() {
  const {
    settings,
    review,
    setReview,
    setPatchPreview,
    patchPreview,
    setRightPanel,
  } = useAppStore();
  const cwd = settings.cwd;

  const refresh = useCallback(async () => {
    if (!cwd) {
      setReview(null);
      return;
    }
    try {
      setReview(await gitReview(cwd));
    } catch (e) {
      setReview({
        workspaceRoot: cwd,
        state: "error",
        files: [],
        untracked: [],
        error: String(e),
        refreshedAt: new Date().toISOString(),
      });
    }
  }, [cwd, setReview]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function showPatch(path: string, staged: boolean) {
    if (!cwd) return;
    const text = await gitFilePatch(cwd, path, staged);
    setPatchPreview({ path, text });
  }

  async function copyPath(path: string) {
    await navigator.clipboard.writeText(path);
  }

  async function reveal(path: string) {
    if (!cwd) return;
    await openPath(`${cwd}/${path}`);
  }

  if (!review) {
    return <p className="empty muted">{t.noWorkspace}</p>;
  }

  return (
    <div className="panel-body">
      <div className="row-actions">
        <button type="button" className="ghost" onClick={() => void refresh()}>
          {t.refresh}
        </button>
        <span className="muted">
          {review.state === "clean" && t.cleanRepo}
          {review.state === "dirty" && t.dirtyRepo}
          {review.state === "not_a_repo" && t.noGitRepo}
          {review.branch && ` · ${review.branch}`}
          {review.head && ` @ ${review.head}`}
        </span>
      </div>
      {review.files.map((f) => (
        <div key={f.path + String(f.staged)} className="diff-file-row">
          <button
            type="button"
            className="diff-file list-item"
            onClick={() => void showPatch(f.path, f.staged)}
          >
            <span>
              {f.path}
              {f.binary ? ` (${t.binaryFile})` : ""}
            </span>
            <span className="diff-stats">
              <span className="add">+{f.additions}</span>{" "}
              <span className="del">−{f.deletions}</span>
            </span>
          </button>
          <div className="row-actions">
            <button type="button" className="ghost" onClick={() => void copyPath(f.path)}>
              {t.copyPath}
            </button>
            <button type="button" className="ghost" onClick={() => void reveal(f.path)}>
              {t.openFinder}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                const sid = useAppStore.getState().activeSessionId;
                if (!sid) return;
                useAppStore.getState().setSessionDraft(
                  sid,
                  `Please review changes in \`${f.path}\`:\n`,
                );
                setRightPanel("tasks");
              }}
            >
              {t.sendToAgent}
            </button>
          </div>
        </div>
      ))}
      {patchPreview && (
        <>
          <div className="section-title">{patchPreview.path}</div>
          <pre className="code">{patchPreview.text}</pre>
        </>
      )}
    </div>
  );
}

function WorktreePanel() {
  const { settings, worktrees, setWorktrees } = useAppStore();
  const cwd = settings.cwd;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!cwd) return;
    setWorktrees(await listWorktrees(cwd));
  }, [cwd, setWorktrees]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onCreate() {
    if (!cwd) return;
    setBusy(true);
    setMsg(null);
    try {
      const review = await gitReview(cwd);
      let dirtyPolicy: "clean_head" | "copy_dirty" = "clean_head";
      if (review.state === "dirty") {
        const copy = window.confirm(
          `${t.dirtyPolicyPrompt}\nOK = ${t.dirtyPolicyCopy}\nCancel = ${t.dirtyPolicyClean}`,
        );
        dirtyPolicy = copy ? "copy_dirty" : "clean_head";
      }
      const branch = `task-${Date.now().toString(36)}`;
      await createWorktree({
        workspaceRoot: cwd,
        branch,
        dirtyPolicy,
      });
      await refresh();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(path: string) {
    if (!cwd) return;
    const preview = await worktreeDeletePreview(path);
    const ok = window.confirm(
      `${t.confirmDelete}\n${t.path}: ${preview.path}\n${t.branch}: ${preview.branch ?? "—"}\n${
        preview.dirty ? t.uncommitted : t.clean
      }`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      await deleteWorktree(path, cwd, true);
      await refresh();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel-body">
      <div className="row-actions">
        <button
          type="button"
          className="primary"
          disabled={!cwd || busy}
          onClick={() => void onCreate()}
        >
          {t.createWorktree}
        </button>
        <button type="button" className="ghost" onClick={() => void refresh()}>
          {t.refresh}
        </button>
      </div>
      {msg && <p className="hint">{msg}</p>}
      {worktrees.map((w) => (
        <div key={w.path} className="list-item">
          <strong>{w.branch ?? w.path}</strong>
          <span className="meta">
            {w.path}
            {w.dirty ? ` · ${t.uncommitted}` : ` · ${t.clean}`} · {w.source}
          </span>
          <div className="row-actions" style={{ marginTop: 6 }}>
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() => void onDelete(w.path)}
            >
              {t.deleteWorktree}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Inspector() {
  const {
    activeSessionId,
    sessions,
    rightPanel,
    setRightPanel,
    health,
    stderr,
    settings,
    setSettings,
  } = useAppStore();
  const session = activeSessionId ? sessions[activeSessionId] : null;

  const tabs: { id: RightPanel; label: string }[] = [
    { id: "health", label: t.health },
    { id: "tasks", label: t.tasks },
    { id: "plan", label: t.plan },
    { id: "diff", label: t.diff },
    { id: "worktree", label: t.worktrees },
    { id: "logs", label: t.logs },
    { id: "settings", label: t.settings },
  ];

  return (
    <aside className="inspector" aria-label={t.inspector}>
      <div className="tab-bar" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={rightPanel === tab.id}
            className={rightPanel === tab.id ? "tab active" : "tab"}
            onClick={() => setRightPanel(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {rightPanel === "health" && (
        <div className="panel-body">
          <ul className="checklist">
            {(health?.checklist ?? []).map((item) => (
              <li key={item.id} className={item.ok ? "ok" : "bad"}>
                {item.label}
                {item.detail && <span className="muted"> — {item.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {rightPanel === "tasks" && (
        <div className="panel-body">
          {(session?.tools ?? []).length === 0 && (
            <p className="empty">{t.selectItem}</p>
          )}
          {(session?.tools ?? []).map((tool) => (
            <div key={tool.id} className="block tool">
              <div className="label">
                {tool.title}
                <span className="pill">{tool.status}</span>
              </div>
              {tool.output != null && (
                <pre className="code">{safeJson(tool.output)}</pre>
              )}
            </div>
          ))}
        </div>
      )}
      {rightPanel === "plan" && (
        <div className="panel-body">
          <pre className="code">{session?.planText || "—"}</pre>
        </div>
      )}
      {rightPanel === "diff" && <DiffPanel />}
      {rightPanel === "worktree" && <WorktreePanel />}
      {rightPanel === "logs" && (
        <div className="panel-body">
          <pre className="code">{stderr.join("\n") || "—"}</pre>
        </div>
      )}
      {rightPanel === "settings" && (
        <div className="panel-body">
          <label>
            {t.grokPath}
            <input
              value={settings.grokPath}
              onChange={(e) => setSettings({ grokPath: e.target.value })}
            />
          </label>
          <label>
            {t.model}
            <input
              value={settings.model}
              onChange={(e) => setSettings({ model: e.target.value })}
            />
          </label>
          <label>
            {t.apiKey}
            <input
              type="password"
              value={settings.apiKey}
              onChange={(e) => setSettings({ apiKey: e.target.value })}
              autoComplete="off"
            />
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={settings.useHarness}
              onChange={(e) => setSettings({ useHarness: e.target.checked })}
            />
            {t.useHarness}
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={settings.alwaysApprove}
              onChange={(e) => setSettings({ alwaysApprove: e.target.checked })}
            />
            {t.alwaysApprove}
          </label>
          <button
            type="button"
            className="primary"
            onClick={() => void saveSettings(settings)}
          >
            {t.save}
          </button>
        </div>
      )}
    </aside>
  );
}

function Workbench() {
  const {
    settings,
    setSettings,
    status,
    setStatus,
    sessions,
    sessionOrder,
    activeSessionId,
    setActiveSession,
    ensureSession,
    setSessionDraft,
    setSessionBusy,
    setSessionScroll,
    addBlock,
    clearChat,
    pendingPermission,
    permissionOptions,
    setPermission,
    setHealth,
    workspaces,
    setWorkspaces,
    setInspector,
  } = useAppStore();

  const [connecting, setConnecting] = useState(false);
  const spineRef = useRef<HTMLDivElement>(null);
  const draftTimer = useRef<number | null>(null);

  const active = activeSessionId ? sessions[activeSessionId] : null;
  const draft = active?.draft ?? "";
  const blocks = active?.blocks ?? [];
  const busy = active?.busy ?? false;

  const refreshHealth = useCallback(async () => {
    setHealth(await runtimeHealth(settings.grokPath || undefined));
  }, [settings.grokPath, setHealth]);

  useEffect(() => {
    void refreshHealth();
    const tmr = setInterval(() => void refreshHealth(), 15000);
    return () => clearInterval(tmr);
  }, [refreshHealth]);

  useEffect(() => {
    void (async () => {
      try {
        setWorkspaces(await listWorkspaces());
        if (settings.cwd) {
          const rows = await listSessions(settings.cwd);
          for (const row of rows) ensureSession(row);
          if (rows[0]) setActiveSession(rows[0].sessionId);
        }
      } catch {
        /* catalog optional at boot */
      }
    })();
  }, [settings.cwd, ensureSession, setActiveSession, setWorkspaces]);

  // Restore scroll per session
  useEffect(() => {
    const el = spineRef.current;
    if (!el || !active) return;
    el.scrollTop = active.scrollTop;
  }, [activeSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  function onScroll() {
    if (!activeSessionId || !spineRef.current) return;
    setSessionScroll(activeSessionId, spineRef.current.scrollTop);
  }

  function onDraftChange(value: string) {
    if (!activeSessionId) return;
    setSessionDraft(activeSessionId, value);
    if (draftTimer.current) window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => {
      void saveDraft(activeSessionId, value);
    }, 400);
  }

  async function chooseWorkspace() {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir !== "string") return;
    setSettings({ cwd: dir });
    await upsertWorkspace(dir);
    setWorkspaces(await listWorkspaces());
  }

  async function createLocalSession() {
    const cwd = settings.cwd || ".";
    const now = new Date().toISOString();
    const summary: SessionSummary = {
      sessionId: crypto.randomUUID(),
      workspaceRoot: cwd,
      title: `Session ${new Date().toLocaleTimeString()}`,
      createdAt: now,
      updatedAt: now,
      runState: "idle",
      alwaysApprove: settings.alwaysApprove,
      draft: "",
      model: settings.model,
      remoteSessionId: status.sessionId ?? null,
    };
    ensureSession(summary);
    setActiveSession(summary.sessionId);
    try {
      await upsertSession(summary);
    } catch {
      /* ignore if not in tauri */
    }
  }

  async function connect() {
    if (!settings.cwd) {
      await chooseWorkspace();
      if (!useAppStore.getState().settings.cwd) return;
    }
    setConnecting(true);
    try {
      if (!activeSessionId) await createLocalSession();
      const st = await startAgent({
        cwd: useAppStore.getState().settings.cwd,
        model: settings.model,
        alwaysApprove: settings.alwaysApprove,
        useHarness: settings.useHarness,
        grokPath: settings.grokPath || null,
      });
      setStatus(st);
      const sid = useAppStore.getState().activeSessionId;
      if (sid && st.sessionId) {
        useAppStore.getState().updateSummary(sid, {
          remoteSessionId: st.sessionId,
          connectionId: st.connectionId ?? null,
          runState: "idle",
        });
      }
      await refreshHealth();
    } catch (e) {
      const sid = useAppStore.getState().activeSessionId;
      if (sid) {
        addBlock(sid, {
          type: "system",
          id: crypto.randomUUID(),
          text: String(e),
          level: "error",
        });
      }
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    await stopAgent();
    setStatus({ running: false });
  }

  async function restart() {
    setConnecting(true);
    try {
      const st = await restartAgent({
        cwd: settings.cwd,
        model: settings.model,
        alwaysApprove: settings.alwaysApprove,
        useHarness: settings.useHarness,
        grokPath: settings.grokPath || null,
      });
      setStatus(st);
    } finally {
      setConnecting(false);
    }
  }

  async function onSend() {
    const text = draft.trim();
    if (!text || !activeSessionId) return;
    addBlock(activeSessionId, {
      type: "user",
      id: crypto.randomUUID(),
      text,
    });
    setSessionDraft(activeSessionId, "");
    void saveDraft(activeSessionId, "");
    setSessionBusy(activeSessionId, true);
    try {
      if (!status.running) await connect();
      await sendPrompt(text);
    } catch (e) {
      addBlock(activeSessionId, {
        type: "system",
        id: crypto.randomUUID(),
        text: String(e),
        level: "error",
      });
    } finally {
      setSessionBusy(activeSessionId, false);
    }
  }

  async function answerPermission(optionId: string | null) {
    if (!pendingPermission) return;
    try {
      if (optionId) {
        await respondServerRequest(pendingPermission.id, {
          outcome: { outcome: "selected", optionId },
        });
      } else {
        await respondServerRequest(pendingPermission.id, undefined, {
          code: -32000,
          message: "User denied permission",
        });
      }
    } finally {
      setPermission(null);
    }
  }

  const sessionList = useMemo(
    () => sessionOrder.map((id) => sessions[id]).filter(Boolean),
    [sessionOrder, sessions],
  );

  return (
    <div className="workbench">
      <header className="topbar">
        <div className="brand">
          <span className="logo">GB</span>
          <div>
            <div className="title">{t.appName}</div>
            <div className="subtitle">
              {settings.model}
              {settings.useHarness ? " · harness" : ""}
              {settings.alwaysApprove ? " · yolo" : ""}
              {" · "}
              {t.parallelHint}
            </div>
          </div>
        </div>
        <div className="top-actions">
          <span className={`badge ${status.running ? "on" : "off"}`}>
            {status.running ? t.connected : t.offline}
          </span>
          {status.running ? (
            <>
              <button type="button" className="ghost" onClick={() => void restart()}>
                {t.restart}
              </button>
              <button type="button" className="danger" onClick={() => void disconnect()}>
                {t.disconnect}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={connecting}
              onClick={() => void connect()}
            >
              {connecting ? t.connecting : t.connect}
            </button>
          )}
        </div>
      </header>

      <div className="main-grid">
        <aside className="sidebar" aria-label={t.sessions}>
          <div className="panel-head">
            <span>{t.workspaces}</span>
            <button type="button" className="ghost" onClick={() => void chooseWorkspace()}>
              {t.openWorkspace}
            </button>
          </div>
          <div className="panel-body">
            <div className="muted" style={{ marginBottom: 8 }}>
              {settings.cwd || t.noWorkspace}
            </div>
            {workspaces.map((w) => (
              <button
                key={w.id}
                type="button"
                className={
                  w.path === settings.cwd ? "list-item active" : "list-item"
                }
                onClick={() => setSettings({ cwd: w.path })}
              >
                {w.name}
                <span className="meta">{w.path}</span>
              </button>
            ))}
            <div className="section-title">{t.sessions}</div>
            <button
              type="button"
              className="primary"
              style={{ width: "100%", marginBottom: 8 }}
              onClick={() => void createLocalSession()}
            >
              {t.newSession}
            </button>
            {sessionList.map((s) => (
              <button
                key={s.summary.sessionId}
                type="button"
                className={
                  s.summary.sessionId === activeSessionId
                    ? "list-item active"
                    : "list-item"
                }
                onClick={() => setActiveSession(s.summary.sessionId)}
              >
                {s.summary.title}
                <span className="meta">
                  {t.runState[s.summary.runState] ?? s.summary.runState}
                  {s.busy ? " · …" : ""}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <main className="spine" aria-label="Execution spine">
          <div
            className="spine-scroll"
            ref={spineRef}
            onScroll={onScroll}
          >
            {blocks.length === 0 && <p className="empty">{t.emptySpine}</p>}
            {blocks.map((b) => (
              <BlockView
                key={b.id}
                block={b}
                onSelectTool={(id) => {
                  if (activeSessionId) {
                    setInspector(activeSessionId, {
                      kind: "tool",
                      toolCallId: id,
                    });
                    useAppStore.getState().setRightPanel("tasks");
                  }
                }}
              />
            ))}
          </div>
          <div className="composer">
            <textarea
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              placeholder={t.draftPlaceholder}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void onSend();
                }
              }}
              aria-label={t.draftPlaceholder}
            />
            <div className="row-actions end">
              <button
                type="button"
                className="ghost"
                disabled={!activeSessionId}
                onClick={() => activeSessionId && clearChat(activeSessionId)}
              >
                {t.clear}
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy || !draft.trim()}
                onClick={() => void onSend()}
              >
                {busy ? "…" : t.send}
              </button>
            </div>
          </div>
        </main>

        <Inspector />
      </div>

      {pendingPermission && (
        <div className="permission-modal" role="dialog" aria-modal="true">
          <div className="permission-card">
            <h3>{t.permissionTitle}</h3>
            <p>
              Method: <code>{pendingPermission.method}</code>
            </p>
            <pre className="code">{safeJson(pendingPermission.params)}</pre>
            <div className="row-actions">
              {permissionOptions.length === 0 ? (
                <button
                  type="button"
                  className="danger"
                  onClick={() => void answerPermission(null)}
                >
                  {t.permissionDismiss}
                </button>
              ) : (
                permissionOptions.map((opt) => {
                  const reject =
                    opt.kind === "reject_once" || opt.kind === "reject_always";
                  return (
                    <button
                      key={opt.optionId}
                      type="button"
                      className={reject ? "danger" : "primary"}
                      onClick={() => void answerPermission(opt.optionId)}
                    >
                      {opt.name}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const {
    settings,
    replaceSettings,
    settingsLoaded,
    setSettingsLoaded,
    setHealth,
  } = useAppStore();
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    let unsubs: (() => void)[] = [];
    void (async () => {
      try {
        const s = await loadSettings();
        replaceSettings(s);
        setSettingsLoaded(true);
        setHealth(await runtimeHealth(s.grokPath || undefined));
        unsubs = await subscribeAcpEvents();
      } catch (e) {
        setBootError(String(e));
        setSettingsLoaded(true);
      }
    })();
    return () => {
      for (const u of unsubs) u();
    };
  }, [replaceSettings, setSettingsLoaded, setHealth]);

  if (!settingsLoaded) {
    return (
      <div className="onboarding">
        <p className="muted">…</p>
      </div>
    );
  }

  if (bootError) {
    return (
      <div className="onboarding">
        <div className="onboarding-card">
          <p className="block system error">{bootError}</p>
        </div>
      </div>
    );
  }

  if (!settings.onboardingDone) {
    return <Onboarding />;
  }

  return <Workbench />;
}

// silence unused Settings import lint in some tsconfigs
void (null as unknown as Settings);
