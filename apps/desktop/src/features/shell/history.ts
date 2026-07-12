import type { CachedSessionEvent } from "../../api/catalog";
import type { ChatBlock, SessionUpdate, ToolCall } from "../../types";

function textFrom(content: SessionUpdate["content"] | unknown): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((item) => textFrom(item)).filter(Boolean).join("");
  }
  if (content && typeof content === "object") return String((content as { text?: string }).text ?? "");
  return "";
}

export function normalizeCachedEvents(events: CachedSessionEvent[]): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  const toolBlocks = new Map<string, number>();
  const seenRuntimeEvents = new Set<string>();
  let streamingKind: "assistant" | "thought" | null = null;
  let streamingIndex = -1;

  for (const event of events) {
    const eventId = event.payload && typeof event.payload === "object"
      ? String(((event.payload as { _meta?: { eventId?: unknown } })._meta?.eventId) ?? "")
      : "";
    // Older builds persisted each Host envelope once in the Host and once in
    // the Renderer. Keep history readable without rewriting immutable events.
    if (eventId) {
      if (seenRuntimeEvents.has(eventId)) continue;
      seenRuntimeEvents.add(eventId);
    }
    if (event.kind === "user") {
      blocks.push({
        id: `history-user-${event.sequence}`,
        type: "user",
        text: String((event.payload as { text?: string })?.text ?? event.payload ?? ""),
        at: event.timestamp,
      });
      streamingKind = null;
      continue;
    }

    const raw = event.payload as SessionUpdate;
    const update = (raw?.update as SessionUpdate | undefined) ?? raw;
    const kind = update?.sessionUpdate ?? (update as { session_update?: string })?.session_update ?? event.kind;

    if (["agent_message_chunk", "agent_message", "message"].includes(kind)) {
      const text = textFrom(update.content) || String(update.text ?? "");
      if (!text) continue;
      if (streamingKind === "assistant" && streamingIndex >= 0) {
        const existing = blocks[streamingIndex];
        if (existing?.type === "assistant") existing.text += text;
      } else {
        blocks.push({ id: `history-assistant-${event.sequence}`, type: "assistant", text, at: event.timestamp });
        streamingIndex = blocks.length - 1;
        streamingKind = "assistant";
      }
      continue;
    }

    if (["agent_thought_chunk", "agent_thought", "thought"].includes(kind)) {
      const text = textFrom(update.content) || String(update.text ?? "");
      if (!text) continue;
      if (streamingKind === "thought" && streamingIndex >= 0) {
        const existing = blocks[streamingIndex];
        if (existing?.type === "thought") existing.text += text;
      } else {
        blocks.push({ id: `history-thought-${event.sequence}`, type: "thought", text, at: event.timestamp });
        streamingIndex = blocks.length - 1;
        streamingKind = "thought";
      }
      continue;
    }

    streamingKind = null;
    if (kind === "tool_call" || kind === "tool_call_update") {
      const id = String(update.toolCallId ?? update.tool_call_id ?? `tool-${event.sequence}`);
      const tool: ToolCall = {
        id,
        title: String(update.title ?? update.kind ?? "Tool"),
        kind: update.kind ? String(update.kind) : undefined,
        status: String(update.status ?? (kind === "tool_call" ? "running" : "updated")),
        input: update.rawInput ?? update.raw_input ?? update.input,
        output: update.rawOutput ?? update.raw_output ?? update.output,
      };
      const index = toolBlocks.get(id);
      if (index == null) {
        blocks.push({ id: `history-tool-${event.sequence}`, type: "tool", tool, at: event.timestamp });
        toolBlocks.set(id, blocks.length - 1);
      } else {
        const existing = blocks[index];
        if (existing?.type === "tool") existing.tool = { ...existing.tool, ...tool };
      }
      continue;
    }
    if (kind === "plan") {
      const text = textFrom(update.content) || (typeof update.plan === "string" ? update.plan : JSON.stringify(update.plan ?? update, null, 2));
      blocks.push({ id: `history-plan-${event.sequence}`, type: "plan", text, at: event.timestamp });
    }
  }
  return blocks;
}
