#!/usr/bin/env bash
# T-062 S-2b — cron-runner.sh 의 해외 post-market 제한 재시도 시험.
#
# 실행: bash scripts/test-cron-runner-pmo-retry.sh   (NFS noexec 경로라 반드시 bash 경유)
#
# 두 층으로 본다.
#  A. 단위: `# >>> post-market-overseas-retry` 블록만 잘라 pmo_due / pmo_record 를 가짜 시각으로 시험
#  B. 통합: cron-runner.sh 를 **그대로** 돌린다 — curl·date·sleep 만 가짜(PATH 앞에 둔 스텁)로 바꿔 07:58~09:57 KST 120틱을
#     흉내 내고, 호출된 경로를 센다. 해외 post-market 이 실패(502)여도 하루 3회를 넘지 않고, 성공(200)이면 1회이며,
#     **다른 잡의 호출 목록은 두 경우에 완전히 같다**(이 변경이 다른 잡에 영향을 주지 않음).
# 외부 호출 없음(curl 은 스텁), 실제 HOME·.env 를 읽지 않음(임시 디렉터리).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="$HERE/cron-runner.sh"
REAL_DATE="$(command -v date)"
PASS=0; FAIL=0
ok()   { PASS=$((PASS + 1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
eq()   { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (기대 '$3', 실제 '$2')"; fi; }

W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT

# ── A. 단위 ──────────────────────────────────────────────────────────────────
echo "A. pmo_due / pmo_record"
BLOCK="$(awk '/^# >>> post-market-overseas-retry/{f=1} f{print} /^# <<< post-market-overseas-retry/{f=0}' "$RUNNER")"
[ -n "$BLOCK" ] || { echo "블록을 찾지 못함"; exit 1; }
eval "$BLOCK"
eq "상한 3회" "$PMO_MAX_ATTEMPTS" "3"
eq "간격 600초" "$PMO_MIN_INTERVAL_SEC" "600"
eq "해외 호출 curl 상한 120초" "$PMO_CURL_MAX_TIME" "120"

D="2026-10-21"; DONE="$W/a/done"; ATT="$W/a/att"; mkdir -p "$W/a"
T0=1792537200   # 임의 기준 epoch
due() { if pmo_due "$D" "$1" "$DONE" "$ATT"; then echo yes; else echo no; fi; }
attempt() { pmo_reserve "$D" "$1" "$DONE" "$ATT" && pmo_finish "$D" "$1" "$2" "$DONE" "$ATT"; }   # 시작=종료 시각

eq "기록 없음 → 부른다" "$(due $T0)" "yes"
attempt "$T0" 502
eq "502 뒤 날짜파일 없음" "$(cat "$DONE" 2>/dev/null || echo none)" "none"
eq "502 뒤 시도 1" "$(cat "$ATT")" "$D 1 $T0"
eq "59초 뒤 → 부르지 않음(간격)" "$(due $((T0 + 59)))" "no"
eq "599초 뒤 → 부르지 않음" "$(due $((T0 + 599)))" "no"
eq "600초 뒤 → 부른다" "$(due $((T0 + 600)))" "yes"
attempt "$((T0 + 600))" 000
eq "000(연결 실패)도 실패로 센다 — 시도 2" "$(cut -d' ' -f2 "$ATT")" "2"
attempt "$((T0 + 1200))" 503 >/dev/null
eq "503(데이터 일시 모름)도 실패로 센다 — 시도 3" "$(cut -d' ' -f2 "$ATT")" "3"
eq "3회 뒤 → 1시간이 지나도 부르지 않음" "$(due $((T0 + 4800)))" "no"
eq "3회 실패해도 날짜파일은 쓰지 않는다(성공 표시 아님)" "$(cat "$DONE" 2>/dev/null || echo none)" "none"
eq "다음 날 → 다시 부른다" "$(pmo_due 2026-10-22 $((T0 + 86400)) "$DONE" "$ATT" && echo yes || echo no)" "yes"

rm -f "$DONE" "$ATT"
attempt "$T0" 200
eq "200 → 날짜파일 기록" "$(cat "$DONE")" "$D"
eq "200 뒤 → 부르지 않음" "$(due $((T0 + 3000)))" "no"

rm -f "$DONE" "$ATT"
attempt "$T0" 502; attempt "$((T0 + 700))" 200
eq "실패 1회 뒤 성공 → 날짜파일" "$(cat "$DONE")" "$D"

# 🔴 M-1 — 시도는 호출 전에 센다: reserve 뒤 finish 없이 러너가 죽은 경우
rm -f "$DONE" "$ATT"
pmo_reserve "$D" "$T0" "$DONE" "$ATT"
eq "🔴 reserve 만 하고 중단 → 시도 1 이 이미 기록됨(시작 시각)" "$(cat "$ATT")" "$D 1 $T0"
eq "🔴 중단 직후 새 러너 → 같은 시각에 다시 부르지 않음" "$(due "$T0")" "no"
eq "🔴 중단 후 599초 → 부르지 않음" "$(due $((T0 + 599)))" "no"
eq "중단 후 600초 → 부른다(간격은 시작 시각 기준)" "$(due $((T0 + 600)))" "yes"
pmo_reserve "$D" "$((T0 + 600))" "$DONE" "$ATT"; pmo_reserve "$D" "$((T0 + 1200))" "$DONE" "$ATT"
eq "🔴 중단이 3번 반복돼도 3회에서 멈춘다" "$(due $((T0 + 9999)))" "no"
rm -f "$DONE" "$ATT"
pmo_reserve "$D" "$T0" "$DONE" "$ATT"; pmo_finish "$D" "$((T0 + 300))" 502 "$DONE" "$ATT"
eq "정상 종료하면 간격은 종료 시각부터(시작+600 은 아직 아님)" "$(due $((T0 + 600)))" "no"
eq "종료+600 → 부른다" "$(due $((T0 + 900)))" "yes"

# 🔴 Reviewer L-6 — 러너 두 개가 같은 기록을 보고 둘 다 pmo_due=yes 여도 늦은 reserve 는 거부된다
rm -f "$DONE" "$ATT"
eq "겹침: 러너 A due" "$(due "$T0")" "yes"
eq "겹침: 러너 B due(같은 기록을 봄)" "$(due "$T0")" "yes"
pmo_reserve "$D" "$T0" "$DONE" "$ATT" && ra=call || ra=skip
pmo_reserve "$D" "$T0" "$DONE" "$ATT" && rb=call || rb=skip
eq "🔴 겹침: 먼저 reserve 한 러너만 부른다" "$ra $rb" "call skip"
eq "겹침: 시도 기록은 1회" "$(cut -d' ' -f2 "$ATT")" "1"
printf '%s 3 %s\n' "$D" "$T0" > "$ATT"
pmo_reserve "$D" "$((T0 + 9999))" "$DONE" "$ATT" && r=call || r=skip
eq "🔴 reserve 도 3회 상한을 다시 확인한다" "$r" "skip"
eq "(상한 거부 시 기록 불변)" "$(cat "$ATT")" "$D 3 $T0"

# 🔴 Reviewer L-5 — n 만 깨진 기록(last 는 정상)
rm -f "$DONE"; printf '%s x %s\n' "$D" "$T0" > "$ATT"
eq "🔴 n 만 손상 → pmo_due 가 부르지 않음" "$(due $((T0 + 9999)))" "no"
pmo_reserve "$D" "$((T0 + 9999))" "$DONE" "$ATT" && r=call || r=skip
eq "🔴 n 만 손상 → reserve 도 거부" "$r" "skip"

rm -f "$DONE"; printf '%s x y\n' "$D" > "$ATT"
eq "손상된 기록(숫자 아님) → 부르지 않음(셀 수 없으면 멈춘다)" "$(due $((T0 + 9999)))" "no"
printf '%s 1\n' "$D" > "$ATT"
eq "필드 누락 → 부르지 않음" "$(due $((T0 + 9999)))" "no"
printf '2026-10-20 3 %s\n' "$T0" > "$ATT"
eq "어제 3회 기록 → 오늘은 새로 센다" "$(due $T0)" "yes"

rm -f "$DONE"
if pmo_reserve "$D" "$T0" "$DONE" "$W/a/없는디렉터리/att" > "$W/a/reserve.log" 2>/dev/null; then r=call; else r=skip; fi
grep -q '시도 기록.*쓸 수 없어 오늘은 호출하지 않음' "$W/a/reserve.log" && ok "기록 실패로 건너뛸 때 로그 한 줄" || bad "기록 실패 로그 없음"
eq "🔴 시도 기록을 못 쓰면 부르지 않는다" "$r" "skip"
eq "시도 기록을 못 쓰면 날짜파일로 그날을 끝낸다(폭주 방지)" "$(cat "$DONE" 2>/dev/null || echo none)" "$D"

# ── B. 통합 — cron-runner.sh 실물을 가짜 시각으로 120틱 ────────────────────────────
echo "B. cron-runner.sh 120틱 (07:58~09:57 KST)"
run_loop() {   # $1 = 해외 post-market 응답 코드, $2 = restart 이면 첫 해외 호출 도중 러너를 강제 종료(SIGKILL)하고 새 러너로 이어 돈다
  local code="$1" mode="${2:-}" R="$W/run-$1${2:+-$2}"
  mkdir -p "$R/bin" "$R/home" "$R/proj"
  printf 'CRON_SECRET=test-secret\n' > "$R/proj/.env"
  # 2026-10-21 07:58:00 KST
  TZ=Asia/Seoul "$REAL_DATE" -d '2026-10-21 07:58:00' +%s > "$R/clock"
  cat > "$R/bin/date" <<EOF
#!/usr/bin/env bash
exec "$REAL_DATE" -d "@\$(cat "$R/clock")" "\$@"
EOF
  cat > "$R/bin/sleep" <<EOF
#!/usr/bin/env bash
c=\$(cat "$R/clock"); echo \$((c + \${1%%[!0-9]*})) > "$R/clock"
n=\$(( \$(cat "$R/ticks" 2>/dev/null || echo 0) + 1 )); echo \$n > "$R/ticks"
if [ \$n -ge 120 ]; then kill -TERM \$PPID; fi
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
echo "\$("$REAL_DATE" -d "@\$(cat "$R/clock")" '+%H:%M') \$path" >> "$R/calls"
[ -n "\$mt" ] && echo "\$path max-time=\$mt" >> "$R/maxtime"
case "\$path" in
  *post-market-analysis?market=overseas*)
    code="$code"
    if [ "$mode" = "restart" ] && [ ! -e "$R/killed" ]; then
      touch "$R/killed"; kill -KILL "\$(cat "$R/pid")"; exit 0   # 호출 도중 러너 사망(응답 전)
    fi
    if [ "$code" = "timeout" ]; then   # curl --max-time 초과 흉내: 상한만큼 시간이 흐르고 000·exit 28
      c=\$(cat "$R/clock"); echo \$((c + \${mt:-0})) > "$R/clock"
      [ -n "\$out" ] && : > "\$out"
      printf '000'; exit 28
    fi ;;
  *) code=200 ;;
esac
[ -n "\$out" ] && echo '{}' > "\$out"
printf '%s' "\$code"
EOF
  chmod +x "$R/bin/date" "$R/bin/sleep" "$R/bin/curl"
  : > "$R/calls"
  if [ "$mode" = "restart" ]; then
    # $! 가 러너 bash 자신이어야 한다(timeout 으로 감싸면 timeout 만 죽고 러너가 살아남아 두 러너가 겹친다)
    PATH="$R/bin:$PATH" HOME="$R/home" PROJECT_DIR="$R/proj" BASE_URL="http://stub" TZ=Asia/Seoul \
      bash "$RUNNER" > "$R/stdout1" 2>&1 &
    local pid=$!
    echo "$pid" > "$R/pid"
    # 안전장치: 강제 종료가 안 되면 30초 뒤 정리. 출력 파이프를 잡지 않게 fd 를 닫고, 끝나면 안의 sleep 까지 확실히 끝낸다(고아 프로세스 0).
    ( sleep 30 & echo $! > "$R/guard.pid"; wait $!; [ -e "$R/guard.cancel" ] || kill -KILL "$pid" 2>/dev/null ) > /dev/null 2>&1 < /dev/null &
    local guard=$! k
    wait "$pid" 2>/dev/null
    touch "$R/guard.cancel"
    for k in $(seq 1 100); do [ -s "$R/guard.pid" ] && break; sleep 0.05; done
    kill "$(cat "$R/guard.pid" 2>/dev/null)" 2>/dev/null
    wait "$guard" 2>/dev/null
    # 같은 HOME·같은 시각에서 새 러너 시작(pm2 restart 흉내)
    PATH="$R/bin:$PATH" HOME="$R/home" PROJECT_DIR="$R/proj" BASE_URL="http://stub" TZ=Asia/Seoul \
      timeout 60 bash "$RUNNER" > "$R/stdout" 2>&1
  else
    PATH="$R/bin:$PATH" HOME="$R/home" PROJECT_DIR="$R/proj" BASE_URL="http://stub" TZ=Asia/Seoul \
      timeout 60 bash "$RUNNER" > "$R/stdout" 2>&1
  fi
  echo "$R"
}
RF="$(run_loop 502)"
RS="$(run_loop 200)"
RU="$(run_loop 503)"   # 휴장·환율·실적 일시 모름(data_unknown)
RT="$(run_loop timeout)"   # curl --max-time 초과(000)
eq "120틱 완주(실패 시나리오)" "$(cat "$RF/ticks")" "120"
eq "120틱 완주(성공 시나리오)" "$(cat "$RS/ticks")" "120"

ovs() { grep -c 'post-market-analysis?market=overseas' "$1/calls"; }
eq "🔴 해외 post-market 502 → 2시간 동안 정확히 3회" "$(ovs "$RF")" "3"
eq "🔴 시도 시각 = 08:00 · 08:10 · 08:20 (10분 간격, 08시 안)" \
   "$(grep 'market=overseas' "$RF/calls" | cut -d' ' -f1 | tr '\n' ' ')" "08:00 08:10 08:20 "
eq "해외 post-market 200 → 1회" "$(ovs "$RS")" "1"
eq "🔴 해외 post-market 503(데이터 일시 모름) → 3회 08:00·08:10·08:20" \
   "$(grep 'market=overseas' "$RU/calls" | cut -d' ' -f1 | tr '\n' ' ')" "08:00 08:10 08:20 "
eq "503 시나리오: 날짜파일 없음" \
   "$(cat "$RU/home/.node-local/stockinvest/post-market-overseas-last-date" 2>/dev/null || echo none)" "none"
if diff <(grep -v 'market=overseas' "$RU/calls") <(grep -v 'market=overseas' "$RS/calls") > /dev/null; then ok "503 시나리오도 다른 잡 호출 목록 동일"; else bad "503 시나리오 다른 잡 호출 목록이 다르다"; fi
eq "502 시나리오: 날짜파일 없음(성공 표시 아님)" \
   "$(cat "$RF/home/.node-local/stockinvest/post-market-overseas-last-date" 2>/dev/null || echo none)" "none"
eq "200 시나리오: 날짜파일 = 오늘" \
   "$(cat "$RS/home/.node-local/stockinvest/post-market-overseas-last-date" 2>/dev/null || echo none)" "2026-10-21"
# (T-068) 매 분 stop-alert 호출은 별도 시험(test-cron-runner-stop-alert.sh)이 본다 — 여기서는 빼고 나머지 잡이 HEAD 와 같은지만 본다.
# (T-087) 07:20 이후 브로커 원장 수집(broker-fills)도 별도 시험(src/app/api/cron/broker-fills/__tests__/cron-runner-block.test.ts)이 본다 — 같은 방식으로 뺀다.
others() { grep -v 'market=overseas' "$1/calls" | grep -v ' /api/cron/stop-alert$' | grep -v ' /api/cron/broker-fills$'; }
# HEAD 7cd47e7 의 cron-runner.sh 를 같은 하네스(07:58~09:57, 120틱)로 돌린 해외 외 호출 목록(305줄 "HH:MM 경로")의 sha256.
# 다른 잡의 시각·조건이 바뀌면 이 값이 달라진다(Reviewer L-1 B07·B10).
HEAD_OTHERS_SHA=5ac28175b82a11f6d570a92e28455c5acb6bbb387d1df8b16f331fb03109babd
if diff <(others "$RF") <(others "$RS") > /dev/null; then ok "🔴 다른 잡 호출 목록이 두 시나리오에서 완전히 같다 ($(others "$RF" | wc -l)건)"; else bad "다른 잡 호출 목록이 다르다"; fi
eq "🔴 다른 잡 호출 목록 = HEAD 고정 목록(200 시나리오, sha256)" "$(others "$RS" | sha256sum | cut -d' ' -f1)" "$HEAD_OTHERS_SHA"
eq "🔴 다른 잡 호출 목록 = HEAD 고정 목록(502 시나리오, sha256)" "$(others "$RF" | sha256sum | cut -d' ' -f1)" "$HEAD_OTHERS_SHA"
RR="$(run_loop 502 restart)"
eq "🔴 M-1 재시작: 첫 해외 호출 도중 러너 강제 종료됨" "$([ -e "$RR/killed" ] && echo yes || echo no)" "yes"
eq "🔴 M-1 재시작: 새 러너는 곧바로 다시 부르지 않고 08:00(중단)·08:10·08:20 — 하루 3회 절대 상한" \
   "$(grep 'market=overseas' "$RR/calls" | cut -d' ' -f1 | tr '\n' ' ')" "08:00 08:10 08:20 "
eq "M-1 재시작: 시도 기록 3회" "$(cut -d' ' -f2 "$RR/home/.node-local/stockinvest/post-market-overseas-attempts")" "3"
eq "M-1 재시작: 날짜파일 없음" \
   "$(cat "$RR/home/.node-local/stockinvest/post-market-overseas-last-date" 2>/dev/null || echo none)" "none"
# 🔴 Codex C2 ② — --max-time 은 해외 post-market 호출에만, 값 120
# (T-068) stop-alert 의 --max-time(20)은 test-cron-runner-stop-alert.sh 가 따로 본다 — 여기서는 그 줄을 빼고 해외 post-market 만 본다.
# (T-087) broker-fills 의 --max-time(90)도 그 블록 시험이 따로 본다 — 여기서는 뺀다.
pmo_mt() { grep -v '^/api/cron/stop-alert ' "$1/maxtime" | grep -v '^/api/cron/broker-fills '; }
eq "🔴 --max-time 은 (stop-alert 외) 해외 post-market 호출에만(200 시나리오)" "$(pmo_mt "$RS" | cut -d' ' -f1 | sort -u)" "/api/cron/post-market-analysis?market=overseas"
eq "--max-time 값 120" "$(pmo_mt "$RS" | cut -d' ' -f2 | sort -u)" "max-time=120"
eq "--max-time 이 붙은 호출 수 = 해외 호출 수(502 시나리오 3)" "$(pmo_mt "$RF" | wc -l)" "3"
eq "🔴 curl 상한 초과(000) → 해외 3회 08:00·08:12·08:24(간격은 종료 시각부터)" \
   "$(grep 'market=overseas' "$RT/calls" | cut -d' ' -f1 | tr '\n' ' ')" "08:00 08:12 08:24 "
eq "🔴 curl 상한 초과 → 날짜파일 없음" \
   "$(cat "$RT/home/.node-local/stockinvest/post-market-overseas-last-date" 2>/dev/null || echo none)" "none"
eq "curl 상한 초과 → 시도 기록 3" "$(cut -d' ' -f2 "$RT/home/.node-local/stockinvest/post-market-overseas-attempts")" "3"
grep -q 'post-market-overseas HTTP=000' "$RT/stdout" && ok "상한 초과는 HTTP=000 으로 로그" || bad "HTTP=000 로그 없음"
eq "kis-fundamentals-snapshot 은 그대로 1회" "$(grep -c 'kis-fundamentals-snapshot' "$RF/calls")" "1"
eq "entry-watcher 는 매 틱(120회)" "$(grep -c '/api/cron/entry-watcher' "$RF/calls")" "120"
grep -q 'post-market-overseas 오늘 3회 모두 실패' "$RF/stdout" && ok "3회 실패 로그 한 줄" || bad "3회 실패 로그 없음"

# 다른 하루 1회 잡은 T-036 규칙(성공·실패 무관 날짜파일 기록) 그대로인지 — 구조 확인
# (T-103) 뉴스 수집은 시장별 두 잡으로 나뉘어 날짜파일 변수도 둘이다(NEWS_FETCH_LAST_RUN_FILE → OVERSEAS·DOMESTIC).
for v in META_LAST_RUN_FILE RS_UPDATE_LAST_RUN_FILE KIS_FUNDAMENTALS_LAST_RUN_FILE POST_MARKET_DOMESTIC_LAST_RUN_FILE \
         RESEARCH_OVERSEAS_LAST_RUN_FILE EDGAR_SYNC_LAST_RUN_FILE RESEARCH_DOMESTIC_LAST_RUN_FILE \
         NEWS_FETCH_OVERSEAS_LAST_RUN_FILE NEWS_FETCH_DOMESTIC_LAST_RUN_FILE TRAINSET_LAST_RUN_FILE; do
  grep -q "echo \"\$TODAY\" > \"\$$v\"" "$RUNNER" && ok "$v 무조건 기록 유지" || bad "$v 기록 줄이 바뀌었다"
done
grep -q 'echo "$TODAY" > "$POST_MARKET_OVERSEAS_LAST_RUN_FILE"' "$RUNNER" && bad "해외 post-market 이 아직 무조건 기록한다" || ok "해외 post-market 무조건 기록 제거"

echo
echo "결과: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
