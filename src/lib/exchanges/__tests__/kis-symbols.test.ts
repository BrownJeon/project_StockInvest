import {
  getMarketFromSymbol,
  parseOverseas,
  formatOverseas,
  toOvrsExcgCd,
  isDomesticSymbol,
  isOverseasSymbol,
} from '../kis-symbols';

describe('kis-symbols', () => {
  describe('getMarketFromSymbol', () => {
    test('6자리 숫자는 domestic', () => {
      expect(getMarketFromSymbol('005930')).toBe('domestic');
      expect(getMarketFromSymbol('000660')).toBe('domestic');
    });
    test('NAS:AAPL 형식은 overseas', () => {
      expect(getMarketFromSymbol('NAS:AAPL')).toBe('overseas');
      expect(getMarketFromSymbol('NYS:TSLA')).toBe('overseas');
      expect(getMarketFromSymbol('AMS:SPY')).toBe('overseas');
    });
    test('점이 포함된 티커도 허용', () => {
      expect(getMarketFromSymbol('NYS:BRK.B')).toBe('overseas');
    });
    test('잘못된 형식은 domestic 폴백', () => {
      expect(getMarketFromSymbol('AAPL')).toBe('domestic');
      expect(getMarketFromSymbol('nas:AAPL')).toBe('domestic');
    });
  });

  describe('isDomesticSymbol / isOverseasSymbol', () => {
    test('정확한 패턴만 true', () => {
      expect(isDomesticSymbol('005930')).toBe(true);
      expect(isDomesticSymbol('5930')).toBe(false);
      expect(isOverseasSymbol('NAS:AAPL')).toBe(true);
      expect(isOverseasSymbol('AAPL')).toBe(false);
    });
  });

  describe('parseOverseas', () => {
    test('정상 파싱', () => {
      expect(parseOverseas('NAS:AAPL')).toEqual({ excd: 'NAS', ticker: 'AAPL' });
      expect(parseOverseas('NYS:BRK.B')).toEqual({ excd: 'NYS', ticker: 'BRK.B' });
    });
    test('잘못된 형식은 throw', () => {
      expect(() => parseOverseas('005930')).toThrow();
      expect(() => parseOverseas('AAPL')).toThrow();
    });
  });

  describe('formatOverseas', () => {
    test('대문자 정규화', () => {
      expect(formatOverseas('NAS', 'aapl')).toBe('NAS:AAPL');
      expect(formatOverseas('NYS', 'BRK.B')).toBe('NYS:BRK.B');
    });
  });

  describe('toOvrsExcgCd', () => {
    test('KIS 4자리 코드 매핑', () => {
      expect(toOvrsExcgCd('NAS')).toBe('NASD');
      expect(toOvrsExcgCd('NYS')).toBe('NYSE');
      expect(toOvrsExcgCd('AMS')).toBe('AMEX');
    });
  });
});
