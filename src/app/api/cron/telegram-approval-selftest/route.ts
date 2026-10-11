/**
 * 텔레그램 버튼 승인 **자가 점검** (T-042).
 *
 * 거래를 일으키지 않는 버튼이 달린 시험 메시지를 소유자 채팅으로 보낸다. 버튼을 누르면 폴러가 콜백을 받아
 * 발신자·서명을 검증하고 "자가 점검 통과"로 메시지를 바꾼다 — 즉 **버튼 → 수신 → 검증 → 응답** 사슬 전체를
 * 실제 시그널·주문 없이 확인한다. `telegram_approval_enabled` 를 켜기 전에 반드시 이걸 먼저 통과시킨다.
 *
 * 인증: `/api/cron/*` 공통(`x-cron-secret`). 정기 크론에는 등록하지 않는다 — 사람이 필요할 때 한 번 호출한다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cron-auth';
import { getPool } from '@/lib/db';
import { getSessionSecret } from '@/lib/auth/session';
import { sendTelegramMessage } from '@/lib/notify/telegram-api';
import { renderSelfTest } from '@/lib/signals/approval-message';
import { deriveApprovalKey } from '@/lib/signals/telegram-callback-data';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const authErr = checkCronAuth(req);
  if (authErr) return authErr;

  const key = deriveApprovalKey(getSessionSecret());
  if (!key) {
    // 서명 키를 만들 수 없으면 버튼을 달 수 없다 — 시험 메시지도 보내지 않는다 (실제 승인 요청과 같은 fail-closed)
    return NextResponse.json({ ok: false, error: 'approval_key_unavailable' }, { status: 503 });
  }

  // 실제 요청과 같은 링크 버튼(app_public_url)을 달아, 켜기 전에 URL 이 텔레그램에서 유효한지 함께 확인한다
  let appUrl: string | null = null;
  try {
    const [rows] = await getPool().query<import('mysql2').RowDataPacket[]>('SELECT value FROM system_config WHERE `key` = ? LIMIT 1', ['app_public_url']);
    const v = rows[0] ? JSON.parse(String(rows[0].value)) : null;
    appUrl = typeof v === 'string' && v.trim() ? v.trim() : null;
  } catch { /* 링크 없이 보낸다 */ }

  const { text, keyboard } = renderSelfTest(key, new Date(), appUrl);
  const r = await sendTelegramMessage(text, keyboard);
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.skipped ? 'telegram_not_configured' : r.error }, { status: r.skipped ? 503 : 502 });
  }
  return NextResponse.json({ ok: true, messageId: r.result.message_id });
}
