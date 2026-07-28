import { Activity, ArrowUpRight, CircleAlert, CircleCheck, CircleDot, Clock3, Plus } from "lucide-react";
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

export function ControlPage({
  sessions,
  onOpenSession,
  onNewTask,
}: {
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
    <div className="wb-page">
      <header className="wb-page-header">
        <div>
          <h1>{t.missionControl}</h1>
          <p>{t.missionControlDescription}</p>
        </div>
        <button type="button" className="gb-button primary" onClick={onNewTask}>
          <Plus size={14} /> {t.newTask}
        </button>
      </header>
      <div className="wb-page-body">
        <div className="wb-control-stats" aria-live="polite" aria-label={t.missionControlSignals}>
          <div className="wb-stat">
            <strong>{visibleSessions.length}</strong>
            <span>{t.missionControlTasks}</span>
          </div>
          <div className="wb-stat">
            <strong>{attentionCount}</strong>
            <span>{t.missionControlAttention}</span>
          </div>
          <div className="wb-stat">
            <strong>{workingCount}</strong>
            <span>{t.missionControlActive}</span>
          </div>
        </div>

        <section className="wb-mission-list" aria-labelledby="mission-control-signals">
          <div className="wb-mission-list-head">
            <h2 id="mission-control-signals">{t.missionControlSignals}</h2>
          </div>
          <div className="wb-mission-list-body">
            {visibleSessions.map((session) => {
              const state = missionState(session);
              const label = stateLabel(state);
              return (
                <button
                  type="button"
                  className="wb-mission-row"
                  data-state={state}
                  key={session.summary.sessionId}
                  aria-label={`${label}: ${session.summary.title}`}
                  onClick={() => onOpenSession(session.summary.sessionId)}
                >
                  <span className="icon" aria-hidden>{stateIcon(state)}</span>
                  <span className="wb-mission-copy">
                    <strong>{session.summary.title}</strong>
                    <small>
                      {workspaceName(session.summary.workspaceRoot)} · {session.summary.lastMessagePreview || label}
                    </small>
                  </span>
                  <span className="wb-mission-meta">
                    <em>{label}</em>
                    <time dateTime={session.summary.updatedAt}>
                      <Clock3 size={11} /> {relativeTime(session.summary.updatedAt)}
                    </time>
                    <ArrowUpRight size={14} aria-hidden />
                  </span>
                </button>
              );
            })}
            {visibleSessions.length === 0 && (
              <div className="wb-empty" role="status">
                <CircleDot size={18} />
                <strong>{t.missionControlEmpty}</strong>
                <p>{t.missionControlEmptyHint}</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
