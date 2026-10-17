---
task_id: T-045
title: post-market 시나리오가 주말에도 돌아 같은 거래일용 카드를 중복·모순되게 만든다 — 주말 스킵 + 중복 INSERT 방지
status: in-progress
priority: high
roles_involved: [leader, developer, reviewer, qa]
related_tasks: [T-042, T-043, T-021]
tags:
  - type/task
  - domain/signals
  - domain/strategy
  - domain/safety
aliases:
  - post-market 주말 중복
  - post-market weekend duplicates
created: 2026-10-17
updated: 2026-10-18
---

# T-045 — post-market 주말 중복 카드

## 사실 (2026-10-17 읽기 전용 실측)

- 월요일(10-19)용 매수 카드가 **같은 종목으로 2장씩** `pending` 이었다: 현대차 `005380` = 19077(금 10-16 16:01) + 19100(토 10-17 16:02), 신한지주 `055550` = 19078(금) + 19099(토). 일요일 16:00 에 3번째 세트가 예상됐다.
- 원인 코드: `src/lib/strategy/post-market-engine.ts` 의 `INSERT INTO signals` 가 같은 `(symbol, side, valid_from)` 의 기존 카드를 확인하지 않는다. 종목 중복 제거(`deduped`)는 **한 번의 실행 안**에서만 한다. `scripts/cron-runner.sh` 는 국내 post-market 을 "매일 16:00" 호출하고(주말 포함), `nextTradingDayOpen()` 은 금·토·일 모두 월요일을 돌려준다.
- 같은 금요일 종가로 다시 분석해도 **LLM 출력이 달라** 카드 내용이 모순된다: 005380 신뢰도 75→60·구간 310000~314000→310000~315000, 055550 구간 92500~93500→93000~95000.
- 둘 다 승인하면 같은 종목 매수가 두 번 나간다(카드당 `amount_krw` 10만 고정). T-043(entry-watcher 주문 전 선점 없음)과 겹치면 위험이 커진다.
- 이 엔진은 사실상 국내 전용이다(`loadSymbols('overseas')` 는 항상 `[]`, INSERT 에 `'domestic'` 고정). 해외 호출은 매일 `no_symbols` 로 끝난다.
- 엔진 테스트가 없다.

## 사용자 결정 (2026-10-17 "a,c 진행해줘")

- **A**: 수정 task 를 만든다 — 주말 스킵 + 같은 종목·방향·valid_from 중복 방지. (※ 구현 중 독립 감사 R-1 로 "비거래일(공휴일 포함)" 스킵을 **"주말(KST 토·일)만"** 스킵으로 좁혔다. 아래 설계 1번 참고.)
- **C**: 이미 생긴 중복을 정리한다 — **완료**(아래 Leader 기록).

## 범위

| 포함 | 제외 (별도로 기록) |
|---|---|
| ① 국내 post-market 을 **주말(KST 토·일)에는 실행하지 않는다** — 새 종가가 없으므로 재실행은 모순된 카드만 만든다. **평일 공휴일은 건너뛰지 않는다**(독립 감사 R-1: `nextTradingDayOpen()` 이 공휴일을 건너뛰지 못해, 공휴일 당일 실행이 그 다음 거래일용 카드를 만드는 유일한 실행이다) ② INSERT 를 `INSERT … SELECT … WHERE NOT EXISTS (같은 symbol·side·valid_from·scenario_source)` 로 바꿔 **이미 있으면(상태 불문) 만들지 않는다** ③ 결과·로그에 건너뜀 사유 표시 ④ 테스트 | `nextTradingDayOpen()` 이 **공휴일을 건너뛰지 않는 기존 한계**(주말만 건너뜀) · 해외 시장 처리 · 유니크 인덱스(마이그레이션은 사용자 승인 사항) · T-043 · T-044 |

## 설계

1. **주말 스킵**: `runPostMarketAnalysis('domestic')` 맨 앞에서 `isWeekendKst(new Date())`(epoch+9h → `getUTCDay`, DB·공휴일 목록을 쓰지 않는 순수 함수)가 참이면 심볼·시세·RAG·LLM·DB 호출 없이 `skipped: 'weekend'` 로 즉시 반환. 해외는 변경하지 않는다. *(초안은 `isTradingDay`(공휴일 포함)였으나 R-1 로 교체 — 공휴일 다음 거래일에 카드가 0장이 되는 구조 결함.)*
2. **중복 방지**: `INSERT … SELECT … FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM signals WHERE symbol=? AND side='buy' AND valid_from=? AND scenario_source='post-market')`. `affectedRows === 0` 이면 중복으로 세고 `signalsSkipped` 에 더한다. **상태를 가리지 않는다** — 사용자가 거절·대체한 카드가 같은 `valid_from` 으로 다시 살아나지 않게 한다.
3. **잔여 위험(문서화, Codex C2·Reviewer 실험으로 정정)**: 같은 `(symbol, valid_from)` 을 두 실행이 **동시에** 삽입하는 경우 — 운영 격리수준 **REPEATABLE READ 에서는 한쪽이 0행 차단되거나 오류(MariaDB 1467 / MySQL 1213)로 끝나 중복이 남지 않았다**(Reviewer 가 일회용 MariaDB 10.11 에서 같은 문장으로 300회 반복, 중복 0/300). **READ COMMITTED 로 바뀌면 300/300 이 중복**된다. 즉 지금의 방어는 구조적 유일성이 아니라 **격리수준에 기대는 방어**다. 구조적 해결은 유니크 인덱스(마이그레이션=사용자 승인 사항, 이번엔 하지 않음). 겹침 자체가 비정상 사건이다: `stockinvest-cron` 은 pm2 1개, 수동 호출은 `CRON_SECRET` 필요, 러너가 16시대에 재시작되면 같은 날 두 번 호출될 수 있다(날짜 파일은 호출 종료 후 기록).
   - **운영 조건**: DB 전역 격리수준을 READ COMMITTED 로 바꾸지 않는다 — 바꾸는 순간 이 방어가 조용히 사라진다.
   - **신호**: 응답 `errors` 나 로그에 `insert_fail` 이 보이면 겹침 실행의 신호로 취급한다(정상 실행은 한 연결이 순차로 보내므로 해당 없음).
   - **순서 게이트**: 카드를 실행 가능하게 만드는 수정(T-046)은 **유니크 인덱스(또는 직렬화)가 먼저 또는 같이** 배포되지 않으면 내보내지 않는다 — 그 순간부터 중복 카드가 이중 매수 후보가 된다. (지금은 카드가 실행되지 못해 노출이 사실상 0.)

## 시험

- 토·일이면 심볼 로드·시세·RAG·LLM·INSERT 가 호출되지 않는다 / 평일(**공휴일 포함**)이면 기존대로 진행하고 다음 거래일(월)용 `valid_from` 을 만든다 / `isWeekendKst` 경계(KST 자정, UTC 날짜가 다른 시각).
- 중복이면 카드 수가 늘지 않고 `signalsSkipped`·`duplicatesSkipped` 에 반영된다. 새 카드는 만들어진다. 파라미터 순서·SQL 형태 고정.
- 실제 DB 에서 SQL 문법·의미 검증(롤백되는 트랜잭션, 가짜 종목).
- 변이: 주말 검사 제거·시장 뒤집기·토/일 한쪽만·KST 변환 제거·공휴일 회귀 모사 / NOT EXISTS 의 각 조건 제거·상태 조건 추가·strategy_id 비교·대상 테이블 교체 / 삽입 리터럴 변경 / 카운터 변경 시 테스트가 실패해야 한다.

## 롤아웃

1. 일요일(10-18) 16:00 **전에** 배포한다(push = 배포). 못 하면 일요일 실행 뒤 중복을 다시 정리한다(`superseded`).
2. 배포 뒤 **토·일에 라우트를 한 번 호출**해 스킵 경로를 확인한다 — 기대값은 `skipped:"weekend"`·`signalsCreated:0`(LLM·INSERT 없음 — 안전). 평일 공휴일은 정상 진행(`skipped` 없음)이 의도다. 거래일 경로는 월요일 16:00 실행으로 확인(월요일 실행의 `valid_from` 은 화요일이라 중복 차단 로그가 없는 것이 정상).
3. 롤백: 이전 릴리스로 되돌린다. DB 변경 없음.

## Leader 기록

- [10-17 22:5x] 사용자 "a,c 진행해줘". judge 접수(`judge-result@2`): **R2** · 복잡도 1.35 · developer=opus · 데모 불필요. 관련 승인 교훈 없음(`/이슈기록 관련 domain/signals`).
- [10-17 22:5x] **C 완료**: 19099(055550)·19100(005380) 을 `status='superseded'` 로 갱신(조건부 `WHERE id IN (…) AND status='pending'`, affectedRows 2). 금요일 카드 19077·19078 은 `pending` 유지(005380 은 금요일 신뢰도가 높음 75 vs 60, 055550 은 신뢰도 동일해 원본 유지). `rejected` 가 아니라 `superseded` 를 쓴 것은 승인율 통계에 거절로 섞이지 않게 하려는 것이다. 백업 `backup-signals-19099-19100.json`(세션 scratchpad) · 되돌리기: `UPDATE signals SET status='pending' WHERE id IN (19099,19100) AND status='superseded'`.
- [10-17] 작업 트리에 **다른 세션의 미커밋 변경**(T-044 관련 `service.ts`·`approval-notify.ts` 등)이 있다. 이 task 의 커밋은 T-045 파일만 스테이징한다.

## Developer

- [10-17] **변경 파일(2개)**: `src/lib/strategy/post-market-engine.ts`(수정) · `src/lib/strategy/__tests__/post-market-engine.test.ts`(신규, 14개).
- [10-17] 엔진: ① import 에 `isTradingDay`(`@/lib/reports/trading-day`), 타입 import 를 `mysql2` → `mysql2/promise`(`Pool`) ② `PostMarketResult` 에 선택 필드 `duplicatesSkipped`·`skipped` ③ `runPostMarketAnalysis` 맨 앞(국내만)에서 `isTradingDay(new Date())` 거짓이면 심볼·시세·RAG·LLM·INSERT 없이 `skipped:'non_trading_day'` 반환, 판정이 예외면 `trading_day_check_fail:` 을 기록하고 **계속 진행** ④ 새 export `insertScenarioCardIfAbsent(pool,row)` — `INSERT … SELECT … FROM DUAL WHERE NOT EXISTS(symbol·side='buy'·valid_from·scenario_source='post-market', 상태 불문)`, `affectedRows` 로 `created`/`duplicate` ⑤ 엔진 INSERT 를 이 함수로 교체, 중복은 `duplicatesSkipped`·`signalsSkipped` 에 더하고 로그.
- [10-17] 검증(Developer 측): 신규 14개 통과 · **변이 11개 전부 검출**(비거래일 검사 제거/시장 뒤집기/판정 실패 시 막기/NOT EXISTS 각 조건 제거/affectedRows 뒤집기/건수 미보고 등, 파일 복원 해시 일치) · `tsc --noEmit` 0 · 전체 jest 142 suites/2,892 · 훅 시나리오 통과. **실제 DB 검증**(롤백되는 트랜잭션, 소스에서 꺼낸 SQL 그대로): 기존 카드 → 0행, 새 종목 → 1행, 같은 키 재삽입 → 0행, 기존 카드를 `rejected`/`superseded` 로 바꿔도 0행(상태 불문), 다른 `valid_from` → 1행(다음 거래일 카드는 막지 않음); 롤백 뒤 행 수 19,075 동일·19077 `pending`·19100 `superseded` 그대로.
- [10-17 23:4x] **2차 변경 (독립 감사 R-1 반영)**: 스킵 조건을 `isTradingDay`(공휴일 포함·DB) → `isWeekendKst`(토·일만, 순수 함수)로 교체, `isTradingDay` import·try/catch·`trading_day_check_fail` 제거, `skipped` 값 `'non_trading_day'` → `'weekend'`. 테스트 14 → 20개로 갱신(경계 7·주말 스킵 5·평일 공휴일 진행 회귀·SQL 전체 고정 R-3). 검증: 20/20, `tsc` 0, 변이 23개 전부 단언 실패로 검출(R-3 에서 생존했던 상태 조건 추가·strategy_id 비교·orders 테이블·삽입 리터럴 변경 포함), 파일 복원 해시 일치. 위 "변경 파일"·"엔진"·"검증(Developer 측)" bullet 은 **1차 구현의 이력**이다(현재 동작은 이 bullet 과 설계 1번).
- [10-17] **알려진 한계(범위 밖, 이미 존재)**: ① `nextTradingDayOpen()` 은 주말만 건너뛰고 공휴일을 무시 — 공휴일 전날 실행은 휴장일용 카드를 만든다 ② 동시에 같은 키를 넣는 두 실행은 둘 다 통과할 수 있음(유니크 인덱스 없음, 마이그레이션=사용자 승인) ③ 해외는 종목이 없어 사실상 미사용.

## 1라운드 감사 기록 (superseded)

> 2026-10-17 23:24~23:32 1라운드(isTradingDay 기반 비거래일 스킵 코드) 감사 기록. 이후 Leader 가 R-1 을 받아들여 스킵 조건을 주말 한정으로 바꿨고, 2라운드(아래 Reviewer 절)가 이 판정을 대체한다. 이 라운드의 판정은 현재 코드에 적용되지 않는다. R-2(만료 시각 9시간 오류)·R-4 설명은 여전히 유효하다.


- [23:24] **방법·범위 (Developer 서술을 믿지 않고 코드로 직접 확인).** 읽은 것: `post-market-engine.ts` 전체와 `git diff HEAD`, `reports/trading-day.ts`, 라우트 `cron/post-market-analysis/route.ts`, `scripts/cron-runner.sh`, `ecosystem.config.js`, `signal-expiry`·`entry-watcher` 라우트, 테스트 파일 전체, `commit-msg` 훅의 판정 파싱. 직접 실행한 것: 대상 테스트 14/14 통과, `tsc --noEmit` exit 0, 전체 jest 142 suites / 2,892 tests 통과, 스크래치패드 복사본에서 변이 25개, 날짜별 시뮬레이션(실제 `isTradingDay` 연결), 운영 DB **읽기 전용 SELECT** 만. 확인하지 못한 것: INSERT 자체의 실행(운영 DB 쓰기 금지 지시 — Developer 의 롤백 트랜잭션 기록을 재현하지 않았고, 대신 같은 NOT EXISTS 술어를 SELECT 로 실제 데이터에 대 보았다), 동시 실행 실험, 외부 공식 달력 대조.
- [23:24] **원본 무결성.** 변이는 전부 `scratchpad/mut/` 복사본에서만 돌렸다. 두 파일 sha256 이 변이 전후 동일: 엔진 `fea01b95…55cf`, 테스트 `ce4a1666…15d6`. 코드·테스트는 한 글자도 수정하지 않았다.
- [23:25] **[확실] 비거래일 판정 정확성(항목 1).** `isTradingDay` 는 `new Date()` 의 epoch 에 +9h 를 더해 UTC 필드로 읽으므로 서버 TZ 와 무관하게 KST 날짜를 본다(서버는 KST 이기도 하다). cron 은 `HH==16` 인 시각대에만 호출하므로 16:00~16:59 KST = 07:00~07:59Z, UTC 날짜와 KST 날짜가 같다. 자정 직후 지연 실행은 cron 경로로는 불가능하다(`HH` 가 16 이 아니면 그날 국내 post-market 은 아예 안 돈다). 수동 호출을 토요일 자정 이후에 하면 금요일 데이터용이어도 스킵되는데, 이는 의도된 동작이다. 엔진이 `new Date()` 를 두 번(월요일 계산, 판정) 부르는 것은 16시 실행에서 영향 없음.
- [23:25] **[확실] fail-open 은 안전하고, 사실상 죽은 방어.** 주말·정적 공휴일 판정은 DB 를 쓰지 않는다(`trading-day.ts` 95~101행). DB 를 읽는 것은 `report_extra_holidays` 뿐이고 `fetchExtraHolidays` 가 모든 오류를 삼켜 빈 집합을 돌려주므로(69행) `isTradingDay` 는 실질적으로 던지지 않는다. 따라서 엔진의 `try/catch`(`trading_day_check_fail`)는 동적 import 실패 같은 비정상 경우에만 닿는다 — 무해하나 "DB 장애 시 fail-open" 서술은 정확히는 "DB 장애가 판정을 바꾸지 못한다(주말은 DB 무관)"이다. 운영 `report_extra_holidays` 값은 읽기 전용 조회로 `[]` 임을 확인했다. 두 번째 방어선(NOT EXISTS)은 같은 (종목·valid_from) 충돌만 막고, "금요일엔 SKIP 이던 종목을 토요일에 BUY" 같은 모순은 못 막는다 — 그러나 주말 판정이 DB 에 의존하지 않으므로 그 경로는 열려 있지 않다.
- [23:26] **[확실] 거래일 오스킵(false skip) 경로 — 미래 날짜 기준 없음, 단 아래 R-1 의 구조적 부작용이 있다.** 정적 목록의 오늘(10-17) 이후 항목은 2026-12-25 와 2027-01-01 뿐이고 둘 다 실제 휴장이다. 거래일인데 건너뛰는 직접 경로는 못 찾았다. 반대로 비거래일인데 도는 경로(false run)는 `HOLIDAYS_KR` 에 없는 휴장일(대체공휴일 등)이 남아 있다 — 아래 R-6. 단, 실측으로 false run 은 해롭지 않다(휴장일 H 의 실행은 H+1 용 카드를 만들고 이는 정당한 카드이며, H 용 카드는 전날 실행이 이미 만들었으므로 키가 달라 충돌하지 않는다).
- [23:27] **R-1 (MEDIUM, 권고·후속 task) — 평일 공휴일 다음 거래일에 카드가 한 장도 안 생긴다.** 원인: 스킵은 "오늘이 비거래일"을 보지만 `nextTradingDayOpen()` 은 공휴일을 건너뛰지 않는다(task 가 범위 밖으로 둔 기존 한계). 둘이 결합하면, 공휴일 H 전날 실행은 휴장일 H 용(쓸모없는) 카드를 만들고, H 당일 실행은 이제 스킵되므로 H 다음 거래일용 카드를 만드는 실행이 사라진다. 이전에는 H 당일 실행이 그 카드를 만들었다. 재현(복사본 엔진 + 실제 `isTradingDay`, 16:02 KST 고정, `validFrom` 출력): 12-24(목) RUN → validFrom 12-25(휴장) · 12-25(금) SKIP · 12-26(토) SKIP · 12-27(일) SKIP · 12-28(월) RUN → validFrom 12-29. 즉 **월요일 12-28 용 카드가 없다.** 2027-01-01(금) → 2027-01-04(월)도 동일. 테스트 `한글날(금요일) 스킵`이 이 동작을 정답으로 못박고 있다. 자금 방향으로는 안전(주문이 줄어들 뿐)하고 첫 발생일은 12-25 이므로 이번 배포를 막을 사유는 아니다. 그러나 Developer 기록의 "알려진 한계 ①(공휴일 전날 실행은 휴장일용 카드를 만든다)"은 이 결합 효과를 과소 서술한다 — task 문서의 한계 서술을 정정할 것. 해결 후보(Leader 결정): (a) `nextTradingDayOpen` 을 같은 공휴일 목록으로 건너뛰게 고친다(이러면 공휴일 스킵이 정확히 맞아진다, 근본 해결), (b) 임시로 스킵을 토·일에만 적용하고 평일 공휴일은 실행하되 NOT EXISTS 에 맡긴다(공휴일 H 실행의 키는 H+1 이라 충돌하지 않음). 늦어도 2026-12-24 이전에 둘 중 하나를 결정할 것.
- [23:27] **R-2 (MEDIUM, 이 task 범위 밖의 신규 발견 — 별도 task 권고) — 시나리오 카드의 `expires_at` 가 개장 전(06:30 KST)이라 어떤 카드도 실행될 수 없어 보인다.** 근거 [확실, 직접 조회]: `nextTradingDayOpen/Close` 는 "09:00 KST = 00:00 UTC" 가정으로 UTC 필드를 만든 뒤 `toISOString()` 문자열을 KST 로 운영되는 DATETIME 에 그대로 넣는다. 그래서 운영 DB 의 post-market 카드 46건이 모두 `valid_from = 해당일 00:00:00`, `expires_at = 해당일 06:30:00`(의도는 09:00/15:30 KST)이다. `signal-expiry` 는 `expires_at < NOW()`(NOW 는 KST) 로 만료시키고, `entry-watcher` 는 개장 확인 뒤에 `expires_at < now` 이면 만료 처리한다 — 처리 가능한 시각(09:00 이후)에는 이미 06:30 이 지났다. 결과: 46건 중 `consumed_order_id` 가 채워진 것 **0건**, 상태는 expired 38 · approved 2(08-11/12, 주문 없음) · pending 4 · superseded 2. 메모리에 있는 "90일간 주문 접수 0건"과 부합한다 [가능성 높음 — 인과는 코드·데이터 정황, 주문 경로를 실행해 보지는 않았다]. 이 결함은 T-045 의 변경과 무관하게 이미 있으며, T-045 가 전제한 "둘 다 승인하면 같은 종목 매수가 두 번 나간다"는 위험이 **현재는 이 만료 결함 덕에 실제로는 발현하지 못한다**는 뜻이다(고치는 순간 T-045 의 중복 방지가 실제 방어선이 된다). 고칠 때 주의: NOT EXISTS 는 상태 불문이라 같은 `valid_from` 의 기존 카드가 있으면 재생성을 막는다 — 수정 배포 당일 이미 만들어진 카드는 수동 정리가 필요하다. 테스트가 `expires_at '2026-10-19 06:30:00'` 을 정답처럼 단언하므로(R-3) 그때 함께 고쳐야 한다.
- [23:28] **R-3 (LOW, 권고) — 테스트의 고정 범위 한계(변이 25개 중 8개 생존).** 사망 17개는 단언 실패로 죽는 것을 확인했다(컴파일 오류 아님: M03·M05·M11·M19 출력 확인). 생존한 것: M13·M14 `NOT EXISTS` 안에 `AND status = 'pending'` 또는 `status IN (...)` 리터럴을 덧붙임, M15 `strategy_id` 리터럴 비교 추가, M16 서브쿼리 대상 테이블을 `orders` 로 교체, M21~M24 삽입 리터럴(`side`·`amount_krw`·`status`·`market`) 변경. 원인: SQL 단언이 `toMatchObject` 부분 문자열 정규식 하나뿐이라 **"상태를 가리지 않는다"는 이 task 의 핵심 정책과 대상 테이블이 고정되지 않았다**(쿼리가 모킹이라 의미 검증이 없음). 사람이 diff 로 확인한 결과 SELECT 목록의 리터럴은 원래 VALUES 와 일치하고 서브쿼리는 `FROM signals` 가 맞다 — 지금 코드는 올바르다. 제안: 공백 정규화 뒤 `WHERE NOT EXISTS ( SELECT 1 FROM signals WHERE symbol = ? AND side = 'buy' AND valid_from = ? AND scenario_source = 'post-market' )` 전체를 `toContain` 으로 고정하고, SELECT 목록 리터럴 구간(`'buy', 'limit', ?, 100000, ?, ?, 'pending', ?, ?, 'domestic', 'post-market'`)도 한 번 고정한다. 필수는 아니다.
- [23:28] **R-4 (LOW, 트레이드오프 기록) — 금요일 실행이 실패하면 주말에 만회할 수단이 사라진다.** 메모리상 post-market AI 가 8/17~10/8 매일 `fetch failed` 였던 전례가 있다. 이전에는 토·일 16:00 실행이 사실상 재시도였고(그래서 중복·모순이 났다), 이제는 금요일에 카드를 못 만들면 월요일 카드가 없다(월요일 실행의 `valid_from` 은 화요일이다). 라우트에 force 파라미터도 없다. 다만 "금요일 SKIP 인 종목을 토요일에 BUY" 같은 모순을 없애려면 스킵이 필요하므로 의도된 선택이고, R-2 때문에 현재 실익은 없다. 알림 체계로 금요일 실패를 잡는지는 이 task 밖이다.
- [23:29] **항목 4 — NOT EXISTS 정책 적절성.** 키는 (symbol, side='buy', valid_from, scenario_source='post-market'), 상태·`strategy_id`·market 불문. [확실] 거절·`superseded` 카드는 같은 `valid_from` 으로 되살아나지 않는다(의도). [확실] 같은 종목의 다른 패턴(`strategy_id`)은 하루에 한 장만 허용된다 — 같은 날 같은 데이터면 엔진 내부 우선순위(eod-high-close > inside-bar > oversold-bounce)로 패턴이 결정적이라 정상 흐름에서는 충돌이 없고, 운영 DB 에 같은 키에 서로 다른 `strategy_id` 가 있던 사례는 0건이었다. 정당한 재생성을 막는 경우: (a) 같은 날 재실행 시 이미 들어간 종목은 새 LLM 결과로 갱신되지 않는다(원하는 동작), (b) 부분 실패 뒤 재실행은 빠진 종목만 채운다(좋음), (c) R-2 수정 배포 당일에는 위 주의. 추가로 좋은 점: LLM 이 한 응답 안에서 같은 종목을 두 번 BUY 로 내도 두 번째는 이제 막힌다(기존에는 그대로 2건 삽입). 과거 중복 실측: 같은 (symbol, valid_from) 에 3건씩 쌓인 사례가 2건(347700 @ 08-17, 005380 @ 07-20)이고 모두 주말 실행 때문이었다.
- [23:29] **항목 5 — SQL 정확성.** [확실] 컬럼 13개 / SELECT 항목 13개이고 리터럴 순서가 변경 전 VALUES 와 일치한다. 자리표시자 9개와 파라미터 9개의 순서가 맞다(strategyId, symbol, price, reasoning, indicators, expiresAt, validFrom, symbol, validFrom). 값은 `pool.query` 의 클라이언트 이스케이프라 인젝션 표면은 기존과 같다. [확실] `valid_from`·`expires_at` 은 DATETIME 이고 양쪽 모두 같은 'YYYY-MM-DD HH:MM:SS' 문자열이라 시간대 변환 없이 동등 비교된다 — 같은 술어를 SELECT 로 실행해 005380@2026-10-19 → 0행(차단), 005380@2026-10-20 → 1행(허용)을 확인했고 `EXPLAIN` 은 `idx_signals_valid_from` 을 쓴다(약 6행, 풀스캔 아님). [가능성 높음] `INSERT … SELECT … FROM DUAL WHERE NOT EXISTS(같은 테이블)` 는 MariaDB 10.11 에서 유효한 관용구이고 Developer 가 운영 DB 롤백 트랜잭션으로 실행 확인했다고 기록했다 — 나는 쓰기 금지 지시로 직접 실행하지 않았다.
- [23:30] **항목 6 — 동시 실행.** [확실] `stockinvest-cron` 은 pm2 fork 인스턴스 1개의 직렬 루프이고 `call` 은 동기 curl 이라 한 러너 안에서 두 post-market 호출이 겹치지 않는다. 그러나 "cron 이 직렬"만이 두 번째 실행의 경로가 아니다: 날짜 파일(`post-market-domestic-last-date`)은 호출이 **끝난 뒤** 기록되므로, 16시대에 러너가 재시작되면(배포·`max_memory_restart` 128M) 새 러너가 같은 날 한 번 더 호출하고 이때 첫 호출이 서버에서 아직 진행 중일 수 있다 [가능성 높음]. 이 재실행은 이제 NOT EXISTS 가 막는 정당한 사용례이고, 같은 키의 동시 삽입만이 잔여 위험이다. 그 잔여 위험의 크기는 문서의 "둘 다 통과" 보다 작거나 같다고 본다: 운영 격리수준이 REPEATABLE-READ 이고 서브쿼리가 `idx_signals_valid_from` 을 타므로 INSERT…SELECT 는 공유 next-key 잠금을 잡아, 같은 키의 동시 삽입은 둘 다 통과하기보다 교착(ER_LOCK_DEADLOCK, 한 쪽이 `insert_fail` 로 기록)이나 대기로 귀결될 가능성이 크다 [추측 — 쓰기 금지로 실험하지 못함]. 어느 쪽이든 중복 카드가 둘 다 남는 확률은 문서가 가정한 것 이하이므로 유니크 인덱스 없이도 이 task 의 위험 평가는 유지된다.
- [23:30] **항목 7 — 반환 타입 변경의 소비자.** `grep` 전수: `runPostMarketAnalysis` 호출자는 `cron/post-market-analysis/route.ts` 하나뿐이고 결과를 `{ ok: true, ...result }` 로 그대로 펼쳐 JSON 응답·로그에 쓴다. 새 필드(`duplicatesSkipped`, `skipped`)는 둘 다 선택 필드라 타입이 깨지지 않으며(tsc 0), 스킵도 HTTP 200 + `ok:true` 라 `cron-runner.sh` 의 `call` 은 OK 로 기록한다. `[post-market] market=… created=… skipped=…` 로그 문자열을 파싱하는 스크립트·알림은 코드·스크립트·문서에서 찾지 못했다. 영향 없음.
- [23:30] **R-5 (INFO) — 휴장일 목록 상태.** `HOLIDAYS_KR` 는 `report_extra_holidays`(현재 빈 배열)로 보강하는 구조인데 2026년 휴장 일부가 목록에 없는 것으로 보인다(2026-03-02·05-25·06-03·08-17·10-05 대체/선거 휴일, 12-31 연말 폐장 — 내 지식 기준이며 공식 달력 대조는 하지 못했다 [가능성 높음]). 2027년은 01-01 뿐이다. 이 누락은 위 항목 3의 분석대로 false run 만 만들고 해롭지 않지만, R-1 을 (a) 로 해결하면 목록 정확도가 곧바로 카드 유무를 좌우하게 되므로 그때는 목록 갱신이 선행 조건이다. 과거 날짜 오기재(2026-02-19/20, 2025-10-02 등) 의심도 있으나 오늘 이후 날짜에는 영향이 없다.
- [23:31] **항목 9 — 이 변경이 하지 않는 것이 위험 평가를 바꾸는가.** 바꾼다, 두 방향으로. (1) `nextTradingDayOpen` 비공휴일 인식 부재는 R-1 로 "휴장일용 카드를 만든다"를 넘어 "다음 거래일 카드가 사라진다"로 커진다(후속 task 필요, 첫 영향일 12-25). (2) 유니크 인덱스 부재는 항목 6 분석상 문서의 서술보다 작은 위험이다. 반대로 R-2(만료 시각) 때문에 T-045 가 막으려던 이중 매수는 현재 발현 불가 상태라, 이번 변경의 실효 이득은 "카드 목록·승인 요청(텔레그램)·통계의 중복 노이즈 제거"이고 R-2 수정과 함께 비로소 이중 매수 방어선이 된다.
- [23:31] **필수 수정 항목: 없음(이번 커밋 기준).** 안전장치 우회·`submitOrder` 경로·한도·KILL_SWITCH 는 이 변경이 건드리지 않았고(엔진은 `signals` 에 pending 카드만 넣는다) 새로 열린 주문 경로도 없다. 변경은 카드 생성을 줄이는 방향이라 자금 방향 위험이 없다. 권고(우선순위순): R-1 의 해결 방식 결정(12-24 이전), R-2 별도 task 등록(T-043 entry-watcher 와 함께 보면 좋다), R-3 SQL 단언 강화, task 문서의 "알려진 한계 ①" 정정.
- [23:31] **QA 인계(high_risk_areas).** `src/lib/strategy/post-market-engine.ts` 220~232행(스킵 분기: 비거래일에 LLM·시세·INSERT 가 정말 0회인지), 100~127행(NOT EXISTS 문장), 354~371행(duplicate/created 분기와 카운터). 배포 직후 토·일 라우트 호출은 응답에 `skipped:"non_trading_day"` 가 있고 `signalsCreated:0` 인지, 월요일 10-19 16:00 실행은 로그의 `created=… skipped=… (중복 …)` 와 `signals` 에 (symbol, valid_from) 중복이 새로 생기지 않았는지 확인할 것. 10-19 에는 금요일 카드 19077~19080 이 이미 있어 같은 `valid_from` 이 아니라(월요일 실행의 valid_from 은 화요일 10-20) 중복 차단 로그는 나오지 않는 것이 정상이다.
- [23:32] **1라운드 판정(2라운드로 대체됨): pass (scope: src/lib/strategy/post-market-engine.ts, src/lib/strategy/__tests__/post-market-engine.test.ts)**

## Reviewer

- [23:34] **2라운드 범위·방법 — 변경분만 독립 재확인, 1라운드 판정은 빌리지 않음.** 읽은 것: 스킵 조건 교체 diff(`isWeekendKst` 신설·export, `isTradingDay` import·try/catch·`trading_day_check_fail` 제거, `skipped` 값 `weekend`), 테스트 파일 전체(20개), `market-hours.ts`, `getDailyCandles`, 현재 task 문서. 직접 실행한 것: 대상 테스트 20/20, `tsc --noEmit` exit 0, 전체 jest 142 suites / 2,898 tests 통과, TZ 4종(UTC·Asia/Seoul·America/Los_Angeles·Pacific/Kiritimati)에서 대상 테스트 20/20, 스크래치패드 복사본에서 변이 33개와 날짜별 시뮬레이션, `isWeekendKst` 공식 전수 대조, 운영 DB 읽기 전용 SELECT(`market_holidays`). 확인하지 못한 것: INSERT 실제 실행(쓰기 금지, SQL 문장은 1라운드와 동일 — 이번 diff 에서 안 바뀜), KIS 일봉 API 가 휴장일에 실제로 무엇을 돌려주는지(코드 근거만). 원본 무결성: 엔진 sha256 `257be2cb…d566`, 테스트 `b512c8f9…b7e8` 가 감사 전후 동일, 코드·테스트 무수정.
- [23:35] **[확실] R-1 해소 — 시뮬레이션 재현.** 1라운드와 같은 방식(복사본 엔진 + 16:02 KST 고정)으로 이번 엔진을 돌렸다. 12-23(수) RUN → validFrom 12-24 · 12-24(목) RUN → 12-25(휴장) · **12-25(금, 휴장) RUN → validFrom 12-28(월), 카드 생성** · 12-26(토)·12-27(일) SKIP · 12-28(월) RUN → 12-29. 같은 구조의 2027-01-01(금) RUN → 01-04(월), 10-09(금, 한글날) RUN → 10-12(월), 10-10·10-11 SKIP. 월요일 12-28·01-04 용 카드가 이제 생긴다. 월~금 실행의 validFrom 이 서로 다른 날로만 가므로(월→화, 화→수, 수→목, 목→금, 금→월) 서로 다른 실행이 같은 키를 만드는 경우는 정상 흐름에 없다.
- [23:35] **[확실] 항목 2 — 공휴일 당일 실행의 새 위험 없음.** (1) 같은 날 두 번 실행(러너 재시작): 키가 (종목, validFrom=H+1)이라 휴장 여부와 무관하게 NOT EXISTS 가 막는다. SQL 문장은 1라운드와 동일하고, 테스트가 문장 전체를 고정한다. (2) 공휴일 전날 카드(validFrom=H)와 당일 카드(validFrom=H+1 또는 월요일)는 키가 달라 충돌하지 않는다. 장기 연휴(연속 평일 휴장)에서는 휴장일마다 휴장일용 카드 한 세트씩이 생기고 마지막 휴장일 실행이 실제 거래일용 카드를 만든다 — 휴장일용 카드는 `nextTradingDayOpen` 의 기존 한계로 이번 변경 전에도 같았다. 휴장일용 카드는 `isDomesticOpen` 이 `market_holidays`(2026-12-25·2027-01-01 포함 확인)로 닫힘 처리하므로 entry-watcher 가 처리하지 않는다. (3) 낡은 데이터: `getDailyCandles` 는 KIS 일봉 중 종가가 0 보다 큰 행만 쓰고 오늘 날짜 합성 행을 덧붙이지 않으므로, 휴장일 H 에 마지막 봉은 H-1 의 것이다. 그 H-1 은 H+1 개장 시점에 쓸 수 있는 가장 최신 정보이며 금요일→월요일 실행과 같은 구조다 [가능성 높음 — 휴장일 API 응답은 직접 보지 못했다]. 자금 위험을 만드는 낡음이 아니다. 남는 것은 품질 사소함뿐이다: 프롬프트가 마지막 봉을 `오늘(H)` 로 표기하고, 연휴에는 RAG lookback 3일이 상대적으로 짧아진다 (LOW, 이번 변경 이전부터 같은 표기 구조).
- [23:36] **[확실] 항목 3 — `isWeekendKst` 정확성.** `new Date(date.getTime() + 9h).getUTCDay()` 는 서버 TZ 와 무관하다. 2026~2027 년 15분 간격 70,080 시점을 `Intl.DateTimeFormat('en-US', {timeZone:'Asia/Seoul'})` 요일과 대조해 불일치 0 이고, TZ=UTC·America/Los_Angeles·Pacific/Kiritimati 에서 결과가 같다. 한국은 DST 가 없다. 경계 테스트(금 23:59:59 KST 거짓, 토 00:00:00 KST 참, 일 23:59:59 KST 참, 월 00:00:00 KST 거짓)가 UTC 날짜가 다른 경계를 정확히 짚는다. cron 은 16시대만 호출하므로 경계 영향이 없다.
- [23:36] **[확실] 항목 4 — try/catch 제거는 안전.** 판정이 Date 산술뿐인 순수 함수라 던지지 않는다(무효 Date 가 들어와도 NaN 비교로 거짓 → 진행하는 fail-open 이고 `new Date()` 는 무효일 수 없다). 1라운드에서 지적한 "DB 장애 시 판정이 달라지는가 / 죽은 방어" 논점이 구조적으로 사라졌다: 주말 판정은 DB·공휴일 목록에 의존하지 않는다. `trading_day_check_fail`·`non_trading_day`(post-market 쪽)를 소비하는 코드는 없다(grep; `trade-report` 의 `non_trading_day` 는 별개 라우트). 엔진은 더 이상 `reports/trading-day` 를 import 하지 않으므로 1라운드 R-5(공휴일 목록 정확도)는 이 변경과 무관해졌다.
- [23:37] **R-3 해소 확인 + 테스트 실효성.** 변이 33개(주말 스킵 13: 스킵 제거·시장 뒤집기·토만·일만·+9h 제거·+8h·+10h·`getDay`·한글날도 스킵·값 이름 변경·판정 시각을 validFrom 으로·스킵 위치를 심볼 로드 뒤로·스킵 시 DB 호출 추가 / SQL·카운터 20: affectedRows 뒤집기, 카운터 누락 3종, NOT EXISTS→EXISTS, side·source 조건 제거, `valid_from >=`, 파라미터 순서 swap, FROM DUAL 제거, 열 순서 변경, 1라운드에서 생존했던 M13~M16(상태 조건 추가·strategy_id 비교·orders 테이블)과 M21~M24(side·금액·status·market 리터럴)) 중 **TZ=Asia/Seoul 에서 33개 전부 단언 실패로 검출**됐다. 1라운드 생존 8개는 모두 사라졌다. 유일한 경계: `getUTCDay`→`getDay` 변이는 TZ=UTC 에서 생존한다(KST 에서는 검출). 코드는 4개 TZ 모두 맞고, 이는 테스트가 UTC 환경에서 돌 때 이 회귀를 못 잡는다는 LOW 사항이다. 제안(필수 아님): 경계 테스트를 UTC 와 비UTC TZ 양쪽에서 돌리거나 테스트에서 `process.env.TZ` 를 비UTC 로 고정한다.
- [23:37] **R-2·R-4 상태(이번 판정 범위 밖).** R-2(`expires_at` 이 06:30 KST) 는 이번 diff 가 건드리지 않았고 여전히 유효하다 — Leader 가 별도 검증 중이므로 이 판정에 영향 주지 않는다. 테스트는 `expires_at '2026-10-19 06:30:00'` 을 그대로 단언하므로 R-2 수정 때 함께 고쳐야 한다. R-4(금요일 실행 실패 시 주말 재시도 없음)도 그대로다. 평일 공휴일에는 오히려 실행되므로 재시도 여지가 1라운드 설계보다 넓다.
- [23:38] **문서 불일치 — Leader 조치 필요(코드 문제 아님).** task 문서의 제목·범위 ①·설계 1번·시험·롤아웃 2번·Developer 기록이 아직 `isTradingDay`/`non_trading_day`/"공휴일 포함 스킵"으로 쓰여 있고, 코드는 주말만 `skipped:"weekend"` 로 건너뛴다. QA 가 롤아웃 2번대로 토·일 호출을 확인할 때 `skipped:"non_trading_day"` 를 기대하면 오탐이 난다 — 기대값은 `skipped:"weekend"`·`signalsCreated:0` 이고, 평일 공휴일에는 정상 진행(`skipped` 없음)이 의도다.
- [23:38] **필수 수정 항목: 없음.** Critical 0 · High 0. 이번 변경은 1라운드 R-1 을 해결했고(재현으로 확인) 새 위험을 만들지 않았다. 주문 경로·안전장치·한도는 건드리지 않았고 카드 생성을 줄이는 방향이다. QA 인계(high_risk_areas): `post-market-engine.ts` 55~58행(`isWeekendKst`), 230~237행(스킵 분기: 토·일에 심볼·시세·RAG·LLM·DB 호출이 0회, 평일 공휴일은 진행), 108~135행·359~375행(NOT EXISTS 문장과 created/duplicate 분기). 배포 후 토·일 호출 응답은 `skipped:"weekend"`; 월~금(공휴일 포함) 16:00 실행 로그의 `created=… skipped=… (중복 …)` 와 `signals` 에 (symbol, valid_from) 중복이 새로 생기지 않았는지; 12-25(금) 16:00 실행이 validFrom 12-28 카드를 만드는지.
- [23:47] **Codex 지적 1건(동시 호출 시 중복 삽입, medium) 독립 분류 — 이 커밋을 막지 않는다.** 분류: 1·2라운드 항목 6과 task 설계 3번에서 이미 평가·문서화한 잔여 위험과 같은 항목이다. Codex 의 사실 주장 중 "NOT EXISTS 는 유니크 제약이 아니고 격리수준·실행 계획에 의존한다"는 맞고, "두 문장이 모두 부재를 관측해 둘 다 통과할 수 있다"는 운영 격리수준에서는 실측과 다르다(아래). 새로 더한 사실은 구체적 경로 나열(러너 재시작·중복 러너·수동 호출)과 "테스트가 두 연결 경합을 검증하지 않는다"는 점뿐이며 둘 다 사실이다. 코드·테스트는 수정하지 않았고 해시 불변(엔진 `257be2cb…`, 테스트 `b512c8f9…`).
- [23:47] **[확실] 직접 실험 — 일회용 로컬 DB 에서 엔진의 INSERT 문장을 소스에서 그대로 꺼내 서로 다른 연결로 동시 실행.** 운영 DB 에는 쓰지 않았다. 대상은 MariaDB 10.11.19 컨테이너(운영 10.11.11 과 같은 계열, 격리수준 REPEATABLE-READ·binlog ROW 동일, 약 19,000행 시드, 운영과 같은 `idx_signals_valid_from` 실행 계획으로 맞춤)와 MySQL 8.0(보조). 같은 키를 동시에 넣는 경합 300회: **REPEATABLE READ 에서는 키마다 정확히 1행(중복 0/300)** — 진 쪽 문장은 0행 차단이거나 오류로 끝났다(MariaDB 는 오류 1467 autoinc 읽기 실패로 표면화, MySQL 8 은 deadlock 1213; 오류로 끝난 문장 비율은 엔진·실행 계획·연결 수에 따라 약 2~31%). 운영과 같은 `valid_from` 계획의 MariaDB 에서 RR 은 2연결 0/300·4연결 0/300 중복이다. **READ COMMITTED 로 바꾸면 300/300 키가 중복**(2·4연결 모두)이다. 결론: 현재 방어는 "구조적 유일성"이 아니라 **운영 격리수준이 REPEATABLE READ 라는 사실에 기대는 방어**다. Codex 의 "유일성 보장은 아니다"는 정확하고, 문서의 "둘 다 통과" 서술은 현 설정에서는 부정확(실제로는 한쪽이 오류)하다.
- [23:48] **새로 확인한 부작용(LOW, 겹침 실행에서만).** 운영과 같은 `valid_from` 인덱스 계획에서는 INSERT…SELECT 의 공유 next-key 잠금이 같은 valid_from 범위 전체를 덮어, **서로 다른 종목**을 같은 valid_from 으로 동시에 넣는 두 연결도 일부 문장이 오류로 끝났다(연결 2개 600문장 중 27, 연결 4개 1,200문장 중 447 — 문장을 동시에 쏘는 최악 조건). 정상 실행은 한 연결이 문장을 순차로 보내므로(자동 커밋) 해당 없다. 겹침 실행에서 진 문장은 기존 `insert_fail` 로 응답 `errors` 에 남고 카드는 만들어지지 않는데, 겹친 두 실행은 같은 입력으로 같은 종목을 다루므로 대개 다른 실행이 그 카드를 만든다 [추측]. 변경 이전에는 겹치면 무조건 중복이 쌓였으므로 상태는 개선이다.
- [23:48] **막지 않는 이유.** (1) 겹침 자체가 비정상 사건(16시대 러너 재시작·수동 호출·중복 러너)이고, `stockinvest-cron` 은 pm2 에서 1개(fork)이며 수동 호출은 CRON_SECRET 인증이 필요하다. (2) 겹쳐도 현 격리수준에서는 중복 카드가 남지 않았다(MariaDB 10.11.19 RR 에서 2연결·4연결 각 0/300, 계획 두 종류 모두). (3) 결과가 최악이어도 pending 카드 2장(노이즈)이지 주문이 아니다 — 주문은 승인과 entry-watcher 를 거치고, 지금은 R-2 때문에 카드가 실행되지도 못한다. (4) 변경 이전에는 주말·재시작마다 확정적으로 중복이 쌓였으므로 이번 변경은 위험을 줄이는 방향이다. (5) 구조적 해결(유니크 인덱스)은 마이그레이션이라 사용자 승인 사항이다.
- [23:49] **붙일 조건(후속, 커밋 차단 아님).** (a) task 설계 3번 문구를 정정할 것: "둘 다 통과할 수 있다"가 아니라 "REPEATABLE READ 에서는 한쪽이 오류로 끝나고, READ COMMITTED 로 바뀌면 둘 다 통과한다 — 유니크 인덱스가 구조적 해결". (b) **순서 게이트**: 카드의 `expires_at` 를 정상화해 카드를 실행 가능하게 만드는 수정(R-2/T-046)은 유니크 인덱스(또는 아래 직렬화)가 먼저 또는 같이 배포되지 않으면 내보내지 않는다 — 그때부터 중복 카드가 이중 매수 후보가 되기 때문이다. (c) DB 전역 격리수준을 READ COMMITTED 로 바꾸지 말 것(데드락 완화용으로 흔히 바꾼다)을 운영 메모에 남긴다 — 바꾸는 순간 이 방어가 조용히 사라진다. (d) 응답·로그의 `errors` 에 `insert_fail` 이 보이면 겹침 실행 신호로 취급한다.
- [23:49] **Leader 의견 평가(GET_LOCK 대신 유니크 인덱스를 T-046 과 묶어 승인 요청) — 위험을 키우지 않는다. 단 4가지 전제가 필요하다.** (1) GET_LOCK 회피는 타당하다: 연결 단위 잠금이라 풀로 돌려보낸 연결에 잠금이 남거나 다른 호출이 같은 연결로 재진입할 수 있어, 직렬화를 위해 풀 연결을 전담 확보하고 해제를 보장하는 코드가 새 결함 표면이 된다. (2) 지연 구간의 노출은 사실상 0이다 — 카드가 아직 실행될 수 없으므로. 그래서 (b) 순서 게이트를 명시적으로 지키는 것이 이 판단의 조건이다. (3) **마이그레이션 사전 조건**: 운영 `signals` 에 이미 같은 (symbol, side, valid_from, scenario_source) 행이 겹치는 키가 4개 있다(005380·055550 @ 2026-10-19 각 2행, 347700 @ 08-17 3행, 005380 @ 07-20 3행). 유니크 인덱스는 이 이력을 정리하기 전에는 만들어지지 않으므로 정리 방식(과거 행의 키 비움 등)과 사용자 승인이 필요하다. 다른 유형 신호는 scenario_source 또는 valid_from 이 NULL 이라 영향이 없다 [가능성 높음 — 유니크 인덱스의 NULL 허용 의미 기준]. (4) **T-046 이 `valid_from` 값 형식을 바꾸면 NOT EXISTS 비교 키도 같이 바꿔야 한다** — 값이 다르면 같은 날 배포 전후 실행이 서로를 못 알아봐 중복이 생긴다. 키를 날짜 단위로 잡는 설계(예: `DATE(valid_from)` 또는 별도 날짜 열)를 T-046 설계에 포함시킬 것. 코드는 `ER_DUP_ENTRY` 를 duplicate 로 처리하도록 먼저 내보내도 인덱스가 없을 때는 무해하므로 배포 순서는 코드 → 마이그레이션이 안전하다.
- [23:49] **마이그레이션 승인이 나지 않을 때의 대안(제안만, 필수 아님).** DB 연결을 쓰지 않는 프로세스 내 중복 실행 방지(모듈 수준 실행 중 표식 + `try/finally`, 두 번째 요청은 즉시 `skipped` 로 응답). `stockinvest` 는 pm2 cluster 모드 인스턴스 1개라 모든 호출(cron·수동·러너 재시작)이 한 프로세스로 들어오므로 현실적인 겹침 경로를 전부 덮는다. 구조적 보증은 아니고(프로세스 비정상 종료·blue/green 전환 순간의 두 프로세스는 못 덮음) 유니크 인덱스를 대체하지 않는다. Codex 가 권한 두 연결 통합 테스트는 이 저장소에 DB 하네스가 없어 지금 넣기 어렵다 — 이번에 쓴 스크래치 실험 스크립트(`scratchpad/race.js`, `race_m2.js`)를 DB 환경변수가 있을 때만 도는 선택 테스트로 옮기는 정도가 현실적이다.
- [23:50] **정리.** 실험용 일회용 MariaDB 컨테이너·MySQL 8 인스턴스는 감사 후 모두 내렸다. 운영 DB 쓰기·저장소 파일 변경 없음. 이 분류는 1·2라운드 판정을 바꾸지 않는다.
- [23:50] **최종 판정: PASS (scope: src/lib/strategy/post-market-engine.ts, src/lib/strategy/__tests__/post-market-engine.test.ts)**

## QA

(검증 후 기록)

## 최종 요약 (사용자용)

(완료 후 작성)
