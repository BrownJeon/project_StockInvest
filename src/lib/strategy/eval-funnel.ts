import type { ResultSetHeader } from 'mysql2';
import { getPool } from '@/lib/db';
import {
  GATE_STAGE,
  type FunnelGate,
  type FunnelMarket,
  type FunnelVerdict,
} from './eval-funnel-labels';

/**
 * eval_funnel 기록기 (T-002 Phase 1 관측).
 *
 * 설계 원칙 — **계측이 매매를 죽이면 안 된다**:
 *  1. 게이트마다 즉시 INSERT 하지 않는다. 런 스코프 in-memory 배열에 누적했다가
 *     runMarket 종료 시 multi-row INSERT 로 1~2회에 몰아 쓴다.
 *     (5분 cron × 70종목 × 13전략 규모에서 건별 INSERT 는 수만 쿼리를 유발한다)
 *  2. 기록 실패(테이블 부재·DB 장애)는 전부 try/catch 로 삼킨다. 엔진은 계속 돈다.
 *  3. 메모리 폭주 방지 — MAX_ROWS_PER_RUN 초과분은 카운트만 남기고 버린다.
 *  4. `EVAL_FUNNEL_ENABLED=false` 로 즉시 무력화 가능 (긴급 스위치).
 */

/** 런 1회가 남길 수 있는 최대 행 수. 초과분은 drop 되고 run 행 detail 에 droppedRows 로 남는다. */
export const MAX_ROWS_PER_RUN = 8000;

/** multi-row INSERT 1회당 행 수 */
const INSERT_CHUNK = 200;

/** 보존 기간 (일). 초과분은 flush 후 주기적으로 배치 삭제. */
const RETENTION_DAYS = 30;
/** prune 최소 간격 (ms) — 프로세스당. */
const PRUNE_INTERVAL_MS = 6 * 3600_000;
/** prune 1회당 삭제 상한 */
const PRUNE_LIMIT = 5000;

let lastPruneAt = 0;

export interface FunnelEvent {
  gate: FunnelGate;
  verdict: FunnelVerdict;
  /** 생략 시 GATE_STAGE[gate] 사용 */
  stage?: number;
  symbol?: string | null;
  strategyId?: string | null;
  side?: 'buy' | 'sell' | null;
  reason?: string | null;
  detail?: unknown;
}

export function isEvalFunnelEnabled(): boolean {
  return String(process.env.EVAL_FUNNEL_ENABLED ?? 'true').toLowerCase() !== 'false';
}

/** '{market}-{yyyyMMddHHmm}' (KST) */
export function buildRunId(market: FunnelMarket, now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 3600_000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const stamp =
    `${kst.getUTCFullYear()}${p(kst.getUTCMonth() + 1)}${p(kst.getUTCDate())}` +
    `${p(kst.getUTCHours())}${p(kst.getUTCMinutes())}`;
  return `${market}-${stamp}`;
}

export interface FlushResult {
  inserted: number;
  dropped: number;
  error?: string;
}

export class EvalFunnelRecorder {
  readonly runId: string;
  readonly market: FunnelMarket;
  private rows: FunnelEvent[] = [];
  private dropped = 0;
  private flushed = false;
  private readonly enabled: boolean;

  constructor(market: FunnelMarket, now: Date = new Date(), enabled = isEvalFunnelEnabled()) {
    this.market = market;
    this.runId = buildRunId(market, now);
    this.enabled = enabled;
  }

  get size(): number { return this.rows.length; }
  get droppedRows(): number { return this.dropped; }
  /** 테스트·디버깅용 — 아직 flush 되지 않은 이벤트 스냅샷 */
  peek(): readonly FunnelEvent[] { return this.rows; }

  /** 게이트 1건 기록. 절대 throw 하지 않는다. */
  record(ev: FunnelEvent): void {
    if (!this.enabled) return;
    if (this.rows.length >= MAX_ROWS_PER_RUN) { this.dropped++; return; }
    try {
      this.rows.push(ev);
    } catch { /* 계측 실패는 무시 */ }
  }

  skip(gate: FunnelGate, ev: Omit<FunnelEvent, 'gate' | 'verdict'> = {}): void {
    this.record({ ...ev, gate, verdict: 'skip' });
  }
  pass(gate: FunnelGate, ev: Omit<FunnelEvent, 'gate' | 'verdict'> = {}): void {
    this.record({ ...ev, gate, verdict: 'pass' });
  }
  error(gate: FunnelGate, ev: Omit<FunnelEvent, 'gate' | 'verdict'> = {}): void {
    this.record({ ...ev, gate, verdict: 'error' });
  }

  /**
   * 누적분을 eval_funnel 에 multi-row INSERT.
   * 실패해도 예외를 던지지 않는다 (엔진 무영향 보장).
   */
  async flush(): Promise<FlushResult> {
    const dropped = this.dropped;
    if (!this.enabled || this.rows.length === 0 || this.flushed) {
      this.flushed = true;
      this.rows = [];
      return { inserted: 0, dropped };
    }
    this.flushed = true;
    const rows = this.rows;
    this.rows = [];

    let inserted = 0;
    try {
      const pool = getPool();
      for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        const chunk = rows.slice(i, i + INSERT_CHUNK);
        const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(',');
        const params: Array<string | number | null> = [];
        for (const r of chunk) {
          params.push(
            this.runId,
            this.market,
            r.symbol ?? null,
            r.strategyId ?? null,
            r.side ?? null,
            r.stage ?? GATE_STAGE[r.gate] ?? 0,
            r.gate,
            r.verdict,
            r.reason ?? null,
            safeJson(r.detail),
          );
        }
        const [res] = await pool.query<ResultSetHeader>(
          `INSERT INTO eval_funnel
             (run_id, market, symbol, strategy_id, side, stage, gate, verdict, reason, detail)
           VALUES ${placeholders}`,
          params,
        );
        inserted += res?.affectedRows ?? chunk.length;
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.warn(`[eval-funnel] flush 실패 (엔진 영향 없음): ${error}`);
      return { inserted, dropped, error };
    }

    void pruneOldRows();
    return { inserted, dropped };
  }
}

function safeJson(v: unknown): string | null {
  if (v == null) return null;
  try {
    const s = JSON.stringify(v);
    if (s == null) return null;
    // MariaDB JSON 컬럼 안전 상한 — 비정상적으로 큰 detail 은 잘라낸다
    if (s.length > 60_000) return JSON.stringify({ truncated: true, size: s.length });
    return s;
  } catch {
    return null;
  }
}

/**
 * 30일 초과 행 배치 삭제 (프로세스당 6시간 간격, 1회 5000행 상한).
 * 파티션은 이 볼륨(일 ~2만행)에서 과설계 — 배치 삭제로 충분 (T-002 §2).
 * 실패는 무시.
 */
export async function pruneOldRows(now = Date.now()): Promise<number> {
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return 0;
  lastPruneAt = now;
  try {
    const pool = getPool();
    const [res] = await pool.query<ResultSetHeader>(
      `DELETE FROM eval_funnel WHERE ts < DATE_SUB(NOW(), INTERVAL ? DAY) LIMIT ?`,
      [RETENTION_DAYS, PRUNE_LIMIT],
    );
    return res?.affectedRows ?? 0;
  } catch {
    return 0;
  }
}

/** 테스트 전용 — prune 타이머 초기화 */
export function __resetPruneTimer(): void { lastPruneAt = 0; }
