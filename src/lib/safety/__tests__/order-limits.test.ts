import type { OrderRequest } from '@/lib/exchanges/types';
import {
  checkOrderMax,
  checkSymbolWhitelist,
  resolveOrderAmountKRW,
} from '../order-limits';

const base: OrderRequest = {
  exchange: 'coinone',
  symbol: 'KRW-BTC',
  side: 'buy',
  type: 'limit',
};

describe('resolveOrderAmountKRW', () => {
  test('amountKRW 우선', () => {
    expect(resolveOrderAmountKRW({ ...base, amountKRW: 20_000, price: 1000, quantity: 1 })).toBe(20_000);
  });
  test('price × quantity 계산', () => {
    expect(resolveOrderAmountKRW({ ...base, price: 1000, quantity: 2 })).toBe(2000);
  });
  test('값 없으면 0', () => {
    expect(resolveOrderAmountKRW(base)).toBe(0);
  });
});

describe('checkSymbolBlacklist (블랙리스트 정책)', () => {
  const origDom = process.env.BLOCKED_SYMBOLS_DOMESTIC;
  const origOvs = process.env.BLOCKED_SYMBOLS_OVERSEAS;
  afterEach(() => {
    process.env.BLOCKED_SYMBOLS_DOMESTIC = origDom;
    process.env.BLOCKED_SYMBOLS_OVERSEAS = origOvs;
  });

  test('블랙리스트 비어있으면 모든 심볼 통과 (allow-by-default)', async () => {
    process.env.BLOCKED_SYMBOLS_DOMESTIC = '';
    expect((await checkSymbolWhitelist('005930')).ok).toBe(true);
    expect((await checkSymbolWhitelist('999999')).ok).toBe(true);
  });

  test('블랙리스트에 등록된 심볼은 거부', async () => {
    process.env.BLOCKED_SYMBOLS_DOMESTIC = '005930,000660';
    const r = await checkSymbolWhitelist('005930');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('symbol_not_allowed');
    expect(r.detail).toMatch('blacklisted');
  });

  test('국내·해외 블랙리스트 시장별 분리', async () => {
    process.env.BLOCKED_SYMBOLS_DOMESTIC = '005930';
    process.env.BLOCKED_SYMBOLS_OVERSEAS = 'NAS:AAPL';
    expect((await checkSymbolWhitelist('005930')).ok).toBe(false);
    expect((await checkSymbolWhitelist('NAS:AAPL')).ok).toBe(false);
    expect((await checkSymbolWhitelist('NAS:MSFT')).ok).toBe(true);
    expect((await checkSymbolWhitelist('000660')).ok).toBe(true);
  });

  test('공백 포함 파싱', async () => {
    process.env.BLOCKED_SYMBOLS_DOMESTIC = '005930 , 000660';
    expect((await checkSymbolWhitelist('000660')).ok).toBe(false);
  });
});

describe('checkOrderMax', () => {
  test('한도 미설정이면 거부', () => {
    const r = checkOrderMax({ ...base, amountKRW: 1000 }, 0);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('order_limit');
  });

  test('amount 산출 불가 시 거부', () => {
    const r = checkOrderMax(base, 10_000);
    expect(r.ok).toBe(false);
  });

  test('한도 이내면 ok', () => {
    const r = checkOrderMax({ ...base, amountKRW: 9_999 }, 10_000);
    expect(r.ok).toBe(true);
  });

  test('한도 초과면 거부 + detail 포함', () => {
    const r = checkOrderMax({ ...base, amountKRW: 10_001 }, 10_000);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('order_limit');
    expect(r.detail).toBe('10001 > 10000');
  });

  test('price × quantity로도 판정', () => {
    const r = checkOrderMax({ ...base, price: 100, quantity: 50 }, 10_000);
    expect(r.ok).toBe(true);
    const r2 = checkOrderMax({ ...base, price: 100, quantity: 200 }, 10_000);
    expect(r2.ok).toBe(false);
  });
});
