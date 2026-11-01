/**
 * T-108 안전 상태 — 판독기 ↔ DB 행 대조 (Reviewer R-DATA Major-3).
 * 판독기는 DB 오류 때 env 로 떨어진다(KILL_SWITCH 미설정 = OFF). 같은 요청의 system_config 행과 다르거나 그 행을 못 읽으면 null → 단계 unknown.
 */
jest.mock('@/lib/db', () => ({ getPool: jest.fn(), ping: jest.fn(async () => true) }));

import { getPool } from '@/lib/db';
import { createReader } from '../read-only';
import { createSafetyReader, crossCheck, readSafetyState, SAFETY_CFG_SQL, SAFETY_LANE_ALLOWED_SQL, STRATEGIES_SQL, type SafetyStateDeps } from '../safety-state';
import { fakeReader, kst, type Route } from './fake-reader';

const NOW = kst('2026-10-30 22:00');
const STRATS: Route = ['FROM strategies', [{ validation_status: 'unvalidated', enabled: 1, n: 3 }, { validation_status: 'unvalidated', enabled: 0, n: 13 }]];

function deps(over: Partial<{ dry: boolean; kill: boolean; cfg: unknown[] | Error; ping: boolean }> = {}): SafetyStateDeps {
  const cfg = over.cfg ?? [{ key: 'safety_dry_run', value: 'true' }, { key: 'safety_kill_switch', value: 'false', updated_at: new Date(kst('2026-10-30 09:08')) }];
  return {
    ping: async () => over.ping ?? true,
    isDryRun: async () => over.dry ?? true,
    isKillSwitchActive: async () => over.kill ?? false,
    readExitEngineSwitch: async () => ({ enabled: true, hardStopEnabled: false, source: 'config', raw: null, error: null }),
    reader: () => fakeReader(NOW, [STRATS, ['FROM system_config', cfg as unknown[] | Error]]),
  };
}

describe('crossCheck', () => {
  it('키 없음 → 판독기 값(env 해석) 그대로', () => {
    expect(crossCheck(false, undefined)).toBe(false);
  });
  it('해석됨·같음 → 값, 다름 → mismatch', () => {
    expect(crossCheck(false, { value: 'false' })).toBe(false);
    expect(crossCheck(false, { value: 'true' })).toBe('mismatch');
    expect(crossCheck(true, { value: '"on"' })).toBe(true);
  });
  it('해석 불가 → 판독기는 안전 쪽(true)이어야 일치', () => {
    expect(crossCheck(true, { value: '"maybe"' })).toBe(true);
    expect(crossCheck(false, { value: '"maybe"' })).toBe('mismatch');
  });
  it('판독기 자체 실패 → read_error', () => {
    expect(crossCheck(null, { value: 'true' })).toBe('read_error');
  });
  // T-142 — 비 JSON 원문 값. 예전에는 `JSON.parse` 가 던져 그 자체를 mismatch 로 봤는데(판독기가
  // env 폴백으로 흘렸으니 실제로 어긋나 있었다), 이제 두 쪽이 같은 헬퍼로 날 값을 함께 해석한다.
  it('T-142 비 JSON 원문 값도 판독기와 같게 해석한다', () => {
    expect(crossCheck(true, { value: 'yes' })).toBe(true);
    expect(crossCheck(false, { value: 'no' })).toBe(false);
    expect(crossCheck(false, { value: 'yes' })).toBe('mismatch');   // 판독기가 틀린 쪽이면 여전히 잡는다
  });
  // T-142 감사 R-3 — 생존 변이 2종(decode 를 지우기 / 키 없음 행을 항상 활성으로)을 사살한다.
  // 정상 JSON falsy·null·빈칸은 비 JSON 처리와 섞이지 않아야 한다.
  it('T-142 정상 JSON falsy·null·빈칸 (감사 R-3)', () => {
    expect(crossCheck(false, { value: '"off"' })).toBe(false);
    expect(crossCheck(false, { value: 'null' })).toBe(false);   // unset → 판독기 값 그대로
    expect(crossCheck(true, { value: '' })).toBe(true);         // 빈칸도 unset → 판독기 값 그대로
  });
  it('T-142 해석 못 하는 비 JSON 은 양쪽이 활성으로 수렴한다', () => {
    expect(crossCheck(true, { value: '뭔가이상한값' })).toBe(true);
    expect(crossCheck(false, { value: '뭔가이상한값' })).toBe('mismatch');
  });
});

describe('readSafetyState', () => {
  it('정상 — 관찰 단계, 값·부가 시각', async () => {
    const s = await readSafetyState(NOW, deps());
    expect(s).toMatchObject({
      stage: 'observe', liveTrading: false, killSwitch: false, errors: [],
      strategies: { total: 16, enabled: 3, validated: 0, validatedEnabled: 0 }, killSwitchSince: '2026-10-30T09:08:00+09:00',
    });
  });
  it('🔴 DB 순단 — 판독기가 env 로 떨어져 「차단 OFF」를 줘도 DB 행(ON)과 다르면 unknown', async () => {
    const s = await readSafetyState(NOW, deps({ kill: false, cfg: [{ key: 'safety_dry_run', value: 'true' }, { key: 'safety_kill_switch', value: 'true' }] }));
    expect(s.killSwitch).toBeNull();
    expect(s.errors).toContain('kill_switch_mismatch');
    expect(s.stage).toBe('unknown');
  });
  it('🔴 같은 요청의 DB 행을 못 읽으면 실거래여부·모든거래차단 둘 다 모름 → unknown', async () => {
    const s = await readSafetyState(NOW, deps({ cfg: new Error('lost connection') }));
    expect(s).toMatchObject({ liveTrading: null, killSwitch: null, notifyAutoSubmit: null, stage: 'unknown' });
    expect(s.errors).toEqual(expect.arrayContaining(['dry_run_read_error', 'kill_switch_read_error', 'notify_read_error']));
  });
  it('실거래여부 불일치도 unknown(dry_run_mismatch)', async () => {
    const s = await readSafetyState(NOW, deps({ dry: true, cfg: [{ key: 'safety_dry_run', value: 'false' }] }));
    expect(s.liveTrading).toBeNull();
    expect(s.errors).toContain('dry_run_mismatch');
  });
  it('ping 실패 → db_unreachable, 전부 null', async () => {
    const s = await readSafetyState(NOW, deps({ ping: false }));
    expect(s).toMatchObject({ stage: 'unknown', liveTrading: null, killSwitch: null, errors: ['db_unreachable'] });
  });
});

describe('🔴 안전 판독 예약 레인 — 홈 질의가 전역 관문을 채워도 안전 띠가 그 뒤에 줄 서지 않는다(R-DATA 새 관문 Major)', () => {
  const L = 100;
  const slowPool = (rows: (sql: string) => unknown[]) => ({
    query: jest.fn((sql: string) => new Promise((res) => setTimeout(() => res([rows(sql), []]), L))),
  });
  function stubDeps(reader: () => import('../read-only').OpsReader): SafetyStateDeps {
    return {
      ping: async () => true, isDryRun: async () => true, isKillSwitchActive: async () => false,
      readExitEngineSwitch: async () => ({ enabled: true, hardStopEnabled: false, source: 'config', raw: null, error: null }),
      reader,
    };
  }
  const safetyRows = (sql: string) => (sql.includes('FROM strategies') ? [{ validation_status: 'unvalidated', enabled: 1, n: 16 }]
    : [{ key: 'safety_dry_run', value: 'true' }, { key: 'safety_kill_switch', value: 'false' }]);

  // 실제 판독기(isDryRun·isKillSwitchActive·readExitEngineSwitch — 풀 직접)와 기본 reader(예약 레인)를 그대로 쓴다. ping 만 목.
  const routedPool = () => slowPool((sql) => {
    if (sql.includes('FROM strategies')) return [{ validation_status: 'unvalidated', enabled: 1, n: 16 }];
    if (sql.includes("'safety_dry_run')") || sql.includes('notify_signal_auto_submit')) return [{ key: 'safety_dry_run', value: 'true' }, { key: 'safety_kill_switch', value: 'false' }];
    if (sql.includes('IN (?, ?)')) return [{ key: 'exit_engine_enabled', value: 'true' }];
    return [];
  });
  it.each([1, 2])('홈 %i개(질의 45개씩) 진행 중에 도착한 안전 판독이 홈 뒤에 줄 서지 않는다(지연 × 1.8 안, timeout 없음)', async (homes) => {
    const pool = routedPool();
    const params: unknown[][] = [];
    pool.query.mockImplementation((sql: string, p?: unknown[]) => {
      params.push(p ?? []);
      const key = (p ?? [])[0];
      const rows = sql.includes('LIMIT 1') && key === 'safety_dry_run' ? [{ value: 'true' }]
        : sql.includes('LIMIT 1') && key === 'safety_kill_switch' ? [{ value: 'false' }]
        : sql.includes('FROM strategies') ? [{ validation_status: 'unvalidated', enabled: 1, n: 16 }]
        : sql.includes('notify_signal_auto_submit') ? [{ key: 'safety_dry_run', value: 'true' }, { key: 'safety_kill_switch', value: 'false' }]
        : sql.includes('IN (?, ?)') ? [{ key: 'exit_engine_enabled', value: 'true' }]
        : [];
      return new Promise((res) => setTimeout(() => res([rows, []]), L));
    });
    (getPool as jest.Mock).mockReturnValue(pool);
    const homePool = slowPool(() => []);
    // 홈 reader 는 기본 전역 관문(OPS_GLOBAL_GATE)을 쓴다
    const homeQ = Array.from({ length: homes }, () => createReader({ pool: homePool, budgetMs: 30_000 }))
      .flatMap((h) => Array.from({ length: 45 }, () => h.rows('SELECT 1')));
    await new Promise((res) => setTimeout(res, 5));
    const t0 = Date.now();
    const s = await readSafetyState(NOW);   // 기본 deps — 예약 레인
    const took = Date.now() - t0;
    expect(s.errors).toEqual([]);
    expect(s.stage).toBe('observe');
    expect(took).toBeLessThan(L * 1.8);
    await Promise.all(homeQ);
  }, 30_000);

  it('안전 레인 reader 는 안전 판독 두 문장만 보낸다(홈 질의에 쓰일 수 없다)', async () => {
    (getPool as jest.Mock).mockReturnValue({ query: jest.fn(async () => [[], []]) });
    const r = createSafetyReader();
    await expect(r.rows(STRATEGIES_SQL)).resolves.toEqual([]);
    await expect(r.rows(SAFETY_CFG_SQL)).resolves.toEqual([]);
    await expect(r.rows('SELECT COUNT(*) AS n FROM signals')).rejects.toMatchObject({ code: 'not_select' });
  });

  // T-128 A3(b) — 예약 레인 허용 문장 목록을 원문 그대로 고정한다(문장을 더하거나 바꾸면 여기서 깨진다).
  it('안전 레인 허용 SQL = 두 문장 원문 그대로(정확 일치), 바꿀 수 없다', () => {
    expect(SAFETY_LANE_ALLOWED_SQL).toEqual([
      'SELECT validation_status, enabled, COUNT(*) AS n FROM strategies GROUP BY validation_status, enabled',
      "SELECT `key`, value, updated_at FROM system_config WHERE `key` IN ('notify_signal_auto_submit', 'safety_kill_switch', 'safety_dry_run')",
    ]);
    expect(Object.isFrozen(SAFETY_LANE_ALLOWED_SQL)).toBe(true);
  });

  it('안전 레인 reader 는 허용 목록의 문장만 보낸다 — 목록의 각 문장은 통과, 한 글자 다른 문장은 보내기 전에 거부', async () => {
    const query = jest.fn(async () => [[], []]);
    (getPool as jest.Mock).mockReturnValue({ query });
    const r = createSafetyReader();
    for (const sql of SAFETY_LANE_ALLOWED_SQL) await expect(r.rows(sql)).resolves.toEqual([]);
    expect(query).toHaveBeenCalledTimes(SAFETY_LANE_ALLOWED_SQL.length);
    await expect(r.rows(`${STRATEGIES_SQL} `)).rejects.toMatchObject({ code: 'not_select' });
    expect(query).toHaveBeenCalledTimes(SAFETY_LANE_ALLOWED_SQL.length);
  });
});
