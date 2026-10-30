/**
 * T-108 청산 3줄(X1·X3·X4·X6) · 원천 신선도 · A3 사후 추적 · A4 — 순수 조립 함수 (가이드 §2.3.3·§2.3.5·§4.6·§4.7).
 */
jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));

import { ageRow, barsRow, buildAnomalies, expectedBarDate, newsRows } from '../anomalies';
import {
  consecutiveSessionDays, gapMetric, groupExitGates, lastEvalMetric, noRunMetric, summarizeProposals,
} from '../exit-lines';
import { homePostmortem, verifyPostmortemRows, type MarketSample } from '../postmortem-sample';
import { buyableMetric, readOrderMaxPct } from '../live-set';
import { fakeReader, kst } from './fake-reader';

const NONE = new Set<string>();

describe('X1 마지막 평가', () => {
  const run = (runs: number, last: string | null, reason: string | null = null) => ({ runs, lastMs: last ? kst(last) : null, lastReason: reason, balancesUnknown: 0 });
  it('장외(세션일 run 0행) → off_hours, 「이상 없음」과 다르다', () => {
    const m = lastEvalMetric('overseas', run(0, null), kst('2026-10-30 16:00'), NONE);
    expect(m.state).toBe('off_hours');
    expect(m.value).toMatchObject({ runsToday: 0, sessionOpen: false });
  });
  it('장 마감 뒤 국내 — 마지막 평가 시각 그대로(available, sessionOpen=false)', () => {
    const m = lastEvalMetric('domestic', run(57, '2026-10-30 15:25'), kst('2026-10-30 16:00'), NONE);
    expect(m).toMatchObject({ state: 'available', value: { at: '2026-10-30T15:25:00+09:00', runsToday: 57, sessionOpen: false } });
  });
  it('장중인데 마지막 평가 > 15분 → stale', () => {
    expect(lastEvalMetric('domestic', run(10, '2026-10-30 10:00'), kst('2026-10-30 10:20'), NONE).state).toBe('stale');
  });
  it('마지막 틱이 잔고 미확인 → error', () => {
    expect(lastEvalMetric('domestic', run(10, '2026-10-30 10:15', 'balances_unknown'), kst('2026-10-30 10:20'), NONE).state).toBe('error');
  });
  it('휴장표 모름 + run 0 → unknown(holidays_unknown) — 장외로 추정하지 않는다', () => {
    expect(lastEvalMetric('domestic', run(0, null), kst('2026-10-30 10:20'), null)).toMatchObject({ state: 'unknown', reason: 'holidays_unknown' });
  });
});

describe('X3 판정 — 종목 수·연속 일수', () => {
  it('게이트 → 종목 집합(틱 수는 손실한도 손절 OFF 만 병기), 미리보기 제외', () => {
    const g = groupExitGates([
      { gate: 'exit_hard_stop_disabled', verdict: 'skip', symbol: 'A', n: 55 },
      { gate: 'exit_no_fire', verdict: 'pass', symbol: 'B', n: 50 },
      { gate: 'exit_ticker_error', verdict: 'error', symbol: 'C', n: 2 },
      { gate: 'exit_create_failed', verdict: 'error', symbol: 'D', n: 1 },
      { gate: 'sell_proposal_preview', verdict: 'pass', symbol: 'E', n: 9 },
    ]);
    expect([...g.hardStopOff]).toEqual(['A']);
    expect(g.hardStopOffTicks).toBe(55);
    expect([...g.noFire]).toEqual(['B']);
    expect([...g.dataErrors]).toEqual(['C']);
    expect([...g.createFailed]).toEqual(['D']);
    expect(g.judged.has('E')).toBe(false);
  });
  it('연속 세션일 — run 없는 날(주말)은 건너뛰고, 끊기면 멈춘다', () => {
    const sessions = new Set(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
    const hits = new Set(['2026-10-28', '2026-10-29', '2026-10-30']);
    expect(consecutiveSessionDays(sessions, hits, '2026-10-30', '2026-10-01')).toEqual({ days: 3, capped: false });
    expect(consecutiveSessionDays(sessions, new Set(['2026-10-29']), '2026-10-30', '2026-10-01')).toEqual({ days: 0, capped: false });
  });
  it('창 끝까지 이어지면 capped(「30일 이상」)', () => {
    const s = new Set(['2026-10-01', '2026-10-02', '2026-10-30']);
    expect(consecutiveSessionDays(s, s, '2026-10-30', '2026-10-01')).toEqual({ days: 3, capped: true });
  });
});

describe('X4 가상 청산 제안', () => {
  it('가상(dry_run)·차단(모든거래차단)·체결·승인 대기를 나눠 센다 — 가상은 체결이 아니다(D13)', () => {
    const now = kst('2026-10-30 16:00');
    const p = summarizeProposals([
      { status: 'auto_submitted', created_at: new Date(kst('2026-10-30 15:26')), exit_kind: 'eod_loss_cut', ostatus: 'dry_run' },
      { status: 'auto_submitted', created_at: new Date(kst('2026-10-30 10:00')), exit_kind: 'hard_stop', ostatus: 'blocked', blocked_by: 'kill_switch' },
      { status: 'awaiting_approval', created_at: new Date(kst('2026-10-30 11:00')), expires_at: new Date(kst('2026-10-30 18:00')), exit_kind: 'target_profit', ostatus: null },
      { status: 'awaiting_approval', created_at: new Date(kst('2026-10-30 09:00')), expires_at: new Date(kst('2026-10-30 09:30')), exit_kind: 'target_profit', ostatus: null },
      { status: 'expired', created_at: new Date(kst('2026-10-30 09:05')), exit_kind: 'trailing_stop', ostatus: null },
    ], now);
    // 승인 대기인데 만료 시각이 지난 것도 만료로 센다
    expect(p).toMatchObject({ total: 5, virtual: 1, blockedByKill: 1, filled: 0, submittedLive: 0, awaitingApproval: 1, expired: 2, rejected: 0, other: 0 });
    expect(p.firstKind).toBe('eod_loss_cut');
    expect(p.firstAt).toBe('2026-10-30T15:26:00+09:00');
  });
  it('🔴 만료·거절만 있어도 total>0 — 「확인된 0」 위장 금지(R-DATA Major-1), 칸 합 = total', () => {
    const now = kst('2026-10-30 16:00');
    const rows = [
      { status: 'expired', created_at: new Date(kst('2026-10-30 09:05')), exit_kind: 'target_profit', ostatus: null },
      { status: 'rejected', created_at: new Date(kst('2026-10-30 09:10')), exit_kind: 'target_profit', ostatus: null },
      { status: 'superseded', created_at: new Date(kst('2026-10-30 09:20')), exit_kind: 'trailing_stop', ostatus: null },
      { status: 'auto_submitted', created_at: new Date(kst('2026-10-30 09:30')), exit_kind: 'hard_stop', ostatus: 'failed' },
      { status: 'approved', created_at: new Date(kst('2026-10-30 09:40')), exit_kind: 'target_profit', ostatus: 'filled' },
    ];
    const p = summarizeProposals(rows, now);
    expect(p).toMatchObject({ total: 5, expired: 1, rejected: 1, other: 2, filled: 1, submittedLive: 1, virtual: 0 });
    expect(p.virtual + p.awaitingApproval + p.blockedByKill + p.submittedLive + p.expired + p.rejected + p.other).toBe(p.total);
    expect(summarizeProposals([], now).total).toBe(0);
  });
});

describe('판정·X2 — 개장 중 run 0행은 장외가 아니다(가동 줄과 같은 판정)', () => {
  const run0 = { runs: 0, lastMs: null, lastReason: null, balancesUnknown: 0 };
  it('장외 → off_hours, 개장 15분 이내 → unknown, 넘으면 stale', () => {
    expect(noRunMetric(lastEvalMetric('domestic', run0, kst('2026-10-30 08:00'), NONE)).state).toBe('off_hours');
    expect(noRunMetric(lastEvalMetric('domestic', run0, kst('2026-10-30 09:10'), NONE))).toMatchObject({ state: 'unknown', reason: 'no_runs_yet' });
    expect(noRunMetric(lastEvalMetric('domestic', run0, kst('2026-10-30 10:00'), NONE))).toMatchObject({ state: 'stale', reason: 'no_runs' });
    expect(noRunMetric(lastEvalMetric('domestic', run0, kst('2026-10-30 10:00'), null))).toMatchObject({ state: 'unknown', reason: 'holidays_unknown' });
  });
  it('정책 스킵(엔진 꺼짐 틱·쿨다운)도 종목 집합으로 센다', () => {
    const g = groupExitGates([
      { gate: 'exit_engine_disabled', verdict: 'skip', symbol: 'A', n: 3 },
      { gate: 'cooldown_exit', verdict: 'skip', symbol: 'B', n: 1 },
      { gate: 'exit_cooldown_5m', verdict: 'skip', symbol: 'C', n: 1 },
    ]);
    expect([...g.engineOff]).toEqual(['A']);
    expect([...g.cooldown].sort()).toEqual(['B', 'C']);
  });
});

describe('X6 기록 공백(근사)', () => {
  it('국내 장중 5분 슬롯 − run 수, 상태 prep(완전판 T-112)', () => {
    const g = gapMetric({ runs: 57, lastMs: kst('2026-10-30 15:25'), lastReason: null, balancesUnknown: 0 }, kst('2026-10-30 16:00'), NONE);
    expect(g).toMatchObject({ state: 'prep', value: { expectedSlots: 78, runs: 57, gap: 21 } });
    expect(gapMetric({ runs: 0, lastMs: null, lastReason: null, balancesUnknown: 0 }, kst('2026-10-31 12:00'), NONE).state).toBe('off_hours');
  });
});

describe('원천 신선도', () => {
  it('나이 한도', () => {
    expect(ageRow('portfolio_snapshot', null, 0, 1).state).toBe('unknown');
    expect(ageRow('portfolio_snapshot', kst('2026-10-30 12:00'), kst('2026-10-30 15:01'), 3 * 3600_000).state).toBe('stale');
    expect(ageRow('portfolio_snapshot', kst('2026-10-30 12:00'), kst('2026-10-30 14:59'), 3 * 3600_000).state).toBe('available');
  });
  it('일봉 — 있어야 할 날짜(세션 다음 날 08:30 KST 이후)', () => {
    expect(expectedBarDate('domestic', kst('2026-10-31 08:00'), NONE)).toBe('2026-10-29');
    expect(expectedBarDate('domestic', kst('2026-10-31 09:00'), NONE)).toBe('2026-10-30');
    expect(expectedBarDate('overseas', kst('2026-10-31 09:00'), NONE)).toBe('2026-10-30');
    expect(barsRow('daily_bars_us', 'overseas', '2026-10-29', kst('2026-10-31 09:00'), NONE)).toMatchObject({ state: 'stale', dateRef: '2026-10-29' });
    expect(barsRow('daily_bars_kr', 'domestic', '2026-10-30', kst('2026-10-31 09:00'), NONE)).toMatchObject({ state: 'available', dateRef: '2026-10-30' });
    expect(barsRow('daily_bars_kr', 'domestic', null, 0, NONE).state).toBe('unknown');
  });
  it('뉴스 — 0건 연속 ≥2 partial, 관측 30시간 공백 stale, 키 없음 unknown', () => {
    const now = kst('2026-10-30 12:00');
    const rows = newsRows([
      { key: 'news_zero_streak:fetch:domestic', value: '{"streak":2,"lastDate":"2026-10-30","lastOkDate":"2026-10-28"}' },
      { key: 'news_zero_streak:fetch:overseas', value: '{"streak":0,"lastDate":"2026-10-28","lastOkDate":"2026-10-28"}' },
    ], now);
    expect(rows.domestic).toMatchObject({ state: 'partial', streak: 2, dateRef: '2026-10-28', reason: 'zero_streak' });
    expect(rows.overseas.state).toBe('stale');
    expect(newsRows([], now).domestic.state).toBe('unknown');
  });
});

describe('A4 데이터 이상', () => {
  const src = (state: any) => ({ id: 'portfolio_snapshot' as const, lastOkAt: null, state, dateRef: null, streak: null });
  it('실행 기록을 아직 모르면 partial(분석 실패는 실행 기록 뒤)', () => {
    const a = buildAnomalies([src('available')], null, false, 'x');
    expect(a).toMatchObject({ state: 'partial', value: { total: 0, analysisFailureKnown: false } });
  });
  it('알면 이상 0 = zero, 이상 있으면 available + 잡 실패 포함', () => {
    expect(buildAnomalies([src('available')], [], true, 'x').state).toBe('zero');
    const a = buildAnomalies([src('stale')], [{ job_id: 'post-market-domestic', market: 'domestic', status: 'degraded' }], true, 'x');
    expect(a.state).toBe('available');
    expect(a.value?.total).toBe(2);
    expect(a.value?.items[1]).toMatchObject({ source: 'job_run', jobId: 'post-market-domestic', jobStatus: 'degraded', state: 'partial' });
  });
  it('원천을 하나도 못 읽으면 error(0 이 아니다)', () => {
    expect(buildAnomalies([src('error')], [], true, 'x').state).toBe('error');
  });
});

describe('A3 사후 추적·A-8 사후 성과(중앙값은 준비 중 — L-3)', () => {
  const ms = (barsAfter: number[], over: Partial<MarketSample> = {}): MarketSample => ({ barsAfter, lastBarDate: '2026-10-30', stale: false, holidaysKnown: true, truncated: false, ...over });
  it('조회 상한에 닿으면 partial(truncated) — 숫자는 하한', () => {
    const many = Array.from({ length: 40 }, () => 10);
    expect(homePostmortem({ markets: { domestic: ms(many, { truncated: true }), overseas: ms([]) } }, 0)).toMatchObject({ state: 'partial', reason: 'truncated' });
    expect(homePostmortem({ markets: { domestic: ms(many), overseas: ms([]) } }, 0).state).toBe('available');
  });
  it('0건 → zero, 30건 미만 → partial, 일봉 오래됨 → stale 우선', () => {
    expect(homePostmortem({ markets: { domestic: ms([]), overseas: ms([]) } }, 0).state).toBe('zero');
    const p = homePostmortem({ markets: { domestic: ms([10, 3]), overseas: ms([1]) } }, 0);
    expect(p).toMatchObject({ state: 'partial', value: { total: 3, done: 1, tracking: 2, cardsOnly: true } });
    expect(homePostmortem({ markets: { domestic: ms([10], { stale: true }), overseas: ms([]) } }, 0).state).toBe('stale');
  });
  it('기간별 건수는 채우고 초과수익 중앙값은 prep', () => {
    const rows = verifyPostmortemRows({ markets: { domestic: ms([10, 3]), overseas: ms([1, 0]) } });
    expect(rows.map((r) => [r.horizon, r.n])).toEqual([[1, 3], [3, 2], [5, 1], [10, 1]]);
    for (const r of rows) expect(r.medianExcessPct).toMatchObject({ state: 'prep', value: null, reason: 'not_implemented' });
  });
});

describe('B7 신규 매수 가능 — 한도 pct 조회 실패는 unknown(미설정과 구분)', () => {
  const snap = { ts: kst('2026-10-30 21:00'), stocks: [], cash: new Map([['KRW', { qty: 500000, valueKrw: 500000, price: 1 }], ['USD', { qty: 300, valueKrw: 414000, price: 1380 }]]) };
  const fx = { rate: 1380, atMs: kst('2026-10-30 21:55') };
  const now = kst('2026-10-30 22:00');
  it('pct=null(조회 실패) → unknown, pct=0 → blocked(order_max_unset), 양수 → 한도 적용', () => {
    expect(buyableMetric('domestic', 'live', snap, null, fx, now)).toMatchObject({ state: 'unknown', reason: 'order_max_unknown' });
    expect(buyableMetric('domestic', 'live', snap, 0, fx, now)).toMatchObject({ state: 'blocked', reason: 'order_max_unset' });
    expect(buyableMetric('domestic', 'live', snap, 10, fx, now)).toMatchObject({ state: 'available', value: { native: 50000, currency: 'KRW' } });
    expect(buyableMetric('overseas', 'live', snap, 10, fx, now).value).toMatchObject({ currency: 'USD', native: 30, fxSource: 'fx_rates' });
  });
  it('🔴 스냅샷에 USD·KRW 현금 행이 없으면 unknown — 0 으로 바꾸지 않는다(T-056)', () => {
    const noUsd = { ...snap, cash: new Map([['KRW', { qty: 500000, valueKrw: 500000, price: 1 }]]) };
    const noKrw = { ...snap, cash: new Map([['USD', { qty: 300, valueKrw: 414000, price: 1380 }]]) };
    expect(buyableMetric('overseas', 'live', noUsd, 10, fx, now)).toMatchObject({ state: 'unknown', value: null, reason: 'usd_cash_unknown' });
    expect(buyableMetric('domestic', 'live', noKrw, 10, fx, now)).toMatchObject({ state: 'unknown', value: null, reason: 'krw_cash_unknown' });
    const usdNull = { ...snap, cash: new Map([['KRW', { qty: 1, valueKrw: 1, price: 1 }], ['USD', { qty: null, valueKrw: null, price: null }]]) };
    expect(buyableMetric('overseas', 'live', usdNull, 10, fx, now)).toMatchObject({ state: 'unknown', reason: 'usd_cash_unknown' });
  });
  it('readOrderMaxPct — 키 없음 0, 조회 실패는 던진다', async () => {
    await expect(readOrderMaxPct(fakeReader(now, []))).resolves.toBe(0);
    await expect(readOrderMaxPct(fakeReader(now, [['safety_order_max_pct', [{ value: '5' }]]]))).resolves.toBe(5);
    await expect(readOrderMaxPct(fakeReader(now, [['safety_order_max_pct', new Error('x')]]))).rejects.toMatchObject({ code: 'db_error' });
  });
});

describe('readExitLines — 판정·제안 상태(조립 경로)', () => {
  const { readExitLines } = jest.requireActual('../exit-lines') as typeof import('../exit-lines');
  const safety = {
    readAt: 'x', stage: 'observe' as const, liveTrading: false, killSwitch: false, exitEngine: { enabled: true, hardStopEnabled: false, source: 'config' as const },
    strategies: { total: 1, enabled: 0, validated: 0, validatedEnabled: 0 }, notifyAutoSubmit: true, errors: [],
  };
  const now = kst('2026-10-30 11:00');
  const closed = { domestic: NONE, overseas: NONE };
  it('엔진 꺼짐 틱(exit_engine_disabled)만 있어도 「확인된 0」이 아니다', async () => {
    const r = fakeReader(now, [
      ['COUNT(*) AS n, MAX(ts)', (p) => (p[0] === 'domestic' ? [{ n: 10, last_ts: new Date(kst('2026-10-30 10:55')), bu: 0 }] : [{ n: 0 }])],
      ["ORDER BY ts DESC LIMIT 1", (p) => (p[0] === 'domestic' ? [{ ts: new Date(kst('2026-10-30 10:55')), reason: null }] : [])],
      ['GROUP BY gate, verdict, symbol', [{ gate: 'exit_engine_disabled', verdict: 'skip', symbol: '000001', n: 3 }]],
    ]);
    const { lines } = await readExitLines(r, closed, safety);
    expect(lines.judgments.domestic).toMatchObject({ state: 'available', value: { engineOffHit: 1, noFire: 0 } });
    expect(lines.judgments.overseas.state).toBe('off_hours');   // 11:00 KST — 미국 장외
  });
  it('개장 중 run 0행 → 판정은 장외가 아니라 가동 줄과 같은 stale(no_runs)', async () => {
    const { lines } = await readExitLines(fakeReader(kst('2026-10-30 10:00'), []), closed, safety);
    expect(lines.lastEval.domestic.state).toBe('stale');
    expect(lines.judgments.domestic).toMatchObject({ state: 'stale', reason: 'no_runs' });
  });
  it('청산 시그널 조회가 상한(500)에 닿으면 partial(truncated)', async () => {
    const many = Array.from({ length: 500 }, () => ({ status: 'expired', created_at: new Date(kst('2026-10-30 09:05')), exit_kind: 'target_profit', ostatus: null }));
    const r = fakeReader(now, [["s.strategy_id = ?", (p) => (p[0] === 'domestic' ? many : [])]]);
    const { lines } = await readExitLines(r, closed, safety);
    expect(lines.proposals).toMatchObject({ state: 'partial', reason: 'truncated', value: { total: 500 } });
  });
  it('🔴 만료된 청산 시그널만 있어도 제안 state 는 zero 가 아니다(total=1)', async () => {
    const r = fakeReader(now, [
      ["s.strategy_id = ?", (p) => (p[0] === 'domestic' ? [{ status: 'expired', created_at: new Date(kst('2026-10-30 09:05')), exit_kind: 'target_profit', ostatus: null }] : [])],
    ]);
    const { lines } = await readExitLines(r, closed, safety);
    expect(lines.proposals).toMatchObject({ state: 'available', value: { total: 1, expired: 1 } });
  });
});

describe('주문 문제 SQL', () => {
  const { BLOCKED_COUNT_SQL, BLOCKED_LATEST_SQL, REJECTED_COUNT_SQL } = jest.requireActual('../home') as typeof import('../home');
  it('차단 줄은 모든거래차단 차단을 뺀다, 거부 줄은 rejected·failed', () => {
    for (const q of [BLOCKED_COUNT_SQL, BLOCKED_LATEST_SQL]) expect(q).toMatch(/status = 'blocked' AND \(blocked_by IS NULL OR blocked_by <> 'kill_switch'\)/);
    expect(REJECTED_COUNT_SQL).toMatch(/status IN \('rejected', 'failed'\)/);
  });
});

describe('최근 활동 — 건너뜀·실패 사유는 코드로(「휴장」 단정 금지)', () => {
  const { analysisItem } = jest.requireActual('../activity') as typeof import('../activity');
  const row = (status: string, degraded: string | null) => ({ market: 'overseas', status, started_at: new Date(kst('2026-10-31 08:00')), counts_json: null, degraded_reason: degraded });
  it('skip:<코드> → 사유 말 + params.skipReason, 모르는 코드는 그대로, 사유 없음은 그렇게', () => {
    expect(analysisItem(row('skipped', 'skip:overseas_disabled'))).toMatchObject({ sub: '건너뜀 · 해외 분석 꺼짐', params: { skipReason: 'overseas_disabled' } });
    expect(analysisItem(row('skipped', 'skip:brand_new_code'))?.sub).toBe('건너뜀 · 사유 brand_new_code');
    expect(analysisItem(row('skipped', 'skip'))?.sub).toBe('건너뜀 · 사유 기록 없음');
    expect(analysisItem(row('failed', 'fx_unknown'))).toMatchObject({ sub: '실행 실패 · 환율 모름', params: { failReason: 'fx_unknown' } });
    for (const r of [row('skipped', 'skip:weekend'), row('skipped', 'skip:no_new_session')]) expect(analysisItem(r)?.sub).not.toContain('휴장');
  });
});
