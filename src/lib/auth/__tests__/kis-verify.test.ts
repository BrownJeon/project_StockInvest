/**
 * KIS 자격증명 실검증 테스트 — fetch 를 mock 으로 주입 (T-008 §테스트 전략 단계 1).
 *
 * 가장 중요한 회귀 방어: **실패 시 어떤 경로로도 ok:true 가 나오면 안 된다**(검증 우회),
 * 그리고 **App Key/Secret 이 반환 메시지에 섞이면 안 된다**.
 */
import {
  kisBaseUrlForMock,
  maskAccountNo,
  validateKisAccountNo,
  validateKisProduct,
  verifyKisCredentials,
} from '../kis-verify';

const APP_KEY = 'PS4xAbCdEfGhIjKlMnOpQrStUvWx0123456789';
const APP_SECRET = 'zY9xW8v7U6t5S4r3Q2p1O0nMlKjIhGfEdCbA-secret';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let logSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;
let errSpy: jest.SpyInstance;
beforeEach(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { logSpy.mockRestore(); warnSpy.mockRestore(); errSpy.mockRestore(); });

describe('kisBaseUrlForMock', () => {
  test('모의/실전 도메인이 분리된다', () => {
    expect(kisBaseUrlForMock(true)).toContain('openapivts');
    expect(kisBaseUrlForMock(false)).toBe('https://openapi.koreainvestment.com:9443');
  });
});

describe('verifyKisCredentials — 성공', () => {
  test('토큰 발급 성공 시 ok:true + 만료시각', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse(200, { access_token: 'tok-abc', expires_in: 3600 }),
    );
    const r = await verifyKisCredentials({ appKey: APP_KEY, appSecret: APP_SECRET, mock: false }, fetchMock);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.accessToken).toBe('tok-abc');
      expect(r.expiresAt.getTime()).toBeGreaterThan(Date.now());
    }
  });

  test('mock 토글이 요청 URL 을 결정한다', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(200, { access_token: 't', expires_in: 100 }));
    await verifyKisCredentials({ appKey: APP_KEY, appSecret: APP_SECRET, mock: true }, fetchMock);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://openapivts.koreainvestment.com:29443/oauth2/tokenP');
  });

  test('요청 본문은 kis-auth.ts 와 동일한 형태 (grant_type/appkey/appsecret)', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(200, { access_token: 't', expires_in: 100 }));
    await verifyKisCredentials({ appKey: APP_KEY, appSecret: APP_SECRET, mock: false }, fetchMock);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body).toEqual({ grant_type: 'client_credentials', appkey: APP_KEY, appsecret: APP_SECRET });
  });
});

describe('verifyKisCredentials — 실패 (우회 불가)', () => {
  test('access_token 이 없으면 200 이어도 실패', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(200, { msg: 'ok' }));
    const r = await verifyKisCredentials({ appKey: APP_KEY, appSecret: APP_SECRET, mock: false }, fetchMock);
    expect(r.ok).toBe(false);
  });

  test('빈 문자열 토큰도 실패', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(200, { access_token: '' }));
    const r = await verifyKisCredentials({ appKey: APP_KEY, appSecret: APP_SECRET, mock: false }, fetchMock);
    expect(r.ok).toBe(false);
  });

  test('403 인증 실패', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(403, { error_code: 'EGW00121' }));
    const r = await verifyKisCredentials({ appKey: APP_KEY, appSecret: APP_SECRET, mock: false }, fetchMock);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('KIS 인증');
  });

  test('1분당 1회 제한은 전용 안내', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(403, { error_code: 'EGW00133', error_description: '접근토큰 발급 잠시 후 다시 시도하세요(1분당 1회)' }));
    const r = await verifyKisCredentials({ appKey: APP_KEY, appSecret: APP_SECRET, mock: false }, fetchMock);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('1분');
  });

  test('네트워크 예외는 ok:false 로 흡수', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error(`connect ECONNREFUSED ${APP_KEY}`));
    const r = await verifyKisCredentials({ appKey: APP_KEY, appSecret: APP_SECRET, mock: false }, fetchMock);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).not.toContain(APP_KEY);
  });

  test('키가 비어 있으면 KIS 를 호출조차 하지 않는다', async () => {
    const fetchMock = jest.fn();
    const r = await verifyKisCredentials({ appKey: '', appSecret: APP_SECRET, mock: false }, fetchMock);
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('평문 노출 방지', () => {
  test('실패 메시지에 App Key/Secret 이 담기지 않는다', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse(400, { error_description: `bad key ${APP_KEY} / ${APP_SECRET}` }),
    );
    const r = await verifyKisCredentials({ appKey: APP_KEY, appSecret: APP_SECRET, mock: false }, fetchMock);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).not.toContain(APP_KEY);
      expect(r.message).not.toContain(APP_SECRET);
    }
  });

  test('로그에도 App Key/Secret 이 남지 않는다', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(403, { error_code: 'EGW00121' }));
    await verifyKisCredentials({ appKey: APP_KEY, appSecret: APP_SECRET, mock: false }, fetchMock);
    const logged = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errSpy.mock.calls]
      .map((c) => JSON.stringify(c)).join('|');
    expect(logged).not.toContain(APP_KEY);
    expect(logged).not.toContain(APP_SECRET);
  });
});

describe('입력 검증 / 마스킹', () => {
  test('계좌번호는 숫자 8~10자리 (하이픈 제거)', () => {
    expect(validateKisAccountNo('50123456')).toEqual({ ok: true, value: '50123456' });
    expect(validateKisAccountNo('5012-3456')).toEqual({ ok: true, value: '50123456' });
    expect(validateKisAccountNo('1234567').ok).toBe(false);
    expect(validateKisAccountNo('12345678901').ok).toBe(false);
    expect(validateKisAccountNo('5012345a').ok).toBe(false);
    expect(validateKisAccountNo(undefined).ok).toBe(false);
  });

  test('상품코드는 숫자 2자리', () => {
    expect(validateKisProduct('01')).toEqual({ ok: true, value: '01' });
    expect(validateKisProduct('1').ok).toBe(false);
    expect(validateKisProduct('ab').ok).toBe(false);
  });

  test('계좌번호 마스킹은 앞2·뒤2만 남긴다', () => {
    expect(maskAccountNo('50123456')).toBe('50****56');
    expect(maskAccountNo('1234')).toBe('****');
  });
});
