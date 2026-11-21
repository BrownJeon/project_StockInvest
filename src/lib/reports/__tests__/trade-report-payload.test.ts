/**
 * T-182 — 보관 payload 조립(`buildReportPayload`)·매도 신호 체결 여부(`fetchSignalCandidates`)·리서치 실패 표지.
 *
 *  - payload 는 발송 시점 라벨·기존 포맷터 문구(앞 장식 제거)를 그대로 담는다 — 새 계산을 하지 않는다
 *  - 매도 신호 행은 연결 주문이 `filled` 일 때만 체결로 본다(주문 없음·취소·거부 = 미체결)
 *  - 리서치 조회 실패는 **같은 상수 객체**(`EMPTY_RESEARCH_DIGEST`)를 돌려준다 — 크론이 `===` 로 실패를 구분한다
 */
type QueryImpl = (sql: string, params?: unknown[]) => Promise<unknown>;
let queryImpl: QueryImpl;

jest.mock('@/lib/db', () => ({
  getPool: () => ({ query: (sql: string, params?: unknown[]) => queryImpl(sql, params) }),
}));
jest.mock('@/lib/exchanges/kis', () => ({
  getKisTickers: async () => [],
  getKisOverseasTickers: async () => [],
}));
const latestResults = jest.fn();
jest.mock('@/lib/research/storage', () => ({ getLatestResearchResults: () => latestResults() }));

import { PRECURSOR_NOTE } from '@/lib/research/pattern/precursor-analysis';
import { toDisplayAmount } from '@/lib/display-amount';
import type { PriceTargets } from '@/lib/research/types';
import {
  buildReportPayload,
  fetchResearchDigest,
  fetchSignalCandidates,
  EMPTY_RESEARCH_DIGEST,
  type HoldingStatus,
  type ResearchDigest,
  type TradeReport,
} from '../trade-report';
import { formatReportSummary, summaryToPlain } from '../trade-report-view';

const rows = (r: unknown[]): Promise<unknown> => Promise.resolve([r, []]);

let warnSpy: jest.SpyInstance;
beforeEach(() => {
  queryImpl = () => rows([]);
  latestResults.mockReset();
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warnSpy.mockRestore());

function chartTargets(over: Partial<PriceTargets> = {}): PriceTargets {
  return {
    asOfDate: '2026-11-19', asOfPrice: 203_700, currency: 'KRW',
    atr14: 3_000, expectedMove: 3_000 * Math.sqrt(10),
    buyZone: { price: 198_000, basis: '볼린저 하단(20,2)' },
    sellTarget: { price: 208_000, basis: '최근 60거래일 고점' },
    buyReachable: true, sellReachable: true,
    horizonDays: 14, horizonTradingDays: 10,
    ...over,
  };
}

function holding(over: Partial<HoldingStatus> = {}): HoldingStatus {
  return {
    symbol: '005930', profitPct: -1.8, entryKRW: 100_000, currentKRW: 101_000, qty: 10,
    investedKRW: 1_000_000, periodStartKRW: null, nowPriceKRW: null, periodChangePct: null,
    sellSignal: { action: 'hold', daysSinceEntry: 22, gainPct: 1.2, reason: 'in_progress', horizonDays: 14, note: PRECURSOR_NOTE },
    priceTargets: chartTargets(),
    display: { invested: toDisplayAmount(1_000_000, 'KRW', null) },
    market: 'domestic',
    ...over,
  };
}

const REPORT: TradeReport = {
  rangeStart: new Date('2026-11-18T23:04:00Z'), rangeEnd: new Date('2026-11-19T23:04:00Z'),
  buys: 0, sells: 0, buysAmountKRW: 0, sellsAmountKRW: 0, headerPnlKRW: 0, lifoPnlKRW: 0,
  unmatchedSellCount: 0, matchedSellCount: 0, perSymbol: [], churnSymbols: ['000660'],
};

const DIGEST: ResearchDigest = {
  trackedCount: 3, activeCount: 1, note: PRECURSOR_NOTE,
  items: [{
    symbol: 'NAS:SNPS', market: 'overseas', asOfDate: '2026-11-19', targets: chartTargets({ currency: 'USD', buyZone: { price: 423.57, basis: '볼린저 하단(20,2)' } }),
    buy: { action: 'buy', ruleId: 'r', ruleLabel: '누적낙폭 > 15%', precision: 0.24, lift: 4.31, triggerCount: 135, confidence: 'high', downgradeReason: null, note: PRECURSOR_NOTE },
  }],
};

describe('buildReportPayload', () => {
  const labels = new Map([['005930', '삼성전자'], ['NAS:SNPS', 'SYNOPSYS INC'], ['000660', 'SK하이닉스']]);
  const payload = buildReportPayload({
    report: REPORT, totalKRW: 12_000_000, baselineKRW: 12_500_000,
    candidates: {
      buyWatchlist: [{ symbol: '000660', rsi: null, aiConf: null, evPct: null, status: 'blocked', skipReason: 'portfolio_guard' }],
      holdings: [holding()],
      sellPnl: [{ symbol: '005930', exitKind: 'eod_loss_cut', pnlPct: -22.94, pnlKRW: -709_800, sellAmountKRW: 2_384_200, signalId: 77, signalAt: '2026-11-19T06:20:00.000Z', filled: false }],
    },
    research: DIGEST, labels,
    coverage: { asset: 'ok', holdings: 'ok', candidates: 'ok', research: 'ok', signals: 'ok' },
  });

  test('발송 시점 라벨·기간·자산·체결 값을 그대로 담는다', () => {
    expect(payload.schemaVersion).toBe(1);
    expect(payload.rangeStart).toBe('2026-11-18T23:04:00.000Z');
    expect(payload.asset).toEqual({ totalKRW: 12_000_000, baselineKRW: 12_500_000 });
    expect(payload.trade.churnSymbols).toEqual([{ symbol: '000660', name: 'SK하이닉스' }]);
    expect(payload.sellSignals[0]).toEqual({
      symbol: '005930', name: '삼성전자', signalId: 77, exitKind: 'eod_loss_cut', pnlPct: -22.94, pnlKRW: -709_800,
      signalAt: '2026-11-19T06:20:00.000Z', filled: false,
    });
    expect(payload.candidates[0]).toMatchObject({ name: 'SK하이닉스', status: 'blocked', skipReason: 'portfolio_guard' });
  });

  test('보유 문구는 기존 포맷터 결과에서 앞 장식만 뗀다(새 계산 없음)', () => {
    const h = payload.holdings[0];
    expect(h).toMatchObject({ name: '삼성전자', market: 'domestic', qty: 10, profitPct: -1.8, holdingDays: 22, sellAction: 'hold' });
    expect(h.investedText).toBe('₩1,000,000');
    expect(h.sellJudgeText).toBe('관망 — 매도 목표가 ₩208,000 (최근 60거래일 고점), 14일 이내');
    expect(h.holdingInfoText).toBe('보유 22일째 · 진입가 대비 +1.2% (참고 정보)');
  });

  test('리서치 근거·가격 문구(부등호는 전각 — 기존 규칙)', () => {
    const r = payload.research.items[0];
    expect(r).toMatchObject({ name: 'SYNOPSYS INC', market: 'overseas', action: 'buy', triggerCount: 135 });
    expect(r.evidenceText).toBe('누적낙폭 ＞ 15% — 과거 적중률 24%(135건 중 32건), lift ×4.31, 표본 신뢰도 높음');
    expect(r.priceText).toBe('매수 희망가 $423.57 (볼린저 하단(20,2)), 14일 이내');
    expect(payload.research.note).toBe(PRECURSOR_NOTE);
  });

  test('이 payload 로 만든 요약: 손절 임박·미체결 신호·회전매매·전부 차단, 해외명은 첫 단어', () => {
    const s = formatReportSummary(payload);
    expect(s.warnings.map((w) => w.kind)).toEqual(['stop_near', 'sell_unfilled', 'churn', 'candidates_blocked']);
    expect(summaryToPlain(s.lines)).toContain('🔬 매수 고려 1종목 (리서치 참고용): SYNOPSYS');
  });

  test('보유 market 이 없거나 손상되면 심볼 형식으로 판정', () => {
    const p = buildReportPayload({
      report: REPORT, totalKRW: null, baselineKRW: null,
      candidates: { buyWatchlist: [], sellPnl: [], holdings: [holding({ symbol: 'NAS:MU', market: undefined, investedKRW: 0 })] },
      research: EMPTY_RESEARCH_DIGEST,
      coverage: { asset: 'failed', holdings: 'ok', candidates: 'ok', research: 'failed', signals: 'ok' },
    });
    expect(p.holdings[0].market).toBe('overseas');
    expect(p.holdings[0].investedText).toBeNull();          // 투자금 0 → 「데이터 없음」은 화면이 쓴다
    expect(p.holdings[0].name).toBe('NAS:MU');             // 라벨 없으면 심볼
  });
});

describe('fetchSignalCandidates — 매도 신호 체결 여부(T-182)', () => {
  test('연결 주문이 filled 일 때만 체결, 주문 없음·취소는 미체결 · 신호 id·시각을 싣는다', async () => {
    queryImpl = (sql) => {
      if (/s\.side = 'sell'/.test(sql)) {
        expect(sql).toMatch(/o\.status AS order_status/);
        return rows([
          { signal_id: 5, signal_at: new Date('2026-11-19T06:20:00Z'), order_status: 'filled', symbol: '005930', exit_kind: 'hard_stop', pnl_pct: '-2.0', entry_price: '100', current_price: '98', sell_amount_krw: '980', quantity: '10' },
          { signal_id: 6, signal_at: new Date('2026-11-19T06:21:00Z'), order_status: 'cancelled', symbol: '005930', exit_kind: 'eod_loss_cut', pnl_pct: '-22.94', entry_price: '100', current_price: '77', sell_amount_krw: '770', quantity: '10' },
          { signal_id: 7, signal_at: null, order_status: null, symbol: '000660', exit_kind: 'ai_sell', pnl_pct: '1.0', entry_price: null, current_price: null, sell_amount_krw: null, quantity: null },
        ]);
      }
      return rows([]);
    };
    const c = await fetchSignalCandidates();
    expect(c.sellPnl.map((x) => [x.signalId, x.filled, x.signalAt])).toEqual([
      [5, true, '2026-11-19T06:20:00.000Z'],
      [6, false, '2026-11-19T06:21:00.000Z'],
      [7, false, null],
    ]);
    // 손익 계산은 그대로(기존 규칙): (매도금액 − 진입가 × 수량)
    expect(c.sellPnl[1].pnlKRW).toBe(770 - 1000);
  });

  test('보유 행에 position_state.market 을 싣는다', async () => {
    queryImpl = (sql) => {
      if (/FROM position_state/.test(sql)) {
        return rows([{ symbol: 'NAS:MU', market: 'overseas', entry_price: '100', peak_price: '110', qty: '1', first_seen_at: null, profit_pct: '10' }]);
      }
      return rows([]);
    };
    const c = await fetchSignalCandidates();
    expect(c.holdings[0].market).toBe('overseas');
  });
});

describe('fetchResearchDigest — 실패 표지', () => {
  test('조회가 실패하면 EMPTY_RESEARCH_DIGEST **그 객체**를 돌려준다(크론이 === 로 실패 판정)', async () => {
    latestResults.mockRejectedValue(new Error('db down'));
    expect(await fetchResearchDigest()).toBe(EMPTY_RESEARCH_DIGEST);
  });

  test('추적 0종목(정상)은 다른 객체 — 실패로 보지 않는다', async () => {
    latestResults.mockResolvedValue({ tracked: [], results: [] });
    const d = await fetchResearchDigest();
    expect(d).not.toBe(EMPTY_RESEARCH_DIGEST);
    expect(d.trackedCount).toBe(0);
  });
});
