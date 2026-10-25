'use client';

/**
 * 앱 로그인 딥링크 수신·마무리 (T-088, 승인 데모 v2 C 절 "마무리 중") — **화면 요소는 마무리 중 덮개뿐**이다.
 *
 * Chrome 창에서 Google 로그인을 마치면 서버 콜백이 `stockinvest://auth/callback?code=…`(또는 `?error=…`) 로 앱을 부른다.
 * 앱이 떠 있었으면 `appUrlOpen`, 꺼져 있다가 깨어났으면 콜드 스타트 주소(`getLaunchUrl`)로 이 컴포넌트가 받는다(`onAuthDeepLink` — appLogin.ts 가
 * 두 경로의 중복을 걸러 준다. **구독자는 이 컴포넌트 하나뿐이어야 한다** — 중복 기록이 모듈 전역이라 둘이면 한쪽이 가로챈다).
 *   · `code`  → 덮개를 올리고 verifier 를 꺼내 `POST /api/auth/app-exchange` → 성공이면 같은 출처 착지 경로로 `location.replace`
 *               (뒤로가기로 로그인 화면에 돌아오지 않는다). 실패는 `/login?oauth_error=app_code_invalid`,
 *               verifier 가 없으면(앱이 꺼졌다 켜짐·10분 지남·이미 처리) 서버에 묻지 않고 `app_verifier_lost`.
 *   · `error` → `/login?oauth_error=<고정 코드>` 로 이동(화면을 새로 그려 맨 위 오류 상자로 안내).
 * 대기 카드를 푸는 `OAuthButtons` 에는 신호(`appLoginSignal`)만 보낸다 — 값(코드·verifier)은 싣지 않는다. 코드·verifier 를 state·화면·콘솔·주소 어디에도 그리지 않는다.
 *
 * 덮개: 화면 전체(`position: fixed`) + 가운데 회전 표시 + "로그인 마무리 중…". 덮개가 떠 있는 동안 페이지 본문(body 의 다른 자식)은 `inert` + `aria-hidden` 으로
 * 막고(두 번 누를 곳이 없다 — 구형 WebView 가 `inert` 를 무시해도 읽기 장치에서는 가려진다) 덮개로 포커스를 옮긴다. 이동할 때까지 유지한다.
 * 앱이 아니면(웹) `onAuthDeepLink` 가 아무것도 구독하지 않으므로 이 컴포넌트는 그리지도 요청하지도 않는다. ⚠ 앱 판별은 화면 표시 전용 — 서버는 믿지 않는다.
 */
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { onAuthDeepLink, completeAppLogin, takeAppLoginVerifier } from '@/lib/native/appLogin';
import type { CompleteAppLoginResult } from '@/lib/native/appLogin';
import { notifyAppLoginLink } from '@/lib/native/appLoginSignal';
import { sanitizeAppNextPath } from '@/lib/auth/oauth/app-flow';

export const APP_DEEP_LINK_COPY = {
  title: '로그인 마무리 중…',
  sub: '잠시만 기다려 주세요.',
} as const;

/** `/login?oauth_error=<코드>[&next=<착지 경로>]` — next 는 같은 출처 경로만(`sanitizeAppNextPath`), 기본값('/')이면 붙이지 않는다. */
export function loginErrorHref(error: string, next: string | null | undefined): string {
  const n = sanitizeAppNextPath(next ?? '/');
  return `/login?oauth_error=${encodeURIComponent(error)}${n !== '/' ? `&next=${encodeURIComponent(n)}` : ''}`;
}

/** 교환 결과 → 이동할 주소. 성공은 착지 경로, 실패는 오류 코드를 단 로그인 화면(데모 D). */
export function finishDestination(result: CompleteAppLoginResult, fallbackNext: string | null | undefined): string {
  if (result.ok) return result.next;
  return loginErrorHref(result.reason === 'no_verifier' ? 'app_verifier_lost' : 'app_code_invalid', fallbackNext);
}

interface HiddenLike {
  inert?: boolean;
  contains: (other: unknown) => boolean;
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
}

/**
 * body 의 다른 자식(페이지 본문·토스트 등)을 `inert` + `aria-hidden="true"` 로 막고, 되돌리는 함수를 돌려준다(원래 값 복원).
 * `inert` 만으로는 구형 WebView 에서 읽기 장치가 뒤 내용을 계속 읽을 수 있어 둘을 함께 건다(데모 a11y Minor-2).
 */
export function lockBackground(body: { children: ArrayLike<HiddenLike> }, host: unknown): () => void {
  const changed: { el: HiddenLike; prevInert: boolean; prevHidden: string | null }[] = [];
  for (const el of Array.from(body.children)) {
    if (el === host || el.contains(host)) continue;
    changed.push({ el, prevInert: !!el.inert, prevHidden: el.getAttribute('aria-hidden') });
    el.inert = true;
    el.setAttribute('aria-hidden', 'true');
  }
  return () => {
    for (const c of changed) {
      c.el.inert = c.prevInert;
      if (c.prevHidden === null) c.el.removeAttribute('aria-hidden');
      else c.el.setAttribute('aria-hidden', c.prevHidden);
    }
  };
}

export const APP_DEEP_LINK_CSS = `
.oal-cover { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; background: var(--bg); padding: 24px; text-align: center; }
.oal-cover[tabindex="-1"]:focus { outline: none; }
.oal-cover-in { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.oal-cover-t { display: flex; align-items: center; gap: 10px; font-size: 15px; color: var(--text); }
.oal-cover-s { font-size: 12px; color: var(--muted); }
.oal-cover-spin { display: inline-block; flex: none; width: 24px; height: 24px; border: 2px solid var(--border2); border-top-color: var(--accent); border-radius: 50%; animation: ti-spin .8s linear infinite; }
@media (prefers-reduced-motion: reduce) { .oal-cover-spin { animation: none; border-top-color: var(--border2); } }
`;

/** 마무리 중 덮개(그리기 전용). `role="status"` + `aria-busy` — 나타날 때 `AppDeepLink` 가 포커스를 옮긴다. */
export function AppLoginCover({ coverRef }: { coverRef?: RefObject<HTMLDivElement> }) {
  return (
    <>
      {/* 스타일은 알림 영역(role=status) 밖에 둔다 — 읽기 장치가 CSS 글자를 알림 내용으로 읽지 않게 */}
      <style dangerouslySetInnerHTML={{ __html: APP_DEEP_LINK_CSS }} />
      <div
        ref={coverRef}
        className="oal-cover"
        role="status"
        aria-live="polite"
        aria-busy="true"
        tabIndex={-1}
        data-app-login="exchanging"
      >
        <div className="oal-cover-in">
          <span className="oal-cover-t">
            <span className="oal-cover-spin" aria-hidden />
            {APP_DEEP_LINK_COPY.title}
          </span>
          <span className="oal-cover-s">{APP_DEEP_LINK_COPY.sub}</span>
        </div>
      </div>
    </>
  );
}

export function AppDeepLink({ nextPath }: { nextPath?: string }) {
  const [finishing, setFinishing] = useState(false);
  const finishingRef = useRef(false);
  const nextRef = useRef<string | undefined>(nextPath);
  const coverRef = useRef<HTMLDivElement>(null);

  useEffect(() => { nextRef.current = nextPath; }, [nextPath]);

  useEffect(() => {
    return onAuthDeepLink((link) => {
      if (finishingRef.current) return; // 이미 마무리·이동 중 — 한 번만 처리
      finishingRef.current = true;
      notifyAppLoginLink(link.kind);
      if (link.kind === 'error') {
        // 흐름이 끝났다 — 검증값을 지우면서 처음 가려던 경로를 되살려 오류 화면에 붙인다(없으면 이 화면의 next).
        const pending = takeAppLoginVerifier();
        window.location.replace(loginErrorHref(link.error, pending?.next ?? nextRef.current));
        return;
      }
      setFinishing(true);
      completeAppLogin(link.code)
        .then((result) => { window.location.replace(finishDestination(result, nextRef.current)); })
        .catch(() => { window.location.replace(loginErrorHref('app_code_invalid', nextRef.current)); });
    });
  }, []);

  // 덮개가 뜨면: 포커스를 덮개로, 본문은 inert + aria-hidden. (이동하면 페이지가 사라지므로 되돌림은 정리용)
  useEffect(() => {
    if (!finishing) return undefined;
    const el = coverRef.current;
    if (!el) return undefined;
    el.focus();
    return lockBackground(document.body as unknown as { children: ArrayLike<HiddenLike> }, el);
  }, [finishing]);

  if (!finishing || typeof document === 'undefined') return null;
  return createPortal(<AppLoginCover coverRef={coverRef} />, document.body);
}
