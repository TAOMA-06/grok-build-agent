import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ArgListEditor } from "./McpManager";

describe("ArgListEditor", () => {
  it("preserves spaces inside one argv item and can reorder it", () => {
    const onChange = vi.fn();
    render(<ArgListEditor args={["argument with spaces", "--flag"]} onChange={onChange} />);
    expect(screen.getByRole("textbox", { name: "Argument 1" })).toHaveValue("argument with spaces");
    fireEvent.click(screen.getAllByRole("button", { name: "↓" })[0]!);
    expect(onChange).toHaveBeenCalledWith(["--flag", "argument with spaces"]);
  });
});
