import { fmtNum, fmtPnl, pnlColor } from '../format';

describe('fmtNum', () => {
  test('기본 0자리 반올림', () => {
    expect(fmtNum(1234567)).toBe('1,234,567');
    expect(fmtNum(1000.5)).toBe('1,001');
  });

  test('digits 지정', () => {
    expect(fmtNum(1234.5678, 2)).toBe('1,234.57');
    expect(fmtNum(0.000001, 6)).toBe('0.000001');
  });

  test('NaN/Infinity 방어', () => {
    expect(fmtNum(Number.NaN)).toBe('-');
    expect(fmtNum(Number.POSITIVE_INFINITY)).toBe('-');
  });
});

describe('fmtPnl', () => {
  test('부호 표시', () => {
    expect(fmtPnl(2.34)).toBe('+2.34%');
    expect(fmtPnl(-1.5)).toBe('-1.50%');
    expect(fmtPnl(0)).toBe('+0.00%');
  });

  test('비정상 값', () => {
    expect(fmtPnl(Number.NaN)).toBe('-');
  });
});

describe('pnlColor', () => {
  test('한국 관습 색상', () => {
    expect(pnlColor(1)).toBe('var(--up)');
    expect(pnlColor(-1)).toBe('var(--down)');
    expect(pnlColor(0)).toBe('var(--muted)');
    expect(pnlColor(Number.NaN)).toBe('var(--muted)');
  });
});
