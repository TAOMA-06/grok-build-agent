#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
APP_NAME="Grok Build Desktop"
PROCESS_NAME="grok-build-desktop"
HOST_PROCESS_NAME="grok-build-agent-host"
BUNDLE_ID="com.grokbuilddesktop.community"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/apps/desktop"
APP_BUNDLE="$DESKTOP_DIR/src-tauri/target/release/bundle/macos/$APP_NAME.app"
APP_BINARY="$APP_BUNDLE/Contents/MacOS/$PROCESS_NAME"

stop_running_versions() {
  pkill -x "$PROCESS_NAME" >/dev/null 2>&1 || true
  pkill -x "$HOST_PROCESS_NAME" >/dev/null 2>&1 || true
}

build_current_source() {
  (
    cd "$DESKTOP_DIR"
    npm run app:build
  )

  if [[ ! -x "$APP_BINARY" ]]; then
    echo "Fresh app binary was not produced at: $APP_BINARY" >&2
    exit 1
  fi
}

open_current_bundle() {
  /usr/bin/open -n "$APP_BUNDLE"
}

verify_current_bundle() {
  open_current_bundle
  for _ in {1..20}; do
    if pgrep -x "$PROCESS_NAME" >/dev/null; then
      return 0
    fi
    sleep 0.25
  done
  echo "$APP_NAME did not remain running after launch." >&2
  exit 1
}

stop_running_versions
build_current_source

case "$MODE" in
  run)
    open_current_bundle
    ;;
  --debug|debug)
    lldb -- "$APP_BINARY"
    ;;
  --logs|logs)
    open_current_bundle
    /usr/bin/log stream --info --style compact --predicate "process == \"$PROCESS_NAME\""
    ;;
  --telemetry|telemetry)
    open_current_bundle
    /usr/bin/log stream --info --style compact --predicate "subsystem == \"$BUNDLE_ID\""
    ;;
  --verify|verify)
    verify_current_bundle
    ;;
  *)
    echo "usage: $0 [run|--debug|--logs|--telemetry|--verify]" >&2
    exit 2
    ;;
esac
