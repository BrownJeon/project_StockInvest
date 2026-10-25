/**
 * T-088 — 앱 딥링크 1회용 인증 코드(TheKaiwa `infra/auth/oauth/app-code.ts` 를 mysql2·`getPool()` 구조로 옮김).
 *
 * Google 은 WebView 안 로그인을 거부하므로 로그인만 Chrome 창(Custom Tab)에서 한다. Custom Tab 은 별도 브라우저라 거기서 심은 세션 쿠키가
 * 앱 WebView 로 오지 않는다. 그래서 콜백은 세션 대신 **60초·1회용 코드**를 만들고 `stockinvest://auth/callback?code=` 로 앱에 넘긴다.
 * 앱은 그 코드와 로그인 시작 때 만든 PKCE verifier 를 `POST /api/auth/app-exchange` 로 보내 진짜 세션 쿠키를 받는다.
 *
 * ★ 세션 토큰(30일)을 URL 에 싣는 것과 다른 점(T-009 B2 와 양립):
 *   - 60초 TTL·1회용(소각). 히스토리·로그에 남아도 재사용할 수 없다.
 *   - 코드 자체로는 권한이 없다 — 교환 라우트 한 곳에서, 그것도 verifier 와 짝이 맞을 때만 의미가 있다.
 *
 * ★ PKCE 결속: 딥링크에는 랜덤 `code_r` 만 싣고, DB `app_auth_code.code` 에는 `sha256hex(code_r + ":" + challenge)` 를 저장한다.
 *   교환은 `code_r` + `verifier` 로 같은 값을 다시 만들어야만 행을 찾는다 — 딥링크를 가로챈 다른 앱은 verifier 가 없다.
 *   DB 가 새도 code_r 을 되돌릴 수 없다(verifier·code_r 어느 것도 DB 에 없다).
 *
 * ★ 소각은 `UPDATE … SET used_at = NOW(3) WHERE code = ? AND used_at IS NULL AND expires_at > NOW(3)` **한 방의 조건부 UPDATE** 다.
 *   "조회 후 갱신" 으로 나누면 동시 요청 두 개가 같은 코드로 각각 세션을 받는 경쟁 조건이 생긴다 — 영향 행 수가 정확히 1 일 때만 통과.
 *
 * ★ 시각은 **DB 시계 하나만** 쓴다(발급 `NOW(3) + INTERVAL 60 SECOND`, 소각 `expires_at > NOW(3)`). 앱 서버와 DB 의 시계·시간대가
 *   달라도 TTL 이 늘거나 줄지 않고, JS Date ↔ DATETIME 변환(풀의 timezone 설정)에도 기대지 않는다.
 *
 * 테이블: `scripts/migrations/T-088-app-auth-code.sql`(부팅 때 만들지 않는다 — 적용은 사용자 승인). 테이블이 없으면 발급이
 * `ER_NO_SUCH_TABLE` 로 실패하고 콜백이 앱에 `not_configured` 를 돌려준다(웹 로그인은 이 모듈을 부르지 않는다).
 */
import { createHash, randomBytes } from 'node:crypto';
import { getPool } from '@/lib/db';
import { APP_CODE_PATTERN } from '@/lib/auth/oauth/app-flow';
import { isPkceChallenge, isPkceVerifier, pkceChallengeOf } from '@/lib/auth/oauth/pkce';

/** 코드 수명(초). DB CHECK(chk_app_auth_code_ttl)가 10분 상한을 따로 건다. */
export const APP_AUTH_CODE_TTL_SEC = 60;

/** 소각·만료된 행을 남겨 두는 시간(초) — 이 뒤에는 발급 때 청소한다. */
export const APP_AUTH_CODE_RETENTION_SEC = 60 * 60;

/** DB 에 저장하는 값(= 조회 키). 순수 함수. */
export function bindAppAuthCode(codeR: string, challenge: string): string {
  return createHash('sha256').update(`${codeR}:${challenge}`, 'utf8').digest('hex');
}

/** 발급·소각이 DB 에 기대는 동작 — 시험은 메모리 구현을 넣는다. */
export interface AppAuthCodeStore {
  /** 행 1개 추가(`expires_at = 지금 + ttlSec`). */
  create(row: { code: string; userId: number; ttlSec: number }): Promise<void>;
  /** `used_at IS NULL AND expires_at > 지금` 인 행을 소각하고 **영향 행 수**를 돌려준다. */
  burn(code: string): Promise<number>;
  /** 행의 회원 id(소각 뒤 조회). 없으면 null. */
  userIdOf(code: string): Promise<number | null>;
  /** 만료 + 보관시간이 지난 행 삭제. */
  prune(retentionSec: number): Promise<void>;
}

/** 조회에 필요한 최소 모양(mysql2 Pool 또는 시험용 가짜). */
export interface SqlRunner {
  query(sql: string, values?: unknown[]): Promise<unknown>;
}

export const APP_AUTH_CODE_SQL = {
  insert: 'INSERT INTO app_auth_code (code, user_id, expires_at) VALUES (?, ?, NOW(3) + INTERVAL ? SECOND)',
  burn: 'UPDATE app_auth_code SET used_at = NOW(3) WHERE code = ? AND used_at IS NULL AND expires_at > NOW(3)',
  userOf: 'SELECT user_id FROM app_auth_code WHERE code = ? LIMIT 1',
  prune: 'DELETE FROM app_auth_code WHERE expires_at < NOW(3) - INTERVAL ? SECOND',
} as const;

function affectedRows(res: unknown): number {
  const head = Array.isArray(res) ? res[0] : res;
  const n = (head as { affectedRows?: unknown } | null)?.affectedRows;
  return typeof n === 'number' && Number.isSafeInteger(n) ? n : 0;
}

/** mysql2 저장소. `runner` 를 주지 않으면 호출 시점의 `getPool()`. */
export function createSqlAppAuthCodeStore(runner?: SqlRunner): AppAuthCodeStore {
  const q = (): SqlRunner => runner ?? (getPool() as unknown as SqlRunner);
  return {
    async create({ code, userId, ttlSec }) {
      await q().query(APP_AUTH_CODE_SQL.insert, [code, userId, ttlSec]);
    },
    async burn(code) {
      return affectedRows(await q().query(APP_AUTH_CODE_SQL.burn, [code]));
    },
    async userIdOf(code) {
      const res = await q().query(APP_AUTH_CODE_SQL.userOf, [code]);
      const rows = Array.isArray(res) ? res[0] : null;
      const first = Array.isArray(rows) ? (rows[0] as { user_id?: unknown } | undefined) : undefined;
      const id = Number(first?.user_id);
      return Number.isSafeInteger(id) && id > 0 ? id : null;
    },
    async prune(retentionSec) {
      await q().query(APP_AUTH_CODE_SQL.prune, [retentionSec]);
    },
  };
}

const defaultStore = createSqlAppAuthCodeStore();

/** 테이블 미적용(1146 + 메시지에 app_auth_code) — 콜백이 `not_configured` 로 바꾼다. 다른 표가 없으면 장애라 해당 없음. */
export function isAppAuthCodeNotMigrated(e: unknown): boolean {
  const o = e as { code?: string; errno?: number; message?: string; sqlMessage?: string } | null;
  if (!(o?.code === 'ER_NO_SUCH_TABLE' || o?.errno === 1146)) return false;
  return String(o?.sqlMessage ?? o?.message ?? '').includes('app_auth_code');
}

/**
 * 코드 발급 — 돌려준 `code_r` 만 딥링크에 싣는다. challenge 형식이 틀리거나 회원 id 가 양의 정수가 아니면 던진다
 * (PKCE 없는 앱 흐름은 없다 — 첫 지원 APK 1.0.1 부터 필수).
 */
export async function issueAppAuthCode(
  userId: number,
  challenge: string,
  store: AppAuthCodeStore = defaultStore,
): Promise<string> {
  if (!isPkceChallenge(challenge)) throw new Error('issueAppAuthCode: PKCE challenge 형식 오류');
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('issueAppAuthCode: userId 형식 오류');
  const codeR = randomBytes(32).toString('hex');
  await store.create({ code: bindAppAuthCode(codeR, challenge), userId, ttlSec: APP_AUTH_CODE_TTL_SEC });

  // 별도 배치 없이 발급 시점에 흘려보낸다. 실패해도 로그인은 계속돼야 하므로 삼킨다(값·코드는 로그에 남기지 않는다).
  void store.prune(APP_AUTH_CODE_RETENTION_SEC).catch((e: unknown) => {
    console.warn('[auth] app_auth_code 정리 실패:', e instanceof Error ? e.message : String(e));
  });

  return codeR;
}

/**
 * `code_r` + `verifier` 를 검증하고 **즉시 소각**한다. 성공이면 회원 id, 실패면 null.
 * 형식 오류·verifier 불일치·만료·재사용·미존재는 전부 `null` 하나로 수렴한다 — 호출부가 사유를 구분해 노출하면
 * "그 코드는 있지만 만료됐다" 같은 정보가 샌다.
 */
export async function consumeAppAuthCode(
  rawCode: unknown,
  rawVerifier: unknown,
  store: AppAuthCodeStore = defaultStore,
): Promise<number | null> {
  if (typeof rawCode !== 'string' || !APP_CODE_PATTERN.test(rawCode)) return null;
  if (!isPkceVerifier(rawVerifier)) return null;

  const stored = bindAppAuthCode(rawCode, pkceChallengeOf(rawVerifier));
  if ((await store.burn(stored)) !== 1) return null;

  // 소각에 성공했는데 행이 없을 수는 없다 — 방어적으로 실패로 수렴.
  return store.userIdOf(stored);
}
