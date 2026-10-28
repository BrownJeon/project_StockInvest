---
task_id: T-119
title: 보유 종목 개장 전 공시 체크포인트(설계서 단계 4 대체안 "B") — 보유 미국 종목 한정, ET 08:00 하루 1회, 알림만
status: doing
priority: high
project: StockInvest
created: 2026-10-28
updated: 2026-10-28
base_ref: 0761fec
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa, codex, deployer]
related_tasks: [T-114-corporate-intelligence-second-design, T-116-news-first-seen-capture, T-118-overseas-peek-expansion, T-104-cron-jobs-market-grouping, T-100-holdings-loss-control]
tags:
  - type/task
  - domain/data
  - domain/cron
  - domain/risk
aliases:
  - 보유종목개장전공시
  - 단계4대체안B
waiting: []
---

# T-119 보유 종목 개장 전 공시 체크포인트 (설계서 단계 4 대체안 "B")

## 목표·배경 (Leader)

**한 문장**: 보유 중인 **미국 종목**에 대해, 미국 개장 직전(ET 08:00, 서머타임 중 KST 21:00 / 종료 후 22:00)에 하루 1회 SEC 에 새 공시가 있는지 확인하고, 있으면 텔레그램으로 **알려 주기만** 한다(주문·시그널·분석 입력과 무관).

**왜**: 현재 SEC 수집은 하루 1회 07:00 KST 라서 장 시작 전(BMO) 실적 8-K 는 접수 후 **10.4~12.0시간 뒤**(다음 날 07:00)에 관측된다(설계서 §4.8, 실측 n=6: 19:02~20:36 KST 접수). 이 늦음은 "개장 전에 알았다"는 H 경로(보유 관리)의 운영 효용을 해친다. 2차 설계 §2.4 가 Fast Watch(분 단위 감시)를 보류하고 대안으로 둔 **보유 종목 한정 개장 전 체크포인트(단계 4)** 가 이 task 이며, 사용자가 2026-10-28 에 "B" 로 선택했다.

**설계서 단계 4 의 진입 조건 완화(사용자 결정)**: 설계서는 "관문 Q 통과 + H 경로 효용 판단 + 호출량 합의"를 요구했으나, 이 안은 SEC 요청이 하루 약 5건이고 분석에 연결하지 않으며(알림만) 스위치로 끌 수 있어 관문 Q 통과를 기다리지 않는다는 것이 사용자 결정에 포함된다(Q2).

**하지 않는 것**: 분 단위·장중 폴링, 전체 52종목 조회, Fast Watch, `us_filings` 쓰기(07:00 수집과 08:00 분석 입력 불변 → 관찰 기준선 불변), LLM 호출, 주문·시그널·안전장치·킬스위치 변경, KIS 호출, 새 DDL, 새 pm2 프로세스, 국내 종목.

## 사용자 지시·승인 (원문 보존 — 4D Diligence)

- 2026-10-28 22:5x~23:2x(사용자 원문): "2. 결정사항에 대해서는 권고안대로 B로 진행해줘 작업 전에 기존의 겹쳐있는 작업들의 내역을 확인해서 통합해서 결정해야하는 사항있으면 미리 알려줘. 결정해버리고 쭉 진행하도록 해야해"
- 2026-10-28 23시대(사용자 원문, 정확한 시각 미기록): "모두 권고안으로 작업 진행해줘. 이후 작업은 사용자 승인여부 묻지 않고 작업 진행하고 완료 후 결과 정리해서 리포팅해줘."
- 위 "모두 권고안"의 대상은 Leader 의 결정 Q1~Q7(23시대 보고). 이 task 는 **Q2 (B 세부 일괄 승인)**:
  1. 실행 시각 ET 08:00 하루 1회(러너가 `America/New_York` 로 계산).
  2. **SEC 신규 호출은 보유 미국 종목 한정 하루 약 5건**(승인에 포함).
  3. `us_filings` 에는 쓰지 않는다 — 기록은 `ci_raw_item`(`source_kind='sec_filing'`)에만.
  4. 새 공시가 있을 때만 텔레그램 **정보 알림**, 주문·시그널과 무관. 연속 2일 실패하면 실패 알림.
  5. 새 라우트로 만들고, 스위치 `holdings_premarket_enabled`(키 없음 = 꺼짐)는 **배포 검증 직후 Leader 가 켠다**.
  6. 별도 SEC 호출 한도 장치는 만들지 않는다(07:00 수집과 시각이 겹치지 않음).
- **허용하지 않는 것**: 위에 없는 외부 호출(KIS·M4·LLM·SEC 의 다른 엔드포인트), 호출 횟수 증가, 알림 대상 확대, `us_filings`/분석/주문 경로 접촉.
- **Leader 가 지키는 선행 조건**: R2 → Reviewer → Judge C2 → **Codex 필수** → QA 통과 후 커밋 / 킬스위치 ON·최근 3시간 주문 0건 확인 / 배포 창 안.

## 설계 (Leader — Developer 구현 사양)

1. **라우트**: 신규 `POST /api/cron/holdings-premarket`(`checkCronAuth()` fail-closed, 인증 실패 시 아무것도 하지 않음). 스위치 `system_config.holdings_premarket_enabled`(JSON true 일 때만 켜짐, 키 없음·해석 불가 = 꺼짐 → `{ok:true, skipped:'switch_off'}`, SEC 호출 0). 본체 로직은 `src/lib/corp-intel/` 아래 신규 모듈(예: `holdings-premarket.ts`) — T-116 격리 규칙(거래·시그널·안전장치·거래소·전략 모듈 import 금지, 쓰기는 `ci_raw_item` 과 `system_config` 의 자기 상태 키뿐)을 지키고 `isolation.test.ts` 허용 목록을 필요한 만큼만 확장한다(보유 종목 읽기와 알림 발송은 라우트 층에서 하고 corp-intel 에는 순수 데이터로 넘기는 구조를 우선 검토).
2. **대상 = 보유 미국 종목**: 보유 목록은 **DB 의 가장 최근 포트폴리오 스냅샷**(60분 주기 저장)에서 읽는다 — **KIS 호출 금지**(stop-alert 는 KIS 로 읽지만 이 task 는 KIS 호출을 추가하지 않는다). 스냅샷 컬럼·형식과 미국 심볼(`NAS:`·`NYS:`·`AMS:` 접두 → 티커) 해석, 스냅샷이 너무 오래됐을 때(예: 3시간 초과)의 처리(건너뛰고 상태에 `stale_holdings`)를 Developer 가 코드에서 확인해 결정·보고. 보유 종목 수는 설계서 4개·공동 인계서 3개로 문서가 다르다 — 실제 DB 로 확인해 보고한다.
3. **SEC 조회**: 기존 `src/lib/data/us-edgar/sec-client.ts`(`SecClient`: 250ms 간격·차단 쿨다운·User-Agent 필수) 재사용. 종목당 `secSubmissionsUrl(cik)` **1회** — CIK 는 T-059 수집기가 쓰는 기업 테이블(`scripts/migrations/T-059-us-data-collector.sql` 의 회사 매핑)에서 읽는다. 총 요청 ≤ 보유 종목 수(약 3~5) + 안전 상한 8. 차단/쿨다운(`SecBlockedError`)이면 즉시 중단·상태 `blocked`. User-Agent 미설정이면 호출 0·상태 `no_user_agent`.
4. **새 공시 판정**: 제출 목록에서 **접수 시각이 최근 24시간 이내**이고 ① `us_filings` 에 그 접수번호(accession)가 없고 ② `ci_raw_item(sec_filing)` 에도 없는 것. 대상 양식은 8-K·10-Q·10-K·6-K·20-F·40-F·S-1·SC 13D/G 처럼 사용자가 알면 의미 있는 것으로 시작하되(Developer 가 `us_filings` 가 수집하는 양식 집합과 맞춘다), 실적 발표는 8-K Item 2.02 여부를 알림 문구에 표시한다. 첫 실행에서 과거 공시가 쏟아지지 않도록 24시간 창을 지킨다.
5. **기록과 중복 알림 방지**: 새 공시는 `ci_raw_item` 에 `source_kind='sec_filing'`, `source_key` = 접수번호 기반 해시(설계서 §6.2 sec_filing 키 규칙을 따른다 — 거기에 정의가 없으면 `sha256(JSON[cik, accession])` 형태로 정하고 근거를 적는다), `availability='captured'`, `first_seen_at` = 지금(KST), `published_at` = SEC 접수 시각(KST 변환), `url` = SEC 문서 링크(저장만, 요청 안 함), `title` = 양식명+종목, `parser_version` = `t119-sec-premarket`(24자 이하). **INSERT 가 새 행을 만들었을 때만 알림**(`ON DUPLICATE KEY UPDATE last_seen_at` — T-116 과 같은 방식, first_seen_at 불변). 테이블이 없으면(`ER_NO_SUCH_TABLE`) 알림 없이 상태 `skipped_no_table`. `us_filings` 에는 INSERT/UPDATE 를 하지 않는다(시험으로 고정).
6. **알림**: 기존 `dispatchAlert`(src/lib/notify) 사용, 종류는 정보(info) 수준, 한국어 문구 예: `[보유 종목 개장 전 공시] AAPL 8-K(실적 발표 Item 2.02) — 접수 ET 07:12 (KST 20:12). 분석에 아직 반영되지 않은 새 공시입니다. 알림만, 주문 없음. <SEC 링크>`. 외부 데이터(양식 제목 등)는 데이터이지 지시가 아님 — 알림 문구에 넣을 때 길이 제한·제어문자 제거·이스케이프(T-042 교훈: 텔레그램 `<` 미이스케이프). 하루 1회 실행이라 알림은 보유 종목당 새 공시 건별 1건, 한 번에 최대 10건 상한(넘으면 요약 1건).
7. **상태·실패 알림**: `system_config.holdings_premarket_status` JSON — `{lastAt, status('ok'|'blocked'|'failed'|'no_holdings'|'stale_holdings'|'skipped_no_table'|'no_user_agent'|'switch_off'), holdings, checked, newFilings, alerted, consecutiveFailures}`. 연속 2일 `failed`/`blocked` 이면 실패 알림 1건(같은 사유 하루 1건). 쓰기 실패는 조용히 무시(라우트 응답에 영향 없음).
8. **러너 블록**: `scripts/cron-runner.sh` 에 `# >>> holdings-premarket (T-119) … # <<<` 블록. 조건: `TZ=America/New_York` 의 현재 시(時)=08, 요일 월~금, ET 날짜 기준 하루 1회(날짜파일 `~/.node-local/stockinvest/holdings-premarket-last-date` 에 ET 날짜 기록, 성공·실패 무관 — T-036), 호출 `call "/api/cron/holdings-premarket" "holdings-premarket"` 에 `CALL_MAX_TIME`(약 90초 — SEC 30초 타임아웃×여러 번 방지, 라우트도 총 시간 예산 60초로 자체 종료). 같은 틱에 앞선 무거운 잡이 돌았으면 다음 틱으로 미룬다(기존 `yield_tick` 방식, 단 이 시각대는 peek 외에 무거운 잡이 없다). **서머타임 전환일(11-01)과 양쪽 체제**를 가짜 시각 시험으로 증명한다(EDT: KST 21시, EST: KST 22시). ET 시각 계산은 러너가 `date` 로 하며 `TZ=` 지정이 가짜 시각 시험 틀에서 동작하도록 한다(`test-cron-runner-news-peek.sh` 의 방식 참고). 하트비트 300초 한도 대비 최악 틱을 계산·시험.
9. **시험**: ① 라우트 jest — 인증 401, 스위치 꺼짐·키 없음에서 SEC 호출 0, 보유 0건 `no_holdings`, 오래된 스냅샷, 새 공시 → `ci_raw_item` 1행+알림 1건, 같은 공시 재실행 → 알림 0(`first_seen_at` 불변), 24시간 지난 공시 무시, `us_filings` 에 이미 있는 공시 알림 0, `SecBlockedError`/HTTP 오류/타임아웃 → 상태 갱신·연속 실패 알림, 알림 문구 이스케이프·길이, 테이블 없음, **`us_filings` 쓰기 0**, 요청 수 상한 ② corp-intel 모듈 시험 + 경계 시험(`isolation.test.ts`) ③ 러너 시험 새 스크립트 `scripts/test-cron-runner-holdings-premarket.sh`(가짜 시각·가짜 curl, EDT/EST 양쪽, 주말 건너뜀, 하루 1회, 오류 응답이어도 하루 1회, 하트비트 < 300초, 기존 모든 호출이 변경 전과 동일 — 추가만) ④ 기존 러너 시험·훅 시험은 기대값을 약화하지 않고 통과(새 호출이 기존 grep 에 섞이면 범위만 정교화, 근거 기록). 변이 시험(사본에서만): 스위치 무시·`us_filings` 쓰기·중복 알림·24시간 창 삭제·ET 시각 조건 삭제·날짜파일 미기록.
10. **훅**: `src/app/api/cron/` 와 `scripts/cron-runner.sh` 와 `src/lib/corp-intel/` 는 모두 SAFETY_PATHS — Reviewer 판정 scope 가 스테이징 파일을 모두 덮어야 한다.
11. **T-104 흡수 표시**: 러너 블록 머리 주석에 "T-104 단계 1 에서 잡 정의로 흡수, ET 기준 시각(America/New_York 08:00) 표현이 필요" 를 적는다.

## 배포·관측 계획 (Leader)

- T-118 과 **한 묶음** 배포(같은 `cron-runner.sh`): 10-29 15:40~20:00 KST 창(첫 실행 10-29 21:00 KST = ET 08:00 EDT), 늦으면 10-30 05:10~06:50. 킬스위치 ON·최근 3시간 주문 0건 확인. 이 push 에 밀린 문서 커밋이 있으면 함께 나간다.
- **배포 직후**: Deployer 확인(RELEASE_RESULT·pm2·health·cron 로그) → Leader 가 스위치 `holdings_premarket_enabled` = true 설정(승인 ⑤) → 첫 실행 관측(읽기 전용): cron 로그 `holdings-premarket OK`·`holdings_premarket_status`(holdings 수=실제 보유 확인)·`ci_raw_item` `sec_filing` 행·텔레그램 알림이 새 공시가 있을 때만 오는지·`us_filings` 불변·`entry-watcher` 매분 정상.
- 공동 인계서 §10 대장: **판단 불변(기록·알림 전용)**으로 배포·스위치 ON 시각만 남긴다.
- 롤백: 스위치 false(데이터 보존) 또는 러너 블록 `git revert`.

## 판단 기록 (judge)

- [2026-10-28 23:3x] intake engine=rules → risk=R2(`R2-kw-payment`) / developer_model=opus(`MD-judge-failed-opus`) / **next=demo_first, blocking_gate=demo(`DM-kw-risky-cta`)** | fallback=budget_window_closed | tokens=0 (판정 출력: scratchpad `judge-T-119-intake.out.json`)
- [23:3x] **Leader override: 데모 게이트 해당 없음(`demo_gate.required=false`, decided_by=leader).** 근거: 이 task 는 **새 화면·화면 구조 변경이 없다** — 백엔드 크론 라우트·러너 블록·텔레그램 알림 문구뿐이다. `DM-kw-risky-cta` 는 "알림·승인" 류 키워드 오탐이다(T-104 task 가 같은 이유로 `not_required` 기록). 알림 문구의 예시는 이 task 설계 6번과 최종 보고에 그대로 보여 준다. 데모 면제(waive)가 아니라 **게이트 대상 아님** 판정이다. 위험 R2 는 그대로(러너·cron 라우트·SEC 호출) → Reviewer → Judge C2 → **Codex 필수** → QA. developer 모델 opus 유지.

## Developer

- [05:05] 구현 완료(worktree `~/.node-local/stockinvest-t119`, base 0761fec, 미커밋). 10-28 밤 세션이 서버 정지로 끊겨 10-29 04:5x 재개 — 소스 sha256 을 확인해 변이 시험 흔적이 없음을 확인(route `71b5a6b2…`·모듈 `3f03cdb0…`·러너 `9b26a85b…`).
  - 신규 `src/app/api/cron/holdings-premarket/route.ts`(273줄): `checkCronAuth` fail-closed → 스위치(`holdings_premarket_enabled`, 키 없음·해석 불가 = 꺼짐, SEC 0) → `SEC_USER_AGENT` 없음 = `no_user_agent`(SEC 0) → 보유 = `portfolio_snapshots` 최신 1행(`ORDER BY ts DESC, id DESC`)의 `positions[].currency` 중 `NAS:|NYS:|AMS:` + qty>0(KIS 호출 없음), 없음·3시간 초과 = `stale_holdings`, 0건 = `no_holdings` → CIK = `symbol_cik_map`(매핑 없는 종목은 SEC 요청 없이 `unmapped`) → CIK 당 submissions 1회(`SecClient` 재사용, 요청 시간 10초) — 요청 상한 8(재시도 포함, 다음 CIK 는 `requestCount+2 ≤ 8` 일 때만 시작)·SEC 단계 40초·`SecBlockedError` 즉시 중단(`blocked`) → `parseSubmissions`(= `us_filings` 와 같은 양식 집합 KEPT_FORMS) → 새 공시만 `dispatchAlert('info')`(10건 초과면 요약 1건) → 상태 기록·연속 2회 failed/blocked 면 실패 알림(warning, ET 하루 1건). failed·blocked 는 HTTP 503(러너 로그에 본문), 나머지 200.
  - 신규 `src/lib/corp-intel/holdings-premarket.ts`(453줄): 스위치 판독(T-116 `captureSwitchValueEnabled` 재사용)·positions 해석·24시간 창 선별·`recordPremarketFilings`(① `us_filings` SELECT 만 ② `ci_raw_item(sec_filing)` 사전 SELECT ③ T-116 `CI_RAW_ITEM_UPSERT_SQL` 한 건씩 — 사전 SELECT 에 없고 affectedRows=1 일 때만 "새 공시")·알림 문구(제어·서식 문자 제거·길이 제한·`&<>` 이스케이프)·상태 `holdings_premarket_status`. notify·fetch·거래 모듈 import 없음.
  - `scripts/cron-runner.sh` +30/−0: 머리 잡 목록 1줄·날짜파일 선언 1줄(`holdings-premarket-last-date`, **ET 날짜**)·`# >>> holdings-premarket (T-119)` 블록(news-fetch-peek 블록 바로 뒤). 조건 = `TZ=America/New_York date '+%F %H %u %Z'` 의 시 08 · 요일 1~5 · %Z ∈ {EDT,EST}(tzdata 없으면 glibc 가 조용히 UTC 로 계산하므로 안 부름) · 날짜파일 ≠ ET 오늘. 같은 틱에 peek 가 돌았으면(`PEEK_RAN_LABEL`, EST 의 KST 22시 = 해외 22시 슬롯) yield_tick. curl 상한 `HP_CURL_MAX_TIME=90`(블록 안 상수). 날짜파일은 호출했으면 성공·실패 무관. 머리 주석에 "T-104 단계 1 에서 잡 정의로 흡수, ET 기준 시각(America/New_York 08:00) 표현이 필요".
  - 시험: 신규 route 시험 23건(가짜 풀·가짜 fetch·실제 SecClient/parseSubmissions/corp-intel)·모듈 시험 38건·러너 시험 `scripts/test-cron-runner-holdings-premarket.sh`(H0~H9) / 경계 시험 `isolation.test.ts` 허용 목록 최소 확장(+84/−5) / 기존 러너 시험 2개 **범위만 정교화**(news-split +12/−8 · news-peek +6/−3: holdings-premarket 호출을 비교 목록에서 빼고 정적 비교에서 그 블록·`HOLDINGS_PREMARKET_*` 선언을 뺌 — 기대값 변경 0, T-116 이 peek 에 했던 방식과 같음).
- [05:05] 재개 후 실행: `bash -n` 통과 · `npx tsc --noEmit -p .` exit 0 · `npx jest src/lib/corp-intel src/app/api/cron src/lib/data/us-edgar` **28 suites / 705 tests 통과**(04:5x, 락 지침 전). 러너 시험·훅 시험·변이 시험·전체 jest 는 Leader 지시(06:30 까지 무거운 시험 보류, flock 직렬)에 따라 보류 중 — 결과는 아래에 추가. 재개 전(10-28 밤) 결과는 다시 돌리기 전까지 근거로 쓰지 않는다.
- [05:05] 숨은 러너 가드 점검(grep): 러너를 읽는 시험은 `profit-engine/__tests__/isolation.test.ts`(daily-bars 금지만 — T-119 무관)·`broker-fills/__tests__/cron-runner-block.test.ts`("HEAD 대비 추가만" — T-119 는 추가만)·러너 시험 4개(pmo-retry 07:58~09:57·stop-alert 07:58+20틱은 21·22시를 지나지 않음). 새 러너 시험 스크립트는 SAFETY_PATHS 밖(`scripts/test-cron-runner-*` 는 목록에 없음).
- [05:13] **재개용 인수인계(서버 재기동 예정)** — 내 백그라운드 시험은 전부 종료함(06:30 대기 후 실행하려던 직렬 체인 취소, 시작 전이라 결과 로그 없음 = 미완/무효). 소스는 일관된 상태(편집 중 파일 없음), sha256 route `71b5a6b279e2…`·모듈 `3f03cdb0339d…`·러너 `9b26a85b40e7…`.
  - ① 구현: **완료**(라우트·corp-intel 모듈·러너 ET 08:00 블록·스위치·알림·상태·경계 시험 확장·러너 시험 신규·기존 러너 시험 범위 정교화 2개). 미완 = 시험 실행·보고뿐.
  - ② 실제 통과 확인(재기동 전 — 재실행 전까지 미검증 취급): 04:5x `bash -n scripts/cron-runner.sh` 통과 · `npx tsc --noEmit -p .` exit 0 · `npx jest src/lib/corp-intel src/app/api/cron src/lib/data/us-edgar` 28 suites / 705 tests 통과. 러너 시험 5개·훅 시험·변이·전체 jest 는 **이번 세션에서 끝까지 돈 결과 없음**.
  - ③ 재기동 후 순서(모두 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10 …`, 한 번에 하나, jest 는 `--maxWorkers=3` + `NODE_OPTIONS=--max-old-space-size=2048`): (a) `bash -n` · tsc · jest 범위(corp-intel·cron·us-edgar) (b) `bash scripts/test-cron-runner-holdings-premarket.sh` (c) news-split · news-peek · pmo-retry · stop-alert (d) `bash scripts/test-git-hooks.sh`(이 worktree index 만 씀) (e) jest 변이 10건(사본 디렉터리에서, 아래) (f) 러너 변이 5건(`T119_RUNNER=<변이 사본>`) (g) 전체 jest 1회 (h) sha256 로 원본 불변 확인 → 보고. 실행 스크립트는 scratchpad `t119/chain.sh`·`mutate-jest.py`(재기동으로 /tmp 가 지워지면 다시 만든다 — 내용은 이 절 ④).
  - ④ 변이: 10-28 밤(서버 정지 전) 사본에서 jest 변이 10건이 모두 잡혔다는 출력이 있었으나 **재실행 전까지 미검증**. 변이 목록 — M1 스위치 무시 · M2 `us_filings` INSERT 추가 · M3 중복에서도 알림 · M3b 사전 SELECT 무시(affectedRows 만) · M4 24시간 창 삭제 · M5 요청 상한 삭제 · M6/M6b 라우트·모듈에 `@/lib/exchanges/kis` import · M7 `us_filings` 존재 확인 생략 · M8 알림 이스케이프 제거 / 러너 R1 ET 시(08) 조건 삭제 · R2 요일 조건 삭제 · R3 날짜파일 미기록 · R4 peek yield 삭제 · R5 tzdata(%Z) 가드 삭제 — 러너 변이는 아직 한 번도 끝까지 돌지 않음.
  - ⑤ 질문·위험(보고에 상세): 보유 목록 = `portfolio_snapshots` 최신 1행(stop-alert 는 `position_state` 를 씀 — 둘이 다를 수 있음) · 양식 집합 = `us_filings` 의 KEPT_FORMS(8-K·10-Q·10-K·20-F·40-F·6-K 와 /A — 사양 예시의 S-1·SC 13D/G 는 빠짐) · `source_key` = 설계서 §6.2 대로 접수번호 원문(해시 아님) · 접수 시각 없는 공시는 후보 제외 · CIK 매핑 없는 보유 종목은 건너뜀(`unmapped`, 추가 SEC 요청 없음) · 10건 초과 시 요약 1건만 · 상한(요청 8·CIK 수)에 걸려 확인 못 한 종목이 있으면 `failed`(연속 2일이면 실패 알림) · 스위치 꺼짐도 상태 키에 `switch_off` 를 매일 기록 · 알림 발송 실패 시 행은 이미 기록돼 다음 날 다시 알리지 않음(24시간 창이라 유실) · 러너 yield 는 news-fetch-peek 블록의 `PEEK_RAN_LABEL` 에 의존(T-118 이 그 블록을 바꾸면 합칠 때 확인) · `test-cron-runner-holdings-premarket.sh` 의 정적 비교 기준 `T119_BASE_REF` 기본 0761fec — T-117/T-118 과 합친 뒤에는 "T-119 를 뺀 합본" 커밋으로 지정해야 한다.

## Reviewer

## QA

## Codex 검토

## 배포 기록

## 최종 요약
