/**
 * Yahoo chart 데이터 소스 — 파싱·보정·폴백·헤더 검증 (T-032).
 * 네트워크는 타지 않는다(fetchImpl 주입).
 */
import {
  fetchYahooDailyHistory,
  parseYahooChart,
  toLocalDateString,
} from '../data/yahoo-finance-source';

const DAY = 86400;
const T0 = Date.UTC(2024, 0, 2) / 1000; // 2024-01-02 00:00 UTC

function chartBody(opts: {
  closes: (number | null)[];
  adjcloses?: (number | null)[];
  volumes?: (number | null)[];
  gmtoffset?: number;
}) {
  const n = opts.closes.length;
  return {
    chart: {
      result: [
        {
          meta: { gmtoffset: opts.gmtoffset ?? 0 },
          timestamp: Array.from({ length: n }, (_, i) => T0 + i * DAY),
          indicators: {
            quote: [
              {
                open: opts.closes,
                high: opts.closes.map((c) => (c == null ? null : c * 1.01)),
                low: opts.closes.map((c) => (c == null ? null : c * 0.99)),
                close: opts.closes,
                volume: opts.volumes ?? opts.closes.map(() => 1000),
              },
            ],
            ...(opts.adjcloses ? { adjclose: [{ adjclose: opts.adjcloses }] } : {}),
          },
        },
      ],
      error: null,
    },
  };
}

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe('toLocalDateString', () => {
  test('거래소 offset 을 반영해 현지 날짜를 만든다', () => {
    // 2024-01-02 00:00 UTC + KST(9h) → 2024-01-02 09:00 KST
    expect(toLocalDateString(T0, 9 * 3600)).toBe('2024-01-02');
    // 미국 동부(-5h) 기준이면 전날로 넘어간다
    expect(toLocalDateString(T0, -5 * 3600)).toBe('2024-01-01');
  });
});

describe('parseYahooChart', () => {
  test('정상 응답을 오름차순 캔들로 파싱한다', () => {
    const candles = parseYahooChart(chartBody({ closes: [100, 101, 102] }));
    expect(candles).toHaveLength(3);
    expect(candles[0].date).toBe('2024-01-02');
    expect(candles[2].close).toBeCloseTo(102, 8);
    expect(candles[0].volume).toBe(1000);
  });

  test('🔴 분할 보정 — adjclose 비율을 OHL 에도 동일 적용한다', () => {
    // 2:1 분할로 앞 구간 원종가가 200이지만 adjclose 는 100
    const candles = parseYahooChart(
      chartBody({ closes: [200, 200, 100], adjcloses: [100, 100, 100] }),
    );
    expect(candles.map((c) => c.close)).toEqual([100, 100, 100]);
    // high 는 원본 202 → 보정 후 101 (같은 factor 0.5)
    expect(candles[0].high).toBeCloseTo(101, 8);
    expect(candles[0].low).toBeCloseTo(99, 8);
    // 보정하지 않으면 -50% 가짜 폭락이 생긴다 — 그 값이 남아있지 않은지 확인
    expect(candles[1].close / candles[2].close).toBeCloseTo(1, 8);
  });

  test('adjclose 가 없으면 원본 종가를 그대로 쓴다', () => {
    const candles = parseYahooChart(chartBody({ closes: [10, 20] }));
    expect(candles.map((c) => c.close)).toEqual([10, 20]);
  });

  test('결측(null) 봉은 보간하지 않고 버린다', () => {
    const candles = parseYahooChart(chartBody({ closes: [100, null, 102] }));
    expect(candles).toHaveLength(2);
    expect(candles.map((c) => c.close)).toEqual([100, 102]);
  });

  test('volume 결측은 0 으로 채운다', () => {
    const candles = parseYahooChart(chartBody({ closes: [100], volumes: [null] }));
    expect(candles[0].volume).toBe(0);
  });

  test('빈/깨진 응답은 빈 배열', () => {
    expect(parseYahooChart(null)).toEqual([]);
    expect(parseYahooChart({})).toEqual([]);
    expect(parseYahooChart({ chart: { result: [] } })).toEqual([]);
    expect(parseYahooChart({ chart: { result: [{}] } })).toEqual([]);
  });
});

describe('fetchYahooDailyHistory', () => {
  test('🔴 브라우저 User-Agent 헤더를 반드시 붙인다 (없으면 Yahoo 가 429)', async () => {
    const fetchImpl = jest.fn(async () => okResponse(chartBody({ closes: [1, 2] })));
    await fetchYahooDailyHistory('MU', { fetchImpl: fetchImpl as unknown as typeof fetch });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const ua = (init.headers as Record<string, string>)['User-Agent'];
    expect(ua).toBeTruthy();
    expect(ua).toMatch(/Mozilla\/5\.0/);
  });

  test('URL 에 검증된 심볼만 들어간다', async () => {
    const fetchImpl = jest.fn(async () => okResponse(chartBody({ closes: [1] })));
    await fetchYahooDailyHistory('005930.KS', {
      range: '2y',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toContain('/v8/finance/chart/005930.KS?');
    expect(url).toContain('range=2y');
    expect(url).toContain('interval=1d');
  });

  test('allowlist 미통과 심볼은 네트워크를 타지 않고 즉시 던진다', async () => {
    const fetchImpl = jest.fn();
    await expect(
      fetchYahooDailyHistory('MU/../../etc', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/unsafe yahoo symbol/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('query1 실패 시 query2 로 폴백한다', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
      .mockResolvedValueOnce(okResponse(chartBody({ closes: [5, 6] })));
    const candles = await fetchYahooDailyHistory('MU', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(candles).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toContain('query1');
    expect((fetchImpl.mock.calls[1] as unknown as [string])[0]).toContain('query2');
  });

  test('모든 호스트 실패 시 마지막 사유를 담아 던진다', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    await expect(
      fetchYahooDailyHistory('MU', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/ECONNRESET/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('chart.error 응답도 실패로 처리한다', async () => {
    const fetchImpl = jest.fn(async () =>
      okResponse({ chart: { result: null, error: { description: 'No data found, symbol may be delisted' } } }),
    );
    await expect(
      fetchYahooDailyHistory('MU', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/delisted/);
  });
});
