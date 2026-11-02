/**
 * T-143 WP-A — 상위 N 선정 (사양 §3.5·§6.4·§12.3 · Leader 결정 L-A2·L-A3).
 */
import { drVirtualRanks, rankCandidates, type RankInput } from '../rank';

let ord = 0;
function cand(p: Partial<RankInput> & { symbol: string; cik: number }): RankInput {
  return {
    ord: ord++, curr: 'USD', etypNm: null, tomv: null, shar: null, last: null, isDr: false, ...p,
  };
}
/** `tomv` 만 주면 `shar × last` 가 일치하도록 짝을 만든다(consistent). */
function at(symbol: string, cik: number, cap: number, extra: Partial<RankInput> = {}): RankInput {
  return cand({ symbol, cik, tomv: cap, shar: cap / 100, last: 100, ...extra });
}

beforeEach(() => { ord = 0; });

describe('사양 §12.3 — 순위·CIK 중복 시나리오', () => {
  const inputs = [
    at('NYS:BRK.A', 1067983, 400_000_000_000),
    at('NYS:BRK.B', 1067983, 640_000_000_000),
    at('NYS:LLY', 59478, 1_330_000_000_000),
    at('NYS:SOJC', 92122, 500_000_000),
    at('NYS:FNGD', 927971, 100_000_000_000, { etypNm: 'ETN' }),
    at('NYS:XYZ', 999, 300_000_000_000, { curr: 'CAD' }),
  ];

  it('순위는 LLY · BRK.B · SOJC 이고 제외 사유가 종목마다 남는다', () => {
    const r = rankCandidates(inputs, 3, { excludeDr: true });
    expect(r.top.map((x) => [x.symbol, x.rankNo])).toEqual([
      ['NYS:LLY', 1], ['NYS:BRK.B', 2], ['NYS:SOJC', 3],
    ]);
    const byS = new Map(r.candidates.map((c) => [c.symbol, c.exclusion]));
    expect(byS.get('NYS:BRK.A')).toBe('cik_dup');
    expect(byS.get('NYS:FNGD')).toBe('etp');
    expect(byS.get('NYS:XYZ')).toBe('currency');
    expect(byS.get('NYS:LLY')).toBeNull();
  });

  it('집계가 후보 수와 맞는다(한 종목이 두 사유로 세어지지 않는다)', () => {
    const r = rankCandidates(inputs, 3, { excludeDr: true });
    const excluded = r.candidates.filter((c) => c.exclusion).length;
    expect(excluded).toBe(3);
    expect(r.counts.cik_dup_removed).toBe(1);
    expect(r.counts.etp_by_value).toEqual({ ETN: 1 });
    expect(r.counts.currency).toEqual({ CAD: 1 });
    expect(r.counts.ranked).toBe(3);
    expect(r.thresholdCapUsd).toBe(500_000_000);
  });

  it('상위 N 보다 후보가 많으면 N 개만 순위를 받는다', () => {
    const r = rankCandidates(inputs, 2, { excludeDr: true });
    expect(r.top.map((x) => x.symbol)).toEqual(['NYS:LLY', 'NYS:BRK.B']);
    expect(r.candidates.find((c) => c.symbol === 'NYS:SOJC')?.rankNo).toBeNull();
    // 순위에 못 든 것은 **제외가 아니다** — 사유를 붙이지 않는다
    expect(r.candidates.find((c) => c.symbol === 'NYS:SOJC')?.exclusion).toBeNull();
  });
});

describe('제외 순서 — 앞에서 빠진 종목은 뒤 사유로 세지 않는다', () => {
  it('통화가 다르면 ETP·시총을 보지 않는다', () => {
    const r = rankCandidates([cand({ symbol: 'NYS:A', cik: 1, curr: 'CAD', etypNm: 'ETF', tomv: null })], 1, { excludeDr: true });
    expect(r.candidates[0].exclusion).toBe('currency');
    expect(r.counts.etp_by_value).toEqual({});
    expect(r.counts.tomv_null).toBe(0);
  });

  it('ETP 는 시총이 없어도 etp 로만 센다', () => {
    const r = rankCandidates([cand({ symbol: 'NYS:A', cik: 1, etypNm: 'ETF' })], 1, { excludeDr: true });
    expect(r.candidates[0].exclusion).toBe('etp');
    expect(r.counts.tomv_null).toBe(0);
  });

  it('통화 표기는 공백·소문자를 받아 준다(USD 로 본다)', () => {
    const r = rankCandidates([at('NYS:A', 1, 1e11, { curr: ' usd ' })], 1, { excludeDr: true });
    expect(r.candidates[0].exclusion).toBeNull();
  });

  it('통화가 없으면(null) 제외다 — USD 로 가정하지 않는다', () => {
    const r = rankCandidates([at('NYS:A', 1, 1e11, { curr: null })], 1, { excludeDr: true });
    expect(r.candidates[0].exclusion).toBe('currency');
    expect(r.counts.currency).toEqual({ '(없음)': 1 });
  });

  it('tomv 없음은 capAlt 유무를 따로 센다', () => {
    const r = rankCandidates([
      cand({ symbol: 'NYS:A', cik: 1, tomv: null, shar: 1e9, last: 10 }),
      cand({ symbol: 'NYS:B', cik: 2, tomv: null }),
    ], 2, { excludeDr: true });
    expect([r.counts.tomv_null, r.counts.tomv_null_with_alt]).toEqual([2, 1]);
  });

  it('20조 이상은 implausible — 단위 오류가 겹친 값을 순위에 넣지 않는다', () => {
    const r = rankCandidates([at('NYS:A', 1, 3e13)], 1, { excludeDr: true });
    expect(r.candidates[0].exclusion).toBe('implausible');
    expect(r.counts.implausible).toBe(1);
  });
});

describe('L-A3 — 같은 CIK 는 1종목', () => {
  it('시총이 큰 쪽을 남기고 탈락 클래스를 기록한다', () => {
    const r = rankCandidates([
      at('NAS:GOOG', 1652044, 1_540_000_000_000),
      at('NAS:GOOGL', 1652044, 1_640_000_000_000),
    ], 5, { excludeDr: true });
    expect(r.top.map((x) => x.symbol)).toEqual(['NAS:GOOGL']);
    expect(r.candidates.find((c) => c.symbol === 'NAS:GOOG')?.exclusion).toBe('cik_dup');
  });

  it('시총이 같으면 심볼 오름차순으로 결정적으로 고른다', () => {
    const r = rankCandidates([at('NYS:BB', 7, 1e11), at('NYS:AA', 7, 1e11)], 5, { excludeDr: true });
    expect(r.top.map((x) => x.symbol)).toEqual(['NYS:AA']);
  });

  it('이미 제외된 종목은 CIK 중복 판정에 끼지 않는다(제외분이 멀쩡한 클래스를 떨어뜨리지 않는다)', () => {
    const r = rankCandidates([
      at('NYS:BIG', 5, 9e11, { etypNm: 'ETF' }),   // 더 크지만 ETP 라 먼저 빠진다
      at('NYS:SML', 5, 1e11),
    ], 5, { excludeDr: true });
    expect(r.top.map((x) => x.symbol)).toEqual(['NYS:SML']);
    expect(r.counts.cik_dup_removed).toBe(0);
  });

  it('CIK 가 하나뿐이면 아무것도 빠지지 않는다', () => {
    const r = rankCandidates([at('NYS:A', 1, 1e11), at('NYS:B', 2, 2e11)], 5, { excludeDr: true });
    expect(r.counts.cik_dup_removed).toBe(0);
  });
});

describe('L-A2 — DR 제외와 가상 순위', () => {
  const inputs = [
    at('NYS:LLY', 1, 1_300_000_000_000),
    at('NYS:TSM', 2, 1_100_000_000_000, { isDr: true }),
    at('NYS:JPM', 3, 900_000_000_000),
    at('NYS:SHEL', 4, 250_000_000_000, { isDr: true }),
    at('NYS:XOM', 5, 500_000_000_000),
  ];

  it('excludeDr=true 면 DR 이 빠지고 그만큼 다음 종목이 올라온다', () => {
    const r = rankCandidates(inputs, 3, { excludeDr: true });
    expect(r.top.map((x) => x.symbol)).toEqual(['NYS:LLY', 'NYS:JPM', 'NYS:XOM']);
    expect(r.counts.dr_excluded).toBe(2);
    expect(r.candidates.find((c) => c.symbol === 'NYS:TSM')?.exclusion).toBe('master_dr');
  });

  it('🔴 제외하지 않았다면 몇 위였는지를 기록한다 — 되돌릴 판단의 근거다', () => {
    const v = drVirtualRanks(inputs, 3);
    expect(v).toEqual({ count: 1, ranks: { 'NYS:TSM': 2 } });
  });

  it('가상 순위는 실제 목록을 바꾸지 않는다(별도 계산이다)', () => {
    const r = rankCandidates(inputs, 3, { excludeDr: true });
    const before = r.top.map((x) => x.symbol);
    drVirtualRanks(inputs, 3);
    expect(rankCandidates(inputs, 3, { excludeDr: true }).top.map((x) => x.symbol)).toEqual(before);
  });

  it('excludeDr=false 면 DR 도 순위에 든다', () => {
    const r = rankCandidates(inputs, 3, { excludeDr: false });
    expect(r.top.map((x) => x.symbol)).toEqual(['NYS:LLY', 'NYS:TSM', 'NYS:JPM']);
    expect(r.counts.dr_excluded).toBe(0);
  });
});

describe('정렬·빈 입력', () => {
  it('시총 내림차순 · 동률은 심볼 오름차순(같은 입력이면 늘 같은 목록)', () => {
    const r = rankCandidates([
      at('NYS:C', 3, 100), at('NYS:A', 1, 200), at('NYS:B', 2, 200),
    ], 5, { excludeDr: true });
    expect(r.top.map((x) => x.symbol)).toEqual(['NYS:A', 'NYS:B', 'NYS:C']);
  });

  it('후보가 없으면 상위도 없고 경계값은 null 이다(0 으로 채우지 않는다)', () => {
    const r = rankCandidates([], 50, { excludeDr: true });
    expect([r.top, r.thresholdCapUsd, r.counts.ranked]).toEqual([[], null, 0]);
  });

  it('topN 이 0·음수면 상위가 비고 후보는 제외되지 않는다', () => {
    const r = rankCandidates([at('NYS:A', 1, 1e11)], 0, { excludeDr: true });
    expect([r.top.length, r.candidates[0].exclusion]).toEqual([0, null]);
  });

  it('cap_flag 분포를 센다', () => {
    const r = rankCandidates([
      at('NYS:A', 1, 1e11),
      cand({ symbol: 'NYS:B', cik: 2, tomv: 1.04e11, shar: 2e9, last: 50 }),
      cand({ symbol: 'NYS:C', cik: 3, tomv: 1e11, shar: null, last: 50 }),
    ], 5, { excludeDr: true });
    expect(r.counts.cap_flag).toEqual({ consistent: 1, minor_mismatch: 1, unverified: 1 });
  });
});
