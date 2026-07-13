import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Archive,
  CircleDot,
  ExternalLink,
  FileCode2,
  Flag,
  FolderKanban,
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
import { CommandComposer } from "./CommandComposer";
import { Timeline } from "./Timeline";
import { t } from "../../i18n";
import { useAppStore } from "../../store";
import missionRocketUrl from "../../assets/mission-rocket.jpg";

function LaunchTrajectory() {
  return (
    <div className="gb-launch-trajectory" aria-hidden>
      <img src={missionRocketUrl} alt="" />
      <div className="gb-launch-scan" />
      <span className="gb-launch-coordinate">LC-01 · 28.5°N</span>
      <span className="gb-launch-status">ORBITAL LINK · READY</span>
    </div>
  );
}

function PermissionCard({
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
  const title = String(tool?.title ?? tool?.kind ?? action?.tool ?? params.description ?? t.protectedAction);
  const detail = String(
    (Array.isArray(action?.argv) ? action.argv.join(" ") : undefined) ??
    (tool?.rawInput as Record<string, unknown> | undefined)?.path ??
    (tool?.input as Record<string, unknown> | undefined)?.path ??
    params.path ??
    request.method,
  );
  return (
    <section className="gb-permission-card">
      <div className="gb-permission-icon"><ShieldAlert size={18} /></div>
      <div className="gb-permission-copy">
        <strong>{t.permissionNeeded}</strong>
        <span>{title}</span>
        <code>{detail}</code>
        {action && <small>{String(action.risk ?? "unknown")} · {String(action.effect ?? "execute")} · {String(action.workspaceId ?? "")}</small>}
      </div>
      <div className="gb-permission-actions">
        {options.filter((option) => !option.kind?.startsWith("reject")).map((option) => (
          <button type="button" className="gb-button primary" key={option.optionId} onClick={() => void onAnswer(option.optionId)}>{option.name}</button>
        ))}
        <button type="button" className="gb-button" onClick={() => void onAnswer(null)}>{t.deny}</button>
      </div>
    </section>
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

  return (
    <>
    <main className={`gb-thread-view${session?.busy || connecting ? " is-running" : ""}${session?.blocks.length ? "" : " is-empty"}`}>
      <header className="gb-thread-header" data-tauri-drag-region>
        {session ? (
          <>
            <div className="gb-thread-heading">
              <strong>{session.summary.title}</strong>
              <span><FolderKanban size={13} /> {workspaceName || t.project}{session.summary.worktreePath && <> <i>·</i> <Flag size={12} /> {t.isolated}</>}</span>
            </div>
            <div className="gb-thread-header-actions">
              <span className={`gb-run-pill ${session.busy ? "running" : session.summary.runState}`} role="status" aria-live="polite"><CircleDot size={12} />{session.busy ? t.grokWorking : t.runState[session.summary.runState] ?? session.summary.runState}</span>
              {executionRoot && <button type="button" className="gb-header-button" onClick={() => void onOpenPath(executionRoot)}><ExternalLink size={14} /> {t.open}</button>}
              <button type="button" className={drawerOpen ? "gb-header-button active" : "gb-header-button"} onClick={onToggleDrawer}><FileCode2 size={14} /> {t.changes}{changesVisible && <span className="gb-change-dot" />}</button>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild><button type="button" className="gb-icon-button" aria-label={t.moreTaskActions}><MoreHorizontal size={17} /></button></DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className="gb-dropdown compact" sideOffset={7} align="end">
                    <DropdownMenu.Item onSelect={() => setRenameOpen(true)}><Pencil size={14} /> {t.rename}</DropdownMenu.Item>
                    <DropdownMenu.Item onSelect={() => void onArchive()}><Archive size={14} /> {session.summary.archived ? t.restore : t.archive}</DropdownMenu.Item>
                    <DropdownMenu.Separator className="gb-dropdown-separator" />
                    <DropdownMenu.Item className="danger" onSelect={() => setDeleteOpen(true)}><Trash2 size={14} /> {t.delete}</DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          </>
        ) : <div className="gb-thread-heading new"><strong>{t.newTask}</strong><span>{workspaceName || t.chooseProject}</span></div>}
      </header>

      <div ref={threadScrollRef} className={session?.blocks.length ? "gb-thread-scroll" : "gb-thread-scroll empty"}>
        {findOpen && (
          <div className="gb-find-bar">
            <Search size={14} />
            <input autoFocus value={findQuery} onChange={(event) => setFindQuery(event.target.value)} placeholder={t.commands.find} />
            <span>{findQuery ? session?.blocks.filter((block) => "text" in block && String(block.text).toLowerCase().includes(findQuery.toLowerCase())).length ?? 0 : 0}</span>
            <button type="button" aria-label={t.cancel} onClick={() => setFindOpen(false)}><X size={14} /></button>
          </div>
        )}
        {session?.blocks.length ? (
          <div className="gb-thread-column">
            <Timeline
              blocks={session.blocks}
              busy={Boolean(session.busy)}
              planActionsEnabled={Boolean(pendingPlanApproval)}
              onPlanAction={(action) => {
                if (pendingPlanApproval) {
                  void onPlanDecision(action).then(() => {
                    if (action === "revise") {
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
                } else {
                  useAppStore.getState().setSessionDraft(session.summary.sessionId, t.planFeedbackDraft);
                  window.dispatchEvent(new Event("grok:focus-composer"));
                }
              }}
            />
            {pendingPermission && (
              <PermissionCard request={pendingPermission} options={permissionOptions} onAnswer={onAnswerPermission} />
            )}
          </div>
        ) : (
          <div className="gb-empty-thread">
            <LaunchTrajectory />
            <h1>{t.emptyTitle}</h1>
            <p>{t.emptyDescription}</p>
            <div className="gb-suggestion-row">
              <button type="button" onClick={() => void onSend(t.explainProjectPrompt, [], "agent")}>{t.explainProject}</button>
              <button type="button" onClick={() => void onSend(t.reviewChangesPrompt, [], "agent")}>{t.reviewChanges}</button>
            </div>
          </div>
        )}
      </div>

      <div className={session?.blocks.length ? "gb-composer-dock" : "gb-composer-dock hero"}>
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
        {session?.failedSubmission && (
          <div className="gb-send-failure" role="alert">
            <span>{session.failedSubmission.error}</span>
            <button type="button" onClick={() => void onRetryFailed()}>{t.retry}</button>
          </div>
        )}
        <div className="gb-composer-note">{t.safetyNote}</div>
      </div>
    </main>
    <Dialog.Root open={renameOpen} onOpenChange={setRenameOpen}>
      <Dialog.Portal><Dialog.Overlay className="gb-dialog-overlay" /><Dialog.Content className="gb-confirm-dialog"><Dialog.Title>{t.renameTask}</Dialog.Title><Dialog.Description>{t.renameTaskHint}</Dialog.Description><input className="gb-dialog-input" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} autoFocus /><div className="gb-confirm-actions"><Dialog.Close asChild><button type="button" className="gb-button">{t.cancel}</button></Dialog.Close><button type="button" className="gb-button primary" disabled={!titleDraft.trim()} onClick={() => { void onRename(titleDraft.trim()); setRenameOpen(false); }}>{t.save}</button></div></Dialog.Content></Dialog.Portal>
    </Dialog.Root>
    <Dialog.Root open={deleteOpen} onOpenChange={setDeleteOpen}>
      <Dialog.Portal><Dialog.Overlay className="gb-dialog-overlay" /><Dialog.Content className="gb-confirm-dialog"><Dialog.Title>{t.deleteTask}</Dialog.Title><Dialog.Description>{session?.summary.worktreePath && !session.summary.appliedAt ? t.deleteTaskWorktree : t.deleteTaskHistory}</Dialog.Description><div className="gb-confirm-actions"><Dialog.Close asChild><button type="button" className="gb-button">{t.cancel}</button></Dialog.Close><button type="button" className="gb-button danger" onClick={() => { void onDelete(); setDeleteOpen(false); }}>{t.deleteTask}</button></div></Dialog.Content></Dialog.Portal>
    </Dialog.Root>
    </>
  );
}
