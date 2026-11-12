#!/usr/bin/env bash
#
# test-git-hooks.sh — commit-msg 훅 동작 검증 (task: T-025)
#
#   bash scripts/test-git-hooks.sh          # 요약만
#   bash scripts/test-git-hooks.sh -v       # 훅 출력까지 전부 표시
#
# ⚠ 실제 저장소에 미치는 영향 — 2026-10-23 T-075 정정. 이전 머리말의 "실제 커밋을 만들지 않고,
#   워킹트리와 실제 index 도 건드리지 않는다"는 사실이 아니었다. 실제 동작은 아래와 같다.
#
#   1) 로직 시나리오 단계 — GIT_INDEX_FILE 로 만든 **임시 index** 에만 가짜 blob 을 stage 하고 훅을
#      직접 호출한다. 이 단계는 실제 index 를 건드리지 않는다. 다만
#        · 판정 fixture(agent-vault/10-Flow/tasks/T-977~998·T-956~969-hooktest-*.md)를 **실제 작업 트리에** 잠시
#          썼다가 EXIT trap 으로 지운다(kill -9 같은 강제 종료면 남을 수 있다). 실행 중 다른 세션이
#          `git add -A` 하면 그 커밋에 섞일 수 있다.
#        · 가짜 blob 은 .git/objects 에 dangling object 로 남는다(`git gc` 로 정리된다).
#   2) [E2E] 단계 — 로직 시나리오가 전부 통과하고 core.hooksPath 가 설정돼 있을 때만 돈다.
#      **실제 index** 에 가짜 blob(src/lib/safety/dry-run.ts)을 올리고 실제 `git commit` 을 시도한다
#      (훅이 막아야 정상). 끝나면 `git read-tree HEAD` 로 되돌리는데, 이 명령은 index 전체를 HEAD 로
#      덮어쓴다 → **그 시점에 어느 세션이 stage 해 둔 변경이든 전부 지운다**(작업 트리 파일 내용은
#      그대로이고 stage 만 사라진다). 시작 전에 stage 가 비어 있지 않으면 E2E 를 건너뛰지만, 그 확인과
#      되돌리기 사이(수 초)에 다른 세션이 stage 하면 그 stage 가 지워지고, 그 사이 다른 세션이 커밋하면
#      가짜 dry-run.ts 내용이 그 커밋에 실릴 수 있다. 훅이 fail-open 이어서 커밋이 실제로 생기면
#      `git reset --soft` 로 HEAD 를 되돌린다.
#   3) [T-090 임시 저장소 E2E] — 로직 시나리오 단계 끝에서 `mktemp -d` 아래에 **일회용 저장소**를 만들어 진짜
#      `git commit` 으로 이 작업 트리의 훅($ROOT/scripts/git-hooks/commit-msg)을 호출한다. 실제 저장소의 index·HEAD·
#      설정은 건드리지 않는다(위 2) 의 [E2E] 는 *설치된* 훅을, 이쪽은 *이 작업 트리의* 훅을 시험한다).
#   4) [T-165 설치 범위] — WORK 아래의 독립 저장소·linked worktree 두 곳에서 설치/재설치와
#      실제 훅 커밋을 시험한다. 현재 저장소/다른 머신의 config·설치된 shim 은 변경하지 않는다.
#
#   ⇒ **다른 세션이 stage 중이거나 커밋 직전일 때는 실행하지 말 것.** 실행 전에 index 가 비었는지 확인:
#        git diff --cached --quiet && echo "stage 비어 있음 — 실행 가능" || git diff --cached --name-only
#      파일 목록이 나오면 누군가 stage 중이다 — 그 세션과 조율한 뒤 실행한다.
#
set -u

if declare -p GIT_CONFIG >/dev/null 2>&1; then
  echo "❌ GIT_CONFIG 환경에서는 실제 hooksPath를 판별할 수 없습니다 — 해제한 뒤 실행하세요." >&2
  exit 1
fi

VERBOSE=0
[ "${1:-}" = "-v" ] && VERBOSE=1

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -z "$ROOT" ] && { echo "git 저장소 안에서 실행하세요." >&2; exit 1; }
cd "$ROOT" || exit 1

HOOK="scripts/git-hooks/commit-msg"
[ -f "$HOOK" ] || { echo "❌ $HOOK 가 없습니다." >&2; exit 1; }

WORK="$(mktemp -d)"
FIXTURES=()
remove_fixtures() {
  for f in "${FIXTURES[@]:-}"; do [ -n "$f" ] && rm -f "$f"; done
  FIXTURES=()
}
cleanup() {
  rm -rf "$WORK"
  remove_fixtures
}
trap cleanup EXIT

PASS_N=0
FAIL_N=0

# stage_and_run <expected_exit> <label> <commit_msg_file> <staged_path>...
stage_and_run() {
  local expected="$1"; shift
  local label="$1"; shift
  local msgfile="$1"; shift

  local idx="$WORK/index.$$"
  rm -f "$idx"
  GIT_INDEX_FILE="$idx" git read-tree HEAD || { echo "read-tree 실패"; return 1; }

  local blob
  blob="$(printf 'dummy change for hook test\n' | git hash-object -w --stdin)"
  local p
  for p in "$@"; do
    GIT_INDEX_FILE="$idx" git update-index --add --cacheinfo "100644,$blob,$p" || return 1
  done

  local out rc
  out="$(GIT_INDEX_FILE="$idx" bash "$HOOK" "$msgfile" 2>&1)"
  rc=$?

  # (T-075) 선택 단언 — EXPECT_OUT 이 비어 있지 않으면 훅 출력에 그 문자열도 있어야 통과.
  # 비어 있으면(기존 시나리오 전부) 종료코드만 본다 — 기존 동작 그대로다.
  local out_ok=1
  if [ -n "$EXPECT_OUT" ]; then
    case "$out" in *"$EXPECT_OUT"*) ;; *) out_ok=0 ;; esac
  fi

  if [ "$rc" -eq "$expected" ] && [ "$out_ok" -eq 1 ]; then
    printf '  ✅ %-62s (exit %d, 기대 %d)\n' "$label" "$rc" "$expected"
    PASS_N=$((PASS_N + 1))
  else
    printf '  ❌ %-62s (exit %d, 기대 %d)\n' "$label" "$rc" "$expected"
    if [ "$out_ok" -eq 0 ]; then
      printf '       └ 훅 출력에 기대 문자열이 없음: %s\n' "$EXPECT_OUT"
    fi
    FAIL_N=$((FAIL_N + 1))
    VERBOSE=1
  fi
  if [ "$VERBOSE" -eq 1 ]; then
    printf '%s\n' "$out" | sed 's/^/       │ /'
    echo ""
  fi
}

msg() { printf '%s\n' "$1" > "$WORK/msg"; printf '%s' "$WORK/msg"; }

# stage_and_run_expect <훅 출력에 있어야 할 문자열> <expected_exit> <label> <commit_msg_file> <staged_path>...
# (T-075) 통과(exit 0) 시나리오는 종료코드만으로 "안전경로가 아니라 조용히 통과"와
# "안전경로로 인식된 뒤 유효 판정으로 통과"를 구분하지 못한다. 후자를 고정할 때 쓴다.
# 함수 앞 임시 대입(VAR=x func) 대신 명시 대입·해제를 쓴다 — POSIX 모드에서는 임시 대입이
# 호출 뒤에도 남아 이후 시나리오를 오염시키기 때문이다.
EXPECT_OUT=""
stage_and_run_expect() {
  EXPECT_OUT="$1"; shift
  stage_and_run "$@"
  EXPECT_OUT=""
}

SAFETY_FILE="src/lib/safety/dry-run.ts"

echo ""
echo "commit-msg 훅 검증 — 실제 커밋 없이 임시 index 로 실행"
echo "─────────────────────────────────────────────────────────────────────────"
echo ""
echo "[Leader 지정 시나리오]"

# (a) 안전 경로 파일 + task ID 없는 메시지 → 차단
stage_and_run 1 "(a) 안전파일 + task ID 없음 → 차단" \
  "$(msg 'fix: 손절 로직 미세 조정')" "$SAFETY_FILE"

# (b) 안전 경로 파일 + 존재하지 않는 task ID → 차단
stage_and_run 1 "(b) 안전파일 + 없는 task ID(T-999) → 차단" \
  "$(msg 'fix(T-999): 손절 로직 미세 조정')" "$SAFETY_FILE"

# (c) 안전 경로 파일 + Reviewer 최종 판정(scope 포함)이 있는 task → 통과
cat > "agent-vault/10-Flow/tasks/T-995-hooktest-scoped-pass.md" <<'EOF'
---
task_id: T-995
---
## Reviewer 기록
- [09:00] submitOrder 경로 전수 확인. 결함 없음.
- [09:05] **최종 판정: PASS (scope: src/lib/safety/)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-995-hooktest-scoped-pass.md")
stage_and_run 0 "(c) 안전파일 + 최종 판정 PASS(scope 일치) → 통과" \
  "$(msg 'fix(T-995): 주문 수량 사이징 보정')" "$SAFETY_FILE"

# (c2) 구형식 판정(scope 없음)은 이제 통과시키지 않는다 — REQUIRE_SCOPE=1 효과.
#      T-020 은 `**최종 판정: PASS.**` 만 있고 검토 범위 표기가 없다.
stage_and_run 1 "(c2) 실제 T-020(구형식·scope 없음) 인용 → 차단" \
  "$(msg 'fix(T-020): 주문 수량 사이징 보정')" "$SAFETY_FILE"

# (d) 안전 경로 밖 파일만 → task ID 없어도 통과
stage_and_run 0 "(d) README.md 만 변경 → task ID 없어도 통과" \
  "$(msg 'docs: 오탈자 수정')" "README.md"

echo ""
echo "[추가 fail-open / 오탐 방지 시나리오]"

# (e) Reviewer 섹션은 있으나 PASS 기록이 아직 없는 task → 차단
#     ⚠ 실제 task 파일(T-025 등)을 쓰면 Reviewer 가 판정을 기록하는 순간 이 케이스가 뒤집힌다.
#        판정 전/후 상태를 고정해야 하므로 전용 fixture 를 쓴다.
cat > "agent-vault/10-Flow/tasks/T-993-hooktest-noverdict.md" <<'EOF'
---
task_id: T-993
---
## Developer 기록
- [09:00] 구현 완료, Reviewer 인계.

## Reviewer 기록

## QA 기록
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-993-hooktest-noverdict.md")
stage_and_run 1 "(e) Reviewer 섹션 있으나 판정 미기록 → 차단" \
  "$(msg 'chore(T-993): 훅 추가')" "$SAFETY_FILE"

# (f) BYPASS / PASSWORD 같은 단어가 PASS 로 오인되지 않는지
cat > "agent-vault/10-Flow/tasks/T-990-hooktest-bypass.md" <<'EOF'
---
task_id: T-990
---
## Reviewer 기록
- 안전장치 BYPASS 경로 점검 중. PASSWORD 노출 여부도 확인. 아직 판정 전.
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-990-hooktest-bypass.md")
stage_and_run 1 "(f) Reviewer 섹션에 BYPASS/PASSWORD 만 → PASS 로 오인 않고 차단" \
  "$(msg 'fix(T-990): 테스트')" "$SAFETY_FILE"

# (g) CONDITIONAL_PASS 도 통과해야 한다
cat > "agent-vault/10-Flow/tasks/T-991-hooktest-conditional.md" <<'EOF'
---
task_id: T-991
---
## Reviewer 기록
- [10:00] Medium 1건은 후속 과제로 이월.
- [10:01] **최종 판정: CONDITIONAL_PASS (scope: src/lib/safety/)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-991-hooktest-conditional.md")
stage_and_run 0 "(g) CONDITIONAL_PASS 기록 → 통과" \
  "$(msg 'fix(T-991): 테스트')" "$SAFETY_FILE"

# (h) QA 섹션에만 'Reviewer PASS' 언급이 있는 경우 → 인정하지 않음
cat > "agent-vault/10-Flow/tasks/T-992-hooktest-qaonly.md" <<'EOF'
---
task_id: T-992
---
## QA 기록
- [11:00] Reviewer PASS 를 받았다고 들었음. QA 실행검증 완료.
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-992-hooktest-qaonly.md")
stage_and_run 1 "(h) QA 섹션의 'Reviewer PASS' 언급만 → 인정 않고 차단" \
  "$(msg 'fix(T-992): 테스트')" "$SAFETY_FILE"

# (i) commit -v 의 verbose diff 안에 T-020 이 있어도 본문에 없으면 차단
{
  printf 'fix: 손절 로직 미세 조정\n'
  printf '# ------------------------ >8 ------------------------\n'
  printf '# Do not modify or remove the line above.\n'
  printf 'diff --git a/x b/x\n'
  printf '+// T-020 관련 주석\n'
} > "$WORK/msg_verbose"
stage_and_run 1 "(i) verbose diff 속 T-020 → 본문 아님, 차단" \
  "$WORK/msg_verbose" "$SAFETY_FILE"

# (j) 여러 task ID 중 하나만 유효 판정이어도 통과 (기존 묶음 배포 관행 보존)
stage_and_run 0 "(j) T-993(판정없음) + T-995(PASS·scope일치) 동시 참조 → 통과" \
  "$(msg 'feat(T-993,T-995): 묶음 배포')" "$SAFETY_FILE"

# (k) 경계 오탐 — refT-020 / T-0255 는 task ID 로 인정하지 않는다
stage_and_run 1 "(k) 'refT-020' 형태는 task ID 로 인정 안 함 → 차단" \
  "$(msg 'fix: see refT-020')" "$SAFETY_FILE"

# (l) 확장된 안전 경로 — 전략/시그널 엔진도 검사 대상
stage_and_run 1 "(l) src/lib/strategy/exit-engine.ts (확장 경로) → 차단" \
  "$(msg 'fix: 청산 엔진 조정')" "src/lib/strategy/exit-engine.ts"

# (m) 훅 자기보호 — scripts/git-hooks/ 변경도 검사 대상
stage_and_run 1 "(m) scripts/git-hooks/commit-msg 자체 변경 → 검사 대상" \
  "$(msg 'chore: 훅 살짝 수정')" "scripts/git-hooks/commit-msg"

# (n) vault·문서만 변경 → 통과 (평소 작업 흐름 비차단)
stage_and_run 0 "(n) agent-vault 문서만 변경 → 통과" \
  "$(msg 'docs: task 이력 갱신')" "agent-vault/10-Flow/board.md"

# (o) 자기보호 순환 해소 — Reviewer PASS 가 기록된 task 를 참조하면
#     이 훅 자신을 바꾸는 커밋도 통과한다(무한순환이 아님을 실증).
#     ⚠ (e)와 같은 이유로 실제 T-025 파일을 쓰지 않는다 — T-025 의 Reviewer 섹션은
#        감사 라운드에 따라 PASS/비어있음 사이를 오가므로 테스트 전제가 될 수 없다.
cat > "agent-vault/10-Flow/tasks/T-994-hooktest-selfprotect.md" <<'EOF'
---
task_id: T-994
---
## Reviewer 기록
- [12:00] 훅 자기보호 순환 해소 검증용 fixture.
- [12:01] **최종 판정: PASS (scope: scripts/git-hooks/, scripts/install-git-hooks.sh)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-994-hooktest-selfprotect.md")
stage_and_run 0 "(o) Reviewer PASS 기록된 task 참조 → 훅 자신의 커밋도 통과" \
  "$(msg 'feat(T-994): 커밋 전 Reviewer PASS 강제 훅 도입')" \
  "scripts/git-hooks/commit-msg" "scripts/install-git-hooks.sh"

echo ""
echo "[REV-025 라운드2 지적 — 커버리지 회귀 방지]"

# (p) H2 — 훅을 설치·검증하는 스크립트 자신도 보호 대상이어야 한다
stage_and_run 1 "(p) [H2] scripts/install-git-hooks.sh 변경 → 차단" \
  "$(msg 'chore: 설치 스크립트 손보기')" "scripts/install-git-hooks.sh"

stage_and_run 1 "(q) [H2] scripts/test-git-hooks.sh 변경 → 차단" \
  "$(msg 'chore: 테스트 스크립트 손보기')" "scripts/test-git-hooks.sh"

# (r) 설정 API 커버리지 공백 — blocked-symbols 는 현재 유일한 실효 심볼 안전장치(HIGH)
stage_and_run 1 "(r) [HIGH] settings/blocked-symbols → 차단" \
  "$(msg 'chore: 블랙리스트 변경')" "src/app/api/settings/blocked-symbols/route.ts"

stage_and_run 1 "(r2) settings/strategies (전략 on/off) → 차단" \
  "$(msg 'chore: 전략 토글')" "src/app/api/settings/strategies/route.ts"

# (s) 회원별 KIS 자격증명 경로 커버리지 공백 (MEDIUM)
stage_and_run 1 "(s) profile/kis·auth/users.ts·owner-kis-migration.ts → 차단" \
  "$(msg 'chore: 자격증명 저장 수정')" \
  "src/app/api/profile/kis/route.ts" \
  "src/lib/auth/users.ts" \
  "src/lib/auth/owner-kis-migration.ts"

# (t) Developer 추가분 — 자격증명 암호화 모듈 / autopilot 스위치 경로
stage_and_run 1 "(t) auth/secret-box.ts·settings/hybrid (Developer 추가분) → 차단" \
  "$(msg 'chore: 암호화·하이브리드 설정 수정')" \
  "src/lib/auth/secret-box.ts" "src/app/api/settings/hybrid/route.ts"

# (t42) T-042 — 텔레그램 버튼 승인의 입구(봇 클라이언트·폴러 기동)와 승인 핸들러가 게이트에 걸린다
stage_and_run 1 "(t42a) notify/telegram-api.ts (봇 입구) → 차단" \
  "$(msg 'chore: 텔레그램 봇 클라이언트 수정')" "src/lib/notify/telegram-api.ts"
stage_and_run 1 "(t42b) instrumentation.ts (폴러 기동) → 차단" \
  "$(msg 'chore: 기동 훅 수정')" "src/instrumentation.ts"
stage_and_run 1 "(t42c) signals/telegram-approval.ts·telegram-poller.ts (승인 핸들러·폴러) → 차단" \
  "$(msg 'chore: 버튼 승인 핸들러 수정')" "src/lib/signals/telegram-approval.ts" "src/lib/signals/telegram-poller.ts"
stage_and_run 1 "(t42e) telegram-api.test.ts·instrumentation-shape.test.ts (안전 경로의 테스트) → 차단" \
  "$(msg 'chore: 봇 클라이언트 테스트 수정')" "src/lib/notify/__tests__/telegram-api.test.ts" "src/__tests__/instrumentation-shape.test.ts"
# 과도차단 방지: 같은 디렉토리의 일반 알림 코드는 자금과 무관 — 걸리지 않는다
stage_and_run 0 "(t42d) notify/slack.ts (일반 알림) → 비차단" \
  "$(msg 'chore: 슬랙 알림 문구')" "src/lib/notify/slack.ts"

# (u) 확대 후에도 자금 무관 경로는 여전히 비차단이어야 한다 (과도차단 회귀 방지)
#     watch-symbols 는 `system_config.watch_symbols` 를 읽는 코드가 src/ 에 0건이라 의도적 제외.
stage_and_run 0 "(u) llm-provider·notify-channel·watch-symbols → 여전히 통과(의도적 제외)" \
  "$(msg 'chore: LLM 공급자·알림채널·관심종목 변경')" \
  "src/app/api/settings/llm-provider/route.ts" \
  "src/app/api/settings/notify-channel/route.ts" \
  "src/app/api/settings/watch-symbols/route.ts"

echo ""
echo "[REV-025 라운드3 지적 — CRITICAL '차용된 정당성' / H3 판정해석 / 인증관문]"

# (v) [CRITICAL] 무관한 과거 task 의 판정을 끌어와 다른 안전파일을 통과시키려는 시도
#     T-995 의 판정 scope 는 src/lib/safety/ 뿐이다. 인증 미들웨어는 그 범위 밖.
stage_and_run 1 "(v) [CRITICAL] scope 밖 파일(middleware.ts)을 T-995 로 통과 시도 → 차단" \
  "$(msg 'fix(T-995): 인증 미들웨어 슬쩍 손보기 (실제로는 무관)')" \
  "src/middleware.ts" "src/lib/exchanges/kis.ts"

# (v2) scope 안에 있으면 정상 통과 — 과도차단 회귀 방지
cat > "agent-vault/10-Flow/tasks/T-996-hooktest-multiscope.md" <<'EOF'
---
task_id: T-996
---
## Reviewer 기록
- [09:10] **최종 판정: PASS (scope: src/middleware.ts, src/lib/auth/session.ts)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-996-hooktest-multiscope.md")
stage_and_run 0 "(v2) 같은 파일을 실제 검토한 T-996(scope 일치) 인용 → 통과" \
  "$(msg 'fix(T-996): 인증 미들웨어 수정')" \
  "src/middleware.ts" "src/lib/auth/session.ts"

# (w) [H3] 마지막 '최종 판정' 줄만 권위 — 앞에 PASS 가 있어도 뒤가 FAIL 이면 차단
cat > "agent-vault/10-Flow/tasks/T-997-hooktest-lastwins.md" <<'EOF'
---
task_id: T-997
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/safety/)**
- [09:30] 라운드2 재감사에서 HIGH 2건 발견.
- [09:40] **정정된 최종 판정: FAIL (scope: src/lib/safety/)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-997-hooktest-lastwins.md")
stage_and_run 1 "(w) [H3] PASS 뒤에 FAIL 이 오면 마지막 판정 채택 → 차단" \
  "$(msg 'fix(T-997): 수정')" "$SAFETY_FILE"

# (w2) [H3] 반대로 FAIL 뒤 재감사 PASS 면 통과해야 한다
cat > "agent-vault/10-Flow/tasks/T-998-hooktest-refixed.md" <<'EOF'
---
task_id: T-998
---
## Reviewer 기록
- [09:00] **최종 판정: FAIL (scope: src/lib/safety/)**
- [09:50] 지적 2건 해소 확인.
- [10:00] **최종 판정: CONDITIONAL_PASS (scope: src/lib/safety/)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-998-hooktest-refixed.md")
stage_and_run 0 "(w2) [H3] FAIL 뒤 재감사 CONDITIONAL_PASS → 통과" \
  "$(msg 'fix(T-998): 수정')" "$SAFETY_FILE"

# (x) [H3] 판정 단어를 '설명'만 하는 산문은 판정으로 인정하지 않는다
#     ← 이 결함을 서술하는 문서가 스스로 fail-open 되던 함정
cat > "agent-vault/10-Flow/tasks/T-989-hooktest-prose.md" <<'EOF'
---
task_id: T-989
---
## Reviewer 기록
- [09:00] 훅은 섹션에 PASS 나 CONDITIONAL_PASS 가 있으면 통과시킨다. FAIL 이 있어도 무시된다.
  이런 산문 인용만으로 통과되면 안 된다(판정 줄이 아님).
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-989-hooktest-prose.md")
stage_and_run 1 "(x) [H3] 판정 단어 산문 인용만 있고 판정 줄 없음 → 차단" \
  "$(msg 'fix(T-989): 수정')" "$SAFETY_FILE"

# (y) [HIGH] 인증 관문 자체도 보호 대상
stage_and_run 1 "(y) [HIGH] src/middleware.ts 단독 변경 → 차단" \
  "$(msg 'chore: 미들웨어 수정')" "src/middleware.ts"

stage_and_run 1 "(y2) [HIGH] src/lib/auth/session.ts 단독 변경 → 차단" \
  "$(msg 'chore: 세션 수정')" "src/lib/auth/session.ts"

# --- [라운드4 HIGH] scope 경계 매칭 -----------------------------------------
# 순수 문자열 접두어 비교라 경계가 없던 버그. 아래 2건이 회귀 방지 케이스다.
cat > "agent-vault/10-Flow/tasks/T-987-hooktest-scopeboundary.md" <<'EOF'
---
task_id: T-987
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/safety)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-987-hooktest-scopeboundary.md")
# 슬래시를 빠뜨린 scope 는 이제 아무것도 열지 않는다(fail-closed).
# 이전에는 src/lib/safetyX/ 같은 무관 디렉토리까지 통과시켰다.
stage_and_run 1 "(y3) [HIGH] scope 슬래시 누락 → 무관 디렉토리 열리지 않고 차단" \
  "$(msg 'fix(T-987): 수정')" "src/lib/safety/dry-run.ts"

cat > "agent-vault/10-Flow/tasks/T-986-hooktest-exactfile.md" <<'EOF'
---
task_id: T-986
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/auth/session.ts)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-986-hooktest-exactfile.md")
# 파일 단위 scope 는 정확히 그 파일만. 접두어가 겹치는 다른 경로는 열리지 않는다.
stage_and_run 1 "(y4) [HIGH] 파일 scope 에 접두어만 겹치는 다른 파일 → 차단" \
  "$(msg 'fix(T-986): 수정')" "src/lib/auth/session-cookie.ts"

stage_and_run 0 "(y5) 파일 scope 와 정확히 일치하는 파일 → 통과" \
  "$(msg 'fix(T-986): 세션 수정')" "src/lib/auth/session.ts"

echo ""
echo "[라운드4 — src/lib/auth/ 전수조사 결과 / 판정형식 / 테스트파일 정책]"

# (z) [HIGH] OAUTH_PUBLIC_PATHS — middleware.ts 를 건드리지 않고 무인증 경로를 여는 우회로
stage_and_run 1 "(z) [HIGH] auth/oauth/names.ts (무인증 경로 목록) → 차단" \
  "$(msg 'chore: OAuth 경로 추가')" "src/lib/auth/oauth/names.ts"

stage_and_run 1 "(z2) auth/oauth/ 하위 신규 파일도 디렉토리 전체 매치로 차단" \
  "$(msg 'chore: OAuth 신규 모듈')" "src/lib/auth/oauth/brand-new-provider.ts"

# (z3) 세션 쿠키 속성·2차 방어선·비밀번호 해싱·KIS 자격증명 검증
stage_and_run 1 "(z3) session-cookie·current-user·password·kis-verify → 차단" \
  "$(msg 'chore: 인증 보조 모듈 수정')" \
  "src/lib/auth/session-cookie.ts" "src/lib/auth/current-user.ts" \
  "src/lib/auth/password.ts" "src/lib/auth/kis-verify.ts"

# (z4) 제외 판단 회귀 고정 — 시도제한(rate limit) 계열은 여전히 통과해야 한다
#   (T-092 갱신) 원래 묶음에 있던 src/lib/auth/signup-gate.ts 는 속도 제한이 아니라 초대코드 대조(접근 통제)라
#   T-092 에서 목록에 들어갔다 → 이 시나리오에서 빼고, 실제 속도 제한인 signup-request-gate.ts 로 바꿨다.
#   signup-gate.ts 가 이제 걸린다는 단언은 아래 '[T-092 …]' 절(t092-a*)에 있다.
stage_and_run 0 "(z4) attempt/login/signup-request gate·request-limits → 통과(의도적 제외)" \
  "$(msg 'chore: 로그인 시도제한 임계값 조정')" \
  "src/lib/auth/attempt-gate.ts" "src/lib/auth/login-gate.ts" \
  "src/lib/auth/signup-request-gate.ts" "src/lib/auth/request-limits.ts"

# (z5) 테스트 파일 정책 — 제외하지 않기로 했으므로 안전경로의 테스트도 계속 차단된다
stage_and_run 1 "(z5) [정책] 안전경로 테스트 파일도 계속 차단(제외 안 함)" \
  "$(msg 'test: 안전장치 테스트 조정')" \
  "src/lib/safety/__tests__/order-limits.test.ts" \
  "src/app/api/cron/__tests__/entry-watcher.test.ts"

# (z6) scope 부분집합 판정 — 접두어가 겹치기만 하는 다른 디렉토리는 범위 밖이어야 한다
cat > "agent-vault/10-Flow/tasks/T-988-hooktest-prefix.md" <<'EOF'
---
task_id: T-988
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/auth/session.ts)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-988-hooktest-prefix.md")
stage_and_run 0 "(z6) scope 가 정확히 그 파일이면 통과" \
  "$(msg 'fix(T-988): 세션 검증 보정')" "src/lib/auth/session.ts"

stage_and_run 1 "(z6b) 같은 디렉토리의 다른 파일은 그 scope 밖 → 차단" \
  "$(msg 'fix(T-988): 세션 검증 보정')" \
  "src/lib/auth/session.ts" "src/lib/auth/password.ts"

echo ""
echo "[라운드5 — scope 경계 매칭 / 다중 task 합집합(요구사항4)]"

# (aa) 파일 scope 는 완전 일치여야 한다. 접두어만 겹치는 다른 안전파일은 통과하면 안 된다.
#      `src/lib/auth/oauth/names.ts.bak` 은 `^src/lib/auth/oauth/` 로 실제 안전파일이면서
#      문자열상 `src/lib/auth/oauth/names.ts` 로 시작한다 — 순수 접두어 비교였다면 통과했다.
cat > "agent-vault/10-Flow/tasks/T-987-hooktest-boundary.md" <<'EOF'
---
task_id: T-987
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/auth/oauth/names.ts)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-987-hooktest-boundary.md")
stage_and_run 1 "(aa) [HIGH] 파일 scope + 접두어만 겹치는 안전파일 → 차단" \
  "$(msg 'fix(T-987): 경계 우회 시도')" "src/lib/auth/oauth/names.ts.bak"

stage_and_run 0 "(aa2) 파일 scope + 정확히 그 파일 → 통과" \
  "$(msg 'fix(T-987): OAuth 경로 목록 수정')" "src/lib/auth/oauth/names.ts"

# (ab) 디렉토리 scope 도 경계가 있어야 한다 — `src/app/api/cron/entry-watcher` (슬래시 없음)가
#      `entry-watcher-old/` 까지 열면 안 된다. 둘 다 `^src/app/api/cron/` 로 안전파일이다.
cat > "agent-vault/10-Flow/tasks/T-986-hooktest-dirboundary.md" <<'EOF'
---
task_id: T-986
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/app/api/cron/entry-watcher/)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-986-hooktest-dirboundary.md")
stage_and_run 1 "(ab) [HIGH] 디렉토리 scope + 이름만 겹치는 형제 디렉토리 → 차단" \
  "$(msg 'fix(T-986): 경계 우회 시도')" "src/app/api/cron/entry-watcher-old/route.ts"

stage_and_run 0 "(ab2) 디렉토리 scope + 그 하위 파일 → 통과(정상 디렉토리 매칭)" \
  "$(msg 'fix(T-986): 진입 감시 조정')" "src/app/api/cron/entry-watcher/route.ts"

# (ac) [요구사항4] 신형식 task 2개를 묶은 커밋 — 각 task 가 자기 몫을 검토했다면 통과해야 한다.
#      T-995 scope=src/lib/safety/ · T-996 scope=src/middleware.ts, src/lib/auth/session.ts
stage_and_run 0 "(ac) [요구사항4] 신형식 2개 참조 + 각 scope 에 나뉜 파일 → 통과" \
  "$(msg 'feat(T-995,T-996): 묶음 배포')" \
  "$SAFETY_FILE" "src/middleware.ts" "src/lib/auth/session.ts"

# (ac2) 합집합이어도 어느 scope 에도 없는 파일이 끼면 차단된다
stage_and_run 1 "(ac2) 합집합 밖 파일이 하나라도 끼면 → 차단" \
  "$(msg 'feat(T-995,T-996): 묶음 배포')" \
  "$SAFETY_FILE" "src/lib/exchanges/kis.ts"

# (ad) [필수] 구 형식 task 는 합집합을 넓히지 못한다.
#      T-020(구형식·scope 없음)이 kis.ts 를 열어 주면 안 된다 — 신형식 T-995 만 기여한다.
stage_and_run 1 "(ad) 신형식+구형식 동시 참조, 구형식 몫 파일 → 차단" \
  "$(msg 'fix(T-995,T-020): 사이징 + 안전장치')" \
  "$SAFETY_FILE" "src/lib/exchanges/kis.ts"

echo ""
echo "[T-075 — 전략 검증 입구 · 공유 DDL · 부팅 DDL 경로 추가]"

# 경로마다 ①판정 미기록 → 차단 ②유효 판정(scope 포함) → 통과 ③scope 밖 → 차단.
# 각 시나리오는 새 경로 파일 **하나만** stage 한다 — 그래야 목록에서 그 경로 하나만 빠져도
# 그 경로의 ①·②·③ 이 실패한다(경로별 변이 감지). ② 는 종료코드 0 만으로는 "안전경로가 아니라
# 조용히 통과"와 구분되지 않으므로 훅의 통과 문구까지 확인한다(stage_and_run_expect).
T075_STRAT="src/app/api/strategies/[id]/route.ts"          # 실제 PATCH 입구
T075_MIG="scripts/migrations/T-999-hooktest-new.sql"        # 신규 SQL 파일(디렉토리 전체 매치)
T075_DB="src/lib/db.ts"                                     # 부팅 DDL(setupDB)
T075_OK="Reviewer 감사 기록 확인"                           # 훅이 유효 판정 통과 때만 내는 문구

cat > "agent-vault/10-Flow/tasks/T-985-hooktest-t075-scoped.md" <<'EOF'
---
task_id: T-985
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/app/api/strategies/, scripts/migrations/, src/lib/db.ts)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-985-hooktest-t075-scoped.md")

# ③ 용 — 이름이 비슷한 '이웃' 경로만 검토한 판정. 새 3경로 어느 것도 덮지 않아야 한다.
#    settings/strategies/ ≠ strategies/ · cron-runner.sh ≠ migrations/ · 디렉토리 src/lib/db/ ≠ 파일 src/lib/db.ts
cat > "agent-vault/10-Flow/tasks/T-984-hooktest-t075-nearmiss.md" <<'EOF'
---
task_id: T-984
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/app/api/settings/strategies/, scripts/cron-runner.sh, src/lib/db/)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-984-hooktest-t075-nearmiss.md")

stage_and_run 1 "(t075-a1) strategies/[id]/route.ts + 판정 미기록(T-993) → 차단" \
  "$(msg 'fix(T-993): 전략 PATCH 필드 추가')" "$T075_STRAT"
stage_and_run_expect "$T075_OK" 0 "(t075-a2) strategies/[id]/route.ts + T-985(scope 포함) → 통과" \
  "$(msg 'fix(T-985): 전략 PATCH 필드 추가')" "$T075_STRAT"
stage_and_run 1 "(t075-a3) strategies/[id]/route.ts + T-984(이웃 경로 scope) → 차단" \
  "$(msg 'fix(T-984): 전략 PATCH 필드 추가')" "$T075_STRAT"

stage_and_run 1 "(t075-b1) scripts/migrations/ 신규 SQL + 판정 미기록(T-993) → 차단" \
  "$(msg 'feat(T-993): 테이블 추가 DDL')" "$T075_MIG"
stage_and_run_expect "$T075_OK" 0 "(t075-b2) scripts/migrations/ 신규 SQL + T-985(scope 포함) → 통과" \
  "$(msg 'feat(T-985): 테이블 추가 DDL')" "$T075_MIG"
stage_and_run 1 "(t075-b3) scripts/migrations/ 신규 SQL + T-984(이웃 경로 scope) → 차단" \
  "$(msg 'feat(T-984): 테이블 추가 DDL')" "$T075_MIG"

stage_and_run 1 "(t075-c1) src/lib/db.ts + 판정 미기록(T-993) → 차단" \
  "$(msg 'fix(T-993): setupDB 컬럼 추가')" "$T075_DB"
stage_and_run_expect "$T075_OK" 0 "(t075-c2) src/lib/db.ts + T-985(scope 포함) → 통과" \
  "$(msg 'fix(T-985): setupDB 컬럼 추가')" "$T075_DB"
stage_and_run 1 "(t075-c3) src/lib/db.ts + T-984(이웃 경로 scope) → 차단" \
  "$(msg 'fix(T-984): setupDB 컬럼 추가')" "$T075_DB"

# 사용자 결정(2026-10-23 "권고대로")으로 넣지 않은 경로 — 계속 비차단이어야 한다(과도차단 회귀 방지)
stage_and_run 0 "(t075-x) settings/risk-policy·lib/reports → 여전히 통과(미포함 결정)" \
  "$(msg 'chore: 리스크 정책·리포트 수정')" \
  "src/app/api/settings/risk-policy/route.ts" "src/lib/reports/trade-report.ts"

echo ""
echo "[T-075 Stage 2 — 인접 경로 비차단 · 하위 경로 차단 (Reviewer 지적 1)]"

# 이름만 비슷한 이웃 경로는 감사 대상이 아니다 — task ID 없이도 통과해야 한다.
# 통과 기대 시나리오는 묶어도 약해지지 않는다(하나라도 잘못 매치되면 exit 1 로 실패).
# 줄마다 겨냥하는 변이: 끝 `$` 삭제(db.ts.bak) · `^` 삭제(앞에 디렉토리가 붙은 경로) · `.` 이스케이프
# 누락(db_ts) · `^src/lib/db` 확대(db.test.ts) · 끝 `/` 삭제(-foo/·-old/) · `^scripts/` 확대(other.sh).
stage_and_run 0 "(t075-n1) db.ts 이웃(db.ts.bak·db.test.ts·db_ts·foo/src/lib/db.ts) → 통과" \
  "$(msg 'chore: 이웃 파일 정리')" \
  "src/lib/db.ts.bak" "src/lib/db.test.ts" "src/lib/db_ts" "foo/src/lib/db.ts"
stage_and_run 0 "(t075-n2) strategies 이웃(strategies-foo/·mockups/…/strategies/) → 통과" \
  "$(msg 'chore: 이웃 라우트 정리')" \
  "src/app/api/strategies-foo/x.ts" "mockups/src/app/api/strategies/route.ts"
stage_and_run 0 "(t075-n3) migrations 이웃(migrations-old/·other.sh·docs/scripts/migrations/) → 통과" \
  "$(msg 'chore: 이웃 스크립트 정리')" \
  "scripts/migrations-old/x.sql" "scripts/other.sh" "docs/scripts/migrations/x.sql"

# 하위 경로·대괄호 경로·비 .sql 파일도 디렉토리 전체 매치로 감사 대상이다.
# 차단 기대 시나리오는 묶으면 하나만 새도 다른 하나가 막아 가려지므로 경로 하나씩 둔다.
# 겨냥 변이: migrations 를 최상위 `.sql` 로 축소 · strategies 를 최상위 파일로 축소.
stage_and_run 1 "(t075-p1) strategies/[id]/__tests__/route.test.ts (하위·대괄호) → 차단" \
  "$(msg 'test: 전략 PATCH 시험 수정')" "src/app/api/strategies/[id]/__tests__/route.test.ts"
stage_and_run 1 "(t075-p2) scripts/migrations/sub/rollback.sh (하위 폴더·비 .sql) → 차단" \
  "$(msg 'chore: 롤백 스크립트 추가')" "scripts/migrations/sub/rollback.sh"

echo ""
echo "[T-075 Stage 2 — 비 ASCII·특수문자 파일명 우회 차단 (Reviewer 지적 2)]"

# git 기본값(core.quotePath=true)은 비 ASCII 이름을 따옴표·8진수로 인용해 `^src/…` 앵커가 빗나갔다.
# 따옴표(")가 든 이름은 core.quotePath=false 여도 인용되므로 k4 가 그 차이를 고정한다.
T075_KO="src/lib/safety/한글.ts"
stage_and_run 1 "(t075-k1) 안전경로 한글 파일명 + task ID 없음 → 차단" \
  "$(msg 'fix: 한글 이름 모듈')" "$T075_KO"
stage_and_run_expect "$T075_OK" 0 "(t075-k2) 안전경로 한글 파일명 + T-995(scope 포함) → 통과" \
  "$(msg 'fix(T-995): 한글 이름 모듈')" "$T075_KO"
stage_and_run 1 "(t075-k3) 새 경로 아래 한글 파일명(scripts/migrations/) → 차단" \
  "$(msg 'feat: 한글 이름 DDL')" "scripts/migrations/한글.sql"
stage_and_run 1 "(t075-k4) 안전경로 따옴표 든 파일명(quotePath=false 로는 못 막음) → 차단" \
  "$(msg 'fix: 특수문자 이름')" 'src/lib/safety/a"b.ts'

# (t075-k5) 목록을 파이프(-z | tr)로 읽게 바꾼 뒤에도 git 실패는 차단(fail-closed)이어야 한다.
#   깨진 index 를 주어 git diff 를 실패시킨다. stage_and_run 은 정상 index 를 만들어 쓰므로 여기만 직접 호출한다.
printf 'not an index\n' > "$WORK/broken.index"
k5_out="$(GIT_INDEX_FILE="$WORK/broken.index" bash "$HOOK" "$(msg 'fix: 아무거나')" 2>&1)"
k5_rc=$?
k5_label="(t075-k5) git 이 목록을 못 읽으면(깨진 index) → 차단·안내 문구"
case "$k5_out" in *"staged 파일 목록을 읽지 못했습니다"*) k5_msg=1 ;; *) k5_msg=0 ;; esac
if [ "$k5_rc" -eq 1 ] && [ "$k5_msg" -eq 1 ]; then
  printf '  ✅ %-62s (exit %d, 기대 %d)\n' "$k5_label" "$k5_rc" 1
  PASS_N=$((PASS_N + 1))
else
  printf '  ❌ %-62s (exit %d, 기대 %d)\n' "$k5_label" "$k5_rc" 1
  [ "$k5_msg" -eq 0 ] && printf '       └ 훅 출력에 기대 문자열이 없음: %s\n' "staged 파일 목록을 읽지 못했습니다"
  FAIL_N=$((FAIL_N + 1))
  VERBOSE=1
fi
if [ "$VERBOSE" -eq 1 ]; then
  printf '%s\n' "$k5_out" | sed 's/^/       │ /'
  echo ""
fi

echo ""
echo "[T-075 Stage 3 — 안전 경로 판별 grep 의 오류·비 UTF-8 이름 (Codex C2 지적 1)]"

# (t075-k6) 안전 경로 판별 grep 이 오류(rc 2·127·137)로 끝나도 "안전 경로 없음"으로 읽혀 통과하면 안 된다.
#   항상 실패하는 grep 대역을 PATH 맨 앞에 둔다. 훅은 이 판별 전에 grep 을 부르지 않으므로 대역이 닿는
#   첫 지점이 바로 그 판별이다. 안전 파일 1개 + task ID 없음 → 차단 + 안내 문구.
#   (WORK 가 noexec 마운트면 대역이 실행되지 않아 진짜 grep 이 쓰이고, 안내 문구가 없어 이 시나리오가
#    **실패**한다 — 조용히 통과하지 않는다.)
mkdir -p "$WORK/fakegrep"
for k6_rc in 2 127 137; do
  printf '#!/bin/sh\nexit %s\n' "$k6_rc" > "$WORK/fakegrep/grep"; chmod +x "$WORK/fakegrep/grep"
  k6_idx="$WORK/k6.index"; rm -f "$k6_idx"
  GIT_INDEX_FILE="$k6_idx" git read-tree HEAD
  k6_blob="$(printf 'dummy change for hook test\n' | git hash-object -w --stdin)"
  GIT_INDEX_FILE="$k6_idx" git update-index --add --cacheinfo "100644,$k6_blob,$SAFETY_FILE"
  k6_out="$(PATH="$WORK/fakegrep:$PATH" GIT_INDEX_FILE="$k6_idx" bash "$HOOK" "$(msg 'fix: 아무거나')" 2>&1)"
  k6_rc_hook=$?
  k6_label="(t075-k6) grep 오류(rc=$k6_rc) → 안전 경로 없음으로 읽지 않고 차단"
  case "$k6_out" in *"안전 경로 판별(grep)"*) k6_msg=1 ;; *) k6_msg=0 ;; esac
  if [ "$k6_rc_hook" -eq 1 ] && [ "$k6_msg" -eq 1 ]; then
    printf '  ✅ %-62s (exit %d, 기대 %d)\n' "$k6_label" "$k6_rc_hook" 1
    PASS_N=$((PASS_N + 1))
  else
    printf '  ❌ %-62s (exit %d, 기대 %d)\n' "$k6_label" "$k6_rc_hook" 1
    if [ "$k6_msg" -eq 0 ]; then
      printf '       └ 훅 출력에 기대 문자열이 없음: %s\n' "안전 경로 판별(grep)"
    fi
    FAIL_N=$((FAIL_N + 1))
    VERBOSE=1
  fi
  if [ "$VERBOSE" -eq 1 ]; then
    printf '%s\n' "$k6_out" | sed 's/^/       │ /'
    echo ""
  fi
done
rm -rf "$WORK/fakegrep"

# (t075-k7) 비 UTF-8 바이트 이름(EUC-KR "가" = 0xB0 0xA1)은 UTF-8 로케일의 grep 이 "binary file matches"
#   만 내고 출력을 지워 통과했다. 로케일을 UTF-8 로 고정해 환경과 무관하게 재현한다.
#   함수 앞 임시 대입(LC_ALL=… stage_and_run)을 쓰지 않는다 — POSIX 모드에서는 대입이 호출 뒤에도 남는다
#   (stage_and_run_expect 와 같은 이유). 명시적으로 export 하고 원래 값으로 되돌린다.
k7_had_lc="${LC_ALL+set}"; k7_prev_lc="${LC_ALL:-}"
export LC_ALL=C.UTF-8
stage_and_run 1 "(t075-k7) 안전경로 비 UTF-8 파일명(UTF-8 로케일) → 차단" \
  "$(msg 'fix: 비 UTF-8 이름')" "src/lib/safety/$(printf '\260\241').ts"
if [ "$k7_had_lc" = "set" ]; then export LC_ALL="$k7_prev_lc"; else unset LC_ALL; fi

echo ""
echo "[T-075 Stage 3b — 혼합 목록: 안전 파일의 위치와 무관하게 검사 (Reviewer 이전 MINOR)]"

# git 은 staged 목록을 경로 순(바이트 순)으로 내보낸다. 목록의 첫 줄이나 마지막 줄만 보는 회귀
# (`| head -n 1`·`| tail -n 1`)는 기존 시나리오 대부분이 파일 1개라서 드러나지 않았다.
# 안전 파일이 앞·뒤·가운데에 있는 세 가지 순서마다 ①판정 미기록 → 차단 ②scope 포함 → 통과
# ③scope 가 안전 파일을 빠뜨림 → 차단을 확인한다. (stage 순서는 의미가 없다 — git 이 정렬한다.)
#   앞: src/lib/safety/aaa.ts < zzz/notes.md       뒤: docs/aaa.md < src/lib/safety/zzz.ts
#   가운데: README.md < docs/a.md < src/lib/safety/mid.ts < zzz/b.md   (대문자가 소문자보다 앞)
T075_MIX_TAIL=( "docs/aaa.md" "src/lib/safety/zzz.ts" )
T075_MIX_HEAD=( "src/lib/safety/aaa.ts" "zzz/notes.md" )
T075_MIX_MID=( "README.md" "docs/a.md" "src/lib/safety/mid.ts" "zzz/b.md" )

stage_and_run 1 "(t075-m1) [비안전, 안전] 판정 미기록(T-993) → 차단" \
  "$(msg 'fix(T-993): 혼합 커밋')" "${T075_MIX_TAIL[@]}"
stage_and_run_expect "$T075_OK" 0 "(t075-m2) [비안전, 안전] T-995(scope 포함) → 통과" \
  "$(msg 'fix(T-995): 혼합 커밋')" "${T075_MIX_TAIL[@]}"
stage_and_run 1 "(t075-m3) [비안전, 안전] T-984(scope 가 안전 파일 빠뜨림) → 차단" \
  "$(msg 'fix(T-984): 혼합 커밋')" "${T075_MIX_TAIL[@]}"

stage_and_run 1 "(t075-m4) [안전, 비안전] 판정 미기록(T-993) → 차단" \
  "$(msg 'fix(T-993): 혼합 커밋')" "${T075_MIX_HEAD[@]}"
stage_and_run_expect "$T075_OK" 0 "(t075-m5) [안전, 비안전] T-995(scope 포함) → 통과" \
  "$(msg 'fix(T-995): 혼합 커밋')" "${T075_MIX_HEAD[@]}"
stage_and_run 1 "(t075-m6) [안전, 비안전] T-984(scope 가 안전 파일 빠뜨림) → 차단" \
  "$(msg 'fix(T-984): 혼합 커밋')" "${T075_MIX_HEAD[@]}"

stage_and_run 1 "(t075-m7) [비안전×2, 안전, 비안전] 판정 미기록(T-993) → 차단" \
  "$(msg 'fix(T-993): 혼합 커밋')" "${T075_MIX_MID[@]}"
stage_and_run_expect "$T075_OK" 0 "(t075-m8) [비안전×2, 안전, 비안전] T-995(scope 포함) → 통과" \
  "$(msg 'fix(T-995): 혼합 커밋')" "${T075_MIX_MID[@]}"
stage_and_run 1 "(t075-m9) [비안전×2, 안전, 비안전] T-984(scope 가 안전 파일 빠뜨림) → 차단" \
  "$(msg 'fix(T-984): 혼합 커밋')" "${T075_MIX_MID[@]}"

# 안전 파일이 2개일 때 scope 가 그중 하나만 덮으면 차단 — 판정 대조가 첫/마지막 안전 파일만 보는 회귀를 잡는다.
#   안전 파일 정렬: src/lib/safety/aaa.ts < src/lib/strategy/zzz.ts
#   m10: T-995(scope src/lib/safety/) 는 첫 파일만 덮는다 · m11: T-983(scope src/lib/strategy/) 는 마지막 파일만 덮는다
cat > "agent-vault/10-Flow/tasks/T-983-hooktest-t075-strategyscope.md" <<'EOF'
---
task_id: T-983
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/strategy/)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-983-hooktest-t075-strategyscope.md")
T075_MIX_TWO=( "docs/aaa.md" "src/lib/safety/aaa.ts" "src/lib/strategy/zzz.ts" "zzz/notes.md" )
stage_and_run 1 "(t075-m10) 안전 2개 중 첫 파일만 scope(T-995) → 차단" \
  "$(msg 'fix(T-995): 혼합 커밋')" "${T075_MIX_TWO[@]}"
stage_and_run 1 "(t075-m11) 안전 2개 중 마지막 파일만 scope(T-983) → 차단" \
  "$(msg 'fix(T-983): 혼합 커밋')" "${T075_MIX_TWO[@]}"

echo ""
echo "[T-085 — 브로커 체결 원장 경로(src/lib/broker-ledger/) 추가]"

# T-075 와 같은 형식: ①판정 미기록 → 차단 ②유효 판정(scope 포함) → 통과(통과 문구까지 확인) ③scope 밖 → 차단.
# 새 경로 파일 **하나만** stage 한다 — 목록에서 이 항목만 빠져도 ①·③ 이 실패한다(②는 문구 단언으로 실패).
# 2026-10-25 현재 디렉토리가 없으므로 T-087 이 만들 예정인 실제 파일 이름(collector.ts)을 쓴다.
T085_BL="src/lib/broker-ledger/collector.ts"

cat > "agent-vault/10-Flow/tasks/T-982-hooktest-t085-scoped.md" <<'EOF'
---
task_id: T-982
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/broker-ledger/)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-982-hooktest-t085-scoped.md")

# ③ 용 — 이웃 경로만 검토한 판정. 순수 함수 원장(src/lib/ledger/)·접두어만 겹치는 broker/·
#    같은 이름의 scripts/ 디렉토리 어느 것도 src/lib/broker-ledger/ 를 덮지 않아야 한다.
cat > "agent-vault/10-Flow/tasks/T-981-hooktest-t085-nearmiss.md" <<'EOF'
---
task_id: T-981
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/ledger/, src/lib/broker/, scripts/broker-ledger/, src/lib/broker-ledger)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-981-hooktest-t085-nearmiss.md")

stage_and_run 1 "(t085-a1) broker-ledger/collector.ts + 판정 미기록(T-993) → 차단" \
  "$(msg 'feat(T-993): 체결 수집기')" "$T085_BL"
stage_and_run_expect "$T075_OK" 0 "(t085-a2) broker-ledger/collector.ts + T-982(scope 포함) → 통과" \
  "$(msg 'feat(T-982): 체결 수집기')" "$T085_BL"
stage_and_run 1 "(t085-a3) broker-ledger/collector.ts + T-981(이웃 경로 scope) → 차단" \
  "$(msg 'feat(T-981): 체결 수집기')" "$T085_BL"
stage_and_run 1 "(t085-a4) broker-ledger/collector.ts + task ID 없음 → 차단" \
  "$(msg 'feat: 체결 수집기')" "$T085_BL"

# 하위 경로(테스트 포함)도 디렉토리 전체 매치로 감사 대상 — 차단 기대는 경로 하나씩.
stage_and_run 1 "(t085-p1) broker-ledger/__tests__/collector.test.ts (하위·테스트) → 차단" \
  "$(msg 'test: 수집기 시험 수정')" "src/lib/broker-ledger/__tests__/collector.test.ts"

# 넣지 않기로 한 경로·이름만 비슷한 이웃은 계속 비차단(과도차단 회귀 방지).
# 줄마다 겨냥하는 변이: `^src/lib/` 아래 ledger 로 확대(ledger/compute.ts) · 끝 `/` 삭제(broker-ledger-old/·
# broker-ledger.ts) · `^` 삭제(앞에 디렉토리가 붙은 경로) · `^scripts/` 쪽으로 확대(scripts/broker-ledger/).
stage_and_run 0 "(t085-n1) ledger/·broker-ledger 이웃·scripts/broker-ledger/ → 통과(미포함)" \
  "$(msg 'chore: 이웃 파일 정리')" \
  "src/lib/ledger/compute.ts" "src/lib/broker-ledger-old/x.ts" "src/lib/broker-ledger.ts" \
  "mockups/src/lib/broker-ledger/x.ts" "scripts/broker-ledger/refingerprint.mjs"

echo ""
echo "[T-090 — 인증 입구 라우트 경로(src/app/api/auth/) 추가]"

# T-075·T-085 와 같은 형식: ①판정 미기록 → 차단 ②유효 판정(scope 포함) → 통과(통과 문구까지 확인) ③scope 밖 → 차단.
# 새 경로 파일 **하나만** stage 한다 — 목록에서 이 항목만 빠져도 ①·③ 이 실패한다(②는 문구 단언으로 실패).
# 경로 이름은 실제 입구 라우트를 쓴다(app-exchange = 세션 발급 입구, login, `[provider]/callback` = 대괄호 경로).
T090_EX="src/app/api/auth/app-exchange/route.ts"
T090_LOGIN="src/app/api/auth/login/route.ts"
T090_PROV="src/app/api/auth/[provider]/callback/route.ts"

cat > "agent-vault/10-Flow/tasks/T-980-hooktest-t090-scoped.md" <<'EOF'
---
task_id: T-980
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/app/api/auth/)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-980-hooktest-t090-scoped.md")

# ③ 용 — 이름이 비슷한 '이웃' 경로만 검토한 판정. src/lib/auth/oauth/(lib ≠ api)·profile/kis/·authx/(접두 이름만 같음)와,
#    슬래시를 빠뜨린 `src/app/api/auth`(= 그 이름의 파일 하나만 뜻함)는 어느 것도 auth/ 아래 라우트를 덮지 않아야 한다.
cat > "agent-vault/10-Flow/tasks/T-979-hooktest-t090-nearmiss.md" <<'EOF'
---
task_id: T-979
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/auth/oauth/, src/app/api/profile/kis/, src/app/api/authx/, src/app/api/auth)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-979-hooktest-t090-nearmiss.md")

stage_and_run 1 "(t090-a1) auth/app-exchange/route.ts + 판정 미기록(T-993) → 차단" \
  "$(msg 'fix(T-993): 앱 코드 교환 수정')" "$T090_EX"
stage_and_run_expect "$T075_OK" 0 "(t090-a2) auth/app-exchange/route.ts + T-980(scope 포함) → 통과" \
  "$(msg 'fix(T-980): 앱 코드 교환 수정')" "$T090_EX"
stage_and_run 1 "(t090-a3) auth/app-exchange/route.ts + T-979(이웃 경로 scope) → 차단" \
  "$(msg 'fix(T-979): 앱 코드 교환 수정')" "$T090_EX"
stage_and_run 1 "(t090-a4) auth/app-exchange/route.ts + task ID 없음 → 차단" \
  "$(msg 'fix: 앱 코드 교환 수정')" "$T090_EX"
# 디렉토리 scope 는 auth/ 아래만 연다 — 같은 커밋의 다른 안전 경로(src/lib/auth/oauth/)까지 열어 주지 않는다(차용 방지).
stage_and_run 1 "(t090-a5) auth/ 라우트 + 다른 안전파일(oauth/names.ts), T-980 은 auth/ 만 → 차단" \
  "$(msg 'fix(T-980): 인증 입구 수정 (names.ts 는 검토 안 됨)')" "$T090_EX" "src/lib/auth/oauth/names.ts"

# 디렉토리 전체 매치 — 파일 하나만 적은 목록이었다면 새는 경로들. 차단 기대는 경로 하나씩(하나만 새도 다른 하나가 가려지지 않게).
stage_and_run 1 "(t090-b1) auth/login/route.ts (디렉토리 전체) → 차단" \
  "$(msg 'fix: 로그인 라우트 수정')" "$T090_LOGIN"
stage_and_run_expect "$T075_OK" 0 "(t090-b2) auth/login/route.ts + T-980(scope 포함) → 통과" \
  "$(msg 'fix(T-980): 로그인 라우트 수정')" "$T090_LOGIN"
stage_and_run 1 "(t090-c1) auth/[provider]/callback/route.ts (대괄호 경로) → 차단" \
  "$(msg 'fix: OAuth 콜백 수정')" "$T090_PROV"
stage_and_run_expect "$T075_OK" 0 "(t090-c2) auth/[provider]/callback/route.ts + T-980(디렉토리 scope) → 통과" \
  "$(msg 'fix(T-980): OAuth 콜백 수정')" "$T090_PROV"
stage_and_run 1 "(t090-d1) auth/signup-request/__tests__/route.test.ts (하위·테스트) → 차단" \
  "$(msg 'test: 가입 요청 시험 수정')" "src/app/api/auth/signup-request/__tests__/route.test.ts"
stage_and_run 1 "(t090-d2) auth/ 아래 신규 라우트(brand-new/) → 차단(신규 라우트 누수 방지)" \
  "$(msg 'feat: 신규 인증 라우트')" "src/app/api/auth/brand-new/route.ts"

# 과도 차단 방지 — 로그인 화면(UI)은 걸리지 않는다. 화면과 라우트를 한 커밋에 담으면 라우트 때문에 걸린다(혼합 목록).
stage_and_run 0 "(t090-e1) src/app/login/page.tsx (화면) → task ID 없어도 통과" \
  "$(msg 'feat: 로그인 화면 문구')" "src/app/login/page.tsx"
stage_and_run 1 "(t090-e2) [화면, 라우트] 판정 미기록(T-993) → 라우트 때문에 차단" \
  "$(msg 'feat(T-993): 로그인 화면 + 라우트')" "src/app/login/page.tsx" "$T090_LOGIN"
stage_and_run_expect "$T075_OK" 0 "(t090-e3) [화면, 라우트] T-980(scope 포함) → 통과" \
  "$(msg 'feat(T-980): 로그인 화면 + 라우트')" "src/app/login/page.tsx" "$T090_LOGIN"

# 이름만 비슷한 이웃은 접두 `auth/` 가 아니므로 감사 대상이 아니다 — 통과 기대는 묶어도 약해지지 않는다(하나라도 잘못 매치되면 실패).
# 줄마다 겨냥하는 변이: 끝 `/` 삭제(authx/·auth-foo/) · `^` 삭제(앞에 디렉토리가 붙은 경로 2건).
stage_and_run 0 "(t090-n1) authx/·auth-foo/·foo/…/auth/·mockups/…/auth/ 이웃 → 통과" \
  "$(msg 'chore: 이웃 라우트 정리')" \
  "src/app/api/authx/route.ts" "src/app/api/auth-foo/route.ts" \
  "foo/src/app/api/auth/login/route.ts" "mockups/src/app/api/auth/route.ts"

# 인증 계열이지만 T-090 승인 범위 밖이던 경로. T-090 때는 "범위 밖이라 통과"를 고정했다(당시 별개 사용자 결정 대기).
# (T-092 갱신) 사용자가 "인증 관련파일은 나누지 말고"로 두 경로를 목록에 넣기로 해 뜻이 뒤집혔다 — 시나리오를 지우지 않고
# "이제 걸린다"로 바꾸고, 결정이 따로였던 두 경로를 둘로 나눴다(T-090 Reviewer 권장). 여전히 밖인 이웃은 x3 이 고정한다.
stage_and_run 1 "(t090-x1) profile/password (T-092 에서 포함) → 이제 차단" \
  "$(msg 'chore: 비밀번호 변경 수정')" "src/app/api/profile/password/route.ts"
stage_and_run 1 "(t090-x2) middleware-public-paths 시험 (T-092 에서 포함) → 이제 차단" \
  "$(msg 'test: 공개경로 시험 수정')" "src/__tests__/middleware-public-paths.test.ts"
stage_and_run 0 "(t090-x3) profile/route.ts·profile/settings/ (여전히 미포함) → 통과" \
  "$(msg 'chore: 프로필 조회·회원 설정 수정')" \
  "src/app/api/profile/route.ts" "src/app/api/profile/settings/route.ts"

echo ""
echo "[T-090 — 실 커밋 E2E: 일회용 임시 저장소에서 git 이 새 훅을 실제로 호출하는가]"

# 위 로직 시나리오는 훅을 `bash $HOOK` 로 직접 부른다. 여기서는 일회용 저장소($WORK 아래)에서 진짜 `git commit` 을
# 해 보고, 그 저장소의 core.hooksPath shim 이 **이 작업 트리의 훅**($ROOT/$HOOK)을 실행하게 한다. 실제 저장소의
# index·HEAD·설정은 건드리지 않는다(아래 [E2E] 는 설치된 훅을, 이쪽은 이 작업 트리의 훅을 시험한다 — 새 경로는
# main 에 병합돼 설치된 훅이 바뀌기 전에도 여기서 검증된다).
# 판정 근거는 종료코드만이 아니라 HEAD 이동 여부 + 훅 출력 문구다 — $WORK 가 noexec 마운트면 git 이 훅을 조용히
# 무시해 차단 시나리오가 **실패**한다(통과 시나리오도 훅의 통과 문구를 요구하므로 조용히 통과하지 않는다).
E2E_REPO="$WORK/t090-e2e-repo"
E2E_HOOKS="$WORK/t090-e2e-hooks"
e2e_git() {
  env -u GIT_INDEX_FILE -u GIT_DIR -u GIT_WORK_TREE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES \
    git -C "$E2E_REPO" "$@"
}
mkdir -p "$E2E_HOOKS"
printf '#!/usr/bin/env bash\nexec bash %q "$@"\n' "$ROOT/$HOOK" > "$E2E_HOOKS/commit-msg"
chmod +x "$E2E_HOOKS/commit-msg"
env -u GIT_INDEX_FILE -u GIT_DIR -u GIT_WORK_TREE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES \
  git init -q "$E2E_REPO"
e2e_git config user.name "hooktest"
e2e_git config user.email "hooktest@example.invalid"
e2e_git config commit.gpgsign false
e2e_git config core.hooksPath "$E2E_HOOKS"
mkdir -p "$E2E_REPO/agent-vault/10-Flow/tasks" "$E2E_REPO/src/app/api/auth/app-exchange" \
  "$E2E_REPO/src/app/login" "$E2E_REPO/src/app/api/authx"
cat > "$E2E_REPO/agent-vault/10-Flow/tasks/T-980-hooktest-t090-scoped.md" <<'EOF'
---
task_id: T-980
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/app/api/auth/)**
EOF
cat > "$E2E_REPO/agent-vault/10-Flow/tasks/T-979-hooktest-t090-nearmiss.md" <<'EOF'
---
task_id: T-979
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/auth/oauth/, src/app/api/authx/)**
EOF
e2e_git commit -q --allow-empty -m 'init (임시 저장소)' >/dev/null 2>&1

# e2e_commit <label> <block|commit> <훅 출력에 있어야 할 문자열(빈 값이면 생략)> <커밋 메시지>
e2e_commit() {
  local label="$1" want="$2" expect_out="$3" cmsg="$4" before after out rc ok=1
  before="$(e2e_git rev-parse HEAD 2>/dev/null)"
  out="$(e2e_git commit -q -m "$cmsg" 2>&1)"; rc=$?
  after="$(e2e_git rev-parse HEAD 2>/dev/null)"
  case "$want" in
    block)  { [ "$rc" -ne 0 ] && [ "$before" = "$after" ]; } || ok=0 ;;
    commit) { [ "$rc" -eq 0 ] && [ "$before" != "$after" ]; } || ok=0 ;;
  esac
  if [ -n "$expect_out" ]; then
    case "$out" in *"$expect_out"*) ;; *) ok=0 ;; esac
  fi
  if [ "$ok" -eq 1 ]; then
    printf '  ✅ %-62s (commit rc %d, %s)\n' "$label" "$rc" "$want"
    PASS_N=$((PASS_N + 1))
  else
    printf '  ❌ %-62s (commit rc %d, 기대 %s)\n' "$label" "$rc" "$want"
    [ -n "$expect_out" ] && printf '       └ 훅 출력에 있어야 할 문자열: %s\n' "$expect_out"
    FAIL_N=$((FAIL_N + 1))
    VERBOSE=1
  fi
  if [ "$VERBOSE" -eq 1 ]; then
    printf '%s\n' "$out" | sed 's/^/       │ /'
    echo ""
  fi
}

printf 'v1\n' > "$E2E_REPO/src/app/api/auth/app-exchange/route.ts"
e2e_git add src/app/api/auth/app-exchange/route.ts
e2e_commit "(t090-g1) 실 커밋: auth/app-exchange 라우트 + task ID 없음 → 차단" block "커밋 차단" \
  'fix: 앱 코드 교환 수정'
e2e_commit "(t090-g2) 실 커밋: 같은 변경 + T-979(이웃 경로 scope) → 차단" block "커밋 차단" \
  'fix(T-979): 앱 코드 교환 수정'
e2e_commit "(t090-g3) 실 커밋: 같은 변경 + T-980(auth/ scope) → 통과·HEAD 이동" commit "$T075_OK" \
  'fix(T-980): 앱 코드 교환 수정'
printf 'page\n' > "$E2E_REPO/src/app/login/page.tsx"
printf 'x\n' > "$E2E_REPO/src/app/api/authx/route.ts"
e2e_git add src/app/login/page.tsx src/app/api/authx/route.ts
e2e_commit "(t090-g4) 실 커밋: 로그인 화면·authx/ 이웃(task ID 없음) → 통과" commit "" \
  'feat: 로그인 화면 문구'

echo ""
echo "[T-156 — 부팅 DDL presence helper·시험 독립 변경 실제 커밋]"
stage_and_run 0 "(t156-neighbor) bootstrap 이웃3경로·task ID 없음 → 통과" \
  "$(msg 'fix: bootstrap neighbors')" src/lib/db/bootstrap-presence.ts.bak src/lib/db/__tests__/bootstrap-presence.test.ts.snap src/lib/db/other.ts
# Disposable repository only: every path must independently require its exact reviewed scope.
for T156_PATH in src/lib/db/bootstrap-presence.ts src/lib/db/__tests__/bootstrap-presence.test.ts; do
  mkdir -p "$E2E_REPO/$(dirname "$T156_PATH")"
  cat > "$E2E_REPO/agent-vault/10-Flow/tasks/T-980-hooktest-t090-scoped.md" <<EOF
---
task_id: T-980
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: $T156_PATH)**
EOF
  printf 'bootstrap presence test\n' > "$E2E_REPO/$T156_PATH"
  e2e_git add "$T156_PATH"
  e2e_commit "(t156) $T156_PATH 단독·미검토 → 차단" block "커밋 차단" 'fix: bootstrap presence'
  e2e_commit "(t156) $T156_PATH 단독·이웃 scope → 차단" block "커밋 차단" 'fix(T-979): bootstrap presence'
  e2e_commit "(t156) $T156_PATH 단독·정확 scope → 통과" commit "$T075_OK" 'fix(T-980): bootstrap presence'
done
# Later authentication E2E scenarios reuse this task fixture; restore its original scope.
cat > "$E2E_REPO/agent-vault/10-Flow/tasks/T-980-hooktest-t090-scoped.md" <<'EOF'
---
task_id: T-980
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/app/api/auth/)**
EOF

echo ""
echo "[T-092 — 인증 관련 구현·시험 파일(6곳 + 시험 4) 추가]"

# T-090 이 잠근 인증 입구 라우트가 기대는 불변식의 구현 쪽. 디렉토리 항목은 profile/password/ 하나뿐이고 나머지는 정확 일치다.
# 항목마다 ①판정 미기록 → 차단 ②유효 판정(scope 포함) → 통과(통과 문구까지 확인) ③이웃 경로만 검토한 판정 → 차단.
# 각 시나리오는 새 경로 파일 **하나만** stage 한다 — 목록에서 그 항목 하나만 빠져도 그 항목의 ①·②·③ 이 실패한다.
T092_ITEMS=(
  "src/lib/auth/signup-gate.ts"                      # 초대코드 대조 = 접근 통제(속도 제한 아님)
  "src/lib/auth/__tests__/signup-gate.test.ts"
  "src/lib/auth/signup-request.ts"                   # 가입 요청 입력 검증·IP 키·초대코드 조회
  "src/lib/auth/__tests__/signup-request.test.ts"
  "src/lib/mail/send.ts"                             # 수신자 env 고정(초대코드는 관리자 주소로만)
  "src/lib/mail/__tests__/send.test.ts"
  "src/lib/safe-next-path.ts"                        # T-089 오픈 리다이렉트 단일 관문
  "src/lib/__tests__/safe-next-path.test.ts"
  "src/app/api/profile/password/route.ts"            # 비밀번호 변경(디렉토리 항목)
  "src/__tests__/middleware-public-paths.test.ts"    # 미들웨어 공개/보호 판정 시험
)

cat > "agent-vault/10-Flow/tasks/T-978-hooktest-t092-scoped.md" <<'EOF'
---
task_id: T-978
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/auth/signup-gate.ts, src/lib/auth/__tests__/signup-gate.test.ts, src/lib/auth/signup-request.ts, src/lib/auth/__tests__/signup-request.test.ts, src/lib/mail/send.ts, src/lib/mail/__tests__/send.test.ts, src/lib/safe-next-path.ts, src/lib/__tests__/safe-next-path.test.ts, src/app/api/profile/password/, src/__tests__/middleware-public-paths.test.ts)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-978-hooktest-t092-scoped.md")

# ③ 용 — 이름이 비슷한 '이웃' 경로만 검토한 판정. 어느 것도 새 10개 파일을 덮지 않아야 한다:
#    속도 제한 gate·header-safe(같은 디렉토리의 다른 파일) · 슬래시 없는 `src/lib/mail`·`src/app/api/profile/password`
#    (= 그 이름의 파일 하나만) · profile/kis/(형제 디렉토리) · 확장자·위치만 다른 파일 · middleware 자체 시험 아닌 다른 이름.
cat > "agent-vault/10-Flow/tasks/T-977-hooktest-t092-nearmiss.md" <<'EOF'
---
task_id: T-977
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/auth/signup-request-gate.ts, src/lib/auth/login-gate.ts, src/lib/mail/header-safe.ts, src/lib/mail, src/app/api/profile/password, src/app/api/profile/kis/, src/lib/safe-next-path.tsx, src/lib/auth/signup-gate.test.ts, src/lib/__tests__/safe-next-path.ts, src/__tests__/middleware.test.ts)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-977-hooktest-t092-nearmiss.md")

t092_i=0
for t092_p in "${T092_ITEMS[@]}"; do
  t092_i=$((t092_i + 1))
  stage_and_run 1 "(t092-a${t092_i}.1) ${t092_p#src/} + 판정 미기록(T-993) → 차단" \
    "$(msg 'fix(T-993): 인증 구현 수정')" "$t092_p"
  stage_and_run_expect "$T075_OK" 0 "(t092-a${t092_i}.2) ${t092_p#src/} + T-978(scope 포함) → 통과" \
    "$(msg 'fix(T-978): 인증 구현 수정')" "$t092_p"
  stage_and_run 1 "(t092-a${t092_i}.3) ${t092_p#src/} + T-977(이웃 경로 scope) → 차단" \
    "$(msg 'fix(T-977): 인증 구현 수정')" "$t092_p"
done

# task ID 없이 고친 경우 — 대표 2건(정확 일치 1·디렉토리 1)
stage_and_run 1 "(t092-b1) signup-gate.ts + task ID 없음 → 차단" \
  "$(msg 'fix: 초대코드 비교 수정')" "src/lib/auth/signup-gate.ts"
stage_and_run 1 "(t092-b2) profile/password/route.ts + task ID 없음 → 차단" \
  "$(msg 'fix: 비밀번호 변경 수정')" "src/app/api/profile/password/route.ts"

# 디렉토리 항목 profile/password/ — 아직 없는 하위 파일(시험 등)도 걸린다. 차단 기대는 경로 하나씩.
stage_and_run 1 "(t092-c1) profile/password/__tests__/route.test.ts (하위·신규) → 차단" \
  "$(msg 'test: 비밀번호 변경 시험 추가')" "src/app/api/profile/password/__tests__/route.test.ts"
stage_and_run_expect "$T075_OK" 0 "(t092-c2) 같은 하위 파일 + T-978(디렉토리 scope) → 통과" \
  "$(msg 'test(T-978): 비밀번호 변경 시험 추가')" "src/app/api/profile/password/__tests__/route.test.ts"

# 차용 방지 — T-090 의 auth/ 라우트 판정(T-980)으로 lib 구현을 통과시킬 수 없다(라우트를 검토했다고 구현을 검토한 게 아니다).
stage_and_run 1 "(t092-v1) signup-gate.ts 를 T-980(auth/ 라우트 scope)로 통과 시도 → 차단" \
  "$(msg 'fix(T-980): 가입 라우트 + 초대코드 비교')" \
  "src/app/api/auth/signup/route.ts" "src/lib/auth/signup-gate.ts"

# 이웃은 감사 대상이 아니다 — task ID 없이도 통과해야 한다. 통과 기대는 묶어도 약해지지 않는다(하나라도 잘못 매치되면 exit 1).
# 줄마다 겨냥하는 변이: `\.ts$` 삭제(signup-request-gate.ts·signup-gate-foo.ts·signup-gate.ts.bak) · `.` 이스케이프 누락
# (signup-gatexts) · `^` 삭제(앞에 디렉토리가 붙은 경로) · `-gate` 류 전체로 확대(login/attempt/signup-request gate).
stage_and_run 0 "(t092-n1) 속도 제한 gate·signup-gate 이웃(-foo·.bak·xts·foo/…) → 통과" \
  "$(msg 'chore: 이웃 파일 정리')" \
  "src/lib/auth/login-gate.ts" "src/lib/auth/attempt-gate.ts" "src/lib/auth/signup-request-gate.ts" \
  "src/lib/auth/request-limits.ts" "src/lib/auth/signup-gate-foo.ts" "src/lib/auth/signup-gate.ts.bak" \
  "src/lib/auth/signup-gatexts" "foo/src/lib/auth/signup-gate.ts" "src/lib/auth/signup-request.tsx"
# 겨냥 변이: `^src/lib/mail/` 디렉토리로 확대 · `send` 접두로 축약(sender.ts) · `$` 삭제(send.ts.bak) · 시험 위치 확대 · `^` 삭제(foo/…).
# (T-093 갱신) 원래 묶음에 있던 src/lib/mail/config.ts 는 T-093 에서 목록에 들어갔다 → 이 통과 묶음에서 뺐다. 이 시나리오의
#   겨냥 변이(`^src/lib/mail/` 확대 등)는 남은 header-safe·signup-request-mail 등이 그대로 잡는다. config.ts 가 이제 걸린다는
#   단언은 아래 '[T-093 …]' 절(t093-a17.*)에 있다.
# (T-094 갱신) 원래 묶음에 있던 src/lib/mail/header-safe.ts·__tests__/header-safe.test.ts 는 T-094 에서 목록에 들어갔다 → 이 통과
#   묶음에서 뺐다. `^src/lib/mail/` 확대 변이는 남은 signup-request-mail·sender 가, 시험 위치 확대 변이는 send.test.ts.snap 이
#   그대로 잡는다. 이제 걸린다는 단언은 아래 '[T-094 …]' 절(t094-a*)에 있다.
stage_and_run 0 "(t092-n2) mail 이웃(signup-request-mail·sender·send.ts.bak) → 통과" \
  "$(msg 'chore: 이웃 파일 정리')" \
  "src/lib/mail/signup-request-mail.ts" \
  "src/lib/mail/sender.ts" "src/lib/mail/send.ts.bak" \
  "src/lib/mail/__tests__/send.test.ts.snap" "src/types/nodemailer.d.ts" "foo/src/lib/mail/send.ts"
# 겨냥 변이: `\.ts$` 삭제(safe-next-path-x.ts·.tsx·-old.test.ts) · 디렉토리 위치 무시(auth/safe-next-path.ts) · `^` 삭제(mockups/…).
stage_and_run 0 "(t092-n3) safe-next-path 이웃(-x·.tsx·auth/·-old 시험) → 통과" \
  "$(msg 'chore: 이웃 파일 정리')" \
  "src/lib/safe-next-path-x.ts" "src/lib/safe-next-path.tsx" "src/lib/auth/safe-next-path.ts" \
  "src/lib/__tests__/safe-next-path-old.test.ts" "src/lib/__tests__/safe-next-path.test.tsx" \
  "mockups/src/lib/safe-next-path.ts"
# 겨냥 변이: 끝 `/` 삭제(password-reset/·passwordx.ts) · `^src/app/api/profile/` 로 확대(route.ts·settings/) · 화면 경로 · `^` 삭제(mockups/…).
stage_and_run 0 "(t092-n4) profile 이웃(password-reset/·passwordx·route.ts·settings/)·화면 → 통과" \
  "$(msg 'chore: 이웃 파일 정리')" \
  "src/app/api/profile/password-reset/route.ts" "src/app/api/profile/passwordx.ts" \
  "src/app/api/profile/route.ts" "src/app/api/profile/settings/route.ts" \
  "src/app/profile/ProfilePage.tsx" "src/app/login/page.tsx" "mockups/src/app/api/profile/password/route.ts"
# 겨냥 변이: 시험 항목의 `\.ts$` 삭제(.tsx·.bak) · `__tests__/` 전체로 확대(다른 시험들) · `^` 삭제(foo/…).
# (T-093 갱신) 원래 묶음에 있던 src/lib/auth/__tests__/oauth-invite-gate.test.ts 는 T-093 에서 목록에 들어갔다(T-092 '후보')
#   → 이 통과 묶음에서 뺐다. `__tests__/` 전체 확대 변이는 남은 login-gate·request-limits 시험이 그대로 잡는다. 이제 걸린다는
#   단언은 아래 '[T-093 …]' 절(t093-a12.*)에 있다.
stage_and_run 0 "(t092-n5) 시험 이웃(login-gate·request-limits·app-download 시험 등) → 통과" \
  "$(msg 'test: 이웃 시험 정리')" \
  "src/lib/auth/__tests__/login-gate.test.ts" \
  "src/lib/auth/__tests__/request-limits.test.ts" "src/__tests__/app-download-public-surface.test.ts" \
  "src/__tests__/middleware-public-paths.test.tsx" "src/lib/auth/__tests__/signup-gate.test.ts.bak" \
  "foo/src/__tests__/middleware-public-paths.test.ts"

# 혼합 커밋 — 판정 합집합(요구사항4). T-978(새 10개)·T-980(auth/)·T-995(src/lib/safety/) 가 각자 자기 몫만 덮는다.
T092_MIX=( "README.md" "src/app/api/auth/signup/route.ts" "src/lib/auth/signup-gate.ts" "src/lib/mail/send.ts" )
stage_and_run 1 "(t092-m1) [문서, auth 라우트, 새 구현×2] 판정 미기록(T-993) → 차단" \
  "$(msg 'feat(T-993): 가입 경로 정리')" "${T092_MIX[@]}"
stage_and_run_expect "$T075_OK" 0 "(t092-m2) 같은 묶음 + T-978·T-980 합집합 → 통과" \
  "$(msg 'feat(T-978,T-980): 가입 경로 정리')" "${T092_MIX[@]}"
stage_and_run 1 "(t092-m3) 같은 묶음 + T-978 만 → auth 라우트가 범위 밖, 차단" \
  "$(msg 'feat(T-978): 가입 경로 정리')" "${T092_MIX[@]}"
stage_and_run 1 "(t092-m4) 같은 묶음 + T-980 만 → 새 구현이 범위 밖, 차단" \
  "$(msg 'feat(T-980): 가입 경로 정리')" "${T092_MIX[@]}"
stage_and_run_expect "$T075_OK" 0 "(t092-m5) 새 10개 전부 + 문서, T-978 → 통과" \
  "$(msg 'feat(T-978): 인증 구현 일괄')" "${T092_ITEMS[@]}" "docs/x.md"
stage_and_run 1 "(t092-m6) 새 구현 + 기존 안전파일(safety/), T-978 만 → 차단" \
  "$(msg 'fix(T-978): 인증 + 안전장치')" "src/lib/safe-next-path.ts" "$SAFETY_FILE"
stage_and_run_expect "$T075_OK" 0 "(t092-m7) 같은 묶음 + T-978·T-995 합집합 → 통과" \
  "$(msg 'fix(T-978,T-995): 인증 + 안전장치')" "src/lib/safe-next-path.ts" "$SAFETY_FILE"

echo ""
echo "[T-092 — 실 커밋 E2E: 일회용 임시 저장소에서 git 이 새 항목을 실제로 거르는가]"

# 위 T-090 실 커밋 E2E 와 같은 일회용 저장소·shim(이 작업 트리의 훅)을 그대로 쓴다. 실제 저장소는 건드리지 않는다.
cat > "$E2E_REPO/agent-vault/10-Flow/tasks/T-978-hooktest-t092-scoped.md" <<'EOF'
---
task_id: T-978
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/auth/signup-gate.ts, src/lib/mail/send.ts, src/lib/safe-next-path.ts, src/app/api/profile/password/, src/__tests__/middleware-public-paths.test.ts)**
EOF
cat > "$E2E_REPO/agent-vault/10-Flow/tasks/T-977-hooktest-t092-nearmiss.md" <<'EOF'
---
task_id: T-977
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/auth/login-gate.ts, src/lib/mail, src/app/api/profile/password)**
EOF
mkdir -p "$E2E_REPO/src/lib/auth" "$E2E_REPO/src/lib/mail" "$E2E_REPO/src/app/api/profile/password" \
  "$E2E_REPO/src/__tests__" "$E2E_REPO/src/app/api/auth/signup"
# (fixture 는 커밋하지 않는다 — 훅은 작업 트리의 task 파일을 읽는다. T-090 fixture 와 같다.)

printf 'v1\n' > "$E2E_REPO/src/lib/auth/signup-gate.ts"
e2e_git add src/lib/auth/signup-gate.ts
e2e_commit "(t092-g1) 실 커밋: signup-gate.ts + task ID 없음 → 차단" block "커밋 차단" \
  'fix: 초대코드 비교 수정'
e2e_commit "(t092-g2) 실 커밋: 같은 변경 + T-977(이웃 경로 scope) → 차단" block "커밋 차단" \
  'fix(T-977): 초대코드 비교 수정'
e2e_commit "(t092-g3) 실 커밋: 같은 변경 + T-980(auth/ 라우트 scope) → 차단(차용 방지)" block "커밋 차단" \
  'fix(T-980): 초대코드 비교 수정'
e2e_commit "(t092-g4) 실 커밋: 같은 변경 + T-978(scope 포함) → 통과·HEAD 이동" commit "$T075_OK" \
  'fix(T-978): 초대코드 비교 수정'

printf 'v1\n' > "$E2E_REPO/src/app/api/profile/password/route.ts"
printf 'v1\n' > "$E2E_REPO/src/__tests__/middleware-public-paths.test.ts"
e2e_git add src/app/api/profile/password/route.ts src/__tests__/middleware-public-paths.test.ts
e2e_commit "(t092-g5) 실 커밋: profile/password·미들웨어 시험 + task ID 없음 → 차단" block "커밋 차단" \
  'chore: 비밀번호 변경·공개경로 시험'
e2e_commit "(t092-g6) 실 커밋: 같은 변경 + T-978 → 통과·HEAD 이동" commit "$T075_OK" \
  'chore(T-978): 비밀번호 변경·공개경로 시험'

printf 'v1\n' > "$E2E_REPO/src/lib/mail/send.ts"
printf 'v1\n' > "$E2E_REPO/src/app/api/auth/signup/route.ts"
e2e_git add src/lib/mail/send.ts src/app/api/auth/signup/route.ts
e2e_commit "(t092-g7) 실 커밋: [send.ts, auth 라우트] + T-978 만 → 차단" block "커밋 차단" \
  'feat(T-978): 가입 메일 정리'
e2e_commit "(t092-g8) 실 커밋: 같은 변경 + T-978·T-980 합집합 → 통과·HEAD 이동" commit "$T075_OK" \
  'feat(T-978,T-980): 가입 메일 정리'

printf 'x\n' > "$E2E_REPO/src/lib/auth/login-gate.ts"
printf 'x\n' > "$E2E_REPO/src/lib/auth/signup-request-gate.ts"
# (T-094 갱신) 원래 이 커밋에 있던 src/lib/mail/header-safe.ts 는 T-094 에서 목록에 들어갔다 → 뺐다(실 커밋 차단은 t094-g*).
e2e_git add src/lib/auth/login-gate.ts src/lib/auth/signup-request-gate.ts
e2e_commit "(t092-g9) 실 커밋: 속도 제한 gate 이웃(task ID 없음) → 통과" commit "" \
  'chore: 시도제한 임계값·헤더 정리'

echo ""
echo "[T-093 — 감시 밖 인증 시험 15개·로그인 화면 시험·메일 수신자 설정(정확 일치 17줄) 추가]"

# 전부 정확 일치(`^…\.ts$`)다. 항목마다 ①판정 미기록 → 차단 ②유효 판정(scope 포함) → 통과(통과 문구까지 확인)
# ③이름이 비슷한 이웃만 검토한 판정 → 차단 ④**구현만 검토한 옛 인접 판정**(시험 대상 구현·auth/ 라우트·oauth/) → 차단.
# 각 시나리오는 새 경로 파일 **하나만** stage 한다 — 목록에서 그 줄 하나만 빠져도 그 항목의 ①·②·③·④ 가 실패한다.
T093_ITEMS=(
  "src/lib/auth/__tests__/session.test.ts"                    # a1  session.ts 의 시험
  "src/lib/auth/__tests__/password.test.ts"                   # a2
  "src/lib/auth/__tests__/users.test.ts"                      # a3
  "src/lib/auth/__tests__/secret-box.test.ts"                 # a4
  "src/lib/auth/__tests__/kis-verify.test.ts"                 # a5
  "src/lib/auth/__tests__/owner-kis-migration.test.ts"        # a6
  "src/lib/auth/__tests__/t088-disposable-mariadb.test.ts"    # a7  oauth/app-code.ts + T-088 마이그레이션
  "src/lib/auth/__tests__/oauth-app-code-t088.test.ts"        # a8
  "src/lib/auth/__tests__/oauth-app-routes-t088.test.ts"      # a9  auth/ 라우트 + oauth/
  "src/lib/auth/__tests__/oauth-callback-session.test.ts"     # a10
  "src/lib/auth/__tests__/oauth-decide.test.ts"               # a11
  "src/lib/auth/__tests__/oauth-invite-gate.test.ts"          # a12 (T-092 후보 → 포함)
  "src/lib/auth/__tests__/oauth-providers.test.ts"            # a13
  "src/lib/auth/__tests__/oauth-state.test.ts"                # a14
  "src/lib/auth/__tests__/oauth-web-regression-t088.test.ts"  # a15
  "src/components/auth/__tests__/login-screen-t088.test.ts"   # a16 로그인 화면 시험(화면 자체는 감시 밖)
  "src/lib/mail/config.ts"                                    # a17 관리자 메일 수신자의 유일한 출처
)

cat > "agent-vault/10-Flow/tasks/T-969-hooktest-t093-scoped.md" <<'EOF'
---
task_id: T-969
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/auth/__tests__/session.test.ts, src/lib/auth/__tests__/password.test.ts, src/lib/auth/__tests__/users.test.ts, src/lib/auth/__tests__/secret-box.test.ts, src/lib/auth/__tests__/kis-verify.test.ts, src/lib/auth/__tests__/owner-kis-migration.test.ts, src/lib/auth/__tests__/t088-disposable-mariadb.test.ts, src/lib/auth/__tests__/oauth-app-code-t088.test.ts, src/lib/auth/__tests__/oauth-app-routes-t088.test.ts, src/lib/auth/__tests__/oauth-callback-session.test.ts, src/lib/auth/__tests__/oauth-decide.test.ts, src/lib/auth/__tests__/oauth-invite-gate.test.ts, src/lib/auth/__tests__/oauth-providers.test.ts, src/lib/auth/__tests__/oauth-state.test.ts, src/lib/auth/__tests__/oauth-web-regression-t088.test.ts, src/components/auth/__tests__/login-screen-t088.test.ts, src/lib/mail/config.ts)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-969-hooktest-t093-scoped.md")

# ③ 용 — 이름이 비슷한 '이웃'만 검토한 판정. 어느 것도 새 17개를 덮지 않아야 한다:
#    속도 제한 게이트 시험(같은 디렉토리의 다른 파일) · 슬래시 없는 `src/lib/auth/__tests__`·`src/components/auth/__tests__`
#    (= 그 이름의 파일 하나만) · 확장자·위치만 다른 파일(session.test.tsx·lib/auth/session.test.ts·config.tsx) · 형제 시험
#    (app-version-gate-t091) · 로그인 화면 본체 · header-safe(config 가 부르는 같은 디렉토리의 다른 파일).
cat > "agent-vault/10-Flow/tasks/T-968-hooktest-t093-nearmiss.md" <<'EOF'
---
task_id: T-968
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/auth/__tests__/login-gate.test.ts, src/lib/auth/__tests__/request-limits.test.ts, src/lib/auth/__tests__, src/lib/auth/__tests__/session.test.tsx, src/lib/auth/session.test.ts, src/components/auth/__tests__, src/components/auth/__tests__/app-version-gate-t091.test.ts, src/app/login/page.tsx, src/lib/mail/header-safe.ts, src/lib/mail/config.tsx, src/lib/mail)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-968-hooktest-t093-nearmiss.md")

# ④ 용 — 시험이 기대는 **구현만** 검토한 판정(옛 인접 판정 차용). 시험 대상 구현 파일(정확 일치)·oauth/·auth/ 라우트·
#    send.ts·safe-next-path·login 화면을 전부 적어도 시험 파일 하나 열어 주지 않아야 한다(구현을 봤다고 시험을 본 게 아니다).
cat > "agent-vault/10-Flow/tasks/T-967-hooktest-t093-implonly.md" <<'EOF'
---
task_id: T-967
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/auth/session.ts, src/lib/auth/session-cookie.ts, src/lib/auth/password.ts, src/lib/auth/users.ts, src/lib/auth/secret-box.ts, src/lib/auth/kis-verify.ts, src/lib/auth/owner-kis-migration.ts, src/lib/auth/signup-gate.ts, src/lib/auth/oauth/, src/app/api/auth/, scripts/migrations/, src/lib/mail/send.ts, src/lib/safe-next-path.ts, src/app/login/, src/components/auth/OAuthButtons.tsx)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-967-hooktest-t093-implonly.md")

t093_i=0
for t093_p in "${T093_ITEMS[@]}"; do
  t093_i=$((t093_i + 1))
  stage_and_run 1 "(t093-a${t093_i}.1) ${t093_p#src/} + 판정 미기록(T-993) → 차단" \
    "$(msg 'test(T-993): 인증 시험 수정')" "$t093_p"
  stage_and_run_expect "$T075_OK" 0 "(t093-a${t093_i}.2) ${t093_p#src/} + T-969(scope 포함) → 통과" \
    "$(msg 'test(T-969): 인증 시험 수정')" "$t093_p"
  stage_and_run 1 "(t093-a${t093_i}.3) ${t093_p#src/} + T-968(이웃 경로 scope) → 차단" \
    "$(msg 'test(T-968): 인증 시험 수정')" "$t093_p"
  stage_and_run 1 "(t093-a${t093_i}.4) ${t093_p#src/} + T-967(구현만 검토한 scope) → 차단" \
    "$(msg 'test(T-967): 인증 시험 수정')" "$t093_p"
done

# task ID 없이 고친 경우 — 대표 3건(auth 시험·화면 시험·메일 설정 각 1)
stage_and_run 1 "(t093-b1) session.test.ts + task ID 없음 → 차단" \
  "$(msg 'test: 세션 시험 정리')" "src/lib/auth/__tests__/session.test.ts"
stage_and_run 1 "(t093-b2) login-screen-t088.test.ts + task ID 없음 → 차단" \
  "$(msg 'test: 로그인 화면 시험 문구 갱신')" "src/components/auth/__tests__/login-screen-t088.test.ts"
stage_and_run 1 "(t093-b3) mail/config.ts + task ID 없음 → 차단" \
  "$(msg 'fix: 관리자 메일 주소 읽기 수정')" "src/lib/mail/config.ts"

# 차용 방지 — 앞 라운드들의 판정 fixture 로 새 항목을 통과시킬 수 없다.
#   T-988(scope: src/lib/auth/session.ts = 구현 파일 하나) · T-980(scope: src/app/api/auth/) · T-978(T-092 의 10개 —
#   signup-gate.test.ts 등 이웃 시험과 send.ts 는 있지만 새 17개는 없다).
stage_and_run 1 "(t093-v1) session.test.ts 를 T-988(session.ts 구현 scope)로 통과 시도 → 차단" \
  "$(msg 'test(T-988): 세션 시험 수정')" "src/lib/auth/__tests__/session.test.ts"
stage_and_run 1 "(t093-v2) oauth-app-routes 시험을 T-980(auth/ 라우트 scope)로 통과 시도 → 차단" \
  "$(msg 'test(T-980): 앱 라우트 시험 수정')" "src/lib/auth/__tests__/oauth-app-routes-t088.test.ts"
stage_and_run 1 "(t093-v3) oauth-invite-gate 시험을 T-978(T-092 scope)로 통과 시도 → 차단" \
  "$(msg 'test(T-978): 초대 게이트 시험 수정')" "src/lib/auth/__tests__/oauth-invite-gate.test.ts"
stage_and_run 1 "(t093-v4) [send.ts, config.ts] T-978 만(send.ts 만 덮음) → config.ts 가 범위 밖, 차단" \
  "$(msg 'fix(T-978): 메일 발송·설정 수정')" "src/lib/mail/send.ts" "src/lib/mail/config.ts"
stage_and_run 1 "(t093-v5) [signup-gate.test.ts, session.test.ts] T-978 만 → session.test.ts 범위 밖, 차단" \
  "$(msg 'test(T-978): 인증 시험 정리')" \
  "src/lib/auth/__tests__/signup-gate.test.ts" "src/lib/auth/__tests__/session.test.ts"

# 이웃은 감사 대상이 아니다 — task ID 없이도 통과해야 한다. 통과 기대는 묶어도 약해지지 않는다(하나라도 잘못 매치되면 exit 1).
# 겨냥 변이: 디렉토리 `^src/lib/auth/__tests__/` 로 넓히기(속도 제한 게이트 시험 2개·신규 시험) · `oauth-` 접두로 넓히기
# (oauth-state-extra) · `$` 삭제(.bak·.tsx) · `\.ts` 의 `.` 이스케이프 누락(session.testxts) · `\.test` 의 이스케이프 누락
# (sessionxtest.ts) · 위치 무시(lib/auth/ 바로 아래·중첩 oauth/) · `^` 삭제(앞에 디렉토리가 붙은 경로).
stage_and_run 0 "(t093-n1) 속도 제한 게이트 시험·신규·이름 비슷한 시험·위치만 다른 시험 → 통과" \
  "$(msg 'test: 이웃 시험 정리')" \
  "src/lib/auth/__tests__/login-gate.test.ts" "src/lib/auth/__tests__/request-limits.test.ts" \
  "src/lib/auth/__tests__/brand-new.test.ts" "src/lib/auth/__tests__/session-extra.test.ts" \
  "src/lib/auth/__tests__/oauth-state-extra.test.ts" "src/lib/auth/__tests__/session.test.ts.bak" \
  "src/lib/auth/__tests__/session.test.tsx" "src/lib/auth/__tests__/session.testxts" \
  "src/lib/auth/__tests__/sessionxtest.ts" "src/lib/auth/session.test.ts" \
  "src/lib/auth/__tests__/oauth/state.test.ts" "foo/src/lib/auth/__tests__/session.test.ts"
# 겨냥 변이: `^src/components/auth/__tests__/` 로 넓히기(app-version-gate-t091) · `$` 삭제(.bak) · `^` 삭제(mockups/…).
# 로그인 화면 본체(page.tsx)와 화면 컴포넌트는 UI 라 감시 밖이다.
stage_and_run 0 "(t093-n2) 로그인 화면 본체·화면 컴포넌트·형제 시험(app-version-gate-t091) → 통과" \
  "$(msg 'feat: 로그인 화면 문구')" \
  "src/app/login/page.tsx" "src/components/auth/OAuthButtons.tsx" \
  "src/components/auth/__tests__/app-version-gate-t091.test.ts" \
  "src/components/auth/__tests__/login-screen-t088.test.ts.bak" \
  "mockups/src/components/auth/__tests__/login-screen-t088.test.ts"
# 겨냥 변이: `^src/lib/mail/` 로 넓히기(signup-request-mail) · `$` 삭제(config.ts.bak) · `.` 이스케이프 누락
# (configxts) · 시험 위치로 넓히기(mail/__tests__/) · `^` 삭제(foo/…). nodemailer 타입 선언도 감시 밖(T-092 후보 보류).
# (T-094 갱신) 원래 묶음에 있던 header-safe.ts·__tests__/header-safe.test.ts 는 T-094 에서 목록에 들어갔다 → 뺐다. 남은
#   signup-request-mail·config.test.ts 가 위 겨냥 변이를 그대로 잡는다. 이제 걸린다는 단언은 '[T-094 …]' 절(t094-a*)에 있다.
stage_and_run 0 "(t093-n3) mail 이웃(signup-request-mail·config.tsx·.bak·시험) → 통과" \
  "$(msg 'chore: 메일 이웃 정리')" \
  "src/lib/mail/signup-request-mail.ts" "src/lib/mail/config.tsx" \
  "src/lib/mail/config.ts.bak" "src/lib/mail/configxts" \
  "src/lib/mail/__tests__/config.test.ts" "src/types/nodemailer.d.ts" "foo/src/lib/mail/config.ts"

# 혼합 커밋 — 판정 합집합(요구사항4). T-969(새 17개)·T-967(구현)·T-978(T-092 10개)이 각자 자기 몫만 덮는다.
T093_MIX=( "README.md" "src/lib/auth/__tests__/session.test.ts" "src/lib/auth/password.ts" "src/lib/mail/config.ts" )
stage_and_run 1 "(t093-m1) [문서, 시험, 구현(password.ts), config] 판정 미기록(T-993) → 차단" \
  "$(msg 'feat(T-993): 인증 정리')" "${T093_MIX[@]}"
stage_and_run 1 "(t093-m2) 같은 묶음 + T-969 만 → password.ts 가 범위 밖, 차단" \
  "$(msg 'feat(T-969): 인증 정리')" "${T093_MIX[@]}"
stage_and_run 1 "(t093-m3) 같은 묶음 + T-967 만 → 시험·config 가 범위 밖, 차단" \
  "$(msg 'feat(T-967): 인증 정리')" "${T093_MIX[@]}"
stage_and_run_expect "$T075_OK" 0 "(t093-m4) 같은 묶음 + T-969·T-967 합집합 → 통과" \
  "$(msg 'feat(T-969,T-967): 인증 정리')" "${T093_MIX[@]}"
stage_and_run_expect "$T075_OK" 0 "(t093-m5) 새 17개 전부 + 문서, T-969 → 통과" \
  "$(msg 'test(T-969): 인증 시험 일괄')" "${T093_ITEMS[@]}" "docs/x.md"
# 화면 본체(page.tsx)는 감시 밖이지만 같은 커밋의 화면 시험 때문에 걸린다.
stage_and_run 1 "(t093-m6) [login/page.tsx, 화면 시험] task ID 없음 → 시험 때문에 차단" \
  "$(msg 'feat: 로그인 화면 + 시험')" "src/app/login/page.tsx" "src/components/auth/__tests__/login-screen-t088.test.ts"
stage_and_run_expect "$T075_OK" 0 "(t093-m7) 같은 묶음 + T-969 → 통과(page.tsx 는 안전 경로 아님)" \
  "$(msg 'feat(T-969): 로그인 화면 + 시험')" "src/app/login/page.tsx" "src/components/auth/__tests__/login-screen-t088.test.ts"
stage_and_run_expect "$T075_OK" 0 "(t093-m8) [send.ts, config.ts] T-969·T-978 합집합 → 통과" \
  "$(msg 'fix(T-969,T-978): 메일 발송·설정 수정')" "src/lib/mail/send.ts" "src/lib/mail/config.ts"
# 속도 제한 게이트 시험은 감시 밖이라 끼어 있어도 결과를 바꾸지 않는다(제외 유지).
stage_and_run_expect "$T075_OK" 0 "(t093-m9) [session.test.ts, login-gate.test.ts] T-969 → 통과(login-gate 시험은 감시 밖)" \
  "$(msg 'test(T-969): 세션·시도제한 시험')" \
  "src/lib/auth/__tests__/session.test.ts" "src/lib/auth/__tests__/login-gate.test.ts"

echo ""
echo "[T-093 — 실 커밋 E2E: 일회용 임시 저장소에서 git 이 새 항목을 실제로 거르는가]"

# 위 T-090·T-092 실 커밋 E2E 와 같은 일회용 저장소·shim(이 작업 트리의 훅)을 그대로 쓴다. 실제 저장소는 건드리지 않는다.
cat > "$E2E_REPO/agent-vault/10-Flow/tasks/T-969-hooktest-t093-scoped.md" <<'EOF'
---
task_id: T-969
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/auth/__tests__/session.test.ts, src/lib/auth/__tests__/oauth-invite-gate.test.ts, src/components/auth/__tests__/login-screen-t088.test.ts, src/lib/mail/config.ts)**
EOF
cat > "$E2E_REPO/agent-vault/10-Flow/tasks/T-968-hooktest-t093-nearmiss.md" <<'EOF'
---
task_id: T-968
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/auth/__tests__/login-gate.test.ts, src/lib/auth/__tests__, src/lib/mail/header-safe.ts)**
EOF
cat > "$E2E_REPO/agent-vault/10-Flow/tasks/T-967-hooktest-t093-implonly.md" <<'EOF'
---
task_id: T-967
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/auth/session.ts, src/lib/auth/oauth/, src/app/api/auth/, src/lib/mail/send.ts, src/app/login/)**
EOF
mkdir -p "$E2E_REPO/src/lib/auth/__tests__" "$E2E_REPO/src/components/auth/__tests__" "$E2E_REPO/src/lib/mail"
# (fixture 는 커밋하지 않는다 — 훅은 작업 트리의 task 파일을 읽는다. T-090·T-092 fixture 와 같다.)

printf 'v1\n' > "$E2E_REPO/src/lib/auth/__tests__/session.test.ts"
e2e_git add src/lib/auth/__tests__/session.test.ts
e2e_commit "(t093-g1) 실 커밋: session.test.ts + task ID 없음 → 차단" block "커밋 차단" \
  'test: 세션 시험 정리'
e2e_commit "(t093-g2) 실 커밋: 같은 변경 + T-968(이웃 경로 scope) → 차단" block "커밋 차단" \
  'test(T-968): 세션 시험 정리'
e2e_commit "(t093-g3) 실 커밋: 같은 변경 + T-967(구현만 검토) → 차단(차용 방지)" block "커밋 차단" \
  'test(T-967): 세션 시험 정리'
e2e_commit "(t093-g4) 실 커밋: 같은 변경 + T-969(scope 포함) → 통과·HEAD 이동" commit "$T075_OK" \
  'test(T-969): 세션 시험 정리'

printf 'v1\n' > "$E2E_REPO/src/lib/mail/config.ts"
printf 'v1\n' > "$E2E_REPO/src/components/auth/__tests__/login-screen-t088.test.ts"
printf 'v2\n' > "$E2E_REPO/src/app/login/page.tsx"
e2e_git add src/lib/mail/config.ts src/components/auth/__tests__/login-screen-t088.test.ts src/app/login/page.tsx
e2e_commit "(t093-g5) 실 커밋: [config.ts, 화면 시험, 화면 본체] + task ID 없음 → 차단" block "커밋 차단" \
  'feat: 로그인 화면·메일 설정'
e2e_commit "(t093-g6) 실 커밋: 같은 변경 + T-967(화면·send.ts 만) → 차단" block "커밋 차단" \
  'feat(T-967): 로그인 화면·메일 설정'
e2e_commit "(t093-g7) 실 커밋: 같은 변경 + T-969 → 통과·HEAD 이동" commit "$T075_OK" \
  'feat(T-969): 로그인 화면·메일 설정'

printf 'x\n' > "$E2E_REPO/src/lib/auth/__tests__/login-gate.test.ts"
printf 'x\n' > "$E2E_REPO/src/lib/auth/__tests__/request-limits.test.ts"
printf 'x\n' > "$E2E_REPO/src/components/auth/__tests__/app-version-gate-t091.test.ts"
printf 'v3\n' > "$E2E_REPO/src/app/login/page.tsx"
# (T-094 갱신) 원래 이 커밋에 있던 src/lib/mail/header-safe.ts 는 T-094 에서 목록에 들어갔다 → 뺐다(실 커밋 차단은 t094-g*).
e2e_git add src/lib/auth/__tests__/login-gate.test.ts src/lib/auth/__tests__/request-limits.test.ts \
  src/components/auth/__tests__/app-version-gate-t091.test.ts src/app/login/page.tsx
e2e_commit "(t093-g8) 실 커밋: 속도 제한 게이트 시험·형제 시험·화면(task ID 없음) → 통과" commit "" \
  'chore: 시도제한 시험·화면 정리'

echo ""
echo "[T-098 — 사전 등록(백테스트) 코드: registry/·backtest/ 디렉토리·러너 2개·시험 접두·격리 시험 추가]"

# T-096 P3 의 사전 등록 잠금. 디렉토리 항목 2(registry/·backtest/)·정확 일치 3(러너 2·isolation.test.ts)·접두 1(__tests__/backtest-).
# 항목마다 ①판정 미기록 → 차단 ②유효 판정(scope 포함) → 통과(통과 문구까지 확인) ③이름이 비슷한 이웃만 검토한 판정 → 차단.
# 각 시나리오는 경로 **하나만** stage 한다 — 목록에서 그 항목 하나만 빠져도 그 항목의 ①·②·③ 이 실패한다.
# isolation.test.ts 말고는 전부 아직 main 에 없는 경로다(P3 미커밋) — staged 이면 신규 파일도 걸리는지가 곧 이 절의 시험이다.
# g1-record.json·oos-locks/*.lock 은 P3 작업 트리에도 아직 없다(러너·Leader 가 나중에 만든다).
T098_ITEMS=(
  "src/lib/profit-engine/registry/preregistration.json"            # a1  사전 등록 수치(§B 해시 고정)
  "src/lib/profit-engine/registry/oos-ledger.json"                 # a2  OOS 원장(러너가 갱신)
  "src/lib/profit-engine/registry/is-ledger.json"                  # a3  IS 원장(러너가 갱신)
  "src/lib/profit-engine/registry/hash.ts"                         # a4  §B·H_r 해시 코드
  "src/lib/profit-engine/registry/g1-record.json"                  # a5  아직 없는 G1 기록
  "src/lib/profit-engine/registry/oos-locks/rsi-oversold-daily-US.lock"  # a6  아직 없는 잠금 파일(하위 디렉토리)
  "src/lib/profit-engine/backtest/fill.ts"                         # a7  체결 모델
  "src/lib/profit-engine/backtest/signals/rsi-oversold-daily.ts"   # a8  신호(하위 디렉토리)
  "scripts/profit-engine/backtest-runner.mjs"                      # a9  실행기(정확 일치)
  "scripts/profit-engine/backtest-runner-core.js"                  # a10 관문 본체(정확 일치)
  "src/lib/profit-engine/__tests__/backtest-runner.test.ts"        # a11 시험(접두)
  "src/lib/profit-engine/__tests__/backtest-fixtures.ts"           # a12 공용 합성 일봉(접두 — .test 아님)
  "src/lib/profit-engine/__tests__/isolation.test.ts"              # a13 격리 방어선(정확 일치, 이미 추적 중)
)

# ② 용 — 새 항목 전부를 덮는 판정(디렉토리 2·러너 2·시험 파일 하나씩 — 접두 `…/backtest-` 는 scope 로 쓸 수 없다).
cat > "agent-vault/10-Flow/tasks/T-964-hooktest-t098-scoped.md" <<'EOF'
---
task_id: T-964
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/profit-engine/registry/, src/lib/profit-engine/backtest/, scripts/profit-engine/backtest-runner.mjs, scripts/profit-engine/backtest-runner-core.js, src/lib/profit-engine/__tests__/backtest-baseline-parity.test.ts, src/lib/profit-engine/__tests__/backtest-fill.test.ts, src/lib/profit-engine/__tests__/backtest-fixtures.ts, src/lib/profit-engine/__tests__/backtest-metrics.test.ts, src/lib/profit-engine/__tests__/backtest-pipeline.test.ts, src/lib/profit-engine/__tests__/backtest-registry.test.ts, src/lib/profit-engine/__tests__/backtest-runner.test.ts, src/lib/profit-engine/__tests__/backtest-signals.test.ts, src/lib/profit-engine/__tests__/isolation.test.ts)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-964-hooktest-t098-scoped.md")

# ③ 용 — 이름이 비슷한 '이웃'만 검토한 판정. 어느 것도 새 항목을 덮지 않아야 한다:
#    슬래시 없는 `…/registry`·`…/backtest`(= 그 이름의 파일 하나만) · 가짜 접두 디렉토리(registry-x/·backtestx/) · 확장자만 다른
#    러너(.mjs.bak·-core.ts) · 같은 디렉토리의 사후검증 본체 · 접두를 scope 로 쓴 `…/__tests__/backtest-`(= 그 이름의 파일 하나만) ·
#    위치·확장자만 다른 격리 시험 · 이웃 시험 · 일봉 수집 · 슬래시 없는 `scripts/profit-engine`.
cat > "agent-vault/10-Flow/tasks/T-965-hooktest-t098-nearmiss.md" <<'EOF'
---
task_id: T-965
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/profit-engine/registry, src/lib/profit-engine/backtest, src/lib/profit-engine/registry-x/, src/lib/profit-engine/backtestx/, scripts/profit-engine/backtest-runner.mjs.bak, scripts/profit-engine/backtest-runner-core.ts, scripts/profit-engine/postmortem-core.js, scripts/profit-engine, src/lib/profit-engine/__tests__/backtest-, src/lib/profit-engine/__tests__/isolation.test.tsx, src/lib/profit-engine/isolation.test.ts, src/lib/profit-engine/__tests__/signal-postmortem-core.test.ts, src/lib/profit-engine/daily-bars-collector.ts)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-965-hooktest-t098-nearmiss.md")

# 차용 방지 용 — **다른 안전 경로**만 검토한 판정. 엔진이 부르는 지표(src/lib/strategy/ — 이미 감시 중)·시그널·전략 라우트·
#    DDL·훅 자신·브로커 원장을 전부 적어도 사전 등록 코드 하나 열어 주지 않아야 한다(지표를 봤다고 신호·판정을 본 게 아니다).
cat > "agent-vault/10-Flow/tasks/T-966-hooktest-t098-borrowed.md" <<'EOF'
---
task_id: T-966
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/strategy/, src/lib/signals/, src/app/api/strategies/, src/app/api/settings/strategies/, scripts/migrations/, scripts/git-hooks/, src/lib/broker-ledger/)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-966-hooktest-t098-borrowed.md")

# 구현만 검토한 판정 — registry/·backtest/·러너는 덮지만 시험(backtest-*·isolation)은 덮지 않는다(T-093 ④ 와 같은 처리).
cat > "agent-vault/10-Flow/tasks/T-963-hooktest-t098-implonly.md" <<'EOF'
---
task_id: T-963
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/profit-engine/registry/, src/lib/profit-engine/backtest/, scripts/profit-engine/backtest-runner.mjs, scripts/profit-engine/backtest-runner-core.js)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-963-hooktest-t098-implonly.md")

t098_i=0
for t098_p in "${T098_ITEMS[@]}"; do
  t098_i=$((t098_i + 1))
  stage_and_run 1 "(t098-a${t098_i}.1) ${t098_p#src/lib/} + 판정 미기록(T-993) → 차단" \
    "$(msg 'feat(T-993): 백테스트 수정')" "$t098_p"
  stage_and_run_expect "$T075_OK" 0 "(t098-a${t098_i}.2) ${t098_p#src/lib/} + T-964(scope 포함) → 통과" \
    "$(msg 'feat(T-964): 백테스트 수정')" "$t098_p"
  stage_and_run 1 "(t098-a${t098_i}.3) ${t098_p#src/lib/} + T-965(이웃 경로 scope) → 차단" \
    "$(msg 'feat(T-965): 백테스트 수정')" "$t098_p"
done

# task ID 없이 고친 경우 — 대표 3건(디렉토리·정확 일치 러너·추적 중인 격리 시험 각 1)
stage_and_run 1 "(t098-b1) registry/preregistration.json + task ID 없음 → 차단" \
  "$(msg 'chore: 합격 기준 수치 조정')" "src/lib/profit-engine/registry/preregistration.json"
stage_and_run 1 "(t098-b2) backtest-runner-core.js + task ID 없음 → 차단" \
  "$(msg 'fix: 러너 관문 정리')" "scripts/profit-engine/backtest-runner-core.js"
stage_and_run 1 "(t098-b3) __tests__/isolation.test.ts + task ID 없음 → 차단" \
  "$(msg 'test: 격리 시험 정리')" "src/lib/profit-engine/__tests__/isolation.test.ts"

# 디렉토리 항목 — 지금 어디에도 없는 신규 파일(새 전략 신호·새 registry 파일)도 staged 이면 걸린다.
stage_and_run 1 "(t098-c1) backtest/signals/new-strategy.ts (신규) + task ID 없음 → 차단" \
  "$(msg 'feat: 새 전략 신호')" "src/lib/profit-engine/backtest/signals/new-strategy.ts"
stage_and_run_expect "$T075_OK" 0 "(t098-c2) 같은 신규 파일 + T-964(디렉토리 scope) → 통과" \
  "$(msg 'feat(T-964): 새 전략 신호')" "src/lib/profit-engine/backtest/signals/new-strategy.ts"
stage_and_run 1 "(t098-c3) registry/preregistration-v2.json (신규) + task ID 없음 → 차단" \
  "$(msg 'feat: 등록 v2 초안')" "src/lib/profit-engine/registry/preregistration-v2.json"
stage_and_run 1 "(t098-c4) __tests__/backtest-portfolio.test.ts (신규, 접두) + task ID 없음 → 차단" \
  "$(msg 'test: 포트폴리오 시험 추가')" "src/lib/profit-engine/__tests__/backtest-portfolio.test.ts"

# 차용 방지 — 다른 안전 경로의 판정(T-966 다른 경로·T-995 safety/·T-969 T-093 시험)과 구현만 검토한 판정(T-963)으로는 못 연다.
stage_and_run 1 "(t098-v1) registry/preregistration.json 을 T-966(다른 안전 경로 scope)로 통과 시도 → 차단" \
  "$(msg 'chore(T-966): 등록 수치 조정')" "src/lib/profit-engine/registry/preregistration.json"
stage_and_run 1 "(t098-v2) backtest/signals 신호를 T-966(지표 strategy/ scope)로 통과 시도 → 차단" \
  "$(msg 'fix(T-966): RSI 신호 수정')" "src/lib/profit-engine/backtest/signals/rsi-oversold-daily.ts"
stage_and_run 1 "(t098-v3) isolation.test.ts 를 T-995(safety/ scope)로 통과 시도 → 차단" \
  "$(msg 'test(T-995): 격리 시험 수정')" "src/lib/profit-engine/__tests__/isolation.test.ts"
stage_and_run 1 "(t098-v4) backtest-runner-core.js 를 T-969(T-093 scope)로 통과 시도 → 차단" \
  "$(msg 'fix(T-969): 러너 관문 수정')" "scripts/profit-engine/backtest-runner-core.js"
stage_and_run 1 "(t098-v5) backtest-runner.test.ts 를 T-963(구현만 scope)로 통과 시도 → 차단" \
  "$(msg 'test(T-963): 러너 시험 수정')" "src/lib/profit-engine/__tests__/backtest-runner.test.ts"
stage_and_run 1 "(t098-v6) isolation.test.ts 를 T-963(구현만 scope)로 통과 시도 → 차단" \
  "$(msg 'test(T-963): 격리 시험 수정')" "src/lib/profit-engine/__tests__/isolation.test.ts"
stage_and_run 1 "(t098-v7) backtest-fixtures.ts 를 T-963(구현만 scope)로 통과 시도 → 차단" \
  "$(msg 'test(T-963): 합성 일봉 수정')" "src/lib/profit-engine/__tests__/backtest-fixtures.ts"
stage_and_run_expect "$T075_OK" 0 "(t098-v8) registry/hash.ts + T-963(구현 scope 안) → 통과(대조군)" \
  "$(msg 'fix(T-963): 해시 코드 수정')" "src/lib/profit-engine/registry/hash.ts"

# 이웃은 감사 대상이 아니다 — task ID 없이도 통과해야 한다. 통과 기대는 묶어도 약해지지 않는다(하나라도 잘못 매치되면 exit 1).
# 겨냥 변이: `^src/lib/profit-engine/__tests__/` 로 넓히기(daily-bars·signal-postmortem 시험·fake-bars-db) · isolation 의 `$` 삭제(.bak) ·
# `\.test`·`\.ts` 이스케이프 누락(isolationxtest.ts·isolation.testxts) · 위치 무시(profit-engine/ 바로 아래) · `backtest-` 의 `-` 삭제
# (backtest.test.ts·backtestx.test.ts) · `^` 삭제(foo/…) · `^src/lib/profit-engine/` 로 넓히기(daily-bars-*.ts).
stage_and_run 0 "(t098-n1) profit-engine 이웃(일봉 수집·P1 시험·격리 시험 변형·backtest 무접두) → 통과" \
  "$(msg 'chore: 일봉 수집 정리')" \
  "src/lib/profit-engine/daily-bars-collector.ts" "src/lib/profit-engine/daily-bars-store.ts" \
  "src/lib/profit-engine/__tests__/daily-bars-collector.test.ts" "src/lib/profit-engine/__tests__/fake-bars-db.ts" \
  "src/lib/profit-engine/__tests__/signal-postmortem-core.test.ts" "src/lib/profit-engine/isolation.test.ts" \
  "src/lib/profit-engine/__tests__/isolation.test.tsx" "src/lib/profit-engine/__tests__/isolation.test.ts.bak" \
  "src/lib/profit-engine/__tests__/isolationxtest.ts" "src/lib/profit-engine/__tests__/isolation.testxts" \
  "src/lib/profit-engine/__tests__/backtest.test.ts" "src/lib/profit-engine/__tests__/backtestx.test.ts" \
  "foo/src/lib/profit-engine/__tests__/backtest-runner.test.ts" "foo/src/lib/profit-engine/__tests__/isolation.test.ts"
# 디렉토리 접두 경계 — 겨냥 변이: 끝 `/` 삭제(registry-x/·registryx.ts·registry.json·backtest-x/·backtestx.ts·backtest.ts) ·
# `^` 삭제(foo/…·mockups/…) · `profit-engine/` 위치 무시(src/lib/registry/·src/lib/backtest/).
stage_and_run 0 "(t098-n2) 가짜 접두 디렉토리(registry-x/·backtestx 등)·위치만 다른 경로 → 통과" \
  "$(msg 'chore: 이웃 경로 정리')" \
  "src/lib/profit-engine/registry-x/preregistration.json" "src/lib/profit-engine/registryx.ts" \
  "src/lib/profit-engine/registry.json" "src/lib/profit-engine/backtest-x/fill.ts" \
  "src/lib/profit-engine/backtestx.ts" "src/lib/profit-engine/backtest.ts" \
  "foo/src/lib/profit-engine/registry/preregistration.json" "mockups/src/lib/profit-engine/backtest/fill.ts" \
  "src/lib/registry/preregistration.json" "src/lib/backtest/fill.ts"
# 러너 이웃 — 겨냥 변이: `^scripts/profit-engine/` 로 넓히기(postmortem-core·signal-postmortem·holdings-*) · `$` 삭제(.bak) ·
# `\.` 이스케이프 누락(backtest-runnerxmjs·backtest-runner-corexjs) · 확장자 혼동(.js·-core.mjs) · 위치 무시(scripts/ 바로 아래) · `^` 삭제.
stage_and_run 0 "(t098-n3) 러너 이웃(사후검증·보유 리포트·.bak·xmjs·확장자·위치) → 통과" \
  "$(msg 'chore: 사후검증 스크립트 정리')" \
  "scripts/profit-engine/postmortem-core.js" "scripts/profit-engine/signal-postmortem.mjs" \
  "scripts/profit-engine/holdings-core.mjs" "scripts/profit-engine/holdings-report.mjs" \
  "scripts/profit-engine/holdings-report.test.mjs" "scripts/profit-engine/backtest-runner.mjs.bak" \
  "scripts/profit-engine/backtest-runner-core.js.bak" "scripts/profit-engine/backtest-runnerxmjs" \
  "scripts/profit-engine/backtest-runner-corexjs" "scripts/profit-engine/backtest-runner.js" \
  "scripts/profit-engine/backtest-runner-core.mjs" "scripts/backtest-runner.mjs" \
  "foo/scripts/profit-engine/backtest-runner.mjs" "foo/scripts/profit-engine/backtest-runner-core.js"
# 문서 — 러너 출력 리포트·동결 문서는 훅 대상이 아니다(리포트는 g1-record.json 이 sha256 으로, 문서 §B 는 preregistration.json 이 고정).
stage_and_run 0 "(t098-n4) 러너 리포트·동결 사전 등록 문서 → 통과" \
  "$(msg 'docs: 백테스트 counts 리포트')" \
  "agent-vault/10-Flow/reports/T-096-backtest-counts-US-20261026.json" \
  "agent-vault/10-Flow/reports/T-096-backtest-counts-US-20261026.md" \
  "docs/design/2026-10-26-strategy-validation-preregistration-v1.0.md"

# 혼합 커밋 — 판정 합집합(요구사항4). T-964(새 항목)·T-966(지표 strategy/ 등) 이 각자 자기 몫만 덮는다.
T098_MIX=( "README.md" "src/lib/profit-engine/registry/oos-ledger.json" "src/lib/profit-engine/backtest/fill.ts" \
  "src/lib/strategy/indicators/rsi.ts" "docs/design/x.md" )
stage_and_run 1 "(t098-m1) [문서, 원장, 체결, 지표] 판정 미기록(T-993) → 차단" \
  "$(msg 'feat(T-993): 백테스트 정리')" "${T098_MIX[@]}"
stage_and_run 1 "(t098-m2) 같은 묶음 + T-964 만 → 지표(strategy/)가 범위 밖, 차단" \
  "$(msg 'feat(T-964): 백테스트 정리')" "${T098_MIX[@]}"
stage_and_run 1 "(t098-m3) 같은 묶음 + T-966 만 → 원장·체결이 범위 밖, 차단" \
  "$(msg 'feat(T-966): 백테스트 정리')" "${T098_MIX[@]}"
stage_and_run_expect "$T075_OK" 0 "(t098-m4) 같은 묶음 + T-964·T-966 합집합 → 통과" \
  "$(msg 'feat(T-964,T-966): 백테스트 정리')" "${T098_MIX[@]}"
stage_and_run_expect "$T075_OK" 0 "(t098-m5) 새 항목 13개 전부 + 문서, T-964 → 통과" \
  "$(msg 'feat(T-964): 사전 등록 일괄')" "${T098_ITEMS[@]}" "docs/x.md"
# 러너 실행 뒤 원장 갱신 커밋(의도된 마찰) — 리포트(문서)와 함께 올려도 원장 때문에 판정이 필요하다.
stage_and_run 1 "(t098-m6) [IS 원장, counts 리포트] task ID 없음 → 원장 때문에 차단" \
  "$(msg 'chore: IS 실행 기록')" "src/lib/profit-engine/registry/is-ledger.json" \
  "agent-vault/10-Flow/reports/T-096-backtest-counts-US-20261026.json"
stage_and_run_expect "$T075_OK" 0 "(t098-m7) 같은 묶음 + T-964 → 통과(리포트는 안전 경로 아님)" \
  "$(msg 'chore(T-964): IS 실행 기록')" "src/lib/profit-engine/registry/is-ledger.json" \
  "agent-vault/10-Flow/reports/T-096-backtest-counts-US-20261026.json"
# 일봉 수집 자체는 감시 밖이지만, 같은 커밋에서 격리 시험을 고치면 걸린다(알려진 영향).
stage_and_run 1 "(t098-m8) [daily-bars-collector.ts, isolation.test.ts] task ID 없음 → 격리 시험 때문에 차단" \
  "$(msg 'feat: 일봉 수집 + 격리 시험')" "src/lib/profit-engine/daily-bars-collector.ts" \
  "src/lib/profit-engine/__tests__/isolation.test.ts"
stage_and_run_expect "$T075_OK" 0 "(t098-m9) 같은 묶음 + T-964 → 통과(daily-bars 는 안전 경로 아님)" \
  "$(msg 'feat(T-964): 일봉 수집 + 격리 시험')" "src/lib/profit-engine/daily-bars-collector.ts" \
  "src/lib/profit-engine/__tests__/isolation.test.ts"

echo ""
echo "[T-098 — 실 커밋 E2E: 일회용 임시 저장소에서 git 이 새 항목을 실제로 거르는가]"

# 위 T-090·T-092·T-093 실 커밋 E2E 와 같은 일회용 저장소·shim(이 작업 트리의 훅)을 그대로 쓴다. 실제 저장소는 건드리지 않는다.
cat > "$E2E_REPO/agent-vault/10-Flow/tasks/T-964-hooktest-t098-scoped.md" <<'EOF'
---
task_id: T-964
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/profit-engine/registry/, src/lib/profit-engine/backtest/, scripts/profit-engine/backtest-runner.mjs, scripts/profit-engine/backtest-runner-core.js, src/lib/profit-engine/__tests__/backtest-runner.test.ts, src/lib/profit-engine/__tests__/isolation.test.ts)**
EOF
cat > "$E2E_REPO/agent-vault/10-Flow/tasks/T-965-hooktest-t098-nearmiss.md" <<'EOF'
---
task_id: T-965
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/profit-engine/registry, src/lib/profit-engine/registry-x/, scripts/profit-engine/postmortem-core.js, src/lib/profit-engine/__tests__/backtest-)**
EOF
cat > "$E2E_REPO/agent-vault/10-Flow/tasks/T-966-hooktest-t098-borrowed.md" <<'EOF'
---
task_id: T-966
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/strategy/, src/lib/signals/, scripts/git-hooks/)**
EOF
cat > "$E2E_REPO/agent-vault/10-Flow/tasks/T-963-hooktest-t098-implonly.md" <<'EOF'
---
task_id: T-963
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/profit-engine/registry/, src/lib/profit-engine/backtest/, scripts/profit-engine/backtest-runner.mjs, scripts/profit-engine/backtest-runner-core.js)**
EOF
mkdir -p "$E2E_REPO/src/lib/profit-engine/registry" "$E2E_REPO/src/lib/profit-engine/registry-x" \
  "$E2E_REPO/src/lib/profit-engine/__tests__" "$E2E_REPO/scripts/profit-engine" "$E2E_REPO/agent-vault/10-Flow/reports"
# (fixture 는 커밋하지 않는다 — 훅은 작업 트리의 task 파일을 읽는다. 앞 절 fixture 와 같다.)

printf '{"entries":[]}\n' > "$E2E_REPO/src/lib/profit-engine/registry/is-ledger.json"
e2e_git add src/lib/profit-engine/registry/is-ledger.json
e2e_commit "(t098-g1) 실 커밋: registry/is-ledger.json(신규) + task ID 없음 → 차단" block "커밋 차단" \
  'chore: IS 원장 추가'
e2e_commit "(t098-g2) 실 커밋: 같은 변경 + T-965(이웃 경로 scope) → 차단" block "커밋 차단" \
  'chore(T-965): IS 원장 추가'
e2e_commit "(t098-g3) 실 커밋: 같은 변경 + T-966(다른 안전 경로 scope) → 차단(차용 방지)" block "커밋 차단" \
  'chore(T-966): IS 원장 추가'
e2e_commit "(t098-g4) 실 커밋: 같은 변경 + T-964(scope 포함) → 통과·HEAD 이동" commit "$T075_OK" \
  'chore(T-964): IS 원장 추가'

printf 'v1\n' > "$E2E_REPO/scripts/profit-engine/backtest-runner-core.js"
printf 'v1\n' > "$E2E_REPO/src/lib/profit-engine/__tests__/backtest-runner.test.ts"
e2e_git add scripts/profit-engine/backtest-runner-core.js src/lib/profit-engine/__tests__/backtest-runner.test.ts
e2e_commit "(t098-g5) 실 커밋: [러너 core, 러너 시험] + task ID 없음 → 차단" block "커밋 차단" \
  'feat: 러너 관문'
e2e_commit "(t098-g6) 실 커밋: 같은 변경 + T-963(구현만 검토) → 차단(시험이 범위 밖)" block "커밋 차단" \
  'feat(T-963): 러너 관문'
e2e_commit "(t098-g7) 실 커밋: 같은 변경 + T-964 → 통과·HEAD 이동" commit "$T075_OK" \
  'feat(T-964): 러너 관문'

printf 'x\n' > "$E2E_REPO/scripts/profit-engine/postmortem-core.js"
printf 'x\n' > "$E2E_REPO/src/lib/profit-engine/daily-bars-collector.ts"
printf 'x\n' > "$E2E_REPO/src/lib/profit-engine/registry-x/a.json"
printf 'x\n' > "$E2E_REPO/agent-vault/10-Flow/reports/T-096-backtest-counts-US-20261026.md"
e2e_git add scripts/profit-engine/postmortem-core.js src/lib/profit-engine/daily-bars-collector.ts \
  src/lib/profit-engine/registry-x/a.json agent-vault/10-Flow/reports/T-096-backtest-counts-US-20261026.md
e2e_commit "(t098-g8) 실 커밋: 사후검증 본체·일봉 수집·registry-x/·리포트(task ID 없음) → 통과" commit "" \
  'chore: 사후검증·일봉·리포트 정리'

echo ""
echo "[T-094 — 메일 헤더·본문 안전화 header-safe.ts·그 시험(정확 일치 2줄) 추가]"

# T-093 과 같은 방식. 항목마다 ①판정 미기록 → 차단 ②유효 판정(scope 포함) → 통과(통과 문구까지 확인) ③이름이 비슷한 이웃만
# 검토한 판정 → 차단 ④·⑤ 앞 라운드의 인접 판정(T-093 의 mail/config.ts·T-092 의 mail/send.ts 와 그 시험) 차용 → 차단.
# 각 시나리오는 새 경로 파일 **하나만** stage 한다 — 목록에서 그 줄 하나만 빠져도 그 항목의 ①~⑤ 가 실패한다.
T094_ITEMS=(
  "src/lib/mail/header-safe.ts"                 # a1 sanitizeHeaderText·isSafeHeaderAddress·escapeHtml 정의
  "src/lib/mail/__tests__/header-safe.test.ts"  # a2 그 시험
)

cat > "agent-vault/10-Flow/tasks/T-962-hooktest-t094-scoped.md" <<'EOF'
---
task_id: T-962
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/mail/header-safe.ts, src/lib/mail/__tests__/header-safe.test.ts)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-962-hooktest-t094-scoped.md")

# ③ 용 — 이름이 비슷한 '이웃'만 검토한 판정. 어느 것도 새 2개를 덮지 않아야 한다:
#    슬래시 없는 `src/lib/mail`·`src/lib/mail/__tests__`(= 그 이름의 파일 하나만) · 확장자·위치만 다른 파일(.tsx·lib/ 바로 아래·
#    시험 이름을 구현 위치에) · 같은 디렉토리의 형제(signup-request-mail·config·send 와 그 시험).
cat > "agent-vault/10-Flow/tasks/T-961-hooktest-t094-nearmiss.md" <<'EOF'
---
task_id: T-961
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/mail, src/lib/mail/__tests__, src/lib/mail/header-safe.tsx, src/lib/header-safe.ts, src/lib/mail/header-safe.test.ts, src/lib/mail/__tests__/header-safe.test.tsx, src/lib/mail/signup-request-mail.ts, src/lib/mail/__tests__/signup-request-mail.test.ts, src/lib/mail/config.ts, src/lib/mail/send.ts, src/lib/mail/__tests__/send.test.ts)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-961-hooktest-t094-nearmiss.md")

# 구현만 검토한 판정 — header-safe.ts 는 덮지만 시험은 덮지 않는다(T-093 ④ 와 같은 처리: 구현을 봤다고 시험을 본 게 아니다).
cat > "agent-vault/10-Flow/tasks/T-960-hooktest-t094-implonly.md" <<'EOF'
---
task_id: T-960
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/mail/header-safe.ts)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-960-hooktest-t094-implonly.md")

t094_i=0
for t094_p in "${T094_ITEMS[@]}"; do
  t094_i=$((t094_i + 1))
  stage_and_run 1 "(t094-a${t094_i}.1) ${t094_p#src/lib/} + 판정 미기록(T-993) → 차단" \
    "$(msg 'fix(T-993): 메일 헤더 정리')" "$t094_p"
  stage_and_run_expect "$T075_OK" 0 "(t094-a${t094_i}.2) ${t094_p#src/lib/} + T-962(scope 포함) → 통과" \
    "$(msg 'fix(T-962): 메일 헤더 정리')" "$t094_p"
  stage_and_run 1 "(t094-a${t094_i}.3) ${t094_p#src/lib/} + T-961(이웃 경로 scope) → 차단" \
    "$(msg 'fix(T-961): 메일 헤더 정리')" "$t094_p"
  stage_and_run 1 "(t094-a${t094_i}.4) ${t094_p#src/lib/} + T-969(T-093 scope — config.ts 포함) → 차단" \
    "$(msg 'fix(T-969): 메일 헤더 정리')" "$t094_p"
  stage_and_run 1 "(t094-a${t094_i}.5) ${t094_p#src/lib/} + T-978(T-092 scope — send.ts·그 시험 포함) → 차단" \
    "$(msg 'fix(T-978): 메일 헤더 정리')" "$t094_p"
done

# task ID 없이 고친 경우
stage_and_run 1 "(t094-b1) mail/header-safe.ts + task ID 없음 → 차단" \
  "$(msg 'fix: 헤더 정화 정리')" "src/lib/mail/header-safe.ts"
stage_and_run 1 "(t094-b2) mail/__tests__/header-safe.test.ts + task ID 없음 → 차단" \
  "$(msg 'test: 헤더 시험 정리')" "src/lib/mail/__tests__/header-safe.test.ts"

# 구현만 검토한 판정 — 시험은 못 열고(차단), 구현은 연다(대조군).
stage_and_run 1 "(t094-v1) header-safe.test.ts 를 T-960(구현만 scope)로 통과 시도 → 차단" \
  "$(msg 'test(T-960): 헤더 시험 수정')" "src/lib/mail/__tests__/header-safe.test.ts"
stage_and_run_expect "$T075_OK" 0 "(t094-v2) header-safe.ts + T-960(구현 scope 안) → 통과(대조군)" \
  "$(msg 'fix(T-960): 헤더 정화 수정')" "src/lib/mail/header-safe.ts"
stage_and_run 1 "(t094-v3) [header-safe.ts, 그 시험] T-960 만 → 시험이 범위 밖, 차단" \
  "$(msg 'fix(T-960): 헤더 정화 + 시험')" "src/lib/mail/header-safe.ts" "src/lib/mail/__tests__/header-safe.test.ts"

# 이웃은 감사 대상이 아니다 — task ID 없이도 통과해야 한다. 통과 기대는 묶어도 약해지지 않는다(하나라도 잘못 매치되면 exit 1).
# 겨냥 변이: `^src/lib/mail/` 로 넓히기(signup-request-mail) · `^src/lib/mail/__tests__/` 로 넓히기(signup-request-mail 시험) ·
# `$` 삭제(.bak·.tsx·-v2 접미) · `\.ts` 의 `.` 이스케이프 누락(header-safexts·header-safe.testxts) · `\.test` 의 이스케이프 누락
# (header-safextest.ts) · 위치 무시(lib/ 바로 아래·시험 이름을 구현 위치에·구현 이름을 시험 위치에) · `^` 삭제(foo/·mockups/) ·
# 대소문자(Header-safe.ts — 훅은 대소문자를 구분한다).
stage_and_run 0 "(t094-n1) header-safe 이웃(.tsx·.bak·xts·위치·대소문자·형제 메일 파일) → 통과" \
  "$(msg 'chore: 메일 이웃 정리')" \
  "src/lib/mail/signup-request-mail.ts" "src/lib/mail/__tests__/signup-request-mail.test.ts" \
  "src/lib/mail/header-safe.tsx" "src/lib/mail/header-safe.ts.bak" "src/lib/mail/header-safe-v2.ts" \
  "src/lib/mail/header-safexts" "src/lib/mail/Header-safe.ts" "src/lib/header-safe.ts" \
  "src/lib/mail/header-safe.test.ts" "src/lib/mail/__tests__/header-safe.ts" \
  "src/lib/mail/__tests__/header-safe.test.tsx" "src/lib/mail/__tests__/header-safe.test.ts.bak" \
  "src/lib/mail/__tests__/header-safextest.ts" "src/lib/mail/__tests__/header-safe.testxts" \
  "foo/src/lib/mail/header-safe.ts" "mockups/src/lib/mail/__tests__/header-safe.test.ts" "src/types/nodemailer.d.ts"

# 혼합 커밋 — 판정 합집합. T-962(새 2개)·T-978(T-092 의 send.ts)·T-969(T-093 의 config.ts)가 각자 자기 몫만 덮는다.
T094_MIX=( "README.md" "src/lib/mail/header-safe.ts" "src/lib/mail/__tests__/header-safe.test.ts" "src/lib/mail/send.ts" "src/lib/mail/config.ts" )
stage_and_run 1 "(t094-m1) [문서, header-safe·시험, send.ts, config.ts] 판정 미기록(T-993) → 차단" \
  "$(msg 'fix(T-993): 메일 정리')" "${T094_MIX[@]}"
stage_and_run 1 "(t094-m2) 같은 묶음 + T-962 만 → send.ts·config.ts 가 범위 밖, 차단" \
  "$(msg 'fix(T-962): 메일 정리')" "${T094_MIX[@]}"
stage_and_run 1 "(t094-m3) 같은 묶음 + T-978·T-969 만 → header-safe 2개가 범위 밖, 차단" \
  "$(msg 'fix(T-978,T-969): 메일 정리')" "${T094_MIX[@]}"
stage_and_run_expect "$T075_OK" 0 "(t094-m4) 같은 묶음 + T-962·T-978·T-969 합집합 → 통과" \
  "$(msg 'fix(T-962,T-978,T-969): 메일 정리')" "${T094_MIX[@]}"
# 형제 signup-request-mail.ts 는 감시 밖이지만 같은 커밋의 header-safe.ts 때문에 걸린다.
stage_and_run 1 "(t094-m5) [signup-request-mail.ts, header-safe.ts] task ID 없음 → header-safe 때문에 차단" \
  "$(msg 'feat: 가입 요청 메일 정리')" "src/lib/mail/signup-request-mail.ts" "src/lib/mail/header-safe.ts"
stage_and_run_expect "$T075_OK" 0 "(t094-m6) 같은 묶음 + T-962 → 통과(signup-request-mail 은 안전 경로 아님)" \
  "$(msg 'feat(T-962): 가입 요청 메일 정리')" "src/lib/mail/signup-request-mail.ts" "src/lib/mail/header-safe.ts"

echo ""
echo "[T-094 — 실 커밋 E2E: 일회용 임시 저장소에서 git 이 새 항목을 실제로 거르는가]"

# 위 T-090~T-098 실 커밋 E2E 와 같은 일회용 저장소·shim(이 작업 트리의 훅)을 그대로 쓴다. 실제 저장소는 건드리지 않는다.
cat > "$E2E_REPO/agent-vault/10-Flow/tasks/T-962-hooktest-t094-scoped.md" <<'EOF'
---
task_id: T-962
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/mail/header-safe.ts, src/lib/mail/__tests__/header-safe.test.ts)**
EOF
cat > "$E2E_REPO/agent-vault/10-Flow/tasks/T-961-hooktest-t094-nearmiss.md" <<'EOF'
---
task_id: T-961
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/mail, src/lib/mail/signup-request-mail.ts, src/lib/mail/header-safe.tsx, src/lib/mail/__tests__/send.test.ts)**
EOF
cat > "$E2E_REPO/agent-vault/10-Flow/tasks/T-960-hooktest-t094-implonly.md" <<'EOF'
---
task_id: T-960
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/mail/header-safe.ts)**
EOF
mkdir -p "$E2E_REPO/src/lib/mail/__tests__"
# (fixture 는 커밋하지 않는다 — 훅은 작업 트리의 task 파일을 읽는다. 앞 절 fixture 와 같다.)
# T-969(T-093 scope — config.ts 포함) fixture 는 위 T-093 E2E 절이 이 저장소에 이미 써 두었다(차용 시험에 쓴다).

printf 'v1\n' > "$E2E_REPO/src/lib/mail/header-safe.ts"
e2e_git add src/lib/mail/header-safe.ts
e2e_commit "(t094-g1) 실 커밋: header-safe.ts + task ID 없음 → 차단" block "커밋 차단" \
  'fix: 헤더 정화 정리'
e2e_commit "(t094-g2) 실 커밋: 같은 변경 + T-961(이웃 경로 scope) → 차단" block "커밋 차단" \
  'fix(T-961): 헤더 정화 정리'
e2e_commit "(t094-g3) 실 커밋: 같은 변경 + T-969(T-093 의 config.ts scope) → 차단(차용 방지)" block "커밋 차단" \
  'fix(T-969): 헤더 정화 정리'
e2e_commit "(t094-g4) 실 커밋: 같은 변경 + T-962(scope 포함) → 통과·HEAD 이동" commit "$T075_OK" \
  'fix(T-962): 헤더 정화 정리'

printf 'v2\n' > "$E2E_REPO/src/lib/mail/header-safe.ts"
printf 'v1\n' > "$E2E_REPO/src/lib/mail/__tests__/header-safe.test.ts"
e2e_git add src/lib/mail/header-safe.ts src/lib/mail/__tests__/header-safe.test.ts
e2e_commit "(t094-g5) 실 커밋: [header-safe.ts, 그 시험] + T-960(구현만 검토) → 차단(시험이 범위 밖)" block "커밋 차단" \
  'fix(T-960): 헤더 정화 + 시험'
e2e_commit "(t094-g6) 실 커밋: 같은 변경 + T-962 → 통과·HEAD 이동" commit "$T075_OK" \
  'fix(T-962): 헤더 정화 + 시험'

printf 'x\n' > "$E2E_REPO/src/lib/mail/signup-request-mail.ts"
printf 'x\n' > "$E2E_REPO/src/lib/mail/__tests__/signup-request-mail.test.ts"
printf 'x\n' > "$E2E_REPO/src/lib/mail/header-safe.tsx"
e2e_git add src/lib/mail/signup-request-mail.ts src/lib/mail/__tests__/signup-request-mail.test.ts src/lib/mail/header-safe.tsx
e2e_commit "(t094-g7) 실 커밋: 형제 메일 파일·그 시험·header-safe.tsx 이웃(task ID 없음) → 통과" commit "" \
  'chore: 메일 이웃 정리'

echo ""
echo "[T-116 — 기업정보 통합 모듈 src/lib/corp-intel/ (디렉토리 항목) 추가]"

# 2차 설계 D8. 디렉토리 항목 1줄(`^src/lib/corp-intel/`) — 구현·시험·하위 폴더·아직 없는 새 파일이 전부 걸려야 한다.
# 항목마다 ①판정 미기록 → 차단 ②유효 판정(scope 포함) → 통과(통과 문구까지 확인) ③이름이 비슷한 이웃만 검토한 판정 → 차단
# ④다른 안전 경로(이 모듈을 부르는 news-fetch 라우트의 src/app/api/cron/ 등)만 검토한 판정 차용 → 차단.
# 각 시나리오는 경로 **하나만** stage 한다 — 목록에서 그 줄이 빠지면 ①·④ 가 실패한다.
T116_ITEMS=(
  "src/lib/corp-intel/raw-capture.ts"                 # a1 캡처(스위치·first_seen_at 보존 SQL)
  "src/lib/corp-intel/keys.ts"                        # a2 멱등 키
  "src/lib/corp-intel/status.ts"                      # a3 캡처 상태 기록
  "src/lib/corp-intel/__tests__/isolation.test.ts"    # a4 경계 시험(격리 방어선)
  "src/lib/corp-intel/__tests__/raw-capture.test.ts"  # a5 캡처 시험
  "src/lib/corp-intel/events/builder.ts"              # a6 아직 없는 하위 폴더의 새 파일(단계 2 자리)
)

cat > "agent-vault/10-Flow/tasks/T-958-hooktest-t116-scoped.md" <<'EOF'
---
task_id: T-958
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/corp-intel/)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-958-hooktest-t116-scoped.md")

# ③ 용 — 이웃만 검토한 판정. 슬래시 없는 `src/lib/corp-intel`(= 그 이름의 파일 하나만) · 가짜 접두 디렉토리(corp-intelx/·corp-intel-old/) ·
#    같은 이름의 파일(corp-intel.ts) · 위치만 다른 경로(foo/…) · 부르는 쪽 라우트 폴더.
cat > "agent-vault/10-Flow/tasks/T-957-hooktest-t116-nearmiss.md" <<'EOF'
---
task_id: T-957
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/corp-intel, src/lib/corp-intelx/, src/lib/corp-intel-old/, src/lib/corp-intel.ts, foo/src/lib/corp-intel/, src/app/api/cron/news-fetch/)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-957-hooktest-t116-nearmiss.md")

# ④ 용 — 차용 방지: 이 모듈과 함께 바뀌는 다른 안전 경로(cron 라우트·DDL·러너·훅)와 이웃 모듈(rag/·profit-engine/)만 검토한 판정.
cat > "agent-vault/10-Flow/tasks/T-956-hooktest-t116-borrowed.md" <<'EOF'
---
task_id: T-956
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/app/api/cron/, scripts/migrations/, scripts/cron-runner.sh, scripts/git-hooks/, src/lib/rag/, src/lib/profit-engine/)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-956-hooktest-t116-borrowed.md")

t116_i=0
for t116_p in "${T116_ITEMS[@]}"; do
  t116_i=$((t116_i + 1))
  stage_and_run 1 "(t116-a${t116_i}.1) ${t116_p#src/lib/} + 판정 미기록(T-993) → 차단" \
    "$(msg 'feat(T-993): 기업정보 캡처')" "$t116_p"
  stage_and_run_expect "$T075_OK" 0 "(t116-a${t116_i}.2) ${t116_p#src/lib/} + T-958(scope 포함) → 통과" \
    "$(msg 'feat(T-958): 기업정보 캡처')" "$t116_p"
  stage_and_run 1 "(t116-a${t116_i}.3) ${t116_p#src/lib/} + T-957(이웃 경로 scope) → 차단" \
    "$(msg 'feat(T-957): 기업정보 캡처')" "$t116_p"
  stage_and_run 1 "(t116-a${t116_i}.4) ${t116_p#src/lib/} + T-956(다른 안전 경로 scope) → 차단(차용 방지)" \
    "$(msg 'feat(T-956): 기업정보 캡처')" "$t116_p"
done

stage_and_run 1 "(t116-b1) corp-intel/raw-capture.ts + task ID 없음 → 차단" \
  "$(msg 'fix: 캡처 정리')" "src/lib/corp-intel/raw-capture.ts"
stage_and_run 1 "(t116-b2) corp-intel/__tests__/isolation.test.ts + task ID 없음 → 차단" \
  "$(msg 'test: 경계 시험 정리')" "src/lib/corp-intel/__tests__/isolation.test.ts"

# 이웃은 감사 대상이 아니다 — task ID 없이도 통과해야 한다(하나라도 잘못 매치되면 exit 1).
# 겨냥 변이: 끝 `/` 삭제(corp-intel.ts·corp-intelx/·corp-intel-old/) · `^` 삭제(foo/·mockups/) · 위치 무시(src/corp-intel/·lib/corp-intel/) ·
# 대소문자(Corp-intel — 훅은 대소문자를 구분한다) · 설계 문서·DDL 이 아닌 문서.
stage_and_run 0 "(t116-n1) corp-intel 이웃(.ts·intelx/·-old/·foo/·mockups/·위치·대소문자·문서) → 통과" \
  "$(msg 'chore: 이웃 정리')" \
  "src/lib/corp-intel.ts" "src/lib/corp-intelx/raw-capture.ts" "src/lib/corp-intel-old/keys.ts" \
  "foo/src/lib/corp-intel/raw-capture.ts" "mockups/src/lib/corp-intel/raw-capture.ts" \
  "src/corp-intel/raw-capture.ts" "lib/corp-intel/raw-capture.ts" "src/lib/Corp-intel/raw-capture.ts" \
  "docs/design/2026-10-28-corporate-intelligence-second-design.md" "src/lib/intel/raw-capture.ts"

# 혼합 커밋 — 판정 합집합. T-958(corp-intel/)·T-956(cron 라우트·DDL·러너)이 각자 자기 몫만 덮는다.
T116_MIX=( "README.md" "src/lib/corp-intel/raw-capture.ts" "src/app/api/cron/news-fetch/route.ts" \
  "scripts/migrations/T-116-ci-raw-item.sql" "scripts/cron-runner.sh" )
stage_and_run 1 "(t116-m1) [문서, 캡처, 라우트, DDL, 러너] 판정 미기록(T-993) → 차단" \
  "$(msg 'feat(T-993): 뉴스 최초 관측 캡처')" "${T116_MIX[@]}"
stage_and_run 1 "(t116-m2) 같은 묶음 + T-958 만 → 라우트·DDL·러너가 범위 밖, 차단" \
  "$(msg 'feat(T-958): 뉴스 최초 관측 캡처')" "${T116_MIX[@]}"
stage_and_run 1 "(t116-m3) 같은 묶음 + T-956 만 → corp-intel 이 범위 밖, 차단" \
  "$(msg 'feat(T-956): 뉴스 최초 관측 캡처')" "${T116_MIX[@]}"
stage_and_run_expect "$T075_OK" 0 "(t116-m4) 같은 묶음 + T-958·T-956 합집합 → 통과" \
  "$(msg 'feat(T-958,T-956): 뉴스 최초 관측 캡처')" "${T116_MIX[@]}"
stage_and_run_expect "$T075_OK" 0 "(t116-m5) 항목 6개 전부 + 문서, T-958 → 통과" \
  "$(msg 'feat(T-958): corp-intel 일괄')" "${T116_ITEMS[@]}" "docs/x.md"

echo ""
echo "[T-116 — 실 커밋 E2E: 일회용 임시 저장소에서 git 이 corp-intel/ 을 실제로 거르는가]"

cat > "$E2E_REPO/agent-vault/10-Flow/tasks/T-958-hooktest-t116-scoped.md" <<'EOF'
---
task_id: T-958
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/corp-intel/)**
EOF
cat > "$E2E_REPO/agent-vault/10-Flow/tasks/T-957-hooktest-t116-nearmiss.md" <<'EOF'
---
task_id: T-957
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/corp-intel, src/lib/corp-intelx/, src/app/api/cron/news-fetch/)**
EOF
cat > "$E2E_REPO/agent-vault/10-Flow/tasks/T-956-hooktest-t116-borrowed.md" <<'EOF'
---
task_id: T-956
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/app/api/cron/, scripts/migrations/, scripts/git-hooks/)**
EOF
mkdir -p "$E2E_REPO/src/lib/corp-intel/__tests__" "$E2E_REPO/src/lib/corp-intelx"

printf 'v1\n' > "$E2E_REPO/src/lib/corp-intel/raw-capture.ts"
e2e_git add src/lib/corp-intel/raw-capture.ts
e2e_commit "(t116-g1) 실 커밋: corp-intel/raw-capture.ts(신규) + task ID 없음 → 차단" block "커밋 차단" \
  'feat: 뉴스 캡처'
e2e_commit "(t116-g2) 실 커밋: 같은 변경 + T-957(이웃 경로 scope) → 차단" block "커밋 차단" \
  'feat(T-957): 뉴스 캡처'
e2e_commit "(t116-g3) 실 커밋: 같은 변경 + T-956(다른 안전 경로 scope) → 차단(차용 방지)" block "커밋 차단" \
  'feat(T-956): 뉴스 캡처'
e2e_commit "(t116-g4) 실 커밋: 같은 변경 + T-958(scope 포함) → 통과·HEAD 이동" commit "$T075_OK" \
  'feat(T-958): 뉴스 캡처'

printf 'v1\n' > "$E2E_REPO/src/lib/corp-intel/__tests__/isolation.test.ts"
e2e_git add src/lib/corp-intel/__tests__/isolation.test.ts
e2e_commit "(t116-g5) 실 커밋: corp-intel/__tests__/isolation.test.ts + task ID 없음 → 차단" block "커밋 차단" \
  'test: 경계 시험'
e2e_commit "(t116-g6) 실 커밋: 같은 변경 + T-958 → 통과·HEAD 이동" commit "$T075_OK" \
  'test(T-958): 경계 시험'

printf 'x\n' > "$E2E_REPO/src/lib/corp-intelx/a.ts"
printf 'x\n' > "$E2E_REPO/src/lib/corp-intel.ts"
e2e_git add src/lib/corp-intelx/a.ts src/lib/corp-intel.ts
e2e_commit "(t116-g7) 실 커밋: corp-intelx/·corp-intel.ts 이웃(task ID 없음) → 통과" commit "" \
  'chore: 이웃 정리'

echo ""
echo "[T-145 — 해외 자동 목록 src/lib/universe/ (디렉토리) · 러너 시험 접두 · 정확 일치 3줄 추가]"

# 사용자 결정 "넣기 찬성"(2026-11-02). 세 항목의 성질이 달라 따로 본다:
#   ① `^src/lib/universe/`                              디렉토리 — 구현·시험·모형·아직 없는 새 파일이 전부 걸려야 한다
#   ② `^scripts/test-cron-runner-`                      **접두**(슬래시로 끝나지 않는다) — 이름이 그 접두로 시작하는 파일만
#   ③ 정확 일치 3줄 — 같은 디렉토리의 **형제는 걸리지 않아야** 한다:
#      `^src/lib/data/__tests__/us-data-db\.test\.ts$` · `^src/lib/data/kis-fundamentals-snapshot\.ts$`(⑨의 1회 마감) ·
#      `^src/lib/data/__tests__/kis-fundamentals-snapshot\.test\.ts$`(그 회귀망)
# 항목마다 ①판정 미기록 → 차단 ②유효 판정(scope 포함) → 통과 ③이웃만 검토한 판정 → 차단 ④다른 안전 경로 판정 차용 → 차단.
T145_ITEMS=(
  "src/lib/universe/refresh-config.ts"                       # a1 스위치 판독 한 벌(③의 핵심)
  "src/lib/universe/refresh-store.ts"                        # a2 일시/영구 판정·행 가드
  "src/lib/universe/refresh-engine.ts"                       # a3 제안 조건·단계·예산
  "src/lib/universe/rank.ts"                                 # a4 상위 N 선정(= 무엇을 분석하는가)
  "src/lib/universe/proposal-copy.ts"                        # a5 화면 문구 — 알고 넣은 과도포함
  "src/lib/universe/__tests__/refresh-store-row-guards.test.ts"  # a6 시험
  "src/lib/universe/__tests__/helpers/fake-refresh-store.ts"     # a7 모형(하위 폴더)
  "src/lib/universe/watch/new-source.ts"                     # a8 아직 없는 하위 폴더의 새 파일
  "scripts/test-cron-runner-overseas-universe.sh"            # b1 러너 회귀망(이번에 고친 것)
  "scripts/test-cron-runner-pmo-retry.sh"                    # b2 러너 회귀망(다른 잡)
  "scripts/test-cron-runner-newjob.sh"                       # b3 아직 없는 새 러너 시험(접두라 자동 포함)
  "src/lib/data/__tests__/us-data-db.test.ts"                # c1 정확 일치
  "src/lib/data/kis-fundamentals-snapshot.ts"                # c2 정확 일치 — ⑨의 1회 마감·이어받기
  "src/lib/data/__tests__/kis-fundamentals-snapshot.test.ts" # c3 정확 일치 — 그 회귀망
)

cat > "agent-vault/10-Flow/tasks/T-948-hooktest-t145-scoped.md" <<'EOF'
---
task_id: T-948
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/universe/, scripts/test-cron-runner-overseas-universe.sh, scripts/test-cron-runner-pmo-retry.sh, scripts/test-cron-runner-newjob.sh, src/lib/data/__tests__/us-data-db.test.ts, src/lib/data/kis-fundamentals-snapshot.ts, src/lib/data/__tests__/kis-fundamentals-snapshot.test.ts)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-948-hooktest-t145-scoped.md")

# ③ 용 — 이웃만 검토한 판정. 슬래시 없는 `src/lib/universe`(그 이름의 파일 하나) · 가짜 접두 디렉토리 ·
#    같은 이름의 파일 · 위치만 다른 경로 · 러너 본문 · 형제 시험(us-data-db 의 형제).
cat > "agent-vault/10-Flow/tasks/T-947-hooktest-t145-nearmiss.md" <<'EOF'
---
task_id: T-947
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/universe, src/lib/universex/, src/lib/universe-old/, src/lib/universe.ts, foo/src/lib/universe/, scripts/cron-runner.sh, src/lib/data/__tests__/sql-upsert-sim.ts, src/lib/data/us-data-db.ts, src/lib/data/us-edgar/)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-947-hooktest-t145-nearmiss.md")

# ④ 용 — 차용 방지: 이 묶음과 함께 바뀌는 다른 안전 경로만 검토한 판정.
cat > "agent-vault/10-Flow/tasks/T-946-hooktest-t145-borrowed.md" <<'EOF'
---
task_id: T-946
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/strategy/, src/app/api/cron/, scripts/cron-runner.sh, scripts/git-hooks/)**
EOF
FIXTURES+=("agent-vault/10-Flow/tasks/T-946-hooktest-t145-borrowed.md")

t145_i=0
for t145_p in "${T145_ITEMS[@]}"; do
  t145_i=$((t145_i + 1))
  stage_and_run 1 "(t145-a${t145_i}.1) ${t145_p} + 판정 미기록(T-993) → 차단" \
    "$(msg 'feat(T-993): 해외 자동 목록')" "$t145_p"
  stage_and_run_expect "$T075_OK" 0 "(t145-a${t145_i}.2) ${t145_p} + T-948(scope 포함) → 통과" \
    "$(msg 'feat(T-948): 해외 자동 목록')" "$t145_p"
  stage_and_run 1 "(t145-a${t145_i}.3) ${t145_p} + T-947(이웃 경로 scope) → 차단" \
    "$(msg 'feat(T-947): 해외 자동 목록')" "$t145_p"
  stage_and_run 1 "(t145-a${t145_i}.4) ${t145_p} + T-946(다른 안전 경로 scope) → 차단(차용 방지)" \
    "$(msg 'feat(T-946): 해외 자동 목록')" "$t145_p"
done

# 이웃은 감사 대상이 아니다 — task ID 없이도 통과해야 한다(하나라도 잘못 매치되면 exit 1).
# 겨냥 변이: 끝 `/` 삭제(universe.ts·universex/·universe-old/) · `^` 삭제(foo/·mockups/) · 위치 무시(src/universe/·lib/universe/) ·
# 대소문자(Universe) · 접두 ② 의 과도 매치(scripts/test-cron-runnerX·scripts/cron-runner-test-…·test-cron-runner-… 가 아닌 이름) ·
# ③ 의 과도 매치(형제 시험·확장자 다른 이름·디렉토리 통째).
stage_and_run 0 "(t145-n1) universe 이웃(.ts·universex/·-old/·foo/·mockups/·위치·대소문자) → 통과" \
  "$(msg 'chore: 이웃 정리')" \
  "src/lib/universe.ts" "src/lib/universex/rank.ts" "src/lib/universe-old/rank.ts" \
  "foo/src/lib/universe/rank.ts" "mockups/src/lib/universe/rank.ts" \
  "src/universe/rank.ts" "lib/universe/rank.ts" "src/lib/Universe/rank.ts"
stage_and_run 0 "(t145-n2) 러너 시험 접두 이웃(test-cron-runnerX·cron-runner-test-·다른 접두·하위 경로) → 통과" \
  "$(msg 'chore: 스크립트 정리')" \
  "scripts/test-cron-runnerX.sh" "scripts/cron-runner-test-a.sh" "scripts/test-cron-x-runner.sh" \
  "scripts/sub/test-cron-runner-a.sh" "test-cron-runner-a.sh"
stage_and_run 0 "(t145-n3) 정확 일치 3줄의 형제·비슷한 이름 → 통과(디렉토리를 통째로 넣지 않았다)" \
  "$(msg 'test: 자료 시험 정리')" \
  "src/lib/data/__tests__/sql-upsert-sim.ts" "src/lib/data/us-edgar/__tests__/sync-job.test.ts" \
  "src/lib/data/us-edgar/sync-job.ts" "src/lib/data/__tests__/us-data-db.test.tsx" \
  "src/lib/data/__tests__/us-data-db-extra.test.ts" "src/lib/data/kis-fundamentals-snapshot.tsx" \
  "src/lib/data/kis-fundamentals-snapshot-v2.ts" "src/lib/data/__tests__/kis-fundamentals-snapshot.test.tsx"

# 혼합 커밋 — 판정 합집합. T-948(이번 세 항목)·T-946(기존 안전 경로)이 각자 자기 몫만 덮는다.
T145_MIX=( "README.md" "src/lib/universe/refresh-config.ts" "src/lib/strategy/universe-overseas-static.ts" \
  "src/app/api/cron/overseas-universe-refresh/route.ts" "scripts/cron-runner.sh" "scripts/test-cron-runner-overseas-universe.sh" )
stage_and_run 1 "(t145-m1) [문서, universe, strategy, 라우트, 러너, 러너시험] 판정 미기록(T-993) → 차단" \
  "$(msg 'feat(T-993): 자동 목록 스위치')" "${T145_MIX[@]}"
stage_and_run 1 "(t145-m2) 같은 묶음 + T-948 만 → strategy·라우트·러너가 범위 밖, 차단" \
  "$(msg 'feat(T-948): 자동 목록 스위치')" "${T145_MIX[@]}"
stage_and_run 1 "(t145-m3) 같은 묶음 + T-946 만 → universe·러너시험이 범위 밖, 차단" \
  "$(msg 'feat(T-946): 자동 목록 스위치')" "${T145_MIX[@]}"
stage_and_run_expect "$T075_OK" 0 "(t145-m4) 같은 묶음 + T-948·T-946 합집합 → 통과" \
  "$(msg 'feat(T-948,T-946): 자동 목록 스위치')" "${T145_MIX[@]}"
stage_and_run_expect "$T075_OK" 0 "(t145-m5) 항목 14개 전부 + 문서, T-948 → 통과" \
  "$(msg 'feat(T-948): T-145 일괄')" "${T145_ITEMS[@]}" "docs/x.md"

echo ""
echo "[T-145 — 실 커밋 E2E: 일회용 임시 저장소에서 git 이 새 세 항목을 실제로 거르는가]"

cat > "$E2E_REPO/agent-vault/10-Flow/tasks/T-948-hooktest-t145-scoped.md" <<'EOF'
---
task_id: T-948
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/universe/, scripts/test-cron-runner-overseas-universe.sh, src/lib/data/__tests__/us-data-db.test.ts, src/lib/data/kis-fundamentals-snapshot.ts)**
EOF
cat > "$E2E_REPO/agent-vault/10-Flow/tasks/T-947-hooktest-t145-nearmiss.md" <<'EOF'
---
task_id: T-947
---
## Reviewer 기록
- [09:00] **최종 판정: PASS (scope: src/lib/universe, src/lib/universex/, scripts/cron-runner.sh, src/lib/data/us-data-db.ts)**
EOF
mkdir -p "$E2E_REPO/src/lib/universe/__tests__" "$E2E_REPO/src/lib/universex" "$E2E_REPO/src/lib/data/__tests__"

printf 'v1\n' > "$E2E_REPO/src/lib/universe/refresh-config.ts"
e2e_git add src/lib/universe/refresh-config.ts
e2e_commit "(t145-g1) 실 커밋: universe/refresh-config.ts(신규) + task ID 없음 → 차단" block "커밋 차단" \
  'feat: 스위치 판독'
e2e_commit "(t145-g2) 실 커밋: 같은 변경 + T-947(이웃 경로 scope) → 차단" block "커밋 차단" \
  'feat(T-947): 스위치 판독'
e2e_commit "(t145-g3) 실 커밋: 같은 변경 + T-948(scope 포함) → 통과·HEAD 이동" commit "$T075_OK" \
  'feat(T-948): 스위치 판독'

printf 'v1\n' > "$E2E_REPO/scripts/test-cron-runner-overseas-universe.sh"
e2e_git add scripts/test-cron-runner-overseas-universe.sh
e2e_commit "(t145-g4) 실 커밋: 러너 시험(접두 항목) + task ID 없음 → 차단" block "커밋 차단" \
  'test: 러너 시험'
e2e_commit "(t145-g5) 실 커밋: 같은 변경 + T-948 → 통과·HEAD 이동" commit "$T075_OK" \
  'test(T-948): 러너 시험'

printf 'v1\n' > "$E2E_REPO/src/lib/data/__tests__/us-data-db.test.ts"
e2e_git add src/lib/data/__tests__/us-data-db.test.ts
e2e_commit "(t145-g6) 실 커밋: us-data-db.test.ts(정확 일치) + task ID 없음 → 차단" block "커밋 차단" \
  'test: 대상 집합 시험'
e2e_commit "(t145-g7) 실 커밋: 같은 변경 + T-948 → 통과·HEAD 이동" commit "$T075_OK" \
  'test(T-948): 대상 집합 시험'

printf 'v1\n' > "$E2E_REPO/src/lib/data/kis-fundamentals-snapshot.ts"
e2e_git add src/lib/data/kis-fundamentals-snapshot.ts
e2e_commit "(t145-g8) 실 커밋: kis-fundamentals-snapshot.ts(1회 마감) + task ID 없음 → 차단" block "커밋 차단" \
  'perf: 수집 마감'
e2e_commit "(t145-g9) 실 커밋: 같은 변경 + T-948 → 통과·HEAD 이동" commit "$T075_OK" \
  'perf(T-948): 수집 마감'

printf 'x\n' > "$E2E_REPO/src/lib/universex/a.ts"
printf 'x\n' > "$E2E_REPO/src/lib/universe.ts"
printf 'x\n' > "$E2E_REPO/src/lib/data/__tests__/sql-upsert-sim.ts"
printf 'x\n' > "$E2E_REPO/scripts/test-cron-runnerX.sh"
e2e_git add src/lib/universex/a.ts src/lib/universe.ts src/lib/data/__tests__/sql-upsert-sim.ts scripts/test-cron-runnerX.sh
e2e_commit "(t145-g10) 실 커밋: 이웃 4개(universex/·universe.ts·형제 대역·test-cron-runnerX) → 통과" commit "" \
  'chore: 이웃 정리'

echo ""
echo "[T-165 — 설치 설정 범위: 독립 저장소와 linked worktree만 사용]"

installed_hook_blocked() {
  [ "$1" -ne 0 ] && [ "$2" = "$3" ] || return 1
  case "$4" in *'🛑 커밋 차단 — 안전 관련 코드 변경에는 Reviewer 독립감사 기록이 필요합니다.'*) return 0 ;; *) return 1 ;; esac
}
t165_check() {
  local label="$1"; shift
  if "$@"; then
    printf '  ✅ %s\n' "$label"; PASS_N=$((PASS_N + 1))
  else
    printf '  ❌ %s\n' "$label"; FAIL_N=$((FAIL_N + 1))
  fi
}
t165_env() {
  env -u GIT_DIR -u GIT_COMMON_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE \
    -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE \
    -u GIT_CONFIG -u GIT_CONFIG_COUNT -u GIT_CONFIG_PARAMETERS -u GIT_TEMPLATE_DIR \
    GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL="$T165_GLOBAL" XDG_DATA_HOME="$WORK/t165-local-data" "$@"
}
t165_git() {
  local repo="$1"; shift
  t165_env "$T165_REAL_GIT" -C "$repo" "$@"
}
t165_install() {
  (cd "$1" && t165_env bash "$ROOT/scripts/install-git-hooks.sh")
}
t165_commit() {
  local repo="$1" label="$2" expected="$3" token="$4" message="$5"
  local before after out rc ok=1
  before="$(t165_git "$repo" rev-parse HEAD)"
  out="$(t165_git "$repo" commit -m "$message" 2>&1)"; rc=$?
  after="$(t165_git "$repo" rev-parse HEAD)"
  case "$expected" in
    block) installed_hook_blocked "$rc" "$before" "$after" "$out" || ok=0 ;;
    commit) [ "$rc" -eq 0 ] && [ "$before" != "$after" ] || ok=0 ;;
  esac
  case "$out" in *"$token"*) ;; *) ok=0 ;; esac
  t165_check "$label" [ "$ok" -eq 1 ]
  if [ "$ok" -eq 0 ] || [ "$VERBOSE" -eq 1 ]; then printf '%s\n' "$out" | sed 's/^/       │ /'; fi
}
run_t165_installer_tests() {
  local T165_REAL_GIT T165_GLOBAL main first peer first_dir peer_dir shared
  local out rc shared_before peer_before first_before target before_hash selected_before state origin origin_before origin_after
  T165_REAL_GIT="$(command -v git)"
  T165_GLOBAL="$WORK/t165-global-config"
  : > "$T165_GLOBAL"
  main="$WORK/t165-main"; first="$WORK/t165-first"; peer="$WORK/t165-peer"
  mkdir -p "$main/scripts/git-hooks" "$main/src/lib/safety" "$main/agent-vault/10-Flow/tasks"
  cp "$ROOT/$HOOK" "$main/scripts/git-hooks/commit-msg" || { t165_check '(t165-setup) 훅 복사' false; return; }
  printf 'synthetic seed\n' > "$main/README.md"
  printf 'synthetic safety seed\n' > "$main/src/lib/safety/dry-run.ts"
  cat > "$main/agent-vault/10-Flow/tasks/T-995-hooktest-t165-valid.md" <<'EOF'
## Reviewer
- **최종 판정: PASS (scope: src/lib/safety/)**
EOF
  cat > "$main/agent-vault/10-Flow/tasks/T-993-hooktest-t165-wrong-scope.md" <<'EOF'
## Reviewer
- **최종 판정: PASS (scope: docs/)**
EOF
  t165_git "$main" init -q || { t165_check '(t165-setup) git init' false; return; }
  t165_git "$main" config --local user.name 'Synthetic hook fixture'
  t165_git "$main" config --local user.email 'hook-fixture@example.invalid'
  t165_git "$main" config --local commit.gpgsign false
  t165_git "$main" add .
  t165_git "$main" commit -qm 'synthetic seed before installing hooks' || { t165_check '(t165-setup) 초기 fixture' false; return; }

  out="$(t165_install "$main" 2>&1)"; rc=$?
  target="$(t165_git "$main" config --local --get core.hooksPath)"
  t165_check '(t165-a1) 일반 clone은 기존 --local 설치 유지' [ "$rc:$target" = '0:scripts/git-hooks' ]
  t165_check '(t165-a2) legacy clone에 worktree 설정을 만들지 않음' [ ! -e "$main/.git/config.worktree" ]

  t165_git "$main" config --local extensions.worktreeConfig true
  t165_git "$main" config --local core.hooksPath '/linux-sentinel/unchanged-hooks'
  t165_git "$main" worktree add -qb t165-first "$first" || { t165_check '(t165-setup) 첫 worktree' false; return; }
  t165_git "$main" worktree add -qb t165-peer "$peer" || { t165_check '(t165-setup) peer worktree' false; return; }
  t165_git "$first" config --worktree t165.owner first
  t165_git "$peer" config --worktree t165.owner peer
  t165_git "$peer" config --worktree core.hooksPath '/peer-sentinel/unchanged-hooks'
  first_dir="$(t165_git "$first" rev-parse --git-dir)"
  peer_dir="$(t165_git "$peer" rev-parse --git-dir)"
  shared="$main/.git/config"
  shared_before="$(cksum < "$shared")"; peer_before="$(cksum < "$peer_dir/config.worktree")"
  out="$(t165_install "$first" 2>&1)"; rc=$?
  target="$(t165_git "$first" config --worktree --get core.hooksPath)"
  t165_check '(t165-b1) enabled linked worktree는 --worktree에만 설치' [ "$rc:$target" = '0:scripts/git-hooks' ]
  t165_check '(t165-b2) 공유 Linux hooksPath/config bytes 보존' [ "$(cksum < "$shared")" = "$shared_before" ]
  t165_check '(t165-b3) peer worktree 전체 config bytes 보존' [ "$(cksum < "$peer_dir/config.worktree")" = "$peer_before" ]
  t165_check '(t165-b4) 해당 worktree의 다른 설정 보존' [ "$(t165_git "$first" config --worktree --get t165.owner)" = first ]
  t165_check '(t165-b5) 실제 읽는 hooksPath가 해당 worktree 대상' [ "$(t165_git "$first" config --get core.hooksPath)" = scripts/git-hooks ]
  first_before="$(cksum < "$first_dir/config.worktree")"
  out="$(t165_install "$first" 2>&1)"; rc=$?
  t165_check '(t165-b6) 재설치 멱등: 선택/공유/peer config bytes 불변' \
    [ "$rc:$(cksum < "$first_dir/config.worktree"):$(cksum < "$shared"):$(cksum < "$peer_dir/config.worktree")" = "0:$first_before:$shared_before:$peer_before" ]
  out="$(t165_install "$main" 2>&1)"; rc=$?
  t165_check '(t165-b7) enabled main도 --worktree 사용·공유/peer/linked 설정 보존' \
    [ "$rc:$(t165_git "$main" config --worktree --get core.hooksPath):$(cksum < "$shared"):$(cksum < "$first_dir/config.worktree"):$(cksum < "$peer_dir/config.worktree")" = "0:scripts/git-hooks:$shared_before:$first_before:$peer_before" ]

  t165_git "$main" config --local extensions.worktreeConfig false
  chmod -x "$first/scripts/git-hooks/commit-msg"
  shared_before="$(cksum < "$shared")"; first_before="$(cksum < "$first_dir/config.worktree")"
  out="$(t165_install "$first" 2>&1)"; rc=$?
  t165_check '(t165-c1) disabled linked worktree는 실패로 종료' [ "$rc" -ne 0 ]
  t165_check '(t165-c2) disabled linked: 설정·실행권한을 쓰기 전에 차단' \
    [ "$([ -x "$first/scripts/git-hooks/commit-msg" ] && printf executable):$(cksum < "$shared"):$(cksum < "$first_dir/config.worktree"):$(cksum < "$peer_dir/config.worktree")" = ":$shared_before:$first_before:$peer_before" ]
  case "$out" in *'extensions.worktreeConfig'*) t165_check '(t165-c3) 독립 설정 준비 안내' true ;; *) t165_check '(t165-c3) 독립 설정 준비 안내' false ;; esac
  chmod +x "$first/scripts/git-hooks/commit-msg"
  chmod -x "$main/scripts/git-hooks/commit-msg"
  out="$(t165_install "$main" 2>&1)"; rc=$?
  t165_check '(t165-c4) 확장 OFF인 main+peers도 공유 설정·권한 쓰기 전 거절' \
    [ "$rc:$([ -x "$main/scripts/git-hooks/commit-msg" ] && printf executable):$(cksum < "$shared")" = "1::$shared_before" ]
  chmod +x "$main/scripts/git-hooks/commit-msg"
  for state in absent false; do
    if [ "$state" = absent ]; then t165_git "$main" config --local --unset extensions.worktreeConfig
    else t165_git "$main" config --local extensions.worktreeConfig false; fi
    "$T165_REAL_GIT" config --file "$T165_GLOBAL" extensions.worktreeConfig true
    shared_before="$(cksum < "$shared")"
    chmod -x "$first/scripts/git-hooks/commit-msg"
    out="$(t165_install "$first" 2>&1)"; rc=$?
    t165_check "(t165-c5-$state) global true만으로 공통 설정/권한을 쓰지 않음" \
      [ "$rc:$([ -x "$first/scripts/git-hooks/commit-msg" ] && printf executable):$(cksum < "$shared")" = "1::$shared_before" ]
    "$T165_REAL_GIT" config --file "$T165_GLOBAL" --unset extensions.worktreeConfig
    out="$(cd "$first" && t165_env env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=extensions.worktreeConfig \
      GIT_CONFIG_VALUE_0=true bash "$ROOT/scripts/install-git-hooks.sh" 2>&1)"; rc=$?
    t165_check "(t165-c6-$state) command true만으로 공통 설정/권한을 쓰지 않음" \
      [ "$rc:$([ -x "$first/scripts/git-hooks/commit-msg" ] && printf executable):$(cksum < "$shared")" = "1::$shared_before" ]
    chmod +x "$first/scripts/git-hooks/commit-msg"
  done
  t165_git "$main" config --local extensions.worktreeConfig true
  chmod -x "$first/scripts/git-hooks/commit-msg"
  shared_before="$(cksum < "$shared")"
  out="$(cd "$first" && t165_env env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=extensions.worktreeConfig \
    GIT_CONFIG_VALUE_0=false bash "$ROOT/scripts/install-git-hooks.sh" 2>&1)"; rc=$?
  t165_check '(t165-c7) local true와 command false 충돌은 쓰기 전 거절' \
    [ "$rc:$([ -x "$first/scripts/git-hooks/commit-msg" ] && printf executable):$(cksum < "$shared")" = "1::$shared_before" ]
  chmod +x "$first/scripts/git-hooks/commit-msg"

  mv "$first_dir/config.worktree" "$first_dir/config.worktree.saved"
  ln -s "$peer_dir/config.worktree" "$first_dir/config.worktree"
  out="$(t165_install "$first" 2>&1)"; rc=$?
  t165_check '(t165-c8) 타 worktree config를 가리키는 링크 거절·대상 bytes 보존' \
    [ "$rc:$(cksum < "$shared"):$(cksum < "$peer_dir/config.worktree")" = "1:$shared_before:$peer_before" ]
  rm "$first_dir/config.worktree"
  mv "$first_dir/config.worktree.saved" "$first_dir/config.worktree"

  mkdir -p "$WORK/t165-bin"
  cat > "$WORK/t165-bin/git" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = config ] && [ "${2:-}" = --file ] && [ "${3:-}" = "$T165_FAIL_FILE" ] && [ "${4:-}" = core.hooksPath ] && [ "$#" -eq 5 ]; then
  exit 91
fi
exec "$T165_REAL_GIT" "$@"
EOF
  chmod +x "$WORK/t165-bin/git"
  t165_git "$first" config --worktree core.hooksPath 'prior-sentinel/hooks'
  selected_before="$(cksum < "$first_dir/config.worktree")"; shared_before="$(cksum < "$shared")"
  out="$(cd "$first" && t165_env env PATH="$WORK/t165-bin:$PATH" T165_REAL_GIT="$T165_REAL_GIT" \
    T165_FAIL_FILE="$first_dir/config.worktree" bash "$ROOT/scripts/install-git-hooks.sh" 2>&1)"; rc=$?
  t165_check '(t165-d1) 선택 scope 쓰기 실패를 성공으로 숨기지 않음' [ "$rc" -ne 0 ]
  t165_check '(t165-d2) 쓰기 실패 시 선택/공유/peer 설정 보존' \
    [ "$(cksum < "$first_dir/config.worktree"):$(cksum < "$shared"):$(cksum < "$peer_dir/config.worktree")" = "$selected_before:$shared_before:$peer_before" ]
  t165_git "$first" config --worktree core.hooksPath scripts/git-hooks
  selected_before="$(cksum < "$first_dir/config.worktree")"
  out="$(cd "$first" && t165_env env \
    GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/command-shadow/hooks \
    bash "$ROOT/scripts/install-git-hooks.sh" 2>&1)"; rc=$?
  case "$out" in *'실효값이 설치 대상과 다릅니다'*) before_hash=1 ;; *) before_hash=0 ;; esac
  t165_check '(t165-e1) 명령 우선순위의 다른 실효 hooksPath는 검증 실패' [ "$rc:$before_hash" = '1:1' ]
  t165_check '(t165-e2) shadow 거절 시 선택/공유/peer 설정 보존' \
    [ "$(cksum < "$first_dir/config.worktree"):$(cksum < "$shared"):$(cksum < "$peer_dir/config.worktree")" = "$selected_before:$shared_before:$peer_before" ]

  cat > "$WORK/t165-bin/git" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = config ] && [ "${2:-}" = --file ] && [ "${3:-}" = "$T165_WRITE_FILE" ] && [ "${4:-}" = core.hooksPath ] && [ "$#" -eq 5 ]; then
  "$T165_REAL_GIT" config --file "$T165_COMMON_FILE" extensions.worktreeConfig false || exit 92
fi
exec "$T165_REAL_GIT" "$@"
EOF
  chmod +x "$WORK/t165-bin/git"
  t165_git "$first" config --worktree core.hooksPath 'race-sentinel/hooks'
  out="$(cd "$first" && t165_env env PATH="$WORK/t165-bin:$PATH" T165_REAL_GIT="$T165_REAL_GIT" \
    T165_WRITE_FILE="$first_dir/config.worktree" T165_COMMON_FILE="$shared" \
    bash "$ROOT/scripts/install-git-hooks.sh" 2>&1)"; rc=$?
  t165_check '(t165-e3) 검사 후 확장 OFF 경합: 공통 hooksPath 쓰기 없이 실패' \
    [ "$rc:$(t165_git "$main" config --local --get core.hooksPath):$(cksum < "$peer_dir/config.worktree")" = "1:/linux-sentinel/unchanged-hooks:$peer_before" ]
  t165_git "$main" config --local extensions.worktreeConfig true
  t165_check '(t165-e4) 확장 OFF 경합에서도 쓰기 대상은 자기 config.worktree' \
    [ "$(t165_git "$first" config --worktree --get core.hooksPath)" = scripts/git-hooks ]

  printf 'docs change\n' >> "$first/README.md"; t165_git "$first" add README.md
  t165_commit "$first" '(t165-f1) 설치된 훅: 문서 커밋 허용' commit '' 'docs: synthetic installed hook'
  printf 'safety change\n' >> "$first/src/lib/safety/dry-run.ts"; t165_git "$first" add src/lib/safety/dry-run.ts
  t165_commit "$first" '(t165-f2) 설치된 훅: 무task 안전 변경 차단·HEAD 보존' block '커밋 차단' 'fix: synthetic safety without task'
  t165_commit "$first" '(t165-f3) 설치된 훅: 다른 scope 차단·HEAD 보존' block '커밋 차단' 'fix(T-993): synthetic wrong scope'
  t165_commit "$first" '(t165-f4) 설치된 훅: 유효 synthetic scope만 허용' commit "$T075_OK" 'fix(T-995): synthetic valid scope'

  origin="$WORK/t165-poison-origin"
  mkdir -p "$origin"
  t165_git "$origin" init -q
  t165_git "$origin" config --local t165.sentinel unchanged
  printf 'origin\n' > "$origin/sentinel"
  t165_git "$origin" add sentinel
  origin_before="$(cksum < "$origin/.git/config"):$(cksum < "$origin/.git/index"):$(cksum < "$origin/.git/HEAD"):$(find "$origin/.git/objects" -type f -exec cksum {} + | LC_ALL=C sort | cksum)"
  out="$(
    export GIT_DIR="$origin/.git" GIT_COMMON_DIR="$origin/.git" GIT_WORK_TREE="$origin" GIT_INDEX_FILE="$origin/.git/index"
    export GIT_OBJECT_DIRECTORY="$origin/.git/objects" GIT_ALTERNATE_OBJECT_DIRECTORIES="$origin/.git/objects"
    export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/poison/hooks
    export GIT_CONFIG_PARAMETERS="'core.hooksPath'='/poison/hooks'" GIT_TEMPLATE_DIR="$origin/.git/hooks"
    t165_git "$first" config --worktree t165.envIsolation fixture-only
    t165_install "$first"
  )"; rc=$?
  origin_after="$(cksum < "$origin/.git/config"):$(cksum < "$origin/.git/index"):$(cksum < "$origin/.git/HEAD"):$(find "$origin/.git/objects" -type f -exec cksum {} + | LC_ALL=C sort | cksum)"
  t165_check '(t165-g1) fixture helper는 Git 위치/config/template 환경을 제거' \
    [ "$rc:$(t165_git "$first" config --worktree --get t165.envIsolation):$origin_after" = "0:fixture-only:$origin_before" ]
  t165_git "$first" config --worktree --unset t165.envIsolation
  chmod -x "$first/scripts/git-hooks/commit-msg"
  selected_before="$(cksum < "$first_dir/config.worktree")"
  out="$(cd "$first" && t165_env env GIT_DIR="$origin/.git" bash "$ROOT/scripts/install-git-hooks.sh" 2>&1)"; rc=$?
  t165_check '(t165-g2) installer 자체도 별도 Git 대상 환경을 쓰기 전 거절' \
    [ "$rc:$([ -x "$first/scripts/git-hooks/commit-msg" ] && printf executable):$(cksum < "$first_dir/config.worktree")" = "1::$selected_before" ]
  printf '[core]\n\thooksPath = scripts/git-hooks\n' > "$WORK/t165-fake-config"
  out="$(cd "$first" && t165_env env GIT_CONFIG="$WORK/t165-fake-config" bash "$ROOT/scripts/install-git-hooks.sh" 2>&1)"; rc=$?
  t165_check '(t165-g3) config 전용 가짜 실효값 환경은 쓰기 전 거절' \
    [ "$rc:$([ -x "$first/scripts/git-hooks/commit-msg" ] && printf executable):$(cksum < "$first_dir/config.worktree")" = "1::$selected_before" ]
  chmod +x "$first/scripts/git-hooks/commit-msg"

  if installed_hook_blocked 128 same-head same-head 'error: gpg failed to sign the data'; then
    t165_check '(t165-h1) 서명 실패를 commit-msg 차단으로 오인하지 않음' false
  else t165_check '(t165-h1) 서명 실패를 commit-msg 차단으로 오인하지 않음' true; fi
  if installed_hook_blocked 128 same-head same-head 'fatal: unable to auto-detect email address'; then
    t165_check '(t165-h2) 신원 실패를 commit-msg 차단으로 오인하지 않음' false
  else t165_check '(t165-h2) 신원 실패를 commit-msg 차단으로 오인하지 않음' true; fi
  if installed_hook_blocked 0 same-head same-head '🛑 커밋 차단 — 안전 관련 코드 변경에는 Reviewer 독립감사 기록이 필요합니다.'; then
    t165_check '(t165-h3) 차단 문구만 있고 성공 exit이면 실패' false
  else t165_check '(t165-h3) 차단 문구만 있고 성공 exit이면 실패' true; fi
}
run_t165_installer_tests

echo ""
echo "─────────────────────────────────────────────────────────────────────────"
printf '결과: %d 통과 / %d 실패\n' "$PASS_N" "$FAIL_N"
echo ""
if [ "$FAIL_N" -gt 0 ]; then
  echo "❌ 실패 케이스가 있습니다."
  exit 1
fi
echo "✅ 훅 스크립트 로직은 전부 기대대로 동작합니다."
remove_fixtures

# ---------------------------------------------------------------------------
# [E2E] git 이 실제로 이 훅을 호출하는가?
#
# ⚠ 가장 중요한 검증. git 은 "실행 불가한 훅"을 경고 한 줄만 남기고 조용히 무시하고
#   커밋을 진행한다. 이 저장소의 주 경로는 NFS noexec 마운트라 chmod 가 무효여서
#   설치를 잘못하면 훅 로직이 아무리 완벽해도 통째로 fail-open 된다.
#   → 실제 `git commit` 을 시도해 "차단되는지"만 확인한다.
#     차단이 정상 동작이므로 성공 시 커밋은 애초에 생성되지 않는다(히스토리 무오염).
# ---------------------------------------------------------------------------
echo ""
echo "[E2E] git 이 실제로 훅을 호출하는지 — 실 커밋 시도(차단 기대)"
echo "─────────────────────────────────────────────────────────────────────────"

HOOKS_PATH="$(env -u GIT_CONFIG git config --get core.hooksPath 2>/dev/null || true)"
if [ -z "$HOOKS_PATH" ]; then
  echo "  ⚠ core.hooksPath 가 설정돼 있지 않습니다 — 훅 미설치 상태입니다."
  echo "    bash scripts/install-git-hooks.sh 를 먼저 실행하세요."
  exit 1
fi
echo "  core.hooksPath = $HOOKS_PATH"
case "$HOOKS_PATH" in
  /*) HP_ABS="$HOOKS_PATH" ;;
  *)  HP_ABS="$ROOT/$HOOKS_PATH" ;;
esac
if [ -x "$HP_ABS/commit-msg" ]; then
  echo "  ✅ $HP_ABS/commit-msg 실행 가능"
else
  echo "  ❌ $HP_ABS/commit-msg 가 실행 불가 — git 이 조용히 무시합니다 (fail-open!)"
  exit 1
fi

if ! git diff --cached --quiet 2>/dev/null; then
  echo "  ⚠ 이미 stage 된 변경이 있어 E2E 커밋 시도를 건너뜁니다 (index 를 건드리지 않기 위함)."
  echo "     stage 를 비운 뒤 다시 실행하세요."
  exit 0
fi

HEAD_BEFORE="$(git rev-parse HEAD)"
E2E_BLOB="$(printf 'e2e hook test\n' | git hash-object -w --stdin)"
git update-index --add --cacheinfo "100644,$E2E_BLOB,$SAFETY_FILE" || { echo "  ❌ index 준비 실패"; exit 1; }

E2E_OUT="$(git commit -m 'hook e2e test — 차단되어야 정상 (task ID 없음)' 2>&1)"
E2E_RC=$?
HEAD_AFTER="$(git rev-parse HEAD)"

# index 원복 (워킹트리는 처음부터 건드리지 않음)
git read-tree HEAD >/dev/null 2>&1

if [ "$HEAD_BEFORE" != "$HEAD_AFTER" ]; then
  echo "  ❌ 커밋이 생성되었습니다 — 훅이 동작하지 않습니다 (fail-open!)"
  git reset --soft "$HEAD_BEFORE" && git read-tree HEAD >/dev/null 2>&1
  echo "     → git reset --soft 로 되돌렸습니다. HEAD=$(git rev-parse --short HEAD)"
  printf '%s\n' "$E2E_OUT" | sed 's/^/       │ /'
  exit 1
fi

if [ "$E2E_RC" -eq 0 ]; then
  echo "  ❌ git commit 이 성공 코드로 끝났습니다 — 예상 밖입니다."
  exit 1
fi

if ! installed_hook_blocked "$E2E_RC" "$HEAD_BEFORE" "$HEAD_AFTER" "$E2E_OUT"; then
  echo "  ❌ git commit 은 실패했지만 commit-msg 차단 근거가 없습니다 — 서명/신원/다른 훅 오류를 확인하세요."
  printf '%s\n' "$E2E_OUT" | sed 's/^/       │ /'
  exit 1
fi

echo "  ✅ 실제 git commit 이 훅에 의해 차단됨 (exit $E2E_RC, HEAD 변동 없음)"
if [ "$VERBOSE" -eq 1 ]; then
  printf '%s\n' "$E2E_OUT" | sed 's/^/       │ /'
fi

echo ""
echo "워킹트리 영향 확인 (T-977~998·T-956~969 테스트 fixture 가 남아 있지 않아야 함):"
git status --short | sed 's/^/  /'
echo ""
echo "✅ 전체 검증 통과."
