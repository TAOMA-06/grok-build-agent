/**
 * MCP server management contracts.
 * Secrets never enter the app DB, frontend state, or logs — only names.
 */

export type McpTransport = "stdio" | "http" | "sse";
export type McpScope = "user" | "project";

/** How to treat an existing secret key on edit. */
export type SecretFieldAction = "keep" | "replace" | "delete";

export type McpSecretField = {
  key: string;
  /** Only set when action is "replace" (or create). Never round-tripped from list. */
  value?: string | null;
  action: SecretFieldAction;
};

/** Input for create / update. Values are write-only. */
export type McpServerInput = {
  name: string;
  scope: McpScope;
  transport: McpTransport;
  /** Command for stdio, or URL for http/sse. */
  commandOrUrl: string;
  args: string[];
  env: McpSecretField[];
  headers: McpSecretField[];
  /** Absolute workspace root required when scope is project. */
  workspaceRoot?: string | null;
};

/** Safe list row — no secret values. */
export type McpServerInfo = {
  name: string;
  transport: McpTransport;
  scope: McpScope;
  /** Command path or remote host/URL (redacted of credentials). */
  displayTarget: string;
  command?: string | null;
  url?: string | null;
  args: string[];
  envKeys: string[];
  headerKeys: string[];
  status?: string | null;
  lastDoctor?: McpDoctorResult | null;
};

export type McpToolSummary = {
  name: string;
  description?: string | null;
};

export type McpDoctorResult = {
  name: string;
  ok: boolean;
  /** Short human-readable status. */
  summary: string;
  error?: string | null;
  tools: McpToolSummary[];
  checkedAt: string;
};

export type McpListResult = {
  servers: McpServerInfo[];
  userConfigPath: string;
  projectConfigPath?: string | null;
  /** Workspace used for project scope, if any. */
  workspaceRoot?: string | null;
};

export function emptyMcpServerInput(
  scope: McpScope = "user",
): McpServerInput {
  return {
    name: "",
    scope,
    transport: "stdio",
    commandOrUrl: "",
    args: [],
    env: [],
    headers: [],
    workspaceRoot: null,
  };
}
