import { describe, expect, it } from "vitest";
import {
  BROWSER_MCP_TEMPLATE,
  browserScreenshotEvidenceSummary,
  isBrowserVerifyCommand,
  parseBrowserVerifyCommands,
} from "./browserVerify";

describe("browser verify", () => {
  it("detects browser-prefixed verify lines", () => {
    expect(isBrowserVerifyCommand("browser: https://localhost:5173")).toBe(true);
    expect(isBrowserVerifyCommand("screenshot: /dashboard")).toBe(true);
    expect(isBrowserVerifyCommand("npm test")).toBe(false);
  });

  it("parses kinds and keeps original command", () => {
    const decls = parseBrowserVerifyCommands([
      "npm test",
      "browser: navigate https://example.test",
      "screenshot: capture /settings",
      "ui: assert login form visible",
    ]);
    expect(decls).toHaveLength(3);
    expect(decls[0]?.kind).toBe("navigate");
    expect(decls[1]?.kind).toBe("screenshot");
    expect(decls[2]?.kind).toBe("assert");
    expect(decls[0]?.command).toContain("browser:");
  });

  it("exposes a paste-ready MCP template", () => {
    expect(BROWSER_MCP_TEMPLATE.transport).toBe("stdio");
    expect(BROWSER_MCP_TEMPLATE.args.join(" ")).toContain("playwright");
  });

  it("formats screenshot evidence summaries", () => {
    expect(browserScreenshotEvidenceSummary({
      url: "http://localhost:3000",
      note: "header ok",
    })).toContain("url=http://localhost:3000");
  });
});
