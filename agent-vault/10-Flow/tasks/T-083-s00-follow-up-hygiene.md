---
task_id: T-083
title: S00 후속 — 상태 문서 동기화와 저장소 위생 (문서 전용)
status: todo
priority: medium
roles_involved: [leader]
related_tasks: [T-079, T-056, T-058, T-060, T-062, T-072, T-074, T-075, T-040]
base_ref: e0aadadf1604a15b269a6c2a240eefa2b778b400
risk_level: R0
tags:
  - type/task
  - domain/restructure
aliases:
  - S00 위생
waiting: [사용자 결정 D-4 (미커밋 산출물 보존·커밋 시점, T-040 커밋/폐기)]
created: 2026-10-25
updated: 2026-10-25
---

# T-083 — S00 후속: 상태 문서 동기화와 저장소 위생

> **연결:** 통합 절차 S00 후속, 공통. 코드·설정 변경 없음. 원장 [execution-ledger §5.1](../../../docs/design/2026-10-24-execution-ledger.md), 근거 [S00 보고서 §5](../../../docs/design/2026-10-24-s00-baseline-report.md).
> **수익·위험 경로(제1원칙):** 직접 수익은 없다. 낡은 상태표(배포된 task 가 `todo`)와 미추적 핵심 문서가 다음 세션의 중복 작업·정책 역행·산출물 유실을 부른다.

## 항목
1. **R01 상태 동기화:** T-056·T-058·T-060·T-062·T-072·T-074·T-075 frontmatter `status` 와 보드·RESUME 의 낡은 문구(M-01), T-058·T-060·T-062 의 공란 `최종 요약`, T-071 `Leader 기록` 공란(배포 사실 `20261022-225754-1163fe2d` 기록, M-05), T-069 `waiting` 낡음(보고서 §5 에는 별도 번호 없음), 인벤토리의 오류 3건(D-4·D-6·"13건", M-02·M-03·M-08)에 정정 표지. 다른 세션의 미커밋 변경이 있는 문서(T-042·T-046·T-049·T-064·T-067·T-074 등)는 **그 변경을 지우지 않고 해당 줄만** 고친다.
2. **R02 미추적 산출물 보존:** 통합 절차서·T-077~T-083·인터뷰·핸드오프·감사 보고서·인벤토리·roadmap 이 `??` 상태. **커밋은 push 시 재배포를 발화**하므로 시점·범위는 사용자 결정(D-4). 그때까지는 파일을 건드리지 않고 보존 목록만 유지.
3. **R03 T-040:** 6일 미커밋·기준 커밋 낡음. 커밋하려면 HEAD 기준 재검증(`@workspace/api-usage` 링크 복구, 이후 늘어난 외부 호출 지점 목록 반영)과 안전 경로(Reviewer) 절차가 필요. 폐기 vs 커밋은 사용자 결정.
4. **R04 위생:** 루트 `NUL`(789바이트, 도구 부산물 추정)·`refs/heads/@eaDir` 오류(`git log --all` 실패)·낡은 stash 1건. **삭제는 사용자 확인 후.**
5. 거래 리포트가 10-23 08:04 이후 미발송인 사유 확인(cron 은 매분 OK) — 읽기 전용 조사.

## 하지 않는 것
소스·설정·DB 변경, 커밋·push·배포, 타 세션 변경 삭제·덮어쓰기, `git add -A`·stash·reset·clean.

## 수용 기준
1. 상태표가 task 문서의 배포 기록·커밋과 일치하고, 고친 줄마다 근거 링크가 있다.
2. 타 세션 미커밋 변경이 그대로 남아 있다(`git status` 전후 비교).
3. 보존 목록이 원장 §6 과 일치한다.

## 허용 권한
문서 편집(작업 트리). 삭제·커밋·push 는 별도 요청.

## 판단 기록 (judge)
- [2026-10-25 00:1x] intake engine=jev → task_type=docs / risk=R0 / developer_model=sonnet / next=ask_user / demo=none / blocking_gate=requirements | overrides=없음 | fallback=- | tokens=1290. 결과 JSON: `docs/design/judge-result-T-083-intake.json`. `blocking_gate=requirements` 는 D-4 결정으로 해소.

## 관련 과거 이력 요약
[[T-079-s00-baseline-and-ledger]], [[T-040-api-usage-log]], [[T-074-cash-flow-ledger]].

## Leader 기록

## 최종 요약
(완료 시 Leader 작성)
