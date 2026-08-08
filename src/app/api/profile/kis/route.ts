/**
 * POST /api/profile/kis — 회원 KIS 계좌 연결 (T-008 Step 1, 사용자 결정 Q1).
 *
 * body: { appKey, appSecret, accountNo, accountProduct, mock }
 *
 * 순서가 곧 보안 요건이다:
 *   1) 입력 형식 검증
 *   2) 암호화 키(`CREDENTIALS_ENCRYPTION_KEY`) 사용 가능 여부 확인 — 없으면 저장 시도 자체를 안 한다
 *   3) **실제 KIS 토큰 발급으로 검증** — 실패하면 아무것도 저장하지 않는다 (검증 우회 경로 없음)
 *   4) 검증 통과분만 AES-256-GCM 암호화 후 저장
 *
 * 🔒 평문(App Key/Secret/계좌번호)은 응답·로그·에러 문자열 어디에도 나가지 않는다.
 *    응답에는 마스킹된 계좌번호만 담는다.
 *
 * ⚠️ 이 단계에서 저장된 자격증명은 **아직 매매에 쓰이지 않는다.** 엔진은 여전히 전역
 *    `.env` 계좌로 동작한다(Step 2·4에서 배선). 화면이 이 사실을 표시한다.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireUserId } from '@/lib/auth/current-user';
import { findUserById, saveKisCredentials } from '@/lib/auth/users';
import { encryptSecret, isEncryptionConfigured } from '@/lib/auth/secret-box';
import {
  maskAccountNo,
  validateKisAccountNo,
  validateKisProduct,
  verifyKisCredentials,
} from '@/lib/auth/kis-verify';

export const dynamic = 'force-dynamic';

/** App Key/Secret 은 KIS 발급 문자열 — 공백 없는 30~200자 정도. 형식만 거칠게 본다. */
function validateKeyLike(raw: unknown, label: string): { ok: true; value: string } | { ok: false; error: string } {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (v.length < 10 || v.length > 512) return { ok: false, error: `${label} 형식이 올바르지 않습니다` };
  if (/\s/.test(v)) return { ok: false, error: `${label}에 공백이 포함돼 있습니다` };
  return { ok: true, value: v };
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUserId(req);
    if (!auth.ok) return auth.res;

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    const appKey = validateKeyLike(body.appKey, 'App Key');
    if (!appKey.ok) return NextResponse.json({ ok: false, error: appKey.error }, { status: 400 });
    const appSecret = validateKeyLike(body.appSecret, 'App Secret');
    if (!appSecret.ok) return NextResponse.json({ ok: false, error: appSecret.error }, { status: 400 });
    const accountNo = validateKisAccountNo(body.accountNo);
    if (!accountNo.ok) return NextResponse.json({ ok: false, error: accountNo.error }, { status: 400 });
    const product = validateKisProduct(body.accountProduct);
    if (!product.ok) return NextResponse.json({ ok: false, error: product.error }, { status: 400 });
    if (typeof body.mock !== 'boolean') {
      return NextResponse.json({ ok: false, error: '계좌 종류(모의/실전)를 선택하세요' }, { status: 400 });
    }
    const mock = body.mock;

    // 암호화 키가 없으면 저장할 방법이 없다 — KIS 를 호출하기 전에 멈춘다
    // (호출해 놓고 저장 못 하면 KIS 의 "1분당 1회" 제한만 소모한다).
    if (!isEncryptionConfigured()) {
      return NextResponse.json(
        { ok: false, error: '서버에 CREDENTIALS_ENCRYPTION_KEY 가 설정되지 않아 키를 저장할 수 없습니다' },
        { status: 503 },
      );
    }

    const user = await findUserById(auth.userId);
    if (!user) return NextResponse.json({ ok: false, error: '계정을 찾을 수 없습니다' }, { status: 401 });

    // 실검증 — 여기를 통과하지 못하면 저장 경로로 갈 수 없다.
    const verified = await verifyKisCredentials({ appKey: appKey.value, appSecret: appSecret.value, mock });
    if (!verified.ok) {
      return NextResponse.json({ ok: false, error: verified.message }, { status: 400 });
    }

    await saveKisCredentials(user.id, {
      appKeyEnc: encryptSecret(appKey.value),
      appSecretEnc: encryptSecret(appSecret.value),
      accountNoEnc: encryptSecret(accountNo.value),
      accountProduct: product.value,
      mock,
      // 방금 발급받은 토큰을 회원 캐시에 넣어 둔다 — KIS 는 앱키당 1분에 1회만 발급하므로
      // 버리면 다음 사용 시점에 불필요한 재발급 대기를 유발한다.
      accessToken: verified.accessToken,
      accessTokenExpiresAt: verified.expiresAt,
    });

    console.log(`[auth] KIS 계좌 연결 완료 user=${user.id} mock=${mock}`);
    return NextResponse.json({
      ok: true,
      kis: {
        connected: true,
        mock,
        accountMasked: maskAccountNo(accountNo.value),
        accountProduct: product.value,
      },
    });
  } catch (e) {
    // 예외 메시지에 입력값이 섞일 수 있으므로 사용자에게는 고정 문구만 준다.
    console.error('[api/profile/kis] 연결 실패', e instanceof Error ? e.name : 'unknown');
    return NextResponse.json({ ok: false, error: 'KIS 연결 처리 중 오류가 발생했습니다' }, { status: 500 });
  }
}
