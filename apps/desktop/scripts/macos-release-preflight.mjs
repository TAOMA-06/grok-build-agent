import { execFileSync } from "node:child_process";

function present(name) {
  return Boolean(process.env[name]?.trim());
}

function fail(message) {
  console.error(`macOS distribution preflight failed: ${message}`);
  process.exit(1);
}

if (process.platform !== "darwin") {
  fail("a signed and notarized macOS release must be built on macOS.");
}

const identity = process.env.APPLE_SIGNING_IDENTITY?.trim();
if (!identity || identity === "-") {
  fail("set APPLE_SIGNING_IDENTITY to an installed Developer ID Application identity.");
}
if (!identity.startsWith("Developer ID Application:")) {
  fail("APPLE_SIGNING_IDENTITY must name a Developer ID Application certificate.");
}

const apiVariables = ["APPLE_API_ISSUER", "APPLE_API_KEY", "APPLE_API_KEY_PATH"];
const appleIdVariables = ["APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"];
const suppliedApiVariables = apiVariables.filter(present);
const suppliedAppleIdVariables = appleIdVariables.filter(present);

if (suppliedApiVariables.length > 0 && suppliedApiVariables.length !== apiVariables.length) {
  fail(`App Store Connect notarization is incomplete; set all of ${apiVariables.join(", ")}.`);
}
if (suppliedAppleIdVariables.length > 0 && suppliedAppleIdVariables.length !== appleIdVariables.length) {
  fail(`Apple ID notarization is incomplete; set all of ${appleIdVariables.join(", ")}.`);
}
if (suppliedApiVariables.length === 0 && suppliedAppleIdVariables.length === 0) {
  fail("provide either App Store Connect API credentials or Apple ID notarization credentials.");
}

let identities;
try {
  identities = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch {
  fail("could not inspect the current keychain for signing identities.");
}

if (!identities.includes(`"${identity}"`)) {
  fail("APPLE_SIGNING_IDENTITY is not available in the current keychain.");
}

console.log("macOS distribution preflight passed.");
