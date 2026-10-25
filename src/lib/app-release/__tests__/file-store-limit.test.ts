/**
 * T-084 — 파일 검증(실제 임시 디렉터리: 심볼릭 링크·디렉터리 이탈·크기·sha256·캐시), DB 행 해석·조회, 요청 제한.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

jest.mock('@/lib/db', () => ({ getPool: () => { throw new Error('운영 풀 사용 금지(시험)'); } }));

import { openVerifiedApk, __resetHashCacheForTest, __hashCacheSizeForTest, type ExpectedApk } from '../file';
import {
  AppReleaseNotMigratedError,
  getLatestRelease,
  getReleaseByFile,
  isNoAppReleaseTable,
  parseReleaseRow,
  type Queryable,
} from '../store';
import { createFixedWindowLimiter } from '../rate-limit';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

let tmp: string;
let dir: string;
let outside: string;
let errSpy: jest.SpyInstance;
const BODY = Buffer.from('PK\u0003\u0004 fake apk body for T-084 '.repeat(100));

function expected(over: Partial<ExpectedApk> = {}): ExpectedApk {
  return { versionCode: 3, apkFile: 'stockinvest-1.0.2.apk', sha256: sha(BODY), sizeBytes: BODY.length, ...over };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't084-file-'));
  dir = path.join(tmp, 'app-releases');
  outside = path.join(tmp, 'outside');
  fs.mkdirSync(dir);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(dir, 'stockinvest-1.0.2.apk'), BODY);
  __resetHashCacheForTest();
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errSpy.mockRestore();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('openVerifiedApk', () => {
  test('정상 — 핸들로 읽은 내용이 등록 파일과 같다', async () => {
    const r = await openVerifiedApk(dir, expected());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    try {
      expect(r.apk.size).toBe(BODY.length);
      expect(r.apk.sha256).toBe(sha(BODY));
      expect(r.apk.fileName).toBe('stockinvest-1.0.2.apk');
      const buf = Buffer.alloc(BODY.length);
      await r.apk.handle.read(buf, 0, BODY.length, 0);
      expect(buf.equals(BODY)).toBe(true);
    } finally {
      await r.apk.handle.close();
    }
  });

  test('대문자 sha256 기록도 같은 값으로 본다', async () => {
    const r = await openVerifiedApk(dir, expected({ sha256: sha(BODY).toUpperCase() }));
    expect(r.ok).toBe(true);
    if (r.ok) await r.apk.handle.close();
  });

  test('sha256 불일치 → sha_mismatch + 서버 로그(경로 없음)', async () => {
    const r = await openVerifiedApk(dir, expected({ sha256: 'a'.repeat(64) }));
    expect(r).toEqual({ ok: false, reason: 'sha_mismatch' });
    const logged = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('sha_mismatch');
    expect(logged).not.toContain(tmp);
  });

  test('크기 불일치 → size_mismatch(해시 계산 전)', async () => {
    expect(await openVerifiedApk(dir, expected({ sizeBytes: BODY.length + 1 }))).toEqual({ ok: false, reason: 'size_mismatch' });
  });

  test('파일 없음 → missing', async () => {
    expect(await openVerifiedApk(dir, expected({ apkFile: 'stockinvest-9.9.9.apk' }))).toEqual({ ok: false, reason: 'missing' });
  });

  test('디렉터리 없음 → dir_missing', async () => {
    expect(await openVerifiedApk(path.join(tmp, 'nope'), expected())).toEqual({ ok: false, reason: 'dir_missing' });
  });

  test('이름 규칙 밖(경로 조각) → bad_name', async () => {
    fs.writeFileSync(path.join(outside, 'evil.apk'), BODY);
    expect(await openVerifiedApk(dir, expected({ apkFile: '../outside/evil.apk' }))).toEqual({ ok: false, reason: 'bad_name' });
    expect(await openVerifiedApk(dir, expected({ apkFile: '/etc/passwd' }))).toEqual({ ok: false, reason: 'bad_name' });
  });

  test('심볼릭 링크(디렉터리 밖 파일을 가리킴, 내용·해시가 같아도) → symlink', async () => {
    fs.writeFileSync(path.join(outside, 'real.apk'), BODY);
    fs.symlinkSync(path.join(outside, 'real.apk'), path.join(dir, 'stockinvest-2.0.0.apk'));
    expect(await openVerifiedApk(dir, expected({ apkFile: 'stockinvest-2.0.0.apk' }))).toEqual({ ok: false, reason: 'symlink' });
  });

  test('디렉터리 안 심볼릭 링크도 거부', async () => {
    fs.symlinkSync(path.join(dir, 'stockinvest-1.0.2.apk'), path.join(dir, 'stockinvest-2.0.1.apk'));
    expect(await openVerifiedApk(dir, expected({ apkFile: 'stockinvest-2.0.1.apk' }))).toEqual({ ok: false, reason: 'symlink' });
  });

  test('이름이 디렉터리 → not_file', async () => {
    fs.mkdirSync(path.join(dir, 'stockinvest-3.0.0.apk'));
    expect(await openVerifiedApk(dir, expected({ apkFile: 'stockinvest-3.0.0.apk' }))).toEqual({ ok: false, reason: 'not_file' });
  });

  test('릴리스 디렉터리 자체가 심볼릭 링크인 것은 허용(실경로 기준 비교)', async () => {
    const link = path.join(tmp, 'releases-link');
    fs.symlinkSync(dir, link);
    const r = await openVerifiedApk(link, expected());
    expect(r.ok).toBe(true);
    if (r.ok) await r.apk.handle.close();
  });

  test('해시 캐시 — 같은 파일은 재계산 안 함, 내용이 바뀌면 다시 계산해 불일치를 잡는다', async () => {
    const r1 = await openVerifiedApk(dir, expected());
    if (r1.ok) await r1.apk.handle.close();
    expect(__hashCacheSizeForTest()).toBe(1);
    const r2 = await openVerifiedApk(dir, expected());
    if (r2.ok) await r2.apk.handle.close();
    expect(__hashCacheSizeForTest()).toBe(1);

    // 같은 크기, 다른 내용으로 바꿔치기(rename) — inode·mtime 이 바뀌어 캐시 키가 달라진다
    const tampered = Buffer.from(BODY);
    tampered[10] ^= 0xff;
    const tmpFile = path.join(dir, '.tmp-swap');
    fs.writeFileSync(tmpFile, tampered);
    fs.renameSync(tmpFile, path.join(dir, 'stockinvest-1.0.2.apk'));
    expect(await openVerifiedApk(dir, expected())).toEqual({ ok: false, reason: 'sha_mismatch' });
  });

  test('실패 경로에서 핸들을 닫는다(열린 fd 가 늘지 않음)', async () => {
    const fdDir = '/proc/self/fd';
    if (!fs.existsSync(fdDir)) return;
    const before = fs.readdirSync(fdDir).length;
    for (let i = 0; i < 20; i++) await openVerifiedApk(dir, expected({ sha256: 'b'.repeat(64) }));
    const after = fs.readdirSync(fdDir).length;
    expect(after - before).toBeLessThanOrEqual(1);
  });
});

/**
 * R1 — 레이스 방어 3겹이 각각 실제로 일하는지 고정한다. lstat 과 open 사이(검사 시점↔사용 시점)에 파일이 바뀌는 상황을
 * `fs.promises.lstat` 을 한 번 감싸 **진짜 lstat 직후 실제 파일 시스템을 바꾸는** 방식으로 결정적으로 재현한다(모의 결과가 아니라 실제 파일).
 * 각 시험은 다른 두 겹은 통과하고 해당 겹만 걸리게 짰다 — 그 겹을 지우면 ok:true 가 되어 실패한다(변이 시험으로 확인).
 */
describe('openVerifiedApk — 레이스 방어 3겹(lstat↔open 사이 바꿔치기)', () => {
  const NAME = 'stockinvest-1.0.2.apk';
  let realLstat: typeof fs.promises.lstat;
  let lstatSpy: jest.SpyInstance | undefined;

  beforeEach(() => {
    realLstat = fs.promises.lstat.bind(fs.promises);
  });
  afterEach(() => {
    lstatSpy?.mockRestore();
    lstatSpy = undefined;
  });

  /** 다음 lstat 한 번: 진짜 lstat 결과를 돌려주기 직전에 swap() 으로 파일 시스템을 바꾼다. */
  function swapAfterNextLstat(swap: () => void) {
    lstatSpy = jest.spyOn(fs.promises, 'lstat').mockImplementationOnce((async (p: fs.PathLike, opts?: unknown) => {
      const st = await (realLstat as (p: fs.PathLike, o?: unknown) => Promise<fs.Stats>)(p, opts);
      swap();
      return st;
    }) as unknown as typeof fs.promises.lstat);
  }

  test('O_NOFOLLOW — lstat 뒤 같은 inode 를 가리키는 심볼릭 링크로 바뀌면 symlink(inode·디렉터리 검사는 통과하는 상황)', async () => {
    const target = path.join(dir, NAME);
    swapAfterNextLstat(() => {
      fs.renameSync(target, path.join(dir, 'moved.apk')); // 같은 디렉터리·같은 inode
      fs.symlinkSync(path.join(dir, 'moved.apk'), target);
    });
    expect(await openVerifiedApk(dir, expected())).toEqual({ ok: false, reason: 'symlink' });
  });

  test('inode 비교 — lstat 뒤 같은 내용의 다른 파일로 rename 바꿔치기되면 missing(링크·디렉터리·해시 검사는 통과하는 상황)', async () => {
    const target = path.join(dir, NAME);
    swapAfterNextLstat(() => {
      const t = path.join(dir, '.swap');
      fs.writeFileSync(t, BODY); // 내용·크기·sha 는 기록과 같다 — 다른 겹으로는 못 잡는다
      fs.renameSync(t, target);
    });
    expect(await openVerifiedApk(dir, expected())).toEqual({ ok: false, reason: 'missing' });
  });

  test('outside_dir — lstat 뒤 릴리스 디렉터리 경로(심볼릭 링크)가 다른 디렉터리로 바뀌면 거부(같은 inode 하드 링크라 다른 겹은 통과)', async () => {
    const other = path.join(tmp, 'other-dir');
    fs.mkdirSync(other);
    fs.linkSync(path.join(dir, NAME), path.join(other, NAME)); // 하드 링크: 같은 inode, 심볼릭 링크 아님
    const relLink = path.join(tmp, 'rel-link');
    fs.symlinkSync(dir, relLink);
    swapAfterNextLstat(() => {
      const next = path.join(tmp, 'rel-link.next');
      fs.symlinkSync(other, next);
      fs.renameSync(next, relLink); // 원자적으로 링크 대상을 other 로
    });
    expect(await openVerifiedApk(relLink, expected())).toEqual({ ok: false, reason: 'outside_dir' });
  });

  test('바꿔치기가 없으면 같은 경로들이 모두 ok(위 시험들이 경로 구성 탓에 실패한 것이 아님)', async () => {
    const relLink = path.join(tmp, 'rel-link2');
    fs.symlinkSync(dir, relLink);
    for (const d of [dir, relLink]) {
      const r = await openVerifiedApk(d, expected());
      expect(r.ok).toBe(true);
      if (r.ok) await r.apk.handle.close();
    }
  });
});

describe('parseReleaseRow', () => {
  const good = {
    version_code: 3, version_name: '1.0.2', apk_file: 'stockinvest-1.0.2.apk', sha256: 'c'.repeat(64),
    size_bytes: 1234, min_supported: 1, notes: '수정', created_at: new Date('2026-10-25T08:00:00Z'), cert_sha256: null,
  };
  test('정상(BIGINT 문자열 크기도)', () => {
    expect(parseReleaseRow(good)).toEqual({
      versionCode: 3, versionName: '1.0.2', apkFile: 'stockinvest-1.0.2.apk', sha256: 'c'.repeat(64),
      sizeBytes: 1234, minSupported: 1, notes: '수정', createdAt: good.created_at,
    });
    expect(parseReleaseRow({ ...good, size_bytes: '1234' })?.sizeBytes).toBe(1234);
    expect(parseReleaseRow({ ...good, notes: null })?.notes).toBeNull();
  });
  test.each([
    ['version_code 0', { version_code: 0 }],
    ['version_name 형식', { version_name: 'v1' }],
    ['apk_file 경로', { apk_file: '../x.apk' }],
    ['apk_file 확장자', { apk_file: 'x.zip' }],
    ['sha 대문자', { sha256: 'C'.repeat(64) }],
    ['sha 길이', { sha256: 'c'.repeat(63) }],
    ['size 0', { size_bytes: 0 }],
    ['size 음수', { size_bytes: -1 }],
    ['min > code', { min_supported: 4 }],
    ['min 음수', { min_supported: -1 }],
  ])('거부: %s', (_n, over) => expect(parseReleaseRow({ ...good, ...over })).toBeNull());
  test('객체 아님 → null', () => {
    expect(parseReleaseRow(null)).toBeNull();
    expect(parseReleaseRow('x')).toBeNull();
  });
});

describe('store 조회', () => {
  const row = { version_code: 2, version_name: '1.0.1', apk_file: 'stockinvest-1.0.1.apk', sha256: 'd'.repeat(64), size_bytes: 10, min_supported: 0, notes: null, created_at: new Date() };
  function fake(result: unknown | Error): Queryable & { calls: Array<{ sql: string; values?: unknown[] }> } {
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    return {
      calls,
      async query(sql: string, values?: unknown[]) {
        calls.push({ sql, values });
        if (result instanceof Error) throw result;
        return [result, []];
      },
    };
  }

  test('getLatestRelease — SELECT 만, version_code 내림차순 1행', async () => {
    const q = fake([row]);
    expect((await getLatestRelease(q))?.versionCode).toBe(2);
    expect(q.calls).toHaveLength(1);
    expect(q.calls[0].sql).toMatch(/^SELECT .* FROM app_release ORDER BY version_code DESC LIMIT 1$/);
  });
  test('행 없음 → null', async () => expect(await getLatestRelease(fake([]))).toBeNull());
  test('형식이 어긋난 행 → null + 로그', async () => {
    expect(await getLatestRelease(fake([{ ...row, apk_file: '../x.apk' }]))).toBeNull();
    expect(errSpy).toHaveBeenCalled();
  });
  test('getReleaseByFile — 자리표시자로 정확 일치', async () => {
    const q = fake([row]);
    await getReleaseByFile('stockinvest-1.0.1.apk', q);
    expect(q.calls[0].sql).toMatch(/WHERE apk_file = \? LIMIT 1$/);
    expect(q.calls[0].values).toEqual(['stockinvest-1.0.1.apk']);
  });
  test('getReleaseByFile — 규칙 밖 이름은 조회하지 않음', async () => {
    const q = fake([row]);
    expect(await getReleaseByFile('../x.apk', q)).toBeNull();
    expect(q.calls).toHaveLength(0);
  });
  test('테이블 없음(1146 + app_release) → AppReleaseNotMigratedError', async () => {
    const e = Object.assign(new Error("Table 'stock.app_release' doesn't exist"), { code: 'ER_NO_SUCH_TABLE', errno: 1146 });
    await expect(getLatestRelease(fake(e))).rejects.toBeInstanceOf(AppReleaseNotMigratedError);
  });
  test('다른 표 1146·다른 오류는 그대로 던짐', async () => {
    const other = Object.assign(new Error("Table 'stock.users' doesn't exist"), { code: 'ER_NO_SUCH_TABLE', errno: 1146 });
    await expect(getLatestRelease(fake(other))).rejects.toBe(other);
    const conn = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    await expect(getLatestRelease(fake(conn))).rejects.toBe(conn);
  });
  test('isNoAppReleaseTable', () => {
    expect(isNoAppReleaseTable({ errno: 1146, sqlMessage: "Table 'x.app_release' doesn't exist" })).toBe(true);
    expect(isNoAppReleaseTable({ errno: 1146, sqlMessage: "Table 'x.orders' doesn't exist" })).toBe(false);
    expect(isNoAppReleaseTable(null)).toBe(false);
  });
});

describe('createFixedWindowLimiter', () => {
  test('한도까지 허용, 넘으면 남은 초', () => {
    const l = createFixedWindowLimiter({ limit: 3, windowMs: 60_000 });
    expect(l.hit('a', 0).ok).toBe(true);
    expect(l.hit('a', 1).ok).toBe(true);
    expect(l.hit('a', 2).ok).toBe(true);
    expect(l.hit('a', 30_000)).toEqual({ ok: false, retryAfterSec: 30 });
    expect(l.hit('b', 30_000).ok).toBe(true); // 키별
    expect(l.hit('a', 60_000).ok).toBe(true); // 새 창
  });
  test('키 상한 — 넘으면 만료 키 정리, 그래도 넘으면 비움', () => {
    const l = createFixedWindowLimiter({ limit: 1, windowMs: 1000, maxKeys: 3 });
    l.hit('a', 0); l.hit('b', 0); l.hit('c', 0);
    l.hit('d', 2000); // a,b,c 만료 → 정리
    expect(l.size()).toBe(1);
    l.hit('e', 2000); l.hit('f', 2000);
    l.hit('g', 2000); // 만료 없음 → 전부 비우고 g 만
    expect(l.size()).toBe(1);
  });
});
