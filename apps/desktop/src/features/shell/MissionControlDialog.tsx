import * as Dialog from "@radix-ui/react-dialog";
import { Activity, ArrowUpRight, CircleAlert, CircleCheck, CircleDot, Clock3, Plus, Radio } from "lucide-react";
import type { SessionRuntime } from "../../store";
import { t } from "../../i18n";

type MissionState = "attention" | "working" | "idle" | "completed" | "failed";

const missionOrder: Record<MissionState, number> = {
  attention: 0,
  working: 1,
  idle: 2,
  completed: 3,
  failed: 4,
};

function missionState(session: SessionRuntime): MissionState {
  if (
    session.summary.attentionRequired
    || session.summary.runState === "awaiting_permission"
    || session.summary.runState === "awaiting_plan"
  ) {
    return "attention";
  }
  if (session.busy || session.summary.runState === "streaming") return "working";
  if (session.summary.runState === "error") return "failed";
  if (session.summary.runState === "ended" || session.summary.runState === "cancelled") return "completed";
  return "idle";
}

function stateLabel(state: MissionState): string {
  switch (state) {
    case "attention": return t.missionControlNeedsAttention;
    case "working": return t.missionControlWorking;
    case "idle": return t.missionControlIdle;
    case "completed": return t.missionControlCompleted;
    case "failed": return t.missionControlFailed;
  }
}

function stateIcon(state: MissionState) {
  switch (state) {
    case "attention": return <CircleAlert size={15} />;
    case "working": return <Activity size={15} />;
    case "completed": return <CircleCheck size={15} />;
    case "failed": return <CircleAlert size={15} />;
    case "idle": return <CircleDot size={15} />;
  }
}

function relativeTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "—";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1_000));
  if (seconds < 60) return t.missionControlJustNow;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function workspaceName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

/**
 * A Host-state-driven overview. It does not invent runtime controls: selecting
 * a task takes the operator to the task's own ledger and approval surface.
 */
export function MissionControlDialog({
  open,
  onOpenChange,
  sessions,
  onOpenSession,
  onNewTask,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: SessionRuntime[];
  onOpenSession: (sessionId: string) => void;
  onNewTask: () => void;
}) {
  const visibleSessions = sessions
    .filter((session) => !session.summary.archived)
    .sort((left, right) => {
      const stateDelta = missionOrder[missionState(left)] - missionOrder[missionState(right)];
      if (stateDelta !== 0) return stateDelta;
      return Date.parse(right.summary.updatedAt) - Date.parse(left.summary.updatedAt);
    });
  const attentionCount = visibleSessions.filter((session) => missionState(session) === "attention").length;
  const workingCount = visibleSessions.filter((session) => missionState(session) === "working").length;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="gb-dialog-overlay" />
        <Dialog.Content className="gb-mission-control" aria-describedby="mission-control-description">
          <header className="gb-mission-control-header">
            <div className="gb-mission-control-signal" aria-hidden><Radio size={15} /></div>
            <div>
              <Dialog.Title>{t.missionControl}</Dialog.Title>
              <Dialog.Description id="mission-control-description">{t.missionControlDescription}</Dialog.Description>
            </div>
            <button type="button" className="gb-mission-control-new" onClick={() => {
              onNewTask();
              onOpenChange(false);
            }}>
              <Plus size={14} /> {t.newTask}
            </button>
          </header>

          <div className="gb-mission-control-stats" aria-live="polite">
            <span><b>{visibleSessions.length}</b>{t.missionControlTasks}</span>
            <span className={attentionCount ? "attention" : ""}><b>{attentionCount}</b>{t.missionControlAttention}</span>
            <span className={workingCount ? "working" : ""}><b>{workingCount}</b>{t.missionControlActive}</span>
            <small>{t.missionControlSignals}</small>
          </div>

          <div className="gb-mission-control-list" aria-label={t.missionControlTasks}>
            {visibleSessions.map((session) => {
              const state = missionState(session);
              const label = stateLabel(state);
              return (
                <button
                  type="button"
                  className={`gb-mission-control-row state-${state}`}
                  key={session.summary.sessionId}
                  aria-label={`${label}: ${session.summary.title}`}
                  onClick={() => {
                    onOpenSession(session.summary.sessionId);
                    onOpenChange(false);
                  }}
                >
                  <span className="gb-mission-control-state" aria-hidden>{stateIcon(state)}</span>
                  <span className="gb-mission-control-copy">
                    <strong>{session.summary.title}</strong>
                    <small>{workspaceName(session.summary.workspaceRoot)} <i>·</i> {session.summary.lastMessagePreview || label}</small>
                  </span>
                  <span className="gb-mission-control-meta">
                    <em>{label}</em>
                    <time dateTime={session.summary.updatedAt}><Clock3 size={11} /> {relativeTime(session.summary.updatedAt)}</time>
                  </span>
                  <ArrowUpRight className="gb-mission-control-open" size={15} aria-hidden />
                </button>
              );
            })}
            {visibleSessions.length === 0 && (
              <div className="gb-mission-control-empty">
                <CircleDot size={18} />
                <strong>{t.missionControlEmpty}</strong>
                <span>{t.missionControlEmptyHint}</span>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
