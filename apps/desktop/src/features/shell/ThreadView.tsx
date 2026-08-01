import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Archive,
  CircleAlert,
  CircleDot,
  ExternalLink,
  FileCode2,
  Flag,
  FolderKanban,
  Ghost,
  MoreHorizontal,
  Pencil,
  ShieldAlert,
  Trash2,
  Search,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ComposerAttachment, ModeSwitchResult, SelectableModel, ServerRequest, TaskMode } from "../../types";
import type { SessionRuntime } from "../../store";
import { describeError } from "../../contracts";
import { classifyPermissionCategory, type PermissionRiskCategory } from "../../contracts/permission";
import { CommandComposer } from "./CommandComposer";
import { EmptyTaskState } from "./EmptyTaskState";
import { ExecutionFlightDeck } from "./ExecutionFlightDeck";
import { Timeline } from "./Timeline";
import { t } from "../../i18n";
import { useAppStore } from "../../store";
import { formatFailureForTimeline, guidanceForError } from "./errorPresentation";

function permissionCategoryLabel(category: PermissionRiskCategory): string {
  switch (category) {
    case "shell":
      return t.permissionCategoryShell;
    case "interpreter":
      return t.permissionCategoryInterpreter;
    case "network":
      return t.permissionCategoryNetwork;
    case "package":
      return t.permissionCategoryPackage;
    case "container":
      return t.permissionCategoryContainer;
    case "destructive":
      return t.permissionCategoryDestructive;
    case "path_scope":
      return t.permissionCategoryPathScope;
    case "sensitive":
      return t.permissionCategorySensitive;
    case "elevated":
      return t.permissionCategoryElevated;
    default:
      return t.permissionCategoryGeneric;
  }
}

function PermissionDialog({
  request,
  options,
  onAnswer,
}: {
  request: ServerRequest;
  options: Array<{ optionId: string; name: string; kind?: string }>;
  onAnswer: (optionId: string | null) => Promise<void>;
}) {
  const params = request.params && typeof request.params === "object"
    ? request.params as Record<string, unknown>
    : {};
  const tool = (params.toolCall ?? params.tool_call) as Record<string, unknown> | undefined;
  const action = params.action && typeof params.action === "object"
    ? params.action as Record<string, unknown>
    : undefined;
  const category = classifyPermissionCategory(params);
  const hostReason = typeof params.description === "string" ? params.description : null;
  const secondConfirm = params.requiresSecondConfirmation === true
    || params.requires_second_confirmation === true;
  const title = String(tool?.title ?? tool?.kind ?? action?.tool ?? hostReason ?? t.protectedAction);
  const detail = String(
    (Array.isArray(action?.argv) ? action.argv.join(" ") : undefined) ??
    (tool?.rawInput as Record<string, unknown> | undefined)?.path ??
    (tool?.input as Record<string, unknown> | undefined)?.path ??
    params.path ??
    request.method,
  );
  return (
    <Dialog.Root open onOpenChange={() => undefined}>
      <Dialog.Portal>
        <Dialog.Overlay className="gb-dialog-overlay gb-permission-overlay" />
        <Dialog.Content
          className="gb-permission-dialog"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <div className="gb-permission-dialog-head">
            <div className="gb-permission-icon"><ShieldAlert size={18} /></div>
            <div>
              <Dialog.Title>{t.permissionNeeded}</Dialog.Title>
              <Dialog.Description>{permissionCategoryLabel(category)}</Dialog.Description>
            </div>
          </div>
          <div className="gb-permission-dialog-body">
            <strong>{title}</strong>
            <code>{detail}</code>
            {hostReason && <p><b>{t.permissionHostReason}</b> {hostReason}</p>}
            {action && <p className="gb-permission-risk">{String(action.risk ?? "unknown")} · {String(action.effect ?? "execute")}</p>}
            {secondConfirm && <p className="gb-permission-second">{t.permissionSecondConfirm}</p>}
          </div>
          <div className="gb-permission-actions">
            {options.filter((option) => !option.kind?.startsWith("reject")).map((option) => (
              <button type="button" className="gb-button primary" key={option.optionId} onClick={() => void onAnswer(option.optionId)}>{option.name}</button>
            ))}
            <button type="button" className="gb-button" onClick={() => void onAnswer(null)}>{t.deny}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ThreadView({
  session,
  workspaceName,
  models,
  connecting,
  drawerOpen,
  pendingPermission,
  pendingPlanApproval,
  permissionOptions,
  onToggleDrawer,
  onOpenPath,
  onSend,
  onCancel,
  onChooseModel,
  onChooseEffort,
  onChooseMode,
  onLocalCommand,
  onRetryFailed,
  onAnswerPermission,
  onPlanDecision,
  onRename,
  onArchive,
  onDelete,
}: {
  session: SessionRuntime | null;
  workspaceName: string;
  models: SelectableModel[];
  connecting: boolean;
  drawerOpen: boolean;
  pendingPermission: ServerRequest | null;
  pendingPlanApproval: ServerRequest | null;
  permissionOptions: Array<{ optionId: string; name: string; kind?: string }>;
  onToggleDrawer: () => void;
  onOpenPath: (path: string) => Promise<void>;
  onSend: (text: string, attachments: ComposerAttachment[], mode: TaskMode) => Promise<void>;
  onCancel: () => Promise<void>;
  onChooseModel: (modelId: string) => Promise<void>;
  onChooseEffort: (effort: string) => Promise<void>;
  onChooseMode: (mode: TaskMode) => Promise<ModeSwitchResult>;
  onLocalCommand: (command: string) => void;
  onRetryFailed: () => Promise<void>;
  onAnswerPermission: (optionId: string | null) => Promise<void>;
  onPlanDecision: (action: "approve" | "revise") => Promise<void>;
  onRename: (title: string) => Promise<void>;
  onArchive: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState(session?.summary.title ?? "");
  const threadScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => setTitleDraft(session?.summary.title ?? ""), [session?.summary.title]);
  useEffect(() => {
    const openRename = () => setRenameOpen(true);
    const openFind = (event: Event) => {
      setFindQuery(String((event as CustomEvent<string>).detail ?? ""));
      setFindOpen(true);
    };
    const viewPlan = () => document.querySelector(".gb-plan-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
    const scrollTranscript = (event: Event) => {
      const direction = (event as CustomEvent<"up" | "down">).detail;
      const container = threadScrollRef.current;
      if (!container) return;
      const page = Math.max(container.clientHeight * 0.85, 240);
      container.scrollBy({ top: direction === "up" ? -page : page, behavior: "smooth" });
    };
    window.addEventListener("grok:rename-task", openRename);
    window.addEventListener("grok:find-transcript", openFind);
    window.addEventListener("grok:view-plan", viewPlan);
    window.addEventListener("grok:scroll-transcript", scrollTranscript);
    return () => {
      window.removeEventListener("grok:rename-task", openRename);
      window.removeEventListener("grok:find-transcript", openFind);
      window.removeEventListener("grok:view-plan", viewPlan);
      window.removeEventListener("grok:scroll-transcript", scrollTranscript);
    };
  }, []);
  const executionRoot = session?.summary.executionRoot || session?.summary.worktreePath || session?.summary.workspaceRoot;
  const changesVisible = Boolean(session && (session.tools.length > 0 || session.summary.worktreePath));
  const visibleMode = session?.summary.mode ?? session?.modeState.currentMode ?? "agent";
  const isEmpty = !session?.blocks.length;
  const isNewTask = !session;
  const failure = session?.failedSubmission ?? null;
  const failureGuidance = failure ? guidanceForError(failure.errorCategory) : null;

  async function sendSuggestion(prompt: string, mode: TaskMode) {
    setSuggestionError(null);
    try {
      await onSend(prompt, [], mode);
    } catch (error) {
      setSuggestionError(formatFailureForTimeline(describeError(error)));
    }
  }

  const composer = (
    <div className={`gb-composer-dock${isEmpty ? " is-empty" : ""}`}>
      {isEmpty && (
        <div className="gb-composer-context">
          <FolderKanban size={13} />
          <span>{workspaceName || t.chooseProject}</span>
        </div>
      )}
      <div
        className={`gb-composer-shell${visibleMode === "plan" ? " plan" : ""}${
          visibleMode === "goal" ? " goal" : ""
        }`}
      >
        {visibleMode === "goal" && session?.summary.mode === "goal" && (
          <div className="gb-mode-status goal has-actions" role="status">
            <Flag size={12} strokeWidth={2} aria-hidden className="gb-mode-status-icon" />
            <span className="gb-mode-status-label">{session.busy ? t.goalActive : t.goalMode}</span>
            <div className="gb-mode-status-actions">
              <button type="button" onClick={() => void onSend("/goal status", [], "goal")}>{t.status}</button>
              <button type="button" onClick={() => void onSend(session.busy ? "/goal pause" : "/goal resume", [], "goal")}>{session.busy ? t.pause : t.resume}</button>
              <button type="button" onClick={() => void onSend("/goal clear", [], "goal")}>{t.clear}</button>
            </div>
          </div>
        )}
        <CommandComposer
          models={models}
          busy={session?.busy ?? false}
          connecting={connecting}
          onSend={onSend}
          onCancel={onCancel}
          onChooseModel={onChooseModel}
          onChooseEffort={onChooseEffort}
          onChooseMode={onChooseMode}
          onLocalCommand={onLocalCommand}
        />
      </div>
      {failure && failureGuidance && (
        <div className="gb-send-failure" role="alert">
          <CircleAlert size={17} aria-hidden />
          <div className="gb-send-failure-copy">
            <strong>{failureGuidance.title}</strong>
            <p>{failureGuidance.cause}</p>
            <code>{failure.error}</code>
            <small>{failureGuidance.recovery}</small>
          </div>
          <button type="button" onClick={() => void onRetryFailed()}>{t.retry}</button>
        </div>
      )}
      <div className="gb-composer-note">{t.safetyNote}</div>
    </div>
  );

  return (
    <>
    <main className={`gb-thread-view${session?.busy || connecting ? " is-running" : ""}${isEmpty ? " is-empty" : " is-active-briefing"}`}>
      <header className="gb-thread-header" data-tauri-drag-region>
        {session ? (
          <>
            <div className="gb-thread-heading">
              <strong>{session.summary.title}</strong>
              <span><FolderKanban size={13} /> {workspaceName || t.project}{session.summary.worktreePath && <> <i>·</i> <Flag size={12} /> {t.isolated}</>}</span>
            </div>
            <div className="gb-thread-header-actions">
              <span className={`gb-run-pill ${session.busy ? "running" : session.summary.runState}`} role="status" aria-live="polite"><CircleDot size={12} />{session.busy ? t.grokWorking : t.runState[session.summary.runState] ?? session.summary.runState}</span>
              {session.summary.mode === "plan" && (
                <span className="gb-plan-pill" title={t.planModeBannerDetail}>
                  <ShieldAlert size={12} /> {t.modePlan}
                </span>
              )}
              {session.privateChat && <span className="gb-private-chat-pill" title={t.privateChatLocalOnly}><Ghost size={12} /> {t.privateChatActive}</span>}
              <button type="button" className={drawerOpen ? "gb-header-button active" : "gb-header-button"} onClick={onToggleDrawer}><FileCode2 size={14} /> {t.changes}{changesVisible && <span className="gb-change-dot" />}</button>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild><button type="button" className="gb-icon-button" aria-label={t.moreTaskActions}><MoreHorizontal size={17} /></button></DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className="gb-dropdown compact" sideOffset={7} align="end">
                    {executionRoot && (
                      <DropdownMenu.Item onSelect={() => void onOpenPath(executionRoot)}>
                        <ExternalLink size={14} /> {t.open}
                      </DropdownMenu.Item>
                    )}
                    <DropdownMenu.Item onSelect={() => setRenameOpen(true)}><Pencil size={14} /> {t.rename}</DropdownMenu.Item>
                    {!session.privateChat && <DropdownMenu.Item onSelect={() => void onArchive()}><Archive size={14} /> {session.summary.archived ? t.restore : t.archive}</DropdownMenu.Item>}
                    <DropdownMenu.Separator className="gb-dropdown-separator" />
                    <DropdownMenu.Item className="danger" onSelect={() => setDeleteOpen(true)}><Trash2 size={14} /> {t.delete}</DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          </>
        ) : <div className="gb-thread-heading new"><strong>{t.newTask}</strong><span>{workspaceName || t.chooseProject}</span></div>}
      </header>

      {isEmpty ? (
        <div className="gb-empty-layout">
          {session && !session.privateChat && <ExecutionFlightDeck session={session} />}
          {isNewTask && <EmptyTaskState onSuggest={(prompt, mode) => void sendSuggestion(prompt, mode)} />}
          {suggestionError && (
            <div className="gb-composer-error" role="alert">
              <span>{suggestionError}</span>
            </div>
          )}
          {composer}
        </div>
      ) : (
        <>
          <div ref={threadScrollRef} className="gb-thread-scroll">
            {findOpen && (
              <div className="gb-find-bar">
                <Search size={14} />
                <input autoFocus value={findQuery} onChange={(event) => setFindQuery(event.target.value)} placeholder={t.commands.find} />
                <span>{findQuery ? session?.blocks.filter((block) => "text" in block && String(block.text).toLowerCase().includes(findQuery.toLowerCase())).length ?? 0 : 0}</span>
                <button type="button" aria-label={t.cancel} onClick={() => setFindOpen(false)}><X size={14} /></button>
              </div>
            )}
            <div className="gb-thread-column">
              <Timeline
                blocks={session!.blocks}
                busy={Boolean(session?.busy)}
                planActionsEnabled={Boolean(pendingPlanApproval)}
                onPlanAction={(action) => {
                  if (pendingPlanApproval) {
                    void onPlanDecision(action).then(() => {
                      if (action === "revise" && session) {
                        useAppStore.getState().setSessionDraft(session.summary.sessionId, t.planFeedbackDraft);
                        window.dispatchEvent(new Event("grok:focus-composer"));
                      }
                    });
                    return;
                  }
                  if (action === "approve") {
                    void onChooseMode("agent").then((result) => {
                      if (result.kind !== "unsupported") void onSend(t.planApprovedControl, [], "agent");
                    });
                  } else if (session) {
                    useAppStore.getState().setSessionDraft(session.summary.sessionId, t.planFeedbackDraft);
                    window.dispatchEvent(new Event("grok:focus-composer"));
                  }
                }}
              />
            </div>
          </div>
          {composer}
        </>
      )}
    </main>
    {pendingPermission && (
      <PermissionDialog request={pendingPermission} options={permissionOptions} onAnswer={onAnswerPermission} />
    )}
    <Dialog.Root open={renameOpen} onOpenChange={setRenameOpen}>
      <Dialog.Portal><Dialog.Overlay className="gb-dialog-overlay" /><Dialog.Content className="gb-confirm-dialog"><Dialog.Title>{t.renameTask}</Dialog.Title><Dialog.Description>{t.renameTaskHint}</Dialog.Description><input className="gb-dialog-input" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} autoFocus /><div className="gb-confirm-actions"><Dialog.Close asChild><button type="button" className="gb-button">{t.cancel}</button></Dialog.Close><button type="button" className="gb-button primary" disabled={!titleDraft.trim()} onClick={() => { void onRename(titleDraft.trim()); setRenameOpen(false); }}>{t.save}</button></div></Dialog.Content></Dialog.Portal>
    </Dialog.Root>
    <Dialog.Root open={deleteOpen} onOpenChange={setDeleteOpen}>
      <Dialog.Portal><Dialog.Overlay className="gb-dialog-overlay" /><Dialog.Content className="gb-confirm-dialog"><Dialog.Title>{t.deleteTask}</Dialog.Title><Dialog.Description>{session?.summary.worktreePath && !session.summary.appliedAt ? t.deleteTaskWorktree : t.deleteTaskHistory}</Dialog.Description><div className="gb-confirm-actions"><Dialog.Close asChild><button type="button" className="gb-button">{t.cancel}</button></Dialog.Close><button type="button" className="gb-button danger" onClick={() => { void onDelete(); setDeleteOpen(false); }}>{t.deleteTask}</button></div></Dialog.Content></Dialog.Portal>
    </Dialog.Root>
    </>
  );
}
