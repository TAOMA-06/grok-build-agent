#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 /path/to/Grok\ Build\ Desktop.app-or.dmg" >&2
  exit 2
fi

artifact=$1
if [[ ! -e "$artifact" ]]; then
  echo "artifact does not exist: $artifact" >&2
  exit 1
fi

codesign --verify --deep --strict --verbose=2 "$artifact"
if [[ -d "$artifact" && "$artifact" == *.app ]]; then
  host="$artifact/Contents/MacOS/grok-build-agent-host"
  [[ -x "$host" ]] || { echo "independent Agent Host is missing" >&2; exit 1; }
  codesign -dv --verbose=4 "$artifact" 2>&1 | grep -q "Authority=Developer ID Application"
  codesign -d --entitlements :- "$host" 2>&1 | grep -q "keychain-access-groups"
  spctl --assess --type execute --verbose=4 "$artifact"
fi
xcrun stapler validate "$artifact"
shasum -a 256 "$artifact" 2>/dev/null || true

echo "macOS signing, Gatekeeper, and notarization-ticket checks passed."
