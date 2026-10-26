/**
 * T-097 Q-E — 텔레그램 승인 요청 메시지의 "수량" 줄.
 *
 * 승인된 데모: `mockups/T-097-telegram-sizing-line-v1.html` (사용자 승인 "1. 텔레그램 수량에 대하여 승인", 2026-10-26).
 *  - 해외: `수량   N주 × $정수  (≈ ₩원화)`, 국내: `수량   N주 × ₩단가  (= ₩금액)` — "금액" 줄 바로 아래
 *  - 매수 + `indicators.sizing` 유효 + 수량 ≥ 1 일 때만. 해외는 환율·정수 달러 단가를 만들 수 있을 때만. 그 밖에는 줄 없음.
 *  - 버튼·버튼 서명은 변하지 않는다. 동적 값은 이스케이프된다(T-042 78% 유실 재발 방지).
 */
import { getPool } from '@/lib/db';
import {
  renderApprovalRequest,
  renderQuantityLine,
  type ApprovalRequestView,
  type QuantityLineView,
} from '../approval-message';
import {
  buildQuantityLine,
  defaultDeps,
  notifyApprovalRequest,
  renderPlainRequest,
  type ApprovalNotifyArgs,
  type NotifyDeps,
} from '../approval-notify';
import type { ExecutabilityAssessment } from '../approval-context';
import { computeSizingSnapshot, SIZING_RULE } from '../sizing-snapshot';
import { overseasLimitUnitUsd } from '../signal-cash-gate';
import { deriveApprovalKey, parseCallbackData, verifyCallbackData } from '../telegram-callback-data';
import { escapeAlertText } from '../../notify/escape';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/auth/session', () => ({ getSessionSecret: jest.fn() }));
jest.mock('../../notify', () => ({
  dispatchAlertWithTelegram: jest.fn(), getSymbolLabel: jest.fn(), sendAlert: jest.fn(),
}));
jest.mock('../../notify/telegram-api', () => ({ sendTelegramMessage: jest.fn() }));
jest.mock('../../notify/telegram', () => ({ sendTelegramAlert: jest.fn() }));

const KEY = deriveApprovalKey('a-session-secret-that-is-long-enough-1234567890')!;
const NOW = new Date('2026-10-26T07:02:00Z');           // 16:02 KST
const FX = 1324;

// ── 기록(1단계 `indicators.sizing`) — 실제 기록 함수로 만든다 ─────────────────────────
const overseasSizing = (over: Partial<Parameters<typeof computeSizingSnapshot>[0]> = {}) => computeSizingSnapshot({
  market: 'overseas', targetKrw: 99_600, quantity: 2, unitPriceKrw: 49_000, quantitySource: 'amount', chasePct: 0, ...over,
});
const domesticSizing = (over: Partial<Parameters<typeof computeSizingSnapshot>[0]> = {}) => computeSizingSnapshot({
  market: 'domestic', targetKrw: 99_600, quantity: 2, unitPriceKrw: 48_300, quantitySource: 'amount', chasePct: 0, ...over,
});

const LINE_OVERSEAS = '수량   2주 × $37  (≈ ₩97,976)';          // 49,000 ÷ 1,324 = 37.009 → $37, 2 × 37 × 1,324 = 97,976
const LINE_DOMESTIC = '수량   2주 × ₩48,300  (= ₩96,600)';

// ── 렌더 입력 ─────────────────────────────────────────────────────────────────────
const view = (over: Partial<ApprovalRequestView> = {}): ApprovalRequestView => ({
  signalId: 20_001, label: '예시 종목 A', symbol: 'NAS:AAAA', market: 'overseas', side: 'buy',
  amountKRW: 99_600, strategyId: 'rsi-oversold-v1', reasonLine: 'RSI 33 과매도 반등 후보',
  expiresAt: new Date(NOW.getTime() + 28 * 60_000), now: NOW,
  totalAssetPct: 0.4, dailyRemainingKRW: 2_100_000, cashKRW: 1_500_000, cashNeededKRW: 99_600,
  appUrl: 'https://stock.example.com/strategy',
  ...over,
});
const qOverseas: QuantityLineView = { market: 'overseas', quantity: 2, unitUsd: 37, approxKrw: 97_976 };
const qDomestic: QuantityLineView = { market: 'domestic', quantity: 2, unitKrw: 48_300, totalKrw: 96_600 };

const strayAngles = (text: string): number => (text.replace(/<\/?(?:b|i)>/g, '').match(/</g) ?? []).length;
const bareAmpersands = (text: string): number => (text.replace(/&(?:amp|lt|gt);/g, '').match(/&/g) ?? []).length;

describe('렌더 — 승인된 데모의 두 형식, "금액" 줄 바로 아래', () => {
  test('해외: 정수 달러 단가와 괄호 안 원화 환산, 줄 순서 금액 → 수량 → 한도·현금', () => {
    const lines = renderApprovalRequest(view({ quantityLine: qOverseas }), KEY).text.split('\n');
    const i = lines.indexOf('금액   ₩99,600 (총자산의 0.4%)');
    expect(i).toBeGreaterThan(0);
    expect(lines[i + 1]).toBe(LINE_OVERSEAS);
    expect(lines[i + 2]).toBe('오늘 한도 잔여 ₩2,100,000  ·  현금 ₩1,500,000');
    expect(lines[i + 3]).toBe('승인하면  지정가 주문 (신호가 기준)');
    expect(lines.filter((l) => l.startsWith('수량'))).toHaveLength(1);
  });

  test('국내: 원화 단가와 = 실제 금액', () => {
    const lines = renderApprovalRequest(view({ market: 'domestic', symbol: '000000', quantityLine: qDomestic }), KEY).text.split('\n');
    const i = lines.indexOf('금액   ₩99,600 (총자산의 0.4%)');
    expect(lines[i + 1]).toBe(LINE_DOMESTIC);
    expect(lines[i + 2]).toBe('오늘 한도 잔여 ₩2,100,000  ·  현금 ₩1,500,000');
  });

  test('한도·현금 줄이 없어도(조회 실패) 수량 줄은 금액 바로 아래', () => {
    const lines = renderApprovalRequest(view({ quantityLine: qOverseas, dailyRemainingKRW: null, cashKRW: null }), KEY).text.split('\n');
    const i = lines.findIndex((l) => l.startsWith('금액'));
    expect(lines[i + 1]).toBe(LINE_OVERSEAS);
    expect(lines[i + 2]).toBe('승인하면  지정가 주문 (신호가 기준)');
  });

  test('큰 수는 천 단위 구분 — 1,250주 × $1,234', () => {
    expect(renderQuantityLine({ market: 'overseas', quantity: 1250, unitUsd: 1234, approxKrw: 2_042_270_000 }))
      .toBe('수량   1,250주 × $1,234  (≈ ₩2,042,270,000)');
  });

  test.each<[string, Partial<ApprovalRequestView>]>([
    ['quantityLine 없음(옛 시그널·카드)', {}],
    ['quantityLine null', { quantityLine: null }],
    ['매도', { side: 'sell', quantityLine: qOverseas }],
    ['진입 구간(감시 등록 — 주문 수량이 구간 도달 때 다시 정해짐)', { zone: [48_000, 49_000], quantityLine: qOverseas }],
    ['시장 불일치(국내 요청에 해외 값)', { market: 'domestic', quantityLine: qOverseas }],
    ['수량 0', { quantityLine: { ...qOverseas, quantity: 0 } }],
    ['수량 소수', { quantityLine: { ...qOverseas, quantity: 1.5 } }],
    ['수량 NaN', { quantityLine: { ...qOverseas, quantity: NaN } }],
    ['해외 단가 1달러 미만(정수 달러 아님)', { quantityLine: { ...qOverseas, unitUsd: 0.5123 } }],
    ['해외 단가 소수', { quantityLine: { ...qOverseas, unitUsd: 37.5 } }],
    ['해외 단가 0', { quantityLine: { ...qOverseas, unitUsd: 0 } }],
    ['해외 환산 Infinity', { quantityLine: { ...qOverseas, approxKrw: Infinity } }],
    ['국내 단가 음수', { market: 'domestic', quantityLine: { ...qDomestic, unitKrw: -1 } }],
    ['국내 금액 NaN', { market: 'domestic', quantityLine: { ...qDomestic, totalKrw: NaN } }],
  ])('줄 없음: %s', (_l, over) => {
    const text = renderApprovalRequest(view(over), KEY).text;
    expect(text).not.toContain('수량');
    expect(text).not.toContain('주 ×');
  });

  test('줄이 없을 때 본문은 T-097 이전과 같다(수량 줄만 추가되는 변경)', () => {
    const without = renderApprovalRequest(view(), KEY).text;
    const withLine = renderApprovalRequest(view({ quantityLine: qOverseas }), KEY).text;
    expect(withLine.split('\n').filter((l) => l !== LINE_OVERSEAS).join('\n')).toBe(without);
  });

  test('🔴 버튼·버튼 서명은 수량 줄과 무관하다', () => {
    const a = renderApprovalRequest(view({ signedAmountKRW: 99_600 }), KEY).keyboard;
    const b = renderApprovalRequest(view({ signedAmountKRW: 99_600, quantityLine: qOverseas }), KEY).keyboard;
    expect(b).toEqual(a);
    expect(b.inline_keyboard[0].map((x) => x.text)).toEqual(['✅ 승인', '❌ 거절']);
    expect(b.inline_keyboard[1][0]).toEqual({ text: '🔗 앱에서 자세히', url: 'https://stock.example.com/strategy' });
    const p = parseCallbackData(b.inline_keyboard[0][0].callback_data)!;
    expect(verifyCallbackData(KEY, p, 99_600)).toBe(true);
    expect(verifyCallbackData(KEY, p, 97_976)).toBe(false);      // 실현액으로 서명하지 않는다
  });

  test('🔴 이스케이프: 종목명·심볼·사유에 < > & 가 있어도 정적 태그 외의 < 와 맨몸 & 가 없다', () => {
    const { text } = renderApprovalRequest(view({
      label: escapeAlertText('AT&T <Inc> & Co'), symbol: 'A&B<x>', reasonLine: 'RSI14=37.4 < 38 & vol > 2x <b>', quantityLine: qOverseas,
    }), KEY);
    expect(strayAngles(text)).toBe(0);
    expect(bareAmpersands(text)).toBe(0);
    expect(text).toContain(LINE_OVERSEAS);
  });

  test('🔴 퍼징: 위험 문자 조합 400회 + 수량 줄 → 텔레그램이 거부할 문자 0', () => {
    const alphabet = ['<', '>', '&', '<b>', '</b>', '<script>', '&amp;', '&lt;', '"', 'a', ' ', '\n', '한글', 'AT&T', '< 38'];
    let seed = 97;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const junk = () => Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('');
    for (let i = 0; i < 400; i++) {
      const q = i % 2 ? qOverseas : qDomestic;
      const { text } = renderApprovalRequest(view({
        label: escapeAlertText(junk()), symbol: junk(), reasonLine: junk(), strategyId: junk(), market: q.market, quantityLine: q,
      }), KEY);
      expect(strayAngles(text)).toBe(0);
      expect(bareAmpersands(text)).toBe(0);
      expect(text).toContain(q.market === 'overseas' ? LINE_OVERSEAS : LINE_DOMESTIC);
    }
  });

  test('텔레그램 본문 한도(4096자) 안 — 긴 종목명·이스케이프로 부푼 사유·최대 자릿수 수량 줄', () => {
    const huge: QuantityLineView = { market: 'overseas', quantity: 999_999_999, unitUsd: 999_999, approxKrw: 9.99e17 };
    const { text } = renderApprovalRequest(view({
      label: escapeAlertText('&'.repeat(200)), reasonLine: '<'.repeat(100), symbol: '&'.repeat(40), quantityLine: huge,
    }), KEY);
    expect(text).toContain('주 × $');
    expect(text.length).toBeLessThan(4096);
  });
});

describe('buildQuantityLine — indicators.sizing → 줄 값 (순수)', () => {
  test('해외 정상: 정수 달러는 overseasLimitUnitUsd 와 같은 값, 괄호는 수량 × 정수 달러 × 환율', () => {
    const q = buildQuantityLine({ side: 'buy', orderType: 'limit', market: 'overseas', indicators: { rsi14: 33, sizing: overseasSizing() }, fxRate: FX });
    expect(q).toEqual({ market: 'overseas', quantity: 2, unitUsd: 37, approxKrw: 2 * 37 * FX });
    expect(q && q.market === 'overseas' && q.unitUsd).toBe(overseasLimitUnitUsd(49_000, FX));
    expect(renderQuantityLine(q)).toBe(LINE_OVERSEAS);
  });

  test('해외: 반올림이 위로 가는 경우도 어댑터와 같다 — ₩49,700 ÷ 1,324 = 37.54 → $38', () => {
    const q = buildQuantityLine({ side: 'buy', orderType: 'limit', market: 'overseas', indicators: { sizing: overseasSizing({ unitPriceKrw: 49_700 }) }, fxRate: FX });
    expect(q).toEqual({ market: 'overseas', quantity: 2, unitUsd: 38, approxKrw: 2 * 38 * FX });
  });

  test('해외: 호가 추격(+0.5%)이 반영된 기록 단가를 쓴다', () => {
    const s = overseasSizing({ unitPriceKrw: 49_000 * 1.005, chasePct: 0.005 });
    const q = buildQuantityLine({ side: 'buy', orderType: 'limit', market: 'overseas', indicators: { sizing: s }, fxRate: FX });
    expect(q).toEqual({ market: 'overseas', quantity: 2, unitUsd: Math.round((49_000 * 1.005) / FX), approxKrw: 2 * 37 * FX });
  });

  test('국내 정상: 호가단위 위의 단가(₩48,300)는 그대로, "=" 는 단가 × 수량', () => {
    const q = buildQuantityLine({ side: 'buy', orderType: 'limit', market: 'domestic', indicators: { sizing: domesticSizing() }, fxRate: null });
    expect(q).toEqual({ market: 'domestic', quantity: 2, unitKrw: 48_300, totalKrw: 96_600 });
    expect(renderQuantityLine(q)).toBe(LINE_DOMESTIC);
  });

  test('DB 행 그대로(JSON 문자열) indicators 도 읽는다', () => {
    const q = buildQuantityLine({ side: 'buy', orderType: 'limit', market: 'domestic', indicators: JSON.stringify({ sizing: domesticSizing() }) });
    expect(q).toEqual({ market: 'domestic', quantity: 2, unitKrw: 48_300, totalKrw: 96_600 });
  });

  test.each<[string, Parameters<typeof buildQuantityLine>[0]]>([
    ['매도', { side: 'sell', orderType: 'limit', market: 'overseas', indicators: { sizing: overseasSizing() }, fxRate: FX }],
    ['sizing 없음(옛 시그널·카드)', { side: 'buy', orderType: 'limit', market: 'overseas', indicators: { rsi14: 33 }, fxRate: FX }],
    ['indicators null', { side: 'buy', orderType: 'limit', market: 'domestic', indicators: null }],
    ['규칙 버전 다름', { side: 'buy', orderType: 'limit', market: 'domestic', indicators: { sizing: { ...domesticSizing(), rule: 'qty_first_v2' } } }],
    ['수량 0(1주 미만)', { side: 'buy', orderType: 'limit', market: 'domestic', indicators: { sizing: domesticSizing({ quantity: 0 }) } }],
    ['수량 미확정(시장가)', { side: 'buy', orderType: 'limit', market: 'domestic', indicators: { sizing: domesticSizing({ quantity: undefined, quantitySource: 'unresolved' }) } }],
    ['단가 없음', { side: 'buy', orderType: 'limit', market: 'domestic', indicators: { sizing: domesticSizing({ unitPriceKrw: null }) } }],
    ['해외 환율 null', { side: 'buy', orderType: 'limit', market: 'overseas', indicators: { sizing: overseasSizing() }, fxRate: null }],
    ['해외 환율 없음(undefined)', { side: 'buy', orderType: 'limit', market: 'overseas', indicators: { sizing: overseasSizing() } }],
    ['해외 환율 0', { side: 'buy', orderType: 'limit', market: 'overseas', indicators: { sizing: overseasSizing() }, fxRate: 0 }],
    ['해외 환율 NaN', { side: 'buy', orderType: 'limit', market: 'overseas', indicators: { sizing: overseasSizing() }, fxRate: NaN }],
    ['해외 1달러 미만 종목(정수 달러 아님)', { side: 'buy', orderType: 'limit', market: 'overseas', indicators: { sizing: overseasSizing({ quantity: 150, unitPriceKrw: 660 }) }, fxRate: FX }],
  ])('줄 없음: %s', (_l, a) => {
    expect(buildQuantityLine(a)).toBeNull();
  });

  test('기록 상수 확인 — 1단계 규칙 버전', () => {
    expect(overseasSizing().rule).toBe(SIZING_RULE);
  });
});

// ── 발송 경로(approval-notify) ──────────────────────────────────────────────────
const OK: ExecutabilityAssessment = { executable: true, reasons: [], ctx: { totalKRW: 24_900_000, cashKRW: 1_500_000, dailyRemainingKRW: 2_100_000 } };
const ON = { key: KEY as Buffer | null, enabled: true, appUrl: 'https://stock.example.com/strategy' as string | null };

const nargs = (over: Partial<ApprovalNotifyArgs> = {}): ApprovalNotifyArgs => ({
  signalId: 20_001, symbol: 'NAS:AAAA', side: 'buy', amountKRW: 99_600, price: 49_000, orderType: 'limit', strategyId: 'rsi-oversold-v1',
  reasoning: 'RSI 33 과매도 반등 후보', indicators: { rsi14: 33, sizing: overseasSizing() }, market: 'overseas',
  expiresAt: new Date(NOW.getTime() + 28 * 60_000), ...over,
});

function ndeps(over: Partial<NotifyDeps> = {}, buttons = ON) {
  const sent: { plain: Array<{ title: string; body: string }>; rich: Array<{ plainBody: string; text: string; keyboard: unknown }> } = { plain: [], rich: [] };
  const fxRate = jest.fn(async () => FX as number | null);
  const d: NotifyDeps = {
    now: () => NOW,
    pendingFlag: async () => true,
    skipUnexecutable: async () => true,
    buttons: async () => buttons,
    label: async () => '예시 종목 A',
    storedAmount: async () => 99_600,
    assess: jest.fn(async () => OK),
    sendPlain: (_l, title, body) => { sent.plain.push({ title, body }); },
    sendRich: async (_t, plainBody, text, keyboard) => { sent.rich.push({ plainBody, text, keyboard }); },
    fxRate,
    ...over,
  };
  return { d, sent, fxRate: (over.fxRate ?? fxRate) as jest.Mock | undefined };
}

let infoSpy: jest.SpyInstance;
beforeEach(() => { infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {}); });
afterEach(() => infoSpy.mockRestore());

describe('notifyApprovalRequest — 버튼 메시지에 수량 줄', () => {
  test('해외 매수: 환율을 1번 읽고 금액 바로 아래 수량 줄, 버튼·서명 그대로', async () => {
    const { d, sent, fxRate } = ndeps();
    expect(await notifyApprovalRequest(nargs(), d)).toEqual({ kind: 'sent', format: 'buttons' });
    const lines = sent.rich[0].text.split('\n');
    const i = lines.findIndex((l) => l.startsWith('금액'));
    expect(lines[i]).toBe('금액   ₩99,600 (총자산의 0.4%)');
    expect(lines[i + 1]).toBe(LINE_OVERSEAS);
    expect(lines[i + 2]).toBe('오늘 한도 잔여 ₩2,100,000  ·  현금 ₩1,500,000');
    expect(fxRate).toHaveBeenCalledTimes(1);
    const rows = (sent.rich[0].keyboard as { inline_keyboard: Array<Array<{ text: string; callback_data?: string }>> }).inline_keyboard;
    expect(rows[0].map((b) => b.text)).toEqual(['✅ 승인', '❌ 거절']);
    expect(verifyCallbackData(KEY, parseCallbackData(rows[0][0].callback_data)!, 99_600)).toBe(true);
  });

  test('국내 매수: 환율을 읽지 않고 국내 형식', async () => {
    const { d, sent, fxRate } = ndeps();
    await notifyApprovalRequest(nargs({ symbol: '000000', market: 'domestic', indicators: { sizing: domesticSizing() } }), d);
    expect(sent.rich[0].text).toContain(`금액   ₩99,600 (총자산의 0.4%)\n${LINE_DOMESTIC}\n`);
    expect(fxRate).not.toHaveBeenCalled();
  });

  test('🔴 국내 호가 추격(+0.5%): 줄 단가는 송신가(호가단위 반올림), "=" 는 단가 × 수량 — 기록값 ₩48,541·₩97,083 이 아니다', async () => {
    const { d, sent } = ndeps();
    const sizing = domesticSizing({ unitPriceKrw: 48_300 * 1.005, chasePct: 0.005 });
    await notifyApprovalRequest(nargs({ symbol: '000000', market: 'domestic', indicators: { sizing } }), d);
    expect(sent.rich[0].text).toContain('금액   ₩99,600 (총자산의 0.4%)\n수량   2주 × ₩48,550  (= ₩97,100)\n');
    expect(sent.rich[0].text).not.toContain('48,541');
    expect(sent.rich[0].text).not.toContain('97,083');
  });

  test.each<[string, Partial<ApprovalNotifyArgs>]>([
    ['sizing 없음', { indicators: { rsi14: 33 } }],
    ['수량 0', { indicators: { sizing: overseasSizing({ quantity: 0 }) } }],
    ['매도', { side: 'sell', indicators: { exit_kind: 'target_profit', sizing: overseasSizing({ quantitySource: 'requested' }) } }],
  ])('줄 없음 + 환율도 읽지 않음: %s', async (_l, over) => {
    const { d, sent, fxRate } = ndeps();
    expect(await notifyApprovalRequest(nargs(over), d)).toEqual({ kind: 'sent', format: 'buttons' });
    expect(sent.rich[0].text).not.toContain('주 ×');
    expect(fxRate).not.toHaveBeenCalled();
  });

  test.each<[string, Partial<NotifyDeps>]>([
    ['환율 모름(null)', { fxRate: jest.fn(async () => null) }],
    ['환율 읽기 실패(throw)', { fxRate: jest.fn(async () => { throw new Error('db down'); }) }],
    ['환율 의존성 없음', { fxRate: undefined }],
  ])('🔴 해외 %s → 해외 줄만 생략, 알림·버튼은 그대로 나간다', async (_l, over) => {
    const { d, sent } = ndeps(over);
    expect(await notifyApprovalRequest(nargs(), d)).toEqual({ kind: 'sent', format: 'buttons' });
    expect(sent.rich[0].text).not.toContain('주 ×');
    expect(sent.rich[0].text).toContain('금액   ₩99,600');
    expect((sent.rich[0].keyboard as { inline_keyboard: unknown[] }).inline_keyboard).toHaveLength(2);
  });

  test('진입 구간이 있는 시그널(감시 등록)은 줄 없음', async () => {
    const { d, sent } = ndeps();
    await notifyApprovalRequest(nargs({
      symbol: '005380', market: 'domestic',
      indicators: { ai: { scenario: { entry: { price_zone: '245000~248500' } } }, sizing: domesticSizing() },
    }), d);
    expect(sent.rich[0].text).toContain('진입 감시 등록');
    expect(sent.rich[0].text).not.toContain('주 ×');
  });

  test('🔴 간단한 본문(버튼 꺼짐)은 기존 형식 그대로 — 수량 줄을 넣지 않고 환율도 읽지 않는다', async () => {
    const { d, sent, fxRate } = ndeps({}, { ...ON, enabled: false });
    expect(await notifyApprovalRequest(nargs(), d)).toEqual({ kind: 'sent', format: 'plain' });
    expect(sent.plain[0].body).toBe(renderPlainRequest(nargs({ indicators: { rsi14: 33 } }), '예시 종목 A', NOW).body);
    expect(sent.plain[0].body).not.toContain('주 ×');
    expect(fxRate).not.toHaveBeenCalled();
  });

  test('슬랙용 간단한 본문(plainBody)도 그대로', async () => {
    const { d, sent } = ndeps();
    await notifyApprovalRequest(nargs(), d);
    expect(sent.rich[0].plainBody).not.toContain('주 ×');
  });
});

// ── Codex C2 — 시장가 매수는 수량 줄을 만들지 않는다 ─────────────────────────────────
// 국내 어댑터는 시장가에 ORD_UNPR '0', 해외 어댑터는 시장가를 지정가로 바꾸며 매수 +0.5% 를 더한다 → 표시 단가가 송신가와 달라진다.
// 승인된 데모는 지정가 매수의 줄이다. 표시 전용이라 orderType 을 모르면(미전달) 줄을 뺀다.
describe('🔴 시장가·orderType 미전달 매수 → 수량 줄 없음 (T-097 Q-E Codex C2)', () => {
  type Kb = { inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>> };

  test('① 국내 시장가 매수 + 유효 sizing → buildQuantityLine null', () => {
    const base = { side: 'buy' as const, market: 'domestic' as const, indicators: { sizing: domesticSizing() } };
    expect(buildQuantityLine({ ...base, orderType: 'market' })).toBeNull();
    expect(buildQuantityLine({ ...base, orderType: 'limit' })).toEqual(qDomestic);        // 같은 입력의 지정가는 줄이 있다
  });

  test('② 해외 시장가 매수 + 환율 정상 → buildQuantityLine null', () => {
    expect(buildQuantityLine({ side: 'buy', orderType: 'market', market: 'overseas', indicators: { sizing: overseasSizing() }, fxRate: FX })).toBeNull();
  });

  test('② 해외 시장가 매수(발송 경로) → 줄 없음 + 환율 조회 함수를 부르지 않는다', async () => {
    const { d, sent, fxRate } = ndeps();
    expect(await notifyApprovalRequest(nargs({ orderType: 'market' }), d)).toEqual({ kind: 'sent', format: 'buttons' });
    expect(sent.rich[0].text).not.toContain('주 ×');
    expect(sent.rich[0].text).not.toContain('수량');
    expect(fxRate).not.toHaveBeenCalled();
  });

  test('③ 지정가는 기존 값 그대로 — 해외 $37·≈₩97,976 / 국내 ₩48,300·=₩96,600', () => {
    expect(buildQuantityLine({ side: 'buy', orderType: 'limit', market: 'overseas', indicators: { sizing: overseasSizing() }, fxRate: FX })).toEqual(qOverseas);
    expect(buildQuantityLine({ side: 'buy', orderType: 'limit', market: 'domestic', indicators: { sizing: domesticSizing() } })).toEqual(qDomestic);
  });

  test.each<[string, Parameters<typeof buildQuantityLine>[0]]>([
    ['해외(환율 정상)', { side: 'buy', market: 'overseas', indicators: { sizing: overseasSizing() }, fxRate: FX }],
    ['국내', { side: 'buy', market: 'domestic', indicators: { sizing: domesticSizing() } }],
    ['해외 orderType: undefined 명시', { side: 'buy', orderType: undefined, market: 'overseas', indicators: { sizing: overseasSizing() }, fxRate: FX }],
    ['알 수 없는 값(런타임 문자열)', { side: 'buy', orderType: 'LIMIT' as unknown as 'limit', market: 'domestic', indicators: { sizing: domesticSizing() } }],
  ])('④ orderType 미전달·그 밖의 값 → 줄 없음: %s', (_l, a) => {
    expect(buildQuantityLine(a)).toBeNull();
  });

  test('④ orderType 미전달(발송 경로, 해외) → 줄 없음 + 환율 조회 안 함', async () => {
    const { d, sent, fxRate } = ndeps();
    const a = nargs();
    delete (a as Partial<ApprovalNotifyArgs>).orderType;
    await notifyApprovalRequest(a, d);
    expect(sent.rich[0].text).not.toContain('주 ×');
    expect(fxRate).not.toHaveBeenCalled();
  });

  test.each<[string, Partial<ApprovalNotifyArgs>, string]>([
    ['해외', {}, LINE_OVERSEAS],
    ['국내', { symbol: '000000', market: 'domestic', indicators: { sizing: domesticSizing() } }, LINE_DOMESTIC],
  ])('⑤ 전체 경로 %s: 시장가 본문 = 지정가 본문에서 수량 줄만 뺀 것, 버튼·서명(amount_krw)·금액 줄 동일', async (_l, over, line) => {
    const lim = ndeps();
    const mkt = ndeps();
    await notifyApprovalRequest(nargs({ ...over, orderType: 'limit' }), lim.d);
    await notifyApprovalRequest(nargs({ ...over, orderType: 'market' }), mkt.d);
    const limLines = lim.sent.rich[0].text.split('\n');
    const mktLines = mkt.sent.rich[0].text.split('\n');
    expect(limLines).toContain(line);
    expect(mktLines).not.toContain(line);
    expect(mktLines).toEqual(limLines.filter((l) => l !== line));                    // 나머지 줄·순서 동일
    const i = mktLines.findIndex((l) => l.startsWith('금액'));
    expect(mktLines[i]).toBe('금액   ₩99,600 (총자산의 0.4%)');
    expect(mktLines[i + 1]).toBe('오늘 한도 잔여 ₩2,100,000  ·  현금 ₩1,500,000');
    expect(mkt.sent.rich[0].keyboard).toEqual(lim.sent.rich[0].keyboard);
    const rows = (mkt.sent.rich[0].keyboard as Kb).inline_keyboard;
    expect(verifyCallbackData(KEY, parseCallbackData(rows[0][0].callback_data!)!, 99_600)).toBe(true);
    expect(mkt.sent.rich[0].plainBody).toBe(lim.sent.rich[0].plainBody);
  });
});

describe('defaultDeps().fxRate — 현금 게이트와 같은 fx_rates 행·판정, 외부 조회 없음', () => {
  const withFxRow = (row: { rate: unknown; age_sec: unknown } | null | 'throw') => {
    const query = jest.fn(async (_sql: string, _params: unknown[]) => {
      if (row === 'throw') throw new Error('db down');
      return [row ? [row] : []];
    });
    (getPool as jest.Mock).mockReturnValue({ query });
    return query;
  };

  test('신선한 행 → 환율, 조회는 fx_rates USD_KRW 1회', async () => {
    const query = withFxRow({ rate: '1324.50', age_sec: 120 });
    expect(await defaultDeps().fxRate!()).toBe(1324.5);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('FROM fx_rates WHERE pair = ?');
    expect(query.mock.calls[0][1]).toEqual(['USD_KRW']);
  });

  test.each<[string, { rate: unknown; age_sec: unknown } | null]>([
    ['행 없음', null],
    ['1시간 초과(오래됨)', { rate: '1324.5', age_sec: 3601 }],
    ['비정상 값', { rate: 'abc', age_sec: 10 }],
    ['범위 밖', { rate: '5', age_sec: 10 }],
  ])('%s → null', async (_l, row) => {
    withFxRow(row);
    expect(await defaultDeps().fxRate!()).toBeNull();
  });

  test('읽기 오류는 던지고, 발송 경로가 삼켜 줄만 생략한다', async () => {
    withFxRow('throw');
    await expect(defaultDeps().fxRate!()).rejects.toThrow('db down');
    const { d, sent } = ndeps({ fxRate: defaultDeps().fxRate });
    expect(await notifyApprovalRequest(nargs(), d)).toEqual({ kind: 'sent', format: 'buttons' });
    expect(sent.rich[0].text).not.toContain('주 ×');
  });

  test('끝까지: 진짜 fxRate(신선한 행) + 해외 기록 → 수량 줄', async () => {
    withFxRow({ rate: String(FX), age_sec: 30 });
    const { d, sent } = ndeps({ fxRate: defaultDeps().fxRate });
    await notifyApprovalRequest(nargs(), d);
    expect(sent.rich[0].text).toContain(LINE_OVERSEAS);
  });
});
