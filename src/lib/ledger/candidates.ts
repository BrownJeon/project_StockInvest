/**
 * T-074 — 기록 안 된 입출금 후보 탐지 (순수 함수, DB 없음).
 *
 * 규칙(Analyst Q3 '누락 탐지', 데모 후보 카드 문장):
 *   보유 종목·수량이 그대로인 연속 단계에서 원화 현금이 ≥ RULE.krw(5만원) 또는 달러 현금이 ≥ RULE.usd($50) 바뀌었고,
 *   그 변화를 차지한(반영됨) 살아 있는 원장 기록이 없으면 후보.
 * T-069 R3(`flowMinPct 1% / flowMinKrw 10만원`)는 '큰 외부 이동'을 훑는 용도라 2,200만원 계좌에서 22만원 미만 입출금을 놓친다 —
 * 원장 누락 경고는 현금 변화 자체를 본다(Analyst Q3). 수량이 바뀐 단계(매매)는 보지 않는다.
 * 빼는 것:
 *  - 기준 시각 이전 단계(prev.ts < 기준) — 기준 총자산에 이미 들어 있다
 *  - 환전처럼 보이는 단계(원화·달러 반대 방향, 내재 환율 ±3%) — 환전은 입출금이 아니고 기록은 선택(데모 결정 8)
 *  - USD Y ↔ Y+X 왕복 단계(snapshots.detectUsdFlips) — 억제하지 않으면 매일 두 번 울린다(Analyst Q3)
 * **후보를 입출금으로 확정하지 않는다**(T-069 §6.1 제외 규칙 3 · task '하지 않는 것'). 사용자가 [기록] 하거나 [입출금 아님] 으로 표시한다.
 * 키 = `${cur 스냅샷 id}-${통화}` — 스냅샷 id 는 바뀌지 않으므로 재조회에도 같다.
 */
import type { CandidateView, Currency } from './types';
import { RULE, type LedgerRules } from './rules';
import { consumeKey } from './match';
import { isExchangeLike, type SnapshotStep } from './snapshots';

export interface CandidateMark {
  state: 'dismissed';
  reason: string;
  /** KST 'YYYY-MM-DD HH:mm:ss' */
  at: string;
  byUserId: number | null;
}

export const candidateKey = (snapshotId: number, currency: Currency): string => `${snapshotId}-${currency}`;

export function detectCandidates(
  steps: readonly SnapshotStep[],
  opts: {
    baselineAtMs: number;
    consumed: ReadonlySet<string>;
    flipStepIds: ReadonlySet<number>;
    marks: Readonly<Record<string, CandidateMark>>;
    rules?: LedgerRules;
  },
): CandidateView[] {
  const rules = opts.rules ?? RULE;
  const out: CandidateView[] = [];
  const push = (st: SnapshotStep, currency: Currency, delta: number) => {
    const key = candidateKey(st.cur.id, currency);
    const mark = opts.marks[key];
    out.push({
      key, snapshotId: st.cur.id, ts: st.cur.ts, prevSnapshotId: st.prev.id, prevTs: st.prev.ts, currency, delta,
      direction: delta > 0 ? 'deposit' : 'withdrawal',
      state: mark ? 'dismissed' : 'open',
      reason: mark ? mark.reason : null,
      dismissedAt: mark ? mark.at : null,
      dismissedByUserId: mark ? mark.byUserId : null,
    });
  };
  for (const st of steps) {
    if (st.prev.tsMs < opts.baselineAtMs) continue;
    if (!st.holdingsSame) continue;
    if (isExchangeLike(st.dKrw, st.dUsdCents, st.cur.usd?.fx ?? null, rules)) continue;
    if (st.dKrw != null && Math.abs(st.dKrw) >= rules.krw && !opts.consumed.has(consumeKey(st.cur.id, 'KRW'))) {
      push(st, 'KRW', st.dKrw);
    }
    if (
      st.dUsdCents != null && Math.abs(st.dUsdCents) >= rules.usd * 100
      && !opts.flipStepIds.has(st.cur.id) && !opts.consumed.has(consumeKey(st.cur.id, 'USD'))
    ) {
      push(st, 'USD', st.dUsdCents / 100);
    }
  }
  // 최신순, 같은 스냅샷이면 원화 먼저
  out.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : a.currency === b.currency ? 0 : a.currency === 'KRW' ? -1 : 1));
  return out;
}
