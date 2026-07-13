import { useCallback, useRef, useState } from "react";
import { buildPromptContent } from "../../contracts";
import { mergeSelectableModels, resolveEffortForModel } from "../../contracts/model";
import { useDesktopBridge } from "../../platform/DesktopBridge";
import { useAppStore } from "../../store";
import { t, translate } from "../../i18n";
import type {
  AgentStatus,
  ComposerAttachment,
  PermissionPolicy,
  ModeSwitchResult,
  SelectableModel,
  SessionSummary,
  TaskMode,
} from "../../types";
import { STOP_ARM_MS } from "./composerTiming";

export type DirtyPolicy = "clean_head" | "copy_dirty";

export type DesktopController = {
  connectingSessionId: string | null;
  chooseWorkspace(): Promise<string | null>;
  createThread(mode?: TaskMode): Promise<string | null>;
  send(text: string, attachments: ComposerAttachment[], mode: TaskMode): Promise<void>;
  retryFailed(): Promise<void>;
  cancel(): Promise<void>;
  reloadActiveAgent(): Promise<void>;
  chooseModel(modelId: string): Promise<void>;
  chooseEffort(effort: string): Promise<void>;
  chooseMode(mode: TaskMode): Promise<ModeSwitchResult>;
  pendingModelFork: { modelId: string; reason: string } | null;
  confirmModelFork(): Promise<void>;
  cancelModelFork(): void;
  answerPermission(optionId: string | null): Promise<void>;
  answerPlanApproval(action: "approve" | "revise"): Promise<void>;
};

function promptTitle(text: string): string {
  const title = text.replace(/\s+/g, " ").trim();
  if (!title) return t.newTask;
  return title.length > 56 ? `${title.slice(0, 55)}…` : title;
}

function branchSlug(text: string, sessionId: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30) || "task";
  return `grok/${base}-${sessionId.slice(0, 6)}`;
}

function permissionAlwaysApprove(policy: PermissionPolicy): boolean {
  return policy === "full_auto";
}

function lookupModel(
  state: ReturnType<typeof useAppStore.getState>,
  sessionId: string | null | undefined,
  modelId: string | null | undefined,
): SelectableModel | null {
  if (!modelId) return null;
  const sessionModels = sessionId
    ? state.sessions[sessionId]?.modelState?.availableModels
    : undefined;
  const models = mergeSelectableModels(
    sessionModels,
    state.globalModelState.availableModels,
  );
  return models.find((model) => model.id === modelId) ?? null;
}

function resolveRuntimeEffort(
  state: ReturnType<typeof useAppStore.getState>,
  summary: Pick<SessionSummary, "sessionId" | "model" | "reasoningEffort">,
): string | null {
  const modelId =
    summary.model || state.effectiveModelId() || state.settings.model || null;
  return resolveEffortForModel(
    lookupModel(state, summary.sessionId, modelId),
    summary.reasoningEffort ||
      state.effectiveReasoningEffort() ||
      state.settings.defaultReasoningEffort,
  );
}

export function useDesktopController(
  chooseDirtyPolicy: () => Promise<DirtyPolicy>,
): DesktopController {
  const bridge = useDesktopBridge();
  const [connectingSessionId, setConnectingSessionId] = useState<string | null>(null);
  const [pendingModelFork, setPendingModelFork] = useState<{
    modelId: string;
    reason: string;
  } | null>(null);
  /** Bumped on cancel so an in-flight send cannot re-busy or overwrite cancelled state. */
  const cancelEpochRef = useRef(0);
  /** True only while sendPrompt is in flight — cancelPrompt is meaningful then. */
  const promptInFlightRef = useRef(false);
  /** performance.now() when the active send marked busy — gates premature cancel. */
  const sendBusyAtRef = useRef<number | null>(null);

  const chooseWorkspace = useCallback(async () => {
    const path = await bridge.chooseDirectory();
    if (!path) return null;
    const state = useAppStore.getState();
    const settings = { ...state.settings, cwd: path };
    state.setSettings({ cwd: path });
    const workspace = await bridge.upsertWorkspace(path);
    state.setWorkspaces([
      workspace,
      ...state.workspaces.filter((item) => item.id !== workspace.id),
    ]);
    await bridge.saveSettings(settings);
    return path;
  }, [bridge]);

  const createThread = useCallback(
    async (mode?: TaskMode) => {
      const state = useAppStore.getState();
      const workspaceRoot = state.settings.cwd || (await chooseWorkspace());
      if (!workspaceRoot) return null;
      const now = new Date().toISOString();
      const sessionId = crypto.randomUUID();
      const summary: SessionSummary = {
        sessionId,
        workspaceRoot,
        executionRoot: workspaceRoot,
        title: t.newTask,
        createdAt: now,
        updatedAt: now,
        runState: "idle",
        mode: mode ?? state.settings.defaultMode,
        permissionPolicy: state.settings.permissionPolicy,
        sandbox: state.settings.sandbox,
        archived: false,
        attentionRequired: false,
        alwaysApprove: permissionAlwaysApprove(state.settings.permissionPolicy),
        model: state.effectiveModelId() || state.settings.model,
        reasoningEffort: resolveEffortForModel(
          lookupModel(state, null, state.effectiveModelId() || state.settings.model),
          state.effectiveReasoningEffort() || state.settings.defaultReasoningEffort,
        ),
        draft: state.provisionalDraft.text,
        remoteSessionId: null,
      };
      state.ensureSession(summary);
      state.setActiveSession(sessionId);
      await bridge.upsertSession(summary);
      return sessionId;
    },
    [bridge, chooseWorkspace],
  );

  const prepareExecution = useCallback(
    async (sessionId: string, prompt: string): Promise<SessionSummary> => {
      const state = useAppStore.getState();
      const current = state.sessions[sessionId]?.summary;
      if (!current) throw new Error(t.taskUnavailable);
      if (current.worktreePath || current.remoteSessionId) return current;

      let executionRoot = current.workspaceRoot;
      let worktreePath: string | null = null;
      let baseCommit: string | null = null;
      try {
        const review = await bridge.gitReview(current.workspaceRoot);
        if (review.state === "clean" || review.state === "dirty") {
          const dirtyPolicy =
            review.state === "dirty" ? await chooseDirtyPolicy() : "clean_head";
          const worktree = await bridge.createWorktree({
            workspaceRoot: current.workspaceRoot,
            branch: branchSlug(prompt, sessionId),
            dirtyPolicy,
          });
          executionRoot = worktree.path;
          worktreePath = worktree.path;
          baseCommit = review.head ?? null;
        }
      } catch (error) {
        state.addBlock(sessionId, {
          id: crypto.randomUUID(),
          type: "system",
          level: "warn",
          text: `Worktree isolation failed. The task was not started because Git write tasks must be isolated. ${String(error)}`,
        });
        throw error;
      }

      const next: SessionSummary = {
        ...current,
        executionRoot,
        worktreePath,
        baseCommit,
        updatedAt: new Date().toISOString(),
      };
      state.updateSummary(sessionId, next);
      await bridge.upsertSession(next);
      return next;
    },
    [bridge, chooseDirtyPolicy],
  );

  const connect = useCallback(
    async (sessionId: string, prompt: string): Promise<AgentStatus> => {
      const state = useAppStore.getState();
      let summary = await prepareExecution(sessionId, prompt);
      setConnectingSessionId(sessionId);
      try {
        const policy = summary.permissionPolicy ?? state.settings.permissionPolicy;
        const status = await bridge.startAgent({
          taskId: sessionId,
          cwd: summary.executionRoot || summary.worktreePath || summary.workspaceRoot,
          model: summary.model || state.effectiveModelId() || null,
          reasoningEffort: resolveRuntimeEffort(state, summary),
          alwaysApprove: permissionAlwaysApprove(policy),
          useHarness: state.settings.useHarness,
          sandbox: summary.sandbox ?? state.settings.sandbox,
          resumeSessionId: summary.remoteSessionId ?? null,
          grokPath:
            state.settings.cliPathOverride || state.settings.grokPath || null,
        });
        state.setStatus(status);
        if (status.model) {
          state.setGlobalModelState(status.model);
          state.setSessionModelState(sessionId, status.model);
        }
        if (status.mode) state.setSessionModeState(sessionId, status.mode);
        if (status.availableCommands) {
          state.setSessionCommands(sessionId, status.availableCommands);
        }
        summary = {
          ...summary,
          connectionId: status.connectionId ?? null,
          remoteSessionId: status.sessionId ?? summary.remoteSessionId ?? null,
          runState: "idle",
          updatedAt: new Date().toISOString(),
        };
        state.updateSummary(sessionId, summary);
        await bridge.upsertSession(summary);
        return status;
      } finally {
        setConnectingSessionId(null);
      }
    },
    [bridge, prepareExecution],
  );

  const sendInternal = useCallback(
    async (
      rawText: string,
      attachments: ComposerAttachment[],
      mode: TaskMode,
      reuseBlockId?: string,
    ) => {
      const text = rawText.trim();
      if (!text && attachments.length === 0) return;
      const state = useAppStore.getState();
      let sessionId = state.activeSessionId;
      if (!sessionId) sessionId = await createThread(mode);
      if (!sessionId) return;

      const epochAtStart = cancelEpochRef.current;
      const session = useAppStore.getState().sessions[sessionId];
      if (!session) return;
      const firstTurn = session.blocks.length === 0;
      const displayText = text || `[${attachments.length} attachments]`;
      const previousMode = session.summary.mode ?? "agent";
      const enteringMode = firstTurn || previousMode !== mode;
      const promptText = enteringMode && mode === "goal" && !text.startsWith("/goal")
        ? `/goal ${text}`.trim()
        : enteringMode && mode === "plan" && !text.startsWith("/plan")
          ? `/plan ${text}`.trim()
          : text;
      const summary: SessionSummary = {
        ...session.summary,
        title: firstTurn ? promptTitle(displayText) : session.summary.title,
        mode,
        lastMessagePreview: displayText,
        runState: "streaming",
        attentionRequired: false,
        updatedAt: new Date().toISOString(),
      };
      state.updateSummary(sessionId, summary);
      const messageBlockId = reuseBlockId ?? crypto.randomUUID();
      if (reuseBlockId) {
        state.updateBlock(sessionId, messageBlockId, {
          type: "user",
          text: displayText,
          delivery: "pending",
        });
      } else {
        state.addBlock(sessionId, {
          id: messageBlockId,
          type: "user",
          text: displayText,
          delivery: "pending",
          at: new Date().toISOString(),
        });
      }
      state.setSessionBusy(sessionId, true);
      sendBusyAtRef.current = performance.now();
      state.setFailedSubmission(sessionId, null);
      state.setSessionDraft(sessionId, "");
      state.setSessionAttachments(sessionId, []);
      state.clearProvisionalDraft();
      const wasCancelled = () => cancelEpochRef.current !== epochAtStart;

      try {
        await bridge.upsertSession(summary);
        // The first user instruction is the default task focus. It can still be
        // refined in the Context drawer, but seeding it here prevents later
        // turns from drifting without repeatedly sending the full transcript.
        if (firstTurn && text) {
          const existingTask = await bridge.getTask(sessionId);
          await bridge.upsertTask({
            taskId: sessionId,
            workspaceId: summary.workspaceRoot,
            state: existingTask?.state ?? "running",
            goal: existingTask?.goal?.trim() || text,
            constraints: existingTask?.constraints ?? [],
            acceptance: existingTask?.acceptance ?? [],
            allowedPaths: existingTask?.allowedPaths ?? [],
            verificationCommands: existingTask?.verificationCommands ?? [],
            createdAt: existingTask?.createdAt ?? summary.createdAt,
            updatedAt: summary.updatedAt,
          });
        }
        await bridge.saveDraft(sessionId, "");
        let target = useAppStore.getState().sessions[sessionId]?.summary;
        const runtimeStatus = useAppStore.getState().status;
        const connectionIsLive = Boolean(
          runtimeStatus.running
          && runtimeStatus.connectionId
          && runtimeStatus.connectionId === target?.connectionId,
        );
        if (!target?.connectionId || !target.remoteSessionId || !connectionIsLive) {
          if (wasCancelled()) return;
          await connect(sessionId, displayText);
          if (wasCancelled()) {
            // connect() may have written runState:idle after cancel cleared busy.
            useAppStore.getState().updateSummary(sessionId, { runState: "cancelled" });
            useAppStore.getState().setSessionBusy(sessionId, false);
            return;
          }
          target = useAppStore.getState().sessions[sessionId]?.summary;
        }
        if (!target?.connectionId || !target.remoteSessionId) {
          throw new Error(t.grokStartThreadFailed);
        }
        const inlineContent = buildPromptContent(
          promptText,
          attachments.filter((attachment) => attachment.source === "inline"),
        );
        const localContent = await bridge.prepareAttachments(
          attachments.filter((attachment) => attachment.source === "path"),
        );
        if (wasCancelled()) return;
        // Handed off to the agent — stop showing "sending" while high-effort
        // reasoning may still stream for a long time.
        state.updateBlock(sessionId, messageBlockId, {
          type: "user",
          delivery: "sent",
        });
        // Persist the user turn before crossing into the Runtime. This keeps a
        // crash-safe transcript in causal order and matches the dispatch rule:
        // durable intent first, execution second.
        await bridge.appendCachedEvent({
          sessionId,
          sequence: Date.now(),
          timestamp: new Date().toISOString(),
          kind: "user",
          payload: { text: displayText },
        });
        if (wasCancelled()) return;
        promptInFlightRef.current = true;
        try {
          await bridge.sendPrompt(
            target.connectionId,
            target.remoteSessionId,
            promptText,
            [...inlineContent, ...localContent],
            {
              taskId: sessionId,
              turnId: messageBlockId,
              idempotencyKey: `prompt:${sessionId}:${messageBlockId}`,
              focusMode: state.settings.focusMode,
              privacyMode: state.settings.privacyMode,
            },
          );
        } finally {
          promptInFlightRef.current = false;
        }
        if (wasCancelled()) return;
        if (enteringMode && target.connectionId && target.remoteSessionId) {
          const modeState = await bridge.confirmSessionMode(
            target.connectionId,
            target.remoteSessionId,
            mode,
          );
          if (wasCancelled()) return;
          state.setSessionModeState(sessionId, modeState);
          state.updateSummary(sessionId, {
            mode,
            updatedAt: new Date().toISOString(),
          });
        }
        const complete = useAppStore.getState().sessions[sessionId]?.summary;
        if (complete && !wasCancelled()) {
          const next = { ...complete, runState: "idle" as const };
          useAppStore.getState().updateSummary(sessionId, next);
          await bridge.upsertSession(next);
        }
      } catch (error) {
        if (wasCancelled()) return;
        const current = useAppStore.getState().sessions[sessionId];
        if (current && current.draft === "" && current.attachments.length === 0) {
          state.setSessionDraft(sessionId, rawText);
          state.setSessionAttachments(sessionId, attachments);
          await bridge.saveDraft(sessionId, rawText).catch(() => undefined);
        }
        state.updateBlock(sessionId, messageBlockId, {
          type: "user",
          delivery: "failed",
        });
        state.setFailedSubmission(sessionId, {
          messageBlockId,
          text: rawText,
          attachments,
          mode,
          modelId: state.sessions[sessionId]?.summary.model ?? null,
          error: String(error),
        });
        state.addBlock(sessionId, {
          id: crypto.randomUUID(),
          type: "system",
          level: "error",
          text: String(error),
        });
        state.updateSummary(sessionId, { runState: "error" });
      } finally {
        if (!wasCancelled()) {
          state.setSessionBusy(sessionId, false);
        }
        if (sendBusyAtRef.current != null && cancelEpochRef.current === epochAtStart) {
          sendBusyAtRef.current = null;
        }
      }
    },
    [bridge, connect, createThread],
  );

  const send = useCallback(
    (text: string, attachments: ComposerAttachment[], mode: TaskMode) =>
      sendInternal(text, attachments, mode),
    [sendInternal],
  );

  const retryFailed = useCallback(async () => {
    const state = useAppStore.getState();
    const sessionId = state.activeSessionId;
    const failed = sessionId ? state.sessions[sessionId]?.failedSubmission : null;
    if (!failed) return;
    await sendInternal(
      failed.text,
      failed.attachments,
      failed.mode,
      failed.messageBlockId,
    );
  }, [sendInternal]);

  const cancel = useCallback(async () => {
    const state = useAppStore.getState();
    const sessionId = state.activeSessionId;
    if (!sessionId) return;
    const summary = state.sessions[sessionId]?.summary;
    const connectionIsLive = Boolean(
      state.status.running
      && state.status.connectionId
      && summary?.connectionId
      && state.status.connectionId === summary.connectionId,
    );
    const promptInFlight = promptInFlightRef.current;
    const busyFor = sendBusyAtRef.current == null
      ? Number.POSITIVE_INFINITY
      : performance.now() - sendBusyAtRef.current;
    // Match Stop arming: ignore cancel that arrives before Stop is clickable,
    // unless a live prompt/connection already makes cancel meaningful.
    if (!promptInFlight && !connectionIsLive && busyFor < STOP_ARM_MS) {
      return;
    }

    cancelEpochRef.current += 1;
    sendBusyAtRef.current = null;
    const shouldCancelPrompt = promptInFlight || connectionIsLive;

    // Clear busy/connecting immediately so Stop never leaves the UI stuck,
    // even when cancel IPC fails (e.g. stale host returning `{}` as unit).
    state.setSessionBusy(sessionId, false);
    setConnectingSessionId((current) => (current === sessionId ? null : current));
    state.updateSummary(sessionId, { runState: "cancelled" });
    const pendingUsers = state.sessions[sessionId]?.blocks.filter(
      (block) => block.type === "user" && block.delivery === "pending",
    ) ?? [];
    for (const pendingUser of pendingUsers) {
      state.updateBlock(sessionId, pendingUser.id, {
        type: "user",
        delivery: "sent",
      });
    }

    // Skip cancelPrompt when nothing is live/in-flight — a Send→Stop race with
    // stale connection ids otherwise surfaces "agent is not running".
    if (!shouldCancelPrompt || !summary?.connectionId || !summary.remoteSessionId) {
      promptInFlightRef.current = false;
      return;
    }
    try {
      await bridge.cancelPrompt(summary.connectionId, summary.remoteSessionId);
    } catch (error) {
      const reason = String(error);
      if (/not running|NotRunning/i.test(reason)) return;
      state.addBlock(sessionId, {
        id: crypto.randomUUID(),
        type: "system",
        level: "warn",
        text: translate("cancelFailed", { reason }),
      });
    } finally {
      promptInFlightRef.current = false;
    }
  }, [bridge]);

  const reloadActiveAgent = useCallback(async () => {
    const state = useAppStore.getState();
    const sessionId = state.activeSessionId;
    const summary = sessionId ? state.sessions[sessionId]?.summary : null;
    if (!sessionId || !summary || state.sessions[sessionId]?.busy) return;
    setConnectingSessionId(sessionId);
    try {
      const status = await bridge.restartAgent({
        taskId: sessionId,
        cwd: summary.executionRoot || summary.worktreePath || summary.workspaceRoot,
        model: summary.model || state.settings.model,
        reasoningEffort: resolveRuntimeEffort(state, summary),
        alwaysApprove: permissionAlwaysApprove(
          summary.permissionPolicy ?? state.settings.permissionPolicy,
        ),
        useHarness: state.settings.useHarness,
        sandbox: summary.sandbox ?? state.settings.sandbox,
        resumeSessionId: summary.remoteSessionId ?? null,
        grokPath: state.settings.cliPathOverride || state.settings.grokPath || null,
      });
      state.setStatus(status);
      const next = {
        ...summary,
        connectionId: status.connectionId ?? null,
        remoteSessionId: status.sessionId ?? summary.remoteSessionId ?? null,
        runState: "idle" as const,
      };
      state.updateSummary(sessionId, next);
      state.setAgentReloadRequired(false);
      await bridge.upsertSession(next);
    } finally {
      setConnectingSessionId(null);
    }
  }, [bridge]);

  const chooseModel = useCallback(
    async (modelId: string) => {
      const state = useAppStore.getState();
      const sessionId = state.activeSessionId;
      if (!sessionId) {
        state.setEffectiveModelId(modelId);
        return;
      }
      if (state.sessions[sessionId]?.busy) return;
      // Persist the choice first so reconnect/restart uses the new connection key.
      state.setEffectiveModelId(modelId);
      const summary = useAppStore.getState().sessions[sessionId]?.summary;
      if (!summary?.connectionId || !summary.remoteSessionId) {
        const next = useAppStore.getState().sessions[sessionId]?.summary;
        if (next) await bridge.upsertSession(next);
        return;
      }

      let result;
      try {
        result = await bridge.setSessionModel(
          summary.connectionId,
          summary.remoteSessionId,
          modelId,
        );
      } catch {
        // Stale host / dead ACP pipe after an in-place app replace often surfaces
        // as "unexpected end of file". Reconnect with the new model instead.
        try {
          await reloadActiveAgent();
          const next = useAppStore.getState().sessions[sessionId]?.summary;
          // Persistence failures must not surface as model-switch failures.
          if (next) await bridge.upsertSession(next).catch(() => undefined);
        } catch (error) {
          state.addBlock(sessionId, {
            id: crypto.randomUUID(),
            type: "system",
            level: "error",
            text: translate("modelSwitchFailed", { reason: String(error) }),
          });
        }
        return;
      }

      if (result.kind === "new_session_required") {
        try {
          await reloadActiveAgent();
          const next = useAppStore.getState().sessions[sessionId]?.summary;
          if (next) await bridge.upsertSession(next).catch(() => undefined);
        } catch (error) {
          setPendingModelFork({ modelId, reason: result.reason });
          state.addBlock(sessionId, {
            id: crypto.randomUUID(),
            type: "system",
            level: "error",
            text: translate("modelSwitchFailed", { reason: String(error) }),
          });
        }
        return;
      }

      const prev = useAppStore.getState().sessions[sessionId]?.modelState;
      const merged = {
        ...result.state,
        availableModels: mergeSelectableModels(
          result.state.availableModels,
          prev?.availableModels,
          useAppStore.getState().globalModelState.availableModels,
        ),
      };
      state.setSessionModelState(sessionId, merged);
      state.setGlobalModelState({
        ...useAppStore.getState().globalModelState,
        currentModelId: modelId,
        availableModels: mergeSelectableModels(
          useAppStore.getState().globalModelState.availableModels,
          merged.availableModels,
        ),
      });
      const next = useAppStore.getState().sessions[sessionId]?.summary;
      if (next) await bridge.upsertSession(next).catch(() => undefined);
    },
    [bridge, reloadActiveAgent],
  );

  const chooseEffort = useCallback(
    async (effort: string) => {
      const state = useAppStore.getState();
      const sessionId = state.activeSessionId;
      if (!sessionId) {
        state.setEffectiveReasoningEffort(effort);
        return;
      }
      if (state.sessions[sessionId]?.busy) return;
      let summary = state.sessions[sessionId]?.summary;
      state.setEffectiveReasoningEffort(effort);

      if (summary?.connectionId && summary.remoteSessionId) {
        try {
          const result = await bridge.setSessionEffort(
            summary.connectionId,
            summary.remoteSessionId,
            effort,
          );
          if (result.kind === "restart_required") {
            state.addBlock(sessionId, {
              id: crypto.randomUUID(),
              type: "system",
              level: "info",
              text: result.reason,
            });
            await reloadActiveAgent();
          }
        } catch (error) {
          state.addBlock(sessionId, {
            id: crypto.randomUUID(),
            type: "system",
            level: "warn",
            text: translate("effortSwitchFailed", { reason: String(error) }),
          });
          await reloadActiveAgent();
        }
      }
      const next = useAppStore.getState().sessions[sessionId]?.summary;
      if (next) await bridge.upsertSession(next);
    },
    [bridge, reloadActiveAgent],
  );

  const chooseMode = useCallback(
    async (mode: TaskMode): Promise<ModeSwitchResult> => {
      const state = useAppStore.getState();
      const sessionId = state.activeSessionId;
      if (!sessionId) {
        state.setEffectiveMode(mode);
        return {
          kind: "switched",
          state: {
            currentMode: mode,
            availableModes: [
              { id: "agent", name: "Agent" },
              { id: "plan", name: "Plan" },
              { id: "goal", name: "Goal" },
            ],
            liveSwitchSupported: false,
            source: "desktop",
          },
        };
      }
      const session = state.sessions[sessionId];
      if (!session || session.busy) {
        return { kind: "unsupported", reason: t.taskBusy };
      }
      let summary = session.summary;
      const connectionIsLive = Boolean(
        state.status.running
        && state.status.connectionId
        && state.status.connectionId === summary.connectionId,
      );
      if (!summary.connectionId || !summary.remoteSessionId || !connectionIsLive) {
        state.setEffectiveMode(mode);
        const next = useAppStore.getState().sessions[sessionId]?.summary;
        // Mode selection is usable immediately. A transient Host persistence
        // failure must not be reported as a mode-switch failure; the summary is
        // persisted again when the task is sent.
        if (next) await bridge.upsertSession(next).catch(() => undefined);
        return {
          kind: "switched",
          state: { ...session.modeState, currentMode: mode, source: "desktop" },
        };
      }
      let connectionId = summary.connectionId;
      let remoteSessionId = summary.remoteSessionId;

      let result: ModeSwitchResult;
      try {
        result = await bridge.setSessionMode(
          connectionId,
          remoteSessionId,
          mode,
        );
      } catch {
        try {
          await connect(sessionId, summary.lastMessagePreview || summary.title);
          const reconnected = useAppStore.getState().sessions[sessionId]?.summary;
          if (!reconnected?.connectionId || !reconnected.remoteSessionId) {
            return { kind: "unsupported", reason: t.grokStartThreadFailed };
          }
          summary = reconnected;
          connectionId = reconnected.connectionId;
          remoteSessionId = reconnected.remoteSessionId;
          result = await bridge.setSessionMode(
            connectionId,
            remoteSessionId,
            mode,
          );
        } catch (error) {
          return {
            kind: "unsupported",
            reason: translate("modeSwitchFailed", { reason: String(error) }),
          };
        }
      }
      if (result.kind === "switched") {
        state.setSessionModeState(sessionId, result.state);
        state.updateSummary(sessionId, { mode, updatedAt: new Date().toISOString() });
        const next = useAppStore.getState().sessions[sessionId]?.summary;
        if (next) await bridge.upsertSession(next).catch(() => undefined);
        return result;
      }
      if (result.kind === "command_required" && mode !== "goal") {
        // Do not auto-send `/plan` (or similar) — that starts a turn and can
        // look like a premature submit. Local mode + next send prefixes the
        // command via sendInternal's enteringMode path.
        const modeState = {
          ...session.modeState,
          currentMode: mode,
          liveSwitchSupported: false,
          source: "desktop" as const,
        };
        state.setSessionModeState(sessionId, modeState);
        state.updateSummary(sessionId, { mode, updatedAt: new Date().toISOString() });
        const next = useAppStore.getState().sessions[sessionId]?.summary;
        if (next) await bridge.upsertSession(next).catch(() => undefined);
        return { kind: "switched", state: modeState };
      }
      if (result.kind === "command_required" && mode === "goal") {
        state.setSessionModeState(sessionId, {
          ...session.modeState,
          currentMode: "goal",
          source: "desktop",
        });
      }
      return result;
    },
    [bridge, connect],
  );

  const confirmModelFork = useCallback(async () => {
    const fork = pendingModelFork;
    if (!fork) return;
    const state = useAppStore.getState();
    const sourceId = state.activeSessionId;
    const source = sourceId ? state.sessions[sourceId] : null;
    if (!source) return;
    const draft = source.draft;
    const attachments = source.attachments;
    const mode = source.summary.mode ?? state.settings.defaultMode;
    state.setActiveSession(null);
    state.replaceProvisionalDraft({
      text: draft,
      attachments,
      modelId: fork.modelId,
      commandHint: null,
      mode,
    });
    const newId = await createThread(mode);
    if (newId) {
      state.setSessionAttachments(newId, attachments);
      state.updateSummary(newId, {
        model: fork.modelId,
        sandbox: source.summary.sandbox ?? state.settings.sandbox,
        permissionPolicy:
          source.summary.permissionPolicy ?? state.settings.permissionPolicy,
      });
      state.clearProvisionalDraft();
      const next = useAppStore.getState().sessions[newId]?.summary;
      if (next) await bridge.upsertSession(next);
    }
    setPendingModelFork(null);
  }, [bridge, createThread, pendingModelFork]);

  const answerPermission = useCallback(
    async (optionId: string | null) => {
      const state = useAppStore.getState();
      const request = state.pendingPermission;
      if (!request?.connectionId) return;
      if (optionId) {
        const params = request.params && typeof request.params === "object"
          ? request.params as Record<string, unknown>
          : {};
        if (params.requiresSecondConfirmation === true) {
          const action = params.action && typeof params.action === "object"
            ? params.action as Record<string, unknown>
            : {};
          const command = Array.isArray(action.argv)
            ? action.argv.map(String).join(" ")
            : request.method;
          if (!window.confirm(`High-risk operation\n\n${command}\n\nConfirm execution?`)) {
            optionId = null;
          }
        }
      }
      if (optionId) {
        await bridge.respondServerRequest(request.connectionId, request.id, {
          outcome: { outcome: "selected", optionId },
        });
      } else {
        await bridge.respondServerRequest(
          request.connectionId,
          request.id,
          undefined,
          { code: -32000, message: "User denied permission" },
        );
      }
      state.setPermission(null);
      const targetSessionId = request.sessionId
        ? state.sessionOrder.find((id) => id === request.sessionId || state.sessions[id]?.summary.remoteSessionId === request.sessionId)
        : state.activeSessionId;
      if (targetSessionId) {
        state.updateSummary(targetSessionId, {
          runState: state.sessions[targetSessionId]?.busy ? "streaming" : "idle",
          attentionRequired: false,
        });
      }
    },
    [bridge],
  );

  const answerPlanApproval = useCallback(
    async (action: "approve" | "revise") => {
      const state = useAppStore.getState();
      const request = state.pendingPlanApproval;
      if (!request?.connectionId) return;
      const localSessionId = request.sessionId
        ? state.sessionOrder.find((id) => id === request.sessionId || state.sessions[id]?.summary.remoteSessionId === request.sessionId)
        : state.activeSessionId;
      await bridge.respondServerRequest(request.connectionId, request.id, {
        outcome: action === "approve" ? "approved" : "requested_changes",
        comments: [],
      });
      state.setPlanApproval(null);
      if (!localSessionId) return;
      if (action === "approve") {
        const previous = state.sessions[localSessionId]?.modeState;
        state.setSessionModeState(localSessionId, {
          currentMode: "agent",
          availableModes: previous?.availableModes ?? [],
          liveSwitchSupported: previous?.liveSwitchSupported ?? false,
          source: previous?.source ?? "acp_command",
        });
        state.updateSummary(localSessionId, {
          mode: "agent",
          runState: "streaming",
          attentionRequired: false,
          updatedAt: new Date().toISOString(),
        });
        state.setSessionBusy(localSessionId, true);
      } else {
        state.updateSummary(localSessionId, {
          mode: "plan",
          runState: "idle",
          attentionRequired: false,
          updatedAt: new Date().toISOString(),
        });
        state.setSessionBusy(localSessionId, false);
      }
      const next = useAppStore.getState().sessions[localSessionId]?.summary;
      if (next) await bridge.upsertSession(next);
    },
    [bridge],
  );

  return {
    connectingSessionId,
    chooseWorkspace,
    createThread,
    send,
    retryFailed,
    cancel,
    reloadActiveAgent,
    chooseModel,
    chooseEffort,
    chooseMode,
    pendingModelFork,
    confirmModelFork,
    cancelModelFork: () => setPendingModelFork(null),
    answerPermission,
    answerPlanApproval,
  };
}
