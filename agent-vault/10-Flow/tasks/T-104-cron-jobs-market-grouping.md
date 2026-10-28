---
task_id: T-104
title: 크론 잡 정리 — 해외주식정보 수집 / 국내주식정보 수집 두 그룹으로 나누어 관리
status: proposed
priority: medium
project: StockInvest
created: 2026-10-28
updated: 2026-10-28
base_ref: 0825250
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa, codex, deployer]
related_tasks: [T-103-news-fetch-market-split, T-106-news-zero-streak-alert, T-105-news-rag-zero-hits]
tags:
  - type/task
  - domain/cron
  - domain/operations
aliases:
  - 크론정리
waiting: [사용자 범위 결정(아래 "결정 필요")]
demo_gate:
  required: false
  level: "none"
  status: "not_required"
  version: 0
  repo_path: ""
  artifact_url: ""
  content_sha256: ""
  decided_by: "leader"
  rule_id: ""
  approved_by: ""
  approved_at: ""
  approval_quote: ""
  waived_by: ""
  waived_at: ""
  waiver_quote: ""
  active: false
---

# T-104 크론 잡 정리 (해외/국내 정보 수집 그룹)

## 사용자 지시 (2026-10-28, 발화 그대로)

> "그렇다면 우선은 뉴스에 대한 수집에 대하여 국내 뉴스와 해외뉴스 수집하는 작업을 나누고 크게는 잡들에 대하여 해외주식정보 수집과 국내주식정보 수집으로 그룹을 나누어서 잡을 관리하는 것으로 변경해줘. 일단은 국내뉴스와 해외뉴스의 크론잡을 분리하는 작업 진행 후에 크론잡 정리작업도 진행하자"

앞 단계(뉴스 수집 국내·해외 분리)는 T-103 으로 운영 반영 완료(릴리스 `20261028-112124-414cc3b4`). 이 task 는 그 "후속 정리" 이다.

## 현재 잡 목록 (2026-10-28 `scripts/cron-runner.sh` 실측, 모두 하드코딩 — 시각·주기를 바꾸려면 코드 수정+배포)

러너는 60초 틱 하나(`stockinvest-cron`)가 시각·분 조건으로 `/api/cron/*` 를 순서대로 호출한다.

| 그룹 후보 | 잡 | 시각/주기 | 비고 |
|---|---|---|---|
| **해외 정보 수집** | news-fetch (overseas) | 매일 06시 첫 틱 | T-103 분리 완료, 잡 이름 `news-fetch-overseas` |
| | edgar-sync | 매일 07시 | SEC 공시·재무·실적발표 일정 수집 |
| | research-cycle-overseas | 매일 07시 | 리서치 추적 종목 사이클 패턴 재계산 |
| | kis-fundamentals-snapshot | 매일 08시 | KIS 해외 현재가상세 원값 스냅샷 |
| | post-market-overseas (분석) | 매일 08시(스위치 `post_market_overseas_enabled`, 없으면 꺼짐) | 수집이라기보다 분석 — 그룹 소속 판단 필요 |
| **국내 정보 수집** | news-fetch (domestic) | 매일 06시, 해외 다음 틱 | T-103 분리 완료 |
| | post-market-domestic (분석) | 매일 16시 | 분석 — 소속 판단 필요 |
| | research-cycle-domestic | 매일 16시 | Yahoo 일봉 기반 사이클 |
| | sync-stock-meta | 매일 17시 | 종목 메타 동기화 |
| | rs-update (domestic) | 매일 17:30 | RS 등급 갱신 — **해외용 `rs-update?market=overseas` 는 예약돼 있지 않다** |
| **공통(시장 무관)** | entry-watcher · holding-checker · stop-alert | 매 틱(1분) | 매매 감시 — 안전 영역 |
| | strategy-eval · trade-report | 5분 | |
| | signal-followup | 15분 | |
| | signal-expiry | 30분 | |
| | portfolio-snapshot | 60분 | |
| | broker-fills | 매일 07:20 이후 | 국내·해외 둘 다 읽는 체결 원장(07시 두 잡 뒤) |
| | export-llm-trainset | 매일 03시 | 학습 데이터셋 export |

## 결정 필요 (사용자) — "그룹으로 관리" 의 범위

지시문의 "잡을 관리하는 것으로 변경" 이 어디까지인지가 열려 있다. 범위에 따라 위험·작업량이 크게 다르다.

| 안 | 내용 | 위험 | 작업량 |
|---|---|---|---|
| **A. 구조 정리만** | `cron-runner.sh` 를 "해외 수집 / 국내 수집 / 공통" 세 구역으로 재배치하고 구역별 주석·로그 접두어(`[ovs]`·`[dom]`) 통일. 동작·시각 불변 | 낮음(동작 불변, 시험으로 호출 순서·날짜 파일 동일성 고정) | 작음 |
| **B. A + 그룹 스위치** | A 에 더해 `system_config` 의 그룹별 켜기/끄기(예: `cron_group_overseas_enabled`, `cron_group_domestic_enabled`) 추가. 스위치 값이 없으면 현재처럼 켜짐(기본 불변). 한 시장 수집만 멈출 수 있다 | 중간(실패 시 "켜졌어야 할 잡이 꺼짐" 위험 → 값 없음=켜짐·읽기 실패=켜짐 으로 수렴시켜야 함) | 중간 |
| **C. B + 시각/주기 설정** | 그룹·잡별 실행 시각을 DB 에서 읽어 러너가 따른다(설정 화면 포함 시 데모 승인 필요) | 높음(러너가 DB 에 의존 → DB 장애 시 크론 정지 가능, 시각 오설정으로 데이터 누락) | 큼 |

**Leader 권고: B.** 이유 — 사용자가 해외/국내를 나누어 관리하려는 실제 필요(예: 한 시장 수집이 고장 났을 때 그 시장만 멈추기, 해외 분석 스위치 `post_market_overseas_enabled` 와 같은 패턴 확장)를 충족하면서, 시각 설정(C)의 DB 의존 위험은 피한다. 시각 변경 수요가 생기면 C 를 별도 task 로. `[추측]` 사용자가 말한 "관리" 가 설정 화면에서의 그룹 표시까지 포함하면 designer 데모(화면 신규)가 필요해 C 와 함께 별도 task 로 분리하는 편이 안전하다.

범위 밖 확인 필요 항목(권고 포함):
1. `post-market-*`(분석)를 "정보 수집" 그룹에 둘지 별도 "분석" 그룹으로 둘지 — 권고: 그룹 안에 두되 이름으로 구분(`수집`/`분석` 하위 표기).
2. `rs-update` 해외 판이 예약돼 있지 않은 것은 의도인가(미국 RS 등급을 쓰는 곳이 있는가) — 이 task 에서 추가하지 않고 사용자 확인 후 별도 처리.
3. 러너는 안전 영역(`^scripts/cron-runner\.sh$`·`^src/app/api/cron/` 가 훅 `SAFETY_PATHS`) — Reviewer 판정 줄 필수, Codex C2 필수(R2).

## 선행·연관

- T-103(뉴스 분리): 러너의 `news-fetch-split` 블록과 시험(`scripts/test-cron-runner-news-split.sh`·`test-cron-runner-pmo-retry.sh`)은 이 정리에서 구역 이동 때 같이 갱신해야 한다. 후속 후보로 적어 둔 "news-split 시험 기준선 재설정"을 여기서 처리한다.
- T-106(뉴스 0건 감시): 같은 날 배포 예정 — T-104 는 T-106 배포·관측 뒤에 착수한다(러너·cron 라우트를 같은 날 두 번 바꾸지 않는다).

## 판단 기록 (judge)

## 진행 기록

- [10-28 13:0x] 접수·잡 목록 실측·범위 선택지 정리. 사용자 범위 결정 대기(A/B/C, 권고 B). 착수는 T-106 배포·관측 뒤.

## Developer

## Reviewer

## QA

## 배포 기록

## Codex 검토

## 최종 요약
