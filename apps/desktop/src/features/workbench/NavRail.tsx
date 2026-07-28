import {
  LayoutDashboard,
  MessageSquarePlus,
  PanelLeft,
  Settings,
  Timer,
} from "lucide-react";
import { t } from "../../i18n";
import { RocketMark } from "../shell/RocketLineArt";
import type { AppView } from "./types";

export function NavRail({
  view,
  taskPanelOpen,
  onNavigate,
  onToggleTaskPanel,
}: {
  view: AppView;
  taskPanelOpen: boolean;
  onNavigate: (view: AppView) => void;
  onToggleTaskPanel: () => void;
}) {
  return (
    <nav className="wb-rail" aria-label={t.appName}>
      <div className="wb-rail-drag" data-tauri-drag-region>
        <div className="wb-rail-mark" aria-hidden>
          <RocketMark />
        </div>
      </div>

      <div className="wb-rail-nav">
        <button
          type="button"
          className={view === "home" ? "wb-rail-btn active" : "wb-rail-btn"}
          title={`${t.newTask} (⌘N)`}
          aria-label={t.newTask}
          aria-current={view === "home" ? "page" : undefined}
          onClick={() => onNavigate("home")}
        >
          <MessageSquarePlus size={18} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className={view === "thread" ? "wb-rail-btn active" : "wb-rail-btn"}
          title={`${t.tasks} (⌘B)`}
          aria-label={t.tasks}
          aria-pressed={taskPanelOpen}
          aria-current={view === "thread" ? "page" : undefined}
          onClick={onToggleTaskPanel}
        >
          <PanelLeft size={18} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className={view === "jobs" ? "wb-rail-btn active" : "wb-rail-btn"}
          title={t.hostJobs}
          aria-label={t.hostJobs}
          aria-current={view === "jobs" ? "page" : undefined}
          onClick={() => onNavigate("jobs")}
        >
          <Timer size={18} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className={view === "control" ? "wb-rail-btn active" : "wb-rail-btn"}
          title={`${t.missionControl} (⌘\\)`}
          aria-label={t.missionControl}
          aria-current={view === "control" ? "page" : undefined}
          onClick={() => onNavigate("control")}
        >
          <LayoutDashboard size={18} strokeWidth={1.75} />
        </button>
      </div>

      <div className="wb-rail-footer">
        <button
          type="button"
          className={view === "settings" ? "wb-rail-btn active" : "wb-rail-btn"}
          title={`${t.settings} (⌘,)`}
          aria-label={t.settings}
          aria-current={view === "settings" ? "page" : undefined}
          onClick={() => onNavigate("settings")}
        >
          <Settings size={18} strokeWidth={1.75} />
        </button>
      </div>
    </nav>
  );
}
