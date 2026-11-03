#!/usr/bin/env bash
# T-147 — cron-runner.sh 의 손절 알림 티커(alert-ticker)와 **fail-open 되돌림**(stop-alert-fallback) 시험.
#
# 실행: bash scripts/test-cron-runner-alert-ticker.sh   (NFS noexec 경로라 반드시 bash 경유. 약 3분 — E 절이 실제 시각으로 돈다)
#
# 두 층이다.
#  A~D. 블록 단위 — 러너에서 `# >>> alert-ticker` 함수부만 잘라 `source` 하고 가짜 `call`·가짜 `sleep`·가짜 `date` 로 돌린다
#       (선례: scripts/test-cron-runner-pmo-retry.sh A 절). 러너 루프를 기동하지 않는다.
#  E.   실시간 — 러너를 **그대로** 띄우고 `curl` 만 스텁으로 바꿔 실제 `sleep`·`date`·`flock` 으로 2~3틱 돌린다.
#       (기존 통합 하네스들은 `sleep` 을 즉시 반환 스텁으로 바꿔 가짜 시계를 밀기 때문에 티커 자식의 대기를 시험할 수 없다.
#        그 하네스들은 `ALERT_TICKER_DISABLE=1` 로 레거시 모드에서 돈다 — 그 모드 자체는 E1 이 본다.)
#
# 무엇을 고정하나 — T-147 의 핵은 「stop-alert 호출자는 **항상 정확히 하나**이고, 어느 실패 경로에서도 **알림이 사라지지 않는다**」다:
#  ① 메인 루프의 호출은 `# >>> stop-alert-fallback` 블록 안에만 있고 `ALERT_TICKER_ACTIVE != 1` 가드 밑이다            (정적)
#  ② 러너 전체 호출 줄은 2개 — 티커 블록 1 + fallback 1, 그 밖 0. `ALERT_TICKER_ACTIVE` 는 기동에서만 1 이 되고
#     감독에서만 0 으로 내려간다(두 호출자가 동시에 참이 될 수 없다)                                                 (정적)
#  ③ 티커는 `flock -n` 으로 겹침을 막는다 — 락을 쥔 상태의 한 회차는 호출 0, 풀면 1회                                 (동작)
#  ④ 부모가 없으면 티커가 스스로 끝낸다(고아 방지)                                                                  (동작)
#  ⑤ `CALL_MAX_TIME` 은 각 호출에만 20 이고 부모 셸·다른 잡으로 새지 않는다                                    (정적 + 동작)
#  ⑥ `bash -n scripts/cron-runner.sh` 통과                                                                      (정적)
#  ⑦ 대기가 실제로 돌지 않으면 바쁜 루프 가드가 티커를 끝낸다(알림 라우트 폭주 방지)                                   (동작)
#  ⑧ 분 경계 정렬 — 남은 초 1~60, 시각을 못 읽으면 60                                                             (동작)
#  ⑨ 하트비트 중간 갱신이 `jrl_flush` 앞에 있고, 레거시 모드에서는 건너뛴다. 틱 시작 기록은 그대로                      (정적)
#  ⑩ 🔴 티커는 하트비트를 **쓰지 않는다** — 쓰면 메인 루프가 멈춰도 두 감시자가 영원히 발동하지 않는다                   (정적)
#  ⑪ `alert_ticker_alive` 가 좀비(reap 전 종료)를 살아 있다고 보지 않는다                                           (동작)
#  ⑫ 🔴 `flock -n` 실패를 **경합과 진짜 오류로 가른다** — 경합(rc 1)은 그 회차만 건너뛰고 연속 3회에 경고 1줄(한 번만),
#     진짜 오류(락 파일을 열 수 없음 등)는 로그 1줄 남기고 티커를 끝내 감독이 메인 루프로 넘긴다                        (동작)
#  E1 🔴 `ALERT_TICKER_DISABLE=1` = T-147 이전 동작 — 티커 없음 · 메인 루프가 매 틱 호출 · 하트비트 추가 쓰기 없음      (실시간)
#  E2 🔴 fail-open — 락 파일을 만들 수 없으면 티커 없이 메인 루프가 매 틱 호출(알림 소실 없음)                          (실시간)
#  E3 🔴 기본 모드는 티커가 분 경계에 부르고 메인 루프는 부르지 않는다. 티커를 PID 로 죽이면 **다음 틱부터** 메인 루프가
#     이어받고 전환 로그가 한 줄 남는다(감독)                                                                      (실시간)
#
# 외부 호출 없음(curl 은 스텁), 실제 HOME·.env 를 읽지 않음(임시 디렉터리), 프로세스 종료는 **PID 로만**(ISS-0002).
# ⚠ ③④⑦⑧⑪·E 절은 `flock`(util-linux)이 필요하다 — 없는 환경(맥)에서는 SKIP 으로 표시하고 정적 시험만 돈다.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="$HERE/cron-runner.sh"
PASS=0; FAIL=0; SKIP=0
ok()   { PASS=$((PASS + 1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
skip() { SKIP=$((SKIP + 1)); echo "  skip $1"; }
eq()   { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (기대 '$3', 실제 '$2')"; fi; }

W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT

# ── 블록 잘라내기 ────────────────────────────────────────────────────────────
# 함수부 = 시작 표지 ~ `alert_ticker_alive` 정의 끝. 기동 스탠자(`if [ "$ALERT_TICKER_DISABLE" = "1" ]` …)는 빼고 source 한다 —
# 같이 넣으면 시험 프로세스가 **진짜 티커 자식을 띄운다**. 기동 스탠자는 아래 A 절(정적)·E 절(실시간)이 본다.
awk '/^# >>> alert-ticker/{f=1} /^if \[ "\$ALERT_TICKER_DISABLE" = "1" \]/{f=0} f{print}' "$RUNNER" > "$W/block.sh"
LAUNCH="$(awk '/^if \[ "\$ALERT_TICKER_DISABLE" = "1" \]/{f=1} f{print} /^# <<< alert-ticker/{f=0}' "$RUNNER")"
BLOCK="$(awk '/^# >>> alert-ticker/{f=1} f{print} /^# <<< alert-ticker/{f=0}' "$RUNNER")"
FALLBACK="$(awk '/^  # >>> stop-alert-fallback/{f=1} f{print} /^  # <<< stop-alert-fallback/{f=0}' "$RUNNER")"
SUPER="$(awk '/^  # >>> alert-ticker-supervise/{f=1} f{print} /^  # <<< alert-ticker-supervise/{f=0}' "$RUNNER")"
HBR="$(awk '/^  # >>> heartbeat-refresh/{f=1} f{print} /^  # <<< heartbeat-refresh/{f=0}' "$RUNNER")"
MAIN="$(awk '/^while true; do/{f=1} f{print}' "$RUNNER")"
for v in block.sh; do [ -s "$W/$v" ] || { echo "alert-ticker 함수부를 찾지 못함"; exit 1; }; done
for n in LAUNCH BLOCK FALLBACK SUPER HBR MAIN; do
  eval "v=\$$n"; [ -n "$v" ] || { echo "$n 구간을 찾지 못함"; exit 1; }
done

CALLRE='call /api/cron/stop-alert '
echo "A. 정적 — 호출자는 항상 정확히 하나 · fail-open"
eq "🔴 ② 러너 전체 stop-alert 호출 줄 2개(티커 1 + fallback 1)" "$(grep -c "$CALLRE" "$RUNNER")" "2"
eq "🔴 ② 티커 블록 안 1개" "$(printf '%s\n' "$BLOCK" | grep -c "$CALLRE")" "1"
eq "🔴 ① fallback 블록 안 1개" "$(printf '%s\n' "$FALLBACK" | grep -c "$CALLRE")" "1"
eq "🔴 ① 메인 루프의 호출은 fallback 블록 밖에 없다" \
   "$(printf '%s\n' "$MAIN" | awk '/^  # >>> stop-alert-fallback/{s=1} s{ if (/^  # <<< stop-alert-fallback/) s=0; next } {print}' | grep -c "$CALLRE")" "0"
eq "🔴 ① fallback 은 ALERT_TICKER_ACTIVE != 1 가드 밑이다" \
   "$(printf '%s\n' "$FALLBACK" | grep -c 'if \[ "\$ALERT_TICKER_ACTIVE" != "1" \]; then')" "1"
# 🔴 두 호출자가 동시에 참이 될 수 없다는 근거: ACTIVE 에 1 을 넣는 곳이 기동 1곳, 0 으로 내리는 곳이 감독 1곳뿐이다.
eq "🔴 ② ACTIVE=1 대입은 기동 스탠자 1곳뿐" "$(grep -c '^  ALERT_TICKER_ACTIVE=1$' "$RUNNER")" "1"
eq "🔴 ② ACTIVE=1 이 그 기동 스탠자 안이다" "$(printf '%s\n' "$LAUNCH" | grep -c 'ALERT_TICKER_ACTIVE=1')" "1"
eq "🔴 ② ACTIVE=0 으로 내리는 곳은 감독 1곳뿐(초기값 선언 제외)" \
   "$(grep -c '^    ALERT_TICKER_ACTIVE=0$' "$RUNNER") $(printf '%s\n' "$SUPER" | grep -c 'ALERT_TICKER_ACTIVE=0')" "1 1"
eq "🔴 ② 초기값은 0 이다(티커를 띄우기 전에는 메인 루프가 호출자)" "$(grep -c '^ALERT_TICKER_ACTIVE=0   #' "$RUNNER")" "1"
eq "🔴 fail-open: 기동 실패 경로가 「메인 루프가 매 틱 직접 부른다」를 로그한다" \
   "$(printf '%s\n' "$LAUNCH" | grep -c '메인 루프가 매 틱 직접 부른다')" "1"
eq "🔴 ② 레거시 모드 분기가 기동 스탠자 맨 앞이다" \
   "$(printf '%s\n' "$LAUNCH" | head -1 | grep -c 'ALERT_TICKER_DISABLE" = "1"')" "1"
eq "레거시 모드 기동 로그에 모드가 눈에 띈다" "$(printf '%s\n' "$LAUNCH" | grep -c 'ALERT_TICKER_DISABLE=1 — 레거시 모드')" "1"
eq "⑤ CALL_MAX_TIME 상한 대입 2개(티커 1 + fallback 1)" "$(grep -c 'CALL_MAX_TIME="\$STOP_ALERT_CURL_MAX_TIME"' "$RUNNER")" "2"
eq "⑤ fallback 은 호출 뒤 상한을 비운다" \
   "$(printf '%s\n' "$FALLBACK" | grep -A2 'CALL_MAX_TIME="\$STOP_ALERT_CURL_MAX_TIME"' | sed -n '3p' | sed 's/^ *//')" 'CALL_MAX_TIME=""'
eq "상한 상수 20초 불변(T-068)" "$(grep -E '^STOP_ALERT_CURL_MAX_TIME=' "$RUNNER")" "STOP_ALERT_CURL_MAX_TIME=20"
eq "③ 겹침 방지 flock -n 은 티커 블록 안 1개" "$(printf '%s\n' "$BLOCK" | grep -c 'flock -n 9')" "1"
eq "⑫ 경합 종료 코드 상수(측정값 1)" "$(grep -c '^ALERT_TICKER_LOCK_BUSY_RC=1    #' "$RUNNER")" "1"
eq "⑫ 연속 건너뜀 경고 임계 상수 3" "$(grep -c '^ALERT_TICKER_MAX_LOCK_SKIPS=3  #' "$RUNNER")" "1"
eq "⑫ 한 회차 반환을 셋으로 가른다(0 호출 / 1 경합 / 2 오류)" \
   "$(printf '%s\n' "$BLOCK" | grep -c '0) return 0 ;;') $(printf '%s\n' "$BLOCK" | grep -c '"\$ALERT_TICKER_LOCK_BUSY_RC") return 1 ;;') $(printf '%s\n' "$BLOCK" | grep -c '\*) return 2 ;;')" "1 1 1"
eq "⑫ 경고는 = 비교로 한 번만 찍는다(>= 가 아니다)" \
   "$(printf '%s\n' "$BLOCK" | grep -c 'if \[ "\$lockskip" = "\$ALERT_TICKER_MAX_LOCK_SKIPS" \]; then')" "1"
eq "⑫ 진짜 오류일 때만 티커가 끝난다(경합 분기에는 return 이 없다)" \
   "$(printf '%s\n' "$BLOCK" | awk '/1\) lockskip=/{s=1} s{ if (/\*\) echo/) s=0; print }' | grep -c 'return')" "0"
eq "⑫ 주석에 flock 종료 코드 측정값이 있다(1 · 65 · 127)" \
   "$(printf '%s\n' "$BLOCK" | grep -c '다른 프로세스 점유 = \*\*1\*\*')" "1"
eq "④ 자식의 부모 생존 확인(kill -0)이 티커 블록 안에 있다" "$(printf '%s\n' "$BLOCK" | grep -c 'kill -0 "\$ALERT_TICKER_PARENT_PID"')" "1"
eq "④ trap 을 쓰지 않는다(pm2 SIGKILL 1.6초 — 블록 주석의 근거)" "$(printf '%s\n' "$BLOCK" | grep -c '^[[:space:]]*trap ')" "0"
eq "⑪ 감독은 좀비를 살아 있다고 보지 않는다(/proc 상태 확인)" "$(printf '%s\n' "$BLOCK" | grep -c '/proc/\$ALERT_TICKER_PID/stat')" "2"
eq "기동은 자식 1개 — alert_ticker_loop &" "$(printf '%s\n' "$LAUNCH" | grep -c 'alert_ticker_loop &')" "1"
eq "감독 로그는 전환 때 한 줄(ACTIVE=1 일 때만 검사)" "$(printf '%s\n' "$SUPER" | grep -c '\[ "\$ALERT_TICKER_ACTIVE" = "1" \] && ! alert_ticker_alive')" "1"
eq "티커 블록은 메인 루프보다 앞에 있다" \
   "$(awk '/^# <<< alert-ticker/{a=NR} /^while true; do/{b=NR} END{print (a>0 && b>a) ? "yes" : "no"}' "$RUNNER")" "yes"
eq "감독 블록이 fallback 블록보다 앞이다(같은 틱에 전환이 반영된다)" \
   "$(awk '/^  # <<< alert-ticker-supervise/{a=NR} /^  # >>> stop-alert-fallback/{b=NR} END{print (a>0 && b>a) ? "yes" : "no"}' "$RUNNER")" "yes"
for j in entry-watcher holding-checker strategy-eval; do
  eq "$j 는 메인 루프에 남아 있다" "$(printf '%s\n' "$MAIN" | grep -c "call /api/cron/$j ")" "1"
  eq "$j 는 티커 블록에 없다" "$(printf '%s\n' "$BLOCK" | grep -c "/api/cron/$j")" "0"
done
# 🔴 티커가 하트비트를 쓰면 나이가 늘 60초 미만이 되어, 메인 루프가 영구히 멈춰도 HOME-SERVER 순찰·앱 워치독
# (src/lib/ops/cron-watchdog.ts "cron 정지" critical)이 영원히 발동하지 않는다.
eq "🔴 ⑩ 티커 블록은 하트비트를 쓰지 않는다" "$(printf '%s\n' "$BLOCK" | grep -c 'CRON_HEARTBEAT_FILE')" "0"
eq "⑨ 하트비트 중간 갱신 블록 1개" "$(grep -c '^[[:space:]]*# >>> heartbeat-refresh (T-147)' "$RUNNER")" "1"
eq "⑨ 그 블록은 jrl_flush 앞" \
   "$(awk '/^  # <<< heartbeat-refresh/{a=NR} /jrl_flush "\$\{JRL_TICK_T0:-\}"/{b=NR} END{print (a>0 && b>a) ? "yes" : "no"}' "$RUNNER")" "yes"
eq "⑨ 하트비트 쓰기는 2곳(틱 시작 + 중간 갱신)" "$(grep -c 'mv -f "\${CRON_HEARTBEAT_FILE}.tmp"' "$RUNNER")" "2"
eq "🔴 ⑨ 중간 갱신은 레거시 모드에서 건너뛴다" \
   "$(printf '%s\n' "$HBR" | grep -c 'if \[ "\$ALERT_TICKER_DISABLE" != "1" \]; then')" "1"
eq "⑨ 틱 시작 기록은 레거시 가드 밖이다(언제나 쓴다)" \
   "$(printf '%s\n' "$MAIN" | awk '/^  # >>> heartbeat-refresh/{s=1} s{ if (/^  # <<< heartbeat-refresh/) s=0; next } {print}' | grep -c 'mv -f "\${CRON_HEARTBEAT_FILE}.tmp"')" "1"
eq "④ 러너 주석이 틀린 하트비트 계산을 더는 담지 않는다" "$(grep -c 'sleep 60 + 다음 틱의 분당 잡' "$RUNNER")" "0"
eq "④ 주석의 실측값이 전체 로그 수치다(주기 412 · 길이 352)" \
   "$(printf '%s\n' "$HBR" | grep -c 'max \*\*412\*\*초') $(printf '%s\n' "$HBR" | grep -c 'max \*\*352\*\*초')" "1 1"
if bash -n "$RUNNER" 2>"$W/bashn"; then ok "⑥ bash -n 통과"; else bad "⑥ bash -n 실패: $(head -2 "$W/bashn")"; fi

# ── 동작 시험 공통 ───────────────────────────────────────────────────────────
# run_block CALLS EXTRA… : 블록 함수부를 source 한 뒤 EXTRA 를 돌린다. `call` 은 가짜(기록만).
run_block() {
  local calls="$1"; shift
  cat > "$W/t.sh" <<'SH'
set -u
STOP_ALERT_CURL_MAX_TIME=20
CALL_MAX_TIME=""
call() { printf 'call %s max=%s\n' "$1" "${CALL_MAX_TIME:-none}" >> "$CALLS"; }
. "$BLOCKFILE"
SH
  printf '%s\n' "$@" >> "$W/t.sh"
  : > "$calls"
  CALLS="$calls" BLOCKFILE="$W/block.sh" ALERT_TICKER_LOCK_FILE="$W/lock" \
    timeout 30 bash "$W/t.sh" 2>&1
}

# start_real NAME ENV… : 러너를 **실제 시각**으로 띄운다(curl 만 스텁). 러너 pid 를 $W/$NAME/pid 에 적는다.
start_real() {
  local name="$1"; shift
  local R="$W/$name"
  mkdir -p "$R/bin" "$R/home" "$R/proj"
  printf 'CRON_SECRET=test-secret\n' > "$R/proj/.env"
  cat > "$R/bin/curl" <<CURL
#!/usr/bin/env bash
out=""; url=""; mt=""
while [ \$# -gt 0 ]; do
  case "\$1" in
    -o) out="\$2"; shift 2 ;;
    --max-time) mt="\$2"; shift 2 ;;
    -w|-X|-H|-d|--data-binary) shift 2 ;;
    -s) shift ;;
    *) url="\$1"; shift ;;
  esac
done
printf '%s %s mt=%s\n' "\$(date '+%H:%M:%S')" "\${url#http://stub}" "\${mt:-none}" >> "$R/calls"
[ -n "\$out" ] && echo '{}' > "\$out"
printf '200'
CURL
  chmod +x "$R/bin/curl"
  : > "$R/calls"
  env PATH="$R/bin:$PATH" HOME="$R/home" PROJECT_DIR="$R/proj" BASE_URL="http://stub" TZ=Asia/Seoul "$@" \
    bash "$RUNNER" > "$R/out" 2>&1 &
  echo $! > "$R/pid"
}
# stop_real NAME — 러너를 **PID 로만** 끝낸다(ISS-0002: pkill·이름 패턴 금지). 자식 티커는 부모 확인으로 스스로 끝난다.
stop_real() {
  local R="$W/$1" p=""
  p="$(cat "$R/pid" 2>/dev/null || echo)"
  [ -n "$p" ] || return 0
  kill "$p" 2>/dev/null || true
  wait "$p" 2>/dev/null || true
}
# 호출 파일에서 holding-checker 바로 다음 줄이 stop-alert 인 횟수(= 메인 루프가 부른 횟수)
after_hc() { grep -A1 ' /api/cron/holding-checker ' "$1/calls" 2>/dev/null | grep -c ' /api/cron/stop-alert ' || true; }
sa_cnt()   { grep -c ' /api/cron/stop-alert ' "$1/calls" 2>/dev/null || true; }

if ! command -v flock > /dev/null 2>&1; then
  echo "B~E. 동작·실시간 — skip (이 환경에 flock 이 없다. 서버(util-linux)에서 돌려야 한다)"
  for s in "③ 락 겹침" "④ 고아 종료" "⑤ 상한 격리" "⑦ 바쁜 루프 가드" "⑧ 분 경계" "⑪ 좀비 감지" "⑫ 경합·오류 구분" "E1 레거시 모드" "E2 fail-open" "E3 감독 인수"; do skip "$s"; done
else

echo "B. ③ flock 겹침 — 락을 쥐고 있으면 그 회차를 건너뛴다"
: > "$W/lock"
flock "$W/lock" -c 'sleep 5' &
HOLDER=$!
held=no
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if flock -n "$W/lock" -c true 2>/dev/null; then sleep 0.2; else held=yes; break; fi
done
eq "(준비) 다른 프로세스가 락을 쥐었다" "$held" "yes"
out="$(run_block "$W/c-locked" 'alert_ticker_once; printf "rc=%s\n" "$?"')"
eq "🔴 ③ 락을 못 잡으면 호출 0회" "$(grep -c '^call ' "$W/c-locked")" "0"
eq "🔴 ⑫ 경합은 반환 1(진짜 오류 2 와 구분된다)" "$(printf '%s\n' "$out" | grep -c '^rc=1$')" "1"
# 🔴 ⑫ 경합이 계속되면: 호출 0 · 경고는 **딱 한 번** · 티커는 끝나지 않는다(겹친 티커가 알림을 보내는 중이므로 호출자를 늘리지 않는다)
out="$(run_block "$W/c-busy" \
  'c=0' 'sleep() { c=$((c + 1)); [ "$c" -gt 6 ] && exit 0; return 0; }' 'ALERT_TICKER_MIN_CYCLE_SEC=0' \
  'alert_ticker_loop; printf "returned=%s\n" "$?"')"
eq "🔴 ⑫ 경합 6회차: 호출 0회" "$(grep -c '^call ' "$W/c-busy")" "0"
eq "🔴 ⑫ 경합 경고는 한 번만" "$(printf '%s\n' "$out" | grep -c '회 연속 락을 잡지 못했다')" "1"
eq "⑫ 경합 경고에 3회가 찍힌다" "$(printf '%s\n' "$out" | grep -c '3회 연속 락을 잡지 못했다')" "1"
eq "🔴 ⑫ 경합으로는 티커가 끝나지 않는다(종료 로그 없음)" "$(printf '%s\n' "$out" | grep -c '티커 종료')" "0"
# 락 해제: 쥔 프로세스를 **PID 로만** 끝낸다(ISS-0002). `flock file -c cmd` 는 명령을 자식으로 돌려 그 자식이 fd 를 물려받으므로
# TERM 만 보내고 바로 다음 시험을 돌리면 **락이 아직 잡혀 있다**(첫 구현에서 실제로 이 함정에 걸렸다) → 실제로 풀렸는지 확인한다.
kill "$HOLDER" 2>/dev/null || true
wait "$HOLDER" 2>/dev/null || true
freed=no
for _ in $(seq 1 60); do
  if flock -n "$W/lock" -c true 2>/dev/null; then freed=yes; break; fi
  sleep 0.2
done
eq "(준비) 락이 풀렸다" "$freed" "yes"
out="$(run_block "$W/c-free" 'alert_ticker_once; printf "rc=%s\n" "$?"')"
eq "🔴 ③ 락이 풀리면 1회 호출(상한 20)" "$(cat "$W/c-free")" "call /api/cron/stop-alert max=20"

echo "C. ④ 고아 방지 · ⑦ 바쁜 루프 가드 · ⑪ 좀비 감지"
bash -c 'exit 0' & DEAD=$!; wait "$DEAD" 2>/dev/null || true
out="$(run_block "$W/c-orphan" \
  "ALERT_TICKER_PARENT_PID=$DEAD" \
  'sleep() { :; }' \
  'alert_ticker_loop; printf "exited=%s\n" "$?"')"
eq "🔴 ④ 부모가 없으면 티커가 끝난다" "$(printf '%s\n' "$out" | grep -c '^exited=0$')" "1"
eq "🔴 ④ 끝내기 전에 호출하지 않는다" "$(grep -c '^call ' "$W/c-orphan")" "0"
out="$(run_block "$W/c-fast" \
  'sleep() { :; }' \
  'alert_ticker_loop; printf "exited=%s\n" "$?"')"
eq "🔴 ⑦ 대기가 돌지 않으면 호출 0회로 티커를 끝낸다" "$(grep -c '^call ' "$W/c-fast")" "0"
eq "⑦ 끝낼 때 로그 한 줄" "$(printf '%s\n' "$out" | grep -c 'stop-alert 티커 종료')" "1"
out="$(run_block "$W/c-alive" \
  "ALERT_TICKER_PID=$DEAD" 'printf "dead=%s\n" "$(alert_ticker_alive && echo alive || echo gone)"' \
  'ALERT_TICKER_PID=""' 'printf "empty=%s\n" "$(alert_ticker_alive && echo alive || echo gone)"' \
  "ALERT_TICKER_PID=$$" 'printf "self=%s\n" "$(alert_ticker_alive && echo alive || echo gone)"')"
eq "🔴 ⑪ 끝난 pid → gone" "$(printf '%s\n' "$out" | grep -c '^dead=gone$')" "1"
eq "⑪ pid 가 비어 있으면 gone(티커를 띄우지 않은 경우)" "$(printf '%s\n' "$out" | grep -c '^empty=gone$')" "1"
eq "⑪ 살아 있는 pid → alive" "$(printf '%s\n' "$out" | grep -c '^self=alive$')" "1"

# 🔴 ⑫ 진짜 오류(락 파일을 만들 수 없는 경로) — 회차 반환 2 · 루프는 로그 1줄 남기고 끝낸다(감독이 메인 루프로 넘긴다)
out="$(ALERT_TICKER_LOCK_FILE="$W/no-such-dir/lock" CALLS="$W/c-err" BLOCKFILE="$W/block.sh" timeout 30 bash -c '
set -u
STOP_ALERT_CURL_MAX_TIME=20
CALL_MAX_TIME=""
call() { printf "call %s\n" "$1" >> "$CALLS"; }
. "$BLOCKFILE"
: > "$CALLS"
alert_ticker_once; printf "rc=%s\n" "$?"
sleep() { :; }
ALERT_TICKER_MIN_CYCLE_SEC=0
alert_ticker_loop; printf "returned=%s\n" "$?"
' 2>/dev/null)"
eq "🔴 ⑫ 진짜 오류는 반환 2" "$(printf '%s\n' "$out" | grep -c '^rc=2$')" "1"
eq "🔴 ⑫ 진짜 오류면 티커가 로그 1줄 남기고 끝낸다" \
   "$(printf '%s\n' "$out" | grep -c '티커 종료 — 락을 쓸 수 없다') $(printf '%s\n' "$out" | grep -c '^returned=0$')" "1 1"
eq "⑫ 진짜 오류에서 호출 0회" "$(grep -c '^call ' "$W/c-err" 2>/dev/null)" "0"
eq "⑫ 그 종료 로그는 경합이 아님을 밝힌다" "$(printf '%s\n' "$out" | grep -c '경합 아님')" "1"

echo "D. ⑤ 상한 격리 · ⑧ 분 경계 정렬 · 정상 회차"
out="$(run_block "$W/c-sub" '( alert_ticker_once )' 'printf "parent=%s\n" "${CALL_MAX_TIME:-empty}"')"
eq "🔴 ⑤ 자식(서브셸) 호출 뒤 부모의 CALL_MAX_TIME 은 비어 있다" "$(printf '%s\n' "$out" | grep -c '^parent=empty$')" "1"
eq "⑤ 그 호출 자체에는 상한 20 이 붙었다" "$(cat "$W/c-sub")" "call /api/cron/stop-alert max=20"
out="$(run_block "$W/c-wait" \
  'date() { printf "1762000000\n"; }' 'printf "w1=%s\n" "$(alert_ticker_wait_sec)"' \
  'date() { printf "1762000013\n"; }' 'printf "w2=%s\n" "$(alert_ticker_wait_sec)"' \
  'date() { printf "xx\n"; }'          'printf "w3=%s\n" "$(alert_ticker_wait_sec)"')"
eq "⑧ 1762000000(%60=40) → 20초 뒤 분 경계" "$(printf '%s\n' "$out" | grep -c '^w1=20$')" "1"
eq "⑧ 13초 뒤 → 7초" "$(printf '%s\n' "$out" | grep -c '^w2=7$')" "1"
eq "⑧ 시각을 읽을 수 없으면 60(기본값)" "$(printf '%s\n' "$out" | grep -c '^w3=60$')" "1"
out="$(run_block "$W/c-one" \
  'sleep() { :; }' 'ALERT_TICKER_MIN_CYCLE_SEC=0' \
  'call() { printf "call %s max=%s\n" "$1" "${CALL_MAX_TIME:-none}" >> "$CALLS"; exit 0; }' \
  'alert_ticker_loop')"
eq "🔴 정상 회차는 stop-alert 를 1회 부른다(상한 20)" "$(cat "$W/c-one")" "call /api/cron/stop-alert max=20"

echo "E. 실시간(러너 그대로 · curl 만 스텁 · 실제 sleep/date/flock) — 약 3분"
start_real legacy ALERT_TICKER_DISABLE=1
start_real failopen ALERT_TICKER_LOCK_FILE="$W/failopen/no-such-dir/stop-alert.lock"
start_real normal
sleep 80
for n in legacy failopen normal; do
  eq "(준비) $n 러너가 적어도 1틱 돌았다" "$([ "$(grep -c ' /api/cron/entry-watcher ' "$W/$n/calls")" -ge 1 ] && echo yes || echo no)" "yes"
done
eq "🔴 E1 레거시: 기동 로그가 모드를 밝힌다" "$(grep -c 'ALERT_TICKER_DISABLE=1 — 레거시 모드' "$W/legacy/out")" "1"
eq "🔴 E1 레거시: 티커를 띄우지 않는다" "$(grep -c '티커 시작' "$W/legacy/out")" "0"
eq "🔴 E1 레거시: 메인 루프가 매 틱 부른다(holding-checker 다음 = stop-alert)" \
   "$(after_hc "$W/legacy") $(sa_cnt "$W/legacy")" "$(grep -c ' /api/cron/entry-watcher ' "$W/legacy/calls") $(grep -c ' /api/cron/entry-watcher ' "$W/legacy/calls")"
eq "🔴 E2 fail-open: 락 파일을 못 만들면 그 사실과 되돌림을 로그한다" \
   "$(grep -c '티커를 띄우지 못했다' "$W/failopen/out") $(grep -c '메인 루프가 매 틱 직접 부른다' "$W/failopen/out")" "1 1"
eq "🔴 E2 fail-open: 알림이 사라지지 않는다(메인 루프가 매 틱 부른다)" \
   "$(after_hc "$W/failopen")" "$(grep -c ' /api/cron/entry-watcher ' "$W/failopen/calls")"
eq "🔴 E3 기본: 티커를 띄우고 메인 루프는 부르지 않는다" \
   "$(grep -c 'stop-alert 티커 시작' "$W/normal/out") $(after_hc "$W/normal")" "1 0"
eq "🔴 E3 기본: 티커가 분 경계(:00)에 부른다" \
   "$(awk '/ \/api\/cron\/stop-alert /{ n++; if ($1 ~ /:00$/) z++ } END{ print (n > 0 && n == z) ? "all-on-boundary" : "n=" n+0 " onboundary=" z+0 }' "$W/normal/calls")" "all-on-boundary"
eq "E3 기본: 그 호출에 상한 20 이 붙는다" \
   "$(grep ' /api/cron/stop-alert ' "$W/normal/calls" | grep -vc 'mt=20')" "0"
# 감독 인수 — 티커만 PID 로 죽이고 한 틱 더 본다
TPID="$(sed -n 's/.*stop-alert 티커 시작 — pid \([0-9]*\),.*/\1/p' "$W/normal/out" | head -1)"
eq "(준비) 기동 로그에서 티커 pid 를 읽었다" "$([ -n "$TPID" ] && echo yes || echo no)" "yes"
SA_BEFORE="$(sa_cnt "$W/normal")"; HC_BEFORE="$(after_hc "$W/normal")"
[ -n "$TPID" ] && kill -9 "$TPID" 2>/dev/null || true
sleep 75
eq "🔴 E3 감독: 티커가 사라지면 전환 로그 한 줄" "$(grep -c '가 사라졌다 — 이 틱부터 메인 루프가 직접 부른다' "$W/normal/out")" "1"
eq "🔴 E3 감독: 그 뒤 메인 루프가 부른다(holding-checker 다음 = stop-alert)" \
   "$([ "$(after_hc "$W/normal")" -gt "$HC_BEFORE" ] && echo yes || echo no)" "yes"
eq "🔴 E3 감독: 알림이 끊기지 않았다(호출 수가 늘었다)" \
   "$([ "$(sa_cnt "$W/normal")" -gt "$SA_BEFORE" ] && echo yes || echo no)" "yes"
eq "E3 감독: 전환 뒤에도 호출자는 하나(틱당 stop-alert 1회)" \
   "$(awk '/ \/api\/cron\/entry-watcher /{t++} / \/api\/cron\/stop-alert /{s++} END{ print (s <= t + 2) ? "ok" : "s=" s+0 " t=" t+0 }' "$W/normal/calls")" "ok"
for n in legacy failopen normal; do stop_real "$n"; done
fi

echo
echo "결과: PASS=$PASS FAIL=$FAIL SKIP=$SKIP"
[ "$FAIL" -eq 0 ]
