/**
 * T-096 에피소드·통계·레짐·포트폴리오 — 경계·불변식·재현성. 합성 입력만.
 */
import { toEpisodes } from '../backtest/episodes';
import { weekKey } from '../backtest/frames';
import { annualizedReturn, clusterBootstrapCI, clusterSe, expectancy, foldStats, maxDrawdown, mulberry32, sharpe } from '../backtest/metrics';
import { simulate } from '../backtest/portfolio';
import { regimeOk, regimeOkAt, universeIndex } from '../backtest/regime';
import type { CostModel, Episode, Fill, PortfolioConfig, Signal } from '../backtest/types';
import { bar, flatFrame, frame, weekdays } from './backtest-fixtures';

const sig = (symbol: string, d0Index: number, d0 = `2025-01-${String(d0Index + 1).padStart(2, '0')}`, score = 0): Signal => ({ symbol, d0, d0Index, score });

describe('toEpisodes — 5거래일 창·보유 중 재발화', () => {
  test('창 5: 5일째 재발화는 같은 에피소드, 6일째는 새 에피소드', () => {
    const e = toEpisodes([sig('A', 10), sig('A', 15), sig('A', 16), sig('A', 21)], 5, 0);
    expect(e.map((s) => s.d0Index)).toEqual([10, 16]);
  });
  test('변이: 창 4 → 15 가 새 에피소드, 창 6 → 16 도 묶임', () => {
    expect(toEpisodes([sig('A', 10), sig('A', 15), sig('A', 16)], 4, 0).map((s) => s.d0Index)).toEqual([10, 15]);
    expect(toEpisodes([sig('A', 10), sig('A', 15), sig('A', 16)], 6, 0).map((s) => s.d0Index)).toEqual([10]);
  });
  test('보유 10일이면 보유 중(≤10) 재발화 무시, 11일째 새 에피소드', () => {
    expect(toEpisodes([sig('A', 0), sig('A', 6), sig('A', 10), sig('A', 11)], 5, 10).map((s) => s.d0Index)).toEqual([0, 11]);
  });
  test('종목별 독립·결과 정렬(D0, 종목)·입력 순서 무관', () => {
    const a = toEpisodes([sig('B', 3), sig('A', 3), sig('A', 1)], 5, 0);
    // A 의 1·3 은 같은 에피소드(창 5), B3 은 다른 종목 → 독립. 정렬은 D0(여기선 sig 기본 날짜 = 위치) → 종목
    expect(a.map((s) => `${s.symbol}${s.d0Index}`)).toEqual(['A1', 'B3']);
    expect(() => toEpisodes([], -1, 0)).toThrow();
  });
});

const fill = (netRet: number, kind: Fill['exitKind'] = 'time'): Fill => ({ entryDate: 'x', entryPrice: 1, exitDate: 'y', exitPrice: 1, exitKind: kind, grossRet: netRet, netRet });
const ep = (symbol: string, d0: string, net: number, ex: number, kind: Fill['exitKind'] = 'time'): Episode => ({
  signal: { symbol, d0, d0Index: 0, score: 0 }, fill: fill(net, kind), horizonRets: { 5: net }, excess: { 5: ex }, week: weekKey(d0), corpSuspect: false,
});

describe('expectancy', () => {
  test('평균·PF·손익비·주·종목·단일 종목 비중', () => {
    const eps = [ep('A', '2025-01-06', 0.02, 0.01), ep('A', '2025-01-13', -0.01, 0), ep('B', '2025-01-13', 0.04, 0.02), ep('C', '2025-01-20', -0.01, -0.01)];
    const x = expectancy(eps, 5, 'positive_sum');
    expect(x.n).toBe(4);
    expect(x.mean).toBeCloseTo(0.01, 12);
    expect(x.pf).toBeCloseTo(0.06 / 0.02, 12);
    expect(x.payoff).toBeCloseTo((0.06 / 2) / (0.02 / 2), 12);
    expect(x.weeks).toBe(3);
    expect(x.symbols).toBe(3);
    // 종목 순수익: A 0.01, B 0.04, C −0.01 → 양의 기여 0.05 중 B 0.04 = 0.8
    expect(x.maxSymbolShare).toBeCloseTo(0.8, 12);
    expect(x.meanExcess).toBeCloseTo(0.005, 12);
  });
  test('④ V1: 단일 종목 비중 분모 = 전체 순수익(권고) — 손실 종목이 있으면 양(+)합 기준보다 크다, 전체 ≤ 0 이면 null', () => {
    const eps = [ep('A', '2025-01-06', 0.02, 0.01), ep('A', '2025-01-13', -0.01, 0), ep('B', '2025-01-13', 0.04, 0.02), ep('C', '2025-01-20', -0.01, -0.01)];
    const t = expectancy(eps, 5, 'total_net');
    // 종목 순수익 A 0.01, B 0.04, C −0.01 → 전체 0.04, 최대 양(+) B 0.04 → 1.0 / 양(+)합 0.05 기준 0.8(보조)
    expect(t.maxSymbolShare).toBeCloseTo(1.0, 12);
    expect(t.maxSymbolShareAux).toBeCloseTo(0.8, 12);
    expect(expectancy(eps, 5, 'positive_sum').maxSymbolShareAux).toBeCloseTo(1.0, 12);
    const loss = [ep('A', '2025-01-06', 0.01, 0), ep('B', '2025-01-06', -0.03, 0)];
    expect(expectancy(loss, 5, 'total_net').maxSymbolShare).toBeNull();
    expect(expectancy(loss, 5, 'positive_sum').maxSymbolShare).toBeCloseTo(1, 12);
  });
  test('건너뛴 체결·미청산은 표본에서 빠진다, 손실 없으면 PF=∞', () => {
    const eps = [ep('A', '2025-01-06', 0.02, 0), ep('B', '2025-01-06', 0, 0, 'gap_skip'), { ...ep('C', '2025-01-06', 0, 0), fill: null }];
    const x = expectancy(eps, 5, 'total_net');
    expect(x.n).toBe(1);
    expect(x.pf).toBe(Infinity);
    expect(expectancy([], 5, 'total_net').mean).toBeNull();
  });
});

describe('clusterBootstrapCI — 주 군집 블록 부트스트랩', () => {
  const vals = Array.from({ length: 60 }, (_, i) => ((i * 37) % 11) / 100 - 0.03);
  const weeks = vals.map((_, i) => `W${Math.floor(i / 5)}`);
  test('같은 시드 → 같은 구간(재현), 다른 시드 → 다를 수 있다', () => {
    const a = clusterBootstrapCI(vals, weeks, 2000, 7);
    const b = clusterBootstrapCI(vals, weeks, 2000, 7);
    expect(a).toEqual(b);
    expect(a.lo!).toBeLessThan(a.mean!);
    expect(a.hi!).toBeGreaterThan(a.mean!);
    expect(a.df).toBe(11);
    const c = clusterBootstrapCI(vals, weeks, 2000, 8);
    expect(c.lo).not.toBe(a.lo);
  });
  test('군집 1개면 구간·t 없음, 2개면 계산', () => {
    expect(clusterBootstrapCI([0.1, 0.2], ['w', 'w'], 100, 1).lo).toBeNull();
    const two = clusterBootstrapCI([0.1, 0.2, 0.3, 0.5], ['a', 'a', 'b', 'b'], 500, 1);
    expect(two.lo).not.toBeNull();
    expect(two.df).toBe(1);
  });
  test('t = 평균 / 군집 강건 SE(P1 clusterCi95 와 같은 SE 식)', () => {
    const r = clusterBootstrapCI(vals, weeks, 200, 1);
    const s = clusterSe(vals, weeks);
    expect(r.t!).toBeCloseTo(s.mean! / s.se!, 12);
  });
  test('변이: 군집을 무시(iid, 관측마다 군집)하면 같은 주 안 상관 자료에서 구간이 좁아진다 → 군집 구간이 더 넓다', () => {
    // 주마다 같은 값(완전 상관) — iid 처리는 표본 60 으로 착각해 좁아진다
    const v = Array.from({ length: 60 }, (_, i) => [0.05, -0.02, 0.01, 0.03, -0.04, 0.02][Math.floor(i / 10)]);
    const w = v.map((_, i) => `W${Math.floor(i / 10)}`);
    const cl = clusterBootstrapCI(v, w, 2000, 3);
    const iid = clusterBootstrapCI(v, v.map((_, i) => `o${i}`), 2000, 3);
    expect(cl.hi! - cl.lo!).toBeGreaterThan(iid.hi! - iid.lo!);
  });
  test('M40: 구간 = 부트스트랩 분포의 2.5%·97.5% 백분위 — 독립 재구현(같은 PRNG·군집 정렬)과 정확히 같다', () => {
    const v = Array.from({ length: 80 }, (_, i) => Math.sin(i * 1.7) / 50 + (i % 7) / 400);
    const w = v.map((_, i) => `W${String(Math.floor(i / 4)).padStart(2, '0')}`);
    const r = clusterBootstrapCI(v, w, 2000, 20261026);
    const groups = new Map<string, { s: number; c: number }>();
    v.forEach((x, i) => { const g = groups.get(w[i]) || { s: 0, c: 0 }; g.s += x; g.c++; groups.set(w[i], g); });
    const gs = [...groups.keys()].sort().map((k) => groups.get(k)!);
    const rnd = mulberry32(20261026);
    const st: number[] = [];
    for (let it = 0; it < 2000; it++) { let s = 0, c = 0; for (let j = 0; j < gs.length; j++) { const g = gs[Math.floor(rnd() * gs.length)]; s += g.s; c += g.c; } st.push(s / c); }
    st.sort((a, b) => a - b);
    expect(r.lo).toBe(st[Math.floor(0.025 * 2000)]);
    expect(r.hi).toBe(st[Math.floor(0.975 * 2000)]);
    expect(r.lo).not.toBe(st[Math.floor(0.05 * 2000)]);
  });
  test('M36: 군집 SE = √(G/(G−1)·Σ(군집 잔차합)²)/n — 손계산(G=3)', () => {
    const v = [0.01, 0.03, -0.02, 0.05, 0.00, 0.02];
    const w = ['a', 'a', 'b', 'b', 'c', 'c'];
    const m = v.reduce((x, y) => x + y) / 6;
    const sums = [v[0] + v[1] - 2 * m, v[2] + v[3] - 2 * m, v[4] + v[5] - 2 * m];
    const se = Math.sqrt((3 / 2) * sums.reduce((x, y) => x + y * y, 0)) / 6;
    expect(clusterSe(v, w).se).toBeCloseTo(se, 15);
    expect(clusterSe(v, w).se).not.toBeCloseTo(Math.sqrt(sums.reduce((x, y) => x + y * y, 0)) / 6, 6);
  });
  test('길이 불일치·iters 0 은 오류, NaN 은 무시', () => {
    expect(() => clusterBootstrapCI([1], [], 10, 1)).toThrow();
    expect(() => clusterBootstrapCI([1], ['a'], 0, 1)).toThrow();
    expect(clusterBootstrapCI([NaN, 0.1, 0.2], ['a', 'a', 'b'], 50, 1).n).toBe(2);
  });
});

describe('sharpe·MDD·연수익', () => {
  test('MDD 는 보유 중 평가손 포함: 100→10→110 이면 90%(T-072 F04 재발 방지)', () => {
    expect(maxDrawdown([100, 10, 110])).toBeCloseTo(0.9, 12);
    expect(maxDrawdown([100, 110, 120])).toBe(0);
    expect(maxDrawdown([100, 50, 120, 90])).toBeCloseTo(0.5, 12);
    expect(maxDrawdown([100, 120, 90, 130, 117])).toBeCloseTo(0.25, 12);
  });
  test('샤프: 분산 0·점 부족이면 0, 일정 상승+변동이면 양수', () => {
    expect(sharpe([100, 100, 100], 252)).toBe(0);
    expect(sharpe([100], 252)).toBe(0);
    expect(sharpe([100, 101, 100.5, 102, 101.8, 103], 252)).toBeGreaterThan(0);
    const r = [0.01, -0.005, 0.02];
    const eq = [100]; for (const x of r) eq.push(eq[eq.length - 1] * (1 + x));
    const m = r.reduce((a, b) => a + b) / 3; const sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / 2);
    expect(sharpe(eq, 252)).toBeCloseTo((m / sd) * Math.sqrt(252), 10);
  });
  test('연수익: 252일 10% → 0.1', () => {
    const v = Array.from({ length: 253 }, (_, i) => 1.1 ** (i / 252));
    expect(annualizedReturn(v, 252)).toBeCloseTo(0.1, 10);
    expect(annualizedReturn([1], 252)).toBeNull();
  });
  test('폴드: 양(+) 폴드 수·한 폴드 이익 비중', () => {
    const eps = [ep('A', '2025-01-10', 0.03, 0.01), ep('A', '2025-04-10', 0.01, 0.002), ep('A', '2025-07-10', -0.01, -0.005)];
    const folds = [
      { trainTo: '2024-12-31', testFrom: '2025-01-01', testTo: '2025-03-31' },
      { trainTo: '2025-03-31', testFrom: '2025-04-01', testTo: '2025-06-30' },
      { trainTo: '2025-06-30', testFrom: '2025-07-01', testTo: '2025-09-30' },
    ];
    const f = foldStats(eps, folds, 5);
    expect(f.positive).toBe(2);
    expect(f.maxProfitShare).toBeCloseTo(0.03 / 0.03, 12);
    expect(foldStats([ep('A', '2025-01-10', -0.01, -0.01)], folds, 5).maxProfitShare).toBeNull();
    // M43: 평균 초과수익이 정확히 0 인 폴드는 양(+)이 아니다(> 0)
    const zero = [ep('A', '2025-01-10', 0.01, 0.01), ep('A', '2025-04-10', 0.01, 0), ep('A', '2025-07-10', 0.01, 0.02)];
    expect(foldStats(zero, folds, 5).positive).toBe(2);
  });
});

describe('레짐 — 유니버스 동일가중 지수 ≥ MA100 일 때만 진입', () => {
  test('지수는 그날까지의 수익만으로 만든다, MA 점 부족이면 false', () => {
    const fs = [flatFrame('A', '2025-01-06', 150, 100), flatFrame('B', '2025-01-06', 150, 50)];
    const idx = universeIndex(fs);
    expect(idx.values.every((v) => v === 100)).toBe(true);
    expect(regimeOk(idx, 98, 100)).toBe(false);
    expect(regimeOk(idx, 99, 100)).toBe(true); // 100 ≥ 100 (경계는 진입 허용: 금지 조건이 '<')
  });
  test('하락 지수 → false, 상승 → true, 미래 값 미사용(regimeOkAt 은 그 날짜 이하만)', () => {
    const dates = weekdays('2025-01-06', 130);
    const down = frame('D', dates.map((d, i) => bar(d, 100, 100, 100, 100 * 0.999 ** i)));
    const up = frame('U', dates.map((d, i) => bar(d, 100, 100, 100, 100 * 1.001 ** i)));
    expect(regimeOk(universeIndex([down]), 120, 100)).toBe(false);
    expect(regimeOk(universeIndex([up]), 120, 100)).toBe(true);
    const idx = universeIndex([up]);
    const cut = { dates: idx.dates.slice(0, 121), values: idx.values.slice(0, 121) };
    expect(regimeOkAt(idx, dates[120], 100)).toBe(regimeOkAt(cut, dates[120], 100));
    expect(regimeOkAt(idx, '2020-01-01', 100)).toBe(false);
  });
});

describe('포트폴리오 시뮬 — 불변식', () => {
  const ZERO: CostModel = { feeRoundTrip: 0, slippage: 0, stopSlippage: 0 };
  const US: CostModel = { feeRoundTrip: 0.005, slippage: 0.0015, stopSlippage: 0.0025 };
  const base = (o: Partial<PortfolioConfig> = {}): PortfolioConfig => ({
    capital: 1000, slots: 1, slotPct: 1, hold: 10, stopPct: null, cost: ZERO, gapUp: 0.02, gapDown: 0.03, gapBoundary: 'skip', adtvWindow: 20, adtvMaxShare: 0.001,
    integerShares: true, cooldownBars: 0,
    startDate: '2000-01-01', endDate: '2100-01-01', ...o,
  });
  const dates = weekdays('2025-01-06', 40);

  test('MDD 가 보유 중 평가손을 반영: 가격 100→10→110 이면 일별 가치 MDD 90%', () => {
    const closes = dates.map((_, k) => (k <= 21 ? 100 : k === 22 ? 10 : 110));
    const f = frame('A', dates.map((d, k) => bar(d, k === 21 ? 100 : closes[k], 200, 5, closes[k])));
    const s = simulate([f], new Map([[dates[20], [{ symbol: 'A', d0: dates[20], d0Index: 20, score: 0 }]]]), base({ hold: 15 }));
    expect(s.entries).toBe(1);
    expect(maxDrawdown(s.equity.values)).toBeCloseTo(0.9, 10);
  });

  test('현금 ≥ 0·슬롯 ≤ N·정수 주식·1주 > 슬롯은 priceAboveSlot', () => {
    const syms = ['A', 'B', 'C', 'D'];
    const fs = syms.map((s, j) => frame(s, dates.map((d) => bar(d, j === 3 ? 5000 : 100 + j, 6000, 1, j === 3 ? 5000 : 100 + j))));
    const sigs = syms.map((s, j) => ({ symbol: s, d0: dates[20], d0Index: 20, score: j }));
    const r = simulate(fs, new Map([[dates[20], sigs]]), base({ capital: 10000, slots: 4, slotPct: 0.25, cost: US }));
    expect(r.entries).toBe(3);
    expect(r.skipped.priceAboveSlot).toBe(1);
    for (const t of r.trades) expect(Number.isInteger(t.shares)).toBe(true);
    for (const o of r.open) expect(Number.isInteger(o.shares)).toBe(true);
    expect(Math.min(...r.equity.values)).toBeGreaterThan(0);
  });

  test('신호가 빈 슬롯보다 많으면 순위(score 작은 순, 동률 종목코드)로 고르고 나머지는 noSlot — 결정적', () => {
    const syms = ['C', 'A', 'B'];
    const fs = syms.map((s) => frame(s, dates.map((d) => bar(d, 100, 101, 99, 100))));
    const sigs = [{ symbol: 'C', d0: dates[20], d0Index: 20, score: 1 }, { symbol: 'A', d0: dates[20], d0Index: 20, score: 2 }, { symbol: 'B', d0: dates[20], d0Index: 20, score: 1 }];
    const run = (list: Signal[]) => simulate(fs, new Map([[dates[20], list]]), base({ capital: 1000, slots: 2, slotPct: 0.5 }));
    const r1 = run(sigs), r2 = run([...sigs].reverse());
    expect(r1.trades.map((o) => o.symbol).sort()).toEqual(['B', 'C']);
    expect(r1.skipped.noSlot).toBe(1);
    expect(r2.trades).toEqual(r1.trades);
  });

  test('손절은 진입 당일부터, 청산 비용 반영(pnl = 매도 대금 − 매수 대금)', () => {
    const f = frame('A', dates.map((d, k) => bar(d, 100, 100, k === 22 ? 90 : 99.5, 100)));
    const r = simulate([f], new Map([[dates[20], [{ symbol: 'A', d0: dates[20], d0Index: 20, score: 0 }]]]), base({ stopPct: 0.05, cost: US }));
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].exitKind).toBe('stop');
    expect(r.trades[0].exitPrice).toBeCloseTo(95, 10);
    expect(r.trades[0].netRet).toBeCloseTo(-0.05 - 0.0075, 10);
    const t = r.trades[0];
    expect(t.pnl).toBeCloseTo(t.shares * 95 * (1 - (0.0075 - 0.00325)) - t.shares * 100 * (1 + 0.00325), 8);
  });

  test('보유 중 같은 종목 재신호는 무시, 진입 갭·유동성 필터 적용', () => {
    const f = frame('A', dates.map((d, k) => bar(d, k === 26 ? 110 : 100, 120, 99, 100)));
    const m = new Map<string, Signal[]>();
    m.set(dates[20], [{ symbol: 'A', d0: dates[20], d0Index: 20, score: 0 }]);
    m.set(dates[22], [{ symbol: 'A', d0: dates[22], d0Index: 22, score: 0 }]);
    m.set(dates[25], [{ symbol: 'A', d0: dates[25], d0Index: 25, score: 0 }]);
    const r = simulate([f], m, base({ hold: 3 }));
    expect(r.entries).toBe(1);
    expect(r.skipped.gap).toBe(1);
  });

  test('M53: 진입 당일 저가가 손절선 이하면 진입 당일 손절', () => {
    const f = frame('A', dates.map((d, k) => bar(d, 100, 100, k === 21 ? 90 : 99.5, 100)));
    const r = simulate([f], new Map([[dates[20], [{ symbol: 'A', d0: dates[20], d0Index: 20, score: 0 }]]]), base({ stopPct: 0.05 }));
    expect(r.trades[0].exitKind).toBe('stop');
    expect(r.trades[0].exitDate).toBe(dates[21]);
    expect(r.trades[0].entryDate).toBe(dates[21]);
  });

  test('⑧ 재발화 차단(포트폴리오 = 에피소드 규칙): 손절 다음 날 재신호는 cooldown, 차단 창 뒤 재신호는 진입', () => {
    const f = frame('A', dates.map((d, k) => bar(d, 100, 100, k === 21 ? 90 : 99.5, 100)));
    const m = new Map<string, Signal[]>();
    for (const k of [20, 22, 25, 26]) m.set(dates[k], [{ symbol: 'A', d0: dates[k], d0Index: k, score: 0 }]);
    // cooldownBars = max(5, hold 5) = 5: 22(Δ2)·25(Δ5) 차단, 26(Δ6) 새 에피소드 → 진입
    const r = simulate([f], m, base({ stopPct: 0.05, hold: 5, cooldownBars: 5 }));
    expect(r.skipped.cooldown).toBe(2);
    expect(r.entries).toBe(2);
    expect(r.trades.map((t) => t.d0)).toEqual([dates[20], dates[26]]);
    // 끄면(0) 손절 뒤 바로 재진입 가능(v1.0 동작)
    const r0 = simulate([f], m, base({ stopPct: 0.05, hold: 5, cooldownBars: 0 }));
    expect(r0.skipped.cooldown).toBe(0);
    expect(r0.trades[1].d0).toBe(dates[22]); // 손절 다음 날(22) 신호로 바로 재진입
  });

  test('integerShares=false(registry 배선)면 분수 수량, true 면 정수', () => {
    const f = frame('A', dates.map((d) => bar(d, 300, 301, 299, 300)));
    const m = new Map([[dates[20], [{ symbol: 'A', d0: dates[20], d0Index: 20, score: 0 }]]]);
    const fr = simulate([f], m, base({ capital: 1000, integerShares: false }));
    expect(fr.trades[0].shares).toBeCloseTo(1000 / 300, 10);
    const it = simulate([f], m, base({ capital: 1000, integerShares: true }));
    expect(it.trades[0].shares).toBe(3);
  });

  test('설정 검증', () => {
    expect(() => simulate([], new Map(), base({ slots: 0 }))).toThrow();
    expect(() => simulate([], new Map(), base({ slotPct: 1.5 }))).toThrow();
    expect(() => simulate([], new Map(), base({ hold: 0 }))).toThrow();
    expect(() => simulate([], new Map(), base({ cooldownBars: -1 }))).toThrow();
  });
});
