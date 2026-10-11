/**
 * T-042 — 텔레그램 Bot API 클라이언트.
 *
 * 지킬 것: (1) 토큰이 어떤 오류 문자열에도 새지 않는다 (2) 던지지 않는다 (3) 409/429 를 구분한다
 * (4) 폴링은 `callback_query` 만 요청한다 (5) 처리가 끝난 메시지에서 버튼을 제거한다.
 */
import {
  answerCallbackQuery,
  clearTelegramKeyboard,
  editTelegramMessage,
  getTelegramUpdates,
  sendTelegramMessage,
} from '../telegram-api';
import { getCredential } from '@/lib/credentials';

jest.mock('@/lib/credentials', () => ({ getCredential: jest.fn() }));

const TOKEN = '123456789:AAHsecretTOKENsecretTOKENsecret_abc';
const mCred = getCredential as jest.Mock;
const realFetch = global.fetch;
let fetchMock: jest.Mock;

function respond(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

beforeEach(() => {
  mCred.mockImplementation(async (k: string) => (k === 'TELEGRAM_BOT_TOKEN' ? TOKEN : k === 'TELEGRAM_CHAT_ID' ? '777' : ''));
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => { global.fetch = realFetch; jest.clearAllMocks(); });

const sentBody = (call = 0) => JSON.parse((fetchMock.mock.calls[call][1] as RequestInit).body as string) as Record<string, unknown>;
const sentUrl = (call = 0) => String(fetchMock.mock.calls[call][0]);

describe('sendTelegramMessage', () => {
  test('HTML 모드 + 키보드 + 소유자 채팅으로 보내고 message_id 를 돌려준다', async () => {
    fetchMock.mockResolvedValue(respond(200, { ok: true, result: { message_id: 42, chat: { id: 777 } } }));
    const kb = { inline_keyboard: [[{ text: '✅ 승인', callback_data: 'si1:a:1:abcdef0123456789' }]] };
    const r = await sendTelegramMessage('<b>x</b>', kb);
    expect(r).toEqual({ ok: true, result: { message_id: 42, chat: { id: 777 } } });
    expect(sentUrl()).toContain('/sendMessage');
    expect(sentBody()).toMatchObject({ chat_id: '777', parse_mode: 'HTML', reply_markup: kb, disable_web_page_preview: true });
  });

  test('키보드가 없으면 reply_markup 키 자체를 보내지 않는다', async () => {
    fetchMock.mockResolvedValue(respond(200, { ok: true, result: { message_id: 1, chat: { id: 777 } } }));
    await sendTelegramMessage('hi');
    expect('reply_markup' in sentBody()).toBe(false);
  });

  test('토큰·채팅 ID 가 없으면 skipped — 네트워크를 타지 않는다', async () => {
    mCred.mockResolvedValue('');
    expect(await sendTelegramMessage('x')).toMatchObject({ ok: false, skipped: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('🔴 HTTP 400 오류 본문에 토큰이 섞여도 결과에는 새지 않는다', async () => {
    fetchMock.mockResolvedValue({
      ok: false, status: 400,
      text: async () => `{"ok":false,"description":"bad ${TOKEN} bot${TOKEN}"}`,
      json: async () => ({}),
    });
    const r = await sendTelegramMessage('x');
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(JSON.stringify(r)).not.toContain('AAHsecret');
  });

  test('🔴 네트워크 예외 메시지에 URL(토큰 포함)이 있어도 가려진다', async () => {
    fetchMock.mockRejectedValue(new Error(`request to https://api.telegram.org/bot${TOKEN}/sendMessage failed, reason: x`));
    const r = await sendTelegramMessage('x');
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('AAHsecret');
  });

  test('일시적 네트워크 오류는 한 번 재시도한다', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('fetch failed (ETIMEDOUT)'))
      .mockResolvedValueOnce(respond(200, { ok: true, result: { message_id: 5, chat: { id: 777 } } }));
    const r = await sendTelegramMessage('x');
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('재시도해도 의미 없는 오류(400)는 재시도하지 않는다', async () => {
    fetchMock.mockResolvedValue(respond(400, { ok: false, description: "can't parse entities" }));
    const r = await sendTelegramMessage('x');
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('getTelegramUpdates', () => {
  test('🔴 callback_query 만 요청한다 (일반 메시지·공유 봇의 다른 대화를 읽지 않는다)', async () => {
    fetchMock.mockResolvedValue(respond(200, { ok: true, result: [] }));
    await getTelegramUpdates(101, 25);
    expect(sentUrl()).toContain('/getUpdates');
    expect(sentBody()).toEqual({ offset: 101, timeout: 25, allowed_updates: ['callback_query'] });
  });

  test('🔴 409 는 conflict 로 구분된다 (다른 소비자/웹훅)', async () => {
    fetchMock.mockResolvedValue(respond(409, { ok: false, error_code: 409, description: 'Conflict: terminated by other getUpdates request' }));
    expect(await getTelegramUpdates(0)).toMatchObject({ ok: false, conflict: true, status: 409 });
  });

  test('429 는 retry_after 를 돌려준다', async () => {
    fetchMock.mockResolvedValue(respond(429, { ok: false, error_code: 429, parameters: { retry_after: 7 } }));
    expect(await getTelegramUpdates(0)).toMatchObject({ ok: false, status: 429, retryAfterSec: 7 });
  });

  test('폴링은 재시도하지 않는다 — 백오프는 폴러의 몫', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed (ECONNRESET)'));
    const r = await getTelegramUpdates(0);
    expect(r.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('🔴 롱폴링 요청의 시간 제한은 롱폴링 시간보다 길다 — 정상 대기 중에 스스로 끊지 않는다', async () => {
    jest.useFakeTimers();
    try {
      let aborted = false;
      fetchMock.mockImplementation((_u: string, init: RequestInit) => new Promise((_res, rej) => {
        init.signal?.addEventListener('abort', () => { aborted = true; rej(new Error('aborted')); });
      }));
      const p = getTelegramUpdates(0, 25);
      await jest.advanceTimersByTimeAsync(30_000);          // 롱폴링 25초 + 여유: 아직 끊기면 안 된다
      expect(aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(6_000);           // 35초 제한 도달
      expect(aborted).toBe(true);
      expect((await p).ok).toBe(false);
    } finally { jest.useRealTimers(); }
  });

  test('업데이트 배열을 그대로 돌려준다', async () => {
    const updates = [{ update_id: 9, callback_query: { id: 'q', from: { id: 1 }, data: 'si1:a:1:x' } }];
    fetchMock.mockResolvedValue(respond(200, { ok: true, result: updates }));
    expect(await getTelegramUpdates(0)).toEqual({ ok: true, result: updates });
  });
});

describe('answerCallbackQuery / editTelegramMessage', () => {
  test('응답 문구는 200자로 자른다', async () => {
    fetchMock.mockResolvedValue(respond(200, { ok: true, result: true }));
    await answerCallbackQuery('qid', 'x'.repeat(500));
    expect((sentBody().text as string).length).toBe(200);
    expect(sentBody().callback_query_id).toBe('qid');
  });

  test('🔴 편집은 기본적으로 버튼을 제거한다 (처리 끝난 메시지에 버튼이 남지 않게)', async () => {
    fetchMock.mockResolvedValue(respond(200, { ok: true, result: {} }));
    await editTelegramMessage(777, 42, '✅ 승인됨');
    expect(sentBody()).toMatchObject({ chat_id: 777, message_id: 42, parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } });
  });

  test('콜백 응답 실패는 던지지 않고 결과로 돌려준다', async () => {
    fetchMock.mockResolvedValue(respond(400, { ok: false, description: 'query is too old' }));
    expect(await answerCallbackQuery('qid')).toMatchObject({ ok: false, status: 400 });
  });
});

describe('clearTelegramKeyboard — 본문은 두고 버튼만 제거', () => {
  test('editMessageReplyMarkup 으로 빈 키보드를 보낸다 (본문 텍스트를 보내지 않는다)', async () => {
    fetchMock.mockResolvedValue(respond(200, { ok: true, result: {} }));
    await clearTelegramKeyboard(777, 42);
    expect(sentUrl()).toContain('/editMessageReplyMarkup');
    expect(sentBody()).toEqual({ chat_id: 777, message_id: 42, reply_markup: { inline_keyboard: [] } });
    expect('text' in sentBody()).toBe(false);                    // 🔴 본문을 건드리지 않는다 — 첫 결과(주문 번호)를 보존
  });

  test('실패해도 던지지 않고 결과로 돌려준다', async () => {
    fetchMock.mockResolvedValue(respond(400, { ok: false, description: 'message to edit not found' }));
    expect(await clearTelegramKeyboard(1, 2)).toMatchObject({ ok: false, status: 400 });
  });
});
