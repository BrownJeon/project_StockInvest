/**
 * T-143 WP-B — 변경 이력의 「누가」 (구현 가이드 §5.1 `updatedBy`).
 *
 * **권한 판단이 아니다.** 인증은 전역 미들웨어(`src/middleware.ts`)가 이미 끝냈고(§4 공통 규칙), 여기서는
 * 이력에 남길 **이름표**만 만든다. 그래서 실패하면 막지 않고 `'web'` 으로 떨어진다.
 *
 * 왜 필요한가: 일괄 교체 성공 문구가 「변경 이력에 남았습니다」라고 말하고, D1=A 를 고른 근거의 절반이
 * 「누가·언제·무엇을」이다(`.env` 는 그것을 추적하지 못한다 — 데모 §1 비교표).
 * 1인 앱이라 보통 값은 하나뿐이지만, 나중에 WP-A 의 잡이 같은 표에 쓰면 `job:<id>` 와 구분된다.
 */
import { SESSION_COOKIE, getSessionSecret, verifySession } from '@/lib/auth/session';

export const ACTOR_FALLBACK = 'web';

export interface CookieReader {
  get(name: string): { value: string } | undefined;
}

/**
 * 이력에 남길 이름표 — `user:<users.id>` 또는 `'web'`.
 * 세션을 못 읽어도 **던지지 않는다**(라우트를 막지 않는다 — 막는 일은 미들웨어 몫이다).
 */
export async function actorLabel(cookies: CookieReader): Promise<string> {
  try {
    const secret = getSessionSecret();
    if (!secret) return ACTOR_FALLBACK;
    const token = cookies.get(SESSION_COOKIE)?.value;
    const r = await verifySession(token, secret);
    if (!r.ok) return ACTOR_FALLBACK;
    const sub = r.payload.sub;
    return typeof sub === 'number' && Number.isInteger(sub) && sub > 0 ? `user:${sub}` : ACTOR_FALLBACK;
  } catch {
    return ACTOR_FALLBACK;
  }
}
