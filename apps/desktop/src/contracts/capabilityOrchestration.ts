/**
 * First-class Skills / Hooks orchestration helpers.
 * Capabilities come from `grok inspect`; Desktop turns them into actionable drafts
 * rather than a read-only directory listing.
 */

import type { CapabilityItem } from "./desktop";

export type CapabilityKind = "skill" | "hook" | "agent" | "plugin" | "command";

export type OrchestrationEntry = {
  kind: CapabilityKind;
  item: CapabilityItem;
  /** Slash / prompt draft ready for the composer. */
  draft: string;
  /** Short operator hint. */
  hint: string;
};

export type CapabilityGroup = {
  source: string;
  items: CapabilityItem[];
};

/** Normalize a capability into a slash invocation for ACP/skills. */
export function skillInvocationDraft(skill: CapabilityItem): string {
  const raw = (skill.id || skill.name || "").trim();
  if (!raw) return "";
  const name = raw.startsWith("/") ? raw : `/${raw.replace(/\s+/g, "-")}`;
  return name;
}

/** Hooks are event-driven; draft a reminder prompt rather than a fake invoke. */
export function hookInvocationDraft(hook: CapabilityItem): string {
  const label = hook.name || hook.id || "hook";
  const event = hook.description?.trim();
  return event
    ? `Respect the enabled hook "${label}" (${event}). Do not bypass it.`
    : `Respect the enabled project hook "${label}". Do not bypass it.`;
}

export function groupCapabilitiesBySource(items: CapabilityItem[]): CapabilityGroup[] {
  const map = new Map<string, CapabilityItem[]>();
  for (const item of items) {
    const source = (item.source || "unknown").trim() || "unknown";
    const bucket = map.get(source) ?? [];
    bucket.push(item);
    map.set(source, bucket);
  }
  return [...map.entries()]
    .map(([source, grouped]) => ({
      source,
      items: [...grouped].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.source.localeCompare(b.source));
}

export function buildSkillOrchestrationEntries(skills: CapabilityItem[]): OrchestrationEntry[] {
  return skills
    .filter((item) => item.enabled !== false)
    .map((item) => ({
      kind: "skill" as const,
      item,
      draft: skillInvocationDraft(item),
      hint: "Insert slash skill into the composer, then send to run via ACP.",
    }))
    .filter((entry) => entry.draft.length > 1);
}

export function buildHookOrchestrationEntries(hooks: CapabilityItem[]): OrchestrationEntry[] {
  return hooks
    .filter((item) => item.enabled !== false)
    .map((item) => ({
      kind: "hook" as const,
      item,
      draft: hookInvocationDraft(item),
      hint: "Hooks fire on CLI events; this inserts an explicit reminder into the prompt.",
    }));
}

/** Queue several skills into one composer draft (ordered orchestration). */
export function composeOrchestrationDraft(entries: OrchestrationEntry[]): string {
  const skills = entries.filter((entry) => entry.kind === "skill" && entry.draft);
  const hooks = entries.filter((entry) => entry.kind === "hook" && entry.draft);
  const lines: string[] = [];
  if (hooks.length) {
    lines.push("## Hooks to honor");
    for (const entry of hooks) lines.push(`- ${entry.draft}`);
    lines.push("");
  }
  if (skills.length) {
    lines.push("## Run these skills in order");
    for (const entry of skills) {
      lines.push(entry.draft);
    }
  }
  return lines.join("\n").trim();
}
