/**
 * Browser verification declarations for frontend tasks.
 * Desktop does not embed a browser runtime; evidence comes from MCP tools
 * or manual screenshot attachment, recorded into CompletionGate.
 */

export type BrowserVerifyKind = "navigate" | "screenshot" | "assert" | "generic";

export type BrowserVerifyDeclaration = {
  /** Original Verify line from the task contract. */
  command: string;
  kind: BrowserVerifyKind;
  /** URL or selector hint when present. */
  target?: string | null;
  /** Human hint for how to satisfy this check. */
  hint: string;
};

const BROWSER_PREFIX =
  /^(?:browser|screenshot|ui|playwright|puppeteer)\s*[:=]\s*(.+)$/i;

/**
 * True when a Verify line opts into browser/UI evidence rather than argv checks.
 */
export function isBrowserVerifyCommand(command: string): boolean {
  return BROWSER_PREFIX.test(command.trim());
}

function classify(
  prefix: string,
  body: string,
): { kind: BrowserVerifyKind; target: string | null; hint: string } {
  const trimmed = body.trim();
  const lower = trimmed.toLowerCase();
  const prefixKind = prefix.toLowerCase();
  if (
    prefixKind === "screenshot"
    || lower.startsWith("screenshot")
    || lower.includes("screenshot")
  ) {
    return {
      kind: "screenshot",
      target: trimmed,
      hint: "Capture a screenshot via browser MCP (or attach one) and record passed evidence.",
    };
  }
  if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("navigate")) {
    return {
      kind: "navigate",
      target: trimmed.replace(/^navigate\s+/i, "").trim(),
      hint: "Open the URL with a browser MCP tool and confirm the page loads.",
    };
  }
  if (
    prefixKind === "ui"
    || lower.startsWith("assert")
    || lower.startsWith("expect")
  ) {
    return {
      kind: "assert",
      target: trimmed,
      hint: "Assert UI state via browser MCP, then mark verification passed with a short summary.",
    };
  }
  return {
    kind: "generic",
    target: trimmed,
    hint: "Satisfy this UI check with browser MCP tools; attach screenshot evidence when useful.",
  };
}

/** Parse task verificationCommands into browser-oriented declarations. */
export function parseBrowserVerifyCommands(commands: string[]): BrowserVerifyDeclaration[] {
  const out: BrowserVerifyDeclaration[] = [];
  for (const command of commands) {
    const match = command.trim().match(BROWSER_PREFIX);
    if (!match?.[1]) continue;
    const prefix = match[0].split(/[:=]/)[0]?.trim() ?? "browser";
    const classified = classify(prefix, match[1]);
    out.push({
      command: command.trim(),
      kind: classified.kind,
      target: classified.target,
      hint: classified.hint,
    });
  }
  return out;
}

/**
 * Suggested MCP server snippet for project `.grok/mcp.json` / Grok MCP config.
 * Not auto-installed — operators paste and enable explicitly.
 */
export const BROWSER_MCP_TEMPLATE = {
  name: "browser",
  transport: "stdio" as const,
  command: "npx",
  args: ["-y", "@playwright/mcp@latest"],
  notes:
    "Optional UI verification channel. Desktop records CompletionGate evidence; it does not launch Chromium itself.",
};

/** Build a manual verification summary for screenshot evidence. */
export function browserScreenshotEvidenceSummary(input: {
  url?: string | null;
  note?: string | null;
}): string {
  const parts = ["browser screenshot evidence"];
  if (input.url?.trim()) parts.push(`url=${input.url.trim()}`);
  if (input.note?.trim()) parts.push(input.note.trim());
  return parts.join(" · ");
}
