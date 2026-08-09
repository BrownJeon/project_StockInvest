/**
 * `nodemailer` 최소 타입 선언 (T-010, 2026-08-09).
 *
 * nodemailer 9.0.5 는 **자체 타입을 배포하지 않는다**(`types`/`typings` 필드 없음, `.d.ts` 미포함).
 * 별도 `@types/nodemailer` 를 devDependency 로 더할 수도 있지만, 이 프로젝트가 쓰는 API 는
 * `createTransport` + `sendMail` 둘뿐이라 `@workspace/auth-oauth` 때와 같은 방식
 * (`src/types/workspace-auth-oauth.d.ts`)으로 **필요한 표면만** 선언한다.
 *
 * ⚠️ 여기 없는 옵션은 의도적으로 없는 것이다. 특히 `cc`·`bcc` 를 선언하지 않았다 —
 *    이 앱이 메일을 보내는 경로는 관리자 1인 통보 하나뿐이고, 수신자를 늘릴 수 있는 필드는
 *    T-010 의 보안 불변식("초대코드는 ADMIN_NOTIFY_EMAIL 로만")을 깨는 도구가 된다.
 *    컴파일 타임에 그 경로를 막는 것이 이 선언의 일부다.
 *
 * 런타임 해석은 `src/lib/mail/send.ts` 가 `unknown` 으로 받아 직접 검사하므로
 * 이 선언이 실제 모듈 형태(CJS)와 어긋나도 런타임이 깨지지 않는다.
 */
declare module 'nodemailer' {
  export interface MailOptions {
    from: string;
    /** 🔒 항상 env(`ADMIN_NOTIFY_EMAIL`)에서 온 값이어야 한다. 요청 본문에서 파생 금지. */
    to: string;
    subject: string;
    text: string;
    html?: string;
  }

  export interface SentMessageInfo {
    messageId?: string;
    accepted?: string[];
    rejected?: string[];
    response?: string;
  }

  export interface Transporter {
    sendMail(mail: MailOptions): Promise<SentMessageInfo>;
    close(): void;
  }

  export interface TransportOptions {
    host: string;
    port: number;
    secure: boolean;
    auth: { user: string; pass: string };
    connectionTimeout?: number;
    greetingTimeout?: number;
    socketTimeout?: number;
  }

  export function createTransport(options: TransportOptions): Transporter;

  const nodemailer: { createTransport: typeof createTransport };
  export default nodemailer;
}
