import {
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Globe2,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldCheck,
  Stethoscope,
  Terminal,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Dialog } from "../../components/ui/Dialog";
import { KeyValueEditor } from "../../components/ui/KeyValueEditor";
import { describeError, emptyMcpServerInput } from "../../contracts";
import { t, translate } from "../../i18n";
import { useDesktopBridge } from "../../platform/DesktopBridge";
import { useAppStore } from "../../store";
import { formatFailureForTimeline } from "../shell/errorPresentation";
import type {
  McpDoctorResult,
  McpScope,
  McpServerInfo,
  McpServerInput,
  McpTransport,
} from "../../types";
import "./mcp-codex.css";

function explainMcpError(error: unknown): string {
  return formatFailureForTimeline(describeError(error));
}

function McpField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="gb-mcp-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function TransportIcon({ transport }: { transport: McpTransport }) {
  if (transport === "stdio") {
    return <Terminal aria-hidden="true" size={15} />;
  }
  return <Globe2 aria-hidden="true" size={15} />;
}

export function ArgListEditor({
  args,
  onChange,
}: {
  args: string[];
  onChange: (args: string[]) => void;
}) {
  return (
    <div className="gb-mcp-args-editor">
      {args.map((arg, index) => (
        <div className="gb-mcp-arg-row" key={`${index}-${arg}`}>
          <input
            aria-label={translate("argument", { number: index + 1 })}
            value={arg}
            onChange={(event) => {
              const next = [...args];
              next[index] = event.target.value;
              onChange(next);
            }}
          />
          <button
            type="button"
            className="gb-mcp-icon-button"
            aria-label="↑"
            disabled={index === 0}
            onClick={() => {
              const next = [...args];
              [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
              onChange(next);
            }}
          >
            <ChevronUp aria-hidden="true" size={14} />
          </button>
          <button
            type="button"
            className="gb-mcp-icon-button"
            aria-label="↓"
            disabled={index === args.length - 1}
            onClick={() => {
              const next = [...args];
              [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
              onChange(next);
            }}
          >
            <ChevronDown aria-hidden="true" size={14} />
          </button>
          <button
            type="button"
            className="gb-mcp-icon-button gb-mcp-danger-button"
            aria-label={translate("removeArgument", { number: index + 1 })}
            onClick={() =>
              onChange(args.filter((_, itemIndex) => itemIndex !== index))
            }
          >
            <X aria-hidden="true" size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="gb-mcp-button gb-mcp-button-subtle"
        onClick={() => onChange([...args, ""])}
      >
        <Plus aria-hidden="true" size={14} />
        {t.mcpArgs}
      </button>
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
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<McpServerInput | null>(null);
  const [isNew, setIsNew] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<McpServerInfo | null>(null);
  const [confirmProjectSave, setConfirmProjectSave] = useState(false);
  const [doctorByName, setDoctorByName] = useState<Record<string, McpDoctorResult>>(
    {},
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await bridge.listMcpServers(
        settings.grokPath || undefined,
        settings.cwd || null,
      );
      setServers(result.servers ?? []);
      setUserConfigPath(result.userConfigPath ?? "");
      setProjectConfigPath(result.projectConfigPath ?? null);
      setMessage(null);
    } catch (error) {
      setServers([]);
      setMessage(explainMcpError(error));
    } finally {
      setLoading(false);
    }
  }, [bridge, settings.grokPath, settings.cwd]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function openCreate() {
    setIsNew(true);
    setFormError(null);
    setEditing({
      ...emptyMcpServerInput("user"),
      workspaceRoot: settings.cwd || null,
    });
  }

  function openEdit(server: McpServerInfo) {
    setIsNew(false);
    setFormError(null);
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

  function closeEditor() {
    setEditing(null);
    setFormError(null);
    setConfirmProjectSave(false);
  }

  function requestSave() {
    if (!editing) return;
    if (!editing.name.trim() || !editing.commandOrUrl.trim()) {
      setFormError(t.mcpRequired);
      return;
    }
    setFormError(null);
    if (editing.scope === "project") {
      setConfirmProjectSave(true);
      return;
    }
    void commitSave();
  }

  async function commitSave() {
    if (!editing) return;
    setConfirmProjectSave(false);
    setBusy(true);
    try {
      await bridge.upsertMcpServer(
        {
          ...editing,
          workspaceRoot: settings.cwd || null,
        },
        settings.grokPath || undefined,
      );
      closeEditor();
      setAgentReloadRequired(true);
      await refresh();
    } catch (error) {
      setFormError(explainMcpError(error));
    } finally {
      setBusy(false);
    }
  }

  async function remove(server: McpServerInfo) {
    setPendingDelete(null);
    setBusy(true);
    try {
      await bridge.removeMcpServer(server.name, {
        grokPath: settings.grokPath || undefined,
        scope: server.scope,
        workspaceRoot: settings.cwd || null,
      });
      setAgentReloadRequired(true);
      await refresh();
    } catch (error) {
      setMessage(explainMcpError(error));
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
      setDoctorByName((current) => {
        const next = { ...current };
        for (const result of results) {
          next[result.name] = result;
        }
        return next;
      });
      setMessage(null);
    } catch (error) {
      setMessage(explainMcpError(error));
    } finally {
      setBusy(false);
    }
  }

  const anyBusySession = Object.values(useAppStore.getState().sessions).some(
    (session) => session.busy,
  );
  const projectPath =
    projectConfigPath ||
    (settings.cwd ? `${settings.cwd}/.grok/config.toml` : ".grok/config.toml");
  const controlsDisabled = busy || loading;

  return (
    <section className="gb-mcp-manager" aria-busy={controlsDisabled}>
      <header className="gb-mcp-header">
        <div className="gb-mcp-heading">
          <span className="gb-mcp-heading-icon" aria-hidden="true">
            <Server size={17} strokeWidth={1.8} />
          </span>
          <div>
            <h2>{t.capabilityCenter}</h2>
            <p>{t.mcpTrustHint}</p>
          </div>
        </div>
        <div className="gb-mcp-header-actions">
          <button
            type="button"
            className="gb-mcp-button gb-mcp-button-subtle"
            disabled={controlsDisabled}
            onClick={() => void refresh()}
          >
            <RefreshCw
              aria-hidden="true"
              className={loading ? "gb-mcp-spin" : undefined}
              size={14}
            />
            {t.mcpRefresh}
          </button>
          <button
            type="button"
            className="gb-mcp-button gb-mcp-button-primary"
            disabled={controlsDisabled}
            onClick={openCreate}
          >
            <Plus aria-hidden="true" size={14} />
            {t.mcpAdd}
          </button>
        </div>
      </header>

      <dl className="gb-mcp-paths">
        <div>
          <dt>{t.mcpScopeUser}</dt>
          <dd>{userConfigPath || "~/.grok/config.toml"}</dd>
        </div>
        {projectConfigPath ? (
          <div>
            <dt>{t.mcpScopeProject}</dt>
            <dd>{projectConfigPath}</dd>
          </div>
        ) : null}
      </dl>

      {agentReloadRequired ? (
        <div className="gb-mcp-notice gb-mcp-notice-warning" role="status">
          <RotateCcw aria-hidden="true" size={16} />
          <div>
            <strong>{t.mcpReloadRequired}</strong>
            {anyBusySession ? <p>{t.mcpReloadIdle}</p> : null}
          </div>
          <button
            type="button"
            className="gb-mcp-button gb-mcp-button-primary"
            disabled={anyBusySession || busy}
            onClick={() => void onReloadAgent?.()}
          >
            {t.mcpReloadNow}
          </button>
        </div>
      ) : null}

      {message ? (
        <div className="gb-mcp-notice gb-mcp-notice-error" role="alert">
          <CircleAlert aria-hidden="true" size={16} />
          <div>
            <strong>{t.mcpError}</strong>
            <code>{message}</code>
          </div>
          <button
            type="button"
            className="gb-mcp-icon-button"
            aria-label={t.cancel}
            onClick={() => setMessage(null)}
          >
            <X aria-hidden="true" size={14} />
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="gb-mcp-loading" role="status">
          <LoaderCircle aria-hidden="true" className="gb-mcp-spin" size={16} />
          <span>{t.readingCapabilities}</span>
          <div className="gb-mcp-loading-lines" aria-hidden="true">
            <i />
            <i />
          </div>
        </div>
      ) : servers.length === 0 ? (
        <div className="gb-mcp-empty">
          <span aria-hidden="true">
            <Server size={20} strokeWidth={1.5} />
          </span>
          <strong>{t.noMcp}</strong>
          <button
            type="button"
            className="gb-mcp-button gb-mcp-button-subtle"
            onClick={openCreate}
          >
            <Plus aria-hidden="true" size={14} />
            {t.mcpAdd}
          </button>
        </div>
      ) : (
        <div className="gb-mcp-list">
          {servers.map((server) => {
            const doctorResult =
              doctorByName[server.name] ?? server.lastDoctor;
            const target =
              server.displayTarget || server.command || server.url || "—";
            return (
              <article
                key={`${server.scope}:${server.name}`}
                className="gb-mcp-card"
              >
                <header>
                  <span className="gb-mcp-card-icon" aria-hidden="true">
                    <TransportIcon transport={server.transport} />
                  </span>
                  <div>
                    <strong>{server.name}</strong>
                    <code>{target}</code>
                  </div>
                  <span className="gb-mcp-badge">{server.transport}</span>
                </header>

                <div className="gb-mcp-card-meta">
                  <span>{server.scope}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {t.mcpStatus}:{" "}
                    {doctorResult
                      ? doctorResult.ok
                        ? t.mcpOk
                        : t.mcpError
                      : server.status ?? t.configured}
                  </span>
                </div>

                {server.envKeys.length > 0 || server.headerKeys.length > 0 ? (
                  <div className="gb-mcp-secret-summary">
                    {server.envKeys.length > 0 ? (
                      <code>
                        env · {server.envKeys.map((key) => `${key}=***`).join(", ")}
                      </code>
                    ) : null}
                    {server.headerKeys.length > 0 ? (
                      <code>
                        headers ·{" "}
                        {server.headerKeys.map((key) => `${key}=***`).join(", ")}
                      </code>
                    ) : null}
                  </div>
                ) : null}

                {doctorResult ? (
                  <div
                    className={`gb-mcp-doctor ${
                      doctorResult.ok
                        ? "gb-mcp-doctor-ok"
                        : "gb-mcp-doctor-error"
                    }`}
                  >
                    {doctorResult.ok ? (
                      <ShieldCheck aria-hidden="true" size={15} />
                    ) : (
                      <TriangleAlert aria-hidden="true" size={15} />
                    )}
                    <div>
                      <strong>{doctorResult.summary}</strong>
                      {doctorResult.tools.length > 0 ? (
                        <ul>
                          {doctorResult.tools.map((tool) => (
                            <li key={tool.name}>
                              <code>{tool.name}</code>
                              {tool.description ? (
                                <span>{tool.description}</span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span>{t.mcpNoTools}</span>
                      )}
                    </div>
                  </div>
                ) : null}

                <footer>
                  <button
                    type="button"
                    className="gb-mcp-button gb-mcp-button-subtle"
                    disabled={busy}
                    onClick={() => openEdit(server)}
                  >
                    <Pencil aria-hidden="true" size={13} />
                    {t.mcpEdit}
                  </button>
                  <button
                    type="button"
                    className="gb-mcp-button gb-mcp-button-subtle"
                    disabled={busy}
                    onClick={() => void doctor(server.name)}
                  >
                    <Stethoscope aria-hidden="true" size={13} />
                    {t.mcpDoctor}
                  </button>
                  <button
                    type="button"
                    className="gb-mcp-button gb-mcp-button-danger"
                    disabled={busy}
                    onClick={() => setPendingDelete(server)}
                  >
                    <Trash2 aria-hidden="true" size={13} />
                    {t.mcpRemove}
                  </button>
                </footer>
              </article>
            );
          })}
        </div>
      )}

      <Dialog
        open={Boolean(editing) && !confirmProjectSave}
        title={isNew ? t.mcpAdd : t.mcpEdit}
        closeLabel={t.cancel}
        onClose={closeEditor}
        wide
      >
        {editing ? (
          <div className="gb-mcp-form">
            {formError ? (
              <div className="gb-mcp-form-error" role="alert">
                <CircleAlert aria-hidden="true" size={15} />
                <code>{formError}</code>
              </div>
            ) : null}
            <div className="gb-mcp-form-grid">
              <McpField label={t.mcpName}>
                <input
                  autoFocus
                  value={editing.name}
                  disabled={!isNew}
                  onChange={(event) =>
                    setEditing({ ...editing, name: event.target.value })
                  }
                />
              </McpField>
              <McpField label={t.mcpTransport}>
                <select
                  value={editing.transport}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      transport: event.target.value as McpTransport,
                    })
                  }
                >
                  <option value="stdio">stdio</option>
                  <option value="http">http</option>
                  <option value="sse">sse</option>
                </select>
              </McpField>
              <McpField label={t.mcpScope}>
                <select
                  value={editing.scope}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      scope: event.target.value as McpScope,
                    })
                  }
                >
                  <option value="user">{t.mcpScopeUser}</option>
                  <option value="project">{t.mcpScopeProject}</option>
                </select>
              </McpField>
              <McpField
                label={
                  editing.transport === "stdio" ? t.mcpCommand : t.mcpUrl
                }
              >
                <input
                  value={editing.commandOrUrl}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      commandOrUrl: event.target.value,
                    })
                  }
                  placeholder={
                    editing.transport === "stdio"
                      ? "npx"
                      : "https://mcp.example.com"
                  }
                />
              </McpField>
            </div>
            {editing.transport === "stdio" ? (
              <McpField label={t.mcpArgs}>
                <ArgListEditor
                  args={editing.args}
                  onChange={(args) => setEditing({ ...editing, args })}
                />
              </McpField>
            ) : null}
            <KeyValueEditor
              label={t.mcpEnv}
              rows={editing.env}
              onChange={(env) => setEditing({ ...editing, env })}
            />
            {editing.transport === "http" || editing.transport === "sse" ? (
              <KeyValueEditor
                label={t.mcpHeaders}
                rows={editing.headers}
                onChange={(headers) => setEditing({ ...editing, headers })}
              />
            ) : null}
            <div className="gb-mcp-dialog-actions">
              <button
                type="button"
                className="gb-mcp-button gb-mcp-button-subtle"
                onClick={closeEditor}
              >
                {t.cancel}
              </button>
              <button
                type="button"
                className="gb-mcp-button gb-mcp-button-primary"
                disabled={busy}
                onClick={requestSave}
              >
                {busy ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="gb-mcp-spin"
                    size={14}
                  />
                ) : null}
                {t.save}
              </button>
            </div>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={confirmProjectSave}
        title={t.mcpProjectPath}
        closeLabel={t.cancel}
        onClose={() => setConfirmProjectSave(false)}
      >
        <div className="gb-mcp-confirm">
          <span className="gb-mcp-confirm-icon gb-mcp-confirm-icon-warning">
            <TriangleAlert aria-hidden="true" size={18} />
          </span>
          <div>
            <p>{t.mcpProjectWarn}</p>
            <code>{projectPath}</code>
          </div>
        </div>
        <div className="gb-mcp-dialog-actions">
          <button
            type="button"
            className="gb-mcp-button gb-mcp-button-subtle"
            onClick={() => setConfirmProjectSave(false)}
          >
            {t.cancel}
          </button>
          <button
            type="button"
            className="gb-mcp-button gb-mcp-button-primary"
            disabled={busy}
            onClick={() => void commitSave()}
          >
            {t.save}
          </button>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(pendingDelete)}
        title={t.confirmDelete}
        closeLabel={t.cancel}
        onClose={() => setPendingDelete(null)}
      >
        {pendingDelete ? (
          <>
            <div className="gb-mcp-confirm">
              <span className="gb-mcp-confirm-icon gb-mcp-confirm-icon-danger">
                <Trash2 aria-hidden="true" size={18} />
              </span>
              <div>
                <p>{pendingDelete.name}</p>
                <code>
                  {pendingDelete.displayTarget ||
                    pendingDelete.command ||
                    pendingDelete.url ||
                    "—"}
                </code>
              </div>
            </div>
            <div className="gb-mcp-dialog-actions">
              <button
                type="button"
                className="gb-mcp-button gb-mcp-button-subtle"
                onClick={() => setPendingDelete(null)}
              >
                {t.cancel}
              </button>
              <button
                type="button"
                className="gb-mcp-button gb-mcp-button-danger-solid"
                disabled={busy}
                onClick={() => void remove(pendingDelete)}
              >
                <Trash2 aria-hidden="true" size={13} />
                {t.delete}
              </button>
            </div>
          </>
        ) : null}
      </Dialog>
    </section>
  );
}
