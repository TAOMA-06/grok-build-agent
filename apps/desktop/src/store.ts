import { create } from "zustand";
import {
  defaultSettings,
  emptyComposerDraft,
  defaultModeState,
  emptySessionModelState,
} from "./contracts";
import type {
  AgentStatus,
  AvailableCommand,
  ChatBlock,
  ComposerAttachment,
  ComposerDraft,
  FailedSubmission,
  InspectorSelection,
  ReviewSnapshot,
  RightPanel,
  RuntimeHealth,
  ServerRequest,
  SessionModelState,
  SessionModeState,
  SessionSummary,
  Settings,
  ToolCall,
  WorkbenchSurface,
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
  /** Per-session model snapshot (overrides settings default when set). */
  modelState: SessionModelState | null;
  modeState: SessionModeState;
  availableCommands: AvailableCommand[];
  attachments: ComposerAttachment[];
  failedSubmission: FailedSubmission | null;
};

// --- Slice shapes (settings / sessions / composer / runtime / admin UI) ---

type SettingsSlice = {
  settings: Settings;
  settingsLoaded: boolean;
  setSettings: (s: Partial<Settings>) => void;
  replaceSettings: (s: Settings) => void;
  setSettingsLoaded: (v: boolean) => void;
};

type SessionSlice = {
  sessions: Record<string, SessionRuntime>;
  sessionOrder: string[];
  activeSessionId: string | null;
  ensureSession: (summary: SessionSummary) => void;
  setActiveSession: (id: string | null) => void;
  updateSummary: (id: string, patch: Partial<SessionSummary>) => void;
  setSessionDraft: (id: string, draft: string) => void;
  setSessionScroll: (id: string, scrollTop: number) => void;
  setSessionBusy: (id: string, busy: boolean) => void;
  setInspector: (id: string, sel: InspectorSelection | null) => void;
  setSessionAttachments: (id: string, attachments: ComposerAttachment[]) => void;
  setSessionModelState: (id: string, state: SessionModelState | null) => void;
  setSessionModeState: (id: string, state: SessionModeState) => void;
  setSessionCommands: (id: string, commands: AvailableCommand[]) => void;
  addBlock: (sessionId: string, b: ChatBlock) => void;
  updateBlock: (sessionId: string, blockId: string, patch: Partial<ChatBlock>) => void;
  setFailedSubmission: (id: string, failed: FailedSubmission | null) => void;
  appendAssistant: (sessionId: string, text: string) => void;
  appendThought: (sessionId: string, text: string) => void;
  upsertTool: (sessionId: string, tool: ToolCall) => void;
  setPlan: (sessionId: string, text: string) => void;
  clearChat: (sessionId: string) => void;
  removeSession: (sessionId: string) => void;
  activeBlocks: () => ChatBlock[];
  activeBusy: () => boolean;
};

type ComposerSlice = {
  /**
   * Provisional draft when there is no active session.
   * Migrated into SessionRuntime on first send / session create.
   */
  provisionalDraft: ComposerDraft;
  setProvisionalDraft: (patch: Partial<ComposerDraft>) => void;
  replaceProvisionalDraft: (draft: ComposerDraft) => void;
  clearProvisionalDraft: () => void;
  /**
   * Effective composer text for the current context
   * (active session draft or provisional).
   */
  effectiveDraftText: () => string;
  setEffectiveDraftText: (text: string) => void;
  effectiveAttachments: () => ComposerAttachment[];
  setEffectiveAttachments: (attachments: ComposerAttachment[]) => void;
  effectiveModelId: () => string | null;
  setEffectiveModelId: (modelId: string | null) => void;
  effectiveMode: () => import("./types").TaskMode;
  setEffectiveMode: (mode: import("./types").TaskMode) => void;
};

type RuntimeSlice = {
  status: AgentStatus;
  health: RuntimeHealth | null;
  stderr: string[];
  pendingPermission: ServerRequest | null;
  pendingPlanApproval: ServerRequest | null;
  permissionOptions: { optionId: string; name: string; kind?: string }[];
  globalModelState: SessionModelState;
  /** MCP/config changed; agent should be reloaded when idle. */
  agentReloadRequired: boolean;
  setStatus: (s: AgentStatus) => void;
  setHealth: (h: RuntimeHealth | null) => void;
  pushStderr: (line: string) => void;
  setPermission: (
    req: ServerRequest | null,
    options?: { optionId: string; name: string; kind?: string }[],
  ) => void;
  setPlanApproval: (req: ServerRequest | null) => void;
  setGlobalModelState: (s: SessionModelState) => void;
  setAgentReloadRequired: (v: boolean) => void;
};

type AdminUiSlice = {
  rightPanel: RightPanel;
  surface: WorkbenchSurface;
  workspaces: WorkspaceRecord[];
  review: ReviewSnapshot | null;
  worktrees: WorktreeSummary[];
  patchPreview: { path: string; text: string } | null;
  setRightPanel: (p: RightPanel) => void;
  setSurface: (s: WorkbenchSurface) => void;
  setWorkspaces: (w: WorkspaceRecord[]) => void;
  setReview: (r: ReviewSnapshot | null) => void;
  setWorktrees: (w: WorktreeSummary[]) => void;
  setPatchPreview: (p: { path: string; text: string } | null) => void;
};

type AppState = SettingsSlice &
  SessionSlice &
  ComposerSlice &
  RuntimeSlice &
  AdminUiSlice;

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
    modelState: summary.model
      ? {
          currentModelId: summary.model,
          availableModels: [],
          liveSwitchSupported: false,
          source: "configured",
        }
      : null,
    modeState: defaultModeState(summary.mode ?? "agent"),
    availableCommands: [],
    attachments: [],
    failedSubmission: null,
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  // --- settings ---
  settings: defaultSettings(),
  settingsLoaded: false,
  setSettings: (partial) => {
    set({ settings: { ...get().settings, ...partial } });
  },
  replaceSettings: (settings) => set({ settings }),
  setSettingsLoaded: (settingsLoaded) => set({ settingsLoaded }),

  // --- runtime ---
  status: { running: false },
  health: null,
  stderr: [],
  pendingPermission: null,
  pendingPlanApproval: null,
  permissionOptions: [],
  globalModelState: emptySessionModelState(),
  agentReloadRequired: false,
  setStatus: (status) => {
    const patch: Partial<AppState> = { status };
    if (status.model) {
      patch.globalModelState = status.model;
    }
    set(patch);
  },
  setHealth: (health) => set({ health }),
  pushStderr: (line) => {
    set({ stderr: [...get().stderr, line].slice(-300) });
  },
  setPermission: (pendingPermission, options) =>
    set({
      pendingPermission,
      permissionOptions: pendingPermission ? (options ?? []) : [],
    }),
  setPlanApproval: (pendingPlanApproval) => set({ pendingPlanApproval }),
  setGlobalModelState: (globalModelState) => set({ globalModelState }),
  setAgentReloadRequired: (agentReloadRequired) => set({ agentReloadRequired }),

  // --- admin UI ---
  rightPanel: "health",
  surface: "chat",
  workspaces: [],
  review: null,
  worktrees: [],
  patchPreview: null,
  setRightPanel: (rightPanel) => set({ rightPanel }),
  setSurface: (surface) => set({ surface }),
  setWorkspaces: (workspaces) => set({ workspaces }),
  setReview: (review) => set({ review }),
  setWorktrees: (worktrees) => set({ worktrees }),
  setPatchPreview: (patchPreview) => set({ patchPreview }),

  // --- composer (provisional) ---
  provisionalDraft: emptyComposerDraft(undefined, defaultSettings().defaultMode),
  setProvisionalDraft: (patch) => {
    set({ provisionalDraft: { ...get().provisionalDraft, ...patch } });
  },
  replaceProvisionalDraft: (provisionalDraft) => set({ provisionalDraft }),
  clearProvisionalDraft: () => {
    set({
      provisionalDraft: emptyComposerDraft(
        get().settings.model || null,
        get().settings.defaultMode,
      ),
    });
  },
  effectiveDraftText: () => {
    const id = get().activeSessionId;
    if (id && get().sessions[id]) return get().sessions[id].draft;
    return get().provisionalDraft.text;
  },
  setEffectiveDraftText: (text) => {
    const id = get().activeSessionId;
    if (id && get().sessions[id]) {
      get().setSessionDraft(id, text);
      return;
    }
    get().setProvisionalDraft({ text });
  },
  effectiveAttachments: () => {
    const id = get().activeSessionId;
    if (id && get().sessions[id]) return get().sessions[id].attachments;
    return get().provisionalDraft.attachments;
  },
  setEffectiveAttachments: (attachments) => {
    const id = get().activeSessionId;
    if (id && get().sessions[id]) {
      get().setSessionAttachments(id, attachments);
      return;
    }
    get().setProvisionalDraft({ attachments });
  },
  effectiveModelId: () => {
    const id = get().activeSessionId;
    if (id) {
      const s = get().sessions[id];
      if (s?.summary.model) return s.summary.model;
      if (s?.modelState?.currentModelId) return s.modelState.currentModelId;
    }
    return (
      get().provisionalDraft.modelId ??
      get().globalModelState.currentModelId ??
      get().settings.model ??
      null
    );
  },
  setEffectiveModelId: (modelId) => {
    const id = get().activeSessionId;
    if (id && get().sessions[id]) {
      get().updateSummary(id, {
        model: modelId,
        updatedAt: new Date().toISOString(),
      });
      const prev = get().sessions[id].modelState;
      get().setSessionModelState(id, {
        currentModelId: modelId,
        availableModels: prev?.availableModels ?? get().globalModelState.availableModels,
        liveSwitchSupported: prev?.liveSwitchSupported ?? false,
        source: prev?.source ?? "configured",
      });
      return;
    }
    get().setProvisionalDraft({ modelId });
  },
  effectiveMode: () => {
    const id = get().activeSessionId;
    if (id && get().sessions[id]) {
      return get().sessions[id].modeState.currentMode
        ?? get().sessions[id].summary.mode
        ?? "agent";
    }
    return get().provisionalDraft.mode ?? get().settings.defaultMode;
  },
  setEffectiveMode: (mode) => {
    const id = get().activeSessionId;
    if (id && get().sessions[id]) {
      get().updateSummary(id, { mode, updatedAt: new Date().toISOString() });
      const state = get().sessions[id].modeState;
      get().setSessionModeState(id, { ...state, currentMode: mode });
      return;
    }
    get().setProvisionalDraft({ mode });
  },

  // --- sessions ---
  sessions: {},
  sessionOrder: [],
  activeSessionId: null,

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

  setSessionAttachments: (id, attachments) => {
    const s = get().sessions[id];
    if (!s) return;
    set({
      sessions: { ...get().sessions, [id]: { ...s, attachments } },
    });
  },

  setSessionModelState: (id, modelState) => {
    const s = get().sessions[id];
    if (!s) return;
    set({
      sessions: { ...get().sessions, [id]: { ...s, modelState } },
    });
  },

  setSessionModeState: (id, modeState) => {
    const s = get().sessions[id];
    if (!s) return;
    set({
      sessions: { ...get().sessions, [id]: { ...s, modeState } },
    });
  },

  setSessionCommands: (id, availableCommands) => {
    const s = get().sessions[id];
    if (!s) return;
    set({
      sessions: { ...get().sessions, [id]: { ...s, availableCommands } },
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

  updateBlock: (sessionId, blockId, patch) => {
    const s = get().sessions[sessionId];
    if (!s) return;
    set({
      sessions: {
        ...get().sessions,
        [sessionId]: {
          ...s,
          blocks: s.blocks.map((block) =>
            block.id === blockId ? ({ ...block, ...patch } as ChatBlock) : block,
          ),
        },
      },
    });
  },

  setFailedSubmission: (id, failedSubmission) => {
    const s = get().sessions[id];
    if (!s) return;
    set({ sessions: { ...get().sessions, [id]: { ...s, failedSubmission } } });
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
    const lastBlock = s.blocks[s.blocks.length - 1];
    const blocks = lastBlock?.type === "plan" && lastBlock.text === text
      ? s.blocks
      : [...s.blocks, { type: "plan" as const, id: crypto.randomUUID(), text }];
    set({
      sessions: {
        ...get().sessions,
        [sessionId]: {
          ...s,
          planText: text,
          blocks,
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
