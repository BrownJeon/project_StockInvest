---
task_id: T-105
title: 분석에 뉴스가 한 건도 반영되지 않는 문제 — 원인 확정(읽기 전용 진단)·수정은 M4 task-007, 앱 쪽 후속 판단
status: in-progress
priority: high
project: StockInvest
created: 2026-10-28
updated: 2026-10-28
base_ref: 414cc3b
risk_level: R1
roles_involved: [leader, judge]
related_tasks: [T-103-news-fetch-market-split, T-062-post-market-overseas, T-036-news-fetch-silent-failure]
external_tasks: ["home-m4-api task-007-news-kb-date-normalize-and-us-feed"]
tags:
  - type/task
  - domain/rag
  - domain/data-collection
aliases:
  - 뉴스RAG0건
waiting: [user_decision]
---

# T-105 분석에 뉴스가 반영되지 않는 문제

## 사용자 지시 (발화 그대로)

- 2026-10-28 (질문): "뉴스가 분석에 반영되지 않는 원인해서 '[미확인] M4의 지식베이스는 API 키 없이는 읽을 수 없어서(401) 실제 저장 상태를 직접 보지 못했습니다. '에 대하여 분석할때 지식베이스의 데이터를 읽어오지 못하고있다는거야? 원인에 대해서 종합적으로 결과를 말해줘. 원인을 너무 산발적으로 표현하니까 어떤게 원인인지 모르겠어"
- 2026-10-28 (지시): "푸시해주고 뉴스가 분석에 반영되지 않는 문제에 대해서 읽기전용으로 진행하고 수정 태스크도 접수해서 작업진행할 수 있도록 해줘"

## 증상 (로그, 사실)

- 국내 장마감 후 분석 31회(09-20~10-27, pm2 로그 `[rag-retrieval]`) 전부 `news=0 macro=0`. 같은 검색에서 과거 시그널은 `past=3`(M4 장애일 2회만 `errors=3`). `droppedByScore`·`droppedByValidation` 기록 0 — 점수 컷·형식 검증이 아니라 **검색 결과 자체가 0건**.
- 해외 분석은 스위치(`post_market_overseas_enabled`)가 꺼져 로그가 없으나 같은 `retrieveRagContext()` 코드를 쓴다(`post-market-overseas.ts:623`, `lookbackDays: 3, topKNews: 5`).

## 읽기 전용 진단 결과 (2026-10-28 11:3x, `m4-kb-diagnose.py`)

수행한 호출은 M4 `GET /v1/kb/collections`·`/v1/kb/{c}/stats`와 `POST /v1/kb/{c}/search`(읽기 전용 의미 검색)뿐이다. 앱 `.env` 의 `AI_API_BASE`·`AI_API_KEY` 두 줄만 읽었고 값은 출력하지 않았다. 쓰기·삭제·upsert 0.

| 컬렉션 | 건수 | 필터 없음 | 앱과 같은 `date` 필터 | `ingested_at` 필터(대조) |
|---|---|---|---|---|
| news.kr_market | 1,282 | 5건. RSS 항목의 `date` 가 `'Sun, 30 Aug 2026 05:53:01 +0900'`·`'Sun, 11 Oct 2026 05:47:02 +0900'` 같은 **RFC 822 문자열**, 시드 문서는 `'2026-05-01'` | **0건** | **5건** |
| news.us_market | 52 | RSS 항목 `date='Mon, 27 Jan 2025 14:26:00 -0500'`(**2025-01 기사가 `ingested_at=2026-10-27` 로 매일 재적재**), 시드 문서 `'2026-04-25'` | **0건** | 5건(낡은 기사가 "신선"하게 보임) |
| news.macro | 15 | 전부 2026-03~05 시드 문서(`ingested_at=2026-05-12`) | 0건 | 0건(이후 적재 없음) |
| signals.stockinvest (대조군) | 2,499 | 5건 | **5건** | 5건 |

→ 시그널은 앱이 `date='YYYY-MM-DD'` 로 넣어 같은 필터에서 정상 검색된다. 접속·인증·점수 컷은 원인이 아니다.

## 원인 (확정)

1. **[확정] 국내·해외 공통 — 발행일 형식**: M4 `POST /v1/news/fetch` 가 RSS `<pubDate>` 를 변환 없이 `metadata.date` 에 저장하고(`home-m4-api/app/routes/market_context.py::_parse_rss`), 앱의 "최근 3일" 필터는 ISO 범위(`{date: {gte: 'YYYY-MM-DD'}}`)라 RFC 822 문자열은 비교되지 않는다. 국내 RSS(연합뉴스 경제)는 현재 정상(121건, 최신 당일 10:40)인데도 0건.
2. **[확정] 해외 — 원천 정지**: M4 `news_us_rss_url` 기본값(Dow Jones `RSSMarketsMain.xml`)의 최신 기사가 2025-01-27(638일 전). 형식을 고쳐도 3일 안 기사가 없다.
3. **[확정] 매크로**: `news.macro` 는 05-12 시드 15건뿐, 적재 경로가 없다(앱·M4 모두 채우는 코드 없음).

피해야 할 "쉬운 해결": 앱 필터를 `ingested_at` 으로 바꾸면 2025-01 기사가 "오늘 기사"로 통과해 낡은 뉴스를 최신으로 오인한다. 수정은 **저장 시 날짜를 ISO 로 정규화(M4)** + **살아 있는 해외 원천(M4)** 이어야 한다.

## 수정 (M4 프로젝트, 별도 task)

- 구현·감사·시험·배포: **home-m4-api `task-007-news-kb-date-normalize-and-us-feed`** (정본 설계는 그 이력서). 요지: `_parse_rss` 에 발행일 ISO(UTC) 정규화 + 원문 보존, 해외 RSS 기본 URL 교체(권고 CNBC Top News), 시험 신규. M4 는 공유 운영 서버라 **push 는 사용자 승인 사안**이다.
- 이 task(T-105)의 완료 조건: M4 배포 후 앱 분석 로그 `[rag-retrieval]` 에서 `news>0` 확인(국내 16:00 첫 실행 이후) + 해외 스위치를 켠 뒤 해외 로그에서도 `news>0`.

## 앱 쪽 후속 후보 (이번에 만들지 않음 — 사용자 결정 대기)

| 후보 | 내용 | 권고 |
|---|---|---|
| A. 감시 알림 | `news=0` 이 연속 N회면 알림(이번 문제가 5주 넘게 조용히 지속됨) | **권고** — 같은 사고 재발 방지. 별도 task(T-106) |
| B. news.macro 처리 | (1) 앱이 매크로 검색을 하지 않게 하거나 (2) 적재 원천(예: Fed 보도자료 RSS)을 붙인다 | 적재 원천 선정은 사용자 결정 — 지금은 검색 비용만 쓰고 항상 0건 |
| C. 낡은 2025-01 기사 정리 | `news.us_market` 의 낡은 항목 삭제(삭제 연산) | 원천 교체 후 사용자 승인으로 |
| D. 수집 건수 | 국내 피드는 하루 121건인데 요청 limit 20 → 하루 20건만 적재 | 필요 시 limit 상향 — 별도 판단 |

## 하지 않는 것

- 앱 필터를 `ingested_at` 으로 바꾸는 임시 우회, M4 데이터 삭제·백필(별도 승인), 해외 분석 스위치 변경, 앱 코드 변경(이번 task 에는 없음)

## 판단 기록 (judge)

- [10-28] 앱 코드 변경이 없어 StockInvest 쪽 judge 호출 생략(진단·기록 task). M4 task-007 은 M4 judge intake: R2·opus·demo none·assign.

## 진행 기록

- [10-28 11:2x] T-103 push·배포 완료(릴리스 `20261028-112124-414cc3b4` ok) 직후 이 문제 진단 착수.
- [10-28 11:3x] 읽기 전용 M4 진단 완료 → 원인 3개 확정(위). M4 task-007 접수.
- [10-28 11:4x] M4 격리 워크트리 `~/.node-local/m4api-t007`(HEAD d13aaa9)·로컬 venv `~/.node-local/m4api-venv` 준비. 다음: Developer(Opus) → Reviewer → Codex(C2 판정) → Tester → **M4 push 승인 요청**.

## 최종 요약
