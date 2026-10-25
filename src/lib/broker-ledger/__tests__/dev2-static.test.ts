/**
 * T-087 Dev-2 정적 불변식 — 수집기·DB 접근·커버리지(collector·store·coverage)와 크론 라우트.
 *  1. broker-ledger Dev-2 파일: `@/lib/db`·`@/lib/safety` import 0(Dev-1 static-invariants 와 같은 원칙), 거래소 모듈은 **타입만**,
 *     `process.env`·`getPool`·주문 함수·`fetch(` 0, 알림 모듈 0 — 연결·조회 함수·지문은 주입받는다.
 *  2. 쓰기 계약 모양: 체결 UPDATE 의 마지막 대입이 raw_hash, D2 파생열을 SET 하지 않는다, 재시도 errno 는 1213·1205, 재시도 2회·지터 10~50ms.
 *  3. 상수 대조: run 당 호출 12·페이지 30 = 어댑터 기본값, 스위치 키 이름.
 *  4. 라우트·배선: 주문 모듈·안전장치·알림 import 0, 원장 어댑터만, TR 표 = 어댑터 원문, 계좌 식별 규칙 = 어댑터 원문.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildFillUpdate, D2_DERIVED_COLS, RETRYABLE_ERRNOS, ROW_TX_MAX_RETRIES, ROW_TX_JITTER_MIN_MS, ROW_TX_JITTER_MAX_MS, CRON_SWITCH_KEY, FILL_REPLACE_COLS } from '../store';
import { RUN_MAX_KIS_CALLS, RUN_MAX_PAGES, ROUTE_TIME_BUDGET_MS, PAGE_START_WINDOW_MS } from '../collector';
import { LEDGER_MAX_CALLS, LEDGER_MAX_PAGES } from '@/lib/exchanges/kis-ledger-query';
import { normalizeFills } from '../normalize';
import { domFillRow, ovsFillRow } from './helpers/kis-fixtures';

const LIB = path.join(__dirname, '..');
const ROUTE_DIR = path.join(__dirname, '..', '..', '..', 'app', 'api', 'cron', 'broker-fills');
const EXCH = path.join(__dirname, '..', '..', 'exchanges');
const DEV2 = ['collector.ts', 'store.ts', 'coverage.ts'].map((f) => path.join(LIB, f));
const ROUTE = ['route.ts', 'wiring.ts'].map((f) => path.join(ROUTE_DIR, f));
const read = (p: string) => fs.readFileSync(p, 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
function refs(src: string): { mod: string; typeOnly: boolean }[] {
  const code = strip(src);
  const out: { mod: string; typeOnly: boolean }[] = [];
  for (const m of code.matchAll(/\b(import|export)\s+(type\s+)?[^;'"]*?\bfrom\s+['"]([^'"]+)['"]/g)) out.push({ mod: m[3], typeOnly: !!m[2] });
  for (const m of code.matchAll(/\bimport\s+['"]([^'"]+)['"]/g)) out.push({ mod: m[1], typeOnly: false });
  for (const m of code.matchAll(/\b(?:import|require)\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push({ mod: m[1], typeOnly: false });
  return out;
}

describe('1. broker-ledger Dev-2 파일 — 주입 구조', () => {
  test.each(DEV2.map((p) => [path.basename(p), p]))('%s — import 허용 목록·금지어', (_n, p) => {
    for (const r of refs(read(p))) {
      if (r.mod.startsWith('@/lib/exchanges/')) { expect({ mod: r.mod, typeOnly: r.typeOnly }).toEqual({ mod: r.mod, typeOnly: true }); continue; }
      expect(['./normalize', './store', './types', './decimal', './hash', './coverage']).toContain(r.mod);
    }
    const code = strip(read(p));
    expect(code).not.toMatch(/\b(process\.env|getPool|createOrder|cancelOrder|submitOrder|kisFetch)\b/);
    expect(code).not.toMatch(/\bfetch\(/);
    expect(code).not.toMatch(/@\/lib\/(notify|safety|db)\b/);
  });
});

describe('2. 쓰기 계약 모양', () => {
  const krw = normalizeFills({ market: 'domestic', kind: 'fills', trId: 'TTTC0081R', rows: [domFillRow()] }).items[0];
  const usd = normalizeFills({ market: 'overseas', kind: 'fills', trId: 'TTTS3035R', rows: [ovsFillRow()] }).items[0];
  const meta = { accountId: 1, accountFingerprint: '0123456789abcdef', runId: 9, seenAt: '2026-11-03 07:21:00' };
  const assigns = (sql: string) => sql.replace(/^UPDATE broker_fills SET /, '').replace(/ WHERE id = \?$/, '').split(', ').map((a) => a.split(' = ')[0]);

  test('🔴 raw_hash 는 SET 목록의 마지막 · revision+1 · 값 개수 = 자리표시자 개수', () => {
    for (const [cur, it] of [[{ id: 1, fee_kind: 'unknown' }, krw], [{ id: 2, fee_kind: 'allocated' }, usd], [{ id: 3, fee_kind: 'estimated' }, usd]] as const) {
      const [sql, vals] = buildFillUpdate(cur, it, meta);
      const a = assigns(sql);
      expect(a[a.length - 1]).toBe('raw_hash');
      expect(a.filter((x) => x === 'raw_hash')).toHaveLength(1);   // 앞에 한 번 더 넣는 변형도 잡는다
      expect(sql).toContain('revision = revision + 1');
      expect(vals.length).toBe((sql.match(/\?/g) ?? []).length);
      expect(vals[vals.length - 1]).toBe(cur.id);
      expect(vals[vals.length - 2]).toBe(it.row.raw_hash);
    }
  });
  test('🔴 D2 파생열은 SET 하지 않는다 · fee_* 는 unknown/estimated 일 때만 · amount_krw_est 는 KRW 행만', () => {
    const a1 = assigns(buildFillUpdate({ id: 1, fee_kind: 'allocated' }, usd, meta)[0]);
    for (const c of D2_DERIVED_COLS) expect(a1).not.toContain(c);
    expect(a1).not.toContain('fee_kind');
    expect(a1).not.toContain('fee_native');
    expect(a1).not.toContain('amount_krw_est');
    expect(assigns(buildFillUpdate({ id: 1, fee_kind: 'actual' }, usd, meta)[0])).not.toContain('fee_kind');
    expect(assigns(buildFillUpdate({ id: 1, fee_kind: 'estimated' }, usd, meta)[0])).toEqual(expect.arrayContaining(['fee_kind', 'fee_native', 'fee_rate_pct']));
    expect(assigns(buildFillUpdate({ id: 1, fee_kind: 'unknown' }, krw, meta)[0])).toContain('amount_krw_est');
    for (const c of D2_DERIVED_COLS) expect(FILL_REPLACE_COLS as readonly string[]).not.toContain(c);
    // 자연키 열은 바꾸지 않는다
    for (const c of ['account_id', 'broker', 'market', 'order_date', 'broker_order_no', 'account_fingerprint', 'first_seen_at', 'first_run_id']) expect(a1).not.toContain(c);
  });
  test('재시도 errno 1213·1205 · 최대 2회 · 지터 10~50ms', () => {
    expect([...RETRYABLE_ERRNOS].sort()).toEqual([1205, 1213]);
    expect(ROW_TX_MAX_RETRIES).toBe(2);
    expect([ROW_TX_JITTER_MIN_MS, ROW_TX_JITTER_MAX_MS]).toEqual([10, 50]);
  });
  test('upsert 는 SELECT … FOR UPDATE 로 시작하고 affectedRows 로 건수를 세지 않는다', () => {
    const src = strip(read(path.join(LIB, 'store.ts')));
    expect((src.match(/FOR UPDATE/g) ?? []).length).toBeGreaterThanOrEqual(3);
    const upserts = src.slice(src.indexOf('export async function upsertFill'));
    expect(upserts.slice(0, upserts.indexOf('export async function markBaselineIfFirst'))).not.toMatch(/affectedRows/);
  });
});

describe('3. 상수', () => {
  test('run 당 호출 12·페이지 30 = 어댑터 기본값 · 예산 75초 · 페이지 시작 창 35초', () => {
    expect(RUN_MAX_KIS_CALLS).toBe(12);
    expect(RUN_MAX_KIS_CALLS).toBe(LEDGER_MAX_CALLS);
    expect(RUN_MAX_PAGES).toBe(LEDGER_MAX_PAGES);
    expect(ROUTE_TIME_BUDGET_MS).toBe(75_000);
    expect(PAGE_START_WINDOW_MS + 50_000).toBeLessThan(90_000);   // 페이지 하나 최악(대기 30 + 통신 20)을 더해도 curl 90초 안
  });
  test('스위치 키', () => { expect(CRON_SWITCH_KEY).toBe('broker_fills_cron_enabled'); });
});

describe('4. 라우트·배선', () => {
  test.each(ROUTE.map((p) => [path.basename(p), p]))('%s — 주문·안전장치·알림 import 0, 거래소는 원장 모듈·질의 공통만', (_n, p) => {
    for (const r of refs(read(p))) {
      expect(r.mod).not.toMatch(/^@\/lib\/(safety|notify)(\/|$)/);
      if (r.mod.startsWith('@/lib/exchanges/')) expect(['@/lib/exchanges/kis-domestic-ledger', '@/lib/exchanges/kis-overseas-ledger', '@/lib/exchanges/kis-ledger-query']).toContain(r.mod);
    }
    const code = strip(read(p));
    expect(code).not.toMatch(/\b(createOrder|cancelOrder|submitOrder|kisFetch)\b/);
    expect(code).not.toMatch(/\b[A-Z]{4}\d{4}U\b/);
  });
  test('🔴 TR 표 = 어댑터 원문(ledgerTrId 실전·모의 짝)', () => {
    const adapters = read(path.join(EXCH, 'kis-domestic-ledger.ts')) + read(path.join(EXCH, 'kis-overseas-ledger.ts'));
    const pairs = [...adapters.matchAll(/ledgerTrId\('([A-Z0-9]+)', '([A-Z0-9]+)'\)/g)].map((m) => `${m[1]}/${m[2]}`).sort();
    const w = read(path.join(ROUTE_DIR, 'wiring.ts'));
    const mine = [...w.matchAll(/\['([A-Z0-9]+)', '([A-Z0-9]+)'\]/g)].map((m) => `${m[1]}/${m[2]}`).sort();
    expect(pairs).toHaveLength(6);
    expect(mine).toEqual(pairs);
  });
  test('🔴 계좌 식별 문자열 규칙 = 어댑터 원문(같지 않으면 매 run account_changed)', () => {
    const q = read(path.join(EXCH, 'kis-ledger-query.ts'));
    const w = read(path.join(ROUTE_DIR, 'wiring.ts'));
    for (const s of ["String((await getCredential('KIS_ACCOUNT_NO')) || '').trim()", "String((await getCredential('KIS_ACCOUNT_PRODUCT')) || '01').trim()", '`${cano}-${prdt}`']) {
      expect([s, q.includes(s)]).toEqual([s, true]);
      expect([s, w.includes(s)]).toEqual([s, true]);
    }
  });
  test('route.ts 는 POST·dynamic·maxDuration 만 export(Next 라우트 규칙)', () => {
    const exp = [...strip(read(path.join(ROUTE_DIR, 'route.ts'))).matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+(\w+)/g)].map((m) => m[1]).sort();
    expect(exp).toEqual(['POST', 'dynamic', 'maxDuration']);
  });
});
