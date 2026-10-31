---
task_id: T-133
title: 시세 조회(getTicker)가 HTTP 200 업무실패(SESSION FULL)를 재시도 없이 실패로 끝내는 문제 — 일시 실패 재시도 + 업무실패 명시 실패
status: deployed
priority: medium
project: StockInvest
created: 2026-10-31
updated: 2026-10-31
base_ref: origin/main ad45efc (로컬 main c593300)
risk_level: R2
roles_involved: [leader, reviewer, qa]
related_tasks: [T-132-kis-gateway-transient-retry, T-017-kis-http-gateway, T-012-balances-partial-failure]
tags:
  - type/task
  - domain/safety
  - domain/exchange
aliases:
  - 시세업무실패재시도
---

## 발단

[[T-132-kis-gateway-transient-retry]] 배포(2026-10-31 14:01) 뒤 운영 로그를 보다가 발견했다. 사용자 지시 「네, 고쳐주세요」(T-132 보고의 결정 ①).

T-132 는 **잔고·예수금**만 고쳤고 **시세 경로는 그대로** 뒀다 — 시세는 HTTP 500 만 재시도하고 HTTP 200 + `rt_cd≠'0'`(SESSION FULL)은 1회 실패로 끝낸다.

## 측정 (읽기 전용, 2026-10-31 14:00~14:20 KST)

| 항목 | 값 |
|---|---|
| 오늘 `overseas.get-ticker` | 602건 호출 / 실패 57건 (9.5%) |
| 오늘 `domestic.get-ticker` | 167건 호출 / 실패 5건 (3.0%) |
| 시세 호출량 | 약 130건/시간(두 시장 합계) |
| `[portfolio-total] … 시세 조회 실패 — 이 종목은 총액에서 제외` | 오늘 **11건**(SESSION FULL 10 · 그 밖 1), 09:41·09:58·10:49·12:19·12:51·13:16·13:59 + 배포 후 14:0x 1건 |
| `[portfolio-snapshot] ticker 실패 … avgPrice fallback` | **0건** — 스냅샷 경로는 오늘 시세 실패를 겪지 않았다 |
| 드로다운 킬스위치·변동폭 가드 발동 | 0건 |

### 🔴 영향 범위 정정 (중요 — 첫 보고가 과장이었다)

11건의 제외는 **전부 `portfolio-total`(주문 한도 입력) 경로**다. `src/lib/safety/portfolio-total.ts:123-130` 의 주석이 말하듯 **이 제외는 의도된 설계**이고 방향이 **보수적**이다 — 총액이 작아지면 주문 한도(pct)도 작아져 **신규 매수가 줄어든다**. 돈이 위험해지는 방향이 아니다.

스냅샷 경로(`src/app/api/cron/portfolio-snapshot/route.ts:171-196`)는 **따로 `avgPrice` 폴백**을 갖고 있고("제외하면 총액이 급락해 오탐 발생"), 그 총액이 `checkAndTriggerDrawdownKillSwitch()` 의 입력이다 — 즉 **킬스위치 오발동 위험은 이미 막혀 있다**. 오늘 이 경로의 시세 실패는 0건이었다.

따라서 이 task 는 **T-012 급 위험의 해소가 아니라, 안전장치 입력의 원인 모를 과소평가를 줄이는 품질 개선**이다. `portfolio-total.ts` 의 주석도 "원인 모를 과소평가가 남으면 안 된다"고 적어 뒀다. 우선순위를 high 가 아니라 **medium** 으로 둔 이유다.

## 우리 쪽 결함

1. **HTTP 200 + `rt_cd≠'0'` 에 재시도가 없다.** 두 어댑터 모두 손으로 만든 재시도 루프가 `res.status === 500`(국내) / `>= 500 || 429`(해외)만 본다. SESSION FULL 은 `res.ok === true` 라 루프를 비껴가고, `data.output` 이 없어 `no output` 으로 던진다.
2. **실패 메시지가 본문 전체 JSON 덩어리다** — `KIS overseas getTicker no output: {"rt_cd":"9",…}`. `rt_cd`·`msg_cd`·`msg1` 로 분류된 메시지가 아니라 로그 집계·원인 구분이 어렵다.
3. (부수) 손으로 만든 루프가 T-132 의 게이트웨이 재시도와 **겹친다** — 그냥 `transientRetries` 를 더하면 바깥 루프 × 안쪽 루프로 호출이 곱해져 T-017 이 막으려던 재시도 증폭이 부활한다.

## 변경 (WP)

- **WP1** `kis-domestic.getTicker`: 손으로 만든 3회 루프 제거 → `kisFetch(…, { label: 'domestic getTicker', transientRetries: 2 })` 한 번. 레이트리밋 즉시 던지기 유지. `rt_cd≠'0'` 명시 실패 추가.
- **WP2** `kis-overseas.getTicker`: 응답 기반 500 재시도 제거(→ `transientRetries: 2`). **던진 예외(타임아웃·네트워크) 재시도 1회는 유지** — `kisFetch` 는 던진 예외를 재시도하지 않으므로 제거하면 기능 후퇴다. `timeoutMs: 5000` 은 `kisFetch` 안에서 **시도마다 새로 걸린다**(코드 확인: 루프 안에서 `setTimeout` 생성). 레이트리밋 즉시 던지기 유지. `rt_cd≠'0'` 명시 실패 추가.
- **WP3** 멱등성 울타리 시험(`kis-balances-business-failure.test.ts`)의 허용 라벨 3 → **5** 로 갱신(+`domestic getTicker`·`overseas getTicker`). 두 시세 호출 모두 GET 이라 `kisFetch` 런타임 가드를 통과한다.
- **WP4** 시험 추가 — 어댑터 수준(업무실패 던지기·`rt_cd=0` 회귀·`rt_cd` 없는 응답 회귀)과 종단(실제 `kisFetch` 로 500·SESSION FULL 복구·소진 시 던지기·예외 재시도 유지).

### 재시도 예산을 2 로 둔 근거 (fan-out 증폭 검토)

시세는 잔고와 달리 **틱당 N건 fan-out**(`mapWithLimit`, `DEFAULT_FANOUT_CONCURRENCY = 4`)이라 증폭이 더 민감하다. 그래도 2 로 두는 이유:

- **국내는 지금도 3회 시도**(1+2)다. 1 로 내리면 **기존 견고성이 후퇴**한다. 2 는 국내 예산을 그대로 두고 `rt_cd≠0` 만 추가로 덮는다. 해외는 2회 → 3회로 1 늘어난다.
- 증폭 상한: 오늘 시세 실패 62건 × 최대 2회 = **+124건**, get-ticker 769건 대비 **+16%**(관측된 복구는 전부 2회차였으므로 실제는 +9% 수준).
- `kisFetch` 는 재시도마다 **스로틀 토큰을 새로 받는다**(`acquireKisSlot` 이 루프 안) — 버스트가 아니라 줄서기라 레이트리밋을 스스로 키우지 않는다.
- 백오프가 300ms 고정에서 게이트웨이 0.4s·1.2s 로 바뀐다 → 실패 종목마다 틱 시간 최대 +1.6s. 동시성 4·보유 7종목이면 2웨이브라 틱 영향은 작지만 **측정하지 않았다**(아래 미확인).

## 하지 않는 것

- **`portfolio-total.ts` 의 제외 정책은 바꾸지 않는다.** 보수적 방향이고 의도된 설계다(위 정정). 바꾸려면 한도 정책 결정이라 사용자 판단 사항이다.
- 스냅샷 경로 `avgPrice` 폴백도 그대로 둔다(이미 올바르게 동작).
- **시세 경로의 토큰 만료(EGW00123) 처리는 손대지 않는다** — 발견한 기존 공백이지만 범위가 다르다(아래 후속 후보).
- `getCandles`·`getDailyCandles`·`getActiveOrders` 등 다른 조회 경로는 이번 범위 밖.

## 중복 점검 (다른 세션)

다른 세션([메뉴화면개편 _ 주식매매], 현재 idle)의 범위는 `src/lib/strategy/engine.ts`·`job_run_log`·설정 화면·`analysis-runs.ts`·`scripts/cron-runner.sh` 이고 `src/lib/exchanges/` 는 들어 있지 않다. T-132 때와 같은 판정. 그 세션 파일·`.codex/` 는 손대지 않는다.

## 후속 후보 (이 task 범위 밖)

1. **시세 경로 토큰 만료 공백** — `getTicker` 두 곳 모두 `EGW00123` 재발급 경로가 없다(잔고는 어댑터 루프에 있다). 토큰이 만료되면 시세는 재시도 예산을 같은 만료 토큰으로 전부 태운다. `getKisToken` 의 선제 갱신이 얼마나 덮는지 확인이 먼저다.
2. `portfolio-total` 제외 정책 — 한 종목 시세 실패를 "제외"가 아니라 "직전 정상 시세" 또는 "총액 unknown" 으로 둘지(한도 정책 결정).
3. `fallbackFor` 나이 상한 (T-132 후속에서 이월).
4. 숫자형 `rt_cd` 정규화 (T-132 QA 관찰에서 이월).
5. `getCandles`·`getDailyCandles` 의 HTTP200 업무실패 처리 점검.
6. **4xx + `rt_cd≠0` 도 이제 재시도한다** — 영구 업무실패가 운영 로그에 없었고 `universe`·`favorites` 경로는 미확인이라, 실제 사례를 보기 전에는 분기를 더하지 않았다(1차 감사 Info I-2).
7. **울타리 스캔 범위** — `src/lib/exchanges/*.ts` **최상위만** 본다. 하위 디렉터리·`.tsx`·`.js`·`kis-http.ts` 본문·문자열 연결로 조립한 키·JSON 문자열 속 키는 못 잡는다(2차 QA L1 가 7종으로 실증, 전부 런타임 가드가 막는다). 파서 기반이 됐으니 재귀 스캔으로 넓히기는 쉽다.
8. **토큰 판정 사본 정리** — `getBalances`·`getUsdCash` 는 아직 손으로 `EGW00123` 만 보고, `kis-ledger-query.ts:143` 에도 같은 사본이 하나 더 있다(2차 QA I2). 이것들을 `isKisTokenError` 로 묶되 **재읽기 우선 모양으로 함께 바꿔야** 한다 — 지금 모양(재발급 먼저)에 `EGW00121` 만 더하면 M-2(멀쩡한 토큰 삭제 → `EGW00133` 60초 정지 → `createOrder` 차단)를 그 경로에 새로 만든다. 1차 감사는 "`EGW00121` 이 회전 시 더 흔한 코드일 수 있어 후순위로 두지 말라" 고 권고했다(추측).
9. **DB 읽기 실패 시 토큰 경로** — `kis-auth.ts:58` 은 DB 조회가 실패하면 재발급으로 떨어지므로 "같을 때만 재발급" 조건을 건너뛴다. 루프 상단 `kisHeaders` 가 같은 호출을 먼저 하므로 새 위험은 아니다(2차 QA I1, 코드 독해만).

## 진행 기록

- [14:20][leader] 사용자 「네, 고쳐주세요」. 측정·영향 범위 확인 중 **첫 보고의 과장을 발견해 정정**(위 🔴 절) — 11건은 주문 한도 경로이고 방향이 보수적이며, 킬스위치 입력 경로는 `avgPrice` 폴백으로 이미 보호돼 있다. 우선순위 high → medium.
- [14:22][leader] 코드 확인: `kisFetch` 의 `timeoutMs` 는 루프 안에서 시도마다 새로 걸린다 · `acquireKisSlot` 도 루프 안(재시도가 줄을 다시 선다) · `isTransientKisFailure` 는 토큰 오류를 제외하므로 게이트웨이가 토큰 만료를 재시도하지 않는다(어댑터 루프 담당). 손으로 만든 루프를 **지우지 않고** `transientRetries` 를 더하면 호출이 곱해지는 것을 확인 → WP1·WP2 에서 응답 기반 루프를 걷어낸다.

## 구현 (메인 세션이 직접 — developer 역할을 겸함)

> 역할 분리를 정확히 적는다: 이 task 의 코드는 **메인 세션(leader 겸 구현)**이 썼다. T-132 의 맥락(게이트웨이 코드·측정·울타리 설계)을 그대로 들고 있어 developer 서브에이전트에 재인계하는 비용이 더 컸다. **Reviewer·QA 는 서브에이전트로 독립 수행**한다 — 커밋 훅이 요구하는 독립 판정은 구현자가 쓸 수 없다.

- [14:25] WP1 `src/lib/exchanges/kis-domestic.ts` — `getTicker` 의 손으로 만든 3회 루프 제거, `kisFetch(…, { label: 'domestic getTicker', transientRetries: 2 })` 한 번으로 교체. 레이트리밋 즉시 던지기 유지. `rt_cd≠'0'` 명시 실패 추가(`200 업무실패 rt_cd=… msg_cd=… msg=…`, msg 120자 절단). 예산은 종전과 같은 총 3회. 루프가 매 시도 `kisHeaders` 를 다시 부르던 것은 없어졌지만 `invalidateKisToken()` 을 부르지 않는 한 같은 캐시 토큰이라 동작 차이는 없다(토큰 만료 처리는 원래 없었다 — 후속 후보 1).
- [14:27] WP2 `src/lib/exchanges/kis-overseas.ts` — `getTicker` 의 **응답 기반** 500/429 재시도 제거 → `transientRetries: 2`. **던진 예외 재시도 1회는 유지**(`MAX_THROW_ATTEMPTS = 2`, 300ms). `timeoutMs: 5000` 유지 — `kisFetch` 루프 안에서 시도마다 새로 걸리는 것을 코드로 확인. `rt_cd≠'0'` 명시 실패 추가. `lastErr` 변수는 쓰이지 않게 되어 삭제.
- [14:29] WP3 `__tests__/kis-balances-business-failure.test.ts` — 멱등성 울타리 허용 라벨 3 → 5(`domestic getTicker`·`overseas getTicker`). 두 호출 모두 옵션과 라벨이 **같은 줄**에 있어 울타리가 잡는다. 시험 제목도 3곳 → 5곳으로 고쳤다.
- [14:31] WP3 보강 — 울타리가 **주석 줄까지 세서 1건 실패**했다(9건 검출: 새 doc 주석 6줄 + 호출 3). 숫자를 올려서 입을 막으면 울타리가 죽으므로, `isCommentLine`(`*`·`//`·`/*` 로 시작)으로 **주석 줄을 제외**했다. 주석으로 위장한 호출 지점은 실행되지 않으므로 구멍이 생기지 않고, 줄 끝 주석은 그대로 센다. 근거를 시험 파일 주석에 남겼다.
- [14:32] WP4 시험 2파일 신규 — `kis-ticker-business-failure.test.ts`(어댑터 계약 8건: 국내·해외 각각 업무실패 던지기·`rt_cd=0` 회귀·`rt_cd` 없음 회귀·`rt_cd=0`+`output` 없음 회귀) · `kis-ticker-transient-recovery.test.ts`(종단 10건: 500 복구·SESSION FULL 2회 뒤 복구·소진 시 던지기와 예산 3회·정상 1회·해외 SESSION FULL 복구·해외 소진·**던진 예외 1회 재시도 유지**·예외 2회면 던지기·해외 정상 1회).
- [14:33] `src/lib/exchanges/kis-http.ts` 머리글 `§일시 실패 재시도` 에 「T-133 — 시세 조회로 확장」 절 추가(왜 루프를 걷어냈는지, 국내 예산 불변·해외 +1, 예외 재시도는 어댑터 몫, fan-out 증폭 상한 +16%/실제 +9%, 재시도가 `acquireKisSlot` 으로 줄을 다시 서는 것).
- [14:35] 검증 1차 — 서버에서 `npm run typecheck` **exit 0**(Mac 은 `@workspace/api-usage`·`adm-zip` 미설치로 기존 오류 5건이 나므로 서버에서 돌렸다). `npx jest src/lib/exchanges` **25스위트 630건 전부 통과**(울타리 수정 전 1건 실패 → 수정 후 0건).

### 검토자가 먼저 볼 지점 (스스로 아는 약한 곳)

1. **해외 호출 상한이 2 → 6 으로 늘었다** — 예외 재시도 2회 × 게이트웨이 3회. 겹치려면 일시 실패 응답 뒤 네트워크 예외가 나야 해서 드물지만, 최악 벽시계는 타임아웃 5s 가 쌓여 **20초 안팎**이다. 틱 시간 영향은 **측정하지 않았다**. `cron-runner.sh` 시간 예산(T-132 Reviewer L-4)과 겹치는 지점이다.
2. **fan-out 증폭** — 시세는 틱당 N건이고 동시성 4다. 상한 +16% 는 계산이고 장중 실측이 아니다(오늘 휴장).
3. **예산 2 의 근거가 "국내 후퇴 방지"다** — 해외만 보면 1 이 더 보수적이다. 비대칭으로 둘지(국내 2·해외 1) 판단을 요청한다.
4. `rt_cd != null` 가드를 남긴 것 — T-132 와 같은 이유(모양이 다른 TR). 숫자형 `rt_cd` 는 여전히 엄격 비교라 `0`(숫자)이면 업무실패로 던진다(T-132 QA 관찰, 미수정·후속 후보 4).
5. 울타리에서 주석 줄을 제외한 변경이 **울타리 자체를 약화시키지 않는지** — 안전장치의 안전장치라 특히 봐 달라.

## Reviewer

- [15:22] 범위·방법 — 커밋 전 작업트리 6파일(`kis-domestic.ts`·`kis-overseas.ts`·`kis-http.ts`(주석만)·`__tests__/kis-balances-business-failure.test.ts`·`kis-ticker-business-failure.test.ts`·`kis-ticker-transient-recovery.test.ts`)을 구현자 주장과 분리해 코드·실행으로 독립 대조했다. 서버에서 `tsc --noEmit` exit 0, `jest src/lib/exchanges` 25스위트 630건 전부 통과(무변이 상태). 변이·실험은 전부 서버 사본(`~/.node-local/t133-audit/`·`t133-audit2/`)에서 했고 작업트리는 건드리지 않았다(6파일 md5·`git diff --stat` 감사 전후 동일). 데모 게이트: UI 변경 0. 실험은 실제 `kisFetch` + 가짜 `fetch`(실시간 타이머)로 호출 횟수·소요 시간을 쟀다.
- [15:22] 중점1 증폭(호출 횟수 실측) — 국내: 응답 기반 바깥 루프가 없어져 곱셈은 사라졌다. 일시 실패만이면 3회(종전 500 도 3회, 200 업무실패는 1회→3회). 레이트리밋이 섞인 최악 `[RL,RL,SF,SF,SF]` 도 5회로 종전 최악 `[GW,GW,RL,RL,RL]` 5회와 같다(실험 C4·C5·C5b; `kisFetch` 안 레이트리밋 예산 2와 일시 실패 예산 2가 별도 카운터라 한 호출 최대 1+2+2=5). 해외: 응답 기반 곱셈은 없어졌지만 바깥 예외 루프(2) × 안쪽(최대 5)이 남는다. 일시 실패+예외 `[GW,SF,THROW,GW,SF,SF]` 는 6회(주장과 일치, C1). 그러나 레이트리밋이 섞이면 `[RL,RL,SF,SF,THROW,RL,RL,SF,SF,SF]` 가 **10회**(C2)이고 종전 최악은 6회(`[RL,RL,THROW,RL,RL,RL]`, C3) — 주장 「최대 6회(이전 2회)」는 레이트리밋을 뺀 값이며 종전 최악도 2회가 아니었다. 발생 조건이 좁아(예외는 KIS 1233건 중 3건=0.24%) Low.
- [15:23] 중점2 벽시계 — `timeoutMs` 는 `kisFetch` 의 `for(;;)` 안에서 시도마다 새 `AbortController`·`setTimeout` 을 만든다(코드 확인). 다만 `finally{clearTimeout}` 뒤의 `res.text()` 본문 읽기는 타임아웃 밖이다(기존 구조, 미변경). 이론 상한 = 5s×6시도 + 백오프 (0.4~0.6+1.2~1.4)×2 + 0.3 ≈ **34s**(스로틀 줄서기 최대 30s/회는 별도). 현실적 최악(빠른 일시 실패 2회→타임아웃 1회→재시도→빠른 일시 실패 3회) 실측 **9.0s**(D1). 타임아웃만 2회는 종전과 같은 10.3s(D2·D2b). 「20초 안팎」(kis-overseas.ts:83)은 이론값도 실측도 아니다. 영구 SESSION FULL 에서 소진한 호출 1건의 비용: 국내 1.76s(종전 1ms 즉시 실패)·해외 1.62s, 영구 500 은 1.87s(종전 0.60s)(D3·D4·D4b·D4c). `stop-alert` 시세 예산 10s(route.ts:41,217)·`strategy-eval` 심볼 순차 루프(engine.ts:1443)·`entry-watcher`·`portfolio-total`(순차 await) 모두 실패 종목당 그만큼 늘어난다. `cron-runner.sh` 충돌: 하트비트 여유가 가장 빠듯한 08:00 틱(PMO 120s, 계산 290s/300s)은 국내·해외 정규장이 모두 닫힌 시각이라 시세 순차 잡이 `all_markets_closed` 로 건너뛴다 → 겹칠 가능성 낮음 [가능성 높음 — 코드 정황, 오늘 휴장이라 장중 실측 불가]. 장중 틱의 증가분은 미측정으로 남는다.
- [15:24] 중점3 예산 2 — 비대칭(해외만 1)에 반대한다. T-132 배포 뒤 67분(14:01~15:08, 운영 `pm2-err.log`)의 실제 재시도 기록: 재시도가 붙은 호출 17건 중 첫 재시도에 복구 11건·**두 번째 재시도에 복구 2건**·소진 4건. 즉 복구 13건 중 2건(15%)이 3번째 시도에서 구해졌다 — kis-http.ts:62 「관측된 복구는 전부 2회차」는 사실과 다르다. 예산을 1로 줄이면 그 2건이 실패로 남고 아끼는 호출은 소진 4건당 1회뿐이다. 표본은 잔고·예수금(시세 아님)이고 n이 작다 [가능성 높음]. 또 해외 호출 상한이 커진 원인은 예산이 아니라 바깥 예외 루프라 비대칭으로는 해결되지 않는다.
- [15:25] 중점4 멱등성 울타리 — (a) 두 새 호출 지점의 `init` 은 `{ headers }`(method 없음) = GET. 실제 `kisFetch` 를 쓰는 복구 시험이 통과하므로 런타임 가드 통과를 실행으로 확인했고, 변이 M14(국내 getTicker 에 `method:'POST'` 주입)는 복구 시험이 즉시 잡는다. (b) `kisFetch` 호출 29곳 전수: `transientRetries` 는 5곳(잔고 2·예수금 1·시세 2)뿐이고 주문·취소 4곳(kis-domestic.ts 363·389, kis-overseas.ts 792·818)은 리터럴 옵션이다. 런타임 단언은 kis-http.ts 의 `transientRetries>0 && method≠GET → 요청 전 throw`이고 `kis-http.test.ts` 6건(POST/post/PUT/DELETE 던짐·GET/미지정 통과·미사용 POST 무영향)이 통과한다. (c) 🔴 `isCommentLine` 은 울타리를 **약화시켰다**: 실험 B — `/* idempotent */ return kisFetch(url, { method: 'POST' }, { transientRetries: 2, label: 'evil createOrder' });` 한 줄(B2), 앞 줄에서 연 주석을 닫는 `*/ return kisFetch(…)`(B3) 모두 울타리 7건 통과(무검출). 같은 호출을 주석 없이 쓴 대조(B1)는 잡힌다. 변경 전 울타리(주석 줄까지 셈)는 B2·B3 도 잡았으므로 이번 변경이 만든 새 구멍이다. 시험 주석 「주석으로 위장한 호출 지점은 존재할 수 없다」(:120)는 한 줄 안에서 주석 뒤에 코드가 오는 경우 거짓이다. 돈이 새는 경로는 아니다 — 런타임 가드가 POST 면 요청 전에 던진다(B4 재확인). 정적 울타리는 허용 목록을 사람이 검토하게 만드는 지점이라 Medium.
- [15:27] 중점5 행동 회귀 4건 — ① `rt_cd` 없는 TR: 코드 가드 `!= null` 유지, 국내 시험(:78)이 고정. **해외는 시험이 없다**(변이 M10 생존). ② `rt_cd='0'`+output 없음: 양쪽 시험 존재, 종전 `no output` 메시지 유지. ③ 레이트리밋: 국내 `[GW,GW,RL,RL,RL]` 종전·신규 모두 5회·같은 메시지(C5·C5b), 해외 순수 레이트리밋 3회로 즉시 던짐 — 동작은 유지되나 저장소 시험은 이 분기를 고정하지 않는다(M7·M8 생존; 어댑터가 던지는 건 같고 메시지 꼬리만 달라진다). ④ **토큰 만료 — 동의하지 않는다.** 실험 A: 첫 `getKisToken` 이 stale, 다음이 fresh, stale 에는 HTTP 500 EGW00123. 종전(HEAD) 국내 getTicker 는 fetch 2회·getKisToken 2회로 **성공**했고, 현재는 fetch 1회·getKisToken 1회로 `KIS getTicker 005930: 500` 을 던진다(A1·A2). 종전 루프는 EGW00123(HTTP 500)도 일반 500 으로 보고 매 시도 `kisHeaders` 를 다시 불러 DB(`system_config.kis_access_token`) 토큰을 새로 읽었다 — 다른 프로세스(web↔cron)가 토큰을 회전시킨 직후엔 그 재읽기가 구제했다. 「같은 캐시 토큰이라 차이 없다」는 사실이 아니다. 해외는 종전에도 `headers` 를 루프 밖에서 한 번 만들어 차이 없음(A3·A4: 둘 다 던지고 신규는 fetch 가 2→1회). 실빈도는 낮다: 운영 로그에서 토큰은 매일 1회 회전하고 같은 초에 2~5개가 동시 발급되지만(2026-09-20~10-31) 그 시각대 시세 실패 로그는 없고 `EGW00123` 로그도 0건 — 결함 L-1 로 기록하되 실영향은 Low.
- [15:28] 중점6 호출부 — `getTicker` 호출부 21곳(app 14·lib 5·내부 일괄 시세 2)을 확인했다. 실패 메시지 문자열에 의존하는 코드는 0건(`no output`·`KIS getTicker`·`retries exhausted` 를 src·scripts·docs 에서 검색, 시험 파일 외 일치 없음) — 전부 catch 후 로그·null·건너뜀·`results.push(detail)`. `portfolio-total.ts:116-131` 는 catch→`console.warn(errMsg(e))`→해당 종목만 합산 제외, `portfolio-snapshot/route.ts:178-196` 은 catch→avgPrice 폴백으로 그대로 동작한다(구현자가 적은 전제와 코드가 일치). `/api/ticker/route.ts:18` 은 `e.message` 를 응답으로 내보내는데 새 메시지는 KIS `msg1` 을 120자로 자른 값이라 종전의 본문 JSON 통째보다 노출이 작다(회귀 아님). 일시 실패의 지연 증가는 중점2 참조.
- [15:30] 중점7 변이 시험(서버 사본, 변이마다 `src/lib/exchanges` 전체 25스위트 실행) — 14건 중 10건 잡음, 4건 생존. 잡음: M1 국내 `transientRetries` 2→0(3건)·M2 해외 2→0(2건)·M3 국내 `rt_cd !== '0'`→`===`(7건)·M4 해외 같은 변이(6건)·M5 `MAX_THROW_ATTEMPTS` 2→1(예외 재시도 시험 2건)·M6 `isCommentLine` 항상 true(울타리 2건)·M11 국내 예산 2→5(소진 호출 수 시험 2건)·M12 해외 `break` 제거(3건)·M13 허용 라벨 1개 삭제(울타리 1건)·M14 POST 주입(4건). 생존: M7·M8 레이트리밋 던지기 분기 무력화(어댑터 동작 동일, 메시지 꼬리만 변함 — 사실상 등가), M9 해외 `timeoutMs` 제거(5s 타임아웃을 고정하는 시험 없음), M10 해외 `rt_cd != null` 가드 제거(해외 「rt_cd 없음」 회귀 시험 없음). 새 시험 자체는 결함을 잡지만 위 두 공백은 실제다.
- [15:31] 결함 M-1 (Medium) `src/lib/exchanges/__tests__/kis-balances-business-failure.test.ts:123` — `isCommentLine` 이 `startsWith('/*')`·`startsWith('*')` 로 줄 전체를 빼서 `/* … */ 코드`·`*/ 코드` 줄의 호출 지점을 세지 않는다(실험 B2·B3 재현). 런타임 가드가 막아 자금 경로 노출은 없으나 주석(:119-122)이 거짓 보증을 한다. 수정: 줄 단위 `startsWith` 대신 파일 전체 텍스트에서 `/* … */`(줄바꿈 보존)와 `//` 꼬리를 공백으로 치환한 뒤 센다(줄 번호 유지) 또는 `isCommentLine` 을 되돌리고 주석 속 `transientRetries` 언급을 산문으로 바꿔 숫자를 유지한다. 가능하면 `/* x */ code` 샘플로 스트리퍼 자체를 시험하고 :120 문장을 정정한다.
- [15:31] 결함 L-1 (Low) `src/lib/exchanges/kis-domestic.ts:55-56`(주석 :50-51) — 루프 제거로 EGW00123(HTTP 500) 시의 토큰 재읽기·재시도가 사라졌다(실험 A1·A2). 구현 기록 「동작 차이는 없다」와 주석 「재발급 루프가 원래 없다」는 이 암묵적 구제를 빠뜨렸다. 처리: 사실대로 정정하고, 후속 후보 1(시세 EGW00123 처리)을 일정에 올리거나 `res` 가 EGW00123 이면 `kisHeaders` 를 한 번 다시 불러 1회 재시도하는 최소 복구를 넣는다(어느 쪽이든 사용자 판단 사항이 아니라 구현 범위).
- [15:32] 결함 L-2 (Low) `src/lib/exchanges/kis-overseas.ts:82-84`·`kis-http.ts:57-58,62` — 「최대 6회(이전 2회)」는 레이트리밋 혼합 시 10회(이전 6회), 「20초 안팎」은 실측 9.0s·이론 34s, 「관측된 복구는 전부 2회차·실제 +9%」는 실제 로그와 어긋난다(중점1·2·3 수치로 정정). 선택 개선: 바깥 예외 루프 2회차에는 `transientRetries` 를 낮춰(예: 첫 시도 2·재시도 0) 해외 최악을 종전 6회로 묶는다 — 곱셈이 예외 경로에 남아 있는 것이 T-017 원칙과 어긋나는 마지막 지점이다.
- [15:32] 결함 L-3 (Low) `kis-domestic.ts:56`·`kis-overseas.ts:98` — 순차 호출부(stop-alert 시세 예산 10s·strategy-eval·entry-watcher·portfolio-total)의 실패 종목당 지연이 +1.3~1.8s 로 늘었다. 08:00 PMO 틱과는 겹치지 않을 가능성이 높으나 장중 틱 영향은 미측정이다. 처리: 첫 장중 틱 이후 `[kis-http] 일시 실패 재시도 (domestic/overseas getTicker)` 로그와 stop-alert·strategy-eval 소요를 확인(Deployer·QA 후속).
- [15:33] 결함 L-4 (Low) 시험 공백 — 해외 `timeoutMs: 5000` 고정(`kis-ticker-business-failure.test.ts` 에서 `kisFetch` 인자 단언 없음, M9)·해외 「rt_cd 없음」 회귀(M10)·시세 레이트리밋 호출 수 고정(`RL×3` → fetch 3회·어댑터 추가 재시도 없음, T-017 불변식)·토큰 만료(EGW00123) 경로. 각각 한 건씩 추가하면 닫힌다.
- [15:33] 관찰 I-1~I-4 (Info) — I-1: 새 시험은 7+9=16건이고 구현 기록의 「18건(8+10)」·「해외 rt_cd 없음 회귀 포함」과 다르다. I-2: `isTransientKisFailure` 는 4xx+`rt_cd≠0` 도 일시로 보므로 이제 4xx 업무 오류도 2회 더 재시도된다(종전 즉시 던짐, 상수 상한). 운영 로그의 시세 실패 형태는 SESSION FULL 12건·500 1건뿐이라 영구 업무실패는 관찰되지 않았지만 universe·favorites 경로의 잘못된 종목 코드는 미확인. I-3: 울타리 스캔은 `src/lib/exchanges/*.ts` 최상위만 보며 `kisFetch` 직접 호출은 `app/api/ticker/all`·`symbols/lookup`·`symbols/search`·`profit-engine/daily-bars-kis.ts` 에도 있다(현재 옵션 미사용, 런타임 가드가 보호). I-4: `kis-overseas.ts:109` `if (!res)` 는 도달 불가(무해).
- [15:34] 구현자 자기지적 5개에 대한 입장 — (1) 해외 호출 상한·벽시계: **부분 동의/수치 정정**. 6회는 레이트리밋을 뺀 값이고 혼합 시 10회, 벽시계는 실측 9.0s·이론 34s이며 「20초 안팎」은 아니다. 틱 충돌은 08:00 틱 기준으로 낮다고 본다(시장 닫힘 정황), 장중은 미측정이라는 구현자의 표시에 동의. (2) fan-out 증폭 +16%: **동의(정상일 한정)**. 계산은 맞지만 하루 평균이고, 지속 장애에서는 영향받는 종목마다 3배 호출이 된다(스로틀이 속도를 묶고, 비용은 호출 수보다 순차 호출부의 지연으로 나타난다). 본문의 「+9%」 근거 문장은 정정 필요. (3) 예산 2의 비대칭: **반대(대칭 2 유지)**. 운영 로그에서 두 번째 재시도가 복구 13건 중 2건을 구했고, 해외 호출 상한 증가의 원인은 예산이 아니라 바깥 예외 루프다. (4) `rt_cd != null` 가드·숫자형 `rt_cd`: **동의 + 시험 공백 지적**. 모양이 다른 TR 을 위해 가드는 필요하고 숫자 `0` 을 업무실패로 던지는 것은 안전 방향이다. 다만 해외에는 이 가드를 고정하는 시험이 없다(M10). (5) 울타리 `isCommentLine`: **반대**. 약화됐다(B2·B3). 런타임 가드가 최종 방어선으로 버티고 있어 자금 위험은 아니지만 정적 울타리의 보증은 줄었다. 추가로 구현 기록의 「토큰 차이 없음」 주장은 **반대**(A1·A2).
- [15:35] 이행 조건(커밋 전) — C1: M-1 울타리 수정과 :119-122 주석 정정. C2: L-1·L-2 의 사실 오류를 코드 주석(kis-domestic.ts:50-51·kis-overseas.ts:82-84·kis-http.ts:57-62)과 task 본문에서 정정(L-1 은 정정 또는 최소 복구 중 택일). 권고(비필수): L-4 시험 4건 추가, L-2 선택 개선, L-3 장중 확인. 위 수정이 들어가면 이 판정은 수정 전 버전에 대한 것이므로 수정 부분(울타리 시험·주석·선택적 복구)에 한해 Reviewer 재확인을 요청한다.
- [15:35] QA 집중 점검 지점(high_risk_areas) — `src/lib/exchanges/kis-http.ts` 일시 실패 루프(레이트리밋 카운터와 별도 카운터, 한 호출 최대 5회)·`src/lib/exchanges/kis-overseas.ts:92-110`(바깥 예외 루프 × 안쪽 재시도 곱셈, 10회 경로)·`src/lib/exchanges/kis-domestic.ts:55-76`(토큰 만료 시 재읽기 소실)·`src/lib/exchanges/__tests__/kis-balances-business-failure.test.ts:123-129`(울타리 구멍)·`src/app/api/cron/stop-alert/route.ts:217`(시세 순차 예산)·`src/lib/safety/portfolio-total.ts:116-131`(제외 정책 입력). 장중 첫 틱 이후 재시도 로그 건수와 소진율(기준: T-132 배포 직후 67분 17건 중 소진 4건)을 확인할 것.
- [15:36] **1차 판정(라운드 2 판정으로 대체됨): conditional_pass (scope: src/lib/exchanges/kis-domestic.ts, src/lib/exchanges/kis-overseas.ts, src/lib/exchanges/kis-http.ts, src/lib/exchanges/__tests__/kis-balances-business-failure.test.ts, src/lib/exchanges/__tests__/kis-ticker-business-failure.test.ts, src/lib/exchanges/__tests__/kis-ticker-transient-recovery.test.ts)**
- [16:02] 라운드 2 범위·방법 — 재확인 대상 4개(울타리 `isCommentOnly`+자기 시험 9건 / 국내 `getTicker` 토큰 재발급 루프 / 주석 수치 정정 3곳 / 신규 시험 7건)만 봤다. 서버 재실행: `tsc --noEmit` exit 0 · `jest src/lib/exchanges` 25스위트 637건 통과 · 광역(`exchanges safety app/api strategy signals`) 183스위트 5186건 통과·실패 0 — 구현자 수치와 일치. 다만 광역 1차 실행에서 `kis-usage-isolation.test.ts` 1건이 실패했다(소요 5.3초, 기본 5초 타임아웃 경계). 단독 3회와 광역 재실행에서는 모두 통과해 부하성 불안정으로 본다 — 이 시험은 getTicker 를 호출하지 않고 라벨→op 이름만 본다 [가능성 높음, 실패 메시지는 확보하지 못함]. 변이·실험은 서버 사본 `~/.node-local/t133-r2-fence/`·`t133-r2-exp/`(라운드 1 사본은 삭제)에서 했고 작업트리 6파일 md5 는 감사 전후 동일하다(다른 세션 파일·`.codex/` 미접촉).
- [16:02] 내 라운드 1 정정 — 라운드 1 중점1 에서 종전 국내 최악 호출 수를 5회로 적은 것은 틀렸다. `kisFetch` 가 레이트리밋 2회 뒤 일반 500 을 돌려주는 경로는 종전 바깥 루프를 계속 돌리므로 종전 최악은 `[RL,RL,GW]` 3바퀴 = **9회**(재현 O1: 9회)다. 구현자의 「종전 9회」가 맞고, 라운드 2 의 토큰 루프까지 합친 신규 최악 10회(`[RL,RL,SF,SF,TK | RL,RL,SF,SF,SF]`, 재현 N1: 10회)는 종전과 거의 같다. 토큰 루프를 넣기 전 상태의 상한은 5회로 종전보다 낮았다.
- [16:03] 재확인 1 울타리(M-1) — **아직 닫히지 않았다.** 설계 판단은 동의한다: 파일 전체에서 `//`·`/* */` 를 치환하는 방식은 문자열 리터럴 속 `//`(URL)·`/*`(glob)가 호출 지점을 통째로 지우므로, 문자열을 구분하지 않은 내 라운드 1 제안 문구(「`//` 꼬리 치환」)가 부적절했고 줄 단위 fail-closed 규칙이 맞다. 그러나 구현의 `*` 분기(`kis-balances-business-failure.test.ts:132` `if (l.startsWith('*')) return true;`)는 닫는 주석 **뒤에 코드가 붙은 줄**을 여전히 주석으로 본다. 실험(서버 사본에 우회 파일을 `src/lib/exchanges/` 에 두고 울타리 시험 실행): F2 `/* c */ return kisFetch(…{ method:'POST' }…{ transientRetries: 2 … })` 잡힘(라운드 1 B2 는 닫혔다) · F1 주석 없는 줄·F5 주석 둘 뒤 코드·F6 `/*/` 뒤 코드·F7 줄 끝 `// 메모` 모두 잡힘 · **F3** 앞 줄에서 연 주석의 `*/ return kisFetch(…)`(라운드 1 B3 그대로)와 **F4** ` * 메모 */ return kisFetch(…)` 는 **8건 통과(무검출)**. 자기 회귀 시험 9건에는 `*/ 코드` 모양이 없어 이 구멍을 못 본다. 수정안(검증 완료, 변이 R7): `*` 분기도 `/*` 분기와 같게 `if (l.startsWith('*')) { const c = l.indexOf('*/'); return c < 0 || l.slice(c + 2).trim() === ''; }` — 적용하면 F1–F7 전부 잡히고 정상 트리는 8건 통과, `jest src/lib/exchanges` 637건 통과. 자기 시험 `cases` 에 코드가 붙은 줄(`false`) 두 개(닫는 `*/` 뒤 코드, ` * 메모 */ 코드`)를 더하면 고정된다. 런타임 가드가 POST 를 요청 전에 막는 점은 그대로라 자금 경로 노출은 아니다.
- [16:04] 재확인 2 토큰 재발급 루프(L-1) — **복구가 아니라 악화다(M-2).** 루프 자체는 정확하다: 최대 2바퀴·재발급 1회(`kis-domestic.ts:63-79`), 레이트리밋 분기가 토큰 검사보다 먼저 와 서로 가리지 않고, 시험 2건 통과, `invalidateKisToken` 호출을 지우는 변이 R4 를 시험이 잡는다. 문제는 **무엇으로 복구하느냐**다. 라운드 1 에서 내가 실증한 시나리오(다른 프로세스가 토큰을 회전시켜 DB 에 새 토큰이 이미 있음)를 실제 `kis-auth`+가짜 DB·가짜 KIS 로 돌렸다(실험 E3): 종전은 `kisHeaders` 재읽기로 **306ms 에 성공**(가격 호출 2회·tokenP 0회·DB 쓰기 0건). 신규는 `invalidateKisToken()` 이 DB 의 **멀쩡한 새 토큰을 DELETE** 하고 재발급을 요청 → 직전 발급 1분 이내라 `EGW00133`(1분당 1회) → `issueAndStore` 의 60초 대기에 걸려 **4.1초 뒤에도 getTicker 가 미완료**였다. 그 뒤 같은 프로세스의 다른 잡이 `getKisToken()` 을 부르면 DB 에 토큰이 없어 똑같이 막힌다(주문 `createOrder` 도 같은 `getKisToken` 경로 — 실험의 곁다리 호출도 미완료). 따라서 구현 기록의 「종전보다 나아졌다(종전은 캐시를 다시 읽기만 했고 재발급은 안 했다)」와 시험 주석 `kis-ticker-transient-recovery.test.ts:92` 「종전 루프가 얻던 복구를 이 루프가 대신한다」는 이 시나리오에서 틀렸다 — 새 루프는 재읽기를 대신하지 않고 건너뛴다. 전제(KIS 의 1분 1회 제한, 회전 직후 발급 시각)는 저장소 자신의 설명(`kis-auth.ts` 주석)과 운영 로그의 60초 간격 재발급(2026-10-30 16:00:03·16:01:03·16:02:03)에 근거한 모델이다 [가능성 높음]. 이 사건 자체는 운영 로그 5주간 `token expired` 0건이라 실제로 일어난 적이 없다 → 확률 낮음·크기 큼(발생하면 주문 경로 지연 포함)으로 Medium. 시세는 호출이 가장 많고 동시 4건 fan-out 이라 사건이 나면 가장 먼저 걸리는 경로이므로 같은 관례를 쓴 잔고 경로보다 노출이 크다. 수정안: 만료 감지 시 **먼저 재읽기**하고 DB 토큰이 방금 쓴 것과 같을 때만 재발급한다 — `if (!tokenRetried && 만료) { tokenRetried = true; const cur = await getKisToken(); if (\`Bearer ${cur}\` === headers.Authorization) await invalidateKisToken(); continue; }` (재읽기로 끝나면 종전 동작 그대로, 재발급은 DB 토큰도 죽었을 때만). 시험은 ① DB 토큰이 이미 회전돼 있으면 `invalidateKisToken` 0회·fetch 2회 ② 같은 토큰이면 1회 두 가지로 바꾼다. 해외에 넣지 않은 선택은 동의한다(원래 있던 공백이고 범위 확대, 후속 후보 1 — 위 수정안이 확정되면 같은 모양으로 옮기면 된다).
- [16:05] 재확인 3 수치 정정 3곳 — 대조 결과 정확하다: 국내 「최악 10회/종전 9회」(N1 10·O1 9), 해외 「최악 10회/종전 6회·실측 9.0초·이론 34초」(C2·C3·D1), `kis-http.ts` 「첫 재시도 복구 11·두 번째 2·소진 4」(운영 로그 17건). 남은 모순 하나(L-5, Low): `kis-http.ts:57` 「국내는 종전과 같은 총 3회 시도이고」가 그대로다 — `kis-domestic.ts` 주석이 스스로 「총 3회는 레이트리밋 예산을 빼고 센 값이라 틀렸다」고 정정한 바로 그 문장이고 국내 토큰 루프도 빠져 있다. 「일시 실패만 보면 3회(레이트리밋·토큰 루프 제외)」로 한정하거나 `kis-domestic.ts` 의 상한 설명을 가리키게 고친다.
- [16:05] 재확인 4 시험 공백·변이(서버 사본, 변이마다 `src/lib/exchanges` 25스위트) — R1 해외 `timeoutMs` 제거(라운드 1 M9)→옵션 계약 시험이 잡음 · R2 해외 `rt_cd != null` 가드 제거(M10)→해외 「rt_cd 없음」 시험이 잡음 · R3 국내에 `timeoutMs` 추가→국내 옵션 계약이 잡음 · R4 토큰 루프의 `invalidateKisToken` 제거→토큰 시험이 잡음 · R5 국내 `rateLimitRetries: 5`→레이트리밋 3회 고정 시험(과 해외 소진 시험 2건)이 잡음 · R6 `/*` 분기를 항상 주석으로→울타리 자기 시험이 잡음. 라운드 1 에서 살아남은 M9·M10 은 이제 잡힌다. 남은 공백: 토큰 시험이 `invalidateKisToken` 을 모킹해 M-2 같은 재발급의 부작용(DB 삭제·1분 제한)을 볼 수 없다 · 해외는 레이트리밋 호출 수를 고정하는 시험이 없다(국내만, Info).
- [16:06] 구현자의 두 질문에 대한 답 — (a) 「문자열 전체 치환 불채택」 판단은 맞다(재확인 1). 단 대안으로 택한 줄 단위 규칙의 `*` 분기가 덜 닫혔다. (b) L-1 의 선택(정정이 아니라 복구)은 방향이 맞고 방법이 틀렸다: 재발급 루프는 DB 토큰까지 죽은 경우(KIS 가 폐기)에는 종전보다 낫지만 회전 직후 시나리오를 악화시킨다(M-2). 호출 상한 10/9 계산은 맞다.
- [16:07] 결함 목록(이번 라운드, 심각도·위치) — **M-1 잔여 (Medium)** `__tests__/kis-balances-business-failure.test.ts:132` `*` 분기가 `*/ 코드` 줄을 놓침(F3·F4), 자기 시험에 그 모양이 없음. **M-2 (Medium)** `kis-domestic.ts:72-79` 재읽기 없이 `invalidateKisToken()` 이 DB 의 새 토큰을 삭제(E3: 종전 306ms 성공 → 신규 4.1초 후에도 미완료, 곁다리 `getKisToken` 도 막힘), `kis-domestic.ts:55-60` 주석과 `kis-ticker-transient-recovery.test.ts:92` 의 「대신한다」는 거짓. **L-5 (Low)** `kis-http.ts:57` 「국내는 종전과 같은 총 3회」 잔재. Info: 울타리는 `.ts` 만 스캔한다(`.tsx`·`.mts`·`.js` 는 안 봄, 런타임 가드가 보호 — I-3 보강) · 광역 jest 1회 불안정(`kis-usage-isolation`, 재현 안 됨) · 해외 `if (!res)` 주석 명시(I-4)는 확인함 · I-2(4xx 재시도)와 I-3(하위 디렉터리)을 후속 후보 6·7 로 미룬 판단에는 동의한다(동작이 바뀌지 않고 호출만 늘어난다).
- [16:08] 이행 조건(커밋 전) — C1': 울타리 `*` 분기 수정 + 자기 시험에 코드가 붙은 줄 2개 추가(위 수정안, 변이 R7 로 637건 통과 확인됨). C2': 토큰 루프를 「재읽기 먼저·같을 때만 재발급」으로 바꾸고 시험 2건을 교체, 관련 주석(`kis-domestic.ts:55-60`, `kis-ticker-transient-recovery.test.ts:88-92`)과 task 본문의 「종전보다 나아졌다」를 정정. C3'(경미): `kis-http.ts:57` 문구. 수정이 들어가면 이 판정은 수정 전 버전에 대한 것이므로 수정 부분(울타리 `*` 분기·자기 시험, 국내 토큰 루프·시험 2건, 주석)에 한해 라운드 3 재확인을 요청한다. 통과시키지 않는 이유: 라운드 1 의 C1(울타리)이 반쯤만 닫혔고 C2(L-1)는 의도와 반대로 종전보다 나쁜 동작을 만들었다 — 둘 다 수정이 작고 검증 방법이 위에 있어 라운드 3 에서 통과할 것으로 본다. Critical 은 없다.
- [16:08] QA 집중 점검 지점 — `src/lib/exchanges/kis-domestic.ts:63-79`(토큰 재발급 분기, 재읽기 후 재발급 여부)·`src/lib/exchanges/__tests__/kis-balances-business-failure.test.ts:131-140`(`isCommentOnly`)·`src/lib/exchanges/kis-overseas.ts:92-110`(예외 루프 × 안쪽 재시도 10회 경로, 변경 없음). 장중 첫 틱 뒤 `[kis-http] 일시 실패 재시도` 소진율과 `[kis-domestic getTicker] token expired` 로그 유무(0 이어야 정상)를 확인할 것.
- [16:09] **2차(라운드 2) 판정(라운드 3 판정으로 대체됨): fail (scope: src/lib/exchanges/kis-domestic.ts, src/lib/exchanges/kis-overseas.ts, src/lib/exchanges/kis-http.ts, src/lib/exchanges/__tests__/kis-balances-business-failure.test.ts, src/lib/exchanges/__tests__/kis-ticker-business-failure.test.ts, src/lib/exchanges/__tests__/kis-ticker-transient-recovery.test.ts)**
- [16:42] 라운드 3 범위·방법 — 재확인 대상 5개(울타리 `*` 분기·자기 시험 11건 / 국내 토큰 루프 / `kis-http.ts` 상한 문구 / `clearAllMocks` / 훅 위험)만 봤다. 이번에는 **반쯤 고친 곳이 없다.** 변경 파일은 `kis-domestic.ts`·`kis-http.ts`·울타리 시험·복구 시험 4개이고 `kis-overseas.ts`·`kis-ticker-business-failure.test.ts` 는 라운드 2 와 md5 가 같다. 서버 재실행: `tsc --noEmit` exit 0 · `jest src/lib/exchanges` 25스위트 639건 통과 · 광역(`exchanges safety app/api strategy signals`) 183스위트 5188건 통과·실패 0 — 구현자 수치와 일치(라운드 2 에서 한 번 보인 `kis-usage-isolation` 불안정은 재발하지 않음). 감사용 사본은 쓰고 지웠고(`~/.node-local/t133-*` 없음) 작업트리 6파일 md5 는 감사 전후 동일하다. 다른 세션 파일·`.codex/` 미접촉.
- [16:42] 재확인 1 울타리(C1') — **닫혔다.** 라운드 2 의 우회 파일 F1~F7 을 같은 방식(서버 사본에 우회 파일을 `src/lib/exchanges/` 에 두고 울타리 시험 실행)으로 다시 돌렸다: F1 주석 없는 POST 줄·F2 `/* c */ code`·**F3 `*/ return kisFetch(…)`(라운드 1 B3)**·**F4 ` * 메모 */ code`**·F5 주석 둘 뒤 코드·F6 `/*/` 뒤 코드·F7 줄 끝 `// 메모` — **7개 전부 잡힘**(각 1 failed / 7 passed), 정상 트리 F0 은 8건 통과. 구조도 맞다: `//` 로 시작하는 줄은 코드를 담을 수 없어 무조건 주석이고, `*`·`/*` 로 시작하는 줄은 첫 `*/` 뒤가 비었을 때만 주석이라 애매하면 센다(fail-closed). 자기 시험 11건(주석만 5·코드 6)에 라운드 1·2 의 우회 모양 전부가 코드로 들어갔고, 변이 `*` 분기를 라운드 2 상태(`return true`)로 되돌리면 자기 시험이 정확히 그 줄에서 잡는다(1 failed / 638 passed). 새로 찾은 우회 모양은 없다.
- [16:43] 재확인 2 토큰 루프(C2') — **맞다, 라운드 2 의 악화가 사라졌고 종전보다도 낫다.** 전제 확인: `kis-auth.ts:38-60` `getKisToken()` 은 메모리 캐시 없이 호출마다 `system_config` 를 SELECT 한다(코드 확인 + 실험에서 DB SELECT 카운터로 확인: 건강한 호출 1회당 HEAD 1회·신규 2회). 라운드 2 의 실험 하네스(실제 `kis-auth` + 가짜 DB·가짜 KIS)를 시나리오를 늘려 다시 돌렸다. S1 회전됨(요청 도중 다른 프로세스가 T2 를 DB 에 기록, T1 무효): HEAD 306ms 성공 → 신규 **101ms 성공**, tokenP 0회·DB 쓰기 0건, 재시도 요청이 `Bearer T2` 로 나갔고, 800ms 뒤 같은 프로세스의 곁다리 `getKisToken()` 도 정상 반환(라운드 2 의 60초 정지 없음). S4 같은 회전에서 시세 4건 동시: 4건 전부 성공·tokenP 0·DB 쓰기 0(재발급 폭주 없음). S2 DB 토큰 자체가 폐기됨(재발급 허용): 신규 성공(tokenP 1회·DELETE+INSERT 1쌍, 재시도가 `Bearer N1` 로 나감), HEAD 는 같은 토큰으로 3번 때리고 500 실패 — 종전 대비 개선. S3 DB 토큰이 폐기됐는데 KIS 가 재발급을 거부(직전 1분 이내 발급): 여전히 60초 대기(3초 시점 미완료) — 이 창은 「DB 토큰 == 방금 쓴 토큰」이면서 「다른 곳이 방금 발급했는데 DB 에 아직 안 쓴」 좁은 경우로 좁혀졌고 같은 관례(`invalidateKisToken`)를 쓰는 나머지 호출처 6곳과 같은 성질이라 Info. `usedToken` 과 `kisHeaders()` 가 어긋나는 경쟁은 **안전 방향**이라는 구현자 판단에 동의한다: ① 두 읽기 사이에 회전하면 요청은 새 토큰으로 나가 성공 ② 그 새 토큰이 죽어 있으면 `fresh !== usedToken` 으로 재발급 없이 한 번 더 시도하고 던진다(재발급 1회를 건너뛸 뿐 정지·삭제는 없다). 다만 공짜가 아니다 — 이 추가 읽기 때문에 getTicker 한 번당 DB SELECT 가 1회 늘어난다(L-7).
- [16:44] 재확인 3 상한 문구(C3') — 맞다. `kis-http.ts:57-60` 「국내 최악 10회(종전 9회)·해외 최악 10회(종전 6회)」를 실측과 대조: 국내 신규 10회(`[RL,RL,SF,SF,TK | RL,RL,SF,SF,SF]`)·종전 9회(`[RL,RL,GW]` 3바퀴) 재현, 해외 10회/6회는 라운드 2 에서 재현한 값이고 `kis-overseas.ts` 는 md5 불변. 「총 3회」 잔재는 없다(`kis-http.ts:119` 의 「총 3회 시도」는 레이트리밋 기본값 설명이라 정확). 토큰 루프가 늘리는 것은 DB 읽기뿐 HTTP 호출 상한(10)은 그대로임을 N2·N4·N5 로 확인(`[TK,OK]` 2회·`[SF,SF,TK,OK]` 4회·지속 만료 2회).
- [16:44] 재확인 4 `clearAllMocks`(복구 시험) — 문제 없다. `jest.clearAllMocks()` 는 모든 mock 의 `calls`·`results` 만 비우고 구현과 `mockImplementationOnce` 대기열은 건드리지 않는다. `beforeEach` 순서가 `clearAllMocks` → `tokenValue` 초기화 → 스로틀 초기화 → **새** `fetchMock` 생성 → spy 설치라 지워질 `fetchMock` 큐는 없고, 모듈 mock 의 구현(`getKisToken` 이 호출 시점의 `tokenValue` 를 돌려줌, `invalidateKisToken` 이 `'reissued'` 로 바꿈)은 그대로 살아남는다. `afterEach` 의 `restoreAllMocks()` 는 jest 29.7 에서 spy 만 복원하므로 누적 문제가 실제로 있었다는 설명도 맞다. 변이로 확인: 토큰 분기 비교를 뒤집으면(T1) 토큰 시험 2건이, 무조건 재발급(T2)이면 회전 시험이, 재발급 호출 삭제(T3)면 「같을 때만 재발급」 시험이 잡는다. 순서 바꿈(T5)은 동작이 같아 생존해도 무해.
- [16:45] 재확인 5 훅 위험 — 시뮬레이션 결과 안전하다. 훅의 `reviewer_body()` 는 `^##+[ \t]` 헤딩 중 소문자화한 제목에 `reviewer` 가 든 것의 본문만 읽는데, 이 task 파일에서 그 조건에 걸리는 헤딩은 `## Reviewer` 하나뿐이고(대소문자 무시 awk 로 확인) 다음 헤딩(`## 구현 라운드 2 …`)에서 스캔이 끝난다. 남은 위험 세 가지: ① 앞으로 어떤 헤딩 제목이든 `reviewer`(대소문자 무관)가 들어가면 그 본문이 스캔에 합류한다 — QA·Deployer 기록 제목에도 역할 이름을 쓰지 말 것. ② `scope_of` 는 판정 줄에서 첫 `)` 까지를 읽으므로 scope 경로에 `)` 가 들어가면 안 된다(이 판정 줄은 해당 없음). ③ 낡은 판정 줄은 판정 표지 문구를 빼고 판정 단어를 소문자로 내려 두었다(훅이 읽는 표지 줄은 맨 아래 이 판정 한 줄뿐).
- [16:46] 결함·관찰(이번 라운드) — Critical·High·Medium 없음. **L-6 (Low)** `__tests__/kis-ticker-transient-recovery.test.ts` 토큰 시험 3건은 **재시도 요청이 어떤 토큰으로 나갔는지 보지 않는다.** 변이 T4(재시도에서 첫 헤더를 재사용)가 639건 전부 통과로 살아남는다 — 「재발급·재읽기는 했는데 죽은 토큰으로 다시 보내는」 회귀를 못 잡는다. 사본에서 검증한 보강안: `describe` 안에 `const authOf = (i: number) => (fetchMock.mock.calls[i][1] as { headers: Record<string, string> }).headers.Authorization;` 를 두고, 회전 시험에 `expect(authOf(0)).toBe('Bearer tok'); expect(authOf(1)).toBe('Bearer rotated-by-other-process');`, 같은 토큰 시험에 `expect(authOf(1)).toBe('Bearer reissued');` 를 더한다 — 실제 코드에서 14건 통과, T4 에서 두 시험이 실패. **L-7 (Low)** `kis-domestic.ts` 토큰 루프의 `usedToken = await getKisToken()` 이 getTicker 호출마다 DB SELECT 를 1회 늘린다(건강한 경로에서 1→2회; 유니버스 시세 150건이면 +150회). 정확성 문제는 아니고 선택 개선: `kisHeaders()` 가 돌려준 `headers.Authorization` 을 「방금 쓴 토큰」으로 삼고 `fresh` 와 `` `Bearer ${fresh}` !== headers.Authorization `` 로 비교하면 추가 읽기와 위의 경쟁이 함께 없어진다. Info: S3 잔여 창(위)·울타리가 `.ts` 만 스캔하는 점(I-3, 후속 후보 7)·해외 토큰 경로는 계속 후속 후보 1(이제 검증된 모양이 있다).
- [16:46] 이행 조건 — 없음(통과를 막는 항목 없음). 권고(비필수): L-6 보강 3줄 — 위 문구 그대로 적용하면 내가 사본에서 검증한 상태이므로 재감사 없이 넣어도 된다(다르게 쓰면 알려 달라). L-7 은 후속으로 미뤄도 된다. 이 판정은 현재 작업트리(위 md5 상태)에 대한 것이며 6파일 중 하나라도 그 뒤 바뀌면 바뀐 부분을 다시 봐야 한다.
- [16:47] QA 집중 점검 지점 — `src/lib/exchanges/kis-domestic.ts:67-97`(토큰 분기: 회전 시 재발급 0회, 동일 토큰일 때만 재발급)·`src/lib/exchanges/__tests__/kis-balances-business-failure.test.ts:131-140`(`isCommentOnly`)·`src/lib/exchanges/kis-overseas.ts:92-110`(예외 루프 × 안쪽 재시도 10회 경로, 변경 없음). 장중 첫 틱 뒤: `[kis-http] 일시 실패 재시도` 소진율(기준: T-132 직후 17건 중 소진 4건)·`[kis-domestic getTicker] token` 로그 유무(회전 재읽기 로그가 나오면 어느 프로세스가 토큰을 회전시켰는지 확인, 재발급 로그가 나오면 DB 토큰 폐기 사건).
- [16:48] **3차(라운드 3) 판정(라운드 4 판정으로 대체됨): pass (scope: src/lib/exchanges/kis-domestic.ts, src/lib/exchanges/kis-overseas.ts, src/lib/exchanges/kis-http.ts, src/lib/exchanges/__tests__/kis-balances-business-failure.test.ts, src/lib/exchanges/__tests__/kis-ticker-business-failure.test.ts, src/lib/exchanges/__tests__/kis-ticker-transient-recovery.test.ts)**
- [17:02] 라운드 4 범위·방법 — 바뀐 두 곳만 봤다. 라운드 3 판정 시점과 md5 를 대조하면 변경 파일은 정확히 둘이다: `kis-domestic.ts`(L-7)와 `__tests__/kis-ticker-transient-recovery.test.ts`(L-6). `kis-overseas.ts`·`kis-http.ts`·`kis-balances-business-failure.test.ts`·`kis-ticker-business-failure.test.ts` 는 라운드 3 과 같다. 서버 재실행: `tsc --noEmit` exit 0 · `jest src/lib/exchanges` 25스위트 639건 통과 · 광역(`exchanges safety app/api strategy signals`) 183스위트 5188건 통과·실패 0 — 구현자 수치와 일치. 사본은 쓰고 지웠으며 작업트리 6파일 md5 는 감사 전후 동일하다. 다른 세션 파일·`.codex/` 미접촉.
- [17:02] L-7 토큰 비교 방식(`kis-domestic.ts:76` 의 `usedAuth` 와 `:85-86` 의 비교) — **맞다.** `usedAuth` 는 `kisFetch` 에 실제로 넘긴 그 `headers` 객체에서 읽으므로 「이번 요청이 쓴 토큰」과 정확히 같은 값이고, 두 번 읽는 사이의 회전 경쟁은 구조적으로 사라졌다. 건강한 경로의 DB SELECT 는 라운드 3 의 2회에서 **1회(HEAD 와 같음)** 로 돌아왔다(실험 S5: 신규 1·HEAD 1). 라운드 3 의 실제 `kis-auth` + 가짜 DB·가짜 KIS 하네스로 같은 시나리오를 다시 돌린 결과가 라운드 3 과 같다: S1 회전됨 — 성공, tokenP 0회·DB 쓰기 0건, 재시도가 `Bearer T2` 로 나갔고 곁다리 `getKisToken()` 도 정상 반환(HEAD 는 306ms 성공) · S4 같은 회전에서 시세 4건 동시 — 4건 전부 성공·tokenP 0·DB 쓰기 0 · S2 DB 토큰 폐기(재발급 허용) — 성공, tokenP 1회·DELETE+INSERT 1쌍, 재시도가 `Bearer N1` 로 나감(HEAD 는 같은 토큰으로 3번 때리고 500 실패) · S3 폐기됐는데 KIS 가 재발급 거부 — 여전히 60초 대기(Info, 라운드 3 에서 설명한 좁은 창이며 이번 변경으로 늘지도 줄지도 않았다).
- [17:03] 「`headers.Authorization` 이 `Bearer ${token}` 이라는 결합」에 대한 판단 — **받아들일 만하고, 방향은 fail-closed 다.** 헤더 형식이 바뀌어 `` `Bearer ${fresh}` !== usedAuth `` 가 항상 「다름」이 되면 「다른 프로세스가 회전시켰다」 분기로 가서 **재발급(`invalidateKisToken`)을 건너뛰고** 재읽기 토큰으로 한 번 더 시도한 뒤 던진다. 파괴적인 동작(DB 의 토큰 삭제 → 1분 제한 대기)은 하지 않는다는 뜻이라 M-2 가 막으려던 쪽으로는 안전하고, 잃는 것은 「DB 토큰 자체가 폐기된 드문 경우의 재발급」뿐이다 — 그것도 T-133 이전(HEAD)에는 아예 없던 복구이고 `getBalances` 등 다른 호출처는 자기 경로로 재발급한다. fail-open(항상 같다고 보고 무조건 재발급 = M-2 의 악화)이 되려면 비교값이 항상 같아야 하는데 그런 형식 드리프트는 만들어지지 않는다. 게다가 드리프트는 시험이 잡는다: 변이 D1(`kisHeaders` 의 `Bearer`→`Token`)에서 토큰 시험 2건이, D2(비교에서 `Bearer ` 접두 제거)에서 「같을 때만 재발급」 시험이 실패한다. 더 나은 모양(선택, Info): `Bearer ` 접두를 붙이는 한 줄 함수 `bearer(token)` 을 하나 두고 `kisHeaders` 와 비교가 같이 쓰면 문자열 중복 자체가 없어진다 — 지금 시험이 같은 역할을 하므로 필수는 아니다.
- [17:04] L-6 시험(`authOf` + 단언 3개) — 맞다. 내가 준 문구보다 방어적인 모양이다(`fetchMock.mock.calls[n]?.[1]?.headers?.Authorization`, 모양이 달라지면 `undefined` 가 되어 `toBe` 가 크게 실패한다) — 의미는 같고 `describe` 안에 있어 `fetchMock` 재할당도 정상으로 따라간다. 변이 결과(서버 사본, 변이마다 `src/lib/exchanges` 25스위트): D3 재시도가 첫 헤더 재사용(라운드 3 의 T4) → 회전 시험·같은 토큰 시험 **2건 실패**(구현자 수치와 일치) · D4 비교 뒤집기 2건 · D5 무조건 재발급 1건(회전 시험) · D6 재발급 호출 삭제 1건(같은 토큰 시험) · D1·D2 위 · **D7(`usedAuth` 를 다시 `getKisToken()` 으로 읽는 라운드 3 설계로 복귀)만 생존** — 이 변이는 동작이 같고 DB SELECT 한 번과 두 읽기 사이의 경쟁만 되살리므로 단위 시험으로는 구분되지 않는다(Info).
- [17:04] 결함·관찰(이번 라운드) — 새 결함 없음. L-6·L-7 모두 닫혔다. Info(선택): ① L-7 의 이득(건강한 경로에서 토큰을 한 번만 읽음)은 시험으로 고정돼 있지 않다 — D7 생존이 그 증거다. 건강 경로 시험(「정상 응답은 재시도하지 않는다 (1회)」)에 `expect(getKisToken).toHaveBeenCalledTimes(1)` 한 줄을 더하면 고정될 것으로 본다 [단순 추론, 실행해 보지 않음 — D7 에서는 호출이 2회가 된다]. ② 위 `bearer()` 헬퍼. ③ S3 잔여 창·울타리 `.ts` 전용 스캔(I-3, 후속 후보 7)·해외 토큰 경로(후속 후보 1)는 그대로.
- [17:05] 이행 조건 — 없음. 이 판정은 현재 작업트리(변경 파일 `kis-domestic.ts` md5 374a3f8a… · 복구 시험 md5 5b4a3026…)에 대한 것이며, 위 Info 의 한 줄을 추가하는 정도(시험 줄 하나)는 조건이 아니다.
- [17:05] QA 집중 점검 지점 — `src/lib/exchanges/kis-domestic.ts:67-97`(토큰 분기: `headers.Authorization` 대비 재읽기, 회전 시 재발급 0회)·`src/lib/exchanges/__tests__/kis-balances-business-failure.test.ts:131-140`(`isCommentOnly`)·`src/lib/exchanges/kis-overseas.ts:92-110`(예외 루프 × 안쪽 재시도 10회 경로, 변경 없음). 장중 첫 틱 뒤 `[kis-http] 일시 실패 재시도` 소진율(기준: T-132 직후 17건 중 소진 4건)과 `[kis-domestic getTicker] token` 로그 유무를 확인할 것.
- [17:06] **4차(라운드 4) 판정(라운드 5 판정으로 대체됨): pass (scope: src/lib/exchanges/kis-domestic.ts, src/lib/exchanges/kis-overseas.ts, src/lib/exchanges/kis-http.ts, src/lib/exchanges/__tests__/kis-balances-business-failure.test.ts, src/lib/exchanges/__tests__/kis-ticker-business-failure.test.ts, src/lib/exchanges/__tests__/kis-ticker-transient-recovery.test.ts)**
- [18:32] 라운드 5 범위·방법 — QA 반송 3건의 수정(파서 울타리 전환+자기 시험 / `isKisTokenError` 공개와 국내 토큰 조건 교체 / `String(rt_cd)` 정규화 2곳)을 봤다. 라운드 4 판정 이후 바뀐 파일은 `kis-domestic.ts`·`kis-overseas.ts`·`kis-http.ts`·울타리 시험·시세 시험 2개이고, `kis-http.ts` 는 이제 주석만이 아니라 **내보내는 함수 하나가 늘었다.** 서버 재실행: `tsc --noEmit` exit 0 · `jest src/lib/exchanges` 25스위트 642건 통과 · 광역(`exchanges safety app/api strategy signals`) 183스위트 5191건 통과·실패 0 — 구현자 수치와 일치. 감사용 사본은 쓰고 지웠고 작업트리 6파일 md5 는 감사 전후 동일하다. 다른 세션 파일·`.codex/`·`public/mockups` 미접촉.
- [18:33] 🔴 **울타리 파서 집계(QA #1)도 뚫린다 — 줄 기반 판에서 후퇴한 모양이 7개다.** `hitsIn` 은 `PropertyAssignment`·`ShorthandPropertyAssignment` 중 **이름이 식별자로 `transientRetries` 와 같은 것**만 센다(`kis-balances-business-failure.test.ts:129-146` 의 `node.name.getText(sf) === 'transientRetries'`). 파서는 주석을 trivia 로 버려 주석 위장은 막았지만, 같은 옵션을 다른 문법으로 쓰면 아예 속성 노드가 아니다. 실험(서버 사본에 우회 파일을 `src/lib/exchanges/` 에 두고 울타리 시험 실행, 모두 `{ method: 'POST' }` 주문 모양 + `label: 'evil createOrder'`): G2 작은따옴표 키 `{ 'transientRetries': 2 }` · G3 큰따옴표 키 · G4 계산 키 `{ ['transientRetries']: 2 }` · G5 대입문 `o.transientRetries = 2` · G6 요소 대입 `o['transientRetries'] = 2` · G7 getter `{ get transientRetries() {…} }` · G11 템플릿 계산 키 — **전부 8건 통과(무검출).** 잡히는 것: G1 주석 없는 일반 키(대조)·G8 shorthand·**G9 QA 가 찾은 별표 줄 제너레이터(닫혔다)**·G12 중첩 객체에 허용 라벨을 위조한 경우(허용 라벨이 두 번 쓰였다는 둘째 시험이 잡음). G10 주석·JSDoc 언급만 있는 경우는 0건으로 정상. 줄 문자열 판(라운드 3)은 `transientRetries` 가 들어간 줄을 다 셌으므로 G2~G7·G11 을 잡았다 — 즉 **층을 바꾸면서 문법 변형에 대한 커버리지를 잃었다.** 런타임 가드가 POST 를 요청 전에 막는 점(`kis-http.test.ts`)은 그대로라 자금 경로 노출은 아니고 정적 울타리의 보증이 줄었을 뿐이다. 같은 계열의 네 번째 지적이라 규칙이 아니라 **세는 대상**을 바꾸길 권한다: 속성 노드가 아니라 `transientRetries` 라는 **식별자·문자열 토큰 전부**를 센다.
- [18:34] 울타리 수정안(사본에서 검증 완료, 그대로 적용 가능) — `hitsIn` 의 조건을 `(ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && node.text === 'transientRetries'` 로 바꾸고, 라벨 대조용 `obj` 는 가장 가까운 객체 리터럴 조상(없으면 감싸는 문장)의 텍스트로 한다: `let scope: ts.Node = node; while (scope.parent && !ts.isObjectLiteralExpression(scope) && !ts.isStatement(scope)) scope = scope.parent; … obj: scope.getText(sf)`. 검증: 위 프로브 G1~G9·G11·G12 **전부 잡히고** G10 은 0건, 실제 5곳은 그대로 5건이라 `jest src/lib/exchanges` 642건 통과(수정안만 적용). 자기 시험에 사례 8개를 더하면(따옴표 키·계산 키 문자열·계산 키 템플릿·대입문·요소 대입·getter·shorthand·화살표 콜백 안, 각 1건) 8건 통과이고, 변이 P-1(문자열 토큰 제외)·P-2(식별자 제외)·P-3(화살표 함수 건너뜀)·P-4(클래스 건너뜀)을 각각 잡는다. 문자열 값이 정확히 `transientRetries` 인 경우는 세어지는데(오탐 쪽) 코드에 그런 문자열이 없어 문제없다.
- [18:35] 구현자 질문에 대한 답 — (a) **자기 시험을 깨 보았다**(서버 사본, 변이마다 `src/lib/exchanges` 25스위트): Q-B 「호출 인자로 쓰인 객체만 센다」·Q-C 「메서드 선언 건너뜀」·Q-D 「클래스 선언 건너뜀」은 자기 시험이 잡는다. **Q-A 「shorthand 제외」와 Q-E 「화살표 함수·함수 표현식 건너뜀」은 생존한다** — 합성 사례에 shorthand 와 콜백 안 호출이 없기 때문이다(위 사례 8개에 포함됨, Low). 합성 사례는 실제 파일 스캔과 **같은 `hitsIn` 함수**를 쓰므로 같은 경로를 탄다(확인). (b) `node.parent.getText(sf)` 라벨 대조 — **실제 구멍이 아니다.** 스프레드나 중첩으로 라벨이 바깥 객체에 있으면 라벨 대조가 실패해 시험이 **막는 쪽(오탐)** 이고, 안쪽에 허용 라벨 문자열을 위조해 넣는 시도는 「허용 라벨이 각각 정확히 한 번」 시험이 잡는다(G12). 진짜 구멍은 라벨이 아니라 위의 속성 이름 매칭이다. (c) `getBalances`·`getUsdCash` 를 안 바꾼 범위 판단 — **동의한다.** 그쪽은 재발급 먼저 모양이라 `EGW00121` 을 넣으면 라운드 2 의 M-2 를 그 경로에 새로 만든다. 그리고 그쪽의 `EGW00121` 무처리는 T-132 배포본에도 있던 기존 공백이지 이번 회귀가 아니다. 후속 후보 8 은 「재읽기 우선으로 바꾸면서 `isKisTokenError` 로 묶기」로 하면 되고, `EGW00121` 이 회전 시 더 흔한 코드일 수 있어 후순위로 두지 않기를 권한다 [추측].
- [18:36] QA #2(`EGW00121`) 수정 — **맞다.** 실제 `kis-auth` + 가짜 DB·가짜 KIS 하네스에 만료 본문을 `EGW00121`(「유효하지 않은 token」)로 바꿔 라운드 4 와 같은 시나리오를 다시 돌렸다: S1 회전됨 — 성공, tokenP 0회·DB 쓰기 0건, 재시도가 `Bearer T2` 로 나감(HEAD 306ms 성공 — QA 가 짚은 후퇴가 닫혔다) · S4 시세 4건 동시 — 전부 성공 · S2 DB 토큰 폐기 — 성공, tokenP 1회(HEAD 는 실패) · S3 재발급 거부 창 — 여전히 60초 대기(Info, 변화 없음) · 건강한 경로 DB SELECT 1회(HEAD 와 같음). `isKisTokenError` 는 `TOKEN_ERROR_PATTERN`(플래그 없는 정규식이라 상태 없음)을 그대로 쓰는 순수 함수라 게이트웨이와 어댑터가 단일 출처다. 변이: 어댑터를 `EGW00123` 만 보게(R-A)·패턴에서 `EGW00121` 삭제(R-D) 모두 새 시험이 잡는다. 생존 변이 하나 — R-E 「토큰 오류가 아닌 응답도 전부 토큰 분기」: 국내에는 **토큰 오류가 아닌 지속 500** 을 검증하는 시험이 없어(해외에만 있다) 642건 전부 통과한다(L-9, Low). 이 분기가 위험한 동작(재발급 요청)을 하는 곳이라 시험으로 고정할 가치가 있다. 사본에서 검증한 시험: `fetchMock` 이 계속 500 `EGW00300`(`GATEWAY`)을 돌려줄 때 `domGetTicker('005930')` 가 `/KIS getTicker 005930: 500/` 로 거부되고, `expect(fetchMock).toHaveBeenCalledTimes(3)`, `expect(invalidateKisToken).not.toHaveBeenCalled()` — 실제 코드에서 통과하고 R-E 에서 실패한다.
- [18:36] QA #3(숫자형 `rt_cd`) 수정 — 맞다. 국내·해외 `data?.rt_cd != null && String(data.rt_cd) !== '0'`: 숫자 0 은 정상, 숫자 9·`true`·빈 문자열은 계속 실패(fail-closed). 게이트웨이 재시도 판정(`rtCdOf`)은 문자열 `"rt_cd":"…"` 만 읽으므로 숫자 9 는 재시도하지 않고 어댑터가 바로 던진다 — 후속 후보 4 로 이미 분리된 동작이다. 변이 R-B(국내 엄격 비교)·R-C(해외 엄격 비교)를 새 시험이 각각 잡는다.
- [18:37] 결함·관찰(이번 라운드) — **M-3 (Medium)** `__tests__/kis-balances-business-failure.test.ts:129-146` `hitsIn` 이 따옴표 키·계산 키·대입문·요소 대입·getter·템플릿 계산 키 7개 모양을 세지 못한다(줄 기반 판보다 후퇴, 수정안 위 bullet). **L-8 (Low)** 자기 시험에 shorthand·콜백 안 호출 사례가 없다(Q-A·Q-E 생존, 수정안의 사례 8개에 포함). **L-9 (Low)** 국내 토큰 아닌 지속 500 시험 없음(R-E 생존, 시험 문구 위). Info: ① `kis-ticker-business-failure.test.ts:24-28` 의 `jest.mock('../kis-http')` 공장에 `isKisTokenError` 가 없다 — 지금은 비정상 응답 경로를 안 타서 무해하지만, 나중에 그 경로를 타는 시험이 생기면 `isKisTokenError is not a function` 으로 본래 오류를 가린다(`isKisTokenError: jest.fn(() => false)` 한 줄). ② `kis-http.ts:215-217` 의 `TOKEN_ERROR_PATTERN` 설명이 아직 「호출부가 `body.includes('EGW00123')`」라고 적고 있어 새 공개 함수와 어긋난다. ③ 울타리가 `.ts` 만 스캔하는 점(I-3)·S3 잔여 창·해외 토큰 경로(후속 후보 1)는 그대로.
- [18:38] 이행 조건 — C1'': M-3 수정안 적용(`hitsIn` 조건·`obj` 산출 + 자기 시험 사례 8개), C2'': L-9 시험 1건 추가. 둘 다 위에 문구를 적었고 사본에서 함께 검증했다(울타리 시험 8건 통과·변이 4종 포획, 새 시험 통과·R-E 포획). 문구 그대로 적용하면 다음 라운드는 diff 대조와 같은 검증 재실행으로 끝난다. 선택: Info ①②. 판정 기준: 규칙을 세 번째로 고치지 않고 층을 바꾼 방향은 옳았으나, 세는 대상이 속성 노드 하나로 좁아 정적 울타리의 보증이 줄었다 — 이대로는 통과시키지 않는다. Critical 은 없다.
- [18:38] QA 집중 점검 지점 — `src/lib/exchanges/__tests__/kis-balances-business-failure.test.ts` 의 `hitsIn`(문법 변형 프로브)·`src/lib/exchanges/kis-domestic.ts:86-100`(`isKisTokenError` 분기, 회전 시 재발급 0회·동일 토큰일 때만 재발급)·`src/lib/exchanges/kis-http.ts:229-231`(`isKisTokenError`)·`src/lib/exchanges/kis-overseas.ts:92-110`(예외 루프 × 안쪽 재시도 10회 경로, 변경 없음). 수정 뒤 QA 가 같은 G2~G7·G11 프로브(작은따옴표·큰따옴표 키, 계산 키, 대입문, 요소 대입, getter, 템플릿 키)를 독립으로 다시 돌릴 것.
- [18:39] **5차(라운드 5) 판정(라운드 6 판정으로 대체됨): fail (scope: src/lib/exchanges/kis-domestic.ts, src/lib/exchanges/kis-overseas.ts, src/lib/exchanges/kis-http.ts, src/lib/exchanges/__tests__/kis-balances-business-failure.test.ts, src/lib/exchanges/__tests__/kis-ticker-business-failure.test.ts, src/lib/exchanges/__tests__/kis-ticker-transient-recovery.test.ts)**
- [19:05] 라운드 6 범위·방법 — 라운드 5 판정 이후 바뀐 부분만 봤다: 울타리 시험(`hitsIn` 조건·`obj` 산출·자기 시험 17건)·L-9 시험 1건·시험 2파일의 `jest.mock('../kis-http')` 공장·`kis-http.ts` 설명 주석. **운영 코드는 바뀌지 않았다** — `kis-domestic.ts`·`kis-overseas.ts` md5 가 라운드 5 와 같고, `kis-http.ts` 의 코드 변화는 라운드 5 에서 본 `isKisTokenError` 한 함수뿐(이번엔 주석만 바뀜, 비주석 diff 로 확인). 서버 재실행: `tsc --noEmit` exit 0 · `jest src/lib/exchanges` 25스위트 643건 통과 · 광역(`exchanges safety app/api strategy signals`) 183스위트 5192건 통과·실패 0 — 구현자 수치(5191+1)와 일치. 감사용 사본은 쓰고 지웠고 작업트리 6파일 md5 는 감사 전후 동일하다. 다른 세션 파일·`.codex/`·`public/mockups` 미접촉.
- [19:06] M-3 울타리 — **닫혔다.** 적용된 `hitsIn` 은 내가 검증한 문구 그대로다(식별자·문자열 토큰 전부를 세고, 라벨 대조 범위는 가장 가까운 객체 리터럴 조상, 없으면 감싸는 문장). 라운드 5 의 우회 파일을 실제 파일 스캔 경로로 다시 돌렸다(서버 사본에 우회 파일을 `src/lib/exchanges/` 에 두고 울타리 시험 실행, 전부 `{ method: 'POST' }` 주문 모양): G1 일반 키(대조)·**G2 작은따옴표 키·G3 큰따옴표 키·G4 계산 키·G5 `o.transientRetries = 2`·G6 `o['transientRetries'] = 2`·G7 getter·G11 템플릿 계산 키**·G8 shorthand·G9 별표 줄 제너레이터·G12 허용 라벨 위조 — **전부 잡힘**, 주석·JSDoc 언급만 있는 G10 과 무변경 G0 은 8건 통과. 새로 만든 추가 프로브도 잡힌다: H1 구조분해 이름 변경·H2 템플릿 치환 `${'transientRetries'}`·H5 `Reflect.set(o, 'transientRetries', 2)`·H6 유니코드 이스케이프 식별자 `transientRetries`(파서가 풀어서 센다). 못 잡는 것(아래 잔여): H3 키를 문자열 연결로 만드는 경우·H7 `.tsx` 파일·H8 하위 디렉터리의 파일.
- [19:07] 자기 시험 17건·L-8 — **닫혔다.** 라운드 5 보다 넓게 변이 11종을 각각 사본에서 돌렸고(변이마다 울타리 시험 파일) **전부 잡힌다**: P-1 문자열 토큰 제외·P-2 식별자 제외·P-3 화살표 함수 건너뜀·P-4 클래스 건너뜀·P-5 메서드 선언 건너뜀·P-6 shorthand 제외·P-7 getter 제외·P-8 요소 접근·계산 키 제외·P-9 `o.x = …` 제외·P-10 라벨 범위를 토큰 하나로 축소·P-11 이중 집계. 라운드 5 에서 생존했던 shorthand·화살표 콜백 변이(L-8)도 이제 잡힌다. 합성 사례는 실제 스캔과 같은 `hitsIn` 을 타므로 같은 경로다.
- [19:07] L-9 — 맞다. 「토큰 오류가 아닌 지속 500 은 재발급 없이 소진 후 던진다」(`GATEWAY` 500 계속 → `/KIS getTicker 005930: 500/` 거부·fetch 3회·`invalidateKisToken` 0회)가 실제 코드에서 통과하고, 토큰 판정을 「모든 오류」로 넓히는 변이(R-E)에서 정확히 그 시험 1건이 실패한다(1 failed / 642 passed). Info 반영도 확인: 시험 2파일의 `jest.mock('../kis-http')` 공장에 `isKisTokenError: jest.fn(() => false)` 가 들어갔고, `kis-http.ts` 설명이 `isKisTokenError()` 와 `EGW00121` 사각지대 경위로 바뀌었다. 다만 그 설명의 「호출부가 `body.includes('EGW00123')` 를 손으로 적던 때는」은 과거형인데 `getBalances`·`getUsdCash` 등은 아직 손으로 적은 `EGW00123` 만 본다(후속 후보 8) — 오해 소지가 있는 표현이지만 동작과 무관한 Info.
- [19:08] **「남은 위험이 커밋을 더 미루는 것보다 큰가」에 대한 한 줄 판단 — 아니다, 동의한다. 이 판으로 커밋·QA 로 넘기는 것이 맞다.** 근거: ① 다섯 번의 울타리 지적은 전부 정적 시험의 정밀도이고 그때마다 실제 방어선(`kisFetch` 런타임 가드: GET 이 아니면 요청 전에 던진다 — `kis-http.test.ts` 6건과 사본 프로브로 매 라운드 재확인)은 그대로 막았다. ② 운영 코드는 라운드 5 부터 변하지 않았고 라운드 3~5 에서 실제 동작(회전·폐기·`EGW00121`·숫자 `rt_cd`)을 가짜 KIS 로 실측했다. ③ 지금 판은 잡혀야 할 프로브 15종 전부 + 변이 11종 + 합성 사례 17건이 모두 기대대로이고, 못 잡는 모양(키를 문자열 연결로 조립·`.tsx`·하위 디렉터리)은 정적 시험으로 원리상 못 막는 것이거나(조립) 후속 후보 7 의 범위이며 마찬가지로 런타임 가드가 막는다. 단, 이 울타리에 시간을 더 쓰지 말 것을 권한다 — 같은 종류의 추가 지적은 앞으로 Low 로 기록하고 차단 사유로 쓰지 않겠다. 정말 줄일 가치가 있는 위험은 울타리가 아니라 장중 첫 틱의 실동작(재시도 소진율·토큰 로그)이다.
- [19:08] 결함·관찰(이번 라운드) — 새 결함 없음. M-3·L-8·L-9·Info 2건 모두 닫혔다. 잔여 Info: ① 울타리는 `src/lib/exchanges/*.ts` 최상위만 스캔한다(`.tsx`·`.mts`·`.js`·하위 디렉터리 제외, 후속 후보 7 — 파서로 바꿨으니 재귀 스캔으로 넓히는 것은 쉽다). ② 키를 문자열 연결로 조립하면 정적으로 못 잡는다(런타임 가드 몫). ③ 위 `kis-http.ts` 설명의 과거형. ④ 이전 라운드 Info 들(S3 재발급 거부 창·해외 토큰 경로 후속 후보 1·잔고 쪽 `EGW00121` 후속 후보 8·숫자형 `rt_cd` 잔고 쪽 후속 후보 4)은 그대로다.
- [19:09] 이행 조건 — 없음. 이 판정은 현재 작업트리(`kis-domestic.ts` md5 8a05b1fb… · 울타리 시험 md5 836b9509… · 복구 시험 md5 a16ede55…)에 대한 것이다.
- [19:09] QA 집중 점검 지점 — 라운드 5 와 같다: `src/lib/exchanges/kis-domestic.ts:86-100`(`isKisTokenError` 분기)·`src/lib/exchanges/kis-http.ts:232-234`·`src/lib/exchanges/kis-overseas.ts:92-110`(예외 루프 × 안쪽 재시도 10회 경로)·울타리 `hitsIn`(G2~G7·G11 프로브 독립 재실행). 장중 첫 틱 뒤 `[kis-http] 일시 실패 재시도` 소진율(기준: T-132 직후 17건 중 소진 4건)과 `[kis-domestic getTicker] token` 로그 유무를 확인할 것.
- [19:10] **최종 판정: PASS (scope: src/lib/exchanges/kis-domestic.ts, src/lib/exchanges/kis-overseas.ts, src/lib/exchanges/kis-http.ts, src/lib/exchanges/__tests__/kis-balances-business-failure.test.ts, src/lib/exchanges/__tests__/kis-ticker-business-failure.test.ts, src/lib/exchanges/__tests__/kis-ticker-transient-recovery.test.ts)**

## 구현 라운드 2 — 1차 감사 이행 조건 반영 (메인 세션)

> 🔴 이 제목에는 **감사자 역할 이름을 쓰지 않는다.** 커밋 훅의 `reviewer_body()` 는 제목에 그 단어가
> 든 `##`/`###` 헤딩을 전부 감사 구간으로 간주하므로, 구현 쪽 절이 그 단어를 쓰면 훅의 섹션 스캔이
> 이 절까지 먹는다(CLAUDE.md 경고). 라운드 2 의 첫 제목이 실제로 그랬고 감사자가 지적했다.

Reviewer 판정은 **CONDITIONAL_PASS**(Medium 1·Low 4)였고 커밋 전 이행 조건 C1·C2 가 붙었다. 아래가 그 반영이다. **지적 5건 전부와 Info 4건 중 2건을 반영했고, 반영하지 않은 것은 이유를 적었다.**

- [15:50] **C1 / M-1 (Medium) — 울타리 구멍을 닫았다.** `isCommentLine`(`startsWith('/*')` 이면 무조건 제외)은 Reviewer 가 실증한 대로 **블록 주석을 같은 줄에서 닫고 뒤에 코드를 붙이면 통과**했다. `isCommentOnly` 로 바꿨다 — `*`·`//` 로 시작하면 주석, `/*` 로 시작하면 **같은 줄에서 닫히지 않을 때** 또는 **닫힌 뒤가 공백일 때만** 주석. 애매하면 **센다**(fail-closed).
  - 문자열 전체에서 주석을 지운 뒤 세는 방식은 **쓰지 않았다** — 문자열 리터럴 안의 `//`(URL 등) 때문에 호출 지점이 통째로 사라지는 더 큰 구멍이 생긴다. 근거를 시험 주석에 남겼다.
  - 거짓이던 시험 주석(「구멍이 생기지 않는다」)을 삭제하고 Reviewer M-1 을 출처로 적었다.
  - **울타리 자신의 회귀 시험 9건을 새로 넣었다** — 주석만인 줄 5개와 **코드가 붙은 줄 4개**(M-1 우회 모양 포함)를 고정한다. 변이 검증: `isCommentOnly` 를 예전 느슨한 판으로 되돌리면 그 시험이 정확히 M-1 줄에서 실패한다(서버 사본에서 확인, 1 failed / 7 passed). 사본은 삭제했다.
- [15:52] **C2 / L-1 (Low) — 정정이 아니라 복구를 택했다.** 「동작 차이 없다」는 거짓이었다(Reviewer 실험). 국내 `getTicker` 에 `getBalances` 와 **같은 모양**의 토큰 재발급 루프를 1회만 넣었다 — `EGW00123`·`만료된 token` 이면 `invalidateKisToken()` 후 헤더를 다시 만들어 1회 재시도. 게이트웨이가 토큰 오류를 재시도하지 **않는** 것(`isTransientKisFailure` 제외)이 바로 이 처리를 어댑터 몫으로 둔 설계다. ~~종전보다 나아졌다~~ — **이 주장은 라운드 2 감사에서 틀린 것으로 확인됐다(M-2). 라운드 3 에서 고쳤다(아래 절).**
  - **해외는 넣지 않았다** — 해외는 종전에도 헤더를 루프 밖에서 한 번만 만들어 공백이 **원래** 있었다(Reviewer 확인). 넣으면 범위 확대라 후속 후보 1 에 남긴다.
- [15:54] **C2 / L-2 (Low) — 수치 3건을 정정했다.**
  - 호출 상한: 해외 「최대 6회(이전 2회)」 → **최악 10회**(예외 2 × `kisFetch` 5 = 최초 1+일시 2+레이트리밋 2), **종전 최악은 6회**. 국내도 같은 누락이 있었다 — 「총 3회」는 레이트리밋을 뺀 값이고, 토큰 루프까지 세면 **최악 10회**(종전 9회). 두 어댑터 주석을 고쳤다.
  - 벽시계: 「20초 안팎」 → **실측 9.0초·이론 상한 약 34초**(Reviewer 측정).
  - `kis-http.ts` 「관측된 복구는 전부 2회차」 → **첫 재시도 복구 11 · 두 번째 복구 2 · 소진 4**(재시도 붙은 17건). 12분 표본 3건만 보고 쓴 것이 원인이다. 예산을 1 로 줄이지 않은 근거가 오히려 여기서 나온다(두 번째 회차가 2건을 구했다).
  - fan-out 「+16%」에 **지속 장애 시 영향 종목마다 3배**, 비용은 호출 수보다 **순차 호출부 지연**(소진 1건당 +1.3~1.8초)이라는 Reviewer L-2·L-3 를 덧붙였다.
- [15:55] **L-4 (Low) — 시험 공백 4곳 중 4곳을 채웠다.** 해외 `timeoutMs: 5000` 고정(옵션 계약 시험 — 변이 M9 가 살아남은 지점) · 국내 옵션 계약(`timeoutMs` 를 쓰지 않는다는 것까지) · 해외 `rt_cd` 없음 회귀(변이 M10) · 레이트리밋 호출 수 고정(총 3회 — 일시 예산을 쓰지 않는 것) · 토큰 만료 2건(위 L-1).
- [15:55] **Info I-1 — 시험 건수 정정.** 구현 기록의 「18건(8+10)」은 틀렸다. 라운드 1 실제는 7+9=16건이고, 라운드 2 에서 7건(울타리 자기 1 + 계약 2 + 해외 rt_cd 없음 1 + 토큰 2 + 레이트리밋 1)을 더해 **23건**이다.
- [15:56] **Info I-4 — 해외 `if (!res)` 가 도달 불가인 것**을 주석으로 명시했다(삭제하면 `res` 가 `Response | undefined` 로 남아 타입이 깨진다).
- [15:56] **반영하지 않은 것** — Info I-2(4xx + `rt_cd≠0` 도 이제 재시도한다. 영구 업무실패가 운영 로그에 없었고 `universe`·`favorites` 경로는 미확인): 재시도 2회를 쓰고 같은 실패를 그대로 돌려주므로 **동작은 바뀌지 않고 호출만 늘어난다**. 실제 사례를 보기 전에 분기를 더하면 근거 없는 복잡도라 **후속 후보 6** 으로 남긴다. Info I-3(울타리가 `src/lib/exchanges/*.ts` 최상위만 스캔): 하위 디렉터리에 어댑터가 생기면 놓친다 — T-132 가 만든 구조적 한계이고 이번 변경이 넓히지 않았다. **후속 후보 7**.
- [15:58] 재검증 — 서버 `npm run typecheck` **exit 0**, `npx jest src/lib/exchanges` **25스위트 637건 전부 통과**(라운드 1 의 630 + 신규 7).

### 재확인 요청 범위 (감사자에게)

Reviewer 가 「수정이 들어가면 이 판정은 수정 전 버전에 대한 것」이라고 명시했다. 재확인 대상은 **울타리 시험(`isCommentOnly` + 자기 회귀 시험 9건)**, **국내 `getTicker` 토큰 재발급 루프**, **주석 수치 정정 3곳**, **신규 시험 7건**이다.

## 구현 라운드 3 — 2차 감사 FAIL 이행 조건 반영 (메인 세션)

2차 감사 판정은 **FAIL**(Medium 2·Low 1)이었다. 내가 라운드 2 에서 **반쯤만 닫고**(M-1 잔여), **하나는 더 나쁘게 만들었다**(M-2). 아래가 라운드 3 반영이다.

- [16:20] **C1' / M-1 잔여 (Medium) — 울타리의 `*` 분기도 닫기 검사를 한다.** 라운드 2 는 `/*` 분기만 고치고 `*` 분기를 `return true` 로 남겨, `*/ return kisFetch(… POST … transientRetries …)` 와 `* 메모 */ code` 가 그대로 통과했다. 이제 `*`·`/*` 를 같은 분기로 묶어 **닫힌 뒤가 비었을 때만** 주석으로 본다. 자기 회귀 시험에 그 두 모양을 **코드(세야 함)** 로 추가해 11건이 됐다.
  - 변이 검증(서버 사본): `*` 분기를 라운드 2 상태(`return true`)로 되돌리면 자기 시험이 그 줄에서 실패한다(1 failed / 7 passed).
  - 감사자가 라운드 1 에 제안했던 "파일 전체 주석 치환" 을 쓰지 않은 내 판단은 **라운드 2 감사에서 옳다고 확인됐다**(문자열 속 `//`·`/*` 가 호출 지점을 지운다. 감사자가 자기 문구가 부적절했다고 정정).
- [16:24] **C2' / M-2 (Medium) — 토큰 루프를 「재읽기 먼저·같을 때만 재발급」으로 바꿨다.** 라운드 2 의 `getBalances` 복제는 **복구가 아니라 악화**였다. 감사자가 실제 `kis-auth` + 가짜 DB·가짜 KIS 로 실측했다: 다른 프로세스가 토큰을 회전시켜 둔 경우 종전(HEAD)은 306ms 에 성공하는데, 라운드 2 는 `invalidateKisToken()` 이 **멀쩡한 새 토큰을 지우고** 재발급을 요청해 `EGW00133`(앱키당 1분 1회)에 걸려 60초 대기에 들어갔고 4.1초 뒤에도 끝나지 않았다. 그 사이 같은 프로세스의 모든 `getKisToken()` 이 막히는데 **`createOrder` 도 그 경로다.**
  - 고친 모양: 만료를 보면 먼저 `getKisToken()` 으로 **DB 를 다시 읽고**(이 함수는 호출마다 DB 를 본다 — `kis-auth.ts:38-60` 확인), 값이 방금 쓴 토큰과 **같을 때만** `invalidateKisToken()` 한다.
  - 시험 2건을 교체·1건 추가 — 「회전돼 있으면 `invalidateKisToken` **0회**·fetch 2회」(M-2 회귀 가드) / 「같은 토큰이면 1회」 / 「두 번 만료면 던지고 토큰 분기는 1회뿐」.
  - 변이 검증: 재읽기를 지우면 회귀 가드가 실패한다.
  - 틀렸던 주장(「종전보다 나아졌다」, 시험 주석의 「종전 복구를 이 루프가 대신한다」)을 지우고 정정했다.
- [16:26] **C3' / L-5 (Low)** — `kis-http.ts` 에 남아 있던 「국내는 종전과 같은 총 3회」를 지우고, 레이트리밋까지 센 상한(**국내 최악 10회·종전 9회 / 해외 최악 10회·종전 6회**)으로 통일했다.
- [16:28] **훅 위험 제거(감사자 지적)** — `## 구현 라운드 2 — Reviewer …` 제목에 감사자 역할 이름이 들어가 커밋 훅의 `reviewer_body()` 가 그 절까지 감사 구간으로 스캔하고 있었다. 제목 2개에서 그 단어를 빼고, 왜 쓰면 안 되는지를 인용구로 남겼다. 지금 역할 이름이 든 헤딩은 `## Reviewer` 하나뿐이다.
- [16:30] **내 시험의 잠재 결함 1건을 변이 검증 중에 발견해 고쳤다** — `jest.mock` 공장이 만든 `getKisToken`·`invalidateKisToken` 은 모듈당 하나라 **호출 횟수가 시험 사이에 누적**된다(`restoreAllMocks()` 는 spy 만 되돌린다). 토큰 시험 3건이 그 횟수를 단언하므로 시험 순서에 결과가 딸려 갔다. `beforeEach` 에 `jest.clearAllMocks()` 를 넣고 이유를 주석에 남겼다.
- [16:32] 재검증 — 서버 `npm run typecheck` **exit 0** · `npx jest src/lib/exchanges` **25스위트 639건** · 광역 `exchanges·safety·app/api·strategy·signals` **183스위트 5188건 통과·실패 0**. 변이·감사용 서버 사본(`~/.node-local/t133-*`)은 전부 삭제했다.

### 라운드 3 재확인 요청 범위

울타리 `*` 분기 + 자기 시험 11건 · 국내 토큰 루프(재읽기 먼저) + 토큰 시험 3건 · `kis-http.ts` 상한 문구 · `beforeEach` 의 `clearAllMocks` · 제목에서 역할 이름 제거.

## 구현 라운드 4 — 3차 감사 PASS 뒤 남은 Low 2건 반영 (메인 세션)

3차 감사 판정은 **PASS**(Critical·High·Medium 0)였고 통과를 막지 않는 Low 2건이 남았다. 둘 다 반영했다 — L-6 은 감사자가 "이 문구 그대로 넣으면 재감사 없이 적용해도 된다"고 명시한 보강이고, **L-7 은 코드를 바꾸므로 그 부분만 재확인을 요청한다.**

- [16:50] **L-6 — 재시도가 정말 새 토큰을 쓰는지 단언한다.** 토큰 시험 3건이 호출 **횟수**만 봐서, 재시도가 첫 헤더를 재사용하는 변이(T4)가 639건 전부 통과로 살아남았다. `authOf(n)` 헬퍼로 n 번째 fetch 의 `Authorization` 을 읽어 단언 3개를 넣었다(회전 시 `Bearer tok` → `Bearer rotated-by-other-process`, 재발급 시 `Bearer reissued`).
  - 변이 검증: 헤더를 루프 밖으로 올리면 그 두 단언이 정확히 실패한다(2 failed / 12 passed).
- [16:52] **L-7 — 건강한 경로의 DB SELECT 가 2배가 되던 것을 없앴다.** `usedToken = await getKisToken()` 이 `getTicker` 마다 SELECT 를 1회 더 했다(유니버스 150종목 스캔이면 +150회). 감사자 제안대로 **`kisHeaders()` 가 돌려준 `headers.Authorization` 을 "방금 쓴 토큰" 으로 쓴다** — 추가 읽기가 사라지고, 두 번 읽는 사이에 토큰이 회전하는 경쟁도 **함께 없어진다**(라운드 3 에서 "안전 방향" 으로 넘겼던 그 경쟁).
  - 비교는 `` `Bearer ${fresh}` !== usedAuth `` 다. 동작은 라운드 3 과 같고 읽기 한 번이 줄었다.
- [16:54] 재검증 — 서버 `npm run typecheck` **exit 0** · `npx jest src/lib/exchanges` **25스위트 639건 통과**. 변이 사본은 삭제했다.

### 라운드 4 재확인 요청 범위 (아주 좁다)

`kis-domestic.ts` 토큰 비교를 `getKisToken()` 재호출 → `headers.Authorization` 으로 바꾼 diff 와, 시험의 `authOf` 헬퍼·단언 3개. 그 밖은 라운드 3 PASS 상태 그대로다.

## 구현 라운드 4b — 4차 감사 PASS 뒤 Info 1건 반영 (메인 세션)

4차 감사는 **PASS**(새 결함 0)였고 L-6·L-7 둘 다 닫혔다고 판정됐다. `Bearer` 결합은 **fail-closed 방향**이라고 확인됐다 — 형식이 드리프트하면 "다른 프로세스가 회전시켰다" 분기로 가서 재발급을 건너뛸 뿐, 멀쩡한 토큰을 지우거나 60초 정지를 만들지 않는다(fail-open 은 "항상 재발급" 쪽이고 그것이 M-2 였다). 드리프트는 시험이 잡는다.

- [17:05] **라운드 4 Info 반영(시험 1줄)** — 감사자가 「`usedAuth` 를 다시 `getKisToken()` 으로 읽는 라운드 3 설계로 복귀」 변이가 **생존**한다고 보고했다(동작이 같아 단위 시험으로 구분되지 않는다 = L-7 의 이득이 고정돼 있지 않다). 감사자가 문구까지 제시한 `expect(getKisToken).toHaveBeenCalledTimes(1)` 를 「정상 응답은 재시도하지 않는다」 시험에 넣었다.
  - 감사자는 이 한 줄을 **실행해 보지 않고 추론으로** 권고했으므로 내가 변이로 확인했다: 그 설계로 되돌리면 이 시험이 정확히 실패한다(1 failed / 13 passed).
  - **이 한 줄은 4차 PASS 판정 이후의 변경이다.** 감사자가 글로 권고한 문구이고 시험 파일 한 줄(단언 추가)이라 재감사를 요청하지 않았다 — 대신 **QA 가 독립 재실행으로 확인한다.** 판정의 `scope` 에 이 파일이 들어 있고, 변경 방향이 단언을 **강화**하는 쪽이라 "차용된 정당성" 에 해당하지 않는다고 판단했다.
- [17:06] 감사자가 남긴 선택 사항(미적용) — `bearer(token)` 한 줄 함수를 `kisHeaders` 와 비교가 공유하는 모양. 시험이 같은 역할을 하므로 넣지 않았다. 필요해지면 후속.

## QA

- [17:16] 범위·방법 — 커밋 전 작업트리 6파일(kis-domestic.ts·kis-overseas.ts·kis-http.ts(주석만)·kis-balances-business-failure.test.ts·kis-ticker-business-failure.test.ts·kis-ticker-transient-recovery.test.ts)을 서버에서 실행해 확인했다. 저장소 작업트리는 건드리지 않았다(`git diff --stat` 4파일 210+/70-, 미추적 목록 전후 동일). 변이·프로브는 `~/.node-local/qa-t133/repo` 사본(node_modules 심볼릭 링크)에서만 돌렸고 사본 소스는 삭제했다. 로그·프로브 원본은 `~/.node-local/qa-t133/` 에 남아 있다.
- [17:16] 재현 1 (지정 명령) — 서버 `npm run typecheck` exit 0(16:21). `npx jest src/lib/exchanges` 25 스위트 639건 전부 통과 — 2회(16:23·16:43) 모두 동일. 광역 `npx jest src/lib/exchanges src/lib/safety src/app/api src/lib/strategy src/lib/signals` 183 스위트 5188건 통과·실패 0, 3 스위트 100건 skip(이번 diff 밖 파일, 정체는 확인하지 않음). 구현자 수치 639·5188 과 일치한다.
- [17:16] 재현 2 (안전장치) — `git diff -- src/lib/safety src/app/api/orders` 0줄. `transientRetries: 2` 호출 지점은 5곳이고 전부 GET 조회다: kis-domestic.ts:77(시세)·:276(잔고), kis-overseas.ts:100(시세)·:463(예수금)·:646(잔고). 주문·취소·원장 경로는 0곳. `kisFetch` 런타임 가드는 요청 전에 던진다(P10: POST + transientRetries → fetch 0회).
- [17:16] 결함 #1 [Severity: Medium] 울타리 정적 시험 우회 — 파일 `src/lib/exchanges/__tests__/kis-balances-business-failure.test.ts:131-140` (`isCommentOnly` 의 `*` 분기: `*/` 가 없으면 주석으로 본다). 재현: 줄 첫 글자가 `*` 인 코드 연속 줄 `    * 1) && await kisFetch(url, { method: 'POST' }, { label: 'qa probe bypass', transientRetries: 2 });` 를 `src/lib/exchanges/zz-qa-probe.ts`(사본, 원본 `~/.node-local/qa-t133/probes/zz-qa-probe.ts`)에 두면 울타리 시험 8건이 **전부 통과**한다(`bypass-fence.log`). 기대는 실패다. 영향: 정적 울타리만 뚫린다. 런타임 가드가 요청 전에 던지므로 중복 주문은 나가지 않지만(P11: fetch 0회), 그 모양이 주문 경로에 들어가면 주문이 실패로 끝난다. 수정 방향(QA 는 코드를 고치지 않음): 줄 문자열 판정 대신 TypeScript 파서(`typescript` 는 이미 의존성)로 주석을 제외하고 `transientRetries` 속성을 센다. 줄 단위 `*` 판정을 조이면 기존 주석 줄이 대량 오탐된다.
- [17:16] 결함 #2 [Severity: Medium] 토큰 회전 시 EGW00121 복구 회귀 — 파일 `src/lib/exchanges/kis-domestic.ts:83`(`body.includes('EGW00123') || body.includes('만료된 token')`). `kis-http.ts:219` 의 `TOKEN_ERROR_PATTERN` 은 EGW00121 을 토큰 오류로 분류해 게이트웨이 재시도에서 빼지만, 어댑터 분기는 EGW00123 만 본다 → 어느 쪽도 EGW00121 을 처리하지 않는다. 재현(P1, `probe-behavior.log`): 500 `EGW00121` + 같은 순간 DB 토큰 회전 → **HEAD 는 2회 호출·성공**(매 시도 DB 토큰을 다시 읽음), **신규는 1회 호출 후 `KIS getTicker 005930: 500` 을 던진다**. 영구 EGW00121(P2)은 실패 결과가 같고 호출만 3→1 로 준다(무해). 영향: 다중 프로세스가 같은 앱키 토큰을 회전시키는 상황(kis-auth.ts 주석이 명시)에서 시세가 복구되지 않는다 → portfolio-total 총액 제외(보수적 방향). 발생 빈도는 미확인이다(운영 로그 대조 필요). 같은 EGW00123-only 조건이 잔고·예수금 분기에도 있다(kis-domestic.ts:279·665, kis-overseas.ts:466·607·649·1021) — 이번 diff 밖이므로 범위 결정은 Leader·Reviewer 몫. 수정 방향: getTicker 토큰 조건에 `EGW00121` 추가 + P1 과 같은 시험 1건.
- [17:16] 결함 #3 [Severity: Low] 숫자형 `rt_cd` 0 성공을 업무실패로 던짐 — 파일 `kis-domestic.ts:105`·`kis-overseas.ts:126`(`data.rt_cd !== '0'`). 재현(P4): `{"rt_cd":0,"output":{...}}` → HEAD OK / 신규 `200 업무실패 rt_cd=0` 던짐. 근거는 T-132 관찰("KIS 는 문자열만 쓴다")이며 실응답 대조는 하지 않았다([가능성 높음]). 같은 규칙이 잔고 쪽(kis-domestic.ts:296, kis-overseas.ts:665)에도 있다. `String(data.rt_cd)` 정규화를 권한다.
- [17:16] 변이 9종 (사본, 각 1회 실행) — A 토큰 비교 뒤집기 → 2 실패 · B 항상 재발급 → 1 · C 재읽기 제거 → 1 · **D 라운드 3 설계 복귀(`usedAuth` 를 `getKisToken()` 재호출) → 1 실패: 「정상 응답은 재시도하지 않는다」 — 라운드 4b 의 1줄 단언이 독립적으로 잡는다 확인** · E 헤더를 루프 밖으로 → 2 · F `rt_cd` 검사 제거 → 2 · G 토큰 분기 제거 → 3 · H 시세 재시도 0 → 6 · I 울타리 밖 호출 1줄 추가 → 울타리 개수 단언 1 실패. 9/9 탐지. 기준선(사본, 변이 없음) 32/32 통과.
- [17:16] 엣지·상한 프로브 (P5–P13, `probe-behavior.log`) — `rt_cd` 없음 + output: 신구 동일 성공 · `"0"` + output 없음: 신구 동일(no output) · 빈 본문: 신구 동일(HEAD 와 같은 JSON 오류) · 숫자 `9` 는 재시도하지 않고, 문자열 `"9"` 는 재시도해 복구(P8·P9) · `transientRetries` 99 → 호출 6회(상한 5 + 최초 1) · -3 → 1회 · 던진 예외 재시도는 해외에 유지(시험 통과). 호출 상한 최악 10회(국내·해외)는 코드 대조로만 확인했다. 레이트리밋 혼합 시나리오는 실측하지 않았다.
- [17:16] 로그 민감값 — 신규 `console.warn` 2종(`token rotated elsewhere`·`token expired, re-issuing`)에는 값이 없다. 신규 throw 는 `rt_cd`·`msg_cd`·`msg1`(120자 절단)만 싣는다. `usedAuth`·`fresh` 는 로그·예외 어디에도 없다. (`no output: ${JSON.stringify(data)}` 는 HEAD 에도 있던 기존 줄.) 이상 없음.
- [17:16] 커밋 훅 사전 점검 (커밋하지 않음) — `SAFETY_PATHS` 의 `^src/lib/exchanges/` 가 6파일 전부에 걸린다. `## Reviewer` 헤딩은 1개뿐(대소문자 무관). 마지막 판정 줄은 17:06 PASS 이고 scope 가 6파일과 정확히 일치해 조건은 충족한다. 다만 **결함 #1·#2 를 고치면 그 판정은 무효**다. 라운드 4b 의 1줄은 PASS 이후 추가됐으므로 변이 D 로 독립 확인했다.
- [17:16] `kis-http.ts` 변경은 주석 블록(`+ *` 줄)뿐이다(diff 확인).
- [17:16] 확인하지 못한 것 — ESLint: `.eslintrc*`·`eslint.config.*` 가 없어 lint 미실행(설정 부재). 장중 틱 시간 영향과 실제 KIS 응답 샘플 대조. 레이트리밋 혼합 상한 실측. 광역 실행의 skip 3 스위트 정체. EGW00121 의 운영 발생 빈도. 화면: UI 변경 0 이라 해당 없음. 커밋 훅 실제 실행(커밋하지 않았다).
- [17:16] 리스크 — Critical 0건. 실매매 안전장치(주문 한도·Kill Switch·DRY_RUN·심볼) 경로는 무변경. 결함 #1 은 정적 울타리 우회이고 런타임 가드가 막는다. 결함 #2 는 시세 실패가 늘어나는 방향(보수적)이다.
- [17:16] 1차 QA 판정(2회차로 대체됨): fail — 결함 #1(Medium)·#2(Medium), Critical 없음. developer 에게 반송하고, 수정 후 Reviewer 부터 전체 재순환한다. 결함 #3(Low)은 같은 수정 턴에 묶기를 권한다.
- [18:56] **2회차 범위·방법** — 저장소 실물(서버): `npm run typecheck` exit 0 · `npx jest src/lib/exchanges` 2회 모두 25스위트 643건 통과 · 광역(`exchanges safety app/api strategy signals`) 1회 183스위트 통과·3 skip, 5192건 통과·100 skip·실패 0(구현자 수치 5192 와 일치). 독립 프로브·변이는 사본 `~/.node-local/qa-t133-r2/repo`(src 복사 + node_modules 심볼릭)에서만 돌렸다. 저장소 6파일 md5 는 실행 전후 동일(kis-domestic 8a05b1fb…, kis-overseas 99ad8e64…, kis-http d8599a23…, 울타리 836b9509…, 실패 시험 db715ed2…, 복구 시험 a16ede55…). 사본 소스는 삭제했고 결과 JSON·로그는 `~/.node-local/qa-t133-r2/` 에 남겼다.
- [18:56] **재현 1 (독립 프로브, 1회차 프로브 미참조)** — `zz-r2-ticker-probe.test.ts` 32건 전부 통과. 실제 `kisFetch`·실제 어댑터를 쓰고 `global.fetch` 만 바꿨다.
- [18:56] **중복 주문 (최우선)** — `transientRetries` 호출 지점 5곳 전부 조회다: kis-domestic.ts:77(시세)·:282(잔고 `inquire-balance`), kis-overseas.ts:100(시세)·:464(예수금 `inquire-present-balance`)·:647(잔고 `inquire-balance`). 전부 `{ headers }` 만 넘겨 GET 기본값이다. 주문·취소(domestic createOrder/cancelOrder, overseas createOrder)에는 옵션이 없다. `git diff -U0` 의 hunk 는 두 getTicker 본문·주석과 domestic import 한 줄뿐이다. `kisFetch` 가드는 요청 전에 던진다 — POST·post·PUT·DELETE·PATCH·`'POST '` 6종 모두 송신 0회(A1).
- [18:56] **정적 울타리 `hitsIn` (kis-balances-business-failure.test.ts:132-157)** — 잡힘 14/14: 프로브 F01–F14(따옴표 키·계산 키·템플릿 키·대입문·요소 대입·getter·템플릿 치환·유니코드 이스케이프 식별자·문자열·`Reflect.set`·클래스 메서드·`as const`·`Object.assign`). F14 는 양성 대조다. 못 잡음 7건: B01 `['transient' + 'Retries']`·B02 `JSON.parse('{"transientRetries":2}')`·B03 템플릿 부분 문자열·B04 `.tsx`·B05 `.js`·B06 하위 디렉터리·B07 `kis-http.ts` 본문(파일 자체가 제외). 이 7건은 전부 `kisFetch` 가드가 막는다(A1–A3, 가드는 호출 위치와 무관). 울타리를 더 조이는 작업은 여기서 멈추고, JSON 문자열·`kis-http.ts` 제외 두 항목을 후속 후보 7 에 추가할 것을 권한다.
- [18:57] **변이 탐지 (사본, 1회씩 11종)** — 11/11 탐지: M1 국내 토큰 조건 EGW00123-only → 실패 2 · M2 토큰 분기를 모든 오류로 → 2 · M3 DB 재읽기 제거 → 3 · M4 헤더 재사용 → 5 · M5 같을 때만 조건 제거 → 3 · M6 게이트웨이 패턴에서 EGW00121 제거 → 5 · M7 국내 rt_cd 엄격 비교 → 2 · M8 `kisFetch` GET 가드 제거 → 8(A1 전부 실패) · M9 해외 던진 예외 재시도 제거 → 3 · M10 국내 예산 2→3 → 7 · M11 해외 일시 재시도 2→0 → 5.
- [18:57] **EGW00121 (#2 수정 검증)** — 국내 토큰 분기는 (a) `getKisToken()` 으로 DB 를 먼저 읽고(kis-domestic.ts:88, kis-auth.ts 캐시 없이 `system_config` 조회 — 코드 확인), (b) `Bearer ${fresh}` 가 이번 요청 Authorization 과 같을 때만 `invalidateKisToken()` 한다(:89–). 회전 시 재발급 0회·재읽기 토큰으로 성공(C1, 호출 2회). 게이트웨이 `isKisTokenError` 는 `TOKEN_ERROR_PATTERN` 과 같은 출처다(B1·B2 통과).
- [18:57] **getBalances·getUsdCash 를 안 바꾼 범위** — 타당하다. 그 경로(kis-domestic.ts:285·671, kis-overseas.ts:467·608·650·1022)는 "재발급 먼저" 모양(`attempt === 0 && body.includes('EGW00123')` → `invalidateKisToken()` 직행)이라, EGW00121 을 넣으면 재읽기 없이 멀쩡한 토큰을 지운다(M-2 경로). EGW00121 무처리는 **T-133 이 만든 회귀가 아니다**: `ad45efc`(T-132 배포본)과 HEAD 의 `TOKEN_ERROR_PATTERN` 에 이미 `EGW00121` 이 있고(`git show` 확인), T-132 이전 잔고에는 500 재시도 자체가 없었다(4ddf222^ 확인). 잔여 위험은 공유 DB 토큰 행이 회전 뒤에도 남아 있는 동안 잔고·예수금이 실패할 수 있다는 것이다. 국내 시세 토큰 분기가 같은 행을 재발급하므로 국내 틱이 돌면 복구된다 [추측 — 행 공유는 코드로 확인, 실제 틱 빈도와의 관계는 미확인]. 해외 전용 운영이면 해외 쪽에 토큰 분기가 없어 그대로 남는다(후속 1·8). 위험도 Low.
- [18:57] **숫자형 rt_cd (#3 수정 검증)** — 종전(HEAD)은 국내·해외 모두 `rt_cd` 를 보지 않았다(국내 `if (!o)`, 해외 `no output` 만 — `git show` 확인). 현재 실측(국내 기준, 해외는 9·빈 문자열만): `"0"`·`0`·`null`·키 없음 → 성공 1회 · `9`·`true` → 던짐 1회(따옴표가 없어 재시도 대상 아님) · `""`·`"9"` → 던짐 3회(문자열이라 재시도). reviewer 가 쓴 「숫자 9·true·빈 문자열은 계속 실패」는 부정확하다 — 종전에는 output 이 있으면 성공이었으므로 이 셋은 **신규 실패 전환**이다(fail-closed, 시세가 총액에서 빠지는 방향 — 보수적). KIS 가 숫자형 rt_cd 를 쓰는지는 미확인. 검사 위치: kis-domestic.ts:111, kis-overseas.ts:127.
- [18:58] **호출 상한** — 국내 최악 10회(토큰 재발급 1회 · kisFetch 5회 × 2), 해외 최악 10회(던진 예외 재시도 1회 · kisFetch 5회 × 2). 실측 일치(C5·D1). 장중 틱 시간 영향과 재시도 소진율은 가짜 fetch 로만 확인했고 실 KIS 응답으로는 미확인이다.
- [18:58] **로그 민감값** — 신규 `console.warn` 2종(`token rotated elsewhere`·`token expired, re-issuing`)에는 값이 없다. 신규 throw 는 `rt_cd`·`msg_cd`·`msg1`(120자 절단)만 싣는다. `usedAuth`·`fresh`·Authorization 은 로그·예외 어디에도 없다. 이상 없음.
- [18:58] **안전장치** — `git diff --stat -- src/lib/safety src/app/api/orders` 0줄.
- [18:58] **커밋 훅 사전 점검 (커밋하지 않음)** — `SAFETY_PATHS` 의 `^src/lib/exchanges/` 가 6파일 전부에 걸린다. `## Reviewer` 헤딩은 1개(112행). 마지막 판정 줄 19:10 PASS, scope 6파일 정확 일치. 판정은 현재 작업트리 md5 에 대한 것이고, QA 는 저장소 파일을 바꾸지 않았다. 주의: Mac 세션의 커밋은 훅이 돌지 않는다(CLAUDE.md) — 서버에서 커밋하고, 스테이징은 6파일만 한다(작업트리에 T-134·T-135·`.codex/`·`public/mockups` 등 다른 세션 변경이 있다).
- [18:58] **확인하지 못한 것 (NOT_VERIFIED)** — 장중 틱 시간 영향과 재시도 소진율(실 KIS 응답 아님) · 실제 KIS 게이트웨이 응답 샘플 대조 · DB 장애 중 `getKisToken` 동작(코드 읽기만) · 레이트리밋 혼합 상황 실측 · ESLint(설정 파일 없음, 미실행) · 커밋 훅 실제 실행(커밋하지 않음) · EGW00121 운영 발생 빈도 · cron-runner 시간 예산 영향 · 울타리의 `.tsx`·하위 디렉터리 스캔(실측으로 못 봄 = B04–B06 통과).
- [18:58] **관찰 — 결함 아님, 차단 사유 아님** — L1 [Low] 정적 울타리 잔여 구멍 B01–B07(위 `hitsIn` 항목) — 자금 노출 아님(가드가 막음). L2 [Low] 숫자형 `rt_cd` 9·true 의 신규 실패 전환·문자열 `"9"` 재시도(위 rt_cd 항목, kis-domestic.ts:111·kis-overseas.ts:127). I1 [Info] DB 읽기 실패 시 `getKisToken` 이 재발급으로 떨어져 '같을 때만' 조건을 건너뛴다(kis-auth.ts:58 catch → `issueAndStore`) — 루프 상단 `kisHeaders` 가 같은 호출을 먼저 하므로 새 위험 클래스는 아니다(코드 읽기, 미실측). I2 [Info] `kis-ledger-query.ts:143` `TOKEN_EXPIRED_RE`(EGW00123 전용)는 세 번째 토큰 패턴 사본이다 — 이번 diff 밖. I3 [Info] 해외 getTicker 는 토큰 분기가 없다(후속 1, 종전과 같음).
- [19:00] **판단 (Leader 요청에 대한 답)** — 동의한다. 정적 울타리가 뚫려도 `kisFetch` 가드가 요청 전에 던지므로 주문 중복·자금 경로 노출은 아니다(A1–A3, M8 이 가드 제거를 잡는다). 조건은 둘이다: 가드 시험(A1 · `kis-http.test.ts` 308–322행)을 유지할 것, 울타리 추가 작업은 멈출 것.
- [19:00] **배포 후 확인 (사용자 보고용, 미확인 항목)** — (a) 장중 첫 틱 뒤 `[kis-http] 일시 실패 재시도 소진` 과 `일시 실패 재시도 성공` 로그 비율. T-132 직후 17건 중 소진 4건과 같은 시간대로 비교(`pm2 logs stockinvest --lines 2000 | grep 'kis-http'`). (b) `[kis-domestic getTicker] token` 로그: `token rotated elsewhere` 는 다른 프로세스가 회전시킨 것이고, `token expired, re-issuing` 이 **분 단위로 반복**되면 EGW00133 60초 대기 위험이므로 즉시 확인한다. (c) 신규 메시지 `KIS getTicker … 200 업무실패 rt_cd=…` 가 종전 `no output: {…}` 를 대체했는지. (d) `[portfolio-total] … 시세 조회 실패` 건수가 T-132 이후 하루 11건 수준에서 줄었는지.
- [19:00] **QA 판정: PASS** — 결함 0건(Critical·High·Medium 0). Low 2건과 Info 3건은 관찰로 기록했고 차단 사유가 아니다. 저장소 파일은 수정하지 않았고 커밋하지 않았다. 사본 소스는 삭제했고, 결과·로그는 `~/.node-local/qa-t133-r2/`(서버)에 남겼다.

## 구현 라운드 5 — QA FAIL 반영 (메인 세션)

QA 판정은 **FAIL**(Medium 2 · Low 1). 셋 다 고쳤다. 워크스페이스 규약대로 **수정 후 감사부터 전체 재순환**한다.

- [18:10] **QA #1 (Medium) — 울타리를 줄 문자열 판정에서 TypeScript 파서로 바꿨다.** QA 가 첫 글자가 `*` 인 **코드** 줄(예: 여러 줄 제너레이터 메서드)로 정적 울타리를 통과시켰다. 이 집계는 이 task 에서만 두 번 뚫렸다(라운드 2 블록 닫고 코드 → 라운드 3 수정, 라운드 5 별표 줄). **규칙을 세 번째로 손보는 대신 층을 바꿨다** — `ts.createSourceFile` 로 파싱해 `transientRetries` 속성 노드를 센다. 파서는 주석을 trivia 로 버리므로 주석 위장이 **구조적으로 불가능**하고, 문자열 리터럴 속 언급도 세지 않으며, 옵션 객체가 여러 줄이어도 라벨을 찾는다(라벨 대조를 줄 텍스트 → 옵션 객체 텍스트로 바꿨다).
  - 자기 회귀 시험을 합성 소스 8건으로 교체(JSDoc·한 줄 주석·문자열 속 언급 = 0건 / 블록 닫고 코드·별표 줄 2종·줄 끝 주석·변수 분리·여러 줄 객체 = 1건).
  - **변이 검증에서 내 시험이 먼저 틀렸다.** 「별표로 시작」 사례를 한 줄로 적어 두어, 줄 기반 제외를 되살리는 변이가 **8건 전부 통과로 살아남았다**. 속성이 놓인 **줄의 첫 글자가** `*` 여야 재현된다는 것을 놓친 것이다. 여러 줄 모양 2개로 고치니 그 변이가 잡힌다(1 failed / 7 passed). 이 과정을 남기는 이유: 울타리 시험은 "통과" 가 아니라 **"변이를 잡는가"** 로만 믿을 수 있다.
- [18:14] **QA #2 (Medium) — 토큰 판정을 게이트웨이와 단일 출처로 묶었다.** 어댑터가 손으로 `EGW00123` 만 보고 있어서, 게이트웨이는 `EGW00121` 도 토큰 오류로 보고 재시도를 건너뛰는데(`TOKEN_ERROR_PATTERN`) 어댑터는 재발급도 하지 않는 **사각지대**가 됐다. 종전 코드는 500 이면 무조건 재시도해 그 경우를 우연히 덮고 있었으므로 **기능 후퇴**였다(QA 가 P1 으로 실증: HEAD 2회 호출 성공 / 신규 1회 뒤 500).
  - `kis-http.ts` 에 `isKisTokenError(body)` 를 공개하고(같은 `TOKEN_ERROR_PATTERN` 사용) 국내 `getTicker` 가 그것을 쓴다. 시험 1건 추가. 변이(다시 `EGW00123` 만 보기)로 확인했다.
  - **`getBalances`·`getUsdCash` 는 바꾸지 않았다.** 같은 `EGW00123`-only 조건이지만 그쪽은 **재발급 먼저** 모양이라, `EGW00121` 을 넣으면 M-2(멀쩡한 토큰 삭제 → `EGW00133` 60초 정지 → `createOrder` 까지 막힘)를 그 경로에 새로 만든다. 재읽기 우선으로 같이 바꿔야 하는 별도 작업이다 → **후속 후보 8**.
- [18:16] **QA #3 (Low) — 숫자형 `rt_cd` 정규화.** `String(data.rt_cd) !== '0'` 로 바꿔, 숫자 `0` 을 업무실패로 오판하지 않는다(종전 코드는 `rt_cd` 를 아예 보지 않아 통과시켰으므로 엄격 비교는 그 자리에서 회귀였다). 숫자 `9` 는 그대로 실패. 국내·해외 시험 2건 추가, 변이로 확인.
  - 잔고·예수금(T-132) 의 같은 지점은 **범위 밖**으로 둔다 — 이미 운영에 있고, 바꾸면 그 경로 재감사가 필요하다 → 후속 후보 4 에 병합.
- [18:18] 재검증 — 서버 `npm run typecheck` **exit 0** · `npx jest src/lib/exchanges` **25스위트 642건 통과**. 변이 사본은 전부 삭제했다.

### 라운드 5 재확인 요청 범위

울타리 파서 전환(+자기 시험 8건) · `kis-http.ts` `isKisTokenError` 공개 · 국내 토큰 조건 교체(+시험 1건) · `String(rt_cd)` 정규화 2곳(+시험 2건).

## 구현 라운드 6 — 5차 감사 FAIL 반영 (메인 세션)

5차 감사 판정은 **FAIL**(M-3 Medium 1 · Low 2). QA #2·#3 수정은 통과했고, **내가 라운드 5 에서 울타리를 파서로 옮기며 커버리지를 잃은 것**이 결함이다.

- [18:45] **M-3 (Medium) — 파서 울타리가 줄 기반 판보다 후퇴했다.** 속성 **대입 노드**(`PropertyAssignment`·shorthand)만 세는 바람에, 같은 옵션을 다른 문법으로 쓰면 못 봤다 — 감사자가 7가지로 실증했다: 작은따옴표 키·큰따옴표 키·계산 키·`o.transientRetries = 2`·`o['transientRetries'] = 2`·getter·템플릿 계산 키. **줄 기반 판(라운드 3)은 `transientRetries` 가 든 줄을 다 세서 이 7가지를 우연히 잡고 있었다.** 층을 바꾸면서 그 커버리지를 잃은 것이다.
  - 감사자가 준 수정안을 그대로 적용했다 — 조건을 `(ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && node.text === 'transientRetries'` 로 바꿔 **`transientRetries` 라는 식별자·문자열 토큰 전부**를 세고, 라벨 대조 범위 `obj` 는 **가장 가까운 객체 리터럴 조상**(없으면 감싸는 문장)의 텍스트로 한다.
  - 자기 시험에 감사자가 준 사례 8개를 더해 **17건**이 됐다(따옴표 키·계산 키 2종·대입문·요소 대입·getter·shorthand·화살표 콜백 안).
  - 변이 검증: 문자열 토큰 제외 → 1건 실패 · 식별자 토큰 제외 → 3건 실패.
  - **교훈을 남긴다**: 울타리를 "더 올바른 층" 으로 옮길 때, 옛 판이 **우연히** 갖고 있던 커버리지를 목록으로 적고 하나씩 대조해야 한다. 나는 "파서는 구조적으로 안전하다" 는 일반론으로 그 단계를 건너뛰었고, 그래서 라운드 3·4 를 통과한 울타리가 라운드 5 에서 더 약해졌다.
- [18:50] **L-9 (Low) — 토큰 분기가 토큰 오류일 때만 도는지 고정했다.** 조건을 모든 오류로 넓히는 변이가 642건 전부 통과로 살아남았다(= M-2 로 되돌아가는 변이를 아무도 못 잡는다). 감사자 문구대로 「토큰 오류가 아닌 지속 500 은 재발급 없이 소진 후 던진다(fetch 3회·`invalidateKisToken` 0회)」 시험 1건을 넣었다. 변이로 확인했다.
- [18:52] **L-8 (Low)** — 감사자가 지적한 생존 변이 2종(shorthand 제외·화살표 함수 건너뜀)은 위 사례 8개에 그 모양이 들어 있어 함께 닫혔다.
- [18:53] **Info 2건 반영** — ① 시험 2파일의 `jest.mock('../kis-http')` 공장에 `isKisTokenError` 를 넣었다(어댑터가 모듈 수준에서 import 하므로, 빠뜨리면 토큰 분기에 닿는 순간 "not a function" 으로 깨진다). ② `kis-http.ts` 의 `TOKEN_ERROR_PATTERN` 설명이 아직 `body.includes('EGW00123')` 를 가리키고 있던 것을 고치고, `EGW00121` 사각지대가 왜 생겼는지를 적었다.
- [18:54] 재검증 — 서버 `npm run typecheck` **exit 0** · `npx jest src/lib/exchanges` **25스위트 643건 통과**. 변이 사본 삭제.

### 라운드 6 재확인 요청 범위

`hitsIn` 조건·`obj` 산출 · 자기 시험 17건 · L-9 시험 1건 · 모의 공장 2곳 · `kis-http.ts` 주석.

## 정정·마무리 (메인 세션)

- [19:05] **2차 QA 가 1차 감사의 문구 하나를 정정했다 — 받아들인다.** 1차 감사는 숫자형 `rt_cd` 수정을 두고 「숫자 9·`true`·빈 문자열은 **계속** 실패」라고 적었는데, HEAD 는 국내·해외 모두 `rt_cd` 를 **보지 않았고** `output` 이 있으면 성공이었다. 따라서 그 셋은 "계속" 이 아니라 **신규 실패 전환**이다(방향은 fail-closed·보수적). 숫자형 `rt_cd` 가 실제로 오는지는 **미확인**이다 — 후속 후보 4 에 묶여 있다. 이 정정을 사용자 보고에도 싣는다.
- [19:06] **2차 QA 가 내 범위 판단 하나도 정정했다** — 잔고 쪽 `EGW00121` 무처리를 내가 "사각지대" 로만 적었는데, 게이트웨이의 `TOKEN_ERROR_PATTERN` 에는 T-132 배포본(`ad45efc`)부터 이미 `EGW00121` 이 있었다. 즉 **회귀가 아니라 기존 공백**이고 위험도는 Low 다. 후속 후보 8 에 그렇게 적었다.
- [19:07] 2차 QA 의 조건부 동의를 기록한다 — 「정적 울타리를 여기서 멈추는 데 동의하되 **두 조건**: ① 런타임 가드 시험(`kis-http.test.ts:308-322`)을 유지한다 ② 울타리 추가 작업을 멈춘다」. 앞으로 울타리 관련 지적은 Low 로만 기록하고 차단 사유로 쓰지 않는다(1차 감사도 같은 선언을 했다).

## 배포 기록

- [2026-10-31 19:01] **배포 완료.** 사용자 지시 「지금 배포」(감사 6라운드 PASS · QA 2회차 PASS 뒤). 서버 체크아웃에서 `git push origin main`(`ad45efc..90f858f`, 커밋 **4개**). 코드가 든 커밋은 **T-133 `90f858f` 하나**(7파일 +1024/−78)이고 나머지 3개는 문서다 — 내 T-132 배포 기록 `c593300`, 다른 세션의 `84f8d7c`(T-126 DDL 적용 기록)·`6c8f88c`(ISS-0002 역할 파일). 다른 세션의 T-134·T-135 **코드는 미커밋**이라 이번 push 에 들어가지 않았다. webhook blue/green 18:59:43 시작 → 19:01:34 완료(`exit=0`).
- 결과: `RELEASE_RESULT {"status":"ok","release":"20261031-185943-90f858f5","sha":"90f858f52e0fed4d4a520e50ae92544082a99cb2","previous":"…/releases/20261031-135945-ad45efc2","migrated":false}`. 마이그레이션·DDL·스위치 변경 없음. 롤백 필요 없음(필요하면 이전 릴리스 `20261031-135945-ad45efc2`).
- 배포 전 확인(18:59): `current` → `20261031-135945-ad45efc2` · pm2 두 앱 online·restarts 0 · push 는 fast-forward.
- 배포 후 확인(19:01~19:02, 읽기 전용): ① `current` → `20261031-185943-90f858f5` ② pm2 `stockinvest`·`stockinvest-cron` 둘 다 online · restarts 0 · `pm_cwd` 새 릴리스 ③ `cron-runner.sh` 프로세스 **1개** · 19:02:18 까지 매분 OK ④ `/api/health` HTTP 200 · `ok:true` · `db:true` · `schemaFatal:false` · `safetyStatus:"green"` · `dryRun:true` · `killSwitch:false` ⑤ `system_config` 안전 키 6개 값·`updated_at` 전부 배포 전 그대로(`exit_judgment_record_enabled=true` 는 다른 세션이 15:41 에 켠 것 — 이 배포가 건드리지 않았다) ⑥ 새 릴리스 소스에 `transientRetries`(국내 4·해외 5)·`isKisTokenError`(게이트웨이 2·국내 2) 존재, `.next/server/chunks` 3개에 새 메시지 `200 업무실패` 컴파일됨.
- 배포 후 시세·토큰 로그는 **0건**이다(19:00~19:02). KIS 실패율이 최근 1시간 **1.8%** 로 가라앉았고 토요일 휴장이라 시세 호출이 적다 — **"정상" 의 증거가 아니라 "표본이 없다"** 는 뜻이다. T-132 때처럼 배포 직후 복구 사례를 본 것이 아니므로, 실효 확인은 **11-03(월) 개장 첫 틱 이후**다.
- 관찰(이상 아님, 기록용): 컷오버 순간(19:00:12) `news-peek-overseas-19` 가 `HTTP=000` 으로 `failed` 1행 — 웹 앱이 포트를 열기 전이라 나는 일회성이고, 오늘 05:21·14:00 배포에도 같은 패턴이 있었다. 집계 해석에서 제외한다.
- **T-132 의 운영 실적(배포 후 ~5시간, 14:00~19:00)**: `재시도 성공` **21건** · `재시도 소진` **6건**(복구율 78%) · `[portfolio-total] 잔고 조회 실패 → 직전값/unknown` **0건**(배포 전 시간당 24~56건·하루 188건) · `총액에서 제외` 2건(T-133 이 고친 경로 — 이제 재시도가 붙는다).
- **확인하지 못한 것(NOT_VERIFIED)**: 장중 실동작 전부 — 시세 재시도 소진율·틱 시간 영향·토큰 분기 실제 발화 · 숫자형 `rt_cd` 가 실제로 오는지 · `EGW00121` 운영 발생 빈도 · 레이트리밋 혼합 상한 실측 · lint(설정 없음) · Codex 검토(비가용).

## 최종 요약

### [T-133] 시세 조회가 KIS 의 HTTP 200 업무실패를 재시도 없이 버리던 문제

- **상태**: **운영 반영 완료** — 릴리스 `20261031-185943-90f858f5`(2026-10-31 19:01 KST, `RELEASE_RESULT ok`). 감사 **PASS**(6라운드: CONDITIONAL_PASS → FAIL → PASS → PASS → FAIL → PASS) · QA **PASS**(2회차, Critical·High·Medium 0). 배포 직후 시세·토큰 로그 0건 — 휴장·KIS 회복(1.8%)으로 **표본이 없다**는 뜻이고 실효 확인은 11-03(월) 개장 후다.
- **무엇이 바뀌었나**
  - 국내·해외 `getTicker` 가 KIS 의 **HTTP 200 + `rt_cd≠'0'`**(`OPSQ1002 SESSION FULL`)을 재시도 없이 1회 실패로 끝냈다. 손으로 만든 재시도 루프가 `res.status` 만 봤기 때문이다. 그 루프를 걷어내고 T-132 게이트웨이의 `transientRetries: 2` 로 넘겼다 — 루프를 남긴 채 옵션만 켜면 바깥 × 안쪽으로 호출이 곱해져 T-017 이 막으려던 증폭이 부활한다.
  - 실패 메시지를 본문 JSON 덩어리에서 `rt_cd`·`msg_cd`·`msg1` 로 바꿨다.
  - 국내에 **토큰 만료 분기**를 넣었다 — 응답 루프를 걷어내면서 종전이 갖고 있던 "회전된 토큰 주워 오기" 복구가 사라졌기 때문이다. 재발급을 먼저 하지 않고 **DB 를 다시 읽어 헤더에 실린 토큰과 같을 때만** 재발급한다(감사자가 M-2 로 실증: 먼저 재발급하면 멀쩡한 토큰을 지우고 `EGW00133` 60초 대기에 걸려 같은 프로세스의 `createOrder` 까지 막힌다). 토큰 판정은 게이트웨이와 **단일 출처**(`isKisTokenError`)로 묶었다.
  - 숫자형 `rt_cd` 를 `String()` 으로 정규화했다(숫자 0 을 업무실패로 오판하지 않게).
  - 중복 주문 울타리를 **TypeScript 파서 기반**으로 바꿨다 — 줄 문자열 판정은 이 task 에서만 세 번 뚫렸다.
- **배포**: 커밋 `90f858f`(7파일 +1024/−78, 서버 셸 — Mac 은 `commit-msg` 훅이 무음으로 빠진다). 18:59:24 `git push origin main`(`ad45efc..90f858f`, 커밋 4개) → webhook blue/green 18:59:43~19:01:34 `exit=0`, `migrated:false`. **같은 배포에 실린 다른 작업**: 문서 커밋 3개(내 T-132 배포 기록 `c593300` · 다른 세션 `84f8d7c`·`6c8f88c`). 다른 세션의 T-134·T-135 코드는 미커밋이라 들어가지 않았다. 상세·배포 후 확인은 위 「배포 기록」.
- **AI 가 검증한 것**: `npm run typecheck` **exit 0** · `npx jest src/lib/exchanges` **25스위트 643건**(QA 가 2회 실행, 결과 동일) · 광역 `exchanges·safety·app/api·strategy·signals` **183스위트 5192건 통과·실패 0** · `src/lib/safety/`·`src/app/api/orders/` diff **0줄** · `transientRetries` 켜진 곳 5곳 전부 GET, 주문·취소 경로 0건 · 런타임 GET 가드가 POST·post·PUT·DELETE·PATCH·`'POST '` 6종을 **송신 0회**로 차단 · 울타리 우회 모양 **14종 전부 탐지** · 변이 **11종 전부 탐지** · 토큰 회전 시 재발급 0회로 복구(가짜 KIS 하네스, HEAD 306ms → 101ms) · 호출 상한 국내·해외 각 10회 실측 일치 · 신규 로그·예외에 토큰 값·계좌·금액 없음 · 커밋 훅 사전 점검 통과(`scope` 가 6파일과 정확히 일치).
- **AI 가 못 한 것**: **장중 실동작 전부** — 틱 시간 영향·재시도 소진율은 가짜 fetch 로만 봤다 · 실제 KIS 응답 샘플 대조 · DB 장애 중 `getKisToken` 동작 · 레이트리밋 혼합 상황 실측 · `EGW00121` 운영 발생 빈도 · 숫자형 `rt_cd` 가 실제로 오는지 · lint(이 저장소에 ESLint 설정 없음) · 커밋 훅 **실제** 실행(사전 점검만) · Codex 외부 검토(사용자 전역 설정 모델 미지원).
- **👉 사용자가 확인할 것** (다음 개장 **2026-11-03(월)** 장중, 첫 틱 뒤):
  1. `pm2 logs stockinvest --lines 2000 | grep kis-http` — `일시 실패 재시도 성공` 대 `소진` 비율. 기준: T-132 직후 17건 중 소진 4건. 소진이 더 많으면 KIS 쪽이 더 나빠진 것이다.
  2. `grep "\[kis-domestic getTicker\] token"` — `token expired, re-issuing` 이 **분 단위로 반복되면 즉시 알려 달라**(`EGW00133` 60초 대기 위험).
  3. 새 메시지 `KIS getTicker … 200 업무실패 rt_cd=…` 가 종전 `no output: {…}` 를 대체했는지.
  4. `[portfolio-total] … 시세 조회 실패` 건수가 10-31 의 하루 11건 수준에서 줄었는지.
- **👉 사용자가 결정할 것**: 없음(배포 완료). 다음 결정은 11-03(월) 관측 결과에 따라 — 후속 후보 ⑧(토큰 판정 사본 3곳 정리)·⑦(울타리 재귀 스캔)·①(해외 시세 토큰 분기) 중 무엇부터 할지.
- **남은 일**: 후속 후보 9건(위 절). 우선순위 높은 것 — ⑧ 토큰 판정 사본 3곳 정리(재읽기 우선 모양으로 함께) · ⑦ 울타리 재귀 스캔 · ① 해외 시세 토큰 분기.
- **이슈·위험**: KIS 장애는 우리가 못 고친다 — 재시도는 **깜박임**만 흡수하고, 장애가 길어지면 소진 후 여전히 실패한다. 시세는 틱당 N건 fan-out 이라 지속 장애에서 영향 종목마다 호출이 3배가 되고, 비용은 호출 수보다 **순차 호출부의 지연**(소진 1건당 +1.3~1.8초)으로 나타난다. 정적 울타리에는 잔여 구멍 7종이 있고(전부 런타임 가드가 막는다) 추가 보강은 하지 않기로 감사자·QA 와 합의했다.
