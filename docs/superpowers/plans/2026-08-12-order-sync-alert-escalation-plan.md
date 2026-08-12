# order-sync 판단보류 알림 에스컬레이션 + 대시보드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `order-sync:stale` 알림이 구조적으로 해결 불가능한 판단보류 건에 대해 30분마다 영원히
반복되는 문제를 없앤다 — 2시간을 넘기면 1회성 "구조적 상태" 알림으로 전환하고 반복을 잠근 뒤,
현황을 대시보드에서 계속 볼 수 있게 한다.

**Architecture:** `src/lib/safety/order-sync.ts`의 `reportUnreconciled()`가 매 크론 라운드마다
호출하는 새 영속화 모듈(`order-sync-escalation.ts`)이 "30분 알림 대상에 처음 포함된 시각"만
DB(`order_sync_stale_tracking` 신규 테이블 1개)에 기록한다. 이 시각이 2시간을 넘기면 그 순간
1회만 별도 alert를 보내고 해당 주문을 반복 알림 대상에서 제외한다. 신규 GET API +
`SafetyBar` 배지가 이 테이블을 읽어 "N건 판단 보류 중" 요약을 보여준다.

**Tech Stack:** Next.js 14 App Router (TypeScript), MariaDB(mysql2/promise), Jest(+@swc/jest).

**참조 설계 문서:** `docs/superpowers/specs/2026-08-12-order-sync-alert-escalation-design.md`

## Global Constraints

- 검증은 `npm run typecheck` + `npm test`만 사용한다. **`npm run build`·`npm install`·dev 서버
  기동은 절대 금지** — 이 작업 디렉토리(NFS)가 pm2로 서빙 중인 실거래 운영 배포 경로다.
- **DB는 운영 MariaDB.** 파괴적 SQL 금지. 스키마 변경은 `src/lib/db.ts`의 `setupDB()` 안에
  `CREATE TABLE IF NOT EXISTS`로만, 부팅 시 idempotent해야 한다.
- **신규 npm 의존성 금지.**
- **git commit/push는 이번 계획 실행 중 하지 않는다.** 이 프로젝트는 Developer 구현 →
  Reviewer 독립감사 → QA 검증까지 전부 끝난 뒤, **사용자 승인 후 단 한 번** 커밋한다(과거
  T-017~T-021 전례와 동일). 아래 각 Task의 "Step: 커밋"은 이 계획에서는 **"git add로 스테이징만
  하고 커밋하지 않는다"**로 대체한다 — 실제 커밋은 이 계획의 모든 Task가 끝나고 Reviewer/QA를
  거친 뒤, 사용자에게 별도로 승인받는 시점에 한다.
- 모든 새 코드는 안전장치 원칙을 지킨다 — 주문·자금 경로(`submitOrder`/`kis.createOrder`)를
  전혀 건드리지 않는 순수 관측·알림 계층이어야 한다.
- 스킵·미판정은 조용히 넘기지 말고 흔적을 남긴다(이 프로젝트 전체 원칙, T-007/T-012/T-014/T-018).

---

### Task 1: 판단보류 나이 영속화 모듈 + DB 테이블

**Files:**
- Create: `src/lib/safety/order-sync-escalation.ts`
- Create: `src/lib/safety/__tests__/order-sync-escalation.test.ts`
- Modify: `src/lib/db.ts` (setupDB() 안에 `CREATE TABLE IF NOT EXISTS` 블록 1개 추가 — 기존
  블록들 바로 뒤, 예를 들어 마지막 `CREATE TABLE IF NOT EXISTS` 블록 다음 줄에 추가)

**Interfaces:**
- Produces (Task 2·3이 그대로 씀):
  - `export const STRUCTURAL_MS: number` (= `2 * 60 * 60_000`)
  - `export interface StaleTrackingRow { orderId: number; symbol: string; firstStaleAt: number; escalatedAt: number | null; }`
  - `export async function getStaleTracking(orderIds: number[]): Promise<Map<number, StaleTrackingRow>>`
  - `export async function recordFirstStale(orderId: number, symbol: string, firstStaleAtMs: number): Promise<void>`
  - `export async function markEscalated(orderId: number, nowMs: number): Promise<void>`
  - `export async function clearResolved(stillUnreconciledIds: number[]): Promise<void>`
  - `export async function listStaleTracking(): Promise<StaleTrackingRow[]>` (Task 3의 대시보드 API가 씀 — 전체 목록 조회)

- [ ] **Step 1: db.ts에 신규 테이블 추가**

`src/lib/db.ts`의 `setupDB()` 안, 기존 마지막 `CREATE TABLE IF NOT EXISTS` 블록 바로 뒤에
추가한다(기존 블록들과 동일한 스타일 — 개별 try/catch 없이 `p.query` 그대로):

```typescript
  await p.query(`
    CREATE TABLE IF NOT EXISTS order_sync_stale_tracking (
      order_id       BIGINT PRIMARY KEY,
      symbol         VARCHAR(20) NOT NULL,
      first_stale_at DATETIME NOT NULL,
      escalated_at   DATETIME NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/lib/safety/__tests__/order-sync-escalation.test.ts` 신규 작성(기존
`order-sync.test.ts`와 동일한 mocking 컨벤션 — `jest.mock('@/lib/db', ...)`로 `getPool`을
가짜 `{ query }`로 교체):

```typescript
import { getPool } from '@/lib/db';
import {
  STRUCTURAL_MS, getStaleTracking, recordFirstStale, markEscalated, clearResolved,
  listStaleTracking,
} from '../order-sync-escalation';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));

function mockPool() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const rows: Record<string, unknown>[] = [];
  const query = jest.fn(async (sqlArg: unknown, paramsArg: unknown[] = []) => {
    calls.push({ sql: String(sqlArg), params: paramsArg ?? [] });
    if (/^SELECT/i.test(String(sqlArg))) return [rows];
    return [{}];
  });
  (getPool as jest.Mock).mockReturnValue({ query });
  return { calls, rows };
}

describe('order-sync-escalation', () => {
  beforeEach(() => jest.clearAllMocks());

  test('STRUCTURAL_MS는 2시간이다', () => {
    expect(STRUCTURAL_MS).toBe(2 * 60 * 60_000);
  });

  test('getStaleTracking: 빈 배열이면 쿼리 없이 빈 Map 반환', async () => {
    const { calls } = mockPool();
    const result = await getStaleTracking([]);
    expect(result.size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  test('getStaleTracking: 행을 Map으로 변환한다', async () => {
    const { rows } = mockPool();
    rows.push({
      order_id: 42, symbol: '005930',
      first_stale_at: new Date('2026-08-12T00:00:00Z'),
      escalated_at: null,
    });
    const result = await getStaleTracking([42]);
    expect(result.get(42)).toEqual({
      orderId: 42, symbol: '005930',
      firstStaleAt: new Date('2026-08-12T00:00:00Z').getTime(),
      escalatedAt: null,
    });
  });

  test('recordFirstStale: INSERT IGNORE로 쓴다', async () => {
    const { calls } = mockPool();
    await recordFirstStale(7, '000660', 1_700_000_000_000);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/INSERT IGNORE INTO order_sync_stale_tracking/i);
    expect(calls[0].params).toEqual([7, '000660', new Date(1_700_000_000_000)]);
  });

  test('markEscalated: escalated_at을 UPDATE한다', async () => {
    const { calls } = mockPool();
    await markEscalated(7, 1_700_000_100_000);
    expect(calls[0].sql).toMatch(/UPDATE order_sync_stale_tracking SET escalated_at/i);
    expect(calls[0].params).toEqual([new Date(1_700_000_100_000), 7]);
  });

  test('clearResolved: 남은 id가 있으면 NOT IN으로 나머지를 지운다', async () => {
    const { calls } = mockPool();
    await clearResolved([1, 2]);
    expect(calls[0].sql).toMatch(/DELETE FROM order_sync_stale_tracking WHERE order_id NOT IN/i);
    expect(calls[0].params).toEqual([[1, 2]]);
  });

  test('clearResolved: 빈 배열이면 전체 삭제한다', async () => {
    const { calls } = mockPool();
    await clearResolved([]);
    expect(calls[0].sql).toMatch(/^DELETE FROM order_sync_stale_tracking\s*$/i);
  });

  test('listStaleTracking: 전체 조회 결과를 반환한다', async () => {
    const { rows } = mockPool();
    rows.push({
      order_id: 1, symbol: '005930',
      first_stale_at: new Date('2026-08-12T00:00:00Z'), escalated_at: null,
    });
    const result = await listStaleTracking();
    expect(result).toHaveLength(1);
    expect(result[0].orderId).toBe(1);
  });
});
```

- [ ] **Step 3: 테스트 실행해서 실패 확인**

Run: `npm test -- src/lib/safety/__tests__/order-sync-escalation.test.ts`
Expected: FAIL — `Cannot find module '../order-sync-escalation'`

- [ ] **Step 4: 최소 구현 작성**

`src/lib/safety/order-sync-escalation.ts` 신규 작성:

```typescript
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

/**
 * 이 값을 넘긴 판단보류는 "구조적 상태"로 취급한다 — 30분 반복 critical 알림을 멈추고
 * 1회성 알림 + 대시보드 추적으로 전환한다. board.md 합의값(2026-08-12).
 */
export const STRUCTURAL_MS = 2 * 60 * 60_000;

export interface StaleTrackingRow {
  orderId: number;
  symbol: string;
  firstStaleAt: number;
  escalatedAt: number | null;
}

interface TrackingDbRow extends RowDataPacket {
  order_id: number;
  symbol: string;
  first_stale_at: Date;
  escalated_at: Date | null;
}

function toRow(r: TrackingDbRow): StaleTrackingRow {
  return {
    orderId: r.order_id,
    symbol: r.symbol,
    firstStaleAt: r.first_stale_at.getTime(),
    escalatedAt: r.escalated_at ? r.escalated_at.getTime() : null,
  };
}

/** 주어진 주문 id들의 추적 상태를 조회한다. 없는 id는 결과 Map에 없다. */
export async function getStaleTracking(orderIds: number[]): Promise<Map<number, StaleTrackingRow>> {
  const map = new Map<number, StaleTrackingRow>();
  if (orderIds.length === 0) return map;
  const pool = getPool();
  const [rows] = await pool.query<TrackingDbRow[]>(
    `SELECT order_id, symbol, first_stale_at, escalated_at
     FROM order_sync_stale_tracking WHERE order_id IN (?)`,
    [orderIds],
  );
  for (const r of rows) map.set(r.order_id, toRow(r));
  return map;
}

/** 처음으로 30분 반복 대상이 된 주문을 기록한다. 이미 있으면 아무 것도 하지 않는다. */
export async function recordFirstStale(orderId: number, symbol: string, firstStaleAtMs: number): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT IGNORE INTO order_sync_stale_tracking (order_id, symbol, first_stale_at) VALUES (?, ?, ?)`,
    [orderId, symbol, new Date(firstStaleAtMs)],
  );
}

/** 구조적 상태로 전환된 시각을 기록한다 — 이후 반복 알림 대상에서 제외하는 잠금 신호. */
export async function markEscalated(orderId: number, nowMs: number): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE order_sync_stale_tracking SET escalated_at = ? WHERE order_id = ?`,
    [new Date(nowMs), orderId],
  );
}

/**
 * 이번 라운드에 더 이상 판단보류가 아닌(=r.unreconciled에서 사라진) 주문의 추적 행을 지운다.
 * 다음에 같은 주문(또는 다른 주문)이 다시 걸리면 처음부터 다시 시작하게 하는 "해제" 동작.
 */
export async function clearResolved(stillUnreconciledIds: number[]): Promise<void> {
  const pool = getPool();
  if (stillUnreconciledIds.length === 0) {
    await pool.query(`DELETE FROM order_sync_stale_tracking`);
    return;
  }
  await pool.query(
    `DELETE FROM order_sync_stale_tracking WHERE order_id NOT IN (?)`,
    [stillUnreconciledIds],
  );
}

/** 대시보드용 — 현재 추적 중인 전체 목록. */
export async function listStaleTracking(): Promise<StaleTrackingRow[]> {
  const pool = getPool();
  const [rows] = await pool.query<TrackingDbRow[]>(
    `SELECT order_id, symbol, first_stale_at, escalated_at
     FROM order_sync_stale_tracking ORDER BY first_stale_at ASC`,
  );
  return rows.map(toRow);
}
```

- [ ] **Step 5: 테스트 실행해서 통과 확인**

Run: `npm test -- src/lib/safety/__tests__/order-sync-escalation.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 6: typecheck**

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 7: 스테이징 (커밋 아님)**

```bash
git add src/lib/db.ts src/lib/safety/order-sync-escalation.ts src/lib/safety/__tests__/order-sync-escalation.test.ts
```

---

### Task 2: `reportUnreconciled`에 에스컬레이션 배선

**Files:**
- Modify: `src/lib/safety/order-sync.ts:1000-1041` (`reportUnreconciled` 함수, `sync` 여부와
  `staleFailures` 처리 블록)
- Modify: `src/lib/safety/order-sync.ts:542` (호출부, `await` 추가)
- Modify: `src/lib/safety/__tests__/order-sync.test.ts` (신규 테스트 추가)

**Interfaces:**
- Consumes (Task 1에서): `STRUCTURAL_MS`, `getStaleTracking`, `recordFirstStale`,
  `markEscalated`, `clearResolved` — 전부 `./order-sync-escalation`에서 import.
- Produces: `reportUnreconciled`의 시그니처가 `(r: OrderSyncResult): void` →
  `(r: OrderSyncResult): Promise<void>`로 바뀐다(모듈 내부 함수라 export 안 함, 호출부만
  영향받음).

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/safety/__tests__/order-sync.test.ts` 끝에 새 `describe` 블록 추가(기존 파일의
`setupPool`/`activeOk` 헬퍼와 mock 구성을 그대로 재사용 — 파일 상단에 이미
`jest.mock('@/lib/notify/throttle', ...)`가 있으므로 `sendAlertThrottled`는 이미 mock 상태):

```typescript
import { getStaleTracking, markEscalated, recordFirstStale, clearResolved } from '../order-sync-escalation';
import { sendAlertThrottled } from '@/lib/notify/throttle';

jest.mock('../order-sync-escalation', () => ({
  STRUCTURAL_MS: 2 * 60 * 60_000,
  getStaleTracking: jest.fn(async () => new Map()),
  recordFirstStale: jest.fn(async () => {}),
  markEscalated: jest.fn(async () => {}),
  clearResolved: jest.fn(async () => {}),
}));

describe('reportUnreconciled 에스컬레이션', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetUnreconciledTracker();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test('30분 넘었지만 2시간 미만이면 기존처럼 반복 critical 알림만 나간다', async () => {
    const rows: PendingRow[] = [{
      id: 1, exchange_order_id: 'O001', symbol: '005930', type: 'limit',
      status: 'accepted', quantity: 1,
      created_at: new Date(Date.now() - 40 * 60_000),
    }];
    setupPool(rows);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue({
      orders: [], ok: [], failed: [{ market: 'domestic', error: 'timeout' }], complete: false,
    });
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    await syncPendingOrders();

    expect(sendAlertThrottled).toHaveBeenCalledWith(
      'order-sync:stale', 'critical', expect.any(String), expect.any(String), expect.any(Number),
    );
    expect(recordFirstStale).toHaveBeenCalled();
    expect(markEscalated).not.toHaveBeenCalled();
  });

  test('2시간 넘으면 구조적 알림 1회 + escalated 마킹 + 반복알림 대상에서 제외', async () => {
    const rows: PendingRow[] = [{
      id: 2, exchange_order_id: 'O002', symbol: '000660', type: 'limit',
      status: 'accepted', quantity: 1, created_at: new Date(),
    }];
    setupPool(rows);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue({
      orders: [], ok: [], failed: [{ market: 'domestic', error: 'timeout' }], complete: false,
    });
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);
    (getStaleTracking as jest.Mock).mockResolvedValue(new Map([
      [2, { orderId: 2, symbol: '000660', firstStaleAt: Date.now() - 2 * 60 * 60_000 - 1000, escalatedAt: null }],
    ]));

    await syncPendingOrders();

    expect(sendAlertThrottled).toHaveBeenCalledWith(
      'order-sync:stale-structural', 'critical', expect.any(String), expect.any(String), expect.any(Number),
    );
    expect(markEscalated).toHaveBeenCalledWith(2, expect.any(Number));
    expect(sendAlertThrottled).not.toHaveBeenCalledWith(
      'order-sync:stale', 'critical', expect.any(String), expect.any(String), expect.any(Number),
    );
  });

  test('이미 escalated된 주문이 남아 있으면 반복 alert 대상에서 계속 제외된다', async () => {
    const rows: PendingRow[] = [{
      id: 3, exchange_order_id: 'O003', symbol: '005380', type: 'limit',
      status: 'accepted', quantity: 1, created_at: new Date(),
    }];
    setupPool(rows);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue({
      orders: [], ok: [], failed: [{ market: 'domestic', error: 'timeout' }], complete: false,
    });
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);
    (getStaleTracking as jest.Mock).mockResolvedValue(new Map([
      [3, { orderId: 3, symbol: '005380', firstStaleAt: Date.now() - 5 * 60 * 60_000, escalatedAt: Date.now() - 3 * 60 * 60_000 }],
    ]));

    await syncPendingOrders();

    expect(markEscalated).not.toHaveBeenCalled();
    expect(sendAlertThrottled).not.toHaveBeenCalledWith(
      'order-sync:stale', 'critical', expect.any(String), expect.any(String), expect.any(Number),
    );
  });

  test('판단보류가 전부 해소되면 clearResolved가 빈 배열 기준으로 호출된다', async () => {
    setupPool([]);
    (getActiveOrdersDetailed as jest.Mock).mockResolvedValue({ orders: [], ok: ['domestic'], failed: [], complete: true });
    (getCompletedOrders as jest.Mock).mockResolvedValue([]);

    await syncPendingOrders();

    expect(clearResolved).toHaveBeenCalledWith([]);
  });
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npm test -- src/lib/safety/__tests__/order-sync.test.ts -t "에스컬레이션"`
Expected: FAIL — mock된 함수들이 호출되지 않음(아직 배선 안 됨)

- [ ] **Step 3: `reportUnreconciled` 수정**

`order-sync.ts` 상단 import 블록(8번째 줄 부근)에 추가:

```typescript
import {
  STRUCTURAL_MS, getStaleTracking, recordFirstStale, markEscalated, clearResolved,
} from './order-sync-escalation';
```

`order-sync.ts:542`의 호출부를:

```typescript
  reportUnreconciled(result);
```

다음으로 교체:

```typescript
  await reportUnreconciled(result);
```

(주변 함수 `syncPendingOrders`는 이미 `async`이므로 `await` 추가만 하면 된다.)

`order-sync.ts:1000-1041`(`function reportUnreconciled(r: OrderSyncResult): void {` 부터
`order-sync:stale` `sendAlertThrottled` 호출이 끝나는 `}`까지)를 아래로 교체한다. 이 블록
**이후**(coverage/unconfirmable 처리, 1043행부터)는 **무변경**:

```typescript
async function reportUnreconciled(r: OrderSyncResult): Promise<void> {
  await clearResolved(r.unreconciled.map(u => u.id));

  if (r.unreconciled.length === 0) return;
  // `too_fresh` 만 있는 회차는 정상 운영 상태다 — 새 주문을 낼 때마다 경고를 찍으면
  // 이 토큰이 흔해져서 진짜 보류를 가린다. (유예를 넘겨도 안 풀리면 아래 사유로 승격된다.)
  if (r.unreconciled.every(u => u.reason === 'too_fresh')) return;

  const byReason = new Map<UnreconciledReason, number>();
  for (const u of r.unreconciled) byReason.set(u.reason, (byReason.get(u.reason) ?? 0) + 1);
  const reasonSummary = [...byReason].map(([k, v]) => `${k}=${v}`).join(' ');
  const oldestMin = Math.floor(r.oldestUnreconciledMs / 60_000);

  console.warn(
    `[order-sync] ⚠️ ORDER_SYNC_UNRECONCILED — ${r.unreconciled.length}건 판정 보류 (${reasonSummary}) `
    + `최장 ${oldestMin}분 / 조회성공시장=[${r.marketsOk.join(',') || '-'}] `
    + `실패시장=[${r.marketsFailed.map(f => f.market).join(',') || '-'}] `
    + '— 살아 있을 수 있는 주문을 cancelled 로 쓰지 않고 다음 회차로 미뤘다',
  );
  for (const u of r.unreconciled) {
    console.warn(`[order-sync]   보류 id=${u.id} ${u.symbol}(${u.market}) reason=${u.reason} `
      + `${Math.floor(u.unreconciledForMs / 60_000)}분 — ${u.detail}`);
  }

  const staleFailures = r.unreconciled.filter(
    u => u.reason !== 'active_coverage_gap'
      && u.reason !== 'too_fresh'
      && u.reason !== 'partial_fill_unconfirmable'
      && u.unreconciledForMs >= STALE_MS,
  );

  if (staleFailures.length > 0) {
    const now = Date.now();
    const tracking = await getStaleTracking(staleFailures.map(u => u.id));

    for (const u of staleFailures) {
      if (!tracking.has(u.id)) await recordFirstStale(u.id, u.symbol, now - u.unreconciledForMs);
    }

    const newlyStructural = staleFailures.filter(u => {
      const t = tracking.get(u.id);
      if (t?.escalatedAt != null) return false;
      const firstStaleAt = t?.firstStaleAt ?? (now - u.unreconciledForMs);
      return (now - firstStaleAt) >= STRUCTURAL_MS;
    });

    if (newlyStructural.length > 0) {
      const hours = Math.floor(STRUCTURAL_MS / 3_600_000);
      sendAlertThrottled(
        'order-sync:stale-structural',
        'critical',
        '주문 상태 확인 불가가 구조적 상태로 전환됐습니다',
        `${newlyStructural.length}건이 ${hours}시간 넘게 확인되지 않아 반복 알림을 멈추고 `
        + '대시보드로 추적을 전환합니다.\n'
        + `대상: ${newlyStructural.map(u => `${u.symbol}#${u.id}`).join(', ')}\n`
        + '근본 원인(KIS 조회 실패·레이트리밋·토큰)을 확인하세요. 정상 정리되면 이 상태는 '
        + '자동으로 해제되고, 다음 발생 시 처음부터 다시 알립니다.',
        24 * 60 * 60_000,
      );
      for (const u of newlyStructural) await markEscalated(u.id, now);
    }

    const escalatedIds = new Set([
      ...newlyStructural.map(u => u.id),
      ...[...tracking.values()].filter(t => t.escalatedAt != null).map(t => t.orderId),
    ]);
    const repeating = staleFailures.filter(u => !escalatedIds.has(u.id));

    if (repeating.length > 0) {
      sendAlertThrottled(
        'order-sync:stale',
        'critical',
        '주문 상태 확인 불가가 지속되고 있습니다',
        `${repeating.length}건의 주문 상태를 ${Math.floor(STALE_MS / 60_000)}분 넘게 확인하지 못했습니다 `
        + `(최장 ${oldestMin}분).\n`
        + `실패 시장: ${r.marketsFailed.map(f => `${f.market}(${f.error})`).join(', ') || '-'}\n`
        + `대상: ${repeating.map(u => `${u.symbol}#${u.id}`).join(', ')}\n`
        + '이 주문들은 브로커에 살아 있을 수 있어 취소로 처리하지 않았습니다. '
        + 'KIS 조회 실패(레이트리밋·토큰·네트워크)를 확인하세요.',
        STALE_ALERT_TTL_MS,
      );
    }
  }
```

**주의**: 위 블록의 마지막 줄(`}`)은 원래 1041행의 `sendAlertThrottled(...)` 호출을 감싸던
`if (staleFailures.length > 0) { ... }`의 닫는 중괄호와 같은 자리다 — 함수 전체를 닫는 `}`가
아니다. 그 뒤에 이어지는 `coverage`/`unconfirmable` 처리 블록(1043행부터 1081행 `}`까지)은
**그대로 둔다.**

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npm test -- src/lib/safety/__tests__/order-sync.test.ts`
Expected: PASS — 기존 테스트 전부 + 신규 4건 포함 전체 통과(회귀 없음)

- [ ] **Step 5: 전체 테스트 + typecheck**

Run: `npm run typecheck && npm test`
Expected: 둘 다 exit 0. 특히 `order-sync-fail-closed.test.ts`·`order-sync-partial-settled.test.ts`
회귀 없는지 확인(이 두 파일은 Task 1/2가 건드리지 않은 `reportPartialSettlements`·완결성 판정
경로를 검증하므로 영향 없어야 정상).

- [ ] **Step 6: 스테이징 (커밋 아님)**

```bash
git add src/lib/safety/order-sync.ts src/lib/safety/__tests__/order-sync.test.ts
```

---

### Task 3: 대시보드 API

**Files:**
- Create: `src/app/api/safety/order-sync-status/route.ts`
- Create: `src/app/api/safety/order-sync-status/__tests__/route.test.ts`

**Interfaces:**
- Consumes: Task 1의 `listStaleTracking(): Promise<StaleTrackingRow[]>`, `STRUCTURAL_MS`.
- Produces: `GET /api/safety/order-sync-status` → `{ ok: true, data: { count: number,
  structuralCount: number, oldestAgeMs: number, items: Array<{ orderId: number; symbol: string;
  ageMs: number; escalated: boolean }> } }` (Task 4가 그대로 소비).

- [ ] **Step 1: 실패하는 테스트 작성**

`src/app/api/safety/order-sync-status/__tests__/route.test.ts` 신규(기존
`order-sync.test.ts`와 동일한 `jest.mock` 스타일을 그대로 따른다):

```typescript
import { GET } from '../route';
import { listStaleTracking } from '@/lib/safety/order-sync-escalation';

jest.mock('@/lib/safety/order-sync-escalation', () => ({
  STRUCTURAL_MS: 2 * 60 * 60_000,
  listStaleTracking: jest.fn(),
}));

describe('GET /api/safety/order-sync-status', () => {
  beforeEach(() => jest.clearAllMocks());

  test('빈 목록이면 count 0으로 응답', async () => {
    (listStaleTracking as jest.Mock).mockResolvedValue([]);
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      data: { count: 0, structuralCount: 0, oldestAgeMs: 0, items: [] },
    });
  });

  test('escalated 여부와 나이를 계산해 반환', async () => {
    const now = Date.now();
    (listStaleTracking as jest.Mock).mockResolvedValue([
      { orderId: 1, symbol: '005930', firstStaleAt: now - 3 * 60 * 60_000, escalatedAt: now - 1 * 60 * 60_000 },
      { orderId: 2, symbol: '000660', firstStaleAt: now - 40 * 60_000, escalatedAt: null },
    ]);
    const res = await GET();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.count).toBe(2);
    expect(body.data.structuralCount).toBe(1);
    expect(body.data.items).toHaveLength(2);
    expect(body.data.items[0]).toMatchObject({ orderId: 1, symbol: '005930', escalated: true });
    expect(body.data.items[1]).toMatchObject({ orderId: 2, symbol: '000660', escalated: false });
  });

  test('DB 오류 시 500과 ok:false', async () => {
    (listStaleTracking as jest.Mock).mockRejectedValue(new Error('conn fail'));
    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npm test -- src/app/api/safety/order-sync-status/__tests__/route.test.ts`
Expected: FAIL — `Cannot find module '../route'`

- [ ] **Step 3: route 구현**

`src/app/api/safety/order-sync-status/route.ts` 신규 작성(인증은 `src/middleware.ts`가
전역으로 처리 — 이 경로를 공개 allowlist에 넣지 않으면 자동으로 로그인 세션 보호된다,
`src/app/api/positions/status/route.ts` 패턴 그대로 따름):

```typescript
import { listStaleTracking } from '@/lib/safety/order-sync-escalation';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await listStaleTracking();
    const now = Date.now();

    const items = rows.map((r) => ({
      orderId: r.orderId,
      symbol: r.symbol,
      ageMs: now - r.firstStaleAt,
      escalated: r.escalatedAt != null,
    }));

    const structuralCount = items.filter((i) => i.escalated).length;
    const oldestAgeMs = items.reduce((m, i) => Math.max(m, i.ageMs), 0);

    return Response.json({
      ok: true,
      data: { count: items.length, structuralCount, oldestAgeMs, items },
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/safety/order-sync-status]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npm test -- src/app/api/safety/order-sync-status/__tests__/route.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 5: typecheck**

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 6: 스테이징 (커밋 아님)**

```bash
git add src/app/api/safety/order-sync-status/
```

---

### Task 4: SafetyBar 배지

**Files:**
- Modify: `src/components/SafetyBar.tsx`
- Test: 수동 코드 레벨 검증만(아래 §제약 참조) — 이 프로젝트는 `npm run build`/dev 서버 기동을
  금지하므로 브라우저 렌더 확인은 QA 단계에서 로그인 세션을 가진 사용자가 수행한다(T-016·T-021
  전례와 동일 제약).

**Interfaces:**
- Consumes: `GET /api/safety/order-sync-status`(Task 3) 응답 형태
  `{ ok: true, data: { count, structuralCount, oldestAgeMs, items } }`.

- [ ] **Step 1: `SafetyBar.tsx`에 상태 + fetch 추가**

`SafetyBar.tsx` 상단 `HealthResponse` interface 바로 아래에 타입 추가:

```typescript
interface OrderSyncStatus {
  count: number;
  structuralCount: number;
  oldestAgeMs: number;
}
```

`export function SafetyBar()` 안, 기존 `const [health, setHealth] = useState<HealthResponse | null>(null);`
바로 아래에 상태 추가:

```typescript
  const [orderSyncStatus, setOrderSyncStatus] = useState<OrderSyncStatus | null>(null);
```

기존 `useEffect(() => { ... fetch('/api/health') ... }, []);` 바로 아래에 별도 `useEffect` 추가:

```typescript
  useEffect(() => {
    let alive = true;
    fetch('/api/safety/order-sync-status')
      .then((r) => r.json())
      .then((j) => { if (alive && j.ok) setOrderSyncStatus(j.data); })
      .catch(() => { /* 배지는 부가 정보라 실패해도 나머지 화면에 영향 없음 */ });
    return () => { alive = false; };
  }, []);
```

- [ ] **Step 2: 배지 렌더링 추가**

기존 `warnings` 배열을 렌더링하는 부분(파일 중간, 헤더 요약 텍스트 근처) 바로 다음 줄에
0건이면 아무것도 렌더하지 않는 조건부 배지를 추가한다:

```tsx
      {orderSyncStatus != null && orderSyncStatus.count > 0 && (
        <div style={{
          marginTop: 8, padding: '6px 10px', borderRadius: 6,
          background: orderSyncStatus.structuralCount > 0 ? 'rgba(239,68,68,.12)' : 'rgba(245,158,11,.12)',
          border: `1px solid ${orderSyncStatus.structuralCount > 0 ? 'var(--danger)' : 'var(--warn)'}`,
          fontSize: 13, color: 'var(--text)',
        }}>
          {orderSyncStatus.count}건 판단 보류 중
          (최장 {Math.floor(orderSyncStatus.oldestAgeMs / 3_600_000)}시간
          {orderSyncStatus.structuralCount > 0 && `, 그중 ${orderSyncStatus.structuralCount}건 구조적`})
        </div>
      )}
```

정확한 삽입 위치(기존 JSX 트리 중 어느 지점)는 Developer가 파일을 열어 기존 `warnings.map(...)`
또는 헤더 요약 렌더 블록 바로 아래, 확장 패널이 열렸을 때만 보이는 영역이 아니라 **항상 보이는
헤더 영역**에 넣는다 — 이 배지는 "평소엔 안 보이다가 문제가 생기면 보이는" 것이 핵심이므로
접힌 상태에서도 노출돼야 한다.

- [ ] **Step 3: typecheck**

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 4: 코드 레벨 셀프체크 기록**

`npm run build`/dev 서버 금지 제약상 실제 렌더를 확인할 수 없다. Developer는 다음을 코드
읽기로 직접 재확인하고 task 이력서에 기록한다(QA가 이어받을 수 있게):
- `orderSyncStatus`가 `null`이거나 `count===0`일 때 배지 JSX 자체가 렌더 트리에 없는지
  (조건부 렌더 `&&` 체인이 `false`/`null`을 반환하는지 재확인)
- 기존 `warnings`/`SafetyChip` 렌더링과 스타일 토큰(`var(--danger)`/`var(--warn)`/`var(--text)`)
  일관성

- [ ] **Step 5: 스테이징 (커밋 아님)**

```bash
git add src/components/SafetyBar.tsx
```

---

## Task 완료 후 (Developer가 아니라 Leader/사용자가 하는 일)

1. Reviewer에게 이 계획으로 만들어진 diff 전체를 넘겨 독립 감사(의도 충족·안전장치 무영향·
   `git diff --quiet`로 주문/자금 경로 무변경 확인·신규 테이블이 `db.ts`의 idempotent 패턴을
   지키는지).
2. QA에게 `npm run typecheck && npm test` 전체 재실행 + 브라우저 실사용(로그인 세션으로
   SafetyBar 배지 실제 렌더, 판단보류 0건일 때 배지 숨김 확인)을 넘긴다.
3. 전부 PASS 후 **사용자 승인**을 받아 그때 처음으로 `git add -A && git commit` 진행(스테이징은
   이미 Task별로 끝나 있음) — push 즉시 webhook이 운영 배포하므로 승인 없이 push하지 않는다.
