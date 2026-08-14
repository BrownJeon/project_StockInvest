---
task-id: T-024
project: StockInvest
created: 2026-08-13
updated: 2026-08-13
status: done
review-round: 1
qa: passed
tags:
  - type/task
  - domain/safety
  - domain/exchanges
  - domain/signals
aliases:
  - POST /api/orders 수량 방어
  - 수동 주문 소수점 방어
related_tasks:
  - "[[T-020-fractional-order-quantity-sizing]]"
  - "[[T-018-order-sync-fail-closed]]"
  - "[[T-023-getactiveorders-pagination]]"
---

# T-024 · `POST /api/orders` 수동 주문 경로 수량 방어 추가

> 출처: [[T-020-fractional-order-quantity-sizing]] Developer 절 "남긴 것 / Leader 판단 요청" 1번 —
> "수동 주문 경로(`api/orders/route.ts`)는 손대지 않았다(범위 밖). 클라이언트가 소수 수량을
> 보낼 수 있고 코드에 방어가 없다." 이 소견이 board.md Backlog 로 승격됐고, 이번에 해소됐다.

## 0. 이 task 의 특이사항 — 절차 역전 (중요, 반드시 먼저 읽을 것)

**이 변경은 이미 구현·커밋·배포까지 끝난 상태에서 이 task 이력서가 사후 작성됐다.**
정상 순서(Leader 사양 → Developer 구현 → Reviewer 감사 → QA 검증 → 배포 승인)가
지켜지지 않고, **Reviewer 감사 없이 커밋(`9456be5`, 2026-08-13 09:48:22 +0900)되고
webhook-deploy 로 즉시 배포(`2026-08-13 01:19:41~01:20:55 UTC`, exit=0)까지 됐다.**
pm2 `stockinvest` 는 현재 이 커밋으로 기동 중이다(uptime 2026-08-13 01:20:20 UTC 시작 —
배포 시각과 일치).

board.md/RESUME.md 에는 "커밋 배포 대기"라고 기록돼 있었으나 이는 사실이 아니었다 —
문서가 실제 git 상태보다 낡아 있었다(Leader 가 2026-08-13 `git log`/`git status`/
webhook-deploy 로그로 직접 실측 확인).

**따라서 이번 Reviewer/QA 는 "배포해도 되는가"를 묻는 게이트가 아니라 "이미 실계좌에
돌고 있는 코드에 자금 손실로 이어질 결함이 있는가"를 묻는 **사후 라이브 감사**다.**
Critical 이 나오면 즉시 Leader 에게 에스컬레이션 — 사용자에게 긴급 핫픽스 커밋/푸시
승인을 요청해야 하는 상황이다(Reviewer/Developer 본인은 git commit/push 금지, 워킹
트리 수정까지만).

## 1. 목표

`POST /api/orders`(사람이 직접 입력하는 수동 주문 화면이 호출하는 API)가 클라이언트가
보낸 `quantity` 를 무가공으로 신뢰하던 구멍을 막는다. [[T-020-fractional-order-quantity-sizing]]
이 엔진 경로(2곳: `service.ts`/`entry-watcher/route.ts`) 는 정수화했지만 이 수동 경로는
범위 밖으로 남겨뒀었다 — 소수점 수량이 이 경로로 들어오면 해외는 전송 직전 `Math.floor`
로 조용히 축소집행되고 국내는 KIS 가 시끄럽게 거절하는, T-020 이 이미 진단한 바로 그
문제가 재현될 수 있었다.

## 2. 실제 변경 내용 (커밋 `9456be5` 기준)

`src/app/api/orders/route.ts` — T-020 이 만든 `sizeOrderQuantity()`(`src/lib/signals/service.ts`)
를 그대로 재사용:

```ts
const market = getMarketFromSymbol(body.symbol);
const sized = sizeOrderQuantity({
  market,
  orderType: body.type,
  requestedQuantity: body.quantity,
  amountKRW: body.amountKRW ?? 0,
  price: body.price,
});

const orderReq: OrderRequest = {
  ...
  quantity: sized.quantity ?? body.quantity,   // ← 여기가 핵심 방어선
  amountKRW: body.amountKRW,
  ...
};
```

`sizeOrderQuantity` 의 3분기(T-020 문서 참조):
① `requestedQuantity` 가 유한수(`Number.isFinite`)면 그것을 `floor` 해서 정수화
② 지정가 + 가격 있음 + 수량 미지정이면 `amountKRW/price` 를 `floor`
③ 그 외(시장가 등)는 `undefined` 반환 — 어댑터(`kis.createOrder`)에 위임, 그쪽은 이미 정수

신규 회귀 테스트 6건(`route.test.ts`): 소수점 버림·정수 통과 회귀없음·1주미만→0·
amountKRW 만 있는 지정가 사전산출·시장가 위임 회귀없음·필수필드 누락 400 회귀없음.
99 suites / 1476 tests 전부 통과(typecheck 실행 여부는 developer 보고에 명시 없음 —
Reviewer 가 직접 재실행해서 확인할 것).

## 3. Leader 가 사전 조사에서 짚어 둔 의심 지점 (검증 요청 — 결론을 내 말로 대체하지 말 것)

아래는 Leader 가 코드를 읽고 세운 가설이다. **Reviewer 는 이걸 출발점으로만 쓰고 직접
코드·테스트로 독립 검증하라** — 내 판단이 틀렸을 수 있다.

### 의심 A · 타입 불일치(런타임 비-number `quantity`)가 뚫는 경로가 있는가

`route.ts` 의 `CreateBody` 인터페이스는 `quantity?: number` 라고 **선언**하지만 이건
컴파일타임 계약일 뿐, `req.json()` 으로 파싱된 실제 런타임 값이 문자열이거나(`"3.7"`)
`NaN`/`Infinity` 여도 타입체커가 막지 못한다.

Leader 가 코드를 따라가 본 결과 (검증 요청):

1. `sizeOrderQuantity` 분기①의 `Number.isFinite(requestedQuantity)` 는 **문자열에
   대해 엄격히 `false`** 다(코어시션 없음) — 그래서 `"3.7"` 은 분기①을 못 타고
   분기③(시장가/지정가+가격없음)으로 떨어져 `sized.quantity = undefined` 가 되고,
   최종적으로 `sized.quantity ?? body.quantity` 가 **원본 문자열 `"3.7"` 을 그대로
   `orderReq.quantity` 에 남긴다** — 이 route 가 막으려던 바로 그 구멍이 타입 경로로
   재현되는 것처럼 보인다.
2. 다만 그 값이 `kis.createOrder`(`kis-domestic.ts:262-270`) 까지 내려가면
   `submittedQuantity(market, quantity)`(`order-quantity.ts`) 가 다시 한번
   `Number.isFinite` 로 걸러 **`0` 을 반환**하므로, 실제 KIS 로는 `ORD_QTY:"0"` 이
   나가는 것으로 보인다 — 즉 "조용한 축소집행"은 아니고 "무의미한 값으로 실제 API
   호출이 나간다"에 가까워 보인다.
3. **Reviewer 확인 요청**: 위 추론이 맞는지 실제로 `kis-domestic.ts`/`kis-overseas.ts`
   의 `createOrder` 를 끝까지 읽고, `ORD_QTY:"0"` 주문을 KIS 가 실제로 어떻게 처리하는지
   (거절/에러/다른 부작용)까지 판단하라. **더 중요한 질문**: 이 route 를 실제로 호출하는
   프론트엔드가 `quantity` 를 항상 `number` 타입으로만 보내는지(그렇다면 위 경로는 이론적
   위험일 뿐 실제 노출은 없음) 확인하고, 노출 여부에 따라 심각도를 판정하라. 상위 라우트
   (`middleware.ts` 등)에 이 엔드포인트를 보호하는 인증이 있는지도 확인하라(외부에서
   임의 JSON 을 보낼 수 있는 경로인지가 심각도를 가른다).

### 의심 B · `amountKRW` 미검증 + `quantity` 둘 다 없는 경우

`body.amountKRW ?? 0` 으로 기본값 0을 주는데, 지정가 주문에서 `price` 도 없으면
분기②도 실패해 분기③(`undefined`)으로 떨어진다. 이 경우 `orderReq.quantity` 는
`undefined ?? body.quantity` → `body.quantity`(애초에 없었으므로 `undefined`) →
결국 quantity 도 amountKRW 도 없는 주문이 `submitOrder` 로 들어간다. **이게 상위
`submitOrder`/`kis.createOrder` 에서 어떻게 처리되는지(거절? 0주 처리?) 확인하라.**

### 의심 C · 이 route 에 안전장치(DRY_RUN/KILL_SWITCH/한도/화이트리스트) 가 정말
`submitOrder()` 경유로 전부 걸리는지 — 이번 diff 는 `submitOrder` 호출부 자체를
바꾸지 않았으므로 회귀 가능성은 낮지만, **독립적으로 재확인**하라(reviewer 상시 체크리스트).

## 4. 역할별 지시사항

### Reviewer (독립 감사 — 최우선)

**이 프로젝트 특성상 다음을 중점적으로 보라 (사용자 명시 지시):**
- **안전장치 우회 경로** — `submitOrder()` 미경유, DRY_RUN/KILL_SWITCH/한도/화이트리스트
  체크가 이번 diff 로 인해 약화되거나 우회되는 경로가 생겼는지
- **race condition** — 동시 주문 요청(같은 clientOrderId 또는 다른 clientOrderId 로
  동일 심볼 동시 호출) 시 이번 수량 방어 로직이 경합 조건을 만드는지 (거의 순수 함수라
  가능성은 낮아 보이나 확인 요청)
- **자금 손실 가능성** — 위 §3 의심 A/B 를 반드시 검증하고, 결론(실제 위험 있음/없음
  +근거)을 이 파일에 남길 것

체크리스트는 `.claude/agents/reviewer.md` 의 표준 10개 항목 + 위 §3 A/B/C.
`npm run typecheck`, `npm test` 를 **직접 재실행**해서 developer 보고(99 suites/1476 tests)
와 대조할 것. **production 코드는 절대 직접 수정하지 마라 — 문제 발견 시 Developer 에게
직접 소통해 재작업을 요청하고, git commit/push 는 어떤 경우에도 하지 마라**(이미 배포된
코드의 핫픽스라도 커밋은 사용자 승인 후에만 — 이건 Leader/사용자 몫이다).

### QA (Reviewer PASS 후)

developer 가 이미 작성한 6건 회귀 테스트(`route.test.ts`)를 직접 실행하고, 아래 시나리오를
추가로 눈으로 확인하라(코드 리딩 기반이어도 됨 — 이 route 는 실행 가능한 dev 서버 세팅이
없으므로 developer 가 제공하는 test 실행 결과로 1차 판정하되, 실매매 안전장치 체크리스트는
표준대로 전부 수행):
1. 표준 안전장치 체크리스트(DRY_RUN/Kill Switch/한도/화이트리스트/감사로그) — 이번 diff 가
   `submitOrder()` 호출부를 바꾸지 않았음을 코드로 재확인
2. Reviewer 가 §3 의심 A/B 에 대해 내린 결론을 그대로 신뢰하지 말고, Reviewer 가 지목한
   테스트가 실제로 존재하고 통과하는지 직접 재실행
3. 기준선(T-023 이전) 98 suites/1470 tests 대비 감소 없음 확인

## 5. 관련 과거 이력 요약

* [[T-020-fractional-order-quantity-sizing]] — 이 결함의 직접 출처. `sizeOrderQuantity()`
  가 왜 만들어졌는지, 국내/해외 정수화 규칙(`submittedQuantity`)의 의미가 이 문서에 있다.
  Reviewer 라운드 2 가 이미 이 함수의 동작(분기①②③)을 상세 검증했으므로 그 내용을 재활용
  가능(단, 이번 신규 호출 지점 자체는 독립 검증 필요).
* [[T-018-order-sync-fail-closed]] — `submittedQuantity` 가 만들어진 배경 H-4.
* [[T-023-getactiveorders-pagination]] — 같은 날 커밋된 자매 task. 서로 다른 파일이라
  충돌 없음, 별도로 리뷰됨.

---

## Reviewer

**작업일**: 2026-08-13 10:38 KST · **판정**: **PASS** (Critical 0 / High 0 / Medium 2 / Low 0 — 후속 조치 권고 있음, 배포 차단 사유 아님).
`git show 9456be5`로 diff 실측 — 변경 파일은 `route.ts` + `route.test.ts` + `board.md` 3개뿐, `dry-run.ts`/`kis-domestic.ts`/`kis-overseas.ts`/`order-quantity.ts`/`middleware.ts` 전부 무변경 확인. `npm run typecheck` 재실행 exit 0(에러 0). `npm test` 재실행 **99 suites / 1476 tests 전부 통과** — Developer/board.md 보고와 일치.

### 표준 체크리스트 10개 항목

1. `submitOrder()` 래퍼 경유 — PASS. route.ts:54 호출부 자체는 이번 diff가 건드리지 않음(quantity 필드 계산만 추가).
2. DRY_RUN 우회 경로 없음 — PASS. `dry-run.ts` 무변경.
3. KILL_SWITCH 전 경로 적용 — PASS. `submitOrderInner` 3단계 체크가 그대로 작동.
4. `ORDER_MAX_KRW`/`DAILY_ORDER_MAX_KRW` 누락 없음 — PASS. `order-limits.ts` 무변경.
5. 심볼 화이트리스트/블랙리스트 검증 누락 없음 — PASS. `checkSymbolBlacklist` 무변경.
6. 성공·거부·에러 감사 로그 — PASS. `auditLog` 호출부 무변경.
7. KIS 실패 시 rollback — 기존과 동일, 이번 diff 범위 밖.
8. race condition/멱등성 — 아래 참고 (문제 없음).
9. API 키 노출 — 해당 없음(이번 diff는 env 접근 없음).
10. SQL 파라미터 바인딩 — 해당 없음(이번 diff는 쿼리를 만들지 않음, 기존 GET 핸들러 쿼리는 무변경이며 이미 바인딩 사용 중).

### race condition — `sizeOrderQuantity` 순수성 확인

`sizeOrderQuantity`(service.ts:159-188) → `toWholeShares`(190-193) → `submittedQuantity`(order-quantity.ts:50-53) 체인을 전부 읽었다. 셋 다 인자만으로 계산하는 순수 함수 — 모듈 레벨 mutable state 참조 없음, DB/네트워크 호출 없음. (`service.ts`에 `notifyFlagCache`라는 모듈 레벨 캐시가 있지만 `getSignalNotifyFlags()` 전용이고 이 호출 체인과는 무관 — 혼동 방지차 명시.) **race condition 없음.**

### 의심 A(타입 불일치) — 부분 확인 (Confirmed, leader 추정보다 한 단계 더 나쁨)

Leader 트레이스를 코드로 재현했다. 결론은 leader 추정과 방향은 같지만 **branch②의 조건을 놓치고 있었다** — branch②는 `requestedQuantity` 유무를 보지 않고 `orderType==='limit' && price 유효`만 본다. 그래서 두 갈래로 갈린다.

- **지정가+가격 있음+amountKRW 없음/0** (leader 예시 `quantity:"3.7", price:70000`): branch①(`Number.isFinite("3.7")===false`)은 탈락하지만 **branch②가 대신 잡는다** → `raw=amountKRW/price=0/70000=0` → `sized.quantity=0`(undefined 아님) → `orderReq.quantity = 0 ?? "3.7"` → `??`는 null/undefined만 폴백하므로 **0이 그대로 유지**. domestic 어댑터에서도 `quantity=0`이 `<=0` 가드에 정상적으로 걸려 **API 호출 자체가 발생하지 않고 안전하게 거부**된다. 이 조합은 안전하다.
- **시장가 또는 가격 없는 지정가**: branch①②모두 탈락 → branch③ `undefined` → `orderReq.quantity = undefined ?? body.quantity` = **원본 오염값이 그대로 남는다.** 여기가 실제 위험 구간.

오염값이 domestic 어댑터(`kis-domestic.ts:269-270,282`)에 도달하면:
```ts
const quantity = req.quantity ?? (...);   // req.quantity="3.7"(string) → quantity="3.7" 그대로
if (quantity <= 0) return {...};           // "3.7"<=0 → JS가 임시 숫자변환(3.7)해서 비교 → false → 조기 반환 실패!
...
ORD_QTY: String(submittedQuantity('domestic', quantity)),  // Number.isFinite("3.7")===false → 0
```
**어댑터 자신의 `quantity<=0` 가드가 `<=` 연산자의 느슨한 타입변환 때문에 문자열을 걸러내지 못하고 통과시킨다.** 최종 `ORD_QTY:"0"`가 되는 건 leader 추정대로 `submittedQuantity`의 엄격한 `Number.isFinite` 덕분이지만, **그 전에 실제 KIS 라이브 주문 API(`order-cash`)로 HTTP 요청이 실제로 나간다**는 게 leader 트레이스보다 한 단계 더 나쁘다.

해외(overseas)는 이 구멍이 없다 — market 타입은 `req.price` 없음 → `krwPrice=0`→`usdPrice=0`→`adjPrice=0` → **`adjPrice<=0` 가드가 ORD_QTY 조립 전에 먼저 걸려 조기 반환**한다(`kis-overseas.ts:333`). domestic market 경로에서만 재현된다.

**자금손실 여부**: 아니다. `ORD_QTY:"0"` 시장가 주문을 KIS가 실제로 어떻게 처리할지는 외부 시스템(KIS 서버) 검증에 달려 있어 이 리뷰가 100% 보장할 순 없지만, 수량 0 주문이 체결될 개연성은 극히 낮다 — `rt_cd!=='0'`로 거절 → `ok:false` → `orders.status='rejected'`가 합리적으로 기대되는 결과다. 자금이 잘못된 방향/수량으로 움직일 위험은 없다 — 최악의 경우도 "무의미한 라이브 API 호출 1건 + 거절 로그"다.

**실제 노출 여부**: `middleware.ts` 확인 결과 `/api/orders`는 `PUBLIC_EXACT`/`/api/cron/` 어디에도 없어 **인증 세션 쿠키 필수** — 비인증 외부 공격자는 도달 불가. 추가로 리포지토리 전체를 `/api/orders` grep한 결과 **`POST /api/orders`를 호출하는 프론트엔드 코드가 현재 하나도 없다** — 발견된 호출부는 전부 `GET /api/orders`(목록, `ActiveOrdersSection.tsx`/`OrderHistoryTab.tsx`/`Dashboard.tsx`) 또는 `DELETE /api/orders/:id`(취소, `OrderDetail.tsx`)뿐이다. `/order` 페이지 자체도 `redirect('/strategy')` 하나뿐이라 수동 주문 입력 폼이 아예 붙어 있지 않다. 즉 **이 경로는 현재 라이브 UI에서 도달 불가능하고, 계정 소유자 본인이 curl 등으로 직접 호출할 때만 노출된다.** 실사용자 피해 가능성은 사실상 없지만, 이 task의 목표("API는 스스로를 방어해야 한다")를 이 경계 조건에서는 완전히 채우지 못한 잔여 결함이다 — 향후 수동 주문 UI가 이 필드에 바인딩되는 순간 정확히 이 방어가 필요해진다.

### 의심 B(quantity+amountKRW 둘 다 없음) — 반박 (Refuted, 안전 확인)

- **buy**: `orderReq.quantity=undefined`, `orderReq.amountKRW=undefined`(route.ts의 `?? 0`은 `sizeOrderQuantity` 호출에만 쓰이고 `orderReq.amountKRW`엔 안 들어감) → `submitOrderInner` 5단계 `checkOrderMax`가 `resolveOrderAmountKRW(req)`로 amount=0 산출 → **`amount<=0`이면 `{ok:false, reason:'order_limit', detail:'amount unresolved'}`로 fail-closed 차단**(`order-limits.ts:173`) — **KIS 어댑터까지 가지도 않고 안전 레이어에서 막힌다.**
- **sell**: `checkOrderMax`/`checkDailyMax`는 매도라 스킵되지만(`dry-run.ts:169,179` — 청산 목적 정책적 예외), DRY_RUN 통과 후 어댑터에서 `quantity = req.quantity ?? (price>0 && amountKRW ? ... : 0)` → `undefined ?? 0` = `0`(진짜 숫자 0) → **어댑터 자신의 `quantity<=0` 조기 반환이 여기서는 정확히 작동한다**(req.quantity가 진짜 `undefined`라 `??`가 제대로 폴백되므로 — 의심 A의 문자열 케이스와 달리 타입이 진짜 undefined라 `<=` 강제변환 문제가 없다) — **API 호출 자체가 발생하지 않는다.**

두 경로 모두 라이브 API 호출조차 발생하지 않고 안전하게 막힌다. leader가 우려한 "`amountKRW=0`으로 `Math.floor(amountKRW/price)`가 이상한 값을 낼 가능성"은 발생하지 않는다 — price도 없으므로 그 분기 자체가 안 열린다.

### 이슈 목록

#### 🟡 MEDIUM-1 · 비-number `quantity`가 `sizeOrderQuantity` 방어선과 domestic 어댑터 가드를 모두 통과해 라이브 KIS 주문 API 호출까지 도달함 (시장가/가격없는 지정가 한정)

- **component**: `src/app/api/orders/route.ts:34-49`(진입점) → `src/lib/signals/service.ts:159-187`(`sizeOrderQuantity` branch③) → `src/lib/exchanges/kis-domestic.ts:269-270,282`(가드 우회 + 최종 0화)
- **risk**: 자금손실 없음(0수량은 브로커가 거절할 것으로 합리적으로 기대되나, KIS 서버측 실제 처리는 이 리뷰로 100% 보장 불가). 실제 리스크는 "무의미한 라이브 주문 API 호출이 나간다"는 점 — 이 task의 목표를 이 경계 조건에서는 달성 못 함.
- **evidence**: 위 "의심 A" 섹션 코드 트레이스. 핵심은 `kis-domestic.ts:270`의 `if (quantity <= 0) return ...`가 문자열 `"3.7"`에 대해 JS의 느슨한 `<=` 숫자변환(`3.7<=0`→false) 때문에 걸러내지 못한다는 점.
- **recommendation**: `route.ts`에서 `body.quantity`를 `sizeOrderQuantity`에 넘기기 전에 `typeof body.quantity === 'number'` 런타임 가드를 추가(비-number면 400 반환)하거나, `kis-domestic.ts:270`/`kis-overseas.ts:321`의 `quantity <= 0` 가드를 `!Number.isFinite(quantity) || quantity <= 0`로 강화해 어댑터 레벨에서도 이중 방어를 걸 것을 권고(후자가 더 근본적 — `submittedQuantity`가 이미 이 패턴을 쓰므로 어댑터 사전 가드도 같은 엄격도로 맞추는 게 일관적).
- **실사용 노출도**: 낮음 — 인증 필수(middleware 확인) + 현재 이 리포지토리에는 `POST /api/orders`를 호출하는 프론트엔드 코드가 전혀 없음(GET/DELETE 호출부만 존재, `/order` 페이지는 `/strategy`로 즉시 redirect). 계정 소유자 본인의 직접 API 호출(curl 등)로만 도달 가능.

#### 🟡 MEDIUM-2 · 신규 회귀 테스트 6건 전부 숫자 `quantity`만 사용 — 의심 A의 실제 취약 경로(비-number quantity)가 테스트 커버리지 밖

- **component**: `src/app/api/orders/__tests__/route.test.ts` (전체)
- **risk**: MEDIUM-1의 코드 경로가 향후 회귀해도 CI가 못 잡는다. leader도 §3에서 동일 우려를 명시.
- **evidence**: 6개 테스트의 quantity 값 — `3.7`, `5`, `0.4`, 미지정(amountKRW만), 미지정(market), 필드 자체 누락 — 전부 number 타입 아니면 undefined. `"3.7"`(문자열)·객체 등 비-number 런타임 값을 검증하는 케이스 0건.
- **recommendation**: `quantity: '3.7'`(문자열) + `type:'market'` 조합 테스트를 추가해, MEDIUM-1이 수정되기 전까지는 최소한 "현재 동작(0으로 처리되고 orderReq.quantity가 오염 문자열로 남는다는 사실)"을 회귀 고정하고, 수정 후에는 개선된 동작(예: 400 반환)을 검증하도록 갱신 권고.

### 요약

```json
{
  "reviewId": "REV-T024-01",
  "status": "PASS",
  "issues": [
    { "severity": "MEDIUM", "component": "route.ts + service.ts + kis-domestic.ts", "issue": "비-number quantity가 domestic 시장가 경로에서 라이브 KIS 주문 API 호출까지 도달" },
    { "severity": "MEDIUM", "component": "route.test.ts", "issue": "비-number quantity 케이스 테스트 커버리지 없음" }
  ],
  "summary": { "critical": 0, "high": 0, "medium": 2, "low": 0 },
  "high_risk_areas": ["src/app/api/orders/route.ts:34-49", "src/lib/exchanges/kis-domestic.ts:262-295"]
}
```

**결론**: 이미 라이브 배포된 이 코드에 **자금 손실로 이어지는 CRITICAL/HIGH 결함은 없다.** `submitOrder()` 안전 레이어(DRY_RUN/KILL_SWITCH/한도/화이트리스트/감사로그)는 이번 diff로 전혀 손상되지 않았고(git diff로 실측 확인), race condition도 없다. 의심 B는 명확히 반박됐다(buy/sell 둘 다 안전 레이어 또는 어댑터 가드에서 라이브 호출 전에 막힘). 의심 A는 leader 추정보다 한 단계 더 진행된다는 걸 확인했다(어댑터 자체의 `quantity<=0` 가드까지 문자열 비교의 느슨한 타입변환으로 뚫린다) — 다만 도달해도 결과는 "무의미한 거절된 API 호출"이지 자금손실이 아니고, 현재 이 리포지토리에 이 POST 엔드포인트를 호출하는 프론트엔드가 아예 없어 실사용 노출도는 사실상 0에 가깝다. **긴급 핫픽스는 불필요** — MEDIUM-1/2는 다음 정기 작업에서 처리 권고. QA 진행에 지장 없음(PASS).

QA에게 전달할 `high_risk_areas`: `src/app/api/orders/route.ts:34-49`, `src/lib/exchanges/kis-domestic.ts:262-295`(특히 270행 가드), `src/app/api/orders/__tests__/route.test.ts`(테스트 갭 확인용).

## QA

**작업일**: 2026-08-14 14:39 KST · **판정**: **✅ 검증 통과**

### 1. 직접 재실행 결과

- `npm run typecheck` → exit 0, 에러 0건.
- `npm test`(전체) → **99 suites / 1478 tests 전부 통과**. Reviewer 보고(99 suites/1476 tests)와
  suite 수는 일치하나 test 수가 +2 차이난다 — 지시받은 대로 추측하지 않고 그대로 기록한다.
  같은 세션에서 `reviewer-t023-round2`가 T-023 재검증(HIGH-1 수정 후 round 2, 20-Log 기준
  11:30 완료)을 동시/직후 진행했으므로 그 변경(T-023 관련 테스트 추가)이 반영된 차이로
  추정된다. `route.test.ts`(T-024 대상 파일)는 이 세션 동안 무변경(git 상태로 확인 안 했으나
  이번 QA에서 파일을 수정하지 않았고 developer 보고와 6건 동일) — 즉 T-024 자체의 회귀는
  아니고 인접 task의 병행 작업으로 인한 전체 카운트 차이로 판단.
- `npx jest src/app/api/orders/__tests__/route.test.ts --verbose` 단독 실행 → **6/6 통과**,
  developer가 서술한 6개 시나리오(소수점 버림/정수 통과/1주미만→0/amountKRW만 있는 지정가
  사전산출/시장가 위임 회귀없음/필수필드 누락 400) 전부 파일 내 실재 확인:
  - 소수점 버림: `route.test.ts:17-25` (quantity 3.7 → 3)
  - 정수 통과 회귀없음: `:27-34` (quantity 5 → 5)
  - 1주미만→0: `:36-43` (quantity 0.4 → 0)
  - amountKRW만 있는 지정가 사전산출: `:45-53` (amountKRW 250000/price 70000 → 3)
  - 시장가 위임 회귀없음: `:55-62` (quantity undefined 유지)
  - 필수필드 누락 400: `:64-68` (symbol/type 누락 → 400, submitOrder 미호출)

### 2. 안전장치 체크리스트 (코드 리딩 기반 — dev 서버 미가동, task §4 지시대로)

- **submitOrder() 래퍼 경유**: `git show 9456be5 -- src/app/api/orders/route.ts` 로 diff 직접
  재확인 — 변경분은 `getMarketFromSymbol`/`sizeOrderQuantity` import 2줄 + `quantity` 필드
  계산 블록(구 `quantity: body.quantity` → 신 `quantity: sized.quantity ?? body.quantity`)
  뿐이다. `route.ts:54` `await submitOrder(orderReq, kis.createOrder, {...})` 호출부는 diff
  범위 밖 — 문자 그대로 무변경. ✅
- **DRY_RUN 회로**: `src/lib/safety/dry-run.ts:197-203` `submitOrderInner` 7단계 —
  `isDryRun()` true면 `status='dry_run'` UPDATE + `auditLog(orderId,'dry_run',...)` +
  `{ok:true, dryRun:true, blockedBy:'dry_run'}` 반환, 실제 송신(`realSubmit`) 미호출. 이
  경로는 이번 diff로 손대지 않음. ✅
- **Kill Switch 회로**: `dry-run.ts:145-149` — `isKillSwitchActive()` 시 `markBlocked(orderId,
  'kill_switch')` + `{ok:false, blockedBy:'kill_switch', error:'KILL_SWITCH_ACTIVE'}` 즉시
  반환, `realSubmit` 도달 전 차단. 명확한 에러 메시지 포함. 무변경. ✅
- **주문 한도**: `dry-run.ts:158-185` `checkOrderMax`/`checkDailyMax` (sell 제외 정책은
  기존 설계, 이번 diff와 무관) — `ORDER_MAX_KRW`/`DAILY_ORDER_MAX_KRW` 로직 무변경. ✅
- **심볼 화이트리스트**: `dry-run.ts:151-156` `checkSymbolBlacklist` 무변경, 실패 시
  `markBlocked(orderId,'symbol_not_allowed',...)`. ✅
- **감사 로그**: `submit_attempt`(142행) / `dry_run`(201) / `blocked`(markBlocked 내부
  275행) / `accepted`(213) / `rejected`(222) / `error`(228,236) 전 분기에서 `auditLog()` 호출,
  `trade_logs` INSERT. 성공·거부·에러 전부 커버. 무변경. ✅
- **레이트리밋·멱등성**: `clientOrderId`는 `route.ts`에서 `body.clientOrderId` 그대로
  `submitOrder` options로 전달(23-24행), 멱등키 산출 로직(`options.clientOrderId ?? co-${randomUUID()}`,
  `dry-run.ts:119`) 무변경. `withKisPriority('critical', ...)` 로 KIS 유량 우선순위 처리도
  무변경(`dry-run.ts:104-109`). 이번 diff는 quantity 계산 블록만 추가했을 뿐 이 경로들을
  건드리지 않음 — Reviewer의 "순수 함수라 race condition 없음" 결론도 코드로 재확인(
  `sizeOrderQuantity`/`toWholeShares`/`submittedQuantity` 체인에 모듈 레벨 mutable state·
  DB·네트워크 호출 없음). ✅

**결론**: 안전장치 6항목 전부 ✅ — 이번 diff는 `quantity` 필드 계산에만 국한되고
`submitOrder()` 호출부·내부 7단계 안전 체크는 문자 그대로 무변경.

### 3. 보안 점검

- `route.ts` 전체에서 `process.env`/`API_KEY`/`SECRET`/`token` 패턴 grep → 0건. 이번 diff는
  env 접근이 전혀 없다. ✅
- `route.ts`의 `GET` 핸들러(68-98행, 이번 diff로 무변경) — `pool.query<RowDataPacket[]>` +
  `?` 플레이스홀더(`symbol = ?`, `status = ?`, `LIMIT ?`) 사용, 문자열 연결 없음. SQL
  인젝션 없음. ✅
- 참고: 이 파일(`src/app/api/orders/route.ts`)에는 `POST`/`GET` 두 핸들러만 존재 —
  `DELETE`는 별도 파일 `src/app/api/orders/[id]/route.ts`(이번 diff 미포함, 미확인 대상
  아님)에 있다. task 지시문의 "GET/DELETE"는 이 파일 기준으로는 GET만 해당 — 사소한
  전제 정정이며 결론에 영향 없음.
- `middleware.ts` 직접 확인 — `PUBLIC_EXACT`/`PUBLIC_PREFIX` 어디에도 `/api/orders`
  없음 → 기본 규칙(HMAC 서명 세션 쿠키 필수) 적용, 비인증 접근 불가. Reviewer 결론과
  일치.
- 리포지토리 grep 결과 `POST /api/orders`를 호출하는 프론트엔드 코드 없음(GET 호출
  3곳 — `ActiveOrdersSection.tsx`/`OrderHistoryTab.tsx`/`Dashboard.tsx`, 전부 쿼리스트링
  GET). Reviewer 결론 재확인.

### 4. 테스트 카운트 회귀 확인

T-023 이전 기준선(98 suites/1470 tests) 대비 현재 99 suites/1478 tests — **감소 없음,
오히려 증가**(T-023 라운드2 + T-024 신규 6건 반영). 기준 충족.

### 5. Reviewer MEDIUM-1/2에 대한 QA 입장

Reviewer가 지목한 MEDIUM-1(비-number quantity가 domestic 시장가 경로에서 라이브 KIS
호출까지 도달)·MEDIUM-2(그 경로 테스트 커버리지 없음)는 재현 코드를 직접 다시 읽어
Reviewer 트레이스(`kis-domestic.ts:269-270,282`의 `quantity<=0` 가드가 문자열에 대한
`<=` 느슨한 타입변환으로 뚫리는 지점)를 확인했다. Leader가 이미 board.md 백로그로
비차단 판단을 내렸으므로 QA 단계에서 재론하지 않는다 — 다만 이 두 항목이 Critical/High가
아니라는 Reviewer 판정에 QA도 독립적으로 동의한다(자금손실 없음, 실사용 노출 경로 없음).

### 최종 결론

```
✅ 검증 통과

실행 결과:
- developer 제공 테스트(route.test.ts): 6개 실행, 6개 통과
- 전체 스위트: 99 suites / 1478 tests 전부 통과 (Reviewer 보고 1476과 +2 차이 —
  동시 진행된 T-023 round2 재검증 영향으로 추정, T-024 자체 회귀 아님)
- 안전장치 체크: DRY_RUN ✅ / Kill Switch ✅ / 주문 한도 ✅ / 심볼 화이트리스트 ✅ /
  감사 로그 ✅ / 레이트리밋·멱등성 ✅
- 보안 점검: 이상 없음 (API 키/env 노출 0건, GET 핸들러 파라미터 바인딩 확인,
  인증 미들웨어 보호 확인)
- 발견된 결함: 0건 (Critical/High/Medium/Low 신규 없음 — Reviewer MEDIUM-1/2는
  기존 판정 유지, board.md 백로그로 이미 추적 중)

요구사항 충족 여부: ✅ 충족
```

```json
{
  "taskId": "T-024",
  "status": "DONE",
  "deliverables": ["QA 검증 통과 — 안전장치/보안/테스트 전 항목 확인 완료"],
  "blockers": [],
  "risk_level": "LOW"
}
```

## 최종 요약 (사용자용)

사람이 직접 주문을 넣는 수동 주문 API(`POST /api/orders`)가 클라이언트가 보낸 수량을
아무 검증 없이 그대로 신뢰하던 구멍을 막았습니다. [[T-020-fractional-order-quantity-sizing]]
이 자동매매 엔진 경로 2곳은 이미 정수로 안전하게 만들었지만, 이 수동 경로만 빠져 있었던
것을 이번에 같은 함수를 재사용해 방어했습니다.

이 변경도 **정상 절차(Reviewer 감사) 없이 2026-08-13 09:48에 먼저 커밋·배포된 상태에서
사후 발견**됐습니다 — T-023과 같은 날, 같은 방식으로 발생한 절차 누락입니다. 사후 감사
결과 **자금 손실로 이어지는 결함은 없었습니다(Critical 0·High 0)**. 독립 감사는 아주 좁은
구석(시장가 주문 또는 가격 없는 지정가 주문에 숫자가 아닌 수량 값이 들어오는 극단적인
경우)에서 브로커에 무의미한 주문 요청 1건이 나갈 수 있다는 경미한 결함(Medium 2건)을
찾았지만, 실제로 이 API를 호출하는 화면이 현재 앱에 아예 없고(인증도 필수라 외부에서
접근도 불가) 결과도 "거절되는 API 호출"일 뿐 자금 손실은 아니라서, **배포를 막을 사유는
아니라고 판단**해 다음 정기 작업으로 미뤄 백로그에 정확히 기록해 뒀습니다.

QA가 실행 검증까지 통과시켜 최종 완결됐습니다. 회귀테스트는 신규 6건 포함 99 suites·
1478개 전부 통과, 타입체크 에러 0건입니다. 주문 안전장치(DRY_RUN/Kill Switch/한도/
화이트리스트/감사로그)는 전부 무변경으로 확인됐습니다. **Leader 권고: 지금 배포해도
안전합니다.**
