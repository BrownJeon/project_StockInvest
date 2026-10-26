/**
 * T-084 — 인증 관문(`src/middleware.ts`) 공개/보호 판정 고정.
 *
 * ① `/app/download/<file>` 는 무인증 통과(공개 범위는 이 prefix 한 항목)
 * ② `/app/download`(슬래시 없음)·`/app/downloads`·`/app/download/../api/orders`·`/app/download/%2e%2e/api/orders` 등은 여전히 보호
 * ③ 기존 공개/보호 경로 판정 불변(T-084 이전 목록 그대로)
 *
 * 실제 `middleware()` 를 NextRequest 로 부른다(내부 함수 export 없이). 통과 = `x-middleware-next: 1`,
 * 보호 = API 401 JSON / 페이지 /login 307 리다이렉트. 세션 서명 키는 시험용 합성값.
 */
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

const ORIGINAL = { secret: process.env.AUTH_SESSION_SECRET, cron: process.env.CRON_SECRET };
beforeEach(() => {
  process.env.AUTH_SESSION_SECRET = 't084-mw-test-secret-0123456789';
  process.env.CRON_SECRET = 't084-cron-test';
});
afterAll(() => {
  if (ORIGINAL.secret === undefined) delete process.env.AUTH_SESSION_SECRET;
  else process.env.AUTH_SESSION_SECRET = ORIGINAL.secret;
  if (ORIGINAL.cron === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL.cron;
});

type Verdict = 'public' | 'api401' | 'login';

async function verdict(rawPath: string, method = 'GET'): Promise<{ v: Verdict | string; pathname: string }> {
  const req = new NextRequest(`https://stock.example.com${rawPath}`, { method });
  const res = await middleware(req);
  const pathname = req.nextUrl.pathname;
  if (res.headers.get('x-middleware-next') === '1') return { v: 'public', pathname };
  if (res.status === 401) return { v: 'api401', pathname };
  if (res.status === 307 && (res.headers.get('location') ?? '').includes('/login')) return { v: 'login', pathname };
  return { v: `other:${res.status}`, pathname };
}

describe('① /app/download/ — 무인증 통과', () => {
  test.each(['/app/download/latest.apk', '/app/download/stockinvest-1.0.0.apk', '/app/download/anything-else.bin'])('%s → public', async (p) => {
    expect((await verdict(p)).v).toBe('public');
  });
  test('HEAD 도 통과', async () => expect((await verdict('/app/download/latest.apk', 'HEAD')).v).toBe('public'));
  // 이름 검사는 라우트 몫이다(형식 밖 → 404). 미들웨어는 prefix 만 본다 — 위 'anything-else.bin' 이 그 범위를 문서화한다.
});

describe('② 근처 경로는 여전히 보호', () => {
  test.each([
    ['/app/download', 'login'],
    ['/app/downloads', 'login'],
    ['/app/downloads/latest.apk', 'login'],
    ['/app/download-latest.apk', 'login'],
    ['/app', 'login'],
    ['/app/', 'login'],
    ['/APP/download/latest.apk', 'login'],
    ['/app/Download/latest.apk', 'login'],
    ['/x/app/download/latest.apk', 'login'],
    ['/api/app/download/latest.apk', 'api401'],
    ['/api/app/version', 'api401'],
  ])('%s → %s', async (p, want) => {
    expect((await verdict(p)).v).toBe(want);
  });

  test.each([
    ['/app/download/../api/orders', '/app/api/orders'],
    ['/app/download/../../api/orders', '/api/orders'],
    ['/app/download/%2e%2e/api/orders', '/app/api/orders'],
    ['/app/download/%2E%2E/%2e%2e/api/orders', '/api/orders'],
    ['/app/download/.%2e/.%2e/api/safety', '/api/safety'],
    ['/app/download/..\\..\\api\\orders', '/api/orders'],
    ['/app/download/./../../api/settings/safety', '/api/settings/safety'],
  ])('점 구간 이탈 %s → 정규화된 %s 기준으로 보호', async (p, normalized) => {
    const r = await verdict(p);
    expect(r.pathname).toBe(normalized);
    expect(r.v).not.toBe('public');
  });

  test('POST /api/orders 류도 /app/download 로 감싸 우회 불가', async () => {
    expect((await verdict('/app/download/../../api/orders', 'POST')).v).toBe('api401');
    expect((await verdict('/app/download/%2e%2e/%2e%2e/api/orders', 'POST')).v).toBe('api401');
  });
});

describe('③ 기존 판정 불변', () => {
  test.each([
    '/api/health',
    '/login',
    '/signup',
    '/signup/request',
    '/api/auth/login',
    '/api/auth/signup',
    '/api/auth/signup-request',
    '/api/auth/logout',
    '/api/auth/google',
    '/api/auth/google/callback',
    '/api/auth/github',
    '/api/auth/github/callback',
    '/api/auth/oauth-providers',
    '/api/auth/oauth-pending',
    '/api/auth/oauth-complete',
    '/oauth/invite',
    '/favicon.ico',
    '/robots.txt',
    '/manifest.json',
    '/manifest.webmanifest',
    '/apple-touch-icon.png',
    '/_next/static/chunks/main.js',
    '/__nextjs_original-stack-frame',
    '/static/x.png',
  ])('공개 %s', async (p) => expect((await verdict(p)).v).toBe('public'));

  test.each([
    ['/', 'login'],
    ['/dashboard', 'login'],
    ['/settings', 'login'],
    ['/order', 'login'],
    ['/login/', 'login'],
    ['/api/orders', 'api401'],
    ['/api/safety', 'api401'],
    ['/api/settings/safety', 'api401'],
    ['/api/signals', 'api401'],
    ['/api/auth/me', 'api401'],
    ['/api/health/x', 'api401'],
    ['/api/cash-ledger', 'api401'],
  ])('보호 %s → %s', async (p, want) => expect((await verdict(p)).v).toBe(want));

  test('/api/cron/* — 헤더 시크릿 없으면 401', async () => {
    expect((await verdict('/api/cron/entry-watcher', 'POST')).v).toBe('api401');
  });

  test('세션 서명 키 미설정 → /app/download 는 여전히 통과, 보호 경로는 503', async () => {
    delete process.env.AUTH_SESSION_SECRET;
    expect((await verdict('/app/download/latest.apk')).v).toBe('public');
    expect((await verdict('/api/orders')).v).toBe('other:503');
  });
});

/**
 * T-088 — 앱 Google 로그인의 코드 교환 경로 `/api/auth/app-exchange` 를 **정확 일치 1개**로 공개한다.
 * 위 ①~③ 의 기존 단언은 그대로 두고 이어 쓴다. 이웃 경로·대소문자·점 구간·인코딩 변형은 여전히 보호돼야 하고,
 * 공개 목록을 넓히는 변이(접두어로 바꾸기·`/api/auth/` 통째 공개)는 아래 ⑤ 가 잡는다.
 */
describe('④ T-088 /api/auth/app-exchange — 정확 일치만 무인증 통과', () => {
  test.each(['POST', 'GET', 'HEAD'])('%s /api/auth/app-exchange → public(메서드 판정은 라우트 몫: GET 405)', async (m) => {
    expect((await verdict('/api/auth/app-exchange', m)).v).toBe('public');
  });

  test('공개 경로 문자열이 app-flow 상수와 같다', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { APP_EXCHANGE_PATH } = require('@/lib/auth/oauth/app-flow') as { APP_EXCHANGE_PATH: string };
    expect(APP_EXCHANGE_PATH).toBe('/api/auth/app-exchange');
  });

  test('세션 서명 키가 없어도 공개(라우트가 같은 400 으로 처리)', async () => {
    delete process.env.AUTH_SESSION_SECRET;
    expect((await verdict('/api/auth/app-exchange', 'POST')).v).toBe('public');
  });
});

describe('⑤ T-088 이웃 경로는 여전히 보호', () => {
  test.each([
    ['/api/auth/app-exchange/', 'api401'],
    ['/api/auth/app-exchange/x', 'api401'],
    ['/api/auth/app-exchange/../../orders', 'api401'],
    ['/api/auth/app-exchanges', 'api401'],
    ['/api/auth/app-exchange.json', 'api401'],
    ['/api/auth/app-exchange-x', 'api401'],
    ['/api/auth/app-exchang', 'api401'],
    ['/api/auth/App-Exchange', 'api401'],
    ['/api/auth/APP-EXCHANGE', 'api401'],
    ['/api/auth/app_exchange', 'api401'],
    ['/api/auth/app', 'api401'],
    ['/api/auth/app-code', 'api401'],
    ['/api/auth/google/app-exchange', 'api401'],
    ['/api/auth/x/app-exchange', 'api401'],
    ['/api/auth/', 'api401'],
    ['/api/auth', 'api401'],
    ['/api/app-exchange', 'api401'],
    ['/app-exchange', 'login'],
    ['/auth/app-exchange', 'login'],
  ])('%s → %s', async (p, want) => {
    expect((await verdict(p, 'POST')).v).toBe(want);
  });

  test.each([
    ['/api/auth/app-exchange/../../api/orders', '/api/api/orders'],
    ['/api/auth/app-exchange/%2e%2e/%2e%2e/orders', '/api/orders'],
    ['/api/auth/app-exchange/..%2f..%2forders', null],
    ['/api/auth/app-exchange%2f..%2f..%2forders', null],
    ['/api/auth/app-exchange%2Fx', null],
    ['/api/auth/app-exchange;x', null],
    ['/api/auth/app-exchange%00', null],
    ['/api/auth/app%2Dexchange', null],
  ])('변형 %s → 보호', async (p, normalized) => {
    const r = await verdict(p, 'POST');
    if (normalized !== null) expect(r.pathname).toBe(normalized);
    expect(r.v).not.toBe('public');
  });

  test('다른 인증 라우트의 하위 경로도 그대로 보호(공개 목록이 넓어지지 않음)', async () => {
    for (const p of ['/api/auth/login/x', '/api/auth/google/x', '/api/auth/me', '/api/auth/oauth-complete/x', '/api/auth/session']) {
      expect((await verdict(p, 'POST')).v).toBe('api401');
    }
  });
});

/**
 * T-091 M2 — 안드로이드 App Links 검증 파일 `/.well-known/assetlinks.json` 을 **정확 일치 1개**로 공개한다.
 * 안드로이드는 설치 때 쿠키 없이 이 파일을 받아 가고 리다이렉트가 끼면 검증이 실패하므로 무인증 통과여야 한다.
 * `/.well-known/` 를 prefix 로 열지 않는다 — 다른 `.well-known` 경로·하위 경로·대소문자·인코딩 변형은 아래 ⑦ 이 보호를 고정한다.
 * (진짜 쿼리스트링 `?x=1` 은 pathname 을 바꾸지 않는다 — 같은 정적 파일이라 공개가 맞다. 경로 안에 인코딩된 `%3F` 는 다른 경로라 보호.)
 */
describe('⑥ T-091 /.well-known/assetlinks.json — 정확 일치만 무인증 통과', () => {
  test.each(['GET', 'HEAD'])('%s /.well-known/assetlinks.json → public', async (m) => {
    expect((await verdict('/.well-known/assetlinks.json', m)).v).toBe('public');
  });

  test('쿼리스트링은 pathname 을 바꾸지 않는다 — 같은 파일이라 공개', async () => {
    const r = await verdict('/.well-known/assetlinks.json?x=1');
    expect(r.pathname).toBe('/.well-known/assetlinks.json');
    expect(r.v).toBe('public');
  });

  test('세션 서명 키가 없어도 공개(설치 때 검증은 서버 설정과 무관해야 한다)', async () => {
    delete process.env.AUTH_SESSION_SECRET;
    expect((await verdict('/.well-known/assetlinks.json')).v).toBe('public');
  });

  test('공개 파일이 실제로 public/.well-known/assetlinks.json 에 있다(경로 철자 드리프트 방지)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('node:path') as typeof import('node:path');
    expect(fs.existsSync(path.join(__dirname, '..', '..', 'public', '.well-known', 'assetlinks.json'))).toBe(true);
  });
});

describe('⑦ T-091 그 밖의 /.well-known/* 와 이웃 경로는 여전히 보호', () => {
  test.each([
    ['/.well-known/other.json', 'login'],
    ['/.well-known/apple-app-site-association', 'login'],
    ['/.well-known/security.txt', 'login'],
    ['/.well-known/', 'login'],
    ['/.well-known', 'login'],
    ['/.well-known/assetlinks.json/', 'login'],
    ['/.well-known/assetlinks.json/x', 'login'],
    ['/.well-known/assetlinks.jsonx', 'login'],
    ['/.well-known/assetlinks.json.bak', 'login'],
    ['/.well-known/assetlinks', 'login'],
    ['/.well-known/assetlink.json', 'login'],
    ['/.WELL-KNOWN/assetlinks.json', 'login'],
    ['/.well-known/AssetLinks.json', 'login'],
    ['/.well-known/assetlinks.JSON', 'login'],
    ['/x/.well-known/assetlinks.json', 'login'],
    ['/.well-known/x/assetlinks.json', 'login'],
    ['/assetlinks.json', 'login'],
    ['/well-known/assetlinks.json', 'login'],
    ['/.well_known/assetlinks.json', 'login'],
    ['/api/.well-known/assetlinks.json', 'api401'],
  ])('%s → %s', async (p, want) => {
    expect((await verdict(p)).v).toBe(want);
  });

  test.each([
    ['/.well-known/assetlinks.json/../../api/orders', '/api/orders'],
    ['/.well-known/assetlinks.json/%2e%2e/%2e%2e/api/orders', '/api/orders'],
    ['/.well-known/../api/settings/safety', '/api/settings/safety'],
    ['/.well-known/assetlinks.json%3Fx', null],
    ['/.well-known/assetlinks.json%23x', null],
    ['/.well-known/assetlinks%2Ejson', null],
    ['/.well-known%2Fassetlinks.json', null],
    ['/.well-known/assetlinks.json;x', null],
    ['/.well-known/assetlinks.json%00', null],
    ['/.well-known/assetlinks.json%2f..%2f..%2fapi%2forders', null],
  ])('변형 %s → 보호', async (p, normalized) => {
    const r = await verdict(p);
    if (normalized !== null) expect(r.pathname).toBe(normalized);
    expect(r.v).not.toBe('public');
  });

  test('점 구간으로 assetlinks 를 감싸 보호 경로를 열 수 없다(POST)', async () => {
    expect((await verdict('/.well-known/assetlinks.json/../../api/orders', 'POST')).v).toBe('api401');
  });
});
