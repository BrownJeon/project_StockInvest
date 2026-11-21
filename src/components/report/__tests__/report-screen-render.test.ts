/**
 * T-182 리포트 전문 화면 렌더 시험 — 승인 데모 v1 `#app` 의 구조·문구·기본 펼침 규칙(jsdom 없음, 정적 렌더).
 */
import * as ReactNS from 'react';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('@/components/ops/useOpsPoll', () => ({
  useOpsPoll: () => ({ status: 'loading', data: null, lastOkAt: null, error: null, refresh: () => {} }),
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useSearchParams: () => new URLSearchParams('id=42'),
}));
(globalThis as unknown as { React: typeof ReactNS }).React = ReactNS;

import { ReportBody, ReportScreen, type ReportRow } from '../ReportScreen';
import { REPORT_PAYLOAD_SCHEMA_VERSION, type TradeReportPayload } from '@/lib/reports/trade-report-view';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

function payload(over: Partial<TradeReportPayload> = {}): TradeReportPayload {
  return {
    schemaVersion: REPORT_PAYLOAD_SCHEMA_VERSION,
    rangeStart: '2026-11-18T23:04:00.000Z',
    rangeEnd: '2026-11-19T23:04:00.000Z',
    coverage: { asset: 'ok', holdings: 'ok', candidates: 'ok', research: 'ok', signals: 'ok' },
    asset: { totalKRW: 12_480_000, baselineKRW: 12_950_000 },
    trade: { buys: 0, buysAmountKRW: 0, sells: 0, sellsAmountKRW: 0, lifoPnlKRW: 0, matchedSellCount: 0, unmatchedSellCount: 0, churnSymbols: [] },
    sellSignals: [{ symbol: '005930', name: '삼성전자', signalId: 1, exitKind: 'eod_loss_cut', pnlPct: -21.4, pnlKRW: -412_000, signalAt: null, filled: false }],
    holdings: [
      { symbol: 'NAS:MU', name: 'MICRON TECHNOLOGY INC', market: 'overseas', qty: 8, profitPct: 2.6, periodChangePct: null, investedKRW: 9_800_000,
        investedText: '₩9,800,000 (달러 환산 불가 — 원화 표시)', sellAction: 'insufficient_data', sellJudgeText: '판단 보류 (14일 내 도달 근거 없음)', holdingInfoText: '보유 41일째 (참고 정보)', holdingDays: 41 },
    ],
    candidates: [{ symbol: '000880', name: '한화', status: 'blocked', skipReason: 'portfolio_guard', rsi: null, evPct: null, aiConf: null }],
    research: { trackedCount: 5, activeCount: 1, note: '이 수치는 예측 규칙이 아니라 사후 관찰입니다.', items: [
      { symbol: 'NAS:SNPS', name: 'SYNOPSYS INC', market: 'overseas', asOfDate: '2026-11-19', action: 'buy', triggerCount: 140, evidenceText: '누적낙폭 ＞ 15%', priceText: '매수 희망가 $410.00 (볼린저 하단(20,2)), 14일 이내' },
    ] },
    ...over,
  };
}
const REPORT: ReportRow = {
  id: 42, sentAt: '2026-11-19T23:04:53.000Z', rangeStart: '2026-11-18T23:04:00.000Z', rangeEnd: '2026-11-19T23:04:00.000Z',
  isTest: false, delivered: true, summaryText: '[StockInvest] ℹ️ 거래 리포트 · 11/20 08:04\n💰 총자산', payload: null,
};
const render = (p: TradeReportPayload, r: ReportRow = REPORT) => renderToStaticMarkup(h(ReportBody, { report: r, payload: p }));

test('기본: 데모 구조(요약 열·상세 열·섹션 순서)와 문구, 「매도 손익」이라는 말 없음', () => {
  const html = render(payload());
  const t = text(html);
  for (const cls of ['abody', 'colsum', 'coldet', 'sec', 'row', 'expl']) expect(html).toContain(`class="${cls}`);
  const order = ['r-trade', 'r-sell', 'r-hold', 'r-cand', 'r-res', 'r-raw'].map((k) => html.indexOf(`id="${k}"`));
  expect(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1]))).toBe(true);
  expect(t).toContain('총자산 · 11/20 08:04 기준');
  expect(t).toContain('₩12,480,000');
  expect(t).toContain('▼ −3.63% · −₩470,000');
  expect(t).toContain('기간 시작 ₩12,950,000 (11/19 08:04)');
  expect(t).toContain('확인 필요 2건');
  expect(t).toContain('삼성전자 매도 신호 1건 — 체결 안 됨');
  expect(t).toContain('체결된 매도가 아닙니다.');
  expect(t).toContain('마감손절 신호 · 체결 안 됨');
  expect(t).toContain('신호 기준 −21.40%');
  expect(t).toContain('고점대비 는 보유 중 최고가와 비교한 등락입니다. 수익률이 아닙니다.');   // text() 가 <b> 경계에 공백을 넣는다
  expect(t).toContain('1종목 모두 차단 — 사유 포트폴리오 보호');
  expect(t).toContain('참고용 — 이 수치는 예측 규칙이 아니라 사후 관찰입니다.');
  expect(t).toContain('텔레그램 · 2줄 · 보관됨');
  expect(t).not.toContain('매도 손익');
  expect(t).not.toContain('익절 임박');
  // 확인 필요 행은 같은 페이지 섹션으로 간다
  expect(html).toContain('href="#r-sell"');
  expect(html).toContain('href="#r-cand"');
});

test('기본 펼침: 확인 필요가 가리키는 섹션(매도 신호·매수 후보)만 열린다', () => {
  const html = render(payload());
  const isOpen = (id: string) => new RegExp(`<details class="sec" id="${id}" open`).test(html);
  expect(isOpen('r-sell')).toBe(true);
  expect(isOpen('r-cand')).toBe(true);
  for (const id of ['r-trade', 'r-hold', 'r-res', 'r-raw']) expect(isOpen(id)).toBe(false);
  expect(text(html)).toContain('모두 펼치기');
});

test('확인 필요 0건: 「확인할 것 없음」 + 전부 접힘', () => {
  const html = render(payload({ sellSignals: [], candidates: [] }));
  expect(text(html)).toContain('확인할 것 없음 총자산 조회·손절 임박·미체결 신호·회전매매·후보 전면 차단 모두 0건');
  expect(text(html)).toContain('확인 필요 0건');
  expect(html).not.toMatch(/<details[^>]* open/);
  expect(text(html)).toContain('이 기간에 만들어진 매도 신호가 없습니다.');
});

test('총자산 조회 불가: 숫자 대신 「조회 불가」, 0원이 아님을 밝힌다', () => {
  const t = text(render(payload({ asset: { totalKRW: null, baselineKRW: 12_950_000 }, coverage: { ...payload().coverage, asset: 'failed' } })));
  expect(t).toContain('총자산 조회 불가');
  expect(t).toContain('0원이 아닙니다');
  expect(t).toContain('총자산을 조회하지 못했습니다');
  expect(t).not.toMatch(/총자산[^가-힣]*₩0/);
});

test('부분 실패: 그 섹션만 오류 행, 다른 섹션은 정상', () => {
  const t = text(render(payload({ coverage: { asset: 'ok', holdings: 'failed', candidates: 'failed', research: 'ok', signals: 'failed' }, holdings: [], candidates: [], sellSignals: [] })));
  expect(t).toContain('보유 정보를 읽지 못했습니다 · 0건이 아닙니다');
  expect(t).toContain('매수 후보 정보를 읽지 못했습니다 · 0건이 아닙니다');
  expect(t).toContain('SYNOPSYS INC');
});

test('발송 실패 회차: 원문 섹션에 「발송 실패 — 화면 기록만」', () => {
  expect(text(render(payload(), { ...REPORT, delivered: false }))).toContain('발송 실패 — 화면 기록만');
});

test('화면 진입(정적 렌더 = 불러오는 중): 머리·뒤로 버튼·자리 표시, 주문·승인 버튼 없음', () => {
  const html = renderToStaticMarkup(h(ReportScreen));
  expect(html).toContain('aria-label="뒤로"');
  expect(text(html)).toContain('거래 리포트');
  expect(html).toContain('aria-busy="true"');
  expect(text(html)).not.toMatch(/매수하기|매도하기|승인|주문하기/);
});
