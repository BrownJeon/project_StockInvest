---
task_id: T-126
title: 청산 판단 영구 보존 기록 후보 — `exit_judgment`(가칭): 청산 엔진 평가·스킵·발화를 감사 기간 이후에도 남기는 기록
status: proposed
priority: medium
project: StockInvest
created: 2026-10-30
updated: 2026-10-30
base_ref: origin/main 9d087a4
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa]
related_tasks: [T-108-automation-menu-home-overhaul, T-112-run-judgment-record-foundation, T-100-holdings-loss-control]
tags:
  - type/task
  - domain/data
  - domain/exit
aliases:
  - 청산판단기록
waiting: [사용자 착수 결정, T-112 구현 순서(DP1 ~11-05)]
---

# T-126 청산 판단 영구 보존 기록 (후보 — 착수 전)

## 후보 등록 근거
- **사용자 결정**: 2026-10-30 "권고안 확정" (질문: D11~D14 를 권고안으로 확정하고 U7 SELECT 9건을 실행해도 될까요?) → **D11 = (c) 별도 task 로 영구 보존**. T-112(`job_run_log`·장마감 분석 판단)는 Judge 접수 전이라 범위 확장이 일정을 밀고, 청산 기록은 쓰기 지점·주기가 다르다는 Analyst 권고를 따른다.
- **왜 필요한가 [확실 — T-108 지표 계약 §11, U7 결과]**: 감사 기간(~11-23) 동안 켜 둔 청산 엔진의 판단은 `eval_funnel`(30일 롤링 삭제)과 pm2 로그 파일(회전 설정 없음)에만 남는다. 특히 **마스터 OFF 기간의 "발화했을 조건" 기록**(국내 hard_stop 1,845행·eod_loss_cut 50행, 해외 hard_stop 3,432행·target_profit 219행 — 09-30~10-30)은 가장 오래된 행부터 30일 뒤 사라진다. 하드손절 스킵 행에는 손익률도 없다.
- 후보 필드안과 설계 제약은 [지표 계약 §11.4](../../../docs/design/2026-10-30-t108-metrics-contract-draft.md) 의 `exit_judgment`(가칭): 1행 = (틱 run_id, 시장, 종목) — 평가 시각·수량·진입가·고점·현재가·통화·`pnl_pct`·`trigger_kind`·적용 임계·`decision`(fired/skip_policy/skip_data/no_fire)·스위치 상태·`engine_release`. 가산 전용·외래키 없음·**기록 실패가 청산 평가를 막지 않는다**(T-112 와 같은 원칙).

## 착수 조건
1. 사용자 착수 결정(DDL 은 건별 승인 — 적용 전 일회용 MariaDB 시험).
2. T-112 DDL 과 **같은 승인 묶음으로 할지** 따로 갈지 DP1(~11-05) 에서 결정. 시작이 늦으면 11-23 까지 쌓이는 양이 줄어든다.
3. 구현 시 judge 접수(R2, Codex 필수) → Developer → Reviewer → QA → DDL 적용 승인. 쓰기 지점은 `src/lib/strategy/engine.ts`(`runExitEngine`) — 훅 `SAFETY_PATHS` 대상이라 Reviewer `최종 판정` 줄 필수.
4. 임시 보존(권고): 착수 전에도 지금 U7 합계를 지표 계약 §11.8 에 옮겨 두었다(아래 소멸 전 집계).

## 하지 않는 것
청산 엔진 로직·임계·스위치 변경, DDL 적용, 코드 변경 — 이 후보 등록으로는 아무것도 바꾸지 않는다.

## 진행 기록
- [2026-10-30 16:16] 후보 등록(Leader). 사용자 "권고안 확정" — D11 (c).

## 최종 요약
(미작성)
