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

/** Timeline-facing note when screenshot evidence is recorded into CompletionGate. */
export function browserEvidenceTimelineNote(summary: string): string {
  const trimmed = summary.trim() || "browser screenshot evidence";
  return `Browser verify evidence recorded · ${trimmed}`;
}

/** True when an attachment looks like screenshot evidence for browser verify. */
export function isScreenshotAttachment(input: {
  name?: string | null;
  mimeType?: string | null;
}): boolean {
  const mime = input.mimeType?.toLowerCase() ?? "";
  if (mime.startsWith("image/")) return true;
  const name = input.name?.toLowerCase() ?? "";
  return /\.(png|jpe?g|webp|gif)$/i.test(name) || /screenshot|screen.?shot/i.test(name);
}

/**
 * Composer runbook for satisfying browser Verify lines via MCP (no embedded Chromium).
 */
export function buildBrowserVerifyRunbook(
  declarations: BrowserVerifyDeclaration[],
): string {
  if (declarations.length === 0) {
    return [
      "Enable a browser MCP (Playwright) and verify the UI acceptance checks.",
      "After screenshots, record evidence in Desktop CompletionGate.",
    ].join("\n");
  }
  const steps = declarations.map((item, index) => {
    const target = item.target ? ` → ${item.target}` : "";
    return `${index + 1}. [${item.kind}] ${item.command}${target}\n   ${item.hint}`;
  });
  return [
    "Run the browser verification checklist using browser MCP tools (Desktop does not launch Chromium).",
    "",
    ...steps,
    "",
    "When done, record screenshot evidence in the Verification tab so CompletionGate can pass.",
  ].join("\n");
}
