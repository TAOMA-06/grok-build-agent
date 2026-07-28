/**
 * Keep raw runtime failures useful without making every surface parse errors
 * differently. The renderer adds localized guidance for each category.
 */

export type UserErrorCategory =
  | "network"
  | "permission"
  | "workspace"
  | "runtime"
  | "timeout"
  | "cancelled"
  | "unknown";

export type DescribedError = {
  message: string;
  category: UserErrorCategory;
};

/** Return the meaningful part of Error / Tauri IPC / string failures. */
export function errorMessage(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error ?? "");
  const message = value
    .replace(/^(?:(?:Error|InvokeError|Unhandled promise rejection)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return message || "The local runtime did not provide an error message.";
}

/**
 * Classify common local-runtime failures. We deliberately retain the original
 * message; category only supplies a likely cause and a safe next action.
 */
export function describeError(error: unknown): DescribedError {
  const message = errorMessage(error);
  const normalized = message.toLowerCase();

  if (/\b(cancelled|canceled|abort(?:ed)?)\b/.test(normalized)) {
    return { message, category: "cancelled" };
  }
  if (/\b(timeout|timed out|deadline exceeded)\b/.test(normalized)) {
    return { message, category: "timeout" };
  }
  if (
    /dns error|failed to lookup|network\s*(?:error|\()|connecterror|connection\s+(?:failed|refused|reset|closed)|\beconn(?:refused|reset)\b|\benotfound\b|\boffline\b/.test(normalized)
  ) {
    return { message, category: "network" };
  }
  if (
    /permission denied|operation not permitted|not authorized|unauthori[sz]ed|\beacces\b|\beperm\b/.test(normalized)
  ) {
    return { message, category: "permission" };
  }
  if (
    /workspace (?:path|root|tree|preview)|unsafe workspace|path escaped root|outside (?:the )?(?:workspace|allowed paths)|not a directory/.test(normalized)
  ) {
    return { message, category: "workspace" };
  }
  if (
    /\benoent\b|no such file|command not found|could not find (?:grok|the cli)|grok (?:binary|cli).*(?:missing|not found)/.test(normalized)
  ) {
    return { message, category: "runtime" };
  }
  return { message, category: "unknown" };
}
