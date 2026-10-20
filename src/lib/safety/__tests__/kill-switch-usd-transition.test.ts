/**
 * T-056 — 킬스위치 전환 규칙 E(USD 행 대칭 제거) 회귀 시험. 설계 재검산 표(task T-056 `[23:40]`)의 S1~S10.
 *
 * E: 기준선·현재 중 **한쪽이라도 USD 행이 없으면 양쪽에서 USD 행과 값을 빼고** 총액·구성을 비교한다. 둘 다 있으면 그대로.
 *
 * 값: 운영 최신 행 모양(국내 2 + 해외 3 + KRW 80,138)과 2026-10-20 실측 USD 368.51 USD(= 490,892원). 임계 10%.
 * "거짓 발동" = 총자산 실손실 10% 미만인데 발동, "은폐" = 실손실 10% 이상인데 미발동.
 */
const sendAlert = jest.fn();
const sendAlertThrottled = jest.fn();
const checkSnapshotFreshness = jest.fn();

jest.mock('@/lib/notify', () => ({ sendAlert: (...a: unknown[]) => sendAlert(...a) }));
jest.mock('@/lib/notify/throttle', () => ({
  sendAlertThrottled: (...a: unknown[]) => sendAlertThrottled(...a),
  resetAlertThrottle: () => {},
}));
jest.mock('@/lib/safety/volatility-guard', () => ({
  checkSnapshotFreshness: (...a: unknown[]) => checkSnapshotFreshness(...a),
}));
const query = jest.fn();
jest.mock('@/lib/db', () => ({ getPool: () => ({ query: (...a: unknown[]) => query(...a) }) }));

import { checkAndTriggerDrawdownKillSwitch, applyUsdSymmetricRemoval } from '@/lib/safety/kill-switch';

const HOUR = 60 * 60_000;
type P = { currency: string; qty: number; price: number; value_krw: number };
const p = (currency: string, value_krw: number): P => ({ currency, qty: 1, price: value_krw, value_krw });
const sum = (ps: P[]) => ps.reduce((s, x) => s + x.value_krw, 0);
const snap = (ps: P[]) => ({ total: sum(ps), positions: ps });

function mockState(baseline: { total: number; positions: unknown }, current: { total: number; positions: unknown }) {
  checkSnapshotFreshness.mockResolvedValue({
    latestTs: new Date(Date.now() - 5 * 60_000), ageMs: 5 * 60_000, level: 'ok', session: 'open', effectiveAgeMs: 5 * 60_000,
  });
  query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/SELECT value FROM system_config/.test(sql) && params[0] === 'safety_kill_switch') return [[{ value: 'false' }]];
    if (/INSERT INTO system_config/.test(sql)) return [{ affectedRows: 1 }];
    if (/ORDER BY ABS\(TIMESTAMPDIFF/.test(sql)) return [[{ total_krw: baseline.total, positions: baseline.positions, ts: new Date(Date.now() - 24 * HOUR) }]];
    if (/ORDER BY ts DESC/.test(sql)) return [[{ total_krw: current.total, positions: current.positions }]];
    return [[]];
  });
}
const inserted = () => query.mock.calls.filter(c => /INSERT INTO system_config/.test(String(c[0])));
const run = async (b: P[], c: P[]) => { mockState(snap(b), snap(c)); return checkAndTriggerDrawdownKillSwitch(10); };

// ── 포트폴리오 (운영 모양) ───────────────────────────────────────────────
const KRW = 80_138;
const USD0 = 490_892;                         // 실측 368.51 USD × 1332.1
const DOM = [p('000660', 1_800_000), p('005930', 1_515_500)];
const MU = 13_350_000;
const REST_OVS = [p('NAS:SMH', 3_150_000), p('NYS:ORCL', 1_050_000)];
const HOLD = [...DOM, p('NAS:MU', MU), ...REST_OVS];
const scale = (ps: P[], f: number) => ps.map(x => p(x.currency, Math.round(x.value_krw * f)));

const OLD = (holdings: P[] = HOLD, krw = KRW): P[] => [p('KRW', krw), ...holdings];                    // 구형: USD 행 없음
const NEW = (usd: number, holdings: P[] = HOLD, krw = KRW): P[] => [p('KRW', krw), p('USD', usd), ...holdings];
const withoutMu = (ps: P[]) => ps.filter(x => x.currency !== 'NAS:MU');

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.KILL_SWITCH;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('applyUsdSymmetricRemoval — 규칙 자체', () => {
  test('둘 다 USD 행 있음 → 아무것도 하지 않는다', () => {
    const b = NEW(USD0), c = NEW(USD0 + MU, withoutMu(HOLD));
    const r = applyUsdSymmetricRemoval(sum(b), sum(c), b, c);
    expect(r).toMatchObject({ applied: false, baselineKRW: sum(b), currentKRW: sum(c) });
    expect(r.curPositions).toBe(c);
  });

  test('둘 다 없음 → 아무것도 하지 않는다 (배포 전 운영 동작 그대로)', () => {
    const b = OLD(), c = OLD();
    expect(applyUsdSymmetricRemoval(sum(b), sum(c), b, c).applied).toBe(false);
  });

  test('🔴 한쪽만 있음 → 양쪽 모두에서 USD 행과 값을 뺀다 (총액과 구성이 같은 집합)', () => {
    const b = OLD(), c = NEW(USD0);
    const r = applyUsdSymmetricRemoval(sum(b), sum(c), b, c);
    expect(r.applied).toBe(true);
    expect(r.baselineKRW).toBe(sum(b));
    expect(r.currentKRW).toBe(sum(c) - USD0);
    expect(r.curPositions!.some(x => x.currency === 'USD')).toBe(false);
    expect(sum(r.curPositions as P[])).toBe(r.currentKRW);
    // 반대 방향(S8)
    const r2 = applyUsdSymmetricRemoval(sum(c), sum(b), c, b);
    expect(r2).toMatchObject({ applied: true, baselineKRW: sum(c) - USD0, currentKRW: sum(b), removedBaseUsdKRW: USD0, removedCurUsdKRW: 0 });
  });

  test('positions 를 읽을 수 없는 쪽이 있으면 적용하지 않는다 (USD 유무를 모름 — 기존 총액 비교)', () => {
    const c = NEW(USD0);
    expect(applyUsdSymmetricRemoval(1, sum(c), null, c).applied).toBe(false);
    expect(applyUsdSymmetricRemoval(sum(c), 1, c, null).applied).toBe(false);
  });

  test('🔴 현재값을 *올리는* 방향으로는 절대 쓰이지 않는다 (빼기만 한다)', () => {
    for (const [b, c] of [[OLD(), NEW(USD0)], [NEW(USD0), OLD()], [OLD(), NEW(0)]] as [P[], P[]][]) {
      const r = applyUsdSymmetricRemoval(sum(b), sum(c), b, c);
      expect(r.currentKRW).toBeLessThanOrEqual(sum(c));
      expect(r.baselineKRW).toBeLessThanOrEqual(sum(b));
    }
  });
});

describe('S1~S10 — 설계 재검산 표 회귀', () => {
  test('S1 10-03 현행(양쪽 구형, 대금 미관측) → 보류 + critical (현행 T-041 동작 그대로, E 미적용)', async () => {
    const base = OLD([...DOM, p('NAS:SNPS', 15_266_065), p('NAS:SMH', 1_710_000), p('NYS:ORCL', 1_150_000)]);
    const cur = OLD([...DOM, p('NYS:ORCL', 1_150_000)]);
    const r = await run(base, cur);
    expect(r).toMatchObject({ status: 'skipped', reason: 'composition_change_suspected' });
    expect(r).not.toHaveProperty('usdSymmetricRemoval');
    expect(inserted()).toHaveLength(0);
    expect(sendAlertThrottled.mock.calls[0][1]).toBe('critical');
  });

  test('S2 10-03 + 대금이 USD 행에 반영(양쪽 신형) → 미발동 (오발동 원인 자체가 없어짐)', async () => {
    const sold = 15_266_065 + 1_710_000;
    const base = NEW(370_000, [...DOM, p('NAS:SNPS', 15_266_065), p('NAS:SMH', 1_710_000), p('NYS:ORCL', 1_150_000)]);
    const cur = NEW(370_000 + sold, [...DOM, p('NYS:ORCL', 1_150_000)]);
    expect(await run(base, cur)).toMatchObject({ status: 'evaluated', triggered: false });
    expect(inserted()).toHaveLength(0);
  });

  test('S3 신형 MU 매도(대금 USD) → 미발동', async () => {
    expect(await run(NEW(USD0), NEW(USD0 + MU, withoutMu(HOLD)))).toMatchObject({ status: 'evaluated', triggered: false });
  });

  test('🔴 S4 신형 뒤 USD 행 누락(MU 매도로 USD 13.84M) → E 로 미발동 (보정 없으면 -64% 거짓 발동)', async () => {
    const r = await run(NEW(USD0 + MU, withoutMu(HOLD)), OLD(withoutMu(HOLD)));
    expect(r).toMatchObject({ status: 'evaluated', triggered: false, usdSymmetricRemoval: true });
    expect((r as { drawdownPct: number }).drawdownPct).toBeCloseTo(0, 6);
    expect(inserted()).toHaveLength(0);
  });

  test('S4b USD 를 0 으로 잘못 기록(KIS 가 0 을 줌) → 발동 — 잔여 위험(실제 전액 출금과 구별 불가, 주문 정지 쪽)', async () => {
    const r = await run(NEW(USD0 + MU, withoutMu(HOLD)), NEW(0, withoutMu(HOLD)));
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
    expect(r).not.toHaveProperty('usdSymmetricRemoval');
  });

  test('S5 결제기준 필드(대금 T+1, 양쪽 신형) → 보류 + critical (현행과 같은 모양 — 필드 실측으로 해소할 일)', async () => {
    const r = await run(NEW(USD0), NEW(USD0, withoutMu(HOLD)));
    expect(r).toMatchObject({ status: 'skipped', reason: 'composition_change_suspected' });
    expect(inserted()).toHaveLength(0);
  });

  test('🔴 S6 전환(기준선 구형), 보유 -11% → 발동 (보정 없으면 -8.6% 로 은폐)', async () => {
    const r = await run(OLD(), NEW(USD0, scale(HOLD, 0.89)));
    expect(r).toMatchObject({ status: 'evaluated', triggered: true, usdSymmetricRemoval: true });
    expect((r as { drawdownPct: number }).drawdownPct).toBeLessThan(-10);
    expect(String(sendAlert.mock.calls[0][2])).toContain('전환 규칙 E');
  });

  test('S6c 전환, 손실 없음 → 미발동', async () => {
    expect(await run(OLD(), NEW(USD0))).toMatchObject({ status: 'evaluated', triggered: false, usdSymmetricRemoval: true });
  });

  test('🔴 S7 전환 중 정상 MU 매도(USD 증가) → 보류 + critical, **발동 아님** (원설계 C1-1 거짓 발동 차단)', async () => {
    const r = await run(OLD(), NEW(USD0 + MU, withoutMu(HOLD)));
    expect(r).toMatchObject({ status: 'skipped', reason: 'composition_change_suspected' });
    expect(inserted()).toHaveLength(0);
    expect(sendAlertThrottled).toHaveBeenCalledTimes(1);
    expect(String((r as { detail?: string }).detail)).toContain('전환 규칙 E');
  });

  test('S7b 전환 중 매도 + 남은 보유 -15% → 발동 (보수 방향 — 현행 T-041 과 같은 동작)', async () => {
    const r = await run(OLD(), NEW(USD0 + MU, scale(withoutMu(HOLD), 0.85)));
    expect(r).toMatchObject({ status: 'evaluated', triggered: true, usdSymmetricRemoval: true });
  });

  test('S7c 전환 중 매도 + 남은 보유 -5% → 보류 + critical (거짓 경보, 발동 아님)', async () => {
    const r = await run(OLD(), NEW(USD0 + MU, scale(withoutMu(HOLD), 0.95)));
    expect(r).toMatchObject({ status: 'skipped', reason: 'composition_change_suspected' });
    expect(inserted()).toHaveLength(0);
  });

  test('S7d 전환 후(기준선 신형) 매도 → 미발동, E 미적용', async () => {
    const r = await run(NEW(USD0), NEW(USD0 + MU, withoutMu(HOLD)));
    expect(r).toMatchObject({ status: 'evaluated', triggered: false });
    expect(r).not.toHaveProperty('usdSymmetricRemoval');
  });

  test('🔴 S8 기준 신형(USD 13.84M), 현재 USD 행 없음(비활성·롤백) → 미발동 (보정 없으면 -66% 거짓 발동)', async () => {
    const r = await run(NEW(USD0 + MU, withoutMu(HOLD)), OLD(withoutMu(HOLD)));
    expect(r).toMatchObject({ status: 'evaluated', triggered: false, usdSymmetricRemoval: true });
  });

  test('S8b 같은 상황 + 보유 -15% → 발동', async () => {
    const r = await run(NEW(USD0 + MU, withoutMu(HOLD)), OLD(scale(withoutMu(HOLD), 0.85)));
    expect(r).toMatchObject({ status: 'evaluated', triggered: true, usdSymmetricRemoval: true });
  });

  test('S9 전환 중 기존 USD 로 신규 매수 + 보유 -8% → 미발동 (임계 미만 구간, 은폐 폭 수 %p — 현행과 같음)', async () => {
    const cur = NEW(USD0 - 400_000, [...scale(HOLD, 0.92), p('NAS:NEW', 400_000)]);
    const r = await run(OLD(), cur);
    expect(r).toMatchObject({ status: 'evaluated', triggered: false, usdSymmetricRemoval: true });
  });

  test('S10 배포 직전 매도(기준선 = 매도 전 구형 행, 현재 = 대금 든 첫 신형 행) → 보류 + critical (오염 개념 없음)', async () => {
    const sold = MU + 3_150_000;
    const base = OLD();
    const cur = NEW(USD0 + sold, [...DOM, p('NYS:ORCL', 1_050_000)]);
    const r = await run(base, cur);
    expect(r).toMatchObject({ status: 'skipped', reason: 'composition_change_suspected' });
    expect(inserted()).toHaveLength(0);
  });
});

describe('T-041 조합 — 구성 가드와의 상호작용', () => {
  test('매도 + USD 유입(양쪽 신형, 정상) → 보류도 발동도 아님(미달)', async () => {
    expect(await run(NEW(USD0), NEW(USD0 + MU, withoutMu(HOLD)))).toMatchObject({ status: 'evaluated', triggered: false });
    expect(sendAlertThrottled).not.toHaveBeenCalled();
  });

  test('순수 소실 + USD 불변(양쪽 신형) → 보류 + critical', async () => {
    expect(await run(NEW(USD0), NEW(USD0, withoutMu(HOLD)))).toMatchObject({ status: 'skipped', reason: 'composition_change_suspected' });
  });

  test('소실 + USD 환율 먼지(±0.3%, 소실액의 3% 이내) → 순수 소실로 유지(보류)', async () => {
    expect(await run(NEW(USD0), NEW(Math.round(USD0 * 1.003), withoutMu(HOLD)))).toMatchObject({ status: 'skipped', reason: 'composition_change_suspected' });
  });

  test('🔴 USD 행 0 → X 증가는 거래 정황으로 잡힌다(양쪽 신형) — 소실 + 남은 보유 급락이면 발동', async () => {
    // 기준 USD 0, 현재 USD 가 소실액의 3% 를 넘게 증가 → 순수 소실 아님 → 총액 기준 발동
    const r = await run(NEW(0), NEW(1_000_000, scale(withoutMu(HOLD), 0.5)));
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
    expect(String(sendAlert.mock.calls[0][2])).toContain('거래 정황');
  });
});

describe('라운드 2 (Reviewer R-12, 변이 M50) — E 적용 뒤 기준선이 0 이하면 검사를 건너뛴다', () => {
  // 기준선이 전부 USD 인(비현실적) 신형 행 + 현재 USD 행 없음 → E 가 양쪽에서 USD 를 빼면 기준선 0.
  // 가드가 없으면 (현재 − 0)/0 = +Infinity(현재 > 0) 또는 NaN(현재 0) 이 되고, NaN 은 임계 비교를 통과해 발동 경로로 넘어간다.
  test('🔴 현재 > 0 → skipped(baseline_invalid), 0 나눗셈 결과(Infinity)를 평가로 내지 않는다', async () => {
    const r = await run([p('KRW', 0), p('USD', 1_000_000)], [p('KRW', 500_000)]);
    expect(r).toMatchObject({ status: 'skipped', reason: 'baseline_invalid' });
    expect(String((r as { detail?: string }).detail)).toContain('USD 제외 후 기준 자본 0원');
    expect(inserted()).toHaveLength(0);
  });

  test('🔴 현재도 0 → skipped(baseline_invalid), NaN 이 발동으로 새지 않는다 (INSERT·발동 알림 없음)', async () => {
    const r = await run([p('KRW', 0), p('USD', 1_000_000)], [p('KRW', 0)]);
    expect(r).toMatchObject({ status: 'skipped', reason: 'baseline_invalid' });
    expect(inserted()).toHaveLength(0);
    expect(sendAlert).not.toHaveBeenCalled();
  });

  test('대조: E 를 적용하지 않는 경우(양쪽 신형)에는 같은 기준선이 유효하다 — 가드는 E 적용 뒤에만 걸린다', async () => {
    const r = await run([p('KRW', 0), p('USD', 1_000_000)], [p('KRW', 0), p('USD', 990_000)]);
    expect(r).toMatchObject({ status: 'evaluated', triggered: false });
  });
});
