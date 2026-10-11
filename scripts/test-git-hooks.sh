#!/usr/bin/env bash
#
# test-git-hooks.sh — commit-msg 훅 동작 검증 (task: T-025)
#
#   bash scripts/test-git-hooks.sh          # 요약만
#   bash scripts/test-git-hooks.sh -v       # 훅 출력까지 전부 표시
#
# ⚠ 이 스크립트는 실제 커밋을 만들지 않고, 워킹트리와 실제 index 도 건드리지 않는다.
#   GIT_INDEX_FILE 로 임시 index 를 만들어 거기에만 가짜 blob 을 stage 한 뒤
#   훅을 직접 호출한다. (임시 blob 은 dangling object 로 남고 `git gc` 로 정리된다)
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

  if [ "$rc" -eq "$expected" ]; then
    printf '  ✅ %-62s (exit %d, 기대 %d)\n' "$label" "$rc" "$expected"
    PASS_N=$((PASS_N + 1))
  else
    printf '  ❌ %-62s (exit %d, 기대 %d)\n' "$label" "$rc" "$expected"
    FAIL_N=$((FAIL_N + 1))
    VERBOSE=1
  fi
  if [ "$VERBOSE" -eq 1 ]; then
    printf '%s\n' "$out" | sed 's/^/       │ /'
    echo ""
  fi
}

msg() { printf '%s\n' "$1" > "$WORK/msg"; printf '%s' "$WORK/msg"; }

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
echo "워킹트리 영향 확인 (T-989~998 테스트 fixture 가 남아 있지 않아야 함):"
git status --short | sed 's/^/  /'
echo ""
echo "✅ 전체 검증 통과."
