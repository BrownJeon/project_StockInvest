---
task_id: T-123
title: T-119 후속 — 개장 전 공시 확인이 조용히 건너뛰는 경우 알림 + 오류 상세 노출 정리 (M-1·L-5)
status: planned
priority: medium
project: StockInvest
created: 2026-10-29
updated: 2026-10-29
base_ref: (T-119 커밋 이후)
risk_level: R2
roles_involved: [leader, developer, reviewer, qa, codex]
related_tasks: [T-119-holdings-premarket-check]
tags:
  - type/task
  - domain/data
  - domain/cron
aliases:
  - T119후속
waiting: []
---

# T-123 T-119 후속 — 조용히 건너뜀 알림 + 오류 상세 정리

## 배경 (Leader)
T-119 Reviewer(독립 감사, 2026-10-29) Medium 1건·Low 1건을 이번 T-119 커밋에서 고치지 않고 분리했다(사양대로 구현됨·거래 안전 무관·놓친 공시는 다음 날 07:00 `edgar-sync` → `us_filings` 로 분석에 반영).

## 항목
| ID | 내용 | 위치 | 권고 |
|---|---|---|---|
| M-1 | `stale_holdings`(스냅샷 3시간 초과)와 "보유 전부 미매핑(`holdings>0 && checked==0`인데 `status:'ok'`)"이 알림 없이 조용히 넘어간다. 스냅샷 주기가 닫힘 중 최대 약 2시간이라 3시간 한도의 여유는 약 1시간 — 스냅샷 1틱 실패만으로 그날 확인이 통째로 빠진다. 방금 산 종목은 다음 07:00 `edgar-sync` 전까지 `symbol_cik_map` 에 없다 | `route.ts:106-110,:132-133,:189-199`, 모듈 `:402-403` (`nextHpStatus`) | `stale_holdings` 와 `holdings>0 && checked==0` 을 연속 실패 카운트에 포함(연속 2일이면 실패 알림) + 스냅샷 한도 3시간 재검토 |
| L-5 | `detail: errName(e)` 가 예외 메시지 100자를 DB 상태 키·응답·Telegram 실패 알림에 그대로 싣는다 — 비밀은 없으나 DB 호스트·사용자 같은 내부 정보가 섞일 수 있다 | `route.ts:255`, `:62` | 이름만 쓰거나 `redactSecrets` 를 거침 |
| Codex-1 (low) | 서로 다른 인스턴스가 같은 접수번호를 같은 초에 처리하면 사전 SELECT 가 둘 다 빈 결과를 받고 FOUND_ROWS 동작 때문에 두 upsert 모두 affectedRows=1 을 받아 같은 공시 알림이 두 번 나갈 수 있다(DB 행은 1건). Reviewer L-3 과 같은 건 | `holdings-premarket.ts:240` | 신규 행 판정을 원자적으로(ER_DUP_ENTRY 처리 또는 원자적 claim) + 동시성 시험. 현재는 pm2 `instances:1`·하루 1회 호출 1개라 비현실적 — 낮은 우선순위 |
| 정보 | L-1 발송 실패 시 재알림 없음 · L-2 주석 변수명 드리프트(`HOLDINGS_PREMARKET_CURL_MAX_TIME` ↔ 러너 `HP_CURL_MAX_TIME`) · L-3 동시 실행 이론상 중복 · L-4 공동 제출자 심볼 · L-6 창 경계 공백 | | 이 task 에서 L-2(주석)만 함께 고쳐도 된다 |

## 착수 조건
스위치 `holdings_premarket_enabled` 를 켠 첫 주(배포 후 ~11-05) 매일 `holdings_premarket_status` 의 `status`(특히 `stale_holdings`·`ok` 인데 `checked=0`)를 확인해 실제로 건너뜀이 관측되면 우선순위를 올려 착수.

## 최종 요약
(미작성)
