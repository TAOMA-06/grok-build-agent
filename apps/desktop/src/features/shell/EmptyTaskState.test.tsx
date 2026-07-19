import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { EmptyTaskState } from "./EmptyTaskState";

describe("EmptyTaskState", () => {
  it("starts the selected suggested task in agent mode", () => {
    const onSuggest = vi.fn();
    render(<EmptyTaskState onSuggest={onSuggest} />);

    fireEvent.click(screen.getByRole("button", { name: t.explainProject }));
    expect(onSuggest).toHaveBeenCalledWith(t.explainProjectPrompt, "agent");

    fireEvent.click(screen.getByRole("button", { name: t.reviewChanges }));
    expect(onSuggest).toHaveBeenLastCalledWith(t.reviewChangesPrompt, "agent");
  });
});
