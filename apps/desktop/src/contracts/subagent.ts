/**
 * Subagent fleet contracts for Mission Control / timeline.
 *
 * Prefer structured ACP meta (`_meta.subagent` / `subagent`) when present;
 * fall back to title/kind heuristics because Grok CLI does not always emit a
 * dedicated sessionUpdate kind.
 */

export type SubagentMeta = {
  title: string;
  role: string | null;
  model: string | null;
  detail: string | null;
  parentToolCallId?: string | null;
};

export type SubagentStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown";

export type SubagentRecord = SubagentMeta & {
  toolCallId: string;
  status: SubagentStatus;
  /** True when recognition came from structured meta, not title heuristics. */
  structured: boolean;
  /** Parent tool/subagent id when the runtime advertises a tree. */
  parentToolCallId?: string | null;
};

export type SubagentTreeNode = SubagentRecord & {
  children: SubagentTreeNode[];
  depth: number;
};

export type SubagentFleetSummary = {
  active: number;
  total: number;
  byRole: Array<{ role: string; active: number; total: number }>;
  records: SubagentRecord[];
};

const SUBAGENT_KIND_RE =
  /sub[-_]?agent|spawn_subagent|task_agent|agent_spawn|delegate|worker/i;
const SUBAGENT_TITLE_RE =
  /sub[-_]?agent|spawn_subagent|background agent|worker agent|delegat/i;
const ROLE_TAG_RE = /\[(explore|plan|implementer|reviewer|researcher|general-purpose|worker)\]/i;

function stringField(value: unknown, keys: string[]): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const hit = record[key];
    if (typeof hit === "string" && hit.trim()) return hit.trim();
  }
  return null;
}

function nestedRecord(value: unknown, keys: string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const hit = record[key];
    if (hit && typeof hit === "object" && !Array.isArray(hit)) {
      return hit as Record<string, unknown>;
    }
  }
  return null;
}

/** Prefer first-class ACP subagent meta when the runtime emits it. */
export function extractStructuredSubagent(rawInput: unknown): Partial<SubagentMeta> | null {
  const structured =
    nestedRecord(rawInput, ["_meta", "meta"])
    ?? nestedRecord(rawInput, ["subagent"]);
  const fromMeta = structured
    ? nestedRecord(structured, ["subagent"]) ?? structured
    : nestedRecord(rawInput, ["subagent"]);
  if (!fromMeta) return null;
  const role = stringField(fromMeta, [
    "role",
    "subagent_type",
    "subagentType",
    "agent_type",
    "agentType",
  ]);
  const model = stringField(fromMeta, ["model", "model_slug", "modelSlug"]);
  const title = stringField(fromMeta, ["title", "name", "description"]);
  const detail = stringField(fromMeta, ["detail", "prompt", "task"]);
  const parentToolCallId = stringField(fromMeta, [
    "parentToolCallId",
    "parent_tool_call_id",
    "parentId",
    "parent_id",
  ]);
  if (!role && !model && !title && !parentToolCallId) return null;
  return { role, model, title: title ?? undefined, detail, parentToolCallId };
}

/** True when a tool_call looks like a Grok parallel/subagent worker. */
export function isSubagentTool(input: {
  title?: string | null;
  kind?: string | null;
  rawInput?: unknown;
}): boolean {
  if (extractStructuredSubagent(input.rawInput)) return true;
  const title = input.title ?? "";
  const kind = input.kind ?? "";
  if (SUBAGENT_KIND_RE.test(kind) || SUBAGENT_TITLE_RE.test(title)) return true;
  const description = stringField(input.rawInput, [
    "description",
    "prompt",
    "name",
    "subagent_type",
    "subagentType",
    "agent_type",
    "agentType",
  ]);
  if (description && SUBAGENT_TITLE_RE.test(description)) return true;
  if (stringField(input.rawInput, ["subagent_type", "subagentType", "agent_type", "agentType"])) {
    return true;
  }
  if (description && ROLE_TAG_RE.test(description)) return true;
  return false;
}

export function parseSubagentMeta(input: {
  title?: string | null;
  kind?: string | null;
  rawInput?: unknown;
  status?: string | null;
}): SubagentMeta & { structured: boolean } {
  const structured = extractStructuredSubagent(input.rawInput);
  const titleBase = (structured?.title ?? input.title ?? input.kind ?? "Subagent").trim() || "Subagent";
  const description =
    structured?.detail
    ?? stringField(input.rawInput, ["description", "prompt", "name", "task"])
    ?? null;
  const roleFromField =
    structured?.role
    ?? stringField(input.rawInput, [
      "subagent_type",
      "subagentType",
      "agent_type",
      "agentType",
      "role",
    ])
    ?? null;
  const roleFromTag = description?.match(ROLE_TAG_RE)?.[1]
    ?? titleBase.match(ROLE_TAG_RE)?.[1]
    ?? null;
  const role = (roleFromField || roleFromTag || null)?.toLowerCase() ?? null;
  const model =
    structured?.model
    ?? stringField(input.rawInput, ["model", "model_slug", "modelSlug"]);
  const cleanTitle = titleBase.replace(ROLE_TAG_RE, "").trim() || titleBase;
  const detail = description && description !== cleanTitle ? description : null;
  const parentToolCallId =
    structured?.parentToolCallId
    ?? stringField(input.rawInput, [
      "parentToolCallId",
      "parent_tool_call_id",
      "parentId",
      "parent_id",
    ]);
  return {
    title: role ? `[${role}] ${cleanTitle.replace(/^\[.*?\]\s*/, "")}` : cleanTitle,
    role,
    model,
    detail,
    parentToolCallId,
    structured: !!structured,
  };
}

export function normalizeSubagentStatus(status?: string | null): SubagentStatus {
  const value = (status ?? "").toLowerCase();
  if (!value) return "unknown";
  if (value.includes("cancel")) return "cancelled";
  if (value.includes("fail") || value.includes("error")) return "failed";
  if (value.includes("complete") || value.includes("done") || value.includes("success")) {
    return "completed";
  }
  if (value.includes("pend") || value.includes("queue")) return "pending";
  if (
    value.includes("run")
    || value.includes("progress")
    || value.includes("active")
    || value.includes("start")
    || value.includes("updated")
  ) {
    return "running";
  }
  return "unknown";
}

export function isActiveSubagentStatus(status: SubagentStatus): boolean {
  return status === "pending" || status === "running" || status === "unknown";
}

export type SubagentToolLike = {
  id?: string;
  toolCallId?: string;
  title?: string;
  kind?: string;
  status?: string;
  input?: unknown;
  rawInput?: unknown;
};

/** Materialize first-class subagent records from a session tool list. */
export function listSubagents(tools: SubagentToolLike[]): SubagentRecord[] {
  const records: SubagentRecord[] = [];
  for (const tool of tools) {
    const rawInput = tool.rawInput ?? tool.input;
    if (!isSubagentTool({ title: tool.title, kind: tool.kind, rawInput })) continue;
    const meta = parseSubagentMeta({
      title: tool.title,
      kind: tool.kind,
      rawInput,
      status: tool.status,
    });
    records.push({
      toolCallId: tool.toolCallId ?? tool.id ?? meta.title,
      title: meta.title,
      role: meta.role,
      model: meta.model,
      detail: meta.detail,
      status: normalizeSubagentStatus(tool.status),
      structured: meta.structured,
      parentToolCallId: meta.parentToolCallId ?? null,
    });
  }
  return records;
}

/**
 * Build a depth-1+ tree from parentToolCallId links.
 * Orphans (missing parent) become roots. Cycle-safe.
 */
export function buildSubagentTree(records: SubagentRecord[]): SubagentTreeNode[] {
  const byId = new Map(records.map((record) => [record.toolCallId, record]));
  const children = new Map<string, SubagentRecord[]>();
  const roots: SubagentRecord[] = [];
  for (const record of records) {
    const parentId = record.parentToolCallId;
    if (parentId && byId.has(parentId) && parentId !== record.toolCallId) {
      const bucket = children.get(parentId) ?? [];
      bucket.push(record);
      children.set(parentId, bucket);
    } else {
      roots.push(record);
    }
  }
  const visit = (record: SubagentRecord, depth: number, stack: Set<string>): SubagentTreeNode => {
    const nextStack = new Set(stack);
    nextStack.add(record.toolCallId);
    const kids = (children.get(record.toolCallId) ?? [])
      .filter((child) => !nextStack.has(child.toolCallId))
      .map((child) => visit(child, depth + 1, nextStack));
    return { ...record, depth, children: kids };
  };
  return roots.map((root) => visit(root, 0, new Set()));
}

/** Flatten tree for Mission Control rows (depth-first). */
export function flattenSubagentTree(nodes: SubagentTreeNode[]): SubagentTreeNode[] {
  const out: SubagentTreeNode[] = [];
  const walk = (items: SubagentTreeNode[]) => {
    for (const node of items) {
      out.push(node);
      if (node.children.length) walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/**
 * Desktop sends optional toolCallIds in session/cancel `_meta` as a subtree hint.
 * ACP cancel remains session-scoped unless the runtime honors `_meta.toolCallIds`.
 * Mission Control Stop uses soft cancel (no hard runtime stop) so the turn can continue.
 */
export function subagentCancelScopeNote(): string {
  return "Stop sends ACP session/cancel. Choosing one worker marks its subtree cancelled locally and attaches toolCallIds in _meta as a soft hint — Grok still treats cancel as session-wide unless the runtime honors the hint. Mission Control Stop does not hard-kill the Host runtime.";
}

/** Collect a worker id and all descendants via parentToolCallId links. */
export function collectSubtreeToolCallIds(
  records: SubagentRecord[],
  rootId: string,
): string[] {
  const children = new Map<string, string[]>();
  for (const record of records) {
    const parentId = record.parentToolCallId;
    if (!parentId || parentId === record.toolCallId) continue;
    const bucket = children.get(parentId) ?? [];
    bucket.push(record.toolCallId);
    children.set(parentId, bucket);
  }
  const out: string[] = [];
  const stack = [rootId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const child of children.get(id) ?? []) stack.push(child);
  }
  return out;
}

export function summarizeSubagentFleet(tools: SubagentToolLike[]): SubagentFleetSummary {
  const records = listSubagents(tools);
  const roleMap = new Map<string, { active: number; total: number }>();
  let active = 0;
  for (const record of records) {
    const role = record.role ?? "worker";
    const bucket = roleMap.get(role) ?? { active: 0, total: 0 };
    bucket.total += 1;
    if (isActiveSubagentStatus(record.status)) {
      bucket.active += 1;
      active += 1;
    }
    roleMap.set(role, bucket);
  }
  const byRole = [...roleMap.entries()]
    .map(([role, counts]) => ({ role, ...counts }))
    .sort((left, right) => right.active - left.active || left.role.localeCompare(right.role));
  return {
    active,
    total: records.length,
    byRole,
    records,
  };
}

/** Count subagents that are still running on a session's tools list. */
export function countActiveSubagents(tools: SubagentToolLike[]): number {
  return summarizeSubagentFleet(tools).active;
}
