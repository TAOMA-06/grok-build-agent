import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  loadSettings,
  probeGrok,
  respondServerRequest,
  restartAgent,
  runtimeHealth,
  saveSettings,
  sendPrompt,
  startAgent,
  stopAgent,
  subscribeAcpEvents,
} from "./acp/client";
import { useAppStore } from "./store";
import type { ChatBlock, RightPanel, Settings } from "./types";
import "./App.css";

function safeJson(v: unknown): string {
  try {
    const s = typeof v === "string" ? v : JSON.stringify(v, null, 2);
    return s.length > 4000 ? s.slice(0, 4000) + "\n…" : s;
  } catch {
    return String(v);
  }
}

function BlockView({ block }: { block: ChatBlock }) {
  switch (block.type) {
    case "user":
      return (
        <div className="block user">
          <div className="label">You</div>
          <div className="body">{block.text}</div>
        </div>
      );
    case "assistant":
      return (
        <div className="block assistant">
          <div className="label">Grok</div>
          <div className="body pre">{block.text}</div>
        </div>
      );
    case "thought":
      return (
        <details className="block thought">
          <summary>Thinking</summary>
          <div className="body pre muted">{block.text}</div>
        </details>
      );
    case "tool":
      return (
        <div className={`block tool status-${block.tool.status}`}>
          <div className="label">
            Tool · {block.tool.title}
            <span className="pill">{block.tool.status}</span>
          </div>
          {block.tool.input != null && (
            <pre className="code">{safeJson(block.tool.input)}</pre>
          )}
          {block.tool.output != null && (
            <pre className="code out">{safeJson(block.tool.output)}</pre>
          )}
        </div>
      );
    case "plan":
      return (
        <div className="block plan">
          <div className="label">Plan</div>
          <div className="body pre">{block.text}</div>
        </div>
      );
    case "system":
      return (
        <div className={`block system ${block.level ?? "info"}`}>
          <div className="body">{block.text}</div>
        </div>
      );
  }
}

function Onboarding({
  onDone,
}: {
  onDone: (s: Settings) => void;
}) {
  const { settings, setSettings, health, setHealth } = useAppStore();
  const [step, setStep] = useState(0);
  const [checking, setChecking] = useState(false);

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      const h = await runtimeHealth(settings.grokPath || undefined);
      setHealth(h);
      if (h.grok.path && !settings.grokPath) {
        setSettings({ grokPath: h.grok.path });
      }
    } finally {
      setChecking(false);
    }
  }, [settings.grokPath, setHealth, setSettings]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function pickWorkspace() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setSettings({ cwd: selected });
    }
  }

  async function finish() {
    const next: Settings = {
      ...settings,
      onboardingDone: true,
    };
    await saveSettings(next);
    onDone(next);
  }

  return (
    <div className="onboarding">
      <div className="onboarding-card">
        <div className="brand-row">
          <span className="logo">GB</span>
          <div>
            <h1>Grok Build Desktop</h1>
            <p className="muted">
              Hermes-style desktop shell · Grok Build as the agent runtime
            </p>
          </div>
        </div>

        <div className="steps">
          <button
            type="button"
            className={step === 0 ? "step active" : "step"}
            onClick={() => setStep(0)}
          >
            1. Runtime
          </button>
          <button
            type="button"
            className={step === 1 ? "step active" : "step"}
            onClick={() => setStep(1)}
          >
            2. Workspace
          </button>
          <button
            type="button"
            className={step === 2 ? "step active" : "step"}
            onClick={() => setStep(2)}
          >
            3. Agent
          </button>
        </div>

        {step === 0 && (
          <section className="panel-body">
            <h2>Detect Grok Build CLI</h2>
            <p className="muted">
              This app does not ship the model runtime. It manages your local{" "}
              <code>grok</code> process over ACP (like Hermes manages its Core).
            </p>
            <label>
              Grok binary path (optional)
              <input
                value={settings.grokPath}
                onChange={(e) => setSettings({ grokPath: e.target.value })}
                placeholder="~/.grok/bin/grok"
              />
            </label>
            <label>
              API key (optional if you use <code>grok login</code>)
              <input
                type="password"
                value={settings.apiKey}
                onChange={(e) => setSettings({ apiKey: e.target.value })}
                placeholder="xai-…"
              />
            </label>
            <div className="row-actions">
              <button type="button" className="ghost" onClick={() => void refresh()}>
                {checking ? "Checking…" : "Re-check health"}
              </button>
            </div>
            <ul className="checklist">
              {(health?.checklist ?? []).map((item) => (
                <li key={item.id} className={item.ok ? "ok" : "bad"}>
                  <strong>{item.ok ? "✓" : "✗"}</strong> {item.label}
                  {item.detail && <span className="muted"> — {item.detail}</span>}
                </li>
              ))}
            </ul>
            {!health?.ready && (
              <div className="hint">
                Install Grok Build, then run <code>grok login</code> or set{" "}
                <code>XAI_API_KEY</code> / paste a key above.
              </div>
            )}
            <div className="row-actions end">
              <button
                type="button"
                className="primary"
                disabled={!health?.grok.found}
                onClick={() => setStep(1)}
              >
                Continue
              </button>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="panel-body">
            <h2>Choose a workspace</h2>
            <p className="muted">
              Agent sessions run with this folder as <code>cwd</code>.
            </p>
            <button type="button" className="ghost" onClick={() => void pickWorkspace()}>
              Open folder…
            </button>
            <code className="cwd-line">{settings.cwd || "No folder selected"}</code>
            <div className="row-actions end">
              <button type="button" className="ghost" onClick={() => setStep(0)}>
                Back
              </button>
              <button
                type="button"
                className="primary"
                disabled={!settings.cwd}
                onClick={() => setStep(2)}
              >
                Continue
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="panel-body">
            <h2>Agent defaults</h2>
            <label>
              Model
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
              Inject orchestrator harness (plan + parallel subagents)
            </label>
            <label className="row">
              <input
                type="checkbox"
                checked={settings.alwaysApprove}
                onChange={(e) => setSettings({ alwaysApprove: e.target.checked })}
              />
              Always approve tools (YOLO — use carefully)
            </label>
            <div className="row-actions end">
              <button type="button" className="ghost" onClick={() => setStep(1)}>
                Back
              </button>
              <button type="button" className="primary" onClick={() => void finish()}>
                Enter workbench
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function RightPanelView() {
  const {
    rightPanel,
    health,
    status,
    tools,
    planText,
    stderr,
    settings,
    setSettings,
  } = useAppStore();

  if (rightPanel === "health") {
    return (
      <div className="side-panel">
        <h3>Runtime health</h3>
        <div className={`ready-pill ${health?.ready ? "on" : "off"}`}>
          {health?.ready ? "Ready" : "Not ready"}
        </div>
        <ul className="checklist compact">
          {(health?.checklist ?? []).map((item) => (
            <li key={item.id} className={item.ok ? "ok" : "bad"}>
              <strong>{item.ok ? "✓" : "✗"}</strong> {item.label}
              {item.detail && (
                <div className="muted small">{item.detail}</div>
              )}
            </li>
          ))}
        </ul>
        <div className="meta">
          <div>
            <span className="muted">Session</span>
            <code>{status.sessionId ?? "—"}</code>
          </div>
          <div>
            <span className="muted">Agent</span>
            <code>{status.running ? "running" : "stopped"}</code>
          </div>
          {status.lastError && (
            <div className="error-text">{status.lastError}</div>
          )}
        </div>
      </div>
    );
  }

  if (rightPanel === "tasks") {
    return (
      <div className="side-panel">
        <h3>Tasks / tools</h3>
        {tools.length === 0 ? (
          <p className="muted">Tool calls will appear here.</p>
        ) : (
          <ul className="task-list">
            {[...tools].reverse().map((t) => (
              <li key={t.id}>
                <span className="pill">{t.status}</span> {t.title}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (rightPanel === "plan") {
    return (
      <div className="side-panel">
        <h3>Plan</h3>
        {planText ? (
          <pre className="code plan-body">{planText}</pre>
        ) : (
          <p className="muted">
            When the agent enters plan mode, the plan shows here. Approve UX
            lands next; for now review in chat.
          </p>
        )}
      </div>
    );
  }

  if (rightPanel === "logs") {
    return (
      <div className="side-panel">
        <h3>Agent stderr</h3>
        <pre className="code log-body">
          {stderr.length ? stderr.slice(-80).join("\n") : "No stderr yet."}
        </pre>
      </div>
    );
  }

  // settings
  return (
    <div className="side-panel">
      <h3>Settings</h3>
      <label>
        Grok path
        <input
          value={settings.grokPath}
          onChange={(e) => setSettings({ grokPath: e.target.value })}
        />
      </label>
      <label>
        Model
        <input
          value={settings.model}
          onChange={(e) => setSettings({ model: e.target.value })}
        />
      </label>
      <label>
        API key
        <input
          type="password"
          value={settings.apiKey}
          onChange={(e) => setSettings({ apiKey: e.target.value })}
        />
      </label>
      <label className="row">
        <input
          type="checkbox"
          checked={settings.useHarness}
          onChange={(e) => setSettings({ useHarness: e.target.checked })}
        />
        Orchestrator harness
      </label>
      <label className="row">
        <input
          type="checkbox"
          checked={settings.alwaysApprove}
          onChange={(e) => setSettings({ alwaysApprove: e.target.checked })}
        />
        Always approve (YOLO)
      </label>
      <button
        type="button"
        className="primary"
        onClick={() => void saveSettings(settings)}
      >
        Save
      </button>
    </div>
  );
}

function Workbench() {
  const {
    settings,
    setSettings,
    status,
    setStatus,
    blocks,
    busy,
    setBusy,
    addBlock,
    clearChat,
    pendingPermission,
    setPermission,
    rightPanel,
    setRightPanel,
    setHealth,
  } = useAppStore();

  const [input, setInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const refreshHealth = useCallback(async () => {
    const h = await runtimeHealth(settings.grokPath || undefined);
    setHealth(h);
  }, [settings.grokPath, setHealth]);

  useEffect(() => {
    void refreshHealth();
    const t = setInterval(() => void refreshHealth(), 15000);
    return () => clearInterval(t);
  }, [refreshHealth]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [blocks, busy]);

  async function pickFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      const next = { ...settings, cwd: selected };
      setSettings({ cwd: selected });
      await saveSettings(next);
    }
  }

  async function connect() {
    if (!settings.cwd) {
      addBlock({
        type: "system",
        id: crypto.randomUUID(),
        text: "Choose a workspace folder first.",
        level: "warn",
      });
      return;
    }
    setConnecting(true);
    clearChat();
    try {
      await saveSettings(settings);
      const s = await startAgent({
        grokPath: settings.grokPath || null,
        model: settings.model || "grok-build",
        alwaysApprove: settings.alwaysApprove,
        cwd: settings.cwd,
        useHarness: settings.useHarness,
      });
      setStatus(s);
      addBlock({
        type: "system",
        id: crypto.randomUUID(),
        text: `Connected · session ${s.sessionId ?? "?"} · ${s.cwd ?? settings.cwd}`,
        level: "info",
      });
      await refreshHealth();
    } catch (e) {
      addBlock({
        type: "system",
        id: crypto.randomUUID(),
        text: String(e),
        level: "error",
      });
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    try {
      await stopAgent();
      setStatus({ running: false });
      addBlock({
        type: "system",
        id: crypto.randomUUID(),
        text: "Agent stopped.",
        level: "info",
      });
    } catch (e) {
      addBlock({
        type: "system",
        id: crypto.randomUUID(),
        text: String(e),
        level: "error",
      });
    }
  }

  async function restart() {
    if (!settings.cwd) return;
    setConnecting(true);
    try {
      await saveSettings(settings);
      const s = await restartAgent({
        grokPath: settings.grokPath || null,
        model: settings.model || "grok-build",
        alwaysApprove: settings.alwaysApprove,
        cwd: settings.cwd,
        useHarness: settings.useHarness,
      });
      setStatus(s);
      addBlock({
        type: "system",
        id: crypto.randomUUID(),
        text: "Agent restarted.",
        level: "info",
      });
    } catch (e) {
      addBlock({
        type: "system",
        id: crypto.randomUUID(),
        text: String(e),
        level: "error",
      });
    } finally {
      setConnecting(false);
    }
  }

  async function onSend() {
    const text = input.trim();
    if (!text || busy) return;
    if (!status.running) {
      addBlock({
        type: "system",
        id: crypto.randomUUID(),
        text: "Connect to Grok first.",
        level: "warn",
      });
      return;
    }
    setInput("");
    addBlock({ type: "user", id: crypto.randomUUID(), text });
    setBusy(true);
    try {
      await sendPrompt(text);
    } catch (e) {
      addBlock({
        type: "system",
        id: crypto.randomUUID(),
        text: String(e),
        level: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function answerPermission(allow: boolean) {
    if (!pendingPermission) return;
    try {
      if (allow) {
        await respondServerRequest(pendingPermission.id, {
          outcome: { outcome: "selected", optionId: "allow-once" },
          approved: true,
        });
      } else {
        await respondServerRequest(pendingPermission.id, undefined, {
          code: -32000,
          message: "User denied permission",
        });
      }
    } catch (e) {
      addBlock({
        type: "system",
        id: crypto.randomUUID(),
        text: `Permission response failed: ${e}`,
        level: "error",
      });
    } finally {
      setPermission(null);
    }
  }

  const connected = status.running;
  const tabs: { id: RightPanel; label: string }[] = [
    { id: "health", label: "Health" },
    { id: "tasks", label: "Tasks" },
    { id: "plan", label: "Plan" },
    { id: "logs", label: "Logs" },
    { id: "settings", label: "Settings" },
  ];

  return (
    <div className="workbench">
      <header className="topbar">
        <div className="brand">
          <span className="logo">GB</span>
          <div>
            <div className="title">Grok Build Desktop</div>
            <div className="subtitle">
              {settings.model}
              {settings.useHarness ? " · harness" : ""}
              {settings.alwaysApprove ? " · yolo" : ""}
            </div>
          </div>
        </div>
        <div className="top-actions">
          <span className={`badge ${connected ? "on" : "off"}`}>
            {connected ? "connected" : "offline"}
          </span>
          {connected ? (
            <>
              <button type="button" className="ghost" onClick={() => void restart()}>
                Restart
              </button>
              <button type="button" className="danger" onClick={() => void disconnect()}>
                Disconnect
              </button>
            </>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={connecting}
              onClick={() => void connect()}
            >
              {connecting ? "Connecting…" : "Connect"}
            </button>
          )}
        </div>
      </header>

      <div className="workbench-body">
        <aside className="left-rail">
          <div className="rail-section">
            <div className="rail-title">Workspace</div>
            <button type="button" className="ghost full" onClick={() => void pickFolder()}>
              Change folder
            </button>
            <code className="cwd-line">{settings.cwd || "—"}</code>
          </div>
          <div className="rail-section">
            <div className="rail-title">Sessions</div>
            <p className="muted small">
              Current session is managed by Grok ACP. Multi-session archive lands
              next.
            </p>
            {status.sessionId && (
              <code className="session-id">{status.sessionId}</code>
            )}
            <button type="button" className="ghost full" onClick={() => clearChat()}>
              Clear chat view
            </button>
          </div>
          <div className="rail-section grow">
            <div className="rail-title">Quick prompts</div>
            {[
              "Explore this repo and summarize architecture.",
              "Plan a safe refactor for the highest-risk module.",
              "Run tests and fix failures.",
            ].map((q) => (
              <button
                key={q}
                type="button"
                className="ghost full left"
                onClick={() => setInput(q)}
              >
                {q}
              </button>
            ))}
          </div>
        </aside>

        <main className="chat-col">
          <div className="chat">
            {blocks.length === 0 && (
              <div className="empty">
                <h2>Workbench</h2>
                <p>
                  Connect, then ask Grok to explore, plan, or implement. Thoughts,
                  tools, and plans stream into the center; health and tasks sit on
                  the right — same product shape as Hermes, powered by Grok Build.
                </p>
              </div>
            )}
            {blocks.map((b) => (
              <BlockView key={b.id} block={b} />
            ))}
            {busy && <div className="typing">Agent working…</div>}
            <div ref={bottomRef} />
          </div>
          <footer className="composer">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                connected
                  ? "Ask Grok to explore, plan, or implement…"
                  : "Connect to start a session…"
              }
              rows={3}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void onSend();
                }
              }}
              disabled={!connected || busy}
            />
            <button
              type="button"
              className="primary send"
              disabled={!connected || busy || !input.trim()}
              onClick={() => void onSend()}
            >
              Send ⌘↵
            </button>
          </footer>
        </main>

        <aside className="right-rail">
          <div className="tab-bar">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                className={rightPanel === t.id ? "tab active" : "tab"}
                onClick={() => setRightPanel(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <RightPanelView />
        </aside>
      </div>

      {pendingPermission && (
        <div className="permission-modal">
          <div className="permission-card">
            <h3>Permission required</h3>
            <p>
              Method: <code>{pendingPermission.method}</code>
            </p>
            <pre className="code">{safeJson(pendingPermission.params)}</pre>
            <div className="row-actions">
              <button
                type="button"
                className="danger"
                onClick={() => void answerPermission(false)}
              >
                Deny
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void answerPermission(true)}
              >
                Allow once
              </button>
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
        unsubs = await subscribeAcpEvents();
        const s = await loadSettings();
        replaceSettings(s);
        setSettingsLoaded(true);
        const h = await runtimeHealth(s.grokPath || undefined);
        setHealth(h);
        // Warm probe
        await probeGrok(s.grokPath || undefined);
      } catch (e) {
        setBootError(String(e));
        setSettingsLoaded(true);
      }
    })();
    return () => unsubs.forEach((u) => u());
  }, [replaceSettings, setHealth, setSettingsLoaded]);

  if (!settingsLoaded) {
    return (
      <div className="boot">
        <div className="logo">GB</div>
        <p>Starting…</p>
      </div>
    );
  }

  if (bootError) {
    return (
      <div className="boot">
        <p className="error-text">{bootError}</p>
      </div>
    );
  }

  if (!settings.onboardingDone) {
    return (
      <Onboarding
        onDone={(s) => {
          replaceSettings(s);
        }}
      />
    );
  }

  return <Workbench />;
}
