import { create } from "zustand";
import { defaultSettings } from "./contracts";
import type {
  AgentStatus,
  ChatBlock,
  InspectorSelection,
  ReviewSnapshot,
  RightPanel,
  RuntimeHealth,
  ServerRequest,
  SessionSummary,
  Settings,
  ToolCall,
  WorkspaceRecord,
} from "./types";
import type { WorktreeSummary } from "./api/catalog";

export { defaultSettings };

export type SessionRuntime = {
  summary: SessionSummary;
  blocks: ChatBlock[];
  tools: ToolCall[];
  planText: string;
  draft: string;
  scrollTop: number;
  busy: boolean;
  inspector: InspectorSelection | null;
  streamAssistantId: string | null;
  streamThoughtId: string | null;
};

type AppState = {
  settings: Settings;
  settingsLoaded: boolean;
  status: AgentStatus;
  health: RuntimeHealth | null;
  stderr: string[];
  pendingPermission: ServerRequest | null;
  permissionOptions: { optionId: string; name: string; kind?: string }[];
  rightPanel: RightPanel;
  workspaces: WorkspaceRecord[];
  sessions: Record<string, SessionRuntime>;
  sessionOrder: string[];
  activeSessionId: string | null;
  review: ReviewSnapshot | null;
  worktrees: WorktreeSummary[];
  patchPreview: { path: string; text: string } | null;

  setSettings: (s: Partial<Settings>) => void;
  replaceSettings: (s: Settings) => void;
  setSettingsLoaded: (v: boolean) => void;
  setStatus: (s: AgentStatus) => void;
  setHealth: (h: RuntimeHealth | null) => void;
  setRightPanel: (p: RightPanel) => void;
  pushStderr: (line: string) => void;
  setPermission: (
    req: ServerRequest | null,
    options?: { optionId: string; name: string; kind?: string }[],
  ) => void;
  setWorkspaces: (w: WorkspaceRecord[]) => void;
  setReview: (r: ReviewSnapshot | null) => void;
  setWorktrees: (w: WorktreeSummary[]) => void;
  setPatchPreview: (p: { path: string; text: string } | null) => void;

  ensureSession: (summary: SessionSummary) => void;
  setActiveSession: (id: string | null) => void;
  updateSummary: (id: string, patch: Partial<SessionSummary>) => void;
  setSessionDraft: (id: string, draft: string) => void;
  setSessionScroll: (id: string, scrollTop: number) => void;
  setSessionBusy: (id: string, busy: boolean) => void;
  setInspector: (id: string, sel: InspectorSelection | null) => void;
  addBlock: (sessionId: string, b: ChatBlock) => void;
  appendAssistant: (sessionId: string, text: string) => void;
  appendThought: (sessionId: string, text: string) => void;
  upsertTool: (sessionId: string, tool: ToolCall) => void;
  setPlan: (sessionId: string, text: string) => void;
  clearChat: (sessionId: string) => void;
  removeSession: (sessionId: string) => void;

  /** Active session helpers for ACP client (legacy single-stream mapping). */
  activeBlocks: () => ChatBlock[];
  activeBusy: () => boolean;
};

function emptyRuntime(summary: SessionSummary): SessionRuntime {
  return {
    summary,
    blocks: [],
    tools: [],
    planText: "",
    draft: summary.draft ?? "",
    scrollTop: 0,
    busy: false,
    inspector: null,
    streamAssistantId: null,
    streamThoughtId: null,
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  settings: defaultSettings(),
  settingsLoaded: false,
  status: { running: false },
  health: null,
  stderr: [],
  pendingPermission: null,
  permissionOptions: [],
  rightPanel: "health",
  workspaces: [],
  sessions: {},
  sessionOrder: [],
  activeSessionId: null,
  review: null,
  worktrees: [],
  patchPreview: null,

  setSettings: (partial) => {
    set({ settings: { ...get().settings, ...partial } });
  },
  replaceSettings: (settings) => set({ settings }),
  setSettingsLoaded: (settingsLoaded) => set({ settingsLoaded }),
  setStatus: (status) => set({ status }),
  setHealth: (health) => set({ health }),
  setRightPanel: (rightPanel) => set({ rightPanel }),
  pushStderr: (line) => {
    set({ stderr: [...get().stderr, line].slice(-300) });
  },
  setPermission: (pendingPermission, options) =>
    set({
      pendingPermission,
      permissionOptions: pendingPermission ? (options ?? []) : [],
    }),
  setWorkspaces: (workspaces) => set({ workspaces }),
  setReview: (review) => set({ review }),
  setWorktrees: (worktrees) => set({ worktrees }),
  setPatchPreview: (patchPreview) => set({ patchPreview }),

  ensureSession: (summary) => {
    const sessions = { ...get().sessions };
    if (!sessions[summary.sessionId]) {
      sessions[summary.sessionId] = emptyRuntime(summary);
      set({
        sessions,
        sessionOrder: [summary.sessionId, ...get().sessionOrder],
        activeSessionId: get().activeSessionId ?? summary.sessionId,
      });
    } else {
      sessions[summary.sessionId] = {
        ...sessions[summary.sessionId],
        summary: {
          ...sessions[summary.sessionId].summary,
          ...summary,
        },
      };
      set({ sessions });
    }
  },

  setActiveSession: (activeSessionId) => set({ activeSessionId }),

  updateSummary: (id, patch) => {
    const s = get().sessions[id];
    if (!s) return;
    set({
      sessions: {
        ...get().sessions,
        [id]: { ...s, summary: { ...s.summary, ...patch } },
      },
    });
  },

  setSessionDraft: (id, draft) => {
    const s = get().sessions[id];
    if (!s) return;
    set({
      sessions: {
        ...get().sessions,
        [id]: {
          ...s,
          draft,
          summary: { ...s.summary, draft },
        },
      },
    });
  },

  setSessionScroll: (id, scrollTop) => {
    const s = get().sessions[id];
    if (!s) return;
    set({
      sessions: { ...get().sessions, [id]: { ...s, scrollTop } },
    });
  },

  setSessionBusy: (id, busy) => {
    const s = get().sessions[id];
    if (!s) return;
    const next = { ...s, busy };
    if (!busy) {
      next.streamAssistantId = null;
      next.streamThoughtId = null;
    }
    set({ sessions: { ...get().sessions, [id]: next } });
  },

  setInspector: (id, inspector) => {
    const s = get().sessions[id];
    if (!s) return;
    set({
      sessions: { ...get().sessions, [id]: { ...s, inspector } },
    });
  },

  addBlock: (sessionId, b) => {
    const s = get().sessions[sessionId];
    if (!s) return;
    set({
      sessions: {
        ...get().sessions,
        [sessionId]: { ...s, blocks: [...s.blocks, b] },
      },
    });
  },

  appendAssistant: (sessionId, text) => {
    const s = get().sessions[sessionId];
    if (!s) return;
    const blocks = [...s.blocks];
    let streamAssistantId = s.streamAssistantId;
    if (streamAssistantId) {
      const idx = blocks.findIndex(
        (b) => b.type === "assistant" && b.id === streamAssistantId,
      );
      if (idx >= 0 && blocks[idx].type === "assistant") {
        blocks[idx] = {
          type: "assistant",
          id: streamAssistantId,
          text: blocks[idx].text + text,
        };
        set({
          sessions: {
            ...get().sessions,
            [sessionId]: { ...s, blocks, streamThoughtId: null },
          },
        });
        return;
      }
    }
    streamAssistantId = crypto.randomUUID();
    blocks.push({ type: "assistant", id: streamAssistantId, text });
    set({
      sessions: {
        ...get().sessions,
        [sessionId]: {
          ...s,
          blocks,
          streamAssistantId,
          streamThoughtId: null,
        },
      },
    });
  },

  appendThought: (sessionId, text) => {
    const s = get().sessions[sessionId];
    if (!s) return;
    const blocks = [...s.blocks];
    let streamThoughtId = s.streamThoughtId;
    if (streamThoughtId) {
      const idx = blocks.findIndex(
        (b) => b.type === "thought" && b.id === streamThoughtId,
      );
      if (idx >= 0 && blocks[idx].type === "thought") {
        blocks[idx] = {
          type: "thought",
          id: streamThoughtId,
          text: blocks[idx].text + text,
        };
        set({
          sessions: {
            ...get().sessions,
            [sessionId]: { ...s, blocks, streamAssistantId: null },
          },
        });
        return;
      }
    }
    streamThoughtId = crypto.randomUUID();
    blocks.push({ type: "thought", id: streamThoughtId, text });
    set({
      sessions: {
        ...get().sessions,
        [sessionId]: {
          ...s,
          blocks,
          streamThoughtId,
          streamAssistantId: null,
        },
      },
    });
  },

  upsertTool: (sessionId, tool) => {
    const s = get().sessions[sessionId];
    if (!s) return;
    const blocks = [...s.blocks];
    const idx = blocks.findIndex(
      (b) => b.type === "tool" && b.tool.id === tool.id,
    );
    const tools = [...s.tools];
    if (idx >= 0 && blocks[idx].type === "tool") {
      const merged = { ...blocks[idx].tool, ...tool };
      blocks[idx] = { type: "tool", id: blocks[idx].id, tool: merged };
      const tIdx = tools.findIndex((t) => t.id === tool.id);
      if (tIdx >= 0) tools[tIdx] = merged;
      else tools.push(merged);
    } else {
      blocks.push({ type: "tool", id: crypto.randomUUID(), tool });
      tools.push(tool);
    }
    set({
      sessions: {
        ...get().sessions,
        [sessionId]: {
          ...s,
          blocks,
          tools,
          streamAssistantId: null,
          streamThoughtId: null,
        },
      },
    });
  },

  setPlan: (sessionId, text) => {
    const s = get().sessions[sessionId];
    if (!s) return;
    set({
      sessions: {
        ...get().sessions,
        [sessionId]: {
          ...s,
          planText: text,
          blocks: [
            ...s.blocks,
            { type: "plan", id: crypto.randomUUID(), text },
          ],
          streamAssistantId: null,
          streamThoughtId: null,
        },
      },
      rightPanel: "plan",
    });
  },

  clearChat: (sessionId) => {
    const s = get().sessions[sessionId];
    if (!s) return;
    set({
      sessions: {
        ...get().sessions,
        [sessionId]: {
          ...s,
          blocks: [],
          tools: [],
          planText: "",
          streamAssistantId: null,
          streamThoughtId: null,
        },
      },
    });
  },

  removeSession: (sessionId) => {
    const sessions = { ...get().sessions };
    delete sessions[sessionId];
    const sessionOrder = get().sessionOrder.filter((id) => id !== sessionId);
    let activeSessionId = get().activeSessionId;
    if (activeSessionId === sessionId) {
      activeSessionId = sessionOrder[0] ?? null;
    }
    set({ sessions, sessionOrder, activeSessionId });
  },

  activeBlocks: () => {
    const id = get().activeSessionId;
    if (!id) return [];
    return get().sessions[id]?.blocks ?? [];
  },
  activeBusy: () => {
    const id = get().activeSessionId;
    if (!id) return false;
    return get().sessions[id]?.busy ?? false;
  },
}));
