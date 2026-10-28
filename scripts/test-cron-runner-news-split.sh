#!/usr/bin/env bash
# T-103 — cron-runner.sh 의 뉴스 수집 시장별 분리(news-fetch-overseas → news-fetch-domestic) 시험.
#
# 실행: bash scripts/test-cron-runner-news-split.sh   (NFS noexec 경로라 반드시 bash 경유)
#
# cron-runner.sh 를 **그대로** 돌린다 — curl·date·sleep 만 가짜(PATH 앞 스텁)로 바꿔 가짜 시각으로 틱을 흉내 낸다
# (test-cron-runner-pmo-retry.sh 와 같은 방식). 변경 전 러너(git show $T103_BASE_REF:scripts/cron-runner.sh, 기본 bf8450d)를
# 같은 하네스로 돌려 **뉴스 외 다른 잡의 호출 목록이 완전히 같음**을 비교로 증명한다.
#  A. 05:58~06:12 × 이틀: 시장마다 하루 정확히 1회 · 해외 06:00 → 국내 06:01(다음 틱) · 같은 틱에 뉴스 두 번 없음 ·
#     502 실패여도 하루 1회 · 날짜파일 2개(옛 news-fetch-last-date 안 만듦) · 다음 날 다시 1회씩 · 다른 잡 = 변경 전
#  B. 06:59 가장자리: 해외 06:59 1회, 국내는 그날 건너뜀(yield 로그) → 다음 날 06:00/06:01 정상
#  C. 느린 M4(시장당 186초 = 3회×60 + 2×3): 해외 06:00 → 국내 06:04, 하트비트 간격 < 300초 · 06:57 시작이면 국내는 그날 건너뜀
#  D. 하루 전체(1440틱): 뉴스 외 호출 목록이 변경 전 러너와 완전히 같다(03·07·08·16·17시 잡 포함)
#  E. 정적: 뉴스 블록·선언·주석을 뺀 나머지 실행 줄이 변경 전과 한 글자도 같다
# 외부 호출 없음(curl 은 스텁), 실제 HOME·.env 를 읽지 않음(임시 디렉터리).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="${T103_RUNNER:-$HERE/cron-runner.sh}"   # 변이 시험용 덮어쓰기(기본 = 이 저장소의 러너)
BASE_REF="${T103_BASE_REF:-bf8450d}"
REAL_DATE="$(command -v date)"
PASS=0; FAIL=0
ok()   { PASS=$((PASS + 1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
eq()   { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (기대 '$3', 실제 '$2')"; fi; }

W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT

BEFORE="$W/runner-before.sh"
if ! git -C "$HERE/.." show "$BASE_REF:scripts/cron-runner.sh" > "$BEFORE" 2>/dev/null || [ ! -s "$BEFORE" ]; then
  echo "변경 전 러너($BASE_REF:scripts/cron-runner.sh)를 읽지 못함 — 비교 시험을 할 수 없다(T103_BASE_REF 로 지정 가능)"
  exit 1
fi

ep() { TZ=Asia/Seoul "$REAL_DATE" -d "$1" +%s; }

# run_loop NAME RUNNER START TICKS NEWS_MODE [JUMP_AT JUMP_TO]
#  NEWS_MODE: ok(200) | fail(502) | slow(시장당 186초 흐른 뒤 200)
#  JUMP_AT/JUMP_TO: sleep 이 시계를 JUMP_AT 이상으로 밀면 한 번 JUMP_TO 로 옮긴다(다음 날로 건너뛰기)
# 호출 기록 한 줄: "MM-DD HH:MM 틱번호 경로"
run_loop() {
  local name="$1" runner="$2" start="$3" ticks="$4" mode="$5" jat="${6:-0}" jto="${7:-0}" R="$W/$1"
  mkdir -p "$R/bin" "$R/home" "$R/proj"
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
    timeout 600 bash "$runner" > "$R/stdout" 2>&1
  echo "$R"
}

news()   { grep ' /api/cron/news-fetch' "$1/calls"; }
others() { grep -v ' /api/cron/news-fetch' "$1/calls" | awk '{print $1, $2, $4}'; }
at()     { news "$1" | grep -F " $2" | awk '{print $1, $2}' | tr '\n' ' '; }   # at R 경로접미 → "MM-DD HH:MM ..."
maxper() { news "$1" | awk '{print $1, $3}' | sort | uniq -c | awk '{ if ($1 > m) m = $1 } END { print m + 0 }'; }
df()     { cat "$1/home/.node-local/stockinvest/$2" 2>/dev/null || echo none; }

D1_0558="2026-10-28 05:58:00"; D1_0613="2026-10-28 06:13:00"; D2_0558="2026-10-29 05:58:00"

# ── A. 05:58~06:12 × 이틀 ─────────────────────────────────────────────────────────
echo "A. 05:58~06:12 × 이틀 (각 15틱, 06:13 에 다음 날 05:58 로 건너뜀)"
JA=$(ep "$D1_0613"); JT=$(ep "$D2_0558")
NO="$(run_loop new-ok   "$RUNNER" "$D1_0558" 30 ok   "$JA" "$JT")"
NF="$(run_loop new-fail "$RUNNER" "$D1_0558" 30 fail "$JA" "$JT")"
BO="$(run_loop old-ok   "$BEFORE" "$D1_0558" 30 ok   "$JA" "$JT")"
BF="$(run_loop old-fail "$BEFORE" "$D1_0558" 30 fail "$JA" "$JT")"
for R in "$NO" "$NF" "$BO" "$BF"; do eq "$(basename "$R"): 30틱 완주" "$(cat "$R/ticks")" "30"; done
eq "(하네스 확인) 변경 전 러너: 시장 미지정 news-fetch 가 날마다 06:00 1회" "$(at "$BO" '/api/cron/news-fetch')" "10-28 06:00 10-29 06:00 "
for R in "$NO" "$NF"; do
  n="$(basename "$R")"
  eq "🔴 $n: 해외 = 날마다 06:00 정확히 1회" "$(at "$R" '/api/cron/news-fetch?market=overseas')" "10-28 06:00 10-29 06:00 "
  eq "🔴 $n: 국내 = 날마다 06:01(해외 다음 틱) 정확히 1회" "$(at "$R" '/api/cron/news-fetch?market=domestic')" "10-28 06:01 10-29 06:01 "
  eq "🔴 $n: 한 틱에 뉴스 호출은 최대 1회" "$(maxper "$R")" "1"
  eq "$n: 시장 미지정 호출 없음" "$(news "$R" | grep -c 'news-fetch$')" "0"
  eq "$n: 뉴스 호출 총 4회(2시장 × 2일)" "$(news "$R" | wc -l | tr -d ' ')" "4"
  eq "$n: 해외 날짜파일 = 둘째 날" "$(df "$R" news-fetch-overseas-last-date)" "2026-10-29"
  eq "$n: 국내 날짜파일 = 둘째 날" "$(df "$R" news-fetch-domestic-last-date)" "2026-10-29"
  eq "$n: 옛 날짜파일 news-fetch-last-date 를 만들지 않음" "$(df "$R" news-fetch-last-date)" "none"
  eq "$n: 국내 yield 로그 = 날마다 1번" "$(grep -c 'news-fetch-domestic yield_tick' "$R/stdout")" "2"
  eq "$n: 뉴스 호출에는 --max-time 없음" "$(grep -c '^/api/cron/news-fetch' "$R/maxtime")" "0"
done
eq "ok: 해외 OK 로그 2줄" "$(grep -c 'news-fetch-overseas OK' "$NO/stdout")" "2"
eq "ok: 국내 OK 로그 2줄" "$(grep -c 'news-fetch-domestic OK' "$NO/stdout")" "2"
eq "🔴 fail(502): 해외 실패 로그 2줄(재호출 없음)" "$(grep -c 'news-fetch-overseas HTTP=502' "$NF/stdout")" "2"
eq "🔴 fail(502): 국내 실패 로그 2줄(재호출 없음)" "$(grep -c 'news-fetch-domestic HTTP=502' "$NF/stdout")" "2"
if diff <(others "$NO") <(others "$BO") > /dev/null; then ok "🔴 ok: 뉴스 외 호출 목록 = 변경 전 러너 ($(others "$NO" | wc -l | tr -d ' ')건)"; else bad "ok: 뉴스 외 호출 목록이 변경 전과 다르다"; diff <(others "$NO") <(others "$BO") | head -10; fi
if diff <(others "$NF") <(others "$BF") > /dev/null; then ok "🔴 fail: 뉴스 외 호출 목록 = 변경 전 러너 ($(others "$NF" | wc -l | tr -d ' ')건)"; else bad "fail: 뉴스 외 호출 목록이 변경 전과 다르다"; fi
if diff <(others "$NO") <(others "$NF") > /dev/null; then ok "뉴스 502 여도 다른 잡 호출 목록 동일"; else bad "뉴스 502 시나리오에서 다른 잡 목록이 달라졌다"; fi

# ── B. 06:59 가장자리 ─────────────────────────────────────────────────────────────
echo "B. 06:59 가장자리 (06:59~07:03 5틱 → 다음 날 05:59~06:03 5틱)"
NE="$(run_loop new-edge "$RUNNER" "2026-10-28 06:59:00" 10 ok "$(ep '2026-10-28 07:04:00')" "$(ep '2026-10-29 05:59:00')")"
eq "B: 10틱 완주" "$(cat "$NE/ticks")" "10"
eq "🔴 B: 해외 = 첫날 06:59 · 다음 날 06:00" "$(at "$NE" '/api/cron/news-fetch?market=overseas')" "10-28 06:59 10-29 06:00 "
eq "🔴 B: 국내 = 첫날 없음(07시로 넘어가 건너뜀) · 다음 날 06:01" "$(at "$NE" '/api/cron/news-fetch?market=domestic')" "10-29 06:01 "
eq "B: 국내 yield 로그 = 첫날 06:59 1번 + 다음 날 06:00 1번" "$(grep -c 'news-fetch-domestic yield_tick' "$NE/stdout")" "2"
grep -q '2026-10-28 06:59:00\] news-fetch-domestic yield_tick' "$NE/stdout" && ok "B: 첫날 yield 로그 시각 06:59" || bad "B: 첫날 06:59 yield 로그 없음"
eq "B: 07시 틱에 뉴스 호출 없음(07시 잡에 합류하지 않음)" "$(news "$NE" | awk '{print $2}' | grep -c '^07:')" "0"
eq "B: 한 틱에 뉴스 호출 최대 1회" "$(maxper "$NE")" "1"

# ── C. 느린 M4 ────────────────────────────────────────────────────────────────────
echo "C. 느린 M4 (뉴스 호출마다 186초)"
NS="$(run_loop new-slow "$RUNNER" "$D1_0558" 10 slow)"
eq "C: 10틱 완주" "$(cat "$NS/ticks")" "10"
eq "🔴 C: 해외 06:00 → 국내 06:04(해외 186초 + sleep 60 뒤 다음 틱)" \
   "$(news "$NS" | awk '{print $2, $4}' | tr '\n' ' ')" "06:00 /api/cron/news-fetch?market=overseas 06:04 /api/cron/news-fetch?market=domestic "
gap() { awk 'NR>1 { g = $1 - p; if (g > m) m = g } { p = $1 } END { print m + 0 }' "$1/heartbeats"; }
g="$(gap "$NS")"
if [ "$g" -lt 300 ]; then ok "🔴 C: 하트비트 간격 최대 ${g}초 < 300초(워치독 한도)"; else bad "C: 하트비트 간격 ${g}초 ≥ 300"; fi
eq "C: 최대 간격 = 186 + 60" "$g" "246"
NS2="$(run_loop new-slow-late "$RUNNER" "2026-10-28 06:57:00" 5 slow)"
eq "C: 06:57 시작 + 느린 해외 → 해외만, 국내는 그날 건너뜀(가장자리 06:5x)" \
   "$(news "$NS2" | awk '{print $2, $4}' | tr '\n' ' ')" "06:57 /api/cron/news-fetch?market=overseas "

# ── D. 하루 전체 ──────────────────────────────────────────────────────────────────
echo "D. 하루 전체 1440틱 (00:00~23:59) — 뉴스 외 잡 비교"
NA="$(run_loop new-day "$RUNNER" "2026-10-28 00:00:00" 1440 ok)"
BA="$(run_loop old-day "$BEFORE" "2026-10-28 00:00:00" 1440 ok)"
eq "D: 새 러너 1440틱 완주" "$(cat "$NA/ticks")" "1440"
eq "D: 변경 전 러너 1440틱 완주" "$(cat "$BA/ticks")" "1440"
if diff <(others "$NA") <(others "$BA") > /dev/null; then ok "🔴 D: 뉴스 외 호출 목록(시각·틱·경로) = 변경 전 러너 ($(others "$NA" | wc -l | tr -d ' ')건)"; else bad "D: 뉴스 외 호출 목록이 변경 전과 다르다"; diff <(others "$NA") <(others "$BA") | head -10; fi
eq "D: 하루 뉴스 = 해외 06:00 · 국내 06:01" "$(news "$NA" | awk '{print $2, $4}' | tr '\n' ' ')" \
   "06:00 /api/cron/news-fetch?market=overseas 06:01 /api/cron/news-fetch?market=domestic "
eq "D: 변경 전 하루 뉴스 = 06:00 1회" "$(news "$BA" | awk '{print $2, $4}' | tr '\n' ' ')" "06:00 /api/cron/news-fetch "
if diff <(grep -v '^/api/cron/news-fetch' "$NA/maxtime") <(grep -v '^/api/cron/news-fetch' "$BA/maxtime") > /dev/null; then ok "D: --max-time 붙는 호출 목록 = 변경 전"; else bad "D: --max-time 목록이 다르다"; fi

# ── E. 정적 ───────────────────────────────────────────────────────────────────────
echo "E. 정적"
eq "bash -n" "$(bash -n "$RUNNER" 2>&1 && echo ok)" "ok"
# 뉴스 블록(새: >>> news-fetch-split ~ <<<, 옛: '# 매일 06:00 KST: M4 KB 뉴스 fetch' ~ 다음 '  fi')·NEWS_FETCH_* 선언·주석·빈 줄을 뺀 나머지
strip_new() { awk '/^  # >>> news-fetch-split/{s=1} s{ if (/^  # <<< news-fetch-split/) s=0; next } {print}' "$1" \
  | grep -v '^NEWS_FETCH_' | grep -v '^[[:space:]]*#' | grep -v '^[[:space:]]*$'; }
strip_old() { awk '/^  # 매일 06:00 KST: M4 KB 뉴스 fetch/{s=1} s{ if (/^  fi$/) s=0; next } {print}' "$1" \
  | grep -v '^NEWS_FETCH_' | grep -v '^[[:space:]]*#' | grep -v '^[[:space:]]*$'; }
if diff <(strip_new "$RUNNER") <(strip_old "$BEFORE") > /dev/null; then ok "🔴 뉴스 블록·선언·주석 밖 실행 줄 = 변경 전과 동일 ($(strip_new "$RUNNER" | wc -l | tr -d ' ')줄)"; else bad "뉴스 밖 실행 줄이 바뀌었다"; diff <(strip_new "$RUNNER") <(strip_old "$BEFORE") | head -10; fi
eq "call() 함수 본문 = 변경 전" "$(awk '/^call\(\) \{/,/^\}/' "$RUNNER" | sha256sum)" "$(awk '/^call\(\) \{/,/^\}/' "$BEFORE" | sha256sum)"
eq "뉴스 호출 줄 = 시장별 2개" "$(grep -c 'call "/api/cron/news-fetch?market=' "$RUNNER")" "2"
eq "시장 미지정 뉴스 호출 줄 없음" "$(grep -cE 'call "?/api/cron/news-fetch"? ' "$RUNNER")" "0"
eq "옛 날짜파일 이름을 실행 줄에서 참조하지 않음(주석 제외)" "$(grep -v '^[[:space:]]*#' "$RUNNER" | sed 's/[[:space:]]#.*$//' | grep -c 'news-fetch-last-date')" "0"
eq "해외 블록이 국내 블록보다 앞" "$([ "$(grep -n 'market=overseas" "news-fetch-overseas"' "$RUNNER" | cut -d: -f1)" -lt "$(grep -n 'market=domestic" "news-fetch-domestic"' "$RUNNER" | cut -d: -f1)" ] && echo yes || echo no)" "yes"
b="$(awk '/^  # >>> news-fetch-split/,/^  # <<< news-fetch-split/' "$RUNNER")"
if printf '%s\n' "$b" | grep -q '^    if \[ "\$LAST_NEWS_OVS" != "\$TODAY" \]; then$'; then
  ok "yield 판단은 LAST_NEWS_OVS 변수(호출 전 값)"
else
  bad "yield 판단이 LAST_NEWS_OVS 변수가 아니다"
fi
eq "해외 날짜파일 읽기는 블록 안 1곳(틱 시작)" "$(printf '%s\n' "$b" | grep -c 'cat "\$NEWS_FETCH_OVERSEAS_LAST_RUN_FILE"')" "1"

echo
echo "결과: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
