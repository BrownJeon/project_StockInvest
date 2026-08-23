/**
 * 리포트 조립 — 이력 부족 구분, 실패 흡수, LLM 미사용 검증 (T-032).
 */
import { buildResearchReport, kstDateString, SHORT_HISTORY_MIN_DAYS } from '../research-report';
import { computePrecursorSeries } from '../pattern/precursor-features';
import { getActiveRuleIds } from '../pattern/precursor-analysis';
import { TARGET_HORIZON_DAYS } from '../pattern/price-targets';
import type { DailyCandle } from '../types';

/** 하락 → 급등 → 재하락 사이클을 `cycles`번 반복하는 결정적 시계열 */
function cyclicSeries(cycles: number): DailyCandle[] {
  const closes: number[] = [];
  for (let c = 0; c < cycles; c++) {
    for (let i = 0; i < 70; i++) closes.push(100 - i * 0.5);          // 완만한 하락 70일
    for (let i = 0; i < 8; i++) closes.push(65 + i * 3);              // 급등 8일 (+~35%)
    for (let i = 0; i < 22; i++) closes.push(89 - i * 1.2);           // 재하락 22일
  }
  return closes.map((v, i) => ({
    date: new Date(Date.UTC(2018, 0, 1) + i * 86400000).toISOString().slice(0, 10),
    open: v, high: v, low: v, close: v, volume: 1000 + (i % 7) * 100,
  }));
}

function loaderFor(candles: DailyCandle[]) {
  return { history: { loader: async () => candles } };
}

describe('kstDateString', () => {
  test('서버 TZ와 무관하게 KST 날짜를 만든다', () => {
    // 2026-08-19 00:30 KST == 2026-08-18 15:30 UTC
    expect(kstDateString(new Date('2026-08-18T15:30:00Z'))).toBe('2026-08-19');
    expect(kstDateString(new Date('2026-08-18T14:00:00Z'))).toBe('2026-08-18');
  });
});

describe('buildResearchReport', () => {
  test('사이클이 반복되는 시계열에서 이벤트·평균치·선행지표 분석을 채운다', async () => {
    const candles = cyclicSeries(7); // 700봉
    const r = await buildResearchReport('NAS:MU', { runDate: '2026-08-19', ...loaderFor(candles) });

    expect(r.error).toBeNull();
    expect(r.symbol).toBe('NAS:MU');
    expect(r.market).toBe('overseas');
    expect(r.runDate).toBe('2026-08-19');
    expect(r.dataRangeFrom).toBe(candles[0].date);
    expect(r.dataRangeTo).toBe(candles[candles.length - 1].date);
    expect(r.eventCount).toBeGreaterThan(0);
    expect(r.avgRallyPct).not.toBeNull();
    expect(r.avgDaysToRally).not.toBeNull();
    expect(r.precursorAnalysis).not.toBeNull();
    expect(r.precursorAnalysis!.positiveDays).toBeGreaterThan(0);
    expect(r.dataWarnings).not.toContain('short_history');
  });

  test('🔴 이력이 짧으면 "패턴 없음"이 아니라 short_history 로 구분해 보고한다', async () => {
    const candles = cyclicSeries(3); // 300봉 < 500
    const r = await buildResearchReport('NAS:SNDK', { runDate: '2026-08-19', ...loaderFor(candles) });
    expect(candles.length).toBeLessThan(SHORT_HISTORY_MIN_DAYS);
    expect(r.dataWarnings).toContain('short_history');
    expect(r.error).toBeNull();
  });

  test('이벤트가 없으면 no_events + insufficient_for_precursors', async () => {
    const flat: DailyCandle[] = Array.from({ length: 200 }, (_, i) => ({
      date: new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10),
      open: 100, high: 100, low: 100, close: 100, volume: 1000,
    }));
    const r = await buildResearchReport('005930', { runDate: '2026-08-19', ...loaderFor(flat) });
    expect(r.eventCount).toBe(0);
    expect(r.dataWarnings).toContain('no_events');
    expect(r.dataWarnings).toContain('insufficient_for_precursors');
    expect(r.precursorAnalysis).toBeNull();
  });

  test('조회 실패는 던지지 않고 error 필드에 담아 반환한다 (cron 이 멈추지 않게)', async () => {
    const r = await buildResearchReport('NAS:MU', {
      runDate: '2026-08-19',
      history: { loader: async () => { throw new Error('yahoo down'); } },
    });
    expect(r.error).toMatch(/yahoo down/);
    expect(r.market).toBe('overseas');
    expect(r.eventCount).toBe(0);
    expect(r.events).toEqual([]);
  });

  test('잘못된 심볼도 error 리포트로 흡수한다', async () => {
    const r = await buildResearchReport('bogus symbol', { runDate: '2026-08-19' });
    expect(r.error).toMatch(/invalid research symbol/);
    expect(r.market).toBe('domestic');
  });

  test('국내 심볼은 domestic 으로 판별한다 (stock_meta 조회 없이)', async () => {
    const r = await buildResearchReport('005930', {
      runDate: '2026-08-19',
      ...loaderFor(cyclicSeries(6)),
    });
    expect(r.market).toBe('domestic');
  });

  test('runDate 미지정 시 KST 오늘로 채운다', async () => {
    const r = await buildResearchReport('005930', loaderFor(cyclicSeries(6)));
    expect(r.runDate).toBe(kstDateString());
  });
});

// ─── T-033 — todayActiveRuleIds ─────────────────────────────────────────────

describe('buildResearchReport — todayActiveRuleIds (T-033)', () => {
  test('마지막 캔들(= dataRangeTo)의 활성 규칙을 계산해 리포트에 싣는다', async () => {
    const candles = cyclicSeries(7);
    const r = await buildResearchReport('NAS:MU', { runDate: '2026-08-19', ...loaderFor(candles) });

    expect(Array.isArray(r.todayActiveRuleIds)).toBe(true);
    // 마지막 캔들의 피처로 직접 계산한 값과 일치해야 한다(기준일이 어긋나지 않았다는 증거)
    const feats = computePrecursorSeries(candles);
    expect(r.todayActiveRuleIds).toEqual(getActiveRuleIds(feats[feats.length - 1]));
  });

  test('🔴 기준일이 dataRangeTo 와 같은 행이다 — 캔들을 하루 더 붙이면 값이 그 날 기준으로 바뀐다', async () => {
    const candles = cyclicSeries(7);
    const shorter = candles.slice(0, candles.length - 1);

    const a = await buildResearchReport('NAS:MU', { runDate: '2026-08-19', ...loaderFor(shorter) });
    const b = await buildResearchReport('NAS:MU', { runDate: '2026-08-19', ...loaderFor(candles) });

    expect(a.dataRangeTo).toBe(shorter[shorter.length - 1].date);
    expect(b.dataRangeTo).toBe(candles[candles.length - 1].date);
    const featsA = computePrecursorSeries(shorter);
    expect(a.todayActiveRuleIds).toEqual(getActiveRuleIds(featsA[featsA.length - 1]));
  });

  test('이벤트가 없어(precursorAnalysis=null) 도 활성 규칙은 계산된다', async () => {
    // 단조 상승 — trough 이벤트가 잡히지 않는다
    const flat: DailyCandle[] = Array.from({ length: 300 }, (_, i) => {
      const v = 100 + i * 0.2;
      return {
        date: new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10),
        open: v, high: v, low: v, close: v, volume: 1000,
      };
    });
    const r = await buildResearchReport('005930', { runDate: '2026-08-19', ...loaderFor(flat) });
    expect(r.precursorAnalysis).toBeNull();
    expect(r.dataWarnings).toContain('insufficient_for_precursors');
    // 결측(null)이 아니라 "충족 규칙 없음"([])으로 관측된다
    expect(r.todayActiveRuleIds).toEqual([]);
  });

  test('워밍업 구간만큼도 안 되는 짧은 시계열은 null(평가 못 함)', async () => {
    const tiny: DailyCandle[] = Array.from({ length: 3 }, (_, i) => ({
      date: `2026-08-1${i}`, open: 100, high: 100, low: 100, close: 100, volume: 10,
    }));
    const r = await buildResearchReport('005930', { runDate: '2026-08-19', ...loaderFor(tiny) });
    expect(r.todayActiveRuleIds).toBeNull();
  });

  test('조회 실패 리포트는 null', async () => {
    const r = await buildResearchReport('005930', {
      runDate: '2026-08-19',
      history: { loader: async () => { throw new Error('yahoo down'); } },
    });
    expect(r.error).toMatch(/yahoo down/);
    expect(r.todayActiveRuleIds).toBeNull();
    expect(r.priceTargets).toBeNull();
  });
});

// ─── T-034 — priceTargets ───────────────────────────────────────────────────

describe('buildResearchReport — priceTargets (T-034)', () => {
  test('차트 목표가를 계산해 리포트에 싣고, 기준일이 dataRangeTo 와 같다', async () => {
    const candles = cyclicSeries(7);
    const r = await buildResearchReport('NAS:MU', { runDate: '2026-08-19', ...loaderFor(candles) });

    expect(r.priceTargets).not.toBeNull();
    expect(r.priceTargets!.asOfDate).toBe(r.dataRangeTo);
    expect(r.priceTargets!.asOfPrice).toBe(candles[candles.length - 1].close);
    expect(r.priceTargets!.horizonDays).toBe(TARGET_HORIZON_DAYS);
  });

  test('🔴 통화는 시장에서 나온다 — 해외는 USD, 국내는 KRW (환산하지 않는다)', async () => {
    const candles = cyclicSeries(7);
    const overseas = await buildResearchReport('NAS:MU', { runDate: '2026-08-19', ...loaderFor(candles) });
    const domestic = await buildResearchReport('005930', { runDate: '2026-08-19', ...loaderFor(candles) });

    expect(overseas.market).toBe('overseas');
    expect(overseas.priceTargets!.currency).toBe('USD');
    expect(domestic.market).toBe('domestic');
    expect(domestic.priceTargets!.currency).toBe('KRW');
    // 같은 캔들이면 숫자는 동일 — 환율이 개입하지 않는다는 증거
    expect(overseas.priceTargets!.asOfPrice).toBe(domestic.priceTargets!.asOfPrice);
  });

  test('캔들이 모자라면 부분값이 아니라 null', async () => {
    const tiny: DailyCandle[] = Array.from({ length: 30 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10),
      open: 100, high: 101, low: 99, close: 100, volume: 10,
    }));
    const r = await buildResearchReport('005930', { runDate: '2026-08-19', ...loaderFor(tiny) });
    expect(r.priceTargets).toBeNull();
  });
});
