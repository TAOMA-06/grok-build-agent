import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const trackedFiles = execFileSync("git", ["-C", repositoryRoot, "ls-files", "-z"], {
  encoding: "utf8",
}).split("\0").filter(Boolean);

const contentRules = [
  ["token-shaped credential", /(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gho_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|sk-[A-Za-z0-9]{20,}|xai-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,})/],
  ["private key", /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/],
];
const sensitiveFile = /(^|\/)(\.env(?:\..+)?|[^/]+\.(?:p12|pfx|pem|key|cer|mobileprovision)|notarization-credentials\.json|release\.env)$/i;
const findings = [];

for (const relativePath of trackedFiles) {
  if (sensitiveFile.test(relativePath)) {
    findings.push(`${relativePath}: sensitive filename`);
    continue;
  }

  let source;
  try {
    source = readFileSync(resolve(repositoryRoot, relativePath), "utf8");
  } catch {
    continue;
  }

  for (const [label, pattern] of contentRules) {
    if (pattern.test(source)) {
      findings.push(`${relativePath}: ${label}`);
    }
  }
}

if (findings.length > 0) {
  console.error("Release safety check failed. Review these paths without copying secret values:");
  for (const finding of [...new Set(findings)]) console.error(`- ${finding}`);
  process.exit(1);
}

console.log("Release safety check passed: tracked source contains no detected credentials or sensitive release material.");
