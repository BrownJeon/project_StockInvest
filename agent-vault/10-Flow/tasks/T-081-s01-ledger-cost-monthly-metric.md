---
task_id: T-081
title: 통합 절차 S01 — 체결 장부·원가·월 지표 기반 (T-071 WP-2/3 잔여 + 기준 정하기 연결)
status: todo
priority: high
roles_involved: [leader, developer, reviewer, qa]
related_tasks: [T-079, T-071, T-074, T-069, T-056, T-058, T-067]
base_ref: e0aadadf1604a15b269a6c2a240eefa2b778b400
risk_level: R2
tags:
  - type/task
  - domain/restructure
  - domain/safety
aliases:
  - S01 장부 기반
waiting: [사용자 입력 D-2 (T-074 기준 정하기·달러 질문 — 달러 칸 값은 KIS 조회로 확정, 입력값 제시 예정), T-080 완료(순서 D-5), DDL 승인(WP-2 착수 시)]
created: 2026-10-25
updated: 2026-10-25
---

# T-081 — S01 측정·장부·자원 기반

> **연결:** 통합 절차 S01, 공통(H·N 모두의 입력). 정책: U01·U02·U08 확정, C01·C05 제안 v1. 원장 [execution-ledger §2·§5.1](../../../docs/design/2026-10-24-execution-ledger.md), 근거 [S00 보고서 §2.3·§2.5](../../../docs/design/2026-10-24-s00-baseline-report.md).
> **수익·위험 경로(제1원칙):** 앱에 체결 장부(`executions` 0행)와 입출금 기준(원장 0행)이 없어 실현손익·월 손실·원가를 설명할 수 없다. 그 상태로 만든 월 손실·점수·축소 판단은 가짜 숫자 위에 서 있다. 잘못된 실제 손익으로 새 전략을 학습·합격시키지 않도록 먼저 고친다.

## 재사용 / 새로 만드는 것
- **재사용:** T-071 WP-1·1b(CAS·펜싱·해외 시장가·취소 ok 검사), T-074 원장(`src/lib/ledger/*`, 화면 `/settings/cash-ledger`), T-056 USD 스냅샷 규칙 E, T-069 v0a 보유 리포트, T-058 현금 게이트.
- **새로:** ① 월 수익률 정의(C05, 수정 Dietz 제안)와 외부 입출금 보정 계약 ② T-071 WP-3(일일 한도 경합·결과 불명 합산·KST 자정 리셋 — **시험 먼저**) ③ T-071 WP-2(체결 원장: 통화·가격·수수료 종류·누적 1행 기록, 원가 이월, trade-report 30일 prefetch/원가 미상 폴백 수정) ④ T-074 기준 정하기 실행 연결과 달러 칸 의미 반영 ⑤ #2107 처럼 브로커 번호 없는 `pending` 의 정리 설계(A02) ⑥ **원가·실현손익의 원천을 KIS 체결·기간손익 조회로 전환**(A04 — 05-27 이후 모든 거래가 앱 밖이라 앱 `executions` 는 구조적으로 비어 있음. 2026-10-25 KIS 조회로 국내 2종목 매도 체결·실현손실과 해외 기간손익이 조회 가능함을 확인) ⑥-2 **A06: 앱 국내 체결 조회 TR(`TTTC8001R`) ↔ 현행 TR(`TTTC0081R`) 불일치** — 같은 조건에서 앞은 "조회할 내용이 없습니다", 뒤는 체결 2건 반환. 재현(KIS 읽기) 후 어댑터 보정, 안전 경로 → Reviewer 필수 ⑦ 관측 대기: T-056 후속(R07), 해외 가용액 정의(R08) ⑧ 후순위: T-074 낮은 후속 12건(R10), T-069 v0b 목적 재정의(R11).

## 하지 않는 것
킬스위치 로직(T-080 소유), 신규 매수 경로 개방, 전략 승급, 실주문·취소, 운영 설정·알림, 커밋·push·배포. DDL 은 스크립트와 롤백을 제시하고 별도 승인 후에만.

## 소유 파일 / 훅
- 소유: `src/lib/safety/{order-sync,order-limits}.ts`(훅 대상), `scripts/migrations/`(훅 대상), `src/lib/reports/trade-report.ts`·`src/lib/ledger/`·`src/app/api/cash-ledger/`(**훅 밖** — 그래도 독립 Reviewer 판정을 이 task 가 스스로 요구), `src/lib/db.ts`(훅 대상).
- 비대상: `kill-switch.ts`·`portfolio-total.ts`(T-080), `profit-engine/`(T-082).

## 선행 증거 / 미정 / 사용자 입력
- 선행: S00 대사(완료 대기). **D-2**: T-074 화면에서 기준 정하기 입력(달러 칸은 비워 저장 권고) + 달러 질문 3개 답. **D-3**: KIS 읽기 전용 캡처 1회(잔고·주문가능·증거금·미체결, 앱 밖 주문 확인). **DDL 승인**은 WP-2 착수 시 구체 스크립트로.
- 미정: 월 수익률 방식(C05), 기산·경계, 수수료 추정 요율 표시(D10 0.25% "추정"), 원가 미상 규칙.

## 수용 기준 (절차서 S01 완료 기준)
1. 매도대금 전체 이익화·입금 수익화·통화 혼용 없이 설명 가능하고, 미확정은 가짜 0 이 아니라 상태(`불명`)로 표시된다.
2. 부분체결·재시작·취소 대사에서 장부를 잃지 않는다(격리 DB·모의 KIS 시험, 운영 DB 에 샘플 쓰기 금지).
3. 동시 일일 한도 경합 확증 시험이 통과한다(현재 `pending` 제외 구조 재현 후 수정).
4. 월 수익률이 같은 입력에서 재현되고 USD 행 오염(T-080)과 분리 표시된다.
5. Developer → Reviewer(scope 명시) → Judge C2 → QA 순환. 과거 T-071·T-074 판정을 차용하지 않는다.

## 허용 권한
읽기 전용 DB 조회. 이 외(KIS·DDL·DB 쓰기·배포)는 해당 시점에 구체 범위로 별도 요청.

## 판단 기록 (judge)
- [2026-10-25 00:1x] intake engine=jev → task_type=feature / risk=R2 / developer_model=opus / next=ask_user / demo=none / blocking_gate=requirements | overrides=없음 | fallback=- | tokens=1302. 결과 JSON: `docs/design/judge-result-T-081-intake.json`. complexity 2.95 — 큰 task 이므로 착수 시 WP 로 쪼개 WP 별로 Reviewer 를 돈다.
- `blocking_gate=requirements`: 위 사용자 입력(D-2·D-3)과 착수 승인이 충족되기 전에는 시작하지 않는다.

## 관련 과거 이력 요약
[[T-071-ledger-fill-recovery]], [[T-074-cash-flow-ledger]], [[T-069-holdings-baseline-report]], [[T-067-profitability-audit]] (감사 F02·F10), [[T-079-s00-baseline-and-ledger]].

## Leader 기록

## Reviewer

## QA
