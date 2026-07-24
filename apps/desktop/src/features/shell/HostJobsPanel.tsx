import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { t } from "../../i18n";
import { useDesktopBridge } from "../../platform/DesktopBridge";
import { useAppStore } from "../../store";
import type { HostJob } from "../../types";

function jobPrompt(job: HostJob): string {
  const prompt = job.policy?.prompt;
  return typeof prompt === "string" ? prompt : "";
}

export function HostJobsPanel({ enabled }: { enabled: boolean }) {
  const bridge = useDesktopBridge();
  const queryClient = useQueryClient();
  const workspaces = useAppStore((state) => state.workspaces);
  const settingsCwd = useAppStore((state) => state.settings.cwd);
  const activeWorkspace = useMemo(() => {
    const match = workspaces.find((workspace) => workspace.path === settingsCwd);
    return match ?? workspaces[0] ?? null;
  }, [settingsCwd, workspaces]);

  const [prompt, setPrompt] = useState("");
  const [schedule, setSchedule] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const jobsQuery = useQuery({
    queryKey: ["host-jobs", activeWorkspace?.id ?? null],
    queryFn: () => bridge.listJobs(activeWorkspace?.id ?? null),
    enabled,
  });

  const upsertMutation = useMutation({
    mutationFn: async () => {
      if (!activeWorkspace) {
        throw new Error(t.hostJobsNeedWorkspace);
      }
      const trimmed = prompt.trim();
      if (!trimmed) {
        throw new Error(t.hostJobsPromptRequired);
      }
      return bridge.upsertJob({
        workspaceId: activeWorkspace.id,
        kind: "agent_prompt",
        schedule: schedule.trim() || null,
        state: "active",
        policy: { prompt: trimmed },
      });
    },
    onSuccess: async () => {
      setPrompt("");
      setSchedule("");
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey: ["host-jobs"] });
    },
    onError: (error) => setFormError(String(error)),
  });

  const cancelMutation = useMutation({
    mutationFn: (jobId: string) => bridge.cancelJob(jobId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["host-jobs"] });
    },
  });

  const jobs = (jobsQuery.data ?? []).filter((job) => job.state !== "cancelled");

  return (
    <section className="gb-settings-panel gb-host-jobs">
      <div className="gb-settings-section-head">
        <h3>{t.hostJobs}</h3>
        <button
          type="button"
          className="gb-icon-button"
          aria-label={t.refresh}
          onClick={() => void jobsQuery.refetch()}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      <p className="gb-settings-copy">{t.hostJobsHint}</p>
      {!activeWorkspace && <p className="gb-settings-warning" role="status">{t.hostJobsNeedWorkspace}</p>}
      <label>
        <span>
          {t.hostJobsPrompt}
          <small>{t.hostJobsPromptHint}</small>
        </span>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={3}
          placeholder={t.hostJobsPromptPlaceholder}
          aria-label={t.hostJobsPrompt}
        />
      </label>
      <label>
        <span>
          {t.hostJobsSchedule}
          <small>{t.hostJobsScheduleHint}</small>
        </span>
        <input
          value={schedule}
          onChange={(event) => setSchedule(event.target.value)}
          placeholder={t.hostJobsSchedulePlaceholder}
          aria-label={t.hostJobsSchedule}
        />
      </label>
      {formError && <p className="gb-settings-warning" role="alert">{formError}</p>}
      <button
        type="button"
        className="gb-button primary"
        disabled={!activeWorkspace || upsertMutation.isPending}
        onClick={() => {
          setFormError(null);
          upsertMutation.mutate();
        }}
      >
        <Plus size={14} />
        {upsertMutation.isPending ? t.saving : t.hostJobsCreate}
      </button>

      <div className="gb-capability-groups">
        <section>
          <header>
            <strong>{t.hostJobsActive}</strong>
            <span>{jobs.length}</span>
          </header>
          {jobsQuery.isLoading && <p>{t.readingCapabilities}</p>}
          {!jobsQuery.isLoading && jobs.length === 0 && <p>{t.hostJobsEmpty}</p>}
          {jobs.map((job) => (
            <div key={job.jobId}>
              <span>
                <b>{jobPrompt(job) || job.kind}</b>
                <small>
                  {job.schedule ? `${job.schedule} · ` : ""}
                  {job.state}
                  {job.nextRunAt ? ` · ${job.nextRunAt}` : ""}
                </small>
              </span>
              <button
                type="button"
                className="gb-icon-button"
                aria-label={`${t.hostJobsCancel} ${job.jobId}`}
                disabled={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate(job.jobId)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </section>
      </div>
    </section>
  );
}
