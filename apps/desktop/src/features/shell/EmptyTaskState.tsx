import { FileSearch, GitPullRequest, Hammer, Sparkles, Wrench } from "lucide-react";
import { t } from "../../i18n";
import type { TaskMode } from "../../types";
import { Stagger, StaggerItem } from "./motion";

export function EmptyTaskState({
  onSuggest,
}: {
  onSuggest: (prompt: string, mode: TaskMode) => void;
}) {
  return (
    <Stagger className="gb-empty-stack gb-home-briefing" stagger={0.055} delayChildren={0.05}>
      <StaggerItem className="gb-home-signature">
        <div className="gb-empty-orbit" aria-hidden>
          <Sparkles size={30} strokeWidth={1.45} />
        </div>
      </StaggerItem>
      <StaggerItem className="gb-home-copy">
        <div className="gb-empty-copy">
          <span className="gb-empty-overline">{t.newTask}</span>
          <h1>{t.emptyTitle}</h1>
          <p>{t.emptyDescription}</p>
        </div>
      </StaggerItem>
      <StaggerItem className="gb-home-quick-actions">
        <div className="gb-suggestion-row" aria-label={t.newTask}>
          <button type="button" className="gb-suggestion-card" onClick={() => onSuggest(t.explainProjectPrompt, "agent")}>
            <FileSearch size={16} aria-hidden />
            <span>{t.explainProject}</span>
          </button>
          <button type="button" className="gb-suggestion-card" onClick={() => onSuggest(t.buildFeaturePrompt, "agent")}>
            <Hammer size={16} aria-hidden />
            <span>{t.buildFeature}</span>
          </button>
          <button type="button" className="gb-suggestion-card" onClick={() => onSuggest(t.reviewChangesPrompt, "agent")}>
            <GitPullRequest size={16} aria-hidden />
            <span>{t.reviewChanges}</span>
          </button>
          <button type="button" className="gb-suggestion-card" onClick={() => onSuggest(t.fixIssuesPrompt, "agent")}>
            <Wrench size={16} aria-hidden />
            <span>{t.fixIssues}</span>
          </button>
        </div>
      </StaggerItem>
    </Stagger>
  );
}
