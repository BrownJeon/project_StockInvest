/** T-162: isolated SQLite executes the portable SELECT subset; no application env or DB. */
jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
import { spawnSync } from 'node:child_process';
import { EXECUTING_SQL, buildTrade } from '../trade';
import { WATCH_COUNT_SQL, countWatch, ACTIVE_EXECUTING_ORDER_SQL } from '../signal-counts';
import { assertSelectOnly } from '../read-only';
import { fakeReader, kst } from './fake-reader';

const now = kst('2026-11-08 15:00');
function executeFixture(): { list: Record<string, unknown>[]; counts: Record<string, unknown>[] } {
  const result = spawnSync('python3', ['-c', `
import sqlite3,json,sys
q=json.load(sys.stdin)
db=sqlite3.connect(':memory:'); db.row_factory=sqlite3.Row
db.executescript('CREATE TABLE signals (id INTEGER, symbol TEXT, market TEXT, side TEXT, status TEXT, updated_at TEXT, consumed_order_id INTEGER, valid_from TEXT, expires_at TEXT); CREATE TABLE orders (id INTEGER PRIMARY KEY, status TEXT, blocked_by TEXT);')
statuses=['accepted','partially_filled','dry_run','pending','unknown',None,'rejected','failed','blocked']
for i,status in enumerate(statuses,1):
 db.execute('INSERT INTO orders VALUES (?,?,NULL)',(i,status))
 db.execute('INSERT INTO signals VALUES (?,?,?,?,?,?,?,?,?)',(i,'NAS:TEST','overseas','buy','executing','2026-11-08 12:00:00',i,None,'2000-01-01'))
for i,oid in [(10,None),(11,999)]:
 db.execute('INSERT INTO signals VALUES (?,?,?,?,?,?,?,?,?)',(i,'NAS:TEST','domestic','buy','executing','2026-11-08 12:00:00',oid,None,None))
# More than a page of newer terminal results must not starve the surviving rows.
for i in range(100,125):
 db.execute('INSERT INTO orders VALUES (?,?,NULL)',(i,'filled' if i%2 else 'cancelled'))
 db.execute('INSERT INTO signals VALUES (?,?,?,?,?,?,?,?,?)',(i,'NAS:DONE','overseas','buy','executing','2026-11-08 14:00:00',i,None,None))
print(json.dumps({'list':[dict(r) for r in db.execute(q['list'])], 'counts':[dict(r) for r in db.execute(q['count'],['2026-11-08 15:00:00']*3)]}))
`], { input: JSON.stringify({ list: EXECUTING_SQL, count: WATCH_COUNT_SQL }), encoding: 'utf8' });
  expect(result.status).toBe(0);
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
}

test('terminal results excluded before LIMIT; open/unknown/null/missing/no-ID preserved; list and count agree', () => {
  const { list, counts } = executeFixture();
  expect(list.map(x => Number(x.id)).sort((a,b) => a-b)).toEqual(Array.from({length:11}, (_,i) => i+1));
  for (const market of ['domestic', 'overseas']) {
    expect(counts.find(x => x.market === market)?.executing).toBe(list.filter(x => x.market === market).length);
  }
  for (const sql of [EXECUTING_SQL, WATCH_COUNT_SQL]) {
    expect(sql).toContain(ACTIVE_EXECUTING_ORDER_SQL);
    expect(() => assertSelectOnly(sql)).not.toThrow();
    expect(sql).not.toMatch(/\b(UPDATE|DELETE|INSERT|REPLACE|ALTER)\b/i);
  }
});

test('DTO supplies decisionOutcome inputs and normalizes missing optional order fields to null', async () => {
  const r = fakeReader(now, [[EXECUTING_SQL, [
    { id:1, symbol:'NAS:AAPL', market:'overseas', side:'buy', updated_at:null, consumed_order_id:'12', order_status:'accepted', order_blocked_by:null },
    { id:2, symbol:'005930', market:'domestic', side:'buy', updated_at:null },
  ]]]);
  const dto = await buildTrade(now, r);
  expect(dto.executing).toMatchObject({state:'ok', data:[
    { consumedOrderId:12, orderStatus:'accepted', orderBlockedBy:null },
    { consumedOrderId:null, orderStatus:null, orderBlockedBy:null },
  ]});
});

test('joined orders read failure is an error section, never a healthy empty list/count', async () => {
  const r = fakeReader(now, [['LEFT JOIN orders', new Error('orders unavailable')]]);
  await expect(countWatch(r)).rejects.toMatchObject({code:'db_error'});
  const dto = await buildTrade(now, r);
  expect(dto.executing).toEqual({state:'error', error:'db_error'});
  expect(dto.counts).toEqual({state:'error', error:'db_error'});
});
