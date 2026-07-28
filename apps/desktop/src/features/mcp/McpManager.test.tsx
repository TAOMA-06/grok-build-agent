import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DesktopBridge } from "../../platform/DesktopBridge";
import { DesktopBridgeContext } from "../../platform/DesktopBridge";
import { mockDesktopBridge } from "../../platform/mockBridge";
import type { McpServerInfo } from "../../types";
import { ArgListEditor, McpManager } from "./McpManager";

describe("ArgListEditor", () => {
  it("preserves spaces inside one argv item and can reorder it", () => {
    const onChange = vi.fn();
    render(<ArgListEditor args={["argument with spaces", "--flag"]} onChange={onChange} />);
    expect(screen.getByRole("textbox", { name: "Argument 1" })).toHaveValue("argument with spaces");
    fireEvent.click(screen.getAllByRole("button", { name: "↓" })[0]!);
    expect(onChange).toHaveBeenCalledWith(["--flag", "argument with spaces"]);
  });
});

describe("McpManager", () => {
  it("shows a calm empty state after loading and opens the create dialog", async () => {
    render(
      <DesktopBridgeContext.Provider value={mockDesktopBridge}>
        <McpManager />
      </DesktopBridgeContext.Provider>,
    );

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(await screen.findByText(/No MCP|没有 MCP/i)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /Add|添加/i })[0]!);
    expect(
      screen.getByRole("dialog", { name: /Add|添加/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Name|名称/i)).toHaveFocus();
  });

  it("uses an in-app confirmation before deleting a server", async () => {
    const server: McpServerInfo = {
      name: "filesystem",
      scope: "user",
      transport: "stdio",
      displayTarget: "npx @modelcontextprotocol/server-filesystem",
      command: "npx",
      args: [],
      envKeys: [],
      headerKeys: [],
    };
    const removeMcpServer = vi.fn().mockResolvedValue("ok");
    const bridge = {
      ...mockDesktopBridge,
      listMcpServers: vi.fn().mockResolvedValue({
        servers: [server],
        userConfigPath: "~/.grok/config.toml",
        projectConfigPath: null,
      }),
      removeMcpServer,
    } as DesktopBridge;

    render(
      <DesktopBridgeContext.Provider value={bridge}>
        <McpManager />
      </DesktopBridgeContext.Provider>,
    );

    await screen.findByText("filesystem");
    fireEvent.click(screen.getByRole("button", { name: /Remove|移除/i }));
    expect(
      screen.getByRole("dialog", { name: /Confirm removal|确认移除/i }),
    ).toBeInTheDocument();
    expect(removeMcpServer).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^Delete$|^删除$/i }));
    await waitFor(() => expect(removeMcpServer).toHaveBeenCalledTimes(1));
  });
});
