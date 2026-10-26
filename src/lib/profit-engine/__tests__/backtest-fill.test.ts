/**
 * T-096 체결 모델 — d1open(판정용)·지정가(민감도) 경계·부호·off-by-one. 합성 봉만.
 */
import { roundTrip, scaleSlippage, stopCost } from '../backtest/costs';
import { adtv, d1openFill as d1openFillRaw, gapSkip, isTaken, limitFill as limitFillRaw, tickSize, type FillOptions } from '../backtest/fill';
import type { Bar, CostModel } from '../backtest/types';
import { bar, frame, weekdays } from './backtest-fixtures';

const US: CostModel = { feeRoundTrip: 0.005, slippage: 0.0015, stopSlippage: 0.0025 };
const ZERO: CostModel = { feeRoundTrip: 0, slippage: 0, stopSlippage: 0 };
const D = weekdays('2025-01-06', 40);
/** 등록값(registry execution)과 같은 시험 기본 옵션 — 엔진 함수에는 기본값이 없다(v1.1 단일 출처). */
const OPT: FillOptions = { gapUp: 0.02, gapDown: 0.03, gapBoundary: 'skip', slotAmount: null, adtvWindow: 20, adtvMaxShare: 0.001 };
const d1openFill = (f: Parameters<typeof d1openFillRaw>[0], i: number, h: number, s: number | null, c: CostModel, o: Partial<FillOptions> = {}) => d1openFillRaw(f, i, h, s, c, { ...OPT, ...o });
const limitFill = (f: Parameters<typeof limitFillRaw>[0], i: number, h: number, s: number | null, c: CostModel) => limitFillRaw(f, i, h, s, c, 0.005, OPT);

/** i=0 신호 봉(close 100), 1 = 진입 봉, 그 뒤 평탄 100. over 로 특정 봉을 바꾼다. */
function mk(over: Record<number, Partial<Bar>> = {}, n = 12) {
  const bars = Array.from({ length: n }, (_, k) => bar(D[k], 100, 100, 100, 100, over[k] || {}));
  return frame('NAS:AAA', bars);
}

describe('비용 모델', () => {
  test('US 왕복 0.65%·손절 0.75%, 슬리피지 ×1.5 = 0.725%', () => {
    expect(roundTrip(US)).toBeCloseTo(0.0065, 12);
    expect(stopCost(US)).toBeCloseTo(0.0075, 12);
    expect(roundTrip(scaleSlippage(US, 1.5))).toBeCloseTo(0.00725, 12);
    expect(stopCost(scaleSlippage(US, 1.5))).toBeCloseTo(0.00875, 12);
    expect(() => scaleSlippage(US, -1)).toThrow();
  });
  test('KR 왕복 0.33%·손절 0.43%, ×1.5 = 0.405%', () => {
    const KR = { feeRoundTrip: 0.0018, slippage: 0.0015, stopSlippage: 0.0025 };
    expect(roundTrip(KR)).toBeCloseTo(0.0033, 12);
    expect(stopCost(KR)).toBeCloseTo(0.0043, 12);
    expect(roundTrip(scaleSlippage(KR, 1.5))).toBeCloseTo(0.00405, 12);
  });
});

describe('d1openFill — 진입 D+1 시가, 청산 D+hold 종가', () => {
  test('시간 청산: 진입가 = i+1 시가, 청산 = i+hold 종가, 순수익 = 총 − 왕복', () => {
    const f = mk({ 1: { open: 100, close: 101, high: 101, low: 100 }, 5: { close: 110, high: 110, low: 100 } });
    const fl = d1openFill(f, 0, 5, null, US)!;
    expect(fl.entryDate).toBe(D[1]);
    expect(fl.entryPrice).toBe(100);
    expect(fl.exitDate).toBe(D[5]);
    expect(fl.exitKind).toBe('time');
    expect(fl.grossRet).toBeCloseTo(0.10, 12);
    expect(fl.netRet).toBeCloseTo(0.10 - 0.0065, 12);
  });
  test('진입가는 D0 종가가 아니라 D+1 시가(갭 필터 안쪽 +1%)', () => {
    const f = mk({ 1: { open: 101, high: 101, low: 100, close: 101 }, 5: { close: 110, high: 110, low: 100 } });
    const fl = d1openFill(f, 0, 5, null, ZERO)!;
    expect(fl.entryPrice).toBe(101);
    expect(fl.grossRet).toBeCloseTo(110 / 101 - 1, 12);
  });
  test('off-by-one: hold=1 이면 진입 당일 종가에 청산(D+1 = 진입 당일)', () => {
    const f = mk({ 1: { open: 100, close: 103, high: 103, low: 100 } });
    const fl = d1openFill(f, 0, 1, null, ZERO)!;
    expect(fl.exitDate).toBe(D[1]);
    expect(fl.grossRet).toBeCloseTo(0.03, 12);
  });
  test('변이: 비용 0 이면 순 = 총, 비용이 있으면 순 < 총(방향)', () => {
    const f = mk({ 5: { close: 105, high: 105 } });
    const a = d1openFill(f, 0, 5, null, ZERO)!;
    const b = d1openFill(f, 0, 5, null, US)!;
    expect(a.netRet).toBe(a.grossRet);
    expect(b.netRet).toBeLessThan(b.grossRet);
    expect(b.grossRet - b.netRet).toBeCloseTo(roundTrip(US), 12);
  });
  test('보유 창이 데이터 끝을 넘으면 null(미청산), 정확히 끝 봉이면 청산', () => {
    const f = mk({}, 6);
    expect(d1openFill(f, 0, 5, null, US)).not.toBeNull();
    expect(d1openFill(f, 0, 6, null, US)).toBeNull();
    expect(d1openFill(f, 1, 5, null, US)).toBeNull();
  });
  test('제외 봉(adj_stale)이 창 안에 있으면 null', () => {
    const f = mk({ 3: { flags: 'adj_stale' } });
    expect(d1openFill(f, 0, 5, null, US)).toBeNull();
    expect(d1openFill(f, 0, 2, null, US)).not.toBeNull();
  });
  test('결측 구간(봉 간격 > 9일)이 창 안에 있으면 null', () => {
    const bars = [bar('2025-01-06', 100, 100, 100, 100), bar('2025-01-07', 100, 100, 100, 100), bar('2025-01-20', 100, 100, 100, 100), bar('2025-01-21', 100, 100, 100, 100)];
    expect(d1openFill(frame('X', bars), 0, 3, null, US)).toBeNull();
    expect(d1openFill(frame('X', bars), 0, 1, null, US)).not.toBeNull();
  });
  test('잘못된 hold·stop 은 오류', () => {
    const f = mk();
    expect(() => d1openFill(f, 0, 0, null, US)).toThrow();
    expect(() => d1openFill(f, 0, 2.5, null, US)).toThrow();
    expect(() => d1openFill(f, 0, 5, 0, US)).toThrow();
    expect(() => d1openFill(f, 0, 5, 1, US)).toThrow();
  });
});

describe('갭 필터 — +2.0%/−3.0% 경계는 미진입, 0.0001 안쪽은 진입', () => {
  test.each([
    [102, 'gap_skip'], [101.99, 'time'], [97, 'gap_skip'], [97.01, 'time'], [110, 'gap_skip'], [90, 'gap_skip'], [100, 'time'],
  ])('open_{D+1}=%p → %s', (open, kind) => {
    const f = mk({ 1: { open, high: Math.max(open, 100), low: Math.min(open, 100) } });
    expect(d1openFill(f, 0, 5, null, US)!.exitKind).toBe(kind);
  });
  test('gapSkip 함수 직접: 종가·시가 비양수는 판단 불가 → 미진입', () => {
    expect(gapSkip(0, 100, 0.02, 0.03, 'skip')).toBe(true);
    expect(gapSkip(100, NaN, 0.02, 0.03, 'skip')).toBe(true);
    expect(gapSkip(100, 101.99, 0.02, 0.03, 'skip')).toBe(false);
    // registry gapBoundary 배선: 'enter' 면 경계값은 진입, 경계 바깥은 여전히 미진입
    expect(gapSkip(100, 102, 0.02, 0.03, 'enter')).toBe(false);
    expect(gapSkip(100, 97, 0.02, 0.03, 'enter')).toBe(false);
    expect(gapSkip(100, 102.01, 0.02, 0.03, 'enter')).toBe(true);
    expect(gapSkip(100, 96.99, 0.02, 0.03, 'enter')).toBe(true);
  });
  test('건너뛴 체결은 수익 0·isTaken=false', () => {
    const fl = d1openFill(mk({ 1: { open: 103, high: 103 } }), 0, 5, null, US)!;
    expect(fl.grossRet).toBe(0);
    expect(fl.netRet).toBe(0);
    expect(isTaken(fl)).toBe(false);
  });
});

describe('손절 — 진입 당일 포함, low ≤ 손절가, 시가가 아래면 시가', () => {
  test('low 가 손절가와 같으면 손절(≤ — 변이 < 를 잡는다)', () => {
    const f = mk({ 3: { low: 97 } });
    const fl = d1openFill(f, 0, 5, 0.03, US)!;
    expect(fl.exitKind).toBe('stop');
    expect(fl.exitPrice).toBeCloseTo(97, 10);
    expect(fl.exitDate).toBe(D[3]);
    expect(fl.netRet).toBeCloseTo(-0.03 - 0.0075, 10);
  });
  test('low 가 손절가보다 0.01 위면 손절 없음', () => {
    expect(d1openFill(mk({ 3: { low: 97.01 } }), 0, 5, 0.03, US)!.exitKind).toBe('time');
  });
  test('시가가 손절가 아래(갭 하락)면 시가에 손절(변이: open<stop 조건 제거 시 97 이 나와 실패)', () => {
    const fl = d1openFill(mk({ 3: { open: 95, low: 94, high: 96, close: 95 } }), 0, 5, 0.03, US)!;
    expect(fl.exitPrice).toBe(95);
    expect(fl.exitKind).toBe('stop');
  });
  test('진입 당일 저가 손절', () => {
    const fl = d1openFill(mk({ 1: { open: 100, low: 96, high: 100, close: 99 } }), 0, 5, 0.03, US)!;
    expect(fl.exitDate).toBe(D[1]);
    expect(fl.exitPrice).toBeCloseTo(97, 10);
  });
  test('청산일에 손절가도 닿으면 손절 먼저(보수)', () => {
    const fl = d1openFill(mk({ 5: { low: 96, close: 120, high: 120 } }), 0, 5, 0.03, US)!;
    expect(fl.exitKind).toBe('stop');
  });
  test('손절 없음(null)이면 저가가 낮아도 시간 청산', () => {
    expect(d1openFill(mk({ 3: { low: 50 } }), 0, 5, null, US)!.exitKind).toBe('time');
  });
});

describe('유동성 필터 — 슬롯 > ADTV20×0.1% 이면 미진입, 같으면 진입', () => {
  const liq = (turnover: number | null, slot: number) => {
    const n = 30;
    const bars = Array.from({ length: n }, (_, k) => bar(D[k], 100, 100, 100, 100, { turnover }));
    return d1openFill(frame('X', bars), 20, 5, null, US, { slotAmount: slot });
  };
  test('경계', () => {
    expect(liq(1_500_000, 1500)!.exitKind).toBe('time');
    expect(liq(1_499_000, 1500)!.exitKind).toBe('liquidity_skip');
  });
  test('거래대금 결측이면 미진입(보수), slotAmount 없으면 필터 안 씀', () => {
    expect(liq(null, 1500)!.exitKind).toBe('liquidity_skip');
    const bars = Array.from({ length: 30 }, (_, k) => bar(D[k], 100, 100, 100, 100, { turnover: null }));
    expect(d1openFill(frame('X', bars), 20, 5, null, US)!.exitKind).toBe('time');
  });
  test('ADTV 는 D0 포함 직전 20봉(미래 봉 미사용)', () => {
    const bars = Array.from({ length: 30 }, (_, k) => bar(D[k], 100, 100, 100, 100, { turnover: k <= 20 ? 1000 : 1e15 }));
    const f = frame('X', bars);
    expect(adtv(f, 20, 20)).toBe(1000);
    expect(adtv(f, 18, 20)).toBeNull();
  });
  test('M09: ADTV 창은 D0 를 포함한다(i−19..i) — D0 거래대금만 다르면 평균이 달라진다', () => {
    const bars = Array.from({ length: 30 }, (_, k) => bar(D[k], 100, 100, 100, 100, { turnover: k === 20 ? 21000 : 1000 }));
    expect(adtv(frame('X', bars), 20, 20)).toBe(2000);
    expect(adtv(frame('X', bars), 19, 20)).toBe(1000);
  });
  test('진입 봉 거래량 0(zero_volume) → liquidity_skip', () => {
    expect(d1openFill(mk({ 1: { volume: 0, flags: 'zero_volume' } }), 0, 5, null, US)!.exitKind).toBe('liquidity_skip');
  });
  test('청산일이 거래 불가면 다음 거래 가능 봉 종가로 미룬다', () => {
    const fl = d1openFill(mk({ 5: { volume: 0, flags: 'zero_volume', close: 50 }, 6: { close: 104, high: 104 } }), 0, 5, null, ZERO)!;
    expect(fl.exitDate).toBe(D[6]);
    expect(fl.grossRet).toBeCloseTo(0.04, 12);
  });
  test('거래 불가일에는 손절하지 않는다', () => {
    const fl = d1openFill(mk({ 3: { volume: 0, flags: 'zero_volume', low: 50 } }), 0, 5, 0.03, ZERO)!;
    expect(fl.exitKind).toBe('time');
  });
});

describe('limitFill — 지정가 close×1.005, D+1 low < 지정가 − 1틱 이면 체결', () => {
  test('경계: low = 지정가−1틱 은 미체결, 그보다 1센트 낮으면 체결', () => {
    expect(limitFill(mk({ 1: { low: 100.49, open: 101, high: 101 } }), 0, 5, null, US)!.exitKind).toBe('unfilled');
    const fl = limitFill(mk({ 1: { low: 100.48, open: 101, high: 101 } }), 0, 5, null, US)!;
    expect(fl.exitKind).toBe('time');
    expect(fl.entryPrice).toBeCloseTo(100.5, 10);
  });
  test('시가가 지정가 아래면 시가 체결(min)', () => {
    expect(limitFill(mk({ 1: { open: 99, low: 98, high: 100 } }), 0, 5, null, US)!.entryPrice).toBe(99);
  });
  test('KR 호가 단위', () => {
    expect(tickSize('KR', 1999)).toBe(1);
    expect(tickSize('KR', 2000)).toBe(5);
    expect(tickSize('KR', 49_999)).toBe(50);
    expect(tickSize('KR', 50_000)).toBe(100);
    expect(tickSize('KR', 600_000)).toBe(1000);
    expect(tickSize('US', 5000)).toBe(0.01);
  });
});
