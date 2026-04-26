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
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;

  const { emoji, color } = LEVEL_META[level];

  const payload = {
    attachments: [
      {
        color,
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*${emoji} ${title}*\n${body}` },
          },
          {
            type: 'context',
            elements: [{ type: 'mrkdwn', text: `🕐 ${kstNow()} KST` }],
          },
        ],
      },
    ],
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`[slack] webhook failed: ${res.status}`);
    }
  } catch (e) {
    console.error('[slack] fetch error:', e);
  }
}
