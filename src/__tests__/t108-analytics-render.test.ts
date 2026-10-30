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
import { TodayPanel } from '@/app/analytics/TodayPanel';
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
    { symbol: '005930', market: 'domestic', session: { market: 'domestic', sessionDate: '2026-10-30', tz: 'KST' }, origin: 'signal', aiDecision: 'BUY', confidence: 72, signalStatus: 'skipped', exclusionCode: null, createdAt: '2026-10-30T16:00:00+09:00' },
    { symbol: 'NAS:MU', market: 'overseas', session: { market: 'overseas', sessionDate: '2026-10-30', tz: 'ET' }, origin: 'signal', aiDecision: 'BUY', confidence: 68, signalStatus: 'skipped', exclusionCode: null, createdAt: '2026-10-31T08:00:00+09:00' },
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
    expect(t).toContain('종목005930 국내 · AI 매수 판단 · 신뢰도 72 시그널 생성 → 검증 관문 차단');
    expect(t).toContain('종목NAS:MU 해외 · AI 매수 판단 · 신뢰도 68 ET 10-30 세션 · 시그널 생성 → 검증 관문 차단');
    expect(t).toContain('AI 매수 안 함 · 제외 사유 목록 준비 중 기준 판단 기록(T-112) 뒤 — 지금은 시그널로 이어진 것만 남습니다');
    expect(t).toContain('리서치 추적 6종목');
    expect(html).toContain('href="?tab=research"');
    expect(html).toContain('href="?tab=leaderboard"');
    expect(html).toContain('href="/favorites"');
    expect(t).toContain('관심 종목 관리 (현재 즐겨찾기)');
  });
  test('조회 실패 — 「! 조회 실패 · {code}」 + 다시 시도, 0 을 쓰지 않는다', () => {
    polls.set('/api/ops/analysis?part=today', 'ERR');
    const t = text(renderToStaticMarkup(h(TodayPanel, { stage: 'observe', displaySymbol: (s: string) => s, onGoDetail: () => {}, nowMs: NOW })));
    expect(t).toContain('! 조회 실패 · http_503');
    expect(t).toContain('다시 시도');
    expect(t).not.toMatch(/평가 종목 0/);
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
    expect(text(renderToStaticMarkup(h('div', null, err[0].chip)))).toBe('! 조회 실패 · db_error');
  });
});

describe('데이터 상태', () => {
  test('가동률(기록 n일째) · 원천별 신선도 칩 · /markets 입구(L-1)', () => {
    polls.set('/api/ops/analysis?part=data', DATA);
    const html = renderToStaticMarkup(h(DataPanel, { nowMs: NOW }));
    const t = text(html);
    expect(t).toContain('가동률 세션일 · 주 단위');
    expect(t).toContain('장마감 분석 (국내·해외) 기록 2일째 — 주 단위 비율은 7일 뒤');
    expect(t).toContain('데이터 수집 (뉴스·일봉·스냅샷·공시) 준비 중');
    expect(t).toContain('포트폴리오 스냅샷 · 08:45 정상');
    expect(t).toContain('일봉 해외 · ET 10-29 정상');
    expect(t).toContain('뉴스 국내 · 2일 연속 0건 degraded');
    expect(t).toContain('뉴스 해외 · 10-30 정상');
    expect(t).toContain('브로커 원장 · — ! 조회 실패 · db_error');
    expect(t).toContain('「날짜 파일이 있다」는 성공 증거가 아닙니다 — 마지막 성공 시각 기준');
    expect(html).toContain('href="/markets"');
    expect(t.indexOf('시장 개장 상태')).toBeGreaterThan(t.indexOf('「날짜 파일이 있다」'));
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
