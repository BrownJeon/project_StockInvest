#!/usr/bin/env bash
# T-068 WP-C — cron-runner.sh 의 손절가 도달 알림(stop-alert) 호출 시험.
#
# 실행: bash scripts/test-cron-runner-stop-alert.sh   (NFS noexec 경로라 반드시 bash 경유)
#
# 🔴 (T-147) 이 시험이 보는 것은 이제 **레거시 모드의 동작**이다. T-147 이 기본 호출자를 메인 루프 → 알림 티커 자식으로 바꿨고,
#   이 하네스는 `ALERT_TICKER_DISABLE=1` 로 러너를 돌려 **T-147 이전 동작**(메인 루프가 매 틱 호출)을 그대로 검증한다.
#   그 모드는 죽은 코드가 아니다 — fail-open 경로(flock 없음·락 파일 못 만듦·티커가 죽어 부모가 이어받음)에서 러너가 실제로
#   이 동작으로 돌아오므로, 아래 단정들은 **그 되돌림 경로의 회귀망**이다.
#   기본 모드(티커가 분 경계마다 1회 · 겹침 flock · 고아 방지 · 감독 인수 · 하트비트 중간 갱신)는
#   **scripts/test-cron-runner-alert-ticker.sh** 가 본다. 아래 A 절의 상수·호출 줄 단정도 그쪽이 새 구조로 다시 본다.
#
# cron-runner.sh 를 **그대로** 돌린다 — curl·date·sleep 만 가짜(PATH 앞 스텁)로 바꿔 07:58 KST 부터 20틱을 흉내 낸다.
#  1. stop-alert 는 매 틱 1회, holding-checker 뒤·strategy-eval 앞, --max-time 20 이 그 호출에만 붙는다
#  2. stop-alert 가 상한까지 늘어져도(000) 틱이 막히지 않고 하트비트 간격이 300초 미만이다 — 08시 해외 post-market 상한(120초)과
#     겹치는 최악 틱 포함
#  3. stop-alert 가 실패(500·000)해도 다른 잡의 호출 목록·시각은 정상 시나리오와 완전히 같다
# 외부 호출 없음(curl 은 스텁), 실제 HOME·.env 를 읽지 않음(임시 디렉터리).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="$HERE/cron-runner.sh"
REAL_DATE="$(command -v date)"
TICKS=20
PASS=0; FAIL=0
ok()   { PASS=$((PASS + 1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
eq()   { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (기대 '$3', 실제 '$2')"; fi; }

W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT

echo "A. 상수"
eq "stop-alert curl 상한 20초" "$(grep -E '^STOP_ALERT_CURL_MAX_TIME=' "$RUNNER")" "STOP_ALERT_CURL_MAX_TIME=20"
# (T-147) 러너 전체 호출 줄은 2개 — 티커 블록 1 + 메인 루프 fallback 1. 레거시 모드에서 도는 것은 fallback 쪽이고,
#   「호출자는 항상 정확히 하나」(플래그 ALERT_TICKER_ACTIVE)는 scripts/test-cron-runner-alert-ticker.sh A 절이 본다.
eq "stop-alert 호출 줄 2개(티커 + 메인 루프 fallback)" "$(grep -c 'call /api/cron/stop-alert ' "$RUNNER")" "2"
eq "그중 메인 루프 fallback 블록 안 1개" "$(awk '/^  # >>> stop-alert-fallback/{f=1} f{print} /^  # <<< stop-alert-fallback/{f=0}' "$RUNNER" | grep -c 'call /api/cron/stop-alert ')" "1"

# run_loop MODE — ok | hang(stop-alert 가 상한까지 늘어짐: 000·exit 28) | err(500) | worst(hang + 해외 post-market 도 상한 초과)
run_loop() {
  local mode="$1" R="$W/run-$1"
  mkdir -p "$R/bin" "$R/home" "$R/proj"
  printf 'CRON_SECRET=test-secret\n' > "$R/proj/.env"
  TZ=Asia/Seoul "$REAL_DATE" -d '2026-10-21 07:58:00' +%s > "$R/clock"
  cat > "$R/bin/date" <<EOF
#!/usr/bin/env bash
exec "$REAL_DATE" -d "@\$(cat "$R/clock")" "\$@"
EOF
  # sleep 스텁: 직전 하트비트 값을 기록한 뒤 시계를 민다
  cat > "$R/bin/sleep" <<EOF
#!/usr/bin/env bash
cat "$R/home/.node-local/stockinvest/cron-heartbeat" >> "$R/heartbeats" 2>/dev/null
c=\$(cat "$R/clock"); echo \$((c + \${1%%[!0-9]*})) > "$R/clock"
n=\$(( \$(cat "$R/ticks" 2>/dev/null || echo 0) + 1 )); echo \$n > "$R/ticks"
if [ \$n -ge $TICKS ]; then kill -TERM \$PPID; fi
exit 0
EOF
  cat > "$R/bin/curl" <<EOF
#!/usr/bin/env bash
out=""; url=""; mt=""
while [ \$# -gt 0 ]; do
  case "\$1" in
    -o) out="\$2"; shift 2 ;;
    --max-time) mt="\$2"; shift 2 ;;
    -w|-X|-H|-d) shift 2 ;;
    -s) shift ;;
    *) url="\$1"; shift ;;
  esac
done
path="\${url#http://stub}"
# (T-112) 실행·상태 기록 전송(POST /api/cron/job-run-log — 러너 틱 끝, call() 밖)은 이 시험의 대상이 아니다: 호출·--max-time 목록과 시계에
#   넣지 않고 200 으로 답한다(받은 줄은 버림). 전송·후크 자체와 "후크가 켜져도 다른 호출 = 기준 러너"는 scripts/test-cron-runner-job-run-log.sh 가 본다.
[ "\$path" = "/api/cron/job-run-log" ] && { printf '200'; exit 0; }
echo "\$("$REAL_DATE" -d "@\$(cat "$R/clock")" '+%H:%M:%S') \$path" >> "$R/calls"
[ -n "\$mt" ] && echo "\$path max-time=\$mt" >> "$R/maxtime"
timeout_like() { c=\$(cat "$R/clock"); echo \$((c + \${mt:-0})) > "$R/clock"; [ -n "\$out" ] && : > "\$out"; printf '000'; exit 28; }
case "\$path" in
  /api/cron/stop-alert)
    case "$mode" in
      hang|worst) timeout_like ;;
      err) [ -n "\$out" ] && echo '{"ok":false}' > "\$out"; printf '500'; exit 0 ;;
    esac ;;
  *post-market-analysis?market=overseas*)
    [ "$mode" = "worst" ] && timeout_like ;;
esac
[ -n "\$out" ] && echo '{}' > "\$out"
printf '200'
EOF
  chmod +x "$R/bin/date" "$R/bin/sleep" "$R/bin/curl"
  : > "$R/calls"; : > "$R/maxtime"
  # (T-147) ALERT_TICKER_DISABLE=1 = 레거시 모드(티커 자식 없음 · 메인 루프가 매 틱 stop-alert 호출 · 하트비트 추가 쓰기 없음)
  #   = **T-147 이전 동작**. 이 하네스는 자기 잡의 회귀망이고 기대값(일정·호출 목록·하트비트 간격)이 그 동작 기준이므로 그대로 쓴다.
  #   기본 모드(티커가 분 경계마다 부르고 죽으면 메인 루프가 이어받는다)는 scripts/test-cron-runner-alert-ticker.sh 가 본다.
  PATH="$R/bin:$PATH" HOME="$R/home" PROJECT_DIR="$R/proj" BASE_URL="http://stub" TZ=Asia/Seoul ALERT_TICKER_DISABLE=1 \
    timeout 60 bash "$RUNNER" > "$R/stdout" 2>&1
  echo "$R"
}

RO="$(run_loop ok)"
RH="$(run_loop hang)"
RE="$(run_loop err)"
RW="$(run_loop worst)"

echo "B. 호출 위치·횟수·상한"
for R in "$RO" "$RH" "$RE" "$RW"; do eq "$(basename "$R"): ${TICKS}틱 완주" "$(cat "$R/ticks")" "$TICKS"; done
eq "🔴 stop-alert 매 틱 1회(${TICKS}회)" "$(grep -c ' /api/cron/stop-alert$' "$RO/calls")" "$TICKS"
eq "holding-checker 와 같은 횟수" "$(grep -c '/api/cron/holding-checker' "$RO/calls")" "$TICKS"
# 각 틱에서 순서: entry-watcher → holding-checker → stop-alert (→ strategy-eval 이 있으면 그다음)
order="$(awk '{print $2}' "$RO/calls" | grep -E 'entry-watcher|holding-checker|stop-alert|strategy-eval' | head -4 | tr '\n' ' ')"
eq "🔴 첫 틱 순서 entry-watcher → holding-checker → stop-alert → strategy-eval" "$order" \
   "/api/cron/entry-watcher /api/cron/holding-checker /api/cron/stop-alert /api/cron/strategy-eval "
prev_hc=$(awk '{print $2}' "$RO/calls" | grep -A1 '/api/cron/holding-checker' | grep -c '/api/cron/stop-alert')
eq "매 틱 holding-checker 바로 다음이 stop-alert" "$prev_hc" "$TICKS"
eq "🔴 stop-alert 호출마다 --max-time 20" "$(grep -c '^/api/cron/stop-alert max-time=20$' "$RO/maxtime")" "$TICKS"
eq "🔴 다른 잡에는 --max-time 이 새지 않는다(해외 post-market 120 · 브로커 원장 수집 90(T-087) 만 예외)" \
   "$(grep -v '^/api/cron/stop-alert ' "$RO/maxtime" | sort -u | tr '\n' ' ')" "/api/cron/broker-fills max-time=90 /api/cron/post-market-analysis?market=overseas max-time=120 "

echo "C. 늘어짐·실패 격리"
grep -q 'stop-alert HTTP=000' "$RH/stdout" && ok "상한 초과는 HTTP=000 로그" || bad "HTTP=000 로그 없음"
grep -q 'stop-alert HTTP=500' "$RE/stdout" && ok "500 은 로그 한 줄" || bad "HTTP=500 로그 없음"
max_gap() { awk 'NR>1 { g = $1 - p; if (g > m) m = g } { p = $1 } END { print m + 0 }' "$1/heartbeats"; }
eq "정상: 하트비트 간격 최대 60초" "$(max_gap "$RO")" "60"
eq "🔴 stop-alert 상한 초과: 하트비트 간격 최대 80초(20 + sleep 60)" "$(max_gap "$RH")" "80"
gw="$(max_gap "$RW")"
if [ "$gw" -lt 300 ]; then ok "🔴 최악 틱(08시 해외 120 + stop-alert 20): 하트비트 간격 ${gw}초 < 300초"; else bad "최악 틱 하트비트 간격 ${gw}초 ≥ 300"; fi
eq "최악 틱 간격 = 120 + 20 + 60" "$gw" "200"
eq "🔴 stop-alert 상한 초과여도 매 틱 다시 부른다" "$(grep -c ' /api/cron/stop-alert$' "$RH/calls")" "$TICKS"

others() { grep -v ' /api/cron/stop-alert$' "$1/calls" | awk '{print substr($1,1,5), $2}'; }
if diff <(others "$RO") <(others "$RE") > /dev/null; then ok "🔴 500 이어도 다른 잡 호출 목록·분 단위 시각 동일 ($(others "$RO" | wc -l)건)"; else bad "500 시나리오 다른 잡 목록이 다르다"; fi
# 늘어짐 시나리오는 틱마다 20초씩 시계가 밀려(가짜 시계) 분 표기가 달라지므로 호출 **순서·목록**만 비교한다
paths() { grep -v ' /api/cron/stop-alert$' "$1/calls" | awk '{print $2}'; }
if diff <(paths "$RO") <(paths "$RH") > /dev/null; then ok "🔴 상한 초과여도 다른 잡 호출 순서·목록 동일 ($(paths "$RO" | wc -l)건)"; else bad "상한 초과 시나리오 다른 잡 목록이 다르다"; fi
eq "다른 잡 목록에 stop-alert 없음(필터 확인)" "$(others "$RO" | grep -c stop-alert)" "0"

echo
echo "결과: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
