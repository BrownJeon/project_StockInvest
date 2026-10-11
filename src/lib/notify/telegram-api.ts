/**
 * 텔레그램 Bot API 저수준 클라이언트 — **버튼이 달린 메시지와 콜백 수신용** (T-042).
 *
 * `telegram.ts`(`sendTelegramAlert`)는 "던지지 않고 결과를 돌려주는 발송 전용"이고 메시지 ID 를 돌려주지 않는다.
 * 버튼 승인에는 (1) 키보드가 달린 발송, (2) `getUpdates`, (3) `answerCallbackQuery`, (4) `editMessageText` 가 필요해서
 * 같은 규약(토큰은 `getCredential`, 오류 문자열은 반드시 `redactSecrets`, 예외를 던지지 않음)으로 따로 둔다.
 *
 * 🔴 이 파일은 거래 승인 권한을 가진 채널의 입구다 — 훅 `SAFETY_PATHS` 에 포함돼 있다.
 *
 * 공유 봇 주의: 같은 봇 토큰을 TradingInvest 와 쓴다. 텔레그램은 봇당 `getUpdates` 소비자를 하나만 허용하고
 * (둘이면 409), 웹훅이 걸려 있으면 `getUpdates` 가 거부된다. 이 파일은 **웹훅을 걸지 않는다.**
 */
import { getCredential } from '@/lib/credentials';
import { causeCodeOf, isTransientNetworkError, readBodySnippet, redactSecrets } from './result';

export interface InlineButton {
  text: string;
  /** 1~64 바이트. 우리 접두는 `si1:` (다른 프로젝트 콜백과 구분) */
  callback_data?: string;
  url?: string;
}
export interface InlineKeyboard { inline_keyboard: InlineButton[][] }

export interface TelegramCallbackQuery {
  id: string;
  from: { id: number; is_bot?: boolean; username?: string };
  message?: { message_id: number; chat: { id: number; type?: string } };
  data?: string;
}
export interface TelegramUpdate {
  update_id: number;
  callback_query?: TelegramCallbackQuery;
}
export interface SentMessage { message_id: number; chat: { id: number } }

export type BotCallResult<T> =
  | { ok: true; result: T }
  | {
      ok: false;
      error: string;
      /** 토큰·채팅 ID 미설정 — 재시도해도 같다 */
      skipped?: boolean;
      status?: number;
      /** 409 — 다른 `getUpdates` 소비자/웹훅이 있다 */
      conflict?: boolean;
      /** 429 — 이만큼(초) 기다린 뒤 재시도 */
      retryAfterSec?: number;
    };

const API = 'https://api.telegram.org';

interface CallOpts {
  /** 요청 전체 제한(ms). `getUpdates` 는 롱폴링 시간보다 길게 */
  timeoutMs?: number;
  /** 일시적 네트워크 오류 재시도 횟수 (기본 1) */
  retries?: number;
}

async function callBot<T>(method: string, payload: Record<string, unknown>, opts: CallOpts = {}): Promise<BotCallResult<T>> {
  const token = await getCredential('TELEGRAM_BOT_TOKEN');
  if (!token) return { ok: false, skipped: true, error: 'telegram_not_configured' };

  const timeoutMs = opts.timeoutMs ?? 15_000;
  const attempts = (opts.retries ?? 1) + 1;
  const url = `${API}/bot${token}/${method}`;

  for (let i = 0; i < attempts; i++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ac.signal,
      });
      if (!res.ok) {
        const snippet = redactSecrets(await readBodySnippet(res, 300), token);
        let retryAfterSec: number | undefined;
        const m = /"retry_after":\s*(\d+)/.exec(snippet);
        if (m) retryAfterSec = Number(m[1]);
        return {
          ok: false,
          status: res.status,
          conflict: res.status === 409,
          retryAfterSec,
          error: `HTTP ${res.status}${snippet ? ` ${snippet}` : ''}`,
        };
      }
      const body = await res.json() as { ok?: boolean; result?: T; description?: string };
      if (body.ok !== true) return { ok: false, error: redactSecrets(`api_not_ok ${body.description ?? ''}`.trim(), token) };
      return { ok: true, result: body.result as T };
    } catch (e) {
      const msg = redactSecrets(e instanceof Error ? e.message : String(e), token);
      if (i < attempts - 1 && isTransientNetworkError(msg)) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      const code = redactSecrets(causeCodeOf(e), token);
      return { ok: false, error: code ? `${msg} (${code})` : msg };
    } finally {
      clearTimeout(timer);
    }
  }
  /* istanbul ignore next — 루프는 모든 경로에서 return 한다 */
  return { ok: false, error: 'retry_exhausted' };
}

/** 키보드가 달린 메시지를 소유자 채팅(`TELEGRAM_CHAT_ID`)으로 보낸다. 메시지 ID 를 돌려준다. */
export async function sendTelegramMessage(text: string, replyMarkup?: InlineKeyboard): Promise<BotCallResult<SentMessage>> {
  const chatId = await getCredential('TELEGRAM_CHAT_ID');
  if (!chatId) return { ok: false, skipped: true, error: 'telegram_not_configured' };
  return callBot<SentMessage>('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

/** 콜백 쿼리에 응답한다(로딩 표시 제거). 15초 넘기면 만료되므로 처리 전에 먼저 부른다. */
export async function answerCallbackQuery(id: string, text?: string, showAlert = false): Promise<BotCallResult<true>> {
  return callBot<true>('answerCallbackQuery', {
    callback_query_id: id,
    ...(text ? { text: text.slice(0, 200) } : {}),
    ...(showAlert ? { show_alert: true } : {}),
  }, { retries: 0, timeoutMs: 8_000 });
}

/** 메시지 본문을 바꾼다. 키보드를 주지 않으면 **버튼을 제거**한다(처리가 끝난 메시지에 버튼이 남지 않게). */
export async function editTelegramMessage(
  chatId: number | string,
  messageId: number,
  text: string,
  replyMarkup: InlineKeyboard = { inline_keyboard: [] },
): Promise<BotCallResult<unknown>> {
  return callBot('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: replyMarkup,
  });
}

/**
 * 본문은 그대로 두고 **버튼만 제거**한다. 이미 처리된 시그널의 버튼을 다시 눌렀을 때 쓴다 —
 * 본문을 덮어쓰면 첫 처리의 결과(주문 번호 등)가 사라진다.
 */
export async function clearTelegramKeyboard(chatId: number | string, messageId: number): Promise<BotCallResult<unknown>> {
  return callBot('editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  });
}

/**
 * 롱폴링. `callback_query` 만 요청한다 — 일반 메시지에는 반응하지 않고, 공유 봇의 다른 프로젝트 대화를 읽지 않는다.
 * 재시도는 호출처(폴러)가 백오프로 한다.
 */
export async function getTelegramUpdates(offset: number, timeoutSec = 25): Promise<BotCallResult<TelegramUpdate[]>> {
  return callBot<TelegramUpdate[]>('getUpdates', {
    offset,
    timeout: timeoutSec,
    allowed_updates: ['callback_query'],
  }, { retries: 0, timeoutMs: (timeoutSec + 10) * 1000 });
}
