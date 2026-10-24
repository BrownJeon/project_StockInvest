/**
 * T-074 — 기록 표 (데스크톱 ≥900px, 데모 `listHtml` 의 `.only-d` 표). 모바일 목록과 같은 기록을 그리므로 id 앞머리는 `lgt`.
 * 7열 표는 412px 에서 판독 불가라 모바일은 2줄 목록 행(EntryList), 넓은 화면은 표로 분기한다(Designer 결정 12).
 */
import type { ReactNode } from 'react';
import type { LedgerEntryView, LedgerFeed } from '@/lib/ledger/types';
import { isUsd } from '@/lib/ledger/rules';
import { KindChip, St } from './Parts';
import { EntryDetail, type EntryAction } from './EntryDetail';
import { entryAmt, exCost, exRate, keq, md, rt, statusParts, won } from './view';

export const TABLE_PREFIX = 'lgt';
export const tableRowIds = (id: number) => ({ head: `${TABLE_PREFIX}-eh-${id}`, detail: `${TABLE_PREFIX}-ed-${id}` });

export function EntryTable(p: {
  feed: LedgerFeed;
  rows: LedgerEntryView[];
  open: Record<number, boolean>;
  onToggle: (id: number, triggerId: string) => void;
  onAction: (a: EntryAction, e: LedgerEntryView, triggerId: string) => void;
}) {
  const snapFx = p.feed.snapshot?.fx ?? null;
  return (
    <div className="only-d">
      <table className="etable">
        <caption className="sr">입출금 기록 목록</caption>
        <thead>
          <tr>
            <th scope="col">#</th><th scope="col">발생 시각</th><th scope="col">종류</th><th scope="col" className="r">금액</th>
            <th scope="col" className="r">원화 환산 · 환율</th><th scope="col">상태</th><th scope="col">메모</th><th scope="col"><span className="sr">자세히</span></th>
          </tr>
        </thead>
        <tbody>
          {p.rows.flatMap((e) => {
            const open = !!p.open[e.id];
            const ids = tableRowIds(e.id);
            const [sk, si, stx] = statusParts(e);
            let conv: ReactNode = '—';
            if (e.kind === 'exchange') {
              const r = exRate(e);
              const cost = exCost(e, snapFx);
              conv = <>{r != null ? rt(r) : '—'}원/$<small>비용(추정) {cost != null ? won(cost) : '—'}</small></>;
            } else if (isUsd(e.currency)) {
              const k = keq(e, snapFx);
              conv = <>{k != null ? won(k) : '—'}<small>{e.fxRateUsed != null ? `환율 ${rt(e.fxRateUsed)}` : '임시'}</small></>;
            }
            return [
              <tr className={e.void ? 'void' : undefined} key={`r-${e.id}`}>
                <td className="num">{e.id}</td>
                <td className="num nw">{md(e.occurredAt)}</td>
                <td><KindChip kind={e.kind} /></td>
                <td className="r amt">{entryAmt(e)}</td>
                <td className="r">{conv}</td>
                <td className="nw"><St kind={sk} icon={si}>{stx}</St></td>
                <td>{e.memo ? e.memo : <span className="muted">—</span>}</td>
                <td>
                  <button
                    type="button" className="rowbtn" id={ids.head} aria-expanded={open} aria-controls={ids.detail}
                    aria-label={`#${e.id} 기록 ${open ? '접기' : '자세히'}`} onClick={() => p.onToggle(e.id, ids.head)}
                  >{open ? '접기' : '자세히'}</button>
                </td>
              </tr>,
              <tr className="dt" id={ids.detail} hidden={!open} key={`d-${e.id}`}>
                <td colSpan={8}>{open && <EntryDetail e={e} feed={p.feed} prefix={TABLE_PREFIX} onAction={p.onAction} />}</td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
