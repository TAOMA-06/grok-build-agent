import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeHealth } from "../../contracts";
import { DesktopBridgeContext, type DesktopBridge } from "../../platform/DesktopBridge";
import { mockDesktopBridge } from "../../platform/mockBridge";
import { BootstrapScreen } from "./BootstrapScreen";

describe("BootstrapScreen", () => {
  it("explains install failures with technical detail, cause, and recovery", async () => {
    const bridge = {
      ...mockDesktopBridge,
      installCli: vi.fn().mockRejectedValue(
        new Error("dns error: failed to lookup api.x.ai"),
      ),
    } as DesktopBridge;

    render(
      <DesktopBridgeContext.Provider value={bridge}>
        <BootstrapScreen
          state={{ status: "needs_cli", health: {} as RuntimeHealth }}
          onRefresh={vi.fn().mockResolvedValue(undefined)}
        />
      </DesktopBridgeContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Install from x\.ai|安装/i }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("dns error: failed to lookup api.x.ai");
    expect(status.textContent).toMatch(/Why|原因/);
    expect(status.textContent).toMatch(/What to do|下一步/);
  });
});
