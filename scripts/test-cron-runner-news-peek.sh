#!/usr/bin/env bash
# T-116 — cron-runner.sh 의 뉴스 최초 관측 캡처 peek 블록(news-fetch-peek) 시험.
#
# 실행: bash scripts/test-cron-runner-news-peek.sh   (NFS noexec 경로라 반드시 bash 경유)
#
# cron-runner.sh 를 **그대로** 돌린다 — curl·date·sleep 만 가짜(PATH 앞 스텁)로 바꿔 가짜 시각으로 틱을 흉내 낸다
# (test-cron-runner-news-split.sh 와 같은 하네스). 변경 전 러너(git show $T116_BASE_REF:scripts/cron-runner.sh, 기본 a16bc0c = T-115
# 커밋 = T-116 착수 기준)를 같은 하네스로 돌려 **peek 를 뺀 모든 호출(06시·15:30 뉴스 ingest 포함)이 완전히 같음**을 비교로 증명한다.
#  P1. 하루 전체(1440틱): peek = 해외 02·10·14·18·22시, 국내 10(해외 다음 틱 10:01)·13시 — 각 하루 1회 · 같은 틱에 peek 두 번 없음 ·
#      peek 를 뺀 호출 = 변경 전 · 슬롯별 날짜파일 7개 · 06·07·08·15·16·17시 틱에 peek 없음(무거운 블록·post-market 과 안 겹침)
#  P2. 이틀(2880틱) · M4 502: 실패여도 슬롯마다 하루 1회(재호출 없음) · 둘째 날 다시 1회씩 · peek 를 뺀 호출 = 변경 전(같은 502)
#  P3. 느린 M4(호출마다 186초): 10시 해외 10:00 → 국내 10:04(다음 틱) · 하트비트 간격 < 300초
#  P4. 재기동: 슬롯이 이미 돈 날(날짜파일=오늘) 10:30 시작 → peek 없음 / 날짜파일 없으면 10:30 해외·10:31 국내
#  P5. 10:59 시작: 해외 10:59, 국내 10시 슬롯은 그날 건너뜀(11시 틱에 안 부름) · yield 로그 1줄 · 국내 13시는 정상
#  P6. 정적: peek 블록·주석을 빼면 실행 줄이 변경 전과 한 글자도 같다 · call() 불변 · 블록 안 호출 줄 1개 · --max-time 없음
# T-117 — 일봉 정기 증분 수집 블록(daily-bars-daily, 07:40~07:54 하루 1회)이 생겼다. P1·P2 의 "peek 를 뺀 호출 = 변경 전(a16bc0c)" 비교와
#   P6 정적 비교에서 daily-bars 호출·블록·DAILY_BARS_* 선언도 뺀다(범위 정교화 — peek 기대값은 그대로). daily-bars 자체의 시험과
#   "daily-bars 를 뺀 모든 호출 = T-116 러너" 증명은 scripts/test-cron-runner-daily-bars.sh 가 한다.
# 외부 호출 없음(curl 은 스텁), 실제 HOME·.env 를 읽지 않음(임시 디렉터리).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="${T116_RUNNER:-$HERE/cron-runner.sh}"   # 변이 시험용 덮어쓰기
BASE_REF="${T116_BASE_REF:-a16bc0c}"
REAL_DATE="$(command -v date)"
PASS=0; FAIL=0
ok()   { PASS=$((PASS + 1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
eq()   { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (기대 '$3', 실제 '$2')"; fi; }

W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT

BEFORE="$W/runner-before.sh"
if ! git -C "$HERE/.." show "$BASE_REF:scripts/cron-runner.sh" > "$BEFORE" 2>/dev/null || [ ! -s "$BEFORE" ]; then
  echo "변경 전 러너($BASE_REF:scripts/cron-runner.sh)를 읽지 못함 — 비교 시험을 할 수 없다(T116_BASE_REF 로 지정 가능)"
  exit 1
fi

ep() { TZ=Asia/Seoul "$REAL_DATE" -d "$1" +%s; }

# run_loop NAME RUNNER START TICKS MODE [SEED]
#  MODE: ok(200) | fail(뉴스 경로 502) | slow(뉴스 경로마다 186초 흐른 뒤 200)
#  SEED: "날짜파일이름=내용" — 러너 시작 전에 ~/.node-local/stockinvest/ 에 미리 써 둔다(재기동 흉내).
# 호출 기록 한 줄: "MM-DD HH:MM 틱번호 경로"
run_loop() {
  local name="$1" runner="$2" start="$3" ticks="$4" mode="$5" seed="${6:-}" R="$W/$1"
  mkdir -p "$R/bin" "$R/home" "$R/proj"
  if [ -n "$seed" ]; then
    mkdir -p "$R/home/.node-local/stockinvest"
    printf '%s\n' "${seed#*=}" > "$R/home/.node-local/stockinvest/${seed%%=*}"
  fi
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
echo "\$("$REAL_DATE" -d "@\$(cat "$R/clock")" '+%m-%d %H:%M') \$(cat "$R/ticks" 2>/dev/null || echo 0) \$path" >> "$R/calls"
[ -n "\$mt" ] && echo "\$path max-time=\$mt" >> "$R/maxtime"
code=200
case "\$path" in
  /api/cron/news-fetch*)
    case "$mode" in
      fail) code=502 ;;
      slow) c=\$(cat "$R/clock"); echo \$((c + 186)) > "$R/clock" ;;
    esac ;;
esac
[ -n "\$out" ] && echo '{}' > "\$out"
printf '%s' "\$code"
EOF
  chmod +x "$R/bin/date" "$R/bin/sleep" "$R/bin/curl"
  : > "$R/calls"; : > "$R/maxtime"
  PATH="$R/bin:$PATH" HOME="$R/home" PROJECT_DIR="$R/proj" BASE_URL="http://stub" TZ=Asia/Seoul \
    timeout 900 bash "$runner" > "$R/stdout" 2>&1
  echo "$R"
}

peek()   { grep -E ' /api/cron/news-fetch\?market=(domestic|overseas)&mode=peek$' "$1/calls"; }
nopeek() { grep -vE 'mode=peek' "$1/calls" | grep -v ' /api/cron/daily-bars$' | awk '{print $1, $2, $4}'; }   # (T-117) daily-bars 제외
allc()   { awk '{print $1, $2, $4}' "$1/calls"; }
plist()  { peek "$1" | awk '{ sub(/.*market=/, "", $4); sub(/&mode=peek/, "", $4); print $1, $2, $4 }' | tr '\n' ' '; }
maxper() { peek "$1" | awk '{print $1, $3}' | sort | uniq -c | awk '{ if ($1 > m) m = $1 } END { print m + 0 }'; }
df()     { cat "$1/home/.node-local/stockinvest/$2" 2>/dev/null || echo none; }
gap()    { awk 'NR>1 { g = $1 - p; if (g > m) m = g } { p = $1 } END { print m + 0 }' "$1/heartbeats"; }
same()   {   # same 라벨 새러너결과 옛러너결과 — peek 를 뺀 호출 목록이 변경 전 러너와 완전히 같은가
  if diff <(nopeek "$2") <(allc "$3") > /dev/null; then ok "🔴 $1: peek 를 뺀 모든 호출(뉴스 ingest 포함) = 변경 전 러너 ($(nopeek "$2" | wc -l | tr -d ' ')건)"
  else bad "$1: peek 를 뺀 호출 목록이 변경 전과 다르다"; diff <(nopeek "$2") <(allc "$3") | head -10; fi
}

DAY1='10-28 02:00 overseas 10-28 10:00 overseas 10-28 10:01 domestic 10-28 13:00 domestic 10-28 14:00 overseas 10-28 18:00 overseas 10-28 22:00 overseas '

# ── P1. 하루 전체 ─────────────────────────────────────────────────────────────────
echo "P1. 하루 전체 1440틱 (00:00~23:59)"
NA="$(run_loop new-day "$RUNNER" "2026-10-28 00:00:00" 1440 ok)"
BA="$(run_loop old-day "$BEFORE" "2026-10-28 00:00:00" 1440 ok)"
eq "P1: 새 러너 1440틱 완주" "$(cat "$NA/ticks")" "1440"
eq "P1: 변경 전 러너 1440틱 완주" "$(cat "$BA/ticks")" "1440"
eq "(하네스 확인) 변경 전 러너: peek 호출 없음" "$(peek "$BA" | wc -l | tr -d ' ')" "0"
eq "🔴 P1: peek 시각표 = 해외 02·10·14·18·22 · 국내 10:01·13 (각 1회)" "$(plist "$NA")" "$DAY1"
eq "🔴 P1: 한 틱에 peek 는 최대 1회" "$(maxper "$NA")" "1"
eq "🔴 P1: 한 틱에 뉴스(peek+ingest) 호출 최대 1회" \
   "$(grep ' /api/cron/news-fetch' "$NA/calls" | awk '{print $1, $3}' | sort | uniq -c | awk '{ if ($1 > m) m = $1 } END { print m + 0 }')" "1"
eq "🔴 P1: 03·06·07·08·15·16·17시 틱에 peek 없음(무거운 블록·ingest·post-market 과 안 겹침)" \
   "$(peek "$NA" | awk '{print $2}' | grep -cE '^(03|06|07|08|15|16|17):')" "0"
same "P1" "$NA" "$BA"
for s in overseas-02 overseas-10 domestic-10 domestic-13 overseas-14 overseas-18 overseas-22; do
  eq "P1: 날짜파일 news-peek-$s-last-date = 오늘" "$(df "$NA" "news-peek-$s-last-date")" "2026-10-28"
done
eq "P1: peek 날짜파일은 정확히 7개" "$(ls "$NA/home/.node-local/stockinvest/" | grep -c '^news-peek-')" "7"
eq "P1: 국내 10시 yield 로그 1줄(해외 10시 다음 틱으로 미룸)" "$(grep -c 'news-peek-domestic-10 yield_tick — news-peek-overseas-10' "$NA/stdout")" "1"
eq "P1: peek 호출에는 --max-time 없음" "$(grep -c 'mode=peek' "$NA/maxtime")" "0"
eq "P1: peek OK 로그 7줄(라벨 news-peek-…)" "$(grep -cE 'news-peek-(domestic|overseas)-[0-9]{2} OK' "$NA/stdout")" "7"

# ── P2. 이틀 · 502 ────────────────────────────────────────────────────────────────
echo "P2. 이틀 2880틱 · M4(뉴스 경로) 502"
NF="$(run_loop new-fail "$RUNNER" "2026-10-28 00:00:00" 2880 fail)"
BF="$(run_loop old-fail "$BEFORE" "2026-10-28 00:00:00" 2880 fail)"
eq "P2: 2880틱 완주" "$(cat "$NF/ticks") $(cat "$BF/ticks")" "2880 2880"
eq "🔴 P2: 502 여도 슬롯마다 하루 1회 — 이틀 14회" "$(peek "$NF" | wc -l | tr -d ' ')" "14"
eq "🔴 P2: 첫날 시각표 = P1 과 같음" "$(peek "$NF" | grep '^10-28' | awk '{ sub(/.*market=/, "", $4); sub(/&mode=peek/, "", $4); print $1, $2, $4 }' | tr '\n' ' ')" "$DAY1"
eq "P2: 둘째 날 시각표 = 같은 시각" "$(peek "$NF" | grep '^10-29' | awk '{print $2}' | tr '\n' ' ')" "02:00 10:00 10:01 13:00 14:00 18:00 22:00 "
eq "P2: 실패 로그 14줄(같은 시간 재호출 없음)" "$(grep -cE 'news-peek-(domestic|overseas)-[0-9]{2} HTTP=502' "$NF/stdout")" "14"
eq "P2: 날짜파일 = 둘째 날" "$(df "$NF" news-peek-overseas-22-last-date) $(df "$NF" news-peek-domestic-13-last-date)" "2026-10-29 2026-10-29"
same "P2" "$NF" "$BF"

# ── P3. 느린 M4 ───────────────────────────────────────────────────────────────────
echo "P3. 느린 M4 (뉴스 호출마다 186초) — 09:58 시작"
NS="$(run_loop new-slow "$RUNNER" "2026-10-28 09:58:00" 8 slow)"
eq "P3: 8틱 완주" "$(cat "$NS/ticks")" "8"
eq "🔴 P3: 해외 10:00 → 국내 10:04(해외 186초 + sleep 60 뒤 다음 틱)" "$(plist "$NS")" "10-28 10:00 overseas 10-28 10:04 domestic "
g="$(gap "$NS")"
if [ "$g" -lt 300 ]; then ok "🔴 P3: 하트비트 간격 최대 ${g}초 < 300초(워치독 한도)"; else bad "P3: 하트비트 간격 ${g}초 ≥ 300"; fi
eq "P3: 최대 간격 = 186 + 60" "$g" "246"

# ── P4. 재기동 ────────────────────────────────────────────────────────────────────
echo "P4. 재기동 10:30"
NR="$(run_loop new-restart "$RUNNER" "2026-10-28 10:30:00" 5 ok "news-peek-overseas-10-last-date=2026-10-28")"
eq "P4: 해외 10시가 이미 돈 날 10:30 재기동 → 국내만 10:30 1회" "$(plist "$NR")" "10-28 10:30 domestic "
NR2="$(run_loop new-restart2 "$RUNNER" "2026-10-28 10:30:00" 5 ok)"
eq "🔴 P4: 날짜파일 없으면 10:30 해외 · 10:31 국내" "$(plist "$NR2")" "10-28 10:30 overseas 10-28 10:31 domestic "
NR3="$(run_loop new-restart3 "$RUNNER" "2026-10-28 13:20:00" 5 ok "news-peek-domestic-13-last-date=2026-10-28")"
eq "P4: 국내 13시가 이미 돈 날 13:20 재기동 → peek 없음" "$(peek "$NR3" | wc -l | tr -d ' ')" "0"

# ── P5. 10:59 가장자리 ────────────────────────────────────────────────────────────
echo "P5. 10:59 시작 → 13:01 까지"
NE="$(run_loop new-edge "$RUNNER" "2026-10-28 10:59:00" 123 ok)"
eq "🔴 P5: 해외 10:59 · 국내 10시 슬롯은 그날 건너뜀 · 국내 13:00 정상" "$(plist "$NE")" "10-28 10:59 overseas 10-28 13:00 domestic "
eq "P5: yield 로그 1줄(10:59)" "$(grep -c 'news-peek-domestic-10 yield_tick' "$NE/stdout")" "1"
eq "P5: 국내 10시 날짜파일 없음(호출 안 했으므로)" "$(df "$NE" news-peek-domestic-10-last-date)" "none"

# ── P6. 정적 ──────────────────────────────────────────────────────────────────────
echo "P6. 정적"
eq "bash -n" "$(bash -n "$RUNNER" 2>&1 && echo ok)" "ok"
strip_new() { awk '/^  # >>> (news-fetch-peek|daily-bars-daily)/{s=1} s{ if (/^  # <<< (news-fetch-peek|daily-bars-daily)/) s=0; next } {print}' "$1" \
  | grep -v '^DAILY_BARS_' | grep -v '^[[:space:]]*#' | grep -v '^[[:space:]]*$'; }   # (T-117) daily-bars 블록·선언 제외
strip_old() { grep -v '^[[:space:]]*#' "$1" | grep -v '^[[:space:]]*$'; }
if diff <(strip_new "$RUNNER") <(strip_old "$BEFORE") > /dev/null; then ok "🔴 P6: peek 블록·주석 밖 실행 줄 = 변경 전과 동일 ($(strip_new "$RUNNER" | wc -l | tr -d ' ')줄)"
else bad "P6: peek 블록 밖 실행 줄이 바뀌었다"; diff <(strip_new "$RUNNER") <(strip_old "$BEFORE") | head -10; fi
eq "P6: call() 함수 본문 = 변경 전" "$(awk '/^call\(\) \{/,/^\}/' "$RUNNER" | sha256sum)" "$(awk '/^call\(\) \{/,/^\}/' "$BEFORE" | sha256sum)"
nb="$(awk '/^  # >>> news-fetch-peek/,/^  # <<< news-fetch-peek/' "$RUNNER")"
eq "P6: 블록 표지 >>>/<<< 각 1개" "$(grep -c '^  # >>> news-fetch-peek' "$RUNNER") $(grep -c '^  # <<< news-fetch-peek' "$RUNNER")" "1 1"
eq "P6: 블록 안 호출 줄 1개(mode=peek)" "$(printf '%s\n' "$nb" | grep -c 'call ')" "1"
eq "P6: 그 호출 줄" "$(printf '%s\n' "$nb" | grep 'call ' | sed 's/^ *//')" 'call "/api/cron/news-fetch?market=${PEEK_MKT}&mode=peek" "$PEEK_LABEL"'
eq "P6: 슬롯 목록" "$(printf '%s\n' "$nb" | grep -E '^  for PEEK_SLOT in ' | sed 's/^ *//')" \
   'for PEEK_SLOT in overseas:02 overseas:10 domestic:10 domestic:13 overseas:14 overseas:18 overseas:22; do'
eq "P6: peek 블록은 news-fetch-domestic-pm 블록 뒤" \
   "$([ "$(grep -n '^  # >>> news-fetch-peek' "$RUNNER" | cut -d: -f1)" -gt "$(grep -n '^  # <<< news-fetch-domestic-pm' "$RUNNER" | cut -d: -f1)" ] && echo yes || echo no)" "yes"
eq "P6: 블록 안에 CALL_MAX_TIME 없음(다른 잡 상한 불변)" "$(printf '%s\n' "$nb" | grep -c 'CALL_MAX_TIME')" "0"
eq "P6: 상단 잡 목록 주석에 새 잡" "$(sed -n '1,45p' "$RUNNER" | grep -c '^#  - news-peek-<시장>-<HH>:')" "1"

echo
echo "결과: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
