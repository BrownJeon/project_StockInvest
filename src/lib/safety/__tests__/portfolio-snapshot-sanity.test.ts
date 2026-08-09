/**
 * T-012 — `price=0` 스냅샷이 안전장치 기준값을 오염시키는 문제.
 *
 * `portfolio_snapshots.total_krw` 는 킬스위치 24h 기준선·변동성 가드·주문한도(pct)의
 * 입력값이다. 아래 페이로드는 **운영 DB 실측값**(id=3558, 2026-08-09 15:45 KST)을 그대로
 * 옮긴 것으로, 74% 비중인 `NAS:SNPS` 가 시세 조회 실패로 0원 평가되어 총액이 18,375,740 →
 * 4,828,256 으로 조용히 축소된 행이다. 당시 24h median 대비 ratio 는 0.263 이라 ±5배
 * 밴드(임계 0.200)를 **통과**했다 — 그래서 밴드가 아니라 보유 항목 자체를 봐야 한다.
 */
const sendAlert = jest.fn();
jest.mock('@/lib/notify', () => ({ sendAlert: (...a: unknown[]) => sendAlert(...a) }));

const query = jest.fn();
jest.mock('@/lib/db', () => ({ getPool: () => ({ query: (...a: unknown[]) => query(...a) }) }));

import {
  savePortfolioSnapshot,
  validateSnapshotPositions,
  checkHoldingVanished,
  checkSnapshotFreshness,
  reportSnapshotBlindness,
  resetSnapshotRejectThrottle,
  clearZeroPriceAllowlistCache,
  type SnapshotPosition,
  type PrevSnapshot,
} from '@/lib/safety/volatility-guard';

// ─── 실측 페이로드 ────────────────────────────────────────────────────────────

/** id=3558 실측 — NAS:SNPS(보유 23주)가 price=0 으로 기록된 오염 행. */
const CORRUPT: SnapshotPosition[] = [
  { currency: 'KRW',      qty: 78218, price: 1,          value_krw: 78218 },
  { currency: '000660',   qty: 3,     price: 474_000,    value_krw: 1_422_000 },
  { currency: '005930',   qty: 30,    price: 69_300,     value_krw: 2_079_000 },
  { currency: 'NYS:ORCL', qty: 6,     price: 208_173,    value_krw: 1_249_038 },
  { currency: 'NAS:SNPS', qty: 23,    price: 0,          value_krw: 0 },
];
const CORRUPT_TOTAL = 4_828_256;

/** id=3559 실측 — 1초 뒤 같은 계좌의 정상 행. */
const HEALTHY: SnapshotPosition[] = [
  ...CORRUPT.slice(0, 4),
  { currency: 'NAS:SNPS', qty: 23, price: 588_999.3043478261, value_krw: 13_547_484 },
];
const HEALTHY_TOTAL = 18_375_740;

function mockDb(opts: {
  median?: number | null;
  prev?: { ts: Date; total_krw: number; positions: unknown } | null;
  /** MAX(ts) — 실명 감시기가 보는 값 */
  latestTs?: Date | null;
  /** system_config.snapshot_zero_price_symbols */
  allowZero?: string[];
} = {}) {
  query.mockImplementation(async (sql: string) => {
    if (/INSERT INTO portfolio_snapshots/.test(sql)) return [{ affectedRows: 1 }];
    if (/snapshot_zero_price_symbols/.test(sql)) {
      return [opts.allowZero == null ? [] : [{ value: JSON.stringify(opts.allowZero) }]];
    }
    if (/MAX\(ts\)/.test(sql)) {
      return [[{ latest: opts.latestTs === undefined ? new Date() : opts.latestTs }]];
    }
    if (/INTERVAL 24 HOUR/.test(sql)) {
      return [opts.median == null ? [] : [{ total_krw: opts.median }]];
    }
    if (/ORDER BY ts DESC LIMIT 1/.test(sql)) {
      return [opts.prev == null ? [] : [opts.prev]];
    }
    return [[]];
  });
}

const inserts = (): unknown[][] =>
  query.mock.calls.filter((c) => /INSERT INTO portfolio_snapshots/.test(String(c[0])));

beforeEach(() => {
  jest.clearAllMocks();
  resetSnapshotRejectThrottle();
  clearZeroPriceAllowlistCache();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

// ─── 1. 보유 항목 무결성 ──────────────────────────────────────────────────────

describe('validateSnapshotPositions — qty>0 인데 price=0 이면 거부', () => {
  test('🔴 실측 id=3558 오염 페이로드를 거부한다 (NAS:SNPS price=0)', () => {
    const r = validateSnapshotPositions(CORRUPT_TOTAL, CORRUPT);
    expect(r?.code).toBe('position_price_zero');
    expect(r?.detail).toContain('NAS:SNPS');
  });

  test('정상 페이로드는 통과한다', () => {
    expect(validateSnapshotPositions(HEALTHY_TOTAL, HEALTHY)).toBeNull();
  });

  test('qty=0 이면 price=0 이어도 통과한다 (예수금 0 등 정상 상태)', () => {
    const pos: SnapshotPosition[] = [
      { currency: 'KRW', qty: 0, price: 1, value_krw: 0 },
      { currency: 'USD', qty: 0, price: 0, value_krw: 0 },
      { currency: '005930', qty: 30, price: 69_300, value_krw: 2_079_000 },
    ];
    expect(validateSnapshotPositions(2_079_000, pos)).toBeNull();
  });

  test('price 가 NaN 이면 malformed 로 거부한다 (KIS 빈 응답 → Number(undefined))', () => {
    const pos: SnapshotPosition[] = [
      { currency: '005930', qty: 30, price: Number.NaN, value_krw: 0 },
    ];
    expect(validateSnapshotPositions(1000, pos)?.code).toBe('position_malformed');
  });

  test('price 가 음수여도 거부한다', () => {
    const pos: SnapshotPosition[] = [
      { currency: '005930', qty: 30, price: -1, value_krw: 0 },
    ];
    expect(validateSnapshotPositions(1000, pos)?.code).toBe('position_price_zero');
  });

  test('Σvalue_krw 와 total 이 어긋나면 거부한다 (총액과 근거가 다른 집합)', () => {
    // 항목 자체는 전부 정상인데 총액만 정상 행의 값 — 종목이 조용히 빠진 뒤 총액만
    // 다른 경로로 계산된 상황을 잡는다.
    const partial = HEALTHY.slice(0, 4);   // Σ = 4,828,256
    expect(validateSnapshotPositions(HEALTHY_TOTAL, partial)?.code).toBe('total_mismatch');
  });

  test('반올림 수준의 미세 오차는 허용한다', () => {
    expect(validateSnapshotPositions(HEALTHY_TOTAL + 0.4, HEALTHY)).toBeNull();
  });

  test('value_krw 음수는 거부한다', () => {
    const pos: SnapshotPosition[] = [
      { currency: 'KRW', qty: 1000, price: 1, value_krw: -1000 },
    ];
    expect(validateSnapshotPositions(1000, pos)?.code).toBe('position_malformed');
  });

  test('빈 positions 는 거부한다 (총액만 있고 근거가 없는 행)', () => {
    expect(validateSnapshotPositions(1_000_000, [])?.code).toBe('position_malformed');
  });
});

// ─── 2. 구성 소실 검사 ────────────────────────────────────────────────────────

const prevOf = (positions: SnapshotPosition[], total: number, ageMin = 1): PrevSnapshot => ({
  ts: new Date(Date.now() - ageMin * 60_000),
  totalKRW: total,
  positions,
});

describe('checkHoldingVanished — 종목이 현금 이동 없이 사라지면 거부', () => {
  const NOW = Date.now();

  test('🔴 74% 종목이 통째로 빠지고 총액도 그만큼 증발 → 거부', () => {
    // cron 의 avgPrice 폴백조차 못 쓴 경우 positions 에서 종목 자체가 빠진다 (0원 항목도 없음)
    const now = HEALTHY.slice(0, 4);
    const r = checkHoldingVanished(CORRUPT_TOTAL, now, prevOf(HEALTHY, HEALTHY_TOTAL), NOW);
    expect(r?.code).toBe('holding_vanished');
    expect(r?.detail).toContain('NAS:SNPS');
  });

  test('✅ 매도 — 종목은 사라지지만 대금이 현금으로 들어와 총액이 보존되면 통과', () => {
    const now: SnapshotPosition[] = [
      { currency: 'KRW', qty: 13_625_702, price: 1, value_krw: 13_625_702 },
      ...HEALTHY.slice(1, 4),
    ];
    expect(checkHoldingVanished(HEALTHY_TOTAL, now, prevOf(HEALTHY, HEALTHY_TOTAL), NOW)).toBeNull();
  });

  test('✅ 실제 폭락 -30% — 종목은 그대로 있고 단가만 내리면 통과', () => {
    const now = HEALTHY.map((p) =>
      p.currency === 'KRW'
        ? p
        : { ...p, price: p.price * 0.7, value_krw: p.value_krw * 0.7 },
    );
    const total = now.reduce((s, p) => s + p.value_krw, 0);
    expect(checkHoldingVanished(total, now, prevOf(HEALTHY, HEALTHY_TOTAL), NOW)).toBeNull();
  });

  test('✅ 출금 — 현금만 줄어드는 경우 통과 (현금은 소실 판정 대상이 아님)', () => {
    const now: SnapshotPosition[] = [
      { currency: 'KRW', qty: 0, price: 1, value_krw: 0 },
      ...HEALTHY.slice(1),
    ];
    expect(checkHoldingVanished(HEALTHY_TOTAL - 78_218, now, prevOf(HEALTHY, HEALTHY_TOTAL), NOW)).toBeNull();
  });

  test('✅ 입금 — 총액이 늘면 통과', () => {
    const now: SnapshotPosition[] = [
      { currency: 'KRW', qty: 10_078_218, price: 1, value_krw: 10_078_218 },
      ...HEALTHY.slice(1),
    ];
    expect(checkHoldingVanished(HEALTHY_TOTAL + 10_000_000, now, prevOf(HEALTHY, HEALTHY_TOTAL), NOW)).toBeNull();
  });

  test('✅ 소액 종목(<10%) 소실은 판정하지 않는다', () => {
    const now = HEALTHY.filter((p) => p.currency !== 'NYS:ORCL');   // 1,249,038 = 6.8%
    expect(checkHoldingVanished(HEALTHY_TOTAL - 1_249_038, now, prevOf(HEALTHY, HEALTHY_TOTAL), NOW)).toBeNull();
  });

  test('✅ 릴리스 밸브 — 직전 스냅샷이 3시간을 넘으면 검사하지 않는다 (영구 기아 방지)', () => {
    const now = HEALTHY.slice(0, 4);
    const stale = prevOf(HEALTHY, HEALTHY_TOTAL, 3 * 60 + 1);
    expect(checkHoldingVanished(CORRUPT_TOTAL, now, stale, NOW)).toBeNull();
  });

  test('0원으로 남은 항목도 "사라진 것"으로 본다 (price=0 검사를 못 거친 경로 대비)', () => {
    const r = checkHoldingVanished(CORRUPT_TOTAL, CORRUPT, prevOf(HEALTHY, HEALTHY_TOTAL), NOW);
    expect(r?.code).toBe('holding_vanished');
  });

  /**
   * 실측 회귀 — id=3459 (2026-08-04 14:24 KST).
   *
   * `kis.getBalances()` 는 `dom.getBalances()` 실패를 `.catch(() => [])` 로 삼킨다(kis.ts:30).
   * 그래서 국내 쪽이 통째로 빠진 잔고가 "정상 응답"처럼 반환되고, 한 tick 동안 KRW 예수금 +
   * 000660 + 005930 이 전부 사라진 채 총액이 -20% 로 기록된다. 다음 tick(=id 3460)에는
   * 그대로 돌아온다 — 즉 계좌 변화가 아니라 조회 실패다.
   *
   * **이 유형에는 `price=0` 항목이 존재하지 않는다.** 1단(보유 항목 검사)으로는 절대 못 잡고,
   * ±5배 밴드(-20% → ratio 0.79)도 통과한다. 최근 30일에만 14건 발생했고 전부 킬스위치
   * 24h 기준선을 오염시켰다.
   */
  test('🔴 실측 id=3459 — 국내 잔고 조회 실패로 KRW·000660·005930 이 한 tick 사라진 행을 거부', () => {
    const before: SnapshotPosition[] = [
      { currency: 'KRW',      qty: 78218, price: 1,       value_krw: 78218 },
      { currency: '000660',   qty: 5,     price: 317_550, value_krw: 1_587_750 },
      { currency: '005930',   qty: 25,    price: 80_000,  value_krw: 2_000_000 },
      { currency: 'NYS:ORCL', qty: 6,     price: 208_173, value_krw: 1_249_038 },
      { currency: 'NAS:SNPS', qty: 23,    price: 558_654, value_krw: 12_834_105 },
    ];
    const beforeTotal = 17_749_111;
    const after = before.slice(3);                    // 국내 쪽(현금 포함)이 통째로 빠짐
    const afterTotal = 14_083_143;

    // 1단(보유 항목)으로는 못 잡는다 — 남은 항목은 전부 정상이다
    expect(validateSnapshotPositions(afterTotal, after)).toBeNull();
    // 3단(±5배 밴드)도 통과한다 — ratio 0.79
    expect(afterTotal / beforeTotal).toBeGreaterThan(1 / 5);
    // 4단이 잡는다
    const r = checkHoldingVanished(afterTotal, after, prevOf(before, beforeTotal, 66), NOW);
    expect(r?.code).toBe('holding_vanished');
    expect(r?.detail).toContain('000660');
    expect(r?.detail).toContain('005930');
  });
});

// ─── 3. savePortfolioSnapshot 통합 ────────────────────────────────────────────

describe('savePortfolioSnapshot — 오염 스냅샷은 INSERT 되지 않는다', () => {
  test('🔴 실측 오염 행은 24h median 밴드를 통과해도 저장되지 않는다', async () => {
    // 당시 median=18,375,740, ratio=0.263 > 임계 0.200 → 기존 가드로는 통과하던 값
    mockDb({ median: HEALTHY_TOTAL, prev: null });
    await savePortfolioSnapshot(CORRUPT_TOTAL, CORRUPT, 'dashboard');
    expect(inserts()).toHaveLength(0);
    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect(String(sendAlert.mock.calls[0][2])).toContain('position_price_zero');
  });

  test('정상 스냅샷은 저장된다', async () => {
    mockDb({
      median: HEALTHY_TOTAL,
      prev: { ts: new Date(Date.now() - 60_000), total_krw: HEALTHY_TOTAL, positions: JSON.stringify(HEALTHY) },
    });
    await savePortfolioSnapshot(HEALTHY_TOTAL, HEALTHY, 'hourly');
    const ins = inserts();
    expect(ins).toHaveLength(1);
    expect(ins[0][1]).toEqual([HEALTHY_TOTAL, JSON.stringify(HEALTHY), 'hourly']);
    expect(sendAlert).not.toHaveBeenCalled();
  });

  test('종목 소실 유형도 저장되지 않는다 (positions 에 0원 항목조차 없는 경우)', async () => {
    const now = HEALTHY.slice(0, 4);
    mockDb({
      median: HEALTHY_TOTAL,
      prev: { ts: new Date(Date.now() - 60_000), total_krw: HEALTHY_TOTAL, positions: JSON.stringify(HEALTHY) },
    });
    await savePortfolioSnapshot(CORRUPT_TOTAL, now, 'hourly');
    expect(inserts()).toHaveLength(0);
    expect(String(sendAlert.mock.calls[0][2])).toContain('holding_vanished');
  });

  test('기존 절대 밴드 회귀 — 1억원 초과는 여전히 거부', async () => {
    const pos: SnapshotPosition[] = [{ currency: 'KRW', qty: 2e8, price: 1, value_krw: 2e8 }];
    mockDb({ median: HEALTHY_TOTAL, prev: null });
    await savePortfolioSnapshot(2e8, pos, 'hourly');
    expect(inserts()).toHaveLength(0);
    expect(String(sendAlert.mock.calls[0][2])).toContain('abs_band');
  });

  test('기존 median 밴드 회귀 — 24h median 대비 1/5 미만은 여전히 거부', async () => {
    const pos: SnapshotPosition[] = [{ currency: 'KRW', qty: 100_000, price: 1, value_krw: 100_000 }];
    mockDb({ median: HEALTHY_TOTAL, prev: null });
    await savePortfolioSnapshot(100_000, pos, 'dashboard');
    expect(inserts()).toHaveLength(0);
    expect(String(sendAlert.mock.calls[0][2])).toContain('median_band');
  });

  test('total<=0 이면 DB 를 건드리지 않는다', async () => {
    mockDb({ median: HEALTHY_TOTAL, prev: null });
    await savePortfolioSnapshot(0, HEALTHY, 'hourly');
    await savePortfolioSnapshot(Number.NaN, HEALTHY, 'hourly');
    expect(query).not.toHaveBeenCalled();
  });

  test('알림은 사유별로 스로틀된다 — 대시보드가 30초마다 저장해도 폭주하지 않는다', async () => {
    mockDb({ median: HEALTHY_TOTAL, prev: null });
    for (let i = 0; i < 5; i++) await savePortfolioSnapshot(CORRUPT_TOTAL, CORRUPT, 'dashboard');
    expect(inserts()).toHaveLength(0);
    expect(sendAlert).toHaveBeenCalledTimes(1);
  });

  test('🔴 거부 사유에 조치 방법(allowlist)이 안내된다 — 무한 실명 탈출구', async () => {
    mockDb({ median: HEALTHY_TOTAL, prev: null });
    await savePortfolioSnapshot(CORRUPT_TOTAL, CORRUPT, 'dashboard');
    expect(String(sendAlert.mock.calls[0][2])).toContain('snapshot_zero_price_symbols');
  });

  test('직전 스냅샷 조회가 실패해도 저장 자체는 막지 않는다', async () => {
    query.mockImplementation(async (sql: string) => {
      if (/INSERT INTO portfolio_snapshots/.test(sql)) return [{ affectedRows: 1 }];
      if (/INTERVAL 24 HOUR/.test(sql)) return [[{ total_krw: HEALTHY_TOTAL }]];
      if (/ORDER BY ts DESC LIMIT 1/.test(sql)) throw new Error('db down');
      return [[]];
    });
    await savePortfolioSnapshot(HEALTHY_TOTAL, HEALTHY, 'hourly');
    expect(inserts()).toHaveLength(1);
  });
});

// ─── 4. 무한 실명 방지 (reviewer HIGH 1) ──────────────────────────────────────

/**
 * 1단은 `qty>0 && price<=0` 을 무조건 거부한다. 거래정지·상장폐지로 단가가 *정말* 0인 종목이
 * 생기면 그 거부가 영원히 계속되고, 킬스위치의 "현재값"과 "기준선"이 정지 직전 값에 얼어붙어
 * **실제 폭락을 은폐**한다 — 데이터 위조가 아니라 관측 중단으로 같은 결과에 도달한다.
 *
 * 자동 시간 밸브를 두지 않은 이유: 밸브는 N시간 뒤 "보유 종목을 0원으로 본 총액"을 승인한다는
 * 뜻인데, 그 0원이 조회 실패였다면 -74% 총액이 킬스위치에 들어가 전 매매를 오정지시킨다.
 * 밸브는 정지/상폐와 조회 실패를 구분할 수 없다. 대신 **사람의 판단을 기록으로 남기는**
 * allowlist 를 탈출구로 두고, 실명이 길어지면 경보를 승격한다.
 */
describe('무한 실명 방지 — allowlist 탈출구', () => {
  const HALTED: SnapshotPosition[] = [
    { currency: 'KRW',    qty: 78218, price: 1,       value_krw: 78218 },
    { currency: '005930', qty: 30,    price: 69_300,  value_krw: 2_079_000 },
    { currency: 'NAS:DEAD', qty: 10,  price: 0,       value_krw: 0 },   // 상장폐지 가정
  ];
  const HALTED_TOTAL = 78_218 + 2_079_000;

  test('allowlist 없으면 거부 (기본 동작은 여전히 엄격하다)', () => {
    expect(validateSnapshotPositions(HALTED_TOTAL, HALTED)?.code).toBe('position_price_zero');
  });

  test('🔴 allowlist 에 있으면 0원을 정상으로 인정해 저장이 재개된다', () => {
    expect(validateSnapshotPositions(HALTED_TOTAL, HALTED, new Set(['NAS:DEAD']))).toBeNull();
  });

  test('allowlist 는 해당 심볼에만 적용된다 (다른 종목의 0원은 계속 거부)', () => {
    const two = [...HALTED, { currency: 'NAS:SNPS', qty: 23, price: 0, value_krw: 0 }];
    const r = validateSnapshotPositions(HALTED_TOTAL, two, new Set(['NAS:DEAD']));
    expect(r?.code).toBe('position_price_zero');
    expect(r?.detail).toContain('NAS:SNPS');
  });

  test('allowlist 종목은 4단 소실 판정에서도 제외된다 (등록 후 3시간 대기 불필요)', () => {
    const before: SnapshotPosition[] = [
      { currency: 'KRW',      qty: 78218, price: 1,      value_krw: 78218 },
      { currency: '005930',   qty: 30,    price: 69_300, value_krw: 2_079_000 },
      { currency: 'NAS:DEAD', qty: 10,    price: 90_000, value_krw: 900_000 },
    ];
    const prev: PrevSnapshot = { ts: new Date(Date.now() - 60_000), totalKRW: 3_057_218, positions: before };
    // allowlist 없으면 소실로 잡힌다
    expect(checkHoldingVanished(HALTED_TOTAL, HALTED, prev, Date.now())?.code).toBe('holding_vanished');
    // allowlist 에 넣으면 "진짜 0원이 된 것"으로 인정
    expect(checkHoldingVanished(HALTED_TOTAL, HALTED, prev, Date.now(), new Set(['NAS:DEAD']))).toBeNull();
  });

  test('savePortfolioSnapshot 이 system_config allowlist 를 읽어 적용한다', async () => {
    mockDb({ median: HALTED_TOTAL, prev: null, allowZero: ['NAS:DEAD'] });
    await savePortfolioSnapshot(HALTED_TOTAL, HALTED, 'hourly');
    expect(inserts()).toHaveLength(1);
  });

  test('allowlist 조회 실패는 엄격한 쪽으로 폴백한다 (fail-safe)', async () => {
    query.mockImplementation(async (sql: string) => {
      if (/snapshot_zero_price_symbols/.test(sql)) throw new Error('db down');
      if (/INSERT INTO portfolio_snapshots/.test(sql)) return [{ affectedRows: 1 }];
      if (/MAX\(ts\)/.test(sql)) return [[{ latest: new Date() }]];
      return [[]];
    });
    await savePortfolioSnapshot(HALTED_TOTAL, HALTED, 'hourly');
    expect(inserts()).toHaveLength(0);
  });
});

describe('무한 실명 방지 — 관측 공백 승격 경보', () => {
  const ago = (min: number) => new Date(Date.now() - min * 60_000);

  test('최신 스냅샷이 최근이면 ok', async () => {
    mockDb({ latestTs: ago(10) });
    expect((await checkSnapshotFreshness()).level).toBe('ok');
  });

  test('90분(cron 1주기) 경과면 warn', async () => {
    mockDb({ latestTs: ago(95) });
    expect((await checkSnapshotFreshness()).level).toBe('warn');
  });

  test('🔴 3시간 경과면 critical — 킬스위치 기준선 조회창(폭 2시간)이 통째로 빌 수 있다', async () => {
    mockDb({ latestTs: ago(200) });
    expect((await checkSnapshotFreshness()).level).toBe('critical');
  });

  test('스냅샷이 한 건도 없으면 unknown (부트스트랩)', async () => {
    mockDb({ latestTs: null });
    expect((await checkSnapshotFreshness()).level).toBe('unknown');
  });

  test('🔴 실명이 3시간을 넘으면 critical 경보 + 조치 대상 심볼과 방법을 알린다', async () => {
    mockDb({ latestTs: ago(250) });
    await reportSnapshotBlindness('position_price_zero: NAS:DEAD', 'hourly');
    const critical = sendAlert.mock.calls.filter(c => c[0] === 'critical');
    expect(critical).toHaveLength(1);
    expect(String(critical[0][2])).toContain('NAS:DEAD');
    expect(String(critical[0][2])).toContain('snapshot_zero_price_symbols');
    expect(String(critical[0][1])).toContain('4시간');
  });

  test('critical 경보는 재알림 간격 안에서 반복되지 않는다 (6시간 실명에 알림 폭주 방지)', async () => {
    mockDb({ latestTs: ago(250) });
    for (let i = 0; i < 5; i++) await reportSnapshotBlindness('blocked', 'hourly');
    expect(sendAlert.mock.calls.filter(c => c[0] === 'critical')).toHaveLength(1);
  });

  test('🔴 저장이 재개되면 회복 알림이 나간다 (사람이 따로 확인하지 않아도 됨)', async () => {
    mockDb({ latestTs: ago(250) });
    await reportSnapshotBlindness('blocked', 'hourly');
    expect(sendAlert.mock.calls.filter(c => c[0] === 'critical')).toHaveLength(1);

    mockDb({ median: HEALTHY_TOTAL, prev: null, latestTs: ago(1) });
    await savePortfolioSnapshot(HEALTHY_TOTAL, HEALTHY, 'hourly');
    expect(inserts()).toHaveLength(1);
    const info = sendAlert.mock.calls.filter(c => c[0] === 'info');
    expect(info).toHaveLength(1);
    expect(String(info[0][1])).toContain('정상화');
  });

  test('critical 을 낸 적 없으면 회복 알림도 없다', async () => {
    mockDb({ median: HEALTHY_TOTAL, prev: null, latestTs: ago(1) });
    await savePortfolioSnapshot(HEALTHY_TOTAL, HEALTHY, 'hourly');
    expect(sendAlert.mock.calls.filter(c => c[0] === 'info')).toHaveLength(0);
  });

  test('sanity 거부가 실명 감시기를 호출한다 (거부가 길어지면 스스로 승격)', async () => {
    mockDb({ median: HEALTHY_TOTAL, prev: null, latestTs: ago(250) });
    await savePortfolioSnapshot(CORRUPT_TOTAL, CORRUPT, 'dashboard');
    await new Promise(r => setImmediate(r));   // rejectSnapshot 내부 void promise 소진
    expect(sendAlert.mock.calls.filter(c => c[0] === 'critical')).toHaveLength(1);
  });
});
