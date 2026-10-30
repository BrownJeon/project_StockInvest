/**
 * T-128 A4 — 시그널 상세(`GET /api/signals/[id]`)·놓친 기회(`GET /api/signals/missed`) 응답의 청산 앞머리 표시 별칭.
 * 목록(`GET /api/signals`)은 `signals-get.test.ts` §5 가 본다. 바꾸는 것은 응답의 `reasoning` 앞머리뿐 — SQL·다른 키·DB 값 불변.
 */
import { NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { GET as getOne } from '../[id]/route';
import { GET as getMissed } from '../missed/route';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
const mockedGetPool = getPool as jest.MockedFunction<typeof getPool>;

function pool(rows: Record<string, unknown>[]) {
  const query = jest.fn().mockResolvedValueOnce([rows, []]);
  mockedGetPool.mockReturnValue({ query } as never);
  return query;
}

const ROW = {
  id: 9, strategy_id: 'exit-engine-v1', symbol: '005930', side: 'sell', order_type: 'market', price: '70000.0000',
  quantity: '1.00000000', amount_krw: '70000.00', reasoning: '[하드 손절] 손실 -9.00% ≤ -8% → 자금 보호 청산',
  indicators: '{"exit_kind":"hard_stop"}', status: 'awaiting_approval', expires_at: null, valid_from: null, market: 'domestic',
  consumed_order_id: null, scenario_source: null, created_at: '2026-10-30T06:20:00.000Z', updated_at: '2026-10-30T06:20:00.000Z',
};

beforeEach(() => { jest.clearAllMocks(); });

describe('GET /api/signals/[id]', () => {
  const call = async (row: Record<string, unknown>) => {
    pool([row]);
    const res = await getOne(new Request('http://x/api/signals/9'), { params: Promise.resolve({ id: '9' }) });
    return (await res.json()) as { ok: boolean; data: Record<string, unknown> };
  };

  test('청산 앞머리만 바뀌고 나머지 키·값(지표 해석 포함)은 그대로', async () => {
    const body = await call({ ...ROW });
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({ ...ROW, reasoning: '[손실한도 손절] 손실 -9.00% ≤ -8% → 자금 보호 청산', indicators: { exit_kind: 'hard_stop' } });
  });

  test('청산 앞머리가 아니면 reasoning 그대로', async () => {
    for (const reasoning of ['[목표 익절] +5%', 'RSI14=30 < 38', null]) {
      const body = await call({ ...ROW, reasoning });
      expect(body.data.reasoning).toBe(reasoning);
    }
    const eod = await call({ ...ROW, reasoning: '[EOD 손절] x' });
    expect(eod.data.reasoning).toBe('[장마감 전 손절] x');
  });
});

describe('GET /api/signals/missed', () => {
  test('거절된 청산 시그널의 앞머리만 바뀌고, 그 밖의 행·키는 그대로', async () => {
    const created = new Date('2026-10-30T06:20:00.000Z');
    const base = { side: 'sell', strategy_id: 'exit-engine-v1', indicators: null, price_at_skip: null, price_1h_after: null, price_change_pct: null, created_at: created };
    const query = pool([
      { ...base, id: 1, symbol: '005930', reasoning: '[EOD 손절] KST 15:20~15:29', status: 'rejected' },
      { ...base, id: 2, symbol: '000660', reasoning: '[AI 70%] 과열', status: 'ai_skipped', side: 'buy', strategy_id: 'rsi-v1' },
      { ...base, id: 3, symbol: '035420', reasoning: null, status: 'rejected' },
    ]);
    const res = await getMissed(new NextRequest('http://x/api/signals/missed?days=7'));
    const body = (await res.json()) as { ok: boolean; data: Array<Record<string, unknown>> };
    expect(query.mock.calls[0][1]).toEqual([7]);
    expect(body.data.map((d) => d.reasoning)).toEqual(['[장마감 전 손절] KST 15:20~15:29', '[AI 70%] 과열', '']);
    expect(Object.keys(body.data[0]).sort()).toEqual(
      ['confidence', 'createdAt', 'id', 'price1hAfter', 'priceAtSkip', 'priceChangePct', 'reasoning', 'side', 'source', 'strategyId', 'symbol'],
    );
  });
});
