#!/usr/bin/env bash
# T-172 — cron-runner.sh call() 의 셋째 인자(요청 본문) 시험.
#
# 실행: bash scripts/test-cron-runner-call-body.sh   (NFS noexec 경로라 반드시 bash 경유)
#
# 결함(T-170 조사 중 발견): call() 의 `local body="${3:-{}}"` 는 bash 가 기본값 `{` 뒤 첫 `}` 에서 확장을 닫아 남은 `}` 가 글자로 붙는다 —
#   셋째 인자를 주면 본문 끝에 `}` 가 하나 더 붙었다(예 {"market":"KR"} → {"market":"KR"}}, 라우트는 400). 셋째 인자를 넘기는 호출 줄이
#   0개라 운영에서는 드러나지 않았고, T-170 은 국내 저녁 실행의 시장을 쿼리(?market=KR)로 넘겨 피했다.
# 고침(T-172): 기본값을 변수로 빼서(`local body_default='{}'`) `${3:-$body_default}` 로 읽는다 — 셋째 인자가 없거나 비면 예전처럼 {}.
#  B1. 러너에서 잘라 낸 **실제 call() 본문**을 가짜 curl·후크 스텁으로 돌려 -d 로 나간 본문을 본다: 인자 없음·빈 값 → {} ·
#      {"market":"KR"} · 중첩 {"a":{"b":1}} · } 한 글자 · 공백 낀 값 → 한 바이트도 바뀌지 않음 · -d 는 한 번 · OK 로그 한 줄 · 응답 임시 파일 안 남김
#  B2. 민감도·불변: 기준 ref(T172_BASE_REF, 기본 683a5dc = T-172 착수 기준)의 call() 은 같은 하네스에서 {"market":"KR"} → {"market":"KR"}} 를
#      낸다(이 시험이 결함을 잡는다) · 인자 없음·빈 값의 본문은 기준과 같은 {} · curl 인자(본문 제외)·로그 줄(시각 제외)은 기준과 같다
#  B3. 정적: T-172 두 줄이 파일 전체에 각 1개·모두 call() 안(넷째·다섯째 줄) · 옛 줄 0 · 두 줄을 되돌리면(no_t172) call() = 기준 ref ·
#      러너 전체에 셋째 인자를 넘기는 call 줄 = 기준과 같은 0(그래서 지금 운영 동작은 바이트까지 같다 — 새 잡이 본문을 넘기면 이 단언을 고친다)
# 외부 호출 없음(curl 은 셸 함수 스텁), 실제 HOME·.env 를 읽지 않음, 러너 본체를 돌리지 않음(call() 함수만 잘라 서브셸에서 부른다 —
#   scripts/test-cron-runner-m40-forward.sh 의 「real call()」 시험과 같은 방식).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="${T172_RUNNER:-$HERE/cron-runner.sh}"   # 변이 시험용 덮어쓰기
BASE_REF="${T172_BASE_REF:-683a5dc}"
PASS=0; FAIL=0
ok()   { PASS=$((PASS + 1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
eq()   { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (기대 '$3', 실제 '$2')"; fi; }

# ── (T-172) 도우미 — call() 을 비교하는 러너 시험 7개에 같은 정의가 있다 ─────────────────────────────────────────
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
  echo "기준 러너($BASE_REF:scripts/cron-runner.sh)를 읽지 못함 — 비교 시험을 할 수 없다(T172_BASE_REF 로 지정 가능)"
  exit 1
fi
CALL_NEW="$W/call-new"; awk '/^call\(\) \{/,/^\}/' "$RUNNER" > "$CALL_NEW"
CALL_OLD="$W/call-old"; awk '/^call\(\) \{/,/^\}/' "$BEFORE" > "$CALL_OLD"

# run_call <call() 파일> <이름> [셋째 인자] — 서브셸에서 call() 하나만 정의해 부른다. 셋째 인자는 **개수로** 가른다
#   (이름 뒤 인자 0개 → call 에 두 인자만, 1개 → 그 값을 셋째 인자로 — 빈 문자열도 셋째 인자다).
#   결과 $W/<이름>/: body(-d 값, 개행 없이 그대로) · args(-d 값을 뺀 curl 인자, 한 줄에 하나, 이 디렉터리 경로는 D 로) · log · left(응답 임시 파일 남음 여부)
run_call() {
  local fn="$1" name="$2"; shift 2
  local d="$W/$name"; mkdir -p "$d"
  (
    set -u
    unset -f call
    . "$fn"
    CRON_SECRET=synthetic-secret; BASE_URL=http://127.0.0.1:9; CALL_MAX_TIME=""
    jrl_now_ms() { echo 0; }
    jrl_hook() { :; }
    jrl_mask_money() { cat; }
    call_tmp_open() { CALL_BODY_FILE="$d/resp"; printf '%s' '{"ok":true}' > "$CALL_BODY_FILE"; }
    curl() {
      local a prev=""
      : > "$d/args"
      for a in "$@"; do
        if [ "$prev" = "-d" ]; then printf '%s' "$a" > "$d/body"; else printf '%s\n' "${a//"$d"/D}" >> "$d/args"; fi
        prev="$a"
      done
      echo 200
    }
    if [ "$#" -eq 0 ]; then call /api/cron/t172-probe t172-probe
    else call /api/cron/t172-probe t172-probe "$1"; fi
  ) > "$d/log" 2>&1
  if [ -e "$d/resp" ]; then echo yes > "$d/left"; else echo no > "$d/left"; fi
}
body() { cat "$W/$1/body" 2>/dev/null || echo "(없음)"; }
nots() { sed 's/^\[[^]]*\] //' "$W/$1/log"; }   # 로그 줄에서 시각을 뺀다

KR='{"market":"KR"}'
NEST='{"a":{"b":1}}'
run_call "$CALL_NEW" n-none
run_call "$CALL_NEW" n-empty ""
run_call "$CALL_NEW" n-kr "$KR"
run_call "$CALL_NEW" n-nest "$NEST"
run_call "$CALL_NEW" n-brace "}"
run_call "$CALL_NEW" n-space "x y"
run_call "$CALL_OLD" o-none
run_call "$CALL_OLD" o-empty ""
run_call "$CALL_OLD" o-kr "$KR"
run_call "$CALL_OLD" o-nest "$NEST"

# ── B1. 고친 call() ─────────────────────────────────────────────────────────────────
echo "B1. 고친 call() — 실제 함수 본문, 가짜 curl"
eq "🔴 B1: 셋째 인자 없음 → 본문 {}" "$(body n-none)" "{}"
eq "🔴 B1: 셋째 인자 빈 값 → 본문 {}" "$(body n-empty)" "{}"
eq "🔴 B1: $KR → 그대로(끝에 } 가 붙지 않음)" "$(body n-kr)" "$KR"
eq "🔴 B1: 중첩 $NEST → 그대로" "$(body n-nest)" "$NEST"
eq "B1: } 한 글자 → 그대로" "$(body n-brace)" "}"
eq "B1: 공백 낀 값 'x y' → 한 인자로 그대로" "$(body n-space)" "x y"
eq "B1: -d 는 호출마다 한 번(6건)" "$(for c in none empty kr nest brace space; do grep -cx -- '-d' "$W/n-$c/args"; done | tr '\n' ' ')" "1 1 1 1 1 1 "
eq "B1: 로그 = OK 한 줄(6건)" "$(for c in none empty kr nest brace space; do nots "n-$c" | grep -cx 't172-probe OK'; done | tr '\n' ' ') $(for c in none empty kr nest brace space; do wc -l < "$W/n-$c/log" | tr -d ' '; done | tr '\n' ' ')" "1 1 1 1 1 1  1 1 1 1 1 1 "
eq "B1: 응답 임시 파일을 남기지 않음(6건)" "$(cat "$W"/n-*/left | tr '\n' ' ')" "no no no no no no "

# ── B2. 민감도·불변 ─────────────────────────────────────────────────────────────────
echo "B2. 기준 ref $BASE_REF 의 call() 과 비교"
eq "🔴 B2: (민감도) 기준 call() 은 $KR 끝에 } 를 덧붙인다 — 이 시험이 결함을 잡는다" "$(body o-kr)" "$KR}"
eq "B2: (민감도) 기준 call() 은 중첩 값에도 덧붙인다" "$(body o-nest)" "$NEST}"
eq "🔴 B2: 셋째 인자 없음·빈 값의 본문 = 기준과 같음(지금 운영 호출의 본문 불변)" "$(body n-none) $(body n-empty)" "$(body o-none) $(body o-empty)"
if diff "$W/n-none/args" "$W/o-none/args" > /dev/null && diff "$W/n-kr/args" "$W/o-kr/args" > /dev/null; then
  ok "🔴 B2: curl 인자(본문 제외) = 기준과 같음 — 셋째 인자 없음·있음 모두 ($(wc -l < "$W/n-none/args" | tr -d ' ')개)"
else bad "B2: curl 인자가 기준과 다르다"; diff "$W/n-none/args" "$W/o-none/args" | head -5; diff "$W/n-kr/args" "$W/o-kr/args" | head -5; fi
eq "B2: 로그 줄(시각 뺌) = 기준과 같음" "$(nots n-none) | $(nots n-kr)" "$(nots o-none) | $(nots o-kr)"

# ── B3. 정적 ────────────────────────────────────────────────────────────────────────
echo "B3. 정적"
eq "bash -n" "$(bash -n "$RUNNER" 2>&1 && echo ok)" "ok"
eq "🔴 B3: T-172 두 줄 = 파일 전체 각 1개 · 옛 줄 0 · 모두 call() 안" "$(t172_targets "$RUNNER")" "1 1 0 | 1 1"
eq "B3: 두 줄은 call() 넷째·다섯째 줄(기본값 줄이 본문 줄 바로 앞)" "$(sed -n 4p "$CALL_NEW") | $(sed -n 5p "$CALL_NEW")" "$T172_L1 | $T172_L2"
eq "🔴 B3: 두 줄을 되돌리면(no_t172) call() = 기준 ref $BASE_REF" "$(no_t172 < "$CALL_NEW" | sha256sum)" "$(sha256sum < "$CALL_OLD")"
eq "B3: (도우미 확인) 기준 call() 에 no_t172 를 걸어도 그대로" "$(no_t172 < "$CALL_OLD" | sha256sum)" "$(sha256sum < "$CALL_OLD")"
# 셋째 인자를 넘기는 call 줄: 주석 줄·줄 끝 주석을 떼고 `call <경로> <라벨> <무엇이든>` 꼴을 센다(test-cron-runner-daily-bars-kr.sh K6 와 같은 식)
third() { grep -v '^[[:space:]]*#' "$1" | sed 's/[[:space:]]#.*$//' | grep -cE '^[[:space:]]*call[[:space:]]+("[^"]*"|[^[:space:]"]+)[[:space:]]+("[^"]*"|[^[:space:]"]+)[[:space:]]+[^[:space:]]'; }
eq "🔴 B3: 셋째 인자를 넘기는 call 줄 = 기준과 같은 0(지금 운영 동작 불변)" "$(third "$RUNNER") $(third "$BEFORE")" "0 0"

echo
echo "결과: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
