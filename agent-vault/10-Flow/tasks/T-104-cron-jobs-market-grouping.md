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
waiting: [사용자 착수 신호(범위 B 확정·설정 화면 데모 생략 여부)]
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

## 판단 기록 (judge)

## 진행 기록

- [10-28 13:0x] 접수·잡 목록 실측·범위 선택지 정리. 사용자 범위 결정 대기(A/B/C, 권고 B). 착수는 T-106 배포·관측 뒤.

## Developer

## Reviewer

## QA

## 배포 기록

## Codex 검토

## 최종 요약
