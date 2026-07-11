#!/usr/bin/env bash
set -euo pipefail

duration_seconds=${1:-28800}
interval_seconds=${SOAK_INTERVAL_SECONDS:-10}
report_dir=${SOAK_REPORT_DIR:-"${TMPDIR:-/tmp}/grok-build-soak-$(date -u +%Y%m%dT%H%M%SZ)"}
database=${GROK_BUILD_DATABASE:-"$HOME/Library/Application Support/GrokBuildDesktop/catalog.sqlite"}
label=com.grokbuilddesktop.community.agent-host
deadline=$((SECONDS + duration_seconds))
failures=0
mkdir -p "$report_dir"
samples="$report_dir/samples.csv"
events_before=0
printf 'timestamp,pid,rss_kb,vsz_kb,database_bytes,platform_events,integrity\n' > "$samples"

if [[ ! -f "$HOME/Library/LaunchAgents/$label.plist" ]]; then
  echo "LaunchAgent is not installed: $HOME/Library/LaunchAgents/$label.plist" >&2
  exit 1
fi
if [[ ! -f "$database" ]]; then
  echo "Database does not exist: $database" >&2
  exit 1
fi
if command -v sqlite3 >/dev/null; then
  events_before=$(sqlite3 "$database" 'SELECT count(*) FROM platform_events;' 2>/dev/null || echo 0)
fi

echo "Monitoring Agent Host for ${duration_seconds}s (interval ${interval_seconds}s)."
echo "Evidence directory: $report_dir"
while (( SECONDS < deadline )); do
  timestamp=$(date -u +%FT%TZ)
  pid=$(pgrep -f -- "--agent-host" | head -1 || true)
  if [[ -z "$pid" ]]; then
    echo "$(date -u +%FT%TZ) Agent Host is not running" >&2
    failures=$((failures + 1))
    printf '%s,,,,,,host-missing\n' "$timestamp" >> "$samples"
  else
    read -r rss vsz < <(ps -p "$pid" -o rss=,vsz= | awk '{print $1, $2}')
    database_bytes=$(stat -f %z "$database" 2>/dev/null || echo 0)
    integrity=unavailable
    event_count=0
    if command -v sqlite3 >/dev/null; then
      integrity=$(sqlite3 "$database" 'PRAGMA integrity_check;' 2>/dev/null || echo failed)
      event_count=$(sqlite3 "$database" 'SELECT count(*) FROM platform_events;' 2>/dev/null || echo 0)
      if [[ "$integrity" != ok ]]; then
        echo "$timestamp SQLite integrity check failed: $integrity" >&2
        failures=$((failures + 1))
      fi
    fi
    printf '%s,%s,%s,%s,%s,%s,%s\n' "$timestamp" "$pid" "$rss" "$vsz" "$database_bytes" "$event_count" "$integrity" >> "$samples"
  fi
  launchctl print "gui/$(id -u)/$label" > "$report_dir/launchctl-latest.txt" 2>&1 || failures=$((failures + 1))
  if (( failures > 3 )); then
    echo "Agent Host missed more than three health samples." >&2
    exit 1
  fi
  sleep "$interval_seconds"
done

events_after=$events_before
if command -v sqlite3 >/dev/null; then
  events_after=$(sqlite3 "$database" 'SELECT count(*) FROM platform_events;' 2>/dev/null || echo "$events_before")
fi
cat > "$report_dir/summary.txt" <<EOF
duration_seconds=$duration_seconds
interval_seconds=$interval_seconds
failures=$failures
events_before=$events_before
events_after=$events_after
database=$database
EOF
echo "Agent Host soak monitor completed with ${failures} transient misses."
echo "Evidence written to $report_dir"
