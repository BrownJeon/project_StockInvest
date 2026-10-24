/**
 * T-074 — 기록 추가·정정 폼의 초안 모델 (순수 함수, node 시험 대상).
 *
 * 데모 `newDraft`·`validateEntry`·`predict`·`buildEntry`·`applyDraft`·`simCalc` 를 API 타입 위로 옮겼다.
 *  - 검증은 서버와 **같은 함수**(`validateEntryInput`)를 쓴다. 폼의 날짜·시각 두 칸을 'YYYY-MM-DD HH:mm' 하나로 합쳐 넣는다.
 *  - 환전 방향(데모 `dir` ku/uk)은 요청에서 `currency`(낸 통화)·`counterCurrency`(받은 통화)로 바꿔 보낸다(Stage 1 4절 요청 규약).
 *  - `cid`(clientEntryId)는 폼을 열 때 한 번 만들고 다시 시도·이어 쓰기에도 그대로 둔다 — 서버가 같은 키를 두 번 기록하지 않는다.
 */
import type {
  AnchorStatus, CandidateView, CorrectRequestBody, Currency, EntryKind, EntryRequestBody, LedgerEntryView, LedgerFeed, LedgerSummary,
} from '@/lib/ledger/types';
import { draftEntryView, predictAnchor, simulateSummary, computeSummary } from '@/lib/ledger/compute';
import { validateEntryInput, type EntryValidation } from '@/lib/ledger/validate';
import { formatKstMinute, parseKstWall } from '@/lib/ledger/kst';
import { isUsd } from '@/lib/ledger/rules';

export type DraftMode = 'new' | 'correct' | 'cand';

export interface EntryDraft {
  mode: DraftMode;
  kind: EntryKind;
  /** 'YYYY-MM-DD' */
  date: string;
  /** 'HH:mm' */
  time: string;
  ccy: Currency;
  amt: string;
  /** 환전 방향: ku = 원화 → 달러, uk = 달러 → 원화 */
  dir: 'ku' | 'uk';
  from: string;
  to: string;
  memo: string;
  /** 정정 대상 기록 id */
  target: number | null;
  /** 후보에서 열었으면 그 후보 키 */
  candKey: string | null;
  /** clientEntryId — 폼을 열 때 1회 생성 */
  cid: string;
}

/** 이중 제출 방지 키 — UUID(36자). 없으면 32자 16진 */
export function makeClientEntryId(rand: () => number = Math.random): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(rand() * 16).toString(16);
  return s;
}

/** 새 초안 — 기본값 '지금'(KST) · 입금 · 원화 (데모 `newDraft`) */
export function newDraft(mode: DraftMode, nowWallMs: number, over: Partial<EntryDraft> = {}, cid?: string): EntryDraft {
  const now = formatKstMinute(nowWallMs);
  return {
    mode, kind: 'deposit', date: now.slice(0, 10), time: now.slice(11, 16), ccy: 'KRW', amt: '', dir: 'ku', from: '', to: '',
    memo: '', target: null, candKey: null, cid: cid ?? makeClientEntryId(), ...over,
  };
}

export function fromCurrency(d: Pick<EntryDraft, 'dir'>): Currency {
  return d.dir === 'ku' ? 'KRW' : 'USD';
}

export function toCurrency(d: Pick<EntryDraft, 'dir'>): Currency {
  return d.dir === 'ku' ? 'USD' : 'KRW';
}

export function occurredAtOf(d: Pick<EntryDraft, 'date' | 'time'>): string {
  return d.date && d.time ? `${d.date} ${d.time}` : '';
}

/** 방향을 바꾸면 두 금액 칸을 서로 바꾼다(데모 sh-dir change) */
export function switchDir(d: EntryDraft, dir: 'ku' | 'uk'): EntryDraft {
  if (d.dir === dir) return d;
  return { ...d, dir, from: d.to, to: d.from };
}

export interface ValidateContext {
  nowWallMs: number;
  feed: Pick<LedgerFeed, 'baseline' | 'snapshot' | 'entries'>;
}

/** 서버와 같은 검증 (데모 `validateEntry`) */
export function validateDraft(d: EntryDraft, ctx: ValidateContext): EntryValidation {
  const exch = d.kind === 'exchange';
  return validateEntryInput(
    {
      kind: d.kind, occurredAt: occurredAtOf(d),
      currency: exch ? fromCurrency(d) : d.ccy,
      amount: exch ? d.from : d.amt,
      counterCurrency: exch ? toCurrency(d) : null,
      counterAmount: exch ? d.to : null,
      memo: d.memo, targetId: d.target,
    },
    {
      nowMs: ctx.nowWallMs,
      baselineAtMs: ctx.feed.baseline ? parseKstWall(ctx.feed.baseline.at) : null,
      snapshot: ctx.feed.snapshot ? { totalKrw: ctx.feed.snapshot.totalKrw, fx: ctx.feed.snapshot.fx } : null,
      entries: ctx.feed.entries,
    },
  );
}

/** '채우거나 고칠 곳' 칸 이름 (데모 sh-why 의 when·amt·from·to) */
export function fieldLabel(field: string, kind: EntryKind): string {
  switch (field) {
    case 'occurredAt': return '날짜·시각';
    case 'amount': return kind === 'exchange' ? '낸 금액' : '금액';
    case 'counterAmount': return '받은 금액';
    case 'memo': return '메모';
    case 'kind': return '종류';
    case 'currency': case 'counterCurrency': return '통화';
    default: return field;
  }
}

/** 확인하기 버튼 옆 이유 문장 (데모 refreshEntry 의 why) */
export function whyText(v: EntryValidation, kind: EntryKind): string {
  if (v.blocked) return '기준 시각 이전 날짜는 기록할 수 없습니다.';
  if (v.count === 0) return '';
  return `채우거나 고칠 곳 ${v.count}곳 — ${Object.keys(v.errors).map((k) => fieldLabel(k, kind)).join(' · ')}`;
}

/** 요청 본문 (POST entries · correct) */
export function toRequest(d: EntryDraft, baseVersion: number): EntryRequestBody | CorrectRequestBody {
  const exch = d.kind === 'exchange';
  const body: EntryRequestBody = {
    clientEntryId: d.cid, kind: d.kind, occurredAt: occurredAtOf(d),
    currency: exch ? fromCurrency(d) : d.ccy,
    amount: exch ? d.from : d.amt,
    counterCurrency: exch ? toCurrency(d) : null,
    counterAmount: exch ? d.to : null,
    memo: d.memo.trim() === '' ? null : d.memo.trim(),
    fromCandidateKey: d.mode === 'cand' ? d.candKey : null,
    baseVersion,
  };
  return d.mode === 'correct' ? { ...body, reason: '정정' } : body;
}

/** 저장 전 반영 상태 예측 — 열린 후보 중 맞는 것이 있으면 반영됨(그 스냅샷), 아니면 대기·불일치 (데모 `predict`) */
export function predictFor(
  v: Pick<EntryValidation, 'value'>, feed: Pick<LedgerFeed, 'snapshot' | 'candidates' | 'rules'>,
): { status: AnchorStatus; anchorTs: string | null } {
  const n = v.value;
  const snapshotTs = feed.snapshot?.ts ?? null;
  if (!n) return { status: 'pending', anchorTs: null };
  const d = { kind: n.kind, currency: n.currency, amount: n.amount, occurredAtMs: n.occurredAtMs };
  for (const c of feed.candidates as CandidateView[]) {
    if (c.state !== 'open') continue;
    const r = predictAnchor(d, { snapshotTs, candidate: c, rules: feed.rules });
    if (r.status === 'matched') return r;
  }
  return predictAnchor(d, { snapshotTs, candidate: null, rules: feed.rules });
}

export interface ConfirmPreview {
  predicted: { status: AnchorStatus; anchorTs: string | null };
  before: LedgerSummary | null;
  after: LedgerSummary | null;
}

/** 확인 단계 미리보기 — 지금 손익(전)과 이 기록을 넣은 뒤 손익(후). 정정이면 원래 기록을 '정정됨'으로 뺀다 (데모 `entryConfirm`) */
export function previewEntry(d: EntryDraft, v: EntryValidation, feed: LedgerFeed, nowWallMs: number): ConfirmPreview {
  const predicted = predictFor(v, feed);
  const input = { baseline: feed.baseline, snapshot: feed.snapshot, entries: feed.entries };
  const before = computeSummary(input);
  if (!v.value) return { predicted, before, after: before };
  const n = v.value;
  const draft = draftEntryView(
    { kind: n.kind, currency: n.currency, amount: n.amount, occurredAtMs: n.occurredAtMs, counterCurrency: n.counterCurrency, counterAmount: n.counterAmount, memo: n.memo },
    predicted,
    { id: Number.MAX_SAFE_INTEGER, snapshotFx: feed.snapshot?.fx ?? null, nowMs: nowWallMs, supersedes: d.mode === 'correct' ? d.target : null },
  );
  const after = simulateSummary<LedgerEntryView>(input, (es) => {
    if (d.mode === 'correct' && d.target != null) {
      const o = es.find((e) => e.id === d.target);
      if (o) o.void = { type: 'super', reason: '정정', at: null, byUserId: null, by: draft.id };
    }
    es.push(draft);
  });
  return { predicted, before, after };
}

/** 정정 폼 초안 — 원래 기록 값으로 채운다. toExchange 면 '환전으로 정정' 제안 값으로 (데모 `openCorrect`) */
export function correctDraft(e: LedgerEntryView, nowWallMs: number, toExchange: boolean): EntryDraft {
  const date = e.occurredAt.slice(0, 10);
  const time = e.occurredAt.slice(11, 16);
  const base: Partial<EntryDraft> = { target: e.id, memo: e.memo ?? '', date, time };
  const s = e.anchor.suggest;
  if (toExchange && s) {
    const krw = String(Math.abs(Math.round(s.krwDelta)));
    const usdCents = Math.abs(Math.round(s.usdDelta * 100));
    const usd = usdCents % 100 === 0 ? String(usdCents / 100) : (usdCents / 100).toFixed(2);
    const ku = s.krwDelta < 0;
    return newDraft('correct', nowWallMs, { ...base, kind: 'exchange', dir: ku ? 'ku' : 'uk', from: ku ? krw : usd, to: ku ? usd : krw });
  }
  if (e.kind === 'exchange') {
    return newDraft('correct', nowWallMs, {
      ...base, kind: 'exchange', dir: isUsd(e.currency) ? 'uk' : 'ku', from: String(e.amount), to: String(e.counterAmount ?? ''),
    });
  }
  return newDraft('correct', nowWallMs, { ...base, kind: e.kind, ccy: e.currency, amt: String(e.amount) });
}
