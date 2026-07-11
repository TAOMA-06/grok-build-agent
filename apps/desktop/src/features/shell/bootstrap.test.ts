import { describe, expect, it } from "vitest";
import type { RuntimeHealth } from "../../types";
import { bootstrapStateFromHealth } from "./bootstrap";

function health(found: boolean, authenticated: boolean): RuntimeHealth {
  return {
    grok: { found },
    authenticated,
    ready: found && authenticated,
    checklist: [],
  };
}

describe("bootstrapStateFromHealth", () => {
  it("requests CLI installation before authentication", () => {
    expect(bootstrapStateFromHealth(health(false, false)).status).toBe("needs_cli");
  });

  it("requests authentication when the CLI is installed", () => {
    expect(bootstrapStateFromHealth(health(true, false)).status).toBe("needs_auth");
  });

  it("enters the shell when the runtime is ready", () => {
    expect(bootstrapStateFromHealth(health(true, true)).status).toBe("ready");
  });
});
