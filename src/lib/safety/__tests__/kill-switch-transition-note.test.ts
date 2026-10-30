/**
 * T-056 라운드 3 (Reviewer R-5) — 전환 구간(E 적용) 보류 알림의 **USD 포함 기록상 총액 변화** 병기.
 *
 * 왜: E 가 적용되면 알림 수치는 USD 를 양쪽에서 뺀 값이라, 전환 24h 안 해외 손절(기록상 -16.8%)이 "같은 조건 비교 0.0%"로만
 * 보였다. 문구 맨 앞에 기록상 변화율·금액과 "전환 24h 한정" 을 밝힌다. **판정·반환값은 그대로**(문구 전용).
 *
 * 🔴 안전 이유: 이 문구는 구성 판정(④) try 블록 안에서 조립되고, 그 블록의 예외는 "검증 불가 → 발동"이다. 문구 코드가 던지면
 * 보류가 거짓 발동으로 뒤집힌다 — 그래서 `transitionRawNote` 는 어떤 입력에서도 던지지 않고 비유한 값은 `n/a` 로 적는다.
 */
const sendAlert = jest.fn();
const sendAlertThrottled = jest.fn();
const checkSnapshotFreshness = jest.fn();
jest.mock('@/lib/notify', () => ({ sendAlert: (...a: unknown[]) => sendAlert(...a) }));
jest.mock('@/lib/notify/throttle', () => ({ sendAlertThrottled: (...a: unknown[]) => sendAlertThrottled(...a), resetAlertThrottle: () => {} }));
jest.mock('@/lib/safety/volatility-guard', () => ({ checkSnapshotFreshness: (...a: unknown[]) => checkSnapshotFreshness(...a) }));
const query = jest.fn();
jest.mock('@/lib/db', () => ({ getPool: () => ({ query: (...a: unknown[]) => query(...a) }) }));

import { checkAndTriggerDrawdownKillSwitch, transitionRawNote } from '@/lib/safety/kill-switch';

type P = { currency: string; qty: number; price: number; value_krw: number };
const p = (currency: string, value_krw: number): P => ({ currency, qty: 1, price: value_krw, value_krw });
const sum = (ps: P[]) => ps.reduce((s, x) => s + x.value_krw, 0);

function mockState(base: P[], cur: P[], curTotal: unknown = sum(cur)) {
  checkSnapshotFreshness.mockResolvedValue({ latestTs: new Date(Date.now() - 300_000), ageMs: 300_000, level: 'ok', session: 'open', effectiveAgeMs: 300_000 });
  query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/SELECT value FROM system_config/.test(sql) && params[0] === 'safety_kill_switch') return [[{ value: 'false' }]];
    if (/INSERT INTO system_config/.test(sql)) return [{ affectedRows: 1 }];
    if (/ORDER BY ABS\(TIMESTAMPDIFF/.test(sql)) return [[{ total_krw: sum(base), positions: JSON.stringify(base), ts: new Date(Date.now() - 24 * 3600_000) }]];
    if (/ORDER BY ts DESC/.test(sql)) return [[{ total_krw: curTotal, positions: JSON.stringify(cur) }]];
    return [[]];
  });
}
const inserted = () => query.mock.calls.filter(c => /INSERT INTO system_config/.test(String(c[0])));
const body = () => String(sendAlertThrottled.mock.calls[0]?.[3] ?? '');

// 운영 모양 (kill-switch-usd-transition.test.ts 와 같은 값)
const KRW = 80_138, USD0 = 490_892, MU = 13_350_000;
const REST = [p('000660', 1_800_000), p('005930', 1_515_500), p('NAS:SMH', 3_150_000), p('NYS:ORCL', 1_050_000)];
const OLD = [p('KRW', KRW), p('NAS:MU', MU), ...REST];                                         // 구형(USD 행 없음) 20,945,638
const curAfterSale = (proceeds: number) => [p('KRW', KRW), p('USD', USD0 + proceeds), ...REST];

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.KILL_SWITCH;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('(a) 정상 입력 — 문구 요소', () => {
  test('🔴 전환 24h 해외 손절(MU -30% 매도, 기록상 -16.8%): 판정은 보류 그대로, 문구 맨 앞에 기록상 변화율·금액·전환 표시', async () => {
    const cur = curAfterSale(Math.round(MU * 0.7));                 // 17,431,530
    mockState(OLD, cur);
    const r = await checkAndTriggerDrawdownKillSwitch(10);
    expect(r).toMatchObject({ status: 'skipped', reason: 'composition_change_suspected' });   // 판정 불변
    expect(inserted()).toHaveLength(0);
    const b = body();
    expect(b.startsWith('기록상(USD 포함) 24h -16.8% (-3,514,108원) — 전환 24h 한정 비교')).toBe(true);
    expect(b).toContain('같은 조건 비교는 0.0%');                     // USD 를 뺀 비교 수치도 남는다(두 변화율)
    expect(b).toContain('전환 규칙 E');
    expect(b).toContain('**실제 손실이라면 설정 > 안전장치에서 모든거래차단을 수동으로 켜세요.**');
    expect(b).not.toMatch(/NaN|Infinity/);
  });

  test('반환값 detail 은 바뀌지 않는다 — 새 줄은 알림 본문에만 있다', async () => {
    mockState(OLD, curAfterSale(MU));
    const r = await checkAndTriggerDrawdownKillSwitch(10) as { detail?: string };
    expect(r.detail).not.toContain('기록상(USD 포함)');
    expect(r.detail!.startsWith('24h ')).toBe(true);
    expect(body()).toContain(`${r.detail}.`);                         // 기존 본문은 그대로 이어진다
  });

  test('total_krw 가 숫자 문자열(mysql DECIMAL)로 와도 같은 문구', async () => {
    const cur = curAfterSale(MU);                                     // 21,436,530 → +2.3%
    mockState(OLD, cur, String(sum(cur)));
    const r = await checkAndTriggerDrawdownKillSwitch(10);
    expect(r).toMatchObject({ status: 'skipped', reason: 'composition_change_suspected' });
    expect(body()).toContain('기록상(USD 포함) 24h 2.3% (490,892원)');
  });
});

describe('(b) transitionRawNote — 어떤 입력에서도 던지지 않고 NaN/Infinity 를 찍지 않는다', () => {
  const weird: unknown[] = [0, -1, NaN, Infinity, -Infinity, null, undefined, '', '  ', 'abc', '1e3', '0x10', {}, [], true,
    { toString() { throw new Error('boom'); }, valueOf() { throw new Error('boom'); } }, Symbol('s'), BigInt(5)];
  test.each(weird.map(v => [String(typeof v === 'symbol' ? 'symbol' : typeof v === 'bigint' ? 'bigint' : JSON.stringify(v) ?? String(v)), v]))(
    '기준선이 %s → 던지지 않음, n/a', (_n, v) => {
      let s = '';
      expect(() => { s = transitionRawNote(true, v, 21_000_000); }).not.toThrow();
      expect(s).toContain('n/a');
      expect(s).not.toMatch(/NaN|Infinity/);
      expect(s).toContain('전환 24h 한정 비교');
    });
  test.each(weird.filter(v => v !== 0 && v !== -1).map(v => [String(typeof v === 'symbol' ? 'symbol' : typeof v === 'bigint' ? 'bigint' : JSON.stringify(v) ?? String(v)), v]))(
    '현재 total_krw 가 %s → 던지지 않음, n/a', (_n, v) => {
      let s = '';
      expect(() => { s = transitionRawNote(true, 20_000_000, v); }).not.toThrow();
      expect(s).toContain('n/a');
      expect(s).not.toMatch(/NaN|Infinity/);
    });
  test('정상 값 → 변화율·금액', () => {
    expect(transitionRawNote(true, 20_000_000, '17000000')).toContain('-15.0% (-3,000,000원)');
    expect(transitionRawNote(true, 20_000_000, 0)).toContain('-100.0% (-20,000,000원)');   // 확인된 0 은 0 (n/a 아님)
  });
});

describe('(c) E 미적용(신형 대 신형·구형 대 구형)에서는 문구가 바뀌지 않는다', () => {
  test('transitionRawNote(applied=false) 는 빈 문자열', () => {
    expect(transitionRawNote(false, 20_000_000, 17_000_000)).toBe('');
    expect(transitionRawNote(false, NaN, 'abc')).toBe('');
  });

  test('신형 대 신형 보류(S5, 대금 미관측) → 본문이 기존 형식 "24h …" 로 시작, 새 줄 없음', async () => {
    const base = [p('KRW', KRW), p('USD', USD0), p('NAS:MU', MU), ...REST];
    const cur = [p('KRW', KRW), p('USD', USD0), ...REST];
    mockState(base, cur);
    const r = await checkAndTriggerDrawdownKillSwitch(10);
    expect(r).toMatchObject({ status: 'skipped', reason: 'composition_change_suspected' });
    expect(body().startsWith('24h ')).toBe(true);
    expect(body()).not.toContain('기록상(USD 포함)');
    expect(body()).not.toContain('전환 24h 한정');
  });

  test('구형 대 구형 보류(10-03 형태) → 새 줄 없음', async () => {
    mockState(OLD, [p('KRW', KRW), ...REST]);
    const r = await checkAndTriggerDrawdownKillSwitch(10);
    expect(r).toMatchObject({ status: 'skipped', reason: 'composition_change_suspected' });
    expect(body().startsWith('24h ')).toBe(true);
  });
});
