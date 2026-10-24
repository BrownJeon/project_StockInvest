/**
 * T-074 자금 이동 원장 — 계산 (순수 함수, 서버·클라이언트 공용).
 *
 * 승인 데모(`mockups/T-074-cash-flow-ledger-v1.html`)의 `baseTotal`·`keq`·`calc`·`simCalc`·`predict`·`exRate`·`exCost` 를 옮겼다.
 * 공식(Analyst Q1 MVP):
 *   P = (현재 총자산 − 기준 총자산) − Σ 기준 이후 순입금(원화 환산, 반영된 것만 — 반영 대기 제외, 불일치는 기록대로 포함)
 *   R = P ÷ (기준 총자산 + Σ w_i·CF_i) × 100,  w_i = (t − t_i) ÷ (t − t₀)   ← Modified Dietz(근사)
 *   환전은 계좌 안 이동이라 순입금 0 (스프레드 비용은 총자산 하락으로 P 에 저절로 들어간다).
 *
 * 데모와 다르게 바꾼 곳(의미는 같고 돈 계산의 정확성만 다룸):
 *  1. 원화 환산·기준 총자산 보정을 **정수 산술(BigInt)** 로 한다 — 달러는 센트, 환율은 소수 4자리(DDL DECIMAL(12,4) 와 같은 자)로 맞춘 뒤
 *     곱하고 원 단위로 반올림(Math.round 와 같은 '반은 +∞ 쪽'). 데모는 부동소수 곱이라 118.60 × 1324.63 같은 값에서 끝자리가 흔들린다.
 *     결과적으로 V·b₀·순입금이 모두 정수 원이라 "현재 − 기준 − 순입금 = 손익" 줄이 1원도 어긋나지 않는다.
 *  2. 시각은 API 문자열(KST 벽시계)을 받아 내부에서 벽시계 ms 로 바꾼다(데모는 분 단위 숫자).
 *  3. 환율이 없어 원화로 바꿀 수 없는 USD 기록은 계산에서 빼고 `fxMissing` 으로 센다(데모에는 환율이 항상 있다).
 *  4. 기준 현금 '확인' 판정에서 스냅샷에 USD 행이 없으면(해외 비활성) 달러 확인을 요구하지 않는다(데모는 늘 둘 다 요구 — 그러면 해외를 안 쓰는 계좌는 영원히 '미확정').
 */
import type {
  AnchorStatus, BaselineView, CandidateView, Currency, EntryKind, LedgerEntryView, LedgerSummary, LedgerSummaryLast,
} from './types';
import { isUsd, RULE, tolKrwFor, tolUsdFor, type LedgerRules } from './rules';
import { DAY_MS, formatKstWall, parseKstWall } from './kst';

// ─── 돈 산술 ──────────────────────────────────────────────────────────────

/** 달러 → 센트(정수) */
export function toCents(usd: number): number {
  return Math.round(usd * 100);
}

/** 환율 → 소수 4자리 정수(× 10⁴) — DDL `fx_rate_used DECIMAL(12,4)` 와 같은 자 */
export function toFx4(fx: number): number {
  return Math.round(fx * 10_000);
}

/** 환율을 소수 4자리로 맞춘 값 */
export function roundFx(fx: number): number {
  return toFx4(fx) / 10_000;
}

function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== BigInt(0) && (a < BigInt(0)) !== (b < BigInt(0)) ? q - BigInt(1) : q;
}

/** a ÷ b 를 Math.round 의미(반은 +∞ 쪽)로 정수화 (b > 0) */
function roundDiv(a: bigint, b: bigint): bigint {
  return floorDiv(BigInt(2) * a + b, BigInt(2) * b);
}

const E6 = BigInt(1_000_000);

/** 달러 금액 × 환율 → 원(정수, 반올림). 센트 × (환율×10⁴) ÷ 10⁶ */
export function usdToKrw(usd: number, fx: number): number {
  return Number(roundDiv(BigInt(toCents(usd)) * BigInt(toFx4(fx)), E6));
}

/** 같은 금액인가 — 원화는 원, 달러는 센트로 비교(부동소수 오차 없음) */
export function sameAmount(currency: Currency, a: number, b: number): boolean {
  return isUsd(currency) ? toCents(a) === toCents(b) : Math.round(a) === Math.round(b);
}

// ─── 기준 총자산 ──────────────────────────────────────────────────────────

export type BaselineLike = Pick<BaselineView, 'totalKrw' | 'krwCash' | 'usdCash' | 'fx' | 'confirmed'>;

/**
 * 기준 총자산(데모 `baseTotal`) = 스냅샷 총자산 + (확인 달러 − 스냅샷 달러) × 스냅샷 환율 + (확인 원화 − 스냅샷 원화), 원 단위 반올림.
 * 확인값이 null 이면 그 항은 0(스냅샷 값 사용).
 */
export function baseTotal(b: BaselineLike): number {
  const c = b.confirmed ?? { krwCash: null, usdCash: null };
  let num = BigInt(Math.round(b.totalKrw)) * E6;
  if (c.usdCash != null && b.usdCash != null && b.fx != null && b.fx > 0) {
    num += BigInt(toCents(c.usdCash) - toCents(b.usdCash)) * BigInt(toFx4(b.fx));
  }
  if (c.krwCash != null) num += BigInt(Math.round(c.krwCash) - Math.round(b.krwCash)) * E6;
  return Number(roundDiv(num, E6));
}

/** 기준 현금 미확정인가(데모 `baseUnconfirmed`) — 스냅샷에 USD 행이 없으면 달러 확인은 요구하지 않는다 */
export function baselineUnconfirmed(b: Pick<BaselineView, 'usdCash' | 'confirmed'>): boolean {
  const c = b.confirmed ?? { krwCash: null, usdCash: null };
  if (c.krwCash == null) return true;
  return b.usdCash != null && c.usdCash == null;
}

// ─── 기록 1건의 원화 환산 ─────────────────────────────────────────────────

export type SummaryEntry = Pick<
  LedgerEntryView,
  'id' | 'kind' | 'occurredAt' | 'currency' | 'amount' | 'counterCurrency' | 'counterAmount' | 'anchor' | 'fxRateUsed' | 'krwEquiv' | 'void'
>;

/**
 * 순입금용 원화 환산(데모 `keq`). 환전은 null.
 * KRW = 금액, USD = 저장된 krwEquiv → 없으면 금액 × (fxRateUsed ?? 최신 스냅샷 환율).
 */
export function krwEquivOf(
  e: Pick<SummaryEntry, 'kind' | 'currency' | 'amount' | 'krwEquiv' | 'fxRateUsed'>,
  latestFx: number | null,
): number | null {
  if (e.kind === 'exchange') return null;
  if (e.currency === 'KRW') return Math.round(e.amount);
  if (e.krwEquiv != null) return Math.round(e.krwEquiv);
  const fx = e.fxRateUsed ?? latestFx;
  return fx != null && fx > 0 ? usdToKrw(e.amount, fx) : null;
}

// ─── 요약 (데모 calc) ─────────────────────────────────────────────────────

export interface SummaryInput {
  baseline: BaselineLike & Pick<BaselineView, 'at'> | null;
  snapshot: { ts: string; totalKrw: number; fx: number | null } | null;
  entries: readonly SummaryEntry[];
}

function lastOf(entries: readonly SummaryEntry[]): LedgerSummaryLast | null {
  let best: SummaryEntry | null = null;
  let bestT = -Infinity;
  for (const e of entries) {
    if (e.void) continue;
    const t = parseKstWall(e.occurredAt) ?? -Infinity;
    if (best === null || t > bestT || (t === bestT && e.id > best.id)) { best = e; bestT = t; }
  }
  if (!best) return null;
  return {
    id: best.id, occurredAt: best.occurredAt, kind: best.kind, currency: best.currency, amount: best.amount,
    counterCurrency: best.counterCurrency, counterAmount: best.counterAmount, status: best.anchor.status,
  };
}

/**
 * 입출금 뺀 투자 손익 요약. 기준 또는 스냅샷이 없으면 null.
 * 데모 `calc()` 와 같은 순서로 센다: 취소·정정 제외 → 기준 이전 제외(pre) → 환전 제외 → 반영 대기는 따로 → 나머지(반영됨·불일치)는 순입금.
 * 가중치의 흐름 시각 = 반영됨이면 반영 스냅샷 시각, 아니면 기록 시각.
 */
export function computeSummary(input: SummaryInput): LedgerSummary | null {
  const B = input.baseline;
  const S = input.snapshot;
  if (!B || !S) return null;
  const bAt = parseKstWall(B.at);
  const sTs = parseKstWall(S.ts);
  if (bAt == null || sTs == null) return null;

  const b0 = baseTotal(B);
  const v = Math.round(S.totalKrw);
  const flows: { t: number; cf: number }[] = [];
  const pending = { count: 0, krw: 0 };
  let inflow = 0;
  let outflow = 0;
  let unmatched = 0;
  let pre = 0;
  let live = 0;
  let voids = 0;
  let fxMissing = 0;

  for (const e of input.entries) {
    if (e.void) { voids++; continue; }
    live++;
    const t = parseKstWall(e.occurredAt);
    if (t == null) continue;
    if (t <= bAt) { pre++; continue; }
    if (e.kind === 'exchange') continue;
    const k = krwEquivOf(e, S.fx);
    const sg = e.kind === 'deposit' ? 1 : -1;
    if (e.anchor.status === 'pending') {
      pending.count++;
      if (k == null) fxMissing++; else pending.krw += sg * k;
      continue;
    }
    if (k == null) { fxMissing++; continue; }
    if (e.anchor.status === 'unmatched') unmatched++;
    const anchorT = e.anchor.status === 'matched' && e.anchor.snapshotTs ? parseKstWall(e.anchor.snapshotTs) : null;
    flows.push({ t: anchorT ?? t, cf: sg * k });
    if (sg > 0) inflow += k; else outflow += k;
  }

  const net = inflow - outflow;
  const P = v - b0 - net;
  const T = sTs - bAt;
  let den = b0;
  for (const f of flows) {
    const w = T > 0 ? Math.max(0, Math.min(1, (sTs - f.t) / T)) : 0;
    den += w * f.cf;
  }
  return {
    P, R: den > 0 ? (P / den) * 100 : null, b0, v, net, inflow, outflow, pending, unmatched, pre, live, voids,
    last: lastOf(input.entries), days: Math.floor(T / DAY_MS), unconfirmed: baselineUnconfirmed(B), fxMissing,
  };
}

/** 데모 `simCalc` — 기록 목록 사본을 바꿔 본 뒤의 요약(확인 단계·취소·되살리기 미리보기). 원본은 바꾸지 않는다 */
export function simulateSummary<E extends SummaryEntry>(
  input: Omit<SummaryInput, 'entries'> & { entries: readonly E[] },
  mutate: (entries: E[]) => E[] | void,
): LedgerSummary | null {
  const copy = input.entries.map((e) => JSON.parse(JSON.stringify(e)) as E);
  const out = mutate(copy);
  return computeSummary({ ...input, entries: out ?? copy });
}

// ─── 환전 ─────────────────────────────────────────────────────────────────

type ExchangeLike = Pick<LedgerEntryView, 'kind' | 'currency' | 'amount' | 'counterAmount'>;

/** 적용 환율 = 원화 ÷ 달러 (데모 `exRate`). 환전이 아니면 null */
export function exchangeRate(e: ExchangeLike): number | null {
  if (e.kind !== 'exchange' || e.counterAmount == null) return null;
  const krw = e.currency === 'KRW' ? e.amount : e.counterAmount;
  const usd = e.currency === 'KRW' ? e.counterAmount : e.amount;
  return usd > 0 ? krw / usd : null;
}

/**
 * 환전 비용(추정, 원) — 데모 `exCost`: 원화→달러 = 낸 원화 − 받은 달러 × 기준 환율 / 달러→원화 = 낸 달러 × 기준 환율 − 받은 원화.
 * 기준 환율 = 반영 스냅샷 환율(없으면 최신 스냅샷 환율). '추정(기준 = 앱 환율, KIS 고시환율 아님)' 라벨과 함께 보인다.
 */
export function exchangeCostKrw(e: ExchangeLike, fx: number | null): number | null {
  if (e.kind !== 'exchange' || e.counterAmount == null || fx == null || !(fx > 0)) return null;
  return e.currency === 'KRW'
    ? Math.round(e.amount) - usdToKrw(e.counterAmount, fx)
    : usdToKrw(e.amount, fx) - Math.round(e.counterAmount);
}

// ─── 확인 단계 미리보기 (데모 predict·buildEntry) ─────────────────────────

export interface DraftForPredict {
  kind: EntryKind;
  currency: Currency;
  amount: number;
  /** 벽시계 ms */
  occurredAtMs: number;
}

/**
 * 저장 전 반영 상태 예측(데모 `predict`) — 화면 미리보기용. **실제 상태는 서버가 스냅샷과 맞춰 정한다.**
 *  - 환전: 최신 스냅샷보다 뒤면 pending, 아니면 unmatched
 *  - 열린 후보와 통화·방향·금액(허용치)·시각(직전 스냅샷 < t ≤ 후보 스냅샷)이 맞으면 matched(그 스냅샷)
 *  - 아니면 최신 스냅샷보다 뒤면 pending, 아니면 unmatched
 */
export function predictAnchor(
  d: DraftForPredict,
  ctx: { snapshotTs: string | null; candidate?: CandidateView | null; rules?: LedgerRules },
): { status: AnchorStatus; anchorTs: string | null } {
  const rules = ctx.rules ?? RULE;
  const snapTs = ctx.snapshotTs ? parseKstWall(ctx.snapshotTs) : null;
  const afterSnap = snapTs == null || d.occurredAtMs > snapTs;
  const fallback = { status: (afterSnap ? 'pending' : 'unmatched') as AnchorStatus, anchorTs: null };
  if (d.kind === 'exchange') return fallback;
  const C = ctx.candidate;
  if (!C || C.state !== 'open' || C.currency !== d.currency) return fallback;
  if (d.kind !== (C.delta > 0 ? 'deposit' : 'withdrawal')) return fallback;
  const tol = d.currency === 'KRW' ? tolKrwFor(d.amount, rules) : tolUsdFor(d.amount, rules);
  const prev = parseKstWall(C.prevTs);
  const ts = parseKstWall(C.ts);
  if (prev == null || ts == null) return fallback;
  const hit = Math.abs(d.amount - Math.abs(C.delta)) <= tol && d.occurredAtMs > prev && d.occurredAtMs <= ts;
  return hit ? { status: 'matched', anchorTs: C.ts } : fallback;
}

/**
 * 미리보기용 가상 기록(데모 `buildEntry`) — `simulateSummary` 에 넣어 저장 뒤 손익을 보여 줄 때 쓴다.
 * 반영됨으로 예측된 USD 입출금은 최신 스냅샷 환율로 환산한다(데모와 같다).
 */
export function draftEntryView(
  d: {
    kind: EntryKind; currency: Currency; amount: number; occurredAtMs: number;
    counterCurrency?: Currency | null; counterAmount?: number | null; memo?: string | null;
  },
  predicted: { status: AnchorStatus; anchorTs: string | null },
  opts: { id: number; snapshotFx: number | null; nowMs: number; supersedes?: number | null },
): LedgerEntryView {
  const usdMatched = predicted.status === 'matched' && d.kind !== 'exchange' && isUsd(d.currency) && opts.snapshotFx != null;
  return {
    id: opts.id, clientEntryId: 'preview', kind: d.kind, occurredAt: formatKstWall(d.occurredAtMs).slice(0, 16),
    currency: d.currency, amount: d.amount,
    counterCurrency: d.kind === 'exchange' ? d.counterCurrency ?? null : null,
    counterAmount: d.kind === 'exchange' ? d.counterAmount ?? null : null,
    memo: d.memo ?? null, source: 'user', createdAt: formatKstWall(opts.nowMs), createdByUserId: null,
    anchor: { status: predicted.status, snapshotId: null, snapshotTs: predicted.anchorTs, detail: null, suggest: null },
    fxRateUsed: usdMatched ? roundFx(opts.snapshotFx as number) : null,
    fxSource: usdMatched ? 'snapshot' : null,
    krwEquiv: null,
    supersedes: opts.supersedes ?? null, supersededBy: null, void: null, beforeBaseline: false,
  };
}
