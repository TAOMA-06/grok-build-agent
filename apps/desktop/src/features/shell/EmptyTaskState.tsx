import { ArrowUpRight, FileSearch, GitPullRequest } from "lucide-react";
import { t } from "../../i18n";
import type { TaskMode } from "../../types";
import { Stagger, StaggerItem } from "./motion";
import { RocketLineArt } from "./RocketLineArt";

export function EmptyTaskState({
  onSuggest,
}: {
  onSuggest: (prompt: string, mode: TaskMode) => void;
}) {
  return (
    <Stagger className="gb-empty-stack" stagger={0.055} delayChildren={0.05}>
      <StaggerItem>
        <div className="gb-empty-orbit">
          <RocketLineArt />
        </div>
      </StaggerItem>
      <StaggerItem>
        <div className="gb-empty-copy">
          <span className="gb-empty-overline">{t.newTask}</span>
          <h1>{t.emptyTitle}</h1>
          <p>{t.emptyDescription}</p>
        </div>
      </StaggerItem>
      <StaggerItem>
        <div className="gb-suggestion-row">
          <button type="button" className="gb-suggestion-card" onClick={() => onSuggest(t.explainProjectPrompt, "agent")}>
            <FileSearch size={16} aria-hidden />
            <span>{t.explainProject}</span>
            <ArrowUpRight size={15} aria-hidden />
          </button>
          <button type="button" className="gb-suggestion-card" onClick={() => onSuggest(t.reviewChangesPrompt, "agent")}>
            <GitPullRequest size={16} aria-hidden />
            <span>{t.reviewChanges}</span>
            <ArrowUpRight size={15} aria-hidden />
          </button>
        </div>
      </StaggerItem>
    </Stagger>
  );
}
