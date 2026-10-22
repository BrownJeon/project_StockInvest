/**
 * T-069 보유 점검 리포트 — 단위 시험 (node:test, DB 없음 — 가짜 연결).
 *   node --test scripts/profit-engine/holdings-report.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as C from './holdings-core.mjs';
import * as R from './holdings-report.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

// ─── 가짜 데이터 ───────────────────────────────────────────────────────────

const FX = 1300;
function snap(id, ts, { krw = 100_000, locked = 0, usd = null, fx = FX, h = {} } = {}) {
  const positions = [{ currency: 'KRW', qty: krw, price: 1, value_krw: krw, locked }];
  let total = krw;
  if (usd !== null) { positions.push({ currency: 'USD', qty: usd, price: fx, value_krw: usd * fx, locked: 0, src: 'CTRP6504R' }); total += usd * fx; }
  for (const [s, [qty, price]] of Object.entries(h)) { positions.push({ currency: s, qty, price, value_krw: qty * price }); total += qty * price; }
  return { id, ts, total_krw: Math.round(total), positions: JSON.stringify(positions), source: 'hourly' };
}
const HOLD = { 'NAS:AAA': [10, 130_000 * 10], '111111': [20, 50_000] }; // 합성: $1000 × 1300

function fakeConn({ ro = 1, rows = {} } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push(sql);
      if (rows.trap && sql.includes(rows.trap)) throw new Error('가드를 지나 DB 까지 도달함');
      if (sql === 'SET SESSION TRANSACTION READ ONLY') return [{}];
      if (sql.includes('@@session.tx_read_only')) return [[{ ro }]];
      if (sql.includes('FROM portfolio_snapshots') && sql.includes('LIMIT 1')) return [[rows.series.at(-1)]];
      if (sql.includes('FROM portfolio_snapshots')) return [rows.series];
      if (sql.includes('FROM position_state')) return [rows.states];
      if (sql.includes('FROM system_config') && sql.includes('IN (')) return [rows.exit ?? [{ key: 'exit_engine_enabled', value: 'false' }]];
      if (sql.includes('FROM system_config')) return [rows.policy ? [rows.policy] : []];
      if (sql.includes('MAX(created_at)')) return [[{ last_at: '2026-08-12 15:29:27' }]];
      if (sql.includes('FROM fx_rates')) return [[{ pair: 'USD_KRW', rate: '1300.0000', fetched_at: '2026-10-22 20:00:00' }]];
      if (sql.includes('FROM stock_meta')) return [[{ symbol: 'NAS:AAA', name: 'AAA CORP' }]];
      if (sql.includes('FROM orders')) return [[{ status: 'rejected', side: 'buy', n: 3 }]];
      throw new Error('예상 못 한 SQL: ' + sql);
    },
    async end() {},
  };
}

const STATES = [
  { symbol: 'NAS:AAA', market: 'overseas', entry_price: String(1300 * 900) /* 합성: USD 평단 $900 × 1300 */, peak_price: String(1_400_000), qty: '10', first_seen_at: '2026-10-05 23:19:02', updated_at: '2026-10-22 02:05:00', holding_deadline: null },
  { symbol: '111111', market: 'domestic', entry_price: '60000', peak_price: '61000', qty: '20', first_seen_at: '2026-08-07 15:04:25', updated_at: '2026-08-18 09:38:24', holding_deadline: null },
];
const POLICY = { value: JSON.stringify({ version: 1, stopPct: 3, heatCapPct: 2, stopBasis: 'avg', updatedAt: '2026-10-22T08:32:59Z', history: [] }), updated_at: '2026-10-22 17:32:59' };

function baseSeries() {
  return [
    snap(1, '2026-10-21 05:00:00', { usd: 0, h: HOLD }),
    snap(2, '2026-10-21 07:00:00', { usd: 100, h: HOLD }),
    snap(3, '2026-10-21 17:00:00', { usd: 0, h: HOLD }),
    snap(4, '2026-10-22 02:00:00', { usd: 0, h: HOLD }),
    snap(5, '2026-10-22 07:00:00', { usd: 100, h: HOLD }),
    snap(6, '2026-10-22 17:00:00', { usd: 0, h: HOLD }),
  ];
}

// ─── 읽기 전용 가드 ────────────────────────────────────────────────────────

test('assertReadOnlySql: SELECT·읽기 전용 설정문만 통과', () => {
  R.assertReadOnlySql('SELECT 1');
  R.assertReadOnlySql('  select id, updated_at FROM position_state');
  R.assertReadOnlySql('SET SESSION TRANSACTION READ ONLY');
  for (const bad of [
    'INSERT INTO t VALUES (1)', 'UPDATE t SET a=1', 'DELETE FROM t', 'REPLACE INTO t VALUES (1)',
    'CREATE TABLE x (a int)', 'DROP TABLE t', 'ALTER TABLE t ADD c int', 'TRUNCATE t',
    'SELECT 1; DELETE FROM t', 'SELECT * FROM t FOR UPDATE', 'SELECT * FROM t LOCK IN SHARE MODE',
    "SELECT * INTO OUTFILE '/tmp/x' FROM t", 'SET SESSION TRANSACTION READ WRITE', 'CALL p()',
  ]) assert.throws(() => R.assertReadOnlySql(bad), /읽기 전용 가드/, bad);
});

test('loadInputs: 첫 문장은 READ ONLY 설정, 플래그 확인 후 SELECT 만 보낸다', async () => {
  const conn = fakeConn({ rows: { series: baseSeries(), states: STATES, policy: POLICY } });
  const inp = await R.loadInputs(conn, { since: '2026-10-01' });
  assert.equal(conn.calls[0], 'SET SESSION TRANSACTION READ ONLY');
  assert.match(conn.calls[1], /@@session\.tx_read_only/);
  for (const sql of conn.calls.slice(1)) assert.match(sql.trim(), /^SELECT\s/);
  assert.equal(inp.readOnlyFlag, 1);
  assert.equal(inp.seriesRows.length, 6);
});

test('loadInputs: 세션이 읽기 전용이 아니면 데이터를 읽지 않고 중단', async () => {
  const conn = fakeConn({ ro: 0, rows: { series: baseSeries(), states: STATES } });
  await assert.rejects(() => R.loadInputs(conn), /읽기 전용이 아님/);
  assert.equal(conn.calls.length, 2);
});

test('스크립트 소스에 쓰기 SQL 이 없다 (정적 grep)', () => {
  for (const f of ['holdings-report.mjs', 'holdings-core.mjs']) {
    const src = fs.readFileSync(path.join(HERE, f), 'utf8');
    // SQL 문자열 리터럴 안의 쓰기 동사만 본다(주석·가드 정규식 정의는 제외)
    const literals = [...src.matchAll(/(['`])((?:SELECT|INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE)\b[^'`]*)\1/g)].map((m) => m[2]);
    for (const l of literals) assert.match(l, /^SELECT\s/, `${f}: ${l.slice(0, 50)}`);
  }
});

// ─── 원가·손익 ─────────────────────────────────────────────────────────────

test('buildBaseline: 해외 USD 평균단가 = entry_price ÷ 갱신 시각에 가장 가까운 스냅샷 환율', () => {
  const series = baseSeries().map(C.parseSnapshot);
  // 02:00 스냅샷 환율을 다르게 만들어 '가장 가까운' 선택을 확인
  series[3].usd.fx = 1200;
  const latest = series.at(-1);
  const b = C.buildBaseline(latest, series, STATES, { 'NAS:AAA': 'AAA CORP' });
  const aaa = b.rows.find((r) => r.symbol === 'NAS:AAA');
  assert.equal(aaa.fxAtAvg, 1200);
  assert.equal(aaa.fxAtAvgGapMin, 5);
  assert.equal(aaa.avgUsd, 1_170_000 / 1200);
  assert.equal(aaa.priceUsd, 1_300_000 / FX);
  const kr = b.rows.find((r) => r.symbol === '111111');
  assert.equal(kr.avgUsd, null);
  assert.equal(kr.currency, 'KRW');
});

test('computePnl: 원화 기준·USD 기준·환율 시점 왜곡', () => {
  const series = baseSeries().map(C.parseSnapshot);
  const latest = series.at(-1);
  const b = C.buildBaseline(latest, series, STATES);
  const p = C.computePnl(b);
  const aaa = p.rows.find((r) => r.symbol === 'NAS:AAA');
  // 원화 1,300,000 vs 1,170,000 → +11.111%, USD 1000 vs 900 → +11.111% (환율 같음 → 왜곡 0)
  assert.ok(Math.abs(aaa.krwPct - 11.1111) < 1e-3);
  assert.ok(Math.abs(aaa.usdPct - 11.1111) < 1e-3);
  assert.ok(Math.abs(aaa.fxTimingPp) < 1e-9);
  const kr = p.rows.find((r) => r.symbol === '111111');
  assert.ok(Math.abs(kr.krwPct - (-16.6667)) < 1e-3);
  assert.equal(p.losers, 1);
});

// ─── 손절 (compute.ts 와 같은 공식) ────────────────────────────────────────

test('computeStops: 평균단가 기준 손절가·손절 합·역산 손절폭', () => {
  const baseline = { rows: [
    { symbol: 'A', market: 'domestic', qty: 10, avgKrw: 100, peakKrw: 120, priceKrw: 90, avgUsd: null, priceUsd: null },
    { symbol: 'B', market: 'domestic', qty: 5, avgKrw: 200, peakKrw: 210, priceKrw: 199, avgUsd: null, priceUsd: null },
  ] };
  const st = C.computeStops(baseline, 10_000, { stopPct: 3, heatCapPct: 2, stopBasis: 'avg' });
  const a = st.rows.find((r) => r.symbol === 'A');
  assert.equal(a.stopKrw, 97);
  assert.equal(a.below, true);
  assert.ok(Math.abs(a.underPct - (7 / 97) * 100) < 1e-9);
  const b = st.rows.find((r) => r.symbol === 'B');
  assert.equal(b.below, false);
  assert.ok(Math.abs(b.distPct - ((199 - 194) / 199) * 100) < 1e-9);
  // 손절 합 = 3% × (1000 + 1000) = 60, 한도 200 → 사용률 30%
  assert.ok(Math.abs(st.heatKrw - 60) < 1e-9);
  assert.equal(st.capKrw, 200);
  assert.ok(Math.abs(st.usagePct - 30) < 1e-9);
  assert.equal(st.maxStopPct, 10); // floor2(2 × 10000 / 2000)
});

test('computeStops: 고점 기준은 이분 탐색, 해외 USD 기준 거리', () => {
  const baseline = { rows: [
    { symbol: 'NAS:X', market: 'overseas', qty: 1, avgKrw: 1300, peakKrw: 1500, priceKrw: 1400, avgUsd: 1, priceUsd: 1400 / 1300 },
  ] };
  const avg = C.computeStops(baseline, 100_000, { stopPct: 3, heatCapPct: 2, stopBasis: 'avg' });
  assert.ok(Math.abs(avg.rows[0].stopUsd - 0.97) < 1e-12);
  assert.ok(avg.rows[0].distPctUsd > 0);
  assert.equal(avg.rows[0].underPctUsd, null);
  // USD 기준으로 손절가 아래 — 원화 열과 같은 정의 (손절가−현재가)÷손절가
  const low = C.computeStops({ rows: [{ ...baseline.rows[0], priceKrw: 1100, priceUsd: 0.85 }] }, 100_000, { stopPct: 3, heatCapPct: 2, stopBasis: 'avg' });
  assert.equal(low.rows[0].belowUsd, true);
  assert.equal(low.rows[0].distPctUsd, null);
  assert.ok(Math.abs(low.rows[0].underPctUsd - ((0.97 - 0.85) / 0.97) * 100) < 1e-9);
  const pk = C.computeStops(baseline, 100_000, { stopPct: 3, heatCapPct: 2, stopBasis: 'peak' });
  // 고점 1500 × 0.97 = 1455 > 평균 1300 → 손실 0 → 손절 합 0, 상한 20 그대로
  assert.equal(pk.heatKrw, 0);
  assert.equal(pk.maxStopPct, 20);
  assert.equal(pk.rows[0].stopUsd, null);
});

test('computeStops 가 실제 src/lib/risk/compute.ts 와 같은 값을 낸다 (대조 — 공식 변경 감지)', async (t) => {
  let ts;
  try { ts = (await import(pathToFileURL(path.join(ROOT, 'node_modules', 'typescript', 'lib', 'typescript.js')).href)).default; }
  catch { t.skip('typescript 없음'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't069-compute-'));
  try {
    for (const f of ['compute', 'defaults']) {
      const src = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'risk', `${f}.ts`), 'utf8');
      const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
        .replace(/from '\.\/defaults'/g, "from './defaults.mjs'");
      fs.writeFileSync(path.join(dir, `${f}.mjs`), out);
    }
    const real = await import(pathToFileURL(path.join(dir, 'compute.mjs')).href);
    const holdings = [
      { symbol: 'NAS:AAA', market: 'overseas', qty: 7, avgKrw: 500_000, peakKrw: 560_000, priceKrw: 470_000 },
      { symbol: '222222', market: 'domestic', qty: 3, avgKrw: 100_000, peakKrw: 104_000, priceKrw: 99_000 },
      { symbol: 'NYS:CCC', market: 'overseas', qty: 4, avgKrw: 80_000, peakKrw: 81_000, priceKrw: 60_000 },
    ];
    for (const policy of [{ stopPct: 3, heatCapPct: 2, stopBasis: 'avg' }, { stopPct: 5, heatCapPct: 3, stopBasis: 'peak' }]) {
      const r = real.computeRisk(holdings, 9_000_000, policy, 300_000);
      const mine = C.computeStops({ rows: holdings.map((h) => ({ ...h, avgUsd: null, priceUsd: null })) }, 9_000_000, policy);
      assert.ok(Math.abs(r.heatKrw - mine.heatKrw) < 1e-6, 'heat');
      assert.equal(r.maxStopPct, mine.maxStopPct, 'maxStopPct');
      assert.equal(r.over, mine.over);
      assert.equal(r.belowCount, mine.belowCount);
      for (const row of r.rows) {
        const m = mine.rows.find((x) => x.symbol === row.symbol);
        assert.ok(Math.abs(row.stopKrw - m.stopKrw) < 1e-6);
        assert.equal(row.below, m.below);
        assert.equal(row.distPct === null ? null : +row.distPct.toFixed(9), m.distPct === null ? null : +m.distPct.toFixed(9));
      }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('정책 상수가 src/lib/risk/defaults.ts 원본과 같다 (드리프트 감지)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'risk', 'defaults.ts'), 'utf8');
  assert.equal(Number(src.match(/symbolMaxPct:\s*(\d+)/)[1]), C.SYMBOL_MAX_PCT);
  assert.equal(Number(src.match(/stopPct:\s*\{\s*min:\s*[\d.]+,\s*max:\s*(\d+)/)[1]), C.STOP_PCT_MAX);
  const d = src.match(/DEFAULT_EDITABLE[^{]*\{\s*stopPct:\s*([\d.]+),\s*heatCapPct:\s*([\d.]+),\s*stopBasis:\s*'(\w+)'/);
  assert.deepEqual([Number(d[1]), Number(d[2]), d[3]], [C.DEFAULT_POLICY.stopPct, C.DEFAULT_POLICY.heatCapPct, C.DEFAULT_POLICY.stopBasis]);
});

// ─── 스냅샷 신뢰도 ────────────────────────────────────────────────────────

function levelSeries() {
  const H = { 'NAS:A': [10, 1000], 'NAS:B': [30, 1000], '111111': [1, 5000] };
  const lowH = { 'NAS:A': [10, 1000], '111111': [1, 5000] };
  const backH = { 'NAS:A': [10, 1000], 'NAS:C': [30, 1000], '111111': [1, 5000] };
  const rows = [snap(1, '2026-10-02 22:00', { h: H, krw: 1000 }), snap(2, '2026-10-02 23:00', { h: H, krw: 1000 })];
  for (let i = 0; i < 5; i++) rows.push(snap(3 + i, `2026-10-03 0${i}:00`, { h: lowH, krw: 1000 }));
  rows.push(snap(8, '2026-10-05 23:00', { h: backH, krw: 1000 }));
  rows.push(snap(9, '2026-10-06 00:00', { h: backH, krw: 1000 }));
  return rows.map(C.parseSnapshot);
}

test('R1: 보유 소실로 총액이 급락한 구간을 찾고, 회복 행에서 새 구간을 열지 않는다', () => {
  const segs = C.detectLevelShifts(levelSeries());
  assert.equal(segs.length, 1);
  assert.equal(segs[0].rows, 5);
  assert.deepEqual(segs[0].ids, [3, 4, 5, 6, 7]);
  assert.equal(segs[0].open, false);
  assert.equal(segs[0].recoverId, 8);
  assert.deepEqual(segs[0].vanished, ['NAS:B']);
  assert.deepEqual(segs[0].appeared, ['NAS:C']);
  assert.match(segs[0].cause, /USD 예수금이 스냅샷에 없던 시기/);
});

test('R1: 끝까지 돌아오지 않으면 열린 구간', () => {
  const s = levelSeries().slice(0, 7);
  const segs = C.detectLevelShifts(s);
  assert.equal(segs[0].open, true);
});

test('R1b: 한 시장 보유가 한 행 사라졌다가 같은 구성으로 돌아오면 일시 구성 이상', () => {
  const H = { 'NAS:A': [10, 1000], '111111': [9, 5000] };
  const rows = [
    snap(1, '2026-08-04 13:00', { h: H }), snap(2, '2026-08-04 14:00', { h: { 'NAS:A': [10, 1000] } }),
    snap(3, '2026-08-04 15:00', { h: H }), snap(4, '2026-08-04 16:00', { h: H }),
  ].map(C.parseSnapshot);
  const runs = C.detectTransientComposition(rows);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].ids, [2]);
  assert.deepEqual(runs[0].changedSymbols, ['111111']);
  const flows = C.detectFlows(rows, [], { patterns: [] }, runs);
  assert.equal(flows.events.length, 0);
  assert.equal(flows.transientSteps, 2);
});

test('R2: USD 예수금 0↔X 왕복(매매 없음)을 찾고 시간대를 기록한다', () => {
  const s = baseSeries().map(C.parseSnapshot);
  const r = C.detectUsdFlips(s);
  assert.equal(r.patterns.length, 1);
  const p = r.patterns[0];
  assert.equal(p.xUsd, 100);
  assert.equal(p.flips, 4);
  assert.equal(p.rows, 6);
  assert.equal(p.latestIsZero, true);
  assert.deepEqual(p.nonzeroHoursKst, ['07']);
  assert.deepEqual(p.zeroHoursKst, ['02', '05', '17']);
});

test('R2: 전환이 1회뿐이면 왕복이 아니다', () => {
  const s = baseSeries().slice(0, 2).map(C.parseSnapshot);
  assert.equal(C.detectUsdFlips(s).patterns.length, 0);
});

test('R3: 분해 항등식(잔차 0)·국내 매도(결제대기)는 내부 매매·해외 매매(USD 미기록)는 후보', () => {
  const a = C.parseSnapshot(snap(1, '2026-10-01 10:00', { krw: 1000, h: { '111111': [10, 50_000], 'NAS:VVV': [2, 400_000] } }));
  const b = C.parseSnapshot(snap(2, '2026-10-01 11:00', { krw: 1000, locked: 250_000, h: { '111111': [5, 50_000], 'NAS:VVV': [2, 410_000] } }));
  const st = C.decomposeStep(a, b);
  assert.ok(Math.abs(st.residual) < 1e-6);
  assert.equal(st.priceEffect, 20_000);
  assert.equal(st.qtyEffect, -250_000);
  assert.equal(st.externalCandidate, 0);
  const c = C.parseSnapshot(snap(3, '2026-10-01 12:00', { krw: 1000, locked: 250_000, h: { '111111': [5, 50_000] } }));
  const f = C.detectFlows([a, b, c]);
  assert.equal(f.internalTrades, 1);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].type, 'overseas_trade_usd_unrecorded');
  assert.ok(f.events[0].externalCandidate < 0);
});

test('R3: 매매 없는 원화 예수금 변화는 원화 입출금 의심', () => {
  const H = { '111111': [10, 50_000] };
  const s = [snap(1, '2026-10-01 10:00', { krw: 1000, h: H }), snap(2, '2026-10-01 11:00', { krw: 2_001_000, h: H })].map(C.parseSnapshot);
  const f = C.detectFlows(s);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].type, 'krw_cash_change');
});

test('summarizeWindow: Δ총액 = 시세 + 외부 후보 + 기타 (항등)', () => {
  const s = levelSeries();
  const an = C.analyzeSnapshots(s);
  const w = C.summarizeWindow(s, an.flows.steps, '2026-10-02 00:00', '2026-10-06 23:59');
  assert.ok(Math.abs(w.dTotal - (w.priceEffect + w.externalCandidate + w.other)) < 1e-6);
});

// ─── 리포트 ───────────────────────────────────────────────────────────────

async function runFake(extraArgs = []) {
  const series = baseSeries();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 't069-out-'));
  const logs = [];
  const res = await R.run(['--since', '2026-10-01', '--out-dir', outDir, '--date', '20261022', ...extraArgs], {
    connect: async () => fakeConn({ rows: { series, states: STATES, policy: POLICY } }),
    now: () => new Date('2026-10-22T12:00:00Z'),
    log: (m) => logs.push(m),
  });
  return { res, outDir, logs };
}

test('run: 리포트를 쓰고, 같은 입력이면 본문이 같다(재현성)', async () => {
  const one = await runFake();
  const two = await runFake();
  try {
    assert.ok(fs.existsSync(one.res.file));
    assert.equal(R.bodyHash(one.res.md), R.bodyHash(two.res.md));
    assert.equal(one.res.digest, two.res.digest);
    const md = one.res.md;
    for (const must of ['## 2. 기준일 원가 스냅샷', '## 4. 집중도', '## 5. 예상 손절가까지 거리', '## 6. 스냅샷 신뢰도', '### 7.1 원장 양식', '### 7.3 사용자에게 물을 질문', 'T-070 일봉 백필 후 작성', 'tx_read_only = 1']) {
      assert.ok(md.includes(must), must);
    }
    assert.ok(md.includes('(아직 없음)'), '원장은 비어 있어야 한다(추정 금지)');
  } finally {
    fs.rmSync(one.outDir, { recursive: true, force: true });
    fs.rmSync(two.outDir, { recursive: true, force: true });
  }
});

test('run --no-write: 파일을 쓰지 않는다 / 요약에는 원화 절대 금액 필드가 없다', async () => {
  const { res, outDir } = await runFake(['--no-write', '--json-summary']);
  try {
    assert.equal(res.file, null);
    assert.deepEqual(fs.readdirSync(outDir), []);
    const keys = JSON.stringify(res.summary).match(/"[A-Za-z]+":/g).map((k) => k.slice(1, -2));
    assert.ok(!keys.some((k) => /krw$/i.test(k) && k !== 'krwPct'), keys.join(','));
    assert.equal(res.summary.reliability.r2.length, 1);
  } finally { fs.rmSync(outDir, { recursive: true, force: true }); }
});

test('parseArgs: 잘못된 옵션 거부', () => {
  assert.throws(() => R.parseArgs(['--since', '20261001']), /YYYY-MM-DD/);
  assert.throws(() => R.parseArgs(['--bogus']), /알 수 없는 옵션/);
  assert.equal(R.parseArgs(['--as-of', '2026-10-22 21:00']).asOf, '2026-10-22 21:00');
});

// ─── Reviewer 보완 (M-1~M-3, L-1~L-6) ─────────────────────────────────────

test('L-2: loadInputs 조회 수 고정 + 모든 조회가 가드를 지난다', async () => {
  const conn = fakeConn({ rows: { series: baseSeries(), states: STATES, policy: POLICY } });
  await R.loadInputs(conn, { since: '2026-10-01' });
  assert.equal(conn.calls.length, R.EXPECTED_QUERY_COUNT);
  for (const sql of conn.calls) R.assertReadOnlySql(sql);
});

test('L-2: guardedQuery 는 금지 SQL 을 DB 에 보내기 전에 거부한다', async () => {
  const conn = fakeConn({ rows: { series: baseSeries(), states: STATES, trap: 'position_state' } });
  const q = R.guardedQuery(conn);
  for (const bad of ['UPDATE position_state SET qty = 0', 'DELETE FROM position_state', "SELECT LOAD_FILE('/etc/passwd') FROM position_state",
    "SELECT GET_LOCK('x', 1) FROM position_state", 'SELECT SLEEP(5) FROM position_state', 'SELECT 1 FROM position_state; DROP TABLE x']) {
    await assert.rejects(() => q(bad), (e) => e instanceof R.ReportError && e.code === 'T069_SQL_GUARD', bad);
  }
  assert.equal(conn.calls.length, 0, 'DB 로 한 문장도 가지 않아야 한다');
});

test('L-2 경계값: R1 비율 정확히 0.7 은 급변이 아니고 0.69 는 급변', () => {
  const mk = (r) => [snap(1, '2026-10-01 10:00', { krw: 1_000_000 }), snap(2, '2026-10-01 11:00', { krw: Math.round(1_000_000 * r) }),
    snap(3, '2026-10-01 12:00', { krw: 1_000_000 })].map(C.parseSnapshot);
  assert.equal(C.detectLevelShifts(mk(0.7)).length, 0);
  assert.equal(C.detectLevelShifts(mk(0.69)).length, 1);
  assert.equal(C.detectLevelShifts(mk(1 / 0.7 + 0.01)).length, 1);
});

test('L-2 경계값: R2 는 매매 없는 전환이 정확히 2회면 왕복', () => {
  const s = baseSeries().slice(0, 3).map(C.parseSnapshot); // 0 → X → 0
  const r = C.detectUsdFlips(s);
  assert.equal(r.patterns.length, 1);
  assert.equal(r.patterns[0].flips, 2);
});

test('L-2 경계값: R3 최소 크기 = 직전 총액의 1% (같으면 후보, 조금 작으면 아님)', () => {
  const H = { '111111': [100, 990_000] }; // 주식 99,000,000 + 원화 1,000,000 = 1억
  const prev = snap(1, '2026-10-01 10:00', { krw: 1_000_000, h: H });
  const at = [prev, snap(2, '2026-10-01 11:00', { krw: 2_000_000, h: H })].map(C.parseSnapshot); // +1,000,000 = 정확히 1%
  const below = [prev, snap(2, '2026-10-01 11:00', { krw: 1_999_000, h: H })].map(C.parseSnapshot);
  assert.equal(C.detectFlows(at).events.length, 1);
  assert.equal(C.detectFlows(at).events[0].type, 'krw_cash_change');
  assert.equal(C.detectFlows(below).events.length, 0);
});

test('M-3: 자동 청산 스위치는 엔진과 같은 방향으로 해석(정확히 true 만 ON)', () => {
  assert.equal(R.parseExitSwitch([{ key: 'exit_engine_enabled', value: 'true' }]).state, 'on');
  assert.equal(R.parseExitSwitch([{ key: 'exit_engine_enabled', value: '"false"' }]).state, 'off');
  assert.equal(R.parseExitSwitch([]).state, 'absent');
  assert.equal(R.parseExitSwitch([{ key: 'exit_engine_enabled', value: 'yes' }]).state, 'unparsable');
});

test('L-1: USD 평단 복원 — 센트 불일치·시차 초과·현재 환율 대체를 경고한다', () => {
  const series = baseSeries().map(C.parseSnapshot);
  const latest = series.at(-1);
  const odd = [{ ...STATES[0], entry_price: String(1_170_000 + 7), updated_at: '2026-10-22 12:00:00' }, STATES[1]];
  const b = C.buildBaseline(latest, series, odd);
  const row = b.rows.find((r) => r.symbol === 'NAS:AAA');
  assert.equal(row.avgUsdCentsOk, false);
  assert.ok(b.notes.some((n) => n.includes('센트 단위로 떨어지지 않음')));
  assert.ok(b.notes.some((n) => n.includes('시차') && n.includes('> 60분')));
  // USD 행이 하나도 없으면 fx_rates 현재값으로 대체 + 경고
  const noUsd = [snap(1, '2026-09-01 10:00', { h: HOLD })].map(C.parseSnapshot);
  const b2 = C.buildBaseline(noUsd[0], noUsd, STATES, {}, { pair: 'USD_KRW', rate: '1300', fetched_at: '2026-10-22 20:00:00' });
  assert.equal(b2.usedFallbackFx, true);
  assert.ok(b2.notes.some((n) => n.includes('fx_rates **현재** 환율')));
  // 정상 입력은 경고 없음
  assert.equal(C.buildBaseline(latest, series, STATES).notes.length, 0);
});

test('L-4: 현재가 = 평단(시세 폴백 의심)·종목 집합 불일치를 노트로 남긴다', () => {
  const latest = C.parseSnapshot(snap(9, '2026-10-22 20:00', { usd: 0, h: { '111111': [20, 60_000], 'NAS:AAA': [10, 1_300_000] } }));
  const states = [STATES[1], { ...STATES[0] }, { symbol: '333333', market: 'domestic', entry_price: '1000', peak_price: '1000', qty: '1', first_seen_at: '2026-10-01 00:00:00', updated_at: '2026-10-01 00:00:00' }];
  const b = C.buildBaseline(latest, [latest], states);
  assert.equal(b.rows.find((r) => r.symbol === '111111').priceFallbackSuspect, true);
  assert.ok(b.notes.some((n) => n.startsWith('333333') && n.includes('position_state 에는 있으나')));
  const b2 = C.buildBaseline(latest, [latest], [STATES[1]]);
  assert.ok(b2.notes.some((n) => n.startsWith('NAS:AAA') && n.includes('position_state 에 행이 없음')));
});

test('M-1·질문 문구: 필수/선택/결정 묶음, USD 질문은 오늘 기준·기준일은 그 답 뒤에 확정, 내부 ID·유도 문구 없음', async () => {
  const { res, outDir } = await runFake(['--no-write']);
  try {
    const a = R.analyze(await R.loadInputs(fakeConn({ rows: { series: baseSeries(), states: STATES, policy: POLICY } }), { since: '2026-10-01' }));
    const qs = R.buildQuestions(a);
    const usd = qs.find((q) => q.text.includes('실제 외화(USD) 예수금'));
    assert.equal(usd.group, 'required');
    assert.match(usd.text, /오늘\(2026-10-22\) 기준 KIS 앱/);
    const base = qs.find((q) => q.text.startsWith('손익 계산의 기준일'));
    assert.equal(base.group, 'required');
    assert.ok(base.text.includes(`질문 ${usd.n}(실제 USD 예수금)의 답을 받은 뒤에 기준 총자산을 확정`));
    assert.ok(!base.text.includes('수기 원장'), '원장 방식은 별도 결정 질문');
    const dec = qs.filter((q) => q.group === 'decision');
    assert.equal(dec.length, 1);
    assert.ok(dec[0].text.includes('수기 원장'));
    for (const q of qs) {
      assert.ok(!/T-\d{3}|§/.test(q.text), `내부 ID: ${q.text.slice(0, 40)}`);
      assert.ok(!q.text.includes('매도 대금으로 매수한 것으로 보이는데'));
    }
    assert.deepEqual(qs.map((q) => q.n), qs.map((_, i) => i + 1));
    assert.ok(res.md.includes('**필수 — 기준 총자산·원장 확정에 필요**'));
    assert.ok(res.md.includes('### 7.2 자금 이동(입출금·환전) 확인이 필요한 구간'));
    assert.ok(res.md.includes('자동 청산 엔진 스위치(생성 시각 기준'));
    assert.ok(res.md.includes('[가능성 높음] 스냅샷의 수량 변화는 **앱 밖 거래**로 보인다'));
    assert.ok(res.md.includes('행동 지침이 아니다'));
  } finally { fs.rmSync(outDir, { recursive: true, force: true }); }
});

test('M-2: 파일명에 스냅샷 id, 기본 실행과 --as-of(초 단위) 실행의 다이제스트·본문 해시가 같다', async () => {
  const one = await runFake();
  const two = await runFake(['--as-of', '2026-10-22 17:00:00']);
  try {
    assert.ok(one.res.file.endsWith('T-069-holdings-report-20261022-id6.md'), one.res.file);
    assert.equal(one.res.digest, two.res.digest);
    assert.equal(R.bodyHash(one.res.md), R.bodyHash(two.res.md));
    assert.ok(one.res.md.includes('--as-of "2026-10-22 17:00:00"'));
    assert.ok(one.res.md.includes('snapshot_ts: "2026-10-22 17:00:00"'));
  } finally {
    fs.rmSync(one.outDir, { recursive: true, force: true });
    fs.rmSync(two.outDir, { recursive: true, force: true });
  }
});

test('L-3: 오류는 코드가 붙은 ReportError 로 던진다', () => {
  assert.throws(() => R.parseArgs(['--bogus']), (e) => e instanceof R.ReportError && e.code === 'T069_ARGS');
  assert.throws(() => R.assertReadOnlySql('DROP TABLE x'), (e) => e.code === 'T069_SQL_GUARD');
});
