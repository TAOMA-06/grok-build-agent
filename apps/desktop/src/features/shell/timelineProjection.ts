import type { ChatBlock } from "../../types";

export function foldDuplicateAssistantReplies(blocks: ChatBlock[]): ChatBlock[] {
  const seenInTurn = new Set<string>();
  const visible: ChatBlock[] = [];

  for (const block of blocks) {
    if (block.type === "user") {
      seenInTurn.clear();
      visible.push(block);
      continue;
    }
    if (block.type !== "assistant") {
      visible.push(block);
      continue;
    }

    const normalized = block.text.replace(/\s+/g, " ").trim();
    if (normalized && seenInTurn.has(normalized)) continue;
    if (normalized) seenInTurn.add(normalized);
    visible.push(block);
  }

  return visible;
}
