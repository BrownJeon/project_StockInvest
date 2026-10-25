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
