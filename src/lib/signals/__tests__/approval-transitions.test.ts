/**
 * T-042 — 승인·거절 상태 전이와 승인 경로 선택.
 *
 * 지키려는 계약:
 *  1. 전이는 **한 문장의 조건부 UPDATE** 다 — 상태 집합·만료 조건이 SQL 에 들어 있어야 한다.
 *  2. 같은 시그널을 두 쪽이 동시에 선점하면 **한 쪽만** 이긴다(이중 주문 방지).
 *  3. 구간 없는 룰 시그널을 진입 감시(`approved_pending_entry`)로 보내지 않는다 — 감시가 `no_zone` 으로
 *     건너뛰어 주문이 영원히 안 나간다.
 */
import {
  claimAwaitingSignal,
  extractEntryZone,
  readHybridModeEnabled,
  rejectAwaitingSignal,
  releaseClaim,
  resolveApprovalPath,
  type SqlRunner,
} from '../approval-transitions';

// ── 가짜 풀: 아주 작은 인메모리 signals 테이블 ───────────────────────────────

interface Row { id: number; status: string; expires_at: Date | null }

function makePool(rows: Row[]) {
  const sqls: string[] = [];
  const pool: SqlRunner = {
    async query(sql: string, params: unknown[] = []) {
      sqls.push(sql);
      const compact = sql.replace(/\s+/g, ' ');

      // 전이 UPDATE — SQL 에 적힌 조건을 실제로 평가한다 (조건이 빠지면 이 가짜는 덮어쓴다)
      let m = /UPDATE signals SET (?:indicators=\?, )?status='(executing|approved_pending_entry)'.* WHERE id=\? AND status IN \(([^)]*)\)( AND \(expires_at IS NULL OR expires_at > NOW\(\)\))?/.exec(compact);
      if (m) {
        const id = Number(params[params.length - 1]);
        const allowed = m[2].split(',').map((x) => x.trim().replace(/'/g, ''));
        const row = rows.find((r) => r.id === id);
        const notExpired = !m[3] || !row?.expires_at || row.expires_at.getTime() > Date.now();
        if (row && allowed.includes(row.status) && notExpired) { row.status = m[1]; return [{ affectedRows: 1 }]; }
        return [{ affectedRows: 0 }];
      }
      m = /UPDATE signals SET status='(expired|rejected)'.* WHERE id=\? AND status IN \(([^)]*)\)/.exec(compact);
      if (m) {
        const id = Number(params[0]);
        const allowed = m[2].split(',').map((x) => x.trim().replace(/'/g, ''));
        const row = rows.find((r) => r.id === id);
        if (row && allowed.includes(row.status)) { row.status = m[1]; return [{ affectedRows: 1 }]; }
        return [{ affectedRows: 0 }];
      }
      m = /UPDATE signals SET status=\?, updated_at=NOW\(\) WHERE id=\? AND status='executing'/.exec(compact);
      if (m) {
        const row = rows.find((r) => r.id === Number(params[1]));
        if (row && row.status === 'executing') { row.status = String(params[0]); return [{ affectedRows: 1 }]; }
        return [{ affectedRows: 0 }];
      }
      m = /SELECT status(?:, expires_at)? FROM signals WHERE id=\? LIMIT 1/.exec(compact);
      if (m) {
        const row = rows.find((r) => r.id === Number(params[0]));
        return [row ? [{ status: row.status, expires_at: row.expires_at }] : []];
      }
      throw new Error(`unexpected SQL: ${compact}`);
    },
  };
  return { pool, sqls, rows };
}

const FUTURE = () => new Date(Date.now() + 10 * 60_000);
const PAST = () => new Date(Date.now() - 10 * 60_000);

// ── 진입 구간 판정 ───────────────────────────────────────────────────────────

describe('extractEntryZone — entry-watcher 와 같은 규칙', () => {
  const withZone = (pz: unknown) => ({ ai: { scenario: { entry: { price_zone: pz } } } });

  test('객체·JSON 문자열 모두 읽는다', () => {
    expect(extractEntryZone(withZone('70810~71540'))).toEqual([70810, 71540]);
    expect(extractEntryZone(JSON.stringify(withZone('1.5~2.5')))).toEqual([1.5, 2.5]);
  });

  test('🔴 룰 시그널(RSI 과매도 등)에는 구간이 없다', () => {
    expect(extractEntryZone({ rsi14: 37.5, ma20: 282650, price: 255500, reversalNote: '저점 상승' })).toBeNull();
    expect(extractEntryZone({ ai: { summary: 'x' } })).toBeNull();
    expect(extractEntryZone({ ai: { scenario: { entry: {} } } })).toBeNull();
  });

  test('깨진 값은 전부 null — 예외를 던지지 않는다', () => {
    for (const bad of [null, undefined, 42, 'not json', '{"ai":', [], withZone(123), withZone('abc'), withZone('1~'), withZone('0~5'), withZone('-3~5'), withZone('1~2~3')]) {
      expect(extractEntryZone(bad)).toBeNull();
    }
  });
});

describe('resolveApprovalPath — 승인하면 무엇이 일어나는가', () => {
  const ruleSignal = { rsi14: 30 };
  const cardSignal = { ai: { scenario: { entry: { price_zone: '100~110' } } } };

  test.each([
    // hybrid, indicators, edited, 기대
    [false, ruleSignal, false, 'immediate'],
    [false, cardSignal, false, 'immediate'],     // 하이브리드가 꺼져 있으면 구간이 있어도 기존대로 즉시
    [true,  cardSignal, false, 'hybrid'],        // 구간이 있으면 감시
    [true,  ruleSignal, false, 'immediate'],     // 🔴 구간이 없으면 감시로 보내지 않는다(막다른 길)
    [true,  ruleSignal, true,  'hybrid'],        // 사용자가 구간을 직접 고쳐 보냈다 → 그 구간으로 감시
    [true,  null,       false, 'immediate'],
  ] as const)('hybrid=%s indicators=%j edited=%s → %s', (hybridEnabled, indicators, hasEditedScenario, expected) => {
    expect(resolveApprovalPath({ hybridEnabled, indicators, hasEditedScenario })).toBe(expected);
  });
});

// ── 선점 ─────────────────────────────────────────────────────────────────────

describe('claimAwaitingSignal — 원자적 선점', () => {
  test('승인 대기이고 만료 전이면 선점한다', async () => {
    const { pool, rows } = makePool([{ id: 1, status: 'awaiting_approval', expires_at: FUTURE() }]);
    expect(await claimAwaitingSignal(pool, 1, 'executing')).toEqual({ ok: true });
    expect(rows[0].status).toBe('executing');
  });

  test('구 상태 pending / pending_approval 도 선점 대상', async () => {
    for (const status of ['pending', 'pending_approval']) {
      const { pool } = makePool([{ id: 1, status, expires_at: null }]);
      expect(await claimAwaitingSignal(pool, 1, 'approved_pending_entry')).toEqual({ ok: true });
    }
  });

  test('🔴 SQL 에 상태 집합과 만료 조건이 들어 있다 (확인과 갱신을 한 문장으로)', async () => {
    const { pool, sqls } = makePool([{ id: 1, status: 'awaiting_approval', expires_at: FUTURE() }]);
    await claimAwaitingSignal(pool, 1, 'executing');
    const update = sqls.find((q) => /UPDATE signals/.test(q))!.replace(/\s+/g, ' ');
    expect(update).toMatch(/WHERE id=\? AND status IN \('pending','awaiting_approval','pending_approval'\)|WHERE id=\? AND status IN \(/);
    expect(update).toMatch(/AND \(expires_at IS NULL OR expires_at > NOW\(\)\)/);
    expect(update).not.toMatch(/'detected'/);        // 선점(승인)은 detected 를 포함하지 않는다 — 주문 경로가 없는 상태
  });

  test.each(['approved', 'rejected', 'expired', 'executing', 'approved_pending_entry', 'detected', 'auto_submitted'])(
    '🔴 이미 %s 인 시그널은 덮어쓰지 않는다',
    async (status) => {
      const { pool, rows } = makePool([{ id: 1, status, expires_at: FUTURE() }]);
      expect(await claimAwaitingSignal(pool, 1, 'executing')).toEqual({ ok: false, error: `invalid_status:${status}` });
      expect(rows[0].status).toBe(status);
    },
  );

  test('없는 시그널 → not_found', async () => {
    const { pool } = makePool([]);
    expect(await claimAwaitingSignal(pool, 9, 'executing')).toEqual({ ok: false, error: 'not_found' });
  });

  test('🔴 만료된 대기 시그널은 선점하지 못하고 expired 로 정리된다', async () => {
    const { pool, rows } = makePool([{ id: 1, status: 'awaiting_approval', expires_at: PAST() }]);
    expect(await claimAwaitingSignal(pool, 1, 'executing')).toEqual({ ok: false, error: 'signal_expired' });
    expect(rows[0].status).toBe('expired');
  });

  test('🔴 동시에 둘이 선점하면 정확히 한 쪽만 이긴다 (웹 + 텔레그램 이중 승인)', async () => {
    const { pool, rows } = makePool([{ id: 7, status: 'awaiting_approval', expires_at: FUTURE() }]);
    const results = await Promise.all([
      claimAwaitingSignal(pool, 7, 'executing'),
      claimAwaitingSignal(pool, 7, 'executing'),
      claimAwaitingSignal(pool, 7, 'approved_pending_entry'),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && /^invalid_status:/.test(r.error))).toBe(true);
    expect(['executing', 'approved_pending_entry']).toContain(rows[0].status);
  });

  test('indicators 병합과 상태 전이가 같은 문장이다 (구간 수정 + 승인)', async () => {
    const { pool, sqls } = makePool([{ id: 1, status: 'awaiting_approval', expires_at: FUTURE() }]);
    expect(await claimAwaitingSignal(pool, 1, 'approved_pending_entry', { indicatorsJson: '{"ai":{}}' })).toEqual({ ok: true });
    const updates = sqls.filter((q) => /UPDATE signals/.test(q));
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatch(/indicators=\?/);
  });

  test('🔴 indicators 병합 변형도 만료·상태 조건을 SQL 에 갖는다 — 만료된 카드를 구간 수정으로 되살리지 못한다', async () => {
    const { pool, sqls, rows } = makePool([{ id: 1, status: 'awaiting_approval', expires_at: PAST() }]);
    expect(await claimAwaitingSignal(pool, 1, 'approved_pending_entry', { indicatorsJson: '{"ai":{}}' })).toEqual({ ok: false, error: 'signal_expired' });
    const update = sqls.find((q) => /UPDATE signals SET indicators=\?/.test(q))!.replace(/\s+/g, ' ');
    expect(update).toMatch(/AND status IN \(/);
    expect(update).toMatch(/AND \(expires_at IS NULL OR expires_at > NOW\(\)\)/);
    expect(rows[0].status).toBe('expired');                 // 되살아나지 않고 만료로 정리됐다
  });

  test('indicators 병합 변형: 이미 승인·거절된 행은 덮어쓰지 않고 indicators 도 바꾸지 않는다', async () => {
    const { pool, rows } = makePool([{ id: 1, status: 'rejected', expires_at: FUTURE() }]);
    expect(await claimAwaitingSignal(pool, 1, 'approved_pending_entry', { indicatorsJson: '{"x":1}' })).toEqual({ ok: false, error: 'invalid_status:rejected' });
    expect(rows[0].status).toBe('rejected');
  });

  test('affectedRows 가 없거나 0 이면 성공으로 보지 않는다 (fail-closed)', async () => {
    const weird: SqlRunner = {
      async query(sql: string) {
        if (/UPDATE signals/.test(sql)) return [{}];                 // affectedRows 누락
        return [[{ status: 'awaiting_approval', expires_at: new Date(Date.now() + 60_000) }]];
      },
    };
    expect(await claimAwaitingSignal(weird, 1, 'executing')).toEqual({ ok: false, error: 'transition_conflict' });
  });
});

describe('releaseClaim — 선점 복귀', () => {
  test('executing 인 행만 원래 상태로 되돌린다', async () => {
    const { pool, rows } = makePool([{ id: 1, status: 'executing', expires_at: FUTURE() }]);
    await releaseClaim(pool, 1, 'pending');
    expect(rows[0].status).toBe('pending');
  });

  test('🔴 그 사이 다른 상태로 바뀐 행은 건드리지 않는다', async () => {
    const { pool, rows } = makePool([{ id: 1, status: 'expired', expires_at: PAST() }]);
    await releaseClaim(pool, 1, 'pending');
    expect(rows[0].status).toBe('expired');
  });

  test('복귀 대상이 대기 상태 어휘가 아니면 awaiting_approval 로 (이상한 값을 DB 에 쓰지 않는다)', async () => {
    const { pool, rows } = makePool([{ id: 1, status: 'executing', expires_at: null }]);
    await releaseClaim(pool, 1, 'approved');
    expect(rows[0].status).toBe('awaiting_approval');
  });
});

// ── 거절 ─────────────────────────────────────────────────────────────────────

describe('rejectAwaitingSignal — 원자적 거절', () => {
  test.each(['awaiting_approval', 'pending', 'pending_approval', 'detected'])('%s 는 거절된다', async (status) => {
    const { pool, rows } = makePool([{ id: 1, status, expires_at: FUTURE() }]);
    expect(await rejectAwaitingSignal(pool, 1)).toEqual({ ok: true });
    expect(rows[0].status).toBe('rejected');
  });

  test('만료 시각이 지났어도 아직 대기 상태면 거절로 정리할 수 있다', async () => {
    const { pool } = makePool([{ id: 1, status: 'awaiting_approval', expires_at: PAST() }]);
    expect(await rejectAwaitingSignal(pool, 1)).toEqual({ ok: true });
  });

  test.each(['approved', 'executing', 'expired', 'approved_pending_entry'])('🔴 이미 %s 이면 덮어쓰지 않는다', async (status) => {
    const { pool, rows } = makePool([{ id: 1, status, expires_at: FUTURE() }]);
    expect(await rejectAwaitingSignal(pool, 1)).toEqual({ ok: false, error: `invalid_status:${status}` });
    expect(rows[0].status).toBe(status);
  });

  test('없는 시그널 → not_found', async () => {
    const { pool } = makePool([]);
    expect(await rejectAwaitingSignal(pool, 3)).toEqual({ ok: false, error: 'not_found' });
  });

  test('🔴 승인과 거절이 동시에 오면 한 쪽만 이긴다', async () => {
    const { pool, rows } = makePool([{ id: 5, status: 'awaiting_approval', expires_at: FUTURE() }]);
    const [a, r] = await Promise.all([claimAwaitingSignal(pool, 5, 'executing'), rejectAwaitingSignal(pool, 5)]);
    expect([a.ok, r.ok].filter(Boolean)).toHaveLength(1);
    expect(['executing', 'rejected']).toContain(rows[0].status);
  });
});

// ── 하이브리드 판정: 웹 라우트와 텔레그램 처리기가 쓰는 단일 규칙 ─────────────────────────────────────────
describe('readHybridModeEnabled — DB 행이 이기고, 없을 때만 env', () => {
  const origEnv = process.env.HYBRID_MODE_ENABLED;
  afterEach(() => { if (origEnv === undefined) delete process.env.HYBRID_MODE_ENABLED; else process.env.HYBRID_MODE_ENABLED = origEnv; });
  const pool = (rows: unknown[] | 'throw'): SqlRunner => ({
    async query() { if (rows === 'throw') throw new Error('db down'); return [rows, []]; },
  });

  test('DB 행이 true 면 true', async () => {
    delete process.env.HYBRID_MODE_ENABLED;
    expect(await readHybridModeEnabled(pool([{ value: 'true' }]))).toBe(true);
  });

  test('🔴 DB 행이 false 면 env 가 true 여도 false — DB 가 이긴다 (웹 라우트의 기존 규칙, getRouterConfig 와 달랐던 부분)', async () => {
    process.env.HYBRID_MODE_ENABLED = 'true';
    expect(await readHybridModeEnabled(pool([{ value: 'false' }]))).toBe(false);
  });

  test('DB 행이 없으면 env 로 폴백 (true / false / 미설정)', async () => {
    process.env.HYBRID_MODE_ENABLED = 'TRUE';
    expect(await readHybridModeEnabled(pool([]))).toBe(true);
    process.env.HYBRID_MODE_ENABLED = 'false';
    expect(await readHybridModeEnabled(pool([]))).toBe(false);
    delete process.env.HYBRID_MODE_ENABLED;
    expect(await readHybridModeEnabled(pool([]))).toBe(false);
  });

  test('DB 를 읽다 실패하면 env 로 폴백한다 (예외를 던지지 않는다)', async () => {
    process.env.HYBRID_MODE_ENABLED = 'true';
    expect(await readHybridModeEnabled(pool('throw'))).toBe(true);
    delete process.env.HYBRID_MODE_ENABLED;
    expect(await readHybridModeEnabled(pool('throw'))).toBe(false);
  });

  test('값이 깨진 JSON 이어도 던지지 않고 env 폴백', async () => {
    delete process.env.HYBRID_MODE_ENABLED;
    expect(await readHybridModeEnabled(pool([{ value: '{not json' }]))).toBe(false);
  });

  test('"true" 문자열(JSON 문자열)은 참이 아니다 — 엄격한 불리언만', async () => {
    delete process.env.HYBRID_MODE_ENABLED;
    expect(await readHybridModeEnabled(pool([{ value: JSON.stringify('true') }]))).toBe(false);
    expect(await readHybridModeEnabled(pool([{ value: '1' }]))).toBe(false);
  });
});
