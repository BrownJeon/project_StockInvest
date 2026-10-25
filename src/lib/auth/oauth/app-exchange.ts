/**
 * T-088 — `POST /api/auth/app-exchange` 요청 판정(순수 함수 + 본문 상한 읽기). TheKaiwa `infra/auth/oauth/app-exchange.ts` 이식.
 *
 * 교환은 GET 쿼리스트링이 아니라 **POST JSON 본문**이다 — `code`·`verifier` 가 nginx 접근 로그·WebView 방문 기록에 남지 않게(RFC 8252 관례,
 * TheKaiwa REV-021). 세션 쿠키를 심는 POST 라 로그인 CSRF(남의 사이트가 공격자 코드로 피해자 WebView 를 공격자 계정에 로그인시키기)를 막는다:
 *   ① `Content-Type: application/json` 만 — HTML 폼은 이 형식을 보낼 수 없고, 교차 출처 fetch 는 CORS 사전 요청에서 막힌다
 *   ② `Origin` **필수**이고 서비스의 공개 주소(`OAUTH_CALLBACK_BASE`)의 출처와 같아야 한다 — 크롬(WebView 포함)은 같은 출처 POST 에도 Origin 을 붙인다
 *   ③ `Sec-Fetch-Site` 가 있으면 `same-origin` 이어야 한다
 * TheKaiwa 는 Origin·Sec-Fetch-Site 중 하나만 있어도 받고 Host 헤더와 비교한다. 여기서는 **더 엄격하게** Origin 을 필수로 하고 공개 주소와 비교한다
 * (앱 로그인이 성립하려면 Chrome 창의 state 쿠키가 콜백 주소에 실려야 하므로, WebView 출처 = 콜백 공개 주소여야 한다 — 다른 출처는 정상 흐름에 없다).
 */
import type { NextRequest } from 'next/server';
import { getCallbackBase } from '@/lib/auth/oauth/config';
import { sanitizeAppNextPath } from '@/lib/auth/oauth/app-flow';
import { createFixedWindowLimiter } from '@/lib/app-release/rate-limit';

/** 본문 상한 — code 64 + verifier 43 + next 512 + JSON 문법이면 1KB 미만이다. */
export const APP_EXCHANGE_MAX_BODY = 2 * 1024;

function originOf(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** 같은 출처에서 온 JSON 요청인가. 공개 주소가 설정돼 있지 않으면(=OAuth 미설정) 항상 false. */
export function isSameOriginJsonRequest(headers: Headers, callbackBase: string | null = getCallbackBase()): boolean {
  const type = (headers.get('content-type') ?? '').trim();
  if (!/^application\/json(\s*;|$)/i.test(type)) return false;
  if (callbackBase === null) return false;
  const expected = originOf(callbackBase);
  if (expected === null) return false;
  const origin = headers.get('origin');
  if (!origin || originOf(origin) !== expected || origin !== expected) return false;
  const site = headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') return false;
  return true;
}

/**
 * 본문을 상한까지만 읽는다. `content-length` 가 상한을 넘거나, 헤더 없이(chunked) 흘러온 바이트가 상한을 넘으면 null.
 * `req.json()` 은 상한 없이 전부 버퍼링하므로 쓰지 않는다(`request-limits.ts` 의 한계 — chunked 를 못 잡음 — 를 여기서는 스트림으로 막는다).
 */
export async function readBodyCapped(req: Pick<NextRequest, 'headers' | 'body'>, max: number = APP_EXCHANGE_MAX_BODY): Promise<Uint8Array | null> {
  const declared = req.headers.get('content-length');
  if (declared !== null) {
    const n = Number(declared);
    if (!Number.isFinite(n) || n < 0 || n > max) return null;
  }
  const body = req.body;
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > max) {
        void reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  if (total === 0) return null;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

export interface AppExchangeInput {
  code: unknown;
  verifier: unknown;
  next: string;
}

/**
 * 본문 바이트 → 교환 입력. JSON 객체가 아니거나 알 수 없는 키가 있으면 null(형식 판정의 나머지 — 64 hex·43자 — 는 `consumeAppAuthCode`).
 * `next` 는 같은 출처 경로만(`sanitizeAppNextPath`).
 */
export function parseAppExchangeBody(bytes: Uint8Array): AppExchangeInput | null {
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const o = body as Record<string, unknown>;
  for (const k of Object.keys(o)) if (k !== 'code' && k !== 'verifier' && k !== 'next') return null;
  if (o.next !== undefined && typeof o.next !== 'string') return null;
  return { code: o.code, verifier: o.verifier, next: sanitizeAppNextPath(o.next) };
}

/**
 * IP별 요청 제한(코드 추측·DB 부하 방지). 코드는 256비트 랜덤이라 추측 자체는 불가능하고, 이 제한은 남용 속도만 늦춘다.
 * 정상 사용은 로그인 1회당 1건(실패 후 [Chrome 창 다시 열기]까지 쳐도 분당 몇 건)이다.
 * 한계(`rate-limit.ts` 와 같음): 프로세스 메모리 — 재시작·배포 때 초기화, 인스턴스마다 따로, 고정 창이라 경계에서 최대 2배.
 * 헤더 없이 :3003 직결이면 전부 'unknown' 한 버킷이다. 더 강한 제한이 필요하면 nginx `limit_req`(HOME-SERVER 영역).
 */
export const APP_EXCHANGE_LIMIT_PER_MIN = 10;
export const appExchangeLimiter = createFixedWindowLimiter({ limit: APP_EXCHANGE_LIMIT_PER_MIN, windowMs: 60_000, maxKeys: 5_000 });
