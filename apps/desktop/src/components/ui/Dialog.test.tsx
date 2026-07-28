import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";

describe("Dialog", () => {
  it("portals an accessible modal and moves focus inside", async () => {
    render(
      <Dialog open title="Connection settings" onClose={() => undefined}>
        <button type="button">Save connection</button>
      </Dialog>,
    );

    const dialog = screen.getByRole("dialog", {
      name: "Connection settings",
    });
    expect(dialog.parentElement).toBe(document.body);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    });
  });

  it("closes from Escape and the explicit close control", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Dialog open title="Connection settings" onClose={onClose}>
        <span>Content</span>
      </Dialog>,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    rerender(
      <Dialog open title="Connection settings" onClose={onClose}>
        <span>Content</span>
      </Dialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
