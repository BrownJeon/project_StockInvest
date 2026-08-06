import {
  type EngineSwitches,
  type SignalInput,
  getAutoSubmitMaxKRW,
  getEngineSwitches,
  getRouterConfig,
  isEngineEnabled,
  legacySwitchesToMode,
  routeSignal,
} from '../router';

jest.mock('@/lib/db', () => ({
  getPool: () => { throw new Error('db not available in tests'); },
}));

const baseInput: SignalInput = {
  symbol: 'KRW-BTC',
  side: 'buy',
  orderType: 'limit',
  price: 90_000_000,
  quantity: 0.0001,
  amountKRW: 9_000,
};

const sw = (
  autopilotMode: EngineSwitches['autopilotMode'],
  engineEnabled = true,
): EngineSwitches => ({ engineEnabled, autopilotMode, source: 'env' });

describe('routeSignal — ENGINE_ENABLED × AUTOPILOT_MODE 전이표 (T-003 §4-1)', () => {
  const origEnv = { ...process.env };
  afterEach(() => { process.env = { ...origEnv }; });

  test('manual → detected (주문 경로 없음)', () => {
    const r = routeSignal(baseInput, { defaultTtlMin: 30 }, sw('manual'));
    expect(r.route).toBe('pending_approval');
    expect(r.status).toBe('detected');
  });

  test('assist → awaiting_approval', () => {
    const r = routeSignal(baseInput, { defaultTtlMin: 30 }, sw('assist'));
    expect(r.route).toBe('pending_approval');
    expect(r.status).toBe('awaiting_approval');
  });

  test('auto + 금액 ≤ SIGNAL_AUTO_SUBMIT_MAX_KRW → auto_submitted', () => {
    process.env.SIGNAL_AUTO_SUBMIT_MAX_KRW = '10000';
    const r = routeSignal(baseInput, { defaultTtlMin: 30 }, sw('auto'));
    expect(r.route).toBe('auto_submit');
    expect(r.status).toBe('auto_submitted');
    expect(r.demoted).toBeUndefined();
  });

  test('auto + 금액 > 상한 → assist 로 격하 (awaiting_approval)', () => {
    process.env.SIGNAL_AUTO_SUBMIT_MAX_KRW = '5000';
    const r = routeSignal(baseInput, { defaultTtlMin: 30 }, sw('auto'));
    expect(r.route).toBe('pending_approval');
    expect(r.status).toBe('awaiting_approval');
    expect(r.demoted).toBe(true);
  });

  test('상한 미설정이면 auto 는 전부 자동 제출 (없던 제한을 새로 걸지 않는다)', () => {
    delete process.env.SIGNAL_AUTO_SUBMIT_MAX_KRW;
    expect(getAutoSubmitMaxKRW()).toBe(Number.POSITIVE_INFINITY);
    const r = routeSignal(baseInput, { defaultTtlMin: 30 }, sw('auto'));
    expect(r.status).toBe('auto_submitted');
  });

  test('hard_stop 청산은 모드 무관 자동 제출 (assist/manual 에서도)', () => {
    for (const mode of ['manual', 'assist'] as const) {
      const r = routeSignal(
        { ...baseInput, side: 'sell', indicators: { exit_kind: 'hard_stop' } },
        { defaultTtlMin: 30 },
        sw(mode),
      );
      expect(r.route).toBe('auto_submit');
      expect(r.status).toBe('auto_submitted');
      expect(r.forcedExit).toBe(true);
    }
  });

  test('eod_loss_cut 청산도 모드 무관 자동 제출', () => {
    const r = routeSignal(
      { ...baseInput, side: 'sell', indicators: { exit_kind: 'eod_loss_cut' } },
      { defaultTtlMin: 30 },
      sw('assist'),
    );
    expect(r.status).toBe('auto_submitted');
  });

  test('target_profit·trailing_stop 청산은 승인 경로를 탄다', () => {
    for (const kind of ['target_profit', 'trailing_stop']) {
      const r = routeSignal(
        { ...baseInput, side: 'sell', indicators: { exit_kind: kind } },
        { defaultTtlMin: 30 },
        sw('assist'),
      );
      expect(r.status).toBe('awaiting_approval');
    }
  });

  test('expiresAt 미지정 시 now + defaultTtlMin 적용', () => {
    const now = new Date('2026-04-19T10:00:00Z');
    const r = routeSignal(baseInput, { defaultTtlMin: 30 }, sw('assist'), now);
    expect(r.expiresAt.getTime()).toBe(now.getTime() + 30 * 60_000);
  });

  test('expiresAt(ISO 문자열) 지정 시 그대로 사용', () => {
    const target = '2026-04-20T00:00:00Z';
    const r = routeSignal({ ...baseInput, expiresAt: target }, { defaultTtlMin: 30 }, sw('assist'));
    expect(r.expiresAt.toISOString()).toBe(new Date(target).toISOString());
  });
});

describe('legacySwitchesToMode (§4-1 마이그레이션 표)', () => {
  test('analyst=F, hybrid=F → assist', () => expect(legacySwitchesToMode(false, false)).toBe('assist'));
  test('analyst=T, hybrid=F → auto',   () => expect(legacySwitchesToMode(true,  false)).toBe('auto'));
  test('hybrid=T 이면 analyst 무관 assist', () => {
    expect(legacySwitchesToMode(true,  true)).toBe('assist');
    expect(legacySwitchesToMode(false, true)).toBe('assist');
  });
});

describe('getRouterConfig', () => {
  const origEnv = { ...process.env };
  afterEach(() => { process.env = { ...origEnv }; });

  test('환경변수 읽어오기', async () => {
    process.env.SIGNAL_DEFAULT_TTL_MIN = '15';
    const cfg = await getRouterConfig();
    expect(cfg.defaultTtlMin).toBe(15);
  });

  test('잘못된 값은 기본값 30', async () => {
    process.env.SIGNAL_DEFAULT_TTL_MIN = '-10';
    const cfg = await getRouterConfig();
    expect(cfg.defaultTtlMin).toBe(30);
  });

  test('HYBRID_MODE_ENABLED=true 이면 hybridModeEnabled=true', async () => {
    process.env.HYBRID_MODE_ENABLED = 'true';
    const cfg = await getRouterConfig();
    expect(cfg.hybridModeEnabled).toBe(true);
  });
});

describe('getEngineSwitches — env 폴백 (DB 불가 상황)', () => {
  const origEnv = { ...process.env };
  afterEach(() => { process.env = { ...origEnv }; });

  test('기본값은 엔진 off + assist (fail-closed)', async () => {
    delete process.env.ENGINE_ENABLED;
    delete process.env.ANALYST_ENABLED;
    delete process.env.AUTOPILOT_MODE;
    delete process.env.HYBRID_MODE_ENABLED;
    const s = await getEngineSwitches();
    expect(s).toEqual({ engineEnabled: false, autopilotMode: 'assist', source: 'env' });
  });

  test('ENGINE_ENABLED=true + AUTOPILOT_MODE=auto', async () => {
    process.env.ENGINE_ENABLED = 'true';
    process.env.AUTOPILOT_MODE = 'auto';
    const s = await getEngineSwitches();
    expect(s.engineEnabled).toBe(true);
    expect(s.autopilotMode).toBe('auto');
  });

  test('구 ANALYST_ENABLED/HYBRID_MODE_ENABLED 도 계속 인정한다 (롤백 호환)', async () => {
    delete process.env.ENGINE_ENABLED;
    delete process.env.AUTOPILOT_MODE;
    process.env.ANALYST_ENABLED = 'true';
    process.env.HYBRID_MODE_ENABLED = 'true';
    const s = await getEngineSwitches();
    expect(s.engineEnabled).toBe(true);
    expect(s.autopilotMode).toBe('assist');
  });

  test('알 수 없는 AUTOPILOT_MODE 값은 무시하고 구 조합에서 추론한다', async () => {
    process.env.ENGINE_ENABLED = 'true';
    process.env.AUTOPILOT_MODE = 'yolo';
    delete process.env.HYBRID_MODE_ENABLED;
    const s = await getEngineSwitches();
    // 구 매핑표라면 auto 지만, **추론 경로는 assist 상한**이다 (T-006 reviewer HIGH).
    // 자율성 상승은 `autopilot_mode` 를 명시적으로 기입했을 때만 일어난다.
    expect(s.autopilotMode).toBe('assist');
  });

  test('isEngineEnabled 는 engineEnabled 를 그대로 반환', async () => {
    process.env.ENGINE_ENABLED = 'false';
    delete process.env.ANALYST_ENABLED;
    expect(await isEngineEnabled()).toBe(false);
  });
});
