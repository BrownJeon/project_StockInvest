import { getCredential } from '@/lib/credentials';
import {
  type NotifyResult, NOTIFY_OK, NOTIFY_SKIPPED, notifyFailed,
  isTransientNetworkError, redactSecrets, readBodySnippet, causeCodeOf,
} from './result';

export type AlertLevel = 'critical' | 'warning' | 'info';

const LEVEL_META: Record<AlertLevel, { emoji: string; color: string }> = {
  critical: { emoji: '🚨', color: '#ef4444' },
  warning:  { emoji: '⚠️', color: '#f59e0b' },
  info:     { emoji: 'ℹ️', color: '#22c55e' },
};

function kstNow(): string {
  return new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

/**
 * Slack 웹훅 전송. **예외를 던지지 않고** 결과를 반환한다.
 *  - `{ ok: true }`               전달 성공
 *  - `{ ok: false, skipped: true }` 웹훅 URL 미설정 — 재시도해도 동일
 *  - `{ ok: false, error }`        실제 전송 실패 (재시도 가치 있음)
 */
export async function sendSlackAlert(
  level: AlertLevel,
  title: string,
  body: string,
): Promise<NotifyResult> {
  const [url, projectTag] = await Promise.all([
    getCredential('SLACK_WEBHOOK_URL'),
    getCredential('NOTIFY_PROJECT_TAG'),
  ]);
  if (!url) return NOTIFY_SKIPPED;

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
      if (!res.ok) {
        // HTTP 레벨 거절(400 invalid_payload 등)은 재시도해도 동일하므로 즉시 실패 반환.
        const snippet = redactSecrets(await readBodySnippet(res), url);
        const reason = `HTTP ${res.status}${snippet ? ` ${snippet}` : ''}`;
        console.error(`[slack] webhook failed: ${reason}`);
        return notifyFailed(reason);
      }
      return NOTIFY_OK;
    } catch (e) {
      const msg = redactSecrets(e instanceof Error ? e.message : String(e), url);
      if (i === 0 && isTransientNetworkError(msg)) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      // AggregateError(듀얼스택 IPv4/IPv6 동시 실패)는 개별 원인이 cause.errors 에 담긴다.
      // telegram.ts 와 동일하게 펼쳐 남긴다 — 한쪽만 얇은 진단을 내면 장애 비교가 안 된다.
      const cause = (e as { cause?: { errors?: unknown[] } }).cause;
      const errors = cause?.errors ? cause.errors.map(x => redactSecrets(String(x), url)) : [];
      const code = redactSecrets(causeCodeOf(e), url);
      console.error('[slack] fetch error:', msg, '| cause:', code, '| errors:', errors);
      const detail = [code, ...errors].filter(Boolean).join(' / ');
      return notifyFailed(detail ? `${msg} (${detail})` : msg);
    }
  }
  /* istanbul ignore next — 위 루프는 모든 경로에서 return 한다. 타입 완결용. */
  return notifyFailed('retry_exhausted');
}
