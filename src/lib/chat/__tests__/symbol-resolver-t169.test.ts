/** T-169 B3 — 종목 인식(미국 티커·제외어·한글 별칭) + 기존 국내 규칙 회귀. DB 는 모의(stock_meta 몇 행). */
const mockQuery = jest.fn();
jest.mock('@/lib/db', () => ({ getPool: () => ({ query: (...a: unknown[]) => mockQuery(...a) }) }));

import { findAliasTickers, findBareTickers, resolveSymbolsInText, US_TICKER_STOPWORDS } from '../symbol-resolver';
import { US_NAME_ALIASES } from '../us-name-aliases';

const META: Record<string, { name: string; market: 'domestic' | 'overseas' }> = {
  '005930': { name: '삼성전자', market: 'domestic' },
  '000660': { name: 'SK하이닉스', market: 'domestic' },
  '042660': { name: '한화오션', market: 'domestic' },
  'NAS:NVDA': { name: 'NVIDIA CORP', market: 'overseas' },
  'NAS:AAPL': { name: 'APPLE INC', market: 'overseas' },
  'NAS:MSFT': { name: 'MICROSOFT CORP', market: 'overseas' },
  'NYS:TSM': { name: 'TAIWAN SEMICONDUCTOR', market: 'overseas' },
  'NAS:TSM': { name: 'TSM ON NASDAQ (가상)', market: 'overseas' },
  'NYS:KO': { name: 'COCA-COLA CO', market: 'overseas' },
  'AMS:SPY': { name: 'SPDR S&P 500', market: 'overseas' },
  'NAS:AI': { name: 'C3.AI (가상 — 제외어 확인용)', market: 'overseas' },
  'NYS:RSI': { name: 'RUSH STREET (가상 — 제외어 확인용)', market: 'overseas' },
};

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (/WHERE symbol = \? LIMIT 1/.test(sql)) {
      const m = META[String(params?.[0])];
      return [m ? [{ name: m.name }] : [], []];
    }
    if (/market = 'domestic'/.test(sql)) {
      return [Object.entries(META).filter(([, v]) => v.market === 'domestic').map(([symbol, v]) => ({ symbol, name: v.name })), []];
    }
    if (/market = 'overseas' AND symbol IN \(\?\)/.test(sql)) {
      const wanted = (params?.[0] as string[]) ?? [];
      return [wanted.filter((s) => META[s]?.market === 'overseas').map((s) => ({ symbol: s, name: META[s].name })), []];
    }
    throw new Error(`unexpected sql ${sql}`);
  });
});

describe('한글 별칭', () => {
  test('「엔비디아 어때?」→ NAS:NVDA (데모 장면 ②)', async () => {
    expect(await resolveSymbolsInText('엔비디아 어때?')).toEqual([
      { symbol: 'NAS:NVDA', name: 'NVIDIA CORP', matchedText: '엔비디아' },
    ]);
  });

  test('조사가 붙어도 인식, 막힌 접미사(메타버스·애플리케이션)는 인식 안 함', () => {
    expect(findAliasTickers('애플이랑 마이크로소프트는?').map((h) => h.ticker)).toEqual(['AAPL', 'MSFT']);
    expect(findAliasTickers('메타버스 관련주, 애플리케이션 업종')).toEqual([]);
    expect(findAliasTickers('메타버스 말고 메타 실적').map((h) => h.ticker)).toEqual(['META']);
  });

  test('stock_meta 에 없는 별칭 심볼은 버린다', async () => {
    // 테슬라(TSLA)는 모의 stock_meta 에 없다
    expect(await resolveSymbolsInText('테슬라 어때')).toEqual([]);
  });

  test('별칭 표 — 티커는 대문자 1~5자, 별칭은 중복 없음', () => {
    const seen = new Set<string>();
    for (const a of US_NAME_ALIASES) {
      expect(a.ticker).toMatch(/^[A-Z]{1,5}$/);
      expect(seen.has(a.alias)).toBe(false);
      seen.add(a.alias);
    }
    expect(US_NAME_ALIASES.length).toBeGreaterThanOrEqual(30);
  });
});

describe('단독 티커', () => {
  test('대문자 2~5자 + stock_meta 해외 접미사 일치 → 심볼, NAS→NYS→AMS 순', async () => {
    expect(await resolveSymbolsInText('NVDA 랑 TSM 비교')).toEqual([
      { symbol: 'NAS:NVDA', name: 'NVIDIA CORP', matchedText: 'NVDA' },
      { symbol: 'NAS:TSM', name: 'TSM ON NASDAQ (가상)', matchedText: 'TSM' },
    ]);
    expect(await resolveSymbolsInText('SPY 어때')).toEqual([{ symbol: 'AMS:SPY', name: 'SPDR S&P 500', matchedText: 'SPY' }]);
    expect(await resolveSymbolsInText('KO 배당')).toEqual([{ symbol: 'NYS:KO', name: 'COCA-COLA CO', matchedText: 'KO' }]);
  });

  test('제외어(AI·RSI·ETF·CPI·FOMC …)는 stock_meta 에 있어도 티커로 보지 않는다', async () => {
    expect(US_TICKER_STOPWORDS.has('AI')).toBe(true);
    expect(await resolveSymbolsInText('AI 관련 ETF 중 RSI 낮은 거, CPI 와 FOMC 이후')).toEqual([]);
    const sqls = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /market = 'overseas'/.test(s))).toBe(false);   // 후보가 없으면 묻지도 않는다
  });

  test('소문자·1자·6자 이상·EXCHG: 일부·숫자 붙은 토큰은 후보가 아니다', () => {
    expect(findBareTickers('nvda A GOOGLEX NAS:NVDA NVDA2 S&P').map((t) => t.ticker)).toEqual([]);
  });

  test('한글에 바로 붙은 티커도 인식(앞뒤가 영문·숫자가 아니면)', () => {
    expect(findBareTickers('엔비디아(NVDA)는 MSFT보다').map((t) => t.ticker)).toEqual(['NVDA', 'MSFT']);
  });
});

describe('기존 국내 규칙 회귀·상한', () => {
  test('6자리 코드·EXCHG:SYMBOL·국내 종목명은 이전과 같다', async () => {
    expect(await resolveSymbolsInText('005930 어때')).toEqual([{ symbol: '005930', name: '삼성전자', matchedText: '005930' }]);
    expect(await resolveSymbolsInText('NAS:AAPL 은?')).toEqual([{ symbol: 'NAS:AAPL', name: 'APPLE INC', matchedText: 'NAS:AAPL' }]);
    expect(await resolveSymbolsInText('삼성전자 지금 어때?')).toEqual([{ symbol: '005930', name: '삼성전자', matchedText: '삼성전자' }]);
  });

  test('국내가 먼저, 미국은 그다음, 최대 3개·중복 제거', async () => {
    const r = await resolveSymbolsInText('한화오션, SK하이닉스, 엔비디아, 애플, NVDA');
    expect(r.map((x) => x.symbol)).toEqual(['000660', '042660', 'NAS:NVDA']);
    const r2 = await resolveSymbolsInText('엔비디아와 NVDA 와 NAS:NVDA');
    expect(r2.map((x) => x.symbol)).toEqual(['NAS:NVDA']);
  });

  test('stock_meta 해외 조회가 실패해도 국내 결과는 돌려준다', async () => {
    const base = mockQuery.getMockImplementation()!;
    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/market = 'overseas'/.test(sql)) throw new Error('db down');
      return base(sql, params);
    });
    expect((await resolveSymbolsInText('삼성전자와 엔비디아')).map((x) => x.symbol)).toEqual(['005930']);
  });
});
