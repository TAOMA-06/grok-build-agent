export type TaskMode = "agent" | "plan" | "goal";

export type ModeSource = "acp_config" | "acp_command" | "desktop";

export type SelectableMode = {
  id: TaskMode;
  name: string;
  description?: string | null;
};

export type SessionModeState = {
  currentMode: TaskMode;
  availableModes: SelectableMode[];
  liveSwitchSupported: boolean;
  source: ModeSource;
};

export type ModeSwitchResult =
  | { kind: "switched"; state: SessionModeState }
  | { kind: "command_required"; command: string; reason: string }
  | { kind: "unsupported"; reason: string };

export function defaultModeState(mode: TaskMode = "agent"): SessionModeState {
  return {
    currentMode: mode,
    availableModes: [
      { id: "agent", name: "Agent" },
      { id: "plan", name: "Plan" },
      { id: "goal", name: "Goal" },
    ],
    liveSwitchSupported: false,
    source: "desktop",
  };
}
