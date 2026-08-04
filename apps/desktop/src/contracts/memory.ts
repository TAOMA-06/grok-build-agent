/**
 * Host-owned project memory candidates (cross-session, reviewable).
 * Accepted memories inject into the trusted task-contract partition.
 */

export type MemoryKind =
  | "convention"
  | "preference"
  | "fact"
  | "warning"
  | "profile";

export type MemoryState = "candidate" | "accepted" | "rejected";

export type MemoryCandidate = {
  memoryId: string;
  workspaceId?: string | null;
  kind: MemoryKind;
  content: string;
  sourceEventId: string;
  confidence: number;
  state: MemoryState;
  createdAt: string;
  reviewedAt?: string | null;
};

export type ProjectProfile = {
  workspaceId: string;
  /** Markdown body from `.grok/profile.md`. */
  content: string;
  /** Absolute path when backed by a file. */
  path?: string | null;
  exists: boolean;
  updatedAt?: string | null;
};

const MEMORY_KINDS: MemoryKind[] = [
  "convention",
  "preference",
  "fact",
  "warning",
  "profile",
];

export function asMemoryKind(value: unknown): MemoryKind {
  if (typeof value === "string" && MEMORY_KINDS.includes(value as MemoryKind)) {
    return value as MemoryKind;
  }
  return "fact";
}

export function asMemoryState(value: unknown): MemoryState {
  if (value === "accepted" || value === "rejected" || value === "candidate") {
    return value;
  }
  return "candidate";
}

/** Compact trusted-partition block for prompt injection. */
export function formatAcceptedMemories(memories: MemoryCandidate[]): string {
  const accepted = memories.filter((item) => item.state === "accepted" && item.content.trim());
  if (accepted.length === 0) return "";
  const lines = accepted.slice(0, 12).map((item) => {
    const kind = item.kind === "fact" ? "" : `[${item.kind}] `;
    return `- ${kind}${item.content.trim()}`;
  });
  return `<project_memory>\n${lines.join("\n")}\n</project_memory>\n\n`;
}

export function formatProjectProfile(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "";
  const clipped = trimmed.length > 2_000 ? `${trimmed.slice(0, 2_000)}…` : trimmed;
  return `<project_profile>\n${clipped}\n</project_profile>\n\n`;
}
