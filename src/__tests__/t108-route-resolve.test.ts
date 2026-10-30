/**
 * T-108 C-1 — 가이드 §1.2 「기존 URL 은 하나도 404 가 되지 않는다」 표의 모든 행.
 *
 *  1) 쿼리 해석: 분석 `?tab=` 옛 8종(portfolio·trailing·leaderboard·notes·research·missed·orders·diagnostics) +
 *     새 3세그먼트 + 모르는 값 / 거래 `?tab=`·`?detail=` 조합.
 *  2) 경로 존재: 표에 있는 화면 경로의 `page.tsx` 가 그대로 있다(이 개편은 화면 경로를 새로 만들거나 없애지 않는다 — `/trade` 없음).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveAnalyticsRoute, analyticsQuery, ANALYTICS_DETAILS, ANALYTICS_SEGMENTS,
} from '@/app/analytics/route-resolve';
import { resolveTradeRoute, tradeQuery, TRADE_DETAILS, TRADE_SEGMENTS } from '@/app/recommend/route-resolve';

const APP = join(__dirname, '..', 'app');

describe('분석 /analytics?tab= 해석 (§1.2)', () => {
  test('쿼리 없음·빈 값 → 오늘 분석 (기본 세그먼트가 research → today 로 바뀜)', () => {
    expect(resolveAnalyticsRoute(null)).toEqual({ kind: 'segment', seg: 'today' });
    expect(resolveAnalyticsRoute(undefined)).toEqual({ kind: 'segment', seg: 'today' });
    expect(resolveAnalyticsRoute('')).toEqual({ kind: 'segment', seg: 'today' });
  });
  test.each(['today', 'verify', 'data'])('새 세그먼트 ?tab=%s', (t) => {
    expect(resolveAnalyticsRoute(t)).toEqual({ kind: 'segment', seg: t });
  });
  test.each([
    ['research', 'today'], ['leaderboard', 'today'],
    ['missed', 'verify'], ['diagnostics', 'verify'], ['portfolio', 'verify'],
  ])('옛 탭 ?tab=%s → 분석 안 상세 보기(%s 강조)', (t, seg) => {
    expect(resolveAnalyticsRoute(t)).toEqual({ kind: 'detail', seg, detail: t });
  });
  test.each([
    ['orders', '/recommend?tab=log&detail=orders'],
    ['notes', '/recommend?tab=log&detail=notes'],
    ['trailing', '/recommend?tab=hold&detail=trailing'],
  ])('거래로 옮겨 간 옛 탭 ?tab=%s → %s', (t, href) => {
    expect(resolveAnalyticsRoute(t)).toEqual({ kind: 'redirect', href });
  });
  test.each(['unknown', 'ORDERS', 'Research', 'constructor', '__proto__', 'toString', 'tab'])('그 밖의 값 %p → 조용히 오늘 분석', (t) => {
    expect(resolveAnalyticsRoute(t)).toEqual({ kind: 'segment', seg: 'today' });
  });
  test('옛 8탭 전부가 어딘가로 간다 — 기본값으로 떨어지는 옛 탭 없음', () => {
    const OLD = ['portfolio', 'trailing', 'leaderboard', 'notes', 'research', 'missed', 'orders', 'diagnostics'];
    for (const t of OLD) expect(resolveAnalyticsRoute(t).kind).not.toBe('segment');
  });
  test('리다이렉트 대상은 거래 해석기로 다시 풀면 해당 상세가 열린다(왕복)', () => {
    for (const t of ['orders', 'notes', 'trailing']) {
      const r = resolveAnalyticsRoute(t);
      if (r.kind !== 'redirect') throw new Error('redirect 아님');
      const q = new URLSearchParams(r.href.split('?')[1]);
      expect(r.href.startsWith('/recommend?')).toBe(true);
      expect(resolveTradeRoute(q.get('tab'), q.get('detail'))).toEqual({ seg: q.get('tab'), detail: t });
    }
  });
  test('주소창 쿼리 — 세그먼트·상세 모두 ?tab= 하나, 다시 풀면 같은 화면', () => {
    expect(analyticsQuery({ seg: 'verify' })).toBe('?tab=verify');
    expect(analyticsQuery({ seg: 'verify', detail: 'missed' })).toBe('?tab=missed');
    for (const s of ANALYTICS_SEGMENTS) expect(resolveAnalyticsRoute(analyticsQuery({ seg: s.id }).slice(5))).toEqual({ kind: 'segment', seg: s.id });
    for (const [d, v] of Object.entries(ANALYTICS_DETAILS)) {
      expect(resolveAnalyticsRoute(analyticsQuery({ seg: v.seg, detail: d as keyof typeof ANALYTICS_DETAILS }).slice(5))).toEqual({ kind: 'detail', seg: v.seg, detail: d });
    }
  });
  test('세그먼트 이름·순서(데모 v3 asub)', () => {
    expect(ANALYTICS_SEGMENTS.map(s => s.text)).toEqual(['오늘 분석', '검증·성과', '데이터 상태']);
  });
});

describe('거래 /recommend?tab=&detail= 해석 (§1.2)', () => {
  test('쿼리 없음 → 운용 현황 (옛 /recommend 그대로)', () => {
    expect(resolveTradeRoute(null, null)).toEqual({ seg: 'now', detail: null });
  });
  test.each(['now', 'hold', 'log'])('?tab=%s', (t) => {
    expect(resolveTradeRoute(t, null)).toEqual({ seg: t, detail: null });
  });
  test.each([
    ['log', 'orders'], ['log', 'notes'], ['hold', 'trailing'],
  ])('?tab=%s&detail=%s → 상세', (t, d) => {
    expect(resolveTradeRoute(t, d)).toEqual({ seg: t, detail: d });
  });
  test('짝이 안 맞는 detail 은 무시하고 tab 만 따른다', () => {
    expect(resolveTradeRoute('now', 'orders')).toEqual({ seg: 'now', detail: null });
    expect(resolveTradeRoute('hold', 'notes')).toEqual({ seg: 'hold', detail: null });
    expect(resolveTradeRoute('log', 'trailing')).toEqual({ seg: 'log', detail: null });
    expect(resolveTradeRoute(null, 'orders')).toEqual({ seg: 'now', detail: null });
  });
  test.each(['x', 'NOW', 'constructor', '__proto__'])('모르는 tab %p → 운용 현황', (t) => {
    expect(resolveTradeRoute(t, null)).toEqual({ seg: 'now', detail: null });
    expect(resolveTradeRoute('log', t)).toEqual({ seg: 'log', detail: null });
  });
  test('주소창 쿼리 왕복', () => {
    expect(tradeQuery({ seg: 'hold' })).toBe('?tab=hold');
    expect(tradeQuery({ seg: 'log', detail: 'orders' })).toBe('?tab=log&detail=orders');
    for (const s of TRADE_SEGMENTS) {
      const q = new URLSearchParams(tradeQuery({ seg: s.id }).slice(1));
      expect(resolveTradeRoute(q.get('tab'), q.get('detail'))).toEqual({ seg: s.id, detail: null });
    }
    for (const [d, v] of Object.entries(TRADE_DETAILS)) {
      const q = new URLSearchParams(tradeQuery({ seg: v.seg, detail: d as keyof typeof TRADE_DETAILS }).slice(1));
      expect(resolveTradeRoute(q.get('tab'), q.get('detail'))).toEqual({ seg: v.seg, detail: d });
    }
  });
  test('세그먼트 이름·순서(데모 v3 tsub), 기본 = 운용 현황', () => {
    expect(TRADE_SEGMENTS.map(s => s.text)).toEqual(['운용 현황', '보유·주문', '운영 기록']);
    expect(TRADE_SEGMENTS[0].id).toBe('now');
  });
});

describe('표의 화면 경로가 그대로 있다 — 404 없음', () => {
  test.each([
    'page.tsx',                       // /
    'recommend/page.tsx',             // /recommend
    'recommend/[id]/page.tsx',        // /recommend/[id]
    'recommend/build/page.tsx',       // /recommend/build
    'strategy/page.tsx',              // /strategy
    'order/page.tsx',                 // /order (→ /strategy)
    'analytics/page.tsx',             // /analytics
    'favorites/page.tsx',             // /favorites
    'favorites/[symbol]/page.tsx',    // /favorites/[symbol]
    'ai/page.tsx',                    // /ai
    'settings/page.tsx',              // /settings
    'settings/cash-ledger/page.tsx',  // /settings/cash-ledger (손익 기준 행 이동처)
    'profile/page.tsx',               // /profile
    'markets/page.tsx',               // /markets (입구 = 분석 › 데이터 상태, L-1)
  ])('src/app/%s', (rel) => {
    expect(existsSync(join(APP, rel))).toBe(true);
  });
  test('새 화면 경로 /trade 는 만들지 않는다', () => {
    expect(existsSync(join(APP, 'trade'))).toBe(false);
  });
});
