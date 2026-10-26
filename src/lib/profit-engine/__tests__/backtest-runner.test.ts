/**
 * T-096 러너(scripts/profit-engine/backtest-runner-core.js) — 인자·읽기 전용 SQL·단계 관문·counts 가 수익 경로를 부르지 않음·
 * 합성 DB e2e 와 Reviewer 우회표(registry 수치 완화·--as-of 절단·데이터 부족·chosen/격자 손편집·원장 되돌리기·동시 OOS·G1 위조·
 * --out 덮어쓰기·엔진/데이터 변경·IS 원장 되돌리기)·엔진 로더(허용 목록·지문)·캐시 디렉터리 안전. 실제 DB·KIS 없음.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import * as engine from '../backtest';
import { walkCloses, weekdays } from './backtest-fixtures';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = require('../../../../scripts/profit-engine/backtest-runner-core.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '../../../..');
const REG_TEXT = fs.readFileSync(path.join(ROOT, core.PATHS.registry), 'utf8');
const REG = JSON.parse(REG_TEXT);
const DOC_PATH = REG.document.path;
const DOC_TEXT = fs.readFileSync(path.join(ROOT, DOC_PATH), 'utf8');
const LEDGER_TEXT = fs.readFileSync(path.join(ROOT, core.PATHS.ledger), 'utf8');
const IS_LEDGER_TEXT = fs.readFileSync(path.join(ROOT, core.PATHS.isLedger), 'utf8');
/** 동결 문서(v1.1)의 §B 해시 = registry docHash. v1.1 문서는 §B-11 에 registry 수치 마커(H_r) 한 줄이 이미 있다. */
const DOC_HASH = REG.document.section_b_sha256;
const MARKER_RE = /^registry-numeric-sha256: [0-9a-f]{64}$/m;
/** 이력: v1.0 동결 해시(마커 없는 문서) — 러너가 v1.0 해시로는 OOS 를 열지 않음을 시험할 때만 쓴다. */
const V10_HASH = '956811640d61ad959119c0b7be82b3a69d97634ec2a97aeaebaecc55a5252386';
/** 마커 줄을 지운 문서(v1.0 형식 재현) — is·oos 는 marker_missing 으로 거부돼야 한다. */
const DOC_NO_MARKER = DOC_TEXT.replace(/^registry-numeric-sha256: [0-9a-f]{64}\n\n/m, '');
const ENGINE_FP = 'engine-test-0000';
const REG_HNUM = engine.registryNumericSha256(REG);

// ── 시험용 등록 세트: 합성 유니버스(8종목)에 맞춘 registry + §B 마커를 그 registry 의 H_r 로 바꾼 문서 + 그 §B 해시 ──
// relaxed=true 면 합격 수치를 느슨하게(고원이 생기게) 등록한다 — OOS 잠금 경로를 끝까지 시험하기 위한 것이지 판정이 아니다.
function registrySet(n: number, relaxed: boolean, mutate?: (r: any) => void) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = JSON.parse(REG_TEXT);
  r.universe.expectedSymbols.US = n;
  r.bootstrap.iters = 60;
  if (relaxed) {
    for (const ph of ['is', 'oos']) Object.assign(r.criteria[ph], { minEpisodes: 1, minWeeks: 1, minSymbols: 1, maxSymbolShare: 1e9, excessLoGt: -1e9, minNetAfterDelta: -1e9, minPf: 0, minPayoff: 0, stressMinNet: -1e9, minSharpe: -1e9, maxMdd: 1e9 });
    Object.assign(r.criteria.is, { foldsMinPositive: 0, foldMaxProfitShare: 1e9 });
    r.criteria.tThresholds = { nLe100: -1e9, nGt100: -1e9 };
  }
  if (mutate) mutate(r);
  const h = engine.registryNumericSha256(r);
  const doc = DOC_TEXT.replace(MARKER_RE, `registry-numeric-sha256: ${h}`);
  if (h !== REG_HNUM && doc === DOC_TEXT) throw new Error('시험 준비: 문서 마커 줄을 바꾸지 못했다');
  r.document.section_b_sha256 = engine.sectionBSha256(doc);
  const ledger = LEDGER_TEXT.replace(DOC_HASH, r.document.section_b_sha256);
  return { reg: r, regText: JSON.stringify(r, null, 2), doc, ledger, hNum: h, docHash: r.document.section_b_sha256 };
}

// ── 합성 DB(daily_bars 행 모양, DECIMAL 은 문자열) ──
function synthRows(nSyms: number, opt: { to?: string; drift?: number; bump?: { symbol: string; date: string } } = {}) {
  const to = opt.to ?? '2026-10-23';
  const n = weekdays('2023-08-17', 900).filter((d) => d <= '2026-10-23').length;
  const dates = weekdays('2023-08-17', n);
  const rows: Array<Record<string, unknown>> = [];
  const syms = Array.from({ length: nSyms }, (_, s) => `NAS:S${String(s).padStart(2, '0')}`);
  syms.push('AMS:SPY');
  syms.forEach((sym, s) => {
    const closes = walkCloses(n, 1000 + s, 50 + s * 7, 0.025).map((c, k) => c * (1 + (opt.drift ?? 0)) ** k);
    closes.forEach((c, k) => {
      if (dates[k] > to) return;
      const o = k ? closes[k - 1] : c;
      const cc = opt.bump && opt.bump.symbol === sym && opt.bump.date === dates[k] ? c * 1.001 : c;
      rows.push({ market: 'US', symbol: sym, d: dates[k], open: o.toFixed(4), high: (Math.max(o, cc) * 1.006).toFixed(4), low: (Math.min(o, cc) * 0.994).toFixed(4), close: cc.toFixed(4), volume: '1000000', turnover: '5000000000.00', flags: null });
    });
  });
  return rows;
}

type Files = Record<string, string>;
const HEAD_ID = '1234567890abcdef1234567890abcdef12345678';
/** git: gitFail = gitHead 가 예외(저장소 없음 모사), commitFail = gitHeadCommit 예외, noGit = git 함수 자체 없음. */
function memIo(files: Files, head: Record<string, string | null> = {}, git: { gitFail?: boolean; commitFail?: boolean; noGit?: boolean; commit?: string } = {}) {
  const writes: string[] = [];
  const gitCalls: string[] = [];
  const io: Record<string, unknown> = {
    files, writes, gitCalls,
    readText: (rel: string) => { if (!(rel in files)) throw new Error(`ENOENT ${rel}`); return files[rel]; },
    exists: (rel: string) => rel in files,
    listReports: () => Object.keys(files).filter((k) => k.startsWith(`${core.PATHS.reports}/`)).map((k) => k.slice(core.PATHS.reports.length + 1)),
    writeAtomic: (rel: string, text: string) => { files[rel] = text; writes.push(rel); },
    createExclusive: (rel: string, text: string) => { if (rel in files) throw new Error(`EEXIST ${rel}`); files[rel] = text; writes.push(rel); },
    gitHead: (rel: string) => { gitCalls.push(`head:${rel}`); if (git.gitFail) throw new Error('git ls-tree 실패: fatal: not a git repository'); return rel in head ? head[rel] : null; },
    gitHeadCommit: () => { gitCalls.push('commit'); if (git.commitFail) throw new Error('git rev-parse 실패: fatal: not a git repository'); return git.commit ?? HEAD_ID; },
    now: new Date('2026-10-26T10:00:00Z'),
  };
  if (git.noGit) { delete io.gitHead; delete io.gitHeadCommit; }
  return io as {
    files: Files; writes: string[]; gitCalls: string[]; readText: (r: string) => string; exists: (r: string) => boolean; listReports: () => string[];
    writeAtomic: (r: string, t: string) => void; createExclusive: (r: string, t: string) => void; gitHead: (r: string) => string | null; gitHeadCommit: () => string; now: Date;
  };
}
const mkQ = (rows: Array<Record<string, unknown>>) => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const q = async (sql: string, params: unknown[]) => {
    core.assertReadOnlySql(sql);
    calls.push({ sql, params });
    const [market, asOf] = params as [string, string];
    return rows.filter((r) => r.market === market && String(r.d) <= asOf);
  };
  return { q, calls };
};
const opts = (o: Record<string, unknown> = {}) => ({ ...core.parseArgs(['--phase', 'counts']), ...o });
const run = (o: Record<string, unknown>, q: unknown, io: unknown, fp = ENGINE_FP) => core.runPhase({ opts: opts(o), engine, q, io, engineFingerprint: fp });
function baseFiles(set: ReturnType<typeof registrySet>): Files {
  return { [core.PATHS.registry]: set.regText, [DOC_PATH]: set.doc, [core.PATHS.ledger]: set.ledger, [core.PATHS.isLedger]: IS_LEDGER_TEXT };
}
/** counts 를 돌려 그 리포트로 G1(시험용 — 실제 승인 아님)을 만든다. fp = counts 를 돌린 엔진 지문(= G1 에 결속되는 지문). */
async function withG1(set: ReturnType<typeof registrySet>, rows: Array<Record<string, unknown>>, files: Files, fp = ENGINE_FP) {
  const io = memIo(files);
  const r = await run({}, mkQ(rows).q, io, fp);
  expect(r.code).toBe(0);
  expect(io.gitCalls).toEqual([]); // counts 는 git 을 부르지 않는다
  const name = r.written[1].split('/').pop();
  const text = files[r.written[1]];
  const rep = JSON.parse(text);
  files[core.PATHS.g1] = JSON.stringify({
    schema: 't096-g1@1', status: 'passed', approved_by: 'user', approval_quote: '(시험)', approved_at: '2026-10-26 20:00 KST',
    section_b_sha256: set.docHash, registry_numeric_sha256: set.hNum, market: 'US', strategies: ['rsi-oversold-daily', 'control-spike-contraction'],
    rule: 'any_combo_meets_u5_after_filters', counts_report: name, counts_report_sha256: engine.sha256Hex(text),
    combosMeetingU5AfterFilters: Object.fromEntries(rep.result.strategies.map((s: { id: string; combosMeetingU5AfterFilters: number }) => [s.id, s.combosMeetingU5AfterFilters])),
    engine_fingerprint: rep.head.fingerprints.engine,
  });
  return files;
}

describe('parseArgs', () => {
  test('정상·별칭·= 형식·--print-registry-hash·--engine-cache', () => {
    expect(core.parseArgs(['--phase', 'counts']).phase).toBe('counts');
    expect(core.parseArgs(['--counts-only']).phase).toBe('counts');
    expect(core.parseArgs(['--phase=is', '--market=KR', '--strategy=rsi-oversold-daily'])).toMatchObject({ phase: 'is', market: 'KR', strategy: 'rsi-oversold-daily' });
    expect(core.parseArgs(['--print-registry-hash']).printRegistryHash).toBe(true);
    expect(core.parseArgs(['--phase', 'counts', '--engine-cache', '/tmp/x']).engineCache).toBe('/tmp/x');
  });
  test.each([
    [[]], [['--phase', 'all']], [['--phase', 'is', '--market', 'JP']], [['--phase', 'is', '--as-of', '2026/10/23']],
    [['--phase', 'oos', '--unlock-oos', 'abc']], [['--phase', 'is', '--strategy', 'x;DROP']], [['--phase', 'is', '--bogus']],
    [['--phase', 'counts', '--cache', '/tmp/x']],
  ])('거부 %p', (argv) => {
    expect(() => core.parseArgs(argv)).toThrow();
  });
  test('우회 9: --out/--json 은 리포트 디렉터리의 T-096-backtest-* 만 — registry·원장·절대경로·상위 경로 거부', () => {
    expect(core.parseArgs(['--phase', 'counts', '--out', 'T-096-backtest-x.md']).out).toBe(`${core.PATHS.reports}/T-096-backtest-x.md`);
    expect(core.parseArgs(['--phase', 'counts', '--json', `${core.PATHS.reports}/T-096-backtest-y.json`]).json).toBe(`${core.PATHS.reports}/T-096-backtest-y.json`);
    for (const bad of [core.PATHS.registry, core.PATHS.ledger, core.PATHS.isLedger, '/tmp/T-096-backtest-x.md', `${core.PATHS.reports}/../T-096-backtest-x.md`,
      'T-096-backtest-x.txt', 'other.md', `${core.PATHS.reports}/sub/T-096-backtest-x.md`, 'src/lib/profit-engine/registry/T-096-backtest-x.json'])
      expect(() => core.parseArgs(['--phase', 'counts', '--out', bad])).toThrow();
  });
});

describe('읽기 전용 SQL·러너 파일', () => {
  test('질의는 SELECT 하나(?) 바인딩, P1 assertReadOnlySql 통과, 쓰기는 거부', () => {
    expect(Object.keys(core.SQL)).toEqual(['bars']);
    expect(() => core.assertReadOnlySql(core.SQL.bars)).not.toThrow();
    for (const bad of ['INSERT INTO daily_bars VALUES (1)', 'UPDATE daily_bars SET close=1', 'SELECT 1; DELETE FROM x', 'SELECT * FROM daily_bars FOR UPDATE'])
      expect(() => core.assertReadOnlySql(bad)).toThrow();
    const list = /^SELECT (.+?) FROM/.exec(core.SQL.bars)![1].replace(/DATE_FORMAT\([^)]*\)/g, 'X');
    expect(list.split(',').map((c: string) => c.trim().split(/\s+AS\s+/i).pop()!.trim())).toEqual(core.BAR_COLUMNS);
  });
  test('러너 파일에 쓰기·DDL SQL·KIS·주문·앱 모듈 없음, 실행기는 READ ONLY 세션·wx 배타 생성·git 은 읽기 명령(rev-parse·ls-tree·cat-file)만', () => {
    const files = ['backtest-runner-core.js', 'backtest-runner.mjs'].map((f) => fs.readFileSync(path.join(ROOT, 'scripts/profit-engine', f), 'utf8'));
    const src = files.join('\n');
    expect(src).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|REPLACE\s+INTO|TRUNCATE)\b/i);
    expect(src).not.toMatch(/\b(CREATE|ALTER|DROP)\s+(TABLE|DATABASE|INDEX)\b/i);
    expect(src).not.toMatch(/koreainvestment|openapi|submitOrder|createOrder|kis_access_token|\bfetch\(|@\/lib\/(safety|orders|signals|exchanges|notify|llm)/);
    expect(files[1]).toMatch(/SET SESSION TRANSACTION READ ONLY/);
    expect(files[1]).toMatch(/multipleStatements: false/);
    expect(files[1]).toMatch(/fs\.openSync\(file, 'wx'/);
    expect(files[1]).toMatch(/core\.makeGitIo\(\{ execFileSync, fs, env: process\.env \}, ROOT\)/);
    expect(files[1]).not.toMatch(/execFileSync\(/); // git 실행은 core.makeGitIo 한곳(시험 대상)
    // core 의 git 하위 명령은 읽기 3종뿐
    const sub = [...files[0].matchAll(/run\(\['([a-z-]+)'/g)].map((m) => m[1]);
    expect([...new Set(sub)].sort()).toEqual(['cat-file', 'ls-tree', 'rev-parse']);
    expect(files[0]).toMatch(/execFileSync\('git', args/);
    expect(src).not.toMatch(/['"](commit|add|push|reset|checkout|update-ref|write-tree|hash-object)['"]\s*[,\]]/);
    const req = [...files[0].matchAll(/\brequire\('([^']+)'\)/g)].map((m) => m[1]);
    expect(req).toEqual(['./postmortem-core.js']);
    const imp = [...files[1].matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]).sort();
    expect(imp).toEqual(['mysql2/promise', 'node:child_process', 'node:crypto', 'node:fs', 'node:module', 'node:os', 'node:path', 'node:url']);
  });
});

describe('counts 는 수익 경로를 부르지 않는다', () => {
  const set = registrySet(6, false);
  const THROW = () => { throw new Error('counts 단계에서 수익 경로 호출'); };
  const spyEngine = {
    ...engine,
    d1openFill: THROW, limitFill: THROW, universeBaseline: THROW, universeBaselineDetail: THROW, expectancy: THROW, clusterBootstrapCI: THROW,
    sharpe: THROW, maxDrawdown: THROW, annualizedReturn: THROW, simulate: THROW, runCombo: THROW, foldStats: THROW,
    equalWeightMonthly: THROW, buyAndHold: THROW, survivorshipDelta: THROW, judge: THROW, plateau: THROW,
  };
  test('runCounts 가 위 함수들 없이 끝나고, 결과에 수익·평균·초과수익 키가 없다(필터 후 건수 포함)', () => {
    const res = core.runCounts(spyEngine, synthRows(6), set.reg, 'US', ['rsi-oversold-daily', 'control-spike-contraction']);
    expect(res.strategies[0].combos).toHaveLength(12);
    expect(res.strategies[1].combos).toHaveLength(2);
    expect(res.strategies[0].combos[0].counts.afterFilters).toEqual(expect.objectContaining({ entered: expect.any(Number), gapSkip: expect.any(Number) }));
    const keys = new Set<string>();
    const walk = (v: unknown) => { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); } };
    walk(res);
    for (const k of keys) expect(k).not.toMatch(/ret|mean|excess|pnl|sharpe|mdd|^pf$|payoff|winrate|profit|return|equity|price|gross|^net/i);
  });
  test('정적 확인: countCombo 본문은 D+1 이후 가격(고가·저가·청산 봉)을 읽지 않고 수익 경로 이름이 없다', () => {
    const pipe = fs.readFileSync(path.join(ROOT, 'src/lib/profit-engine/backtest/pipeline.ts'), 'utf8');
    const body = pipe.slice(pipe.indexOf('export function countCombo'), pipe.indexOf('export interface ComboContext'));
    expect(body.length).toBeGreaterThan(400);
    expect(body).not.toMatch(/d1openFill|limitFill|universeBaseline|expectancy|clusterBootstrapCI|simulate|sharpe|maxDrawdown|runCombo|\.high\b|\.low\b|bars\[x\]|bars\[i \+ exec\.hold\]/);
    // 가격 읽기는 D0 종가(bars[i].close)와 D+1 시가(be.open)뿐
    expect([...body.matchAll(/\.(close|open)\b/g)].map((m) => m[0]).sort()).toEqual(['.close', '.open', '.open']);
    const c = fs.readFileSync(path.join(ROOT, 'scripts/profit-engine/backtest-runner-core.js'), 'utf8');
    const rc = c.slice(c.indexOf('function runCounts'), c.indexOf('function comboContext'));
    expect(rc).not.toMatch(/d1openFill|limitFill|universeBaseline|expectancy|clusterBootstrapCI|simulate|sharpe|maxDrawdown|runCombo|judge|plateau/);
  });
});

describe('단계 관문(단위)', () => {
  const set = registrySet(8, false);
  const g1 = { schema: 't096-g1@1', status: 'passed', approved_by: 'user', approval_quote: '승인', approved_at: 'x', section_b_sha256: set.docHash, registry_numeric_sha256: set.hNum, market: 'US', strategies: ['rsi-oversold-daily'], rule: 'any_combo_meets_u5_after_filters', counts_report: 'T-096-backtest-counts-US-20261026.json', counts_report_sha256: 'a'.repeat(64), combosMeetingU5AfterFilters: { 'rsi-oversold-daily': 3 }, engine_fingerprint: ENGINE_FP };
  const countsReport = { sha256: 'a'.repeat(64), json: { head: { phase: 'counts', market: 'US', sectionB: set.docHash, fingerprints: { registryNumeric: set.hNum, engine: ENGINE_FP } }, result: { strategies: [{ id: 'rsi-oversold-daily', combosMeetingU5AfterFilters: 3 }] } } };
  const base = {
    market: 'US', ids: ['rsi-oversold-daily'], idErrors: [], hashCheck: { ok: true }, numericCheck: { ok: true, actual: set.hNum, marker: set.hNum }, registry: set.reg,
    registryErrors: [], constErrors: [], asOf: null, g1, g1CountsReport: countsReport, ledger: JSON.parse(set.ledger), ledgerErrors: [], isLedgerErrors: [],
    isReportExists: () => true, lockExists: () => false, unlockOos: set.docHash, engineFingerprint: ENGINE_FP, gitErrors: [],
  };
  test('counts: 해시·마커 불일치·G1 없음이어도 통과(경고), as-of 가 늦으면 거부', () => {
    const g = core.gatePhase({ ...base, phase: 'counts', hashCheck: { ok: false, reason: 'hash_mismatch' }, numericCheck: { ok: false, reason: 'marker_missing' }, g1: null });
    expect(g.ok).toBe(true);
    expect(g.warnings.join()).toMatch(/해시 불일치.*|마커/);
    expect(core.gatePhase({ ...base, phase: 'counts', asOf: '2026-10-24' }).ok).toBe(false);
    expect(core.gatePhase({ ...base, phase: 'counts', asOf: '2026-01-15' }).ok).toBe(true);
  });
  test('is: 모든 조건 충족이면 통과', () => {
    expect(core.gatePhase({ ...base, phase: 'is' }).ok).toBe(true);
  });
  test.each<[string, Record<string, unknown>, RegExp]>([
    ['§B 해시 불일치', { hashCheck: { ok: false, reason: 'hash_mismatch' } }, /§B 해시 불일치/],
    ['registry 수치 마커 없음(v1.0 문서)', { numericCheck: { ok: false, reason: 'marker_missing', actual: set.hNum, marker: null } }, /registry 수치 해시 불일치\(marker_missing/],
    ['registry 수치 불일치', { numericCheck: { ok: false, reason: 'registry_numeric_mismatch', actual: 'b'.repeat(64), marker: set.hNum } }, /registry_numeric_mismatch/],
    ['엔진 상수 불일치', { constErrors: ['data.barGapDays 5 ≠ 엔진 9'] }, /엔진 상수/],
    ['--as-of 절단(작음)', { asOf: '2026-01-15' }, /--as-of 2026-01-15 ≠ 등록/],
    ['--as-of 큼', { asOf: '2026-10-24' }, /--as-of/],
    ['G1 없음', { g1: null }, /G1 미기록/],
    ['G1 사용자 승인 없음', { g1: { ...g1, approved_by: 'leader' } }, /사용자 승인/],
    ['G1 승인 시각 없음', { g1: { ...g1, approved_at: '' } }, /사용자 승인/],
    ['G1 §B 해시 다름', { g1: { ...g1, section_b_sha256: 'f'.repeat(64) } }, /G1 §B 해시/],
    ['G1 registry 수치 다름', { g1: { ...g1, registry_numeric_sha256: 'f'.repeat(64) } }, /G1 registry 수치/],
    ['G1 에 없는 전략', { g1: { ...g1, strategies: ['control-spike-contraction'] } }, /G1 에 없는 전략/],
    ['G1 규칙 다름', { g1: { ...g1, rule: 'x' } }, /rule/],
    ['G1 counts 리포트 없음', { g1CountsReport: null }, /counts 리포트 없음/],
    ['G1 counts 리포트 내용 바뀜', { g1CountsReport: { ...countsReport, sha256: 'c'.repeat(64) } }, /내용 해시/],
    ['G1 충족 조합 수 거짓', { g1: { ...g1, combosMeetingU5AfterFilters: { 'rsi-oversold-daily': 9 } } }, /충족 조합 수/],
    ['G1 충족 조합 0', { g1CountsReport: { ...countsReport, json: { ...countsReport.json, result: { strategies: [{ id: 'rsi-oversold-daily', combosMeetingU5AfterFilters: 0 }] } } }, g1: { ...g1, combosMeetingU5AfterFilters: { 'rsi-oversold-daily': 0 } } }, /충족 조합 0/],
    ['registry 오류', { registryErrors: ['trials 합계 불일치'] }, /registry/],
    ['IS 원장 오류', { isLedgerErrors: ['HEAD 접두 아님'] }, /is-ledger/],
    ['R2-C2(b) G1 엔진 지문 ≠ 지금(G1 뒤 엔진 변경)', { engineFingerprint: 'engine-changed' }, /엔진 지문이 G1 이후 바뀌었다/],
    ['R2-C2(b) G1 에 엔진 지문 없음', { g1: { ...g1, engine_fingerprint: undefined } }, /엔진 지문이 G1 이후 바뀌었다\(G1/],
    ['R2-C2(b) counts 리포트 엔진 지문만 다름', { g1CountsReport: { ...countsReport, json: { ...countsReport.json, head: { ...countsReport.json.head, fingerprints: { registryNumeric: set.hNum, engine: 'engine-old' } } } } }, /G1 counts 리포트의 엔진 지문/],
    ['R2-C2(b) 지금 엔진 지문 모름', { engineFingerprint: undefined }, /지금 엔진 지문을 모른다/],
    ['R2-C1 git 조회 실패', { gitErrors: ['HEAD 커밋 id 조회 실패(x)'] }, /^git: HEAD 커밋 id 조회 실패/m],
  ])('is 거부: %s → 코드 2', (_n, ch, re) => {
    const g = core.gatePhase({ ...base, phase: 'is', ...ch });
    expect(g.ok).toBe(false);
    expect(g.code).toBe(2);
    expect(g.reasons.join('\n')).toMatch(re);
  });
  test.each<[string, Record<string, unknown>, RegExp]>([
    ['unlock 없음', { unlockOos: null }, /unlock-oos/],
    ['unlock 다름(v1.0 해시)', { unlockOos: V10_HASH }, /unlock-oos/],
    ['unlock 다름(동결 v1.1 해시 — 시험 등록과 다름)', { unlockOos: DOC_HASH }, /unlock-oos/],
    ['원장에 이미 있음', { ledger: { ...JSON.parse(set.ledger), entries: [{ strategyId: 'rsi-oversold-daily', market: 'US' }] } }, /이미 실행/],
    ['잠금 파일 존재(원장 되돌려도)', { lockExists: () => true }, /잠금 파일 존재/],
    ['IS 리포트 없음', { isReportExists: () => false }, /IS 리포트 없음/],
    ['전략 둘', { ids: ['rsi-oversold-daily', 'control-spike-contraction'], g1: { ...g1, strategies: ['rsi-oversold-daily', 'control-spike-contraction'], combosMeetingU5AfterFilters: { 'rsi-oversold-daily': 3, 'control-spike-contraction': 1 } }, g1CountsReport: { ...countsReport, json: { ...countsReport.json, result: { strategies: [{ id: 'rsi-oversold-daily', combosMeetingU5AfterFilters: 3 }, { id: 'control-spike-contraction', combosMeetingU5AfterFilters: 1 }] } } } }, /하나씩/],
    ['원장 오류', { ledgerErrors: ['section_b_sha256'] }, /oos-ledger/],
  ])('oos 거부: %s', (_n, ch, re) => {
    const g = core.gatePhase({ ...base, phase: 'oos', ...ch });
    expect(g.ok).toBe(false);
    expect(g.reasons.join('\n')).toMatch(re);
  });
  test('oos: 조건 전부면 통과 · 전략 해석', () => {
    expect(core.gatePhase({ ...base, phase: 'oos' }).ok).toBe(true);
    const impl = Object.keys(engine.SIGNALS);
    expect(core.resolveStrategies(REG, impl, 'all').ids.sort()).toEqual(['control-spike-contraction', 'rsi-oversold-daily']);
    expect(core.resolveStrategies(REG, impl, 'pullback-trend-daily').errors.join()).toMatch(/미구현/);
    expect(core.resolveStrategies(REG, impl, 'nope').errors.join()).toMatch(/등록되지 않은/);
  });
});

describe('IS 원장 형식·추가 전용(단위)', () => {
  const L = (entries: unknown[]) => ({ schema: core.IS_LEDGER_SCHEMA, entries });
  test('seq 는 1 부터 연속, schema 고정, 없으면 오류', () => {
    expect(core.isLedgerErrors(L([{ seq: 1 }, { seq: 2 }]))).toEqual([]);
    expect(core.isLedgerErrors(L([{ seq: 1 }, { seq: 3 }])).join()).toMatch(/불연속/);
    expect(core.isLedgerErrors({ schema: 'x', entries: [] })).toContain('schema');
    expect(core.isLedgerErrors(null)).toEqual(['is-ledger.json 없음']);
  });
  test('추가 전용: 앞 줄 동일·늘기만(키 순서 무관), 줄 삭제·수정·schema 변경 거부', () => {
    const a = L([{ seq: 1, x: 1, y: 2 }]);
    expect(core.isLedgerAppendOnly(engine, a, L([{ y: 2, seq: 1, x: 1 }, { seq: 2 }]))).toBe(true);
    expect(core.isLedgerAppendOnly(engine, a, L([]))).toBe(false);
    expect(core.isLedgerAppendOnly(engine, a, L([{ seq: 1, x: 9, y: 2 }]))).toBe(false);
    expect(core.isLedgerAppendOnly(engine, a, { schema: 'x', entries: [{ seq: 1, x: 1, y: 2 }] })).toBe(false);
  });
});

describe('R2-C1 git HEAD 대조 — git 실패는 거부, "HEAD 에 파일 없음"만 허용', () => {
  const L = (n: number) => ({ schema: core.IS_LEDGER_SCHEMA, entries: Array.from({ length: n }, (_, i) => ({ seq: i + 1 })) });
  const ap = (p: unknown, c: unknown) => core.isLedgerAppendOnly(engine, p, c);
  const rel = core.PATHS.isLedger;
  test('headPrefixCheck: 예외·수단 없음·계약 밖 값 → ok:false / null → ok:true / 정상 접두·되돌림', () => {
    const fail = core.headPrefixCheck({ gitHead: () => { throw new Error('fatal: not a git repository'); } }, rel, L(1), ap);
    expect(fail.ok).toBe(false);
    expect(fail.note).toMatch(/git HEAD 조회 실패\(fatal: not a git repository\)/);
    expect(core.headPrefixCheck({}, rel, L(1), ap)).toMatchObject({ ok: false, note: expect.stringMatching(/조회 수단 없음/) });
    expect(core.headPrefixCheck(null, rel, L(1), ap).ok).toBe(false);
    expect(core.headPrefixCheck({ gitHead: () => undefined }, rel, L(1), ap).ok).toBe(false);
    expect(core.headPrefixCheck({ gitHead: () => 42 }, rel, L(1), ap).ok).toBe(false);
    expect(core.headPrefixCheck({ gitHead: () => null }, rel, L(1), ap)).toMatchObject({ ok: true, note: expect.stringMatching(/HEAD 에 없음/) });
    expect(core.headPrefixCheck({ gitHead: () => JSON.stringify(L(1)) }, rel, L(2), ap).ok).toBe(true);
    expect(core.headPrefixCheck({ gitHead: () => JSON.stringify(L(2)) }, rel, L(1), ap).ok).toBe(false);
    expect(core.headPrefixCheck({ gitHead: () => '{깨짐' }, rel, L(1), ap).ok).toBe(false);
  });

  describe('makeGitIo(실제 git, 임시 저장소 — 로케일 무관 구분)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execFileSync } = require('child_process');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't096-git-'));
    afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
    const env0 = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/.test(k)));
    const g = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd, env: env0, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const repo = path.join(tmp, 'repo');
    const empty = path.join(tmp, 'empty');
    const plain = path.join(tmp, 'plain');
    beforeAll(() => {
      for (const d of [repo, empty, plain]) fs.mkdirSync(d, { recursive: true });
      g(repo, 'init', '-q');
      fs.mkdirSync(path.join(repo, 'reg'), { recursive: true });
      fs.writeFileSync(path.join(repo, 'reg/led.json'), '{"a":1}\n');
      fs.writeFileSync(path.join(repo, 'reg/new.json'), 'uncommitted');
      g(repo, 'add', 'reg/led.json');
      g(repo, 'commit', '-q', '-m', 'x');
      g(empty, 'init', '-q');
    });
    const io = (root: string, env: Record<string, string | undefined> = env0) => core.makeGitIo({ execFileSync, fs, env }, root);
    test('HEAD 에 있는 파일 → 내용, 디스크에만 있는 파일·없는 경로 → null, 커밋 id 형식', () => {
      const x = io(repo);
      expect(x.gitHeadCommit()).toMatch(core.COMMIT_RE);
      expect(x.gitHeadCommit()).toBe(g(repo, 'rev-parse', 'HEAD').trim());
      expect(x.gitHead('reg/led.json')).toBe('{"a":1}\n');
      expect(x.gitHead('reg/new.json')).toBeNull();
      expect(x.gitHead('reg/none.json')).toBeNull();
    });
    test('git 자체 실패는 예외: 저장소 아님(.git 없는 복사본)·커밋 0개·다른 저장소의 하위 폴더·디렉터리 경로·상위 경로', () => {
      expect(() => io(plain).gitHead('reg/led.json')).toThrow(/git rev-parse 실패/);
      expect(() => io(plain).gitHeadCommit()).toThrow();
      expect(() => io(empty).gitHeadCommit()).toThrow(/git rev-parse 실패/);
      expect(() => io(empty).gitHead('x.json')).toThrow();
      expect(() => io(path.join(repo, 'reg')).gitHead('led.json')).toThrow(/최상위/);
      expect(() => io(repo).gitHead('reg')).toThrow(/blob/);
      expect(() => io(repo).gitHead('../x')).toThrow(/경로 거부/);
      expect(() => io(repo).gitHead('/etc/passwd')).toThrow(/경로 거부/);
    });
    test('GIT_DIR 등 환경 변수로 다른(빈) 저장소를 가리켜도 무시한다 — 저장소 루트의 HEAD 를 읽는다', () => {
      const x = io(repo, { ...env0, GIT_DIR: path.join(empty, '.git'), GIT_WORK_TREE: empty });
      expect(x.gitHead('reg/led.json')).toBe('{"a":1}\n');
      const y = io(plain, { ...env0, GIT_DIR: path.join(repo, '.git') });
      expect(() => y.gitHeadCommit()).toThrow();
      expect(() => io(repo, { ...env0, GIT_DIR: '/nonexistent' }).gitHeadCommit()).not.toThrow();
    });
    test('한국어 로케일이어도 같은 판정(문구가 아니라 종료 코드·출력으로 구분)', () => {
      const ko = { ...env0, LANG: 'ko_KR.UTF-8', LC_ALL: 'ko_KR.UTF-8', LANGUAGE: 'ko' };
      expect(io(repo, ko).gitHead('reg/new.json')).toBeNull();
      expect(() => io(plain, ko).gitHead('reg/led.json')).toThrow();
    });
  });
});

describe('e2e(합성 DB) — 마커 없는 문서(v1.0 형식)', () => {
  test('counts 는 경고와 함께 실행(질의 1회·리포트에 지문·필터 후 건수), is 는 마커 없음으로 DB 전에 거부', async () => {
    const set = registrySet(8, false);
    const noMarkerHash = engine.sectionBSha256(DOC_NO_MARKER);
    expect(DOC_NO_MARKER).not.toMatch(MARKER_RE);
    const files: Files = { [core.PATHS.registry]: JSON.stringify({ ...set.reg, document: { ...set.reg.document, section_b_sha256: noMarkerHash } }), [DOC_PATH]: DOC_NO_MARKER, [core.PATHS.ledger]: LEDGER_TEXT.replace(DOC_HASH, noMarkerHash), [core.PATHS.isLedger]: IS_LEDGER_TEXT };
    const rows = synthRows(8);
    const io = memIo(files);
    const { q, calls } = mkQ(rows);
    const r = await run({}, q, io);
    expect(r.code).toBe(0);
    expect(r.warnings.join()).toMatch(/marker_missing/);
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual(['US', '2026-10-23']);
    const rep = JSON.parse(files[r.written[1]]);
    expect(rep.head.fingerprints).toEqual(expect.objectContaining({ registryNumeric: set.hNum, engine: ENGINE_FP }));
    expect(rep.head.fingerprints.data.until).toBe('2025-09-30');
    expect(rep.result.window.dataMax).toBe('2025-09-30');
    expect(files[r.written[0]]).toMatch(/필터 후/);
    const q2 = mkQ(rows);
    const b = await run({ phase: 'is' }, q2.q, memIo({ ...files }));
    expect(b.code).toBe(2);
    expect(b.reasons.join()).toMatch(/marker_missing/);
    expect(q2.calls).toHaveLength(0);
  });
});

describe('e2e(합성 DB) — 마커 있는 시험 등록 + Reviewer 우회표', () => {
  // 기준선(같은 날 유니버스 평균)은 종목 10개 이상일 때만 생긴다(P1 minN) → 12종목
  const N = 12;
  const set = registrySet(N, true);
  const rows = synthRows(N, { drift: 0.0008 });
  let ready: Files;
  beforeAll(async () => { ready = await withG1(set, rows, baseFiles(set)); }, 60_000);
  const fresh = () => JSON.parse(JSON.stringify(ready)) as Files;

  test('우회 1: registry 수치 완화(docHash 그대로) → H_r 불일치로 is 거부(DB 전)', async () => {
    for (const m of [(r: any) => { r.criteria.is.minPf = 0.5; }, (r: any) => { r.episodes.windowDays = 1; }, (r: any) => { r.execution.gapUp = 0.5; }, (r: any) => { r.bootstrap.seed = 7; }]) { // eslint-disable-line @typescript-eslint/no-explicit-any
      const files = fresh();
      const r = JSON.parse(files[core.PATHS.registry]); m(r); files[core.PATHS.registry] = JSON.stringify(r);
      const { q, calls } = mkQ(rows);
      const out = await run({ phase: 'is' }, q, memIo(files));
      expect(out.code).toBe(2);
      expect(out.reasons.join()).toMatch(/registry_numeric_mismatch/);
      expect(calls).toHaveLength(0);
    }
  });
  test('우회 1b: 문서 §B 마커·docHash·registry 를 함께 바꾸면 해시 관문은 통과하지만 G1(counts 리포트 지문)이 막는다', async () => {
    const files = fresh();
    const alt = registrySet(N, true, (r) => { r.criteria.is.minPf = 0.5; });
    files[core.PATHS.registry] = alt.regText; files[DOC_PATH] = alt.doc; files[core.PATHS.ledger] = alt.ledger;
    const out = await run({ phase: 'is' }, mkQ(rows).q, memIo(files));
    expect(out.code).toBe(2);
    expect(out.reasons.join()).toMatch(/G1/);
  });
  test('우회 2: --as-of 로 창 자르기(작은 값·큰 값) → is·oos 거부', async () => {
    for (const phase of ['is', 'oos']) for (const asOf of ['2026-01-15', '2025-09-30', '2026-10-24']) {
      const out = await run({ phase, asOf, strategy: 'rsi-oversold-daily', unlockOos: set.docHash }, mkQ(rows).q, memIo(fresh()));
      expect(out.code).toBe(2);
      expect(out.reasons.join()).toMatch(/--as-of/);
    }
  });
  test('우회 3: 데이터가 구간 끝까지 없으면 거부(창을 데이터로 자르기)', async () => {
    const short = synthRows(N, { drift: 0.0008, to: '2025-08-29' });
    const out = await run({ phase: 'is' }, mkQ(short).q, memIo(fresh()));
    expect(out.code).toBe(2);
    expect(out.reasons.join()).toMatch(/데이터 끝 2025-08-29|데이터 지문/);
  });

  test('IS → is-ledger 1줄·리포트(seq 이름)·window 에 실제 데이터 범위, 두 번째 IS 는 seq 2 로 추가', async () => {
    const files = fresh();
    const io = memIo(files);
    const a = await run({ phase: 'is' }, mkQ(rows).q, io);
    expect(a.code).toBe(0);
    expect(a.written).toEqual([core.PATHS.isLedger, `${core.PATHS.reports}/T-096-backtest-is-US-rsi-oversold-daily-20261026-1.json`, `${core.PATHS.reports}/T-096-backtest-is-US-control-spike-contraction-20261026-1.json`]);
    const led = JSON.parse(files[core.PATHS.isLedger]);
    expect(led.entries).toHaveLength(1);
    expect(led.entries[0]).toEqual(expect.objectContaining({ seq: 1, market: 'US', docHash: set.docHash }));
    expect(led.entries[0].fingerprints).toEqual(expect.objectContaining({ registryNumeric: set.hNum, engine: ENGINE_FP }));
    // R2-C2(c): 원장 줄에 git HEAD 커밋 id·리포트 경로, 리포트 머리에도 커밋 id
    expect(led.entries[0].gitHead).toBe(HEAD_ID);
    expect(led.entries[0].reports).toEqual(a.written.slice(1));
    expect(JSON.parse(files[a.written[1]]).head).toEqual(expect.objectContaining({ gitHead: HEAD_ID, isLedgerSeq: 1 }));
    expect(io.gitCalls).toEqual(expect.arrayContaining(['commit', `head:${core.PATHS.isLedger}`]));
    expect(a.result.window).toEqual(expect.objectContaining({ from: '2024-02-01', to: '2025-09-30', dataMax: '2025-09-30' }));
    expect(a.result.strategies[0].plateau.chosen).not.toBeNull(); // 느슨한 시험 등록이라 고원이 생긴다
    expect(a.result.strategies[0].grid.some((g: { plateauRole: string | null }) => g.plateauRole === 'member_edge')).toBe(true);
    const b = await run({ phase: 'is' }, mkQ(rows).q, io);
    expect(b.code).toBe(0);
    expect(JSON.parse(files[core.PATHS.isLedger]).entries.map((e: { seq: number }) => e.seq)).toEqual([1, 2]);
  }, 120_000);

  test('우회 12: IS 원장 되돌리기·수정(HEAD 본과 접두 관계 아님) → is 거부, 원장 파일 삭제 → 거부', async () => {
    const files = fresh();
    const io = memIo(files);
    expect((await run({ phase: 'is', strategy: 'control-spike-contraction' }, mkQ(rows).q, io)).code).toBe(0);
    const committed = files[core.PATHS.isLedger];
    // 되돌리기: 디스크는 빈 원장, HEAD 에는 1줄
    const f2 = { ...files, [core.PATHS.isLedger]: IS_LEDGER_TEXT };
    const r1 = await run({ phase: 'is', strategy: 'control-spike-contraction' }, mkQ(rows).q, memIo(f2, { [core.PATHS.isLedger]: committed }));
    expect(r1.code).toBe(2);
    expect(r1.reasons.join()).toMatch(/HEAD 본의 추가 전용 확장이 아니다/);
    // 수정: 결과 해시 바꿔치기
    const led = JSON.parse(committed); led.entries[0].strategies[0].resultSha256 = 'f'.repeat(64);
    const r2 = await run({ phase: 'is', strategy: 'control-spike-contraction' }, mkQ(rows).q, memIo({ ...files, [core.PATHS.isLedger]: JSON.stringify(led) }, { [core.PATHS.isLedger]: committed }));
    expect(r2.code).toBe(2);
    // 삭제
    const f3 = { ...files }; delete f3[core.PATHS.isLedger];
    const r3 = await run({ phase: 'is', strategy: 'control-spike-contraction' }, mkQ(rows).q, memIo(f3));
    expect(r3.code).toBe(2);
    expect(r3.reasons.join()).toMatch(/is-ledger\.json 없음/);
  }, 120_000);

  test('R2-C1: is 에서 git HEAD 조회 실패·커밋 id 조회 실패·git 수단 없음 → DB 전 거부, counts 는 git 실패와 무관', async () => {
    for (const [git, re] of [[{ gitFail: true }, /git HEAD 조회 실패/], [{ commitFail: true }, /HEAD 커밋 id 조회 실패/], [{ noGit: true }, /조회 수단 없음/], [{ commit: 'not-a-sha' }, /커밋 id 형식 오류/]] as const) {
      const { q, calls } = mkQ(rows);
      const r = await run({ phase: 'is', strategy: 'control-spike-contraction' }, q, memIo(fresh(), {}, git));
      expect(r.code).toBe(2);
      expect(r.reasons.join('\n')).toMatch(re);
      expect(calls).toHaveLength(0);
    }
    const io = memIo(fresh(), {}, { gitFail: true, commitFail: true });
    const c = await run({}, mkQ(rows).q, io);
    expect(c.code).toBe(0);
    expect(io.gitCalls).toEqual([]);
  });

  test('R2-C2(b) G1 결속: G1 뒤 엔진 지문이 바뀌면 is 거부(DB 전), counts 재실행+새 G1 이면 통과', async () => {
    const { q, calls } = mkQ(rows);
    const r = await run({ phase: 'is', strategy: 'control-spike-contraction' }, q, memIo(fresh()), 'engine-after-g1');
    expect(r.code).toBe(2);
    expect(r.reasons.join('\n')).toMatch(/엔진 지문이 G1 이후 바뀌었다\(G1 engine-test-0000/);
    expect(r.reasons.join('\n')).toMatch(/G1 counts 리포트의 엔진 지문/);
    expect(calls).toHaveLength(0);
    const rebound = await withG1(set, rows, fresh(), 'engine-after-g1');
    const ok = await run({ phase: 'is', strategy: 'control-spike-contraction' }, mkQ(rows).q, memIo(rebound), 'engine-after-g1');
    expect(ok.code).toBe(0);
    expect(JSON.parse(rebound[core.PATHS.isLedger]).entries[0].fingerprints.engine).toBe('engine-after-g1');
  }, 120_000);

  describe('OOS', () => {
    let afterIs: Files;
    beforeAll(async () => {
      afterIs = fresh();
      const r = await run({ phase: 'is', strategy: 'rsi-oversold-daily' }, mkQ(rows).q, memIo(afterIs));
      expect(r.code).toBe(0);
    }, 120_000);
    const isRel = `${core.PATHS.reports}/T-096-backtest-is-US-rsi-oversold-daily-20261026-1.json`;
    const o = { phase: 'oos', strategy: 'rsi-oversold-daily', unlockOos: set.docHash };
    const copy = () => JSON.parse(JSON.stringify(afterIs)) as Files;

    test('정상: 잠금 파일 → 원장 잠금 줄(지문 포함) → 결과 1회, window 에 실제 데이터 범위, 두 번째 OOS 거부', async () => {
      const files = copy();
      const io = memIo(files);
      const a = await run(o, mkQ(rows).q, io);
      expect(a.code).toBe(0);
      expect(io.writes.indexOf(core.lockRel('US', 'rsi-oversold-daily'))).toBeLessThan(io.writes.indexOf(core.PATHS.ledger));
      const led = JSON.parse(files[core.PATHS.ledger]);
      expect(led.entries).toHaveLength(1);
      expect(led.entries[0].fingerprints).toEqual(expect.objectContaining({ engine: ENGINE_FP, registryNumeric: set.hNum }));
      expect(led.entries[0].result).not.toBeNull();
      expect(a.result.window).toEqual(expect.objectContaining({ from: '2025-10-01', to: '2026-10-23', dataMax: '2026-10-23' }));
      expect(io.writes.filter((w) => w === core.PATHS.ledger)).toHaveLength(2);
      const b = await run(o, mkQ(rows).q, io);
      expect(b.code).toBe(2);
      expect(b.reasons.join()).toMatch(/이미 실행|잠금 파일 존재/);
    }, 120_000);

    test('우회 4: plateau.chosen 손편집 → 잠금 전에 거부(원장·잠금 파일 미기록)', async () => {
      const files = copy();
      const rep = JSON.parse(files[isRel]);
      const st = rep.result.strategies[0];
      const other = st.grid.find((g: { params: object }) => JSON.stringify(g.params) !== JSON.stringify(st.plateau.chosen)).params;
      st.plateau.chosen = other;
      files[isRel] = JSON.stringify(rep);
      const io = memIo(files);
      const r = await run(o, mkQ(rows).q, io);
      expect(r.code).toBe(2);
      // 세 검사가 각각 따로 걸린다(하나를 지워도 나머지가 막고, 시험은 셋 다 요구)
      expect(r.reasons.join()).toMatch(/plateau\.chosen 이 격자에서 다시 고른 값과 다르다/);
      expect(r.reasons.join()).toMatch(/is-ledger 에 없다/);
      expect(r.reasons.join()).toMatch(/IS 재계산 결과가 IS 리포트와 다르다/);
      expect(files[core.PATHS.ledger]).toBe(set.ledger);
      expect(core.lockRel('US', 'rsi-oversold-daily') in files).toBe(false);
    }, 120_000);

    test('우회 5: 격자 지표 손편집(chosen 과 일관되게) → IS 원장 해시·IS 재계산으로 거부', async () => {
      const files = copy();
      const rep = JSON.parse(files[isRel]);
      rep.result.strategies[0].grid[0].metrics.netMean = 0.5;
      files[isRel] = JSON.stringify(rep);
      const r = await run(o, mkQ(rows).q, memIo(files));
      expect(r.code).toBe(2);
      expect(r.reasons.join()).toMatch(/is-ledger 에 없다/);
      expect(r.reasons.join()).toMatch(/IS 재계산 결과가 IS 리포트와 다르다/);
    }, 120_000);

    test('우회 6: OOS 뒤 원장을 빈 것으로 되돌리기 → 잠금 파일이 막고, 잠금까지 지우면 HEAD 대조가 막는다', async () => {
      const files = copy();
      const io = memIo(files);
      expect((await run(o, mkQ(rows).q, io)).code).toBe(0);
      const committedLedger = files[core.PATHS.ledger];
      files[core.PATHS.ledger] = set.ledger; // 되돌리기
      const r1 = await run(o, mkQ(rows).q, memIo(files));
      expect(r1.code).toBe(2);
      expect(r1.reasons.join()).toMatch(/잠금 파일 존재/);
      delete files[core.lockRel('US', 'rsi-oversold-daily')];
      const r2 = await run(o, mkQ(rows).q, memIo(files, { [core.PATHS.ledger]: committedLedger }));
      expect(r2.code).toBe(2);
      expect(r2.reasons.join()).toMatch(/HEAD 본의 추가 전용 확장이 아니다/);
    }, 120_000);

    test('R2-C1 G6: OOS 뒤 원장 되돌림+잠금 삭제 — HEAD 에 OOS 기록이 커밋돼 있는데 git 조회가 실패하면 거부(대조 생략 금지)', async () => {
      const files = copy();
      expect((await run(o, mkQ(rows).q, memIo(files))).code).toBe(0);
      const committedLedger = files[core.PATHS.ledger];
      files[core.PATHS.ledger] = set.ledger;
      delete files[core.lockRel('US', 'rsi-oversold-daily')];
      const { q, calls } = mkQ(rows);
      const r = await run(o, q, memIo(files, { [core.PATHS.ledger]: committedLedger }, { gitFail: true }));
      expect(r.code).toBe(2);
      expect(r.reasons.join('\n')).toMatch(/oos-ledger: git HEAD 조회 실패/);
      expect(calls).toHaveLength(0);
      expect(core.lockRel('US', 'rsi-oversold-daily') in files).toBe(false);
      // 커밋 id 조회만 실패해도 거부
      const r2 = await run(o, mkQ(rows).q, memIo(copy(), {}, { commitFail: true }));
      expect(r2.code).toBe(2);
      expect(r2.reasons.join('\n')).toMatch(/git: HEAD 커밋 id 조회 실패/);
    }, 120_000);

    test('N53: OOS 는 최신(seq 가 가장 큰) IS 리포트를 쓴다 — 잠금 파일·원장 잠금 줄의 isReport', async () => {
      const files = copy();
      const again = await run({ phase: 'is', strategy: 'rsi-oversold-daily' }, mkQ(rows).q, memIo(files));
      expect(again.code).toBe(0);
      const latest = 'T-096-backtest-is-US-rsi-oversold-daily-20261026-2.json';
      expect(again.written).toContain(`${core.PATHS.reports}/${latest}`);
      expect(`${core.PATHS.reports}/T-096-backtest-is-US-rsi-oversold-daily-20261026-1.json` in files).toBe(true);
      const r = await run(o, mkQ(rows).q, memIo(files));
      expect(r.code).toBe(0);
      expect(JSON.parse(files[core.lockRel('US', 'rsi-oversold-daily')]).isReport).toBe(latest);
      expect(JSON.parse(files[core.PATHS.ledger]).entries[0].isReport).toBe(latest);
    }, 180_000);

    test('우회 7: 동시 OOS 2회 → 정확히 1회만 성공(배타 잠금)', async () => {
      const files = copy();
      const io = memIo(files);
      const [a, b] = await Promise.all([run(o, mkQ(rows).q, io), run(o, mkQ(rows).q, io)]);
      expect([a.code, b.code].sort()).toEqual([0, 2]);
      expect([...a.reasons, ...b.reasons].join()).toMatch(/잠금 파일을 만들 수 없다/);
      expect(JSON.parse(files[core.PATHS.ledger]).entries).toHaveLength(1);
    }, 120_000);

    test('C-3: 잠금 직후 원장을 다시 읽어 그사이 바뀌었으면 중단(잠금 파일은 남김)', async () => {
      const files = copy();
      const io = memIo(files);
      const realCreate = io.createExclusive;
      io.createExclusive = (rel: string, text: string) => {
        realCreate(rel, text);
        const l = JSON.parse(files[core.PATHS.ledger]);
        l.entries.push({ strategyId: 'rsi-oversold-daily', market: 'US', params: {}, sectionBSha256: set.docHash, isReport: 'x', lockedAt: 'x', result: null });
        files[core.PATHS.ledger] = JSON.stringify(l); // 다른 프로세스가 끼어든 상황
      };
      const r = await run(o, mkQ(rows).q, io);
      expect(r.code).toBe(2);
      expect(r.reasons.join()).toMatch(/관문 확인 뒤 바뀌었다/);
      expect(core.lockRel('US', 'rsi-oversold-daily') in files).toBe(true);
    }, 120_000);

    test('우회 10·11: IS 뒤 엔진 코드·IS 구간 데이터·registry 가 바뀌면 거부', async () => {
      const r1 = await run(o, mkQ(rows).q, memIo(copy()), 'engine-changed');
      expect(r1.code).toBe(2);
      expect(r1.reasons.join()).toMatch(/엔진 지문이 G1 이후 바뀌었다/); // G1 결속이 DB 전에 먼저 막는다
      // G1 까지 새 엔진으로 다시 결속해도(counts 재실행·새 G1) IS 리포트의 엔진 지문이 막는다(잠금 전)
      const rebound = await withG1(set, rows, copy(), 'engine-changed');
      const r1b = await run(o, mkQ(rows).q, memIo(rebound), 'engine-changed');
      expect(r1b.code).toBe(2);
      expect(r1b.reasons.join()).toMatch(/IS 리포트의 엔진 지문이 현재와 다르다/);
      expect(core.lockRel('US', 'rsi-oversold-daily') in rebound).toBe(false);
      const bumped = synthRows(N, { drift: 0.0008, bump: { symbol: 'NAS:S03', date: '2025-03-03' } });
      const r2 = await run(o, mkQ(bumped).q, memIo(copy()));
      expect(r2.code).toBe(2);
      expect(r2.reasons.join()).toMatch(/데이터 지문/);
    }, 120_000);

    test('IS 리포트 머리의 지문 손편집(registry 정본·H_r·데이터·유니버스) → 각각 거부', async () => {
      const cases: Array<[string, (h: any) => void, RegExp]> = [ // eslint-disable-line @typescript-eslint/no-explicit-any
        ['registryFull', (h) => { h.fingerprints.registryFull = 'f'.repeat(64); }, /registry 정본 지문/],
        ['registryNumeric', (h) => { h.fingerprints.registryNumeric = 'f'.repeat(64); }, /registry 수치 해시가 현재와 다르다/],
        ['data', (h) => { h.fingerprints.data.sha256 = 'f'.repeat(64); }, /IS 구간 데이터 지문이 IS 리포트와 다르다/],
        ['universe', (h) => { h.fingerprints.universe.sha256 = 'f'.repeat(64); }, /유니버스 종목 목록이 IS 리포트와 다르다/],
      ];
      for (const [, edit, re] of cases) {
        const files = copy();
        const rep = JSON.parse(files[isRel]); edit(rep.head); files[isRel] = JSON.stringify(rep);
        const r = await run(o, mkQ(rows).q, memIo(files));
        expect(r.code).toBe(2);
        expect(r.reasons.join()).toMatch(re);
        expect(files[core.PATHS.ledger]).toBe(set.ledger);
      }
    }, 120_000);

    test('우회 3b: OOS 데이터가 oosTo 전에 끝나면 거부(IS 구간 데이터는 그대로)', async () => {
      const short = synthRows(N, { drift: 0.0008, to: '2026-01-15' });
      const r = await run(o, mkQ(short).q, memIo(copy()));
      expect(r.code).toBe(2);
      expect(r.reasons.join()).toMatch(/데이터 끝 2026-01-15 가 구간 끝 2026-10-23 보다 이르다/);
    }, 120_000);

    test('G1 뒤 IS 구간 데이터가 바뀌면 is 거부(G1 counts 리포트 지문)', async () => {
      const bumped = synthRows(N, { drift: 0.0008, bump: { symbol: 'NAS:S03', date: '2025-03-03' } });
      const r = await run({ phase: 'is', strategy: 'control-spike-contraction' }, mkQ(bumped).q, memIo(copy()));
      expect(r.code).toBe(2);
      expect(r.reasons.join()).toMatch(/G1 counts 리포트 이후 IS 구간 데이터가 바뀌었다/);
    }, 120_000);

    test('우회 8(한계): G1 을 에이전트가 직접 쓰는 것은 승인 진위를 못 가린다 — 단 counts 리포트와 지문·건수가 맞아야 하고, 아니면 거부', async () => {
      const files = copy();
      const g = JSON.parse(files[core.PATHS.g1]);
      // 정합한 위조(내용은 counts 와 일치) → 관문 통과(한계 — 코드로 구분 불가)
      expect(core.gatePhase).toBeDefined();
      const forgedOk = { ...g, approval_quote: '(에이전트가 씀)' };
      files[core.PATHS.g1] = JSON.stringify(forgedOk);
      const r1 = await run({ phase: 'is', strategy: 'control-spike-contraction' }, mkQ(rows).q, memIo({ ...files }));
      expect(r1.code).toBe(0);
      // 건수 부풀리기·다른 counts 리포트 → 거부
      files[core.PATHS.g1] = JSON.stringify({ ...g, combosMeetingU5AfterFilters: { ...g.combosMeetingU5AfterFilters, 'rsi-oversold-daily': 99 } });
      expect((await run({ phase: 'is' }, mkQ(rows).q, memIo({ ...files }))).code).toBe(2);
      files[core.PATHS.g1] = JSON.stringify({ ...g, counts_report_sha256: 'e'.repeat(64) });
      expect((await run({ phase: 'is' }, mkQ(rows).q, memIo({ ...files }))).code).toBe(2);
    }, 120_000);
  });
});

describe('R2-C3 registry 고정값이 실제로 소비된다(D 시리즈) — registry 값을 바꾼 사본을 직접 주입(해시 관문 밖 시험 경로)', () => {
  const N = 12;
  const rows = synthRows(N, { drift: 0.0004 });
  const base = registrySet(N, false).reg;
  const variant = (m: (r: any) => void) => { const r = JSON.parse(JSON.stringify(base)); m(r); return r; }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const sid = (r: any, id: string) => r.strategies.find((s: { id: string }) => s.id === id); // eslint-disable-line @typescript-eslint/no-explicit-any
  const candidates = (reg: unknown, id: string) => core.runCounts(engine, rows, reg, 'US', [id]).strategies[0].combos.map((c: { counts: { candidates: number } }) => c.counts.candidates);
  const s1Base = candidates(base, 'rsi-oversold-daily');
  const s7Base = candidates(base, 'control-spike-contraction');
  test('기준: 합성 자료에서 S1 은 발화한다(빈 결과로 통과 방지)', () => {
    expect(s1Base.reduce((a: number, b: number) => a + b, 0)).toBeGreaterThan(0);
  });
  test.each<[string, string, (r: any) => void]>([ // eslint-disable-line @typescript-eslint/no-explicit-any
    ['D01 S1 fixed.maMult 1.005 → 0.97', 'rsi-oversold-daily', (r) => { sid(r, 'rsi-oversold-daily').fixed.maMult = 0.97; }],
    ['D02 S1 fixed.rsiPeriod 14 → 7', 'rsi-oversold-daily', (r) => { sid(r, 'rsi-oversold-daily').fixed.rsiPeriod = 7; }],
    ['D03 S1 fixed.maPeriod 20 → 10', 'rsi-oversold-daily', (r) => { sid(r, 'rsi-oversold-daily').fixed.maPeriod = 10; }],
    ['D04 S7 fixed.spike 0.15 → 0.05', 'control-spike-contraction', (r) => { sid(r, 'control-spike-contraction').fixed.spike = 0.05; }],
    ['D05 S7 fixed.atrPeriod 5 → 2', 'control-spike-contraction', (r) => { sid(r, 'control-spike-contraction').fixed.atrPeriod = 2; }],
  ])('%s → counts 의 후보 신호 수가 달라진다(코드 상수였다면 같았을 것)', (_n, id, m) => {
    const got = candidates(variant(m), id);
    expect(got).not.toEqual(id === 'rsi-oversold-daily' ? s1Base : s7Base);
  });

  // D07·D08·D09 — comboContext(registry → ctx) → runCombo
  const split = base.splits.US;
  const all = engine.buildFrames(rows as never, { until: split.isTo });
  const bench = all.find((f) => f.symbol === base.benchmarks.US) || null;
  const frames = all.filter((f) => !base.universe.excludeSymbols.includes(f.symbol));
  const window = { from: split.isFrom, to: split.isTo };
  const entry = sid(base, 'rsi-oversold-daily');
  const mod = engine.signalModule('rsi-oversold-daily')!;
  const P = engine.signalParamsOf(entry, { th: 45 }, mod.signalParams);
  const exec = { hold: 5, stop: 0.05, regime: false };
  const ctxOf = (reg: unknown) => core.comboContext(engine, reg, 'US', frames, bench, window, split.folds);
  const lite = (m: (r: any) => void = () => {}) => variant((r) => { r.bootstrap.iters = 200; m(r); }); // eslint-disable-line @typescript-eslint/no-explicit-any
  const r0 = engine.runCombo(mod, P, exec, ctxOf(lite()));
  test('기준: 거래·기준선 초과수익·샤프가 있다', () => {
    expect(r0.metrics.n).toBeGreaterThan(10);
    expect(r0.metrics.excessMean).not.toBeNull();
    expect(r0.metrics.sharpe).not.toBe(0);
    expect(r0.metrics.benchSharpe).not.toBeNull();
  });
  test('D07 data.tradingDaysPerYear → ctx.tradingDays → 샤프·벤치 샤프 연율화 √(365/252)·연수익·δ_trade', () => {
    const ctx = ctxOf(lite((r) => { r.data.tradingDaysPerYear = 365; }));
    expect(ctx.tradingDays).toBe(365);
    const r = engine.runCombo(mod, P, exec, ctx);
    expect(r.metrics.sharpe! / r0.metrics.sharpe!).toBeCloseTo(Math.sqrt(365 / 252), 10);
    expect(r.metrics.benchSharpe! / r0.metrics.benchSharpe!).toBeCloseTo(Math.sqrt(365 / 252), 10);
    expect(r.metrics.annualReturn).not.toBe(r0.metrics.annualReturn);
    expect(engine.sharpe([100, 101, 100.5, 102, 101], 365) / engine.sharpe([100, 101, 100.5, 102, 101], 252)).toBeCloseTo(Math.sqrt(365 / 252), 12);
  });
  test('D08 data.universeBaselineMinN → ctx.minN → 기준선(유니버스 12종목 < 13 이면 기준선 없음 → 초과수익 없음)', () => {
    const ctx = ctxOf(lite((r) => { r.data.universeBaselineMinN = 13; }));
    expect(ctx.minN).toBe(13);
    const r = engine.runCombo(mod, P, exec, ctx);
    expect(r.metrics.excessMean).toBeNull();
    expect(r.metrics.excessLo).toBeNull();
    expect(r0.metrics.excessMean).not.toBeNull();
  });
  test('D09 bootstrap.auxSeeds → ctx → 보조 시드 하한 = 그 시드로 다시 계산한 값(주 시드 값이 아님)', () => {
    const ctx = ctxOf(lite((r) => { r.bootstrap.auxSeeds = [7, 8]; }));
    expect(ctx.bootstrap).toEqual(expect.objectContaining({ auxSeeds: [7, 8], seed: base.bootstrap.seed, iters: 200 }));
    const r = engine.runCombo(mod, P, exec, ctx);
    const taken = r.episodes.filter((e) => engine.isTaken(e.fill) && e.excess[5] !== undefined);
    const xs = taken.map((e) => e.excess[5]), ws = taken.map((e) => e.week);
    expect(r.metrics.excessLoAux).toEqual([7, 8].map((sd) => engine.clusterBootstrapCI(xs, ws, 200, sd).lo));
    expect(r.metrics.excessLo).toBe(engine.clusterBootstrapCI(xs, ws, 200, base.bootstrap.seed).lo);
    expect(r.metrics.excessLoAux).not.toEqual([r.metrics.excessLo, r.metrics.excessLo]);
  });
  test('counts 필터도 registry 값을 쓴다 — adtvMaxShare 를 극단으로 바꾸면 유동성 제외로 진입 0', () => {
    const a = core.runCounts(engine, rows, base, 'US', ['rsi-oversold-daily']).strategies[0].combos;
    const b = core.runCounts(engine, rows, variant((r) => { r.execution.adtvMaxShare = 1e-9; }), 'US', ['rsi-oversold-daily']).strategies[0].combos;
    expect(a.some((c: { counts: { afterFilters: { entered: number } } }) => c.counts.afterFilters.entered > 0)).toBe(true);
    expect(b.every((c: { counts: { afterFilters: { entered: number; liquiditySkip: number } } }) => c.counts.afterFilters.entered === 0)).toBe(true);
    expect(b.some((c: { counts: { afterFilters: { liquiditySkip: number } } }) => c.counts.afterFilters.liquiditySkip > 0)).toBe(true);
  });
});

describe('X05·X06 데이터·유니버스 지문 내용', () => {
  const rows = synthRows(4, { to: '2024-06-28' });
  const fr = (rs: Array<Record<string, unknown>>) => engine.buildFrames(rs as never, {});
  const fp0 = core.dataFingerprint(engine, fr(rows));
  const edit = (k: number, ch: Record<string, unknown>) => rows.map((r, i) => (i === k ? { ...r, ...ch } : r));
  test('데이터 지문: 거래대금·flags·거래량·OHLC 한 값이 바뀌면 달라지고, 행 순서와는 무관', () => {
    const k = 37;
    for (const ch of [{ turnover: '5000000001.00' }, { flags: 'zero_volume' }, { volume: '1000001' }, { open: '1.2345' }, { high: '999.0000' }, { low: '0.5000' }, { close: '77.7777' }]) {
      const f = core.dataFingerprint(engine, fr(edit(k, ch)));
      expect(f.rows).toBe(fp0.rows);
      expect(f.sha256).not.toBe(fp0.sha256);
    }
    expect(core.dataFingerprint(engine, fr([...rows].reverse()))).toEqual(fp0);
    expect(core.dataFingerprint(engine, fr(rows.slice(0, -1))).rows).toBe(fp0.rows - 1);
  });
  test('유니버스 지문: 종목 하나(마지막 포함)를 바꾸거나 빼면 달라지고, 순서와는 무관', () => {
    const syms = (list: string[]) => list.map((s) => ({ symbol: s }));
    const u0 = core.universeFingerprint(engine, syms(['NAS:A', 'NAS:B', 'NAS:C']));
    expect(u0.n).toBe(3);
    expect(core.universeFingerprint(engine, syms(['NAS:C', 'NAS:A', 'NAS:B']))).toEqual(u0);
    expect(core.universeFingerprint(engine, syms(['NAS:A', 'NAS:B', 'NAS:D'])).sha256).not.toBe(u0.sha256);
    expect(core.universeFingerprint(engine, syms(['NAS:Z', 'NAS:B', 'NAS:C'])).sha256).not.toBe(u0.sha256);
    expect(core.universeFingerprint(engine, syms(['NAS:A', 'NAS:B'])).sha256).not.toBe(u0.sha256);
    expect(core.universeFingerprint(engine, syms(['NAS:A', 'NAS:B', 'NAS:C'])).sha256).toBe(engine.sha256Hex('NAS:A\nNAS:B\nNAS:C'));
  });
});

describe('엔진 로더·캐시 디렉터리', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't096-loader-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
  test('실제 엔진: 허용 파일만, 지문 = engine-<sha256 64자>, 컴파일본이 TS 원본과 같은 결과', () => {
    const b = core.buildEngine({ ts, fs, path, crypto }, ROOT, tmp);
    expect(b.fingerprint).toMatch(/^engine-[0-9a-f]{64}$/);
    expect(b.files.every((f: string) => core.ENGINE_ALLOWED.some((re: RegExp) => re.test(f)))).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const compiled = require(b.entry);
    expect(compiled.verifySectionB(DOC_TEXT, DOC_HASH).ok).toBe(true);
    expect(compiled.verifyRegistryNumeric(DOC_TEXT, REG).ok).toBe(true); // 동결 문서 마커 = 동결 registry H_r
    expect(compiled.registryNumericSha256(REG)).toBe(engine.registryNumericSha256(REG));
    const rows = synthRows(4, { to: '2024-12-31' });
    const P = { maMult: 1.005, rsiPeriod: 14, maPeriod: 20, th: 40 };
    const a = engine.scanSignals(engine.buildFrames(rows as never), engine.signalModule('rsi-oversold-daily')!, P, '2024-01-01', '2024-12-31');
    const c = compiled.scanSignals(compiled.buildFrames(rows), compiled.signalModule('rsi-oversold-daily'), P, '2024-01-01', '2024-12-31');
    expect(c).toEqual(a);
    expect(a.length).toBeGreaterThan(0);
    expect(core.buildEngine({ ts, fs, path, crypto }, ROOT, tmp).fingerprint).toBe(b.fingerprint); // 결정적
  });
  function fakeRoot(entryText: string, extra: Record<string, string> = {}) {
    const r = fs.mkdtempSync(path.join(tmp, 'root-'));
    const put = (rel: string, t: string) => { fs.mkdirSync(path.dirname(path.join(r, rel)), { recursive: true }); fs.writeFileSync(path.join(r, rel), t); };
    put('src/lib/profit-engine/backtest/index.ts', entryText);
    for (const [k, v] of Object.entries(extra)) put(k, v);
    return r;
  }
  test('R2-C2(a)·X: 엔진 지문 범위 = 엔진 소스 + 러너 3파일(backtest-runner.mjs·backtest-runner-core.js·postmortem-core.js)', () => {
    const b = core.buildEngine({ ts, fs, path, crypto }, ROOT, tmp);
    expect(core.ENGINE_FINGERPRINT_EXTRA).toEqual(['scripts/profit-engine/backtest-runner.mjs', 'scripts/profit-engine/backtest-runner-core.js', 'scripts/profit-engine/postmortem-core.js']);
    expect(b.fingerprintFiles).toEqual(expect.arrayContaining([...core.ENGINE_FINGERPRINT_EXTRA, 'src/lib/profit-engine/backtest/index.ts', 'src/lib/profit-engine/registry/evaluate-pass.ts']));
    expect(b.fingerprintFiles.filter((f: string) => f.startsWith('scripts/'))).toEqual(core.ENGINE_FINGERPRINT_EXTRA);
    // 손으로 다시 계산한 값과 같다(규칙: src 상대경로 사전순 → root:러너 경로 순서, 각 항목 키 \0 바이트 \0)
    const h = crypto.createHash('sha256');
    for (const f of b.files) h.update(f).update('\0').update(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')).update('\0');
    for (const f of core.ENGINE_FINGERPRINT_EXTRA) h.update(`root:${f}`).update('\0').update(fs.readFileSync(path.join(ROOT, f))).update('\0');
    expect(b.fingerprint).toBe(`engine-${h.digest('hex')}`);
  });
  test('R2-C2(a)·X: 러너 파일 한 바이트·엔진 소스 한 바이트가 바뀌면 지문이 바뀌고, 러너 파일이 없으면 실패', () => {
    const extras = (over: Record<string, string> = {}) => Object.fromEntries(core.ENGINE_FINGERPRINT_EXTRA.map((f: string) => [f, over[f] ?? `// ${f}\n`]));
    const fp = (entry: string, over: Record<string, string> = {}) => core.buildEngine({ ts, fs, path, crypto }, fakeRoot(entry, extras(over)), tmp).fingerprint;
    const base = fp('export const x = 1;\n');
    expect(fp('export const x = 1;\n')).toBe(base); // 결정적(위치 무관)
    expect(fp('export const x = 2;\n')).not.toBe(base);
    const seen = new Set([base]);
    for (const f of core.ENGINE_FINGERPRINT_EXTRA) {
      const v = fp('export const x = 1;\n', { [f]: `// ${f}\n ` });
      expect(seen.has(v)).toBe(false);
      seen.add(v);
    }
    // 내용을 서로 바꿔 넣어도 다르다(경로가 키에 들어간다)
    const [a, b2] = core.ENGINE_FINGERPRINT_EXTRA;
    expect(fp('export const x = 1;\n', { [a]: `// ${b2}\n`, [b2]: `// ${a}\n` })).not.toBe(base);
    for (const f of core.ENGINE_FINGERPRINT_EXTRA) {
      const r = fakeRoot('export const x = 1;\n', extras());
      fs.rmSync(path.join(r, f));
      expect(() => core.buildEngine({ ts, fs, path, crypto }, r, tmp)).toThrow(/러너 파일 없음/);
    }
  });
  test.each<[string, string, Record<string, string>, RegExp]>([
    ['안전장치 import', "import { x } from '@/lib/safety/kill-switch';\nexport const y = x;", { 'src/lib/safety/kill-switch.ts': 'export const x = 1;' }, /허용 목록 밖/],
    ['strategy 의 다른 모듈', "import { a } from '@/lib/strategy/engine';\nexport const y = a;", { 'src/lib/strategy/engine.ts': 'export const a = 1;' }, /허용 목록 밖/],
    ['indicators 의 허용 외 모듈(macd)', "import { macd } from '@/lib/strategy/indicators/macd';\nexport const y = macd;", { 'src/lib/strategy/indicators/macd.ts': 'export const macd = 1;' }, /허용 목록 밖/],
    ['node fs', "import fs from 'fs';\nexport const y = fs;", {}, /허용되지 않은 모듈/],
    ['외부 패키지', "import mysql from 'mysql2';\nexport const y = mysql;", {}, /허용되지 않은 모듈/],
    ['상대경로로 폴더 탈출', "import { z } from '../../db';\nexport const y = z;", { 'src/lib/db.ts': 'export const z = 1;' }, /허용 목록 밖/],
  ])('거부: %s', (_n, entry, extra, re) => {
    expect(() => core.buildEngine({ ts, fs, path, crypto }, fakeRoot(entry, extra), tmp)).toThrow(re);
  });
  test('캐시 디렉터리: 없으면 0700 생성, 심볼릭 링크·그룹/기타 권한·남의 소유는 거부', () => {
    const uid = process.getuid ? process.getuid() : null;
    const d1 = path.join(tmp, 'c1');
    core.ensureSafeCacheDir(fs, d1, uid);
    expect(fs.statSync(d1).mode & 0o777).toBe(0o700);
    const d2 = path.join(tmp, 'c2'); fs.mkdirSync(d2, { mode: 0o755 }); fs.chmodSync(d2, 0o755);
    expect(() => core.ensureSafeCacheDir(fs, d2, uid)).toThrow(/권한/);
    const d3 = path.join(tmp, 'c3'); fs.symlinkSync(d1, d3);
    expect(() => core.ensureSafeCacheDir(fs, d3, uid)).toThrow(/심볼릭/);
    if (uid !== null) expect(() => core.ensureSafeCacheDir(fs, d1, uid + 1)).toThrow(/소유자/);
  });
});
