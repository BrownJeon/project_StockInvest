/**
 * T-074 `/api/cash-ledger/*` 라우트 — 메모리 가짜 DB(운영·공용 DB 에 쓰지 않는다) + 인증 목. 합성 스냅샷만 쓴다(실제 계좌 값 아님).
 *
 * 합성 흐름(기준 #100 2026-09-01 07:10 → 최신 #110 09-15 09:40, 보유 13,000,000원 고정):
 *   기준 총자산 16,060,000 → 현재 17,715,000. 입금 1,000,000 · 환전(순입금 0) · 출금 300,000(정정) · 달러 입금 $200(=250,000) → 순입금 950,000
 *   → 입출금 뺀 손익 +705,000원 (= 달러 환율 효과 +15,000 − 환전 비용 10,000 + 기록 안 된 원화 +700,000).
 *   후보(#109 원화 +700,000)를 입금으로 기록하면 +5,000원.
 * 확인: 응답 모양·코드(400/404/409/422/500/503) · 멱등·중복 · 조건부 UPDATE 충돌 · 지연 매칭 저장(바뀐 것만) · 후보 표시/되돌리기 ·
 *       **쓰기는 cash_flow_ledger 와 system_config 의 두 키뿐**.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { FakeDb } from '@/lib/ledger/__tests__/helpers/fake-db';
import { demoSnapshotRows, snapRow, HOLD } from '@/lib/ledger/__tests__/helpers/fixtures';

const mockDb: { db: FakeDb } = { db: new FakeDb() };
const mockAuth: { current: { ok: true; userId: number } | { ok: false; res: Response } } = { current: { ok: true, userId: 7 } };
jest.mock('@/lib/db', () => ({ getPool: () => mockDb.db.pool() }));
jest.mock('@/lib/auth/current-user', () => ({ requireUserId: jest.fn(async () => mockAuth.current) }));

import { GET } from '../route';
import { POST as postEntry } from '../entries/route';
import { POST as postCorrect } from '../entries/[id]/correct/route';
import { POST as postCancel } from '../entries/[id]/cancel/route';
import { POST as postRestore } from '../entries/[id]/restore/route';
import { PUT as putBaseline } from '../baseline/route';
import { POST as postDismiss } from '../candidates/[key]/dismiss/route';
import { POST as postReopen } from '../candidates/[key]/reopen/route';
import { POST as postRematch } from '../rematch/route';
import { errorResponse, SERVER_ERROR_TEXT } from '@/lib/ledger/handlers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = any;
const req = (method: string, body?: unknown) => new Request('http://x/api/cash-ledger', {
  method, headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
}) as unknown as NextRequest;
const params = <T extends Record<string, string>>(o: T) => ({ params: Promise.resolve(o) });
async function call(p: Promise<Response>): Promise<{ status: number; body: J }> {
  const r = await p;
  return { status: r.status, body: await r.json() };
}

const KST = (s: string) => new Date(`${s.replace(' ', 'T')}+09:00`);
let cidN = 0;
const cid = () => `cid-test-${String(++cidN).padStart(4, '0')}`;

const get = () => call(GET(req('GET')));
const setBaseline = (b: Record<string, unknown> = {}) => call(putBaseline(req('PUT', { snapshotId: 100, confirmed: { krwCash: 1_200_000, usdCash: 1500 }, baseVersion: 0, ...b })));
const add = (b: Record<string, unknown>) => call(postEntry(req('POST', { clientEntryId: cid(), baseVersion: 1, ...b })));
const dep = (amount: string | number, occurredAt: string, extra: Record<string, unknown> = {}) => add({ kind: 'deposit', currency: 'KRW', amount, occurredAt, ...extra });

beforeEach(() => {
  mockDb.db = new FakeDb();
  mockDb.db.snapshots = demoSnapshotRows();
  mockAuth.current = { ok: true, userId: 7 };
  jest.useFakeTimers({ now: KST('2026-09-15 09:55'), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask', 'clearTimeout', 'clearInterval'] });
  spies = [jest.spyOn(console, 'error').mockImplementation(() => {}), jest.spyOn(console, 'warn').mockImplementation(() => {})];
});
let spies: jest.SpyInstance[] = [];
afterEach(() => {
  jest.useRealTimers();
  for (const sp of spies) sp.mockRestore();
  // 🔴 어떤 경우에도 쓰기는 cash_flow_ledger 와 system_config 의 두 키뿐(orders·executions·position_state·portfolio_snapshots·signals·holdings 쓰기 0)
  for (const w of mockDb.db.writes()) {
    expect(w.sql).toMatch(/^(INSERT INTO|UPDATE) (cash_flow_ledger|system_config)\b/);
    expect(w.sql).not.toMatch(/orders|executions|position_state|portfolio_snapshots|signals|holdings/);
    if (/system_config/.test(w.sql)) {
      expect(w.params.some((p) => p === 'cash_ledger_baseline' || p === 'cash_ledger_candidate_marks')).toBe(true);
    }
  }
});

/** 합성 흐름 전체를 기록한다 */
async function seedFlow() {
  expect((await setBaseline()).status).toBe(200);
  const a = await dep('1,000,000', '2026-09-03 10:00', { memo: '월급 일부' });
  const b = await add({ kind: 'exchange', currency: 'KRW', amount: '1260000', counterCurrency: 'USD', counterAmount: '1000', occurredAt: '2026-09-05 13:00' });
  const c = await add({ kind: 'withdrawal', currency: 'KRW', amount: '3000000', occurredAt: '2026-09-10 14:00', memo: '카드값' });
  const d = await add({ kind: 'deposit', currency: 'USD', amount: '200', occurredAt: '2026-09-12 21:30' });
  const e = await dep('500000', '2026-09-15 09:50');
  return { a, b, c, d, e };
}

describe('GET', () => {
  test('기준 없음 → 200 · baseline/summary null · 후보 없음 · 기준 선택지(최신) · 규칙·지금', async () => {
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    const d = r.body.data;
    expect(d.baseline).toBeNull();
    expect(d.summary).toBeNull();
    expect(d.candidates).toEqual([]);
    expect(d.entries).toEqual([]);
    expect(d.snapshot).toMatchObject({ id: 110, ts: '2026-09-15 09:40:00', totalKrw: 17_715_000, krwCash: 1_340_000, usdCash: 2700, fx: 1250, stale: false, ageMin: 15, usdGapHint: null });
    expect(d.baselineOptions).toEqual([{ id: 110, ts: '2026-09-15 09:40:00', totalKrw: 17_715_000, krwCash: 1_340_000, usdCash: 2700, fx: 1250, tags: ['latest'] }]);
    expect(d.rules).toMatchObject({ krw: 50_000, usd: 50, tolKrw: 1000, tolUsd: 1, windowH: 36, bigPct: 50, fxWarnPct: 3 });
    expect(d.now).toBe('2026-09-15 09:55:00');
    expect(d.persisted).toBe(true);
    expect(mockDb.db.writes()).toHaveLength(0);
  });

  test('기준 선택지: 오늘·어제 07~09시 첫 스냅샷에 표지(같은 스냅샷이면 표지 여러 개)', async () => {
    mockDb.db.snapshots.push(snapRow(120, '2026-09-14 07:05', { krw: 1, holdings: HOLD }), snapRow(121, '2026-09-14 07:30', { krw: 1, holdings: HOLD }), snapRow(122, '2026-09-15 08:59', { krw: 1, holdings: HOLD }));
    const d = (await get()).body.data;
    expect(d.baselineOptions.map((o: J) => [o.id, o.tags])).toEqual([[122, ['today_morning']], [110, ['latest']], [120, ['yesterday_morning']]]);
  });

  test('합성 흐름 → 입출금 뺀 손익 +705,000원 · 반영 상태 · 후보 #109', async () => {
    const { a, b, c, d, e } = await seedFlow();
    expect(a.body.entry).toMatchObject({ kind: 'deposit', amount: 1_000_000, memo: '월급 일부', anchor: { status: 'matched', snapshotId: 102 }, krwEquiv: 1_000_000, createdByUserId: 7 });
    expect(b.body.entry).toMatchObject({ kind: 'exchange', currency: 'KRW', amount: 1_260_000, counterCurrency: 'USD', counterAmount: 1000, anchor: { status: 'matched', snapshotId: 104 }, fxRateUsed: 1256.2, krwEquiv: null });
    expect(c.body.entry.anchor.status).toBe('unmatched');
    expect(d.body.entry).toMatchObject({ currency: 'USD', amount: 200, anchor: { status: 'matched', snapshotId: 107 }, fxRateUsed: 1250, krwEquiv: 250_000 });
    expect(e.body.entry.anchor.status).toBe('pending');
    // 정정: 출금 3,000,000 → 300,000
    const cor = await call(postCorrect(req('POST', { clientEntryId: cid(), baseVersion: 1, kind: 'withdrawal', currency: 'KRW', amount: '300000', occurredAt: '2026-09-10 14:00', memo: '카드값', reason: '자릿수 잘못 입력' }), params({ id: String(c.body.entry.id) })));
    expect(cor.status).toBe(200);
    expect(cor.body.entry).toMatchObject({ amount: 300_000, supersedes: c.body.entry.id, anchor: { status: 'matched', snapshotId: 105 } });
    expect(cor.body.original).toMatchObject({ id: c.body.entry.id, supersededBy: cor.body.entry.id, void: { type: 'super', reason: '자릿수 잘못 입력', by: cor.body.entry.id, byUserId: 7 } });
    const s = cor.body.data.summary;
    expect(s).toMatchObject({ b0: 16_060_000, v: 17_715_000, net: 950_000, inflow: 1_250_000, outflow: 300_000, P: 705_000, pending: { count: 1, krw: 500_000 }, unmatched: 0, live: 5, voids: 1, days: 14 });
    expect(cor.body.data.candidates.map((x: J) => [x.key, x.state, x.delta])).toEqual([['109-KRW', 'open', 700_000]]);
    // 후보를 입금으로 기록 → 후보 해소 · 손익 +5,000원
    const rec = await dep('700,000', '2026-09-14 22:20', { fromCandidateKey: '109-KRW' });
    expect(rec.status).toBe(200);
    expect(rec.body.candidateResolved).toBe(true);
    expect(rec.body.entry.anchor).toMatchObject({ status: 'matched', snapshotId: 109 });
    expect(rec.body.data.summary.P).toBe(5_000);
    expect(rec.body.data.candidates).toEqual([]);
  });

  test('지연 매칭: 반영 대기 → 새 스냅샷이 생기면 다음 조회에 반영됨(저장) · 바뀐 게 없으면 UPDATE 0', async () => {
    await setBaseline();
    const e = await dep('500000', '2026-09-15 09:50');
    expect(e.body.entry.anchor.status).toBe('pending');
    mockDb.db.snapshots.push(snapRow(111, '2026-09-15 10:40', { krw: 1_840_000, usd: 2700, fx: 1250, holdings: HOLD }));
    jest.setSystemTime(KST('2026-09-15 10:45'));
    mockDb.db.log.length = 0;
    const g = await get();
    const v = g.body.data.entries.find((x: J) => x.id === e.body.entry.id);
    expect(v.anchor).toMatchObject({ status: 'matched', snapshotId: 111, snapshotTs: '2026-09-15 10:40:00', detail: '원화 현금 +500,000원 확인 (허용 ±1,000원)' });
    const row = mockDb.db.ledger.find((r) => r.id === e.body.entry.id)!;
    expect(row).toMatchObject({ anchor_status: 'matched', anchor_snapshot_id: 111, anchor_snapshot_ts: '2026-09-15 10:40:00', krw_equiv: '500000.00' });
    expect(mockDb.db.writes()).toHaveLength(1);
    // 두 번째 조회는 쓰지 않는다
    mockDb.db.log.length = 0;
    await get();
    expect(mockDb.db.writes()).toHaveLength(0);
  });

  test('반영 상태 저장 실패 → 화면 숫자는 그대로 200 · persisted=false / rematch 는 500', async () => {
    await setBaseline();
    const e = await dep('500000', '2026-09-15 09:50');
    mockDb.db.snapshots.push(snapRow(111, '2026-09-15 10:40', { krw: 1_840_000, usd: 2700, fx: 1250, holdings: HOLD }));
    mockDb.db.failOnce = /^UPDATE cash_flow_ledger SET anchor_status/;
    const g = await get();
    expect(g.status).toBe(200);
    expect(g.body.data.persisted).toBe(false);
    expect(g.body.data.entries.find((x: J) => x.id === e.body.entry.id).anchor.status).toBe('matched');
    expect(mockDb.db.ledger.find((r) => r.id === e.body.entry.id)!.anchor_status).toBe('pending');
    mockDb.db.failOnce = /^UPDATE cash_flow_ledger SET anchor_status/;
    const rm = await call(postRematch(req('POST', {})));
    expect(rm.status).toBe(500);
    expect(rm.body).toMatchObject({ ok: false, code: 'server_error' });
  });

  test('조건부 UPDATE 경합(다른 요청이 먼저 바꿈) → 0행은 실패가 아니다', async () => {
    await setBaseline();
    const e = await dep('500000', '2026-09-15 09:50');
    mockDb.db.snapshots.push(snapRow(111, '2026-09-15 10:40', { krw: 1_840_000, usd: 2700, fx: 1250, holdings: HOLD }));
    mockDb.db.beforeUpdate = (sql) => { if (/anchor_status = \?/.test(sql)) mockDb.db.ledger.find((r) => r.id === e.body.entry.id)!.anchor_status = 'unmatched'; };
    const g = await get();
    expect(g.status).toBe(200);
    expect(g.body.data.persisted).toBe(true);
    expect(mockDb.db.ledger.find((r) => r.id === e.body.entry.id)!.anchor_status).toBe('unmatched');   // 덮어쓰지 않음
  });

  test('스냅샷이 3시간 넘게 지나면 stale', async () => {
    jest.setSystemTime(KST('2026-09-15 12:41'));
    expect((await get()).body.data.snapshot).toMatchObject({ stale: true, ageMin: 181 });
  });

  test('🔴 인증 실패 → 미들웨어와 같은 401 그대로 · DB 접근 0', async () => {
    const calls: (() => Promise<Response>)[] = [
      () => GET(req('GET')), () => postEntry(req('POST', {})), () => putBaseline(req('PUT', {})), () => postRematch(req('POST', {})),
      () => postCancel(req('POST', { reason: 'x' }), params({ id: '1' })), () => postDismiss(req('POST', { reason: 'x' }), params({ key: '109-KRW' })),
    ];
    for (const c of calls) {
      mockAuth.current = { ok: false, res: NextResponse.json({ ok: false, error: 'unauthorized', detail: 'session missing' }, { status: 401 }) };
      const r = await call(c());
      expect(r.status).toBe(401);
      expect(r.body.error).toBe('unauthorized');
    }
    expect(mockDb.db.log).toHaveLength(0);
  });

  test('테이블 없음(마이그레이션 전) → 503 not_migrated', async () => {
    mockDb.db.noTable = true;
    const r = await get();
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ ok: false, code: 'not_migrated' });
    expect(r.body.error).toContain('기록이 없어진 것이 아닙니다');
  });
  test('🔴 QA D-2: 마이그레이션 전 PUT baseline → 503 not_migrated · system_config 쓰기 0 · 표 확인이 첫 SQL', async () => {
    mockDb.db.noTable = true;
    const r = await setBaseline();
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ ok: false, code: 'not_migrated' });
    expect(mockDb.db.writes()).toHaveLength(0);
    expect(mockDb.db.config.has('cash_ledger_baseline')).toBe(false);
    expect(mockDb.db.log.map((l) => l.sql)).toEqual(['SELECT 1 FROM cash_flow_ledger LIMIT 0']);
    // 본문 검증 오류(422)는 표 확인보다 먼저 — 다른 쓰기 경로와 같은 순서, 쓰기 0
    const bad = await setBaseline({ baseVersion: -1 });
    expect(bad.status).toBe(422);
    expect(mockDb.db.writes()).toHaveLength(0);
  });

  test('🔴 L8: 원장 표가 아닌 표(portfolio_snapshots·system_config·accounts)가 없으면 not_migrated 가 아니라 500', async () => {
    for (const t of ['portfolio_snapshots', 'system_config', 'accounts']) {
      const r = errorResponse(Object.assign(new Error(`Table 't074.${t}' doesn't exist`), { code: 'ER_NO_SUCH_TABLE', errno: 1146 }), 'x');
      expect(r.status).toBe(500);
      expect(await r.json()).toMatchObject({ ok: false, code: 'server_error' });
    }
    const m = errorResponse(Object.assign(new Error("Table 't074.cash_flow_ledger' doesn't exist"), { code: 'ER_NO_SUCH_TABLE', errno: 1146 }), 'x');
    expect(m.status).toBe(503);
    expect((await m.json()).code).toBe('not_migrated');
  });
  test('🔴 L2: 500 응답은 일반 문장 + code — 원문(DB 주소·SQL 조각)은 서버 로그로만', async () => {
    const raw = 'connect ECONNREFUSED 192.168.219.100:3306';
    const r = errorResponse(Object.assign(new Error(raw), { code: 'ECONNREFUSED' }), 'GET', true);
    const body = await r.json();
    expect(r.status).toBe(500);
    expect(body).toEqual({ ok: false, code: 'server_error', error: SERVER_ERROR_TEXT, retrySafe: true });
    expect(JSON.stringify(body)).not.toMatch(/192\.168|ECONNREFUSED|3306/);
    expect((console.error as jest.Mock).mock.calls.some((c) => String(c[1]).includes(raw))).toBe(true);
    const sql = await errorResponse(new Error("You have an error in your SQL syntax near 'SELECT * FROM cash_flow_ledger'"), 'x').json();
    expect(sql.error).toBe(SERVER_ERROR_TEXT);
  });
  test('손상된 기준 값 → 500 + 복구 안내', async () => {
    mockDb.db.config.set('cash_ledger_baseline', '{"version":"x"}');
    const r = await get();
    expect(r.status).toBe(500);
    expect(r.body.error).toContain('cash_ledger_baseline 키를 삭제한 뒤');
  });
});

describe('PUT /baseline', () => {
  test('첫 저장 → version 1 · 스냅샷 값 동결 · 확인 현금 보정 · 저장 JSON 모양', async () => {
    const r = await setBaseline({ confirmed: { krwCash: '1,180,000', usdCash: '1250.40', note: '앱 외화예수금' } });
    expect(r.status).toBe(200);
    expect(r.body.baseline).toMatchObject({
      version: 1, at: '2026-09-01 07:10:00', snapshotId: 100, totalKrw: 16_060_000, krwCash: 1_200_000, usdCash: 1500, fx: 1240,
      confirmed: { krwCash: 1_180_000, usdCash: 1250.4, at: '2026-09-15 09:55:00', note: '앱 외화예수금' },
      baselineTotalKrw: 16_060_000 - 309_504 - 20_000, unconfirmed: false,
    });
    const stored = JSON.parse(mockDb.db.config.get('cash_ledger_baseline')!);
    expect(Object.keys(stored).sort()).toEqual(['baselineAt', 'baselineTotalKrw', 'confirmed', 'history', 'snapshot', 'snapshotId', 'updatedAt', 'version']);
    expect(stored.history).toEqual([{ version: 1, at: '2026-09-15 09:55:00', baselineAt: '2026-09-01 07:10:00', snapshotId: 100, confirmed: { krwCash: 1_180_000, usdCash: 1250.4 }, baselineTotalKrw: 15_730_496 }]);
  });
  test('확인값 비우면 미확정(스냅샷 값) · 0원 확인값 허용', async () => {
    const r = await setBaseline({ confirmed: null });
    expect(r.body.baseline).toMatchObject({ unconfirmed: true, baselineTotalKrw: 16_060_000, confirmed: { krwCash: null, usdCash: null, at: null } });
    const r2 = await setBaseline({ baseVersion: 1, confirmed: { krwCash: '0', usdCash: '0' } });
    expect(r2.status).toBe(200);
    expect(r2.body.baseline).toMatchObject({ version: 2, unconfirmed: false, baselineTotalKrw: 16_060_000 - 1_200_000 - 1_860_000 });
    expect(r2.body.baseline.history.map((h: J) => h.version)).toEqual([1, 2]);
  });
  test('🔴 409 version: 다른 기기가 먼저 저장 → latest · 덮어쓰지 않음', async () => {
    await setBaseline();
    const before = mockDb.db.config.get('cash_ledger_baseline');
    const r = await setBaseline({ snapshotId: 110 });   // baseVersion 0 그대로
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ ok: false, code: 'version', latest: { version: 1, snapshotId: 100 } });
    expect(r.body.data.baseline.version).toBe(1);
    expect(mockDb.db.config.get('cash_ledger_baseline')).toBe(before);
  });
  test('UPDATE 경합(조건부 UPDATE 영향 0행) → 409', async () => {
    await setBaseline();
    mockDb.db.beforeUpdate = (sql) => {
      if (/system_config/.test(sql)) {
        const v = JSON.parse(mockDb.db.config.get('cash_ledger_baseline')!);
        mockDb.db.config.set('cash_ledger_baseline', JSON.stringify({ ...v, version: 2 }));
        mockDb.db.beforeUpdate = null;
      }
    };
    const r = await setBaseline({ baseVersion: 1, snapshotId: 110 });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('version');
  });
  test.each([
    [{ snapshotId: 'x' }, 'snapshotId', 'format'],
    [{ snapshotId: 999 }, 'snapshotId', 'not_found'],
    [{ baseVersion: -1 }, 'baseVersion', 'format'],
    [{ confirmed: { krwCash: '-5' } }, 'krwCash', 'sign'],
    [{ confirmed: { usdCash: '1.234' } }, 'usdCash', 'decimals'],
    [{ confirmed: { krwCash: '1', note: '가'.repeat(201) } }, 'note', 'too_long'],
  ])('422 %p → %s.%s · 쓰기 0', async (over, field, code) => {
    const r = await setBaseline(over);
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ ok: false, code: 'validation' });
    expect(r.body.fieldErrors[field].code).toBe(code);
    expect(mockDb.db.writes()).toHaveLength(0);
  });
  test('USD 행이 없는 스냅샷에 달러 확인값 → 422 no_fx', async () => {
    mockDb.db.snapshots.push(snapRow(130, '2026-09-15 09:45', { krw: 5, holdings: HOLD }));
    const r = await setBaseline({ snapshotId: 130 });
    expect(r.status).toBe(422);
    expect(r.body.fieldErrors.usdCash.code).toBe('no_fx');
  });
  test('본문이 JSON 이 아님 → 400', async () => {
    expect((await call(putBaseline(req('PUT', '{bad')))).status).toBe(400);
  });
});

describe('POST /entries', () => {
  test('기준 없음 → 409 no_baseline · 쓰기 0', async () => {
    const r = await dep('1000', '2026-09-03 10:00');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('no_baseline');
    expect(mockDb.db.writes()).toHaveLength(0);
  });
  test('🔴 기준 버전 불일치 → 409 baseline_version + latest', async () => {
    await setBaseline();
    const r = await dep('1000', '2026-09-03 10:00', { baseVersion: 2 });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'baseline_version', latest: { version: 1 } });
  });
  test.each([
    [{ occurredAt: '2026-09-01 07:10' }, 'occurredAt', 'before_baseline'],
    [{ occurredAt: '2026-08-20 10:00' }, 'occurredAt', 'before_baseline'],
    [{ occurredAt: '2026-09-15 09:56' }, 'occurredAt', 'future'],
    [{ amount: '-1000' }, 'amount', 'sign'],
    [{ amount: '1000.5' }, 'amount', 'decimals'],
    [{ amount: '0' }, 'amount', 'amount'],
    [{ amount: '' }, 'amount', 'required'],
    [{ kind: 'dividend' }, 'kind', 'kind'],
    [{ currency: 'JPY' }, 'currency', 'currency'],
    [{ memo: '가'.repeat(201) }, 'memo', 'too_long'],
    [{ clientEntryId: 'x' }, 'clientEntryId', 'format'],
    [{ baseVersion: 'x' }, 'baseVersion', 'format'],
    [{ fromCandidateKey: '109-EUR' }, 'fromCandidateKey', 'format'],
  ])('🔴 서버가 같은 규칙으로 다시 검사 → 422 %p → %s.%s · INSERT 0', async (over, field, code) => {
    await setBaseline();
    mockDb.db.log.length = 0;
    const r = await dep('1000', '2026-09-03 10:00', over);
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ ok: false, code: 'validation' });
    expect(r.body.fieldErrors[field].code).toBe(code);
    expect(mockDb.db.writes()).toHaveLength(0);
  });
  test('🔴 멱등: 같은 clientEntryId 로 **같은 내용**을 다시 보내면 새로 쓰지 않고 그 기록(replayed) — 쉼표·메모 앞뒤 공백 차이는 같은 내용', async () => {
    await setBaseline();
    const id = cid();
    const a = await call(postEntry(req('POST', { clientEntryId: id, baseVersion: 1, kind: 'deposit', currency: 'KRW', amount: '1000000', occurredAt: '2026-09-03 10:00', memo: '월급' })));
    const b = await call(postEntry(req('POST', { clientEntryId: id, baseVersion: 1, kind: 'deposit', currency: 'KRW', amount: '1,000,000', occurredAt: '2026-09-03 10:00', memo: ' 월급 ' })));
    expect(a.body.replayed).toBe(false);
    expect(b.status).toBe(200);
    expect(b.body.replayed).toBe(true);
    expect(b.body.entry.id).toBe(a.body.entry.id);
    expect(mockDb.db.ledger).toHaveLength(1);
    // 사전 확인으로 끝난다 — 두 번째 요청은 INSERT 를 시도하지 않는다(DB UNIQUE 는 동시 요청용 마지막 방어선)
    expect(mockDb.db.log.filter((l) => /^INSERT INTO cash_flow_ledger/.test(l.sql))).toHaveLength(1);
  });
  test('🔴 M1: 같은 clientEntryId 로 **내용이 다르면**(금액 9) 저장된 기록을 replayed 로 돌려주지 않고 409 client_entry_conflict{existingId, data} · 쓰기 0', async () => {
    await setBaseline();
    const id = cid();
    const a = await call(postEntry(req('POST', { clientEntryId: id, baseVersion: 1, kind: 'deposit', currency: 'KRW', amount: '1000000', occurredAt: '2026-09-03 10:00' })));
    mockDb.db.log.length = 0;
    const b = await call(postEntry(req('POST', { clientEntryId: id, baseVersion: 1, kind: 'deposit', currency: 'KRW', amount: '9', occurredAt: '2026-09-03 10:00' })));
    expect(b.status).toBe(409);
    expect(b.body).toMatchObject({ ok: false, code: 'client_entry_conflict', existingId: a.body.entry.id, error: '같은 요청 번호로 다른 내용이 와서 저장하지 않았습니다. 방금 저장된 기록을 확인해 주세요' });
    expect(b.body.replayed).toBeUndefined();
    expect(b.body.data.entries.map((e: J) => [e.id, e.amount])).toEqual([[a.body.entry.id, 1_000_000]]);
    expect(mockDb.db.ledger).toHaveLength(1);
    expect(mockDb.db.writes().filter((w) => /^INSERT INTO cash_flow_ledger/.test(w.sql))).toHaveLength(0);
  });
  test.each([
    ['종류', { kind: 'withdrawal' }], ['통화·금액', { currency: 'USD', amount: '1000' }], ['발생 시각', { occurredAt: '2026-09-03 10:01' }], ['메모', { memo: '다름' }],
  ])('M1: %s 이 다르면 409 client_entry_conflict', async (_n, over) => {
    await setBaseline();
    const body = { clientEntryId: cid(), baseVersion: 1, kind: 'deposit', currency: 'KRW', amount: '1000000', occurredAt: '2026-09-03 10:00' };
    expect((await call(postEntry(req('POST', body)))).status).toBe(200);
    const r = await call(postEntry(req('POST', { ...body, ...over })));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('client_entry_conflict');
  });
  test('M1: 환전의 받은 금액이 다르면 409 · 같으면 replayed', async () => {
    await setBaseline();
    const body = { clientEntryId: cid(), baseVersion: 1, kind: 'exchange', currency: 'KRW', amount: '1260000', counterCurrency: 'USD', counterAmount: '1000', occurredAt: '2026-09-05 13:00' };
    expect((await call(postEntry(req('POST', body)))).status).toBe(200);
    expect((await call(postEntry(req('POST', { ...body, counterAmount: '1000.01' })))).body.code).toBe('client_entry_conflict');
    expect((await call(postEntry(req('POST', { ...body, counterAmount: '1,000.00' })))).body.replayed).toBe(true);
  });
  test('🔴 같은 (종류·통화·금액·분) 살아 있는 기록 → 409 duplicate{existingId} · 취소한 뒤에는 다시 넣을 수 있다', async () => {
    await setBaseline();
    const a = await dep('1000000', '2026-09-03 10:00');
    const b = await dep('1,000,000', '2026-09-03 10:00');
    expect(b.status).toBe(409);
    expect(b.body).toMatchObject({ ok: false, code: 'duplicate', existingId: a.body.entry.id });
    await call(postCancel(req('POST', { reason: '중복 입력' }), params({ id: String(a.body.entry.id) })));
    expect((await dep('1000000', '2026-09-03 10:00')).status).toBe(200);
  });
  test('24시간 안 같은 금액·큰 금액은 경고만(저장됨)', async () => {
    await setBaseline();
    await dep('1000000', '2026-09-03 10:00');
    const b = await dep('1000000', '2026-09-03 10:01');
    expect(b.status).toBe(200);
    expect(b.body.warnings.map((w: J) => w.code)).toEqual(['near_duplicate']);
    expect(b.body.entry.anchor.status).toBe('unmatched');   // 같은 변화는 먼저 기록이 차지
    const big = await dep('9000000', '2026-09-04 10:00');
    expect(big.body.warnings.map((w: J) => w.code)).toEqual(['big_amount']);
  });
  test('🔴 500(INSERT 실패) → retrySafe · 같은 키로 다시 보내면 정확히 1건', async () => {
    await setBaseline();
    const id = cid();
    const body = { clientEntryId: id, baseVersion: 1, kind: 'deposit', currency: 'KRW', amount: '1000000', occurredAt: '2026-09-03 10:00' };
    mockDb.db.failOnce = /^INSERT INTO cash_flow_ledger/;
    const a = await call(postEntry(req('POST', body)));
    expect(a.status).toBe(500);
    expect(a.body).toMatchObject({ ok: false, code: 'server_error', retrySafe: true });
    const b = await call(postEntry(req('POST', body)));
    expect(b.status).toBe(200);
    expect(mockDb.db.ledger).toHaveLength(1);
  });
  test('저장은 성공했는데 응답 구성(조회)이 실패 → 500 retrySafe · 다시 보내면 replayed(두 번 기록 안 됨)', async () => {
    await setBaseline();
    const body = { clientEntryId: cid(), baseVersion: 1, kind: 'deposit', currency: 'KRW', amount: '1000000', occurredAt: '2026-09-03 10:00' };
    mockDb.db.failOnce = /FROM portfolio_snapshots WHERE ts >= \? ORDER BY ts DESC/;
    const a = await call(postEntry(req('POST', body)));
    expect(a.status).toBe(500);
    expect(a.body.retrySafe).toBe(true);
    const b = await call(postEntry(req('POST', body)));
    expect(b.body.replayed).toBe(true);
    expect(mockDb.db.ledger).toHaveLength(1);
  });
  test('환전: 같은 통화 → 422 · 저장 값은 원 정수·달러 2자리 문자열', async () => {
    await setBaseline();
    const bad = await add({ kind: 'exchange', currency: 'KRW', amount: '1000', counterCurrency: 'KRW', counterAmount: '1', occurredAt: '2026-09-05 13:00' });
    expect(bad.body.fieldErrors.counterCurrency.code).toBe('same_currency');
    await add({ kind: 'deposit', currency: 'USD', amount: '118.6', occurredAt: '2026-09-12 21:30' });
    const ins = mockDb.db.log.find((l) => /^INSERT INTO cash_flow_ledger/.test(l.sql))!;
    expect(ins.params.slice(2, 8)).toEqual(['deposit', '2026-09-12 21:30:00', 'USD', '118.60', null, null]);
  });
});

describe('POST /entries/:id/cancel · restore · correct', () => {
  test('취소 → void(cancel) · 다시 취소 409 already_voided · 없는 id 404 · 사유 없으면 422', async () => {
    await setBaseline();
    const a = await dep('1000000', '2026-09-03 10:00');
    const id = String(a.body.entry.id);
    expect((await call(postCancel(req('POST', { reason: ' ' }), params({ id })))).body.fieldErrors.reason.code).toBe('required');
    const c = await call(postCancel(req('POST', { reason: '잘못 입력' }), params({ id })));
    expect(c.status).toBe(200);
    expect(c.body.entry.void).toEqual({ type: 'cancel', reason: '잘못 입력', at: '2026-09-15 09:55:00', byUserId: 7, by: null });
    expect(c.body.data.summary.net).toBe(0);
    const again = await call(postCancel(req('POST', { reason: '잘못 입력' }), params({ id })));
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('already_voided');
    expect(again.body.data.entries).toHaveLength(1);
    expect((await call(postCancel(req('POST', { reason: 'x' }), params({ id: '999' })))).status).toBe(404);
    expect((await call(postCancel(req('POST', { reason: 'x' }), params({ id: 'abc' })))).status).toBe(404);
  });
  test('🔴 조건부 UPDATE: 다른 기기가 그 사이 취소하면 0행 → 409(덮어쓰지 않음)', async () => {
    await setBaseline();
    const a = await dep('1000000', '2026-09-03 10:00');
    mockDb.db.beforeUpdate = (sql) => { if (/SET deleted_at = \?/.test(sql)) { const r = mockDb.db.ledger[0]; r.deleted_at = '2026-09-15 09:54:00'; r.delete_reason = '다른 기기'; } };
    const c = await call(postCancel(req('POST', { reason: '내 사유' }), params({ id: String(a.body.entry.id) })));
    expect(c.status).toBe(409);
    expect(mockDb.db.ledger[0].delete_reason).toBe('다른 기기');
  });
  test('되살리기 → 다시 계산에 들어가고 다시 맞춘다 · 다시 되살리기 409 not_voided', async () => {
    await setBaseline();
    const a = await dep('1000000', '2026-09-03 10:00');
    const id = String(a.body.entry.id);
    await call(postCancel(req('POST', { reason: '잘못 입력' }), params({ id })));
    const r = await call(postRestore(req('POST'), params({ id })));
    expect(r.status).toBe(200);
    expect(r.body.entry).toMatchObject({ void: null, anchor: { status: 'matched', snapshotId: 102 } });
    expect(r.body.data.summary.net).toBe(1_000_000);
    const again = await call(postRestore(req('POST'), params({ id })));
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('not_voided');
  });
  test('MH05: 되살리기는 **경로의 id** 를 쓴다 — 취소된 두 기록 중 두 번째만 되살림', async () => {
    await setBaseline();
    const a = await dep('1000000', '2026-09-03 10:00');
    const b = await dep('2000000', '2026-09-04 10:00');
    for (const x of [a, b]) await call(postCancel(req('POST', { reason: '실수' }), params({ id: String(x.body.entry.id) })));
    const r = await call(postRestore(req('POST'), params({ id: String(b.body.entry.id) })));
    expect(r.status).toBe(200);
    expect(r.body.entry.id).toBe(b.body.entry.id);
    expect(mockDb.db.ledger.find((x) => x.id === b.body.entry.id)!.deleted_at).toBeNull();
    expect(mockDb.db.ledger.find((x) => x.id === a.body.entry.id)!.deleted_at).not.toBeNull();
  });
  test('🔴 정정으로 대체된 기록은 되살리지 않는다 → 409 superseded{existingId=새 기록}', async () => {
    await setBaseline();
    const a = await add({ kind: 'withdrawal', currency: 'KRW', amount: '3000000', occurredAt: '2026-09-10 14:00' });
    const cor = await call(postCorrect(req('POST', { clientEntryId: cid(), baseVersion: 1, kind: 'withdrawal', currency: 'KRW', amount: '300000', occurredAt: '2026-09-10 14:00' }), params({ id: String(a.body.entry.id) })));
    const r = await call(postRestore(req('POST'), params({ id: String(a.body.entry.id) })));
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'superseded', existingId: cor.body.entry.id });
  });
  test('되살리면 같은 살아 있는 기록과 겹치는 경우 → 409 duplicate', async () => {
    await setBaseline();
    const a = await dep('1000000', '2026-09-03 10:00');
    await call(postCancel(req('POST', { reason: '실수' }), params({ id: String(a.body.entry.id) })));
    const b = await dep('1000000', '2026-09-03 10:00');
    const r = await call(postRestore(req('POST'), params({ id: String(a.body.entry.id) })));
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'duplicate', existingId: b.body.entry.id });
    expect(mockDb.db.ledger.find((x) => x.id === a.body.entry.id)!.deleted_at).not.toBeNull();
  });
  test('정정: 메모만 바꿔도(같은 종류·금액·분) 된다 · 취소된 기록 정정 409 · 멱등 replay', async () => {
    await setBaseline();
    const a = await dep('1000000', '2026-09-03 10:00', { memo: '처음' });
    const key = cid();
    const body = { clientEntryId: key, baseVersion: 1, kind: 'deposit', currency: 'KRW', amount: '1000000', occurredAt: '2026-09-03 10:00', memo: '고친 메모' };
    const c = await call(postCorrect(req('POST', body), params({ id: String(a.body.entry.id) })));
    expect(c.status).toBe(200);
    expect(c.body.entry).toMatchObject({ memo: '고친 메모', anchor: { status: 'matched', snapshotId: 102 } });
    expect(c.body.original.void).toMatchObject({ type: 'super', reason: '정정' });
    const replay = await call(postCorrect(req('POST', body), params({ id: String(a.body.entry.id) })));
    expect(replay.body).toMatchObject({ replayed: true, entry: { id: c.body.entry.id } });
    const again = await call(postCorrect(req('POST', { ...body, clientEntryId: cid() }), params({ id: String(a.body.entry.id) })));
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('already_voided');
    expect(mockDb.db.ledger).toHaveLength(2);
  });
  test('🔴 M1·MX10: 정정 키를 **다른 기록**의 정정에 다시 쓰거나 내용을 바꾸면 409 client_entry_conflict(성공으로 돌려주지 않음) · 쓰기 0', async () => {
    await setBaseline();
    const a = await dep('1000000', '2026-09-03 10:00');
    const b = await dep('2000000', '2026-09-04 10:00');
    const key = cid();
    const body = { clientEntryId: key, baseVersion: 1, kind: 'deposit', currency: 'KRW', amount: '900000', occurredAt: '2026-09-03 10:00' };
    const c = await call(postCorrect(req('POST', body), params({ id: String(a.body.entry.id) })));
    expect(c.status).toBe(200);
    mockDb.db.log.length = 0;
    const other = await call(postCorrect(req('POST', body), params({ id: String(b.body.entry.id) })));
    expect(other.status).toBe(409);
    expect(other.body).toMatchObject({ code: 'client_entry_conflict', existingId: c.body.entry.id });
    const changed = await call(postCorrect(req('POST', { ...body, amount: '800000' }), params({ id: String(a.body.entry.id) })));
    expect(changed.body).toMatchObject({ code: 'client_entry_conflict', existingId: c.body.entry.id });
    expect(mockDb.db.writes()).toHaveLength(0);
    expect(mockDb.db.ledger.find((r) => r.id === b.body.entry.id)!.deleted_at).toBeNull();   // 다른 기록은 그대로 살아 있다
    // 같은 대상·같은 내용은 그대로 replayed
    expect((await call(postCorrect(req('POST', body), params({ id: String(a.body.entry.id) })))).body.replayed).toBe(true);
  });
  test('🔴 정정 경합: 트랜잭션 안 조건부 UPDATE 가 0행이면 409 · 롤백(새 행 없음)', async () => {
    await setBaseline();
    const a = await dep('1000000', '2026-09-03 10:00');
    mockDb.db.beforeUpdate = (sql) => { if (/SET deleted_at = \?/.test(sql)) mockDb.db.ledger[0].deleted_at = '2026-09-15 09:54:00'; };
    const c = await call(postCorrect(req('POST', { clientEntryId: cid(), baseVersion: 1, kind: 'deposit', currency: 'KRW', amount: '900000', occurredAt: '2026-09-03 10:00' }), params({ id: String(a.body.entry.id) })));
    expect(c.status).toBe(409);
    expect(c.body.code).toBe('already_voided');
    expect(mockDb.db.ledger).toHaveLength(1);
    expect(mockDb.db.log.map((l) => l.sql)).toContain('ROLLBACK');
  });
  test('정정 결과가 다른 살아 있는 기록과 겹치면 409 duplicate · 원래 기록은 그대로 살아 있다(롤백)', async () => {
    await setBaseline();
    const a = await dep('1000000', '2026-09-03 10:00');
    const b = await dep('2000000', '2026-09-03 10:00');
    const c = await call(postCorrect(req('POST', { clientEntryId: cid(), baseVersion: 1, kind: 'deposit', currency: 'KRW', amount: '1000000', occurredAt: '2026-09-03 10:00' }), params({ id: String(b.body.entry.id) })));
    expect(c.status).toBe(409);
    expect(c.body).toMatchObject({ code: 'duplicate', existingId: a.body.entry.id });
    expect(mockDb.db.ledger.find((x) => x.id === b.body.entry.id)!.deleted_at).toBeNull();
  });
  test('정정 새 기록도 서버 검증(기준 이전 차단)', async () => {
    await setBaseline();
    const a = await dep('1000000', '2026-09-03 10:00');
    const c = await call(postCorrect(req('POST', { clientEntryId: cid(), baseVersion: 1, kind: 'deposit', currency: 'KRW', amount: '1000000', occurredAt: '2026-08-31 10:00' }), params({ id: String(a.body.entry.id) })));
    expect(c.status).toBe(422);
    expect(c.body.fieldErrors.occurredAt.code).toBe('before_baseline');
  });
});

describe('후보 표시 — dismiss · reopen', () => {
  test('입출금 아님 → dismissed · 다시 409 already_handled · 되돌리기 → open · 다시 되돌리기 409 not_dismissed', async () => {
    await setBaseline();
    const key = { key: '109-KRW' };
    expect((await call(postDismiss(req('POST', {}), params(key)))).body.fieldErrors.reason.code).toBe('required');
    const d = await call(postDismiss(req('POST', { reason: '증권사 표시 차이(일시적)' }), params(key)));
    expect(d.status).toBe(200);
    expect(d.body.candidate).toMatchObject({ key: '109-KRW', state: 'dismissed', reason: '증권사 표시 차이(일시적)', dismissedByUserId: 7, dismissedAt: '2026-09-15 09:55:00' });
    const stored = JSON.parse(mockDb.db.config.get('cash_ledger_candidate_marks')!);
    expect(stored).toMatchObject({ version: 1, marks: { '109-KRW': { state: 'dismissed', byUserId: 7 } } });
    expect((await call(postDismiss(req('POST', { reason: 'x' }), params(key)))).body.code).toBe('already_handled');
    const o = await call(postReopen(req('POST'), params(key)));
    expect(o.status).toBe(200);
    expect(o.body.candidate.state).toBe('open');
    expect(JSON.parse(mockDb.db.config.get('cash_ledger_candidate_marks')!).log.map((l: J) => l.action)).toEqual(['dismiss', 'reopen']);
    const o2 = await call(postReopen(req('POST'), params(key)));
    expect(o2.status).toBe(409);
    expect(o2.body.code).toBe('not_dismissed');
  });
  test('없는 후보·이미 기록된 후보 → 409 already_handled · 형식이 아닌 키 → 404', async () => {
    await setBaseline();
    expect((await call(postDismiss(req('POST', { reason: 'x' }), params({ key: '999-KRW' })))).body.code).toBe('already_handled');
    expect((await call(postDismiss(req('POST', { reason: 'x' }), params({ key: 'abc' })))).status).toBe(404);
    expect((await call(postReopen(req('POST'), params({ key: '1;DROP' })))).status).toBe(404);
  });
  test('표시 저장 경합 → 재시도로 저장(다른 키 표시를 잃지 않는다)', async () => {
    await setBaseline();
    mockDb.db.snapshots.push(snapRow(111, '2026-09-15 09:45', { krw: 1_440_000, usd: 2700, fx: 1250, holdings: HOLD }));
    await call(postDismiss(req('POST', { reason: 'a' }), params({ key: '109-KRW' })));
    let once = true;
    mockDb.db.beforeUpdate = (sql) => {
      if (once && /system_config/.test(sql)) {
        once = false;
        const v = JSON.parse(mockDb.db.config.get('cash_ledger_candidate_marks')!);
        v.version += 1; v.marks['105-KRW'] = { state: 'dismissed', reason: '다른 기기', at: '2026-09-15 09:50:00', byUserId: 8 };
        mockDb.db.config.set('cash_ledger_candidate_marks', JSON.stringify(v));
      }
    };
    const d = await call(postDismiss(req('POST', { reason: 'b' }), params({ key: '111-KRW' })));
    expect(d.status).toBe(200);
    expect(Object.keys(JSON.parse(mockDb.db.config.get('cash_ledger_candidate_marks')!).marks).sort()).toEqual(['105-KRW', '109-KRW', '111-KRW']);
  });
});

describe('POST /rematch', () => {
  test('반영됨까지 다시 맞춘다 — 같은 변화를 잡은 두 기록 중 늦은 쪽이 불일치로', async () => {
    await setBaseline();
    const a = await dep('1000000', '2026-09-03 10:00');
    const b = await dep('1000000', '2026-09-03 10:05');
    // 경합으로 둘 다 102 를 잡았다고 가정(저장값 조작)
    Object.assign(mockDb.db.ledger.find((r) => r.id === b.body.entry.id)!, { anchor_status: 'matched', anchor_snapshot_id: 102, anchor_snapshot_ts: '2026-09-03 10:40:00' });
    const r = await call(postRematch(req('POST', {})));
    expect(r.status).toBe(200);
    expect(r.body.changed).toBe(1);
    const st = (id: number) => r.body.data.entries.find((x: J) => x.id === id).anchor.status;
    expect([st(a.body.entry.id), st(b.body.entry.id)]).toEqual(['matched', 'unmatched']);
  });
});
