'use client';

/**
 * T-074 — 취소한 기록 되살리기 시트 (데모 `restoreSheet`). 되살리면 다시 계산에 들어간다(전→후를 먼저 보인다).
 * 정정으로 대체된 기록은 되살리지 않는다(이중 계상 방지 — 상세 화면이 버튼을 내지 않고, 서버도 409 superseded).
 * 충돌: 409 not_voided(다른 기기에서 이미 되살림) → 최신 목록 · 409 duplicate(같은 기록이 살아 있음)·superseded → 서버 문장 + 닫기.
 */
import { useCallback, useRef, useState, type ReactNode } from 'react';
import type { EntryActionResponse, LedgerEntryView, LedgerFeed } from '@/lib/ledger/types';
import { computeSummary, simulateSummary } from '@/lib/ledger/compute';
import { Sheet } from '@/components/ui/Sheet';
import { BusyFoot, ErrBox, failNode, St, type SheetDecision, type SheetErr } from './Parts';
import { createSubmitter, urls, write, type WriteOutcome } from './actions';
import type { SheetFrameProps } from './EntrySheet';
import { entryMeta, entryOne, swon } from './view';

export function restoreImpact(e: LedgerEntryView, feed: LedgerFeed): ReactNode {
  if (e.kind === 'exchange' || e.anchor.status === 'pending' || e.beforeBaseline) return '지금 손익 숫자는 바뀌지 않습니다.';
  const input = { baseline: feed.baseline, snapshot: feed.snapshot, entries: feed.entries };
  const c0 = computeSummary(input);
  const c1 = simulateSummary(input, (es) => {
    const t = es.find((x) => x.id === e.id);
    if (t) t.void = null;
  });
  if (!c0 || !c1) return null;
  return <>되살리면 다시 계산에 들어갑니다: 입출금 뺀 손익 {swon(c0.P)} → <b>{swon(c1.P)}</b></>;
}

export function decideRestoreOutcome(out: WriteOutcome<EntryActionResponse>, ctx: { id: number; beforeP: number | null }): SheetDecision {
  if (out.kind === 'ok') {
    const after = out.body.data.summary?.P;
    const tail = ctx.beforeP != null && after != null && after !== ctx.beforeP ? ` 손익 ${swon(ctx.beforeP)} → ${swon(after)}` : '';
    return { type: 'done', data: out.body.data, toast: <><St kind="ok" icon="✓">#{ctx.id} 을 되살렸습니다</St>{tail}</> };
  }
  if (out.kind === 'handledElsewhere') {
    return {
      type: 'err', feed: out.data, refresh: !out.data,
      err: { kind: 'conflictClose', node: <><St kind="warn" icon="!">이미 다른 기기에서 되살렸습니다</St><br />최신 목록을 불러왔습니다. 두 번 되살아나지 않습니다.</> },
    };
  }
  if (out.kind === 'conflict' || out.kind === 'dup') {
    const data = out.kind === 'conflict' ? out.data : null;
    return {
      type: 'err', feed: data, refresh: !data,
      err: { kind: 'conflictClose', node: <><St kind="warn" icon="!">{out.message || '되살리지 않았습니다'}</St><br />최신 목록을 불러왔습니다.</> },
    };
  }
  const reason = out.kind === 'invalid' ? out.message : out.kind === 'fail' ? out.reason : out.message;
  return { type: 'err', feed: null, refresh: false, err: { kind: 'fail', node: failNode(reason, false) } };
}

export function RestoreSheet(p: {
  feed: LedgerFeed;
  entry: LedgerEntryView;
  frame: SheetFrameProps;
  onClose: () => void;
  onDone: (data: LedgerFeed, toast: ReactNode) => void;
  onFeed: (data: LedgerFeed) => void;
  onRefresh: () => void;
  initialState?: { err?: SheetErr | null; saving?: boolean };
  writeImpl?: typeof write;
}) {
  const { feed, entry: e } = p;
  const [saving, setSaving] = useState(!!p.initialState?.saving);
  const sub = useRef(createSubmitter()).current;
  const [err, setErr] = useState<SheetErr | null>(p.initialState?.err ?? null);
  const [focusReq, setFocusReq] = useState<{ id: string; seq: number } | null>(null);
  const focusTo = useCallback((id: string) => setFocusReq((f) => ({ id, seq: (f?.seq ?? 0) + 1 })), []);
  const close = () => { if (!sub.busy && !saving) p.onClose(); };

  const commit = async () => {
    if (sub.busy) return;
    const beforeP = feed.summary?.P ?? null;
    setSaving(true); focusTo('sh-primary');
    const out = await sub.run(() => (p.writeImpl ?? write)<EntryActionResponse>('POST', urls.restore(e.id), {}));
    if (out === null) return;
    setSaving(false);
    const dec = decideRestoreOutcome(out, { id: e.id, beforeP });
    if (dec.type === 'done') { p.onDone(dec.data, dec.toast); return; }
    if (dec.feed) p.onFeed(dec.feed); else if (dec.refresh) p.onRefresh();
    setErr(dec.err);
    focusTo('sh-primary');
  };

  const foot = saving ? <BusyFoot label="되살리는 중…" />
    : err?.kind === 'conflictClose' ? <div className="btns"><button type="button" className="btn pri" id="sh-primary" onClick={close}>닫고 최신 목록 보기</button></div>
      : (
        <div className="btns">
          <button type="button" className="btn sec" onClick={close}>돌아가기</button>
          <button type="button" className="btn pri" id="sh-primary" onClick={commit}>{err ? '다시 시도' : '되살리기'}</button>
        </div>
      );

  return (
    <Sheet
      title={`기록 되살리기 — #${e.id}`} onClose={close} busy={saving} className="lg" initialFocus="title" focusRequest={focusReq}
      returnFocusIds={p.frame.returnFocusIds} onAfterClose={p.frame.onAfterClose} footer={foot}
    >
      <ErrBox err={err} />
      <div className="infobox" role="note">
        <span className="ic" aria-hidden="true">#{e.id}</span>
        <div><b>{entryOne(e)}</b><br />{entryMeta(e)}<br /><span className="muted">취소 사유: {e.void?.reason ?? ''}</span></div>
      </div>
      <div className="impact">{restoreImpact(e, feed)}</div>
      <p className="csub">같은 돈이 다른 기록으로 이미 들어가 있지 않은지 확인하세요(중복이면 두 번 빠집니다).</p>
    </Sheet>
  );
}
