/**
 * Session-level model selection contracts.
 * Settings.model is the default for new sessions; Composer/session owns the live choice.
 */

export type ModelSource = "acp" | "cli" | "configured";

/** Canonical Grok reasoning-effort levels (CLI `--reasoning-effort`). */
export type ReasoningEffortLevel =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type ReasoningEffortOption = {
  id: string;
  value: string;
  label: string;
  description?: string | null;
  default?: boolean;
};

export type SelectableModel = {
  id: string;
  name: string;
  description?: string | null;
  isDefault?: boolean;
  /** Free-form tags from CLI/ACP (e.g. "fast", "reasoning"). */
  tags?: string[];
  /** Context window size in tokens when known from the model catalog. */
  contextWindow?: number | null;
  supportsReasoningEffort?: boolean;
  /** Default effort for this model when supported. */
  reasoningEffort?: string | null;
  reasoningEfforts?: ReasoningEffortOption[];
  /** Auto-compact threshold percent from the model catalog (e.g. 80). */
  autoCompactThresholdPercent?: number | null;
};

export type SessionModelState = {
  currentModelId: string | null;
  availableModels: SelectableModel[];
  /** True when the active ACP agent can switch models without reconnecting. */
  liveSwitchSupported: boolean;
  source: ModelSource;
};

export type ModelSwitchResult =
  | { kind: "switched"; state: SessionModelState }
  | { kind: "new_session_required"; reason: string };

export type EffortSwitchResult =
  | { kind: "switched"; effort: string; liveSwitchSupported: boolean }
  | { kind: "restart_required"; effort: string; reason: string };

/** Agent-reported or estimated context-window usage for a session. */
export type SessionContextUsage = {
  usedTokens: number | null;
  windowTokens: number | null;
  usagePercent: number | null;
  /** Latest provider request's prompt-cache accounting, when exposed by ACP. */
  promptCache: {
    promptTokens: number | null;
    cachedTokens: number;
    uncachedTokens: number | null;
    hitRatePercent: number | null;
    /** Exact provider charge for the request, after cache discounts. */
    costUsd: number | null;
  } | null;
  source: "acp" | "slash" | "estimate" | "catalog" | "unknown";
  updatedAt: string;
};

export function emptySessionModelState(
  currentModelId?: string | null,
): SessionModelState {
  return {
    currentModelId: currentModelId ?? null,
    availableModels: [],
    liveSwitchSupported: false,
    source: "configured",
  };
}

export function modelsFromIds(
  ids: string[],
  current?: string | null,
  source: ModelSource = "acp",
): SessionModelState {
  const availableModels = ids.map((id) => ({
    id,
    name: id,
    isDefault: current ? id === current : false,
  }));
  return {
    currentModelId: current ?? ids[0] ?? null,
    availableModels,
    liveSwitchSupported: source === "acp" && ids.length > 0,
    source,
  };
}

export function emptyContextUsage(
  windowTokens?: number | null,
): SessionContextUsage {
  return {
    usedTokens: null,
    windowTokens: windowTokens ?? null,
    usagePercent: null,
    promptCache: null,
    source: windowTokens != null ? "catalog" : "unknown",
    updatedAt: new Date().toISOString(),
  };
}

export function formatTokenCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

/** Effort levels offered in app settings (Grok catalog today). */
export const SETTINGS_REASONING_EFFORTS = ["low", "medium", "high"] as const;

/** Prefer catalog options for the active model; fall back to common CLI levels. */
export function effortOptionsForModel(
  model: SelectableModel | null | undefined,
): ReasoningEffortOption[] {
  if (model?.supportsReasoningEffort === false) return [];
  if (model?.reasoningEfforts?.length) return model.reasoningEfforts;
  if (model?.supportsReasoningEffort) {
    return [
      { id: "low", value: "low", label: "Low" },
      { id: "medium", value: "medium", label: "Medium" },
      { id: "high", value: "high", label: "High", default: true },
    ];
  }
  return [];
}

/**
 * Map unsupported / Codex-style effort strings (e.g. `xhigh`) onto Grok settings values.
 * Empty becomes `high` so new sessions never spawn with a dead default.
 */
export function sanitizeDefaultReasoningEffort(
  value: string | null | undefined,
): string {
  const trimmed = (value ?? "").trim().toLowerCase();
  if ((SETTINGS_REASONING_EFFORTS as readonly string[]).includes(trimmed)) {
    return trimmed;
  }
  if (trimmed === "xhigh" || trimmed === "max" || trimmed === "extra high") {
    return "high";
  }
  return "high";
}

/**
 * Pick an effort that exists on the model catalog.
 * Falls back to the catalog default, then the first option; `null` when unsupported.
 */
export function resolveEffortForModel(
  model: SelectableModel | null | undefined,
  preferred: string | null | undefined,
): string | null {
  const options = effortOptionsForModel(model);
  if (!options.length) return null;
  const want = preferred?.trim();
  if (want && options.some((option) => option.value === want)) return want;
  const fromModel = model?.reasoningEffort?.trim();
  if (fromModel && options.some((option) => option.value === fromModel)) {
    return fromModel;
  }
  return options.find((option) => option.default)?.value ?? options[0]?.value ?? null;
}

/** Merge model rows, keeping richer catalog metadata (effort / window) over bare ACP ids. */
export function mergeSelectableModels(
  ...groups: Array<SelectableModel[] | null | undefined>
): SelectableModel[] {
  const byId = new Map<string, SelectableModel>();
  for (const group of groups) {
    for (const model of group ?? []) {
      if (!model?.id) continue;
      const prev = byId.get(model.id);
      byId.set(model.id, prev ? preferRicherModel(prev, model) : model);
    }
  }
  return Array.from(byId.values());
}

function preferRicherModel(a: SelectableModel, b: SelectableModel): SelectableModel {
  const aScore =
    (a.supportsReasoningEffort ? 2 : 0) +
    (a.reasoningEfforts?.length ? 2 : 0) +
    (a.contextWindow != null ? 1 : 0) +
    (a.description ? 1 : 0);
  const bScore =
    (b.supportsReasoningEffort ? 2 : 0) +
    (b.reasoningEfforts?.length ? 2 : 0) +
    (b.contextWindow != null ? 1 : 0) +
    (b.description ? 1 : 0);
  const primary = bScore > aScore ? b : a;
  const secondary = primary === a ? b : a;
  return {
    ...secondary,
    ...primary,
    id: primary.id,
    name: primary.name || secondary.name,
    description: primary.description ?? secondary.description ?? null,
    isDefault: Boolean(primary.isDefault || secondary.isDefault),
    tags: primary.tags?.length ? primary.tags : secondary.tags,
    contextWindow: primary.contextWindow ?? secondary.contextWindow ?? null,
    supportsReasoningEffort: Boolean(
      primary.supportsReasoningEffort || secondary.supportsReasoningEffort,
    ),
    reasoningEffort: primary.reasoningEffort ?? secondary.reasoningEffort ?? null,
    reasoningEfforts: primary.reasoningEfforts?.length
      ? primary.reasoningEfforts
      : secondary.reasoningEfforts,
    autoCompactThresholdPercent:
      primary.autoCompactThresholdPercent ?? secondary.autoCompactThresholdPercent ?? null,
  };
}
