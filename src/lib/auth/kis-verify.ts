/**
 * KIS 자격증명 실검증 — `POST {base}/oauth2/tokenP` (T-008 Step 1, 2026-08-07).
 *
 * `kis-auth.ts` 와 **같은 요청 형태**를 쓰되, 전역 상태를 일절 건드리지 않는 독립 함수다:
 *   - `getCredential()`(전역 .env/system_config)을 읽지 않고 인자로 받은 값만 쓴다
 *   - 발급받은 토큰을 전역 캐시 `system_config.kis_access_token` 에 **쓰지 않는다**
 *     (여기에 쓰면 라이브 매매 엔진의 토큰을 회원 입력값으로 갈아끼우게 된다)
 * 전역 KIS 클라이언트의 파라미터화는 설계문서 §구현순서 2 의 일이다.
 *
 * ⚠️ **운영 주의 — 같은 App Key 재발급은 기존 토큰을 무효화한다.**
 *    KIS 는 앱키당 토큰 1개만 유효하다(`kis-auth.ts` 주석 참조). 회원이 `.env` 와 동일한
 *    App Key 를 프로필에서 연결하면 그 순간 라이브 엔진이 쓰던 토큰이 무효화돼 최대 1분간
 *    (KIS 의 "1분당 1회 발급" 제한 때문에) 조회·주문이 실패할 수 있다. 기존 코드가
 *    EGW00123/401 에서 재발급으로 자가 복구하지만, 이 사실을 UI 에 그대로 고지한다.
 *
 * 이 모듈은 App Key/Secret 을 **로그·반환 메시지 어디에도 남기지 않는다.**
 */

/** 모의투자는 별도 도메인 — 토큰도 환경별로 따로 발급된다. */
export function kisBaseUrlForMock(mock: boolean): string {
  return mock
    ? 'https://openapivts.koreainvestment.com:29443'
    : 'https://openapi.koreainvestment.com:9443';
}

export interface KisVerifyInput {
  appKey: string;
  appSecret: string;
  mock: boolean;
}

export type KisVerifyResult =
  | { ok: true; accessToken: string; expiresAt: Date }
  | { ok: false; message: string };

/** 계좌번호 — KIS 종합계좌 앞 8자리 숫자 (상품코드는 별도 컬럼). */
export function validateKisAccountNo(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const v = typeof raw === 'string' ? raw.trim().replace(/-/g, '') : '';
  if (!/^\d{8,10}$/.test(v)) return { ok: false, error: '계좌번호는 숫자 8~10자리입니다 (하이픈 제외)' };
  return { ok: true, value: v };
}

/** 상품코드 — 2자리 숫자, 주식현물은 01. */
export function validateKisProduct(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d{2}$/.test(v)) return { ok: false, error: '상품코드는 숫자 2자리입니다 (보통 01)' };
  return { ok: true, value: v };
}

/** 화면 표시용 계좌번호 마스킹 — 앞 2 + **** + 뒤 2. 전체 번호는 화면에 되돌려주지 않는다. */
export function maskAccountNo(accountNo: string): string {
  const v = typeof accountNo === 'string' ? accountNo.trim() : '';
  if (v.length <= 4) return '*'.repeat(v.length);
  return `${v.slice(0, 2)}${'*'.repeat(v.length - 4)}${v.slice(-2)}`;
}

/** App Key/Secret 이 응답·로그 문자열에 섞여 나가지 않게 마지막에 한 번 더 훑는다. */
function scrub(message: string, secrets: string[]): string {
  let out = message;
  for (const s of secrets) {
    if (s && s.length >= 6 && out.includes(s)) out = out.split(s).join('***');
  }
  return out;
}

/**
 * 실제 토큰 발급을 시도해 자격증명이 유효한지 확인한다.
 * 실패 사유는 **고정 문구로 변환**해서 돌려준다 — KIS 응답 본문을 그대로 노출하지 않는다.
 *
 * @param fetchImpl 테스트 주입용. 기본값은 전역 fetch.
 */
export async function verifyKisCredentials(
  input: KisVerifyInput,
  fetchImpl: typeof fetch = fetch,
): Promise<KisVerifyResult> {
  const { appKey, appSecret, mock } = input;
  if (!appKey || !appSecret) return { ok: false, message: 'App Key 와 App Secret 을 모두 입력하세요' };

  const base = kisBaseUrlForMock(mock);
  let res: Response;
  try {
    res = await fetchImpl(`${base}/oauth2/tokenP`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials', appkey: appKey, appsecret: appSecret }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // 예외 객체에는 요청 본문이 담길 수 있으므로 절대 그대로 로그하지 않는다.
    console.error('[kis-verify] KIS 토큰 요청 실패 — 네트워크 오류');
    return { ok: false, message: 'KIS 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요' };
  }

  const rawBody = await res.text().catch(() => '');
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    /* 비 JSON 응답 — 상태코드로만 판정 */
  }

  if (res.ok && typeof parsed.access_token === 'string' && parsed.access_token.length > 0) {
    const expiresInSec = Number(parsed.expires_in ?? 86400);
    console.log('[kis-verify] KIS 자격증명 검증 성공', { mock, status: res.status });
    return {
      ok: true,
      accessToken: parsed.access_token,
      expiresAt: new Date(Date.now() + (Number.isFinite(expiresInSec) ? expiresInSec : 86400) * 1000),
    };
  }

  const code = typeof parsed.error_code === 'string' ? parsed.error_code : '';
  // 진단에 필요한 최소 정보만 남긴다 — 본문 전체는 앱키가 echo 될 여지가 있어 로그하지 않는다.
  console.warn('[kis-verify] KIS 자격증명 검증 실패', { mock, status: res.status, code });

  const rateLimited = code === 'EGW00133' || rawBody.includes('1분당 1회');
  const message = rateLimited
    ? 'KIS는 앱키당 1분에 한 번만 토큰을 발급합니다. 1분 뒤 다시 시도하세요'
    : res.status === 403 || res.status === 401
      ? 'KIS 인증에 실패했습니다. App Key·App Secret 과 계좌 종류(모의/실전)가 맞는지 확인하세요'
      : res.status >= 500
        ? 'KIS 서버가 응답하지 않습니다. 잠시 후 다시 시도하세요'
        : 'KIS 인증에 실패했습니다. 입력값과 계좌 종류(모의/실전)를 확인하세요';

  return { ok: false, message: scrub(message, [appKey, appSecret]) };
}
