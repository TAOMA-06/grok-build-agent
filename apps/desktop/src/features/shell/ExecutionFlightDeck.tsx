import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Radio, RotateCcw, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { t } from "../../i18n";
import { useDesktopBridge } from "../../platform/DesktopBridge";
import type { SessionRuntime } from "../../store";
import type { ExecutionState } from "../../types";

function stateLabel(state: ExecutionState): string {
  switch (state) {
    case "queued":
      return t.executionStateQueued;
    case "running":
      return t.executionStateRunning;
    case "cancelling":
      return t.executionStateCancelling;
    case "recovering":
      return t.executionStateRecovering;
    case "delivery_unknown":
      return t.executionStateDeliveryUnknown;
    case "failed":
      return t.executionStateFailed;
    case "cancelled":
      return t.executionStateCancelled;
    case "completed":
      return t.executionStateCompleted;
    case "awaiting_permission":
      return t.permissionTitle;
  }
}

/**
 * Small, Host-backed control surface for the durable execution ledger. It
 * purposefully shows only aggregate metadata — never persisted prompt content.
 */
export function ExecutionFlightDeck({ session }: { session: SessionRuntime }) {
  const bridge = useDesktopBridge();
  const queryClient = useQueryClient();
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
  const taskId = session.summary.sessionId;
  const executionQuery = useQuery({
    queryKey: ["execution", taskId],
    queryFn: () => bridge.getExecution(taskId),
    refetchInterval: 2_500,
  });
  const execution = executionQuery.data;
  const eventsQuery = useQuery({
    queryKey: ["execution-events", execution?.executionId],
    queryFn: () => bridge.listExecutionEvents(execution!.executionId),
    enabled: Boolean(execution?.executionId),
    refetchInterval: 2_500,
  });

  if (!execution) return null;

  const executionId = execution.executionId;
  const events = eventsQuery.data ?? [];
  const lastEvent = events[events.length - 1] ?? null;
  const isRecovering = execution.state === "recovering";
  const isUncertain = execution.state === "delivery_unknown";
  const connectionId = session.summary.connectionId;
  const sessionId = session.summary.remoteSessionId;
  const canResume = isRecovering && Boolean(connectionId && sessionId) && !session.privateChat;

  async function resume() {
    if (!connectionId || !sessionId || resuming) return;
    setResuming(true);
    setResumeError(null);
    try {
      await bridge.resumeExecution(taskId, connectionId, sessionId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["execution", taskId] }),
        queryClient.invalidateQueries({ queryKey: ["execution-events", executionId] }),
      ]);
    } catch (error) {
      setResumeError(String(error));
    } finally {
      setResuming(false);
    }
  }

  return (
    <section className={`gb-flight-deck state-${execution.state}`} aria-label={t.executionFlightRecorder}>
      <div className="gb-flight-deck-rail" aria-hidden>
        <Radio size={13} />
      </div>
      <div className="gb-flight-deck-main">
        <div className="gb-flight-deck-heading">
          <span><Activity size={13} /> {t.executionFlightRecorder}</span>
          <small>{t.executionHostAuthority}</small>
        </div>
        <div className="gb-flight-deck-metrics">
          <span className="gb-flight-state"><i />{stateLabel(execution.state)}</span>
          <span><b>{t.executionVersion}</b> {execution.version}</span>
          <span><b>{t.executionCancelEpoch}</b> {execution.cancelEpoch}</span>
          <span><b>{events.length}</b> {t.executionEvents}</span>
          <span className="gb-flight-last"><b>{t.executionLastSignal}</b> {lastEvent?.kind ?? "—"}</span>
        </div>
        {isRecovering && (
          <div className="gb-flight-deck-alert recovery">
            <div>
              <strong>{t.executionRecoveryReady}</strong>
              <p>{canResume ? t.executionRecoveryHint : t.executionRecoveryUnavailable}</p>
            </div>
            <button type="button" onClick={() => void resume()} disabled={!canResume || resuming}>
              <RotateCcw size={13} /> {t.executionResumeSafely}
            </button>
          </div>
        )}
        {isUncertain && (
          <div className="gb-flight-deck-alert uncertain">
            <ShieldAlert size={15} />
            <div><strong>{t.executionDeliveryUnknown}</strong><p>{t.executionDeliveryUnknownHint}</p></div>
          </div>
        )}
        {resumeError && <p className="gb-flight-deck-error" role="alert">{resumeError}</p>}
      </div>
    </section>
  );
}
