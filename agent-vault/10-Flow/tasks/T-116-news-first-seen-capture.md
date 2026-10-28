---
task_id: T-116
title: 뉴스 최초 관측 증거 캡처(단계 1b 앱 쪽) — 기사 메타를 ci_raw_item 에 영구 보존, 낮 시간 peek 수집, corp-intel 경계 시험
status: todo
priority: high
project: StockInvest
created: 2026-10-28
updated: 2026-10-28
base_ref: 5d4fdd1
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa, codex, deployer]
related_tasks: [T-114-corporate-intelligence-second-design, T-115-news-fetch-coverage-fix, T-105-news-rag-zero-hits, T-106-news-zero-streak-alert, T-104-cron-jobs-market-grouping]
external_tasks: ["home-m4-api task-009 (기사 메타 items·peek — 선행)"]
tags:
  - type/task
  - domain/data
  - domain/rag
aliases:
  - 뉴스최초관측캡처
waiting: [T-115 병합, M4 task-009 배포, migrate_approval]
---

# T-116 뉴스 최초 관측 증거 캡처 (설계서 단계 1b, 앱 쪽)

## 목표·배경 (Leader)

**한 문장**: 뉴스 기사마다 "링크·GUID·제목·발행시각·피드·**우리가 처음 본 시각**"을 StockInvest DB 에 영구 보존해, 나중에 사건·증거 계층(2차 설계 단계 2)이 쓸 수 있는 **되살릴 수 없는 증거**를 지금부터 쌓는다.

**왜 지금**: M4 KB 는 같은 본문이 다시 적재되면 `ingested_at` 이 덮어쓰기되고 URL·GUID·발행처를 저장하지 않는다([2차 설계서 §2.1·§4.1](../../../docs/design/2026-10-28-corporate-intelligence-second-design.md)). 최초 관측 증거는 하루 늦출 때마다 영구히 사라진다. SEC·KIS 는 `us_*` 테이블에 이미 보존되므로(공시는 `created_at` 최초 보존) **뉴스만 시급**하다 — 그래서 이 task 는 SEC/KIS 리더·작업 큐·재대사를 뺀 **최소 조각**이다(YAGNI: 소비자는 단계 2 에서 생긴다. 설계서 §7 단계 1 대비 의도적 축소).

## 사용자 지시·승인 (원문 보존 — 4D Diligence)

- 2026-10-28 18:1x: "D2에 대해서 푸시진행해주고 **나머지는 권고안대로 진행해줘**." — D2(M4 응답에 기사 메타·peek) 선행, D3(같은 DB `ci_` 접두어)·D5~D8 권고 채택. 이 task 는 D2 의 앱 쪽 + D3(`ci_raw_item`) + D8(`SAFETY_PATHS` 에 `^src/lib/corp-intel/` 추가).
- **이 지시가 허용하는 것**: 코드 구현·검증·DDL **파일 작성**. **허용하지 않는 것(별도 승인 필요)**: ① DDL **적용**(운영 DB 쓰기 — 개발·운영이 같은 NAS MariaDB) ② 스위치 `ci_capture_enabled` ON(운영 설정 쓰기) ③ KIS·SEC 신규 호출. 코드 배포는 DDL 미적용·스위치 OFF 에서 **무동작**이어야 한다(`tables_missing`·스위치 없음=꺼짐).

## 선행 조건

1. M4 `task-009` 배포(응답 `items`·`mode:"peek"`) — 앱은 `items` 가 없어도(구 M4) 오류 없이 건너뛴다.
2. T-115 병합(같은 `news-fetch/route.ts`·`cron-runner.sh` 를 건드린다 — 충돌 방지).

## 설계 (Leader — Developer 구현 사양)

**원칙**: 가산 전용. 기존 수집·분석·T-106 감시 동작 불변. 캡처 실패는 수집 결과·HTTP 응답·재시도·알림에 영향 0(예외 삼킴, 4초 상한 — `news-health.ts` 와 같은 패턴).

1. **DDL 파일** `scripts/migrations/T-116-ci-raw-item.sql` (적용 안 함 — 헤더 주석에 적용 방법·되돌리기·"앱 부팅에 넣지 않음" 명시, T-059 형식 따름). 테이블 `ci_raw_item` — 설계서 §5 의 초안 그대로(`source_kind ENUM('rss','sec_filing','sec_exhibit','kis_snapshot','earnings_calendar')`, `source_key VARCHAR(190)`, `version`, `content_sha256`, `availability ENUM('captured','historical_import','reconstructed')`, `published_at`, `first_seen_at`, `last_seen_at`, `url`, `feed_host`, `publisher`, `title`, `snippet`, `payload_ref`, `parser_version`, `run_id`, `UNIQUE (source_kind, source_key, version)`, 인덱스 2개). `run_id` 는 외래키 없는 nullable(공유 `job_run_log` 가 아직 없다). 시각 규약: `DATETIME` = KST 벽시계(T-046·T-059). 거래 테이블과 외래키 없음. 되돌리기 `DROP TABLE` 주석.
2. **모듈** `src/lib/corp-intel/`:
   - `keys.ts`: `rssSourceKey({feedHost, guid, link, title, publishedAt})` = `sha256(feedHost ∣ (guid 또는 link) ∣ title ∣ publishedAt)` 16진 — 순수 함수, 입력 정규화(공백 정리) 포함.
   - `raw-capture.ts`: `captureNewsItems(market, items, opts?)` — ① 스위치 `ci_capture_enabled`(system_config, **키 없음=꺼짐**, `post_market_overseas_enabled` 와 같은 관례의 기존 헬퍼를 찾아 재사용) 확인 ② 항목 검증(문자열·길이: title ≤ 400, guid ≤ 300, url ≤ 512, http/https 만, 발행시각은 ISO 해석 가능할 때만 `published_at`) ③ 한 번에 `INSERT … ON DUPLICATE KEY UPDATE last_seen_at = VALUES(last_seen_at)`(첫 관측 시각 `first_seen_at` 은 **절대 덮어쓰지 않는다**) ④ `first_seen_at`=`last_seen_at`=지금(KST 문자열, 기존 `toKstDatetime`) ⑤ `ER_NO_SUCH_TABLE` → 건너뜀 + 프로세스당 한 번만 경고 ⑥ 전체 4초 상한·절대 던지지 않음 ⑦ 반환 `{status:'ok'|'skipped_disabled'|'skipped_no_table'|'failed', inserted, duplicates, rejected}`. `availability` 는 항상 `captured`. 이 모듈은 거래·시그널·안전장치·거래소·전략 모듈을 import 하지 않는다.
   - `status.ts`(또는 같은 파일): 마지막 캡처 상태를 `system_config` 키 `ci_capture_status:<market>`(JSON `{lastAt, mode, fetched, inserted, duplicates, rejected, consecutiveFailures}`)에 기록 — T-106 `news_zero_streak:*` 와 같은 방식(관찰용, 캡처 공백 감시의 재료). 쓰기 실패는 삼킨다.
3. **라우트** `src/app/api/cron/news-fetch/route.ts`:
   - 쿼리 `?mode=peek` 허용(그 밖의 값은 `ingest`). **peek 이면** 스위치가 꺼져 있을 때 M4 를 호출하지 않고 `{ok:true, skipped:'capture_disabled'}`(200)를 돌려준다. 켜져 있으면 M4 요청 본문에 `mode:'peek'` 를 실어 보내고 응답 `items` 를 캡처한다.
   - **peek 응답은 `recordNewsOutcome({channel:'fetch'})` 에 넘기지 않는다**(M4 peek 는 `upserted: 0` 이라 T-106 수집 0건 감시에 거짓 경고가 난다 — 필수 시험). peek 실패는 기존 `news-fetch:<market>:failed` critical 알림을 내지 않고 로그 + `ci_capture_status` 의 `consecutiveFailures` 만 올린다.
   - **ingest(기존 06시·T-115 15:30)** 는 M4 응답에 `items` 가 있으면 캡처도 한다(동작·응답 형식·재시도·알림 불변).
4. **러너** `scripts/cron-runner.sh` 에 `peek` 블록(날짜파일은 시장·시각마다 따로, 성공·실패 무관 기록): 국내 `10:00`·`13:00`, 해외 `10:00`·`14:00`·`18:00`·`22:00`·`02:00`(KST). **근거**: 캡처 간격은 가장 짧은 피드 창(해외 MarketWatch 5.6시간, 국내 평일 낮 약 6.6시간)보다 짧아야 항목을 놓치지 않는다 — 해외 4시간 간격. 시각은 서머타임(2026-11-01 종료)과 무관하게 고정(간격 규칙만 지키면 됨). 하루 호출 수: 국내 2·해외 5 — peek 은 임베딩 없이 M4 가 피드 GET 만 하므로 가볍다. 각 블록은 **같은 틱에 무거운 블록이 없는 시각**이어야 한다(10시·13시·14시·18시·22시·02시 — 06·07·08·16·17시 블록과 안 겹침). 하트비트 최악 계산(약 276초 < 300초)을 주석으로 남긴다. 새 잡은 T-104 가 나중에 잡 정의로 흡수한다(J8) — 헤더 주석에 명시.
5. **훅 `SAFETY_PATHS` 추가(D8)**: `scripts/git-hooks/commit-msg` 에 `^src/lib/corp-intel/` 한 줄 + 근거 주석, `scripts/test-git-hooks.sh` 에 시나리오 추가(그 경로 스테이징 시 Reviewer 판정 줄 요구). `CLAUDE.md` 의 대분류 설명은 바꾸지 않는다(목록 정본은 코드).
6. **경계 시험** `src/lib/corp-intel/__tests__/isolation.test.ts` (`profit-engine/__tests__/isolation.test.ts` 패턴): ① corp-intel 은 `@/lib/{safety,signals,strategy,exchanges}`·주문·알림 모듈을 import 하지 않는다(DB·시간·`@/lib/time`·설정 헬퍼만) ② `src/` 의 corp-intel 참조자는 **허용 목록**(`app/api/cron/news-fetch/route.ts` 와 그 시험) 뿐 ③ corp-intel 의 쓰기 SQL 은 `ci_raw_item` 과 `system_config` 의 `ci_capture_status:*` 키뿐, DDL 없음.
7. **시험**: `keys.test.ts`(안정성·정규화·충돌 안 함), `raw-capture.test.ts`(스위치 off 무동작·테이블 없음·4초 상한·예외 삼킴·검증 거부·`first_seen_at` 보존 SQL 단언·중복), route 시험(peek 스위치 off → M4 호출 0 · peek 켜짐 → `mode:'peek'` 본문 · peek 는 `recordNewsOutcome` 미호출 · ingest 의 `items` 캡처 · 캡처가 던져도 응답·HTTP·재시도·알림 동일 · `items` 없는 구 M4 응답 정상), 러너 시험(peek 시각표·하루 1회씩·16시 post-market 틱과 안 겹침), T-106 기존 시험 불변.
8. **하지 않는 것**: SEC/KIS 리더, 작업 큐·드레인, 사건·식별, 공유 `job_run_log`, 화면, 점수 임계·질의(T-105 후보 E), 크론 스케줄 DB 화(T-104).

## 승인 게이트 (이 task 의 배포 순서)

1. 코드 배포 — DDL 미적용·스위치 OFF 에서 **무동작**(peek 블록은 `capture_disabled` 로 M4 호출 없이 종료). 배포 창·킬스위치 ON·최근 3시간 주문 0건 확인 뒤.
2. **사용자 승인 ①**: DDL 적용(`scripts/migrations/T-116-ci-raw-item.sql`, `CREATE TABLE IF NOT EXISTS` 1개, 되돌리기 `DROP`). 적용 전 사용자에게 스크립트 검토 요청.
3. **사용자 승인 ②**: `ci_capture_enabled` = true.
4. 첫 peek/ingest 뒤 `ci_raw_item` 행 수·`ci_capture_status`·T-106 키가 정상(거짓 경고 없음)임을 읽기 전용으로 확인.

## 관찰 기준선 영향 (공동 인계서 §10 대장)

판단 불변(기록 전용). 배포·스위치 ON 시각만 참고로 대장에 남긴다.

## 판단 기록 (judge)

## Developer

## Reviewer

## Codex 검토

## QA

## 배포 기록

## 최종 요약
