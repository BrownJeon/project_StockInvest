/**
 * T-056 라운드 2 (Reviewer R-3, 변이 M36) — 거래 리포트 라우트가 **현재 총자산을 모를 때 숫자(0)를 만들지 않는다.**
 *
 * 예전 배선 `getPortfolioTotalKRW(true).catch(() => 0)` 은 조회 실패를 0 으로 바꿔 "총 자산 ₩0 (…, -100.00%)" 리포트를 보낼 수 있었다.
 * 지금은 `getPortfolioTotalState` 가 `unknown` 이거나 던지면 `null` 을 `buildTradeReport`·`formatReportMessage` 에 넘기고,
 * 포맷터가 "조회 불가"로 적는다(포맷터 쪽은 `lib/reports/__tests__/trade-report-total-unknown.test.ts`).
 * 하네스는 `route.test.ts` 와 같고, 이 파일은 합계 배선만 본다.
 */
import type { NextRequest } from 'next/server';

let config: Record<string, string> = {};
const totalState = jest.fn();
const formatMock = jest.fn((..._a: unknown[]) => '리포트 본문');
const buildMock = jest.fn(async (o: { rangeStart: Date; rangeEnd: Date; totalKRW: unknown }) => ({
  rangeStart: o.rangeStart, rangeEnd: o.rangeEnd,
  buys: 0, sells: 0, buysAmountKRW: 0, sellsAmountKRW: 0, headerPnlKRW: 0, lifoPnlKRW: 0, perSymbol: [], churnSymbols: [],
}));

jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: () => undefined }));
jest.mock('@/lib/db', () => ({
  getPool: () => ({
    query: async (sql: string, params?: unknown[]) => {
      if (/SELECT/i.test(sql)) return [Object.entries(config).map(([key, value]) => ({ key, value }))];
      if (/INSERT INTO system_config/i.test(sql)) { const [k, v] = params as [string, string]; config[k] = v; return [{}]; }
      return [[]];
    },
  }),
}));
jest.mock('@/lib/notify/slack', () => ({ sendSlackAlert: async () => ({ ok: true }) }));
jest.mock('@/lib/notify/telegram', () => ({ sendTelegramAlert: async () => ({ ok: true }), mrkdwnToTelegramHtml: (s: string) => s }));
jest.mock('@/lib/safety/portfolio-total', () => ({ getPortfolioTotalState: (...a: unknown[]) => totalState(...a) }));
jest.mock('@/lib/reports/trading-day', () => ({ isTradingDay: async () => true }));
jest.mock('@/lib/strategy/eval-funnel-query', () => ({ getEvalFunnelSummary: async () => null }));
jest.mock('@/lib/reports/trade-report', () => ({
  buildTradeReport: (o: { rangeStart: Date; rangeEnd: Date; totalKRW: unknown }) => buildMock(o),
  formatReportMessage: (...a: unknown[]) => formatMock(...a),
  fetchPortfolioBaselineKRW: async () => 20_000_000,
  fetchSignalCandidates: async () => ({ buyWatchlist: [], holdings: [], sellPnl: [] }),
  fetchResearchDigest: async () => ({ trackedCount: 0, activeCount: 0, items: [], note: 'note' }),
  collectReportSymbols: () => [],
  EMPTY_CANDIDATES: { buyWatchlist: [], holdings: [], sellPnl: [] },
  EMPTY_RESEARCH_DIGEST: { trackedCount: 0, activeCount: 0, items: [], note: 'note' },
}));
jest.mock('@/lib/notify/symbol-name', () => ({ getSymbolLabels: async () => new Map() }));

import { POST } from '@/app/api/cron/trade-report/route';

const req = () => ({ nextUrl: new URL('http://localhost/api/cron/trade-report') }) as unknown as NextRequest;

beforeEach(() => {
  jest.clearAllMocks();
  config = {
    report_trade_enabled: 'true',
    report_trade_channel: JSON.stringify('telegram'),
    report_trade_mode: '"rolling"',
    report_trade_interval_min: '180',
    report_trade_anchor_kst: 'null',
    report_trade_last_sent_at: JSON.stringify(new Date(Date.now() - 6 * 3600_000).toISOString()),
  };
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test.each<[string, () => void]>([
  ['합계 상태가 unknown', () => totalState.mockResolvedValue({ status: 'unknown', reason: 'usd_cash_unknown', detail: 'x' })],
  ['합계 조회가 던짐', () => totalState.mockRejectedValue(new Error('KIS down'))],
])('🔴 %s → 포맷터·빌더에 0 이 아니라 null 이 간다 (조회 불가 경로)', async (_n, arrange) => {
  arrange();
  await POST(req());
  expect(formatMock).toHaveBeenCalledTimes(1);
  expect(formatMock.mock.calls[0][1]).toBeNull();
  expect(formatMock.mock.calls[0][2]).toBe(20_000_000);         // 기준선은 그대로 — 모르는 것은 현재값뿐
  expect(buildMock.mock.calls[0][0].totalKRW).toBeNull();
});

test('합계 ok → 그 숫자가 그대로 간다', async () => {
  totalState.mockResolvedValue({ status: 'ok', krw: 21_000_000 });
  await POST(req());
  expect(formatMock.mock.calls[0][1]).toBe(21_000_000);
  expect(totalState).toHaveBeenCalledWith(true);                // forceFresh — 리포트는 캐시를 쓰지 않는다
});

test('합계 ok 이고 값이 0 이면 0 은 0 이다 (확인된 0 과 모름을 구분)', async () => {
  totalState.mockResolvedValue({ status: 'ok', krw: 0 });
  await POST(req());
  expect(formatMock.mock.calls[0][1]).toBe(0);
});
