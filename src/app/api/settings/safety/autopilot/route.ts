import { NextRequest, NextResponse } from 'next/server';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { requireUserId } from '@/lib/auth/current-user';
import { getPool } from '@/lib/db';
import { decodeFlagValue, parseBoolFlag } from '@/lib/safety/flags';
import { parseStoredAutopilotMode, type AutopilotMode } from '@/lib/signals/autopilot';

export const dynamic = 'force-dynamic';

const SELECT_SETTINGS = "SELECT `key`, value FROM system_config WHERE `key` IN ('autopilot_mode', 'safety_dry_run', 'safety_kill_switch') ORDER BY `key`";

interface SettingRow extends RowDataPacket { key: string; value: string }
interface Change {
  mode: 'auto' | 'assist';
  expectedMode: AutopilotMode;
  expectedDryRun: boolean;
  expectedKillSwitch: boolean;
}

function effectiveFlag(raw: string | undefined, env: string | undefined, defaultValue: boolean): boolean {
  const db = parseBoolFlag(decodeFlagValue(raw));
  const flag = db.state === 'unset' ? parseBoolFlag(env) : db;
  if (flag.state === 'parsed') return flag.value;
  return flag.state === 'unparsable' || defaultValue;
}

function snapshot(rows: SettingRow[]) {
  const values = new Map(rows.map(row => [row.key, row.value]));
  return {
    mode: parseStoredAutopilotMode(values.get('autopilot_mode')),
    dryRun: effectiveFlag(values.get('safety_dry_run'), process.env.DRY_RUN, true),
    killSwitch: effectiveFlag(values.get('safety_kill_switch'), process.env.KILL_SWITCH, false),
  };
}

function validChange(body: unknown): body is Change {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 4) return false;
  const fields = body as Record<string, unknown>;
  return (fields.mode === 'auto' || fields.mode === 'assist')
    && (fields.expectedMode === 'manual' || fields.expectedMode === 'assist' || fields.expectedMode === 'auto')
    && typeof fields.expectedDryRun === 'boolean'
    && typeof fields.expectedKillSwitch === 'boolean';
}

function error(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (!auth.ok) return auth.res;
  try {
    const [rows] = await getPool().query<SettingRow[]>(SELECT_SETTINGS);
    return NextResponse.json({ ok: true, ...snapshot(rows) }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return error('자동승인모드를 읽지 못했습니다.', 503);
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireUserId(req);
  if (!auth.ok) return auth.res;
  // 브라우저가 설정하는 Fetch Metadata 값으로 교차 사이트와 형제 도메인 요청을 거부한다.
  if (req.headers.get('sec-fetch-site') !== 'same-origin') return error('같은 사이트의 설정 화면에서 변경하세요.', 403);
  if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return error('JSON 요청이 필요합니다.', 415);
  }
  const body: unknown = await req.json().catch(() => null);
  if (!validChange(body)) return error('자동승인모드 요청 값이 올바르지 않습니다.', 400);

  let connection: PoolConnection | undefined;
  let committed = false;
  try {
    connection = await getPool().getConnection();
    // 기본값을 쓰는 DB 키가 아직 없을 때도 동시 INSERT와 확인/저장을 직렬화한다.
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.beginTransaction();
    const [rows] = await connection.query<SettingRow[]>(`${SELECT_SETTINGS} FOR UPDATE`);
    const current = snapshot(rows);
    if (current.mode !== body.expectedMode || current.dryRun !== body.expectedDryRun
      || current.killSwitch !== body.expectedKillSwitch || (current.mode === 'manual' && body.mode === 'auto')) {
      return error('현재 설정이 달라졌습니다. 다시 확인한 뒤 변경하세요.', 409);
    }

    if (current.mode !== body.mode) {
      await connection.execute('UPDATE system_config SET value = ? WHERE `key` = ?', [JSON.stringify(body.mode), 'autopilot_mode']);
    }
    await connection.commit();
    committed = true;
    if (current.mode !== body.mode) {
      console.info('[settings:autopilot]', { userId: auth.userId, from: current.mode, to: body.mode });
    }
    return NextResponse.json({ ok: true, ...current, mode: body.mode });
  } catch {
    return error('자동승인모드 저장 결과를 확인하지 못했습니다.', 503);
  } finally {
    if (connection) {
      if (!committed) await connection.rollback().catch(() => connection?.destroy());
      connection.release();
    }
  }
}
