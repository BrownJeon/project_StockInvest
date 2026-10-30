/**
 * T-080 — 킬스위치 판정 흐름의 ③-c(가려진 USD 이월) 회귀 시험. 풀·알림 모킹(격리 DB 없음).
 *
 * 픽스처는 **비율 단위**(기준선 총액 = 100)이고 종목 코드는 자리표시자다. 실제 금액·종목·수량을 쓰지 않는다.
 *
 * 직전 스냅샷 조회 모킹은 `ts < 기준 시각` 만 걸러 돌려준다 — 20시간 하한은 **일부러 걸지 않는다**.
 * 창 하한은 `assessHiddenUsdCarry` 가 다시 거르므로, 이 시험이 그 재검사를 함께 고정한다.
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
// (L-1) 가려짐 판별이 던지는 경우를 만들기 위한 감싸기 — 기본 동작은 실제 함수 그대로
jest.mock('@/lib/safety/hidden-usd-carry', () => {
  const actual = jest.requireActual('@/lib/safety/hidden-usd-carry');
  return { ...actual, hasHiddenUsdRow: jest.fn(actual.hasHiddenUsdRow) };
});
const query = jest.fn();
jest.mock('@/lib/db', () => ({ getPool: () => ({ query: (...a: unknown[]) => query(...a) }) }));

import { checkAndTriggerDrawdownKillSwitch } from '@/lib/safety/kill-switch';
import * as carryModule from '@/lib/safety/hidden-usd-carry';

const HOUR = 60 * 60_000;
type Pos = { currency: string; qty: unknown; price: number; value_krw: number };
const pos = (currency: string, value: number): Pos => ({ currency, qty: 1, price: value, value_krw: value });
const usd = (qty: number, price = 2): Pos => ({ currency: 'USD', qty, price, value_krw: qty * price });

interface Row { ts: Date; total: number; positions: unknown }
interface State { baseline: Row; current: Row; priors?: Row[]; historyError?: Error; currentTs?: boolean }

const HISTORY_RE = /INTERVAL \? HOUR/;

function mockState(s: State) {
  checkSnapshotFreshness.mockResolvedValue({
    latestTs: s.current.ts, ageMs: 5 * 60_000, level: 'ok', session: 'open', effectiveAgeMs: 5 * 60_000,
  });
  query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/SELECT value FROM system_config/.test(sql) && params[0] === 'safety_kill_switch') return [[{ value: 'false' }]];
    if (/INSERT INTO system_config/.test(sql)) return [{ affectedRows: 1 }];
    if (/ORDER BY ABS\(TIMESTAMPDIFF/.test(sql)) {
      return [[{ total_krw: s.baseline.total, positions: s.baseline.positions, ts: s.baseline.ts }]];
    }
    if (HISTORY_RE.test(sql)) {
      if (s.historyError) throw s.historyError;
      const before = (params[0] as Date).getTime();
      const limit = Number(params[3]);
      const rows = (s.priors ?? [])
        .filter(r => r.ts.getTime() < before)
        .sort((a, b) => b.ts.getTime() - a.ts.getTime())
        .slice(0, limit)
        .map(r => ({ ts: r.ts, total_krw: r.total, positions: r.positions }));
      return [rows];
    }
    if (/ORDER BY ts DESC/.test(sql)) {
      const row: Record<string, unknown> = { total_krw: s.current.total, positions: s.current.positions };
      if (s.currentTs !== false) row.ts = s.current.ts;
      return [[row]];
    }
    return [[]];
  });
}
const inserted = () => query.mock.calls.filter(c => /INSERT INTO system_config/.test(String(c[0])));
const historyCalls = () => query.mock.calls.filter(c => HISTORY_RE.test(String(c[0])));
const run = async (s: State) => { mockState(s); return checkAndTriggerDrawdownKillSwitch(10); };

const now = () => Date.now();
const BASE_TS = () => new Date(now() - 24 * HOUR);
const CUR_TS = () => new Date(now() - 5 * 60_000);

/** 10-23 사건 비율 재현 — 기준선·현재 모두 USD qty 0, 그 사이 KRW→USD 환전 + 국내 매도 */
function incident(opts: { usFactor?: number; basePrior?: boolean; curPrior?: boolean } = {}): State {
  const f = opts.usFactor ?? 1;
  const bTs = BASE_TS(), cTs = CUR_TS();
  const baseline: Row = { ts: bTs, total: 100, positions: [pos('KRW', 9.3), usd(0), pos('US1', 40), pos('US2', 36.5), pos('DOM1', 14.2)] };
  const curUs1 = 39 * f, curUs2 = 35.2 * f;
  const current: Row = { ts: cTs, total: 13.7 + curUs1 + curUs2, positions: [pos('KRW', 13.7), usd(0), pos('US1', curUs1), pos('US2', curUs2)] };
  const priors: Row[] = [];
  if (opts.basePrior !== false) {
    priors.push({ ts: new Date(bTs.getTime() - 16.5 * HOUR), total: 100, positions: JSON.stringify([pos('KRW', 9.3), usd(1.1), pos('US1', 40.5), pos('US2', 36), pos('DOM1', 14)]) });
  }
  priors.push({ ts: new Date(bTs.getTime() - 4 * HOUR), total: 97.8, positions: JSON.stringify([pos('KRW', 9.3), usd(0), pos('US1', 40), pos('US2', 36.5), pos('DOM1', 14.2)]) });
  if (opts.curPrior !== false) {
    priors.push({ ts: new Date(cTs.getTime() - 8.3 * HOUR), total: 99, positions: JSON.stringify([pos('KRW', 3), usd(5.7), pos('US1', 39.5), pos('US2', 35.6), pos('DOM1', 14.2)]) });
  }
  priors.push({ ts: new Date(cTs.getTime() - 2 * HOUR), total: 87.9, positions: JSON.stringify([pos('KRW', 13.7), usd(0), pos('US1', 39), pos('US2', 35.2)]) });
  return { baseline, current, priors };
}

/** 시간대 비대칭 — 기준선 USD 보임(11.4), 현재 가려짐. usFactor 로 미국 보유 변동. */
function asymmetric(opts: { usFactor?: number; priorAgoH?: number; usd?: number; us?: number; krw?: number } = {}): State {
  const usdQty = opts.usd ?? 5.7, us = opts.us ?? 76.5, krw = opts.krw ?? 12.1;
  const f = opts.usFactor ?? 1;
  const bTs = BASE_TS(), cTs = CUR_TS();
  return {
    baseline: { ts: bTs, total: krw + usdQty * 2 + us, positions: [pos('KRW', krw), usd(usdQty), pos('US1', us)] },
    current: { ts: cTs, total: krw + us * f, positions: [pos('KRW', krw), usd(0), pos('US1', us * f)] },
    priors: [{ ts: new Date(cTs.getTime() - (opts.priorAgoH ?? 10) * HOUR), total: 100, positions: [pos('KRW', krw), usd(usdQty), pos('US1', us)] }],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  sendAlertThrottled.mockReset();   // 알림 예외 시험의 mockImplementation 이 다음 시험으로 새지 않게
  sendAlert.mockReset();
  delete process.env.KILL_SWITCH;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('수용 기준 1 — 10-23 사건 합성 재현', () => {
  test('🔴 이월 근거가 없으면(= 현 코드와 같은 입력·같은 경로) 원시 -12.1% 로 발동한다', async () => {
    const r = await run(incident({ basePrior: false, curPrior: false }));
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
    expect((r as { drawdownPct: number }).drawdownPct).toBeCloseTo(-12.1, 6);
    expect(inserted()).toHaveLength(1);
  });

  test('🔴 수정 후: 양쪽 가려짐 대칭 이월 → 보정 약 -2.8% → 보류 + critical 알림, 발동 없음', async () => {
    const r = await run(incident());
    expect(r).toMatchObject({ status: 'skipped', reason: 'hidden_usd_carry_suspected' });
    expect(inserted()).toHaveLength(0);
    expect(sendAlert).not.toHaveBeenCalled();
    expect(sendAlertThrottled).toHaveBeenCalledTimes(1);
    const [key, level, title, body, ttl] = sendAlertThrottled.mock.calls[0];
    expect(level).toBe('critical');
    expect(String(key)).toMatch(/^kill-switch:hidden-usd-carry:baseline=\d+,current=\d+$/);
    expect(String(title)).toContain('USD');
    expect(String(body)).toContain('원시 24h 손실률 -12.1%');
    expect(String(body)).toContain('보정 손실률 -2.8%');
    expect(String(body)).toContain('기준선(마지막으로 보인 시각');
    expect(String(body)).toContain('현재(마지막으로 보인 시각');
    expect(String(body)).toContain('실제 손실이라면 설정 > 안전장치에서 모든거래차단을 수동으로 켜세요.');
    expect(ttl).toBe(12 * HOUR);
    expect(String((r as { detail?: string }).detail)).toContain('-2.8%');
  });

  test('기준선 쪽 양수 값이 없으면 현재만 이월하지 않는다(비대칭 보정 금지) → 발동, 사유에 이월 불가', async () => {
    const r = await run(incident({ basePrior: false }));
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
    expect(String(sendAlert.mock.calls[0][2])).toContain('이월 불가');
  });
});

describe('시간대 비대칭', () => {
  test('🔴 기준선 USD 보임·현재 가려짐, 보합 → 원시 -11.4% · 보정 0% → 보류', async () => {
    const r = await run(asymmetric());
    expect(r).toMatchObject({ status: 'skipped', reason: 'hidden_usd_carry_suspected' });
    expect(inserted()).toHaveLength(0);
    expect(String(sendAlertThrottled.mock.calls[0][3])).toContain('원시 24h 손실률 -11.4%');
    expect(String(sendAlertThrottled.mock.calls[0][3])).toContain('보정 손실률 0.0%');
    expect(String(sendAlertThrottled.mock.calls[0][0])).toMatch(/^kill-switch:hidden-usd-carry:current=\d+$/);
  });
});

describe('수용 기준 2 — 실제 하락은 발동', () => {
  test('🔴 미국 보유 -12% + 현재 USD 가려짐 → 보정 후 -9.2% (모호 구간) → 발동, 사유에 보정 병기', async () => {
    const r = await run(asymmetric({ usFactor: 0.88 }));
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
    expect(inserted()).toHaveLength(1);
    const msg = String(sendAlert.mock.calls[0][2]);
    expect(msg).toContain('이월 보정 시 -9.2%');
    expect(msg).toContain('발동');
  });

  test('🔴 10-23 모양 + 미국 보유 -12% → 보정 후 -10% 초과 → 발동', async () => {
    const r = await run(incident({ usFactor: 0.88 }));
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
    expect(inserted()).toHaveLength(1);
  });

  test('모호 구간: 보정 -7% → 발동', async () => {
    // 기준선 KRW 10 + USD 10 + US 80 = 100, 현재 US 73 → 원시 -17%, 보정 -7%
    const r = await run(asymmetric({ usd: 5, us: 80, krw: 10, usFactor: 73 / 80 }));
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
    expect(String(sendAlert.mock.calls[0][2])).toContain('이월 보정 시 -7.0%');
  });

  test('🔴 경계: 보정 정확히 -5.0% → 발동 (보류는 엄격히 얕을 때만)', async () => {
    const r = await run(asymmetric({ usd: 5, us: 80, krw: 10, usFactor: 75 / 80 }));
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
    expect(inserted()).toHaveLength(1);
  });

  test('경계 바로 안: 보정 -4.9% → 보류', async () => {
    const r = await run(asymmetric({ usd: 5, us: 80, krw: 10, usFactor: 75.1 / 80 }));
    expect(r).toMatchObject({ status: 'skipped', reason: 'hidden_usd_carry_suspected' });
  });
});

describe('이월 불가 → 기존대로 발동', () => {
  test('🔴 직전 양수 값이 20시간 넘게 전(21h) → 이월 안 함 → 발동', async () => {
    const r = await run(asymmetric({ priorAgoH: 21 }));
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
    expect(String(sendAlert.mock.calls[0][2])).toContain('이월 불가');
  });

  test('직전 20시간 안에 가려진 행만 있음 → 발동', async () => {
    const s = asymmetric();
    s.priors = [{ ts: new Date(s.current.ts.getTime() - 3 * HOUR), total: 88.6, positions: [usd(0)] }];
    expect(await run(s)).toMatchObject({ status: 'evaluated', triggered: true });
  });

  test('직전 양수 값은 있으나 현재 USD 가 qty>0(둘 다 보임) → no-op: 조회도 안 하고 기존대로 발동', async () => {
    const s = asymmetric({ usFactor: 0.85 });
    (s.current.positions as Pos[])[1] = usd(5.7);
    s.current.total += 11.4;
    const r = await run(s);
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
    expect(historyCalls()).toHaveLength(0);
    expect(String(sendAlert.mock.calls[0][2])).not.toContain('USD 가려짐');
  });
});

describe('기존 경로 불변', () => {
  test('🔴 규칙 E 적용(한쪽 USD 행 부재) → 새 단계 건너뜀 — 조회 없음, 기존 발동', async () => {
    const bTs = BASE_TS(), cTs = CUR_TS();
    const r = await run({
      baseline: { ts: bTs, total: 100, positions: [pos('KRW', 10), pos('US1', 90)] },
      current: { ts: cTs, total: 85, positions: [pos('KRW', 10), usd(0), pos('US1', 75)] },
      priors: [{ ts: new Date(cTs.getTime() - 3 * HOUR), total: 100, positions: [usd(50)] }],
    });
    expect(r).toMatchObject({ status: 'evaluated', triggered: true, usdSymmetricRemoval: true });
    expect(historyCalls()).toHaveLength(0);
  });

  test('USD 행 양쪽 부재 → 조회 없음, 기존 발동', async () => {
    const r = await run({
      baseline: { ts: BASE_TS(), total: 100, positions: [pos('KRW', 10), pos('US1', 90)] },
      current: { ts: CUR_TS(), total: 85, positions: [pos('KRW', 10), pos('US1', 75)] },
    });
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
    expect(historyCalls()).toHaveLength(0);
  });

  test('발동 후보가 아니면(손실 미달) 가려짐이 있어도 아무것도 하지 않는다', async () => {
    const s = asymmetric({ usd: 1 });   // USD 2 가려짐 → 원시 약 -2%
    const r = await run(s);
    expect(r).toMatchObject({ status: 'evaluated', triggered: false });
    expect(historyCalls()).toHaveLength(0);
    expect(sendAlertThrottled).not.toHaveBeenCalled();
  });

  test('직전 스냅샷 조회는 기준선·현재 시각을 파라미터로 바인딩하고 쓰기를 하지 않는다', async () => {
    const s = incident();
    await run(s);
    const calls = historyCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).toEqual([s.baseline.ts, s.baseline.ts, 20, 48]);
    expect(calls[1][1]).toEqual([s.current.ts, s.current.ts, 20, 48]);
    for (const c of calls) {
      const sql = String(c[0]).replace(/\s+/g, ' ').trim();
      // (M10) 정렬·창·상한이 바뀌면 "가장 최근 양수 값" 의미가 깨진다 — SQL 문자열을 고정한다
      expect(sql).toBe('SELECT ts, total_krw, positions FROM portfolio_snapshots WHERE ts < ? AND ts >= DATE_SUB(?, INTERVAL ? HOUR) ORDER BY ts DESC LIMIT ?');
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE)\b/i);
    }
  });
});

describe('예외 경로 → 발동 (검증 불가는 발동 쪽)', () => {
  test('🔴 직전 스냅샷 조회 예외 → 보정 없이 발동, 사유에 점검 실패', async () => {
    const s = incident();
    s.historyError = new Error('db down');
    const r = await run(s);
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
    expect(inserted()).toHaveLength(1);
    expect(String(sendAlert.mock.calls[0][2])).toContain('USD 가려짐 점검 실패(보정 없이 발동)');
  });

  test('🔴 기준선 positions JSON 깨짐 → 발동', async () => {
    const s = incident();
    s.baseline.positions = '{{not json';
    const r = await run(s);
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
    expect(inserted()).toHaveLength(1);
  });

  test('직전 스냅샷 positions JSON 깨짐(유일한 양수 근거) → 발동', async () => {
    const s = asymmetric();
    s.priors = [{ ts: new Date(s.current.ts.getTime() - 3 * HOUR), total: 100, positions: '{{not json' }];
    expect(await run(s)).toMatchObject({ status: 'evaluated', triggered: true });
  });

  test('현재 스냅샷 시각을 읽을 수 없음 → 발동', async () => {
    const s = incident();
    s.currentTs = false;
    const r = await run(s);
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
    expect(String(sendAlert.mock.calls[0][2])).toContain('점검 실패');
  });

  test('🔴 (L-1) 가려짐 판별 자체가 던져도 ③-c 의 try 안이라 발동 쪽 — 함수 수준 catch(skipped error)로 새지 않는다', async () => {
    (carryModule.hasHiddenUsdRow as jest.Mock).mockImplementationOnce(() => { throw new Error('boom'); });
    const r = await run(incident());
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
    expect(inserted()).toHaveLength(1);
    expect(String(sendAlert.mock.calls[0][2])).toContain('USD 가려짐 점검 실패');
  });

  test('🔴 보류 알림 전송이 던져도 판정 불변(보류) — 발동으로 뒤집히지 않는다', async () => {
    sendAlertThrottled.mockImplementation(() => { throw new Error('telegram down'); });
    const r = await run(incident());
    expect(r).toMatchObject({ status: 'skipped', reason: 'hidden_usd_carry_suspected' });
    expect(inserted()).toHaveLength(0);
  });
});

describe('(M-1) Reviewer 재현 — 가려진 동안 USD 전액으로 매수한 뒤 보유 하락은 발동한다', () => {
  // 기준선: KRW 12.1 + USD 11.4(보임) + US1 76.5 = 100. 가려진 동안 USD 전액으로 매수 → 현재 USD 진짜 0(qty 0).
  function spent(f: number, how: 'new' | 'add'): State {
    const bTs = BASE_TS(), cTs = CUR_TS();
    const holdings: Pos[] = how === 'new'
      ? [pos('US1', 76.5 * f), pos('NEW1', 11.4 * f)]
      : [{ currency: 'US1', qty: 1.149, price: (87.9 * f) / 1.149, value_krw: 87.9 * f }];
    return {
      baseline: { ts: bTs, total: 100, positions: [pos('KRW', 12.1), usd(5.7), pos('US1', 76.5)] },
      current: { ts: cTs, total: 12.1 + holdings.reduce((a, p) => a + p.value_krw, 0), positions: [pos('KRW', 12.1), usd(0), ...holdings] },
      priors: [{ ts: new Date(cTs.getTime() - 10 * HOUR), total: 100, positions: [pos('KRW', 12.1), usd(5.7), pos('US1', 76.5)] }],
    };
  }

  test.each([[0.87, '−13%'], [0.84, '−16%'], [0.80, '−20%']])('🔴 신규 종목 매수 후 보유 %p(%s) → 발동, 사유에 hidden_purchase_evidence', async (f) => {
    const r = await run(spent(f, 'new'));
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
    expect(inserted()).toHaveLength(1);
    expect(sendAlertThrottled).not.toHaveBeenCalled();
    expect(String(sendAlert.mock.calls[0][2])).toContain('hidden_purchase_evidence');
  });

  test.each([[0.87], [0.84]])('🔴 기존 종목 추가 매수 후 보유 ×%p → 발동', async (f) => {
    const r = await run(spent(f, 'add'));
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
    expect(inserted()).toHaveLength(1);
  });
});

describe('(M-2) 이상 환율 — 가려진 행 가격이 근거 행 대비 범위 밖이면 발동', () => {
  function fx(hPrice: number): State {
    const s = asymmetric();
    (s.current.positions as Pos[])[1] = usd(0, hPrice);
    return s;
  }
  test.each([[20], [0.2], [1.58], [2.52]])('🔴 가격 %p (근거 행 2) → 발동, 사유에 hidden_no_price_out_of_band', async (hp) => {
    const r = await run(fx(hp));
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
    expect(String(sendAlert.mock.calls[0][2])).toContain('hidden_no_price_out_of_band');
  });
  test.each([[1.6], [2.5]])('경계 가격 %p (×0.8·×1.25 포함) → 이월 → 보류', async (hp) => {
    expect(await run(fx(hp))).toMatchObject({ status: 'skipped', reason: 'hidden_usd_carry_suspected' });
  });
});

describe('(Codex high) 왕복 거래 — 중간 행의 매수 정황은 발동', () => {
  function roundTrip(mid: unknown): State {
    const s = asymmetric();   // 기준선 USD 보임, 현재 가려짐, 직전 양수 행 10h 전
    s.priors!.push({ ts: new Date(s.current.ts.getTime() - 5 * HOUR), total: 100, positions: mid });
    return s;
  }
  test('🔴 S 에 없던 종목을 중간 행에서 보유했다가 H 전에 매도 → 발동, 사유에 hidden_purchase_evidence', async () => {
    const r = await run(roundTrip([pos('KRW', 12.1), usd(0), pos('US1', 76.5), pos('NEW1', 10)]));
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
    expect(inserted()).toHaveLength(1);
    expect(sendAlertThrottled).not.toHaveBeenCalled();
    expect(String(sendAlert.mock.calls[0][2])).toContain('hidden_purchase_evidence');
    expect(String(sendAlert.mock.calls[0][2])).toContain('NEW1');
  });
  test('🔴 기존 종목 수량이 중간 행에서만 증가 → 발동', async () => {
    const r = await run(roundTrip([pos('KRW', 12.1), usd(0), { currency: 'US1', qty: 1.2, price: 70, value_krw: 84 }]));
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
  });
  test('🔴 중간 행 JSON 깨짐 → 발동, 사유에 hidden_purchase_evidence_unreadable', async () => {
    const r = await run(roundTrip('{{not json'));
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
    expect(String(sendAlert.mock.calls[0][2])).toContain('hidden_purchase_evidence_unreadable');
  });
  test('중간 행 보유 동일 → 보류(대조)', async () => {
    expect(await run(roundTrip([pos('KRW', 12.1), usd(0), pos('US1', 77)]))).toMatchObject({ status: 'skipped', reason: 'hidden_usd_carry_suspected' });
  });
});
