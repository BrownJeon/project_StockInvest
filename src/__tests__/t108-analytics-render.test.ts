/**
 * T-108 분석 화면 렌더 시험 (가이드 §2.5 · 데모 v3 anaToday/anaVerify/anaData) — 합성 DTO, jsdom 없음.
 * `useOpsPoll` 만 목으로 바꿔 주소별 응답을 넣는다(안전 상태 띠 `useSafetyState` 도 같은 훅을 쓴다).
 */
import * as ReactNS from 'react';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const polls = new Map<string, unknown>();
jest.mock('@/components/ops/useOpsPoll', () => {
  const actual = jest.requireActual('@/components/ops/useOpsPoll');
  return {
    ...actual,
    useOpsPoll: (url: string | null) => {
      const data = url ? polls.get(url) : undefined;
      return data === undefined
        ? { status: 'loading', data: null, lastOkAt: null, error: null, refresh: () => {} }
        : data === 'ERR'
          ? { status: 'error', data: null, lastOkAt: null, error: 'http_503', refresh: () => {} }
          : { status: 'ok', data, lastOkAt: 1, error: null, refresh: () => {} };
    },
  };
});
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }), useSearchParams: () => new URLSearchParams('') }));
jest.mock('@/lib/hooks/useSymbolMeta', () => ({ useSymbolMeta: () => ({ meta: {}, displaySymbol: (s: string) => `종목${s}`, marketFlag: () => '' }) }));
(globalThis as unknown as { React: typeof ReactNS }).React = ReactNS;

import type { AnalysisDataDTO, AnalysisRunRow, AnalysisTodayDTO, AnalysisVerifyDTO, ExitDetail, Metric, MetricState } from '@/lib/ops/metrics/types';
import { AnalyticsPage } from '@/app/analytics/AnalyticsPage';
import { TodayPanel, candidateRow } from '@/app/analytics/TodayPanel';
import { FailBody, stateChip } from '@/app/analytics/panel-parts';
import { VerifyPanel, exitRows } from '@/app/analytics/VerifyPanel';
import { DataPanel, recordDay, sourceWhen } from '@/app/analytics/DataPanel';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const NOW = Date.parse('2026-10-31T09:00:00+09:00');
function m<T>(state: MetricState, value: T | null = null, reason?: string): Metric<T> { return { state, value, asOf: null, ...(reason ? { reason } : {}) }; }

function run(market: 'domestic' | 'overseas', over: Partial<AnalysisRunRow> = {}): AnalysisRunRow {
  return {
    session: market === 'domestic' ? { market, sessionDate: '2026-10-30', tz: 'KST' } : { market, sessionDate: '2026-10-30', tz: 'ET' },
    runStartedAt: market === 'domestic' ? '2026-10-30T16:00:00+09:00' : '2026-10-31T08:00:00+09:00', runStatus: 'ok',
    evaluated: m('available', 44), ruleCandidates: m('available', 5), aiBuy: m('prep', null, 'record_off'),
    signalsCreated: m('available', 1), signalsBlocked: m('available', 1), signalsPending: m('zero', 0),
    topExclusion: m('prep', null, 'record_off'), nextRunAt: null, ...over,
  };
}
const TODAY: AnalysisTodayDTO = {
  part: 'today', generatedAt: '2026-10-31T09:00:00+09:00',
  runs: { state: 'ok', data: { domestic: run('domestic'), overseas: run('overseas') } },
  candidates: { state: 'ok', data: { rows: [
    { symbol: '005930', market: 'domestic', session: { market: 'domestic', sessionDate: '2026-10-30', tz: 'KST' }, origin: 'signal', aiDecision: 'BUY', confidence: 72, signalStatus: 'skipped', signalGate: 'validation_gate', exclusionCode: null, createdAt: '2026-10-30T16:00:00+09:00' },
    { symbol: 'NAS:MU', market: 'overseas', session: { market: 'overseas', sessionDate: '2026-10-30', tz: 'ET' }, origin: 'signal', aiDecision: 'BUY', confidence: 68, signalStatus: 'skipped', signalGate: 'validation_gate', exclusionCode: null, createdAt: '2026-10-31T08:00:00+09:00' },
  ], skipRows: m('prep', null, 'record_off') } },
  researchCount: m('available', 6),
};
const ld = (s: MetricState, v: { at: string | null; runsToday: number; sessionOpen: boolean } | null) => m(s, v);
const EXIT: ExitDetail = {
  engine: m('available', { enabled: true, hardStopEnabled: false }),
  lastEval: { domestic: ld('available', { at: '2026-10-30T15:21:00+09:00', runsToday: 57, sessionOpen: false }), overseas: ld('off_hours', { at: null, runsToday: 0, sessionOpen: false }) },
  nextOverseasOpenKst: null, nextOverseasOpenChange: null,
  judgments: {
    domestic: m('partial', { noFire: 1, hardStopOffHit: 1, hardStopOffDays: 1, dataErrors: 0, fired: 0, trailingActive: 0, hardStopOffTicks: 55, hardStopOffDaysCapped: false, createFailed: 0 }),
    overseas: m('off_hours', null),
  },
  proposals: m('available', { virtual: 1, awaitingApproval: 0, submittedLive: 0, blockedByKill: 0, filled: 0, firstKind: 'eod_loss_cut', firstAt: '2026-10-30T15:26:00+09:00', expired: 0 }),
  coverage: { domestic: m('available', { positions: 2, evaluated: 2, dataErrors: 0, notEvaluated: 0 }), overseas: m('off_hours', { positions: 4, evaluated: 0, dataErrors: 0, notEvaluated: 4 }) },
  zones: m('available', { hardStop: 1, eodCut: 0, takeProfit: 1, trailingActive: 1, neutral: 1, notEvaluated: 2, snapshotAt: null }),
  gap: m('prep', { expectedSlots: 72, runs: 57, gap: 15, balancesUnknown: 0 }, 'approx_until_t112'),
};
const VERIFY: AnalysisVerifyDTO = {
  part: 'verify', generatedAt: '2026-10-31T09:00:00+09:00',
  postmortem: { state: 'ok', data: { population: m('partial', 8), cardsOnly: true, entry: 'd1open', lastBarDate: { domestic: '2026-10-30', overseas: '2026-10-29' },
    rows: [1, 3, 5, 10].map((hz, i) => ({ horizon: hz as 1 | 3 | 5 | 10, n: [8, 6, 4, 2][i], medianExcessPct: m<number>('prep', null, 'not_implemented') })) } },
  exit: { state: 'ok', data: EXIT },
  paperFills: m('available', 3),
};
const DATA: AnalysisDataDTO = {
  part: 'data', generatedAt: '2026-10-31T09:00:00+09:00',
  sources: { state: 'ok', data: [
    { id: 'portfolio_snapshot', lastOkAt: '2026-10-31T08:45:00+09:00', state: 'available', dateRef: null, streak: null },
    { id: 'daily_bars_us', lastOkAt: '2026-10-31T07:00:00+09:00', state: 'available', dateRef: '2026-10-29', streak: null },
    { id: 'news_domestic', lastOkAt: null, state: 'partial', dateRef: '2026-10-28', streak: 2 },
    { id: 'news_overseas', lastOkAt: null, state: 'available', dateRef: '2026-10-30', streak: 0 },
    { id: 'broker_ledger', lastOkAt: null, state: 'error', reason: 'db_error', dateRef: null, streak: null },
  ] },
  uptime: { state: 'ok', data: [
    { group: 'analysis', days: 2, ok: 0, expected: null, state: 'prep', reason: 'under_7_days', firstRecordAt: '2026-10-30T21:05:27+09:00' },
    { group: 'collection', days: 0, ok: 0, expected: null, state: 'prep', reason: 'record_off', firstRecordAt: null },
  ] },
};

beforeEach(() => polls.clear());

describe('분석 틀 (AnalyticsPage)', () => {
  test('MiniStrip(분석) → 세그먼트 3칸 오늘 분석·검증·성과·데이터 상태, 기본 = 오늘 분석', () => {
    const html = renderToStaticMarkup(h(AnalyticsPage));
    const t = text(html);
    expect(t.startsWith('분석')).toBe(true);
    expect(html).toMatch(/role="group" aria-label="분석 하위 화면"/);
    expect(html).toMatch(/<button id="ana-seg-today"[^>]*aria-pressed="true"[^>]*>오늘 분석</);
    expect(html).toMatch(/<button id="ana-seg-verify"[^>]*aria-pressed="false"[^>]*>검증·성과</);
    expect(html).toMatch(/<button id="ana-seg-data"[^>]*>데이터 상태</);
  });
});

describe('오늘 분석', () => {
  test('장마감 AI 분석 표 · 후보(시그널로 이어진 종목 + 준비 중 행) · 종목별 입구 3개', () => {
    polls.set('/api/ops/analysis?part=today', TODAY);
    const html = renderToStaticMarkup(h(TodayPanel, { stage: 'observe', displaySymbol: (s: string) => `종목${s}`, onGoDetail: () => {}, nowMs: NOW }));
    const t = text(html);
    expect(t).toContain('장마감 AI 분석 시장별 세션일');
    expect(t).toContain('평가 종목 44 44');
    expect(t).toContain('종목005930 국내 · AI 매수 판단 · 신뢰도 72 시그널 생성 → ⊘ 차단 · 검증 관문');
    expect(t).toContain('종목NAS:MU 해외 · AI 매수 판단 · 신뢰도 68 ET 10-30 세션 · 시그널 생성 → ⊘ 차단 · 검증 관문');
    expect(t).toContain('AI 매수 안 함 · 제외 사유 목록 준비 중 기준 판단 기록(T-112) 뒤 — 지금은 시그널로 이어진 것만 남습니다');
    expect(t).toContain('리서치 추적 6종목');
    expect(html).toContain('href="?tab=research"');
    expect(html).toContain('href="?tab=leaderboard"');
    expect(html).toContain('href="/favorites"');
    expect(t).toContain('관심 종목 관리 (현재 즐겨찾기)');
  });
  test('조회 실패 — 「! 조회 실패 · {원인 말}」 + 다시 시도, 0 을 쓰지 않는다 (T-130 4-1: 영문 코드·원인 코드 병기 없음)', () => {
    polls.set('/api/ops/analysis?part=today', 'ERR');
    const html = renderToStaticMarkup(h(TodayPanel, { stage: 'observe', displaySymbol: (s: string) => s, onGoDetail: () => {}, nowMs: NOW }));
    const t = text(html);
    expect(t).toContain('! 조회 실패 · 서버 오류 503');
    expect(t).not.toContain('http_503');
    expect(html).not.toContain('<code');
    expect(t).toContain('다시 시도');
    expect(t).not.toMatch(/평가 종목 0/);
  });
  // T-130 D7-A — `skipped` 는 두 경우다: 검증 관문에 막힘(indicators.gate) / 그 밖(수량 1주 미만 등 gate 없음). 같은 「차단」으로 부르지 않는다.
  test('후보 줄 — skipped + gate=validation_gate → 「⊘ 차단 · 검증 관문」(경고 줄) / gate 없음 → 「건너뜀 · 사유 기록 없음」(보통 줄)', () => {
    const base = TODAY.candidates.state === 'ok' ? TODAY.candidates.data.rows[0] : (() => { throw new Error('fixture'); })();
    const id = (s: string) => `종목${s}`;
    expect(candidateRow({ ...base, signalGate: 'validation_gate' }, id)).toEqual({
      severity: 'w', glyph: '⊘', title: '종목005930 국내 · AI 매수 판단 · 신뢰도 72', sub: '시그널 생성 → ⊘ 차단 · 검증 관문',
    });
    expect(candidateRow({ ...base, signalGate: null }, id)).toEqual({
      severity: 'n', glyph: '·', title: '종목005930 국내 · AI 매수 판단 · 신뢰도 72', sub: '시그널 생성 → 건너뜀 · 사유 기록 없음',
    });
    expect(candidateRow({ ...base, signalGate: 'something_else' }, id).sub).toBe('시그널 생성 → 건너뜀 · 사유 기록 없음');
    // 그 밖 상태는 지금 사전 그대로
    for (const [st, want] of [['awaiting_approval', '승인 대기'], ['expired', '만료'], ['auto_submitted', '자동 제출'], ['weird', '처리됨']] as const) {
      expect(candidateRow({ ...base, signalStatus: st, signalGate: null }, id)).toMatchObject({ severity: 'n', glyph: '·', sub: `시그널 생성 → ${want}` });
    }
  });
  test('후보 줄 렌더 — 같은 화면에서 gate 있음/없음이 서로 다른 칸에 그려진다', () => {
    const d = TODAY.candidates.state === 'ok' ? TODAY.candidates.data : null;
    if (!d) throw new Error('fixture');
    polls.set('/api/ops/analysis?part=today', { ...TODAY, candidates: { state: 'ok', data: { ...d, rows: [d.rows[0], { ...d.rows[1], signalGate: null }] } } });
    const t = text(renderToStaticMarkup(h(TodayPanel, { stage: 'observe', displaySymbol: (s: string) => `종목${s}`, onGoDetail: () => {}, nowMs: NOW })));
    expect(t).toContain('종목005930 국내 · AI 매수 판단 · 신뢰도 72 시그널 생성 → ⊘ 차단 · 검증 관문');
    expect(t).toContain('종목NAS:MU 해외 · AI 매수 판단 · 신뢰도 68 ET 10-30 세션 · 시그널 생성 → 건너뜀 · 사유 기록 없음');
  });
  test('AI 매수 안 함 줄 — 제외 사유는 사전의 말(코드→문구 표), 모르는 코드는 「알 수 없는 사유」, 코드 없음은 「제외 사유 기록 없음」', () => {
    const base = TODAY.candidates.state === 'ok' ? TODAY.candidates.data.rows[0] : (() => { throw new Error('fixture'); })();
    const skip = (exclusionCode: string | null) => candidateRow({ ...base, origin: 'judgment_skip', aiDecision: 'SKIP', signalStatus: null, signalGate: null, exclusionCode }, (s) => s);
    expect(skip('low_confidence').sub).toBe('제외 사유 AI 신뢰도 60 미만');
    expect(skip('prefilter_unaffordable').sub).toBe('제외 사유 사전 금액 필터 — 1주 가격이 커서 제외');
    expect(skip('brand_new').sub).toBe('제외 사유 알 수 없는 사유');
    expect(skip(null).sub).toBe('제외 사유 기록 없음');
    expect(skip('low_confidence').sub).not.toContain('low_confidence');
  });
  test('판단 기록 조회 실패 칩·리서치 수 실패 칩도 한국어 — 코드 병기(<code>) 없음', () => {
    const d = TODAY.candidates.state === 'ok' ? TODAY.candidates.data : null;
    if (!d) throw new Error('fixture');
    polls.set('/api/ops/analysis?part=today', {
      ...TODAY, researchCount: m('error', null, 'db_error'),
      candidates: { state: 'ok', data: { ...d, skipRows: m('error', null, 'timeout') } },
    });
    const html = renderToStaticMarkup(h(TodayPanel, { stage: 'observe', displaySymbol: (s: string) => s, onGoDetail: () => {}, nowMs: NOW }));
    const t = text(html);
    expect(t).toContain('! 조회 실패 · 응답 시간 초과');
    expect(t).toContain('! 조회 실패 · DB 오류');
    expect(t).not.toMatch(/timeout|db_error/);
    expect(html).not.toContain('<code');
  });
});

describe('검증·성과', () => {
  test('사후 성과 — 건수 적음 · 8건, 중앙값 준비 중, 경고 foot, 놓친 기회 입구', () => {
    polls.set('/api/ops/analysis?part=verify', VERIFY);
    const html = renderToStaticMarkup(h(VerifyPanel, { stage: 'observe', onGoDetail: () => {}, nowMs: NOW }));
    const t = text(html);
    expect(t).toContain('사후 성과 건수 적음 · 8건 (30건 미만)');
    expect(t).toContain('D+1 8 준비 중');
    expect(t).toContain('D+10 2 준비 중');
    expect(t).toContain('30건 미만 — 성과 판단 근거로 쓰지 마세요(T-095 경고 규칙)');
    // Designer 검토 — 놓친 기회 조회는 매도도 거르지 않아 「매수」가 아니라 「매매」
    expect(t).toContain('놓친 기회 — AI 매매 안 함·거절 시그널의 이후 가격');
    expect(html).toContain('href="?tab=missed"');
    expect(html).toContain('href="?tab=diagnostics"');
    expect(html).toContain('href="?tab=portfolio"');
    expect(t).toContain('포트폴리오 · 자산 추이 (계좌 전체)');
    expect(t).toContain('실거래 전환 뒤 — 지금은 체결 0이라 표시할 것이 없습니다');
  });
  test('청산 로직 X1~X6 — 칩 규칙(available 없음 · 30일 보존 한정 · X6 준비 중)', () => {
    const rows = exitRows(EXIT, NOW);
    expect(rows.map(r => r.k)).toEqual(['X1 가동', 'X2 평가 대상', 'X3 트리거별 판정', 'X4 가상 청산 제안', 'X5 임계 대비 현재', 'X6 기록 공백']);
    expect(rows[0].d).toBe('ON · 손실한도 손절 OFF · 국내 평가 57회 / 해외 장외');
    expect(rows[0].chip).toBeNull();
    expect(rows[1].d).toBe('국내 2 평가 / 해외 장외 → 종목별은 거래 › 보유·주문');
    expect(rows[2].d).toBe('국내 손실한도 손절 OFF — 한도 도달 1종목(평가 55회) · 해당 없음 1 · 데이터 이상 0 / 해외 장외');
    expect(text(renderToStaticMarkup(h('div', null, rows[2].chip)))).toBe('30일 보존 한정');
    expect(rows[3].d).toBe('가상 청산 1 (장마감 전 손절) · 승인 대기 0 · 만료 0');
    expect(rows[3].chip).toBeNull();
    expect(rows[4].chip).toBeNull();
    expect(rows[5].d).toBe('기대 슬롯 약 72 · 실행 57 · 공백 약 15 (근사)');
    expect(text(renderToStaticMarkup(h('div', null, rows[5].chip)))).toBe('준비 중 — 완전판 T-112');
  });
  test('X3 — 청산 시그널 생성 실패가 있으면 따로 보인다', () => {
    const j = EXIT.judgments.domestic.value!;
    const rows = exitRows({ ...EXIT, judgments: { ...EXIT.judgments, domestic: m('available', { ...j, createFailed: 2 }) } }, NOW);
    expect(rows[2].d).toContain('청산 시그널 생성 실패 2종목');
  });
  // T-130 D8-A·5번 — 청산 이름(목표 익절·트레일링 스탑)과 「차단」 표기(주문 차단 + 모든거래차단 ON)
  test('X3·X4·X5 — 청산 이름 목표 익절·트레일링 스탑, 모든거래차단은 「주문 차단 n · 모든거래차단 ON」', () => {
    const j = EXIT.judgments.domestic.value!;
    const pr = EXIT.proposals.value!;
    const rows = exitRows({
      ...EXIT,
      judgments: { ...EXIT.judgments, domestic: m('available', { ...j, trailingActive: 2 }) },
      proposals: m('available', { ...pr, firstKind: 'target_profit', blockedByKill: 3, total: 4 }),
    }, NOW);
    expect(rows[2].d).toContain('트레일링 스탑 활성 2');
    expect(rows[3].d).toBe('청산 시그널 4 · 가상 청산 1 (목표 익절) · 승인 대기 0 · 만료 0 · 주문 차단 3 · 모든거래차단 ON');
    expect(rows[4].d).toBe('손실한도 1 · 장마감 전 손절 0 · 목표 익절 1 · 트레일링 스탑 1 · 중립 1 · 미평가 2 → 거래 › 보유·주문 (종목별 손익률·임계 거리)');
    const trailing = exitRows({ ...EXIT, proposals: m('available', { ...pr, firstKind: 'trailing_stop' }) }, NOW)[3].d;
    expect(trailing).toContain('가상 청산 1 (트레일링 스탑)');
  });
  test('4-2 지표 자체 실패 — 잔고를 읽지 못함·청산 스위치 읽기 실패·보유 종목 읽기 실패는 칩 전체 문구(영문 코드·코드 병기 없음)', () => {
    const chipText = (node: unknown) => text(renderToStaticMarkup(h('div', null, node as never)));
    const bu = exitRows({ ...EXIT, lastEval: { ...EXIT.lastEval, domestic: ld('error', { at: '2026-10-30T15:21:00+09:00', runsToday: 3, sessionOpen: true }) } }, NOW);
    // marketChip 은 시장의 상태 칩을 그대로 쓴다 — reason 이 없으면 「원인 모름」
    expect(chipText(bu[0].chip)).toBe('! 조회 실패 · 원인 모름');
    const withReason = (reason: string) => ({ ...ld('error', { at: null, runsToday: 0, sessionOpen: true }), reason });
    expect(chipText(exitRows({ ...EXIT, lastEval: { ...EXIT.lastEval, domestic: withReason('balances_unknown') } }, NOW)[0].chip)).toBe('! 잔고를 읽지 못함');
    expect(chipText(exitRows({ ...EXIT, engine: m('error', null, 'exit_switch_db_error') }, NOW)[0].chip)).toBe('! 청산 스위치 읽기 실패');
    expect(chipText(exitRows({ ...EXIT, zones: m('error', null, 'holdings_error') }, NOW)[4].chip)).toBe('! 보유 종목 읽기 실패');
    expect(chipText(exitRows({ ...EXIT, zones: m('error', null, 'holdings_error') }, NOW)[4].chip)).not.toContain('holdings_error');
    // 알 수 없는 코드
    expect(chipText(exitRows({ ...EXIT, zones: m('error', null, 'totally_new') }, NOW)[4].chip)).toBe('! 조회 실패 · 알 수 없는 사유');
  });
  test('엔진 OFF · 조회 실패 칩', () => {
    const off = exitRows({
      ...EXIT, engine: m('available', { enabled: false, hardStopEnabled: false }),
      judgments: { domestic: m('blocked', null, 'engine_off'), overseas: m('blocked', null, 'engine_off') },
      proposals: m('blocked', null, 'engine_off'),
    }, NOW);
    expect(off[0].d.startsWith('OFF — 자동 손절·익절 없음')).toBe(true);
    expect(off[2].d).toBe('국내 — (엔진 꺼짐) / 해외 — (엔진 꺼짐)');
    expect(off[3].d).toBe('— (엔진 꺼짐)');
    expect(off[3].chip).toBeNull();
    const err = exitRows({ ...EXIT, engine: m('error', null, 'db_error') }, NOW);
    expect(err[0].d.startsWith('— ·')).toBe(true);
    expect(text(renderToStaticMarkup(h('div', null, err[0].chip)))).toBe('! 조회 실패 · DB 오류');   // 검증·성과는 한국어만(코드 병기 없음)
  });
});

describe('상태 칩 공용(panel-parts) — 차단 사유·코드 병기 규칙', () => {
  const chip = (node: unknown) => renderToStaticMarkup(h('div', null, node as never));
  test('stateChip blocked — 막은 장치와 함께 / 엔진 꺼짐은 off 칩 / 사유 모르면 「⊘ 차단」', () => {
    expect(chip(stateChip({ state: 'blocked', asOf: null, reason: 'validation_gate' }, { nowMs: NOW }))).toBe('<div><span class="st blocked">⊘ 차단 · 검증 관문</span></div>');
    expect(chip(stateChip({ state: 'blocked', asOf: null, reason: 'engine_off' }, { nowMs: NOW }))).toBe('<div><span class="st off">엔진 꺼짐</span></div>');
    expect(chip(stateChip({ state: 'blocked', asOf: null }, { nowMs: NOW }))).toBe('<div><span class="st blocked">⊘ 차단</span></div>');
  });
  test('stateChip error — 기본은 한국어만, showCode 일 때만 뒤에 <code class="stCode">원문</code>', () => {
    expect(chip(stateChip({ state: 'error', asOf: null, reason: 'db_error' }, { nowMs: NOW }))).toBe('<div><span class="st error">! 조회 실패 · DB 오류</span></div>');
    expect(chip(stateChip({ state: 'error', asOf: null, reason: 'db_error' }, { nowMs: NOW, showCode: true }))).toBe(
      '<div><span class="st error">! 조회 실패 · DB 오류<code class="stCode">db_error</code></span></div>');
    expect(chip(stateChip({ state: 'error', asOf: null, reason: 'balances_unknown' }, { nowMs: NOW, showCode: true }))).toBe(
      '<div><span class="st error">! 잔고를 읽지 못함<code class="stCode">balances_unknown</code></span></div>');
    // 사유 자체가 없으면 코드도 없다(지어내지 않는다)
    expect(chip(stateChip({ state: 'error', asOf: null }, { nowMs: NOW, showCode: true }))).toBe('<div><span class="st error">! 조회 실패 · 원인 모름</span></div>');
  });
  test('FailBody — 기본 한국어만, showCode 는 데이터 상태 패널 전용', () => {
    expect(chip(h(FailBody, { code: 'http_503' }))).not.toContain('<code');
    expect(text(chip(h(FailBody, { code: 'http_503' })))).toBe('! 조회 실패 · 서버 오류 503');
    expect(chip(h(FailBody, { code: 'http_503', showCode: true }))).toContain('<code class="stCode">http_503</code>');
    expect(text(chip(h(FailBody, { code: 'unauthorized' })))).toBe('! 로그인 필요');
  });
});

describe('데이터 상태', () => {
  test('T-160은 기존 영역 뒤에 사유와 검증된 후속 실행을 추가한다', () => {
    polls.set('/api/ops/analysis?part=data', {
      ...DATA,
      anomalyDetails: { state: 'ok', data: { date: '2026-10-31', rows: [
        { id: 'fx_usdkrw', kind: 'source', label: '환율 USD/KRW', at: null, summary: '최신 데이터 지연', reason: '기준 시각까지 새 데이터가 확인되지 않았습니다.', evidence: null, laterOkAt: null },
        { id: 'run-1', kind: 'job', label: '손절 알림', at: '2026-10-31T08:36:00+09:00', summary: '제한 시간 초과', reason: '서버 응답을 받지 못했습니다.', evidence: '요청 도구 종료 코드 28', laterOkAt: '2026-10-31T08:38:00+09:00' },
        { id: 'run-2', kind: 'job', label: '시그널 사후 추적', at: '2026-10-31T08:35:00+09:00', summary: '응답 없음', reason: '응답 없음 · 세부 원인 미기록', evidence: null, laterOkAt: null },
      ] } },
    });
    const html = renderToStaticMarkup(h(DataPanel, { nowMs: NOW }));
    const t = text(html);
    expect(html).toContain('id="run-anomalies" tabindex="-1"');
    expect(t.indexOf('데이터 이상·실행 실패 내역')).toBeGreaterThan(t.indexOf('시장 개장 상태'));
    expect(t).toContain('데이터 원천 문제 환율 USD/KRW');
    expect(t).toContain('손절 알림 08:36 · 제한 시간 초과');
    expect(t).toContain('요청 도구 종료 코드 28 이후 상태 이후 정상 실행 확인 · 08:38');
    expect(t).toContain('응답 없음 · 세부 원인 미기록');
    expect(t).toContain('이후 정상 실행 미확인');
  });
  test('T-160은 내역 조회 실패를 0건으로 표시하지 않는다', () => {
    polls.set('/api/ops/analysis?part=data', { ...DATA, anomalyDetails: { state: 'error', error: 'db_error' } });
    const error = text(renderToStaticMarkup(h(DataPanel, { nowMs: NOW })));
    expect(error).toContain('가동률');
    expect(error).toContain('이상 내역 조회 실패 현재 내역을 확인할 수 없습니다. 다시 조회');
    expect(error).not.toContain('기록된 이상 내역이 없습니다.');
    polls.set('/api/ops/analysis?part=data', { ...DATA, anomalyDetails: { state: 'ok', data: { date: '2026-10-31', rows: [] } } });
    expect(text(renderToStaticMarkup(h(DataPanel, { nowMs: NOW })))).toContain('이 날짜에 기록된 이상 내역이 없습니다.');
  });
  test('가동률(기록 n일째) · 원천별 신선도 칩 · /markets 입구(L-1)', () => {
    polls.set('/api/ops/analysis?part=data', DATA);
    const html = renderToStaticMarkup(h(DataPanel, { nowMs: NOW }));
    const t = text(html);
    expect(t).toContain('가동률 세션일 · 주 단위');
    expect(t).toContain('장마감 분석 (국내·해외) 기록 2일째 — 주 단위 비율은 7일 뒤');
    expect(t).toContain('데이터 수집 (뉴스·일봉·스냅샷·공시) 준비 중');
    expect(t).toContain('포트폴리오 스냅샷 · 08:45 정상');
    expect(t).toContain('일봉 해외 · ET 10-29 정상');
    expect(t).toContain('뉴스 국내 · 2일 연속 0건 일부 저하');
    expect(t).not.toMatch(/degraded/);
    expect(t).toContain('뉴스 해외 · 10-30 정상');
    // D4-A: 데이터 상태에서만 한국어 칩 뒤에 원인 코드 원문을 작게(<code>) 붙인다
    expect(t).toContain('브로커 원장 · — ! 조회 실패 · DB 오류 db_error');
    expect(html).toContain('<code class="stCode">db_error</code>');
    expect(t).toContain('예정 회차 대비 정상 회차 — 분자는 ok 만(D6), 일부 완료·입력 저하는 별도 선');
    expect(t).toContain('「날짜 파일이 있다」는 성공 증거가 아닙니다 — 마지막 성공 시각 기준');
    expect(html).toContain('href="/markets"');
    expect(t.indexOf('시장 개장 상태')).toBeGreaterThan(t.indexOf('「날짜 파일이 있다」'));
  });
  test('조회 실패 — 데이터 상태에서만 한국어 칩 뒤에 원인 코드가 붙는다 (다른 분석 패널·홈은 한국어만)', () => {
    polls.set('/api/ops/analysis?part=data', 'ERR');
    const dataHtml = renderToStaticMarkup(h(DataPanel, { nowMs: NOW }));
    expect(text(dataHtml)).toContain('! 조회 실패 · 서버 오류 503 http_503');
    expect(dataHtml).toContain('<code class="stCode">http_503</code>');
    polls.set('/api/ops/analysis?part=verify', 'ERR');
    polls.set('/api/ops/analysis?part=today', 'ERR');
    const verifyHtml = renderToStaticMarkup(h(VerifyPanel, { stage: 'observe', onGoDetail: () => {}, nowMs: NOW }));
    const todayHtml = renderToStaticMarkup(h(TodayPanel, { stage: 'observe', displaySymbol: (s: string) => s, onGoDetail: () => {}, nowMs: NOW }));
    for (const html of [verifyHtml, todayHtml]) { expect(html).not.toContain('<code'); expect(text(html)).not.toContain('http_503'); }
  });
  test('가동률 섹션 오류·원천 섹션 오류도 코드 병기 · 영문 degraded 없음', () => {
    polls.set('/api/ops/analysis?part=data', {
      ...DATA, uptime: { state: 'error', error: 'db_error' }, sources: { state: 'error', error: 'not_migrated' },
    });
    const html = renderToStaticMarkup(h(DataPanel, { nowMs: NOW }));
    const t = text(html);
    expect(t).toContain('! 조회 실패 · DB 오류 db_error');
    expect(t).toContain('! 조회 실패 · 기록 표 준비 전 not_migrated');
    expect(t).not.toMatch(/degraded/);
  });
  test('recordDay — KST 날짜 기준 첫날 = 1일째', () => {
    expect(recordDay('2026-10-30T21:05:27+09:00', Date.parse('2026-10-30T23:59:00+09:00'))).toBe(1);
    expect(recordDay('2026-10-30T21:05:27+09:00', NOW)).toBe(2);
    expect(recordDay(null, NOW)).toBeNull();
  });
  test('sourceWhen — 국내 일봉 MM-DD · 해외 일봉 ET', () => {
    expect(sourceWhen({ id: 'daily_bars_kr', lastOkAt: null, state: 'available', dateRef: '2026-10-30', streak: null }, NOW)).toBe('10-30');
    expect(sourceWhen({ id: 'news_overseas', lastOkAt: '2026-10-30T07:00:00+09:00', state: 'available', dateRef: null, streak: 0 }, NOW)).toBe('10-30 07:00');
  });
});
