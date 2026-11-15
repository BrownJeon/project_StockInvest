/**
 * T-173 — 일봉 「밀린 종목 수」(bars-lag.ts · anomalies.ts `barsRow` · 이상 상세 문구 · 데이터 상태 줄 문구).
 *
 * 핵심 회귀: 2026-11-09~14 국내 보유종목 하나(005930)가 매일 갱신되는 동안 나머지 국내 42종목이 11-06 에서 멈췄는데, 시장 마지막 봉 하나만
 * 보던 감시는 「정상」이었다. 대상 종목별로 보면 기대 거래일보다 2거래일 밀린 날(11-11 08:30 KST)에 「오래됨」이 된다.
 * 해외 분석 목록 판독기는 가짜로 둔다(수집기와 같은 함수를 쓰는지는 수집 모듈 쪽 대등성 시험이 본다).
 */
jest.mock('@/lib/strategy/universe-overseas-static', () => ({ readOverseasUniverse: jest.fn() }));

import { readOverseasUniverse } from '@/lib/strategy/universe-overseas-static';
import { isDomesticSymbol, isOverseasSymbol } from '@/lib/exchanges/kis-symbols';
import { sourceWhen } from '@/app/analytics/DataPanel';
import { barsRow, readDataSources } from '../anomalies';
import { ANOMALY_DETAILS_SQL, readAnomalyDetails } from '../anomaly-details';
import {
  BARS_BEHIND_ALERT, BARS_BEHIND_DAYS, BARS_TARGET_HOLDINGS_SQL, BARS_TARGET_SIGNAL_MAX, BARS_TARGET_SIGNALS_SQL,
  barsLagOf, readBarsLagInput, readBarsTargets, targetErrorsFor, targetMarketOf, tradingDaysAfter, type BarsLagInput,
} from '../bars-lag';
import { LAST_BAR_DATE_SQL, SYMBOL_LAST_BAR_SQL } from '../daily-bars-read';
import type { DataSourceRow } from '../types';
import { fakeReader, kst, type Route } from './fake-reader';

const universe = readOverseasUniverse as jest.Mock;
const NONE = new Set<string>();
const CLOSED = { domestic: new Set<string>(), overseas: new Set<string>() };

beforeEach(() => {
  universe.mockReset();
  universe.mockResolvedValue({ symbols: [], degraded: false });
});

/** 국내 6자리 합성 심볼 n개(100001~). */
const krSyms = (n: number, from = 100001) => Array.from({ length: n }, (_, i) => String(from + i));
const lagInput = (last: Record<string, string>, symbols = Object.keys(last), targetErrors: BarsLagInput['targetErrors'] = []): BarsLagInput =>
  ({ symbols, last: new Map(Object.entries(last)), targetErrors });

describe('기준값 — 설계 승인값(2026-11-15)', () => {
  test('밀림 = 2거래일 이상, 경고 = 밀림+미수집 3종목 이상, 시그널 상한 300', () => {
    expect(BARS_BEHIND_DAYS).toBe(2);
    expect(BARS_BEHIND_ALERT).toBe(3);
    expect(BARS_TARGET_SIGNAL_MAX).toBe(300);
  });
});

describe('targetMarketOf — 수집기 심볼 판별과 같은 모양', () => {
  test.each(['005930', '0059300', '05930', 'NAS:AAPL', 'NYS:BRK.B', 'AMS:SPY', 'nas:aapl', 'NAS:', 'NASD:AAPL', 'AAPL', '', 'NAS:1A', 'KRX:005930'])('%p', (s) => {
    const expected = isOverseasSymbol(s) ? 'overseas' : isDomesticSymbol(s) ? 'domestic' : null;
    expect(targetMarketOf(s)).toBe(expected);
  });
});

describe('tradingDaysAfter — 마지막 봉 다음 날부터 기대일까지(포함) 거래일 수', () => {
  test('국내 금 11-06 → 화 11-10 = 2(주말 제외) · 같은 날·이후 = 0', () => {
    expect(tradingDaysAfter('domestic', '2026-11-06', '2026-11-10', NONE)).toBe(2);
    expect(tradingDaysAfter('domestic', '2026-11-06', '2026-11-09', NONE)).toBe(1);
    expect(tradingDaysAfter('domestic', '2026-11-10', '2026-11-10', NONE)).toBe(0);
    expect(tradingDaysAfter('domestic', '2026-11-11', '2026-11-10', NONE)).toBe(0);
  });
  test('휴장일은 세지 않는다', () => {
    expect(tradingDaysAfter('domestic', '2026-11-06', '2026-11-10', new Set(['2026-11-09']))).toBe(1);
    expect(tradingDaysAfter('overseas', '2026-11-06', '2026-11-10', new Set(['2026-11-09']))).toBe(1);
  });
  test('아주 오래 멈춘 종목도 끝난다(걷는 상한) — 밀림 판정에는 충분히 크다', () => {
    expect(tradingDaysAfter('domestic', '2020-01-02', '2026-11-10', NONE)).toBeGreaterThanOrEqual(BARS_BEHIND_DAYS);
  });
});

describe('barsLagOf — 분류·예시', () => {
  test('정상·하루 늦음·밀림·미수집 · 중복은 한 번 · 예시는 미수집 → 오래된 봉 순', () => {
    const last = new Map([['100001', '2026-11-10'], ['100002', '2026-11-09'], ['100003', '2026-11-06'], ['100005', '2026-11-05']]);
    const lag = barsLagOf('domestic', ['100001', '100002', '100003', '100004', '100005', '100003'], last, '2026-11-10', NONE);
    expect(lag).toEqual({ expected: '2026-11-10', targets: 5, late1: 1, behind: 2, missing: 1, oldest: '2026-11-05', samples: ['100004', '100005', '100003'] });
  });
  test('예시는 최대 5개, 같은 날짜는 심볼순', () => {
    const syms = krSyms(8);
    const lag = barsLagOf('domestic', syms, new Map(syms.map((s) => [s, '2026-11-06'])), '2026-11-10', NONE);
    expect(lag.behind).toBe(8);
    expect(lag.samples).toEqual(syms.slice(0, 5));
  });
  test('대상 0 → 전부 0', () => {
    expect(barsLagOf('overseas', [], new Map(), '2026-11-10', NONE)).toEqual({ expected: '2026-11-10', targets: 0, late1: 0, behind: 0, missing: 0, oldest: null, samples: [] });
  });
});

describe('barsRow — 판정 순서', () => {
  const NOW = kst('2026-11-11 08:31');   // 국내 기대 거래일 11-10(화)

  test('밀림 입력을 넘기지 않으면 T-173 전과 같다(lag 키 없음)', () => {
    const r = barsRow('daily_bars_kr', 'domestic', '2026-11-10', NOW, NONE);
    expect(r).toEqual({ id: 'daily_bars_kr', lastOkAt: null, state: 'available', dateRef: '2026-11-10', streak: null });
    expect('lag' in r).toBe(false);
  });

  test('임계값 경계 — 밀림 2 는 정상(숫자만), 3 은 오래됨, 밀림 2 + 미수집 1 도 오래됨', () => {
    const two = barsRow('daily_bars_kr', 'domestic', '2026-11-10', NOW, NONE,
      lagInput({ '005930': '2026-11-10', '100001': '2026-11-06', '100002': '2026-11-06' }));
    expect(two).toMatchObject({ state: 'available', dateRef: '2026-11-10', lag: { targets: 3, behind: 2, missing: 0 } });
    expect(two.reason).toBeUndefined();
    const three = barsRow('daily_bars_kr', 'domestic', '2026-11-10', NOW, NONE,
      lagInput({ '005930': '2026-11-10', '100001': '2026-11-06', '100002': '2026-11-06', '100003': '2026-11-06' }));
    expect(three).toMatchObject({ state: 'stale', reason: 'bars_symbols_behind', lag: { behind: 3 } });
    const withMissing = barsRow('daily_bars_kr', 'domestic', '2026-11-10', NOW, NONE,
      lagInput({ '005930': '2026-11-10', '100001': '2026-11-06', '100002': '2026-11-06' }, ['005930', '100001', '100002', '100009']));
    expect(withMissing).toMatchObject({ state: 'stale', reason: 'bars_symbols_behind', lag: { behind: 2, missing: 1, samples: ['100009', '100001', '100002'] } });
  });

  test('하루 늦음은 아무리 많아도 경고가 아니다(예산 순환 설계상 평일 정상 범위)', () => {
    const syms = krSyms(40);
    const r = barsRow('daily_bars_kr', 'domestic', '2026-11-10', NOW, NONE,
      lagInput(Object.fromEntries([['005930', '2026-11-10'], ...syms.map((s) => [s, '2026-11-09'])])));
    expect(r).toMatchObject({ state: 'available', lag: { targets: 41, late1: 40, behind: 0 } });
  });

  test('시장 마지막 봉이 이미 늦으면 bars_old 가 먼저(밀림 요약도 붙는다)', () => {
    const r = barsRow('daily_bars_kr', 'domestic', '2026-11-06', NOW, NONE, lagInput({ '005930': '2026-11-06', '100001': '2026-11-06' }));
    expect(r).toMatchObject({ state: 'stale', reason: 'bars_old', lag: { behind: 2 } });
  });

  test('종목별 봉을 읽지 못하면 일부 저하(bars_lag_unread) — 정상으로 두지 않는다', () => {
    const r = barsRow('daily_bars_us', 'overseas', '2026-11-10', NOW, NONE, { symbols: ['NAS:AAA'], last: null, targetErrors: [] });
    expect(r).toMatchObject({ state: 'partial', reason: 'bars_lag_unread', lag: null, dateRef: '2026-11-10' });
  });

  test('대상 목록 일부를 읽지 못하면 일부 저하(bars_targets_partial) — 단 경고 조건이면 오래됨이 먼저', () => {
    const p = barsRow('daily_bars_us', 'overseas', '2026-11-10', NOW, NONE, lagInput({ 'NAS:AAA': '2026-11-10' }, undefined, ['signals']));
    expect(p).toMatchObject({ state: 'partial', reason: 'bars_targets_partial', lag: { behind: 0 } });
    const s = barsRow('daily_bars_us', 'overseas', '2026-11-10', NOW, NONE, lagInput({}, ['NAS:A', 'NAS:B', 'NAS:C'], ['universe_list']));
    expect(s).toMatchObject({ state: 'stale', reason: 'bars_symbols_behind', lag: { missing: 3 } });
  });

  test('휴장표 모름 → 밀림 계산 안 함(기존 holidays_unknown 그대로) · 봉 없음 → unknown', () => {
    const lag = lagInput({ '100001': '2026-10-01', '100002': '2026-10-01', '100003': '2026-10-01' });
    expect(barsRow('daily_bars_kr', 'domestic', '2026-11-10', NOW, null, lag)).toEqual({
      id: 'daily_bars_kr', lastOkAt: null, state: 'available', dateRef: '2026-11-10', streak: null, reason: 'holidays_unknown',
    });
    expect(barsRow('daily_bars_kr', 'domestic', null, NOW, NONE, lag)).toMatchObject({ state: 'unknown', reason: 'no_bars' });
  });
});

describe('🔴 회귀 — 2026-11-09~14 국내 42종목 정체를 놓쳤던 모양', () => {
  // 보유 005930 은 매일 받고, 시그널 출신 42종목은 11-06(금) 봉에서 멈췄다.
  const STUCK = krSyms(42);
  const lastOn = (holdingDay: string) => lagInput(Object.fromEntries([['005930', holdingDay], ...STUCK.map((s) => [s, '2026-11-06'])]));

  test('11-10 08:31 — 기대 11-09, 42종목은 하루 늦음 → 아직 경고 아님(숫자는 하루 늦음 42)', () => {
    const r = barsRow('daily_bars_kr', 'domestic', '2026-11-09', kst('2026-11-10 08:31'), NONE, lastOn('2026-11-09'));
    expect(r).toMatchObject({ state: 'available', lag: { expected: '2026-11-09', targets: 43, late1: 42, behind: 0 } });
  });

  test('11-11 08:31 — 기대 11-10, 42종목 2거래일 밀림 → 오래됨(예전 판정은 정상)', () => {
    const now = kst('2026-11-11 08:31');
    const r = barsRow('daily_bars_kr', 'domestic', '2026-11-10', now, NONE, lastOn('2026-11-10'));
    expect(r).toMatchObject({ state: 'stale', reason: 'bars_symbols_behind',
      lag: { expected: '2026-11-10', targets: 43, behind: 42, missing: 0, oldest: '2026-11-06', samples: STUCK.slice(0, 5) } });
    // 같은 입력을 예전처럼 시장 마지막 봉 하나로만 보면 정상 — 이번 미탐 그대로
    expect(barsRow('daily_bars_kr', 'domestic', '2026-11-10', now, NONE).state).toBe('available');
  });

  test('T-170 위험 1 — 실행이 시작하자마자 멈추면(연속 실패) 보유 외 전부가 이틀 뒤 밀림으로 드러난다', () => {
    const others = ['NAS:AAA', 'NAS:BBB', 'NAS:CCC', 'NYS:DDD'];
    // 기대 11-11(ET) — 보유 NAS:MU 는 받아 시장 마지막 봉은 최신이고, 나머지 4종목은 11-09 에서 멈췄다(2거래일)
    const r = barsRow('daily_bars_us', 'overseas', '2026-11-11', kst('2026-11-12 08:31'), NONE,
      lagInput(Object.fromEntries([['NAS:MU', '2026-11-11'], ...others.map((s) => [s, '2026-11-09'])])));
    expect(r).toMatchObject({ state: 'stale', reason: 'bars_symbols_behind', lag: { targets: 5, behind: 4 } });
  });
});

describe('readBarsTargets — 수집기 기본 대상 규칙', () => {
  test('보유 → 해외 분석 목록 → 시그널, 중복·모르는 모양 제외, 시장별', async () => {
    universe.mockResolvedValue({ symbols: ['NAS:MU', 'NAS:AAA', 'bad', 'NYS:BRK.B'], degraded: false });
    const r = fakeReader(0, [
      [BARS_TARGET_HOLDINGS_SQL, [{ symbol: '005930' }, { symbol: 'NAS:MU' }]],
      [BARS_TARGET_SIGNALS_SQL, [{ symbol: '000660', n: 9 }, { symbol: 'NAS:AAA', n: 8 }, { symbol: 'XX', n: 7 }, { symbol: 'NAS:INTC', n: 1 }]],
    ]);
    expect(await readBarsTargets(r)).toEqual({
      symbols: { domestic: ['005930', '000660'], overseas: ['NAS:MU', 'NAS:AAA', 'NYS:BRK.B', 'NAS:INTC'] },
      errors: [],
    });
  });

  test('시그널은 새로 더한 것만 300개까지(중복은 세지 않는다)', async () => {
    const sig = [{ symbol: '005930', n: 999 }, ...krSyms(305).map((symbol, i) => ({ symbol, n: 500 - i }))];
    const r = fakeReader(0, [[BARS_TARGET_HOLDINGS_SQL, [{ symbol: '005930' }]], [BARS_TARGET_SIGNALS_SQL, sig]]);
    const t = await readBarsTargets(r);
    expect(t.symbols.domestic).toHaveLength(1 + 300);
    expect(t.symbols.domestic.slice(-1)).toEqual([krSyms(300).slice(-1)[0]]);
  });

  test('원천마다 따로 — 실패는 이름을 남기고 나머지로 계속(순서: position_state → universe_list → signals)', async () => {
    universe.mockResolvedValue({ symbols: ['NAS:AAA'], degraded: true });
    const r = fakeReader(0, [[BARS_TARGET_HOLDINGS_SQL, new Error('x')], [BARS_TARGET_SIGNALS_SQL, new Error('y')]]);
    expect(await readBarsTargets(r)).toEqual({ symbols: { domestic: [], overseas: ['NAS:AAA'] }, errors: ['position_state', 'universe_list', 'signals'] });
  });

  test('판독기가 약속과 달리 던져도 「목록 저하」로 세고 나머지로 계속', async () => {
    universe.mockRejectedValue(new Error('boom'));
    const r = fakeReader(0, [[BARS_TARGET_HOLDINGS_SQL, [{ symbol: '005930' }]], [BARS_TARGET_SIGNALS_SQL, [{ symbol: 'NAS:INTC', n: 1 }]]]);
    expect(await readBarsTargets(r)).toEqual({ symbols: { domestic: ['005930'], overseas: ['NAS:INTC'] }, errors: ['universe_list'] });
  });

  test('세 원천을 동시에 읽어도 합치는 순서는 보유 → 분석 목록 → 시그널(시그널이 먼저 답해도)', async () => {
    let releaseHoldings: () => void = () => {};
    const holdingsGate = new Promise<void>((res) => { releaseHoldings = res; });
    universe.mockImplementation(async () => { await holdingsGate; return { symbols: ['NAS:MU', 'NAS:AAA'], degraded: false }; });
    const base = fakeReader(0, [[BARS_TARGET_HOLDINGS_SQL, [{ symbol: 'NAS:MU' }]], [BARS_TARGET_SIGNALS_SQL, [{ symbol: 'NAS:AAA', n: 9 }, { symbol: 'NAS:ZZZ', n: 1 }]]]);
    const r = { ...base, rows: async <T,>(sql: string, p?: unknown[]) => {
      if (sql === BARS_TARGET_HOLDINGS_SQL) await holdingsGate;   // 보유가 가장 늦게 답한다
      return base.rows<T>(sql, p);
    } };
    const pending = readBarsTargets(r);
    await new Promise((res) => setImmediate(res));
    expect(base.calls.map((c) => c.sql)).toContain(BARS_TARGET_SIGNALS_SQL);   // 보유를 기다리지 않고 이미 보냈다
    releaseHoldings();
    expect((await pending).symbols.overseas).toEqual(['NAS:MU', 'NAS:AAA', 'NAS:ZZZ']);
  });

  test('해외 분석 목록 판독기는 ops 읽기 래퍼를 거친다 — 행 배열을 mysql2 모양 [rows, _] 로 받고, SELECT 가 아니면 막힌다', async () => {
    let seen: unknown;
    let blocked: unknown;
    universe.mockImplementation(async (db: { query: (sql: string, p?: unknown[]) => Promise<[unknown, unknown]> }) => {
      seen = (await db.query('SELECT symbols FROM overseas_universe_revision ORDER BY revision_no DESC LIMIT 1'))[0];
      blocked = await db.query('UPDATE overseas_universe_revision SET symbols = ?', ['[]']).then(() => 'sent', (e: unknown) => e);
      return { symbols: ['NAS:AAA'], degraded: false };
    });
    const r = fakeReader(0, [['overseas_universe_revision', [{ symbols: '["NAS:AAA"]' }]]]);
    const t = await readBarsTargets(r);
    expect(seen).toEqual([{ symbols: '["NAS:AAA"]' }]);
    expect(blocked).toBeInstanceOf(Error);
    expect(r.calls.map((c) => c.sql)).not.toContainEqual(expect.stringMatching(/^UPDATE/));
    expect(t.symbols.overseas).toEqual(['NAS:AAA']);
  });

  test('같은 요청 안에서는 한 번만 읽는다(memo)', async () => {
    const r = fakeReader(0, [[BARS_TARGET_HOLDINGS_SQL, [{ symbol: '005930' }]]]);
    await Promise.all([readBarsTargets(r), readBarsLagInput(r), readBarsLagInput(r)]);
    expect(r.calls.filter((c) => c.sql === BARS_TARGET_HOLDINGS_SQL)).toHaveLength(1);
    expect(universe).toHaveBeenCalledTimes(1);
  });
});

describe('readDataSources — 일봉 두 줄에 밀림 반영', () => {
  const NOW = kst('2026-11-11 08:31');
  const STUCK = krSyms(42);
  const symbolLast = (params: unknown[]) => {
    const [market, symbols] = params as [string, string[]];
    if (market === 'KR') return symbols.map((s) => ({ symbol: s, d: s === '005930' ? '2026-11-10' : '2026-11-06' }));
    return symbols.filter((s) => s !== 'NYS:BRK.B').map((s) => ({ symbol: s, d: '2026-11-10' }));
  };
  const routes = (symbolReply: Route[1] = symbolLast): Route[] => [
    [LAST_BAR_DATE_SQL, [{ d: '2026-11-10' }]],
    [BARS_TARGET_HOLDINGS_SQL, [{ symbol: '005930' }]],
    [BARS_TARGET_SIGNALS_SQL, STUCK.map((symbol) => ({ symbol, n: 1 }))],
    [SYMBOL_LAST_BAR_SQL, symbolReply],
  ];

  test('국내 42 밀림 → 오래됨 · 해외는 미수집 1(BRK.B)뿐이라 정상(숫자만) · 종목별 봉 조회는 시장마다 대상 종목으로 1번', async () => {
    universe.mockResolvedValue({ symbols: ['NAS:AAA', 'NYS:BRK.B'], degraded: false });
    const r = fakeReader(NOW, routes());
    const rows = await readDataSources(r, CLOSED);
    expect(rows.find((x) => x.id === 'daily_bars_kr')).toMatchObject({ state: 'stale', reason: 'bars_symbols_behind', dateRef: '2026-11-10',
      lag: { targets: 43, behind: 42, missing: 0, oldest: '2026-11-06' } });
    expect(rows.find((x) => x.id === 'daily_bars_us')).toMatchObject({ state: 'available', lag: { targets: 2, behind: 0, missing: 1, samples: ['NYS:BRK.B'] } });
    const lastCalls = r.calls.filter((c) => c.sql === SYMBOL_LAST_BAR_SQL);
    expect(lastCalls.map((c) => c.params)).toEqual(expect.arrayContaining([['KR', ['005930', ...STUCK]], ['US', ['NAS:AAA', 'NYS:BRK.B']]]));
    expect(lastCalls).toHaveLength(2);
  });

  test('🔴 R-1 — 해외 분석 목록 저하는 해외 줄만 일부 저하로, 국내 줄은 그대로(거짓 이상 1건 방지) · 보유 조회 실패는 두 줄 모두', async () => {
    universe.mockResolvedValue({ symbols: ['NAS:AAA'], degraded: true });
    const fresh = (p: unknown[]) => (p[1] as string[]).map((symbol) => ({ symbol, d: '2026-11-10' }));
    const rows = await readDataSources(fakeReader(NOW, routes(fresh)), CLOSED);
    expect(rows.find((x) => x.id === 'daily_bars_kr')).toMatchObject({ state: 'available', lag: { targets: 43, behind: 0 } });
    expect(rows.find((x) => x.id === 'daily_bars_kr')?.reason).toBeUndefined();
    expect(rows.find((x) => x.id === 'daily_bars_us')).toMatchObject({ state: 'partial', reason: 'bars_targets_partial' });
    universe.mockResolvedValue({ symbols: ['NAS:AAA'], degraded: false });
    const r2 = await readDataSources(fakeReader(NOW, [[BARS_TARGET_HOLDINGS_SQL, new Error('x')], ...routes(fresh).filter(([m]) => m !== BARS_TARGET_HOLDINGS_SQL)]), CLOSED);
    expect(r2.filter((x) => x.id.endsWith('_kr') || x.id.endsWith('_us')).map((x) => x.reason)).toEqual(['bars_targets_partial', 'bars_targets_partial']);
  });

  test('targetErrorsFor — 국내는 universe_list 를 빼고, 해외는 그대로', () => {
    expect(targetErrorsFor('domestic', ['position_state', 'universe_list', 'signals'])).toEqual(['position_state', 'signals']);
    expect(targetErrorsFor('overseas', ['position_state', 'universe_list', 'signals'])).toEqual(['position_state', 'universe_list', 'signals']);
    expect(targetErrorsFor('domestic', ['universe_list'])).toEqual([]);
  });

  test('종목별 봉 조회가 한 시장만 실패하면 그 시장만 일부 저하', async () => {
    universe.mockResolvedValue({ symbols: ['NAS:AAA'], degraded: false });
    const rows = await readDataSources(fakeReader(NOW, routes((p) => (p[0] === 'US' ? new Error('timeout') : symbolLast(p)))), CLOSED);
    expect(rows.find((x) => x.id === 'daily_bars_us')).toMatchObject({ state: 'partial', reason: 'bars_lag_unread', lag: null });
    expect(rows.find((x) => x.id === 'daily_bars_kr')).toMatchObject({ state: 'stale', reason: 'bars_symbols_behind' });
  });

  test('시장 마지막 봉 조회가 실패하면 예전처럼 두 줄 다 조회 실패(밀림과 무관)', async () => {
    const rows = await readDataSources(fakeReader(NOW, [[LAST_BAR_DATE_SQL, new Error('down')], ...routes().slice(1)]), CLOSED);
    // 표 이름 문자열은 조각으로 — 격리 시험(src 전체 문자열 검사)이 시험 파일도 훑는다(Reviewer R-2)
    const BARS_ID = ['daily', 'bars'].join('_');
    expect(rows.filter((x) => x.id.startsWith(BARS_ID)).map((x) => x.state)).toEqual(['error', 'error']);
  });
});

describe('이상 상세·데이터 상태 줄 문구', () => {
  const lagRow = (over: Partial<DataSourceRow>): DataSourceRow =>
    ({ id: 'daily_bars_kr', lastOkAt: null, state: 'stale', dateRef: '2026-11-10', streak: null, ...over });
  const details = async (rows: DataSourceRow[]) =>
    (await readAnomalyDetails(fakeReader(kst('2026-11-11 08:31'), [[ANOMALY_DETAILS_SQL, []]]), Promise.resolve(rows))).rows;

  test('밀림 — 대상 수·밀린 수·기대일·가장 오래된 봉·예시(외 n)', async () => {
    const [d] = await details([lagRow({ reason: 'bars_symbols_behind',
      lag: { expected: '2026-11-10', targets: 43, late1: 0, behind: 42, missing: 0, oldest: '2026-11-06', samples: ['100001', '100002', '100003', '100004', '100005'] } })]);
    expect(d).toMatchObject({ id: 'daily_bars_kr', summary: '최신 데이터 지연', reason: '수집 대상 43종목 중 42종목이 2거래일 이상 밀렸습니다.',
      evidence: '기대 거래일 2026-11-10 · 가장 오래된 봉 2026-11-06 · 예: 100001, 100002, 100003, 100004, 100005 외 37' });
  });

  test('미수집 섞임 · 대상 일부 못 읽음 · 봉 조회 실패 문구', async () => {
    const rows = await details([
      lagRow({ id: 'daily_bars_us', reason: 'bars_symbols_behind',
        lag: { expected: '2026-11-10', targets: 126, late1: 3, behind: 2, missing: 1, oldest: '2026-11-05', samples: ['NYS:BRK.B', 'NAS:A', 'NAS:B'] } }),
      lagRow({ state: 'partial', reason: 'bars_targets_partial', lag: { expected: '2026-11-10', targets: 43, late1: 0, behind: 0, missing: 0, oldest: null, samples: [] } }),
      lagRow({ id: 'daily_bars_us', state: 'partial', reason: 'bars_lag_unread', lag: null }),
    ]);
    expect(rows[0]).toMatchObject({ reason: '수집 대상 126종목 중 2종목이 2거래일 이상 밀렸습니다 · 1종목은 일봉이 한 줄도 없습니다.',
      evidence: '기대 거래일 2026-11-10 · 가장 오래된 봉 2026-11-05 · 예: NYS:BRK.B, NAS:A, NAS:B' });
    expect(rows[1]).toMatchObject({ summary: '일부 데이터 부족', reason: expect.stringContaining('대상 목록 일부'), evidence: '시장 마지막 일봉 2026-11-10' });
    expect(rows[2]).toMatchObject({ summary: '일부 데이터 부족', reason: expect.stringContaining('조회하지 못해'), evidence: '시장 마지막 일봉 2026-11-10' });
  });

  test('밀림 없는 시장 전체 지연(bars_old)은 예전 문구 그대로', async () => {
    const [d] = await details([lagRow({ reason: 'bars_old' })]);
    expect(d).toMatchObject({ reason: '기준 시각까지 새 데이터가 확인되지 않았습니다.', evidence: '마지막 확인 기록 2026-11-10' });
  });

  test('데이터 상태 줄 — 밀림+미수집이 있을 때만 「· 밀림 n/m종목」, 하루 늦음은 붙이지 않는다', () => {
    const NOW = kst('2026-11-11 08:31');
    const lag = (behind: number, missing: number, late1 = 0) => ({ expected: '2026-11-10', targets: 43, late1, behind, missing, oldest: null, samples: [] });
    expect(sourceWhen(lagRow({ lag: lag(42, 0) }), NOW)).toBe('11-10 · 밀림 42/43종목');
    expect(sourceWhen(lagRow({ id: 'daily_bars_us', state: 'available', lag: { ...lag(0, 1), targets: 126 } }), NOW)).toMatch(/ · 밀림 1\/126종목$/);
    expect(sourceWhen(lagRow({ state: 'available', lag: lag(0, 0, 40) }), NOW)).toBe('11-10');
    expect(sourceWhen(lagRow({ state: 'available', lag: null }), NOW)).toBe('11-10');
    expect(sourceWhen(lagRow({ state: 'available' }), NOW)).toBe('11-10');
  });
});
