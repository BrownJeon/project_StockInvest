/**
 * T-143 WP-A — 월간 산출 알림 (사양 §9 · 가이드 §7 · Leader 결정 L-A1).
 *
 * 🔴 **침묵이 기본값이다**: 「변경 없음」을 보내지 않는다(T-125 재발 방지). 그 조건을 수치로 고정한다.
 */
import {
  buildMessage, notifyUniverseRefresh, notifyUniverseWindowIncomplete, type NotifiableProposal,
} from '../refresh-notify';

const dispatch = jest.fn();
const sendTelegramMessage = jest.fn();
const sendTelegramAlert = jest.fn();
const markProposalsNotified = jest.fn();
const markRunNotified = jest.fn();
const readRun = jest.fn();
const readProgress = jest.fn();

jest.mock('@/lib/notify', () => ({ dispatchAlertWithTelegram: (...a: unknown[]) => dispatch(...a) }));
jest.mock('@/lib/notify/telegram-api', () => ({ sendTelegramMessage: (...a: unknown[]) => sendTelegramMessage(...a) }));
jest.mock('@/lib/notify/telegram', () => ({ sendTelegramAlert: (...a: unknown[]) => sendTelegramAlert(...a) }));
jest.mock('../refresh-store', () => ({
  markProposalsNotified: (...a: unknown[]) => markProposalsNotified(...a),
  markRunNotified: (...a: unknown[]) => markRunNotified(...a),
  readRun: (...a: unknown[]) => readRun(...a),
  readProgress: (...a: unknown[]) => readProgress(...a),
  // 순수 헬퍼는 실제와 같은 값이어야 한다(모형이 다르면 그 차이만큼 시험이 아무것도 지키지 않는다)
  isTerminalPhase: (ph: string) => ['complete', 'failed', 'expired'].includes(ph),
}));

const NOW = Date.parse('2026-12-06T02:14:00+09:00');

function prop(p: Partial<NotifiableProposal> = {}): NotifiableProposal {
  return {
    id: 1, symbol: 'NYS:WMT', kind: 'exchange_move', basisText: 'SEC 상장 목록: exchange=Nasdaq (SEC 76b92fba)',
    recommendation: null, actionType: 'recode', nextSymbol: 'NAS:WMT', ...p,
  };
}

/** 응답을 돌려주는 가짜 DB — 질의의 표 이름으로 가른다. */
function fakeDb(o: {
  proposals?: Record<string, unknown>[];
  toggle?: unknown;
  appUrl?: unknown;
  revision?: { symbols: string[]; updatedAt?: string } | null;
  held?: [string, number | null][];
  throwOn?: string;
}) {
  return {
    query: async (sql: string, params?: unknown[]) => {
      if (o.throwOn && sql.includes(o.throwOn)) throw new Error('db down');
      if (sql.includes('overseas_universe_proposal')) return [o.proposals ?? [], null];
      if (sql.includes('system_config')) {
        const key = (params ?? [])[0];
        if (key === 'notify_signal_universe') return [o.toggle === undefined ? [] : [{ value: o.toggle }], null];
        if (key === 'app_public_url') return [o.appUrl === undefined ? [] : [{ value: o.appUrl }], null];
        return [[], null];
      }
      if (sql.includes('overseas_universe_revision')) {
        return [o.revision ? [{
          revision_no: 3, symbols: JSON.stringify(o.revision.symbols), symbol_count: o.revision.symbols.length,
          created_at: o.revision.updatedAt ?? '2025-12-19 10:00:00',
        }] : [], null];
      }
      if (sql.includes('overseas_universe_auto')) return [[], null];
      if (sql.includes('stock_favorites')) return [[], null];
      if (sql.includes('position_state')) return [(o.held ?? []).map(([symbol, qty]) => ({ symbol, qty })), null];
      return [[], null];
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // 저장소 쓰기는 Promise 를 돌려준다(호출부가 `.catch()` 로 감싼다)
  markProposalsNotified.mockResolvedValue(undefined);
  markRunNotified.mockResolvedValue(undefined);
  // 기본: 버튼 메시지가 전송된다
  sendTelegramMessage.mockResolvedValue({ ok: true, data: { message_id: 1, chat: { id: 1 } } });
  dispatch.mockImplementation(async (_l, _t, _b, send: () => Promise<unknown>) => {
    await send();
    return { channel: 'telegram', delivered: ['telegram'], failed: [], unconfigured: [] };
  });
});

describe('🔴 조건 — 변화가 0이면 침묵한다 (T-125 재발 방지)', () => {
  it('제안 0 · 자동 변동 0 → 아무것도 보내지 않는다', async () => {
    const r = await notifyUniverseRefresh({ runId: 1, added: [], removed: [], nowMs: NOW, db: fakeDb({}) });
    expect(r).toMatchObject({ sent: false, reason: 'no_change' });
    expect(dispatch).not.toHaveBeenCalled();
    expect(markProposalsNotified).not.toHaveBeenCalled();
  });

  it('🔴 1회차는 diff 가 비어도 보낸다 — 0 → 상위 N 이 가장 큰 변화다(high-2)', async () => {
    const r = await notifyUniverseRefresh({
      runId: 1, added: [], removed: [], firstRun: true, top: ['NYS:A', 'NYS:B'], nowMs: NOW, db: fakeDb({}),
    });
    expect(r).toMatchObject({ sent: true, reason: null, firstRun: true, added: 0, removed: 0, proposals: 0 });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(markRunNotified).toHaveBeenCalledTimes(1);
    // 본문이 「첫 산출」과 「다음 분석부터 쓴다」를 말한다
    const body = String(dispatch.mock.calls[0][2]);
    expect(body).toContain('NYSE 상위 목록 첫 산출');
    expect(body).toContain('2종목');
    expect(body).toContain('+ NYS:A NYS:B');
    expect(body).toContain('다음 「해외 장마감 분석」부터 이 목록을 씁니다');
    expect(String(dispatch.mock.calls[0][1])).toBe('해외 분석 대상 — 자동 목록 첫 산출 (2종목)');
  });

  it('1회차가 아니고 변화도 0이면 여전히 침묵한다(T-125 는 그대로)', async () => {
    const r = await notifyUniverseRefresh({
      runId: 1, added: [], removed: [], firstRun: false, nowMs: NOW, db: fakeDb({}),
    });
    expect(r).toMatchObject({ sent: false, reason: 'no_change', firstRun: false });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('🔴 자동 목록만 바뀌어도 보낸다 (L-A1 — 제안·승인을 거치지 않고 분석 대상이 된다)', async () => {
    const r = await notifyUniverseRefresh({
      runId: 1, added: ['NYS:AAA'], removed: ['NYS:ZZZ'], nowMs: NOW, db: fakeDb({}),
    });
    expect(r).toMatchObject({ sent: true, proposals: 0, added: 1, removed: 1, level: 'info' });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(markRunNotified).toHaveBeenCalledTimes(1);
  });

  it('제안만 있어도 보낸다(자동 변동 0)', async () => {
    const db = fakeDb({ proposals: [{ proposal_id: 7, symbol: 'NYS:WMT', kind: 'exchange_move', basis_text: 'b', recommendation: null, action_type: 'recode', next_symbol: 'NAS:WMT' }] });
    const r = await notifyUniverseRefresh({ runId: 1, added: [], removed: [], nowMs: NOW, db });
    expect(r).toMatchObject({ sent: true, proposals: 1 });
    expect(markProposalsNotified).toHaveBeenCalledWith(expect.objectContaining({ ids: [7] }));
    // 자동 변동이 없으면 run 알림 시각은 건드리지 않는다
    expect(markRunNotified).not.toHaveBeenCalled();
  });
});

describe('토글 — 텔레그램만 멈춘다', () => {
  const db = (toggle: unknown) => fakeDb({
    toggle, proposals: [{ proposal_id: 7, symbol: 'NYS:A', kind: 'delisting', basis_text: 'b', recommendation: null, action_type: 'remove', next_symbol: null }],
  });

  it('꺼져 있으면 보내지 않고 **notified_at 도 채우지 않는다**(나중에 켰을 때 한 번은 알려지게)', async () => {
    const r = await notifyUniverseRefresh({ runId: 1, added: [], removed: [], nowMs: NOW, db: db('false') });
    expect(r).toMatchObject({ sent: false, reason: 'toggle_off', proposals: 1 });
    expect(dispatch).not.toHaveBeenCalled();
    expect(markProposalsNotified).not.toHaveBeenCalled();
  });

  it('키가 없으면 켜짐이다(기존 알람 4개와 같은 방향)', async () => {
    const r = await notifyUniverseRefresh({ runId: 1, added: [], removed: [], nowMs: NOW, db: db(undefined) });
    expect(r.sent).toBe(true);
  });

  it('JSON true·그 밖의 값은 켜짐, 정확히 false 만 꺼짐', async () => {
    for (const v of ['true', 'TRUE', '1', 'on', '{}']) {
      expect((await notifyUniverseRefresh({ runId: 1, added: [], removed: [], nowMs: NOW, db: db(v) })).sent).toBe(true);
    }
    // 정확히 false 만 꺼짐이다
    for (const v of ['false', 'FALSE', ' false ']) {
      expect((await notifyUniverseRefresh({ runId: 1, added: [], removed: [], nowMs: NOW, db: db(v) })).reason).toBe('toggle_off');
    }
  });

  it('읽기 실패는 켜짐으로 본다 — 모르는 채 조용해지지 않는다', async () => {
    const d = fakeDb({
      throwOn: 'system_config',
      proposals: [{ proposal_id: 7, symbol: 'NYS:A', kind: 'delisting', basis_text: 'b', recommendation: null, action_type: 'remove', next_symbol: null }],
    });
    expect((await notifyUniverseRefresh({ runId: 1, added: [], removed: [], nowMs: NOW, db: d })).sent).toBe(true);
  });
});

describe('전송 실패·조회 실패', () => {
  it('🔴 보내지 못했으면 notified_at 을 채우지 않는다(다음 산출이 다시 알릴 수 있어야 한다)', async () => {
    dispatch.mockResolvedValue({ channel: 'telegram', delivered: [], failed: [{ channel: 'telegram', error: 'x' }], unconfigured: [] });
    const db = fakeDb({ proposals: [{ proposal_id: 7, symbol: 'NYS:A', kind: 'delisting', basis_text: 'b', recommendation: null, action_type: 'remove', next_symbol: null }] });
    const r = await notifyUniverseRefresh({ runId: 1, added: [], removed: [], nowMs: NOW, db });
    expect(r).toMatchObject({ sent: false, reason: 'send_failed' });
    expect(markProposalsNotified).not.toHaveBeenCalled();
  });

  it('발송 함수가 던져도 호출부로 던지지 않는다(산출을 되돌리지 않는다)', async () => {
    dispatch.mockRejectedValue(new Error('boom'));
    const db = fakeDb({ proposals: [{ proposal_id: 7, symbol: 'NYS:A', kind: 'delisting', basis_text: 'b', recommendation: null, action_type: 'remove', next_symbol: null }] });
    const r = await notifyUniverseRefresh({ runId: 1, added: [], removed: [], nowMs: NOW, db });
    expect(r).toMatchObject({ sent: false, reason: 'send_failed' });
  });

  it('제안 조회가 실패하면 보내지 않고 사유를 남긴다(추측해서 보내지 않는다)', async () => {
    const r = await notifyUniverseRefresh({
      runId: 1, added: ['NYS:A'], removed: [], nowMs: NOW, db: fakeDb({ throwOn: 'overseas_universe_proposal' }),
    });
    expect(r).toMatchObject({ sent: false, reason: 'read_failed' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('목록 조회가 실패해도 보낸다(숫자 줄만 빠진다)', async () => {
    const db = fakeDb({ throwOn: 'overseas_universe_revision' });
    const r = await notifyUniverseRefresh({ runId: 1, added: ['NYS:A'], removed: [], nowMs: NOW, db });
    expect(r.sent).toBe(true);
  });

  it('버튼 메시지가 거부되면 평문으로 대체 발송한다', async () => {
    sendTelegramMessage.mockResolvedValue({ ok: false, error: 'bad url' });
    sendTelegramAlert.mockResolvedValue({ ok: true });
    const db = fakeDb({ appUrl: 'https://x.example', proposals: [{ proposal_id: 7, symbol: 'NYS:A', kind: 'delisting', basis_text: 'b', recommendation: null, action_type: 'remove', next_symbol: null }] });
    const r = await notifyUniverseRefresh({ runId: 1, added: [], removed: [], nowMs: NOW, db });
    expect(sendTelegramAlert).toHaveBeenCalled();
    expect(r.sent).toBe(true);
  });
});

describe('본문 조립', () => {
  const base = {
    added: [] as string[], removed: [] as string[], manual: ['NYS:WMT', 'NAS:AAPL'],
    held: new Map<string, number | null>(), manualUpdatedAt: null as string | null,
    manualUpdatedDaysAgo: null as number | null, computedAtLabel: '12-06 02:14', appUrl: null as string | null,
  };

  it('제안 줄·근거·권고가 데모 순서대로 들어간다', () => {
    const m = buildMessage({ ...base, proposals: [prop()] });
    expect(m.plain.split('\n').slice(0, 4)).toEqual([
      '📋 해외 분석 대상 — 변경 제안 1건',
      '1. NYS:WMT · 거래소 이동 (→ NASDAQ)',
      '   근거 SEC 상장 목록: exchange=Nasdaq (SEC 76b92fba)',
      '   권고 코드 바꾸기 NYS:WMT → NAS:WMT',
    ]);
    expect(m.level).toBe('info');
  });

  it('권고가 있으면 그 문장을 쓴다', () => {
    const m = buildMessage({
      ...base,
      proposals: [prop({ kind: 'kis_unavailable', actionType: 'remove', nextSymbol: null, recommendation: '표기 확인(클래스주 . 표기 등) 또는 빼기' })],
    });
    expect(m.plain).toContain('   권고 표기 확인(클래스주 . 표기 등) 또는 빼기');
    expect(m.plain).toContain('· KIS 조회 불가');
  });

  it('🔴 보유 중인 종목을 빼라는 제안이 있으면 수준이 warning 이고 보유 줄이 붙는다', () => {
    const m = buildMessage({
      ...base,
      proposals: [prop({ kind: 'delisting', actionType: 'remove', nextSymbol: null })],
      held: new Map([['NYS:WMT', 12]]),
    });
    expect(m.level).toBe('warning');
    expect(m.plain).toContain('   ⚠ 보유 중 12주');
  });

  it('수량을 모르면 「보유 중」으로만 쓴다(0 으로 채우지 않는다)', () => {
    const m = buildMessage({
      ...base, proposals: [prop({ actionType: 'remove', nextSymbol: null })], held: new Map([['NYS:WMT', null]]),
    });
    expect(m.plain).toContain('   ⚠ 보유 중');
    expect(m.plain).not.toContain('0주');
  });

  it('보유 중이어도 「빼기」가 아니면 수준을 올리지 않는다', () => {
    const m = buildMessage({ ...base, proposals: [prop()], held: new Map([['NYS:WMT', 5]]) });
    expect(m.level).toBe('info');
  });

  it('자동 목록 변동 단락 — 상장 상태 변화로 빠진 것은 따로 표시한다', () => {
    const m = buildMessage({
      ...base,
      proposals: [prop({ symbol: 'NYS:DDD', kind: 'delisting', actionType: 'remove', nextSymbol: null })],
      added: ['NYS:AAA', 'NYS:BBB'], removed: ['NYS:DDD', 'NYS:EEE'],
    });
    expect(m.plain).toContain('📈 NYSE 상위 목록 갱신 (12-06 02:14) — 들어옴 2 · 나감 2');
    expect(m.plain).toContain('   + NYS:AAA NYS:BBB');
    expect(m.plain).toContain('   − NYS:DDD(상장 상태 변화) NYS:EEE');
  });

  it('「다 반영하면」 숫자는 제안을 실제로 적용해 센다(더하기·빼기로 추정하지 않는다)', () => {
    const m = buildMessage({
      ...base,
      manual: ['NYS:WMT', 'NAS:AAPL', 'NYS:X'],
      proposals: [prop({ id: 1, symbol: 'NYS:X', kind: 'delisting', actionType: 'remove', nextSymbol: null })],
    });
    expect(m.plain).toContain('수동 3종목 · 다 반영하면 2');
  });

  it('코드 바꾸기만 있으면 수가 그대로라 「다 반영하면」을 쓰지 않는다', () => {
    const m = buildMessage({ ...base, proposals: [prop()] });
    expect(m.plain).toContain('수동 2종목');
    expect(m.plain).not.toContain('다 반영하면');
  });

  it('수동 갱신 날짜·12월 재구성 경고가 들어간다', () => {
    const m = buildMessage({ ...base, proposals: [prop()], manualUpdatedAt: '2025-12-19T10:00:00+09:00', manualUpdatedDaysAgo: 352 });
    expect(m.plain).toContain('수동 갱신 2025-12-19 (352일 전)');
    expect(m.plain).toContain('⚠ 12월 정기 재구성은 공시에 안 나옵니다');
  });

  it('1회차 본문은 종목 10개까지 적고 나머지는 「외 n종목」', () => {
    const top = Array.from({ length: 50 }, (_, i) => `NYS:S${i}`);
    const m = buildMessage({ ...base, proposals: [], firstRun: true, top });
    expect(m.plain).toContain('📈 NYSE 상위 목록 첫 산출 (12-06 02:14) — 50종목');
    expect(m.plain).toContain('외 40종목');
    expect(m.plain).toContain('NYS:S9');
    expect(m.plain).not.toContain('NYS:S10 ');
    expect(m.level).toBe('info');
  });

  it('1회차에도 제안이 있으면 제안 단락이 먼저 나온다(제목도 제안 기준)', () => {
    const m = buildMessage({ ...base, proposals: [prop()], firstRun: true, top: ['NYS:A'] });
    expect(m.plain.split('\n')[0]).toContain('변경 제안 1건');
    expect(m.plain).toContain('NYSE 상위 목록 첫 산출');
    expect(m.title).toBe('해외 분석 대상 — 변경 제안 1건');
  });

  it('제안이 10건을 넘으면 10건 + 「외 n건」', () => {
    const many = Array.from({ length: 13 }, (_, i) => prop({ id: i + 1, symbol: `NYS:S${i}` }));
    const m = buildMessage({ ...base, proposals: many });
    expect(m.plain).toContain('📋 해외 분석 대상 — 변경 제안 13건');
    expect(m.plain).toContain('   외 3건');
    expect(m.plain).toContain('10. NYS:S9');
    expect(m.plain).not.toContain('11. NYS:S10');
  });

  it('버튼은 기존 글자 「🔗 앱에서 자세히」이고 제안 탭을 가리킨다(조작 버튼 없음)', () => {
    const m = buildMessage({ ...base, proposals: [prop()], appUrl: 'https://stock.example.com/' });
    expect(m.keyboard).toEqual({
      inline_keyboard: [[{ text: '🔗 앱에서 자세히', url: 'https://stock.example.com/settings/overseas-universe?tab=proposals' }]],
    });
  });

  it('끝 슬래시가 없어도 경로가 겹치지 않는다', () => {
    const m = buildMessage({ ...base, proposals: [prop()], appUrl: 'https://stock.example.com' });
    expect(m.keyboard?.inline_keyboard[0][0].url).toBe('https://stock.example.com/settings/overseas-universe?tab=proposals');
  });

  it('https 가 아니거나 비어 있으면 버튼을 달지 않는다(텔레그램 400 을 만들지 않는다)', () => {
    for (const url of [null, '', 'http://x', 'stock.example.com', 'https://has space']) {
      expect(buildMessage({ ...base, proposals: [prop()], appUrl: url }).keyboard).toBeUndefined();
    }
  });

  it('🔴 HTML 쪽은 외부에서 온 글자를 이스케이프한다(피싱 링크·400 방지)', () => {
    const m = buildMessage({
      ...base,
      proposals: [prop({ symbol: 'NYS:<b>X</b>', basisText: 'a & <a href="http://evil">click</a>' })],
    });
    expect(m.html).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(m.html).toContain('a &amp; &lt;a href=');
    expect(m.html).not.toContain('<a href="http://evil"');
    // 평문(슬랙·폴백)은 원문 그대로다 — dispatchAlert 가 두 채널에 같은 본문을 보내므로 HTML 쪽만 손본다
    expect(m.plain).toContain('a & <a href="http://evil">click</a>');
  });

  it('제목은 제안 유무로 갈린다', () => {
    expect(buildMessage({ ...base, proposals: [prop()] }).title).toBe('해외 분석 대상 — 변경 제안 1건');
    expect(buildMessage({ ...base, proposals: [], added: ['NYS:A'], removed: [] }).title)
      .toBe('해외 분석 대상 — 자동 목록 갱신 (들어옴 1 · 나감 0)');
  });

  it('모르는 종류는 영문 코드를 그대로 보이지 않는다', () => {
    const m = buildMessage({ ...base, proposals: [prop({ kind: 'brand_new_kind' })] });
    expect(m.plain).toContain('· 알 수 없는 변경');
    expect(m.plain).not.toContain('brand_new_kind');
  });
});

/**
 * 🔴 T-145 ④-조각 — **창이 끝났는데 미완이면 warning 1회.**
 *
 * 왜 필요한가: ⑥-4 로 일시 오류가 그 달을 닫지 않게 바꾸면서, 창이 끝날 때 `failed` 조차 남지 않는
 * **미완** 경로가 생겼다. 전에는 영구 실패로 닫혀 적어도 종결 기록이 남았다.
 * 중복 발송은 기존 `overseas_universe_run.notified_at` 로 막고, **발송 실패가 산출을 막지 않는다.**
 */
describe('🔴 창 종료 점검 — 미완이면 warning 1회 (T-145 ④-조각)', () => {
  const KEY = '2026-12';
  const run = (o: Partial<{ phase: string; notifiedAt: string | null }> = {}) => ({
    kind: 'ok' as const,
    data: {
      runId: 7, runKey: KEY, phase: o.phase ?? 'scan', topN: 50, cursorPos: 100,
      secSha256: null, lastError: null, notifiedAt: o.notifiedAt ?? null,
    },
  });
  const prog = {
    kind: 'ok' as const,
    data: { pending: 1200, ok: 800, excluded: 700, kisMissing: 10, kisError: 5, total: 2715 },
  };

  beforeEach(() => {
    readProgress.mockResolvedValue(prog);
    dispatch.mockImplementation(async (_l: unknown, _t: unknown, _b: unknown, tg?: () => Promise<unknown>) => {
      if (tg) await tg();
      return { delivered: ['telegram'] };
    });
  });

  it('🔴 미완(scan)이면 warning 을 보내고 run 을 「알렸음」으로 표시한다', async () => {
    readRun.mockResolvedValue(run({ phase: 'scan' }));
    const r = await notifyUniverseWindowIncomplete({ runKey: KEY, nowMs: NOW, db: fakeDb({}) as never });
    expect(r).toEqual({ sent: true, reason: null, phase: 'scan' });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0]).toBe('warning');
    const body = String(dispatch.mock.calls[0][2]);
    expect(body).toContain('2026-12');
    expect(body).toContain('단계 scan');
    expect(body).toContain('자동 목록은 바뀌지 않았습니다');   // 사용자가 알아야 할 결론
    expect(markRunNotified).toHaveBeenCalledWith(expect.objectContaining({ runId: 7 }));
  });

  it('listing·retry·finalize 도 미완이다(네 단계 모두 집는다)', async () => {
    for (const phase of ['listing', 'retry', 'finalize']) {
      jest.clearAllMocks();
      readProgress.mockResolvedValue(prog);
      markRunNotified.mockResolvedValue(undefined);
      dispatch.mockResolvedValue({ delivered: ['telegram'] });
      readRun.mockResolvedValue(run({ phase }));
      expect((await notifyUniverseWindowIncomplete({ runKey: KEY, nowMs: NOW, db: fakeDb({}) as never })).sent).toBe(true);
    }
  });

  it('complete 면 보내지 않는다(알릴 것이 없다)', async () => {
    readRun.mockResolvedValue(run({ phase: 'complete' }));
    const r = await notifyUniverseWindowIncomplete({ runKey: KEY, nowMs: NOW, db: fakeDb({}) as never });
    expect(r).toEqual({ sent: false, reason: 'complete', phase: 'complete' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('🔴 failed·expired 는 집지 않는다 — 종전 경로(job_run_log·prevMonthIncomplete)가 이미 알린다', async () => {
    for (const phase of ['failed', 'expired']) {
      jest.clearAllMocks();
      readRun.mockResolvedValue(run({ phase }));
      const r = await notifyUniverseWindowIncomplete({ runKey: KEY, nowMs: NOW, db: fakeDb({}) as never });
      expect(r).toEqual({ sent: false, reason: 'closed', phase });
      expect(dispatch).not.toHaveBeenCalled();
    }
  });

  it('🔴 이미 알렸으면 다시 보내지 않는다 — **1회**다', async () => {
    readRun.mockResolvedValue(run({ phase: 'scan', notifiedAt: '2026-12-06 05:50:01' }));
    const r = await notifyUniverseWindowIncomplete({ runKey: KEY, nowMs: NOW, db: fakeDb({}) as never });
    expect(r).toEqual({ sent: false, reason: 'already_notified', phase: 'scan' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('이달 run 이 아예 없으면 보내지 않는다(④ 의 나머지 — 범위 밖)', async () => {
    readRun.mockResolvedValue({ kind: 'ok', data: null });
    const r = await notifyUniverseWindowIncomplete({ runKey: KEY, nowMs: NOW, db: fakeDb({}) as never });
    expect(r).toEqual({ sent: false, reason: 'no_run', phase: null });
  });

  it('표가 없거나 조회가 실패하면 조용히 끝낸다(던지지 않는다)', async () => {
    for (const out of [{ kind: 'not_migrated' }, { kind: 'error', error: 'db down', retryable: true }]) {
      jest.clearAllMocks();
      readRun.mockResolvedValue(out);
      const r = await notifyUniverseWindowIncomplete({ runKey: KEY, nowMs: NOW, db: fakeDb({}) as never });
      expect(r).toEqual({ sent: false, reason: 'read_failed', phase: null });
    }
  });

  it('토글이 꺼져 있으면 보내지 않는다(사용자 스위치를 경고라는 이름으로 우회하지 않는다)', async () => {
    readRun.mockResolvedValue(run({ phase: 'scan' }));
    const r = await notifyUniverseWindowIncomplete({
      runKey: KEY, nowMs: NOW, db: fakeDb({ toggle: 'false' }) as never,
    });
    expect(r).toEqual({ sent: false, reason: 'toggle_off', phase: 'scan' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('🔴 발송이 실패하면 **표시하지 않는다** — 사람이 다시 부르면 한 번 더 해 볼 수 있다', async () => {
    readRun.mockResolvedValue(run({ phase: 'scan' }));
    dispatch.mockResolvedValue({ delivered: [] });
    const r = await notifyUniverseWindowIncomplete({ runKey: KEY, nowMs: NOW, db: fakeDb({}) as never });
    expect(r).toEqual({ sent: false, reason: 'send_failed', phase: 'scan' });
    expect(markRunNotified).not.toHaveBeenCalled();
  });

  it('발송이 **던져도** 던지지 않는다(알림 실패가 산출·응답을 막지 않는다)', async () => {
    readRun.mockResolvedValue(run({ phase: 'scan' }));
    dispatch.mockRejectedValue(new Error('boom'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await notifyUniverseWindowIncomplete({ runKey: KEY, nowMs: NOW, db: fakeDb({}) as never });
    expect(r.sent).toBe(false);
    expect(r.reason).toBe('send_failed');
  });

  it('진행 집계를 못 읽어도 보낸다(숫자 줄만 빠진다)', async () => {
    readRun.mockResolvedValue(run({ phase: 'scan' }));
    readProgress.mockResolvedValue({ kind: 'error', error: 'x', retryable: true });
    const r = await notifyUniverseWindowIncomplete({ runKey: KEY, nowMs: NOW, db: fakeDb({}) as never });
    expect(r.sent).toBe(true);
    expect(String(dispatch.mock.calls[0][2])).not.toContain('후보');
  });
});
