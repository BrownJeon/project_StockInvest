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
#      · (T-127) umask 077 은 블록 안 두 곳(jrl_hook·jrl_flush)뿐·서브셸 없음 · 마스킹 라벨은 portfolio-snapshot·trade-report 둘뿐 · 금액 키 5개
#  J9. (T-127 ①) 금액 값 마스킹 — 러너를 그대로 돌려 받은 줄을 푼다: 두 라벨만 금액 키 0·detail "" · 나머지 키·값·구조·skipped 신호 그대로(파이썬으로
#      원문에 같은 치환을 한 것과 JSON 동일) · 다른 라벨(strategy-eval)은 같은 키가 있어도 그대로 · 2KB 에서 숫자·detail 이 잘려도 원래 숫자·글자가
#      남지 않음 · 문자열 안의 키 글자는 그대로 · sed 가 실패하면 본문 칸이 빈다(원문이 새지 않음) + 마스킹 함수 단독 표 시험(소수·음수·지수·공백·중첩)
#  J10. (T-127 ②) umask 022 에서 스풀·.batch·.sending·.resp 는 600 · 잡 호출(curl)은 매번 러너 원래 umask(0022)를 본다 = 후크·전송이 모든 경로
#      (정상·앱 다운·스풀 못 씀·무거운 틱 150초 규칙)에서 umask 를 되돌린다 · 하트비트·날짜파일 권한 = 기준 러너(644)
#  J11. (T-127 ⑤) 전송 실패 줄의 사유: 라우트 503 본문(사유가 100자 뒤) → `HTTP=503 reason=timeout` · 401 → `error=unauthorized` ·
#      개행·ESC·대문자·긴 낱말·HTML 은 덧붙이지 않음(줄 1개, 주입 없음) · 000 은 예전 줄 그대로 · 응답 파일이 남지 않음
#  J12. (T-135) call() 의 응답 본문 임시 파일(call-body-tmp 블록): umask 022 로 시작해도 생성 시점부터 600 · 0700 전용 디렉터리 · 무작위 이름 ·
#      잡 curl 은 umask 0022 그대로 · 정상·비정상 응답 뒤 잔존 0 · 비-200 로그 body= 는 금액 마스킹 뒤 앞 200바이트(모든 라벨, 금액 키가 없으면 예전 그대로) ·
#      스풀 본문은 예전 라벨 규칙 그대로 · mktemp 실패 → 예전 이름 /tmp/cron-runner-<pid>.out 을 600 으로(호출·stdout = 기준 러너) ·
#      호출 도중 SIGKILL ×3 → 잔존은 늘 1개(다음 시작이 지움, 누적 없음) · 시작 정리는 죽은 pid 파일만(살아 있는 pid·다른 이름은 둔다)
#  J13. (T-135) 정적: 블록 표지·위치 · `# T-135` 표지 1줄 · call() 의 경로 줄 3개·마스킹 로그 줄·마지막 줄 rm · 예전 고정 경로는 대체 경로 1곳뿐 ·
#      jrl_hook 이 CALL_BODY_FILE 을 읽음 · trap 없음 · T-135 를 되돌리면(no_t135) call() = 기준 러너
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
#    | resp(T-127 — 코드 STUB_JCODE, 응답 본문 STUB_JRESP_FILE 을 -o 파일에 씀)
#  MODE money(T-127): portfolio-snapshot·trade-report·strategy-eval 은 $W/body-ps·body-tr·body-se 본문(있을 때)
#  ENV STUB_PERMS=1(T-127): 호출마다 umask·스풀 권한, 전송마다 .batch·.resp 권한, 틱 끝마다 상태 디렉터리 권한을 기록(다른 시험의 시간을 늘리지 않게 켤 때만)
#  ENV STUB_CALLTMP=1(T-135): 잡 호출마다 -o 본문 파일의 권한·디렉터리 권한·그 디렉터리 파일 수·경로(outperm, 스텁이 쓰기 **전** = 생성 시점), 틱 끝마다
#    call-tmp 파일 수(calltmpcount)를 기록. MODE errbodies(T-135): 비-200 응답 본문($W/eb-se·eb-ps·eb-tr) · MODE killmid(T-135): holding-checker 호출 도중
#    본문을 반쯤 쓰고 러너를 SIGKILL(본문 파일 이름의 pid)
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
if [ -n "${STUB_PERMS:-}" ]; then ( cd "$R/home/.node-local/stockinvest" && for p in * .[!.]*; do [ -f "$p" ] && echo "$n $(stat -c %a "$p") $p"; done ) >> "$R/perms" 2>/dev/null; fi
if [ -n "${STUB_CALLTMP:-}" ]; then ls -A "$R/home/.node-local/stockinvest/call-tmp" 2>/dev/null | wc -l | tr -d ' ' >> "$R/calltmpcount"; fi
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
if [ -n "${STUB_PERMS:-}" ]; then
  echo "$path $(umask)" >> "$R/umasks"
  sp="$R/home/.node-local/stockinvest/job-run-spool"
  [ "$path" != "/api/cron/job-run-log" ] && [ -f "$sp" ] && stat -c %a "$sp" >> "$R/spoolperm"
fi
if [ -n "${STUB_CALLTMP:-}" ] && [ -n "$out" ] && [ "$path" != "/api/cron/job-run-log" ]; then
  echo "$path $(stat -c %a "$out" 2>/dev/null || echo none) $(stat -c %a "$(dirname "$out")" 2>/dev/null) $(ls -A "$(dirname "$out")" 2>/dev/null | wc -l | tr -d ' ') $out" >> "$R/outperm"
fi
if [ "$path" = "/api/cron/job-run-log" ]; then
  f="${data#@}"; n=$(wc -l < "$f" 2>/dev/null || echo 0)
  echo "$tk $n" >> "$R/posts"
  [ -n "${STUB_PERMS:-}" ] && stat -c %a "$f" >> "$R/batchperm"
  case "$(cat "$R/jmode")" in
    down) printf '000'; exit 7 ;;
    slow) if [ -n "$mt" ]; then adv "$mt"; else adv 30; fi; printf '000'; exit 28 ;;
    resp)
      if [ -n "$out" ]; then cat "$STUB_JRESP_FILE" > "$out"; [ -n "${STUB_PERMS:-}" ] && stat -c %a "$out" >> "$R/respperm"; fi
      printf '%s' "$STUB_JCODE"; exit 0 ;;
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
  money)
    case "$path" in
      /api/cron/portfolio-snapshot) [ -f "$R/body-ps" ] && body="$(cat "$R/body-ps")"; [ -f "$R/code-ps" ] && code="$(cat "$R/code-ps")" ;;
      /api/cron/trade-report) [ -f "$R/body-tr" ] && body="$(cat "$R/body-tr")" ;;
      /api/cron/strategy-eval) [ -f "$R/body-se" ] && body="$(cat "$R/body-se")" ;;
    esac ;;
  errbodies)
    case "$path" in
      /api/cron/strategy-eval) code=500; body="$(cat "$R/eb-se")" ;;
      /api/cron/portfolio-snapshot) code=503; body="$(cat "$R/eb-ps")" ;;
      /api/cron/trade-report) code=502; body="$(cat "$R/eb-tr")" ;;
      /api/cron/signal-followup) code=500; body="$(cat "$R/eb-sf")" ;;
      /api/cron/holding-checker) code=401; body='{"ok":false,"error":"unauthorized"}' ;;
      /api/cron/entry-watcher) code=000 ;;
    esac ;;
  killmid)
    if [ "$path" = "/api/cron/holding-checker" ] && [ -n "$out" ]; then
      printf '%s' '{"ok":true,"partial":"body-before-kill"}' > "$out"
      rp="${out##*/cron-runner-}"; rp="${rp%%.*}"
      echo "$rp $out" >> "$R/killed"
      kill -KILL "$rp" 2>/dev/null
      exit 0
    fi ;;
esac
if [ -n "$mt" ] && [ "$took" -gt "$mt" ]; then took=$mt; code=000; fi
[ "$took" -gt 0 ] && adv "$took"
if [ -n "$out" ]; then if [ "$code" = "000" ]; then : > "$out"; else printf '%s' "$body" > "$out"; fi; fi
printf '%s' "$code"
[ "$code" = "000" ] && exit 28
exit 0
EOF
  chmod +x "$R/bin/date" "$R/bin/sleep" "$R/bin/curl"
  if [ -d "$W/xbin-$name" ]; then cp "$W/xbin-$name"/* "$R/bin/" && chmod +x "$R/bin"/*; fi   # (T-127) 시나리오 전용 스텁(예: 실패하는 sed)
  : > "$R/calls"; : > "$R/maxtime"; : > "$R/posts"; : > "$R/received"; : > "$R/heartbeats"; : > "$R/spoolsize"
  : > "$R/outperm"; : > "$R/calltmpcount"   # (T-135) 같은 이름으로 다시 돌리면(J12 kill) 그 실행 몫만
  [ -f "$W/body-edgar" ] && cp "$W/body-edgar" "$R/body-edgar"
  for sd in body-ps body-tr body-se code-ps; do [ -f "$W/$sd" ] && cp "$W/$sd" "$R/$sd"; done   # (T-127) money 모드
  for sd in eb-se eb-ps eb-tr eb-sf; do [ -f "$W/$sd" ] && cp "$W/$sd" "$R/$sd"; done   # (T-135) errbodies 모드
  env PATH="$R/bin:$PATH" HOME="$R/home" PROJECT_DIR="$R/proj" BASE_URL="http://stub" TZ=Asia/Seoul \
    STUB_R="$R" STUB_REAL_DATE="$REAL_DATE" "$@" timeout 900 bash "$runner" > "$R/stdout" 2>&1
  echo "$R"
}

JRE=' /api/cron/job-run-log$'
# (T-135) call-body-tmp 블록·`# T-135` 표지 줄을 빼고, call() 의 본문 경로(CALL_BODY_FILE)·마스킹 로그 줄을 T-135 이전 모양으로 되돌린다(표준입력 → 표준출력).
#   J8 의 "추가만"·call() 비교가 T-135 의 의도된 세 줄 변경만 걸러 내고 나머지는 예전처럼 한 글자도 다르지 않은지 보게 한다(J13 이 이 되돌림이 정확히 그 세 줄만 바꾸는지 본다).
no_t135() {
  awk '/^# >>> call-body-tmp/{s=1} s{ if (/^# <<< call-body-tmp/) s=0; next } {print}' | grep -v '# T-135$' \
    | sed -e 's#body=$(head -c 2048 "\$CALL_BODY_FILE" 2>/dev/null | jrl_mask_money 2>/dev/null | head -c 200)#body=$(head -c 200 /tmp/cron-runner-$$.out 2>/dev/null)#' \
          -e 's#-o "\$CALL_BODY_FILE" -w#-o /tmp/cron-runner-$$.out -w#' \
          -e 's#^  rm -f "\$CALL_BODY_FILE"$#  rm -f /tmp/cron-runner-$$.out#'
}
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
# (T-135) call() 의 본문 경로 세 줄은 T-135 가 의도해 바꿨다 — no_t135 로 되돌린 러너로 비교한다(그 세 줄 밖은 예전 그대로여야 한다)
missing="$(awk 'NR==FNR { cur[++n] = $0; next } { while (j < n && cur[j+1] != $0) j++; if (j >= n) { print FNR": "$0; exit } j++ }' <(no_t135 < "$RUNNER") "$BASE")"
eq "🔴 J8: 기준 러너의 모든 줄(주석 포함)이 순서대로 남아 있다(삭제·수정 0, 추가만 — T-135 세 줄은 되돌려 비교)" "${missing:-none}" "none"
eq "🔴 J8: call() 에서 '# T-112 jrl' 두 줄을 빼고 T-135 를 되돌리면 기준 러너와 같다" \
   "$(awk '/^call\(\) \{/,/^\}/' "$RUNNER" | grep -v '# T-112 jrl$' | no_t135 | sha256sum)" "$(awk '/^call\(\) \{/,/^\}/' "$BASE" | sha256sum)"
eq "J8: call() 안 표지 줄 2개, 파일 전체 4개" "$(awk '/^call\(\) \{/,/^\}/' "$RUNNER" | grep -c '# T-112 jrl$') $(grep -c '# T-112 jrl$' "$RUNNER")" "2 4"
cb="$(awk '/^call\(\) \{/,/^\}/' "$RUNNER")"
eq "J8: 후크는 로그 줄 뒤·임시 본문 rm 바로 앞" "$(printf '%s\n' "$cb" | grep -A1 'jrl_hook ' | tail -1 | sed 's/^ *//')" 'rm -f "$CALL_BODY_FILE"'
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
# (T-127) umask·마스킹 범위 고정
BS="$(grep -n '^# >>> job-run-log-spool' "$RUNNER" | cut -d: -f1)"; BE="$(grep -n '^# <<< job-run-log-spool' "$RUNNER" | cut -d: -f1)"
# (T-135) call-body-tmp 블록의 call_tmp_open 도 함수 안에서만 umask 077 을 둔다 — 그 블록도 밖 검사에서 빼고 077 이 정확히 한 줄인지 본다
CS="$(grep -n '^# >>> call-body-tmp' "$RUNNER" | cut -d: -f1)"; CE="$(grep -n '^# <<< call-body-tmp' "$RUNNER" | cut -d: -f1)"
cbx="$(awk '/^# >>> call-body-tmp/,/^# <<< call-body-tmp/' "$RUNNER" | grep -v '^[[:space:]]*#')"
eq "🔴 J8(T-127·T-135): 두 블록(job-run-log-spool·call-body-tmp) 밖 실행 줄에 umask 없음 · jrl 블록 umask 077 두 줄(jrl_hook·jrl_flush) · call-body-tmp 블록 한 줄(call_tmp_open) · 서브셸 umask 없음" \
   "$(grep -n 'umask' "$RUNNER" | grep -v '^[0-9]*:[[:space:]]*#' | awk -F: -v s="$BS" -v e="$BE" -v cs="${CS:-0}" -v ce="${CE:-0}" '($1 + 0 < s + 0 || $1 + 0 > e + 0) && ($1 + 0 < cs + 0 || $1 + 0 > ce + 0)' | wc -l | tr -d ' ') $(printf '%s\n' "$bx" | grep -c 'umask 077') $(printf '%s\n' "$cbx" | grep -c 'umask 077') $(grep -v '^[[:space:]]*#' "$RUNNER" | grep -cE '(^|[^$])\([[:space:]]*umask')" "0 2 1 0"
eq "🔴 J8(T-127): 마스킹은 portfolio-snapshot·trade-report case 한 줄에서만 · 마스킹 함수 호출 1곳" \
   "$(printf '%s\n' "$bx" | grep -cE '^[[:space:]]+portfolio-snapshot\|trade-report\)') $(printf '%s\n' "$bx" | grep -c '| jrl_mask_money ')" "1 1"
eq "🔴 J8(T-127): 금액 키 5개 정확히" "$(printf '%s\n' "$bx" | grep -c '"(totalKRW|KRW|USD|headerPnlKRW|lifoPnlKRW)"')" "1"
eq "J8(T-127): 매 분 잡 본문 생략 case 줄 불변(job-slots.test 가 읽는 줄)" "$(printf '%s\n' "$bx" | grep -c '^    entry-watcher|holding-checker|stop-alert) \[ "\$hc" = "200" \] && b64_skip=1 ;;$')" "1"

fi
# ── J9. (T-127 ①) 금액 값 마스킹 ──────────────────────────────────────────────────
if want J9; then
echo "J9. (T-127 ①) 금액 값 마스킹 — portfolio-snapshot·trade-report 만"
MF="$W/mask-fn.sh"; awk '/^jrl_mask_money\(\) \{/,/^\}/' "$RUNNER" > "$MF"
mk() { bash -c '. "$1"; jrl_mask_money' _ "$MF"; }
mt() { eq "J9 표: $1" "$(printf '%s' "$2" | mk)" "$3"; }   # mt 이름 입력 기대
eq "(하네스 확인) J9: 러너에서 마스킹 함수를 잘라 냈다" "$(grep -c '^jrl_mask_money() {' "$MF")" "1"
mt "정수·중첩 cash{KRW,USD}" '{"totalKRW":987654321,"positions":4,"cash":{"KRW":12345678,"USD":4321.75}}' '{"totalKRW":0,"positions":4,"cash":{"KRW":0,"USD":0}}'
mt "음수·지수·소수" '{"headerPnlKRW":-3333333,"lifoPnlKRW":2.5e+6,"USD":-0.75E-2}' '{"headerPnlKRW":0,"lifoPnlKRW":0,"USD":0}'
mt "공백" '{ "KRW" :  77 , "USD" :88}' '{ "KRW" :  0 , "USD" :0}'
mt "null 은 그대로" '{"USD":null,"KRW":1}' '{"USD":null,"KRW":0}'
mt "이름이 비슷한 다른 키는 그대로" '{"totalKRWx":5,"xKRW":6,"KRWs":7,"usd":8}' '{"totalKRWx":5,"xKRW":6,"KRWs":7,"usd":8}'
mt "문자열 값 안의 키 글자·값 KRW 는 그대로" '{"note":"\"totalKRW\":99","skipped":"KRW","currency":"USD"}' '{"note":"\"totalKRW\":99","skipped":"KRW","currency":"USD"}'
mt "detail 닫힌 문자열 → \"\"(이스케이프 따옴표·역슬래시 포함, 중첩 두 곳)" \
   '{"skipped":"usd_cash_unavailable","detail":"예수금(7777.25 USD) \"q\" \\ end","drawdown":{"reason":"baseline_invalid","detail":"기준 자본 1234원"}}' \
   '{"skipped":"usd_cash_unavailable","detail":"","drawdown":{"reason":"baseline_invalid","detail":""}}'
mt "detail 이 null 이면 그대로" '{"detail":null,"KRW":1}' '{"detail":null,"KRW":0}'
mt "2KB 절단 — 숫자 중간" '{"ok":true,"totalKRW":12345' '{"ok":true,"totalKRW":0'
mt "2KB 절단 — 콜론까지" '{"ok":true,"totalKRW":' '{"ok":true,"totalKRW":'
mt "2KB 절단 — 음수 부호만" '{"KRW":-' '{"KRW":-'
mt "2KB 절단 — detail 안" '{"skipped":"usd_cash_unavailable","detail":"USD 예수금(98765' '{"skipped":"usd_cash_unavailable","detail":"'
mt "2KB 절단 — detail 안 역슬래시로 끝남" '{"detail":"abc 5\' '{"detail":"'
mt "분류 신호(ok·partial·reason·status·error·skipped·배열) 보존" \
   '{"ok":false,"partial":true,"status":"x","reason":"y","error":"boom 123","skipped":"balances_incomplete","failedMarkets":["overseas"]}' \
   '{"ok":false,"partial":true,"status":"x","reason":"y","error":"boom 123","skipped":"balances_incomplete","failedMarkets":["overseas"]}'
cat > "$W/maskcmp.py" <<'PYEOF'
import json, sys
KEYS = {"totalKRW", "KRW", "USD", "headerPnlKRW", "lifoPnlKRW"}
def mask(v):
    if isinstance(v, dict):
        out = {}
        for k, x in v.items():
            if k in KEYS and isinstance(x, (int, float)) and not isinstance(x, bool):
                out[k] = 0
            elif k == "detail" and isinstance(x, str):
                out[k] = ""
            else:
                out[k] = mask(x)
        return out
    if isinstance(v, list):
        return [mask(x) for x in v]
    return v
orig = json.load(open(sys.argv[1], encoding="utf-8"))
got = json.loads(sys.stdin.buffer.read().decode("utf-8"))
print("same" if json.dumps(mask(orig), ensure_ascii=False) == json.dumps(got, ensure_ascii=False) else "diff")
PYEOF
dec() { awk -F'\t' -v l="$2" '$2 == l {print $7}' "$1/received" | head -1 | base64 -d; }
alldec() { awk -F'\t' '{print $7}' "$1/received" | while read -r b; do printf '%s' "$b" | base64 -d; echo; done; }
MONEY_RE='987654321|12345678|4321\.75|7777\.25|3333333|2222222|55,555,555|66,666,666|98765|005930|AAPL|yyyy'
# ① 정상(총액·현금·drawdown 종목 소실 detail) + trade-report 발송 + strategy-eval(같은 키가 있어도 마스킹 대상 아님)
PS_OK='{"ok":true,"totalKRW":987654321,"positions":4,"cash":{"KRW":12345678,"USD":4321.75},"volGuard":{"level":"ok","changePct":-1.25},"killSwitch":false,"drawdown":{"status":"skipped","reason":"composition_change_suspected","detail":"24h -12.3% (-55,555,555원) 이지만 기준선에 있던 [005930, NAS:AAPL] 66,666,666원이 사라졌다"},"action":null}'
TR_OK='{"ok":true,"sent":true,"channel":"telegram","partial":false,"delivered":["telegram"],"failed":[],"unconfigured":[],"noTargetChannel":false,"lastSentAtAdvanced":true,"rangeStart":"2026-10-28T00:00:00.000Z","rangeEnd":"2026-10-28T01:00:00.000Z","rangeCapped":false,"buys":2,"sells":1,"headerPnlKRW":-3333333,"lifoPnlKRW":2222222,"unmatchedSellCount":0,"matchedSellCount":1}'
SE='{"ok":true,"totalKRW":1111111,"cash":{"KRW":5},"detail":"keep 9999"}'
printf '%s' "$PS_OK" > "$W/body-ps"; printf '%s' "$TR_OK" > "$W/body-tr"; printf '%s' "$SE" > "$W/body-se"
M1="$(run_loop mask-ok "$RUNNER" "2026-10-28 10:00:00" 1 money ok "")"
eq "(하네스 확인) J9: 세 라벨이 이 틱에 기록됨" "$(awk -F'\t' '$2 == "portfolio-snapshot" || $2 == "trade-report" || $2 == "strategy-eval"' "$M1/received" | wc -l | tr -d ' ')" "3"
eq "🔴 J9: portfolio-snapshot = 원문에 같은 치환(금액 키 0·detail \"\")을 한 JSON(키 순서·다른 값 그대로)" "$(dec "$M1" portfolio-snapshot | python3 -I "$W/maskcmp.py" "$W/body-ps")" "same"
eq "🔴 J9: trade-report = 같은 치환" "$(dec "$M1" trade-report | python3 -I "$W/maskcmp.py" "$W/body-tr")" "same"
eq "🔴 J9: 받은 줄 어디에도 금액·종목 원문 글자 없음" "$(alldec "$M1" | grep -cE "$MONEY_RE")" "0"
eq "J9: (하네스 확인) 원문에는 그 글자가 있었다" "$(cat "$W/body-ps" "$W/body-tr" | grep -cE "$MONEY_RE")" "1"
eq "🔴 J9: 다른 라벨(strategy-eval)은 같은 키·detail 이 있어도 원문 그대로" "$(dec "$M1" strategy-eval)" "$SE"
same_calls "J9" "$M1" "$(run_loop mask-ok-base "$BASE" "2026-10-28 10:00:00" 1 money ok "")"
# ② 보류(skipped:usd_cash_unavailable — detail 에 USD 금액) + trade-report 건너뜀
PS_HOLD='{"ok":true,"skipped":"usd_cash_unavailable","detail":"USD/KRW 환율 조회 실패 — USD 예수금(7777.25 USD)을 환산할 수 없음: timeout","snapshotAgeMin":75,"blindness":"warning"}'
TR_SKIP='{"ok":true,"skipped":"anchor_not_due"}'
printf '%s' "$PS_HOLD" > "$W/body-ps"; printf '%s' "$TR_SKIP" > "$W/body-tr"
M2="$(run_loop mask-hold "$RUNNER" "2026-10-28 10:00:00" 1 money ok "")"
eq "🔴 J9: 보류 본문 = 같은 치환 · skipped 신호 그대로" "$(dec "$M2" portfolio-snapshot | python3 -I "$W/maskcmp.py" "$W/body-ps") $(dec "$M2" portfolio-snapshot | grep -c '"skipped":"usd_cash_unavailable"')" "same 1"
eq "J9: 금액 키 없는 trade-report 건너뜀 본문은 바이트 그대로" "$(dec "$M2" trade-report)" "$TR_SKIP"
eq "🔴 J9: USD 금액 원문 없음" "$(alldec "$M2" | grep -cE "$MONEY_RE")" "0"
# ③ 2KB 절단 — portfolio-snapshot 은 2048바이트째가 totalKRW 숫자 한가운데, trade-report 는 detail 문자열 한가운데
{ printf '{"ok":true,"pad":"'; head -c 2012 /dev/zero | tr '\0' 'x'; printf '","totalKRW":123456789012,"cash":{"KRW":5}}'; } > "$W/body-ps"
{ printf '{"ok":true,"skipped":"x","detail":"USD 예수금(98765 USD) '; head -c 3000 /dev/zero | tr '\0' 'y'; printf '"}'; } > "$W/body-tr"
eq "(하네스 확인) J9: 원문 앞 2048바이트가 숫자 중간에서 끝난다" "$(head -c 2048 "$W/body-ps" | tail -c 16)" '"totalKRW":12345'
M3="$(run_loop mask-cut "$RUNNER" "2026-10-28 10:00:00" 1 money ok "")"
eq "🔴 J9: 숫자 중간 절단 → 끝이 \"totalKRW\":0 · 잘린 숫자 글자 없음" "$(dec "$M3" portfolio-snapshot | tail -c 12) $(dec "$M3" portfolio-snapshot | grep -c 12345)" '"totalKRW":0 0'
eq "J9: 절단 본문의 나머지 앞부분은 그대로" "$(dec "$M3" portfolio-snapshot | head -c 2030 | md5sum)" "$(head -c 2030 "$W/body-ps" | md5sum)"
eq "🔴 J9: detail 문자열 중간 절단 → detail 값이 통째로 비고 끝난다" "$(dec "$M3" trade-report)" '{"ok":true,"skipped":"x","detail":"'
# ④ 마스킹 실패(sed 가 출력 없이 실패) → 두 라벨은 본문 칸이 비고(원문이 새지 않음) 다른 라벨은 그대로
printf '%s' "$PS_OK" > "$W/body-ps"; printf '%s' "$TR_OK" > "$W/body-tr"
mkdir -p "$W/xbin-mask-sedfail"; printf '#!/usr/bin/env bash\nexit 1\n' > "$W/xbin-mask-sedfail/sed"
M4="$(run_loop mask-sedfail "$RUNNER" "2026-10-28 10:00:00" 1 money ok "")"
eq "🔴 J9: sed 실패 → portfolio-snapshot·trade-report 본문 칸 빈 값(7칸 유지)" \
   "$(awk -F'\t' '($2 == "portfolio-snapshot" || $2 == "trade-report") && NF == 7 && $7 == ""' "$M4/received" | wc -l | tr -d ' ')" "2"
eq "J9: sed 실패여도 다른 라벨 본문은 그대로" "$(dec "$M4" strategy-eval)" "$SE"
eq "🔴 J9: sed 실패 때도 금액 원문 없음" "$(alldec "$M4" | grep -cE "$MONEY_RE")" "0"
rm -rf "$W/xbin-mask-sedfail" "$W/body-ps" "$W/body-tr" "$W/body-se"

fi
# ── J10. (T-127 ②) 스풀 0600 · umask 복원 ──────────────────────────────────────────
if want J10; then
echo "J10. (T-127 ②) umask 022 — 스풀 파일 600, 러너의 나머지 파일·잡 호출 umask 는 그대로"
printf '%s' '{"ok":false,"received":3,"status":"failed","reason":"timeout"}' > "$W/jresp-um"
U_BASE="$(umask 022; run_loop um-base "$BASE" "2026-10-28 06:59:00" 3 ok ok "" STUB_PERMS=1)"
U_OK="$(umask 022; run_loop um-ok "$RUNNER" "2026-10-28 06:59:00" 3 ok ok "" STUB_PERMS=1)"
U_DOWN="$(umask 022; run_loop um-down "$RUNNER" "2026-10-28 06:59:00" 3 ok down "" STUB_PERMS=1)"
U_UNW="$(umask 022; run_loop um-unw "$RUNNER" "2026-10-28 06:59:00" 3 ok ok "" STUB_PERMS=1 "JRL_SPOOL_FILE=$W/no-such-dir/x/spool")"
U_HVY="$(umask 022; run_loop um-hvy "$RUNNER" "2026-10-28 08:00:00" 2 worst08 slow "" STUB_PERMS=1)"
U_RSP="$(umask 022; run_loop um-rsp "$RUNNER" "2026-10-28 06:59:00" 3 ok resp "" STUB_PERMS=1 STUB_JCODE=503 "STUB_JRESP_FILE=$W/jresp-um")"
eq "(하네스 확인) J10: 기준 러너의 잡 호출은 모두 umask 0022" "$(awk '$2 != "0022"' "$U_BASE/umasks" | wc -l | tr -d ' ') $([ "$(wc -l < "$U_BASE/umasks")" -gt 10 ] && echo many)" "0 many"
eq "(하네스 확인) J10: 무거운 틱 시나리오 — 첫 틱은 전송 없음, 다음 틱은 전송" "$(awk '{print $1}' "$U_HVY/posts" | tr '\n' ' ')" "1 "
for S in "$U_OK" "$U_DOWN" "$U_UNW" "$U_HVY" "$U_RSP"; do
  sn="${S##*/}"
  eq "🔴 J10 $sn: 잡 호출은 매번 러너 원래 umask 0022(후크·전송이 되돌림)" \
     "$(awk '$1 != "/api/cron/job-run-log" && $2 != "0022"' "$S/umasks" | wc -l | tr -d ' ') $([ "$(awk '$1 != "/api/cron/job-run-log"' "$S/umasks" | wc -l)" -gt 5 ] && echo many)" "0 many"
  eq "J10 $sn: 하트비트·날짜파일 권한 = 644" "$(grep -v ' job-run-spool' "$S/perms" | awk '$2 != "644"' | wc -l | tr -d ' ')" "0"
  eq "🔴 J10 $sn: 상태 디렉터리의 스풀 파일은 모두 600 · 응답 파일(.resp) 잔존 없음" \
     "$(grep ' job-run-spool' "$S/perms" | awk '$2 != "600"' | wc -l | tr -d ' ') $(grep -c '\.resp$' "$S/perms")" "0 0"
done
eq "🔴 J10: 하트비트·날짜파일 목록·권한 = 기준 러너(정상)" "$(grep -v ' job-run-spool' "$U_OK/perms" | md5sum)" "$(md5sum < "$U_BASE/perms")"
eq "J10: (하네스 확인) 날짜파일이 생겼다(news-fetch-overseas·research·edgar)" "$(awk '$1 == 3' "$U_OK/perms" | grep -c 'last-date$')" "3"
for S in "$U_OK" "$U_DOWN" "$U_HVY" "$U_RSP"; do
  sn="${S##*/}"
  eq "🔴 J10 $sn: 호출 사이 스풀 파일 600(관측 > 0)" "$(awk '$1 != "600"' "$S/spoolperm" | wc -l | tr -d ' ') $([ -s "$S/spoolperm" ] && echo seen)" "0 seen"
  eq "🔴 J10 $sn: 전송 묶음(.batch) 600 · 전송 curl 은 umask 0077 아래" \
     "$(awk '$1 != "600"' "$S/batchperm" | wc -l | tr -d ' ') $(awk '$1 == "/api/cron/job-run-log" && $2 != "0077"' "$S/umasks" | wc -l | tr -d ' ') $([ -s "$S/batchperm" ] && echo seen)" "0 0 seen"
done
eq "🔴 J10: 앱 다운 — 틱 끝에 남은 .sending 600" "$(grep -c ' 600 job-run-spool.sending$' "$U_DOWN/perms")" "3"
eq "🔴 J10: 503 응답 파일(.resp)도 600 으로 생김" "$(awk '$1 != "600"' "$U_RSP/respperm" | wc -l | tr -d ' ') $(wc -l < "$U_RSP/respperm" | tr -d ' ')" "0 3"
eq "J10: 스풀을 못 쓰는 러너도 3틱 완주·전송 0" "$(cat "$U_UNW/ticks") $(wc -l < "$U_UNW/posts" | tr -d ' ')" "3 0"

fi
# ── J11. (T-127 ⑤) 전송 실패 줄의 사유 ─────────────────────────────────────────────
if want J11; then
echo "J11. (T-127 ⑤) 전송 실패 줄의 사유 분류어 — 허용 문자만, 주입 없음"
j11() {   # j11 이름 HTTP코드 응답본문 → 결과 디렉터리 (2틱, 두 틱 모두 실패 → 실패 줄은 1개여야 한다)
  printf '%s' "$3" > "$W/jresp-$1"
  run_loop "j11-$1" "$RUNNER" "2026-10-28 10:00:00" 2 ok resp "" STUB_JCODE="$2" "STUB_JRESP_FILE=$W/jresp-$1"
}
fl() { grep 'job-run-log 전송' "$1/stdout" | sed 's/^\[[^]]*\] //'; }
TL=' — 스풀에 남겨 다음 가벼운 틱에 다시 보냄(기록 전용, 잡 동작 무관)'
K="$(j11 timeout 503 '{"ok":false,"received":200,"rejected":0,"runRows":0,"rollupRows":0,"rowErrors":0,"status":"failed","reason":"timeout"}')"
eq "🔴 J11: 라우트 503(사유가 100자 뒤) → reason=timeout, 실패 줄 1개" "$(fl "$K")" "job-run-log 전송 실패 HTTP=503 reason=timeout$TL"
K="$(j11 sw 503 '{"ok":false,"received":5,"rejected":0,"runRows":0,"rollupRows":0,"rowErrors":0,"status":"failed","reason":"switch_unreadable"}')"
eq "J11: reason=switch_unreadable" "$(fl "$K")" "job-run-log 전송 실패 HTTP=503 reason=switch_unreadable$TL"
K="$(j11 auth 401 '{"ok":false,"error":"unauthorized","detail":"x-cron-secret required"}')"
eq "J11: 401(미들웨어) → error=unauthorized" "$(fl "$K")" "job-run-log 전송 실패 HTTP=401 error=unauthorized$TL"
K="$(j11 big 413 '{"ok":false,"error":"payload_too_large"}')"
eq "J11: 413 → error=payload_too_large" "$(fl "$K")" "job-run-log 전송 실패 HTTP=413 error=payload_too_large$TL"
K="$(j11 inj 503 $'{"ok":false,"reason":"timeout\n[2026-10-28 10:00:00] job-run-log 전송 회복\e[31m"}')"
eq "🔴 J11: 개행·ESC 를 실은 사유 → 덧붙이지 않음 · 가짜 '회복' 줄 없음 · ESC 바이트 없음" \
   "$(fl "$K") | $(grep -c '전송 회복' "$K/stdout") $(grep -c $'\e' "$K/stdout")" "job-run-log 전송 실패 HTTP=503$TL | 0 0"
K="$(j11 cr 503 $'{"reason":"time\rout"}')"
eq "🔴 J11: CR 을 실은 사유 → 덧붙이지 않음" "$(fl "$K") $(grep -c $'\r' "$K/stdout")" "job-run-log 전송 실패 HTTP=503$TL 0"
K="$(j11 upper 503 '{"reason":"TIMEOUT"}')"
eq "J11: 대문자 사유 → 덧붙이지 않음" "$(fl "$K")" "job-run-log 전송 실패 HTTP=503$TL"
K="$(j11 long 503 "{\"reason\":\"a$(head -c 48 /dev/zero | tr '\0' 'b')\"}")"
eq "J11: 49자 사유 → 덧붙이지 않음" "$(fl "$K")" "job-run-log 전송 실패 HTTP=503$TL"
K="$(j11 html 500 '<html><body>Internal Server Error 123456</body></html>')"
eq "J11: HTML 본문 → 덧붙이지 않음(본문 원문을 적지 않는다)" "$(fl "$K")" "job-run-log 전송 실패 HTTP=500$TL"
K="$(j11 quote 503 '{"reason":"timeout\" x","error":"db_error"}')"
eq "J11: 이스케이프 따옴표로 끝나는 사유는 건너뛰고 다음 허용 필드(error)" "$(fl "$K")" "job-run-log 전송 실패 HTTP=503 error=db_error$TL"
K="$(run_loop j11-down "$RUNNER" "2026-10-28 10:00:00" 2 ok down "")"
eq "🔴 J11: HTTP=000 → 예전 줄 그대로" "$(fl "$K")" "job-run-log 전송 실패 HTTP=000$TL"
eq "J11: 응답 파일(.resp)이 남지 않는다" "$(ls -a "$K/home/.node-local/stockinvest/" "$W"/j11-*/home/.node-local/stockinvest/ 2>/dev/null | grep -c '\.resp$')" "0"

fi
# ── J12. (T-135) call() 의 응답 본문 임시 파일 ──────────────────────────────────────
if want J12; then
echo "J12. (T-135) 응답 본문 임시 파일 — 0600·0700 디렉터리·잔존 0·로그 마스킹·대체 경로·호출 중 kill 뒤 시작 정리"
CT=".node-local/stockinvest/call-tmp"
TMPNAME_RE='/\.node-local/stockinvest/call-tmp/cron-runner-[0-9]+\.[A-Za-z0-9]{6}$'
# ① umask 022 로 시작 — 정상 응답(06:59 시작 3틱: 매 분 잡 + 06시 뉴스·07시 리서치·EDGAR)
T1="$(umask 022; run_loop t135-um "$RUNNER" "2026-10-28 06:59:00" 3 ok ok "" STUB_PERMS=1 STUB_CALLTMP=1)"
T1B="$(umask 022; run_loop t135-um-base "$BASE" "2026-10-28 06:59:00" 3 ok ok "")"
NJ="$(nojrl "$T1" | wc -l | tr -d ' ')"
eq "(하네스 확인) J12: 잡 호출마다 본문 파일 관측(호출 수와 같음, > 10)" "$(wc -l < "$T1/outperm" | tr -d ' ') $([ "$NJ" -gt 10 ] && echo many)" "$NJ many"
eq "🔴 J12: 본문 파일은 생성 시점부터 600 · 디렉터리 700 · 그 순간 디렉터리에 그 파일 1개뿐" "$(awk '$2 != "600" || $3 != "700" || $4 != "1"' "$T1/outperm" | wc -l | tr -d ' ')" "0"
eq "🔴 J12: 경로 = ~/$CT/cron-runner-<러너 pid>.<무작위 6자> · 호출마다 다른 이름" \
   "$(awk '{print $5}' "$T1/outperm" | grep -cvE "$TMPNAME_RE") $(awk '{print $5}' "$T1/outperm" | sort | uniq -d | wc -l | tr -d ' ')" "0 0"
eq "🔴 J12: 정상 응답 뒤 잔존 0(틱 끝마다 call-tmp 0개)" "$(tr '\n' ' ' < "$T1/calltmpcount")" "0 0 0 "
eq "🔴 J12: 잡 curl 은 umask 0022 그대로(call_tmp_open 이 되돌림)" "$(awk '$1 != "/api/cron/job-run-log" && $2 != "0022"' "$T1/umasks" | wc -l | tr -d ' ')" "0"
eq "J12: 디렉터리 자체는 700" "$(stat -c %a "$T1/home/$CT")" "700"
same_calls "J12 umask022" "$T1" "$T1B"
if diff "$T1/stdout" "$T1B/stdout" > /dev/null; then ok "J12: stdout = 기준 러너(정상 응답 — 로그 줄 불변)"; else bad "J12: stdout 이 다르다"; diff "$T1/stdout" "$T1B/stdout" | head -5; fi
if diff "$T1/heartbeats" "$T1B/heartbeats" > /dev/null; then ok "J12: 하트비트 = 기준 러너"; else bad "J12: 하트비트가 다르다"; fi
eq "J12: 받은 줄 본문 = 잡 응답 '{}'(후크가 CALL_BODY_FILE 을 읽음)" "$(awk -F'\t' '!($2 == "entry-watcher" || $2 == "holding-checker" || $2 == "stop-alert") && $7 != "e30=" { b++ } END { print b + 0 }' "$T1/received")" "0"

# ② 비-200 응답 — 로그 body= 는 마스킹 뒤 앞 200바이트(모든 라벨). 스풀 본문은 T-127 라벨 규칙 그대로.
MF="$W/mask-fn-t135.sh"; awk '/^jrl_mask_money\(\) \{/,/^\}/' "$RUNNER" > "$MF"
mk() { bash -c '. "$1"; jrl_mask_money' _ "$MF"; }
expl() { printf '%s' "$1" | head -c 2048 | mk | head -c 200; }   # 기대 body= (러너와 같은 함수로 계산)
logbody() { grep " $2 HTTP=" "$1/stdout" | head -1 | LC_ALL=C sed "s/^\[[^]]*\] $2 HTTP=[0-9]* body=//"; }   # LC_ALL=C — 200바이트에서 잘린 UTF-8 반쪽도 그대로
EB_SE='{"ok":false,"error":"x","totalKRW":1111111,"detail":"keep 9999 원","cash":{"USD":4321.5}}'
EB_PS="{\"ok\":false,\"skipped\":\"usd_cash_unavailable\",\"detail\":\"USD 예수금(7777.25 USD) 환산 실패 — $(head -c 120 /dev/zero | tr '\0' 'd')\",\"totalKRW\":987654321,\"cash\":{\"KRW\":12345678,\"USD\":4321.75},\"pad\":\"$(head -c 300 /dev/zero | tr '\0' 'p')\"}"
EB_TR='{"ok":false,"error":"boom","headerPnlKRW":-3333333,"lifoPnlKRW":2222222}'
EB_SF="{\"ok\":false,\"error\":\"diag\",\"trace\":\"$(head -c 300 /dev/zero | tr '\0' 't')\"}"
printf '%s' "$EB_SE" > "$W/eb-se"; printf '%s' "$EB_PS" > "$W/eb-ps"; printf '%s' "$EB_TR" > "$W/eb-tr"; printf '%s' "$EB_SF" > "$W/eb-sf"
T2="$(umask 022; run_loop t135-err "$RUNNER" "2026-10-28 10:00:00" 1 errbodies ok "" STUB_CALLTMP=1)"
T2B="$(run_loop t135-err-base "$BASE" "2026-10-28 10:00:00" 1 errbodies ok "")"
MONEY='1111111|9999|4321|7777\.25|987654321|12345678|3333333|2222222'
eq "(하네스 확인) J12: 기준 러너(T-135 전)는 로그에 금액 원문을 찍었다" "$([ "$(grep -cE "$MONEY" "$T2B/stdout")" -gt 0 ] && echo leaked)" "leaked"
eq "🔴 J12: 새 러너 로그 어디에도 금액·detail 원문 없음" "$(grep -cE "$MONEY" "$T2/stdout")" "0"
eq "🔴 J12: strategy-eval 500(금액 라벨 아님) body= = 마스킹 뒤 앞 200" "$(logbody "$T2" strategy-eval)" "$(expl "$EB_SE")"
eq "🔴 J12: portfolio-snapshot 503 body= = 마스킹 뒤 앞 200(detail 이 비어 뒤쪽 키가 보인다)" "$(logbody "$T2" portfolio-snapshot)" "$(expl "$EB_PS")"
eq "J12: (하네스 확인) portfolio-snapshot 마스킹 결과가 200바이트를 넘어 잘린다" "$([ "$(printf '%s' "$EB_PS" | mk | wc -c)" -gt 200 ] && echo cut) $(printf '%s' "$(logbody "$T2" portfolio-snapshot)" | wc -c | tr -d ' ')" "cut 200"
eq "🔴 J12: trade-report 502 body= = 마스킹 뒤" "$(logbody "$T2" trade-report)" "$(expl "$EB_TR")"
eq "J12: 금액 키·detail 없는 본문(signal-followup 500, 300바이트)은 예전처럼 원문 앞 200바이트" "$(logbody "$T2" signal-followup)" "$(printf '%s' "$EB_SF" | head -c 200)"
eq "J12: 401 짧은 본문은 그대로" "$(logbody "$T2" holding-checker)" '{"ok":false,"error":"unauthorized"}'
eq "J12: 000(curl 실패) 은 body= 빈 값(예전과 같음)" "$(grep -c ' entry-watcher HTTP=000 body=$' "$T2/stdout") $(grep -c ' entry-watcher HTTP=000 body=$' "$T2B/stdout")" "1 1"
eq "J12: 로그 줄 형식·순서 = 기준 러너(body= 뒤만 다름)" "$(LC_ALL=C sed 's/ body=.*$/ body=/' "$T2/stdout" | md5sum)" "$(LC_ALL=C sed 's/ body=.*$/ body=/' "$T2B/stdout" | md5sum)"
dec1() { awk -F'\t' -v l="$2" '$2 == l {print $7}' "$1/received" | head -1 | base64 -d; }
eq "🔴 J12: 스풀 본문 — strategy-eval 은 원문 그대로(T-127 라벨 규칙 불변) · portfolio-snapshot 은 마스킹" \
   "$([ "$(dec1 "$T2" strategy-eval)" = "$EB_SE" ] && echo raw) $(dec1 "$T2" portfolio-snapshot | grep -cE "$MONEY")" "raw 0"
eq "🔴 J12: 비정상 응답 뒤에도 잔존 0 · 생성 시점 600" "$(tr '\n' ' ' < "$T2/calltmpcount") $(awk '$2 != "600"' "$T2/outperm" | wc -l | tr -d ' ')" "0  0"
same_calls "J12 errbodies" "$T2" "$T2B"
rm -f "$W/eb-se" "$W/eb-ps" "$W/eb-tr" "$W/eb-sf"

# ③ mktemp 실패(디렉터리를 만들 수 없음) → 예전 이름 /tmp/cron-runner-<pid>.out 을 600 으로 미리 만들어 쓴다 · 호출·stdout = 기준 러너
: > "$W/afile"
T3="$(umask 022; run_loop t135-fb "$RUNNER" "2026-10-28 06:59:00" 3 ok ok "" STUB_PERMS=1 STUB_CALLTMP=1 "CALL_TMP_DIR=$W/afile/sub")"
T3B="$(run_loop t135-fb-base "$BASE" "2026-10-28 06:59:00" 3 ok ok "")"
FBP="$(awk '{print $5}' "$T3/outperm" | sort -u)"
eq "🔴 J12 대체: 경로 = /tmp/cron-runner-<pid>.out 한 개 · 생성 시점 600" \
   "$(printf '%s\n' "$FBP" | grep -cE '^/tmp/cron-runner-[0-9]+\.out$') $(printf '%s\n' "$FBP" | wc -l | tr -d ' ') $(awk '$2 != "600"' "$T3/outperm" | wc -l | tr -d ' ')" "1 1 0"
eq "🔴 J12 대체: 끝나면 그 파일 잔존 없음" "$([ -e "$FBP" ] && echo left || echo gone)" "gone"
eq "J12 대체: 잡 curl umask 0022 그대로" "$(awk '$1 != "/api/cron/job-run-log" && $2 != "0022"' "$T3/umasks" | wc -l | tr -d ' ')" "0"
same_calls "J12 대체" "$T3" "$T3B"
if diff "$T3/stdout" "$T3B/stdout" > /dev/null; then ok "🔴 J12 대체: stdout = 기준 러너(오류 출력 없음)"; else bad "J12 대체: stdout 이 다르다"; diff "$T3/stdout" "$T3B/stdout" | head -5; fi
eq "J12 대체: 스풀 본문도 그대로 읽힌다" "$(awk -F'\t' '!($2 == "entry-watcher" || $2 == "holding-checker" || $2 == "stop-alert") && $7 != "e30=" { b++ } END { print b + 0 }' "$T3/received")" "0"

# ④ 호출 도중 SIGKILL ×3 → 매번 잔존 1개(다음 시작이 이전 것을 지움 — 누적 없음) → 정상 시작이면 0
KCNT=""; KMODE=""
for k in 1 2 3; do
  KR="$(run_loop t135-kill "$RUNNER" "2026-10-28 10:0${k}:00" 5 killmid ok "" STUB_CALLTMP=1)"
  KCNT="$KCNT$(ls -A "$KR/home/$CT" | wc -l | tr -d ' ') "
  KMODE="$KMODE$(stat -c %a "$KR/home/$CT"/cron-runner-* 2>/dev/null | tr '\n' ',') "
done
eq "(하네스 확인) J12 kill: 세 번 모두 호출 도중 죽었다(서로 다른 러너 pid)" "$(awk '{print $1}' "$KR/killed" | sort -u | wc -l | tr -d ' ') $(grep -c 'holding-checker' "$KR/stdout")" "3 0"
eq "🔴 J12 kill: 죽을 때마다 잔존은 1개(앞 실행의 잔존은 다음 시작이 지웠다 — 누적 없음)" "$KCNT" "1 1 1 "
eq "🔴 J12 kill: 남은 파일도 600(0700 디렉터리 안)" "$KMODE $(stat -c %a "$KR/home/$CT")" "600, 600, 600,  700"
eq "J12 kill: 남은 것은 마지막 kill 의 그 파일(본문 반쯤)" "$(cat "$KR/home/$CT"/cron-runner-* 2>/dev/null)" '{"ok":true,"partial":"body-before-kill"}'
KR="$(run_loop t135-kill "$RUNNER" "2026-10-28 10:05:00" 2 ok ok "" STUB_CALLTMP=1)"
eq "🔴 J12 kill: 정상 시작 → 첫 호출 전에 이미 지움(첫 호출 때 디렉터리에 자기 파일 1개) · 끝나면 0" \
   "$(head -1 "$KR/outperm" | awk '{print $4}') $(ls -A "$KR/home/$CT" | wc -l | tr -d ' ')" "1 0"

# ⑤ 시작 정리 범위 — 죽은 pid 파일만 지운다(살아 있는 pid·숫자 아닌 이름·다른 파일은 둔다), 디렉터리 권한은 700 으로 맞춘다
SW="$W/t135-sweep"; mkdir -p "$SW/home/$CT"; chmod 755 "$SW/home/$CT"
sleep 300 & LIVE=$!
( : ) & DEAD=$!; wait "$DEAD" 2>/dev/null
: > "$SW/home/$CT/cron-runner-$LIVE.keep01"; : > "$SW/home/$CT/cron-runner-$DEAD.dead01"; : > "$SW/home/$CT/cron-runner-x1.weird"; : > "$SW/home/$CT/other.txt"
SW="$(run_loop t135-sweep "$RUNNER" "2026-10-28 10:00:00" 1 ok ok "" STUB_CALLTMP=1)"
kill "$LIVE" 2>/dev/null; wait "$LIVE" 2>/dev/null
eq "🔴 J12 정리: 살아 있는 pid·숫자 아닌 이름·다른 파일은 남고 죽은 pid 파일만 지움" "$(ls -A "$SW/home/$CT" | sort | tr '\n' ' ')" "$(printf '%s\n' "cron-runner-$LIVE.keep01" cron-runner-x1.weird other.txt | sort | tr '\n' ' ')"
eq "J12 정리: 755 로 있던 디렉터리 → 700" "$(stat -c %a "$SW/home/$CT")" "700"
rm -f "$W/afile"

fi
# ── J13. (T-135) 정적 ─────────────────────────────────────────────────────────────
if want J13; then
echo "J13. (T-135) 정적"
eq "bash -n" "$(bash -n "$RUNNER" 2>&1 && echo ok)" "ok"
cbk="$(awk '/^# >>> call-body-tmp/,/^# <<< call-body-tmp/' "$RUNNER")"
cbkx="$(printf '%s\n' "$cbk" | grep -v '^[[:space:]]*#')"
cb="$(awk '/^call\(\) \{/,/^\}/' "$RUNNER")"
eq "J13: 블록 표지 1개씩 · call() 정의 앞 · 루프(while true) 앞" \
   "$(grep -c '^# >>> call-body-tmp' "$RUNNER") $(grep -c '^# <<< call-body-tmp' "$RUNNER") $([ "$(grep -n '^# <<< call-body-tmp' "$RUNNER" | cut -d: -f1)" -lt "$(grep -n '^call() {' "$RUNNER" | cut -d: -f1)" ] && echo yes || echo no)" "1 1 yes"
eq "🔴 J13: 시작 정리 호출은 블록 안 한 줄(최상위) · 파일 전체 1개" "$(printf '%s\n' "$cbkx" | grep -c '^call_tmp_init$') $(grep -v '^[[:space:]]*#' "$RUNNER" | grep -c 'call_tmp_init$')" "1 1"
eq "🔴 J13: '# T-135' 표지 줄 = call() 안 call_tmp_open 1줄(jrl_t0 바로 뒤)" \
   "$(grep -c '# T-135$' "$RUNNER") $(printf '%s\n' "$cb" | grep -A1 'jrl_t0=\$(jrl_now_ms' | tail -1 | sed 's/^ *//')" "1 call_tmp_open   # T-135"
eq "🔴 J13: call() 의 본문 경로 줄 3개(curl -o · 로그 body= · rm) · 마지막 실행 줄 = rm(반환값)" \
   "$(printf '%s\n' "$cb" | grep -c '\$CALL_BODY_FILE') $(printf '%s\n' "$cb" | grep -v '^[[:space:]]*#' | grep -v '^}' | tail -1 | sed 's/^ *//')" '3 rm -f "$CALL_BODY_FILE"'
eq "🔴 J13: 비-200 로그 줄 = 마스킹 뒤 앞 200바이트" "$(printf '%s\n' "$cb" | grep 'HTTP=\$code body=' | sed 's/^ *//')" \
   'echo "[$ts] $label HTTP=$code body=$(head -c 2048 "$CALL_BODY_FILE" 2>/dev/null | jrl_mask_money 2>/dev/null | head -c 200)"'
eq "🔴 J13: 예전 고정 경로는 실행 줄에서 대체 경로 1곳뿐(call_tmp_open)" \
   "$(grep -v '^[[:space:]]*#' "$RUNNER" | grep -c 'cron-runner-\$\$\.out') $(printf '%s\n' "$cbkx" | grep -c '^    CALL_BODY_FILE="/tmp/cron-runner-\$\$\.out"$')" "1 1"
eq "🔴 J13: jrl_hook 은 CALL_BODY_FILE 을 두 번 읽는다(금액 라벨·일반)" "$(awk '/^jrl_hook\(\) \{/,/^\}/' "$RUNNER" | grep -c '"\${CALL_BODY_FILE:-}"')" "2"
eq "🔴 J13: mktemp 줄 · 기본 디렉터리 줄" \
   "$(printf '%s\n' "$cbkx" | grep -c '^  CALL_BODY_FILE=\$(mktemp "\${CALL_TMP_DIR:-/nonexistent}/cron-runner-\$\$\.XXXXXX" 2>/dev/null) || CALL_BODY_FILE=""$') $(printf '%s\n' "$cbkx" | grep -c '^CALL_TMP_DIR="\${CALL_TMP_DIR:-\${HOME}/\.node-local/stockinvest/call-tmp}"$')" "1 1"
cto="$(awk '/^call_tmp_open\(\) \{/,/^\}/' "$RUNNER" | grep -v '^[[:space:]]*#')"
eq "🔴 J13: call_tmp_open — umask 077 한 줄 · 되돌리기는 return 바로 앞 한 줄" \
   "$(printf '%s\n' "$cto" | grep -c 'umask 077') $(printf '%s\n' "$cto" | grep -B1 '^  return 0$' | head -1 | sed 's/^ *//')" '1 [ -z "$um" ] || umask "$um" 2>/dev/null || true'
cti="$(awk '/^call_tmp_init\(\) \{/,/^\}/' "$RUNNER" | grep -v '^[[:space:]]*#')"
eq "🔴 J13: 시작 정리 — 숫자 pid 만 · 자기 pid 제외 · 살아 있는 pid 제외(kill -0) · rm 은 그 뒤 한 곳" \
   "$(printf '%s\n' "$cti" | grep -c "case \"\$p\" in ''|\*\[!0-9\]\*) continue ;; esac") $(printf '%s\n' "$cti" | grep -c '\[ "\$p" = "\$\$" \] && continue') $(printf '%s\n' "$cti" | grep -c 'kill -0 "\$p" 2>/dev/null && continue') $(printf '%s\n' "$cti" | grep -c 'rm -f')" "1 1 1 1"
eq "J13: trap 없음(TERM 에 바로 죽는 러너 동작 불변)" "$(grep -v '^[[:space:]]*#' "$RUNNER" | grep -cw 'trap')" "0"
eq "🔴 J13: T-135 를 되돌리면(no_t135) 블록·표지·세 줄만 사라지고 나머지 줄 수가 맞다" \
   "$(( $(wc -l < "$RUNNER") - $(no_t135 < "$RUNNER" | wc -l) ))" "$(( $(printf '%s\n' "$cbk" | wc -l) + 1 ))"
eq "J13: 되돌린 러너에 T-135 흔적 없음(CALL_BODY_FILE 은 jrl_hook 두 줄과 주석뿐)" \
   "$(no_t135 < "$RUNNER" | grep -v '^[[:space:]]*#' | grep -c 'CALL_BODY_FILE\|call_tmp_')" "2"

fi
echo
echo "결과: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
