/**
 * T-011 소유자 계정 이관 — 발동 가드·검증 실패·저장·멱등성 테스트.
 *
 * ⚠️ **실제 KIS `tokenP` 호출은 절대 하지 않는다.** `verify` 를 전부 주입한다.
 *    `readCredential` 도 주입해 운영 `.env`·DB 를 건드리지 않는다.
 */
import { randomBytes } from 'node:crypto';
import { runOnceMigration } from '@/lib/db';
import { decryptSecret } from '../secret-box';
import {
  OWNER_KIS_MIGRATION_MARKER,
  migrateOwnerKisAccount,
  type MigrationSkipped,
  type OwnerKisMigrationDeps,
} from '../owner-kis-migration';

const ORIG_KEY = process.env.CREDENTIALS_ENCRYPTION_KEY;
const TEST_KEY = randomBytes(32).toString('base64');

const APP_KEY = 'PSxxAppKey0123456789abcdefghijklmnop';
const APP_SECRET = 'SEC' + 'x'.repeat(177);
const ACCOUNT_NO = '50123456';

beforeEach(() => { process.env.CREDENTIALS_ENCRYPTION_KEY = TEST_KEY; });
afterAll(() => {
  if (ORIG_KEY === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY;
  else process.env.CREDENTIALS_ENCRYPTION_KEY = ORIG_KEY;
});

// ─── 대역 ────────────────────────────────────────────────────────────────────

interface Recorded { sql: string; params: unknown[] }

interface FakeDbOptions {
  users?: Record<string, unknown>[];
  systemConfig?: Record<string, string>;
  userSettings?: Record<string, string>;
  /** 이 패턴에 맞는 SQL 에서 예외를 던진다 (저장 실패 시뮬레이션). */
  failOn?: RegExp;
  /** 그 예외의 message. 기본값은 무해한 문구 — 평문 유출 회귀 테스트에서만 바꾼다. */
  failMessage?: string;
  /** `runOnceMigration` 의 마커 조회 결과. true 면 "이미 적용됨". */
  markerPresent?: boolean;
}

function makeDb(opts: FakeDbOptions = {}) {
  const calls: Recorded[] = [];
  const kv = (m: Record<string, string> | undefined) =>
    Object.entries(m ?? {}).map(([key, value]) => ({ key, value }));

  const db = {
    async query(sql: string, params: unknown[] = []): Promise<unknown> {
      calls.push({ sql, params });
      if (opts.failOn?.test(sql)) throw new Error(opts.failMessage ?? 'DB 쓰기 실패(테스트)');
      // runOnceMigration 의 마커 조회 — 아래 일반 system_config 분기보다 먼저 잡아야 한다.
      if (/WHERE `key` = \? LIMIT 1/.test(sql)) {
        return [opts.markerPresent ? [{ key: String(params[0]) }] : [], []];
      }
      if (/FROM users/i.test(sql)) return [opts.users ?? [], []];
      if (/FROM system_config/i.test(sql)) return [kv(opts.systemConfig), []];
      if (/FROM user_settings/i.test(sql)) return [kv(opts.userSettings), []];
      return [{ affectedRows: 1 }, []];
    },
  };
  return { db, calls };
}

/** 실제 운영값과 같은 라이브 안전설정 (T-011 실측: dry_run=false, kill_switch=true, 6 / 10). */
const LIVE_SYSTEM_CONFIG = {
  safety_dry_run: 'false',
  safety_kill_switch: 'true',
  safety_order_max_pct: '6',
  safety_daily_order_max_pct: '10',
};

/** 가입 기본값 (T-008 DEFAULT_USER_SETTINGS). */
const SIGNUP_DEFAULT_SETTINGS = {
  dry_run: 'true',
  kill_switch: 'false',
  order_max_pct: '5',
  daily_order_max_pct: '10',
};

const OWNER_ROW = {
  id: 1,
  kis_app_key_enc: null,
  kis_app_secret_enc: null,
  kis_account_no_enc: null,
};

function makeLogger() {
  const lines: string[] = [];
  const push = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  return { lines, logger: { log: push, warn: push, error: push } };
}

const CREDENTIALS: Record<string, string> = {
  KIS_APP_KEY: APP_KEY,
  KIS_APP_SECRET: APP_SECRET,
  KIS_ACCOUNT_NO: ACCOUNT_NO,
  KIS_ACCOUNT_PRODUCT: '01',
};

function makeDeps(over: Partial<OwnerKisMigrationDeps> & { db: OwnerKisMigrationDeps['db'] }): OwnerKisMigrationDeps {
  return {
    env: { KIS_MOCK: 'false' } as NodeJS.ProcessEnv,
    readCredential: async (k: string) => CREDENTIALS[k] ?? '',
    verify: async () => ({ ok: true, accessToken: 'tok-abc', expiresAt: new Date(Date.now() + 86_400_000) }),
    logger: makeLogger().logger,
    ...over,
  };
}

/** 쓰기(INSERT/UPDATE/DELETE) 가 한 건도 없었는가. */
function writes(calls: Recorded[]): Recorded[] {
  return calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(c.sql));
}

function asSkipped(r: void | MigrationSkipped): MigrationSkipped {
  if (!r || typeof r.skipped !== 'string') throw new Error(`skip 을 기대했으나 ${JSON.stringify(r)} 를 받았다`);
  return r;
}

// ─── 가드: 마커를 남기지 않고 조용히 건너뛴다 ───────────────────────────────

describe('발동 가드 — 조건 미충족이면 skip (마커 없음, 쓰기 없음)', () => {
  test('users 0행 → skip, 검증 호출 없음', async () => {
    const { db, calls } = makeDb({ users: [] });
    const verify = jest.fn();
    const r = asSkipped(await migrateOwnerKisAccount(makeDeps({ db, verify })));

    expect(r.skipped).toContain('0행');
    expect(verify).not.toHaveBeenCalled();
    expect(writes(calls)).toHaveLength(0);
  });

  test('users 2행 이상 → skip (단독 소유자 시점에만 적용)', async () => {
    const { db, calls } = makeDb({ users: [OWNER_ROW, { ...OWNER_ROW, id: 2 }] });
    const verify = jest.fn();
    const r = asSkipped(await migrateOwnerKisAccount(makeDeps({ db, verify })));

    expect(r.skipped).toContain('2행 이상');
    expect(verify).not.toHaveBeenCalled();
    expect(writes(calls)).toHaveLength(0);
  });

  test('이미 KIS 자격증명이 있는 계정 → skip (덮어쓰지 않는다)', async () => {
    const { db, calls } = makeDb({
      users: [{ ...OWNER_ROW, kis_app_key_enc: 'gcm1.aa.bb.cc' }],
    });
    const verify = jest.fn();
    const r = asSkipped(await migrateOwnerKisAccount(makeDeps({ db, verify })));

    expect(r.skipped).toContain('이미 KIS 자격증명이 있다');
    expect(r.skipped).toContain('kis_app_key_enc');
    expect(verify).not.toHaveBeenCalled();
    expect(writes(calls)).toHaveLength(0);
  });

  test.each([
    ['KIS_APP_KEY'],
    ['KIS_APP_SECRET'],
    ['KIS_ACCOUNT_NO'],
    ['KIS_ACCOUNT_PRODUCT'],
  ])('%s 결손 → skip', async (missing) => {
    const { db, calls } = makeDb({ users: [OWNER_ROW] });
    const verify = jest.fn();
    const r = asSkipped(await migrateOwnerKisAccount(makeDeps({
      db,
      verify,
      readCredential: async (k: string) => (k === missing ? '' : CREDENTIALS[k] ?? ''),
    })));

    expect(r.skipped).toContain('KIS 설정값 결손');
    expect(r.skipped).toContain(missing);
    expect(verify).not.toHaveBeenCalled();
    expect(writes(calls)).toHaveLength(0);
  });

  test('KIS_MOCK 미설정 → skip (실전/모의를 단정할 수 없다)', async () => {
    const { db, calls } = makeDb({ users: [OWNER_ROW] });
    const verify = jest.fn();
    const r = asSkipped(await migrateOwnerKisAccount(makeDeps({ db, verify, env: {} as NodeJS.ProcessEnv })));

    expect(r.skipped).toContain('KIS_MOCK 미설정');
    expect(verify).not.toHaveBeenCalled();
    expect(writes(calls)).toHaveLength(0);
  });

  test('KIS_MOCK 해석 불가 → skip', async () => {
    const { db } = makeDb({ users: [OWNER_ROW] });
    const r = asSkipped(await migrateOwnerKisAccount(makeDeps({
      db, verify: jest.fn(), env: { KIS_MOCK: 'maybe' } as NodeJS.ProcessEnv,
    })));
    expect(r.skipped).toContain('KIS_MOCK 해석 불가');
  });

  /**
   * reviewer MEDIUM (2026-08-09, 2차) — **엔진 판정식을 그대로 옮겨 적은 복사본.**
   *
   * 출처(세 곳 모두 동일): `src/lib/exchanges/kis-auth.ts:13`, `kis-domestic.ts:9`,
   * `kis-overseas.ts:36` — `String(process.env.KIS_MOCK ?? 'true').toLowerCase() === 'true'`.
   *
   * 이관 구현의 규칙을 다시 쓴 것이 **아니다.** 앞선 버전은 기대값을
   * `String(raw).trim().toLowerCase() === 'true'`(= 구현 자신의 규칙)로 계산해서
   * 구현을 구현으로 검증하는 순환 테스트였고, 그래서 `trim()` 발산을 잡지 못했다.
   */
  const engineIsMock = (raw: string | undefined): boolean =>
    String(raw ?? 'true').toLowerCase() === 'true';

  const MOCK_CANDIDATES = [
    'true', 'false', 'TRUE', 'False',
    '  True  ', 'true ', ' false',          // 공백 — 엔진은 'true' 와 다르게 본다
    '1', 'on', 'yes', 'y', '0', 'off', 'no', 'n',  // parseBoolFlag 는 참/거짓으로 읽는 값들
    'maybe', '', '   ',
  ];

  test.each(MOCK_CANDIDATES)(
    'KIS_MOCK=%j — 이관이 진행된다면 결론이 엔진과 반드시 일치한다',
    async (raw) => {
      const { db, calls } = makeDb({
        users: [OWNER_ROW], systemConfig: LIVE_SYSTEM_CONFIG, userSettings: SIGNUP_DEFAULT_SETTINGS,
      });
      const verify = jest.fn(async () => ({ ok: true as const, accessToken: 't', expiresAt: new Date() }));
      const r = await migrateOwnerKisAccount(makeDeps({
        db, verify, env: { KIS_MOCK: raw } as NodeJS.ProcessEnv,
      }));

      if (r && typeof r.skipped === 'string') {
        // 애매한 값 → 아무것도 쓰지 않는다. 엔진과 어긋날 여지 자체가 없다.
        expect(verify).not.toHaveBeenCalled();
        expect(writes(calls)).toHaveLength(0);
        return;
      }
      // 진행했다면 엔진의 판정식과 **바이트 단위로 같은 결론**이어야 한다.
      expect(verify).toHaveBeenCalledWith(expect.objectContaining({ mock: engineIsMock(raw) }));
    },
  );

  test('위 파리티 테스트가 공허하지 않다 — true/false 는 실제로 이관이 진행된다', async () => {
    for (const [raw, expectedMock] of [['true', true], ['false', false]] as [string, boolean][]) {
      const { db } = makeDb({
        users: [OWNER_ROW], systemConfig: LIVE_SYSTEM_CONFIG, userSettings: SIGNUP_DEFAULT_SETTINGS,
      });
      const verify = jest.fn(async () => ({ ok: true as const, accessToken: 't', expiresAt: new Date() }));
      const r = await migrateOwnerKisAccount(makeDeps({
        db, verify, env: { KIS_MOCK: raw } as NodeJS.ProcessEnv,
      }));

      expect(r).toBeUndefined();
      expect(verify).toHaveBeenCalledWith(expect.objectContaining({ mock: expectedMock }));
      expect(engineIsMock(raw)).toBe(expectedMock);
    }
  });

  test('앞뒤 공백이 붙은 값은 skip — 엔진은 실전으로 보므로 모의로 각인하면 안 된다', async () => {
    const { db, calls } = makeDb({ users: [OWNER_ROW] });
    const verify = jest.fn();
    const r = asSkipped(await migrateOwnerKisAccount(makeDeps({
      db, verify, env: { KIS_MOCK: '  True  ' } as NodeJS.ProcessEnv,
    })));

    expect(engineIsMock('  True  ')).toBe(false);   // 엔진: 실전
    expect(r.skipped).toContain('KIS_MOCK 해석 불가');
    expect(r.skipped).toContain('"  True  "');      // 로그에서 공백이 보여야 진단이 된다
    expect(verify).not.toHaveBeenCalled();
    expect(writes(calls)).toHaveLength(0);
  });

  test('계좌번호 형식 오류 → skip', async () => {
    const { db, calls } = makeDb({ users: [OWNER_ROW] });
    const verify = jest.fn();
    const r = asSkipped(await migrateOwnerKisAccount(makeDeps({
      db, verify,
      readCredential: async (k: string) => (k === 'KIS_ACCOUNT_NO' ? '12' : CREDENTIALS[k] ?? ''),
    })));

    expect(r.skipped).toContain('KIS_ACCOUNT_NO 형식 오류');
    expect(verify).not.toHaveBeenCalled();
    expect(writes(calls)).toHaveLength(0);
  });

  test('CREDENTIALS_ENCRYPTION_KEY 미설정 → skip. DB 조회조차 하지 않는다 (평문 저장 금지)', async () => {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    const { db, calls } = makeDb({ users: [OWNER_ROW] });
    const verify = jest.fn();
    const r = asSkipped(await migrateOwnerKisAccount(makeDeps({ db, verify })));

    expect(r.skipped).toContain('CREDENTIALS_ENCRYPTION_KEY 미설정');
    expect(verify).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });
});

// ─── 검증 실패 — 아무것도 저장하지 않고 마커도 남기지 않는다 ────────────────

describe('KIS 실검증 — 통과하지 못하면 저장 경로로 갈 수 없다', () => {
  test('검증 실패 → throw, 쓰기 0건', async () => {
    const { db, calls } = makeDb({ users: [OWNER_ROW], systemConfig: LIVE_SYSTEM_CONFIG });
    const { lines, logger } = makeLogger();

    await expect(migrateOwnerKisAccount(makeDeps({
      db, logger,
      verify: async () => ({ ok: false, message: 'KIS 인증에 실패했습니다. App Key·App Secret 과 계좌 종류를 확인하세요' }),
    }))).rejects.toThrow(/이관 중단/);

    expect(writes(calls)).toHaveLength(0);
    expect(lines.join('\n')).toContain('마커도 남기지 않는다');
  });

  test('검증이 타임아웃 → throw, 쓰기 0건 (부팅이 무한정 매달리지 않는다)', async () => {
    const { db, calls } = makeDb({ users: [OWNER_ROW], systemConfig: LIVE_SYSTEM_CONFIG });

    await expect(migrateOwnerKisAccount(makeDeps({
      db,
      timeoutMs: 10,
      verify: () => new Promise(() => { /* 영원히 응답 없음 */ }),
    }))).rejects.toThrow(/이관 중단/);

    expect(writes(calls)).toHaveLength(0);
  });

  test('검증 함수가 예외를 던져도 저장하지 않는다', async () => {
    const { db, calls } = makeDb({ users: [OWNER_ROW], systemConfig: LIVE_SYSTEM_CONFIG });

    await expect(migrateOwnerKisAccount(makeDeps({
      db,
      verify: async () => { throw new Error(`요청 본문에 ${APP_SECRET} 이 섞인 예외`); },
    }))).rejects.toThrow(/이관 중단/);

    expect(writes(calls)).toHaveLength(0);
  });

  /**
   * reviewer HIGH (2026-08-09): 잡은 예외의 message 는 **우리가 만든 문자열이 아니다.**
   * 이 테스트는 로거 출력 자체를 검사한다 — `scrubSecrets` 를 걷어내면 반드시 실패한다
   * (기존 테스트는 DB 파라미터만 봤기 때문에 이 회귀를 통과시켰다).
   */
  test('🔒 검증 예외에 평문이 실려 와도 로그에는 남지 않는다 (scrub 제거 시 실패해야 하는 테스트)', async () => {
    const { db } = makeDb({ users: [OWNER_ROW], systemConfig: LIVE_SYSTEM_CONFIG });
    const { lines, logger } = makeLogger();

    await expect(migrateOwnerKisAccount(makeDeps({
      db,
      logger,
      verify: async () => {
        throw new Error(
          `fetch failed: POST /oauth2/tokenP body={"appkey":"${APP_KEY}","appsecret":"${APP_SECRET}"} acct=${ACCOUNT_NO}`,
        );
      },
    }))).rejects.toThrow(/이관 중단/);

    const text = lines.join('\n');
    expect(text).toContain('KIS 자격증명 검증을 끝내지 못했다');   // 진단 문맥은 남는다
    expect(text).toContain('***');                                 // 평문 자리는 지워졌다
    expect(text).not.toContain(APP_KEY);
    expect(text).not.toContain(APP_SECRET);
    expect(text).not.toContain(ACCOUNT_NO);
  });

  test('🔒 타임아웃 예외 메시지도 스크러빙 경로를 지난다', async () => {
    const { db } = makeDb({ users: [OWNER_ROW], systemConfig: LIVE_SYSTEM_CONFIG });
    const { lines, logger } = makeLogger();

    await expect(migrateOwnerKisAccount(makeDeps({
      db, logger, timeoutMs: 10,
      verify: () => new Promise(() => { /* 영원히 응답 없음 */ }),
    }))).rejects.toThrow(/이관 중단/);

    const text = lines.join('\n');
    expect(text).toContain('10ms 안에 끝나지 않았다');
    expect(text).not.toContain(APP_SECRET);
  });

  test('검증에는 해석된 KIS 값과 mock 이 그대로 전달된다', async () => {
    const { db } = makeDb({ users: [OWNER_ROW], systemConfig: LIVE_SYSTEM_CONFIG });
    const verify = jest.fn(async () => ({ ok: true as const, accessToken: 't', expiresAt: new Date() }));

    await migrateOwnerKisAccount(makeDeps({ db, verify, env: { KIS_MOCK: 'true' } as NodeJS.ProcessEnv }));

    expect(verify).toHaveBeenCalledWith({ appKey: APP_KEY, appSecret: APP_SECRET, mock: true });
  });
});

// ─── 성공 경로 ───────────────────────────────────────────────────────────────

describe('성공 — 암호문 저장 + system_config 실값으로 설정 이관', () => {
  function findWrite(calls: Recorded[], re: RegExp): Recorded {
    const hit = calls.find((c) => re.test(c.sql));
    if (!hit) throw new Error(`쿼리를 찾지 못했다: ${re}`);
    return hit;
  }

  test('users 에 AES-256-GCM 암호문 3건 + mock/상품코드/연결시각', async () => {
    const { db, calls } = makeDb({
      users: [OWNER_ROW],
      systemConfig: LIVE_SYSTEM_CONFIG,
      userSettings: SIGNUP_DEFAULT_SETTINGS,
    });

    const r = await migrateOwnerKisAccount(makeDeps({ db }));
    expect(r).toBeUndefined();   // undefined = 호출부가 마커를 남긴다

    const upd = findWrite(calls, /^\s*UPDATE users/i);
    expect(upd.sql).toContain('kis_connected_at = NOW()');

    const [keyEnc, secretEnc, acctEnc, product, mockFlag, token, tokenExp, userId] = upd.params as string[];
    expect(keyEnc.startsWith('gcm1.')).toBe(true);
    expect(secretEnc.startsWith('gcm1.')).toBe(true);
    expect(acctEnc.startsWith('gcm1.')).toBe(true);
    expect(decryptSecret(keyEnc)).toBe(APP_KEY);
    expect(decryptSecret(secretEnc)).toBe(APP_SECRET);
    expect(decryptSecret(acctEnc)).toBe(ACCOUNT_NO);
    expect(product).toBe('01');
    expect(mockFlag).toBe(0);            // KIS_MOCK=false → 실전
    expect(token).toBeNull();            // 토큰은 저장하지 않는다 (미배선 경로의 평문 최소화)
    expect(tokenExp).toBeNull();
    expect(userId).toBe(1);
  });

  test('평문이 SQL 파라미터에 절대 들어가지 않는다', async () => {
    const { db, calls } = makeDb({
      users: [OWNER_ROW], systemConfig: LIVE_SYSTEM_CONFIG, userSettings: SIGNUP_DEFAULT_SETTINGS,
    });
    await migrateOwnerKisAccount(makeDeps({ db }));

    const flat = JSON.stringify(calls);
    expect(flat).not.toContain(APP_KEY);
    expect(flat).not.toContain(APP_SECRET);
    expect(flat).not.toContain(ACCOUNT_NO);
  });

  test('user_settings 는 가입 기본값이 아니라 system_config 실값으로 갱신된다', async () => {
    const { db, calls } = makeDb({
      users: [OWNER_ROW], systemConfig: LIVE_SYSTEM_CONFIG, userSettings: SIGNUP_DEFAULT_SETTINGS,
    });
    await migrateOwnerKisAccount(makeDeps({ db }));

    const written = new Map<string, string>();
    for (const c of calls) {
      if (!/^\s*INSERT INTO user_settings/i.test(c.sql)) continue;
      const [uid, key, value] = c.params as [number, string, string];
      expect(uid).toBe(1);
      written.set(key, value);
    }
    expect(Object.fromEntries(written)).toEqual({
      dry_run: 'false',              // true(가입 기본값) → false(실거래)
      kill_switch: 'true',           // false → true(비상정지)
      order_max_pct: '6',            // 5 → 6
      daily_order_max_pct: '10',
    });
  });

  test('설정 갱신이 자격증명 저장보다 **먼저** 일어난다 (중간 실패 시 재시도 가능성 보존)', async () => {
    const { db, calls } = makeDb({
      users: [OWNER_ROW], systemConfig: LIVE_SYSTEM_CONFIG, userSettings: SIGNUP_DEFAULT_SETTINGS,
    });
    await migrateOwnerKisAccount(makeDeps({ db }));

    const firstSettings = calls.findIndex((c) => /^\s*INSERT INTO user_settings/i.test(c.sql));
    const credUpdate = calls.findIndex((c) => /^\s*UPDATE users/i.test(c.sql));
    expect(firstSettings).toBeGreaterThanOrEqual(0);
    expect(credUpdate).toBeGreaterThan(firstSettings);
  });

  test('운영자가 값을 바꿨다면 그 값이 이긴다 (하드코딩이 아니다)', async () => {
    const { db, calls } = makeDb({
      users: [OWNER_ROW],
      systemConfig: {
        safety_dry_run: 'true',
        safety_kill_switch: 'false',
        safety_order_max_pct: '3',
        safety_daily_order_max_pct: '7',
      },
      userSettings: SIGNUP_DEFAULT_SETTINGS,
    });
    await migrateOwnerKisAccount(makeDeps({ db }));

    const written = new Map<string, string>();
    for (const c of calls) {
      if (!/^\s*INSERT INTO user_settings/i.test(c.sql)) continue;
      const [, key, value] = c.params as [number, string, string];
      written.set(key, value);
    }
    expect(Object.fromEntries(written)).toEqual({
      dry_run: 'true', kill_switch: 'false', order_max_pct: '3', daily_order_max_pct: '7',
    });
  });

  test('로그에 계좌번호는 마스킹되고 키·시크릿 평문은 없다', async () => {
    const { db } = makeDb({
      users: [OWNER_ROW], systemConfig: LIVE_SYSTEM_CONFIG, userSettings: SIGNUP_DEFAULT_SETTINGS,
    });
    const { lines, logger } = makeLogger();
    await migrateOwnerKisAccount(makeDeps({ db, logger }));

    const text = lines.join('\n');
    expect(text).toContain('user=1');
    expect(text).toContain('50****56');           // maskAccountNo
    expect(text).toContain('dryRun true→false');
    expect(text).toContain('killSwitch false→true');
    expect(text).toContain('orderMaxPct 5→6');
    expect(text).not.toContain(APP_KEY);
    expect(text).not.toContain(APP_SECRET);
    expect(text).not.toContain(ACCOUNT_NO);
    expect(text).not.toContain(TEST_KEY);
  });
});

// ─── system_config 키 결손 → 안전값 + 큰 경고 ──────────────────────────────

describe('system_config 키 결손 — 안전한 쪽으로 떨어지고 크게 알린다', () => {
  test('4개 키가 모두 없으면 거래 중단 방향(dry_run=true, kill_switch=true, 0%)으로 이관', async () => {
    const { db, calls } = makeDb({
      users: [OWNER_ROW], systemConfig: {}, userSettings: SIGNUP_DEFAULT_SETTINGS,
    });
    const { lines, logger } = makeLogger();
    await migrateOwnerKisAccount(makeDeps({ db, logger }));

    const written = new Map<string, string>();
    for (const c of calls) {
      if (!/^\s*INSERT INTO user_settings/i.test(c.sql)) continue;
      const [, key, value] = c.params as [number, string, string];
      written.set(key, value);
    }
    expect(Object.fromEntries(written)).toEqual({
      dry_run: 'true', kill_switch: 'true', order_max_pct: '0', daily_order_max_pct: '0',
    });

    const text = lines.join('\n');
    for (const key of ['safety_dry_run', 'safety_kill_switch', 'safety_order_max_pct', 'safety_daily_order_max_pct']) {
      expect(text).toContain(`system_config.${key} 가 없다`);
    }
  });

  test('해석 불가 값도 안전값으로 떨어뜨리고 경고한다', async () => {
    const { db, calls } = makeDb({
      users: [OWNER_ROW],
      systemConfig: { ...LIVE_SYSTEM_CONFIG, safety_dry_run: '"nope"', safety_order_max_pct: '"abc"' },
      userSettings: SIGNUP_DEFAULT_SETTINGS,
    });
    const { lines, logger } = makeLogger();
    await migrateOwnerKisAccount(makeDeps({ db, logger }));

    const written = new Map<string, string>();
    for (const c of calls) {
      if (!/^\s*INSERT INTO user_settings/i.test(c.sql)) continue;
      const [, key, value] = c.params as [number, string, string];
      written.set(key, value);
    }
    expect(written.get('dry_run')).toBe('true');       // 안전값
    expect(written.get('order_max_pct')).toBe('0');    // 안전값
    expect(written.get('kill_switch')).toBe('true');   // 정상 읽힌 실값

    const text = lines.join('\n');
    expect(text).toContain('safety_dry_run');
    expect(text).toContain('safety_order_max_pct');
  });
});

// ─── 저장 실패 & 멱등성 ─────────────────────────────────────────────────────

describe('저장 실패 / 멱등성', () => {
  test('자격증명 UPDATE 실패 → throw (마커 미기록 → 다음 부팅 재시도)', async () => {
    const { db } = makeDb({
      users: [OWNER_ROW], systemConfig: LIVE_SYSTEM_CONFIG, userSettings: SIGNUP_DEFAULT_SETTINGS,
      failOn: /^\s*UPDATE users/i,
    });
    const { lines, logger } = makeLogger();

    await expect(migrateOwnerKisAccount(makeDeps({ db, logger }))).rejects.toThrow(/이관 중단: 저장 실패/);
    expect(lines.join('\n')).toContain('다음 부팅에 전체가 재시도된다');
  });

  test('🔒 DB 예외가 평문을 물고 와도 저장 실패 로그에 남지 않는다', async () => {
    const { db } = makeDb({
      users: [OWNER_ROW], systemConfig: LIVE_SYSTEM_CONFIG, userSettings: SIGNUP_DEFAULT_SETTINGS,
      failOn: /^\s*UPDATE users/i,
      failMessage: `ER_DATA_TOO_LONG: sql=UPDATE users SET ... '${APP_SECRET}' acct='${ACCOUNT_NO}'`,
    });
    const { lines, logger } = makeLogger();

    await expect(migrateOwnerKisAccount(makeDeps({ db, logger }))).rejects.toThrow(/이관 중단: 저장 실패/);

    const text = lines.join('\n');
    expect(text).toContain('저장 실패');
    expect(text).not.toContain(APP_SECRET);
    expect(text).not.toContain(ACCOUNT_NO);
  });

  /**
   * reviewer HIGH (2026-08-09, 2차) — 앞의 테스트들은 `migrateOwnerKisAccount` 를 **직접** 부르고
   * 주입 로거만 봤다. 그래서 "던진 예외가 호출부에서 어떻게 로그되는가"는 한 번도 실행되지 않았다.
   * `runOnceMigration` 의 범용 catch 는 `e.message` 를 **스크러빙 없이** console.warn 한다
   * → 원본 예외를 re-throw 하면 위에서 지운 평문이 그 줄로 새어 나간다. 실제 부팅 경로로 검증한다.
   */
  test('🔒 저장 실패 예외가 runOnceMigration 로그로도 새지 않는다 (실제 부팅 경로)', async () => {
    const { db, calls } = makeDb({
      users: [OWNER_ROW], systemConfig: LIVE_SYSTEM_CONFIG, userSettings: SIGNUP_DEFAULT_SETTINGS,
      failOn: /^\s*UPDATE users/i,
      failMessage: `ER_PARSE_ERROR near '${APP_SECRET}' appkey='${APP_KEY}' acct='${ACCOUNT_NO}'`,
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { /* 캡처만 */ });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => { /* 캡처만 */ });

    try {
      // 부팅과 완전히 같은 호출 형태 — db.ts 의 setupDB 가 하는 그대로.
      await runOnceMigration(
        db as unknown as Parameters<typeof runOnceMigration>[0],
        'test_marker_t011',
        'T-011 테스트',
        () => migrateOwnerKisAccount(makeDeps({ db, logger: makeLogger().logger })),
      );

      const warned = warnSpy.mock.calls.flat().map(String).join('\n');
      expect(warned).toContain('one-time migration 실패');   // 실패는 분명히 알린다
      expect(warned).not.toContain(APP_KEY);
      expect(warned).not.toContain(APP_SECRET);
      expect(warned).not.toContain(ACCOUNT_NO);

      // 실패했으므로 마커는 기록되지 않는다 → 다음 부팅 재시도
      expect(calls.some((c) => /INSERT IGNORE INTO system_config/i.test(c.sql))).toBe(false);
    } finally {
      warnSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  test('runOnceMigration — skip 은 마커를 남기지 않는다 (조건이 갖춰지면 다음 부팅 재평가)', async () => {
    const { db, calls } = makeDb({ users: [] });   // 가드 실패 → skip
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => { /* 캡처만 */ });

    try {
      await runOnceMigration(
        db as unknown as Parameters<typeof runOnceMigration>[0],
        'test_marker_t011',
        'T-011 테스트',
        () => migrateOwnerKisAccount(makeDeps({ db, logger: makeLogger().logger })),
      );

      expect(logSpy.mock.calls.flat().map(String).join('\n')).toContain('one-time migration skipped');
      expect(calls.some((c) => /INSERT IGNORE INTO system_config/i.test(c.sql))).toBe(false);
    } finally {
      logSpy.mockRestore();
    }
  });

  test('설정 UPSERT 실패 → throw, 자격증명은 저장되지 않는다', async () => {
    const { db, calls } = makeDb({
      users: [OWNER_ROW], systemConfig: LIVE_SYSTEM_CONFIG, userSettings: SIGNUP_DEFAULT_SETTINGS,
      failOn: /^\s*INSERT INTO user_settings/i,
    });

    await expect(migrateOwnerKisAccount(makeDeps({ db }))).rejects.toThrow(/이관 중단: 저장 실패/);
    expect(calls.filter((c) => /^\s*UPDATE users/i.test(c.sql))).toHaveLength(0);
  });

  test('두 번째 부팅 — 자격증명이 채워진 상태면 재실행되지 않는다', async () => {
    const { db, calls } = makeDb({
      users: [{
        id: 1,
        kis_app_key_enc: 'gcm1.a.b.c',
        kis_app_secret_enc: 'gcm1.d.e.f',
        kis_account_no_enc: 'gcm1.g.h.i',
      }],
      systemConfig: LIVE_SYSTEM_CONFIG,
    });
    const verify = jest.fn();
    const r = asSkipped(await migrateOwnerKisAccount(makeDeps({ db, verify })));

    expect(r.skipped).toContain('덮어쓰지 않는다');
    expect(verify).not.toHaveBeenCalled();
    expect(writes(calls)).toHaveLength(0);
  });

  test('마커 키는 안정적인 상수다 (부팅 코드가 이 값으로 재실행을 막는다)', () => {
    expect(OWNER_KIS_MIGRATION_MARKER).toBe('migration_t011_owner_kis_account');
  });
});
