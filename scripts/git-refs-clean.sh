#!/usr/bin/env bash
#
# git-refs-clean.sh — `.git/refs` 안에 생긴 Synology 확장속성 사이드카(`@eaDir`)를 격리한다.
#
# ## 왜 있나 (ISS-0013, 2026-11-01)
#
# Mac 에서 도는 도구(실제 사례: Codex CLI 의 turn-diff 체크포인트, `git push` 로 만든 브랜치)가
# SMB 공유 체크아웃에 git ref 파일을 쓰면, macOS 가 그 파일에 `com.apple.provenance` 확장속성을
# 붙인다. Synology 는 확장속성을 파일 옆 `@eaDir/<파일명>@SynoEAStream` 으로 저장한다.
# 그 디렉터리가 `.git/refs` 안에 생기면 **git 이 안의 파일을 ref 로 읽어** 가리키는 객체가 없다고
# 판단하고 멈춘다:
#
#     fatal: bad object refs/heads/@eaDir/codex@SynoEAStream
#     error: ... did not send all necessary objects
#
# 이 저장소는 **push 가 곧 배포**(webhook blue/green)라, 이 고장은 배포하려는 순간에 막는다.
# 고약한 점은 `git status`·`git log`·`git for-each-ref` 가 **경고만 내고 통과**한다는 것이다
# (`for-each-ref` 는 `warning: ignoring broken ref …` 를 내고 exit 0). 그래서 평시 점검으로는
# 드러나지 않고 fetch·push 에서만 터진다.
#
# 2026-11-01 실측: 공유 저장소 12곳 중 11곳에서 발생, 표본 2곳에서 `git fetch` exit=1 재현.
#
# ## 쓰는 법
#
#     bash scripts/git-refs-clean.sh --check [<저장소>]   # 읽기만 한다. 있으면 exit 1
#     bash scripts/git-refs-clean.sh [<저장소>]           # 격리(이동)한다. 지우지 않는다
#
# 저장소를 생략하면 현재 디렉터리의 저장소를 쓴다. worktree 안에서도 공용 git 디렉터리를 찾는다.
# 격리 위치는 `$GIT_EADIR_QUARANTINE`(기본 `~/.local/share/git-eadir-quarantine`) 아래.
#
# ## 원칙
#
#  - **지우지 않는다.** 이름이 **정확히** `@eaDir` 인 디렉터리만, 상대경로를 보존해 저장소 밖으로 옮긴다.
#  - 옮기기 전후 **실제 ref 수가 같아야** 한다. 다르면 비정상 종료한다(ref 를 잃는 사고 방지).
#  - `.git/refs` 밖은 건드리지 않는다. 다른 곳의 사이드카는 ref 해석을 깨뜨리지 않는다.
#  - **macOS 기본 bash 3.2 에서도 돈다** — 절차서 「배포 전 확인」을 맥에서 실행하기 때문이다.
#    그래서 `mapfile`·연관배열을 쓰지 않고 임시 파일로 목록을 다룬다.
#
# ## 종료 코드
#
#   0  깨끗하다 / 격리를 마쳤다
#   1  (--check) 사이드카가 있다
#   2  오류 (저장소가 아니다, ref 수가 변했다, 격리 후에도 남았다)
#
set -eu

CHECK=0
REPO=""
for a in "$@"; do
  case "$a" in
    --check) CHECK=1 ;;
    -h|--help) sed -n '2,46p' "$0" | sed 's/^#//' | sed 's/^ //'; exit 0 ;;
    -*) echo "git-refs-clean: 모르는 옵션 $a" >&2; exit 2 ;;
    *)  REPO="$a" ;;
  esac
done
[ -n "$REPO" ] || REPO="."

ERR=$(mktemp "${TMPDIR:-/tmp}/git-refs-clean-err.XXXXXX")
trap 'rm -f "$ERR"' EXIT INT TERM
if ! GITDIR=$(git -C "$REPO" rev-parse --git-common-dir 2>"$ERR"); then
  # git 이 거부한 이유를 그대로 보여 준다 — "저장소가 아니다"로 뭉개면
  # dubious ownership 처럼 전혀 다른 원인을 사이드카 문제로 오진하게 된다.
  echo "git-refs-clean: git 이 이 경로를 읽지 못했다: $REPO" >&2
  sed 's/^/  /' "$ERR" >&2
  exit 2
fi
# --git-common-dir 은 상대경로로 나올 수 있다
case "$GITDIR" in
  /*) ;;
  *) GITDIR=$(cd "$REPO" && cd "$GITDIR" && pwd) ;;
esac
REFS="$GITDIR/refs"
TOP=$(git -C "$REPO" rev-parse --show-toplevel 2>/dev/null || echo "$REPO")
NAME=$(basename "$TOP")

if [ ! -d "$REFS" ]; then
  echo "git-refs-clean: refs 디렉터리가 없다: $REFS" >&2; exit 2
fi

# 실제 ref 수 — 사이드카를 뺀 파일 수
count_refs() { find "$REFS" -type f ! -path '*@eaDir*' 2>/dev/null | wc -l | tr -d ' '; }

LIST=$(mktemp "${TMPDIR:-/tmp}/git-refs-clean.XXXXXX")
trap 'rm -f "$LIST" "$ERR"' EXIT INT TERM
find "$REFS" -type d -name '@eaDir' 2>/dev/null | sort > "$LIST"
N=$(wc -l < "$LIST" | tr -d ' ')

if [ "$N" -eq 0 ]; then
  echo "git-refs-clean: 깨끗하다 ($NAME, 실제 ref $(count_refs)개)"
  exit 0
fi

echo "git-refs-clean: 사이드카 ${N}개 발견 ($NAME)"
sed "s|^$GITDIR/|  |" "$LIST"

if [ "$CHECK" -eq 1 ]; then
  echo "git-refs-clean: 이대로면 fetch·push 가 'fatal: bad object' 로 멈춘다 — 격리하려면 --check 없이 다시 실행한다" >&2
  exit 1
fi

BEFORE=$(count_refs)
QDIR="${GIT_EADIR_QUARANTINE:-$HOME/.local/share/git-eadir-quarantine}/$(date +%Y%m%d-%H%M%S)/$NAME"
MOVED=0
while IFS= read -r d; do
  [ -n "$d" ] || continue
  # 안전 확인 — 이름이 정확히 @eaDir 이고 refs 아래여야 한다
  if [ "$(basename "$d")" != "@eaDir" ]; then
    echo "git-refs-clean: 건너뜀(이름 불일치): $d" >&2; continue
  fi
  case "$d" in
    "$REFS"/*) ;;
    *) echo "git-refs-clean: 건너뜀(refs 밖): $d" >&2; continue ;;
  esac
  rel=${d#"$GITDIR"/}
  mkdir -p "$QDIR/$(dirname "$rel")"
  mv "$d" "$QDIR/$rel"
  MOVED=$((MOVED + 1))
done < "$LIST"

AFTER=$(count_refs)
if [ "$BEFORE" != "$AFTER" ]; then
  echo "git-refs-clean: 실제 ref 수가 변했다 ($BEFORE -> $AFTER) — 격리본은 $QDIR 에 있다. 되돌려 확인할 것" >&2
  exit 2
fi

LEFT=$(find "$REFS" -type d -name '@eaDir' 2>/dev/null | wc -l | tr -d ' ')
echo "git-refs-clean: ${MOVED}개 격리, 실제 ref ${AFTER}개 불변, 남은 사이드카 ${LEFT}개"
echo "git-refs-clean: 격리본 $QDIR (지우지 않았다 — 되돌릴 수 있다)"
[ "$LEFT" -eq 0 ] || exit 2
exit 0
