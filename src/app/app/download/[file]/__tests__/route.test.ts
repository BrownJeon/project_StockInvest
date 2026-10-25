/**
 * T-084 — GET|HEAD /app/download/[file] (공개): 이름 두 형식만 · 등록 행 + sha256 일치 파일만 · 헤더 · 404 일원화 · 요청 제한.
 * 실제 임시 디렉터리(APP_RELEASE_DIR) + 가짜 DB(운영·공용 DB 접속 없음). 세션 쿠키 없이 부른다(공개 경로).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
const mockDb: { rows: Row[]; fail: Error | null; sqls: Array<{ sql: string; values?: unknown[] }> } = { rows: [], fail: null, sqls: [] };
jest.mock('@/lib/db', () => ({
  getPool: () => ({
    query: async (sql: string, values?: unknown[]) => {
      mockDb.sqls.push({ sql, values });
      if (mockDb.fail) throw mockDb.fail;
      let rows = [...mockDb.rows].sort((a, b) => Number(b.version_code) - Number(a.version_code));
      if (/WHERE apk_file = \?/.test(sql)) rows = rows.filter((r) => r.apk_file === values?.[0]);
      return [rows.slice(0, 1), []];
    },
  }),
}));

import { GET, HEAD } from '../route';
import * as routeModule from '../route';
import { downloadLimiter, DOWNLOAD_LIMIT } from '@/lib/app-release/handlers';
import { __resetHashCacheForTest } from '@/lib/app-release/file';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const V1 = Buffer.from('PK\u0003\u0004 version one '.repeat(50));
const V2 = Buffer.from('PK\u0003\u0004 version two, a bit longer '.repeat(80));

let tmp: string;
let dir: string;
let errSpy: jest.SpyInstance;
const ORIGINAL_DIR = process.env.APP_RELEASE_DIR;

function row(code: number, name: string, body: Buffer, over: Row = {}): Row {
  return { version_code: code, version_name: name, apk_file: `stockinvest-${name}.apk`, sha256: sha(body), size_bytes: body.length, min_supported: 0, notes: null, created_at: new Date(), ...over };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't084-dl-'));
  dir = path.join(tmp, 'app-releases');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'stockinvest-1.0.0.apk'), V1);
  fs.writeFileSync(path.join(dir, 'stockinvest-1.0.1.apk'), V2);
  process.env.APP_RELEASE_DIR = dir;
  mockDb.rows = [row(1, '1.0.0', V1), row(2, '1.0.1', V2)];
  mockDb.fail = null;
  mockDb.sqls = [];
  downloadLimiter.reset();
  __resetHashCacheForTest();
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errSpy.mockRestore();
  fs.rmSync(tmp, { recursive: true, force: true });
  if (ORIGINAL_DIR === undefined) delete process.env.APP_RELEASE_DIR;
  else process.env.APP_RELEASE_DIR = ORIGINAL_DIR;
});

let ipN = 0;
function req(file: string, method = 'GET', ip = `10.0.0.${(ipN++ % 200) + 1}`): [NextRequest, { params: Promise<{ file: string }> }] {
  return [new NextRequest(`https://stock.example.com/app/download/${encodeURIComponent(file)}`, { method, headers: { 'x-real-ip': ip } }), { params: Promise.resolve({ file }) }];
}
async function bodyOf(r: Response): Promise<Buffer> {
  return Buffer.from(await r.arrayBuffer());
}

test('라우트 설정 — Node 런타임·force-dynamic, GET·HEAD 만', () => {
  expect(routeModule.runtime).toBe('nodejs');
  expect(routeModule.dynamic).toBe('force-dynamic');
  expect(Object.keys(routeModule).sort()).toEqual(['GET', 'HEAD', 'dynamic', 'runtime']);
});

test('latest.apk → 최신 행 파일, 헤더 전부', async () => {
  const r = await GET(...req('latest.apk'));
  expect(r.status).toBe(200);
  expect(r.headers.get('content-type')).toBe('application/vnd.android.package-archive');
  expect(r.headers.get('content-disposition')).toBe('attachment; filename="stockinvest-1.0.1.apk"');
  expect(r.headers.get('content-length')).toBe(String(V2.length));
  expect(r.headers.get('cache-control')).toBe('no-store');
  expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  expect(r.headers.get('x-content-sha256')).toBe(sha(V2));
  const b = await bodyOf(r);
  expect(b.equals(V2)).toBe(true);
  expect(sha(b)).toBe(sha(V2)); // 받은 파일 sha256 = 기록값
});

test('버전 이름 요청 → apk_file 이 정확히 같은 행', async () => {
  const r = await GET(...req('stockinvest-1.0.0.apk'));
  expect(r.status).toBe(200);
  expect((await bodyOf(r)).equals(V1)).toBe(true);
  expect(mockDb.sqls.at(-1)?.values).toEqual(['stockinvest-1.0.0.apk']);
});

test('HEAD → 같은 헤더, 본문 없음', async () => {
  const r = await HEAD(...req('latest.apk', 'HEAD'));
  expect(r.status).toBe(200);
  expect(r.headers.get('content-length')).toBe(String(V2.length));
  expect(r.body).toBeNull();
});

test.each([
  'latest.APK',
  'stockinvest-1.0.apk',
  'other.apk',
  '../stockinvest-1.0.0.apk',
  '../../etc/passwd',
  '..%2Fstockinvest-1.0.0.apk',
  '%2e%2e',
  'stockinvest-1.0.0.apk/x',
  'index.html',
  '',
])('형식 밖 이름 %j → 404, DB 조회도 안 함', async (f) => {
  const r = await GET(...req(f));
  expect(r.status).toBe(404);
  expect(r.headers.get('cache-control')).toBe('no-store');
  expect(mockDb.sqls).toHaveLength(0);
});

test('등록 안 된 버전 이름 → 404 (디스크에 파일이 있어도)', async () => {
  fs.writeFileSync(path.join(dir, 'stockinvest-9.9.9.apk'), V1);
  expect((await GET(...req('stockinvest-9.9.9.apk'))).status).toBe(404);
});

test('sha256 불일치 → 500 이 아니라 404 + 서버 로그', async () => {
  mockDb.rows = [row(2, '1.0.1', V2, { sha256: '0'.repeat(64) })];
  const r = await GET(...req('latest.apk'));
  expect(r.status).toBe(404);
  expect(await r.text()).toBe('');
  expect(errSpy.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('sha_mismatch');
});

test('크기 불일치 → 404', async () => {
  mockDb.rows = [row(2, '1.0.1', V2, { size_bytes: V2.length - 1 })];
  expect((await GET(...req('latest.apk'))).status).toBe(404);
});

test('파일 없음 → 404', async () => {
  fs.rmSync(path.join(dir, 'stockinvest-1.0.1.apk'));
  expect((await GET(...req('latest.apk'))).status).toBe(404);
});

test('심볼릭 링크(디렉터리 밖, 내용·해시 동일) → 404', async () => {
  const outside = path.join(tmp, 'outside.apk');
  fs.writeFileSync(outside, V2);
  fs.rmSync(path.join(dir, 'stockinvest-1.0.1.apk'));
  fs.symlinkSync(outside, path.join(dir, 'stockinvest-1.0.1.apk'));
  expect((await GET(...req('latest.apk'))).status).toBe(404);
});

test('DB 행의 apk_file 이 경로를 담고 있으면 → 404', async () => {
  fs.writeFileSync(path.join(tmp, 'evil.apk'), V2);
  mockDb.rows = [row(5, '2.0.0', V2, { apk_file: '../evil.apk' })];
  expect((await GET(...req('latest.apk'))).status).toBe(404);
});

test('행 없음 → 404', async () => {
  mockDb.rows = [];
  expect((await GET(...req('latest.apk'))).status).toBe(404);
});

test('테이블 없음·DB 장애 → 공개 응답은 같은 404(내부 상태 비노출), 원인은 서버 로그', async () => {
  mockDb.fail = Object.assign(new Error("Table 'stock.app_release' doesn't exist"), { code: 'ER_NO_SUCH_TABLE', errno: 1146 });
  const r1 = await GET(...req('latest.apk'));
  expect(r1.status).toBe(404);
  expect(await r1.text()).toBe('');
  mockDb.fail = Object.assign(new Error('connect ECONNREFUSED 192.168.0.9'), { code: 'ECONNREFUSED' });
  const r2 = await GET(...req('latest.apk'));
  expect(r2.status).toBe(404);
  expect(await r2.text()).toBe('');
  const logged = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
  expect(logged).toContain('not_migrated');
  expect(logged).not.toContain('192.168');
});

test('APP_RELEASE_DIR 가 상대 경로 → 404(cwd 기준으로 풀지 않음)', async () => {
  process.env.APP_RELEASE_DIR = 'app-releases';
  expect((await GET(...req('latest.apk'))).status).toBe(404);
});

test(`IP 별 요청 제한 — 10분에 ${DOWNLOAD_LIMIT}회, 넘으면 429 + Retry-After, 다른 IP 는 영향 없음`, async () => {
  for (let i = 0; i < DOWNLOAD_LIMIT; i++) {
    const r = await HEAD(...req('latest.apk', 'HEAD', '203.0.113.5'));
    expect(r.status).toBe(200);
  }
  const over = await GET(...req('latest.apk', 'GET', '203.0.113.5'));
  expect(over.status).toBe(429);
  expect(Number(over.headers.get('retry-after'))).toBeGreaterThan(0);
  expect((await GET(...req('latest.apk', 'GET', '203.0.113.6'))).status).toBe(200);
});

test('요청 제한은 형식 밖 이름에도 센다(스캔 방어) — DB 보다 먼저', async () => {
  for (let i = 0; i < DOWNLOAD_LIMIT; i++) await GET(...req(`x${i}.bin`, 'GET', '198.51.100.7'));
  expect((await GET(...req('latest.apk', 'GET', '198.51.100.7'))).status).toBe(429);
  expect(mockDb.sqls).toHaveLength(0);
});
