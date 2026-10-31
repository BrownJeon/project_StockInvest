#!/usr/bin/env bash
# 소급 Codex 검토용 미니 저장소 생성: /tmp/retro/<T>/repo = 변경 전 상태 커밋(base) + 작업 트리에 변경 후 상태
#   usage: build-retro.sh [T-126|T-127|T-128|T-134|T-135 ...]   (인자 없으면 다섯 건 전부)
# 포함 경로: src scripts package.json tsconfig.json next.config.js ecosystem.config.js jest.config.* docs/db-schema.md  (vault 문서·보유 정보 제외)
# core.fileMode=false 는 필수 — 기본값(true)이면 SMB 위 worktree 의 모든 파일이 「M」으로 보여 snapshot_modified(incomplete)가 난다.
set -euo pipefail
P=/Volumes/homes/brownjeon/project/StockInvest
R=/tmp/retro
PATHS="src scripts package.json tsconfig.json next.config.js ecosystem.config.js jest.config.js jest.config.ts docs/db-schema.md"
declare -A COMMIT=( [T-126]=0116228 [T-127]=c9fc415 [T-128]=fe6f095 [T-134]=c1e8aea [T-135]=8ed1ba7 )
mkdir -p "$R"
build() {
  local name=$1 commit=${COMMIT[$1]}; local d=$R/$name
  rm -rf "$d"; mkdir -p "$d/base" "$d/new"
  for side in base new; do
    local c=$commit; [ "$side" = base ] && c="${commit}^"
    local ex=""; for p in $PATHS; do git -C "$P" cat-file -e "$c:$p" 2>/dev/null && ex="$ex $p"; done
    git -C "$P" archive "$c" $ex | tar -x -C "$d/$side"
  done
  git init -q "$d/repo"
  git -C "$d/repo" config core.fileMode false; git -C "$d/repo" config user.email r@r; git -C "$d/repo" config user.name r
  cp -R "$d/base/." "$d/repo/"; git -C "$d/repo" add -A; git -C "$d/repo" commit -q -m "base ${commit}^"
  rsync -a --delete --exclude .git "$d/new/" "$d/repo/"
  printf '%-6s commit=%s changed=%s files | in-commit non-doc files=%s\n' "$name" "$commit" \
    "$(git -C "$d/repo" status --porcelain | wc -l | tr -d ' ')" "$(git -C "$P" diff --name-only "${commit}^" "$commit" | grep -vc '^agent-vault/' || true)"
}
if [ "$#" -eq 0 ]; then set -- T-126 T-127 T-128 T-134 T-135; fi
for t in "$@"; do build "$t"; done
