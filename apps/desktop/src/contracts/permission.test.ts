import { describe, expect, it } from "vitest";
import {
  buildPermissionPrompt,
  extractPermissionOptions,
  isInternalServerMethod,
  isPermissionMethod,
} from "./permission";
import type { ServerRequest } from "./events";

describe("permission contracts", () => {
  it("detects permission methods and rejects internal fs/terminal", () => {
    expect(isPermissionMethod("session/request_permission")).toBe(true);
    expect(isPermissionMethod("session/requestPermission")).toBe(true);
    expect(isInternalServerMethod("fs/read_text_file")).toBe(true);
    expect(isInternalServerMethod("terminal/create")).toBe(true);
    expect(isPermissionMethod("fs/read_text_file")).toBe(false);
  });

  it("extracts option IDs from the agent only (no hardcoded allow-once)", () => {
    const options = extractPermissionOptions({
      options: [
        { optionId: "allow-this-session", name: "Allow this session", kind: "allow_always" },
        { optionId: "deny", name: "Deny", kind: "reject_once" },
      ],
    });
    expect(options).toHaveLength(2);
    expect(options[0].optionId).toBe("allow-this-session");
    expect(options.map((o) => o.optionId)).not.toContain("allow-once");
  });

  it("returns empty options when agent omits them", () => {
    expect(extractPermissionOptions({})).toEqual([]);
    expect(extractPermissionOptions(null)).toEqual([]);
  });

  it("builds PermissionPrompt from a real server request shape", () => {
    const request: ServerRequest = {
      jsonrpc: "2.0",
      id: 7,
      method: "session/request_permission",
      params: {
        options: [
          { optionId: "opt-a", name: "Allow once", kind: "allow_once" },
        ],
        toolCall: { toolCallId: "tc-1", title: "Write file" },
      },
    };
    const prompt = buildPermissionPrompt({
      request,
      connectionId: "conn-1",
      sessionId: "sess-1",
      receivedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(prompt).not.toBeNull();
    expect(prompt!.requestId).toBe(7);
    expect(prompt!.options[0].optionId).toBe("opt-a");
    expect(prompt!.toolCallId).toBe("tc-1");
  });

  it("does not treat unknown methods as permission prompts", () => {
    const request: ServerRequest = {
      id: 1,
      method: "x.ai/custom_probe",
      params: {},
    };
    expect(
      buildPermissionPrompt({ request, connectionId: "c1" }),
    ).toBeNull();
  });
});
