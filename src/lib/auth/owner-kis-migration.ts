/**
 * T-011 — 기존 서버 계좌(`.env`/`system_config`)를 **소유자 계정 1개**로 옮기는 1회성 이관.
 *
 * ## 왜 UI 버튼이 아닌가
 *
 * 자연스러운 구현은 프로필에 "서버 계좌 가져오기" 버튼을 두는 것이다. **그것은 위험하다.**
 * 멀티테넌트 앱에서 그 버튼은 *미래의 어떤 회원이든 눌러서 소유자의 증권 자격증명을 자기
 * 계정으로 받아가는 경로*가 된다. 편의 기능이 곧 자격증명 유출 통로가 되므로, 재사용 가능한
 * 기능이 아니라 **조건이 만족될 때 딱 한 번 실행되고 스스로 소멸하는 부팅 코드**로 만든다.
 *
 * ## 발동 가드 — 하나라도 어긋나면 아무것도 하지 않고 마커도 남기지 않는다
 *
 *   1. `CREDENTIALS_ENCRYPTION_KEY` 설정됨 — **미설정이면 평문 저장 대신 아무것도 하지 않는다**
 *   2. `users` 행이 **정확히 1개** (단독 소유자 시점에만 성립)
 *   3. 그 유저의 KIS 자격증명 3개 컬럼이 **전부 비어 있음**
 *   4. KIS 설정값이 전부 존재하고 형식이 유효함
 *
 * ## 절차
 *
 *   1. KIS 값 해석 (호출 시점에 읽는다 — 모듈 로드 시점 캡처 금지)
 *   2. **실제 `POST /oauth2/tokenP` 발급으로 검증** — 검증 없이 자격증명을 복사하지 않는다.
 *      `/api/profile/kis` 와 **동일한 `verifyKisCredentials`** 를 쓴다(재구현하지 않는다).
 *   3. 성공 시에만 `encryptSecret()`(AES-256-GCM)로 암호화해 저장
 *   4. `user_settings` 를 **`system_config` 실값**으로 갱신 (가입 기본값이 아니라 라이브 값)
 *
 * ## 🔒 로그 규약
 *
 * App Key·App Secret·계좌번호 평문은 **어떤 로그·예외 메시지에도 남기지 않는다.**
 * 계좌번호는 `maskAccountNo()` 로만 표시하고, 키/시크릿은 존재 여부조차 값으로 찍지 않는다.
 *
 * ## ⚠️ 이관해도 매매 엔진은 바뀌지 않는다
 *
 * 회원별 KIS 클라이언트 파라미터화(Step 2)·엔진 멀티테넌트(Step 4)가 미구현이라,
 * 이 이관 후에도 cron·strategy-eval·exit-engine 은 여전히 전역 `.env`/`system_config` 로
 * 동작한다. 프로필의 "연결됨" 표시는 **표시일 뿐 실거래 로직에 영향이 없다.**
 * (T-008 의 "아직 매매 엔진에 연결되지 않았습니다" 배너가 그대로 그 사실을 알린다.)
 */
import type { RowDataPacket } from 'mysql2/promise';
import { getCredential } from '@/lib/credentials';
import { parseBoolFlag } from '@/lib/safety/flags';
import {
  maskAccountNo,
  scrub,
  validateKisAccountNo,
  validateKisProduct,
  verifyKisCredentials,
  type KisVerifyInput,
  type KisVerifyResult,
} from './kis-verify';
import { encryptSecret, isEncryptionConfigured } from './secret-box';
import {
  parseUserSettings,
  saveKisCredentials,
  saveUserSettings,
  validatePct,
  type SqlExecutor,
  type UserSettings,
} from './users';

/** `system_config` 마커 키 — db.ts 의 `runOnceMigration` 이 이 값으로 재실행을 막는다. */
export const OWNER_KIS_MIGRATION_MARKER = 'migration_t011_owner_kis_account';

/**
 * KIS 토큰 발급 전체(연결·요청·본문 수신)에 거는 상한.
 *
 * `verifyKisCredentials` 내부는 fetch 에 `AbortSignal.timeout(15s)` 를 건다. 그 15초는
 * **요청**만 덮으므로, 응답 본문 수신이 멈춰 서면 부팅이 무한정 매달릴 수 있다.
 * 바깥에서 20초(15s + 여유 5s)로 한 번 더 묶어 **부팅 경로가 어떤 경우에도 20초를 넘기지
 * 않도록** 보장한다. 안쪽이 먼저 끝나므로 정상 실패는 여전히 `verifyKisCredentials` 의
 * 친절한 고정 문구로 보고된다.
 */
export const OWNER_KIS_MIGRATION_TIMEOUT_MS = 20_000;

/** 조건 미충족 — 실패가 아니다. 마커를 남기지 않으므로 조건이 갖춰지면 다음 부팅에 재평가된다. */
export interface MigrationSkipped {
  skipped: string;
}

export interface OwnerKisMigrationDeps {
  /** mysql2 pool (테스트는 대역 주입). */
  db: SqlExecutor;
  /** `KIS_MOCK` 해석용. 기본값 `process.env`. */
  env?: NodeJS.ProcessEnv;
  /**
   * 자격증명 해석기. 기본값 `getCredential` — **매매 엔진과 완전히 같은 우선순위**
   * (`system_config.cred_<KEY>` > `.env`)로 읽는다. 자세한 이유는 `resolveKisSettings` 주석.
   */
  readCredential?: (envKey: string) => Promise<string>;
  /** 기본값 `verifyKisCredentials`. 테스트에서 실제 `tokenP` 호출을 막기 위해 주입한다. */
  verify?: (input: KisVerifyInput) => Promise<KisVerifyResult>;
  timeoutMs?: number;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

/** `user_settings` 필드 → 이관 원본이 되는 `system_config` 키. */
const SAFETY_SOURCE_KEYS: Record<keyof UserSettings, string> = {
  dryRun: 'safety_dry_run',
  killSwitch: 'safety_kill_switch',
  orderMaxPct: 'safety_order_max_pct',
  dailyOrderMaxPct: 'safety_daily_order_max_pct',
};

/**
 * `system_config` 키가 없거나 해석 불가일 때 쓰는 값 — 전부 **"거래하지 않는 쪽"** 이다.
 *   - `dryRun=true`  : 모의 = 주문 미송신 (`isDryRun()` 의 fail-safe 와 같은 방향)
 *   - `killSwitch=true`: 정지
 *   - pct = 0        : `order-limits` 의 "미설정 = 거부" 원칙과 같은 방향
 */
const FAILSAFE_SETTINGS: UserSettings = {
  dryRun: true,
  killSwitch: true,
  orderMaxPct: 0,
  dailyOrderMaxPct: 0,
};

const KIS_CREDENTIAL_COLUMNS = ['kis_app_key_enc', 'kis_app_secret_enc', 'kis_account_no_enc'] as const;

// ─── 유틸 ────────────────────────────────────────────────────────────────────

/** mysql2 의 `[rows, fields]` 튜플에서 rows 만 꺼낸다. */
async function selectRows(db: SqlExecutor, sql: string, params?: unknown[]): Promise<RowDataPacket[]> {
  const res = await db.query(sql, params);
  const rows = Array.isArray(res) ? res[0] : res;
  return Array.isArray(rows) ? (rows as RowDataPacket[]) : [];
}

/**
 * 부팅을 무한정 붙잡지 않게 상한을 건다.
 * 진 쪽 promise 는 `Promise.race` 가 이미 핸들러를 걸어 두므로 unhandled rejection 이 되지 않는다.
 */
export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} 이 ${ms}ms 안에 끝나지 않았다`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function nonEmpty(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * **남이 만든 예외**를 로그에 낼 수 있는 문자열로 바꾼다.
 *
 * 두 가지를 동시에 지킨다:
 *   - `message` 만 꺼낸다 — 예외 객체 전체(mysql2 의 `.sql`, fetch 의 request 등)를 찍지 않는다
 *   - 꺼낸 message 를 `kis-verify` 의 `scrub` 으로 한 번 더 훑는다 — 평문이 섞여 있었다면 `***` 로 지운다
 *
 * "우리가 만든 메시지니까 안전하다"는 가정은 catch 블록에서는 성립하지 않는다. 그 가정을
 * 주석으로만 적어 두었던 것이 reviewer HIGH 지적의 실체였다(2026-08-09).
 */
function scrubSecrets(e: unknown, secrets: string[]): string {
  const raw = e instanceof Error ? e.message : '알 수 없는 오류';
  return scrub(raw, secrets);
}

// ─── KIS 설정값 해석 ─────────────────────────────────────────────────────────

interface ResolvedKis {
  appKey: string;
  appSecret: string;
  accountNo: string;
  accountProduct: string;
  mock: boolean;
}

/**
 * `KIS_MOCK` 해석 — **엔진과 결론이 갈릴 수 있는 값은 아예 받지 않는다.**
 *
 * 엔진(`kis-auth.ts`·`kis-domestic.ts`·`kis-overseas.ts`)의 판정은
 * `String(process.env.KIS_MOCK ?? 'true').toLowerCase() === 'true'` 다 —
 * 즉 **정확히 `'true'` 가 아니면 전부 실전투자**다.
 * 반면 안전장치 플래그용 `parseBoolFlag` 는 `1`·`on`·`yes`·`y` 도 참으로 받는다. 그 값들에서
 * 두 해석은 **정반대 결론**(모의 vs 실전)을 낸다. 이 이관의 존재 이유가 "엔진이 실제로 쓰는
 * 값을 그대로 옮긴다"이므로 `parseBoolFlag` 를 쓰지 않는다. (reviewer MEDIUM, 2026-08-09)
 *
 * 다만 엔진 규칙을 **그대로 복사하지도 않는다.** 엔진은 미설정·오타를 조용히 한쪽으로 흘려보내지만
 * (미설정 → 모의, `yes` → 실전), 이 이관은 계좌의 실전/모의를 **단정해 DB 에 박아 넣는** 코드다.
 * 그래서 받아들이는 값을 `true`/`false` 둘로 좁히고 나머지는 전부 skip 한다. 결과적으로
 *   - 이관이 **진행되는** 모든 경우에 엔진과 결론이 100% 일치하고,
 *   - 둘의 해석이 갈리는 값(`1`·`on`·`yes`)에서는 애초에 아무것도 쓰지 않는다.
 * (leader 지시: "unset/unparsable ⇒ skip 가드는 유지" 와 "엔진 해석과 일치" 를 동시에 만족시키는 교집합)
 *
 * ⚠️ **`trim()` 을 하지 않는다.** 엔진 판정식에는 trim 이 없다 — `'  True  '` 를 엔진은
 *    `'  true  ' !== 'true'` 로 읽어 **실전**으로 본다. 여기서 trim 하면 같은 값을 **모의**로
 *    받아들여, 이 함수가 막으려던 바로 그 영구 오각인이 정규화를 통해 들어온다.
 *    (reviewer MEDIUM 2차, 2026-08-09 — 받아들이는 값은 엔진과 바이트 단위로 같아야 한다.)
 *    공백만 있는 값은 "미설정"으로 보아 skip 하므로, trim 제거로 통과 범위가 넓어지지 않는다.
 */
function parseEngineMockFlag(raw: unknown): { ok: true; mock: boolean } | { ok: false; reason: string } {
  const unsetReason = 'KIS_MOCK 미설정 — 실전/모의를 단정할 수 없어 이관하지 않는다';
  if (raw === null || raw === undefined) return { ok: false, reason: unsetReason };

  // 엔진과 동일한 정규화 — `String(v).toLowerCase()` 까지만. trim 은 넣지 않는다.
  const v = String(raw).toLowerCase();
  if (v.trim() === '') return { ok: false, reason: unsetReason };
  if (v === 'true') return { ok: true, mock: true };
  if (v === 'false') return { ok: true, mock: false };

  return {
    ok: false,
    // 값 자체를 JSON 으로 감싸 **앞뒤 공백이 눈에 보이게** 한다 — 이 값의 오해 원인 1순위다.
    reason:
      `KIS_MOCK 해석 불가(${JSON.stringify(String(raw))}) — 엔진은 'true' 가 아닌 값을 전부 실전으로 보지만, ` +
      '계좌 종류를 단정해 저장하는 이 이관은 애매한 값을 받지 않는다',
  };
}

/**
 * 이관할 KIS 값을 **라이브 매매 엔진과 똑같은 방법으로** 해석한다.
 *
 * ⚠️ 사양은 "`.env` 에서 읽는다"였지만, 이 앱의 실제 유효 자격증명은 `.env` 가 아니라
 *    `getCredential()` 의 결과다 — `system_config.cred_<KEY>`(설정>자격증명 화면에서 저장한 값)가
 *    있으면 그것이 `.env` 를 **이긴다**(`src/lib/credentials.ts`). 운영 DB 에는 실제로
 *    `cred_KIS_APP_KEY`·`cred_KIS_APP_SECRET`·`cred_KIS_ACCOUNT_NO`·`cred_KIS_ACCOUNT_PRODUCT`
 *    override 가 존재한다(2026-08-09 실측).
 *
 *    그래서 `.env` 만 읽으면 "엔진이 실제로 매매하는 계좌"가 아니라 **철 지난 값**을 이관할 수
 *    있다. 사양이 `system_config` 안전설정에 대해 세운 원칙("이관 시점의 라이브 값이 이긴다")을
 *    자격증명에도 그대로 적용해 `getCredential` 을 쓴다. override 가 없으면 결과는 `.env` 와
 *    동일하므로 사양과 어긋나지 않는다.
 *
 *    단 `KIS_MOCK` 만은 예외로 `process.env` 를 직접 읽는다 — 엔진(`kis-auth.ts`,
 *    `kis-domestic.ts`, `kis-overseas.ts`)이 이 값만은 `getCredential` 이 아니라
 *    `process.env.KIS_MOCK` 으로 읽기 때문이다. 해석 방법을 엔진과 일치시킨다.
 */
async function resolveKisSettings(
  deps: OwnerKisMigrationDeps,
): Promise<{ ok: true; value: ResolvedKis } | { ok: false; reason: string }> {
  const read = deps.readCredential ?? getCredential;
  const env = deps.env ?? process.env;

  const [appKeyRaw, appSecretRaw, accountNoRaw, productRaw] = await Promise.all([
    read('KIS_APP_KEY'),
    read('KIS_APP_SECRET'),
    read('KIS_ACCOUNT_NO'),
    read('KIS_ACCOUNT_PRODUCT'),
  ]);

  const appKey = nonEmpty(appKeyRaw);
  const appSecret = nonEmpty(appSecretRaw);
  const accountNo = nonEmpty(accountNoRaw);
  const product = nonEmpty(productRaw);

  // 결손 항목은 **이름만** 보고한다 — 값은 절대 담지 않는다.
  const missing: string[] = [];
  if (!appKey) missing.push('KIS_APP_KEY');
  if (!appSecret) missing.push('KIS_APP_SECRET');
  if (!accountNo) missing.push('KIS_ACCOUNT_NO');
  if (!product) missing.push('KIS_ACCOUNT_PRODUCT');
  if (missing.length > 0) return { ok: false, reason: `KIS 설정값 결손: ${missing.join(', ')}` };

  const mockFlag = parseEngineMockFlag(env.KIS_MOCK);
  if (!mockFlag.ok) return { ok: false, reason: mockFlag.reason };

  const acct = validateKisAccountNo(accountNo);
  if (!acct.ok) return { ok: false, reason: `KIS_ACCOUNT_NO 형식 오류 — ${acct.error}` };
  const prod = validateKisProduct(product);
  if (!prod.ok) return { ok: false, reason: `KIS_ACCOUNT_PRODUCT 형식 오류 — ${prod.error}` };

  return {
    ok: true,
    value: { appKey, appSecret, accountNo: acct.value, accountProduct: prod.value, mock: mockFlag.mock },
  };
}

// ─── system_config 실값 읽기 ────────────────────────────────────────────────

/**
 * 이관 대상 안전설정을 **이관 시점의 `system_config` 실값**에서 읽는다.
 * 하드코딩하지 않는 이유: 설계 시점과 배포 시점 사이에 운영자가 값을 바꿨다면 그 값이 진실이다.
 * 키가 없거나 해석 불가면 `FAILSAFE_SETTINGS`(거래하지 않는 쪽)로 떨어뜨리고 **크게 알린다.**
 */
async function readLiveSafetySettings(
  db: SqlExecutor,
  log: Pick<Console, 'log' | 'warn' | 'error'>,
): Promise<UserSettings> {
  const keys = Object.values(SAFETY_SOURCE_KEYS);
  const rows = await selectRows(
    db,
    `SELECT \`key\`, value FROM system_config WHERE \`key\` IN (${keys.map(() => '?').join(',')})`,
    keys,
  );

  const found = new Map<string, unknown>();
  for (const r of rows) {
    try {
      found.set(String(r.key), JSON.parse(String(r.value)));
    } catch {
      /* 손상된 값은 결손으로 취급 */
    }
  }

  const out: UserSettings = { ...FAILSAFE_SETTINGS };
  for (const field of Object.keys(SAFETY_SOURCE_KEYS) as (keyof UserSettings)[]) {
    const key = SAFETY_SOURCE_KEYS[field];
    const raw = found.get(key);
    const fallbackNote = `안전값 ${JSON.stringify(FAILSAFE_SETTINGS[field])} 로 이관한다`;

    if (raw === undefined) {
      log.error(`[T-011] ⚠️ system_config.${key} 가 없다 — ${fallbackNote}`);
      continue;
    }
    if (field === 'dryRun' || field === 'killSwitch') {
      const parsed = parseBoolFlag(raw);
      if (parsed.state !== 'parsed') {
        log.error(`[T-011] ⚠️ system_config.${key} 를 불리언으로 해석할 수 없다 — ${fallbackNote}`);
        continue;
      }
      out[field] = parsed.value;
    } else {
      const pct = validatePct(raw);
      if (!pct.ok) {
        log.error(`[T-011] ⚠️ system_config.${key} 가 유효한 %가 아니다(${pct.error}) — ${fallbackNote}`);
        continue;
      }
      out[field] = pct.value;
    }
  }
  return out;
}

/** 이관 전 회원 설정 — 로그에 "무엇이 바뀌었는지"를 남기기 위해 읽는다. */
async function readCurrentUserSettings(db: SqlExecutor, userId: number): Promise<UserSettings> {
  const rows = await selectRows(db, 'SELECT `key`, value FROM user_settings WHERE user_id = ?', [userId]);
  return parseUserSettings(rows.map((r) => ({ key: String(r.key), value: String(r.value) }))).settings;
}

/** `dry_run true→false` 형태로 변경분만 요약. 비밀값이 섞일 여지가 없는 값들만 다룬다. */
function describeSettingChanges(before: UserSettings, after: UserSettings): string {
  const parts: string[] = [];
  for (const field of Object.keys(SAFETY_SOURCE_KEYS) as (keyof UserSettings)[]) {
    if (before[field] === after[field]) continue;
    parts.push(`${field} ${JSON.stringify(before[field])}→${JSON.stringify(after[field])}`);
  }
  return parts.length > 0 ? parts.join(', ') : '변경 없음';
}

// ─── 본체 ────────────────────────────────────────────────────────────────────

/**
 * 소유자 계정 이관 1회 실행.
 *
 * @returns `undefined` = 이관 완료(호출부가 마커를 남긴다) /
 *          `{ skipped }` = 조건 미충족(마커 없음, 다음 부팅 재평가) /
 *          throw = 실패(마커 없음, 다음 부팅 재시도)
 */
export async function migrateOwnerKisAccount(
  deps: OwnerKisMigrationDeps,
): Promise<void | MigrationSkipped> {
  const log = deps.logger ?? console;
  const verify = deps.verify ?? verifyKisCredentials;
  const timeoutMs = deps.timeoutMs ?? OWNER_KIS_MIGRATION_TIMEOUT_MS;

  // ── 가드 1: 암호화 키 ──────────────────────────────────────────────────────
  // 가장 먼저 본다. 키가 없으면 저장할 방법이 **평문뿐**이고 평문은 금지이므로, KIS 를
  // 호출조차 하지 않는다(앱키당 "1분에 1회" 발급 제한을 헛되이 소모하지 않는다).
  // `/api/profile/kis` 가 KIS 호출 전에 같은 점검을 두는 것과 동일한 순서다.
  if (!isEncryptionConfigured()) {
    return { skipped: 'CREDENTIALS_ENCRYPTION_KEY 미설정 — 평문 저장 금지 원칙에 따라 아무것도 저장하지 않는다' };
  }

  // ── 가드 2: users 가 정확히 1행 ────────────────────────────────────────────
  // LIMIT 2 로 "정확히 1개"만 판별한다(전수 스캔 불필요).
  const users = await selectRows(
    deps.db,
    `SELECT id, ${KIS_CREDENTIAL_COLUMNS.join(', ')} FROM users ORDER BY id LIMIT 2`,
  );
  if (users.length !== 1) {
    return {
      skipped: users.length === 0
        ? 'users 가 0행 — 이관할 소유자 계정이 없다'
        : 'users 가 2행 이상 — 단독 소유자 시점에만 적용되는 이관이다',
    };
  }

  const row = users[0];
  const userId = Number(row.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return { skipped: 'users.id 를 정수로 읽지 못했다' };
  }

  // ── 가드 3: KIS 자격증명이 전부 비어 있음 ──────────────────────────────────
  // 하나라도 차 있으면 회원이 이미 자기 계좌를 연결한 것이다 — 덮어쓰지 않는다.
  const filled = KIS_CREDENTIAL_COLUMNS.filter((c) => nonEmpty(row[c]).length > 0);
  if (filled.length > 0) {
    return { skipped: `user=${userId} 에 이미 KIS 자격증명이 있다(${filled.join(', ')}) — 덮어쓰지 않는다` };
  }

  // ── 가드 4: KIS 설정값 ─────────────────────────────────────────────────────
  const resolved = await resolveKisSettings(deps);
  if (!resolved.ok) return { skipped: resolved.reason };
  const { appKey, appSecret, accountNo, accountProduct, mock } = resolved.value;

  // ── 실검증 — 여기를 통과하지 못하면 저장 경로로 갈 수 없다 ────────────────
  let verified: KisVerifyResult;
  try {
    verified = await withTimeout(
      verify({ appKey, appSecret, mock }),
      timeoutMs,
      'KIS 토큰 발급(POST /oauth2/tokenP)',
    );
  } catch (e) {
    // ⚠️ **잡은 예외의 message 는 우리가 만든 문자열이 아니다.** fetch 계열 예외에는 요청 본문
    //    (=앱키·시크릿)이 실려 올 수 있으므로, 로그로 내보내기 전에 반드시 스크러버를 통과시킨다.
    //    (kis-verify 의 `scrub` 을 그대로 재사용 — 필터가 두 벌이 되면 한쪽만 낡는다.)
    const reason = scrubSecrets(e, [appKey, appSecret, accountNo]);
    log.error(
      `[T-011] ❌ KIS 자격증명 검증을 끝내지 못했다 — ${reason}. ` +
      '아무것도 저장하지 않았고 마커도 남기지 않는다(다음 부팅 재시도).',
    );
    throw new Error('T-011 이관 중단: KIS 자격증명 검증 실패');
  }
  if (!verified.ok) {
    // `verified.message` 는 kis-verify 가 고정 문구로 변환하고 scrub 까지 마친 값이다.
    log.error(
      `[T-011] ❌ KIS 자격증명 검증 실패 — ${verified.message}. ` +
      '아무것도 저장하지 않았고 마커도 남기지 않는다(다음 부팅 재시도).',
    );
    throw new Error('T-011 이관 중단: KIS 자격증명 검증 실패');
  }

  // ── 저장 ───────────────────────────────────────────────────────────────────
  const target = await readLiveSafetySettings(deps.db, log);
  const before = await readCurrentUserSettings(deps.db, userId);

  try {
    // ⚠️ 쓰기 순서가 곧 재시도 안전성이다: **user_settings 를 먼저, 자격증명을 나중에.**
    //    자격증명을 먼저 쓰면 그 직후 실패했을 때 마커는 없지만 가드 3 이 다음 부팅을 막아
    //    **설정 이관만 영구히 누락**된다. 반대 순서면 어느 지점에서 끊겨도 가드 3 이 계속
    //    열려 있어 다음 부팅에 전체가 재시도된다(두 UPDATE 모두 idempotent).
    await saveUserSettings(userId, target, deps.db);
    await saveKisCredentials(
      userId,
      {
        appKeyEnc: encryptSecret(appKey),
        appSecretEnc: encryptSecret(appSecret),
        accountNoEnc: encryptSecret(accountNo),
        accountProduct,
        mock,
        // 방금 받은 토큰은 **저장하지 않는다.** 회원별 실행 경로가 아직 배선되지 않아(Step 2·4)
        // 아무도 쓰지 않을 평문 토큰이 DB 에 남을 뿐이다. 전역 캐시에도 쓰지 않는다
        // (kis-verify 주석 참조 — 엔진 토큰을 갈아끼우지 않는다).
        accessToken: null,
        accessTokenExpiresAt: null,
      },
      deps.db,
    );
  } catch (e) {
    // DB 드라이버 예외도 남의 문자열이다(mysql2 는 쿼리 텍스트를 메시지에 실어 오기도 한다).
    // 파라미터는 암호문이지만, 원칙을 예외 경로마다 다르게 두지 않는다 — 여기도 스크러빙한다.
    const reason = scrubSecrets(e, [appKey, appSecret, accountNo]);
    log.error(
      `[T-011] ❌ 저장 실패 — ${reason}. 마커를 남기지 않으므로 다음 부팅에 전체가 재시도된다.`,
    );
    // ⚠️ **원본 예외를 그대로 re-throw 하지 않는다.** 호출부인 `runOnceMigration` 은 범용
    //    러너라 어떤 값이 비밀인지 알 수 없어 `e.message` 를 **스크러빙 없이** console.warn 한다
    //    (db.ts). 즉 여기서 `throw e` 를 하면 위에서 애써 지운 평문이 그 로그로 새어 나간다.
    //    검증 실패 경로와 똑같이 **고정 문구의 새 Error** 로 바꿔 던진다 — 진단에 필요한 내용은
    //    바로 위 log.error 가 이미(스크러빙된 상태로) 남겼다. `cause` 도 붙이지 않는다.
    //    (reviewer HIGH 2차, 2026-08-09)
    throw new Error('T-011 이관 중단: 저장 실패');
  }

  log.log(
    `[T-011] ✅ 소유자 계정 이관 완료 — user=${userId}, ` +
    `KIS 계좌 ${maskAccountNo(accountNo)}(상품코드 ${accountProduct}, ${mock ? '모의투자' : '실전투자'}), ` +
    'App Key·App Secret·계좌번호 3건 AES-256-GCM 암호화 저장. ' +
    `안전설정(system_config 실값 기준): ${describeSettingChanges(before, target)}`,
  );
  log.log(
    '[T-011] ⚠️ 표시 전용이다 — 매매 엔진(cron·strategy-eval·exit-engine)은 여전히 ' +
    '전역 .env/system_config 로 동작한다(Step 2·4 미구현).',
  );
}
