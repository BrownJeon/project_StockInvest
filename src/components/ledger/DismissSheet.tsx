'use client';

/**
 * T-074 — '입출금 아님' 표시 시트 (데모 `dismissSheet`). 숫자는 바뀌지 않는다 — 같은 변화로 다시 알리지 않을 뿐이고, 되돌릴 수 있다.
 * 충돌 409 already_handled(다른 기기에서 먼저 처리) → 최신 상태로 바꾸고 [닫기] — 그 상태에서는 사유 입력도 비활성(a11y Minor-5).
 * '기타'를 골라도 포커스를 옮기지 않는다(a11y Minor-3).
 */
import { useCallback, useRef, useState, type ReactNode } from 'react';
import type { CandidateView, CandidateWriteResponse, LedgerFeed } from '@/lib/ledger/types';
import { Sheet } from '@/components/ui/Sheet';
import { BusyFoot, ErrBox, failNode, St, type SheetDecision, type SheetErr } from './Parts';
import { createSubmitter, urls, write, type WriteOutcome } from './actions';
import type { SheetFrameProps } from './EntrySheet';
import { candidateDelta, md } from './view';

export const DISMISS_REASONS = ['매매·배당·이자 등 투자 손익', '증권사 표시 차이(일시적)', '기타'] as const;

export function decideDismissOutcome(out: WriteOutcome<CandidateWriteResponse>): SheetDecision {
  if (out.kind === 'ok') {
    return { type: 'done', data: out.body.data, toast: <><St kind="ok" icon="✓">입출금 아님으로 표시했습니다</St> 같은 변화로 다시 알리지 않습니다.</> };
  }
  if (out.kind === 'handledElsewhere' || out.kind === 'conflict') {
    return {
      type: 'err', feed: out.data, refresh: !out.data,
      err: {
        kind: 'conflictClose',
        node: out.kind === 'handledElsewhere'
          ? <><St kind="warn" icon="!">다른 기기에서 이미 처리한 변화입니다</St><br />최신 상태를 불러왔습니다.</>
          : <><St kind="warn" icon="!">{out.message || '표시하지 않았습니다'}</St><br />최신 상태를 불러왔습니다.</>,
      },
    };
  }
  const reason = out.kind === 'invalid' ? out.message : out.kind === 'fail' ? out.reason : out.message;
  return { type: 'err', feed: null, refresh: false, err: { kind: 'fail', node: failNode(reason, false) } };
}

export function DismissSheet(p: {
  candidate: CandidateView;
  frame: SheetFrameProps;
  onClose: () => void;
  onDone: (data: LedgerFeed, toast: ReactNode) => void;
  onFeed: (data: LedgerFeed) => void;
  onRefresh: () => void;
  initialState?: { reason?: string; etc?: string; err?: SheetErr | null; saving?: boolean };
  writeImpl?: typeof write;
}) {
  const C = p.candidate;
  const d = candidateDelta(C);
  const [reason, setReason] = useState(p.initialState?.reason ?? '');
  const [etc, setEtc] = useState(p.initialState?.etc ?? '');
  const [saving, setSaving] = useState(!!p.initialState?.saving);
  const sub = useRef(createSubmitter()).current;
  const [err, setErr] = useState<SheetErr | null>(p.initialState?.err ?? null);
  const [focusReq, setFocusReq] = useState<{ id: string; seq: number } | null>(null);
  const focusTo = useCallback((id: string) => setFocusReq((f) => ({ id, seq: (f?.seq ?? 0) + 1 })), []);

  const ok = !!reason && (reason !== '기타' || etc.trim() !== '');
  const why = !reason ? '사유를 골라 주세요.' : !ok ? '사유를 적어 주세요.' : '';
  const locked = saving || err?.kind === 'conflictClose';
  const close = () => { if (!sub.busy && !saving) p.onClose(); };

  const commit = async () => {
    if (sub.busy || !ok) return;
    setSaving(true); focusTo('sh-primary');
    const out = await sub.run(() => (p.writeImpl ?? write)<CandidateWriteResponse>('POST', urls.dismiss(C.key), { reason: reason === '기타' ? etc.trim() : reason }));
    if (out === null) return;
    setSaving(false);
    const dec = decideDismissOutcome(out);
    if (dec.type === 'done') { p.onDone(dec.data, dec.toast); return; }
    if (dec.feed) p.onFeed(dec.feed); else if (dec.refresh) p.onRefresh();
    setErr(dec.err);
    focusTo('sh-primary');
  };

  const foot = saving ? <BusyFoot label="표시 중…" />
    : err?.kind === 'conflictClose' ? <div className="btns"><button type="button" className="btn pri" id="sh-primary" onClick={close}>닫기</button></div>
      : (
        <>
          <div className="sh-why" id="sh-why">{why}</div>
          <div className="btns">
            <button type="button" className="btn sec" onClick={close}>돌아가기</button>
            <button type="button" className="btn pri" id="sh-primary" disabled={!ok} aria-describedby={!ok ? 'sh-why' : undefined} onClick={commit}>{err ? '다시 시도' : '입출금 아님으로 표시'}</button>
          </div>
        </>
      );

  return (
    <Sheet
      title="입출금이 아닌 변화로 표시" onClose={close} busy={saving} className="lg" initialFocus="title" focusRequest={focusReq}
      returnFocusIds={p.frame.returnFocusIds} onAfterClose={p.frame.onAfterClose} footer={foot}
    >
      <ErrBox err={err} />
      <div className="infobox" role="note">
        <span className="ic" aria-hidden="true">!</span>
        <div><b>{md(C.ts)} 스냅샷 · {d.word} 현금 {d.signed}</b><br />보유 종목 수량 변화 없음</div>
      </div>
      <fieldset className="kseg list">
        <legend>사유 (필수)</legend>
        <div className="opts">
          {DISMISS_REASONS.map((r, i) => (
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
      <p className="csub">숫자는 바뀌지 않습니다. 이 변화가 실제로 입출금이었다면 손익에 그대로 섞입니다. 표시한 뒤에도 되돌릴 수 있습니다.</p>
    </Sheet>
  );
}
