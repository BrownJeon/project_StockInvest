---
task-id: T-018
project: StockInvest
created: 2026-08-11
updated: 2026-08-11
review-round: 3
status: review
tags:
  - type/task
  - domain/safety
  - domain/exchanges
aliases:
  - 주문 동기화 fail-closed
  - order-sync
  - 살아있는 주문이 cancelled 로 마킹되는 문제
  - ActiveOrdersIncompleteError
  - ORDER_SYNC_UNRECONCILED
related_tasks:
  - "[[T-007-telegram-silent-failure]]"
  - "[[T-012-zero-price-snapshot]]"
  - "[[T-014-favorites-ai-refresh-failure]]"
  - "[[T-017-kis-rate-limit-throttle]]"
---

# T-018 · 조회 실패가 살아 있는 주문을 `cancelled` 로 만드는 문제 (fail-closed 전환)

## 문제

브로커(KIS)에 **살아 있는 지정가 주문이 DB 에서 `cancelled` 로 마킹될 수 있다.**
[[T-007-telegram-silent-failure|T-007]]·[[T-014-favorites-ai-refresh-failure|T-014]] 와 같은
결함 유형 — **실패가 조용히 "성공처럼 보이는 빈 결과"로 바뀐다.**

### 판정 로직이 부재 추론이라는 점

`order-sync.ts` 의 취소 판정은 이 한 줄이다.

```js
} else if (order.type !== 'market' && !activeOrderIds.has(eid)) {
  await pool.query(`UPDATE orders SET status='cancelled' WHERE id=?`, [order.id]);
```

"미체결 목록에도 없고 체결 목록에도 없으니 취소된 것이다" — **부재 추론**이다.
부재 추론은 두 목록이 **모두 신뢰할 수 있을 때만** 성립한다. 두 집합이 동시에 비면
**모든 비-market 미결 주문이 `cancelled` 로 마킹**된다.

### 실패가 삼켜진 여섯 지점

`order-sync.ts:36-41` 에는 이미 올바른 fail-closed 조기 반환이 있었다.
**그 catch 는 도달할 수 없는 죽은 코드였다** — 예외가 거기 닿기 전에 전부 삼켜졌기 때문이다.

| # | 위치 | 삼킨 방식 |
|---|---|---|
| 1 | `kis-domestic.getActiveOrders:404` | `if (!res.ok) return []` — **KIS 레이트리밋은 HTTP 500** 이라 전부 여기 떨어졌다 |
| 2 | `kis-domestic.getActiveOrders:410` | `rt_cd !== '0' \|\| !Array.isArray(output)` → `[]` — HTTP 200 위의 **API 레벨 에러**를 "0건"과 동일 취급 |
| 3 | `kis-domestic.getActiveOrders:418-421` | `catch { console.error(...); return []; }` |
| 4 | `kis-overseas.getActiveOrders:409·411·420` | 위 셋과 동일. catch 는 **로그조차 없었다** (`catch { return []; }`) |
| 5 | `kis.ts:154-155` (Facade) | 두 시장 모두 `.catch(e => { console.error(...); return []; })` |
| 6 | `order-sync.ts:60-63` (소비자 자신) | `getCompletedOrders` 실패를 `errors[]` 에 넣고 `completedOrderIds = new Set()` 로 둔 뒤 **그대로 마킹 루프로 진입** |

`kis.ts:152` 의 `KIS_OVERSEAS_ENABLED=false` 분기는 Facade catch 없이 곧장 위임했지만,
어댑터 자체가 3겹으로 삼켰으므로 **어차피 던질 수 없었다.**

### 피해

* **중복 진입** — 시스템이 포지션이 없다고 오인하고 같은 자리에 다시 들어간다
* **청산 추적 유실** — 브로커에서 실제로 작동 중인 주문을 DB 가 이미 죽은 것으로 본다

### 🔴 정정 — "지금은 DRY_RUN 이라 안전하다"는 전제는 **틀렸다** (라운드 3에서 확인)

착수 시 이 문서는 `DRY_RUN=true` 를 전제했다. **실거래는 이미 무장되어 있다.**

| 확인 | 값 |
|---|---|
| `system_config.safety_dry_run` | `[false]` (hex `66616C7365`, 문자열 "false") |
| `isDryRun()` (`dry-run.ts:32-41`) | 키가 **존재하고 파싱되면 그 값을 그대로 반환**한다. `.env` 폴백은 키가 **없을 때만** 도달하는데, 키는 존재한다 |
| `/api/health` | `"dryRun": false` — 앱이 스스로 해석한 값 |
| 킬스위치 | `false` |

즉 `.env` 의 `DRY_RUN=true` 는 **죽은 설정**이다. 이 결함들을 "모의거래라 여유 있다"로 읽은
판단은 전부 무효다. 실거래 계좌에서 실제 주문에 적용되는 코드다.

## 🔴 운영 실측 — 이 결함은 이미 한 번 발화했다 (2026-05-26)

가설이 아니라 **기록에 남은 사건**이다.

| 주문 | 종목·방향 | 수량 | 생성 | 종료 | 경과 |
|---|---|---|---|---|---|
| **#3137** | `NAS:SNDK` 매도 지정가 (`eid=0030357043`) | 1 | `2026-05-26 23:21:59` | **`23:22:05` `cancelled`** | **6초** |
| **#3138** | `NAS:SNDK` 매도 지정가 | 1 | `2026-05-26 23:41:03` | `23:43:07` `filled` | — |

시스템이 갓 접수된 주문을 6초 만에 "사라졌다"고 판정했고, 약 19분 뒤 **같은 종목·같은 방향·
같은 수량**의 대체 주문을 냈다. #3137 이 그때 브로커에 살아 있었다면 이것은 **이중 매도**다 —
이 작업이 막으려는 중복 포지션 위험이 문서상 위험이 아니라 실제로 발생한 사례.

> **날짜 주의 — 이것은 2026-05-26 의 사건이며 최근 기록이 아니다.**
> 확인 결과 **08-10 생성 주문 0건**, 킬스위치 해제(14:24) 이후 **상태 변경 0건**이고,
> 가장 최근 주문은 **08-07 의 #3217(`blocked`)** 이다.
> 사용자가 KIS 계좌를 대조한다면 **2026-05-26** 을 봐야 한다.

이 사례는 §① 의 여섯 겹 삼킴만으로는 설명되지 않는다. 조회가 **실패**한 것이 아니라
**성공했지만 아직 불완전**했던 경우이기 때문이다 → 아래 §유예 기간.

### 추가로 확인된 같은 계열의 오판 — 해외 미체결 조회 커버리지

KIS `inquire-nccs` 는 `OVRS_EXCG_CD` 를 필수로 받아 **한 번의 호출이 한 거래소만** 본다.
`kis-overseas.getActiveOrders` 는 `KIS_OVERSEAS_DEFAULT_EXCHANGE`(운영값 `NAS`) 하나만 조회한다.

→ `NYS`·`AMS` 종목의 미체결 주문은 **조회가 완벽히 성공해도 목록에 원래부터 없다.**
그런데 취소 판정은 "목록에 없음"을 근거로 삼으므로 **무조건 오판**한다.
실제 보유 종목에 `NYS:ORCL` 이 있다(T-012 테스트 픽스처가 운영 실측에서 온 것).
조회 실패를 삼키는 것과 결과가 같은, 같은 계열의 부재 추론 오류다.

---

## 설계

### ① 계약 — [[T-014-favorites-ai-refresh-failure|T-014]] 의 모양을 그대로 재사용한다

새 모양을 발명하지 않았다. 이 코드베이스에는 이미 "시장별 부분 실패를 보존해 넘기는"
확립된 계약이 있다 — `getBalancesDetailed()` → `{balances, ok[], failed[], complete}` 와
`getBalances()` → `BalancesIncompleteError`. **일관성이 우아함보다 중요하다**:
두 규약이 공존하면 읽는 사람이 매번 "어느 쪽이 안전 기본값이지?"를 다시 판단해야 한다.

```ts
export interface ActiveOrdersResult {
  orders:   { orderId: string; symbol: string }[];
  ok:       Market[];
  failed:   { market: Market; error: string }[];
  complete: boolean;
}
export class ActiveOrdersIncompleteError extends Error { failed; okMarkets; }

getActiveOrdersDetailed(): Promise<ActiveOrdersResult>   // 부분 결과 옵트인
getActiveOrders():         Promise<Order[]>              // 부분 실패면 throw (안전 기본값)
```

`BalancesIncompleteError` 와 동일하게 **던지는 쪽을 기본값**으로 뒀다 — 잘린 목록을 실수로
받아 부재 추론에 쓰는 새 호출부가 생기지 않게. 부분 결과가 필요하면 `…Detailed()` 로
**이름을 지정해 옵트인**해야 한다.

`getCompletedOrders` 는 호출 하나가 **심볼 하나 = 시장 하나**만 보므로 부분 실패라는 개념이
없다. Detailed 변형을 억지로 만들면 퇴화한 모양이 되므로, 어댑터가 던지고 그대로 전파한다.

### ② `rt_cd !== '0'` 을 "0건"과 분리 — 다만 경계를 정확히 긋는다

| 응답 | 판정 | 근거 |
|---|---|---|
| `!res.ok` | **throw** | 레이트리밋 HTTP 500 이 여기 떨어진다 |
| HTTP 200 + `rt_cd !== '0'` | **throw** | API 가 스스로 "실패"라고 말한 것. 이전 감사에서 지적된 conflation |
| `rt_cd === '0'` + 목록 필드 없음 | **0건** (경고 로그) | API 가 스스로 **"성공"** 이라고 말했다. 여기서 던지면 반대 방향의 조용한 정지가 생긴다 |
| `rt_cd === '0'` + 목록이 배열 아님 | **throw** | 해석 불가능한 형태 — 0건과 구분할 수 없다 |
| 예외(네트워크·스로틀) | **전파** | — |

3번 줄이 이 설계에서 유일하게 "관대한" 지점이고, 의도적이다. `rt_cd='0'` 은 부정할 근거가
없는 **명시적 성공 신호**다. 이것까지 실패로 만들면 §④ 의 역방향 위험이 상시화된다.

### ③ `syncPendingOrders` — 증거의 **방향**으로 판정을 나눈다

| 판정 | 성격 | 필요한 근거 |
|---|---|---|
| `partially_filled` | **증거 양성** — "체결 목록에 있다" | 그 종목의 체결 조회 **성공** 하나면 충분 |
| `filled` | 양성 + "잔량 없음" | 위 **＋** 잔량 부재의 근거 (§⑨) |
| `cancelled` | **증거 음성** — "어디에도 없다" | 그 시장 미체결 조회 성공 **＋** 그 종목 체결 조회 성공 **＋** 심볼이 커버리지 안 **＋** 유예 경과 (§⑧) |

이 구분이 핵심이다. **존재는 하나의 성공한 조회로 증명되지만, 부재는 관련된 모든 조회가
성공해야 증명된다.** 그래서 미체결 조회가 실패해도 체결 사실의 기록은 계속 동작한다 —
기능을 필요 이상으로 죽이지 않으면서 오판만 제거한다.

근거가 없으면 **판정하지 않고 이번 회차를 건너뛴다.** 취소 판정은 되돌릴 수 없는 쓰기이고,
보류는 되돌릴 수 있다. 다음 회차(5분 뒤)에 다시 시도한다.

### ④ 완결성은 **시장 단위** — 왜 전부를 막지 않는가

국내가 성공하고 해외만 실패했다면 **국내 미체결 목록의 완결성은 해외 조회 결과와 논리적으로
무관하다.** 국내 주문의 부재 추론은 여전히 완전히 성립한다.

한 시장의 실패로 전부를 막으면, 해외가 오래 불안정할 때 국내 동기화가 **무기한 정지**한다 —
그건 이 작업이 없애려는 조용한 정지를 다른 형태로 되살리는 것이다.
그래서 완결성 판정은 시장별로 하고, **자기 시장의 조회가 실패한 심볼은 절대 판정하지 않는다.**

### ⑤ 🔴 역방향 위험 — fail-closed 가 만드는 새로운 침묵

> 조회가 계속 실패하면 주문은 `pending` 에 영원히 남고, 실제로 취소·체결된 주문을 아무도
> 눈치채지 못한다. **그 침묵은 같은 병의 다른 형태다.**

세 가지로 막았다.

1. **"주문의 나이"가 아니라 "우리가 판단하지 못한 기간"을 잰다.**
   이 구분이 결정적이다. 정상적으로 6시간 걸려 있는 지정가 주문은 매 회차 미체결 목록에서
   발견되어 **정상 판정**되므로 미판정 시간이 0 이다. 반대로 방금 낸 주문이라도 조회가
   실패하면 그 순간부터 시계가 돈다. `orders.created_at` 을 썼다면 정상 주문이 전부
   알림을 울려 알림이 무의미해졌을 것이다.
   → `orders.id → 연속 미판정 시작 시각` 맵. 판정 성공 시 즉시 삭제, 미결 목록에서 빠지면 정리.
   프로세스 메모리인 이유는 `notify/throttle.ts` 선례와 같다(재기동 직후의 첫 실패는 다시
   알릴 가치가 있다). **DB 스키마를 늘리지 않았다.**

2. **임계 초과 시 스로틀 알림.** 기본 30분 = `strategy-eval` 5분 주기 기준 **연속 6회차 실패**.
   한두 회차의 일시적 레이트리밋으로 울리면 아무도 보지 않게 되고, 그러면 알림이 있으나 마나다.
   커버리지 사각지대는 **재시도로 낫지 않으므로**(코드 수정 필요) 별도 키·별도 레벨·훨씬 긴 창.

   | 알림 키 | 레벨 | 창 | 조건 |
   |---|---|---|---|
   | `order-sync:stale` | critical | 30분 | 조회 실패로 30분+ 미판정 |
   | `order-sync:coverage` | warning | 6시간 | 커버리지 밖 거래소 주문 존재 |

3. **"판정 못 함" ≠ "판정할 게 없음" 을 세 층 모두에서 구분.**

   | 층 | 판정할 게 없음 | 판정 못 함 |
   |---|---|---|
   | 반환값 | `complete:true, skipped:0, unreconciled:[]` | `complete:false, skipped:N, unreconciled:[{reason,detail,unreconciledForMs}]` |
   | 로그 | (무음) | `ORDER_SYNC_UNRECONCILED` grep 토큰 + 주문별 사유 |
   | 알림 | 없음 | 위 표 |

   `synced:0` 은 두 경우 모두 같다 — **그래서 `synced` 만 보던 예전 로그로는 구분이 불가능했다.**

   보류 사유는 대응이 다르므로 뭉개지 않는다:
   `active_query_failed` / `completed_query_failed` / `both_queries_failed` / `active_coverage_gap`.

### ⑥ 호출부 확인 — 새 신호가 다시 버려지지 않는가

`strategy-eval/route.ts:17` 은 `syncPendingOrders().then(...)` **fire-and-forget** 이었고,
`synced>0 || errors.length>0` 일 때만 한 줄 찍고 **`.catch(() => {})` 로 예외까지 통째로
버렸다.** 즉 반환값 `errors[]` 는 사실상 아무 데도 도달하지 않았다.

두 겹으로 대응했다.
* `syncPendingOrders` 가 **자기 안에서** 로그·알림을 낸다 → 호출부가 버려도 신호는 살아남는다.
* 그 위에 호출부 로그를 `complete=false` 조건까지 확장하고, `.catch(() => {})` 를
  실제 로그로 교체했다(동기화 자체가 던지는 경우 — 예: DB 조회 실패).

### ⑦ [[T-017-kis-rate-limit-throttle|T-017]] 과의 상호작용

`KisThrottleTimeoutError`·`KisThrottleQueueFullError` 는 이 경로를 그대로 흐른다.
둘 다 **"모름"** 으로 다뤄지고 "미체결 0건"이 되지 않는다 — 어댑터가 전파하고, Facade 가
`failed[]` 에 보존하며, `order-sync` 가 보류한다. 회귀 테스트를 세 층 모두에 넣었다.

T-017 배려로 **KIS 호출 수를 늘리지 않았다.** 해외 커버리지 문제를 거래소 3곳 팬아웃으로
푸는 안은 방금 배포한 유량 제어와 정면으로 부딪히므로 채택하지 않고, 대신 커버리지를
**데이터로 노출**해(`activeOrderExchanges()`) 소비자가 오판을 피하게 했다.

---

## Reviewer 라운드 1 — PASS WITH FINDINGS 반영

핵심 결함(8가지 취소 마킹 조합 전수, 추적 맵 누수 없음)은 확인 완료. HIGH 2건 추가 조치.

### ⑧ HIGH-1 · 취소 판정 최소 유예 기간

fail-closed 가 닫은 것은 **"조회가 실패한"** 경우다. 위 실측 사고는 **"조회가 성공했는데
아직 불완전했던"** 경우라 그 그물에 걸리지 않는다 — 방금 접수된 주문이 브로커 미체결 목록에
아직 실리지 않았고, 그 부재가 취소로 읽혔다.

→ 주문 생성 후 **기본 120초** 동안 취소 판정에서 제외하고 `too_fresh` 로 보류한다.

**기본값 120초를 고른 근거**

1. **자릿수 마진** — 사고는 6초에 발생했다. 120초는 20배다. "관측값보다 조금 큰 값"이 아니라
   **자릿수가 다른 값**을 골라야 같은 유형의 지연이 조금 더 길어져도 덮인다.
2. **해외 전파 지연** — 사고 주문이 `NAS:SNDK` 였다. 해외 주문의 브로커 내부 반영 지연을
   실측한 자료가 저장소에 없으므로, 모르는 값에 대해서는 넉넉한 쪽을 택한다.
3. **비용이 싸다** — 동기화 주기가 5분이라 유예 2분이 실제로 미루는 것은 **최대 한 회차**다.
   진짜 취소된 주문의 인지가 최대 5분 늦어질 뿐이고, 대가로 이중 주문을 막는다. **오류
   비용이 완전히 비대칭**이다.

조정(재배포 불필요): `system_config.order_sync_cancel_grace_sec` → env
`ORDER_SYNC_CANCEL_GRACE_SEC` → 기본값. `kis_rate_limit_per_sec` 와 같은 해석 순서다.
스로틀과 달리 **캐시를 두지 않았다** — 5분 주기에 회차당 1회만 불리는 비-hot path 라
캐시의 이득이 없고, 없으면 설정 변경이 즉시 반영된다.

**하한 30초를 둔 이유**: 이 값은 성능 손잡이가 아니라 **안전장치**다. 0 이나 5 로 내리면
실측된 6초 사고가 그대로 재현된다. 진단 목적이라도 코드 수정 없이 보호를 꺼버릴 수 있어서는
안 된다. (상한 3600초.)

**배치 위치가 중요하다** — 유예 검사는 `activeOrderIds.has(eid)` **뒤**에 둔다.
미체결 목록에 보이는 주문은 살아 있다는 **양성 증거**가 이미 있으므로 붙잡을 이유가 없다.
앞에 두면 정상 주문마다 보류가 쌓여 유예 기간 자체가 소음원이 된다.

**정체 시계에 올리지 않는다.** `too_fresh` 는 판정 실패가 아니라 **의도된 대기**다.
시계에 올리면 건강한 새 주문마다 30분 뒤 critical 알림이 울려 §⑤ 알림이 무의미해진다.
같은 이유로 `complete` 도 깎지 않고(`skipped` 에는 계산됨), `too_fresh` 만 있는 회차는
`ORDER_SYNC_UNRECONCILED` 경고도 찍지 않는다. 유예를 넘겨도 안 풀리면 다른 사유로 승격된다.

### ⑨ HIGH-3 · 부분체결을 완결로 기록하지 않음

체결 목록에 있다는 것은 **"최소한 일부가 체결됐다"** 만 증명한다. **"전량 체결됐다"** 는
"잔량이 남아 있지 않다"가 더해져야 하고 — 그건 다시 **부재 추론**이다. 즉 §③ 에서 `filled` 을
"증거 양성 하나면 충분"으로 분류한 것 자체가 절반만 맞았다.

| 상황 | 판정 | 이유 |
|---|---|---|
| 미체결 목록 신뢰 가능 + 그 안에 **있다** | `partially_filled` | 잔량이 아직 작동 중 |
| 미체결 목록 신뢰 가능 + 그 안에 **없다** | `filled` | 신뢰할 수 있는 부재 |
| 신뢰 불가 + **체결수량 ≥ 주문수량** | `filled` | **수량이라는 양성 증거** — 부재 추론이 필요 없다 |
| 신뢰 불가 + 그 외 | `partially_filled` | 완결을 단정하지 않는다. 비종결 상태라 다음 회차에 자가 교정 |
| `market` 주문 | `filled` | 미체결 목록에 **원래** 없으므로 그 부재는 무정보 |

`filled` 오기록은 "포지션이 닫혔다"는 신호라 중복 진입으로 이어진다. `partially_filled`
오기록은 다음 회차에 교정된다. **오류 비용이 비대칭**이므로 불확실하면 후자로 기운다.

세 번째 줄(수량 근거)이 없으면 커버리지 밖(`NYS`/`AMS`) 주문이 전량 체결돼도 **영원히
`partially_filled`** 에 갇힌다. 수량은 부재 추론 없이 완결을 직접 증명하므로 그 구멍을 막는다.

체결 수량 집계는 **합이 아니라 최대값**을 쓴다 — KIS 국내 `tot_ccld_qty` 는 주문당 **누적**
값이라 여러 행을 더하면 중복 계산이 되고, 실제로는 부분체결인 주문을 `filled` 로 오판한다.
최대값은 누적·개별 두 표현 모두에서 **과대평가하지 않으므로**, 틀리더라도 항상 보수적인
쪽으로 틀린다.

부수 조치: `SELECT` 에 `status` 를 추가하고 **상태가 실제로 바뀔 때만 UPDATE** 한다.
`partially_filled` 는 비종결 상태라 다음 회차에도 같은 분기로 들어오므로, 무조건 쓰면 매
5분마다 UPDATE 가 나가고 `synced` 가 부풀려진다.

---

## Reviewer 라운드 2 — HIGH-1 확인, **H-4 신규 발견**

HIGH-1 은 mutation 수준에서 닫힌 것으로 확인. HIGH-3 을 고치는 과정에서 **내가 새 침묵을
만들었고**(H-4), 사용자 승인으로 T-018 안에서 함께 처리했다.

### 🔴 H-4(A) · 소수점 수량 주문이 영원히 `partially_filled` 에 갇힌다

§⑨ 에서 "미체결 목록을 못 믿을 때는 **체결수량 ≥ 주문수량**으로 완결을 증명한다"는 경로를
넣었다. 그 비교의 오른쪽이 틀렸다.

| 지점 | 값 |
|---|---|
| `dry-run.ts:136` `INSERT INTO orders … quantity` | `req.quantity` — **자르지 않은 원본** (예: `1.7`) |
| `kis-overseas.ts` `ORD_QTY` | `Math.floor(quantity)` — **잘린 값** (`1`) |

브로커는 자기가 받은 `1` 을 넘겨 채울 수 없는데 비교 대상은 `1.7` 이다. **부등식이 결코
성립하지 않는다.** 전량 체결된 주문이 비종결 상태에 갇혀 5분마다 KIS 조회를 영원히 소모한다
— 방금 배포한 [[T-017-kis-rate-limit-throttle|T-017]] 의 유량 예산을 잠식하는 것까지 포함해
정확히 **내가 없애려던 유형의 조용한 덫**이다.

**조치**: 자르는 규칙을 다시 유도하지 않고 — 반올림이 조금이라도 다르면 버그는 자리만 옮긴다 —
송신 경로가 쓰던 계산을 `src/lib/exchanges/order-quantity.ts` 의 `submittedQuantity(market, qty)`
로 옮기고, **송신부(`kis-overseas`·`kis-domestic`)와 판정부(`order-sync`)가 같은 함수를
부르게** 했다. 두 경로가 갈라질 수 있는 구조 자체를 없애는 것이 요점이다.
국내는 현행대로 통과(가공 없음), 해외는 `Math.floor` — **현행 동작을 정확히 반영만 하고
송신 동작은 바꾸지 않았다.**

### 현재 노출도 — H-4 는 **아직 한 번도 발화한 적이 없다**

| 항목 | 실측 |
|---|---|
| 소수점 수량 주문 | **79건** (65 아님) — 전부 해외 지정가 |
| 상태 | `rejected` 70 + `blocked` 9 — **브로커 도달 0건** |
| `exchange_order_id` | 없음 → `syncPendingOrders` 대상이 된 적 없음 |
| NYS/AMS | 41건 |
| 현재 order-sync 대상 | **0건** |

즉 **활성 사고가 아니라 [[T-017-kis-rate-limit-throttle|T-017]] 이 열어 둔 잠재 위험**이다.
이 제출들을 억누르고 있던 것은 레이트리밋 거절이었고, T-017 이 그것을 없앴으므로 **앞으로**
브로커에 도달하기 시작한다. 지금 고치는 이유가 이것이다.

### 🔴 H-4(B) · 확인 불가능한 부분체결이 조용해진다

`partially_filled` 은 **비종결 상태**다. 잔량이 살아 있는지 확인할 수단이 있으면 다음 회차에
스스로 풀린다. 없으면 — 커버리지 밖(`NYS`/`AMS`)이거나 미체결 조회 실패가 지속되면 —
그 주문은 영원히 거기 머문다. 그런데 §⑨ 구현은 상태를 쓰고 `reconciled()` 를 불러
**`unreconciled` 에 넣지 않았다.** 즉 보고 경로가 아예 없었다.

**조치**: 새 사유 `partial_fill_unconfirmable`. 임계(기본 30분 = 6회차) 이상 지속될 때만
승격하고, **6시간 warning** 채널로 보낸다(30분 critical 아님).

판별 기준을 정확히 맞췄다:

| 상황 | 승격? |
|---|---|
| 잔량이 미체결 목록에 **보인다** (`activeReliable` + 목록에 있음) | ❌ — 확인 가능한 정상 부분체결 |
| 임계 이전 (1~5회차) | ❌ — 잔량이 곧 체결될 수 있는 정상 상황 |
| 커버리지 밖 + 임계 초과 | ✅ 구조적으로 확인 불가 |
| 조회 실패 지속 + 임계 초과 | ✅ |

알림 키를 `order-sync:coverage` 와 **나눴다**(`order-sync:partial-unconfirmed`).
`sendAlertThrottled` 는 키 단위로 창을 잡으므로 같은 키를 쓰면 둘 중 하나가 다른 하나를
조용히 억눌러 버린다 — 이 작업이 없애려는 바로 그 침묵이다.

문구는 **양성 오탐을 전제로** 썼다. 장 마감 때 브로커가 잔량을 취소하는 것은 완전히 정상이고,
그 경우 이 알림은 오류 통보가 아니라 확인 요청이다. 정상 상황을 에러처럼 알리면 사람이
무시하기 시작하고, 그러면 알림이 있으나 마나가 된다. (테스트가 이 문구를 고정한다.)

### 💬 Leader 질문에 대한 답 — "DB 에 잘린 수량을 기록하는 게 근본 해결인가"

**부분적으로 그렇다. 다만 그것만으로는 부족하고, 순서가 틀리면 더 나빠진다.**

1. **문제 인식에는 동의한다.** DB 가 `1.7`, 브로커가 `1` 이면 `orders` 행은 "무엇을
   주문했는가"에 대해 **틀린 기록**이다. 체결률 분석·포지션 재구성·`amount_krw` 정합성 등
   모든 하위 소비자가 그 오차를 물려받는다. 이번 조치는 *판정*을 바로잡았을 뿐 *기록*은
   여전히 틀려 있다.
2. **다만 INSERT 를 바꾸는 것으로는 안 된다.** `INSERT` 는 `dry-run.ts:128` — **안전 게이트
   통과 전, 송신 전**이다. 그 시점에는 이 주문이 송신될지(kill switch·한도·DRY_RUN 에
   걸릴지), 어느 어댑터를 탈지조차 확정되지 않았다. 따라서 "송신 수량을 기록한다"는 실제로는
   **송신 성공 후 UPDATE 를 한 번 더 하는 것**이고, `dry_run`/`rejected`/`blocked` 분기마다
   의미를 따로 정해야 한다.
3. **두 값을 다 갖는 쪽이 더 정확하다.** `quantity`(요청)와 `submitted_quantity`(실제 송신)를
   나누면 "0.7주는 어디로 갔는가"를 사후에 설명할 수 있다. 지금은 그 정보가 아예 소실된다.
   다만 스키마 변경이라 오늘 범위 밖이다.
4. **더 깊은 질문은 따로 있다** — 애초에 왜 해외 주문에 소수점 수량이 생성되는가. 79건 전부
   거절/차단됐다는 것은 사이징 로직이 **브로커가 받을 수 없는 수량**을 만들고 있다는 뜻이다.
   가장자리에서 잘라 붙이는 것은 그 사실을 가린다. 진짜 근본 해결은 **사이징 시점에 floor
   하고, 0주가 되면 주문 자체를 내지 않는 것**이다. 그러면 요청과 송신이 처음부터 일치하므로
   3번의 스키마 질문도 상당 부분 사라진다.

→ **권고 순서**: (1) 사이징 시점 floor + 0주 스킵 → (2) 그래도 남는 불일치가 있으면 그때
`submitted_quantity` 컬럼. 별도 task 로 두기를 제안한다. 오늘 건드리지 않았다.

### 정정 — `notify/throttle.ts` 를 못 건드린다는 내 판단

라운드 1 회신에서 "edge-triggered 승격은 `notify/throttle.ts` 확장이 필요해 범위를 넘는다"고
썼다. **그 근거는 부분적으로 틀렸다** — `resetAlertThrottle(key)` 가 이미 존재하고
`volatility-guard.ts` 가 이미 쓰고 있으므로, 잠금 해제는 사실상 한 줄이다.

결론(T-018 밖에 둔다) 자체는 다른 근거로 유지한다: 공유 알림 모듈의 **의미**를 바꾸는 일이라
kill-switch·drawdown 알림까지 영향권이고, 현재 실제 노출이 작다. 다만 "기술적으로 불가능/
과도하다"가 아니라 **"범위 판단"** 이었다고 정정해 둔다.

그리고 reviewer 의 더 날카로운 지적을 기록해 둔다 —
> **이번 변경에서 진짜 알림 피로 위험은 너무 자주 우는 경보가 아니라, H-4 처럼 한 번도 울지
> 않는 경보였다.**

내가 라운드 1에서 걱정한 방향(과다 알림)은 실제 위험의 반대편이었다.

---

## 실패 조합별 동작 (판정 vs 보류)

`D`=국내 심볼, `O`=해외 심볼(커버리지 내), `O*`=해외 심볼(NYS/AMS, 커버리지 밖)

| 국내 active | 해외 active | 해당 종목 completed | 대상 | `filled` | `cancelled` | 결과 |
|---|---|---|---|---|---|---|
| ✅ | ✅ | ✅ | D, O | 가능 | **가능** | 전부 정상 판정 |
| ❌ | ✅ | ✅ | D | 가능 | 안 함 | D 보류 `active_query_failed` |
| ❌ | ✅ | ✅ | O | 가능 | **가능** | O 는 정상 판정 (시장별 완결성) |
| ✅ | ❌ | ✅ | D | 가능 | **가능** | D 는 정상 판정 |
| ✅ | ❌ | ✅ | O | 가능 | 안 함 | O 보류 `active_query_failed` |
| ✅ | ✅ | ❌ | D, O | 안 함 | 안 함 | 보류 `completed_query_failed` (market 주문 포함) |
| ❌ | ❌ | ❌ | D, O | 안 함 | 안 함 | 보류 `both_queries_failed` |
| ✅ | ✅ | ✅ | O* | 가능 | 안 함 | 보류 `active_coverage_gap` (조회는 성공했지만 근거가 구조적으로 없다) |
| ✅ | (비활성) | ✅ | O | 안 함 | 안 함 | `KIS_OVERSEAS_ENABLED=false` → 해외는 `ok` 에 없으므로 보류 |

**market 주문**: 미체결 목록에 원래 나타나지 않으므로 취소 추론 대상이 아니다.
체결 조회가 성공했고 거기 없으면 "아직 체결 전"이라는 **판정된** 상태(보류 아님).
체결 조회가 실패하면 판정 자체를 못 하므로 보류.

**유예 기간(§⑧)** 은 위 표의 `cancelled` 열에만 걸린다. 생성 후 120초 미만인 주문은
`cancelled` 가 가능한 칸에서도 판정되지 않고 `too_fresh` 로 보류된다 — 단, 미체결 목록에
**보이는** 주문은 유예 대상이 아니라 정상 판정이다(양성 증거 우선).
`filled`/`partially_filled` 열은 유예의 영향을 받지 않는다.

### 판정 순서 (per order)

```
① 체결 목록에 있다(조회 성공)  → §⑨ 규칙으로 filled / partially_filled  … 상태가 바뀔 때만 UPDATE
② 체결 조회 실패               → 보류 completed_query_failed / both_queries_failed
③ market 주문                  → 판정됨(변경 없음)
④ 그 시장 미체결 조회 실패      → 보류 active_query_failed
⑤ 커버리지 밖 심볼             → 보류 active_coverage_gap
⑥ 미체결 목록에 있다           → 판정됨(살아 있음, 변경 없음)
⑦ 생성 후 120초 미만           → 보류 too_fresh          ← 시계 올리지 않음
⑧ 그 외                        → cancelled
```

---

## 변경 파일

| 파일 | 변경 |
|---|---|
| `src/lib/exchanges/kis-domestic.ts` | `getActiveOrders`·`getCompletedOrders` — 3겹 삼킴 제거, `rt_cd` 분리, `kisBodyText` 임포트. **라운드 3**: `ORD_QTY` 를 `submittedQuantity` 경유 |
| `src/lib/exchanges/kis-overseas.ts` | 동일 + 무음 `catch {}` 제거 + `activeOrderExchanges()` 신설(커버리지 노출). **라운드 3**: `ORD_QTY` 를 `submittedQuantity` 경유 |
| `src/lib/exchanges/order-quantity.ts` | **신규(라운드 3)** — `submittedQuantity()`. DB 수량과 실제 송신 수량이 갈라지지 않게 하는 단일 진실 공급원 |
| `src/lib/exchanges/kis.ts` | `ActiveOrdersResult`·`ActiveOrdersIncompleteError`·`getActiveOrdersDetailed()` 신설, `getActiveOrders()` 는 부분 실패 시 throw, `overseasActiveOrderExchanges` 재수출 |
| `src/lib/safety/order-sync.ts` | 전면 재작성 — fail-closed 판정, 시장별 완결성, 미판정 추적, 스로틀 알림, `OrderSyncResult`. **라운드 2**: 취소 유예(`too_fresh`+`system_config`/env 설정), `partially_filled` 판정, 상태 변경 시에만 UPDATE |
| `src/app/api/cron/strategy-eval/route.ts` | `.catch(() => {})` 제거, `complete=false` 를 로그 조건에 포함 |
| `src/lib/safety/__tests__/order-sync.test.ts` | 새 계약으로 갱신 + "할 일 없음" 케이스 추가 |
| `src/lib/safety/__tests__/order-sync-fail-closed.test.ts` | **신규** — T-018 회귀 |
| `src/lib/exchanges/__tests__/kis-active-orders-partial.test.ts` | **신규** — Facade 부분 실패 |
| `src/lib/exchanges/__tests__/kis-order-query-failures.test.ts` | **신규** — 어댑터 삼킴 제거 |
| `src/app/api/cron/__tests__/strategy-eval-lane.test.ts` | mock 을 새 반환 계약에 맞춤 |

---

## 검증

### 라운드 1 (착수 시)

```
$ npm run typecheck   → exit 0, 무출력
$ npm test            → Test Suites: 88 passed / Tests: 1310 passed
```
기준선 **85 suites / 1241 tests** → **88 / 1310** (+3 suites, +69 tests).

### 라운드 2 (reviewer HIGH-1·HIGH-3 반영 후)

```
$ npm run typecheck
> stockinvest@0.1.0 typecheck
> node ./node_modules/typescript/bin/tsc --noEmit
(exit 0, 무출력)

$ npm test
Test Suites: 88 passed, 88 total
Tests:       1330 passed, 1330 total
Snapshots:   0 total
Time:        9.059 s
Ran all test suites.
```

기준선 **88 / 1310** → **88 / 1330** (+20 tests). 기존 실패 0건.

### 라운드 3 (reviewer H-4 반영 후)

```
$ npm run typecheck
> stockinvest@0.1.0 typecheck
> node ./node_modules/typescript/bin/tsc --noEmit
(exit 0, 무출력)

$ npm test
Test Suites: 88 passed, 88 total
Tests:       1341 passed, 1341 total
Snapshots:   0 total
Time:        9.061 s
Ran all test suites.
```

기준선 **88 / 1330** → **88 / 1341** (+11 tests). 기존 실패 0건.

| 요구 (라운드 3) | 위치 |
|---|---|
| 소수점 수량 해외 주문이 전량 체결 시 `filled` 도달 | `order-sync-fail-closed` §⑨ (1.7주·2.9주 + 갇힘 회귀) |
| 커버리지 갭 `partially_filled` 가 N회차 후 6시간 warning 승격 | 동 §⑩ (키·레벨·TTL 전부 단정) |
| 잔량이 살아 있는 정상 부분체결은 **승격되지 않음** | 동 §⑩ (10시간 뒤에도 미승격) |
| HIGH-1 유예 동작 무회귀 | 동 §⑦·§⑧ 전량 통과 |
| 자르기가 진짜 부분체결을 무르게 만들지 않음 | 동 §⑨ (5.4주 중 2주 → `partially_filled`) |
| 30분 critical 채널로 새지 않음 | 동 §⑩ |

요구된 커버리지 전부 포함:

| 요구 | 위치 |
|---|---|
| active 조회 실패가 아무것도 cancelled 로 만들지 않음 | `order-sync-fail-closed` §① (회귀 포함) |
| completed 조회 실패가 cancelled 로 만들지 않음 | 동 §② (여섯 번째 삼킴 회귀 포함) |
| 조회 성공 시 진짜 취소 주문은 여전히 감지 | 동 §③ |
| 시장별 부분 성공 | 동 §④ (양방향 + 커버리지 갭 2건) |
| 스로틀 예외 = "모름" | 동 §⑤ / `kis-active-orders-partial` / `kis-order-query-failures` (3층 전부) |
| 역방향 위험 | 동 §⑥ (임계 알림·시계 리셋·"못 함 vs 없음"·grep 토큰·추적 정리) |
| **갓 접수된 주문은 취소 판정 안 함** | 동 §⑦·§⑧ — 실측 사고 재현(생성 6초 시점, #3137 값 그대로) |
| **유예 중 주문은 정체 시계를 시작하지 않음** | 동 §⑥ (2회차 연속 유예 → `oldestUnreconciledMs=0`), §⑦ |
| **유예 시간 조정 가능** | 동 §⑧ — `system_config` / env / 하한 클램프 / `clampGraceSec` 단위테스트 |
| **양쪽 목록에 있으면 `partially_filled`** | 동 §⑨ (+ `filled` 로 기록되지 않는 회귀) |
| **`partially_filled` → 이후 회차에 `filled`** | 동 §⑨ (재기록 억제 · 잔량 소멸 후 마무리) |

---

## 지킨 제약

`npm run typecheck` / `npm test` 만 실행 — **build·install·dev 없음**. 새 의존성 없음.
pm2 조작 없음. git commit/push/stash 없음(작업물은 미커밋 상태로 승인 대기).
DB 수동 쓰기 없음, **스키마 변경 없음**(미판정 추적을 프로세스 메모리로 설계한 이유 중 하나).
`safety_kill_switch`·`exit_engine_enabled` 등 안전 설정 미변경. `board.md` 미수정.

---

## 📋 백로그 이관 — 이번 범위에 **포함하지 않음** (Leader 판정)

### HIGH-2 · 페이지네이션 미처리

KIS 조회는 `CTX_AREA_FK100`/`NK100`(해외는 `FK200`/`NK200`) 연속조회 키를 쓰는데, 어댑터는
**빈 문자열로 1페이지만** 요청하고 `tr_cont` 응답 헤더도 보지 않는다. 미결 주문이 한 페이지를
넘으면 2페이지 이후의 주문은 **성공한 조회 결과에도 나타나지 않는다.**

→ `active_coverage_gap` 과 **완전히 같은 구조의 결함**이다. 조회는 성공했는데 목록이
구조적으로 불완전하고, 그 부재가 취소로 읽힌다. 다른 점은 커버리지 갭이 *어느 심볼이
사각지대인지 미리 알 수 있는* 반면, 페이지네이션은 **알 수 없다**는 것이다 — 그래서 방어도
더 어렵다(1페이지가 가득 찼는지로 추정하는 정도).

**승격 조건**: 동시 미결 주문 수가 늘어날 때. 현재는 주문 빈도가 낮아 1페이지를 넘길 일이
사실상 없다. 다만 §⑧ 유예 기간은 이 결함에는 **도움이 되지 않는다**(시간 문제가 아니라 양의
문제) — 승격 시점을 놓치지 않는 것이 중요하다.

### MED/LOW

Leader 가 별도 기록. 이번 라운드에서 건드리지 않았다.

### MED 하나에 대한 의견 — "구조적 보류에 대한 30분 알림이 영원히 반복되는 문제"

Leader 질문: *구조적으로 해소 불가능한 보류에 30분마다 critical 이 계속 울리면, 사람이
무시하도록 길들여진다 — 그건 우리가 밤새 없애 온 침묵이 다른 경로로 돌아오는 것 아닌가.*

**동의한다. 그리고 그게 정확히 알림 설계의 핵심 실패 모드다.** 다만 현재 코드는 이미 부분적으로
그 구분을 하고 있다는 점을 먼저 짚어두고 싶다 — `active_coverage_gap` 은 `order-sync:stale`
critical 에서 **제외**되고 6시간 창의 warning 으로 따로 나간다. 이유가 바로 이것이었다:
재시도로 낫지 않는 것을 재시도 주기로 알리면 정보량이 0 이다.

남은 진짜 문제는 **"전이"** 다. 지금 구조는 사유가 고정이라고 가정하지만, 실제로는
`active_query_failed` 가 30분·6시간·3일 계속되면 그것은 더 이상 "일시적 실패"가 아니라
**구조적 상태**다. 그런데 알림은 여전히 30분짜리 일시적 실패 문구로 반복된다.

제안하는 방향(구현 아님, 판단 요청):

1. **에스컬레이션 후 침묵** — 같은 키가 N회(예: 4회 = 2시간) 반복되면 "이건 이제 구조적
   문제다"라는 **다른 문구의 알림을 한 번** 보내고 그 키를 잠근다. 해소되면(정상 판정 1회)
   잠금을 풀어 다음 발생 때 다시 처음부터 울린다. 즉 **상태 전이에서만 알린다**(level-triggered
   가 아니라 edge-triggered).
2. **누적은 알림이 아니라 대시보드로** — "몇 건이 며칠째 미판정인가"는 반복 알림이 아니라
   상시 표시할 값이다. 알림은 *변화*를, 화면은 *상태*를 담당해야 한다.
3. 두 방식 모두 `notify/throttle.ts` 를 확장해야 하고, 그 모듈은 kill-switch·drawdown 등
   **다른 안전 알림도 함께 쓴다**. 그래서 T-018 안에서 손대는 것은 범위를 넘는다고 판단했다 —
   별도 task 로 두고 알림 정책 전체를 한 번에 설계하는 편이 낫다.

즉 **문제 인식에는 전적으로 동의하되, 해법은 order-sync 국소 수정이 아니라 알림 계층의
공통 정책**이어야 한다는 것이 내 의견이다.

---

## 남긴 것 (의도적)

* **해외 미체결 조회의 거래소 확장** — `NYS`/`AMS` 를 실제로 조회하려면 거래소별 호출이
  필요하고, 이는 [[T-017-kis-rate-limit-throttle|T-017]] 유량 제어와 충돌한다. 이번엔
  **오판만 제거**하고 사각지대를 알림으로 드러내는 데서 멈췄다. 근본 해결은 별도 판단 필요.
  (그 사이 `NYS`/`AMS` 주문은 `filled` 는 정상 판정되고, 취소만 보류되어 `pending` 에 남는다.)
* **미판정 추적의 영속화** — 프로세스 재기동 시 시계가 초기화된다. `notify/throttle.ts` 와
  같은 트레이드오프이며 의도된 동작이다. 재기동이 잦아 알림이 지연되는 정황이 관측되면
  그때 DB 로 옮긴다.
