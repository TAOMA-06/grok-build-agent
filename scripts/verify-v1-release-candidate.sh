#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "usage: $0 '/path/to/Grok Build Desktop.app' /path/to/test-workspace [evidence-directory]" >&2
  exit 2
fi

app=$1
workspace=$2
evidence=${3:-"${TMPDIR:-/tmp}/grok-build-rc-$(date -u +%Y%m%dT%H%M%SZ)"}
binary="$app/Contents/MacOS/grok-build-desktop"
host_binary="$app/Contents/MacOS/grok-build-agent-host"
label=com.grokbuilddesktop.community.agent-host
plist="$HOME/Library/LaunchAgents/$label.plist"

[[ -d "$app" ]] || { echo "app not found: $app" >&2; exit 1; }
[[ -x "$binary" ]] || { echo "app executable not found: $binary" >&2; exit 1; }
[[ -x "$host_binary" ]] || { echo "independent Agent Host not found: $host_binary" >&2; exit 1; }
[[ -d "$workspace" ]] || { echo "workspace not found: $workspace" >&2; exit 1; }
command -v grok >/dev/null || { echo "Grok CLI is not installed or not on PATH" >&2; exit 1; }
command -v git >/dev/null || { echo "git is unavailable" >&2; exit 1; }

mkdir -p "$evidence"
exec > >(tee "$evidence/run.log") 2>&1

echo "Grok Build Desktop v1 release-candidate verification"
echo "Evidence: $evidence"
date -u +%FT%TZ
sw_vers
uname -m
grok --version
git --version
lipo -archs "$binary" | tee "$evidence/architectures.txt"
lipo -archs "$host_binary" | tee "$evidence/host-architectures.txt"
codesign --verify --deep --strict --verbose=2 "$app"
codesign -dv --verbose=4 "$app" 2> "$evidence/codesign.txt"
codesign -d --entitlements :- "$binary" > "$evidence/ui-entitlements.plist" 2>/dev/null
codesign -d --entitlements :- "$host_binary" > "$evidence/host-entitlements.plist" 2>/dev/null

if ! grep -q 'x86_64' "$evidence/architectures.txt" || ! grep -q 'arm64' "$evidence/architectures.txt"; then
  echo "release candidate is not universal" >&2
  exit 1
fi
if ! grep -q 'x86_64' "$evidence/host-architectures.txt" || ! grep -q 'arm64' "$evidence/host-architectures.txt"; then
  echo "Agent Host sidecar is not universal" >&2
  exit 1
fi
grep -q 'keychain-access-groups' "$evidence/ui-entitlements.plist"
grep -q 'keychain-access-groups' "$evidence/host-entitlements.plist"

"$binary" --install-agent-host
test -f "$plist"
launchctl print "gui/$(id -u)/$label" > "$evidence/launchctl-before.txt"
grep -F "$host_binary" "$plist" > "$evidence/launchagent-program.txt"

cat <<EOF

The automated preflight passed. The app will now open.
Use workspace: $workspace

Perform exactly these checks in the UI:
  1. Confirm Grok authentication and ACP initialize succeed.
  2. Start a task that edits a disposable file in an isolated worktree.
  3. Run a declared verification command and confirm its real exit code/output appears.
  4. Trigger one safe terminal permission and one denied high-risk permission.
  5. Review and stage one hunk, then unstage it.
  6. Start a long-running command, quit the UI, wait 30 seconds, and reopen it.
  7. Confirm the task, terminal tab, output, permission state and worktree recover.
  8. Cancel the task and confirm no owned child process remains.
EOF

open "$app" --args "$workspace"
read -r -p "Enter PASS only after all eight UI checks pass: " result
if [[ "$result" != PASS ]]; then
  echo "Release-candidate verification was not accepted." >&2
  exit 1
fi

launchctl print "gui/$(id -u)/$label" > "$evidence/launchctl-after.txt"
database="$HOME/Library/Application Support/GrokBuildDesktop/catalog.sqlite"
if command -v sqlite3 >/dev/null && [[ -f "$database" ]]; then
  sqlite3 "$database" 'PRAGMA integrity_check;' | tee "$evidence/sqlite-integrity.txt"
  grep -qx ok "$evidence/sqlite-integrity.txt"
  sqlite3 -header -csv "$database" \
    "SELECT state, count(*) AS count FROM tasks GROUP BY state ORDER BY state;" \
    > "$evidence/task-states.csv"
  sqlite3 -header -csv "$database" \
    "SELECT state, count(*) AS count FROM terminal_processes GROUP BY state ORDER BY state;" \
    > "$evidence/terminal-states.csv"
fi

pgrep -af -- 'grok-build-agent-host' > "$evidence/host-processes.txt"
pgrep -af -- "$workspace" > "$evidence/workspace-processes.txt" || true
date -u +%FT%TZ > "$evidence/passed-at.txt"
echo "Release-candidate smoke verification passed. Evidence: $evidence"
