/**
 * T-070 사후검증 계산 본체(scripts/profit-engine/postmortem-core.js) — 읽기 전용 가드·에피소드·체결 가정·환율 역산·H-A~H-G 판정·리포트.
 * 합성 시그널·합성 일봉만. 실제 DB 없음(질의 함수 대역).
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = require('../../../../scripts/profit-engine/postmortem-core.js');

type Bar = { tradeDate: string; open: number | null; high: number | null; low: number | null; close: number; flags: string[] };
const bar = (tradeDate: string, close: number, o: Partial<Bar> = {}): Bar => ({ tradeDate, open: close, high: close, low: close, close, flags: [], ...o });

/** 평일 일봉 n 개(from 부터), close 고정 */
function flat(from: string, n: number, close = 100): Bar[] {
  const out: Bar[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  while (out.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(bar(d.toISOString().slice(0, 10), close));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const sig = (extra: Record<string, unknown> = {}) => ({
  id: 1, symbol: '005930', market: 'KR', strategy: 'rsi-oversold-v1', status: 'expired', price: 100, amountKrw: 100000,
  createdAt: '2026-10-05 10:00:00', expiresAt: '2026-10-07 15:30:00', consumedOrderId: null, priceZone: null, ...extra,
});

describe('assertReadOnlySql — 읽기 전용 가드', () => {
  test.each(['SELECT 1', '  select * from signals', 'SHOW TABLES', 'SET SESSION TRANSACTION READ ONLY'])('허용: %s', (sql) => {
    expect(() => core.assertReadOnlySql(sql)).not.toThrow();
  });
  test.each([
    "INSERT INTO daily_bars VALUES (1)", 'UPDATE signals SET status=1', 'DELETE FROM orders', 'REPLACE INTO x VALUES (1)',
    'SELECT 1; SELECT 2', 'SELECT * FROM signals FOR UPDATE', "SELECT 1 INTO OUTFILE '/tmp/x'", 'SET autocommit=0', 'CALL p()',
  ])('거부: %s', (sql) => {
    expect(() => core.assertReadOnlySql(sql)).toThrow(/read-only guard/);
  });
  test('본체가 보내는 SQL 은 전부 가드를 통과한다(SELECT 만)', () => {
    for (const sql of Object.values(core.SQL) as string[]) {
      expect(() => core.assertReadOnlySql(sql)).not.toThrow();
      expect(sql).toMatch(/^SELECT /);
    }
  });
});

describe('날짜·에피소드', () => {
  test('KST 생성 시각 → 거래소 현지 날짜', () => {
    expect(core.localDateOf('2026-10-22 06:00:00', 'US')).toBe('2026-10-21');
    expect(core.localDateOf('2026-10-22 06:00:00', 'KR')).toBe('2026-10-22');
  });
  test('같은 종목 N일 안 반복 발화는 첫 발화에 묶는다(입력 순서 무관)', () => {
    const e = core.buildEpisodes([
      { id: 3, symbol: 'A', createdAt: '2026-10-09 10:00:00' },
      { id: 1, symbol: 'A', createdAt: '2026-10-01 10:00:00' },
      { id: 2, symbol: 'A', createdAt: '2026-10-05 09:59:59' },
      { id: 4, symbol: 'B', createdAt: '2026-10-02 10:00:00' },
    ], 5);
    expect(e.get(1)).toEqual({ episodeId: 1, isStart: true });
    expect(e.get(2)).toEqual({ episodeId: 1, isStart: false });
    expect(e.get(3)).toEqual({ episodeId: 3, isStart: true });   // 첫 발화로부터 8일 → 새 에피소드
    expect(e.get(4)).toEqual({ episodeId: 4, isStart: true });
  });
  test('스냅샷 positions 에서 현금·환율', () => {
    expect(core.cashFromPositions(JSON.stringify([
      { currency: 'KRW', qty: 80000, price: 1, value_krw: 80000 },
      { currency: 'USD', qty: 10, price: 1400, value_krw: 14000 },
      { currency: '005930', qty: 1, price: 60000, value_krw: 60000 },
    ]))).toEqual({ krw: 80000, usdValueKrw: 14000, fx: 1400 });
    expect(core.cashFromPositions('not json')).toEqual({ krw: null, usdValueKrw: null, fx: null });
  });
});

describe('evaluateSignal — 체결 가정·수익·MAE', () => {
  const bars = (): Bar[] => {
    const b = flat('2026-07-01', 80, 100);           // 2026-07-01 ~ 10-20 근처, D0(10-05) 앞에 60봉 이상
    const i0 = b.findIndex((x) => x.tradeDate === '2026-10-05');
    b[i0 + 1] = bar(b[i0 + 1].tradeDate, 101, { open: 99, low: 98, high: 102 });   // D+1: 시가 99 로 체결
    b[i0 + 2] = bar(b[i0 + 2].tradeDate, 103);
    return b;
  };

  test('기간 안 저가 ≤ 가격이면 체결, 체결가 = min(가격, 시가), 수익은 체결 봉부터', () => {
    const e = core.evaluateSignal(sig(), bars(), {});
    expect(e).toMatchObject({ state: 'ok', d0: '2026-10-05', unit: 'same', entry: 100, wouldFill: true, fillProxy: true, fillPrice: 99, windowBasis: 'window' });
    expect(e.windowBars).toBe(2);
    expect(e.gapD1).toBeCloseTo(-0.01, 10);
    expect(e.ret[1]).toBeCloseTo(101 / 99 - 1, 10);
    expect(e.ret[3]).toBeCloseTo(100 / 99 - 1, 10);
    expect(e.mae10).toBeCloseTo(98 / 99 - 1, 10);
    expect(e.structural).toBe(false);
    expect(e.aboveMa60).toBe(false);                // 종가 100 = MA60 100 → 위가 아님
  });

  test('당일 만료는 일봉으로 판정 불가(wouldFill=null) — D+1 프록시로만 센다', () => {
    const e = core.evaluateSignal(sig({ expiresAt: '2026-10-05 15:30:00' }), bars(), {});
    expect(e.wouldFill).toBeNull();
    expect(e.windowBasis).toBe('d1_proxy');
    expect(e.fillProxy).toBe(true);
  });

  test('가격 위로 2% 넘게 떠 있다가 끝 종가도 높으면 ranUp(올라서 못 삼)', () => {
    const b = flat('2026-07-01', 80, 100);
    const i0 = b.findIndex((x) => x.tradeDate === '2026-10-05');
    b[i0 + 1] = bar(b[i0 + 1].tradeDate, 104, { low: 103, open: 103.5, high: 105 });
    b[i0 + 2] = bar(b[i0 + 2].tradeDate, 106, { low: 104 });
    const e = core.evaluateSignal(sig(), b, {});
    expect(e.wouldFill).toBe(false);
    expect(e.missBy).toBeCloseTo(0.03, 10);
    expect(e.ranUp).toBe(true);
    expect(e.ret).toBeUndefined();
  });

  test('미국 + 원화 가격: 환율 추정치로 USD 진입가를 되돌리고, 없으면 자기 비율(= D0 종가)', () => {
    const b = flat('2026-07-01', 80, 200).map((x) => ({ ...x, tradeDate: x.tradeDate }));
    const s = sig({ symbol: 'NAS:MU', market: 'US', price: 200 * 1400 * 0.99, amountKrw: 100000, createdAt: '2026-10-06 02:00:00' });
    const withFx = core.evaluateSignal(s, b, { fxForSignal: () => ({ fx: 1400, method: 'snapshot_usd_row' }) });
    expect(withFx).toMatchObject({ unit: 'krw', fxMethod: 'snapshot_usd_row', d0: '2026-10-05' });
    expect(withFx.entry).toBeCloseTo(198, 8);
    expect(withFx.priceKrw).toBeCloseTo(277200, 6);
    expect(withFx.structural).toBe(true);               // 10만원 < 1주 27.7만원
    const self = core.evaluateSignal(s, b, {});
    expect(self.fxMethod).toBe('signal_ratio_self');
    expect(self.entry).toBeCloseTo(200, 8);
  });

  test('단위를 알 수 없는 비율은 제외(unit_unknown)', () => {
    expect(core.evaluateSignal(sig({ price: 5000 }), flat('2026-07-01', 80, 100), {}).state).toBe('unit_unknown');
  });

  test('일봉 없음: 국내는 원 그대로, 미국은 600 이상이면 원화로 보고 H-G 를 계산', () => {
    expect(core.evaluateSignal(sig({ price: 150000 }), [], {})).toMatchObject({ state: 'no_bars', structural: true });
    expect(core.evaluateSignal(sig({ symbol: 'NAS:MU', market: 'US', price: 280000 }), [], {})).toMatchObject({ state: 'no_bars', unit: 'krw_guess', structural: true });
    expect(core.evaluateSignal(sig({ symbol: 'NAS:MU', market: 'US', price: 190 }), [], {}).structural).toBeNull();
  });

  test('(R-4d) 기업행위 의심 봉이 걸려도 통계에 포함하고 따로 집계한다', () => {
    const b = bars();
    const i0 = b.findIndex((x) => x.tradeDate === '2026-10-05');
    b[i0 + 3] = { ...b[i0 + 3], flags: ['corp_action_suspect'] };
    const e = { ...core.evaluateSignal(sig(), b, {}), isEpisodeStart: true };
    expect(e.corpTouched).toBe(true);
    expect(core.returnStats([e]).n).toBe(1);
    const sum = core.summarize([e], { days: 90, episodeDays: 5, orders: [] });
    expect(sum.corp.n).toBe(1);
    expect(sum.corp.touched.n).toBe(1);
    expect(sum.corp.withoutTouched.n).toBe(0);
    expect(core.renderReport(sum, core.judge(sum), core.rsiRecommendation(sum), { generatedDate: 'd', generatedAt: 't' }))
      .toContain('| 의심 봉 걸림 | 1 |');
  });

  test('(R-4g) D0~D+10 사이 9일 넘는 결측이 있으면 표시하고 수익 통계에서 뺀다', () => {
    const b = bars();
    const i0 = b.findIndex((x) => x.tradeDate === '2026-10-05');
    const holed = [...b.slice(0, i0 + 3), ...b.slice(i0 + 3).map((x) => ({ ...x, tradeDate: shift(x.tradeDate, 14) }))];
    const e = { ...core.evaluateSignal(sig(), holed, {}), isEpisodeStart: true };
    expect(e.barGap).toBe(true);
    expect(core.returnStats([e]).n).toBe(0);
    expect(core.summarize([e], { days: 90, episodeDays: 5, orders: [] }).barGapExcluded).toBe(1);
    expect(core.evaluateSignal(sig(), b, {}).barGap).toBe(false);
  });

  test('(R-4f) 장 마감 전에 만든 시그널은 전 거래일 종가로 추세를 잰다(미래 정보 차단)', () => {
    const b = flat('2026-07-01', 80, 100);
    const i0 = b.findIndex((x) => x.tradeDate === '2026-10-05');
    b[i0] = bar('2026-10-05', 130);                     // D0 종가만 급등 — 장중 시그널은 이걸 몰랐다
    const intraday = core.evaluateSignal(sig({ price: 130, createdAt: '2026-10-05 10:00:00' }), b, {});
    expect(intraday).toMatchObject({ trendBasis: 'prev_close', aboveMa60: false });
    const afterClose = core.evaluateSignal(sig({ price: 130, createdAt: '2026-10-05 16:00:00' }), b, {});
    expect(afterClose).toMatchObject({ trendBasis: 'd0_close', aboveMa60: true });
  });

  test('(R-2d) 체결 경계: 저가 = 지정가면 체결, 지정가보다 조금이라도 높으면 미체결', () => {
    const at = (low: number) => {
      const b = flat('2026-07-01', 80, 100);
      const i0 = b.findIndex((x) => x.tradeDate === '2026-10-05');
      b[i0 + 1] = bar(b[i0 + 1].tradeDate, 101, { open: 101, low, high: 102 });
      b[i0 + 2] = bar(b[i0 + 2].tradeDate, 101, { open: 101, low: 100.5, high: 102 });
      return core.evaluateSignal(sig(), b, {});
    };
    expect(at(100)).toMatchObject({ wouldFill: true, fillPrice: 100 });
    expect(at(100.0001)).toMatchObject({ wouldFill: false });
  });
});

function shift(d: string, n: number): string {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

describe('(Codex C2 지적4) 환율 스냅샷은 시그널 시각 이하·72시간 안의 가장 최근 것만', () => {
  const H = 3_600_000;
  const T = Date.parse('2026-10-21T00:00:00Z');
  const snap = (dh: number, fx: number | null) => ({ t: T + dh * H, cash: { krw: null, usdValueKrw: null, fx } });
  test('창은 72시간', () => {
    expect(core.FX_SNAPSHOT_WINDOW_MS).toBe(72 * H);
  });
  test('과거 −20h 와 미래 +2h 가 있으면 과거를 고른다', () => {
    expect(core.snapshotFxNear([snap(-20, 1400), snap(2, 1450)], T, core.FX_SNAPSHOT_WINDOW_MS)).toBe(1400);
  });
  test('미래 스냅샷만 있으면 null', () => {
    expect(core.snapshotFxNear([snap(1, 1450), snap(5, 1460)], T, core.FX_SNAPSHOT_WINDOW_MS)).toBeNull();
  });
  test('과거가 창(72h) 밖이면 null, 창 경계 안이면 선택', () => {
    expect(core.snapshotFxNear([snap(-73, 1400)], T, core.FX_SNAPSHOT_WINDOW_MS)).toBeNull();
    expect(core.snapshotFxNear([snap(-72, 1400)], T, core.FX_SNAPSHOT_WINDOW_MS)).toBe(1400);
    expect(core.snapshotFxNear([snap(-30, 1400)], T, core.FX_SNAPSHOT_WINDOW_MS)).toBe(1400);   // 24h 창이면 놓쳤을 값
  });
  test('시각이 정확히 같으면 선택', () => {
    expect(core.snapshotFxNear([snap(-5, 1390), snap(0, 1400), snap(3, 1450)], T, core.FX_SNAPSHOT_WINDOW_MS)).toBe(1400);
  });
  test('환율 없는 스냅샷은 건너뛰고 더 오래된 것을 고른다', () => {
    expect(core.snapshotFxNear([snap(-30, 1380), snap(-10, null), snap(-1, null), snap(1, 1450)], T, core.FX_SNAPSHOT_WINDOW_MS)).toBe(1380);
  });

  test('시그널 뒤 스냅샷만 있으면 방법 1 이 0건이 되고 2·3차 비중이 늘어 미국 가격 판정 태그가 내려간다', async () => {
    const usBars = flat('2026-07-01', 80, 200);
    const mkQ = (snapTs: string) => async (sql: string, params: unknown[]) => {
      core.assertReadOnlySql(sql);
      if (sql === core.SQL.tables) return (params[0] as string[]).map((t) => ({ t }));
      if (sql === core.SQL.signals) {
        return [1, 2, 3].map((id) => ({
          id, strategy_id: 'x', symbol: `NAS:A${id}`, price: '280000', amount_krw: '100000', status: 'expired',
          created_at: '2026-10-06 02:00:00', expires_at: null, consumed_order_id: null, price_zone: null,
        }));
      }
      if (sql === core.SQL.bars) {
        return (params[0] as string[]).flatMap((sym) => usBars.map((b) => ({ market: 'US', symbol: sym, d: b.tradeDate, open: '200', high: '200', low: '200', close: '200', flags: null })));
      }
      if (sql === core.SQL.snapshots) return [{ ts: snapTs, positions: [{ currency: 'USD', qty: 10, price: 1400, value_krw: 14000 }] }];
      if (sql === core.SQL.orders) return [];
      throw new Error(sql);
    };
    const now = new Date('2026-10-22T12:00:00Z');
    const past = await core.runPostmortem(mkQ('2026-10-05 20:00:00'), { days: 90, episodeDays: 5, now });   // 시그널 6h 전
    const future = await core.runPostmortem(mkQ('2026-10-06 04:00:00'), { days: 90, episodeDays: 5, now }); // 시그널 2h 뒤
    expect(past.sum.fxMethods.snapshot_usd_row).toBe(3);
    expect(past.sum.fx.weakShare).toBe(0);
    expect(future.sum.fxMethods.snapshot_usd_row).toBeUndefined();
    expect(future.sum.fx.weakShare).toBe(1);
    // 같은 표본 크기(합성)로 H-C 판정을 내면 미래 스냅샷 쪽만 [추측] 으로 내려간다
    const big = { judgeable: 300, unfilled: 150, ranUp: 100, missBuckets: {} };
    const tagOf = (sum: Record<string, unknown>) => core.judge({ ...sum, hc: big }).rows.find((r: { id: string }) => r.id === 'H-C').tag;
    expect(tagOf(past.sum)).toBe('[가능성 높음]');
    expect(tagOf(future.sum)).toBe('[추측]');
  });
});

describe('비용 상수·군집 구간', () => {
  test('(R-2c) 비용은 T-064 §6.4 값 그대로: 미국 왕복 0.65%·손절 0.75%, 국내 0.33%·0.43%', () => {
    expect(core.COSTS).toEqual({ US: { roundTrip: 0.0065, stop: 0.0075 }, KR: { roundTrip: 0.0033, stop: 0.0043 } });
  });
  test('(R-2c) 순수익·손절 가정은 시장별 비용을 뺀다', () => {
    const mk = (market: string, id: number) => ({ id, market, state: 'ok', fillProxy: true, ret: { 1: 0.01, 3: 0.01, 5: 0.01, 10: 0.01 }, week: 'w' + id });
    const us = core.returnStats([mk('US', 1), mk('US', 2)]);
    expect(us.byH[5].net.mean).toBeCloseTo(0.01 - 0.0065, 12);
    expect(us.byH[5].stressMean).toBeCloseTo(0.01 - 0.0075, 12);
    const kr = core.returnStats([mk('KR', 1), mk('KR', 2)]);
    expect(kr.byH[5].net.mean).toBeCloseTo(0.01 - 0.0033, 12);
    expect(kr.byH[5].stressMean).toBeCloseTo(0.01 - 0.0043, 12);
  });
  test('(T-1) returnStats 의 순수익 구간은 군집 구간이다(독립 구간이 아니다)', () => {
    const vals = [0.05, 0.051, 0.049, 0.05, -0.03, -0.031, -0.029, -0.03, 0.01, 0.011, 0.009, 0.01];
    const weeks = ['2026-09-07', '2026-09-07', '2026-09-07', '2026-09-07', '2026-09-14', '2026-09-14', '2026-09-14', '2026-09-14',
      '2026-09-21', '2026-09-21', '2026-09-21', '2026-09-21'];
    const ev = vals.map((v, i) => ({ id: i + 1, market: 'KR', state: 'ok', fillProxy: true, week: weeks[i], ret: { 1: v, 3: v, 5: v, 10: v } }));
    const st = core.returnStats(ev);
    const net = vals.map((v) => v - 0.0033);
    const c = core.clusterCi95(net, weeks);
    expect(st.byH[5].net.lo).toBeCloseTo(c.lo, 12);
    expect(st.byH[5].net.hi).toBeCloseTo(c.hi, 12);
    expect(st.byH[5].net.clusters).toBe(3);
    expect(st.byH[5].net.hi - st.byH[5].net.lo).toBeGreaterThan(st.byH[5].netIid.hi - st.byH[5].netIid.lo);
    expect(st.clusters).toBe(3);
  });
  test('(R-4r) t 분포 임계값(자유도 = 군집 수 − 1)', () => {
    expect(core.tCrit95(1)).toBe(12.706);
    expect(core.tCrit95(12)).toBe(2.179);
    expect(core.tCrit95(45)).toBe(2.0);
    expect(core.tCrit95(500)).toBe(1.96);
    const c = core.clusterCi95([1, 1, -1, -1], ['A', 'A', 'B', 'B']);   // 군집 2 → df 1
    const se = Math.sqrt(2 * (2 * 2 + 2 * 2)) / 4;
    expect(c.hi).toBeCloseTo(12.706 * se, 10);
  });
  test('(R-4a) 같은 주에 몰린 표본은 독립 가정보다 구간이 넓다, 군집 1개면 구간 없음', () => {
    const xs = [0.02, 0.021, 0.019, 0.02, -0.02, -0.021, -0.019, -0.02];
    const c = core.clusterCi95(xs, ['A', 'A', 'A', 'A', 'B', 'B', 'B', 'B']);
    const iid = core.ci95(xs);
    expect(c.clusters).toBe(2);
    expect(c.hi - c.lo).toBeGreaterThan(iid.hi - iid.lo);
    expect(core.clusterCi95([1, 2, 3], ['A', 'A', 'A'])).toMatchObject({ n: 3, clusters: 1, lo: null, hi: null });
    expect(core.weekKey('2026-10-08')).toBe('2026-10-05');
    expect(core.weekKey('2026-10-05')).toBe('2026-10-05');
  });
});

describe('요약·판정', () => {
  function evalsFor(n: number, mk: (i: number) => Record<string, unknown>) {
    return Array.from({ length: n }, (_, i) => ({
      id: i + 1, market: 'KR', strategy: 'rsi-oversold-v1', status: 'expired', amountKrw: 100000, state: 'ok',
      isEpisodeStart: true, structural: false, cashAvailable: null, wouldFill: false, fillProxy: false, missBy: 0.03, ranUp: true,
      corpTouched: false, consumedOrderId: null, priceBand: '<50k', ...mk(i),
    }));
  }

  test('H-B: 기간 내 매수 주문 0건이면 "해당 없음", H-G: 30% 면 주요 원인, H-C: 미체결이 대부분 ranUp 이면 지배적 후보', () => {
    const ev = evalsFor(40, (i) => ({ structural: i < 12 }));
    const sum = core.summarize(ev, { days: 90, episodeDays: 5, orders: [], barsAvailable: true, excludedStaleRows: 0 });
    const v = core.judge(sum);
    const row = (id: string) => v.rows.find((r: { id: string }) => r.id === id);
    expect(row('H-B').verdict).toMatch(/해당 없음/);
    expect(row('H-E').tag).toBe('[추측]');
    expect(row('H-E').evidence).toMatch(/상한/);
    expect(row('H-G')).toMatchObject({ verdict: '주요 원인', tag: '[확실]' });
    expect(row('H-C').verdict).toBe('지배적 후보');
    expect(row('H-A').verdict).toMatch(/판정 불가/);
    expect(row('H-F').verdict).toMatch(/범위 밖/);
    expect(v.dominant).toEqual(['H-C', 'H-G']);
    expect(v.rows.map((r: { id: string }) => r.id)).toEqual(['H-A', 'H-B', 'H-C', 'H-D', 'H-E', 'H-F', 'H-G']);
  });

  test('H-E: 만료 중 가격 도달 비율, H-A: 현금 부족 비율', () => {
    const ev = evalsFor(30, (i) => ({ wouldFill: i < 20, ranUp: false, missBy: i < 20 ? 0 : 0.01, cashAvailable: i < 25 ? 50000 : 500000 }));
    const sum = core.summarize(ev, { days: 90, episodeDays: 5, orders: [{ status: 'rejected', n: 3 }, { status: 'filled', n: 1 }], barsAvailable: true });
    const v = core.judge(sum);
    const row = (id: string) => v.rows.find((r: { id: string }) => r.id === id);
    expect(sum.he).toMatchObject({ expired: 30, reachedButExpired: 20, notReached: 10 });
    expect(row('H-E').verdict).toBe('지배적 후보');
    expect(row('H-A').verdict).toBe('지배적 후보');
    expect(row('H-B').evidence).toMatch(/매수 주문 4건, 거부·실패·차단 3건/);
  });

  test('(R-4e) H-G 판정은 에피소드 단위, 원시 단위를 함께 적는다', () => {
    const ev = evalsFor(40, (i) => ({ structural: i < 20, isEpisodeStart: i % 2 === 0 }));   // 원시 50%, 에피소드 10/20=50%
    ev.forEach((e, i) => { if (i < 20 && i % 2 === 0) e.structural = i < 4; });                  // 에피소드 2/20=10%
    const sum = core.summarize(ev, { days: 90, episodeDays: 5, orders: [] });
    const g = core.judge(sum).rows.find((r: { id: string }) => r.id === 'H-G');
    expect(g.verdict).toBe('부분 원인');
    expect(g.evidence).toMatch(/에피소드 2\/20\(10\.0%\) · 원시 시그널 12\/40\(30\.0%\)/);
  });

  test('(R-4c) 미국 환율 역산 2·3차 비중이 절반을 넘으면 미국 가격 판정을 [추측]으로', () => {
    const ev = evalsFor(120, (i) => ({ market: 'US', fxMethod: i < 100 ? 'signal_ratio_self' : 'snapshot_usd_row' }));
    const sum = core.summarize(ev, { days: 90, episodeDays: 5, orders: [] });
    expect(sum.fx).toMatchObject({ total: 120, weak: 100 });
    const hc = core.judge(sum).rows.find((r: { id: string }) => r.id === 'H-C');
    expect(hc.tag).toBe('[추측]');
    expect(hc.evidence).toMatch(/미국 환율 역산 2·3차 83%/);
    const strong = core.summarize(evalsFor(120, () => ({ market: 'US', fxMethod: 'snapshot_usd_row' })), { days: 90, episodeDays: 5, orders: [] });
    expect(core.judge(strong).rows.find((r: { id: string }) => r.id === 'H-C').tag).toBe('[가능성 높음]');
  });

  test('(R-4r) 서로 다른 주가 8 미만이면 수익이 음수여도 보류, 문장에 군집 수·기업행위 걸림 수', () => {
    const ev = evalsFor(60, (i) => ({
      wouldFill: true, fillProxy: true, ranUp: false, missBy: 0, mae10: -0.05, week: `w${i % 5}`, corpTouched: i < 3,
      ret: { 1: -0.01, 3: -0.02, 5: -0.03 + (i % 3) * 0.001, 10: -0.04 },
    }));
    const rec = core.rsiRecommendation(core.summarize(ev, { days: 90, episodeDays: 5, orders: [] }));
    expect(rec.verdict).toBe('보류(서로 다른 주 부족)');
    expect(rec.reason).toMatch(/서로 다른 주 5개\(< 8\)/);
    expect(rec.reason).toMatch(/기업행위 의심 걸림 3건 포함/);
    expect(rec.tag).toBe('[추측]');
  });

  test('(R-4r) H-G 에 미국 가격 추정분이 섞이면 [확실] 이 아니라 [가능성 높음]', () => {
    const ev = evalsFor(20, (i) => ({ structural: i < 6, priceKrwEstimated: i === 0 }));
    const g = core.judge(core.summarize(ev, { days: 90, episodeDays: 5, orders: [] })).rows.find((r: { id: string }) => r.id === 'H-G');
    expect(g.tag).toBe('[가능성 높음]');
    expect(g.evidence).toMatch(/미국 가격 단위·환율 추정 1건 포함/);
    expect(core.evaluateSignal(sig({ symbol: 'NAS:MU', market: 'US', price: 280000 }), [], {}).priceKrwEstimated).toBe(true);
  });

  test('rsi-oversold 권고: 표본 부족이면 보류, 비용 후 D+5 가 전 구간 음수면 비활성', () => {
    const few = core.summarize(evalsFor(5, () => ({})), { days: 90, episodeDays: 5, orders: [] });
    expect(core.rsiRecommendation(few).verdict).toBe('보류(표본 부족)');
    const losing = evalsFor(60, (i) => ({
      wouldFill: true, fillProxy: true, ranUp: false, missBy: 0, mae10: -0.05,
      ret: { 1: -0.01, 3: -0.02, 5: -0.03 + (i % 3) * 0.001, 10: -0.04 },
    }));
    const sum = core.summarize(losing, { days: 90, episodeDays: 5, orders: [] });
    const rec = core.rsiRecommendation(sum);
    expect(rec.verdict).toBe('비활성 권고');
    expect(rec.reason).toMatch(/분석가\(Fable\) 검토 전에는 이 권고를 rsi-oversold 비활성 결정의 근거로 쓰지 말 것/);
    expect(rec.reason).toMatch(/주 군집 60개/);
    expect(sum.rsi.byH[5].net.mean).toBeCloseTo(-0.03 + 0.001 - 0.0033, 6);
  });
});

describe('runPostmortem — 주입한 질의 함수로 끝까지', () => {
  const kstBars = flat('2026-06-01', 120, 100);
  function fakeQ(opts: { noBars?: boolean } = {}) {
    const sent: string[] = [];
    const q = async (sql: string, params: unknown[]) => {
      core.assertReadOnlySql(sql);
      sent.push(sql);
      if (sql === core.SQL.tables) return (params[0] as string[]).filter((t) => !(opts.noBars && t === 'daily_bars')).map((t) => ({ t }));
      if (sql === core.SQL.signals) {
        expect(params).toEqual([90]);
        return [
          { id: 1, strategy_id: 'rsi-oversold-v1', symbol: '005930', price: '100.00000000', amount_krw: '100000.00', status: 'expired',
            created_at: '2026-10-05 10:00:00', expires_at: '2026-10-07 15:30:00', consumed_order_id: null, price_zone: '99~101' },
          { id: 2, strategy_id: 'rsi-oversold-v1', symbol: '005930', price: '100', amount_krw: '100000', status: 'expired',
            created_at: '2026-10-06 10:00:00', expires_at: null, consumed_order_id: null, price_zone: null },
          { id: 3, strategy_id: 'x', symbol: 'NAS:MU', price: '280000', amount_krw: '100000', status: 'skipped',
            created_at: '2026-10-06 02:00:00', expires_at: null, consumed_order_id: null, price_zone: null },
          { id: 4, strategy_id: 'x', symbol: 'BAD SYMBOL', price: '1', amount_krw: '1', status: 'expired',
            created_at: '2026-10-06 02:00:00', expires_at: null, consumed_order_id: null, price_zone: null },
        ];
      }
      if (sql === core.SQL.bars) {
        expect(params[0]).toEqual(['005930', 'NAS:MU']);
        return [
          ...kstBars.map((b) => ({ market: 'KR', symbol: '005930', d: b.tradeDate, open: '100', high: '100', low: '100', close: '100.0000', flags: null })),
          { market: 'KR', symbol: '005930', d: '2026-05-29', open: '1', high: '1', low: '1', close: '1', flags: 'adj_stale' },
        ];
      }
      if (sql === core.SQL.snapshots) return [{ ts: '2026-10-05 09:00:00', positions: [{ currency: 'KRW', qty: 50000, price: 1, value_krw: 50000 }] }];
      if (sql === core.SQL.orders) return [];
      throw new Error(`unexpected ${sql}`);
    };
    return { q, sent };
  }

  test('SELECT 만 보내고 리포트를 만든다(H-A~H-G 표, 에피소드, stale 제외)', async () => {
    const { q, sent } = fakeQ();
    const r = await core.runPostmortem(q, { days: 90, episodeDays: 5, now: new Date('2026-10-22T12:00:00Z') });
    expect(sent.every((s) => s.startsWith('SELECT '))).toBe(true);
    expect(r.sum.totals).toEqual({ raw: 3, episodes: 2 });
    expect(r.sum.meta.excludedStaleRows).toBe(1);
    expect(r.sum.ha).toMatchObject({ covered: 1, short: 1 });          // 10-05 09:00 스냅샷 현금 5만 < 10만
    expect(r.md).toMatch(/^---\ntask_id: T-070/);
    expect(r.md).toContain('# T-070 과거 시그널 사후검증 — 2026-10-22');
    for (const id of ['H-A', 'H-B', 'H-C', 'H-D', 'H-E', 'H-F', 'H-G']) expect(r.md).toContain(`| ${id} |`);
    expect(r.md).toContain('`rsi-oversold` 권고:');
    expect(r.md).toContain('**수익·구간은 독립 표본이 아니다.**');
    expect(r.md).toContain('체결 가능성의 상한');
    expect(r.md).toContain('| 환율 역산 방법(미국 원화 가격 에피소드) | 건수 | 비율 |');
    expect(r.md).toContain('분석가(Fable) 검토 전에는');
    expect(r.evals.find((e: { id: number }) => e.id === 3)).toMatchObject({ state: 'no_bars', unit: 'krw_guess', structural: true });
  });

  test('daily_bars 가 없어도 H-G·H-A 는 내고 일봉 없음 경고를 남긴다', async () => {
    const { q, sent } = fakeQ({ noBars: true });
    const r = await core.runPostmortem(q, { days: 90, episodeDays: 5, now: new Date('2026-10-22T12:00:00Z') });
    expect(sent).not.toContain(core.SQL.bars);
    expect(r.md).toContain('`daily_bars` 테이블이 없거나 비어 있어');
    expect(r.sum.hg.all.known).toBe(3);
  });
});
