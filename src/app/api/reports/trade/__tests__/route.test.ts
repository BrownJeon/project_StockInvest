/**
 * T-182 `GET /api/reports/trade` — 인증 이중 검증·id 검사·목록 제외 규칙·실패를 「비어 있음」과 구분.
 */
import { NextResponse, type NextRequest } from 'next/server';

let authed = true;
jest.mock('@/lib/auth/current-user', () => ({
  requireUserId: async () => (authed
    ? { ok: true, userId: 1 }
    : { ok: false, res: NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 }) }),
}));

type Row = { id: number; sent_at: Date; range_start: Date; range_end: Date; is_test: number; delivered: number; summary_text: string; payload: string };
let table: Row[] | 'missing' | 'boom' = [];
const sqls: string[] = [];

jest.mock('@/lib/db', () => ({
  getPool: () => ({
    query: async (sql: string, params?: unknown[]) => {
      sqls.push(sql);
      if (table === 'missing') throw Object.assign(new Error('no table'), { code: 'ER_NO_SUCH_TABLE', errno: 1146 });
      if (table === 'boom') throw new Error('connection lost');
      if (/SELECT id, sent_at FROM trade_report_archive/.test(sql)) {
        // 라우트가 보낸 SQL 의 제외 조건을 그대로 흉내 낸다(조건이 SQL 에 있는지는 아래 단언이 따로 본다)
        return [table.filter((r) => r.is_test === 0 && r.delivered === 1)
          .sort((a, b) => b.sent_at.getTime() - a.sent_at.getTime())
          .map((r) => ({ id: r.id, sent_at: r.sent_at }))];
      }
      if (/WHERE id = \?/.test(sql)) return [table.filter((r) => r.id === (params as number[])[0])];
      return [[]];
    },
  }),
}));

import { GET } from '../route';

const req = (q = '') => ({ nextUrl: new URL(`http://localhost/api/reports/trade${q}`), cookies: { get: () => undefined } }) as unknown as NextRequest;
const row = (id: number, day: number, over: Partial<Row> = {}): Row => ({
  id, sent_at: new Date(Date.UTC(2026, 10, day, 23, 4)), range_start: new Date(Date.UTC(2026, 10, day - 1, 23, 4)),
  range_end: new Date(Date.UTC(2026, 10, day, 23, 4)), is_test: 0, delivered: 1, summary_text: `요약 ${id}`, payload: '{"schemaVersion":1}', ...over,
});

beforeEach(() => {
  authed = true;
  sqls.length = 0;
  table = [row(1, 17), row(2, 18), row(3, 19, { is_test: 1 }), row(4, 19, { delivered: 0 }), row(5, 20)];
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('로그인 안 됨 → requireUserId 의 401 을 그대로(조회 없음)', async () => {
  authed = false;
  const res = await GET(req());
  expect(res.status).toBe(401);
  expect(sqls).toHaveLength(0);
});

test.each(['abc', '0', '-1', '1.5', '01', '1e3', '%2F%2Fevil'])('id=%s → 400 invalid_id (조회 없음)', async (id) => {
  const res = await GET(req(`?id=${id}`));
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe('invalid_id');
  expect(sqls).toHaveLength(0);
});

test('id 없음 → 최신(발송 성공·시험 아님) 회차, 목록은 시험·발송 실패 제외 + 최신 먼저 60개', async () => {
  const res = await GET(req());
  const b = await res.json();
  expect(res.status).toBe(200);
  expect(res.headers.get('Cache-Control')).toBe('no-store');
  expect(b.data.status).toBe('ok');
  expect(b.data.report).toMatchObject({ id: 5, isTest: false, delivered: true, summaryText: '요약 5' });
  expect(b.data.history.map((h: { id: number }) => h.id)).toEqual([5, 2, 1]);
  expect(sqls[0]).toMatch(/WHERE is_test = 0 AND delivered = 1/);
  expect(sqls[0]).toMatch(/ORDER BY sent_at DESC, id DESC\s+LIMIT 60/);
  expect(b.data.report).not.toHaveProperty('fullText');          // 전문은 화면에 보내지 않는다
});

test('id 직접 지정이면 시험·발송 실패 회차도 돌려준다(표지 포함)', async () => {
  const t = await (await GET(req('?id=3'))).json();
  expect(t.data.report).toMatchObject({ id: 3, isTest: true, delivered: true });
  const f = await (await GET(req('?id=4'))).json();
  expect(f.data.report).toMatchObject({ id: 4, isTest: false, delivered: false });
});

test('없는 id → not_found(목록은 그대로)', async () => {
  const b = await (await GET(req('?id=999'))).json();
  expect(b.data).toMatchObject({ status: 'not_found', report: null });
  expect(b.data.history).toHaveLength(3);
});

test('보관 행 0 → empty', async () => {
  table = [];
  const b = await (await GET(req())).json();
  expect(b.data).toEqual({ status: 'empty', report: null, history: [] });
});

test('테이블 없음 → 503 archive_not_ready (빈 화면으로 보이지 않게)', async () => {
  table = 'missing';
  const res = await GET(req());
  expect(res.status).toBe(503);
  expect((await res.json()).error).toBe('archive_not_ready');
});

test('그 밖의 조회 실패 → 503 report_unavailable (오류 원문을 응답에 싣지 않는다)', async () => {
  table = 'boom';
  const res = await GET(req());
  const b = await res.json();
  expect(res.status).toBe(503);
  expect(b).toEqual({ ok: false, error: 'report_unavailable' });
});
