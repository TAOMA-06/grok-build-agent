import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauriDir = resolve(desktopDir, "src-tauri");
const binaryDir = resolve(tauriDir, "binaries");
const target = process.env.TAURI_ENV_TARGET_TRIPLE || execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
const profile = process.env.TAURI_ENV_DEBUG === "true" ? "debug" : "release";
const cargoArgs = profile === "release" ? ["build", "--release"] : ["build"];

mkdirSync(binaryDir, { recursive: true });

function buildFor(targetTriple) {
  execFileSync("cargo", [...cargoArgs, "--bin", "grok-build-agent-host", "--target", targetTriple], {
    cwd: tauriDir,
    stdio: "inherit",
  });
  return resolve(tauriDir, "target", targetTriple, profile, "grok-build-agent-host");
}

const destination = resolve(binaryDir, `grok-build-agent-host-${target}`);
if (target === "universal-apple-darwin") {
  const arm = buildFor("aarch64-apple-darwin");
  const intel = buildFor("x86_64-apple-darwin");
  execFileSync("lipo", ["-create", arm, intel, "-output", destination], { stdio: "inherit" });
  const universalCargoOutput = resolve(tauriDir, "target", target, profile, "grok-build-agent-host");
  mkdirSync(dirname(universalCargoOutput), { recursive: true });
  copyFileSync(destination, universalCargoOutput);
  chmodSync(universalCargoOutput, 0o755);
} else {
  const built = buildFor(target);
  if (!existsSync(built)) throw new Error(`Agent Host build output is missing: ${built}`);
  copyFileSync(built, destination);
}
chmodSync(destination, 0o755);

const teamId = process.env.APPLE_TEAM_ID?.trim();
if (teamId && !/^[A-Z0-9]{10}$/.test(teamId)) {
  throw new Error("APPLE_TEAM_ID must be a 10-character Apple team identifier");
}
const keychainGroup = teamId ? `${teamId}.com.grokbuilddesktop.community.shared` : null;
const groupEntry = keychainGroup
  ? `  <key>keychain-access-groups</key>\n  <array><string>${keychainGroup}</string></array>\n`
  : "";
writeFileSync(
  resolve(tauriDir, "entitlements.generated.plist"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n${groupEntry}</dict>\n</plist>\n`,
);
