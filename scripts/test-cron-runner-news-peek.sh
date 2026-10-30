#!/usr/bin/env bash
# T-116 · T-118 — cron-runner.sh 의 뉴스 최초 관측 캡처 peek 블록(news-fetch-peek) 시험.
#
# 실행: bash scripts/test-cron-runner-news-peek.sh   (NFS noexec 경로라 반드시 bash 경유)
#
# cron-runner.sh 를 **그대로** 돌린다 — curl·date·sleep 만 가짜(PATH 앞 스텁)로 바꿔 가짜 시각으로 틱을 흉내 낸다
# (test-cron-runner-news-split.sh 와 같은 하네스). curl 스텁은 --max-time 을 지킨다(늦은 응답이 상한을 넘으면 상한만큼만 흐르고 000).
# (T-118) 비교 기준 러너 = **이 러너에서 peek 블록만 T-116 블록(git show $T118_BASE_REF:scripts/cron-runner.sh, 기본 0761fec)으로 바꾼 것**.
#   그래서 "peek 를 뺀 모든 호출이 같다"는 이 task 의 블록 변경만을 비교한다(다른 task 가 같은 파일의 다른 블록을 바꿔 합쳐도 그대로 쓸 수
#   있다). 블록 밖이 기준 ref 와 한 글자도 같은지는 P7 정적 비교가 따로 본다 — 다른 블록 변경과 합친 뒤에는 T118_BASE_REF 를 "그 변경은
#   들어 있고 T-118 은 없는" ref 로 주어야 P7 이 통과한다.
#  P1. 하루 전체(1440틱): 해외 = 매시(06·07·08·15·16시 제외) 19회 · 국내 10:01·13:01(해외 다음 틱) · 각 하루 1회 · 같은 틱에 peek 두 번
#      없음 · peek 를 뺀 호출 = 기준 러너 · 날짜파일 21개 · peek 호출마다 --max-time 40, 다른 뉴스 호출에는 없음
#  P2. 이틀(2880틱) · M4 502: 실패여도 슬롯마다 하루 1회(재호출 없음) · 둘째 날 다시 1회씩 · peek 를 뺀 호출 = 기준 러너(같은 502)
#  P3. 느린 M4(응답 186초 — peek curl 은 40초에 끊김): 09:58 해외 09 → 10:00 해외 10 → 10:02 국내 10 · 하트비트 간격 최대 100초(< 300)
#  P4. 무거운 틱: 17시 sync-stock-meta · 03시 export-llm-trainset 를 각 60초로 늘리고(실측 1~5초) 느린 M4 와 겹쳐도 하트비트 < 300초
#  P5. 재기동·배포 당일: 날짜파일이 오늘인 슬롯은 다시 돌지 않음(T-116 이름 그대로) · 없으면 그 시각 첫 틱에 1회
#  P6. 10:59 시작: 해외 10:59, 국내 10시 슬롯은 그날 건너뜀 · 11·12·13시 해외 정상 · 국내 13:01 정상
#  P7. 정적: peek 블록·주석 밖 실행 줄 = 기준 ref · call() 불변 · 블록 안 호출 줄 1개 · curl 상한은 peek 호출에만 · 제외 시 규칙 줄
# T-117 — 일봉 정기 증분 수집 블록(daily-bars-daily, 07:40~07:54 하루 1회)이 main 에 먼저 들어갔다. P1·P2 의 기준 러너는 이 러너의
#   peek 블록만 바꾼 것이라 daily-bars 호출은 양쪽에 똑같이 들어가 비교에 영향이 없다. P7 정적 비교만 daily-bars 블록·DAILY_BARS_*
#   선언을 양쪽에서 뺀다(범위 정교화 — peek 기대값은 그대로). daily-bars 자체의 시험은 scripts/test-cron-runner-daily-bars.sh 가 한다.
# T-119 — 보유 종목 개장 전 공시 블록(holdings-premarket, ET 08시 평일 — KST 21시 EDT / 22시 EST)이 main 에 합쳐졌다. P1·P2 의 기준 러너는 이
#   러너의 peek 블록만 바꾼 것이라 그 호출은 양쪽에 똑같이 들어가 비교에 영향이 없다. P7 정적 비교만 그 블록·선언(HOLDINGS_PREMARKET_*)도
#   양쪽에서 뺀다(범위 정교화 — peek 기대값은 그대로). holdings-premarket 자체의 시험은 scripts/test-cron-runner-holdings-premarket.sh.
# 외부 호출 없음(curl 은 스텁), 실제 HOME·.env 를 읽지 않음(임시 디렉터리).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="${T118_RUNNER:-$HERE/cron-runner.sh}"   # 변이 시험용 덮어쓰기
BASE_REF="${T118_BASE_REF:-0761fec}"
REAL_DATE="$(command -v date)"
PASS=0; FAIL=0
ok()   { PASS=$((PASS + 1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
eq()   { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (기대 '$3', 실제 '$2')"; fi; }

W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT

BASEFILE="$W/runner-base.sh"
if ! git -C "$HERE/.." show "$BASE_REF:scripts/cron-runner.sh" > "$BASEFILE" 2>/dev/null || [ ! -s "$BASEFILE" ]; then
  echo "기준 러너($BASE_REF:scripts/cron-runner.sh)를 읽지 못함 — 비교 시험을 할 수 없다(T118_BASE_REF 로 지정 가능)"
  exit 1
fi
# 기준 러너 = 이 러너의 peek 블록 자리에 기준 ref 의 peek 블록을 끼운 것
BEFORE="$W/runner-before.sh"
awk -v bf="$BASEFILE" '
  BEGIN { while ((getline l < bf) > 0) { if (l ~ /^  # >>> news-fetch-peek/) s = 1; if (s) blk = blk l "\n"; if (l ~ /^  # <<< news-fetch-peek/) s = 0 } }
  /^  # >>> news-fetch-peek/ { printf "%s", blk; skip = 1; next }
  skip { if (/^  # <<< news-fetch-peek/) skip = 0; next }
  { print }' "$RUNNER" > "$BEFORE"
if ! grep -q 'for PEEK_SLOT in overseas:02 overseas:10 domestic:10 domestic:13 overseas:14 overseas:18 overseas:22; do' "$BEFORE"; then
  echo "기준 러너 조립 실패 — $BASE_REF 의 T-116 peek 블록을 찾지 못함"; exit 1
fi

ep() { TZ=Asia/Seoul "$REAL_DATE" -d "$1" +%s; }

# run_loop NAME RUNNER START TICKS MODE [SEEDS] [HEAVY]
#  MODE: ok(200) | fail(뉴스 경로 502) | slow(뉴스 경로 응답 186초 — curl --max-time 이 있으면 그만큼만 흐르고 000)
#  SEEDS: "날짜파일이름=내용 ..." — 러너 시작 전에 ~/.node-local/stockinvest/ 에 미리 써 둔다(재기동 흉내).
#  HEAVY: sync-stock-meta 호출·export-llm-trainset 스크립트가 걸리는 초(기본 0).
# 호출 기록 한 줄: "MM-DD HH:MM 틱번호 경로"
run_loop() {
  local name="$1" runner="$2" start="$3" ticks="$4" mode="$5" seeds="${6:-}" heavy="${7:-0}" R="$W/$1" sd
  mkdir -p "$R/bin" "$R/home/.node-local/stockinvest/logs" "$R/proj/scripts"
  for sd in $seeds; do printf '%s\n' "${sd#*=}" > "$R/home/.node-local/stockinvest/${sd%%=*}"; done
  printf 'CRON_SECRET=test-secret\n' > "$R/proj/.env"
  ep "$start" > "$R/clock"
  cat > "$R/proj/scripts/export-llm-trainset.sh" <<EOF
c=\$(cat "$R/clock"); echo \$((c + $heavy)) > "$R/clock"
exit 0
EOF
  cat > "$R/bin/date" <<EOF
#!/usr/bin/env bash
exec "$REAL_DATE" -d "@\$(cat "$R/clock")" "\$@"
EOF
  cat > "$R/bin/sleep" <<EOF
#!/usr/bin/env bash
cat "$R/home/.node-local/stockinvest/cron-heartbeat" >> "$R/heartbeats" 2>/dev/null
c=\$(( \$(cat "$R/clock") + \${1%%[!0-9]*} ))
echo \$c > "$R/clock"
n=\$(( \$(cat "$R/ticks" 2>/dev/null || echo 0) + 1 )); echo \$n > "$R/ticks"
if [ \$n -ge $ticks ]; then kill -TERM \$PPID; fi
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
echo "\$("$REAL_DATE" -d "@\$(cat "$R/clock")" '+%m-%d %H:%M') \$(cat "$R/ticks" 2>/dev/null || echo 0) \$path" >> "$R/calls"
[ -n "\$mt" ] && echo "\$path max-time=\$mt" >> "$R/maxtime"
code=200; took=0
case "\$path" in
  /api/cron/news-fetch*)
    case "$mode" in
      fail) code=502 ;;
      slow) took=186 ;;
    esac ;;
  /api/cron/sync-stock-meta) took=$heavy ;;
esac
if [ -n "\$mt" ] && [ "\$took" -gt "\$mt" ]; then took=\$mt; code=000; fi
c=\$(cat "$R/clock"); echo \$((c + took)) > "$R/clock"
[ -n "\$out" ] && echo '{}' > "\$out"
printf '%s' "\$code"
[ "\$code" = "000" ] && exit 28
exit 0
EOF
  chmod +x "$R/bin/date" "$R/bin/sleep" "$R/bin/curl"
  : > "$R/calls"; : > "$R/maxtime"
  PATH="$R/bin:$PATH" HOME="$R/home" PROJECT_DIR="$R/proj" BASE_URL="http://stub" TZ=Asia/Seoul \
    timeout 900 bash "$runner" > "$R/stdout" 2>&1
  echo "$R"
}

peek()   { grep -E ' /api/cron/news-fetch\?market=(domestic|overseas)&mode=peek$' "$1/calls"; }
nopeek() { grep -vE 'mode=peek' "$1/calls" | grep -v ' /api/cron/holdings-premarket$' | awk '{print $1, $2, $4}'; }   # (T-119) holdings-premarket 제외 — 기준 러너에는 21·22시 peek 슬롯이 없어 이 호출이 정시에 돌고, 합친 러너는 peek 에 양보해 :01 에 돈다(시각은 hp 시험 H1·H1b 가 단언)
plist()  { peek "$1" | awk '{ sub(/.*market=/, "", $4); sub(/&mode=peek/, "", $4); print $1, $2, $4 }' | tr '\n' ' '; }
maxper() { peek "$1" | awk '{print $1, $3}' | sort | uniq -c | awk '{ if ($1 > m) m = $1 } END { print m + 0 }'; }
df()     { cat "$1/home/.node-local/stockinvest/$2" 2>/dev/null || echo none; }
gap()    { awk 'NR>1 { g = $1 - p; if (g > m) m = g } { p = $1 } END { print m + 0 }' "$1/heartbeats"; }
same()   {   # same 라벨 새러너결과 기준러너결과 — peek 를 뺀 호출 목록(시각·틱·경로)이 기준 러너와 완전히 같은가
  if diff <(nopeek "$2") <(nopeek "$3") > /dev/null; then ok "🔴 $1: peek 를 뺀 모든 호출(뉴스 ingest 포함) = 기준 러너 ($(nopeek "$2" | wc -l | tr -d ' ')건)"
  else bad "$1: peek 를 뺀 호출 목록이 기준 러너와 다르다"; diff <(nopeek "$2") <(nopeek "$3") | head -10; fi
}
# 하루 시각표 기대값 — 해외: 06·07·08·15·16시를 뺀 매시 :00, 국내: 10:01·13:01
dayplan() {   # dayplan MM-DD
  local d="$1" h out=""
  for h in 00 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23; do
    case "$h" in 06|07|08|15|16) continue ;; esac
    out="$out$d $h:00 overseas "
    case "$h" in 10|13) out="$out$d $h:01 domestic " ;; esac
  done
  printf '%s' "$out"
}
DAY1="$(dayplan 10-28)"
OVS_HOURS="00 01 02 03 04 05 09 10 11 12 13 14 17 18 19 20 21 22 23"

# ── P1. 하루 전체 ─────────────────────────────────────────────────────────────────
echo "P1. 하루 전체 1440틱 (00:00~23:59)"
NA="$(run_loop new-day "$RUNNER" "2026-10-28 00:00:00" 1440 ok)"
BA="$(run_loop old-day "$BEFORE" "2026-10-28 00:00:00" 1440 ok)"
eq "P1: 새 러너 1440틱 완주" "$(cat "$NA/ticks")" "1440"
eq "P1: 기준 러너 1440틱 완주" "$(cat "$BA/ticks")" "1440"
eq "(하네스 확인) 기준 러너 = T-116 시각표(해외 02·10·14·18·22 · 국내 10:01·13)" "$(plist "$BA")" \
   '10-28 02:00 overseas 10-28 10:00 overseas 10-28 10:01 domestic 10-28 13:00 domestic 10-28 14:00 overseas 10-28 18:00 overseas 10-28 22:00 overseas '
eq "(하네스 확인) 해외 시각 19개" "$(echo $OVS_HOURS | wc -w | tr -d ' ')" "19"
eq "🔴 P1: peek 시각표 = 해외 매시(06·07·08·15·16 제외) · 국내 10:01·13:01 (각 1회)" "$(plist "$NA")" "$DAY1"
eq "🔴 P1: peek 21회(해외 19 + 국내 2)" "$(peek "$NA" | wc -l | tr -d ' ')" "21"
eq "🔴 P1: 한 틱에 peek 는 최대 1회" "$(maxper "$NA")" "1"
eq "🔴 P1: 한 틱에 뉴스(peek+ingest) 호출 최대 1회" \
   "$(grep ' /api/cron/news-fetch' "$NA/calls" | awk '{print $1, $3}' | sort | uniq -c | awk '{ if ($1 > m) m = $1 } END { print m + 0 }')" "1"
eq "🔴 P1: 06·07·08·15·16시 틱에 peek 없음(무거운 잡 틱)" "$(peek "$NA" | awk '{print $2}' | grep -cE '^(06|07|08|15|16):')" "0"
eq "🔴 P1: 03·17시(하루 1회 잡이 있는 시) 해외 peek 는 있음" "$(peek "$NA" | awk '{print $2}' | grep -cE '^(03|17):00')" "2"
same "P1" "$NA" "$BA"
for h in $OVS_HOURS; do
  eq "P1: 날짜파일 news-peek-overseas-$h-last-date = 오늘" "$(df "$NA" "news-peek-overseas-$h-last-date")" "2026-10-28"
done
for h in 10 13; do
  eq "P1: 날짜파일 news-peek-domestic-$h-last-date = 오늘" "$(df "$NA" "news-peek-domestic-$h-last-date")" "2026-10-28"
done
eq "P1: peek 날짜파일은 정확히 21개" "$(ls "$NA/home/.node-local/stockinvest/" | grep -c '^news-peek-')" "21"
eq "P1: 국내 10·13시 yield 로그 각 1줄(해외 다음 틱으로 미룸)" \
   "$(grep -c 'news-peek-domestic-10 yield_tick — news-peek-overseas-10' "$NA/stdout") $(grep -c 'news-peek-domestic-13 yield_tick — news-peek-overseas-13' "$NA/stdout")" "1 1"
eq "🔴 P1: peek 호출마다 --max-time 40(21줄)" "$(grep -cE 'mode=peek max-time=40$' "$NA/maxtime")" "21"
eq "🔴 P1: peek 아닌 뉴스(ingest) 호출에는 --max-time 없음" "$(grep '^/api/cron/news-fetch' "$NA/maxtime" | grep -vc 'mode=peek')" "0"
if diff <(grep -v 'mode=peek' "$NA/maxtime" | grep -v '^/api/cron/holdings-premarket ') <(grep -v 'mode=peek' "$BA/maxtime" | grep -v '^/api/cron/holdings-premarket ') > /dev/null; then ok "🔴 P1: peek 외 --max-time 목록 = 기준 러너(T-119 holdings-premarket 제외 — 21·22시 peek 양보로 호출 순서가 :01 로 밀림, 그 --max-time 은 hp 시험 H1 이 단언)"; else bad "P1: peek 외 --max-time 목록이 다르다"; fi
eq "P1: peek OK 로그 21줄(라벨 news-peek-…)" "$(grep -cE 'news-peek-(domestic|overseas)-[0-9]{2} OK' "$NA/stdout")" "21"

# ── P2. 이틀 · 502 ────────────────────────────────────────────────────────────────
echo "P2. 이틀 2880틱 · M4(뉴스 경로) 502"
NF="$(run_loop new-fail "$RUNNER" "2026-10-28 00:00:00" 2880 fail)"
BF="$(run_loop old-fail "$BEFORE" "2026-10-28 00:00:00" 2880 fail)"
eq "P2: 2880틱 완주" "$(cat "$NF/ticks") $(cat "$BF/ticks")" "2880 2880"
eq "🔴 P2: 502 여도 슬롯마다 하루 1회 — 이틀 42회" "$(peek "$NF" | wc -l | tr -d ' ')" "42"
eq "🔴 P2: 첫날 시각표 = P1 과 같음" "$(plist "$NF" | tr ' ' '\n' | paste -d' ' - - - | grep '^10-28' | tr '\n' ' ')" "$DAY1"
eq "P2: 둘째 날 시각표 = 같은 시각" "$(plist "$NF" | tr ' ' '\n' | paste -d' ' - - - | grep '^10-29' | tr '\n' ' ')" "$(dayplan 10-29)"
eq "P2: 실패 로그 42줄(같은 시간 재호출 없음)" "$(grep -cE 'news-peek-(domestic|overseas)-[0-9]{2} HTTP=502' "$NF/stdout")" "42"
eq "P2: 날짜파일 = 둘째 날" "$(df "$NF" news-peek-overseas-23-last-date) $(df "$NF" news-peek-overseas-00-last-date) $(df "$NF" news-peek-domestic-13-last-date)" "2026-10-29 2026-10-29 2026-10-29"
same "P2" "$NF" "$BF"

# ── P3. 느린 M4 ───────────────────────────────────────────────────────────────────
echo "P3. 느린 M4 (응답 186초, peek curl 은 40초에 끊김) — 09:58 시작"
NS="$(run_loop new-slow "$RUNNER" "2026-10-28 09:58:00" 8 slow)"
eq "P3: 8틱 완주" "$(cat "$NS/ticks")" "8"
eq "🔴 P3: 해외 09 09:58 → 해외 10 10:00 → 국내 10 10:02(해외 40초 + sleep 60 뒤 다음 틱)" "$(plist "$NS")" \
   "10-28 09:58 overseas 10-28 10:00 overseas 10-28 10:02 domestic "
eq "P3: 끊긴 peek 는 HTTP=000 로그(3줄)" "$(grep -cE 'news-peek-(domestic|overseas)-[0-9]{2} HTTP=000' "$NS/stdout")" "3"
g="$(gap "$NS")"
if [ "$g" -lt 300 ]; then ok "🔴 P3: 하트비트 간격 최대 ${g}초 < 300초(워치독 한도)"; else bad "P3: 하트비트 간격 ${g}초 ≥ 300"; fi
eq "🔴 P3: 최대 간격 = 40(peek curl 상한) + 60(sleep)" "$g" "100"
eq "P3: 끊겼어도 날짜파일 기록(하루 1회)" "$(df "$NS" news-peek-overseas-10-last-date) $(df "$NS" news-peek-domestic-10-last-date)" "2026-10-28 2026-10-28"

# ── P4. 무거운 틱 ─────────────────────────────────────────────────────────────────
echo "P4. 무거운 틱 — sync-stock-meta(17시)·export-llm-trainset(03시) 각 60초 + 느린 M4"
NH17="$(run_loop new-heavy17 "$RUNNER" "2026-10-28 16:58:00" 5 slow "" 60)"
eq "P4: 17시 — 16:58 시작 5틱 완주" "$(cat "$NH17/ticks")" "5"
eq "P4: 17시 틱 = sync-stock-meta 와 해외 peek 같은 틱" \
   "$(grep -E ' /api/cron/sync-stock-meta$| /api/cron/news-fetch\?market=overseas&mode=peek$' "$NH17/calls" | awk '{print $2, $3, $4}' | tr '\n' ' ')" \
   "17:00 2 /api/cron/sync-stock-meta 17:01 2 /api/cron/news-fetch?market=overseas&mode=peek "
g17="$(gap "$NH17")"
if [ "$g17" -lt 300 ]; then ok "🔴 P4: 17시 틱 하트비트 간격 최대 ${g17}초 < 300초"; else bad "P4: 17시 틱 하트비트 ${g17}초 ≥ 300"; fi
eq "P4: 17시 최대 간격 = 60(sync-stock-meta) + 40(peek) + 60(sleep)" "$g17" "160"
NH03="$(run_loop new-heavy03 "$RUNNER" "2026-10-28 02:58:00" 5 slow "news-peek-overseas-02-last-date=2026-10-28" 60)"
eq "P4: 03시 — 02:58 시작 5틱 완주" "$(cat "$NH03/ticks")" "5"
grep -q 'export-llm-trainset OK' "$NH03/stdout" && ok "(하네스 확인) P4: 03시 export-llm-trainset 가짜 스크립트가 돌았다" || bad "P4: export-llm-trainset 가 돌지 않았다"
eq "P4: 03시 틱 해외 peek 1회" "$(plist "$NH03")" "10-28 03:00 overseas "
g03="$(gap "$NH03")"
if [ "$g03" -lt 300 ]; then ok "🔴 P4: 03시 틱 하트비트 간격 최대 ${g03}초 < 300초"; else bad "P4: 03시 틱 하트비트 ${g03}초 ≥ 300"; fi
eq "P4: 03시 최대 간격 = 40(peek) + 60(export) + 60(sleep)" "$g03" "160"

# ── P5. 재기동·배포 당일 ──────────────────────────────────────────────────────────
echo "P5. 재기동·배포 당일"
NR="$(run_loop new-restart "$RUNNER" "2026-10-28 10:30:00" 5 ok "news-peek-overseas-10-last-date=2026-10-28")"
eq "P5: 해외 10시가 이미 돈 날 10:30 재기동 → 국내만 10:30 1회" "$(plist "$NR")" "10-28 10:30 domestic "
NR2="$(run_loop new-restart2 "$RUNNER" "2026-10-28 10:30:00" 5 ok)"
eq "🔴 P5: 날짜파일 없으면 10:30 해외 · 10:31 국내" "$(plist "$NR2")" "10-28 10:30 overseas 10-28 10:31 domestic "
NR3="$(run_loop new-restart3 "$RUNNER" "2026-10-28 13:20:00" 5 ok "news-peek-domestic-13-last-date=2026-10-28 news-peek-overseas-13-last-date=2026-10-28")"
eq "P5: 13시 두 슬롯이 이미 돈 날 13:20 재기동 → peek 없음" "$(peek "$NR3" | wc -l | tr -d ' ')" "0"
NR4="$(run_loop new-deploy "$RUNNER" "2026-10-28 14:10:00" 3 ok "news-peek-overseas-14-last-date=2026-10-28")"
eq "🔴 P5: 배포 당일 — T-116 이 이미 돈 해외 14시 슬롯(같은 날짜파일 이름)은 다시 돌지 않음" "$(peek "$NR4" | wc -l | tr -d ' ')" "0"
NR5="$(run_loop new-deploy2 "$RUNNER" "2026-10-28 16:40:00" 25 ok)"
eq "P5: 16:40 배포 — 16시는 peek 없음, 17:00 해외부터" "$(plist "$NR5")" "10-28 17:00 overseas "

# ── P6. 10:59 가장자리 ────────────────────────────────────────────────────────────
echo "P6. 10:59 시작 → 13:01 까지"
NE="$(run_loop new-edge "$RUNNER" "2026-10-28 10:59:00" 123 ok)"
eq "🔴 P6: 해외 10:59 · 국내 10시 슬롯은 그날 건너뜀 · 해외 11·12·13 · 국내 13:01" "$(plist "$NE")" \
   "10-28 10:59 overseas 10-28 11:00 overseas 10-28 12:00 overseas 10-28 13:00 overseas 10-28 13:01 domestic "
eq "P6: yield 로그 — 국내 10(10:59) 1줄 · 국내 13(13:00) 1줄" \
   "$(grep -c 'news-peek-domestic-10 yield_tick' "$NE/stdout") $(grep -c 'news-peek-domestic-13 yield_tick' "$NE/stdout")" "1 1"
eq "P6: 국내 10시 날짜파일 없음(호출 안 했으므로)" "$(df "$NE" news-peek-domestic-10-last-date)" "none"

# ── P7. 정적 ──────────────────────────────────────────────────────────────────────
echo "P7. 정적"
eq "bash -n" "$(bash -n "$RUNNER" 2>&1 && echo ok)" "ok"
strip_blk() { awk '/^  # >>> (news-fetch-peek|daily-bars-daily|holdings-premarket)/{s=1} s{ if (/^  # <<< (news-fetch-peek|daily-bars-daily|holdings-premarket)/) s=0; next } {print}' "$1" \
  | grep -v '^DAILY_BARS_' | grep -v '^HOLDINGS_PREMARKET_' | grep -v '^[[:space:]]*#' | grep -v '^[[:space:]]*$'; }   # (T-117 daily-bars·T-119 holdings-premarket) 블록·선언도 제외
# (T-112) 실행·상태 기록 후크(최상위 job-run-log-spool 블록 · `# T-112 jrl` 표지 줄 4개)는 이 정적 비교의 대상이 아니다 — 새 러너 쪽에서만 뺀다
#   (기준 ref 에는 없다). 후크가 추가만 했는지·call() 의 나머지가 그대로인지는 scripts/test-cron-runner-job-run-log.sh J8 이 본다.
no_jrl() { awk '/^# >>> job-run-log-spool/{s=1} s{ if (/^# <<< job-run-log-spool/) s=0; next } {print}' "$1" | grep -v '# T-112 jrl$'; }
RUNNER_NOJRL="$W/runner-nojrl.sh"; no_jrl "$RUNNER" > "$RUNNER_NOJRL"
if diff <(strip_blk "$RUNNER_NOJRL") <(strip_blk "$BASEFILE") > /dev/null; then ok "🔴 P7: peek 블록·주석 밖 실행 줄 = 기준 ref $BASE_REF ($(strip_blk "$RUNNER_NOJRL" | wc -l | tr -d ' ')줄)"
else bad "P7: peek 블록 밖 실행 줄이 기준 ref $BASE_REF 와 다르다(다른 블록 변경과 합쳤으면 T118_BASE_REF 지정)"; diff <(strip_blk "$RUNNER_NOJRL") <(strip_blk "$BASEFILE") | head -10; fi
eq "P7: call() 함수 본문 = 기준 ref" "$(awk '/^call\(\) \{/,/^\}/' "$RUNNER" | grep -v '# T-112 jrl$' | sha256sum)" "$(awk '/^call\(\) \{/,/^\}/' "$BASEFILE" | sha256sum)"
nb="$(awk '/^  # >>> news-fetch-peek/,/^  # <<< news-fetch-peek/' "$RUNNER")"
nbx="$(printf '%s\n' "$nb" | grep -v '^[[:space:]]*#' | LC_ALL=C sed 's/[[:space:]][[:space:]]*#.*$//')"   # 주석 뺀 실행 줄(LC_ALL=C — ko_KR.UTF-8 의 GNU sed 는 '—' 가 든 줄에서 '.*$' 가 맞지 않았다)
eq "P7: 블록 표지 >>>/<<< 각 1개" "$(grep -c '^  # >>> news-fetch-peek' "$RUNNER") $(grep -c '^  # <<< news-fetch-peek' "$RUNNER")" "1 1"
eq "P7: 블록 안 호출 줄 1개(mode=peek)" "$(printf '%s\n' "$nbx" | grep -c 'call ')" "1"
eq "P7: 그 호출 줄" "$(printf '%s\n' "$nbx" | grep 'call ' | sed 's/^ *//')" 'call "/api/cron/news-fetch?market=${PEEK_MKT}&mode=peek" "$PEEK_LABEL"'
eq "🔴 P7: 호출 바로 앞·뒤 줄 = curl 상한 켜기·끄기" \
   "$(printf '%s\n' "$nbx" | grep -B1 -A1 'call ' | sed 's/^ *//; s/[[:space:]]*$//' | tr '\n' '|')" \
   'CALL_MAX_TIME="$PEEK_CURL_MAX_TIME"|call "/api/cron/news-fetch?market=${PEEK_MKT}&mode=peek" "$PEEK_LABEL"|CALL_MAX_TIME=""|'
eq "P7: peek curl 상한 40초" "$(printf '%s\n' "$nbx" | grep -c '^  PEEK_CURL_MAX_TIME=40$')" "1"
eq "🔴 P7: 제외 시 규칙 줄(06·07·08·15·16)" "$(printf '%s\n' "$nbx" | grep -cE '^    06\|07\|08\|15\|16\) PEEK_SLOTS="" ;;$')" "1"
eq "P7: 국내 슬롯 규칙 줄(10·13, 해외 뒤)" "$(printf '%s\n' "$nbx" | grep -cE '^    10\|13\) PEEK_SLOTS="\$PEEK_SLOTS domestic:\$HH" ;;$')" "1"
eq "P7: 블록 머리 주석 — T-104 단계 1 흡수 · T-114 H1 · 피드 창 실측" \
   "$(printf '%s\n' "$nb" | grep -c 'T-104 단계 1 에서 잡 정의로 흡수') $(printf '%s\n' "$nb" | grep -c 'T-114 독립 검토 HIGH H1') $(printf '%s\n' "$nb" | grep -c 'MarketWatch(dowjones) 약 2.7~3.4시간')" "1 1 1"
eq "P7: peek 블록은 news-fetch-domestic-pm 블록 뒤" \
   "$([ "$(grep -n '^  # >>> news-fetch-peek' "$RUNNER" | cut -d: -f1)" -gt "$(grep -n '^  # <<< news-fetch-domestic-pm' "$RUNNER" | cut -d: -f1)" ] && echo yes || echo no)" "yes"
eq "P7: 상단 잡 목록 주석에 peek 잡(T-118 시각)" "$(sed -n '1,45p' "$RUNNER" | grep -c '^#  - news-peek-<시장>-<HH>:') $(sed -n '1,45p' "$RUNNER" | grep -c '해외 매시(T-118')" "1 1"

echo
echo "결과: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
