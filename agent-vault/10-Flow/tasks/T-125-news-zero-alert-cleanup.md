---
task_id: T-125
title: 뉴스 0건 경고 정리 후보 — 수용된 국내 news=0 이 분석일마다 경고로 반복되는 문제(T-106 보완), 점수 컷 0건과 진짜 검색 0건 구분
status: proposed
priority: low
project: StockInvest
created: 2026-10-30
updated: 2026-10-30
base_ref: origin/main 9d087a4
risk_level: R2
roles_involved: [leader, developer, reviewer, qa, judge]
related_tasks: [T-106-news-zero-streak-alert, T-120-news-score-threshold-query, T-105-news-rag-zero-hits]
tags:
  - type/task
  - domain/alert
  - domain/rag
aliases:
  - 뉴스0건경고정리
waiting: [사용자 착수 결정, 관찰 3~5 분석일]
---

# T-125 뉴스 0건 경고 정리 (후보 — 착수 전)

## 후보 등록 근거
- **사용자 결정**: 2026-10-30 "알림 정리 후보 등록" — T-120 을 "(가) 유지"로 종료(임계·질의 변경 없음)하면서, 그 결과로 생기는 T-106 경고 반복을 별도 후보로 둔다. 이 task 는 **착수 전 후보**이며 코드·설정·운영 변경이 없다.
- **무엇이 문제인가 [확실 — `src/lib/rag/news-health.ts` 머리 주석·코드]**: 경고 조건은 `streak ≥ 3`(같지 않음)이고, 주석에 **"고쳐질 때까지 하루 1회는 계속 울린다"**(프로세스 메모리 스로틀 20시간)고 적혀 있다. 즉 반복은 버그가 아니라 설계다. 그런데 T-120 에서 국내 `news=0`(점수 0.5 컷)을 **수용**했으므로, 뉴스가 0건인 동안 분석이 도는 날마다 "고칠 것이 없는 경고"가 온다. 관측이 없는 날(주말·휴장)은 건너뛰고 이어 센다.
- **T-106 이 막으려던 것**: T-105 에서 5주간 아무 알림 없이 `news=0` 이 이어진 "조용히 꺼진 감시". 지금의 0건은 원인이 다르다 — T-105 당시는 **검색 결과 자체가 0건**(날짜 형식 불일치, `droppedByScore` 0)이었고, 지금은 **검색은 되는데 점수 0.5 컷**(`droppedByScore=5`)이다. 현재 `retrieval` 채널은 둘을 구분하지 않는다(`recentNews.length` 만 센다).
- 국내 현황(10-30 09:21 DB): `news_zero_streak:retrieval:domestic` streak 2(lastDate 10-29) → 오늘 16:00 분석에서 3일째가 되어 첫 경고가 올 수 있다. 해외는 10-30 08:01 에 `news=1` 이 통과해 streak 0.

## 선택지 (가설 — 모두 미검증)
| 안 | 내용 | 비고 |
|---|---|---|
| A | 현행 유지(뉴스 0건인 동안 분석일마다 경고) | 변경 없음. 소음이 감당되면 이대로 |
| B | **점수 컷 0건과 진짜 검색 0건 구분** — `RagContext` 가 `droppedByScore`(뉴스)를 노출하고, `retrieval` 채널은 검색 결과 자체가 0건일 때만 지금처럼 경고, 점수 컷 0건은 낮은 수준(주 1회 요약·로그만 등)으로 | T-105 원래 실패(검색 0건)는 그대로 잡힌다. `src/lib/rag/` 는 훅 `SAFETY_PATHS` 밖이지만 감시 로직이라 Reviewer 통과 권장 |
| C | `retrieval` 채널만 재발송 간격 연장(예: 7일) | 채널별 TTL 인자. 구현은 작지만 "고칠 것 없는 경고"가 줄어들 뿐 구분은 못 한다 |
| D | 스로틀을 DB 에 저장(앱 재기동·배포로 초기화되는 문제 보완) | 범위가 커진다. B·C 와 별개 |
| E | 수용 표시 스위치로 `retrieval:domestic` 만 끈다 | **비권장** — 진짜 회귀(날짜 필터·수집 정지)를 다시 놓칠 수 있다 |
- 환경변수 `NEWS_ZERO_ALERT_STREAK` 올리기는 `fetch`·`retrieval_error` 채널(수집 실패·KB 장애 감시)까지 함께 둔하게 만들어 **비권장**.
- 어느 안이든 알림만 바뀌고 분석·주문 경로는 불변이다(관찰 기준선 영향 없음 [가능성 높음 — 구현 때 재확인]).

## 착수 조건
1. 사용자 착수 결정.
2. **먼저 관찰(읽기 전용) 3~5 분석일**: 실제로 경고가 몇 시에 몇 번 오는지 센다. 방법 — 서버 `/home/brownjeon/apps/stockinvest/shared/logs/pm2-out.log` 에서 `grep -a "\[news-health\]"` (예: `retrieval:domestic 0 관측 — 연속 N일(기준 3) alerted=true`). 소음이 감당되면 이 후보는 닫는다.
3. 착수하면 judge 접수 → Developer → Reviewer(R2) → QA → 배포 창. `news-health.ts` 시험(T-106 의 59 suites 범위)을 깨지 않게 하고, `fetch`·`retrieval_error` 채널 동작은 변경하지 않는다.

## 관찰 기록 (착수 조건 2)
| 날짜 | 시각 | 시장 | 로그 줄 (alerted) |
|---|---|---|---|
| (대기) 2026-10-30 | 16:00 국내 | domestic | 예상: 3일째 — `alerted=true` |

## 하지 않는 것
임계·질의 변경(T-120 결정), `NEWS_ZERO_ALERT_STREAK` 변경, 알림 끄기, 코드·DB·운영 변경 — 이 후보 등록으로는 아무것도 바꾸지 않는다.

## 진행 기록
- [2026-10-30 11:07] 후보 등록(Leader). 사용자 "알림 정리 후보 등록". 코드·DB·운영 변경 없음.

## 최종 요약
(미작성)
