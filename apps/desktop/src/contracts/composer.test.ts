import { describe, expect, it } from "vitest";
import {
  buildPromptContent,
  emptyComposerDraft,
  validateAttachments,
} from "./composer";
import { connectionKeyString } from "./runtime";

describe("ComposerDraft", () => {
  it("creates an independent provisional draft", () => {
    const d = emptyComposerDraft("grok-4.5");
    expect(d.text).toBe("");
    expect(d.attachments).toEqual([]);
    expect(d.modelId).toBe("grok-4.5");
  });

  it("enforces attachment count, type, and file-size limits", () => {
    const valid = {
      id: "text",
      source: "inline" as const,
      kind: "file" as const,
      name: "notes.md",
      mimeType: "text/plain",
      textContent: "hello",
      sizeBytes: 5,
    };
    expect(validateAttachments([valid])).toBeNull();
    expect(validateAttachments(Array.from({ length: 11 }, (_, index) => ({ ...valid, id: String(index) })))?.code).toBe("too_many_files");
    expect(validateAttachments([{ ...valid, name: "archive.zip", mimeType: "application/zip" }])?.code).toBe("unsupported_type");
    expect(validateAttachments([{ ...valid, sizeBytes: 1024 * 1024 + 1 }])?.code).toBe("file_too_large");
  });

  it("builds ACP prompt content from text and attachments", () => {
    const blocks = buildPromptContent("hello", [
      {
        id: "a1",
        source: "inline",
        kind: "image",
        name: "shot.png",
        mimeType: "image/png",
        dataBase64: "abc",
      },
      {
        id: "a2",
        source: "inline",
        kind: "file",
        name: "notes.md",
        mimeType: "text/markdown",
        textContent: "notes",
      },
    ]);
    expect(blocks[0]).toEqual({ type: "text", text: "hello" });
    expect(blocks[1]).toMatchObject({ type: "image", data: "abc" });
    expect(blocks[2]).toMatchObject({
      type: "resource",
      resource: { text: "notes" },
    });
  });
});

describe("ConnectionKey model segment", () => {
  it("includes model id so processes do not cross models", () => {
    expect(
      connectionKeyString({
        workspaceRoot: "/repo",
        sandbox: "workspace",
        alwaysApprove: false,
        powerProfile: null,
        modelId: "grok-4.5",
      }),
    ).toBe("/repo::workspace::off::ask::grok-4.5");
    expect(
      connectionKeyString({
        workspaceRoot: "/repo",
        sandbox: "workspace",
        alwaysApprove: true,
        powerProfile: null,
      }),
    ).toBe("/repo::workspace::off::approve::default");
  });
});
