/**
 * Host-owned durable agent jobs (recurring / scheduled prompts).
 */

export type HostJobState = "active" | "paused" | "cancelled" | string;

export type HostJob = {
  jobId: string;
  workspaceId: string;
  taskId?: string | null;
  kind: string;
  schedule?: string | null;
  state: HostJobState;
  idempotencyKey?: string | null;
  policy: Record<string, unknown>;
  nextRunAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type HostJobUpsertInput = {
  jobId?: string;
  workspaceId: string;
  taskId?: string | null;
  kind?: string;
  schedule?: string | null;
  state?: HostJobState;
  idempotencyKey?: string | null;
  policy?: Record<string, unknown>;
  nextRunAt?: string | null;
};
