/**
 * T-108 데이터 원천 신선도(분석 › 데이터 상태) · 홈 A4 「데이터 이상·분석 실패」 (가이드 §4.6 data · §4.7 A4·원천 한도).
 *
 * 원천 7개 — 「마지막 성공 시각」 기준(날짜 파일이 있다는 것은 성공 증거가 아니다):
 *  | 원천 | 읽는 곳 | 오래됨 한도 |
 *  | 포트폴리오 스냅샷 | `portfolio_snapshots MAX(ts)` | 3시간(장외에도 약 2시간마다 찍힌다) |
 *  | 환율 USD/KRW | `fx_rates(pair='USD_KRW').fetched_at` | 24시간 |
 *  | 일봉 국내·해외 | 일봉 reader(`daily-bars-read.ts`)의 시장별 마지막 확정 봉 날짜 | 수집 예정일(세션 다음 날 08:30 KST)이 지난 세션보다 이르면 |
 *  | 뉴스 국내·해외 | `system_config news_zero_streak:<channel>:<market>` | 0건 연속 ≥ 2 → partial · 관측 30시간 공백 → stale |
 *  | 브로커 원장 | `broker_fill_runs` 완료(`complete`) 실행 `MAX(started_at)` | 26시간 |
 * 원천마다 따로 읽고, 한 원천의 실패는 그 행만 error 다(0·정상으로 위장하지 않는다).
 */
import { num, OpsQueryError, parseJsonObject, type OpsReader } from './read-only';
import { readLastBarDates } from './daily-bars-read';
import { addDaysYmd } from '@/lib/strategy/us-session';
import { isTradingDay, kstDateOf, kstIso, kstWallToMs, localDateOf, toMs, type ClosedDays } from './sessions';
import { counted, metric } from './metric';
import type { AnomalyItem, DataSourceId, DataSourceRow, Market, MetricState, ObserveSet } from './types';

export const DATA_SOURCE_IDS: readonly DataSourceId[] = [
  'portfolio_snapshot', 'fx_usdkrw', 'daily_bars_kr', 'daily_bars_us', 'news_domestic', 'news_overseas', 'broker_ledger',
];
/** 화면 표시 이름(데모 anaData 그대로). */
export const DATA_SOURCE_LABEL: Readonly<Record<DataSourceId, string>> = {
  portfolio_snapshot: '포트폴리오 스냅샷', fx_usdkrw: '환율 USD/KRW', daily_bars_kr: '일봉 국내', daily_bars_us: '일봉 해외',
  news_domestic: '뉴스 국내', news_overseas: '뉴스 해외', broker_ledger: '브로커 원장',
};

export const SNAPSHOT_LIMIT_MS = 3 * 3600_000;
export const FX_LIMIT_MS = 24 * 3600_000;
export const BROKER_LIMIT_MS = 26 * 3600_000;
export const NEWS_GAP_LIMIT_MS = 30 * 3600_000;
export const NEWS_ZERO_STREAK_ANOMALY = 2;
/** 일봉 정기 수집(07:40 KST 잡)이 끝났다고 보는 시각 — 세션 다음 KST 날짜의 이 시각. */
export const BARS_COLLECTED_BY_KST = '08:30';

export const SNAPSHOT_MAX_SQL = 'SELECT MAX(ts) AS t FROM portfolio_snapshots';
export const FX_ROW_SQL = "SELECT rate, fetched_at FROM fx_rates WHERE pair = 'USD_KRW' LIMIT 1";
export const NEWS_STREAK_SQL = "SELECT `key`, value FROM system_config WHERE `key` LIKE 'news_zero_streak:%'";
export const BROKER_LAST_SQL = "SELECT MAX(started_at) AS t FROM broker_fill_runs WHERE status = 'complete'";
export const JOB_FAILURES_SQL =
  `SELECT job_id, market, status FROM job_run_log
    WHERE session_date_kst = ? AND status IN ('failed', 'missing', 'degraded') AND recorder <> 'runner_rollup'
    ORDER BY started_at DESC LIMIT 20`;

function row(id: DataSourceId, state: MetricState, lastOkAt: string | null, extra: Partial<DataSourceRow> = {}): DataSourceRow {
  return { id, lastOkAt, state, dateRef: null, streak: null, ...extra };
}

function errRow(id: DataSourceId, e: unknown): DataSourceRow {
  const code = (e as { code?: unknown } | null)?.code;
  return row(id, 'error', null, { reason: typeof code === 'string' ? code : 'db_error' });
}

/**
 * 브로커 원장 원천의 조회 실패 — **표 없음(1146 → `not_migrated`)은 준비 중**(`prep:not_migrated`, 가이드 §4.0 「테이블 없음: 그 섹션 prep」).
 * 그 밖의 실패는 다른 원천과 같은 error. (T-128 A3 — 예전에는 표 없음도 `error:not_migrated` 로 「조회 실패」가 됐다. 운영에는 표가 있어 무해.)
 * 이번 범위는 브로커 원장 원천 하나다(`broker_fill_runs` — 별도 마이그레이션 `T-081-wpd-broker-fills.sql` 로 생기는 표라 그 DDL 전
 * 환경이 있을 수 있다). 다른 원천은 `errRow` 그대로: 스냅샷·환율·system_config 표는 부팅 스키마(`db.ts`)가 만들어 없을 수 없고,
 * 같은 처지(마이그레이션 표)인 일봉 표(T-070 마이그레이션)는 A4 「데이터 이상」 건수 의미가 바뀌는 일이라 T-128 Leader 보고로 넘겼다
 * (일봉 표 이름은 `daily-bars-read.ts` 에만 쓴다 — ops-read-only-fence 시험).
 */
export function brokerErrRow(e: unknown): DataSourceRow {
  if (e instanceof OpsQueryError && e.code === 'not_migrated') return row('broker_ledger', 'prep', null, { reason: 'not_migrated' });
  return errRow('broker_ledger', e);
}

/** 나이 기준 원천 — 순수. */
export function ageRow(id: DataSourceId, atMs: number | null, nowMs: number, limitMs: number): DataSourceRow {
  if (atMs == null) return row(id, 'unknown', null, { reason: 'no_rows' });
  const at = kstIso(atMs);
  return nowMs - atMs > limitMs ? row(id, 'stale', at, { reason: 'age_exceeded' }) : row(id, 'available', at);
}

/**
 * 지금 있어야 하는 마지막 일봉 날짜(현지 날짜) — 순수. 그 세션 다음 KST 날짜 08:30 이 지난 가장 최근 거래일.
 * 해외 세션 d(ET)는 KST d+1 05:00/06:00 에 끝나고 같은 아침 07:40 에 수집된다 → 국내·해외 모두 「d+1 08:30 KST」.
 */
export function expectedBarDate(market: Market, nowMs: number, closed: ReadonlySet<string>): string | null {
  let d = localDateOf(market, nowMs);
  for (let i = 0; i < 40; i++, d = addDaysYmd(d, -1)) {
    if (!isTradingDay(market, d, closed)) continue;
    if (kstWallToMs(addDaysYmd(d, 1), BARS_COLLECTED_BY_KST) <= nowMs) return d;
  }
  return null;
}

/** 일봉 원천 1개 — 순수. */
export function barsRow(id: DataSourceId, market: Market, last: string | null, nowMs: number, closed: ReadonlySet<string> | null): DataSourceRow {
  if (last == null) return row(id, 'unknown', null, { reason: 'no_bars' });
  if (!closed) return row(id, 'available', null, { dateRef: last, reason: 'holidays_unknown' });
  const exp = expectedBarDate(market, nowMs, closed);
  if (exp != null && last < exp) return row(id, 'stale', null, { dateRef: last, reason: 'bars_old' });
  return row(id, 'available', null, { dateRef: last });
}

interface NewsState { streak: number; lastDate: string | null; lastOkDate: string | null }

/** news_zero_streak 행들 → 시장별 원천 행 — 순수. 채널(fetch·retrieval·retrieval_error) 중 가장 긴 연속을 쓴다. */
export function newsRows(rows: readonly { key: unknown; value: unknown }[], nowMs: number): Record<Market, DataSourceRow> {
  const by: Record<Market, Map<string, NewsState>> = { domestic: new Map(), overseas: new Map() };
  for (const r of rows) {
    const m = /^news_zero_streak:([a-z_]+):(domestic|overseas)$/.exec(String(r.key));
    if (!m) continue;
    const o = parseJsonObject(r.value);
    if (!o) continue;
    const str = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    by[m[2] as Market].set(m[1], { streak: Math.max(0, Math.trunc(num(o.streak) ?? 0)), lastDate: str(o.lastDate), lastOkDate: str(o.lastOkDate) });
  }
  const one = (market: Market): DataSourceRow => {
    const id: DataSourceId = market === 'domestic' ? 'news_domestic' : 'news_overseas';
    const fetch = by[market].get('fetch');
    if (!fetch) return row(id, 'unknown', null, { reason: 'no_observation' });
    const streak = Math.max(...[...by[market].values()].map((v) => v.streak));
    const extra = { dateRef: fetch.lastOkDate, streak };
    if (streak >= NEWS_ZERO_STREAK_ANOMALY) return row(id, 'partial', null, { ...extra, reason: 'zero_streak' });
    if (fetch.lastDate == null || fetch.lastDate < kstDateOf(nowMs - NEWS_GAP_LIMIT_MS)) return row(id, 'stale', null, { ...extra, reason: 'no_recent_observation' });
    return row(id, 'available', null, extra);
  };
  return { domestic: one('domestic'), overseas: one('overseas') };
}

/** 원천 7개 — 원천마다 독립(한 원천 실패 = 그 행만 error). */
export async function readDataSources(r: OpsReader, closed: ClosedDays): Promise<DataSourceRow[]> {
  const now = r.nowMs;
  const [snap, fx, bars, news, broker] = await Promise.allSettled([
    r.rows<{ t: unknown }>(SNAPSHOT_MAX_SQL),
    r.rows<{ rate: unknown; fetched_at: unknown }>(FX_ROW_SQL),
    readLastBarDates(r),
    r.rows<{ key: unknown; value: unknown }>(NEWS_STREAK_SQL),
    r.rows<{ t: unknown }>(BROKER_LAST_SQL),
  ]);
  const out: DataSourceRow[] = [];
  out.push(snap.status === 'fulfilled' ? ageRow('portfolio_snapshot', toMs(snap.value[0]?.t), now, SNAPSHOT_LIMIT_MS) : errRow('portfolio_snapshot', snap.reason));
  if (fx.status === 'fulfilled') {
    const f = fx.value[0];
    const rate = f ? num(f.rate) : null;
    out.push(f && rate != null && rate > 0 ? ageRow('fx_usdkrw', toMs(f.fetched_at), now, FX_LIMIT_MS) : row('fx_usdkrw', 'unknown', null, { reason: 'no_rows' }));
  } else out.push(errRow('fx_usdkrw', fx.reason));
  if (bars.status === 'fulfilled') {
    out.push(barsRow('daily_bars_kr', 'domestic', bars.value.domestic, now, closed.domestic));
    out.push(barsRow('daily_bars_us', 'overseas', bars.value.overseas, now, closed.overseas));
  } else {
    out.push(errRow('daily_bars_kr', bars.reason));
    out.push(errRow('daily_bars_us', bars.reason));
  }
  if (news.status === 'fulfilled') {
    const n = newsRows(news.value, now);
    out.push(n.domestic, n.overseas);
  } else {
    out.push(errRow('news_domestic', news.reason));
    out.push(errRow('news_overseas', news.reason));
  }
  out.push(broker.status === 'fulfilled' ? ageRow('broker_ledger', toMs(broker.value[0]?.t), now, BROKER_LIMIT_MS) : brokerErrRow(broker.reason));
  return out;
}

const ANOMALY_STATES: ReadonlySet<MetricState> = new Set<MetricState>(['stale', 'error', 'unknown', 'partial']);

/** 홈 A4 조립 — 순수. jobFailures=null 은 실행 기록을 읽지 못함(표 없음 포함). */
export function buildAnomalies(
  sources: readonly DataSourceRow[],
  jobFailures: readonly { job_id: unknown; market: unknown; status: unknown }[] | null,
  analysisFailureKnown: boolean,
  asOf: string,
): ObserveSet['anomalies'] {
  const items: AnomalyItem[] = [];
  for (const s of sources) {
    if (ANOMALY_STATES.has(s.state)) items.push({ source: s.id, state: s.state, label: DATA_SOURCE_LABEL[s.id], streak: s.streak });
  }
  for (const j of jobFailures ?? []) {
    const mk = String(j.market);
    items.push({
      source: 'job_run', state: String(j.status) === 'degraded' ? 'partial' : 'error', label: String(j.job_id), jobId: String(j.job_id),
      market: mk === 'domestic' || mk === 'overseas' || mk === 'common' ? mk : undefined, jobStatus: String(j.status),
    });
  }
  const checked = sources.filter((s) => s.state !== 'error').length;
  if (checked === 0) return metric('error', null, asOf, 'all_sources_failed');
  const known = analysisFailureKnown && jobFailures != null;
  const value = { total: items.length, sourcesChecked: checked, items, analysisFailureKnown: known };
  if (!known) return metric('partial', value, asOf, 'analysis_failure_unknown');
  return { ...counted(items.length, asOf), value };
}

export async function readJobFailures(r: OpsReader): Promise<{ job_id: unknown; market: unknown; status: unknown }[] | null> {
  try {
    return await r.rows(JOB_FAILURES_SQL, [kstDateOf(r.nowMs)]);
  } catch {
    return null;
  }
}

