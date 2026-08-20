/**
 * Curated MCP server templates — write config via upsertMcpServer.
 * Desktop does not install runtimes or download binaries.
 */

import { BROWSER_MCP_TEMPLATE } from "./browserVerify";
import { emptyMcpServerInput, type McpScope, type McpServerInfo, type McpServerInput } from "./mcp";

export type McpTemplate = {
  id: string;
  label: string;
  description: string;
  name: string;
  transport: "stdio";
  command: string;
  args: string[];
};

export const MCP_TEMPLATES: McpTemplate[] = [
  {
    id: "browser",
    label: "Browser (Playwright MCP)",
    description: BROWSER_MCP_TEMPLATE.notes,
    name: BROWSER_MCP_TEMPLATE.name,
    transport: "stdio",
    command: BROWSER_MCP_TEMPLATE.command,
    args: [...BROWSER_MCP_TEMPLATE.args],
  },
  {
    id: "filesystem",
    label: "Filesystem",
    description: "Read/write workspace files through MCP. Requires npx at runtime — not installed by Desktop.",
    name: "filesystem",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
  },
  {
    id: "github",
    label: "GitHub",
    description: "GitHub issues/PRs via MCP. Needs GITHUB_PERSONAL_ACCESS_TOKEN in env after upsert.",
    name: "github",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
  },
];

export function getMcpTemplate(id: string): McpTemplate | null {
  return MCP_TEMPLATES.find((item) => item.id === id) ?? null;
}

export function templateToMcpServerInput(
  template: McpTemplate,
  scope: McpScope = "user",
  workspaceRoot?: string | null,
): McpServerInput {
  return {
    ...emptyMcpServerInput(scope),
    name: template.name,
    transport: template.transport,
    commandOrUrl: template.command,
    args: [...template.args],
    workspaceRoot: workspaceRoot ?? null,
  };
}

/** Detect browser / Playwright / Puppeteer style MCP servers already configured. */
export function isBrowserLikeMcpServer(server: {
  name?: string | null;
  command?: string | null;
  displayTarget?: string | null;
  args?: string[] | null;
}): boolean {
  const haystack = [
    server.name,
    server.command,
    server.displayTarget,
    ...(server.args ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /playwright|puppeteer|\bbrowser\b/.test(haystack);
}

export function findBrowserLikeMcpServer(
  servers: McpServerInfo[],
): McpServerInfo | null {
  return servers.find((server) => isBrowserLikeMcpServer(server)) ?? null;
}
