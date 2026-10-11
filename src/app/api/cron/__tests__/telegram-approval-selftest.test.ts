/**
 * T-042 — 자가 점검 라우트: 인증·fail-closed·시험 메시지 내용.
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/notify/telegram-api', () => ({ sendTelegramMessage: jest.fn() }));
jest.mock('@/lib/auth/session', () => ({ getSessionSecret: jest.fn() }));
jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));

const SECRET = 'cron-secret-for-test';
let POST: typeof import('../telegram-approval-selftest/route').POST;
let sendTelegramMessage: jest.Mock;
let getSessionSecret: jest.Mock;
let getPool: jest.Mock;

beforeAll(() => {
  // cron-auth 는 CRON_SECRET 을 모듈 로드 시점에 읽는다 → 라우트와 목을 **같은 격리 레지스트리**에서 가져온다
  // (resetModules 뒤 동적 import 는 목의 새 인스턴스를 써서 테스트가 설정한 목과 어긋난다)
  process.env.CRON_SECRET = SECRET;
  jest.isolateModules(() => {
    POST = require('../telegram-approval-selftest/route').POST;
    sendTelegramMessage = require('@/lib/notify/telegram-api').sendTelegramMessage;
    getSessionSecret = require('@/lib/auth/session').getSessionSecret;
    getPool = require('@/lib/db').getPool;
  });
});
beforeEach(() => {
  jest.clearAllMocks();
  getSessionSecret.mockReturnValue('a-session-secret-that-is-long-enough-1234567890');
  getPool.mockReturnValue({ query: jest.fn(async () => [[]]) });
  sendTelegramMessage.mockResolvedValue({ ok: true, result: { message_id: 321, chat: { id: 1 } } });
});

const req = (secret?: string) => new NextRequest('http://x/api/cron/telegram-approval-selftest', {
  method: 'POST', headers: secret ? { 'x-cron-secret': secret } : {},
});

describe('자가 점검 라우트', () => {
  test('🔴 크론 비밀이 없거나 틀리면 401 — 메시지를 보내지 않는다', async () => {
    expect((await POST(req())).status).toBe(401);
    expect((await POST(req('wrong'))).status).toBe(401);
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  test('시험 메시지를 보내고 message_id 를 돌려준다. 버튼은 거래 없는 점검 하나뿐이다', async () => {
    const res = await POST(req(SECRET));
    expect(await res.json()).toEqual({ ok: true, messageId: 321 });
    const [text, keyboard] = sendTelegramMessage.mock.calls[0];
    expect(text).toContain('자가 점검');
    expect(text).toContain('거래를 일으키지 않습니다');
    const buttons = (keyboard as { inline_keyboard: Array<Array<{ callback_data?: string }>> }).inline_keyboard.flat();
    expect(buttons).toHaveLength(1);
    expect(buttons[0].callback_data).toMatch(/^si1:t:0:[0-9a-f]{16}$/);
  });

  test('app_public_url 이 설정돼 있으면 점검 메시지에도 같은 링크 버튼을 단다 (켜기 전에 URL 유효성 확인)', async () => {
    getPool.mockReturnValue({ query: jest.fn(async () => [[{ value: JSON.stringify('https://stock.example.com/strategy') }]]) });
    await POST(req(SECRET));
    const keyboard = sendTelegramMessage.mock.calls[0][1] as { inline_keyboard: Array<Array<{ url?: string }>> };
    expect(keyboard.inline_keyboard[1][0].url).toBe('https://stock.example.com/strategy');
  });

  test('app_public_url 을 읽다 실패해도 점검 메시지는 링크 없이 나간다', async () => {
    getPool.mockReturnValue({ query: jest.fn(async () => { throw new Error('db down'); }) });
    const res = await POST(req(SECRET));
    expect((await res.json()).ok).toBe(true);
    expect((sendTelegramMessage.mock.calls[0][1] as { inline_keyboard: unknown[] }).inline_keyboard).toHaveLength(1);
  });

  test('🔴 서명 키를 만들 수 없으면(세션 비밀 미설정) 503 — 버튼을 달 수 없으니 보내지 않는다', async () => {
    getSessionSecret.mockReturnValue(undefined);
    const res = await POST(req(SECRET));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('approval_key_unavailable');
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  test('텔레그램 미설정은 503, 전송 실패는 502', async () => {
    sendTelegramMessage.mockResolvedValueOnce({ ok: false, skipped: true, error: 'telegram_not_configured' });
    expect((await POST(req(SECRET))).status).toBe(503);
    sendTelegramMessage.mockResolvedValueOnce({ ok: false, status: 400, error: 'HTTP 400' });
    expect((await POST(req(SECRET))).status).toBe(502);
  });
});
