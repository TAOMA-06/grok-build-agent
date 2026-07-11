export type CommandSource = "desktop" | "acp" | "skill" | "documented";
export type CommandExecution = "local" | "acp" | "cli" | "unsupported";

export type CommandDescriptor = {
  name: `/${string}`;
  aliases: Array<`/${string}`>;
  descriptionKey: string;
  inputHint?: string | null;
  category: "session" | "mode" | "model" | "context" | "tools" | "settings" | "account";
  source: CommandSource;
  execution: CommandExecution;
  available: boolean;
  unavailableReasonKey?: string | null;
};

export type ParsedSlashCommand = {
  descriptor: CommandDescriptor;
  invokedAs: `/${string}`;
  args: string;
};
