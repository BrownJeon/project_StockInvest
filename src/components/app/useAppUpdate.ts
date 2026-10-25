'use client';

/**
 * T-084 — 앱 버전 스토어 1개(TheKaiwa `useAppUpdate` 패턴). 업데이트 띠(루트 레이아웃)와 설정 › 앱 섹션이 같은 조회 결과를 쓴다.
 *
 *  - 앱 판별·설치 버전은 **마운트 뒤에** 읽는다(SSR·첫 렌더는 항상 "웹·모름" — 수화 불일치 없음).
 *  - 조회(`GET /api/app/version`)는 소비자가 요청할 때만 한다: 띠는 앱 + 인증 뒤 화면에서만, 설정 섹션은 웹·앱 모두.
 *    웹 브라우저의 띠는 요청도 하지 않는다(데모 B).
 *  - 첫 조회 1회 + 앞으로 돌아올 때(`visibilitychange`) 마지막 확인이 6시간 넘었으면 다시. 주기적 폴링 없음.
 *  - 같은 시점의 중복 요청은 하나로 합친다.
 *
 * ⚠ 표시 전용. 서버 권한 판단에 쓰지 않는다.
 */
import { useSyncExternalStore } from 'react';
import { getAppVersion, isNativeApp } from '@/lib/native/bridge';
import { parseVersionResponse, shouldRefetchOnResume, type VersionFetchResult } from './app-update-logic';

export type LoadState = 'idle' | 'loading' | 'ready';

export interface AppUpdateState {
  /** 마운트 뒤 앱 판별을 마쳤는가. false 면 아직 모름(SSR·첫 렌더) — 화면은 웹·로딩으로 다룬다. */
  detected: boolean;
  native: boolean;
  /** 설치된 앱 버전(앱일 때만). 앱인데 null 이면 App 플러그인이 없거나 값이 이상한 것. */
  current: { version: string; build: number } | null;
  /** 설치 버전 읽기를 마쳤는가(웹이면 판별 즉시 true). */
  currentLoaded: boolean;
  load: LoadState;
  result: VersionFetchResult | null;
  /** 마지막으로 조회를 마친 시각(ms). */
  checkedAt: number | null;
}

export interface AppUpdateDeps {
  isNative: () => boolean;
  getVersion: () => Promise<{ version: string; build: number } | null>;
  fetchVersion: () => Promise<{ status: number; body: unknown }>;
  now: () => number;
}

export const INITIAL_STATE: AppUpdateState = Object.freeze({
  detected: false,
  native: false,
  current: null,
  currentLoaded: false,
  load: 'idle',
  result: null,
  checkedAt: null,
}) as AppUpdateState;

export function createAppUpdateStore(deps: AppUpdateDeps) {
  let state: AppUpdateState = INITIAL_STATE;
  let inflight: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  function set(patch: Partial<AppUpdateState>) {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  }

  function detect(): void {
    if (state.detected) return;
    let native = false;
    try { native = deps.isNative(); } catch { native = false; }
    set({ detected: true, native, currentLoaded: !native });
    if (native) {
      deps.getVersion()
        .catch(() => null)
        .then((current) => set({ current, currentLoaded: true }));
    }
  }

  function fetchNow(): Promise<void> {
    if (inflight) return inflight;
    set({ load: 'loading' });
    inflight = deps.fetchVersion()
      .then(({ status, body }) => parseVersionResponse(status, body))
      .catch((): VersionFetchResult => ({ kind: 'error' }))
      .then((result) => {
        inflight = null;
        set({ load: 'ready', result, checkedAt: deps.now() });
      });
    return inflight;
  }

  return {
    getSnapshot: (): AppUpdateState => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    detect,
    /** 아직 조회한 적이 없을 때만 조회. */
    ensureLoaded(): Promise<void> | void {
      if (state.load === 'idle') return fetchNow();
    },
    /** [다시 확인]·[다시 시도] — 바로 다시 조회. */
    refresh: fetchNow,
    /** 앞으로 돌아왔을 때 — 6시간 규칙. 한 번도 조회하지 않은 소비자 화면에서는 아무것도 하지 않는다. */
    onResume(visible: boolean): Promise<void> | void {
      if (state.load === 'idle') return;
      if (shouldRefetchOnResume(state.checkedAt, deps.now(), visible)) return fetchNow();
    },
  };
}

export type AppUpdateStore = ReturnType<typeof createAppUpdateStore>;

async function fetchVersionFromServer(): Promise<{ status: number; body: unknown }> {
  const res = await fetch('/api/app/version', { cache: 'no-store', credentials: 'same-origin' });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

/** 앱 전체에서 하나만 쓴다. */
export const appUpdateStore = createAppUpdateStore({
  isNative: isNativeApp,
  getVersion: getAppVersion,
  fetchVersion: fetchVersionFromServer,
  now: () => Date.now(),
});

let resumeListenerInstalled = false;

/** 앱에서만 한 번 — 앞으로 돌아올 때 6시간 규칙으로 재조회. */
export function installResumeRefetch(store: AppUpdateStore = appUpdateStore): void {
  if (resumeListenerInstalled || typeof document === 'undefined') return;
  resumeListenerInstalled = true;
  document.addEventListener('visibilitychange', () => {
    store.onResume(document.visibilityState === 'visible');
  });
}

export function useAppUpdateState(store: AppUpdateStore = appUpdateStore): AppUpdateState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => INITIAL_STATE);
}
