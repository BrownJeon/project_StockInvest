/**
 * 관리자 통보 메일 발송 (T-010, 2026-08-09).
 *
 * ## 🔒 이 모듈의 존재 이유 — 수신자를 요청에서 파생시킬 수 없게 만든다
 *
 * T-010 의 핵심 불변식은 "초대코드는 `ADMIN_NOTIFY_EMAIL`(env) 로만 나간다"이다.
 * 이 불변식을 주석이나 코드리뷰가 아니라 **타입 시그니처로** 강제한다:
 *
 *   - `sendAdminMail(content)` 의 인자에는 **수신자 필드가 없다**. `to`·`cc`·`bcc` 어느 것도
 *     받지 않으므로, 호출부가 요청 본문의 주소를 넘기려 해도 넣을 자리가 없다.
 *   - 수신자는 이 함수 안에서 `getAdminNotifyEmail()` 로 직접 읽는다.
 *   - `MailOptions` 타입(`src/types/nodemailer.d.ts`)에 `cc`/`bcc` 를 선언하지 않아
 *     "나중에 한 줄 추가"도 컴파일 에러가 된다.
 *
 * ## 실패를 성공으로 보이지 않게 (T-007 교훈)
 *
 * `sendTelegramAlert` 와 **동일한 계약**을 따른다 — 예외를 던지지 않고 `NotifyResult` 를 돌려준다.
 *   - `{ ok: true }`                 실제로 SMTP 서버가 수락함
 *   - `{ ok: false, skipped: true }` 자격증명 미설정 — 재시도해도 동일 (기능 자체가 꺼진 상태)
 *   - `{ ok: false, error }`         실제 전송 실패 (폴백·재시도 가치 있음)
 *
 * SMTP 가 응답은 했지만 주소를 거절한 경우(`rejected`)도 **실패로 본다.** 2xx 유사 응답만 보고
 * 성공이라 부르면 T-007 의 "유실됐는데 sent:true" 가 그대로 재현된다.
 *
 * ## nodemailer 를 왜 동적으로 import 하나
 *
 * 모듈 top-level 에서 정적 import 하면, SMTP 를 아직 설정하지 않은 현재 배포에서도
 * 앱 부팅 경로에 nodemailer 가 딸려 들어온다. 기능이 꺼져 있으면 로드조차 하지 않는 편이
 * "미설정 = 완전히 비활성"이라는 이 기능의 성격에 맞는다.
 */
import { getAdminNotifyEmail, getSmtpConfig, MAIL_FROM_NAME } from '@/lib/mail/config';
import { sanitizeHeaderText } from '@/lib/mail/header-safe';
import { trackCall } from '@/lib/api-usage';
import {
  NOTIFY_OK, NOTIFY_SKIPPED, notifyFailed, redactSecrets,
  isTransientNetworkError, type NotifyResult,
} from '@/lib/notify/result';

/** 발송할 내용. **수신자 필드가 없다** — 위 주석의 불변식을 시그니처로 강제한다. */
export interface AdminMailContent {
  subject: string;
  text: string;
  html?: string;
}

/** SMTP 가 매달려 있어도 요청이 끌려가지 않도록 상한을 둔다(단일 인스턴스 pm2). */
const CONNECTION_TIMEOUT_MS = 10_000;
const GREETING_TIMEOUT_MS = 10_000;
const SOCKET_TIMEOUT_MS = 20_000;

/** 헤더 폴딩·표시 안정성을 위한 제목 상한. */
const SUBJECT_MAX = 160;

type CreateTransport = (options: import('nodemailer').TransportOptions)
  => import('nodemailer').Transporter;

/**
 * CJS/ESM interop 을 런타임에 직접 판정한다.
 * (webpack·jest·node 가 각각 다른 형태의 네임스페이스를 주므로 한쪽만 가정하지 않는다)
 */
function resolveCreateTransport(mod: unknown): CreateTransport | null {
  const m = mod as { createTransport?: unknown; default?: { createTransport?: unknown } } | null;
  if (m && typeof m.createTransport === 'function') return m.createTransport as CreateTransport;
  if (m && m.default && typeof m.default.createTransport === 'function') {
    return m.default.createTransport as CreateTransport;
  }
  return null;
}

/**
 * 🔒 관리자에게 메일을 보낸다. **수신자는 언제나 `ADMIN_NOTIFY_EMAIL`(env) 이다.**
 * 예외를 던지지 않는다 — 호출부가 결과를 보고 폴백을 결정한다.
 */
export async function sendAdminMail(content: AdminMailContent): Promise<NotifyResult> {
  const smtp = getSmtpConfig();
  const adminEmail = getAdminNotifyEmail();
  // 미설정은 "실패"가 아니라 "시도 안 함"이다 — 호출부가 재시도 대상으로 오인하면 안 된다.
  if (smtp === null || adminEmail === null) return NOTIFY_SKIPPED;

  // 제목은 유일하게 요청자 입력(이름)이 닿는 헤더다. 호출부에서 이미 정규화했더라도
  // 발송 직전에 한 번 더 끊는다 — 방어를 한 곳에만 두지 않는다.
  const subject = sanitizeHeaderText(content.subject, SUBJECT_MAX) || '가입 요청';

  let transporter: import('nodemailer').Transporter | null = null;
  try {
    const create = resolveCreateTransport(await import('nodemailer'));
    if (create === null) {
      console.error('[mail] nodemailer 모듈을 해석하지 못했습니다 — package.json 선언·설치 확인');
      return notifyFailed('nodemailer_unavailable');
    }

    transporter = create({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
      connectionTimeout: CONNECTION_TIMEOUT_MS,
      greetingTimeout: GREETING_TIMEOUT_MS,
      socketTimeout: SOCKET_TIMEOUT_MS,
    });

    // T-040 호출 기록 — 수신자·제목·본문은 남기지 않는다. SMTP 응답은 HTTP 가 아니므로
    // 성공 판정은 예외 없음 + 거절 주소 0건(아래 rejected 판정과 같은 기준)으로 한다.
    const tx = transporter;
    const info = await trackCall('smtp', 'send-mail', () => tx.sendMail({
      // 표시 이름은 상수, 주소는 env. 둘 다 요청과 무관하다.
      from: `${MAIL_FROM_NAME} <${smtp.user}>`,
      // 🔒 수신자 — env 에서 읽은 값. 이 줄이 이 기능의 보안 경계다.
      to: adminEmail,
      subject,
      text: content.text,
      ...(content.html ? { html: content.html } : {}),
    }), { ok: (r) => !(Array.isArray(r?.rejected) && r.rejected.length > 0) });

    // SMTP 가 응답했어도 주소를 거절했으면 배달되지 않았다 — 성공이라 부르지 않는다.
    const rejected = Array.isArray(info?.rejected) ? info.rejected : [];
    if (rejected.length > 0) {
      const reason = `rejected=${rejected.length}`;
      console.error(`[mail] 관리자 메일 거절됨 — ${reason}`);
      return notifyFailed(reason);
    }
    return NOTIFY_OK;
  } catch (e) {
    // 비밀번호(앱 비밀번호 16자리)가 오류 문자열에 섞여 로그로 나가지 않게 반드시 마스킹한다.
    const raw = e instanceof Error ? e.message : String(e);
    const msg = redactSecrets(raw, smtp.pass, smtp.user);
    const kind = isTransientNetworkError(msg) ? 'transient' : 'permanent';
    console.error(`[mail] 관리자 메일 전송 실패 (${kind}) — ${msg}`);
    return notifyFailed(msg);
  } finally {
    // 비풀링 transport 라도 명시적으로 닫는다 — 소켓이 남아 프로세스가 붙잡히지 않게.
    try { transporter?.close(); } catch { /* 닫기 실패는 전송 결과를 바꾸지 않는다 */ }
  }
}
