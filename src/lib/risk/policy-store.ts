/**
 * T-066 리스크 정책 저장소·조회 (서버 전용).
 *
 * - 정책: `system_config.risk_policy` 한 키(JSON). **편집 3값 + version·updatedAt·history** 만 저장한다.
 *   읽기 전용 정책 값·출처는 저장하지 않고 `defaults.ts` 상수에서 매번 채운다.
 * - 보유·현재가·총자산: 최신 `portfolio_snapshots` (읽기 전용)
 * - 평균단가·고점: `position_state` (읽기 전용 — 이 모듈은 position_state 에 쓰지 않는다)
 *
 * KIS·외부 호출 없음. DDL 없음. 주문·시그널·청산 경로와 연결하지 않는다.
 */
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import {
  HISTORY_LIMIT, LIMITS, RISK_POLICY_KEY, SNAPSHOT_STALE_MS,
  type RiskPolicyEditable,
} from './defaults';
import { isStopBasis, type HoldingInput } from './compute';

export interface PolicyHistoryEntry extends RiskPolicyEditable {
  version: number;
  at: string;
}

/** DB 에 저장되는 형태 (읽기 전용 값 없음) */
export interface StoredRiskPolicy extends RiskPolicyEditable {
  version: number;
  updatedAt: string;
  history: PolicyHistoryEntry[];
}

/** 손상된 정책 값 복구 안내 (오류 문구에 붙인다) */
export const RECOVERY_HINT = '복구: system_config 의 risk_policy 키를 삭제한 뒤 리스크 정책 화면에서 다시 저장하세요';

export type PolicyRead =
  | { status: 'absent' }
  | { status: 'ok'; policy: StoredRiskPolicy }
  | { status: 'invalid'; detail: string };

function parseStored(raw: unknown): PolicyRead {
  let v: unknown = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return { status: 'invalid', detail: 'JSON 이 아님' }; }
  }
  if (!v || typeof v !== 'object') return { status: 'invalid', detail: '객체가 아님' };
  const o = v as Record<string, unknown>;
  const version = Number(o.version);
  const stopPct = Number(o.stopPct);
  const heatCapPct = Number(o.heatCapPct);
  if (!Number.isInteger(version) || version < 1) return { status: 'invalid', detail: 'version 없음' };
  if (!Number.isFinite(stopPct) || !Number.isFinite(heatCapPct)) return { status: 'invalid', detail: '숫자 값 없음' };
  // 수동 편집 등으로 범위 밖 값이 들어오면 0 나눗셈·Infinity 표시가 나므로 손상으로 본다 (Reviewer L-3)
  if (stopPct < LIMITS.stopPct.min || stopPct > LIMITS.stopPct.max) return { status: 'invalid', detail: `stopPct 범위 밖(${stopPct})` };
  if (heatCapPct < LIMITS.heatCapPct.min || heatCapPct > LIMITS.heatCapPct.max) return { status: 'invalid', detail: `heatCapPct 범위 밖(${heatCapPct})` };
  if (!isStopBasis(o.stopBasis)) return { status: 'invalid', detail: 'stopBasis 값 오류' };
  const history = Array.isArray(o.history)
    ? (o.history as unknown[]).filter((e): e is PolicyHistoryEntry => !!e && typeof e === 'object').slice(-HISTORY_LIMIT)
    : [];
  return {
    status: 'ok',
    policy: {
      version, stopPct, heatCapPct, stopBasis: o.stopBasis,
      updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : '',
      history,
    },
  };
}

/** 정책 읽기. DB 오류는 던진다(호출부가 '조회 오류'로 응답). */
export async function readRiskPolicy(): Promise<PolicyRead> {
  const [rows] = await getPool().query<(RowDataPacket & { value: unknown })[]>(
    'SELECT value FROM system_config WHERE `key` = ? LIMIT 1',
    [RISK_POLICY_KEY],
  );
  if (rows.length === 0) return { status: 'absent' };
  return parseStored(rows[0].value);
}

export type SaveResult =
  | { ok: true; policy: StoredRiskPolicy }
  | { ok: false; conflict: true; latest: StoredRiskPolicy | null };

function isDupKey(e: unknown): boolean {
  const code = (e as { code?: string; errno?: number } | null)?.code;
  const errno = (e as { errno?: number } | null)?.errno;
  return code === 'ER_DUP_ENTRY' || errno === 1062;
}

/**
 * 편집 3값 저장 (낙관적 동시성).
 * - 정책 없음 + baseVersion 0 → INSERT (중복 키면 다른 기기가 먼저 만든 것 → 409)
 * - 정책 있음 → baseVersion 이 현재 version 과 같을 때만 조건부 UPDATE (영향 행 0 → 409)
 */
export async function saveRiskPolicy(
  values: RiskPolicyEditable,
  baseVersion: number,
  now: Date = new Date(),
): Promise<SaveResult> {
  const current = await readRiskPolicy();
  if (current.status === 'invalid') {
    throw new Error(`저장된 risk_policy 값이 손상돼 덮어쓰지 않았습니다 (${current.detail}) — ${RECOVERY_HINT}`);
  }
  const at = now.toISOString();

  if (current.status === 'absent') {
    if (baseVersion !== 0) return { ok: false, conflict: true, latest: null };
    const policy: StoredRiskPolicy = {
      version: 1, updatedAt: at, ...values,
      history: [{ version: 1, at, ...values }],
    };
    try {
      await getPool().query(
        'INSERT INTO system_config (`key`, value) VALUES (?, ?)',
        [RISK_POLICY_KEY, JSON.stringify(policy)],
      );
    } catch (e) {
      if (!isDupKey(e)) throw e;
      const latest = await readRiskPolicy();
      return { ok: false, conflict: true, latest: latest.status === 'ok' ? latest.policy : null };
    }
    return { ok: true, policy };
  }

  const cur = current.policy;
  if (baseVersion !== cur.version) return { ok: false, conflict: true, latest: cur };
  const version = cur.version + 1;
  const policy: StoredRiskPolicy = {
    version, updatedAt: at, ...values,
    history: [...cur.history, { version, at, ...values }].slice(-HISTORY_LIMIT),
  };
  const [res] = await getPool().query<ResultSetHeader>(
    "UPDATE system_config SET value = ? WHERE `key` = ? AND CAST(JSON_EXTRACT(value, '$.version') AS UNSIGNED) = ?",
    [JSON.stringify(policy), RISK_POLICY_KEY, baseVersion],
  );
  if (!res || res.affectedRows === 0) {
    const latest = await readRiskPolicy();
    return { ok: false, conflict: true, latest: latest.status === 'ok' ? latest.policy : null };
  }
  return { ok: true, policy };
}

// ─── 스냅샷 + position_state ───────────────────────────────────────────────

export interface SnapshotInfo {
  at: string;
  stale: boolean;
  totalKrw: number;
  cashKrw: number;
  /** USD 현금 행의 환율 (원/USD). USD 행이 없으면 null */
  fx: number | null;
}

interface SnapshotPositionLike {
  currency?: unknown;
  qty?: unknown;
  price?: unknown;
  value_krw?: unknown;
}

const OVERSEAS = /^[A-Z]{3}:[A-Z][A-Z0-9.]*$/;

/** 최신 스냅샷의 보유 목록·현금·환율과 position_state 의 평균단가·고점을 합친다. */
export async function readHoldings(now: Date = new Date()): Promise<{ snapshot: SnapshotInfo | null; holdings: HoldingInput[] }> {
  const pool = getPool();
  const [snaps] = await pool.query<RowDataPacket[]>(
    'SELECT ts, total_krw, positions FROM portfolio_snapshots ORDER BY ts DESC LIMIT 1',
  );
  const s = snaps[0];
  if (!s) return { snapshot: null, holdings: [] };

  const raw: unknown = s.positions;
  let parsed: unknown = raw;
  if (typeof raw === 'string') { try { parsed = JSON.parse(raw); } catch { parsed = []; } }
  const positions: SnapshotPositionLike[] = Array.isArray(parsed) ? parsed as SnapshotPositionLike[] : [];

  let cashKrw = 0;
  let fx: number | null = null;
  const held: { symbol: string; market: 'domestic' | 'overseas'; qty: number; priceKrw: number | null }[] = [];
  for (const p of positions) {
    const cur = typeof p.currency === 'string' ? p.currency : '';
    const qty = Number(p.qty);
    const price = Number(p.price);
    if (cur === 'KRW' || cur === 'USD') {
      const v = Number(p.value_krw);
      if (Number.isFinite(v)) cashKrw += v;
      if (cur === 'USD' && Number.isFinite(price) && price > 0) fx = price;
      continue;
    }
    if (!cur || !Number.isFinite(qty) || qty <= 0) continue;
    held.push({
      symbol: cur,
      market: OVERSEAS.test(cur) ? 'overseas' : 'domestic',
      qty,
      priceKrw: Number.isFinite(price) && price > 0 ? price : null,
    });
  }

  const states = new Map<string, { entry: number; peak: number }>();
  if (held.length > 0) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT symbol, market, entry_price, peak_price FROM position_state
        WHERE (symbol, market) IN (${held.map(() => '(?, ?)').join(', ')})`,
      held.flatMap(h => [h.symbol, h.market]),
    );
    for (const r of rows) {
      states.set(`${r.symbol}|${r.market}`, { entry: Number(r.entry_price), peak: Number(r.peak_price) });
    }
  }

  const holdings: HoldingInput[] = held.map(h => {
    const st = states.get(`${h.symbol}|${h.market}`);
    return {
      symbol: h.symbol,
      market: h.market,
      qty: h.qty,
      priceKrw: h.priceKrw,
      avgKrw: st && Number.isFinite(st.entry) && st.entry > 0 ? st.entry : null,
      peakKrw: st && Number.isFinite(st.peak) && st.peak > 0 ? st.peak : null,
    };
  });

  const ts = new Date(s.ts);
  return {
    snapshot: {
      at: ts.toISOString(),
      stale: now.getTime() - ts.getTime() > SNAPSHOT_STALE_MS,
      totalKrw: Number(s.total_krw),
      cashKrw,
      fx,
    },
    holdings,
  };
}
