#!/usr/bin/env bash
# Build a downloadable macOS app + DMG for Grok Build Desktop.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT/apps/desktop"
BUNDLE_DIR="$APP_DIR/src-tauri/target/release/bundle"
OUT_DIR="$ROOT/dist/release"

echo "==> Building Grok Build Desktop (macOS)"
cd "$APP_DIR"
npm install
npm run app:build

mkdir -p "$OUT_DIR"
rm -rf "$OUT_DIR"/*

if [[ -d "$BUNDLE_DIR/macos" ]]; then
  cp -R "$BUNDLE_DIR/macos/"*.app "$OUT_DIR/" 2>/dev/null || true
fi
if [[ -d "$BUNDLE_DIR/dmg" ]]; then
  cp -R "$BUNDLE_DIR/dmg/"*.dmg "$OUT_DIR/" 2>/dev/null || true
fi

echo ""
echo "==> Artifacts"
ls -lah "$OUT_DIR" || ls -lah "$BUNDLE_DIR"/macos "$BUNDLE_DIR"/dmg 2>/dev/null || true
echo ""
echo "Install: open the .dmg and drag Grok Build Desktop into Applications."
echo "Note: unsigned builds may need: right-click → Open (first launch), or"
echo "  xattr -dr com.apple.quarantine \"/Applications/Grok Build Desktop.app\""
