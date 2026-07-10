/**
 * Lightweight journey tests (T14) for UI contracts and pure helpers.
 * Full Tauri+mock agent journeys live in Rust `e2e_mock` tests.
 */
import { describe, expect, it } from "vitest";
import {
  buildPermissionPrompt,
  extractPermissionOptions,
  isInternalServerMethod,
  isPermissionMethod,
} from "../contracts";
import { t } from "../i18n/en";
import type { ServerRequest } from "../types";

describe("T14 mock user journeys (unit layer)", () => {
  it("fresh session permission options never invent allow-once", () => {
    const req: ServerRequest = {
      id: 1,
      method: "session/request_permission",
      params: {
        options: [
          { optionId: "yes-please", name: "Allow", kind: "allow_once" },
          { optionId: "nope", name: "Deny", kind: "reject_once" },
        ],
      },
    };
    const prompt = buildPermissionPrompt({
      request: req,
      connectionId: "c1",
    });
    expect(prompt?.options.map((o) => o.optionId)).toEqual([
      "yes-please",
      "nope",
    ]);
    expect(extractPermissionOptions({})).toEqual([]);
  });

  it("fs/terminal are internal; unknown is not permission", () => {
    expect(isInternalServerMethod("fs/read_text_file")).toBe(true);
    expect(isInternalServerMethod("terminal/create")).toBe(true);
    expect(isPermissionMethod("x.ai/custom")).toBe(false);
  });

  it("plan approve copy is centralized for UI", () => {
    expect(t.approvePlan.length).toBeGreaterThan(0);
    expect(t.planApproved.toLowerCase()).toContain("plan");
    expect(t.installCliHint.toLowerCase()).toContain("official");
  });

  it("onboarding and plugin strings exist (no blank hardcodes required)", () => {
    for (const key of [
      "loginOauth",
      "installCli",
      "plugins",
      "mcp",
      "cancelRun",
      "checkUpdate",
    ] as const) {
      expect(String(t[key]).length).toBeGreaterThan(0);
    }
  });
});
