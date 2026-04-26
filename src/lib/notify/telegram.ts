import type { AlertLevel } from './slack';
import { getCredential } from '@/lib/credentials';

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
  const [token, chatId] = await Promise.all([
    getCredential('TELEGRAM_BOT_TOKEN'),
    getCredential('TELEGRAM_CHAT_ID'),
  ]);
  if (!token || !chatId) return;

  const emoji = LEVEL_PREFIX[level];
  const text = `<b>${emoji} ${title}</b>\n${body}\n\n🕐 ${kstNow()} KST`;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, parse_mode: 'HTML', text }),
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
      console.error('[telegram] fetch error:', e);
      return;
    }
  }
}
