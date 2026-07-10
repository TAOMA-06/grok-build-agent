import { create } from "zustand";
import { defaultSettings } from "./contracts";
import type {
  AgentStatus,
  ChatBlock,
  RightPanel,
  RuntimeHealth,
  ServerRequest,
  Settings,
  ToolCall,
} from "./types";

export { defaultSettings };

type AppState = {
  settings: Settings;
  settingsLoaded: boolean;
  status: AgentStatus;
  health: RuntimeHealth | null;
  blocks: ChatBlock[];
  busy: boolean;
  stderr: string[];
  pendingPermission: ServerRequest | null;
  rightPanel: RightPanel;
  planText: string;
  tools: ToolCall[];
  setSettings: (s: Partial<Settings>) => void;
  replaceSettings: (s: Settings) => void;
  setSettingsLoaded: (v: boolean) => void;
  setStatus: (s: AgentStatus) => void;
  setHealth: (h: RuntimeHealth | null) => void;
  setBusy: (b: boolean) => void;
  setRightPanel: (p: RightPanel) => void;
  addBlock: (b: ChatBlock) => void;
  appendAssistant: (text: string) => void;
  appendThought: (text: string) => void;
  upsertTool: (tool: ToolCall) => void;
  setPlan: (text: string) => void;
  pushStderr: (line: string) => void;
  setPermission: (req: ServerRequest | null) => void;
  clearChat: () => void;
};

let streamAssistantId: string | null = null;
let streamThoughtId: string | null = null;

export const useAppStore = create<AppState>((set, get) => ({
  settings: defaultSettings(),
  settingsLoaded: false,
  status: { running: false },
  health: null,
  blocks: [],
  busy: false,
  stderr: [],
  pendingPermission: null,
  rightPanel: "health",
  planText: "",
  tools: [],

  setSettings: (partial) => {
    set({ settings: { ...get().settings, ...partial } });
  },

  replaceSettings: (settings) => set({ settings }),

  setSettingsLoaded: (settingsLoaded) => set({ settingsLoaded }),

  setStatus: (status) => set({ status }),
  setHealth: (health) => set({ health }),
  setBusy: (busy) => {
    if (!busy) {
      streamAssistantId = null;
      streamThoughtId = null;
    }
    set({ busy });
  },
  setRightPanel: (rightPanel) => set({ rightPanel }),

  addBlock: (b) => set({ blocks: [...get().blocks, b] }),

  appendAssistant: (text) => {
    const blocks = [...get().blocks];
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
        set({ blocks });
        return;
      }
    }
    streamAssistantId = crypto.randomUUID();
    streamThoughtId = null;
    blocks.push({ type: "assistant", id: streamAssistantId, text });
    set({ blocks });
  },

  appendThought: (text) => {
    const blocks = [...get().blocks];
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
        set({ blocks });
        return;
      }
    }
    streamThoughtId = crypto.randomUUID();
    streamAssistantId = null;
    blocks.push({ type: "thought", id: streamThoughtId, text });
    set({ blocks });
  },

  upsertTool: (tool) => {
    const blocks = [...get().blocks];
    const idx = blocks.findIndex(
      (b) => b.type === "tool" && b.tool.id === tool.id,
    );
    streamAssistantId = null;
    streamThoughtId = null;
    if (idx >= 0 && blocks[idx].type === "tool") {
      const merged = { ...blocks[idx].tool, ...tool };
      blocks[idx] = { type: "tool", id: blocks[idx].id, tool: merged };
      const tools = [...get().tools];
      const tIdx = tools.findIndex((t) => t.id === tool.id);
      if (tIdx >= 0) tools[tIdx] = merged;
      else tools.push(merged);
      set({ blocks, tools });
    } else {
      blocks.push({ type: "tool", id: crypto.randomUUID(), tool });
      set({ blocks, tools: [...get().tools, tool] });
    }
  },

  setPlan: (text) => {
    streamAssistantId = null;
    streamThoughtId = null;
    set({
      planText: text,
      blocks: [
        ...get().blocks,
        { type: "plan", id: crypto.randomUUID(), text },
      ],
      rightPanel: "plan",
    });
  },

  pushStderr: (line) => {
    const stderr = [...get().stderr, line].slice(-300);
    set({ stderr });
  },

  setPermission: (pendingPermission) => set({ pendingPermission }),

  clearChat: () => {
    streamAssistantId = null;
    streamThoughtId = null;
    set({ blocks: [], stderr: [], tools: [], planText: "" });
  },
}));
