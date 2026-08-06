/**
 * 텔레그램/Slack 전송 결과 관측 가능성 (2026-08-06).
 *
 * 두 함수는 `Promise<void>` 였다 → 호출부가 성공/실패를 구분할 수 없어
 * 2026-08-04 08:03 정기 리포트가 ETIMEDOUT 으로 유실됐는데도 `sent:true` 가 응답됐다.
 * 이제 `NotifyResult` 를 **던지지 않고 반환**한다.
 */
const creds: Record<string, string> = {};
jest.mock('@/lib/credentials', () => ({
  getCredential: async (k: string) => creds[k] ?? '',
}));

import { sendTelegramAlert } from '@/lib/notify/telegram';
import { sendSlackAlert } from '@/lib/notify/slack';

const TOKEN = '123456789:AAH-fake-token-for-test-only-xyz';
const WEBHOOK = 'https://hooks.slack.com/services/T000/B000/fakeSecretPath';

function setCreds(v: Record<string, string>): void {
  for (const k of Object.keys(creds)) delete creds[k];
  Object.assign(creds, v);
}

function mockFetch(impl: jest.Mock): void {
  (global as unknown as { fetch: unknown }).fetch = impl;
}

let errSpy: jest.SpyInstance;

beforeEach(() => {
  setCreds({
    TELEGRAM_BOT_TOKEN: TOKEN,
    TELEGRAM_CHAT_ID: '999',
    SLACK_WEBHOOK_URL: WEBHOOK,
    NOTIFY_PROJECT_TAG: 'TestProj',
  });
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errSpy.mockRestore();
  jest.clearAllMocks();
});

describe('sendTelegramAlert — 결과 반환', () => {
  test('성공 시 { ok: true }', async () => {
    mockFetch(jest.fn().mockResolvedValue({ ok: true, status: 200 }));
    await expect(sendTelegramAlert('info', 't', 'b')).resolves.toEqual({ ok: true });
  });

  test('HTTP 400 은 ok:false + 텔레그램 description 을 error 에 담는다 (재시도 없음)', async () => {
    const f = jest.fn().mockResolvedValue({
      ok: false, status: 400,
      text: async () => '{"ok":false,"description":"Bad Request: message is too long"}',
    });
    mockFetch(f);
    const r = await sendTelegramAlert('info', 't', 'b');
    expect(r.ok).toBe(false);
    expect(r.skipped).toBeUndefined();
    expect(r.error).toContain('HTTP 400');
    expect(r.error).toContain('message is too long');
    expect(f).toHaveBeenCalledTimes(1);   // HTTP 거절은 재시도 대상 아님
  });

  test('네트워크 오류(ETIMEDOUT)는 1회 재시도 후 ok:false — 실제 유실 사고 재현', async () => {
    const e = new TypeError('fetch failed');
    (e as unknown as { cause: unknown }).cause = { code: 'ETIMEDOUT' };
    const f = jest.fn().mockRejectedValue(e);
    mockFetch(f);
    const r = await sendTelegramAlert('info', 't', 'b');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('fetch failed');
    expect(r.error).toContain('ETIMEDOUT');
    expect(f).toHaveBeenCalledTimes(2);
  });

  test('1회 재시도로 회복되면 ok:true', async () => {
    const e = new TypeError('fetch failed');
    const f = jest.fn()
      .mockRejectedValueOnce(e)
      .mockResolvedValueOnce({ ok: true, status: 200 });
    mockFetch(f);
    await expect(sendTelegramAlert('info', 't', 'b')).resolves.toEqual({ ok: true });
    expect(f).toHaveBeenCalledTimes(2);
  });

  test('토큰 미설정은 실패가 아니라 skipped — 재시도해도 결과가 같다', async () => {
    setCreds({ TELEGRAM_CHAT_ID: '999' });
    const f = jest.fn();
    mockFetch(f);
    const r = await sendTelegramAlert('info', 't', 'b');
    expect(r).toEqual({ ok: false, skipped: true });
    expect(f).not.toHaveBeenCalled();
  });

  test('error 문자열에 봇 토큰이 절대 새지 않는다', async () => {
    const f = jest.fn().mockRejectedValue(
      new Error(`connect ETIMEDOUT https://api.telegram.org/bot${TOKEN}/sendMessage`),
    );
    mockFetch(f);
    const r = await sendTelegramAlert('info', 't', 'b');
    expect(r.ok).toBe(false);
    expect(r.error).not.toContain(TOKEN);
    expect(r.error).not.toContain('AAH-fake-token');
  });
});

describe('sendSlackAlert — 결과 반환', () => {
  test('성공 시 { ok: true }', async () => {
    mockFetch(jest.fn().mockResolvedValue({ ok: true, status: 200 }));
    await expect(sendSlackAlert('info', 't', 'b')).resolves.toEqual({ ok: true });
  });

  test('HTTP 400 은 ok:false', async () => {
    mockFetch(jest.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'invalid_payload' }));
    const r = await sendSlackAlert('info', 't', 'b');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('HTTP 400');
    expect(r.error).toContain('invalid_payload');
  });

  test('웹훅 URL 미설정은 skipped', async () => {
    setCreds({});
    const f = jest.fn();
    mockFetch(f);
    await expect(sendSlackAlert('info', 't', 'b')).resolves.toEqual({ ok: false, skipped: true });
    expect(f).not.toHaveBeenCalled();
  });

  test('AggregateError 의 개별 원인(cause.errors)까지 담는다 — telegram 과 진단 대칭', async () => {
    const e = new TypeError('fetch failed');
    (e as unknown as { cause: unknown }).cause = {
      code: 'ECONNREFUSED',
      errors: ['Error: connect ECONNREFUSED 1.2.3.4:443', 'Error: connect ENETUNREACH [::1]:443'],
    };
    mockFetch(jest.fn().mockRejectedValue(e));
    const r = await sendSlackAlert('info', 't', 'b');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('ECONNREFUSED');
    expect(r.error).toContain('ENETUNREACH');   // 듀얼스택 실패의 IPv6 쪽 원인도 보존
  });

  test('error 문자열에 웹훅 URL 이 새지 않는다', async () => {
    mockFetch(jest.fn().mockRejectedValue(new Error(`ECONNREFUSED posting to ${WEBHOOK}`)));
    const r = await sendSlackAlert('info', 't', 'b');
    expect(r.ok).toBe(false);
    expect(r.error).not.toContain('fakeSecretPath');
  });
});
