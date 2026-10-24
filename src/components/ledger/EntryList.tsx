/**
 * T-074 — 기록 목록 (데모 `listHtml`): 머리(기록 n건 + '취소·정정된 기록 n건 보기' 토글) · 빈 상태 · 모바일 목록 행(.only-m) · 데스크톱 표(.only-d).
 * 목록 행은 펼침 버튼(disclosure) — `aria-expanded`·`aria-controls`. 행 버튼 접근 이름은 짧게 '#번호'부터(`rowAriaLabel`).
 * 목록 이름은 고정 "입출금 기록 목록"(a11y Minor-4 — 머리의 "기록 n건"은 취소·정정 보기 때 실제 항목 수와 다르다).
 * 기본은 살아 있는 기록만, 토글로 취소·정정된 기록도 본다(추가 전용 — 삭제 버튼 없음).
 */
import type { LedgerEntryView, LedgerFeed, LedgerSummary } from '@/lib/ledger/types';
import { KindChip, St } from './Parts';
import { EntryDetail, type EntryAction } from './EntryDetail';
import { EntryTable } from './EntryTable';
import { amtOf, entryAmt, entryExtra, entryMeta, md, rowAriaLabel, statusParts, visibleEntries } from './view';

export const LIST_PREFIX = 'lg';
export const LIST_TITLE_ID = 'lg-list-t';
export const LIST_TOGGLE_ID = 'lg-tgl';
export const ADD_FIRST_ID = 'lg-add2';
export const listRowIds = (id: number) => ({ head: `${LIST_PREFIX}-eh-${id}`, detail: `${LIST_PREFIX}-ed-${id}` });

export interface ListProps {
  feed: LedgerFeed;
  c: LedgerSummary;
  open: Record<number, boolean>;
  showVoid: boolean;
  onToggle: (id: number, triggerId: string) => void;
  onToggleVoid: () => void;
  onAction: (a: EntryAction, e: LedgerEntryView, triggerId: string) => void;
  onAdd: (triggerId: string) => void;
}

/** 목록 행 금액 칸 — 환전은 두 줄(낸 금액 →/받은 금액) */
function RowAmount({ e }: { e: LedgerEntryView }) {
  if (e.kind === 'exchange' && e.counterCurrency && e.counterAmount != null) {
    return <>{amtOf(e.currency, e.amount)} →<br />{amtOf(e.counterCurrency, e.counterAmount)}</>;
  }
  return <>{entryAmt(e)}</>;
}

export function EntryList(p: Omit<ListProps, 'c' | 'showVoid' | 'onToggleVoid' | 'onAdd'> & { rows: LedgerEntryView[] }) {
  const snapFx = p.feed.snapshot?.fx ?? null;
  return (
    <ul className="elist only-m" aria-label="입출금 기록 목록">
      {p.rows.map((e) => {
        const open = !!p.open[e.id];
        const ids = listRowIds(e.id);
        const x = entryExtra(e, snapFx);
        const [sk, si, stx] = statusParts(e);
        return (
          <li className={`erow${e.void ? ' void' : ''}`} key={e.id}>
            <button
              type="button" className="erow-h" id={ids.head} aria-expanded={open} aria-controls={ids.detail}
              aria-label={rowAriaLabel(e)} onClick={() => p.onToggle(e.id, ids.head)}
            >
              <span className="k"><KindChip kind={e.kind} /><span className="id">#{e.id}</span></span>
              <span className="a"><RowAmount e={e} /></span>
              <span className="m">{entryMeta(e)}</span>
              <span className="s"><St kind={sk} icon={si}>{stx}</St></span>
              {x && <span className="x">{x}</span>}
            </button>
            <div className="erow-d" id={ids.detail} hidden={!open}>
              {open && <EntryDetail e={e} feed={p.feed} prefix={LIST_PREFIX} onAction={p.onAction} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** 목록 영역 전체 — 데모 `listHtml` */
export function LedgerList(p: ListProps) {
  const { feed, c } = p;
  const vis = visibleEntries(feed.entries, p.showVoid);
  const head = (
    <div className="lh">
      <h3 id={LIST_TITLE_ID} tabIndex={-1}>기록 <span className="num">{c.live}</span>건</h3>
      {c.voids > 0 && (
        <button type="button" className={`tgl${p.showVoid ? ' on' : ''}`} id={LIST_TOGGLE_ID} onClick={p.onToggleVoid}>
          취소·정정된 기록 {c.voids}건 {p.showVoid ? '숨기기' : '보기'}
        </button>
      )}
    </div>
  );
  if (!feed.entries.length) {
    return (
      <>
        {head}
        <div className="emptyl">
          <b>아직 기록이 없습니다</b>
          <p>기준({md(feed.baseline?.at)}) 뒤 계좌에 넣거나 뺀 돈이 없다면 그대로 두어도 손익이 맞습니다. 있었다면 기록하세요.</p>
          <div><button type="button" className="btn pri" id={ADD_FIRST_ID} onClick={() => p.onAdd(ADD_FIRST_ID)}>+ 첫 기록 추가</button></div>
        </div>
      </>
    );
  }
  if (!vis.length) {
    return (
      <>
        {head}
        <div className="emptyl"><b>살아 있는 기록이 없습니다</b><p>모든 기록이 취소·정정됐습니다. 위 버튼으로 이력을 볼 수 있습니다.</p></div>
      </>
    );
  }
  return (
    <>
      {head}
      <EntryList feed={feed} rows={vis} open={p.open} onToggle={p.onToggle} onAction={p.onAction} />
      <EntryTable feed={feed} rows={vis} open={p.open} onToggle={p.onToggle} onAction={p.onAction} />
    </>
  );
}
