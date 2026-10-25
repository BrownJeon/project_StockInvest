/**
 * POST /api/auth/app-exchange — 앱 딥링크 코드 + PKCE verifier → 세션 쿠키 (T-088, TheKaiwa task-003f C1-1·REV-021 이식).
 *
 * 앱 WebView 가 `stockinvest://auth/callback?code=<code_r>` 를 받으면 로그인 시작 때 만든 verifier 와 함께 **JSON 본문**으로 보낸다
 * (`fetch(…, { method: 'POST', credentials: 'same-origin' })`). 여기서 `sha256(code_r + ":" + S256(verifier))` 로 행을 찾아 **소각**하고
 * 기존 `signSession` + `setSessionCookie`(세션 코드 불변)로 쿠키를 심은 뒤 `{ ok: true, next }`(같은 출처 경로만)를 돌려준다.
 * 화면 이동은 WebView 가 한다.
 *
 * ★ 인증 **이전** 단계라 미들웨어 공개 목록에 정확 일치 1개로 들어간다(`src/middleware.ts` PUBLIC_EXACT). 자격증명은 코드+verifier 이고
 *   같은 출처 JSON(로그인 CSRF 방어) → 본문 상한 → 형식 → 결속 값 재계산 → 조건부 UPDATE 1건 → 회원 조회 순으로만 권한이 생긴다.
 * ★ 모든 실패(출처·형식·verifier 불일치·만료·재사용·미존재·회원 없음·서버 설정 없음·DB 오류)는 **같은 400 `app_code_invalid`** 하나다
 *   — "그 코드는 있지만 이미 썼다" 같은 정보가 새지 않게. 원인은 서버 로그에도 남기지 않는다(코드·verifier 값 포함 금지).
 *   단, 요청 제한 초과만 429 다(코드에 관한 정보가 아니라 요청 빈도에 관한 응답).
 * ★ GET 은 405(쿼리스트링 교환 경로는 없다).
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSessionSecret, signSession } from '@/lib/auth/session';
import { setSessionCookie } from '@/lib/auth/session-cookie';
import { findUserById } from '@/lib/auth/users';
import { consumeAppAuthCode } from '@/lib/auth/oauth/app-code';
import { APP_CODE_INVALID } from '@/lib/auth/oauth/app-flow';
import { appExchangeLimiter, isSameOriginJsonRequest, parseAppExchangeBody, readBodyCapped } from '@/lib/auth/oauth/app-exchange';
import { clientIpKey } from '@/lib/auth/signup-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

function invalid(): NextResponse {
  return NextResponse.json({ ok: false, error: APP_CODE_INVALID }, { status: 400, headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  const limited = appExchangeLimiter.hit(clientIpKey(req.headers));
  if (!limited.ok) {
    return NextResponse.json(
      { ok: false, error: 'rate_limited' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(limited.retryAfterSec) } },
    );
  }
  try {
    if (!isSameOriginJsonRequest(req.headers)) return invalid();
    const secret = getSessionSecret();
    if (!secret) return invalid();

    const bytes = await readBodyCapped(req);
    if (!bytes) return invalid();
    const input = parseAppExchangeBody(bytes);
    if (!input) return invalid();

    const userId = await consumeAppAuthCode(input.code, input.verifier);
    if (userId === null) return invalid();
    // 코드 발급 뒤 교환 사이(최대 60초)에 회원이 지워졌으면 실패로 수렴.
    const user = await findUserById(userId);
    if (!user) return invalid();

    const token = await signSession(secret, user.id);
    const res = NextResponse.json({ ok: true, next: input.next }, { headers: NO_STORE });
    setSessionCookie(res, req, token);
    console.log(`[oauth] app 코드 교환 성공 user=${user.id}`);
    return res;
  } catch (e) {
    // 값(코드·verifier)은 남기지 않는다 — 오류 종류만.
    console.error('[oauth] app-exchange 오류:', e instanceof Error ? e.name : 'unknown');
    return invalid();
  }
}

export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: 'POST', ...NO_STORE } });
}
