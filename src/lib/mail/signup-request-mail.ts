/**
 * 관리자 수신 메일 본문 조립 (T-010, 2026-08-09) — 목업 b1ab92b1 §3 기준.
 *
 * **순수 함수다.** 네트워크·env 접근이 없고, 무엇보다 **수신자 주소를 만들지 않는다** —
 * 반환 타입에 `to`·`cc`·`bcc` 가 없다. 수신자는 `sendAdminMail` 이 env 에서 직접 읽는다.
 *
 * ## 이 메일이 이렇게 생긴 이유 (목업 주석 그대로)
 *
 *  1. **초대코드를 메일에 같이 넣는다.** 그래야 관리자가 `.env` 를 열지 않아도 된다 —
 *     이게 T-010 의 애초 목적이다.
 *  2. 코드는 **관리자 주소로만** 간다. 요청자가 적은 주소로는 어떤 경우에도 가지 않는다.
 *  3. 요청자 이메일이 **검증되지 않았다**는 경고를 넣는다 — 남의 주소를 적을 수도 있으므로
 *     관리자가 이를 신원 확인으로 오인하면 안 된다.
 *
 * 요청자 입력은 전부 `escapeHtml` 을 거쳐 HTML 에 들어가고, 헤더(제목)에 들어가는 이름만
 * `sanitizeHeaderText` 로 제어문자를 제거한다.
 */
import { escapeHtml, sanitizeHeaderText } from '@/lib/mail/header-safe';
import { escapeAlertText } from '@/lib/notify/escape';

export interface SignupRequestMailInput {
  /** 요청자가 적은 이름/호칭 (필수) */
  name: string;
  /** 요청자가 적은 이메일 — **검증되지 않은 값** (필수) */
  email: string;
  /** 하실 말씀 (선택) */
  message: string;
  /**
   * 현재 초대코드. `SIGNUP_INVITE_CODE` 미설정이면 `null` —
   * 그 경우 "가입이 개방돼 있다"는 경고를 대신 싣는다(빈 코드 박스를 보여주지 않는다).
   */
  inviteCode: string | null;
  /** 요청 시각 */
  requestedAt: Date;
}

export interface AdminMailBody {
  subject: string;
  text: string;
  html: string;
}

/** 제목에 들어가는 이름 길이 상한 — 나머지는 본문에서 온전히 보인다. */
export const SUBJECT_NAME_MAX = 40;

const NO_MESSAGE = '(없음)';
const APP_HOST = 'stock.미라클펭귄.com';

function kst(d: Date): string {
  // ko-KR + Asia/Seoul — 알림 채널(telegram.ts)과 같은 규약.
  return `${d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })} KST`;
}

/**
 * 메일 제목·본문(text/html) 조립.
 *
 * @returns 수신자 없는 본문. 발송은 `sendAdminMail(body)` 가 담당한다.
 */
export function buildSignupRequestMail(input: SignupRequestMailInput): AdminMailBody {
  // 제목은 유일하게 요청자 입력이 닿는 헤더다 — CRLF·제어문자를 제거하고 길이를 자른다.
  const subjectName = sanitizeHeaderText(input.name, SUBJECT_NAME_MAX) || '이름 없음';
  const subject = `[주식자동매매] 가입 요청 — ${subjectName}`;

  const when = kst(input.requestedAt);
  const message = input.message.trim().length > 0 ? input.message.trim() : NO_MESSAGE;

  const codeLineText = input.inviteCode !== null
    ? `현재 초대코드: ${input.inviteCode}`
    : '⚠️ SIGNUP_INVITE_CODE 가 설정돼 있지 않습니다 — 지금은 코드 없이 누구나 가입할 수 있는 상태입니다.';

  const text = [
    '새 가입 요청이 도착했습니다',
    '',
    `이름       : ${input.name}`,
    `이메일     : ${input.email}`,
    `하실 말씀  : ${message}`,
    `요청 시각  : ${when}`,
    '',
    codeLineText,
    '',
    '⚠️ 이 코드는 자동으로 요청자에게 가지 않습니다.',
    '   아는 사람이 맞는지 확인한 뒤, 카톡 등으로 직접 전달해 주세요.',
    '',
    '⚠️ 위 이메일 주소는 확인되지 않았습니다. 누구나 아무 주소나 적을 수 있습니다 —',
    '   아는 사람인지 별도로 확인하세요.',
    '',
    '─'.repeat(30),
    `이 메일은 ${APP_HOST} 의 가입 요청 화면에서 자동 발송되었습니다.`,
    '초대코드를 바꾸려면 서버 .env 의 SIGNUP_INVITE_CODE 를 수정하세요.',
  ].join('\n');

  // 목업의 Gmail 카드 스타일. 메일 클라이언트 호환을 위해 인라인 스타일만 쓴다.
  const codeBoxHtml = input.inviteCode !== null
    ? `<div style="background:#e8f0fe;border:1px solid #aecbfa;border-radius:8px;padding:13px 15px;margin:14px 0;text-align:center">
      <div style="font-size:11.5px;color:#5f6368;margin-bottom:5px">현재 초대코드</div>
      <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:21px;font-weight:700;letter-spacing:.1em;color:#1967d2">${escapeHtml(input.inviteCode)}</div>
    </div>`
    : `<div style="background:#fce8e6;border:1px solid #f5b7b1;border-radius:8px;padding:13px 15px;margin:14px 0;color:#5f2120;font-size:12.5px">
      ⚠️ <b>SIGNUP_INVITE_CODE 가 설정돼 있지 않습니다.</b> 지금은 코드 없이 누구나 가입할 수 있는 상태입니다.
    </div>`;

  const html = `<div style="font-family:ui-sans-serif,system-ui,-apple-system,'Noto Sans KR',sans-serif;font-size:13.5px;line-height:1.75;color:#202124;max-width:520px">
  <h2 style="margin:0 0 12px;font-size:15px">새 가입 요청이 도착했습니다</h2>
  <table style="border-collapse:collapse;width:100%;margin:10px 0 14px">
    <tr><td style="padding:6px 0;border-bottom:1px solid #e8eaed;color:#5f6368;width:92px;white-space:nowrap;font-size:13px">이름</td><td style="padding:6px 0;border-bottom:1px solid #e8eaed;font-size:13px">${escapeHtml(input.name)}</td></tr>
    <tr><td style="padding:6px 0;border-bottom:1px solid #e8eaed;color:#5f6368;font-size:13px">이메일</td><td style="padding:6px 0;border-bottom:1px solid #e8eaed;font-size:13px">${escapeHtml(input.email)}</td></tr>
    <tr><td style="padding:6px 0;border-bottom:1px solid #e8eaed;color:#5f6368;font-size:13px">하실 말씀</td><td style="padding:6px 0;border-bottom:1px solid #e8eaed;font-size:13px;white-space:pre-wrap">${escapeHtml(message)}</td></tr>
    <tr><td style="padding:6px 0;border-bottom:1px solid #e8eaed;color:#5f6368;font-size:13px">요청 시각</td><td style="padding:6px 0;border-bottom:1px solid #e8eaed;font-size:13px">${escapeHtml(when)}</td></tr>
  </table>
  ${codeBoxHtml}
  <div style="background:#fef7e0;border:1px solid #fdd663;border-radius:8px;padding:11px 13px;font-size:12.5px;color:#5f4b1f;margin:12px 0">
    ⚠️ <b>이 코드는 자동으로 요청자에게 가지 않습니다.</b> 아는 사람이 맞는지 확인한 뒤, 카톡 등으로 <b>직접</b> 전달해 주세요.
  </div>
  <div style="background:#fce8e6;border:1px solid #f5b7b1;border-radius:8px;padding:11px 13px;font-size:12.5px;color:#5f2120;margin:12px 0">
    ⚠️ 위 이메일 주소는 <b>확인되지 않았습니다.</b> 누구나 아무 주소나 적을 수 있습니다 — <b>아는 사람인지 별도로 확인</b>하세요.
  </div>
  <div style="font-size:11.5px;color:#80868b;border-top:1px solid #e8eaed;padding-top:11px;margin-top:14px">
    이 메일은 ${APP_HOST} 의 가입 요청 화면에서 자동 발송되었습니다.<br>
    초대코드를 바꾸려면 서버 <code>.env</code> 의 <code>SIGNUP_INVITE_CODE</code> 를 수정하세요.
  </div>
</div>`;

  return { subject, text, html };
}

/**
 * SMTP 실패 시 텔레그램/슬랙으로 보낼 폴백 본문 (사용자 확정 Q2).
 *
 * ## 🔒 초대코드를 넣지 않는다
 *
 * 텔레그램·슬랙은 관리자 채널이지만 **제3자 서버를 경유**하고, `notify_channel` 설정에 따라
 * 슬랙까지 동시 발송된다. T-010 의 불변식은 "코드는 `ADMIN_NOTIFY_EMAIL` 로만"이므로
 * 여기에는 요청 사실과 요청자 정보만 싣는다. 코드는 관리자가 평소처럼 확인하면 된다 —
 * 폴백의 목적은 "관리자가 요청을 **놓치지 않는 것**"이지 코드 전달이 아니다.
 *
 * ⚠️ 요청자 이메일은 **마스킹하지 않는다.** 이 앱의 다른 알림은 회원 이메일을 마스킹하지만
 *    (login route 의 `maskEmail`), 그것은 *기존 회원의 프라이버시*를 지키기 위한 것이다.
 *    여기서는 그 주소가 곧 관리자가 회신할 유일한 수단이라, 마스킹하면 폴백이 무의미해진다.
 *
 * ## 🔒 요청자 입력은 전부 `escapeAlertText` 를 거친다 (reviewer MEDIUM, 2026-08-09)
 *
 * 이 본문은 `dispatchAlert` 를 통해 **텔레그램(parse_mode:'HTML')과 슬랙(mrkdwn)** 양쪽에
 * 그대로 삽입된다. 이스케이프가 없으면 요청자가 `<a href="…">지금 확인</a>`(텔레그램) 또는
 * `<url|텍스트>`(슬랙)를 심어 **관리자 알림 안에 자기가 고른 문구의 클릭 가능한 링크**를
 * 렌더시킬 수 있다 — 증권계좌 자격증명을 쥔 사람을 겨냥한 피싱이다.
 * 부수적으로, 짝 안 맞는 `<` 하나만으로도 텔레그램이 400 을 내며 폴백 자체가 유실된다.
 *
 * 정적 문구에는 `&`·`<`·`>` 를 쓰지 않는다. 서식 표기(`**굵게**`)도 쓰지 않는다 —
 * 텔레그램 HTML 에서는 별표가 리터럴로 보이고 슬랙 mrkdwn 에서는 별표가 하나 남아,
 * 두 채널 어디서도 의도대로 렌더되지 않는다.
 */
export function buildSignupRequestFallbackText(input: Omit<SignupRequestMailInput, 'inviteCode'>): string {
  const message = input.message.trim().length > 0 ? input.message.trim() : NO_MESSAGE;
  return [
    '가입 요청이 들어왔지만 관리자 메일 발송에 실패했습니다.',
    '',
    `이름: ${escapeAlertText(input.name)}`,
    `이메일: ${escapeAlertText(input.email)} (검증되지 않은 주소)`,
    `하실 말씀: ${escapeAlertText(message)}`,
    `요청 시각: ${kst(input.requestedAt)}`,
    '',
    '초대코드는 보안상 이 알림에 담지 않았습니다 — 서버 .env 의 SIGNUP_INVITE_CODE 를 확인하세요.',
    'SMTP 설정(SMTP_USER / SMTP_PASS)도 함께 점검해 주세요.',
  ].join('\n');
}
