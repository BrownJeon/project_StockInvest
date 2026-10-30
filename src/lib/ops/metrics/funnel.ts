/**
 * T-108 `GET /api/ops/funnel?market=` 본체 → `FunnelDTO` (가이드 §4.5 · §2.4.5 「장중 룰 평가 깔때기」).
 *
 * - 범위 = 그 시장의 **마지막(또는 진행 중) 세션일** 하루 — 국내 KST 00:00~24:00, 해외 ET 00:00~24:00(epoch 로 바꾼 구간).
 *   「마지막 세션일」은 그 시장 마지막 `gate='run'` 틱의 현지 날짜(7일 안에 없으면 오늘 현지 날짜). 기존 `/api/dashboard/eval-funnel`
 *   (KST 자정 기준)은 그대로 둔다.
 * - defaultMarket = 마지막 run 틱이 더 최근인 시장(둘 다 없으면 domestic).
 * - 기준(마지막 run 시각) 조회가 실패하면 `basis.state='error'` + 오류 코드 + 어떤 값을 추정값(fallback)으로 채웠는지 표지.
 *   그때 summary 는 section error, 「이상 n」은 null — 추정한 창의 수치를 정상값처럼 내지 않는다.
 * - anomalies = 그 범위 `verdict='error'` 행의 종목 수(세그먼트 「이상 n」).
 * - summary = `getEvalFunnelSummary`(strategy/eval-funnel-query, import 만) 그대로 — 그 함수는 자기 풀 쿼리를 쓰므로 여기서 상한만 씌운다.
 */
import { getEvalFunnelSummary } from '@/lib/strategy/eval-funnel-query';
import { withDeadline } from '@/lib/strategy/records/safe-text';
import { classifyDbError, count, createReader, errorCodeOf, OpsQueryError, section, type OpsReader } from './read-only';
import { isoOrNull, kstIso, kstSql, localDateOf, sessionDayOf, toMs, type SessionDay } from './sessions';
import type { ByMarket, EvalFunnelSummaryJson, FunnelDTO, Market } from './types';

export const FUNNEL_SUMMARY_DEADLINE_MS = 3000;
export const LAST_RUN_LOOKBACK_DAYS = 7;

export const LAST_RUN_BY_MARKET_SQL =
  `SELECT market, MAX(ts) AS t FROM eval_funnel WHERE gate = 'run' AND ts >= ? GROUP BY market`;
export const FUNNEL_ANOMALIES_SQL =
  `SELECT COUNT(DISTINCT symbol) AS n FROM eval_funnel WHERE market = ? AND ts >= ? AND ts < ? AND verdict = 'error'`;

export function parseMarketParam(v: string | null): Market | null {
  return v === 'domestic' || v === 'overseas' ? v : null;
}

/** 시장별 마지막 세션일 구간 — 순수. */
export function funnelSessionDay(market: Market, lastRunMs: number | null, nowMs: number): SessionDay {
  return sessionDayOf(market, localDateOf(market, lastRunMs ?? nowMs));
}

export function pickDefaultMarket(last: ByMarket<number | null>): Market {
  const d = last.domestic ?? -Infinity;
  const o = last.overseas ?? -Infinity;
  return o > d ? 'overseas' : 'domestic';
}

function toJson(s: Awaited<ReturnType<typeof getEvalFunnelSummary>>): EvalFunnelSummaryJson {
  return { ...s, rangeStart: kstIso(s.rangeStart.getTime()), rangeEnd: kstIso(s.rangeEnd.getTime()) };
}

export interface FunnelDeps { summary: typeof getEvalFunnelSummary }

export async function buildFunnel(
  marketParam: Market | null, nowMs: number = Date.now(), reader: OpsReader = createReader({ nowMs }),
  deps: FunnelDeps = { summary: getEvalFunnelSummary },
): Promise<FunnelDTO> {
  const r = reader;
  // 기준 세션(시장별 마지막 run 시각)을 못 읽으면 기본 시장·세션일을 **추정하지 않는다**(Codex C2 ①) — 예전에는 국내·오늘 현지 날짜로
  // 조용히 떨어져 「오늘 평가 없음」으로 보였다. 이제 basis 에 오류 코드를 싣고, 추정한 창으로는 요약·「이상 n」을 읽지 않는다.
  let basis: FunnelDTO['basis'] = { state: 'ok' };
  let lastRows: { market: unknown; t: unknown }[] = [];
  try {
    lastRows = await r.rows<{ market: unknown; t: unknown }>(LAST_RUN_BY_MARKET_SQL, [kstSql(nowMs - LAST_RUN_LOOKBACK_DAYS * 86_400_000)]);
  } catch (e) {
    basis = { state: 'error', error: errorCodeOf(e), fallback: { defaultMarket: marketParam == null, sessions: true } };
  }
  const last: ByMarket<number | null> = { domestic: null, overseas: null };
  for (const x of lastRows) {
    const m = String(x.market);
    if (m === 'domestic' || m === 'overseas') last[m] = toMs(x.t);
  }
  const defaultMarket = pickDefaultMarket(last);
  const market = marketParam ?? defaultMarket;
  const days: ByMarket<SessionDay> = {
    domestic: funnelSessionDay('domestic', last.domestic, nowMs),
    overseas: funnelSessionDay('overseas', last.overseas, nowMs),
  };
  const basisOk = basis.state === 'ok';
  const anomalies = async (m: Market): Promise<number | null> => {
    if (!basisOk) return null;   // 추정한 창으로 세지 않는다 — 모름
    try {
      const rows = await r.rows<{ n: unknown }>(FUNNEL_ANOMALIES_SQL, [m, kstSql(days[m].startMs), kstSql(days[m].endMs)]);
      return count(rows[0]?.n);
    } catch {
      return null;   // 「이상 n」 을 모름 — 0 으로 쓰지 않는다
    }
  };
  const [ad, ao, summary] = await Promise.all([
    anomalies('domestic'),
    anomalies('overseas'),
    section('funnel.summary', async () => {
      if (!basisOk) throw new OpsQueryError(basis.state === 'error' && basis.error === 'timeout' ? 'timeout' : 'db_error', 'funnel basis unknown');
      const d = days[market];
      const endMs = Math.min(d.endMs, nowMs);
      let v: Awaited<ReturnType<typeof getEvalFunnelSummary>> | undefined;
      try {
        v = await withDeadline(deps.summary(market, new Date(d.startMs), new Date(Math.max(endMs, d.startMs))), FUNNEL_SUMMARY_DEADLINE_MS);
      } catch (e) {
        throw classifyDbError(e);
      }
      if (!v) throw new OpsQueryError('timeout', 'funnel summary timeout');
      return toJson(v);
    }),
  ]);
  return {
    generatedAt: kstIso(nowMs),
    basis,
    defaultMarket,
    sessions: {
      domestic: { session: days.domestic.ref, anomalies: ad, lastRunAt: last.domestic != null ? isoOrNull(last.domestic) : null },
      overseas: { session: days.overseas.ref, anomalies: ao, lastRunAt: last.overseas != null ? isoOrNull(last.overseas) : null },
    },
    market,
    summary,
  };
}
