/**
 * T-108 시그널 건수 — 홈·거래가 **같은 함수**로 센다 (가이드 §4.8 「승인 대기 숫자 불일치 수정」).
 *
 * - 승인 대기 집합은 `AWAITING_APPROVAL_STATUSES`(signals/statuses.ts) 한 곳에서만 가져온다 — 구 값 `pending`·`pending_approval`
 *   포함. 예전 홈(Dashboard)은 `pending` 을 빠뜨려 장마감 시그널(`pending` 으로 저장)이 숫자에서 사라졌다.
 * - `detected`(manual 관측 기록)는 승인 대기에 넣지 않고 따로 센다(D8 「관측 기록」).
 * - 만료 절: `expires_at IS NULL OR expires_at >= 지금` — 만료 처리 잡이 상태를 바꾸기 전의 지난 시그널을 세지 않는다.
 * - 「지금」은 요청 기준 시각(KST 벽시계 문자열)을 바인딩한다(DB NOW() 대신 — 같은 응답 안의 모든 숫자가 같은 시각 기준).
 * - 인덱스: `idx_signals_status (status, created_at)`.
 */
import { AWAITING_APPROVAL_STATUSES, sqlStatusList } from '@/lib/signals/statuses';
import { count, type OpsReader } from './read-only';
import { isoOrNull, kstSql } from './sessions';
import type { ByMarket, Market } from './types';

export const AWAITING_SQL_LIST = sqlStatusList(AWAITING_APPROVAL_STATUSES);

function byMarket(rows: { market: unknown; n: unknown }[]): ByMarket<number> {
  const out: ByMarket<number> = { domestic: 0, overseas: 0 };
  for (const row of rows) {
    const m = String(row.market);
    if (m === 'domestic' || m === 'overseas') out[m as Market] += count(row.n);
  }
  return out;
}

export const APPROVAL_COUNT_SQL =
  `SELECT market, COUNT(*) AS n FROM signals
    WHERE status IN (${AWAITING_SQL_LIST}) AND (expires_at IS NULL OR expires_at >= ?)
    GROUP BY market`;

export const EARLIEST_EXPIRY_SQL =
  `SELECT symbol, expires_at FROM signals
    WHERE status IN (${AWAITING_SQL_LIST}) AND expires_at >= ?
    ORDER BY expires_at ASC LIMIT 1`;

export const DETECTED_COUNT_SQL =
  `SELECT COUNT(*) AS n FROM signals
    WHERE status = 'detected' AND (expires_at IS NULL OR expires_at >= ?)`;

/**
 * 진입 감시: 감시 중(valid_from 도래) / 다음 세션 예정(valid_from 미래) / 주문 선점 중(executing).
 * `executing` 은 만료 시각과 무관하게 센다. 연결 주문 filled/cancelled만 제외하고 NULL/미확인 결과는 남긴다.
 */
/** Shared list/count predicate. NULL includes absent orders and unknown results. */
export const ACTIVE_EXECUTING_ORDER_SQL = `(o.status IS NULL OR o.status NOT IN ('filled', 'cancelled'))`;
export const WATCH_COUNT_SQL =
  `SELECT s.market,
          SUM(s.status = 'approved_pending_entry' AND (s.valid_from IS NULL OR s.valid_from <= ?)) AS watching,
          SUM(s.status = 'approved_pending_entry' AND s.valid_from > ?) AS next_session,
          SUM(s.status = 'executing') AS executing
     FROM signals s LEFT JOIN orders o ON o.id = s.consumed_order_id
    WHERE s.status IN ('approved_pending_entry', 'executing')
      AND (s.status = 'executing' OR s.expires_at IS NULL OR s.expires_at >= ?)
      AND (s.status <> 'executing' OR ${ACTIVE_EXECUTING_ORDER_SQL})
    GROUP BY s.market`;

export interface ApprovalCounts {
  approval: ByMarket<number>;
  earliestExpiry: { symbol: string; at: string } | null;
}

export async function countApproval(r: OpsReader): Promise<ApprovalCounts> {
  const now = kstSql(r.nowMs);
  const [rows, first] = await Promise.all([
    r.rows<{ market: unknown; n: unknown }>(APPROVAL_COUNT_SQL, [now]),
    r.rows<{ symbol: unknown; expires_at: unknown }>(EARLIEST_EXPIRY_SQL, [now]),
  ]);
  const f = first[0];
  const at = f ? isoOrNull(f.expires_at) : null;
  return { approval: byMarket(rows), earliestExpiry: f && at ? { symbol: String(f.symbol), at } : null };
}

export async function countDetected(r: OpsReader): Promise<number> {
  const rows = await r.rows<{ n: unknown }>(DETECTED_COUNT_SQL, [kstSql(r.nowMs)]);
  return count(rows[0]?.n);
}

export interface WatchCounts { watching: number; nextSession: number; executing: number }

export async function countWatch(r: OpsReader): Promise<ByMarket<WatchCounts>> {
  const now = kstSql(r.nowMs);
  const rows = await r.rows<{ market: unknown; watching: unknown; next_session: unknown; executing: unknown }>(WATCH_COUNT_SQL, [now, now, now]);
  const zero = (): WatchCounts => ({ watching: 0, nextSession: 0, executing: 0 });
  const out: ByMarket<WatchCounts> = { domestic: zero(), overseas: zero() };
  for (const row of rows) {
    const m = String(row.market);
    if (m !== 'domestic' && m !== 'overseas') continue;
    out[m] = { watching: count(row.watching), nextSession: count(row.next_session), executing: count(row.executing) };
  }
  return out;
}
