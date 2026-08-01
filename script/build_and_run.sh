#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
APP_NAME="Grok Build Desktop"
PROCESS_NAME="grok-build-desktop"
HOST_PROCESS_NAME="grok-build-agent-host"
BUNDLE_ID="com.grokbuilddesktop.community"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/apps/desktop"
TARGET_DIR="$DESKTOP_DIR/src-tauri/target"
BUILD_APP_BUNDLE="$TARGET_DIR/release/bundle/macos/$APP_NAME.app"
INSTALL_APP_BUNDLE="/Applications/$APP_NAME.app"
INSTALL_STAGING="/Applications/.grok-build-desktop.installing"
APP_BINARY="$INSTALL_APP_BUNDLE/Contents/MacOS/$PROCESS_NAME"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

unregister_bundle() {
  local bundle="$1"
  if [[ -x "$LSREGISTER" ]]; then
    "$LSREGISTER" -u "$bundle" >/dev/null 2>&1 || true
  fi
}

cleanup_install_staging() {
  if [[ -e "$INSTALL_STAGING" ]]; then
    rm -rf -- "$INSTALL_STAGING"
  fi
}

cleanup_build_bundle_copies() {
  local bundle
  [[ -d "$TARGET_DIR" ]] || return 0

  while IFS= read -r bundle; do
    if [[ "$bundle" != "$TARGET_DIR/"*"/bundle/macos/$APP_NAME.app" ]]; then
      echo "Refusing to remove unexpected app path: $bundle" >&2
      exit 1
    fi
    unregister_bundle "$bundle"
    rm -rf -- "$bundle"
  done < <(
    /usr/bin/find "$TARGET_DIR" \
      -type d \
      -name "$APP_NAME.app" \
      -path "*/bundle/macos/$APP_NAME.app" \
      -prune \
      -print
  )
}

stop_running_versions() {
  pkill -x "$PROCESS_NAME" >/dev/null 2>&1 || true
  pkill -x "$HOST_PROCESS_NAME" >/dev/null 2>&1 || true

  for _ in {1..20}; do
    if ! pgrep -x "$PROCESS_NAME" >/dev/null 2>&1 &&
       ! pgrep -x "$HOST_PROCESS_NAME" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done

  pkill -KILL -x "$PROCESS_NAME" >/dev/null 2>&1 || true
  pkill -KILL -x "$HOST_PROCESS_NAME" >/dev/null 2>&1 || true
}

validate_bundle() {
  local bundle="$1"
  local binary="$bundle/Contents/MacOS/$PROCESS_NAME"
  local identifier

  if [[ ! -x "$binary" ]]; then
    echo "App binary was not produced at: $binary" >&2
    exit 1
  fi

  identifier="$(
    /usr/libexec/PlistBuddy \
      -c "Print :CFBundleIdentifier" \
      "$bundle/Contents/Info.plist"
  )"
  if [[ "$identifier" != "$BUNDLE_ID" ]]; then
    echo "Unexpected bundle identifier: $identifier" >&2
    exit 1
  fi
}

build_current_source() {
  cleanup_build_bundle_copies
  (
    cd "$DESKTOP_DIR"
    npm run app:bundle
  )
  validate_bundle "$BUILD_APP_BUNDLE"
}

install_current_bundle() {
  local built_hash
  local installed_hash

  cleanup_install_staging
  /usr/bin/ditto "$BUILD_APP_BUNDLE" "$INSTALL_STAGING"
  validate_bundle "$INSTALL_STAGING"

  rm -rf -- "$INSTALL_APP_BUNDLE"
  mv "$INSTALL_STAGING" "$INSTALL_APP_BUNDLE"

  if ! /usr/bin/codesign --verify --deep --strict "$INSTALL_APP_BUNDLE"; then
    echo "Installed app failed code-signature verification." >&2
    exit 1
  fi

  built_hash="$(shasum -a 256 "$BUILD_APP_BUNDLE/Contents/MacOS/$PROCESS_NAME" | awk '{print $1}')"
  installed_hash="$(shasum -a 256 "$APP_BINARY" | awk '{print $1}')"
  if [[ "$built_hash" != "$installed_hash" ]]; then
    echo "Installed app does not match the freshly built binary." >&2
    exit 1
  fi

  if [[ -x "$LSREGISTER" ]]; then
    "$LSREGISTER" -f "$INSTALL_APP_BUNDLE" >/dev/null 2>&1 || true
  fi
}

open_current_bundle() {
  /usr/bin/open "$INSTALL_APP_BUNDLE"
}

verify_current_bundle() {
  local desktop_pid
  local desktop_count
  local desktop_command
  local host_pid
  local host_command

  open_current_bundle
  for _ in {1..20}; do
    if pgrep -x "$PROCESS_NAME" >/dev/null; then
      break
    fi
    sleep 0.25
  done

  if ! pgrep -x "$PROCESS_NAME" >/dev/null; then
    echo "$APP_NAME did not remain running after launch." >&2
    exit 1
  fi

  desktop_count="$(pgrep -x "$PROCESS_NAME" | wc -l | tr -d ' ')"
  if [[ "$desktop_count" != "1" ]]; then
    echo "Expected one running desktop app, found $desktop_count." >&2
    exit 1
  fi

  desktop_pid="$(pgrep -x "$PROCESS_NAME")"
  desktop_command="$(ps -ww -p "$desktop_pid" -o command=)"
  if [[ "$desktop_command" != "$APP_BINARY"* ]]; then
    echo "Desktop launched from a non-canonical path: $desktop_command" >&2
    exit 1
  fi

  for _ in {1..20}; do
    if pgrep -x "$HOST_PROCESS_NAME" >/dev/null; then
      break
    fi
    sleep 0.25
  done

  for host_pid in $(pgrep -x "$HOST_PROCESS_NAME" 2>/dev/null || true); do
    host_command="$(ps -ww -p "$host_pid" -o command=)"
    if [[ "$host_command" != "$INSTALL_APP_BUNDLE/"* ]]; then
      echo "Agent Host launched from a non-canonical path: $host_command" >&2
      exit 1
    fi
  done
}

case "$MODE" in
  --clean|clean)
    stop_running_versions
    cleanup_install_staging
    cleanup_build_bundle_copies
    if [[ -x "$LSREGISTER" && -d "$INSTALL_APP_BUNDLE" ]]; then
      "$LSREGISTER" -f "$INSTALL_APP_BUNDLE" >/dev/null 2>&1 || true
    fi
    exit 0
    ;;
  --open|open)
    stop_running_versions
    cleanup_install_staging
    cleanup_build_bundle_copies
    validate_bundle "$INSTALL_APP_BUNDLE"
    open_current_bundle
    exit 0
    ;;
esac

trap 'cleanup_install_staging; cleanup_build_bundle_copies' EXIT

stop_running_versions
cleanup_install_staging
build_current_source
install_current_bundle
cleanup_build_bundle_copies

case "$MODE" in
  run)
    open_current_bundle
    ;;
  --build|build)
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
    echo "usage: $0 [run|--build|--open|--clean|--debug|--logs|--telemetry|--verify]" >&2
    exit 2
    ;;
esac
