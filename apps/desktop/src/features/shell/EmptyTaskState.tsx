import {
  ArrowUpRight,
  FileSearch,
  Flag,
  GitBranch,
  GitPullRequest,
  Layers,
  ListTree,
} from "lucide-react";
import { t } from "../../i18n";
import type { TaskMode } from "../../types";
import { Stagger, StaggerItem } from "./motion";
import { RocketLineArt } from "./RocketLineArt";

export function EmptyTaskState({
  onSuggest,
}: {
  onSuggest: (prompt: string, mode: TaskMode) => void;
}) {
  const chips: Array<{
    label: string;
    prompt: string;
    mode: TaskMode;
    icon: typeof FileSearch;
  }> = [
    {
      label: t.chipPlanFirst,
      prompt: t.chipPlanFirstPrompt,
      mode: "plan",
      icon: ListTree,
    },
    {
      label: t.chipParallelExplore,
      prompt: t.chipParallelExplorePrompt,
      mode: "agent",
      icon: Layers,
    },
    {
      label: t.chipWorktree,
      prompt: t.chipWorktreePrompt,
      mode: "agent",
      icon: GitBranch,
    },
    {
      label: t.chipReviewApply,
      prompt: t.chipReviewApplyPrompt,
      mode: "agent",
      icon: GitPullRequest,
    },
    {
      label: t.chipGoalMode,
      prompt: t.chipGoalModePrompt,
      mode: "goal",
      icon: Flag,
    },
    {
      label: t.explainProject,
      prompt: t.explainProjectPrompt,
      mode: "agent",
      icon: FileSearch,
    },
  ];

  return (
    <Stagger className="gb-empty-stack gb-home-briefing" stagger={0.055} delayChildren={0.05}>
      <StaggerItem className="gb-home-signature">
        <div className="gb-empty-orbit" aria-hidden>
          <RocketLineArt />
        </div>
      </StaggerItem>
      <StaggerItem className="gb-home-copy">
        <div className="gb-empty-copy">
          <span className="gb-empty-overline">{t.newTask}</span>
          <h1>{t.emptyTitle}</h1>
          <p>{t.emptyDescription}</p>
          <p className="gb-empty-strengths">{t.emptyStrengthsHint}</p>
        </div>
      </StaggerItem>
      <StaggerItem className="gb-home-quick-actions">
        <div className="gb-suggestion-row" aria-label={t.newTask}>
          {chips.map((chip) => {
            const Icon = chip.icon;
            return (
              <button
                key={chip.label}
                type="button"
                className="gb-suggestion-card"
                onClick={() => onSuggest(chip.prompt, chip.mode)}
              >
                <Icon size={16} aria-hidden />
                <span>{chip.label}</span>
                <ArrowUpRight size={15} aria-hidden />
              </button>
            );
          })}
        </div>
      </StaggerItem>
    </Stagger>
  );
}
