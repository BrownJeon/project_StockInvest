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
# T-115 — 국내 뉴스 두 번째 수집(news-fetch-domestic-pm, 15:30~15:59 하루 1회)을 더했다. A~E 는 "뉴스 외 호출 = 변경 전(bf8450d)"을
#   그대로 증명한다(새 잡도 경로가 /api/cron/news-fetch 라 뉴스로 분류돼 비교에서 빠진다). 새 잡 때문에 기대값이 달라진 곳(D 하루 뉴스 목록,
#   E 의 블록 제거·호출 줄 개수)은 그 자리에 이유를 적었다. 새 시나리오 F 는 T-103 러너(git show $T115_BASE_REF:scripts/cron-runner.sh,
#   기본 5d4fdd1 = T-115 착수 기준)와 비교해 **새 잡을 뺀 모든 호출(06시 뉴스 포함)이 T-103 과 완전히 같음**을 증명한다.
#  F. 15:29 에는 안 돎 · 15:30 에 하루 1회 · 502 여도 하루 1회 · 다음 날 다시 1회 · 16:00 이후 늦게 시작하면 안 돎(건너뜀 로그 하루 1줄) ·
#     15:59 시작이면 15:59 1회 · 이미 돈 날 재기동이면 안 돎(로그 없음) · 느린 M4 하트비트 < 300초 · 하루 전체 = T-103 + 15:30 1건 · 정적
# T-116 — 뉴스 최초 관측 캡처 peek 블록(news-fetch-peek, ?mode=peek)이 생겼다. 이 파일의 시나리오는 06시·15:30 ingest 만 다루므로
#   peek 호출(경로에 mode=peek)은 뉴스 목록·비교에서 빼고(news·nopm), 정적 비교는 peek 블록도 뉴스 블록처럼 뺀다. peek 자체의 시험과
#   "peek 를 뺀 모든 호출 = T-115 러너" 증명은 scripts/test-cron-runner-news-peek.sh 가 한다.
# T-117 — 일봉 정기 증분 수집 블록(daily-bars-daily, 07:40~07:54 하루 1회, --max-time 120)이 생겼다. 이 파일의 비교(D·F 하루 전체 호출,
#   --max-time 목록, E·F7 정적)는 변경 전 러너(bf8450d·5d4fdd1)와 대조하므로 daily-bars 호출·블록·DAILY_BARS_* 선언을 peek 처럼 뺀다
#   (범위 정교화 — 뉴스 쪽 기대값은 그대로). daily-bars 자체의 시험과 "daily-bars 를 뺀 모든 호출 = T-116 러너" 증명은
#   scripts/test-cron-runner-daily-bars.sh 가 한다.
# T-118 — peek 가 해외 매시(06·07·08·15·16시 제외)로 늘고 peek 호출에만 curl --max-time 40 이 붙었다. 이 파일의 시나리오 A·C 는 05:58 에
#   시작해 05시 해외 peek 가 끼므로 ① curl 스텁이 --max-time 을 지킨다(응답이 상한보다 늦으면 상한만큼만 흐르고 000 — 실제 curl 과 같다.
#   ingest 호출에는 상한이 없어 그 동작은 전과 같다) ② "뉴스 호출에 --max-time 없음" 단언은 ingest 호출(경로에 mode=peek 없음)로 좁힌다.
#   peek 의 상한·시각은 scripts/test-cron-runner-news-peek.sh 가 본다. ingest 기대값은 하나도 바꾸지 않았다.
# T-119 — 보유 종목 개장 전 공시 블록(holdings-premarket, ET 08시 평일 — KST 21시 EDT / 22시 EST)이 생겼다. 이 파일의 시나리오와 무관한 잡이라
#   그 호출(경로 /api/cron/holdings-premarket)은 비교·--max-time 목록에서 빼고, 정적 비교는 그 블록·선언(HOLDINGS_PREMARKET_*)도 뺀다.
#   기대값은 바꾸지 않았다(범위만 정교화). holdings-premarket 자체의 시험과 "그 호출을 뺀 모든 호출 = 기준 러너" 증명은
#   scripts/test-cron-runner-holdings-premarket.sh 가 한다.
# T-170 — 국내 일봉 저녁 블록(daily-bars-daily-kr, 18:10~18:54 하루 1회, 경로 /api/cron/daily-bars?market=KR, --max-time 120)이 생겼다.
#   07:40 daily-bars 처럼 그 호출(경로 ' /api/cron/daily-bars?market=KR')을 비교·--max-time 목록에서 뺀다. 정적 비교는 블록 표지
#   daily-bars-daily-kr 이 기존 접두 정규식(daily-bars-daily)에, 선언 DAILY_BARS_KR_* 가 '^DAILY_BARS_' 에 이미 걸려 함께 빠진다.
#   기대값은 바꾸지 않았다(범위만 정교화). 그 블록 자체의 시험은 scripts/test-cron-runner-daily-bars-kr.sh 가 한다.
# T-156·T-160 (T-171) — T-156(m40 모의 평가)이 블록 m40-forward-daily·m40-forecast-daily·m40-state-write·선언 M40_FORWARD_LAST_RUN_FILE·
#   call() 분기 2줄과 호출(call() 경유 /api/cron/m40-forward·m40-forecast + call() 밖 상태 확인 curl ?status=1)을, T-160 이 call() 두 줄을
#   바꾸고 이 시험의 비교 범위를 넓히지 않아 D·E·F6·F7 이 어긋났다(T-171 판정: 시험 낡음). 그 호출은 비교·--max-time 목록에서 빼고(others·nopm·
#   M40MT), 정적 비교는 그 블록·선언·분기를 빼고 T-160 줄을 되돌린다(아래 T-171 도우미). 뉴스 기대값은 바꾸지 않았다(범위만 정교화).
# 외부 호출 없음(curl 은 스텁), 실제 HOME·.env 를 읽지 않음(임시 디렉터리).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="${T103_RUNNER:-$HERE/cron-runner.sh}"   # 변이 시험용 덮어쓰기(기본 = 이 저장소의 러너)
BASE_REF="${T103_BASE_REF:-bf8450d}"
T115_REF="${T115_BASE_REF:-5d4fdd1}"   # (T-115) T-103 러너 = 이번 변경 직전
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
#   빼거나 되돌리는 줄이 엉뚱한 곳에 생기면 범위가 무검사로 넓어지므로 정적 절(E)이 그 줄들이 파일 전체에 각 1개(모두 call() 안)인지 따로 단언한다.
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
  echo "변경 전 러너($BASE_REF:scripts/cron-runner.sh)를 읽지 못함 — 비교 시험을 할 수 없다(T103_BASE_REF 로 지정 가능)"
  exit 1
fi

BEFORE115="$W/runner-t103.sh"
if ! git -C "$HERE/.." show "$T115_REF:scripts/cron-runner.sh" > "$BEFORE115" 2>/dev/null || [ ! -s "$BEFORE115" ]; then
  echo "T-103 러너($T115_REF:scripts/cron-runner.sh)를 읽지 못함 — 시나리오 F 비교를 할 수 없다(T115_BASE_REF 로 지정 가능)"
  exit 1
fi

ep() { TZ=Asia/Seoul "$REAL_DATE" -d "$1" +%s; }

# run_loop NAME RUNNER START TICKS NEWS_MODE [JUMP_AT JUMP_TO [SEED]]
#  NEWS_MODE: ok(200) | fail(502) | slow(시장당 186초 흐른 뒤 200)
#  JUMP_AT/JUMP_TO: sleep 이 시계를 JUMP_AT 이상으로 밀면 한 번 JUMP_TO 로 옮긴다(다음 날로 건너뛰기)
#  SEED(T-115): "날짜파일이름=내용" — 러너 시작 전에 ~/.node-local/stockinvest/ 에 미리 써 둔다(재기동 흉내). 비우면 없음.
# 호출 기록 한 줄: "MM-DD HH:MM 틱번호 경로"
run_loop() {
  local name="$1" runner="$2" start="$3" ticks="$4" mode="$5" jat="${6:-0}" jto="${7:-0}" seed="${8:-}" R="$W/$1"
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
# (T-112) 실행·상태 기록 전송(POST /api/cron/job-run-log — 러너 틱 끝, call() 밖)은 이 시험의 대상이 아니다: 호출·--max-time 목록과 시계에
#   넣지 않고 200 으로 답한다(받은 줄은 버림). 전송·후크 자체와 "후크가 켜져도 다른 호출 = 기준 러너"는 scripts/test-cron-runner-job-run-log.sh 가 본다.
[ "\$path" = "/api/cron/job-run-log" ] && { printf '200'; exit 0; }
echo "\$("$REAL_DATE" -d "@\$(cat "$R/clock")" '+%m-%d %H:%M') \$(cat "$R/ticks" 2>/dev/null || echo 0) \$path" >> "$R/calls"
[ -n "\$mt" ] && echo "\$path max-time=\$mt" >> "$R/maxtime"
code=200
case "\$path" in
  /api/cron/news-fetch*)
    case "$mode" in
      fail) code=502 ;;
      slow) took=186
            if [ -n "\$mt" ] && [ "\$took" -gt "\$mt" ]; then took=\$mt; code=000; fi   # (T-118) curl 상한을 지킨다(peek 만 상한이 있다)
            c=\$(cat "$R/clock"); echo \$((c + took)) > "$R/clock" ;;
    esac ;;
esac
[ -n "\$out" ] && echo '{}' > "\$out"
printf '%s' "\$code"
EOF
  chmod +x "$R/bin/date" "$R/bin/sleep" "$R/bin/curl"
  : > "$R/calls"; : > "$R/maxtime"
  # (T-147) ALERT_TICKER_DISABLE=1 = 레거시 모드(티커 자식 없음 · 메인 루프가 매 틱 stop-alert 호출 · 하트비트 추가 쓰기 없음)
  #   = **T-147 이전 동작**. 이 하네스는 자기 잡의 회귀망이고 기대값(일정·호출 목록·하트비트 간격)이 그 동작 기준이므로 그대로 쓴다.
  #   기본 모드(티커가 분 경계마다 부르고 죽으면 메인 루프가 이어받는다)는 scripts/test-cron-runner-alert-ticker.sh 가 본다.
  PATH="$R/bin:$PATH" HOME="$R/home" PROJECT_DIR="$R/proj" BASE_URL="http://stub" TZ=Asia/Seoul ALERT_TICKER_DISABLE=1 \
    timeout 600 bash "$runner" > "$R/stdout" 2>&1
  echo "$R"
}

news()   { grep ' /api/cron/news-fetch' "$1/calls" | grep -v 'mode=peek'; }   # (T-116) peek 제외
others() { grep -v ' /api/cron/news-fetch' "$1/calls" | grep -v ' /api/cron/daily-bars$' | grep -v ' /api/cron/daily-bars?market=KR$' | grep -v ' /api/cron/holdings-premarket$' | grep -v ' /api/cron/kis-fundamentals-snapshot$' | grep -vE "$M40RE" | awk '{print $1, $2, $4}'; }   # (T-117 daily-bars·T-119 holdings-premarket·T-145 ⑨ kis-fundamentals-snapshot·T-171 m40 3경로) 제외
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
  eq "$n: 뉴스(ingest) 호출에는 --max-time 없음" "$(grep '^/api/cron/news-fetch' "$R/maxtime" | grep -vc 'mode=peek')" "0"   # (T-118) peek 상한은 peek 시험이 본다
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
# (T-115) 새 잡 news-fetch-domestic-pm 이 15:30 에 국내를 한 번 더 부른다 — 기대값에 "15:30 국내" 1건이 늘었다(06시 두 건은 그대로).
eq "D: 하루 뉴스 = 해외 06:00 · 국내 06:01 · (T-115) 국내 15:30" "$(news "$NA" | awk '{print $2, $4}' | tr '\n' ' ')" \
   "06:00 /api/cron/news-fetch?market=overseas 06:01 /api/cron/news-fetch?market=domestic 15:30 /api/cron/news-fetch?market=domestic "
eq "D: 변경 전 하루 뉴스 = 06:00 1회" "$(news "$BA" | awk '{print $2, $4}' | tr '\n' ' ')" "06:00 /api/cron/news-fetch "
if diff <(grep -v '^/api/cron/news-fetch' "$NA/maxtime" | grep -v '^/api/cron/daily-bars ' | grep -v '^/api/cron/daily-bars?market=KR ' | grep -v '^/api/cron/holdings-premarket ' | grep -v '^/api/cron/kis-fundamentals-snapshot ' | grep -vE "$M40MT") <(grep -v '^/api/cron/news-fetch' "$BA/maxtime") > /dev/null; then ok "D: --max-time 붙는 호출 목록 = 변경 전(T-117 daily-bars·T-119 holdings-premarket·T-145 ⑨ 스냅샷 제외)"; else bad "D: --max-time 목록이 다르다"; fi

# ── E. 정적 ───────────────────────────────────────────────────────────────────────
echo "E. 정적"
eq "bash -n" "$(bash -n "$RUNNER" 2>&1 && echo ok)" "ok"
# 뉴스 블록(새: >>> news-fetch-split ~ <<<, 옛: '# 매일 06:00 KST: M4 KB 뉴스 fetch' ~ 다음 '  fi')·NEWS_FETCH_* 선언·주석·빈 줄을 뺀 나머지
# (T-115) 새 뉴스 블록 news-fetch-domestic-pm 도 뉴스 블록이라 같이 뺀다(선언 NEWS_FETCH_DOMESTIC_PM_* 는 아래 '^NEWS_FETCH_' 가 뺀다).
#   그 블록이 바꾼 것이 없는지는 F 의 정적 비교(T-103 러너 대비)가 따로 본다.
# (T-117) daily-bars-daily·(T-119) holdings-premarket 블록과 DAILY_BARS_*·HOLDINGS_PREMARKET_* 선언도 뺀다(그 블록 밖이 바뀌지 않았는지는 test-cron-runner-daily-bars.sh D6 가 T-116 러너 대비로 본다).
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
strip_new() { no_t147 < "$1" | awk '/^  # >>> (news-fetch-(split|domestic-pm|peek)|daily-bars-daily|holdings-premarket|overseas-universe-refresh|kis-fundamentals-snapshot)/{s=1} s{ if (/^  # <<< (news-fetch-(split|domestic-pm|peek)|daily-bars-daily|holdings-premarket|overseas-universe-refresh|kis-fundamentals-snapshot)/) s=0; next } {print}' \
  | grep -v '^NEWS_FETCH_' | grep -v '^DAILY_BARS_' | grep -v '^HOLDINGS_PREMARKET_' | grep -v '^UNIVERSE_CURL_MAX_TIME=' | grep -v '^KIS_FUND_' | grep -v '^[[:space:]]*KIS_FUND_TICK_T0=' | grep -v '^[[:space:]]*#' | grep -v '^[[:space:]]*$'; }   # (T-143 병합) overseas-universe-refresh · (T-145 ⑨ kis-fundamentals-snapshot — 일정이 바뀐 잡. 그 일정은 자기 블록의 jest 시뮬레이션 시험이 본다)
strip_old() { no_kf_old < "$1" | no_t147_old | awk '/^  # 매일 06:00 KST: M4 KB 뉴스 fetch/{s=1} s{ if (/^  fi$/) s=0; next } {print}' \
  | grep -v '^NEWS_FETCH_' | grep -v '^[[:space:]]*#' | grep -v '^[[:space:]]*$'; }
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
no_jrl() { awk '/^# >>> job-run-log-spool/{s=1} s{ if (/^# <<< job-run-log-spool/) s=0; next } {print}' "$1" | grep -v '# T-112 jrl$' | no_t135 | no_t160 | no_t172 | no_t156; }
RUNNER_NOJRL="$W/runner-nojrl.sh"; no_jrl "$RUNNER" > "$RUNNER_NOJRL"
if diff <(strip_new "$RUNNER_NOJRL") <(strip_old "$BEFORE") > /dev/null; then ok "🔴 뉴스 블록·선언·주석 밖 실행 줄 = 변경 전과 동일 ($(strip_new "$RUNNER_NOJRL" | wc -l | tr -d ' ')줄)"; else bad "뉴스 밖 실행 줄이 바뀌었다"; diff <(strip_new "$RUNNER_NOJRL") <(strip_old "$BEFORE") | head -10; fi
eq "call() 함수 본문 = 변경 전(T-171: T-160 줄 되돌림 · T-156 분기 2줄 뺌 · T-172: 본문 기본값 두 줄 되돌림)" "$(awk '/^call\(\) \{/,/^\}/' "$RUNNER" | grep -v '# T-112 jrl$' | no_t135 | no_t160 | no_t172 | no_t156_call | sha256sum)" "$(awk '/^call\(\) \{/,/^\}/' "$BEFORE" | sha256sum)"
eq "🔴 E: (T-171) no_t156_call·no_t160 이 노리는 줄 = 파일 전체 각 1개 · 모두 call() 안" "$(t171_targets "$RUNNER")" "1 1 1 1 1 | 1 1 1 1 1"
eq "🔴 E: (T-172) no_t172 가 노리는 두 줄 = 파일 전체 각 1개 · 모두 call() 안 · 옛 줄 0" "$(t172_targets "$RUNNER")" "1 1 0 | 1 1"
# (T-115) 파일 전체로 세면 새 잡의 국내 호출 줄 1개가 더해져 3 이 된다 — 06시 블록(news-fetch-split) 안으로 범위를 좁혀 2 를 본다.
eq "06시 블록의 뉴스 호출 줄 = 시장별 2개" \
   "$(awk '/^  # >>> news-fetch-split/,/^  # <<< news-fetch-split/' "$RUNNER" | grep -c 'call "/api/cron/news-fetch?market=')" "2"
eq "(T-115) 파일 전체 뉴스 호출 줄 = 3(06시 2 + 15:30 국내 1, T-116 peek 줄 제외)" "$(grep 'call "/api/cron/news-fetch?market=' "$RUNNER" | grep -vc 'mode=peek')" "3"
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

# ── F. (T-115) 국내 두 번째 수집 news-fetch-domestic-pm ─────────────────────────────
echo "F. (T-115) 15:30~15:59 국내 두 번째 수집 — T-103 러너($T115_REF)와 비교"
PMRE='^[0-9-]+ 15:[0-9][0-9] [0-9]+ /api/cron/news-fetch\?market=domestic$'
pm()      { grep -E "$PMRE" "$1/calls"; }                                # 새 잡 호출(15시대 국내 뉴스)
nopm()    { grep -vE "$PMRE" "$1/calls" | grep -v 'mode=peek' | grep -v ' /api/cron/daily-bars$' | grep -v ' /api/cron/daily-bars?market=KR$' | grep -v ' /api/cron/holdings-premarket$' | grep -v ' /api/cron/kis-fundamentals-snapshot$' | grep -vE "$M40RE" | awk '{print $1, $2, $4}'; }   # 새 잡을 뺀 모든 호출(뉴스 포함, T-116 peek·T-117 daily-bars·T-119 holdings-premarket·T-145 ⑨ kis-fundamentals-snapshot·T-171 m40 3경로 제외)
allc()    { awk '{print $1, $2, $4}' "$1/calls"; }
# (T-145 ⑨) 기준 러너 쪽에서도 kis-fundamentals-snapshot 을 뺀다(새 러너 쪽은 nopm·others 가 이미 뺀다)
allc_nokf() { grep -v ' /api/cron/kis-fundamentals-snapshot$' "$1/calls" | awk '{print $1, $2, $4}'; }
pmat()    { pm "$1" | awk '{print $1, $2}' | tr '\n' ' '; }
skiplog() { grep -c 'news-fetch-domestic-pm skipped' "$1/stdout"; }
same115() {   # same115 라벨 새러너결과 옛러너결과 — 새 잡을 뺀 호출 목록이 T-103 러너와 완전히 같은가
  if diff <(nopm "$2") <(allc_nokf "$3") > /dev/null; then ok "🔴 $1: 새 잡을 뺀 모든 호출(뉴스 포함) = T-103 러너 ($(nopm "$2" | wc -l | tr -d ' ')건)"
  else bad "$1: 새 잡을 뺀 호출 목록이 T-103 러너와 다르다"; diff <(nopm "$2") <(allc_nokf "$3") | head -10; fi
}

# F1. 15:28~15:35 × 이틀(각 8틱, 15:36 에 다음 날 15:28 로 건너뜀) — 200 과 502
FJA=$(ep "2026-10-28 15:36:00"); FJT=$(ep "2026-10-29 15:28:00")
FO="$(run_loop f-new-ok   "$RUNNER"    "2026-10-28 15:28:00" 16 ok   "$FJA" "$FJT")"
FF="$(run_loop f-new-fail "$RUNNER"    "2026-10-28 15:28:00" 16 fail "$FJA" "$FJT")"
GO="$(run_loop f-old-ok   "$BEFORE115" "2026-10-28 15:28:00" 16 ok   "$FJA" "$FJT")"
GF="$(run_loop f-old-fail "$BEFORE115" "2026-10-28 15:28:00" 16 fail "$FJA" "$FJT")"
for R in "$FO" "$FF" "$GO" "$GF"; do eq "$(basename "$R"): 16틱 완주" "$(cat "$R/ticks")" "16"; done
eq "(하네스 확인) T-103 러너: 15시대 뉴스 호출 없음" "$(news "$GO" | wc -l | tr -d ' ')" "0"
for R in "$FO" "$FF"; do
  n="$(basename "$R")"
  eq "🔴 $n: 국내 두 번째 수집 = 날마다 15:30 정확히 1회(15:29 에는 안 돎)" "$(pmat "$R")" "10-28 15:30 10-29 15:30 "
  eq "🔴 $n: 뉴스 호출은 새 잡뿐(해외·06시 국내 없음)" "$(news "$R" | wc -l | tr -d ' ')" "2"
  eq "$n: 한 틱에 뉴스 호출은 최대 1회" "$(maxper "$R")" "1"
  eq "$n: 새 날짜파일 = 둘째 날" "$(df "$R" news-fetch-domestic-pm-last-date)" "2026-10-29"
  eq "🔴 $n: 06시 국내 날짜파일은 건드리지 않음" "$(df "$R" news-fetch-domestic-last-date)" "none"
  eq "$n: 해외 날짜파일도 건드리지 않음" "$(df "$R" news-fetch-overseas-last-date)" "none"
  eq "$n: 새 잡 호출에는 --max-time 없음" "$(grep -c '^/api/cron/news-fetch' "$R/maxtime")" "0"
  eq "$n: 건너뜀 로그 없음(15시대에 돌았음)" "$(skiplog "$R")" "0"
done
eq "ok: 새 잡 OK 로그 2줄(라벨 news-fetch-domestic-pm)" "$(grep -c 'news-fetch-domestic-pm OK' "$FO/stdout")" "2"
eq "🔴 fail(502): 새 잡 실패 로그 2줄(같은 날 재호출 없음)" "$(grep -c 'news-fetch-domestic-pm HTTP=502' "$FF/stdout")" "2"
same115 "F1 ok" "$FO" "$GO"
same115 "F1 fail" "$FF" "$GF"

# F2. 16:00 이후 늦게 시작(첫날 16:00~16:03, 다음 날 16:30~16:33 — 분 ≥ 30 이어도 16시면 안 돎) — 호출 없음, 건너뜀 로그 하루 1줄
FL="$(run_loop f-new-late "$RUNNER"    "2026-10-28 16:00:00" 8 ok "$(ep '2026-10-28 16:04:00')" "$(ep '2026-10-29 16:30:00')")"
GL="$(run_loop f-old-late "$BEFORE115" "2026-10-28 16:00:00" 8 ok "$(ep '2026-10-28 16:04:00')" "$(ep '2026-10-29 16:30:00')")"
eq "F2: 8틱 완주" "$(cat "$FL/ticks")" "8"
eq "🔴 F2: 16:00 이후 시작이면 새 잡 호출 없음" "$(pm "$FL" | wc -l | tr -d ' ')" "0"
eq "F2: 뉴스 호출 없음" "$(news "$FL" | wc -l | tr -d ' ')" "0"
eq "🔴 F2: 건너뜀 로그 = 날마다 1줄(4틱씩 돌아도)" "$(skiplog "$FL")" "2"
grep -q '2026-10-28 16:00:00\] news-fetch-domestic-pm skipped' "$FL/stdout" && ok "F2: 첫날 건너뜀 로그 시각 16:00" || bad "F2: 첫날 16:00 건너뜀 로그 없음"
eq "F2: 건너뛴 날은 날짜파일을 쓰지 않음" "$(df "$FL" news-fetch-domestic-pm-last-date)" "none"
grep -q '2026-10-29 16:30:00\] news-fetch-domestic-pm skipped' "$FL/stdout" && ok "F2: 다음 날 건너뜀 로그 시각 16:30" || bad "F2: 다음 날 16:30 건너뜀 로그 없음"
eq "(하네스 확인) F2: post-market-domestic 은 그대로 돈다(16:00 · 16:30 첫 틱)" "$(grep -cE ' 16:(00|30) [0-9]+ /api/cron/post-market-analysis\?market=domestic$' "$FL/calls")" "2"
same115 "F2" "$FL" "$GL"

# F3. 15:59 시작 — 창의 마지막 분이라 1회
FE="$(run_loop f-new-1559 "$RUNNER" "2026-10-28 15:59:00" 3 ok)"
eq "🔴 F3: 15:59 시작 → 15:59 1회, 16시 틱에는 안 돎" "$(pmat "$FE")" "10-28 15:59 "
eq "F3: 건너뜀 로그 없음" "$(skiplog "$FE")" "0"

# F4. 재기동 — 오늘 이미 돈 날(날짜파일 = 오늘) 15:45 에 다시 시작해 16:04 까지
FR="$(run_loop f-new-restart "$RUNNER" "2026-10-28 15:45:00" 20 ok 0 0 "news-fetch-domestic-pm-last-date=2026-10-28")"
eq "F4: 20틱 완주" "$(cat "$FR/ticks")" "20"
eq "🔴 F4: 오늘 이미 돈 날 재기동 → 새 잡 호출 없음" "$(pm "$FR" | wc -l | tr -d ' ')" "0"
eq "F4: 건너뜀 로그 없음(이미 돌았음)" "$(skiplog "$FR")" "0"
FY="$(run_loop f-new-restart-y "$RUNNER" "2026-10-28 15:45:00" 3 ok 0 0 "news-fetch-domestic-pm-last-date=2026-10-27")"
eq "F4: 날짜파일이 어제면 15:45 첫 틱에 1회" "$(pmat "$FY")" "10-28 15:45 "

# F5. 느린 M4(뉴스 호출마다 186초) — 15:29 시작
FS="$(run_loop f-new-slow "$RUNNER" "2026-10-28 15:29:00" 6 slow)"
eq "F5: 6틱 완주" "$(cat "$FS/ticks")" "6"
eq "F5: 느려도 15:30 1회" "$(pmat "$FS")" "10-28 15:30 "
g="$(gap "$FS")"
if [ "$g" -lt 300 ]; then ok "🔴 F5: 하트비트 간격 최대 ${g}초 < 300초(워치독 한도)"; else bad "F5: 하트비트 간격 ${g}초 ≥ 300"; fi
eq "F5: 최대 간격 = 186 + 60" "$g" "246"
# 15:59 시작 + 느린 M4 — 호출이 16:02 에 끝나 다음 틱이 16:03 이라 16시 잡이 16:03 에 돈다(알려진 가장자리, Developer 기록 참고)
FS2="$(run_loop f-new-slow-1559 "$RUNNER" "2026-10-28 15:59:00" 3 slow)"
eq "F5: 15:59 시작 + 느린 M4 → 새 잡 15:59 · post-market-domestic 은 다음 틱 16:03(같은 틱에 겹치지 않음)" \
   "$(grep -E 'news-fetch\?market=domestic$|post-market-analysis\?market=domestic$' "$FS2/calls" | awk '{print $2, $4}' | tr '\n' ' ')" \
   "15:59 /api/cron/news-fetch?market=domestic 16:03 /api/cron/post-market-analysis?market=domestic "

# F6. 하루 전체 1440틱 — T-103 러너 대비 차이는 15:30 국내 1건뿐
GA="$(run_loop f-old-day "$BEFORE115" "2026-10-28 00:00:00" 1440 ok)"
eq "F6: T-103 러너 1440틱 완주" "$(cat "$GA/ticks")" "1440"
eq "🔴 F6: 새 잡 = 하루 15:30 1회" "$(pmat "$NA")" "10-28 15:30 "
same115 "F6 하루 전체" "$NA" "$GA"
eq "F6: 하루 전체에서 건너뜀 로그 없음" "$(skiplog "$NA")" "0"
eq "F6: 날짜파일 — 06시 국내·15시 국내 모두 오늘" "$(df "$NA" news-fetch-domestic-last-date) $(df "$NA" news-fetch-domestic-pm-last-date)" "2026-10-28 2026-10-28"
if diff <(grep -v '^/api/cron/news-fetch' "$NA/maxtime" | grep -v '^/api/cron/daily-bars ' | grep -v '^/api/cron/daily-bars?market=KR ' | grep -v '^/api/cron/holdings-premarket ' | grep -v '^/api/cron/kis-fundamentals-snapshot ' | grep -vE "$M40MT") <(grep -v '^/api/cron/news-fetch' "$GA/maxtime") > /dev/null && \
   [ "$(grep '^/api/cron/news-fetch' "$NA/maxtime" | grep -vc 'mode=peek')" = "0" ]; then ok "F6: --max-time 목록 = T-103 러너(뉴스 ingest 에는 없음 — T-118 peek 상한은 peek 시험)"; else bad "F6: --max-time 목록이 다르다"; fi

# F7. 정적 — 새 블록·선언·주석을 빼면 T-103 러너와 실행 줄이 한 글자도 같다
strip115() { no_t147 < "$1" | awk '/^  # >>> (news-fetch-(domestic-pm|peek)|daily-bars-daily|holdings-premarket|overseas-universe-refresh|kis-fundamentals-snapshot)/{s=1} s{ if (/^  # <<< (news-fetch-(domestic-pm|peek)|daily-bars-daily|holdings-premarket|overseas-universe-refresh|kis-fundamentals-snapshot)/) s=0; next } {print}' \
  | grep -v '^NEWS_FETCH_DOMESTIC_PM_' | grep -v '^DAILY_BARS_' | grep -v '^HOLDINGS_PREMARKET_' | grep -v '^UNIVERSE_CURL_MAX_TIME=' | grep -v '^KIS_FUND_' | grep -v '^[[:space:]]*KIS_FUND_TICK_T0=' | grep -v '^[[:space:]]*#' | grep -v '^[[:space:]]*$'; }   # (T-117 daily-bars·T-119 holdings-premarket·T-143 overseas-universe-refresh·T-145 ⑨ 스냅샷) 블록·선언 제외
strip103() { no_kf_old < "$1" | no_t147_old | grep -v '^[[:space:]]*#' | grep -v '^[[:space:]]*$'; }
if diff <(strip115 "$RUNNER_NOJRL") <(strip103 "$BEFORE115") > /dev/null; then ok "🔴 F7: 새 블록·선언·주석 밖 실행 줄 = T-103 러너 ($(strip115 "$RUNNER_NOJRL" | wc -l | tr -d ' ')줄)"; else bad "F7: 새 블록 밖 실행 줄이 T-103 과 다르다"; diff <(strip115 "$RUNNER_NOJRL") <(strip103 "$BEFORE115") | head -10; fi
nb="$(awk '/^  # >>> news-fetch-domestic-pm/,/^  # <<< news-fetch-domestic-pm/' "$RUNNER")"
eq "F7: 새 블록 표지 >>>/<<< 각 1개" "$(grep -c '^  # >>> news-fetch-domestic-pm' "$RUNNER") $(grep -c '^  # <<< news-fetch-domestic-pm' "$RUNNER")" "1 1"
eq "F7: 새 블록 호출 줄 = 국내 1개(라벨 news-fetch-domestic-pm)" "$(printf '%s\n' "$nb" | grep -c '^    call "/api/cron/news-fetch?market=domestic" "news-fetch-domestic-pm"$')" "1"
eq "F7: 새 블록 안 호출 줄 총 1개" "$(printf '%s\n' "$nb" | grep -c 'call ')" "1"
if printf '%s\n' "$nb" | grep -q '^  if \[ "\$HH" = "15" \] && \[ "\$NFP_MM" -ge 30 \] && \[ "\$LAST_NEWS_DOM_PM" != "\$TODAY" \]; then$'; then
  ok "F7: 조건 = HH 15 · 분 ≥ 30 · 오늘 아직 안 돎"; else bad "F7: 호출 조건 줄이 사양과 다르다"; fi
eq "F7: 새 블록은 06시 블록 뒤" "$([ "$(grep -n '^  # >>> news-fetch-domestic-pm' "$RUNNER" | cut -d: -f1)" -gt "$(grep -n '^  # <<< news-fetch-split' "$RUNNER" | cut -d: -f1)" ] && echo yes || echo no)" "yes"
eq "F7: 날짜파일 선언 1개(news-fetch-domestic-pm-last-date)" "$(grep -c '^NEWS_FETCH_DOMESTIC_PM_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/news-fetch-domestic-pm-last-date"' "$RUNNER")" "1"
eq "F7: 상단 잡 목록 주석에 새 잡" "$(sed -n '1,40p' "$RUNNER" | grep -c '^#  - news-fetch-domestic-pm:')" "1"

echo
echo "결과: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
