/**
 * T-108 거래 화면 렌더 시험 (가이드 §2.4 · 데모 v3 tradeNow/tradeHold/tradeLog) — 합성 DTO, jsdom 없음.
 * 운영 단계가 관찰이라 실거래 세트는 실데이터로 볼 수 없다 → 합성 DTO 로 문구·「0」 조건만 고정한다.
 */
import * as ReactNS from 'react';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mockStateQueue: unknown[] = [];
jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return { ...actual, useState: (init: unknown) => (mockStateQueue.length > 0 ? [mockStateQueue.shift(), () => {}] : actual.useState(init)) };
});
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }), useSearchParams: () => new URLSearchParams('') }));
jest.mock('@/components/ui/Toast', () => ({ useToast: () => ({ show: jest.fn() }) }));
jest.mock('@/lib/hooks/useFxRate', () => ({ useFxRate: () => 1400 }));
jest.mock('@/lib/hooks/useSymbolMeta', () => ({ useSymbolMeta: () => ({ meta: {}, displaySymbol: (s: string) => `종목${s}`, marketFlag: () => '' }) }));
(globalThis as unknown as { React: typeof ReactNS }).React = ReactNS;

import type { SafetyStateDTO, TradeDTO } from '@/lib/ops/metrics/types';
import { TradeNowPanel, APPROVAL_LIST_URL } from '@/app/recommend/TradeNowPanel';
import { TradeHoldPanel, zoneText } from '@/app/recommend/TradeHoldPanel';
import {
  ORDER_STATUS_TEXT, orderMatches, orderSessionDate, ordersInSessions, orderStatusLine, type LogOrder,
} from '@/app/recommend/TradeLogPanel';
import { TradePage } from '@/app/recommend/TradePage';
import { EvalFunnelCard, sessionFunnelUrl, readFunnelResponse } from '@/components/dashboard/EvalFunnelCard';
import { TradeLogPanel } from '@/app/recommend/TradeLogPanel';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

function safety(over: Partial<SafetyStateDTO> = {}): SafetyStateDTO {
  return {
    readAt: '2026-10-30T16:20:00+09:00', stage: 'observe', liveTrading: false, killSwitch: false,
    exitEngine: { enabled: true, hardStopEnabled: false, source: 'config' },
    strategies: { total: 16, enabled: 8, validated: 0, validatedEnabled: 0 }, notifyAutoSubmit: false, errors: [], ...over,
  };
}
function trade(over: Partial<TradeDTO> = {}): TradeDTO {
  return {
    generatedAt: '2026-10-30T16:20:00+09:00',
    counts: { state: 'ok', data: { approval: { domestic: 0, overseas: 0 }, detected: 3, watching: { domestic: 0, overseas: 0 }, executing: 0, nextSession: 0, preOrderBlockedToday: 22 } },
    executing: { state: 'ok', data: [] },
    blockedPostMarket: { state: 'ok', data: [
      { id: 1, symbol: '005930', market: 'domestic', confidence: 72, createdAt: '2026-10-30T16:00:00+09:00', session: { market: 'domestic', sessionDate: '2026-10-30', tz: 'KST' } },
      { id: 2, symbol: 'NAS:MU', market: 'overseas', confidence: 68, createdAt: '2026-10-30T08:00:00+09:00', session: { market: 'overseas', sessionDate: '2026-10-29', tz: 'ET' } },
      { id: 3, symbol: 'NAS:X', market: 'overseas', confidence: 50, createdAt: '2026-10-30T08:00:00+09:00', session: { market: 'overseas', sessionDate: '2026-10-29', tz: 'ET' } },
    ] },
    holdings: { state: 'ok', data: {
      snapshotAt: '2026-10-30T15:00:00+09:00', stale: false,
      trailing: { activatePct: 3.5, drawdownPct: 1.2, source: 'override' },
      thresholds: { hardStopPct: 1.5, eodLossCutPct: 1.5, targetProfitPct: 2.5, source: 'default' },
      accountCount: 6, autoCount: 0,
      rows: [
        { symbol: '000660', market: 'domestic', auto: false, pnlPct: -2.1, zone: 'hard_stop', detail: { thresholdPct: -1.5 } },
        { symbol: 'NAS:C', market: 'overseas', auto: false, pnlPct: 2.7, zone: 'take_profit', detail: { thresholdPct: 2.5 } },
        { symbol: 'NAS:H', market: 'overseas', auto: false, pnlPct: 1.1, zone: 'trailing_active', detail: { thresholdPct: -1.2, fromPeakPct: -0.6 } },
        { symbol: 'NAS:K', market: 'overseas', auto: false, pnlPct: -0.8, zone: 'not_evaluated', detail: {} },
      ],
    } },
    openOrders: { state: 'ok', data: [] },
    ...over,
  };
}
function renderNow(props: Record<string, unknown>, signals: unknown[] = [], pending: unknown[] = []): string {
  mockStateQueue.length = 0;
  mockStateQueue.push(signals, pending, false, null);
  const html = renderToStaticMarkup(h(TradeNowPanel, props));
  expect(mockStateQueue).toHaveLength(0);
  return html;
}

describe('운용 현황 (§2.4.1)', () => {
  test('승인 대기 목록 조회에서 detected 를 뺐다(D8) — 홈·서버 COUNT 와 같은 집합', () => {
    expect(APPROVAL_LIST_URL).toBe('/api/signals?status=awaiting_approval,pending,pending_approval&limit=100');
    expect(APPROVAL_LIST_URL).not.toContain('detected');
  });
  test('관찰 · 검증 통과 0 · 0건 → 「승인 대기 없음 — 검증 통과 전략이 없어…」 + 차단 카드 최대 2', () => {
    const t = text(renderNow({ stage: 'observe', safety: safety(), trade: trade(), tradeStatus: 'ok' }));
    expect(t).toContain('승인 대기 0건 · 홈과 같은 집합');
    expect(t).toContain('승인 대기 없음 — 검증 통과 전략이 없어 새 매수 시그널은 차단 기록으로 남습니다(승인 버튼 없음).');
    expect(t).toContain('종목005930 국내 매수 시그널 ⊘ 차단 10-30 16:00 장마감 분석 · AI 신뢰도 72 · 검증 관문(전략 미검증) — 사후 결과 추적 대상으로만 씁니다');
    expect(t).toContain('종목NAS:MU 해외 매수 시그널 ⊘ 차단 ET 10-29 세션 · 08:00 장마감 분석 · AI 신뢰도 68');
    expect(t).not.toContain('종목NAS:X');                     // 최대 2
    expect(t).not.toContain('✓ 확인된 0 — 매수 차단');
  });
  test('관찰이어도 검증 통과 전략이 있으면 「검증 통과 전략이 없어」라고 말하지 않는다', () => {
    const t = text(renderNow({ stage: 'observe', safety: safety({ strategies: { total: 16, enabled: 8, validated: 1, validatedEnabled: 1 } }), trade: trade(), tradeStatus: 'ok' }));
    expect(t).toContain('승인 대기 없음 ✓ 확인된 0');
    expect(t).not.toContain('검증 통과 전략이 없어');
    expect(t).not.toContain('⊘ 차단 10-30');
  });
  test('관측 기록 = detected COUNT, 승인 버튼 없음', () => {
    const t = text(renderNow({ stage: 'observe', safety: safety(), trade: trade(), tradeStatus: 'ok' }));
    expect(t).toContain('관측 기록 승인 버튼 없음');
    expect(t).toContain('3건 — 수동 관측용 기록(detected) 승인 대기 숫자에 넣지 않습니다(D8)');
  });
  test('혼합 · 0건 → 「승인 대기 없음 ✓ 확인된 0 — 매수 차단(검증 통과 0) 중」', () => {
    const t = text(renderNow({ stage: 'mixed', safety: safety({ stage: 'mixed', liveTrading: true }), trade: trade(), tradeStatus: 'ok' }));
    expect(t).toContain('승인 대기 없음 ✓ 확인된 0 — 매수 차단(검증 통과 0) 중');
    expect(t).not.toContain('검증 통과 전략이 없어');
  });
  test('전략 상태 — 「켜진 전략 8 · 검증 통과 0/16 → 신규 매수 차단」 + 관리 › /strategy', () => {
    const html = renderNow({ stage: 'observe', safety: safety(), trade: trade(), tradeStatus: 'ok' });
    expect(text(html)).toContain('켜진 전략 8 · 검증 통과 0/16 → 신규 매수 차단 전략 편집·세부 정책은 상세(기존 /strategy)');
    expect(html).toContain('href="/strategy"');
    const live = text(renderNow({ stage: 'live', safety: safety({ stage: 'live', strategies: { total: 16, enabled: 8, validated: 2, validatedEnabled: 2 } }), trade: trade(), tradeStatus: 'ok' }));
    expect(live).toContain('켜진 전략 8 · 검증 통과 2/16 전략');
    expect(live).not.toContain('→ 신규 매수 차단');
  });
  test('지표 조회 실패 — 관측 기록은 0 이 아니라 「! 조회 실패」', () => {
    const t = text(renderNow({ stage: 'observe', safety: safety(), trade: null, tradeStatus: 'error', tradeError: 'http_503' }));
    expect(t).toContain('! 조회 실패 · http_503');
    expect(t).not.toMatch(/\b0건 — 수동 관측용/);
    expect(t).toContain('승인 대기 홈과 같은 집합');       // 숫자 없이
  });
  test('목록 조회 실패는 「승인 대기 없음」이 아니다', () => {
    mockStateQueue.length = 0;
    mockStateQueue.push([], [], false, null, 'network');   // signals · pending · loading · banner · listError
    const t = text(renderToStaticMarkup(h(TradeNowPanel, { stage: 'observe', safety: safety(), trade: trade(), tradeStatus: 'ok' })));
    expect(t).toContain('! 조회 실패 · network 비어 있는 것이 아닙니다');
    expect(t).not.toContain('승인 대기 없음');
  });
  test('진입 감시 없음 ✓ 확인된 0 · 감시 중/선점 숫자는 서버 COUNT', () => {
    const t = text(renderNow({ stage: 'observe', safety: safety(), trade: trade(), tradeStatus: 'ok' }));
    expect(t).toContain('진입 감시 감시 중 0 · 선점 0 진입 감시 없음 ✓ 확인된 0');
  });
  // R-UI-M1 — 「진입 감시 없음 ✓ 확인된 0」은 감시 목록·선점 목록 둘 다 조회 성공 + 0 이고 서버 COUNT 와 맞을 때만
  function watchPart(html: string): string { const t = text(html); return t.slice(t.indexOf('진입 감시'), t.indexOf('전략 상태')); }
  test('감시 목록 조회 실패 → 「! 조회 실패 · 비어 있는 것이 아닙니다」(✓ 아님)', () => {
    mockStateQueue.length = 0;
    mockStateQueue.push([], [], false, null, null, null, 'network');   // … listError · cancelTarget · pendingError
    const w = watchPart(renderToStaticMarkup(h(TradeNowPanel, { stage: 'observe', safety: safety(), trade: trade(), tradeStatus: 'ok' })));
    expect(w).toContain('! 조회 실패 · network 비어 있는 것이 아닙니다');
    expect(w).not.toContain('✓ 확인된 0');
  });
  test('거래 지표(/api/ops/trade) 아직 못 읽음 → 「확인 중…」', () => {
    const w = watchPart(renderNow({ stage: 'observe', safety: safety(), trade: null, tradeStatus: 'loading' }));
    expect(w).toContain('확인 중…');
    expect(w).not.toContain('✓ 확인된 0');
  });
  test('거래 지표 조회 실패 → 선점 여부 「! 조회 실패」(✓ 아님)', () => {
    const w = watchPart(renderNow({ stage: 'observe', safety: safety(), trade: null, tradeStatus: 'error', tradeError: 'http_503' }));
    expect(w).toContain('주문 선점 여부 ! 조회 실패 · http_503 비어 있는 것이 아닙니다');
    expect(w).not.toContain('✓ 확인된 0');
    const sec = trade({ executing: { state: 'error', error: 'timeout' } });
    expect(watchPart(renderNow({ stage: 'observe', safety: safety(), trade: sec, tradeStatus: 'ok' }))).toContain('! 조회 실패 · timeout');
  });
  test('목록 0 인데 서버 COUNT 는 감시 중 2 → 0 이라고 말하지 않는다', () => {
    const tr = trade();
    if (tr.counts.state !== 'ok') throw new Error('x');
    tr.counts.data.watching = { domestic: 2, overseas: 0 };
    const w = watchPart(renderNow({ stage: 'observe', safety: safety(), trade: tr, tradeStatus: 'ok' }));
    expect(w).toContain('목록과 집계가 다릅니다');
    expect(w).not.toContain('✓ 확인된 0');
  });
});

describe('보유·주문 (§2.4.4)', () => {
  test('청산 구간 문구(X5) — 임계는 서버 값, 부호는 화면이 붙인다', () => {
    const ctx = { hardStopPct: 1.5, targetProfitPct: 2.5, drawdownPct: 1.2, hardStopEnabled: false };
    expect(zoneText({ zone: 'hard_stop', detail: { thresholdPct: -1.5 } }, ctx)).toBe('손실한도 구간 (임계 −1.5%) — 손실한도 손절 OFF');
    expect(zoneText({ zone: 'hard_stop', detail: {} }, { ...ctx, hardStopEnabled: true })).toBe('손실한도 구간 (임계 −1.5%)');
    // 스위치 값을 모르면(null) 「OFF」라고 지어내지 않는다
    expect(zoneText({ zone: 'hard_stop', detail: {} }, { ...ctx, hardStopEnabled: null })).toBe('손실한도 구간 (임계 −1.5%)');
    expect(zoneText({ zone: 'take_profit', detail: { thresholdPct: 2.5 } }, ctx)).toBe('익절 조건 충족 (임계 +2.5%)');
    expect(zoneText({ zone: 'trailing_active', detail: { thresholdPct: -1.2, fromPeakPct: -0.6 } }, ctx)).toBe('트레일링 활성 · 고점 대비 −0.6% (되돌림 1.2%)');
    expect(zoneText({ zone: 'eod_cut', detail: {} }, ctx)).toBe('장마감 전 손절 구간');
    expect(zoneText({ zone: 'neutral', detail: {} }, ctx)).toBe('중립');
    expect(zoneText({ zone: 'not_evaluated', detail: {} }, ctx)).toBe('미평가 — 장외');
  });
  test('보유 행·foot·포지션 추적 입구 · 미체결 없음 ✓ 확인된 0', () => {
    const html = renderToStaticMarkup(h(TradeHoldPanel, {
      trade: trade(), tradeStatus: 'ok', tradeError: null, safety: safety(), displaySymbol: (s: string) => `종목${s}`,
      onGoTrailing: () => {}, nowMs: Date.parse('2026-10-30T16:20:00+09:00'),
    }));
    const t = text(html);
    expect(t).toContain('보유 계좌 6 · 자동 운용 0 (D3)');
    expect(t).toContain('종목000660 국내 수동 보유 손실한도 구간 (임계 −1.5%) — 손실한도 손절 OFF −2.1%');
    expect(t).toContain('종목NAS:C 해외 수동 보유 익절 조건 충족 (임계 +2.5%) +2.7%');
    expect(html).toContain('class="num down">−2.1%');
    expect(html).toContain('class="num up">+2.7%');
    expect(t).toContain('기준 15:00 스냅샷 · 청산 임계: 손실한도 손절·장마감 전 손절·익절 = 코드 기본값, 트레일링 = 운영 설정(활성 3.5% · 되돌림 1.2%). 손익률이라 환율 무관');
    expect(html).toContain('href="?tab=hold&amp;detail=trailing"');
    expect(t).toContain('포지션 추적 (청산 기준·고점)');
    expect(t).toContain('미체결 없음 ✓ 확인된 0');
    expect(t).not.toMatch(/평단|평가금|수량/);
  });
  test('스냅샷 3시간 초과 → 「오래됨 — 기준 스냅샷 MM-DD HH:MM (3시간 초과) · 」', () => {
    const tr = trade();
    if (tr.holdings.state !== 'ok') throw new Error('x');
    tr.holdings.data.stale = true; tr.holdings.data.snapshotAt = '2026-10-29T15:00:00+09:00';
    const t = text(renderToStaticMarkup(h(TradeHoldPanel, { trade: tr, tradeStatus: 'ok', tradeError: null, safety: safety(), displaySymbol: (s: string) => s, onGoTrailing: () => {} })));
    expect(t).toContain('오래됨 — 기준 스냅샷 10-29 15:00 (3시간 초과) · 청산 임계');
  });
  test('미체결 — 부분 체결 문구', () => {
    const t = text(renderToStaticMarkup(h(TradeHoldPanel, {
      trade: trade({ openOrders: { state: 'ok', data: [{ id: 5, symbol: 'NAS:D', market: 'overseas', side: 'buy', qty: 12, filled: 5 }] } }),
      tradeStatus: 'ok', tradeError: null, safety: safety(), displaySymbol: (s: string) => `종목${s}`, onGoTrailing: () => {},
    })));
    expect(t).toContain('종목NAS:D 해외 · 매수 12주 중 5주 체결 잔량 7주 · 부분 체결 — 체결 수는 1건으로 셈');
  });
  test('조회 실패 — 0 이 아니라 「! 조회 실패」', () => {
    const t = text(renderToStaticMarkup(h(TradeHoldPanel, { trade: null, tradeStatus: 'error', tradeError: 'network', safety: null, displaySymbol: (s: string) => s, onGoTrailing: () => {} })));
    expect(t).toContain('! 조회 실패 · network');
    expect(t).not.toContain('미체결 없음');
  });
});

describe('운영 기록 (§2.4.5) — 주문 상태·세션일', () => {
  test('OrderStatus 9종 전부 매핑, 「DRY_RUN」 없음', () => {
    expect(Object.keys(ORDER_STATUS_TEXT).sort()).toEqual(['accepted', 'blocked', 'cancelled', 'dry_run', 'failed', 'filled', 'partially_filled', 'pending', 'rejected']);
    expect(Object.values(ORDER_STATUS_TEXT).join()).not.toMatch(/DRY/);
    expect(orderStatusLine({ status: 'dry_run', blocked_by: null })).toBe('가상 · 송신 없음');
    expect(orderStatusLine({ status: 'blocked', blocked_by: 'kill_switch' })).toBe('차단 · 모든거래차단');
    expect(orderStatusLine({ status: 'rejected', blocked_by: null })).toBe('거부');
  });
  test('필터 「체결」은 filled·partially_filled 만 — 가상·차단·거부는 체결 아님', () => {
    expect(orderMatches('fill', 'filled')).toBe(true);
    expect(orderMatches('fill', 'partially_filled')).toBe(true);
    for (const s of ['dry_run', 'blocked', 'rejected', 'failed', 'accepted', 'pending', 'cancelled'] as const) expect(orderMatches('fill', s)).toBe(false);
    expect(orderMatches('rej', 'failed')).toBe(true);
    expect(orderMatches('dry', 'dry_run')).toBe(true);
    expect(orderMatches('blk', 'blocked')).toBe(true);
  });
  test('세션일 — 국내 KST 날짜, 해외 ET 날짜(KST 자정으로 자르지 않는다)', () => {
    // 2026-10-30 08:00 KST = 2026-10-29 19:00 ET(EDT)
    const o = (market: string, created_at: string): LogOrder => ({ id: 1, symbol: market === 'overseas' ? 'NAS:A' : '005930', side: 'buy', quantity: '1', status: 'dry_run', blocked_by: null, market, created_at });
    expect(orderSessionDate(o('overseas', '2026-10-29T23:00:00.000Z'))).toBe('2026-10-29');
    expect(orderSessionDate(o('domestic', '2026-10-29T23:00:00.000Z'))).toBe('2026-10-30');
    const sessions = {
      domestic: { session: { market: 'domestic' as const, sessionDate: '2026-10-30', tz: 'KST' as const }, anomalies: 0, lastRunAt: null },
      overseas: { session: { market: 'overseas' as const, sessionDate: '2026-10-29', tz: 'ET' as const }, anomalies: 1, lastRunAt: null },
    };
    const list = [o('overseas', '2026-10-29T23:00:00.000Z'), o('domestic', '2026-10-30T06:26:00.000Z'), o('domestic', '2026-10-29T06:00:00.000Z'), o('overseas', '2026-10-30T14:00:00.000Z')];
    expect(ordersInSessions(list, sessions).map(x => `${x.market}:${x.created_at}`)).toEqual([
      'overseas:2026-10-29T23:00:00.000Z', 'domestic:2026-10-30T06:26:00.000Z',
    ]);
  });
});

describe('운영 기록 — 깔때기 조회 실패 (R-UI ④)', () => {
  test('세션일을 못 읽으면 주문 기록이 「불러오는 중」에 멈추지 않고 「! 조회 실패」 + 다시 시도', () => {
    mockStateQueue.length = 0;
    // TradeLogPanel useState 순서: market · meta · metaError · retry · orders · ordersError · ordersAt · filter
    mockStateQueue.push(undefined, null, 'network', 0, [], null, null, 'all');
    const t = text(renderToStaticMarkup(h(TradeLogPanel, { trade: trade(), displaySymbol: (s: string) => s, reloadKey: 0, onGoOrders: () => {}, onGoNotes: () => {} })));
    const part = t.slice(t.indexOf('주문 기록'));
    expect(part).toContain('! 조회 실패 · network 세션일을 읽지 못해 오늘 주문을 거를 수 없습니다 — 비어 있는 것이 아닙니다');
    expect(part).toContain('다시 시도');
    expect(part.split('내 결정')[0]).not.toContain('불러오는 중');
  });
});

describe('거래 틀 (TradePage)', () => {
  test('띠(확인 중) → 세그먼트 3칸(기본 운용 현황, aria-pressed) → 본문', () => {
    mockStateQueue.length = 0;
    const html = renderToStaticMarkup(h(TradePage));
    const t = text(html);
    expect(t.indexOf('안전 상태 확인 중')).toBeGreaterThan(-1);
    expect(html).toMatch(/role="group" aria-label="거래 하위 화면"/);
    expect(html).toMatch(/<button id="trade-seg-now"[^>]*aria-pressed="true"/);
    expect(html).toMatch(/<button id="trade-seg-hold"[^>]*aria-pressed="false"/);
    expect(t.indexOf('운용 현황')).toBeLessThan(t.indexOf('보유·주문'));
    expect(t.indexOf('보유·주문')).toBeLessThan(t.indexOf('운영 기록'));
    expect(t.indexOf('운영 기록')).toBeLessThan(t.indexOf('승인 대기'));
    expect(html).not.toContain('/api/settings/safety');
  });
});

describe('깔때기 카드 세션 모드 (§2.4.5)', () => {
  test('새 읽기 라우트 — market 없으면 서버 기본 시장, 있으면 그 시장', () => {
    expect(sessionFunnelUrl()).toBe('/api/ops/funnel');
    expect(sessionFunnelUrl('overseas')).toBe('/api/ops/funnel?market=overseas');
  });
  test('세션 모드 첫 렌더는 「불러오는 중…」(옛 legacy 는 null — 대시보드 동작 그대로)', () => {
    mockStateQueue.length = 0;
    expect(text(renderToStaticMarkup(h(EvalFunnelCard, { reloadKey: 0, source: 'session' })))).toBe('불러오는 중…');
    expect(renderToStaticMarkup(h(EvalFunnelCard, { reloadKey: 0 }))).toBe('');
  });
});

describe('깔때기 기준 세션 조회 실패(basis.state=error) — 추정 세션일을 쓰지 않는다 (R-UI·WP-A Codex C2 ①)', () => {
  const S = (m: 'domestic' | 'overseas', d: string) => ({ session: { market: m, sessionDate: d, tz: m === 'domestic' ? 'KST' : 'ET' }, anomalies: null, lastRunAt: null });
  const dto = (basis: unknown, summary: unknown) => ({ ok: true, data: {
    generatedAt: '2026-11-01T10:00:00+09:00', basis, defaultMarket: 'domestic', market: 'domestic',
    sessions: { domestic: S('domestic', '2026-11-01'), overseas: S('overseas', '2026-10-31') }, summary,
  } });
  test('basis error → 머리 정보 없음(metaError=사유) · 본문은 「조회 실패」', () => {
    const out = readFunnelResponse(200, dto({ state: 'error', error: 'db_error', fallback: { defaultMarket: true, sessions: true } }, { state: 'error', error: 'db_error' }));
    expect(out.meta).toBeNull();
    expect(out.metaError).toBe('db_error');
    expect(out.data).toBeNull();
    expect(out.error).toBe('db_error');
  });
  test('basis ok → 지금과 같다(머리 정보 전달)', () => {
    const out = readFunnelResponse(200, dto({ state: 'ok' }, { state: 'ok', data: { runs: 1 } }));
    expect(out.meta?.sessions.domestic.session.sessionDate).toBe('2026-11-01');
    expect(out.metaError).toBeNull();
    expect(out.error).toBeNull();
  });
  test('401·봉투 아님·JSON 아님', () => {
    expect(readFunnelResponse(401, null).metaError).toBe('unauthorized');
    expect(readFunnelResponse(200, { ok: false }).metaError).toBe('api_error');
    expect(readFunnelResponse(200, null).metaError).toBe('bad_json');
  });
  test('그 결과 주문 기록은 「✓ 확인된 0」이 아니라 「세션일을 읽지 못해…」, 세그먼트에 날짜·이상 n 없음', () => {
    mockStateQueue.length = 0;
    mockStateQueue.push(undefined, null, 'db_error', 0, [], null, null, 'all');
    const html = renderToStaticMarkup(h(TradeLogPanel, { trade: trade(), displaySymbol: (s: string) => s, reloadKey: 0, onGoOrders: () => {}, onGoNotes: () => {} }));
    const t = text(html);
    expect(t).toContain('! 조회 실패 · db_error 세션일을 읽지 못해 오늘 주문을 거를 수 없습니다 — 비어 있는 것이 아닙니다');
    expect(t).not.toContain('오늘 이 상태의 주문 없음');
    expect(html).toMatch(/aria-label="깔때기 시장"><button type="button" aria-pressed="true">국내<\/button><button type="button" aria-pressed="false">해외<\/button>/);
  });
});
