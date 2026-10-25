---
task_id: T-082
title: 통합 절차 S02 — 일봉 수집 잔여·후보군 원천·사후검증 보강
status: todo
priority: medium
roles_involved: [leader, analyst, developer, reviewer, qa]
related_tasks: [T-079, T-070, T-059, T-064]
base_ref: e0aadadf1604a15b269a6c2a240eefa2b778b400
risk_level: R1
tags:
  - type/task
  - domain/restructure
  - domain/strategy
aliases:
  - S02 일봉 잔여
waiting: [10-27(화) 05:35 이후 증분 확인 시점, KIS 읽기 권한(수동 호출), 후보군 원천 확인 결과 C02, 착수 승인]
created: 2026-10-25
updated: 2026-10-25
---

# T-082 — S02 일봉·사건·후보군과 사후검증 (남은 부분)

> **연결:** 통합 절차 S02, 공통(수집 기반) + N(후보군 원천). 정책: U05·U15 확정, C02 제안 v1. 원장 [execution-ledger](../../../docs/design/2026-10-24-execution-ledger.md), 근거 [S00 보고서 §2.7](../../../docs/design/2026-10-24-s00-baseline-report.md).
> **수익·위험 경로(제1원칙):** 이 작업은 신규 매수(N) 경로의 입력 데이터를 만든다. N 경로는 아직 엣지 증거가 없으므로 **토큰·시간을 작게 쓰는 범위로 한정**한다 — 이미 만든 수집기의 검증 마감과 후보군 원천 확인(공식 원천 먼저)까지만 하고, 무거운 연구(S03/S04)는 사용자가 C09 를 정한 뒤에 착수한다. 주문 경로를 건드리지 않는다.

## 재사용 / 새로
- **재사용:** T-070 `daily_bars`(93종목 70,965행)·수집·품질·사후검증 도구, T-059 EDGAR·KIS 스냅샷 수집기.
- **새로:** ① 증분 확인(R12): 10-27(화) 05:35 이후 기본 대상 재실행, `modes:['incremental']`·종목당 1호출·`adjChange.mismatches=0`·`storedGaps` 0 ② T-070 Phase 1 이월 3건(flags 보존 SQL 덮어쓰기·relabel 경쟁·정지 종목 반복 비용, flags 길이 여유 9자)과 정기 증분 cron 등록(R13) ③ 후보군 원천(C02): Nasdaq100·코스닥100 공식 구성종목 확인, 지금부터 월별 스냅샷 적립, 정적 `SP500_TOP50` 은 시험용으로 격하(R14·N08) ④ D19① Yahoo 일봉 읽기 전용 오프라인 교차검증(R15) ⑤ T-059 후속(정적 코드 오류 `NYS:WMT`→`NAS:WMT`·`BRK.B`, IR 일정, 휴장일 2031행, R17) ⑥ 후순위: 사후검증 도구 보강(R16).

## 하지 않는 것
주문·시그널 경로, 전략 코드, 백테스터·스크리너(S03/S04), 유료 데이터 가입(U15 — 공식 원천·웹검색 결과 후 사용자 결정), 운영 설정 변경, 커밋·push·배포. 무거운 백필이 진입·보유 감시를 지연시키지 않도록 기존 KIS 스로틀·토큰 공유와 낮은 우선순위를 지킨다.

## 소유 파일 / 훅
- 소유: `src/lib/profit-engine/`·`scripts/profit-engine/`(**훅 밖** — Reviewer 판정을 스스로 요구), `src/app/api/cron/daily-bars/route.ts`·`scripts/cron-runner.sh`(훅 대상), `src/lib/strategy/universe-overseas-static.ts`(훅 대상, 코드 오류 정정 시), 신규 DDL 이 있으면 `scripts/migrations/`(훅 대상).
- 비대상: `order-sync.ts`·`kill-switch.ts`(T-080/T-081).

## 선행 증거 / 미정
- 선행: S00 대사. 증분 확인은 새 봉이 확정되는 시각 이후(10-27 05:35 KST 이후), KIS 읽기 호출이 필요.
- 미정: C02(원천·NYSE50·신규 ETF 범위), 연구 표본과 신규 매수 범위의 차이, 효력일 보존 방식(DDL 필요 여부 → 별도 승인).

## 수용 기준 (절차서 S02 완료 기준)
1. 품질·커버리지·시점 확보와 편향 한계가 보고된다(기존 95% 커버리지 수치는 연구 등록 때 적용 범위 확정).
2. 구성 스냅샷 적립이 시작되고 복원 불가능한 과거 구간의 한계가 명시된다(현재 목록을 과거로 소급하지 않음).
3. 정적 50 과 확정 후보군이 코드·문서에서 구분된다("KOSPI 100 근사" 같은 이름과 실체 불일치 정정 포함).
4. 의심 행 재확인·재수집 후 복귀 규칙이 있고 단순 제외로 편향을 숨기지 않는다.
5. 격리 시험 + 독립 Reviewer + QA. 유료 데이터는 도입하지 않는다.

## 허용 권한
읽기 전용 DB 조회. KIS 수동 호출(증분 확인)·cron 등록·운영 DB 쓰기·DDL 은 해당 시점에 구체 범위로 별도 요청.

## 판단 기록 (judge)
- [2026-10-25 00:1x] intake engine=jev → task_type=null(도구가 분류 실패) / risk=R2(`R2-kw-payment` 키워드 과적합) / developer_model=opus(`MD-judge-failed-opus`) / next=ask_user / demo=none / blocking_gate=requirements | overrides=Leader(아래) | fallback=- | tokens=1273. 결과 JSON: `docs/design/judge-result-T-082-intake.json`.
- **Leader override(위험):** 이 task 는 주문 경로와 설정을 건드리지 않는 데이터 작업이라 실질 위험은 R1 이다. 다만 cron 등록·KIS 호출·DDL 이 들어가는 항목은 그 시점에 R2 로 다시 판정한다. developer 모델 opus 는 그대로 둔다.

## 관련 과거 이력 요약
[[T-070-daily-bars-phase0]], [[T-059-us-data-collector-p1]], [[T-064-profit-engine-design]](Phase 1), [[T-079-s00-baseline-and-ledger]].

## Leader 기록

## Reviewer

## QA
