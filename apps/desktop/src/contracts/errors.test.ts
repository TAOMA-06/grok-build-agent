import { describe, expect, it } from "vitest";
import { describeError, errorMessage } from "./errors";

describe("runtime error descriptions", () => {
  it("preserves the concrete failure while identifying DNS/network errors", () => {
    const failure = describeError(new Error(
      "dns error: failed to lookup address information: nodename nor servname provided",
    ));
    expect(failure).toEqual({
      category: "network",
      message: "dns error: failed to lookup address information: nodename nor servname provided",
    });
  });

  it("distinguishes workspace permission and runtime lookup failures", () => {
    expect(describeError("EACCES: permission denied, open '/workspace/file.ts'").category)
      .toBe("permission");
    expect(describeError("unsafe workspace path").category).toBe("workspace");
    expect(describeError("ENOENT: no such file or directory, grok").category).toBe("runtime");
  });

  it("removes noisy Error prefixes without hiding the underlying detail", () => {
    expect(errorMessage("InvokeError: Error: request timed out")).toBe("request timed out");
    expect(describeError("InvokeError: Error: request timed out").category).toBe("timeout");
  });
});
