import { useCallback, useState } from "react";
import { buildPromptContent } from "../../contracts";
import { useDesktopBridge } from "../../platform/DesktopBridge";
import { useAppStore } from "../../store";
import { t, translate } from "../../i18n";
import type {
  AgentStatus,
  ComposerAttachment,
  PermissionPolicy,
  ModeSwitchResult,
  SessionSummary,
  TaskMode,
} from "../../types";

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

export function useDesktopController(
  chooseDirtyPolicy: () => Promise<DirtyPolicy>,
): DesktopController {
  const bridge = useDesktopBridge();
  const [connectingSessionId, setConnectingSessionId] = useState<string | null>(null);
  const [pendingModelFork, setPendingModelFork] = useState<{
    modelId: string;
    reason: string;
  } | null>(null);

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
      state.setFailedSubmission(sessionId, null);
      state.setSessionDraft(sessionId, "");
      state.setSessionAttachments(sessionId, []);
      state.clearProvisionalDraft();
      await bridge.upsertSession(summary);
      await bridge.saveDraft(sessionId, "");

      try {
        let target = useAppStore.getState().sessions[sessionId]?.summary;
        const runtimeStatus = useAppStore.getState().status;
        const connectionIsLive = Boolean(
          runtimeStatus.running
          && runtimeStatus.connectionId
          && runtimeStatus.connectionId === target?.connectionId,
        );
        if (!target?.connectionId || !target.remoteSessionId || !connectionIsLive) {
          await connect(sessionId, displayText);
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
        await bridge.sendPrompt(
          target.connectionId,
          target.remoteSessionId,
          promptText,
          [...inlineContent, ...localContent],
          {
            taskId: sessionId,
            turnId: messageBlockId,
            idempotencyKey: `prompt:${sessionId}:${messageBlockId}`,
          },
        );
        if (enteringMode && target.connectionId && target.remoteSessionId) {
          const modeState = await bridge.confirmSessionMode(
            target.connectionId,
            target.remoteSessionId,
            mode,
          );
          state.setSessionModeState(sessionId, modeState);
        }
        state.updateBlock(sessionId, messageBlockId, {
          type: "user",
          delivery: "sent",
        });
        await bridge.appendCachedEvent({
          sessionId,
          sequence: Date.now(),
          timestamp: new Date().toISOString(),
          kind: "user",
          payload: { text: displayText },
        });
        const complete = useAppStore.getState().sessions[sessionId]?.summary;
        if (complete) {
          const next = { ...complete, runState: "idle" as const };
          useAppStore.getState().updateSummary(sessionId, next);
          await bridge.upsertSession(next);
        }
      } catch (error) {
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
        state.setSessionBusy(sessionId, false);
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
    if (summary?.connectionId && summary.remoteSessionId) {
      await bridge.cancelPrompt(summary.connectionId, summary.remoteSessionId);
    }
    state.setSessionBusy(sessionId, false);
    state.updateSummary(sessionId, { runState: "cancelled" });
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
      let summary = state.sessions[sessionId]?.summary;
      if (summary?.connectionId && summary.remoteSessionId) {
        let result;
        try {
          result = await bridge.setSessionModel(
            summary.connectionId,
            summary.remoteSessionId,
            modelId,
          );
        } catch {
          try {
            await connect(sessionId, summary.lastMessagePreview || summary.title);
            summary = useAppStore.getState().sessions[sessionId]?.summary;
            if (!summary?.connectionId || !summary.remoteSessionId) throw new Error(t.grokStartThreadFailed);
            result = await bridge.setSessionModel(
              summary.connectionId,
              summary.remoteSessionId,
              modelId,
            );
          } catch (error) {
            state.addBlock(sessionId, {
              id: crypto.randomUUID(),
              type: "system",
              level: "error",
              text: translate("modelSwitchFailed", { reason: String(error) }),
            });
            return;
          }
        }
        if (result.kind === "new_session_required") {
          setPendingModelFork({ modelId, reason: result.reason });
          return;
        }
        state.setEffectiveModelId(modelId);
        state.setSessionModelState(sessionId, result.state);
        state.setGlobalModelState(result.state);
      } else {
        state.setEffectiveModelId(modelId);
      }
      const next = useAppStore.getState().sessions[sessionId]?.summary;
      if (next) await bridge.upsertSession(next);
    },
    [bridge, connect],
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
      if (!summary.connectionId || !summary.remoteSessionId) {
        state.setEffectiveMode(mode);
        const next = useAppStore.getState().sessions[sessionId]?.summary;
        if (next) await bridge.upsertSession(next);
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
        if (next) await bridge.upsertSession(next);
        return result;
      }
      if (result.kind === "command_required" && mode !== "goal") {
        state.setSessionBusy(sessionId, true);
        try {
          await bridge.sendPrompt(
            connectionId,
            remoteSessionId,
            result.command,
          );
          const modeState = await bridge.confirmSessionMode(
            connectionId,
            remoteSessionId,
            mode,
          );
          state.setSessionModeState(sessionId, modeState);
          state.updateSummary(sessionId, { mode, updatedAt: new Date().toISOString() });
          const next = useAppStore.getState().sessions[sessionId]?.summary;
          if (next) await bridge.upsertSession(next);
          return { kind: "switched", state: modeState };
        } catch (error) {
          return { kind: "unsupported", reason: String(error) };
        } finally {
          state.setSessionBusy(sessionId, false);
        }
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
    chooseMode,
    pendingModelFork,
    confirmModelFork,
    cancelModelFork: () => setPendingModelFork(null),
    answerPermission,
    answerPlanApproval,
  };
}
