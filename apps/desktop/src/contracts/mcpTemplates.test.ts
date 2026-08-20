import { describe, expect, it } from "vitest";
import {
  findBrowserLikeMcpServer,
  getMcpTemplate,
  isBrowserLikeMcpServer,
  MCP_TEMPLATES,
  templateToMcpServerInput,
} from "./mcpTemplates";

describe("mcpTemplates", () => {
  it("ships at least three curated templates including browser", () => {
    expect(MCP_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    expect(getMcpTemplate("browser")?.command).toBe("npx");
    expect(getMcpTemplate("browser")?.args.join(" ")).toContain("playwright");
  });

  it("maps a template to McpServerInput without secrets", () => {
    const template = getMcpTemplate("filesystem")!;
    const input = templateToMcpServerInput(template, "project", "/tmp/ws");
    expect(input).toMatchObject({
      name: "filesystem",
      scope: "project",
      transport: "stdio",
      commandOrUrl: "npx",
      workspaceRoot: "/tmp/ws",
    });
    expect(input.args).toContain("@modelcontextprotocol/server-filesystem");
  });

  it("detects browser-like MCP servers by name or args", () => {
    expect(
      isBrowserLikeMcpServer({
        name: "browser",
        command: "npx",
        args: ["-y", "@playwright/mcp@latest"],
      }),
    ).toBe(true);
    expect(
      isBrowserLikeMcpServer({
        name: "filesystem",
        command: "npx",
        args: ["@modelcontextprotocol/server-filesystem"],
      }),
    ).toBe(false);
    expect(
      findBrowserLikeMcpServer([
        {
          name: "fs",
          transport: "stdio",
          scope: "user",
          displayTarget: "npx",
          command: "npx",
          args: ["filesystem"],
          envKeys: [],
          headerKeys: [],
          enabled: true,
        },
        {
          name: "ui",
          transport: "stdio",
          scope: "project",
          displayTarget: "npx playwright",
          command: "npx",
          args: ["@playwright/mcp"],
          envKeys: [],
          headerKeys: [],
          enabled: false,
        },
      ])?.name,
    ).toBe("ui");
  });
});
