import { Archive, ChevronDown, Folder, FolderOpen, MessageSquarePlus, Search, Settings } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../../i18n";
import type { SessionRuntime } from "../../store";
import type { WorkspaceRecord } from "../../types";

function requiresAttention(session: SessionRuntime): boolean {
  return session.summary.runState === "awaiting_permission" || session.summary.attentionRequired === true;
}

function sessionStatus(session: SessionRuntime): string {
  if (session.busy || session.summary.runState === "streaming") return "running";
  if (requiresAttention(session)) return "attention";
  if (session.summary.runState === "error") return "error";
  return "idle";
}

export function TaskPanel({
  workspaces,
  sessions,
  activeSessionId,
  activeWorkspace,
  onNewThread,
  onSelectSession,
  onOpenWorkspace,
  onSelectWorkspace,
  onOpenSettings,
}: {
  workspaces: WorkspaceRecord[];
  sessions: SessionRuntime[];
  activeSessionId: string | null;
  activeWorkspace: string;
  onNewThread: () => void;
  onSelectSession: (id: string) => void;
  onOpenWorkspace: () => void;
  onSelectWorkspace: (path: string) => void;
  onOpenSettings: () => void;
}) {
  const [search, setSearch] = useState("");
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focus = () => searchRef.current?.focus();
    window.addEventListener("grok:focus-task-search", focus);
    return () => window.removeEventListener("grok:focus-task-search", focus);
  }, []);

  const visibleSessions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return sessions
      .filter((session) => {
        if (Boolean(session.summary.archived) !== showArchived) return false;
        if (session.summary.workspaceRoot !== activeWorkspace) return false;
        if (!query) return true;
        return `${session.summary.title} ${session.summary.lastMessagePreview ?? ""}`
          .toLowerCase()
          .includes(query);
      })
      .sort((left, right) => Number(requiresAttention(right)) - Number(requiresAttention(left)));
  }, [activeWorkspace, search, sessions, showArchived]);

  return (
    <aside className="wb-task-panel" aria-label={t.tasks}>
      <div className="wb-task-panel-head" data-tauri-drag-region>
        <strong>{t.tasks}</strong>
      </div>

      <div className="wb-task-panel-actions">
        <button type="button" className="wb-task-new" onClick={onNewThread}>
          <MessageSquarePlus size={15} />
          {t.newTask}
          <kbd>⌘N</kbd>
        </button>
        <label className="wb-task-search">
          <Search size={14} />
          <input
            ref={searchRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t.searchTasks}
          />
        </label>
      </div>

      <div className="wb-task-scroll">
        <button type="button" className="wb-section-label" onClick={() => setProjectsOpen((v) => !v)}>
          <ChevronDown size={12} style={{ transform: projectsOpen ? undefined : "rotate(-90deg)" }} />
          {t.projects}
        </button>
        {projectsOpen && (
          <div>
            {workspaces.map((workspace) => (
              <button
                type="button"
                key={workspace.id}
                className={workspace.path === activeWorkspace ? "wb-project-row active" : "wb-project-row"}
                onClick={() => onSelectWorkspace(workspace.path)}
              >
                {workspace.path === activeWorkspace ? <FolderOpen size={14} /> : <Folder size={14} />}
                <span>{workspace.name}</span>
              </button>
            ))}
            <button type="button" className="wb-project-row add" onClick={onOpenWorkspace}>
              <FolderOpen size={14} /> {t.openProject}
            </button>
          </div>
        )}

        <div className="wb-section-label" style={{ marginTop: 8 }}>{t.tasks}</div>
        <div aria-label={t.tasks}>
          {visibleSessions.map((session) => {
            const status = sessionStatus(session);
            const needsAttention = status === "attention";
            return (
              <button
                type="button"
                key={session.summary.sessionId}
                className={session.summary.sessionId === activeSessionId ? "wb-thread-row active" : "wb-thread-row"}
                onClick={() => onSelectSession(session.summary.sessionId)}
                aria-label={needsAttention ? `${t.taskNeedsAttention}: ${session.summary.title}` : session.summary.title}
              >
                <span className={`wb-status-dot ${status}`} aria-hidden />
                <span className="wb-thread-copy">
                  <strong>{session.summary.title}</strong>
                  <small>
                    {session.summary.lastMessagePreview || (status === "running" ? t.grokWorking : t.ready)}
                  </small>
                </span>
              </button>
            );
          })}
          {activeWorkspace && visibleSessions.length === 0 && (
            <div className="gb-sidebar-empty">{showArchived ? t.noArchivedTasks : t.noMatchingTasks}</div>
          )}
        </div>
      </div>

      <div className="wb-task-panel-footer">
        <button
          type="button"
          className={showArchived ? "wb-footer-btn active" : "wb-footer-btn"}
          onClick={() => setShowArchived((v) => !v)}
        >
          <Archive size={14} /> {showArchived ? t.backToTasks : t.archived}
        </button>
        <button type="button" className="wb-footer-btn" onClick={onOpenSettings}>
          <Settings size={14} /> {t.settings} <kbd>⌘,</kbd>
        </button>
      </div>
    </aside>
  );
}
