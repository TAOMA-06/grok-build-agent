import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./store";

describe("provisional composer draft", () => {
  beforeEach(() => {
    useAppStore.setState({
      activeSessionId: null,
      sessions: {},
      sessionOrder: [],
      provisionalDraft: {
        text: "",
        attachments: [],
        modelId: null,
        commandHint: null,
        mode: "agent",
      },
    });
  });

  it("keeps onChange text without an active session", () => {
    useAppStore.getState().setEffectiveDraftText("draft without session");
    expect(useAppStore.getState().effectiveDraftText()).toBe(
      "draft without session",
    );
    expect(useAppStore.getState().provisionalDraft.text).toBe(
      "draft without session",
    );
  });

  it("migrates model selection on provisional draft", () => {
    useAppStore.getState().setEffectiveModelId("grok-composer-2.5-fast");
    expect(useAppStore.getState().effectiveModelId()).toBe(
      "grok-composer-2.5-fast",
    );
  });
});
