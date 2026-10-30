/**
 * T-108 홈 A3 「사후 결과 추적」 · 분석 › 검증·성과 「사후 성과」 건수 (가이드 §4.7 A3 · §4.6 verify).
 *
 * 모집단(v1): 최근 20 세션일의 **장마감 시그널**(`scenario_source='post-market'`, 상태 pending·skipped·approved·approved_pending_entry·expired)
 * = AI 가 매수로 판단해 시그널이 된 것만(`cardsOnly: true` — 「매수 안 함」 종목은 판단 기록(T-112)이 쌓여야 복원된다.
 * 판단 기록 기반 모집단은 기록 스위치가 꺼져 있어 v1 에서 쓰지 않는다).
 * D0 = 시그널 생성 시각의 **현지 날짜**(국내 KST, 해외 ET — 08:00 KST 실행은 직전 ET 세션 날짜).
 * 추적 완료 = D0 다음 확정 일봉이 10개 이상(D+10 도달) — 기간 추정이 아니라 **봉 존재 기준**(일봉 reader).
 * 오래됨 = 시장별 마지막 확정 봉 < 지금 있어야 할 봉 날짜(`expectedBarDate`).
 *
 * 초과수익 중앙값은 v1 에서 만들지 않는다(L-3 — `준비 중`). 건수만 채운다.
 */
import { addDaysYmd } from '@/lib/strategy/us-session';
import { expectedBarDate } from './anomalies';
import { readBarDates, readLastBarDates } from './daily-bars-read';
import { metric } from './metric';
import { type OpsReader } from './read-only';
import { localDateOf, recentTradingDays, sessionDayOf, kstIso, kstSql, toMs, type ClosedDays } from './sessions';
import type { ByMarket, Market, ObserveSet, PostmortemHorizonRow } from './types';

export const POSTMORTEM_SESSIONS = 20;
export const POSTMORTEM_FULL_HORIZON = 10;
export const POSTMORTEM_HORIZONS: readonly (1 | 3 | 5 | 10)[] = [1, 3, 5, 10];
export const SMALL_SAMPLE_N = 30;
export const POSTMORTEM_STATUSES = ['pending', 'skipped', 'approved', 'approved_pending_entry', 'expired'] as const;

export const POSTMORTEM_SIGNALS_SQL =
  `SELECT symbol, created_at FROM signals
    WHERE market = ? AND scenario_source = 'post-market' AND created_at >= ?
      AND status IN ('pending', 'skipped', 'approved', 'approved_pending_entry', 'expired')
    ORDER BY created_at ASC LIMIT 2000`;
export const POSTMORTEM_SIGNALS_LIMIT = 2000;

export interface MarketSample {
  /** 시그널별 D0 이후 확정 봉 수 */
  barsAfter: number[];
  lastBarDate: string | null;
  stale: boolean;
  holidaysKnown: boolean;
  /** 시그널 조회가 상한에 닿았다 — 건수는 하한 */
  truncated: boolean;
}

async function readMarket(r: OpsReader, market: Market, closed: ReadonlySet<string> | null, lastBar: string | null): Promise<MarketSample> {
  const today = localDateOf(market, r.nowMs);
  let fromDate: string;
  if (closed) {
    const days = recentTradingDays(market, today, POSTMORTEM_SESSIONS, closed);
    fromDate = days[days.length - 1] ?? addDaysYmd(today, -28);
  } else {
    fromDate = addDaysYmd(today, -28);   // 휴장표를 모르면 달력 4주로 근사 — reason 으로 알린다
  }
  const startMs = sessionDayOf(market, fromDate).startMs;
  const sig = await r.rows<{ symbol: unknown; created_at: unknown }>(POSTMORTEM_SIGNALS_SQL, [market, kstSql(startMs)]);
  const items = sig
    .map((s) => ({ symbol: String(s.symbol), ms: toMs(s.created_at) }))
    .filter((s): s is { symbol: string; ms: number } => s.ms != null)
    .map((s) => ({ symbol: s.symbol, d0: localDateOf(market, s.ms) }));
  const minD0 = items.reduce((a, s) => (a == null || s.d0 < a ? s.d0 : a), null as string | null);
  const bars = minD0 ? await readBarDates(r, market, items.map((s) => s.symbol), minD0) : new Map<string, string[]>();
  const barsAfter = items.map((s) => (bars.get(s.symbol) ?? []).filter((d) => d > s.d0).length);
  const exp = closed ? expectedBarDate(market, r.nowMs, closed) : null;
  return { barsAfter, lastBarDate: lastBar, stale: lastBar != null && exp != null && lastBar < exp, holidaysKnown: !!closed, truncated: sig.length >= POSTMORTEM_SIGNALS_LIMIT };
}

export interface PostmortemRead { markets: ByMarket<MarketSample> }

export async function readPostmortemSample(r: OpsReader, closed: ClosedDays): Promise<PostmortemRead> {
  const last = await readLastBarDates(r);
  const [domestic, overseas] = await Promise.all([
    readMarket(r, 'domestic', closed.domestic, last.domestic),
    readMarket(r, 'overseas', closed.overseas, last.overseas),
  ]);
  return { markets: { domestic, overseas } };
}

/** 홈 A3 — 순수. */
export function homePostmortem(p: PostmortemRead, nowMs: number): ObserveSet['postmortem'] {
  const all = [...p.markets.domestic.barsAfter, ...p.markets.overseas.barsAfter];
  const done = all.filter((n) => n >= POSTMORTEM_FULL_HORIZON).length;
  const value = {
    total: all.length, done, tracking: all.length - done, cardsOnly: true,
    lastBarDate: { domestic: p.markets.domestic.lastBarDate, overseas: p.markets.overseas.lastBarDate },
  };
  const asOf = kstIso(nowMs);
  const stale = p.markets.domestic.stale || p.markets.overseas.stale;
  const holidays = p.markets.domestic.holidaysKnown && p.markets.overseas.holidaysKnown ? undefined : 'holidays_unknown';
  if (all.length === 0) return metric('zero', value, asOf, holidays);
  if (stale) return metric('stale', value, asOf, 'bars_old');
  if (p.markets.domestic.truncated || p.markets.overseas.truncated) return metric('partial', value, asOf, 'truncated');
  if (all.length < SMALL_SAMPLE_N) return metric('partial', value, asOf, 'small_sample');
  return metric('available', value, asOf, holidays);
}

/** 검증·성과 표 — 기간별 건수(D+k 봉이 생긴 시그널 수). 중앙값은 준비 중(L-3). 순수. */
export function verifyPostmortemRows(p: PostmortemRead): PostmortemHorizonRow[] {
  const all = [...p.markets.domestic.barsAfter, ...p.markets.overseas.barsAfter];
  return POSTMORTEM_HORIZONS.map((h) => ({
    horizon: h,
    n: all.filter((x) => x >= h).length,
    medianExcessPct: metric<number>('prep', null, null, 'not_implemented'),
  }));
}
