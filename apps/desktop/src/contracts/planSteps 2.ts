/**
 * Structured Plan artifacts + best-effort markdown fallback.
 * Prefer ACP/JSON steps with status; fall back to list heuristics.
 */

export type PlanStepStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled";

export type PlanStep = {
  id: string;
  index: number;
  text: string;
  status: PlanStepStatus;
  priority?: number | null;
};

export type PlanDocumentSource = "structured" | "markdown" | "mixed";

export type PlanDocument = {
  title?: string | null;
  summary?: string | null;
  steps: PlanStep[];
  source: PlanDocumentSource;
};

const MAX_STEPS = 40;

const STATUS_ALIASES: Record<string, PlanStepStatus> = {
  pending: "pending",
  todo: "pending",
  open: "pending",
  in_progress: "in_progress",
  inprogress: "in_progress",
  "in-progress": "in_progress",
  active: "in_progress",
  running: "in_progress",
  completed: "completed",
  complete: "completed",
  done: "completed",
  finished: "completed",
  cancelled: "cancelled",
  canceled: "cancelled",
  skipped: "cancelled",
};

export function asPlanStepStatus(value: unknown): PlanStepStatus {
  if (typeof value !== "string") return "pending";
  const key = value.trim().toLowerCase().replace(/\s+/g, "_");
  return STATUS_ALIASES[key] ?? "pending";
}

function stepFromUnknown(
  raw: unknown,
  index: number,
): PlanStep | null {
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return null;
    return {
      id: `step-${index}`,
      index,
      text,
      status: "pending",
    };
  }
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const text = [
    record.content,
    record.text,
    record.step,
    record.title,
    record.description,
    record.label,
  ]
    .find((value) => typeof value === "string" && value.trim().length >= 1);
  if (typeof text !== "string") return null;
  const priority =
    typeof record.priority === "number"
      ? record.priority
      : typeof record.priority === "string" && record.priority.trim()
        ? Number(record.priority)
        : null;
  const cleaned = text.replace(/\*\*/g, "").trim();
  if (!cleaned) return null;
  return {
    id:
      typeof record.id === "string" && record.id.trim()
        ? record.id.trim()
        : `step-${index}`,
    index,
    text: cleaned,
    status: asPlanStepStatus(record.status ?? record.state),
    priority: Number.isFinite(priority) ? priority : null,
  };
}

function stepsFromArray(value: unknown): PlanStep[] {
  if (!Array.isArray(value)) return [];
  const steps: PlanStep[] = [];
  for (const item of value) {
    const step = stepFromUnknown(item, steps.length + 1);
    if (!step) continue;
    steps.push(step);
    if (steps.length >= MAX_STEPS) break;
  }
  return steps;
}

function parseStructuredObject(value: unknown): PlanDocument | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const steps = stepsFromArray(
    record.entries
      ?? record.steps
      ?? record.items
      ?? record.plan
      ?? record.todos,
  );
  if (steps.length === 0) return null;
  const title =
    typeof record.title === "string" ? record.title.trim() || null : null;
  const summary =
    typeof record.summary === "string"
      ? record.summary.trim() || null
      : typeof record.description === "string"
        ? record.description.trim() || null
        : null;
  return {
    title,
    summary,
    steps,
    source: "structured",
  };
}

function tryParseJsonBlob(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function extractJsonFence(markdown: string): unknown | null {
  const fence = markdown.match(/```(?:json|plan)?\s*([\s\S]*?)```/i);
  if (!fence?.[1]) return null;
  return tryParseJsonBlob(fence[1]);
}

/**
 * Parse ordered/unordered markdown list items and numbered lines into steps.
 * Caps at 40 steps to keep the approval UI usable.
 */
export function parseMarkdownPlanSteps(planMarkdown: string): PlanStep[] {
  const lines = planMarkdown.split(/\r?\n/);
  const steps: PlanStep[] = [];
  const listRe = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/;
  const statusPrefix = /^(?:✅|☑️|✔|✗|❌|⏳|▶)?\s*(?:\*\*)?(pending|in[_ -]?progress|completed?|done|cancelled|canceled)(?:\*\*)?\s*[:\-–]\s*/i;
  for (const line of lines) {
    const match = line.match(listRe);
    if (!match?.[1]) continue;
    let text = match[1].replace(/\*\*/g, "").trim();
    if (!text || text.length < 2) continue;
    if (/^#{1,6}\s/.test(text)) continue;
    let status: PlanStepStatus = "pending";
    if (/^\[[xX]\]/.test(match[0]) || line.includes("[x]") || line.includes("[X]")) {
      status = "completed";
    }
    const statusMatch = text.match(statusPrefix);
    if (statusMatch?.[1]) {
      status = asPlanStepStatus(statusMatch[1]);
      text = text.slice(statusMatch[0].length).trim();
    }
    if (!text || text.length < 2) continue;
    steps.push({
      id: `step-${steps.length + 1}`,
      index: steps.length + 1,
      text,
      status,
    });
    if (steps.length >= MAX_STEPS) break;
  }
  return steps;
}

/** Prefer structured ACP/JSON; fall back to markdown list heuristics. */
export function parsePlanDocument(input: unknown): PlanDocument {
  if (input == null) {
    return { steps: [], source: "markdown" };
  }
  if (typeof input !== "string") {
    const structured = parseStructuredObject(input);
    if (structured) return structured;
    if (Array.isArray(input)) {
      const steps = stepsFromArray(input);
      if (steps.length > 0) {
        return { steps, source: "structured" };
      }
    }
    return { steps: [], source: "markdown" };
  }

  const fromFence = extractJsonFence(input);
  const fromFenceDoc = fromFence ? parseStructuredObject(fromFence) : null;
  if (fromFenceDoc) {
    const markdownSteps = parseMarkdownPlanSteps(input);
    if (markdownSteps.length > fromFenceDoc.steps.length) {
      return {
        ...fromFenceDoc,
        steps: markdownSteps.map((step, index) => ({
          ...step,
          status: fromFenceDoc.steps[index]?.status ?? step.status,
        })),
        source: "mixed",
      };
    }
    return fromFenceDoc;
  }

  const fromBlob = tryParseJsonBlob(input);
  const fromBlobDoc = fromBlob ? parseStructuredObject(fromBlob) ?? (
    Array.isArray(fromBlob)
      ? { steps: stepsFromArray(fromBlob), source: "structured" as const }
      : null
  ) : null;
  if (fromBlobDoc && fromBlobDoc.steps.length > 0) return fromBlobDoc;

  const steps = parseMarkdownPlanSteps(input);
  return { steps, source: "markdown" };
}

/** @deprecated Prefer parsePlanDocument; kept for call sites that only need steps. */
export function parsePlanSteps(planMarkdown: string): PlanStep[] {
  return parsePlanDocument(planMarkdown).steps;
}

/** Render a structured plan as markdown for clipboard / legacy display. */
export function planDocumentToMarkdown(doc: PlanDocument): string {
  const lines: string[] = [];
  if (doc.title) lines.push(`# ${doc.title}`, "");
  if (doc.summary) lines.push(doc.summary, "");
  for (const step of doc.steps) {
    const mark = step.status === "completed" ? "[x]" : "[ ]";
    const status =
      step.status === "pending" ? "" : ` (${step.status.replace("_", " ")})`;
    lines.push(`${step.index}. ${mark} ${step.text}${status}`);
  }
  return lines.join("\n").trim();
}

/** Build ACP-style comment strings from step feedback + free-form note. */
export function buildPlanComments(input: {
  stepComments: Record<string, string>;
  steps: PlanStep[];
  freeNote?: string;
}): string[] {
  const comments: string[] = [];
  for (const step of input.steps) {
    const note = input.stepComments[step.id]?.trim();
    if (note) comments.push(`Step ${step.index}: ${note}`);
  }
  const free = input.freeNote?.trim();
  if (free) comments.push(free);
  return comments;
}

/** Summarize step progress for Mission Control / headers. */
export function summarizePlanProgress(doc: PlanDocument): {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
} {
  let completed = 0;
  let inProgress = 0;
  let pending = 0;
  for (const step of doc.steps) {
    if (step.status === "completed") completed += 1;
    else if (step.status === "in_progress") inProgress += 1;
    else if (step.status !== "cancelled") pending += 1;
  }
  return {
    total: doc.steps.length,
    completed,
    inProgress,
    pending,
  };
}
