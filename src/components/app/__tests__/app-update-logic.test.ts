/**
 * T-084 — 앱 업데이트 판단 로직(순수 함수). 승인 데모 v1 B·C · 가이드 §4.
 * ① 버전 판정 ② KST 하루 키·✕ 숨김 ③ 재조회 규칙 ④ 표기·UA ⑤ 다운로드 주소 검증 + 서버 응답 해석.
 */
import {
  apkFileNameFor,
  bannerKind,
  createDismissStore,
  DISMISS_STORAGE_KEY,
  formatBytes,
  formatKstDateTime,
  isAndroidUserAgent,
  isDismissed,
  judgeUpdate,
  kstDayKey,
  noteLines,
  parseDismiss,
  parseVersionResponse,
  REFRESH_AFTER_MS,
  safeDownloadPath,
  shortHash,
  shouldRefetchOnResume,
  type KeyValueStorage,
} from '../app-update-logic';

const SHA = '3f9a1c7e'.padEnd(64, '0');
const LATEST = { versionCode: 2, versionName: '1.0.1', sizeBytes: 9_800_000, sha256: SHA, notes: '첫 줄\n둘째 줄', minSupported: 1, downloadUrl: '/app/download/latest.apk' };

describe('① 버전 판정 — versionCode 정수만', () => {
  test('필수 / 새 버전 / 최신 / 등록 없음 / 모름', () => {
    expect(judgeUpdate(1, { versionCode: 3, minSupported: 2 })).toBe('required');
    expect(judgeUpdate(1, { versionCode: 2, minSupported: 1 })).toBe('available');
    expect(judgeUpdate(2, { versionCode: 2, minSupported: 1 })).toBe('latest');
    expect(judgeUpdate(5, { versionCode: 2, minSupported: 1 })).toBe('latest');
    expect(judgeUpdate(1, null)).toBe('none');
    expect(judgeUpdate(null, { versionCode: 9, minSupported: 9 })).toBe('unknown');
  });
  test('minSupported 0(미지정)이면 필수가 아니다', () => {
    expect(judgeUpdate(1, { versionCode: 2, minSupported: 0 })).toBe('available');
  });
  test('띠 종류: 필수는 ✕ 기록과 무관하게 보임 · 새 버전은 닫으면 숨김 · 그 밖은 없음', () => {
    expect(bannerKind('required', true)).toBe('forced');
    expect(bannerKind('required', false)).toBe('forced');
    expect(bannerKind('available', false)).toBe('rec');
    expect(bannerKind('available', true)).toBeNull();
    for (const s of ['latest', 'none', 'unknown'] as const) expect(bannerKind(s, false)).toBeNull();
  });
});

describe('서버 응답 해석 (GET /api/app/version 실제 계약)', () => {
  test('정상 · 등록 없음(null)', () => {
    expect(parseVersionResponse(200, { ok: true, latest: LATEST })).toEqual({ kind: 'ok', latest: LATEST });
    expect(parseVersionResponse(200, { ok: true, latest: null })).toEqual({ kind: 'ok', latest: null });
  });
  test('503 not_migrated · 401 · 500 · 본문 없음', () => {
    expect(parseVersionResponse(503, { ok: false, error: 'not_migrated' })).toEqual({ kind: 'not_migrated' });
    expect(parseVersionResponse(401, { ok: false, error: 'unauthorized' })).toEqual({ kind: 'error' });
    expect(parseVersionResponse(500, { ok: false, error: 'server_error' })).toEqual({ kind: 'error' });
    expect(parseVersionResponse(200, null)).toEqual({ kind: 'error' });
    expect(parseVersionResponse(503, { ok: false, error: 'server_error' })).toEqual({ kind: 'error' });
  });
  test('형식이 어긋난 latest 는 오류로 다룬다(모르는 값으로 화면을 그리지 않음)', () => {
    const bad: Record<string, unknown>[] = [
      { ...LATEST, versionCode: '2x' },
      { ...LATEST, versionCode: 0 },
      { ...LATEST, versionName: '1.1' },
      { ...LATEST, sizeBytes: 0 },
      { ...LATEST, sha256: SHA.toUpperCase() },
      { ...LATEST, minSupported: -1 },
      { ...LATEST, downloadUrl: 5 },
      { ...LATEST, notes: 5 },
      { latestCode: 2 },
    ];
    for (const b of bad) expect(parseVersionResponse(200, { ok: true, latest: b })).toEqual({ kind: 'error' });
  });
  test('versionCode 숫자 문자열은 정수로 · notes 없음은 null · 500자 초과는 자름', () => {
    const r = parseVersionResponse(200, { ok: true, latest: { ...LATEST, versionCode: '2', notes: undefined } });
    expect(r).toEqual({ kind: 'ok', latest: { ...LATEST, versionCode: 2, notes: null } });
    const long = parseVersionResponse(200, { ok: true, latest: { ...LATEST, notes: 'x'.repeat(600) } });
    expect(long.kind === 'ok' && long.latest?.notes?.length).toBe(500);
  });
});

describe('② KST 하루 키 · ✕ 숨김', () => {
  test('KST 자정 경계 (UTC 14:59 → 같은 날, 15:00 → 다음 날)', () => {
    expect(kstDayKey(Date.UTC(2026, 9, 25, 14, 59, 59))).toBe('2026-10-25');
    expect(kstDayKey(Date.UTC(2026, 9, 25, 15, 0, 0))).toBe('2026-10-26');
    expect(kstDayKey(Date.UTC(2026, 11, 31, 15, 0, 0))).toBe('2027-01-01');
  });
  test('오늘 닫음 → 숨김 · 다음 날 → 다시 · 더 새 코드 → 다시', () => {
    const rec = { code: 2, day: '2026-10-25' };
    expect(isDismissed(rec, 2, '2026-10-25')).toBe(true);
    expect(isDismissed(rec, 2, '2026-10-26')).toBe(false);
    expect(isDismissed(rec, 3, '2026-10-25')).toBe(false);
    expect(isDismissed(null, 2, '2026-10-25')).toBe(false);
  });
  test('parseDismiss — 형식 밖은 null', () => {
    expect(parseDismiss('{"code":2,"day":"2026-10-25"}')).toEqual({ code: 2, day: '2026-10-25' });
    for (const raw of [null, '', 'x', '[]', '{"code":0,"day":"2026-10-25"}', '{"code":2,"day":"10/25"}', '{"code":2}']) {
      expect(parseDismiss(raw)).toBeNull();
    }
  });
  test('저장소: localStorage 에 {code, day} 1개 키', () => {
    const mem = new Map<string, string>();
    const ls: KeyValueStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => { mem.set(k, v); } };
    const st = createDismissStore(() => ls);
    expect(st.read()).toBeNull();
    st.write({ code: 3, day: '2026-10-25' });
    expect(JSON.parse(mem.get(DISMISS_STORAGE_KEY)!)).toEqual({ code: 3, day: '2026-10-25' });
    expect(createDismissStore(() => ls).read()).toEqual({ code: 3, day: '2026-10-25' });
  });
  test('저장소가 막히면(접근·읽기·쓰기 예외 / 없음) 이번 실행 동안 메모리', () => {
    const throwing: KeyValueStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); } };
    const a = createDismissStore(() => throwing);
    a.write({ code: 2, day: '2026-10-25' });
    expect(a.read()).toEqual({ code: 2, day: '2026-10-25' });
    const b = createDismissStore(() => { throw new Error('SecurityError'); });
    b.write({ code: 4, day: '2026-10-25' });
    expect(b.read()).toEqual({ code: 4, day: '2026-10-25' });
    const c = createDismissStore(() => null);
    expect(c.read()).toBeNull();
    c.write({ code: 5, day: '2026-10-25' });
    expect(c.read()).toEqual({ code: 5, day: '2026-10-25' });
  });
});

describe('③ 재조회 — 앞으로 돌아올 때 6시간 초과면', () => {
  const T = Date.UTC(2026, 9, 25, 8, 0, 0);
  test('보이지 않으면 안 함 · 확인한 적 없으면 함 · 6시간 이하면 안 함 · 초과면 함', () => {
    expect(shouldRefetchOnResume(T, T + REFRESH_AFTER_MS + 1, false)).toBe(false);
    expect(shouldRefetchOnResume(null, T, true)).toBe(true);
    expect(shouldRefetchOnResume(T, T + REFRESH_AFTER_MS, true)).toBe(false);
    expect(shouldRefetchOnResume(T, T + REFRESH_AFTER_MS + 1, true)).toBe(true);
    expect(REFRESH_AFTER_MS).toBe(6 * 60 * 60 * 1000);
  });
});

describe('④ 표기', () => {
  test('크기 — 1000 단위(안드로이드 "내 파일"과 같은 숫자)', () => {
    expect(formatBytes(9_800_000)).toBe('9.8MB');
    expect(formatBytes(3_177_907)).toBe('3.2MB');
    expect(formatBytes(850_000)).toBe('850KB');
    expect(formatBytes(512)).toBe('512B');
    expect(formatBytes(0)).toBe('—');
  });
  test('확인값 앞 8자 · KST 시각 · 파일 이름 규칙', () => {
    expect(shortHash(SHA)).toBe('3f9a1c7e');
    expect(formatKstDateTime(Date.UTC(2026, 9, 25, 8, 20))).toBe('10월 25일 17:20');
    expect(formatKstDateTime(Date.UTC(2026, 9, 25, 15, 5))).toBe('10월 26일 00:05');
    expect(apkFileNameFor('1.0.1')).toBe('stockinvest-1.0.1.apk');
    expect(apkFileNameFor('1.1')).toBeNull();
  });
  test('안드로이드 UA', () => {
    expect(isAndroidUserAgent('Mozilla/5.0 (Linux; Android 15; SM-S936N) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36')).toBe(true);
    expect(isAndroidUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130')).toBe(false);
    expect(isAndroidUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe(false);
    expect(isAndroidUserAgent('')).toBe(false);
    expect(isAndroidUserAgent(undefined)).toBe(false);
  });
  test('배포 메모 → 줄 목록', () => {
    expect(noteLines('키보드 수정\r\n- 연결 실패 문구 정리\n\n• 기타 ')).toEqual(['키보드 수정', '연결 실패 문구 정리', '기타']);
    expect(noteLines(null)).toEqual([]);
    expect(noteLines('')).toEqual([]);
  });
});

describe('⑤ 다운로드 주소 — 같은 출처 /app/download/ 아래만', () => {
  const O = 'https://stock.xn--lh0b87pnudm10a4vd.com';
  test('허용', () => {
    expect(safeDownloadPath('/app/download/latest.apk', O)).toBe('/app/download/latest.apk');
    expect(safeDownloadPath('/app/download/stockinvest-1.0.1.apk', O)).toBe('/app/download/stockinvest-1.0.1.apk');
  });
  test('거부 — 다른 출처·스킴·경로 이탈·인코딩·쿼리·형식 밖', () => {
    for (const u of [
      'https://evil.example/app/download/latest.apk',
      `${O}/app/download/latest.apk`,
      '//evil.example/app/download/latest.apk',
      'javascript:alert(1)',
      '/app/download/../api/orders',
      '/app/download/..%2fapi',
      '/app/download/%2e%2e/x.apk',
      '/app/download\\latest.apk',
      '/app/download/latest.apk?x=1',
      '/app/download/latest.apk#x',
      '/app/download/',
      '/app/download/latest.exe',
      '/app/download/a/b.apk',
      '/app/downloads/latest.apk',
      '/APP/download/latest.apk',
      '/app/download/ latest.apk',
      '',
      null,
      42,
    ]) {
      expect(safeDownloadPath(u, O)).toBeNull();
    }
  });
  test('출처가 비어 있으면(SSR) 거부', () => {
    expect(safeDownloadPath('/app/download/latest.apk', '')).toBeNull();
  });
});
