/**
 * T-062 WP-U — 가이드 G10 fixture: `GET /api/signals` 응답 `data` (서버 순서 = created_at DESC).
 *
 * 목록 API 가 실제로 주는 모양을 흉내 낸다: `indicators` 는 일부 행이 **JSON 문자열**(G1),
 * `amount_krw` 는 DECIMAL 문자열 `"100000.00"`. 화면 시각 기준은 2026-10-21 08:30 KST.
 * 실 DB 에 쓰지 않는다 — 시험·QA 캡처에서 네트워크 응답 대체용으로만 쓴다.
 *
 * 장면 4(해외 카드가 적을 때) = id 106·103·102·101 만, Q-g(폴백) = 106 에서 `price_zone_usd` 제거.
 */

export const T062_NOW_ISO = '2026-10-20T23:30:00.000Z'; // = 2026-10-21 08:30 KST

const US_VF = '2026-10-21T13:30:00.000Z'; // 22:30 KST (09:30 EDT)
const US_EX = '2026-10-21T20:00:00.000Z'; // 05:00 KST 다음 날 (16:00 EDT)
const KR_VF = '2026-10-21T00:00:00.000Z'; // 09:00 KST
const KR_EX = '2026-10-21T06:30:00.000Z'; // 15:30 KST

const FX = { pair: 'USD_KRW', rate: 1330, asOf: '2026-10-21T08:00:00+09:00', source: 'fx_rates' };

/** G5 예시 JSON (CMCSA) — 객체 형태. 106 행은 이것을 **문자열로** 싣는다. */
export const CMCSA_INDICATORS = {
  currency: 'KRW',
  pattern: 'oversold-bounce',
  price_zone_usd: { lo: 27.2, hi: 27.6 },
  fx: FX,
  earnings: {
    status: 'estimated_window',
    window: { from: '2026-10-24', to: '2026-10-31' },
    nextConfirmed: null,
    blackout_days: 5,
    observedAt: '2026-10-21T08:00:12+09:00',
  },
  ai: {
    confidence: 74,
    scenario: {
      grade: 'B+',
      entry: { trigger: 'price_zone', price_zone: '36176~36708' },
      exit: { target_pct: 4, stop_pct: 3, holding_days: '3일' },
    },
  },
};

function base(id: number, symbol: string, market: 'domestic' | 'overseas', created: string) {
  return {
    id, symbol, market, side: 'buy' as const, status: 'pending', quantity: null, amount_krw: '100000.00',
    strategy_id: null, price: null, reasoning: null, created_at: created,
  };
}

export type FixtureRow = ReturnType<typeof base> & {
  scenario_source: string | null;
  valid_from: string | null;
  expires_at: string | null;
  indicators: unknown;
};

export const T062_FIXTURE: FixtureRow[] = [
  { ...base(107, 'NAS:PFE', 'overseas', '2026-10-21T00:10:00.000Z'), scenario_source: null,
    valid_from: null, expires_at: '2026-10-21T12:00:00.000Z', indicators: null },
  { ...base(106, 'NAS:CMCSA', 'overseas', '2026-10-20T23:00:05.000Z'), scenario_source: 'post-market',
    valid_from: US_VF, expires_at: US_EX, indicators: JSON.stringify(CMCSA_INDICATORS) },
  { ...base(105, 'NYS:BAC', 'overseas', '2026-10-20T23:00:04.000Z'), scenario_source: 'post-market',
    valid_from: US_VF, expires_at: US_EX,
    indicators: {
      pattern: 'eod-high-close',
      price_zone_usd: { lo: 41.3, hi: 41.9 }, fx: FX,
      earnings: { status: 'none', nextConfirmed: null, blackout_days: 5, observedAt: '2026-10-21T08:00:12+09:00' },
      ai: { confidence: 82, scenario: { grade: 'A', entry: { trigger: 'price_zone', price_zone: '54929~55727' }, exit: { target_pct: 3, stop_pct: 2, holding_days: '2일' } } },
    } },
  { ...base(104, 'NAS:NFLX', 'overseas', '2026-10-20T23:00:03.000Z'), scenario_source: 'post-market',
    valid_from: US_VF, expires_at: US_EX,
    indicators: {
      pattern: 'inside-bar',
      price_zone_usd: { lo: 71.8, hi: 72.6 }, fx: FX,
      earnings: { status: 'none', nextConfirmed: null, blackout_days: 5, observedAt: '2026-10-21T08:00:12+09:00' },
      ai: { confidence: 66, scenario: { grade: 'B', entry: { trigger: 'price_zone', price_zone: '95494~96558' }, exit: { target_pct: 5, stop_pct: 3, holding_days: '3일' } } },
    } },
  { ...base(103, '005930', 'domestic', '2026-10-20T07:00:03.000Z'), scenario_source: 'post-market',
    valid_from: KR_VF, expires_at: KR_EX,
    indicators: { pattern: 'eod-high-close', ai: { confidence: 81, scenario: { grade: 'A', entry: { trigger: 'price_zone', price_zone: '71200~72500' }, exit: { target_pct: 3, stop_pct: 2, holding_days: '2일' } } } } },
  { ...base(102, '066570', 'domestic', '2026-10-20T07:00:02.000Z'), scenario_source: 'post-market',
    valid_from: KR_VF, expires_at: KR_EX,
    indicators: { pattern: 'inside-bar', ai: { confidence: 71, scenario: { grade: 'B+', entry: { trigger: 'price_zone', price_zone: '84300~85600' }, exit: { target_pct: 4, stop_pct: 2, holding_days: '3일' } } } } },
  { ...base(101, '035720', 'domestic', '2026-10-20T07:00:01.000Z'), scenario_source: 'post-market',
    valid_from: KR_VF, expires_at: KR_EX,
    indicators: { pattern: 'oversold-bounce', ai: { confidence: 63, scenario: { grade: 'B', entry: { trigger: 'price_zone', price_zone: '41050~41900' }, exit: { target_pct: 4, stop_pct: 3, holding_days: '3일' } } } } },
];

/** "내일" 탭(post-market 만, PFE 제외). */
export const T062_TOMORROW = T062_FIXTURE.filter(r => r.scenario_source === 'post-market');

/** 장면 4 — 해외 1장 + 국내 3장. */
export const T062_SCENE4 = T062_FIXTURE.filter(r => [106, 103, 102, 101].includes(r.id));

/** Q-g 폴백 — 106 에서 price_zone_usd 제거(문자열 그대로 유지). */
export function cmcsaWithoutUsd(): FixtureRow {
  const { price_zone_usd: _drop, ...rest } = CMCSA_INDICATORS;
  void _drop;
  return { ...T062_FIXTURE[1], indicators: JSON.stringify(rest) };
}
