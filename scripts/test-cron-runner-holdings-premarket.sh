#!/usr/bin/env bash
# T-119 — cron-runner.sh 의 보유 종목 개장 전 공시 블록(holdings-premarket) 시험.
#
# 실행: bash scripts/test-cron-runner-holdings-premarket.sh   (NFS noexec 경로라 반드시 bash 경유)
#
# cron-runner.sh 를 **그대로** 돌린다 — curl·date·sleep 만 가짜(PATH 앞 스텁)로 바꿔 가짜 시각으로 틱을 흉내 낸다
# (test-cron-runner-news-peek.sh 와 같은 하네스). 가짜 date 는 시각만 고정(-d @epoch)하고 시간대는 환경의 TZ 를 그대로 따르므로
# 러너의 `TZ=America/New_York date` 도 실제 tzdata 로 ET 를 계산한다(하네스 확장 없음 — H0 이 확인).
# 비교 기준 러너 = **이 러너에서 holdings-premarket 블록·날짜파일 선언·머리 주석 한 줄만 지운 사본**(합치기 뒤에도 그대로 쓸 수 있다).
# 정적 시험(H9)은 그 사본이 git 의 변경 전 러너($T119_BASE_REF, 기본 f91cd94 = T-118 커밋(T-117+T-118 포함·T-119 없음))와 실행 줄이 같음을 확인한다 —
# 다른 task 와 합친 뒤에는 T119_BASE_REF 를 "T-119 를 뺀 합본" 커밋으로 지정한다.
#  H0. 하네스: 가짜 date 에 TZ=America/New_York 를 주면 ET(EDT/EST) 로 나온다
#  H1. EDT 하루(10-28 수, KST 00:00~23:59): 21:00 은 peek(해외 21시, T-118) → 21:01 1회 · 날짜파일 = ET 날짜 · --max-time 90 · 다른 모든 호출 = 기준 러너
#  H1b. peek 가 그 틱에 돌지 않으면(해외 21시 peek 날짜파일 = 오늘) 21:00 정시에 1회
#  H2. EST 하루(11-02 월): 22:00 은 peek(해외 22시)가 돌아 yield → 22:01 1회 · yield 로그 1줄 · 다른 모든 호출 = 기준 러너
#  H3. 서머타임 전환 주(10-30 금 ~ 11-03 화, 빠른 시계): 10-30 21:01(EDT) · 10-31 토·11-01 일 없음 · 11-02 22:01(EST) · 11-03 22:01
#  H4. 라우트 502 이틀: 실패여도 ET 하루 1회(같은 시간 재호출 없음) · 날짜파일 = 둘째 날
#  H5. 재기동: 날짜파일 = 오늘(ET) → 호출 없음 / 어제 → 21:30 재기동에 1회(그 틱에 peek 가 돌아 21:31) / 09시(ET) 이후 재기동 → 그날 없음
# T-118 병합(해외 peek 가 06·07·08·15·16시를 뺀 매시 첫 틱 — KST 21·22시 포함): holdings-premarket 은 peek 와 같은 틱이면 다음 틱으로
#   양보하므로(PEEK_RAN_LABEL) EDT 21:00 → 21:01, EST 22:00 → 22:01 이 된다. 바뀐 것은 시각 리터럴뿐 — ET 08시대·하루 1회·평일·ET 날짜파일·
#   성공/실패 무관 기록·하트비트 < 300초 단언은 그대로다. peek 가 돌지 않는 틱의 정시 경로는 H1b 가 따로 단언한다.
#  H6. 느린 라우트(curl 상한 90초에 걸림) + 느린 peek(186초): 하트비트 간격 < 300초
#  H7. tzdata 없음(TZDIR 위조 → %Z 가 EDT/EST 아님): 호출 없음
#  H8. 주말 ET(토·일)·ET 07·09시: 호출 없음 (H3 에 포함 + 하루 전체 시각 확인)
#  H9. 정적: 블록 안 호출 줄 1개 · CALL_MAX_TIME 설정·해제 · 블록은 peek 블록 뒤 · call() 불변 · 블록·선언·머리 주석 밖 실행 줄 = 변경 전
# 외부 호출 없음(curl 은 스텁), 실제 HOME·.env 를 읽지 않음(임시 디렉터리).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="${T119_RUNNER:-$HERE/cron-runner.sh}"   # 변이 시험용 덮어쓰기
BASE_REF="${T119_BASE_REF:-f91cd94bb292e2f20e733a97c9070d9129cdadb8}"   # T-117+T-118 을 담고 T-119 는 없는 ref = T-118 커밋 f91cd94
REAL_DATE="$(command -v date)"
PASS=0; FAIL=0
ok()   { PASS=$((PASS + 1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
eq()   { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (기대 '$3', 실제 '$2')"; fi; }

W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT

# 기준 러너 = holdings-premarket 블록·날짜파일 선언·머리 주석 한 줄을 지운 사본
strip_hp() { awk '/^  # >>> holdings-premarket/{s=1} s{ if (/^  # <<< holdings-premarket/) s=0; next } {print}' "$1" \
  | grep -v '^HOLDINGS_PREMARKET_LAST_RUN_FILE=' | grep -v '^#  - holdings-premarket:'; }
STRIPPED="$W/runner-stripped.sh"
strip_hp "$RUNNER" > "$STRIPPED"
BEFORE="$W/runner-base.sh"
if ! git -C "$HERE/.." show "$BASE_REF:scripts/cron-runner.sh" > "$BEFORE" 2>/dev/null || [ ! -s "$BEFORE" ]; then
  echo "변경 전 러너($BASE_REF:scripts/cron-runner.sh)를 읽지 못함 — 정적 비교를 할 수 없다(T119_BASE_REF 로 지정 가능)"
  exit 1
fi

ep() { TZ=Asia/Seoul "$REAL_DATE" -d "$1" +%s; }

# run_loop NAME RUNNER START TICKS MODE [SEED] [EXTRA_ENV]
#  MODE: ok(200) | fail(holdings-premarket 502) | slow(holdings-premarket = curl 상한만큼 흐른 뒤 000, peek = 186초 뒤 200) |
#        fast(200, KST 23:10~20:50 구간은 시계를 다음 20:50 으로 건너뛴다 — 여러 날의 21·22시만 빠르게 본다) |
#        failfast(fast 와 같은 시계 + holdings-premarket 502)
#  SEED: "날짜파일이름=내용"(공백으로 여러 개) — 러너 시작 전에 ~/.node-local/stockinvest/ 에 미리 써 둔다(재기동 흉내).
# 호출 기록 한 줄: "MM-DD HH:MM 틱번호 경로"
run_loop() {
  local name="$1" runner="$2" start="$3" ticks="$4" mode="$5" seed="${6:-}" extra="${7:-}" R="$W/$1"
  mkdir -p "$R/bin" "$R/home" "$R/proj"
  if [ -n "$seed" ]; then   # 공백으로 여러 개("a=b c=d")
    mkdir -p "$R/home/.node-local/stockinvest"
    for sd in $seed; do printf '%s\n' "${sd#*=}" > "$R/home/.node-local/stockinvest/${sd%%=*}"; done
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
if [ "$mode" = "fast" ] || [ "$mode" = "failfast" ]; then
  hm=\$(TZ=Asia/Seoul "$REAL_DATE" -d "@\$c" '+%H%M')
  if [ "\$hm" -ge 2310 ] || [ "\$hm" -lt 2050 ]; then
    d=\$(TZ=Asia/Seoul "$REAL_DATE" -d "@\$c" '+%F')
    [ "\$hm" -ge 2310 ] && d=\$(TZ=Asia/Seoul "$REAL_DATE" -d "\$d 12:00 +1 day" '+%F')
    c=\$(TZ=Asia/Seoul "$REAL_DATE" -d "\$d 20:50:00" +%s)
  fi
fi
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
  /api/cron/holdings-premarket)
    case "$mode" in
      fail|failfast) code=502 ;;
      slow) c=\$(cat "$R/clock"); echo \$((c + \${mt:-600})) > "$R/clock"; code=000 ;;
    esac ;;
  /api/cron/news-fetch*mode=peek)
    case "$mode" in
      slow) c=\$(cat "$R/clock"); echo \$((c + 186)) > "$R/clock" ;;
    esac ;;
esac
[ -n "\$out" ] && echo '{}' > "\$out"
printf '%s' "\$code"
[ "\$code" = "000" ] && exit 28
exit 0
EOF
  chmod +x "$R/bin/date" "$R/bin/sleep" "$R/bin/curl"
  : > "$R/calls"; : > "$R/maxtime"
  env PATH="$R/bin:$PATH" HOME="$R/home" PROJECT_DIR="$R/proj" BASE_URL="http://stub" TZ=Asia/Seoul $extra \
    timeout 900 bash "$runner" > "$R/stdout" 2>&1
  echo "$R"
}

hp()     { grep -E ' /api/cron/holdings-premarket$' "$1/calls"; }
hlist()  { hp "$1" | awk '{print $1, $2}' | tr '\n' ' '; }
nohp()   { grep -vE ' /api/cron/holdings-premarket$' "$1/calls" | awk '{print $1, $2, $4}'; }
allc()   { awk '{print $1, $2, $4}' "$1/calls"; }
df()     { cat "$1/home/.node-local/stockinvest/$2" 2>/dev/null || echo none; }
gap()    { awk 'NR>1 { g = $1 - p; if (g > m) m = g } { p = $1 } END { print m + 0 }' "$1/heartbeats"; }
same()   {   # same 라벨 새러너결과 기준러너결과 — holdings-premarket 을 뺀 호출 목록이 기준 러너와 완전히 같은가
  if diff <(nohp "$2") <(allc "$3") > /dev/null; then ok "🔴 $1: holdings-premarket 을 뺀 모든 호출 = 기준 러너 ($(nohp "$2" | wc -l | tr -d ' ')건)"
  else bad "$1: holdings-premarket 을 뺀 호출 목록이 기준 러너와 다르다"; diff <(nohp "$2") <(allc "$3") | head -10; fi
  if diff <(grep -v '^/api/cron/holdings-premarket ' "$2/maxtime") "$3/maxtime" > /dev/null; then ok "$1: --max-time 붙는 다른 호출 = 기준 러너"
  else bad "$1: --max-time 목록이 다르다"; fi
}
HPF=holdings-premarket-last-date

# ── H0. 하네스 ────────────────────────────────────────────────────────────────────
echo "H0. 하네스 — 가짜 date 가 TZ=America/New_York 를 따르는가"
H0="$W/h0"; mkdir -p "$H0"; ep "2026-10-28 21:00:00" > "$H0/clock"
printf '#!/usr/bin/env bash\nexec "%s" -d "@$(cat "%s")" "$@"\n' "$REAL_DATE" "$H0/clock" > "$H0/date"
eq "H0: 10-28 21:00 KST → ET 2026-10-28 08 수 EDT" "$(TZ=America/New_York bash "$H0/date" '+%F %H %u %Z')" "2026-10-28 08 3 EDT"
ep "2026-11-02 22:00:00" > "$H0/clock"
eq "H0: 11-02 22:00 KST → ET 2026-11-02 08 월 EST" "$(TZ=America/New_York bash "$H0/date" '+%F %H %u %Z')" "2026-11-02 08 1 EST"
eq "(하네스) 기준 러너에는 holdings-premarket 이 없다" "$(grep -c 'holdings-premarket' "$STRIPPED")" "0"

# ── H1. EDT 하루 ──────────────────────────────────────────────────────────────────
echo "H1. EDT 하루 1440틱 (10-28 수 00:00~23:59 KST)"
NA="$(run_loop new-edt "$RUNNER" "2026-10-28 00:00:00" 1440 ok)"
BA="$(run_loop base-edt "$STRIPPED" "2026-10-28 00:00:00" 1440 ok)"
eq "H1: 1440틱 완주(새·기준)" "$(cat "$NA/ticks") $(cat "$BA/ticks")" "1440 1440"
eq "🔴 H1: 21:00 은 peek(해외 21시) → holdings-premarket 21:01 1회(ET 08:01 EDT)" "$(hlist "$NA")" "10-28 21:01 "
eq "H1: 21:00 틱에 peek 가 돌았다" "$(grep -c '^10-28 21:00 .* /api/cron/news-fetch?market=overseas&mode=peek$' "$NA/calls")" "1"
eq "H1: yield 로그 1줄" "$(grep -c 'holdings-premarket yield_tick — news-peek-overseas-21' "$NA/stdout")" "1"
eq "H1: 날짜파일 = ET 날짜" "$(df "$NA" "$HPF")" "2026-10-28"
eq "H1: --max-time 90" "$(grep -c '^/api/cron/holdings-premarket max-time=90$' "$NA/maxtime")" "1"
eq "H1: OK 로그 1줄" "$(grep -c 'holdings-premarket OK' "$NA/stdout")" "1"
same "H1" "$NA" "$BA"
NA2="$(run_loop new-edt-nopeek "$RUNNER" "2026-10-28 20:58:00" 5 ok "news-peek-overseas-21-last-date=2026-10-28")"
eq "🔴 H1b: peek 가 그 틱에 돌지 않으면(해외 21시 peek 이미 돎) 21:00 정시 1회(ET 08:00 EDT)" "$(hlist "$NA2")" "10-28 21:00 "
eq "H1b: 21:00 틱에 peek 없음·yield 로그 없음(20:58 틱의 해외 20시 peek 는 별개)" "$(grep -c '^10-28 21:00 .*mode=peek$' "$NA2/calls") $(grep -c 'holdings-premarket yield_tick' "$NA2/stdout")" "0 0"

# ── H2. EST 하루 + peek 겹침 ──────────────────────────────────────────────────────
echo "H2. EST 하루 1440틱 (11-02 월 00:00~23:59 KST)"
NB="$(run_loop new-est "$RUNNER" "2026-11-02 00:00:00" 1440 ok)"
BB="$(run_loop base-est "$STRIPPED" "2026-11-02 00:00:00" 1440 ok)"
eq "🔴 H2: 22:00 은 peek(해외 22시) → holdings-premarket 22:01 1회(ET 08:01 EST)" "$(hlist "$NB")" "11-02 22:01 "
eq "H2: 22:00 틱에 peek 가 돌았다" "$(grep -c '^11-02 22:00 .* /api/cron/news-fetch?market=overseas&mode=peek$' "$NB/calls")" "1"
eq "H2: yield 로그 1줄" "$(grep -c 'holdings-premarket yield_tick — news-peek-overseas-22' "$NB/stdout")" "1"
eq "🔴 H2: 21:00 KST(ET 07시 EST)에는 없음" "$(hp "$NB" | grep -c ' 21:')" "0"
eq "H2: 날짜파일 = ET 날짜" "$(df "$NB" "$HPF")" "2026-11-02"
same "H2" "$NB" "$BB"

# ── H3. 서머타임 전환 주 ──────────────────────────────────────────────────────────
echo "H3. 10-30 금 ~ 11-03 화 (빠른 시계 — 매일 20:50~23:10 KST 만)"
NC="$(run_loop new-dst "$RUNNER" "2026-10-30 20:50:00" 700 fast)"
eq "H3: 마지막 틱이 11-03 밤까지 갔다" "$(tail -1 "$NC/calls" | awk '{print $1}')" "11-03"
eq "🔴 H3: 10-30(금 EDT) 21:01 · 토·일 없음 · 11-02(월 EST) 22:01 · 11-03(화 EST) 22:01" "$(hlist "$NC")" \
   "10-30 21:01 11-02 22:01 11-03 22:01 "
eq "H3: 날짜파일 = 마지막 ET 날짜" "$(df "$NC" "$HPF")" "2026-11-03"

# ── H4. 502 이틀 ──────────────────────────────────────────────────────────────────
echo "H4. 라우트 502 — 10-28·10-29 (빠른 시계)"
ND="$(run_loop new-fail "$RUNNER" "2026-10-28 20:50:00" 282 failfast)"
eq "🔴 H4: 502 여도 ET 하루 1회 — 10-28 21:01 · 10-29 21:01(각각 21:00 peek 다음 틱)" "$(hlist "$ND")" "10-28 21:01 10-29 21:01 "
eq "H4: 실패 로그 2줄" "$(grep -c 'holdings-premarket HTTP=502' "$ND/stdout")" "2"
eq "H4: 날짜파일 = 둘째 날(실패해도 기록)" "$(df "$ND" "$HPF")" "2026-10-29"

# ── H5. 재기동 ────────────────────────────────────────────────────────────────────
echo "H5. 재기동"
NE1="$(run_loop new-r1 "$RUNNER" "2026-10-28 21:30:00" 10 ok "$HPF=2026-10-28")"
eq "H5: 날짜파일 = 오늘(ET) → 21:30 재기동에 호출 없음" "$(hp "$NE1" | wc -l | tr -d ' ')" "0"
NE2="$(run_loop new-r2 "$RUNNER" "2026-10-28 21:30:00" 10 ok "$HPF=2026-10-27")"
eq "🔴 H5: 날짜파일 = 어제 → 21:30 재기동에 1회(21:30 은 해외 21시 peek 가 돌아 21:31)" "$(hlist "$NE2")" "10-28 21:31 "
NE3="$(run_loop new-r3 "$RUNNER" "2026-10-28 22:00:00" 10 ok "$HPF=2026-10-27")"
eq "H5: 09시(ET) 이후 재기동(22:00 KST EDT) → 그날 없음" "$(hp "$NE3" | wc -l | tr -d ' ')" "0"

# ── H6. 하트비트 ──────────────────────────────────────────────────────────────────
echo "H6. 느린 라우트(90초 상한) + 느린 peek(186초) — 11-02 21:58 시작"
NF="$(run_loop new-slow "$RUNNER" "2026-11-02 21:58:00" 8 slow "news-peek-overseas-21-last-date=2026-11-02")"   # 21시 peek 는 이미 돈 날 — 22시 peek 와 겹치는 틱만 본다
eq "H6: peek 22:00 → holdings-premarket 다음 틱" "$(hp "$NF" | awk '{print $2}')" "22:04"
eq "H6: curl 상한 걸림(000) 로그" "$(grep -c 'holdings-premarket HTTP=000' "$NF/stdout")" "1"
eq "H6: 실패여도 날짜파일 기록" "$(df "$NF" "$HPF")" "2026-11-02"
g="$(gap "$NF")"
if [ "$g" -lt 300 ]; then ok "🔴 H6: 하트비트 간격 최대 ${g}초 < 300초(워치독 한도)"; else bad "H6: 하트비트 간격 ${g}초 ≥ 300"; fi

# ── H7. tzdata 없음 ───────────────────────────────────────────────────────────────
echo "H7. tzdata 를 못 읽는 환경(TZDIR 위조)"
# tzdata 를 못 읽으면 glibc 는 TZ=America/New_York 를 조용히 UTC 로 계산한다 — 그래서 **UTC 08시**(= KST 17:00, 수요일)를 지나가게 시작해야
#   가드(%Z ∈ EDT/EST)가 없을 때 호출이 생겨 이 시험이 가드를 실제로 검사한다(가드 삭제 변이 R5 가 여기서 잡힌다).
NG="$(run_loop new-notz "$RUNNER" "2026-10-28 16:58:00" 10 ok "" "TZDIR=$W/no-tzdata")"
eq "H7: (하네스) TZDIR 위조 시 %Z 가 EDT/EST 아님" "$(TZDIR="$W/no-tzdata" TZ=America/New_York "$REAL_DATE" '+%Z' | grep -cE '^(EDT|EST)$')" "0"
eq "H7: (하네스) TZDIR 위조 시 KST 17:00 의 'ET' 시각이 UTC 08시로 계산된다(가드 없으면 부를 시각)" \
   "$(TZDIR="$W/no-tzdata" TZ=America/New_York "$REAL_DATE" -d "@$(ep '2026-10-28 17:00:00')" '+%H %u')" "08 3"
eq "🔴 H7: 호출 없음(UTC 로 잘못 계산된 08시에 부르지 않는다)" "$(hp "$NG" | wc -l | tr -d ' ')" "0"

# ── H8. 시각 범위 ─────────────────────────────────────────────────────────────────
echo "H8. 하루 전체에서 ET 08시 밖·주말"
eq "H8: H1·H2 의 호출은 모두 ET 08시" \
   "$(for R in "$NA" "$NB"; do hp "$R" | while read -r md hm _ _; do TZ=America/New_York "$REAL_DATE" -d "$(TZ=Asia/Seoul "$REAL_DATE" -d "2026-$md $hm" '+%Y-%m-%dT%H:%M:%S%z')" '+%H'; done; done | sort -u | tr '\n' ' ')" "08 "
NH="$(run_loop new-wkend "$RUNNER" "2026-10-31 00:00:00" 1440 ok)"
eq "🔴 H8: 토요일(ET 10-31) 하루 전체 호출 없음" "$(hp "$NH" | wc -l | tr -d ' ')" "0"

# ── H9. 정적 ──────────────────────────────────────────────────────────────────────
echo "H9. 정적"
eq "bash -n" "$(bash -n "$RUNNER" 2>&1 && echo ok)" "ok"
nb="$(awk '/^  # >>> holdings-premarket/,/^  # <<< holdings-premarket/' "$RUNNER")"
eq "H9: 블록 표지 >>>/<<< 각 1개" "$(grep -c '^  # >>> holdings-premarket' "$RUNNER") $(grep -c '^  # <<< holdings-premarket' "$RUNNER")" "1 1"
eq "H9: 블록 안 호출 줄 1개" "$(printf '%s\n' "$nb" | grep -c 'call ')" "1"
eq "H9: 그 호출 줄" "$(printf '%s\n' "$nb" | grep 'call ' | sed 's/^ *//')" 'call "/api/cron/holdings-premarket" "holdings-premarket"'
eq "H9: CALL_MAX_TIME 설정·해제 각 1줄" "$(printf '%s\n' "$nb" | grep -c 'CALL_MAX_TIME="$HP_CURL_MAX_TIME"') $(printf '%s\n' "$nb" | grep -c 'CALL_MAX_TIME=""')" "1 1"
eq "H9: ET 시각 계산은 TZ=America/New_York date" "$(printf '%s\n' "$nb" | grep -c "TZ=America/New_York date '+%F %H %u %Z'")" "1"
eq "H9: 날짜파일에 ET 날짜를 쓴다" "$(printf '%s\n' "$nb" | grep -c 'echo "$HP_ET_DATE" > "$HOLDINGS_PREMARKET_LAST_RUN_FILE"')" "1"
eq "H9: 머리 주석에 T-104 흡수 표시" "$(printf '%s\n' "$nb" | grep -c 'T-104 단계 1 에서 잡 정의로 흡수, ET 기준 시각(America/New_York 08:00) 표현이 필요')" "1"
eq "H9: 블록은 news-fetch-peek 블록 뒤(PEEK_RAN_LABEL 를 읽는다)" \
   "$([ "$(grep -n '^  # >>> holdings-premarket' "$RUNNER" | cut -d: -f1)" -gt "$(grep -n '^  # <<< news-fetch-peek' "$RUNNER" | cut -d: -f1)" ] && echo yes || echo no)" "yes"
eq "H9: 날짜파일 선언 1개" "$(grep -c '^HOLDINGS_PREMARKET_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/holdings-premarket-last-date"' "$RUNNER")" "1"
eq "H9: 상단 잡 목록 주석에 새 잡" "$(sed -n '1,45p' "$RUNNER" | grep -c '^#  - holdings-premarket:')" "1"
eq "H9: call() 함수 본문 = 변경 전" "$(awk '/^call\(\) \{/,/^\}/' "$RUNNER" | grep -v '# T-112 jrl$' | sha256sum)" "$(awk '/^call\(\) \{/,/^\}/' "$BEFORE" | sha256sum)"
noc() { grep -v '^[[:space:]]*#' "$1" | grep -v '^[[:space:]]*$'; }
# (T-112) 실행·상태 기록 후크(최상위 job-run-log-spool 블록 · `# T-112 jrl` 표지 줄 4개)는 이 정적 비교의 대상이 아니다 — 새 러너 쪽에서만 뺀다
#   (기준 ref 에는 없다). 후크가 추가만 했는지·call() 의 나머지가 그대로인지는 scripts/test-cron-runner-job-run-log.sh J8 이 본다.
no_jrl() { awk '/^# >>> job-run-log-spool/{s=1} s{ if (/^# <<< job-run-log-spool/) s=0; next } {print}' "$1" | grep -v '# T-112 jrl$'; }
STRIPPED_NOJRL="$W/runner-stripped-nojrl.sh"; no_jrl "$STRIPPED" > "$STRIPPED_NOJRL"
if diff <(noc "$STRIPPED_NOJRL") <(noc "$BEFORE") > /dev/null; then ok "🔴 H9: 블록·선언·머리 주석 밖 실행 줄 = 변경 전($BASE_REF)과 동일 ($(noc "$STRIPPED_NOJRL" | wc -l | tr -d ' ')줄)"
else bad "H9: 블록 밖 실행 줄이 변경 전($BASE_REF)과 다르다 — 다른 task 와 합친 뒤라면 T119_BASE_REF 를 지정"; diff <(noc "$STRIPPED_NOJRL") <(noc "$BEFORE") | head -10; fi
eq "H9: 지운 줄 = 블록 + 선언 1 + 머리 주석 1" "$(( $(wc -l < "$RUNNER") - $(wc -l < "$STRIPPED") ))" "$(( $(printf '%s\n' "$nb" | wc -l) + 2 ))"

echo
echo "결과: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
