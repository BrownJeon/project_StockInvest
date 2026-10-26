---
task_id: T-098
title: 커밋 훅 SAFETY_PATHS 에 사전 등록(백테스트) 코드 편입 — registry·backtest·러너·시험(V4)
status: doing
priority: medium
project: StockInvest
created: 2026-10-26
updated: 2026-10-26
base_ref: f9dda1a
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa]
related_tasks: [T-096-strategy-validation-p2-p3, T-093-hook-safety-paths-auth-tests, T-092-hook-safety-paths-auth-impl, T-075-safety-paths-extension]
tags:
  - type/task
  - domain/safety
  - domain/profit-engine
aliases:
  - 훅사전등록감시
waiting: []
demo_gate:
  required: false
  level: "none"
  status: "not_required"
  version: 0
  repo_path: ""
  artifact_url: ""
  content_sha256: ""
  decided_by: "judge"
  rule_id: ""
  approved_by: ""
  approved_at: ""
  approval_quote: ""
  waived_by: ""
  waived_at: ""
  waiver_quote: ""
  active: false
---

# T-098 커밋 훅 감시에 사전 등록(백테스트) 코드 편입 (V4)

## 사용자 결정 ({T} 기록, 발화 그대로)

"V4 사전 등록 코드를 커밋 훅 감시 대상에 넣어줘"(10-26 21:38) — [[T-096-strategy-validation-p2-p3]] v1.1 패치 §B-0 V4 의 권고(편입)를 승인.

## 목표 · 왜

전략 합격 판정의 근거가 되는 사전 등록 잠금(registry·엔진·러너)은 현재 커밋 훅 `SAFETY_PATHS` **밖**이라 독립 감사 판정 없이 커밋될 수 있다(T-096 Reviewer 감사: "이 경로의 훅 감시는 현재 없다"). 잠금 자체가 에이전트가 쓸 수 있는 파일에 일부 기대므로(`g1-record.json`·원장) **"속이면 들킨다"** 를 만드는 보강이 필요하다 — 훅이 이 경로의 커밋마다 Reviewer 판정 줄(scope 일치)을 요구하면 변경이 반드시 독립 감사 기록을 남긴다.

## 범위 — T-093 과 같은 방식(정확 일치 항목 + 근거 주석 + 시험 + CLAUDE.md 한 문장), 훅 판정 로직 변경 0

넣을 것(예상 — Developer 가 `git ls-files`·워크트리 실제 파일로 확정): 
1. `'^src/lib/profit-engine/registry/'` — 사전 등록 수치·OOS 원장·IS 원장·G1 기록·해시 코드(디렉토리).
2. `'^src/lib/profit-engine/backtest/'` — 백테스트 엔진·신호(디렉토리).
3. `'^scripts/profit-engine/backtest-runner\.mjs$'`·`'^scripts/profit-engine/backtest-runner-core\.js$'` — 러너(정확 일치; `scripts/profit-engine/` 의 다른 파일(`postmortem-core.js`·`holdings-*`·`signal-postmortem.mjs`)은 **넣지 않는다** — 범위 밖, 후보로만 기록).
4. 시험: `'^src/lib/profit-engine/__tests__/backtest-'`(`backtest-*.test.ts` 와 `backtest-fixtures.ts` 접두) · `'^src/lib/profit-engine/__tests__/isolation\.test\.ts$'`(격리 방어선 — 프로젝트 원칙 "안전 경로의 시험은 제외하지 않는다"). 이웃(`signal-postmortem-core.test.ts`·`holdings-*` 시험)은 **비매치**여야 한다.

## 하지 않는 것

훅 판정 로직 변경, 앱 런타임 코드, push·배포(훅은 커밋 즉시 활성 — 설치된 shim 이 메인 트리 훅을 실행). 전체 `scripts/test-git-hooks.sh` 실행 금지(`# [E2E]` 단계가 실제 index·설치 훅을 건드림) — **`# [E2E]` 앞까지 자른 사본**으로만 로직 시험, QA 는 일회용 저장소 실 커밋.

## 수용 기준(T-093 참조 — [[T-093-hook-safety-paths-auth-tests]] 의 수용 기준·QA 방식 재사용)

1. 새 항목이 정확히 의도한 파일만 매치(디렉토리 접두·이웃 비매치·정규식 이스케이프), 기존 감시 파일의 판정 불변(옛/새 훅 전수 대조 — `git ls-files` 전체에 두 배열 적용).
2. 시험 `### T-098` 절(`t098-*`): 항목별 판정 없으면 차단/scope 일치 통과/scope 불일치 차단/차용 방지(다른 안전 경로 판정 차용 불가)/이웃 비매치/혼합/일회용 저장소 실 커밋, 기존 시험과 의미 충돌 없음(충돌 시 의미를 보존해 갱신 — 삭제 금지).
3. 훅 근거 주석(항목별 무엇을 고정하는지 — **파일이 실제로 하는 일을 코드로 확인해 쓴다; 주석 사실 오류는 매번 Reviewer 가 잡았다**), CLAUDE.md 「커밋 안전장치」·모바일 앱 절 옆에 한 문장.
4. 독립 감사(Reviewer, 판정 scope: 훅·시험·CLAUDE.md) → judge C2 → QA(일회용 저장소 실 커밋 시나리오, 옛 훅 대조군).

## 역할 배정

Developer(Opus, 격리 worktree `stockinvest-hook-t098`)·Reviewer(Sonnet)·QA. 새 `T-096` 코드 커밋(`registry/`·`backtest/` 등)은 이 훅이 활성화된 **뒤** 하게 되므로, T-096 Reviewer 판정 줄 scope 는 훅이 읽는 형식(디렉토리 접두·정확 경로, 글롭 금지)이어야 한다.

## 판단 기록 (judge)

## 관련 과거 이력 요약

[[T-093-hook-safety-paths-auth-tests]]·[[T-092-hook-safety-paths-auth-impl]]·[[T-090-hook-safety-paths-auth-routes]]: 같은 훅에 정확 일치/디렉토리 항목 + 근거 주석 + 시험 — Reviewer 가 근거 주석의 사실 오류를 매번 잡았다. 사용한 교훈 ID: 없음.

## 진행 기록

- 2026-10-26 {T}: 사용자 V4 승인 → Leader 착수.

## Developer

## Reviewer

## QA

## 배포 기록

## Codex 검토

## 최종 요약

(완료 시 Leader 가 작성)

## 데모 검토 (demo gate)

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 해당없음 | - | - | judge: none | - |
