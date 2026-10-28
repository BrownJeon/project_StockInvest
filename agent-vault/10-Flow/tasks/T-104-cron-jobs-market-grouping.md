---
task_id: T-104
title: 크론 잡 정리 — 해외주식정보 수집 / 국내주식정보 수집 두 그룹으로 나누어 관리
status: planned
priority: medium
project: StockInvest
created: 2026-10-28
updated: 2026-10-28
base_ref: 0825250
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa, codex, deployer]
related_tasks: [T-103-news-fetch-market-split, T-106-news-zero-streak-alert, T-105-news-rag-zero-hits, T-114-corporate-intelligence-second-design, T-115-news-fetch-coverage-fix, T-116-news-first-seen-capture, T-117-daily-bars-cron-registration]
tags:
  - type/task
  - domain/cron
  - domain/operations
aliases:
  - 크론정리
waiting: [T-117·T-118·T-119 배포 + 1주 관측 (그 뒤 범위 C 설계 확정 → 1단계 구현). 결정 E1~E7 은 2026-10-28 사용자 위임으로 확정됨]
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

## ★ T-114 이후 현행화 (1차 23:4x → **2차 23:3x: 사용자 위임 결정 Q1~Q7 반영, T-117·T-118·T-119 추가, 충돌 방지 목록 §7**)

> **먼저 정정**: 아래 「결정 필요」 절의 A/B/C 는 이미 **사용자가 C 로 확정**했다(10-28 14:2x, 「범위 C 확정」 절). 이 task 가 지금 기다리는 것은 범위가 아니라 **잡별 주기 값**이다. 그 값을 정할 때 필요한 현재 사실과 T-114 영향을 아래에 모았다. (프로젝트 메모리 색인에 "A/B/C 결정 대기"로 남아 있던 표기는 낡은 것 — 이번에 정정.)

### 1. 한 줄 결론 [확실 = 이번 세션에서 러너 소스·T-114 설계서·운영 로그로 확인]

**기존 잡의 주기를 바꿔야 할 필요는 없다.** 바뀌어야 하는 것은 ① 이미 바뀐 것(T-115·T-116 — 아래 표) ② 새로 생기는 잡(T-117 일봉, T-119 보유 종목 개장 전 확인, T-114 후속 단계의 ci-* 잡)의 **자리 배정** ③ 해외 peek 간격 — **사용자 위임(Q1)으로 T-118 이 19슬롯으로 확대하기로 확정** ④ 이 모든 것이 하드코딩 블록으로 러너에 쌓이고 있어 **T-104 의 필요가 더 커졌다**는 점이다. 근거와 결정 항목은 아래.

### 2. 현재 잡 지도 (러너 `faf8bc3` 실측 — T-103·T-115·T-116 반영, 밑줄=이번 주 추가)

| 시각(KST) | 잡 | 비고 |
|---|---|---|
| 매 틱(≈1분) | entry-watcher · holding-checker · stop-alert | 안전 영역 — 고정 |
| 5/15/30/60틱 | strategy-eval·trade-report(5) · signal-followup(15) · signal-expiry(30) · portfolio-snapshot(60) | portfolio-snapshot 은 킬스위치 입력 — 고정 |
| 03시 | export-llm-trainset | |
| 00·01·02·03·04·05·09·10·11·12·13·14·17·18·19·20·21·22·23시 (T-118 후 19슬롯; 지금 배포본은 02·10·14·18·22시) | **news-peek-overseas-NN** (T-116 → **T-118 확대**, 저장 없는 조회) | 슬롯마다 하루 1회. 06·07·08·15·16시는 무거운 잡이 도는 틱이라 제외 |
| 06시 | news-fetch-overseas → (다음 틱) news-fetch-domestic | 건수 시장별 100 (T-115) |
| 07시 | research-cycle-overseas · edgar-sync (같은 틱) → 07:20 이후 첫 틱 broker-fills | broker-fills 는 앞 두 잡이 이 틱에 돌았으면 양보 |
| 08시 | post-market-overseas(스위치 ON, 실패 시 10분×3) · kis-fundamentals-snapshot | |
| 10시 | news-peek-domestic(10:0x, 해외 10시 peek 가 이 틱에 돌았으면 다음 틱) | |
| 13시 | news-peek-domestic | |
| 15:30~15:59 | **news-fetch-domestic-pm** (T-115) | 16시 이후로 놓치면 그날 건너뜀 |
| 16시 | post-market-domestic · research-cycle-domestic | |
| 17시 / 17:30 | sync-stock-meta / rs-update(국내) | rs-update 해외판은 예약 없음(라우트는 지원) |
| **07:40~07:54 (예정)** | **daily-bars (T-117, 10-29 05:10~ 배포 목표)** | 감사 중 |
| **ET 08:00** (KST 21시, 서머타임 종료 후 22시), 평일 | **holdings-premarket (T-119, 10-29 15:40~20:00 배포 목표)** | 보유 미국 종목 SEC 확인, ET 날짜 기준 하루 1회, 스위치 `holdings_premarket_enabled`(키 없음=꺼짐) |

### 3. T-114 설계가 주기에 주는 영향 — 잡별 판정

| 잡 | 판정 | 근거 |
|---|---|---|
| 매매 감시 4종·strategy-eval·signal-*·portfolio-snapshot | **변경 없음** | T-114 는 기존 판단·주문 경로를 건드리지 않는다(설계서 §6.8, T-116 경계 시험). |
| news-fetch 국내 | **이미 변경됨**(T-115): 06:00 + 15:30 | 국내 분석(16:00)의 RAG 입력을 장 마감 직후로 맞춤. 15:30 은 분석 30분 전. |
| news-fetch 해외 | **변경 불필요(측정 뒤 재판정)** | 06:00 은 미국 마감(서머 05:00 / 11-01 이후 06:00) 직후·분석(08:00) 2시간 전이라 순서는 맞다. 다만 아래 §4 의 피드 창 실측이 있어 **ingest 를 더 자주 돌릴지**는 데이터가 쌓인 뒤 판정한다. ingest 횟수를 늘리면 분석 입력(RAG)이 달라져 **4주 관찰 기준선이 움직이므로** 사용자 결정이다. |
| news-peek (T-116) | **변경 확정 → T-118** | §4 — 사용자 위임 Q1: 해외 19슬롯 확대·피드별 겹침 검사·peek 재시도 1회/20초. 국내(10:01·13시)는 유지. |
| edgar-sync 07:00 | **변경 없음** | 설계서 §2.4: Fast Watch 보류, 하루 1회 유지. 대안(보유 한정 개장 전 체크포인트)은 단계 4 이며 조건부 — 그때 **새 잡**으로 추가. |
| research-cycle-overseas 07:00 · kis-fundamentals 08:00 · post-market-overseas 08:00 | **변경 없음** | 서머타임 종료(11-01) 후 미국 마감이 06:00 KST 가 돼도 07:00·08:00 은 모두 마감 이후다. |
| research-cycle-domestic 16:00 · post-market-domestic 16:00 · sync-stock-meta 17:00 · rs-update 17:30 | **변경 없음** | 15:30 마감·15:30 뉴스 수집 뒤. |
| broker-fills 07:20 · export-llm-trainset 03:00 | **변경 없음** | |
| **holdings-premarket (새, T-119)** | **신규: ET 08:00 평일** | 사용자 선택 B(설계서 §2.4·§7 단계 4). 서머타임 양쪽에서 맞도록 러너가 `TZ=America/New_York` 로 계산. 07:00 수집·08:00 분석 입력을 건드리지 않는다(`us_filings` 쓰기 없음). **T-104 의 스케줄 모델은 "ET 기준 시각"을 표현할 수 있어야 한다.** |
| **daily-bars (새, T-117)** | **신규: 07:40~07:54** | 미국 일봉 확정 = ET 16:30 = KST 05:30(서머) / **06:30(11-01 이후)**. 라우트 오프아워 창(05:10~08:30, 정각 앞뒤·07:55~08:10 제외)과 07시 틱의 무거운 잡(research·edgar·broker-fills) 뒤, 08:00 해외 분석 재시도 앞. 국내 봉은 전날 15:40 확정이라 같은 호출이 함께 처리(하루 지연). |
| ci-drain / ci-reconcile / ci-shadow (T-114 후속 단계, 아직 없음) | **자리 예약만** | 단계 1a: 드레인은 edgar-sync 뒤(07:30 대) 소량·재대사 하루 1회(새벽 03:30 제안). 단계 3 shadow 는 분석 뒤(해외 08:30 / 국내 16:30 — 둘 다 현재 비어 있음). 구현 task 가 접수될 때 Reviewer·QA 가 틱 예산으로 최종 확정. |

### 4. 새 사실 — 해외 피드 창이 짧다 (T-116 첫 캡처 실측, 2026-10-28 22:00 KST 단일 표본)

한 번의 peek 가 돌려준 기사의 발행 시간 폭: CNBC 약 18시간(30건) · Bloomberg 약 15시간(20건) · **MarketWatch 약 2.7시간(10건) · Yahoo 약 1시간(20건)**. 해외 peek 는 2·10·14·18·22시(4시간 격자)이므로 이 시간대에는 Yahoo·MarketWatch 기사가 **슬롯 사이에 피드에서 밀려나 못 잡힐 수 있다**. 한 시각 한 표본이라 시간대별로 다르다 `[추측]`(설계서는 17시대 MarketWatch 5.6시간을 측정). **결정(사용자 위임 Q1, 23:3x)**: 설계서가 스스로 정한 규칙(간격 ≤ 가장 짧은 피드 창의 절반)을 4시간 격자가 어기므로(독립 검토 H1) **T-118 로 해외 peek 를 매시 19슬롯으로 늘리고** 피드별 겹침 검사를 상태(`ci_capture_status:<시장>.feeds`)에 남기며 peek 의 M4 호출을 1회·20초로 줄인다(M4 장애 때 peek 틱 최악 약 284초 → 130초대). 비용은 호출당 약 2초·KB 쓰기 없음. 알림은 만들지 않는다. 서머타임 종료(11-01)로 미국장 시각이 KST 로 1시간 밀려도 peek 는 뉴스 발행 창 기준이라 시각 변경이 필요하지 않다. 06시 ingest(KB 적재, 하루 1회)는 **4주 관찰 기준선**이라 그대로 둔다.

### 5. T-104 에 미치는 구조적 영향 (이것이 진짜 변경점)

1. **하드코딩 블록이 늘고 있다**: 이번 주에만 `news-fetch-domestic-pm`(T-115)·`news-peek-*` 7슬롯(T-116)·`daily-bars`(T-117 예정)가 러너에 직접 박혔다. 설계서 J8("새 잡은 러너에 직접 박지 않고 T-104 잡 정의에 등록")은 T-104 가 늦어지는 동안 지킬 수 없었다 — 사용자가 즉시 효과를 승인했기 때문이다. T-104 1단계는 이 세 곳의 블록을 **흡수**해야 한다(동작·라벨·날짜파일 불변 원칙).
2. **스케줄 모델이 "하루 한 번 HH:MM" 만으로는 부족하다**: peek 는 "슬롯 목록(02·10·14·18·22)", 국내 15:30 은 "분 단위 창(15:30~15:59, 놓치면 건너뜀)", daily-bars 는 "창 07:40~07:54". 위 「C 설계」 3·4번(주기 잡 = 마지막 실행 + N분, 하루 잡 = 예정 시각 이후 && 오늘 미실행 && 지연 허용창)에 **시각 목록**과 **창(시작~끝)** 두 형태를 포함해야 한다.
3. **틱당 무거운 잡 상한이 필요해졌다**: 07시대에 무거운 잡이 4개가 될 예정(research-cycle-overseas·edgar-sync·broker-fills·daily-bars, 현재는 yield 규칙을 블록마다 손으로 씀)이고, 단계 1a·3 이 07:30대·08:30·16:30 에 더 얹힌다. 「C 설계」 4번의 "틱당 무거운 잡 1개 상한(나머지는 다음 틱)"을 일반화한 규칙이 하트비트 300초 안전의 핵심이다.
4. **서머타임**: 미국 관련 잡은 KST 고정 시각이 아니라 `America/New_York` 기준 계산이 맞다(T-114 §7 단계 1). 현재 잡들은 모두 마감 이후 시각이라 11-01 전후로 변경이 필요 없지만, 새 스케줄 모델은 "마감 + N분" 기준을 표현할 수 있어야 한다.

### 6. 결정 — **전부 확정**(사용자 원문 2026-10-28 23시대: "모두 권고안으로 작업 진행해줘. 이후 작업은 사용자 승인여부 묻지 않고 작업 진행하고 완료 후 결과 정리해서 리포팅해줘.")

| # | 결정 | 확정 내용 |
|---|---|---|
| E1 | 기존 잡 주기 | §3 의 "변경 없음" 판정 확정 |
| E2 | 해외 peek 간격 | **T-118 로 확대**(매시 19슬롯) — 측정 뒤 판정에서 즉시 확정으로 변경(독립 검토 H1) |
| E3 | 해외 ingest(KB) 횟수 | 06:00 하루 1회 유지(4주 관찰 중 — 11-23 경 재검토) |
| E4 | T-104 착수 순서 | **범위 C 설계 확정을 먼저**, 구현은 T-117·T-118·T-119 배포·1주 관측 뒤. 설계 확정에는 §5-2 스케줄 모델(시각 목록·창·마감/ET 기준)과 §7 충돌 방지 목록을 포함 |
| E5 | rs-update 해외판 | 추가하지 않음(사용자 확인 전 별도) |
| E6 | 잡별 새 주기 | §3 판정이 기본 스케줄(바꿀 것은 사용자가 말할 때) |
| E7 | edgar-sync 실패 시 재시도 창 | **스케줄 모델에 포함**(하루 한 번 잡의 "지연 허용창" 안 재시도) — 10-25 부분 실행·10-26 `HTTP=000`(Next 기동과 겹침)로 하루가 통째로 비는 일 방지. 구현은 T-104 1단계 |

보류된 사용자 게이트(착수 때 1회 묻는다): 설정 화면 토글 데모 면제 여부(WP5), M4 변경이 생길 때 push 승인, KIS 호출 확대.

### 7. 잘못 적용되거나 충돌되는 일을 막는 목록 (T-104 1단계가 반드시 지킬 것)

**7-1. T-104 가 흡수해야 할 러너 하드코딩 블록 (2026-10-28 현재)**

| 블록 | 만든 task | 상태 | 지켜야 할 불변 (시험이 문자열로 본다) |
|---|---|---|---|
| `news-fetch-split` (해외 06시·국내 다음 틱) | T-103 | 운영 | 라벨 `news-fetch-overseas`/`-domestic`, 날짜파일 시장별, 해외→국내 양보 |
| `news-fetch-domestic-pm` (15:30~15:59) | T-115 | 운영 | 라벨·날짜파일 `news-fetch-domestic-pm-last-date`, 16시 이후 skip 로그 |
| `news-fetch-peek` (슬롯 목록) | T-116 → T-118 | 운영(5슬롯) → 19슬롯 | 라벨 `news-peek-<시장>-<HH>`, 슬롯별 날짜파일, `PEEK_RAN_LABEL` 같은 틱 양보 |
| `daily-bars-daily` (07:40~07:54) | T-117 | 감사 중 | 라벨 `daily-bars`, 날짜파일 `daily-bars-last-date`, `CALL_MAX_TIME=120`, research/edgar/broker-fills 뒤 양보 |
| `holdings-premarket` (ET 08:00) | T-119 | 개발 중 | 라벨 `holdings-premarket`, 날짜파일(ET 날짜), 평일만, `CALL_MAX_TIME` |
| `broker-fills-daily` (07:20 이후) | T-087 | 운영 | 07시 두 잡 뒤 양보 |
| `post-market-overseas-retry` (08시, 10분×3) | T-062 | 운영 | 라벨·시험이 이 구간을 `eval` 한다 |

**7-2. 기본값(스위치 의미)이 서로 반대다 — 섞어 적용하지 말 것**

| 스위치 | 키 없음/읽기 실패 시 | 이유 |
|---|---|---|
| T-104 그룹 스위치 `cron_group_overseas_enabled`·`cron_group_domestic_enabled` | **켜짐**(fail-open) | 이미 켜져 있는 읽기 전용 수집·분석을 판독 실패로 멈추면 더 나쁘다 |
| `ci_capture_enabled`(T-116) · `holdings_premarket_enabled`(T-119) · 후속 `ci_events_enabled`·`ci_shadow_enabled` | **꺼짐**(fail-closed) | 새 기능은 명시적으로 켜기 전에는 아무것도 하지 않는다 |

**결정**: 해외 그룹에 속한 새 잡(해외 peek·holdings-premarket·daily-bars 의 해외분)은 **그룹 스위치와 자기 스위치가 둘 다 켜져야 실행**(AND)한다. 그룹이 꺼진 날 새 잡은 `skipped`(외부 호출 0)이고 `missing` 으로 세지 않는다.

**7-3. 겹치는 파일·작업 순서**

- `scripts/cron-runner.sh`: T-117·T-118·T-119 가 각자 다른 블록을 추가한다 → 배포는 T-117(10-29 05:10~) 먼저, T-118+T-119 는 그 위에서 합쳐 한 묶음(10-29 15:40~20:00). T-104 구현은 **이 세 개가 배포·관측된 뒤**에 시작한다(러너를 같은 주에 여러 번 갈아엎지 않는다).
- 설정 화면 `SettingsPage.tsx`: T-104 WP5(토글)와 T-108(문구·메뉴)이 겹친다 → T-104 먼저, T-108 은 그 뒤(통합 계획 `docs/design/2026-10-28-collection-menu-integrated-plan.md`).
- 실행 기록 `job_run_log`(J1): T-104 의 "판정 상태"·T-108 가동률·T-114 단계 1a 가 한 테이블을 쓴다 → 기록 지점은 러너 `call()` 사후 후크 1곳. 새 블록은 자기 라벨을 그대로 `job_id` 로 쓸 수 있게 이름을 바꾸지 않는다.
- DST(11-01): 미국장에 묶인 시각(holdings-premarket)은 ET 기준, 나머지 KST 고정 시각은 서머타임에 영향 없음(§3 판정). 새 스케줄 모델은 "마감 + N분"·"ET 시각"을 표현해야 한다.
- T-106(뉴스 0건 감시): peek 는 `recordNewsOutcome` 을 호출하지 않는다 — T-104 가 그룹 스위치로 잡을 건너뛸 때도 "꺼진 날 미기록"을 유지한다.

**7-3b. 날짜파일 쓰기 실패 (T-117 Codex 지적 → Reviewer 후속 L-5)**: 기존·신규 모든 하드코딩 블록은 `echo "$TODAY" > 날짜파일` 의 쓰기 실패를 감지하지 않는다(T-036 "호출했으면 성공·실패 무관 기록"). 호스트 전반 쓰기 실패면 하트비트도 갱신되지 않아 워치독이 알리지만, 그 파일 하나만 실패하면 같은 창 안에서 호출이 반복될 수 있다. T-104 1단계가 블록을 흡수할 때 "쓰기 성공 확인 + 같은 프로세스 안 당일 완료 표시 + 실패 시 오류 로그"를 **공통 함수로 한 번에** 넣는다(블록마다 따로 고치지 않는다).

**7-4. 이 문서의 어느 부분이 현재 계획인가**: 맨 위 ★ 절(§1~§7)과 「범위 C 확정」·「C 설계」·「단계 분할 권고」가 **현재 계획**이고, 「결정 필요 — 그룹으로 관리의 범위」(A/B/C 비교)와 「작업 내역(착수용 확정본 — 권고 B 기준)」은 **대체된 이력**이다.

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

## 범위 C 확정 (사용자 지시 10-28 14:2x) — 주기 설정 선행

사용자 지시(원문): "T-104의 범위는 C로 진행해주고 각 크론들의 주기를 설정한 후에 작업 진행하자". → 범위 **C = 그룹 스위치(B) + 각 잡의 실행 시각·주기를 DB 에서 설정**. 구현 전에 **사용자가 잡별 원하는 주기를 먼저 정한다**(아래 표). Leader 가 앞서 C 의 위험(러너의 DB 의존·시각 오설정 시 데이터 누락)을 한 번 고지했고 사용자가 C 를 선택했다 — 아래 설계는 그 위험을 구조로 막는 방향이다.

### 현재 주기 (러너 실측 — 모두 코드에 하드코딩)

| 구분 | 잡 | 현재 | 비고 |
|---|---|---|---|
| 분 단위 | entry-watcher · holding-checker · stop-alert | 매 틱(≈1분) | 매매 감시 — 안전 영역, **고정 권고** |
| | strategy-eval · trade-report | 5틱마다 | |
| | signal-followup | 15틱마다 | |
| | signal-expiry | 30틱마다 | |
| | portfolio-snapshot | 60틱마다 | 킬스위치 낙폭 계산의 입력 — **고정 권고** |
| 해외 | news-fetch(overseas) | 매일 06시 첫 틱 | |
| | edgar-sync · research-cycle-overseas | 매일 07시 첫 틱(같은 틱) | |
| | kis-fundamentals-snapshot | 매일 08시 | |
| | post-market(overseas) | 매일 08시, 실패 시 10분 간격 최대 3회 | 스위치 `post_market_overseas_enabled` |
| 국내 | news-fetch(domestic) | 매일 06시, 해외 다음 틱 | |
| | post-market(domestic) · research-cycle-domestic | 매일 16시(같은 틱) | |
| | sync-stock-meta | 매일 17시 | |
| | rs-update(domestic) | 매일 17:30 | 해외판은 예약 없음 |
| 공통 | broker-fills | 매일 07:20 이후(07시 두 잡 다음 틱) | 양보 규칙 |
| | export-llm-trainset | 매일 03시 | |

**실측으로 확인한 현재 동작의 성질 (설정 설계에 영향)**
- 분 단위 잡의 "N분마다"는 **시계 기준이 아니라 러너가 켜진 뒤의 틱 개수**(`i % N`)다. 한 틱 = 60초 sleep + 그 틱의 잡 시간이라 실제 간격은 N분보다 길고 러너 재시작마다 위상이 바뀐다. C 에서는 "마지막 실행으로부터 N분"으로 바꾼다.
- 하루 한 번 잡은 "해당 시(時)의 첫 틱"이 실제 시각이다(분 단위 지정은 broker-fills 07:20·rs-update 17:30 뿐). C 에서는 `HH:MM` 로 지정한다.
- 러너는 한 틱에 여러 잡을 순차로 부르고, 하트비트 감시(300초)가 있다. 러너 주석 계산상 한 틱의 무거운 잡 합계는 대략 **180초 안**이어야 한다 [러너 주석에서 도출 — 추측 포함]. 같은 시각에 무거운 잡을 몰아 넣으면 순찰이 러너를 재시작한다.
- 잡 사이 순서 의존: 뉴스 → (edgar·research) → broker-fills(양보 규칙), 해외 뉴스 → 국내 뉴스(양보), 해외 분석은 뉴스·실적 일정(edgar)이 먼저 있어야 의미 있음, 국내 분석은 장 마감(15:30) 이후, 해외 분석은 미국 정규장 마감(서머 05:00 / 표준시 06:00 KST) 이후.

### 잡 설명 (10-28 14:3x — 각 라우트 머리 주석·코드에서 확인, 확인 못 한 부분은 [추측] 표기)

| 잡 | 하는 일 |
|---|---|
| entry-watcher | 승인된 시그널의 진입 구간(price_zone)에 현재가가 닿았는지 감시해 자동 주문(`submitOrder`) 실행. 국내 장중(09:00~15:30)에만 동작. 매수는 검증 상태 관문(D5)·가용 현금 점검 뒤 |
| holding-checker | 보유 기간(holding_deadline)을 넘긴 포지션에 텔레그램 경고(알림만, 중복 방지로 기한 초기화) |
| stop-alert | 보유 종목 현재가가 사용자 정책의 예상 손절가에 닿으면 텔레그램 알림. **알림만** — 주문·매도·시그널 없음. 열린 시장의 보유 종목만 시세 조회 |
| strategy-eval | 등록된 전략 전체를 평가(`runAll`)해 시그널 생성 + 미체결 주문 상태 동기화(`syncPendingOrders`) |
| signal-followup | 24시간 후 가격변화 라벨이 갱신된 시그널을 지식베이스(Qdrant)에 재인덱싱(실패는 로그만) |
| signal-expiry | 유효기간(expires_at)이 지난 시그널의 상태를 `expired` 로 바꿈 |
| portfolio-snapshot | 잔고·환율을 조회해 포트폴리오 스냅샷 저장 + 변동성 가드·낙폭 킬스위치 평가(저장 뒤에만 실행). 양시장 마감+최근 스냅샷이 있으면 KIS 호출 생략 |
| trade-report | 매매 요약 리포트를 설정 채널(slack/telegram/both/none)로 전송. 실제 전송 간격은 라우트가 마지막 전송 시각으로 판단하는 것으로 보임 [추측 — 코드 일부만 확인] |
| news-fetch (해외/국내) | M4 지식베이스에 RSS 뉴스 적재(해외 4피드·국내 연합뉴스) — 분석의 뉴스 검색 재료 |
| edgar-sync | SEC EDGAR 읽기 전용 수집(공시·재무·실적 발표 일정). 해외 분석의 실적 일정 입력 |
| research-cycle-overseas / -domestic | 리서치 추적 종목의 급등·급락 사이클 패턴 재계산(해외는 미국 마감 뒤, 국내는 Yahoo 일봉) |
| kis-fundamentals-snapshot | KIS 해외 현재가상세 원값을 `us_fundamentals_snapshot` 에 저장(읽기 전용) |
| post-market-analysis (해외/국내) | 장 마감 후 일봉+뉴스를 AI 로 분석해 다음 세션 시나리오 시그널(카드) 사전 등록. 해외는 스위치(`post_market_overseas_enabled`, 10-28 켬)·휴장표·환율·실적 일정 확인이 필요하고 실패 시 하루 최대 3회·10분 간격 재시도 |
| sync-stock-meta | KIS KOSPI/KOSDAQ 마스터 파일로 종목 메타 테이블 전 종목 upsert |
| rs-update (국내) | RS 등급(0~99 상대강도 백분위) 갱신 — 분석 > 리더보드 화면에서만 쓰임 |
| broker-fills | 브로커 체결 원장 수집(KIS 읽기 전용 GET: 국내·해외 × 체결·기간손익·잔고), 알림 없음 |
| export-llm-trainset | 학습 데이터셋 내보내기 bash 스크립트(라우트 아님) |

러너에 호출이 없는 것: `daily-bars`(일봉 저장소 수집), `telegram-approval-selftest`, `rs-update?market=overseas`(라우트는 지원).

### C 설계 (구조로 막는 것)

1. **저장**: `system_config.cron_schedule`(JSON) — 잡 id → `{enabled, daily:'HH:MM'}` 또는 `{enabled, everyMin:N}` + 그룹 스위치 2개. **키가 없거나 깨지면 지금의 하드코딩 값(기본 스케줄)** 으로 동작 → 배포만으로 달라지는 것 없음, 키 삭제 = 원복.
2. **저장 시 서버 검증(거부 + 사유)**: 시각 형식·범위, 최소/최대 간격(안전 잡은 아예 설정 불가), **순서 규칙**(뉴스 ≤ 해당 시장 분석 −30분, edgar ≤ 해외 분석 −10분, 국내 분석 ≥ 15:40, 해외 분석 ≥ 06:30), **틱당 무거운 잡 합계 예산**(초과 조합 거부).
3. **러너 연동**: 러너가 틱마다(또는 N틱마다) `GET /api/cron/schedule`(cron-secret) 로 검증된 스케줄을 받아 **로컬 파일 캐시**(`~/.node-local/stockinvest/cron-schedule.json`, 원자적 교체)에 쓰고 `jq` 로 읽는다(서버에 jq 1.6 있음, 실측). 호출 실패 → 마지막 정상 캐시, 캐시 없음/깨짐 → 하드코딩 기본값. **DB·앱이 죽어도 러너 동작은 지금과 같다.**
4. **실행 판정**: 하루 한 번 잡 = "예정 시각 이후 && 오늘 미실행 && 지연 허용창(기본 60분) 안", 주기 잡 = "마지막 실행 + N분 경과". 틱당 무거운 잡 1개 상한(나머지는 다음 틱 — 지금의 양보 규칙을 일반화). 기존 양보·재시도(PMO 3회/10분)·라벨 문자열은 유지.
5. **설정 화면**: 그룹별 카드(ON/OFF + 시각/주기 입력 + 서버 검증 메시지). 신규 화면 요소이므로 **데모 게이트 대상**(delta 이상) — 단계 분할 권고.
6. **감사**: 변경 때마다 로그 한 줄(누가·무엇을·이전→이후)과 텔레그램 info 알림(선택).

### 단계 분할 권고 (Leader)

- **1단계(백엔드)**: 그룹 스위치 + 스케줄 저장·검증·`/api/cron/schedule` + 러너 캐시/판정 + 라우트 게이트. 설정은 API·SQL 로(화면 없음). 기본값 = 사용자가 정한 주기. → 데모 불필요, 먼저 배포·관측.
- **2단계(설정 화면)**: 위 5번. T-108 설정 개편과 같은 화면이라 순서를 맞춘다.

### 사용자에게 받을 것 — 주기 값

아래 두 가지를 알려 주세요(바꿀 것만, 나머지는 현재값 유지).
1. **잡별 새 시각/주기** — 예: "해외 news-fetch 06:00, 21:30 두 번", "국내 post-market 16:10". 하루에 여러 번 돌리고 싶은 잡이 있으면 알려 주세요(1단계는 하루 1회 또는 N분 주기만 지원하는 안, 하루 여러 시각은 주기 잡으로 표현 또는 2회 이상 시각 목록 지원 여부 결정 필요).
2. **분 단위 잡 중 설정 가능하게 둘 것**: Leader 권고 = 고정 {entry-watcher, holding-checker, stop-alert, portfolio-snapshot}, 설정 가능 {strategy-eval, trade-report, signal-followup, signal-expiry}(범위 예: 5~60분).

> ⚠ **이 절(B 기준 WP1~WP6)은 대체됐다.** 사용자가 10-28 14:2x 에 범위를 **C** 로 확정했고(위 「범위 C 확정」), B 의 그룹 스위치·구역 정리는 C 안에 포함된다. WP 번호·"러너 변경은 주석·구역 표시만" 같은 B 전제는 **현재 계획이 아니다** — C 설계(「C 설계」·「★」 §5·§7)를 따른다. 아래는 이력과 참고(그룹 소속·위험 표)로만 남긴다.

## 작업 내역 (착수용 확정본 — 권고 B 기준, 10-28 14:10 사용자 요청 "T-104작업 진행할 수 있도록 작업내역 정리해서 알려줘")

> 범위는 **B = 구조 정리 + 해외/국내 그룹 켜기·끄기 스위치**로 정리했다(권고안). 사용자가 "착수"를 말하면 이 내역대로 접수(Judge intake)부터 진행한다. 아래 "Leader 가 정한 점"은 사용자가 바꿀 수 있다.

### 목표 상태 (사용자에게 보이는 변화)

- 크론 잡이 **해외 수집 / 국내 수집 / 공통(매매 감시·원장·학습)** 세 구역으로 정리되고, 해외·국내 두 그룹은 각각 **ON/OFF 스위치**를 갖는다. 한 시장의 수집·분석만 멈추고 다른 시장은 그대로 돌 수 있다(예: 해외 수집이 고장 났을 때, 비용을 아끼고 싶을 때).
- **스위치가 없는 상태(기본)는 지금과 똑같이 전부 켜져 있다.** 배포만으로 동작이 바뀌지 않는다.
- 매매 감시 잡(entry-watcher·holding-checker·stop-alert·strategy-eval·signal-*·portfolio-snapshot·trade-report)과 broker-fills·export-llm-trainset 은 **그룹 스위치와 무관**하다(공통 구역).

### 그룹 소속 (러너 실측 기준 확정안)

| 그룹 | 잡(라우트) | 시각 |
|---|---|---|
| 해외 | news-fetch?market=overseas · edgar-sync · research-cycle-overseas · kis-fundamentals-snapshot · post-market-analysis?market=overseas | 06:00 · 07:00 · 07:00 · 08:00 · 08:00 |
| 국내 | news-fetch?market=domestic · post-market-analysis?market=domestic · research-cycle-domestic · sync-stock-meta · rs-update?market=domestic | 06:00 · 16:00 · 16:00 · 17:00 · 17:30 |
| 공통 | 위 목록에 없는 나머지 전부 + broker-fills(국내·해외 둘 다 읽음) | 변경 없음 |

`daily-bars` 라우트는 러너가 부르지 않는다(별도 실행) — 이 task 범위 밖. `rs-update?market=overseas` 는 라우트가 지원하지만 러너에 예약이 없다 — 이 task 에서 추가하지 않는다(별도 결정).

### Leader 가 정한 점 (바꾸려면 말씀)

1. **스위치 위치**: 러너(bash)가 아니라 **각 `/api/cron/*` 라우트가 시작할 때 DB 를 읽어** 판단한다. 이유: 앱은 이미 DB 를 쓰고 설정 화면 토글(T-101 방식)과 연결되며, 러너가 DB 에 의존하게 되는 위험(러너 정지)을 피한다. 러너의 시각·순서·하트비트 예산은 불변.
2. **키 이름**: `cron_group_overseas_enabled` · `cron_group_domestic_enabled` (`system_config`, JSON true/false).
3. **판독 규칙(중요 — T-101 과 반대)**: 키 없음·읽기 오류·해석 불가 = **켜짐**(fail-open). 이 잡들은 읽기 전용 수집·분석이고 지금 이미 켜져 있으므로, 판독 실패가 수집을 멈추는 것이 더 나쁘다. **끄려면 명시적으로 `false`(또는 문자열 "false"·0)를 저장해야 한다.** 해외 post-market 은 기존 `post_market_overseas_enabled`(기본 꺼짐)와 **둘 다 켜져야** 실행(AND).
4. **꺼진 그룹의 응답**: 인증(401)을 먼저 검사한 뒤 스위치를 읽고, 꺼져 있으면 `200 {ok:true, skipped:'group_disabled', group}` 과 로그 한 줄 `[cron-group] skipped group=… job=…` 로 끝낸다(외부 호출 0). 러너는 응답과 무관하게 그날 날짜 파일을 쓰므로(실측) **그날 다시 켜도 다음 날 정시부터** 돈다(급하면 수동 호출 안내를 문서에 둔다).
5. **T-106 연동**: 꺼진 그룹의 날은 뉴스 건수를 **기록하지 않는다**(0건으로 세어 경고가 오발하지 않게). 시험으로 고정.
6. **러너 변경은 주석·구역 표시만**: 호출 순서·시각·라벨(`news-fetch-overseas` 등, 시험 스크립트 3개와 순찰이 문자열로 보는 값)은 **바꾸지 않는다**. 처음 제안했던 `[ovs]`/`[dom]` 접두어와 블록 재배치는 07시 틱의 양보 규칙(broker-fills ← research/edgar)을 깨뜨릴 수 있어 하지 않는다.
7. **설정 화면 토글(B2)**: 설정 > 안전장치(공통) 카드에 T-101 과 같은 컴포넌트로 **ON/OFF 한 줄씩 2개**("해외 수집·분석", "국내 수집·분석"). 설정 API(`/api/settings/safety`)의 허용 키에 두 키 추가. 화면 변경이므로 데모 게이트 대상이다 — 사용자가 T-101 처럼 **데모 생략**을 말해 주면 생략(`check.mjs waive`, 원문 기록), 아니면 delta 데모 1장. T-108(메뉴·홈 개편)이 설정 화면을 다시 만지므로 **T-104 를 먼저 끝내고 T-108 이 그 위에서 시작**한다.

### 작업 패키지 (순서)

| # | 작업 | 파일(예상) | 역할 |
|---|---|---|---|
| WP1 | 그룹 정의 상수 `CRON_GROUPS`(잡 ↔ 그룹 표) + 스위치 판독기 + 시험(키 없음·true·false·"false"·0·깨진 JSON·DB 오류) | 신규 `src/lib/cron/group-switch.ts` + 시험 | Developer |
| WP2 | 라우트 게이트 10곳: news-fetch(시장별)·edgar-sync·research-cycle-overseas·research-cycle-domestic·kis-fundamentals-snapshot·post-market-analysis(시장별, 해외는 AND)·sync-stock-meta·rs-update(시장별). 각 라우트 시험: 꺼짐이면 외부 호출(KIS·SEC·M4·LLM) 0·인증 우선·켜짐이면 기존과 동일 | `src/app/api/cron/<8개>/route.ts` + `__tests__` | Developer |
| WP3 | 러너 구역 주석 + 그룹 표 머리말(동작 불변). 러너 시험 3개 재실행, news-split 시험 기준선 재설정(후속 후보로 적어 둔 것 처리) | `scripts/cron-runner.sh`, `scripts/test-cron-runner-news-split.sh` | Developer |
| WP4 | 정합 시험: `CRON_GROUPS` ↔ 라우트 게이트 호출 ↔ 러너 호출 경로가 일치(새 잡을 추가하고 그룹을 빼먹으면 시험이 깨짐) | 신규 시험 | Developer |
| WP5 | 설정 API 허용 키 2개 + GET 응답 필드 + 설정 화면 토글 2줄 + 시험 | `src/app/api/settings/safety/route.ts`, `src/app/settings/SettingsPage.tsx` + 시험 | Developer(데모 처리 후) |
| WP6 | 운영 문서: 켜고 끄는 방법(설정 화면·SQL), "그날 재개" 수동 호출, 그룹 표 | `docs/` 한 곳 + 이 task 최종 요약 | Leader |

### 절차·게이트

Judge intake(R2 예상: 크론 경로·무인 실행) → [WP5 만 데모 게이트: 생략 또는 delta] → Developer(격리 worktree, 로컬 디스크) → Reviewer(Sonnet, 2라운드 예상) → Judge C2 → **Codex(R2 필수)** → QA(Sonnet) → Leader 가 명시 경로 커밋(훅: `^src/app/api/cron/`·`^scripts/cron-runner\.sh$`·`settings/safety` 감시 → Reviewer 판정 줄의 scope 가 스테이징 파일을 모두 덮어야 함) → push(배포 창 05:10~08:30 · 15:40~22:20, 킬스위치 ON·최근 3시간 주문 0건 확인) → 관측(다음 06:00/07:00/08:00 해외 잡, 16:00/17:00 국내 잡이 정상 호출되는지 + 스위치를 한 번 껐다 켜 보는 스모크는 **사용자 승인 후**에만).

훅 감시 확인(`scripts/git-hooks/commit-msg` 실측): `^src/app/api/cron/`·`^src/app/api/settings/safety/`·`^scripts/cron-runner\.sh$` 는 **이미 감시**, 새 판독기 `src/lib/cron/group-switch.ts` 는 **감시 밖**이다 — 무인 실행 잡의 켜짐/꺼짐을 정하는 코드라 `SAFETY_PATHS` 에 `^src/lib/cron/` 추가를 권고한다(훅 파일도 감시 대상이라 별도 Reviewer 판정 줄이 필요, 이 task 의 WP 로 포함).

규모 [추측]: 변경 파일 약 25개(신규 3·수정 라우트 8·러너 1·설정 2·시험 약 11), T-106(Developer 2라운드·Reviewer 2라운드·Codex·QA)의 1.2~1.5배 토큰.

### 위험과 대비

| 위험 | 대비 |
|---|---|
| 게이트 버그로 **켜져야 할 잡이 멈춤**(조용한 수집 중단 — T-105 와 같은 유형) | fail-open 판독 + 시험 매트릭스 + 정합 시험 + 배포 후 첫 정시 호출 로그 확인. 꺼진 경우 로그 `[cron-group] skipped` 가 남아 원인 추적 가능 |
| 꺼짐을 잊어 장기간 수집 정지 | 꺼진 그룹이 있으면 설정 화면 토글에 표시되고, 후속 후보로 "꺼진 지 N일" 알림(이 task 범위 밖) |
| 같은 날 다시 켜도 다음 날부터 | 문서에 수동 호출 방법을 명시(WP6) |
| T-106 오탐 | 꺼진 날 미기록 시험(요구 5) |
| 설정 화면 충돌(T-108) | T-104 선행, T-108 은 그 뒤 |
| 러너 하트비트 예산(300초) | 라우트당 DB 읽기 1회 추가(수 ms), 러너 시각·순서 불변 |

### 사용자에게 받을 것 (착수 신호와 함께)

1. 범위 **B 확정**(또는 A/C 로 변경).
2. WP5 설정 화면 토글: **데모 생략** 여부(T-101 처럼 "데모 없이" 라고 해 주시면 생략 기록).
3. `post-market` 분석을 그룹에 포함하는 위 안(권고)으로 괜찮은지 — 다르게 하려면 말씀.

## 선행·연관

- T-103(뉴스 분리): 러너의 `news-fetch-split` 블록과 시험(`scripts/test-cron-runner-news-split.sh`·`test-cron-runner-pmo-retry.sh`)은 이 정리에서 구역 이동 때 같이 갱신해야 한다. 후속 후보로 적어 둔 "news-split 시험 기준선 재설정"을 여기서 처리한다.
- T-106(뉴스 0건 감시): 같은 날 배포 예정 — T-104 는 T-106 배포·관측 뒤에 착수한다(러너·cron 라우트를 같은 날 두 번 바꾸지 않는다).
- T-105(뉴스 반영 0건) 10-28 17:xx 발견 — **뉴스 수집 시각·건수가 분석에 쓸모 있게 맞아 있지 않다.** 06:00 하루 1회·limit 20(`news-fetch/route.ts` `NEWS_FETCH_LIMIT`)이라 국내 장중 기사(예: 10-28 11:04 SK하이닉스 배당 기사)가 16:00 분석에 들어올 수 없다. 이 task 에서 주기를 정할 때 "뉴스는 분석보다 30분 이상 먼저"만으로는 부족하고 **국내 뉴스는 장 마감 직후(예: 15:30)에, 건수는 피드 창(약 120건)에 맞춰 상향(M4 상한 100)** 하는 안을 같이 정한다(상세·근거 T-105 진행 기록 17:xx).

## 판단 기록 (judge)

## 진행 기록

- [10-28 13:0x] 접수·잡 목록 실측·범위 선택지 정리. 사용자 범위 결정 대기(A/B/C, 권고 B). 착수는 T-106 배포·관측 뒤.
- [10-28 19:2x] **T-115 로 일부가 먼저 적용됨**(사용자 "권고안대로 진행" D1): 국내 뉴스 15:30 추가 수집(러너 하드코딩 블록 `news-fetch-domestic-pm`, 날짜파일 `news-fetch-domestic-pm-last-date`)·시장별 수집 건수 100. 배포 `a16bc0c` 19:07. 이 task 의 잡 정의/스케줄 DB 화(단계 1)가 시작되면 이 하드코딩 블록과 T-116 의 peek 블록을 **흡수**한다(공동 인계서 J8). 사용자 주기 입력 목록의 국내 뉴스 항목은 `06:00 + 15:30` 으로 읽는다.

- [10-28 23:4x] **T-114 영향 현행화**(사용자 요청 "구조 변경으로 각 크론 주기 변경이 필요하지 않은지 현행화·확인"): 문서 맨 위 「★ T-114 이후 현행화」 신설 — 현재 잡 지도(`faf8bc3` 실측)·잡별 판정·새 사실(해외 피드 창 실측)·T-104 구조 영향·결정 E1~E6. 결론: 기존 잡 주기 변경 불필요, 새 잡 자리 배정(daily-bars 07:40)과 해외 peek 간격 1주 측정이 남은 항목. 코드 변경 없음.
- [10-28 23:3x] **2차 현행화**(사용자 위임 "모두 권고안으로 작업 진행" 23시대): ① 결정 E1~E7 전부 확정(§6) ② 해외 peek 확대 T-118·보유 종목 개장 전 확인 T-119·일봉 T-117 을 잡 지도·판정에 반영 ③ **§7 충돌 방지 목록**(흡수할 블록·스위치 기본값 반대 규칙(그룹 fail-open vs ci fail-closed, AND 결합)·파일/순서·DST) ④ 옛 B 계획(WP1~WP6)에 "대체됨" 배너. 코드 변경 없음. 수정 전 사본: scratchpad `t114/t104-pre-v2.md`.

## Developer

## Reviewer

## QA

## 배포 기록

## Codex 검토

## 최종 요약
