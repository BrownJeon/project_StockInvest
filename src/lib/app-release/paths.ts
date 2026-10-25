/**
 * T-084 — APK 파일 이름·경로 판단 (순수 함수, I/O 없음).
 *
 * 공개 경로 `/app/download/<file>` 의 입력을 여기서 먼저 거른다. 원칙:
 *  - 요청 이름은 `latest.apk` 또는 `stockinvest-<x.y.z>.apk` **두 형식만** 받는다(그 밖은 DB 조회도 하지 않는다).
 *  - DB 의 `apk_file` 은 **파일 이름만** 담는다(경로 구분자·`..`·인코딩 문자 불가 — DB CHECK 와 같은 정규식).
 *  - 실제 경로는 `릴리스 디렉터리 + 파일 이름` 하나뿐이고, 결과의 dirname 이 릴리스 디렉터리와 정확히 같아야 한다.
 */
import path from 'node:path';
import { VERSION_NAME_PATTERN } from './version';

/** DB CHECK chk_app_release_file 과 같은 규칙 — 영숫자로 시작, [A-Za-z0-9._-], `.apk` 로 끝, 최대 128자. */
export const APK_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,123}\.apk$/;

/** 요청 이름 중 '버전 지정' 형식 — `stockinvest-1.2.3.apk`. 버전 부분은 version.ts 의 VERSION_NAME_PATTERN(정확히 x.y.z) 그대로. */
export const VERSIONED_DOWNLOAD_RE = new RegExp(`^stockinvest-${VERSION_NAME_PATTERN}[.]apk$`);

/** 최신 배포본 별칭. */
export const LATEST_DOWNLOAD_NAME = 'latest.apk';

/** 업데이트 띠·안내 페이지가 여는 주소(같은 출처 상대 경로). */
export const LATEST_DOWNLOAD_URL = `/app/download/${LATEST_DOWNLOAD_NAME}`;

/** 기본 릴리스 디렉터리 — blue/green 릴리스가 바뀌어도 유지되는 shared 아래. */
export const DEFAULT_APP_RELEASE_DIR = '/home/brownjeon/apps/stockinvest/shared/app-releases';

export type DownloadRequest = { kind: 'latest' } | { kind: 'named'; apkFile: string };

/**
 * `/app/download/<file>` 의 file(Next 가 디코딩한 값) → 요청 종류. 형식이 다르면 null(→ 404).
 * 디코딩 뒤 값을 보므로 `%2F`·`%2e%2e` 는 `/`·`..` 로 들어오고 정규식이 거부한다. 이중 인코딩(`%252F`)은 `%` 가 남아 거부된다.
 */
export function classifyDownloadRequest(file: unknown): DownloadRequest | null {
  if (typeof file !== 'string') return null;
  if (file === LATEST_DOWNLOAD_NAME) return { kind: 'latest' };
  if (VERSIONED_DOWNLOAD_RE.test(file) && APK_FILE_RE.test(file)) return { kind: 'named', apkFile: file };
  return null;
}

/** 이름이 DB 규칙에 맞는 '파일 이름만' 인가. */
export function isSafeApkFileName(name: unknown): name is string {
  return typeof name === 'string' && APK_FILE_RE.test(name);
}

/**
 * 릴리스 디렉터리 — `APP_RELEASE_DIR`(절대 경로) 또는 기본값. 값이 있는데 절대 경로가 아니거나 NUL 이 있으면 null(설정 오류 → 다운로드 404).
 * 상대 경로를 cwd 기준으로 풀지 않는다 — blue/green 릴리스마다 cwd 가 달라 조용히 다른 곳을 보게 된다.
 */
export function resolveReleaseDir(env: Record<string, string | undefined> = process.env): string | null {
  const raw = (env.APP_RELEASE_DIR ?? '').trim();
  if (raw === '') return DEFAULT_APP_RELEASE_DIR;
  if (raw.includes('\0') || !path.isAbsolute(raw)) return null;
  return path.resolve(raw);
}

/** 디렉터리 + 파일 이름 → 절대 경로. 이름이 규칙 밖이거나 결과가 디렉터리 바로 아래가 아니면 null. */
export function releaseFilePath(dir: string, apkFile: unknown): string | null {
  if (!path.isAbsolute(dir) || !isSafeApkFileName(apkFile)) return null;
  const base = path.resolve(dir);
  const full = path.join(base, apkFile);
  if (path.dirname(full) !== base || path.basename(full) !== apkFile) return null;
  return full;
}
