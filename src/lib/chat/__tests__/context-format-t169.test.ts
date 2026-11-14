/** T-169 B4 — formatSymbolContextsAsText 단위 표기(국내 원 · 해외 달러). KIS 호출 없음. */
jest.mock('@/lib/exchanges/kis', () => ({ kis: {} }));
jest.mock('@/lib/strategy/ai-filter', () => ({ buildMarketSummary: () => { throw new Error('not used'); } }));

import { formatSymbolContextsAsText, type SymbolContext } from '../context-builder';

const base: Omit<SymbolContext, 'symbol' | 'name' | 'price'> = {
  priceChange5: -13.7, rsi14: 25.04, ema20: 1, ema60: 2, macdHistogram: -1337, atrPct: 3.21,
  high24h: undefined, low24h: undefined,
};

test('국내 — 원 표기(이전과 같은 모양)', () => {
  const text = formatSymbolContextsAsText([{ ...base, symbol: '005930', name: '삼성전자', matchedText: '삼성전자', price: 98_700 }]);
  expect(text).toBe('- 삼성전자 (005930): 현재 98,700원, RSI(14) 25.0, 단기 하락, MACD 히스토 -1337.00, ATR% 3.21%, 5봉 변화 -13.70%');
});

test('해외 — KIS 달러 원가로 $ 표기, 원화 환산값에 $ 를 붙이지 않는다, MACD 도 달러로 복원', () => {
  const text = formatSymbolContextsAsText([{
    ...base, symbol: 'NAS:NVDA', name: 'NVIDIA CORP', matchedText: '엔비디아', price: 215_420.6, priceUsd: 161.11,
  }]);
  expect(text).toContain('NVIDIA CORP(엔비디아, NAS:NVDA): 현재 $161.11');
  expect(text).not.toMatch(/\$215|215,421원|원,/);
  // -1337 원 × (161.11 / 215420.6) ≈ -1.00 달러
  expect(text).toContain('MACD 히스토 -1.00');
});

test('해외인데 달러 원가를 모르면(예전 echo) 「원화 환산」이라고 밝힌다', () => {
  const text = formatSymbolContextsAsText([{ ...base, symbol: 'NYS:KO', name: 'COCA-COLA CO', price: 93_500 }]);
  expect(text).toContain('현재가 달러 미확인(원화 환산 약 93,500원)');
  expect(text).toContain('MACD 히스토 음(-)');
  expect(text).not.toContain('$');
});

test('1,000 달러 이상 자리 구분·소수 둘째 자리', () => {
  const text = formatSymbolContextsAsText([{ ...base, symbol: 'NAS:MELI', name: 'MERCADOLIBRE INC', price: 2_000_000, priceUsd: 1496.5 }]);
  expect(text).toContain('현재 $1,496.50');
});

test('빈 목록은 빈 문자열', () => {
  expect(formatSymbolContextsAsText([])).toBe('');
});
