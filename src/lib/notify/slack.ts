import { getCredential } from '@/lib/credentials';

export type AlertLevel = 'critical' | 'warning' | 'info';

const LEVEL_META: Record<AlertLevel, { emoji: string; color: string }> = {
  critical: { emoji: '🚨', color: '#ef4444' },
  warning:  { emoji: '⚠️', color: '#f59e0b' },
  info:     { emoji: 'ℹ️', color: '#22c55e' },
};

function kstNow(): string {
  return new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

export async function sendSlackAlert(
  level: AlertLevel,
  title: string,
  body: string,
): Promise<void> {
  const [url, projectTag] = await Promise.all([
    getCredential('SLACK_WEBHOOK_URL'),
    getCredential('NOTIFY_PROJECT_TAG'),
  ]);
  if (!url) return;

  const { emoji, color } = LEVEL_META[level];
  const project = projectTag.trim() || 'StockInvest';

  const payload = {
    attachments: [
      {
        color,
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*[${project}] ${emoji} ${title}*\n${body}` },
          },
          {
            type: 'context',
            elements: [{ type: 'mrkdwn', text: `🕐 ${kstNow()} KST` }],
          },
        ],
      },
    ],
  };

  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(url, init);
      if (!res.ok) console.error(`[slack] webhook failed: ${res.status}`);
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (i === 0 && /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|aborted|UND_ERR/i.test(msg)) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      console.error('[slack] fetch error:', e);
      return;
    }
  }
}
