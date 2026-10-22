/**
 * POST /api/cron/daily-bars 통합 — 라우트 → 실제 수집기 → 가짜 DB(실제 upsert SQL 해석), KIS 페이지만 합성 데이터로 바꾼다 (T-070).
 * 확인: 예산 초과 시 중단하고 다음 호출이 이어 가 끝낸다 · 쓰기 SQL 대상은 daily_bars 하나뿐 · 인증 실패면 DB 쿼리 0.
 */
import type { NextRequest } from 'next/server';
import { FakeBarsDb, fakeMarket, makeBars } from '@/lib/profit-engine/__tests__/fake-bars-db';

const authMock = jest.fn();
let db: FakeBarsDb;
const market = fakeMarket({ 'NAS:MU': makeBars('2022-01-03', '2026-10-21'), '005930': makeBars('2022-01-03', '2026-10-22', 60000, 10) }, { today: '2026-10-22' });

jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: (...a: unknown[]) => authMock(...a) }));
jest.mock('@/lib/db', () => ({ getPool: () => db }));
jest.mock('@/lib/profit-engine/daily-bars-kis', () => ({
  ...jest.requireActual('@/lib/profit-engine/daily-bars-kis'),
  fetchKisDailyPage: (req: unknown) => market.fetchPage(req as never),
}));
jest.mock('@/lib/profit-engine/daily-bars-time', () => ({
  ...jest.requireActual('@/lib/profit-engine/daily-bars-time'),
  checkOffHoursWindow: () => ({ ok: true, kst: '06:30' }),
}));
jest.mock('@/lib/exchanges/kis-http', () => ({ kisFetch: () => { throw new Error('KIS 호출 금지'); }, isKisRateLimited: () => false }));
jest.mock('@/lib/exchanges/kis-auth', () => ({ getKisToken: () => { throw new Error('토큰 금지'); }, kisBaseUrl: () => 'x' }));

import { POST } from '../route';

const req = (body: unknown): NextRequest =>
  ({ headers: new Headers(), text: async () => JSON.stringify(body) }) as unknown as NextRequest;

beforeEach(() => {
  db = new FakeBarsDb();
  authMock.mockReset().mockReturnValue(undefined);
  jest.useFakeTimers({ now: new Date('2026-10-22T12:00:00Z'), doNotFake: ['setTimeout', 'setImmediate', 'nextTick'] });
});
afterEach(() => jest.useRealTimers());

test('인증 실패면 DB 쿼리 0', async () => {
  authMock.mockReturnValue(new Response('{}', { status: 401 }));
  const r = await POST(req({ symbols: ['NAS:MU'] }));
  expect(r.status).toBe(401);
  expect(db.queries).toEqual([]);
});

test('예산(maxCalls)이 다하면 멈추고 remaining 을 주며, 다시 부르면 이어서 끝낸다 — 쓰기는 daily_bars 뿐', async () => {
  const body = { symbols: ['NAS:MU', '005930'], years: 1, maxCalls: 2 };
  const seen: number[] = [];
  let out: { remaining: string[]; budget: { calls: number } } | null = null;
  for (let i = 0; i < 10; i++) {
    const r = await POST(req(body));
    expect(r.status).toBe(200);
    out = await r.json();
    seen.push(out!.budget.calls);
    if (!out!.remaining.length) break;
  }
  expect(out!.remaining).toEqual([]);
  expect(seen[0]).toBe(2);
  expect(seen.length).toBeGreaterThan(1);
  const us = db.rows('US', 'NAS:MU');
  const kr = db.rows('KR', '005930');
  expect(us[us.length - 1].trade_date).toBe('2026-10-21');
  expect(kr[kr.length - 1].trade_date).toBe('2026-10-22');
  expect(String(us[0].trade_date) <= '2025-10-22').toBe(true);
  expect(new Set(us.map((x) => x.currency))).toEqual(new Set(['USD']));
  expect(new Set(kr.map((x) => x.currency))).toEqual(new Set(['KRW']));
  expect(db.writtenTables()).toEqual(['daily_bars']);
  // 끝난 뒤 한 번 더 부르면 호출 0(멱등·최신)
  const again = await (await POST(req(body))).json();
  expect(again.budget.calls).toBe(0);
});
