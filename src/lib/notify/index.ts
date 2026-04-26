export type { AlertLevel } from './slack';
import type { AlertLevel } from './slack';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { sendSlackAlert }    from './slack';
import { sendTelegramAlert } from './telegram';

type NotifyChannel = 'none' | 'telegram' | 'slack' | 'both';

let channelCache: { value: NotifyChannel; ts: number } | null = null;
const TTL_MS = 30_000;

async function getChannel(): Promise<NotifyChannel> {
  if (channelCache && Date.now() - channelCache.ts < TTL_MS) return channelCache.value;
  let value: NotifyChannel = 'both';   // 미설정 시 기본 — 둘 다 시도 (기존 동작 유지)
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { value: string })[]>(
      "SELECT value FROM system_config WHERE `key` = 'notify_channel' LIMIT 1",
    );
    if (rows.length > 0) {
      try {
        const parsed = JSON.parse(rows[0].value);
        if (parsed === 'none' || parsed === 'telegram' || parsed === 'slack' || parsed === 'both') {
          value = parsed;
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  channelCache = { value, ts: Date.now() };
  return value;
}

export function sendAlert(level: AlertLevel, title: string, body: string): void {
  (async () => {
    const ch = await getChannel();
    if (ch === 'none') return;
    if (ch === 'slack' || ch === 'both')    sendSlackAlert(level, title, body).catch(() => {});
    if (ch === 'telegram' || ch === 'both') sendTelegramAlert(level, title, body).catch(() => {});
  })().catch(() => {});
}
