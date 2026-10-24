'use client';

/**
 * T-074 — 기록 취소 시트 (데모 `cancelSheet`). 지우지 않는다 — '취소됨'으로 남기고 사유(필수)·시각을 기록, 언제든 되살릴 수 있다.
 * 취소하면 손익이 어떻게 바뀌는지(전→후)를 저장 전에 보인다(클라이언트 `compute.ts`).
 * 충돌 409 already_voided(다른 기기에서 먼저 취소·정정) → 최신 목록으로 바꾸고 닫기만 — 그 상태에서는 사유 입력도 비활성(a11y Minor-5).
 * '기타'를 골라도 포커스를 옮기지 않는다 — 글 칸은 라디오 바로 뒤 탭 순서에 있다(a11y Minor-3, 방향키 흐름 유지).
 */
import { useCallback, useRef, useState, type ReactNode } from 'react';
import type { EntryActionResponse, LedgerEntryView, LedgerFeed } from '@/lib/ledger/types';
import { computeSummary, simulateSummary } from '@/lib/ledger/compute';
import { Sheet } from '@/components/ui/Sheet';
import { BusyFoot, ErrBox, failNode, St, type SheetDecision, type SheetErr } from './Parts';
import { createSubmitter, urls, write, type WriteOutcome } from './actions';
import type { SheetFrameProps } from './EntrySheet';
import { entryMeta, entryOne, swon, won } from './view';

export const CANCEL_REASONS = ['잘못 입력', '중복 입력', '기타'] as const;

export function cancelImpact(e: LedgerEntryView, feed: LedgerFeed): ReactNode {
  if (e.kind === 'exchange') return '환전 기록이라 손익 숫자는 바뀌지 않습니다.';
  if (e.beforeBaseline) return '기준 이전 기록이라 손익 숫자는 바뀌지 않습니다.';
  if (e.anchor.status === 'pending') return '반영 대기 중인 기록이라 지금 손익은 바뀌지 않습니다(다음 스냅샷 뒤에도 계산에 넣지 않습니다).';
  const input = { baseline: feed.baseline, snapshot: feed.snapshot, entries: feed.entries };
  const c0 = computeSummary(input);
  const c1 = simulateSummary(input, (es) => {
    const t = es.find((x) => x.id === e.id);
    if (t) t.void = { type: 'cancel', reason: 'x', at: null, byUserId: null, by: null };
  });
  if (!c0 || !c1) return null;
  return <>취소하면 계산에서 빠집니다: 순입금 {won(c0.net)} → <b>{won(c1.net)}</b> · 입출금 뺀 손익 {swon(c0.P)} → <b>{swon(c1.P)}</b></>;
}

/** 저장 응답 → 시트 처리 (데모 `success`·`conflict` 의 cancel 분기) */
export function decideCancelOutcome(out: WriteOutcome<EntryActionResponse>, ctx: { id: number; beforeP: number | null }): SheetDecision {
  if (out.kind === 'ok') {
    const after = out.body.data.summary?.P;
    const tail = ctx.beforeP != null && after != null && after !== ctx.beforeP ? ` 손익 ${swon(ctx.beforeP)} → ${swon(after)}` : ' 손익 변화 없음';
    return { type: 'done', data: out.body.data, toast: <><St kind="ok" icon="✓">#{ctx.id} 을 취소로 표시했습니다</St>{tail}</> };
  }
  if (out.kind === 'handledElsewhere') {
    const word = out.data?.entries.find((x) => x.id === ctx.id)?.void?.type === 'super' ? '정정됐습니다' : '취소됐습니다';
    return {
      type: 'err', feed: out.data, refresh: !out.data,
      err: { kind: 'conflictClose', node: <><St kind="warn" icon="!">표시하지 않았습니다 — 이 기록(#{ctx.id})은 다른 기기에서 먼저 {word}</St><br />최신 목록을 불러왔습니다. 필요하면 되살리거나 새로 기록하세요.</> },
    };
  }
  if (out.kind === 'conflict') {
    return {
      type: 'err', feed: out.data, refresh: !out.data,
      err: { kind: 'conflictClose', node: <><St kind="warn" icon="!">{out.message || '표시하지 않았습니다'}</St><br />최신 목록을 불러왔습니다.</> },
    };
  }
  const reason = out.kind === 'invalid' ? out.message : out.kind === 'fail' ? out.reason : out.message;
  return { type: 'err', feed: null, refresh: false, err: { kind: 'fail', node: failNode(reason, false) } };
}

export function CancelSheet(p: {
  feed: LedgerFeed;
  entry: LedgerEntryView;
  frame: SheetFrameProps;
  onClose: () => void;
  onDone: (data: LedgerFeed, toast: ReactNode) => void;
  onFeed: (data: LedgerFeed) => void;
  onRefresh: () => void;
  /** 시험·미리보기용 초기 상태 */
  initialState?: { reason?: string; etc?: string; err?: SheetErr | null; saving?: boolean };
  writeImpl?: typeof write;
}) {
  const { feed, entry: e } = p;
  const [reason, setReason] = useState(p.initialState?.reason ?? '');
  const [etc, setEtc] = useState(p.initialState?.etc ?? '');
  const [saving, setSaving] = useState(!!p.initialState?.saving);
  const sub = useRef(createSubmitter()).current;
  const [err, setErr] = useState<SheetErr | null>(p.initialState?.err ?? null);
  const [focusReq, setFocusReq] = useState<{ id: string; seq: number } | null>(null);
  const focusTo = useCallback((id: string) => setFocusReq((f) => ({ id, seq: (f?.seq ?? 0) + 1 })), []);

  const ok = !!reason && (reason !== '기타' || etc.trim() !== '');
  const why = !reason ? '취소 사유를 골라 주세요.' : !ok ? '사유를 적어 주세요.' : '';
  const locked = saving || err?.kind === 'conflictClose';
  const close = () => { if (!sub.busy && !saving) p.onClose(); };

  const commit = async () => {
    if (sub.busy || !ok) return;
    const beforeP = feed.summary?.P ?? null;
    setSaving(true); focusTo('sh-primary');
    const out = await sub.run(() => (p.writeImpl ?? write)<EntryActionResponse>('POST', urls.cancel(e.id), { reason: reason === '기타' ? etc.trim() : reason }));
    if (out === null) return;
    setSaving(false);
    const dec = decideCancelOutcome(out, { id: e.id, beforeP });
    if (dec.type === 'done') { p.onDone(dec.data, dec.toast); return; }
    if (dec.feed) p.onFeed(dec.feed); else if (dec.refresh) p.onRefresh();
    setErr(dec.err);
    focusTo('sh-primary');
  };

  const foot = saving ? <BusyFoot label="표시 중…" />
    : err?.kind === 'conflictClose' ? <div className="btns"><button type="button" className="btn pri" id="sh-primary" onClick={close}>닫고 최신 목록 보기</button></div>
      : (
        <>
          <div className="sh-why" id="sh-why">{why}</div>
          <div className="btns">
            <button type="button" className="btn sec" onClick={close}>돌아가기</button>
            <button type="button" className="btn warnline" id="sh-primary" disabled={!ok} aria-describedby={!ok ? 'sh-why' : undefined} onClick={commit}>{err ? '다시 시도' : '취소로 표시'}</button>
          </div>
        </>
      );

  return (
    <Sheet
      title={`기록 취소 — #${e.id}`} onClose={close} busy={saving} className="lg" initialFocus="title" focusRequest={focusReq}
      returnFocusIds={p.frame.returnFocusIds} onAfterClose={p.frame.onAfterClose} footer={foot}
    >
      <ErrBox err={err} />
      <div className="infobox" role="note"><span className="ic" aria-hidden="true">#{e.id}</span><div><b>{entryOne(e)}</b><br />{entryMeta(e)}</div></div>
      <div className="impact">{cancelImpact(e, feed)}</div>
      <fieldset className="kseg list">
        <legend>취소 사유 (필수)</legend>
        <div className="opts">
          {CANCEL_REASONS.map((r, i) => (
            <label key={r}>
              <input type="radio" name="sh-reason" id={`sh-r-${i}`} value={r} checked={reason === r} disabled={locked}
                onChange={() => setReason(r)} />
              <span>{r}</span>
            </label>
          ))}
        </div>
        {reason === '기타' && (
          <>
            <label className="sr" htmlFor="sh-etc">기타 사유</label>
            <input className="rtext" id="sh-etc" type="text" maxLength={200} placeholder="사유를 적어 주세요" value={etc} disabled={locked} onChange={(ev) => setEtc(ev.target.value)} />
          </>
        )}
      </fieldset>
      <p className="csub">지우지 않습니다. 목록에 <b>‘취소됨’</b>으로 남고 사유·시각이 함께 기록되며, 언제든 되살릴 수 있습니다.</p>
    </Sheet>
  );
}
