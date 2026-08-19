/**
 * 🔴 look-ahead bias 회귀 테스트 — 이 기능 전체의 신뢰도를 좌우한다 (T-032).
 *
 * 핵심 검증: **시점 t까지 동일하고 t+1부터 완전히 다른 두 시계열**을 넣었을 때
 * 시점 0..t 의 피처 출력이 한 자리도 다르지 않아야 한다.
 * 다르다면 "선행지표"라는 주장 자체가 성립하지 않는다(미래를 보고 계산한 값이므로).
 */
import {
  computePrecursorSeries,
  DEFAULT_PRECURSOR_FEATURE_CONFIG,
} from '../pattern/precursor-features';
import type { DailyCandle } from '../types';

/** 결정적 의사난수 — 테스트 재현성 확보 */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSeries(n: number, seed: number, startPrice = 100): DailyCandle[] {
  const rnd = mulberry32(seed);
  const out: DailyCandle[] = [];
  let price = startPrice;
  const base = Date.UTC(2020, 0, 1);
  for (let i = 0; i < n; i++) {
    const drift = (rnd() - 0.5) * 0.06;
    price = Math.max(1, price * (1 + drift));
    const high = price * (1 + rnd() * 0.02);
    const low = price * (1 - rnd() * 0.02);
    out.push({
      date: new Date(base + i * 86400000).toISOString().slice(0, 10),
      open: (high + low) / 2,
      high,
      low,
      close: price,
      volume: Math.round(100000 * (0.5 + rnd())),
    });
  }
  return out;
}

describe('computePrecursorSeries — look-ahead bias 차단 (최우선 회귀)', () => {
  test('시점 t까지 동일한 두 시계열은 0..t 피처가 완전히 동일하다', () => {
    const common = makeSeries(300, 1);
    const t = 200;

    // A: 원본 그대로 / B: t+1 부터 완전히 다른 흐름(폭등)으로 갈아끼움
    const seriesA = [...common];
    const divergent = makeSeries(99, 987, common[t].close * 3).map((c, i) => ({
      ...c,
      date: common[t + 1 + i].date,
    }));
    const seriesB = [...common.slice(0, t + 1), ...divergent];

    expect(seriesA.length).toBe(seriesB.length);
    // 전제 확인: t+1 부터는 실제로 달라야 의미 있는 테스트다
    expect(seriesB[t + 1].close).not.toBeCloseTo(seriesA[t + 1].close, 6);

    const featA = computePrecursorSeries(seriesA);
    const featB = computePrecursorSeries(seriesB);

    for (let i = 0; i <= t; i++) {
      expect(featB[i]).toEqual(featA[i]);
    }
  });

  test('여러 절단 지점에서도 성립한다 (t = 80, 150, 260)', () => {
    const common = makeSeries(320, 42);
    for (const t of [80, 150, 260]) {
      const tail = makeSeries(320 - t - 1, 777 + t, common[t].close * 0.2).map((c, i) => ({
        ...c,
        date: common[t + 1 + i].date,
      }));
      const mutated = [...common.slice(0, t + 1), ...tail];

      const featBase = computePrecursorSeries(common);
      const featMut = computePrecursorSeries(mutated);
      for (let i = 0; i <= t; i++) {
        expect(featMut[i]).toEqual(featBase[i]);
      }
    }
  });

  test('시계열을 t에서 잘라낸 것과 전체를 계산한 것의 0..t 구간이 동일하다', () => {
    // 위 테스트의 쌍대(dual) — "미래가 없을 때"도 같은 값이 나와야 한다.
    const full = makeSeries(400, 7);
    const t = 310;
    const truncated = full.slice(0, t + 1);

    const featFull = computePrecursorSeries(full);
    const featTrunc = computePrecursorSeries(truncated);

    expect(featTrunc.length).toBe(t + 1);
    for (let i = 0; i <= t; i++) {
      expect(featTrunc[i]).toEqual(featFull[i]);
    }
  });

  test('각 피처가 최소 한 번은 non-null 이다 (전부 null이면 위 검증이 공허해진다)', () => {
    const feats = computePrecursorSeries(makeSeries(300, 3));
    const nonNull = (k: keyof (typeof feats)[number]) =>
      feats.filter((f) => f[k] != null).length;
    expect(nonNull('rsi14')).toBeGreaterThan(0);
    expect(nonNull('atrPct')).toBeGreaterThan(0);
    expect(nonNull('bbPercentB')).toBeGreaterThan(0);
    expect(nonNull('drawdownPct')).toBeGreaterThan(0);
    expect(nonNull('volumeRatio')).toBeGreaterThan(0);
  });
});

describe('computePrecursorSeries — 기본 동작', () => {
  test('빈 입력은 빈 배열', () => {
    expect(computePrecursorSeries([])).toEqual([]);
  });

  test('출력 길이·인덱스·날짜가 입력과 1:1 대응', () => {
    const candles = makeSeries(50, 11);
    const feats = computePrecursorSeries(candles);
    expect(feats).toHaveLength(50);
    feats.forEach((f, i) => {
      expect(f.index).toBe(i);
      expect(f.date).toBe(candles[i].date);
    });
  });

  test('워밍업 구간(지표 계산 불가)은 null 이다', () => {
    const feats = computePrecursorSeries(makeSeries(60, 13));
    expect(feats[0].rsi14).toBeNull();
    expect(feats[0].atrPct).toBeNull();
    expect(feats[0].bbPercentB).toBeNull();
    expect(feats[0].volumeRatio).toBeNull();
    // RSI/ATR 은 period 인덱스부터 값이 생긴다
    expect(feats[DEFAULT_PRECURSOR_FEATURE_CONFIG.rsiPeriod].rsi14).not.toBeNull();
  });

  test('drawdownPct — 트레일링 최고 종가 대비 낙폭을 양수로 반환', () => {
    const dates = (i: number) => new Date(Date.UTC(2021, 0, 1) + i * 86400000).toISOString().slice(0, 10);
    const closes = [100, 110, 120, 90];
    const candles: DailyCandle[] = closes.map((c, i) => ({
      date: dates(i), open: c, high: c, low: c, close: c, volume: 1000,
    }));
    const feats = computePrecursorSeries(candles);
    expect(feats[0].drawdownPct).toBeCloseTo(0, 8);
    expect(feats[2].drawdownPct).toBeCloseTo(0, 8);
    expect(feats[3].drawdownPct).toBeCloseTo(25, 8); // (120-90)/120
  });

  test('drawdownPct 는 lookback 밖의 과거 고점을 잊는다 (트레일링)', () => {
    const dates = (i: number) => new Date(Date.UTC(2021, 0, 1) + i * 86400000).toISOString().slice(0, 10);
    const closes = [200, 100, 100, 100, 100];
    const candles: DailyCandle[] = closes.map((c, i) => ({
      date: dates(i), open: c, high: c, low: c, close: c, volume: 1000,
    }));
    const feats = computePrecursorSeries(candles, { drawdownLookbackDays: 3 });
    // index 4 의 트레일링 3봉은 [100,100,100] — 200은 구간 밖
    expect(feats[4].drawdownPct).toBeCloseTo(0, 8);
    // index 1 은 200을 아직 보고 있다
    expect(feats[1].drawdownPct).toBeCloseTo(50, 8);
  });
});
