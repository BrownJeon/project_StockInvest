/**
 * T-072 G3 — `POST /api/signals/custom/confirm` × 검증 상태 관문 (**실제 관문**).
 *
 * 지킬 것 (사용자 결정 D-1 "전부 차단", 설계 F-1·F-2, WP-2b 지시 3·8):
 *  1. 🔴 매수 확정은 **GET_LOCK 전에** 거절한다 — DB 연결·명명 락·트랜잭션 0, signals INSERT 0, 원 카드 선점(UPDATE) 0, 가상 체결 0.
 *     이 경로의 행은 전략 귀속이 없다(INSERT strategy_id NULL) → `null_strategy`. 원 카드 경유(sourceSignalId)든 직접 작성이든 같다.
 *  2. 응답: 403 + `{ ok:false, error: <한국어 문구>, errorCode:'validation_gate' }` — 화면(`/recommend/build`·ScenarioDetail)은 `data.error` 를 그대로 보인다.
 *  3. 흔적: trade_logs `signal_validation_gate` 1행(감사 원칙 3). 기록 실패는 거절 결과를 바꾸지 않는다.
 *  4. 🔴 매도 확정(정규화 후 정확히 'sell' — 'SELL'·' sell ' 포함)은 관문이 strategies 조회 없이 통과시킨다 — 기존대로 락 → 트랜잭션 → INSERT.
 *     WP-2c R-1: 판정은 관문 함수 첫 줄에만 있다(라우트의 `=== 'buy'` 지역 분기 제거). `direction:'BUY'`·`'buy '` 도 매수로 403.
 *  5. 수치·shape 가드(T-029)는 그대로 먼저다(잘못된 본문은 여전히 400).
 */
jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/notify', () => ({ sendAlert: jest.fn(), getSymbolLabel: jest.fn(async (s: string) => s) }));
jest.mock('@/lib/safety/validation-gate', () => {
  const actual = jest.requireActual('@/lib/safety/validation-gate');
  return { ...actual, evaluateValidationGate: jest.fn(actual.evaluateValidationGate) };
});

import { POST } from '../route';
import { getPool } from '@/lib/db';
import { VALIDATION_GATE_USER_MESSAGE, evaluateValidationGate } from '@/lib/safety/validation-gate';

interface Call { sql: string; params: unknown[]; via: 'pool' | 'conn' }
let calls: Call[];
let tradeLogsThrow: boolean;
let getConnection: jest.Mock;
let insertSeq: number;

function handle(via: 'pool' | 'conn', sqlArg: unknown, paramsArg: unknown[] = []): unknown {
  const sql = String(sqlArg);
  calls.push({ sql, params: paramsArg ?? [], via });
  if (/INSERT INTO trade_logs/.test(sql)) {
    if (tradeLogsThrow) throw new Error('trade_logs down');
    return [{ insertId: 1 }, []];
  }
  if (/GET_LOCK/.test(sql)) return [[{ got: 1 }], []];
  if (/RELEASE_LOCK/.test(sql)) return [[{ rel: 1 }], []];
  if (/INSERT INTO signals/.test(sql)) return [{ insertId: ++insertSeq }, []];
  if (/^\s*SELECT[\s\S]*FROM\s+signals/i.test(sql)) return [[], []];
  if (/system_config/.test(sql)) return [[], []];
  if (/FROM strategies/.test(sql)) throw new Error('이 경로의 매수는 귀속 전략이 없어(null) 조회까지 가지 않는다 — 조회되면 안 된다');
  return [{ affectedRows: 1 }, []];
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const m of ['log', 'warn', 'error'] as const) jest.spyOn(console, m).mockImplementation(() => {});
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-19T00:00:00Z'));
  calls = []; tradeLogsThrow = false; insertSeq = 500;
  const conn = {
    query: jest.fn(async (s: unknown, p?: unknown[]) => handle('conn', s, p)),
    beginTransaction: jest.fn(async () => undefined), commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined), release: jest.fn(), destroy: jest.fn(),
  };
  getConnection = jest.fn(async () => conn);
  (getPool as jest.Mock).mockReturnValue({ query: jest.fn(async (s: unknown, p?: unknown[]) => handle('pool', s, p)), getConnection });
});
afterEach(() => jest.restoreAllMocks());

const SCENARIO = { grade: 'B+', why_now: 'RSI 42', entry: { trigger: '눌림목', price_zone: '68600~69300' }, exit: { holding_deadline: '2026-10-26' }, risk_factors: [] };
/** `/recommend/build` 직접 작성(원 카드 없음) */
const direct = (over: Record<string, unknown> = {}) => ({
  market: 'domestic', symbol: '005930', direction: 'buy', scenario: SCENARIO, currentPrice: 70000,
  manualSlices: [{ zoneLo: 68600, zoneHi: 69300, qty: 3 }], splits: 1, ...over,
});
/** ScenarioDetail 카드 승인(원 카드 sourceSignalId) */
const viaCard = (over: Record<string, unknown> = {}) => direct({ splits: 2, sourceSignalId: 41,
  manualSlices: [{ zoneLo: 68600, zoneHi: 69300, qty: 3 }, { zoneLo: 69400, zoneHi: 70000, qty: 2 }], ...over });
const post = (body: unknown) => POST(new Request('http://x/api/signals/custom/confirm', { method: 'POST', body: JSON.stringify(body) }));

const signalWrites = () => calls.filter((c) => /^\s*(INSERT INTO signals|UPDATE signals)/i.test(c.sql));
const gateLogs = () => calls.filter((c) => /INSERT INTO trade_logs/.test(c.sql) && c.params[1] === 'signal_validation_gate');

describe('1. 🔴 매수 확정 — GET_LOCK 전에 거절, 행·선점·락·가상 체결 0', () => {
  test.each([
    ['직접 작성(원 카드 없음)', direct(), null],
    ['원 카드 승인(sourceSignalId 41)', viaCard(), 41],
  ])('%s → 403 · 한국어 문구 · errorCode validation_gate', async (_n, body, sourceId) => {
    const res = await post(body);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: VALIDATION_GATE_USER_MESSAGE.validation_gate, errorCode: 'validation_gate' });
    expect(getConnection).not.toHaveBeenCalled();                        // 🔴 전용 연결·락·트랜잭션 0
    expect(calls.some((c) => /GET_LOCK/.test(c.sql))).toBe(false);
    expect(signalWrites()).toEqual([]);                                  // 🔴 signals INSERT 0 · 원 카드 선점(UPDATE) 0
    expect(calls.some((c) => /paper_fills/.test(c.sql))).toBe(false);    // 가상 체결 없음(범위 단순화)
    expect(calls.some((c) => /FROM strategies/.test(c.sql))).toBe(false); // 귀속 null → 조회 없이 null_strategy
    expect(evaluateValidationGate).toHaveBeenCalledWith({ side: 'buy', strategyId: null });
    const logs = gateLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].params[0]).toBeNull();
    expect(JSON.parse(String(logs[0].params[2]))).toEqual({
      where: 'custom-confirm', signalId: sourceId, strategyId: null, symbol: '005930', side: 'buy', reason: 'null_strategy',
    });
  });

  test('응답 문구는 기계 문자열이 아니다(코드는 괄호·errorCode 로만)', async () => {
    const body = await (await post(direct())).json() as { error: string };
    expect(body.error).toBe('검증되지 않은 전략이라 매수할 수 없습니다 (validation_gate)');
    expect(body.error).not.toMatch(/null_strategy|등록되지 않은/);
  });

  test('trade_logs 기록이 실패해도 거절은 그대로(403), 던지지 않음', async () => {
    tradeLogsThrow = true;
    const res = await post(direct());
    expect(res.status).toBe(403);
    expect(signalWrites()).toEqual([]);
    expect(getConnection).not.toHaveBeenCalled();
  });

  test('수치·shape 가드(T-029)는 관문보다 먼저 — 잘못된 본문은 여전히 400, 관문 호출 0', async () => {
    const res = await post(direct({ manualSlices: [{ zoneLo: '100', zoneHi: '200', qty: 3 }] }));
    expect(res.status).toBe(400);
    expect(evaluateValidationGate).not.toHaveBeenCalled();
  });
});

describe('2. 🔴 매도 확정 — 관문이 조회 없이 통과시킨다 (보호 청산)', () => {
  test.each([
    ['직접 작성 매도', direct({ direction: 'sell', manualSlices: [{ zoneLo: 70000, zoneHi: 70500, qty: 3 }] }), 'sell'],
    ['원 카드 매도', viaCard({ direction: 'sell' }), 'sell'],
    ["대문자 'SELL'", direct({ direction: 'SELL', manualSlices: [{ zoneLo: 70000, zoneHi: 70500, qty: 3 }] }), 'SELL'],
    ["공백 ' sell '", direct({ direction: ' sell ', manualSlices: [{ zoneLo: 70000, zoneHi: 70500, qty: 3 }] }), ' sell '],
  ])('%s → 정규화된 sell · 관문 not_applicable · strategies 조회 0 · 기존대로 락 → INSERT → 200', async (_n, body, rawDir) => {
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(typeof rawDir).toBe('string');
    // WP-2c — 판정은 관문 함수가 한다(라우트 지역 분기 없음). 매도는 I/O 0 으로 not_applicable
    // WP-2d — 라우트 입구가 direction 을 정규화한다: 하류(관문·INSERT·락)에는 원문('SELL'·' sell ')이 아니라 정확히 'sell'
    const dir = 'sell';
    expect(evaluateValidationGate).toHaveBeenCalledTimes(1);
    expect(evaluateValidationGate).toHaveBeenCalledWith({ side: dir, strategyId: null });
    // 활성 구간 중복 검사도 정규화된 방향으로 조회한다(원문이 섞이면 같은 시나리오가 다른 키로 보인다)
    expect(calls.filter((c) => /scenario_source = 'user'/.test(c.sql)).map((c) => c.params[1])).toEqual(['sell']);
    await expect((evaluateValidationGate as jest.Mock).mock.results[0].value).resolves.toEqual({ allowed: true, kind: 'not_applicable' });
    expect(calls.some((c) => /FROM strategies/.test(c.sql))).toBe(false);
    expect(getConnection).toHaveBeenCalledTimes(1);
    const ins = calls.filter((c) => /INSERT INTO signals/.test(c.sql));
    expect(ins.length).toBeGreaterThan(0);
    expect(ins.every((c) => c.params[0] === null && c.params[2] === dir)).toBe(true);   // strategy_id = 같은 귀속(null) 그대로
    expect(gateLogs()).toHaveLength(0);
  });
});

describe('3. 🔴 WP-2c R-1 — 변형된 매수(direction 대소문자·공백·알 수 없는 값)도 매수로 판정해 403', () => {
  test.each([['BUY'], ['Buy'], ['buy '], [' BUY']])('direction=%p → (정규화 후 buy) 403 · 행 0 · 연결·락 0', async (dir) => {
    const res = await post(direct({ direction: dir }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: VALIDATION_GATE_USER_MESSAGE.validation_gate, errorCode: 'validation_gate' });
    expect(getConnection).not.toHaveBeenCalled();
    expect(signalWrites()).toEqual([]);
    expect(calls.some((c) => /GET_LOCK/.test(c.sql))).toBe(false);
    expect(JSON.parse(String(gateLogs()[0].params[2]))).toMatchObject({ where: 'custom-confirm', side: 'buy', reason: 'null_strategy' });
  });
});

describe('4. 🔴 WP-2d — direction 이 buy/sell 이 아니면 400 + 한국어 (관문·DB 0)', () => {
  test.each([['purchase'], ['sel'], ['   '], [123], [['buy']], [{}]])('direction=%p → 400', async (dir) => {
    const res = await post(direct({ direction: dir }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: '주문 방향은 buy 또는 sell 이어야 합니다 (대소문자·앞뒤 공백은 허용)' });
    expect(evaluateValidationGate).not.toHaveBeenCalled();
    expect(getConnection).not.toHaveBeenCalled();
    expect(calls).toEqual([]);                                   // DB 0 — trade_logs 도 없다(입력 오류)
  });
  test("direction 빈 문자열은 기존 required 문구(400) 그대로", async () => {
    const res = await post(direct({ direction: '' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('symbol/direction/scenario required');
  });
});
