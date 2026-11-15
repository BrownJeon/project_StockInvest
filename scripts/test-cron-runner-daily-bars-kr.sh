#!/usr/bin/env bash
# T-170 — cron-runner.sh 의 국내 일봉 저녁 증분 블록(daily-bars-daily-kr) 시험.
#
# 실행: bash scripts/test-cron-runner-daily-bars-kr.sh   (NFS noexec 경로라 반드시 bash 경유)
#
# cron-runner.sh 를 **그대로** 돌린다 — curl·date·sleep 만 가짜(PATH 앞 스텁)로 바꿔 가짜 시각으로 틱을 흉내 낸다
# (scripts/test-cron-runner-daily-bars.sh 와 같은 하네스). 변경 전 러너(git show $T170_BASE_REF:scripts/cron-runner.sh, 기본 b90e2c9 =
# T-170 착수 기준)를 같은 하네스로 돌려 **국내 저녁 호출을 뺀 모든 호출이 완전히 같음**을 비교로 증명한다(07:40 daily-bars 포함).
# 국내 저녁 호출 = 경로 /api/cron/daily-bars?market=KR(본문은 call() 기본값 {}) — 이 블록을 만들 때 call() 은 본문 인자를 주면 끝에 `}` 를
#   덧붙이는 결함이 있어(`${3:-{}}`, T-172 가 고쳤다) 러너는 시장을 쿼리로 넘긴다. 07:40 블록의 호출은 쿼리 없는 /api/cron/daily-bars 그대로다.
#  K1. 하루 전체(1440틱): 국내 저녁 = 18:10 1회뿐 · 본문 {} · --max-time 120 · 날짜파일 = 오늘 · OK 로그 1줄 ·
#      yield/건너뜀 로그 없음 · 18:10 틱에 peek 없음(18:00 에 이미 돎) · 저녁 호출을 뺀 호출·--max-time 목록 = 변경 전 · 하트비트 60초
#  K2. 오류 응답(409·503·000 상한 초과) × 이틀: 날마다 18:10 정확히 1회(재시도 없음) · HTTP 로그 · 날짜파일 = 둘째 날 ·
#      409/503 은 저녁 호출을 뺀 호출 = 변경 전 · 000 은 하트비트 간격 = 120 + 60 = 180초 < 300초
#  K3. 시각 경계: 18:09 시작이면 18:10 1회 · 18:54 시작이면 18:54 1회 · 18:55 시작이면 호출 0·건너뜀 로그 하루 1줄·날짜파일 없음 ·
#      17:50~17:59 에는 호출·로그 없음 · 이미 돈 날 재기동이면 호출·로그 없음 · 날짜파일이 어제면 18:20 재기동 첫 틱에 1회
#  K4. 🔴 같은 틱 미루기(yield): 18:20 재기동(해외 peek 18시 미실행) → 18:20 peek · 18:21 국내 저녁 · yield 로그 1줄 ·
#      18:54 재기동이면 미루기가 18:55 를 넘겨 그날 건너뜀(호출 0, yield 1·건너뜀 1)
#  K5. 🔴 하트비트: 18:10 틱 최악(국내 저녁 120 + stop-alert 20 + sleep 60) = 200초 < 300
#  K6. 정적: 변경 전 러너 + 추가분(상단 주석 3줄·날짜파일 선언 1줄·블록)뿐 — 추가분을 빼면 변경 전과 한 글자도 같다 · 변경 전 줄이 전부
#      순서대로 남음 · 블록 표지 1쌍 · 호출 줄 1개(쿼리 ?market=KR, 본문 인자 없음) · 🔴 러너 전체에 본문 인자를 넘기는 call 줄 0 ·
#      상한은 그 호출에만 · 조건 줄 · yield 는 PEEK_RAN_LABEL · 블록 위치(peek 블록 바로 뒤·holdings-premarket 앞) · 비밀·curl 직접 호출 없음 ·
#      call() 불변(T-172 의 본문 기본값 두 줄은 되돌려 비교 — no_t172)
# 외부 호출 없음(curl 은 스텁), 실제 HOME·.env 를 읽지 않음(임시 디렉터리).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="${T170_RUNNER:-$HERE/cron-runner.sh}"   # 변이 시험용 덮어쓰기
BASE_REF="${T170_BASE_REF:-b90e2c9}"
REAL_DATE="$(command -v date)"
PASS=0; FAIL=0
ok()   { PASS=$((PASS + 1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
eq()   { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (기대 '$3', 실제 '$2')"; fi; }

# ── (T-172) call() 셋째 인자 기본값 고침 — 기준 ref 형태로 되돌리는 도우미(표준입력 → 표준출력) ─────────────
#   T-172 는 call() 의 `local body="${3:-{}}"`(셋째 인자를 주면 본문 끝에 } 가 하나 더 붙는 결함) 한 줄을 두 줄(기본값 변수 + 본문)로 바꿨다.
#   기준 ref 와 비교할 때만 기본값 줄을 지우고 본문 줄을 옛 형태로 되돌린다. 셋째 인자를 넘기는 call 줄이 0개라 운영 동작은 같다
#   (고친 call() 의 동작·민감도는 scripts/test-cron-runner-call-body.sh 가 본다). 두 줄이 엉뚱한 곳에 생기면 비교 범위가 무검사로
#   넓어지므로 정적 절이 두 줄이 파일 전체에 각 1개(모두 call() 안)이고 옛 줄이 0개인지 따로 단언한다(t172_targets).
T172_L1="  local body_default='{}'   # T-172 본문 기본값(셋째 인자 없음·빈 값). 확장식 안에 중괄호를 바로 쓰면 인자를 줄 때 끝에 } 가 하나 더 붙었다"
T172_L2='  local body="${3:-$body_default}"   # T-172'
T172_OLD='  local body="${3:-{}}"'
no_t172() { grep -vxF "$T172_L1" | sed 's/^  local body="\${3:-\$body_default}"   # T-172$/  local body="${3:-{}}"/'; }
t172_targets() {   # 러너 → "파일 전체 L1 L2 옛 줄 | call() 안 L1 L2" — 기대 "1 1 0 | 1 1"
  local cb; cb="$(awk '/^call\(\) \{/,/^\}/' "$1")"
  echo "$(grep -cxF "$T172_L1" "$1") $(grep -cxF "$T172_L2" "$1") $(grep -cxF "$T172_OLD" "$1") | $(printf '%s\n' "$cb" | grep -cxF "$T172_L1") $(printf '%s\n' "$cb" | grep -cxF "$T172_L2")"
}

W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT

BEFORE="$W/runner-before.sh"
if ! git -C "$HERE/.." show "$BASE_REF:scripts/cron-runner.sh" > "$BEFORE" 2>/dev/null || [ ! -s "$BEFORE" ]; then
  echo "변경 전 러너($BASE_REF:scripts/cron-runner.sh)를 읽지 못함 — 비교 시험을 할 수 없다(T170_BASE_REF 로 지정 가능)"
  exit 1
fi
if grep -q 'daily-bars-daily-kr' "$BEFORE"; then echo "기준 러너에 이미 국내 저녁 블록이 있다 — 기준 ref 가 틀렸다"; exit 1; fi

ep() { TZ=Asia/Seoul "$REAL_DATE" -d "$1" +%s; }

# run_loop NAME RUNNER START TICKS DB_MODE [HEAVY [JUMP_AT JUMP_TO [SEEDS]]]
#  DB_MODE(daily-bars 응답): ok(200) | 409 | 503 | timeout(curl 상한만큼 시계가 흐르고 000·exit 28)
#  HEAVY: 0 | sahang(stop-alert 가 상한까지 늘어짐 000)
#  JUMP_AT/JUMP_TO: sleep 이 시계를 JUMP_AT 이상으로 밀면 한 번 JUMP_TO 로 옮긴다(다음 날로 건너뛰기). 0 이면 없음.
#  SEEDS: 공백 구분 "날짜파일이름=내용" 목록 — 러너 시작 전에 ~/.node-local/stockinvest/ 에 미리 써 둔다(재기동 흉내).
# 호출 기록 한 줄: "MM-DD HH:MM 틱번호 경로" — 국내 저녁 호출은 경로가 /api/cron/daily-bars?market=KR
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
# (T-112) 실행·상태 기록 전송은 이 시험의 대상이 아니다(scripts/test-cron-runner-job-run-log.sh 가 본다) — 기록·시계에 넣지 않는다.
[ "\$path" = "/api/cron/job-run-log" ] && { printf '200'; exit 0; }
rec="\$path"
echo "\$("$REAL_DATE" -d "@\$(cat "$R/clock")" '+%m-%d %H:%M') \$(cat "$R/ticks" 2>/dev/null || echo 0) \$rec" >> "$R/calls"
[ -n "\$mt" ] && echo "\$rec max-time=\$mt" >> "$R/maxtime"
adv() { c=\$(cat "$R/clock"); echo \$((c + \$1)) > "$R/clock"; }
timeout_like() { adv "\${mt:-0}"; [ -n "\$out" ] && : > "\$out"; printf '000'; exit 28; }
code=200
case "\$path" in
  /api/cron/daily-bars|/api/cron/daily-bars\?market=KR)
    echo "\$body" >> "$R/dbody"
    case "$mode" in
      409) code=409 ;;
      503) code=503 ;;
      timeout) timeout_like ;;
    esac ;;
  /api/cron/stop-alert) [ "$heavy" = sahang ] && timeout_like ;;
esac
[ -n "\$out" ] && echo '{"ok":false}' > "\$out"
printf '%s' "\$code"
EOF
  chmod +x "$R/bin/date" "$R/bin/sleep" "$R/bin/curl"
  : > "$R/calls"; : > "$R/maxtime"; : > "$R/dbody"
  # ALERT_TICKER_DISABLE=1 = 레거시 모드(메인 루프가 매 틱 stop-alert 호출) — 하트비트 간격을 정확히 비교하려고 T-117 시험과 같이 쓴다.
  PATH="$R/bin:$PATH" HOME="$R/home" PROJECT_DIR="$R/proj" BASE_URL="http://stub" TZ=Asia/Seoul ALERT_TICKER_DISABLE=1 \
    timeout 900 bash "$runner" > "$R/stdout" 2>&1
  echo "$R"
}

KRRE=' /api/cron/daily-bars\?market=KR$'
krc()    { grep -E "$KRRE" "$1/calls"; }
krat()   { krc "$1" | awk '{print $1, $2}' | tr '\n' ' '; }
nokr()   { grep -vE "$KRRE" "$1/calls" | awk '{print $1, $2, $4}'; }
allc()   { awk '{print $1, $2, $4}' "$1/calls"; }
df()     { cat "$1/home/.node-local/stockinvest/$2" 2>/dev/null || echo none; }
gap()    { awk 'NR>1 { g = $1 - p; if (g > m) m = g } { p = $1 } END { print m + 0 }' "$1/heartbeats"; }
gapj()   { awk 'NR>1 { g = $1 - p; if (g < 3600 && g > m) m = g } { p = $1 } END { print m + 0 }' "$1/heartbeats"; }   # 다음 날 건너뛰기 간격 제외
ylog()   { grep -c 'daily-bars-kr yield_tick' "$1/stdout"; }
slog()   { grep -c 'daily-bars-kr skipped' "$1/stdout"; }
peekat() { grep -E ' /api/cron/news-fetch\?market=overseas&mode=peek$' "$1/calls" | awk '$2 ~ /^18:/ {print $2}' | tr '\n' ' '; }
same()   {   # same 라벨 새러너결과 옛러너결과 — 국내 저녁 호출을 뺀 호출 목록이 변경 전 러너와 완전히 같은가
  if diff <(nokr "$2") <(allc "$3") > /dev/null; then ok "🔴 $1: 국내 저녁 호출을 뺀 모든 호출 = 변경 전 러너 ($(nokr "$2" | wc -l | tr -d ' ')건)"
  else bad "$1: 국내 저녁 호출을 뺀 호출 목록이 변경 전과 다르다"; diff <(nokr "$2") <(allc "$3") | head -10; fi
}
TD="2026-11-16"; YD="2026-11-15"
PEEK18_TODAY="news-peek-overseas-18-last-date=$TD"

# ── K1. 하루 전체 ─────────────────────────────────────────────────────────────────
echo "K1. 하루 전체 1440틱 (00:00~23:59)"
NA="$(run_loop new-day "$RUNNER" "$TD 00:00:00" 1440 ok)"
BA="$(run_loop old-day "$BEFORE" "$TD 00:00:00" 1440 ok)"
eq "K1: 새 러너 1440틱 완주" "$(cat "$NA/ticks")" "1440"
eq "K1: 변경 전 러너 1440틱 완주" "$(cat "$BA/ticks")" "1440"
eq "(하네스 확인) 변경 전 러너: 국내 저녁 호출 없음" "$(krc "$BA" | wc -l | tr -d ' ')" "0"
eq "(하네스 확인) 변경 전 러너: 07:40 daily-bars 1회는 있다(본문 '{}')" "$(grep -c ' /api/cron/daily-bars$' "$BA/calls") $(sort -u "$BA/dbody" | tr '\n' ' ')" "1 {} "
eq "🔴 K1: 국내 저녁 = 18:10 하루 1회" "$(krat "$NA")" "11-16 18:10 "
eq "🔴 K1: 18:10~18:54 밖의 국내 저녁 호출 0" "$(krc "$NA" | awk '{print $2}' | grep -cvE '^18:(1[0-9]|[2-4][0-9]|5[0-4])$')" "0"
eq "🔴 K1: 본문 = 07:40·국내 저녁 모두 '{}'(시장은 쿼리 — T-172 전 call() 의 } 덧붙임 결함을 피한 방식, 고친 뒤에도 쿼리 그대로)" "$(cat "$NA/dbody" | tr '\n' ' ')" '{} {} '
eq "🔴 K1: 국내 저녁 호출에 --max-time 120" "$(grep '?market=KR ' "$NA/maxtime" | tr '\n' ' ')" "/api/cron/daily-bars?market=KR max-time=120 "
if diff <(grep -v '?market=KR ' "$NA/maxtime") "$BA/maxtime" > /dev/null; then ok "🔴 K1: 국내 저녁을 뺀 --max-time 목록 = 변경 전(상한이 다른 잡에 새지 않음)"
else bad "K1: --max-time 목록이 다르다"; diff <(grep -v '?market=KR ' "$NA/maxtime") "$BA/maxtime" | head -5; fi
eq "K1: 날짜파일 = 오늘" "$(df "$NA" daily-bars-kr-last-date)" "$TD"
eq "K1: OK 로그 1줄" "$(grep -c '\] daily-bars-kr OK$' "$NA/stdout")" "1"
eq "K1: yield·건너뜀 로그 없음" "$(ylog "$NA") $(slog "$NA")" "0 0"
eq "K1: 18시대 해외 peek = 18:00 (국내 저녁 18:10 과 다른 틱)" "$(peekat "$NA")" "18:00 "
same "K1" "$NA" "$BA"
eq "K1: 하트비트 간격 최대 60초(스텁 즉시 응답)" "$(gap "$NA")" "60"

# ── K2. 오류 응답 × 이틀 ──────────────────────────────────────────────────────────
echo "K2. 오류 응답(409·503·000) — 18:05~18:29 × 이틀 (각 25틱, 18:30 에 다음 날 18:05 로 건너뜀)"
JA=$(ep "$TD 18:30:00"); JT=$(ep "2026-11-17 18:05:00")
SEEDS2="$PEEK18_TODAY"
BO="$(run_loop k2-old "$BEFORE" "$TD 18:05:00" 50 ok 0 "$JA" "$JT" "$SEEDS2")"
eq "K2: 변경 전 러너 50틱 완주" "$(cat "$BO/ticks")" "50"
for m in 409 503 timeout; do
  R="$(run_loop "k2-$m" "$RUNNER" "$TD 18:05:00" 50 "$m" 0 "$JA" "$JT" "$SEEDS2")"
  c="$m"; [ "$m" = timeout ] && c="000"
  eq "k2-$m: 50틱 완주" "$(cat "$R/ticks")" "50"
  eq "🔴 k2-$m: HTTP $c 여도 날마다 18:10 정확히 1회(재시도 없음)" "$(krat "$R")" "11-16 18:10 11-17 18:10 "
  eq "k2-$m: 실패 로그 = 날마다 1줄(HTTP=$c)" "$(grep -c "daily-bars-kr HTTP=$c" "$R/stdout")" "2"
  eq "🔴 k2-$m: 날짜파일 = 둘째 날(실패여도 기록)" "$(df "$R" daily-bars-kr-last-date)" "2026-11-17"
  eq "k2-$m: 건너뜀·yield 로그 없음" "$(slog "$R") $(ylog "$R")" "0 0"
  if [ "$m" = timeout ]; then
    g="$(gapj "$R")"
    if [ "$g" -lt 300 ]; then ok "🔴 k2-timeout: 하트비트 간격 최대 ${g}초 < 300초"; else bad "k2-timeout: 하트비트 간격 ${g}초 ≥ 300"; fi
    eq "k2-timeout: 최대 간격 = 상한 120 + sleep 60" "$g" "180"
  else
    same "k2-$m" "$R" "$BO"
  fi
done

# ── K3. 시각 경계·재기동 ──────────────────────────────────────────────────────────
echo "K3. 시각 경계"
R="$(run_loop k3-1809 "$RUNNER" "$TD 18:09:00" 3 ok 0 0 0 "$PEEK18_TODAY")"
eq "🔴 K3: 18:09 에는 안 돎 · 18:10 1회" "$(krat "$R")" "11-16 18:10 "
R="$(run_loop k3-1854 "$RUNNER" "$TD 18:54:00" 3 ok 0 0 0 "$PEEK18_TODAY")"
eq "🔴 K3: 18:54 시작 → 18:54 1회(창의 마지막 분)" "$(krat "$R")" "11-16 18:54 "
eq "K3: 18:54 에 돌았으면 건너뜀 로그 없음" "$(slog "$R")" "0"
R="$(run_loop k3-1855 "$RUNNER" "$TD 18:55:00" 36 ok 0 0 0 "$PEEK18_TODAY")"
eq "K3: 18:55~19:30 36틱 완주" "$(cat "$R/ticks")" "36"
eq "🔴 K3: 18:55 이후 시작 → 호출 0" "$(krc "$R" | wc -l | tr -d ' ')" "0"
eq "🔴 K3: 건너뜀 로그 = 1줄(36틱 돌아도)" "$(slog "$R")" "1"
grep -q "\[$TD 18:55:00\] daily-bars-kr skipped" "$R/stdout" && ok "K3: 건너뜀 로그 시각 18:55" || bad "K3: 18:55 건너뜀 로그 없음"
eq "K3: 건너뛴 날은 날짜파일을 쓰지 않음" "$(df "$R" daily-bars-kr-last-date)" "none"
R="$(run_loop k3-early "$RUNNER" "$TD 17:50:00" 10 ok)"
eq "K3: 17:50~17:59 에는 호출·건너뜀 로그 없음" "$(krc "$R" | wc -l | tr -d ' ') $(slog "$R")" "0 0"
R="$(run_loop k3-done "$RUNNER" "$TD 18:20:00" 45 ok 0 0 0 "$PEEK18_TODAY daily-bars-kr-last-date=$TD")"
eq "🔴 K3: 이미 돈 날 18:20 재기동 → 호출 0" "$(krc "$R" | wc -l | tr -d ' ')" "0"
eq "K3: 이미 돈 날은 건너뜀 로그 없음(19시대 포함)" "$(slog "$R")" "0"
R="$(run_loop k3-yday "$RUNNER" "$TD 18:20:00" 2 ok 0 0 0 "$PEEK18_TODAY daily-bars-kr-last-date=$YD")"
eq "K3: 날짜파일이 어제면 18:20 첫 틱에 1회" "$(krat "$R")" "11-16 18:20 "

# ── K4. 같은 틱 미루기 ────────────────────────────────────────────────────────────
echo "K4. 같은 틱 미루기(yield)"
R="$(run_loop k4-restart "$RUNNER" "$TD 18:20:00" 3 ok 0 0 0 "news-peek-overseas-18-last-date=$YD")"
eq "K4: 재기동 18:20 — 해외 peek = 18:20(그 시의 첫 틱)" "$(peekat "$R")" "18:20 "
eq "🔴 K4: 국내 저녁 = 18:21(peek 다음 틱) 1회" "$(krat "$R")" "11-16 18:21 "
eq "K4: yield 로그 1줄 · 날짜파일 = 오늘" "$(ylog "$R") $(df "$R" daily-bars-kr-last-date)" "1 $TD"
grep -q "daily-bars-kr yield_tick — news-peek-overseas-18 가 이 틱에 돌아" "$R/stdout" && ok "K4: yield 로그가 미룬 원인(peek 라벨)을 적는다" || bad "K4: yield 로그 문구"
R="$(run_loop k4-1854 "$RUNNER" "$TD 18:54:00" 4 ok 0 0 0 "news-peek-overseas-18-last-date=$YD")"
eq "🔴 K4: 18:54 재기동 + peek → 미루기가 18:55 를 넘겨 그날 건너뜀(호출 0)" "$(krc "$R" | wc -l | tr -d ' ')" "0"
eq "K4: 18:54 재기동 — yield 1줄 · 건너뜀 1줄 · 날짜파일 없음" "$(ylog "$R") $(slog "$R") $(df "$R" daily-bars-kr-last-date)" "1 1 none"

# ── K5. 하트비트 ──────────────────────────────────────────────────────────────────
echo "K5. 하트비트"
R="$(run_loop k5-worst "$RUNNER" "$TD 18:09:00" 4 timeout sahang 0 0 "$PEEK18_TODAY")"
eq "K5: 18:10 1회" "$(krat "$R")" "11-16 18:10 "
eq "🔴 K5: 18:10 틱 최악(국내 저녁 120 + stop-alert 20 + sleep 60) = 200초 < 300" "$(gap "$R")" "200"

# ── K6. 정적 ──────────────────────────────────────────────────────────────────────
echo "K6. 정적"
eq "bash -n" "$(bash -n "$RUNNER" 2>&1 && echo ok)" "ok"
# 추가분만 지운다: 상단 잡 목록의 daily-bars-kr 항목(머리 줄 + 들여쓴 이어지는 주석 줄) · 날짜파일 선언 · 블록(>>> ~ <<< daily-bars-daily-kr)
strip_t170() {
  awk '/^#  - daily-bars-kr     :/ { h = 1; next } h && /^#                        / { next } { h = 0; print }' "$1" \
    | grep -v '^DAILY_BARS_KR_LAST_RUN_FILE=' \
    | awk '/^  # >>> daily-bars-daily-kr/{s=1} s{ if (/^  # <<< daily-bars-daily-kr$/) s=0; next } {print}'
}
if diff <(strip_t170 "$RUNNER" | no_t172) "$BEFORE" > /dev/null; then ok "🔴 K6: 추가분(상단 주석·선언·블록)을 빼고 T-172 두 줄을 되돌리면 변경 전 러너와 한 글자도 같다($(wc -l < "$BEFORE" | tr -d ' ')줄)"
else bad "K6: 추가분 밖이 바뀌었다"; diff <(strip_t170 "$RUNNER" | no_t172) "$BEFORE" | head -10; fi
missing="$(awk 'NR==FNR { cur[++n] = $0; next } { while (j < n && cur[j+1] != $0) j++; if (j >= n) { print FNR": "$0; exit } j++ }' <(no_t172 < "$RUNNER") "$BEFORE")"
eq "🔴 K6: 변경 전 러너의 모든 줄이 순서대로 남아 있다(추가만 — T-172 두 줄은 되돌려 비교)" "${missing:-none}" "none"
eq "K6: call() 함수 본문 = 변경 전(T-172 두 줄 되돌림)" "$(awk '/^call\(\) \{/,/^\}/' "$RUNNER" | no_t172 | sha256sum)" "$(awk '/^call\(\) \{/,/^\}/' "$BEFORE" | sha256sum)"
eq "🔴 K6: (T-172) no_t172 가 노리는 두 줄 = 파일 전체 각 1개 · 모두 call() 안 · 옛 줄 0" "$(t172_targets "$RUNNER")" "1 1 0 | 1 1"
kb="$(awk '/^  # >>> daily-bars-daily-kr/,/^  # <<< daily-bars-daily-kr$/' "$RUNNER")"
eq "K6: 블록 표지 >>>/<<< 각 1개" "$(grep -c '^  # >>> daily-bars-daily-kr (T-170)' "$RUNNER") $(grep -c '^  # <<< daily-bars-daily-kr$' "$RUNNER")" "1 1"
eq "K6: 파일 전체 국내 저녁 호출 줄 1개(블록 안 — 쿼리 ?market=KR, 본문 인자 없음)" \
   "$(grep -v '^[[:space:]]*#' "$RUNNER" | grep -c '"daily-bars-kr"') $(printf '%s\n' "$kb" | grep -c '^      call "/api/cron/daily-bars?market=KR" "daily-bars-kr"$')" "1 1"
# 🔴 이 블록을 만들 때 call() 은 셋째 인자(본문)를 주면 끝에 } 를 덧붙였다(`${3:-{}}`, T-172 가 고쳤다) — 러너 어디에도 본문 인자를 넘기는
#   call 줄이 없다는 단언은 남긴다(변경 전과 같은 0 — T-172 의 「운영 동작 불변」 근거이기도 하다)
eq "🔴 K6: 본문 인자(셋째 인자)를 넘기는 call 줄 = 0 (변경 전도 0)" \
   "$(grep -v '^[[:space:]]*#' "$RUNNER" | sed 's/[[:space:]]#.*$//' | grep -cE '^[[:space:]]*call[[:space:]]+("[^"]*"|[^[:space:]"]+)[[:space:]]+("[^"]*"|[^[:space:]"]+)[[:space:]]+[^[:space:]]') $(grep -v '^[[:space:]]*#' "$BEFORE" | sed 's/[[:space:]]#.*$//' | grep -cE '^[[:space:]]*call[[:space:]]+("[^"]*"|[^[:space:]"]+)[[:space:]]+("[^"]*"|[^[:space:]"]+)[[:space:]]+[^[:space:]]')" "0 0"
if printf '%s\n' "$kb" | grep -Pzoq 'CALL_MAX_TIME="\$DAILY_BARS_CURL_MAX_TIME"[^\n]*\n\s*call "/api/cron/daily-bars\?market=KR" "daily-bars-kr"\n\s*CALL_MAX_TIME=""'; then
  ok "K6: 상한은 그 호출 바로 앞에서 켜고 바로 뒤에서 비운다"; else bad "K6: CALL_MAX_TIME 설정·해제 위치가 다르다"; fi
eq "K6: 날짜파일 선언 1개" "$(grep -c '^DAILY_BARS_KR_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/daily-bars-kr-last-date"' "$RUNNER")" "1"
if printf '%s\n' "$kb" | grep -q '^  if \[ "\$HH" = "18" \] && \[ "\$DBARS_KR_MM" -ge 10 \] && \[ "\$DBARS_KR_MM" -le 54 \] && \[ "\$LAST_DAILY_BARS_KR" != "\$TODAY" \]; then$'; then
  ok "K6: 조건 = HH 18 · 분 10~54 · 오늘 아직 안 돎"; else bad "K6: 호출 조건 줄이 사양과 다르다"; fi
if printf '%s\n' "$kb" | grep -q '^    if \[ -n "\$PEEK_RAN_LABEL" \]; then$'; then
  ok "K6: yield 판단은 PEEK_RAN_LABEL(이 틱의 peek 호출 여부)"; else bad "K6: yield 판단 줄이 사양과 다르다"; fi
eq "K6: 블록 안에서 peek 날짜파일을 다시 읽지 않음" "$(printf '%s\n' "$kb" | grep -v '^[[:space:]]*#' | grep -c 'PEEK_FILE\|news-peek-')" "0"
eq "K6: 블록 안에 비밀(CRON_SECRET·x-cron-secret)·curl 직접 호출 없음" "$(printf '%s\n' "$kb" | grep -v '^[[:space:]]*#' | grep -ciE 'cron_secret|x-cron-secret|curl ')" "0"
iP="$(grep -n '^  # <<< news-fetch-peek$' "$RUNNER" | cut -d: -f1)"; iK="$(grep -n '^  # >>> daily-bars-daily-kr' "$RUNNER" | cut -d: -f1)"
iKE="$(grep -n '^  # <<< daily-bars-daily-kr$' "$RUNNER" | cut -d: -f1)"; iH="$(grep -n '^  # >>> holdings-premarket' "$RUNNER" | cut -d: -f1)"
eq "K6: 블록 위치 = peek 블록 바로 뒤 · holdings-premarket 바로 앞" "$([ "$iK" -eq $((iP + 1)) ] && [ "$iH" -eq $((iKE + 1)) ] && echo yes || echo no)" "yes"
eq "K6: 상단 잡 목록 주석에 새 잡" "$(sed -n '1,60p' "$RUNNER" | grep -c '^#  - daily-bars-kr     :')" "1"
eq "K6: 블록 머리 주석에 T-104 흡수(J8)" "$(printf '%s\n' "$kb" | grep -cF 'T-104 단계 1(잡 정의·스케줄 DB 화)') $(printf '%s\n' "$kb" | grep -cF '흡수한다(공동 인계서 J8)')" "1 1"

echo
echo "결과: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
