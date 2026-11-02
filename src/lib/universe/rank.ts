/**
 * T-143 WP-A — 상위 N 선정(제외·CIK 중복 제거·정렬). **순수 함수.**
 *
 * 정본: `docs/design/2026-11-01-t143-wpa-nyse50-spec.md` §3.5·§6.4·§15(L-A2·L-A3).
 *
 * ## 제외 순서가 뜻을 가진다
 * 통화 → ETP → 시총 없음 → 크기 이상 → (DR) → CIK 중복. 앞에서 빠진 종목은 뒤 사유로 세지 않는다 —
 * 한 종목이 두 사유로 세어지면 `counts_json` 의 합이 후보 수와 맞지 않고, 1회차 검토가 불가능해진다.
 *
 * ## L-A3 「같은 CIK 는 1종목」
 * `tomv` 가 클래스 단위라 `BRK.A`/`BRK.B` 처럼 **같은 기업의 두 클래스가 모두 상위 50 에 들 수 있다.**
 * 남길 클래스는 `cap_used` 가 큰 쪽(유동성 대리)이고, 탈락시킨 클래스는 `cik_dup` 으로 기록한다.
 *
 * ## L-A2 「ADR 1회차 제외 + 가상 순위」
 * DR 은 **제외하되**, 제외하지 않았다면 몇 위였는지를 같은 파이프라인을 DR 포함으로 한 번 더 돌려 기록한다
 * (`virtual` 결과). 「제외 때문에 놓친 것」의 크기를 모르면 2회차에 되돌릴 판단을 할 수 없기 때문이다.
 */
import { decideCap, isImplausibleCap, type CapDecision } from './cap-rule';

/** `finalize` 가 보는 한 후보의 입력. 스캔이 끝난 뒤의 원값이다. */
export interface RankInput {
  /** SEC 순서(스캔 커서 기준) — 동률 판정에는 쓰지 않는다. */
  ord: number;
  /** 내부 심볼(`NYS:BRK.B`). */
  symbol: string;
  cik: number;
  curr: string | null;
  /** KIS 현재가상세의 `etyp_nm`. 비어 있지 않으면 ETP 다. */
  etypNm: string | null;
  tomv: number | null;
  shar: number | null;
  last: number | null;
  /** 마스터의 `isdr === 'Y'`. */
  isDr: boolean;
}

export type RankExclusion = 'currency' | 'etp' | 'tomv_null' | 'implausible' | 'master_dr' | 'cik_dup';

export interface RankedCandidate extends CapDecision {
  ord: number;
  symbol: string;
  cik: number;
  isDr: boolean;
  /** null 이면 순위 후보로 남았다. */
  exclusion: RankExclusion | null;
  /** 상위 N 에 들었을 때만 1..N. 그 밖은 null. */
  rankNo: number | null;
}

export interface RankResult {
  candidates: RankedCandidate[];
  /** 상위 N(순위 오름차순). */
  top: RankedCandidate[];
  /** N 번째 종목의 시총 — 1회차 경계 확인용(`threshold_cap_usd`). 상위가 비면 null. */
  thresholdCapUsd: number | null;
  counts: {
    currency: Record<string, number>;
    etp_by_value: Record<string, number>;
    tomv_null: number;
    tomv_null_with_alt: number;
    implausible: number;
    dr_excluded: number;
    cik_dup_removed: number;
    cap_flag: Record<string, number>;
    ranked: number;
  };
}

function bump(m: Record<string, number>, k: string): void {
  m[k] = (m[k] ?? 0) + 1;
}

/**
 * 후보 → 순위. `excludeDr` 가 true 면 DR 을 제외한다(L-A2).
 *
 * 정렬은 `capUsed` 내림차순, 동률은 **심볼 오름차순**(결정적 — 같은 입력이면 늘 같은 목록이다).
 */
export function rankCandidates(
  inputs: readonly RankInput[],
  topN: number,
  opts: { excludeDr: boolean },
): RankResult {
  const counts: RankResult['counts'] = {
    currency: {}, etp_by_value: {}, tomv_null: 0, tomv_null_with_alt: 0, implausible: 0,
    dr_excluded: 0, cik_dup_removed: 0, cap_flag: {}, ranked: 0,
  };
  const out: RankedCandidate[] = [];

  for (const c of inputs) {
    const cap = decideCap({ tomv: c.tomv, shar: c.shar, last: c.last });
    bump(counts.cap_flag, cap.capFlag);
    const row: RankedCandidate = {
      ...cap, ord: c.ord, symbol: c.symbol, cik: c.cik, isDr: c.isDr, exclusion: null, rankNo: null,
    };
    // 통화 — NYSE 는 전부 USD 여야 한다(방어). 모르는 통화를 USD 로 가정하지 않는다.
    if ((c.curr ?? '').trim().toUpperCase() !== 'USD') {
      row.exclusion = 'currency';
      bump(counts.currency, (c.curr ?? '(없음)').trim() || '(빈값)');
    } else if ((c.etypNm ?? '').trim()) {
      // 현재가상세가 ETP 분류명을 주면 전부 제외한다(마스터 필터가 놓친 것을 여기서 받는다 — 사양 §5.2 ③)
      row.exclusion = 'etp';
      bump(counts.etp_by_value, (c.etypNm as string).trim());
    } else if (cap.capFlag === 'tomv_null') {
      row.exclusion = 'tomv_null';
      counts.tomv_null += 1;
      if (cap.capAlt != null) counts.tomv_null_with_alt += 1;
    } else if (isImplausibleCap(cap.capUsed)) {
      row.exclusion = 'implausible';
      counts.implausible += 1;
    } else if (opts.excludeDr && c.isDr) {
      row.exclusion = 'master_dr';
      counts.dr_excluded += 1;
    }
    out.push(row);
  }

  // CIK 당 1종목 — 남은 후보 중 같은 CIK 는 `capUsed` 큰 쪽만. 동률은 심볼 오름차순(결정적).
  const byCik = new Map<number, RankedCandidate[]>();
  for (const r of out) {
    if (r.exclusion) continue;
    const cur = byCik.get(r.cik);
    if (cur) cur.push(r); else byCik.set(r.cik, [r]);
  }
  for (const group of byCik.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort(cmpCap);
    for (const loser of sorted.slice(1)) {
      loser.exclusion = 'cik_dup';
      counts.cik_dup_removed += 1;
    }
  }

  const survivors = out.filter((r) => !r.exclusion).sort(cmpCap);
  const top = survivors.slice(0, Math.max(0, topN));
  top.forEach((r, i) => { r.rankNo = i + 1; });
  counts.ranked = top.length;

  return {
    candidates: out,
    top,
    thresholdCapUsd: top.length > 0 ? top[top.length - 1].capUsed : null,
    counts,
  };
}

function cmpCap(a: RankedCandidate, b: RankedCandidate): number {
  const d = (b.capUsed ?? 0) - (a.capUsed ?? 0);
  return d !== 0 ? d : (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0);
}

/**
 * L-A2 의 가상 순위 — **DR 을 제외하지 않았다면** 상위 N 안에 들어왔을 DR 종목과 그 순위.
 * 실제 목록에는 영향을 주지 않는다(별도 계산이고 결과는 `counts_json` 에만 남는다).
 */
export function drVirtualRanks(
  inputs: readonly RankInput[],
  topN: number,
): { count: number; ranks: Record<string, number> } {
  const withDr = rankCandidates(inputs, topN, { excludeDr: false });
  const ranks: Record<string, number> = {};
  for (const r of withDr.top) if (r.isDr && r.rankNo != null) ranks[r.symbol] = r.rankNo;
  return { count: Object.keys(ranks).length, ranks };
}
