#!/usr/bin/env bash
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d);trap 'rm -rf "$TMP"' EXIT
awk '/# >>> m40-forecast-daily/{show=1;next}/# <<< m40-forecast-daily/{show=0}show' "$ROOT/scripts/cron-runner.sh" > "$TMP/block"
mkdir -p "$TMP/home/.node-local/stockinvest"
python3 - "$TMP/block" "$TMP/home/.node-local/stockinvest/m40-forecast-last-date" <<'PY'
import sys
p=sys.argv[1];s=open(p).read().replace('${HOME}/.node-local/stockinvest/m40-forecast-last-date',sys.argv[2]);open(p,'w').write(s)
PY
eval "$(awk '/# >>> m40-state-write/{show=1;next}/# <<< m40-state-write/{show=0}show' "$ROOT/scripts/cron-runner.sh")"
M40_ET_DAY=2026-11-10;M40_NOW_TS=1000;calls=0;probes=0;CALL_MAX_TIME='';CRON_SECRET=synthetic;BASE_URL=http://synthetic
READY=false;CODE=503
curl(){ probes=$((probes+1));echo "{\"ok\":true,\"status\":\"completed\",\"completed\":$READY,\"sourceReady\":$READY,\"beforeNextOpen\":$READY}"; }
call(){ [ "$1" = /api/cron/m40-forecast ];[ "$CALL_MAX_TIME" = 150 ];
 [ "$(awk '{print $4}' "$TMP/home/.node-local/stockinvest/m40-forecast-last-date")" = reserved ];calls=$((calls+1));CALL_LAST_CODE=$CODE; }
tick(){ M40_ET_MINUTE=$1;M40_NOW_TS=$2;source "$TMP/block"; }
tick 419 940;[ "$calls" = 0 ]
tick 420 1000;[ "$calls" = 0 ] # readiness blocked consumes a bounded check, not a forecast
READY=true;tick 449 2740;[ "$calls" = 0 ]
tick 450 2800;[ "$calls" = 1 ] # HTTP 503 remains retryable
CODE=202;tick 480 4600;[ "$calls" = 2 ]
[ "$(awk '{print $4}' "$TMP/home/.node-local/stockinvest/m40-forecast-last-date")" = running ]
CODE=200;tick 510 6400;[ "$calls" = 3 ]
tick 540 8200;[ "$calls" = 3 ] # completed stops later attempts
M40_ET_DAY=2026-11-11;CODE=503
for entry in '420 87400' '450 89200' '480 91000' '510 92800' '540 94600' '541 94660';do tick $entry;done
[ "$calls" = 7 ];[ "$CALL_MAX_TIME" = '' ]
echo 'PASS forecast ET window, readiness, four retries, 503 recovery, completion stop'

# Missing directory must prevent even the readiness network probe.
mv "$TMP/home/.node-local/stockinvest" "$TMP/disabled-state-dir"
M40_ET_DAY=2026-11-12
curl(){ touch "$TMP/unexpected-network";echo '{}'; }
tick 420 173800;tick 421 173860
[ "$calls" = 7 ];[ ! -e "$TMP/unexpected-network" ]
echo 'PASS forecast reservation failure is closed across repeated ticks'
