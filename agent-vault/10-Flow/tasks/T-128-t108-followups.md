---
task_id: T-128
title: T-108 후속 정리 후보 — 설정 화면 기존 컨트롤 터치 영역·초기 조회 실패 처리·문구 정리·배포 후 관찰 항목
status: proposed
priority: low
project: StockInvest
created: 2026-10-31
updated: 2026-10-31
base_ref: origin/main 9d087a4
risk_level: R1
roles_involved: [leader, designer, developer, reviewer, qa]
related_tasks: [T-108-automation-menu-home-overhaul, T-104-cron-jobs-market-grouping, T-127-job-run-spool-hardening, T-112-run-judgment-record-foundation]
tags:
  - type/task
  - domain/ui
aliases:
  - T108후속
waiting: [사용자 착수 결정 — T-108 은 10-31 05:21 배포 완료, 8번(배포 후 관찰)은 사용자 로그인 호출 뒤 확인]
---

# T-128 T-108 후속 정리 (후보 — 착수 전)

## 후보 등록 근거
T-108 의 Reviewer 2명·Codex·QA 가 배포를 막지 않는 항목으로 분류한 것을 모았다([[T-108-automation-menu-home-overhaul]] `## Reviewer`·`## QA`). 낮은 위험이라 별도 task 로 분리한다.

## 범위(우선순위순)
1. **설정 화면 기존 컨트롤 44px 미만 10개**(QA 면제 사유, 360px 실측): 「미적용›」「60분 ›」「-2% ›」「-4% ›」「-7% ›」등 — 이번에 건드리지 않은 기존 UI. **T-104 의 설정 화면 작업(WP5)과 같은 파일**이라 그때 함께 고친다(L-4 합의).
2. **`SettingsPage` 초기 `Promise.all`** 에서 `/api/settings/strategies` 요청에 `.catch` 가 없어 한 요청이 실패하면 안전 값도 상태에 못 들어가고 unhandled rejection 이 난다(토글은 잠긴 채 「값을 읽지 못했습니다」 — 안전한 쪽). 요청별 `.catch(() => null)`.
3. **확인 필요 머리 숫자**: 「확인 필요 4건」(묶음 단위)과 하단 「데이터 이상·분석 실패 6건」이 병기돼 혼동 — 머리 숫자 의미(묶음 수 vs 항목 수)를 Designer 가 정한다.
4. **영문 코드 노출**: 청산 가동 줄 「! 조회 실패 · balances_unknown」등 — 사유 사전(`reason-copy.ts`)에 추가. 사유 사전이 서버 `activity.ts REASON_KO` 와 화면 `reason-copy.ts` 로 두 벌이니 **단일 출처 + 키 일치 시험**으로 모은다.
5. **「차단」 표기 규칙 3개**(Designer): 스위치는 「모든거래차단」 한 낱말, 시그널은 「검증 관문」과 함께, 주문은 사유와 함께.
6. **분석 상세 `skipped` 표기 불일치**(Designer 발견): 홈·거래의 「⊘ 차단」과 전략 화면의 「건너뜀」이 같은 시그널(검증 관문에 막힌 장마감 시그널)을 다르게 부름 — `indicators.gate` 분기 필요.
7. **읽기 계층**: `rejectedToday` 가 거절 시그널이 아니라 주문의 거절 행을 센다(명세 의도 확인), `broker_ledger` 표 없음(1146)을 §4.0 은 `prep` 으로 정하는데 구현은 `error(not_migrated)` — 운영에는 표가 있어 무해, 정리. 안전 읽기 레인 허용 SQL 목록을 시험이 고정하도록(상수 export + `toEqual`). `order_rejected` 줄 사유가 비면 「사유 기록 없음」.
8. **배포 후 관찰 항목**(구현이 아닌 확인): `/api/ops/home` 응답 시간(쿼리 약 45개, 최악 약 8.8초 vs 목표 4초 — 운영 NAS 실측 필요)·`Threads_connected`·풀 대기열(풀 `queueLimit: 0`)·`order_blocked` 줄이 매일 뜨는지·운영 계정의 `SET STATEMENT max_statement_time` 허용.

9. **저장된 청산 사유 앞머리 표시 변환**(T-129 Reviewer 4(a)): DB `signals.reason` 앞머리 `[하드 손절]`·`[EOD 손절]`(exit-engine `reasonHead`)이 텔레그램·화면에 그대로 나와 새 이름과 한 메시지에 섞인다. **표시 시점 별칭 맵**(옛·새 앞머리를 같은 새 용어로 변환, 신호 생성 경로·DB 텍스트는 불변) — 코드 변경이라 Reviewer 판정 필요.
10. **T-129 Reviewer 경미**: 「트레일링」「익절」과 「트레일링 스탑」「목표 익절」 표기가 화면에서 혼재(용어표 §12 에 없음 — 정하기) · `kill-switch.test.ts` 에 console 문구 불변 단언 1줄 · `volatility-guard.ts`·`portfolio-snapshot/route.ts` 경보 6건의 「킬스위치」 정정(SAFETY_PATHS, 별도 판정).

## 착수 조건
사용자 착수 결정. T-104(크론 정리 + 설정 화면 WP5)와 묶는 것이 효율적(1번·2번이 같은 파일).

## 하지 않는 것
이 후보 등록으로는 코드·스위치·DB 를 바꾸지 않는다.

## 진행 기록
- [2026-10-31 00:42] 후보 등록(Leader). T-108 QA 의 44px 면제와 Reviewer·Codex·QA 의 Minor 를 모음.
