import type { Pool } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';
import { NextRequest, NextResponse } from 'next/server';
import { requireUserId, type CurrentUser } from '@/lib/auth/current-user';
import { findUserById } from '@/lib/auth/users';

/** A valid cookie does not prove the user account still exists. DB errors propagate closed. */
export async function requireChatUser(req: NextRequest): Promise<CurrentUser> {
  const auth = await requireUserId(req);
  if (!auth.ok) return auth;
  if (!(await findUserById(auth.userId))) {
    return { ok: false, res: NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 }) };
  }
  return auth;
}

/** IDs in the current UI/API are JS numbers; do not round BIGINT identifiers. */
export function parseThreadId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

/** NULL legacy rows are never accessible until explicitly assigned by migration. */
export async function ownedThread(pool: Pool, threadId: number, userId: number): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT t.id FROM chat_threads t INNER JOIN users u ON u.id = t.user_id WHERE t.id = ? AND t.user_id = ? LIMIT 1',
    [threadId, userId],
  );
  return rows.length > 0;
}

/** MySQL BIGINTs may arrive as strings or already-rounded numbers. Never expose a rounded ID. */
export function databaseId(value: unknown): number | null {
  if (typeof value === 'string') return parseThreadId(value);
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}
