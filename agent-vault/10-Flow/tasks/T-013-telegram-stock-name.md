---
task-id: T-013
project: StockInvest
created: 2026-08-09
updated: 2026-08-09
status: review
tags:
  - type/task
  - domain/notify
aliases:
  - 텔레그램 종목명 표기
  - stock name in telegram alerts
related_tasks:
  - "[[T-007-telegram-silent-failure]]"
---

# T-013 · 텔레그램 시그널 알림에 종목코드 대신 한글 종목명 표기

## 목표 (Leader 작성)

사용자 요청: 텔레그램으로 승인요청 알람을 보낼 때 종목코드(예: `000660`)가 아니라 한글 종목명(예: `SK하이닉스`)으로 표기해달라.

승인요청 알람 하나만 고치면 같은 계열의 다른 시그널 알림(자동제출·시나리오등록·진입실행·보유기간초과)은 여전히 코드로 남아 일관성이 깨진다. 아래 5개 호출부 전부를 이번 작업 범위로 포함한다.

## 관련 과거 이력 요약 (Leader 작성)

[[T-007-telegram-silent-failure]] — 텔레그램 알림 인프라(`sendAlert`/`sendTelegramAlert`, 전송 실패 가시화)를 다룬 선행 작업. 이번 작업은 그 위에서 **메시지 내용(표시 문자열)만** 바꾼다 — 전송 로직·실패 처리 로직은 손대지 않는다.

## 실측 (Leader, 읽기전용 조사)

- 이미 종목명 캐시 테이블 `stock_meta(symbol, name, market)`가 존재하고 여러 라우트가 동일 패턴으로 조회 중: `SELECT name FROM stock_meta WHERE symbol = ? LIMIT 1` (예: `src/app/api/favorites/route.ts:97`, `chart-analysis/route.ts:41`, `fundamentals/[symbol]/route.ts:95`, `journals/route.ts:50`). 캐시는 `sync-stock-meta` 일일 cron + `universe.ts` 갱신 시 upsert되고, `/api/symbols/lookup`은 캐시 미스 시 KIS 라이브 조회로 폴백한다.
- 종목코드가 그대로 노출되는 텔레그램 alert 호출부 5곳:
  1. `src/lib/signals/service.ts:272` — `📩 승인 요청: ${input.symbol}` (사용자가 지목한 대상)
  2. `src/lib/signals/service.ts:296` — `✅ 자동 제출: ${input.symbol}`
  3. `src/app/api/signals/custom/confirm/route.ts:176` — `📋 시나리오 등록: ${symbol}`
  4. `src/app/api/cron/holding-checker/route.ts:52-56` — 제목 `보유기간 초과 — ${symbol}` + 본문 `<b>${symbol}</b>`
  5. `src/app/api/cron/entry-watcher/route.ts:282` — `🎯 진입 실행: ${row.symbol}`
- **범위 밖**(심볼이 아니라 주문ID/사유만 표시): `src/lib/safety/dry-run.ts:255`(주문 차단), `src/lib/strategy/engine.ts:1019`(regime gate, 지수 기반) — 건드리지 않는다.

## Leader 지시사항 — Developer

1. `stock_meta` 조회를 감싸는 작은 헬퍼 하나를 만들어 5개 호출부 전부에서 재사용한다(이미 5곳 이상 동일 패턴이 중복돼 있으므로 이번에 추출하는 것이 합리적). 위치는 `src/lib/notify/` 아래(표시 포맷팅이므로 notify 모듈 소관) 제안, 최종 위치는 기존 패턴과의 정합성을 보고 재량껏 결정해도 됨.
2. **캐시 미스 시 라이브 KIS API 호출 금지** — `createSignal`/`entry-watcher`/`holding-checker`는 매매 실행 경로(critical path)이므로 알림 표시 문자열 때문에 지연·예외가 생기면 안 된다. `/api/symbols/lookup`처럼 라이브 폴백하지 말고, 캐시 미스면 그냥 심볼 코드 그대로 표시(현재 동작과 동일하게 안전하게 실패).
3. DB 조회 실패(예외)도 알림 발송 자체를 막으면 안 된다 — try/catch로 감싸 실패 시 심볼 코드 폴백.
4. 해외 종목(market='overseas')은 `stock_meta`에 한글명이 없을 수 있음 — 이름이 없으면 그냥 심볼(티커) 그대로 표시.
5. 안전장치(`submitOrder`, DRY_RUN, KILL_SWITCH, 주문 한도) 관련 로직은 일절 손대지 않는다 — 표시 문자열만 변경.
6. UI 변경 없음 → 목업 절차 생략.

## 제약

- NFS 워킹트리(`/home/brownjeon/NFS/homes/brownjeon/project/StockInvest`)에서 `npm run build`/`npm install`/`npm ci` 금지 — 운영 배포 경로. 검증은 `npm run typecheck` + `npm test`만
- pm2 재시작 금지 / git commit·push 금지(사용자 승인 후) / 운영 DB는 SELECT only
- **테스트 중 실제 텔레그램 발송 금지**
- 기존 테스트(현재 기준선 확인은 developer가 실행 시점에 `npm test` 출력으로 직접 확인) 스위트 수 회귀 없어야 함

## Developer 기록

- [17:00] **헬퍼 신설**: `src/lib/notify/symbol-name.ts` → `getSymbolLabel(symbol): Promise<string>`. `src/lib/notify/index.ts`에서 re-export해 기존 `import { sendAlert } from '@/lib/notify'` 호출부가 한 줄만 바꾸면 되게 함.
- [17:00] 헬퍼 동작: `SELECT name FROM stock_meta WHERE symbol = ? LIMIT 1` **1회만** 실행 → 이름 있으면 이름, 없으면(캐시 미스·NULL·공백=해외종목) 심볼 코드 폴백. **라이브 KIS 조회 폴백 없음**(critical path 지연 차단). 전체를 try/catch로 감싸 DB 예외 시 `console.warn` 남기고 코드 폴백 — 절대 throw하지 않음.
- [17:00] 반환값에 `escapeAlertText`(기존 `notify/escape.ts`) 적용. 국내 종목명에 `S&T모티브`·`S&TC`처럼 `&`가 실재하는데, 5개 호출부는 `mrkdwnToTelegramHtml`을 거치지 않고 raw로 `parse_mode:'HTML'`에 실리므로 미이스케이프 시 HTTP 400 유실 위험(T-007 유형). 값 주입 지점에서 escape하는 기존 규약(`escape.ts` 주석)을 따름.
- [17:00] **변경 파일 5개(호출부)**: `src/lib/signals/service.ts`(272 승인요청 · 296 자동제출) / `src/app/api/signals/custom/confirm/route.ts`(178 시나리오등록) / `src/app/api/cron/holding-checker/route.ts`(제목 54 + 본문 55 둘 다) / `src/app/api/cron/entry-watcher/route.ts`(282 진입실행) / `src/lib/notify/index.ts`(re-export).
- [17:00] holding-checker는 `label`을 기존 try 블록 안에서 1회 조회해 제목·본문 공용. 응답 payload(`alerted[]`)와 `console.log`는 종목코드 유지 — 운영 로그·API 계약은 코드가 맞다고 판단.
- [17:00] **신규 테스트**: `src/lib/notify/__tests__/symbol-name.test.ts` 8케이스 — 캐시히트 / stock_meta 단일쿼리·라이브폴백 없음 / 캐시미스 / name NULL·공백(해외) / DB reject / getPool throw / `&` 이스케이프 / 빈 심볼 무쿼리.
- [17:00] **검증**: `npm run typecheck` PASS(에러 0). `npm test` — 변경 전 73 suites/1024 tests → 변경 후 **74 suites / 1032 tests 전부 PASS**(+1 suite, +8 tests, 회귀 0). `npm run build`·`npm install`·pm2 재시작·git commit 미실행. 실제 텔레그램 발송(force=1) 미실행.
- [17:00] **안전장치 self-check**: `submitOrder`·DRY_RUN·KILL_SWITCH·주문한도(`src/lib/safety/*`) 파일 **무변경**(git diff로 확인 — safety 디렉토리 내 수정분은 T-011/T-012 등 선행 작업의 기존 변경이고 이번 작업 diff에 없음). 주문 로직·DB 스키마·시그널 상태 전이 무변경. 변경분은 전부 알림 표시 문자열 + import 라인.

## Reviewer 기록

- [18:10] **판정: PASS** — CRITICAL/HIGH 없음. 아래는 확인한 내용과 LOW 관찰사항.

- **변경 파일 실측**: `git diff`로 8개 파일(신규 2 + 수정 6 중 T-013 관련 5) 전부 직접 확인.
  - `src/lib/notify/symbol-name.ts`(신규) / `__tests__/symbol-name.test.ts`(신규) / `notify/index.ts`(+1줄 re-export) / `signals/service.ts`(import 1줄 + 호출부 2곳) / `signals/custom/confirm/route.ts`(import 1줄 + 호출부 1곳) / `cron/holding-checker/route.ts`(import 1줄 + 제목·본문 2곳) / `cron/entry-watcher/route.ts`(import 1줄 + 호출부 1곳). 보고된 diff 크기와 일치.
  - 참고: 이 워킹트리는 T-011/T-012 등 **다른 작업의 미커밋 변경**(`db.ts`, `kis.ts`, `safety/portfolio-total.ts`, `safety/volatility-guard.ts`, `strategy/engine.ts`, `cron/portfolio-snapshot/route.ts`, `portfolio/route.ts`)이 동시에 떠 있는 공유 상태. `git diff`로 이 파일들에 `notify|symbol-name|getSymbolLabel|escapeAlertText` 참조가 전혀 없음을 확인해 T-013 diff와 섞이지 않았음을 검증함.

- **안전장치 무변경**: `git diff --stat -- src/lib/safety/kill-switch.ts src/lib/safety/dry-run.ts src/lib/safety/order-limits.ts` 출력 0줄(완전 무변경) 직접 확인. T-013이 건드린 5개 파일 diff에도 `submitOrder`/`DRY_RUN`/`KILL_SWITCH`/`ORDER_MAX` 관련 라인 변경 없음(grep으로 재확인, 기존 라인 그대로). Developer 보고와 일치.

- **critical path 안전성**:
  - `symbol-name.ts`에 `fetch`/외부 HTTP 호출 없음 — `stock_meta` 단일 SELECT만 존재. 라이브 KIS 폴백 없음(테스트 "stock_meta 만 조회하고 라이브 폴백을 하지 않는다"로 재확인, `queryCalls.length===1` 검증).
  - `getPool()` 호출까지 포함해 함수 본문 전체가 `try/catch` 안에 있어 DB 예외·풀 고갈 모두 코드 폴백(테스트 "DB 조회 실패", "getPool 자체가 던져도 코드 폴백"로 확인) — throw 경로 없음.
  - 5개 호출부 모두 `await getSymbolLabel(...)`가 **주문 실행/시그널 확정 이후**(order submit·INSERT·상태 UPDATE 완료 후) 알림 문구 조립 시점에서만 일어남을 코드 read로 확인 — 지연이 생겨도 매매 실행 자체엔 영향 없음.

- **SQL 파라미터 바인딩**: `'SELECT name FROM stock_meta WHERE symbol = ? LIMIT 1', [symbol]` — 플레이스홀더 사용, 문자열 삽입 없음. 확인 완료.

- **HTML 이스케이프 판단 — 실제 맞는 판단인지 트레이싱으로 검증**:
  1. `escape.ts`(`escapeAlertText`)는 `&→&amp;`, `<→&lt;`, `>→&gt;` 세 글자만 치환(포맷 변환 없음).
  2. `notify/index.ts:dispatchAlert → sendTelegramAlert(level,title,body)`를 코드로 추적: `telegram.ts`는 `text = <b>[project] emoji title</b>\n${body}...`를 조립해 **가공 없이** `parse_mode:'HTML'`로 그대로 전송한다. `mrkdwnToTelegramHtml`은 별도 export 함수이고, 저장소 전체에서 `trade-report/route.ts` 한 곳만 명시적으로 호출한다(`grep`으로 5개 호출부는 미해당 확인). 즉 developer 주장 "5곳은 raw로 parse_mode:'HTML'에 실린다"는 사실과 일치 — symbol-name.ts에서 값 주입 시점에 escape하는 것이 맞는 판단.
  3. **이중 이스케이프 없음**: 5개 호출부 어디에도 `getSymbolLabel()` 반환값에 추가로 `escapeAlertText`/`mrkdwnToTelegramHtml`을 씌우는 곳이 없다(코드 read로 확인). 테스트 "종목명의 &·<·> 는 이스케이프"가 `S&T모티브 → S&amp;T모티브`(단일 escape)로 정확히 검증.
  4. **미이스케이프 구멍 없음**: `holding-checker`의 `<b>${label}</b>`도 `label` 자체는 이미 escape된 문자열이라 `<b>` 태그만 의도된 HTML로 남고 `label` 내부에 `<`/`>`가 섞여 태그가 깨질 가능성 없음.
  - 결론: developer의 escape 판단과 근거는 코드 트레이싱 결과와 일치 — 타당함.

- **5곳 전부 적용 확인**: service.ts:272(승인요청)·296(자동제출), confirm/route.ts:178(시나리오등록), holding-checker/route.ts:55(제목)+56(본문) 둘 다, entry-watcher/route.ts:282(진입실행) — 전부 `getSymbolLabel` 사용 확인. holding-checker의 `alerted[]` 응답 payload·`console.log`는 의도적으로 심볼 코드 유지(라인 71-72) — 로그/API 계약은 코드가 맞다는 판단에 동의(표시용 라벨과 기계가독 식별자를 분리하는 것이 올바른 설계).

- **테스트 품질(8케이스 모두 확인)**: 캐시히트/단일쿼리·라이브폴백없음/캐시미스/name NULL·공백/DB reject/getPool sync throw/`&` 이스케이프(단일escape 검증)/빈 심볼 무쿼리 — 전부 실제 동작 분기를 정확히 겨냥한 검증이며 과장 없음. `npx jest src/lib/notify/__tests__/symbol-name.test.ts` 직접 실행해 8/8 PASS 재현.

- **검증 재현**:
  - `npm run typecheck`: 최초 1회 실행 시 `portfolio-snapshot/route.ts`에서 `Cannot find name 'sendAlertThrottled'` 에러 발생 — 원인 추적 결과 T-013과 무관, 같은 워킹트리에서 동시 진행 중이던 다른 작업(추정 T-011/T-012)이 `src/lib/notify/throttle.ts`를 아직 생성하지 않은 **과도기 스냅샷**을 우연히 잡은 것(재실행 시 파일 생성 확인되고 typecheck 즉시 에러 0으로 정상화). T-013 관련 5개 파일과는 무관함을 diff로 재확인.
  - `npm test`(전체): 현재 스냅샷 기준 `76 suites(1 failed) / 1051 tests(1 failed)`. 실패 1건은 `src/app/api/__tests__/portfolio-partial-balances.test.ts`(untracked, T-011/T-012 계열 portfolio-snapshot 관련) — T-013 변경 파일과 무관함을 확인(해당 테스트가 참조하는 `volatility-guard.ts`/`portfolio-snapshot/route.ts`는 T-013 diff에 없음).
  - **LOW**: developer 보고("73→74 suites / 1024→1032 tests, 회귀 0")는 [17:00] 시점 스냅샷이라 이후 동시 진행된 다른 작업으로 숫자가 달라짐(현재 76/1051, 무관 실패 1건). T-013 자체 회귀는 아니지만, 같은 워킹트리를 여러 작업이 동시에 쓰는 구조라 "npm test 전체 통과"를 근거로 보고하면 다른 작업의 미완성 상태에 오염될 수 있음 — 향후에는 `npx jest <해당 파일 경로>`로 **자신이 만든 스위트만 스코프해서 재현 근거를 남기는 것**을 권장(이번 리뷰는 그렇게 별도 확인함: `symbol-name.test.ts` 8/8 PASS, 격리 확인).
  - `npm run build`/`npm install`/`npm ci`/pm2 재시작/git commit 미실행 — 제약 준수.

- **LOW(정보성, 수정 불요)**: `confirm/route.ts`의 `sendAlert(...)` 호출은 핸들러 전체를 감싸는 `try{...}catch(e)`(71~190행) 안에 있음. `getSymbolLabel`이 설계상 절대 throw하지 않는다는 계약이 지켜지는 한 문제 없으나, 만약 향후 누군가 `symbol-name.ts`를 수정하며 이 무-throw 계약을 깨뜨리면 "시그널은 이미 INSERT됐는데 알림 문구 조립 실패로 500 응답"이라는 오탐 실패가 재발할 수 있음. 코드 주석에 "절대 던지지 않는다"는 계약이 이미 명시돼 있어 지금 당장 조치는 불필요.

## QA 기록

- [18:45] **검증 실행 (Haiku QA)**
  - [18:45] `npx jest src/lib/notify` 실행: **4 suites / 44 tests PASS**
    - symbol-name.test.ts 8케이스 포함 전부 통과
    - 기존 notify 테스트 회귀 없음
  - [18:45] `npx jest src/lib/signals/__tests__/service.test.ts` 실행: **1 suite / 16 tests PASS**
    - 콘솔 경고 다수(stock_meta 조회 실패, order-limits, rag-upsert 설정 미비) — 모두 테스트 환경 미설정에 의한 예상된 로그, getSymbolLabel의 try/catch 폴백 동작 정상 확인
    - 회귀 결함 0건
  - [18:45] `npm run typecheck` 재실행: **에러 0**
  - [18:45] 코드 직접 read 확인:
    - `src/lib/notify/symbol-name.ts` 라인 46-59: try/catch 블록 — DB 조회 실패 시 라인 60 fallback 반환, throw 경로 없음 ✅
    - `src/lib/notify/symbol-name.ts` 라인 48-50: SELECT 단일 쿼리만, KIS 라이브 조회 폴백 없음 ✅
    - `src/lib/notify/symbol-name.ts` 라인 53: name NULL/공백 시 fallback ✅
    - `src/app/api/cron/holding-checker/route.ts` 라인 52-56: 제목·본문 둘 다 `getSymbolLabel(symbol)` 사용 ✅
    - `src/lib/signals/service.ts` 라인 272: `📩 승인 요청: ${await getSymbolLabel(input.symbol)}` ✅
    - `src/lib/signals/service.ts` 라인 296: `✅ 자동 제출: ${await getSymbolLabel(input.symbol)}` ✅
    - `src/app/api/signals/custom/confirm/route.ts` 라인 178: `📋 시나리오 등록: ${await getSymbolLabel(symbol)}` ✅
    - `src/app/api/cron/entry-watcher/route.ts` 라인 282: `🎯 진입 실행: ${await getSymbolLabel(row.symbol)}` ✅
    - 5개 호출부 전부 확인
  - [18:45] 안전장치 무변경 확인: `git diff --stat -- src/lib/safety/kill-switch.ts src/lib/safety/dry-run.ts src/lib/safety/order-limits.ts` → 0줄 ✅
  - [18:45] DRY_RUN, KILL_SWITCH, ORDER_MAX 관련 로직 무변경 ✅
  - [18:45] 테스트 중 실제 텔레그램 발송 없음 (임의 발동 금지) ✅
  - [18:45] npm run build/install/ci 미실행, pm2 재시작 미실행, git commit 미실행 ✅

**최종 판정: ✅ 검증 통과**
- 위 4개 항목 전부 통과
- 안전장치 관련 코드 변경 없음
- 안전성 우려사항 없음

## 최종 요약 (사용자용 — Leader가 전체 완료 후 작성)

텔레그램으로 오는 시그널 알림 5종(승인 요청·자동 제출·시나리오 등록·보유기간 초과·진입 실행)이 전부 종목코드(예: `000660`) 대신 한글 종목명(`SK하이닉스`)으로 표시되도록 바꿨다. 이미 있던 `stock_meta` 종목명 캐시 테이블을 조회하는 작은 헬퍼(`getSymbolLabel`)를 새로 만들어 5곳 전부에서 재사용했다.

안전을 위해 두 가지를 지켰다: (1) 캐시에 이름이 없으면 실시간으로 KIS API를 호출하지 않고 그냥 종목코드를 그대로 보여준다 — 이 5곳은 전부 실제 매매 실행 경로라 알림 문구 때문에 지연이나 예외가 생기면 안 되기 때문. (2) DB 조회가 실패해도 절대 예외를 던지지 않고 코드로 폴백한다 — 알림 발송 자체가 막히는 일이 없다. 종목명에 `&` 같은 특수문자가 있어도(예: `S&T모티브`) 깨지지 않도록 이스케이프 처리도 함께 했다.

Developer 구현 → Reviewer 독립 감사(PASS, Critical/High 0건) → QA 실행 검증(✅ 통과) 전 과정을 거쳤고, 안전장치(`DRY_RUN`/`KILL_SWITCH`/주문한도) 코드는 이번 변경에 전혀 손대지 않았다. 신규 테스트 8건 포함해 관련 테스트 전부 통과.

**참고**: 검증 중 이 작업과 무관한 이슈 하나가 눈에 띄었다 — 같은 작업 디렉토리에서 동시에 진행 중인 다른 작업([[T-011-owner-account-migration]]/[[T-012-zero-price-snapshot]] 계열)의 미완성 변경 때문에 `npm test` 전체 실행 시 테스트 1건(`portfolio-partial-balances.test.ts`)이 실패로 보일 수 있다. Reviewer·QA가 확인한 결과 T-013이 만든 파일과는 무관하며, T-013 관련 테스트만 따로 실행하면(`npx jest src/lib/notify`) 전부 통과한다.

**남은 일**: 커밋·배포는 사용자 승인 후 진행(운영 배포 경로라 push=즉시 배포). 승인하면 `git commit` + push로 배포하고, 배포 후 실제 텔레그램 메시지로 종목명이 정상 표시되는지 1회 육안 확인을 권장한다.
