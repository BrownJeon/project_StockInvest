/**
 * 시그널 승인·거절의 **상태 전이** (T-042).
 *
 * 왜 따로 뺐나 — 승인 버튼이 텔레그램에도 생기면 같은 시그널을 웹과 텔레그램이 동시에 건드릴 수 있다.
 * 기존 `approveSignal*`/`rejectSignal` 은 "읽고 → 상태 확인 → `WHERE id=?` 로 UPDATE" 였다. 확인과 갱신
 * 사이에 다른 쪽이 끼면 (1) 이미 `expired`/`rejected` 인 행을 승인 상태로 **덮어쓰고**, (2) 둘이 동시에
 * 승인하면 `submitOrder` 가 **두 번** 불린다(이중 주문). 그래서 모든 전이를
 * `UPDATE … WHERE id=? AND status IN (승인 대기 집합)` + `affectedRows` 검사로 한 문장에 묶는다.
 *
 * 이 파일은 `db`·`notify` 를 import 하지 않는다 — 풀은 호출처가 넘긴다(테스트에서 가짜 풀을 넣는다).
 */
import { AWAITING_APPROVAL_STATUSES, isAwaitingApproval, sqlStatusList } from './statuses';
import { parsePriceZone } from './scenario-builder';

/** 테스트가 가짜 풀을 넣을 수 있도록 필요한 면만 선언한다. mysql2 `Pool` 이 구조적으로 만족한다. */
export interface SqlRunner {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

export type TransitionFailure =
  | 'not_found'
  | `invalid_status:${string}`
  | 'signal_expired'
  /** 읽는 사이 다른 쪽이 상태를 바꿨다(행은 있고 승인 대기이며 만료 전인데 갱신 실패) */
  | 'transition_conflict';

export type TransitionResult = { ok: true } | { ok: false; error: TransitionFailure };

const AWAITING_SQL = sqlStatusList(AWAITING_APPROVAL_STATUSES);
/** 거절은 manual 모드의 `detected` 도 "관심 없음"으로 정리할 수 있어야 한다. */
const REJECTABLE_SQL = sqlStatusList([...AWAITING_APPROVAL_STATUSES, 'detected']);

interface AffectedHeader { affectedRows?: number }

function affected(res: unknown): number {
  const head = Array.isArray(res) ? res[0] : res;
  const n = (head as AffectedHeader | undefined)?.affectedRows;
  return typeof n === 'number' ? n : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// 승인 경로 선택 (D1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `indicators.ai.scenario.entry.price_zone` 을 읽는다 — **`entry-watcher` 와 같은 규칙**이어야 한다.
 * 구간이 없는 시그널을 진입 감시에 넘기면 감시가 `no_zone` 으로 건너뛰어 **주문이 영원히 안 나간다.**
 */
export function extractEntryZone(indicators: unknown): [number, number] | null {
  try {
    const ind: unknown = typeof indicators === 'string' ? JSON.parse(indicators) : indicators;
    if (ind == null || typeof ind !== 'object') return null;
    const ai = (ind as Record<string, unknown>)['ai'];
    if (ai == null || typeof ai !== 'object') return null;
    const scenario = (ai as Record<string, unknown>)['scenario'];
    if (scenario == null || typeof scenario !== 'object') return null;
    const entry = (scenario as Record<string, unknown>)['entry'];
    if (entry == null || typeof entry !== 'object') return null;
    const raw = (entry as Record<string, unknown>)['price_zone'];
    return typeof raw === 'string' ? parsePriceZone(raw) : null;
  } catch {
    return null;
  }
}

export type ApprovalPath = 'hybrid' | 'immediate';

/**
 * 승인하면 무엇이 일어나는가.
 *  - 하이브리드 모드이고 **진입 구간이 있을 때만**(또는 사용자가 구간을 직접 고쳐 보냈을 때) 진입 감시에 등록한다.
 *  - 그 외는 즉시 지정가 주문. 룰 시그널(RSI 과매도 등)에는 구간이 없다 — 이들을 감시에 넘기던 이전 동작은
 *    승인해도 주문이 나가지 않는 막다른 길이었다.
 */
export function resolveApprovalPath(args: {
  hybridEnabled: boolean;
  indicators: unknown;
  hasEditedScenario?: boolean;
}): ApprovalPath {
  if (!args.hybridEnabled) return 'immediate';
  if (args.hasEditedScenario === true) return 'hybrid';
  return extractEntryZone(args.indicators) !== null ? 'hybrid' : 'immediate';
}

/**
 * 하이브리드 모드 여부 — **웹 승인 라우트와 텔레그램 처리기가 같은 함수를 쓴다.**
 * DB 행(`hybrid_mode_enabled`)이 있으면 그 값이 이기고(false 도 env 를 이긴다), 없을 때만 env 로 폴백한다.
 * (`getRouterConfig` 는 DB 가 false 일 때 env 로 폴백해 이 규칙과 달랐다 — 두 경로의 승인 방식이 갈릴 수 있었다.)
 */
export async function readHybridModeEnabled(pool: SqlRunner): Promise<boolean> {
  try {
    const res = await pool.query('SELECT value FROM system_config WHERE `key` = ? LIMIT 1', ['hybrid_mode_enabled']);
    const rows = (Array.isArray(res) ? res[0] : res) as Array<{ value: string }> | undefined;
    if (rows && rows.length > 0) return JSON.parse(rows[0].value) === true;
  } catch { /* 읽지 못하면 env 로 */ }
  return String(process.env.HYBRID_MODE_ENABLED ?? 'false').toLowerCase() === 'true';
}

// ─────────────────────────────────────────────────────────────────────────────
// 원자적 전이
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 전이에 실패한 이유를 밝힌다. 만료된 행은 여기서 `expired` 로 정리한다(역시 조건부 UPDATE).
 */
async function explainFailure(pool: SqlRunner, id: number): Promise<TransitionFailure> {
  const res = await pool.query('SELECT status, expires_at FROM signals WHERE id=? LIMIT 1', [id]);
  const rows = (Array.isArray(res) ? res[0] : res) as Array<{ status: string; expires_at: unknown }> | undefined;
  const row = rows?.[0];
  if (!row) return 'not_found';
  if (!isAwaitingApproval(row.status)) return `invalid_status:${row.status}`;
  const exp = row.expires_at != null ? new Date(row.expires_at as string | number | Date).getTime() : NaN;
  if (Number.isFinite(exp) && exp <= Date.now()) {
    await pool.query(
      `UPDATE signals SET status='expired', updated_at=NOW() WHERE id=? AND status IN (${AWAITING_SQL})`,
      [id],
    );
    return 'signal_expired';
  }
  return 'transition_conflict';
}

/**
 * 승인 대기 시그널을 `to` 로 **원자적으로** 옮긴다. 대기 상태이고 만료 전일 때만 성공한다.
 *
 *  - `executing`              : 즉시 주문 경로의 **선점**. 이 UPDATE 를 이긴 쪽만 `submitOrder` 를 부른다.
 *  - `approved_pending_entry` : 진입 감시 등록. `indicatorsJson` 이 있으면 같은 문장에서 함께 갱신한다.
 */
export async function claimAwaitingSignal(
  pool: SqlRunner,
  id: number,
  to: 'executing' | 'approved_pending_entry',
  opts: { indicatorsJson?: string } = {},
): Promise<TransitionResult> {
  // `to` 는 위 닫힌 유니온이라 SQL 리터럴로 안전하다(사용자 입력이 아님).
  const res = opts.indicatorsJson != null
    ? await pool.query(
        `UPDATE signals SET indicators=?, status='${to}', updated_at=NOW()
         WHERE id=? AND status IN (${AWAITING_SQL}) AND (expires_at IS NULL OR expires_at > NOW())`,
        [opts.indicatorsJson, id],
      )
    : await pool.query(
        `UPDATE signals SET status='${to}', updated_at=NOW()
         WHERE id=? AND status IN (${AWAITING_SQL}) AND (expires_at IS NULL OR expires_at > NOW())`,
        [id],
      );
  if (affected(res) === 1) return { ok: true };
  return { ok: false, error: await explainFailure(pool, id) };
}

/**
 * 선점(`executing`)을 원래 대기 상태로 되돌린다. 주문이 거부·차단됐거나 호출이 예외로 끝났을 때 —
 * 사람이 다시 판단할 수 있어야 하고(만료까지), "승인해서 주문했다"는 거짓 기록을 남기지 않는다(T-020 취지).
 * `executing` 인 행만 건드리므로 그 사이 다른 상태로 바뀐 행은 덮어쓰지 않는다.
 */
export async function releaseClaim(pool: SqlRunner, id: number, restoreTo: string): Promise<void> {
  const target = isAwaitingApproval(restoreTo) ? restoreTo : 'awaiting_approval';
  await pool.query(
    `UPDATE signals SET status=?, updated_at=NOW() WHERE id=? AND status='executing'`,
    [target, id],
  );
}

/** 대기(또는 `detected`) 시그널을 `rejected` 로 **원자적으로** 옮긴다. 만료 여부는 보지 않는다(정리 목적). */
export async function rejectAwaitingSignal(pool: SqlRunner, id: number): Promise<TransitionResult> {
  const res = await pool.query(
    `UPDATE signals SET status='rejected', updated_at=NOW() WHERE id=? AND status IN (${REJECTABLE_SQL})`,
    [id],
  );
  if (affected(res) === 1) return { ok: true };
  const check = await pool.query('SELECT status FROM signals WHERE id=? LIMIT 1', [id]);
  const rows = (Array.isArray(check) ? check[0] : check) as Array<{ status: string }> | undefined;
  const row = rows?.[0];
  if (!row) return { ok: false, error: 'not_found' };
  return { ok: false, error: `invalid_status:${row.status}` };
}
