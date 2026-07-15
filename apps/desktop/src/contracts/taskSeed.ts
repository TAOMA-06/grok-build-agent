/**
 * Heuristics for seeding a useful TaskDefinition on the first durable turn.
 */

export type SeededTaskFields = {
  goal: string;
  constraints: string[];
  acceptance: string[];
  allowedPaths: string[];
  verificationCommands: string[];
};

/** First non-empty line, capped for contract budget. */
export function titleizeGoal(prompt: string, maxChars = 200): string {
  const line =
    prompt
      .split(/\r?\n/)
      .map((part) => part.trim())
      .find((part) => part.length > 0) ?? prompt.trim();
  const cleaned = line.replace(/^\/(?:goal|plan)\s+/i, "").trim() || prompt.trim();
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, maxChars - 1)}…`;
}

/**
 * Infer default verification commands from workspace root markers.
 * Browser/mock callers can pass an empty set of marker basenames.
 */
export function inferVerificationCommands(markerNames: string[]): string[] {
  const names = new Set(markerNames.map((name) => name.toLowerCase()));
  const commands: string[] = [];

  if (names.has("package.json")) {
    // Prefer lightweight project scripts when present; callers may refine later.
    commands.push("npm test");
  }
  if (names.has("cargo.toml")) {
    commands.push("cargo test");
  }
  if (names.has("go.mod")) {
    commands.push("go test ./...");
  }
  if (
    names.has("pyproject.toml") ||
    names.has("pytest.ini") ||
    names.has("setup.py") ||
    names.has("requirements.txt")
  ) {
    commands.push("pytest");
  }
  if (
    names.has("package.swift") ||
    [...names].some((name) => name.endsWith(".xcodeproj") || name.endsWith(".xcworkspace"))
  ) {
    commands.push("xcodebuild -quiet build");
  }

  // Dedupe while preserving order.
  return [...new Set(commands)];
}

export function defaultAcceptance(hasVerification: boolean): string[] {
  if (hasVerification) {
    return [
      "Declared verification commands pass",
      "No unrelated files changed",
    ];
  }
  return [
    "Requested behavior works as specified",
    "Run project checks before claiming done",
  ];
}

export function seedTaskFromPrompt(
  prompt: string,
  options?: {
    markerNames?: string[];
    existing?: Partial<SeededTaskFields>;
  },
): SeededTaskFields {
  const existing = options?.existing ?? {};
  const goal = existing.goal?.trim() || titleizeGoal(prompt);
  const verificationCommands =
    existing.verificationCommands && existing.verificationCommands.length > 0
      ? existing.verificationCommands
      : inferVerificationCommands(options?.markerNames ?? []);
  const acceptance =
    existing.acceptance && existing.acceptance.length > 0
      ? existing.acceptance
      : defaultAcceptance(verificationCommands.length > 0);
  const constraints = existing.constraints ?? [];
  const allowedPaths =
    existing.allowedPaths && existing.allowedPaths.length > 0
      ? existing.allowedPaths
      : ["."];

  // Keep full prompt as a soft constraint when it is longer than the goal title.
  const full = prompt.trim();
  const nextConstraints = [...constraints];
  if (full && full !== goal && !nextConstraints.some((item) => item.includes(full.slice(0, 80)))) {
    nextConstraints.unshift(`User request: ${full.length > 500 ? `${full.slice(0, 499)}…` : full}`);
  }

  return {
    goal,
    constraints: nextConstraints,
    acceptance,
    allowedPaths,
    verificationCommands,
  };
}
