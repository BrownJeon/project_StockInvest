import {
  computeLifoPnl,
  buildTradeReport,
  formatReportMessage,
  collectReportSymbols,
  EMPTY_RESEARCH_DIGEST,
  type HoldingStatus,
  type OrderRow,
  type ResearchDigest,
  type TradeReport,
} from '../trade-report';
import { PRECURSOR_NOTE } from '@/lib/research/pattern/precursor-analysis';

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


// ─── T-033 — 리포트 개선(투자금액·주기변동·한글명·리서치 요약) ────────────────

function holding(over: Partial<HoldingStatus> = {}): HoldingStatus {
  return {
    symbol: '000660',
    profitPct: 3.2,
    entryKRW: 198_000,
    currentKRW: 204_000,
    qty: 10,
    investedKRW: 1_980_000,
    periodStartKRW: 200_000,
    nowPriceKRW: 203_700,
    periodChangePct: 1.85,
    sellSignal: null,
    avgRallyPct: 18,
    ...over,
  };
}

function digest(over: Partial<ResearchDigest> = {}): ResearchDigest {
  return {
    trackedCount: 8,
    activeCount: 1,
    items: [{
      symbol: 'NAS:MU',
      market: 'overseas',
      asOfDate: '2026-08-20',
      buy: {
        action: 'buy',
        ruleId: 'rsi_lt_30',
        ruleLabel: 'RSI14 < 30 (과매도)',
        precision: 0.625,
        lift: 2.1,
        triggerCount: 40,
        confidence: 'high',
        note: PRECURSOR_NOTE,
      },
    }],
    note: PRECURSOR_NOTE,
    ...over,
  };
}

async function emptyReport(): Promise<TradeReport> {
  return buildTradeReport({
    rangeStart: new Date(T0), rangeEnd: new Date(T0 + HOUR),
    totalKRW: 1000, baselineKRW: null, rows: [],
  });
}

describe('formatReportMessage — 보유 현황 (T-033)', () => {
  test('"고점대비"와 "최근추이"를 라벨로 구분해 표기한다', async () => {
    const rep = await emptyReport();
    const msg = formatReportMessage(rep, 1000, null, { buyWatchlist: [], holdings: [holding()], sellPnl: [] });
    expect(msg).toMatch(/고점대비 \+3\.20%/);
    expect(msg).toMatch(/최근추이 \+1\.85%/);
  });

  test('🔴 "익절 임박" 문구는 더 이상 출력되지 않는다 (고점대비 값 오독 재발 방지)', async () => {
    const rep = await emptyReport();
    const msg = formatReportMessage(rep, 1000, null, {
      buyWatchlist: [], sellPnl: [],
      holdings: [holding({ profitPct: 9.9 })],   // 예전이면 "익절 임박"이 붙던 구간
    });
    expect(msg).not.toMatch(/익절 임박/);
  });

  test('손절 임박 경고는 유지된다', async () => {
    const rep = await emptyReport();
    const msg = formatReportMessage(rep, 1000, null, {
      buyWatchlist: [], sellPnl: [], holdings: [holding({ profitPct: -3 })],
    });
    expect(msg).toMatch(/손절 임박/);
  });

  test('종목별 투자금액을 표기한다', async () => {
    const rep = await emptyReport();
    const msg = formatReportMessage(rep, 1000, null, { buyWatchlist: [], holdings: [holding()], sellPnl: [] });
    expect(msg).toMatch(/└ 투자금 ₩1,980,000/);
  });

  test('baseline·현재가가 없으면 조용히 생략하지 않고 "데이터 없음"을 명시한다', async () => {
    const rep = await emptyReport();
    const msg = formatReportMessage(rep, 1000, null, {
      buyWatchlist: [], sellPnl: [],
      holdings: [holding({ periodStartKRW: null, nowPriceKRW: null, periodChangePct: null, investedKRW: 0 })],
    });
    expect(msg).toMatch(/최근추이 데이터 없음/);
    expect(msg).toMatch(/투자금 데이터 없음/);
  });

  test('매도 고려 — 목표 대비 진행률과 보유일수를 함께 보여준다', async () => {
    const rep = await emptyReport();
    const msg = formatReportMessage(rep, 1000, null, {
      buyWatchlist: [], sellPnl: [],
      holdings: [holding({
        sellSignal: {
          action: 'sell', daysSinceEntry: 12, gainPct: 14.76,
          reason: 'target_reached', note: PRECURSOR_NOTE,
        },
      })],
    });
    expect(msg).toMatch(/🔬 매도 고려 — 목표\(과거평균 \+18\.0%\) 대비 82% 진행, 보유 12일째/);
  });

  test('표본부족이면 매도 추천 대신 "판단 보류"를 보여준다', async () => {
    const rep = await emptyReport();
    const msg = formatReportMessage(rep, 1000, null, {
      buyWatchlist: [], sellPnl: [],
      holdings: [holding({
        sellSignal: { action: 'insufficient_data', daysSinceEntry: 3, gainPct: 1, reason: null, note: PRECURSOR_NOTE },
      })],
    });
    expect(msg).toMatch(/🔬 판단 보류 \(리서치 표본부족\)/);
    expect(msg).not.toMatch(/매도 고려/);
  });

  test('sellSignal 이 없으면 리서치 줄 자체가 없다', async () => {
    const rep = await emptyReport();
    const msg = formatReportMessage(rep, 1000, null, { buyWatchlist: [], holdings: [holding()], sellPnl: [] });
    expect(msg).not.toMatch(/🔬/);
  });
});

describe('formatReportMessage — 한글 종목명 (T-033)', () => {
  test('labels 를 넘기면 보유·매수후보·매도손익·리서치 전부 한글명으로 표기된다', async () => {
    const rep = await emptyReport();
    const labels = new Map([['000660', 'SK하이닉스'], ['NAS:MU', '마이크론'], ['005930', '삼성전자']]);
    const msg = formatReportMessage(
      rep, 1000, null,
      {
        holdings: [holding()],
        buyWatchlist: [{ symbol: '005930', rsi: 28, aiConf: null, evPct: null, status: 'watchlist', skipReason: null }],
        sellPnl: [{ symbol: '005930', exitKind: 'target_profit', pnlPct: 3, pnlKRW: 1000, sellAmountKRW: 10000 }],
      },
      digest(),
      labels,
    );
    expect(msg).toMatch(/SK하이닉스 고점대비/);
    expect(msg).toMatch(/🔴 삼성전자 \+₩1,000/);
    expect(msg).toMatch(/삼성전자 RSI 28\.0/);
    expect(msg).toMatch(/📈 마이크론 — 매수 고려/);
    expect(msg).not.toMatch(/000660/);
  });

  test('labels 미전달 시 기존처럼 심볼 코드가 그대로 나온다(하위호환)', async () => {
    const rep = await emptyReport();
    const msg = formatReportMessage(rep, 1000, null, { buyWatchlist: [], holdings: [holding()], sellPnl: [] });
    expect(msg).toMatch(/000660 고점대비/);
  });
});

describe('formatReportMessage — 리서치분석 요약 (T-033)', () => {
  test('평가 깔때기 섹션은 더 이상 렌더되지 않는다', async () => {
    const rep = await emptyReport();
    const msg = formatReportMessage(rep, 1000, null, undefined, digest());
    expect(msg).not.toMatch(/평가 깔때기/);
  });

  test('research 미전달이면 섹션 자체가 없다', async () => {
    const rep = await emptyReport();
    expect(formatReportMessage(rep, 1000, null)).not.toMatch(/리서치분석 요약/);
  });

  test('매수 고려 — 근거를 "과거 적중률"로 표기하고 "확률"이라는 말을 쓰지 않는다', async () => {
    const rep = await emptyReport();
    const msg = formatReportMessage(rep, 1000, null, undefined, digest());
    expect(msg).toMatch(/🔬 리서치분석 요약 \(참고용\)/);
    expect(msg).toMatch(/추적 8종목 중 매수 고려 1종목/);
    expect(msg).toMatch(/📈 NAS:MU — 매수 고려 \(2026-08-20 종가 기준\)/);
    // 부등호는 전각(＜)으로 치환된다 — 슬랙 링크 오해석·텔레그램 이중 escape 를 동시에 피한다
    expect(msg).toMatch(/근거: RSI14 ＜ 30 \(과매도\) — 과거 적중률 63%\(40건 중 25건\), lift ×2\.10, 표본 신뢰도 높음/);
    expect(msg).not.toMatch(/확률/);
    expect(msg).not.toMatch(/[<>]/);
  });

  test('표본부족 종목은 "판단 보류"로 강등되고 트리거 건수를 보여준다', async () => {
    const rep = await emptyReport();
    const msg = formatReportMessage(rep, 1000, null, undefined, digest({
      activeCount: 0,
      items: [{
        symbol: '005930', market: 'domestic', asOfDate: '2026-08-20',
        buy: {
          action: 'insufficient_data', ruleId: 'rsi_lt_30', ruleLabel: 'RSI14 < 30 (과매도)',
          precision: 0.5, lift: 1.2, triggerCount: 4, confidence: null, note: PRECURSOR_NOTE,
        },
      }],
    }));
    expect(msg).toMatch(/⚪ 005930 — 판단 보류 \(표본부족, 트리거 4건\)/);
    expect(msg).not.toMatch(/매수 고려 \(/);
  });

  test('면책 문구가 항상 붙는다', async () => {
    const rep = await emptyReport();
    expect(formatReportMessage(rep, 1000, null, undefined, digest())).toContain(PRECURSOR_NOTE);
  });

  test('추적 0종목 / 활성 0종목도 조용히 생략하지 않고 명시한다', async () => {
    const rep = await emptyReport();
    expect(formatReportMessage(rep, 1000, null, undefined, EMPTY_RESEARCH_DIGEST))
      .toMatch(/추적 중인 종목이 없습니다/);
    expect(formatReportMessage(rep, 1000, null, undefined, digest({ activeCount: 0, items: [] })))
      .toMatch(/기준일 종가에서 조건을 충족한 종목이 없습니다/);
  });

  test('기준일이 없으면 "기준일 데이터 없음" — 실시간으로 오인시키지 않는다', async () => {
    const rep = await emptyReport();
    const msg = formatReportMessage(rep, 1000, null, undefined, digest({
      items: [{ ...digest().items[0], asOfDate: null }],
    }));
    expect(msg).toMatch(/기준일 데이터 없음/);
  });
});

describe('collectReportSymbols (T-033)', () => {
  test('리포트에 등장하는 모든 심볼을 중복 없이 모은다', async () => {
    const rangeStart = new Date(T0);
    const rep = await buildTradeReport({
      rangeStart, rangeEnd: new Date(T0 + 8 * HOUR), totalKRW: 1000, baselineKRW: null,
      rows: [
        row('BCH', 'buy', 100, 1, T0 + 1 * HOUR), row('BCH', 'sell', 105, 1, T0 + 2 * HOUR),
        row('BCH', 'buy', 108, 1, T0 + 3 * HOUR), row('BCH', 'sell', 110, 1, T0 + 4 * HOUR),
      ],
    });
    const symbols = collectReportSymbols(
      rep,
      {
        holdings: [holding()],
        buyWatchlist: [{ symbol: '005930', rsi: null, aiConf: null, evPct: null, status: 'watchlist', skipReason: null }],
        sellPnl: [{ symbol: '000660', exitKind: 'ai_sell', pnlPct: 0, pnlKRW: 0, sellAmountKRW: 0 }],
      },
      digest(),
    );
    expect(symbols.sort()).toEqual(['000660', '005930', 'BCH', 'NAS:MU'].sort());
  });

  test('candidates·research 가 없어도 던지지 않는다', async () => {
    const rep = await emptyReport();
    expect(collectReportSymbols(rep)).toEqual([]);
    expect(collectReportSymbols(rep, null, null)).toEqual([]);
  });
});
