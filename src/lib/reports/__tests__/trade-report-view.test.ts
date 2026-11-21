/**
 * T-182 — 거래 리포트 요약(텔레그램)·화면 공용 순수 모듈.
 *
 * 고정하는 것(설계 6항):
 *  - 기본(확인 필요 2건) · 확인 필요 0건 · 총자산 조회 불가 · 체결 있음 · 매도 신호 미체결/체결
 *  - 해외 종목명 축약(첫 단어·ETF 티커·3자 이하·충돌 티커, 한글·국내 그대로)
 *  - 확인 필요가 줄 수 목표보다 우선(전부 나간다) · 「매도 손익」이라는 말을 쓰지 않는다
 *  - 링크 URL(https 검사·id 검사) · 홈 쿼리 이동 판정 · id 형식 · payload 읽기
 */
import {
  REPORT_PAYLOAD_SCHEMA_VERSION,
  buildShortNamer,
  computeReportWarnings,
  formatReportSummary,
  initiallyOpenSections,
  parseReportId,
  parseReportPayload,
  realizedPnlText,
  reportLinkUrl,
  reportRedirectTarget,
  summaryToMrkdwn,
  summaryToPlain,
  summaryToTelegramHtml,
  type ReportHolding,
  type TradeReportPayload,
} from '../trade-report-view';

const NOW = '2026-11-19T23:04:00.000Z';        // 11/20 08:04 KST
const START = '2026-11-18T23:04:00.000Z';      // 24시간 전

function holding(p: Partial<ReportHolding> & { symbol: string; name: string }): ReportHolding {
  return {
    market: p.symbol.includes(':') ? 'overseas' : 'domestic',
    qty: 1, profitPct: 1, periodChangePct: null, investedKRW: 1000, investedText: '₩1,000',
    sellAction: null, sellJudgeText: null, holdingInfoText: null, holdingDays: null,
    ...p,
  };
}

/** 11/20 리포트와 같은 구조(값은 예시) — 데모 v1 「기본」 */
function basePayload(over: Partial<TradeReportPayload> = {}): TradeReportPayload {
  return {
    schemaVersion: REPORT_PAYLOAD_SCHEMA_VERSION,
    rangeStart: START,
    rangeEnd: NOW,
    coverage: { asset: 'ok', holdings: 'ok', candidates: 'ok', research: 'ok', signals: 'ok' },
    asset: { totalKRW: 12_480_000, baselineKRW: 12_950_000 },
    trade: { buys: 0, buysAmountKRW: 0, sells: 0, sellsAmountKRW: 0, lifoPnlKRW: 0, matchedSellCount: 0, unmatchedSellCount: 0, churnSymbols: [] },
    sellSignals: [
      { symbol: '005930', name: '삼성전자', signalId: 11, exitKind: 'eod_loss_cut', pnlPct: -21.4, pnlKRW: -412_000, signalAt: START, filled: false },
      { symbol: '005930', name: '삼성전자', signalId: 12, exitKind: 'eod_loss_cut', pnlPct: -17.6, pnlKRW: -338_000, signalAt: START, filled: false },
    ],
    holdings: [
      holding({ symbol: 'NAS:MU', name: 'MICRON TECHNOLOGY INC', profitPct: 2.6, sellAction: 'insufficient_data' }),
      holding({ symbol: 'NAS:NVDA', name: 'NVIDIA CORP', profitPct: 1.4 }),
      holding({ symbol: 'NYS:CVX', name: 'CHEVRON CORPORATION', profitPct: 1.2 }),
      holding({ symbol: 'NAS:SMH', name: 'VANECK ETF TR SEMICONDUCTOR ETF', profitPct: 0.9 }),
      holding({ symbol: 'NYS:ORCL', name: 'ORACLE CORP', profitPct: -0.7 }),
      holding({ symbol: '005930', name: '삼성전자', profitPct: -1.1 }),
    ],
    candidates: ['한화', '현대글로비스', '스피어'].map((n, i) => ({
      symbol: `00000${i}`, name: n, status: 'blocked' as const, skipReason: 'portfolio_guard', rsi: null, evPct: null, aiConf: null,
    })),
    research: {
      trackedCount: 5, activeCount: 4, note: '면책 문구',
      items: [
        { symbol: '207940', name: '삼성바이오로직스', market: 'domestic', asOfDate: '2026-11-20', action: 'buy', triggerCount: 70, evidenceText: '근거', priceText: '가격' },
        { symbol: '005930', name: '삼성전자', market: 'domestic', asOfDate: '2026-11-20', action: 'buy', triggerCount: 110, evidenceText: null, priceText: null },
        { symbol: 'NAS:SNPS', name: 'SYNOPSYS INC', market: 'overseas', asOfDate: '2026-11-19', action: 'buy', triggerCount: 140, evidenceText: null, priceText: null },
        { symbol: 'NAS:MU', name: 'MICRON TECHNOLOGY INC', market: 'overseas', asOfDate: '2026-11-19', action: 'buy', triggerCount: 140, evidenceText: null, priceText: null },
      ],
    },
    ...over,
  };
}

const plainOf = (p: TradeReportPayload, test = false) => {
  const s = formatReportSummary(p, { test });
  return { ...s, text: summaryToPlain(s.lines) };
};

describe('formatReportSummary — 기본(데모 v1)', () => {
  test('제목: 시각·기간·확인 건수, 본문은 데모 순서(총자산 → 체결 → 확인 필요 → 보유 → 리서치)', () => {
    const s = plainOf(basePayload());
    expect(s.title).toBe('거래 리포트 · 11/20 08:04 (최근 24시간) · ⚠️ 확인 2');
    expect(s.text.split('\n')).toEqual([
      '💰 총자산 ₩12,480,000  (−3.63%, −₩470,000)',
      '🔁 체결 없음 (매수 0 · 매도 0)',
      '',
      '⚠️ 확인 필요 2',
      '• 삼성전자 매도 신호 2건 미체결 (마감손절 · 신호 기준 −₩750,000)',
      '• 매수 후보 3종목 전부 차단 (포트폴리오 보호)',
      '',
      '📦 보유 6종목 — 손절 임박 0 · 매도 고려 0',
      '🔬 매수 고려 4종목 (리서치 참고용): 삼성바이오로직스 · 삼성전자 · SYNOPSYS · MICRON',
    ]);
  });

  test('본문 첫 줄 「📊 거래 리포트」·「🕐 분석 기간」은 없다(제목과 중복) · 「매도 손익」이라는 말을 쓰지 않는다', () => {
    const { text } = plainOf(basePayload());
    expect(text).not.toContain('📊');
    expect(text).not.toContain('분석 기간');
    expect(text).not.toContain('매도 손익');
  });

  test('force 시험 발송은 제목 앞에 [테스트]', () => {
    expect(plainOf(basePayload(), true).title.startsWith('[테스트] 거래 리포트 · ')).toBe(true);
  });

  test('텔레그램 HTML: 확인 필요 머리만 굵게, 이름의 & < > 는 이스케이프', () => {
    const p = basePayload({
      sellSignals: [{ symbol: '000001', name: 'A&B<C>', signalId: 1, exitKind: 'hard_stop', pnlPct: -2, pnlKRW: -100, signalAt: null, filled: false }],
      candidates: [],
    });
    const html = summaryToTelegramHtml(formatReportSummary(p).lines);
    expect(html).toContain('<b>⚠️ 확인 필요 1</b>');
    expect(html).toContain('• A&amp;B&lt;C&gt; 매도 신호 1건 미체결 (손절 · 신호 기준 −₩100)');
    expect(summaryToMrkdwn(formatReportSummary(p).lines)).toContain('*⚠️ 확인 필요 1*');
  });
});

describe('확인 필요 0건 · 총자산 조회 불가', () => {
  test('0건이면 「✅ 확인 필요 없음」 한 줄, 제목에 건수 없음', () => {
    const p = basePayload({ sellSignals: [], candidates: [] });
    const s = plainOf(p);
    expect(s.title).toBe('거래 리포트 · 11/20 08:04 (최근 24시간)');
    expect(s.text).toContain('\n\n✅ 확인 필요 없음\n\n');
    expect(s.warnings).toEqual([]);
    expect(initiallyOpenSections(s.warnings).size).toBe(0);
  });

  test('총자산 null → 「조회 불가 (기간 시작 ₩…)」, 0원·−100% 를 쓰지 않고 확인 필요 맨 위에 실패', () => {
    const p = basePayload({ asset: { totalKRW: null, baselineKRW: 12_950_000 }, coverage: { ...basePayload().coverage, asset: 'failed' } });
    const s = plainOf(p);
    expect(s.text.split('\n')[0]).toBe('💰 총자산 조회 불가 (기간 시작 ₩12,950,000)');
    expect(s.text).not.toMatch(/₩0\b|100\.00%/);
    expect(s.warnings[0].kind).toBe('asset_failed');
    expect(s.warnings[0].severity).toBe('e');
    expect(s.title.endsWith('⚠️ 확인 3')).toBe(true);
  });

  test('기간 시작 스냅샷이 없으면 그렇게 쓴다', () => {
    expect(plainOf(basePayload({ asset: { totalKRW: 1_000, baselineKRW: null } })).text.split('\n')[0])
      .toBe('💰 총자산 ₩1,000  (기간 시작 스냅샷 없음)');
  });
});

describe('체결·매도 신호', () => {
  test('체결 있음: 금액 줄 + 실현 손익 줄(원가 미상 규칙)', () => {
    const p = basePayload({
      trade: { buys: 1, buysAmountKRW: 100_000, sells: 2, sellsAmountKRW: 250_000, lifoPnlKRW: 12_345, matchedSellCount: 1, unmatchedSellCount: 1, churnSymbols: [] },
    });
    const lines = plainOf(p).text.split('\n');
    expect(lines[1]).toBe('🔁 체결 매수 1건 ₩100,000 · 매도 2건 ₩250,000');
    expect(lines[2]).toBe('   실현 손익 +₩12,345 (일부 원가 미상)');
  });

  test('realizedPnlText: 전부 원가 미상이면 숫자 대신 「원가 미상」', () => {
    expect(realizedPnlText({ lifoPnlKRW: 0, matchedSellCount: 0, unmatchedSellCount: 2 })).toBe('원가 미상');
    expect(realizedPnlText({ lifoPnlKRW: -500, matchedSellCount: 1, unmatchedSellCount: 0 })).toBe('−₩500');
  });

  test('체결된 매도 신호는 확인 필요에서 빠진다', () => {
    const p = basePayload({ sellSignals: basePayload().sellSignals.map((x) => ({ ...x, filled: true })) });
    expect(computeReportWarnings(p).some((w) => w.kind === 'sell_unfilled')).toBe(false);
  });

  test('종목이 다르면 종목별 한 줄, 종류는 중복 없이 이어 쓴다', () => {
    const p = basePayload({
      candidates: [],
      sellSignals: [
        { symbol: '005930', name: '삼성전자', signalId: 1, exitKind: 'eod_loss_cut', pnlPct: -1, pnlKRW: -100, signalAt: null, filled: false },
        { symbol: '005930', name: '삼성전자', signalId: 2, exitKind: 'hard_stop', pnlPct: -1, pnlKRW: -100, signalAt: null, filled: false },
        { symbol: '000660', name: 'SK하이닉스', signalId: 3, exitKind: 'trailing_stop', pnlPct: 1, pnlKRW: 300, signalAt: null, filled: false },
      ],
    });
    expect(computeReportWarnings(p).map((w) => w.tg)).toEqual([
      '삼성전자 매도 신호 2건 미체결 (마감손절, 손절 · 신호 기준 −₩200)',
      'SK하이닉스 매도 신호 1건 미체결 (트레일링 스탑 · 신호 기준 +₩300)',
    ]);
  });
});

describe('확인 필요 — 종류·순서·전부 표시', () => {
  test('모든 종류가 정해진 순서로, 줄 수 목표와 무관하게 전부 나간다', () => {
    const p = basePayload({
      asset: { totalKRW: null, baselineKRW: null },
      coverage: { asset: 'failed', holdings: 'ok', candidates: 'ok', research: 'failed', signals: 'ok' },
      holdings: [
        holding({ symbol: '005930', name: '삼성전자', profitPct: -1.8 }),
        holding({ symbol: 'NAS:ORCL', name: 'ORACLE CORP', profitPct: -2.5 }),
      ],
      trade: { ...basePayload().trade, churnSymbols: [{ symbol: '000660', name: 'SK하이닉스' }] },
    });
    const s = plainOf(p);
    expect(s.warnings.map((w) => w.kind)).toEqual(['asset_failed', 'stop_near', 'sell_unfilled', 'churn', 'candidates_blocked', 'section_failed']);
    expect(s.warnings[1].tg).toBe('손절 임박 2종목: ORACLE(고점대비 −2.50%) · 삼성전자(고점대비 −1.80%)');
    expect(s.warnings[5].tg).toBe('리서치 정보를 읽지 못함 — 0건이 아님');
    for (const w of s.warnings) expect(s.text).toContain(`• ${w.tg}`);
    // 리서치 조회 실패면 🔬 줄은 생략(0종목으로 쓰지 않는다)
    expect(s.text).not.toContain('🔬');
    expect(initiallyOpenSections(s.warnings)).toEqual(new Set(['r-hold', 'r-sell', 'r-trade', 'r-cand', 'r-res']));
  });

  test('보유·후보·신호 조회 실패 → 각 「…정보를 읽지 못함」, 보유 줄 생략', () => {
    const p = basePayload({
      coverage: { asset: 'ok', holdings: 'failed', candidates: 'failed', research: 'ok', signals: 'failed' },
      holdings: [], candidates: [], sellSignals: [],
    });
    const s = plainOf(p);
    expect(s.warnings.map((w) => w.tg)).toEqual([
      '보유 정보를 읽지 못함 — 0건이 아님',
      '매도 신호 정보를 읽지 못함 — 0건이 아님',
      '매수 후보 정보를 읽지 못함 — 0건이 아님',
    ]);
    expect(s.text).not.toContain('📦');
  });

  test('후보 차단 사유가 섞이면 「사유 여러 가지」, 하나라도 대기면 전부 차단이 아니다', () => {
    const c = basePayload().candidates;
    const mixed = basePayload({ sellSignals: [], candidates: [{ ...c[0], skipReason: 'ai_failed' }, c[1]] });
    expect(computeReportWarnings(mixed)[0].tg).toBe('매수 후보 2종목 전부 차단 (사유 여러 가지)');
    const notAll = basePayload({ sellSignals: [], candidates: [{ ...c[0], status: 'watchlist' }, c[1]] });
    expect(computeReportWarnings(notAll)).toEqual([]);
  });

  test('보유 0종목은 「📦 보유 없음」, 매도 고려는 리서치 판단 sell 수', () => {
    expect(plainOf(basePayload({ holdings: [] })).text).toContain('📦 보유 없음');
    const p = basePayload({ holdings: [holding({ symbol: '005930', name: '삼성전자', sellAction: 'sell' })] });
    expect(plainOf(p).text).toContain('📦 보유 1종목 — 손절 임박 0 · 매도 고려 1');
  });
});

describe('해외 종목명 축약', () => {
  test('첫 단어 · ETF/TR 은 티커 · 3자 이하는 티커 · 한글/국내는 그대로', () => {
    const short = buildShortNamer([
      { symbol: 'NAS:MU', name: 'MICRON TECHNOLOGY INC' },
      { symbol: 'NAS:SNPS', name: 'SYNOPSYS INC' },
      { symbol: 'NAS:SMH', name: 'VANECK ETF TR SEMICONDUCTOR ETF' },
      { symbol: 'NYS:XYZ', name: 'ABC HOLDINGS' },
      { symbol: 'NYS:GLD', name: 'SPDR GOLD TRUST' },
      { symbol: '034730', name: 'SK' },
      { symbol: '005930', name: '삼성전자' },
      { symbol: 'NAS:NOLABEL', name: 'NAS:NOLABEL' },
    ]);
    expect(short('NAS:MU')).toBe('MICRON');
    expect(short('NAS:SNPS')).toBe('SYNOPSYS');
    expect(short('NAS:SMH')).toBe('SMH');
    expect(short('NYS:XYZ')).toBe('XYZ');
    expect(short('NYS:GLD')).toBe('GLD');
    expect(short('034730')).toBe('SK');
    expect(short('005930')).toBe('삼성전자');
    expect(short('NAS:NOLABEL')).toBe('NOLABEL');
  });

  test('같은 메시지에서 첫 단어가 겹치면 둘 다 티커', () => {
    const short = buildShortNamer([
      { symbol: 'NAS:GOOGL', name: 'ALPHABET INC CLASS A' },
      { symbol: 'NAS:GOOG', name: 'ALPHABET INC CLASS C' },
      { symbol: 'NAS:NVDA', name: 'NVIDIA CORP' },
    ]);
    expect([short('NAS:GOOGL'), short('NAS:GOOG'), short('NAS:NVDA')]).toEqual(['GOOGL', 'GOOG', 'NVIDIA']);
  });

  test('화면(전체 이름)과 요약(짧은 이름)이 다르다', () => {
    const p = basePayload({ holdings: [holding({ symbol: 'NAS:MU', name: 'MICRON TECHNOLOGY INC', profitPct: -2 })], candidates: [], sellSignals: [] });
    const [w] = computeReportWarnings(p);
    expect(w.title).toBe('손절 임박 1종목');
    expect(w.sub).toContain('MICRON TECHNOLOGY INC(고점대비 −2.00%)');
    expect(formatReportSummary(p).warnings[0].tg).toBe('손절 임박 1종목: MICRON(고점대비 −2.00%)');
  });
});

describe('링크·id·홈 이동', () => {
  test('reportLinkUrl: https 사이트 루트 + ?open=report&id=', () => {
    expect(reportLinkUrl('https://stock.example.com/', 42)).toBe('https://stock.example.com/?open=report&id=42');
    expect(reportLinkUrl('http://stock.example.com/', 42)).toBeNull();
    expect(reportLinkUrl('https://a b/', 42)).toBeNull();
    expect(reportLinkUrl(null, 42)).toBeNull();
    expect(reportLinkUrl('https://stock.example.com/', null)).toBeNull();
    expect(reportLinkUrl('https://stock.example.com/', 0)).toBeNull();
  });

  test('parseReportId: 양의 정수만', () => {
    expect(parseReportId('7')).toBe(7);
    for (const bad of ['0', '-1', '1.5', '01', 'abc', '', ' 7', '7 ', '1e3', '9999999999999999', null, undefined]) {
      expect(parseReportId(bad as string)).toBeNull();
    }
  });

  test('reportRedirectTarget: open=report + 숫자 id 일 때만 /report?id=', () => {
    const q = (s: string) => new URLSearchParams(s);
    expect(reportRedirectTarget(q('open=report&id=15'))).toBe('/report?id=15');
    expect(reportRedirectTarget(q('open=report&id=//evil.com'))).toBeNull();
    expect(reportRedirectTarget(q('open=report&id=15/../x'))).toBeNull();
    expect(reportRedirectTarget(q('open=report'))).toBeNull();
    expect(reportRedirectTarget(q('open=settings&id=15'))).toBeNull();
    expect(reportRedirectTarget(q('open=https://evil.com&id=15'))).toBeNull();
    expect(reportRedirectTarget(q(''))).toBeNull();
  });

  test('parseReportPayload: 문자열·객체 모두 읽고, 모양이 다르면 null', () => {
    const p = basePayload();
    expect(parseReportPayload(JSON.stringify(p))).toEqual(p);
    expect(parseReportPayload(p)).toBe(p);
    expect(parseReportPayload('{')).toBeNull();
    expect(parseReportPayload({ ...p, schemaVersion: 2 })).toBeNull();
    expect(parseReportPayload({ ...p, holdings: null })).toBeNull();
  });
});
