/**
 * T-087 D1a — POST /api/cron/broker-fills 라우트·배선(KIS·DB 없음 — 수집기·자격증명은 모킹, 값은 전부 합성).
 *  - 인증 fail-closed(401, 본체 미실행) · 파라미터(backfill 거부 400) · 프로세스 single-flight · 결과 → HTTP(503 은 cron 로그에 남는 상태)
 *  - 응답에 계좌·지문·키·금액이 없다(허용 목록 필드만) · 예외는 코드만
 *  - preflightFingerprint: 키 없음 → fingerprint_key_missing(자격증명 조회 전) · 계좌 없음 → account_missing · 정상 → 16 hex(계좌 원문 미노출)
 */
import { NextResponse, type NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';

const authMock = jest.fn<NextResponse | undefined, unknown[]>();
const collectMock = jest.fn();
const credMock = jest.fn<Promise<string>, [string]>();
jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: (...a: unknown[]) => authMock(...a) }));
const getPoolMock = jest.fn(() => ({ query: jest.fn(), getConnection: jest.fn() }));
jest.mock('@/lib/db', () => ({ getPool: () => getPoolMock() }));
jest.mock('@/lib/credentials', () => ({ getCredential: (k: string) => credMock(k) }));
jest.mock('@/lib/broker-ledger/collector', () => ({
  ...jest.requireActual('@/lib/broker-ledger/collector'),
  collectBrokerLedger: (...a: unknown[]) => collectMock(...a),
}));

import { POST } from '../route';
import { parseParams, preflightFingerprint, publicJob, toHttp } from '../wiring';
import type { JobReport } from '@/lib/broker-ledger/collector';

const ACCOUNT = '00000000';   // 합성 계좌번호
const reqOf = (qs = '') => ({ url: `http://localhost/api/cron/broker-fills${qs}`, headers: new Headers() }) as unknown as NextRequest;
const job = (o: Partial<JobReport> = {}): JobReport => ({
  market: 'domestic', kind: 'fills', status: 'complete', runId: 1, pages: 1, kisCalls: 1, rowsSeen: 2, inserted: 2, updated: 0, unchanged: 0,
  staleSkipped: 0, duplicateKeys: 0, normalizeIssues: 0, writeFailures: 0, reasons: [], ...o,
});
const ORIG_KEY = process.env.CREDENTIALS_ENCRYPTION_KEY;
const ENV = process.env as Record<string, string | undefined>;
const ORIG_NODE_ENV = ENV.NODE_ENV;

beforeEach(() => {
  authMock.mockReset(); collectMock.mockReset(); credMock.mockReset(); getPoolMock.mockClear();
  authMock.mockReturnValue(undefined);
  ENV.NODE_ENV = 'production';   // 라우트는 운영 런타임에서만 돈다 — 아래 non_production 시험이 다른 값을 명시적으로 넣는다
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => { ENV.NODE_ENV = ORIG_NODE_ENV; if (ORIG_KEY === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY; else process.env.CREDENTIALS_ENCRYPTION_KEY = ORIG_KEY; });

describe('POST', () => {
  test('🔴 인증 실패 → 401, 수집기 미실행', async () => {
    authMock.mockReturnValue(NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 }));
    const res = await POST(reqOf('?trigger=manual'));
    expect(res.status).toBe(401);
    expect(collectMock).not.toHaveBeenCalled();
  });

  test('🔴 (감사 M1) NODE_ENV ≠ production → 403 non_production, DB 풀·수집기 접근 0(인증 뒤) · production 이면 돈다', async () => {
    collectMock.mockResolvedValue({ status: 'skipped', reason: 'switch_off', switchEnabled: false });
    for (const v of ['test', 'development', undefined, 'Production']) {
      ENV.NODE_ENV = v;
      const res = await POST(reqOf('?trigger=manual'));
      expect([v, res.status, await res.json()]).toEqual([v, 403, { ok: false, error: 'non_production' }]);
    }
    expect(collectMock).not.toHaveBeenCalled();
    expect(getPoolMock).not.toHaveBeenCalled();
    authMock.mockReturnValue(NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 }));
    expect((await POST(reqOf())).status).toBe(401);   // 인증이 먼저
    authMock.mockReturnValue(undefined);
    ENV.NODE_ENV = 'production';
    expect((await POST(reqOf('?trigger=manual'))).status).toBe(200);
    expect(collectMock).toHaveBeenCalledTimes(1);
  });

  test('🔴 trigger=backfill 은 400(D1b 범위 밖) · 잘못된 값 400 · 수집기 미실행', async () => {
    for (const [qs, err] of [['?trigger=backfill', 'backfill_not_in_d1a'], ['?trigger=x', 'bad_trigger'], ['?market=jp', 'bad_market'], ['?kind=orders', 'bad_kind']]) {
      const res = await POST(reqOf(qs));
      expect([qs, res.status, (await res.json()).error]).toEqual([qs, 400, err]);
    }
    expect(collectMock).not.toHaveBeenCalled();
  });

  test('기본 = cron·전체, manual·필터 전달, 예산 75초 마감', async () => {
    collectMock.mockResolvedValue({ status: 'skipped', reason: 'switch_off', switchEnabled: false });
    const t = Date.now();
    const res = await POST(reqOf());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: 'skipped', skipped: 'switch_off', trigger: 'cron', switchEnabled: false });
    const [, r] = collectMock.mock.calls[0] as [unknown, { trigger: string; markets: string[]; kinds: string[]; deadlineMs: number }];
    expect(r).toMatchObject({ trigger: 'cron', markets: ['domestic', 'overseas'], kinds: ['fills', 'realized_pnl', 'position_snapshot'] });
    expect(r.deadlineMs - t).toBeGreaterThanOrEqual(74_000);
    expect(r.deadlineMs - t).toBeLessThanOrEqual(76_000);
    await POST(reqOf('?trigger=manual&market=overseas&kind=fills'));
    expect(collectMock.mock.calls[1][1]).toMatchObject({ trigger: 'manual', markets: ['overseas'], kinds: ['fills'] });
  });

  test('🔴 프로세스 single-flight — 진행 중이면 두 번째 호출은 in_progress(수집기 1회)', async () => {
    let release!: () => void;
    collectMock.mockImplementation(() => new Promise((res) => { release = () => res({ status: 'done', switchEnabled: true, closedStale: 0, jobs: [job()] }); }));
    const p1 = POST(reqOf());
    await new Promise((r) => setImmediate(r));
    const r2 = await POST(reqOf());
    expect(await r2.json()).toMatchObject({ status: 'skipped', skipped: 'in_progress' });
    release();
    expect((await p1).status).toBe(200);
    expect(collectMock).toHaveBeenCalledTimes(1);
    collectMock.mockResolvedValue({ status: 'not_migrated' });
    expect((await POST(reqOf())).status).toBe(503);   // 끝나면 다시 받는다
  });

  test('예외 → 500 + 코드만(메시지 원문 없음) · 1146(broker_) → 503 not_migrated', async () => {
    collectMock.mockRejectedValue(Object.assign(new Error(`Duplicate entry '${ACCOUNT}-01' secret`), { errno: 1062 }));
    const r = await POST(reqOf());
    expect(r.status).toBe(500);
    const txt = JSON.stringify(await r.json());
    expect(txt).toBe(JSON.stringify({ ok: false, error: 'db_1062' }));
    collectMock.mockRejectedValue(Object.assign(new Error("Table 't.broker_fills' doesn't exist"), { errno: 1146, sqlMessage: "Table 't.broker_fills' doesn't exist" }));
    const r2 = await POST(reqOf());
    expect(r2.status).toBe(503);
    expect(await r2.json()).toMatchObject({ status: 'not_migrated' });
  });
});

describe('toHttp / publicJob', () => {
  test('done: 전부 complete/incomplete/skipped → 200, failed·halted 하나라도 → 503 · preflight_failed·not_migrated → 503', () => {
    expect(toHttp('cron', { status: 'done', switchEnabled: true, closedStale: 0, jobs: [job(), job({ status: 'incomplete' }), job({ status: 'skipped' })] }).status).toBe(200);
    expect(toHttp('cron', { status: 'done', switchEnabled: true, closedStale: 0, jobs: [job(), job({ status: 'failed' })] }).status).toBe(503);
    expect(toHttp('cron', { status: 'done', switchEnabled: true, closedStale: 0, jobs: [job({ status: 'halted' })] }).status).toBe(503);
    expect(toHttp('cron', { status: 'preflight_failed', error: 'fingerprint_key_missing', switchEnabled: true })).toEqual({
      status: 503, body: { ok: false, status: 'preflight_failed', error: 'fingerprint_key_missing', trigger: 'cron', switchEnabled: true } });
    expect(toHttp('manual', { status: 'not_migrated' }).status).toBe(503);
  });
  test('🔴 응답은 허용 목록 필드만 — 수집기 결과에 민감 필드가 섞여도 새지 않는다, 사유는 코드 모양만', () => {
    const j = { ...job({ reasons: ['stale', 'x y with spaces', 'ok_code:1'] }), accountFingerprint: '0123456789abcdef', cano: ACCOUNT, amount: '303.70350' } as unknown as JobReport;
    const pj = publicJob(j);
    const s = JSON.stringify(pj);
    for (const bad of ['0123456789abcdef', ACCOUNT, '303.70350', 'with spaces']) expect(s).not.toContain(bad);
    expect(pj.reasons).toEqual(['stale', 'ok_code:1']);
    expect(Object.keys(pj).sort()).toEqual(['duplicateKeys', 'inserted', 'kind', 'kisCalls', 'market', 'normalizeIssues', 'pages', 'reasons', 'rowsSeen', 'runId', 'staleSkipped', 'status', 'unchanged', 'updated', 'writeFailures']);
  });
  test('🔴 (감사 L1) toHttp 는 작업마다 publicJob 허용 목록을 거친다 — 섞인 민감 필드가 응답 본문에 없다', () => {
    const dirty = { ...job(), accountFingerprint: '0123456789abcdef', cano: ACCOUNT, raw_json: '{"odno":"0000010001"}' } as unknown as JobReport;
    const h = toHttp('cron', { status: 'done', switchEnabled: true, closedStale: 0, jobs: [dirty] });
    const s = JSON.stringify(h.body);
    for (const bad of ['0123456789abcdef', ACCOUNT, 'raw_json', '0000010001', 'accountFingerprint', 'cano']) expect([bad, s.includes(bad)]).toEqual([bad, false]);
    expect((h.body.jobs as unknown[])[0]).toEqual(publicJob(dirty));
  });
  test('parseParams — market·kind all/빈 값 = 전부', () => {
    expect(parseParams(new URL('http://x/?market=all&kind='))).toEqual({ ok: true, trigger: 'cron', markets: ['domestic', 'overseas'], kinds: ['fills', 'realized_pnl', 'position_snapshot'] });
  });
});

describe('preflightFingerprint', () => {
  test('🔴 키 없음 → fingerprint_key_missing, 자격증명 조회 0', async () => {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    expect(await preflightFingerprint()).toEqual({ ok: false, error: 'fingerprint_key_missing' });
    expect(credMock).not.toHaveBeenCalled();
  });
  test('계좌 없음 → account_missing · 자격증명 오류 → credential_error', async () => {
    credMock.mockResolvedValue('');
    expect(await preflightFingerprint()).toEqual({ ok: false, error: 'account_missing' });
    credMock.mockRejectedValue(new Error('db down'));
    expect(await preflightFingerprint()).toEqual({ ok: false, error: 'credential_error' });
  });
  test('정상 → 16 hex(계좌 원문 미포함) · 상품코드 기본 01 · 결정적', async () => {
    credMock.mockImplementation(async (k) => (k === 'KIS_ACCOUNT_NO' ? ` ${ACCOUNT} ` : ''));
    const a = await preflightFingerprint();
    expect(a.ok && a.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(a)).not.toContain(ACCOUNT);
    credMock.mockImplementation(async (k) => (k === 'KIS_ACCOUNT_NO' ? ACCOUNT : '01'));
    expect(await preflightFingerprint()).toEqual(a);   // trim·기본 01 이 어댑터 규칙과 같다
    credMock.mockImplementation(async (k) => (k === 'KIS_ACCOUNT_NO' ? ACCOUNT : '22'));
    expect(await preflightFingerprint()).not.toEqual(a);
  });
});
