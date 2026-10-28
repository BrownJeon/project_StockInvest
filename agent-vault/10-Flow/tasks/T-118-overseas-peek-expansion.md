---
task_id: T-118
title: 해외 peek 슬롯 확대 + 피드별 겹침 검사 + peek 재시도 단축 (T-116 후속, T-114 독립 검토 HIGH H1 대응)
status: doing
priority: high
project: StockInvest
created: 2026-10-28
updated: 2026-10-28
base_ref: 0761fec
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa, codex, deployer]
related_tasks: [T-116-news-first-seen-capture, T-114-corporate-intelligence-second-design, T-104-cron-jobs-market-grouping, T-117-daily-bars-cron-registration, T-119-holdings-premarket-check]
tags:
  - type/task
  - domain/data
  - domain/cron
aliases:
  - peek확대
waiting: []
---

# T-118 해외 peek 확대 (T-116 후속)

## 목표·배경 (Leader)

**한 문장**: T-116 이 배포한 해외 뉴스 peek(저장 없는 조회)를 하루 5슬롯(02·10·14·18·22시)에서 **하루 19슬롯**으로 늘리고, 피드별로 "직전 캡처와 이번 캡처의 발행시각이 이어지는가"를 검사해 상태에 남기며, peek 의 재시도·시간 상한을 줄여 M4 장애 때 러너 틱이 길어지지 않게 한다.

**왜**: T-114 독립 검토(Reviewer, 2026-10-28 23:0x) HIGH H1 — 설계서 자신의 규칙("간격 ≤ 가장 짧은 피드 창의 절반")을 배포된 4시간 간격이 어긴다. 실측: 한 번의 peek 가 돌려주는 기사의 발행 시간 폭이 MarketWatch(dowjones) 약 2.7~3.4시간(10건)·Yahoo 약 1.0~1.6시간(19~20건)이고 CNBC·Bloomberg 은 15~18시간(22:00 KST `ci_raw_item` 첫 캡처 80건 + Reviewer 23:01 직접 조회 일치). 4시간 간격에서는 두 피드 기사가 슬롯 사이에 밀려나 **최초 관측 증거가 영구히 사라진다**(되살릴 수 없음 — 설계서 §2.1). 호출당 약 2초·KB 쓰기 없음이라 슬롯을 늘리는 비용은 작다.

**하지 않는 것**: ingest(KB 적재) 횟수 변경(06:00 하루 1회 유지 — 4주 관찰 기준선), 국내 peek 변경(10:01·13시 유지 — 국내 피드 창 약 6.6시간), DDL(상태는 `system_config` JSON), 알림 추가(겹침 공백은 상태에 기록만, 알림 없음), `ci_raw_item` 스키마 변경, M4 변경.

## 사용자 지시·승인 (원문 보존 — 4D Diligence)

- 2026-10-28 22:5x~23:2x(사용자 원문): "1. T-114의 수집 주기를 기준으로 작업해주고 그에 따른 T-104 의 변화되는 부분에 대하여 현행화하여 잘못 적용되거나 충돌되는 일이 없도록 해줘 2. 결정사항에 대해서는 권고안대로 B로 진행해줘 작업 전에 기존의 겹쳐있는 작업들의 내역을 확인해서 통합해서 결정해야하는 사항있으면 미리 알려줘. 결정해버리고 쭉 진행하도록 해야해"
- 2026-10-28 23시대(사용자 원문, 정확한 시각 미기록): "모두 권고안으로 작업 진행해줘. 이후 작업은 사용자 승인여부 묻지 않고 작업 진행하고 완료 후 결과 정리해서 리포팅해줘."
- 위 "모두 권고안"의 대상은 Leader 가 제시한 결정 Q1~Q7(23시대 보고). 이 task 는 **Q1**: "해외 peek 를 T-118 로 확대하고 피드별 겹침 검사를 추가 — 예: 매시, 단 06·07·08·15·16시 제외(하루 19슬롯). peek 의 재시도는 1회·20초로 단축."
- **허용하는 것**: 러너 peek 블록의 슬롯 목록 확대·peek 호출의 시간 상한, `news-fetch` 라우트의 peek 처리(재시도·시간 상한·응답), `src/lib/corp-intel/` 의 겹침 검사·상태 필드 확장, 시험, 배포(배포 창 안, 킬스위치 ON·최근 3시간 주문 0건 확인), 배포 후 관측.
- **허용하지 않는 것**: ingest 요청 본문·건수·시각 변경, 새 DDL, 알림 추가, 다른 크론 시각 변경.

## 설계 (Leader — Developer 구현 사양)

1. **해외 슬롯**: KST 시(時) `00 01 02 03 04 05 09 10 11 12 13 14 17 18 19 20 21 22 23` (19개). 제외한 시 06(ingest)·07(research·edgar·broker-fills·daily-bars)·08(해외 분석)·15(국내 15:30 수집)·16(국내 분석)은 **러너의 무거운 잡이 도는 틱**이라 peek 를 얹지 않는다. 각 슬롯은 시(時)의 첫 틱, 슬롯마다 날짜파일 하루 1회(기존 T-116 규칙 그대로: 성공·실패 무관 기록, 같은 틱에 앞선 peek 가 돌았으면 다음 틱으로 미룸 — `PEEK_RAN_LABEL` 방식 유지). 국내 슬롯(10·13)은 그대로이며 해외 슬롯과 시가 겹치는 10·13시는 기존 양보 규칙으로 해외 먼저·국내는 다음 틱.
2. **peek 시간 상한**: 라우트의 peek 처리는 M4 호출을 **1회·20초**로 한다(지금은 ingest 와 같은 3회×60초 재시도라 최악 약 186초). 실패하면 `status: failed` 로 상태만 남기고 끝낸다(다음 슬롯이 1시간 뒤). 러너는 peek 호출에 `CALL_MAX_TIME`(약 40초)을 붙인다. ingest(06:00·15:30)의 재시도·60초 상한은 **바꾸지 않는다**. 목표: M4 장애 때 peek 틱 최악 약 40초 + 분 단위 잡 약 30초 + sleep 60 = 130초대(하트비트 300초 대비 여유).
3. **피드별 겹침 검사**: 캡처마다 응답 `items` 를 `feed_host` 별로 묶어 ① 이번 응답의 `oldest_published_at` ② 이 캡처 **전** `ci_raw_item` 의 같은 `feed_host` 최신 `published_at`(`MAX`) 을 비교한다. 이번 응답의 가장 오래된 기사가 직전 최신보다 **늦으면**(= 사이에 못 본 기사가 있을 수 있음) 그 피드를 `gap` 으로 표시. 첫 캡처(직전 값 없음)는 `bootstrap` 으로 표시하고 gap 으로 세지 않는다(첫 peek 80건은 전부 first_seen 22:00:44 인데 발행은 최대 18시간 전 — 지연 통계에서 구분). 비교용 `MAX` 조회는 소량 1회(피드 4개 이하)이며 캡처 4초 공유 마감 안에서 실행한다(마감을 넘기면 검사만 건너뛰고 `feeds` 에 `skipped` 표시 — 저장·기존 동작은 영향 없음).
4. **상태 모양**: `system_config.ci_capture_status:<market>` JSON 에 `feeds` 객체를 추가한다 — `{ "<feed_host>": { "oldestPub": "...", "newestPub": "...", "items": N, "gap": true|false|"bootstrap"|"skipped", "consecutiveGaps": N } }`. 기존 필드(`lastAt, mode, status, fetched, inserted, duplicates, rejected, consecutiveFailures`)는 유지(하위 호환). 상태 쓰기 실패·마감 초과는 기존처럼 조용히 건너뛴다. **알림은 만들지 않는다.** 크기는 피드 4개 × 약 150바이트 수준.
5. **무동작·경계**: 스위치(`ci_capture_enabled`) 꺼짐·테이블 없음에서는 지금처럼 M4 호출 0·DB 쓰기 0. 겹침 검사의 쓰기 대상은 기존과 같은 `system_config` `ci_capture_status:*` 키뿐이고 읽기 대상은 `ci_raw_item` 이다. T-106 `news_zero_streak:*`·`recordNewsOutcome`·`news-fetch:*` 알림은 peek 가 만지지 않는다(기존 시험 유지).
6. **시험**: ① `scripts/test-cron-runner-news-peek.sh` 를 새 슬롯표(해외 19·국내 2)로 갱신 — 슬롯당 하루 1회, 502/타임아웃이어도 하루 1회, 06·07·08·15·16시 틱에 peek 없음, 10·13시 양보, 하트비트 간격 최대 < 300초(특히 17시 `sync-stock-meta` 틱·03시 `export-llm-trainset` 틱과 겹칠 때), 기존 모든 호출이 변경 전과 동일 ② 라우트 시험 — peek 가 M4 를 1회만 부르고 20초 상한, 겹침 검사(정상 이어짐·gap·bootstrap·skipped·직전 값 조회 실패), ingest 경로와 T-106 기록 불변 ③ corp-intel 시험 — 상태 `feeds` 필드 형태, 하위 호환 필드, 경계 시험(`isolation.test.ts`)이 새 읽기/쓰기를 허용 목록 안에서만 하는지. 기존 러너 시험 4개(news-split·pmo-retry·stop-alert + 위 peek)와 훅 시험은 기대값을 약화하지 않고 통과해야 한다.
7. **T-104 흡수 표시**: 러너 peek 블록 머리 주석에 "T-104 단계 1 에서 잡 정의로 흡수" 와 새 슬롯 근거(T-114 H1, 피드 창 실측)를 적는다.

## 배포·관측 계획 (Leader)

- T-119 와 **한 묶음**으로 배포(같은 `cron-runner.sh` 를 건드리므로 Reviewer·Codex·QA 를 묶음 후보 상태에서 한 번 더 확인): 10-29 15:40~20:00 KST 창, 킬스위치 ON·최근 3시간 주문 0건 확인. 늦으면 10-30 05:10~06:50.
- 관측(읽기 전용): 다음 정시 슬롯 몇 개의 cron 로그(`news-peek-overseas-NN OK`)·`ci_raw_item` 신규 행·`ci_capture_status:overseas.feeds` 의 gap 표시(Yahoo·MarketWatch 가 1시간 간격에서 이어지는지)·`entry-watcher` 매분 정상. 공동 인계서 §10 대장에는 "판단 불변(기록 전용)"으로 배포 시각만 남긴다.
- 롤백: 러너 슬롯 목록을 이전 5개로 되돌리는 `git revert`(데이터 보존) 또는 스위치 `ci_capture_enabled` false.

## 판단 기록 (judge)

- [2026-10-28 23:3x] intake engine=rules → risk=R1 / developer_model=opus(`MD-judge-failed-opus`) / next=assign / demo=none | overrides=MD-judge-failed-opus | fallback=budget_window_closed | tokens=0 (판정 출력: scratchpad `judge-T-118-intake.out.json`)
- [23:3x] **Leader override: R1 → R2.** 근거: 변경 경로가 `scripts/cron-runner.sh`·`src/app/api/cron/news-fetch/`·`src/lib/corp-intel/`(모두 커밋 훅 `SAFETY_PATHS` 대상, 무인 실행). 판정 엔진의 R1 은 키워드 기반이라 실제 경로 위험을 못 봤다. R2 이므로 Reviewer → Judge C2 → **Codex 필수** → QA. developer 모델 opus 유지. 화면 없음(demo=none).

## Developer

## Reviewer

## QA

## Codex 검토

## 배포 기록

## 최종 요약
