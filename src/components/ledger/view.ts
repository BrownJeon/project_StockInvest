/**
 * T-074 입출금 기록 화면 — 표시용 순수 함수 (JSX 없음, node 시험 대상).
 *
 * 승인 데모 v1 의 `KIND`·`statusParts`·`entryAmt`·`entryMeta`·`entryExtra`·`exRate`·`exCost`·`md`·`ago`·`spct`·`plCls`·`plWord`
 * 를 API 타입(`src/lib/ledger/types.ts`) 위에 옮겼다. 문구는 데모 그대로다. 데모와 다른 곳(근거는 task Developer Stage 2):
 *  - (Leader 승인 P2-2) 환전 기록이 '불일치'면 amber `! 불일치` 대신 중립 `◌ 확인 전` — 환전은 손익 영향이 없어 경고처럼 보이지 않게.
 *  - (Leader 승인 Minor-1 + designer 구현 점검 a11y Minor-1) 목록 행 버튼의 접근 이름을 "#1 입금 1,000,000원, 09-03 10:00, 반영됨" 으로 줄였다
 *    (`rowAriaLabel` — 상세·표지가 '#n' 으로 가리키므로 번호를 앞에 둔다).
 *  - 달러 기록의 원화 환산 출처: 데모는 '반영됨'만 고정 환율이었는데 WP-A 는 '불일치'도 기록 뒤 첫 스냅샷 환율로 고정한다
 *    (Stage 1 설계 차이 14) — 그 경우 "(기록 뒤 첫 스냅샷 환율 …)" 로 출처를 사실대로 적는다.
 * 통화 분기는 `isUsd()` 한 함수를 거친다(T-056 `usd-cash-balance-fence` 시험 — 원장 값 비교라 잔고 배열과 무관).
 */
import type { Currency, EntryKind, LedgerEntryView } from '@/lib/ledger/types';
import { isUsd } from '@/lib/ledger/rules';
import { exchangeCostKrw, exchangeRate, krwEquivOf } from '@/lib/ledger/compute';
import { fmtAmount, fmtRate, fmtSignedWon, fmtUsd, fmtWon } from '@/lib/ledger/korean-amount';
import { entryOneLine } from '@/lib/ledger/validate';

export type StKind = 'warn' | 'ok' | 'na' | 'info';
export type StatusParts = readonly [StKind, string, string];

export const MINUS = '−';

/** 마이그레이션 전(503 not_migrated) 중립 문장 — 원장 화면·설정 요약 행이 같은 문장 하나를 쓴다(designer 구현 점검 P1-2) */
export const NOT_READY_TEXT = '준비 중 — 서버 준비 뒤 쓸 수 있습니다';

export const KIND: Record<EntryKind, { label: string; icon: string; desc: string }> = {
  deposit: { label: '입금', icon: '+', desc: '계좌로 들어온 돈' },
  withdrawal: { label: '출금', icon: MINUS, desc: '계좌에서 나간 돈' },
  exchange: { label: '환전', icon: '⇄', desc: '원화↔달러 · 손익 영향 없음' },
};

// ─── 시각 ─────────────────────────────────────────────────────────────────

/** 'YYYY-MM-DD HH:mm[:ss]' → 'MM-DD HH:mm' (데모 `md`) */
export function md(ts: string | null | undefined): string {
  return ts ? ts.slice(5, 16) : '—';
}

/** 'YYYY-MM-DD HH:mm[:ss]' → 'YYYY-MM-DD HH:mm' (데모 `iso`) */
export function isoMin(ts: string | null | undefined): string {
  return ts ? ts.slice(0, 16) : '—';
}

/** 'YYYY-MM-DD HH:mm[:ss]' → 'HH:mm' (데모 `iso(t).slice(11)`) */
export function hm(ts: string | null | undefined): string {
  return ts ? ts.slice(11, 16) : '—';
}

/** n분 → '2시간 5분 전' · '15분 전' (데모 `ago`) */
export function ago(mins: number): string {
  const m0 = Math.max(0, Math.round(mins));
  const h = Math.floor(m0 / 60);
  const m = m0 % 60;
  return h ? `${h}시간 ${m ? `${m}분 ` : ''}전` : `${m}분 전`;
}

// ─── 숫자 ─────────────────────────────────────────────────────────────────

export const won = fmtWon;
export const swon = fmtSignedWon;
export const usd = fmtUsd;
export const rt = fmtRate;

/** +3.99% / −1.2% / 0.0% (데모 `spct`) */
export function spct(n: number, d = 1): string {
  return (n > 0 ? '+' : n < 0 ? MINUS : '') + Math.abs(n).toFixed(d) + '%';
}

/** 통화별 금액(절댓값) — 데모 `amtOf` */
export function amtOf(c: Currency, n: number): string {
  return fmtAmount(c, n);
}

/** 원화 칸 자리 표시(천 단위) — 데모 `n0` */
export function n0(n: number): string {
  return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 손익 색 클래스 — 빨강(늘어남)/파랑(줄어듦)은 손익에만 */
export function plCls(n: number): 'up' | 'down' | 'flat' {
  return n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
}

export function plWord(n: number): string {
  return n > 0 ? '늘어남' : n < 0 ? '줄어듦' : '변화 없음';
}

// ─── 기록 1건 ─────────────────────────────────────────────────────────────

type EntryLike = Pick<
  LedgerEntryView,
  'id' | 'kind' | 'currency' | 'amount' | 'counterCurrency' | 'counterAmount' | 'occurredAt' | 'memo' | 'anchor' | 'void' | 'beforeBaseline'
  | 'fxRateUsed' | 'krwEquiv' | 'supersedes' | 'supersededBy'
>;

/** 반영 상태 [색, 기호, 글자] — 데모 `statusParts` (+ P2-2 환전 불일치 = 중립 '확인 전') */
export function statusParts(e: Pick<EntryLike, 'kind' | 'anchor' | 'void' | 'beforeBaseline' | 'supersededBy'>): StatusParts {
  if (e.void) {
    return e.void.type === 'cancel' ? ['na', '×', '취소됨'] : ['na', '↻', `정정됨 → #${e.void.by ?? e.supersededBy ?? ''}`];
  }
  if (e.beforeBaseline) return ['na', '—', '기준 이전 · 계산 제외'];
  if (e.anchor.status === 'pending') return ['na', '◌', '반영 대기'];
  if (e.anchor.status === 'unmatched') return e.kind === 'exchange' ? ['na', '◌', '확인 전'] : ['warn', '!', '불일치'];
  return ['ok', '✓', '반영됨'];
}

/** '+1,000,000원' · '−$200.00' · '1,260,000원 → $1,000.00' — 데모 `entryAmt` */
export function entryAmt(e: Pick<EntryLike, 'kind' | 'currency' | 'amount' | 'counterCurrency' | 'counterAmount'>): string {
  if (e.kind === 'exchange' && e.counterCurrency && e.counterAmount != null) {
    return `${amtOf(e.currency, e.amount)} → ${amtOf(e.counterCurrency, e.counterAmount)}`;
  }
  return (e.kind === 'deposit' ? '+' : MINUS) + amtOf(e.currency, e.amount);
}

/** '입금 1,000,000원' — 데모 `entryOne` */
export function entryOne(e: Pick<EntryLike, 'kind' | 'currency' | 'amount' | 'counterCurrency' | 'counterAmount'>): string {
  return entryOneLine(e);
}

/** '원화' · '달러' · '원화→달러' · '달러→원화' */
export function currencyWord(e: Pick<EntryLike, 'kind' | 'currency'>): string {
  if (e.kind === 'exchange') return isUsd(e.currency) ? '달러→원화' : '원화→달러';
  return isUsd(e.currency) ? '달러' : '원화';
}

/** '09-03 10:00 · 원화 · 월급 일부' — 데모 `entryMeta` */
export function entryMeta(e: Pick<EntryLike, 'kind' | 'currency' | 'occurredAt' | 'memo'>): string {
  return `${md(e.occurredAt)} · ${currencyWord(e)}${e.memo ? ` · ${e.memo}` : ''}`;
}

/** 환전 적용 환율(원/$) — 데모 `exRate` */
export function exRate(e: Pick<EntryLike, 'kind' | 'currency' | 'amount' | 'counterAmount'>): number | null {
  return exchangeRate(e);
}

/** 환전 비용 추정의 기준 환율 — 반영 스냅샷 환율, 없으면 최신 스냅샷 환율(데모 `e.afx || M.snap.fx`) */
export function exchangeRefFx(e: Pick<EntryLike, 'fxRateUsed'>, snapFx: number | null): number | null {
  return e.fxRateUsed ?? snapFx;
}

/** 환전 비용(추정, 원) — 데모 `exCost` */
export function exCost(e: Pick<EntryLike, 'kind' | 'currency' | 'amount' | 'counterAmount' | 'fxRateUsed'>, snapFx: number | null): number | null {
  return exchangeCostKrw(e, exchangeRefFx(e, snapFx));
}

/** 순입금용 원화 환산 — 데모 `keq` */
export function keq(e: Pick<EntryLike, 'kind' | 'currency' | 'amount' | 'krwEquiv' | 'fxRateUsed'>, snapFx: number | null): number | null {
  return krwEquivOf(e, snapFx);
}

/** 달러 입출금 원화 환산의 환율 출처 */
export function usdFxSource(e: Pick<EntryLike, 'anchor' | 'fxRateUsed'>): 'anchor' | 'first_after' | 'latest' {
  if (e.fxRateUsed == null) return 'latest';
  return e.anchor.status === 'matched' ? 'anchor' : 'first_after';
}

/** 목록 행 셋째 줄(부가 정보) — 데모 `entryExtra`. 없으면 '' */
export function entryExtra(e: EntryLike, snapFx: number | null): string {
  if (e.kind === 'exchange') {
    const r = exRate(e);
    const cost = exCost(e, snapFx);
    return `환율 ${r != null ? rt(r) : '—'}원/$${cost != null ? ` · 비용(추정) ${won(cost)}` : ''} · 손익 영향 없음`;
  }
  if (isUsd(e.currency)) {
    const k = keq(e, snapFx);
    const head = `원화 환산 ${k != null ? won(k) : '—'}`;
    const src = usdFxSource(e);
    if (src === 'anchor') return `${head} (반영 시점 환율 ${rt(e.fxRateUsed as number)})`;
    if (src === 'first_after') return `${head} (기록 뒤 첫 스냅샷 환율 ${rt(e.fxRateUsed as number)})`;
    return `${head}${snapFx != null ? ` (임시 · 최신 환율 ${rt(snapFx)})` : ''}`;
  }
  if (e.supersedes != null) return `#${e.supersedes} 를 정정한 기록`;
  return '';
}

/** 목록 행 버튼 접근 이름 (Minor-1) — "#1 입금 1,000,000원, 09-03 10:00, 반영됨" */
export function rowAriaLabel(e: EntryLike): string {
  return `#${e.id} ${entryOne(e)}, ${md(e.occurredAt)}, ${statusParts(e)[2]}`;
}

/** 목록 정렬 — 발생 시각 최신순, 같으면 id 큰 것 먼저(데모 `visibleEntries`) */
export function sortEntries<E extends Pick<LedgerEntryView, 'occurredAt' | 'id'>>(entries: readonly E[]): E[] {
  return [...entries].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : b.id - a.id));
}

/** 보이는 기록 — 살아 있는 것만, 또는 취소·정정 포함 */
export function visibleEntries<E extends Pick<LedgerEntryView, 'occurredAt' | 'id' | 'void'>>(entries: readonly E[], showVoid: boolean): E[] {
  return sortEntries(entries.filter((e) => showVoid || !e.void));
}

/** 후보 현금 변화 '원화 현금 +700,000원' · '달러 현금 +$200.00' */
export function candidateDelta(c: { currency: Currency; delta: number }): { word: string; signed: string } {
  if (isUsd(c.currency)) {
    const cents = Math.round(c.delta * 100);
    return { word: '달러', signed: (cents > 0 ? '+' : cents < 0 ? MINUS : '') + fmtUsd(c.delta) };
  }
  return { word: '원화', signed: swon(c.delta) };
}

/** 후보 금액을 폼 금액 칸 문자열로 (원 = 정수, 달러 = 소수 2자리까지) */
export function candidateAmountText(c: { currency: Currency; delta: number }): string {
  if (isUsd(c.currency)) {
    const cents = Math.abs(Math.round(c.delta * 100));
    return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
  }
  return String(Math.abs(Math.round(c.delta)));
}
