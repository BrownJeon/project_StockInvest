/**
 * 🔴 T-062 요구 9 — 국내 post-market 카드 생성 결과 **바이트 불변** 골든 시험.
 *
 * 기대값은 HEAD `7cd47e7`(해외 확장 이전) 코드로 같은 입력을 돌려 **캡처한 값**을 리터럴로 옮긴 것이다.
 * 해외 확장 뒤에도 이 시험이 그대로 통과해야 한다 — 프롬프트 전문·LLM 호출 옵션·RAG 호출 인자·저장되는 열 값·
 * 중복 판정 조건·반환값·로그 줄이 한 글자라도 바뀌면 실패한다.
 *
 * INSERT 는 "SQL 문자열"이 아니라 **열 → 저장 값** 으로 비교한다: 해외 확장은 `market`·`amount_krw` 를 리터럴에서
 * 자리표시자(`?`)로 바꾸므로(요구 3·D-5) 파라미터 배열은 길어지지만, DB 에 들어가는 값은 같아야 한다.
 */
import type { DailyCandidate } from '../rules/eod-high-close';
import { runPostMarketAnalysis } from '../post-market-engine';
import { getPool } from '@/lib/db';
import { getStyleConfig } from '../style';
import { getCandles } from '@/lib/exchanges/kis-domestic';
import { getAlwaysIncludeSymbols, getUniverseSnapshot } from '../universe';
import { runLlm } from '@/lib/llm/provider';
import { retrieveRagContext } from '@/lib/rag/retrieval';
import { formatRagSection } from '@/lib/rag/format';
import { eodHighClose } from '../rules/eod-high-close';
import { insideBar } from '../rules/inside-bar';
import { oversoldBounceDaily } from '../rules/oversold-bounce-daily';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/exchanges/kis-domestic', () => ({ getCandles: jest.fn() }));
jest.mock('../universe', () => ({ getAlwaysIncludeSymbols: jest.fn(), getUniverseSnapshot: jest.fn() }));
jest.mock('@/lib/llm/provider', () => ({ runLlm: jest.fn() }));
jest.mock('@/lib/rag/retrieval', () => ({ retrieveRagContext: jest.fn() }));
jest.mock('@/lib/rag/format', () => ({ formatRagSection: jest.fn() }));
jest.mock('../rules/eod-high-close', () => ({ eodHighClose: jest.fn() }));
jest.mock('../rules/inside-bar', () => ({ insideBar: jest.fn() }));
jest.mock('../rules/oversold-bounce-daily', () => ({ oversoldBounceDaily: jest.fn() }));
jest.mock('../style', () => ({ getStyleConfig: jest.fn() }));
// T-072 G2 — 골든은 "검증된 전략이면 국내 경로가 HEAD 7cd47e7 과 바이트 동일"을 고정한다(아래 GOLDEN 리터럴은 그대로).
//   관문 판정만 '검증됨'으로 고정한다 — 판정 조회가 같은 목 풀을 지나 골든의 poolCalls·inserts 를 바꾸지 않게.
//   막히는 경우(미검증·미등록 → skipped + 가상 체결)는 post-market-validation-gate.test.ts 가 실제 관문으로 본다.
jest.mock('@/lib/safety/validation-gate', () => ({
  ...jest.requireActual('@/lib/safety/validation-gate'),
  evaluateValidationGate: jest.fn(async ({ strategyId }: { strategyId: string }) => ({ allowed: true, kind: 'validated', strategyId, status: 'backtested' })),
}));

const mGetPool = getPool as jest.Mock;
const mCandles = getCandles as jest.Mock;
const mAlways = getAlwaysIncludeSymbols as jest.Mock;
const mUniverse = getUniverseSnapshot as jest.Mock;
const mLlm = runLlm as jest.Mock;
const mRag = retrieveRagContext as jest.Mock;
const mFormat = formatRagSection as jest.Mock;
const mEod = eodHighClose as jest.Mock;
const mInside = insideBar as jest.Mock;
const mOversold = oversoldBounceDaily as jest.Mock;
const mStyle = getStyleConfig as jest.Mock;

function setNow(iso: string) {
  jest.useFakeTimers({
    now: new Date(iso),
    doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'clearImmediate', 'queueMicrotask', 'performance'],
  });
}

const cand = (over: Partial<DailyCandidate> & Pick<DailyCandidate, 'symbol' | 'pattern'>): DailyCandidate => ({
  close: 93800, high: 94200, low: 92500, open: 92900, volume: 1_200_000, volRatio: 1.83,
  rsi14: 58.24, ma5: 93120.4, ma20: 90555.5, reasoning: '종가 고가권 마감', ...over,
});

/** SQL + 파라미터 → { 열: 저장 값 } 과 NOT EXISTS 조건(정규화 문자열)·그 파라미터. */
function decodeInsert(sql: string, params: unknown[]) {
  const norm = sql.replace(/\s+/g, ' ').trim();
  const cols = /INSERT INTO signals \(([^)]*)\)/.exec(norm)![1].split(',').map(s => s.trim());
  const selectList = /SELECT (.*?) FROM DUAL/.exec(norm)![1].split(',').map(s => s.trim());
  expect(selectList).toHaveLength(cols.length);
  let p = 0;
  const row: Record<string, unknown> = {};
  cols.forEach((c, i) => {
    const item = selectList[i];
    if (item === '?') row[c] = params[p++];
    else if (/^'.*'$/.test(item)) row[c] = item.slice(1, -1);
    else if (/^-?\d+(\.\d+)?$/.test(item)) row[c] = Number(item);
    else throw new Error(`해석할 수 없는 SELECT 항목: ${item}`);
  });
  const where = /WHERE NOT EXISTS \((.*)\)$/.exec(norm)![1].trim();
  return { table: 'signals', row, where, whereParams: params.slice(p) };
}

let query: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  query = jest.fn();
  mGetPool.mockReturnValue({ query });
  mStyle.mockResolvedValue({ limitChasePct: 0.005 });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/** 골든 입력: 4종목(패턴 3종·N/A 지표·중복 후보) → BUY 생성 1·중복 1·금액 초과 1·SKIP 1·없는 종목 1·신뢰도 미달 1. */
function arrangeGolden() {
  mAlways.mockResolvedValue(['005380', '055550']);
  mUniverse.mockResolvedValue({ momentum: [{ symbol: '000660' }, { symbol: '005380' }], value: [{ symbol: '035420' }] });
  mCandles.mockResolvedValue([]);
  mEod.mockImplementation((s: string) => (s === '005380' ? cand({ symbol: s, pattern: 'eod-high-close' }) : null));
  mInside.mockImplementation((s: string) => {
    if (s === '005380') return cand({ symbol: s, pattern: 'inside-bar', reasoning: '안쪽 봉 (중복 — eod 가 우선)' });
    if (s === '055550') return cand({ symbol: s, pattern: 'inside-bar', close: 60500, open: 60100, high: 61000, low: 59900, ma5: null as unknown as number, ma20: null as unknown as number, rsi14: null as unknown as number, volRatio: 0.954, reasoning: '인사이드바 MA5=60412 MA20=59870' });
    return null;
  });
  mOversold.mockImplementation((s: string) => (s === '000660' ? cand({ symbol: s, pattern: 'oversold-bounce', close: 151000, open: 149500, high: 152500, low: 148000, rsi14: 28.66, ma5: 155321.7, ma20: 162004.1, volRatio: 2.4, reasoning: 'BB하단 148100 반등, 전저점 147500' }) : null));
  mRag.mockResolvedValue({ totalChars: 42 });
  mFormat.mockReturnValue('### 최근 뉴스\n- 반도체 수출 증가');
  mLlm.mockResolvedValue('```json\n' + JSON.stringify({
    decisions: [
      { symbol: '005380', action: 'BUY', entry_zone: { lo: 93000, hi: 94000 }, target_pct: 3.5, stop_pct: 1.8, holding_days: 2, confidence: 85, reasoning: '갭 위험 낮음' },
      { symbol: '055550', action: 'BUY', entry_zone: { lo: 60100.5, hi: 60900 }, target_pct: 4, stop_pct: 2.2, holding_days: 3, confidence: 72, reasoning: '박스권 하단' },
      { symbol: '000660', action: 'BUY', entry_zone: { lo: 150000, hi: 152000 }, target_pct: 5, stop_pct: 3, confidence: 90, reasoning: '비쌈' },
      { symbol: '035420', action: 'SKIP', reasoning: '후보 아님' },
      { symbol: '999999', action: 'BUY', entry_zone: { lo: 1, hi: 2 }, target_pct: 1, stop_pct: 1, confidence: 99 },
      { symbol: '005380', action: 'BUY', entry_zone: { lo: 93000, hi: 94000 }, target_pct: 3, stop_pct: 1, confidence: 59 },
    ],
  }) + '\n```');
  query
    .mockResolvedValueOnce([{ affectedRows: 1 }, undefined])
    .mockResolvedValueOnce([{ affectedRows: 0 }, undefined]);
}

test('🔴 국내 골든 — HEAD 7cd47e7 와 같은 프롬프트·INSERT 값·시각·reasoning·indicators·반환값·로그', async () => {
  setNow('2026-10-16T07:02:00Z');   // 금 16:02 KST
  arrangeGolden();
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  const result = await runPostMarketAnalysis('domestic');

  const observed = {
    result,
    prompt: mLlm.mock.calls[0][0],
    llmOpts: mLlm.mock.calls[0][1],
    llmCalls: mLlm.mock.calls.length,
    ragArgs: mRag.mock.calls,
    styleCalls: mStyle.mock.calls.length,
    poolCalls: mGetPool.mock.calls.length,
    candleArgs: mCandles.mock.calls,
    inserts: query.mock.calls.map(c => decodeInsert(c[0] as string, c[1] as unknown[])),
    logs: logSpy.mock.calls.map(c => c.map(String).join(' ')),
  };
  expect(observed).toEqual(GOLDEN);
});

// ── 아래는 HEAD 7cd47e7 캡처값(손으로 고치지 않는다) ─────────────────────────────────────────
const GOLDEN = {
  "result": {
    "market": "domestic",
    "symbolsEvaluated": 4,
    "candidatesFound": 3,
    "signalsCreated": 1,
    "signalsSkipped": 5,
    "errors": [],
    "validFrom": "2026-10-19 09:00:00",
    "duplicatesSkipped": 1,
    "unaffordableSkipped": 1
  },
  "prompt": "당신은 국내주식 다음날 진입 시나리오를 분석하는 전문 트레이더입니다.\n\n오늘(2026-10-16) 장 마감 후 데이터를 기반으로 내일(2026-10-19) 오전 진입 가능한 종목을 선별하세요.\n\n### 최근 뉴스\n- 반도체 수출 증가\n\n### 후보 종목 (일봉 패턴 감지)\n\n## 005380 [eod-high-close]\n- 오늘(2026-10-16): 시=92900 고=94200 저=92500 종=93800 거래량비율=1.83x\n- RSI14=58.2 MA5=93120 MA20=90556\n- 패턴 근거: 종가 고가권 마감\n\n## 055550 [inside-bar]\n- 오늘(2026-10-16): 시=60100 고=61000 저=59900 종=60500 거래량비율=0.95x\n- RSI14=N/A MA5=N/A MA20=N/A\n- 패턴 근거: 인사이드바 MA5=60412 MA20=59870\n\n## 000660 [oversold-bounce]\n- 오늘(2026-10-16): 시=149500 고=152500 저=148000 종=151000 거래량비율=2.40x\n- RSI14=28.7 MA5=155322 MA20=162004\n- 패턴 근거: BB하단 148100 반등, 전저점 147500\n\n### 판단 기준\n1. 내일 갭업/갭다운 위험 (오늘 급등했으면 갭업 차익실현 가능성)\n2. 뉴스·섹터 모멘텀 지속 여부 (RAG 컨텍스트 참고)\n3. 기술적 지지·저항 레벨 (MA, BB 기준)\n4. 진입 구간 현실성 (시초가 ±1~2% 내외)\n\n### 출력 형식 (JSON only)\n{\n  \"decisions\": [\n    {\n      \"symbol\": \"종목코드\",\n      \"action\": \"BUY\" 또는 \"SKIP\",\n      \"entry_zone\": {\"lo\": 진입하단가, \"hi\": 진입상단가},\n      \"target_pct\": 목표수익률(예: 3.5),\n      \"stop_pct\": 손절비율(예: 1.8),\n      \"holding_days\": 예상보유일수(1~5),\n      \"confidence\": 신뢰도(0~100),\n      \"reasoning\": \"한국어 판단 근거 2~3문장\"\n    }\n  ]\n}\n\nBUY 선택 시 entry_zone, target_pct, stop_pct, confidence 필수.\n신뢰도 60% 미만이면 SKIP 권장. 최대 5종목 BUY 선택.",
  "llmOpts": {
    "timeoutMs": 90000,
    "responseFormat": "json"
  },
  "llmCalls": 1,
  "ragArgs": [
    [
      "005380 eod-high-close 종가 고가권 마감 | 055550 inside-bar 인사이드바 MA5=60412 MA20=59870 | 000660 oversold-bounce BB하단 148100 반등, 전저점 147500",
      "domestic",
      {
        "lookbackDays": 3,
        "topKNews": 5,
        "topKSignals": 3
      }
    ]
  ],
  "styleCalls": 1,
  "poolCalls": 1,
  "candleArgs": [
    [
      "005380",
      "1d",
      60
    ],
    [
      "055550",
      "1d",
      60
    ],
    [
      "000660",
      "1d",
      60
    ],
    [
      "035420",
      "1d",
      60
    ]
  ],
  "inserts": [
    {
      "table": "signals",
      "row": {
        "strategy_id": "eod-high-close-v1",
        "symbol": "005380",
        "side": "buy",
        "order_type": "limit",
        "price": 93500,
        "amount_krw": 100000,
        "reasoning": "[익일 시나리오] 종가 고가권 마감\n진입구간: 93000~94000 | 목표: +3.5% | 손절: -1.8%\n갭 위험 낮음",
        "indicators": "{\"pattern\":\"eod-high-close\",\"close\":93800,\"volRatio\":1.83,\"rsi14\":58.24,\"ma5\":93120.4,\"ma20\":90555.5,\"ai\":{\"confidence\":85,\"reasoning_short\":\"갭 위험 낮음\",\"scenario\":{\"grade\":\"A\",\"entry\":{\"trigger\":\"price_zone\",\"price_zone\":\"93000~94000\"},\"exit\":{\"target_pct\":3.5,\"stop_pct\":1.8,\"holding_days\":\"2일\",\"holding_deadline\":\"2026-10-21\"}}}}",
        "status": "pending",
        "expires_at": "2026-10-19 15:30:00",
        "valid_from": "2026-10-19 09:00:00",
        "market": "domestic",
        "scenario_source": "post-market"
      },
      "where": "SELECT 1 FROM signals WHERE symbol = ? AND side = 'buy' AND valid_from = ? AND scenario_source = 'post-market'",
      "whereParams": [
        "005380",
        "2026-10-19 09:00:00"
      ]
    },
    {
      "table": "signals",
      "row": {
        "strategy_id": "inside-bar-v1",
        "symbol": "055550",
        "side": "buy",
        "order_type": "limit",
        "price": 60500.25,
        "amount_krw": 100000,
        "reasoning": "[익일 시나리오] 인사이드바 MA5=60412 MA20=59870\n진입구간: 60101~60900 | 목표: +4% | 손절: -2.2%\n박스권 하단",
        "indicators": "{\"pattern\":\"inside-bar\",\"close\":60500,\"volRatio\":0.954,\"rsi14\":null,\"ma5\":null,\"ma20\":null,\"ai\":{\"confidence\":72,\"reasoning_short\":\"박스권 하단\",\"scenario\":{\"grade\":\"B+\",\"entry\":{\"trigger\":\"price_zone\",\"price_zone\":\"60101~60900\"},\"exit\":{\"target_pct\":4,\"stop_pct\":2.2,\"holding_days\":\"3일\",\"holding_deadline\":\"2026-10-22\"}}}}",
        "status": "pending",
        "expires_at": "2026-10-19 15:30:00",
        "valid_from": "2026-10-19 09:00:00",
        "market": "domestic",
        "scenario_source": "post-market"
      },
      "where": "SELECT 1 FROM signals WHERE symbol = ? AND side = 'buy' AND valid_from = ? AND scenario_source = 'post-market'",
      "whereParams": [
        "055550",
        "2026-10-19 09:00:00"
      ]
    }
  ],
  "logs": [
    "[post-market] ✅ 005380 eod-high-close valid_from=2026-10-19 09:00:00 conf=85%",
    "[post-market] ⏭ 055550 valid_from=2026-10-19 09:00:00 — 같은 카드가 이미 있어 만들지 않음",
    "[post-market] 💸 000660 금액 초과 — 1주 지정가 151755원 > 카드 금액 100000원 (진입 구간 중간값 151000원, 지정가 추격 0.50%) — 수량 0 이라 만들지 않음",
    "[post-market] market=domestic evaluated=4 candidates=3 created=1 skipped=5 (중복 1, 금액 초과 1) valid_from=2026-10-19 09:00:00"
  ]
};
