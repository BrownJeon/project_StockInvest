#!/usr/bin/env bash
# T-143 WP-A — cron-runner.sh 의 해외 분석 대상 월간 산출 블록(overseas-universe-refresh) 시험.
#
# 실행: bash scripts/test-cron-runner-overseas-universe.sh   (NFS noexec 경로라 반드시 bash 경유)
#
# cron-runner.sh 를 **그대로** 돌린다 — curl·date·sleep 만 가짜(PATH 앞 스텁)로 바꿔 가짜 시각으로 틱을 흉내 낸다
# (scripts/test-cron-runner-daily-bars.sh 와 같은 하네스).
#  U1. 2026-12-06(첫째 일요일) 하루 1440틱: 호출은 창(01:10~05:50) 안 **짝수 분 140회** + 창 종료 점검 05:50 **1회**
#      = 141회 · --max-time 120 · 그 밖 0회
#  U2. 평일(12-01 화·11-02 월)·둘째 일요일(12-13)·첫째 토요일(12-05) 의 창 시각대(330틱): 호출 0회
#  U3. 경계: 01:08·01:11(홀수 분)·05:52 이후에는 안 돎 · 01:10·05:48·05:50 에는 돎
#
#  🔴 05:50 이 왜 도는가(T-145 ④-조각): 일시 오류가 그 달을 닫지 않게 바뀌어(⑥-4) 창이 끝날 때 종결 기록 없이
#     미완으로 남는 경로가 생겼다. 그 한 틱에서 라우트가 미완을 보고 텔레그램 warning 을 1회 보낸다.
#     그 호출은 관문 3에서 「창 밖」으로 끝나므로 **외부 호출 0건**이다.
#  U4. 🔴 이 블록을 뺀 **다른 모든 잡의 호출이 변경 전 러너와 완전히 같다**(추가만 했다는 증명).
#      ⚠ (T-145 ⑨) 단 하나 예외 — kis-fundamentals-snapshot 은 사용자 승인으로 일정 자체가 바뀌어(하루 1회 → 08:30~08:55 창의
#      매 틱) 이 비교에서 뺀다. 그 잡의 일정은 자기 블록 시험이 본다(아래 nouv 주석).
#  U5. 정적: 호출 줄 1개 · 상한은 그 호출에만(앞뒤로 CALL_MAX_TIME 설정·해제) · 비밀 헤더를 블록에서 다루지 않음 ·
#      요일·일자·창 판정이 블록 안 변수로만 이뤄짐 · call() 불변
# 외부 호출 없음(curl 은 스텁), 실제 HOME·.env 를 읽지 않음(임시 디렉터리).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="${T143_RUNNER:-$HERE/cron-runner.sh}"
BASE_REF="${T143_BASE_REF:-63f1044}"   # WP-B 운영 반영 커밋 = WP-A 착수 기준
REAL_DATE="$(command -v date)"
PASS=0; FAIL=0
ok()   { PASS=$((PASS + 1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
eq()   { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (기대 '$3', 실제 '$2')"; fi; }

W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT

BEFORE="$W/runner-before.sh"
if ! git -C "$HERE/.." show "$BASE_REF:scripts/cron-runner.sh" > "$BEFORE" 2>/dev/null || [ ! -s "$BEFORE" ]; then
  echo "변경 전 러너($BASE_REF:scripts/cron-runner.sh)를 읽지 못함 — 비교 시험을 할 수 없다(T143_BASE_REF 로 지정 가능)"
  exit 1
fi

ep() { TZ=Asia/Seoul "$REAL_DATE" -d "$1" +%s; }

# run_loop NAME RUNNER START TICKS
#  호출 기록 한 줄: "MM-DD HH:MM 틱번호 경로"
run_loop() {
  local name="$1" runner="$2" start="$3" ticks="$4" R="$W/$1"
  mkdir -p "$R/bin" "$R/home/.node-local/stockinvest" "$R/proj/scripts"
  printf 'CRON_SECRET=test-secret\n' > "$R/proj/.env"
  ep "$start" > "$R/clock"
  cat > "$R/bin/date" <<EOF
#!/usr/bin/env bash
exec "$REAL_DATE" -d "@\$(cat "$R/clock")" "\$@"
EOF
  cat > "$R/bin/sleep" <<EOF
#!/usr/bin/env bash
c=\$(( \$(cat "$R/clock") + \${1%%[!0-9]*} ))
echo \$c > "$R/clock"
n=\$(( \$(cat "$R/ticks" 2>/dev/null || echo 0) + 1 )); echo \$n > "$R/ticks"
if [ \$n -ge $ticks ]; then kill -TERM \$PPID; fi
exit 0
EOF
  cat > "$R/bin/curl" <<EOF
#!/usr/bin/env bash
out=""; url=""; mt=""; body=""
while [ \$# -gt 0 ]; do
  case "\$1" in
    -o) out="\$2"; shift 2 ;;
    --max-time) mt="\$2"; shift 2 ;;
    -d) body="\$2"; shift 2 ;;
    -w|-X|-H) shift 2 ;;
    -s) shift ;;
    *) url="\$1"; shift ;;
  esac
done
path="\${url#http://stub}"
# 실행 기록 전송(T-112)은 이 시험의 대상이 아니다 — 목록에 넣지 않고 200 으로 답한다
[ "\$path" = "/api/cron/job-run-log" ] && { printf '200'; exit 0; }
echo "\$("$REAL_DATE" -d "@\$(cat "$R/clock")" '+%m-%d %H:%M') \$(cat "$R/ticks" 2>/dev/null || echo 0) \$path" >> "$R/calls"
[ -n "\$mt" ] && echo "\$path max-time=\$mt" >> "$R/maxtime"
# 산출 라우트는 「이달 더 부르지 마라」를 본문으로 알리지만 러너는 본문을 읽지 않는다(call() 이 본문 파일을 지운다) —
# 그래서 창·간격이 호출 수를 묶는다. 이 스텁은 늘 200·final:true 를 준다: 그래도 140회가 나와야 한다.
[ -n "\$out" ] && echo '{"ok":true,"status":"complete","final":true}' > "\$out"
printf '200'
EOF
  chmod +x "$R/bin/date" "$R/bin/sleep" "$R/bin/curl"
  : > "$R/calls"; : > "$R/maxtime"
  # (T-147) ALERT_TICKER_DISABLE=1 = 레거시 모드(티커 자식 없음 · 메인 루프가 매 틱 stop-alert 호출 · 하트비트 추가 쓰기 없음)
  #   = **T-147 이전 동작**. 이 하네스는 자기 잡의 회귀망이고 기대값(일정·호출 목록·하트비트 간격)이 그 동작 기준이므로 그대로 쓴다.
  #   기본 모드(티커가 분 경계마다 부르고 죽으면 메인 루프가 이어받는다)는 scripts/test-cron-runner-alert-ticker.sh 가 본다.
  PATH="$R/bin:$PATH" HOME="$R/home" PROJECT_DIR="$R/proj" BASE_URL="http://stub" TZ=Asia/Seoul ALERT_TICKER_DISABLE=1 \
    timeout 900 bash "$runner" > "$R/stdout" 2>&1
  echo "$R"
}

UVRE=' /api/cron/overseas-universe-refresh$'
uvc()  { grep -cE "$UVRE" "$1/calls" || true; }
uvat() { grep -E "$UVRE" "$1/calls" | awk '{print $2}' | tr '\n' ' '; }
# (T-145 ⑨) kis-fundamentals-snapshot 은 **하루 1회 → 08:30~08:55 창의 매 틱**으로 바뀌었다(사용자 승인 「마감·이어받기 찬성」).
#   그래서 U4 의 「다른 잡 = 변경 전」 비교에서 **그 잡만 뺀다** — ⑨ 전에는 08:00 에 1회였다. 뺀 자리는 비지 않는다:
#   그 잡의 새 일정·창 경계·틱 yield·curl 상한은 src/app/api/cron/kis-fundamentals-snapshot/__tests__/cron-runner-block.test.ts 가
#   블록 단위 시뮬레이션으로 본다(T-117 daily-bars·T-118 peek 가 서로의 잡을 뺀 것과 같은 방식).
# (T-170) 국내 일봉 저녁(daily-bars?market=KR, 18:10 하루 1회)은 이 블록보다 뒤에 더해진 잡이라 변경 전 러너에 없다 — 같은 방식으로 뺀다
#   (그 잡의 일정·상한은 scripts/test-cron-runner-daily-bars-kr.sh 가 본다).
nouv() { grep -vE "$UVRE" "$1/calls" | grep -v ' /api/cron/kis-fundamentals-snapshot$' | grep -v ' /api/cron/daily-bars?market=KR$' | awk '{print $1, $2, $4}'; }

echo "U1. 2026-12-06(첫째 일요일) 하루 — 창 안 짝수 분에만 호출"
R1="$(run_loop u1 "$RUNNER" '2026-12-06 00:00:00' 1440)"
eq "U1: 호출 수 = 141회(창 280분 ÷ 2분 = 140 + 창 종료 점검 1)" "$(uvc "$R1")" "141"
eq "U1: 첫 호출 01:10 · 마지막 05:50(창 종료 점검)" \
   "$(grep -E "$UVRE" "$R1/calls" | head -1 | awk '{print $2}') $(grep -E "$UVRE" "$R1/calls" | tail -1 | awk '{print $2}')" \
   "01:10 05:50"
eq "U1: 홀수 분 호출 0회" "$(uvat "$R1" | tr ' ' '\n' | awk -F: 'NF==2 && $2 % 2 == 1' | wc -l | tr -d ' ')" "0"
eq "U1: 창 앞(01:10 전)·창 종료 점검 뒤(05:52 부터) 호출 0회" \
   "$(uvat "$R1" | tr ' ' '\n' | awk -F: 'NF==2 { m = $1 * 60 + $2; if (m < 70 || m > 350) print }' | wc -l | tr -d ' ')" "0"
# 🔴 종료 점검은 **정확히 한 틱**이다 — 창이 끝난 뒤 계속 부르면 경고 뒤에도 쓸모없는 호출이 남는다
eq "U1: 05:50(창 종료 점검) 정확히 1회" \
   "$(uvat "$R1" | tr ' ' '\n' | grep -c '^05:50$')" "1"
eq "U1: curl 상한은 120(그 호출에만)" \
   "$(grep -c '/api/cron/overseas-universe-refresh max-time=120' "$R1/maxtime")" "141"
# 120 을 쓰는 잡은 **원래** 둘 있다(실측): daily-bars(DAILY_BARS_CURL_MAX_TIME)·해외 post-market(PMO_CURL_MAX_TIME).
# (T-170) 국내 일봉 저녁(daily-bars?market=KR)이 같은 DAILY_BARS_CURL_MAX_TIME 을 쓴다 — 셋째로 더했다(의도된 상한, 그 블록 시험 K1 이 단언).
# 그 셋 말고 다른 잡이 120 을 쓰기 시작하면(= 내 CALL_MAX_TIME 설정이 새면) 이 단언이 깨진다.
eq "U1: 산출 호출 외에 120 상한을 쓰는 잡은 기존 셋뿐(상한이 새지 않았다)" \
   "$(grep 'max-time=120' "$R1/maxtime" | grep -v 'overseas-universe-refresh' | awk '{print $1}' | sort -u | tr '\n' ' ')" \
   "/api/cron/daily-bars /api/cron/daily-bars?market=KR /api/cron/post-market-analysis?market=overseas "

echo
echo "U2. 돌지 않아야 하는 날 — 호출 0회"
# 창(01:10~05:50) 을 덮는 330틱만 돈다 — 그 밖의 시각에는 블록이 **구조적으로** 닿지 않고(U1 이 하루 전체로 그것을 단언한다)
# 하루 1440틱 × 4일은 이 시험을 혼자 20분 넘게 끌었다. 00:55 시작이면 00:55~06:24 를 덮는다.
for d in '2026-12-01 00:55:00|평일(화)' '2026-12-13 00:55:00|둘째 일요일' '2026-12-05 00:55:00|첫째 토요일' '2026-11-02 00:55:00|평일(월)'; do
  start="${d%%|*}"; label="${d##*|}"
  Rx="$(run_loop "u2-$(echo "$start" | tr -d ' :-')" "$RUNNER" "$start" 330)"
  eq "U2: $label — 창 시각대 330틱에서 호출 0회" "$(uvc "$Rx")" "0"
done

echo
echo "U3. 경계"
R3a="$(run_loop u3a "$RUNNER" '2026-12-06 01:08:00' 3)"
eq "U3: 01:08 시작 3틱(01:08·01:09·01:10) → 01:10 1회뿐" "$(uvat "$R3a")" "01:10 "
R3b="$(run_loop u3b "$RUNNER" '2026-12-06 05:47:00' 4)"
eq "U3: 05:47 시작 4틱 → 05:48(산출) · 05:50(창 종료 점검)" "$(uvat "$R3b")" "05:48 05:50 "
R3c="$(run_loop u3c "$RUNNER" '2026-12-06 05:50:00' 10)"
eq "U3: 05:50 시작 10틱 → 05:50 1회뿐(05:52 부터 안 돎)" "$(uvat "$R3c")" "05:50 "
R3e="$(run_loop u3e "$RUNNER" '2026-12-06 05:52:00' 8)"
eq "U3: 05:52 시작 → 호출 0회(창도 종료 점검도 지났다)" "$(uvc "$R3e")" "0"
R3d="$(run_loop u3d "$RUNNER" '2026-12-06 01:11:00' 1)"
eq "U3: 01:11(홀수 분) 1틱 → 호출 0회" "$(uvc "$R3d")" "0"

echo
echo "U4. 🔴 이 블록을 뺀 다른 잡의 호출이 변경 전과 완전히 같다"
RB="$(run_loop base "$BEFORE" '2026-12-06 00:00:00' 1440)"
if [ "$(nouv "$R1" | sha256sum)" = "$(nouv "$RB" | sha256sum)" ]; then
  ok "U4: 다른 잡 호출 목록 동일($(nouv "$R1" | wc -l | tr -d ' ')줄)"
else
  bad "U4: 다른 잡 호출이 달라졌다"
  diff <(nouv "$RB") <(nouv "$R1") | head -20
fi
eq "U4: 변경 전 러너에는 이 잡이 없다" "$(uvc "$RB")" "0"
eq "U4: 변경 전 러너의 --max-time 목록 = 지금(산출 호출·T-145 ⑨ 스냅샷 제외)" \
   "$(grep -v 'overseas-universe-refresh' "$R1/maxtime" | grep -v '^/api/cron/kis-fundamentals-snapshot ' | grep -v '^/api/cron/daily-bars?market=KR ' | sort | uniq -c | sha256sum | cut -c1-16)" \
   "$(sort "$RB/maxtime" | uniq -c | sha256sum | cut -c1-16)"

echo
echo "U5. 정적"
BLK="$(awk '/^  # >>> overseas-universe-refresh/,/^  # <<< overseas-universe-refresh/' "$RUNNER")"
eq "U5: 블록이 정확히 한 번 있다" \
   "$(grep -c '^  # >>> overseas-universe-refresh' "$RUNNER") $(grep -c '^  # <<< overseas-universe-refresh' "$RUNNER")" "1 1"
eq "U5: 호출 줄 1개" "$(printf '%s\n' "$BLK" | grep -c '^    call "/api/cron/overseas-universe-refresh" "overseas-universe-refresh"$')" "1"
eq "U5: 상한을 그 호출 앞에서 켜고 바로 뒤에서 끈다" \
   "$(printf '%s\n' "$BLK" | grep -A2 'CALL_MAX_TIME="\$UNIVERSE_CURL_MAX_TIME"' | sed -n '3p' | sed 's/^ *//')" \
   'CALL_MAX_TIME=""'
# daily-bars D6 과 같은 형태 — **실행 줄만** 본다(주석에서 curl 상한·유량 예산을 설명하는 것은 이 뜻과 무관하다)
eq "U5: 블록 실행 줄에 비밀(CRON_SECRET·x-cron-secret)·curl 직접 호출 없음(call() 경유)" \
   "$(printf '%s\n' "$BLK" | grep -v '^[[:space:]]*#' | grep -ciE 'cron_secret|x-cron-secret|curl ')" "0"
eq "U5: 요일·일자 판정이 블록 안 변수로만" \
   "$(printf '%s\n' "$BLK" | grep -c 'UNIV_DOW=\$(date' ) $(printf '%s\n' "$BLK" | grep -c 'UNIV_DOM=\$(date')" "1 1"
# 🔴 종료 점검 틱은 **기존 줄을 바꾸지 않고 더해서** 켠다(T-145 ④-조각).
#   `cron-runner-block.test.ts` 의 「기존 줄 변경 0 — HEAD 대비 추가만」 규약을 이 블록도 지킨다 —
#   창 판정 줄(`05) [ "$UNIV_MM" -lt 50 ] && UNIV_WINDOW=yes ;;`)이 **그대로** 남아 있어야 한다.
eq "U5: 종전 창 판정 줄이 그대로다(더하기만 했다)" \
   "$(printf '%s\n' "$BLK" | grep -c '05) \[ "\$UNIV_MM" -lt 50 \] && UNIV_WINDOW=yes ;;')" "1"
eq "U5: 종료 점검 줄은 창 끝 분(05:50)에서만 켜지는 한 줄이다" \
   "$(printf '%s\n' "$BLK" | grep -c '^  if \[ "\$HH" = "05" \] && \[ "\$UNIV_MM" = "50" \]; then UNIV_WINDOW=yes; fi$')" "1"
eq "U5: 분을 읽을 수 없으면 돌지 않는다(방어 한 줄)" \
   "$(printf '%s\n' "$BLK" | grep -c 'case "\$UNIV_MM" in \[0-5\]\[0-9\]) ;; \*) UNIV_MM="" ;; esac')" "1"
eq "U5: call() 은 변경 전과 같다" \
   "$(awk '/^call\(\) \{/,/^\}/' "$RUNNER" | sha256sum | cut -c1-16)" \
   "$(awk '/^call\(\) \{/,/^\}/' "$BEFORE" | sha256sum | cut -c1-16)"
eq "U5: 날짜파일(상태)을 새로 만들지 않는다 — 창·간격이 호출 수를 묶는다" \
   "$(printf '%s\n' "$BLK" | grep -c 'LAST_RUN_FILE\|DONE_FILE')" "0"

echo
echo "결과: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
