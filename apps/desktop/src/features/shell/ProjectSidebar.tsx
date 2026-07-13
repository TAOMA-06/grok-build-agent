import {
  Archive,
  ChevronDown,
  Folder,
  FolderOpen,
  MessageSquarePlus,
  Search,
  Settings,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SessionRuntime } from "../../store";
import type { WorkspaceRecord } from "../../types";
import { t } from "../../i18n";

function MissionMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden>
      <path className="gb-mission-mark-orbit" d="M4.5 21.5C8 28 23 29 28.5 13.5" />
      <path className="gb-mission-mark-body" d="M17.2 4.6c3.9 2.1 6.1 6.1 5.6 10.5l-5.1 5.1-5.9-5.9 5.4-9.7Z" />
      <path className="gb-mission-mark-window" d="M18.3 9.1a2.1 2.1 0 1 1-3 3 2.1 2.1 0 0 1 3-3Z" />
      <path className="gb-mission-mark-flame" d="m11.7 16.1-2.8 5.6 5.6-2.7" />
    </svg>
  );
}

function sessionStatus(session: SessionRuntime): string {
  if (session.busy || session.summary.runState === "streaming") return "running";
  if (session.summary.runState === "awaiting_permission" || session.summary.attentionRequired) return "attention";
  if (session.summary.runState === "error") return "error";
  return "idle";
}

export function ProjectSidebar({
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
    return sessions.filter((session) => {
      if (Boolean(session.summary.archived) !== showArchived) return false;
      if (session.summary.workspaceRoot !== activeWorkspace) return false;
      if (!query) return true;
      return `${session.summary.title} ${session.summary.lastMessagePreview ?? ""}`
        .toLowerCase()
        .includes(query);
    });
  }, [activeWorkspace, search, sessions, showArchived]);

  return (
    <aside className="gb-sidebar">
      <div className="gb-window-drag" data-tauri-drag-region>
        <div className="gb-brand-mark"><MissionMark /></div>
        <span className="gb-brand-name"><strong>Grok Build</strong><small>Mission Control</small></span>
      </div>

      <div className="gb-sidebar-actions">
        <button type="button" className="gb-new-thread" onClick={onNewThread}>
          <MessageSquarePlus size={16} />
          {t.newTask}
          <kbd>⌘N</kbd>
        </button>
        <label className="gb-search">
          <Search size={14} />
          <input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t.searchTasks} />
        </label>
      </div>

      <div className="gb-sidebar-scroll">
        <button type="button" className="gb-section-toggle" onClick={() => setProjectsOpen((value) => !value)}>
          <ChevronDown size={13} className={projectsOpen ? "" : "collapsed"} />
          {t.projects}
        </button>
        {projectsOpen && (
          <div className="gb-project-list">
            {workspaces.map((workspace) => (
              <button
                type="button"
                key={workspace.id}
                className={workspace.path === activeWorkspace ? "gb-project active" : "gb-project"}
                onClick={() => onSelectWorkspace(workspace.path)}
              >
                {workspace.path === activeWorkspace ? <FolderOpen size={14} /> : <Folder size={14} />}
                <span>{workspace.name}</span>
              </button>
            ))}
            <button type="button" className="gb-project add" onClick={onOpenWorkspace}>
              <FolderOpen size={14} /> {t.openProject}
            </button>
          </div>
        )}

        <div className="gb-thread-list" aria-label={t.tasks}>
          {visibleSessions.map((session) => {
            const status = sessionStatus(session);
            return (
              <button
                type="button"
                key={session.summary.sessionId}
                className={session.summary.sessionId === activeSessionId ? "gb-thread-row active" : "gb-thread-row"}
                onClick={() => onSelectSession(session.summary.sessionId)}
              >
                <span className={`gb-status-dot ${status}`} />
                <span className="gb-thread-copy">
                  <strong>{session.summary.title}</strong>
                  <small>{session.summary.lastMessagePreview || (status === "running" ? t.grokWorking : t.ready)}</small>
                </span>
              </button>
            );
          })}
          {activeWorkspace && visibleSessions.length === 0 && (
            <div className="gb-sidebar-empty">{showArchived ? t.noArchivedTasks : t.noMatchingTasks}</div>
          )}
        </div>
      </div>

      <div className="gb-sidebar-footer">
        <button type="button" className={showArchived ? "gb-footer-action active" : "gb-footer-action"} onClick={() => setShowArchived((value) => !value)}><Archive size={15} /> {showArchived ? t.backToTasks : t.archived}</button>
        <button type="button" className="gb-footer-action" onClick={onOpenSettings}><Settings size={15} /> {t.settings} <kbd>⌘,</kbd></button>
      </div>
    </aside>
  );
}
