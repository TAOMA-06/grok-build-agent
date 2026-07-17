import type {
  AvailableCommand,
  CapabilityItem,
  CommandDescriptor,
  ParsedSlashCommand,
} from "../../types";

type CommandSeed = Omit<CommandDescriptor, "source" | "available"> & {
  available?: boolean;
};

function local(seed: CommandSeed): CommandDescriptor {
  return { ...seed, source: "desktop", available: seed.available ?? true };
}

function unsupported(name: `/${string}`, aliases: Array<`/${string}`> = []): CommandDescriptor {
  return {
    name,
    aliases,
    descriptionKey: name.slice(1),
    category: "tools",
    source: "documented",
    execution: "unsupported",
    available: false,
    unavailableReasonKey: "tuiOnly",
  };
}

export const DESKTOP_COMMANDS: CommandDescriptor[] = [
  local({ name: "/quit", aliases: ["/exit"], descriptionKey: "quit", category: "session", execution: "local" }),
  local({ name: "/help", aliases: [], descriptionKey: "help", category: "session", execution: "local" }),
  local({ name: "/home", aliases: [], descriptionKey: "home", category: "session", execution: "local" }),
  local({ name: "/new", aliases: ["/clear"], descriptionKey: "new", category: "session", execution: "local" }),
  local({ name: "/resume", aliases: ["/sessions"], descriptionKey: "sessions", category: "session", execution: "local" }),
  local({ name: "/rename", aliases: ["/title"], descriptionKey: "rename", inputHint: "<title>", category: "session", execution: "local" }),
  local({ name: "/copy", aliases: [], descriptionKey: "copy", inputHint: "[N]", category: "session", execution: "local" }),
  local({ name: "/find", aliases: [], descriptionKey: "find", inputHint: "<text>", category: "session", execution: "local" }),
  local({ name: "/transcript", aliases: [], descriptionKey: "transcript", category: "session", execution: "local" }),
  local({ name: "/model", aliases: ["/m"], descriptionKey: "model", inputHint: "[name]", category: "model", execution: "local" }),
  local({ name: "/effort", aliases: [], descriptionKey: "effort", inputHint: "[level]", category: "model", execution: "local" }),
  local({ name: "/agent", aliases: [], descriptionKey: "agent", category: "mode", execution: "local" }),
  local({ name: "/plan", aliases: [], descriptionKey: "plan", inputHint: "[description]", category: "mode", execution: "local" }),
  local({ name: "/goal", aliases: [], descriptionKey: "goal", inputHint: "<objective>", category: "mode", execution: "local" }),
  local({ name: "/view-plan", aliases: [], descriptionKey: "view-plan", category: "mode", execution: "local" }),
  local({ name: "/settings", aliases: ["/config"], descriptionKey: "settings", category: "settings", execution: "local" }),
  local({ name: "/theme", aliases: ["/t"], descriptionKey: "theme", inputHint: "[light|dark|system]", category: "settings", execution: "local" }),
  local({ name: "/compact-mode", aliases: [], descriptionKey: "compact-mode", category: "settings", execution: "local" }),
  local({ name: "/multiline", aliases: ["/ml"], descriptionKey: "multiline", category: "settings", execution: "local" }),
  local({ name: "/timestamps", aliases: [], descriptionKey: "timestamps", category: "settings", execution: "local" }),
  local({ name: "/tasks", aliases: [], descriptionKey: "tasks", category: "tools", execution: "local" }),
  local({ name: "/hooks", aliases: [], descriptionKey: "hooks", category: "tools", execution: "local" }),
  local({ name: "/plugins", aliases: [], descriptionKey: "plugins", category: "tools", execution: "local" }),
  local({ name: "/marketplace", aliases: [], descriptionKey: "marketplace", category: "tools", execution: "local" }),
  local({ name: "/skills", aliases: [], descriptionKey: "skills", category: "tools", execution: "local" }),
  local({ name: "/mcps", aliases: ["/mcp"], descriptionKey: "mcps", category: "tools", execution: "local" }),
  local({ name: "/diff", aliases: [], descriptionKey: "diff", category: "tools", execution: "local" }),
  local({ name: "/export", aliases: [], descriptionKey: "export", category: "session", execution: "cli" }),
  unsupported("/import-claude"),
  local({ name: "/dashboard", aliases: ["/agents-dashboard"], descriptionKey: "dashboard", category: "session", execution: "local" }),
  local({ name: "/login", aliases: [], descriptionKey: "login", category: "account", execution: "cli" }),
  local({ name: "/logout", aliases: [], descriptionKey: "logout", category: "account", execution: "cli" }),
];

const DOCUMENTED_ACP_COMMANDS: CommandDescriptor[] = [
  { name: "/compact", aliases: [], descriptionKey: "compact", category: "context", source: "documented", execution: "acp", available: true },
  { name: "/always-approve", aliases: [], descriptionKey: "always-approve", category: "settings", source: "documented", execution: "acp", available: true },
  { name: "/context", aliases: [], descriptionKey: "context", category: "context", source: "documented", execution: "acp", available: true },
  { name: "/session-info", aliases: [], descriptionKey: "session-info", category: "session", source: "documented", execution: "acp", available: true },
];

const DOCUMENTED_UNSUPPORTED = [
  "/share", "/btw", "/loop", "/queue", "/vim-mode", "/terminal-setup",
  "/config-agents", "/personas", "/feedback", "/usage", "/privacy",
] as const;

const CAPABILITY_GATED = [
  "/fork", "/rewind", "/imagine", "/imagine-video", "/remember", "/memory", "/dream",
] as const;

function normalizeCommandName(name: string): `/${string}` {
  return (name.startsWith("/") ? name : `/${name}`) as `/${string}`;
}

export function buildCommandCatalog(
  liveCommands: AvailableCommand[],
  skills: CapabilityItem[],
): CommandDescriptor[] {
  const catalog = new Map<string, CommandDescriptor>();
  for (const descriptor of DESKTOP_COMMANDS) catalog.set(descriptor.name, descriptor);
  for (const descriptor of DOCUMENTED_ACP_COMMANDS) catalog.set(descriptor.name, descriptor);

  const addRemote = (
    name: string,
    description: string | null | undefined,
    source: "acp" | "skill",
    input?: unknown,
  ) => {
    const normalized = normalizeCommandName(name);
    const existing = catalog.get(normalized);
    if (existing && !(source === "acp" && existing.source === "documented")) return;
    const hint = input && typeof input === "object" && "hint" in input
      ? String((input as { hint?: unknown }).hint ?? "") || null
      : null;
    catalog.set(normalized, {
      name: normalized,
      aliases: [],
      descriptionKey: description || normalized.slice(1),
      inputHint: hint,
      category: source === "skill" ? "tools" : "context",
      source,
      execution: "acp",
      available: true,
    });
  };

  for (const command of liveCommands) {
    addRemote(command.name, command.description, "acp", command.input);
  }
  for (const skill of skills.filter((item) => item.enabled !== false)) {
    const requested = normalizeCommandName(skill.id || skill.name);
    if (catalog.has(requested)) {
      const scope = (skill.source || "skill").replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
      addRemote(`/${scope}:${requested.slice(1)}`, skill.description, "skill");
    } else {
      addRemote(requested, skill.description, "skill");
    }
  }

  for (const name of CAPABILITY_GATED) {
    if (!catalog.has(name)) catalog.set(name, unsupported(name));
  }
  if (!catalog.has("/mem") && catalog.has("/memory")) {
    const memory = catalog.get("/memory")!;
    catalog.set("/memory", { ...memory, aliases: [...memory.aliases, "/mem"] });
  }
  for (const name of DOCUMENTED_UNSUPPORTED) {
    if (!catalog.has(name)) catalog.set(name, unsupported(name));
  }
  if (!catalog.has("/agents")) {
    const configAgents = catalog.get("/config-agents");
    if (configAgents) catalog.set("/config-agents", { ...configAgents, aliases: ["/agents"] });
  }

  return [...catalog.values()].sort((left, right) => {
    if (left.available !== right.available) return left.available ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

export function parseSlashCommand(
  input: string,
  catalog: CommandDescriptor[],
): ParsedSlashCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const space = trimmed.search(/\s/);
  const invokedAs = (space === -1 ? trimmed : trimmed.slice(0, space)).toLowerCase() as `/${string}`;
  const args = space === -1 ? "" : trimmed.slice(space).trimStart();
  const descriptor = catalog.find(
    (item) => item.name === invokedAs || item.aliases.includes(invokedAs),
  );
  return descriptor ? { descriptor, invokedAs, args } : null;
}
