/**
 * T-088 — 앱(주식캐기) Google 로그인의 WebView 쪽 **로직**(화면 아님). TheKaiwa `infra/native/appLogin.ts` 를 StockInvest 구조로 옮김.
 *
 * 흐름: [Google로 계속하기] → `prepareAppLogin(next)` 가 PKCE 쌍을 만들어 verifier 를 보관하고 시작 주소(challenge 포함)를 돌려준다
 *   → `openAppLogin(주소)` 가 Chrome 창(Custom Tab)으로 연다 → 로그인 → 서버가 `stockinvest://auth/callback?code=` 로 앱을 부른다
 *   → `onAuthDeepLink` 가 딥링크를 받아 넘기면 화면이 `completeAppLogin(code)` 를 부른다 → verifier 를 **꺼내면서 지우고**
 *   `POST /api/auth/app-exchange`(JSON, 같은 출처) → 성공이면 같은 출처 착지 경로(next) — 화면이 `location.replace(next)`.
 *
 * 보관: verifier 는 **WebView 메모리 + sessionStorage**(Chrome 창에서 돌아올 때 WebView 가 다시 그려져도 남게)에만 둔다. URL·로그·서버에는
 * 보내지 않는다(서버에는 challenge 만, 교환 때 본문으로 한 번). 10분이 지나면 버린다. 앱 프로세스가 죽으면 sessionStorage 도 사라진다 —
 * 그때는 `completeAppLogin` 이 `no_verifier` 를 돌려주고 화면이 다시 로그인하라고 안내한다.
 *
 * ⚠ `@capacitor/*` 를 import 하지 않는다(브리지 `window.Capacitor` 만 — `./bridge`). ⚠ 앱 판별은 화면 표시용이다 — 서버는 이것을 믿지 않는다
 *   (서버 쪽 앱 판정은 서명된 state 뿐).
 */
import { addAppUrlOpenListener, getLaunchUrl, isNativeApp, openExternal } from './bridge';
import {
  APP_CODE_PATTERN,
  APP_EXCHANGE_PATH,
  parseAppDeepLink,
  sanitizeAppNextPath,
  type ParsedAppDeepLink,
} from '@/lib/auth/oauth/app-flow';

const STORAGE_KEY = 'stockinvest_app_login';
const HANDLED_KEY = 'stockinvest_app_login_handled';
const HANDLED_MAX = 20;
export const APP_LOGIN_TTL_MS = 10 * 60 * 1000;
/** 시작 라우트(앱은 Google 만). */
export const APP_LOGIN_START_PATH = '/api/auth/google';
const VERIFIER = /^[A-Za-z0-9_-]{43}$/;

interface Pending {
  verifier: string;
  next: string;
  at: number;
}

let memory: Pending | null = null;
const handledMemory = new Set<string>();

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/** RFC 7636 S256 쌍 — verifier 는 32바이트 랜덤의 base64url(43자). Web Crypto 가 없으면(비보안 컨텍스트) 던진다. */
export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const verifier = b64url(raw);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

function save(p: Pending): void {
  memory = p;
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // 저장소가 막혀 있어도 메모리 값으로 대부분 돌아온다(WebView 가 다시 그려지지 않는 한)
  }
}

/**
 * 앱 로그인 준비 — PKCE 쌍을 만들어 verifier 를 보관하고 Chrome 창으로 열 **절대 주소**를 돌려준다.
 * 앱이 아니거나 Web Crypto 가 없으면 null(화면은 버튼을 보이지 않거나 일반 링크로 둔다).
 * [Chrome 창 다시 열기]는 돌려받은 **같은 주소**를 다시 연다(같은 verifier 로 짝이 맞는다 — 새로 준비하면 이전 verifier 는 덮인다).
 */
export async function prepareAppLogin(next: string | null | undefined): Promise<string | null> {
  if (!isNativeApp()) return null;
  let pair: { verifier: string; challenge: string };
  try {
    pair = await createPkcePair();
  } catch {
    return null;
  }
  const safeNext = sanitizeAppNextPath(next ?? '/');
  save({ verifier: pair.verifier, next: safeNext, at: Date.now() });
  const qs = new URLSearchParams({ platform: 'app', challenge: pair.challenge });
  if (safeNext !== '/') qs.set('next', safeNext);
  try {
    return new URL(`${APP_LOGIN_START_PATH}?${qs.toString()}`, window.location.origin).toString();
  } catch {
    return null;
  }
}

/**
 * 돌아온 딥링크와 짝지을 verifier(+ 착지 경로) — **꺼내면서 지운다**(두 번째 호출은 null). 10분 지났거나 형식이 다르면 null.
 */
export function takeAppLoginVerifier(now: number = Date.now()): { verifier: string; next: string } | null {
  let entry = memory;
  memory = null;
  const st = storage();
  try {
    if (!entry && st) {
      const raw = st.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Partial<Pending> | null) : null;
      if (parsed && typeof parsed.verifier === 'string' && typeof parsed.at === 'number') {
        entry = { verifier: parsed.verifier, next: typeof parsed.next === 'string' ? parsed.next : '/', at: parsed.at };
      }
    }
  } catch {
    // 깨진 값 — 아래에서 지운다
  }
  try {
    st?.removeItem(STORAGE_KEY);
  } catch {
    // 저장소 접근 실패 — 메모리 값만 본다
  }
  if (!entry || !VERIFIER.test(entry.verifier) || !Number.isFinite(entry.at) || now < entry.at || now - entry.at > APP_LOGIN_TTL_MS) return null;
  return { verifier: entry.verifier, next: sanitizeAppNextPath(entry.next) };
}

/** 대기 중인 로그인을 버린다([취소]). */
export function cancelAppLogin(): void {
  memory = null;
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // 무시
  }
}

/** Chrome 창(Custom Tab)으로 연다. Browser 플러그인이 없거나 https 가 아니면 false(WebView 안 Google 로그인은 Google 이 거부한다). */
export function openAppLogin(href: string): Promise<boolean> {
  return openExternal(href);
}

/**
 * 교환 요청 제한 시간 — 서버·망이 응답 없이 멈추면 "로그인 마무리 중" 덮개(본문 inert)가 영영 안 걷혀 앱을 강제 종료하는 수밖에 없다(T-088 R-U F1).
 * 응답 **본문을 읽는 시간까지** 포함한다. 넘기면 다른 실패와 같은 `null`(→ `exchange_failed` → 오류 상자 `app_code_invalid`)이다.
 */
export const APP_EXCHANGE_TIMEOUT_MS = 15_000;

/** 교환 요청 한 번(제한 시간은 바깥에서). 어떤 이유로든 실패하면 null — 던지지 않는다. */
async function requestExchange(code: string, verifier: string, next: string | null, signal: AbortSignal | undefined): Promise<string | null> {
  try {
    const res = await fetch(APP_EXCHANGE_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, verifier, ...(next ? { next: sanitizeAppNextPath(next) } : {}) }),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { ok?: unknown; next?: unknown } | null;
    if (body?.ok !== true || typeof body.next !== 'string') return null;
    const n = sanitizeAppNextPath(body.next);
    return n === body.next ? n : null;
  } catch {
    return null;
  }
}

/**
 * 딥링크 코드 + verifier → 세션(POST JSON). 쿼리스트링을 쓰지 않아 코드·verifier 가 접근 로그·방문 기록에 남지 않는다.
 * 성공이면 서버가 돌려준 같은 출처 착지 경로(한 번 더 검사), 실패(어떤 이유든 — 시간 초과·네트워크 오류·중단 포함)면 null. 세션 쿠키는 이 응답의 Set-Cookie 로 WebView 에 심긴다.
 *
 * 제한 시간(`APP_EXCHANGE_TIMEOUT_MS`): `AbortController` 로 요청을 끊고 **동시에** 타이머 Promise 와 경합시킨다 — `AbortSignal.timeout` 이 없는 구형 WebView,
 * 신호를 무시하는 `fetch` 구현에서도 대기가 끝난다. 타이머는 어떤 경로로 끝나든 `finally` 에서 해제한다(남은 타이머가 앱·시험을 붙잡지 않게).
 */
export async function exchangeAppCode(code: string, verifier: string, next: string | null): Promise<string | null> {
  if (!APP_CODE_PATTERN.test(code) || !VERIFIER.test(verifier)) return null;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      try {
        controller?.abort();
      } catch {
        // 중단 실패는 무시 — 아래 경합이 이미 null 로 끝난다
      }
      resolve(null);
    }, APP_EXCHANGE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([requestExchange(code, verifier, next, controller?.signal), timedOut]);
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export type CompleteAppLoginResult =
  | { ok: true; next: string }
  /** verifier 가 없다(10분 초과·앱 프로세스 재시작·이미 처리함) — 다시 로그인 안내 */
  | { ok: false; reason: 'no_verifier' }
  /** 교환 실패(만료·재사용·네트워크 등 — 서버는 사유를 구분해 알려주지 않는다) */
  | { ok: false; reason: 'exchange_failed' };

/** 딥링크 코드로 로그인을 마무리한다. verifier 는 성공·실패와 무관하게 이 호출에서 소모된다(1회용). */
export async function completeAppLogin(code: string): Promise<CompleteAppLoginResult> {
  const pending = takeAppLoginVerifier();
  if (!pending) return { ok: false, reason: 'no_verifier' };
  const next = await exchangeAppCode(code, pending.verifier, pending.next);
  return next === null ? { ok: false, reason: 'exchange_failed' } : { ok: true, next };
}

// ── 딥링크 수신 ──────────────────────────────────────────────────────────────

/** 처리한 딥링크 기록용 짧은 지문(FNV-1a 32비트). 코드 원문을 저장소에 남기지 않으려는 것 — 보안 경계가 아니라 중복 제거용이다. */
function fingerprint(url: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < url.length; i += 1) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function readHandled(): string[] {
  try {
    const raw = storage()?.getItem(HANDLED_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string' && /^[0-9a-f]{8}$/.test(x)) : [];
  } catch {
    return [];
  }
}

/** 콜드 스타트 주소를 이미 처리했으면 true, 아니면 sessionStorage 에 기록하고 false(페이지를 다시 불러와도 유지). */
function launchAlreadyHandled(fp: string): boolean {
  const list = readHandled();
  if (list.includes(fp)) return true;
  try {
    storage()?.setItem(HANDLED_KEY, JSON.stringify([...list, fp].slice(-HANDLED_MAX)));
  } catch {
    // 저장 실패 — 아래 메모리 기록이 같은 페이지 수명 동안은 막는다
  }
  return false;
}

/**
 * 로그인 딥링크 구독 + **콜드 스타트 보정**. 돌려준 함수로 해제한다. 앱이 아니면 아무것도 하지 않는다.
 *
 * - 앱이 떠 있을 때 돌아오면 `appUrlOpen`, 앱이 꺼져 있다가 딥링크로 깨어나면 WebView 가 웹을 받기 전에 그 이벤트가 지나갈 수 있으므로
 *   `getLaunchUrl()` 로 한 번 더 확인한다. 둘이 **같은 주소**를 줄 수 있다 → 코드 딥링크는 같은 코드를 한 번만 넘긴다
 *   (두 번 넘기면 두 번째 `completeAppLogin` 이 verifier 없음으로 실패해 성공 화면을 덮는다).
 * - `getLaunchUrl()` 은 **같은 프로세스 동안 계속 같은 값**을 준다(Capacitor 는 새 딥링크로 바꾸지 않는다 — [가능성 높음], 실기기 미확인).
 *   로그인 뒤 페이지를 다시 불러올 때마다 옛 주소를 다시 처리하지 않도록, 콜드 스타트 주소의 지문을 sessionStorage 에 남겨 **한 번만** 넘긴다.
 * - `appUrlOpen` 의 오류 딥링크(`?error=`)는 매번 넘긴다 — 같은 페이지에서 두 번 취소해도 두 번째 안내가 나와야 한다.
 * - 로그인 콜백 주소(`stockinvest://auth/callback`)가 아니면 무시한다.
 */
export function onAuthDeepLink(handler: (r: NonNullable<ParsedAppDeepLink>) => void): () => void {
  if (!isNativeApp()) return () => {};
  let disposed = false;
  const consider = (url: string, source: 'open' | 'launch') => {
    if (disposed) return;
    const parsed = parseAppDeepLink(url);
    if (parsed === null) return;
    const fp = fingerprint(url);
    if (source === 'launch' && launchAlreadyHandled(fp)) return;
    if (parsed.kind === 'code') {
      if (handledMemory.has(fp)) return;
      handledMemory.add(fp);
    }
    handler(parsed);
  };
  const unsubscribe = addAppUrlOpenListener((url) => consider(url, 'open'));
  void getLaunchUrl().then((url) => {
    if (url !== null) consider(url, 'launch');
  });
  return () => {
    disposed = true;
    unsubscribe();
  };
}

/** 시험용 — 모듈 메모리 초기화. */
export function __resetAppLoginForTest(): void {
  memory = null;
  handledMemory.clear();
}
