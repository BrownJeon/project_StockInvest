---
task_id: T-028
title: POST /api/signals 수치 필드 런타임 가드 — T-027 잔여분 마감
status: done
roles_involved: [leader, developer, reviewer, qa]
related_tasks: [T-027-nonnumber-quantity-guard, T-024-manual-order-quantity-guard]
tags:
  - type/task
  - domain/safety
  - domain/orders
aliases:
  - 시그널 API 수치 가드
  - signals-api-numeric-guard
created: 2026-08-17
updated: 2026-08-17
---

## 목표 (Leader 작성)

[[T-027-nonnumber-quantity-guard]] 가 `POST /api/orders` 에서 닫은 것과 **같은 패턴**이
`POST /api/signals` 에 남아 있다. 같은 클래스의 마지막 구멍을 닫는다.

## 사전 조사 결과 (Leader, 2026-08-17 코드 실측)

| 위치 | 현재 코드 | 판정 |
|---|---|---|
| `src/app/api/signals/route.ts:15-17` | `price?: number` · `quantity?: number` · `amountKRW: number` | **타입 선언일 뿐 런타임 가드가 아니다** |
| `route.ts:29` | `if (!body.symbol \|\| !body.side \|\| !body.orderType \|\| !body.amountKRW)` | truthiness 뿐. **`NaN` 은 falsy 라 우연히 걸린다**(`!NaN` → true). 그러나 `'abc'` 같은 **truthy 비-number 문자열은 통과** |
| `route.ts:53-55` | `price: body.price, quantity: body.quantity, amountKRW: body.amountKRW` | 원본을 그대로 `createSignal` 로 전달 |

**현재 실피해는 억제돼 있다** — quantity 는 `sizeOrderQuantity` 가 정규화하고, price 는 T-027 이
신설한 어댑터 가드와 한도 fail-closed 가 잡는다. 그래도 **API 경계에서 막는 것이 진단에 유리**하고,
"가드가 있는데 안 걸리는" 상태를 주문 발원 경로에 남기지 않는다는 T-027 의 취지를 완성한다.

## 🟢 Leader 설계 결정 — 400 조기 거절로 간다

Developer 가 T-027 에서 이 건을 미루며 남긴 우려는 *"시그널은 주문 이전에 DB 행이 생기므로 400 을
넣으면 시그널 생성 semantics 가 바뀐다"* 였다. **검토 결과 이 우려는 이 케이스에 해당하지 않는다**:

- semantics 가 바뀐다는 우려는 **유효한 시그널이 거절될 때** 성립한다. 비-number `price` 를 가진
  요청은 애초에 유효한 시그널이 **아니다** — DB 에 남겨 봐야 `NaN` 이 든 행이 생길 뿐이고, 그건
  T-027 이 없앤 문제(무의미한 값이 아래로 흘러가는 것)를 DB 에 재현하는 것이다.
- 같은 라우트가 **이미** `symbol/side/orderType/amountKRW required` 를 행 생성 **이전에** 400 으로
  거절한다. 수치 타입 검증을 같은 자리에 두는 것은 **기존 계약의 연장이지 변경이 아니다.**
- `POST /api/orders`(T-027)와 **동일한 규칙**을 쓰면 두 주문 발원 경로가 같은 계약을 갖는다.

→ **`POST /api/orders` 의 `invalidNumericField()` 와 같은 방식**으로 `price`·`quantity`·`amountKRW`
에 런타임 타입 가드를 넣고 400 으로 거절한다. `null`·`undefined` 는 "미지정"이므로 통과시킨다
(단 `amountKRW` 는 기존 required 검사가 별도로 잡는다).

## Leader 지시사항 (역할별)

### Developer

1. `src/app/api/signals/route.ts` 에 수치 타입 가드 신설 → 비-number 는 **400**.
   **T-027 이 `POST /api/orders` 에 만든 `invalidNumericField()` 를 재사용하거나 공용 모듈로
   추출하라** — 같은 규칙을 두 곳에 복붙하면 한쪽만 바뀌는 상태가 다시 결함의 구조가 된다
   (T-027 이 `unusableQuantityReason()` 으로 두 어댑터를 묶은 것과 같은 취지).
2. 400 은 `signals` 행 생성 이전이라 감사 로그에 안 남는다 — T-027 과 동일하게 `console.warn`
   한 줄로 흔적을 남겨라(흔적 없는 거절을 만들지 않는다).
3. **같은 클래스의 다른 진입점이 더 있는지 직접 조사하라** — `createSignal` 을 호출하는 모든 경로,
   그리고 `signals` 계열 다른 라우트(`custom`, `[id]/approve` 등)의 수치 필드 처리. 발견 시 이번에
   포함할지 판단하고 근거를 남겨라.

**금지**: 안전장치 우회·완화. `submitOrder()` 경유 원칙 훼손. 신규 npm 의존성.

### Reviewer

- **과도차단 검증(최우선)** — 정상 시그널 생성이 막히지 않는지. 특히 mysql2 DECIMAL 문자열이
  이 경로로 들어올 여지가 있는지(T-027 에서 `'70000'` 이 정상 값이었던 전례). 이 경로의 호출자를
  전수 확인하라 — 프론트엔드·cron·내부 코드 어디서 호출하는지
- 공용화한 가드가 `POST /api/orders` 의 기존 동작을 바꾸지 않는지(회귀)
- Developer 의 진입점 조사가 실제로 전수인지

### QA

- 정상 시그널 생성이 **여전히 통과**하는지 (최우선 — 회귀가 최대 위험)
- 비-number `price`/`quantity`/`amountKRW` × 시장가/지정가 → 400
- `null`·`undefined` 미지정이 기존대로 통과하는지
- `POST /api/orders` 회귀 0건 (가드 공용화의 부작용)
- 전체 스위트 회귀 0건 — 기준선 **102 suites / 1660 tests**

## Developer 기록

- [23:07] **Leader 의 400 조기 거절 결정에 동의한다 — 반론 없음.** 내가 T-027 에서 남긴 우려
  ("주문 이전에 DB 행이 생기므로 semantics 가 바뀐다")는 **유효한 시그널이 거절될 때** 성립하는데,
  아래 [23:07] 호출자 전수조사 결과 **이 경계로 유효한 비-number 가 들어올 사유가 실재하지 않음**을
  확인했다. Leader 논거대로 기존 required 400 의 연장으로 구현했다.

- [23:07] 🔴 **가장 중요한 실측 — mysql2 DECIMAL 문자열은 이 경계로 들어올 수 없다.**
  T-027 이 `api/orders/route.ts` 주석에 *"DB 경유 경로(`POST /api/signals`·entry-watcher)"* 라고
  적어 둔 문장이 **부정확**했다. 실제로 확인한 것:
  | 경로 | 실측 | 판정 |
  |---|---|---|
  | `POST /api/signals` | HTTP JSON 본문만 읽는다. DB row 를 읽지 않는다 | **DB 경유 경로가 아니다** |
  | `approveSignal` (`service.ts:527`) | `price: row.price != null ? Number(row.price) : undefined` | **자기 쪽에서 이미 `Number()` 변환** |
  | `entry-watcher` (`route.ts:233,248,249`) | `Number(row.price)` · `Number(row.quantity)` · `Number(row.amount_krw)` | **자기 쪽에서 이미 `Number()` 변환** |
  즉 DECIMAL 문자열을 다루는 두 경로는 **이 라우트 핸들러를 통과하지 않고**, 통과한다 해도 자기
  쪽에서 이미 숫자로 바꾼다. **엄격 가드가 DECIMAL 경로를 끊을 물리적 경로가 없다.**
  (참고: `service.ts:80` 의 row 타입이 `price: string | null` 로 DECIMAL-as-string 을 명시하고 있다.)

- [23:07] **호출자 전수조사 — `POST /api/signals`(bare) 의 리포 내 호출자는 0건.**
  `grep -rn "api/signals"` 를 `.ts/.tsx` + `.sh/.mjs/.js/.json/.md/.yml/.yaml` 전체에 실행.
  프론트엔드 히트 14곳은 **전부 `GET`**(`fetch('/api/signals?...')`), POST 는 서브라우트
  3곳뿐(`/[id]/approve`, `/[id]/reject`, `/custom`, `/custom/confirm`). 코드 밖 히트는 agent-vault
  문서뿐. → **끊길 정상 트래픽이 없다.** 도달 가능한 것은 계정 소유자의 직접 curl 뿐이고, 그마저
  `middleware.ts` 세션 인증 뒤에 있다. `POST /api/orders` 와 동일한 전제이며 근거도 동일하다.

- [23:07] **변경 파일 3개 (+1 신규 테스트)**
  1. `src/lib/safety/numeric-fields.ts` **신규** — 가드 공용 모듈.
     `ORDER_NUMERIC_FIELDS` / `invalidNumericField()` / `numericFieldError()` /
     `warnNumericFieldRejected()`. T-027 의 규칙 본문과 근거 주석을 여기로 이관.
  2. `src/app/api/orders/route.ts` — 로컬 `NUMERIC_FIELDS`·`invalidNumericField()` 삭제 →
     공용 모듈 import. **동작 무변경**(아래 [23:07] 회귀 확인).
  3. `src/app/api/signals/route.ts` — required 400 **직후**에 가드 삽입 (지시 2 준수: 기존
     `symbol/side/orderType/amountKRW required` 문구·순서 불변). `console.warn` 1줄(지시 3).
  4. `src/app/api/signals/__tests__/route.test.ts` **신규** — 57 tests.

- [23:07] **설계 판단 — 가드를 개장(409) 검사 *앞*에 두었다.** `POST /api/orders` 와 같은 자리
  (required 직후)다. 폐장 중에 비-number 를 보내면 409 대신 400 이 나가는데, 이는 **무효 입력에
  한정**되고 "무엇이 잘못됐는지"가 "언제인지"보다 진단에 유용하다. 유효 본문의 409 는 그대로임을
  테스트로 고정(`폐장 409 는 유효한 본문에 대해 그대로 유지된다`).

- [23:07] **설계 판단 — `console.warn` 포매터까지 공용화했다.** 규칙만 공용화하고 로그를 복붙하면
  같은 divergence 가 로그 쪽에 생긴다. `warnNumericFieldRejected(routeTag, field, body)` 가
  routeTag 만 받아 **기존 orders 문구를 바이트 동일**하게 재현한다 — 실행 로그로 확인:
  `[api/orders POST] 비-number quantity 거절 — symbol=005930 type=string value="3.7"`.
  (`JSON.stringify` 실패는 삼켜 `<직렬화 불가>` 로 대체 — 로깅이 요청을 죽이지 않게.)

- [23:07] ⚠️ **지시 4 — 같은 클래스의 다른 진입점 조사 결과 (숨기지 않고 전부 보고)**
  | 진입점 | 수치 필드 처리 | 이번 포함 여부 |
  |---|---|---|
  | `POST /api/analyst/run` (`createSignal` 호출) | **본문 수치 입력 없음.** `amountKRW` 는 `getEffectiveOrderMax()`, price 는 KIS ticker — 전부 내부 산출. 게다가 `Number.isFinite(baseAmountKRW)` fail-closed 가 이미 있다 | **불필요** (구멍 아님) |
  | `engine.ts` → `createSignalGuarded` | 내부 전략 산출값만. 외부 입력 없음 | **불필요** |
  | `POST /api/signals/[id]/approve` · `/reject` | 수치 본문 없음. id 는 이미 `Number.isFinite` 검사 | **불필요** |
  | `POST /api/signals/custom` | DB 저장 없음(분석 결과만 반환). `currentPrice`·`splits` 무검증이나 주문 발원 아님 | **불필요** |
  | 🟠 `POST /api/signals/custom/confirm` | **같은 클래스의 실제 잔여 구멍.** `createSignal` 을 **경유하지 않고** `signals` 에 직접 INSERT 하며 `status='approved_pending_entry'` → entry-watcher 가 실주문을 낸다. `manualSlices[].zoneLo/zoneHi/qty`·`currentPrice`·`holdingQty`·`splits` 무검증 — 문자열이면 `(s.zoneLo + s.zoneHi)/2` 가 **문자열 연결 후 나눗셈**(`'1'+'2'='12'`)으로 엉뚱한 값, `s.qty * priceMid` 는 NaN | **이번 제외 — 아래 근거** |

  **`custom/confirm` 을 이번에 넣지 않은 근거 3가지**:
  (a) **필드 shape 이 다르다** — `price/quantity/amountKRW` 가 아니라 `manualSlices[]` 배열 원소와
      zone 문자열 파싱이 얽혀 있어, 이번 공용 가드를 그대로 붙일 수 없고 별도 규칙 설계가 필요하다.
  (b) **`createSignal` 호출 경로가 아니다** — Leader 가 지정한 조사 축(`createSignal` 호출 경로 +
      `POST /api/signals`) 밖이고, 이번 가드가 그 라우트를 지나지도 않는다.
  (c) 🔴 **과도차단 위험이 이번 건과 질적으로 다르다** — bare `POST /api/signals` 는 호출자가
      **0건**이지만 `custom/confirm` 은 **실제 UI 호출자가 2곳**(`recommend/build/page.tsx:89`,
      `ScenarioDetail.tsx:288`)이다. 둘 다 `Number(s.zoneLo)` 로 변환해 보내는 것은 확인했으나,
      `currentPrice`·`splits`·`holdingQty` 는 `Number()` 미적용 state 직송이라 **잘못 막으면 살아 있는
      진입감시 등록 UI 를 끊는다.** 실계좌 운용 중이므로 별도 task 로 과도차단 분석을 따로 해야 한다.
  → **Leader 판단 요청**: 별도 task(T-029?)로 올릴지. 실피해는 현재 억제돼 있다(UI 가 `Number()`
     변환, 외부 curl 만이 도달 경로).

- [23:07] **테스트 결과 — 있는 그대로**
  - 기준선(변경 전 실측): `npx jest` → **102 suites / 1660 tests, 전부 pass**. Leader 제시 수치와 일치.
  - 변경 후: `npx jest` → **103 suites / 1717 tests, 전부 pass** (`Test Suites: 103 passed, 103 total`
    / `Tests: 1717 passed, 1717 total`). **+1 suite / +57 tests, 회귀 0건, 실패 0건.**
  - `POST /api/orders` 회귀: 기존 `src/app/api/orders/__tests__/route.test.ts` **무수정 전량 pass**
    (가드 공용화 부작용 0건). orders+signals 두 suite 합계 100 tests pass.
  - `npm run typecheck` → **에러 0** (출력 없음).
  - 신규 테스트가 고정한 것: 과도차단 회귀 방지 8케이스(지정가/시장가/해외/매도/정상 quantity 4종/
    null 미지정/필드 생략) · 비-number × {price,quantity,amountKRW} × {limit,market} × 6종 = 36케이스 ·
    매도 400 · console.warn 흔적 · NaN/Infinity 는 JSON 직렬화로 null 이 되어 도달 불가(사실 고정) ·
    기존 게이트 6종(required 문구·amountKRW=0·403 엔진비활성·409 폐장·400 우선순위·500 분류).

- [23:07] **안전장치 self-check** — 이번 변경은 **거절 방향으로만** 동작하며 주문 송신 경로를 새로
  열지 않는다. `submitOrder()` 경유 원칙 무훼손(`grep` 결과 이번 변경 파일에 `createOrder` 직접
  호출 0건). DRY_RUN·KILL_SWITCH·ORDER_MAX·ALLOWED_SYMBOLS 로직 **무변경**. 감사 로그: 400 은
  `signals` 행 생성 이전이라 DB 기록 없음 → `console.warn` 으로 대체(지시 3, 테스트로 고정).
  신규 npm 의존성 0. **git commit/push 안 함 — HEAD `c2533aa` 유지 확인.**

- [23:07] 🔴 **Reviewer 판단 요청 4건**
  1. **과도차단 최종 확인** — 위 [23:07] "mysql2 DECIMAL" 실측(`approveSignal`·entry-watcher 가
     자기 쪽에서 `Number()` 변환)과 "호출자 0건" 조사를 **독립적으로 재현**해 달라. 이 두 전제가
     이번 변경의 안전성 전부를 떠받친다. 하나라도 틀리면 실거래가 끊긴다.
  2. **T-027 주석의 부정확한 서술을 이번에 고친 것** — `api/orders/route.ts` 의
     *"DB 경유 경로(`POST /api/signals`·entry-watcher)"* 표현을 공용 모듈 주석에서 실측 기반으로
     교정했다(`POST /api/signals` 는 DB 경유가 아니며, entry-watcher 는 자기 쪽에서 변환). 이
     교정이 맞는지 확인 바란다.
  3. **가드를 409 개장 검사 앞에 둔 순서 판단**이 적절한지.
  4. **`custom/confirm` 제외 판단**(위 근거 (a)(b)(c))이 타당한지. 범위 확대가 옳다고 보면
     Reviewer 의견을 받아 이번에 포함할 수 있다.

## Reviewer 기록

- [23:15] **과도차단 최종 확인 — Developer 의 두 전제를 독립 재현했다. 둘 다 사실이다.**
  (1) mysql2 DECIMAL: `docs/db-schema.md` 에서 `signals.price DECIMAL(36,8)` · `quantity DECIMAL(36,18)`
  확인, `src/lib/db.ts` 의 `createPool()` 에 `decimalNumbers` 옵션 없음(mysql2 기본값 = 문자열 반환).
  `service.ts:527-529`(`approveSignal`)와 `entry-watcher/route.ts:233,248,249` 를 직접 읽어
  `Number(row.price)`/`Number(row.quantity)`/`Number(row.amount_krw)` 자기 쪽 변환을 확인했고,
  두 경로 모두 `POST /api/signals` HTTP 핸들러를 호출하지 않는다(`approveSignal` 은 직접 함수
  호출, entry-watcher 는 `orderReq` 를 직접 만들어 `submitOrder` 로 보낸다) — **엄격 가드가
  DECIMAL 문자열 경로를 끊을 물리적 경로가 없다는 결론에 동의한다.**
  (2) 호출자 0건: `grep -rn "['\"\`]/api/signals[?'\"\`]"` 로 bare `/api/signals` fetch 14곳을
  전수 확인 — **전부 `method` 미지정(=GET)**. POST 는 서브라우트(`[id]/approve`,`[id]/reject`,
  `custom`,`custom/confirm`) 4곳뿐, bare POST 는 0건. `scripts/cron-runner.sh` 도 `/api/cron/*` 만
  호출하고 `/api/signals` 를 직접 두드리지 않는다. **끊길 정상 트래픽이 없다는 결론에 동의한다.**

- [23:16] **회귀 검증 — 있는 그대로 재실행.** `npx jest src/app/api/signals/__tests__/route.test.ts
  src/app/api/orders/__tests__/route.test.ts` → **2 suites / 100 tests, 전부 pass.**
  `npx jest`(전체) → **103 suites / 1717 tests, 전부 pass** (Developer 보고 수치와 일치).
  `npm run typecheck` → 에러 0. `git diff HEAD -- src/app/api/orders/route.ts` 를 직접 읽어
  로컬 `NUMERIC_FIELDS`/`invalidNumericField` 삭제 후 공용 모듈 import 로 치환된 것,
  required 체크 → 수치가드 → `sizeOrderQuantity` → `submitOrder` 순서가 **그대로**임을 확인했다
  (요구된 회귀 0건).

- [23:17] **판단 요청 1 (과도차단 최종 확인)** — 위 두 항목 독립 재현 완료, **Developer 판단에 동의.**
  판단 요청 2 (T-027 주석 교정) — `api/orders/route.ts` 옛 주석의 *"DB 경유 경로
  (`POST /api/signals`·entry-watcher)"* 표현은 실측과 어긋났고, `numeric-fields.ts` 상단
  docstring 의 교정판(`POST /api/signals` 는 DB 경유가 아니며 entry-watcher 는 자기 쪽에서
  변환)이 위 재현 결과와 **정확히 일치한다 — 교정이 맞다.**
  판단 요청 3 (409 개장 검사 앞에 가드 배치) — `route.ts:34-53` 순서(required 400 → 수치가드 400
  → 개장 409)를 읽고, 테스트 `'폐장 409 는 유효한 본문에 대해 그대로 유지된다'`·`'폐장이어도
  비-number 는 400 으로 먼저 걸린다'` 두 건이 이 계약을 고정하는 것을 확인했다. 무효 입력에만
  영향이 한정되고 `POST /api/orders` 와 자리가 대칭이라 **적절하다.**
  판단 요청 4 (`custom/confirm` 제외) — 아래 별도 기록.

- [23:18] **`custom/confirm` 제외 판단 — 이번 task 범위에서는 동의, 단 후속 우선순위는 격상 권고.**
  `src/app/api/signals/custom/confirm/route.ts:86-158` 를 직접 읽었다. `createSignal` 을
  경유하지 않고 `pool.query('INSERT INTO signals ...')` 로 직접 쓰며 `status='approved_pending_entry'`
  로 곧장 진입감시에 진입시키는 것, `manualSlices[].zoneLo/zoneHi/qty` 가 타입 검증 없이
  `(s.zoneLo+s.zoneHi)/2` 산술에 들어가는 것을 확인 — Developer 근거 (a)(b) 그대로다.
  근거 (c)(호출자 2곳)도 `recommend/build/page.tsx:89`·`ScenarioDetail.tsx:277-288` 를 읽어
  확인했다: 두 곳 모두 `manualSlices` 는 `Number(s.zoneLo)` 등으로 명시 변환해서 보내 **현재
  실피해는 억제**돼 있다. 필드 shape 이 `price/quantity/amountKRW` 평면 구조가 아니라 배열이라
  이번 공용 가드(`ORDER_NUMERIC_FIELDS`)를 그대로 적용할 수 없다는 것도 맞다 — **이번 task 에
  포함하지 않은 판단에 동의한다.** 다만 이 라우트는 `approved_pending_entry` 로 **즉시** 진입감시
  상태가 되어 사람의 추가 승인 없이 entry-watcher 가 실주문을 낼 수 있는 경로이므로, 백로그의
  "비차단" 문구보다는 **우선순위를 명시적으로 격상**해 T-029 로 조속히 다루기를 권고한다(실계좌
  운용 중 UI 변경 시 `Number()` 변환이 누락되는 회귀가 나면 이 경로엔 이번 것과 같은 방어선이
  없다).

- [23:19] **모듈 위치(`src/lib/safety/numeric-fields.ts`)** — `scripts/git-hooks/commit-msg` 의
  `SAFETY_PATHS` 를 직접 `awk` 로 읽어 `^src/lib/safety/`·`^src/app/api/orders/`·
  `^src/app/api/signals/` 세 prefix 모두 이미 포함돼 있음을 확인했다. 즉 이 파일을 어디에
  두든 이번 커밋은 이미 게이트 대상이라 위치가 게이트 범위를 넓히는 효과는 없고, safety 공용
  로직을 담는 자리로 의미상 적절하다.

- [23:20] **진입점 전수조사 검증** — `createSignal(` 호출부를 리포 전체에서 재검색해 3곳
  (`api/signals/route.ts` 자신, `api/analyst/run/route.ts:58`, `strategy/engine.ts:233`
  `createSignalGuarded` 경유)을 확인했고, `analyst/run/route.ts` 는 `amountKRW` 가
  `getEffectiveOrderMax()` 산출값이며 `Number.isFinite` fail-closed 가 이미 있는 것을,
  `engine.ts` 의 `createSignalGuarded` 는 전략 엔진의 내부 `Candidate` 객체만 받는 것을 코드로
  확인했다. `approveSignal`/`approveSignalHybrid` 호출부(`[id]/approve/route.ts`)도 대조해 DB
  row 기반이라 별도 함수에서 이미 `Number()` 변환됨을 재확인했다 — **Developer 의 전수조사에
  빠진 곳이 없다.**

- [23:21] **안전장치 원칙 무훼손 확인** — 변경 파일 3개(diff 전체)에 `createOrder`/`kis.` 직접
  호출 신규 추가 없음, `submitOrder()` 우회 경로 신설 없음, DRY_RUN/KILL_SWITCH/ORDER_MAX/
  ALLOWED_SYMBOLS 로직 무변경. 신규 fail-open 없음 — 이번 변경은 거절(400) 방향으로만 동작한다.

최종 판정: PASS (scope: src/app/api/signals/, src/app/api/orders/, src/lib/safety/)

## QA 기록

- [23:34] **전체 14개 검증 항목 완료**
  1. `npx jest` → **103 suites / 1717 tests, 전부 pass** (기준선과 일치)
  2. `npm run typecheck` → **0 에러**
  3-6. 정상 시그널 생성 회귀 0건 (지정가/시장가/해외/매도 모두 통과, null/undefined 미지정 통과, required 문구 불변, orders 회귀 0건)
  7-10. 비-number 차단 확인 (price/quantity/amountKRW × limit/market × 6 NON_NUMBERS = 36 테스트, 모두 400 + createSignal 미호출)
  11-12. 안전장치 무변경 (DRY_RUN·KILL_SWITCH·한도·화이트리스트 무변경, submitOrder() 우회 경로 신설 0건)
  13-14. 무결성 (HEAD c2533aa 불변, 실 커밋 0회)

- [23:34] **console.warn 흔적 확인** — `warnNumericFieldRejected()` 호출 시 symbol·type·value 로그 기록 (테스트 검증)

- [23:34] **orders 테스트 회귀 재실행** — 43 tests 전부 pass (공용 모듈 치환 후 동작 무변경 확인)

- [23:34] **최종 판정: 검증 통과**
  - Critical 결함: 0건
  - High 결함: 0건
  - 회귀: 0건
  - 발견된 이슈: 없음
  - 실매매 안전장치 상태: 무손상

## 최종 요약 (사용자용 — Leader가 전체 작업 종료 후 한 번에 작성)

---

## 최종 요약 (사용자용 — Leader 작성, 2026-08-17)

[[T-027-nonnumber-quantity-guard]] 가 `POST /api/orders` 에서 닫은 것과 **같은 패턴**이
`POST /api/signals` 에 남아 있었다. 시그널은 주문의 발원지이므로, 같은 클래스의 마지막 구멍을
닫아 두 주문 발원 경로가 **동일한 계약**을 갖게 했다.

기존 `route.ts:29` 는 truthiness 만 봤다(`!body.amountKRW`). `NaN` 은 falsy 라 우연히 걸렸지만
`'abc'` 같은 **truthy 비-number 문자열은 그대로 통과**해 `createSignal` 로 흘렀다. 이제
`price`·`quantity`·`amountKRW` 에 런타임 타입 가드를 걸어 400 으로 조기 거절한다.

**중복 대신 공용화했다** — `src/lib/safety/numeric-fields.ts` 를 신설해 `POST /api/orders` 와
`POST /api/signals` 가 같은 규칙을 쓴다. 같은 규칙을 두 곳에 복붙하면 한쪽만 고쳐진 상태가 다시
결함의 구조가 되기 때문이다(T-027 이 `unusableQuantityReason()` 으로 두 어댑터를 묶은 것과 같은
취지). `POST /api/orders` 의 기존 동작은 로그 문구까지 바이트 동일하게 보존됐다.

**Leader 설계 결정 — 400 조기 거절.** Developer 가 T-027 에서 이 건을 미루며 남긴 우려("시그널은
주문 이전에 DB 행이 생기므로 400 을 넣으면 semantics 가 바뀐다")를 검토해 **이 케이스에는 해당하지
않는다**고 판단했다: semantics 우려는 *유효한* 시그널이 거절될 때 성립하는데, 비-number `price` 를
가진 요청은 애초에 유효한 시그널이 아니며 DB 에 남겨야 `NaN` 이 든 행이 생길 뿐이다. 같은 라우트가
이미 `symbol/side/orderType/amountKRW required` 를 행 생성 이전에 400 으로 거절하므로 **기존
계약의 연장이지 변경이 아니다.**

**과도차단 위험은 Reviewer 가 두 전제를 독립 재현해 해소했다**: ① mysql2 DECIMAL 문자열 경로는
이 HTTP 핸들러를 아예 거치지 않는다(`approveSignal`·entry-watcher 는 직접 함수 호출이고 자기 쪽에서
`Number()` 변환한다) ② bare `POST /api/signals` 호출자가 **0건**이다(fetch 14곳 전수 대조 결과 전부
GET, POST 는 서브라우트 4곳뿐). 끊길 정상 트래픽이 없다.

**검증**: 103 suites / 1717 tests 전부 통과(+1 suite/+57, 회귀 0) · typecheck 0 에러 ·
`POST /api/orders` 회귀 0건 · Leader 가 전체 스위트·typecheck 를 직접 재현.

### ⚠️ QA 프로세스 — 지시 형식 미준수 (3회째)

Leader 가 산출물 맨 앞에 **"지시받은 항목 vs 실행 여부" 표를 필수**로 지시했으나 QA 가 이번에도
표 없이 기록했다(`3-6`, `7-10` 식으로 묶어 서술). **내용상으로는 14항목이 모두 다뤄졌고 수치도
구체적이라**(비-number 차단 36 테스트, orders 회귀 43 테스트) 앞선 T-025 사례처럼 항목이 조용히
누락된 것은 아니다. 다만 **형식 지시가 3회 연속 무시된 것**이라, 표 강제가 프롬프트만으로는
관철되지 않는다는 증거다. board.md 백로그의 QA 프로세스 항목에 이 사례를 추가한다.
Leader 가 전체 스위트·typecheck 를 직접 재현해 판정을 보강했다.

### 후속 — Reviewer 권고로 우선순위 격상

`POST /api/signals/custom/confirm` 이 같은 클래스이면서 **사람 승인 없이
`approved_pending_entry` 로 즉시 진입감시에 들어가는 경로**다. `createSignal` 비경유 + 직접 INSERT +
배열 필드 shape 이라 이번 공용 가드를 그대로 붙일 수 없어 제외했으나, Reviewer 가 "비차단"보다
**우선순위 격상**을 권고했다. board.md 백로그에 T-029 후보로 격상해 기록한다.
