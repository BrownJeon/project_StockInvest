/**
 * GET /api/profile — 로그인 회원의 계정·KIS 연결 상태·안전장치 설정 (T-008 Step 1).
 *
 * 🔒 KIS App Key/Secret 은 **어떤 경우에도 응답에 담지 않는다.** 계좌번호도 마스킹만 내려간다
 *    (복호화 값은 이 요청의 메모리 안에서만 존재한다).
 *
 * `engineWired: false` 를 항상 함께 내려보낸다 — 화면이 "저장했으니 적용됐다"는
 * 착각을 만들지 않도록, 배선 여부를 데이터로 못박는다(Step 4에서 true 가 된다).
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireUserId } from '@/lib/auth/current-user';
import { SESSION_COOKIE } from '@/lib/auth/session';
import { findUserById, getUserSettings } from '@/lib/auth/users';
import { decryptSecret, isEncryptionConfigured } from '@/lib/auth/secret-box';
import { maskAccountNo } from '@/lib/auth/kis-verify';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireUserId(req);
    if (!auth.ok) return auth.res;

    const user = await findUserById(auth.userId);
    if (!user) {
      // 세션은 유효하지만 회원이 삭제된 경우 — 쿠키를 정리하고 재로그인시킨다.
      const res = NextResponse.json({ ok: false, error: 'unauthorized', detail: '계정을 찾을 수 없습니다' }, { status: 401 });
      res.cookies.set({ name: SESSION_COOKIE, value: '', httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
      return res;
    }

    const settings = await getUserSettings(user.id);
    const connected = !!(user.kisAppKeyEnc && user.kisAppSecretEnc && user.kisAccountNoEnc);

    let accountMasked: string | null = null;
    let credentialError = false;
    if (connected && user.kisAccountNoEnc) {
      try {
        accountMasked = maskAccountNo(decryptSecret(user.kisAccountNoEnc));
      } catch {
        // 키 교체·손상 — 사실대로 알린다. "연결됨"으로 표시하고 조용히 넘어가면 거짓말이 된다.
        credentialError = true;
        console.error(`[api/profile] KIS 자격증명 복호화 실패 user=${user.id}`);
      }
    }

    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt,
      },
      kis: {
        connected,
        mock: user.kisMock,
        accountMasked,
        accountProduct: user.kisAccountProduct,
        connectedAt: user.kisConnectedAt,
        credentialError,
        encryptionConfigured: isEncryptionConfigured(),
      },
      settings,
      // ⚠️ Step 4 전까지 이 값들은 매매 엔진에 연결되지 않는다. 실제로 적용 중인 것은
      //    전역 .env / system_config 다. 화면은 이 플래그를 근거로 경고를 띄운다.
      engineWired: false,
    });
  } catch (e) {
    console.error('[api/profile]', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, error: '프로필을 불러오지 못했습니다' }, { status: 500 });
  }
}
