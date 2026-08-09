/**
 * POST /api/auth/signup-request — 라우트 계약 (T-010, 2026-08-09).
 *
 * ⚠️ **nodemailer 는 `@/lib/mail/send` 모킹으로 완전히 차단된다. 실제 SMTP 연결 시도가 없다.**
 *
 * 이 테스트가 지키는 것:
 *  1. 🔒 **수신자는 언제나 env 주소** — 요청 본문이 무엇이든 바뀌지 않는다 (핵심 불변식)
 *  2. 🔒 응답 본문에 초대코드가 절대 실리지 않는다
 *  3. rate limit — IP 축·이메일 축 둘 다, 검증 실패한 요청도 소비시킨다
 *  4. T-007 — SMTP 성공일 때만 `delivery:'sent'`. 실패 시 폴백 → 둘 다 실패면 정직한 502
 *  5. 자격증명 미설정이면 503 (크래시 없음)
 */
import type { NextRequest } from 'next/server';
import type { NotifyResult } from '@/lib/notify/result';
import type { AlertDispatch } from '@/lib/notify';

const ADMIN = 'owner@gmail.com';
const INVITE = 'dBDb1qQORc03';

/** `sendAdminMail` 이 실제로 보낸 메일 — 수신자는 여기서 env 로 결정된다(모킹 재현) */
interface Captured { to: string; subject: string; text: string; html?: string }
const captured: Captured[] = [];

let mailResult: NotifyResult = { ok: true };
let mailEnabled = true;

jest.mock('@/lib/mail/config', () => ({
  isMailEnabled: () => mailEnabled,
  getAdminNotifyEmail: () => (mailEnabled ? ADMIN : null),
  getSmtpConfig: () => (mailEnabled ? { host: 'h', port: 587, secure: false, user: ADMIN, pass: 'p' } : null),
  MAIL_FROM_NAME: '주식자동매매',
}));

// 🔒 수신자를 env 에서 읽는 실제 구조를 그대로 흉내낸다 —
//    content 인자에는 수신자 필드가 없고, to 는 여기서만 정해진다.
jest.mock('@/lib/mail/send', () => ({
  sendAdminMail: async (content: { subject: string; text: string; html?: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getAdminNotifyEmail } = require('@/lib/mail/config') as { getAdminNotifyEmail: () => string | null };
    const to = getAdminNotifyEmail();
    if (to === null) return { ok: false, skipped: true };
    captured.push({ to, ...content });
    return mailResult;
  },
}));

let dispatchResult: AlertDispatch = {
  channel: 'both', delivered: [], failed: [], unconfigured: [],
};
const dispatchMock = jest.fn(async () => dispatchResult);
const sendAlertMock = jest.fn();

jest.mock('@/lib/notify', () => ({
  dispatchAlert: (...a: unknown[]) => dispatchMock(...(a as [])),
  sendAlert: (...a: unknown[]) => sendAlertMock(...(a as [])),
}));

import { GET, POST } from '@/app/api/auth/signup-request/route';
import { resetSignupRequestGates, SIGNUP_REQUEST_EMAIL_FREE, SIGNUP_REQUEST_IP_FREE } from '@/lib/auth/signup-request-gate';

interface Body {
  ok: boolean;
  error?: string;
  detail?: string;
  delivery?: string;
  channels?: string[];
  enabled?: boolean;
  retryAfterSec?: number;
}

function makeReq(
  body: unknown,
  headers: Record<string, string> = { 'x-real-ip': '1.2.3.4' },
): NextRequest {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const h = new Headers({ 'content-type': 'application/json', ...headers });
  if (!h.has('content-length')) h.set('content-length', String(Buffer.byteLength(raw)));
  return {
    headers: h,
    json: async () => JSON.parse(raw),
  } as unknown as NextRequest;
}

const VALID = { email: 'hong@example.com', name: '홍길동', message: '써보고 싶어요' };

async function post(body: unknown, headers?: Record<string, string>): Promise<{ status: number; body: Body }> {
  const res = await POST(makeReq(body, headers));
  return { status: res.status, body: await res.json() as Body };
}

let errSpy: jest.SpyInstance;
let logSpy: jest.SpyInstance;
const savedInvite = process.env.SIGNUP_INVITE_CODE;

beforeEach(() => {
  captured.length = 0;
  mailResult = { ok: true };
  mailEnabled = true;
  dispatchResult = { channel: 'both', delivered: [], failed: [], unconfigured: [] };
  process.env.SIGNUP_INVITE_CODE = INVITE;
  resetSignupRequestGates();
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  if (savedInvite === undefined) delete process.env.SIGNUP_INVITE_CODE;
  else process.env.SIGNUP_INVITE_CODE = savedInvite;
  errSpy.mockRestore();
  logSpy.mockRestore();
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('🔒 수신자는 요청 본문에서 파생될 수 없다 (핵심 불변식)', () => {
  test('정상 요청 — 수신자는 ADMIN_NOTIFY_EMAIL', async () => {
    const r = await post(VALID);
    expect(r.status).toBe(200);
    expect(captured).toHaveLength(1);
    expect(captured[0].to).toBe(ADMIN);
  });

  test.each([
    ['요청자 주소를 그대로', { ...VALID, email: 'attacker@evil.com' }],
    ['to 필드를 끼워넣어도', { ...VALID, to: 'attacker@evil.com' }],
    ['bcc 필드를 끼워넣어도', { ...VALID, bcc: 'attacker@evil.com' }],
    ['adminEmail 을 끼워넣어도', { ...VALID, adminEmail: 'attacker@evil.com' }],
    ['recipient 를 끼워넣어도', { ...VALID, recipient: 'attacker@evil.com' }],
    ['이름에 CRLF 헤더를 넣어도', { ...VALID, name: '홍길동\r\nBcc: attacker@evil.com' }],
    ['말씀에 CRLF 헤더를 넣어도', { ...VALID, message: 'hi\r\nBcc: attacker@evil.com' }],
  ])('%s 수신자는 그대로다', async (_label, body) => {
    resetSignupRequestGates();
    await post(body);
    expect(captured).toHaveLength(1);
    expect(captured[0].to).toBe(ADMIN);
  });

  test('공격자 주소가 수신자로 쓰인 적이 한 번도 없다', async () => {
    for (const email of ['a@evil.com', 'b@evil.com', 'c@evil.com']) {
      resetSignupRequestGates();
      await post({ ...VALID, email });
    }
    expect(captured).toHaveLength(3);
    expect(captured.every((c) => c.to === ADMIN)).toBe(true);
  });

  test('제목에 CRLF 가 살아남지 않는다 (헤더 인젝션)', async () => {
    await post({ ...VALID, name: '홍길동\r\nBcc: attacker@evil.com' });
    expect(captured[0].subject).not.toMatch(/[\r\n]/);
  });
});

describe('🔒 초대코드는 응답에 실리지 않는다', () => {
  test('성공 응답 본문 어디에도 코드가 없다', async () => {
    const r = await post(VALID);
    expect(JSON.stringify(r.body)).not.toContain(INVITE);
  });

  test('메일에는 코드가 들어간다 (관리자가 .env 를 열지 않아도 되게)', async () => {
    await post(VALID);
    expect(captured[0].text).toContain(INVITE);
  });

  test('폴백(텔레그램/슬랙) 본문에는 코드가 들어가지 않는다', async () => {
    mailResult = { ok: false, error: 'ETIMEDOUT' };
    dispatchResult = { channel: 'telegram', delivered: ['telegram'], failed: [], unconfigured: [] };
    await post(VALID);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const [, , fallbackBody] = dispatchMock.mock.calls[0] as unknown as [string, string, string];
    expect(fallbackBody).not.toContain(INVITE);
    expect(fallbackBody).toContain('hong@example.com');
  });

  test('실패 응답에도 코드가 없다', async () => {
    mailResult = { ok: false, error: 'boom' };
    const r = await post(VALID);
    expect(JSON.stringify(r.body)).not.toContain(INVITE);
  });
});

/**
 * reviewer MEDIUM (2026-08-09) — 폴백·critical 알림 본문은 텔레그램(parse_mode:'HTML')과
 * 슬랙(mrkdwn) 양쪽에 그대로 삽입된다. 요청자가 심은 링크가 관리자 알림에 렌더되면
 * 증권계좌 자격증명을 쥔 사람을 겨냥한 피싱이 된다.
 */
describe('🔒 알림 본문 — 요청자가 심은 링크가 관리자 채널에 렌더되지 않는다', () => {
  const TG_LINK = '<a href="https://phish.example">지금 확인</a>';
  const SLACK_LINK = '<https://phish.example|지금 확인>';

  function fallbackBody(): string {
    return (dispatchMock.mock.calls[0] as unknown as [string, string, string])[2];
  }

  beforeEach(() => {
    mailResult = { ok: false, error: 'connect ETIMEDOUT' };
    dispatchResult = { channel: 'telegram', delivered: ['telegram'], failed: [], unconfigured: [] };
  });

  test('이름에 심은 텔레그램 HTML 링크가 무력화된다', async () => {
    await post({ ...VALID, name: TG_LINK });
    expect(fallbackBody()).not.toContain('<a href');
    expect(fallbackBody()).toContain('&lt;a href');
  });

  test('하실 말씀에 심은 슬랙 mrkdwn 링크가 무력화된다', async () => {
    await post({ ...VALID, message: SLACK_LINK });
    expect(fallbackBody()).not.toContain('<https://');
    expect(fallbackBody()).toContain('&lt;https://');
  });

  test('폴백 본문 전체에 raw < 또는 > 가 없다', async () => {
    await post({ ...VALID, name: TG_LINK, email: '<x>@evil.com', message: SLACK_LINK });
    expect(fallbackBody()).not.toMatch(/[<>]/);
  });

  /**
   * 슬랙 mrkdwn 링크는 **공백 없이** 만들 수 있어 `isValidEmail` 을 그대로 통과한다
   * (`ab@<https://evil.com|ClickHere>` → true, 2026-08-09 검증). 텔레그램 `<a href>` 만
   * 보고 "공백이 막히니 안전"이라고 결론내면 슬랙 쪽이 열린 채로 남는다.
   * 주입 지점에서 `<` 를 무조건 이스케이프하는 방식이라 이 페이로드도 함께 막힌다.
   */
  test('공백 없는 슬랙 링크 페이로드가 이메일로 들어와도 폴백에 살아남지 않는다', async () => {
    await post({ ...VALID, email: 'ab@<https://evil.com|ClickHere>' });
    const body = fallbackBody();
    expect(body).not.toContain('<https://');
    expect(body).not.toMatch(/[<>]/);
    // `normalizeEmail` 이 소문자화하므로 라우트 경로에서는 ClickHere → clickhere 다.
    expect(body).toContain('&lt;https://evil.com|clickhere&gt;');
  });

  test('critical 알림 본문에도 raw < 가 없다 (maskEmail 결과도 요청자 파생값)', async () => {
    // 메일·폴백 둘 다 실패 → critical 경로. maskEmail('<a>xxxx@evil.com') = '<a*****@evil.com'
    dispatchResult = { channel: 'both', delivered: [], failed: [{ channel: 'telegram', error: 'x' }], unconfigured: [] };
    await post({ ...VALID, email: '<a>xxxx@evil.com' });
    expect(sendAlertMock).toHaveBeenCalledTimes(1);
    const body = sendAlertMock.mock.calls[0][2] as string;
    expect(body).not.toMatch(/[<>]/);
    expect(body).toContain('&lt;a');
  });

  test('정상 입력이면 알림 본문이 그대로 읽힌다 (과잉 이스케이프 없음)', async () => {
    await post(VALID);
    const body = fallbackBody();
    expect(body).toContain('홍길동');
    expect(body).toContain('hong@example.com');
    expect(body).not.toContain('&amp;');
  });
});

describe('T-007 — 실패를 성공처럼 보이지 않게', () => {
  test('SMTP 성공 → delivery:"sent"', async () => {
    const r = await post(VALID);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, delivery: 'sent' });
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  test('SMTP 실패 → 텔레그램 폴백 시도 → delivery:"fallback" (sent 라고 하지 않는다)', async () => {
    mailResult = { ok: false, error: 'connect ETIMEDOUT' };
    dispatchResult = { channel: 'both', delivered: ['telegram'], failed: [{ channel: 'slack', error: 'x' }], unconfigured: [] };
    const r = await post(VALID);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, delivery: 'fallback', channels: ['telegram'] });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });

  test('메일·폴백 둘 다 실패 → 502 + delivery:"failed"', async () => {
    mailResult = { ok: false, error: 'connect ETIMEDOUT' };
    dispatchResult = {
      channel: 'both', delivered: [],
      failed: [{ channel: 'telegram', error: 'ETIMEDOUT' }], unconfigured: ['slack'],
    };
    const r = await post(VALID);
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ ok: false, error: 'delivery_failed', delivery: 'failed' });
    expect(r.body.detail).toContain('메일 서버에 연결하지 못했습니다');
  });

  test('둘 다 실패하면 에러 로그 + critical 알림을 남긴다', async () => {
    mailResult = { ok: false, error: 'connect ETIMEDOUT' };
    dispatchResult = { channel: 'both', delivered: [], failed: [{ channel: 'telegram', error: 'x' }], unconfigured: [] };
    await post(VALID);

    const logged = errSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
    expect(logged).toContain('가입 요청 전달 실패');
    expect(sendAlertMock).toHaveBeenCalledTimes(1);
    expect(sendAlertMock.mock.calls[0][0]).toBe('critical');
  });

  test('로그·알림에 요청자 이메일이 마스킹돼 남는다', async () => {
    mailResult = { ok: false, error: 'boom' };
    await post(VALID);
    const logged = errSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
    expect(logged).toContain('ho');
    expect(logged).not.toContain('hong@example.com');
  });

  test('폴백 채널이 하나도 설정되지 않은 경우(unconfigured)도 성공이라 하지 않는다', async () => {
    mailResult = { ok: false, error: 'boom' };
    dispatchResult = { channel: 'both', delivered: [], failed: [], unconfigured: ['telegram', 'slack'] };
    const r = await post(VALID);
    expect(r.status).toBe(502);
  });
});

describe('자격증명 미설정 — 꺼진 채로 배포된다', () => {
  test('GET 은 enabled:false 를 알려준다 (화면이 링크를 감춘다)', async () => {
    mailEnabled = false;
    const body = await (await GET()).json() as Body;
    expect(body).toEqual({ ok: true, enabled: false });
  });

  test('GET 은 설정되면 enabled:true', async () => {
    const body = await (await GET()).json() as Body;
    expect(body).toEqual({ ok: true, enabled: true });
  });

  test('POST 는 크래시하지 않고 503 + 안내 문구', async () => {
    mailEnabled = false;
    const r = await post(VALID);
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ ok: false, error: 'not_configured' });
    expect(r.body.detail).toContain('관리자에게 다른 방법으로');
  });

  test('미설정이면 메일도 폴백도 시도하지 않는다', async () => {
    mailEnabled = false;
    await post(VALID);
    expect(captured).toHaveLength(0);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  test('미설정 요청은 rate limit 을 소비하지 않는다 (아무 일도 하지 않았으므로)', async () => {
    mailEnabled = false;
    for (let i = 0; i < SIGNUP_REQUEST_IP_FREE + 5; i++) await post(VALID);
    mailEnabled = true;
    expect((await post(VALID)).status).toBe(200);
  });
});

describe('입력 검증', () => {
  test.each([
    ['이메일 누락', { name: '홍길동' }],
    ['이름 누락', { email: 'a@b.com' }],
    ['이메일 형식 오류', { email: 'nodomain', name: '홍' }],
    ['이름 초과', { email: 'a@b.com', name: '가'.repeat(61) }],
    ['말씀 초과', { email: 'a@b.com', name: '홍', message: 'x'.repeat(1001) }],
  ])('%s → 400', async (_l, body) => {
    resetSignupRequestGates();
    const r = await post(body);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_input');
    expect(captured).toHaveLength(0);
  });

  test('하실 말씀은 선택 항목 — 없어도 200', async () => {
    const r = await post({ email: 'a@b.com', name: '홍' });
    expect(r.status).toBe(200);
    expect(captured[0].text).toContain('(없음)');
  });

  test('본문이 JSON 이 아니어도 500 이 아니라 400', async () => {
    const res = await POST({
      headers: new Headers({ 'x-real-ip': '1.2.3.4' }),
      json: async () => { throw new SyntaxError('bad json'); },
    } as unknown as NextRequest);
    expect(res.status).toBe(400);
  });
});

describe('본문 크기 상한 — 파싱 전에 막는다', () => {
  test('content-length 초과 → 413, json() 을 호출조차 하지 않는다', async () => {
    const jsonSpy = jest.fn();
    const res = await POST({
      headers: new Headers({ 'x-real-ip': '1.2.3.4', 'content-length': String(9 * 1024) }),
      json: jsonSpy,
    } as unknown as NextRequest);
    expect(res.status).toBe(413);
    expect(jsonSpy).not.toHaveBeenCalled();
  });

  test('상한 이내는 통과', async () => {
    const r = await post({ ...VALID, message: 'x'.repeat(900) });
    expect(r.status).toBe(200);
  });
});

/**
 * 게이트 의미론(login-gate 와 동일): `freeAttempts` 를 **넘어서는** 시도에서 잠금이 걸린다.
 * 그 시도 자체는 이미 통과한 뒤라, 실제로 처리되는 요청 수는 `freeAttempts + 1` 이고
 * 그 다음 요청부터 429 다. 아래 루프의 `<=` 는 그 경계를 그대로 반영한 것이다.
 */
describe('rate limit — IP 축', () => {
  const IP = { 'x-real-ip': '203.0.113.7' };

  test(`같은 IP 로 ${SIGNUP_REQUEST_IP_FREE + 1}회까지 통과, 그 다음 429`, async () => {
    for (let i = 0; i <= SIGNUP_REQUEST_IP_FREE; i++) {
      // 이메일 축에 걸리지 않도록 매번 다른 주소를 쓴다 (IP 축만 검증)
      const r = await post({ ...VALID, email: `u${i}@example.com` }, IP);
      expect(r.status).toBe(200);
    }
    const over = await post({ ...VALID, email: 'next@example.com' }, IP);
    expect(over.status).toBe(429);
    expect(over.body.error).toBe('too_many_requests');
    expect(over.body.detail).toContain('10분 뒤');
  });

  test('429 는 retry-after 헤더를 준다', async () => {
    for (let i = 0; i <= SIGNUP_REQUEST_IP_FREE; i++) {
      await POST(makeReq({ ...VALID, email: `u${i}@example.com` }, IP));
    }
    const res = await POST(makeReq({ ...VALID, email: 'z@example.com' }, IP));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  test('다른 IP 는 영향받지 않는다 (상호 DoS 방지)', async () => {
    for (let i = 0; i <= SIGNUP_REQUEST_IP_FREE; i++) {
      await post({ ...VALID, email: `u${i}@example.com` }, IP);
    }
    const other = await post({ ...VALID, email: 'other@example.com' }, { 'x-real-ip': '203.0.113.8' });
    expect(other.status).toBe(200);
  });

  test('검증 실패한 요청도 IP 쿼터를 소비한다 (잘못된 본문 무한 재시도 차단)', async () => {
    for (let i = 0; i <= SIGNUP_REQUEST_IP_FREE; i++) {
      expect((await post({ email: 'bad' }, IP)).status).toBe(400);
    }
    expect((await post({ ...VALID, email: 'fresh@example.com' }, IP)).status).toBe(429);
  });

  test('XFF 앞부분을 조작해도 같은 버킷에 들어간다', async () => {
    const h = (xff: string) => ({ 'x-forwarded-for': xff });
    for (let i = 0; i <= SIGNUP_REQUEST_IP_FREE; i++) {
      await post({ ...VALID, email: `u${i}@example.com` }, h(`spoof-${i}, 203.0.113.9`));
    }
    const over = await post({ ...VALID, email: 'z@example.com' }, h('another-spoof, 203.0.113.9'));
    expect(over.status).toBe(429);
  });

  test('IP 헤더가 없는 요청은 공용 버킷에서 함께 제한된다', async () => {
    for (let i = 0; i <= SIGNUP_REQUEST_IP_FREE; i++) {
      await post({ ...VALID, email: `u${i}@example.com` }, {});
    }
    expect((await post({ ...VALID, email: 'z@example.com' }, {})).status).toBe(429);
  });
});

describe('rate limit — 이메일 축', () => {
  test(`같은 주소로 ${SIGNUP_REQUEST_EMAIL_FREE + 1}회까지 통과, 그 다음 429 (IP 를 바꿔도)`, async () => {
    for (let i = 0; i <= SIGNUP_REQUEST_EMAIL_FREE; i++) {
      const r = await post(VALID, { 'x-real-ip': `198.51.100.${i}` });
      expect(r.status).toBe(200);
    }
    const over = await post(VALID, { 'x-real-ip': '198.51.100.200' });
    expect(over.status).toBe(429);
  });

  test('대소문자·공백만 바꿔서 우회할 수 없다', async () => {
    for (let i = 0; i <= SIGNUP_REQUEST_EMAIL_FREE; i++) {
      await post(VALID, { 'x-real-ip': `198.51.100.${i}` });
    }
    const over = await post({ ...VALID, email: '  HONG@Example.COM ' }, { 'x-real-ip': '198.51.100.201' });
    expect(over.status).toBe(429);
  });

  test('다른 주소는 영향받지 않는다', async () => {
    for (let i = 0; i <= SIGNUP_REQUEST_EMAIL_FREE; i++) {
      await post(VALID, { 'x-real-ip': `198.51.100.${i}` });
    }
    const other = await post({ ...VALID, email: 'other@example.com' }, { 'x-real-ip': '198.51.100.202' });
    expect(other.status).toBe(200);
  });

  test('이메일 축에 막히면 메일을 보내지 않는다', async () => {
    for (let i = 0; i <= SIGNUP_REQUEST_EMAIL_FREE; i++) {
      await post(VALID, { 'x-real-ip': `198.51.100.${i}` });
    }
    const before = captured.length;
    await post(VALID, { 'x-real-ip': '198.51.100.203' });
    expect(captured).toHaveLength(before);
  });
});

describe('SIGNUP_INVITE_CODE 미설정 상태', () => {
  test('코드 대신 "가입 개방" 경고가 메일에 실린다', async () => {
    delete process.env.SIGNUP_INVITE_CODE;
    const r = await post(VALID);
    expect(r.status).toBe(200);
    expect(captured[0].text).toContain('SIGNUP_INVITE_CODE 가 설정돼 있지 않습니다');
  });
});
