/**
 * T-143 WP-A — 시가총액 판정(`tomv` 비일관 규칙). **순수 함수.**
 *
 * 정본: `docs/design/2026-11-01-t143-wpa-nyse50-spec.md` §6(시험 벡터 9개는 §6.3).
 *
 * ## 관측 (2026-11-01, 운영 `us_fundamentals_snapshot` 624행 = 52종목 × 12일)
 * 전부 `tomv ÷ (shar × last) = 1.000000`(min = max, 0.1% 넘는 어긋남 0건). 즉 `tomv` 는 **USD 원값**이고
 * KIS 가 `shar × last` 로 계산한 값이다.
 *
 * 🔴 **`tomv` 는 「클래스 단위」다 — 회사 전체 시총이 아니다.** `NAS:GOOGL` 1.64조(5.868B주)·`NAS:GOOG`
 * 1.54조(5.527B주)로 Alphabet 전체(≈3.4조)와 다르다. NYSE 의 `BRK.B` 도 B 주 기준으로 잡힌다.
 * 그래서 이 순위의 뜻은 **「KIS 가 주는 클래스 단위 시총」**이고, 같은 회사의 두 클래스가 모두 상위에 드는 것을
 * 막는 것은 이 모듈이 아니라 `rank.ts` 의 「CIK 당 1종목」이다(L-A3).
 *
 * ## 왜 0.5% 인가
 * 관측값이 소수 6자리까지 정확히 1 이므로 참값은 1 이고, 0.5% 는 표시 반올림(`last` 2자리·`shar` 반올림)만
 * 흡수한다. 10% 밴드는 「같은 기준인데 한쪽이 며칠 늦은」 경우(주수 갱신 지연)를 KIS 값으로 둔다.
 * 그 밖은 사용자 지시대로 `shar × last` 를 쓴다 — **모르는 값을 0 으로 채우지 않고, 쓴 근거를 플래그로 남긴다.**
 */

export type CapFlag =
  /** `|r−1| ≤ 0.5%` — `tomv` 를 그대로 쓴다. */
  | 'consistent'
  /** `0.90 ≤ r ≤ 1.10` — 주수 갱신 지연 등. `tomv` 를 유지한다. */
  | 'minor_mismatch'
  /** 천·백만 단위 어긋남(10^±3·10^±6 근사) — `shar × last` 로 바꾼다. */
  | 'unit_mismatch'
  /** 기준 주수가 다르다(회사 전체 vs 클래스 등) — `shar × last` 로 바꾼다. */
  | 'basis_mismatch'
  /** 주수·현재가가 없어 검증할 수 없다 — `tomv` 를 쓰되 검증 불가를 표시한다. */
  | 'unverified'
  /** `tomv` 가 없다 — 순위에 넣지 않는다(승인 정책). `capAlt` 에 `shar × last` 를 적어 둔다. */
  | 'tomv_null';

export type CapSource = 'tomv' | 'shares_x_last';

export interface CapDecision {
  /** 순위에 쓰는 값. `null` 이면 제외(`tomv_null`). */
  capUsed: number | null;
  /** `tomv` 가 없을 때의 대안값 — **순위에 쓰지 않고** 크기만 기록한다. */
  capAlt: number | null;
  capSource: CapSource | null;
  /** `tomv ÷ (shar × last)`, 소수 6자리. 계산 불가면 null. */
  capRatio: number | null;
  capFlag: CapFlag;
}

/** 0.5% — `tomv` 를 그대로 믿는 경계. */
export const CAP_CONSISTENT_TOL = 0.005;
/** ±10% — 「같은 기준인데 한쪽이 늦은」 밴드. */
export const CAP_MINOR_LO = 0.90;
export const CAP_MINOR_HI = 1.10;
/** 단위 어긋남으로 인정하는 근사 오차(5%)와 자릿수(천·백만, 양·음 방향). */
export const CAP_UNIT_TOL = 0.05;
export const CAP_UNIT_EXPONENTS: readonly number[] = [3, -3, 6, -6];
/** 상한 20조 USD·하한 0 — 단위 오류가 두 겹으로 겹친 값을 순위에 넣지 않는다(`rank.ts` 가 `implausible` 로 뺀다). */
export const CAP_MAX_USD = 2e13;

function positive(v: number | null | undefined): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}
function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/**
 * 한 종목의 시총을 정한다. **던지지 않는다** — 판정 불가는 플래그로 말한다.
 *
 * 입력은 KIS 현재가상세의 원값(`tomv`·`shar`·`last`)이다. 통화(`curr`)·ETP 분류(`etyp_nm`)는 여기서 보지 않는다
 * (제외 사유라 `rank.ts` 가 다룬다).
 */
export function decideCap(input: { tomv: number | null; shar: number | null; last: number | null }): CapDecision {
  const { tomv, shar, last } = input;
  const product = positive(shar) && positive(last) ? (shar as number) * (last as number) : null;

  if (!positive(tomv)) {
    // `tomv` 가 없거나 0·음수 — 측정값으로 위조하지 않는다. 대안값은 크기 참고로만 남긴다.
    return { capUsed: null, capAlt: product, capSource: null, capRatio: null, capFlag: 'tomv_null' };
  }
  const t = tomv as number;
  if (product == null) {
    return { capUsed: t, capAlt: null, capSource: 'tomv', capRatio: null, capFlag: 'unverified' };
  }
  const r = t / product;
  const ratio = round6(r);

  if (Math.abs(r - 1) <= CAP_CONSISTENT_TOL) {
    return { capUsed: t, capAlt: null, capSource: 'tomv', capRatio: ratio, capFlag: 'consistent' };
  }
  if (r >= CAP_MINOR_LO && r <= CAP_MINOR_HI) {
    return { capUsed: t, capAlt: null, capSource: 'tomv', capRatio: ratio, capFlag: 'minor_mismatch' };
  }
  const unit = CAP_UNIT_EXPONENTS.some((k) => Math.abs(r / 10 ** k - 1) <= CAP_UNIT_TOL);
  return {
    capUsed: product,
    capAlt: null,
    capSource: 'shares_x_last',
    capRatio: ratio,
    capFlag: unit ? 'unit_mismatch' : 'basis_mismatch',
  };
}

/** 순위에 넣을 수 없는 크기인가(0 이하·20조 이상). `decideCap` 뒤에 본다. */
export function isImplausibleCap(capUsed: number | null): boolean {
  return capUsed == null || !(capUsed > 0) || capUsed >= CAP_MAX_USD;
}
