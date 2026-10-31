import { getPool } from '@/lib/db';
import { getCredential } from '@/lib/credentials';
import { kisFetch } from './kis-http';
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
 * 토큰 발급 한 번의 **응답 헤더 도착까지의** 상한 (T-136 QA F-A).
 *
 * ⚠ 이 상한은 **헤더 도착까지만** 걸린다 — **본문 읽기에는 상한이 없다**(5차 감사 L-5, 3차 QA 실측:
 *   헤더 즉시 + 본문 13초 정지 시 두 호출이 **13.0초 대기 후 성공**). 즉 F-A 는 **헤더 단계에서만**
 *   닫혔다. `kisFetch` 는 `finally` 에서 타이머를 지운 뒤
 *   `res.text()` 를 하므로, 헤더는 왔는데 본문이 멈추면 합류한 호출이 다시 길게 묶인다 —
 *   같은 기전이고 막지 않았다(운영 163,474건에 본문 단계 정지로 볼 호출 0건, 이 파일을 네 번째로
 *   고치는 위험이 그 확률보다 크다고 판단). [[T-138-token-issue-single-flight]] 후속 후보 2 에 적어 둔다.
 *
 * 실측(운영 7일): `token-p` 129건의 최대 지연 204ms·1초 초과 0건, KIS 전체 163,474건 p99.9 = 1.2초,
 * 성공한 가장 느린 호출 4.0초. 5초를 넘은 3건은 모두 같은 순간의 연결 타임아웃(10,248ms)이었다 —
 * F-A 가 겨냥한 "응답 없는 엔드포인트" 는 실제로 일어난다.
 *
 * 값을 고른 기준: 매달림을 **유계로** 만드는 것이 목적이고, 너무 짧으면 느린 응답을 끊어 `EGW00133`
 * 1분 대기를 불러온다. 시세 조회가 쓰는 5초보다 넉넉하게 두되(발급은 틱마다 일어나지 않는다)
 * 무계 5분과는 두 자릿수 차이가 나게 10초로 둔다. 최악 시간은 아래 `issueAndStore` 주석에 적는다.
 */
const TOKEN_ISSUE_TIMEOUT_MS = 10_000;

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

  /**
   * 🔴 (T-136 QA F-1) 발급으로 떨어질 때는 **진행 중인 재발급에 합류한다.**
   *
   * 위 캐시 조회가 "행 없음" 을 보는 흔한 이유는 **방금 다른 호출의 `invalidateKisToken()` 이 그 행을
   * 지웠기 때문**이다. 그때 각자 `issueAndStore` 로 내려가면 같은 순간에 발급이 두 번 일어나고, KIS 의
   * "앱키당 1분 1회"(`EGW00133`)에 걸린 쪽이 **60초를 기다린다.** 그 대기는 이 함수를 쓰는 모든 경로를
   * 막는데 `createOrder` 도 그 경로다.
   *
   * `invalidateKisToken()` 은 예전부터 `refreshInFlight` 에 합류했지만(아래), **이 경로만 빠져 있었다.**
   * QA 가 혼합 토큰 시나리오로 재현했다 — 죽은 토큰 두 개가 10ms 차로 실패하면 발급 2회·대기 1회.
   * 합류하면 1회가 된다. 실패하면 함께 실패한다(fail-closed, `invalidateKisToken` 과 같은 성질).
   *
   * ⚠ (T-138 감사 C-2 · QA F-4) **발급 횟수를 묶는 것은 이 줄이 아니라 아래 `issueOnce` 다.**
   * 이 줄만 지우는 변이는 시험을 통과하고, QA 가 400회 무작위 재현에서 **발급 횟수·DELETE 횟수가
   * 완전히 같다**는 것까지 확인했다. 즉 이 줄은 **지금 실질 효과가 없다**(처음 「DELETE 중복까지
   * 피한다」고 적었는데 틀렸다 — `DELETE` 는 `invalidateKisToken` 안에만 있다). 남겨 두는 이유는
   * 「진행 중인 삭제+발급 비행이 있으면 그 결과를 쓴다」는 **의도를 코드로 보이는 것**뿐이다.
   */
  if (refreshInFlight) return refreshInFlight;

  // (T-138) 그리고 발급 자체도 단일 비행이다 — 이 폴백끼리의 동시 호출이 갱신 시각 폭주의 원인이었다.
  return await issueOnce(appKey, appSecret);
}

/**
 * 🔴 발급 자체의 **단일 비행** (T-138).
 *
 * `issueAndStore` 를 부르는 경로가 둘인데 **한쪽만 합쳐져 있었다** — `invalidateKisToken()` 은
 * `refreshInFlight` 로 묶지만, `getKisToken()` 의 캐시 미스·만료임박 **폴백은 그 플래그를 세우지
 * 않는다.** 그래서 폴백끼리는 합류할 대상이 없었다.
 *
 * ## 그게 왜 사고로 나타났나 (실측)
 *
 * 토큰 수명이 24시간인데 만료 **1시간 전**에 갱신하므로 발급 간격이 약 23시간이다 — 갱신 시각이 매일
 * 약 1시간 앞당겨진다(추세가 아니라 `24h − 1h` 주기다). 그 시각에 **진행 중인 조회 전부가 동시에**
 * 캐시 미스를 보고 각자 발급으로 내려간다. 2026-10-30 KST 16:00:03~16:02:10 에 `token-p` 가
 * **118건 호출돼 111건이 403**(`EGW00133` 앱키당 1분 1회) 거절당했다 — 분당 38·37·36건이 **정확히
 * 60초 간격으로 세 번** 몰렸고(각자 `issueAndStore` 의 재시도 3회가 다 같이 기다렸다가 다시 몰려간
 * 것이다) 성공은 7건뿐이라 **약 2분간 토큰이 없었다**. 정상일은 하루 1~5건이다.
 *
 * 지금까지 그 창이 **장 밖**이었던 것은 운이고, 23시간 주기는 11-02(월) 13시 전후 — **KRX 장중**으로
 * 들어온다. 그때 토큰이 2분 없으면 주문·시세·잔고가 모두 실패한다.
 *
 * 그래서 **두 경로가 같은 비행을 공유한다.** 40건이 동시에 캐시 미스를 봐도 발급은 **1회**다
 * (실측: 10-30 재현에서 HEAD 126요청·40실패 → 1요청·0실패).
 *
 * ⚠ **"한 번의 대기" 가 아니다**(QA F-1 정정 — 처음 그렇게 적었다). 비행이 `EGW00133` 을 받아 기다리는
 * 동안 **늦게 도착한 호출**은 그 비행을 기다린 뒤 **자기 차례의 대기를 또 만날 수 있다.** 외부 발급이
 * 두 번 겹치면 QA 실측 **최대 94.8초**, 이론 상한 **약 180초**다. 같은 조건에서 HEAD 는 코호트 38/40 이
 * **실패**하므로 방향은 여전히 이득이지만, **늦게 온 주문은 HEAD 보다 오래 묶인다**(대기 중 주문은
 * `pending` 으로 한도 예약에 합산되고, 송신은 대기 **뒤에** 일어나므로 고아 주문은 없다).
 *
 * ⚠ **한 프로세스 안**의 단일화다. 웹·크론처럼 다른 프로세스 사이의 동시 발급은 그대로 남는다 —
 * 그건 DB 잠금이 필요하고 T-138 후속 후보 3 이다.
 */
let issueInFlight: Promise<string> | null = null;

function issueOnce(appKey: string, appSecret: string): Promise<string> {
  if (issueInFlight) return issueInFlight;
  issueInFlight = issueAndStore(appKey, appSecret).finally(() => { issueInFlight = null; });
  return issueInFlight;
}

async function issueAndStore(appKey: string, appSecret: string): Promise<string> {
  // KIS는 1분 내 동일 앱키 재발급을 거부 — 충돌 시 약간 대기 후 재시도
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    /**
     * T-017 — 유량 스로틀 `critical` lane.
     *
     * 토큰이 없으면 **다른 모든 KIS 호출이 여기서 막힌다.** 대량 스캔 뒤에 줄 서면 안 된다.
     *
     * ⚠️ `tokenP` 자체의 "앱키당 1분에 1회" 제한(`EGW00133`)은 이 스로틀과 **다른 층위**다.
     *    그 제한은 아래 `1분당 1회` 분기와 상위의 `refreshInFlight` 단일화로 이미 다뤄지고
     *    있고, 스로틀은 초당 유량만 본다. `EGW00133` 은 `kis-http` 의 레이트리밋 패턴
     *    (`EGW00201`/`EGW00215`)에 **일부러 포함하지 않았으므로** 이중으로 백오프되지 않는다.
     *
     * 🔴 (T-136 QA F-A) **상한이 반드시 있어야 한다.** 예전에는 `timeoutMs` 가 없어 `kisFetch` 기본값
     *    (무제한)을 썼고, 응답 없는 서버에 걸리면 undici 의 헤더 타임아웃까지 **약 5분**을 매달렸다
     *    (QA 실측 300,754ms → `UND_ERR_HEADERS_TIMEOUT`). 그 동안 이 함수를 쓰는 **모든** 경로가
     *    멈추는데 `createOrder` 도 그 경로다. T-136 이 `getKisToken()` 을 `refreshInFlight` 에
     *    합류시키면서 그 영향 범위가 넓어져(합류한 호출도 함께 매달린다) 상한이 필수가 됐다.
     *
     *    트레이드오프: 끊긴 요청이 KIS 쪽에서는 **이미 발급됐을 수 있고**, 그러면 다음 시도가
     *    `EGW00133`(1분 1회)에 걸린다. 그건 아래 분기가 이미 다루는 경우다.
     *
     *    **최악 시간**(3차 QA 실측으로 정정): 타임아웃은 `AbortError` 로 **즉시 던져 재시도를 돌지
     *    않으므로**, 반복되는 것은 `EGW00133` **응답**뿐이다. 그 응답이 곧바로 오면 대기 3회 =
     *    **180초**, 응답이 상한 직전(약 10초)에 오면 **약 210초**다. ⚠ **스로틀 대기(회당 최대 30초)와
     *    본문 읽기 시간은 이 계산에 들어 있지 않다** — 실제 최악은 그만큼 더 길다.
     *    종전(상한 없음)은 **회차마다 약 5분**이었다.
     *    내가 처음 적은 "3회 × (10초+대기)" 와 그다음 "약 180초" 는 둘 다 정확하지 않았다.
     */
    const res = await kisFetch(`${kisBaseUrl()}/oauth2/tokenP`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials', appkey: appKey, appsecret: appSecret }),
    }, { priority: 'critical', label: 'tokenP', timeoutMs: TOKEN_ISSUE_TIMEOUT_MS });
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
    return await issueOnce(appKey, appSecret);   // (T-138) 발급은 두 경로가 같은 비행을 공유한다
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}
