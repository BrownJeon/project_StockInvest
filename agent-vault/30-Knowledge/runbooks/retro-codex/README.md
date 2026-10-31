---
project: StockInvest
created: 2026-10-31
tags:
  - type/knowledge
  - type/runbook
  - domain/process
aliases:
  - 소급 Codex 검토
---

# 소급 Codex 검토 (T-126·T-127·T-128·T-134·T-135)

사용자 승인(2026-10-31 22:3x, 원문 「다섯 건 전부 검토진행해주고 검토사항에 대하여 결과에 따라서 후속 작업 진행하도록 하자」)으로, 이미 배포된 다섯 건을 Codex(`gpt-6.1-sol`, adversarial-review, 읽기 전용)로 한 번 더 검토한다. **코드 diff 가 OpenAI 로 전송된다**(승인 범위 안). Reviewer·QA 는 이미 통과했으므로 이 검토는 *추가의 독립 검토*다.

## 왜 미니 저장소인가
프로젝트 저장소를 그대로 돌리면 다른 세션의 미커밋 작업이 섞이고 vault 문서(결정·운영 기록)가 함께 나간다. 그래서 `build-retro.sh` 가 task 별로 `/tmp/retro/<T>/repo` 를 만든다 — **변경 전 상태를 커밋(base)하고 작업 트리에 변경 후 상태**를 둔다. 포함: `src`·`scripts`·설정 파일·`docs/db-schema.md`. 제외: `agent-vault/`·나머지 `docs/`. `core.fileMode=false` 는 필수(기본값 true 면 SMB 위 worktree 가 전부 「M」으로 보여 `snapshot_modified`).

| task | 커밋(비교 대상 `<커밋>^..<커밋>`) | 초점 |
|---|---|---|
| T-135 | `8ed1ba7` | concurrency and security (connection lifecycle, cleanup rm safety, umask) |
| T-126 | `0116228` | data_integrity and concurrency (the recorder must never affect exit evaluation) |
| T-134 | `c1e8aea` | error_handling and behavior preservation of the exit loop |
| T-127 | `c9fc415` | security (amount leakage through masking bypass, umask/permissions, shell quoting) |
| T-128 | `fe6f095` | correctness and error_handling (safety-value display on read failures, display-time aliasing, alert conditions unchanged) |

## 수동 실행
```bash
cd /Volumes/homes/brownjeon/project/StockInvest/agent-vault/30-Knowledge/runbooks/retro-codex
bash build-retro.sh T-135                       # /tmp/retro/T-135/repo 생성 (SMB 위 git archive 라 1~2분)
cd /Volumes/homes/brownjeon/project
bash .claude/tools/codex-review/codex-review.sh run --task T-135 --checkpoint C2 --mode adversarial-review \
  --focus "<위 표의 초점>" \
  --handoff /Volumes/homes/brownjeon/project/StockInvest/agent-vault/30-Knowledge/runbooks/retro-codex/T-135.handoff.md \
  --repo /tmp/retro/T-135/repo --base HEAD --timeout 1500 > /tmp/T-135.result.json
```
(`--handoff` 는 이 폴더의 `<T>.handoff.md` 절대경로.) 래퍼는 Codex 시작 전에 스냅샷·worktree 를 SMB 위에 만드느라 **실행당 4~5분**이 더 걸린다. 한 건당 총 10~25분. **한 번에 하나씩** 돌린다.

## 결과 읽기
- `status` `done`(또는 `incomplete` 이지만 `parsed=true` 이고 `findings` 가 있으면 내용 유효), `files_modified_in_snapshot` 은 빈 목록이어야 한다.
- 지적은 그대로 믿지 않는다 — 독립 Reviewer 가 지적별로 코드를 읽고 재현해 「채택 / 오탐 / 부분」과 실제 심각도를 판정한다. 기록은 각 task 의 `## Codex 검토` 에.
- 채택분은 새 task(T-137 이상)로 열어 구현·감사·QA 까지 진행하되 코드는 `main` 이 아니라 worktree 별도 브랜치에 두고 사용자 배포 승인을 받는다. `critical`·`high` 는 먼저 사용자에게 보고.

## 알려진 제약
- **계정 사용 한도**: 10-31 22:32 첫 시도(T-126)가 5초 만에 `You've hit your usage limit … try again at Nov 1st, 2026 2:15 AM` 으로 실패했다(오류 문구: `stderr.txt`). 모델·CLI 문제가 아니다. 이 오류가 나면 **더 두드리지 않고** 문구의 재시도 시각 이후에 다시 한다. 남은 한도(%)를 읽는 방법은 래퍼 README 에서 아직 「확인 전」이다. 래퍼는 시도마다 `counts/<task>.json` 에 센다(judge 의 4회 한도용).
- 같은 계정의 사용자 본인 Codex 사용과 한도를 공유하므로 새벽 시간대에 돌린다.
- 시험으로 래퍼를 돌릴 때 만든 임시 저장소·`counts` 파일은 정확한 이름으로 지운다.
