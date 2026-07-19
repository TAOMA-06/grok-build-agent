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
        <RocketLineArt />
      </StaggerItem>
      <StaggerItem>
        <div className="gb-empty-copy">
          <h1>{t.emptyTitle}</h1>
          <p>{t.emptyDescription}</p>
        </div>
      </StaggerItem>
      <StaggerItem>
        <div className="gb-suggestion-row">
          <button type="button" onClick={() => onSuggest(t.explainProjectPrompt, "agent")}>
            {t.explainProject}
          </button>
          <button type="button" onClick={() => onSuggest(t.reviewChangesPrompt, "agent")}>
            {t.reviewChanges}
          </button>
        </div>
      </StaggerItem>
    </Stagger>
  );
}
