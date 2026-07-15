import { describe, expect, it } from "vitest";
import { inspectPromptPrivacy, isSensitiveAttachmentName } from "./privacy";

describe("prompt privacy inspection", () => {
  it("detects and redacts common credentials without changing surrounding text", () => {
    const xaiToken = ["xai-", "abcdefghijklmnop"].join("");
    const githubToken = ["ghp_", "1234567890abcdefghijkl"].join("");
    const inspection = inspectPromptPrivacy(
      `Deploy with ${xaiToken} and ${githubToken}.`,
      [],
    );

    expect(inspection.findings.map((finding) => finding.kind)).toEqual([
      "api_key",
      "access_token",
    ]);
    expect(inspection.redactedText).toContain("[REDACTED:API_KEY]");
    expect(inspection.redactedText).toContain("[REDACTED:ACCESS_TOKEN]");
    expect(inspection.redactedText).not.toContain("abcdefghijklmnop");
    expect(inspection.redactedText).toContain("Deploy with");
  });

  it("finds private keys and blocks high-risk attachment names", () => {
    const privateKey = [
      ["-----BEGIN", " PRIVATE KEY-----"].join(""),
      "secret",
      ["-----END", " PRIVATE KEY-----"].join(""),
    ].join("\n");
    const inspection = inspectPromptPrivacy(
      privateKey,
      [{ name: ".env.production" }, { name: "notes.md" }],
    );

    expect(inspection.findings).toEqual([{ kind: "private_key", label: "private key" }]);
    expect(inspection.redactedText).toBe("[REDACTED:PRIVATE_KEY]");
    expect(inspection.blockedAttachmentNames).toEqual([".env.production"]);
    expect(isSensitiveAttachmentName("attachment://upload/id_ed25519")).toBe(true);
    expect(isSensitiveAttachmentName("src/config.ts")).toBe(false);
  });
});
