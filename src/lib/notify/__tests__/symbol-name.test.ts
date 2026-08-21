/**
 * getSymbolLabel — 알림 표시용 종목명 조회 (T-013).
 *
 * 핵심 계약 3가지:
 *  1. `stock_meta` 캐시 히트 → 종목명. 미스 → 심볼 코드(기존 동작과 동일)
 *  2. DB 조회가 던져도 절대 전파하지 않는다 — 알림 발송이 표시 문자열 때문에 막히면 안 된다
 *  3. 라이브 KIS 조회 폴백 없음 — 쿼리는 정확히 한 번, stock_meta 만
 */
type QueryImpl = (sql: string, params?: unknown[]) => Promise<unknown>;

let queryImpl: QueryImpl;
const queryCalls: { sql: string; params?: unknown[] }[] = [];

jest.mock('@/lib/db', () => ({
  getPool: () => ({
    query: (sql: string, params?: unknown[]) => {
      queryCalls.push({ sql, params });
      return queryImpl(sql, params);
    },
  }),
}));

import { getSymbolLabel, getSymbolLabels } from '@/lib/notify/symbol-name';

const rows = (r: unknown[]): Promise<unknown> => Promise.resolve([r, []]);

let warnSpy: jest.SpyInstance;

beforeEach(() => {
  queryCalls.length = 0;
  queryImpl = () => rows([]);
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
  jest.clearAllMocks();
});

describe('getSymbolLabel', () => {
  test('캐시 히트 — 종목코드 대신 한글 종목명', async () => {
    queryImpl = () => rows([{ name: 'SK하이닉스' }]);
    await expect(getSymbolLabel('000660')).resolves.toBe('SK하이닉스');
  });

  test('stock_meta 만 조회하고 라이브 폴백을 하지 않는다', async () => {
    queryImpl = () => rows([{ name: 'SK하이닉스' }]);
    await getSymbolLabel('000660');
    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0].sql).toContain('stock_meta');
    expect(queryCalls[0].params).toEqual(['000660']);
  });

  test('캐시 미스 — 심볼 코드로 폴백', async () => {
    queryImpl = () => rows([]);
    await expect(getSymbolLabel('123456')).resolves.toBe('123456');
  });

  test('이름이 비었거나 NULL(해외 종목 등) — 티커 그대로', async () => {
    queryImpl = () => rows([{ name: null }]);
    await expect(getSymbolLabel('AAPL')).resolves.toBe('AAPL');
    queryImpl = () => rows([{ name: '   ' }]);
    await expect(getSymbolLabel('TSLA')).resolves.toBe('TSLA');
  });

  test('DB 조회 실패 — 던지지 않고 코드 폴백 + 경고 로그', async () => {
    queryImpl = () => Promise.reject(new Error('ECONNREFUSED'));
    await expect(getSymbolLabel('000660')).resolves.toBe('000660');
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0][0])).toContain('000660');
  });

  test('getPool 자체가 던져도 코드 폴백', async () => {
    queryImpl = () => { throw new Error('pool exhausted'); };
    await expect(getSymbolLabel('005930')).resolves.toBe('005930');
  });

  test('종목명의 &·<·> 는 이스케이프 — 텔레그램 HTML 400 유실 방지', async () => {
    queryImpl = () => rows([{ name: 'S&T모티브' }]);
    await expect(getSymbolLabel('064960')).resolves.toBe('S&amp;T모티브');
  });

  test('빈 심볼은 DB 조회 없이 빈 문자열', async () => {
    await expect(getSymbolLabel('')).resolves.toBe('');
    expect(queryCalls).toHaveLength(0);
  });
});

// ─── T-033 — 배치판 ─────────────────────────────────────────────────────────

describe('getSymbolLabels', () => {
  test('쿼리 1번으로 여러 심볼을 라벨링한다', async () => {
    queryImpl = () => rows([
      { symbol: '000660', name: 'SK하이닉스' },
      { symbol: '005930', name: '삼성전자' },
    ]);
    const labels = await getSymbolLabels(['000660', '005930']);
    expect(queryCalls).toHaveLength(1);
    expect(labels.get('000660')).toBe('SK하이닉스');
    expect(labels.get('005930')).toBe('삼성전자');
  });

  test('중복 심볼은 한 번만 조회한다', async () => {
    queryImpl = () => rows([]);
    await getSymbolLabels(['005930', '005930', '005930']);
    expect(queryCalls[0].params).toEqual([['005930']]);
  });

  test('캐시 미스·빈 이름은 심볼 코드로 폴백하고, 입력 전부에 키가 생긴다', async () => {
    queryImpl = () => rows([{ symbol: '005930', name: '   ' }]);
    const labels = await getSymbolLabels(['005930', 'NAS:MU']);
    expect(labels.get('005930')).toBe('005930');
    expect(labels.get('NAS:MU')).toBe('NAS:MU');
    expect(labels.size).toBe(2);
  });

  test('DB 가 던져도 전파하지 않고 심볼 코드로 폴백한다', async () => {
    queryImpl = () => Promise.reject(new Error('db down'));
    const labels = await getSymbolLabels(['005930']);
    expect(labels.get('005930')).toBe('005930');
    expect(warnSpy).toHaveBeenCalled();
  });

  test('종목명의 & 등은 이스케이프된다(텔레그램 HTTP 400 방지)', async () => {
    queryImpl = () => rows([{ symbol: '064960', name: 'S&T모티브' }]);
    expect((await getSymbolLabels(['064960'])).get('064960')).toBe('S&amp;T모티브');
  });

  test('빈 목록이면 쿼리조차 쏘지 않는다', async () => {
    expect((await getSymbolLabels([])).size).toBe(0);
    expect((await getSymbolLabels(['', '  '])).size).toBe(0);
    expect(queryCalls).toHaveLength(0);
  });

  test('라이브 KIS 폴백은 없다 — stock_meta 만 본다', async () => {
    queryImpl = () => rows([]);
    await getSymbolLabels(['NAS:MU']);
    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0].sql).toMatch(/stock_meta/);
  });
});
