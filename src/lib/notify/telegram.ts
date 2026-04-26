import type { AlertLevel } from './slack';

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
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const emoji = LEVEL_PREFIX[level];
  const text = `<b>${emoji} ${title}</b>\n${body}\n\n🕐 ${kstNow()} KST`;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, parse_mode: 'HTML', text }),
    });
    if (!res.ok) {
      console.error(`[telegram] sendMessage failed: ${res.status}`);
    }
  } catch (e) {
    console.error('[telegram] fetch error:', e);
  }
}
