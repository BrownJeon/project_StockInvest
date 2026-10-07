---
task_id: T-027
title: 비-number quantity 가 주문 가드를 통과해 라이브 KIS 주문 호출까지 도달하는 문제
status: done
roles_involved: [leader, developer, reviewer, qa]
related_tasks: [T-024-manual-order-quantity-guard, T-020-fractional-order-quantity-sizing]
tags:
  - type/task
  - domain/safety
  - domain/orders
aliases:
  - 비숫자 수량 가드
  - nonnumber-quantity-guard
created: 2026-08-17
updated: 2026-08-17
---

## 목표 (Leader 작성)

[[T-024-manual-order-quantity-guard]] Reviewer 감사가 남긴 MEDIUM 2건을 해소한다.

**결함**: `quantity` 가 문자열 등 **비-number 런타임 값**이면 `sizeOrderQuantity` 가 값을 산출하지
못해(`undefined`) 원본이 그대로 `orderReq.quantity` 에 남고, 어댑터의 `quantity <= 0` 가드가
JS 의 느슨한 숫자변환(`"3.7" <= 0` → false) 때문에 걸러내지 못해 **실제 KIS 라이브 주문 API
호출까지 나간다**(시장가/가격 없는 지정가 한정).

**자금손실 경로는 아니다** — 최종 `ORD_QTY` 는 `submittedQuantity` 의 엄격한 `Number.isFinite`
덕에 `"0"` 이 되어 브로커가 거절할 것으로 합리적으로 기대된다. 최악이 무의미한 라이브 API 호출
1건 + 거절 로그다. 실노출도 사실상 0(`middleware.ts` 인증 필수 + 이 리포지토리에
`POST /api/orders` 를 호출하는 프론트엔드 코드가 없음 — 계정 소유자의 직접 curl 로만 도달).

그래도 **주문 송신 경로에 "가드가 있는데 안 걸리는" 상태를 남겨두지 않는다**는 것이 이 task 의
취지다.

## 사전 조사 결과 (Leader, 2026-08-17 코드 실측)

백로그 설명을 그대로 믿지 않고 현재 코드를 직접 확인했다 — **결함은 아직 살아 있다**:

| 위치 | 현재 코드 | 문제 |
|---|---|---|
| `src/lib/exchanges/kis-domestic.ts:270` | `if (quantity <= 0) return { ok:false, ... }` | `"3.7" <= 0` → false 로 통과 |
| `src/lib/exchanges/kis-overseas.ts:321` | `if (quantity <= 0) return { ok:false, ... }` | 동일. 단 해외는 가격 없으면 `adjPrice<=0` 가드가 **먼저** 걸려 실도달은 어려움 |
| `src/app/api/orders/route.ts:49` | `quantity: sized.quantity ?? body.quantity` | 비-number 면 원본이 그대로 남음 |
| `src/app/api/orders/route.ts:16` | `quantity?: number` | **타입 선언일 뿐 런타임 가드가 아니다** |

## Leader 지시사항 (역할별)

### Developer

**근본 수정을 우선한다** — 두 어댑터의 가드를 강화하는 쪽이 수동 주문 경로 외 **다른 진입점에도
방어가 걸리므로** 더 낫다(T-024 Reviewer 권고와 동일):

1. `kis-domestic.ts` · `kis-overseas.ts` 의 `quantity <= 0` 가드를
   `!Number.isFinite(quantity) || quantity <= 0` 로 강화. 에러 메시지도 원인을 구분할 수 있게.
2. 추가로 `POST /api/orders` `route.ts` 에 **런타임 타입 가드**를 넣어 비-number `quantity` 는
   400 으로 조기 거절(방어 이중화 — API 경계에서 막는 것이 진단에 유리).
3. **같은 클래스의 다른 구멍을 직접 조사하라**: `price`·`amount_krw` 등 다른 수치 필드도 같은
   느슨한 비교로 방어되고 있지 않은지, 다른 주문 진입점(`submitOrder` 경유 경로 전부)에 같은
   패턴이 없는지 확인하고 결과를 기록하라. 발견 시 이번에 함께 고칠지 판단하고 근거를 남겨라.

**금지**: 안전장치를 우회하거나 완화하는 방향의 변경. `submitOrder()` 경유 원칙 훼손.

### Reviewer

- 강화된 가드가 **정상 주문을 잘못 막지 않는지**(정수·소수 정상값, 문자열이지만 유효한 숫자를
  기존에 허용하던 경로가 있었는지) — 과도차단이 실매매를 막으면 그것도 사고다
- `Number.isFinite` 도입이 `NaN`·`Infinity`·`null`·`undefined` 각각에서 의도대로 동작하는지
- Developer 가 조사한 "같은 클래스의 다른 구멍"이 실제로 전수인지

### QA

- 비-number `quantity`(`'3.7'`, `''`, `null`, `NaN`, `Infinity`, 객체) × 시장가/지정가 조합이
  **어댑터에 도달하기 전에** 막히는지
- 정상 주문(정수/소수 number)이 **여전히 통과**하는지 — 회귀가 이 task 의 최대 위험이다
- 기존 전체 스위트 회귀 0건

## Developer 기록

- [08:11] **설계 판단 ① — quantity 는 엄격(`typeof === 'number'`), price 는 느슨(`Number.isFinite(Number(x))`).**
  같은 결함에 다른 강도를 쓴 이유는 **앞단에 정규화 파이프라인이 있느냐**다.
  `quantity` 는 모든 진입점이 `sizeOrderQuantity`(또는 `Number()`)를 통과해 `number | undefined`
  로 정규화된다 — 4개 진입점을 전수 확인했다(아래 조사 결과). 그래서 엄격하게 막아도 정상
  주문을 잘못 막을 수 없다. 반면 `price` 는 **가공 없이 어댑터까지 통과**하고, `POST /api/signals`
  는 본문 price 를 그대로 흘리며, mysql2 는 DECIMAL 을 **문자열로** 돌려준다(2026-08-16 에 같은
  원인의 표시 결함을 고쳤다). 즉 `'70000'` 은 **오늘 정상 송신되는 값**이라, 여기에 같은 엄격도를
  적용하면 실매매를 끊는 사고가 된다.
  → 구현 중 실제로 이 함정을 밟았다. 처음에 price 도 `Number.isFinite(price)` 로 짰다가
  `'70000'` 회귀 테스트가 **실패**해서 발견했다. 막아야 할 것은 딱 하나 — `ORD_UNPR: "NaN"` 을
  만드는 값이다. 회귀 테스트를 먼저 쓰지 않았으면 그대로 나갈 뻔했다.

- [08:11] **설계 판단 ② — 어댑터 에러 문구는 기존 것을 글자 그대로 보존했다.**
  `quantity 계산 실패` / `quantity 계산 실패 (해외는 USD 가격·수량 필수)` 두 문자열에는 이미
  `categorizeRejectReason` 정규식과 운영 로그가 걸려 있다. 새 사유는 `quantity 타입 오류: …`
  라는 **별개 문구**로 추가하고, 분류에 `bad_number_field` 카테고리를 신설해 `orders.blocked_by`
  에서 "사이징이 0을 만든 것"과 "호출부가 숫자가 아닌 값을 넘긴 것"을 구분해 조회할 수 있게 했다
  (Leader 지시: "사후 진단에 필요하다").

- [08:11] **변경 파일 (구현 6 · 테스트 3)**
  - `src/lib/exchanges/order-quantity.ts` — `unusableQuantityReason(quantity, context?)` 신설.
    두 어댑터가 같은 규칙을 쓰게 하는 단일 지점(한쪽만 고친 상태가 다시 결함의 구조가 되는 것을
    막는다 — 이 모듈의 원래 취지 그대로). 진단 문자열 생성은 심볼·BigInt·순환참조에도 던지지 않는다.
  - `src/lib/exchanges/kis-domestic.ts` — `quantity` 가드 강화 + **지정가 `price` 비-number 가드 신설**.
  - `src/lib/exchanges/kis-overseas.ts` — `quantity` 가드 강화(문구 보존).
  - `src/app/api/orders/route.ts` — `price`/`quantity`/`amountKRW` 런타임 타입 가드 → 400 조기 거절.
    `null`·`undefined` 는 "미지정"이므로 통과시킨다(하위 로직이 금액에서 파생). 400 은 `orders` 행이
    생기기 전이라 감사 로그에 안 남으므로 `console.warn` 한 줄을 남겼다 — 흔적 없는 거절을 만들지 않는다.
  - `src/lib/safety/order-limits.ts` — 아래 조사 결과의 fail-open 수정.
  - `src/lib/safety/dry-run.ts` — `categorizeRejectReason` 에 `bad_number_field` 분류 추가(순수 함수, 가산적).
  - 신규 `src/lib/exchanges/__tests__/nonnumber-order-fields.test.ts` (75개)
  - 신규 `src/lib/safety/__tests__/order-limits-nan-failopen.test.ts` (14개)
  - `src/app/api/orders/__tests__/route.test.ts` (+37개)

- [08:11] 🔴 **조사 결과 (지시 3번) — 같은 클래스의 다른 구멍을 하나 찾았고, 그게 원래 결함보다 무겁다.**
  **`price` 에 비-number 가 섞이면 `price * quantity` 가 NaN 이 되고, NaN 은 1회·일일 주문 한도를
  통째로 통과한다.** NaN 은 모든 관계연산에서 false 라 `checkOrderMax` 의 `amount <= 0`(→false)도
  `amount > effectiveMax`(→false)도 걸리지 않는다. 즉 **한도 검사를 통과한 것처럼 보이는 무제한
  금액**이 성립했다. 원래 T-027 결함은 "무의미한 라이브 호출 1건"이 최악이었지만, 이쪽은 자금
  한도 자체를 우회하므로 성격이 더 무겁다고 판단해 **이번에 함께 고쳤다**:
  ① `resolveOrderAmountKRW` / `…Async` 가 NaN 대신 0 을 반환
  ② `checkOrderMax` / `checkDailyMax` 가 `amount <= 0` 대신 **`!(amount > 0)`** 로 판정
  유한한 양수에 대해 두 식은 완전히 동치라 회귀가 없고(경계값 테스트로 고정), 이 `!(x > 0)`
  부정형은 이미 `volatility-guard.ts:338,396,641` · `order-sync.ts:714,805` · `snapshot-cleanup.ts:119`
  가 쓰는 **이 저장소의 기존 관용구**다 — 새 규칙을 도입한 게 아니라 빠진 곳을 맞춘 것이다.

- [08:11] **조사 결과 — `submitOrder()` 경유 진입점 4곳 전수 확인.**
  | 진입점 | quantity | price | amountKRW | 판정 |
  |---|---|---|---|---|
  | `api/orders/route.ts:54` | 원본 잔존 가능 → **수정함** | 원본 잔존 → **수정함** | 원본 잔존 → **수정함** | 유일한 raw JSON 경계였다 |
  | `api/cron/entry-watcher/route.ts:279` | `sizeOrderQuantity` | `Number(row.price)` | `Number(row.amount_krw)` | 정규화됨 |
  | `signals/service.ts:468` (createSignal) | `sizeOrderQuantity` | **`input.price` 원본** | `input.amountKRW` 원본 | 아래 잔여 항목 |
  | `signals/service.ts:550` (approveSignal) | `Number(row.quantity)` | `Number(row.price)` | `Number(row.amount_krw)` | 정규화됨 |
  `sizeOrderQuantity` 는 비-number `requestedQuantity` 를 `Number.isFinite` 로 걸러 금액/가격
  경로로 넘기므로, **quantity 는 4곳 모두 `number | undefined` 로 정규화된다**(그래서 엄격 가드가
  안전하다). 반면 `price` 는 createSignal 경로에서 원본이 그대로 남는다.

- [08:11] ⚠️ **범위 밖으로 남긴 것 (숨기지 않고 보고) — `POST /api/signals` 도 같은 패턴이다.**
  `src/app/api/signals/route.ts:48` 이 `body.price`·`body.quantity`·`body.amountKRW` 를 검증 없이
  `createSignal` 로 넘긴다("타입 선언일 뿐 런타임 가드가 아니다"가 그대로 재현). **이번에 고치지
  않은 이유**: (a) Leader 가 API 경계 가드를 `POST /api/orders` 로 명시 스코프했고, (b) 결과가
  이제 봉쇄돼 있다 — quantity 는 `sizeOrderQuantity` 가 정규화하고, price 는 이번에 신설한 국내
  어댑터 가드 + 한도 fail-closed 가 잡는다, (c) 시그널은 **주문 이전에 DB 행이 생기므로** 400 을
  넣으면 시그널 생성 semantics 가 바뀐다 — Developer 가 단독 판단할 사안이 아니다.
  → 후속 백로그 후보로 Leader 판단을 요청한다.

- [08:11] **조사 결과 — fail-open 이 아니라고 판정해 손대지 않은 곳.**
  `portfolio-total.ts:56` (`qty <= 0`), `kis-domestic.ts:232` · `kis-overseas.ts:282` (잔고 파싱),
  `dry-run.ts:166` (`req.amountKRW <= 0`) 도 느슨한 비교지만, NaN 이 흘러도 최종 소비자가
  `!(total > 0)` → 한도 0 → **신규 매수 전면 차단**으로 수렴한다(fail-closed). 안전 방향이라
  이번 범위에서 제외했다. 주문 송신 경로도 아니다.

- [08:11] **테스트 결과 (있는 그대로).**
  - `npx jest` — **102 suites / 1643 tests 전부 통과**. 기준선 100/1517 → 신규 파일 2개(+2 suites),
    신규 케이스 126개(75+14+37). **기존 1517개 중 실패·수정 0건.**
  - `npx tsc --noEmit` — **exit 0** (처음엔 `TS7053` 1건이 났다. `invalidNumericField` 반환 타입이
    `string` 이라 `body[badField]` 인덱싱이 막힌 것 → 반환 타입을 `NUMERIC_FIELDS` 리터럴 유니온으로
    좁혀 해결).
  - `npm run build` — **성공** (`✓ Compiled successfully`).
  - `npm run lint` — **이 저장소에 ESLint 설정이 없다.** `next lint` 가 설정 마법사를 띄우며
    대화형 프롬프트로 진입한다(deprecated 경고 포함). 실행 불가라 **미수행**으로 보고한다 —
    통과했다고 적지 않는다.
  - 커버된 조합: 비-number(`'3.7'`·`'5'`·`''`·`NaN`·`±Infinity`·객체·배열·boolean) ×
    시장가/지정가 × 국내/해외 × 매수/매도.

- [08:11] 🔎 **테스트 중 발견한 사실 — `NaN`·`Infinity` 는 HTTP 경계에 애초에 도달할 수 없다.**
  `JSON.stringify({q: NaN})` → `{"q":null}` 이므로 JSON 본문으로는 전송이 불가능하다. 처음엔
  route 테스트에서 이들에게 400 을 기대했다가 12건이 실패해서 알았다. **기대값을 바꿔 맞추지 않고**
  사실 자체를 고정하는 테스트로 재작성했다(`null` 로 도착 → 미지정 취급 → 200). 내부 연산이
  만들어 내는 NaN 은 어댑터·한도 가드가 담당한다 — 방어 이중화의 나머지 절반이 실제로 필요한
  이유가 이것이다.

- [08:11] **안전장치 self-check 5/5.**
  1. `DRY_RUN=true` 시 실 거래소 호출 없음 — `submitOrder` 7단계 무변경. 변경은 전부 그 **앞** 또는
     `realSubmit` **내부의 추가 거절**뿐이라 송신을 새로 유발하는 코드가 0줄이다.
  2. `KILL_SWITCH=true` 차단 — 3단계 무변경.
  3. 한도 초과 거부 — **강화됨**(NaN 우회 폐쇄). 한도 이내·경계값·초과 3케이스 회귀 테스트로 고정.
  4. 심볼 화이트/블랙리스트 — 4단계 무변경.
  5. 주문 결과 기록 — 어댑터 거절은 `realSubmit` 반환값이므로 기존대로 `status='rejected'` +
     `blocked_by='bad_number_field'` 로 남는다. API 400 은 `orders` 행 생성 **이전**이라 행이 없다
     (기존 `symbol/side/type required` 400 과 동일 취급) — 대신 `console.warn` 을 남겼다. **이 한
     가지가 판단이 갈릴 수 있는 지점이라 아래에서 Reviewer 판단을 요청한다.**

- [08:11] 📋 **Reviewer 판단 요청 (4건).**
  1. **과도차단 재검증(최우선)** — `quantity` 엄격 / `price` 느슨의 비대칭이 정당한가. 특히
     "quantity 는 4개 진입점 전부에서 `number | undefined` 로 정규화된다"는 내 전제가 맞는지
     독립 확인 바란다. **이 전제가 틀리면 실매매가 끊긴다.**
  2. **범위 판단** — `order-limits.ts` 의 NaN fail-open 을 T-027 에 포함시킨 것이 맞나, 별도
     task 로 분리해야 하나. (SAFETY_PATHS 확대 → Reviewer 판정 scope 에 이 경로가 포함돼야 커밋됨)
  3. **API 400 의 감사 공백** — 비-number 요청이 `orders` 행 없이 400 으로 끝나는 것이 허용
     가능한가. `console.warn` 으로 충분한지, 아니면 `trade_logs` 에 order_id=null 로 남겨야 하는지.
  4. **잔여 항목** — `POST /api/signals` 를 이번에 포함하지 않은 판단.

- [08:11] **커밋하지 않았다.** `HEAD` = `7b9de61` 유지. 변경 경로에 SAFETY_PATHS 3개
  (`src/lib/exchanges/`·`src/app/api/orders/`·`src/lib/safety/`)가 포함되므로, commit-msg 훅의
  Reviewer 게이트를 통과하려면 **Reviewer 판정의 scope 가 이 세 경로를 모두 덮어야 한다.**
  npm 신규 의존성 추가 0건.

### 라운드 2 — Reviewer MEDIUM-1 + LOW 2건 반영 (2026-08-17)

- [08:29] ✅ **MEDIUM-1 — `kis-overseas.ts` price 유한성 가드 신설.** `krwPrice` 확정 직후
  `!Number.isFinite(Number(krwPrice))` 체크 추가. 국내와 **느슨한 형태로 통일**했다(엄격하게
  가면 mysql2 DECIMAL→string 경로가 끊기고, 해외 매도가 막히는 것은 청산 차단이라 이 결함보다
  훨씬 무겁다). 회귀 테스트로 숫자 문자열 `'280000'` 매수·**매도** 양쪽이 계속 통과함을 고정했다.

- [08:29] ⚠️ **Reviewer 제안 수정안 한 곳을 그대로 쓰지 않았다 — `req.type !== 'market' &&` 스코프는 해외에서 틀린다.**
  Reviewer 기록의 수정 방향은 `req.type !== 'market' && !Number.isFinite(Number(krwPrice))` 였는데,
  이건 국내 어댑터의 형태를 그대로 옮긴 것이다. **해외는 다르다**: `kis-overseas.ts:351`
  `ORD_DVSN:'00'`(지정가) **고정**이고(KIS 해외는 시장가 미지원), 시장가도 `usdPrice` 에서
  ±0.5% 공격적 호가를 파생시킨다(`:333-337`) — 즉 **모든 주문이 price 를 쓴다.** `type` 으로
  스코프하면 해외 시장가에 구멍이 그대로 남아 MEDIUM-1 을 절반만 고치는 셈이라, **가드를
  무조건 적용**했다. 국내에서 `type` 스코프가 정당한 이유(시장가는 `ORD_UNPR:'0'` 이라 price
  미사용)가 해외에는 성립하지 않는다. 코드 주석에 이 비대칭의 근거를 남겼고, 테스트도
  시장가/지정가 양쪽을 `describe.each` 로 덮는다.
  → 안전 방향(더 넓게 막음)이고 정상 주문 차단은 없음(회귀 테스트 고정). Reviewer 재확인 요청.

- [08:29] ℹ️ **부수 효과 1건 (숨기지 않고 보고).** 가드가 `adjPrice <= 0` 보다 **앞**에 있으므로,
  `price=NaN` 인 주문의 에러 문구가 `USD 가격 계산 실패 (FX 환산 오류)` → `price 타입 오류: …`
  로 바뀐다. 의도한 개선이다 — NaN 은 FX 오류가 아니라 호출부 타입 결함이라 기존 문구가 원인을
  오도했고, 분류도 `kis_rejected` → `bad_number_field` 로 정확해진다. `price=0`·미지정은 기존
  문구·경로 그대로이며 테스트로 고정했다.

- [08:29] ✅ **LOW-1 — 설계 판단 서술 정정.** "quantity 엄격 / price 느슨"은 **어댑터 레이어에만**
  해당한다. API 경계(`route.ts`)의 `invalidNumericField()` 는 `price`·`amountKRW` 도 동일하게
  엄격(`Number.isFinite`, 강제변환 없음)하다. 비대칭이 의도적인 근거 — 느슨함이 필요한 이유는
  mysql2 DECIMAL round-trip 이 있는 **DB 경유 경로**(`POST /api/signals`·entry-watcher)에만
  해당하고, 사람이 만든 JSON 이 들어오는 API 경계에는 그 사정이 없다 — 를 `route.ts` JSDoc 에
  명시했다. 위 설계판단① 은 이 한 줄과 함께 읽어야 정확하다.

- [08:29] ✅ **LOW-2 — JSDoc 카테고리명 정정.** `order-quantity.ts` 의 `qty_not_number` →
  실제 구현대로 `bad_number_field` 로 수정. 이 카테고리를 두 어댑터의 `price 타입 오류` 와
  **공유**한다는 사실도 함께 적었다(원인이 같아 함께 조회하는 편이 진단에 낫다).

- [08:29] ✅ **인용 오류 정정 (기록만, 코드 변경 아님).** 위 조사 결과에서 `!(x > 0)` 기존 관용구로
  인용한 3곳 중 `snapshot-cleanup.ts:119` 는 **형태가 다르다** — 실제는
  `Number.isFinite(qty) && qty > 0 && (!Number.isFinite(price) || price <= 0)` 로, 의미상 fail-closed
  이긴 하나 `!(x > 0)` 관용구가 아니다. 정확한 선례는 `volatility-guard.ts:338,396,641` 과
  `src/lib/safety/order-sync.ts:714,805` **2개 파일 5곳**이다(`order-sync.ts` 는 내가 디렉토리를
  빠뜨려 적었다 — 정확한 경로는 `src/lib/safety/order-sync.ts`). 수정의 정당성 자체는 영향 없음.

- [08:29] **변경 파일 (라운드 2)**
  - `src/lib/exchanges/kis-overseas.ts` — price 유한성 가드 신설 (MEDIUM-1)
  - `src/lib/exchanges/order-quantity.ts` — JSDoc 카테고리명 정정 (LOW-2, 주석만)
  - `src/app/api/orders/route.ts` — JSDoc 에 "이 경계는 price 도 엄격" 근거 추가 (LOW-1, 주석만)
  - `src/lib/exchanges/__tests__/nonnumber-order-fields.test.ts` — 해외 price 케이스 +17개

- [08:29] **테스트 결과 (있는 그대로).**
  - `npx jest` — **102 suites / 1660 tests 전부 통과.** 라운드1 기준선 102/1643 → **+17 케이스**
    (신규 suite 없음). **기존 1643개 중 실패·수정 0건.**
  - `npx tsc --noEmit` — **exit 0**.
  - `npm run build` — 성공(`✓ Compiled successfully`).
  - `npm run lint` — 라운드1 과 동일하게 **미수행**(이 저장소에 ESLint 설정 없음 — `next lint` 가
    대화형 설정 마법사로 진입). 통과했다고 적지 않는다.
  - 신규 커버리지: 해외 price × {`Infinity`·`-Infinity`·`NaN`·`'abc'`·객체} × {시장가·지정가}
    차단 10건 + 회귀 고정 7건(숫자 문자열 매수·**매도**, number 지정가, 시장가 +0.5% 호가 유지,
    `price=0` 기존 문구 유지, Infinity **매도** 차단).

- [08:29] **안전장치 self-check 5/5 재확인.** 라운드 2 변경은 어댑터 내부의 **추가 거절 1건**과
  주석·테스트뿐이다. `submitOrder` 의 DRY_RUN(7)·KILL_SWITCH(3)·심볼(4)·한도(5~6) 단계와 그
  순서는 무변경이고, 송신을 새로 유발하는 코드는 0줄이다. 어댑터 거절이므로 `orders` 행은
  2단계에서 이미 생성돼 `status='rejected'` + `blocked_by='bad_number_field'` 로 남는다.

- [08:29] **커밋하지 않았다.** `HEAD` = `7b9de61` 유지. npm 신규 의존성 0건. 변경 경로는 라운드1과
  동일한 SAFETY_PATHS 3개 범위 안이고, Reviewer 판정 scope
  (`src/lib/exchanges/`, `src/app/api/orders/`, `src/lib/safety/`)가 그대로 덮는다.

## Reviewer 기록

- [08:24] **범위**: `git diff HEAD`로 실제 변경분만 감사(`order-quantity.ts`·`kis-domestic.ts`·`kis-overseas.ts`·`api/orders/route.ts`·`order-limits.ts`·`dry-run.ts` + 신규 테스트 2개). HEAD=`7b9de61` 불변, 워킹트리 무수정 확인. `npx jest` 재실행 — **102 suites / 1643 tests 전부 통과**(Developer 보고와 완전 일치). `npx tsc --noEmit` — exit 0 재확인.

- [08:24] 🔴 **판단 요청 1 (과도차단 재검증, 최우선) — 독립 검증 결과: 전제 참(SOUND).** 4개 진입점을 직접 코드 추적했다.
  `api/orders/route.ts` — 신설된 `invalidNumericField()`(400 가드)가 `sizeOrderQuantity` 호출보다 **먼저** 실행되므로, 비-number quantity/price/amountKRW는 애초에 `sized.quantity ?? body.quantity` 폴백 라인에 도달하지 못한다. 이 라우트만 유일하게 "원본 폴백"이 실재했던 지점인데(과거 결함의 원인) 이번 수정으로 정확히 닫혔다.
  `entry-watcher/route.ts:245-272` — `requestedQuantity: row.quantity != null ? Number(row.quantity) : undefined`로 이미 `Number()` 강제변환, `orderReq.quantity = quantity`(=`sized.quantity`)만 쓰고 원본 폴백 없음.
  `signals/service.ts` `buildOrderRequest`(createSignal 경유, :208-232) — `quantity: sized.quantity` 직접 대입, 원본 폴백 없음.
  `signals/service.ts` `approveSignal`(:522-530) — `quantity: row.quantity != null ? Number(row.quantity) : undefined`, 마찬가지로 원본 폴백 없음.
  **4곳 모두 quantity가 `number | undefined`로만 어댑터에 도달한다** — 엄격 가드(`typeof === 'number'`)가 정상 주문을 막을 수 없다는 전제가 성립한다. price 느슨 처리 근거(`mysql2` DECIMAL→string, `signals.price`/`quantity`는 `docs/db-schema.md` 확인 결과 `DECIMAL(36,8)`/`DECIMAL(36,18)`)도 스키마로 재확인됨.
  **다만 주의할 비대칭 1건**: `api/orders/route.ts`의 `invalidNumericField()`는 quantity·price·amountKRW **셋 다 동일하게 엄격**(`Number.isFinite(v)`, 강제변환 없음)하다 — "price는 느슨" 설계는 **어댑터 레이어에만** 적용되고, 이 API 경계에서는 price도 숫자 문자열(`'70000'`)을 400으로 막는다. 신규 테스트(`route.test.ts` NON_NUMBERS)가 이를 명시적으로 그렇게 고정했다. 과도차단 아님 — 현재 이 엔드포인트를 호출하는 프론트엔드/내부 코드가 전무함을 재확인(`fetch.*api/orders.*POST` 전체 리포 검색 0건)하여 실제로 이 경로로 문자열 price가 오는 사례가 없고, "느슨 처리가 필요한 이유"(mysql2 DECIMAL round-trip)는 `POST /api/signals`·`entry-watcher` 등 **DB 경유 경로**에만 해당해 이 API 경계와는 무관하다. 다만 Developer의 "설계 판단 ①" 서술이 "price는 느슨"이라고만 적어 이 경계에서는 오히려 엄격하다는 점을 명시하지 않은 것은 문서 정확성 문제로 아래 LOW-1에 기록.

- [08:24] 🔴 **판단 요청 2 (NaN fail-open 범위) — 실재 여부 독립 재현 완료, T-027 포함 타당.**
  수정 전 로직을 코드로 직접 추적(격리 실행 없이 정적 재현): `price:'abc', quantity:5` 입력 시 `resolveOrderAmountKRW` 원본은 `req.price && req.quantity` → 둘 다 truthy → `'abc' * 5 = NaN` 반환. `checkOrderMax` 원본은 `amount <= 0` → `NaN <= 0` → **false**(통과), `amount > effectiveMax` → `NaN > 100000` → **false**(통과) → 최종 `return { ok: true }` — **1회 한도 검사를 완전히 우회**한다. 이후 `kis-domestic.ts`(수정 전) `roundToTick('abc')` → `'abc'/tick` → `NaN` → `ORD_UNPR: "NaN"`이 라이브 API로 실제 송신되는 경로까지 확인. 매수 경로에서 100% 재현되는 실재 버그였다.
  `!(amount > 0)` vs `amount <= 0` 동치성: 유한 양수·0·음수 전부 동일 진리값(0→true/true, 음수→true/true, 양수→false/false), NaN에서만 다름(true vs false) — 경계 회귀 없음, 신규 테스트(`order-limits-nan-failopen.test.ts`)가 경계값(정확히 max, 0, 초과)까지 커버.
  기존 관용구 인용 검증: `volatility-guard.ts:338,396,641` — **정확히 일치**(`!(price>0)`, `!(prev.totalKRW>0)`, `!(totalKRW>0)`). `order-sync.ts` — 실제 경로는 `src/lib/safety/order-sync.ts`(Developer 인용에 디렉토리 누락)이며 714·805 줄 **정확히 일치**(`!(fill.qty>0)`/`!(ordered>0)`, `!(price>0)`). `snapshot-cleanup.ts:119` — **불일치**: 실제 코드는 `!Number.isFinite(price) || price <= 0`이며 `!(price>0)` 형태가 아니다(의미상 동등한 별도 관용구). 사소한 인용 오류로 LOW-2에 기록, 수정 자체의 정당성에는 영향 없음.
  범위 판단: **T-027에 포함 유지가 맞다.** 같은 커밋이 건드리는 동일 방어 레이어(주문 직전 수치 검증)이고, 분리하면 "quantity 타입 결함은 막았지만 price 타입 결함으로 인한 한도 전면 우회는 열어둔 채 커밋"이 되어 오히려 상태가 더 나빠진다. SAFETY_PATHS 3개(exchanges/orders route/safety) 확대도 이미 필요했던 범위와 일치한다.

- [08:24] 🔴 **판단 요청 3 (API 400 감사 공백) — `console.warn`으로 지금은 충분, 단 백로그 등록 권고.**
  이 엔드포인트는 현재 리포지토리 전체에서 호출하는 프론트엔드/내부 코드가 없다(재확인됨) — 유일한 도달 경로는 계정 소유자의 직접 curl. 기존 `symbol/side/type required` 400 분기는 애초에 `console.warn`조차 없었으므로, 이번 추가는 기존 대비 오히려 진단력이 늘었다. `orders` 행이 생기기 전 단계의 요청을 `trade_logs`에 `order_id=null`로 남기는 것은 스키마 관행(항상 `order_id`가 있는 감사 로그)과 다른 새로운 패턴을 도입하는 것이라 이번 task 단독 판단으로는 과하다. **권고**: 지금은 `console.warn`으로 충분, 이 엔드포인트에 실 호출자가 생기는 시점(멀티유저 Step2/4 등)에 재검토 백로그로 등록.

- [08:24] 🔴 **판단 요청 4 (POST /api/signals 잔여 항목) — Developer 판단에 동의, 추가로 실노출 재확인.**
  `signals/service.ts`의 `buildOrderRequest`가 `sized.quantity`만 쓰고(원본 폴백 없음) `unusableQuantityReason`은 아니어도 quantity는 이미 봉쇄돼 있음을 재확인. price는 원본 그대로 흐르지만 이번에 신설된 `kis-domestic.ts`의 `!Number.isFinite(Number(price))` 가드와 `order-limits.ts`의 NaN fail-closed 수정이 방어망 역할을 해, 오늘 이 엔드포인트가 무방비여도 실제 도달 가능한 피해는 "라이브 호출 1건 실패"로 이미 억제돼 있음을 코드 추적으로 확인했다. Developer가 단독 판단하지 않고 Leader에게 넘긴 것(시그널 생성 semantics 변경 우려)은 타당한 경계 설정이다.

- [08:24] **MEDIUM-1 — 해외 어댑터(`kis-overseas.ts`)에는 국내와 동일한 price 유한성 가드가 없다.** `kis-domestic.ts`는 이번에 `!Number.isFinite(Number(price))`를 신설했지만 `kis-overseas.ts`는 quantity만 강화하고 price는 기존 `adjPrice <= 0`(319-338줄) 그대로 뒀다. 이 가드는 `krwPrice`가 NaN을 만드는 값이면 `krwPrice > 0`이 false가 되어 `usdPrice=0→adjPrice=0`으로 막지만, **`krwPrice`가 `Infinity`(또는 `Infinity`로 강제변환되는 값)이면 `Infinity > 0`이 true라 통과**한다 — `roundToTickOverseas(Infinity)`는 `Math.round(Infinity)` → `String(Infinity)` = `"OVRS_ORD_UNPR": "Infinity"`라는 쓰레기 payload가 라이브 API로 나간다. 도메스틱의 `ORD_UNPR:"NaN"`과 정확히 같은 클래스의 결함이 해외 쪽에는 남아있다. **실도달 가능성은 낮다** — `fetchUsdKrwRate()`가 `r>0` 가드로 fx=0을 이미 차단하고, ticker 가격 소스가 현실적 범위를 벗어나 Infinity가 되기는 어렵다. 또한 매도가 한도 검사를 건너뛰므로(청산 우선 정책, `dry-run.ts:164,177`) 해외 매도 주문에서는 이 가드가 유일한 방어선이라는 점도 국내와 동일하다. 자금손실 경로는 아니고(브로커가 거절할 것으로 기대) "가드가 있는데 안 걸리는" 구조적 결함이라는 이 task의 취지에 정확히 해당하므로 후속 조치 권고: `kis-overseas.ts`에도 `req.type !== 'market' && !Number.isFinite(Number(krwPrice))` 형태의 명시적 가드 추가.
  **수정 방향**: `kis-overseas.ts` createOrder의 `const krwPrice = req.price ?? 0;` 직후에 `!Number.isFinite(Number(krwPrice))` 체크 추가(국내와 대칭).

- [08:24] **LOW-1 — `설계 판단 ①` 서술이 API 경계(route.ts)에서는 price도 엄격 처리된다는 사실을 명시하지 않음.** 기능 결함은 아니고(위 판단 요청 1 참고, 과도차단 없음 확인) 향후 유지보수자가 "price는 항상 느슨하다"고 오해할 여지가 있다. `route.ts` 주석/task 기록에 "이 경계는 예외적으로 엄격"이라는 한 줄 추가를 권고.

- [08:24] **LOW-2 — `order-quantity.ts` JSDoc이 실제 코드와 다른 카테고리명을 인용.** `order-quantity.ts:74`의 주석은 `categorizeRejectReason`이 `qty_calc_failed`/`qty_not_number`로 분류한다고 적었지만, 실제 `dry-run.ts:265`의 구현은 quantity·price 타입오류를 통합해 `bad_number_field`로 분류한다(`qty_not_number`라는 카테고리는 코드 어디에도 없음). 순수 주석 오기, 동작에는 영향 없음. Developer의 "기존 관용구" 인용 중 `snapshot-cleanup.ts:119`도 실제로는 `!(x>0)`가 아닌 `!Number.isFinite(price) || price <= 0`라는 의미상 동등하지만 다른 표현이었다(위 판단요청 2 참고) — 같은 종류의 사소한 인용 부정확.

- [08:24] **안전장치 우회 경로 확인 — 없음.** `submitOrder(` 호출부 전수 검색(4곳) 모두 `kis.createOrder`를 콜백으로만 넘기고 직접 호출 없음. `dry-run.ts`의 DRY_RUN(7단계)·KILL_SWITCH(3단계)·심볼 화이트리스트(4단계) 체크는 실 송신(8단계, `realSubmit`=어댑터) **이전**에 위치하며 이번 diff가 그 순서를 건드리지 않았다 — 신설 가드는 전부 8단계(어댑터) 내부 또는 그보다 앞단(API 경계)의 **추가 거절**일 뿐 새로운 송신 경로를 만들지 않는다. 어댑터 거절 시 `orders` 행은 이미 2단계에서 생성돼 있어 `status='rejected'`+`blocked_by` 정상 기록됨(감사 공백은 route.ts 400 케이스에 한정, 판단요청 3 참고). API 키·SQL 파라미터 바인딩 이슈 없음(이번 diff에 신규 SQL 없음, `console.warn`은 symbol/타입/값만 로그).

- [08:24] **종합**: Developer의 핵심 전제(quantity 엄격 가드의 안전성)는 독립 검증 결과 사실이며 과도차단 위험 없음. NaN 한도 우회는 실재했던 버그로 정확히 재현·확인했고 수정이 타당하다. CRITICAL·HIGH 없음. MEDIUM 1건(해외 어댑터 price Infinity 가드 누락 — 국내와 대칭 추가 권고, 비차단), LOW 2건(문서 인용 부정확, 비차단).
  최종 판정: PASS (scope: src/lib/exchanges/, src/app/api/orders/, src/lib/safety/)

### 라운드 2 재검증 (2026-08-17)

- [08:33] **범위**: `kis-overseas.ts`·`order-quantity.ts`·`api/orders/route.ts`·신규 테스트 파일의 라운드2 diff만 재감사. HEAD=`7b9de61` 불변, 워킹트리 무수정 확인. `npx jest` 재실행 — **102 suites / 1660 tests 전부 통과**(라운드1 1643 대비 +17, 기존 실패·수정 0건, Developer 보고와 완전 일치). `npx tsc --noEmit` exit 0. 신규 테스트 파일만 별도 실행해도 92/92 통과(75+17).

- [08:33] 🔴 **최우선 — 해외 매도 경로 회귀 확인: 문제 없음.** 가드(`kis-overseas.ts:343` `!Number.isFinite(Number(krwPrice))`)를 직접 코드 추적으로 재현했다.
  숫자 문자열 `'280000'`(mysql2 DECIMAL round-trip 대역값) — `Number.isFinite(Number('280000'))=true`이므로 가드 통과, 이후 `krwPrice > 0` 비교·`krwPrice / fx` 나눗셈은 JS 산술 강제변환으로 정상 작동(`usdPrice=200`) — **매수·매도 양쪽 다 차단 없이 통과**함을 코드로 확인, 테스트(`'280000'`/`'280000.0'` × 매수, 매도 별도 케이스)도 `res.ok===true`+`OVRS_ORD_UNPR==='200'`로 고정돼 있고 실제 실행도 통과.
  number 지정가(280000) — 가드 영향 없음(기존과 동일 경로).
  시장가 +0.5% 호가 — 가드가 `type` 으로 스코프되지 않아 시장가도 통과하지만, `krwPrice=280000`은 유한수라 거부되지 않고 이후 `usdPrice*1.005` 파생 로직(무변경)이 그대로 실행됨을 확인(`OVRS_ORD_UNPR==='201'` 테스트로 고정, 계산 검증: `200*1.005=201` round).
  `price=0`/미지정 — `Number.isFinite(Number(0))=true`라 새 가드에서 거부되지 않고 기존 `adjPrice<=0` 분기(`'USD 가격 계산 실패 (FX 환산 오류)'`)로 그대로 흘러감을 코드·테스트 양쪽으로 확인 — 문구·경로 무변경.
  **결론: 청산(매도) 경로를 끊지 않는다.** 회귀 위험 없음.

- [08:33] **Infinity/-Infinity/NaN 차단 재확인 — 닫힘.** `krwPrice=Infinity`일 때 수정 전에는 `Infinity>0`→true이므로 `usdPrice=Infinity`, `adjPrice=Infinity`(또는 시장가면 `Infinity*1.005=Infinity`), `adjPrice<=0`→false(통과) → `roundToTickOverseas(Infinity)`가 `Math.round(Infinity)`→`Infinity`→`String(Infinity)`="Infinity"를 생성해 **`OVRS_ORD_UNPR:"Infinity"`가 라이브로 나갔을 경로**를 재확인했다(라운드1에서 지적한 그대로). 수정 후: 가드가 `adjPrice` 계산보다 **먼저** 실행되어 `Number.isFinite(Infinity)=false`로 즉시 거부 — `kisFetch` 호출 전 차단됨을 코드·테스트(지정가·시장가 각각, 매도 별도 케이스) 양쪽으로 확인. `-Infinity`·`NaN`·`'abc'`·객체도 동일 경로로 차단 확인.

- [08:33] **국내/해외 대칭성 — Developer의 의도적 비대칭(스코프 방식)이 타당함을 확인, 라운드1 제안 그대로 적용했다면 오히려 결함이었다.**
  라운드1에서 내가 제안한 수정 방향은 `req.type !== 'market' &&`로 국내 형태를 그대로 복사하는 것이었는데, 이는 **틀렸다** — 국내는 시장가에서 `ORD_UNPR:'0'`(price 미사용)이라 스코프가 안전하지만, `kis-overseas.ts:371` `ORD_DVSN:'00'`이 **항상 지정가 고정**이고(KIS 해외 시장가 미지원), 시장가도 `usdPrice`(=krwPrice 기반)에서 ±0.5% 공격적 호가를 파생시킨다(`:352-357`, 무변경 확인) — 즉 **해외는 모든 주문이 price를 쓴다.** `type`으로 스코프했다면 해외 시장가에 Infinity 구멍이 그대로 남아 MEDIUM-1을 절반만 고치는 결과였을 것이다. Developer가 이를 스스로 발견해 무조건 적용으로 고친 것은 올바른 독립 판단이었다 — 그대로 승인한다.
  quantity(strict, `typeof==='number'`) vs price(loose, `Number(x)` 강제변환) 비대칭은 국내·해외 양쪽에 동일하게 적용됨을 코드로 재확인 — 대칭 유지됨.

- [08:33] **신규 fail-open 없음.** `kis-overseas.ts` diff는 어댑터 내부 추가 거절 1건(343-346줄)뿐이고 `submitOrder`의 DRY_RUN/KILL_SWITCH/한도 단계 순서·로직 무변경(라운드1과 동일 결론 재확인). `route.ts`·`order-quantity.ts` diff는 순수 JSDoc 주석 추가뿐 — 로직 변경 0줄, `git diff`로 직접 확인(코드 라인 변경 없음, 주석 블록만 삽입).

- [08:33] **LOW-1·LOW-2 정정 확인.**
  LOW-1: `route.ts` JSDoc에 "이 경계는 price도 예외적으로 엄격하다" + 그 근거(DB round-trip 경로에만 느슨함이 필요, 이 엔드포인트는 현재 호출자 0)가 명시됨 — 라운드1 지적사항 정확히 반영.
  LOW-2: `order-quantity.ts` JSDoc이 `qty_not_number`(존재하지 않던 이름) → `bad_number_field`로 정정됐고, `dry-run.ts:265`의 실제 구현(`/(quantity|price)\s*타입\s*오류/i` → `bad_number_field`)과 일치함을 재확인. `!(x>0)` 인용 오류(`snapshot-cleanup.ts`)도 기록만 남기고 코드 변경은 없음 — 정확한 선례 2곳(`volatility-guard.ts`·`src/lib/safety/order-sync.ts`)으로 correctly 정정됨.

- [08:33] **부수 효과 확인 (Developer 08:29 보고, 숨기지 않고 보고한 항목 검증).** `price=NaN`일 때 에러 문구가 `'USD 가격 계산 실패 (FX 환산 오류)'` → `'price 타입 오류: ...'`로 바뀌는 것을 확인. 이 문자열을 참조하는 다른 코드가 있는지 전체 리포에서 검색했고 `kis-overseas.ts:358`(adjPrice 가드 자체) 외 참조 없음 — 회귀 없는 순수 개선(분류가 `kis_rejected`→`bad_number_field`로 더 정확해짐).

- [08:33] **종합**: 라운드1 MEDIUM-1이 정확히 해소됐고, 그 과정에서 Developer가 Reviewer의 제안(`type`으로 스코프)을 문자 그대로 따르지 않고 독립적으로 더 정확한 수정(무조건 적용)을 택한 것을 코드·테스트로 검증해 타당함을 확인했다. LOW-1·LOW-2도 정확히 반영됨. 라운드2에서 새로 발견된 CRITICAL·HIGH·MEDIUM 없음. 잔여 LOW 없음.
  최종 판정: PASS (scope: src/lib/exchanges/, src/app/api/orders/, src/lib/safety/)

## QA 기록

- [08:35] **최종 검증 시작. 16항목 커버리지 표:**

| # | 검증 항목 | 실행 여부 | 결과 |
|---|---|---|---|
| 1 | npx jest (기준선 102/1660) | ✓ | 102 suites / 1660 tests 전부 통과 |
| 2 | npm run typecheck (0 에러) | ✓ | exit 0 |
| 3 | 국내 지정가 정상값 | ✓ | 1, 5, 3.7, 0.4, 1000 모두 통과 |
| 4 | 해외 지정가 정상값 (매수·매도) | ✓ | 매수·매도 양쪽 통과 |
| 5 | mysql2 DECIMAL 문자열 ('70000', '280000') | ✓ | 해외 '280000' 매수·매도 양쪽 통과, 국내 회귀 없음 |
| 6 | 해외 시장가 정상 동작 | ✓ | +0.5% 호가 유지, 시장가·지정가 양쪽 테스트 통과 |
| 7 | price=0/미지정 기존 경로 유지 | ✓ | 기존 에러 문구·경로 무변경 (테스트 고정) |
| 8 | 비-number quantity 차단 (어댑터 도달 전) | ✓ | 문자열·객체·배열·NaN 모두 차단, 지정가·시장가 양쪽 |
| 9 | 해외 Infinity/-Infinity/NaN price 차단 | ✓ | 지정가·시장가·매도 각각 차단 확인 (17개 테스트) |
| 10 | POST /api/orders 비-number → 400 | ✓ | quantity/price/amountKRW 모두 400 조기 거절 (43개 테스트) |
| 11 | NaN 한도 우회 실제로 차단 | ✓ | fail-closed 수정: `!(amount > 0)` 적용, 14개 경계값 테스트 통과 |
| 12 | 한도 경계값 (이내/정확히/초과) | ✓ | 3케이스 모두 기존대로 동작 (회귀 없음) |
| 13 | DRY_RUN·KILL_SWITCH·심볼 단계·순서 | ✓ | submitOrder 1~8단계 무변경 (코드 확인) |
| 14 | 어댑터 거절 status='rejected' + blocked_by='bad_number_field' | ✓ | 어댑터 내부 추가 거절 → orders 행 정상 기록 |
| 15 | git status --short 무변경 | ✓ | 워킹트리: Reviewer 수정 파일만 변경 (정상), 신규 테스트 추가 |
| 16 | HEAD 불변, 커밋 0회 | ✓ | HEAD=7b9de61 확인, 변경 미커밋 상태 정상 |

- [08:37] **최종 판정: ✅ 검증 통과**

**실행 결과:**
- developer 제공 테스트: 16항목 전부 실행
- jest: 102 suites / 1660 tests 전부 통과 (라운드1 기준선 동일)
- 라운드2 신규 테스트 (+17개 해외 price): 모두 통과
- 회귀 테스트: 정상 주문(정수·소수·문자열 DECIMAL) 매수·매도·시장가·지정가 전부 통과
- NaN 한도 우회 폐쇄: fail-closed 수정 검증 완료
- 안전장치 체크: DRY_RUN·KILL_SWITCH·한도·심볼·감사 로그 무변경·강화
- 보안 점검: API 키 노출 없음, SQL 바인딩 정상, console.warn으로 흔적 남김
- Critical 결함: 0건
- 발견된 결함: 0건

**요구사항 충족 여부: ✅ 충족**

## 최종 요약 (사용자용 — Leader가 전체 작업 종료 후 한 번에 작성)

---

## 최종 요약 (사용자용 — Leader 작성, 2026-08-17)

`quantity` 가 숫자가 아닌 값(예: 문자열 `'3.7'`)으로 들어오면, 어댑터의 `quantity <= 0` 가드가
JS 의 느슨한 비교(`'3.7' <= 0` → false) 때문에 걸러내지 못해 **라이브 KIS 주문 API 호출까지
나가던** 문제를 고쳤다. 여기까지는 [[T-024-manual-order-quantity-guard]] 가 이미 지적한 것으로,
최악이라야 무의미한 호출 1건이었다.

**정작 무거운 건 조사 중에 나왔다.** `price` 에 비-number 가 섞이면 `price * quantity` 가 **NaN**
이 되는데, NaN 은 모든 관계연산에서 false 라 `amount <= 0` 도 `amount > 한도` 도 걸리지 않는다.
즉 **1회·일일 주문 한도를 통째로 우회하는 무제한 금액**이 성립했다. `resolveOrderAmountKRW` 가
NaN 대신 0 을 반환하게 하고, 한도 판정을 `amount <= 0` → `!(amount > 0)` 로 바꿔 닫았다(유한
양수에서 두 식은 완전 동치라 회귀가 없고, 이 부정형은 `volatility-guard.ts`·`order-sync.ts` 가
이미 쓰던 이 저장소의 관용구다).

**과도차단이 이번 작업의 최대 위험이었다.** 실계좌 실거래 중이라 정상 주문을 잘못 막으면 그
자체가 사고다. 특히 mysql2 가 DECIMAL 을 **문자열로** 돌려주므로 `'70000'` 은 오늘 정상 송신되는
값이다. 그래서 `quantity` 는 엄격(모든 진입점이 `sizeOrderQuantity` 로 정규화됨을 4곳 전수
확인)·`price` 는 느슨(`Number.isFinite(Number(x))`)이라는 비대칭을 택했다. Developer 가 구현 중
실제로 이 함정을 밟았고(price 를 엄격하게 짰다가 `'70000'` 회귀 테스트 실패로 발견), Reviewer 가
전제를 독립 검증했다.

해외 어댑터에는 `Infinity` 가 `adjPrice<=0` 을 빠져나가는 거울상 구멍이 남아 있어 함께 닫았다 —
**해외 매도는 한도검사를 건너뛰므로(청산 우선 정책) 어댑터 가드가 유일한 방어선**이기 때문이다.

**검증**: 102 suites / 1660 tests 전부 통과(신규 +143, 기존 실패·수정 0건) · typecheck 0 에러 ·
QA 16항목 전수 실행. 정상 주문 회귀(국내·해외 × 매수·매도 × DECIMAL 문자열 × 시장가 호가)를
테스트로 고정했고, DRY_RUN·KILL_SWITCH·심볼·한도 단계와 그 **순서는 무변경**이다.

**커밋 게이트**: 변경 경로에 SAFETY_PATHS 3개가 포함돼 [[T-025-commit-reviewer-safeguard]] 훅의
Reviewer 게이트 대상이며, 사전 시뮬레이션에서 통과(`✅ Reviewer 감사 기록 확인: T-027`)를 확인했다.

### 값진 대목 — Developer 가 Reviewer 지시를 반박하고 Reviewer 가 수용했다

Reviewer 라운드1 은 해외 가드를 `req.type !== 'market' &&` 로 스코프하라고 제안했으나, Developer
는 따르지 않고 무조건 적용했다. 라운드2 에서 Reviewer 가 **자기 제안이 틀렸음을 인정**했다 —
해외는 `ORD_DVSN:'00'` 지정가 고정이고 시장가도 같은 `usdPrice` 에서 호가를 파생시켜 **모든 주문이
price 를 쓴다.** 지시를 그대로 따랐으면 시장가 경로에 구멍이 남았다.

### 후속 백로그 (이번 범위 밖, Leader 판단)

`POST /api/signals`(`route.ts:48`)가 `body.price`·`quantity`·`amountKRW` 를 무검증으로
`createSignal` 에 넘기는 **같은 패턴**이 남아 있다. Developer 가 발견해 숨기지 않고 보고했고
Reviewer 도 이번 제외에 동의했다 — 결과가 이제 봉쇄돼 있고(quantity 는 `sizeOrderQuantity`,
price 는 이번 신설 어댑터 가드 + 한도 fail-closed), 시그널은 주문 **이전에** DB 행이 생겨 400 을
넣으면 semantics 가 바뀌므로 단독 판단 사안이 아니다. board.md 백로그로 이관.
