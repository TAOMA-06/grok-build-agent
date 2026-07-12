import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyComposerDraft } from "../../contracts";
import { DesktopBridgeContext } from "../../platform/DesktopBridge";
import { mockDesktopBridge } from "../../platform/mockBridge";
import { defaultSettings, useAppStore } from "../../store";
import { CommandComposer, browserAttachment, STOP_ARM_MS } from "./CommandComposer";

function renderComposer(overrides?: {
  onSend?: ReturnType<typeof vi.fn>;
  onLocalCommand?: ReturnType<typeof vi.fn>;
  onChooseMode?: ReturnType<typeof vi.fn>;
  onCancel?: ReturnType<typeof vi.fn>;
  busy?: boolean;
  connecting?: boolean;
}) {
  const onSend = overrides?.onSend ?? vi.fn().mockResolvedValue(undefined);
  const onLocalCommand = overrides?.onLocalCommand ?? vi.fn();
  const onCancel = overrides?.onCancel ?? vi.fn().mockResolvedValue(undefined);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <DesktopBridgeContext.Provider value={mockDesktopBridge}>
      <QueryClientProvider client={queryClient}>
        <CommandComposer
          models={[{ id: "grok-build", name: "Grok Build", isDefault: true }]}
          busy={overrides?.busy ?? false}
          connecting={overrides?.connecting ?? false}
          onSend={onSend}
          onCancel={onCancel}
          onChooseModel={vi.fn().mockResolvedValue(undefined)}
          onChooseEffort={vi.fn().mockResolvedValue(undefined)}
          onChooseMode={overrides?.onChooseMode ?? vi.fn().mockImplementation(async (mode) => ({
            kind: "switched",
            state: { currentMode: mode, availableModes: [], liveSwitchSupported: false, source: "desktop" },
          }))}
          onLocalCommand={onLocalCommand}
        />
      </QueryClientProvider>
    </DesktopBridgeContext.Provider>,
  );
  return { onSend, onLocalCommand, onCancel };
}

describe("CommandComposer", () => {
  beforeEach(() => {
    useAppStore.setState({
      activeSessionId: null,
      sessions: {},
      sessionOrder: [],
      settings: { ...defaultSettings(), onboardingDone: true },
      provisionalDraft: emptyComposerDraft("grok-build"),
    });
  });

  it("keeps a provisional draft editable and does not submit during IME composition", async () => {
    const { onSend } = renderComposer();
    const textarea = screen.getByRole("textbox", { name: "Message Grok" });
    fireEvent.change(textarea, { target: { value: "中文" } });
    expect(textarea).toHaveValue("中文");
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: false });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("中文", [], "agent"));
  });

  it("does not submit on the Enter that confirms IME composition", async () => {
    const { onSend } = renderComposer();
    const textarea = screen.getByRole("textbox", { name: "Message Grok" });
    fireEvent.change(textarea, { target: { value: "做个简单的测试计划，我看一下grok" } });
    fireEvent.compositionStart(textarea);
    fireEvent.compositionEnd(textarea);
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: false });
    expect(onSend).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 320));
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: false });
    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("做个简单的测试计划，我看一下grok", [], "agent");
    });
  });

  it("delays Stop so an immediate re-click cannot cancel the send that just started", async () => {
    vi.useFakeTimers();
    const onCancel = vi.fn().mockResolvedValue(undefined);
    renderComposer({ busy: true, onCancel });
    expect(screen.queryByRole("button", { name: "Stop Grok" })).toBeNull();
    expect(screen.getByRole("button", { name: "Send to Grok" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Send to Grok" }));
    expect(onCancel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(STOP_ARM_MS);
    fireEvent.click(screen.getByRole("button", { name: "Stop Grok" }));
    expect(onCancel).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("shows Stop while busy and invokes onCancel", async () => {
    vi.useFakeTimers();
    const onCancel = vi.fn().mockResolvedValue(undefined);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <DesktopBridgeContext.Provider value={mockDesktopBridge}>
        <QueryClientProvider client={queryClient}>
          <CommandComposer
            models={[{ id: "grok-build", name: "Grok Build", isDefault: true }]}
            busy
            connecting={false}
            onSend={vi.fn().mockResolvedValue(undefined)}
            onCancel={onCancel}
            onChooseModel={vi.fn().mockResolvedValue(undefined)}
            onChooseEffort={vi.fn().mockResolvedValue(undefined)}
            onChooseMode={vi.fn().mockImplementation(async (mode) => ({
              kind: "switched",
              state: { currentMode: mode, availableModes: [], liveSwitchSupported: false, source: "desktop" },
            }))}
            onLocalCommand={vi.fn()}
          />
        </QueryClientProvider>
      </DesktopBridgeContext.Provider>,
    );
    await vi.advanceTimersByTimeAsync(STOP_ARM_MS);
    fireEvent.click(screen.getByRole("button", { name: "Stop Grok" }));
    expect(onCancel).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("executes local slash commands without sending them to Grok", async () => {
    const { onSend, onLocalCommand } = renderComposer();
    const textarea = screen.getByRole("textbox", { name: "Message Grok" });
    fireEvent.change(textarea, { target: { value: "/settings" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() => expect(onLocalCommand).toHaveBeenCalledWith("/settings"));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("keeps composer focus when slash suggestions open", async () => {
    renderComposer();
    const textarea = screen.getByRole("textbox", { name: "Message Grok" });
    textarea.focus();
    fireEvent.change(textarea, { target: { value: "/plan" } });
    await screen.findByRole("button", { name: /\/plan/i });
    expect(textarea).toHaveFocus();
  });

  it("executes Plan and Goal commands through task modes", async () => {
    const onChooseMode = vi.fn().mockImplementation(async (mode) => ({
      kind: "switched",
      state: { currentMode: mode, availableModes: [], liveSwitchSupported: false, source: "desktop" },
    }));
    const { onSend } = renderComposer({ onChooseMode });
    const textarea = screen.getByRole("textbox", { name: "Message Grok" });
    fireEvent.change(textarea, { target: { value: "/plan inspect the architecture" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("inspect the architecture", [], "plan"));
    fireEvent.change(textarea, { target: { value: "/goal finish the release" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("finish the release", [], "goal"));
  });

  it("switches mode from the visible task mode menu", async () => {
    const user = userEvent.setup();
    const onChooseMode = vi.fn().mockImplementation(async (mode) => ({
      kind: "switched",
      state: { currentMode: mode, availableModes: [], liveSwitchSupported: false, source: "desktop" },
    }));
    renderComposer({ onChooseMode });
    await user.click(screen.getByRole("button", { name: /Agent/i }));
    await user.click(screen.getByRole("menuitem", { name: /Plan/i }));
    expect(onChooseMode).toHaveBeenCalledWith("plan");
  });

  it("uses /clear to create a new task and rejects unknown or unavailable commands", async () => {
    const { onSend, onLocalCommand } = renderComposer();
    const textarea = screen.getByRole("textbox", { name: "Message Grok" });
    fireEvent.change(textarea, { target: { value: "/clear" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() => expect(onLocalCommand).toHaveBeenCalledWith("/clear"));
    fireEvent.change(textarea, { target: { value: "/made-up" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Unknown command");
    fireEvent.click(screen.getByRole("button", { name: "Send as a normal message" }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("/made-up", [], "agent"));
    fireEvent.change(textarea, { target: { value: "/share" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Grok TUI");
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported browser attachments", async () => {
    const file = new File(["zip"], "archive.zip", { type: "application/zip" });
    await expect(browserAttachment(file)).rejects.toThrow("not a supported");
  });

  it("locks model and runtime controls while Grok is generating", () => {
    renderComposer({ busy: true });
    expect(screen.getByRole("button", { name: /Grok Build/i })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Task sandbox" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Task permissions" })).toBeDisabled();
  });
});
