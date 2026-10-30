#!/usr/bin/env bash
# T-112 — cron-runner.sh 의 실행·상태 기록 후크(job-run-log-spool 블록 + call() 의 `# T-112 jrl` 두 줄 + 틱 시작·끝 두 줄) 시험.
#
# 실행: bash scripts/test-cron-runner-job-run-log.sh   (NFS noexec 경로라 반드시 bash 경유)
#
# cron-runner.sh 를 **그대로** 돌린다 — curl·date·sleep 만 가짜(PATH 앞 스텁)로 바꿔 가짜 시각으로 틱을 흉내 낸다(test-cron-runner-news-peek.sh 와
# 같은 하네스). curl 스텁은 --max-time 을 지킨다(늦은 응답이 상한을 넘으면 상한만큼만 흐르고 000). 기록 라우트(POST /api/cron/job-run-log)
# 스텁은 --data-binary 로 받은 줄을 200 응답일 때만 "받은 것"으로 남긴다.
# 비교 기준 러너 = git show $T112_BASE_REF:scripts/cron-runner.sh (기본 f218430 = T-112 직전 main). 다른 task 가 러너의 다른 블록을 바꾼 뒤에는
#   T112_BASE_REF 를 "그 변경은 있고 T-112 는 없는" ref 로 준다.
#  J1. 하루 전체(1440틱): 🔴 후크가 켜져도 기록 전송을 뺀 모든 호출(시각·틱·경로)·--max-time·stdout·날짜파일·하트비트 = 기준 러너 ·
#      후크를 끈 러너(JRL_SPOOL_FILE="")도 같고 스풀·전송 0 · call() 마다 정확히 한 줄(경로별 개수 일치) · 줄 형식 v1 7칸 · 매 분 잡 200 은 본문 없음 ·
#      틱마다 전송 1회(≤ 200줄, --max-time 3) · peek 21 라벨 · export-llm-trainset·job-run-log 라벨 없음 · 끝나면 스풀 빈
#  J2. 앱 다운 70틱 → 회복: 스풀 보존 · 실패 로그 1줄·회복 로그 1줄 · 회복 뒤 200줄 묶음 → 나머지 · 받은 줄 = 만든 줄 전부(순서·중복 없음) ·
#      다른 호출 = 기준 러너  (mawk 는 정규식 {n} 반복을 모른다 — 길이는 length() 로 본다)
#  J3. 🔴 150초 규칙: 08시 최악 틱(해외 분석 120 + KIS 60 + 매 분 잡 40 + strategy-eval·trade-report 10 = 230초)에는 전송하지 않고 다음 틱에 보냄 ·
#      기록 라우트가 느려도(3초 상한) 하트비트 최대 간격 = 기준 러너(290초) < 300 · 가벼운 틱 간격 = 기준 + 3초
#  J4. 스풀 상한: 3MiB 미리 쌓인 상태 + 앱 다운 → 1MiB 로 줄이고 로그 1줄 · 가장 새 줄 유지·가장 오래된 줄 버림 · 다른 호출 불변
#  J5. 본문: 따옴표·줄바꿈·탭·한글·이모지 3KB 본문 → 한 줄 · base64 = 앞 2048바이트 그대로 · 매 분 잡 500 은 본문 있음
#  J6. 🔴 스풀을 쓸 수 없음(없는 디렉터리) → 러너 생존 · 호출·stdout·하트비트 = 기준 러너(오류 출력 새지 않음)
#  J7. 해외 분석 502 재시도(CALL_LAST_CODE): 08:00·08:10·08:20 = 기준 러너 · 날짜파일·시도 기록 같음
#  J8. 정적: bash -n · 기준 러너의 모든 줄이 순서대로 남음(추가만) · call() 에서 `# T-112 jrl` 2줄을 빼면 기준과 같음 · 표지 줄 4개 위치 ·
#      상수(150·3·200·2MiB) · 전송 curl 은 call() 을 거치지 않고 --max-time 이 있음 · 하트비트 계산 주석(290.2·213)
# 외부 호출 없음(curl 은 스텁), 실제 HOME·.env 를 읽지 않음(임시 디렉터리).
# T112_ONLY="J3 J8" 처럼 주면 그 묶음만 돈다(변이 시험을 빨리 돌리려는 것 — 평소에는 비워 전부 돈다).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="${T112_RUNNER:-$HERE/cron-runner.sh}"   # 변이 시험용 덮어쓰기
BASE_REF="${T112_BASE_REF:-f218430}"
REAL_DATE="$(command -v date)"
PASS=0; FAIL=0
ok()   { PASS=$((PASS + 1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
eq()   { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (기대 '$3', 실제 '$2')"; fi; }

W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT

BASE="$W/runner-base.sh"
if ! git -C "$HERE/.." show "$BASE_REF:scripts/cron-runner.sh" > "$BASE" 2>/dev/null || [ ! -s "$BASE" ]; then
  echo "기준 러너($BASE_REF:scripts/cron-runner.sh)를 읽지 못함 — 비교 시험을 할 수 없다(T112_BASE_REF 로 지정 가능)"
  exit 1
fi
if grep -q 'job-run-log-spool' "$BASE"; then echo "기준 러너에 이미 T-112 후크가 있다 — T112_BASE_REF 를 T-112 이전 ref 로"; exit 1; fi

ep() { TZ=Asia/Seoul "$REAL_DATE" -d "$1" +%s; }
want() { [ -z "${T112_ONLY:-}" ] || case " $T112_ONLY " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

# ── 하네스 ────────────────────────────────────────────────────────────────────────
# run_loop NAME RUNNER START TICKS MODE JMODE [SEEDS] [ENV...]
#  MODE(잡 응답): ok | worst08(해외 분석·stop-alert = curl 상한까지 늘어짐, KIS 60, 매 분 잡 10, 5분 잡 5) | pmo502 | bodies
#  JMODE(기록 라우트): ok(200) | down(즉시 000) | slow(curl 상한만큼 흐르고 000) | down70(70틱까지 down, 그 뒤 ok)
#  SEEDS: "이름=내용 ..." — ~/.node-local/stockinvest/ 에 미리 쓴다. ENV: 러너 환경 덧붙임(예 JRL_SPOOL_FILE=).
# 기록 — calls: "MM-DD HH:MM:SS 틱 경로" · maxtime · posts: "틱 줄수" · received(200 으로 받은 줄) · heartbeats · spoolsize(틱 끝 .sending 크기)
run_loop() {
  local name="$1" runner="$2" start="$3" ticks="$4" mode="$5" jmode="$6" seeds="${7:-}" R="$W/$1" sd
  shift 7 2>/dev/null || shift $#
  mkdir -p "$R/bin" "$R/home/.node-local/stockinvest/logs" "$R/proj/scripts"
  for sd in $seeds; do printf '%s\n' "${sd#*=}" > "$R/home/.node-local/stockinvest/${sd%%=*}"; done
  printf 'CRON_SECRET=test-secret\n' > "$R/proj/.env"
  printf 'exit 0\n' > "$R/proj/scripts/export-llm-trainset.sh"
  ep "$start" > "$R/clock"
  echo "$ticks" > "$R/maxticks"; echo "$mode" > "$R/mode"
  case "$jmode" in down70) echo down > "$R/jmode"; echo "70 ok" > "$R/jswitch" ;; *) echo "$jmode" > "$R/jmode" ;; esac
  cat > "$R/bin/date" <<'EOF'
#!/usr/bin/env bash
exec "$STUB_REAL_DATE" -d "@$(cat "$STUB_R/clock")" "$@"
EOF
  cat > "$R/bin/sleep" <<'EOF'
#!/usr/bin/env bash
R="$STUB_R"
cat "$R/home/.node-local/stockinvest/cron-heartbeat" >> "$R/heartbeats" 2>/dev/null
echo $(( $(cat "$R/clock") + ${1%%[!0-9]*} )) > "$R/clock"
n=$(( $(cat "$R/ticks" 2>/dev/null || echo 0) + 1 )); echo $n > "$R/ticks"
if [ -f "$R/jswitch" ]; then read -r at m < "$R/jswitch"; [ "$n" -ge "$at" ] && echo "$m" > "$R/jmode"; fi
s="$R/home/.node-local/stockinvest/job-run-spool.sending"
if [ -f "$s" ]; then wc -c < "$s" >> "$R/spoolsize"; else echo 0 >> "$R/spoolsize"; fi
if [ $n -ge $(cat "$R/maxticks") ]; then kill -TERM $PPID; fi
exit 0
EOF
  cat > "$R/bin/curl" <<'EOF'
#!/usr/bin/env bash
R="$STUB_R"
out=""; url=""; mt=""; data=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    --max-time) mt="$2"; shift 2 ;;
    --data-binary) data="$2"; shift 2 ;;
    -w|-X|-H|-d) shift 2 ;;
    -s) shift ;;
    *) url="$1"; shift ;;
  esac
done
path="${url#http://stub}"
adv() { echo $(( $(cat "$R/clock") + $1 )) > "$R/clock"; }
tk=$(cat "$R/ticks" 2>/dev/null || echo 0)
echo "$("$STUB_REAL_DATE" -d "@$(cat "$R/clock")" '+%m-%d %H:%M:%S') $tk $path" >> "$R/calls"
[ -n "$mt" ] && echo "$path max-time=$mt" >> "$R/maxtime"
if [ "$path" = "/api/cron/job-run-log" ]; then
  f="${data#@}"; n=$(wc -l < "$f" 2>/dev/null || echo 0)
  echo "$tk $n" >> "$R/posts"
  case "$(cat "$R/jmode")" in
    down) printf '000'; exit 7 ;;
    slow) if [ -n "$mt" ]; then adv "$mt"; else adv 30; fi; printf '000'; exit 28 ;;
  esac
  cat "$f" >> "$R/received"
  printf '200'; exit 0
fi
took=0; code=200; body='{}'
case "$(cat "$R/mode")" in
  worst08)
    case "$path" in
      *post-market-analysis?market=overseas*|/api/cron/stop-alert) took=999 ;;
      /api/cron/kis-fundamentals-snapshot) took=60 ;;
      /api/cron/entry-watcher|/api/cron/holding-checker) took=10 ;;
      /api/cron/strategy-eval|/api/cron/trade-report) took=5 ;;
    esac ;;
  pmo502) case "$path" in *post-market-analysis?market=overseas*) code=502 ;; esac ;;
  bodies)
    case "$path" in
      /api/cron/edgar-sync) body="$(cat "$R/body-edgar")" ;;
      /api/cron/entry-watcher) code=500; body='{"ok":false,"error":"x"}' ;;
    esac ;;
esac
if [ -n "$mt" ] && [ "$took" -gt "$mt" ]; then took=$mt; code=000; fi
[ "$took" -gt 0 ] && adv "$took"
if [ -n "$out" ]; then if [ "$code" = "000" ]; then : > "$out"; else printf '%s' "$body" > "$out"; fi; fi
printf '%s' "$code"
[ "$code" = "000" ] && exit 28
exit 0
EOF
  chmod +x "$R/bin/date" "$R/bin/sleep" "$R/bin/curl"
  : > "$R/calls"; : > "$R/maxtime"; : > "$R/posts"; : > "$R/received"; : > "$R/heartbeats"; : > "$R/spoolsize"
  [ -f "$W/body-edgar" ] && cp "$W/body-edgar" "$R/body-edgar"
  env PATH="$R/bin:$PATH" HOME="$R/home" PROJECT_DIR="$R/proj" BASE_URL="http://stub" TZ=Asia/Seoul \
    STUB_R="$R" STUB_REAL_DATE="$REAL_DATE" "$@" timeout 900 bash "$runner" > "$R/stdout" 2>&1
  echo "$R"
}

JRE=' /api/cron/job-run-log$'
nojrl()   { grep -vE "$JRE" "$1/calls"; }                                   # 기록 전송을 뺀 호출(시각·틱·경로)
nojrlmt() { grep -v '^/api/cron/job-run-log ' "$1/maxtime"; }
gap()     { awk 'NR>1 { g = $1 - p; if (g > m) m = g } { p = $1 } END { print m + 0 }' "$1/heartbeats"; }
spool()   { cat "$1/home/.node-local/stockinvest/job-run-spool" "$1/home/.node-local/stockinvest/job-run-spool.sending" 2>/dev/null; }
dfiles()  { ( cd "$1/home/.node-local/stockinvest" && for f in *-last-date *-attempts; do [ -f "$f" ] && echo "$f=$(cat "$f")"; done ) 2>/dev/null | sort; }
same_calls() {   # same_calls 라벨 새 기준
  if diff <(nojrl "$2") <(nojrl "$3") > /dev/null; then ok "🔴 $1: 기록 전송을 뺀 모든 호출(시각·틱·경로) = 기준 러너 ($(nojrl "$2" | wc -l | tr -d ' ')건)"
  else bad "$1: 기록 전송을 뺀 호출 목록이 기준 러너와 다르다"; diff <(nojrl "$2") <(nojrl "$3") | head -10; fi
}
# 받은 줄 + 남은 스풀 줄의 경로별 개수 = 호출 목록의 경로별 개수
path_counts_calls() { nojrl "$1" | awk '{print $4}' | sort | uniq -c; }
path_counts_lines() { { cat "$1/received"; spool "$1"; } | awk -F'\t' '{print $3}' | sort | uniq -c; }

# ── J1. 하루 전체 ─────────────────────────────────────────────────────────────────
if want J1; then
echo "J1. 하루 전체 1440틱 (00:00~23:59) — 후크 켜짐 / 기준 러너 / 후크 꺼짐"
NA="$(run_loop new-day "$RUNNER" "2026-10-28 00:00:00" 1440 ok ok "")"
BA="$(run_loop base-day "$BASE" "2026-10-28 00:00:00" 1440 ok ok "")"
NO="$(run_loop off-day "$RUNNER" "2026-10-28 00:00:00" 1440 ok ok "" JRL_SPOOL_FILE=)"
eq "J1: 1440틱 완주(새·기준·끔)" "$(cat "$NA/ticks") $(cat "$BA/ticks") $(cat "$NO/ticks")" "1440 1440 1440"
same_calls "J1 새" "$NA" "$BA"
same_calls "J1 끔" "$NO" "$BA"
if diff <(nojrlmt "$NA") "$BA/maxtime" > /dev/null; then ok "🔴 J1: 기록 전송을 뺀 --max-time 목록 = 기준 러너"; else bad "J1: --max-time 목록이 다르다"; fi
if diff "$NA/stdout" "$BA/stdout" > /dev/null; then ok "🔴 J1: stdout(로그 줄) = 기준 러너 ($(wc -l < "$NA/stdout" | tr -d ' ')줄)"; else bad "J1: stdout 이 다르다"; diff "$NA/stdout" "$BA/stdout" | head -5; fi
if diff "$NO/stdout" "$BA/stdout" > /dev/null; then ok "J1: 후크 끈 러너 stdout = 기준 러너"; else bad "J1: 후크 끈 러너 stdout 이 다르다"; fi
if diff "$NA/heartbeats" "$BA/heartbeats" > /dev/null; then ok "🔴 J1: 하트비트 기록 = 기준 러너(1440개)"; else bad "J1: 하트비트가 다르다"; fi
if diff <(dfiles "$NA") <(dfiles "$BA") > /dev/null; then ok "J1: 날짜파일·시도 기록 = 기준 러너 ($(dfiles "$NA" | wc -l | tr -d ' ')개)"; else bad "J1: 날짜파일이 다르다"; diff <(dfiles "$NA") <(dfiles "$BA") | head -5; fi
NCALLS="$(nojrl "$NA" | wc -l | tr -d ' ')"
eq "🔴 J1: 받은 줄 + 남은 스풀 = call() 호출 수(한 번에 한 줄)" "$(( $(wc -l < "$NA/received") + $(spool "$NA" | wc -l) ))" "$NCALLS"
if diff <(path_counts_calls "$NA") <(path_counts_lines "$NA") > /dev/null; then ok "🔴 J1: 경로별 줄 수 = 경로별 호출 수"; else bad "J1: 경로별 줄 수가 다르다"; diff <(path_counts_calls "$NA") <(path_counts_lines "$NA") | head -5; fi
eq "J1: 끝나면 스풀이 비어 있다(마지막 틱도 보냄)" "$(spool "$NA" | wc -l | tr -d ' ')" "0"
eq "🔴 J1: 줄 형식 v1·7칸·HTTP 3자리·시작 ≤ 종료·ms 13자리" \
   "$(awk -F'\t' 'NF != 7 || $1 != "v1" || $4 !~ /^[0-9][0-9][0-9]$/ || $5 !~ /^[0-9]+$/ || $6 !~ /^[0-9]+$/ || length($5) != 13 || length($6) != 13 || $5 + 0 > $6 + 0 { b++ } END { print b + 0 }' "$NA/received")" "0"
eq "J1: 매 분 잡 3개 200 은 본문 칸이 비어 있다" \
   "$(awk -F'\t' '($2 == "entry-watcher" || $2 == "holding-checker" || $2 == "stop-alert") && $7 != "" { b++ } END { print b + 0 }' "$NA/received")" "0"
eq "J1: 다른 잡은 본문 '{}' 의 base64(e30=)" \
   "$(awk -F'\t' '!($2 == "entry-watcher" || $2 == "holding-checker" || $2 == "stop-alert") && $7 != "e30=" { b++ } END { print b + 0 }' "$NA/received")" "0"
eq "J1: 라벨 ↔ 경로가 한 쌍씩(라벨마다 경로 1개)" "$(awk -F'\t' '{print $2, $3}' "$NA/received" | sort -u | awk '{print $1}' | uniq -d | wc -l | tr -d ' ')" "0"
eq "J1: peek 라벨 21개(해외 19 · 국내 2)" "$(awk -F'\t' '$2 ~ /^news-peek-(overseas|domestic)-[0-9][0-9]$/ {print $2}' "$NA/received" | sort -u | wc -l | tr -d ' ')" "21"
eq "J1: export-llm-trainset(call() 밖)·job-run-log(전송 자신) 라벨 없음" "$(awk -F'\t' '$2 == "export-llm-trainset" || $2 == "job-run-log" || $3 ~ /job-run-log/' "$NA/received" | wc -l | tr -d ' ')" "0"
eq "J1: export-llm-trainset 는 그래도 돌았다(stdout)" "$(grep -c 'export-llm-trainset OK' "$NA/stdout")" "1"
eq "🔴 J1: 전송 = 틱마다 1회(1440, 모든 틱이 가벼움)" "$(wc -l < "$NA/posts" | tr -d ' ')" "1440"
eq "J1: 전송마다 --max-time 3" "$(grep -c '^/api/cron/job-run-log max-time=3$' "$NA/maxtime")" "1440"
eq "J1: 한 번 전송 ≤ 200줄, 빈 전송 없음" "$(awk '$2 > 200 || $2 == 0 { b++ } END { print b + 0 }' "$NA/posts")" "0"
eq "J1: 후크 끈 러너 — 전송 0 · 스풀 파일 없음" "$(wc -l < "$NO/posts" | tr -d ' ') $(ls "$NO/home/.node-local/stockinvest/" | grep -c '^job-run-spool')" "0 0"
eq "J1: 시작·종료 ms 가 그 호출의 가짜 시각(초 단위 000)" "$(awk -F'\t' '$5 !~ /000$/ || $6 !~ /000$/ { b++ } END { print b + 0 }' "$NA/received")" "0"

fi
# ── J2. 앱 다운 → 회복 ────────────────────────────────────────────────────────────
if want J2; then
echo "J2. 기록 라우트 다운 70틱 → 회복 (10:00 시작, 80틱)"
ND="$(run_loop new-down "$RUNNER" "2026-10-28 10:00:00" 80 ok down70 "")"
BD="$(run_loop base-down "$BASE" "2026-10-28 10:00:00" 80 ok ok "")"
eq "J2: 80틱 완주" "$(cat "$ND/ticks")" "80"
same_calls "J2" "$ND" "$BD"
eq "🔴 J2: 실패 로그 1줄 · 회복 로그 1줄(매 분 반복 안 함)" \
   "$(grep -c 'job-run-log 전송 실패 HTTP=000' "$ND/stdout") $(grep -c 'job-run-log 전송 회복' "$ND/stdout")" "1 1"
eq "J2: 다운 동안 받은 줄 0, 스풀은 계속 커짐" "$(awk 'NR < 70 && NR > 1 && $1 + 0 < p { b++ } { p = $1 } END { print b + 0 }' "$ND/spoolsize")" "0"
NDC="$(nojrl "$ND" | wc -l | tr -d ' ')"
eq "🔴 J2: 회복 뒤 받은 줄 = 만든 줄 전부" "$(( $(wc -l < "$ND/received") + $(spool "$ND" | wc -l) ))" "$NDC"
eq "🔴 J2: 중복 없음" "$(sort "$ND/received" | uniq -d | wc -l | tr -d ' ')" "0"
if diff <(awk -F'\t' '{print $3}' "$ND/received") <(nojrl "$ND" | awk '{print $4}' | head -n "$(wc -l < "$ND/received")") > /dev/null; then ok "🔴 J2: 받은 순서 = 호출 순서"; else bad "J2: 받은 순서가 다르다"; fi
eq "🔴 J2: 회복 첫 전송(틱 70) 200줄(상한) → 다음 틱(71)에 나머지(< 200)" "$(awk '$1 == 70 {print $2}' "$ND/posts") $(awk '$1 == 71 { print ($2 < 200 && $2 > 0) ? "rest" : "bad" }' "$ND/posts")" "200 rest"
eq "J2: 다운 동안의 시도도 한 번에 200줄 이하" "$(awk '$2 > 200' "$ND/posts" | wc -l | tr -d ' ')" "0"
eq "J2: 전송은 매 틱 시도(80)" "$(wc -l < "$ND/posts" | tr -d ' ')" "80"

fi
# ── J3. 150초 규칙·하트비트 ────────────────────────────────────────────────────────
if want J3; then
echo "J3. 08시 최악 틱 + 느린 기록 라우트(3초 상한) — 08:00:00 시작 4틱(첫 틱이 최악, 뒤 3틱은 가벼움)"
# 시작을 08:00:00 에 맞춘다 — 그 전 가벼운 틱에서 새 러너는 전송 3초씩 늦어져(기준 러너는 0초) 틱이 시(時) 경계를 다르게 넘을 수 있다.
NW="$(run_loop new-worst "$RUNNER" "2026-10-28 08:00:00" 4 worst08 slow "")"
BW="$(run_loop base-worst "$BASE" "2026-10-28 08:00:00" 4 worst08 ok "")"
eq "J3: 4틱 완주" "$(cat "$NW/ticks") $(cat "$BW/ticks")" "4 4"
if diff <(nojrl "$NW" | awk '{print $1, substr($2,1,5), $4}') <(nojrl "$BW" | awk '{print $1, substr($2,1,5), $4}') > /dev/null; then ok "J3: 호출 목록(분 단위)·순서 = 기준 러너"; else bad "J3: 호출 목록이 다르다"; diff <(nojrl "$NW" | awk '{print $1, substr($2,1,5), $4}') <(nojrl "$BW" | awk '{print $1, substr($2,1,5), $4}') | head; fi
HT="$(nojrl "$NW" | awk '$4 ~ /post-market-analysis\?market=overseas/ {print $3}')"
eq "(하네스 확인) J3: 08:00 틱에 해외 분석이 돌았다" "$(nojrl "$NW" | awk '$4 ~ /post-market-analysis\?market=overseas/ {print substr($2,1,5)}')" "08:00"
eq "🔴 J3: 무거운 틱(경과 ≥ 150초)에는 전송하지 않는다" "$(awk -v t="$HT" '$1 == t' "$NW/posts" | wc -l | tr -d ' ')" "0"
eq "J3: 가벼운 틱은 전송했다(나머지 3틱)" "$(wc -l < "$NW/posts" | tr -d ' ')" "3"
gN="$(gap "$NW")"; gB="$(gap "$BW")"
eq "(하네스 확인) J3: 기준 러너 최대 간격 = 230 + 60 = 290초" "$gB" "290"
eq "🔴 J3: 새 러너 최대 간격 = 기준(290초) — 후크가 최악 틱을 늘리지 않음" "$gN" "$gB"
if [ "$gN" -lt 300 ]; then ok "🔴 J3: 하트비트 최대 간격 ${gN}초 < 300초(워치독·순찰 한도)"; else bad "J3: 하트비트 ${gN}초 ≥ 300"; fi
eq "J3: 가벼운 틱 간격 = 기준 + 3초(전송 curl 상한)" \
   "$(paste -d' ' <(awk 'NR>1 { print $1 - p } { p = $1 }' "$NW/heartbeats") <(awk 'NR>1 { print $1 - p } { p = $1 }' "$BW/heartbeats") | awk '$2 != 290 && $1 != $2 + 3 { b++ } END { print b + 0 }')" "0"
eq "J3: 전송마다 --max-time 3" "$(grep -c '^/api/cron/job-run-log max-time=3$' "$NW/maxtime")" "3"
eq "J3: 느린 라우트(000) — 스풀 보존(받은 줄 0, 남은 줄 = 호출 수)" "$(wc -l < "$NW/received" | tr -d ' ') $(spool "$NW" | wc -l | tr -d ' ')" "0 $(nojrl "$NW" | wc -l | tr -d ' ')"

fi
# ── J4. 스풀 상한 ─────────────────────────────────────────────────────────────────
if want J4; then
echo "J4. 스풀 상한 — 3MiB 미리 쌓임 + 앱 다운"
SEED="$W/seed.sending"
awk -v pad="$(head -c 3000 /dev/zero | tr '\0' 'A')" 'BEGIN { for (i = 1; i <= 1100; i++) printf "v1\tseed-%04d\t/api/cron/x\t200\t1793000000000\t1793000000001\t%s\n", i, pad }' > "$SEED"
SZ0="$(wc -c < "$SEED" | tr -d ' ')"
NC="$W/new-cap"; mkdir -p "$NC/home/.node-local/stockinvest"; cp "$SEED" "$NC/home/.node-local/stockinvest/job-run-spool.sending"
NC="$(run_loop new-cap "$RUNNER" "2026-10-28 10:00:00" 3 ok down "")"
BC="$(run_loop base-cap "$BASE" "2026-10-28 10:00:00" 3 ok ok "")"
eq "(하네스 확인) J4: 미리 쌓은 스풀 > 2MiB" "$([ "$SZ0" -gt 2097152 ] && echo yes || echo no)" "yes"
same_calls "J4" "$NC" "$BC"
eq "🔴 J4: 상한 로그 1줄" "$(grep -c 'job-run-log 스풀 상한(2097152B) 초과 — 오래된 [0-9][0-9]*줄 버림' "$NC/stdout")" "1"
SZ1="$(head -1 "$NC/spoolsize")"
eq "🔴 J4: 첫 틱 끝 스풀 ≤ 1MiB + 그 틱의 새 줄" "$([ "$SZ1" -le $((1048576 + 4096)) ] && echo yes || echo no)" "yes"
eq "J4: 가장 새 시드 줄은 남고 가장 오래된 줄은 버려짐" "$(spool "$NC" | grep -c $'\tseed-1100\t') $(spool "$NC" | grep -c $'\tseed-0001\t')" "1 0"
eq "J4: 남은 줄은 모두 온전(7칸)" "$(spool "$NC" | awk -F'\t' 'NF != 7 { b++ } END { print b + 0 }')" "0"

fi
# ── J5. 본문 ──────────────────────────────────────────────────────────────────────
if want J5; then
echo "J5. 본문 — 따옴표·줄바꿈·탭·한글·이모지 3KB, 매 분 잡 500"
{ printf '{"ok":true,"msg":"따옴표 \\" 와 '"'"'홑따옴표'"'"'\n줄바꿈\t탭 😀 '; head -c 3000 /dev/zero | tr '\0' 'x'; printf '"}'; } > "$W/body-edgar"
NB="$(run_loop new-body "$RUNNER" "2026-10-28 06:59:00" 3 bodies ok "")"
EL="$(awk -F'\t' '$2 == "edgar-sync"' "$NB/received")"
eq "J5: edgar-sync 한 줄(7칸)" "$(printf '%s\n' "$EL" | awk -F'\t' 'NF == 7' | wc -l | tr -d ' ')" "1"
if cmp -s <(printf '%s\n' "$EL" | awk -F'\t' '{print $7}' | base64 -d) <(head -c 2048 "$W/body-edgar"); then ok "🔴 J5: base64 를 풀면 본문 앞 2048바이트 그대로"; else bad "J5: 본문이 다르다"; fi
eq "J5: 매 분 잡 500 은 본문 있음(entry-watcher)" "$(awk -F'\t' '$2 == "entry-watcher" && $4 == "500" && $7 != "" ' "$NB/received" | head -1 | awk -F'\t' '{print $7}' | base64 -d)" '{"ok":false,"error":"x"}'
eq "J5: 매 분 잡 200 은 본문 없음(holding-checker)" "$(awk -F'\t' '$2 == "holding-checker" && $7 != ""' "$NB/received" | wc -l | tr -d ' ')" "0"
eq "J5: 받은 줄 수 = 호출 수(줄이 깨지지 않음)" "$(wc -l < "$NB/received" | tr -d ' ')" "$(nojrl "$NB" | wc -l | tr -d ' ')"

fi
# ── J6. 스풀을 쓸 수 없음 ─────────────────────────────────────────────────────────
if want J6; then
echo "J6. 스풀 경로를 쓸 수 없음(없는 디렉터리) — 30틱"
NU="$(run_loop new-unw "$RUNNER" "2026-10-28 07:00:00" 30 ok ok "" "JRL_SPOOL_FILE=$W/no-such-dir/x/spool")"
BU="$(run_loop base-unw "$BASE" "2026-10-28 07:00:00" 30 ok ok "")"
eq "🔴 J6: 러너 생존(30틱 완주)" "$(cat "$NU/ticks")" "30"
same_calls "J6" "$NU" "$BU"
if diff "$NU/stdout" "$BU/stdout" > /dev/null; then ok "🔴 J6: stdout = 기준 러너(오류 출력이 새지 않음)"; else bad "J6: stdout 이 다르다"; diff "$NU/stdout" "$BU/stdout" | head -5; fi
if diff "$NU/heartbeats" "$BU/heartbeats" > /dev/null; then ok "J6: 하트비트 = 기준 러너"; else bad "J6: 하트비트가 다르다"; fi
eq "J6: 전송 0(보낼 줄이 없음)" "$(wc -l < "$NU/posts" | tr -d ' ')" "0"

fi
# ── J7. 해외 분석 재시도 ──────────────────────────────────────────────────────────
if want J7; then
echo "J7. 해외 분석 502 — 재시도(CALL_LAST_CODE) 불변 (07:59 시작 25틱)"
NP="$(run_loop new-pmo "$RUNNER" "2026-10-28 07:59:00" 25 pmo502 ok "")"
BP="$(run_loop base-pmo "$BASE" "2026-10-28 07:59:00" 25 pmo502 ok "")"
eq "🔴 J7: 해외 분석 호출 시각 08:00·08:10·08:20(기준과 같음)" \
   "$(nojrl "$NP" | awk '$4 ~ /market=overseas/ {print substr($2,1,5)}' | tr '\n' ' ')" "$(nojrl "$BP" | awk '$4 ~ /market=overseas/ {print substr($2,1,5)}' | tr '\n' ' ')"
eq "(하네스 확인) J7: 3회" "$(nojrl "$NP" | grep -c 'market=overseas')" "3"
same_calls "J7" "$NP" "$BP"
if diff <(dfiles "$NP") <(dfiles "$BP") > /dev/null; then ok "J7: 날짜파일·시도 기록 = 기준 러너"; else bad "J7: 날짜파일·시도 기록이 다르다"; fi
eq "J7: 해외 분석 줄 3개 모두 HTTP 502" "$(awk -F'\t' '$2 == "post-market-overseas" {print $4}' "$NP/received" | tr '\n' ' ')" "502 502 502 "

fi
# ── J8. 정적 ──────────────────────────────────────────────────────────────────────
if want J8; then
echo "J8. 정적"
eq "bash -n" "$(bash -n "$RUNNER" 2>&1 && echo ok)" "ok"
missing="$(awk 'NR==FNR { cur[++n] = $0; next } { while (j < n && cur[j+1] != $0) j++; if (j >= n) { print FNR": "$0; exit } j++ }' "$RUNNER" "$BASE")"
eq "🔴 J8: 기준 러너의 모든 줄(주석 포함)이 순서대로 남아 있다(삭제·수정 0, 추가만)" "${missing:-none}" "none"
eq "🔴 J8: call() 에서 '# T-112 jrl' 두 줄을 빼면 기준 러너와 같다" \
   "$(awk '/^call\(\) \{/,/^\}/' "$RUNNER" | grep -v '# T-112 jrl$' | sha256sum)" "$(awk '/^call\(\) \{/,/^\}/' "$BASE" | sha256sum)"
eq "J8: call() 안 표지 줄 2개, 파일 전체 4개" "$(awk '/^call\(\) \{/,/^\}/' "$RUNNER" | grep -c '# T-112 jrl$') $(grep -c '# T-112 jrl$' "$RUNNER")" "2 4"
cb="$(awk '/^call\(\) \{/,/^\}/' "$RUNNER")"
eq "J8: 후크는 로그 줄 뒤·임시 본문 rm 바로 앞" "$(printf '%s\n' "$cb" | grep -A1 'jrl_hook ' | tail -1 | sed 's/^ *//')" 'rm -f /tmp/cron-runner-$$.out'
eq "J8: 후크 호출 줄" "$(printf '%s\n' "$cb" | grep 'jrl_hook ' | sed 's/^ *//')" 'jrl_hook "$label" "$path" "$code" "${jrl_t0:-}" 2>/dev/null || true   # T-112 jrl'
eq "J8: 전송 줄은 i 증가 바로 앞 · 틱 시작 줄은 하트비트 바로 뒤" \
   "$(grep -A1 'jrl_flush "${JRL_TICK_T0:-}"' "$RUNNER" | tail -1 | sed 's/^ *//') | $(grep -B1 'JRL_TICK_T0=$(date +%s' "$RUNNER" | head -1 | sed 's/^ *//')" \
   'i=$(( (i + 1) % 1440 ))   # 24h 사이클 | && mv -f "${CRON_HEARTBEAT_FILE}.tmp" "${CRON_HEARTBEAT_FILE}"; } 2>/dev/null || true'
blk="$(awk '/^# >>> job-run-log-spool/,/^# <<< job-run-log-spool/' "$RUNNER")"
bx="$(printf '%s\n' "$blk" | grep -v '^[[:space:]]*#')"
eq "J8: 블록 표지 1개씩 · 루프(while true) 앞" "$(grep -c '^# >>> job-run-log-spool' "$RUNNER") $(grep -c '^# <<< job-run-log-spool' "$RUNNER") $([ "$(grep -n '^# <<< job-run-log-spool' "$RUNNER" | cut -d: -f1)" -lt "$(grep -n '^while true; do' "$RUNNER" | cut -d: -f1)" ] && echo yes || echo no)" "1 1 yes"
eq "🔴 J8: 상수 150초·3초·200줄·2MiB·1MiB·본문 2048" \
   "$(printf '%s\n' "$bx" | grep -cE '^JRL_FLUSH_MAX_ELAPSED_SEC=150$|^JRL_FLUSH_CURL_MAX_TIME=3$|^JRL_FLUSH_MAX_LINES=200$|^JRL_SPOOL_MAX_BYTES=2097152$|^JRL_SPOOL_KEEP_BYTES=1048576$|^JRL_BODY_MAX_BYTES=2048$')" "6"
eq "🔴 J8: 150초 규칙 줄" "$(printf '%s\n' "$bx" | grep -c '^  \[ "\$el" -lt "\$JRL_FLUSH_MAX_ELAPSED_SEC" \] || return 0$')" "1"
eq "J8: 블록 안 curl 1개 · --max-time 있음 · call() 을 부르지 않음" \
   "$(printf '%s\n' "$bx" | grep -c 'curl ') $(printf '%s\n' "$bx" | grep -c 'curl -s --max-time "\$JRL_FLUSH_CURL_MAX_TIME"') $(printf '%s\n' "$bx" | grep -cE '(^|[;&|[:space:]])call ')" "1 1 0"
eq "J8: 블록이 비밀을 출력하지 않음(echo 줄에 CRON_SECRET 없음)" "$(printf '%s\n' "$bx" | grep 'echo ' | grep -c 'CRON_SECRET')" "0"
eq "J8: 하트비트 최악 계산 주석(전송 틱 213초 · 무거운 틱 290.2초) · 08시 상수 주석 갱신" \
   "$(printf '%s\n' "$blk" | grep -c '≈ 213초 < 300초') $(printf '%s\n' "$blk" | grep -c '≈ 290.2초 < 300초') $(grep -c '^# (T-112) 기록 후크(call() 마다 로컬 스풀 한 줄' "$RUNNER")" "1 1 1"
eq "J8: export-llm-trainset 는 여전히 call() 밖" "$(grep -v '^[[:space:]]*#' "$RUNNER" | grep -c 'call [^ ]* "export-llm-trainset"')" "0"
eq "J8: 상단 잡 목록 주석에 기록 후크" "$(sed -n '1,45p' "$RUNNER" | grep -c '^#  - (T-112) 실행·상태 기록 후크')" "1"

fi
echo
echo "결과: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
