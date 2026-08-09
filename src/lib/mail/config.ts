/**
 * SMTP 설정 — 환경변수 → 발송 가능 여부 (T-010, 2026-08-09).
 *
 * OAuth 의 `isProviderEnabled()`(`src/lib/auth/oauth/config.ts`)와 **같은 형태**다:
 * 설정이 하나라도 비면 기능 전체가 **꺼진 상태**로 배포되고, 화면의 진입 링크조차 렌더되지 않는다.
 * 자격증명이 없는 채로 배포됐다가 env 를 채우면 그때 켜진다 — 코드 재배포가 필요 없다.
 *
 * 값은 **호출 시점에** 읽는다 — 모듈 top-level 에서 캡처하면 pm2 `--update-env` 로 값을 넣어도
 * 프로세스가 옛 값을 계속 들고 있게 된다(oauth/config.ts 와 동일한 이유).
 *
 * ## 🔒 이 파일이 지키는 불변식
 *
 * **수신자 주소(`ADMIN_NOTIFY_EMAIL`)는 오직 여기서만 나온다.** 요청 본문을 인자로 받는
 * 함수가 이 모듈에 하나도 없다 — 수신자가 요청에서 파생될 **경로 자체가 없다.**
 */
import { isSafeHeaderAddress } from '@/lib/mail/header-safe';

export interface SmtpConfig {
  host: string;
  port: number;
  /** 465 = 암시적 TLS, 그 외(587) = STARTTLS */
  secure: boolean;
  user: string;
  pass: string;
}

function readEnv(name: string): string | null {
  const v = process.env[name];
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** Gmail 기본값. 사용자는 SMTP_USER/SMTP_PASS/ADMIN_NOTIFY_EMAIL 만 채우면 된다. */
const DEFAULT_HOST = 'smtp.gmail.com';
const DEFAULT_PORT = 587;

/**
 * SMTP 자격증명. 하나라도 비면 `null`(= 미설정). 값 자체는 어디에도 로그하지 않는다.
 *
 * host·port 는 기본값이 있으므로 사실상 `SMTP_USER` + `SMTP_PASS` 가 스위치다.
 */
export function getSmtpConfig(): SmtpConfig | null {
  const user = readEnv('SMTP_USER');
  const pass = readEnv('SMTP_PASS');
  if (user === null || pass === null) return null;

  const host = readEnv('SMTP_HOST') ?? DEFAULT_HOST;
  const rawPort = readEnv('SMTP_PORT');
  const port = rawPort === null ? DEFAULT_PORT : Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;

  // 발신자도 헤더에 나가는 주소다 — env 오염(개행·쉼표)까지 fail-closed 로 막는다.
  if (!isSafeHeaderAddress(user)) return null;

  return { host, port, secure: port === 465, user, pass };
}

/**
 * 🔒 관리자 수신 주소. **초대코드가 나갈 수 있는 유일한 주소다.**
 *
 * 사용자 확정 Q4: `SMTP_USER` 와 같은 주소를 쓴다. 그래도 **암묵적 폴백을 두지 않는다** —
 * `ADMIN_NOTIFY_EMAIL` 을 빠뜨린 채 SMTP 만 채우면 기능은 꺼진 채로 남는다.
 * "설정을 덜 했는데 조용히 어딘가로 발송되는" 상태를 만들지 않기 위해서다.
 *
 * 형식이 헤더에 안전하지 않으면(개행·쉼표 등) `null` 을 돌려 기능 자체를 끈다.
 */
export function getAdminNotifyEmail(): string | null {
  const raw = readEnv('ADMIN_NOTIFY_EMAIL');
  if (raw === null) return null;
  return isSafeHeaderAddress(raw) ? raw : null;
}

/**
 * 가입 요청 메일 발송이 가능한 상태인가.
 * 화면의 "초대코드가 없으신가요?" 링크 노출 여부와 **동일한 판정**이다
 * (판정이 화면·엔드포인트에서 갈라지면 눌러도 안 되는 링크가 생긴다).
 */
export function isMailEnabled(): boolean {
  return getSmtpConfig() !== null && getAdminNotifyEmail() !== null;
}

/** 발신 표시 이름. 헤더에 나가지만 **상수**다 — 요청 입력이 섞이지 않는다. */
export const MAIL_FROM_NAME = '주식자동매매';
