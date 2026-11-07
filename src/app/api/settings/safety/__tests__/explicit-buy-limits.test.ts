import type { NextRequest } from 'next/server';
import { GET, PATCH } from '../route';
import { decodeBuyLimit, decodePreviousOrderPct } from '@/lib/safety/buy-limit-config';

const rows = new Map<string, string>();
const query = jest.fn(async (sql: string, params: string[] = []) => {
  if (sql.includes('INSERT INTO system_config')) {
    for (let i = 0; i < params.length; i += 2) {
      const [key, next] = [params[i], params[i + 1]];
      const previous = rows.get(key);
      if (decodeBuyLimit(previous) === 'unlimited'
        && (sql.includes('CASE WHEN') || next === '"unlimited"')) continue;
      rows.set(key, next === '"unlimited"' && previous !== undefined && key === 'safety_order_max_pct'
        ? JSON.stringify({ unlimitedPrevious: previous }) : next);
    }
    return [{}];
  }
  if (sql.includes('COUNT(*)')) return [[{ cnt: 2 }]];
  if (sql.includes("LIKE 'safety_%'")) return [[...rows].map(([key, value]) => ({ key, value }))];
  return [[]];
});
jest.mock('@/lib/db', () => ({ getPool: () => ({ query }) }));
jest.mock('@/lib/safety/dry-run', () => ({ isDryRun: async () => true }));
jest.mock('@/lib/signals/router', () => ({ syncEngineSwitchesFromLegacy: async () => {} }));

const patch = (body: unknown, site = 'same-origin') => PATCH({
  json: async () => body, headers: new Headers({ 'sec-fetch-site': site }),
} as NextRequest);

beforeEach(() => {
  rows.clear();
  rows.set('safety_order_max_pct', '0');
  rows.set('safety_daily_order_max_pct', '10');
});

test('legacy zero stays blocked, explicit zero round-trips and other setting saves preserve it', async () => {
  expect((await (await GET()).json()).safety).toMatchObject({ orderMaxPct: 0, orderMaxUnlimited: false });
  expect((await patch({ orderMaxPct: 0 })).status).toBe(200);
  expect(rows.get('safety_order_max_pct')).toBe('0');
  expect((await patch({ buyLimitEdits: { orderMaxPct: 0 } })).status).toBe(200);
  expect((await patch({ volGuardWarnPct: -2 })).status).toBe(200);
  expect((await (await GET()).json()).safety).toMatchObject({
    orderMaxPct: 0, orderMaxUnlimited: true, dailyOrderMaxPct: 10, dailyOrderMaxUnlimited: false,
  });
  expect((await patch({ buyLimitEdits: { orderMaxPct: 3, dailyOrderMaxPct: 0 } })).status).toBe(200);
  expect((await (await GET()).json()).safety).toMatchObject({
    orderMaxPct: 3, orderMaxUnlimited: false, dailyOrderMaxPct: 0, dailyOrderMaxUnlimited: true,
  });
});

test('stale legacy bulk saves preserve either unlimited limit; explicit edits can replace both', async () => {
  rows.set('safety_order_max_pct', '4');
  expect((await patch({ buyLimitEdits: { orderMaxPct: 0, dailyOrderMaxPct: 0 } })).status).toBe(200);
  expect((await patch({ buyLimitEdits: { orderMaxPct: 0 } })).status).toBe(200);
  expect(decodePreviousOrderPct(rows.get('safety_order_max_pct')!)).toBe(4);
  for (const stale of [0, 5]) {
    expect((await patch({ orderMaxPct: stale, dailyOrderMaxPct: stale, volGuardWarnPct: -3 })).status).toBe(200);
    expect((await (await GET()).json()).safety).toMatchObject({ orderMaxUnlimited: true, dailyOrderMaxUnlimited: true });
  }
  expect(rows.get('vol_guard_warn_pct')).toBe('-3');
  expect((await patch({ buyLimitEdits: { orderMaxPct: 2, dailyOrderMaxPct: 8 } })).status).toBe(200);
  expect((await (await GET()).json()).safety).toMatchObject({
    orderMaxPct: 2, orderMaxUnlimited: false, dailyOrderMaxPct: 8, dailyOrderMaxUnlimited: false,
  });
});

test.each([null, false, '', -1, '0', 'unlimited'])('invalid input %j cannot enable either limit', async value => {
  expect((await patch({ buyLimitEdits: { orderMaxPct: value, dailyOrderMaxPct: 0 } })).status).toBe(400);
  expect(rows.get('safety_order_max_pct')).toBe('0');
  expect(rows.get('safety_daily_order_max_pct')).toBe('10');
});

test('explicit edits cannot relax a cap from another origin', async () => {
  expect((await patch({ buyLimitEdits: { orderMaxPct: 0 } }, 'same-site')).status).toBe(403);
  expect(rows.get('safety_order_max_pct')).toBe('0');
});

test('mixed limit and safety edits are validated together and written by one statement', async () => {
  query.mockClear();
  expect((await patch({ buyLimitEdits: { orderMaxPct: 0 }, volGuardWarnPct: -3, reportChannel: 'bad' })).status).toBe(400);
  expect((await patch({ buyLimitEdits: { orderMaxPct: 0 }, killSwitch: false })).status).toBe(400);
  expect(query).not.toHaveBeenCalled();
  expect((await patch({ buyLimitEdits: { orderMaxPct: 0 }, volGuardWarnPct: -3 })).status).toBe(200);
  const writes = query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO system_config'));
  expect(writes).toHaveLength(1);
  expect(writes[0][1]).toEqual(['safety_order_max_pct', '"unlimited"', 'vol_guard_warn_pct', '-3']);
  expect(decodeBuyLimit(rows.get('safety_order_max_pct'))).toBe('unlimited');
  expect(rows.get('vol_guard_warn_pct')).toBe('-3');
});
