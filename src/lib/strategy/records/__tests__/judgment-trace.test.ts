/**
 * T-112 B — 기준 판단 추적(judgment-trace) 단위 시험 + 엔진 소스 정적 대조.
 *
 *  - 추적은 순수 메모리·예외 삼킴(엔진 흐름에 영향 0) — 적대적 입력에서도 던지지 않는다.
 *  - 결정 우선순위(첫 결정 / 카드를 만든 뒤 결정), 보낸 후보의 NONE·llm_error 닫기, 일봉 상태, 국내 D0, 프롬프트 해시, RAG 문맥 id.
 *  - 🔴 정적 대조: 엔진 소스의 추적 표시가 §3.4 시장별 어휘와 1:1(국내 8 · 해외 12), 추적 호출 목록 고정(표시 1곳 삭제를 잡는다),
 *    기록 진입점은 finally 안 1곳·기다리지 않음, judgment_* 를 읽는 곳은 기록 모듈뿐(시그널·주문·안전장치 경로 격리).
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  EXCLUSION_CODES,
  EXCLUSION_CODES_BY_MARKET,
  JudgmentTrace,
  aiDecisionOf,
  confidenceOf,
  dailyBarDate,
  domesticLlmResponseReadable,
  type ExclusionCode,
} from '../judgment-trace';
import { CLAUDE_CLI_DEFAULT_MODEL } from '../judgment-recorder';

jest.mock('@/lib/db', () => ({ getPool: jest.fn(() => { throw new Error('추적 시험은 DB 를 쓰지 않는다'); }) }));
jest.mock('@/lib/llm/provider', () => ({ getProviderConfig: jest.fn() }));

const ROOT = join(__dirname, '..', '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const withRows = (t: JudgmentTrace) => t.snapshot().candidates;
const row = (t: JudgmentTrace, s: string) => withRows(t).find((c) => c.symbol === s)!;

function traceWithCandidates(market: 'domestic' | 'overseas' = 'domestic') {
  const t = new JudgmentTrace(market, new Date('2026-10-16T07:00:00Z'));
  t.session('2026-10-19 09:00:00');
  t.candidates([{ symbol: 'A', pattern: 'eod-high-close' }, { symbol: 'B', pattern: 'inside-bar' }, { symbol: 'C', pattern: 'oversold-bounce' }]);
  return t;
}

describe('어휘', () => {
  test('시장별 코드는 §3.4 어휘의 부분집합 — 국내 8 · 해외 12(=전체)', () => {
    expect(EXCLUSION_CODES).toHaveLength(12);
    expect(EXCLUSION_CODES_BY_MARKET.domestic).toHaveLength(8);
    expect(EXCLUSION_CODES_BY_MARKET.overseas).toHaveLength(12);
    for (const m of ['domestic', 'overseas'] as const) {
      for (const c of EXCLUSION_CODES_BY_MARKET[m]) expect(EXCLUSION_CODES).toContain(c);
      expect(new Set(EXCLUSION_CODES_BY_MARKET[m]).size).toBe(EXCLUSION_CODES_BY_MARKET[m].length);
    }
    expect([...EXCLUSION_CODES_BY_MARKET.overseas].sort()).toEqual([...EXCLUSION_CODES].sort());
    // 국내 엔진에는 오래된 봉·블랙아웃·사전 금액·구간 검사가 없다
    for (const c of ['stale_candle', 'blackout', 'prefilter_unaffordable', 'zone_out_of_range'] as ExclusionCode[]) {
      expect(EXCLUSION_CODES_BY_MARKET.domestic).not.toContain(c);
    }
    for (const c of EXCLUSION_CODES) expect(c.length).toBeLessThanOrEqual(40);   // VARCHAR(40)
  });
});

describe('헤더 — 분석 실행만', () => {
  test('session() 전에는 기록 대상 아님(정상 건너뜀), 뒤에는 대상 — valid_from·D0', () => {
    const t = new JudgmentTrace('overseas');
    expect(t.snapshot().recordable).toBe(false);
    t.session('2026-10-21 22:30:00', '2026-10-20');
    expect(t.snapshot()).toMatchObject({ recordable: true, validFrom: '2026-10-21 22:30:00', sessionD0: '2026-10-20', judgmentRole: 'baseline' });
  });

  test('국내 D0 = 조회한 일봉 마지막 봉 날짜 중 가장 늦은 날(빈 배열·이상한 값은 무시)', () => {
    const t = new JudgmentTrace('domestic');
    t.session('2026-10-19 09:00:00');
    t.observeLastBar([{ ts: Date.parse('2026-10-10T00:00:00Z') }, { ts: Date.parse('2026-10-15T00:00:00Z') }]);
    t.observeLastBar([{ ts: Date.parse('2026-10-16T00:00:00Z') }]);
    t.observeLastBar([{ ts: Date.parse('2026-10-14T00:00:00Z') }]);
    t.observeLastBar([]);
    t.observeLastBar(null);
    t.observeLastBar([{ ts: 'x' }]);
    t.observeLastBar([{ ts: Number.NaN }]);
    expect(t.snapshot().sessionD0).toBe('2026-10-16');
  });

  test('일봉 하나도 없으면 국내 D0 는 NULL(실행 날짜로 지어내지 않는다)', () => {
    const t = new JudgmentTrace('domestic');
    t.session('2026-10-19 09:00:00');
    t.observeLastBar([]);
    expect(t.snapshot().sessionD0).toBeNull();
  });

  test('dailyBarDate — UTC 자정 ts → 거래일', () => {
    expect(dailyBarDate(Date.parse('2026-10-16T00:00:00Z'))).toBe('2026-10-16');
    expect(dailyBarDate(undefined)).toBeNull();
    expect(dailyBarDate(Infinity)).toBeNull();
  });

  test('candidateCount = 종목당 1개로 줄인 후보 수, prompt 해시는 runLlm 에 넘긴 문자열의 sha256', () => {
    const t = traceWithCandidates();
    t.sentToLlm([{ symbol: 'A' }, { symbol: 'B' }], '프롬프트 전문 ✨');
    const s = t.snapshot();
    expect(s.candidateCount).toBe(3);
    expect(s.promptSha256).toBe(createHash('sha256').update('프롬프트 전문 ✨', 'utf8').digest('hex'));
  });

  test('finish 는 첫 값만, markAsOf 는 RAG 직전 시각', () => {
    const t = traceWithCandidates();
    const a = new Date('2026-10-16T07:01:00Z');
    t.markAsOf(a);
    t.finish(new Date('2026-10-16T07:03:00Z'));
    t.finish(new Date('2026-10-16T09:00:00Z'));
    expect(t.snapshot()).toMatchObject({ asOf: a, endedAt: new Date('2026-10-16T07:03:00Z') });
  });
});

describe('자료 상태', () => {
  test.each([
    [[], 0, 'available'],
    [['candle_fail'], 0, 'partial'],
    [['stale_candle'], 0, 'partial'],
    [['candle_fail', 'candle_fail', 'candle_fail'], 0, 'error'],
    [['stale_candle', 'stale_candle', 'stale_candle'], 0, 'stale'],
    [['candle_fail', 'stale_candle', 'stale_candle'], 0, 'stale'],
  ] as Array<[Array<'candle_fail' | 'stale_candle'>, number, string]>)('일봉 %j / 3종목 → %s', (codes, _x, expected) => {
    const t = new JudgmentTrace('overseas');
    codes.forEach((c, i) => t.symbolExcluded(`S${i}`, c));
    t.candlesFetched(3);
    expect(t.snapshot().dataStatus.candles).toBe(expected);
  });

  test('RAG — 문맥 id(문자열·숫자만)와 뉴스 상태(뉴스 컬렉션 오류 = error, 신호 컬렉션 오류만 = available)', () => {
    const t = new JudgmentTrace('domestic');
    t.rag({ errors: [], recentNews: [{ id: 'n1' }, { id: 7 }, { nope: 1 }, null], pastSignals: [{ id: 's1' }], macroContext: 'x' });
    expect(t.snapshot()).toMatchObject({ ragContextIds: { news: ['n1', '7'], signals: ['s1'], macro: [] }, dataStatus: { news: 'available' } });
    t.rag({ errors: ['news.kr_market: HTTP 500'], recentNews: [] });
    expect(t.snapshot().dataStatus.news).toBe('error');
    t.rag({ errors: ['signals.stockinvest: timeout'], recentNews: [] });
    expect(t.snapshot().dataStatus.news).toBe('available');
    t.rag({ totalChars: 3 });   // 형식이 예상과 다름 — 판정하지 않는다
    expect(t.snapshot().dataStatus.news).toBe('unknown');
    t.ragFailed();
    expect(t.snapshot()).toMatchObject({ ragContextIds: null, dataStatus: { news: 'error' } });
  });
});

describe('결정 — 우선순위와 닫기', () => {
  test('보낸 후보: 결정 없으면 LLM 정상 = NONE, LLM 실패 = llm_error(결정 NULL), LLM 상태 모름 = 그대로', () => {
    const ok = traceWithCandidates();
    ok.sentToLlm([{ symbol: 'A' }, { symbol: 'B' }], 'p');
    ok.llmOk();
    ok.decide('A', { action: 'SKIP', confidence: 20 }, null);
    expect([row(ok, 'A').aiDecision, row(ok, 'B').aiDecision, row(ok, 'C').aiDecision]).toEqual(['SKIP', 'NONE', null]);
    expect(row(ok, 'C').sentToLlm).toBe(false);

    const bad = traceWithCandidates();
    bad.sentToLlm([{ symbol: 'A' }, { symbol: 'B' }], 'p');
    bad.llmFailed();
    expect([row(bad, 'A'), row(bad, 'B')].map((r) => [r.exclusionCode, r.aiDecision])).toEqual([['llm_error', null], ['llm_error', null]]);
    expect(row(bad, 'C').exclusionCode).toBeNull();

    const unknown = traceWithCandidates();
    unknown.sentToLlm([{ symbol: 'A' }], 'p');
    expect(row(unknown, 'A')).toMatchObject({ aiDecision: null, exclusionCode: null });
  });

  test('국내 응답 해석 — 엔진 parseAiResponse 와 같은 규칙(코드펜스 제거·decisions 배열만)', () => {
    expect(domesticLlmResponseReadable('```json\n{"decisions":[]}\n```')).toBe(true);
    expect(domesticLlmResponseReadable({ decisions: [{ symbol: 'A' }] })).toBe(true);
    expect(domesticLlmResponseReadable('{"decisions":{}}')).toBe(false);
    expect(domesticLlmResponseReadable('{"other":[]}')).toBe(false);
    expect(domesticLlmResponseReadable('not json')).toBe(false);
    expect(domesticLlmResponseReadable(null)).toBe(false);
    const t = traceWithCandidates();
    t.sentToLlm([{ symbol: 'A' }], 'p');
    t.domesticLlmParsed('```json\n{"decisions":[]}\n```');
    expect(row(t, 'A').aiDecision).toBe('NONE');
    t.domesticLlmParsed('garbage');
    expect(row(t, 'A')).toMatchObject({ aiDecision: null, exclusionCode: 'llm_error' });
  });

  test('같은 종목 두 결정 — 첫 결정 유지, 단 뒤 결정이 카드를 새로 만들면(created·blocked) 바꾼다, duplicate 로는 안 바꾼다', () => {
    const t = traceWithCandidates();
    t.sentToLlm([{ symbol: 'A' }, { symbol: 'B' }, { symbol: 'C' }], 'p');
    t.llmOk();
    t.decide('A', { action: 'BUY', confidence: 80, reasoning: '첫' }, null, 'created');
    t.decide('A', { action: 'BUY', confidence: 50, reasoning: '둘' }, 'low_confidence');
    t.decide('B', { action: 'SKIP', reasoning: '첫' }, null);
    t.decide('B', { action: 'BUY', confidence: 75, reasoning: '둘' }, null, 'blocked');
    t.decide('C', { action: 'BUY', confidence: 70, reasoning: '첫' }, 'low_confidence');
    t.decide('C', { action: 'BUY', confidence: 90, reasoning: '둘' }, null, 'duplicate');
    expect([row(t, 'A').reasoning, row(t, 'A').exclusionCode, row(t, 'A').card]).toEqual(['첫', null, 'created']);
    expect([row(t, 'B').reasoning, row(t, 'B').exclusionCode, row(t, 'B').card, row(t, 'B').aiDecision]).toEqual(['둘', 'validation_blocked', 'blocked', 'BUY']);
    expect([row(t, 'C').reasoning, row(t, 'C').exclusionCode, row(t, 'C').card]).toEqual(['첫', 'low_confidence', null]);
  });

  test('카드 결과 → 코드: created=NULL, duplicate=duplicate, blocked=validation_blocked / 트랜잭션 되돌림 = insert_fail', () => {
    const t = traceWithCandidates('overseas');
    t.sentToLlm([{ symbol: 'A' }, { symbol: 'B' }, { symbol: 'C' }], 'p');
    t.llmOk();
    for (const s of ['A', 'B', 'C']) t.decide(s, { action: 'BUY', confidence: 70 }, null);
    t.cardResult('A', 'created');
    t.cardResult('B', 'duplicate');
    t.cardResult('C', 'blocked');
    expect(['A', 'B', 'C'].map((s) => row(t, s).exclusionCode)).toEqual([null, 'duplicate', 'validation_blocked']);
    t.insertFailed('A');
    expect(row(t, 'A')).toMatchObject({ exclusionCode: 'insert_fail', card: null });
  });

  test('보내지 않은 후보·없는 종목에는 결정을 남기지 않는다(chk_jc_decision: 미전송이면 결정 NULL)', () => {
    const t = traceWithCandidates();
    t.candidateExcluded('C', 'blackout');
    t.sentToLlm([{ symbol: 'A' }], 'p');
    t.llmOk();
    t.decide('C', { action: 'BUY', confidence: 80 }, null, 'created');
    t.decide('ZZZ', { action: 'BUY' }, null);
    expect(row(t, 'C')).toMatchObject({ sentToLlm: false, aiDecision: null, exclusionCode: 'blackout', card: null });
    expect(withRows(t).map((r) => r.symbol)).toEqual(['A', 'B', 'C']);
  });

  test('aiDecisionOf / confidenceOf', () => {
    expect([aiDecisionOf({ action: 'BUY' }), aiDecisionOf({ action: 'SKIP' }), aiDecisionOf({ action: 'buy' }), aiDecisionOf(null)]).toEqual(['BUY', 'SKIP', 'INVALID', 'INVALID']);
    expect([confidenceOf({ confidence: 85.456 }), confidenceOf({ confidence: '72' }), confidenceOf({ confidence: 101 }), confidenceOf({ confidence: -1 }), confidenceOf({ confidence: 'high' }), confidenceOf({})])
      .toEqual([85.46, 72, null, null, null, null]);
  });
});

describe('🔴 던지지 않는다 — 적대적 입력', () => {
  const hostile = new Proxy({}, { get() { throw new Error('getter boom'); }, has() { throw new Error('has boom'); } });
  const hostileList = new Proxy([], { get() { throw new Error('list boom'); } });

  test('모든 표시 메서드가 던지지 않고 traceErrors 로만 센다', () => {
    const t = new JudgmentTrace('overseas');
    const calls: Array<() => void> = [
      () => t.session(hostile as unknown as string, hostile as unknown as string),
      () => t.observeLastBar(hostileList),
      () => t.status(hostile as never, hostile as never),
      () => t.candlesFetched(hostile as unknown as number),
      () => t.symbolExcluded(hostile as unknown as string, 'candle_fail'),
      () => t.candidates(hostileList as never),
      () => t.candidateExcluded(hostile as unknown as string, 'blackout'),
      () => t.markAsOf(hostile as unknown as Date),
      () => t.rag(hostile),
      () => t.ragFailed(),
      () => t.sentToLlm(hostileList as never, hostile as unknown as string),
      () => t.llmOk(),
      () => t.llmFailed(),
      () => t.domesticLlmParsed(hostile),
      () => t.decide(hostile as unknown as string, hostile, hostile as never, hostile as never),
      () => t.cardResult(hostile as unknown as string, hostile as never),
      () => t.insertFailed(hostile as unknown as string),
      () => t.finish(hostile as unknown as Date),
    ];
    for (const c of calls) expect(c).not.toThrow();
    expect(() => t.snapshot()).not.toThrow();
    expect(t.snapshot().traceErrors).toBeGreaterThan(0);
  });

  test('후보가 있는 상태에서 적대적 결정 객체 — 던지지 않고 행은 유지', () => {
    const t = traceWithCandidates();
    t.sentToLlm([{ symbol: 'A' }], 'p');
    expect(() => t.decide('A', hostile, null)).not.toThrow();
    expect(() => t.snapshot()).not.toThrow();
    expect(withRows(t)).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 정적 대조 — 엔진 소스
// ─────────────────────────────────────────────────────────────────────────────
const ENGINES = { domestic: 'src/lib/strategy/post-market-engine.ts', overseas: 'src/lib/strategy/post-market-overseas.ts' } as const;

function codesMarked(src: string): Set<string> {
  const out = new Set<string>();
  const vocab = new Set<string>(EXCLUSION_CODES);
  for (const m of src.matchAll(/trace\.(?:symbolExcluded|candidateExcluded|decide)\(([^;]*)\);/g)) {
    for (const q of m[1].matchAll(/'([a-z_]+)'/g)) if (vocab.has(q[1])) out.add(q[1]);
  }
  if (/trace\.(?:llmFailed|domesticLlmParsed)\(/.test(src)) out.add('llm_error');
  if (/trace\.decide\([^;]*,\s*null,\s*outcome\)|trace\.cardResult\(/.test(src)) { out.add('duplicate'); out.add('validation_blocked'); }
  if (/trace\.insertFailed\(/.test(src)) out.add('insert_fail');
  return out;
}
const traceCalls = (src: string) => [...src.matchAll(/\btrace\.([a-zA-Z]+)\(/g)].map((m) => m[1]);

describe('🔴 정적 대조 — 엔진 추적 표시 ↔ §3.4 어휘 1:1', () => {
  test.each(['domestic', 'overseas'] as const)('%s 엔진이 표시하는 코드 = 시장별 어휘', (market) => {
    expect([...codesMarked(read(ENGINES[market]))].sort()).toEqual([...EXCLUSION_CODES_BY_MARKET[market]].sort());
  });

  test('추적 호출 목록 고정 — 표시 1곳이 빠지거나 늘면 이 시험이 먼저 깨진다(늘릴 때는 어휘·동적 시험과 함께 갱신)', () => {
    expect(traceCalls(read(ENGINES.domestic))).toEqual([
      'session', 'observeLastBar', 'symbolExcluded', 'candlesFetched', 'candidates', 'markAsOf', 'rag', 'ragFailed', 'sentToLlm',
      'domesticLlmParsed', 'llmFailed', 'decide', 'decide', 'decide', 'decide', 'decide',
    ]);
    expect(traceCalls(read(ENGINES.overseas))).toEqual([
      'session', 'status', 'status', 'status', 'status', 'status', 'status', 'status', 'symbolExcluded', 'symbolExcluded',
      'candlesFetched', 'candidates', 'candidateExcluded', 'candidateExcluded', 'markAsOf', 'rag', 'ragFailed', 'sentToLlm',
      'llmFailed', 'llmFailed', 'llmOk', 'decide', 'decide', 'decide', 'decide', 'decide', 'insertFailed', 'cardResult',
    ]);
  });

  test.each(['domestic', 'overseas'] as const)('%s — 기록 진입점은 finally 안 1곳, 기다리지 않고 예외를 삼킨다, 트랜잭션 연결을 넘기지 않는다', (market) => {
    const src = read(ENGINES[market]);
    expect(src.match(/recordJudgmentDetached\(/g)).toHaveLength(1);
    expect(src).toMatch(/\} finally \{\n\s*try \{ recordJudgmentDetached\(trace\); \} catch \{/);
    expect(src).not.toMatch(/await\s+recordJudgment/);
    expect(src).not.toMatch(/recordJudgment\w*\([^)]*conn/);
    // 추적 표시는 await 하지 않는다(메모리 전용)
    expect(src).not.toMatch(/await\s+trace\./);
  });

  test('claude 기본 모델 상수 = claude-cli.ts resolveModel() 기본값(설정 기준 llm_model)', () => {
    const cli = read('src/lib/llm/claude-cli.ts');
    const m = /function resolveModel\([^)]*\)[^{]*\{[\s\S]*?return '([a-z]+)';\s*\}/.exec(cli);
    expect(m?.[1]).toBe(CLAUDE_CLI_DEFAULT_MODEL);
  });
});

describe('🔴 경계 — judgment_* 는 기록 모듈만 쓴다(시그널·주문·안전장치 경로가 읽지 않는다)', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p, out); } else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  }
  test('judgment_run·judgment_candidate·judgment-recorder·judgment-trace 를 참조하는 src 파일 = 기록 모듈 디렉터리 + 두 엔진', () => {
    const allowed = new Set([
      'src/lib/strategy/post-market-engine.ts',
      'src/lib/strategy/post-market-overseas.ts',
    ]);
    const offenders: string[] = [];
    for (const f of walk(join(ROOT, 'src'))) {
      const rel = relative(ROOT, f).split('\\').join('/');
      if (rel.startsWith('src/lib/strategy/records/')) continue;   // 기록 모듈 자신(헬퍼 주석의 열 이름 포함)·그 시험
      if (rel.startsWith('src/lib/strategy/__tests__/post-market-')) continue;   // 기존 엔진 시험의 기록기 목
      const s = readFileSync(f, 'utf8');
      if (/judgment_run|judgment_candidate|judgment-recorder|judgment-trace/.test(s) && !allowed.has(rel)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
