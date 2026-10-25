/**
 * T-081 WP-B (F10) — **일일 한도 경합 확증 시험 · 일회용 MariaDB** (평소 jest 실행에서는 건너뛴다).
 *
 * 무엇을 실제 DB 로 확인하나 — 실제 `checkDailyMax` 와 그 SQL 을 실제 MariaDB 에서 돌린다(`@/lib/db` 만 일회용 풀로 바꾼다):
 *  ① 경합: `submitOrder` 순서(자기 행 INSERT `pending` → 한도 검사 → 송신 → `accepted`)를 흉내 낸 두 매수가 서로의 `pending` 을
 *     못 보면 둘 다 통과해 일일 한도를 넘는다. 옛 SQL(`pending` 전부 제외)로 재현하고(대조 시험 R8), 고친 SQL(자기 행만 제외)은
 *     어떤 끼어들기 순서에서도 통과 합계가 남은 한도를 넘지 않는다.
 *  ② 순차: 앞 주문이 `accepted` 가 된 뒤의 주문은 거부된다.
 *  ③ KST 자정 경계: 23:59:59 행은 "어제", 00:00:00 행은 "오늘". 미국 정규장(KST 22:30~05:00)이 자정에 둘로 나뉘는 현행 동작을
 *     **문서화만** 한다(정책 이슈 — 이번에 고치지 않음).
 *  ④ 기존 의미 불변: `cancelled`·`rejected`·`failed`·`blocked` 제외, 시장 분리, `sell` 제외, `dry_run`·`filled` 등은 합산.
 *
 * 실행(운영·공용 DB 금지 — 127.0.0.1 에만 묶인 일회용 컨테이너, 끝나면 제거. 이 환경의 `.env`/DB_* 는 쓰지 않는다):
 *   docker run -d --rm --name t081b-mariadb -p 127.0.0.1:33081:3306 -e TZ=Asia/Seoul -e MARIADB_ROOT_PASSWORD=t081btest \
 *     -e MARIADB_DATABASE=t081b mariadb:10.11 \
 *     --sql-mode=IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION
 *   T081B_TEST_DB_PORT=33081 T081B_TEST_DB_PASSWORD=t081btest node node_modules/jest/bin/jest.js \
 *     src/lib/safety/__tests__/t081b-daily-limit-race-disposable-mariadb.test.ts
 *   docker rm -f t081b-mariadb
 * `orders` 는 `checkDailyMax` SQL 이 쓰는 열만 둔 최소 테이블이다(열 정의·status ENUM 은 `src/lib/db.ts` 와 같다).
 * `created_at` 은 항상 명시해 넣는다 — 앱 풀과 같은 `timezone:'+09:00'` 로 KST 벽시계가 저장되므로 컨테이너 TZ 와 무관하다.
 */
import mysql from 'mysql2/promise';

let mockPool: mysql.Pool | null = null;
/** 시험이 정하는 "지금". null 이면 실제 시각. `kstTodayStart()` 의 계산 자체는 실제 구현을 쓴다. */
let mockNow: Date | null = null;

jest.mock('@/lib/db', () => ({ getPool: () => { if (!mockPool) throw new Error('no pool'); return mockPool; } }));
jest.mock('@/lib/exchanges/fx', () => ({ usdToKrw: jest.fn(async () => { throw new Error('external fx must not be called'); }) }));
jest.mock('@/lib/time', () => {
  const actual = jest.requireActual('@/lib/time');
  return { ...actual, kstTodayStart: (now?: Date) => actual.kstTodayStart(now ?? mockNow ?? new Date()) };
});

import type { OrderRequest } from '@/lib/exchanges/types';
import { checkDailyMax } from '../order-limits';

const PORT = process.env.T081B_TEST_DB_PORT;
const maybe = PORT ? describe : describe.skip;

/** `src/lib/db.ts` orders.status ENUM 전체 */
const STATUSES = ['pending', 'accepted', 'partially_filled', 'filled', 'cancelled', 'rejected', 'failed', 'dry_run', 'blocked'] as const;
type Status = (typeof STATUSES)[number];
type Mkt = 'domestic' | 'overseas';

const DDL = `CREATE TABLE orders (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  side ENUM('buy','sell') NOT NULL,
  amount_krw DECIMAL(18,2) NULL,
  status ENUM(${STATUSES.map((s) => `'${s}'`).join(',')}) NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  market ENUM('domestic','overseas') NOT NULL DEFAULT 'domestic',
  INDEX idx_orders_market (market, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

/** 수정 전 `checkDailyMax` 의 집계 SQL 원문(대조용 — `pending` 전부 제외) */
const LEGACY_SQL = `SELECT COALESCE(SUM(amount_krw), 0) AS sum_krw
       FROM orders
       WHERE created_at >= ?
         AND market = ?
         AND side = 'buy'
         AND status NOT IN ('rejected','failed','blocked','cancelled','pending')`;

const SYMBOL: Record<Mkt, string> = { domestic: '005930', overseas: 'NAS:MU' };
const req = (amountKRW: number, market: Mkt = 'domestic'): OrderRequest =>
  ({ exchange: 'kis', symbol: SYMBOL[market], side: 'buy', type: 'limit', amountKRW, market });

const now = () => mockNow ?? new Date();

async function insertOrder(o: { amount: number | null; status?: Status; side?: 'buy' | 'sell'; market?: Mkt; at?: Date }): Promise<number> {
  const [r] = await mockPool!.query<mysql.ResultSetHeader>(
    'INSERT INTO orders (side, amount_krw, status, created_at, market) VALUES (?, ?, ?, ?, ?)',
    [o.side ?? 'buy', o.amount, o.status ?? 'pending', o.at ?? now(), o.market ?? 'domestic'],
  );
  return r.insertId;
}
const setStatus = (id: number, s: Status) => mockPool!.query('UPDATE orders SET status = ? WHERE id = ?', [s, id]);

/**
 * `submitOrder` 의 한도 구간 순서를 그대로 흉내 낸다: 자기 행 INSERT pending → checkDailyMax(자기 id) → (통과면) 송신 대기 → accepted / blocked.
 * `sendMs` = KIS 응답 대기(`realSubmit`) 동안 행이 `pending` 으로 머무는 시간. 0 이면 경합 창이 거의 없어 재현되지 않는다(1단계 실측).
 */
async function flow(amount: number, limit: number, market: Mkt = 'domestic', sendMs = 0): Promise<{ id: number; ok: boolean }> {
  const id = await insertOrder({ amount, market });
  const r = await checkDailyMax(req(amount, market), limit, id);
  if (r.ok && sendMs > 0) await new Promise((res) => setTimeout(res, sendMs));
  await setStatus(id, r.ok ? 'accepted' : 'blocked');
  return { id, ok: r.ok };
}

const KST = (s: string) => new Date(`${s}+09:00`);

maybe('T-081 WP-B 일일 한도 경합 — 일회용 MariaDB', () => {
  beforeAll(async () => {
    // 운영 db.ts createPool 과 같은 timezone(+09:00)·기본 플래그
    mockPool = mysql.createPool({
      host: '127.0.0.1', port: Number(PORT), user: 'root', password: process.env.T081B_TEST_DB_PASSWORD,
      database: process.env.T081B_TEST_DB_NAME ?? 't081b', connectionLimit: 10, timezone: '+09:00',
    });
    await mockPool.query('DROP TABLE IF EXISTS orders');
    await mockPool.query(DDL);
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  beforeEach(async () => { mockNow = null; await mockPool!.query('TRUNCATE TABLE orders'); });
  afterAll(async () => { await mockPool?.end(); mockPool = null; });

  test('환경: 운영과 같은 STRICT sql_mode · 10.11 계열', async () => {
    const [[row]] = await mockPool!.query<mysql.RowDataPacket[]>('SELECT @@sql_mode AS m, VERSION() AS v');
    expect(String(row.m)).toContain('STRICT_TRANS_TABLES');
    expect(String(row.v)).toMatch(/^10\.11\./);
    console.info(`[t081b-db] ${row.v} · ${row.m}`);
  });

  test('R1 ① 동시(두 INSERT 뒤 두 검사가 함께): 한도 100·accepted 60 → A30·B30 이 서로의 pending 을 본다 → 합계가 100 을 넘지 않는다', async () => {
    await insertOrder({ amount: 60, status: 'accepted' });
    const a = await insertOrder({ amount: 30 });
    const b = await insertOrder({ amount: 30 });
    const [ra, rb] = await Promise.all([checkDailyMax(req(30), 100, a), checkDailyMax(req(30), 100, b)]);
    console.info(`[t081b] R1 동시: A=${ra.ok ? 'ok' : `거부(${ra.detail})`} B=${rb.ok ? 'ok' : `거부(${rb.detail})`}`);
    const passed = [ra, rb].filter((r) => r.ok).length;
    expect(60 + 30 * passed).toBeLessThanOrEqual(100);
    // 이 끼어들기(둘 다 INSERT 한 뒤 검사)에서는 둘 다 서로를 보므로 둘 다 거부된다 — 넘치지 않는 대신 보수적이다(남은 한계 참조)
    expect([ra.ok, rb.ok]).toEqual([false, false]);
    expect(ra.detail).toBe('domestic 90+30 > 100');
  });

  test('R1b ① 끼어들기: A INSERT → A 검사(통과) → B INSERT → B 검사 — A 가 아직 pending(송신 중)이어도 B 는 거부', async () => {
    await insertOrder({ amount: 60, status: 'accepted' });
    const a = await insertOrder({ amount: 30 });
    const ra = await checkDailyMax(req(30), 100, a);
    const b = await insertOrder({ amount: 30 });
    const rb = await checkDailyMax(req(30), 100, b);
    console.info(`[t081b] R1b 끼어들기: A=${ra.ok ? 'ok' : 'reject'} B=${rb.ok ? 'ok' : `reject(${rb.detail})`}`);
    expect(ra.ok).toBe(true);
    expect(rb).toMatchObject({ ok: false, reason: 'daily_limit', detail: 'domestic 90+30 > 100' });
  });

  test('R1c ① 무작위 동시 10건 × 5회(송신 대기 40ms): 통과한 금액 합이 남은 한도(40)를 넘는 회차가 없다', async () => {
    const results: string[] = [];
    for (let round = 0; round < 5; round++) {
      await mockPool!.query('TRUNCATE TABLE orders');
      await insertOrder({ amount: 60, status: 'accepted' });
      const r = await Promise.all(Array.from({ length: 10 }, () => flow(15, 100, 'domestic', 40)));
      const passedSum = r.filter((x) => x.ok).length * 15;
      results.push(String(passedSum));
      expect(passedSum).toBeLessThanOrEqual(40);
      const [[s]] = await mockPool!.query<mysql.RowDataPacket[]>(
        "SELECT COALESCE(SUM(amount_krw),0) AS s FROM orders WHERE status='accepted'");
      expect(Number(s.s)).toBeLessThanOrEqual(100);
    }
    console.info(`[t081b] R1c 회차별 통과 합계(남은 한도 40): ${results.join(', ')}`);
  });

  test('R2 ② 순차: A 가 accepted 로 바뀐 뒤 B → B 거부', async () => {
    await insertOrder({ amount: 60, status: 'accepted' });
    expect((await flow(30, 100)).ok).toBe(true);
    const b = await insertOrder({ amount: 30 });
    await expect(checkDailyMax(req(30), 100, b)).resolves.toMatchObject({ ok: false, detail: 'domestic 90+30 > 100' });
  });

  test('R3 ③ KST 자정 경계: 23:59:59 행은 어제(합산 밖), 00:00:00 행은 오늘(합산 안)', async () => {
    mockNow = KST('2026-10-27T00:00:30');
    await insertOrder({ amount: 70, status: 'accepted', at: KST('2026-10-26T23:59:59') });
    const self = await insertOrder({ amount: 50 });
    await expect(checkDailyMax(req(50), 100, self)).resolves.toEqual({ ok: true });       // 어제 70 은 안 센다
    await insertOrder({ amount: 60, status: 'accepted', at: KST('2026-10-27T00:00:00') });
    await expect(checkDailyMax(req(50), 100, self)).resolves.toMatchObject({ ok: false, detail: 'domestic 60+50 > 100' });
  });

  test('R3b ③ 문서화(정책 — 고치지 않음): 미국 정규장 한 세션(23:00 / 01:00 KST)이 자정 리셋으로 "일일" 한도를 두 번 쓴다', async () => {
    mockNow = KST('2026-10-26T23:00:00');
    expect((await flow(90, 100, 'overseas')).ok).toBe(true);
    expect((await flow(90, 100, 'overseas')).ok).toBe(false);                              // 같은 KST 날짜 안에서는 막힌다
    mockNow = KST('2026-10-27T01:00:00');                                                    // 같은 미국 세션, KST 로는 다음 날
    expect((await flow(90, 100, 'overseas')).ok).toBe(true);                               // 현행: 다시 통과 → 한 세션 180 > 100
    const [[s]] = await mockPool!.query<mysql.RowDataPacket[]>(
      "SELECT COALESCE(SUM(amount_krw),0) AS s FROM orders WHERE status='accepted' AND market='overseas'");
    expect(Number(s.s)).toBe(180);
  });

  test('R4 ④ 기존 의미: cancelled·rejected·failed·blocked 제외, dry_run·accepted·partially_filled·filled 합산', async () => {
    for (const st of ['cancelled', 'rejected', 'failed', 'blocked'] as const) await insertOrder({ amount: 1000, status: st });
    for (const st of ['dry_run', 'accepted', 'partially_filled', 'filled'] as const) await insertOrder({ amount: 10, status: st });
    const self = await insertOrder({ amount: 60 });
    await expect(checkDailyMax(req(60), 100, self)).resolves.toEqual({ ok: true });         // 40 + 60 = 100
    await expect(checkDailyMax(req(61), 100, self)).resolves.toMatchObject({ ok: false, detail: 'domestic 40+61 > 100' });
  });

  test('R4b ④ 기존 의미: 다른 시장·sell 은 합산 밖 (accepted·pending 모두)', async () => {
    await insertOrder({ amount: 500, status: 'accepted', market: 'overseas' });
    await insertOrder({ amount: 500, status: 'pending', market: 'overseas' });
    await insertOrder({ amount: 500, status: 'accepted', side: 'sell' });
    await insertOrder({ amount: 500, status: 'pending', side: 'sell' });
    const self = await insertOrder({ amount: 100 });
    await expect(checkDailyMax(req(100), 100, self)).resolves.toEqual({ ok: true });
    const selfO = await insertOrder({ amount: 100, market: 'overseas' });
    // 해외 쪽에서는 그 시장의 accepted 500 + 다른 주문 pending 500 이 합산되고 sell 은 빠진다
    await expect(checkDailyMax(req(100, 'overseas'), 100, selfO)).resolves.toMatchObject({ ok: false, detail: 'overseas 1000+100 > 100' });
  });

  test('R5 자기 pending 1건만 있으면 통과(이중 계산 없음) — 한도와 정확히 같은 금액', async () => {
    const self = await insertOrder({ amount: 100 });
    await expect(checkDailyMax(req(100), 100, self)).resolves.toEqual({ ok: true });
  });

  test('R6 다른 주문의 pending 은 합산된다, 다른 시장의 pending 은 아니다', async () => {
    await insertOrder({ amount: 50, market: 'overseas' });
    const self = await insertOrder({ amount: 60 });
    await expect(checkDailyMax(req(60), 100, self)).resolves.toEqual({ ok: true });
    await insertOrder({ amount: 50 });                                                        // 같은 시장 다른 주문 pending
    await expect(checkDailyMax(req(60), 100, self)).resolves.toMatchObject({ ok: false, detail: 'domestic 50+60 > 100' });
  });

  test('R7 어제(stale) pending 은 합산되지 않는다', async () => {
    mockNow = KST('2026-10-27T10:00:00');
    await insertOrder({ amount: 1000, at: KST('2026-10-26T15:00:00') });
    const self = await insertOrder({ amount: 100 });
    await expect(checkDailyMax(req(100), 100, self)).resolves.toEqual({ ok: true });
  });

  test('R8 대조: 옛 SQL(pending 전부 제외)은 R1 과 같은 상태에서 이미 쓴 금액을 60 으로만 본다 → 두 건 모두 통과(경합 재현)', async () => {
    await insertOrder({ amount: 60, status: 'accepted' });
    await insertOrder({ amount: 30 });
    await insertOrder({ amount: 30 });
    const start = new Date(Date.now() - 3600_000);
    const [[s]] = await mockPool!.query<mysql.RowDataPacket[]>(LEGACY_SQL, [start, 'domestic']);
    const already = Number(s.sum_krw);
    expect(already).toBe(60);
    expect([already + 30 <= 100, already + 30 <= 100]).toEqual([true, true]);              // A·B 각자 통과 → 실제 합 120 > 100
  });

  test('R9 selfOrderId 없음(자기 행이 없는 호출 — approval-context): 오늘 pending 전부를 합산', async () => {
    await insertOrder({ amount: 30 });
    await insertOrder({ amount: 30 });
    await expect(checkDailyMax(req(30), 100)).resolves.toEqual({ ok: true });                // 60 + 30
    await expect(checkDailyMax(req(41), 100)).resolves.toMatchObject({ ok: false, detail: 'domestic 60+41 > 100' });
  });
});
