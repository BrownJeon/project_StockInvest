/**
 * T-042 — 텔레그램 버튼 콜백 처리기.
 *
 * 🔴 버튼 한 번 = 거래 승인이다. 이 파일은 "누가·무엇을·어떤 상태에서 눌러도" 안전한지를 고정한다.
 *   - 허용 목록 밖은 **상태를 읽기도 전에** 거부
 *   - 서명이 틀리거나 금액이 바뀌면 거부
 *   - 오래된 메시지(이미 처리·만료·킬스위치 ON)의 버튼도 거래를 일으키지 못한다
 *   - 승인은 기존 승인 함수(→ submitOrder 게이트)만 부른다
 */
import { handleCallbackQuery, mapFailure, type ApprovalDeps, type ApprovalSignalView } from '../telegram-approval';
import { deriveApprovalKey, encodeCallbackData } from '../telegram-callback-data';
import type { TelegramCallbackQuery } from '@/lib/notify/telegram-api';

const KEY = deriveApprovalKey('a-session-secret-that-is-long-enough-1234567890')!;
const OWNER = 7001;
const CHAT = 7001;
const NOW = new Date('2026-10-12T04:20:00Z');

const RULE_SIGNAL: ApprovalSignalView = {
  id: 100, status: 'awaiting_approval', symbol: 'NAS:BKNG', side: 'buy', amount_krw: '1121925.00',
  indicators: JSON.stringify({ rsi14: 37.4 }), expires_at: new Date(NOW.getTime() + 20 * 60_000),
};
const CARD_SIGNAL: ApprovalSignalView = {
  ...RULE_SIGNAL, id: 101, symbol: '005380',
  indicators: JSON.stringify({ ai: { scenario: { entry: { price_zone: '245000~248500' } } } }),
};

interface Harness {
  deps: ApprovalDeps;
  calls: string[];
  answers: Array<{ text?: string; alert?: boolean }>;
  edits: Array<{ chatId: number; messageId: number; text: string; keyboard?: unknown }>;
  clears: Array<{ chatId: number; messageId: number }>;
  sends: Array<{ text: string; keyboard?: unknown }>;
  audits: Array<{ event: string; payload: Record<string, unknown> }>;
  approve: jest.Mock;
  reject: jest.Mock;
  getSignal: jest.Mock;
}

interface HarnessOpts { signals?: ApprovalSignalView[]; hybrid?: boolean; killSwitch?: boolean; featureOn?: boolean }

/** `opts` = 시나리오 설정, `depsOver` = 의존성 직접 덮어쓰기 (이름이 겹치지 않게 분리) */
function harness(opts: HarnessOpts = {}, depsOver: Partial<ApprovalDeps> = {}): Harness {
  const calls: string[] = [];
  const answers: Harness['answers'] = [];
  const edits: Harness['edits'] = [];
  const clears: Harness['clears'] = [];
  const sends: Harness['sends'] = [];
  const audits: Harness['audits'] = [];
  const signals = opts.signals ?? [RULE_SIGNAL, CARD_SIGNAL];
  const getSignal = jest.fn(async (id: number) => { calls.push('getSignal'); return signals.find((s) => s.id === id) ?? null; });
  const approve = jest.fn(async () => { calls.push('approve'); return { ok: true, orderId: 3250 }; });
  const reject = jest.fn(async () => { calls.push('reject'); return { ok: true }; });
  const deps: ApprovalDeps = {
    key: KEY,
    now: () => NOW,
    enabled: async () => opts.featureOn ?? true,
    allowedUserIds: async () => new Set([String(OWNER)]),
    allowedChatIds: async () => new Set([String(CHAT)]),
    getSignal,
    isKillSwitchActive: async () => opts.killSwitch ?? false,
    isHybridEnabled: async () => opts.hybrid ?? true,
    approve, reject,
    label: async (s) => `라벨(${s})`,
    appUrl: async () => 'https://stock.example.com/strategy',
    audit: async (event, payload) => { audits.push({ event, payload }); },
    telegram: {
      answer: async (_id, text, alert) => { calls.push('answer'); answers.push({ text, alert }); },
      edit: async (chatId, messageId, text, keyboard) => { calls.push('edit'); edits.push({ chatId, messageId, text, keyboard }); },
      clearKeyboard: async (chatId, messageId) => { calls.push('clear'); clears.push({ chatId, messageId }); },
      send: async (text, keyboard) => { calls.push('send'); sends.push({ text, keyboard }); },
    },
    ...depsOver,
  };
  return { deps, calls, answers, edits, clears, sends, audits, approve, reject, getSignal };
}

function press(action: 'a' | 'r' | 't', signal: ApprovalSignalView | { id: number; amount_krw: number }, from = OWNER, chat: number | null = CHAT): TelegramCallbackQuery {
  const data = encodeCallbackData(KEY, action, action === 't' ? 0 : signal.id, action === 't' ? 0 : Number(signal.amount_krw));
  return {
    id: 'cbq-1', from: { id: from }, data,
    ...(chat == null ? {} : { message: { message_id: 55, chat: { id: chat } } }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('1. 형식 — 우리 것이 아니면 조용히 무시', () => {
  test.each([undefined, '', 'tradinginvest:approve:1', 'si2:a:1:abcdef0123456789', 'garbage'])('data=%j', async (data) => {
    const h = harness();
    const out = await handleCallbackQuery({ id: 'q', from: { id: OWNER }, data, message: { message_id: 1, chat: { id: CHAT } } }, h.deps);
    expect(out).toEqual({ kind: 'ignored' });
    expect(h.calls).toEqual([]);                      // 답도 하지 않는다 — 다른 프로젝트 콜백을 건드리지 않는다
  });
});

describe('2. 🔴 발신자 — 상태를 읽기 전에 거부', () => {
  test('허용 목록에 없는 사용자', async () => {
    const h = harness();
    const unauthorized = jest.fn();
    h.deps.onUnauthorized = unauthorized;
    const out = await handleCallbackQuery(press('a', RULE_SIGNAL, 9999), h.deps);
    expect(out).toEqual({ kind: 'denied' });
    expect(h.getSignal).not.toHaveBeenCalled();       // 상태를 읽지도 않는다
    expect(h.approve).not.toHaveBeenCalled();
    expect(h.answers[0]).toMatchObject({ text: '권한이 없습니다', alert: true });
    expect(h.audits[0].event).toBe('telegram_callback_denied');
    expect(unauthorized).toHaveBeenCalledWith({ fromId: 9999, chatId: CHAT, action: 'a' });
  });

  test('허용 목록에 없는 채팅 (같은 사용자라도 다른 곳에서 누름)', async () => {
    const h = harness();
    expect((await handleCallbackQuery(press('a', RULE_SIGNAL, OWNER, 12345), h.deps)).kind).toBe('denied');
    expect(h.approve).not.toHaveBeenCalled();
  });

  test('메시지 정보가 없는 콜백(오래된 메시지 등)은 채팅을 확인할 수 없으므로 거부', async () => {
    const h = harness();
    expect((await handleCallbackQuery(press('a', RULE_SIGNAL, OWNER, null), h.deps)).kind).toBe('denied');
    expect(h.approve).not.toHaveBeenCalled();
  });

  test('봇이 보낸 콜백은 거부', async () => {
    const h = harness();
    const cq = press('a', RULE_SIGNAL);
    cq.from.is_bot = true;
    expect((await handleCallbackQuery(cq, h.deps)).kind).toBe('denied');
  });

  test('경보 콜백이 던져도 응답 처리는 계속된다', async () => {
    const h = harness();
    h.deps.onUnauthorized = () => { throw new Error('alert down'); };
    await expect(handleCallbackQuery(press('a', RULE_SIGNAL, 9999), h.deps)).resolves.toEqual({ kind: 'denied' });
    expect(h.answers).toHaveLength(1);
  });

  test('허용 목록이 비어 있으면(설정 누락) 전부 거부 — fail-closed', async () => {
    const h = harness({}, { allowedUserIds: async () => new Set<string>() });
    expect((await handleCallbackQuery(press('a', RULE_SIGNAL), h.deps)).kind).toBe('denied');
  });
});

describe('3. 서명 키·기능 스위치', () => {
  test('🔴 서명 키가 없으면 거래 동작을 하지 않는다', async () => {
    const h = harness({}, { key: null });
    expect((await handleCallbackQuery(press('a', RULE_SIGNAL), h.deps)).kind).toBe('no_key');
    expect(h.approve).not.toHaveBeenCalled();
    expect(h.getSignal).not.toHaveBeenCalled();
  });

  test('🔴 기능 스위치가 꺼져 있으면 거래 동작을 하지 않는다', async () => {
    const h = harness({ featureOn: false });
    expect((await handleCallbackQuery(press('a', RULE_SIGNAL), h.deps)).kind).toBe('disabled');
    expect((await handleCallbackQuery(press('r', RULE_SIGNAL), h.deps)).kind).toBe('disabled');
    expect(h.approve).not.toHaveBeenCalled();
    expect(h.reject).not.toHaveBeenCalled();
    expect(h.getSignal).not.toHaveBeenCalled();
  });

  test('자가 점검은 스위치가 꺼져 있어도 동작한다 — 켜기 전에 사슬을 시험하려고', async () => {
    const h = harness({ featureOn: false });
    const out = await handleCallbackQuery(press('t', { id: 0, amount_krw: 0 }), h.deps);
    expect(out).toEqual({ kind: 'selftest' });
    expect(h.answers[0].text).toContain('점검 통과');
    expect(h.edits[0].text).toContain('자가 점검 통과');
    expect(h.audits[0].event).toBe('telegram_selftest_ok');
    expect(h.approve).not.toHaveBeenCalled();
    expect(h.reject).not.toHaveBeenCalled();
  });

  test('자가 점검도 허용 목록·서명을 거친다', async () => {
    const h = harness();
    expect((await handleCallbackQuery(press('t', { id: 0, amount_krw: 0 }, 9999), h.deps)).kind).toBe('denied');
    const forged = press('t', { id: 0, amount_krw: 0 });
    forged.data = forged.data!.replace(/[0-9a-f]{16}$/, '0000000000000000');
    expect((await handleCallbackQuery(forged, h.deps)).kind).toBe('invalid');
  });

  test('자가 점검 서명을 시그널 ID 가 있는 다른 동작에 쓸 수 없다', async () => {
    const h = harness();
    const cq = press('t', { id: 0, amount_krw: 0 });
    cq.data = cq.data!.replace(':t:0:', ':t:100:');
    expect((await handleCallbackQuery(cq, h.deps)).kind).toBe('invalid');
    expect(h.approve).not.toHaveBeenCalled();
  });
});

describe('4. 🔴 서명 — 지금 DB 의 금액으로 다시 계산', () => {
  test('시그널을 찾을 수 없으면 거부', async () => {
    const h = harness({ signals: [] });
    expect(await handleCallbackQuery(press('a', RULE_SIGNAL), h.deps)).toEqual({ kind: 'invalid', reason: 'not_found' });
    expect(h.approve).not.toHaveBeenCalled();
  });

  test('보낼 때 금액과 지금 금액이 다르면(시그널이 바뀌면) 거부 + 버튼 제거', async () => {
    const changed = { ...RULE_SIGNAL, amount_krw: '2000000.00' };
    const h = harness({ signals: [changed] });
    const out = await handleCallbackQuery(press('a', RULE_SIGNAL), h.deps);      // 버튼은 1,121,925 로 서명됨
    expect(out).toEqual({ kind: 'invalid', reason: 'bad_signature' });
    expect(h.approve).not.toHaveBeenCalled();
    expect(h.edits[0].text).toContain('더 이상 유효하지 않습니다');
    expect(h.edits[0].keyboard).toBeUndefined();
    expect(h.audits.some((a) => a.event === 'telegram_callback_bad_signature')).toBe(true);
  });

  test('🔴 [3라운드 R8] 서명 불일치 분기에서도 라벨 조회가 실패하면 *이스케이프한* 원본 심볼을 쓴다', async () => {
    const changed = { ...RULE_SIGNAL, symbol: 'A&B<x>', amount_krw: '2000000.00' };
    const h = harness({ signals: [changed] });
    h.deps.label = async () => { throw new Error('stock_meta down'); };
    await handleCallbackQuery(press('a', { ...RULE_SIGNAL, symbol: 'A&B<x>' } as never), h.deps);   // 버튼은 1,121,925 로 서명됨
    expect(h.edits[0].text).toContain('<b>A&amp;B&lt;x&gt;</b>');
  });

  test('위조된 서명은 거부', async () => {
    const h = harness();
    const cq = press('a', RULE_SIGNAL);
    cq.data = cq.data!.replace(/[0-9a-f]{16}$/, 'deadbeefdeadbeef');
    expect((await handleCallbackQuery(cq, h.deps)).kind).toBe('invalid');
    expect(h.approve).not.toHaveBeenCalled();
  });

  test('다른 시그널의 서명을 가져다 붙이면 거부', async () => {
    const h = harness();
    const cq = press('a', CARD_SIGNAL);
    cq.data = cq.data!.replace(':101:', ':100:');
    expect((await handleCallbackQuery(cq, h.deps)).kind).toBe('invalid');
    expect(h.approve).not.toHaveBeenCalled();
  });
});

describe('5. 상태 재확인 — 오래된 메시지의 버튼도 안전', () => {
  test.each(['approved', 'approved_pending_entry', 'executing', 'rejected', 'auto_submitted', 'superseded'])(
    '이미 %s 이면 승인 함수를 부르지 않는다 (멱등) — 본문은 덮어쓰지 않고 토스트 + 버튼 제거만',
    async (status) => {
      const h = harness({ signals: [{ ...RULE_SIGNAL, status }] });
      const out = await handleCallbackQuery(press('a', RULE_SIGNAL), h.deps);
      expect(out).toMatchObject({ kind: 'decision', view: { kind: 'already_handled', status } });
      expect(h.approve).not.toHaveBeenCalled();
      expect(h.edits).toEqual([]);                                          // 🔴 첫 처리의 결과(주문 번호)를 덮어쓰지 않는다 (감사 D-4)
      expect(h.clears).toEqual([{ chatId: CHAT, messageId: 55 }]);          // 버튼만 제거
      expect(h.answers).toHaveLength(1);                                    // 콜백 응답은 한 번 — 상태를 알리는 토스트
      expect(h.answers[0]).toMatchObject({ alert: true });
      expect(h.answers[0].text).toContain('이미 처리된 시그널');
    },
  );

  test('만료된 시그널 → 만료 토스트 + 본문을 만료로 수정, 승인 함수 호출 없음', async () => {
    const h = harness({ signals: [{ ...RULE_SIGNAL, status: 'expired' }] });
    const out = await handleCallbackQuery(press('a', RULE_SIGNAL), h.deps);
    expect(out).toMatchObject({ view: { kind: 'expired' } });
    expect(h.approve).not.toHaveBeenCalled();
    expect(h.answers[0].text).toContain('만료');
    expect(h.edits[0].text).toContain('만료됨');
    expect(h.edits[0].keyboard).toBeUndefined();
  });

  test('🔴 킬스위치 ON 이면 승인하지 않는다 — 메시지는 그대로 두고(버튼 유지, 해제 후 다시 누를 수 있게) 토스트로만 알린다', async () => {
    const h = harness({ killSwitch: true });
    const out = await handleCallbackQuery(press('a', RULE_SIGNAL), h.deps);
    expect(out).toMatchObject({ view: { kind: 'kill_switch' } });
    expect(h.approve).not.toHaveBeenCalled();
    expect(h.edits).toEqual([]);
    expect(h.clears).toEqual([]);
    expect(h.answers[0]).toMatchObject({ alert: true });
    expect(h.answers[0].text).toContain('킬스위치');
  });

  test('킬스위치가 켜져 있어도 거절은 할 수 있다 (거절은 거래가 아니다)', async () => {
    const h = harness({ killSwitch: true });
    const out = await handleCallbackQuery(press('r', RULE_SIGNAL), h.deps);
    expect(out).toMatchObject({ view: { kind: 'rejected' } });
    expect(h.reject).toHaveBeenCalledWith(100);
  });

  test('detected(manual 모드 관측 기록)는 거절만 가능, 승인은 불가', async () => {
    const sig = { ...RULE_SIGNAL, status: 'detected' };
    const ha = harness({ signals: [sig] });
    expect((await handleCallbackQuery(press('a', sig), ha.deps))).toMatchObject({ view: { kind: 'already_handled' } });
    expect(ha.approve).not.toHaveBeenCalled();
    const hr = harness({ signals: [sig] });
    expect((await handleCallbackQuery(press('r', sig), hr.deps))).toMatchObject({ view: { kind: 'rejected' } });
  });

  test('빠른 판정 경로에서도 감사 기록을 남긴다', async () => {
    const h = harness({ signals: [{ ...RULE_SIGNAL, status: 'approved' }] });
    await handleCallbackQuery(press('a', RULE_SIGNAL), h.deps);
    expect(h.audits).toEqual([{ event: 'signal_decision_channel', payload: expect.objectContaining({ result: 'already_handled', via: 'telegram', action: 'approve' }) }]);
  });
});

describe('6. 승인 — 기존 승인 함수만 부르고, 경로는 구간 유무로 정한다 (D1)', () => {
  test('구간 없는 룰 시그널 + 하이브리드 ON → 즉시 주문 경로 (감시로 보내지 않는다)', async () => {
    const h = harness({ hybrid: true });
    const out = await handleCallbackQuery(press('a', RULE_SIGNAL), h.deps);
    expect(h.approve).toHaveBeenCalledWith(100, 'immediate');
    expect(out).toMatchObject({ kind: 'decision', action: 'approve', path: 'immediate', view: { kind: 'order_placed', orderId: 3250 } });
    expect(h.edits[0].text).toContain('주문 접수 #3250');
    expect(h.edits[0].keyboard).toBeUndefined();
  });

  test('구간이 있는 카드 + 하이브리드 ON → 진입 감시', async () => {
    const h = harness({ hybrid: true });
    const out = await handleCallbackQuery(press('a', CARD_SIGNAL), h.deps);
    expect(h.approve).toHaveBeenCalledWith(101, 'hybrid');
    expect(out).toMatchObject({ view: { kind: 'entry_watch' }, path: 'hybrid' });
    expect(h.edits[0].text).toContain('진입 감시 등록');
  });

  test('하이브리드 OFF → 구간이 있어도 즉시', async () => {
    const h = harness({ hybrid: false });
    await handleCallbackQuery(press('a', CARD_SIGNAL), h.deps);
    expect(h.approve).toHaveBeenCalledWith(101, 'immediate');
  });

  test('🔴 주문이 거부되면 "승인됨"이 아니라 거부로 알리고 버튼을 남긴다', async () => {
    const h = harness();
    h.approve.mockResolvedValueOnce({ ok: false, error: 'order_not_accepted: order_limit', errorCode: 'order_not_accepted' });
    const out = await handleCallbackQuery(press('a', RULE_SIGNAL), h.deps);
    expect(out).toMatchObject({ view: { kind: 'order_rejected' } });
    expect(h.edits[0].text).toContain('승인했지만 주문이 거부됨');
    expect(h.edits[0].text).not.toContain('✅');
    expect(h.edits[0].keyboard).toBeDefined();
  });

  test('전이에서 졌을 때(다른 쪽이 먼저 처리)의 실패 코드를 사람 말로 옮긴다', async () => {
    const h = harness();
    h.approve.mockResolvedValueOnce({ ok: false, error: 'invalid_status:approved' });
    expect(await handleCallbackQuery(press('a', RULE_SIGNAL), h.deps)).toMatchObject({ view: { kind: 'already_handled', status: 'approved' } });
    const h2 = harness();
    h2.approve.mockResolvedValueOnce({ ok: false, error: 'signal_expired' });
    expect(await handleCallbackQuery(press('a', RULE_SIGNAL), h2.deps)).toMatchObject({ view: { kind: 'expired' } });
  });

  test.each(['approved', 'approved_pending_entry', 'executing', 'rejected', 'auto_submitted', 'superseded'])(
    '🔴 [T-047] 승인 전이에서 졌을 때(invalid_status:%s) 본문을 덮어쓰지 않고 버튼만 제거한다 — 이긴 쪽의 결과(주문 번호)를 지우지 않는다',
    async (status) => {
      const h = harness();
      h.approve.mockResolvedValueOnce({ ok: false, error: `invalid_status:${status}` });
      const out = await handleCallbackQuery(press('a', RULE_SIGNAL), h.deps);
      expect(out).toMatchObject({ kind: 'decision', action: 'approve', view: { kind: 'already_handled', status } });
      expect(h.edits).toEqual([]);                                          // 본문 수정 없음
      expect(h.sends).toEqual([]);                                          // 대체 메시지도 없음 (수정 실패가 아니다)
      expect(h.clears).toEqual([{ chatId: CHAT, messageId: 55 }]);          // 버튼만 제거
      expect(h.answers).toEqual([{ text: '처리 중…', alert: undefined }]);  // 응답은 이미 한 번 했다 — 두 번째는 텔레그램이 거부한다
      expect(h.audits.at(-1)).toMatchObject({ event: 'signal_decision_channel', payload: { result: 'already_handled', action: 'approve' } });
    },
  );

  test('🔴 [T-047] 거절 전이에서 졌을 때도 본문을 덮어쓰지 않고 버튼만 제거한다', async () => {
    const h = harness();
    h.reject.mockResolvedValueOnce({ ok: false, error: 'invalid_status:executing' });
    const out = await handleCallbackQuery(press('r', RULE_SIGNAL), h.deps);
    expect(out).toMatchObject({ action: 'reject', view: { kind: 'already_handled', status: 'executing' } });
    expect(h.edits).toEqual([]);
    expect(h.sends).toEqual([]);
    expect(h.clears).toEqual([{ chatId: CHAT, messageId: 55 }]);
    expect(h.answers).toHaveLength(1);
  });

  test('[T-047] 전이 패배라도 만료(signal_expired·invalid_status:expired)는 지금처럼 본문을 만료로 바꾼다 — 가릴 주문 번호가 없다', async () => {
    for (const error of ['signal_expired', 'invalid_status:expired']) {
      const h = harness();
      h.approve.mockResolvedValueOnce({ ok: false, error });
      await handleCallbackQuery(press('a', RULE_SIGNAL), h.deps);
      expect(h.edits).toHaveLength(1);
      expect(h.edits[0].text).toContain('만료됨');
      expect(h.clears).toEqual([]);
    }
  });

  test('[T-047] 전이 패배 + 메시지 ID 를 모를 때(수정할 본문이 없음)는 새 메시지로만 알린다 — 덮어쓸 것이 없다', async () => {
    const h = harness();
    h.approve.mockResolvedValueOnce({ ok: false, error: 'invalid_status:approved' });
    const cq = press('a', RULE_SIGNAL);
    (cq.message as { message_id?: number }).message_id = undefined as unknown as number;
    await handleCallbackQuery(cq, h.deps);
    expect(h.edits).toEqual([]);
    expect(h.clears).toEqual([]);
    expect(h.sends).toHaveLength(1);
    expect(h.sends[0].text).toContain('이미 처리된 시그널');
  });

  test('🔴 승인 함수가 예외를 던져도 처리기는 던지지 않고 실패를 알린다 (버튼 유지)', async () => {
    const h = harness();
    h.approve.mockRejectedValueOnce(new Error('kis down'));
    const out = await handleCallbackQuery(press('a', RULE_SIGNAL), h.deps);
    expect(out).toMatchObject({ view: { kind: 'failed' } });
    expect(h.edits[0].text).toContain('kis down');
    expect(h.edits[0].keyboard).toBeDefined();
  });

  test('DRY_RUN 결과는 실제 주문이 아니라고 알린다', async () => {
    const h = harness();
    h.approve.mockResolvedValueOnce({ ok: true, orderId: 9, dryRun: true });
    await handleCallbackQuery(press('a', RULE_SIGNAL), h.deps);
    expect(h.edits[0].text).toContain('DRY_RUN');
  });
});

describe('7. 거절', () => {
  test('거절 → reject 호출 + 버튼 제거', async () => {
    const h = harness();
    const out = await handleCallbackQuery(press('r', RULE_SIGNAL), h.deps);
    expect(h.reject).toHaveBeenCalledWith(100);
    expect(h.approve).not.toHaveBeenCalled();
    expect(out).toMatchObject({ action: 'reject', view: { kind: 'rejected' } });
    expect(h.edits[0].keyboard).toBeUndefined();
  });

  test('거절 전이에서 지면(이미 승인됨) 그 사실을 알린다', async () => {
    const h = harness();
    h.reject.mockResolvedValueOnce({ ok: false, error: 'invalid_status:approved' });
    expect(await handleCallbackQuery(press('r', RULE_SIGNAL), h.deps)).toMatchObject({ view: { kind: 'already_handled', status: 'approved' } });
  });
});

describe('8. 응답 순서·감사·내결함성', () => {
  test('🔴 거래 처리 전에 콜백에 먼저 응답한다 (텔레그램 응답 제한 시간 안에)', async () => {
    const h = harness();
    await handleCallbackQuery(press('a', RULE_SIGNAL), h.deps);
    expect(h.calls.indexOf('answer')).toBeGreaterThan(-1);
    expect(h.calls.indexOf('answer')).toBeLessThan(h.calls.indexOf('approve'));
    expect(h.calls.indexOf('approve')).toBeLessThan(h.calls.indexOf('edit'));
    expect(h.answers.filter((a) => a.text === '처리 중…')).toHaveLength(1);       // 콜백 응답은 한 번만 가능
  });

  test('🔴 감사 기록: 누가(텔레그램 사용자)·어떤 경로로·무슨 결과를 남긴다', async () => {
    const h = harness();
    await handleCallbackQuery(press('a', RULE_SIGNAL), h.deps);
    expect(h.audits).toEqual([{
      event: 'signal_decision_channel',
      payload: { signalId: 100, action: 'approve', via: 'telegram', fromId: OWNER, chatId: CHAT, result: 'order_placed', path: 'immediate' },
    }]);
  });

  test('🔴 텔레그램 호출(응답·수정)이 전부 실패해도 이미 반영된 거래 결정과 결과는 그대로다', async () => {
    const h = harness();
    h.deps.telegram.answer = async () => { throw new Error('tg down'); };
    h.deps.telegram.edit = async () => { throw new Error('tg down'); };
    const out = await handleCallbackQuery(press('a', RULE_SIGNAL), h.deps);
    expect(out).toMatchObject({ kind: 'decision', view: { kind: 'order_placed' } });
    expect(h.approve).toHaveBeenCalledTimes(1);
    expect(h.audits).toHaveLength(1);
  });

  test('감사 기록이 실패해도 처리기는 던지지 않는다', async () => {
    const h = harness();
    h.deps.audit = async () => { throw new Error('db down'); };
    await expect(handleCallbackQuery(press('a', RULE_SIGNAL), h.deps)).resolves.toMatchObject({ kind: 'decision' });
  });

  test('종목명 조회가 실패하면 *이스케이프한* 원본 심볼로 대신한다 (폴백은 날 값이다)', async () => {
    const h = harness({ signals: [{ ...RULE_SIGNAL, symbol: 'A&B<x>' }] });
    h.deps.label = async () => { throw new Error('stock_meta down'); };
    await handleCallbackQuery(press('a', { ...RULE_SIGNAL, symbol: 'A&B<x>' } as never), h.deps);
    expect(h.edits[0].text).toContain('<b>A&amp;B&lt;x&gt;</b>');
  });

  test('🔴 [2라운드 R2-1] 라벨은 이미 이스케이프된 값이라 결과 메시지에 *그대로* 들어간다 (Johnson &amp; Johnson 이 &amp;amp; 가 되지 않는다)', async () => {
    const h = harness();
    h.deps.label = async () => 'Johnson &amp; Johnson';                 // 진짜 getSymbolLabel 의 반환 형태
    await handleCallbackQuery(press('a', RULE_SIGNAL), h.deps);
    expect(h.edits[0].text).toContain('<b>Johnson &amp; Johnson</b>');
    expect(h.edits[0].text).not.toContain('&amp;amp;');
  });

  test('같은 버튼을 연달아 두 번 눌러도 승인 함수는 한 번만 호출된다 (두 번째는 이미 처리됨)', async () => {
    const signals = [{ ...RULE_SIGNAL }];
    const h = harness({ signals });
    h.approve.mockImplementation(async () => { signals[0].status = 'approved'; return { ok: true, orderId: 1 }; });
    const first = await handleCallbackQuery(press('a', RULE_SIGNAL), h.deps);
    const second = await handleCallbackQuery(press('a', RULE_SIGNAL), h.deps);
    expect(first).toMatchObject({ view: { kind: 'order_placed' } });
    expect(second).toMatchObject({ view: { kind: 'already_handled', status: 'approved' } });
    expect(h.approve).toHaveBeenCalledTimes(1);
    // 🔴 두 번째 탭이 첫 결과(주문 접수 #번호)를 덮어쓰지 않는다 — 수정은 첫 처리의 한 번뿐
    expect(h.edits).toHaveLength(1);
    expect(h.edits[0].text).toContain('주문 접수 #1');
  });
});

describe('🔴 결과 불명 (T-042 감사 D-1) — 재시도하면 이중 주문이 될 수 있다', () => {
  test('order_uncertain 은 버튼 없이 "잠갔다·다시 승인하지 마세요"를 알린다 (주문 번호 포함)', async () => {
    const h = harness();
    h.approve.mockResolvedValueOnce({ ok: false, orderId: 2001, error: 'order_uncertain: fetch failed (ECONNRESET)', errorCode: 'order_uncertain' });
    const out = await handleCallbackQuery(press('a', RULE_SIGNAL), h.deps);
    expect(out).toMatchObject({ view: { kind: 'order_uncertain', orderId: 2001 } });
    expect(h.edits[0].text).toContain('주문 결과를 확인하지 못했습니다');
    expect(h.edits[0].text).toContain('주문 #2001');
    expect(h.edits[0].text).toContain('이중 주문');
    expect(h.edits[0].text).toContain('다시 승인하지 마세요');
    expect(h.edits[0].keyboard).toBeUndefined();             // 🔴 버튼을 남기지 않는다 — 다시 누르면 안 된다
    expect(h.audits[0].payload).toMatchObject({ result: 'order_uncertain' });
  });

  test('확정 거부(order_not_accepted)와는 다르게 취급된다 — 거부는 버튼 유지', async () => {
    const h = harness();
    h.approve.mockResolvedValueOnce({ ok: false, error: 'order_not_accepted: order_limit', errorCode: 'order_not_accepted' });
    await handleCallbackQuery(press('a', RULE_SIGNAL), h.deps);
    expect(h.edits[0].keyboard).toBeDefined();
  });
});

describe('🔴 텔레그램 호출 실패 (T-042 감사 D-4) — 결과를 모른 채 두지 않는다', () => {
  test('결과 수정이 {ok:false} 로 실패하면 새 메시지로 같은 결과를 보낸다', async () => {
    const h = harness();
    h.deps.telegram.edit = async () => ({ ok: false, error: 'HTTP 400 message to edit not found' });
    await handleCallbackQuery(press('a', RULE_SIGNAL), h.deps);
    expect(h.sends).toHaveLength(1);
    expect(h.sends[0].text).toContain('주문 접수 #3250');
  });

  test('결과 수정이 예외를 던져도 새 메시지로 대체한다', async () => {
    const h = harness();
    h.deps.telegram.edit = async () => { throw new Error('tg down'); };
    await handleCallbackQuery(press('a', RULE_SIGNAL), h.deps);
    expect(h.sends).toHaveLength(1);
  });

  test('"message is not modified" 는 실패가 아니다 — 이미 그 상태이므로 중복 전송하지 않는다', async () => {
    const h = harness();
    h.deps.telegram.edit = async () => ({ ok: false, error: 'HTTP 400 Bad Request: message is not modified' });
    await handleCallbackQuery(press('a', RULE_SIGNAL), h.deps);
    expect(h.sends).toEqual([]);
  });

  test('수정이 성공하면 새 메시지를 보내지 않는다', async () => {
    const h = harness();
    await handleCallbackQuery(press('a', RULE_SIGNAL), h.deps);
    expect(h.sends).toEqual([]);
  });

  test('버튼이 남는 결과(주문 거부)를 새 메시지로 대체하면 버튼도 함께 보낸다', async () => {
    const h = harness();
    h.approve.mockResolvedValueOnce({ ok: false, error: 'order_not_accepted: x', errorCode: 'order_not_accepted' });
    h.deps.telegram.edit = async () => ({ ok: false, error: 'HTTP 400' });
    await handleCallbackQuery(press('a', RULE_SIGNAL), h.deps);
    expect(h.sends[0].keyboard).toBeDefined();
  });

  test('수정도 새 메시지도 모두 실패해도 처리기는 던지지 않고 거래 결정은 그대로다', async () => {
    const h = harness();
    h.deps.telegram.edit = async () => ({ ok: false, error: 'x' });
    h.deps.telegram.send = async () => { throw new Error('tg down'); };
    await expect(handleCallbackQuery(press('a', RULE_SIGNAL), h.deps)).resolves.toMatchObject({ view: { kind: 'order_placed' } });
    expect(h.approve).toHaveBeenCalledTimes(1);
  });

  test('콜백에 메시지 정보가 없으면(수정 불가) 새 메시지로 알린다', async () => {
    // message 가 없으면 발신자 검증에서 거부되므로, 허용 채팅 확인 후 messageId 만 없는 경우를 모사: 허용 목록에 chat 을 넣고 message 의 id 를 비움
    const h = harness();
    const cq = press('a', RULE_SIGNAL);
    (cq.message as { message_id?: number }).message_id = undefined as unknown as number;
    await handleCallbackQuery(cq, h.deps);
    expect(h.edits).toEqual([]);
    expect(h.sends).toHaveLength(1);
  });
});

describe('🔴 불변식: 한 콜백에 응답(answerCallbackQuery)은 정확히 한 번 — 텔레그램은 두 번째 응답을 거부한다 (2라운드 감사 A9)', () => {
  const statuses = ['awaiting_approval', 'pending', 'detected', 'approved', 'approved_pending_entry', 'executing', 'rejected', 'expired', 'auto_submitted'];
  const outcomes: Array<[string, (h: Harness) => void]> = [
    ['승인 성공', () => {}],
    ['주문 거부', (h) => h.approve.mockResolvedValue({ ok: false, error: 'order_not_accepted: x', errorCode: 'order_not_accepted' })],
    ['결과 불명', (h) => h.approve.mockResolvedValue({ ok: false, orderId: 9, error: 'order_uncertain: x', errorCode: 'order_uncertain' })],
    ['예외', (h) => h.approve.mockRejectedValue(new Error('boom'))],
    ['전이 패배', (h) => h.approve.mockResolvedValue({ ok: false, error: 'invalid_status:approved' })],
  ];

  test.each(statuses.flatMap((st) => (['a', 'r'] as const).flatMap((act) => [false, true].flatMap((kill) => outcomes.map(([name, setup]) => [st, act, kill, name, setup] as const)))))(
    '상태=%s 동작=%s 킬스위치=%s 결과=%s → 응답 정확히 1회',
    async (status, act, kill, _name, setup) => {
      const sig = { ...RULE_SIGNAL, status };
      const h = harness({ signals: [sig], killSwitch: kill });
      setup(h);
      const out = await handleCallbackQuery(press(act, sig), h.deps);
      expect(out.kind).toBe('decision');
      expect(h.answers).toHaveLength(1);
    },
  );

  test('허용 목록 밖·기능 꺼짐·서명 오류·시그널 없음·자가 점검도 각각 정확히 1회', async () => {
    const cases: Array<[string, Harness, TelegramCallbackQuery]> = [];
    const a = harness(); cases.push(['허용 밖', a, press('a', RULE_SIGNAL, 9999)]);
    const b = harness({ featureOn: false }); cases.push(['꺼짐', b, press('a', RULE_SIGNAL)]);
    const c = harness({ signals: [] }); cases.push(['없음', c, press('a', RULE_SIGNAL)]);
    const d = harness({ signals: [{ ...RULE_SIGNAL, amount_krw: '1' }] }); cases.push(['서명 오류', d, press('a', RULE_SIGNAL)]);
    const e = harness(); cases.push(['자가 점검', e, press('t', { id: 0, amount_krw: 0 })]);
    const f2 = harness({}, { key: null }); cases.push(['키 없음', f2, press('a', RULE_SIGNAL)]);
    for (const [name, h, cq] of cases) {
      await handleCallbackQuery(cq, h.deps);
      expect({ name, n: h.answers.length }).toEqual({ name, n: 1 });
    }
  });

  test('우리 형식이 아닌 콜백에는 응답하지 않는다 (다른 프로젝트 것일 수 있다)', async () => {
    const h = harness();
    await handleCallbackQuery({ id: 'q', from: { id: OWNER }, data: 'other:1', message: { message_id: 1, chat: { id: CHAT } } }, h.deps);
    expect(h.answers).toHaveLength(0);
  });
});

describe('mapFailure', () => {
  test.each([
    ['order_not_accepted: x', undefined, 'order_rejected'],
    ['order_uncertain: x', undefined, 'order_uncertain'],
    ['whatever', 'order_uncertain', 'order_uncertain'],
    ['whatever', 'order_not_accepted', 'order_rejected'],
    ['signal_expired', undefined, 'expired'],
    ['invalid_status:expired', undefined, 'expired'],
    ['invalid_status:approved', undefined, 'already_handled'],
    ['transition_conflict', undefined, 'failed'],
    ['not_found', undefined, 'failed'],
    ['quantity_below_min: x', 'quantity_below_min', 'failed'],
    [undefined, undefined, 'failed'],
    ['???', undefined, 'failed'],
  ] as const)('%s / %s → %s', (error, code, kind) => {
    expect(mapFailure(error, code).kind).toBe(kind);
  });

  // T-072 G4 — 검증 상태 관문. 미지 코드처럼 원문(`validation_gate: 등록되지 않은 전략(…)…`)을 그대로 보이지 않고 한국어 문구로.
  test.each([
    ['validation_gate: 등록되지 않은 전략(rsi_momentum_v1) — 검증 전 신규 매수 차단 — 선점·주문하지 않음', 'validation_gate',
      '검증되지 않은 전략이라 매수할 수 없습니다 (validation_gate)'],
    ['validation_gate: x', undefined, '검증되지 않은 전략이라 매수할 수 없습니다 (validation_gate)'],      // 하이브리드: 코드 없이 문자열만 와도
    ['whatever', 'validation_gate', '검증되지 않은 전략이라 매수할 수 없습니다 (validation_gate)'],
    ['validation_lookup_error: ER_BAD_FIELD_ERROR', 'validation_lookup_error', expect.stringMatching(/^전략 검증 상태를 확인하지 못해 매수하지 않았습니다.*\(validation_lookup_error\)$/)],
    ['validation_lookup_error: x', undefined, expect.stringContaining('(validation_lookup_error)')],
  ] as const)('🔴 %s / %s → failed + 한국어 문구', (error, code, reason) => {
    const v = mapFailure(error, code);
    expect(v).toEqual({ kind: 'failed', reason });
    expect((v as { reason: string }).reason).not.toMatch(/등록되지 않은|ER_BAD_FIELD_ERROR/);
  });
});
