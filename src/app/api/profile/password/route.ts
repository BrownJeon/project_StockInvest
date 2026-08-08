/**
 * POST /api/profile/password — 비밀번호 변경 (T-008 Step 1).
 * body: { currentPassword, newPassword }
 *
 * 현재 비밀번호를 반드시 재확인한다 (쿠키 탈취만으로 계정을 빼앗기지 않게).
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireUserId } from '@/lib/auth/current-user';
import { findUserById, updatePasswordHash } from '@/lib/auth/users';
import { hashPassword, validatePassword, verifyPassword } from '@/lib/auth/password';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUserId(req);
    if (!auth.ok) return auth.res;

    const body = await req.json().catch(() => ({})) as { currentPassword?: unknown; newPassword?: unknown };
    const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';

    const next = validatePassword(body.newPassword);
    if (!next.ok) return NextResponse.json({ ok: false, error: next.error }, { status: 400 });

    const user = await findUserById(auth.userId);
    if (!user) return NextResponse.json({ ok: false, error: '계정을 찾을 수 없습니다' }, { status: 401 });

    // OAuth 전용 계정은 확인할 "현재 비밀번호"가 없다 (T-009).
    // 여기서 비밀번호 설정을 허용하면 **쿠키만 가진 사람이 현재 비밀번호 확인 없이**
    // 비밀번호를 심을 수 있다 — 이 라우트가 막으려던 바로 그 시나리오다. 그래서 거부한다.
    if (user.passwordHash === null) {
      return NextResponse.json(
        { ok: false, error: '소셜 로그인으로 가입한 계정은 비밀번호를 사용하지 않습니다' },
        { status: 400 },
      );
    }

    if (!(await verifyPassword(current, user.passwordHash))) {
      return NextResponse.json({ ok: false, error: '현재 비밀번호가 올바르지 않습니다' }, { status: 400 });
    }
    if (current === next.password) {
      return NextResponse.json({ ok: false, error: '새 비밀번호가 기존과 동일합니다' }, { status: 400 });
    }

    await updatePasswordHash(user.id, await hashPassword(next.password));
    console.log(`[auth] 비밀번호 변경 user=${user.id}`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[api/profile/password]', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, error: '비밀번호를 변경하지 못했습니다' }, { status: 500 });
  }
}
