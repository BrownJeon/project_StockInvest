#!/usr/bin/env bash
# Execute the shipped scheduling block with a fake clock/network. No services or credentials.
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
T156_CRON_TMP=$(mktemp -d)
trap 'rm -rf "$T156_CRON_TMP"' EXIT
awk '/# >>> m40-forward-daily/{show=1;next}/# <<< m40-forward-daily/{show=0}show' "$ROOT/scripts/cron-runner.sh" > "$T156_CRON_TMP/block"
M40_FORWARD_LAST_RUN_FILE="$T156_CRON_TMP/attempts"
TODAY=2026-11-10
calls=0
date() { case "$1" in '+%M') echo "$TEST_MINUTE";; '+%s') echo "$TEST_EPOCH";; *) echo test;; esac; }
call() { [ "$1" = '/api/cron/m40-forward' ] || exit 10; calls=$((calls+1)); return 1; }
tick() { HH=$1;TEST_MINUTE=$2;TEST_EPOCH=$3; source "$T156_CRON_TMP/block" || true; }
expect() { [ "$calls" -eq "$1" ] || { echo "FAIL calls=$calls expected=$1";exit 1; }; }
tick 08 39 940;expect 0
tick 08 40 1000;expect 1
tick 08 41 1060;expect 1
tick 08 54 1840;expect 1
tick 08 55 1900;expect 2
tick 09 00 2200;expect 2
tick 09 10 2800;expect 2
TODAY=2026-11-11
tick 09 11 90000;expect 2
tick 08 40 100000;expect 3
tick 08 55 100900;expect 4
tick 08 56 100960;expect 4
echo 'PASS m40-forward schedule: two bounded attempts, 15-minute spacing, date reset, no out-of-window calls'
