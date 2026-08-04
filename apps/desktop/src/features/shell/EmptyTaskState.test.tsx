import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { EmptyTaskState } from "./EmptyTaskState";

describe("EmptyTaskState", () => {
  it("starts strength-oriented chips with the matching mode", () => {
    const onSuggest = vi.fn();
    render(<EmptyTaskState onSuggest={onSuggest} />);

    fireEvent.click(screen.getByRole("button", { name: t.chipPlanFirst }));
    expect(onSuggest).toHaveBeenCalledWith(t.chipPlanFirstPrompt, "plan");

    fireEvent.click(screen.getByRole("button", { name: t.chipParallelExplore }));
    expect(onSuggest).toHaveBeenLastCalledWith(t.chipParallelExplorePrompt, "agent");

    fireEvent.click(screen.getByRole("button", { name: t.explainProject }));
    expect(onSuggest).toHaveBeenLastCalledWith(t.explainProjectPrompt, "agent");
  });
});
