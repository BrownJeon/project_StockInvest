import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

async function getVolGuardEnabled(): Promise<boolean> {
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { value: string })[]>(
      "SELECT value FROM system_config WHERE `key` = 'vol_guard_enabled' LIMIT 1",
    );
    if (rows.length > 0) return JSON.parse(rows[0].value) === true;
  } catch { /* fall through */ }
  return process.env.VOL_GUARD_ENABLED === 'true';
}

export interface VolatilityGuardResult {
  ok: boolean;
  level?: 'warn' | 'block' | 'panic';
  changePct?: number;
  detail?: string;
}

export interface VolatilityConfig {
  warnPct:   number;   // default -2%
  blockPct:  number;   // default -4%
  panicPct:  number;   // default -7%
  windowMin: number;   // default 60
}

export async function getVolatilityConfig(): Promise<VolatilityConfig> {
  const partial: Partial<VolatilityConfig> = {};
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { key: string; value: string })[]>(
      "SELECT `key`, value FROM system_config WHERE `key` LIKE 'vol_guard_%'",
    );
    for (const r of rows) {
      const v = Number(JSON.parse(r.value));
      if (r.key === 'vol_guard_warn_pct')   partial.warnPct   = v;
      if (r.key === 'vol_guard_block_pct')  partial.blockPct  = v;
      if (r.key === 'vol_guard_panic_pct')  partial.panicPct  = v;
      if (r.key === 'vol_guard_window_min') partial.windowMin = v;
    }
  } catch { /* fall through */ }
  return {
    warnPct:   partial.warnPct   ?? Number(process.env.VOL_GUARD_WARN_PCT   ?? -2),
    blockPct:  partial.blockPct  ?? Number(process.env.VOL_GUARD_BLOCK_PCT  ?? -4),
    panicPct:  partial.panicPct  ?? Number(process.env.VOL_GUARD_PANIC_PCT  ?? -7),
    windowMin: partial.windowMin ?? Number(process.env.VOL_GUARD_WINDOW_MIN ?? 60),
  };
}

/**
 * 심볼별 변동성 배율 (BTC 1.0x, ETH 1.3x, 신규 1.5x)
 */
function symbolMultiplier(symbol?: string): number {
  if (!symbol) return 1.5;
  const s = symbol.toUpperCase();
  if (s.includes('BTC')) return 1.0;
  if (s.includes('ETH')) return 1.3;
  return 1.5;
}

/**
 * 최근 windowMin 내 포트폴리오 변동률 확인.
 * - warn:  changePct ≤ warnPct  → 경고만
 * - block: changePct ≤ blockPct → KILL_SWITCH 권고 (호출부에서 처리)
 * - panic: changePct ≤ panicPct → 패닉 청산 권고
 */
export async function checkVolatilityGuard(
  symbol?: string,
): Promise<VolatilityGuardResult> {
  if (!(await getVolGuardEnabled())) return { ok: true };

  const cfg = await getVolatilityConfig();
  const mult = symbolMultiplier(symbol);
  const warnPct  = cfg.warnPct  * mult;
  const blockPct = cfg.blockPct * mult;
  const panicPct = cfg.panicPct * mult;

  try {
    const pool = getPool();
    const windowMs = cfg.windowMin * 60_000;
    const cutoff = new Date(Date.now() - windowMs);

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT total_krw FROM portfolio_snapshots
       WHERE ts >= ? ORDER BY ts ASC LIMIT 1`,
      [cutoff],
    );
    if (rows.length === 0) return { ok: true }; // 기준 스냅샷 없음 → 통과

    const baseline = Number(rows[0].total_krw);
    const [cur] = await pool.query<RowDataPacket[]>(
      `SELECT total_krw FROM portfolio_snapshots ORDER BY ts DESC LIMIT 1`,
    );
    if (!cur[0]) return { ok: true };

    const current = Number(cur[0].total_krw);
    if (baseline <= 0) return { ok: true };

    const changePct = ((current - baseline) / baseline) * 100;

    if (changePct <= panicPct) {
      return { ok: false, level: 'panic', changePct, detail: `${changePct.toFixed(2)}% ≤ panic ${panicPct}%` };
    }
    if (changePct <= blockPct) {
      return { ok: false, level: 'block', changePct, detail: `${changePct.toFixed(2)}% ≤ block ${blockPct}%` };
    }
    if (changePct <= warnPct) {
      // warn은 차단하지 않고 로그만
      console.warn(`[vol-guard] WARN ${changePct.toFixed(2)}% ≤ ${warnPct}%`);
      return { ok: true, level: 'warn', changePct };
    }
    return { ok: true, changePct };
  } catch (e) {
    // DB 실패 시 보수적 통과 (장애 시 주문 막지 않음)
    console.error('[vol-guard] check failed:', e);
    return { ok: true };
  }
}

/**
 * 현재 포트폴리오 스냅샷을 DB에 저장.
 * total_krw=0(KIS 미연동 등 부트스트랩 노이즈)은 저장하지 않음 — 수익률 베이스라인 오염 방지.
 */
export async function savePortfolioSnapshot(
  totalKRW: number,
  positions: unknown,
  source: 'hourly' | 'trade' | 'manual' = 'hourly',
): Promise<void> {
  if (!(totalKRW > 0)) return;
  const pool = getPool();
  await pool.query(
    `INSERT INTO portfolio_snapshots (ts, total_krw, positions, source) VALUES (NOW(), ?, ?, ?)`,
    [Math.round(totalKRW), JSON.stringify(positions), source],
  );
}
