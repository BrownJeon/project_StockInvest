/**
 * 가입 요청 → 관리자 Gmail 알림 (T-010, 2026-08-09) — 목업 b1ab92b1.
 *
 * 초대코드가 없는 외부인이 폼을 채우면 **관리자에게 메일 한 통**이 간다. 그 메일에는
 * 요청자 정보와 **현재 초대코드**가 함께 담긴다 — 관리자가 코드를 알려주려고 서버 `.env` 를
 * 직접 열어보던 과정을 없애는 것이 이 기능의 목적이다.
 *
 * GET  : `{ ok, enabled }` — 화면이 진입 링크·폼 노출 여부를 정하는 데 쓴다
 * POST : `{ email, name, message? }` → 관리자 메일 발송
 *
 * ## 🔒 보안 불변식
 *
 * **초대코드는 `ADMIN_NOTIFY_EMAIL`(env) 로만 나간다.** 요청자가 적은 주소로는 어떤 경우에도
 * 나가지 않고, 응답 본문에도 코드가 실리지 않는다. 이게 깨지면 누구나 폼에 자기 주소를 넣고
 * 코드를 받아 초대 게이트가 통째로 무의미해진다.
 * 구조적 보증은 `@/lib/mail/send` 의 `sendAdminMail(content)` 가 **수신자 인자를 받지 않는 것**이다.
 *
 * ## 스팸 방어 (무인증 공개 경로 — middleware 를 통과한다)
 *
 *  1. 파싱 **전에** 본문 크기 상한 (`isAuthBodyTooLarge`, 로그인·가입과 동일한 8KB)
 *  2. **IP 축** rate limit — 잘못된 본문도 소비시킨다(검증 실패로 무한 재시도되면 의미 없음)
 *  3. **이메일 축** rate limit — 저장소는 IP 축·login-gate 와 완전히 분리 (`signup-request-gate.ts`)
 *
 * ## T-007 교훈 — 실패를 성공으로 보이지 않게
 *
 * 성공 화면 문구는 "접수되었습니다"가 아니라 **"전송되었습니다"** 다. 따라서 SMTP 가 실제로
 * 성공했을 때만 `delivery:'sent'` 를 준다.
 *
 *   SMTP ok            → 200 `{ delivery:'sent' }`
 *   SMTP 실패 + 폴백 ok → 200 `{ delivery:'fallback' }` — 메일은 실패했지만 관리자는 알게 됐다
 *   둘 다 실패          → 502 `{ delivery:'failed' }` + 에러 로그 + critical 알림
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isAuthBodyTooLarge } from '@/lib/auth/request-limits';
import { clientIpKey, currentInviteCode, parseSignupRequest } from '@/lib/auth/signup-request';
import {
  retryAfterMinutes,
  signupRequestEmailGate,
  signupRequestIpGate,
} from '@/lib/auth/signup-request-gate';
import { isMailEnabled } from '@/lib/mail/config';
import { sendAdminMail } from '@/lib/mail/send';
import {
  buildSignupRequestFallbackText,
  buildSignupRequestMail,
} from '@/lib/mail/signup-request-mail';
import { maskEmail } from '@/lib/auth/users';
import { dispatchAlert, sendAlert } from '@/lib/notify';
import { escapeAlertText } from '@/lib/notify/escape';

export const dynamic = 'force-dynamic';

const NOT_CONFIGURED = {
  ok: false as const,
  error: 'not_configured',
  detail: '가입 요청 기능이 아직 설정되지 않았습니다. 관리자에게 다른 방법으로 연락해 주세요.',
};

function tooManyResponse(retryAfterSec: number): NextResponse {
  const mins = retryAfterMinutes(retryAfterSec);
  return NextResponse.json(
    {
      ok: false,
      error: 'too_many_requests',
      detail: `요청이 너무 잦습니다. ${mins}분 뒤 다시 시도해 주세요.`,
      retryAfterSec,
    },
    { status: 429, headers: { 'retry-after': String(retryAfterSec) } },
  );
}

/** 기능 활성 여부만 알려준다 — 어떤 env 가 비었는지는 돌려주지 않는다. */
export async function GET() {
  return NextResponse.json(
    { ok: true, enabled: isMailEnabled() },
    { headers: { 'cache-control': 'no-store' } },
  );
}

export async function POST(req: NextRequest) {
  try {
    // 0) 미설정이면 기능 자체가 꺼진 상태 — 크래시가 아니라 명확한 안내로 끝낸다.
    //    (rate limit 을 소비시키지 않는다. 아무 일도 하지 않았기 때문이다.)
    if (!isMailEnabled()) {
      return NextResponse.json(NOT_CONFIGURED, { status: 503 });
    }

    // 1) 파싱 전에 본문 크기를 본다 — 거대한 본문은 읽는 순간 메모리에 통째로 올라온다.
    if (isAuthBodyTooLarge(req)) {
      return NextResponse.json(
        { ok: false, error: 'payload_too_large', detail: '요청이 너무 큽니다' },
        { status: 413 },
      );
    }

    // 2) IP 축 — 검사 후 **즉시 소비**한다. 검증 실패한 요청도 소비시켜야
    //    "잘못된 본문을 무한히 던지는" 우회가 막힌다.
    const ipKey = clientIpKey(req.headers);
    const ipCheck = signupRequestIpGate.check(ipKey);
    if (!ipCheck.allowed) return tooManyResponse(ipCheck.retryAfterSec);
    signupRequestIpGate.register(ipKey);

    // 3) 입력 검증
    const body = await req.json().catch(() => ({}));
    const parsed = parseSignupRequest(body);
    if (!parsed.ok) {
      return NextResponse.json({ ok: false, error: 'invalid_input', detail: parsed.error }, { status: 400 });
    }
    const { email, name, message } = parsed.value;

    // 4) 이메일 축
    const emailCheck = signupRequestEmailGate.check(email);
    if (!emailCheck.allowed) return tooManyResponse(emailCheck.retryAfterSec);
    signupRequestEmailGate.register(email);

    const requestedAt = new Date();

    // 5) 관리자 메일 — 🔒 수신자는 sendAdminMail 내부에서 env 로만 결정된다.
    //    buildSignupRequestMail 은 수신자 필드를 만들지도 않는다(순수 본문 조립).
    const mail = buildSignupRequestMail({
      name, email, message,
      inviteCode: currentInviteCode(),
      requestedAt,
    });
    const sent = await sendAdminMail(mail);

    if (sent.ok) {
      console.log(`[auth] 가입 요청 메일 발송 (${maskEmail(email)})`);
      return NextResponse.json({ ok: true, delivery: 'sent' });
    }

    // 6) SMTP 실패 → 이미 동작 중인 텔레그램/슬랙으로 폴백 (사용자 확정 Q2).
    //    ⚠️ 폴백 본문에는 초대코드를 넣지 않는다 — 코드는 관리자 메일로만 나간다.
    const reason = sent.skipped ? 'unconfigured' : (sent.error ?? 'unknown');
    console.error(`[auth] 가입 요청 메일 실패 (${maskEmail(email)}) — ${reason} → 폴백 시도`);

    const dispatch = await dispatchAlert(
      'warning',
      '가입 요청 (메일 발송 실패)',
      buildSignupRequestFallbackText({ name, email, message, requestedAt }),
    );

    if (dispatch.delivered.length > 0) {
      // 메일은 실패했지만 관리자는 요청을 받았다. "전송되었습니다"라고 말하지 않는다.
      return NextResponse.json({ ok: true, delivery: 'fallback', channels: dispatch.delivered });
    }

    // 7) 둘 다 실패 — 정직하게 실패를 알리고 흔적을 남긴다.
    //    sendAlert('critical') 은 어느 채널에도 전달되지 않으면
    //    `CRITICAL_ALERT_UNDELIVERED` 토큰을 로그에 남긴다(notify/index.ts).
    console.error(
      `[auth] 🚨 가입 요청 전달 실패 — 메일(${reason})·폴백 모두 실패. ` +
      `요청자 ${maskEmail(email)} 의 요청이 유실됐다. SMTP·텔레그램 설정을 점검하라.`,
    );
    // ⚠️ maskEmail 결과도 요청자 입력에서 파생된다 — `isValidEmail` 은 로컬파트의 `<`·`>` 를
    //    허용하므로 `<a>xxxx@evil.com` → `<a*****@evil.com` 처럼 마크업 조각이 남는다.
    //    그대로 보내면 텔레그램이 HTML 파싱 실패로 400 을 내고 **이 critical 알림 자체가 유실**된다
    //    (다른 모든 전달이 실패했다고 알리는 알림이 같은 이유로 사라지는 것이 최악이다).
    sendAlert(
      'critical',
      '가입 요청 유실',
      `가입 요청을 관리자에게 전달하지 못했습니다 (메일: ${escapeAlertText(reason)}, 폴백 채널: 전달 0건).\n` +
      `요청자 ${escapeAlertText(maskEmail(email))} 는 다시 시도해야 합니다. SMTP_USER/SMTP_PASS 를 확인하세요.`,
    );

    return NextResponse.json(
      {
        ok: false,
        error: 'delivery_failed',
        delivery: 'failed',
        detail: '메일 서버에 연결하지 못했습니다. 잠시 후 다시 시도하시거나, 관리자에게 다른 방법으로 연락해 주세요.',
      },
      { status: 502 },
    );
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/auth/signup-request]', error);
    return NextResponse.json(
      { ok: false, error: 'internal_error', detail: '요청 처리 중 오류가 발생했습니다' },
      { status: 500 },
    );
  }
}
