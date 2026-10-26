/**
 * T-096 P3 백테스트 러너 본체(시험 대상). 실행기 backtest-runner.mjs 는 DB·파일·git·엔진 로더를 연결만 한다.
 *
 * 단계(--phase):
 *   counts : 표본 수만(후보 신호·에피소드·closable·주·종목 + 갭·유동성·거래정지 필터 후 건수). 체결·기준선·지표·포트폴리오를 **부르지 않는다**.
 *            §B 해시·registry 수치 마커가 달라도 허용(경고). IS 구간·isTo 뒤 봉 미사용. --as-of 는 등록 as-of 이하면 허용.
 *   is     : 격자 전수 → 판정·고원. 관문(전부 DB 접속 전): §B 해시 일치 · **registry 수치 해시 H_r = 문서 §B 마커**(v1.1, 마커 없으면 거부) ·
 *            registry 검증 · 엔진 상수 = registry · **--as-of = 등록 as-of**(작아도 커도 거부) · G1 기록(사용자 승인, counts 리포트 지문 대조,
 *            **G1·counts 리포트의 엔진 지문 = 지금 엔진 지문** — G1 뒤 엔진·러너를 바꾸면 counts 재실행·새 G1 승인 필요) ·
 *            **git HEAD 커밋 id 조회 성공** · IS 원장 git HEAD 접두 관계(**git 조회 실패는 거부** — 'HEAD 에 그 파일이 아직 없음'만 허용).
 *            DB 뒤: 유니버스 종목 수·벤치마크 분리·데이터 범위(최소 ≤ warmupFrom, 최대 ≥ isTo)·G1 의 데이터 지문.
 *            매 실행을 is-ledger.json 에 추가 전용으로 남긴다(시각·git HEAD 커밋 id·지문 4종·리포트 경로·전략별 결과 해시).
 *   oos    : 전략 하나·1회. 위 관문 + `--unlock-oos <§B sha256>` · OOS 원장(git HEAD 접두)·잠금 파일 없음 · IS 리포트 존재.
 *            잠금 **전에** 검증: IS 리포트 지문 4종 = 현재(registry 정본·H_r·엔진·IS 구간 데이터·유니버스) · IS 리포트 결과 해시가 IS 원장에 있음 ·
 *            IS 를 다시 계산해 리포트의 격자·고원과 같음(손편집 거부) · chosen = 리포트 격자에서 다시 고른 값.
 *            그다음 잠금 파일 `wx` 배타 생성 → 원장 재읽기·추가 전용 확인 → 잠금 줄 기록 → 계산 → 결과 1회 기록.
 * 안전: DB 는 읽기 전용 세션 + 모든 질의 assertReadOnlySql(P1 과 같은 함수) — SELECT 만. KIS·주문·앱 모듈·LLM 0.
 *       쓰는 파일은 리포트(agent-vault/10-Flow/reports/T-096-backtest-* — --out/--json 도 이 안으로 제한), is-ledger.json·oos-ledger.json(추가 전용),
 *       oos-locks/*.lock(배타 생성), 엔진 컴파일 캐시(--engine-cache, 저장소 밖)뿐.
 * 엔진 지문(engine-<sha256>) = 엔진 TS 소스(import 그래프, 허용 목록 안) + 러너 파일 3개(backtest-runner.mjs·backtest-runner-core.js·
 *       postmortem-core.js — 관문·읽기 전용 SQL 검사 코드)의 **파일 바이트**. 리포트·원장·registry JSON 은 넣지 않는다(registry 는 H_r·정본 지문이 따로 덮는다).
 * 한계(코드로 못 막는 것 — 사실 서술):
 *   ① g1-record.json 의 "사용자 승인" 필드는 누가 썼는지 검증할 수 없다(승인 문구 존재·지문 정합만 본다).
 *   ② 원장·잠금·G1 을 git 커밋까지 같이 되돌리거나, **커밋 전에** 원장+잠금을 함께 되돌리면(HEAD 에 아직 없음 → 허용) HEAD 대조가 통과한다.
 *   ③ **저장소 복사본에서 실행하면** 그 복사본의 원장·잠금·G1 이 초기 상태라 통과한다. 이 코드는 .git 이 없거나(조회 실패 → 거부)
 *      다른 저장소 안에 있으면(최상위 ≠ 저장소 루트 → 거부) 막지만, 원장 기록이 커밋되기 전 시점의 커밋을 따로 clone·checkout·worktree 로 만든
 *      복사본은 HEAD 에도 원장이 초기 상태라 막지 못한다 — git 대조는 같은 저장소·같은 이력 안에서만 의미가 있다.
 *   SAFETY_PATHS 편입(사용자 결정)·결정일 보고에 원장·git 이력 첨부가 다음 방어선이다.
 */
'use strict';

const { assertReadOnlySql } = require('./postmortem-core.js');

const PHASES = ['counts', 'is', 'oos'];
const MARKETS = ['US', 'KR'];
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const SHA_RE = /^[0-9a-f]{64}$/;
/** git 커밋 id(SHA-1 40자 또는 SHA-256 64자, 소문자 16진수). */
const COMMIT_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** 문서 경로는 registry.document.path 를 쓴다. */
const PATHS = {
  registry: 'src/lib/profit-engine/registry/preregistration.json',
  ledger: 'src/lib/profit-engine/registry/oos-ledger.json',
  isLedger: 'src/lib/profit-engine/registry/is-ledger.json',
  oosLocks: 'src/lib/profit-engine/registry/oos-locks',
  g1: 'src/lib/profit-engine/registry/g1-record.json',
  reports: 'agent-vault/10-Flow/reports',
};
const REPORT_NAME_RE = /^T-096-backtest-[A-Za-z0-9._-]+\.(md|json)$/;

/** 질의 열 — counts 도 거래대금(turnover)을 읽는다(v1.1 (b) 유동성 필터 후 건수). 수익 열은 원래 없다(일봉 원값). */
const BAR_COLUMNS = ['market', 'symbol', 'd', 'open', 'high', 'low', 'close', 'volume', 'turnover', 'flags'];
const SQL = {
  bars: "SELECT market, symbol, DATE_FORMAT(trade_date, '%Y-%m-%d') AS d, open, high, low, close, volume, turnover, flags"
    + ' FROM daily_bars WHERE market = ? AND is_final = 1 AND trade_date <= ? ORDER BY symbol, trade_date',
};

function parseArgs(argv) {
  const o = { phase: null, market: 'US', strategy: 'all', asOf: null, engineCache: null, unlockOos: null, env: null, out: null, json: null, help: false, printRegistryHash: false };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let inline;
    const eq = a.startsWith('--') ? a.indexOf('=') : -1;
    if (eq > 0) { inline = a.slice(eq + 1); a = a.slice(0, eq); }
    const val = () => { if (inline !== undefined) return inline; const v = argv[++i]; if (v === undefined) throw new Error(`${a} 값 없음`); return v; };
    if (a === '--phase') o.phase = val();
    else if (a === '--counts-only') o.phase = 'counts';
    else if (a === '--market') o.market = val();
    else if (a === '--strategy') o.strategy = val();
    else if (a === '--as-of') o.asOf = val();
    else if (a === '--engine-cache') o.engineCache = val();
    else if (a === '--cache') throw new Error('--cache 는 없다: §C-1 의 일봉 JSON 캐시는 구현하지 않았다(매 실행 DB 1회 읽기). 엔진 컴파일 캐시는 --engine-cache');
    else if (a === '--unlock-oos') o.unlockOos = val();
    else if (a === '--env') o.env = val();
    else if (a === '--out') o.out = val();
    else if (a === '--json') o.json = val();
    else if (a === '--print-registry-hash') o.printRegistryHash = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`알 수 없는 인자: ${a}`);
  }
  if (o.help || o.printRegistryHash) return o;
  if (!PHASES.includes(o.phase)) throw new Error(`--phase 는 ${PHASES.join('|')}`);
  if (!MARKETS.includes(o.market)) throw new Error('--market 은 US|KR');
  if (o.asOf !== null && !YMD_RE.test(o.asOf)) throw new Error('--as-of 는 YYYY-MM-DD');
  if (o.unlockOos !== null && !SHA_RE.test(o.unlockOos)) throw new Error('--unlock-oos 는 sha256(소문자 16진수 64자)');
  if (!/^[a-z0-9-]+$/.test(o.strategy)) throw new Error('--strategy 형식 오류');
  if (o.out !== null) o.out = reportPath(o.out);
  if (o.json !== null) o.json = reportPath(o.json);
  return o;
}

/** --out/--json 은 리포트 디렉터리 안의 `T-096-backtest-*.md|json` 이름만(registry·원장 덮어쓰기 차단). 파일 이름만 줘도 된다. */
function reportPath(p) {
  const s = String(p).replace(/\\/g, '/');
  const name = s.includes('/') ? (s.startsWith(`${PATHS.reports}/`) ? s.slice(PATHS.reports.length + 1) : null) : s;
  if (name === null || name.includes('/') || !REPORT_NAME_RE.test(name)) throw new Error(`--out/--json 은 ${PATHS.reports}/T-096-backtest-*.md|json 만 허용`);
  return `${PATHS.reports}/${name}`;
}

/** --strategy all → 구현된 전략 전부(S1·S7). 등록되지 않은 id·미구현 id 는 오류 목록에. */
function resolveStrategies(registry, implementedIds, sel) {
  const errors = [];
  const reg = registry.strategies;
  const ids = sel === 'all' ? reg.filter((s) => s.implemented && implementedIds.includes(s.id)).map((s) => s.id) : [sel];
  for (const id of ids) {
    const e = reg.find((s) => s.id === id);
    if (!e) errors.push(`등록되지 않은 전략: ${id}`);
    else if (!e.implemented || !implementedIds.includes(id)) errors.push(`미구현 전략: ${id}(1단계는 S1·S7 만)`);
  }
  return { ids, errors };
}

/**
 * G1 기록(schema t096-g1@1, v1.1 확장) 정적 검사 — 사용자 승인 뒤 Leader 만 만든다(이 러너는 쓰지 않는다).
 * 필드: status 'passed' · approved_by 'user' · approval_quote(원문) · approved_at · section_b_sha256 · registry_numeric_sha256 · market ·
 *       strategies[] · rule(= registry interpretation.g1Rule) · counts_report(리포트 디렉터리의 counts json 파일 이름) · counts_report_sha256 ·
 *       combosMeetingU5AfterFilters { id: 수 } · engine_fingerprint(R2-C2 — counts 리포트 머리의 엔진 지문과 같은 값).
 *       counts 리포트는 실제로 존재하고 내용 해시·지문·건수가 맞아야 한다.
 *       **G1 결속(v1.1 §D 12-⑤)**: g1.engine_fingerprint 와 counts 리포트의 엔진 지문이 지금(is·oos 실행 시점) 엔진 지문과 같아야 한다.
 * 한계: 승인 필드의 진위(사용자가 정말 승인했는가)는 검증할 수 없다.
 */
function g1Errors(g1, ctx) {
  const { registry, market, ids, hNum, countsReport, engineFingerprint } = ctx;
  if (!g1) return ['G1 미기록(registry/g1-record.json 없음) — counts 결과로 표본 충족을 확인하고 사용자 승인 뒤 Leader 가 기록'];
  const e = [];
  if (g1.schema !== 't096-g1@1') e.push('G1 schema');
  if (g1.status !== 'passed') e.push('G1 status 가 passed 아님');
  if (g1.approved_by !== 'user' || !g1.approval_quote || !g1.approved_at) e.push('G1 사용자 승인 기록(approved_by·approval_quote·approved_at) 없음');
  if (g1.section_b_sha256 !== registry.document.section_b_sha256) e.push('G1 §B 해시 불일치');
  if (g1.registry_numeric_sha256 !== hNum) e.push('G1 registry 수치 해시 불일치');
  if (g1.market !== market) e.push(`G1 시장 불일치(${g1.market})`);
  if (g1.rule !== registry.interpretation.g1Rule) e.push('G1 rule 이 registry interpretation.g1Rule 과 다르다');
  for (const id of ids) if (!Array.isArray(g1.strategies) || !g1.strategies.includes(id)) e.push(`G1 에 없는 전략: ${id}`);
  if (typeof engineFingerprint !== 'string' || !engineFingerprint) e.push('G1 결속: 지금 엔진 지문을 모른다');
  else if (g1.engine_fingerprint !== engineFingerprint) e.push(`엔진 지문이 G1 이후 바뀌었다(G1 ${String(g1.engine_fingerprint).slice(0, 23)} ≠ 지금 ${engineFingerprint.slice(0, 23)}) — counts 재실행·새 G1 승인 필요`);
  if (!countsReport) { e.push(`G1 counts 리포트 없음(${g1.counts_report})`); return e; }
  if (countsReport.sha256 !== g1.counts_report_sha256) e.push('G1 counts 리포트 내용 해시 불일치');
  const rep = countsReport.json;
  if (!rep || !rep.head || rep.head.phase !== 'counts' || rep.head.market !== market || !rep.result) e.push('G1 counts 리포트 형식·시장 불일치');
  else {
    if (rep.head.sectionB !== registry.document.section_b_sha256) e.push('G1 counts 리포트 §B 해시 불일치');
    if (!rep.head.fingerprints || rep.head.fingerprints.registryNumeric !== hNum) e.push('G1 counts 리포트 registry 수치 해시 불일치');
    if (!rep.head.fingerprints || rep.head.fingerprints.engine !== engineFingerprint) e.push('엔진 지문이 G1 이후 바뀌었다(G1 counts 리포트의 엔진 지문 ≠ 지금) — counts 재실행·새 G1 승인 필요');
    for (const id of ids) {
      const s = (rep.result.strategies || []).find((x) => x.id === id);
      const n = s ? s.combosMeetingU5AfterFilters : null;
      if (!(n >= 1)) e.push(`G1: ${id} 의 필터 후 U5 충족 조합 0(규칙 any_combo_meets_u5_after_filters)`);
      if (!g1.combosMeetingU5AfterFilters || g1.combosMeetingU5AfterFilters[id] !== n) e.push(`G1: ${id} 충족 조합 수가 counts 리포트와 다르다`);
    }
  }
  return e;
}

/** 단계 관문(DB 접속 전). counts 는 해시·마커가 달라도 통과(경고만). is·oos 는 전부 필요 — 하나라도 어긋나면 { ok:false, code:2 }. */
function gatePhase(s) {
  const reasons = [...(s.idErrors || [])];
  const warnings = [];
  if (!s.ids || !s.ids.length) reasons.push('대상 전략 없음');
  if (s.phase === 'counts') {
    if (!s.hashCheck.ok) warnings.push(`§B 해시 불일치(${s.hashCheck.reason}) — counts 만 허용`);
    if (!s.numericCheck.ok) warnings.push(`registry 수치 해시 마커(${s.numericCheck.reason}) — counts 만 허용, is·oos 는 거부`);
    if (s.asOf !== null && s.asOf > s.registry.asOf) reasons.push(`--as-of ${s.asOf} 가 등록 as-of ${s.registry.asOf} 보다 늦다`);
    return { ok: reasons.length === 0, code: reasons.length ? 2 : 0, reasons, warnings };
  }
  if (!s.hashCheck.ok) reasons.push(`§B 해시 불일치(${s.hashCheck.reason}) — 동결 문서와 registry 가 다르다`);
  if (!s.numericCheck.ok) reasons.push(`registry 수치 해시 불일치(${s.numericCheck.reason}) — 문서 §B 의 'registry-numeric-sha256:' 줄(${s.numericCheck.marker || '없음'})과 registry(${s.numericCheck.actual})`);
  if (s.registryErrors && s.registryErrors.length) reasons.push(...s.registryErrors.map((x) => `registry: ${x}`));
  if (s.constErrors && s.constErrors.length) reasons.push(...s.constErrors.map((x) => `엔진 상수: ${x}`));
  if (s.asOf !== null && s.asOf !== s.registry.asOf) reasons.push(`--as-of ${s.asOf} ≠ 등록 as-of ${s.registry.asOf} — is·oos 는 등록 창만(U8)`);
  reasons.push(...g1Errors(s.g1, { registry: s.registry, market: s.market, ids: s.ids || [], hNum: s.numericCheck.actual, countsReport: s.g1CountsReport, engineFingerprint: s.engineFingerprint }));
  if (s.gitErrors && s.gitErrors.length) reasons.push(...s.gitErrors.map((x) => `git: ${x}`));
  if (s.isLedgerErrors && s.isLedgerErrors.length) reasons.push(...s.isLedgerErrors.map((x) => `is-ledger: ${x}`));
  if (s.phase === 'oos') {
    if (!s.unlockOos || s.unlockOos !== s.registry.document.section_b_sha256) reasons.push('--unlock-oos 가 §B sha256 과 다르다');
    if ((s.ids || []).length !== 1) reasons.push('OOS 는 전략 하나씩');
    if (s.ledgerErrors && s.ledgerErrors.length) reasons.push(...s.ledgerErrors.map((x) => `oos-ledger: ${x}`));
    for (const id of s.ids || []) {
      if (s.ledger && s.ledger.entries.some((e) => e.strategyId === id && e.market === s.market)) reasons.push(`OOS 이미 실행: ${s.market}|${id}(1회 제한)`);
      if (s.lockExists(id)) reasons.push(`OOS 잠금 파일 존재: ${s.market}|${id}(1회 제한 — 원장을 되돌려도 잠금은 남는다)`);
      if (!s.isReportExists(id)) reasons.push(`IS 리포트 없음: ${id}`);
    }
  }
  return { ok: reasons.length === 0, code: reasons.length ? 2 : 0, reasons, warnings };
}

function universeErrors(frames, registry, market) {
  const n = frames.length;
  const exp = registry.universe.expectedSymbols[market];
  const bench = registry.benchmarks[market];
  const e = [];
  if (n !== exp) e.push(`유니버스 종목 수 ${n} ≠ 등록 ${exp}`);
  if (frames.some((f) => f.symbol === bench)) e.push(`벤치마크 ${bench} 가 유니버스에 섞였다`);
  return e;
}

/** 데이터 범위: 사용한 Frame 들의 최소·최대 날짜·봉 수. */
function dataRange(frames) {
  let min = null, max = null, rows = 0;
  for (const f of frames) for (const b of f.bars) { rows++; if (min === null || b.date < min) min = b.date; if (max === null || b.date > max) max = b.date; }
  return { dataMin: min, dataMax: max, rows };
}

const numOrNull = (x) => (Number.isFinite(x) ? x : null);
/** 데이터 지문 = (행 수, 정렬 행의 정규화 해시). 행 = [시장, 종목, 날짜, 시가, 고가, 저가, 종가, 거래량, 거래대금, flags] — 숫자는 엔진이 읽은 값. */
function dataFingerprint(engine, frames) {
  const lines = [];
  for (const f of [...frames].sort((a, b) => (a.market + a.symbol < b.market + b.symbol ? -1 : 1))) {
    for (const b of f.bars) lines.push(engine.canonicalJson([f.market, f.symbol, b.date, numOrNull(b.open), numOrNull(b.high), numOrNull(b.low), numOrNull(b.close), numOrNull(b.volume), b.turnover === null ? null : numOrNull(b.turnover), b.flags]));
  }
  return { rows: lines.length, sha256: engine.sha256Hex(lines.join('\n')) };
}
function universeFingerprint(engine, frames) {
  const syms = frames.map((f) => f.symbol).sort();
  return { n: syms.length, sha256: engine.sha256Hex(syms.join('\n')) };
}

/** 격자에서 counts 에 필요한 조합만(신호 파라미터 + hold + regime — stop 은 표본 수에 영향 없음). */
function countsCombos(engine, entry, mod) {
  const seen = new Map();
  for (const p of engine.expandGrid(entry.grid)) {
    const ex = engine.executionParams(entry, p);
    const key = {};
    for (const k of mod.signalParams) key[k] = p[k];
    key.hold = ex.hold;
    key.regime = ex.regime;
    const k = JSON.stringify(Object.keys(key).sort().map((x) => [x, key[x]]));
    if (!seen.has(k)) seen.set(k, { params: key, signalParams: engine.signalParamsOf(entry, p, mod.signalParams), exec: { hold: ex.hold, regime: ex.regime } });
  }
  return [...seen.values()];
}

const countFilters = (registry, market) => ({
  gapUp: registry.execution.gapUp, gapDown: registry.execution.gapDown, gapBoundary: registry.execution.gapBoundary,
  adtvWindow: registry.execution.adtvWindow, adtvMaxShare: registry.execution.adtvMaxShare,
  slotAmount: registry.portfolio.capital[market] * registry.portfolio.slotPct,
});

/**
 * counts 단계 — engine 의 scan/regime/episode 와 진입 필터 순수 함수(gapSkip·adtv, countCombo 안)만 쓴다.
 * fill·baseline·metrics·portfolio·runCombo·judge·plateau 를 부르지 않는다. @returns 건수만(수익·승률·평균 없음)
 */
function runCounts(engine, rows, registry, market, ids) {
  const split = registry.splits[market];
  const frames = engine.buildFrames(rows, { exclude: new Set(registry.universe.excludeSymbols), until: split.isTo });
  const uErr = universeErrors(frames, registry, market);
  const index = engine.universeIndex(frames);
  const crit = registry.criteria.is;
  const filters = countFilters(registry, market);
  const short = (n, w, s) => {
    const r = [];
    if (n < crit.minEpisodes) r.push(`에피소드 ${n}<${crit.minEpisodes}`);
    if (w < crit.minWeeks) r.push(`주 ${w}<${crit.minWeeks}`);
    if (s < crit.minSymbols) r.push(`종목 ${s}<${crit.minSymbols}`);
    return r;
  };
  const out = [];
  for (const id of ids) {
    const entry = registry.strategies.find((s) => s.id === id);
    const mod = engine.signalModule(id);
    const combos = countsCombos(engine, entry, mod).map((c) => {
      const counts = engine.countCombo(frames, mod, c.signalParams, c.exec, { from: split.isFrom, to: split.isTo },
        { index, ma: registry.regime.ma }, registry.episodes.windowDays, filters);
      const up = short(counts.closableEpisodes, counts.weeks, counts.symbols);
      const af = counts.afterFilters;
      const after = short(af.entered, af.weeks, af.symbols);
      return { params: c.params, counts, meetsU5Upper: up.length === 0, shortfall: up, meetsU5AfterFilters: after.length === 0, shortfallAfterFilters: after };
    });
    const meeting = combos.filter((c) => c.meetsU5AfterFilters);
    out.push({
      id, label: entry.label, tier: entry.tier, combos, combosTotal: combos.length,
      combosMeetingU5: combos.filter((c) => c.meetsU5Upper).length,
      combosMeetingU5AfterFilters: meeting.length,
      g1Candidate: meeting.length >= 1,
      shortCombosAfterFilters: combos.filter((c) => !c.meetsU5AfterFilters).map((c) => c.params),
    });
  }
  const notImplemented = registry.strategies.filter((s) => !ids.includes(s.id)).map((s) => ({ id: s.id, label: s.label, tier: s.tier, implemented: s.implemented }));
  return {
    phase: 'counts', market, window: { from: split.isFrom, to: split.isTo, barsUntil: split.isTo, ...dataRange(frames) },
    universe: { symbols: frames.length, expected: registry.universe.expectedSymbols[market], excluded: registry.universe.excludeSymbols, errors: uErr },
    u5: { minEpisodes: crit.minEpisodes, minWeeks: crit.minWeeks, minSymbols: crit.minSymbols },
    filters,
    g1Rule: registry.interpretation.g1Rule,
    strategies: out, notImplemented, excludedStrategies: registry.excludedStrategies,
    note: 'closable = 보유 창이 IS 봉 안에 있는 에피소드(필터 전 상한). afterFilters = 진입 시점 정보(D0 종가·ADTV·D+1 시가·D+1 거래정지)로 갭·유동성·거래정지 필터를 적용한 건수. 수익·승률·초과수익은 계산하지 않았다.',
  };
}

function comboContext(engine, registry, market, frames, benchFrame, window, folds) {
  const cost = registry.costs[market];
  const capital = registry.portfolio.capital[market];
  const td = registry.data.tradingDaysPerYear;
  const ew = engine.equalWeightMonthly(frames, window.from, window.to, cost);
  const etf = benchFrame ? engine.buyAndHold(benchFrame, window.from, window.to, cost) : null;
  const delta = etf && etf.values.length >= 2 ? engine.survivorshipDelta(ew, etf, td).deltaAnnual : null;
  const ex = registry.execution;
  return {
    frames, cost,
    fillOpts: { gapUp: ex.gapUp, gapDown: ex.gapDown, gapBoundary: ex.gapBoundary, adtvWindow: ex.adtvWindow, adtvMaxShare: ex.adtvMaxShare, slotAmount: capital * registry.portfolio.slotPct },
    limitChasePct: ex.limitChasePct,
    stressMultiplier: registry.costs.sensitivity.passMultiplier,
    reportMultipliers: registry.costs.sensitivity.reportMultipliers,
    regime: { index: engine.universeIndex(frames), ma: registry.regime.ma },
    windowDays: registry.episodes.windowDays,
    cooldownToPortfolio: registry.episodes.cooldownAppliesToPortfolio,
    window, folds,
    bootstrap: { iters: registry.bootstrap.iters, seed: registry.bootstrap.seed, auxSeeds: registry.bootstrap.auxSeeds },
    deltaAnnual: delta,
    tradingDays: td,
    minN: registry.data.universeBaselineMinN,
    symbolShareDenominator: registry.interpretation.symbolShareDenominator,
    portfolio: {
      capital, slots: registry.portfolio.slots, slotPct: registry.portfolio.slotPct, gapUp: ex.gapUp, gapDown: ex.gapDown, gapBoundary: ex.gapBoundary,
      adtvWindow: ex.adtvWindow, adtvMaxShare: ex.adtvMaxShare, integerShares: registry.portfolio.integerShares,
    },
    benchmark: { equity: ew },
  };
}

const stripEpisodes = (r) => ({ metrics: r.metrics, counts: r.counts, limitModel: r.limitModel, portfolio: r.portfolio });
const roundTripJson = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

/** IS 단계(관문 통과 뒤에만 호출). 격자 전수 → 조합별 judge(IS) → 고원(v1.1 규칙). */
function runIs(engine, rows, registry, market, ids) {
  const split = registry.splits[market];
  const all = engine.buildFrames(rows, { until: split.isTo });
  const bench = all.find((f) => f.symbol === registry.benchmarks[market]) || null;
  const frames = all.filter((f) => !registry.universe.excludeSymbols.includes(f.symbol));
  const window = { from: split.isFrom, to: split.isTo };
  const ctx = comboContext(engine, registry, market, frames, bench, window, split.folds);
  const popt = engine.plateauOptionsOf(registry.interpretation);
  const keyOf = (p) => JSON.stringify(Object.keys(p).sort().map((k) => [k, p[k]]));
  const out = [];
  for (const id of ids) {
    const entry = registry.strategies.find((s) => s.id === id);
    const mod = engine.signalModule(id);
    const grid = engine.expandGrid(entry.grid).map((p) => {
      const ex = engine.executionParams(entry, p);
      const r = engine.runCombo(mod, engine.signalParamsOf(entry, p, mod.signalParams), { hold: ex.hold, stop: ex.stop, regime: ex.regime }, ctx);
      const j = engine.judge(r.metrics, null, registry.criteria, { tier: entry.tier, market, judgedMarket: registry.markets.judged });
      return { params: p, ...stripEpisodes(r), judge: j };
    });
    const pl = engine.plateau(grid.map((g) => ({ params: g.params, isM: g.metrics })), registry.criteria, entry.grid, popt);
    const mem = new Set(pl.members.map(keyOf)), edge = new Set(pl.edgeMembers.map(keyOf)), perf = new Set(pl.perfOnly.map(keyOf));
    for (const g of grid) {
      const k = keyOf(g.params);
      g.plateauRole = edge.has(k) ? 'member_edge' : mem.has(k) ? 'member' : perf.has(k) ? 'perf_only' : null;
    }
    out.push({ id, label: entry.label, tier: entry.tier, trials: grid.length, grid, plateau: pl });
  }
  return { phase: 'is', market, window: { ...window, ...dataRange([...frames, ...(bench ? [bench] : [])]) }, deltaAnnual: ctx.deltaAnnual, strategies: out };
}

/** OOS 계산(관문·검증·잠금 뒤에만 호출). chosen 1조합만. */
function runOos(engine, rows, registry, market, id, chosen, isRow) {
  const split = registry.splits[market];
  const all = engine.buildFrames(rows, { until: split.oosTo });
  const bench = all.find((f) => f.symbol === registry.benchmarks[market]) || null;
  const frames = all.filter((f) => !registry.universe.excludeSymbols.includes(f.symbol));
  const window = { from: split.oosFrom, to: split.oosTo };
  const ctx = comboContext(engine, registry, market, frames, bench, window, null);
  const entry = registry.strategies.find((s) => s.id === id);
  const mod = engine.signalModule(id);
  const ex = engine.executionParams(entry, chosen);
  const r = engine.runCombo(mod, engine.signalParamsOf(entry, chosen, mod.signalParams), { hold: ex.hold, stop: ex.stop, regime: ex.regime }, ctx);
  const j = engine.judge(isRow.metrics, r.metrics, registry.criteria, { tier: entry.tier, market, judgedMarket: registry.markets.judged });
  return {
    phase: 'oos', market, window: { ...window, ...dataRange([...frames, ...(bench ? [bench] : [])]) }, id, params: chosen, ...stripEpisodes(r),
    wfe: isRow.metrics.annualReturn > 0 && r.metrics.annualReturn !== null ? r.metrics.annualReturn / isRow.metrics.annualReturn : null, judge: j,
  };
}

function kstStamp(now) {
  const iso = new Date(now.getTime() + 9 * 3_600_000).toISOString();
  return { ymd: iso.slice(0, 10).replace(/-/g, ''), at: `${iso.slice(0, 16).replace('T', ' ')} KST` };
}

function renderCountsMd(res, head) {
  const L = [];
  L.push(`# T-096 백테스트 counts(표본 수만) — ${res.market} · ${head.generatedAt}`);
  L.push('');
  L.push(`- 사전 등록: ${head.docPath} ${head.docVersion} · §B sha256 \`${head.actualHash || '—'}\`(${head.hashOk ? '일치' : '불일치'}) · registry 수치 해시 \`${head.fingerprints.registryNumeric}\`(문서 마커 ${head.numericOk ? '일치' : `없음/불일치 — ${head.numericReason}`})`);
  L.push(`- 구간: IS ${res.window.from} ~ ${res.window.to}(이 날짜 뒤 봉 미사용) · 실제 데이터 ${res.window.dataMin} ~ ${res.window.dataMax}(${res.window.rows}봉) · as-of ${head.asOf}`);
  L.push(`- 유니버스: ${res.universe.symbols}종목(등록 ${res.universe.expected}, 제외 ${res.universe.excluded.join(', ')})${res.universe.errors.length ? ` — ⚠ ${res.universe.errors.join('; ')}` : ''} · **PIT 아님** · 데이터 지문 ${head.fingerprints.data.rows}행 \`${head.fingerprints.data.sha256.slice(0, 16)}…\``);
  L.push(`- U5(IS 최소 표본): 에피소드 ≥ ${res.u5.minEpisodes} · 주 ≥ ${res.u5.minWeeks} · 종목 ≥ ${res.u5.minSymbols} · 필터: 갭 +${res.filters.gapUp}/−${res.filters.gapDown}(경계 ${res.filters.gapBoundary}) · 슬롯 ${res.filters.slotAmount} > ADTV${res.filters.adtvWindow}×${res.filters.adtvMaxShare} 이면 제외`);
  L.push(`- G1 규칙: ${res.g1Rule}`);
  L.push(`- ${res.note}`);
  L.push('');
  for (const s of res.strategies) {
    L.push(`## ${s.label} \`${s.id}\` (tier ${s.tier}) — U5 충족 조합: 필터 전 상한 ${s.combosMeetingU5}/${s.combosTotal} · **필터 후 ${s.combosMeetingU5AfterFilters}/${s.combosTotal}**`);
    L.push('');
    L.push('| 파라미터 | 후보 신호 | 에피소드 | closable | 주 | 종목 | 필터 후 진입 | 주 | 종목 | 갭 | 거래정지 | 유동성 | 창 결측 | U5(필터 후) | 미달 |');
    L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const c of s.combos) {
      const p = Object.entries(c.params).map(([k, v]) => `${k}=${v}`).join(' ');
      const a = c.counts.afterFilters;
      L.push(`| ${p} | ${c.counts.candidates} | ${c.counts.episodes} | ${c.counts.closableEpisodes} | ${c.counts.weeks} | ${c.counts.symbols} | ${a.entered} | ${a.weeks} | ${a.symbols} | ${a.gapSkip} | ${a.haltSkip} | ${a.liquiditySkip} | ${a.windowBroken} | ${c.meetsU5AfterFilters ? '충족' : '미달'} | ${c.shortfallAfterFilters.join(', ') || '—'} |`);
    }
    L.push('');
  }
  L.push('## 이번에 세지 않은 전략(미구현·1단계 범위 밖)');
  L.push('');
  for (const n of res.notImplemented) L.push(`- ${n.label} \`${n.id}\` (tier ${n.tier})`);
  L.push('');
  return L.join('\n');
}

// ── 추가 전용 IS 원장 ──
const IS_LEDGER_SCHEMA = 't096-is-ledger@1';
function isLedgerErrors(l) {
  if (!l) return ['is-ledger.json 없음'];
  const e = [];
  if (l.schema !== IS_LEDGER_SCHEMA) e.push('schema');
  if (!Array.isArray(l.entries)) { e.push('entries'); return e; }
  l.entries.forEach((x, i) => { if (!x || x.seq !== i + 1) e.push(`seq ${i + 1} 불연속`); });
  return e;
}
/** prev → next 가 추가 전용인가(앞 줄들 정규화 동일, 줄은 늘기만). */
function isLedgerAppendOnly(engine, prev, next) {
  if (!prev || !next || prev.schema !== next.schema || !Array.isArray(next.entries) || next.entries.length < prev.entries.length) return false;
  for (let i = 0; i < prev.entries.length; i++) if (engine.canonicalJson(roundTripJson(prev.entries[i])) !== engine.canonicalJson(roundTripJson(next.entries[i]))) return false;
  return true;
}

/**
 * git HEAD 본과 접두 관계(추가 전용) — is·oos 전용(counts 는 부르지 않는다).
 * io.gitHead(rel) 계약: HEAD 에 그 경로가 없으면 **null**(허용 — 아직 커밋 전), 있으면 내용 문자열, git 자체 실패(저장소 없음·다른 저장소·
 * HEAD 없음·비정상 종료)는 **예외**. R2-C1: 예외·조회 수단 없음·계약 밖 반환값은 전부 { ok:false }(fail-closed) — 'HEAD 에 파일이 없다'는 사실만 통과.
 */
function headPrefixCheck(io, rel, current, appendOnly) {
  if (!io || typeof io.gitHead !== 'function') return { ok: false, note: `git HEAD 조회 수단 없음 — ${rel} 대조 불가, is·oos 거부` };
  let head;
  try { head = io.gitHead(rel); } catch (err) { return { ok: false, note: `git HEAD 조회 실패(${err instanceof Error ? err.message : String(err)}) — ${rel} 대조 불가, is·oos 거부('HEAD 에 파일 없음'만 허용)` }; }
  if (head === null) return { ok: true, note: `${rel} 는 HEAD 에 없음(아직 커밋 전) — 대조 생략` };
  if (typeof head !== 'string') return { ok: false, note: `git HEAD 조회 결과가 문자열·null 이 아니다(${typeof head}) — ${rel} 대조 불가, is·oos 거부` };
  let parsed;
  try { parsed = JSON.parse(head); } catch { return { ok: false, note: `HEAD 의 ${rel} 를 해석할 수 없다` }; }
  return appendOnly(parsed, current) ? { ok: true, note: `${rel}: HEAD 와 접두 관계 확인` } : { ok: false, note: `${rel} 가 HEAD 본의 추가 전용 확장이 아니다(되돌리기·수정 의심)` };
}

const lockRel = (market, id) => `${PATHS.oosLocks}/${market}-${id}.lock`;

/**
 * 전체 흐름(실행기·e2e 시험 공용). io 는 주입:
 *   readText(rel) · exists(rel) · listReports() · writeAtomic(rel, text) · createExclusive(rel, text)(있으면 예외) ·
 *   gitHead(rel) → text | null(HEAD 에 그 경로 없음) | 예외(git 실패) · gitHeadCommit() → 커밋 id | 예외 · now: Date
 *   (실행기는 makeGitIo 로 gitHead·gitHeadCommit 을 만든다 — is·oos 에서 git 실패는 거부, counts 는 git 을 부르지 않는다)
 * q = 읽기 전용 질의 함수. engine = 로더가 실은 TS 엔진. engineFingerprint = 로더의 엔진 소스 지문('engine-<sha256>').
 */
async function runPhase({ opts, engine, q, io, engineFingerprint }) {
  const written = [];
  const notes = [];
  if (!engineFingerprint || typeof engineFingerprint !== 'string') throw new Error('engineFingerprint 필요');
  const sha = (t) => engine.sha256Hex(t);
  const registry = JSON.parse(io.readText(PATHS.registry));
  const docPath = registry.document.path;
  const doc = io.readText(docPath);
  const hashCheck = engine.verifySectionB(doc, registry.document.section_b_sha256);
  const numericCheck = engine.verifyRegistryNumeric(doc, registry);
  const hNum = numericCheck.actual;
  const hFull = engine.registryFullSha256(registry);
  const registryErrors = engine.validateRegistry(registry);
  const constErrors = engine.checkEngineConstants(registry, {
    BAR_GAP_DAYS: engine.BAR_GAP_DAYS, UNIVERSE_MIN_N: engine.UNIVERSE_MIN_N,
    signalMinBars: Object.fromEntries(Object.values(engine.SIGNALS).map((m) => [m.id, m.minBars])),
  });
  const ledger = io.exists(PATHS.ledger) ? JSON.parse(io.readText(PATHS.ledger)) : null;
  const ledgerErrors = ledger ? engine.validateLedger(ledger, registry.document.section_b_sha256) : ['oos-ledger.json 없음'];
  const isLedger = io.exists(PATHS.isLedger) ? JSON.parse(io.readText(PATHS.isLedger)) : null;
  const isLedgerErr = isLedgerErrors(isLedger);
  const g1 = io.exists(PATHS.g1) ? JSON.parse(io.readText(PATHS.g1)) : null;
  let g1CountsReport = null;
  if (g1 && typeof g1.counts_report === 'string' && REPORT_NAME_RE.test(g1.counts_report) && io.exists(`${PATHS.reports}/${g1.counts_report}`)) {
    const t = io.readText(`${PATHS.reports}/${g1.counts_report}`);
    try { g1CountsReport = { sha256: sha(t), json: JSON.parse(t) }; } catch { g1CountsReport = { sha256: sha(t), json: null }; }
  }
  const { ids, errors: idErrors } = resolveStrategies(registry, Object.keys(engine.SIGNALS), opts.strategy);
  const isReportFor = (id) => {
    const re = new RegExp(`^T-096-backtest-is-${opts.market}-${id}-\\d{8}-\\d+\\.json$`);
    const files = io.listReports().filter((f) => re.test(f)).sort((a, b) => Number(a.split('-').pop().split('.')[0]) - Number(b.split('-').pop().split('.')[0]));
    for (let i = files.length - 1; i >= 0; i--) {
      try {
        const r = JSON.parse(io.readText(`${PATHS.reports}/${files[i]}`));
        if (r && r.head && r.head.sectionB === registry.document.section_b_sha256 && r.result && r.result.phase === 'is') return { file: files[i], json: r };
      } catch { /* 깨진 파일은 없는 것으로 */ }
    }
    return null;
  };
  // git HEAD 커밋 id(is·oos 만, DB 전) — 조회 실패는 거부(R2-C1·C2(c)). IS 원장 줄에 적는다.
  let gitHeadId = null;
  const gitErrors = [];
  if (opts.phase !== 'counts') {
    if (typeof io.gitHeadCommit !== 'function') gitErrors.push('HEAD 커밋 id 조회 수단 없음 — is·oos 거부');
    else {
      try {
        const id = io.gitHeadCommit();
        if (typeof id === 'string' && COMMIT_RE.test(id)) gitHeadId = id;
        else gitErrors.push(`HEAD 커밋 id 형식 오류(${String(id).slice(0, 80)}) — is·oos 거부`);
      } catch (err) { gitErrors.push(`HEAD 커밋 id 조회 실패(${err instanceof Error ? err.message : String(err)}) — is·oos 거부`); }
    }
  }
  // 원장 HEAD 대조(is·oos 만)
  const headErr = [];
  if (opts.phase !== 'counts' && isLedger && !isLedgerErr.length) {
    const h = headPrefixCheck(io, PATHS.isLedger, isLedger, (p, c) => isLedgerAppendOnly(engine, p, c));
    notes.push(h.note); if (!h.ok) headErr.push(h.note);
  }
  const oosHeadErr = [];
  if (opts.phase === 'oos' && ledger && !ledgerErrors.length) {
    const h = headPrefixCheck(io, PATHS.ledger, ledger, (p, c) => engine.verifyAppendOnly(p, c));
    notes.push(h.note); if (!h.ok) oosHeadErr.push(h.note);
  }
  const gate = gatePhase({
    phase: opts.phase, market: opts.market, ids, idErrors, hashCheck, numericCheck, registry, registryErrors, constErrors, asOf: opts.asOf,
    g1, g1CountsReport, ledger, ledgerErrors: [...ledgerErrors, ...oosHeadErr], isLedgerErrors: [...isLedgerErr, ...headErr], engineFingerprint, gitErrors,
    isReportExists: (id) => !!isReportFor(id), lockExists: (id) => io.exists(lockRel(opts.market, id)), unlockOos: opts.unlockOos,
  });
  if (!gate.ok) return { code: gate.code, reasons: gate.reasons, warnings: gate.warnings, notes, written };
  const asOf = opts.asOf || registry.asOf;
  assertReadOnlySql(SQL.bars);
  const rows = await q(SQL.bars, [opts.market, asOf]);
  const stamp = kstStamp(io.now);
  const split = registry.splits[opts.market];
  const allFrames = engine.buildFrames(rows, {});
  const isFrames = engine.buildFrames(rows, { until: split.isTo });
  const universeIs = isFrames.filter((f) => !registry.universe.excludeSymbols.includes(f.symbol));
  const fingerprints = {
    registryFull: hFull, registryNumeric: hNum, engine: engineFingerprint,
    data: { until: split.isTo, ...dataFingerprint(engine, isFrames) },
    universe: universeFingerprint(engine, universeIs),
  };
  const head = {
    task: 'T-096', phase: opts.phase, market: opts.market, generatedAt: stamp.at, asOf, docPath, docVersion: registry.document.version,
    sectionB: registry.document.section_b_sha256, actualHash: hashCheck.actual, hashOk: hashCheck.ok,
    numericOk: numericCheck.ok, numericReason: numericCheck.reason || null, fingerprints,
    universeLimitation: registry.universe.limitation, pit: registry.universe.pit, decisionDate: registry.decisionDate,
    rsiOversoldV1DecisionDate: registry.rsiOversoldV1DecisionDate, judgeCurrency: registry.markets.judgeCurrency,
    interpretation: registry.interpretation, bootstrap: registry.bootstrap,
  };
  if (opts.phase === 'counts') {
    const result = runCounts(engine, rows, registry, opts.market, ids);
    const base = `T-096-backtest-counts-${opts.market}-${stamp.ymd}`;
    const md = opts.out || `${PATHS.reports}/${base}.md`;
    const js = opts.json || `${PATHS.reports}/${base}.json`;
    io.writeAtomic(md, renderCountsMd(result, head)); written.push(md);
    io.writeAtomic(js, JSON.stringify({ head, result }, null, 2)); written.push(js);
    return { code: 0, result, reasons: [], warnings: gate.warnings, notes, written };
  }
  // ── is·oos: DB 뒤 검사 ──
  const universeAll = allFrames.filter((f) => !registry.universe.excludeSymbols.includes(f.symbol));
  const post = universeErrors(universeAll, registry, opts.market);
  const to = opts.phase === 'is' ? split.isTo : split.oosTo;
  const rng = dataRange(universeAll);
  if (!(rng.dataMin !== null && rng.dataMin <= split.warmupFrom)) post.push(`데이터 시작 ${rng.dataMin} 가 워밍업 시작 ${split.warmupFrom} 보다 늦다`);
  if (!(rng.dataMax !== null && rng.dataMax >= to)) post.push(`데이터 끝 ${rng.dataMax} 가 구간 끝 ${to} 보다 이르다(창을 자를 수 없다 — U8)`);
  if (!allFrames.some((f) => f.symbol === registry.benchmarks[opts.market])) post.push(`벤치마크 ${registry.benchmarks[opts.market]} 일봉 없음`);
  const g = g1CountsReport && g1CountsReport.json && g1CountsReport.json.head ? g1CountsReport.json.head.fingerprints : null;
  if (!g || !g.data || g.data.sha256 !== fingerprints.data.sha256 || g.data.rows !== fingerprints.data.rows) post.push('G1 counts 리포트 이후 IS 구간 데이터가 바뀌었다(데이터 지문 불일치)');
  if (!g || !g.universe || g.universe.sha256 !== fingerprints.universe.sha256) post.push('G1 counts 리포트와 유니버스 종목 목록이 다르다');
  if (post.length) return { code: 2, reasons: post, warnings: gate.warnings, notes, written };

  if (opts.phase === 'is') {
    const result = runIs(engine, rows, registry, opts.market, ids);
    const strategyHashes = result.strategies.map((s) => ({ id: s.id, resultSha256: sha(engine.canonicalJson(roundTripJson(s))) }));
    // IS 원장: 쓰기 직전 다시 읽어 추가 전용 확인 후 한 줄 추가
    const cur = JSON.parse(io.readText(PATHS.isLedger));
    if (!isLedgerAppendOnly(engine, isLedger, cur)) return { code: 2, reasons: ['is-ledger 가 실행 중에 바뀌었다'], warnings: gate.warnings, notes, written };
    const seq = cur.entries.length + 1;
    const reportOf = (sid) => `${PATHS.reports}/T-096-backtest-is-${opts.market}-${sid}-${stamp.ymd}-${seq}.json`;
    // v1.1 §D 12-②: 원장 줄에 git HEAD 커밋 id 와 리포트 경로(저장소 기준)를 함께 남긴다
    const entry = {
      seq, at: stamp.at, market: opts.market, docHash: registry.document.section_b_sha256, gitHead: gitHeadId, fingerprints,
      reports: result.strategies.map((s) => reportOf(s.id)), strategies: strategyHashes,
    };
    const next = { ...cur, entries: [...cur.entries, entry] };
    if (!isLedgerAppendOnly(engine, cur, next)) throw new Error('is-ledger: 추가 전용 위반');
    io.writeAtomic(PATHS.isLedger, `${JSON.stringify(next, null, 2)}\n`); written.push(PATHS.isLedger);
    const isHead = { ...head, isLedgerSeq: seq, gitHead: gitHeadId };
    for (const s of result.strategies) {
      const f = reportOf(s.id);
      io.writeAtomic(f, JSON.stringify({ head: isHead, result: { ...result, strategies: [s] } }, null, 2)); written.push(f);
    }
    return { code: 0, result, reasons: [], warnings: gate.warnings, notes, written };
  }

  // ── oos: 잠금 전에 IS 리포트를 전부 검증 ──
  const id = ids[0];
  const isRep = isReportFor(id);
  const rh = isRep.json.head;
  const st = isRep.json.result.strategies.find((s) => s.id === id);
  const v = [];
  if (!st) v.push(`IS 리포트에 ${id} 없음`);
  const fp = rh.fingerprints || {};
  if (fp.registryFull !== hFull) v.push('IS 리포트의 registry 정본 지문이 현재와 다르다');
  if (fp.registryNumeric !== hNum) v.push('IS 리포트의 registry 수치 해시가 현재와 다르다');
  if (fp.engine !== engineFingerprint) v.push('IS 리포트의 엔진 지문이 현재와 다르다(IS 뒤 코드 변경)');
  if (!fp.data || fp.data.sha256 !== fingerprints.data.sha256 || fp.data.rows !== fingerprints.data.rows) v.push('IS 구간 데이터 지문이 IS 리포트와 다르다');
  if (!fp.universe || fp.universe.sha256 !== fingerprints.universe.sha256) v.push('유니버스 종목 목록이 IS 리포트와 다르다');
  let chosen = null, isRow = null;
  if (st) {
    const stHash = sha(engine.canonicalJson(st));
    if (!isLedger.entries.some((e) => e.market === opts.market && e.strategies.some((x) => x.id === id && x.resultSha256 === stHash))) v.push('IS 리포트 결과 해시가 is-ledger 에 없다(리포트 손편집 의심)');
    const entry = registry.strategies.find((s) => s.id === id);
    const re = engine.plateau(st.grid.map((gr) => ({ params: gr.params, isM: gr.metrics })), registry.criteria, entry.grid, engine.plateauOptionsOf(registry.interpretation));
    if (engine.canonicalJson(roundTripJson(re.chosen)) !== engine.canonicalJson(roundTripJson(st.plateau && st.plateau.chosen))) v.push('IS 리포트의 plateau.chosen 이 격자에서 다시 고른 값과 다르다(손편집 거부)');
    // IS 재계산 — 리포트의 격자·고원 전체가 지금 코드·데이터로 같은가
    const again = runIs(engine, rows, registry, opts.market, [id]).strategies[0];
    if (engine.canonicalJson(roundTripJson(again)) !== engine.canonicalJson(st)) v.push('IS 재계산 결과가 IS 리포트와 다르다(리포트 손편집 또는 코드·데이터 변경)');
    chosen = re.chosen;
    if (!chosen) v.push(`IS 고원 선택 없음: ${id} — OOS 대상 아님(REJECTED(IS))`);
    else isRow = st.grid.find((gr) => engine.canonicalJson(gr.params) === engine.canonicalJson(roundTripJson(chosen)));
    if (chosen && !isRow) v.push('IS 리포트에 선택 조합의 지표가 없다');
  }
  if (v.length) return { code: 2, reasons: v, warnings: gate.warnings, notes, written };
  // ── 잠금: 배타 생성 → 원장 재읽기 → 잠금 줄 ──
  const lock = lockRel(opts.market, id);
  try {
    io.createExclusive(lock, `${JSON.stringify({ strategyId: id, market: opts.market, at: stamp.at, isReport: isRep.file, docHash: registry.document.section_b_sha256 }, null, 2)}\n`);
  } catch (err) {
    return { code: 2, reasons: [`OOS 잠금 파일을 만들 수 없다(이미 있음 — 동시 실행 또는 재실행): ${err instanceof Error ? err.message : String(err)}`], warnings: gate.warnings, notes, written };
  }
  written.push(lock);
  const fresh = JSON.parse(io.readText(PATHS.ledger));
  if (!engine.verifyAppendOnly(ledger, fresh) || fresh.entries.some((e) => e.strategyId === id && e.market === opts.market)) {
    return { code: 2, reasons: ['oos-ledger 가 관문 확인 뒤 바뀌었다(동시 실행 의심) — 잠금 파일은 남긴다'], warnings: gate.warnings, notes, written };
  }
  const locked = engine.appendLock(fresh, {
    strategyId: id, market: opts.market, params: chosen, sectionBSha256: registry.document.section_b_sha256,
    isReport: isRep.file, lockedAt: stamp.at, fingerprints,
  });
  if (!engine.verifyAppendOnly(fresh, locked)) throw new Error('oos-ledger: 추가 전용 위반');
  io.writeAtomic(PATHS.ledger, `${JSON.stringify(locked, null, 2)}\n`); written.push(PATHS.ledger);
  const result = runOos(engine, rows, registry, opts.market, id, chosen, isRow);
  const done = engine.recordResult(locked, id, opts.market, { verdict: result.judge.verdict, reasons: result.judge.reasons, at: stamp.at });
  if (!engine.verifyAppendOnly(locked, done)) throw new Error('oos-ledger: 추가 전용 위반');
  io.writeAtomic(PATHS.ledger, `${JSON.stringify(done, null, 2)}\n`);
  const f = `${PATHS.reports}/T-096-backtest-oos-${opts.market}-${id}-${stamp.ymd}.json`;
  io.writeAtomic(f, JSON.stringify({ head: { ...head, isReport: isRep.file }, result }, null, 2)); written.push(f);
  return { code: 0, result, reasons: [], warnings: gate.warnings, notes, written };
}

// ── TS 엔진 로더(실행기 전용) — node 20 은 .ts 를 직접 못 싣으므로 typescript.transpileModule 로 CJS 로 옮겨 캐시에 쓴다 ──
/** 엔진이 불러도 되는 소스(src 기준). 이 밖을 참조하면 로더가 거부한다(격리 시험과 같은 허용 목록). */
const ENGINE_ALLOWED = [
  /^lib\/profit-engine\/backtest\/[\w-]+\.ts$/,
  /^lib\/profit-engine\/backtest\/signals\/[\w-]+\.ts$/,
  /^lib\/profit-engine\/registry\/[\w-]+\.ts$/,
  /^lib\/strategy\/indicators\/(rsi|sma|ema|bollinger|atr)\.ts$/,
];
const ENGINE_BUILTINS = new Set(['crypto']);
const ENGINE_ENTRY = 'lib/profit-engine/backtest/index.ts';
/**
 * 엔진 지문에 함께 넣는 러너 파일(저장소 루트 기준) — 관문 코드(이 파일)·실행기·읽기 전용 SQL 검사(postmortem-core.js 의 assertReadOnlySql).
 * 바이트 그대로 넣는다. 이 파일이 자기 자신을 포함해도 지문은 "코드 파일 바이트"의 해시일 뿐이라 순환이 없다(지문을 파일에 쓰지 않는다).
 * 하나라도 없으면 지문을 만들지 않고 실패한다(fail-closed).
 */
const ENGINE_FINGERPRINT_EXTRA = [
  'scripts/profit-engine/backtest-runner.mjs',
  'scripts/profit-engine/backtest-runner-core.js',
  'scripts/profit-engine/postmortem-core.js',
];

/**
 * @param deps { ts, fs, path, crypto } — 주입(시험 가능). root = 저장소 루트, cacheDir = 출력(저장소 밖, 소유자 전용 권한 — 실행기가 확인).
 * @returns { entry: 컴파일된 진입 파일, files, fingerprintFiles, fingerprint: 'engine-<sha256 전체>' }
 *   지문 = sha256( [src 상대경로 \0 내용 \0]* (사전순) · [`root:<러너 경로>` \0 바이트 \0]* (ENGINE_FINGERPRINT_EXTRA 순서) )
 */
function buildEngine(deps, root, cacheDir) {
  const { ts, fs, path, crypto } = deps;
  const srcRoot = path.join(root, 'src');
  const relOf = (abs) => path.relative(srcRoot, abs).split(path.sep).join('/');
  const resolveTs = (base) => {
    for (const c of [`${base}.ts`, path.join(base, 'index.ts')]) if (fs.existsSync(c)) return c;
    throw new Error(`엔진 로더: 해석 불가 ${relOf(base)}`);
  };
  const files = new Map();
  const queue = [path.join(srcRoot, ENGINE_ENTRY)];
  while (queue.length) {
    const abs = queue.shift();
    const rel = relOf(abs);
    if (files.has(rel)) continue;
    if (!ENGINE_ALLOWED.some((re) => re.test(rel))) throw new Error(`엔진 로더: 허용 목록 밖 파일 ${rel}`);
    const text = fs.readFileSync(abs, 'utf8');
    const specs = ts.preProcessFile(text, true, true).importedFiles.map((x) => x.fileName);
    const map = {};
    for (const spec of specs) {
      if (ENGINE_BUILTINS.has(spec)) continue;
      let target;
      if (spec.startsWith('@/')) target = resolveTs(path.join(srcRoot, spec.slice(2)));
      else if (spec.startsWith('./') || spec.startsWith('../')) target = resolveTs(path.resolve(path.dirname(abs), spec));
      else throw new Error(`엔진 로더: 허용되지 않은 모듈 ${spec} (${rel})`);
      map[spec] = relOf(target);
      queue.push(target);
    }
    files.set(rel, { text, map });
  }
  const digest = crypto.createHash('sha256');
  for (const k of [...files.keys()].sort()) digest.update(k).update('\0').update(files.get(k).text).update('\0');
  for (const rel of ENGINE_FINGERPRINT_EXTRA) {
    const abs = path.join(root, ...rel.split('/'));
    if (!fs.existsSync(abs)) throw new Error(`엔진 지문: 러너 파일 없음 ${rel}`);
    digest.update(`root:${rel}`).update('\0').update(fs.readFileSync(abs)).update('\0');
  }
  const hex = digest.digest('hex');
  const outRoot = path.join(cacheDir, `engine-${hex.slice(0, 16)}`);
  for (const [rel, { text, map }] of files) {
    let js = ts.transpileModule(text, {
      fileName: rel,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, isolatedModules: true },
    }).outputText;
    const outFile = path.join(outRoot, rel.replace(/\.ts$/, '.js'));
    js = js.replace(/require\((["'])([^"']+)\1\)/g, (m, _q, spec) => {
      if (ENGINE_BUILTINS.has(spec)) return `require("node:${spec}")`;
      if (!map[spec]) throw new Error(`엔진 로더: 변환 뒤 알 수 없는 require ${spec} (${rel})`);
      let r = path.relative(path.dirname(outFile), path.join(outRoot, map[spec].replace(/\.ts$/, '.js'))).split(path.sep).join('/');
      if (!r.startsWith('.')) r = `./${r}`;
      return `require("${r}")`;
    });
    fs.mkdirSync(path.dirname(outFile), { recursive: true, mode: 0o700 });
    fs.writeFileSync(outFile, js, { mode: 0o600 });
  }
  return {
    entry: path.join(outRoot, ENGINE_ENTRY.replace(/\.ts$/, '.js')), files: [...files.keys()].sort(),
    fingerprintFiles: [...[...files.keys()].sort().map((k) => `src/${k}`), ...ENGINE_FINGERPRINT_EXTRA], fingerprint: `engine-${hex}`,
  };
}

/**
 * 실행기용 git 읽기 함수(R2-C1) — deps { execFileSync, fs, env } 주입(시험은 임시 저장소로 실제 git 을 돌린다). 읽기 명령만:
 * rev-parse·ls-tree·cat-file. 로케일과 무관하게 'HEAD 에 경로 없음'과 'git 실패'를 구분한다:
 *   - 환경의 GIT_* 변수를 모두 지우고(GIT_DIR 등으로 다른 저장소를 가리키는 것 차단) LC_ALL=C 로 실행, cwd = 저장소 루트.
 *   - `rev-parse --show-toplevel` 이 저장소 루트(실경로)와 같아야 한다 — .git 없는 복사본(조회 실패)·다른 저장소 안의 복사본(최상위 다름)은 예외.
 *   - gitHeadCommit: `rev-parse --verify -q HEAD^{commit}` → 커밋 id(형식 검사). HEAD 없음(커밋 0개)·실패는 예외.
 *   - gitHead(rel): 그 커밋에서 `ls-tree -z --full-tree <id> -- <rel>` — 종료 코드 0 에 출력이 비면 null(경로 없음, 허용),
 *     항목이 blob 이고 경로가 정확히 같으면 `cat-file blob <oid>` 내용. 그 밖(트리·형식 이상·비정상 종료)은 예외.
 */
function makeGitIo(deps, root) {
  const { execFileSync, fs, env } = deps;
  const cleanEnv = Object.fromEntries(Object.entries(env || {}).filter(([k]) => !/^GIT_/i.test(k)));
  cleanEnv.LC_ALL = 'C';
  cleanEnv.LANGUAGE = 'C';
  cleanEnv.GIT_TERMINAL_PROMPT = '0';
  const git = (args) => execFileSync('git', args, { cwd: root, env: cleanEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  const firstLine = (e) => String(e && e.stderr ? e.stderr : e && e.message ? e.message : e).split('\n').find((l) => l.trim()) || 'git 실패';
  const run = (args) => { try { return git(args); } catch (e) { throw new Error(`git ${args[0]} 실패: ${firstLine(e)}`); } };
  const repoCheck = () => {
    const top = run(['rev-parse', '--show-toplevel']).trim();
    if (!top || fs.realpathSync(top) !== fs.realpathSync(root)) throw new Error(`git 저장소 최상위(${top})가 저장소 루트와 다르다`);
  };
  const gitHeadCommit = () => {
    repoCheck();
    const id = run(['rev-parse', '--verify', '-q', 'HEAD^{commit}']).trim();
    if (!COMMIT_RE.test(id)) throw new Error(`HEAD 커밋 id 형식 오류: ${id.slice(0, 80)}`);
    return id;
  };
  const gitHead = (rel) => {
    if (typeof rel !== 'string' || !rel || rel.startsWith('/') || rel.split('/').includes('..')) throw new Error(`git HEAD 조회 경로 거부: ${rel}`);
    const id = gitHeadCommit();
    const ls = run(['ls-tree', '-z', '--full-tree', id, '--', rel]);
    if (ls === '') return null;
    const m = /^(\d{6}) (\w+) ([0-9a-f]{40}|[0-9a-f]{64})\t([^\0]*)\0$/.exec(ls);
    if (!m) throw new Error(`git ls-tree 출력 형식 오류(${rel})`);
    if (m[2] !== 'blob' || m[4] !== rel) throw new Error(`git ls-tree: ${rel} 이 파일(blob)이 아니다(${m[2]} ${m[4]})`);
    return run(['cat-file', 'blob', m[3]]);
  };
  return { gitHead, gitHeadCommit };
}

/**
 * 캐시 디렉터리 안전 점검(실행기 전용, fs 주입): 없으면 0700 으로 만들고, 있으면 심볼릭 링크 아님·디렉터리·소유자 = 현재 사용자·
 * 그룹/기타 권한 없음(mode & 0o077 == 0)을 확인한다. 공유 /tmp 의 예측 가능한 경로를 다른 사용자가 먼저 만들어 두는 공격을 막는다.
 */
function ensureSafeCacheDir(fs, dir, uid) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(dir);
  const e = [];
  if (st.isSymbolicLink()) e.push('심볼릭 링크');
  if (!st.isDirectory()) e.push('디렉터리 아님');
  if (uid !== null && uid !== undefined && st.uid !== uid) e.push(`소유자 ${st.uid} ≠ 현재 ${uid}`);
  if ((st.mode & 0o077) !== 0) e.push(`권한 ${(st.mode & 0o777).toString(8)} — 그룹·기타 접근 가능`);
  if (e.length) throw new Error(`엔진 캐시 디렉터리가 안전하지 않다(${dir}): ${e.join(', ')}`);
}

module.exports = {
  PHASES, MARKETS, PATHS, SQL, BAR_COLUMNS, ENGINE_ALLOWED, ENGINE_ENTRY, ENGINE_FINGERPRINT_EXTRA, REPORT_NAME_RE, IS_LEDGER_SCHEMA, COMMIT_RE,
  parseArgs, reportPath, resolveStrategies, g1Errors, gatePhase, universeErrors, countsCombos, runCounts, comboContext, runIs, runOos, runPhase,
  renderCountsMd, kstStamp, buildEngine, makeGitIo, ensureSafeCacheDir, assertReadOnlySql, dataFingerprint, universeFingerprint, dataRange,
  isLedgerErrors, isLedgerAppendOnly, headPrefixCheck, lockRel,
};
