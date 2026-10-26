/**
 * T-096 사전 등록 잠금 — §B 해시(문서에서 직접 재계산)·registry 수치 ↔ §B 원문 대조·시행 수 N·OOS 원장(추가 전용)·판정 진리표·고원 선택.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  canonicalJson, extractRegistryMarker, extractSectionB, registryFullSha256, registryNumericSha256, sectionBSha256, verifyRegistryNumeric, verifySectionB,
} from '../registry/hash';
import { appendLock, hasOosRun, recordResult, validateLedger, verifyAppendOnly, type Ledger } from '../registry/oos-ledger';
import { checkEngineConstants, executionParams, expandGrid, signalParamsOf, strategyEntry, trialCount, validateRegistry, type Registry } from '../registry/registry';
import { judge, plateau, plateauOptionsOf, tThreshold, type JudgeOptions, type StrategyMetrics } from '../registry/evaluate-pass';
import registryJson from '../registry/preregistration.json';
import ledgerJson from '../registry/oos-ledger.json';
import { gapSkip, tickSize } from '../backtest/fill';
import { FLAG_ADJ_ORPHAN, FLAG_ADJ_STALE, FLAG_CORP, FLAG_ZERO_VOLUME } from '../backtest/frames';

const ROOT = path.resolve(__dirname, '../../../..');
const reg = registryJson as unknown as Registry;
const DOC = fs.readFileSync(path.join(ROOT, reg.document.path), 'utf8');
const B = extractSectionB(DOC);
/** v1.1 동결(2026-10-27 00:30 KST) — §B 해시·registry 수치 해시(H_r). */
const FROZEN = '0626cbd22ab0269d16486e99807cae9f6f43e78f0253cc8f59cfb657997cbc15';
const H_R = '543d1f4cd4cd5e7140a1e208ea7851a0ecd284fcc6887a2428e686d8867391fc';
/** 이력: v1.0 동결 문서(수정 금지 — 그대로 남아 있어야 한다). */
const V10_PATH = 'docs/design/2026-10-26-strategy-validation-preregistration-v1.0.md';
const V10_HASH = '956811640d61ad959119c0b7be82b3a69d97634ec2a97aeaebaecc55a5252386';
const MARKER_LINE = `registry-numeric-sha256: ${H_R}`;
const DOC_NO_MARKER = DOC.replace(`${MARKER_LINE}\n\n`, '');

describe('§B 해시 잠금', () => {
  test('문서에서 다시 계산한 해시 = registry = 문서 머리 sha256_section_B = 동결값(v1.1)', () => {
    expect(sectionBSha256(DOC)).toBe(FROZEN);
    expect(reg.document.section_b_sha256).toBe(FROZEN);
    expect(DOC).toMatch(new RegExp(`^sha256_section_B: ${FROZEN}$`, 'm'));
    expect(verifySectionB(DOC, reg.document.section_b_sha256)).toEqual({ ok: true, actual: FROZEN });
  });
  test('v1.1 동결 기록: registry document 블록 = 문서 머리(경로·버전·시각·승인 원문), interpretation v1.1', () => {
    expect(reg.document).toMatchObject({
      path: 'docs/design/2026-10-26-strategy-validation-preregistration-v1.1.md', version: 'v1.1', frozen_at: '2026-10-27 00:30 KST',
      approved_by: 'user', approval_quote: 'V1~V3 권고대로 진행해줘',
    });
    expect(DOC).toMatch(/^version: v1\.1$/m);
    expect(DOC).toMatch(/^supersedes: v1\.0$/m);
    expect(DOC).toMatch(/^status: frozen$/m);
    expect(DOC).toMatch(/^frozen_at: "2026-10-27 00:30 KST"$/m);
    expect(DOC).toMatch(/^approved_by: user$/m);
    expect(DOC).toMatch(/^approval_quote: "V1~V3 권고대로 진행해줘"$/m);
    expect(reg.interpretation.version).toBe('v1.1');
  });
  test('이력: v1.0 동결 문서는 그대로 남아 있고 §B 해시가 여전히 956811640d61…(마커 없음) — v1.1 해시와 다르다', () => {
    const v10 = fs.readFileSync(path.join(ROOT, V10_PATH), 'utf8');
    expect(sectionBSha256(v10)).toBe(V10_HASH);
    expect(v10).toMatch(new RegExp(`^sha256_section_B: ${V10_HASH}$`, 'm'));
    expect(v10).toMatch(/^version: v1\.0$/m);
    expect(extractRegistryMarker(v10)).toBeNull();
    expect(V10_HASH).not.toBe(FROZEN);
    // registry 는 v1.0 이 아니라 v1.1 문서를 가리킨다
    expect(reg.document.path).not.toBe(V10_PATH);
  });
  test('범위: §B 제목으로 시작, §C 제목·끝의 --- 를 포함하지 않는다', () => {
    expect(B.startsWith('## B. 사전 등록 본문')).toBe(true);
    expect(B).not.toMatch(/## C\. P3 구현 명세/);
    expect(B.endsWith('---')).toBe(false);
    expect(B).toMatch(/B-11\. 버전·변경 금지 선언/);
  });
  test('변이: §B 한 글자 바꾸면 불일치, §A·§C 를 바꾸면 그대로', () => {
    expect(verifySectionB(DOC.replace('에피소드 ≥ 150', '에피소드 ≥ 140'), FROZEN).ok).toBe(false);
    // v1.1: §B-12 실행 기본값·§B-11 마커도 해시 안이다
    expect(verifySectionB(DOC.replace('거래일 **252**', '거래일 **365**'), FROZEN).ok).toBe(false);
    expect(verifySectionB(DOC.replace('ADTV20(거래대금) × 0.1% 이면 미진입', 'ADTV20(거래대금) × 1% 이면 미진입'), FROZEN).ok).toBe(false);
    expect(verifySectionB(DOC.replace(MARKER_LINE, `registry-numeric-sha256: ${'f'.repeat(64)}`), FROZEN).ok).toBe(false);
    expect(verifySectionB(DOC_NO_MARKER, FROZEN).ok).toBe(false);
    expect(verifySectionB(DOC.replace('### C-6. 단계 분할과 수용 기준', '### C-6. 바뀐 제목'), FROZEN).ok).toBe(true);
    expect(verifySectionB(DOC.replace('## A. 5줄 요약', '## A. 요약'), FROZEN).ok).toBe(true);
    expect(verifySectionB(DOC.replace(/\n/g, '\r\n'), FROZEN).ok).toBe(false);
    expect(verifySectionB(DOC, 'abc').reason).toBe('expected_malformed');
    // §C 제목 줄이 사라지면 끝 경계를 못 찾는다 → 불일치(조용히 문서 끝까지 해시하지 않는다)
    expect(verifySectionB(DOC.replace(/^## C\. P3 구현 명세/m, '## C. 다른'), FROZEN).ok).toBe(false);
    // §B 제목 줄이 두 번이면 거부
    expect(verifySectionB(DOC.replace(/^## E\. /m, '## B. 사전 등록 본문 사본\n## E. '), FROZEN).ok).toBe(false);
  });
});

describe('registry 수치 = §B 원문(사람이 읽는 값 ↔ 기계가 읽는 값)', () => {
  const has = (s: string) => expect(B.includes(s)).toBe(true);
  test('형식 검증 통과, 라이브 값(th 38·lo 40)이 격자 안', () => {
    expect(validateRegistry(reg)).toEqual([]);
  });
  test('시행 수: Tier A 56·대조군 2·Tier B 20·시장당 78·전체 156 (§B-2)', () => {
    expect(trialCount(reg)).toEqual({ tierA: 56, control: 2, tierB: 20, perMarket: 78 });
    expect(reg.trials.total).toBe(156);
    has('S1 24 + S2 24 + S4 8 = **56**');
    has('| **합계** | **78** | 78 (전체 156) |');
  });
  test('격자(§B-1)', () => {
    expect(strategyEntry(reg, 'rsi-oversold-daily')!.grid).toEqual({ th: [30, 35, 38], hold: [5, 10], stop: [0.03, 0.05], regime: [false, true] });
    has('`th ∈ {30, 35, 38}`(라이브 38) × `hold ∈ {5, 10}` × `stop ∈ {3%, 5%}` = **12** × 레짐 on/off = **24**');
    expect(strategyEntry(reg, 'pullback-trend-daily')!.grid.lo).toEqual([35, 40, 45]);
    has('`lo ∈ {35, 40, 45}`(라이브 40/50 → lo 40) × `hold ∈ {5, 10}` × `stop ∈ {3%, 5%}` = 12 × 레짐 on/off = **24**');
    expect(strategyEntry(reg, 'xs-momentum')!.grid).toEqual({ L: [6, 12], k: [10, 15], regime: [false, true] });
    has('`L ∈ {6, 12}` × `k ∈ {10, 15}` × 레짐 on/off = **8**');
    expect(strategyEntry(reg, 'control-spike-contraction')!.grid).toEqual({ hold: [5, 10] });
    expect(strategyEntry(reg, 'control-spike-contraction')!.fixed.stop).toBe(0.05);
    has('`hold ∈ {5, 10}`, stop 5% 고정 = **2**');
    has('`r ∈ {1.2(라이브), 1.5, 2.0}` × `hold ∈ {10, 20}`, stop 5% | 6');
    has('`b ∈ {2%, 3%, 5%}` × `hold ∈ {10, 20}`, stop 5% | 6');
    expect(reg.strategies.filter((s) => s.implemented).map((s) => s.id).sort()).toEqual(['control-spike-contraction', 'rsi-oversold-daily']);
  });
  test('분할(§B-3)', () => {
    expect(reg.splits.US).toMatchObject({ isFrom: '2024-02-01', isTo: '2025-09-30', oosFrom: '2025-10-01', oosTo: '2026-10-23' });
    expect(reg.splits.KR).toMatchObject({ isFrom: '2024-05-01', isTo: '2025-09-30', oosFrom: '2025-10-01', oosTo: '2026-10-23' });
    has('**2024-02-01 ~ 2025-09-30**(20개월) | 2024-05-01 ~ 2025-09-30(17개월)');
    has('**2025-10-01 ~ 2026-10-23** (12.7개월');
    has('F1: ~2024-12 → 검증 2025-01~03 · F2: ~2025-03 → 2025-04~06 · F3: ~2025-06 → 2025-07~09');
    expect(reg.splits.US.folds.map((f) => `${f.testFrom}~${f.testTo}`)).toEqual(['2025-01-01~2025-03-31', '2025-04-01~2025-06-30', '2025-07-01~2025-09-30']);
  });
  test('비용(§B-4)', () => {
    has('**US 0.65%**(0.25+0.25+0.15) · 손절 **0.75%** / **KR 0.33%**(0.18+0.15) · 손절 **0.43%**');
    has('슬리피지 ×1.5(US 0.725%·KR 0.405%)');
    const c = reg.costs;
    expect(c.US.feeRoundTrip + c.US.slippage).toBeCloseTo(0.0065, 12);
    expect(c.US.feeRoundTrip + c.US.stopSlippage).toBeCloseTo(0.0075, 12);
    expect(c.KR.feeRoundTrip + c.KR.slippage).toBeCloseTo(0.0033, 12);
    expect(c.KR.feeRoundTrip + c.KR.stopSlippage).toBeCloseTo(0.0043, 12);
    expect(c.sensitivity.passMultiplier).toBe(1.5);
    has('갭 필터(+2%/−3%)');
    expect([reg.execution.gapUp, reg.execution.gapDown]).toEqual([0.02, 0.03]);
  });
  test('합격 조건(§B-6) — IS·OOS', () => {
    has('| 1-1 | 표본(미달 = `INSUFFICIENT`, 불합격 아님) | 에피소드 ≥ 150 · 서로 다른 주 ≥ 40 · 기여 종목 ≥ 15 | ≥ 80 · ≥ 20주 · ≥ 10종목 |');
    has('| 1-2 | 단일 종목 손익 비중 | ≤ 15% | ≤ 15% |');
    has('t ≥ 2.5(N ≤ 100) / 3.0(N > 100)');
    has('| 1-4 | 순기대값 − δ_trade | ≥ **+0.40%** | ≥ **+0.30%** |');
    has('| ≥ 1.4 / ≥ 1.5 | ≥ 1.3 / ≥ 1.5 |');
    has('| 1-6 | 비용 민감도 | 슬리피지 ×1.5 에서 순기대값 ≥ 0 | 같음 |');
    has('≥ 2폴드 양(+) 초과수익 · 한 폴드 이익 ≤ 총이익 60%');
    has('| 2-1 | 샤프(√252) | ≥ 1.0 | ≥ 0.7 **이고** ① 동일가중 벤치마크 샤프 초과 |');
    has('| 2-2 | MDD(보유 중 평가손 포함) | ≤ 12% | ≤ 12% **이고** ① 벤치마크 MDD 미만 |');
    has('| 2-3 | WFE = OOS 연수익 ÷ IS 연수익 | — | ≥ 0.5 (IS 연수익 ≤ 0 이면 자동 불합격) |');
    const { is, oos } = reg.criteria;
    expect([is.minEpisodes, is.minWeeks, is.minSymbols, oos.minEpisodes, oos.minWeeks, oos.minSymbols]).toEqual([150, 40, 15, 80, 20, 10]);
    expect([is.maxSymbolShare, oos.maxSymbolShare]).toEqual([0.15, 0.15]);
    expect(reg.criteria.tThresholds).toEqual({ nLe100: 2.5, nGt100: 3.0 });
    expect([is.minNetAfterDelta, oos.minNetAfterDelta]).toEqual([0.004, 0.003]);
    expect([is.minPf, is.minPayoff, oos.minPf, oos.minPayoff]).toEqual([1.4, 1.5, 1.3, 1.5]);
    expect([is.stressMinNet, oos.stressMinNet]).toEqual([0, 0]);
    expect([is.foldsMinPositive, is.foldMaxProfitShare]).toEqual([2, 0.6]);
    expect([is.minSharpe, oos.minSharpe, is.maxMdd, oos.maxMdd, oos.minWfe]).toEqual([1.0, 0.7, 0.12, 0.12, 0.5]);
    expect([oos.sharpeMustBeatBenchmark, oos.mddMustBeatBenchmark]).toEqual([true, true]);
    expect(tThreshold(reg.criteria)).toBe(2.5);
  });
  test('기준선·결정일·§B-12 기본값(부트스트랩 2,000·자본·슬롯·창 5·MA100·유동성 0.1%) — v1.1 부터 §B(해시 안)에서 찾는다', () => {
    has('미국 `SPY`');
    has('국내 `069500`');
    expect(reg.benchmarks).toEqual({ US: 'AMS:SPY', KR: '069500' });
    expect(reg.universe.excludeSymbols).toEqual(['AMS:SPY', '069500']);
    has('**결정일 2026-12-07**');
    expect(reg.decisionDate).toBe('2026-12-07');
    expect(B).toMatch(/\*\*주\(D0 의 월요일\) 군집 블록 부트스트랩\*\* 2,000회/);
    expect(reg.bootstrap.iters).toBe(2000);
    expect(B).toMatch(/US \*\*\$15,000\*\* \/ KR \*\*2,000만원\*\*.*\*\*슬롯 10·슬롯당 10%/);
    expect(reg.portfolio).toMatchObject({ capital: { US: 15000, KR: 20000000 }, slots: 10, slotPct: 0.1 });
    expect(B).toMatch(/\*\*5거래일\*\* 안의 재발화/);
    expect(reg.episodes.windowDays).toBe(5);
    expect(B).toMatch(/지수 < MA100 → 신규 진입 금지/);
    expect(reg.regime.ma).toBe(100);
    expect(B).toMatch(/ADTV20\(거래대금\) × 0\.1% 이면 미진입/);
    expect([reg.execution.adtvWindow, reg.execution.adtvMaxShare]).toEqual([20, 0.001]);
    // v1.0 §A-2 표는 문서에서 지워지고 포인터만 남았다 — 기본값이 §B 밖에 다시 생기면 해시 밖 값이 된다
    const beforeB = DOC.slice(0, DOC.search(/^## B\. 사전 등록 본문/m));
    expect(beforeB.length).toBeGreaterThan(1000);
    expect(beforeB).toMatch(/### A-2\. \(v1\.1\) 실행 기본값은 §B-12 로 이동했다/);
    expect(beforeB).not.toMatch(/ADTV20\(거래대금\)|군집 블록 부트스트랩\*\* 2,000회|\$15,000\*\*/);
  });
  test('validateRegistry 변이: 시행 수·라이브 값·분할 순서가 틀리면 잡힌다', () => {
    const clone = () => JSON.parse(JSON.stringify(reg)) as Registry;
    const a = clone(); a.strategies[0].grid.th = [30, 35]; expect(validateRegistry(a).join()).toMatch(/라이브 값|trials/);
    const b = clone(); b.splits.US.oosFrom = '2025-09-01'; expect(validateRegistry(b).join()).toMatch(/splits\.US/);
    const c = clone(); c.criteria.tierATrialsForT = 40; expect(validateRegistry(c)).toContain('criteria.tierATrialsForT');
    const d = clone(); d.document.section_b_sha256 = 'x'; expect(validateRegistry(d)).toContain('document.section_b_sha256');
  });
  test('expandGrid·executionParams', () => {
    expect(expandGrid({ b: [1, 2], a: [true] })).toEqual([{ a: true, b: 1 }, { a: true, b: 2 }]);
    expect(expandGrid({})).toEqual([{}]);
    expect(() => expandGrid({ a: [] })).toThrow();
    const s7 = strategyEntry(reg, 'control-spike-contraction')!;
    expect(executionParams(s7, { hold: 10 })).toEqual({ hold: 10, stop: 0.05, regime: false });
    const s1 = strategyEntry(reg, 'rsi-oversold-daily')!;
    expect(executionParams(s1, { th: 38, hold: 5, stop: 0.03, regime: true })).toEqual({ hold: 5, stop: 0.03, regime: true });
    expect(() => executionParams(s1, { th: 38 })).toThrow();
  });
});

describe('OOS 원장 — 추가 전용·전략당 1회', () => {
  const L0 = ledgerJson as unknown as Ledger;
  const lock = { strategyId: 'rsi-oversold-daily', market: 'US' as const, params: { th: 35 }, sectionBSha256: FROZEN, isReport: 'r', lockedAt: 't' };
  test('저장소의 원장은 비어 있고 유효하다(이번 단계 OOS 실행 0) — 머리 해시 = v1.1 §B 해시', () => {
    expect(L0.section_b_sha256).toBe(FROZEN);
    expect(validateLedger(L0, FROZEN)).toEqual([]);
    expect(validateLedger(L0, V10_HASH)).toContain('section_b_sha256');
    expect(L0.entries).toEqual([]);
  });
  test('잠금 → 두 번째 잠금 거부 → 결과 1회만', () => {
    const L1 = appendLock(L0, lock);
    expect(hasOosRun(L1, 'rsi-oversold-daily', 'US')).toBe(true);
    expect(hasOosRun(L1, 'rsi-oversold-daily', 'KR')).toBe(false);
    expect(() => appendLock(L1, lock)).toThrow(/1회/);
    const L2 = recordResult(L1, 'rsi-oversold-daily', 'US', { verdict: 'REJECTED' });
    expect(() => recordResult(L2, 'rsi-oversold-daily', 'US', { verdict: 'PASS' })).toThrow();
    expect(verifyAppendOnly(L0, L1)).toBe(true);
    expect(verifyAppendOnly(L1, L2)).toBe(true);
    expect(L0.entries).toEqual([]); // 원본 불변
  });
  test('verifyAppendOnly 변이: 줄 삭제·파라미터 수정·결과 덮어쓰기·해시 변경은 거부', () => {
    const L1 = appendLock(L0, lock);
    const L2 = recordResult(L1, 'rsi-oversold-daily', 'US', { verdict: 'REJECTED' });
    expect(verifyAppendOnly(L1, { ...L1, entries: [] })).toBe(false);
    expect(verifyAppendOnly(L1, { ...L1, entries: [{ ...L1.entries[0], params: { th: 38 } }] })).toBe(false);
    expect(verifyAppendOnly(L2, { ...L2, entries: [{ ...L2.entries[0], result: { verdict: 'PASS' } }] })).toBe(false);
    expect(verifyAppendOnly(L1, { ...L1, section_b_sha256: 'f'.repeat(64) })).toBe(false);
  });
  test('해시가 다른 잠금·원장은 거부', () => {
    expect(() => appendLock(L0, { ...lock, sectionBSha256: 'f'.repeat(64) })).toThrow();
    expect(validateLedger(L0, 'f'.repeat(64))).toContain('section_b_sha256');
  });
});

describe('판정 진리표(§B-6) — 조건 하나씩 실패', () => {
  const pass: StrategyMetrics = {
    n: 200, weeks: 50, symbols: 20, maxSymbolShare: 0.1, excessLo: 0.001, excessT: 3, netMean: 0.006, deltaTrade: 0.001,
    pf: 1.6, payoff: 1.7, stressNetMean: 0.004, foldsPositive: 3, foldMaxProfitShare: 0.4, sharpe: 1.2, benchSharpe: 0.8, mdd: 0.1, benchMdd: 0.2, annualReturn: 0.2,
  };
  const oos: StrategyMetrics = { ...pass, n: 100, weeks: 25, symbols: 12, sharpe: 0.9, annualReturn: 0.12, foldsPositive: null, foldMaxProfitShare: null };
  const A = { tier: 'A' as const, market: 'US' as const, judgedMarket: 'US' as const };
  const J = (i: StrategyMetrics, o: StrategyMetrics | null, opt: JudgeOptions = A) => judge(i, o, reg.criteria, opt);

  test('전부 통과 → PASS', () => {
    const r = J(pass, oos);
    expect(r.verdict).toBe('PASS');
    expect(r.reasons).toEqual([]);
    expect(r.promotionBlocked).toBe(false);
  });
  test('IS 통과·OOS 미실행 → UNTESTED_OOS(isPassed=true)', () => {
    const r = J(pass, null);
    expect(r.verdict).toBe('UNTESTED_OOS');
    expect(r.isPassed).toBe(true);
  });
  test.each<[string, Partial<StrategyMetrics>]>([
    ['n', { n: 149 }], ['weeks', { weeks: 39 }], ['symbols', { symbols: 14 }],
  ])('IS 표본 미달 %s → INSUFFICIENT', (_k, ch) => {
    expect(J({ ...pass, ...ch }, oos).verdict).toBe('INSUFFICIENT');
  });
  test.each<[string, Partial<StrategyMetrics>]>([
    ['1-2', { maxSymbolShare: 0.151 }], ['1-2 null', { maxSymbolShare: null }],
    ['1-3 lo', { excessLo: 0 }], ['1-3 t', { excessT: 2.49 }],
    ['1-4', { netMean: 0.0049 }], ['1-4 δ', { deltaTrade: 0.0021 }],
    ['1-5 pf', { pf: 1.39 }], ['1-5 payoff', { payoff: 1.49 }], ['1-6', { stressNetMean: -0.0001 }],
    ['1-7 folds', { foldsPositive: 1 }], ['1-7 share', { foldMaxProfitShare: 0.61 }], ['1-7 null', { foldMaxProfitShare: null }],
    ['2-1', { sharpe: 0.99 }], ['2-2', { mdd: 0.121 }],
  ])('IS %s 실패 → UNTESTED_OOS(OOS 미실행)', (_k, ch) => {
    const r = J({ ...pass, ...ch }, oos);
    expect(r.verdict).toBe('UNTESTED_OOS');
    expect(r.isPassed).toBe(false);
  });
  test.each<[string, Partial<StrategyMetrics>, string]>([
    ['표본 n', { n: 79 }, 'INSUFFICIENT'], ['표본 주', { weeks: 19 }, 'INSUFFICIENT'], ['표본 종목', { symbols: 9 }, 'INSUFFICIENT'],
    ['1-3', { excessLo: -0.0001 }, 'REJECTED'], ['1-4', { netMean: 0.0039 }, 'REJECTED'], ['1-5', { pf: 1.29 }, 'REJECTED'],
    ['1-6', { stressNetMean: -0.001 }, 'REJECTED'], ['2-1 샤프', { sharpe: 0.69 }, 'REJECTED'], ['2-1 벤치', { benchSharpe: 0.95 }, 'REJECTED'],
    ['2-2 MDD', { mdd: 0.13 }, 'REJECTED'], ['2-2 벤치', { benchMdd: 0.09 }, 'REJECTED'], ['2-3 WFE', { annualReturn: 0.099 }, 'REJECTED'],
  ])('OOS %s → %s', (_k, ch, v) => {
    expect(J(pass, { ...oos, ...ch }).verdict).toBe(v);
  });
  test('OOS 에는 t 임계·폴드 조건이 없다(§B-6 OOS 칸)', () => {
    expect(J(pass, { ...oos, excessT: 0.5, foldsPositive: 0 }).verdict).toBe('PASS');
  });
  test('IS 연수익 ≤ 0 이면 WFE 자동 불합격', () => {
    expect(J({ ...pass, annualReturn: 0 }, oos).verdict).toBe('REJECTED');
  });
  test('t 임계: N ≤ 100 → 2.5, N > 100 → 3.0 (변이)', () => {
    const c = { ...reg.criteria, tierATrialsForT: 101 };
    expect(judge({ ...pass, excessT: 2.9 }, oos, c, A).verdict).toBe('UNTESTED_OOS');
    expect(judge({ ...pass, excessT: 2.9 }, oos, reg.criteria, A).verdict).toBe('PASS');
  });
  test('Tier B·대조군·국내는 EXPLORATORY(shape 는 그대로 계산)', () => {
    expect(J(pass, oos, { ...A, tier: 'B' })).toMatchObject({ verdict: 'EXPLORATORY', shape: 'PASS' });
    expect(J(pass, oos, { ...A, tier: 'control' }).verdict).toBe('EXPLORATORY');
    expect(J(pass, oos, { ...A, market: 'KR' }).verdict).toBe('EXPLORATORY');
  });
  test('δ 미측정 → δ=0 으로 계산하되 승급 보류 표시', () => {
    const r = J({ ...pass, deltaTrade: null }, { ...oos, deltaTrade: null });
    expect(r.verdict).toBe('PASS');
    expect(r.promotionBlocked).toBe(true);
  });
  test('PF·손익비 ∞(손실 없음)는 통과로 본다', () => {
    expect(J({ ...pass, pf: Infinity, payoff: Infinity }, oos).verdict).toBe('PASS');
  });
});

describe('고원 선택(§B-7, v1.1 패치 6 — ⑦·⑨·(a))', () => {
  const grid = { th: [30, 35, 38], hold: [5, 10], stop: [0.03, 0.05], regime: [false, true] };
  const good: StrategyMetrics = { n: 200, weeks: 50, symbols: 20, maxSymbolShare: 0.1, excessLo: 0.001, excessT: 3, netMean: 0.006, deltaTrade: 0,
    pf: 1.6, payoff: 1.7, stressNetMean: 0.004, foldsPositive: 3, foldMaxProfitShare: 0.4, sharpe: 0, mdd: 1, annualReturn: 0 };
  const bad: StrategyMetrics = { ...good, excessLo: -0.01 };
  const thin: StrategyMetrics = { ...good, n: 100 }; // 성과 조건은 통과, 1-1 표본 미달
  const OPT = plateauOptionsOf(reg.interpretation);
  const results = (m: (p: Record<string, number | boolean>) => StrategyMetrics) => expandGrid(grid).map((p) => ({ params: p, isM: m(p) }));
  const inSet = (keys: string[]) => (p: Record<string, number | boolean>) => (p.regime === false && keys.includes(`${p.th}|${p.hold}|${p.stop}`) ? good : bad);
  const k3 = (p: Record<string, number | boolean>) => `${p.th}|${p.hold}|${p.stop}`;

  test('registry interpretation → 옵션(권고값: 표본 필수·L1 최근접·regime 동률 off·짝수 낮은 쪽)', () => {
    expect(OPT).toEqual({ membershipRequiresSample: true, medianFallback: 'nearest_l1', regimeTie: 'off', evenMedian: 'low', tieOrder: ['th', 'lo', 'L', 'k', 'r', 'b', 'stop', 'hold', 'regime'] });
  });
  test('P_perf 는 1-3~1-7 만 본다(샤프 0·MDD 100% 여도 P_perf)', () => {
    expect(plateau(results(() => good), reg.criteria, grid, OPT).perfOnly).toHaveLength(24);
  });
  test('regime=false 12개 → 구성원 12, 중앙값 = th35·hold5·stop3%·regime off', () => {
    const r = plateau(results((p) => (p.regime === false ? good : bad)), reg.criteria, grid, OPT);
    expect(r.members).toHaveLength(12);
    expect(r.chosen).toEqual({ hold: 5, regime: false, stop: 0.03, th: 35 });
    expect(r.reason).toBeNull();
  });
  test('⑨ V2: 표본 미달 조합은 이웃 증거로는 인정, 구성원에서는 제외(설정을 끄면 v1.0 처럼 포함)', () => {
    const m = (p: Record<string, number | boolean>) => (p.regime !== false ? bad : p.th === 30 ? thin : good);
    const r = plateau(results(m), reg.criteria, grid, OPT);
    expect(r.perfOnly).toHaveLength(12);
    expect(r.members.every((p) => p.th !== 30)).toBe(true);
    expect(r.members).toHaveLength(8); // th35(이웃 30 은 P_perf 라 인정)·th38
    expect(plateau(results(m), reg.criteria, grid, { ...OPT, membershipRequiresSample: false }).members).toHaveLength(12);
  });
  test('M60: 이웃은 "모두" P_perf 여야 한다 — th35 의 이웃 38 이 P_perf 밖이면 th35 는 구성원 아님', () => {
    const r = plateau(results((p) => (p.regime === false && p.th !== 38 ? good : bad)), reg.criteria, grid, OPT);
    expect(r.members.length).toBe(4);
    expect(r.members.every((p) => p.th === 30)).toBe(true);
  });
  test('(a) 가장자리: 3값 축의 끝(th=30·38)인 구성원만 edgeMembers', () => {
    const r = plateau(results((p) => (p.regime === false ? good : bad)), reg.criteria, grid, OPT);
    expect(r.edgeMembers.map((p) => p.th).sort()).toEqual([30, 30, 30, 30, 38, 38, 38, 38]);
  });
  test('th 38 만 P_perf → 이웃(35)이 밖 → 구성원 없음(REJECTED(IS)), 전부 실패면 empty_P', () => {
    const r = plateau(results((p) => (p.th === 38 ? good : bad)), reg.criteria, grid, OPT);
    expect(r.members).toEqual([]);
    expect(r.chosen).toBeNull();
    expect(r.reason).toBe('no_plateau');
    expect(plateau(results(() => bad), reg.criteria, grid, OPT).reason).toBe('empty_P');
  });
  test('⑦ 중앙값 조합이 구성원 밖 → L1 거리 최근접 구성원(성과 무관)', () => {
    const P = ['30|10|0.03', '35|10|0.03', '30|5|0.03', '30|10|0.05', '38|5|0.05', '35|5|0.05', '38|10|0.05', '38|5|0.03'];
    const r = plateau(results(inSet(P)), reg.criteria, grid, OPT);
    expect(r.members.map(k3).sort()).toEqual(['30|10|0.03', '38|5|0.05']);
    // 중앙값 (30,5,3%) 는 구성원이 아님 → 거리 1 인 (30,10,3%) 선택(다른 구성원은 거리 3)
    expect(r.chosen).toEqual({ hold: 10, regime: false, stop: 0.03, th: 30 });
    expect(r.reason).toBe('median_fallback_nearest');
    expect(plateau(results(inSet(P)), reg.criteria, grid, { ...OPT, medianFallback: 'none' }).reason).toBe('median_not_in_plateau');
  });
  test('⑦ 거리 동률이면 th 낮은 쪽 먼저(tieOrder), 입력 순서와 무관', () => {
    const P = ['30|10|0.05', '35|5|0.05', '35|10|0.05', '30|5|0.05', '30|10|0.03', '38|5|0.05', '35|5|0.03'];
    const a = plateau(results(inSet(P)), reg.criteria, grid, OPT);
    expect(a.members.map(k3).sort()).toEqual(['30|10|0.05', '35|5|0.05']);
    expect(a.chosen).toEqual({ hold: 10, regime: false, stop: 0.05, th: 30 });
    const b = plateau(results(inSet(P)).reverse(), reg.criteria, grid, OPT);
    expect(b.chosen).toEqual(a.chosen);
    // tieOrder 를 hold 먼저로 바꾸면 hold 짧은 (35,5) 가 뽑힌다(규칙이 실제로 쓰인다)
    expect(plateau(results(inSet(P)), reg.criteria, grid, { ...OPT, tieOrder: ['hold', 'th'] }).chosen).toEqual({ hold: 5, regime: false, stop: 0.05, th: 35 });
  });
  test('N18 ⑦ L1 거리가 동률 순서보다 먼저다 — 최근접 구성원이 동률 순서상 첫 구성원과 다른 격자', () => {
    // 격자 x·y ∈ 0..6(tieOrder 에 없는 축 이름 — 동률 순서는 x→y). P_perf = 블록 A(x 0~2, y 4~6) ∪ 블록 B(x 4~6, y 0~2) → 구성원 A{(0,5),(0,6),(1,5),(1,6)}·B{(5,0),(5,1),(6,0),(6,1)}
    // 중앙값(짝수 낮은 쪽) = (1,1) → 구성원 아님. L1: (1,5)·(5,1) 이 4 로 최소(동률 → x 낮은 (1,5)). 거리를 무시하면 동률 순서 첫 (0,5).
    const g2 = { x: [0, 1, 2, 3, 4, 5, 6], y: [0, 1, 2, 3, 4, 5, 6] };
    const inP = (p: Record<string, number | boolean>) => ((p.x as number) <= 2 && (p.y as number) >= 4) || ((p.x as number) >= 4 && (p.y as number) <= 2);
    const res = expandGrid(g2).map((p) => ({ params: p, isM: inP(p) ? good : bad }));
    const r = plateau(res, reg.criteria, g2, OPT);
    expect(r.members.map((p) => `${p.x},${p.y}`).sort()).toEqual(['0,5', '0,6', '1,5', '1,6', '5,0', '5,1', '6,0', '6,1']);
    expect(r.reason).toBe('median_fallback_nearest');
    expect(r.chosen).toEqual({ x: 1, y: 5 });
    // 입력 순서와 무관
    expect(plateau([...res].reverse(), reg.criteria, g2, OPT).chosen).toEqual({ x: 1, y: 5 });
    // tieOrder 를 y 먼저로 바꾸면 같은 거리 4 의 (5,1) 이 뽑힌다 — y 가 더 낮은 (5,0)(거리 5)은 뽑히지 않는다(거리가 우선)
    expect(plateau(res, reg.criteria, g2, { ...OPT, tieOrder: ['y', 'x'] }).chosen).toEqual({ x: 5, y: 1 });
  });
  test('⑦ regime 은 구성원 다수결, 동률은 off(설정 on 이면 on)', () => {
    const all = results(() => good);
    expect(plateau(all, reg.criteria, grid, OPT).chosen!.regime).toBe(false);
    expect(plateau(all, reg.criteria, grid, { ...OPT, regimeTie: 'on' }).chosen!.regime).toBe(true);
    const onMajor = results((p) => (p.regime === true || (p.th === 30 && p.hold === 5 && p.stop === 0.03) ? good : bad));
    expect(plateau(onMajor, reg.criteria, grid, OPT).chosen!.regime).toBe(true);
  });
  test('짝수 중앙값 high 설정이면 높은 쪽', () => {
    expect(plateau(results((p) => (p.regime === false ? good : bad)), reg.criteria, grid, { ...OPT, evenMedian: 'high' }).chosen).toEqual({ hold: 10, regime: false, stop: 0.05, th: 35 });
  });
});

describe('registry 수치 잠금 H_r(v1.1 H-1)', () => {
  test('정규화 규칙: 키 정렬·공백 없음·1.0=1·−0=0·NFC·키 문자 제한·비유한 거부', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'x'] })).toBe('{"a":[true,null,"x"],"b":1}');
    expect(canonicalJson(JSON.parse('{"x":1.0}'))).toBe(canonicalJson({ x: 1 }));
    expect(canonicalJson(-0)).toBe('0');
    expect(canonicalJson(0.1 + 0.2)).toBe('0.30000000000000004');
    expect(() => canonicalJson({ x: NaN })).toThrow();
    expect(() => canonicalJson({ x: Infinity })).toThrow();
    expect(() => canonicalJson({ 'a-b': 1 })).toThrow();
    expect(() => canonicalJson({ x: 'é' })).toThrow(); // NFD
    expect(() => canonicalJson({ x: undefined })).toThrow();
  });
  test('H_r 은 docHash 만 빼고 registry 전체를 덮는다 — docHash 를 바꿔도 같고, 수치·해석·고정값을 바꾸면 달라진다', () => {
    const h = registryNumericSha256(reg);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    const clone = () => JSON.parse(JSON.stringify(reg));
    const d = clone(); d.document.section_b_sha256 = 'f'.repeat(64);
    expect(registryNumericSha256(d)).toBe(h);
    expect(registryFullSha256(d)).not.toBe(registryFullSha256(reg));
    const muts: Array<(r: any) => void> = [ // eslint-disable-line @typescript-eslint/no-explicit-any
      (r) => { r.criteria.is.minPf = 1.0; }, (r) => { r.criteria.is.minNetAfterDelta = -1; }, (r) => { r.criteria.tThresholds.nLe100 = 0.1; },
      (r) => { r.episodes.windowDays = 1; }, (r) => { r.execution.gapUp = 0.5; }, (r) => { r.bootstrap.seed = 1; }, (r) => { r.bootstrap.iters = 200; },
      (r) => { r.portfolio.capital.US = 1; }, (r) => { r.regime.ma = 50; }, (r) => { r.execution.adtvMaxShare = 1; },
      (r) => { r.interpretation.symbolShareDenominator = 'positive_sum'; }, (r) => { r.strategies[0].fixed.maMult = 1.05; },
      (r) => { r.splits.US.isTo = '2025-08-29'; }, (r) => { r.universe.expectedSymbols.US = 49; }, (r) => { r.document.version = 'v9'; },
      (r) => { r.costs.US.slippage = 0; }, (r) => { r.data.tradingDaysPerYear = 365; },
      // N23: document 블록의 정보 필드도 H_r 이 덮는다(docHash 만 제외)
      (r) => { r.document.frozen_at = '2099-01-01 00:00 KST'; }, (r) => { r.document.approved_by = 'x'; }, (r) => { r.document.approval_quote = 'x'; },
      (r) => { r.document.hash_rule = 'x'; }, (r) => { r.document.path = 'docs/x.md'; }, (r) => { r.interpretation.version = 'v9'; },
      (r) => { r.bootstrap.auxSeeds = [1, 3]; }, (r) => { r.strategies[0].fixed.rsiPeriod = 7; },
    ];
    for (const m of muts) { const r = clone(); m(r); expect(registryNumericSha256(r)).not.toBe(h); }
    expect(registryNumericSha256(JSON.parse(JSON.stringify(reg, null, 7)))).toBe(h); // 들여쓰기·키 순서 무관
  });
  test('양성(v1.1 동결): 지금 registry 의 H_r = 38c102566c1c… = 문서 §B-11 마커, verifyRegistryNumeric(DOC, reg) ok', () => {
    expect(registryNumericSha256(reg)).toBe(H_R);
    expect(extractRegistryMarker(DOC)).toBe(H_R);
    expect(verifyRegistryNumeric(DOC, reg)).toEqual({ ok: true, marker: H_R, actual: H_R });
    // 마커 줄은 §B-11 안(§B-12 제목 앞)에 정확히 한 줄
    const b11 = B.slice(B.indexOf('### B-11.'), B.indexOf('### B-12.'));
    expect(b11.split('\n').filter((l) => l === MARKER_LINE)).toHaveLength(1);
    expect(DOC.split('\n').filter((l) => /^registry-numeric-sha256: /.test(l))).toHaveLength(1);
  });
  test('§B 마커 음성: 지운 사본 → marker_missing · 값 변조 → mismatch · 두 줄 → 오류 · §B 밖만 → 없음 · registry 수치 변경 → mismatch', () => {
    expect(DOC_NO_MARKER).not.toBe(DOC);
    expect(extractRegistryMarker(DOC_NO_MARKER)).toBeNull();
    expect(verifyRegistryNumeric(DOC_NO_MARKER, reg)).toMatchObject({ ok: false, reason: 'marker_missing' });
    const forged = DOC.replace(MARKER_LINE, `registry-numeric-sha256: ${'f'.repeat(64)}`);
    expect(verifyRegistryNumeric(forged, reg)).toMatchObject({ ok: false, reason: 'registry_numeric_mismatch', actual: H_R });
    const r2 = JSON.parse(JSON.stringify(reg)); r2.criteria.is.minPf = 1.0;
    expect(verifyRegistryNumeric(DOC, r2)).toMatchObject({ ok: false, reason: 'registry_numeric_mismatch', marker: H_R });
    const twice = DOC.replace(/^### B-10\. /m, `${MARKER_LINE}\n\n### B-10. `);
    expect(() => extractRegistryMarker(twice)).toThrow();
    expect(verifyRegistryNumeric(twice, reg).ok).toBe(false);
    // §B 밖(§C)에 둔 마커는 인정하지 않는다
    const outside = DOC_NO_MARKER.replace(/^### C-6\. /m, `${MARKER_LINE}\n\n### C-6. `);
    expect(extractRegistryMarker(outside)).toBeNull();
    // 마커는 §B 안이라 마커를 빼거나 바꾸면 docHash 가 바뀐다(순환 해소: H_r → §B → docHash, docHash 는 H_r 에서 제외)
    expect(sectionBSha256(DOC_NO_MARKER)).not.toBe(FROZEN);
    expect(sectionBSha256(forged)).not.toBe(FROZEN);
  });
  test('V1~V3 확정(v1.1): interpretation 값 = 문서 §B-6·§B-7·§D-4 확정 문구, 사용자 확인 대기 없음', () => {
    const it = reg.interpretation;
    expect(it.pendingUserConfirmation).toEqual([]);
    // V1 ④ — 단일 종목 손익 비중 분모 = 전체 순수익 합(§B-6 1-2 행)
    expect(it.symbolShareDenominator).toBe('total_net');
    expect(B).toMatch(/\(v1\.1 확정 ④ — 1-2 행\)\*\* 분자 = 순수익 양\(\+\)인 종목 중 최대 순수익 합, 분모 = 모든 청산 에피소드 순수익 합\. 분모 ≤ 0 이면 판정 불가 = 실패/);
    // V2 ⑨ — 고원 구성원 = P_perf ∩ 1-1 충족 ∧ 이웃 ⊂ P_perf(§B-7)
    expect(it.plateauMembershipRequiresSample).toBe(true);
    expect(B).toMatch(/\*\*고원 구성원\*\* = P_perf 에 속하고 \*\*1-1\(U5\) 을 충족\*\*하며 격자 안 이웃\(각 파라미터 ±1 스텝, 레짐 플래그는 같은 값\)이 모두 P_perf 에 속하는 조합/);
    // ⑦ — 중앙값 대체·동률·짝수·regime(§B-7)
    expect([it.plateauMedianFallback, it.plateauRegimeTie, it.plateauEvenMedian]).toEqual(['nearest_l1', 'off', 'low']);
    expect(B).toMatch(/중앙값 조합이 구성원이 아니면 \*\*격자 스텝 L1 거리가 가장 가까운 구성원\*\*, 동률이면 th 낮은 → stop 좁은 → hold 짧은 → regime off 순/);
    expect(B).toMatch(/짝수면 th 낮은·stop 좁은·hold 짧은 쪽; regime 은 구성원 다수결, 동률 off/);
    const ord = ['th', 'stop', 'hold', 'regime'].map((k) => it.plateauTieOrder.indexOf(k));
    expect(ord.every((x) => x >= 0)).toBe(true);
    expect([...ord].sort((a, b) => a - b)).toEqual(ord);
    // V3 (b) — G1 규칙. 문구는 §D-4(§B 밖 — 해시 비대상, 아래 주의) 에 있다
    expect(it.g1Rule).toBe('any_combo_meets_u5_after_filters');
    expect(DOC).toMatch(/G1 통과\(전략 단위\) = 갭·유동성 필터 \*후\* `counts` 에서 U5 충족 조합 ≥ 1/);
    expect(DOC).toMatch(/G1 기록\(`registry\/g1-record\.json`\)에 충족·미달 조합 목록과 엔진 지문\(`engine_fingerprint`\)을 남긴다/);
    // 확정 기록(v1.1)의 Leader 해석이 같은 세 값을 적는다
    expect(DOC).toMatch(/symbolShareDenominator: "total_net"/);
    expect(DOC).toMatch(/`plateauMembershipRequiresSample: true`/);
  });
  test('§B-12 실행 기본값 표 ↔ registry: "출처" 열의 registry 키가 모두 실재하고, 표의 숫자가 그 키의 값과 같다', () => {
    const sec = B.slice(B.indexOf('### B-12.'));
    const table = sec.slice(0, sec.indexOf('**코드 상수 목록'));
    const rows = table.split('\n').filter((l) => /^\| /.test(l) && !/^\| 항목 \|/.test(l));
    expect(rows).toHaveLength(16); // 에피소드·지평·손절·갭·유동성·품질·기준선·레짐·불확실성·자본·벤치 비용·연율화·지정가·통화·민감도·리포트
    // 출처 칸의 백틱 토큰 → registry 키(짧은 토큰은 같은 칸 앞 키의 접두를 이어받는다: `execution.gapUp`·`gapDown` → execution.gapDown)
    const keys: string[] = [];
    for (const row of rows) {
      const src = row.split('|').filter((c) => c.trim() !== '').pop()!;
      if (!/registry/.test(src)) continue;
      let prefix = '';
      for (const m of src.matchAll(/`([A-Za-z][A-Za-z0-9.]*)`/g)) {
        const t = m[1];
        if (t.includes('.')) { prefix = t.slice(0, t.lastIndexOf('.')); keys.push(t); } else keys.push(`${prefix}.${t}`);
      }
    }
    expect(keys).toEqual([
      'episodes.windowDays', 'episodes.cooldownAppliesToPortfolio', 'execution.judgeModel', 'costs.US.stopSlippage', 'costs.KR.stopSlippage',
      'execution.gapUp', 'execution.gapDown', 'execution.gapBoundary', 'execution.adtvWindow', 'execution.adtvMaxShare', 'data.barGapDays',
      'data.universeBaselineMinN', 'regime.ma', 'bootstrap.iters', 'bootstrap.seed', 'bootstrap.auxSeeds', 'bootstrap.cluster', 'bootstrap.prng',
      'bootstrap.interval', 'portfolio.capital', 'portfolio.slots', 'portfolio.slotPct', 'portfolio.integerShares', 'data.tradingDaysPerYear',
      'execution.limitChasePct', 'markets.judgeCurrency', 'costs.sensitivity.passMultiplier', 'costs.sensitivity.reportMultipliers',
    ]);
    const get = (k: string) => k.split('.').reduce<unknown>((o, p) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[p] : undefined), reg);
    for (const k of keys) expect([k, get(k)]).toEqual([k, expect.anything()]);
    // 각 키의 값이 그 키가 적힌 행의 문구와 같다(문구를 registry 값에서 만들어 대조 — 값이 바뀌면 실패)
    const rowOf = (k: string) => rows.find((r) => r.includes(`\`${k}\``) || r.includes(`\`${k.split('.').pop()}\``))!;
    const { episodes: ep, execution: ex, data: dt, regime: rg, bootstrap: bs, portfolio: pf, costs: cs, markets: mk } = reg;
    const expectRow = (k: string, ...parts: string[]) => { for (const p of parts) expect([k, rowOf(k).includes(p)]).toEqual([k, true]); };
    expectRow('episodes.windowDays', `D0 뒤 **${ep.windowDays}거래일**`, `max(${ep.windowDays}, hold)`);
    expect(ep.cooldownAppliesToPortfolio).toBe(true);
    expectRow('episodes.windowDays', '1차(에피소드)·2차(포트폴리오 시뮬)·라이브 배선 모두 같은 규칙');
    expectRow('execution.judgeModel', `P1 \`${ex.judgeModel}\``, '진입 = D+1 시가, 청산 = D+h 종가');
    expectRow('costs.US.stopSlippage', '진입 당일 포함, 같은 날 선후 불명은 손절 먼저');
    expect([cs.US.feeRoundTrip + cs.US.stopSlippage, cs.KR.feeRoundTrip + cs.KR.stopSlippage].map((x) => Math.round(x * 1e6) / 1e6)).toEqual([0.0075, 0.0043]);
    expectRow('execution.gapUp', `≥ ${1 + ex.gapUp}`, `≤ ${1 - ex.gapDown}`, '경계 포함, 허용오차 1e-12');
    expect(ex.gapBoundary).toBe('skip'); // "경계 포함" = 경계에서 미진입
    expectRow('execution.adtvWindow', `ADTV${ex.adtvWindow}(거래대금) × ${ex.adtvMaxShare * 100}% 이면 미진입`);
    expectRow('data.barGapDays', `간격 > **${dt.barGapDays}일**`);
    expectRow('data.universeBaselineMinN', `종목 ≥ **${dt.universeBaselineMinN}**`);
    expectRow('regime.ma', `지수 < MA${rg.ma} → 신규 진입 금지`);
    expectRow('bootstrap.iters', `${bs.iters.toLocaleString('en-US')}회`, `시드 **${bs.seed}**`, `보조 시드 {${bs.auxSeeds.join(', ')}}`, `PRNG ${bs.prng}`, '백분위 95% 구간', '주(D0 의 월요일) 군집');
    expect([bs.cluster, bs.interval]).toEqual(['week_monday_of_d0', 'percentile95']);
    expectRow('portfolio.capital', `US **$${pf.capital.US.toLocaleString('en-US')}**`, `KR **${(pf.capital.KR / 10000).toLocaleString('en-US')}만원**`,
      `슬롯 ${pf.slots}·슬롯당 ${pf.slotPct * 100}%·정수 주식`);
    expect(pf.integerShares).toBe(true);
    expectRow('data.tradingDaysPerYear', `거래일 **${dt.tradingDaysPerYear}**`, `샤프 √${dt.tradingDaysPerYear}`);
    expectRow('execution.limitChasePct', `\`close_D × ${1 + ex.limitChasePct}\``);
    expectRow('markets.judgeCurrency', `**${mk.judgeCurrency}** 로 판정`);
    expectRow('costs.sensitivity.passMultiplier', `×**${cs.sensitivity.passMultiplier}** 합격 조건`, ...cs.sensitivity.reportMultipliers.map((m) => `×**${m.toFixed(1)}** 보고`));
  });
  test('§B-12 "코드 상수"(registry 밖 — 엔진 지문이 보호) = 코드 값: EPS 1e-12·플래그 이름·틱·S7 창 경계', () => {
    const sec = B.slice(B.indexOf('### B-12.'));
    const consts = sec.slice(sec.indexOf('**코드 상수 목록'));
    // EPS 1e-12: 비율이 경계보다 1e-12 안쪽이면 경계로 본다(미진입), 그 밖이면 진입
    expect(consts).toMatch(/갭 경계 허용오차 EPS 1e-12/);
    expect(gapSkip(1, 1.02 - 5e-13, 0.02, 0.03, 'skip')).toBe(true);
    expect(gapSkip(1, 1.02 - 3e-12, 0.02, 0.03, 'skip')).toBe(false);
    expect(gapSkip(1, 0.97 + 5e-13, 0.02, 0.03, 'skip')).toBe(true);
    expect(gapSkip(1, 0.97 + 3e-12, 0.02, 0.03, 'skip')).toBe(false);
    // 플래그 이름
    expect(consts).toMatch(/데이터 품질 플래그 이름\(`adj_stale`·`adj_orphan` 제외, `zero_volume` 불가일\)/);
    expect([FLAG_ADJ_STALE, FLAG_ADJ_ORPHAN, FLAG_ZERO_VOLUME]).toEqual(['adj_stale', 'adj_orphan', 'zero_volume']);
    expect(B).toMatch(/`corp_action_suspect` 걸린 에피소드는 \*\*포함하되 별도 표\*\*/);
    expect(FLAG_CORP).toBe('corp_action_suspect');
    // 틱: US $0.01
    expect(consts).toMatch(/지정가 틱 표\(US \$0\.01·KR 호가 단위표\)/);
    expect([tickSize('US', 5), tickSize('US', 500)]).toEqual([0.01, 0.01]);
    // S7 창 경계 i−25..i−6 · 5봉(코드 원문에서 읽는다 — 상수로 export 되지 않음)
    expect(consts).toMatch(/S7 대조군의 구조 상수\(창 경계 `i−25\.\.i−6`·5봉/);
    const s7 = fs.readFileSync(path.join(ROOT, 'src/lib/profit-engine/backtest/signals/control-spike-contraction.ts'), 'utf8');
    expect(s7).toContain('for (let k = i - 25; k <= i - 6; k++)');
    expect(s7).toContain('for (let k = i - 5; k <= i - 1; k++)');
    expect(s7).toContain('const now = a[i - 1], then = a[i - 6];');
    expect(s7).toMatch(/export const MIN_BARS = 27;/);
  });
  test('엔진 상수·지원 모델 대조(checkEngineConstants)', () => {
    const K = { BAR_GAP_DAYS: 9, UNIVERSE_MIN_N: 10, signalMinBars: { 'rsi-oversold-daily': 22, 'control-spike-contraction': 27 } };
    expect(checkEngineConstants(reg, K)).toEqual([]);
    const c = () => JSON.parse(JSON.stringify(reg)) as Registry;
    const a = c(); a.data.barGapDays = 5; expect(checkEngineConstants(a, K).join()).toMatch(/barGapDays/);
    const b = c(); b.execution.judgeModel = 'limit'; expect(checkEngineConstants(b, K).join()).toMatch(/judgeModel/);
    const d = c(); d.universe.pit = true; expect(checkEngineConstants(d, K).join()).toMatch(/pit/);
    const e = c(); e.strategies[0].minBars = 21; expect(checkEngineConstants(e, K).join()).toMatch(/minBars/);
    const f = c(); f.bootstrap.prng = 'xorshift'; expect(checkEngineConstants(f, K).join()).toMatch(/prng/);
    expect(checkEngineConstants(reg, { ...K, signalMinBars: { ...K.signalMinBars, 'xs-momentum': 30 } }).join()).toMatch(/xs-momentum/);
  });
  test('신호 파라미터 = fixed(숫자·불리언) + 격자 신호 파라미터, 겹치면 오류', () => {
    const s1 = strategyEntry(reg, 'rsi-oversold-daily')!;
    expect(signalParamsOf(s1, { th: 38, hold: 5, stop: 0.03, regime: false }, ['th'])).toEqual({ maMult: 1.005, rsiPeriod: 14, maPeriod: 20, th: 38 });
    expect(() => signalParamsOf({ ...s1, fixed: { th: 1 } }, { th: 38 }, ['th'])).toThrow();
  });
});
