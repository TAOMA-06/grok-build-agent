import * as Dialog from "@radix-ui/react-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowUpRight, CircleAlert, CircleCheck, CircleDot, Clock3, Plus, Radio, RotateCcw, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { isActiveHostJob, JOB_SCHEDULE_PRESETS, nextRunHint, type HostJob } from "../../contracts/jobs";
import {
  buildSubagentTree,
  flattenSubagentTree,
  listSubagents,
  subagentCancelScopeNote,
  summarizeSubagentFleet,
} from "../../contracts/subagent";
import { t } from "../../i18n";
import { useDesktopBridge } from "../../platform/DesktopBridge";
import type { SessionRuntime } from "../../store";
import type { ExecutionRun } from "../../types";

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

function fleetLabel(tools: SessionRuntime["tools"]): string | null {
  const fleet = summarizeSubagentFleet(tools);
  if (fleet.active <= 0) return null;
  const roles = fleet.byRole
    .filter((row) => row.active > 0)
    .slice(0, 3)
    .map((row) => `${row.role}×${row.active}`)
    .join(" · ");
  return roles
    ? `${fleet.active} ${t.subagent} · ${roles}`
    : `${fleet.active} ${t.subagent}`;
}

/**
 * Host-state overview with a visible subagent tree, soft stop control,
 * and Jobs / recovery strip for long-run Host work.
 */
export function MissionControlDialog({
  open,
  onOpenChange,
  sessions,
  onOpenSession,
  onNewTask,
  onStopSessionWorkers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: SessionRuntime[];
  onOpenSession: (sessionId: string) => void;
  onNewTask: () => void;
  /**
   * Soft-cancel workers. Optional toolCallId marks that subtree cancelled
   * locally and forwards toolCallIds in session/cancel `_meta`.
   */
  onStopSessionWorkers?: (sessionId: string, toolCallId?: string) => void | Promise<void>;
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
  const fleet = visibleSessions.reduce(
    (acc, session) => {
      const summary = summarizeSubagentFleet(session.tools);
      acc.active += summary.active;
      for (const row of summary.byRole) {
        if (row.active <= 0) continue;
        acc.roles.set(row.role, (acc.roles.get(row.role) ?? 0) + row.active);
      }
      return acc;
    },
    { active: 0, roles: new Map<string, number>() },
  );
  const roleBreakdown = [...fleet.roles.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 4)
    .map(([role, count]) => `${role}×${count}`)
    .join(" · ");

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
            <span className={fleet.active ? "working" : ""}><b>{fleet.active}</b>{t.missionControlSubagents}</span>
            {roleBreakdown ? (
              <span className="gb-mission-role-breakdown" title={t.missionControlSubagentRoles}>
                {roleBreakdown}
              </span>
            ) : null}
            <small>{t.missionControlSignals}</small>
          </div>
          {fleet.active > 0 && (
            <p className="gb-mission-cancel-note">{subagentCancelScopeNote()}</p>
          )}

          {open ? (
            <JobsRecoveryStrip
              sessions={visibleSessions}
              onOpenSession={(sessionId) => {
                onOpenSession(sessionId);
                onOpenChange(false);
              }}
            />
          ) : null}

          <div className="gb-mission-control-list" aria-label={t.missionControlTasks}>
            {visibleSessions.map((session) => {
              const state = missionState(session);
              const label = stateLabel(state);
              const agents = fleetLabel(session.tools);
              const tree = flattenSubagentTree(buildSubagentTree(listSubagents(session.tools)));
              const activeWorkers = tree.filter((node) =>
                node.status === "pending" || node.status === "running" || node.status === "unknown",
              );
              return (
                <div className={`gb-mission-control-card state-${state}`} key={session.summary.sessionId}>
                  <button
                    type="button"
                    className={`gb-mission-control-row state-${state}`}
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
                      {agents ? <em className="gb-mission-subagents">{agents}</em> : null}
                      <time dateTime={session.summary.updatedAt}><Clock3 size={11} /> {relativeTime(session.summary.updatedAt)}</time>
                    </span>
                    <ArrowUpRight className="gb-mission-control-open" size={15} aria-hidden />
                  </button>
                  {tree.length > 0 && (
                    <ul className="gb-mission-subagent-tree" aria-label={t.missionControlSubagentTree}>
                      {tree.map((node) => {
                        const active =
                          node.status === "pending"
                          || node.status === "running"
                          || node.status === "unknown";
                        return (
                          <li
                            key={node.toolCallId}
                            style={{ paddingLeft: 8 + node.depth * 14 }}
                            data-status={node.status}
                          >
                            <span>{node.title}</span>
                            <small>{node.status}{node.structured ? ` · ${t.subagentStructured}` : ""}</small>
                            {active && onStopSessionWorkers ? (
                              <button
                                type="button"
                                className="gb-mission-stop-one"
                                title={t.missionControlStopWorker}
                                aria-label={t.missionControlStopWorker}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void onStopSessionWorkers(
                                    session.summary.sessionId,
                                    node.toolCallId,
                                  );
                                }}
                              >
                                <Square size={10} />
                              </button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {activeWorkers.length > 0 && onStopSessionWorkers && (
                    <div className="gb-mission-control-actions">
                      <button
                        type="button"
                        className="gb-review-button danger"
                        onClick={(event) => {
                          event.stopPropagation();
                          void onStopSessionWorkers(session.summary.sessionId);
                        }}
                      >
                        <Square size={12} /> {t.missionControlStopWorkers}
                      </button>
                    </div>
                  )}
                </div>
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

function JobsRecoveryStrip({
  sessions,
  onOpenSession,
}: {
  sessions: SessionRuntime[];
  onOpenSession: (sessionId: string) => void;
}) {
  const bridge = useDesktopBridge();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [jobKind, setJobKind] = useState("agent_prompt");
  const [scheduleId, setScheduleId] = useState("daily");
  const [customSchedule, setCustomSchedule] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [promptNote, setPromptNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formNote, setFormNote] = useState<string | null>(null);

  const durableSessions = useMemo(
    () => sessions.filter((session) => !session.privateChat).slice(0, 24),
    [sessions],
  );
  const workspaceOptions = useMemo(() => {
    const roots = new Set<string>();
    for (const session of durableSessions) {
      if (session.summary.workspaceRoot) roots.add(session.summary.workspaceRoot);
    }
    return [...roots];
  }, [durableSessions]);

  const jobsQuery = useQuery({
    queryKey: ["mission-jobs"],
    queryFn: () => bridge.listJobs(),
    refetchInterval: 5_000,
  });
  const executionsQuery = useQuery({
    queryKey: ["mission-executions", durableSessions.map((s) => s.summary.sessionId).join("|")],
    queryFn: async () => {
      const rows = await Promise.all(
        durableSessions.map(async (session) => {
          const execution = await bridge.getExecution(session.summary.sessionId);
          return execution ? { session, execution } : null;
        }),
      );
      return rows.filter(Boolean) as Array<{ session: SessionRuntime; execution: ExecutionRun }>;
    },
    enabled: durableSessions.length > 0,
    refetchInterval: 5_000,
  });

  const activeJobs = (jobsQuery.data ?? []).filter(isActiveHostJob).slice(0, 8);
  const attention = (executionsQuery.data ?? []).filter((row) =>
    row.execution.state === "recovering" || row.execution.state === "delivery_unknown",
  );
  const recovering = attention.filter((row) => row.execution.state === "recovering");
  const uncertain = attention.filter((row) => row.execution.state === "delivery_unknown");

  useEffect(() => {
    if (!workspaceId && workspaceOptions[0]) setWorkspaceId(workspaceOptions[0]);
  }, [workspaceId, workspaceOptions]);

  function openCreateForm() {
    setEditingId(null);
    setJobKind("agent_prompt");
    setScheduleId("daily");
    setCustomSchedule("");
    setPromptNote("");
    setFormError(null);
    setFormNote(null);
    setFormOpen(true);
  }

  function openEditForm(job: HostJob) {
    setEditingId(job.jobId);
    setJobKind(job.kind || "agent_prompt");
    const preset = JOB_SCHEDULE_PRESETS.find((item) => item.schedule === (job.schedule ?? ""));
    setScheduleId(preset?.id ?? (job.schedule ? "custom" : "manual"));
    setCustomSchedule(preset ? "" : (job.schedule ?? ""));
    setWorkspaceId(job.workspaceId);
    const note = typeof job.policy?.prompt === "string"
      ? job.policy.prompt
      : typeof job.policy?.note === "string"
        ? job.policy.note
        : "";
    setPromptNote(note);
    setFormError(null);
    setFormNote(null);
    setFormOpen(true);
  }

  async function resume(session: SessionRuntime) {
    const connectionId = session.summary.connectionId;
    const remoteSessionId = session.summary.remoteSessionId;
    if (!connectionId || !remoteSessionId) {
      onOpenSession(session.summary.sessionId);
      return;
    }
    setBusyId(session.summary.sessionId);
    try {
      await bridge.resumeExecution(session.summary.sessionId, connectionId, remoteSessionId);
      await queryClient.invalidateQueries({ queryKey: ["mission-executions"] });
    } finally {
      setBusyId(null);
    }
  }

  async function cancelJob(job: HostJob) {
    setBusyId(job.jobId);
    try {
      await bridge.cancelJob(job.jobId);
      await queryClient.invalidateQueries({ queryKey: ["mission-jobs"] });
    } finally {
      setBusyId(null);
    }
  }

  async function saveJob() {
    const root = workspaceId.trim() || workspaceOptions[0];
    if (!root) {
      setFormError("workspaceId is required");
      return;
    }
    const schedule = scheduleId === "custom"
      ? customSchedule.trim()
      : (JOB_SCHEDULE_PRESETS.find((item) => item.id === scheduleId)?.schedule ?? "");
    setBusyId(editingId ?? "create");
    setFormError(null);
    try {
      await bridge.upsertJob({
        jobId: editingId ?? undefined,
        workspaceId: root,
        kind: jobKind.trim() || "agent_prompt",
        schedule: schedule || null,
        state: "active",
        policy: promptNote.trim()
          ? { prompt: promptNote.trim() }
          : {},
      });
      setFormNote(t.missionControlJobSaved);
      setFormOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["mission-jobs"] });
    } catch (error) {
      setFormError(String(error));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="gb-mission-jobs" aria-label={t.missionControlJobs}>
      <div className="gb-mission-jobs-head">
        <strong>{t.missionControlJobs}</strong>
        <button type="button" className="gb-review-button" onClick={() => openCreateForm()}>
          <Plus size={11} /> {t.missionControlCreateJob}
        </button>
      </div>
      {activeJobs.length === 0 && attention.length === 0 && !formOpen && (
        <span className="gb-mission-jobs-empty">{t.missionControlJobsEmpty}</span>
      )}
      {formOpen && (
        <div className="gb-mission-job-form">
          <label>
            {t.missionControlJobWorkspace}
            <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
              {workspaceOptions.length === 0 && <option value="">{t.missionControlEmpty}</option>}
              {workspaceOptions.map((root) => (
                <option key={root} value={root}>{workspaceName(root)}</option>
              ))}
            </select>
          </label>
          <label>
            {t.missionControlJobKind}
            <input value={jobKind} onChange={(event) => setJobKind(event.target.value)} />
          </label>
          <label>
            {t.missionControlJobSchedule}
            <select value={scheduleId} onChange={(event) => setScheduleId(event.target.value)}>
              {JOB_SCHEDULE_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.label}</option>
              ))}
              <option value="custom">Custom cron</option>
            </select>
          </label>
          {scheduleId === "custom" && (
            <label>
              Cron
              <input value={customSchedule} onChange={(event) => setCustomSchedule(event.target.value)} placeholder="0 9 * * 1-5" />
            </label>
          )}
          <label>
            {t.missionControlJobPrompt}
            <textarea value={promptNote} onChange={(event) => setPromptNote(event.target.value)} rows={2} />
          </label>
          {formError && <span className="gb-mission-jobs-empty">{formError}</span>}
          <div className="gb-mission-job-actions">
            <button type="button" className="gb-review-button" disabled={busyId !== null} onClick={() => void saveJob()}>
              {editingId ? t.missionControlEditJob : t.missionControlCreateJob}
            </button>
            <button type="button" className="gb-button" onClick={() => setFormOpen(false)}>{t.cancel}</button>
          </div>
        </div>
      )}
      {formNote && <span className="gb-mission-jobs-empty">{formNote}</span>}
      {recovering.length > 0 && (
        <div className="gb-mission-jobs-group">
          <em>{t.missionControlRecovering} · {recovering.length}</em>
          {recovering.map(({ session }) => (
            <div className="gb-mission-job-row" key={`rec-${session.summary.sessionId}`}>
              <span>{session.summary.title}</span>
              <button
                type="button"
                className="gb-review-button"
                disabled={busyId === session.summary.sessionId}
                onClick={() => void resume(session)}
              >
                <RotateCcw size={11} /> {t.missionControlResume}
              </button>
            </div>
          ))}
        </div>
      )}
      {uncertain.length > 0 && (
        <div className="gb-mission-jobs-group">
          <em>{t.missionControlDeliveryUnknown} · {uncertain.length}</em>
          {uncertain.map(({ session }) => (
            <div className="gb-mission-job-row" key={`unk-${session.summary.sessionId}`}>
              <span>{session.summary.title}</span>
              <button
                type="button"
                className="gb-review-button"
                onClick={() => onOpenSession(session.summary.sessionId)}
              >
                <ArrowUpRight size={11} /> {t.missionControl}
              </button>
            </div>
          ))}
        </div>
      )}
      {activeJobs.length > 0 && (
        <div className="gb-mission-jobs-group">
          <em>{t.missionControlJobActive} · {activeJobs.length}</em>
          {activeJobs.map((job) => (
            <div className="gb-mission-job-row" key={job.jobId}>
              <span>
                {job.kind}
                {nextRunHint(job.schedule) ? ` · ${nextRunHint(job.schedule)}` : ""}
                <small> · {job.state}</small>
              </span>
              <div className="gb-mission-job-actions">
                <button
                  type="button"
                  className="gb-review-button"
                  onClick={() => openEditForm(job)}
                >
                  {t.missionControlEditJob}
                </button>
                <button
                  type="button"
                  className="gb-review-button danger"
                  disabled={busyId === job.jobId}
                  onClick={() => void cancelJob(job)}
                >
                  <Square size={11} /> {t.missionControlCancelJob}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
