/**
 * T-042 감사 D-5 — **승인 권한의 실제 배선**과 폴링 루프.
 *
 * 순수 처리기(`telegram-approval.ts`)가 아무리 잘 시험돼도 "누가 승인할 수 있는가"는 여기서 정해진다:
 * 허용 채팅·허용 사용자·서명 키·하이브리드 판정·승인 경로 매핑. 이 층이 틀리면 권한이 틀린다.
 * 감사에서 이 층의 변이 8개가 테스트를 통과했다 — 아래가 그 회귀망이다.
 */
import {
  backoffMs,
  buildApprovalDepsFrom,
  DISABLED_RECHECK_MS,
  LOCK_LOST_WAIT_MS,
  LOCK_RETRY_MS,
  POLLER_LOCK_NAME,
  runLoop,
  type ApprovalIO,
  type LoopIO,
  type PollerHandle,
} from '../telegram-poller';
import { handleCallbackQuery } from '../telegram-approval';
import { deriveApprovalKey, encodeCallbackData } from '../telegram-callback-data';
import type { BotCallResult, TelegramCallbackQuery, TelegramUpdate } from '@/lib/notify/telegram-api';

const SECRET = 'a-session-secret-that-is-long-enough-1234567890';
const NOW = new Date('2026-10-12T04:20:00Z');

// ─────────────────────────────────────────────────────────────────────────────
// ApprovalIO 가짜
// ─────────────────────────────────────────────────────────────────────────────

interface IOState {
  config: Record<string, unknown>;
  configThrows?: Set<string>;
  creds: Record<string, string>;
  secret: string | undefined;
  hybrid: boolean;
  kill: boolean;
  signals: Record<number, { id: number; status: string; symbol: string; side: 'buy' | 'sell'; amount_krw: string; indicators: string; expires_at: Date | null }>;
}
interface IOLog { approve: unknown[]; hybrid: unknown[]; reject: unknown[]; answers: unknown[]; edits: unknown[]; clears: unknown[]; sends: unknown[]; audits: unknown[]; alerts: unknown[][] }

function makeIO(over: Partial<IOState> = {}): { io: ApprovalIO; state: IOState; log: IOLog } {
  const state: IOState = {
    config: { telegram_approval_enabled: true },
    creds: { TELEGRAM_CHAT_ID: '7001' },
    secret: SECRET,
    hybrid: true,
    kill: false,
    signals: {
      100: { id: 100, status: 'awaiting_approval', symbol: 'NAS:BKNG', side: 'buy', amount_krw: '1121925.00', indicators: JSON.stringify({ rsi14: 37 }), expires_at: new Date(NOW.getTime() + 600_000) },
      101: { id: 101, status: 'awaiting_approval', symbol: '005380', side: 'buy', amount_krw: '700000.00', indicators: JSON.stringify({ ai: { scenario: { entry: { price_zone: '245000~248500' } } } }), expires_at: new Date(NOW.getTime() + 600_000) },
    },
    ...over,
  };
  const log: IOLog = { approve: [], hybrid: [], reject: [], answers: [], edits: [], clears: [], sends: [], audits: [], alerts: [] };
  const io: ApprovalIO = {
    readConfig: async (k) => { if (state.configThrows?.has(k)) throw new Error('db down'); return state.config[k]; },
    getCredential: async (k) => state.creds[k] ?? '',
    getSessionSecret: () => state.secret,
    deriveKey: (secret) => deriveApprovalKey(secret),
    service: {
      getSignalById: async (id) => state.signals[id] ?? null,
      approveSignal: async (id) => { log.approve.push(id); return { ok: true, orderId: 3250, orderResult: { dryRun: false } }; },
      approveSignalHybrid: async (id) => { log.hybrid.push(id); return { ok: true }; },
      rejectSignal: async (id) => { log.reject.push(id); return { ok: true }; },
    },
    tg: {
      answerCallbackQuery: async (...a) => { log.answers.push(a); return { ok: true }; },
      editTelegramMessage: async (...a) => { log.edits.push(a); return { ok: true }; },
      clearTelegramKeyboard: async (...a) => { log.clears.push(a); return { ok: true }; },
      sendTelegramMessage: async (...a) => { log.sends.push(a); return { ok: true }; },
    },
    getSymbolLabel: async (s) => `라벨(${s})`,
    isKillSwitchActive: async () => state.kill,
    isHybridModeEnabled: async () => state.hybrid,
    insertAudit: async (event, payload) => { log.audits.push({ event, payload }); },
    alertThrottled: (...a) => { log.alerts.push(a); },
    now: () => NOW,
  };
  return { io, state, log };
}

const KEY = deriveApprovalKey(SECRET)!;
const press = (action: 'a' | 'r' | 't', id: number, amount: number, from = 7001, chat = 7001): TelegramCallbackQuery => ({
  id: 'q1', from: { id: from }, data: encodeCallbackData(KEY, action, id, amount), message: { message_id: 55, chat: { id: chat } },
});

// ─────────────────────────────────────────────────────────────────────────────

describe('buildApprovalDepsFrom — 누가 승인할 수 있는가', () => {
  test('🔴 서명 키는 세션 비밀에서 파생된다 — 비밀이 없으면 null (거래 동작 전부 거부)', () => {
    expect(buildApprovalDepsFrom(makeIO().io).key?.equals(KEY)).toBe(true);
    expect(buildApprovalDepsFrom(makeIO({ secret: undefined }).io).key).toBeNull();
    expect(buildApprovalDepsFrom(makeIO({ secret: 'short' }).io).key).toBeNull();
  });

  test('🔴 서명 키가 다른 비밀로 파생되면 기존 버튼이 무효가 된다 (비밀 회전 시 안전하게 실패)', async () => {
    const other = makeIO({ secret: 'a-different-secret-that-is-also-long-1234567890' });
    const out = await handleCallbackQuery(press('a', 100, 1121925), buildApprovalDepsFrom(other.io));
    expect(out).toMatchObject({ kind: 'invalid', reason: 'bad_signature' });
    expect(other.log.approve).toEqual([]);
  });

  describe('enabled — 엄격한 불리언만 참', () => {
    test.each([
      [true, true], [false, false], [undefined, false], ['true', false], [1, false], [null, false], ['', false],
    ])('telegram_approval_enabled=%j → %s', async (value, expected) => {
      const { io } = makeIO({ config: { telegram_approval_enabled: value } });
      expect(await buildApprovalDepsFrom(io).enabled()).toBe(expected);
    });
    test('설정을 읽다 실패하면 꺼진 것으로 (fail-closed)', async () => {
      const { io } = makeIO({ configThrows: new Set(['telegram_approval_enabled']) });
      expect(await buildApprovalDepsFrom(io).enabled()).toBe(false);
    });
  });

  describe('allowedChatIds — 소유자 채팅 하나', () => {
    test('TELEGRAM_CHAT_ID 한 개', async () => {
      expect([...await buildApprovalDepsFrom(makeIO().io).allowedChatIds()]).toEqual(['7001']);
    });
    test('🔴 자격증명이 비어 있으면 빈 집합 — 아무도 허용하지 않는다', async () => {
      expect((await buildApprovalDepsFrom(makeIO({ creds: {} }).io).allowedChatIds()).size).toBe(0);
      expect((await buildApprovalDepsFrom(makeIO({ creds: { TELEGRAM_CHAT_ID: '   ' } }).io).allowedChatIds()).size).toBe(0);
    });
    test('공백은 잘라 낸다', async () => {
      expect([...await buildApprovalDepsFrom(makeIO({ creds: { TELEGRAM_CHAT_ID: ' 7001 ' } }).io).allowedChatIds()]).toEqual(['7001']);
    });
  });

  describe('allowedUserIds', () => {
    test('개인 채팅(양수 ID)이면 채팅 ID == 사용자 ID', async () => {
      expect([...await buildApprovalDepsFrom(makeIO().io).allowedUserIds()]).toEqual(['7001']);
    });
    test('🔴 그룹·채널(음수 ID)이면 명시 설정이 없는 한 아무도 허용하지 않는다', async () => {
      const d = buildApprovalDepsFrom(makeIO({ creds: { TELEGRAM_CHAT_ID: '-1001234567890' } }).io);
      expect((await d.allowedUserIds()).size).toBe(0);
    });
    test('🔴 숫자가 아닌 값(@채널명 등)도 허용하지 않는다', async () => {
      for (const bad of ['@mychannel', '12ab', '7001.5', '+7001']) {
        expect((await buildApprovalDepsFrom(makeIO({ creds: { TELEGRAM_CHAT_ID: bad } }).io).allowedUserIds()).size).toBe(0);
      }
    });
    test('명시 설정(telegram_approval_user_ids)이 있으면 그것이 이긴다 — 그룹 채팅에서도 지정한 사람만', async () => {
      const d = buildApprovalDepsFrom(makeIO({
        creds: { TELEGRAM_CHAT_ID: '-1001234567890' },
        config: { telegram_approval_user_ids: [42, ' 43 ', '44'] },
      }).io);
      expect([...await d.allowedUserIds()].sort()).toEqual(['42', '43', '44']);
    });
    test('🔴 명시 설정은 숫자 ID 만 받는다 — null·객체·빈 문자열·음수·소수가 문자열로 새지 않는다', async () => {
      const d = buildApprovalDepsFrom(makeIO({
        config: { telegram_approval_user_ids: [42, null, '', {}, [], -5, 1.5, 'abc', '7x', true, 'null'] },
      }).io);
      expect([...await d.allowedUserIds()]).toEqual(['42']);
    });
    test('🔴 명시 설정이 있는데 쓸 수 있는 값이 하나도 없으면 폴백하지 않는다 — 잘못 쓴 설정이 기본값으로 넓어지지 않게', async () => {
      const d = buildApprovalDepsFrom(makeIO({ config: { telegram_approval_user_ids: ['abc', null] } }).io);
      expect((await d.allowedUserIds()).size).toBe(0);
    });
    test('명시 설정이 빈 배열이면 폴백(개인 채팅 규칙)으로', async () => {
      const d = buildApprovalDepsFrom(makeIO({ config: { telegram_approval_user_ids: [] } }).io);
      expect([...await d.allowedUserIds()]).toEqual(['7001']);
    });
    test('명시 설정을 읽다 실패해도 폴백으로 (예외를 던지지 않는다)', async () => {
      const d = buildApprovalDepsFrom(makeIO({ configThrows: new Set(['telegram_approval_user_ids']) }).io);
      expect([...await d.allowedUserIds()]).toEqual(['7001']);
    });
    test('배열이 아닌 설정값은 무시한다', async () => {
      const d = buildApprovalDepsFrom(makeIO({ config: { telegram_approval_user_ids: '999' } }).io);
      expect([...await d.allowedUserIds()]).toEqual(['7001']);
    });
  });

  describe('승인 경로 매핑 — 뒤집히면 구간 없는 신호가 막다른 길로 간다', () => {
    test('immediate → approveSignal (주문 번호·DRY_RUN·오류 코드를 그대로 전달)', async () => {
      const { io, log } = makeIO();
      const deps = buildApprovalDepsFrom(io);
      expect(await deps.approve(100, 'immediate')).toEqual({ ok: true, orderId: 3250, error: undefined, errorCode: undefined, dryRun: false });
      expect(log.approve).toEqual([100]);
      expect(log.hybrid).toEqual([]);
    });
    test('hybrid → approveSignalHybrid', async () => {
      const { io, log } = makeIO();
      expect(await buildApprovalDepsFrom(io).approve(101, 'hybrid')).toEqual({ ok: true, error: undefined });
      expect(log.hybrid).toEqual([101]);
      expect(log.approve).toEqual([]);
    });
    test('실패 코드는 가공 없이 전달된다 (order_uncertain 이 order_not_accepted 로 바뀌면 안 된다)', async () => {
      const { io } = makeIO();
      io.service.approveSignal = async () => ({ ok: false, orderId: 9, error: 'order_uncertain: x', errorCode: 'order_uncertain' });
      expect(await buildApprovalDepsFrom(io).approve(100, 'immediate')).toMatchObject({ ok: false, errorCode: 'order_uncertain', orderId: 9 });
    });
    test('reject → rejectSignal', async () => {
      const { io, log } = makeIO();
      expect(await buildApprovalDepsFrom(io).reject(100)).toEqual({ ok: true });
      expect(log.reject).toEqual([100]);
    });
    test('하이브리드 판정은 주입된 단일 함수를 그대로 쓴다 (웹 라우트와 같은 규칙)', async () => {
      expect(await buildApprovalDepsFrom(makeIO({ hybrid: true }).io).isHybridEnabled()).toBe(true);
      expect(await buildApprovalDepsFrom(makeIO({ hybrid: false }).io).isHybridEnabled()).toBe(false);
    });
  });

  test('getSignal — 필드를 형 변환하고, 없으면 null', async () => {
    const d = buildApprovalDepsFrom(makeIO().io);
    expect(await d.getSignal(100)).toMatchObject({ id: 100, status: 'awaiting_approval', symbol: 'NAS:BKNG', side: 'buy', amount_krw: '1121925.00' });
    expect(await d.getSignal(999)).toBeNull();
  });

  test('appUrl — 문자열만, 공백은 자르고, 비었거나 읽기 실패면 null', async () => {
    expect(await buildApprovalDepsFrom(makeIO({ config: { app_public_url: ' https://s.example.com ' } }).io).appUrl()).toBe('https://s.example.com');
    for (const bad of [undefined, '', '   ', 5, null]) {
      expect(await buildApprovalDepsFrom(makeIO({ config: { app_public_url: bad } }).io).appUrl()).toBeNull();
    }
    expect(await buildApprovalDepsFrom(makeIO({ configThrows: new Set(['app_public_url']) }).io).appUrl()).toBeNull();
  });

  test('감사·경보·텔레그램 호출이 주입된 구현으로 전달된다', async () => {
    const { io, log } = makeIO();
    const d = buildApprovalDepsFrom(io);
    await d.audit('ev', { a: 1 });
    expect(log.audits).toEqual([{ event: 'ev', payload: { a: 1 } }]);
    d.onUnauthorized!({ fromId: 9, chatId: 8, action: 'a' });
    expect(log.alerts[0][0]).toBe('telegram-approval:unauthorized');
    expect(log.alerts[0][1]).toBe('critical');
    expect(String(log.alerts[0][3])).toContain('발신자 9');
    await d.telegram.answer('q', 't', true);
    await d.telegram.edit(1, 2, 'x');
    await d.telegram.clearKeyboard(1, 2);
    await d.telegram.send('y');
    expect(log.answers).toEqual([['q', 't', true]]);
    expect(log.edits).toEqual([[1, 2, 'x', undefined]]);
    expect(log.clears).toEqual([[1, 2]]);
    expect(log.sends).toEqual([['y', undefined]]);
    // 🔴 키보드는 그대로 전달된다 — 버튼이 남아야 하는 결과(주문 거부)에서 버튼이 사라지면 사용자가 다시 판단할 수 없다
    const kb = { inline_keyboard: [[{ text: '✅ 승인', callback_data: 'si1:a:1:0000000000000000' }]] };
    await d.telegram.edit(1, 2, 'z', kb);
    await d.telegram.send('w', kb);
    expect(log.edits[1]).toEqual([1, 2, 'z', kb]);
    expect(log.sends[1]).toEqual(['w', kb]);
    expect(d.now()).toBe(NOW);
  });
});

describe('배선 + 처리기 끝까지 (주입된 협력자 위에서)', () => {
  test('🔴 소유자가 룰 시그널을 승인 → 즉시 주문 경로, 결과가 메시지에 반영되고 감사가 남는다', async () => {
    const { io, log } = makeIO();
    const out = await handleCallbackQuery(press('a', 100, 1121925), buildApprovalDepsFrom(io));
    expect(out).toMatchObject({ kind: 'decision', path: 'immediate', view: { kind: 'order_placed', orderId: 3250 } });
    expect(log.approve).toEqual([100]);
    expect(String((log.edits[0] as unknown[])[2])).toContain('주문 접수 #3250');
    expect(log.audits).toHaveLength(1);
  });

  test('구간이 있는 카드는 진입 감시 경로', async () => {
    const { io, log } = makeIO();
    const out = await handleCallbackQuery(press('a', 101, 700000), buildApprovalDepsFrom(io));
    expect(out).toMatchObject({ path: 'hybrid', view: { kind: 'entry_watch' } });
    expect(log.hybrid).toEqual([101]);
  });

  test('🔴 낯선 사람이 누르면 상태를 읽기 전에 거부 — 승인 함수가 불리지 않는다', async () => {
    const { io, log } = makeIO();
    const out = await handleCallbackQuery(press('a', 100, 1121925, 9999, 7001), buildApprovalDepsFrom(io));
    expect(out.kind).toBe('denied');
    expect(log.approve).toEqual([]);
    expect(log.alerts).toHaveLength(1);
  });

  test('🔴 허용 채팅이 비어 있으면 소유자도 거부된다 (설정 누락은 fail-closed)', async () => {
    const { io, log } = makeIO({ creds: {} });
    expect((await handleCallbackQuery(press('a', 100, 1121925), buildApprovalDepsFrom(io))).kind).toBe('denied');
    expect(log.approve).toEqual([]);
  });

  test('🔴 스위치가 꺼져 있으면 거래 동작이 없다, 자가 점검은 된다', async () => {
    const { io, log } = makeIO({ config: { telegram_approval_enabled: false } });
    const d = buildApprovalDepsFrom(io);
    expect((await handleCallbackQuery(press('a', 100, 1121925), d)).kind).toBe('disabled');
    expect((await handleCallbackQuery(press('t', 0, 0), d)).kind).toBe('selftest');
    expect(log.approve).toEqual([]);
  });

  test('킬스위치 ON 이면 승인 함수가 불리지 않는다', async () => {
    const { io, log } = makeIO({ kill: true });
    await handleCallbackQuery(press('a', 100, 1121925), buildApprovalDepsFrom(io));
    expect(log.approve).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 루프
// ─────────────────────────────────────────────────────────────────────────────

interface LoopScript {
  flags?: { poller: boolean[] };               // 호출 순서대로 소진, 끝나면 마지막 값 유지
  lockGranted?: boolean[];                     // 연결마다 GET_LOCK 결과
  heldChecks?: Array<boolean | 'throw'>;       // IS_USED_LOCK 결과 (소진 후 true). 'throw' = 그 확인 쿼리가 던진다(연결 끊김)
  updates?: Array<BotCallResult<TelegramUpdate[]>>;
  buildDepsThrows?: boolean;
  getConnectionThrows?: boolean;
  stopAfterPolls?: number;
  stopAfterSleeps?: number;
}

function makeLoop(script: LoopScript = {}) {
  const handle: PollerHandle = { stopped: false, startedAt: 0 };
  const events: string[] = [];
  const sleeps: number[] = [];
  const alerts: Array<{ key: string; level: string }> = [];
  const handled: string[] = [];
  const saved: number[] = [];
  const conns: Array<{ released: number; queries: string[]; params: unknown[][] }> = [];
  const errors: string[] = [];
  const pollerFlags = [...(script.flags?.poller ?? [true])];
  const lockGranted = [...(script.lockGranted ?? [true])];
  const heldChecks = [...(script.heldChecks ?? [])];
  const updates = [...(script.updates ?? [])];
  let polls = 0;

  const io: LoopIO = {
    readFlag: async (k) => {
      if (k !== 'telegram_poller_enabled') return false;
      const v = pollerFlags.length > 1 ? pollerFlags.shift()! : pollerFlags[0];
      return v;
    },
    getConnection: async () => {
      if (script.getConnectionThrows) throw new Error('pool exhausted');
      const c = { released: 0, queries: [] as string[], params: [] as unknown[][] };
      conns.push(c);
      events.push(`conn#${conns.length}`);
      return {
        async query(sql: string, p: unknown[] = []) {
          c.queries.push(sql);
          c.params.push(p);
          if (/GET_LOCK/.test(sql)) return [[{ got: (lockGranted.length > 1 ? lockGranted.shift()! : lockGranted[0]) ? 1 : 0 }], []];
          if (/IS_USED_LOCK/.test(sql)) {
            const v = heldChecks.length ? heldChecks.shift()! : true;
            if (v === 'throw') throw new Error('conn gone');
            return [[{ held: v ? 1 : 0 }], []];
          }
          return [[], []];
        },
        release() { c.released++; events.push(`release#${conns.indexOf(c) + 1}`); },
      };
    },
    buildDeps: async () => {
      if (script.buildDepsThrows) throw new Error('deps down');
      return {} as never;
    },
    loadOffset: async () => 100,
    saveOffset: async (n) => { saved.push(n); },
    getUpdates: async () => {
      polls++;
      const r = updates.shift() ?? { ok: true as const, result: [] };
      if (script.stopAfterPolls != null && polls >= script.stopAfterPolls) handle.stopped = true;
      if (updates.length === 0 && script.updates && !script.stopAfterPolls) handle.stopped = true;
      return r;
    },
    handle: async (cq) => { handled.push(cq.id); },
    alert: (key, level) => { alerts.push({ key, level }); },
    sleep: async (ms) => {
      sleeps.push(ms); events.push(`sleep:${ms}`);
      if (script.stopAfterSleeps != null && sleeps.length >= script.stopAfterSleeps) handle.stopped = true;
    },
    info: () => {},
    error: (m) => { errors.push(m); },
  };
  return { io, handle, events, sleeps, alerts, handled, saved, conns, errors, get polls() { return polls; } };
}

const cbUpdate = (id: number): TelegramUpdate => ({ update_id: id, callback_query: { id: `q${id}`, from: { id: 1 }, data: 'x' } });

describe('runLoop — 락·연결·백오프', () => {
  test('스위치가 꺼져 있으면 연결을 빌리지도 않고 30초 쉰다', async () => {
    const l = makeLoop({ flags: { poller: [false] }, stopAfterSleeps: 1 });
    await runLoop(l.io, l.handle);
    expect(l.conns).toHaveLength(0);
    expect(l.sleeps).toEqual([DISABLED_RECHECK_MS]);
  });

  test('🔴 락을 못 잡으면 폴링하지 않고, 연결을 한 번만 반납한 **뒤에** 쉰다', async () => {
    const l = makeLoop({ lockGranted: [false], stopAfterSleeps: 1 });
    await runLoop(l.io, l.handle);
    expect(l.polls).toBe(0);
    expect(l.conns).toHaveLength(1);
    expect(l.conns[0].released).toBe(1);                         // 이중 반납 금지
    expect(l.events).toEqual(['conn#1', 'release#1', `sleep:${LOCK_RETRY_MS}`]);   // 반납 → 대기 순서
    expect(l.conns[0].queries.some((q) => /RELEASE_LOCK/.test(q))).toBe(false);    // 못 잡은 락은 풀지 않는다
  });

  test('🔴 락 이름은 고정 상수다 (두 릴리스가 같은 락을 두고 경쟁한다)', async () => {
    const l = makeLoop({ lockGranted: [false], stopAfterSleeps: 1 });
    const seen: unknown[][] = [];
    const orig = l.io.getConnection;
    l.io.getConnection = async () => {
      const c = await orig();
      const q = c.query.bind(c);
      c.query = async (sql: string, p?: unknown[]) => { seen.push([sql, p]); return q(sql, p); };
      return c;
    };
    await runLoop(l.io, l.handle);
    expect(seen.find((x) => /GET_LOCK/.test(String(x[0])))?.[1]).toEqual([POLLER_LOCK_NAME]);
  });

  test('락을 잡으면 업데이트를 처리하고, 끝나면 락을 풀고 연결을 한 번만 반납한다', async () => {
    const l = makeLoop({ updates: [{ ok: true, result: [cbUpdate(101), cbUpdate(102)] }] });
    await runLoop(l.io, l.handle);
    expect(l.handled).toEqual(['q101', 'q102']);
    expect(l.saved).toEqual([102, 103]);
    expect(l.conns).toHaveLength(1);
    expect(l.conns[0].released).toBe(1);
    expect(l.conns[0].queries.filter((q) => /RELEASE_LOCK/.test(q))).toHaveLength(1);
  });

  test('🔴 락을 잃으면(IS_USED_LOCK 가 거짓) 폴링을 멈추고 다시 잡는다 — 이중 소비 방지', async () => {
    const l = makeLoop({
      lockGranted: [true, true],
      heldChecks: [true, false],                                 // 첫 폴링 뒤 락 상실
      updates: [{ ok: true, result: [] }, { ok: true, result: [] }],
      stopAfterPolls: 2,
    });
    await runLoop(l.io, l.handle);
    expect(l.conns.length).toBeGreaterThanOrEqual(2);            // 새 연결로 재획득을 시도했다
    expect(l.conns.every((c) => c.released === 1)).toBe(true);   // 모든 연결은 정확히 한 번 반납
  });

  test('폴링 중 스위치를 끄면 루프를 빠져나와 락을 푼다', async () => {
    const l = makeLoop({ flags: { poller: [true, true, false] }, updates: [{ ok: true, result: [] }, { ok: true, result: [] }], stopAfterSleeps: 1 });
    await runLoop(l.io, l.handle);
    expect(l.conns[0].released).toBe(1);
    expect(l.conns[0].queries.some((q) => /RELEASE_LOCK/.test(q))).toBe(true);
  });

  test('🔴 getUpdates 실패는 2s, 4s, 8s 로 물러서고, 성공하면 카운터가 초기화된다', async () => {
    const err = { ok: false as const, error: 'fetch failed' };
    const l = makeLoop({ updates: [err, err, err, { ok: true, result: [] }, err], stopAfterSleeps: 4 });
    await runLoop(l.io, l.handle);
    expect(l.sleeps.slice(0, 4)).toEqual([backoffMs(1), backoffMs(2), backoffMs(3), backoffMs(1)]);
  });

  test('연속 10회 실패하면 warning 경보를 낸다 (그 전에는 내지 않는다)', async () => {
    const err = { ok: false as const, error: 'fetch failed' };
    const few = makeLoop({ updates: Array(9).fill(err), stopAfterSleeps: 9 });
    await runLoop(few.io, few.handle);
    expect(few.alerts).toEqual([]);
    const many = makeLoop({ updates: Array(10).fill(err), stopAfterSleeps: 10 });
    await runLoop(many.io, many.handle);
    expect(many.alerts).toEqual([{ key: 'telegram-poller:failing', level: 'warning' }]);
  });

  test('🔴 409 가 3번 연속이면 critical 경보 (다른 소비자/웹훅 — 공유 봇)', async () => {
    const c409 = { ok: false as const, status: 409, conflict: true, error: 'HTTP 409' };
    const two = makeLoop({ updates: [c409, c409], stopAfterSleeps: 2 });
    await runLoop(two.io, two.handle);
    expect(two.alerts).toEqual([]);
    const three = makeLoop({ updates: [c409, c409, c409], stopAfterSleeps: 3 });
    await runLoop(three.io, three.handle);
    expect(three.alerts).toEqual([{ key: 'telegram-poller:conflict', level: 'critical' }]);
    expect(three.sleeps).toEqual([15_000, 15_000, 15_000]);
  });

  test('의존성 구성이 던져도 연결은 한 번만 반납되고 백오프 후 재시도한다', async () => {
    const l = makeLoop({ buildDepsThrows: true, stopAfterSleeps: 1 });
    await runLoop(l.io, l.handle);
    expect(l.conns[0].released).toBe(1);
    expect(l.conns[0].queries.some((q) => /RELEASE_LOCK/.test(q))).toBe(true);    // 잡았던 락은 푼다
    expect(l.sleeps).toEqual([backoffMs(1)]);
  });

  test('연결을 못 빌리면 예외가 위로 올라간다 (시작 함수가 30초 뒤 재시작)', async () => {
    const l = makeLoop({ getConnectionThrows: true });
    await expect(runLoop(l.io, l.handle)).rejects.toThrow('pool exhausted');
  });

  test('stopped 이면 아무것도 하지 않는다', async () => {
    const l = makeLoop();
    l.handle.stopped = true;
    await runLoop(l.io, l.handle);
    expect(l.conns).toHaveLength(0);
    expect(l.sleeps).toEqual([]);
  });

  test('🔴 [T-047] 롱폴링 도중 락을 잃은 소비자는 돌아온 배치를 처리하지도, 오프셋을 되돌리지도 않는다 (T-042 r42-f2 재현)', async () => {
    // 소비자 A: 오프셋 103 으로 롱폴링 → 그 사이 연결이 끊겨 락을 잃고, 소비자 B 가 103~109 를 처리해 110 을 저장했다.
    // A 의 getUpdates 가 늦게 [103..109] 를 돌려준다. 수정 전에는 A 가 7건을 다시 처리하고 104 부터 저장해 오프셋을 되돌렸다.
    const batch = [103, 104, 105, 106, 107, 108, 109].map(cbUpdate);
    const l = makeLoop({
      lockGranted: [true, false],
      heldChecks: [true, false],                                 // while 조건에서는 held → getUpdates 반환 직후 lost
      updates: [{ ok: true, result: batch }],
      stopAfterPolls: 99,                                        // 배치 소진으로 자동 정지하지 않게
      stopAfterSleeps: 2,
    });
    await runLoop(l.io, l.handle);
    expect(l.handled).toEqual([]);                               // 승인 처리기를 한 번도 부르지 않았다
    expect(l.saved).toEqual([]);                                 // 오프셋을 건드리지 않았다
    expect(l.conns.every((c) => c.released === 1)).toBe(true);   // 연결은 정확히 한 번 반납
    expect(l.conns.length).toBeGreaterThanOrEqual(2);            // 다시 잡으러 갔다 (B 가 쥐고 있어 실패 → 대기)
    // 락 상실은 실패가 아니다 — 백오프(2s·4s…)가 아니라 최소 대기(R-1) 뒤 재획득, 재획득 실패는 기존 30초 대기
    expect(l.sleeps).toEqual([LOCK_LOST_WAIT_MS, LOCK_RETRY_MS]);
    expect(l.errors).toEqual([]);
  });

  test('🔴 [T-047 R-1] 재획득 성공 직후 다시 잃기를 반복해도 매번 최소 대기를 둔다 — 대기 없이 getUpdates 를 연타하지 않는다', async () => {
    const cycles = 3;
    const l = makeLoop({
      lockGranted: [true],                                       // 재획득은 매번 성공
      heldChecks: Array.from({ length: 20 }, (_, i) => i % 2 === 0),   // while 조건 held → 반환 직후 lost, 반복
      updates: Array.from({ length: 20 }, (_, i) => ({ ok: true as const, result: [cbUpdate(200 + i)] })),
      stopAfterPolls: 20,                                        // (변이 시 무한 루프 방지용 상한)
      stopAfterSleeps: cycles,
    });
    await runLoop(l.io, l.handle);
    expect(l.sleeps).toEqual(Array(cycles).fill(LOCK_LOST_WAIT_MS));
    expect(l.polls).toBe(cycles);                                // 대기 1회당 getUpdates 1회
    expect(l.handled).toEqual([]);
    expect(l.saved).toEqual([]);
    // 대기는 락 해제·연결 반납 **뒤**에 한다 (쉬는 동안 풀 슬롯을 쥐지 않는다)
    expect(l.events.slice(0, 3)).toEqual(['conn#1', 'release#1', `sleep:${LOCK_LOST_WAIT_MS}`]);
    expect(l.conns.every((c) => c.released === 1 && c.queries.filter((q) => /RELEASE_LOCK/.test(q)).length === 1)).toBe(true);
  });

  test.each([
    // [C2] 순서가 처리 → 저장 → 확인으로 바뀌어, 두 번째 경우는 처리가 끝난 103 의 오프셋(104)이 확인 전에 저장돼 있다
    ['getUpdates 반환 직후', [true, 'throw'] as Array<boolean | 'throw'>, [] as string[], [] as number[]],
    ['처리·저장 뒤(= 다음 업데이트 처리 전)', [true, true, 'throw'] as Array<boolean | 'throw'>, ['q103'], [104]],
  ])('🔴 [T-047 R-3] 락 확인 쿼리가 던지면(%s) 쥐고 있다고도, 잃었다고도 보지 않는다 — 오류로 전파돼 남은 배치 미처리·백오프 (fail-closed)', async (_where, heldChecks, expectHandled, expectSaved) => {
    const l = makeLoop({
      lockGranted: [true, false],
      heldChecks,
      updates: [{ ok: true, result: [cbUpdate(103), cbUpdate(104)] }],
      stopAfterPolls: 99,
      stopAfterSleeps: 1,
    });
    await runLoop(l.io, l.handle);
    expect(l.handled).toEqual(expectHandled);                    // held 로 보면(fail-open) 배치를 계속 처리한다
    expect(l.saved).toEqual(expectSaved);                        // 확인 실패 뒤로는 저장하지 않는다
    expect(l.sleeps).toEqual([backoffMs(1)]);                    // lost 로 보면 최소 대기(1초)로 조용히 재진입한다 — 그게 아니라 실패 백오프
    expect(l.errors).toHaveLength(1);
    expect(l.errors[0]).toMatch(/루프 예외.*conn gone/);           // 오류가 삼켜지지 않고 기록된다
    expect(l.conns[0].released).toBe(1);
    expect(l.conns[0].queries.filter((q) => /RELEASE_LOCK/.test(q))).toHaveLength(1);
  });

  test('🔴 [T-047 R-3] 폴링 중 락 확인은 획득한 락과 **같은 이름**을 같은 연결에서 묻는다', async () => {
    const l = makeLoop({
      lockGranted: [true],
      updates: [{ ok: true, result: [cbUpdate(103), cbUpdate(104)] }],
    });
    await runLoop(l.io, l.handle);
    const c = l.conns[0];
    const nameOf = (re: RegExp) => c.queries.map((q, i) => [q, c.params[i]] as const).filter(([q]) => re.test(q)).map(([, p]) => p);
    const got = nameOf(/GET_LOCK/);
    const checks = nameOf(/IS_USED_LOCK/);
    expect(got).toEqual([[POLLER_LOCK_NAME]]);
    expect(checks.length).toBeGreaterThanOrEqual(4);             // while 조건 + 반환 직후 + 저장 뒤 ×2
    expect(checks.every((p) => JSON.stringify(p) === JSON.stringify([POLLER_LOCK_NAME]))).toBe(true);
    expect(l.saved).toEqual([104, 105]);
  });

  // ⚠ [C2] 이 테스트는 원래 "처리 도중 락을 잃으면 저장하지 않는다"(saved=[])를 고정했다. 저장하지 않으면 새 소유자가 같은 콜백을
  //   다시 처리해 확정 거부로 풀린 선점에 두 번째 주문이 나갈 수 있어(아래 재현 테스트) 불변식을 바꿨다 — 단조 SQL 이 역행을 막는다.
  test('🔴 [T-047 C2] 처리 도중 락을 잃어도 처리가 끝난 업데이트의 오프셋은 저장하고, 남은 것은 처리·저장하지 않는다', async () => {
    const l = makeLoop({
      lockGranted: [true, false],
      heldChecks: [true, true, false],                           // while → 반환 직후 → (103 처리·저장 뒤) lost
      updates: [{ ok: true, result: [cbUpdate(103), cbUpdate(104)] }],
      stopAfterPolls: 99,
      stopAfterSleeps: 1,
    });
    await runLoop(l.io, l.handle);
    expect(l.handled).toEqual(['q103']);
    expect(l.saved).toEqual([104]);
    expect(l.sleeps).toEqual([LOCK_LOST_WAIT_MS]);
  });

  test('🔴 [T-047 C2] 순차 재수신 시나리오 — 확정 거부로 선점이 풀린 승인을 처리·저장한 직후 락을 잃고 재획득해도, 같은 입력을 다시 받지 않아 주문 시도는 한 번뿐이다', async () => {
    // T-054 (Reviewer R-10): 이 테스트가 모사하는 범위는 **한 소비자가 락을 잃었다 다시 잡아 이어서 폴링하는 순차 경로** 뿐이다.
    // 두 소비자가 같은 배치를 동시에 처리하는 경합(텔레그램 실서버의 재전달 시점·두 프로세스의 겹침)과 실제 DB 의 단조 SQL 의미는
    // 모사하지 않는다. 동시 처리는 원자적 전이가 '둘이 동시에 이기는 것'만 막고, 새 소유자가 이전 소유자의 저장 **전에** 오프셋을 읽고
    // releaseClaim **뒤에** 선점하는 좁은 창은 닫히지 않았다(T-047 Reviewer R-9 — callback_query.id 별 처리 기록은 후속 과제).
    // 단조 SQL 의 의미는 저장 SQL 정확 일치 테스트 + 일회용 MariaDB 11.8 실측이 근거다(운영 10.11 에서는 실행하지 않았다).
    // 가짜 텔레그램: 확인되지 않은(offset 이상) 업데이트를 돌려준다. 가짜 저장소: 단조 증가(운영 SQL 과 같은 의미).
    // 가짜 처리기: approveSignal 의 확정 거부 경로 — 원자적 선점 성공 → submitOrder → 거부 → releaseClaim(대기 상태로 복귀).
    const l = makeLoop({ lockGranted: [true, true], heldChecks: [true, true, false] });   // 1차: while → 반환 직후 → 103 처리·저장 뒤 lost
    const pending = [cbUpdate(103)];
    let stored = 100;
    const offsets: number[] = [];
    const signal = { status: 'awaiting_approval' };
    let submits = 0;
    l.io.loadOffset = async () => stored;
    l.io.saveOffset = async (n) => { l.saved.push(n); stored = Math.max(stored, n); };
    l.io.getUpdates = async (offset) => {
      offsets.push(offset);
      if (offsets.length >= 2) l.handle.stopped = true;          // 재획득 후 한 번 더 폴링하고 끝
      return { ok: true, result: pending.filter((u) => u.update_id >= offset) };
    };
    l.io.handle = async (cq) => {
      l.handled.push(cq.id);
      if (signal.status !== 'awaiting_approval') return { kind: 'decision', view: { kind: 'already_handled' } };
      signal.status = 'executing';                               // claimAwaitingSignal 성공
      submits++;                                                 // submitOrder
      signal.status = 'awaiting_approval';                       // order_not_accepted → releaseClaim
      return { kind: 'decision', view: { kind: 'order_rejected' } };
    };
    await runLoop(l.io, l.handle);
    expect(submits).toBe(1);                                     // 🔴 버튼 한 번 = 주문 시도 한 번
    expect(l.handled).toEqual(['q103']);
    expect(l.saved).toEqual([104]);                              // 락을 잃었어도 처리가 끝난 103 은 확인(저장)됐다
    expect(offsets).toEqual([100, 104]);                         // 새 소유자는 104 부터 받는다
    expect(l.sleeps).toEqual([LOCK_LOST_WAIT_MS]);               // lock_lost 로 끝나고 재획득했다
    expect(l.conns).toHaveLength(2);
  });

  test('독이 든 업데이트가 있어도 루프는 계속되고 오프셋은 넘어간다', async () => {
    const l = makeLoop({ updates: [{ ok: true, result: [cbUpdate(101), cbUpdate(102)] }] });
    l.io.handle = async (cq) => { if (cq.id === 'q101') throw new Error('boom'); l.handled.push(cq.id); };
    await runLoop(l.io, l.handle);
    expect(l.handled).toEqual(['q102']);
    expect(l.saved).toEqual([102, 103]);
  });
});
