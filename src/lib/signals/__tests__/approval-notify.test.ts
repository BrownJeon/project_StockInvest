/**
 * T-042 — 승인 요청 알림 발송.
 *
 * 핵심 계약:
 *  1. 🔴 두 형식(간단/버튼) 모두 동적 값을 이스케이프한다 — 버튼 스위치가 꺼져 있어도 78% 유실 수정은 적용된다.
 *  2. 🔴 간단한 본문은 **기존 형식 그대로**다 — 사용자가 목업을 확인하고 켜기 전에는 보이는 모양이 바뀌지 않는다.
 *  3. 실행 불가 매수는 알림을 아무것도 보내지 않는다 — 요약도 없다(T-044). 서버 로그 1줄만 남긴다.
 *  4. 🔴 불확실하면 보낸다 (판정 실패·버튼 설정 실패가 알림을 삼키지 않는다).
 *  5. 🔴 `notify_skip_unexecutable` 는 키 없음·정확히 `true` 일 때만 생략 — 그 밖의 값·읽기 오류는 보낸다 (T-044 Codex low, T-058 흡수).
 */
import { getPool } from '@/lib/db';
import { dispatchAlertWithTelegram, sendAlert } from '../../notify';
import { sendTelegramMessage } from '../../notify/telegram-api';
import { sendTelegramAlert } from '../../notify/telegram';
import {
  defaultDeps,
  notifyApprovalRequest,
  pickReasonLine,
  renderPlainRequest,
  type ApprovalNotifyArgs,
  type NotifyDeps,
} from '../approval-notify';
import type { ExecutabilityAssessment, NonExecutableReason } from '../approval-context';
import { deriveApprovalKey, parseCallbackData, verifyCallbackData } from '../telegram-callback-data';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/auth/session', () => ({ getSessionSecret: jest.fn() }));
jest.mock('../../notify', () => ({
  dispatchAlertWithTelegram: jest.fn(), getSymbolLabel: jest.fn(), sendAlert: jest.fn(),
}));
jest.mock('../../notify/telegram-api', () => ({ sendTelegramMessage: jest.fn() }));
jest.mock('../../notify/telegram', () => ({ sendTelegramAlert: jest.fn() }));

const KEY = deriveApprovalKey('a-session-secret-that-is-long-enough-1234567890')!;
const NOW = new Date('2026-10-12T04:20:00Z');

const args = (over: Partial<ApprovalNotifyArgs> = {}): ApprovalNotifyArgs => ({
  signalId: 17546, symbol: 'NAS:BKNG', side: 'buy', amountKRW: 1_121_925, price: 215_000,
  strategyId: 'rsi-oversold-v1',
  reasoning: 'RSI14=37.4 < 38, price=215496 < MA20=219156, 양봉 반전 → 과매도 반등 시작',
  indicators: { rsi14: 37.4 }, market: 'overseas', expiresAt: new Date(NOW.getTime() + 28 * 60_000), ...over,
});

const OK: ExecutabilityAssessment = { executable: true, reasons: [], ctx: { totalKRW: 22_936_066, cashKRW: 3_000_000, dailyRemainingKRW: 1_900_000 } };
const NO_CASH: ExecutabilityAssessment = { executable: false, reasons: ['cash'], ctx: { totalKRW: 22_936_066, cashKRW: 80_000, dailyRemainingKRW: 1_900_000 } };

interface Sent { plain: Array<{ title: string; body: string }>; rich: Array<{ title: string; plainBody: string; text: string; keyboard: unknown }> }

function deps(over: Partial<NotifyDeps> = {}, assessment: ExecutabilityAssessment | 'throw' = OK, buttons = { key: KEY as Buffer | null, enabled: false, appUrl: null as string | null }) {
  const sent: Sent = { plain: [], rich: [] };
  const d: NotifyDeps = {
    now: () => NOW,
    pendingFlag: async () => true,
    skipUnexecutable: async () => true,
    buttons: async () => buttons,
    label: async (s) => `라벨(${s})`,
    storedAmount: async () => null,
    assess: jest.fn(async () => { if (assessment === 'throw') throw new Error('boom'); return assessment; }),
    sendPlain: (_l, title, body) => { sent.plain.push({ title, body }); },
    sendRich: async (title, plainBody, text, keyboard) => { sent.rich.push({ title, plainBody, text, keyboard }); },
    ...over,
  };
  return { d, sent };
}

/** 정적 태그(<b> </b> <i> </i>)를 지우고도 남는 `<` 또는 맨몸 `&` 의 수 — 0 이어야 텔레그램이 받는다 */
const unsafe = (t: string) => (t.replace(/<\/?(?:b|i)>/g, '').match(/</g) ?? []).length + (t.replace(/&(?:amp|lt|gt);/g, '').match(/&/g) ?? []).length;

/** 실행 불가 생략 로그(console.info) — 출력 소음을 막고 내용을 검사한다 */
let infoSpy: jest.SpyInstance;
beforeEach(() => { infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {}); });
afterEach(() => infoSpy.mockRestore());

describe('1. 스위치', () => {
  test('notify_signal_pending 이 꺼져 있으면 아무것도 하지 않는다 (판정도 하지 않는다)', async () => {
    const { d, sent } = deps({ pendingFlag: async () => false });
    expect(await notifyApprovalRequest(args(), d)).toEqual({ kind: 'disabled_flag' });
    expect(sent).toEqual({ plain: [], rich: [] });
    expect(d.assess).not.toHaveBeenCalled();
  });
});

describe('2. 🔴 간단한 본문 — 기존 형식 그대로 + 이스케이프', () => {
  test('형식: 첫 줄 금액·TTL, 사유 줄. 제목은 "📩 승인 요청: 종목"', async () => {
    const { d, sent } = deps();
    expect(await notifyApprovalRequest(args(), d)).toEqual({ kind: 'sent', format: 'plain' });
    expect(sent.plain).toHaveLength(1);
    expect(sent.plain[0].title).toBe('📩 승인 요청: 라벨(NAS:BKNG)');
    expect(sent.plain[0].body).toBe('매수 ₩1,121,925 · TTL 28분\n사유: RSI14=37.4 &lt; 38, price=215496 &lt; MA20=219156, 양봉 반전 → 과매도 반등 시작');
    expect(sent.rich).toEqual([]);
  });

  test('🔴 실제로 78% 를 유실시킨 사유 줄이 이제 텔레그램이 받는 형태다', async () => {
    const { d, sent } = deps();
    await notifyApprovalRequest(args(), d);
    expect(unsafe(sent.plain[0].body)).toBe(0);
    expect(unsafe(sent.plain[0].title)).toBe(0);
  });

  test('🔴 [2라운드 R2-1] 라벨은 이미 이스케이프된 값 — 제목에 *한 번만* 이스케이프된 채 들어간다 (이중 이스케이프 금지)', async () => {
    const { d, sent } = deps({ label: async () => 'AT&amp;T &lt;Inc&gt; P&amp;G' });          // getSymbolLabel 의 반환 형태
    await notifyApprovalRequest(args(), d);
    expect(sent.plain[0].title).toBe('📩 승인 요청: AT&amp;T &lt;Inc&gt; P&amp;G');
    expect(sent.plain[0].title).not.toContain('&amp;amp;');
    expect(unsafe(sent.plain[0].title)).toBe(0);
  });

  test('🔴 [R2-1] 진짜 getSymbolLabel 로 끝까지: stock_meta 의 `Johnson & Johnson` → 제목에 `Johnson &amp; Johnson` (두 번 아님)', async () => {
    (getPool as jest.Mock).mockReturnValue({ query: jest.fn(async () => [[{ name: 'Johnson & Johnson' }]]) });
    const { getSymbolLabel } = jest.requireActual('../../notify/symbol-name') as typeof import('../../notify/symbol-name');
    const { d, sent } = deps({ label: getSymbolLabel });
    await notifyApprovalRequest(args({ symbol: 'NYS:JNJ' }), d);
    expect(sent.plain[0].title).toBe('📩 승인 요청: Johnson &amp; Johnson');
  });

  test('라벨 조회가 실패하면 *원본 심볼*을 이스케이프해서 대신 쓴다 (폴백은 날 값이다)', async () => {
    const { d, sent } = deps({ label: async () => { throw new Error('db down'); } });
    await notifyApprovalRequest(args({ symbol: 'A&B<x>' }), d);
    expect(sent.plain[0].title).toBe('📩 승인 요청: A&amp;B&lt;x&gt;');
    expect(unsafe(sent.plain[0].title)).toBe(0);
  });

  test('청산 유형이 있으면 유형 줄을, 사유는 첫 줄을 쓴다', async () => {
    const { d, sent } = deps();
    await notifyApprovalRequest(args({ side: 'sell', indicators: { exit_kind: 'hard_stop' }, reasoning: '[하드 손절] 손실 -9.00% < -8%\n상세 설명' }), d);
    expect(sent.plain[0].body).toBe('매도 ₩1,121,925 · TTL 28분\n유형: 🔴 손실한도 손절 (자금보호)\n사유: [하드 손절] 손실 -9.00% &lt; -8%');
  });

  test('사유가 없으면 사유 줄이 없다', async () => {
    const { d, sent } = deps();
    await notifyApprovalRequest(args({ reasoning: undefined }), d);
    expect(sent.plain[0].body).toBe('매수 ₩1,121,925 · TTL 28분');
  });

  test('만료 시각이 없으면 TTL 30분(기존 기본값)', () => {
    expect(renderPlainRequest(args({ expiresAt: null }), 'x', NOW).body).toContain('TTL 30분');
  });

  test('pickReasonLine — exit 는 첫 줄, [AI N%] 줄 우선, 100자 제한', () => {
    expect(pickReasonLine('a\nb', 'hard_stop')).toBe('a');
    expect(pickReasonLine('첫줄\n[AI 80%] 근거', undefined)).toBe('[AI 80%] 근거');
    expect(pickReasonLine('x'.repeat(300), undefined)).toHaveLength(100);
    expect(pickReasonLine('', undefined)).toBeUndefined();
    expect(pickReasonLine('\n  \n', undefined)).toBeUndefined();
  });
});

describe('3. 버튼 형식', () => {
  const on = { key: KEY as Buffer | null, enabled: true, appUrl: 'https://stock.example.com/strategy' };

  test('스위치가 켜지고 키가 있으면 풍부한 본문 + 키보드, 간단한 본문은 슬랙용으로 함께 넘긴다', async () => {
    const { d, sent } = deps({}, OK, on);
    expect(await notifyApprovalRequest(args(), d)).toEqual({ kind: 'sent', format: 'buttons' });
    expect(sent.plain).toEqual([]);
    expect(sent.rich).toHaveLength(1);
    const r = sent.rich[0];
    expect(r.text).toContain('📩 <b>승인 요청</b> · 매수 · 해외');
    expect(r.text).toContain('총자산의 4.9%');
    expect(r.text).toContain('오늘 한도 잔여 ₩1,900,000');
    expect(r.text).toContain('현금 ₩3,000,000');
    expect(unsafe(r.text)).toBe(0);
    expect(unsafe(r.plainBody)).toBe(0);
    const rows = (r.keyboard as { inline_keyboard: Array<Array<{ text: string }>> }).inline_keyboard;
    expect(rows[0].map((b) => b.text)).toEqual(['✅ 승인', '❌ 거절']);
    expect(rows[1][0].text).toBe('🔗 앱에서 자세히');
  });

  test('🔴 버튼 서명은 DB 에 저장된 금액으로 한다 (탭 시 서버가 그 값으로 검증)', async () => {
    const { d, sent } = deps({ storedAmount: async () => 1_121_926 }, OK, on);
    await notifyApprovalRequest(args({ amountKRW: 1_121_925.4999 }), d);
    const rows = (sent.rich[0].keyboard as { inline_keyboard: Array<Array<{ callback_data?: string }>> }).inline_keyboard;
    const p = parseCallbackData(rows[0][0].callback_data)!;
    expect(verifyCallbackData(KEY, p, 1_121_926)).toBe(true);
    expect(verifyCallbackData(KEY, p, 1_121_925)).toBe(false);
  });

  test('저장 금액을 읽지 못하면 입력 금액으로 서명한다 (버튼을 포기하지 않는다)', async () => {
    const { d, sent } = deps({ storedAmount: async () => { throw new Error('db down'); } }, OK, on);
    expect(await notifyApprovalRequest(args(), d)).toEqual({ kind: 'sent', format: 'buttons' });
    const rows = (sent.rich[0].keyboard as { inline_keyboard: Array<Array<{ callback_data?: string }>> }).inline_keyboard;
    expect(verifyCallbackData(KEY, parseCallbackData(rows[0][0].callback_data)!, 1_121_925)).toBe(true);
  });

  test('🔴 스위치가 켜져도 서명 키가 없으면 버튼을 달지 않는다 (fail-closed → 간단한 본문)', async () => {
    const { d, sent } = deps({}, OK, { ...on, key: null });
    expect(await notifyApprovalRequest(args(), d)).toEqual({ kind: 'sent', format: 'plain' });
    expect(sent.rich).toEqual([]);
  });

  test('🔴 버튼 설정을 읽다 실패해도 알림은 간단한 본문으로 나간다', async () => {
    const { d, sent } = deps({ buttons: async () => { throw new Error('db down'); } });
    expect(await notifyApprovalRequest(args(), d)).toEqual({ kind: 'sent', format: 'plain' });
    expect(sent.plain).toHaveLength(1);
  });

  test('시나리오 카드(구간 있음)는 승인 = 진입 감시로 안내한다', async () => {
    const { d, sent } = deps({}, OK, on);
    await notifyApprovalRequest(args({ symbol: '005380', market: 'domestic', indicators: { ai: { scenario: { entry: { price_zone: '245000~248500' } } } } }), d);
    expect(sent.rich[0].text).toContain('진입 구간  245,000 ~ 248,500');
    expect(sent.rich[0].text).toContain('진입 감시 등록');
  });

  test('판정 정보가 없으면(판정 실패) 모르는 값은 본문에서 빠진다', async () => {
    const { d, sent } = deps({}, 'throw', on);
    await notifyApprovalRequest(args(), d);
    expect(sent.rich[0].text).not.toContain('총자산의');
    expect(sent.rich[0].text).not.toContain('한도 잔여');
  });
});

describe('4. 🔴 실행 불가 매수는 알림을 보내지 않는다 (T-044 — 요약 제거)', () => {
  const only = (r: NonExecutableReason): ExecutabilityAssessment => ({ executable: false, reasons: [r], ctx: { totalKRW: 22_936_066, cashKRW: 80_000, dailyRemainingKRW: 0 } });

  test.each(['cash', 'daily_limit', 'order_limit'] as NonExecutableReason[])('%s → 발송 0회, suppressed, 서버 로그 1줄', async (r) => {
    const { d, sent } = deps({}, only(r));
    expect(await notifyApprovalRequest(args({ signalId: 18676, symbol: '086280' }), d)).toEqual({ kind: 'suppressed', reasons: [r] });
    expect(sent).toEqual({ plain: [], rich: [] });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith(`[approval-notify] 실행 불가 매수 알림 생략: signal 18676 086280 reasons=${r}`);
  });

  test('🔴 진짜 기본 배선의 발송 함수(sendAlert·dispatchAlertWithTelegram·텔레그램)가 한 번도 불리지 않는다', async () => {
    jest.clearAllMocks();
    const real = defaultDeps();
    const { d } = deps({ sendPlain: real.sendPlain, sendRich: real.sendRich }, NO_CASH);
    expect((await notifyApprovalRequest(args(), d)).kind).toBe('suppressed');
    expect(sendAlert).not.toHaveBeenCalled();
    expect(dispatchAlertWithTelegram).not.toHaveBeenCalled();
    expect(sendTelegramMessage).not.toHaveBeenCalled();
    expect(sendTelegramAlert).not.toHaveBeenCalled();
  });

  test('사유가 여러 개면 로그에 쉼표로 모두 적는다 — 금액·잔고 수치는 싣지 않는다', async () => {
    const mixed: ExecutabilityAssessment = { executable: false, reasons: ['cash', 'daily_limit', 'order_limit'], ctx: { totalKRW: 22_936_066, cashKRW: 80_138, dailyRemainingKRW: 1_900_000 } };
    const { d, sent } = deps({}, mixed);
    expect(await notifyApprovalRequest(args({ signalId: 7, symbol: '005930', amountKRW: 240_572 }), d)).toEqual({ kind: 'suppressed', reasons: ['cash', 'daily_limit', 'order_limit'] });
    expect(sent).toEqual({ plain: [], rich: [] });
    const line = infoSpy.mock.calls[0][0] as string;
    expect(line).toBe('[approval-notify] 실행 불가 매수 알림 생략: signal 7 005930 reasons=cash,daily_limit,order_limit');
    for (const n of ['240572', '240,572', '80138', '80,138', '1900000', '1,900,000', '22936066']) expect(line).not.toContain(n);
  });

  test('🔴 [회귀 방지] 실행 불가 매수가 1시간 안·밖으로 연속 와도 발송 0회 — 요약이 되살아나지 않는다', async () => {
    let t = NOW.getTime();
    const { d, sent } = deps({ now: () => new Date(t) }, NO_CASH);
    const outs = [];
    for (const [sym, stepMin] of [['A', 0], ['B', 10], ['C', 20], ['D', 29], ['E', 2], ['F', 120], ['G', 24 * 60]] as const) {
      t += stepMin * 60_000;
      outs.push(await notifyApprovalRequest(args({ symbol: sym }), d));
    }
    expect(outs.every((o) => o.kind === 'suppressed')).toBe(true);
    expect(sent).toEqual({ plain: [], rich: [] });
    expect(infoSpy).toHaveBeenCalledTimes(7);
    expect(outs.some((o) => 'summarySent' in o)).toBe(false);
  });

  test('🔴 [회귀 방지] 요약 관련 export 가 모듈에 남아 있지 않다', async () => {
    const mod = (await import('../approval-notify')) as Record<string, unknown>;
    expect(mod.tallyUnexecutable).toBeUndefined();
    expect(mod.resetSummaryState).toBeUndefined();
    expect('sendSummary' in defaultDeps()).toBe(false);
  });

  test('버튼 승인이 켜져 있어도 실행 불가 매수는 보내지 않는다', async () => {
    const { d, sent } = deps({}, NO_CASH, { key: KEY, enabled: true, appUrl: null });
    expect((await notifyApprovalRequest(args(), d)).kind).toBe('suppressed');
    expect(sent).toEqual({ plain: [], rich: [] });
  });

  test('🔴 매도는 실행 불가 판정을 받지 않는다 — 청산 요청은 항상 보낸다', async () => {
    const { d, sent } = deps({}, NO_CASH);
    expect(await notifyApprovalRequest(args({ side: 'sell' }), d)).toEqual({ kind: 'sent', format: 'plain' });
    expect(sent.plain).toHaveLength(1);
    expect(d.assess).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  test('notify_skip_unexecutable=false 이면 실행 불가여도 개별 승인 요청을 보낸다', async () => {
    const { d, sent } = deps({ skipUnexecutable: async () => false }, NO_CASH);
    expect(await notifyApprovalRequest(args(), d)).toEqual({ kind: 'sent', format: 'plain' });
    expect(sent.plain).toHaveLength(1);
    expect(sent.plain[0].title).toBe('📩 승인 요청: 라벨(NAS:BKNG)');
    expect(d.assess).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  test('🔴 판정이 던지면(조회 실패) 실행 가능으로 보고 보낸다', async () => {
    const { d, sent } = deps({}, 'throw');
    expect(await notifyApprovalRequest(args(), d)).toEqual({ kind: 'sent', format: 'plain' });
    expect(sent.plain).toHaveLength(1);
    expect(infoSpy).not.toHaveBeenCalled();
  });

  test('🔴 판정이 null 이면(불확실) 실행 가능으로 보고 보낸다', async () => {
    const { d, sent } = deps({ assess: jest.fn(async () => null) as unknown as NotifyDeps['assess'] });
    expect(await notifyApprovalRequest(args(), d)).toEqual({ kind: 'sent', format: 'plain' });
    expect(sent.plain).toHaveLength(1);
    expect(infoSpy).not.toHaveBeenCalled();
  });

  test('스위치 조회가 던지면 억제하지 않는다', async () => {
    const { d, sent } = deps({ skipUnexecutable: async () => { throw new Error('x'); } }, NO_CASH);
    expect((await notifyApprovalRequest(args(), d)).kind).toBe('sent');
    expect(sent.plain).toHaveLength(1);
  });

  test('실행 가능 매수는 기존과 같이 개별 승인 요청을 보내고 생략 로그를 남기지 않는다', async () => {
    const { d, sent } = deps({}, OK);
    expect(await notifyApprovalRequest(args(), d)).toEqual({ kind: 'sent', format: 'plain' });
    expect(sent.plain).toHaveLength(1);
    expect(d.assess).toHaveBeenCalledTimes(1);
    expect(infoSpy).not.toHaveBeenCalled();
  });
});

describe('defaultDeps().sendRich — 버튼 메시지가 실패하면 간단한 본문으로라도 알린다', () => {
  const kb = { inline_keyboard: [[{ text: '✅ 승인', callback_data: 'si1:a:1:0000000000000000' }]] };
  beforeEach(() => {
    jest.clearAllMocks();
    // dispatchAlertWithTelegram 이 넘겨받은 텔레그램 발송 함수를 실제로 실행하고 그 결과를 돌려주게 한다
    (dispatchAlertWithTelegram as jest.Mock).mockImplementation(async (_l, _t, _b, send: () => Promise<unknown>) => ({ result: await send() }));
  });
  const run = async () => {
    await defaultDeps().sendRich('제목', '간단 본문', '<b>풍부한 본문</b>', kb);
    return (dispatchAlertWithTelegram as jest.Mock).mock.results[0].value as Promise<{ result: unknown }>;
  };

  test('버튼 메시지가 성공하면 대체 전송을 하지 않는다', async () => {
    (sendTelegramMessage as jest.Mock).mockResolvedValue({ ok: true, result: { message_id: 1, chat: { id: 1 } } });
    expect((await run()).result).toEqual({ ok: true });
    expect(sendTelegramMessage).toHaveBeenCalledWith('<b>풍부한 본문</b>', kb);
    expect(sendTelegramAlert).not.toHaveBeenCalled();
  });

  test('🔴 버튼 메시지가 400 등으로 실패하면 간단한 본문을 같은 제목으로 다시 보낸다', async () => {
    (sendTelegramMessage as jest.Mock).mockResolvedValue({ ok: false, status: 400, error: 'HTTP 400 BUTTON_URL_INVALID' });
    (sendTelegramAlert as jest.Mock).mockResolvedValue({ ok: true });
    const out = await run();
    expect(sendTelegramAlert).toHaveBeenCalledWith('info', '제목', '간단 본문');
    expect(out.result).toEqual({ ok: true });                      // 대체 전송의 결과가 채널 결과가 된다
  });

  test('토큰 미설정(skipped)은 대체하지 않는다 — 어차피 못 보낸다', async () => {
    (sendTelegramMessage as jest.Mock).mockResolvedValue({ ok: false, skipped: true, error: 'telegram_not_configured' });
    expect((await run()).result).toEqual({ ok: false, skipped: true });
    expect(sendTelegramAlert).not.toHaveBeenCalled();
  });
});

describe('5. 🔴 notify_skip_unexecutable — 키 없음 또는 정확히 true 일 때만 생략 (T-044 Codex low · T-058 흡수)', () => {
  /** 진짜 defaultDeps 의 스위치 읽기 — system_config 조회 결과만 바꾼다 */
  const withConfig = (row: { value: string } | null | 'throw') => {
    (getPool as jest.Mock).mockReturnValue({
      query: jest.fn(async (_sql: string, params: unknown[]) => {
        if (row === 'throw') throw new Error('db down');
        return [params?.[0] === 'notify_skip_unexecutable' && row ? [row] : []];
      }),
    });
  };

  test.each([
    ['키 없음', null, true],
    ['true', { value: 'true' }, true],
    ['false', { value: 'false' }, false],
    ['"false"(문자열)', { value: '"false"' }, false],
    ['"true"(문자열)', { value: '"true"' }, false],
    ['0', { value: '0' }, false],
    ['1', { value: '1' }, false],
    ['null', { value: 'null' }, false],
    ['파싱 실패', { value: 'yes please' }, false],
    ['빈 문자열', { value: '' }, false],
    ['읽기 오류', 'throw', false],
  ] as const)('%s → 생략=%s', async (_l, row, skip) => {
    withConfig(row as { value: string } | null | 'throw');
    expect(await defaultDeps().skipUnexecutable()).toBe(skip);
  });

  test.each([
    ['"false"', { value: '"false"' }],
    ['0', { value: '0' }],
    ['null', { value: 'null' }],
    ['파싱 실패', { value: '{' }],
    ['읽기 오류', 'throw'],
  ] as const)('🔴 끝까지: 스위치가 %s 이면 실행 불가 매수라도 승인 요청을 보낸다 (예전에는 생략됐다)', async (_l, row) => {
    withConfig(row as { value: string } | 'throw');
    const real = defaultDeps();
    const { d, sent } = deps({ skipUnexecutable: real.skipUnexecutable }, NO_CASH);
    expect(await notifyApprovalRequest(args(), d)).toEqual({ kind: 'sent', format: 'plain' });
    expect(sent.plain).toHaveLength(1);
    expect(d.assess).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  test('끝까지: 키 없음이면 실행 불가 매수는 생략된다 (기본 켜짐 유지)', async () => {
    withConfig(null);
    const real = defaultDeps();
    const { d, sent } = deps({ skipUnexecutable: real.skipUnexecutable }, NO_CASH);
    expect((await notifyApprovalRequest(args(), d)).kind).toBe('suppressed');
    expect(sent).toEqual({ plain: [], rich: [] });
  });
});
