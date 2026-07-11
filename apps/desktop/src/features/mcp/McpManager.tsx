import { useCallback, useEffect, useState } from "react";
import { Dialog } from "../../components/ui/Dialog";
import { Field } from "../../components/ui/Field";
import { KeyValueEditor } from "../../components/ui/KeyValueEditor";
import { StatusBanner } from "../../components/ui/StatusBanner";
import { emptyMcpServerInput } from "../../contracts";
import { t, translate } from "../../i18n";
import { useAppStore } from "../../store";
import { useDesktopBridge } from "../../platform/DesktopBridge";
import type {
  McpDoctorResult,
  McpScope,
  McpServerInfo,
  McpServerInput,
  McpTransport,
} from "../../types";

export function ArgListEditor({
  args,
  onChange,
}: {
  args: string[];
  onChange: (args: string[]) => void;
}) {
  return (
    <div className="mcp-args-editor">
      {args.map((arg, index) => (
        <div className="mcp-arg-row" key={`${index}-${arg}`}>
          <input
            aria-label={translate("argument", { number: index + 1 })}
            value={arg}
            onChange={(event) => {
              const next = [...args];
              next[index] = event.target.value;
              onChange(next);
            }}
          />
          <button type="button" className="ghost" disabled={index === 0} onClick={() => {
            const next = [...args];
            [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
            onChange(next);
          }}>↑</button>
          <button type="button" className="ghost" disabled={index === args.length - 1} onClick={() => {
            const next = [...args];
            [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
            onChange(next);
          }}>↓</button>
          <button type="button" className="danger" aria-label={translate("removeArgument", { number: index + 1 })} onClick={() => onChange(args.filter((_, itemIndex) => itemIndex !== index))}>×</button>
        </div>
      ))}
      <button type="button" className="ghost" onClick={() => onChange([...args, ""])}>+ {t.mcpArgs}</button>
    </div>
  );
}

export function McpManager({
  onReloadAgent,
}: {
  onReloadAgent?: () => void | Promise<void>;
}) {
  const bridge = useDesktopBridge();
  const { settings, agentReloadRequired, setAgentReloadRequired } = useAppStore();
  const [servers, setServers] = useState<McpServerInfo[]>([]);
  const [userConfigPath, setUserConfigPath] = useState("");
  const [projectConfigPath, setProjectConfigPath] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<McpServerInput | null>(null);
  const [isNew, setIsNew] = useState(true);
  const [doctorByName, setDoctorByName] = useState<Record<string, McpDoctorResult>>({});

  const refresh = useCallback(async () => {
    try {
      const result = await bridge.listMcpServers(
        settings.grokPath || undefined,
        settings.cwd || null,
      );
      setServers(result.servers ?? []);
      setUserConfigPath(result.userConfigPath ?? "");
      setProjectConfigPath(result.projectConfigPath ?? null);
      setMsg(null);
    } catch (e) {
      setServers([]);
      setMsg(String(e));
    }
  }, [bridge, settings.grokPath, settings.cwd]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function openCreate() {
    setIsNew(true);
    setEditing({
      ...emptyMcpServerInput("user"),
      workspaceRoot: settings.cwd || null,
    });
  }

  function openEdit(server: McpServerInfo) {
    setIsNew(false);
    setEditing({
      name: server.name,
      scope: server.scope,
      transport: server.transport,
      commandOrUrl: server.url || server.command || server.displayTarget || "",
      args: server.args ?? [],
      env: (server.envKeys ?? []).map((key) => ({
        key,
        value: null,
        action: "keep" as const,
      })),
      headers: (server.headerKeys ?? []).map((key) => ({
        key,
        value: null,
        action: "keep" as const,
      })),
      workspaceRoot: settings.cwd || null,
    });
  }

  async function save() {
    if (!editing) return;
    if (!editing.name.trim() || !editing.commandOrUrl.trim()) {
      setMsg(t.mcpRequired);
      return;
    }
    if (editing.scope === "project") {
      const path =
        projectConfigPath ||
        (settings.cwd ? `${settings.cwd}/.grok/config.toml` : ".grok/config.toml");
      const ok = window.confirm(
        `${t.mcpProjectPath}: ${path}\n\n${t.mcpProjectWarn}`,
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      await bridge.upsertMcpServer(
        {
          ...editing,
          workspaceRoot: settings.cwd || null,
        },
        settings.grokPath || undefined,
      );
      setEditing(null);
      setAgentReloadRequired(true);
      await refresh();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(server: McpServerInfo) {
    if (!window.confirm(`${t.confirmDelete}: ${server.name}?`)) return;
    setBusy(true);
    try {
      await bridge.removeMcpServer(server.name, {
        grokPath: settings.grokPath || undefined,
        scope: server.scope,
        workspaceRoot: settings.cwd || null,
      });
      setAgentReloadRequired(true);
      await refresh();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doctor(name?: string) {
    setBusy(true);
    try {
      const results = await bridge.doctorMcpServer(name ?? null, {
        grokPath: settings.grokPath || undefined,
        workspaceRoot: settings.cwd || null,
      });
      const map = { ...doctorByName };
      for (const r of results) {
        map[r.name] = r;
      }
      setDoctorByName(map);
      setMsg(null);
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  const anyBusySession = Object.values(useAppStore.getState().sessions).some(
    (s) => s.busy,
  );

  return (
    <div className="capability-center panel-body">
      <div className="row-actions" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0, flex: 1 }}>{t.capabilityCenter}</h2>
        <button type="button" className="ghost" disabled={busy} onClick={() => void refresh()}>
          {t.mcpRefresh}
        </button>
        <button type="button" className="primary" disabled={busy} onClick={openCreate}>
          {t.mcpAdd}
        </button>
      </div>

      <StatusBanner kind="info">{t.mcpTrustHint}</StatusBanner>
      <p className="hint mono">
        {t.mcpScopeUser}: {userConfigPath || "~/.grok/config.toml"}
        {projectConfigPath ? (
          <>
            <br />
            {t.mcpScopeProject}: {projectConfigPath}
          </>
        ) : null}
      </p>

      {agentReloadRequired && (
        <StatusBanner
          kind="warn"
          action={
            <button
              type="button"
              className="primary"
              disabled={anyBusySession}
              onClick={() => void onReloadAgent?.()}
            >
              {t.mcpReloadNow}
            </button>
          }
        >
          {t.mcpReloadRequired}
          {anyBusySession ? ` · ${t.mcpReloadIdle}` : ""}
        </StatusBanner>
      )}

      {msg && <p className="hint">{msg}</p>}

      {servers.length === 0 && <p className="empty">{t.noMcp}</p>}
      <div className="mcp-grid">
        {servers.map((s) => {
          const doc = doctorByName[s.name] ?? s.lastDoctor;
          return (
            <div key={`${s.scope}:${s.name}`} className="mcp-card list-item">
              <div className="row-actions" style={{ justifyContent: "space-between" }}>
                <strong>{s.name}</strong>
                <span className="pill">{s.transport}</span>
              </div>
              <span className="meta">
                {s.scope} · {s.displayTarget || s.command || s.url || "—"}
              </span>
              <span className="meta">
                {t.mcpStatus}: {doc ? (doc.ok ? t.mcpOk : t.mcpError) : s.status ?? t.configured}
              </span>
              {s.envKeys.length > 0 && (
                <span className="meta">
                  env: {s.envKeys.map((k) => `${k}=***`).join(", ")}
                </span>
              )}
              {s.headerKeys.length > 0 && (
                <span className="meta">
                  headers: {s.headerKeys.map((k) => `${k}=***`).join(", ")}
                </span>
              )}
              {doc && (
                <div className="doctor-result">
                  <span className={doc.ok ? "ok" : "bad"}>{doc.summary}</span>
                  {doc.tools.length > 0 ? (
                    <ul className="tool-list">
                      {doc.tools.map((tool) => (
                        <li key={tool.name}>
                          <code>{tool.name}</code>
                          {tool.description ? ` — ${tool.description}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="muted"> · {t.mcpNoTools}</span>
                  )}
                </div>
              )}
              <div className="row-actions" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => openEdit(s)}
                >
                  {t.mcpEdit}
                </button>
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => void doctor(s.name)}
                >
                  {t.mcpDoctor}
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={() => void remove(s)}
                >
                  {t.mcpRemove}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <Dialog
        open={!!editing}
        title={isNew ? t.mcpAdd : t.mcpEdit}
        onClose={() => setEditing(null)}
        wide
      >
        {editing && (
          <div className="mcp-form">
            <Field label={t.mcpName}>
              <input
                value={editing.name}
                disabled={!isNew}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
              />
            </Field>
            <Field label={t.mcpTransport}>
              <select
                value={editing.transport}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    transport: e.target.value as McpTransport,
                  })
                }
              >
                <option value="stdio">stdio</option>
                <option value="http">http</option>
                <option value="sse">sse</option>
              </select>
            </Field>
            <Field label={t.mcpScope}>
              <select
                value={editing.scope}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    scope: e.target.value as McpScope,
                  })
                }
              >
                <option value="user">{t.mcpScopeUser}</option>
                <option value="project">{t.mcpScopeProject}</option>
              </select>
            </Field>
            <Field
              label={
                editing.transport === "stdio" ? t.mcpCommand : t.mcpUrl
              }
            >
              <input
                value={editing.commandOrUrl}
                onChange={(e) =>
                  setEditing({ ...editing, commandOrUrl: e.target.value })
                }
                placeholder={
                  editing.transport === "stdio"
                    ? "npx"
                    : "https://mcp.example.com"
                }
              />
            </Field>
            {editing.transport === "stdio" && (
              <Field label={t.mcpArgs}>
                <ArgListEditor
                  args={editing.args}
                  onChange={(args) => setEditing({ ...editing, args })}
                />
              </Field>
            )}
            <KeyValueEditor
              label={t.mcpEnv}
              rows={editing.env}
              onChange={(env) => setEditing({ ...editing, env })}
            />
            {(editing.transport === "http" || editing.transport === "sse") && (
              <KeyValueEditor
                label={t.mcpHeaders}
                rows={editing.headers}
                onChange={(headers) => setEditing({ ...editing, headers })}
              />
            )}
            <div className="row-actions end" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="ghost"
                onClick={() => setEditing(null)}
              >
                {t.cancel}
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void save()}
              >
                {t.save}
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
