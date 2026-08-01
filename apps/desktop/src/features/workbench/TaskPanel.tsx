import {
  Archive,
  ChevronDown,
  Folder,
  FolderOpen,
  LayoutDashboard,
  MessageSquarePlus,
  PanelLeftClose,
  Search,
  Settings,
  Timer,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../../i18n";
import type { SessionRuntime } from "../../store";
import type { WorkspaceRecord } from "../../types";
import type { AppView } from "./types";

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
  view,
  onNewThread,
  onSelectSession,
  onOpenWorkspace,
  onSelectWorkspace,
  onOpenSettings,
  onNavigate,
  onToggle,
}: {
  workspaces: WorkspaceRecord[];
  sessions: SessionRuntime[];
  activeSessionId: string | null;
  activeWorkspace: string;
  view: AppView;
  onNewThread: () => void;
  onSelectSession: (id: string) => void;
  onOpenWorkspace: () => void;
  onSelectWorkspace: (path: string) => void;
  onOpenSettings: () => void;
  onNavigate: (view: AppView) => void;
  onToggle: () => void;
}) {
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focus = () => {
      setSearchOpen(true);
      window.requestAnimationFrame(() => searchRef.current?.focus());
    };
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
      <div className="wb-sidebar-titlebar" data-tauri-drag-region>
        <div className="wb-sidebar-brand">
          <span className="wb-sidebar-brand-mark" aria-hidden>G</span>
          <strong>Grok Build</strong>
        </div>
        <div className="wb-sidebar-title-actions">
          <button
            type="button"
            className={searchOpen ? "wb-sidebar-icon active" : "wb-sidebar-icon"}
            aria-label={t.searchTasks}
            onClick={() => {
              setSearchOpen((current) => {
                const next = !current;
                if (next) window.requestAnimationFrame(() => searchRef.current?.focus());
                return next;
              });
            }}
          >
            <Search size={15} />
          </button>
          <button
            type="button"
            className="wb-sidebar-icon"
            aria-label={t.tasks}
            title={`${t.tasks} (⌘B)`}
            onClick={onToggle}
          >
            <PanelLeftClose size={15} />
          </button>
        </div>
      </div>

      <nav className="wb-sidebar-primary" aria-label={t.appName}>
        <button
          type="button"
          className={view === "home" ? "active" : ""}
          aria-current={view === "home" ? "page" : undefined}
          onClick={onNewThread}
        >
          <MessageSquarePlus size={15} strokeWidth={1.8} />
          {t.newTask}
          <kbd>⌘N</kbd>
        </button>
        <button
          type="button"
          className={view === "jobs" ? "active" : ""}
          aria-current={view === "jobs" ? "page" : undefined}
          onClick={() => onNavigate("jobs")}
        >
          <Timer size={15} strokeWidth={1.8} />
          {t.hostJobs}
        </button>
        <button
          type="button"
          className={view === "control" ? "active" : ""}
          aria-current={view === "control" ? "page" : undefined}
          onClick={() => onNavigate("control")}
        >
          <LayoutDashboard size={15} strokeWidth={1.8} />
          {t.missionControl}
        </button>
      </nav>

      {searchOpen && (
        <label className="wb-task-search">
          <Search size={14} />
          <input
            ref={searchRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t.searchTasks}
          />
          <button
            type="button"
            aria-label={t.cancel}
            onClick={() => {
              setSearch("");
              setSearchOpen(false);
            }}
          >
            <X size={13} />
          </button>
        </label>
      )}

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
        <button
          type="button"
          className={view === "settings" ? "wb-footer-btn active" : "wb-footer-btn"}
          aria-current={view === "settings" ? "page" : undefined}
          onClick={onOpenSettings}
        >
          <Settings size={14} /> {t.settings} <kbd>⌘,</kbd>
        </button>
      </div>
    </aside>
  );
}
