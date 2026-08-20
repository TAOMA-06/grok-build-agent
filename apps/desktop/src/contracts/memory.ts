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

/** Heuristic proposal extracted from transcript text (not yet persisted). */
export type MemoryProposal = {
  kind: MemoryKind;
  content: string;
  confidence: number;
  sourceEventId: string;
  matchedBy: string;
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

export function normalizeMemoryContent(content: string): string {
  return content.replace(/\s+/g, " ").trim().toLowerCase();
}

type ExtractRule = {
  re: RegExp;
  kind: MemoryKind;
  confidence: number;
  matchedBy: string;
};

const EXTRACT_RULES: ExtractRule[] = [
  {
    re: /(?:^|\n)\s*(?:\/remember|\/memory|\/mem)\s+(.+)$/gim,
    kind: "preference",
    confidence: 0.92,
    matchedBy: "slash-command",
  },
  {
    re: /(?:^|\n)\s*(?:remember|记住|请记住)\s*[:：]\s*(.+)$/gim,
    kind: "preference",
    confidence: 0.88,
    matchedBy: "remember",
  },
  {
    re: /(?:^|\n)\s*(?:convention|约定)\s*[:：]\s*(.+)$/gim,
    kind: "convention",
    confidence: 0.86,
    matchedBy: "convention",
  },
  {
    re: /(?:^|\n)\s*(?:prefer|优先)\s*[:：]\s*(.+)$/gim,
    kind: "preference",
    confidence: 0.8,
    matchedBy: "prefer",
  },
  {
    re: /(?:^|\n)\s*(?:warning|注意|never)\s*[:：]\s*(.+)$/gim,
    kind: "warning",
    confidence: 0.78,
    matchedBy: "warning",
  },
  {
    re: /(?:^|\n)\s*always\s+([A-Za-z].{7,180})$/gim,
    kind: "convention",
    confidence: 0.62,
    matchedBy: "always",
  },
];

function clipProposalContent(raw: string): string | null {
  let content = raw.replace(/\s+/g, " ").trim();
  content = content.replace(/^[-*•]\s+/, "").replace(/[.。;；]+$/, "").trim();
  if (content.length < 8 || content.length > 240) return null;
  // Avoid dumping whole assistant essays.
  if ((content.match(/[.!?。！？]/g) ?? []).length > 3) return null;
  return content;
}

/** Extract high-precision memory proposals from a single message body. */
export function extractMemoryProposalsFromText(
  text: string,
  sourceEventId: string,
): MemoryProposal[] {
  if (!text.trim()) return [];
  const out: MemoryProposal[] = [];
  const seen = new Set<string>();
  for (const rule of EXTRACT_RULES) {
    rule.re.lastIndex = 0;
    for (const match of text.matchAll(rule.re)) {
      const content = clipProposalContent(match[1] ?? "");
      if (!content) continue;
      const key = normalizeMemoryContent(content);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        kind: rule.kind,
        content,
        confidence: rule.confidence,
        sourceEventId,
        matchedBy: rule.matchedBy,
      });
    }
  }
  return out;
}

type TranscriptBlock = {
  type: string;
  id?: string;
  text?: string;
};

/** Scan user/assistant/system blocks for memory-like statements. */
export function extractMemoryProposalsFromBlocks(
  blocks: TranscriptBlock[],
): MemoryProposal[] {
  const out: MemoryProposal[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    if (
      block.type !== "user"
      && block.type !== "assistant"
      && block.type !== "system"
    ) {
      continue;
    }
    const text = block.text?.trim();
    if (!text) continue;
    for (const proposal of extractMemoryProposalsFromText(
      text,
      block.id ?? `${block.type}-unknown`,
    )) {
      const key = normalizeMemoryContent(proposal.content);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(proposal);
    }
  }
  return out;
}

/** Drop proposals that already exist (any state) in the workspace memory list. */
export function filterNewMemoryProposals(
  proposals: MemoryProposal[],
  existing: MemoryCandidate[],
): MemoryProposal[] {
  const seen = new Set(
    existing.map((item) => normalizeMemoryContent(item.content)).filter(Boolean),
  );
  const out: MemoryProposal[] = [];
  for (const proposal of proposals) {
    const key = normalizeMemoryContent(proposal.content);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(proposal);
  }
  return out;
}

/**
 * Append an accepted memory into project profile markdown (deduped).
 * Used when accepting a candidate so Rules/Memory and profile stay linked.
 */
export function appendMemoryToProfile(
  profile: string,
  memory: Pick<MemoryCandidate, "kind" | "content">,
): string {
  const content = memory.content.trim();
  if (!content) return profile;
  const line = `- [${memory.kind}] ${content}`;
  const normalized = normalizeMemoryContent(content);
  const existing = profile
    .split("\n")
    .map((row) => normalizeMemoryContent(row.replace(/^[-*•]\s*(?:\[[^\]]+\]\s*)?/, "")))
    .filter(Boolean);
  if (existing.includes(normalized)) return profile;
  const trimmed = profile.trimEnd();
  if (!trimmed) {
    return `## Accepted memories\n\n${line}\n`;
  }
  if (/^##\s+Accepted memories\b/im.test(trimmed)) {
    return `${trimmed}\n${line}\n`;
  }
  return `${trimmed}\n\n## Accepted memories\n\n${line}\n`;
}
