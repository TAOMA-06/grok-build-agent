import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  buildPermissionPrompt,
  extractPermissionOptions,
  isPermissionMethod,
  isSessionEventEnvelope,
} from "../contracts";
import type {
  AgentStatus,
  GrokProbe,
  RuntimeHealth,
  AgentHostHealth,
  ServerRequest,
  SessionEventEnvelope,
  SessionUpdate,
  Settings,
  StartConfig,
  PromptDispatchContext,
} from "../types";
import { useAppStore } from "../store";
import { appendSessionEvent } from "../api/catalog";
import { t } from "../i18n";

/** Unwrap SessionEventEnvelope or return legacy raw payload. */
function unwrapPayload<T>(payload: unknown): T {
  if (isSessionEventEnvelope(payload)) {
    return payload.payload as T;
  }
  return payload as T;
}

/**
 * Route ACP envelopes by their remote session id first.  Falling back to the
 * visible session is only safe for legacy events that predate envelopes;
 * otherwise an update from a background session can corrupt the open chat.
 */
export function resolveLocalSessionId(
  envelopeSessionId?: string | null,
  connectionId?: string | null,
  allowLegacyFallback = false,
): string | null {
  const store = useAppStore.getState();
  if (envelopeSessionId && store.sessions[envelopeSessionId]) {
    return envelopeSessionId;
  }
  // Map remote ACP id → local session
  if (envelopeSessionId) {
    for (const id of store.sessionOrder) {
      const s = store.sessions[id];
      if (
        s?.summary.remoteSessionId === envelopeSessionId ||
        s?.summary.sessionId === envelopeSessionId
      ) {
        return id;
      }
    }
  }
  if (connectionId) {
    const matches = store.sessionOrder.filter(
      (id) => store.sessions[id]?.summary.connectionId === connectionId,
    );
    if (matches.length === 1) return matches[0];
  }
  return allowLegacyFallback ? store.activeSessionId : null;
}

export async function probeGrok(grokPath?: string): Promise<GrokProbe> {
  return invoke<GrokProbe>("probe_grok", { grokPath: grokPath || null });
}

export async function runtimeHealth(grokPath?: string): Promise<RuntimeHealth> {
  return invoke<RuntimeHealth>("runtime_health", {
    grokPath: grokPath || null,
  });
}

export async function ensureAgentHost(): Promise<AgentHostHealth> {
  return invoke<AgentHostHealth>("ensure_agent_host");
}

export async function agentHostHealth(): Promise<AgentHostHealth> {
  return invoke<AgentHostHealth>("agent_host_health");
}

export async function loadSettings(): Promise<Settings> {
  return invoke<Settings>("load_settings");
}

export async function saveSettings(settings: Settings): Promise<void> {
  return invoke("save_settings", { settings });
}

export async function getConfigDir(): Promise<string> {
  return invoke<string>("config_dir");
}

export async function getStatus(): Promise<AgentStatus> {
  return invoke<AgentStatus>("agent_status");
}

export async function startAgent(config: StartConfig): Promise<AgentStatus> {
  return invoke<AgentStatus>("start_agent", { config });
}

export async function stopAgent(): Promise<void> {
  return invoke("stop_agent");
}

export async function restartAgent(config: StartConfig): Promise<AgentStatus> {
  return invoke<AgentStatus>("restart_agent", { config });
}

export async function sendPrompt(
  connectionId: string,
  sessionId: string,
  text: string,
  content?: import("../types").PromptContent[],
  dispatch?: PromptDispatchContext,
): Promise<unknown> {
  return invoke("send_prompt", {
    connectionId,
    sessionId,
    text,
    content: content ?? null,
    dispatch: dispatch ?? null,
  });
}

export async function listModels(
  grokPath?: string,
): Promise<import("../types").SelectableModel[]> {
  return invoke("list_models", { grokPath: grokPath || null });
}

export async function setSessionModel(
  connectionId: string,
  sessionId: string,
  modelId: string,
): Promise<import("../types").ModelSwitchResult> {
  return invoke("set_session_model", {
    connectionId,
    sessionId,
    modelId,
  });
}

export async function setSessionMode(
  connectionId: string,
  sessionId: string,
  mode: import("../types").TaskMode,
): Promise<import("../types").ModeSwitchResult> {
  return invoke("set_session_mode", { connectionId, sessionId, mode });
}

export async function confirmSessionMode(
  connectionId: string,
  sessionId: string,
  mode: import("../types").TaskMode,
): Promise<import("../types").SessionModeState> {
  return invoke("confirm_session_mode", { connectionId, sessionId, mode });
}

export async function inspectAttachments(
  paths: string[],
): Promise<import("../contracts").ComposerAttachment[]> {
  const files = await invoke<
    Array<{
      id: string;
      name: string;
      path: string;
      mimeType: string;
      sizeBytes?: number | null;
    }>
  >("inspect_attachments", { paths });
  return files.map((file) => ({
    ...file,
    source: "path" as const,
    kind: file.mimeType.startsWith("image/") ? ("image" as const) : ("file" as const),
  }));
}

export async function prepareAttachments(
  files: import("../contracts").ComposerAttachment[],
): Promise<import("../contracts").PromptContent[]> {
  return invoke("prepare_attachments", {
    files: files
      .filter((file) => file.source === "path" && file.path)
      .map((file) => ({
        id: file.id,
        name: file.name,
        path: file.path,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes ?? null,
      })),
  });
}

export async function cancelPrompt(
  connectionId: string,
  sessionId: string,
): Promise<void> {
  return invoke("cancel_prompt", { connectionId, sessionId });
}

export async function respondServerRequest(
  connectionId: string,
  id: string | number,
  result?: unknown,
  error?: unknown,
): Promise<void> {
  return invoke("respond_server_request", {
    connectionId,
    id,
    result: result ?? null,
    error: error ?? null,
  });
}

function extractText(content: SessionUpdate["content"]): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (typeof content === "object" && content && "text" in content) {
    return String((content as { text?: string }).text ?? "");
  }
  return "";
}

const HIDDEN_XAI_NOTIFICATIONS = new Set([
  "_x.ai/session_notification",
  "_x.ai/mcp/init_progress",
  "_x.ai/mcp/server_status",
  "_x.ai/mcp_initialized",
  "_x.ai/announcements/update",
  "_x.ai/models/update",
  "_x.ai/sessions/changed",
  "_x.ai/queue/changed",
  "_x.ai/session/prompt_complete",
  "_x.ai/session/update",
]);

/** xAI lifecycle telemetry belongs in diagnostics, not the conversation transcript. */
export function shouldHideAcpNotification(method: string): boolean {
  return HIDDEN_XAI_NOTIFICATIONS.has(method);
}

/** Batch high-frequency stream chunks per animation frame per session. */
const pendingAssistant = new Map<string, string>();
const pendingThought = new Map<string, string>();
let rafScheduled = false;

function flushStreams() {
  rafScheduled = false;
  const store = useAppStore.getState();
  for (const [sid, text] of pendingAssistant) {
    if (text) store.appendAssistant(sid, text);
  }
  for (const [sid, text] of pendingThought) {
    if (text) store.appendThought(sid, text);
  }
  pendingAssistant.clear();
  pendingThought.clear();
}

function scheduleFlush() {
  if (rafScheduled) return;
  rafScheduled = true;
  requestAnimationFrame(flushStreams);
}

function queueAssistant(sessionId: string, text: string) {
  pendingAssistant.set(
    sessionId,
    (pendingAssistant.get(sessionId) ?? "") + text,
  );
  scheduleFlush();
}

function queueThought(sessionId: string, text: string) {
  pendingThought.set(
    sessionId,
    (pendingThought.get(sessionId) ?? "") + text,
  );
  scheduleFlush();
}

export function handleSessionUpdate(
  update: SessionUpdate,
  sessionId: string | null,
  connectionId: string | null,
  legacyEvent = false,
) {
  const store = useAppStore.getState();
  const sid = resolveLocalSessionId(sessionId, connectionId, legacyEvent);
  if (!sid) return;

  const u = (update.update as SessionUpdate | undefined) ?? update;
  const kind =
    u.sessionUpdate ??
    (u as { session_update?: string }).session_update ??
    "";

  const asTaskMode = (value: unknown): import("../types").TaskMode | null => {
    if (typeof value !== "string") return null;
    const normalized = value.toLowerCase();
    if (normalized === "plan" || normalized === "architect") return "plan";
    if (normalized === "goal") return "goal";
    if (["agent", "code", "default"].includes(normalized)) return "agent";
    return null;
  };

  switch (kind) {
    case "user_message_chunk":
    case "user_message":
      // The desktop already rendered the submitted user message optimistically.
      break;
    case "agent_message_chunk":
    case "agent_message":
    case "message": {
      const text = extractText(u.content) || String(u.text ?? "");
      if (text) queueAssistant(sid, text);
      break;
    }
    case "agent_thought_chunk":
    case "agent_thought":
    case "thought": {
      const text = extractText(u.content) || String(u.text ?? "");
      if (text) queueThought(sid, text);
      break;
    }
    case "tool_call": {
      flushStreams();
      const id = String(u.toolCallId ?? u.tool_call_id ?? crypto.randomUUID());
      store.upsertTool(sid, {
        id,
        title: String(u.title ?? u.kind ?? "tool"),
        kind: u.kind ? String(u.kind) : undefined,
        status: String(u.status ?? "running"),
        input: u.rawInput ?? u.input ?? u.raw_input,
      });
      store.setInspector(sid, { kind: "tool", toolCallId: id });
      store.setRightPanel("tasks");
      break;
    }
    case "tool_call_update": {
      flushStreams();
      const id = String(u.toolCallId ?? u.tool_call_id ?? "");
      if (!id) break;
      store.upsertTool(sid, {
        id,
        title: String(u.title ?? "tool"),
        kind: u.kind ? String(u.kind) : undefined,
        status: String(u.status ?? "updated"),
        input: u.rawInput ?? u.input,
        output: u.rawOutput ?? u.output ?? u.raw_output,
      });
      break;
    }
    case "plan": {
      flushStreams();
      const text =
        extractText(u.content) ||
        (typeof u.plan === "string"
          ? u.plan
          : JSON.stringify(u.plan ?? u, null, 2));
      store.setPlan(sid, text);
      store.updateSummary(sid, {
        runState: "awaiting_plan",
        attentionRequired: true,
      });
      store.setInspector(sid, { kind: "plan" });
      break;
    }
    case "current_mode_update":
    case "currentModeUpdate": {
      const mode = asTaskMode(u.currentModeId ?? u.currentMode ?? u.mode);
      if (!mode) break;
      const previous = store.sessions[sid]?.modeState;
      store.setSessionModeState(sid, {
        currentMode: mode,
        availableModes: previous?.availableModes ?? [],
        liveSwitchSupported: true,
        source: "acp_config",
      });
      store.updateSummary(sid, { mode });
      break;
    }
    case "config_option_update":
    case "configOptionUpdate": {
      const options = Array.isArray(u.configOptions) ? u.configOptions : [];
      const modeOption = options.find((option) => {
        if (!option || typeof option !== "object") return false;
        const record = option as Record<string, unknown>;
        return record.category === "mode" || record.id === "mode";
      }) as Record<string, unknown> | undefined;
      const directMode = (u.configId === "mode" || u.config_id === "mode")
        ? asTaskMode(u.value ?? u.currentValue)
        : null;
      const mode = directMode ?? asTaskMode(modeOption?.currentValue);
      if (!mode) break;
      const availableModes = (Array.isArray(modeOption?.options) ? modeOption.options : [])
        .flatMap((option) => {
          if (!option || typeof option !== "object") return [];
          const record = option as Record<string, unknown>;
          const id = asTaskMode(record.id ?? record.value);
          return id
            ? [{ id, name: String(record.name ?? id), description: typeof record.description === "string" ? record.description : null }]
            : [];
        });
      store.setSessionModeState(sid, {
        currentMode: mode,
        availableModes,
        liveSwitchSupported: true,
        source: "acp_config",
      });
      store.updateSummary(sid, { mode });
      break;
    }
    case "available_commands_update":
    case "availableCommandsUpdate": {
      const rawCommands = Array.isArray(u.availableCommands)
        ? u.availableCommands
        : Array.isArray(u.commands) ? u.commands : [];
      const commands = rawCommands
        .flatMap((command) => {
          if (!command || typeof command !== "object") return [];
          const record = command as Record<string, unknown>;
          if (typeof record.name !== "string") return [];
          return [{
            name: record.name,
            description: typeof record.description === "string" ? record.description : null,
            input: record.input,
          }];
        });
      store.setSessionCommands(sid, commands);
      break;
    }
    default: {
      if (kind) {
        store.addBlock(sid, {
          type: "system",
          id: crypto.randomUUID(),
          text: `update: ${kind}`,
          level: "info",
        });
      }
    }
  }
}

export async function subscribeAcpEvents(): Promise<UnlistenFn[]> {
  const unsubs: UnlistenFn[] = [];

  unsubs.push(
    await listen<SessionEventEnvelope | SessionUpdate>(
      "acp:session_update",
      (event) => {
        const envelope = isSessionEventEnvelope(event.payload)
          ? (event.payload as SessionEventEnvelope)
          : null;
        const isEnvelope = envelope !== null;
        const sessionId = envelope?.sessionId ?? null;
        const connectionId = envelope?.connectionId ?? null;
        const update = unwrapPayload<SessionUpdate>(event.payload);
        const localSessionId = resolveLocalSessionId(
          sessionId,
          connectionId,
          !isEnvelope,
        );
        if (envelope && localSessionId) {
          void appendSessionEvent({
            sessionId: localSessionId,
            sequence: envelope.sequence,
            timestamp: envelope.timestamp,
            kind: envelope.kind,
            payload: update,
          }).catch(() => undefined);
        }
        handleSessionUpdate(
          update,
          sessionId,
          connectionId,
          !isEnvelope,
        );
      },
    ),
  );

  unsubs.push(
    await listen<AgentStatus>("acp:status", (event) => {
      const store = useAppStore.getState();
      store.setStatus(event.payload);
      const localSessionId = resolveLocalSessionId(
        event.payload.sessionId ?? null,
        event.payload.connectionId ?? null,
      );
      if (localSessionId) {
        if (event.payload.mode) store.setSessionModeState(localSessionId, event.payload.mode);
        if (event.payload.availableCommands) {
          store.setSessionCommands(localSessionId, event.payload.availableCommands);
        }
      }
      if (!event.payload.running) {
        for (const id of store.sessionOrder) {
          store.setSessionBusy(id, false);
        }
      }
    }),
  );

  unsubs.push(
    await listen<string | { line?: string; connectionId?: string }>(
      "acp:stderr",
      (event) => {
        const p = event.payload;
        const line =
          typeof p === "string" ? p : String(p?.line ?? JSON.stringify(p));
        useAppStore.getState().pushStderr(line);
      },
    ),
  );

  unsubs.push(
    await listen<string | SessionEventEnvelope>("acp:error", (event) => {
      const p = event.payload;
      let text: string;
      if (typeof p === "string") {
        text = p;
      } else if (isSessionEventEnvelope(p)) {
        const msg = (p.payload as { message?: string })?.message;
        text = msg ?? JSON.stringify(p.payload);
      } else {
        text = JSON.stringify(p);
      }
      const sid = isSessionEventEnvelope(event.payload)
        ? resolveLocalSessionId(
            event.payload.sessionId,
            event.payload.connectionId,
          )
        : resolveLocalSessionId(undefined, undefined, true);
      if (sid) {
        useAppStore.getState().addBlock(sid, {
          type: "system",
          id: crypto.randomUUID(),
          text,
          level: "error",
        });
      }
    }),
  );

  unsubs.push(
    await listen<SessionEventEnvelope | ServerRequest>(
      "acp:server_request",
      (event) => {
        const raw = unwrapPayload<ServerRequest>(event.payload);
        const req: ServerRequest =
          raw && typeof raw === "object" && "method" in raw
            ? (raw as ServerRequest)
            : (event.payload as ServerRequest);
        const connectionId = isSessionEventEnvelope(event.payload)
          ? event.payload.connectionId
          : "";
        const sessionId = isSessionEventEnvelope(event.payload)
          ? event.payload.sessionId
          : null;
        const routedRequest: ServerRequest = {
          ...req,
          connectionId,
          sessionId,
        };

        if (routedRequest.method === "_x.ai/exit_plan_mode" || routedRequest.method === "x.ai/exit_plan_mode") {
          const sid = resolveLocalSessionId(sessionId, connectionId);
          if (!sid) return;
          const params = routedRequest.params && typeof routedRequest.params === "object"
            ? routedRequest.params as Record<string, unknown>
            : {};
          const planText = extractText(
            (params.planContent ?? params.plan_content ?? params.content) as Parameters<typeof extractText>[0],
          )
            || (typeof params.plan === "string" ? params.plan : "")
            || t.planReadyFallback;
          useAppStore.getState().setPlan(sid, planText);
          useAppStore.getState().setPlanApproval(routedRequest);
          useAppStore.getState().updateSummary(sid, {
            runState: "awaiting_plan",
            attentionRequired: true,
          });
          useAppStore.getState().setSessionBusy(sid, false);
          return;
        }

        if (!isPermissionMethod(routedRequest.method ?? "")) {
          const sid = resolveLocalSessionId(sessionId, connectionId);
          if (sid) {
            useAppStore.getState().addBlock(sid, {
              type: "system",
              id: crypto.randomUUID(),
              text: `Ignored non-permission server request: ${routedRequest.method}`,
              level: "warn",
            });
          }
          return;
        }

        const options = extractPermissionOptions(routedRequest.params);
        buildPermissionPrompt({ request: routedRequest, connectionId });
        useAppStore.getState().setPermission(routedRequest, options);

        const localSessionId = resolveLocalSessionId(sessionId, connectionId);
        if (localSessionId) {
          useAppStore.getState().updateSummary(localSessionId, {
            runState: "awaiting_permission",
            attentionRequired: true,
          });
        }
        const automaticallyApprove = localSessionId
          ? useAppStore.getState().sessions[localSessionId]?.summary
              .alwaysApprove === true
          : false;
        if (automaticallyApprove) {
          const allow =
            options.find(
              (o) => o.kind === "allow_once" || o.kind === "allow_always",
            ) ?? options[0];
          if (!allow) return;
          if (!connectionId) return;
          void respondServerRequest(connectionId, routedRequest.id, {
            outcome: { outcome: "selected", optionId: allow.optionId },
          }).finally(() => useAppStore.getState().setPermission(null));
        }
      },
    ),
  );

  unsubs.push(
    await listen<SessionEventEnvelope | { method: string }>(
      "acp:extension",
      (event) => {
        const p = unwrapPayload<{ method?: string }>(event.payload);
        const method = p?.method ?? "extension";
        if (shouldHideAcpNotification(method)) return;
        const sid = isSessionEventEnvelope(event.payload)
          ? resolveLocalSessionId(
              event.payload.sessionId,
              event.payload.connectionId,
            )
          : resolveLocalSessionId(undefined, undefined, true);
        if (sid) {
          useAppStore.getState().addBlock(sid, {
            type: "system",
            id: crypto.randomUUID(),
            text: `extension: ${method}`,
            level: "info",
          });
        }
      },
    ),
  );

  unsubs.push(
    await listen<SessionEventEnvelope | { method: string }>(
      "acp:notification",
      (event) => {
        const p = unwrapPayload<{ method?: string }>(event.payload);
        const method = p?.method ?? "notification";
        if (shouldHideAcpNotification(method)) return;
        const sid = isSessionEventEnvelope(event.payload)
          ? resolveLocalSessionId(
              event.payload.sessionId,
              event.payload.connectionId,
            )
          : resolveLocalSessionId(undefined, undefined, true);
        if (sid) {
          useAppStore.getState().addBlock(sid, {
            type: "system",
            id: crypto.randomUUID(),
            text: `notify: ${method}`,
            level: "info",
          });
        }
      },
    ),
  );

  return unsubs;
}
