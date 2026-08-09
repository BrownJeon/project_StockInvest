/**
 * `sendAdminMail` — 🔒 수신자 불변식과 실패 정직성 (T-010, 2026-08-09).
 *
 * ⚠️ **nodemailer 는 전부 모킹한다. 이 테스트는 실제 SMTP 연결을 절대 시도하지 않는다.**
 *    `virtual: true` 를 쓰는 이유: nodemailer 는 이 프로젝트 `node_modules` 에 물리적으로
 *    설치돼 있지 않다(배포의 `npm ci` 가 설치한다). 홈 디렉토리의 유령 패키지가 해석되든
 *    말든 테스트 결과가 달라지지 않도록 가상 모듈로 고정한다.
 *
 * 회귀 방어 포인트:
 *  1. 수신자는 **언제나 ADMIN_NOTIFY_EMAIL** — 어떤 인자로도 바꿀 수 없다
 *  2. cc/bcc 가 붙지 않는다 (수신자가 늘어나면 초대코드가 새어나간다)
 *  3. 미설정은 `skipped` — "재시도하면 될 실패"로 오인되면 안 된다
 *  4. SMTP 예외·주소 거절은 `{ok:false}` — 성공으로 보고하지 않는다 (T-007)
 *  5. 오류 문자열에 앱 비밀번호가 남지 않는다
 */
import type { NotifyResult } from '@/lib/notify/result';

interface SentMail {
  from: string; to: string; subject: string; text: string; html?: string;
  cc?: unknown; bcc?: unknown;
}

const sendMailMock = jest.fn<Promise<{ rejected?: string[] }>, [SentMail]>();
const closeMock = jest.fn();
const createTransportMock = jest.fn(() => ({ sendMail: sendMailMock, close: closeMock }));

jest.mock('nodemailer', () => ({
  createTransport: (...a: unknown[]) => createTransportMock(...(a as [])),
}), { virtual: true });

import { sendAdminMail } from '../send';

const ADMIN = 'owner@gmail.com';
const CONTENT = { subject: '[주식자동매매] 가입 요청 — 홍길동', text: '본문', html: '<b>본문</b>' };

const ENV_KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'ADMIN_NOTIFY_EMAIL'] as const;
let savedEnv: Record<string, string | undefined> = {};
let errSpy: jest.SpyInstance;

function configure(over: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}): void {
  process.env.SMTP_HOST = 'smtp.gmail.com';
  process.env.SMTP_PORT = '587';
  process.env.SMTP_USER = ADMIN;
  process.env.SMTP_PASS = 'abcdefghijklmnop';
  process.env.ADMIN_NOTIFY_EMAIL = ADMIN;
  for (const [k, v] of Object.entries(over)) {
    if (v === '') delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  sendMailMock.mockResolvedValue({ rejected: [] });
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  errSpy.mockRestore();
  jest.clearAllMocks();
});

describe('🔒 수신자는 env 에서만 온다', () => {
  test('sendMail 의 to 는 ADMIN_NOTIFY_EMAIL', async () => {
    configure();
    const r: NotifyResult = await sendAdminMail(CONTENT);
    expect(r.ok).toBe(true);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock.mock.calls[0][0].to).toBe(ADMIN);
  });

  test('ADMIN_NOTIFY_EMAIL 을 바꾸면 수신자도 따라 바뀐다 (env 가 유일한 출처)', async () => {
    configure({ ADMIN_NOTIFY_EMAIL: 'other@gmail.com' });
    await sendAdminMail(CONTENT);
    expect(sendMailMock.mock.calls[0][0].to).toBe('other@gmail.com');
  });

  test('본문에 요청자 주소가 가득해도 수신자는 변하지 않는다', async () => {
    configure();
    await sendAdminMail({
      subject: '가입 요청 — attacker@evil.com',
      text: 'To: attacker@evil.com\nBcc: attacker2@evil.com\n요청자 주소: attacker@evil.com',
      html: '<a href="mailto:attacker@evil.com">attacker@evil.com</a>',
    });
    expect(sendMailMock.mock.calls[0][0].to).toBe(ADMIN);
  });

  test('cc·bcc 를 절대 세팅하지 않는다', async () => {
    configure();
    await sendAdminMail(CONTENT);
    const sent = sendMailMock.mock.calls[0][0];
    expect(sent).not.toHaveProperty('cc');
    expect(sent).not.toHaveProperty('bcc');
    // 수신자 필드는 to 하나뿐이어야 한다.
    expect(Object.keys(sent).filter((k) => ['to', 'cc', 'bcc'].includes(k))).toEqual(['to']);
  });

  test('발신자는 상수 표시이름 + env 주소 — 요청 입력이 섞이지 않는다', async () => {
    configure();
    await sendAdminMail(CONTENT);
    expect(sendMailMock.mock.calls[0][0].from).toBe(`주식자동매매 <${ADMIN}>`);
  });
});

describe('미설정 — 기능이 꺼진 상태 (skipped)', () => {
  test.each(['SMTP_USER', 'SMTP_PASS', 'ADMIN_NOTIFY_EMAIL'])(
    '%s 가 비면 시도조차 하지 않는다',
    async (key) => {
      configure({ [key]: '' });
      const r = await sendAdminMail(CONTENT);
      expect(r).toEqual({ ok: false, skipped: true });
      expect(sendMailMock).not.toHaveBeenCalled();
    },
  );

  test('env 를 전혀 설정하지 않아도 예외를 던지지 않는다 (자격증명 없이 배포 가능)', async () => {
    const r = await sendAdminMail(CONTENT);
    expect(r).toEqual({ ok: false, skipped: true });
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  test('ADMIN_NOTIFY_EMAIL 에 CRLF 가 섞이면 기능을 끈다 (fail-closed)', async () => {
    configure({ ADMIN_NOTIFY_EMAIL: 'owner@gmail.com\r\nBcc: evil@x.com' });
    const r = await sendAdminMail(CONTENT);
    expect(r.skipped).toBe(true);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  test('SMTP_USER 형식이 헤더에 안전하지 않으면 끈다', async () => {
    configure({ SMTP_USER: 'a@b.com, evil@x.com' });
    const r = await sendAdminMail(CONTENT);
    expect(r.skipped).toBe(true);
  });

  test('SMTP_PORT 가 숫자가 아니면 끈다', async () => {
    configure({ SMTP_PORT: 'abc' });
    expect((await sendAdminMail(CONTENT)).skipped).toBe(true);
  });
});

describe('실패를 성공으로 보이지 않게 (T-007)', () => {
  test('SMTP 예외 → { ok:false } 이고 skipped 가 아니다 (폴백 대상)', async () => {
    configure();
    sendMailMock.mockRejectedValue(new Error('connect ETIMEDOUT 142.250.0.1:587'));
    const r = await sendAdminMail(CONTENT);
    expect(r.ok).toBe(false);
    expect(r.skipped).toBeUndefined();
    expect(r.error).toContain('ETIMEDOUT');
  });

  test('SMTP 가 주소를 거절하면 성공으로 보고하지 않는다', async () => {
    configure();
    sendMailMock.mockResolvedValue({ rejected: [ADMIN] });
    const r = await sendAdminMail(CONTENT);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('rejected');
  });

  test('rejected 가 빈 배열이면 성공', async () => {
    configure();
    sendMailMock.mockResolvedValue({ rejected: [] });
    expect((await sendAdminMail(CONTENT)).ok).toBe(true);
  });

  test('nodemailer 를 해석하지 못하면 실패로 보고한다 (배포 후 설치 누락 감지)', async () => {
    configure();
    createTransportMock.mockReturnValueOnce(undefined as never);
    const r = await sendAdminMail(CONTENT);
    // createTransport 가 undefined 를 돌려주면 sendMail 호출에서 터진다 → 실패
    expect(r.ok).toBe(false);
  });
});

describe('비밀값 노출 방지', () => {
  test('오류 문자열·로그에 앱 비밀번호가 남지 않는다', async () => {
    configure();
    sendMailMock.mockRejectedValue(new Error('535 auth failed for abcdefghijklmnop'));
    const r = await sendAdminMail(CONTENT);
    expect(r.error).not.toContain('abcdefghijklmnop');
    expect(r.error).toContain('***');
    const logged = errSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
    expect(logged).not.toContain('abcdefghijklmnop');
  });
});

describe('연결 위생', () => {
  test('타임아웃을 설정해 요청이 무한정 끌려가지 않게 한다', async () => {
    configure();
    await sendAdminMail(CONTENT);
    const opts = createTransportMock.mock.calls[0][0] as unknown as Record<string, number>;
    expect(opts.connectionTimeout).toBeGreaterThan(0);
    expect(opts.greetingTimeout).toBeGreaterThan(0);
    expect(opts.socketTimeout).toBeGreaterThan(0);
  });

  test('465 는 secure, 587 은 STARTTLS', async () => {
    configure({ SMTP_PORT: '465' });
    await sendAdminMail(CONTENT);
    expect((createTransportMock.mock.calls[0][0] as unknown as { secure: boolean }).secure).toBe(true);

    createTransportMock.mockClear();
    configure({ SMTP_PORT: '587' });
    await sendAdminMail(CONTENT);
    expect((createTransportMock.mock.calls[0][0] as unknown as { secure: boolean }).secure).toBe(false);
  });

  test('성공·실패 어느 쪽이든 transport 를 닫는다', async () => {
    configure();
    await sendAdminMail(CONTENT);
    expect(closeMock).toHaveBeenCalled();

    closeMock.mockClear();
    sendMailMock.mockRejectedValue(new Error('boom'));
    await sendAdminMail(CONTENT);
    expect(closeMock).toHaveBeenCalled();
  });
});

describe('제목 정규화 — 발송 직전 2차 방어', () => {
  test('호출부가 놓친 CRLF 도 발송 직전에 제거된다', async () => {
    configure();
    await sendAdminMail({ ...CONTENT, subject: '가입 요청\r\nBcc: evil@x.com' });
    expect(sendMailMock.mock.calls[0][0].subject).not.toMatch(/[\r\n]/);
  });

  test('제목이 비면 대체 문구를 넣는다', async () => {
    configure();
    await sendAdminMail({ ...CONTENT, subject: '  ' });
    expect(sendMailMock.mock.calls[0][0].subject).toBe('가입 요청');
  });
});
