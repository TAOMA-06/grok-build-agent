#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
APP_NAME="Grok Build Desktop"
PROCESS_NAME="grok-build-desktop"
BUNDLE_ID="com.grokbuilddesktop.community"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/apps/desktop"
APP_BUNDLE="$APP_DIR/src-tauri/target/release/bundle/macos/$APP_NAME.app"
APP_BINARY="$APP_BUNDLE/Contents/MacOS/$PROCESS_NAME"
INFO_PLIST="$APP_BUNDLE/Contents/Info.plist"

usage() {
  echo "usage: $0 [run|--debug|--logs|--telemetry|--verify]" >&2
  exit 2
}

stop_existing_app() {
  pkill -x "$PROCESS_NAME" >/dev/null 2>&1 || true
}

build_app() {
  (
    cd "$APP_DIR"
    npm run app:build -- --bundles app
  )

  test -d "$APP_BUNDLE"
  test -x "$APP_BINARY"

  local actual_bundle_id
  actual_bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$INFO_PLIST")"
  if [[ "$actual_bundle_id" != "$BUNDLE_ID" ]]; then
    echo "unexpected bundle identifier: $actual_bundle_id" >&2
    exit 1
  fi

  /usr/bin/codesign --verify --deep --strict "$APP_BUNDLE"
}

open_app() {
  /usr/bin/open -n "$APP_BUNDLE"
}

verify_process() {
  local attempts=0
  while (( attempts < 24 )); do
    if pgrep -x "$PROCESS_NAME" >/dev/null; then
      echo "$APP_NAME launched from $APP_BUNDLE"
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 0.25
  done
  echo "$APP_NAME did not start within 6 seconds" >&2
  return 1
}

case "$MODE" in
  run)
    stop_existing_app
    build_app
    open_app
    ;;
  --debug|debug)
    stop_existing_app
    build_app
    lldb -- "$APP_BINARY"
    ;;
  --logs|logs)
    stop_existing_app
    build_app
    open_app
    verify_process
    /usr/bin/log stream --info --style compact --predicate "process == \"$PROCESS_NAME\""
    ;;
  --telemetry|telemetry)
    stop_existing_app
    build_app
    open_app
    verify_process
    /usr/bin/log stream --info --style compact --predicate "subsystem == \"$BUNDLE_ID\""
    ;;
  --verify|verify)
    stop_existing_app
    build_app
    open_app
    verify_process
    ;;
  *)
    usage
    ;;
esac
