/**
 * T-066 computeRisk — 승인 데모 v3 합성 시나리오(종목 AAA~EEE · 환율 1,250 · 현금 60만원)로 손계산 값을 고정한다.
 * 숫자는 전부 합성값이다(실제 계좌 아님).
 *
 * 손계산 (평균단가 기준, 손절폭 3%, 한도 2%):
 *   총자산 = 600,000 + 155,000×80 + 60,000×20 + 60,000×50 + 50,000×40 + 40,000×20 = 20,000,000
 *   취득원가 = 165,000×80 + 75,000×20 + 72,000×50 + 62,500×40 + 80,000×20 = 22,400,000
 *   손절 합 = 3% × 22,400,000 = 672,000 → 총자산의 3.36%, 한도 400,000 → 사용률 168%
 *   역산 손절폭 = 2% × 20,000,000 ÷ 22,400,000 = 1.7857… → 1.78%
 *   손절가 아래 5종목 평가손 = -800,000 -300,000 -600,000 -500,000 -800,000 = -3,000,000
 */
import { checkHeatCapPct, checkStopPct, computeRisk, parsePct, round2, type HoldingInput } from '@/lib/risk/compute';

const FX = 1250;
const CASH = 600_000;

type Mk = 'below' | 'mixed' | 'above';
const BASE = [
  { id: 'AAA', us: true, qty: 80, avg: 132.0, peak: 140.0, px: { below: 124.0, mixed: 130.5, above: 133.0 } },
  { id: 'BBB', us: true, qty: 20, avg: 60.0, peak: 62.0, px: { below: 48.0, mixed: 59.0, above: 61.0 } },
  { id: 'CCC', us: false, qty: 50, avg: 72000, peak: 75000, px: { below: 60000, mixed: 60000, above: 73000 } },
  { id: 'DDD', us: false, qty: 40, avg: 62500, peak: 66000, px: { below: 50000, mixed: 61000, above: 63000 } },
  { id: 'EEE', us: false, qty: 20, avg: 80000, peak: 82000, px: { below: 40000, mixed: 40000, above: 81000 } },
];

function holdings(mk: Mk): HoldingInput[] {
  return BASE.map(b => {
    const k = b.us ? FX : 1;
    return {
      symbol: b.us ? `NAS:${b.id}` : b.id,
      market: b.us ? 'overseas' : 'domestic',
      qty: b.qty,
      avgKrw: b.avg * k,
      peakKrw: b.peak * k,
      priceKrw: b.px[mk] * k,
    };
  });
}
function total(mk: Mk): number {
  return CASH + holdings(mk).reduce((a, h) => a + (h.priceKrw as number) * h.qty, 0);
}

describe('computeRisk — 데모 기본 시나리오 (모두 손절가 아래, 평균단가 3% / 한도 2%)', () => {
  const H = holdings('below');
  const c = computeRisk(H, total('below'), { stopPct: 3, heatCapPct: 2, stopBasis: 'avg' }, CASH);

  test('총자산·취득원가·손절 합·사용률', () => {
    expect(c.totalKrw).toBe(20_000_000);
    expect(c.costKrw).toBeCloseTo(22_400_000, 6);
    expect(c.heatKrw).toBeCloseTo(672_000, 6);
    expect((c.heatPct as number).toFixed(2)).toBe('3.36');
    expect(c.capKrw).toBe(400_000);
    expect((c.usagePct as number).toFixed(0)).toBe('168');
    expect(c.over).toBe(true);
  });

  test('역산 손절폭 ≤ 1.78% (0.01 단위 내림)', () => {
    expect(c.maxStopPct).toBe(1.78);
  });

  test('5종목 모두 이미 손절가 아래 · 평가손 합계 -3,000,000원', () => {
    expect(c.belowCount).toBe(5);
    expect(c.belowSymbols).toEqual(['NAS:AAA', 'NAS:BBB', 'CCC', 'DDD', 'EEE']);
    expect(c.belowLossKrw).toBeCloseTo(-3_000_000, 6);
    expect((c.belowLossPct as number).toFixed(2)).toBe('-15.00');
  });

  test('종목 행: 예상 손절가 = 평균단가 × 0.97, 손절 시 손익 -3%, 손절가보다 x% 낮음', () => {
    const aaa = c.rows[0];
    expect(aaa.stopKrw).toBeCloseTo(165_000 * 0.97, 6); // $128.04
    expect(aaa.below).toBe(true);
    expect(aaa.distPct).toBeNull();
    expect((aaa.underPct as number).toFixed(1)).toBe('3.2'); // (160,050 − 155,000) ÷ 160,050
    expect(aaa.pnlAtStopKrw).toBeCloseTo(-396_000, 6);
    expect((aaa.pnlAtStopPct as number).toFixed(1)).toBe('-3.0');
    expect((aaa.unrealPct as number).toFixed(1)).toBe('-6.1');
    const eee = c.rows[4];
    expect((eee.unrealPct as number).toFixed(1)).toBe('-50.0');
  });

  test('구성: 5종목 · 최대 비중 AAA 62% · 현금 3% · 미국 70%', () => {
    expect(c.composition.holdingsCount).toBe(5);
    expect(c.composition.topSymbol).toBe('NAS:AAA');
    expect((c.composition.topPct as number).toFixed(1)).toBe('62.0');
    expect((c.composition.cashPct as number).toFixed(1)).toBe('3.0');
    expect((c.composition.overseasPct as number).toFixed(0)).toBe('70');
  });

  test('계산 불가 없음', () => {
    expect(c.partial).toBe(false);
    expect(c.computableCount).toBe(5);
  });
});

describe('computeRisk — 손절폭·한도 변경', () => {
  test('손절폭 1.5% → 손절 합 1.68% (한도 이내, 사용률 84%)', () => {
    const c = computeRisk(holdings('below'), total('below'), { stopPct: 1.5, heatCapPct: 2, stopBasis: 'avg' });
    expect((c.heatPct as number).toFixed(2)).toBe('1.68');
    expect((c.usagePct as number).toFixed(0)).toBe('84');
    expect(c.over).toBe(false);
  });

  test('손절폭이 역산 상한(1.78%)이면 이내, 1.79%면 초과', () => {
    const at = computeRisk(holdings('below'), total('below'), { stopPct: 1.78, heatCapPct: 2, stopBasis: 'avg' });
    const over = computeRisk(holdings('below'), total('below'), { stopPct: 1.79, heatCapPct: 2, stopBasis: 'avg' });
    expect(at.over).toBe(false);
    expect(over.over).toBe(true);
  });

  test('모두 손절가 위(평가익) — 손절가 아래 0종목, 남은 폭 표시', () => {
    const c = computeRisk(holdings('above'), total('above'), { stopPct: 3, heatCapPct: 2, stopBasis: 'avg' });
    expect(c.belowCount).toBe(0);
    expect(c.belowLossKrw).toBe(0);
    const aaa = c.rows[0];
    expect(aaa.below).toBe(false);
    expect(aaa.underPct).toBeNull();
    // (133 − 128.04) ÷ 133 = 3.73%
    expect((aaa.distPct as number).toFixed(1)).toBe('3.7');
  });

  test('남은 폭 1% 미만이면 손절가 근접', () => {
    const h: HoldingInput[] = [{ symbol: 'ZZZ', market: 'domestic', qty: 10, avgKrw: 10_000, peakKrw: 10_000, priceKrw: 9_750 }];
    const c = computeRisk(h, 1_000_000, { stopPct: 3, heatCapPct: 2, stopBasis: 'avg' });
    expect(c.rows[0].near).toBe(true); // 손절가 9,700 · 남은 폭 0.51%
    expect(c.rows[0].below).toBe(false);
  });

  test('현재가 = 예상 손절가면 "이미 아래"로 본다(≤)', () => {
    const h: HoldingInput[] = [{ symbol: 'ZZZ', market: 'domestic', qty: 10, avgKrw: 10_000, peakKrw: 10_000, priceKrw: 9_700 }];
    const c = computeRisk(h, 1_000_000, { stopPct: 3, heatCapPct: 2, stopBasis: 'avg' });
    expect(c.rows[0].below).toBe(true);
  });
});

describe('computeRisk — 고점 기준 (이동 손절)', () => {
  const H = holdings('below');
  const T = total('below');
  const c = computeRisk(H, T, { stopPct: 3, heatCapPct: 2, stopBasis: 'peak' });

  test('고점이 평균단가 위면 손절 시 손익이 이익 — 손절 합에는 손실만 더한다', () => {
    const aaa = c.rows[0];
    expect(aaa.refKrw).toBe(175_000);
    expect(aaa.stopKrw).toBeCloseTo(169_750, 6);
    expect(aaa.pnlAtStopKrw as number).toBeGreaterThan(0);
    // 손실은 EEE 하나: 80,000 − 82,000×0.97 = 460원 × 20주 = 9,200원
    expect(c.heatKrw).toBeCloseTo(9_200, 6);
    expect(c.over).toBe(false);
  });

  test('역산 손절폭(이분법) — 그 값에서는 이내, +0.01%p 에서는 초과', () => {
    const x = c.maxStopPct as number;
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(20);
    expect(computeRisk(H, T, { stopPct: x, heatCapPct: 2, stopBasis: 'peak' }).over).toBe(false);
    expect(computeRisk(H, T, { stopPct: round2(x + 0.01), heatCapPct: 2, stopBasis: 'peak' }).over).toBe(true);
  });

  test('고점이 현재가보다 낮게 기록돼 있으면 현재가를 고점으로 본다', () => {
    const h: HoldingInput[] = [{ symbol: 'ZZZ', market: 'domestic', qty: 1, avgKrw: 100, peakKrw: 90, priceKrw: 120 }];
    expect(computeRisk(h, 10_000, { stopPct: 10, heatCapPct: 2, stopBasis: 'peak' }).rows[0].refKrw).toBe(120);
  });

  test('한도가 충분하면 역산 상한 20%', () => {
    const h: HoldingInput[] = [{ symbol: 'ZZZ', market: 'domestic', qty: 1, avgKrw: 100, peakKrw: 200, priceKrw: 150 }];
    expect(computeRisk(h, 1_000_000, { stopPct: 3, heatCapPct: 2, stopBasis: 'peak' }).maxStopPct).toBe(20);
  });
});

describe('computeRisk — 경계', () => {
  test('평균단가 없음 → 계산 불가(일부), 손절 합은 계산 가능한 종목만', () => {
    const H = holdings('below');
    H[0] = { ...H[0], avgKrw: null };
    const c = computeRisk(H, total('below'), { stopPct: 3, heatCapPct: 2, stopBasis: 'avg' });
    expect(c.rows[0].computable).toBe(false);
    expect(c.rows[0].reason).toBe('no_avg');
    expect(c.rows[0].stopKrw).toBeNull();
    expect(c.partial).toBe(true);
    expect(c.computableCount).toBe(4);
    expect(c.heatKrw).toBeCloseTo(672_000 - 396_000, 6);
    expect(c.belowCount).toBe(4);
  });

  test('평균단가 0 은 없음과 같다', () => {
    const h: HoldingInput[] = [{ symbol: 'ZZZ', market: 'domestic', qty: 1, avgKrw: 0, peakKrw: 0, priceKrw: 100 }];
    expect(computeRisk(h, 1000, { stopPct: 3, heatCapPct: 2, stopBasis: 'avg' }).rows[0].reason).toBe('no_avg');
  });

  test('고점 기준인데 고점이 없으면 no_peak', () => {
    const h: HoldingInput[] = [{ symbol: 'ZZZ', market: 'domestic', qty: 1, avgKrw: 100, peakKrw: null, priceKrw: 100 }];
    const c = computeRisk(h, 1000, { stopPct: 3, heatCapPct: 2, stopBasis: 'peak' });
    expect(c.rows[0].reason).toBe('no_peak');
    expect(c.maxStopPct).toBeNull();
  });

  test('현재가 없음 → 손절 합에는 넣고 거리는 모름(일부 계산 불가)', () => {
    const h: HoldingInput[] = [{ symbol: 'ZZZ', market: 'domestic', qty: 10, avgKrw: 100, peakKrw: 100, priceKrw: null }];
    const c = computeRisk(h, 10_000, { stopPct: 3, heatCapPct: 2, stopBasis: 'avg' });
    expect(c.rows[0].reason).toBe('no_price');
    expect(c.rows[0].distPct).toBeNull();
    expect(c.heatKrw).toBeCloseTo(30, 6);
    expect(c.partial).toBe(true);
  });

  test('qty 0 종목은 보유가 아니므로 제외', () => {
    const H = holdings('below');
    H[1] = { ...H[1], qty: 0 };
    const c = computeRisk(H, total('below'), { stopPct: 3, heatCapPct: 2, stopBasis: 'avg' });
    expect(c.rows.map(r => r.symbol)).not.toContain('NAS:BBB');
    expect(c.rows).toHaveLength(4);
  });

  test('totalKrw 0 → 비율·사용률·역산은 null, 초과 아님', () => {
    const c = computeRisk(holdings('below'), 0, { stopPct: 3, heatCapPct: 2, stopBasis: 'avg' });
    expect(c.heatKrw).toBeCloseTo(672_000, 6);
    expect(c.heatPct).toBeNull();
    expect(c.usagePct).toBeNull();
    expect(c.maxStopPct).toBeNull();
    expect(c.over).toBe(false);
    expect(c.capKrw).toBe(0);
  });

  test('보유 없음 → 손절 합 0, 역산 null', () => {
    const c = computeRisk([], 1_000_000, { stopPct: 3, heatCapPct: 2, stopBasis: 'avg' });
    expect(c.heatKrw).toBe(0);
    expect(c.heatPct).toBe(0);
    expect(c.over).toBe(false);
    expect(c.maxStopPct).toBeNull();
    expect(c.composition.overseasPct).toBeNull();
  });
});

describe('입력 검증', () => {
  test.each([
    ['3', 3, null],
    ['0.5', 0.5, null],
    ['10', 10, null],
    ['20', 20, '10%보다 크면 손절이 늦어져 한 번에 잃는 돈이 커집니다.'],
    ['10.5', 10.5, '10%보다 크면 손절이 늦어져 한 번에 잃는 돈이 커집니다.'],
    ['3%', 3, null],
    [' 2.345 ', 2.35, null],
    ['1.005', 1.01, null], // 부동소수 보정이 없으면 1.00 이 된다
  ])('손절폭 %p → %p (경고 %p)', (raw, v, warn) => {
    const r = checkStopPct(raw);
    expect(r.error).toBeNull();
    expect(r.value).toBe(v);
    expect(r.warning).toBe(warn);
  });

  test.each(['0.4', '20.01', '25', '-1'])('손절폭 %p 는 범위 오류', (raw) => {
    expect(checkStopPct(raw).error).toBe('0.5% ~ 20% 사이로 넣어 주세요.');
  });

  test.each(['', 'abc', null, undefined])('손절폭 %p 는 숫자 오류', (raw) => {
    expect(checkStopPct(raw).error).toBe('숫자를 넣어 주세요.');
  });

  test('한도 범위 0.5~10', () => {
    expect(checkHeatCapPct('2').value).toBe(2);
    expect(checkHeatCapPct('10').value).toBe(10);
    expect(checkHeatCapPct('10.01').error).toBe('0.5% ~ 10% 사이로 넣어 주세요.');
    expect(checkHeatCapPct('0.49').error).toBe('0.5% ~ 10% 사이로 넣어 주세요.');
  });

  test('parsePct', () => {
    // 쉼표는 받지 않는다 (Reviewer L-4 — '1,5' 를 15 로 읽지 않게)
    expect(parsePct('1,5')).toBeNaN();
    expect(checkStopPct('1,5').error).toBe('숫자를 넣어 주세요.');
    expect(checkHeatCapPct('2,0').error).toBe('숫자를 넣어 주세요.');
    expect(parsePct(Infinity)).toBeNaN();
  });
});

describe('computeRisk — 경계값 (Reviewer 변이 생존분)', () => {
  test('손절가 근접: 남은 폭이 정확히 1% 면 근접 아님, 1% 미만이면 근접', () => {
    // 평균단가 100 · 손절폭 1% → 손절가 99
    const at1 = computeRisk([{ symbol: 'ZZZ', market: 'domestic', qty: 1, avgKrw: 100, peakKrw: 100, priceKrw: 100 }], 10_000, { stopPct: 1, heatCapPct: 2, stopBasis: 'avg' });
    expect(at1.rows[0].distPct).toBeCloseTo(1, 10);
    expect(at1.rows[0].near).toBe(false);
    const under1 = computeRisk([{ symbol: 'ZZZ', market: 'domestic', qty: 1, avgKrw: 100, peakKrw: 100, priceKrw: 99.5 }], 10_000, { stopPct: 1, heatCapPct: 2, stopBasis: 'avg' });
    expect(under1.rows[0].near).toBe(true);
  });

  test('손절 합이 한도와 정확히 같으면(사용률 100%) 초과가 아니다', () => {
    // 평균단가 100 × 10주, 손절폭 10% → 손절 합 100원 · 총자산 5,000 × 2% = 한도 100원
    const c = computeRisk([{ symbol: 'ZZZ', market: 'domestic', qty: 10, avgKrw: 100, peakKrw: 100, priceKrw: 100 }], 5_000, { stopPct: 10, heatCapPct: 2, stopBasis: 'avg' });
    expect(c.heatKrw).toBeCloseTo(100, 10);
    expect(c.capKrw).toBe(100);
    expect(c.usagePct).toBeCloseTo(100, 10);
    expect(c.over).toBe(false);
  });

  test('평균단가 기준 역산 손절폭은 20% 를 넘지 않는다', () => {
    const c = computeRisk([{ symbol: 'ZZZ', market: 'domestic', qty: 1, avgKrw: 1_000, peakKrw: 1_000, priceKrw: 1_000 }], 1_000_000, { stopPct: 3, heatCapPct: 10, stopBasis: 'avg' });
    expect(c.maxStopPct).toBe(20); // 계산식 값은 10,000%
  });

  test('round2 는 부동소수 표현 오차를 보정한다', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(-1.005)).toBe(-1.01);
  });
});
