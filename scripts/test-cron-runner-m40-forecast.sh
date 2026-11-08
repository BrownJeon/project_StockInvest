#!/usr/bin/env bash
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
awk '/# >>> m40-forecast-daily/{show=1;next}/# <<< m40-forecast-daily/{show=0}show' "$ROOT/scripts/cron-runner.sh" > "$TMP/block"
mkdir -p "$TMP/home/.node-local/stockinvest"
# Replace only the test fixture file path; do not change the user's home environment.
python3 - "$TMP/block" "$TMP/home/.node-local/stockinvest/m40-forecast-last-date" <<'PYTEST'
import sys
p=sys.argv[1]
s=open(p).read().replace('${HOME}/.node-local/stockinvest/m40-forecast-last-date',sys.argv[2])
open(p,'w').write(s)
PYTEST
TODAY=2026-11-09 HH=09 calls=0 CALL_MAX_TIME=""
call(){ [ "$1" = /api/cron/m40-forecast ]; [ "$CALL_MAX_TIME" = 150 ]; calls=$((calls+1)); }
. "$TMP/block"; [ "$calls" = 0 ]
HH=10; . "$TMP/block"; [ "$calls" = 1 ]; [ "$CALL_MAX_TIME" = '' ]
. "$TMP/block"; [ "$calls" = 1 ]
TODAY=2026-11-10; . "$TMP/block"; [ "$calls" = 2 ]
echo 'PASS forecast once per day, reserved before call, 150s bound'
