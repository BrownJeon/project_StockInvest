import { Agent } from 'undici';
import type { AlertLevel } from './slack';
import { getCredential } from '@/lib/credentials';

// IPv6 outbound 가 unreachable 인 호스트에서 ETIMEDOUT 방지 — IPv4 강제.
const ipv4Dispatcher = new Agent({ connect: { family: 4 } });

const LEVEL_PREFIX: Record<AlertLevel, string> = {
  critical: '🚨',
  warning:  '⚠️',
  info:     'ℹ️',
};

function kstNow(): string {
  return new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

export async function sendTelegramAlert(
  level: AlertLevel,
  title: string,
  body: string,
): Promise<void> {
  const [token, chatId, projectTag] = await Promise.all([
    getCredential('TELEGRAM_BOT_TOKEN'),
    getCredential('TELEGRAM_CHAT_ID'),
    getCredential('NOTIFY_PROJECT_TAG'),
  ]);
  if (!token || !chatId) return;

  const emoji = LEVEL_PREFIX[level];
  const project = projectTag.trim() || 'StockInvest';
  const text = `<b>[${project}] ${emoji} ${title}</b>\n${body}\n\n🕐 ${kstNow()} KST`;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const init: RequestInit & { dispatcher?: unknown } = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, parse_mode: 'HTML', text }),
    dispatcher: ipv4Dispatcher,
  };
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(url, init);
      if (!res.ok) console.error(`[telegram] sendMessage failed: ${res.status}`);
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (i === 0 && /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|aborted|UND_ERR/i.test(msg)) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      const cause = (e as { cause?: { errors?: unknown[]; code?: string; message?: string } }).cause;
      const errors = cause?.errors ? cause.errors.map(x => String(x)) : [];
      console.error('[telegram] fetch error:', msg, '| cause:', cause?.code ?? cause?.message ?? cause, '| errors:', errors);
      return;
    }
  }
}
