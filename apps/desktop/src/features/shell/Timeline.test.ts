import { describe, expect, it } from "vitest";
import type { ChatBlock } from "../../types";
import { foldDuplicateAssistantReplies } from "./timelineProjection";

describe("foldDuplicateAssistantReplies", () => {
  it("folds identical assistant replays only within the same user turn", () => {
    const blocks: ChatBlock[] = [
      { id: "u1", type: "user", text: "First" },
      { id: "a1", type: "assistant", text: "OK" },
      { id: "t1", type: "thought", text: "checking" },
      { id: "a2", type: "assistant", text: "  OK  " },
      { id: "u2", type: "user", text: "Second" },
      { id: "a3", type: "assistant", text: "OK" },
    ];

    expect(foldDuplicateAssistantReplies(blocks).map((block) => block.id)).toEqual([
      "u1",
      "a1",
      "t1",
      "u2",
      "a3",
    ]);
  });

  it("keeps distinct assistant messages in one turn", () => {
    const blocks: ChatBlock[] = [
      { id: "u1", type: "user", text: "Explain" },
      { id: "a1", type: "assistant", text: "First result" },
      { id: "a2", type: "assistant", text: "Second result" },
    ];

    expect(foldDuplicateAssistantReplies(blocks)).toHaveLength(3);
  });
});
