/**
 * T-143 WP-A — 시가총액 판정 규칙. 사양 §6.3 의 **시험 벡터 9개**를 그대로 고정한다.
 *
 * 이 규칙이 틀리면 상위 50 의 순서가 조용히 바뀐다(값이 없거나 0 이 되는 것이 아니라 **그럴듯하게 틀린다**) —
 * 그래서 벡터를 수치 그대로 박아 둔다.
 */
import {
  CAP_MAX_USD, decideCap, isImplausibleCap,
} from '../cap-rule';

describe('T-143 §6.3 시험 벡터 9개', () => {
  it('① AAPL 실측(2026-11-01) — r=1.000000 → tomv 그대로', () => {
    expect(decideCap({ tomv: 5_029_599_146_000, shar: 14_594_200_000, last: 344.63 })).toEqual({
      capUsed: 5_029_599_146_000, capAlt: null, capSource: 'tomv', capRatio: 1, capFlag: 'consistent',
    });
  });

  it('② SMH 실측 — 값은 consistent(ETP 제외는 순위 단계가 한다)', () => {
    expect(decideCap({ tomv: 66_900_664_580, shar: 128_042_000, last: 522.49 })).toEqual({
      capUsed: 66_900_664_580, capAlt: null, capSource: 'tomv', capRatio: 1, capFlag: 'consistent',
    });
  });

  it('③ r=1e-5 — 10^±3·10^±6 어느 쪽 ±5% 에도 안 맞음 → shares×last · basis_mismatch', () => {
    const d = decideCap({ tomv: 1_000_000, shar: 2_000_000_000, last: 50 });
    expect([d.capUsed, d.capSource, d.capFlag]).toEqual([100_000_000_000, 'shares_x_last', 'basis_mismatch']);
  });

  it('④ r=0.001 — 천 단위 어긋남 → shares×last · unit_mismatch', () => {
    const d = decideCap({ tomv: 100_000_000, shar: 2_000_000_000, last: 50 });
    expect([d.capUsed, d.capSource, d.capFlag]).toEqual([100_000_000_000, 'shares_x_last', 'unit_mismatch']);
  });

  it('⑤ r=1.6 — 회사 전체 vs 클래스 → shares×last · basis_mismatch', () => {
    const d = decideCap({ tomv: 160_000_000_000, shar: 2_000_000_000, last: 50 });
    expect([d.capUsed, d.capSource, d.capFlag]).toEqual([100_000_000_000, 'shares_x_last', 'basis_mismatch']);
  });

  it('⑥ r=1.04 — 주수 갱신 지연 밴드 → tomv 유지 · minor_mismatch', () => {
    const d = decideCap({ tomv: 104_000_000_000, shar: 2_000_000_000, last: 50 });
    expect([d.capUsed, d.capSource, d.capFlag]).toEqual([104_000_000_000, 'tomv', 'minor_mismatch']);
  });

  it('⑦ tomv 없음 → 제외(capUsed null) · capAlt 에 shares×last 기록', () => {
    expect(decideCap({ tomv: null, shar: 2_000_000_000, last: 50 })).toEqual({
      capUsed: null, capAlt: 100_000_000_000, capSource: null, capRatio: null, capFlag: 'tomv_null',
    });
  });

  it('⑧ shar 없음 → tomv 사용 · unverified(검증 불가 표시)', () => {
    expect(decideCap({ tomv: 100_000_000_000, shar: null, last: 50 })).toEqual({
      capUsed: 100_000_000_000, capAlt: null, capSource: 'tomv', capRatio: null, capFlag: 'unverified',
    });
  });

  it('⑨ 통화가 USD 가 아닌 경우는 이 규칙이 보지 않는다(순위 단계의 제외 사유다)', () => {
    // 값 판정은 통화와 무관하게 같다 — `rank.ts` 가 `currency` 로 뺀다
    const d = decideCap({ tomv: 100_000_000_000, shar: 2_000_000_000, last: 50 });
    expect([d.capUsed, d.capFlag]).toEqual([100_000_000_000, 'consistent']);
  });
});

describe('경계', () => {
  it('|r−1| 가 정확히 0.5% 면 consistent, 조금 넘으면 minor_mismatch', () => {
    // shar×last = 1e11
    expect(decideCap({ tomv: 100_500_000_000, shar: 2_000_000_000, last: 50 }).capFlag).toBe('consistent');
    expect(decideCap({ tomv: 100_500_000_001, shar: 2_000_000_000, last: 50 }).capFlag).toBe('minor_mismatch');
  });

  it('±10% 경계 밖은 shares×last 로 넘어간다', () => {
    expect(decideCap({ tomv: 110_000_000_000, shar: 2_000_000_000, last: 50 }).capSource).toBe('tomv');
    expect(decideCap({ tomv: 110_000_000_001, shar: 2_000_000_000, last: 50 }).capSource).toBe('shares_x_last');
  });

  it('10^+3·10^+6 방향(tomv 가 더 큰 단위 오류)도 unit_mismatch 다', () => {
    // r = 1000  → 10^3 근사
    expect(decideCap({ tomv: 100_000_000_000_000, shar: 2_000_000_000, last: 50 }).capFlag).toBe('unit_mismatch');
    // r = 1e6 → 10^6 근사
    expect(decideCap({ tomv: 1e17, shar: 2_000_000_000, last: 50 }).capFlag).toBe('unit_mismatch');
  });

  it('🔴 tomv 가 0·음수면 「없음」으로 본다 — shares×last 로 되살려 순위에 넣지 않는다', () => {
    // 사양 §6.2 의 의사코드는 `tomv == null` 만 걸렀다. 0 은 **측정된 시가총액이 아니라 빈 값**이고
    // (`parsePriceDetail` 은 tomv 에 zeroToNull 을 적용하지 않는다) 승인 정책은 「tomv 없음 → 제외」다.
    // 0 을 basis_mismatch 로 보면 그 종목이 shares×last 로 **순위에 들어온다** — 승인 범위를 넘는다.
    for (const tomv of [0, -1]) {
      const d = decideCap({ tomv, shar: 2_000_000_000, last: 50 });
      expect([d.capUsed, d.capFlag, d.capAlt]).toEqual([null, 'tomv_null', 100_000_000_000]);
    }
  });

  it('주수·가격이 0 이하면 검증 불가(unverified) — 0 으로 곱해 0 을 만들지 않는다', () => {
    expect(decideCap({ tomv: 1e11, shar: 0, last: 50 }).capFlag).toBe('unverified');
    expect(decideCap({ tomv: 1e11, shar: 2e9, last: 0 }).capFlag).toBe('unverified');
    expect(decideCap({ tomv: 1e11, shar: -1, last: 50 }).capFlag).toBe('unverified');
  });

  it('tomv 도 없고 주수·가격도 없으면 capAlt 까지 null', () => {
    expect(decideCap({ tomv: null, shar: null, last: null })).toEqual({
      capUsed: null, capAlt: null, capSource: null, capRatio: null, capFlag: 'tomv_null',
    });
  });

  it('NaN·Infinity 는 값으로 받지 않는다', () => {
    expect(decideCap({ tomv: Number.NaN, shar: 2e9, last: 50 }).capFlag).toBe('tomv_null');
    expect(decideCap({ tomv: Number.POSITIVE_INFINITY, shar: 2e9, last: 50 }).capFlag).toBe('tomv_null');
    expect(decideCap({ tomv: 1e11, shar: Number.NaN, last: 50 }).capFlag).toBe('unverified');
  });

  it('capRatio 는 소수 6자리로 저장한다(DECIMAL(12,6) 과 같은 자리)', () => {
    const d = decideCap({ tomv: 1_234_567, shar: 1_000_000, last: 1 });
    expect(d.capRatio).toBe(1.234567);
  });

  it('20조 USD 이상·0 이하는 순위에 넣을 수 없는 크기다', () => {
    expect(CAP_MAX_USD).toBe(2e13);
    expect(isImplausibleCap(CAP_MAX_USD)).toBe(true);
    expect(isImplausibleCap(CAP_MAX_USD - 1)).toBe(false);
    expect(isImplausibleCap(0)).toBe(true);
    expect(isImplausibleCap(null)).toBe(true);
  });
});
