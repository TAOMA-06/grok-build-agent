/**
 * Session-level model selection contracts.
 * Settings.model is the default for new sessions; Composer/session owns the live choice.
 */

export type ModelSource = "acp" | "cli" | "configured";

export type SelectableModel = {
  id: string;
  name: string;
  description?: string | null;
  isDefault?: boolean;
  /** Free-form tags from CLI/ACP (e.g. "fast", "reasoning"). */
  tags?: string[];
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
