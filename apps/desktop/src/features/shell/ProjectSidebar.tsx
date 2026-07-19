import {
  Archive,
  ChevronDown,
  Folder,
  FolderOpen,
  LayoutDashboard,
  MessageSquarePlus,
  Search,
  Settings,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SessionRuntime } from "../../store";
import type { WorkspaceRecord } from "../../types";
import { t } from "../../i18n";
import { RocketMark } from "./RocketLineArt";

function requiresAttention(session: SessionRuntime): boolean {
  return session.summary.runState === "awaiting_permission" || session.summary.attentionRequired === true;
}

function sessionStatus(session: SessionRuntime): string {
  if (session.busy || session.summary.runState === "streaming") return "running";
  if (requiresAttention(session)) return "attention";
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
  onOpenDashboard,
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
  onOpenDashboard: () => void;
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
      // A Host recovery or approval state should be actionable without requiring
      // the operator to remember which task was affected.
      .sort((left, right) => Number(requiresAttention(right)) - Number(requiresAttention(left)));
  }, [activeWorkspace, search, sessions, showArchived]);

  return (
    <aside className="gb-sidebar">
      <div className="gb-window-drag" data-tauri-drag-region>
        <div className="gb-brand-mark">
          <RocketMark />
        </div>
        <span className="gb-brand-name">
          <strong>grok build desktop</strong>
          <small>developed by taomahj</small>
        </span>
      </div>

      <div className="gb-sidebar-actions">
        <button type="button" className="gb-new-thread" onClick={onNewThread}>
          <MessageSquarePlus size={16} />
          {t.newTask}
          <kbd>⌘N</kbd>
        </button>
        <button type="button" className="gb-dashboard-link" onClick={onOpenDashboard}>
          <LayoutDashboard size={14} />
          {t.missionControl}
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
            const needsAttention = status === "attention";
            return (
              <button
                type="button"
                key={session.summary.sessionId}
                className={session.summary.sessionId === activeSessionId ? "gb-thread-row active" : "gb-thread-row"}
                onClick={() => onSelectSession(session.summary.sessionId)}
                aria-label={needsAttention ? `${t.taskNeedsAttention}: ${session.summary.title}` : session.summary.title}
              >
                <span className={`gb-status-dot ${status}`} aria-hidden />
                <span className="gb-thread-copy">
                  <span className="gb-thread-title">
                    <strong>{session.summary.title}</strong>
                    {needsAttention && <em className="gb-thread-attention">{t.taskNeedsAttention}</em>}
                  </span>
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
