import type { ComposerAttachment } from "./composer";

export type PrivacyFindingKind =
  | "api_key"
  | "access_token"
  | "private_key";

export type PrivacyFinding = {
  kind: PrivacyFindingKind;
  label: string;
};

export type PromptPrivacyInspection = {
  findings: PrivacyFinding[];
  redactedText: string;
  blockedAttachmentNames: string[];
};

type SecretPattern = {
  kind: PrivacyFindingKind;
  label: string;
  pattern: RegExp;
};

const secretPatterns: SecretPattern[] = [
  {
    kind: "api_key",
    label: "API key",
    pattern: /\b(?:xai-|sk-)[A-Za-z0-9_-]{12,}\b/g,
  },
  {
    kind: "access_token",
    label: "access token",
    pattern: /\b(?:ghp_|github_pat_|glpat-)[A-Za-z0-9_-]{12,}\b/g,
  },
  {
    kind: "access_token",
    label: "cloud credential",
    pattern: /\b(?:AKIA[0-9A-Z]{16}|AIza[A-Za-z0-9_-]{24,})\b/g,
  },
  {
    kind: "access_token",
    label: "JSON web token",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    kind: "private_key",
    label: "private key",
    pattern: /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z]+)? PRIVATE KEY-----/g,
  },
];

const sensitiveAttachmentNames = new Set([
  "credentials",
  "credentials.json",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
  "secrets.json",
  "secrets.yaml",
  "secrets.yml",
]);

export function isSensitiveAttachmentName(name: string): boolean {
  const baseName = name.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  return (
    baseName === ".env" ||
    baseName.startsWith(".env.") ||
    sensitiveAttachmentNames.has(baseName) ||
    /\.(?:kdbx|key|p12|pem|pfx)$/i.test(baseName)
  );
}

export function inspectPromptPrivacy(
  text: string,
  attachments: Pick<ComposerAttachment, "name">[],
): PromptPrivacyInspection {
  const found = new Map<PrivacyFindingKind, PrivacyFinding>();
  let redactedText = text;

  for (const secret of secretPatterns) {
    secret.pattern.lastIndex = 0;
    if (secret.pattern.test(text)) {
      found.set(secret.kind, { kind: secret.kind, label: secret.label });
    }
    secret.pattern.lastIndex = 0;
    redactedText = redactedText.replace(
      secret.pattern,
      `[REDACTED:${secret.kind.toUpperCase()}]`,
    );
  }

  return {
    findings: [...found.values()],
    redactedText,
    blockedAttachmentNames: attachments
      .map((attachment) => attachment.name)
      .filter(isSensitiveAttachmentName),
  };
}
