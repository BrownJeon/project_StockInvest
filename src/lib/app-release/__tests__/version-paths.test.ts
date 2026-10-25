/**
 * T-084 — 버전 비교·필수 업데이트 판정, 파일 이름·경로 안전(순수 함수).
 */
import path from 'node:path';
import {
  compareVersionCode,
  isUpdateAvailable,
  isUpdateRequired,
  parseVersionCode,
  MAX_VERSION_CODE,
  VERSION_NAME_PATTERN,
  VERSION_NAME_RE,
} from '../version';
import {
  APK_FILE_RE,
  VERSIONED_DOWNLOAD_RE,
  classifyDownloadRequest,
  DEFAULT_APP_RELEASE_DIR,
  isSafeApkFileName,
  LATEST_DOWNLOAD_URL,
  releaseFilePath,
  resolveReleaseDir,
} from '../paths';

describe('versionName 형식 — 정확히 x.y.z (R1: 구성요소 수 통일)', () => {
  test.each(['1.0.0', '0.0.1', '10.20.30', '9999.9999.9999'])('허용 %j', (v) => expect(VERSION_NAME_RE.test(v)).toBe(true));
  test.each(['1', '1.1', '1.0.0.0', '1.0.', '.1.0', '1..0', '10000.0.0', 'v1.0.0', '1.0.0-beta', '1.0.0\n', '1.0.0 ', '１.0.0', '1,0,0', ''])(
    '거부 %j',
    (v) => expect(VERSION_NAME_RE.test(v)).toBe(false),
  );
  test('versionName 으로 통과한 값은 그대로 버전 이름 다운로드 URL 이 된다(어긋남 없음)', () => {
    for (const v of ['1.0.0', '2.10.300', '9999.9999.9999']) {
      expect(VERSION_NAME_RE.test(v)).toBe(true);
      expect(classifyDownloadRequest(`stockinvest-${v}.apk`)).toEqual({ kind: 'named', apkFile: `stockinvest-${v}.apk` });
    }
    for (const v of ['1.1', '1.0.0.0', '1']) {
      expect(VERSION_NAME_RE.test(v)).toBe(false);
      expect(classifyDownloadRequest(`stockinvest-${v}.apk`)).toBeNull();
    }
  });
  test('다운로드 이름 정규식은 같은 패턴 상수에서 만든다', () => {
    expect(VERSIONED_DOWNLOAD_RE.source).toContain(VERSION_NAME_PATTERN);
  });
  test('SQL CHECK·build-apk.sh 의 복제본이 상수와 같은 규칙이다(문자열 복제 드리프트 감시)', () => {
    const fs = jest.requireActual<typeof import('node:fs')>('node:fs');
    const root = path.join(__dirname, '..', '..', '..', '..');
    const sql = fs.readFileSync(path.join(root, 'scripts', 'migrations', 'T-084-app-release.sql'), 'utf8');
    expect(sql).toContain(`CHECK (version_name REGEXP '^${VERSION_NAME_PATTERN}$')`);
    const sh = fs.readFileSync(path.join(root, 'scripts', 'build-apk.sh'), 'utf8');
    expect(sh).toContain(`VERSION_NAME_RE='^${VERSION_NAME_PATTERN}$'`);
  });
  test('SQL 숫자 상한 2개가 코드 상수와 같다 — MAX_VERSION_CODE·Number.MAX_SAFE_INTEGER 가 정본(R4: DB 가 앱이 못 받는 행을 받지 않게)', () => {
    const fs = jest.requireActual<typeof import('node:fs')>('node:fs');
    const root = path.join(__dirname, '..', '..', '..', '..');
    const sql = fs.readFileSync(path.join(root, 'scripts', 'migrations', 'T-084-app-release.sql'), 'utf8');
    expect(sql).toContain(`CHECK (version_code > 0 AND version_code <= ${MAX_VERSION_CODE})`);
    expect(sql).toContain(`CHECK (size_bytes > 0 AND size_bytes <= ${Number.MAX_SAFE_INTEGER})`);
  });
});

describe('parseVersionCode', () => {
  test.each([
    [1, 1],
    [42, 42],
    ['7', 7],
    [' 12 ', 12],
    [MAX_VERSION_CODE, MAX_VERSION_CODE],
  ])('%p → %p', (raw, want) => expect(parseVersionCode(raw)).toBe(want));

  test.each([[0], [-1], [1.5], [NaN], [Infinity], [MAX_VERSION_CODE + 1], [''], ['1.0'], ['abc'], ['1e3'], ['0x10'], [null], [undefined], [{}], ['12345678901']])(
    '%p → null',
    (raw) => expect(parseVersionCode(raw)).toBeNull(),
  );
});

describe('버전 비교 — 정수로만', () => {
  test('compareVersionCode', () => {
    expect(compareVersionCode(9, 10)).toBeLessThan(0);
    expect(compareVersionCode(10, 9)).toBeGreaterThan(0);
    expect(compareVersionCode(3, 3)).toBe(0);
  });
  test('isUpdateAvailable — 현재 < 최신일 때만, 모르면 false', () => {
    expect(isUpdateAvailable(1, 2)).toBe(true);
    expect(isUpdateAvailable(2, 2)).toBe(false);
    expect(isUpdateAvailable(3, 2)).toBe(false);
    expect(isUpdateAvailable(null, 2)).toBe(false);
    expect(isUpdateAvailable(1, null)).toBe(false);
  });
  test('isUpdateRequired — current < min_supported, min 0 은 미지정', () => {
    expect(isUpdateRequired(1, 2)).toBe(true);
    expect(isUpdateRequired(2, 2)).toBe(false);
    expect(isUpdateRequired(3, 2)).toBe(false);
    expect(isUpdateRequired(1, 0)).toBe(false);
    expect(isUpdateRequired(null, 5)).toBe(false);
    expect(isUpdateRequired(5, null)).toBe(false);
  });
});

describe('classifyDownloadRequest — 두 형식만', () => {
  test('latest.apk', () => expect(classifyDownloadRequest('latest.apk')).toEqual({ kind: 'latest' }));
  test('stockinvest-x.y.z.apk', () => {
    expect(classifyDownloadRequest('stockinvest-1.0.0.apk')).toEqual({ kind: 'named', apkFile: 'stockinvest-1.0.0.apk' });
    expect(classifyDownloadRequest('stockinvest-12.345.6789.apk')).toEqual({ kind: 'named', apkFile: 'stockinvest-12.345.6789.apk' });
  });
  test.each([
    'latest.APK',
    'LATEST.apk',
    'latest',
    'stockinvest.apk',
    'stockinvest-1.0.apk',
    'stockinvest-1.0.0.0.apk',
    'stockinvest-1.0.0-beta.apk',
    'stockinvest-1.0.0.apk.exe',
    'other-1.0.0.apk',
    '../stockinvest-1.0.0.apk',
    '..%2Fstockinvest-1.0.0.apk',
    'stockinvest-1.0.0.apk/',
    '/etc/passwd',
    '..',
    '.',
    '',
    'stockinvest-1.0.0.apk\0',
    'a/b.apk',
    'a\\b.apk',
    '%2e%2e',
    'stockinvest-1%2e0%2e0.apk',
    ' latest.apk',
  ])('%j → null', (f) => expect(classifyDownloadRequest(f)).toBeNull());
  test('문자열이 아니면 null', () => {
    expect(classifyDownloadRequest(undefined)).toBeNull();
    expect(classifyDownloadRequest(['latest.apk'])).toBeNull();
  });
  test('다운로드 주소 상수', () => expect(LATEST_DOWNLOAD_URL).toBe('/app/download/latest.apk'));
});

describe('apk_file 이름 규칙(DB CHECK 와 동일)', () => {
  test.each(['stockinvest-1.0.0.apk', 'a.apk', 'A_b-c.1.apk', `${'x'.repeat(124)}.apk`])('허용 %j', (n) => expect(isSafeApkFileName(n)).toBe(true));
  test.each(['.apk', '..apk', '.hidden.apk', '-x.apk', '_x.apk', 'x.APK', 'x.apk ', 'x y.apk', 'x/y.apk', 'x\\y.apk', '../x.apk', 'x%2F.apk', `${'x'.repeat(125)}.apk`, 'x.apk\n', 'x.apk\0', '', 123])(
    '거부 %j',
    (n) => expect(isSafeApkFileName(n)).toBe(false),
  );
  test('정규식은 개행 뒤 꼬리를 허용하지 않는다($ 다중행 아님)', () => expect(APK_FILE_RE.test('x.apk\nmore')).toBe(false));
});

describe('resolveReleaseDir', () => {
  test('미설정·빈 값 → 기본값', () => {
    expect(resolveReleaseDir({})).toBe(DEFAULT_APP_RELEASE_DIR);
    expect(resolveReleaseDir({ APP_RELEASE_DIR: '  ' })).toBe(DEFAULT_APP_RELEASE_DIR);
  });
  test('절대 경로는 정규화', () => expect(resolveReleaseDir({ APP_RELEASE_DIR: '/srv/rel/../rel2/' })).toBe('/srv/rel2'));
  test('상대 경로·NUL → null(설정 오류)', () => {
    expect(resolveReleaseDir({ APP_RELEASE_DIR: 'releases' })).toBeNull();
    expect(resolveReleaseDir({ APP_RELEASE_DIR: './x' })).toBeNull();
    expect(resolveReleaseDir({ APP_RELEASE_DIR: '/x\0y' })).toBeNull();
  });
});

describe('releaseFilePath — 디렉터리 바로 아래만', () => {
  const dir = '/srv/app-releases';
  test('정상', () => expect(releaseFilePath(dir, 'stockinvest-1.0.0.apk')).toBe(path.join(dir, 'stockinvest-1.0.0.apk')));
  test.each(['../x.apk', '../../etc/passwd', 'sub/x.apk', '/abs/x.apk', '.', '..', 'x', ''])('거부 %j', (n) => expect(releaseFilePath(dir, n)).toBeNull());
  test('상대 디렉터리는 거부', () => expect(releaseFilePath('rel', 'x.apk')).toBeNull());
});
