/**
 * Host-backed durable jobs (Automations-style schedules / long-run work).
 * Backend already exists (`jobs.list` / `jobs.upsert` / `jobs.cancel`);
 * Desktop surfaces create/edit in Mission Control.
 */

export type HostJobState =
  | "active"
  | "paused"
  | "cancelled"
  | "completed"
  | "failed"
  | string;

export type HostJob = {
  jobId: string;
  workspaceId: string;
  taskId?: string | null;
  kind: string;
  schedule?: string | null;
  state: HostJobState;
  idempotencyKey?: string | null;
  policy?: Record<string, unknown>;
  nextRunAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JobSchedulePreset = {
  id: string;
  label: string;
  /** Cron-like or human schedule string stored on the job. */
  schedule: string;
};

export const JOB_SCHEDULE_PRESETS: JobSchedulePreset[] = [
  { id: "hourly", label: "Hourly", schedule: "0 * * * *" },
  { id: "daily", label: "Daily 09:00", schedule: "0 9 * * *" },
  { id: "weekdays", label: "Weekdays 09:00", schedule: "0 9 * * 1-5" },
  { id: "weekly", label: "Weekly Mon 09:00", schedule: "0 9 * * 1" },
  { id: "manual", label: "Manual / on-demand", schedule: "" },
];

export function isActiveHostJob(job: HostJob): boolean {
  return job.state === "active" || job.state === "paused";
}

export function nextRunHint(schedule: string | null | undefined): string | null {
  const trimmed = schedule?.trim();
  if (!trimmed) return null;
  const preset = JOB_SCHEDULE_PRESETS.find((item) => item.schedule === trimmed);
  return preset ? preset.label : trimmed;
}
