import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AgentStatus,
  GrokProbe,
  RuntimeHealth,
  ServerRequest,
  SessionUpdate,
  Settings,
  StartConfig,
} from "../types";
import { useAppStore } from "../store";

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

function handleSessionUpdate(update: SessionUpdate) {
  const store = useAppStore.getState();
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
      if (text) store.appendAssistant(text);
      break;
    }
    case "agent_thought_chunk":
    case "agent_thought":
    case "thought": {
      const text = extractText(u.content) || String(u.text ?? "");
      if (text) store.appendThought(text);
      break;
    }
    case "tool_call": {
      const id = String(u.toolCallId ?? u.tool_call_id ?? crypto.randomUUID());
      store.upsertTool({
        id,
        title: String(u.title ?? u.kind ?? "tool"),
        kind: u.kind ? String(u.kind) : undefined,
        status: String(u.status ?? "running"),
        input: u.rawInput ?? u.input ?? u.raw_input,
      });
      store.setRightPanel("tasks");
      break;
    }
    case "tool_call_update": {
      const id = String(u.toolCallId ?? u.tool_call_id ?? "");
      if (!id) break;
      store.upsertTool({
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
      const text =
        extractText(u.content) ||
        (typeof u.plan === "string"
          ? u.plan
          : JSON.stringify(u.plan ?? u, null, 2));
      store.setPlan(text);
      break;
    }
    default: {
      if (kind) {
        store.addBlock({
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
    await listen<SessionUpdate>("acp:session_update", (event) => {
      handleSessionUpdate(event.payload);
    }),
  );

  unsubs.push(
    await listen<AgentStatus>("acp:status", (event) => {
      useAppStore.getState().setStatus(event.payload);
      if (!event.payload.running) {
        useAppStore.getState().setBusy(false);
      }
    }),
  );

  unsubs.push(
    await listen<string>("acp:stderr", (event) => {
      useAppStore.getState().pushStderr(event.payload);
    }),
  );

  unsubs.push(
    await listen<string>("acp:error", (event) => {
      useAppStore.getState().addBlock({
        type: "system",
        id: crypto.randomUUID(),
        text: event.payload,
        level: "error",
      });
    }),
  );

  unsubs.push(
    await listen<ServerRequest>("acp:server_request", (event) => {
      const req = event.payload;
      useAppStore.getState().setPermission(req);
      const settings = useAppStore.getState().settings;
      if (settings.alwaysApprove) {
        void respondServerRequest(req.id, {
          outcome: { outcome: "selected", optionId: "allow-once" },
          approved: true,
        }).finally(() => useAppStore.getState().setPermission(null));
      }
    }),
  );

  unsubs.push(
    await listen<{ method: string }>("acp:extension", (event) => {
      useAppStore.getState().addBlock({
        type: "system",
        id: crypto.randomUUID(),
        text: `extension: ${event.payload.method}`,
        level: "info",
      });
    }),
  );

  unsubs.push(
    await listen<{ method: string }>("acp:notification", (event) => {
      useAppStore.getState().addBlock({
        type: "system",
        id: crypto.randomUUID(),
        text: `notify: ${event.payload.method}`,
        level: "info",
      });
    }),
  );

  return unsubs;
}
