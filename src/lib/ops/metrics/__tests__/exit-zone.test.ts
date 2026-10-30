/**
 * T-108 A-7 — X5 청산 임계 구간 (가이드 §4.4 · §6 A-7).
 * 경계(−1.5 정확히·+2.5 정확히)·트레일링 override 3.5/1.2·기본값 = style.ts·비교 방향·우선순위가 청산 엔진 evaluateExit 와 같다.
 */
jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));

import { evaluateExit } from '@/lib/strategy/exit-engine';
import { DEFAULT_STYLE_CONFIG, type StyleConfig } from '@/lib/strategy/style';
import { isDomesticSymbol, isOverseasSymbol } from '@/lib/exchanges/kis-symbols';
import { classifyExitZone, isTrailingActive, type ZoneThresholds } from '../exit-zone';
import { marketOfSymbol } from '../holdings';
import { kst } from './fake-reader';

const D = DEFAULT_STYLE_CONFIG;
const T: ZoneThresholds = {
  hardStopPct: D.hardStopPct, eodLossCutPct: D.eodLossCutPct, targetProfitPct: D.targetProfitPct,
  trailingActivatePct: D.trailingActivatePct, trailingDrawdownPct: D.trailingDrawdownPct,
};
const NOON = new Date(kst('2026-10-30 12:00'));
const EOD = new Date(kst('2026-10-30 15:25'));

function zone(price: number, entry = 100, peak = entry, opts: Partial<{ market: 'domestic' | 'overseas'; now: Date; open: boolean; t: ZoneThresholds; sc: any }> = {}) {
  return classifyExitZone({
    market: opts.market ?? 'domestic', price, entry, peak, scenario: opts.sc ?? null, thresholds: opts.t ?? T,
    now: opts.now ?? NOON, overseasOpen: opts.open ?? true,
  });
}

describe('기본값 = style.ts (드리프트 방지)', () => {
  it('코드 기본 임계', () => {
    expect(T).toEqual({ hardStopPct: 1.5, eodLossCutPct: 1.5, targetProfitPct: 2.5, trailingActivatePct: 2.5, trailingDrawdownPct: 1.5 });
  });
});

describe('경계와 비교 방향', () => {
  it('손실 −1.5% 정확히 = 손실한도 손절 구간(≤), −1.49% 는 중립', () => {
    expect(zone(98.5).zone).toBe('hard_stop');
    expect(zone(98.51).zone).toBe('neutral');
  });
  it('+2.5% 정확히 = 익절(≥), +2.49% 는 중립', () => {
    expect(zone(102.5).zone).toBe('take_profit');
    expect(zone(102.49).zone).toBe('neutral');
  });
  it('장마감 전 손절 — 국내·평일 15:20~15:29 만, 손절보다 앞', () => {
    expect(zone(98.5, 100, 100, { now: EOD }).zone).toBe('eod_cut');
    expect(zone(98.5, 100, 100, { now: EOD, market: 'overseas' }).zone).toBe('hard_stop');
    expect(zone(98.5, 100, 100, { now: new Date(kst('2026-10-31 15:25')) }).zone).toBe('hard_stop');   // 토요일
  });
  it('트레일링 override 3.5/1.2 — 고점 +3.5% 부터 활성, 되돌림은 detail 로', () => {
    const t = { ...T, trailingActivatePct: 3.5, trailingDrawdownPct: 1.2 };
    expect(zone(101, 100, 103.49, { t }).zone).toBe('neutral');
    const z = zone(102.3, 100, 103.5, { t });
    expect(z.zone).toBe('trailing_active');
    expect(z.detail.fromPeakPct).toBeCloseTo(-1.16, 2);
    expect(z.detail.thresholdPct).toBe(-1.2);
    expect(isTrailingActive(100, 103.5, 3.5)).toBe(true);
    expect(isTrailingActive(100, 103.49, 3.5)).toBe(false);
  });
  it('미평가 — 해외 장외 · 진입가 없음 · 단위 불일치(비율 [0.3, 3] 밖)', () => {
    expect(zone(100, 100, 100, { market: 'overseas', open: false }).zone).toBe('not_evaluated');
    expect(classifyExitZone({ market: 'domestic', price: 100, entry: null, peak: null, scenario: null, thresholds: T, now: NOON, overseasOpen: true }).zone).toBe('not_evaluated');
    expect(zone(301, 100).zone).toBe('not_evaluated');
    expect(zone(29, 100).zone).toBe('not_evaluated');
  });
  it('부호 — 손절 계열 thresholdPct 음수, 익절 양수', () => {
    expect(zone(98).detail.thresholdPct).toBe(-1.5);
    expect(zone(103).detail.thresholdPct).toBe(2.5);
  });
});

describe('청산 엔진 evaluateExit 와 같은 판정(첫 일치 우선순위 포함)', () => {
  const KIND_TO_ZONE: Record<string, string> = { eod_loss_cut: 'eod_cut', hard_stop: 'hard_stop', target_profit: 'take_profit', trailing_stop: 'trailing_active' };
  const style = { ...D } as StyleConfig;
  const cases: { price: number; entry: number; peak: number; market: 'domestic' | 'overseas'; now: Date; sc?: any }[] = [];
  for (const price of [97, 98.5, 98.51, 99.9, 100, 101, 102.49, 102.5, 104]) {
    for (const peak of [100, 102.4, 102.6, 105]) {
      for (const now of [NOON, EOD]) for (const market of ['domestic', 'overseas'] as const) cases.push({ price, entry: 100, peak: Math.max(peak, price), market, now });
    }
  }
  // 시나리오 청산값(stopHi·stopLo·targetHi·targetLo)
  for (const price of [96, 97.9, 98.6, 101.6, 103.1]) cases.push({ price, entry: 100, peak: 103.2, market: 'domestic', now: NOON, sc: { targetLo: 1.5, targetHi: 3, stopLo: 1.2, stopHi: 2 } });

  it.each(cases)('%o', (c) => {
    const sig = evaluateExit({
      symbol: c.market === 'domestic' ? '005930' : 'NAS:AAPL', market: c.market,
      ticker: { symbol: 'x', price: c.price } as any,
      state: { symbol: 'x', market: c.market, entryPrice: c.entry, peakPrice: c.peak, qty: 1, scenarioExit: c.sc ?? null, holdingDeadline: null, firstSeenAt: new Date(), updatedAt: new Date() },
      style, now: c.now,
    });
    const z = zone(c.price, c.entry, c.peak, { market: c.market, now: c.now, sc: c.sc });
    if (sig) {
      // 엔진이 발화하는 조건이면 같은 종류의 구간이어야 한다(트레일링은 「활성」 구간 안에서 되돌림 충족)
      expect(z.zone).toBe(KIND_TO_ZONE[sig.exitKind]);
    } else {
      // 발화하지 않으면 손절·익절·장마감 구간이 아니다(트레일링 활성은 되돌림 미충족이면 발화 없이 활성일 수 있다)
      expect(['neutral', 'trailing_active']).toContain(z.zone);
    }
  });
});

describe('심볼 → 시장 패턴 = kis-symbols 와 같다', () => {
  it.each(['005930', '000660', 'NAS:AAPL', 'NYS:BRK.B', 'AMS:SPY', 'AAPL', '12345', 'nas:aapl', 'KRW', 'USD'])('%s', (s) => {
    const want = isOverseasSymbol(s) ? 'overseas' : isDomesticSymbol(s) ? 'domestic' : null;
    expect(marketOfSymbol(s)).toBe(want);
  });
});
