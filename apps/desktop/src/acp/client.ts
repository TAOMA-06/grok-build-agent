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
  ServerRequest,
  SessionEventEnvelope,
  SessionUpdate,
  Settings,
  StartConfig,
} from "../types";
import { useAppStore } from "../store";

/** Unwrap SessionEventEnvelope or return legacy raw payload. */
function unwrapPayload<T>(payload: unknown): T {
  if (isSessionEventEnvelope(payload)) {
    return payload.payload as T;
  }
  return payload as T;
}

function activeOrFirstSessionId(envelopeSessionId?: string | null): string | null {
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
  return store.activeSessionId;
}

export async function probeGrok(grokPath?: string): Promise<GrokProbe> {
  return invoke<GrokProbe>("probe_grok", { grokPath: grokPath || null });
}

export async function runtimeHealth(grokPath?: string): Promise<RuntimeHealth> {
  return invoke<RuntimeHealth>("runtime_health", {
    grokPath: grokPath || null,
  });
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

export async function sendPrompt(text: string): Promise<unknown> {
  return invoke("send_prompt", { text });
}

export async function respondServerRequest(
  id: string | number,
  result?: unknown,
  error?: unknown,
): Promise<void> {
  return invoke("respond_server_request", {
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

function handleSessionUpdate(
  update: SessionUpdate,
  sessionId: string | null,
) {
  const store = useAppStore.getState();
  const sid = activeOrFirstSessionId(sessionId);
  if (!sid) return;

  const u = (update.update as SessionUpdate | undefined) ?? update;
  const kind =
    u.sessionUpdate ??
    (u as { session_update?: string }).session_update ??
    "";

  switch (kind) {
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
      store.setInspector(sid, { kind: "plan" });
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
        const sessionId = isSessionEventEnvelope(event.payload)
          ? event.payload.sessionId
          : null;
        handleSessionUpdate(
          unwrapPayload<SessionUpdate>(event.payload),
          sessionId,
        );
      },
    ),
  );

  unsubs.push(
    await listen<AgentStatus>("acp:status", (event) => {
      useAppStore.getState().setStatus(event.payload);
      if (!event.payload.running) {
        const store = useAppStore.getState();
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
      const sid = useAppStore.getState().activeSessionId;
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

        if (!isPermissionMethod(req.method ?? "")) {
          const sid = useAppStore.getState().activeSessionId;
          if (sid) {
            useAppStore.getState().addBlock(sid, {
              type: "system",
              id: crypto.randomUUID(),
              text: `Ignored non-permission server request: ${req.method}`,
              level: "warn",
            });
          }
          return;
        }

        const options = extractPermissionOptions(req.params);
        const connectionId = isSessionEventEnvelope(event.payload)
          ? event.payload.connectionId
          : "local";
        buildPermissionPrompt({ request: req, connectionId });
        useAppStore.getState().setPermission(req, options);

        const settings = useAppStore.getState().settings;
        if (settings.alwaysApprove) {
          const allow =
            options.find(
              (o) => o.kind === "allow_once" || o.kind === "allow_always",
            ) ?? options[0];
          if (!allow) return;
          void respondServerRequest(req.id, {
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
        const sid = useAppStore.getState().activeSessionId;
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
        const sid = useAppStore.getState().activeSessionId;
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
