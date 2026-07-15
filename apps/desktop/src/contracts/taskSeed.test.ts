import { describe, expect, it } from "vitest";
import {
  defaultAcceptance,
  inferVerificationCommands,
  seedTaskFromPrompt,
  titleizeGoal,
} from "./taskSeed";

describe("taskSeed", () => {
  it("titleizes multi-line prompts", () => {
    expect(titleizeGoal("/goal Fix the login bug\n\nMore detail")).toBe("Fix the login bug");
  });

  it("infers verification from manifests", () => {
    expect(inferVerificationCommands(["package.json", "Cargo.toml"])).toEqual([
      "npm test",
      "cargo test",
    ]);
  });

  it("seeds durable defaults without wiping existing fields", () => {
    const seeded = seedTaskFromPrompt("Implement caching for the API", {
      markerNames: ["Cargo.toml"],
      existing: { acceptance: ["Custom done"] },
    });
    expect(seeded.goal).toBe("Implement caching for the API");
    expect(seeded.verificationCommands).toEqual(["cargo test"]);
    expect(seeded.acceptance).toEqual(["Custom done"]);
    expect(seeded.allowedPaths).toEqual(["."]);
  });

  it("uses softer acceptance when no verification is known", () => {
    expect(defaultAcceptance(false)[1]).toMatch(/project checks/i);
  });
});
