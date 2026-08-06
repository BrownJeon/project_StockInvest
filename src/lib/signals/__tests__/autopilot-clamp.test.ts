/**
 * 자동조종 자율성 상한 회귀 테스트 (T-006 reviewer HIGH).
 *
 * ## 막으려는 사고
 * 운영 `strategy_analyst_enabled=true` 상태에서 사용자가 설정 화면의 "하이브리드" 스위치를
 * **OFF** 로 내리면, 구 매핑표(`analyst=T, hybrid=F → auto`)가 런타임에 재적용되면서
 * 파이프라인 전체가 `auto` 가 됐다. auto 에서는 `duplicate_active_signal` 검사가 생략되고
 * 후보마다 `submitOrder()` 가 호출된다. 그 스위치의 레이블은 자율성을 한 마디도 언급하지 않는다.
 *
 * ## 불변식 (이 파일이 지키는 것)
 * **`auto` 는 오직 `autopilot_mode` 를 직접 기입했을 때만 존재한다.**
 * 부팅 시드·런타임 동기화·읽기 시 구 키 추론·env 구 조합 추론 — **모든 추론 경로는 assist 상한**.
 *
 * 사양 §4-1 매핑표 자체(`legacySwitchesToMode`)는 *마이그레이션* 의미로 그대로 둔다.
 * 제약을 받는 것은 표가 아니라 **호출부**다.
 */
import { getPool } from '@/lib/db';
import {
  AUTOPILOT_MODES,
  MAX_INFERRED_AUTOPILOT_MODE,
  clampInferredMode,
  inferAutopilotModeFromLegacy,
  legacySwitchesToMode,
} from '../autopilot';
import { getEngineSwitches, syncEngineSwitchesFromLegacy } from '../router';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));

const LEGACY_COMBOS: Array<[boolean, boolean]> = [
  [false, false], [false, true], [true, false], [true, true],
];

function mockConfig(rows: Record<string, unknown>) {
  const captured: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn(async (sqlArg: unknown, paramsArg: unknown[] = []) => {
    const sql = String(sqlArg);
    captured.push({ sql, params: paramsArg ?? [] });
    if (/SELECT/i.test(sql)) {
      return [Object.entries(rows).map(([key, value]) => ({ key, value: JSON.stringify(value) }))];
    }
    return [{ affectedRows: 1 }];
  });
  (getPool as jest.Mock).mockReturnValue({ query });
  return captured;
}

beforeEach(() => jest.clearAllMocks());

describe('순수 함수 — 사양 표는 그대로, 상한은 별도', () => {
  test('legacySwitchesToMode 는 사양 §4-1 매핑을 유지한다 (마이그레이션 의미)', () => {
    expect(legacySwitchesToMode(true, false)).toBe('auto');
    expect(legacySwitchesToMode(false, false)).toBe('assist');
    expect(legacySwitchesToMode(true, true)).toBe('assist');
    expect(legacySwitchesToMode(false, true)).toBe('assist');
  });

  test('clampInferredMode 는 auto 만 끌어내리고 나머지는 보존한다', () => {
    expect(clampInferredMode('auto')).toBe('assist');
    expect(clampInferredMode('assist')).toBe('assist');
    expect(clampInferredMode('manual')).toBe('manual');   // 더 보수적인 모드는 유지
  });

  test('inferAutopilotModeFromLegacy 는 어떤 조합에서도 auto 를 만들지 않는다', () => {
    for (const [analyst, hybrid] of LEGACY_COMBOS) {
      expect(inferAutopilotModeFromLegacy(analyst, hybrid)).not.toBe('auto');
    }
  });

  test('상한 상수는 assist 다', () => {
    expect(MAX_INFERRED_AUTOPILOT_MODE).toBe('assist');
    expect(AUTOPILOT_MODES).toContain('auto');   // auto 자체는 여전히 존재하는 모드
  });
});

describe('런타임 동기화 (설정 토글 경로) — auto 로 갈 수 없다', () => {
  test.each(LEGACY_COMBOS)(
    'analyst=%s hybrid=%s → autopilot_mode 를 아예 쓰지 않는다',
    async (analyst, hybrid) => {
      const captured = mockConfig({ strategy_analyst_enabled: analyst, hybrid_mode_enabled: hybrid });
      const res = await syncEngineSwitchesFromLegacy();

      const writes = captured.filter(c => /INSERT INTO system_config/i.test(c.sql));
      const writtenKeys = writes.map(w => w.params[0]);
      // engine_enabled 만 동기화한다 (무반응 토글 버그 수정분은 유지)
      expect(writtenKeys).toEqual(['engine_enabled']);
      // autopilot_mode 는 어떤 값으로도 기록되지 않는다 — 상향도 하향도 없다
      expect(writtenKeys).not.toContain('autopilot_mode');
      expect(res?.autopilotMode).not.toBe('auto');
    },
  );

  test('🚨 회귀 재현 — 운영값(analyst=true)에서 하이브리드를 OFF 로 내려도 auto 가 되지 않는다', async () => {
    mockConfig({ strategy_analyst_enabled: true, hybrid_mode_enabled: false });
    const res = await syncEngineSwitchesFromLegacy();
    expect(res?.engineEnabled).toBe(true);      // 엔진은 켜진 채로 유지
    expect(res?.autopilotMode).toBe('assist');  // 자율성은 올라가지 않는다
  });
});

describe('읽기 경로 — 구 키 추론도 auto 로 승격되지 않는다', () => {
  test.each(LEGACY_COMBOS)(
    '구 키만 있을 때 (analyst=%s hybrid=%s) 모드는 auto 가 아니다',
    async (analyst, hybrid) => {
      mockConfig({ strategy_analyst_enabled: analyst, hybrid_mode_enabled: hybrid });
      const s = await getEngineSwitches();
      expect(s.source).toBe('legacy');
      expect(s.autopilotMode).not.toBe('auto');
    },
  );

  test('신규 키가 있어도 autopilot_mode 가 비어 있으면 구 키 추론은 상한을 지킨다', async () => {
    mockConfig({ engine_enabled: true, strategy_analyst_enabled: true, hybrid_mode_enabled: false });
    const s = await getEngineSwitches();
    expect(s.source).toBe('config');
    expect(s.autopilotMode).toBe('assist');
  });

  test('✅ 명시적으로 기입된 autopilot_mode=auto 는 존중된다 (유일한 auto 경로)', async () => {
    mockConfig({ engine_enabled: true, autopilot_mode: 'auto', strategy_analyst_enabled: true, hybrid_mode_enabled: false });
    const s = await getEngineSwitches();
    expect(s.autopilotMode).toBe('auto');
  });

  test('명시적 manual 도 존중된다', async () => {
    mockConfig({ engine_enabled: true, autopilot_mode: 'manual' });
    expect((await getEngineSwitches()).autopilotMode).toBe('manual');
  });
});

describe('env 폴백 — 구 조합 추론은 상한, 명시 지정은 존중', () => {
  const origEnv = { ...process.env };
  afterEach(() => { process.env = { ...origEnv }; });

  beforeEach(() => {
    (getPool as jest.Mock).mockReturnValue({ query: jest.fn(async () => { throw new Error('no db'); }) });
    delete process.env.ENGINE_ENABLED;
    delete process.env.ANALYST_ENABLED;
    delete process.env.AUTOPILOT_MODE;
    delete process.env.HYBRID_MODE_ENABLED;
  });

  test('ANALYST_ENABLED=true + HYBRID 미설정 → auto 가 아니라 assist', async () => {
    process.env.ANALYST_ENABLED = 'true';
    const s = await getEngineSwitches();
    expect(s.source).toBe('env');
    expect(s.engineEnabled).toBe(true);
    expect(s.autopilotMode).toBe('assist');
  });

  test('AUTOPILOT_MODE=auto 를 직접 지정하면 존중된다', async () => {
    process.env.ENGINE_ENABLED = 'true';
    process.env.AUTOPILOT_MODE = 'auto';
    expect((await getEngineSwitches()).autopilotMode).toBe('auto');
  });
});
