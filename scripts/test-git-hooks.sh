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
#        · 판정 fixture(agent-vault/10-Flow/tasks/T-979~998-hooktest-*.md)를 **실제 작업 트리에** 잠시
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
#
#   ⇒ **다른 세션이 stage 중이거나 커밋 직전일 때는 실행하지 말 것.** 실행 전에 index 가 비었는지 확인:
#        git diff --cached --quiet && echo "stage 비어 있음 — 실행 가능" || git diff --cached --name-only
#      파일 목록이 나오면 누군가 stage 중이다 — 그 세션과 조율한 뒤 실행한다.
#
set -u

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
stage_and_run 0 "(z4) attempt/login/signup gate·request-limits → 통과(의도적 제외)" \
  "$(msg 'chore: 로그인 시도제한 임계값 조정')" \
  "src/lib/auth/attempt-gate.ts" "src/lib/auth/login-gate.ts" \
  "src/lib/auth/signup-gate.ts" "src/lib/auth/request-limits.ts"

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

# 인증 계열이지만 이번 승인(T-090) 범위 밖인 경로 — T-090 이 auth/ 밖으로 넓어지지 않았음을 고정한다(과도차단 회귀 방지).
# 별개 사용자 결정 대기 항목이라 "영구 제외"가 아니다: 나중에 사용자가 이 경로를 목록에 넣기로 하면 이 시나리오를 함께 고친다.
stage_and_run 0 "(t090-x) 범위 밖: profile/password·middleware-public-paths 시험 → 통과" \
  "$(msg 'chore: 비밀번호 변경·공개경로 시험 수정')" \
  "src/app/api/profile/password/route.ts" "src/__tests__/middleware-public-paths.test.ts"

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

HOOKS_PATH="$(git config --local --get core.hooksPath 2>/dev/null || true)"
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

echo "  ✅ 실제 git commit 이 훅에 의해 차단됨 (exit $E2E_RC, HEAD 변동 없음)"
if [ "$VERBOSE" -eq 1 ]; then
  printf '%s\n' "$E2E_OUT" | sed 's/^/       │ /'
fi

echo ""
echo "워킹트리 영향 확인 (T-981~998 테스트 fixture 가 남아 있지 않아야 함):"
git status --short | sed 's/^/  /'
echo ""
echo "✅ 전체 검증 통과."
