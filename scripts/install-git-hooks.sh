#!/usr/bin/env bash
#
# install-git-hooks.sh — 이 저장소의 버전관리되는 git 훅을 활성화한다 (task: T-025)
#
#   bash scripts/install-git-hooks.sh
#
# `.git/hooks/` 는 clone 마다 로컬이라 저장소에 담아 배포할 수 없다.
# 대신 훅 스크립트를 `scripts/git-hooks/` 에 버전관리하고 `core.hooksPath` 로 가리킨다.
# 신규 clone·새 머신·새 워크트리에서는 이 스크립트를 한 번 실행해야 훅이 동작한다.
#
# ⚠ noexec 마운트 대응 (이 워크스페이스에서 실측된 함정):
#   이 저장소의 주 편집 경로(/home/.../NFS/...)는 NFS `noexec` 마운트라
#   chmod +x 를 해도 `test -x` 가 false 가 되고, **git 은 실행 불가한 훅을
#   조용히 무시하고 커밋을 그대로 진행한다**(경고 힌트 한 줄만 출력).
#   즉 훅을 저장소 안에 두고 core.hooksPath 만 지정하면 안전장치가 통째로 fail-open 된다.
#   → 이 경우 실행 가능한 로컬 디스크에 shim(래퍼) 훅을 만들어 그쪽을 가리키고,
#     shim 이 NFS 상의 원본 스크립트를 `bash <원본>` 으로 읽어 실행한다(읽기는 허용됨).
#   설치 마지막에 실제로 실행 가능한 상태인지 검증하고, 아니면 실패로 종료한다.
#
set -u

REPO_HOOKS_DIR="scripts/git-hooks"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$ROOT" ]; then
  echo "❌ git 저장소 안에서 실행하세요." >&2
  exit 1
fi
cd "$ROOT" || exit 1

if [ ! -d "$REPO_HOOKS_DIR" ]; then
  echo "❌ $REPO_HOOKS_DIR 디렉토리가 없습니다. 저장소가 최신인지 확인하세요." >&2
  exit 1
fi

hook_names() {
  local h
  for h in "$REPO_HOOKS_DIR"/*; do
    [ -f "$h" ] || continue
    case "$(basename "$h")" in
      *.md|*.txt|*.sample|.*) continue ;;
    esac
    basename "$h"
  done
}

NAMES="$(hook_names)"
if [ -z "$NAMES" ]; then
  echo "❌ $REPO_HOOKS_DIR 에 훅 스크립트가 없습니다." >&2
  exit 1
fi

# 1) 실행 권한 보정 (일반 파일시스템에서는 이걸로 충분)
for n in $NAMES; do
  [ -x "$REPO_HOOKS_DIR/$n" ] || chmod +x "$REPO_HOOKS_DIR/$n" 2>/dev/null
done

# 2) 저장소 경로에서 훅이 실제로 실행 가능한지 판정
EXEC_OK=1
for n in $NAMES; do
  [ -x "$REPO_HOOKS_DIR/$n" ] || EXEC_OK=0
done

# 3) 기존 .git/hooks 에 활성 훅이 있으면 경고 (core.hooksPath 설정 시 무시된다)
GIT_COMMON="$(git rev-parse --git-common-dir 2>/dev/null || echo .git)"
if [ -d "$GIT_COMMON/hooks" ]; then
  LEGACY="$(find "$GIT_COMMON/hooks" -maxdepth 1 -type f ! -name '*.sample' 2>/dev/null)"
  if [ -n "$LEGACY" ]; then
    echo "⚠ $GIT_COMMON/hooks 에 아래 훅이 있습니다 — core.hooksPath 설정 후에는 실행되지 않습니다:" >&2
    printf '%s\n' "$LEGACY" | sed 's/^/    /' >&2
    echo "   필요하면 $REPO_HOOKS_DIR 로 옮기세요." >&2
    echo "" >&2
  fi
fi

# 4) 설치 대상 경로 결정
if [ "$EXEC_OK" -eq 1 ]; then
  TARGET="$REPO_HOOKS_DIR"          # 상대경로 — clone 위치가 달라도 그대로 유효
  MODE="direct"
else
  # noexec 마운트 → 로컬 실행가능 디스크에 shim 생성
  BASE="${XDG_DATA_HOME:-$HOME/.local/share}/stockinvest-git-hooks"
  KEY="$(printf '%s' "$ROOT" | cksum | tr -d ' ' | cut -c1-16)"
  TARGET="$BASE/$KEY"
  MODE="shim"

  if ! mkdir -p "$TARGET" 2>/dev/null; then
    echo "❌ shim 디렉토리를 만들 수 없습니다: $TARGET" >&2
    exit 1
  fi

  printf '%s\n' "$ROOT" > "$TARGET/.repo-path"

  for n in $NAMES; do
    cat > "$TARGET/$n" <<EOF
#!/usr/bin/env bash
# 자동 생성 shim — 직접 편집하지 마세요.
# 원본(버전관리 대상): $ROOT/$REPO_HOOKS_DIR/$n
# 저장소가 noexec 마운트라 git 이 원본을 직접 실행할 수 없어 이 래퍼를 경유합니다.
SRC="$ROOT/$REPO_HOOKS_DIR/$n"
if [ ! -f "\$SRC" ]; then
  echo "❌ [$n] 훅 원본을 찾을 수 없습니다: \$SRC" >&2
  echo "   저장소를 옮겼다면 'bash scripts/install-git-hooks.sh' 를 다시 실행하세요." >&2
  exit 1
fi
exec bash "\$SRC" "\$@"
EOF
    chmod +x "$TARGET/$n" || { echo "❌ shim 실행권한 부여 실패: $TARGET/$n" >&2; exit 1; }
  done

  # 낡은 shim 제거 — 저장소에서 삭제·개명된 훅의 shim 이 남아 있으면 git 이 그 유령 훅을
  # 계속 실행한다(shim 은 원본이 없으면 exit 1 하므로 모든 커밋이 막히는 fail-closed 사고).
  # 원본 목록에 없는 shim 만 지우고, 관리 파일(.repo-path)은 보존한다.
  STALE=""
  for f in "$TARGET"/*; do
    [ -f "$f" ] || continue
    b="$(basename "$f")"
    case "$b" in .*) continue ;; esac
    found=0
    for n in $NAMES; do
      [ "$b" = "$n" ] && { found=1; break; }
    done
    [ "$found" -eq 0 ] && { rm -f "$f" && STALE="$STALE $b"; }
  done
  [ -n "$STALE" ] && echo "ℹ 저장소에 더 이상 없는 낡은 shim 을 제거했습니다:$STALE"

  echo "ℹ 저장소 경로가 noexec 마운트로 판정되어(chmod 무효) 로컬 shim 방식으로 설치합니다."
  echo "  shim 위치: $TARGET  (원본은 여전히 $REPO_HOOKS_DIR 에서 버전관리됨)"
  echo ""
fi

# 5) core.hooksPath 설정 (멱등)
CURRENT="$(git config --local --get core.hooksPath 2>/dev/null || true)"
if [ "$CURRENT" = "$TARGET" ]; then
  echo "✅ 이미 설치되어 있습니다: core.hooksPath = $CURRENT  [$MODE]"
else
  [ -n "$CURRENT" ] && echo "ℹ 기존 설정을 교체합니다: $CURRENT → $TARGET"
  git config --local core.hooksPath "$TARGET" || { echo "❌ core.hooksPath 설정 실패" >&2; exit 1; }
  echo "✅ 설치 완료: core.hooksPath = $TARGET  [$MODE]"
fi

# 6) 검증 — git 이 실제로 실행할 수 있는 상태인지 확인 (조용한 fail-open 방지)
echo ""
echo "검증:"
VERIFY_FAIL=0
CONF="$(git config --local --get core.hooksPath)"
case "$CONF" in
  /*) ABS="$CONF" ;;
  *)  ABS="$ROOT/$CONF" ;;
esac
for n in $NAMES; do
  if [ -x "$ABS/$n" ]; then
    printf '  ✅ %-14s 실행 가능 (%s)\n' "$n" "$ABS/$n"
  else
    printf '  ❌ %-14s 실행 불가 — git 이 이 훅을 조용히 무시합니다! (%s)\n' "$n" "$ABS/$n"
    VERIFY_FAIL=1
  fi
done

if [ "$VERIFY_FAIL" -ne 0 ]; then
  echo "" >&2
  echo "❌ 설치 검증 실패 — 훅이 동작하지 않는 상태입니다(커밋이 무검사로 통과함)." >&2
  echo "   git 은 실행 불가한 훅을 경고 한 줄만 남기고 무시합니다." >&2
  echo "   HOME 디렉토리 쓰기 권한 / 마운트 옵션(noexec)을 확인하세요." >&2
  exit 1
fi

echo ""
echo "commit-msg 훅: 안전 관련 코드(주문·거래소·안전장치·cron·전략/시그널·인증) 변경 커밋은"
echo "  커밋 메시지의 task ID(T-NNN) + 그 task 파일 '## Reviewer' 섹션 마지막 줄의"
echo "  '최종 판정: PASS (scope: <검토한 경로>)' 기록이 있어야 통과합니다."
echo "  staged 된 안전파일이 그 scope 밖이면 차단됩니다(무관한 과거 task 인용 방지)."
echo "  ⚠ scope 표기가 없는 2026-08-16 이전 판정은 전부 무효 — 재감사가 필요합니다."
echo "  오탐 시 사용자 우회: git commit --no-verify"
echo ""
echo "훅 파일을 새로 추가하면(pre-commit 등) 이 스크립트를 반드시 다시 실행하세요."
echo "  shim 모드는 설치 시점의 훅만 활성화합니다 — 재실행 전까지 새 훅은 무음으로 비활성입니다."
echo "  (commit-msg 훅이 매 커밋마다 이 불일치를 감지해 경고합니다)"
echo ""
echo "동작 확인: bash scripts/test-git-hooks.sh"
echo "해제:      git config --local --unset core.hooksPath"
