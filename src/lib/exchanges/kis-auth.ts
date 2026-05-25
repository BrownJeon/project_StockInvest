import { getPool } from '@/lib/db';
import { getCredential } from '@/lib/credentials';
import type { RowDataPacket } from 'mysql2';

/**
 * KIS BASE URL — 모의투자(`KIS_MOCK=true`)는 별도 도메인 사용.
 *  - 실전: openapi.koreainvestment.com:9443
 *  - 모의: openapivts.koreainvestment.com:29443
 *
 * 토큰은 환경별로 별도 발급되어야 함 (모의 앱키 ↔ 실전 앱키 분리).
 */
function kisBaseUrl(): string {
  const isMock = String(process.env.KIS_MOCK ?? 'true').toLowerCase() === 'true';
  return isMock
    ? 'https://openapivts.koreainvestment.com:29443'
    : 'https://openapi.koreainvestment.com:9443';
}

export { kisBaseUrl };

interface TokenCache {
  access_token: string;
  expires_at: number; // unix ms
}

/**
 * 동시 다중 호출이 각자 토큰을 발급하면 KIS의 "1분 내 재발급 불가" 제한에 걸린다.
 * refreshInFlight 로 중복 발급 요청을 단일 Promise 로 합친다.
 */
let refreshInFlight: Promise<string> | null = null;

/**
 * KIS 토큰. 동일 KIS_APP_KEY를 다른 프로세스(TradingInvest 등)에서 새로 발급하면
 * 기존 토큰이 무효화되므로 EGW00123 또는 401 응답 시 호출자가 invalidateKisToken()을
 * 호출해 캐시 무효화 후 재발급할 수 있도록 export.
 */
export async function getKisToken(): Promise<string> {
  const [appKey, appSecret] = await Promise.all([
    getCredential('KIS_APP_KEY'),
    getCredential('KIS_APP_SECRET'),
  ]);
  if (!appKey || !appSecret) throw new Error('KIS_APP_KEY / KIS_APP_SECRET not set');

  // DB 캐시 조회
  try {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT value FROM system_config WHERE `key` = 'kis_access_token' LIMIT 1",
    );
    if (rows.length > 0) {
      const cached: TokenCache = JSON.parse(rows[0].value as string);
      // 만료 1시간 전까지 재사용
      if (cached.expires_at > Date.now() + 3_600_000) {
        return cached.access_token;
      }
    }
  } catch { /* DB 미연결 시 신규 발급 */ }

  return await issueAndStore(appKey, appSecret);
}

async function issueAndStore(appKey: string, appSecret: string): Promise<string> {
  // KIS는 1분 내 동일 앱키 재발급을 거부 — 충돌 시 약간 대기 후 재시도
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${kisBaseUrl()}/oauth2/tokenP`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials', appkey: appKey, appsecret: appSecret }),
    });
    if (res.ok) {
      const data = await res.json();
      if (!data.access_token) throw new Error(`KIS token missing: ${JSON.stringify(data)}`);
      console.log('[kis-auth] issued new token, prefix=', String(data.access_token).slice(0, 8),
        'expires_in=', data.expires_in);
      const cache: TokenCache = {
        access_token: data.access_token as string,
        expires_at:   Date.now() + Number(data.expires_in ?? 86400) * 1000,
      };
      try {
        const pool = getPool();
        await pool.query(
          "INSERT INTO system_config (`key`, value) VALUES ('kis_access_token', ?) ON DUPLICATE KEY UPDATE value=?, updated_at=NOW()",
          [JSON.stringify(cache), JSON.stringify(cache)],
        );
      } catch { /* 저장 실패 시 무시 */ }
      return cache.access_token;
    }
    const body = await res.text().catch(() => '');
    lastErr = new Error(`KIS token error: ${res.status} body=${body.slice(0, 200)}`);
    // 재시도: 1분당 1회 제한 메시지면 대기 후 재시도
    if (body.includes('1분당 1회') || body.includes('EGW00133')) {
      await new Promise(r => setTimeout(r, 60_000));
      continue;
    }
    throw lastErr;
  }
  throw lastErr ?? new Error('KIS token issue failed');
}

/** 외부에서 토큰을 강제 무효화하고 재발급 받음. EGW00123(만료) 응답 시 호출.
 *  병렬로 여러 호출이 동시에 진입해도 in-flight 중이면 동일 Promise 를 반환해
 *  KIS 1분당 1회 재발급 제한에 걸리지 않도록 한다. */
export async function invalidateKisToken(): Promise<string> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const pool = getPool();
      await pool.query("DELETE FROM system_config WHERE `key` = 'kis_access_token'");
    } catch { /* swallow */ }
    const [appKey, appSecret] = await Promise.all([
      getCredential('KIS_APP_KEY'),
      getCredential('KIS_APP_SECRET'),
    ]);
    if (!appKey || !appSecret) throw new Error('KIS_APP_KEY / KIS_APP_SECRET not set');
    return await issueAndStore(appKey, appSecret);
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}
