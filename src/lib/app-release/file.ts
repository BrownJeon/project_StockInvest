/**
 * T-084 — 등록된 APK 파일을 열고 내용이 기록(sha256·크기)과 같은지 확인한다.
 *
 * 안전 규칙(전부 만족할 때만 열린 파일 핸들을 돌려준다. 하나라도 어긋나면 null — 호출부는 404):
 *  1. 경로 = 릴리스 디렉터리 + 파일 이름(`releaseFilePath`). 이름 규칙 밖이면 열지 않는다.
 *  2. 마지막 구성요소가 심볼릭 링크면 거부(`lstat`) + `O_NOFOLLOW` 로 열어 lstat 과 open 사이에 링크로 바뀌어도 거부.
 *  3. 열린 파일의 실경로 디렉터리가 릴리스 디렉터리의 실경로와 같아야 한다(디렉터리 밖으로 못 나감).
 *  4. 일반 파일 · 크기 = `size_bytes` · 내용 sha256 = `sha256`.
 *  5. 해시는 **열린 핸들**로 계산하고 같은 핸들로 스트리밍한다 — 확인 뒤 파일이 다른 파일로 바꿔치기(rename)돼도 확인한 내용이 나간다.
 *     (같은 inode 를 제자리에서 덮어쓰는 것까지는 막지 못한다 — 릴리스 디렉터리 쓰기 권한이 있는 사람만 가능.)
 *
 * 성능: 해시는 (dev, ino, size, mtime, ctime) 키로 프로세스 메모리에 캐시한다. 파일이 바뀌면 키가 바뀌어 다시 계산한다.
 */
import { constants as fsConstants, promises as fsp } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { releaseFilePath } from './paths';

export interface ExpectedApk {
  versionCode: number;
  apkFile: string;
  sha256: string;
  sizeBytes: number;
}

export interface VerifiedApk {
  handle: FileHandle;
  fileName: string;
  size: number;
  sha256: string;
}

export type VerifyFailure =
  | 'bad_name'
  | 'dir_missing'
  | 'missing'
  | 'symlink'
  | 'not_file'
  | 'outside_dir'
  | 'size_mismatch'
  | 'sha_mismatch'
  | 'io_error';

const HASH_CACHE_MAX = 32;
const hashCache = new Map<string, string>();

/** 시험용 — 해시 캐시 비우기. */
export function __resetHashCacheForTest(): void {
  hashCache.clear();
}

/** 시험용 — 캐시 크기. */
export function __hashCacheSizeForTest(): number {
  return hashCache.size;
}

async function sha256OfHandle(fh: FileHandle, size: number): Promise<string> {
  const h = createHash('sha256');
  const buf = Buffer.allocUnsafe(1024 * 1024);
  let pos = 0;
  while (pos < size) {
    const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, size - pos), pos);
    if (bytesRead === 0) break;
    h.update(buf.subarray(0, bytesRead));
    pos += bytesRead;
  }
  if (pos !== size) throw new Error('short read');
  return h.digest('hex');
}

function logFailure(expected: ExpectedApk, reason: VerifyFailure): void {
  // 경로 전체는 남기지 않는다(파일 이름·versionCode 만). 공개 응답은 언제나 같은 404 다.
  console.error(`[app-release] versionCode=${expected.versionCode} file=${expected.apkFile} 내보내지 않음: ${reason}`);
}

/**
 * 기록과 같은 APK 면 열린 핸들을 돌려준다. 호출부가 `handle.close()` 책임을 진다(스트림 autoClose 포함).
 * 실패 사유는 서버 로그에만 남기고 `{ ok:false, reason }` 으로 돌려준다.
 */
export async function openVerifiedApk(
  releaseDir: string,
  expected: ExpectedApk,
): Promise<{ ok: true; apk: VerifiedApk } | { ok: false; reason: VerifyFailure }> {
  const fail = (reason: VerifyFailure) => {
    logFailure(expected, reason);
    return { ok: false as const, reason };
  };

  const candidate = releaseFilePath(releaseDir, expected.apkFile);
  if (!candidate) return fail('bad_name');

  let realDir: string;
  try {
    realDir = await fsp.realpath(releaseDir);
  } catch {
    return fail('dir_missing');
  }

  let lst;
  try {
    lst = await fsp.lstat(candidate);
  } catch {
    return fail('missing');
  }
  if (lst.isSymbolicLink()) return fail('symlink');
  if (!lst.isFile()) return fail('not_file');

  let fh: FileHandle;
  try {
    fh = await fsp.open(candidate, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (e) {
    return fail((e as NodeJS.ErrnoException)?.code === 'ELOOP' ? 'symlink' : 'missing');
  }

  let keep = false;
  try {
    const st = await fh.stat();
    if (!st.isFile()) return fail('not_file');
    // lstat 으로 본 파일과 연 파일이 같은 inode 인가(사이에 바꿔치기 됐으면 거부).
    if (st.ino !== lst.ino || st.dev !== lst.dev) return fail('missing');

    const real = await fsp.realpath(candidate);
    if (path.dirname(real) !== realDir) return fail('outside_dir');

    if (st.size !== expected.sizeBytes) return fail('size_mismatch');

    const key = `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`;
    let sha = hashCache.get(key);
    if (!sha) {
      sha = await sha256OfHandle(fh, st.size);
      if (hashCache.size >= HASH_CACHE_MAX) hashCache.clear();
      hashCache.set(key, sha);
    }
    if (sha !== expected.sha256.toLowerCase()) return fail('sha_mismatch');

    keep = true;
    return { ok: true, apk: { handle: fh, fileName: expected.apkFile, size: st.size, sha256: sha } };
  } catch {
    return fail('io_error');
  } finally {
    if (!keep) await fh.close().catch(() => {});
  }
}
