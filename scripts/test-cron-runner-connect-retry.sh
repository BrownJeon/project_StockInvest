#!/usr/bin/env bash
# T-177 — cron-runner.sh 의 웹 기동 대기(WP-1)와 연결 거부(curl 7)만 1회 재시도(WP-2) 시험.
#
# 실행: bash scripts/test-cron-runner-connect-retry.sh   (NFS noexec 경로라 반드시 bash 경유)
#
# 무엇을 보나:
#  S. 정적: bash -n · `# T-177` 표지 줄(call() 5줄 + 메인 루프 1줄)이 파일 전체에 각 1개이고 call() 줄은 모두 call() 안 ·
#     그 줄들과 connect-retry 블록을 빼면 **기준 러너(T177_BASE_REF, 기본 d17f689 = T-177 착수 기준)와 한 글자도 같다**(추가만) ·
#     call() 도 같은 방식으로 되돌리면 기준 call() 과 같다 · 재시도 조건은 「종료 코드 = 7」 하나 · 호출 자리 1곳 · 블록은 알림 티커·메인 루프 앞 ·
#     예산 채우는 줄은 메인 루프 안 첫 호출 앞 · 하트비트 쓰기는 여전히 2곳 · 상수 60·2·15
#  W. 시작 대기(web_ready_wait — 블록의 실제 함수, curl·date·sleep 만 가짜): 즉시 준비 · 몇 번 뒤 준비 · 상한 초과면 1(진행) ·
#     연결만 맺어진 무응답(000 1)·503 도 준비 · 시계가 멈추고 sleep 이 즉시 돌아와도 끝남 · 시각을 못 읽으면 즉시 1
#  R. 재시도(러너에서 잘라 낸 **실제 call()** + 블록 함수): 7→성공 / 7→7 / 52·28·56 은 재시도 없음 / 틱 예산 소진 뒤 즉시 실패 /
#     예산 차감·틱마다 채움 / 후크 1회·최종 코드 / CALL_MAX_TIME 이 두 시도 모두에 같게 / 알림 티커 자식(서브셸)은 부모 예산을 안 씀 /
#     블록 함수가 없으면(call() 만 잘라 시험) 예전 그대로
#  E. 러너 전체(가짜 curl·date·sleep · 실제 HOME 아님): 시작 대기가 티커 기동·첫 틱보다 먼저 · 상한 초과 뒤에도 메인 루프가 돈다 ·
#     첫 틱 연결 거부 → 재시도 성공이 job_run_log 스풀에 **최종 코드 200 한 줄** · 웹이 계속 죽어 있으면 한 틱 대기 ≤ 16초이고 남은 호출은 즉시 실패
# 외부 호출 없음(curl 은 셸 함수·PATH 스텁), 실제 HOME·.env 를 읽지 않음, 운영 3003 포트에 요청하지 않음(BASE_URL=http://stub).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="${T177_RUNNER:-$HERE/cron-runner.sh}"
BASE_REF="${T177_BASE_REF:-d17f689}"
REAL_DATE="$(command -v date)"
PASS=0; FAIL=0
ok()   { PASS=$((PASS + 1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
eq()   { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (기대 '$3', 실제 '$2')"; fi; }

# ── (T-177) 러너에 더한 것 — 기준 ref 와 비교할 때 빼는 도우미(표준입력 → 표준출력). 다른 러너 시험에도 같은 정의가 있다 ─────────────
T177_C1='  local t177_retried=0   # T-177 연결 거부(curl 7)일 때만 아래 curl 줄을 한 번 더 — 판단은 connect-retry 블록의 call_connect_retry_due'
T177_C2='  while :; do   # T-177 (안의 curl 줄은 한 글자도 바꾸지 않았다 — 들여쓰기도 그대로)'
T177_C3='  [ "$t177_retried" = "0" ] && call_connect_retry_due "$label" "$curl_exit" 2>/dev/null || break   # T-177 7 이 아님·이미 다시 보냄·웹 준비 안 됨 → 끝'
T177_C4='  t177_retried=1; curl_exit=0   # T-177 다시 보내기 전 종료 코드를 비운다(성공하면 0 이어야 후크가 예전과 같다)'
T177_C5='  done   # T-177'
T177_M1='  CALL_RETRY_BUDGET_LEFT="$CALL_RETRY_TICK_BUDGET_SEC"   # T-177 틱마다 연결 거부 재시도의 대기 예산을 다시 채운다(connect-retry 블록)'
no_t177_call() { grep -vxF "$T177_C1" | grep -vxF "$T177_C2" | grep -vxF "$T177_C3" | grep -vxF "$T177_C4" | grep -vxF "$T177_C5"; }
no_t177() { awk '/^# >>> connect-retry \(T-177\)/{s=1} s{ if (/^# <<< connect-retry$/) s=0; next } {print}' | no_t177_call | grep -vxF "$T177_M1"; }
t177_targets() {   # 러너 → "C1~C5·M1 파일 전체 개수 | C1~C5 call() 안 개수 | 블록 시작·끝 표지 개수" — 기대 "1 1 1 1 1 1 | 1 1 1 1 1 | 1 1"
  local cb; cb="$(awk '/^call\(\) \{/,/^\}/' "$1")"
  echo "$(grep -cxF "$T177_C1" "$1") $(grep -cxF "$T177_C2" "$1") $(grep -cxF "$T177_C3" "$1") $(grep -cxF "$T177_C4" "$1") $(grep -cxF "$T177_C5" "$1") $(grep -cxF "$T177_M1" "$1") | $(printf '%s\n' "$cb" | grep -cxF "$T177_C1") $(printf '%s\n' "$cb" | grep -cxF "$T177_C2") $(printf '%s\n' "$cb" | grep -cxF "$T177_C3") $(printf '%s\n' "$cb" | grep -cxF "$T177_C4") $(printf '%s\n' "$cb" | grep -cxF "$T177_C5") | $(grep -c '^# >>> connect-retry (T-177)' "$1") $(grep -cx '# <<< connect-retry' "$1")"
}

W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT
BEFORE="$W/runner-before.sh"
if ! git -C "$HERE/.." show "$BASE_REF:scripts/cron-runner.sh" > "$BEFORE" 2>/dev/null || [ ! -s "$BEFORE" ]; then
  echo "기준 러너($BASE_REF:scripts/cron-runner.sh)를 읽지 못함 — 비교 시험을 할 수 없다(T177_BASE_REF 로 지정 가능)"
  exit 1
fi

# ── S. 정적 ──────────────────────────────────────────────────────────────────
echo "S. 정적"
if bash -n "$RUNNER" 2>"$W/bashn"; then ok "S: bash -n 통과"; else bad "S: bash -n 실패: $(head -2 "$W/bashn")"; fi
eq "🔴 S: T-177 표지 줄 = 파일 전체 각 1개 · call() 줄은 모두 call() 안 · 블록 표지 1쌍" "$(t177_targets "$RUNNER")" "1 1 1 1 1 1 | 1 1 1 1 1 | 1 1"
eq "(도우미 확인) 기준 러너에는 T-177 표지 줄·블록이 없다" "$(t177_targets "$BEFORE")" "0 0 0 0 0 0 | 0 0 0 0 0 | 0 0"
if diff <(no_t177 < "$RUNNER") "$BEFORE" > "$W/d-all"; then ok "🔴 S: 블록과 표지 줄 6개를 빼면 기준 러너($BASE_REF)와 한 글자도 같다 — 추가만 했다($(wc -l < "$BEFORE" | tr -d ' ')줄)"
else bad "S: 추가분 밖이 바뀌었다"; head -10 "$W/d-all"; fi
eq "🔴 S: call() 에서 표지 줄 5개를 빼면 기준 call() 과 같다(curl 줄·로그·후크·rm 불변)" \
   "$(awk '/^call\(\) \{/,/^\}/' "$RUNNER" | no_t177_call | sha256sum)" "$(awk '/^call\(\) \{/,/^\}/' "$BEFORE" | sha256sum)"
eq "(도우미 확인) 기준 러너에 no_t177 을 걸어도 그대로" "$(no_t177 < "$BEFORE" | sha256sum)" "$(sha256sum < "$BEFORE")"
CRB="$(awk '/^# >>> connect-retry \(T-177\)/{f=1} f{print} /^# <<< connect-retry$/{f=0}' "$RUNNER")"
DUE="$(awk '/^call_connect_retry_due\(\) \{/,/^\}/' "$RUNNER")"
eq "🔴 S: 재시도 판정의 첫 관문은 「종료 코드 = 7」 하나다(52·28·56 은 여기서 끝난다)" \
   "$(printf '%s\n' "$DUE" | grep -v '^[[:space:]]*#' | grep -c '^  \[ "\$ce" = "7" \] || return 1$') $(printf '%s\n' "$DUE" | grep -v '^[[:space:]]*#' | grep -cE '"(52|28|56)"')" "1 0"
eq "S: 판정 함수를 부르는 곳은 call() 안 1곳뿐" \
   "$(grep -v '^[[:space:]]*#' "$RUNNER" | grep -c 'call_connect_retry_due "') $(awk '/^call\(\) \{/,/^\}/' "$RUNNER" | grep -c 'call_connect_retry_due "')" "1 1"
eq "🔴 S: 블록은 알림 티커 블록·메인 루프보다 앞이다(시작 대기가 티커 기동 전)" \
   "$(awk '/^# <<< connect-retry$/{a=NR} /^# >>> alert-ticker/{b=NR} /^while true; do/{c=NR} END{print (a>0 && b>a && c>b) ? "yes" : "no"}' "$RUNNER")" "yes"
eq "S: 시작 대기 호출은 블록 안 1곳(상한 상수로)" \
   "$(printf '%s\n' "$CRB" | grep -c '^if web_ready_wait "\$WEB_READY_STARTUP_MAX_SEC"; then$') $(grep -v '^[[:space:]]*#' "$RUNNER" | grep -c 'web_ready_wait "\$WEB_READY_STARTUP_MAX_SEC"')" "1 1"
eq "🔴 S: 예산 채우는 줄은 메인 루프 안, 첫 call 앞" \
   "$(awk -v m="$T177_M1" '/^while true; do/{w=NR} $0==m{r=NR} /^  call \/api\/cron\/entry-watcher /{c=NR} END{print (w>0 && r>w && c>r) ? "yes" : "no"}' "$RUNNER")" "yes"
eq "🔴 S: 하트비트 쓰기는 여전히 2곳 — 블록은 하트비트를 쓰지 않는다" \
   "$(grep -c 'mv -f "\${CRON_HEARTBEAT_FILE}.tmp"' "$RUNNER") $(printf '%s\n' "$CRB" | grep -v '^[[:space:]]*#' | grep -c 'CRON_HEARTBEAT_FILE')" "2 0"
eq "S: 상수 — 시작 상한 60 · probe 상한 2 · 틱 예산 15" \
   "$(grep -cx 'WEB_READY_STARTUP_MAX_SEC=60' "$RUNNER") $(grep -cx 'WEB_READY_PROBE_MAX_TIME=2' "$RUNNER") $(grep -cx 'CALL_RETRY_TICK_BUDGET_SEC=15' "$RUNNER")" "1 1 1"
eq "S: probe 는 -s -o --max-time -w 만 쓴다(기존 하네스 스텁이 해석하는 인자)" \
   "$(printf '%s\n' "$CRB" | grep -v '^[[:space:]]*#' | grep -c "curl -s -o /dev/null --max-time \"\$mt\" -w '%{http_code} %{num_connects}' \"\$BASE_URL/api/health\"")" "1"
eq "S: 블록에 비밀(CRON_SECRET·x-cron-secret)·POST 가 없다(health 는 무인증 GET)" \
   "$(printf '%s\n' "$CRB" | grep -v '^[[:space:]]*#' | grep -ciE 'cron_secret|x-cron-secret|-X POST')" "0"

# ── 동작 시험 공통 ────────────────────────────────────────────────────────────
# 블록의 함수부(시작 대기 호출 앞까지)와 실제 call() 을 잘라 source 한다. curl·date·sleep 과 call() 이 부르는 다른 블록 함수는 가짜.
awk '/^# >>> connect-retry \(T-177\)/{f=1} /^# ① 시작 대기/{f=0} f{print}' "$RUNNER" > "$W/funcs.sh"
awk '/^call\(\) \{/,/^\}/' "$RUNNER" > "$W/call.sh"
[ -s "$W/funcs.sh" ] && [ -s "$W/call.sh" ] || { echo "블록 함수부·call() 을 찾지 못함"; exit 1; }
cat > "$W/prelude.sh" <<'SH'
set -u
# 가짜 시계: $D/clock(epoch 초). date +%s 만 가짜, 다른 형식은 진짜 date 로 그 시각을 찍는다. sleep N 은 시계를 N 초 민다.
date() { if [ "${1:-}" = "+%s" ]; then if [ -e "$D/date-broken" ]; then echo xx; else cat "$D/clock"; fi; else "$REAL_DATE" -d "@$(cat "$D/clock")" "$@"; fi; }
sleep() { echo "sleep $1" >> "$D/log"; [ -e "$D/sleep-noop" ] || echo $(( $(cat "$D/clock") + ${1%%.*} )) > "$D/clock"; }
# 가짜 curl: health 는 $D/hresp, 잡 POST 는 $D/presp 를 한 줄씩 차례로 쓴다(다 쓰면 마지막 줄 반복).
#   health 줄 = "<종료코드> <http_code> <num_connects> [<흐르는 초>]" · POST 줄 = "<종료코드> <http_code> [<흐르는 초>]"
#   기록($D/log): "health mt=<상한>" / "post <경로> mt=<상한|none>"
_next() { local n; n=$(( $(cat "$D/$1.n" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$D/$1.n"; sed -n "${n}p" "$D/$1"; }
curl() {
  local out="" url="" mt="" line="" rc=0 hc="" nc="" adv=""
  while [ $# -gt 0 ]; do
    case "$1" in
      -o) out="$2"; shift 2 ;;
      --max-time) mt="$2"; shift 2 ;;
      -w|-X|-H|-d) shift 2 ;;
      -s) shift ;;
      *) url="$1"; shift ;;
    esac
  done
  case "$url" in
    */api/health)
      echo "health mt=${mt:-none}" >> "$D/log"
      line="$(_next hresp)"; [ -n "$line" ] || line="$(tail -n 1 "$D/hresp")"
      read -r rc hc nc adv <<< "$line"
      [ -n "${adv:-}" ] && [ -n "$mt" ] && [ "$adv" -gt "$mt" ] && adv="$mt"   # 실제 curl 처럼 상한을 지킨다
      [ -n "${adv:-}" ] && echo $(( $(cat "$D/clock") + adv )) > "$D/clock"
      printf '%s %s' "$hc" "$nc"; return "$rc" ;;
    *)
      echo "post ${url#http://stub} mt=${mt:-none}" >> "$D/log"
      line="$(_next presp)"; [ -n "$line" ] || line="$(tail -n 1 "$D/presp")"
      read -r rc hc adv <<< "$line"
      [ -n "${adv:-}" ] && echo $(( $(cat "$D/clock") + adv )) > "$D/clock"
      [ -n "$out" ] && [ "$rc" = "0" ] && printf '{"ok":true}' > "$out"
      printf '%s' "$hc"; return "$rc" ;;
  esac
}
# call() 이 부르는 다른 블록의 함수 — 가짜(이 시험의 대상이 아니다. 실제 후크·본문 파일은 E 절이 러너 전체로 본다)
call_tmp_open() { CALL_BODY_FILE="$D/body"; : > "$CALL_BODY_FILE"; }
jrl_now_ms() { echo 1000; }
jrl_mask_money() { cat; }
jrl_hook() { printf 'hook %s %s %s %s\n' "$1" "$2" "$3" "${5:-}" >> "$D/hooks"; }
CRON_SECRET=synthetic-secret; BASE_URL=http://stub; CALL_MAX_TIME=""
SH

# run_case NAME HRESP PRESP SCRIPT… — 새 bash 에서 prelude + 블록 함수 + call() 을 source 한 뒤 SCRIPT 줄들을 돌린다.
#   결과 $W/NAME/: out(표준출력+오류) · log(가짜 curl·sleep 기록) · hooks · clock
run_case() {
  local name="$1" h="$2" p="$3"; shift 3
  local D="$W/$name"; mkdir -p "$D"
  printf '%s\n' "$h" | tr ';' '\n' > "$D/hresp"
  printf '%s\n' "$p" | tr ';' '\n' > "$D/presp"
  echo 1000000000 > "$D/clock"; : > "$D/log"; : > "$D/hooks"
  {
    echo '. "$PRELUDE"'; echo '. "$FUNCS"'; echo '. "$CALLF"'
    printf '%s\n' "$@"
  } > "$D/t.sh"
  D="$D" REAL_DATE="$REAL_DATE" PRELUDE="$W/prelude.sh" FUNCS="$W/funcs.sh" CALLF="$W/call.sh" \
    timeout 60 bash "$D/t.sh" > "$D/out" 2>&1
  echo "$D"
}
cnt()   { grep -c "$2" "$1/log" 2>/dev/null || true; }
posts() { grep -c '^post ' "$1/log" 2>/dev/null || true; }
hps()   { grep -c '^health ' "$1/log" 2>/dev/null || true; }
el()    { echo $(( $(cat "$1/clock") - 1000000000 )); }
var()   { sed -n "s/^$2=//p" "$1/out" | tail -n 1; }

# ── W. 시작 대기 — web_ready_wait ─────────────────────────────────────────────
echo "W. 시작 대기(web_ready_wait)"
D="$(run_case w-now '0 200 1' '0 200' 'web_ready_wait "$WEB_READY_STARTUP_MAX_SEC"; echo "rc=$?"; echo "waited=$WEB_READY_WAITED"')"
eq "🔴 W1: 즉시 준비 → 0 · 0초 · probe 1번 · sleep 없음" "$(var "$D" rc) $(var "$D" waited) $(hps "$D") $(cnt "$D" '^sleep ')" "0 0 1 0"
eq "W1: probe 상한은 2초" "$(grep -m1 '^health ' "$D/log")" "health mt=2"
D="$(run_case w-later '7 000 0;7 000 0;7 000 0;0 200 1' '0 200' 'web_ready_wait "$WEB_READY_STARTUP_MAX_SEC"; echo "rc=$?"; echo "waited=$WEB_READY_WAITED"')"
eq "🔴 W2: 거부 3번 뒤 준비 → 0 · 3초 · probe 4번" "$(var "$D" rc) $(var "$D" waited) $(hps "$D")" "0 3 4"
D="$(run_case w-never '7 000 0' '0 200' 'web_ready_wait "$WEB_READY_STARTUP_MAX_SEC"; echo "rc=$?"; echo "waited=$WEB_READY_WAITED"')"
eq "🔴 W3: 상한(60초)까지 안 되면 1 · 경과 60초 · probe 60번(초마다 1번)" "$(var "$D" rc) $(var "$D" waited) $(el "$D") $(hps "$D")" "1 60 60 60"
D="$(run_case w-hang '28 000 1 2' '0 200' 'web_ready_wait "$WEB_READY_STARTUP_MAX_SEC"; echo "rc=$?"; echo "waited=$WEB_READY_WAITED"')"
eq "🔴 W4: 연결은 맺어졌는데 응답이 없다(28 · 000 1 — 부팅 설정 대기) → 준비됨" "$(var "$D" rc) $(var "$D" waited) $(hps "$D")" "0 2 1"
D="$(run_case w-503 '0 503 1' '0 200' 'web_ready_wait 60; echo "rc=$?"')"
eq "W5: 503 도 준비(응답 코드는 보지 않는다)" "$(var "$D" rc)" "0"
D="$(run_case w-000-0 '28 000 0 2' '0 200' 'web_ready_wait 5; echo "rc=$?"; echo "waited=$WEB_READY_WAITED"')"
eq "W5: 연결도 못 맺은 시간 초과(28 · 000 0)는 준비 아님 → 상한 5초에 1" "$(var "$D" rc) $(var "$D" waited)" "1 5"
D="$(run_case w-short '28 000 0 2' '0 200' 'web_ready_wait 4; echo "rc=$?"; echo "waited=$WEB_READY_WAITED"')"
eq "W5: probe 상한은 남은 시간을 넘지 않는다(남은 4초 → 2 · 남은 1초 → 1) · 상한에 닿으면 sleep 없이 끝(4초)" \
   "$(grep '^health ' "$D/log" | tr '\n' ' ')$(var "$D" waited) $(cnt "$D" '^sleep ')" "health mt=2 health mt=1 4 1"
D="$(run_case w-frozen '7 000 0' '0 200' 'touch "$D/sleep-noop"' 'web_ready_wait 60; echo "rc=$?"')"
eq "🔴 W6: 시계가 멈추고 sleep 이 즉시 돌아와도 끝난다(1 · probe ≤ 61)" "$(var "$D" rc) $([ "$(hps "$D")" -le 61 ] && echo bounded || echo "probes=$(hps "$D")")" "1 bounded"
D="$(run_case w-nodate '0 200 1' '0 200' 'touch "$D/date-broken"' 'web_ready_wait 60; echo "rc=$?"')"
eq "W7: 시각을 못 읽으면 기다리지 않고 1(probe 0)" "$(var "$D" rc) $(hps "$D")" "1 0"
D="$(run_case w-bad '0 200 1' '0 200' 'web_ready_wait ""; echo "rc=$?"' 'web_ready_wait 0; echo "rc0=$?"')"
eq "W7: 상한이 숫자가 아니거나 0 이면 1(probe 0)" "$(var "$D" rc) $(var "$D" rc0) $(hps "$D")" "1 1 0"

# ── R. 재시도 — 실제 call() ──────────────────────────────────────────────────
echo "R. 연결 거부만 1회 재시도(실제 call())"
D="$(run_case r-7ok '0 200 1' '7 000;0 200' 'call /api/cron/holding-checker holding-checker' 'echo "last=$CALL_LAST_CODE"' 'echo "left=$CALL_RETRY_BUDGET_LEFT"')"
eq "🔴 R1: 7 → 웹 확인 → 재시도 성공: POST 2번 · probe 1번" "$(posts "$D") $(hps "$D")" "2 1"
eq "🔴 R1: 기록은 최종 결과 1회 — 후크 1줄(200 · curl_exit 0) · CALL_LAST_CODE=200 · OK 로그 1줄" \
   "$(cat "$D/hooks") | $(var "$D" last) | $(grep -c 'holding-checker OK$' "$D/out")" "hook holding-checker /api/cron/holding-checker 200 0 | 200 | 1"
eq "R1: 재시도 사실은 로그 한 줄 · 실패 로그(HTTP=)는 없다" "$(grep -c 'holding-checker 연결 거부(curl=7) — 웹 응답 확인(0초 대기) 뒤 1회 재시도' "$D/out") $(grep -c 'HTTP=' "$D/out")" "1 0"
eq "R1: 즉시 준비면 예산이 그대로(15)" "$(var "$D" left)" "15"
D="$(run_case r-77 '0 200 1' '7 000' 'call /api/cron/strategy-eval strategy-eval' 'echo "last=$CALL_LAST_CODE"')"
eq "🔴 R2: 7 → 재시도도 7 → 한 번만 다시 보낸다(POST 2번)" "$(posts "$D")" "2"
eq "🔴 R2: 후크 1줄(000 · curl_exit 7) · CALL_LAST_CODE=000 · HTTP=000 로그 1줄" \
   "$(cat "$D/hooks") | $(var "$D" last) | $(grep -c 'strategy-eval HTTP=000 body=' "$D/out")" "hook strategy-eval /api/cron/strategy-eval 000 7 | 000 | 1"
for ce in 52 28 56; do
  D="$(run_case "r-$ce" '0 200 1' "$ce 000;0 200" 'call /api/cron/entry-watcher entry-watcher' 'echo "last=$CALL_LAST_CODE"')"
  eq "🔴 R3: curl=$ce(서버에 닿았을 수 있음)은 재시도하지 않는다 — POST 1번 · probe 0 · 재시도 로그 0" \
     "$(posts "$D") $(hps "$D") $(grep -c '연결 거부' "$D/out")" "1 0 0"
  eq "R3: curl=$ce — 후크 1줄(000 · curl_exit $ce) · CALL_LAST_CODE=000" "$(cat "$D/hooks") | $(var "$D" last)" "hook entry-watcher /api/cron/entry-watcher 000 $ce | 000"
done
D="$(run_case r-200 '0 200 1' '0 200' 'call /api/cron/entry-watcher entry-watcher')"
eq "R3: 첫 시도 성공이면 예전 그대로(POST 1 · probe 0 · 후크 200 0)" "$(posts "$D") $(hps "$D") | $(cat "$D/hooks")" "1 0 | hook entry-watcher /api/cron/entry-watcher 200 0"
D="$(run_case r-7-503 '0 200 1' '7 000;0 503' 'call /api/cron/signal-expiry signal-expiry' 'echo "last=$CALL_LAST_CODE"')"
eq "R3: 재시도 결과가 503 이면 그 503 이 최종(재시도는 한 번뿐)" "$(posts "$D") $(var "$D" last) $(grep -c 'signal-expiry HTTP=503' "$D/out")" "2 503 1"
# 틱 예산 소진: 웹이 끝내 응답하지 않으면 첫 호출이 예산(15초)을 다 쓰고, 같은 틱의 다음 호출은 기다리지 않고 바로 실패한다.
D="$(run_case r-budget '7 000 0' '7 000' \
  'call /api/cron/strategy-eval strategy-eval' 'echo "t1=$(( $(cat "$D/clock") - 1000000000 ))"' 'echo "left=$CALL_RETRY_BUDGET_LEFT"' \
  'call /api/cron/signal-followup signal-followup' 'echo "t2=$(( $(cat "$D/clock") - 1000000000 ))"' \
  'call /api/cron/trade-report trade-report' 'echo "t3=$(( $(cat "$D/clock") - 1000000000 ))"')"
eq "🔴 R4: 준비 안 됨 → 첫 호출이 예산 15초를 쓰고 재시도하지 않는다(POST 1 · 대기 15초 · 예산 0)" \
   "$(grep -c '^post /api/cron/strategy-eval' "$D/log") $(var "$D" t1) $(var "$D" left)" "1 15 0"
eq "🔴 R4: 예산을 다 쓴 틱의 다음 호출은 기다리지 않고 즉시 실패(시계 그대로 · 각 POST 1번)" \
   "$(var "$D" t2) $(var "$D" t3) $(grep -c '^post /api/cron/signal-followup' "$D/log") $(grep -c '^post /api/cron/trade-report' "$D/log")" "15 15 1 1"
eq "R4: probe 는 첫 호출의 대기에서만(15번) · 「응답하지 않아」 로그는 한 줄 · 후크는 호출마다 1줄(000 7)" \
   "$(hps "$D") $(grep -c '응답하지 않아 재시도하지 않음' "$D/out") $(grep -c ' 000 7$' "$D/hooks") $(wc -l < "$D/hooks" | tr -d ' ')" "15 1 3 3"
eq "R4: 세 호출 모두 HTTP=000 로그(예전과 같은 실패 기록)" "$(grep -c 'HTTP=000 body=' "$D/out")" "3"
# 예산 차감 · 틱마다 채움 — 러너의 메인 루프 줄(M1)을 그대로 eval 한다
D="$(run_case r-refill '7 000 0;7 000 0;7 000 0;7 000 0;0 200 1' '7 000;0 200' \
  'call /api/cron/holding-checker holding-checker' 'echo "left1=$CALL_RETRY_BUDGET_LEFT"' \
  'CALL_RETRY_BUDGET_LEFT=0' "$T177_M1" 'echo "left2=$CALL_RETRY_BUDGET_LEFT"')"
eq "🔴 R5: 4초 뒤 준비 → 재시도 성공 · 예산 15 → 11" "$(posts "$D") $(var "$D" left1) $(grep -c 'holding-checker OK$' "$D/out")" "2 11 1"
eq "🔴 R5: 메인 루프의 채움 줄이 예산을 다시 15 로" "$(var "$D" left2)" "15"
D="$(run_case r-maxtime '0 200 1' '7 000;0 200' 'CALL_MAX_TIME=120' 'call "/api/cron/post-market-analysis?market=overseas" post-market-overseas' 'echo "last=$CALL_LAST_CODE"')"
eq "🔴 R6: CALL_MAX_TIME 은 두 시도 모두에 같게(--max-time 120) · 최종 코드 200" \
   "$(grep '^post ' "$D/log" | tr '\n' ' ')| $(var "$D" last)" "post /api/cron/post-market-analysis?market=overseas mt=120 post /api/cron/post-market-analysis?market=overseas mt=120 | 200"
# 알림 티커 자식 — 서브셸(BASHPID ≠ $$)은 부모 예산이 0 이어도 호출마다 전체 예산을 쓰고, 부모 예산을 바꾸지 않는다
D="$(run_case r-sub '7 000 0;7 000 0;0 200 1' '7 000;0 200' \
  'CALL_RETRY_BUDGET_LEFT=0' '( CALL_MAX_TIME=20; call /api/cron/stop-alert stop-alert )' 'echo "parent_left=$CALL_RETRY_BUDGET_LEFT"')"
eq "🔴 R7: 티커 자식(서브셸)은 부모 예산 0 과 무관하게 기다려 재시도 · 부모 예산은 그대로 0" \
   "$(posts "$D") $(grep -c 'stop-alert OK$' "$D/out") $(var "$D" parent_left)" "2 1 0"
eq "R7: 그 두 시도 모두 상한 20(T-068 · 티커 블록)" "$(grep '^post ' "$D/log" | grep -c 'mt=20$')" "2"
D="$(run_case r-sub-budget '7 000 0' '7 000' '( call /api/cron/stop-alert stop-alert; echo "t=$(( $(cat "$D/clock") - 1000000000 ))" )')"
eq "🔴 R7: 자식 회차 최악 대기 = 예산 15초(회차 1분 안 — 블록 주석 계산)" "$(var "$D" t) $(posts "$D")" "15 1"
# 블록 함수 없이 call() 만 잘라 쓰는 기존 시험(예: m40-forward 의 real call()) — 7 이어도 예전 그대로, 오류 출력 없음
D="$(run_case r-nofunc '0 200 1' '7 000;0 200' 'unset -f call_connect_retry_due' 'call /api/cron/holding-checker holding-checker' 'echo "last=$CALL_LAST_CODE"')"
eq "R8: 판정 함수가 없으면 재시도 없음(POST 1) · 최종 000 · 오류 출력 없음" \
   "$(posts "$D") $(var "$D" last) $(grep -c 'command not found' "$D/out")" "1 000 0"

# ── E. 러너 전체 ─────────────────────────────────────────────────────────────
echo "E. 러너 전체(가짜 curl·date·sleep)"
# run_runner NAME HEALTH_MODE POST_MODE TICKS — 러너를 그대로 돌린다(다른 러너 시험과 같은 하네스 방식). sleep 60 = 한 틱으로 세고 TICKS 틱 뒤 끝낸다.
#   HEALTH_MODE: ok | late3(거부 3번 뒤 준비) | never · POST_MODE: ok | first7(첫 holding-checker 만 7) | down(모든 POST 7)
#   알림 티커는 락 파일을 없는 디렉터리로 줘 띄우지 않는다(fail-open — 메인 루프가 부른다). 시작 대기 → 티커 기동 로그 순서는 그래도 남는다.
run_runner() {
  local name="$1" hm="$2" pm="$3" ticks="$4" R="$W/$1"
  mkdir -p "$R/bin" "$R/home" "$R/proj"
  printf 'CRON_SECRET=test-secret\n' > "$R/proj/.env"
  TZ=Asia/Seoul "$REAL_DATE" -d '2026-11-19 08:39:14' +%s > "$R/clock"
  cat > "$R/bin/date" <<EOF
#!/usr/bin/env bash
exec "$REAL_DATE" -d "@\$(cat "$R/clock")" "\$@"
EOF
  cat > "$R/bin/sleep" <<EOF
#!/usr/bin/env bash
c=\$(( \$(cat "$R/clock") + \${1%%[!0-9]*} )); echo \$c > "$R/clock"
echo "sleep \$1 at \$c" >> "$R/sleeps"
if [ "\$1" = "60" ]; then
  cat "$R/home/.node-local/stockinvest/cron-heartbeat" >> "$R/heartbeats" 2>/dev/null
  n=\$(( \$(cat "$R/ticks" 2>/dev/null || echo 0) + 1 )); echo \$n > "$R/ticks"
  if [ \$n -ge $ticks ]; then kill -TERM \$PPID; fi
fi
exit 0
EOF
  cat > "$R/bin/curl" <<EOF
#!/usr/bin/env bash
out=""; url=""; data=""
while [ \$# -gt 0 ]; do
  case "\$1" in
    -o) out="\$2"; shift 2 ;;
    --data-binary) data="\$2"; shift 2 ;;
    --max-time|-w|-X|-H|-d) shift 2 ;;
    -s) shift ;;
    *) url="\$1"; shift ;;
  esac
done
path="\${url#http://stub}"
t=\$(cat "$R/clock")
# 기록 전송(job-run-log, call() 밖)은 받은 줄을 $R/received 에 모으고 200 — 호출 목록에는 넣지 않는다
[ "\$path" = "/api/cron/job-run-log" ] && { cat "\${data#@}" >> "$R/received" 2>/dev/null; printf '200'; exit 0; }
echo "\$t \$path" >> "$R/calls"
if [ "\$path" = "/api/health" ]; then
  n=\$(( \$(cat "$R/hn" 2>/dev/null || echo 0) + 1 )); echo \$n > "$R/hn"
  case "$hm" in
    ok) printf '200 1'; exit 0 ;;
    late3) if [ \$n -le 3 ]; then printf '000 0'; exit 7; fi; printf '200 1'; exit 0 ;;
    never) printf '000 0'; exit 7 ;;
  esac
fi
case "$pm" in
  first7) if [ "\$path" = "/api/cron/holding-checker" ] && [ ! -e "$R/f7" ]; then touch "$R/f7"; printf '000'; exit 7; fi ;;
  down) printf '000'; exit 7 ;;
esac
[ -n "\$out" ] && echo '{"ok":true}' > "\$out"
printf '200'
EOF
  chmod +x "$R/bin/date" "$R/bin/sleep" "$R/bin/curl"
  : > "$R/calls"
  env PATH="$R/bin:$PATH" HOME="$R/home" PROJECT_DIR="$R/proj" BASE_URL="http://stub" TZ=Asia/Seoul \
    ALERT_TICKER_LOCK_FILE="$R/no-such-dir/stop-alert.lock" timeout 120 bash "$RUNNER" > "$R/stdout" 2>&1
  echo "$R"
}
line_of() { grep -n -m1 "$2" "$1/stdout" | cut -d: -f1; }
spool() { cat "$1/received" "$1/home/.node-local/stockinvest/job-run-spool" "$1/home/.node-local/stockinvest/job-run-spool.sending" 2>/dev/null; }   # 보낸 줄 + 아직 안 보낸 줄

R="$(run_runner e-late late3 ok 2)"
eq "(준비) e-late: 2틱 완주" "$(cat "$R/ticks" 2>/dev/null)" "2"
eq "🔴 E1: 시작 대기 로그(3초) 한 줄" "$(grep -c '^\[cron-runner\] 웹 응답 확인 — 3초 대기(http://stub/api/health)$' "$R/stdout")" "1"
eq "🔴 E1: 시작 대기 → 티커 기동 로그 → 첫 잡 호출 순서" \
   "$([ "$(line_of "$R" '웹 응답 확인')" -lt "$(line_of "$R" '티커를 띄우지 못했다')" ] && [ "$(line_of "$R" '티커를 띄우지 못했다')" -lt "$(line_of "$R" 'entry-watcher OK')" ] && echo yes || echo no)" "yes"
eq "E1: health probe 는 시작 대기에서만(4번) — 정상 틱에는 probe 없음" "$(grep -c ' /api/health$' "$R/calls")" "4"
eq "E1: 첫 POST 는 probe 성공 뒤(시작 + 3초)" \
   "$(awk '$2 != "/api/health" {print $1 - s; exit} NR==1{s=$1}' "$R/calls")" "3"
R="$(run_runner e-never never ok 1)"
eq "(준비) e-never: 1틱 완주(상한 뒤에도 메인 루프가 돈다)" "$(cat "$R/ticks" 2>/dev/null)" "1"
eq "🔴 E2: 상한 초과 로그 한 줄 · 그 뒤 첫 틱 잡이 돈다" \
   "$(grep -c '🔶 웹이 60초 안에 응답하지 않음 — 기다리지 않고 진행' "$R/stdout") $(grep -c 'entry-watcher OK' "$R/stdout")" "1 1"
eq "🔴 E2: 시작 대기는 60초에서 멈춘다(첫 POST = 시작 + 60초)" \
   "$(awk '$2 != "/api/health" {print $1 - s; exit} NR==1{s=$1}' "$R/calls")" "60"
R="$(run_runner e-first7 ok first7 1)"
eq "🔴 E3: 첫 틱 holding-checker 연결 거부 → 재시도 성공 로그 · OK · HTTP=000 없음" \
   "$(grep -c 'holding-checker 연결 거부(curl=7) — 웹 응답 확인(0초 대기) 뒤 1회 재시도' "$R/stdout") $(grep -c 'holding-checker OK$' "$R/stdout") $(grep -c 'HTTP=000' "$R/stdout")" "1 1 0"
eq "🔴 E3: job_run_log 스풀에 holding-checker 는 최종 코드 200 한 줄" \
   "$(spool "$R" | awk -F'\t' '$2 == "holding-checker" {print $4}' | tr '\n' ' ')" "200 "
eq "E3: holding-checker POST 2번(첫 시도 + 재시도) · 다른 잡은 1번씩" \
   "$(grep -c ' /api/cron/holding-checker$' "$R/calls") $(grep -c ' /api/cron/entry-watcher$' "$R/calls") $(grep -c ' /api/cron/strategy-eval$' "$R/calls")" "2 1 1"
R="$(run_runner e-down ok down 2)"
# 시작 대기는 ok(포트가 열렸다가) — 그 뒤 모든 POST 가 7. health 는 ok 라 매 호출이 재시도된다 → 이 모드는 「웹이 응답은 하는데 잡 포트만 거부」 같은
#   비현실적 조합이라 대신 health 도 never 인 경우를 본다(아래). 여기서는 재시도가 호출마다 1번으로 묶이는지만 본다.
eq "E4: 매 호출 재시도는 1번뿐(호출당 POST 2번 · entry-watcher 2틱 = 4)" "$(grep -c ' /api/cron/entry-watcher$' "$R/calls")" "4"
R="$(run_runner e-dead never down 3)"
eq "(준비) e-dead: 3틱 완주" "$(cat "$R/ticks" 2>/dev/null)" "3"
eq "🔴 E5: 웹이 계속 죽어 있으면 틱마다 「응답하지 않아」 로그 한 줄(예산 소진 → 남은 호출은 즉시 실패)" \
   "$(grep -c '응답하지 않아 재시도하지 않음' "$R/stdout")" "3"
eq "🔴 E5: 각 잡 POST 는 틱마다 1번(재시도 없음 — 2번째 틱 entry-watcher 1번)" "$(grep -c ' /api/cron/entry-watcher$' "$R/calls")" "3"
# 틱 길이 = 그 틱의 sleep 60 직전 시각 − 틱 시작(하트비트 기록). 대기 15초 + sleep 1 오차 이내여야 한다.
eq "🔴 E5: 한 틱에 더해지는 대기 ≤ 16초(예산 15 + 1) — 하트비트 간격 ≤ 76초" \
   "$(awk 'NR>1{d=$1-p; if (d>m) m=d} {p=$1} END{print (m > 0 && m <= 76) ? "ok" : "max=" m}' "$R/heartbeats")" "ok"

echo
echo "결과: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
