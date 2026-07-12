/**
 * Composer draft and ACP prompt content contracts.
 * Drafts survive without an active session (provisional → SessionSummary on first send).
 */
import type { TaskMode } from "./mode";

export type AttachmentKind = "image" | "file" | "resource";
export type AttachmentSource = "path" | "inline";

export const ATTACHMENT_LIMITS = {
  maxFiles: 10,
  maxTotalBytes: 20 * 1024 * 1024,
  maxTextBytes: 1024 * 1024,
  maxRichBytes: 10 * 1024 * 1024,
} as const;

export type AttachmentValidationCode =
  | "too_many_files"
  | "total_too_large"
  | "file_too_large"
  | "unsupported_type"
  | "unreadable_file";

export type AttachmentValidationIssue = {
  code: AttachmentValidationCode;
  message: string;
  fileName?: string | null;
};

/** Local attachment staged in the composer (not yet sent). */
export type ComposerAttachment = {
  id: string;
  source: AttachmentSource;
  kind: AttachmentKind;
  name: string;
  mimeType: string;
  /** Absolute path when available (Tauri); never logged for secrets. */
  path?: string | null;
  /** Base64 payload for images (in-memory only until send). */
  dataBase64?: string | null;
  /** UTF-8 content for browser-provided text/code files. */
  textContent?: string | null;
  sizeBytes?: number | null;
};

export type FailedSubmission = {
  messageBlockId: string;
  text: string;
  attachments: ComposerAttachment[];
  mode: TaskMode;
  modelId: string | null;
  error: string;
};

/**
 * ACP `session/prompt` content blocks.
 * Mirrors the ACP PromptContent union used by the host.
 */
export type PromptContent =
  | { type: "text"; text: string }
  | {
      type: "image";
      data: string;
      mimeType: string;
      uri?: string | null;
    }
  | {
      type: "resource";
      resource: {
        uri: string;
        mimeType?: string | null;
        text?: string | null;
        blob?: string | null;
      };
    }
  | {
      type: "resource_link";
      uri: string;
      name?: string | null;
      mimeType?: string | null;
      description?: string | null;
    };

/** Input draft independent of session/connection lifecycle. */
export type ComposerDraft = {
  text: string;
  attachments: ComposerAttachment[];
  /** Session model override while provisional (no active session yet). */
  modelId?: string | null;
  /** Reasoning effort override while provisional. */
  reasoningEffort?: string | null;
  /** Optional slash-command draft prefix (e.g. `/review`). */
  commandHint?: string | null;
  mode: TaskMode;
};

export function emptyComposerDraft(
  modelId?: string | null,
  mode: TaskMode = "agent",
): ComposerDraft {
  return {
    text: "",
    attachments: [],
    modelId: modelId ?? null,
    reasoningEffort: null,
    commandHint: null,
    mode,
  };
}

/** Build ACP prompt content from text + attachments. */
export function buildPromptContent(
  text: string,
  attachments: ComposerAttachment[],
): PromptContent[] {
  const blocks: PromptContent[] = [];
  const trimmed = text.trim();
  if (trimmed) {
    blocks.push({ type: "text", text: trimmed });
  }
  for (const att of attachments) {
    if (att.source === "path") continue;
    if (att.kind === "image" && att.dataBase64) {
      blocks.push({
        type: "image",
        data: att.dataBase64,
        mimeType: att.mimeType || "image/png",
        uri: att.path ? `file://${att.path}` : null,
      });
    } else if (att.textContent != null) {
      blocks.push({
        type: "resource",
        resource: {
          uri: `attachment://${att.id}/${encodeURIComponent(att.name)}`,
          mimeType: att.mimeType || "text/plain",
          text: att.textContent,
        },
      });
    } else if (att.dataBase64) {
      blocks.push({
        type: "resource",
        resource: {
          uri: `attachment://${att.id}/${encodeURIComponent(att.name)}`,
          mimeType: att.mimeType || null,
          blob: att.dataBase64,
        },
      });
    }
  }
  if (blocks.length === 0) {
    blocks.push({ type: "text", text: "" });
  }
  return blocks;
}

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "mdx", "json", "jsonl", "yaml", "yml", "toml", "xml",
  "csv", "tsv", "js", "jsx", "ts", "tsx", "css", "scss", "html", "htm",
  "py", "rs", "go", "java", "kt", "swift", "c", "h", "cpp", "hpp", "sh",
  "zsh", "bash", "sql", "graphql", "gql", "ini", "conf", "log",
]);

export function inferAttachmentMime(name: string, declared = ""): string | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "pdf") return "application/pdf";
  if (TEXT_EXTENSIONS.has(ext) || declared.startsWith("text/")) {
    return declared.startsWith("text/") ? declared : "text/plain";
  }
  return null;
}

export function validateAttachments(
  attachments: readonly ComposerAttachment[],
): AttachmentValidationIssue | null {
  if (attachments.length > ATTACHMENT_LIMITS.maxFiles) {
    return {
      code: "too_many_files",
      message: `Attach at most ${ATTACHMENT_LIMITS.maxFiles} files.`,
    };
  }
  let total = 0;
  for (const attachment of attachments) {
    const mime = inferAttachmentMime(attachment.name, attachment.mimeType);
    if (!mime) {
      return {
        code: "unsupported_type",
        fileName: attachment.name,
        message: `${attachment.name} is not a supported text, image, or PDF file.`,
      };
    }
    const size = attachment.sizeBytes ?? 0;
    const limit = mime.startsWith("text/")
      ? ATTACHMENT_LIMITS.maxTextBytes
      : ATTACHMENT_LIMITS.maxRichBytes;
    if (size > limit) {
      return {
        code: "file_too_large",
        fileName: attachment.name,
        message: `${attachment.name} exceeds the ${mime.startsWith("text/") ? "1 MB" : "10 MB"} limit.`,
      };
    }
    total += size;
  }
  if (total > ATTACHMENT_LIMITS.maxTotalBytes) {
    return {
      code: "total_too_large",
      message: "Attachments exceed the 20 MB total limit.",
    };
  }
  return null;
}
