/**
 * T-084 — GET /api/app/version: 로그인 필요(라우트 이중 확인) · 응답 모양 · 테이블 없음 503 · 장애 500(내부 정보 노출 없음).
 * DB 는 가짜(운영·공용 DB 접속 없음), 세션은 실제 서명 함수로 만든 합성 쿠키.
 */
import { NextRequest } from 'next/server';
import { signSession, SESSION_COOKIE } from '@/lib/auth/session';

const mockQuery: { impl: (sql: string, v?: unknown[]) => Promise<unknown> } = { impl: async () => [[], []] };
jest.mock('@/lib/db', () => ({ getPool: () => ({ query: (s: string, v?: unknown[]) => mockQuery.impl(s, v) }) }));

import { GET } from '../route';
import * as routeModule from '../route';

const SECRET = 't084-test-secret-0123456789abcdef';
let errSpy: jest.SpyInstance;
const ORIGINAL = process.env.AUTH_SESSION_SECRET;

beforeEach(() => {
  process.env.AUTH_SESSION_SECRET = SECRET;
  mockQuery.impl = async () => [[], []];
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errSpy.mockRestore();
  if (ORIGINAL === undefined) delete process.env.AUTH_SESSION_SECRET;
  else process.env.AUTH_SESSION_SECRET = ORIGINAL;
});

async function req(withSession = true): Promise<NextRequest> {
  const headers: Record<string, string> = {};
  if (withSession) headers.cookie = `${SESSION_COOKIE}=${await signSession(SECRET, 7)}`;
  return new NextRequest('http://localhost:3003/api/app/version', { headers });
}

const ROW = {
  version_code: 3, version_name: '1.0.2', apk_file: 'stockinvest-1.0.2.apk', sha256: 'e'.repeat(64),
  size_bytes: 9_876_543, min_supported: 2, notes: '업데이트 띠 시험', created_at: new Date('2026-10-25T08:00:00Z'),
};

test('라우트 설정 — Node 런타임·force-dynamic, GET 만', () => {
  expect(routeModule.runtime).toBe('nodejs');
  expect(routeModule.dynamic).toBe('force-dynamic');
  expect(Object.keys(routeModule).sort()).toEqual(['GET', 'dynamic', 'runtime']);
});

test('세션 없음 → 401 (미들웨어가 빠져도 라우트가 막는다), DB 조회 안 함', async () => {
  const q = jest.fn(async () => [[ROW], []]);
  mockQuery.impl = q;
  const r = await GET(await req(false));
  expect(r.status).toBe(401);
  expect((await r.json()).ok).toBe(false);
  expect(q).not.toHaveBeenCalled();
});

test('세션 서명 키 없음 → 503 auth_not_configured', async () => {
  delete process.env.AUTH_SESSION_SECRET;
  const r = await GET(await req(false));
  expect(r.status).toBe(503);
  expect((await r.json()).error).toBe('auth_not_configured');
});

test('최신 행 → latest 모양', async () => {
  const seen: string[] = [];
  mockQuery.impl = async (sql) => { seen.push(sql); return [[ROW], []]; };
  const r = await GET(await req());
  expect(r.status).toBe(200);
  expect(r.headers.get('cache-control')).toBe('no-store');
  expect(await r.json()).toEqual({
    ok: true,
    latest: {
      versionCode: 3, versionName: '1.0.2', sizeBytes: 9_876_543, sha256: 'e'.repeat(64),
      notes: '업데이트 띠 시험', minSupported: 2, downloadUrl: '/app/download/latest.apk',
    },
  });
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatch(/^SELECT /);
});

test('응답에 파일 경로·apk_file·cert 가 없다', async () => {
  mockQuery.impl = async () => [[{ ...ROW, cert_sha256: 'f'.repeat(64) }], []];
  const text = await (await GET(await req())).text();
  expect(text).not.toContain('stockinvest-1.0.2.apk');
  expect(text).not.toContain('/home/');
  expect(text).not.toContain('f'.repeat(64));
});

test('행 없음 → latest:null', async () => {
  const r = await GET(await req());
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ ok: true, latest: null });
});

test('테이블 없음 → 503 not_migrated', async () => {
  mockQuery.impl = async () => { throw Object.assign(new Error("Table 'stock.app_release' doesn't exist"), { code: 'ER_NO_SUCH_TABLE', errno: 1146 }); };
  const r = await GET(await req());
  expect(r.status).toBe(503);
  expect(await r.json()).toEqual({ ok: false, error: 'not_migrated' });
});

test('DB 장애 → 500 server_error, 메시지·호스트 노출 없음', async () => {
  mockQuery.impl = async () => { throw Object.assign(new Error('connect ECONNREFUSED 192.168.0.9:3306 password=xyz'), { code: 'ECONNREFUSED' }); };
  const r = await GET(await req());
  expect(r.status).toBe(500);
  const text = await r.text();
  expect(JSON.parse(text)).toEqual({ ok: false, error: 'server_error' });
  expect(text).not.toContain('192.168');
  const logged = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
  expect(logged).not.toContain('password');
});
