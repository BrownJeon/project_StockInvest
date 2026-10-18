/**
 * entry-claim.ts — 진입 감시(entry-watcher) 시그널의 **주문 전 선점**. T-043.
 *
 * 문제: 감시자는 `approved_pending_entry` 시그널을 조회한 뒤 `submitOrder` 를 부르고 **그 뒤에야** 상태를 바꿨다.
 * 조회와 주문 사이에 아무 선점도 없어서, 같은 시그널을 보는 실행이 둘이면(cron 앱 2개 동시 기동·수동 호출·배포 중 요청 끊김 후
 * 새 인스턴스) 둘 다 `submitOrder` 를 불러 **같은 시그널에 실주문이 두 번** 나갈 수 있다. `client_order_id` 는 호출마다 랜덤
 * UUID 라 DB 수준 멱등성도 없다.
 *
 * 해결: `submitOrder` **직전에** 한 문장짜리 조건부 UPDATE 로 `executing` 으로 옮기고, 그 UPDATE 를 이긴 쪽(affectedRows 1)만
 * 주문한다. 이후:
 *   - 성공·결과 불명 : `executing` 유지(+주문 번호 기록). 다음 틱의 조회에 잡히지 않는다.
 *   - 확정 거부·송신 전 예외 : `approved_pending_entry` 로 되돌려 다음 틱에 다시 시도한다.
 * 선점 UPDATE 가 실패하면(DB 장애) **주문하지 않는다** — 선점 없이는 주문하지 않는 것이 이 모듈의 계약이다.
 */
import type { SqlRunner } from './approval-transitions';

interface AffectedHeader { affectedRows?: unknown }

function affected(res: unknown): number {
  const head = Array.isArray(res) ? res[0] : res;
  const n = (head as AffectedHeader | undefined)?.affectedRows;
  return typeof n === 'number' ? n : 0;
}

/**
 * 주문 직전 선점. 시그널이 아직 `approved_pending_entry` 이고 만료 전일 때만 `executing` 으로 옮긴다.
 *
 * @returns 이 호출이 선점에 성공했는가(true 인 쪽만 주문한다). 다른 실행이 먼저 가져갔거나 그 사이 만료됐으면 false.
 * @throws DB 오류 — 호출자는 **주문하지 말아야 한다**.
 */
export async function claimEntrySignal(pool: SqlRunner, id: number): Promise<boolean> {
  const res = await pool.query(
    `UPDATE signals SET status='executing', updated_at=NOW()
      WHERE id=? AND status='approved_pending_entry' AND (expires_at IS NULL OR expires_at > NOW())`,
    [id],
  );
  return affected(res) === 1;
}

/**
 * 선점을 되돌린다 — **확정 거부 또는 송신 전 예외**일 때만. `executing` 이고 아직 주문 번호가 기록되지 않은 행만 건드린다
 * (그 사이 다른 상태로 바뀌었거나 주문이 연결된 행을 덮어쓰지 않는다).
 *
 * @returns 실제로 되돌렸는가
 */
export async function releaseEntryClaim(pool: SqlRunner, id: number): Promise<boolean> {
  const res = await pool.query(
    `UPDATE signals SET status='approved_pending_entry', updated_at=NOW()
      WHERE id=? AND status='executing' AND consumed_order_id IS NULL`,
    [id],
  );
  return affected(res) === 1;
}

/**
 * 선점한 시그널에 주문 번호를 연결한다(성공·결과 불명 모두). 상태는 `executing` 그대로다.
 * 실패해도 **재주문 위험은 없다**(이미 `executing`) — 호출자는 경보로 사람이 맞추게 한다.
 *
 * @returns 실제로 연결했는가
 */
export async function recordEntryOrder(pool: SqlRunner, id: number, orderId: number | null): Promise<boolean> {
  const res = await pool.query(
    `UPDATE signals SET consumed_order_id=?, updated_at=NOW() WHERE id=? AND status='executing'`,
    [orderId, id],
  );
  return affected(res) === 1;
}

/** 선점 뒤 멈춘 것으로 보이는 시그널 한 건. */
export interface StuckExecution {
  id: number;
  symbol: string;
  side: string;
  /** 선점된 시각(= 마지막 갱신)의 **KST 벽시계** `YYYY-MM-DD HH:mm:ss` — 사람이 체결 내역과 대조하는 값이라 UTC 로 내보내면 안 된다 (T-046 감사 R-1) */
  updatedAt: string;
}

/** `Date`(풀이 KST 로 해석해 만든 올바른 시점)를 KST 벽시계 문자열로. 서버 TZ 와 무관하게 +9h 산술로 만든다. */
function toKstWallClock(d: Date): string {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * `executing` 인데 **주문 번호가 없고 오래된** 시그널을 찾는다 (T-043 독립 감사 R-1, T-046 C).
 *
 * T-043 으로 위험의 방향이 "이중 주문"에서 "주문 누락 + 무음"으로 바뀌었다: 선점 뒤 프로세스가 죽거나 복귀가 0행이면
 * `executing` + `consumed_order_id` NULL 로 남고 알림이 없다. 정상 경로에서 이 상태는 `submitOrder` 가 도는 동안(수 초)만
 * 존재하므로 기본 10분이면 정상 지연과 구분된다.
 *
 * @throws DB 오류 — 호출자는 삼키고 틱을 계속해야 한다(점검 실패가 주문 경로를 막으면 안 된다).
 */
export async function findStuckExecutions(
  pool: SqlRunner,
  olderThanMinutes = 10,
  limit = 20,
): Promise<StuckExecution[]> {
  const minutes = Math.max(1, Math.floor(olderThanMinutes));
  const max = Math.max(1, Math.floor(limit));
  const res = await pool.query(
    `SELECT id, symbol, side, updated_at FROM signals
      WHERE status='executing' AND consumed_order_id IS NULL AND updated_at < NOW() - INTERVAL ? MINUTE
      ORDER BY id LIMIT ?`,
    [minutes, max],
  );
  const rows = (Array.isArray(res) ? res[0] : res) as Array<{ id: unknown; symbol: unknown; side: unknown; updated_at: unknown }> | undefined;
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    id: Number(r.id),
    symbol: String(r.symbol),
    side: String(r.side),
    updatedAt: r.updated_at instanceof Date ? toKstWallClock(r.updated_at) : String(r.updated_at),
  }));
}
