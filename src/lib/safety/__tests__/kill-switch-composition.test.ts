/**
 * T-041 — 24h drawdown 킬스위치가 **"보유 종목이 관측에서 사라진 것"을 시장 손실로 오인해 발동하지 않는다.**
 *
 * 2026-10-03 04:16 KST 실사고의 재현이다. 숫자는 운영 로그 그대로:
 *   기준 23,496,819원 → 현재 6,515,279원, 소실 [NAS:SMH, NAS:SNPS] 16,976,065원(기준의 72.2%).
 *   저장 가드는 01:53·03:04 에 `holding_vanished` 로 거부했으나 직전 스냅샷이 3시간을 넘기자
 *   릴리스 밸브가 검사를 끄고 저장했고, 킬스위치가 그 행을 "-72.3% 손실"로 읽어 자동 발동했다.
 *
 * 계약 (양방향 — 둘 다 지켜야 안전장치다):
 *   1. 소실분을 빼고도 임계 안이면 → 발동 보류 + **critical 알림**(조용한 보류 금지).
 *   2. 실제 손실이면 → **그대로 발동**한다. 종목이 남아 있는 폭락, 소실 + 남은 보유의 추가 폭락,
 *      0원으로 기록된 보유(상폐), 검증 불가(보정 기준 0 이하·구성 읽기 불가) 모두.
 */
const sendAlert = jest.fn();
const sendAlertThrottled = jest.fn();
const checkSnapshotFreshness = jest.fn();

jest.mock('@/lib/notify', () => ({ sendAlert: (...a: unknown[]) => sendAlert(...a) }));
jest.mock('@/lib/notify/throttle', () => ({
  sendAlertThrottled: (...a: unknown[]) => sendAlertThrottled(...a),
  resetAlertThrottle: () => {},
}));
// 기존 kill-switch-drawdown.test.ts 와 같은 모킹 — kill-switch.ts 는 volatility-guard 에서 신선도만 가져온다.
jest.mock('@/lib/safety/volatility-guard', () => ({
  checkSnapshotFreshness: (...a: unknown[]) => checkSnapshotFreshness(...a),
}));

// 실제 구현을 그대로 감싼 jest.fn — 평소엔 실제와 같고, L-2 테스트에서만 예외를 던지게 한다.
jest.mock('@/lib/safety/snapshot-composition', () => {
  const actual = jest.requireActual('@/lib/safety/snapshot-composition');
  return { ...actual, assessDrawdownComposition: jest.fn(actual.assessDrawdownComposition) };
});

const query = jest.fn();
jest.mock('@/lib/db', () => ({ getPool: () => ({ query: (...a: unknown[]) => query(...a) }) }));

import { checkAndTriggerDrawdownKillSwitch } from '@/lib/safety/kill-switch';
import * as composition from '@/lib/safety/snapshot-composition';

const HOUR = 60 * 60_000;
type P = { currency: string; qty: number; price: number; value_krw: number };
const p = (currency: string, value_krw: number): P => ({ currency, qty: 1, price: value_krw, value_krw });

interface Snap { total: number; positions?: unknown }

function mockState(baseline: Snap | null, current: Snap, killSwitch = false) {
  checkSnapshotFreshness.mockResolvedValue({
    latestTs: new Date(Date.now() - 5 * 60_000), ageMs: 5 * 60_000, level: 'ok', session: 'open', effectiveAgeMs: 5 * 60_000,
  });
  query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/SELECT value FROM system_config/.test(sql) && params[0] === 'safety_kill_switch') {
      return [[{ value: JSON.stringify(killSwitch) }]];
    }
    if (/INSERT INTO system_config/.test(sql)) return [{ affectedRows: 1 }];
    if (/ORDER BY ABS\(TIMESTAMPDIFF/.test(sql)) {
      return [baseline == null ? [] : [{ total_krw: baseline.total, positions: baseline.positions, ts: new Date(Date.now() - 24 * HOUR) }]];
    }
    if (/ORDER BY ts DESC/.test(sql)) return [[{ total_krw: current.total, positions: current.positions }]];
    return [[]];
  });
}

const inserted = () => query.mock.calls.filter(c => /INSERT INTO system_config/.test(String(c[0])));

// ── 2026-10-03 실사고 데이터 ──────────────────────────────────────────────
const INCIDENT_BASELINE: Snap = {
  total: 23_496_819,
  positions: [
    p('KRW', 80_000), p('000660', 1_840_000), p('005930', 2_480_000), p('NYS:ORCL', 1_150_000),
    p('NAS:SMH', 1_710_000), p('NAS:SNPS', 15_266_065), p('NYS:V', 970_000),
  ],
};
const INCIDENT_CURRENT: Snap = {
  total: 6_515_279,
  positions: [p('KRW', 80_000), p('000660', 1_840_000), p('005930', 2_480_000), p('NYS:ORCL', 1_150_000), p('NYS:V', 970_000)],
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.KILL_SWITCH;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('🔴 2026-10-03 오발동 재현 — 발동하지 않고 시끄럽게 알린다', () => {
  test('실사고 수치: 발동 보류, INSERT 없음, 결과에 사유와 상세', async () => {
    mockState(INCIDENT_BASELINE, INCIDENT_CURRENT);
    const r = await checkAndTriggerDrawdownKillSwitch(10);
    expect(r).toMatchObject({ status: 'skipped', reason: 'composition_change_suspected' });
    expect((r as { detail?: string }).detail).toContain('NAS:SNPS');
    expect(inserted()).toHaveLength(0);
  });

  test('조용한 보류가 아니다 — critical 알림에 종목·금액·수동 발동 방법이 들어간다', async () => {
    mockState(INCIDENT_BASELINE, INCIDENT_CURRENT);
    await checkAndTriggerDrawdownKillSwitch(10);
    expect(sendAlertThrottled).toHaveBeenCalledTimes(1);
    const [key, level, title, body] = sendAlertThrottled.mock.calls[0];
    expect(String(key)).toMatch(/^kill-switch:composition-suspected:/);   // 사건(소실 종목 조합)별 키
    expect(level).toBe('critical');
    expect(String(title)).toContain('보류');
    expect(String(body)).toContain('NAS:SNPS');
    expect(String(body)).toContain('NAS:SMH');
    expect(String(body)).toContain('16,976,065');
    expect(String(body)).toContain('수동으로 켜세요');
    expect(sendAlert).not.toHaveBeenCalled();             // "자동 발동" 알림은 나가지 않는다
  });

  test('positions 가 mysql2 에서 JSON 문자열로 와도 같다', async () => {
    mockState(
      { total: INCIDENT_BASELINE.total, positions: JSON.stringify(INCIDENT_BASELINE.positions) },
      { total: INCIDENT_CURRENT.total, positions: JSON.stringify(INCIDENT_CURRENT.positions) },
    );
    const r = await checkAndTriggerDrawdownKillSwitch(10);
    expect(r).toMatchObject({ status: 'skipped', reason: 'composition_change_suspected' });
  });
});

describe('🔴 실제 손실이면 그대로 발동한다 (보정이 진짜 폭락을 가리지 않는다)', () => {
  test('종목이 그대로 있는 24h -15% 폭락', async () => {
    mockState(
      { total: 10_000_000, positions: [p('KRW', 1_000_000), p('A', 9_000_000)] },
      { total: 8_500_000, positions: [p('KRW', 1_000_000), p('A', 7_500_000)] },
    );
    const r = await checkAndTriggerDrawdownKillSwitch(10);
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
    expect(inserted()).toHaveLength(1);
    expect(sendAlert.mock.calls[0][0]).toBe('critical');
    expect(String(sendAlert.mock.calls[0][2])).not.toContain('보유 소실');   // 소실 없음 → 기존 문구 그대로
  });

  test('종목이 사라졌고 남은 보유도 실제로 크게 빠졌다 → 발동, 사유에 소실 사실을 덧붙인다', async () => {
    mockState(
      { total: 20_000_000, positions: [p('KRW', 1_000_000), p('A', 10_000_000), p('B', 9_000_000)] },
      { total: 6_000_000, positions: [p('KRW', 1_000_000), p('B', 5_000_000)] },     // B -44%, A 소실
    );
    const r = await checkAndTriggerDrawdownKillSwitch(10);
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
    expect(inserted()).toHaveLength(1);
    const body = String(sendAlert.mock.calls[0][2]);
    expect(body).toContain('보유 소실 [A]');
    expect(body).toContain('-40.0%');
    expect(sendAlertThrottled).not.toHaveBeenCalled();
  });

  test('🔴 0원으로 *기록된* 보유(상폐·거래정지)는 소실이 아니라 실제 손실 → 발동', async () => {
    mockState(
      { total: 10_000_000, positions: [p('KRW', 1_000_000), p('A', 4_000_000), p('B', 5_000_000)] },
      { total: 6_000_000, positions: [p('KRW', 1_000_000), p('A', 0), p('B', 5_000_000)] },
    );
    const r = await checkAndTriggerDrawdownKillSwitch(10);
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
    expect(inserted()).toHaveLength(1);
  });

  test('소실이 기준 총액의 10% 미만이면 보정하지 않고 기존대로 발동', async () => {
    mockState(
      { total: 10_000_000, positions: [p('KRW', 1_000_000), p('A', 800_000), p('B', 8_200_000)] },    // A = 8%
      { total: 8_000_000, positions: [p('KRW', 1_000_000), p('B', 7_000_000)] },                      // -20%
    );
    const r = await checkAndTriggerDrawdownKillSwitch(10);
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
  });

  test('🔴 검증 불가는 발동 쪽 — 보정 기준이 0 이하(전 보유가 미설명으로 사라짐)', async () => {
    mockState(
      { total: 10_000_000, positions: [p('A', 10_000_000)] },
      { total: 1_000_000, positions: [] },
    );
    const r = await checkAndTriggerDrawdownKillSwitch(10);
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
    expect(String(sendAlert.mock.calls[0][2])).toContain('계산 불가');
  });

  test('🔴 검증 불가는 발동 쪽 — 구성(positions)을 읽을 수 없는 행은 기존대로 총액만 본다', async () => {
    mockState({ total: 10_000_000 }, { total: 2_000_000 });                       // positions 컬럼 없음/NULL
    expect(await checkAndTriggerDrawdownKillSwitch(10)).toMatchObject({ status: 'evaluated', triggered: true });

    jest.clearAllMocks();
    mockState({ total: 10_000_000, positions: 'not json' }, { total: 2_000_000, positions: INCIDENT_CURRENT.positions });
    expect(await checkAndTriggerDrawdownKillSwitch(10)).toMatchObject({ status: 'evaluated', triggered: true });

    jest.clearAllMocks();
    mockState({ total: 10_000_000, positions: [p('A', 10_000_000)] }, { total: 2_000_000 });   // 현재 쪽만 없음
    expect(await checkAndTriggerDrawdownKillSwitch(10)).toMatchObject({ status: 'evaluated', triggered: true });
  });
});

describe('회귀 — 임계 미만·기존 가드는 그대로', () => {
  test('소실이 있어도 총액 손실이 임계 미만이면 평가만 하고 보정 경로로 가지 않는다', async () => {
    mockState(
      { total: 10_000_000, positions: [p('KRW', 1_000_000), p('A', 9_000_000)] },
      { total: 9_900_000, positions: [p('KRW', 9_900_000)] },                       // 매도 대금이 현금으로 잡힘
    );
    const r = await checkAndTriggerDrawdownKillSwitch(10);
    expect(r).toEqual({ status: 'evaluated', drawdownPct: expect.closeTo(-1, 5), triggered: false });
    expect(sendAlertThrottled).not.toHaveBeenCalled();
  });

  test('이미 활성이면 구성 검사를 하지 않는다', async () => {
    mockState(INCIDENT_BASELINE, INCIDENT_CURRENT, true);
    expect(await checkAndTriggerDrawdownKillSwitch(10)).toEqual({ status: 'skipped', reason: 'already_active' });
    expect(sendAlertThrottled).not.toHaveBeenCalled();
  });

  test('기준선 SQL 은 positions 를 읽되 24h±60분 창과 OR 없음 계약을 유지한다', async () => {
    mockState(INCIDENT_BASELINE, INCIDENT_CURRENT);
    await checkAndTriggerDrawdownKillSwitch(10);
    const call = query.mock.calls.find(c => /ORDER BY ABS\(TIMESTAMPDIFF/.test(String(c[0])))!;
    expect(String(call[0])).toContain('positions');
    expect(String(call[0])).not.toMatch(/\bOR\b/);
    expect(call[1]).toEqual([1500, 1380]);
  });
});

// ── Reviewer C-1 회귀 (2026-10-11) ───────────────────────────────────────────
// 소실 판정이 "총액 감소"로 소실 여부를 가렸기 때문에, *정상 매도(대금이 현금/신규 보유로 잡힘)* 뒤에
// 남은 보유가 실제로 빠진 진짜 손실을 "관측 불능"으로 오인해 발동을 보류했다 (새 fail-open).
// 이 블록의 입력은 변경 전 코드(= 총액만 비교)에서는 전부 발동했다 → 계속 발동해야 한다.
describe('🔴 C-1 — 정상 매도 뒤 남은 보유의 실제 손실은 발동한다', () => {
  const expectTriggered = async (baseline: Snap, current: Snap) => {
    mockState(baseline, current);
    const r = await checkAndTriggerDrawdownKillSwitch(10);
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
    expect(inserted()).toHaveLength(1);
    expect(sendAlertThrottled).not.toHaveBeenCalled();
  };

  test('≥10% 종목을 팔아 대금이 KRW 현금에 잡히고, 나머지 B 가 -13.6% (총 -12%)', async () => {
    await expectTriggered(
      { total: 10_000_000, positions: [p('KRW', 0), p('A', 1_200_000), p('B', 8_800_000)] },
      { total: 8_800_000, positions: [p('KRW', 1_200_000), p('B', 7_600_000)] },
    );
  });

  test('매도 10% · 총 -15%', async () => {
    await expectTriggered(
      { total: 10_000_000, positions: [p('KRW', 0), p('A', 1_000_000), p('B', 9_000_000)] },
      { total: 8_500_000, positions: [p('KRW', 1_000_000), p('B', 7_500_000)] },
    );
  });

  test('매도 30% · 총 -25%', async () => {
    await expectTriggered(
      { total: 10_000_000, positions: [p('KRW', 0), p('A', 3_000_000), p('B', 7_000_000)] },
      { total: 7_500_000, positions: [p('KRW', 3_000_000), p('B', 4_500_000)] },
    );
  });

  test('대금이 USD 현금 행에 잡힌 경우', async () => {
    await expectTriggered(
      { total: 10_000_000, positions: [p('KRW', 0), p('A', 1_200_000), p('B', 8_800_000)] },
      { total: 8_800_000, positions: [p('USD', 1_200_000), p('B', 7_600_000)] },
    );
  });

  test('대금이 다른 신규 종목 매수로 이어진 경우 (A → C)', async () => {
    await expectTriggered(
      { total: 10_000_000, positions: [p('KRW', 0), p('A', 1_200_000), p('B', 8_800_000)] },
      { total: 8_800_000, positions: [p('KRW', 0), p('C', 1_200_000), p('B', 7_600_000)] },
    );
  });

  test('value_krw 가 문자열로 와도 같다', async () => {
    const s = (cur: string, v: number) => ({ currency: cur, qty: 1, price: 1, value_krw: String(v) });
    await expectTriggered(
      { total: 10_000_000, positions: [s('KRW', 0), s('A', 1_200_000), s('B', 8_800_000)] },
      { total: 8_800_000, positions: [s('KRW', 1_200_000), s('B', 7_600_000)] },
    );
  });

  test('대금이 정산 대기라 어디에도 안 잡혔지만 남은 보유 B 가 -13.6% 빠졌다', async () => {
    await expectTriggered(
      { total: 10_000_000, positions: [p('KRW', 0), p('A', 1_200_000), p('B', 8_800_000)] },
      { total: 7_600_000, positions: [p('KRW', 0), p('B', 7_600_000)] },
    );
  });
});

describe('경계·계약 고정 (Reviewer M-1)', () => {
  test('보정 후 손실이 정확히 임계(-10%)이면 발동한다 (보류는 엄격히 임계 안일 때만)', async () => {
    // 기준 10M [A 2M, B 8M], 현재 B 7.2M: 소실 A 2M 미설명, 남은 B -10.0%
    mockState(
      { total: 10_000_000, positions: [p('KRW', 0), p('A', 2_000_000), p('B', 8_000_000)] },
      { total: 7_200_000, positions: [p('KRW', 0), p('B', 7_200_000)] },
    );
    expect(await checkAndTriggerDrawdownKillSwitch(10)).toMatchObject({ status: 'evaluated', triggered: true });
  });

  test('보정 후 손실이 임계 바로 안쪽이면 보류한다', async () => {
    mockState(
      { total: 10_000_000, positions: [p('KRW', 0), p('A', 2_000_000), p('B', 8_000_000)] },
      { total: 7_200_001, positions: [p('KRW', 0), p('B', 7_200_001)] },
    );
    expect(await checkAndTriggerDrawdownKillSwitch(10)).toMatchObject({ status: 'skipped', reason: 'composition_change_suspected' });
  });

  test('미설명 소실이 10% 미만이면(소액) 보정하지 않고 총액 기준으로 발동한다', async () => {
    mockState(
      { total: 10_000_000, positions: [p('KRW', 0), p('A', 900_000), p('B', 9_100_000)] },    // A 9%
      { total: 8_000_000, positions: [p('KRW', 0), p('B', 8_000_000)] },
    );
    expect(await checkAndTriggerDrawdownKillSwitch(10)).toMatchObject({ status: 'evaluated', triggered: true });
  });

  test('🔴 미설명 소실이 10% 미만이면, 보정하면 임계 안으로 들어오는 경우에도 보류하지 않고 발동한다 (문턱 고정)', async () => {
    // A(8%) 미설명 소실 + B -3.3%: 보정 손실은 -3.3% 로 임계 안이지만, 소액 소실로 안전장치를 끄지 않는다 → 총 -11% 로 발동
    mockState(
      { total: 10_000_000, positions: [p('KRW', 0), p('A', 800_000), p('B', 9_200_000)] },
      { total: 8_900_000, positions: [p('KRW', 0), p('B', 8_900_000)] },
    );
    expect(await checkAndTriggerDrawdownKillSwitch(10)).toMatchObject({ status: 'evaluated', triggered: true });
    expect(sendAlertThrottled).not.toHaveBeenCalled();
  });

  test('보류 알림은 6시간 스로틀이고, 사건(소실 종목 조합)마다 키가 다르다', async () => {
    mockState(INCIDENT_BASELINE, INCIDENT_CURRENT);
    await checkAndTriggerDrawdownKillSwitch(10);
    const [key1, , , , ms] = sendAlertThrottled.mock.calls[0];
    expect(ms).toBe(6 * 60 * 60 * 1000);
    expect(String(key1)).toContain('NAS:SMH');
    expect(String(key1)).toContain('NAS:SNPS');

    jest.clearAllMocks();
    mockState(
      { total: 10_000_000, positions: [p('KRW', 0), p('X', 3_000_000), p('B', 7_000_000)] },
      { total: 7_000_000, positions: [p('KRW', 0), p('B', 7_000_000)] },
    );
    await checkAndTriggerDrawdownKillSwitch(10);
    expect(String(sendAlertThrottled.mock.calls[0][0])).not.toBe(String(key1));
  });

  test('알림 문구는 사실을 단정하지 않는다 — "현금 이동 없이 사라졌다" 같은 반대 방향 단정 금지, 상폐 가능성 안내', async () => {
    mockState(INCIDENT_BASELINE, INCIDENT_CURRENT);
    await checkAndTriggerDrawdownKillSwitch(10);
    const body = String(sendAlertThrottled.mock.calls[0][3]);
    expect(body).not.toContain('현금 이동 없이 사라졌다');
    expect(body).toContain('설명되지 않');          // 현금 증가·신규 보유로 설명되지 않는 금액
    expect(body).toContain('상장폐지');             // 종목 행 제거형 실손실 가능성
  });

  test('🔴 구성 검증 단계에서 예기치 않은 예외가 나면 보류가 아니라 발동한다 (검증 불가는 발동)', async () => {
    (composition.assessDrawdownComposition as jest.Mock).mockImplementationOnce(() => { throw new Error('boom'); });
    mockState(INCIDENT_BASELINE, INCIDENT_CURRENT);
    const r = await checkAndTriggerDrawdownKillSwitch(10);
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
    expect(inserted()).toHaveLength(1);
    expect(String(sendAlert.mock.calls[0][2])).toContain('구성 검증 실패');
    expect(sendAlertThrottled).not.toHaveBeenCalled();
  });
});

// ── 2라운드 독립 감사 C-2 회귀 (2026-10-11) ───────────────────────────────────
// "미설명 소실 U" 는 세 가지를 구분하지 못한다: ① 관측 불능 ② 소실 종목을 낮은 가격에 청산한 *실현 손실*
// ③ 그 대금으로 산 보유(신규·추가 매수)의 이후 하락. 스냅샷만으로는 구별 불가능하므로, **거래 정황이 보이면
// (현금 유입·신규 보유·기존 종목 추가 매수) 관측 불능으로 보지 않고 발동**한다. 보류는 "보유만 사라지고 다른
// 구성 항목은 거의 움직이지 않은" 순수 소실(= 10-03 사고 형태)로 한정한다.
// 이 블록의 입력은 변경 전 코드(총액만 비교)에서는 전부 발동했다 → 계속 발동해야 한다.
const q = (currency: string, qty: number, price: number): P => ({ currency, qty, price, value_krw: Math.round(qty * price) });

describe('🔴 C-2 — 거래가 낀 실제 손실은 발동한다 (U 가 시장 손실을 흡수하지 못한다)', () => {
  const expectTriggered = async (baseline: Snap, current: Snap) => {
    mockState(baseline, current);
    const r = await checkAndTriggerDrawdownKillSwitch(10);
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
    expect(inserted()).toHaveLength(1);
    expect(sendAlertThrottled).not.toHaveBeenCalled();
  };

  test('α 손절: A -30% 후 매도(현금 2.8M), B 불변 → 총 -12%', async () => {
    await expectTriggered(
      { total: 10_000_000, positions: [p('KRW', 0), p('A', 4_000_000), p('B', 6_000_000)] },
      { total: 8_800_000, positions: [p('KRW', 2_800_000), p('B', 6_000_000)] },
    );
  });

  test('β 리밸런스: A 를 팔아 기존 B 에 추가 매수, B -12% → 총 -12%', async () => {
    await expectTriggered(
      { total: 10_000_000, positions: [p('KRW', 0), q('A', 20, 100_000), q('B', 100, 80_000)] },
      { total: 8_800_000, positions: [p('KRW', 0), q('B', 125, 70_400)] },      // +25주 매수 후 단가 -12%
    );
  });

  test('γ 갈아타기: A 를 팔아 신규 C 를 사고 C -24% → 총 -12%', async () => {
    await expectTriggered(
      { total: 10_000_000, positions: [p('KRW', 0), p('A', 5_000_000), p('B', 5_000_000)] },
      { total: 8_800_000, positions: [p('KRW', 0), p('B', 5_000_000), p('C', 3_800_000)] },
    );
  });

  test('사용자 포트폴리오 형태 ①: SNPS+SMH(16.98M)를 신규 MU 로 갈아타고 MU -16% → 총 -11.6%', async () => {
    const cur = [p('KRW', 80_000), p('000660', 1_840_000), p('005930', 2_480_000), p('NYS:ORCL', 1_150_000), p('NYS:V', 970_000), p('NAS:MU', 14_259_895)];
    await expectTriggered(INCIDENT_BASELINE, { total: 20_779_895, positions: cur });
  });

  test('사용자 포트폴리오 형태 ②: SNPS 만 신규 MU 로 갈아타고 MU -20% → 총 -13.0%', async () => {
    const cur = [p('KRW', 80_000), p('000660', 1_840_000), p('005930', 2_480_000), p('NYS:ORCL', 1_150_000), p('NAS:SMH', 1_710_000), p('NYS:V', 970_000), p('NAS:MU', 12_212_852)];
    await expectTriggered(INCIDENT_BASELINE, { total: 20_443_606, positions: cur });
  });

  test('현금 일부만 보이고(정산 일부) 나머지가 소실 + 남은 보유 하락 → 발동', async () => {
    await expectTriggered(
      { total: 10_000_000, positions: [p('KRW', 0), p('A', 3_000_000), p('B', 7_000_000)] },
      { total: 7_500_000, positions: [p('KRW', 1_000_000), p('B', 6_500_000)] },
    );
  });
});

describe('순수 소실(보유만 사라지고 다른 항목은 안 움직임)은 계속 보류한다', () => {
  test('10-03 사고 형태: 현금·신규·추가 매수 없음 → 보류', async () => {
    mockState(INCIDENT_BASELINE, INCIDENT_CURRENT);
    expect(await checkAndTriggerDrawdownKillSwitch(10)).toMatchObject({ status: 'skipped', reason: 'composition_change_suspected' });
  });

  test('현금에 먼지 수준(소실액의 3% 이내) 변동이 있어도 순수 소실로 본다', async () => {
    mockState(
      { total: 10_000_000, positions: [p('KRW', 80_000), p('A', 3_000_000), p('B', 6_920_000)] },
      { total: 7_020_000, positions: [p('KRW', 100_000), p('B', 6_920_000)] },     // 현금 +20k (소실의 0.7%)
    );
    expect(await checkAndTriggerDrawdownKillSwitch(10)).toMatchObject({ status: 'skipped', reason: 'composition_change_suspected' });
  });

  test('가격 상승(수량 불변)은 추가 매수로 치지 않는다 — 수량으로 판정', async () => {
    mockState(
      { total: 10_000_000, positions: [p('KRW', 0), q('A', 10, 300_000), q('B', 100, 70_000)] },
      { total: 7_300_000, positions: [p('KRW', 0), q('B', 100, 73_000)] },          // B +4.3%, 수량 그대로
    );
    expect(await checkAndTriggerDrawdownKillSwitch(10)).toMatchObject({ status: 'skipped', reason: 'composition_change_suspected' });
  });

  test('수량 정보가 없는 구형 행은 가치 증가를 추가 매수로 보수적으로 본다 → 발동 쪽', async () => {
    mockState(
      { total: 10_000_000, positions: [{ currency: 'KRW', value_krw: 0 }, { currency: 'A', value_krw: 3_000_000 }, { currency: 'B', value_krw: 7_000_000 }] },
      { total: 7_500_000, positions: [{ currency: 'KRW', value_krw: 0 }, { currency: 'B', value_krw: 7_500_000 }] },   // B +500k = 소실의 16.7%
    );
    expect(await checkAndTriggerDrawdownKillSwitch(10)).toMatchObject({ status: 'evaluated', triggered: true });
  });
});

describe('알려진 한계를 고정한다 (조용히 바뀌지 않게)', () => {
  test('δ 손실 실현 후 전액 출금은 관측 불능과 구별할 수 없다 → 보류 + critical 알림 (상폐 가능성 안내 포함)', async () => {
    mockState(
      { total: 10_000_000, positions: [p('KRW', 0), p('A', 4_000_000), p('B', 6_000_000)] },
      { total: 6_000_000, positions: [p('KRW', 0), p('B', 6_000_000)] },            // A 를 -30% 에 팔아 전부 출금
    );
    expect(await checkAndTriggerDrawdownKillSwitch(10)).toMatchObject({ status: 'skipped', reason: 'composition_change_suspected' });
    expect(sendAlertThrottled.mock.calls[0][1]).toBe('critical');
    expect(String(sendAlertThrottled.mock.calls[0][3])).toContain('상장폐지');
  });

  test('부분 설명 보류 알림은 "소실 총액"과 "미설명 금액"을 구분해 적는다', async () => {
    // V = 10M, 현금 +0.2M(소실의 2% → 순수 소실로 봄) → 미설명 U = 9.8M
    mockState(
      { total: 20_000_000, positions: [p('KRW', 0), p('A', 10_000_000), p('B', 10_000_000)] },
      { total: 10_200_000, positions: [p('KRW', 200_000), p('B', 10_000_000)] },
    );
    await checkAndTriggerDrawdownKillSwitch(10);
    const body = String(sendAlertThrottled.mock.calls[0][3]);
    expect(body).toContain('10,000,000원이 현재 스냅샷에서 사라졌고');
    expect(body).toContain('거래 정황은 미미하다(허용치 이내 200,000원)');      // 현금 유입 20만 원 = 거래 정황 합계
    expect(body).toContain('그중 9,800,000원');
  });
});

describe('🔴 M-1 · M-2 — 감사가 찾은 보류 우회는 발동으로 닫혀 있다', () => {
  const h = (currency: string, value_krw: number, qty: number) => ({ currency, value_krw, qty, price: qty > 0 ? value_krw / qty : 0 });

  test('M-1: 신규 보유가 가치 0·수량 50 으로 기록돼도 발동하고, 사유에 가치 미기록 보유를 적는다', async () => {
    mockState(
      { total: 10_000_000, positions: [h('KRW', 0, 0), h('A', 5_000_000, 5), h('B', 5_000_000, 5)] },
      { total: 5_000_000, positions: [h('KRW', 0, 0), h('B', 5_000_000, 5), h('C', 0, 50)] },
    );
    const r = await checkAndTriggerDrawdownKillSwitch(10);
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
    expect(inserted()).toHaveLength(1);
    expect(sendAlertThrottled).not.toHaveBeenCalled();         // 보류 알림이 아니라 발동 알림
    const body = String(sendAlert.mock.calls[0][2]);
    expect(body).toContain('보유 소실 [A]');
    expect(body).toContain('가치 미기록 보유 [C]');
    expect(body).toContain('관측 불능으로 보지 않음');
  });

  test('M-1 대조: 같은 상황에서 C 기록이 아예 없으면(10-03 사고 형태) 여전히 보류', async () => {
    mockState(
      { total: 10_000_000, positions: [h('KRW', 0, 0), h('A', 5_000_000, 5), h('B', 5_000_000, 5)] },
      { total: 5_000_000, positions: [h('KRW', 0, 0), h('B', 5_000_000, 5)] },
    );
    const r = await checkAndTriggerDrawdownKillSwitch(10);
    expect(r).toMatchObject({ status: 'skipped', reason: 'composition_change_suspected' });
    expect(inserted()).toHaveLength(0);
  });

  test('M-3: 허용 심볼의 영구 0원 행이 양쪽에 있어도 10-03 사고 형태는 여전히 보류', async () => {
    mockState(
      { total: 10_000_000, positions: [h('KRW', 0, 0), h('A', 5_000_000, 5), h('B', 5_000_000, 5), h('HALT', 0, 10)] },
      { total: 5_000_000, positions: [h('KRW', 0, 0), h('B', 5_000_000, 5), h('HALT', 0, 10)] },
    );
    const r = await checkAndTriggerDrawdownKillSwitch(10);
    expect(r).toMatchObject({ status: 'skipped', reason: 'composition_change_suspected' });
    expect(inserted()).toHaveLength(0);
  });

  test('M-3 대조: 그 영구 0원 행의 수량이 늘었으면 발동하고 사유에 가치 미기록 보유를 적는다', async () => {
    mockState(
      { total: 10_000_000, positions: [h('KRW', 0, 0), h('A', 5_000_000, 5), h('B', 5_000_000, 5), h('HALT', 0, 10)] },
      { total: 5_000_000, positions: [h('KRW', 0, 0), h('B', 5_000_000, 5), h('HALT', 0, 12)] },
    );
    const r = await checkAndTriggerDrawdownKillSwitch(10);
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
    expect(inserted()).toHaveLength(1);
    expect(String(sendAlert.mock.calls[0][2])).toContain('가치 미기록 보유 [HALT]');
  });

  test('M-2: 대금이 USD 행으로 들어오고 원화가 같은 만큼 출금돼 순변화가 0 이어도 발동한다', async () => {
    // T-056: 기준선에 "확인된 USD 0" 행을 둔다 — 신형 대 신형 비교에서 USD 증가가 거래 정황이라는 것이 M-2 의 계약이다.
    //        기준선에 USD 행 자체가 없는 전환 구간은 전환 규칙 E 가 양쪽에서 USD 를 빼므로 아래 "전환 구간" 테스트가 따로 고정한다.
    mockState(
      { total: 10_000_000, positions: [p('KRW', 3_000_000), p('USD', 0), p('A', 4_000_000), p('B', 3_000_000)] },
      { total: 6_000_000, positions: [p('KRW', 200_000), p('USD', 2_800_000), p('B', 3_000_000)] },
    );
    const r = await checkAndTriggerDrawdownKillSwitch(10);
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
    expect(inserted()).toHaveLength(1);
    expect(sendAlertThrottled).not.toHaveBeenCalled();
    expect(String(sendAlert.mock.calls[0][2])).toContain('거래 정황(현금 유입·신규 보유·추가 매수 2,800,000원)');
  });

  test('M-2 전환 구간(T-056): 기준선이 구형(USD 행 없음)이면 E 가 USD 를 양쪽에서 빼지만 이 사건은 여전히 발동한다', async () => {
    // E 적용 후: 기준 10M(USD 없음) vs 현재 6M − 2.8M = 3.2M, 소실 A 4M 미설명 → 보정 기준 6M 대비 -46.7% → 발동.
    // 거래 정황(USD 유입)은 E 가 지웠으므로 사유는 "설명되지 않는 소실 포함" 쪽으로 적힌다.
    mockState(
      { total: 10_000_000, positions: [p('KRW', 3_000_000), p('A', 4_000_000), p('B', 3_000_000)] },
      { total: 6_000_000, positions: [p('KRW', 200_000), p('USD', 2_800_000), p('B', 3_000_000)] },
    );
    const r = await checkAndTriggerDrawdownKillSwitch(10);
    expect(r).toMatchObject({ status: 'evaluated', triggered: true, usdSymmetricRemoval: true });
    expect(inserted()).toHaveLength(1);
    expect(sendAlertThrottled).not.toHaveBeenCalled();
    const body = String(sendAlert.mock.calls[0][2]);
    expect(body).toContain('전환 규칙 E');
    expect(body).toContain('보유 소실 [A]');
  });

  test('M-2 대조: 현금 유입이 전혀 없고 보유만 사라지면 보류 — 10-03 사고 형태', async () => {
    mockState(
      { total: 10_000_000, positions: [p('KRW', 3_000_000), p('A', 4_000_000), p('B', 3_000_000)] },
      { total: 6_000_000, positions: [p('KRW', 3_000_000), p('B', 3_000_000)] },
    );
    const r = await checkAndTriggerDrawdownKillSwitch(10);
    expect(r).toMatchObject({ status: 'skipped', reason: 'composition_change_suspected' });
    expect(inserted()).toHaveLength(0);
  });
});
