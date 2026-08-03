import type { AlertLevel } from './slack';
import { getCredential } from '@/lib/credentials';

// IPv6 outbound 가 unreachable 인 호스트에서 ETIMEDOUT 방지 — IPv4 우선 해석.
//
// 이전에는 `new Agent({ connect: { family: 4 } })` (undici) 를 dispatcher 로 주입했으나
// Phase 0(2026-08-02)에 제거했다. 사유:
//  1) `undici` 는 초기 커밋 이래 package.json·package-lock·node_modules 어디에도 없었다.
//     즉 이 dispatcher 는 한 번도 실제로 동작한 적이 없고, import 때문에 빌드만 깨져 있었다.
//  2) 동일 목적(IPv4 강제)은 ecosystem.config.js 의
//     `NODE_OPTIONS: '--dns-result-order=ipv4first'` 가 프로세스 전역으로 이미 달성한다.
//  3) 형제 모듈 slack.ts 가 같은 구조에서 표준 fetch 만으로 정상 동작한다.
// Node 20+ 는 Happy Eyeballs(autoSelectFamily) 기본 활성이라 IPv4 실패 시 IPv6 로 폴백한다.

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
      const cause = (e as { cause?: { errors?: unknown[]; code?: string; message?: string } }).cause;
      const errors = cause?.errors ? cause.errors.map(x => String(x)) : [];
      console.error('[telegram] fetch error:', msg, '| cause:', cause?.code ?? cause?.message ?? cause, '| errors:', errors);
      return;
    }
  }
}
