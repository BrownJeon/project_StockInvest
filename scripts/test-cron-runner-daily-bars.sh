#!/usr/bin/env bash
# T-117 — cron-runner.sh 의 일봉 정기 증분 수집 블록(daily-bars-daily) 시험.
#
# 실행: bash scripts/test-cron-runner-daily-bars.sh   (NFS noexec 경로라 반드시 bash 경유)
#
# cron-runner.sh 를 **그대로** 돌린다 — curl·date·sleep 만 가짜(PATH 앞 스텁)로 바꿔 가짜 시각으로 틱을 흉내 낸다
# (test-cron-runner-news-peek.sh 와 같은 하네스). 변경 전 러너(git show $T117_BASE_REF:scripts/cron-runner.sh, 기본 faf8bc3 = T-116 커밋 =
# T-117 착수 기준)를 같은 하네스로 돌려 **daily-bars 를 뺀 모든 호출이 완전히 같음**을 비교로 증명한다.
#  D1. 하루 전체(1440틱): daily-bars = 07:40 1회뿐(07:40~07:54 밖 호출 0) · 본문 '{}'(본문 없음 = 라우트 기본 대상) · --max-time 120 ·
#      날짜파일 = 오늘 · yield/skip 로그 없음 · daily-bars 를 뺀 호출·--max-time 목록 = 변경 전
#  D2. 오류 응답(409·503·000 상한 초과) × 이틀: 날마다 07:40 정확히 1회(재시도 없음) · HTTP 로그 · 날짜파일 = 둘째 날 ·
#      409/503 은 daily-bars 를 뺀 호출 = 변경 전 · 000 은 하트비트 간격 < 300초
#  D3. 시각 경계: 07:39 에는 안 돎 · 07:54 시작이면 07:54 1회 · 07:55 시작이면 호출 0(08:10~08:27 라우트 허용 구간 포함 08:30 까지)·
#      건너뜀 로그 하루 1줄 · 날짜파일 없음 · 이미 돈 날 재기동이면 호출·로그 없음
#  D4. 🔴 같은 틱 미루기(yield): 재기동 07:45(날짜파일 전부 어제) → 07:45 research·edgar / 07:46 broker-fills / 07:47 daily-bars ·
#      research·edgar·broker-fills 중 하나만 어제여도 그 틱은 미룸 · 07:53 재기동이면 그날 건너뜀(로그 1줄)
#  D5. 🔴 하트비트: 07:40 틱에서 daily-bars 상한(120)+stop-alert 상한(20) = 간격 200초 · 느린 재기동(research 100·edgar 100·broker 90·
#      daily-bars 120) 전 구간 간격 < 300초이며 daily-bars 는 무거운 잡과 다른 틱
#  D6. 정적: 블록·DAILY_BARS_* 선언·주석을 빼면 실행 줄이 변경 전과 한 글자도 같다 · call() 불변 · 호출 줄 1개 · 상한은 그 호출에만 ·
#      yield 판단은 LAST_* 변수 · 블록 위치 · 비밀 헤더를 블록에서 다루지 않음 · 변경 전 줄이 전부 그대로(추가만)
# (T-118 병합) 변경 전 러너 = faf8bc3 러너에서 **peek 블록(news-fetch-peek)과 상단 peek 잡 주석만 현재 러너의 것으로 바꿔 끼운 것**.
#   T-118 이 peek 슬롯·상한을 바꿔도 이 시험의 비교(D1 호출·상한 목록, D6 정적·추가만)는 daily-bars 변경만 보게 된다 — D6 정적 비교는
#   peek 블록을 양쪽에서 똑같이 한 번 더 뺀다. daily-bars 기대값은 그대로다.
# (T-119 병합) holdings-premarket(ET 08시 평일 — KST 21·22시)은 현재 러너에만 있는 무관한 잡이라, 그 호출은 D1 등 호출 비교(nodb)와
#   --max-time 목록 비교에서 빼고, D6 정적 비교는 그 블록(>>> ~ <<< holdings-premarket)·HOLDINGS_PREMARKET_* 선언을 양쪽에서 똑같이 뺀다
#   (블록 안 HP_* 변수는 블록과 함께 빠진다). 범위 정교화일 뿐 daily-bars 기대값·단언 개수는 그대로다.
# (T-170 병합) 국내 저녁 블록(daily-bars-daily-kr, 18:10~18:54)이 경로 /api/cron/daily-bars?market=KR 를 부른다(쿼리라 07:40 호출의
#   경로 ' /api/cron/daily-bars$' 와 구별된다 — DBRE·본문 기록은 07:40 호출만 그대로 잡는다). 그 호출은 nodb·--max-time 비교에서 빼고
#   (holdings-premarket 과 같은 방식), D6 정적은 07:40 블록 표지를 정확히 고른다(새 블록 표지 daily-bars-daily-kr 이 이 표지를 접두로
#   포함한다 — strip_new 의 접두 정규식은 그 블록도 함께 지우는데, 그것이 원하는 동작이다). 저녁 블록 자체는
#   scripts/test-cron-runner-daily-bars-kr.sh 가 본다. 07:40 블록의 기대값(시각·본문·상한·yield·건너뜀·하트비트)·단언은 그대로다.
# (T-156·T-160 병합, T-171) 두 task 가 러너를 바꾸고 이 시험의 비교 범위를 넓히지 않아 D1·D6 이 기준 ref 와 어긋났다(T-171 판정: 시험 낡음).
#   T-156 의 m40 블록·선언·call() 분기 2줄·호출(call() 경유 2개 + call() 밖 상태 확인 curl 1개)을 호출·--max-time 비교와 D6 정적에서 빼고,
#   T-160 의 call() 줄은 job-run-log 시험 J8 의 no_t160 과 같은 치환으로 되돌린다(아래 T-171 도우미). daily-bars 기대값·기존 단언은 그대로다.
# 외부 호출 없음(curl 은 스텁), 실제 HOME·.env 를 읽지 않음(임시 디렉터리).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="${T117_RUNNER:-$HERE/cron-runner.sh}"   # 변이 시험용 덮어쓰기
BASE_REF="${T117_BASE_REF:-faf8bc3}"
REAL_DATE="$(command -v date)"
PASS=0; FAIL=0
ok()   { PASS=$((PASS + 1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
eq()   { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (기대 '$3', 실제 '$2')"; fi; }

# ── (T-171) T-156·T-160 이 기준 ref 뒤에 러너에 더한 것 — 비교에서 빼는 도우미(표준입력 → 표준출력) ─────────────
#   T-156(m40 모의 평가, Reviewer PASS·운영 반영): 메인 루프 블록 m40-forward-daily·m40-forecast-daily, 최상위 함수 블록 m40-state-write,
#     선언 M40_FORWARD_LAST_RUN_FILE, call() 의 「m40-forward 202 → ACCEPTED」 로그 분기 2줄. 호출은 call() 경유 /api/cron/m40-forward(상한 10)·
#     /api/cron/m40-forecast(상한 150)와 call() 밖 상태 확인 curl /api/cron/m40-forward?status=1(상한 5) — ET 06:45~09:00 창이라
#     하루 전체 시나리오에서는 KST 19:45~22:00(EDT)·20:45~23:00(EST)에 돈다. 그 블록·분기는 scripts/test-cron-runner-m40-forward.sh·m40-forecast.sh 가 본다.
#   T-160(홈 실행 실패 표시, Reviewer PASS): call() 세 줄 — curl 종료 코드를 기록용 변수에 복사하는 두 줄(job-run-log 시험 J8 의 원래 no_t160 과
#     같은 치환)과 그 값을 jrl_hook 에 넘기는 후크 호출 줄(`# T-112 jrl` 표지 줄이라 그 표지를 지우는 비교에는 영향 없음)을 되돌린다.
#   빼거나 되돌리는 줄이 엉뚱한 곳에 생기면 범위가 무검사로 넓어지므로 정적 절(D6)이 그 줄들이 파일 전체에 각 1개(모두 call() 안)인지 따로 단언한다.
M40RE=' /api/cron/m40-(forward(\?status=1)?|forecast)$'        # 호출 기록 줄(…경로)
M40MT='^/api/cron/m40-(forward(\?status=1)?|forecast) '         # --max-time 기록 줄(경로 max-time=N)
T156_L1='  elif [ "$label" = "m40-forward" ] && [ "$path" = "/api/cron/m40-forward" ] && [ "$code" = "202" ]; then'
T156_L2='    echo "[$ts] $label ACCEPTED completed=false"'
no_t156_call() { grep -vxF "$T156_L1" | grep -vxF "$T156_L2"; }
no_t156() { awk '/^ *# >>> (m40-forward-daily|m40-forecast-daily|m40-state-write)$/{s=1} s{ if (/^ *# <<< (m40-forward-daily|m40-forecast-daily|m40-state-write)$/) s=0; next } {print}' \
  | grep -v '^M40_FORWARD_LAST_RUN_FILE=' | no_t156_call; }
T160_L3='  jrl_hook "$label" "$path" "$code" "${jrl_t0:-}" "$curl_exit" 2>/dev/null || true   # T-112 jrl'
no_t160() { sed -e 's/^  local code curl_exit=0$/  local code/' -e 's/|| { curl_exit=\$?; code="000"; }$/|| code="000"/' \
                -e 's/^\(  jrl_hook "\$label" "\$path" "\$code" "\${jrl_t0:-}"\) "\$curl_exit" \(2>\/dev\/null || true   # T-112 jrl\)$/\1 \2/'; }
t171_targets() {   # 러너 → "파일 전체 개수 5개 | call() 안 개수 5개" (T-156 2줄 · T-160 3줄)
  local cb; cb="$(awk '/^call\(\) \{/,/^\}/' "$1")"
  echo "$(grep -cxF "$T156_L1" "$1") $(grep -cxF "$T156_L2" "$1") $(grep -c '^  local code curl_exit=0$' "$1") $(grep -c '|| { curl_exit=\$?; code="000"; }$' "$1") $(grep -cxF "$T160_L3" "$1") | $(printf '%s\n' "$cb" | grep -cxF "$T156_L1") $(printf '%s\n' "$cb" | grep -cxF "$T156_L2") $(printf '%s\n' "$cb" | grep -c '^  local code curl_exit=0$') $(printf '%s\n' "$cb" | grep -c '|| { curl_exit=\$?; code="000"; }$') $(printf '%s\n' "$cb" | grep -cxF "$T160_L3")"
}

W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT

BEFORE="$W/runner-before.sh"
BASEFILE="$W/runner-base.sh"
if ! git -C "$HERE/.." show "$BASE_REF:scripts/cron-runner.sh" > "$BASEFILE" 2>/dev/null || [ ! -s "$BASEFILE" ]; then
  echo "변경 전 러너($BASE_REF:scripts/cron-runner.sh)를 읽지 못함 — 비교 시험을 할 수 없다(T117_BASE_REF 로 지정 가능)"
  exit 1
fi
# (T-118 병합) 기준 러너의 peek 블록(>>> ~ <<< news-fetch-peek)과 상단 peek 잡 주석(`#  - news-peek-` 줄 + 이어지는 들여쓴 주석 줄)을
#   현재 러너($RUNNER)의 것으로 바꿔 끼운다 — 나머지 줄은 기준 ref 그대로.
awk -v cf="$RUNNER" '
  BEGIN { while ((getline l < cf) > 0) {
            if (l ~ /^  # >>> news-fetch-peek/) s = 1; if (s) blk = blk l "\n"; if (l ~ /^  # <<< news-fetch-peek/) s = 0
            if (l ~ /^#  - news-peek-/) h = 1; else if (h && l !~ /^#                        /) h = 0; if (h) hdr = hdr l "\n" } }
  /^#  - news-peek-/ { printf "%s", hdr; hs = 1; next }
  hs { if ($0 ~ /^#                        /) next; hs = 0 }
  /^  # >>> news-fetch-peek/ { printf "%s", blk; skip = 1; next }
  skip { if (/^  # <<< news-fetch-peek/) skip = 0; next }
  { print }' "$BASEFILE" > "$BEFORE"
if [ "$(awk '/^  # >>> news-fetch-peek/,/^  # <<< news-fetch-peek/' "$BEFORE" | sha256sum)" != "$(awk '/^  # >>> news-fetch-peek/,/^  # <<< news-fetch-peek/' "$RUNNER" | sha256sum)" ] \
   || [ "$(grep -c '^  # >>> news-fetch-peek' "$BEFORE")" != "1" ]; then
  echo "기준 러너 조립 실패 — peek 블록을 바꿔 끼우지 못함"; exit 1
fi

ep() { TZ=Asia/Seoul "$REAL_DATE" -d "$1" +%s; }

# run_loop NAME RUNNER START TICKS DB_MODE [HEAVY [JUMP_AT JUMP_TO [SEEDS]]]
#  DB_MODE(daily-bars 응답): ok(200) | 409 | 503 | timeout(curl 상한만큼 시계가 흐르고 000·exit 28)
#  HEAVY: 0 | slow(research-cycle-overseas 100초·edgar-sync 100초·broker-fills 90초 흐른 뒤 200) | sahang(stop-alert 가 상한까지 늘어짐 000)
#  JUMP_AT/JUMP_TO: sleep 이 시계를 JUMP_AT 이상으로 밀면 한 번 JUMP_TO 로 옮긴다(다음 날로 건너뛰기). 0 이면 없음.
#  SEEDS: 공백 구분 "날짜파일이름=내용" 목록 — 러너 시작 전에 ~/.node-local/stockinvest/ 에 미리 써 둔다(재기동 흉내).
# 호출 기록 한 줄: "MM-DD HH:MM 틱번호 경로"
run_loop() {
  local name="$1" runner="$2" start="$3" ticks="$4" mode="$5" heavy="${6:-0}" jat="${7:-0}" jto="${8:-0}" seeds="${9:-}" R="$W/$1" s
  mkdir -p "$R/bin" "$R/home/.node-local/stockinvest" "$R/proj"
  for s in $seeds; do printf '%s\n' "${s#*=}" > "$R/home/.node-local/stockinvest/${s%%=*}"; done
  printf 'CRON_SECRET=test-secret\n' > "$R/proj/.env"
  ep "$start" > "$R/clock"
  cat > "$R/bin/date" <<EOF
#!/usr/bin/env bash
exec "$REAL_DATE" -d "@\$(cat "$R/clock")" "\$@"
EOF
  cat > "$R/bin/sleep" <<EOF
#!/usr/bin/env bash
cat "$R/home/.node-local/stockinvest/cron-heartbeat" >> "$R/heartbeats" 2>/dev/null
c=\$(( \$(cat "$R/clock") + \${1%%[!0-9]*} ))
if [ $jat -gt 0 ] && [ ! -e "$R/jumped" ] && [ \$c -ge $jat ]; then c=$jto; touch "$R/jumped"; fi
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
# (T-112) 실행·상태 기록 전송(POST /api/cron/job-run-log — 러너 틱 끝, call() 밖)은 이 시험의 대상이 아니다: 호출·--max-time 목록과 시계에
#   넣지 않고 200 으로 답한다(받은 줄은 버림). 전송·후크 자체와 "후크가 켜져도 다른 호출 = 기준 러너"는 scripts/test-cron-runner-job-run-log.sh 가 본다.
[ "\$path" = "/api/cron/job-run-log" ] && { printf '200'; exit 0; }
echo "\$("$REAL_DATE" -d "@\$(cat "$R/clock")" '+%m-%d %H:%M') \$(cat "$R/ticks" 2>/dev/null || echo 0) \$path" >> "$R/calls"
[ -n "\$mt" ] && echo "\$path max-time=\$mt" >> "$R/maxtime"
adv() { c=\$(cat "$R/clock"); echo \$((c + \$1)) > "$R/clock"; }
timeout_like() { adv "\${mt:-0}"; [ -n "\$out" ] && : > "\$out"; printf '000'; exit 28; }
code=200
case "\$path" in
  /api/cron/daily-bars)
    echo "\$body" >> "$R/dbody"
    case "$mode" in
      409) code=409 ;;
      503) code=503 ;;
      timeout) timeout_like ;;
    esac ;;
  /api/cron/research-cycle-overseas) [ "$heavy" = slow ] && adv 100 ;;
  /api/cron/edgar-sync)              [ "$heavy" = slow ] && adv 100 ;;
  /api/cron/broker-fills)            [ "$heavy" = slow ] && adv 90 ;;
  /api/cron/stop-alert)              [ "$heavy" = sahang ] && timeout_like ;;
esac
[ -n "\$out" ] && echo '{"ok":false}' > "\$out"
printf '%s' "\$code"
EOF
  chmod +x "$R/bin/date" "$R/bin/sleep" "$R/bin/curl"
  : > "$R/calls"; : > "$R/maxtime"; : > "$R/dbody"
  # (T-147) ALERT_TICKER_DISABLE=1 = 레거시 모드(티커 자식 없음 · 메인 루프가 매 틱 stop-alert 호출 · 하트비트 추가 쓰기 없음)
  #   = **T-147 이전 동작**. 이 하네스는 자기 잡의 회귀망이고 기대값(일정·호출 목록·하트비트 간격)이 그 동작 기준이므로 그대로 쓴다.
  #   기본 모드(티커가 분 경계마다 부르고 죽으면 메인 루프가 이어받는다)는 scripts/test-cron-runner-alert-ticker.sh 가 본다.
  PATH="$R/bin:$PATH" HOME="$R/home" PROJECT_DIR="$R/proj" BASE_URL="http://stub" TZ=Asia/Seoul ALERT_TICKER_DISABLE=1 \
    timeout 900 bash "$runner" > "$R/stdout" 2>&1
  echo "$R"
}

DBRE=' /api/cron/daily-bars$'
dbc()    { grep -E "$DBRE" "$1/calls"; }
dbat()   { dbc "$1" | awk '{print $1, $2}' | tr '\n' ' '; }
nodb()   { grep -vE "$DBRE" "$1/calls" | grep -v ' /api/cron/daily-bars?market=KR$' | grep -v ' /api/cron/holdings-premarket$' | grep -v ' /api/cron/kis-fundamentals-snapshot$' | grep -vE "$M40RE" | awk '{print $1, $2, $4}'; }   # (T-119 병합) holdings-premarket·(T-145 ⑨) kis-fundamentals-snapshot 제외 — ⑨ 가 그 잡을 08:30~08:55 창의 매 틱으로 바꿨다(사용자 승인). 그 일정은 src/app/api/cron/kis-fundamentals-snapshot/__tests__/cron-runner-block.test.ts 가 본다 · (T-171) T-156 m40 호출 3경로 제외
allc()   { awk '{print $1, $2, $4}' "$1/calls"; }
# (T-145 ⑨) 기준 러너 쪽에서도 kis-fundamentals-snapshot 을 뺀다 — nodb 가 새 러너에서만 빼면 기준의 08:00 1회가 남아 어긋난다
allc_nokf() { grep -v ' /api/cron/kis-fundamentals-snapshot$' "$1/calls" | awk '{print $1, $2, $4}'; }
df()     { cat "$1/home/.node-local/stockinvest/$2" 2>/dev/null || echo none; }
gap()    { awk 'NR>1 { g = $1 - p; if (g > m) m = g } { p = $1 } END { print m + 0 }' "$1/heartbeats"; }
gapj()   { awk 'NR>1 { g = $1 - p; if (g < 3600 && g > m) m = g } { p = $1 } END { print m + 0 }' "$1/heartbeats"; }   # 다음 날 건너뛰기 간격 제외
ylog()   { grep -c 'daily-bars yield_tick' "$1/stdout"; }
slog()   { grep -c 'daily-bars skipped' "$1/stdout"; }
heavyat() { grep -E ' /api/cron/(research-cycle-overseas|edgar-sync|broker-fills)$' "$1/calls" | awk '{ sub(/\/api\/cron\//, "", $4); print $2, $4 }' | tr '\n' ' '; }
same()   {   # same 라벨 새러너결과 옛러너결과 — daily-bars 를 뺀 호출 목록이 변경 전 러너와 완전히 같은가
  if diff <(nodb "$2") <(allc_nokf "$3") > /dev/null; then ok "🔴 $1: daily-bars 를 뺀 모든 호출 = 변경 전 러너 ($(nodb "$2" | wc -l | tr -d ' ')건)"
  else bad "$1: daily-bars 를 뺀 호출 목록이 변경 전과 다르다"; diff <(nodb "$2") <(allc_nokf "$3") | head -10; fi
}
TD="2026-10-28"; YD="2026-10-27"
ALL_TODAY="research-cycle-overseas-last-date=$TD edgar-sync-last-date=$TD broker-fills-last-date=$TD"
ALL_YDAY="research-cycle-overseas-last-date=$YD edgar-sync-last-date=$YD broker-fills-last-date=$YD daily-bars-last-date=$YD"

# ── D1. 하루 전체 ─────────────────────────────────────────────────────────────────
echo "D1. 하루 전체 1440틱 (00:00~23:59)"
NA="$(run_loop new-day "$RUNNER" "$TD 00:00:00" 1440 ok)"
BA="$(run_loop old-day "$BEFORE" "$TD 00:00:00" 1440 ok)"
eq "D1: 새 러너 1440틱 완주" "$(cat "$NA/ticks")" "1440"
eq "D1: 변경 전 러너 1440틱 완주" "$(cat "$BA/ticks")" "1440"
eq "(하네스 확인) 변경 전 러너: daily-bars 호출 없음" "$(dbc "$BA" | wc -l | tr -d ' ')" "0"
eq "🔴 D1: daily-bars = 07:40 하루 1회" "$(dbat "$NA")" "10-28 07:40 "
eq "🔴 D1: 07:40~07:54 밖의 daily-bars 호출 0" "$(dbc "$NA" | awk '{print $2}' | grep -cvE '^07:(4[0-9]|5[0-4])$')" "0"
eq "D1: 본문 = '{}'(본문 없음 → 라우트 기본 대상)" "$(sort -u "$NA/dbody" | tr '\n' ' ')" "{} "
eq "🔴 D1: daily-bars 호출에 --max-time 120" "$(grep '^/api/cron/daily-bars ' "$NA/maxtime" | tr '\n' ' ')" "/api/cron/daily-bars max-time=120 "
# (T-145 ⑨) 스냅샷의 --max-time(110)은 그 블록 시험이 본다 — 여기서는 뺀다 · (T-171) T-156 m40 세 경로의 상한(10·150·5)도 m40 시험 몫이라 뺀다
if diff <(grep -v '^/api/cron/daily-bars ' "$NA/maxtime" | grep -v '^/api/cron/daily-bars?market=KR ' | grep -v '^/api/cron/holdings-premarket ' | grep -v '^/api/cron/kis-fundamentals-snapshot ' | grep -vE "$M40MT") "$BA/maxtime" > /dev/null; then ok "🔴 D1: daily-bars 를 뺀 --max-time 목록 = 변경 전(상한이 다른 잡에 새지 않음)"
else bad "D1: --max-time 목록이 다르다"; diff <(grep -v '^/api/cron/daily-bars ' "$NA/maxtime" | grep -v '^/api/cron/daily-bars?market=KR ' | grep -v '^/api/cron/holdings-premarket ' | grep -v '^/api/cron/kis-fundamentals-snapshot ' | grep -vE "$M40MT") "$BA/maxtime" | head -5; fi
eq "D1: 날짜파일 = 오늘" "$(df "$NA" daily-bars-last-date)" "$TD"
eq "D1: OK 로그 1줄" "$(grep -c '\] daily-bars OK$' "$NA/stdout")" "1"
eq "D1: yield 로그 없음(07:00·07:20 틱과 다른 틱)" "$(ylog "$NA")" "0"
eq "D1: 건너뜀 로그 없음" "$(slog "$NA")" "0"
eq "D1: 07:40 틱에 무거운 잡 없음(research·edgar 07:00, broker-fills 07:20)" "$(heavyat "$NA")" "07:00 research-cycle-overseas 07:00 edgar-sync 07:20 broker-fills "
eq "D1: 07:40 틱에 08시 잡 없음" "$(grep -cE ' 07:4[0-9] [0-9]+ /api/cron/(post-market-analysis|kis-fundamentals-snapshot)' "$NA/calls")" "0"
same "D1" "$NA" "$BA"
g="$(gap "$NA")"; eq "D1: 하트비트 간격 최대 60초(스텁 즉시 응답)" "$g" "60"

# ── D2. 오류 응답 × 이틀 ──────────────────────────────────────────────────────────
echo "D2. 오류 응답(409·503·000) — 07:35~07:59 × 이틀 (각 25틱, 08:00 에 다음 날 07:35 로 건너뜀)"
JA=$(ep "$TD 08:00:00"); JT=$(ep "2026-10-29 07:35:00")
BO="$(run_loop d2-old "$BEFORE" "$TD 07:35:00" 50 ok 0 "$JA" "$JT")"
eq "D2: 변경 전 러너 50틱 완주" "$(cat "$BO/ticks")" "50"
for m in 409 503 timeout; do
  R="$(run_loop "d2-$m" "$RUNNER" "$TD 07:35:00" 50 "$m" 0 "$JA" "$JT")"
  c="$m"; [ "$m" = timeout ] && c="000"
  eq "d2-$m: 50틱 완주" "$(cat "$R/ticks")" "50"
  eq "🔴 d2-$m: HTTP $c 여도 날마다 07:40 정확히 1회(재시도 없음)" "$(dbat "$R")" "10-28 07:40 10-29 07:40 "
  eq "d2-$m: 실패 로그 = 날마다 1줄(HTTP=$c)" "$(grep -c "daily-bars HTTP=$c" "$R/stdout")" "2"
  eq "🔴 d2-$m: 날짜파일 = 둘째 날(실패여도 기록)" "$(df "$R" daily-bars-last-date)" "2026-10-29"
  eq "d2-$m: 건너뜀·yield 로그 없음" "$(slog "$R") $(ylog "$R")" "0 0"
  if [ "$m" = timeout ]; then
    g="$(gapj "$R")"
    if [ "$g" -lt 300 ]; then ok "🔴 d2-timeout: 하트비트 간격 최대 ${g}초 < 300초"; else bad "d2-timeout: 하트비트 간격 ${g}초 ≥ 300"; fi
    eq "d2-timeout: 최대 간격 = 상한 120 + sleep 60" "$g" "180"
    eq "d2-timeout: 다음 틱은 07:43(07:40 + 120초 + 60초)" "$(grep -E ' /api/cron/entry-watcher$' "$R/calls" | awk '$1=="10-28"{print $2}' | sed -n '7p')" "07:43"
  else
    same "d2-$m" "$R" "$BO"
  fi
done

# ── D3. 시각 경계·재기동 ──────────────────────────────────────────────────────────
echo "D3. 시각 경계"
R="$(run_loop d3-0739 "$RUNNER" "$TD 07:39:00" 3 ok 0 0 0 "$ALL_TODAY")"
eq "🔴 D3: 07:39 에는 안 돎 · 07:40 1회" "$(dbat "$R")" "10-28 07:40 "
R="$(run_loop d3-0754 "$RUNNER" "$TD 07:54:00" 3 ok 0 0 0 "$ALL_TODAY")"
eq "🔴 D3: 07:54 시작 → 07:54 1회(창의 마지막 분)" "$(dbat "$R")" "10-28 07:54 "
eq "D3: 07:54 에 돌았으면 07:55 건너뜀 로그 없음" "$(slog "$R")" "0"
R="$(run_loop d3-0755 "$RUNNER" "$TD 07:55:00" 36 ok 0 0 0 "$ALL_TODAY")"
eq "D3: 07:55~08:30 36틱 완주" "$(cat "$R/ticks")" "36"
eq "🔴 D3: 07:55 이후 시작 → 호출 0(라우트 허용 구간 08:10~08:27 포함)" "$(dbc "$R" | wc -l | tr -d ' ')" "0"
eq "🔴 D3: 건너뜀 로그 = 1줄(36틱 돌아도)" "$(slog "$R")" "1"
grep -q "\[$TD 07:55:00\] daily-bars skipped" "$R/stdout" && ok "D3: 건너뜀 로그 시각 07:55" || bad "D3: 07:55 건너뜀 로그 없음"
eq "D3: 건너뛴 날은 날짜파일을 쓰지 않음" "$(df "$R" daily-bars-last-date)" "none"
R="$(run_loop d3-late "$RUNNER" "$TD 15:00:00" 10 ok 0 "$(ep "$TD 15:05:00")" "$(ep "2026-10-29 03:00:00")" "$ALL_TODAY")"
eq "D3: 15:00 시작(첫날) → 건너뜀 로그 1줄, 다음 날 03시(00:00~07:54)에는 로그 없음" "$(slog "$R")" "1"
R="$(run_loop d3-done "$RUNNER" "$TD 07:45:00" 20 ok 0 0 0 "$ALL_TODAY daily-bars-last-date=$TD")"
eq "🔴 D3: 이미 돈 날 07:45 재기동 → 호출 0" "$(dbc "$R" | wc -l | tr -d ' ')" "0"
eq "D3: 이미 돈 날은 건너뜀 로그 없음(08시대 포함)" "$(slog "$R")" "0"
R="$(run_loop d3-yday "$RUNNER" "$TD 07:45:00" 2 ok 0 0 0 "$ALL_TODAY daily-bars-last-date=$YD")"
eq "D3: 날짜파일이 어제면 07:45 첫 틱에 1회" "$(dbat "$R")" "10-28 07:45 "

# ── D4. 같은 틱 미루기 ────────────────────────────────────────────────────────────
echo "D4. 같은 틱 미루기(yield)"
R="$(run_loop d4-restart "$RUNNER" "$TD 07:45:00" 6 ok 0 0 0 "$ALL_YDAY")"
eq "D4: 재기동 07:45 — 무거운 잡 = 07:45 research·edgar, 07:46 broker-fills" "$(heavyat "$R")" "07:45 research-cycle-overseas 07:45 edgar-sync 07:46 broker-fills "
eq "🔴 D4: daily-bars = 07:47(무거운 잡 다음 틱) 1회" "$(dbat "$R")" "10-28 07:47 "
eq "D4: yield 로그 2줄(07:45·07:46)" "$(ylog "$R")" "2"
eq "D4: 날짜파일 = 오늘" "$(df "$R" daily-bars-last-date)" "$TD"
for one in research-cycle-overseas edgar-sync broker-fills; do
  seeds="$(printf '%s\n' $ALL_TODAY | sed "s/^$one-last-date=.*/$one-last-date=$YD/" | tr '\n' ' ')"
  R="$(run_loop "d4-only-$one" "$RUNNER" "$TD 07:45:00" 3 ok 0 0 0 "$seeds")"
  eq "🔴 D4: $one 만 이 틱(07:45)에 돌아도 daily-bars 는 07:46 으로 미룸" "$(heavyat "$R")|$(dbat "$R")" "07:45 $one |10-28 07:46 "
done
R="$(run_loop d4-0752 "$RUNNER" "$TD 07:52:00" 4 ok 0 0 0 "$ALL_YDAY")"
eq "D4: 07:52 재기동 → 07:52 research·edgar / 07:53 broker / 07:54 daily-bars" "$(heavyat "$R")|$(dbat "$R")" \
   "07:52 research-cycle-overseas 07:52 edgar-sync 07:53 broker-fills |10-28 07:54 "
R="$(run_loop d4-0753 "$RUNNER" "$TD 07:53:00" 10 ok 0 0 0 "$ALL_YDAY")"
eq "🔴 D4: 07:53 재기동 → 미루기가 07:55 를 넘겨 그날 건너뜀(호출 0)" "$(dbc "$R" | wc -l | tr -d ' ')" "0"
eq "D4: 07:53 재기동 — yield 2줄 · 건너뜀 로그 1줄 · 날짜파일 = 어제 그대로" "$(ylog "$R") $(slog "$R") $(df "$R" daily-bars-last-date)" "2 1 $YD"

# ── D5. 하트비트 ──────────────────────────────────────────────────────────────────
echo "D5. 하트비트"
R="$(run_loop d5-worst "$RUNNER" "$TD 07:39:00" 4 timeout sahang 0 0 "$ALL_TODAY")"
eq "D5: 07:40 1회" "$(dbat "$R")" "10-28 07:40 "
eq "🔴 D5: 07:40 틱 최악(daily-bars 120 + stop-alert 20 + sleep 60) = 200초 < 300" "$(gap "$R")" "200"
R="$(run_loop d5-slow "$RUNNER" "$TD 07:40:00" 6 timeout slow 0 0 "$ALL_YDAY")"
eq "D5: 느린 재기동 — research 07:40·edgar 07:41(같은 틱) · broker 07:44 · daily-bars 07:46(전부 다른 틱)" "$(heavyat "$R")|$(dbat "$R")" \
   "07:40 research-cycle-overseas 07:41 edgar-sync 07:44 broker-fills |10-28 07:46 "
g="$(gap "$R")"
if [ "$g" -lt 300 ]; then ok "🔴 D5: 느린 재기동 전 구간 하트비트 간격 최대 ${g}초 < 300초"; else bad "D5: 하트비트 간격 ${g}초 ≥ 300"; fi
eq "D5: 최대 간격 = research 100 + edgar 100 + sleep 60(변경 전부터 있던 07:00 틱 — daily-bars 가 더하지 않음)" "$g" "260"
BS="$(run_loop d5-slow-old "$BEFORE" "$TD 07:40:00" 6 timeout slow 0 0 "$ALL_YDAY")"
eq "D5: 같은 조건 변경 전 러너 최대 간격도 260초(daily-bars 가 최악 틱을 늘리지 않음)" "$(gap "$BS")" "260"

# ── D6. 정적 ──────────────────────────────────────────────────────────────────────
echo "D6. 정적"
eq "bash -n" "$(bash -n "$RUNNER" 2>&1 && echo ok)" "ok"
no_peek()   { awk '/^  # >>> news-fetch-peek/{s=1} s{ if (/^  # <<< news-fetch-peek/) s=0; next } {print}' "$1" \
  | awk '/^  # >>> holdings-premarket/{s=1} s{ if (/^  # <<< holdings-premarket/) s=0; next } {print}' | grep -v '^HOLDINGS_PREMARKET_' \
  | awk '/^  # >>> overseas-universe-refresh/{s=1} s{ if (/^  # <<< overseas-universe-refresh/) s=0; next } {print}' | grep -v '^UNIVERSE_CURL_MAX_TIME='; }   # (T-118 병합) peek · (T-119 병합) holdings-premarket · (T-143 병합) overseas-universe-refresh 블록·선언 — 양쪽에서 똑같이
# (T-145 ⑨) **기준 러너 쪽**의 옛 kis-fundamentals-snapshot 구간을 범위로 지운다 — 지금 러너 쪽은
#   `# >>> kis-fundamentals-snapshot` 블록 표식으로 지우지만 기준 ref 에는 그 표식이 없어 한쪽만 지워지면 어긋난다.
#   (news-split 의 strip_old 가 뉴스 구간을 같은 방식으로 지우는 선례와 같다. 그 잡의 새 모양은 자기 블록 시험이 본다.)
no_kf_old() { awk '/^  # 매일 08:00 KST: KIS 해외 현재가상세 스냅샷/{s=1} s{ if (/^  fi$/) s=0; next } {print}'; }
# (T-147) T-147 은 블록을 **더하고**(최상위 alert-ticker · 메인 루프의 alert-ticker-supervise·stop-alert-fallback·heartbeat-refresh)
#   메인 루프의 옛 stop-alert 호출 4줄(주석 1 + 실행 3)을 **의도적으로 조건부로 옮겼다**(호출자는 플래그 하나로 항상 하나). 그래서
#   한쪽만 지우면 어긋난다 — 지금 러너 쪽은 블록 표식으로, **기준 ref 쪽**은 그 4줄과 머리 주석 1줄을 범위로 지운다(위 no_kf_old 선례와 같다).
#   T-147 의 새 모양(호출자 하나·fail-open·감독·분 경계)은 scripts/test-cron-runner-alert-ticker.sh 가 본다.
no_t147()     { awk '/^ *# >>> (alert-ticker|stop-alert-fallback|heartbeat-refresh)/{s=1} s{ if (/^ *# <<< (alert-ticker|stop-alert-fallback|heartbeat-refresh)/) s=0; next } {print}'; }
no_t147_old() { awk '/^  # 매 1분: stop-alert/{s=1} s{ if (/^  CALL_MAX_TIME=""$/) s=0; next } {print}' | grep -v '^#  - stop-alert        : 1분'; }
# (T-149) 기준 ref 쪽에서 **주석 1줄**을 뺀다 — T-062 선언 머리의 「하트비트는 tick 시작에만 쓰인다」는 전제가 T-147 의 틱 끝 갱신
#   이후로 더는 참이 아니어서 러너에서 문구를 고쳤다(계산·결론·실행 줄은 그대로. 바뀐 것은 전제 서술과 "보수적 과대 추정"이라는 단서뿐).
#   아래 "추가만" 대조는 **주석을 포함**하므로 한쪽만 바꾸면 어긋난다(위 no_kf_old·no_t147_old 선례와 같다. strip_new/strip_old
#   경로는 주석을 전부 지우므로 영향 없다). 기준 ref 와 러너 양쪽에서 각각 정확히 1줄만 걸린다(접두 유일 — 실측).
no_t149_old() { grep -v '^# (T-062 Codex C2 ②) 해외 post-market'; }
strip_new() { no_peek "$1" | no_t147 | awk '/^  # >>> (daily-bars-daily|kis-fundamentals-snapshot)/{s=1} s{ if (/^  # <<< (daily-bars-daily|kis-fundamentals-snapshot)/) s=0; next } {print}' \
  | grep -v '^DAILY_BARS_' | grep -v '^KIS_FUND_' | grep -v '^[[:space:]]*KIS_FUND_TICK_T0=' | grep -v '^[[:space:]]*#' | grep -v '^[[:space:]]*$'; }   # (T-145 ⑨ kis-fundamentals-snapshot — 일정이 바뀐 잡. 그 일정은 자기 블록의 jest 시뮬레이션 시험이 본다)
strip_old() { no_peek "$1" | no_kf_old | no_t147_old | grep -v '^[[:space:]]*#' | grep -v '^[[:space:]]*$'; }
# (T-112) 실행·상태 기록 후크(최상위 job-run-log-spool 블록 · `# T-112 jrl` 표지 줄 4개)는 이 정적 비교의 대상이 아니다 — 새 러너 쪽에서만 뺀다
#   (기준 ref 에는 없다). 후크가 추가만 했는지·call() 의 나머지가 그대로인지는 scripts/test-cron-runner-job-run-log.sh J8 이 본다.
# (T-135) call() 의 본문 임시 파일 변경(최상위 call-body-tmp 블록 · `# T-135` 표지 줄 · call() 의 경로 세 줄과 마스킹 로그 줄)도 이 정적 비교의 대상이 아니다 —
#   새 러너 쪽에서만 T-135 이전 모양으로 되돌린다(표준입력 → 표준출력). 그 변경이 의도한 세 줄뿐인지는 scripts/test-cron-runner-job-run-log.sh J8·J13 이 본다.
no_t135() {
  awk '/^# >>> call-body-tmp/{s=1} s{ if (/^# <<< call-body-tmp/) s=0; next } {print}' | grep -v '# T-135$' \
    | sed -e 's#body=$(head -c 2048 "\$CALL_BODY_FILE" 2>/dev/null | jrl_mask_money 2>/dev/null | head -c 200)#body=$(head -c 200 /tmp/cron-runner-$$.out 2>/dev/null)#' \
          -e 's#-o "\$CALL_BODY_FILE" -w#-o /tmp/cron-runner-$$.out -w#' \
          -e 's#^  rm -f "\$CALL_BODY_FILE"$#  rm -f /tmp/cron-runner-$$.out#'
}
# (T-171) T-156 블록·선언·call() 분기와 T-160 call() 줄도 새 러너 쪽에서만 빼거나 되돌린다(위 T-171 도우미 — 기준 ref 에는 없다)
no_jrl() { awk '/^# >>> job-run-log-spool/{s=1} s{ if (/^# <<< job-run-log-spool/) s=0; next } {print}' "$1" | grep -v '# T-112 jrl$' | no_t135 | no_t160 | no_t156; }
RUNNER_NOJRL="$W/runner-nojrl.sh"; no_jrl "$RUNNER" > "$RUNNER_NOJRL"
if diff <(strip_new "$RUNNER_NOJRL") <(strip_old "$BEFORE") > /dev/null; then ok "🔴 D6: daily-bars 블록·DAILY_BARS_* 선언·주석 밖 실행 줄 = 변경 전과 동일 ($(strip_new "$RUNNER_NOJRL" | wc -l | tr -d ' ')줄)"
else bad "D6: 블록 밖 실행 줄이 바뀌었다"; diff <(strip_new "$RUNNER_NOJRL") <(strip_old "$BEFORE") | head -10; fi
# 변경 전 러너의 모든 줄(주석 포함)이 순서대로 새 러너에 있다 = 삭제·수정 0, 추가만
# (T-135) call() 의 본문 경로 세 줄은 T-135 가 의도해 바꿨다 — 그 세 줄만 되돌린 러너(no_t135)로 비교한다
# (T-171) T-160 의 call() 줄도 같은 이유로 되돌린다(no_t160). T-156 은 줄을 더하기만 해서 되돌릴 것이 없다.
missing="$(awk 'NR==FNR { cur[++n] = $0; next } { while (j < n && cur[j+1] != $0) j++; if (j >= n) { print FNR": "$0; exit } j++ }' <(no_t135 < "$RUNNER" | no_t160) <(no_t147_old < "$BEFORE" | no_t149_old))"
eq "🔴 D6: 변경 전 러너의 모든 줄이 순서대로 남아 있다(추가만)" "${missing:-none}" "none"
# (T-149 감사 L-7) 스트리퍼는 기준 ref 쪽에서 그 1줄을 지우므로, **지금 러너에서 그 줄이 사라져도** 위 대조가 깨지지 않는다.
#   그래서 러너 쪽에 그 줄이 정확히 1개 있다는 단정을 따로 둔다 — 없으면 스트리퍼가 가린 범위가 무검사로 넓어진다.
eq "🔴 D6: no_t149_old 가 노리는 주석 줄이 지금 러너에 정확히 1개 있다" \
   "$(grep -c '^# (T-062 Codex C2 ②) 해외 post-market' "$RUNNER")" "1"
eq "D6: call() 함수 본문 = 변경 전(T-171: T-160 줄 되돌림 · T-156 분기 2줄 뺌)" "$(awk '/^call\(\) \{/,/^\}/' "$RUNNER" | grep -v '# T-112 jrl$' | no_t135 | no_t160 | no_t156_call | sha256sum)" "$(awk '/^call\(\) \{/,/^\}/' "$BEFORE" | sha256sum)"
eq "🔴 D6: (T-171) no_t156_call·no_t160 이 노리는 줄 = 파일 전체 각 1개 · 모두 call() 안" "$(t171_targets "$RUNNER")" "1 1 1 1 1 | 1 1 1 1 1"
# (T-170) 국내 저녁 블록 표지(`daily-bars-daily-kr`)가 이 표지를 접두로 포함한다 — 07:40 블록 표지를 정확히 고른다
nb="$(awk '/^  # >>> daily-bars-daily \(T-117\)/,/^  # <<< daily-bars-daily$/' "$RUNNER")"
eq "D6: 블록 표지 >>>/<<< 각 1개" "$(grep -c '^  # >>> daily-bars-daily (T-117)' "$RUNNER") $(grep -c '^  # <<< daily-bars-daily$' "$RUNNER")" "1 1"
eq "D6: 파일 전체 daily-bars 호출 줄 1개(블록 안 — T-170 국내 저녁은 ?market=KR 경로라 이 줄에 걸리지 않는다)" "$(grep -v '^[[:space:]]*#' "$RUNNER" | grep -c 'call "/api/cron/daily-bars"') $(printf '%s\n' "$nb" | grep -c '^      call "/api/cron/daily-bars" "daily-bars"$')" "1 1"
eq "D6: 호출 줄은 본문 인자 없음" "$(printf '%s\n' "$nb" | grep 'call "/api/cron/daily-bars"' | sed 's/^ *//')" 'call "/api/cron/daily-bars" "daily-bars"'
if printf '%s\n' "$nb" | grep -Pzoq 'CALL_MAX_TIME="\$DAILY_BARS_CURL_MAX_TIME"[^\n]*\n\s*call "/api/cron/daily-bars" "daily-bars"\n\s*CALL_MAX_TIME=""'; then
  ok "D6: 상한은 그 호출 바로 앞에서 켜고 바로 뒤에서 비운다"; else bad "D6: CALL_MAX_TIME 설정·해제 위치가 다르다"; fi
eq "D6: 상한 상수 120 · 날짜파일 선언 1개" "$(grep -c '^DAILY_BARS_CURL_MAX_TIME=120$' "$RUNNER") $(grep -c '^DAILY_BARS_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/daily-bars-last-date"' "$RUNNER")" "1 1"
if printf '%s\n' "$nb" | grep -q '^  if \[ "\$HH" = "07" \] && \[ "\$DBARS_MM" -ge 40 \] && \[ "\$DBARS_MM" -le 54 \] && \[ "\$LAST_DAILY_BARS" != "\$TODAY" \]; then$'; then
  ok "D6: 조건 = HH 07 · 분 40~54 · 오늘 아직 안 돎"; else bad "D6: 호출 조건 줄이 사양과 다르다"; fi
if printf '%s\n' "$nb" | grep -q '^    if \[ "\$LAST_RESEARCH_OVS" != "\$TODAY" \] || \[ "\$LAST_EDGAR" != "\$TODAY" \] || \[ "\$LAST_BROKER_FILLS" != "\$TODAY" \]; then$'; then
  ok "D6: yield 판단은 LAST_* 변수(호출 전 값) 세 개"; else bad "D6: yield 판단 줄이 사양과 다르다"; fi
eq "D6: 블록 안에서 무거운 잡 날짜파일을 다시 읽지 않음" "$(printf '%s\n' "$nb" | grep -cE 'cat "\$(RESEARCH_OVERSEAS|EDGAR_SYNC|BROKER_FILLS)_LAST_RUN_FILE"')" "0"
eq "D6: 블록 안에 비밀(CRON_SECRET·x-cron-secret)·curl 직접 호출 없음" "$(printf '%s\n' "$nb" | grep -v '^[[:space:]]*#' | grep -ciE 'cron_secret|x-cron-secret|curl ')" "0"
iB="$(grep -n '^  # <<< broker-fills-daily' "$RUNNER" | cut -d: -f1)"; iD="$(grep -n '^  # >>> daily-bars-daily (T-117)' "$RUNNER" | cut -d: -f1)"
iE="$(grep -n '^  # <<< daily-bars-daily$' "$RUNNER" | cut -d: -f1)"; iR="$(grep -n 'call "/api/cron/research-cycle-domestic"' "$RUNNER" | cut -d: -f1)"
eq "D6: 블록 위치 = broker-fills 블록 바로 뒤 · 국내 리서치 블록 앞" "$([ "$iD" -eq $((iB + 1)) ] && [ "$iR" -gt "$iE" ] && echo yes || echo no)" "yes"
eq "D6: 상단 잡 목록 주석에 새 잡" "$(sed -n '1,50p' "$RUNNER" | grep -c '^#  - daily-bars        :')" "1"
# 고정 문자열로 센다 — 이 서버의 ko_KR.UTF-8 에서 grep 이 한글 뒤 '.*' 를 맞추지 못하는 경우가 있었다(LC_ALL=C 에서는 맞음, 시험 작성 중 실측).
eq "D6: 블록 머리 주석에 T-104 흡수(J8)" "$(printf '%s\n' "$nb" | grep -cF 'T-104 단계 1(잡 정의·스케줄 DB 화)') $(printf '%s\n' "$nb" | grep -cF '흡수한다(공동 인계서 J8)')" "1 1"

echo
echo "결과: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
