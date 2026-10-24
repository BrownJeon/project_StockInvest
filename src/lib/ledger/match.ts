/**
 * T-074 — 지연 매칭: 원장 기록 ↔ 스냅샷 현금 변화 (순수 함수, DB 없음).
 *
 * 규칙(Analyst Q1⑤·Q3, 데모 반영 상태 3종):
 *  - "흐름은 그것이 처음 보이는 스냅샷 시각에 들어온 것으로 본다." 기록 시각 ≤ cur.ts ≤ 기록 시각 + windowH(36h) 인 연속 단계(prev→cur)를
 *    시간순으로 보며 현금 변화가 금액과 맞는(허용치 max(1,000원|$1, 금액×0.1%)) **첫 단계**의 cur 스냅샷을 앵커로 잡는다.
 *      입금 = +금액, 출금 = −금액. 원화 변화 = free+locked, 달러 변화 = 수량(센트).
 *      환전 = 같은 단계에서 낸 통화 −금액·받은 통화 +금액이 함께 맞거나, 연속 두 단계에 나눠 맞으면(앵커 = 뒤 단계).
 *  - 기록 시각 이후 스냅샷이 아직 없으면 **pending**(반영 대기 — 순입금에서 제외). 데모 `predict` 와 같은 경계.
 *  - 이후 스냅샷이 있는데 맞는 변화가 없으면 **unmatched**(불일치 — 사용자 기록을 믿고 순입금에 포함, 경고). 창이 열려 있는 동안은
 *    조회마다 다시 맞춰 보고, 나중에 맞으면 matched 로 바뀐다.
 *  - 입출금으로 맞춘 단계에서 반대 통화가 반대 방향으로 비슷한 가치만큼 움직였으면(환전처럼 보임) 맞추지 않고 '환전으로 정정' 제안을 단다
 *    (Analyst Q3 #2 — 환전을 달러 입금으로 적으면 P 가 그 금액만큼 과소).
 *  - **한 변화는 한 기록만 잡는다**(소비 키 `${cur id}:${통화}`) — 같은 입금을 두 번 적으면 두 번째는 불일치로 남는다(Q3 #5).
 *    이미 matched 인 기록이 먼저 자기 키를 차지하고, 두 matched 기록이 같은 키를 잡고 있으면(동시 저장 경합) 늦은 쪽을 다시 맞춘다.
 *  - USD 입출금의 원화 환산 환율 = 앵커 스냅샷 USD 행 환율(소수 4자리). 불일치면 기록 시각 뒤 첫 스냅샷 환율로 고정(최신 환율로 흔들리지 않게).
 *    환전은 krwEquiv 없음, fxRateUsed = 앵커 스냅샷 환율(비용 추정용).
 *
 * 한계(기록): 같은 구간에 같은 통화 기록이 여러 건이면 합계로 맞추지 않는다(각각 불일치가 될 수 있다 — 순입금에는 기록대로 들어가 P 는 맞다).
 * 같은 단계에서 입금과 환전이 섞이면(예: 원화 입금 뒤 곧바로 전액 환전) 어느 쪽도 맞지 않아 불일치로 남는다.
 */
import type { AnchorStatus, Currency, EntryKind, ExchangeSuggestion } from './types';
import { isUsd, RULE, tolKrwFor, tolUsdFor, type LedgerRules } from './rules';
import { formatKstShort, HOUR_MS, parseKstWall } from './kst';
import { roundFx, toCents, usdToKrw } from './compute';
import { isExchangeLike, type LedgerSnapshot, type SnapshotStep } from './snapshots';
import { fmtSignedUsd, fmtSignedWon, fmtUsd, groupInt } from './korean-amount';

export interface MatchEntry {
  id: number;
  kind: EntryKind;
  occurredAtMs: number;
  currency: Currency;
  amount: number;
  counterCurrency: Currency | null;
  counterAmount: number | null;
  anchorStatus: AnchorStatus;
  anchorSnapshotId: number | null;
  voided: boolean;
}

export interface AnchorResult {
  status: AnchorStatus;
  snapshotId: number | null;
  snapshotTs: string | null;
  detail: string | null;
  fxRateUsed: number | null;
  fxSource: 'snapshot' | null;
  krwEquiv: number | null;
  suggest: ExchangeSuggestion | null;
}

export interface MatchOutput {
  /** 이번에 맞춰 본 기록만 (나머지는 저장 상태 유지) */
  results: Map<number, AnchorResult>;
  /** 살아 있는 반영됨 기록이 차지한 변화 `${cur id}:${통화}` — 후보 탐지에서 뺀다 */
  consumed: Set<string>;
}

export const consumeKey = (snapshotId: number, currency: Currency): string => `${snapshotId}:${currency}`;

const UNMATCHED_TEXT = '이 시각 뒤 스냅샷에서 맞는 현금 변화를 찾지 못했습니다.';

function tolText(currency: Currency, amount: number, rules: LedgerRules): string {
  if (currency === 'KRW') return `±${groupInt(tolKrwFor(amount, rules))}원`;
  const t = tolUsdFor(amount, rules);
  return Number.isInteger(t) ? `±$${t}` : `±${fmtUsd(t)}`;
}

/** 단계의 그 통화 변화가 기대값(부호 있음)과 허용치 안에서 맞는가 */
export function deltaMatches(st: SnapshotStep, currency: Currency, expected: number, rules: LedgerRules = RULE): boolean {
  if (currency === 'KRW') {
    if (st.dKrw == null) return false;
    return Math.abs(st.dKrw - Math.round(expected)) <= tolKrwFor(expected, rules);
  }
  if (st.dUsdCents == null) return false;
  return Math.abs(st.dUsdCents - toCents(expected)) <= tolUsdFor(expected, rules) * 100 + 1e-9;
}

function flowText(currency: Currency, st: SnapshotStep): string {
  return currency === 'KRW' ? `원화 현금 ${fmtSignedWon(st.dKrw ?? 0)}` : `달러 현금 ${fmtSignedUsd((st.dUsdCents ?? 0) / 100)}`;
}

/** 보유가 바뀐 단계에서 맞았을 때 근거 문장 끝에 붙는 한 줄 (Reviewer L4) */
export function tradeNoteText(kind: 'deposit' | 'withdrawal' | 'exchange'): string {
  return `같은 단계에 매매가 있어 정확히 ${kind === 'withdrawal' ? '출금' : '입금'} 때문이라고 확인하지는 못했습니다.`;
}

function clip(s: string): string {
  return Array.from(s).slice(0, 200).join('');
}

interface Ctx {
  series: readonly LedgerSnapshot[];
  steps: readonly SnapshotStep[];
  consumed: Set<string>;
  rules: LedgerRules;
}

function firstAfter(series: readonly LedgerSnapshot[], t: number): LedgerSnapshot | null {
  for (const s of series) if (s.tsMs >= t) return s;
  return null;
}

const PENDING: AnchorResult = {
  status: 'pending', snapshotId: null, snapshotTs: null, detail: null, fxRateUsed: null, fxSource: null, krwEquiv: null, suggest: null,
};

function evalFlow(e: MatchEntry, c: Ctx): AnchorResult {
  const after = firstAfter(c.series, e.occurredAtMs);
  if (!after) return PENDING;
  const expected = (e.kind === 'deposit' ? 1 : -1) * e.amount;
  const end = e.occurredAtMs + c.rules.windowH * HOUR_MS;
  let suggest: ExchangeSuggestion | null = null;
  for (const st of c.steps) {
    if (st.cur.tsMs < e.occurredAtMs) continue;
    if (st.cur.tsMs > end) break;
    if (!deltaMatches(st, e.currency, expected, c.rules)) continue;
    const key = consumeKey(st.cur.id, e.currency);
    if (c.consumed.has(key)) continue;
    if (isExchangeLike(st.dKrw, st.dUsdCents, st.cur.usd?.fx ?? null, c.rules)) {
      if (!suggest) {
        suggest = { kind: 'exchange', snapshotId: st.cur.id, snapshotTs: st.cur.ts, krwDelta: st.dKrw ?? 0, usdDelta: (st.dUsdCents ?? 0) / 100 };
      }
      continue;
    }
    c.consumed.add(key);
    const fx = isUsd(e.currency) ? st.cur.usd?.fx ?? null : null;
    // 같은 단계에 보유 수량 변화(매매)가 있으면 현금 변화가 입출금 때문인지 확정할 수 없다 — 상태·계산은 그대로, 근거 문장에만 밝힌다(Reviewer L4)
    const tradeNote = st.holdingsSame ? '' : ` ${tradeNoteText(e.kind)}`;
    return {
      status: 'matched', snapshotId: st.cur.id, snapshotTs: st.cur.ts,
      detail: clip(`${flowText(e.currency, st)} 확인 (허용 ${tolText(e.currency, e.amount, c.rules)})${tradeNote}`),
      fxRateUsed: fx != null ? roundFx(fx) : null, fxSource: fx != null ? 'snapshot' : null,
      krwEquiv: e.currency === 'KRW' ? Math.round(e.amount) : fx != null ? usdToKrw(e.amount, fx) : null,
      suggest: null,
    };
  }
  // 불일치 — 기록대로 계산에 넣는다. USD 는 기록 시각 뒤 첫 스냅샷 환율로 환산을 고정한다.
  const fx = isUsd(e.currency) ? after.usd?.fx ?? null : null;
  let detail = UNMATCHED_TEXT;
  if (suggest) {
    const dir = e.kind === 'deposit' ? '입금' : '출금';
    const what = isUsd(e.currency) ? `달러 ${fmtSignedUsd(expected)}` : `원화 ${fmtSignedWon(expected)}`;
    const other = isUsd(e.currency)
      ? `원화가 ${groupInt(suggest.krwDelta)}원 ${suggest.krwDelta < 0 ? '줄었' : '늘었'}습니다`
      : `달러가 ${fmtUsd(suggest.usdDelta)} ${suggest.usdDelta < 0 ? '줄었' : '늘었'}습니다`;
    detail = `이 시각 뒤 스냅샷에서 ${dir}으로 볼 ${what} 변화를 찾지 못했습니다. 같은 스냅샷(${formatKstShort(parseKstWall(suggest.snapshotTs) ?? 0)})에서 ${other} — 환전이었다면 환전으로 정정하세요.`;
  }
  return {
    status: 'unmatched', snapshotId: null, snapshotTs: null, detail: clip(detail),
    fxRateUsed: fx != null ? roundFx(fx) : null, fxSource: fx != null ? 'snapshot' : null,
    krwEquiv: e.currency === 'KRW' ? Math.round(e.amount) : fx != null ? usdToKrw(e.amount, fx) : null,
    suggest,
  };
}

/**
 * 반영됨 환전 결과. krwStep·usdStep = 원화·달러 변화가 맞은 단계(같은 단계면 둘이 같다), 앵커 = 둘 중 뒤 단계.
 * 문장은 원화 먼저(데모 '원화 −1,260,000원 · 달러 +$1,000.00').
 */
function exchangeMatched(krwStep: SnapshotStep, usdStep: SnapshotStep): AnchorResult {
  const anchor = krwStep.cur.tsMs >= usdStep.cur.tsMs ? krwStep : usdStep;
  const first = anchor === krwStep ? usdStep : krwStep;
  const body = `원화 ${fmtSignedWon(krwStep.dKrw ?? 0)} · 달러 ${fmtSignedUsd((usdStep.dUsdCents ?? 0) / 100)} 확인`;
  const two = krwStep !== usdStep;
  const fx = anchor.cur.usd?.fx ?? null;
  return {
    status: 'matched', snapshotId: anchor.cur.id, snapshotTs: anchor.cur.ts,
    detail: clip(two ? `연속 두 스냅샷(${formatKstShort(first.cur.tsMs)}·${formatKstShort(anchor.cur.tsMs)})에서 ${body}` : `같은 스냅샷에서 ${body}`),
    fxRateUsed: fx != null ? roundFx(fx) : null, fxSource: fx != null ? 'snapshot' : null, krwEquiv: null, suggest: null,
  };
}

function evalExchange(e: MatchEntry, c: Ctx): AnchorResult {
  const after = firstAfter(c.series, e.occurredAtMs);
  if (!after) return PENDING;
  const from = e.currency;
  const to = e.counterCurrency as Currency;
  const expFrom = -e.amount;
  const expTo = e.counterAmount as number;
  const end = e.occurredAtMs + c.rules.windowH * HOUR_MS;
  const ok = (st: SnapshotStep, ccy: Currency, exp: number) => deltaMatches(st, ccy, exp, c.rules) && !c.consumed.has(consumeKey(st.cur.id, ccy));
  for (let i = 0; i < c.steps.length; i++) {
    const st = c.steps[i];
    if (st.cur.tsMs < e.occurredAtMs) continue;
    if (st.cur.tsMs > end) break;
    const fOk = ok(st, from, expFrom);
    const tOk = ok(st, to, expTo);
    if (fOk && tOk) {
      c.consumed.add(consumeKey(st.cur.id, from));
      c.consumed.add(consumeKey(st.cur.id, to));
      return exchangeMatched(st, st);
    }
    const nx = c.steps[i + 1];
    if (nx && nx.cur.tsMs <= end) {
      if (fOk && ok(nx, to, expTo)) {
        c.consumed.add(consumeKey(st.cur.id, from));
        c.consumed.add(consumeKey(nx.cur.id, to));
        return from === 'KRW' ? exchangeMatched(st, nx) : exchangeMatched(nx, st);
      }
      if (tOk && ok(nx, from, expFrom)) {
        c.consumed.add(consumeKey(st.cur.id, to));
        c.consumed.add(consumeKey(nx.cur.id, from));
        return from === 'KRW' ? exchangeMatched(nx, st) : exchangeMatched(st, nx);
      }
    }
  }
  return { status: 'unmatched', snapshotId: null, snapshotTs: null, detail: UNMATCHED_TEXT, fxRateUsed: null, fxSource: null, krwEquiv: null, suggest: null };
}

/** 저장된 반영됨 환전이 차지하는 키 — 앵커 단계에서 두 통화가 다 맞으면 그 단계, 아니면 직전 단계와 나눠 본다 */
function exchangeKeys(e: MatchEntry, idx: Map<number, number>, steps: readonly SnapshotStep[], rules: LedgerRules): string[] {
  const a = e.anchorSnapshotId as number;
  const from = e.currency;
  const to = e.counterCurrency as Currency;
  const i = idx.get(a);
  if (i == null) return [consumeKey(a, from), consumeKey(a, to)];
  const st = steps[i];
  const fOk = deltaMatches(st, from, -e.amount, rules);
  const tOk = deltaMatches(st, to, e.counterAmount as number, rules);
  const pv = i > 0 ? steps[i - 1] : null;
  if (!(fOk && tOk) && pv) {
    if (tOk && deltaMatches(pv, from, -e.amount, rules)) return [consumeKey(pv.cur.id, from), consumeKey(a, to)];
    if (fOk && deltaMatches(pv, to, e.counterAmount as number, rules)) return [consumeKey(a, from), consumeKey(pv.cur.id, to)];
  }
  return [consumeKey(a, from), consumeKey(a, to)];
}

const byTime = (x: MatchEntry, y: MatchEntry) => x.occurredAtMs - y.occurredAtMs || x.id - y.id;

/**
 * 살아 있는 기록을 스냅샷과 맞춘다.
 *  - rematchAll=false(조회): 반영됨은 그대로 두고 나머지(반영 대기·불일치)만 다시 맞춘다.
 *  - rematchAll=true(POST /rematch): 반영됨까지 처음부터 다시 맞춘다.
 *  - 기록 시각이 scanFromMs 보다 이르면 이번에 읽은 스냅샷 밖이라 저장 상태를 유지한다(반영됨이면 키는 차지한다).
 */
export function matchEntries(
  entries: readonly MatchEntry[],
  series: readonly LedgerSnapshot[],
  steps: readonly SnapshotStep[],
  opts: { rematchAll?: boolean; scanFromMs: number; rules?: LedgerRules },
): MatchOutput {
  const rules = opts.rules ?? RULE;
  const idx = new Map<number, number>();
  steps.forEach((s, i) => idx.set(s.cur.id, i));
  const consumed = new Set<string>();
  const results = new Map<number, AnchorResult>();
  const live = entries.filter((e) => !e.voided).slice().sort(byTime);
  const keysOf = (e: MatchEntry) => (e.kind === 'exchange'
    ? exchangeKeys(e, idx, steps, rules)
    : [consumeKey(e.anchorSnapshotId as number, e.currency)]);

  const toEval: MatchEntry[] = [];
  for (const e of live) {
    const isMatched = e.anchorStatus === 'matched' && e.anchorSnapshotId != null;
    if (e.occurredAtMs < opts.scanFromMs) {
      if (isMatched) for (const k of keysOf(e)) consumed.add(k);
      continue;
    }
    if (!opts.rematchAll && isMatched) {
      const keys = keysOf(e);
      if (keys.some((k) => consumed.has(k))) { toEval.push(e); continue; }
      for (const k of keys) consumed.add(k);
      continue;
    }
    toEval.push(e);
  }
  toEval.sort(byTime);
  const ctx: Ctx = { series, steps, consumed, rules };
  for (const e of toEval) {
    results.set(e.id, e.kind === 'exchange' ? evalExchange(e, ctx) : evalFlow(e, ctx));
  }
  return { results, consumed };
}
