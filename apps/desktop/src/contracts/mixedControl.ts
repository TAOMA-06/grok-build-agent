/**
 * Mixed control (optional): when the user enables mixed planning, a
 * secondary ACP (typically Codex) drafts a plan and Grok implements
 * after approval. Users can also run Grok-only or secondary-ACP-only
 * from Settings — this module only describes the mixed path.
 */

import type { TaskMode } from "./mode";
import type { ChatBlock, SessionSummary } from "./session";
import type { Settings } from "./settings";

export const GROK_ADAPTER_ID = "grok-acp";
export const PLANNER_ADAPTER_ID = "generic-acp";

export function mixedPlanningReady(settings: Settings): boolean {
  return settings.mixedPlanning === true && Boolean(settings.secondaryAcpPath.trim());
}

export function resolvePlannerExecutable(settings: Settings): string | null {
  const path = settings.secondaryAcpPath.trim();
  return path || null;
}

export function resolveExecutorExecutable(settings: Settings): string | null {
  const primary = (settings.cliPathOverride || settings.grokPath).trim();
  return primary || null;
}

export function shouldStartWithPlanner(settings: Settings, mode: TaskMode): boolean {
  return mixedPlanningReady(settings) && mode === "plan";
}

export function isPlannerSession(summary: Pick<SessionSummary, "adapterId">): boolean {
  return summary.adapterId === PLANNER_ADAPTER_ID;
}

export function shouldHandoffPlannerToGrok(
  settings: Settings,
  summary: Pick<SessionSummary, "adapterId">,
): boolean {
  return mixedPlanningReady(settings) && isPlannerSession(summary);
}

/** Grok `/plan` `/goal` prefixes and ACP mode RPCs. Planner ACP is not Grok. */
export function usesGrokControlCommands(
  settings: Settings,
  summary: Pick<SessionSummary, "adapterId"> | undefined,
  mode: TaskMode,
): boolean {
  if (summary && isPlannerSession(summary)) return false;
  if (shouldStartWithPlanner(settings, mode)) return false;
  return true;
}

export function adapterIdForStart(startWithPlanner: boolean): string {
  return startWithPlanner ? PLANNER_ADAPTER_ID : GROK_ADAPTER_ID;
}

export function latestPlanText(blocks: ChatBlock[]): string {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.type === "plan" && "text" in block && block.text.trim()) {
      return block.text.trim();
    }
  }
  return "";
}

export function buildGrokImplementPrompt(planText: string, userText: string): string {
  const approved = userText.trim();
  const plan = planText.trim();
  const header =
    "The following plan was drafted by the configured planner and approved. Implement it now. Do not re-plan unless the plan is impossible.";
  if (!plan) return approved || header;
  return `${header}\n\n<approved_plan>\n${plan}\n</approved_plan>${approved ? `\n\n${approved}` : ""}`;
}
