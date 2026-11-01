/**
 * T-142 — `system_config` 의 **비 JSON 값**이 안전 플래그를 fail-open 시키던 문제.
 *
 * ## 무엇이 틀려 있었나
 *
 * `isKillSwitchActive()`·`isDryRun()` 은 `parseBoolFlag(JSON.parse(rows[0].value))` 를 **DB 조회와
 * 같은 `try` 안**에서 했다. 그래서 비 JSON 값을 만나면 `JSON.parse` 가 던지고, 그 예외를 「DB 를 못
 * 읽었다」용 `catch` 가 받아 **DB 값이 아예 없었던 것처럼** env 폴백으로 내려갔다.
 *
 * **운영 표는 그런 값을 애초에 막는다** — `system_config.value` 에 `CHECK (json_valid(value))` 가 걸려
 * 있어 평범한 INSERT·UPDATE·REPLACE 는 errno 4025 로 거부된다(T-142 감사 실측). 그래서 이 시험이 지키는
 * 것은 **제약이 없는 환경**(DB 복원본·마이그레이션 중 테이블·`check_constraint_checks=0` 세션·다른
 * 스토리지)에 대한 방어층과, **코드가 자기 문서를 지키는지**다.
 *
 *  - 킬스위치: env 미설정 → **`false`(제동 없음)**. [[T-141-killswitch-presend-recheck]] QA 가 경로
 *    **B**(DB 값 `yes` → 송신)·**G**(송신 직전 재확인 값이 비 JSON → 송신)에서 주문이 나가는 것을
 *    **모의 풀로** 재현했다(운영 도달에는 위 제약 우회가 필요하다).
 *  - DRY_RUN: unset 기본값이 ON 이라 대개 안전하지만, **env 에 `DRY_RUN=false` 가 있으면**
 *    「DB 에 `yes`(모의로 돌려라)」가 **실거래**로 뒤집힌다.
 *
 * 둘 다 **파일 주석과 `flags.ts` 3분기 표가 「해석 불가 → 안전 방향(활성)」이라고 적어 둔 것과 정반대**였다.
 * 코드가 자기 문서를 지키지 못한 것이고, `parseBoolFlag` 는 애초에 `yes`·`ON` 을 알아본다 — 그 앞에서
 * `JSON.parse` 가 값을 먹어 버린 것이 전부다.
 *
 * ## 이 시험이 지키는 것
 *  1. 비 JSON 값도 **값으로** 해석된다(`yes` → 활성, `no` → 비활성) — 「실패하면 무조건 활성」이 아니다
 *  2. 그래도 모르는 값은 `unparsable` → **활성 + critical 알림**(문서화된 의도)
 *  3. **정상 JSON 의 거동은 하나도 바뀌지 않는다** — `"yes"`(따옴표 포함)는 `parsed` 라서 **알림이 없다**
 *     (JSON 해석을 버리고 원문만 쓰는 변이를 이 단언이 잡는다)
 *  4. **DB 조회 자체의 실패는 그대로 env 폴백**이다 — T-142 는 그 경계를 건드리지 않는다(F-2②, 사용자 결정 대기)
 */
import { getPool } from '@/lib/db';
import { sendAlert } from '@/lib/notify';
import { isDryRun } from '../dry-run';
import { decodeFlagValue, resetUnparsableReports } from '../flags';
import { isKillSwitchActive } from '../kill-switch';

jest.mock('@/lib/db', () => ({ getPool: jest.fn(), getAccountId: jest.fn() }));
jest.mock('@/lib/notify', () => ({ sendAlert: jest.fn() }));

/** `system_config.value` 한 칸을 **그 글자 그대로** 돌려준다 — JSON 으로 감싸지 않는다. */
function mockRaw(value: string | undefined) {
  const query = jest.fn(async () => (value === undefined ? [[]] : [[{ value }]]));
  (getPool as jest.Mock).mockReturnValue({ query });
}

/** DB 조회 자체가 실패하는 경우(F-2② 경계 — 이 task 가 바꾸지 않는 쪽). */
function mockThrows() {
  (getPool as jest.Mock).mockReturnValue({ query: jest.fn().mockRejectedValue(new Error('db down')) });
}

const origEnv = { ...process.env };
let errSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  resetUnparsableReports();
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  delete process.env.KILL_SWITCH;
  delete process.env.DRY_RUN;
});
afterEach(() => {
  errSpy.mockRestore();
  process.env = { ...origEnv };
});

describe('decodeFlagValue — 비 JSON 이면 원문 그대로', () => {
  test('정상 JSON 은 해석한다 (기존 거동 유지)', () => {
    expect(decodeFlagValue('true')).toBe(true);
    expect(decodeFlagValue('false')).toBe(false);
    expect(decodeFlagValue('"true"')).toBe('true');
    expect(decodeFlagValue('1')).toBe(1);
    expect(decodeFlagValue('0')).toBe(0);
    expect(decodeFlagValue('null')).toBeNull();
    expect(decodeFlagValue('{"a":1}')).toEqual({ a: 1 });
  });

  test('JSON 이 아니면 **원문 문자열** 을 돌려준다 (예전에는 호출부가 예외로 받았다)', () => {
    for (const raw of ['yes', 'ON', 'no', ' TRUE ', '뭔가이상한값', '{{깨진', '']) {
      expect(decodeFlagValue(raw)).toBe(raw);
    }
  });

  test('문자열이 아니면 손대지 않는다', () => {
    expect(decodeFlagValue(true)).toBe(true);
    expect(decodeFlagValue(1)).toBe(1);
    expect(decodeFlagValue(null)).toBeNull();
    expect(decodeFlagValue(undefined)).toBeUndefined();
    const o = { a: 1 };
    expect(decodeFlagValue(o)).toBe(o);
    // 배열은 `JSON.parse` 가 문자열로 강제해 숫자로 바꿔 버린다(`JSON.parse([1])` === 1).
    // 가드가 없으면 `unparsable`(안전 방향 + 알림)이던 값이 조용히 `parsed(true)` 가 된다.
    // 지금 두 호출점은 DB 문자열만 넘기므로 실효는 없지만, 가드를 지우는 변이를 이 줄이 잡는다.
    const arr = [1];
    expect(decodeFlagValue(arr)).toBe(arr);
  });
});

describe('isKillSwitchActive — DB 값이 JSON 이 아닐 때', () => {
  test('🔴 `yes` 는 활성이다 (예전에는 env 폴백으로 흘러 false = 제동 없음)', async () => {
    mockRaw('yes');
    await expect(isKillSwitchActive()).resolves.toBe(true);
    expect(sendAlert).not.toHaveBeenCalled();   // `parsed` 다 — 해석 불가가 아니다
    expect(errSpy).not.toHaveBeenCalled();
  });

  test('`ON` · `1` 도 활성이다', async () => {
    for (const raw of ['ON', 'on', '1']) {
      jest.clearAllMocks();
      mockRaw(raw);
      await expect(isKillSwitchActive()).resolves.toBe(true);
    }
  });

  test('🔴 `no` 는 비활성이다 — 「해석 실패하면 무조건 활성」이 아니다', async () => {
    for (const raw of ['no', 'off', 'NO']) {
      jest.clearAllMocks();
      mockRaw(raw);
      await expect(isKillSwitchActive()).resolves.toBe(false);
      expect(sendAlert).not.toHaveBeenCalled();
    }
  });

  test('🔴 그래도 모르는 값은 활성 + critical 알림 (문서화된 의도)', async () => {
    mockRaw('뭔가이상한값');
    await expect(isKillSwitchActive()).resolves.toBe(true);
    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect(sendAlert).toHaveBeenCalledWith('critical', expect.stringMatching(/해석 불가/), expect.any(String));
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(String(errSpy.mock.calls[0][0])).toMatch(/system_config\.safety_kill_switch/);
  });

  test('🔴 JSON 으로 감싼 `"yes"` 는 `parsed` 라서 알림이 없다 (JSON 해석을 버리는 변이를 잡는다)', async () => {
    mockRaw('"yes"');
    await expect(isKillSwitchActive()).resolves.toBe(true);
    expect(sendAlert).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });

  test('빈 문자열은 미설정 취급 → env 폴백', async () => {
    mockRaw('');
    process.env.KILL_SWITCH = 'true';
    await expect(isKillSwitchActive()).resolves.toBe(true);
    expect(sendAlert).not.toHaveBeenCalled();
  });

  test('DB 조회 실패는 그대로 env 폴백이다 (F-2② — 이 task 가 바꾸지 않는 경계)', async () => {
    mockThrows();
    await expect(isKillSwitchActive()).resolves.toBe(false);   // env 미설정 → 비활성
    mockThrows();
    process.env.KILL_SWITCH = 'true';
    await expect(isKillSwitchActive()).resolves.toBe(true);
  });
});

describe('isDryRun — DB 값이 JSON 이 아닐 때', () => {
  test('🔴 DB `yes` + env `DRY_RUN=false` → ON. 「모의로 돌려라」가 실거래로 뒤집히지 않는다', async () => {
    mockRaw('yes');
    process.env.DRY_RUN = 'false';
    await expect(isDryRun()).resolves.toBe(true);
    expect(errSpy).not.toHaveBeenCalled();
  });

  test('DB `no` → OFF (env 폴백으로 흐르지 않고 DB 값을 쓴다)', async () => {
    mockRaw('no');
    delete process.env.DRY_RUN;        // 폴백으로 흘렀다면 미설정 → ON 이 됐을 것이다
    await expect(isDryRun()).resolves.toBe(false);
  });

  test('모르는 값은 ON + console.error', async () => {
    mockRaw('뭔가이상한값');
    process.env.DRY_RUN = 'false';
    await expect(isDryRun()).resolves.toBe(true);
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(String(errSpy.mock.calls[0][0])).toMatch(/safety_dry_run/);
  });

  test('JSON 으로 감싼 `"off"` 는 `parsed` 라서 경고 없이 OFF', async () => {
    mockRaw('"off"');
    await expect(isDryRun()).resolves.toBe(false);
    expect(errSpy).not.toHaveBeenCalled();
  });

  test('DB 조회 실패는 그대로 env 폴백이다 (F-2② 경계)', async () => {
    mockThrows();
    process.env.DRY_RUN = 'false';
    await expect(isDryRun()).resolves.toBe(false);
  });
});
