import { computeLifoPnl, buildTradeReport, formatReportMessage, formatFunnelSection, type OrderRow } from '../trade-report';
import type { EvalFunnelSummary } from '@/lib/strategy/eval-funnel-query';

function row(symbol: string, side: 'buy'|'sell', price: number, qty: number, ts: number, fee = 0): OrderRow {
  return { symbol, side, price, quantity: qty, amount_krw: price * qty, fee, ts };
}

const T0 = new Date('2026-05-07T00:00:00Z').getTime();
const HOUR = 3600_000;

describe('computeLifoPnl — LIFO 페어링', () => {
  test('단순 1매수 1매도 차익', () => {
    const rangeStart = new Date(T0);
    const rows: OrderRow[] = [
      row('BCH', 'buy',  100, 1, T0 + 1*HOUR),
      row('BCH', 'sell', 110, 1, T0 + 2*HOUR),
    ];
    const r = computeLifoPnl(rows, rangeStart);
    expect(r.totalKRW).toBeCloseTo(10, 6);
    expect(r.perSymbol.get('BCH')).toBeCloseTo(10, 6);
  });

  test('수수료 차감', () => {
    const rangeStart = new Date(T0);
    const rows: OrderRow[] = [
      row('XRP', 'buy',  100, 1, T0 + 1*HOUR),
      row('XRP', 'sell', 110, 1, T0 + 2*HOUR, 3),
    ];
    const r = computeLifoPnl(rows, rangeStart);
    expect(r.totalKRW).toBeCloseTo(7, 6);
  });

  test('range 이전 매수는 stack 만 빌드, range 내 매도만 PnL 합산', () => {
    const rangeStart = new Date(T0 + 5*HOUR);
    const rows: OrderRow[] = [
      row('BCH', 'buy',  100, 1, T0 + 1*HOUR),  // pre-range
      row('BCH', 'sell', 120, 1, T0 + 6*HOUR),  // in range
    ];
    const r = computeLifoPnl(rows, rangeStart);
    expect(r.totalKRW).toBeCloseTo(20, 6);
  });

  test('LIFO 차감 — 가장 최근 매수부터', () => {
    const rangeStart = new Date(T0);
    const rows: OrderRow[] = [
      row('BCH', 'buy',  100, 1, T0 + 1*HOUR),
      row('BCH', 'buy',  200, 1, T0 + 2*HOUR),
      row('BCH', 'sell', 150, 1, T0 + 3*HOUR),  // 200 매수에서 차감 → -50
    ];
    const r = computeLifoPnl(rows, rangeStart);
    expect(r.totalKRW).toBeCloseTo(-50, 6);
  });

  test('range 이전 청산 사이클은 무시', () => {
    const rangeStart = new Date(T0 + 5*HOUR);
    const rows: OrderRow[] = [
      row('BCH', 'buy',  100, 1, T0 + 1*HOUR),
      row('BCH', 'sell', 110, 1, T0 + 2*HOUR),  // pre-range, stack drained
      row('BCH', 'buy',  200, 1, T0 + 6*HOUR),  // in range
      row('BCH', 'sell', 220, 1, T0 + 7*HOUR),  // in range → +20
    ];
    const r = computeLifoPnl(rows, rangeStart);
    expect(r.totalKRW).toBeCloseTo(20, 6);
  });

  test('종목 분리', () => {
    const rangeStart = new Date(T0);
    const rows: OrderRow[] = [
      row('BCH', 'buy',  100, 1, T0 + 1*HOUR),
      row('BCH', 'sell', 110, 1, T0 + 2*HOUR),
      row('XRP', 'buy',   50, 2, T0 + 3*HOUR),
      row('XRP', 'sell',  40, 2, T0 + 4*HOUR),
    ];
    const r = computeLifoPnl(rows, rangeStart);
    expect(r.perSymbol.get('BCH')).toBeCloseTo(10, 6);
    expect(r.perSymbol.get('XRP')).toBeCloseTo(-20, 6);
    expect(r.totalKRW).toBeCloseTo(-10, 6);
  });
});

describe('buildTradeReport — 집계', () => {
  test('헤더 P&L vs LIFO P&L 둘 다 산출', async () => {
    const rangeStart = new Date(T0);
    const rangeEnd = new Date(T0 + 8*HOUR);
    const rows: OrderRow[] = [
      row('BCH', 'buy',  100, 1, T0 + 1*HOUR),
      row('BCH', 'sell', 110, 1, T0 + 2*HOUR),
      row('XRP', 'buy',   50, 2, T0 + 3*HOUR),    // 미체결 매수 (페어 없음)
    ];
    const rep = await buildTradeReport({ rangeStart, rangeEnd, totalKRW: 1000, baselineKRW: 950, rows });
    expect(rep.buys).toBe(2);
    expect(rep.sells).toBe(1);
    expect(rep.buysAmountKRW).toBeCloseTo(200, 6);
    expect(rep.sellsAmountKRW).toBeCloseTo(110, 6);
    expect(rep.headerPnlKRW).toBeCloseTo(-90, 6);   // 110 - 200
    expect(rep.lifoPnlKRW).toBeCloseTo(10, 6);      // BCH 페어만
    expect(rep.perSymbol).toHaveLength(1);          // 매도 발생한 BCH 만 포함, XRP buy-only 는 제외
    expect(rep.perSymbol[0].symbol).toBe('BCH');
    expect(rep.perSymbol[0].sellCount).toBe(1);
  });

  test('회전매매 — 같은 종목 buy/sell 각 2회 이상', async () => {
    const rangeStart = new Date(T0);
    const rangeEnd = new Date(T0 + 8*HOUR);
    const rows: OrderRow[] = [
      row('BCH', 'buy',  100, 1, T0 + 1*HOUR),
      row('BCH', 'sell', 105, 1, T0 + 2*HOUR),
      row('BCH', 'buy',  108, 1, T0 + 3*HOUR),
      row('BCH', 'sell', 110, 1, T0 + 4*HOUR),
      row('XRP', 'buy',  100, 1, T0 + 5*HOUR),
      row('XRP', 'sell', 105, 1, T0 + 6*HOUR),  // 1사이클만
    ];
    const rep = await buildTradeReport({ rangeStart, rangeEnd, totalKRW: 1000, baselineKRW: 1000, rows });
    expect(rep.churnSymbols).toContain('BCH');
    expect(rep.churnSymbols).not.toContain('XRP');
  });

  test('Top5 정렬 — |realized| 내림차순', async () => {
    const rangeStart = new Date(T0);
    const rangeEnd = new Date(T0 + 24*HOUR);
    const rows: OrderRow[] = [
      row('A', 'buy', 100, 1, T0+1*HOUR),  row('A', 'sell', 105, 1, T0+2*HOUR),  // +5
      row('B', 'buy', 100, 1, T0+3*HOUR),  row('B', 'sell',  80, 1, T0+4*HOUR),  // -20
      row('C', 'buy', 100, 1, T0+5*HOUR),  row('C', 'sell', 110, 1, T0+6*HOUR),  // +10
    ];
    const rep = await buildTradeReport({ rangeStart, rangeEnd, totalKRW: 1000, baselineKRW: 1000, rows });
    expect(rep.perSymbol[0].symbol).toBe('B');  // 절대값 20
    expect(rep.perSymbol[1].symbol).toBe('C');  // 10
    expect(rep.perSymbol[2].symbol).toBe('A');  // 5
  });
});

describe('formatReportMessage', () => {
  test('포트폴리오·거래·종목·경고 모두 포함', async () => {
    const rangeStart = new Date(T0);
    const rangeEnd = new Date(T0 + 3*HOUR);
    const rows: OrderRow[] = [
      row('BCH', 'buy',  100, 1, T0+1*HOUR),
      row('BCH', 'sell', 105, 1, T0+1.5*HOUR),
      row('BCH', 'buy',  108, 1, T0+2*HOUR),
      row('BCH', 'sell', 110, 1, T0+2.5*HOUR),
    ];
    const rep = await buildTradeReport({ rangeStart, rangeEnd, totalKRW: 1100, baselineKRW: 1000, rows });
    const msg = formatReportMessage(rep, 1100, 1000);
    expect(msg).toMatch(/거래 리포트 \(3h\)/);
    expect(msg).toMatch(/총 자산: ₩1,100/);
    expect(msg).toMatch(/\+10\.00%/);
    expect(msg).toMatch(/매수 2건/);
    expect(msg).toMatch(/매도 2건/);
    // candidates(sellPnl) 미전달 + 매도 존재 → LIFO 실현손익 한 줄로 축약된다.
    expect(msg).toMatch(/• 실현 손익: \+₩7/);
    expect(msg).toMatch(/회전매매: BCH/);
  });

  test('candidates.sellPnl 전달 시 — 매도 손익 상세 섹션 렌더', async () => {
    const rangeStart = new Date(T0);
    const rangeEnd = new Date(T0 + 3*HOUR);
    const rows: OrderRow[] = [
      row('BCH', 'buy',  100, 1, T0+1*HOUR),
      row('BCH', 'sell', 110, 1, T0+2*HOUR),
    ];
    const rep = await buildTradeReport({ rangeStart, rangeEnd, totalKRW: 1100, baselineKRW: 1000, rows });
    const msg = formatReportMessage(rep, 1100, 1000, {
      buyWatchlist: [],
      holdings: [],
      sellPnl: [
        { symbol: 'BCH', exitKind: 'target_profit', pnlPct: 10, pnlKRW: 10, sellAmountKRW: 110 },
        { symbol: 'XRP', exitKind: 'hard_stop',     pnlPct: -5, pnlKRW: -5, sellAmountKRW: 95 },
      ],
    });
    expect(msg).toMatch(/📉 매도 손익 \(총 \+₩5\)/);   // 10 + (-5)
    expect(msg).toMatch(/🔴 BCH \+₩10 \(\+10\.00%\) \[익절\]/);
    // fmtKRW 는 음수에 U+2212 MINUS SIGN(−)을 쓴다 (ASCII 하이픈 아님)
    expect(msg).toMatch(/🔵 XRP −₩5 \(-5\.00%\) \[손절\]/);
    // 상세 섹션이 나오면 축약 줄은 나오지 않는다
    expect(msg).not.toMatch(/• 실현 손익:/);
  });

  test('baseline 없을 때 — 스냅샷 없음 표시', async () => {
    const rangeStart = new Date(T0);
    const rangeEnd = new Date(T0 + HOUR);
    const rep = await buildTradeReport({ rangeStart, rangeEnd, totalKRW: 1000, baselineKRW: null, rows: [] });
    const msg = formatReportMessage(rep, 1000, null);
    expect(msg).toMatch(/스냅샷 없음/);
    expect(msg).toMatch(/\*매도 없음\*/);
  });
});

function funnel(overrides: Partial<EvalFunnelSummary> = {}): EvalFunnelSummary {
  return {
    market: 'domestic',
    rangeStart: new Date(T0),
    rangeEnd: new Date(T0 + 3 * HOUR),
    runs: 78,
    fullEvalRuns: 2,
    symbolsEvaluated: 72,
    buySignals: 1,
    sellSignals: 0,
    steps: [
      { key: 'evaluated', label: '평가 종목', count: 72, pctOfPrev: null },
      { key: 'fired', label: '룰 발화', count: 9, pctOfPrev: 12.5 },
      { key: 'guard', label: '가드 통과', count: 6, pctOfPrev: 66.7 },
      { key: 'prefilter', label: '프리필터 통과', count: 4, pctOfPrev: 66.7 },
      { key: 'ai', label: 'AI 통과', count: 1, pctOfPrev: 25 },
      { key: 'signal', label: '시그널', count: 1, pctOfPrev: 100 },
    ],
    bottlenecks: [
      { gate: 'rule_no_fire', label: '룰 미발화', count: 63 },
      { gate: 'cooldown_rebuy', label: '재매수 쿨다운', count: 4 },
      { gate: 'ai_low_confidence', label: 'AI 신뢰도 미달', count: 3 },
    ],
    anomalies: [{ label: 'AI 배치 실패', count: 2 }],
    neutralPct: 41,
    ...overrides,
  };
}

describe('formatFunnelSection', () => {
  test('T-002 §4 포맷 예시 — 헤더·단계·병목·이상 배너 모두 렌더', () => {
    const msg = formatFunnelSection(funnel());
    expect(msg).toMatch(/📊 평가 깔때기 — 국내장/);
    expect(msg).toMatch(/런 78회\(풀평가 2회\) · 종목 72개 평가/);
    expect(msg).toMatch(/룰 발화 9 → 가드 통과 6 → 프리필터 통과 4 → AI 통과 1 → ✅ 시그널 1건 \(매수 1\)/);
    expect(msg).toMatch(/병목: 룰 미발화 63\/72종목 \(88%\) · 2위 재매수 쿨다운 4건 · 3위 AI 신뢰도 미달 3건/);
    expect(msg).toMatch(/⚠ 이상: AI 배치 실패 2회 · neutral 상태 41% \(30m 룰 전체 비활성\)/);
  });

  test('풀평가 == 런 총수면 괄호 생략', () => {
    const msg = formatFunnelSection(funnel({ runs: 2, fullEvalRuns: 2 }));
    expect(msg).toMatch(/런 2회 · 종목/);
    expect(msg).not.toMatch(/풀평가/);
  });

  test('시그널 0건이면 매수/매도 상세 생략', () => {
    const base = funnel();
    const msg = formatFunnelSection({
      ...base,
      buySignals: 0,
      sellSignals: 0,
      steps: base.steps.map(s => s.key === 'signal' ? { ...s, count: 0 } : s),
    });
    expect(msg).toMatch(/✅ 시그널 0건$/m);
  });

  test('이상·neutral 모두 없으면 이상 배너 줄 생략', () => {
    const msg = formatFunnelSection(funnel({ anomalies: [], neutralPct: 0 }));
    expect(msg).not.toMatch(/⚠ 이상/);
  });

  test('formatReportMessage에 funnel 전달 시 섹션 포함, 미전달 시 생략', async () => {
    const rangeStart = new Date(T0);
    const rangeEnd = new Date(T0 + HOUR);
    const rep = await buildTradeReport({ rangeStart, rangeEnd, totalKRW: 1000, baselineKRW: null, rows: [] });
    const withFunnel = formatReportMessage(rep, 1000, null, undefined, funnel());
    expect(withFunnel).toMatch(/📊 평가 깔때기 — 국내장/);
    const withoutFunnel = formatReportMessage(rep, 1000, null);
    expect(withoutFunnel).not.toMatch(/평가 깔때기/);
  });
});
