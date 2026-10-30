/**
 * T-108 깔때기 — 기준 세션 조회 실패를 「오늘 평가 없음」으로 위장하지 않는다(Codex C2 ①).
 */
jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));

import { buildFunnel } from '../funnel';
import { fakeReader, kst } from './fake-reader';

const NOW = kst('2026-10-31 09:00');
const summary = jest.fn(async (market: string, s: Date, e: Date) => ({
  market, rangeStart: s, rangeEnd: e, runs: 77, fullEvalRuns: 77, symbolsEvaluated: 0, buySignals: 0, sellSignals: 0, exitSignals: 0,
  steps: [], bottlenecks: [], anomalies: [], neutralPct: null,
})) as unknown as typeof import('@/lib/strategy/eval-funnel-query').getEvalFunnelSummary;

beforeEach(() => (summary as unknown as jest.Mock).mockClear());

describe('buildFunnel', () => {
  it('정상 — 마지막 run 의 현지 날짜(해외 ET)가 세션일, 기본 시장 = 더 최근 run', async () => {
    const r = fakeReader(NOW, [
      ['GROUP BY market', [{ market: 'domestic', t: new Date(kst('2026-10-30 15:25')) }, { market: 'overseas', t: new Date(kst('2026-10-31 04:55')) }]],
      ["verdict = 'error'", [{ n: 2 }]],
    ]);
    const f = await buildFunnel(null, NOW, r, { summary });
    expect(f.basis).toEqual({ state: 'ok' });
    expect(f.defaultMarket).toBe('overseas');
    expect(f.sessions.overseas.session.sessionDate).toBe('2026-10-30');
    expect(f.sessions.domestic.anomalies).toBe(2);
    expect(f.summary.state).toBe('ok');
    expect((summary as unknown as jest.Mock).mock.calls[0][0]).toBe('overseas');
  });

  it('🔴 기준 조회 실패 → basis error + fallback 표지, 요약은 error, 「이상 n」 null — 추정 창으로 읽지 않는다', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const r = fakeReader(NOW, [['GROUP BY market', new Error('lock wait timeout')], ["verdict = 'error'", [{ n: 9 }]]]);
    const f = await buildFunnel(null, NOW, r, { summary });
    expect(f.basis).toEqual({ state: 'error', error: 'db_error', fallback: { defaultMarket: true, sessions: true } });
    expect(f.summary).toEqual({ state: 'error', error: 'db_error' });
    expect(f.sessions.domestic.anomalies).toBeNull();
    expect(f.sessions.overseas.anomalies).toBeNull();
    expect(f.sessions.domestic.lastRunAt).toBeNull();
    expect(summary).not.toHaveBeenCalled();
    expect(r.calls.some((c) => c.sql.includes("verdict = 'error'"))).toBe(false);
  });

  it('시장 파라미터가 있으면 기본 시장은 추정이 아니다(fallback.defaultMarket=false)', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const f = await buildFunnel('overseas', NOW, fakeReader(NOW, [['GROUP BY market', new Error('x')]]), { summary });
    expect(f.basis).toMatchObject({ state: 'error', fallback: { defaultMarket: false, sessions: true } });
    expect(f.market).toBe('overseas');
  });
});
