export type AgentStatus = {
  running: boolean;
  sessionId?: string | null;
  cwd?: string | null;
  grokPath?: string | null;
  lastError?: string | null;
};

export type GrokProbe = {
  found: boolean;
  path?: string | null;
  version?: string | null;
  error?: string | null;
};

export type HealthItem = {
  id: string;
  label: string;
  ok: boolean;
  detail?: string | null;
};

export type RuntimeHealth = {
  grok: GrokProbe;
  authenticated: boolean;
  authMethod?: string | null;
  authHint?: string | null;
  grokHome?: string | null;
  ready: boolean;
  checklist: HealthItem[];
};

export type StartConfig = {
  grokPath?: string | null;
  model?: string | null;
  alwaysApprove: boolean;
  cwd: string;
  rules?: string | null;
  agentProfile?: string | null;
  useHarness: boolean;
};

export type Settings = {
  grokPath: string;
  model: string;
  alwaysApprove: boolean;
  useHarness: boolean;
  cwd: string;
  onboardingDone: boolean;
  apiKey: string;
  theme: string;
};

export type ToolCall = {
  id: string;
  title: string;
  kind?: string;
  status: string;
  input?: unknown;
  output?: unknown;
};

export type ChatBlock =
  | { type: "user"; id: string; text: string }
  | { type: "assistant"; id: string; text: string }
  | { type: "thought"; id: string; text: string }
  | { type: "tool"; id: string; tool: ToolCall }
  | { type: "plan"; id: string; text: string }
  | { type: "system"; id: string; text: string; level?: "info" | "error" | "warn" };

export type ServerRequest = {
  jsonrpc?: string;
  id: string | number;
  method: string;
  params?: unknown;
};

export type SessionUpdate = {
  sessionUpdate?: string;
  content?: { type?: string; text?: string };
  title?: string;
  kind?: string;
  status?: string;
  toolCallId?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
  text?: string;
  plan?: unknown;
  update?: SessionUpdate;
  tool_call_id?: string;
  raw_input?: unknown;
  raw_output?: unknown;
  input?: unknown;
  output?: unknown;
  [key: string]: unknown;
};

export type RightPanel = "tasks" | "plan" | "health" | "logs" | "settings";
