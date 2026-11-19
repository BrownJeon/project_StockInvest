---
task_id: T-176
title: 장중 전략 평가 — 시총 순위 조회 실패가 평가 회차 전체를 멈추지 않게 + 순위 조회 오류 내용 기록
status: review
waiting: [push_approval]
priority: high
project: StockInvest
created: 2026-11-19
updated: 2026-11-19
base_ref: 2121566be6b20198388ccf45c3b404c21d32ca14
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa, deployer]
related_tasks: [T-175-outbound-connect-timeout-and-alert-retry, T-017-kis-rate-limit-throttle, T-168-paper-fill-engine-restore]
tags:
  - type/task
  - domain/strategy
  - domain/cron
  - domain/kis
aliases:
  - 장중 평가 실패 원인 수정
  - 시총 순위 조회 실패 격리
execution_context:
  schema_version: 1
  origin_tool: claude
  current_tool: claude
  current_procedure: claude_standard
  current_scope: 원인 확인·설계부터 구현·감사·QA·서버 worktree 커밋까지. push(=운영 배포)는 사용자 승인 후
  last_event_id: E1
---

# T-176 장중 전략 평가 — 시총 순위 조회 실패 격리 + 오류 내용 기록

작업 worktree: 서버 `~/.node-local/stockinvest-t176` (detached, base `2121566` = origin/main = 운영 릴리스 `20261119-083844-2121566b`). 커밋은 이 worktree 에서 한다(`commit-msg` 훅). `node_modules` 는 t175 worktree 로의 심볼릭 링크다 — **스테이징하지 않는다.**

## 목표·배경 (Leader)

2026-11-18 12:11 KST 장중 전략 평가(`strategy-eval`)가 HTTP 500 `fetch failed` 로 2초 만에 끝났다(그날 9회 중 1회). [[T-175-outbound-connect-timeout-and-alert-retry]] 조사에서 실제 원인이 텔레그램이 아니라 KIS 국내 시가총액 순위 조회라는 것이 드러났고, T-175 의 연결 대기 상향(IPv4 전용 호스트라 무관)으로는 막히지 않는다.

### 확인한 사실 (Leader, 2026-11-19 08:4x 서버 실측)

- 운영 `api-usage-2026-11-18.jsonl` 03:11:09.977Z `domestic.market-cap-ranking ok:false status:200 err:other`(코스피 페이지, 7ms) → 03:11:10.009Z 같은 op `status:0 err:network`(코스닥 페이지, 38ms).
- 경로: `runMarket`(`src/lib/strategy/engine.ts:1408`) → `refreshUniverse` → `refreshUniverseImpl`(`src/lib/strategy/universe.ts:191`) → `fetchMarketCapRanking`(`src/lib/exchanges/kis-domestic.ts:466`) 의 `Promise.all` → `fetchMarketCapPage` 의 `kisFetch` 가 **네트워크 오류를 던짐**. `!res.ok`·`rt_cd≠0` 은 `[]` 로 바뀌지만 던진 예외는 잡는 곳이 없어 `runMarket` → `runAll`(비 force 경로는 catch 없음) → 라우트 catch → 500.
- 이 시점에 청산 평가(exit engine)는 **이미 실행된 뒤**다(`runMarket` 앞부분). 멈춘 것은 그 회차의 진입 평가다.
- `refreshUniverseImpl` 의 기존 대체 경로: 순위가 빈 배열이면 `getKisTickers(ALL_SYMBOLS)`(정적 목록, `allSettled` 라 던지지 않음)로 후보를 만든다.
- 이전 universe 는 `getUniverseSymbols` 가 `UNIVERSE_TTL_MS × 2`(30분)까지 읽는다.

### 별도로 드러난 사실 — 이번 범위 밖, 사용자 결정 대기 (Leader)

- **시총 순위 조회가 지난 25일(로그 보존분 10-25~11-18) 동안 한 번도 성공하지 않았다.** 매 호출 `status:200 err:other`(= `rt_cd ≠ '0'`) → `[]` → 위 대체 경로. 날마다 37~44회 실패, 성공 0회.
- 그래서 `symbol_universe.tier` 가 **전부 `speculative`**(최근 2일 국내 3,800행 모두)이다.
- 그 결과 `portfolio-stability.ts` 의 코어 비율 가드(`stableCoreRatioMin` 0.20)가 국내 매수 후보를 막는다: `eval_funnel` `gate=portfolio_core_ratio` 스킵 11-16 639건·11-17 612건·11-18 905건, 상세 예 `매수 후 core 비율 0.0% < 임계 20% (003550 tier=speculative)`(003550 은 코스피 대형주). [[T-168-paper-fill-engine-restore]] 의 「국내 엔진 paper_fills 3일 0건」과 관련 있을 가능성 [가능성 높음].
- 순위 API 가 왜 `rt_cd≠0` 인지는 **응답 메시지를 기록하지 않아 모른다**. 요청 파라미터가 KIS 예제와 다르다(입력 가격·거래량 항목 누락, 코스닥 `FID_COND_MRKT_DIV_CODE='Q'`) [추측]. 또 KIS 순위 API 는 한 번에 30행 안팎만 주므로 「시총 1~100 = core」 설계 자체가 이 API 로는 채워지지 않을 수 있다 [추측].
- 이것을 고치면 국내 매수 후보가 코어 비율 가드를 통과하기 시작한다(현재 DRY_RUN) — **매매 동작 변경이라 사용자 결정 사항**이다. 이번 task 는 원인 진단에 필요한 오류 메시지 기록까지만 한다.

## 사용자 지시·승인 (원문 보존)

- 2026-11-19 08:4x 「장중 평가 실패 원인 수정 착수」 (직전 보고의 「12:11 장중 평가 실패의 진짜 원인 … 별도 task 권고」에 대한 답)
- push(운영 배포)는 이 승인 범위가 아니다 — 별도 승인.
- 2026-11-19 09:0x 순위 API·tier 문제(「별도로 드러난 사실」) 처리 질문에 「진단 후 별도 task (Recommended)」 선택 — 이번 task 는 회차 격리와 오류 메시지 기록까지만, 순위 API 파라미터·tier 설계는 배포 후 메시지로 원인을 확정한 뒤 별 task.
- Leader 결정(2026-11-19, Developer 질의): universe 갱신 실패를 홈 「데이터 이상·분석 실패」에 다시 띄우는 별도 알림은 **추가하지 않는다** — WP-1 이 원래 원인(순위 예외)을 대체 경로로 흡수하므로 WP-2 경로는 드물고, 로그·`eval_funnel`(`universe_refresh_failed`)·run 행 detail·분석 화면 이상 배너에 남는다. 필요해지면 후속 후보.

## 설계 (Leader — Developer 구현 사양)

화면 변경 없음. DDL 없음. 버전: 웹 `package.json`·`package-lock.json` 0.15.0 → **0.16.0**(마이너). 앱(APK) 무관.

### WP-1 순위 조회 예외를 「빈 결과」와 같게 처리
- `refreshUniverseImpl` 국내 분기에서 `fetchMarketCapRanking` 이 던지면 잡아서 **순위가 빈 배열일 때와 같은 기존 대체 경로**(`getKisTickers(ALL_SYMBOLS)`)로 간다. 새 동작을 만들지 않는다 — 지난 25일 매일 실제로 돈 경로다.
- 잡은 예외는 원인(T-175 `describeErrorCause` 재사용 — 코드·주소, 비밀·쿼리스트링 가림)과 함께 한 줄 로그로 남긴다.
- `fetchMarketCapRanking` 의 `Promise.all` 은 바꾸지 않아도 된다(호출부에서 잡으면 충분). 바꾸는 쪽이 낫다고 판단하면 근거를 적는다.

### WP-2 universe 갱신 실패가 회차를 멈추지 않게 (방어선)
- `runMarket` 의 `await refreshUniverse(market, opts.force)` 를 감싸, 던지면 `universeRefreshed=false` 로 계속 진행하고 이전 universe(최대 30분)를 쓴다. 다음 회차가 다시 갱신을 시도한다(refreshed_at 이 갱신되지 않으므로 자연히 재시도).
- 실패는 조용히 버리지 않는다: 로그 한 줄 + 평가 기록(`EvalFunnelRecorder` — 기존 `rec.error`/`rec.record` 중 맞는 것, reason 예 `universe_refresh_failed`)에 남긴다. reason 이 타입 유니온·화면 집계에 걸리는지 확인하고 필요한 곳만 넓힌다.
- **DB 오류는 어떻게 할지 판단해 적는다**: universe 갱신 중 DB 가 죽었다면 뒤의 평가도 DB 를 쓰니 어차피 실패할 것이다. 감싸는 범위를 「갱신 전체」로 할지 「외부 호출 실패만」으로 할지 근거와 함께 정한다.
- 해외(`overseas`) 분기도 같은 감싸기 안에 들어간다 — 동작 변화가 있으면 적는다.
- 응답 형식·HTTP 상태·`RunAllResult` 의미를 바꾸지 않는다. `errors` 배열에 넣으면 라우트가 `errors=1` 로 찍지만 `ok:true` 다 — 넣을지 여부는 홈 「데이터 이상·분석 실패」 집계·`job_run_log` 판정에 미치는 영향을 확인하고 정한다(성공한 회차를 실패로 보이게 만들지 않는다).

### WP-3 순위 조회 `rt_cd≠0` 의 응답 메시지 기록
- `fetchMarketCapPage` 가 `!res.ok` 또는 `rt_cd≠'0'` 로 `[]` 를 반환할 때 `rt_cd`·`msg_cd`·`msg1`(KIS 오류 문구 — 비밀 아님)과 시장 구분을 로그로 남긴다. 5분마다 2건이 나므로 **로그 홍수를 막는다**(예: 같은 msg_cd 는 프로세스당 일정 시간 1회). 반환값·동작은 바꾸지 않는다.
- 응답 본문 전체·헤더·토큰은 찍지 않는다.
- 목적: 배포 후 이 로그로 별도 결정 사항(순위 API 수정·tier 설계)의 원인을 확정한다.

### 범위 밖 (하지 않는다)
- 순위 API 파라미터 수정, tier 분류·코어 비율 가드 변경, `ALL_SYMBOLS` 변경 — 매매 동작 변경이라 사용자 결정 후 별 task.
- `runMarket` 안의 다른 외부 호출 중 회차 전체를 멈출 수 있는 곳이 더 있으면 **찾아서 보고만** 한다(파일:줄, 던지는 조건).

### 시험·검증 요구
- WP-1: 순위가 던질 때 대체 경로로 가서 `refreshed:true` 가 되는 시험, 빈 배열일 때 기존과 같음, 정상일 때 기존과 같음.
- WP-2: `refreshUniverse` 가 던져도 `runMarket` 이 끝까지 돌고(전략 평가 진입) 기록이 남는 시험. 기존 엔진 시험과 정합.
- WP-3: `rt_cd≠0` 일 때 메시지 로그 1줄, 반복 시 억제, 비밀 미포함, 반환값 `[]` 그대로.
- 전체 `tsc`·jest·`next build` — 무거운 시험은 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10 …`, Node `~/.node-local/v24.22.2/bin`. 기존 실패 묶음과 새 실패를 이름으로 구분해 보고(T-175 기준: 변경 전 실패 416건).
- 운영 DB 쓰기·`/api/cron/*` 호출·KIS 실호출·pm2 조작 금지.

## Developer

- [09:10] 실행 도구: claude(developer 서브에이전트), 서버 worktree `~/.node-local/stockinvest-t176`(base `2121566`). 커밋 없음.
- [09:10] **WP-1** `src/lib/strategy/universe.ts` — 국내 분기 순위 조회를 `fetchMarketCapRankingOrEmpty()` 로 감쌌다. 던지면 `[]` 를 돌려 기존 대체 경로(`getKisTickers(ALL_SYMBOLS)` → 거래대금 정렬 → tier 전부 speculative)로 간다. 원인은 `[universe:domestic] 시총 순위 조회 실패 — 정적 목록으로 대체: <msg> | <describeErrorCause>` 한 줄(console.warn, URL 쿼리스트링·제어문자 가림, 문자열화 불가 값도 안전). `fetchMarketCapRanking` 의 `Promise.all` 은 그대로 뒀다 — 한 페이지만 성공한 부분 결과로 tier 를 매기면(코스피만 core) tier 의 뜻이 바뀌므로 전부 대체 경로로 보내는 쪽이 기존 동작과 같다. 갱신은 TTL 15분당 최대 1회라 로그 억제는 두지 않았다.
- [09:10] **WP-2** `src/lib/strategy/engine.ts` `runMarket` — `refreshUniverse` 호출을 try/catch 로 감쌌다. 실패 시 `universeRefreshed=false` 로 계속(TTL 안이라 건너뛴 회차와 같은 상태, 이전 universe 최대 30분). 감싸는 범위는 **갱신 전체(DB 오류 포함)** 로 정했다 — 근거: 외부 호출만 골라 잡으려면 오류 종류 판별이 필요한데 판별이 틀리면 회차가 다시 통째로 멈춘다. DB 가 정말 죽었으면 뒤 평가(strategies 조회는 이미 앞에서 성공, 이후 `getUniverseSymbols`·쿨다운 등)가 DB 를 써서 종전처럼 500 이 되고, 일시 오류면 이번 회차를 살린다. 해외 분기도 같은 감싸기 안 — 동작 변화는 「해외 갱신이 던져도 회차 계속」뿐(해외 목록 원천은 자체 폴백이 있어 실제로 던질 곳은 DB·유량 대기열 정도).
- [09:10] WP-2 기록: ① 로그 `[strategy-eval:<market>] universe 갱신 실패 — 이전 후보 목록으로 평가 계속(최대 30분): <name: msg> | <cause>`(console.error) ② eval_funnel 새 게이트 `universe_refresh_failed`(stage 0, verdict error, symbol 없음, detail `{error, cause?}`) — `eval-funnel-labels.ts` 목록 끝 append + `GATE_STAGE`·`GATE_LABEL_KO`(「분석 후보 목록 갱신 실패 — 이전 목록으로 평가 계속」). `eval_funnel.gate` 는 VARCHAR(48)(운영 `SHOW CREATE TABLE` 읽기 전용 확인) — DDL 없음. ③ run 행 detail 에 실패 시에만 `universeRefreshFailed: true`(no_active_strategies 조기 반환 행 포함) ④ 응답 `errors[]` 에 `<market>_universe_refresh_failed`(오류 문구는 싣지 않음).
- [09:10] `errors[]` 에 넣은 근거(화면·판정 영향 확인): `job_run_log` — `classifyRun`(`src/lib/strategy/records/job-run-log.ts:331~`)은 HTTP 200 + `ok:true` 면 strategy-eval 의 `errors[]` 를 `all_markets_closed` 외에는 보지 않아 **`ok` 그대로**다(시험으로 고정) → 홈 「데이터 이상·분석 실패」(`anomalies.ts` 의 job_run_log failed/missing/degraded) 에 올라가지 않는다. 운용현황 「이상 n」(`funnel.ts` `COUNT(DISTINCT symbol) … verdict='error'`)은 symbol 이 NULL 이라 세지 않는다. 분석 화면 깔때기 이상 배너(`eval-funnel-query.ts` verdict='error' 게이트별 상위 5)에는 한글 라벨로 뜬다. 라우트 로그는 `errors=1` 로 찍힌다 — T-148 `collect_threw` 와 같은 「부분 실패 흡수」 표기라 성공한 회차를 실패로 바꾸지 않는다.
- [09:10] ⚠ 가시성 변화(Leader 판단 사항): 종전에는 이 예외가 500 → `job_run_log` failed → 홈 「데이터 이상·분석 실패」에 떴다. 이제는 로그·eval_funnel·분석 화면 배너·응답 errors[] 로만 남는다(pull 신호). 원인 지점(순위 조회)은 WP-1 이 막아 이 방어선까지 오는 경우는 드물 것 [가능성 높음]. 반복 실패 알림(T-148 의 `sendAlertThrottled` 같은)은 사양에 없어 넣지 않았다.
- [09:10] **WP-3** `src/lib/exchanges/kis-domestic.ts` `fetchMarketCapPage` — `!res.ok`(why=http, 본문 JSON 에서 rt_cd·msg_cd·msg1 만 꺼냄, 실패 시 `-`)·`rt_cd≠'0'`(why=rt_cd)·`rt_cd=0 인데 output 이 배열 아님`(why=output, 사양 밖이지만 같은 `[]` 반환 경로라 함께 기록 — 추가 로그일 뿐 동작 불변) 일 때 `[kis-domestic] 시총 순위 빈 결과 market=J(코스피) why=… http=… rt_cd=… msg_cd=… msg1=…` 한 줄(console.warn). 억제: (시장, HTTP, rt_cd, msg_cd) 조합마다 프로세스당 1시간 1줄, 다음 줄에 `(이전 n건 생략)`, 조합 상한 50. 각 값 제어문자 제거·길이 제한(rt_cd 8·msg_cd 24·msg1 120). 본문 전체·헤더·토큰·URL 미기록. 반환값·파라미터 불변. 시험용 `__resetMarketCapDiagForTest()` export(기존 `__resetKisThrottleForTest` 관례). 네트워크 예외는 종전처럼 던진다(WP-1 이 받음).
- [09:10] 버전 `package.json`·`package-lock.json`(2곳) 0.15.0 → 0.16.0.
- [09:10] 새 시험 3파일 24건: `src/lib/exchanges/__tests__/kis-market-cap-diag-t176.test.ts`(9 — rt_cd≠0 시장별 1줄·1시간 억제·생략 건수·msg_cd 별 조합·비밀/본문/URL/개행 미포함·HTTP 오류 본문 필드만·비JSON 본문·정상 무로그·output 비배열·네트워크 예외 전파), `src/lib/strategy/__tests__/universe-ranking-fallback-t176.test.ts`(6 — 던질 때 대체 경로 refreshed:true·tier speculative·원인 줄·쿼리 가림·문자열화 불가, 빈 배열·정상·대체 시세 0건 종전 동일), `src/lib/strategy/__tests__/engine-universe-refresh-isolation-t176.test.ts`(9 — 던져도 수집·run pass·기록·로그·errors 코드·DB 오류/비Error/동기 throw·no_active_strategies·정상 refreshed true/false 무변화·게이트 등록·classifyRun 200→ok/500→failed). 변이 확인: engine.ts·universe.ts 를 base 로 되돌려 실행하면 실패 경로 시험 9건이 실패(정상 경로 6건 통과) → 복원 후 diff 동일 확인.
- [09:10] 기존 시험 4파일의 「게이트 목록 끝 append」 위치 단언을 새 게이트만큼 밀었다(T-168 이 같은 방식으로 갱신한 선례): `engine-exit-state-load-isolation.test.ts`(끝에서 3→4번째), `engine-adaptive-validation-audit-t168.test.ts`(끝 → 끝에서 2번째), `engine-insufficient-cash.test.ts`·`engine-validation-gate.test.ts`(꼬리 배열에 `universe_refresh_failed` 추가). 1차 전체 jest 에서 뒤 2개가 새 실패로 잡혀 고친 것이다. mock 구조는 손대지 않았다.
- [09:10] 시험 결과: 대상 9파일 95건 통과(새 3 + 위 4 + `engine-collect-fanout-t148` + `strategy-eval-lane`). 전체 jest(flock): 480 suites / 13,001 tests 중 실패 416 — T-175 기준(`~/.node-local/t175-logs/fail-after.txt`, 477 suites/12,977 tests/실패 416, t175 worktree HEAD `2121566` = 이 base) 과 **이름 집합 동일(새 실패 0, 사라진 실패 0)**. 같은 추출 스크립트로 T-175 json 을 재추출해 기존 목록과 동일함을 먼저 확인했다. `tsc --noEmit` 0(출력 0줄). `next build` 0(Compiled successfully). lint 미실행(프로젝트에 ESLint 설정 없음). 로그: `~/.node-local/t176-logs/`.
- [09:10] 범위 밖 발견(보고만): `runMarket` 안에서 회차 전체를 멈출 수 있는 **잡히지 않은 외부(KIS·HTTP·LLM) 호출은 더 찾지 못했다** — 시세·캔들(수집 팬아웃 흡수), 거시(try), 잔고(`getHeldAmounts` → known:false), 청산 엔진(내부 try), 적응 배분 LLM(`allocateAdaptiveBuys` 내부 try), 이전 한도(try), 주문 한도(던지지 않는 불변식). 남은 잡히지 않은 호출은 **DB 전용**이다: `getStyleConfig`(engine.ts:1309)·`getEngineSwitches`(1317, 내부 폴백 있음)·`loadActiveCooldowns`(1318)·strategies 조회(1405)·`getEvalSymbols`(1486) → `getUniverseSymbols` 의 `pool.query`(universe.ts:344·359 부근, try 없음)·`setCooldown`(1786·1795) — DB 장애 시 던지며, 그때는 엔진 자체가 돌 수 없어 종전 동작(500) 유지가 맞다고 판단했다 [가능성 높음]. `isDomesticOpen`→`isHoliday`→`loadHolidaysFor` 는 try 가 있다.
- [09:10] 미검증: 운영에서 WP-3 로그가 실제로 어떤 msg_cd·msg1 을 찍는지(배포 후 확인 — 목적 자체) · 운영 pm2 에서의 로그 홍수 억제 실측 · 실제 KIS 네트워크 예외로 WP-1 경로 진입(시험은 모의 예외) · Codex 검토 없음 · 커밋 훅 통과 여부(커밋은 Leader).
- [09:10] Reviewer scope 에 넣어야 할 변경 파일(모두 `SAFETY_PATHS` 대상 `^src/lib/strategy/`·`^src/lib/exchanges/`): `src/lib/strategy/universe.ts`, `src/lib/strategy/engine.ts`, `src/lib/strategy/eval-funnel-labels.ts`, `src/lib/exchanges/kis-domestic.ts`, `src/lib/strategy/__tests__/engine-exit-state-load-isolation.test.ts`, `src/lib/strategy/__tests__/engine-adaptive-validation-audit-t168.test.ts`, `src/lib/strategy/__tests__/engine-insufficient-cash.test.ts`, `src/lib/strategy/__tests__/engine-validation-gate.test.ts`, (신규) `src/lib/strategy/__tests__/engine-universe-refresh-isolation-t176.test.ts`, `src/lib/strategy/__tests__/universe-ranking-fallback-t176.test.ts`, `src/lib/exchanges/__tests__/kis-market-cap-diag-t176.test.ts`. 그 밖 `package.json`·`package-lock.json`(감시 밖). `node_modules` 심볼릭 링크는 스테이징 금지.
- [09:10] 안전장치 self-check: 주문 경로·`submitOrder`·safety 레이어 미변경(DRY_RUN·KILL_SWITCH·한도·심볼·orders 기록 경로 영향 없음 — diff 상 주문 관련 코드 0줄). 운영 DB 쓰기·`/api/cron/*`·KIS 실호출·pm2·`.env`·push 없음(DB 는 `SHOW CREATE TABLE eval_funnel` 읽기 1회).

## Reviewer

- [09:40] 실행 도구: claude(reviewer 서브에이전트). 검토 범위: 서버 worktree `~/.node-local/stockinvest-t176` 의 `git diff`(base `2121566`) 전체와 미추적 시험 3개. 읽은 코드: `engine.ts` runMarket 1300~1500·1850~1900, `universe.ts` 165~370, `kis-domestic.ts` 436~545, `route.ts` strategy-eval, `job-run-log.ts` classifyRun, `eval-funnel.ts` error/flush, `describeErrorCause`. 주문·safety·`submitOrder` 경로 diff 0줄 확인.
- [09:40] 의도 검증 [확실]: 순위 조회가 던지면 `fetchMarketCapRankingOrEmpty` 가 `[]` 로 바꿔 기존 대체 경로(`getKisTickers(ALL_SYMBOLS)`)로 가고, `refreshUniverse` 전체가 던져도 `runMarket` 이 `universeRefreshed=false` 로 평가를 계속한다. 청산 엔진은 `runExitEngine`(engine.ts:1333)이 universe 갱신(1431)보다 **앞**이라 영향 없다.
- [09:40] 시험 재실행 [확실]: 대상 7파일(새 3 + 수정 4) `Test Suites 7 passed / Tests 64 passed`(`~/.node-local/t176-logs/review-jest.log`). 전체 jest 416 실패 이름 집합 동일 주장은 Developer 기록을 신뢰하며 재실행하지 않았다(미확인).
- [09:40] medium M-1 (`engine.ts:1416~1420` 주석·`universe.ts:313~320`): 「refreshed_at 이 갱신되지 않으므로 다음 회차가 자연히 재시도」는 **갱신이 심볼 INSERT 도중(DB 오류)에 던진 경우 사실이 아니다.** 그 INSERT 는 트랜잭션 없이 행마다 실행되고 한 번의 `now` 를 refreshed_at 으로 쓰므로, 일부 행만 들어가면 최신 refreshed_at 이 이미 존재해 TTL(15분)이 재시도를 막고 `getUniverseSymbols` 가 부분 universe(예: trend 만 채워지고 breakout 비어 있음)를 읽는다. 이 위험 자체는 base 에도 있었다(500 이어도 다음 회차들이 같은 부분 universe 를 읽음)지만, 이제 **같은 회차가 부분 universe 로 계속 평가**한다. 영향은 후보가 줄어드는 정도이며 주문·한도·청산 경로에는 닿지 않는다(DRY_RUN 중). 권고: 주석의 「자연히 재시도」를 「외부 호출 실패일 때」로 한정하고, 부분 INSERT 방어(트랜잭션)는 별 task 후보로 남긴다. 차단 사유 아님.
- [09:40] low L-1 (가시성, Leader 결정으로 수용): 이전에는 500 → `job_run_log` failed → 홈 「데이터 이상·분석 실패」였으나 이제 `classifyRun`(200+ok:true 는 `errors[]` 를 `all_markets_closed` 외에는 보지 않음, job-run-log.ts:398 부근 확인)이 `ok` 로 분류해 홈에 뜨지 않는다. Developer 설명과 코드가 일치한다. `eval_funnel` 행은 symbol NULL 이고 `gate` 컬럼은 VARCHAR(48), 새 게이트명 23자라 INSERT 실패 가능성 없음. 화면 쪽은 `FUNNEL_GATES`/`GATE_STAGE`/`GATE_LABEL_KO` 를 읽는 곳이 `eval-funnel-labels.ts`·`engine.ts` 뿐(.tsx 참조 0건)이라 별도 수정 필요 없음.
- [09:40] low L-2 (WP-3 `kis-domestic.ts:476~486`): 억제 맵이 상한 50 에서 가장 오래된 조합을 지우면 그 조합의 「생략 n건」 카운트가 사라진다. 조합 수가 실제로는 시장 2 × 소수의 rt_cd/msg_cd 라 사실상 도달하지 않는다. 메모리는 상한 고정, 단일 스레드라 동시성 문제 없음. 로그에는 시장·HTTP·rt_cd·msg_cd·msg1(제어문자 제거, 120자 제한)만 있고 본문·헤더·토큰·URL·appkey 는 없다. 반환값 `[]`·요청 파라미터 불변 확인.
- [09:40] low L-3 (WP-1 `universe.ts:187~201`): 던지는 원인이 일시 장애여도 그 갱신은 tier 가 전부 speculative 로 확정돼 15분간 유지된다(이미 25일 매일 돈 경로와 같음). 새 회귀 아니며 task 본문의 별도 결정 대기 항목(코어 비율 가드)과 같은 계열이다. 조치 불필요.
- [09:40] 시험 회귀망: 기존 4파일 수정은 「끝에서 n번째」·`slice(-n)` 위치를 새 게이트만큼 민 것뿐이며 단언 강도는 같고 오히려 새 꼬리 순서까지 고정한다. 느슨해진 곳 없음. 버전 `package.json`·`package-lock.json`(루트 1곳 + `packages[""]` 1곳) 모두 0.16.0 으로 일치.
- [09:40] 집계: critical 0 · high 0 · medium 1 · low 3. QA high_risk_areas: `engine.ts:1428~1445`(try/catch 범위·errors[] 전파), `engine.ts:1481`·`1501`(errors 병합), `universe.ts:187~201`, `kis-domestic.ts:520~535`(res.json() 이전 분기). QA 에게 권고: 모의 환경에서 `refreshUniverse` 가 INSERT 도중 던질 때 부분 universe 로 평가되는지 한 번 관찰(M-1).
- [09:40] **최종 판정: PASS (scope: src/lib/strategy/universe.ts, src/lib/strategy/engine.ts, src/lib/strategy/eval-funnel-labels.ts, src/lib/exchanges/kis-domestic.ts, src/lib/strategy/__tests__/engine-exit-state-load-isolation.test.ts, src/lib/strategy/__tests__/engine-adaptive-validation-audit-t168.test.ts, src/lib/strategy/__tests__/engine-insufficient-cash.test.ts, src/lib/strategy/__tests__/engine-validation-gate.test.ts, src/lib/strategy/__tests__/engine-universe-refresh-isolation-t176.test.ts, src/lib/strategy/__tests__/universe-ranking-fallback-t176.test.ts, src/lib/exchanges/__tests__/kis-market-cap-diag-t176.test.ts)**

## Judge

- [09:0x] intake(jev-1.13.0, `judge-result@2`): task_type `local_fix` · complexity 1.6 · needs_info false · risk R2(`R2-kw-payment`) · developer_model opus · roles designer·developer·reviewer·qa · demo `delta`(`DM-kw-risky-cta`). 출력 사본: 세션 scratchpad `judge/judge-task-176-intake.out.json`.
- [09:0x] Leader 조정: demo `delta` → **none**. 근거 — 화면 파일 변경 없음(변경은 `src/lib/strategy/`·`src/lib/exchanges/`·시험·버전뿐), 규칙이 요약문의 부정 문장(「화면·DDL·APK 변경 없음」「실주문 경로는 바꾸지 않는다」)의 키워드를 잡은 것. designer 미투입.
- [09:0x] C1(`codex_gate`): codex_required false · budget_rule `CX-limit-unknown-r2` · codex 스위치 on.

- [09:1x] C2(`codex_gate`, reviewer pass 직후): codex_required **true** · mode adversarial-review · focus error_handling · budget_rule `CX-limit-unknown-r2` · rule_overrides 없음 · 스위치 on. → codex 역할 실행했으나 서버 Codex 모델 설정 거부(HTTP 400 `model_not_found`)로 **incomplete** — 아래 「Codex 검토」 절. 지적 0건은 미검토라는 뜻이다.

## QA
- [09:25] 실행 도구: claude(qa 서브에이전트). 서버 worktree `~/.node-local/stockinvest-t176`(base `2121566`, 미커밋 변경 그대로). 커밋·push·운영 DB 쓰기·`/api/cron/*`·KIS 실호출·pm2 없음. 산출물: `~/.node-local/t176-logs/qa-*.log`, 시나리오 시험 원본 `~/.node-local/t176-logs/qa-scenarios/`. 재현: Node v24.22.2, `flock /tmp/stockinvest-heavy-tests.lock nice -n 10 npx jest --ci …`. UI 변경 없음 → 화면 검증 해당 없음.
- [09:25] 1 대상 시험 재실행: 신규 3 + 수정 4 + `src/app/api/cron/__tests__/strategy-eval-lane.test.ts`(8 suites) → 8 passed, 92 tests passed(`qa-targeted.log`). 엔진·universe·kis·eval-funnel·job-run-log 를 import 하는 관련 묶음 107개 파일 실행 → 98 passed·8 failed·1 skipped(`qa-related.log`). 실패 8개 파일은 전체 jest 기준선 실패 이름에 모두 있음(확인함).
- [09:25] 2 전체 jest(`qa-full.json`, 480 suites / 13,001 tests): 실패 416 tests·27 suites. 기준선 `~/.node-local/t175-logs/fail-after.txt`(같은 base `2121566`)와 **이름 비교: 새 실패 0건, 사라진 실패 0건**(`qa-new.txt` 0줄). developer 의 `t176-logs/fail-after.txt`(418줄)는 기준으로 쓰지 않았다.
- [09:25] 3 `tsc --noEmit` exit 0(출력 0줄). `next build` exit 0 — `Compiled successfully in 5.0s`(`qa-build.log`). next build 가 worktree `.next` 를 갱신했다. 추적 파일 변경은 Developer 기록과 같은 10개.
- [09:25] 4(a) 순위 조회 네트워크 예외 → 대체 경로 — **PASS**. 실제 `universe.ts` 를 scratch 사본에서 실행, KIS 는 모의(`qa-scenarios/qa-t176-universe.test.ts` 3건 통과): `refreshUniverse` → `{refreshed:true}`, `getKisTickers` 대체 경로, tier 전부 `speculative`, 경고 1줄 `[universe:domestic] 시총 순위 조회 실패 — 정적 목록으로 대체: fetch failed | cause=ETIMEDOUT`(쿼리스트링의 `appkey` 값 미포함). 문자열 throw 도 같은 경로로 간다.
- [09:25] 4(b) 전체 던짐 → 회차 계속·기록·응답 — **부분 확인, NOT_VERIFIED 포함**. developer 작성 모의 시험 `engine-universe-refresh-isolation-t176.test.ts` 9건을 QA 가 재실행해 PASS 확인. 독립 engine 시나리오는 QA 가 작성하지 않았다(실 DB·실 엔진 전체 경로는 미검증). 라우트: `route.ts:91` 은 `NextResponse.json({ok:true,...result})`, 실패 코드 `<market>_universe_refresh_failed` 는 `realErrors` 에 들어 로그 `errors=1` 만 찍는다(코드 읽기 근거, HTTP 실호출 없음). `classifyRun` 의 ok 판정도 코드 읽기로 Developer·Reviewer 기록과 같음을 확인.
- [09:25] 4(c) INSERT 도중 DB 예외 (Reviewer M-1 동작 기록) — **관찰 사실, 결함 판정 아님**. 5번째 `symbol_universe` INSERT 에서 던지게 한 모의: 앞 4행이 남고 갱신은 reject, runMarket 은 WP-2 로 잡아 계속. 1분 뒤 다음 회차 `refreshUniverse(false)` → `{refreshed:false}`(TTL 15분 안이라 재시도 없음), `getUniverseSymbols('trend', 50, 'domestic')` → **4건**(정상 갱신 대조군 12건). 즉 부분 목록이 최대 30분 동안 평가 후보가 된다. 근거: universe.ts INSERT 는 트랜잭션 없이 행마다 실행되고, TTL 검사는 최신 `refreshed_at` 하나만 본다(`universe.ts:215`). base 에도 같은 위험이 있었다(500 뒤 다음 회차가 같은 부분 목록을 읽음). 이번 변화는 **같은 회차가 부분 목록으로 계속 평가한다**는 것뿐이며 주문 경로에는 닿지 않는다(DRY_RUN). 권고: Reviewer M-1 과 같음. 별 task 후보(INSERT 트랜잭션 또는 완료 표지).
- [09:25] 4(d) rt_cd≠0 반복 — **PASS**(`qa-scenarios/qa-t176-diag.test.ts` 3건 + developer 시험 9건 통과). 3회 호출 → 코스피·코스닥 각 1줄(`[kis-domestic] 시총 순위 빈 결과 market=J(코스피) why=rt_cd http=200 rt_cd=1 msg_cd=OPSQ0002 msg1=…`), 반환 `[]`, 토큰·앱키·시크릿·`Bearer` 미포함. 61분 뒤 재발 시 `(이전 n건 생략)` 표기. 정상 `rt_cd=0` 은 무로그. 참고: 시험 파일 안에서 억제 상태가 공유돼 「이전 4건」으로 찍힌 것은 시험 설계 탓이며 운영 동작과 무관하다(누적 생략 건수가 맞다).
- [09:25] 5 안전장치 회귀 — **PASS**. `git diff 2121566` 에서 `createOrder`·`cancelOrder`·`submitOrder`·safety·`src/lib/signals`·exit 엔진 본체 변경 0줄(`git diff --name-only` 에 `src/lib/safety`·`src/lib/signals` 없음, `kis-domestic.ts` 변경은 `fetchMarketCapPage` 와 신규 로그 헬퍼뿐). 순서 유지: `runExitEngine`(engine.ts:1333) → `refreshUniverse`(engine.ts:1431).
- [09:25] 6 `eval_funnel.gate` = `varchar(48) NOT NULL`(`SHOW CREATE TABLE eval_funnel`, 읽기 전용). `universe_refresh_failed`(23자) 적합. `verdict` enum 에 `error` 있음. **PASS**.
- [09:25] 7 버전: `package.json` 0.16.0 · `package-lock.json` 루트·`packages[""]` 0.16.0 일치. **PASS**.
- [09:25] 발견 결함: Critical 0 · High 0 · Medium 0 · Low 0(신규). Reviewer M-1 은 4(c) 로 동작을 확인했고 판정에는 영향 없음. 저위험 관찰 1 [추측]: `fetchMarketCapRankingOrEmpty` 의 catch 안 `describeErrorCause(e)` 는 try 밖이다. 여기서 던지면 WP-2 가 받아 회차는 살지만 로그 대신 `universe_refresh_failed` 경로로 간다. 드문 경우라 조치는 불필요하다.
- [09:25] 미검증(`NOT_VERIFIED`): 운영 KIS 실제 네트워크 예외 경로(모의 예외만) · 실 DB 장애 중 INSERT 중단의 운영 동작 · runMarket 전체를 실 DB·실 엔진으로 돌린 독립 시험(4(b) 는 developer 시험 재실행) · 라우트 HTTP 응답의 실제 호출(코드 읽기만) · WP-3 로그의 실제 msg_cd·msg1(배포 후 확인 대상) · 운영 pm2 에서의 로그 억제 실측 · 커밋 훅 통과 여부(Leader).
- [09:25] 정리: QA 는 프로젝트 파일을 수정하지 않았다. 시험 파일은 scratch 사본에서만 실행 후 삭제했고 사본 원본은 `qa-scenarios/` 에 보존했다. 스크린샷 산출물 없음.
- [09:25] QA 판정: pass


## 배포 기록

## 실행 도구·절차 이력

| event | 시각 | 종류 | 도구 / 절차 | 범위 | 근거 |
|---|---|---|---|---|---|
| E1 | 2026-11-19 08:5x | start | claude / claude_standard | 원인 확인·설계부터 구현·감사·QA·커밋까지(push 제외) | 사용자 「장중 평가 실패 원인 수정 착수」 |

## Codex 검토

### [2026-11-19 09:20] C2 adversarial-review focus=error_handling — 실패(codex_exit_1: 모델 설정 오류 model_not_found)
- judge 판정: judge 출력 `judge-task-176-c2.out.json`(codex_required true, mode adversarial-review, focus error_handling, budget_rule CX-limit-unknown-r2, 판정 시 호출 0회) / 호출 차수: 0/4 (T-176 키 기준 — 아래 「실행 인자 오류」 참고)
- 실행: 래퍼 status incomplete, reason codex_exit_1, exit_code 1, 3초 종료. 재시도 없음.
  - 원인: Codex CLI 0.157.1 이 설정 모델 `gpt-6.1-sol` 을 ChatGPT 계정에서 거부(HTTP 400 `model_not_found`). 설정 `~/.codex/config.toml` 은 변경하지 않았다(사용자 결정 사항). T-170·T-173 (11-15) 과 같은 원인이다.
- 대상: repo=/home/brownjeon/.node-local/stockinvest-t176 base=2121566(HEAD_fallback) snapshot=44d5bdd. base_source 가 HEAD_fallback 로 찍힌 것은 실행 인자 오류 때문이다(아래). HEAD 가 task 의 base_ref 와 같은 2121566 이어서 검토 범위 자체는 맞다.
- 실행 인자 오류(실행자 실수): `--task task-176` 로 넣어 래퍼가 `task-176-*.md` 를 찾았고, 실제 파일명은 `T-176-universe-refresh-failure-isolation.md` 라 base_ref 를 읽지 못했다. 같은 실행의 호출 기록도 `counts/task-176.json`(calls 1) 에 남았고 `counts/T-176.json` 에는 없다. 정정은 사용자·Leader 확인 후 한다(기록 파일은 이번에 손대지 않았다).
- 지적 0건 — 모델이 실행되지 않아 검토가 이뤄지지 않았다. 「지적 없음」이 아니다.
- 검토하지 못한 범위: 허용 파일 전부 — src/lib/strategy/universe.ts, src/lib/strategy/engine.ts, src/lib/strategy/eval-funnel-labels.ts, src/lib/exchanges/kis-domestic.ts 와 시험 7개. 집중 질문 3건(부분 universe, 오류 삼킴, 비밀 노출)도 모두 미검토.
- 재실행 대기: 설정 모델 수정 또는 CLI 조치 후 사용자가 재실행을 정하면, 인계 묶음 `~/.node-local/codex-handoff/codex-handoff-task-176-c2.md` 를 그대로 쓰되 `--task T-176` 으로 넣는다.
- 원본: `/home/brownjeon/NFS/homes/brownjeon/project/.claude/state/codex-review/runs/20261119T002029Z-task-176-C2/` (stderr.txt 에 오류 원문, raw.txt 는 비어 있음)
- 다음: Leader 가 C2 Codex 미검토 상태를 사용자에게 알리고, Reviewer 1차 결과(중간 1·낮음 3)로 진행할지 사용자가 정한다.

## 최종 요약

### [T-176] 장중 전략 평가가 시총 순위 조회 실패로 통째로 멈추지 않게 + 순위 조회 오류 내용 기록

- **상태**: 구현·Reviewer pass(critical·high 0, medium 1, low 3)·QA pass 완료, 서버 worktree 커밋. **운영 배포(push)는 사용자 승인 대기.**
- **무엇이 바뀌었나**
  - **WP-1**: 국내 시총 순위 조회(KIS)가 네트워크 오류로 던지면, 순위가 빈 결과일 때와 같은 기존 대체 경로(정적 종목 목록 시세)로 후보를 만든다. 원인 코드·주소는 한 줄 로그(비밀·쿼리스트링 가림).
  - **WP-2**: universe 갱신 전체가 실패해도 그 회차의 진입 평가를 이전 universe(최대 30분)로 끝까지 돌린다. 실패는 로그·`eval_funnel`(`universe_refresh_failed`)·run 행 detail·라우트 `errors=1` 에 남고, 회차는 `ok`(HTTP 200)다 — 그래서 홈 「데이터 이상·분석 실패」에는 뜨지 않는다(Leader 결정).
  - **WP-3**: 순위 조회가 KIS 오류(`rt_cd≠0`)로 빈 결과를 낼 때 시장·HTTP 상태·`rt_cd`·`msg_cd`·`msg1` 을 로그로 남긴다(같은 조합은 프로세스당 1시간에 1번). 요청 파라미터·반환값은 그대로다.
  - 웹 버전 0.15.0 → **0.16.0**. 화면·DB·앱(APK)·주문·안전장치·청산 엔진 변경 없음(QA 가 diff 로 확인).
- **배포**: 미배포 — push 가 곧 운영 blue/green 배포. 같은 배포에 실릴 다른 작업: 없음(origin/main `2121566` 위에 이 커밋만).
- **AI 가 검증한 것**: 새 시험 24건 · 대상 시험 8 suites 92 tests 통과 · 전체 jest 13,001건 중 실패 416건이 변경 전과 이름까지 같음(새 실패 0) · `tsc` 0 · `next build` 0 · 새 gate 가 운영 `eval_funnel.gate` varchar(48)에 들어감 · 청산 엔진이 universe 갱신보다 먼저 도는 순서 유지.
  - 검증 못 한 것: 실제 KIS 네트워크 오류·실 DB 장애에서의 운영 동작(모의만) · 순위 API 의 실제 `msg_cd`·`msg1`(배포 후 로그로 확인) · 로그 억제의 운영 실측 · **Codex C2 외부 검토(판정상 필요, 서버 Codex 모델 설정 거부로 incomplete)** · lint(ESLint 설정 없음).
- **👉 사용자가 확인할 것** (배포 후): 특별히 없음. AI 가 배포 뒤 첫 국내 장중 회차에서 순위 조회 오류 메시지(`msg_cd`·`msg1`)를 읽기 전용으로 확인해 보고한다.
- **👉 사용자가 결정할 것**
  1. **push(운영 배포) 시점** — 권고: 국내 장 마감 뒤 15:40~20:00(장중 평가 회차를 피해서). 지금은 국내 장중이다.
  2. 서버 Codex 설정(모델 값 또는 CLI 0.157.1 갱신) — 이번 C2 도 이것 때문에 못 돌았다.
- **남은 일 (후속 후보)**
  - **시총 순위 API 가 25일째 매번 실패 → 국내 전 종목 tier `speculative` → 코어 비율 가드가 국내 매수 후보를 막음**(11-16~18 하루 600~900건). 사용자 결정: 배포 후 WP-3 메시지로 원인을 확정한 뒤 별 task([[T-168-paper-fill-engine-restore]] 와 관련 가능성).
  - Reviewer M-1·QA 4(c): universe INSERT 도중 DB 오류면 부분 universe 가 15분간 쓰인다(base 에도 있던 위험, 이번엔 같은 회차도 계속 평가). 트랜잭션 INSERT 또는 완료 표지 — 별 task 후보. 관련 코드 주석(「다음 회차가 자연히 재시도」)이 이 경우엔 맞지 않는다.
  - Codex 호출 기록이 `counts/task-176.json` 으로 잘못 남음(codex 역할 인자 실수, 기능 영향 없음).
- **이슈·위험**: Reviewer low 3건(억제 맵 상한 도달 시 생략 건수 소실 — 실제 도달 어려움 등). 위험 수준 R2, DRY_RUN 유지.
