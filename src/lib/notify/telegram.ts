import type { AlertLevel } from './slack';
import { getCredential } from '@/lib/credentials';
import { trackCall } from '@/lib/api-usage';
import { escapeAlertText } from './escape';
import {
  type NotifyResult, NOTIFY_OK, NOTIFY_SKIPPED, notifyFailed,
  isTransientNetworkError, redactSecrets, readBodySnippet, causeCodeOf,
} from './result';

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

/**
 * Slack mrkdwn 본문 → Telegram HTML(parse_mode='HTML') 변환.
 *
 * `sendTelegramAlert` 는 parse_mode='HTML' 로 보내는데, Slack 과 본문을 공유하는 호출부
 * (예: trade-report)는 `*굵게*` mrkdwn 을 쓴다. HTML 모드에서 `*` 는 서식이 아니라
 * 리터럴이라 사용자에게 별표가 그대로 노출되고 굵게 처리도 되지 않는다.
 *
 * 1) `&` `<` `>` 를 먼저 엔티티로 이스케이프 — 미이스케이프 시 텔레그램이 400 으로 거절하고
 *    호출부의 `.catch()` 가 이를 삼켜 조용히 실패한다.
 * 2) 한 줄 안에서 짝이 맞는 `*…*` 만 `<b>…</b>` 로 변환.
 *
 * **전역(sendTelegramAlert 내부) 적용은 하지 않는다** — holding-checker 처럼 본문에 직접
 * `<b>` 를 넣는 호출부가 있어 일괄 이스케이프하면 그쪽이 깨진다. mrkdwn 본문을 보내는
 * 호출부에서만 명시적으로 감싼다.
 *
 * T-010(2026-08-09): 1)의 엔티티 이스케이프는 `notify/escape.ts` 의 `escapeAlertText` 로
 * **추출**됐다(동작 동일). 슬랙 mrkdwn 도 같은 세 글자를 escape 해야 해서, `dispatchAlert`
 * 로 두 채널에 같은 본문을 보내는 호출부가 그 함수를 재사용한다 — 구현은 하나로 유지한다.
 */
export function mrkdwnToTelegramHtml(body: string): string {
  // 순서 주의: 이스케이프가 먼저다. 뒤집으면 아래에서 만든 <b> 까지 이스케이프된다.
  return escapeAlertText(body)
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>');
}

/**
 * 텔레그램 sendMessage. **예외를 던지지 않고** 결과를 반환한다.
 *  - `{ ok: true }`                 전달 성공
 *  - `{ ok: false, skipped: true }` 토큰/채팅ID 미설정 — 재시도해도 동일
 *  - `{ ok: false, error }`         실제 전송 실패 (재시도 가치 있음)
 *
 * 반환 타입을 `void` 에서 바꾼 이유: 2026-08-04 08:03 정기 리포트가 ETIMEDOUT 으로
 * 유실됐는데 호출부가 이를 알 방법이 없어 `sent:true` 로 응답하고 last_sent_at 까지
 * 갱신됐다. 던지지 않고 반환하는 이유는 기존 fire-and-forget 호출부의 동작 보존.
 */
export async function sendTelegramAlert(
  level: AlertLevel,
  title: string,
  body: string,
): Promise<NotifyResult> {
  const [token, chatId, projectTag] = await Promise.all([
    getCredential('TELEGRAM_BOT_TOKEN'),
    getCredential('TELEGRAM_CHAT_ID'),
    getCredential('NOTIFY_PROJECT_TAG'),
  ]);
  if (!token || !chatId) return NOTIFY_SKIPPED;

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
      // T-040 호출 기록 — 시도 1번 = 한 줄(토큰이 든 URL 은 기록되지 않는다).
      const res = await trackCall('telegram', 'alert.send-message', () => fetch(url, init));
      if (!res.ok) {
        // 400(파싱 실패·본문 초과) / 401(토큰 폐기) 등은 재시도해도 동일 — 즉시 실패 반환.
        // 본문에 담긴 description 은 진단에 결정적이므로 함께 남긴다(비밀값 없음).
        const snippet = redactSecrets(await readBodySnippet(res), token);
        const reason = `HTTP ${res.status}${snippet ? ` ${snippet}` : ''}`;
        console.error(`[telegram] sendMessage failed: ${reason}`);
        return notifyFailed(reason);
      }
      return NOTIFY_OK;
    } catch (e) {
      const msg = redactSecrets(e instanceof Error ? e.message : String(e), token);
      if (i === 0 && isTransientNetworkError(msg)) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      const cause = (e as { cause?: { errors?: unknown[] } }).cause;
      const errors = cause?.errors ? cause.errors.map(x => redactSecrets(String(x), token)) : [];
      const code = redactSecrets(causeCodeOf(e), token);
      console.error('[telegram] fetch error:', msg, '| cause:', code, '| errors:', errors);
      const detail = [code, ...errors].filter(Boolean).join(' / ');
      return notifyFailed(detail ? `${msg} (${detail})` : msg);
    }
  }
  /* istanbul ignore next — 위 루프는 모든 경로에서 return 한다. 타입 완결용. */
  return notifyFailed('retry_exhausted');
}
