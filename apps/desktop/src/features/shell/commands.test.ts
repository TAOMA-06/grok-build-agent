import { describe, expect, it } from "vitest";
import { buildCommandCatalog, parseSlashCommand } from "./commands";

describe("slash command catalog", () => {
  it("keeps desktop commands authoritative and preserves arguments verbatim", () => {
    const catalog = buildCommandCatalog([
      { name: "plan", description: "Remote plan", input: null },
    ], []);
    const parsed = parseSlashCommand("/plan  preserve  quoted \"text\"", catalog);
    expect(parsed?.descriptor.source).toBe("desktop");
    expect(parsed?.args).toBe("preserve  quoted \"text\"");
  });

  it("resolves aliases and exposes Goal before a session exists", () => {
    const catalog = buildCommandCatalog([], []);
    expect(parseSlashCommand("/clear", catalog)?.descriptor.name).toBe("/new");
    expect(parseSlashCommand("/m grok-build", catalog)?.descriptor.name).toBe("/model");
    expect(parseSlashCommand("/goal ship the release", catalog)?.descriptor.available).toBe(true);
    expect(parseSlashCommand("/context", catalog)?.descriptor).toMatchObject({
      source: "documented",
      execution: "acp",
      available: true,
    });
  });

  it("adds ACP commands and enabled skills without shadowing native commands", () => {
    const catalog = buildCommandCatalog(
      [{ name: "/context", description: "Inspect context", input: { hint: "[detail]" } }],
      [{ id: "review", name: "Review", description: "Review changes", source: "project", enabled: true }],
    );
    expect(parseSlashCommand("/context full", catalog)?.descriptor).toMatchObject({ source: "acp", execution: "acp" });
    expect(parseSlashCommand("/review", catalog)?.descriptor).toMatchObject({ source: "skill", execution: "acp" });
  });

  it("uses the live ACP Vim command when the CLI advertises it", () => {
    const catalog = buildCommandCatalog([
      { name: "/vim-mode", description: "Toggle Vim navigation", input: null },
    ], []);
    expect(parseSlashCommand("/vim-mode", catalog)?.descriptor).toMatchObject({
      source: "acp",
      execution: "acp",
      available: true,
    });
  });

  it("scopes a skill that conflicts with a desktop command", () => {
    const catalog = buildCommandCatalog([], [
      { id: "plan", name: "Plan skill", description: "Custom planner", source: "project", enabled: true },
    ]);
    expect(parseSlashCommand("/plan", catalog)?.descriptor.source).toBe("desktop");
    expect(parseSlashCommand("/project:plan", catalog)?.descriptor.source).toBe("skill");
  });

  it("marks TUI-only commands unavailable instead of treating them as prompts", () => {
    const catalog = buildCommandCatalog([], []);
    expect(parseSlashCommand("/share", catalog)?.descriptor).toMatchObject({ available: false, execution: "unsupported" });
    expect(parseSlashCommand("/does-not-exist", catalog)).toBeNull();
  });
});
