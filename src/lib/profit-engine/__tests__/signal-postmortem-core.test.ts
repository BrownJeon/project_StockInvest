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

// ── T-095(P1) 진입 모델·가격 없음·같은 날 유니버스 기준선·D+10 구간·자동 경고·v2 리포트 ─────────────────────
describe('(T-095) 일봉 진입 모델 — d1open·d0close', () => {
  /** D0(10-05) 뒤 봉마다 값이 달라 수익이 0 이 아닌 일봉 */
  const varied = (base = 100): Bar[] => {
    const b = flat('2026-07-01', 90, base);
    const i0 = b.findIndex((x) => x.tradeDate === '2026-10-05');
    for (let k = 1; k <= 12; k++) {
      const c = base * (1 + 0.01 * k);
      b[i0 + k] = bar(b[i0 + k].tradeDate, c, { open: c - base * 0.005, low: c - base * 0.02, high: c + base * 0.01 });
    }
    return b;
  };
  const usSig = (extra: Record<string, unknown> = {}) => sig({ symbol: 'NAS:MU', market: 'US', price: 200 * 1400 * 0.99, createdAt: '2026-10-06 02:00:00', ...extra });

  test('d1open: 진입 = D+1 시가, D+h = D0 봉 다음 h번째 봉 종가, MAE10 = D+1~D+10 최저가', () => {
    const b = varied();
    const i0 = b.findIndex((x) => x.tradeDate === '2026-10-05');
    const e = core.evaluateSignal(sig(), b, { entryModel: 'd1open' });
    expect(e).toMatchObject({ state: 'ok', entryModel: 'd1open', entryBasis: 'd1_open', entryPrice: b[i0 + 1].open, d0BarDate: '2026-10-05' });
    expect(e.ret[1]).toBeCloseTo(b[i0 + 1].close / b[i0 + 1].open! - 1, 12);   // D+1 = 진입 당일
    expect(e.ret[5]).toBeCloseTo(b[i0 + 5].close / b[i0 + 1].open! - 1, 12);
    expect(e.ret[10]).toBeCloseTo(b[i0 + 10].close / b[i0 + 1].open! - 1, 12);
    const minLow = Math.min(...b.slice(i0 + 1, i0 + 11).map((x) => x.low!));
    expect(e.mae10).toBeCloseTo(minLow / b[i0 + 1].open! - 1, 12);
    expect(e.fillPrice).toBeUndefined();                                         // legacy 체결가는 쓰지 않는다
  });

  test('d0close: 진입 = D0 종가, D0 가 거래일이 아니면 진입 불가(수익 통계 제외)', () => {
    const b = varied();
    const i0 = b.findIndex((x) => x.tradeDate === '2026-10-05');
    const e = core.evaluateSignal(sig(), b, { entryModel: 'd0close' });
    expect(e).toMatchObject({ state: 'ok', entryBasis: 'd0_close', entryPrice: b[i0].close });
    expect(e.ret[3]).toBeCloseTo(b[i0 + 3].close / b[i0].close - 1, 12);
    // 토요일(10-03) 생성: D0 봉은 금요일 — 그 종가는 시그널 전 가격이라 살 수 없었다
    const sat = core.evaluateSignal(sig({ createdAt: '2026-10-03 10:00:00' }), b, { entryModel: 'd0close' });
    expect(sat).toMatchObject({ state: 'ok', entryUnavailable: 'd0_not_trading_day' });
    expect(sat.ret).toBeUndefined();
    expect(core.returnStats([{ ...sat, isEpisodeStart: true }]).filled).toBe(0);
    // 장 마감 뒤 생성은 표시(이미 지난 종가로 사는 셈)
    expect(core.evaluateSignal(sig({ createdAt: '2026-10-05 16:00:00' }), b, { entryModel: 'd0close' }).entryAfterClose).toBe(true);
    expect(e.entryAfterClose).toBe(false);
  });

  test('(수용 2) d1open·d0close 의 미국 수익률은 환율과 무관하다 — 환율 입력을 바꿔도 수익·MAE·추세·통계가 그대로', () => {
    const b = varied(200);
    for (const model of ['d1open', 'd0close']) {
      const runs = [1300, 1400, 1550].map((fx) => core.evaluateSignal(usSig(), b, { entryModel: model, fxForSignal: () => ({ fx, method: 'snapshot_usd_row' }) }));
      runs.push(core.evaluateSignal(usSig(), b, { entryModel: model }));             // 환율 없음(자기 비율)
      runs.push(core.evaluateSignal(usSig({ price: 200 * 1100 }), b, { entryModel: model, fxForSignal: () => ({ fx: 1100, method: 'snapshot_usd_row' }) }));
      const pick = (e: Record<string, unknown>) => ({ ret: e.ret, mae10: e.mae10, entryPrice: e.entryPrice, aboveMa60: e.aboveMa60, ret20: e.ret20, d0BarDate: e.d0BarDate });
      for (const r of runs) expect(pick(r)).toEqual(pick(runs[0]));
      const stats = runs.map((r, i) => core.returnStats([{ ...r, id: i, isEpisodeStart: true }]).byH);
      for (const s of stats) expect(s[5].net.mean).toBeCloseTo(stats[0][5].net.mean, 15);
    }
    // 대조: legacy 는 환율에 따라 진입가(=지정가)가 바뀐다 — 그래서 v1 수치가 환율 역산에 묶여 있었다
    const l1 = core.evaluateSignal(usSig(), b, { fxForSignal: () => ({ fx: 1300, method: 'snapshot_usd_row' }) });
    const l2 = core.evaluateSignal(usSig(), b, { fxForSignal: () => ({ fx: 1400, method: 'snapshot_usd_row' }) });
    expect(l1.entry).not.toBeCloseTo(l2.entry, 6);
  });

  test('(수용 5) 가격 NULL: legacy 는 price_missing 으로 라벨만 바로잡고(통계 제외 그대로), d0close·d1open 은 평가한다', () => {
    const b = varied();
    const legacy = core.evaluateSignal(sig({ price: null, status: 'ai_skipped' }), b, {});
    expect(legacy).toMatchObject({ state: 'price_missing', priceStatus: 'price_missing', priceKrw: null, structural: null });
    expect(core.returnStats([{ ...legacy, isEpisodeStart: true }]).n).toBe(0);
    const i0 = b.findIndex((x) => x.tradeDate === '2026-10-05');
    const d0 = core.evaluateSignal(sig({ price: null, status: 'ai_skipped' }), b, { entryModel: 'd0close' });
    expect(d0).toMatchObject({ state: 'ok', priceStatus: 'price_missing', entryPrice: b[i0].close, wouldFill: null, fillProxy: false, fillD1: null, gapD1: null });
    expect(d0.ret[5]).toBeCloseTo(b[i0 + 5].close / b[i0].close - 1, 12);
    const st = core.returnStats([{ ...d0, isEpisodeStart: true }]);
    expect(st.filled).toBe(1);
    expect(st.fillRateD1).toBeNull();                    // 지정가 프록시 분모에서 가격 없음은 뺀다
    expect(core.evaluateSignal(sig({ price: null }), b, { entryModel: 'd1open' }).state).toBe('ok');
    // 진짜 단위 불명(가격은 있는데 비율이 어느 범위에도 안 맞음)은 모든 모델에서 unit_unknown 으로 남는다
    for (const model of [undefined, 'd1open', 'd0close']) {
      const e = core.evaluateSignal(sig({ price: 5000 }), b, model ? { entryModel: model } : {});
      expect(e.state).toBe('unit_unknown');
      expect(e.priceStatus).toBeUndefined();
    }
    // 요약: 가격 없음이 단위 불명과 따로 세어진다
    const sum = core.summarize([
      { ...core.evaluateSignal(sig({ id: 1, price: null, status: 'ai_skipped' }), b, { entryModel: 'd0close' }), isEpisodeStart: true },
      { ...core.evaluateSignal(sig({ id: 2, price: 5000 }), b, { entryModel: 'd0close' }), isEpisodeStart: true },
    ], { days: 90, episodeDays: 5, orders: [], entryModel: 'd0close' });
    expect(sum.priceMissing).toMatchObject({ episodes: 1, evaluated: 1, byStatus: { 'KR|ai_skipped': 1 } });
    expect(sum.states).toMatchObject({ ok: 1, unit_unknown: 1 });
  });

  test('잘못된 진입 모델은 거부', async () => {
    await expect(core.runPostmortem(async () => [], { days: 90, episodeDays: 5, now: new Date(), entryModel: 'd2open' })).rejects.toThrow(/entryModel/);
    await expect(core.runPostmortem(async () => [], { days: 90, episodeDays: 5, now: new Date(), asOf: '2026-10-24' })).rejects.toThrow(/asOf/);
  });
});

describe('(T-095) 같은 날 유니버스 기준선(날짜 일치)', () => {
  /** n 종목, 날짜별로 정해진 D0→D+h 수익을 갖는 일봉(시가=종가) */
  const universe = (n: number, retOn: Record<string, number>, market = 'KR') => Array.from({ length: n }, (_, s) => {
    const b = flat('2026-09-01', 40, 100);
    // 날짜 d 의 종가를 기준으로 다음 봉부터 (1+r) 로 한 번 뛰고 유지
    for (const [d, r] of Object.entries(retOn)) {
      const j = b.findIndex((x) => x.tradeDate === d);
      for (let k = j + 1; k < b.length; k++) b[k] = bar(b[k].tradeDate, b[k].close * (1 + r + s * 0.001));
    }
    return { market, bars: b };
  });

  test('d0close 기준선 = 같은 시장·같은 날짜 종목 평균(D0 종가 → D+h 종가), 날짜마다 다르다', () => {
    const u = universe(12, { '2026-09-15': 0.05 });
    const bl = core.universeBaselines(u, 'd0close');
    const on = bl.byKey.get('KR|2026-09-15');
    const meanR = Array.from({ length: 12 }, (_, s) => 0.05 + s * 0.001).reduce((a, x) => a + x, 0) / 12;
    expect(on[5].n).toBe(12);
    expect(on[5].mean).toBeCloseTo(meanR, 12);
    expect(bl.byKey.get('KR|2026-09-22')[5].mean).toBeCloseTo(0, 12);     // 다른 날짜는 점프가 없다
    // d1open: 진입이 D+1 시가(이미 점프한 뒤)라 이 점프는 기준선에 안 들어간다
    expect(core.universeBaselines(u, 'd1open').byKey.get('KR|2026-09-15')[5].mean).toBeCloseTo(0, 12);
  });

  test('종목 수가 기준(10) 미만이면 기준선 없음, 의심 봉·큰 결측 창은 빼고 건수를 센다', () => {
    expect(core.UNIVERSE_MIN_N).toBe(10);
    expect(core.universeBaselines(universe(9, {}), 'd0close').byKey.get('KR|2026-09-15')[5]).toBeNull();
    const u = universe(11, {});
    u[0].bars[20] = { ...u[0].bars[20], flags: ['corp_action_suspect'] };
    const bl = core.universeBaselines(u, 'd0close');
    expect(bl.excluded.corp).toBeGreaterThan(0);
    expect(bl.byKey.get(`KR|${u[0].bars[20].tradeDate}`)[1].n).toBe(10);
  });

  test('초과수익 = 시그널 수익 − 같은 D0 날짜 기준선, 구간은 주 군집 — D+10 에도 구간이 있다', () => {
    const mk = (id: number, d0: string, week: string, r: number) => ({ id, market: 'KR', state: 'ok', entryModel: 'd1open', d0BarDate: d0, week, ret: { 1: r, 3: r, 5: r, 10: r } });
    const evals = [
      mk(1, '2026-09-15', '2026-09-14', 0.03), mk(2, '2026-09-15', '2026-09-14', 0.01),
      mk(3, '2026-09-22', '2026-09-21', -0.02), mk(4, '2026-09-29', '2026-09-28', 0.00),
    ];
    const baselines = { byKey: new Map([
      ['KR|2026-09-15', { 1: { mean: 0.02, n: 12 }, 3: { mean: 0.02, n: 12 }, 5: { mean: 0.02, n: 12 }, 10: { mean: 0.02, n: 12 } }],
      ['KR|2026-09-22', { 1: { mean: -0.03, n: 12 }, 3: { mean: -0.03, n: 12 }, 5: { mean: -0.03, n: 12 }, 10: { mean: -0.03, n: 12 } }],
      ['KR|2026-09-29', { 1: null, 3: null, 5: null, 10: null }],
    ]), excluded: { corp: 0, gap: 0 } };
    core.attachBaselines(evals, baselines);
    expect(evals[0].base[5]).toBe(0.02);
    expect(evals[2].base[5]).toBe(-0.03);                 // 날짜 일치: 09-22 시그널은 09-22 기준선
    expect(evals[3].base).toEqual({});                    // 기준선 없는 날짜는 초과수익에서 빠진다
    const st = core.returnStats(evals);
    const ex = [0.01, -0.01, 0.01];
    const c = core.clusterCi95(ex, ['2026-09-14', '2026-09-14', '2026-09-21']);
    expect(st.byH[5].excess).toMatchObject({ n: 3, clusters: 2 });
    expect(st.byH[5].excess.mean).toBeCloseTo(c.mean, 12);
    expect(st.byH[10].excess.hi).toBeCloseTo(c.hi, 12);
    expect(st.byH[10].net.lo).not.toBeNull();             // D+10 순수익 구간(주 군집)
    expect(st.filled).toBe(4);                            // 일봉 모델은 fillProxy 없이도 진입
  });
});

describe('(T-095) 자동 경고·v2 판정 문구', () => {
  test('경고: n<30·서로 다른 주<8·구간 계산 불가, 경계 = 임계 ±0.1%p', () => {
    expect(core.ciWarn({ n: 24, clusters: 5, mean: 0, lo: -1, hi: 1 })).toEqual(['n=24<30', '주 5<8']);
    expect(core.ciWarn({ n: 40, clusters: 12, mean: 0, lo: -1, hi: 1 })).toEqual([]);
    expect(core.ciWarn({ n: 3, clusters: 1, mean: 0, lo: null, hi: null })).toContain('구간 계산 불가');
    expect(core.isBoundary(0.01, 0.01)).toBe(true);
    expect(core.isBoundary(0.0109, 0.01)).toBe(true);
    expect(core.isBoundary(-0.01, 0.01)).toBe(true);
    expect(core.isBoundary(0.0115, 0.01)).toBe(false);
    expect(core.isBoundary(null, 0.01)).toBe(false);
  });

  /** H-D: MA60 아래 40건(D+10 x) vs 위 24건(D+10 x+gap) — 비용은 같은 시장이라 차에 영향 없음 */
  function hdEvals(gap: number, entryModel?: string) {
    return Array.from({ length: 64 }, (_, i) => {
      const above = i >= 40;
      const r = (above ? gap : 0) + (i % 4) * 0.001;
      return {
        id: i + 1, market: 'US', strategy: 'rsi-oversold-v1', status: 'expired', amountKrw: 100000, state: 'ok', isEpisodeStart: true,
        structural: false, cashAvailable: null, wouldFill: null, fillProxy: true, corpTouched: false, consumedOrderId: null, priceBand: '<50k',
        aboveMa60: above, ret20: i * 0.001, week: `2026-0${1 + (i % 9)}-01`, mae10: -0.03, fxMethod: 'signal_ratio_day_median',
        ret: { 1: r, 3: r, 5: r, 10: r }, ...(entryModel ? { entryModel } : {}),
      };
    });
  }

  test('(수용 6) v2 H-D: 차가 임계와 같으면 경계 경고, n<30 경고, 다중비교 경고 · 환율 태그 하향 없음', () => {
    const sum = core.summarize(hdEvals(0.01, 'd1open'), { days: 90, episodeDays: 5, orders: [], entryModel: 'd1open' });
    const d = core.hdDiffs(sum).find((x: { m: string }) => x.m === 'US');
    expect(d.diff).toBeCloseTo(0.01, 10);
    expect(d.warn.join(' ')).toMatch(/임계 1%p 와 ±0\.10%p 안의 경계/);
    expect(d.warn.join(' ')).toMatch(/MA60 위 n=24<30/);
    const hd = core.judge(sum).rows.find((r: { id: string }) => r.id === 'H-D');
    expect(hd.evidence).toMatch(/경계/);
    expect(hd.evidence).toMatch(/다중비교: 이 분할은 \d+개/);
    expect(hd.evidence).toMatch(/환율 무관/);
    expect(hd.evidence).not.toMatch(/미국 환율 역산 2·3차/);
    // 같은 자료를 legacy 로 보면 v1 문구 그대로(경계·다중비교 문구 없음, 환율 메모 있음)
    const legacy = core.judge(core.summarize(hdEvals(0.01), { days: 90, episodeDays: 5, orders: [] })).rows.find((r: { id: string }) => r.id === 'H-D');
    expect(legacy.evidence).not.toMatch(/경계|다중비교/);
    expect(legacy.evidence).toMatch(/미국 환율 역산 2·3차/);
    // 임계에서 멀면 경계 경고 없음
    expect(core.hdDiffs(core.summarize(hdEvals(0.03, 'd1open'), { days: 90, episodeDays: 5, orders: [], entryModel: 'd1open' }))[0].warn.join(' ')).not.toMatch(/경계/);
  });

  test('(수용 6) v2 H-B: [확실] 은 건수에만 — 주문 시각 범위를 붙인다', () => {
    const meta = { days: 90, episodeDays: 5, orders: [{ status: 'rejected', n: 12 }], entryModel: 'd1open', orderSpan: { n: 12, first: '2026-08-12 15:13', last: '2026-08-12 15:29', days: 1 } };
    const hb = core.judge(core.summarize(hdEvals(0, 'd1open'), meta)).rows.find((r: { id: string }) => r.id === 'H-B');
    expect(hb.tag).toBe('[확실](건수만)');
    expect(hb.evidence).toMatch(/건수에만/);
    expect(hb.evidence).toMatch(/2026-08-12 15:13 ~ 2026-08-12 15:29\(서로 다른 날 1일\)/);
    const legacy = core.judge(core.summarize(hdEvals(0), { ...meta, entryModel: undefined })).rows.find((r: { id: string }) => r.id === 'H-B');
    expect(legacy.tag).toBe('[확실]');
    expect(legacy.evidence).toBe('기간 내 매수 주문 12건, 거부·실패·차단 12건');
  });

  test('(수용 3) v2 rsi 문장: D+10 을 구간·경고와 함께, 초과수익 포함, 환율 역산 비중이 높아도 태그를 낮추지 않는다', () => {
    const ev = Array.from({ length: 120 }, (_, i) => ({
      id: i + 1, market: 'US', strategy: 'rsi-oversold-v1', status: 'expired', state: 'ok', isEpisodeStart: true, entryModel: 'd1open',
      fxMethod: 'signal_ratio_day_median', week: `w${i % 24}`, mae10: -0.03, d0BarDate: 'x',
      ret: { 1: 0.01, 3: 0.01, 5: 0.02 + (i % 5) * 0.001, 10: (i % 7) * 0.001 }, base: { 1: 0, 3: 0, 5: 0.005, 10: 0.001 },
    }));
    const sum = core.summarize(ev, { days: 90, episodeDays: 5, orders: [], entryModel: 'd1open' });
    expect(sum.fx.weakShare).toBe(1);
    const rec = core.rsiRecommendation(sum);
    expect(rec.verdict).toBe('유지');
    expect(rec.tag).toBe('[가능성 높음]');                // legacy 였다면 capForFx 로 [추측]
    expect(rec.reason).toMatch(/D\+10 [-\d.]+% \(95% 구간 [-\d.]+%~[-\d.]+%, 주 군집 24개/);
    expect(rec.reason).toMatch(/같은 날 유니버스 대비 초과\(비용 전\) D\+5/);
    expect(rec.reason).toMatch(/P2\(합격 기준 사전 등록\) 이후 사용자 결정/);
    // 표본이 작으면 D+10 에 경고가 자동으로 붙는다
    const few = core.summarize(ev.slice(0, 40).map((e) => ({ ...e, week: `w${e.id % 5}` })), { days: 90, episodeDays: 5, orders: [], entryModel: 'd1open' });
    expect(core.rsiRecommendation(few).reason).toMatch(/D\+10 .*⚠ .*주 5<8/);
  });
});

describe('(T-095) runPostmortem — 일봉 모델·as-of·bars-until', () => {
  const syms = Array.from({ length: 12 }, (_, i) => `NAS:S${i}`);
  const usBars = (sym: string) => flat('2026-06-01', 120, 100).map((b, k) => {
    const c = 100 * (1 + 0.002 * k * (1 + syms.indexOf(sym) * 0.1));
    return { market: 'US', symbol: sym, d: b.tradeDate, open: String(c * 0.999), high: String(c * 1.01), low: String(c * 0.99), close: String(c), flags: null };
  });
  function fakeQ(fx: number) {
    const sent: { sql: string; params: unknown[] }[] = [];
    const q = async (sql: string, params: unknown[]) => {
      core.assertReadOnlySql(sql);
      sent.push({ sql, params });
      if (sql === core.SQL.tables) return (params[0] as string[]).map((t) => ({ t }));
      if (sql === core.SQL.signals || sql === core.SQL.signalsAsOf) {
        return [
          { id: 1, strategy_id: 'rsi-oversold-v1', symbol: 'NAS:S0', price: String(100 * 1400), amount_krw: '100000', status: 'expired',
            created_at: '2026-09-02 02:00:00', expires_at: '2026-09-02 02:30:00', consumed_order_id: null, price_zone: null },
          { id: 2, strategy_id: 'rsi-oversold-v1', symbol: 'NAS:S1', price: null, amount_krw: '100000', status: 'ai_skipped',
            created_at: '2026-09-09 02:00:00', expires_at: null, consumed_order_id: null, price_zone: null },
        ];
      }
      if (sql === core.SQL.barsAll) return syms.flatMap(usBars);
      if (sql === core.SQL.bars) return (params[0] as string[]).flatMap(usBars);
      if (sql === core.SQL.snapshots) return [{ ts: '2026-09-01 20:00:00', positions: [{ currency: 'USD', qty: 10, price: fx, value_krw: 10 * fx }] }];
      if (sql === core.SQL.orders || sql === core.SQL.ordersAsOf) return [{ status: 'rejected', blocked_by: null, source: 'x', n: 2 }];
      if (sql === core.SQL.ordersSpan || sql === core.SQL.ordersSpanAsOf) return [{ n: 2, first_at: '2026-08-12 15:13', last_at: '2026-08-12 15:29', days: 1 }];
      throw new Error(`unexpected ${sql}`);
    };
    return { q, sent };
  }
  const now = new Date('2026-10-22T12:00:00Z');

  test('d1open: 시장 전 종목 일봉을 읽어 기준선을 붙이고, 가정을 맨 위에 적은 v2 리포트를 만든다(SELECT 만)', async () => {
    const { q, sent } = fakeQ(1400);
    const r = await core.runPostmortem(q, { days: 90, episodeDays: 5, now, entryModel: 'd1open' });
    expect(sent.every((s) => s.sql.startsWith('SELECT '))).toBe(true);
    expect(sent.map((s) => s.sql)).toContain(core.SQL.barsAll);
    expect(sent.map((s) => s.sql)).not.toContain(core.SQL.bars);
    expect(r.sum.meta).toMatchObject({ entryModel: 'd1open', universe: { US: 12 }, maxBarDate: { US: usBars('NAS:S0').at(-1)!.d } });
    expect(r.evals.find((e: { id: number }) => e.id === 2)).toMatchObject({ state: 'ok', priceStatus: 'price_missing' });
    expect(r.evals.every((e: { base?: Record<number, number> }) => e.base && Number.isFinite(e.base[5]))).toBe(true);
    expect(r.compare.map((c: { model: string }) => c.model)).toEqual(['legacy', 'd1open', 'd0close']);
    const md: string = r.md;
    expect(md).toMatch(/^---\ntask_id: T-095/);
    expect(md.indexOf('## 정의 — 먼저 읽기')).toBeLessThan(md.indexOf('## 결론 먼저'));
    for (const s of ['같은 날 유니버스 초과수익', '**날짜 일치 비교**', 'D+1 은 진입 당일', 'D+1 프록시 = 하루 걸어둔 지정가 반사실', '측정 대상은 라이브 전략이 아니다',
      '**다중비교**', 'H-B 의 [확실] 은 건수에만', '가격 없음(price_missing) 에피소드 1건', '순 D+10 95% 구간', '초과 D+10 95% 구간', '자동 경고',
      '## 진입 모델 비교', 'H-D 차(비용 후 D+10 평균', 'H-A 커버 분해', '환율 의존이 남는 것', 'P2(합격 기준 사전 등록) 이후 사용자 결정']) {
      expect(md).toContain(s);
    }
  });

  test('(수용 2) 끝까지 돌려도 d1open 수익 통계는 환율 스냅샷 값과 무관, legacy 는 달라진다', async () => {
    const a = await core.runPostmortem(fakeQ(1300).q, { days: 90, episodeDays: 5, now, entryModel: 'd1open' });
    const b = await core.runPostmortem(fakeQ(1500).q, { days: 90, episodeDays: 5, now, entryModel: 'd1open' });
    expect(a.sum.rsi.byH).toEqual(b.sum.rsi.byH);
    expect(a.sum.byMarket.US.byH).toEqual(b.sum.byMarket.US.byH);
    expect(a.sum.byMarket.US.mae10Median).toBe(b.sum.byMarket.US.mae10Median);
    expect(a.sum.trend.US.belowMa60.byH).toEqual(b.sum.trend.US.belowMa60.byH);
    expect(a.sum.trend.US.aboveMa60.byH).toEqual(b.sum.trend.US.aboveMa60.byH);
    // D+1 갭(지정가 대비)은 시그널 가격 기준이라 환율 의존이 남는다 — 리포트 "환율 의존이 남는 것" 과 같다
    expect(a.sum.byMarket.US.gapD1Median).not.toBeCloseTo(b.sum.byMarket.US.gapD1Median, 6);
    const la = await core.runPostmortem(fakeQ(1300).q, { days: 90, episodeDays: 5, now });
    const lb = await core.runPostmortem(fakeQ(1500).q, { days: 90, episodeDays: 5, now });
    expect(la.evals[0].entry).not.toBeCloseTo(lb.evals[0].entry, 6);
  });

  test('as-of: 시그널·주문 창을 [as-of − N일, as-of] 로 고정, legacy 는 v1 질의 외에 아무것도 더 보내지 않는다', async () => {
    const { q, sent } = fakeQ(1400);
    const r = await core.runPostmortem(q, { days: 90, episodeDays: 5, now, asOf: '2026-10-24 05:50:00' });
    const sig = sent.find((s) => s.sql === core.SQL.signalsAsOf)!;
    expect(sig.params).toEqual(['2026-10-24 05:50:00', 90, '2026-10-24 05:50:00']);
    expect(sent.find((s) => s.sql === core.SQL.ordersAsOf)!.params).toEqual(['2026-10-24 05:50:00', 90, '2026-10-24 05:50:00']);
    expect(sent.map((s) => s.sql)).not.toEqual(expect.arrayContaining([core.SQL.signals]));
    for (const extra of [core.SQL.barsAll, core.SQL.ordersSpan, core.SQL.ordersSpanAsOf]) expect(sent.map((s) => s.sql)).not.toContain(extra);
    expect(r.md).toMatch(/^---\ntask_id: T-070/);                 // legacy 는 v1 리포트 형식
    expect(r.md).toContain('가격 없음 1');                          // 라벨만 정정
  });

  test('bars-until: 그 날짜 뒤 일봉은 쓰지 않는다(새 봉 영향 분리)', async () => {
    const full = await core.runPostmortem(fakeQ(1400).q, { days: 90, episodeDays: 5, now, entryModel: 'd1open', compare: false });
    const cut = await core.runPostmortem(fakeQ(1400).q, { days: 90, episodeDays: 5, now, entryModel: 'd1open', compare: false, barsUntil: '2026-09-15' });
    expect(cut.sum.meta.maxBarDate.US <= '2026-09-15').toBe(true);
    expect(full.evals[1].ret[10]).toBeDefined();
    expect(cut.evals[1].ret?.[10]).toBeUndefined();                // 09-09 D0 의 D+10 은 09-15 까지로는 안 닿는다
    expect(cut.compare).toEqual([]);
  });
});

// ── T-095 Reviewer 조건 C1·C2 와 시험 보강(M-2) ───────────────────────────────────────────────
describe('(T-095 C1) 집중도·민감도 경고', () => {
  test('clusterConcentration: 최대 군집 비중·키(동률은 사전순), 유효 군집 수', () => {
    const c = core.clusterConcentration(['B', 'A', 'A', 'C', 'B', 'A']);
    expect(c).toMatchObject({ n: 6, maxKey: 'A' });
    expect(c.maxShare).toBeCloseTo(0.5, 12);
    expect(c.effClusters).toBeCloseTo(1 / (0.25 + 1 / 9 + 1 / 36), 12);
    expect(core.clusterConcentration(['B', 'A']).maxKey).toBe('A');
    expect(core.clusterConcentration([])).toMatchObject({ n: 0, maxShare: null });
  });

  test('clusterDiffCi95: 군집 영향 합으로 차의 구간(t, 자유도 G−1)', () => {
    const d = core.clusterDiffCi95([{ x: 1, k: 'A' }, { x: 3, k: 'B' }], [{ x: 0, k: 'A' }, { x: 0, k: 'B' }]);
    // u_A = (1−2)/2 = −0.5, u_B = +0.5 → se = sqrt(2/1 · 0.5) = 1, t(1) = 12.706
    expect(d.diff).toBe(2);
    expect(d.lo).toBeCloseTo(2 - 12.706, 10);
    expect(d.hi).toBeCloseTo(2 + 12.706, 10);
    expect(core.clusterDiffCi95([], [{ x: 0, k: 'A' }])).toBeNull();
  });

  const mkE = (i: number, week: string, r: number, extra: Record<string, unknown> = {}) => ({
    id: i, market: 'US', state: 'ok', entryModel: 'd1open', week, ret: { 1: r, 3: r, 5: r, 10: r }, ...extra,
  });

  test('rowWarn: 한 주가 25% 를 넘으면 표본 집중 경고(정확히 25% 는 아님)', () => {
    expect(core.MAX_CLUSTER_SHARE_WARN).toBe(0.25);
    const weeks = (big: number) => [...Array(big).fill('W0'), ...Array.from({ length: 40 - big }, (_, i) => `W${1 + (i % 10)}`)];
    const at = (big: number) => core.rowWarn(core.returnStats(weeks(big).map((w, i) => mkE(i, w, 0.01 + (i % 3) * 0.001))), 5);
    expect(at(10).join(' ')).not.toMatch(/최대 주/);     // 10/40 = 25%
    expect(at(11).join(' ')).toMatch(/최대 주 28%\(W0\)/);
  });

  test('rowWarn: 가장 큰 주를 빼거나 가격 없음을 빼면 부호가 뒤집히는 경우 경고', () => {
    const ev = [
      ...Array.from({ length: 12 }, (_, i) => mkE(i, 'W0', 0.1)),          // 비용 후 전체 평균은 양수, W0 를 빼면 음수
      ...Array.from({ length: 30 }, (_, i) => mkE(100 + i, `W${1 + (i % 10)}`, -0.01 - (i % 3) * 0.001)),
    ];
    const w = core.rowWarn(core.returnStats(ev), 5).join(' ');
    expect(w).toMatch(/최대 주 제외 시 부호 반전/);
    const pm = [
      ...Array.from({ length: 5 }, (_, i) => mkE(i, `W${i}`, 0.3, { priceStatus: 'price_missing' })),
      ...Array.from({ length: 30 }, (_, i) => mkE(100 + i, `W${i % 10}`, -0.01 - (i % 3) * 0.001)),
    ];
    const st = core.returnStats(pm);
    expect(st.byH[5].netPriced.n).toBe(30);
    expect(st.byH[5].netPriced.mean).toBeLessThan(0);
    expect(st.byH[5].net.mean).toBeGreaterThan(0);
    expect(core.rowWarn(st, 5).join(' ')).toMatch(/가격 없음 제외 시 부호 반전/);
    expect(core.returnStats(ev).byH[5].netPriced).toBeNull();          // 가격 없음이 없으면 병기 안 함
  });

  test('hdLabel: 집중이면 판정 보류, 아니면 구간·임계로 지지/반대/불분명', () => {
    const base = { nBelow: 40, nAbove: 40, conc: { maxShare: 0.1, maxKey: 'W1', n: 80 } };
    const full = (diff: number, lo: number, hi: number) => ({ diff, lo, hi, clusters: 12 });
    expect(core.hdLabel({ ...base, full: full(0.03, 0.01, 0.05), drop: full(0.03, 0.01, 0.05) }).label).toMatch(/^지지/);
    expect(core.hdLabel({ ...base, full: full(-0.03, -0.05, -0.01), drop: full(-0.03, -0.05, -0.01) }).label).toMatch(/^반대/);
    expect(core.hdLabel({ ...base, full: full(0.03, -0.01, 0.07), drop: full(0.03, -0.01, 0.07) }).label).toMatch(/^불분명/);
    expect(core.hdLabel({ ...base, full: full(0.005, -0.01, 0.02), drop: full(0.005, -0.01, 0.02) }).label).toMatch(/1%p 미만/);
    expect(core.hdLabel({ ...base, conc: { maxShare: 0.35, maxKey: 'W0', n: 80 }, full: full(-0.06, -0.1, -0.02), drop: full(-0.06, -0.1, -0.02) }))
      .toMatchObject({ label: '표본 집중 — 판정 보류', concentrated: true });
    // 비중은 낮아도 그 주를 빼면 판정 쪽이 바뀌면 집중으로 본다
    expect(core.hdLabel({ ...base, full: full(-0.06, -0.1, -0.02), drop: full(0.004, -0.02, 0.03) }).label).toBe('표본 집중 — 판정 보류');
    expect(core.hdLabel({ ...base, nAbove: 19, full: full(0.03, 0.01, 0.05), drop: null }).label).toMatch(/표본 부족/);
  });

  test('(C1) v2 H-D: 한 주가 KR 표본의 35% 면 "반대" 대신 "표본 집중 — 판정 보류", 그 주 제외 차를 적는다', () => {
    // KR: MA60 아래 40건(그중 30건이 한 주에 몰려 +10%), 위 30건 −1%
    const ev = [
      ...Array.from({ length: 30 }, (_, i) => ({ id: i, w: '2026-07-27', above: false, r: 0.1 + (i % 3) * 0.001 })),
      ...Array.from({ length: 10 }, (_, i) => ({ id: 100 + i, w: `2026-08-${10 + i}`, above: false, r: -0.02 })),
      ...Array.from({ length: 30 }, (_, i) => ({ id: 200 + i, w: `2026-09-${10 + (i % 10)}`, above: true, r: -0.01 - (i % 3) * 0.001 })),
    ].map((x) => ({
      id: x.id, market: 'KR', strategy: 'pullback-trend-v1', status: 'expired', state: 'ok', isEpisodeStart: true, entryModel: 'd1open',
      aboveMa60: x.above, week: x.w, ret20: 0, mae10: -0.05, structural: false, cashAvailable: null, consumedOrderId: null,
      ret: { 1: x.r, 3: x.r, 5: x.r, 10: x.r },
    }));
    const sum = core.summarize(ev, { days: 90, episodeDays: 5, orders: [], entryModel: 'd1open' });
    expect(sum.hdDiag.KR.conc).toMatchObject({ maxKey: '2026-07-27' });
    expect(sum.hdDiag.KR.conc.maxShare).toBeCloseTo(30 / 70, 12);
    const hd = core.judge(sum).rows.find((r: { id: string }) => r.id === 'H-D');
    expect(hd.verdict).toBe('KR 표본 집중 — 판정 보류');
    expect(hd.verdict).not.toMatch(/반대|지지/);
    expect(hd.evidence).toMatch(/최대 주 43%\(2026-07-27/);
    expect(hd.evidence).toMatch(/그 주 제외 차/);
    expect(hd.tag).toBe('[추측]');
  });

  test('(C1) v2 rsi 헤드라인: 가격 없음 제외 값을 병기하고, 제외 시 달라지면 "표본 구성에 민감" + [추측]', () => {
    const ev = [
      ...Array.from({ length: 10 }, (_, i) => ({ id: i, w: `w${i % 10}`, r: 0.2, pm: true })),
      ...Array.from({ length: 110 }, (_, i) => ({ id: 100 + i, w: `w${i % 22}`, r: -0.01 + (i % 5) * 0.001, pm: false })),
    ].map((x) => ({
      id: x.id, market: 'US', strategy: 'rsi-oversold-v1', status: 'ai_skipped', state: 'ok', isEpisodeStart: true, entryModel: 'd1open',
      week: x.w, mae10: -0.03, ...(x.pm ? { priceStatus: 'price_missing' } : {}), ret: { 1: x.r, 3: x.r, 5: x.r, 10: x.r },
    }));
    const rec = core.rsiRecommendation(core.summarize(ev, { days: 90, episodeDays: 5, orders: [], entryModel: 'd1open' }));
    expect(rec.verdict).toMatch(/표본 구성에 민감/);
    expect(rec.tag).toBe('[추측]');
    expect(rec.reason).toMatch(/가격 없음 제외 시 비용 후 D\+5 -[\d.]+% \(95% 구간/);
    expect(rec.reason).toMatch(/최대 주 비중 D\+5/);
    expect(rec.reason).toMatch(/자동 경고: .*가격 없음 제외 시 부호 반전/);
  });
});

describe('(T-095 C2) 같은 에피소드 비교', () => {
  const ev = (id: number, model: string, x: Record<string, unknown>) => ({
    id, market: id % 2 ? 'US' : 'KR', strategy: 'rsi-oversold-v1', state: 'ok', isEpisodeStart: true, week: `w${id % 3}`, d0: '2026-09-01', symbol: `S${id}`,
    ...(model === 'legacy' ? {} : { entryModel: model }), ...x,
  });
  const r = (v: number) => ({ 1: v, 3: v, 5: v, 10: v });
  const legacy = [
    ...[1, 2, 3, 4].map((id) => ev(id, 'legacy', { fillProxy: true, ret: r(-0.01) })),
    ev(5, 'legacy', { state: 'price_missing', priceStatus: 'price_missing' }),
    ev(6, 'legacy', { fillProxy: false }),                                  // 지정가 미체결
    ev(7, 'legacy', { fillProxy: true, ret: r(0.02) }),                     // legacy 에만(모델은 진입 불가)
  ];
  const model = [
    ...[1, 2, 3, 4].map((id) => ev(id, 'd1open', { ret: r(-0.02) })),
    ev(5, 'd1open', { priceStatus: 'price_missing', ret: r(0.3), entryZeroVolume: true }),
    ev(6, 'd1open', { ret: r(0.01) }),
    ev(7, 'd1open', { entryUnavailable: 'd1_open_missing' }),
  ];

  test('같은 에피소드만으로 두 모델 평균, 모델에만 든 것은 가격 없음/미체결/기타로 나눈다', () => {
    const c = core.sameEpisodeCompare(legacy, model, 5);
    expect(c.same.n).toBe(4);
    expect(c.same.legacy.mean).toBeCloseTo(-0.01 - 0.0065 * 0.5 - 0.0033 * 0.5, 12);   // US 2·KR 2 비용
    expect(c.same.model.mean - c.same.legacy.mean).toBeCloseTo(-0.01, 12);
    expect(c.byMarket.US.n).toBe(2);
    expect(c.onlyModel.n).toBe(2);
    expect(c.onlyModel.groups.priceMissing.n).toBe(1);
    expect(c.onlyModel.groups.legacyUnfilled.n).toBe(1);
    expect(c.onlyModel.groups.other.n).toBe(0);
    expect(c.onlyModel.top).toEqual([{ symbol: 'S5', d0: '2026-09-01', x: 0.3 - 0.0065, zeroVolume: true }]);
    expect(c.onlyLegacy.n).toBe(1);
    // 전체 평균 차 = 같은 에피소드 차 + 표본 구성 몫
    const full = c.full.model.mean - c.full.legacy.mean;
    expect(full).not.toBeCloseTo(c.same.model.mean - c.same.legacy.mean, 6);
  });

  test('pick 으로 전략을 거른다', () => {
    const other = model.map((e) => ({ ...e, strategy: 'x' }));
    expect(core.sameEpisodeCompare(legacy, other, 5, (e: { strategy: string }) => /^rsi/.test(e.strategy)).same.n).toBe(0);
  });
});

describe('(T-095 M-2) 변이 생존 보강', () => {
  test('(M04) attachBaselines·초과수익은 h 마다 그 h 의 기준선을 쓴다', () => {
    const e = { id: 1, market: 'KR', state: 'ok', entryModel: 'd1open', d0BarDate: '2026-09-15', week: 'w', ret: { 1: 0.01, 3: 0.03, 5: 0.05, 10: 0.10 } };
    const bl = { byKey: new Map([['KR|2026-09-15', { 1: { mean: 0.001, n: 12 }, 3: { mean: 0.003, n: 12 }, 5: { mean: 0.005, n: 12 }, 10: { mean: 0.010, n: 12 } }]]), excluded: { corp: 0, gap: 0 } };
    core.attachBaselines([e], bl);
    expect((e as { base?: Record<number, number> }).base).toEqual({ 1: 0.001, 3: 0.003, 5: 0.005, 10: 0.010 });
    const st = core.returnStats([e]);
    expect(st.byH[5].excess.mean).toBeCloseTo(0.045, 12);
    expect(st.byH[10].excess.mean).toBeCloseTo(0.09, 12);
    expect(st.byH[1].excess.mean).toBeCloseTo(0.009, 12);
  });

  test('(M21) 기준선은 창에 9일 넘는 결측이 있는 종목-날짜를 뺀다', () => {
    const series = Array.from({ length: 11 }, (_, s) => ({ market: 'KR', bars: flat('2026-09-01', 30, 100 + s) }));
    const holed = series[0].bars;
    const j = 10;
    series[0].bars = [...holed.slice(0, j + 1), ...holed.slice(j + 1).map((b) => ({ ...b, tradeDate: shift(b.tradeDate, 14) }))];
    const bl = core.universeBaselines(series, 'd0close');
    expect(bl.excluded.gap).toBeGreaterThan(0);
    expect(bl.byKey.get(`KR|${holed[j].tradeDate}`)[1].n).toBe(10);       // 그 종목은 빠지고 10개
  });

  test('(M25) MAE10 창은 D0 봉이 아니라 D+1 부터 — D0 저가가 가장 낮아도 들어가지 않는다', () => {
    const b = flat('2026-07-01', 90, 100);
    const i0 = b.findIndex((x) => x.tradeDate === '2026-10-05');
    b[i0] = bar('2026-10-05', 100, { low: 50 });
    for (let k = 1; k <= 10; k++) b[i0 + k] = bar(b[i0 + k].tradeDate, 100, { open: 100, low: 95 });
    for (const model of ['d1open', 'd0close']) {
      expect(core.evaluateSignal(sig(), b, { entryModel: model }).mae10).toBeCloseTo(95 / 100 - 1, 12);
    }
  });

  test('(M34) d1open 시가가 0 이거나 없으면 진입 불가', () => {
    const b = flat('2026-07-01', 90, 100);
    const i0 = b.findIndex((x) => x.tradeDate === '2026-10-05');
    expect(core.entryFromBars([...b.slice(0, i0 + 1), { ...b[i0 + 1], open: 0 }, ...b.slice(i0 + 2)], i0, 'd1open', '2026-10-05')).toMatchObject({ price: null, reason: 'd1_open_missing' });
    expect(core.entryFromBars([...b.slice(0, i0 + 1), { ...b[i0 + 1], open: null }], i0, 'd1open', '2026-10-05').reason).toBe('d1_open_missing');
  });

  test('(M10) 경계 가장자리: 임계 ±0.1%p 정확히는 경계', () => {
    expect(core.isBoundary(0.011, 0.01)).toBe(true);
    expect(core.isBoundary(0.009, 0.01)).toBe(true);
    expect(core.isBoundary(0.00899, 0.01)).toBe(false);
  });

  test('(M27·M29) v2 표 열 값: D+10 구간 열·초과 D+10 열이 D+10 값, H-A 분해는 현금 < 금액만 부족', () => {
    const ev = Array.from({ length: 40 }, (_, i) => ({
      id: i + 1, market: 'KR', strategy: 'rsi-oversold-v1', status: 'expired', state: 'ok', isEpisodeStart: true, entryModel: 'd1open',
      week: `w${i % 10}`, d0: '2026-09-01', mae10: -0.05, amountKrw: 100000, cashAvailable: i < 10 ? 100000 : i < 20 ? 50000 : null,
      ret: { 1: 0.001, 3: 0.003, 5: 0.02 + (i % 4) * 0.001, 10: -0.04 - (i % 4) * 0.001 }, base: { 1: 0, 3: 0, 5: 0.01, 10: 0.03 },
    }));
    const sum = core.summarize(ev, { days: 90, episodeDays: 5, orders: [], entryModel: 'd1open', universe: { KR: 43 } });
    const md: string = core.renderReportV2(sum, core.judge(sum), core.rsiRecommendation(sum), { generatedDate: 'd', generatedAt: 't', compare: [] });
    const row = md.split('\n').find((l) => l.startsWith('| rsi-oversold 전체 |'))!.split('|').map((x) => x.trim());
    const h = sum.rsi.byH;
    const r2 = (x: number) => `${(x * 100).toFixed(2)}%`;
    // 열: 0 '' 1 구분 2 에피소드 3 진입 4 D+1체결 5 순D+1 6 순D+3 7 순D+5 8 D+5구간 9 순D+10 10 D+10구간 11 주 12 초과D+5 13 구간 14 초과D+10 15 구간
    expect(row[9]).toBe(r2(h[10].net.mean));
    expect(row[10]).toBe(`${r2(h[10].net.lo)}~${r2(h[10].net.hi)}`);
    expect(row[14]).toBe(r2(h[10].excess.mean));
    expect(row[15]).toBe(`${r2(h[10].excess.lo)}~${r2(h[10].excess.hi)}`);
    expect(row[10]).not.toBe(row[8]);
    expect(sum.haBreak).toEqual([{ key: 'KR|2026-09', total: 40, covered: 20, short: 10 }]);   // 현금 = 금액(10건)은 부족이 아니다
    expect(md).toContain('| KR | 2026-09 | 40 | 20 | 10 | 50.0% |');
  });

  test('(M20·M28·M19) 끝까지: d1open 기준선은 d1open 정의, 비교 표 초과 D+10 은 D+10 값, bars-until 날짜 봉은 포함', async () => {
    const syms = Array.from({ length: 12 }, (_, i) => `NAS:S${i}`);
    const rowsOf = (sym: string) => flat('2026-06-01', 120, 100).map((b, k) => {
      const c = 100 * (1 + 0.002 * k * (1 + syms.indexOf(sym) * 0.1)) * (1 + (k % 3) * 0.004);
      return { market: 'US', symbol: sym, d: b.tradeDate, open: String(c * (k % 2 ? 0.99 : 1.01)), high: String(c * 1.02), low: String(c * 0.98), close: String(c), flags: null };
    });
    const q = async (sql: string, params: unknown[]) => {
      core.assertReadOnlySql(sql);
      if (sql === core.SQL.tables) return (params[0] as string[]).map((t) => ({ t }));
      if (sql === core.SQL.signals) return [{ id: 1, strategy_id: 'rsi-oversold-v1', symbol: 'NAS:S0', price: null, amount_krw: '100000', status: 'ai_skipped',
        created_at: '2026-09-09 02:00:00', expires_at: null, consumed_order_id: null, price_zone: null }];
      if (sql === core.SQL.barsAll) return syms.flatMap(rowsOf);
      if (sql === core.SQL.snapshots || sql === core.SQL.orders) return [];
      if (sql === core.SQL.ordersSpan) return [{ n: 0, first_at: null, last_at: null, days: 0 }];
      throw new Error(sql);
    };
    const now = new Date('2026-10-22T12:00:00Z');
    const r = await core.runPostmortem(q, { days: 90, episodeDays: 5, now, entryModel: 'd1open' });
    const series = syms.map((s) => ({ market: 'US', bars: rowsOf(s).map((x) => ({ tradeDate: x.d, open: Number(x.open), high: Number(x.high), low: Number(x.low), close: Number(x.close), flags: [] })) }));
    const key = `US|${r.evals[0].d0BarDate}`;
    const b1 = core.universeBaselines(series, 'd1open').byKey.get(key)[5].mean;
    const b0 = core.universeBaselines(series, 'd0close').byKey.get(key)[5].mean;
    expect(r.evals[0].base[5]).toBeCloseTo(b1, 12);
    expect(Math.abs(b1 - b0)).toBeGreaterThan(1e-6);
    const line = r.md.split('\n').find((l: string) => l.startsWith('| rsi-oversold 전체 | d1open |'))!.split('|').map((x: string) => x.trim());
    expect(line[10]).toBe(`${(r.sum.rsi.byH[10].excess.mean * 100).toFixed(2)}%`);   // 초과 D+10 열
    expect(line[9]).toBe(`${(r.sum.rsi.byH[5].excess.mean * 100).toFixed(2)}%`);
    const until = rowsOf('NAS:S0')[60].d;
    const cut = await core.runPostmortem(q, { days: 90, episodeDays: 5, now, entryModel: 'd1open', compare: false, barsUntil: until });
    expect(cut.sum.meta.maxBarDate.US).toBe(until);
    // v2 리포트 새 절
    for (const s of ['## v1(legacy) 대비 — 같은 에피소드 비교', '② 표본 구성 몫', '분리하지 못한 것', 'v2 라벨', '수집 관심목록의 등가중 평균', '시장 지수·시장 전체가 아니다', 'zero_volume']) {
      expect(r.md).toContain(s);
    }
  });
});
