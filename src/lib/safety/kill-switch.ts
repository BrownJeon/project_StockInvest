import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

/** DB system_config override takes precedence over env var. */
export async function isKillSwitchActive(): Promise<boolean> {
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { value: string })[]>(
      'SELECT value FROM system_config WHERE `key` = ? LIMIT 1',
      ['safety_kill_switch'],
    );
    if (rows.length > 0) {
      const val = JSON.parse(rows[0].value);
      return val === true || val === 'true';
    }
  } catch {
    // DB unavailable — fall through to env
  }
  return String(process.env.KILL_SWITCH ?? 'false').toLowerCase() === 'true';
}
