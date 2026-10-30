/**
 * T-015 — 자동 청산 마스터 스위치 **판독기** 계약.
 *
 * 이 파일이 고정하는 단 하나의 불변식:
 *   **`true` 로 명시된 경우에만 자동 매도가 살아난다.** 그 밖의 모든 상태
 *   (키 부재 · 빈 값 · 오타 · DB 장애)는 전부 비활성이다.
 *
 * 형제 플래그 `exit_hard_stop_enabled` 는 반대 방향(기본 활성)인데, 그 방향을 **바꾸지 않는
 * 것** 또한 계약이다 — 마스터를 다시 켰을 때 이전과 똑같이 동작해야 하기 때문이다.
 */

const query = jest.fn();
jest.mock('@/lib/db', () => ({ getPool: () => ({ query: (...a: unknown[]) => query(...a) }) }));

import {
  readExitEngineSwitch,
  describeExitEngineSwitch,
  EXIT_ENGINE_ENABLED_KEY,
  EXIT_HARD_STOP_ENABLED_KEY,
} from '../exit-switch';
import { resetUnparsableReports } from '@/lib/safety/flags';

/** system_config 조회 결과를 흉내낸다 (value 는 JSON 문자열). */
function rows(entries: Record<string, string>) {
  return [Object.entries(entries).map(([key, value]) => ({ key, value }))];
}

beforeEach(() => {
  jest.clearAllMocks();
  resetUnparsableReports();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('🔕 마스터 스위치 기본 방향 — 명시적 true 만 활성', () => {
  test('키가 없으면 비활성 (absent)', async () => {
    query.mockResolvedValue(rows({}));
    const s = await readExitEngineSwitch();
    expect(s.enabled).toBe(false);
    expect(s.source).toBe('absent');
  });

  test('false 면 비활성 (config)', async () => {
    query.mockResolvedValue(rows({ [EXIT_ENGINE_ENABLED_KEY]: 'false' }));
    const s = await readExitEngineSwitch();
    expect(s.enabled).toBe(false);
    expect(s.source).toBe('config');
  });

  test('true 여야만 활성 (config)', async () => {
    query.mockResolvedValue(rows({ [EXIT_ENGINE_ENABLED_KEY]: 'true' }));
    const s = await readExitEngineSwitch();
    expect(s.enabled).toBe(true);
    expect(s.source).toBe('config');
  });

  test('🔴 DB 조회 실패는 비활성 — "모르면 팔지 않는다"', async () => {
    query.mockRejectedValue(new Error('ECONNREFUSED'));
    const s = await readExitEngineSwitch();
    expect(s.enabled).toBe(false);
    expect(s.source).toBe('db_error');
    expect(s.error).toContain('ECONNREFUSED');
  });

  test('🔴 해석 불가한 값은 비활성 + 소리내어 보고', async () => {
    query.mockResolvedValue(rows({ [EXIT_ENGINE_ENABLED_KEY]: '"maybe"' }));
    const s = await readExitEngineSwitch();
    expect(s.enabled).toBe(false);
    expect(s.source).toBe('unparsable');
    expect(s.raw).toBe('maybe');
    expect(console.error).toHaveBeenCalled();
  });

  test('비-JSON 원문(1/on)도 버리지 않고 해석한다', async () => {
    query.mockResolvedValue(rows({ [EXIT_ENGINE_ENABLED_KEY]: 'on' }));
    expect((await readExitEngineSwitch()).enabled).toBe(true);
    query.mockResolvedValue(rows({ [EXIT_ENGINE_ENABLED_KEY]: '1' }));
    expect((await readExitEngineSwitch()).enabled).toBe(true);
    query.mockResolvedValue(rows({ [EXIT_ENGINE_ENABLED_KEY]: '0' }));
    expect((await readExitEngineSwitch()).enabled).toBe(false);
  });

  test('절대 throw 하지 않는다 (엔진 틱을 죽이지 않는다)', async () => {
    query.mockImplementation(() => { throw new Error('boom'); });
    await expect(readExitEngineSwitch()).resolves.toMatchObject({ enabled: false });
  });
});

describe('하위 hard_stop 스위치 — 기존 방향(기본 활성)을 유지한다', () => {
  test('키가 없으면 활성 (마스터 재활성 시 종전 동작 복귀)', async () => {
    query.mockResolvedValue(rows({ [EXIT_ENGINE_ENABLED_KEY]: 'true' }));
    expect((await readExitEngineSwitch()).hardStopEnabled).toBe(true);
  });

  test('명시적 false 일 때만 비활성', async () => {
    query.mockResolvedValue(rows({
      [EXIT_ENGINE_ENABLED_KEY]: 'true',
      [EXIT_HARD_STOP_ENABLED_KEY]: 'false',
    }));
    expect((await readExitEngineSwitch()).hardStopEnabled).toBe(false);
  });

  test('DB 실패해도 hard_stop 자체 방향은 활성 유지 (마스터가 이미 막는다)', async () => {
    query.mockRejectedValue(new Error('down'));
    const s = await readExitEngineSwitch();
    expect(s.hardStopEnabled).toBe(true);
    expect(s.enabled).toBe(false);     // 실제 차단은 마스터가 한다
  });
});

describe('쿼리 1회로 두 키를 함께 읽는다', () => {
  test('SELECT 한 번, 파라미터는 두 키', async () => {
    query.mockResolvedValue(rows({}));
    await readExitEngineSwitch();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual([EXIT_ENGINE_ENABLED_KEY, EXIT_HARD_STOP_ENABLED_KEY]);
  });
});

describe('사람이 읽는 요약 — 오해할 여지를 남기지 않는다', () => {
  test('OFF 이면 네 종류를 모두 이름으로 말한다', async () => {
    query.mockResolvedValue(rows({ [EXIT_ENGINE_ENABLED_KEY]: 'false' }));
    const text = describeExitEngineSwitch(await readExitEngineSwitch());
    expect(text).toContain('OFF');
    expect(text).toContain('손실한도 손절');
    expect(text).toContain('장마감 전 손절');
    expect(text).toContain('트레일링');
    expect(text).toContain('익절');
  });

  test('키 부재 시 "기본값" 이라는 사실을 밝힌다', async () => {
    query.mockResolvedValue(rows({}));
    expect(describeExitEngineSwitch(await readExitEngineSwitch())).toContain('기본값');
  });

  test('ON 이면 동작 중이라고 말한다', async () => {
    query.mockResolvedValue(rows({ [EXIT_ENGINE_ENABLED_KEY]: 'true' }));
    expect(describeExitEngineSwitch(await readExitEngineSwitch())).toContain('ON');
  });
});
