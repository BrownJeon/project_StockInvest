/**
 * T-108 A-9 — `/api/ops/*` 라우트 5개: 봉투·전체 실패 503·잘못된 part 400·dynamic (가이드 §4.0 · §6 A-9).
 * 섹션 단위 실패 격리(한 섹션 throw → HTTP 200 + 그 섹션 error)는 아래 「buildHome 섹션 격리」가 실제 조립 함수로 본다.
 */
jest.mock('@/lib/db', () => ({ getPool: jest.fn(), ping: jest.fn() }));
jest.mock('@/lib/strategy/records/record-switch', () => ({ readRecordSwitchState: jest.fn(async () => ({ enabled: false, source: 'missing' })) }));

const buildHomeMock = jest.fn();
const buildTradeMock = jest.fn();
const buildFunnelMock = jest.fn();
const buildAnalysisMock = jest.fn();
const readSafetyMock = jest.fn();
jest.mock('@/lib/ops/metrics/home', () => ({ ...jest.requireActual('@/lib/ops/metrics/home'), buildHome: (...a: unknown[]) => buildHomeMock(...a) }));
jest.mock('@/lib/ops/metrics/trade', () => ({ ...jest.requireActual('@/lib/ops/metrics/trade'), buildTrade: (...a: unknown[]) => buildTradeMock(...a) }));
jest.mock('@/lib/ops/metrics/funnel', () => ({ ...jest.requireActual('@/lib/ops/metrics/funnel'), buildFunnel: (...a: unknown[]) => buildFunnelMock(...a) }));
jest.mock('@/lib/ops/metrics/analysis', () => ({ ...jest.requireActual('@/lib/ops/metrics/analysis'), buildAnalysis: (...a: unknown[]) => buildAnalysisMock(...a) }));
jest.mock('@/lib/ops/metrics/safety-state', () => ({ ...jest.requireActual('@/lib/ops/metrics/safety-state'), readSafetyState: (...a: unknown[]) => readSafetyMock(...a) }));

import { NextRequest } from 'next/server';
import * as analysisRoute from '../analysis/route';
import * as funnelRoute from '../funnel/route';
import * as homeRoute from '../home/route';
import * as safetyRoute from '../safety-state/route';
import * as tradeRoute from '../trade/route';

const req = (url: string) => new NextRequest(new URL(url, 'http://localhost'));

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('공통 — dynamic', () => {
  it.each([analysisRoute, funnelRoute, homeRoute, safetyRoute, tradeRoute])('force-dynamic', (m) => {
    expect((m as { dynamic?: string }).dynamic).toBe('force-dynamic');
  });
});

describe('봉투와 전체 실패', () => {
  it('home: ok → 200 {ok,data} / 예외 → 503', async () => {
    buildHomeMock.mockResolvedValueOnce({ stage: 'observe' });
    let res = await homeRoute.GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: { stage: 'observe' } });
    expect(res.headers.get('cache-control')).toBe('no-store');
    buildHomeMock.mockRejectedValueOnce(new Error('pool'));
    res = await homeRoute.GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: 'home_unavailable' });
  });
  it('trade', async () => {
    buildTradeMock.mockResolvedValueOnce({ a: 1 });
    expect(await (await tradeRoute.GET()).json()).toEqual({ ok: true, data: { a: 1 } });
    buildTradeMock.mockRejectedValueOnce(new Error('x'));
    expect((await tradeRoute.GET()).status).toBe(503);
  });
  it('funnel — market 파라미터 해석(그 밖 값은 null → 기본 시장)', async () => {
    buildFunnelMock.mockResolvedValue({ market: 'overseas' });
    await funnelRoute.GET(req('/api/ops/funnel?market=overseas'));
    await funnelRoute.GET(req('/api/ops/funnel'));
    await funnelRoute.GET(req('/api/ops/funnel?market=evil'));
    expect(buildFunnelMock.mock.calls.map((c) => c[0])).toEqual(['overseas', null, null]);
    buildFunnelMock.mockRejectedValueOnce(new Error('x'));
    expect((await funnelRoute.GET(req('/api/ops/funnel'))).status).toBe(503);
  });
  it('analysis — part 없음·이상 400, 정상 200, 예외 503', async () => {
    expect((await analysisRoute.GET(req('/api/ops/analysis'))).status).toBe(400);
    expect(await (await analysisRoute.GET(req('/api/ops/analysis?part=all'))).json()).toEqual({ ok: false, error: 'invalid_part' });
    buildAnalysisMock.mockResolvedValueOnce({ part: 'data' });
    const ok = await analysisRoute.GET(req('/api/ops/analysis?part=data'));
    expect(ok.status).toBe(200);
    expect(buildAnalysisMock.mock.calls[0][0]).toBe('data');
    buildAnalysisMock.mockRejectedValueOnce(new Error('x'));
    expect((await analysisRoute.GET(req('/api/ops/analysis?part=today'))).status).toBe(503);
  });
  it('safety-state — 부가 값(killSwitchSince)은 응답에 싣지 않는다', async () => {
    readSafetyMock.mockResolvedValueOnce({
      readAt: 'x', stage: 'observe', liveTrading: false, killSwitch: false, exitEngine: null, strategies: null,
      notifyAutoSubmit: true, errors: [], killSwitchSince: '2026-10-30T09:08:00+09:00',
    });
    const body = await (await safetyRoute.GET()).json();
    expect(body.ok).toBe(true);
    expect(body.data).not.toHaveProperty('killSwitchSince');
    readSafetyMock.mockRejectedValueOnce(new Error('x'));
    expect((await safetyRoute.GET()).status).toBe(503);
  });
});

describe('buildHome 섹션 격리 — 한 섹션 실패는 그 섹션만 error', () => {
  const { buildHome } = jest.requireActual('@/lib/ops/metrics/home') as typeof import('@/lib/ops/metrics/home');
  const { fakeReader, kst } = jest.requireActual('../../../../lib/ops/metrics/__tests__/fake-reader') as typeof import('../../../../lib/ops/metrics/__tests__/fake-reader');
  const safety = {
    readAt: '2026-10-30T22:00:00+09:00', stage: 'observe' as const, liveTrading: false, killSwitch: false,
    exitEngine: { enabled: true, hardStopEnabled: false, source: 'config' as const },
    strategies: { total: 16, enabled: 3, validated: 0, validatedEnabled: 0 }, notifyAutoSubmit: false, errors: [], killSwitchSince: null,
  };

  it('거부 주문 조회 실패 → counts·checks 만 error(「비어 있음」으로 위장하지 않음), 나머지 ok', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const now = kst('2026-10-30 22:00');
    const dto = await buildHome(now, {
      readSafety: async () => safety,
      reader: () => fakeReader(now, [["status IN ('rejected', 'failed')", new Error('lock wait')]]),
    });
    expect(dto.stage).toBe('observe');
    expect(dto.counts).toEqual({ state: 'error', error: 'db_error' });
    expect(dto.checks).toEqual({ state: 'error', error: 'db_error' });
    expect(dto.exit.state).toBe('ok');
    expect(dto.analysis.state).toBe('ok');
    expect(dto.activity.state).toBe('ok');
    expect(dto.observe?.state).toBe('ok');
    expect(dto.live).toBeNull();
  });

  it('모두 비어 있음 → 0 을 꾸미지 않는다: 분석 prep, A4 partial(원천 7개 모름 = 이상 3줄 + 외 4), 분석 기록 없음 2줄', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const now = kst('2026-10-30 22:00');
    const dto = await buildHome(now, { readSafety: async () => safety, reader: () => fakeReader(now, []) });
    expect(dto.checks.state).toBe('ok');
    if (dto.checks.state !== 'ok') throw new Error('checks');
    expect(dto.checks.data.map((c) => c.kind)).toEqual(['data_anomaly', 'data_anomaly', 'data_anomaly', 'analysis_unknown', 'analysis_unknown']);
    expect(dto.checks.data[2].params.more).toBe(4);
    if (dto.observe?.state !== 'ok') throw new Error('observe');
    expect(dto.observe.data.anomalies.state).toBe('partial');
    expect(dto.observe.data.analysis.domestic.evaluated.state).toBe('prep');   // 기록 스위치 꺼짐(목) → 준비 중
    expect(dto.observe.data.postmortem.state).toBe('zero');
    if (dto.analysis.state !== 'ok') throw new Error('analysis');
    expect(dto.analysis.data.domestic.signalsCreated.value).toBeNull();
    // 휴장표가 비어 있으면(0행) 모름 — 장외로 추정하지 않는다
    if (dto.exit.state !== 'ok') throw new Error('exit');
    expect(dto.exit.data.lastEval.domestic.state).toBe('unknown');
  });

  it('실거래 세트 단계(mixed) 에서는 observe=null, live 섹션을 채운다 — 데이터 이상은 그래도 계산한다(R-DATA Major-2)', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const now = kst('2026-10-30 22:00');
    const dto = await buildHome(now, { readSafety: async () => ({ ...safety, stage: 'mixed', liveTrading: true }), reader: () => fakeReader(now, []) });
    expect(dto.observe).toBeNull();
    expect(dto.anomalies.state).toBe('ok');
    if (dto.checks.state !== 'ok') throw new Error('checks');
    expect(dto.checks.data.map((c) => c.kind)).toEqual(expect.arrayContaining(['exit_live_orders', 'buy_blocked', 'data_anomaly']));
    expect(dto.checkCoverage).toMatchObject({ approval: true, orders: true, anomalies: false, safety: true });
    expect(dto.live?.state).toBe('ok');
    if (dto.live?.state === 'ok') {
      expect(dto.live.data.allocation).toMatchObject({ state: 'unknown', reason: 'not_set' });
      expect(dto.live.data.autoPnl).toMatchObject({ state: 'unknown', reason: 'baseline_unset' });
      expect(dto.live.data.buyable.overseas).toMatchObject({ state: 'blocked', reason: 'validation_gate' });
    }
  });

  it('실거래 단계 B7 — 한도 설정을 못 읽으면 unknown(미설정 「차단」으로 보이지 않는다)', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const now = kst('2026-10-30 22:00');
    const dto = await buildHome(now, {
      readSafety: async () => ({ ...safety, stage: 'live', liveTrading: true, strategies: { total: 16, enabled: 3, validated: 1, validatedEnabled: 1 } }),
      reader: () => fakeReader(now, [
        ['safety_order_max_pct', new Error('lost')],
        ['FROM portfolio_snapshots ORDER BY', [{ ts: new Date(kst('2026-10-30 21:00')), positions: JSON.stringify([{ currency: 'KRW', qty: 1000, price: 1, value_krw: 1000 }]) }]],
      ]),
    });
    if (dto.live?.state !== 'ok') throw new Error('live');
    expect(dto.live.data.buyable.domestic).toMatchObject({ state: 'unknown', reason: 'order_max_unknown' });
  });

  it('🔴 단계 unknown(안전 값 일부 못 읽음) → 확인 필요 맨 앞 safety_unknown, coverage.safety=false', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const now = kst('2026-10-30 22:00');
    const dto = await buildHome(now, {
      readSafety: async () => ({ ...safety, stage: 'unknown', strategies: null, errors: ['strategies_error'] }),
      reader: () => fakeReader(now, []),
    });
    if (dto.checks.state !== 'ok') throw new Error('checks');
    expect(dto.checks.data[0]).toMatchObject({ kind: 'safety_unknown', params: { errors: 'strategies_error' } });
    expect(dto.checkCoverage?.safety).toBe(false);
  });

  it('데이터 이상 재료를 못 읽으면(실행 기록 표 등은 원천별 격리) 확인 필요는 error 가 아니라 원천 행 error 로 남는다', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const now = kst('2026-10-30 22:00');
    const dto = await buildHome(now, { readSafety: async () => safety, reader: () => fakeReader(now, [['portfolio_snapshots', new Error('x')]]) });
    expect(dto.anomalies.state).toBe('ok');
    if (dto.anomalies.state === 'ok') expect(dto.anomalies.data.value?.items.find((i) => i.source === 'portfolio_snapshot')?.state).toBe('error');
  });
});
