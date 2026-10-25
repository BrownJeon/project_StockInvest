/**
 * T-084 — 앱 버전 스토어(가짜 의존성). 판별은 detect() 뒤에만 · 웹은 설치 버전을 읽지 않음 ·
 * 조회는 ensureLoaded 1회(중복 합침) · refresh 는 즉시 · onResume 은 6시간 규칙 · 실패는 오류 결과(던지지 않음).
 */
import { createAppUpdateStore, INITIAL_STATE, type AppUpdateDeps } from '../useAppUpdate';
import { REFRESH_AFTER_MS } from '../app-update-logic';

const LATEST = { versionCode: 2, versionName: '1.0.1', sizeBytes: 9_800_000, sha256: 'a'.repeat(64), notes: null, minSupported: 1, downloadUrl: '/app/download/latest.apk' };

function deps(over: Partial<AppUpdateDeps> = {}) {
  let t = Date.UTC(2026, 9, 25, 8, 0, 0);
  const fetchVersion = jest.fn(async () => ({ status: 200, body: { ok: true, latest: LATEST } }));
  const getVersion = jest.fn(async () => ({ version: '1.0.0', build: 1 }));
  const d: AppUpdateDeps & { advance: (ms: number) => void } = {
    isNative: () => true,
    getVersion,
    fetchVersion,
    now: () => t,
    advance: (ms) => { t += ms; },
    ...over,
  };
  return d;
}
const flush = () => new Promise((r) => setTimeout(r, 0));

test('첫 상태 = SSR 상태(웹·모름) — 수화 불일치 없음', () => {
  const s = createAppUpdateStore(deps());
  expect(s.getSnapshot()).toBe(INITIAL_STATE);
  expect(INITIAL_STATE).toMatchObject({ detected: false, native: false, load: 'idle', result: null });
});

test('앱: detect → 설치 버전 읽기 · ensureLoaded 는 한 번만(동시 호출 합침)', async () => {
  const d = deps();
  const s = createAppUpdateStore(d);
  const seen: string[] = [];
  s.subscribe(() => seen.push(s.getSnapshot().load));
  s.detect();
  s.detect();
  expect(s.getSnapshot()).toMatchObject({ detected: true, native: true, currentLoaded: false });
  await Promise.all([s.ensureLoaded(), s.ensureLoaded()]);
  await flush();
  expect(d.fetchVersion).toHaveBeenCalledTimes(1);
  expect(d.getVersion).toHaveBeenCalledTimes(1);
  expect(s.getSnapshot()).toMatchObject({ current: { version: '1.0.0', build: 1 }, currentLoaded: true, load: 'ready', result: { kind: 'ok', latest: LATEST } });
  s.ensureLoaded();
  expect(d.fetchVersion).toHaveBeenCalledTimes(1);
  expect(seen).toContain('loading');
});

test('웹: 설치 버전을 읽지 않고 currentLoaded=true', () => {
  const d = deps({ isNative: () => false });
  const s = createAppUpdateStore(d);
  s.detect();
  expect(s.getSnapshot()).toMatchObject({ detected: true, native: false, currentLoaded: true, current: null });
  expect(d.getVersion).not.toHaveBeenCalled();
});

test('판별 예외·설치 버전 예외는 삼킨다', async () => {
  const s = createAppUpdateStore(deps({ isNative: () => { throw new Error('x'); } }));
  s.detect();
  expect(s.getSnapshot().native).toBe(false);
  const s2 = createAppUpdateStore(deps({ getVersion: async () => { throw new Error('plugin'); } }));
  s2.detect();
  await flush();
  expect(s2.getSnapshot()).toMatchObject({ current: null, currentLoaded: true });
});

test('조회 실패(네트워크 예외)·401 은 오류 결과', async () => {
  const s = createAppUpdateStore(deps({ fetchVersion: async () => { throw new Error('offline'); } }));
  await s.ensureLoaded();
  expect(s.getSnapshot().result).toEqual({ kind: 'error' });
  const s2 = createAppUpdateStore(deps({ fetchVersion: async () => ({ status: 401, body: { ok: false } }) }));
  await s2.ensureLoaded();
  expect(s2.getSnapshot()).toMatchObject({ load: 'ready', result: { kind: 'error' } });
});

test('refresh 는 바로 다시 조회 · onResume 은 6시간 규칙 · 조회 전 화면에선 아무것도 안 함', async () => {
  const d = deps();
  const s = createAppUpdateStore(d);
  s.onResume(true);
  expect(d.fetchVersion).toHaveBeenCalledTimes(0);
  await s.ensureLoaded();
  await s.refresh();
  expect(d.fetchVersion).toHaveBeenCalledTimes(2);
  d.advance(REFRESH_AFTER_MS);
  s.onResume(true);
  expect(d.fetchVersion).toHaveBeenCalledTimes(2);
  d.advance(1);
  s.onResume(false);
  expect(d.fetchVersion).toHaveBeenCalledTimes(2);
  await s.onResume(true);
  expect(d.fetchVersion).toHaveBeenCalledTimes(3);
  expect(s.getSnapshot().checkedAt).toBe(Date.UTC(2026, 9, 25, 8, 0, 0) + REFRESH_AFTER_MS + 1);
});
