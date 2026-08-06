/**
 * sendAlert / dispatchAlert — 안전 알림(kill-switch·DRY_RUN·drawdown)의 실패 관측.
 *
 * 기존: `sendSlackAlert(...).catch(() => {})` 로 실패를 통째로 버렸다.
 * 변경: fire-and-forget 은 유지(안전 경로가 알림 I/O 를 기다리면 안 됨)하되
 *       실패를 level·title 과 함께 로그로 남기고, 아무 채널에도 전달되지 못한
 *       critical 은 grep 가능한 CRITICAL_ALERT_UNDELIVERED 토큰으로 남긴다.
 */
import type { NotifyResult } from '@/lib/notify/result';

let channelValue = 'both';
const slackMock    = jest.fn<Promise<NotifyResult>, unknown[]>();
const telegramMock = jest.fn<Promise<NotifyResult>, unknown[]>();

jest.mock('@/lib/db', () => ({
  getPool: () => ({
    query: async () => [[{ value: JSON.stringify(channelValue) }]],
  }),
}));
jest.mock('@/lib/notify/slack', () => ({
  sendSlackAlert: (...a: unknown[]) => slackMock(...a),
}));
jest.mock('@/lib/notify/telegram', () => ({
  sendTelegramAlert: (...a: unknown[]) => telegramMock(...a),
}));

import { dispatchAlert, sendAlert } from '@/lib/notify';

const OK: NotifyResult      = { ok: true };
const SKIPPED: NotifyResult = { ok: false, skipped: true };
const FAIL = (e: string): NotifyResult => ({ ok: false, error: e });

let errSpy: jest.SpyInstance;
const logged = (): string => errSpy.mock.calls.map(c => c.map(String).join(' ')).join('\n');

beforeEach(() => {
  jest.resetModules();
  channelValue = 'both';
  slackMock.mockResolvedValue(OK);
  telegramMock.mockResolvedValue(OK);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errSpy.mockRestore();
  jest.clearAllMocks();
});

describe('dispatchAlert — 채널별 결과 집계', () => {
  test('둘 다 성공하면 delivered 2건, 로그 없음', async () => {
    const d = await dispatchAlert('info', '제목', '본문');
    expect(d.delivered.sort()).toEqual(['slack', 'telegram']);
    expect(d.failed).toEqual([]);
    expect(logged()).toBe('');
  });

  test('부분 실패는 실패 채널만 level·title 과 함께 로그', async () => {
    telegramMock.mockResolvedValue(FAIL('HTTP 400 message is too long'));
    const d = await dispatchAlert('warning', '보유기간 초과', '본문');
    expect(d.delivered).toEqual(['slack']);
    expect(d.failed).toEqual([{ channel: 'telegram', error: 'HTTP 400 message is too long' }]);
    expect(logged()).toContain('telegram 전송 실패');
    expect(logged()).toContain('level=warning');
    expect(logged()).toContain('보유기간 초과');
    expect(logged()).not.toContain('CRITICAL_ALERT_UNDELIVERED');
  });

  test('미설정 채널은 실패가 아니라 unconfigured — 에러 로그를 만들지 않는다', async () => {
    slackMock.mockResolvedValue(SKIPPED);
    const d = await dispatchAlert('info', '제목', '본문');
    expect(d.unconfigured).toEqual(['slack']);
    expect(d.failed).toEqual([]);
    expect(logged()).toBe('');
  });

  test('전송 함수가 예외를 던져도 dispatch 는 죽지 않고 failed 로 잡는다', async () => {
    telegramMock.mockRejectedValue(new Error('boom'));
    const d = await dispatchAlert('info', '제목', '본문');
    expect(d.delivered).toEqual(['slack']);
    expect(d.failed[0]).toEqual({ channel: 'telegram', error: 'boom' });
  });

  /**
   * 전송 함수는 던지지 않는 계약이라 이 catch 는 현재 도달 불가능하다.
   * 하지만 "오늘 도달 불가"는 계약이 아니라 현재 구현의 성질일 뿐이고,
   * 기존 테스트가 전부 'boom'(비밀값 없음)이라 회귀가 조용히 통과하는 구멍이었다.
   */
  test('예외 메시지에 봇 토큰이 들어 있어도 failed.error·로그에 새지 않는다', async () => {
    const TOKEN = '123456789:AAH-fake-token-for-test-only-xyz';
    const WEBHOOK = 'https://hooks.slack.com/services/T000/B000/fakeSecretPath';
    telegramMock.mockRejectedValue(
      new Error(`connect ETIMEDOUT https://api.telegram.org/bot${TOKEN}/sendMessage`),
    );
    slackMock.mockRejectedValue(new Error(`ECONNREFUSED posting to ${WEBHOOK}`));

    const d = await dispatchAlert('critical', '치명', '본문');

    const serialized = JSON.stringify(d.failed);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain('AAH-fake-token');
    expect(serialized).not.toContain('fakeSecretPath');
    expect(serialized).toContain('bot***');
    expect(serialized).toContain('hooks.slack.com/services/***');

    expect(logged()).not.toContain('AAH-fake-token');
    expect(logged()).not.toContain('fakeSecretPath');
  });
});

describe('critical 알림 유실 — 무조건 눈에 띄어야 한다', () => {
  test('critical 이 전 채널 실패하면 CRITICAL_ALERT_UNDELIVERED 를 남긴다', async () => {
    slackMock.mockResolvedValue(FAIL('ECONNREFUSED'));
    telegramMock.mockResolvedValue(FAIL('fetch failed (ETIMEDOUT)'));
    const d = await dispatchAlert('critical', 'KILL SWITCH 발동', '본문');
    expect(d.delivered).toEqual([]);
    const out = logged();
    expect(out).toContain('CRITICAL_ALERT_UNDELIVERED');
    expect(out).toContain('KILL SWITCH 발동');
    expect(out).toContain('failed=[slack,telegram]');
  });

  test('critical 이 전 채널 미설정이어도 유실로 본다', async () => {
    slackMock.mockResolvedValue(SKIPPED);
    telegramMock.mockResolvedValue(SKIPPED);
    await dispatchAlert('critical', 'DRY_RUN 해제', '본문');
    expect(logged()).toContain('CRITICAL_ALERT_UNDELIVERED');
    expect(logged()).toContain('unconfigured=[slack,telegram]');
  });

  test('critical 이 한 채널이라도 전달되면 유실 경보는 없다', async () => {
    telegramMock.mockResolvedValue(FAIL('ETIMEDOUT'));
    await dispatchAlert('critical', '부분 전달', '본문');
    expect(logged()).toContain('telegram 전송 실패');
    expect(logged()).not.toContain('CRITICAL_ALERT_UNDELIVERED');
  });

  test('notify_channel=none 이면 critical 은 아무 채널도 시도되지 않고 유실로 기록된다', async () => {
    // 채널 값은 30초 캐시된다 → 캐시가 빈 새 모듈 인스턴스로 검증
    channelValue = 'none';
    jest.resetModules();
    const fresh = await import('@/lib/notify');
    const d = await fresh.dispatchAlert('critical', '채널 없음', '본문');
    expect(d.delivered).toEqual([]);
    expect(slackMock).not.toHaveBeenCalled();
    expect(telegramMock).not.toHaveBeenCalled();
    expect(logged()).toContain('CRITICAL_ALERT_UNDELIVERED');
    expect(logged()).toContain('notify_channel=none');
  });
});

describe('sendAlert — fire-and-forget 계약 유지', () => {
  test('void 를 반환하며 호출부를 블록하지 않는다', async () => {
    let resolveSlack!: (v: NotifyResult) => void;
    slackMock.mockReturnValue(new Promise<NotifyResult>(r => { resolveSlack = r; }));
    telegramMock.mockResolvedValue(OK);

    const ret = sendAlert('critical', '즉시 반환', '본문');
    expect(ret).toBeUndefined();          // await 불가 = 안전 경로가 I/O 를 기다리지 않음

    resolveSlack(OK);
    await new Promise(r => setImmediate(r));
    expect(slackMock).toHaveBeenCalledTimes(1);
  });

  test('전송 실패해도 예외가 호출부로 새지 않는다', async () => {
    slackMock.mockRejectedValue(new Error('boom'));
    telegramMock.mockRejectedValue(new Error('boom2'));
    expect(() => sendAlert('critical', '예외', '본문')).not.toThrow();
    await new Promise(r => setImmediate(r));
    expect(logged()).toContain('CRITICAL_ALERT_UNDELIVERED');
  });
});
