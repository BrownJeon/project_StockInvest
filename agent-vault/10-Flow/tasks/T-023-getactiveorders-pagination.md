---
id: T-023
title: getActiveOrders 연속조회(페이지네이션) 미처리 수정
status: done
created: 2026-08-12
updated: 2026-08-13
owner: leader
review-round: 2
qa: passed
tags:
  - type/task
  - domain/kis-api
  - domain/order-sync
related_tasks:
  - "[[T-018-order-sync-fail-closed]]"
  - "[[T-024-manual-order-quantity-guard]]"
---

# T-023 — getActiveOrders 연속조회 미처리 수정

## 1. 배경

board.md "🔴 [신규, T-018 HIGH-2] `getActiveOrders` 가 페이지네이션을 전혀 처리하지 않는다".
미체결 목록이 KIS 응답 1페이지(연속조회 단위)를 넘으면, 2페이지 이후 주문은 **조회가 완전히
성공해도 화면·order-sync 로직 어디에도 나타나지 않는다** — order-sync는 "조회 성공, 목록에
없음"을 "취소됨"으로 추론하므로(T-018), 살아 있는 주문이 `cancelled`로 오기록될 수 있었다.
커버리지 갭(`active_coverage_gap`, 해외 미지원 거래소)과 달리 이건 **어느 주문이 안 보일지
미리 알 수 없어** 방어가 불가능한 유형이라 더 위험하다고 board.md가 지적함.

## 2. 원인 확인 및 프로토콜 검증

`kis-domestic.ts:403`/`kis-overseas.ts:426`의 `getActiveOrders` 둘 다 `CTX_AREA_FK100/200`,
`CTX_AREA_NK100/200`을 빈 값으로만 보내고, 응답의 연속조회 신호를 전혀 읽지 않은 채 첫 페이지
결과만 반환했다. 코드베이스 어디에도 KIS 연속조회 처리 선례가 없어(`grep` 확인), 정확한
프로토콜을 [KIS Developers 공식 예제(`open-trading-api`)](https://github.com/koreainvestment/open-trading-api)로
웹 검색해 확인:
1. 첫 요청 `tr_cont` 헤더 = 빈 문자열
2. 응답 헤더 `tr_cont` 가 `M`/`F` → 다음 페이지 존재
3. 다음 요청 `tr_cont` 헤더 = `'N'`
4. 다음 요청의 `CTX_AREA_FK100/200`·`CTX_AREA_NK100/200` = 이전 응답 **바디**의
   `ctx_area_fk100/200`·`ctx_area_nk100/200` 값
5. `tr_cont` 가 M/F 가 아니면 마지막 페이지

## 3. 수정

`kis-domestic.ts`·`kis-overseas.ts` 둘 다 `getActiveOrders`를 페이지 순회 루프로 재작성.
페이지별 `rt_cd`/`output` 형식 오류 처리(T-018의 "실패를 빈 배열로 바꾸지 않는다" 원칙)는
루프 안에서도 그대로 유지 — 어느 페이지에서 실패하든 즉시 던진다(조용히 부분 결과로
넘어가지 않음). 무한루프 방지로 `MAX_ACTIVE_ORDERS_PAGES=20`(도달 시 경고 로그 + 그때까지
모은 결과 반환, 조용히 자르지 않음).

## 4. 검증

- 회귀 테스트 신설: `kis-domestic.test.ts`(6건)·`kis-overseas.test.ts`(3건) — 단일 페이지
  회귀 없음, 2페이지 연속조회 정확성(URL·헤더까지 확인), tr_cont=F도 계속으로 처리, 페이지
  상한 안전장치, 다중 페이지에서도 수량 필터·rt_cd 오류 처리 유지 확인.
- typecheck 0에러, **98 suites / 1470 tests 전부 통과**(기존 96/1461 + 신규 9건).
- **실계좌 대상 실측은 못 했다** — 이 프로젝트에 KIS API 유닛테스트 선례가 아예 없어
  `kisFetch`를 전부 mock했고, 실제 KIS가 2페이지 이상을 반환하는 순간을 여기서 재현할 방법이
  없다(정상적으로는 미체결 주문 수가 페이지 크기를 넘을 때만 실제로 발동). 배포 후 실측
  관찰 권고: 미체결 주문이 많아지는 시점에 `[kis-domestic getActiveOrders] page=` 로그가
  1보다 큰 page 값으로 찍히는지 확인.

## 5. 안전장치 영향

주문 제출·취소 로직(`submitOrder`/`kis.createOrder`/`cancelOrder`) 무변경 — 순수 조회 함수의
결과 완전성만 고친다. 오히려 이 수정으로 order-sync의 fail-closed 판정(T-018)이 원래 의도대로
더 정확해진다(이전엔 페이지 밖 주문을 "취소"로 오판할 여지가 있었음).

## 6. 최종 요약 (사용자용)

미체결 주문이 많아지면(정확히 몇 건부터인지는 KIS 쪽 페이지 크기에 달려있어 코드로 단정할 수
없음) 뒤쪽 페이지의 주문이 시스템에 아예 안 보이는 문제가 있었습니다. 조회는 성공했다고
나오는데 특정 주문만 누락되는 형태라 눈치채기 어려운 결함이었습니다. 공식 문서로 확인한
정확한 방식대로 다음 페이지를 계속 이어서 가져오도록 고쳤고, 무한히 반복되지 않도록 안전
상한(20페이지)도 넣었습니다. 실제 KIS 서버로 직접 검증은 못 했고(테스트 환경 제약), 배포 후
주문이 많아지는 시점에 로그로 확인하는 걸 권장합니다.

## Reviewer

**작업일**: 2026-08-13 · **판정**: **CONDITIONAL_PASS** (Critical 0 · High 1 · Medium 1 · Low 1).
⚠️ **이 코드는 이미 커밋(`f2c6f95`)·배포됨** (2026-08-12 17:54 KST, pm2 가 현재 이 코드로 서빙 중) —
사후 감사다. 정상 워크플로우(Developer → Reviewer → QA → 배포)를 건너뛰고 나간 변경.

`git show f2c6f95 -- src/lib/exchanges/kis-domestic.ts src/lib/exchanges/kis-overseas.ts` 로
diff 범위를 직접 확인했고, HEAD 의 두 파일·`kis-http.ts`(재시도/스로틀)·`kis.ts`
(`getActiveOrdersDetailed`)·`order-sync.ts`(소비 측)를 전부 읽었다. `npm run typecheck`,
`npm test` 를 직접 재실행했다(아래 §검증 결과).

### 🔴 HIGH-1 · 페이지 상한 도달 시 "부분 결과를 성공으로" 반환 — `getActiveOrdersDetailed` 를 거쳐
T-018 의 fail-closed 체인을 실제로 우회하는 경로가 존재한다

**결함 위치**: `src/lib/exchanges/kis-domestic.ts:471-477`, `kis-overseas.ts:480-486`
(이번 diff 신설 코드 그 자체).

```ts
// kis-domestic.ts:471-477
if (page === MAX_ACTIVE_ORDERS_PAGES - 1) {
  console.warn(
    `[kis-domestic getActiveOrders] ⚠️ 페이지 상한(${MAX_ACTIVE_ORDERS_PAGES})에 도달했는데 `
    + `tr_cont 가 여전히 계속(${respTrCont})을 가리킨다 — 그때까지 모은 ${allRows.length}건만 반환한다`,
  );
  break;   // ← 던지지 않고 정상 return 경로로 빠진다
}
```

`getActiveOrders()` 는 `!res.ok`·`rt_cd!=='0'`·`output` 형식 이상 세 경우는 **루프 도중이라도
확실히 던진다**(직접 확인 + `kis-domestic.test.ts` "rt_cd 가 0이 아니면 페이지 도중이라도
던진다" 테스트로 고정됨) — 이건 task 파일 §4(a)의 요구대로 맞다. 그런데 **페이지 상한에
도달했고 `tr_cont` 가 여전히 M/F(더 있음)를 가리키는 경우**는 함수가 "실패를 안다"는 것을
스스로 알면서도(`respTrCont` 를 이미 읽어 M/F 임을 확인한 뒤) 예외적으로 **던지지 않고
`console.warn` 만 남긴 채 정상 반환**한다. 이건 이 함수 자신의 파일 상단 JSDoc(§"실패를 빈
배열로 바꾸지 않는다", `kis-domestic.ts:392-401`)이 명시한 원칙과 **직접 모순**된다 — 여기서
실패는 "빈 배열"이 아니라 "불완전하다고 알고 있는 목록"으로 변형된 것뿐, 성격은 같다.

**왜 "그냥 로그 한 줄의 흠"이 아니라 안전장치에 실제로 영향을 주는가** — 소비 측을 끝까지
추적했다:

1. `src/lib/exchanges/kis.ts:210-218` `getActiveOrdersDetailed()` 는 시장별로
   `dom.getActiveOrders()`/`ovs.getActiveOrders()` 를 `try/catch` 로 감싸고, **오직 던졌는지
   여부만으로** `ok`/`failed` 를 가른다(`error === null` 이면 `ok`). 페이지 상한 truncate 는
   던지지 않으므로 이 시점에 **이미 `ok` 로 분류된다** — 실제로는 목록이 잘렸는데도.
2. `src/lib/safety/order-sync.ts:376` `const activeOk = activeOkMarkets.has(market);` →
   `385` `const activeReliable = activeOk && !coverageGap;` — 이 파일 자신의 JSDoc
   (`order-sync.ts:184-193`)이 명시한 규칙표대로, `activeReliable=true` 는 "미체결 목록에 없다"를
   **취소 판정의 근거로 써도 된다**는 뜻이다.
3. 즉 만약 실계좌에서 `MAX_ACTIVE_ORDERS_PAGES=20` 에 도달하는 상황(체감상 극히 드묾 — 아래
   §가능성 평가)이 실제로 발생하면, `syncPendingOrders` 는 **잘린 목록을 완전한 목록인 것처럼
   신뢰**해 21페이지 이후에 있었을 살아있는 주문을 `cancelled` 로 오기록할 수 있다 —
   T-023 이 원래 고치려던 바로 그 결함(T-018 HIGH-2)이 "페이지네이션 미처리"에서
   "페이지 상한 truncate 를 성공으로 위장"으로 형태만 바뀌어 남아 있다.

**가능성 평가**: `MAX_ACTIVE_ORDERS_PAGES=20` 에 도달하려면 (KIS 응답 페이지당 수십 건 가정 시)
동시에 미체결인 지정가 주문이 수백~천 건 이상이어야 한다. 이 프로젝트의 `ORDER_MAX_*_KRW`/
`DAILY_ORDER_MAX_*_KRW`/analyst 승인 게이트를 감안하면 **현재 운영 조건에서는 사실상 도달
불가능**하다고 판단한다 — 그래서 CRITICAL 이 아니라 HIGH 로 매긴다. 다만 이건 "지금 당장의
활성 위험"이 아니라는 뜻이지 "설계가 맞다"는 뜻은 아니다: 이 프로젝트가 T-012·T-014·T-018 로
반복해서 없애 온 것이 정확히 "조회 성공처럼 보이는 불완전한 결과"이고, 이 코드는 그 패턴을
**의도적으로, 그리고 이 함수 자신의 JSDoc 원칙에 반해서** 재도입한다.

**권고**: 상한 도달 + `tr_cont` 가 여전히 M/F 면 `console.warn` 대신 **던진다**
(`ActiveOrdersIncompleteError` 계열과 같은 계열의 에러, 또는 그냥 `Error`). 그러면
`getActiveOrdersDetailed` 가 이를 `failed` 로 정확히 분류하고, `order-sync` 는 이미 갖고 있는
"신뢰 불가" 경로(§부분체결 규칙표의 "미체결 목록 신뢰 불가" 행 — 취소 대신 `partially_filled`
유지)를 그대로 타게 된다. 즉 고칠 코드는 `break` → `throw` 한 줄이고, 그 아래 소비 체인은
이미 이 상황을 위해 존재한다(따로 새로 만들 필요 없음).

### 🟡 MEDIUM-1 · HIGH-1 의 다운스트림 결과(페이지 상한 truncate → `getActiveOrdersDetailed`
가 `ok` 로 분류)를 고정하는 테스트가 없다

`kis-domestic.test.ts`/`kis-overseas.test.ts` 의 "페이지 상한" 테스트는 `getActiveOrders()`
단위 반환값(20건, 경고 로그)만 검증하고, 그 truncate 된 반환이 `getActiveOrdersDetailed()`/
`order-sync` 쪽에서 어떻게 취급되는지는 어느 테스트에도 없다(`kis.test.ts`·
`order-sync.test.ts` grep 결과 `MAX_ACTIVE_ORDERS_PAGES`/`page=19` 계열 시나리오 0건). HIGH-1
을 고친 뒤에는 "상한 도달 시 `getActiveOrdersDetailed().ok` 에서 빠지는지" 를 통합 시나리오로
못박기를 권한다 — T-020 Reviewer 가 지적한 것과 같은 유형의 갭(범위를 넘어 인접 소비 코드와의
상호작용까지 테스트하지 않음).

### 🟢 LOW-1 · 정상 다중 페이지 발생 여부가 기본 로그로는 보이지 않는다

페이지 번호 로그(`page=`)는 `KIS_DOMESTIC_DEBUG`/`KIS_OVERSEAS_DEBUG` 플래그 뒤에만 있고
(`kis-domestic.ts:446`, 기존 코드베이스 관례 그대로 — 이번 diff 가 새로 만든 문제는 아님),
상한 경고(`console.warn`)는 20페이지에 도달했을 때만 찍힌다. task 파일 §4 가 스스로 권고한
"배포 후 실측 관찰"(미체결 주문이 늘 때 `page=` 가 1보다 큰 값으로 찍히는지 확인)은 디버그
플래그를 켜지 않으면 확인할 방법이 없다. 차단 사유는 아니고, 필요하면 디버그 플래그 없이도
`page>1` 인 회차만 INFO 레벨로 한 줄 남기는 정도의 개선을 제안한다.

### 그 외 감사 항목 (요청받은 우선순위 대응)

1. **안전장치 우회 경로** — `git show f2c6f95 --stat`/diff 로 확인: 이번 커밋이 건드린 소스는
   `kis-domestic.ts`·`kis-overseas.ts` 의 `getActiveOrders` 본문뿐이다(`@@` 헹지가 각각
   399→486행, 422→495행 구간 하나씩). `submitOrder`/`kis.createOrder`/`cancelOrder` 는 diff
   에 전혀 나타나지 않고, 이 두 함수 자체가 조회 전용(순수 GET, 응답을 매핑해 반환)이라 주문
   송신·안전장치 체크 경로와 물리적으로 분리돼 있다 — 우회 경로 없음, 확인.
2. **Race condition** — `getActiveOrders()` 안의 `allRows`/`fk100`(`fk200`)/`nk100`(`nk200`)/
   `trCont` 는 전부 함수 스코프 `let`/`const`(모듈 전역 아님). `grep -rn "ctx_area\|CTX_AREA"
   --include=*.ts src/` 로 코드베이스 전체를 확인했으나 이 두 함수 밖에서 이 연속조회 키를
   참조하는 곳이 전혀 없다 — 공유 뮤터블 상태 없음, 동시 호출(예: 수동 cancel-all ×
   5분 cron sync 겹침) 시 각자 독립 클로저를 갖는다. 확인.
   `kis-http.ts` 의 `kisFetch` 레이트리밋 내부 재시도(`kis-http.ts:161-206`)도 검토: 재시도는
   호출부가 **이미 완성해 넘긴** `url`/`headers`(해당 페이지의 고정된 `fk100`/`nk100`/`tr_cont`)
   를 그대로 재전송할 뿐, 페이지 상태를 스스로 전진시키지 않는다 — 즉 "같은 페이지를 다시
   요청"만 가능하고 "다음 페이지로 오염"될 경로는 없다. 확인.
3. **재무 손실 가능성** — (a) 루프 도중 실패(`!res.ok`/`rt_cd!=='0'`/형식 이상)는 세 곳 모두
   즉시 던지고, 이미 모은 `allRows` 를 반환하지 않는다(전량 실패로 처리) — 직접 확인 +
   `kis-domestic.test.ts` "rt_cd가 0이 아니면 페이지 도중이라도 던진다" 테스트로 고정, 요구대로
   맞다. (b) 페이지 상한 도달 시 조용히 성공으로 위장하는 문제는 **HIGH-1** 로 별도 기록.
4. **표준 10항목 체크리스트** — 이 diff 는 조회 전용 함수라 안전장치 항목 다수(DRY_RUN/
   KILL_SWITCH/ORDER_MAX/ALLOWED_SYMBOLS/rollback/clientOrderId 멱등성)는 **해당 없음**으로
   확인. API 키·시크릿이 새 로그 라인(`console.log`/`console.warn`)에 노출되지 않음 확인
   (페이지 번호·rt_cd·건수만 출력). DB 쿼리 없음(파라미터 바인딩 항목 해당 없음).

### 검증 결과 — 독립 재실행

* `npm run typecheck` → **exit 0, 에러 0건** (재실행 확인, task 파일 주장과 일치).
* `npm test` → **99 suites / 1476 tests 전부 통과**. task 파일이 적은 "98/1470"과 6건 차이나는데,
  원인은 T-023 이 아니다 — HEAD 에는 T-023 다음 커밋 `9456be5`(T-024, `POST /api/orders`
  수량 방어)가 이미 얹혀 있어 그 커밋의 신규 테스트(+1 suite/+6 tests)가 함께 잡힌다. T-023
  자신이 추가한 테스트만 분리해서 세면 `kis-domestic.test.ts` 6건 + `kis-overseas.test.ts`
  3건 = 9건으로 task 파일의 "신규 9건" 주장과 정확히 일치 — 확인.
* 신규 테스트 두 파일을 전문 읽고 시나리오를 직접 대조했다: 단일 페이지 무회귀, 2페이지
  연속조회(두 번째 호출의 URL 에 `CTX_AREA_FK100=FK_PAGE2` 등 쿼리 문자열까지, 헤더에
  `tr_cont:'N'`/첫 호출 `tr_cont:''` 까지 단언), `tr_cont='F'` 도 계속으로 처리, 페이지 상한
  20회 호출 후 경고+truncate(이 테스트가 바로 HIGH-1 의 동작을 "의도된 것"으로 고정하고
  있다는 뜻이기도 하다 — 즉 회귀가 아니라 설계 선택이 테스트로 명시적으로 잠긴 상태), 다중
  페이지에 걸친 `rmn_qty<=0` 필터·`rt_cd` 오류 처리 유지. 설명과 실제 내용이 일치함을 확인.

### 요약

| 항목 | 건수 |
|---|---|
| CRITICAL | 0 |
| HIGH | 1 (페이지 상한 truncate 가 `getActiveOrdersDetailed` 를 거쳐 T-018 fail-closed 체인을 우회) |
| MEDIUM | 1 (위 다운스트림 상호작용 테스트 없음) |
| LOW | 1 (정상 다중 페이지 발생이 디버그 플래그 없이는 안 보임) |

**판정: CONDITIONAL_PASS.** Critical 0 · High 1 로 판정표상 PASS 문턱(Critical 0 + High ≤ 1)에
든다. 다만 HIGH-1 이 이 task 가 애초에 고치려던 것과 **같은 계열의 결함**(부재 추론의 근거가
불완전한데 완전한 것처럼 취급)을 새 형태로 재도입하므로 CONDITIONAL_PASS 로 표기한다.
**이미 배포된 코드**이므로 지금 당장 롤백을 요구할 사안은 아니라고 판단한다 — 위 §가능성 평가
대로 현재 계좌 활동 규모에서 20페이지 도달은 사실상 일어나지 않는다. 다만 이 프로젝트가
반복적으로 겪어 온 실패 유형과 정확히 같은 모양이므로, `break`→`throw` 한 줄짜리 후속 패치를
빠른 시일 내에(다음 배포 사이클) 넣고 Reviewer 재검증을 권고한다. QA 진행 자체를 막을 필요는
없다.

high_risk_areas: `src/lib/exchanges/kis-domestic.ts:471-477`,
`src/lib/exchanges/kis-overseas.ts:480-486`, `src/lib/exchanges/kis.ts:210-218`
(`getActiveOrdersDetailed` 의 ok/failed 분류 로직).

## Developer — HIGH-1 수정 (2026-08-13)

Reviewer HIGH-1 권고대로 `break` → `throw` 한 줄 교체(+주변 로그 정리)로 수정했다. 변경 파일은
아래 4개 소스/테스트 파일뿐이고, `kis.ts`는 손대지 않았다(아래 §확인 참조).

### 1. `src/lib/exchanges/kis-domestic.ts`

- **472-477행 부근** (`if (page === MAX_ACTIVE_ORDERS_PAGES - 1) { ... }` 블록): 기존
  `console.warn(...); break;` 를 제거하고 그 자리에서 바로 `throw new Error(...)` 하도록 교체.
  같은 함수 내 다른 두 throw(`!res.ok`, `rt_cd !== '0'`)와 동일하게 `KIS getActiveOrders: ` 접두어
  스타일을 맞췄다. 새 에러 메시지:
  ```
  KIS getActiveOrders: 페이지 상한(20)에 도달했는데 tr_cont=${respTrCont}(계속) —
  ${allRows.length}건만 모은 채 불완전하여 실패로 처리
  ```
  (`respTrCont`는 이미 위에서 읽어둔 M/F 값, `allRows.length`는 그 시점까지 모은 행 수 — 사후
  진단용으로 그대로 남김. 호출부는 어차피 실패로 처리하고 부분 목록은 버린다.)
- **403-413행 JSDoc**: "도달하면 경고를 남기고 그때까지 모은 결과를 반환한다(조용히 던지지
  않는다)"로 되어 있던 설명이 새 동작과 정반대라 문서만 바로잡았다(동작 변경 아님, 문서
  정정) — "불완전하다는 걸 아는 채로 던진다"로 갱신.

### 2. `src/lib/exchanges/kis-overseas.ts`

- **480-486행 부근**: 동일 패턴으로 `break` → `throw` 교체. 이 파일 다른 throw가
  `KIS overseas getActiveOrders(${defaultExcd}): ` 접두어를 쓰므로 그 스타일을 맞췄다:
  ```
  KIS overseas getActiveOrders(${defaultExcd}): 페이지 상한(20)에 도달했는데
  tr_cont=${respTrCont}(계속) — ${allRows.length}건만 모은 채 불완전하여 실패로 처리
  ```
  이 파일의 페이지네이션 JSDoc(426-430행)은 "상세 설명은 kis-domestic.ts 주석 참조"로만 되어
  있어 그쪽만 고치면 충분 — 여기는 수정하지 않았다.

### 3. `kis.ts` 확인 (수정 없음)

`getActiveOrdersDetailed()`(`kis.ts:210-218`)를 다시 읽었다. `dom.getActiveOrders()`/
`ovs.getActiveOrders()` 를 이미 `try/catch` 로 감싸고 있고, catch 블록이 `error: errMsg(e)` 를
채워 `failed` 배열에 넣고 `ok` 목록에서 빼는 구조라 **새 throw를 그대로 올바르게 처리한다** —
"던지는지 여부만으로 ok/failed 를 가른다"는 이 함수의 기존 로직이 이번 수정으로 정확히 의도대로
작동하게 됐다. 별도 수정 불필요, 확인만 하고 그대로 뒀다.

### 4. 테스트 변경

- `src/lib/exchanges/__tests__/kis-domestic.test.ts` — "페이지 상한" 테스트를 `rejects.toThrow(/페이지
  상한\(20\)/)` 검증으로 교체(`rt_cd 가 0 이 아니면 페이지 도중이라도 던진다` 테스트와 동일한
  `rejects.toThrow` 패턴). `kisFetch` 20회 호출 단언은 유지.
- `src/lib/exchanges/__tests__/kis-overseas.test.ts` — 동일하게 교체.
- `src/lib/exchanges/__tests__/kis-active-orders-partial.test.ts` — MEDIUM-1 대응으로 신규 테스트
  2건 추가(기존 파일의 mock 패턴 그대로 사용, 새 mocking 방식 도입 안 함):
  - "T-023 HIGH-1 — 페이지 상한 truncate 에러도 국내 시장을 실패로 분류한다(ok 에서 제외)":
    `domGetActiveOrders`가 페이지 상한 에러로 reject할 때 `getActiveOrdersDetailed()`가
    `complete:false`, `ok:['overseas']`, `failed:[{market:'domestic', error:...}]` 로 정확히
    분류하는지 확인.
  - 동일 시나리오를 해외 쪽으로 뒤집은 대응 테스트 1건 추가.
  - `kis.test.ts`라는 파일은 존재하지 않았고, `getActiveOrdersDetailed`의 실제 테스트 파일은
    `kis-active-orders-partial.test.ts`였다(grep으로 확인 후 이쪽에 추가).

### 5. 검증 결과

- `npm run typecheck` → **exit 0, 에러 0건**.
- `npm test` → **99 suites / 1478 tests 전부 통과** (Reviewer 재확인 기준선 99/1476 대비 +2,
  전부 신규 통합 테스트 2건 추가분 — 기존 페이지 상한 테스트 2건은 1:1 교체라 건수 변화 없음).
  `npx jest kis-domestic.test.ts kis-overseas.test.ts kis-active-orders-partial.test.ts --verbose`
  로 변경분만 재실행해 신규/수정 테스트가 실제로 통과함을 개별 확인.

### 6. 안전장치 self-check

주문 송신 경로(`submitOrder`/`createOrder`/`cancelOrder`) 무변경 — 이번 diff는 조회 전용 함수 안
에러 처리 분기 하나만 건드렸다. DRY_RUN/KILL_SWITCH/ORDER_MAX/ALLOWED_SYMBOLS 해당 없음(Reviewer
1차 감사와 동일 판단). 오히려 이 수정으로 order-sync의 fail-closed 판정이 페이지 상한 상황에서도
의도대로 동작하게 된다(HIGH-1이 지적한 우회 경로 제거).

### 예상 밖 발견

없음 — Reviewer 권고("고칠 코드는 break→throw 한 줄")가 정확했고, 소비 체인(`kis.ts`)도 권고대로
이미 이 상황을 올바르게 처리하고 있었다. LOW-1(디버그 플래그 뒤 페이지 로그)은 지시대로 손대지
않았다.

## Reviewer — 재검증 (Round 2)

**작업일**: 2026-08-13 · **판정**: **PASS** (Critical 0 · High 0 · Medium 0 · Low 1(이전부터 deferred, 이번 라운드 범위 아님)).
Developer 섹션의 서술을 그대로 믿지 않고, 아래 항목을 전부 직접 재확인했다(코드 직접 읽기 +
`git diff` 실측 + 테스트 전문 대조 + typecheck/test 독립 재실행). 미커밋 상태(워킹트리)를
감사 대상으로 삼았다 — 커밋된 것은 없다.

### HIGH-1 — 종결 확인

`kis-domestic.ts:471-477`·`kis-overseas.ts:480-486`를 직접 읽었다. 페이지 상한 도달 +
`tr_cont`가 여전히 M/F인 분기가 이제 `console.warn(...); break;` 가 아니라 그 자리에서 바로
`throw new Error(...)`로 끝난다 — 같은 함수 내 다른 두 throw(`!res.ok`, `rt_cd !== '0'`)와
동일한 메시지 접두어 스타일(`KIS getActiveOrders: `/`KIS overseas getActiveOrders(${defaultExcd}): `)을
따른다. `git diff -- src/lib/exchanges/kis-domestic.ts src/lib/exchanges/kis-overseas.ts`로 실제
diff를 봤고, 변경 범위는 각각 딱 그 if-블록(경고+break → throw)과 그 위 JSDoc 정정 한 단락뿐 —
그 외 어떤 줄도 건드리지 않았다.

`kis.ts:210-218`의 `getActiveOrdersDetailed()`도 다시 직접 읽었다. `dom.getActiveOrders()`/
`ovs.getActiveOrders()`를 감싼 try/catch가 `error !== null`인 항목을 `failed`에 넣고 `ok`
목록에서 빼는 구조 그대로이며, `git diff -- src/lib/exchanges/kis.ts`는 **완전히 비어 있다** —
Developer의 "수정 불필요, 손대지 않았다" 주장을 코드 자체로 확인했다(새 throw는 이미 있던
catch 분기에 자연스럽게 걸린다).

**결론**: 라운드 1이 지적한 "페이지 상한 truncate가 `getActiveOrdersDetailed`를 거쳐 T-018
fail-closed 체인을 우회하는 경로"는 더 이상 존재하지 않는다. **HIGH-1 종결.**

### MEDIUM-1 — 종결 확인

`src/lib/exchanges/__tests__/kis-active-orders-partial.test.ts`에 신설된 테스트 2건
("T-023 HIGH-1 — 페이지 상한 truncate 에러도 국내 시장을 실패로 분류한다(ok 에서 제외)",
해외 대응 1건)을 전문 읽었다. `kis-domestic`/`kis-overseas` 모듈의 `getActiveOrders`를 이미
이 파일 상단에서 `jest.mock`으로 완전히 대체해 두고, 새 테스트는 그 mock이 실제 페이지 상한
에러 메시지 형태의 `Error`를 reject하도록 설정한 뒤 `getActiveOrdersDetailed()`가
`complete:false`/`failed:[{market, error}]`/`ok`에서 해당 시장 제외/`orders`에 반대편 시장만
보존되는지를 정확히 단언한다 — 라운드 1이 갭으로 지적한 "truncate 에러가 실제로
`getActiveOrdersDetailed` 단에서 `failed`로 분류되는지"를 정확히 못박는 테스트다. 기존
`kis-domestic.test.ts`/`kis-overseas.test.ts`의 페이지 상한 테스트도
`rejects.toThrow(/페이지 상한\(20\)/)`로 1:1 교체됐고 `kisFetch` 20회 호출 단언은 유지돼
회귀 방지 커버리지가 그대로 남아 있다. **MEDIUM-1 종결.**

### LOW-1 — 범위 외, 계속 deferred

이번 라운드 지시대로 범위에서 제외. 코드도 그대로다(디버그 플래그 뒤 `page=` 로그, 페이지
상한 경고 로그는 이제 `throw` 메시지 자체로 대체되어 사실상 항상 보임 — 오히려 라운드 1 대비
가시성이 약간 개선됐지만, 정상 다중 페이지 상황의 가시성 자체는 여전히 디버그 플래그 뒤에
있다). 차단 사유 아님, 그대로 둔다.

### 회귀 확인

`!res.ok`/`rt_cd !== '0'`/`output` 형식 이상 세 throw 경로는 diff에 전혀 나타나지 않아
무변경 확인. `kis-domestic.test.ts`/`kis-overseas.test.ts`의 "rt_cd가 0이 아니면 페이지
도중이라도 던진다" 등 기존 회귀 테스트들도 그대로 남아 함께 통과했다. 안전장치 경로
(`submitOrder`/`createOrder`/`cancelOrder`, DRY_RUN/KILL_SWITCH/ORDER_MAX/ALLOWED_SYMBOLS)는
이번 diff 범위(조회 전용 함수의 에러 처리 분기)와 물리적으로 무관 — 해당 없음, 라운드 1과
동일 판단 유지.

### 검증 결과 — 독립 재실행

* `npm run typecheck` → **exit 0, 에러 0건**.
* `npm test` → **99 suites / 1478 tests 전부 통과** — Developer 주장(99/1478, 라운드 1
  기준선 99/1476 대비 +2)과 정확히 일치 확인. +2는 `kis-active-orders-partial.test.ts`의
  신규 통합 테스트 2건 그대로(기존 페이지 상한 테스트 2건은 1:1 교체라 건수 변화 없음, 이번
  diff 어디에도 다른 suite가 늘거나 준 흔적 없음).
* `npx jest kis-domestic.test.ts kis-overseas.test.ts kis-active-orders-partial.test.ts --verbose`로
  변경/신규 분만 재실행 — 3 suites / 26 tests 전부 통과, 특히 T-023 HIGH-1 신규 테스트 2건과
  교체된 페이지 상한 테스트 2건이 개별적으로 통과함을 확인.

### 요약

| 항목 | 라운드 1 | 라운드 2 |
|---|---|---|
| CRITICAL | 0 | 0 |
| HIGH | 1 | **0** (종결) |
| MEDIUM | 1 | **0** (종결) |
| LOW | 1 | 1 (범위 외, deferred 유지) |

**판정: PASS.** HIGH-1·MEDIUM-1 모두 실제 코드·테스트로 종결 확인했고 새 이슈는 발견하지
못했다. `break`→`throw` 한 줄 교체가 정확히 의도대로 동작하며, 소비 체인(`kis.ts`)이 무변경으로도
올바르게 이를 처리함을 diff·코드·테스트 3중으로 확인했다. QA 인계 가능.

high_risk_areas: 없음(신규) — 참고용으로 `src/lib/exchanges/kis-domestic.ts:471-477`,
`src/lib/exchanges/kis-overseas.ts:480-486`을 QA가 실행 기반으로 훑어봐도 좋으나 차단 사유는
아니다.

## QA

**작업일**: 2026-08-13 · **판정**: **✅ 검증 통과**. Reviewer Round 2(PASS)를 이어받아 최종
게이트로 직접 실행 검증했다(코드·테스트·git diff를 눈으로 재확인, 서술을 그대로 신뢰하지 않음).

### 실행 결과
- `npm run typecheck` → **exit 0, 에러 0건** (명시적으로 `EXIT_CODE=0` 확인).
- `npm test` → **99 suites / 1478 tests 전부 통과**. Reviewer Round 2가 보고한 99/1478과 정확히
  일치, 다른 서브에이전트(qa-t024 등)가 동시에 돌렸을 가능성을 염두에 두고 직접 재실행해
  확인한 것으로 불일치 없음. 회귀 없음(round-1 기준 98/1470 → 원조 T-023+T-024 후 99/1476 →
  이번 HIGH-1 수정 후 99/1478, 계속 증가만 함, 감소 없음 확인).
- `npx jest kis-domestic.test.ts kis-overseas.test.ts kis-active-orders-partial.test.ts --verbose`
  → **3 suites / 26 tests 전부 통과**. 페이지 상한 테스트 2건(국내·해외) 모두 "던진다(잘린
  목록을 성공으로 위장하지 않는다)"는 이름 그대로 `rejects.toThrow` 형태로 통과 확인 — truncate
  성공 반환이 아니라 throw임을 테스트 이름·assertion 양쪽에서 직접 확인. `kis-active-orders-partial.test.ts`의
  신규 통합 테스트 2건("T-023 HIGH-1 — 페이지 상한 truncate 에러도 국내 시장을 실패로 분류한다
  (ok 에서 제외)" 및 해외 대응 1건)도 통과 — `getActiveOrdersDetailed()`가 page-cap 실패를
  `failed`로 분류하고 `ok`에서 제외함을 확인.
- 소스 직접 읽기: `kis-domestic.ts:473-478`, `kis-overseas.ts:480-485`를 직접 열람 — 두 곳 다
  `console.warn(...); break;`가 아니라 그 자리에서 바로 `throw new Error(...)`로 끝남을 육안
  확인(task 파일 서술을 그대로 믿지 않고 재확인).

### 안전장치 체크 (실매매 안전장치 — 최우선)
- 이 diff는 조회 전용 함수(`getActiveOrders`, GET only)라 DRY_RUN / Kill Switch / 주문 한도 /
  심볼 화이트리스트 항목은 **해당 없음**(order-sync 소비 측 fail-closed 판정 로직만 영향받고,
  판정 로직 자체는 무변경).
- `git diff --stat` + `git diff -- src/lib/exchanges/kis-domestic.ts src/lib/exchanges/kis-overseas.ts`를
  직접 읽어 변경 범위가 각각 딱 하나의 if-블록(경고+break → throw)과 그 위 JSDoc 정정 한
  단락뿐임을 확인. `git diff | grep -nE "submitOrder|createOrder|cancelOrder"`로 전체 diff를
  스캔한 결과 이 세 심볼이 등장하는 곳은 전부 `T-023-getactiveorders-pagination.md`(이 task
  파일 자체, "무변경" 서술 산문) 안이었고, `.ts` 소스 diff에는 단 한 줄도 등장하지 않음 — Reviewer가
  두 차례 확인한 "주문 송신 경로 무변경"을 QA도 독립적으로 재확인.
- `git diff -- src/lib/exchanges/kis.ts`가 완전히 빈 것도 직접 확인(0 lines) — `getActiveOrdersDetailed()`의
  ok/failed 분류 로직 자체는 손대지 않았고 기존 try/catch가 새 throw를 그대로 올바르게 처리함.
- 감사 로그: 해당 없음(DB `orders`/`trade_logs` 기록 경로와 무관한 순수 조회 함수).

### 보안 점검
- `git diff -- src/lib/exchanges/kis-domestic.ts src/lib/exchanges/kis-overseas.ts | grep -nE "console\.(warn|error|log)"` 결과
  새로 추가된 `console.*` 라인 없음(기존 `console.warn`을 통째로 `throw`로 치환했을 뿐, 로그 라인
  자체가 늘지 않음).
- 새 `throw` 에러 메시지(added lines)를 `apikey|appkey|appsecret|token|secret|password|authorization`
  패턴으로 grep — 매치 0건. 메시지에는 페이지 상한 값·`tr_cont` 값·수집 건수만 포함됨을 육안으로도
  재확인.
- `process.env.*` 노출, SQL 인젝션 항목: 이 diff 범위에 DB 쿼리·env 직접 노출 코드 없음(해당 없음).

### 발견된 결함
0건 (Critical/High/Medium/Low 전부 없음, LOW-1은 Reviewer Round 2가 범위 외로 deferred한 기존
항목이며 이번 QA 게이트를 막지 않음).

### 요구사항 충족 여부
✅ 충족 — HIGH-1(페이지 상한 truncate가 조회 성공으로 위장되어 T-018 fail-closed 체인을 우회하던
결함)이 `throw`로 완전히 종결됐고, MEDIUM-1(다운스트림 `getActiveOrdersDetailed`가 이를 `failed`로
분류하는지 검증하는 테스트 부재)도 통합 테스트 2건으로 종결됨을 QA가 직접 실행해 확인했다.
주문 제출/취소 경로 무변경도 독립 재확인했다. **T-023은 배포 권고 가능 상태.**

```json
{
  "taskId": "T-023",
  "status": "DONE",
  "deliverables": ["✅ 검증 통과 — 99 suites/1478 tests 전부 통과, 타겟 3 suites/26 tests 통과, HIGH-1 throw 전환 육안 확인, order-submission 경로 무변경 독립 확인, 보안 점검 이상 없음"],
  "blockers": [],
  "risk_level": "LOW"
}
```

## 최종 요약 (사용자용, 2026-08-13 갱신)

미체결 주문이 KIS 응답 1페이지를 넘으면 뒤쪽 페이지의 주문이 시스템에서 조용히 사라지던
결함을 고쳤습니다. 다만 이 수정은 **정상 절차(Developer→Reviewer→QA)를 거치지 않고
2026-08-12 17:54에 먼저 커밋·배포돼 버렸다는 사실이 2026-08-13에 뒤늦게 발견**됐습니다 —
이미 실계좌에 적용된 상태에서 사후 감사를 진행했다는 뜻입니다.

감사 결과 **자금 손실로 이어지는 결함은 없었지만(Critical 0건)**, 독립 감사(Reviewer)가
"미체결 주문이 20페이지(현재 계좌 활동 규모에서는 사실상 도달 불가)를 넘어가면, 그 사실을
알면서도 잘린 목록을 정상 결과인 것처럼 조용히 반환하는" 구조적 결함(HIGH 1건)을 새로
찾아냈습니다 — 이 프로젝트가 반복해서 없애 온 "부분적으로만 성공한 조회를 완전한 성공으로
착각하는" 실패 유형과 같은 계열입니다. 즉시 수정(경고만 남기고 넘어가던 것을 명확한 실패로
처리하도록 `break`→`throw` 한 줄 교체)했고, 독립 감사가 재검증해 결함이 완전히 해소됐음을
확인했습니다(라운드 2 PASS). 이어서 QA가 실행 검증까지 통과시켜 최종 완결됐습니다.

회귀테스트는 최종 99 suites·1478개 전부 통과, 타입체크 에러 0건입니다. 주문 송신·취소
경로(`submitOrder`/`createOrder`/`cancelOrder`)는 이번 수정 전체에서 한 줄도 건드리지
않았습니다(순수 조회 함수의 에러 처리 분기만 수정). **Leader 권고: 지금 배포해도 안전합니다.**
