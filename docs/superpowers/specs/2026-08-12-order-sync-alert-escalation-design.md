# order-sync 판단보류 알림 에스컬레이션 + 대시보드 설계

**작성일**: 2026-08-12
**관련**: board.md "[신규, T-018 MED-4 파생] 구조적으로 해결 불가능한 hold 에 30분마다 critical 경보가 영원히 반복된다"
**연관 task**: [[T-018-order-sync-fail-closed]] (이 문제를 낳은 원 구현), T-022(이 설계의 구현 task, 미착수)

## 1. 문제

`src/lib/safety/order-sync.ts`의 `reportUnreconciled()`가 판단보류 주문이 있으면
`sendAlertThrottled('order-sync:stale', 'critical', ..., STALE_ALERT_TTL_MS=30분)`을 호출한다.
`src/lib/notify/throttle.ts`의 `sendAlertThrottled`는 **level-triggered**다 — 조건이 유지되는 한
30분마다 영원히 재발화한다. 구조적으로(예: 거래소 조회 자체가 며칠째 실패) 해결 불가능한 hold가
생기면 이 알림이 하루에도 수십 번 울려서 사람이 무시하도록 훈련시키고, 결국 진짜 신호가 묻힌다
— 이 프로젝트가 T-007·T-012·T-014·T-018 내내 없애온 "침묵"의 정반대 실패 모드다.

board.md에 이미 합의된 원칙: N회 반복 후 "이제 구조적 상태다" 경보를 1회만 보내고 잠금 →
정상 정리되면 해제. "몇 건이 며칠째 판단 불가인가"는 반복 경보가 아니라 대시보드에 있어야 한다.

## 2. 범위

- **포함**: `order-sync:stale` 알림 경로 하나만. 관련 신규 대시보드 카드.
- **제외**: `throttle.ts`(`sendAlertThrottled` 자체)는 무변경 — 킬스위치·낙폭경보 등 나머지
  12개 호출처, order-sync 내 `coverage`/`partial-unconfirmed`/`partial-settled-*`(6시간 TTL이라
  체감 반복 문제가 덜함)는 이번 범위 밖. 필요해지면 같은 패턴을 재사용할 수 있게 만들되,
  기존 호출처를 억지로 옮기지는 않는다(최소 침습·additive 원칙, T-018/T-019/T-020과 동일).

## 3. 핵심 통찰 — 별도 카운터 대신 기존 "나이"를 영속화

`order-sync.ts:557`의 `unreconciledSince`는 **프로세스 메모리 Map**이다(주문 id → 최초 판단보류
시각). 이 자체가 board.md의 다른 항목("T-018 MED 잔여 ③ 판단불가 타이머가 프로세스 메모리라
배포 버스트 중 리셋")이 이미 지적한 결함이다. pm2가 이 앱을 자주 재시작하므로(누적 300회+),
이걸 고치지 않고 "N회 반복 카운터"를 새로 얹으면 재시작마다 리셋되어 진짜 구조적 상태에
거의 도달하지 못한다.

→ 새 카운터를 만드는 대신, **이미 계산 중인 "판단보류 나이"를 DB에 영속화**해서 그 나이 하나로
반복 여부·에스컬레이션 여부·대시보드 표시를 전부 유도한다. 상태가 하나면 리셋 시나리오도
하나로 줄어든다.

## 4. 아키텍처

### 4.1 판단보류 시작시점 영속화

신규 테이블(부팅 시 idempotent `CREATE TABLE IF NOT EXISTS`, `src/lib/db.ts` 패턴 준수):

```sql
CREATE TABLE IF NOT EXISTS order_sync_stale_tracking (
  order_id      BIGINT PRIMARY KEY,
  symbol        VARCHAR(20) NOT NULL,
  first_stale_at DATETIME NOT NULL,
  escalated_at  DATETIME NULL
);
```

**2026-08-12 코드 확인 후 수정**: 애초 계획은 기존 인메모리 `unreconciledSince: Map<number,
number>`(order-sync.ts:557) 자체를 DB로 옮기는 것이었으나, 실제 코드를 읽어보니 그 주석이
"재시작 시 초기화되는 게 오히려 맞다(재기동 직후의 첫 실패는 다시 알릴 가치가 있다)"고
**의도를 명시**하고 있었다 — `notify/throttle.ts`와 같은 철학이다. `unreconciledSince`는
**손대지 않는다.**

대신 **30분 critical 알림 대상(`staleFailures`)에 처음 포함된 주문만** 위 테이블에 가볍게
기록한다(`first_stale_at`은 그 시점의 `u.unreconciledForMs`로 역산해 실제 시작 시각을 근사).
쓰기 대상이 "판단보류 전체"가 아니라 "이미 30분 넘어 알림이 나간 주문"으로 좁혀져 쓰기 빈도도
낮다. 이 테이블의 시각만 재시작에도 살아남으면 되고, 원래의 `unreconciledSince`(스로틀 판단용)는
기존 철학 그대로 둔다.

### 4.2 2단계 알림 (나이 기준)

- `age < STALE_MS`(30분, 기존): 아직 알리지 않음. **무변경**.
- `STALE_MS ≤ age < STRUCTURAL_MS`(2시간, 신규): 기존과 동일하게 `sendAlertThrottled`로
  30분마다 critical 반복. **무변경**(회귀 없음). 이때 `order_sync_stale_tracking`에 없으면
  INSERT(첫 알림 시점 기록).
- `age ≥ STRUCTURAL_MS`(`order_sync_stale_tracking.first_stale_at` 기준, DB 값이라 재시작에도
  유지됨): 그 주문이 **처음으로**(`escalated_at IS NULL`) 이 문턱을 넘는 순간 딱 1번 별도
  문구로 발송:

  > "🔴 주문 상태 확인 불가가 구조적 상태로 전환됐습니다 — {symbol}#{id}가 {N}시간째
  > 확인되지 않고 있습니다. 반복 알림은 여기서 멈추고 대시보드에서 계속 추적합니다.
  > 근본 원인(KIS 조회 실패)을 확인하세요."

  수준은 critical 유지(합의됨) — 반복만 멈추고 심각도는 낮추지 않는다.

  동시에 `escalated_at = now`로 UPDATE한다. 이후 라운드에서 `escalated_at IS NOT NULL`인
  주문은 **30분 반복 대상(staleFailures)에서 제외** — 이게 "잠금"이다.

  그 주문이 실제로 reconciled 되어(체결/취소 확정) `r.unreconciled`에 더 이상 나타나지 않으면,
  `order_sync_stale_tracking`에서 그 행을 **DELETE**한다 — "해제". 이후 그 주문(또는 같은
  심볼의 다른 신규 주문)이 다시 걸리면 완전히 처음부터(30분 반복 단계부터) 다시 시작한다.

### 4.3 대시보드

신규 `GET /api/safety/order-sync-status` — `order_sync_stale_tracking`을 조회해 현재 판단보류
30분을 넘긴 주문 목록 + 나이(시간) + escalated 여부를 반환.

UI: `SafetyBar` 또는 인접한 새 카드에 요약 배지 — "N건 판단 보류 중(최장 X시간, 그중 M건
구조적)". 클릭 시 심볼·사유·나이별 상세 목록 펼침. 0건이면 배지 자체를 숨긴다(평소엔 안 보여야
"침묵으로 위장한 정상"과 "진짜 0건"이 구분된다 — 이 프로젝트가 계속 지켜온 원칙).

## 5. 안전장치 영향

- 주문·자금 경로 무변경 — `submitOrder()`/`kis.createOrder` 호출 없음, 순수 관측·알림 계층.
- fail-closed 원칙(T-018) 무영향 — "판단보류를 취소로 오판하지 않는다"는 기존 동작은 그대로,
  이번 변경은 그 판단보류 상태를 **어떻게 알리는가**만 바꾼다.
- 신규 테이블 2개는 additive — 기존 스키마·쿼리에 영향 없음.

## 6. 확인된 파라미터

| 파라미터 | 값 | 근거 |
|---|---|---|
| `STRUCTURAL_MS` | 2시간(30분×4) | board.md 제안값, 사용자 확정(2026-08-12) |
| 구조적 전환 알림 수준 | critical 유지 | "여전히 심각도는 같다, 반복만 멈춘다", 사용자 확정 |

## 7. 미해결/후속 검토 항목 (구현 단계에서 developer/reviewer가 확인)

- `unreconciledSince` → DB 이관이 `order-sync.ts`의 다른 소비처(`staleCount`,
  `oldestUnreconciledMs` 계산 등)에 미치는 영향 전수 확인 필요.
- 신규 테이블 쓰기가 order-sync 크론 루프의 매 라운드마다 발생 — 쿼리 비용·락 경합이
  무시할 만한지 실측 필요(대상 건수가 보통 0~수 건이라 낮을 것으로 예상되나 확인 필요).
- 대시보드 API 인증 범위(로그인 사용자 전체 공개 vs 관리자 전용) — 기존 `/api/health`·
  `SafetyBar` 패턴을 따르면 로그인 사용자 전체 노출이 일관되나, 재확인 필요.
- `order_sync_escalation`에 남아 있는데 서버가 재시작되어 `unreconciledSince`(신 테이블
  기준으로는 `order_sync_unreconciled`)와 잠깐 불일치하는 경합 창 — 이론적 위험, 발생 시
  최악의 경우 "구조적 알림 중복 1회" 정도이므로 심각도 낮음(참고: T-019가 비슷한 이유로
  `UNIQUE` 제약 대신 런타임 탐지기를 택한 전례 있음).

## 8. 이번 설계에서 의도적으로 하지 않은 것

- `throttle.ts`/`sendAlertThrottled` 자체의 의미론 변경 — 범위를 `order-sync:stale`로 좁혀
  T-018이 우려했던 폭발반경(킬스위치·낙폭경보 등 공유 호출처)을 피한다.
- `coverage`/`partial-unconfirmed`/`partial-settled-*` 알림 이관 — 6시간 TTL이라 체감
  반복 문제가 덜함, 별도 필요성이 생기면 그때 같은 패턴 재사용.
