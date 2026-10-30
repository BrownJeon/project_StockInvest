/**
 * T-108 홈 「최근 활동」 — 최대 4건, 최신순 (가이드 §2.3.7 · §4.7 「최근 활동」, 데모 E 절 6).
 *
 * 원천: ① 실행 기록의 장마감 분석 행(post-market-*, 최근 2) ② 오늘(시장별 세션일) `orders` 최신 3(가상·체결·거부·차단)
 * ③ 오늘 장중 매수 시그널 중 검증 관문에 막혀 기록만 된 것(`status='skipped'` ∧ `indicators.gate='validation_gate'` ∧ 장마감 시그널 아님)의
 * 건수·마지막 시각. 첫 배포(실행 기록 없음)엔 ②③만.
 *
 * 문구는 데모 714행 틀을 따른다. 종목은 코드 그대로 넣고 params.symbol 로도 준다(화면이 종목 이름으로 바꿔 쓸 수 있게).
 * 「DRY_RUN」 글자는 쓰지 않는다 — 가상 주문·가상 청산(용어 정정표).
 */
import { VALIDATION_GATE_INDICATOR } from '@/lib/signals/paper-fill';
import { EXIT_STRATEGY_ID } from '@/lib/strategy/exit-engine';
import { POST_MARKET_JOB, skipReasonOf } from './analysis-runs';
import { count, num, OpsQueryError, parseJsonObject, type OpsReader } from './read-only';
import { currentSessionDay, kstIso, kstSql, toMs } from './sessions';
import type { ActivityItem, Market } from './types';

export const ACTIVITY_LIMIT = 4;

export const ACTIVITY_JOBS_SQL =
  `SELECT job_id, market, status, started_at, counts_json, degraded_reason FROM job_run_log
    WHERE job_id IN (?, ?) AND recorder IN ('runner_hook', 'route') AND started_at IS NOT NULL
    ORDER BY started_at DESC LIMIT 2`;
export const ACTIVITY_ORDERS_SQL =
  `SELECT o.symbol, o.side, o.status, o.blocked_by, o.created_at, s.strategy_id, JSON_VALUE(s.indicators, '$.exit_kind') AS exit_kind
     FROM orders o LEFT JOIN signals s ON s.consumed_order_id = o.id
    WHERE o.market = ? AND o.created_at >= ? AND o.created_at < ?
    ORDER BY o.created_at DESC LIMIT 3`;
export const ACTIVITY_BLOCKS_SQL =
  `SELECT SUM(status = 'skipped' AND JSON_VALUE(indicators, '$.gate') = ?) AS blocked, COUNT(*) AS total, MAX(created_at) AS last_at
     FROM signals
    WHERE market = ? AND created_at >= ? AND created_at < ? AND side = 'buy'
      AND (scenario_source IS NULL OR scenario_source <> 'post-market')
      AND (strategy_id IS NULL OR strategy_id <> ?)`;

const MARKET_KO: Record<Market, string> = { domestic: '국내', overseas: '해외' };
/** 청산 종류 표시 이름(용어 정정표 — 계약 §12). */
export const EXIT_KIND_LABEL: Readonly<Record<string, string>> = {
  eod_loss_cut: '장마감 전 손절', hard_stop: '손실한도 손절', target_profit: '익절', trailing_stop: '트레일링',
};
const SIDE_KO: Record<string, string> = { buy: '매수', sell: '매도' };
/**
 * 장마감 분석 건너뜀·실패 사유 코드 → 짧은 말(엔진 소스에서 확인한 코드만: post-market-engine.ts weekend,
 * post-market-overseas.ts 475~573). 문구는 designer 확인 대상 — 화면은 params.skipReason·failReason 으로 자기 사전을 쓸 수 있다.
 */
export const REASON_KO: Readonly<Record<string, string>> = {
  weekend: '주말', overseas_disabled: '해외 분석 꺼짐', overseas_market_disabled: '해외 시장 꺼짐', us_session_open: '미국 장중',
  no_new_session: '새 세션 없음', holidays_unknown: '휴장표 모름', fx_unknown: '환율 모름', earnings_unknown: '실적 일정 모름',
  candles_unavailable: '일봉 없음', fx_inconsistent: '환율 불일치', candle_scale_suspect: '일봉 단위 의심', rag_fail: '참고 자료 조회 실패',
  no_symbols: '대상 종목 없음',
};

export function analysisItem(row: Record<string, unknown>): ActivityItem | null {
  const at = toMs(row.started_at);
  if (at == null) return null;
  const market = String(row.market) === 'overseas' ? 'overseas' : 'domestic';
  const c = parseJsonObject(row.counts_json);
  const evaluated = c ? num(c.evaluated) : null;
  const signals = c ? num(c.created) : null;
  const blocked = c ? num(c.blocked) : null;
  const status = String(row.status);
  const head = `${MARKET_KO[market]} 장마감 분석`;
  const title = status === 'ok' ? `${head} 완료`
    : status === 'failed' ? `${head} 실패`
    : status === 'skipped' ? `${head} 건너뜀`
    : `${head} 일부 완료`;
  const degraded = row.degraded_reason == null ? null : String(row.degraded_reason);
  const skipReason = status === 'skipped' ? skipReasonOf(degraded) : null;
  const failReason = status === 'failed' || status === 'degraded' || status === 'partial' ? degraded : null;
  let sub: string;
  // 건너뜀·실패 사유는 코드로 말한다 — 「휴장」으로 단정하지 않는다(R-UI M2). 모르는 코드는 그대로 보인다(화면이 params 로 다시 쓸 수 있다).
  if (status === 'failed') sub = failReason ? `실행 실패 · ${REASON_KO[failReason] ?? `사유 ${failReason}`}` : '실행 실패 — 데이터 상태에서 확인';
  else if (status === 'skipped') sub = skipReason ? `건너뜀 · ${REASON_KO[skipReason] ?? `사유 ${skipReason}`}` : '건너뜀 · 사유 기록 없음';
  else if (evaluated == null) sub = '건수 기록 없음';
  else if (signals != null && signals > 0 && blocked != null && blocked >= signals) sub = `${evaluated}종목 · 시그널 ${signals}건 → 검증 관문 차단`;
  else sub = `${evaluated}종목 · 시그널 ${signals ?? 0}건`;
  return { at: kstIso(at), kind: 'analysis', title, sub, params: { market, status, evaluated, signals, blocked, skipReason, failReason } };
}

export function orderItem(row: Record<string, unknown>, market: Market): ActivityItem | null {
  const at = toMs(row.created_at);
  if (at == null) return null;
  const symbol = String(row.symbol);
  const side = SIDE_KO[String(row.side)] ?? String(row.side);
  const st = String(row.status);
  const exitKind = String(row.strategy_id) === EXIT_STRATEGY_ID && row.exit_kind != null ? String(row.exit_kind) : null;
  const kindKo = exitKind ? EXIT_KIND_LABEL[exitKind] ?? exitKind : null;
  let title: string;
  let sub: string;
  if (st === 'dry_run') {
    title = exitKind ? `가상 청산 기록 — ${symbol} ${side}` : `가상 주문 기록 — ${symbol} ${side}`;
    sub = `${kindKo ? `${kindKo} · ` : ''}주문 송신 없음`;
  } else if (st === 'filled' || st === 'partially_filled') {
    title = `체결 — ${symbol} ${side}`;
    sub = `${kindKo ? `${kindKo} · ` : ''}${st === 'partially_filled' ? '부분 체결' : '체결 완료'}`;
  } else if (st === 'blocked') {
    title = `주문 차단 — ${symbol} ${side}`;
    sub = `${kindKo ? `${kindKo} · ` : ''}${String(row.blocked_by) === 'kill_switch' ? '모든거래차단' : '안전장치 차단'} · 송신 안 됨`;
  } else if (st === 'rejected' || st === 'failed') {
    title = `주문 거부 — ${symbol} ${side}`;
    sub = `${kindKo ? `${kindKo} · ` : ''}재시도하지 않음`;
  } else if (st === 'cancelled') {
    title = `주문 취소 — ${symbol} ${side}`;
    sub = kindKo ?? '취소됨';
  } else {
    title = `주문 접수 — ${symbol} ${side}`;
    sub = `${kindKo ? `${kindKo} · ` : ''}결과 확인 전`;
  }
  return { at: kstIso(at), kind: 'order', title, sub, params: { market, symbol, side: String(row.side), orderStatus: st, exitKind } };
}

export function blockItem(row: Record<string, unknown> | undefined, market: Market): ActivityItem | null {
  const n = count(row?.blocked);
  const total = count(row?.total);
  const at = toMs(row?.last_at);
  if (n <= 0 || at == null) return null;
  const sub = n >= total ? `검증 관문 · 오늘 ${n}건 모두 차단` : `검증 관문 · 오늘 ${n}건 차단`;
  return { at: kstIso(at), kind: 'signal_block', title: `${MARKET_KO[market]} 장중 매수 시그널 차단`, sub, params: { market, count: n } };
}

export async function readActivity(r: OpsReader): Promise<ActivityItem[]> {
  const items: ActivityItem[] = [];
  const jobs = await r.rows<Record<string, unknown>>(ACTIVITY_JOBS_SQL, [POST_MARKET_JOB.domestic, POST_MARKET_JOB.overseas])
    .catch((e) => { if (e instanceof OpsQueryError && e.code === 'not_migrated') return []; throw e; });
  for (const j of jobs) { const it = analysisItem(j); if (it) items.push(it); }
  for (const m of ['domestic', 'overseas'] as const) {
    const day = currentSessionDay(m, r.nowMs);
    const p = [kstSql(day.startMs), kstSql(day.endMs)];
    const [orders, blocks] = await Promise.all([
      r.rows<Record<string, unknown>>(ACTIVITY_ORDERS_SQL, [m, ...p]),
      r.rows<Record<string, unknown>>(ACTIVITY_BLOCKS_SQL, [VALIDATION_GATE_INDICATOR, m, ...p, EXIT_STRATEGY_ID]),
    ]);
    for (const o of orders) { const it = orderItem(o, m); if (it) items.push(it); }
    const b = blockItem(blocks[0], m);
    if (b) items.push(b);
  }
  return items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, ACTIVITY_LIMIT);
}
