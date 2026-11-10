#!/usr/bin/env bash
# Execute the shipped scheduling block with a fake ET clock/network.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
T156_CRON_TMP=$(mktemp -d); trap 'rm -rf "$T156_CRON_TMP"' EXIT
awk '/# >>> m40-forward-daily/{show=1;next}/# <<< m40-forward-daily/{show=0}show' "$ROOT/scripts/cron-runner.sh" > "$T156_CRON_TMP/block"
eval "$(awk '/# >>> m40-state-write/{show=1;next}/# <<< m40-state-write/{show=0}show' "$ROOT/scripts/cron-runner.sh")"
M40_FORWARD_LAST_RUN_FILE="$T156_CRON_TMP/attempts"
calls=0;CALL_MAX_TIME='';TEST_DAY=2026-11-10;CRON_SECRET=synthetic;BASE_URL=http://synthetic;STATUS=pending
curl(){ printf '{"ok":true,"status":"%s","completed":%s,"sourceReady":%s,"beforeNextOpen":true}' "$STATUS" "$([ "$STATUS" = completed ] && echo true || echo false)" "${SOURCE_READY:-true}"; }
# TZ is assigned per date call by production; DST conversion is delegated to date.
date(){ [ "${TZ:-}" = America/New_York ]; echo "$TEST_DAY $TEST_HOUR $TEST_MINUTE $TEST_EPOCH"; }
call(){ [ "$1" = '/api/cron/m40-forward' ]; [ "$CALL_MAX_TIME" = 10 ];
 [ "$(awk '{print $4}' "$M40_FORWARD_LAST_RUN_FILE")" = reserved ];calls=$((calls+1));CALL_LAST_CODE=202; }
tick(){ TEST_HOUR=$1;TEST_MINUTE=$2;TEST_EPOCH=$3;source "$T156_CRON_TMP/block"; }
expect(){ [ "$calls" -eq "$1" ] || { echo "FAIL calls=$calls expected=$1";exit 1; }; }
tick 06 44 940;expect 0
tick 06 45 1000;expect 1
tick 07 14 2740;expect 1
tick 07 15 2800;expect 2
tick 07 45 4600;expect 3
tick 08 15 6400;expect 4
tick 08 45 8200;expect 4
tick 08 46 8260;expect 4
[ "$(awk '{print $4}' "$M40_FORWARD_LAST_RUN_FILE")" = accepted ]
TEST_DAY=2026-11-11;tick 06 45 87400;expect 5
STATUS=completed;tick 07 15 89200;expect 5
[ "$(awk '{print $4}' "$M40_FORWARD_LAST_RUN_FILE")" = completed ]
tick 07 45 91000;expect 5
[ "$CALL_MAX_TIME" = '' ]
echo 'PASS forward ET window, four attempts, 30m spacing, pre-reservation, accepted is not completed'
# A completed ledger with missing sources must call repair, then stop after ready.
TEST_DAY=2026-11-12;SOURCE_READY=false;tick 06 45 173800;expect 6
SOURCE_READY=true;tick 07 15 175600;expect 6
[ "$(awk '{print $4}' "$M40_FORWARD_LAST_RUN_FILE")" = completed ]
# Missing state directory simulates reservation failure across restarts: zero network.
M40_FORWARD_LAST_RUN_FILE="$T156_CRON_TMP/missing/attempts";TEST_DAY=2026-11-13
curl(){ touch "$T156_CRON_TMP/unexpected-network";echo '{}'; }
tick 06 45 260200;expect 6
tick 06 46 260260;expect 6
[ ! -e "$T156_CRON_TMP/unexpected-network" ]
echo 'PASS forward reservation failure is closed across repeated ticks'
# A failed atomic replacement retains the prior valid reservation.
state="$T156_CRON_TMP/stable-state";echo '2026-11-12 2 1000 reserved' > "$state"
mv(){ return 1; }
if m40_state_write "$state" '2026-11-12 2 1000 completed';then exit 1;fi
[ "$(cat "$state")" = '2026-11-12 2 1000 reserved' ]
unset -f mv
# Run the real call() body with synthetic HTTP statuses; only the exact paper
# forward endpoint receives the accepted wording. No response-file persistence.
awk '/^call\(\) \{/{show=1}show{print}/^\}/{if(show)exit}' "$ROOT/scripts/cron-runner.sh" > "$T156_CRON_TMP/call"
unset -f call date
. "$T156_CRON_TMP/call"
CRON_SECRET=synthetic;BASE_URL=http://synthetic;TEST_CODE=202
jrl_now_ms(){ echo 0; };jrl_hook(){ :; };jrl_mask_money(){ cat; }
call_tmp_open(){ CALL_BODY_FILE="$T156_CRON_TMP/body";echo '{"ok":true,"scheduled":true,"completed":false}' > "$CALL_BODY_FILE"; }
curl(){ echo "$TEST_CODE"; }
text=$(call '/api/cron/m40-forward' m40-forward)
[[ "$text" == *'ACCEPTED completed=false'* ]];[ ! -f "$T156_CRON_TMP/body" ]
text=$(call '/api/cron/other' other)
[[ "$text" == *'HTTP=202'* ]];[[ "$text" != *ACCEPTED* ]]
TEST_CODE=503;text=$(call '/api/cron/m40-forward' m40-forward)
[[ "$text" == *'HTTP=503'* ]];[[ "$text" != *ACCEPTED* ]]
echo 'PASS real call(): exact forward 202 accepted, other 202 and errors unchanged, temp removed'
