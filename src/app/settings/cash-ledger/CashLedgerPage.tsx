'use client';

/**
 * T-074 — 설정 › 입출금 기록 (/settings/cash-ledger). 승인 데모 v1(`mockups/T-074-cash-flow-ledger-v1.html`)의 `ledgerScreen`.
 *
 * 입금·출금·환전을 사용자가 직접 기록하고, 넣고 뺀 돈을 뺀 투자 손익을 보인다. **계좌의 돈을 움직이지 않고 주문도 만들지 않는다**
 * (배지·띠로 명시). 기존 화면의 숫자는 바꾸지 않는다. 데이터: `GET /api/cash-ledger`(WP-A) — 쓰기 응답의 최신 데이터로 통째로 교체.
 *
 * 화면 상태: 로딩(스켈레톤 + sr 문구) · 조회 오류("기록이 없어진 것이 아닙니다" + 다시 시도 — 마이그레이션 전 503 포함) ·
 *   기준 없음(기준 정하기) · 빈 상태 · 정상 × 신뢰도 표지(기준 미확정·오래됨·밤 스냅샷·반영 대기·불일치).
 * 레이아웃: <900px 한 열(목록 행), ≥900px `"top list" "bot list"` 2열(왼쪽 420px, 오른쪽 표) — `LedgerStyles` 의 미디어 쿼리.
 * 시트는 한 번에 하나(공용 `Sheet`): 닫히면 연 버튼으로 포커스가 돌아가고(사라졌으면 목록 제목·추가 버튼), 그 뒤 토스트를 띄운다.
 * 시트를 열 때는 떠 있던 토스트를 지운다(designer 구현 점검 P1-1 — 토스트가 시트의 손익 전→후 줄을 가렸다).
 * 마이그레이션 전 503 `not_migrated` 는 고장이 아니라 중립 '준비 중' 한 문장으로 보이고 '다시 시도'를 내지 않는다(P1-2).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { CandidateView, LedgerEntryView, LedgerFeed } from '@/lib/ledger/types';
import { instantToWallMs } from '@/lib/ledger/kst';
import { LedgerStyles } from '@/components/ledger/LedgerStyles';
import { LedgerBadge, St } from '@/components/ledger/Parts';
import { SummaryCard, SUM_TITLE_ID } from '@/components/ledger/SummaryCard';
import { FlowCandidates, candIds } from '@/components/ledger/FlowCandidateCard';
import { TrustSignals } from '@/components/ledger/TrustSignals';
import { LedgerList, LIST_TITLE_ID, listRowIds } from '@/components/ledger/EntryList';
import { tableRowIds } from '@/components/ledger/EntryTable';
import type { EntryAction } from '@/components/ledger/EntryDetail';
import { BaselineCard } from '@/components/ledger/BaselineCard';
import { LedgerGuide } from '@/components/ledger/LedgerGuide';
import { EntrySheet } from '@/components/ledger/EntrySheet';
import { CancelSheet } from '@/components/ledger/CancelSheet';
import { RestoreSheet } from '@/components/ledger/RestoreSheet';
import { DismissSheet } from '@/components/ledger/DismissSheet';
import { BaselineSheet, type BaseMode } from '@/components/ledger/BaselineSheet';
import { useLedgerFeed, type LedgerFeedState } from '@/components/ledger/useLedgerFeed';
import { correctDraft, newDraft, type EntryDraft } from '@/components/ledger/entry-draft';
import { urls, write } from '@/components/ledger/actions';
import { candidateAmountText, md, NOT_READY_TEXT, won } from '@/components/ledger/view';
import type { CandidateWriteResponse } from '@/lib/ledger/types';

export const ADD_ID = 'lg-add';
export const RETRY_ID = 'lg-retry';
export const NOBASE_SET_ID = 'lg-nb-set';
const TOAST_MS = 7_000;

type SheetSpec =
  | { type: 'entry'; draft: EntryDraft; restored: boolean; trigger: string | null }
  /** entry·candidate 는 연 때의 값 — 최신 데이터에 없으면(다른 기기에서 바뀜) 이것으로 시트를 유지한다 */
  | { type: 'cancel'; target: number; entry: LedgerEntryView; trigger: string | null }
  | { type: 'restore'; target: number; entry: LedgerEntryView; trigger: string | null }
  | { type: 'dismiss'; key: string; candidate: CandidateView; trigger: string | null }
  | { type: 'base'; mode: BaseMode; trigger: string | null };

function nowWall(): number {
  return instantToWallMs(Date.now());
}

/** 보이는 쪽(모바일 목록 / 데스크톱 표)의 행 버튼 */
function visibleRowButton(id: number): HTMLElement | null {
  for (const x of [listRowIds(id).head, tableRowIds(id).head]) {
    const el = document.getElementById(x);
    if (el && el.offsetParent !== null) return el;
  }
  return null;
}

export function CashLedgerPage() {
  const feed = useLedgerFeed();
  return <CashLedgerView feed={feed} />;
}

/** 화면 본체 — 시험에서 조회 상태를 직접 넣어 렌더한다 */
export function CashLedgerView({ feed }: { feed: LedgerFeedState }) {
  const [sheet, setSheet] = useState<SheetSpec | null>(null);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [showVoid, setShowVoid] = useState(false);
  const [toast, setToast] = useState<ReactNode>(null);
  const [busyCand, setBusyCand] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDraft = useRef<EntryDraft | null>(null);
  const closeFocus = useRef<string[] | null>(null);
  const afterClose = useRef<(() => void) | null>(null);
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;

  const showToast = useCallback((msg: ReactNode) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const clearToast = useCallback(() => {
    if (toastTimer.current) { clearTimeout(toastTimer.current); toastTimer.current = null; }
    setToast(null);
  }, []);

  const openSheet = useCallback((s: SheetSpec) => {
    closeFocus.current = null;
    afterClose.current = null;
    clearToast();
    setSheet(s);
  }, [clearToast]);

  /** 시트 닫기 — focus 를 주면 그쪽으로(예: 기록 뒤 목록 제목), toast 는 닫힌 뒤(배경 inert 해제 다음)에 띄운다 */
  const closeSheet = useCallback((opts: { focus?: string[]; toast?: ReactNode } = {}) => {
    // 닫는 순간의 시트(연 버튼)를 잡아 둔다 — 시트가 실제로 사라지는(효과 정리) 때에는 이미 다음 화면으로 그려진 뒤다
    closeFocus.current = opts.focus ?? [sheetRef.current?.trigger ?? null, LIST_TITLE_ID, ADD_ID].filter((x): x is string => !!x);
    afterClose.current = opts.toast != null ? () => showToast(opts.toast) : null;
    setSheet(null);
  }, [showToast]);

  const frame = {
    returnFocusIds: () => closeFocus.current ?? [LIST_TITLE_ID, ADD_ID],
    onAfterClose: () => { const f = afterClose.current; afterClose.current = null; f?.(); },
  };

  const data = feed.data;

  const openEntry = useCallback((mode: 'new' | 'cand', trigger: string, over?: Partial<EntryDraft>) => {
    if (mode === 'new' && !over && lastDraft.current && lastDraft.current.mode === 'new') {
      openSheet({ type: 'entry', draft: lastDraft.current, restored: true, trigger });
      return;
    }
    openSheet({ type: 'entry', draft: newDraft(mode, nowWall(), over ?? {}), restored: false, trigger });
  }, [openSheet]);

  const onAction = useCallback((a: EntryAction, e: LedgerEntryView, trigger: string) => {
    if (a === 'corr' || a === 'corrExch') openSheet({ type: 'entry', draft: correctDraft(e, nowWall(), a === 'corrExch'), restored: false, trigger });
    else if (a === 'cancel') openSheet({ type: 'cancel', target: e.id, entry: e, trigger });
    else openSheet({ type: 'restore', target: e.id, entry: e, trigger });
  }, [openSheet]);

  const onToggle = useCallback((id: number, trigger: string) => {
    setOpen((o) => ({ ...o, [id]: !o[id] }));
    requestAnimationFrame(() => document.getElementById(trigger)?.focus());
  }, []);

  const onGoEntry = useCallback((id: number) => {
    setOpen((o) => ({ ...o, [id]: true }));
    requestAnimationFrame(() => {
      const el = visibleRowButton(id);
      if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); }
    });
  }, []);

  const onCandRecord = useCallback((c: CandidateView, trigger: string) => {
    openEntry('cand', trigger, {
      kind: c.direction, ccy: c.currency, amt: candidateAmountText(c), date: c.ts.slice(0, 10), time: c.ts.slice(11, 16), candKey: c.key,
    });
  }, [openEntry]);

  const onCandUndo = useCallback(async (c: CandidateView) => {
    if (busyCand) return;
    setBusyCand(c.key);
    const out = await write<CandidateWriteResponse>('POST', urls.reopen(c.key), {});
    setBusyCand(null);
    if (out.kind === 'ok') {
      feed.replace(out.body.data);
      requestAnimationFrame(() => document.getElementById(candIds(c.key).rec)?.focus());
      return;
    }
    if (out.kind === 'handledElsewhere' || out.kind === 'conflict') {
      if (out.data) feed.replace(out.data); else feed.refresh();
      showToast(<><St kind="warn" icon="!">{out.message || '되돌리지 못했습니다'}</St></>);
      return;
    }
    showToast(<St kind="warn" icon="!">되돌리지 못했습니다 — {out.kind === 'fail' ? out.reason : out.message}</St>);
  }, [busyCand, feed, showToast]);

  /** 오류 화면의 '다시 시도' — 다시 읽은 뒤 요약 제목으로 포커스(데모 reload) */
  const wantSumFocus = useRef(false);
  const onReload = useCallback(() => {
    wantSumFocus.current = true;
    feed.reload();
  }, [feed]);
  useEffect(() => {
    if (feed.load !== 'ready' || !wantSumFocus.current) return;
    wantSumFocus.current = false;
    document.getElementById(SUM_TITLE_ID)?.focus();
  }, [feed.load]);

  // ─── 시트 ───────────────────────────────────────────────────────────────
  const done = (d: LedgerFeed, t: ReactNode, focus?: string[]) => { feed.replace(d); closeSheet({ toast: t, focus }); };
  let sheetEl: ReactNode = null;
  if (sheet && data) {
    const common = { frame, onFeed: feed.replace, onRefresh: feed.refresh };
    if (sheet.type === 'entry') {
      sheetEl = (
        <EntrySheet
          {...common} feed={data} initial={sheet.draft} restored={sheet.restored}
          onClose={(draft, step) => { if (step === 'form') lastDraft.current = draft; closeSheet(); }}
          onDone={(d, t) => { lastDraft.current = null; done(d, t, [LIST_TITLE_ID]); }}
          onStale={(d, existingId, t) => {
            // 같은 요청 번호로 이미 다른 내용이 저장됨(Reviewer M1) — 초안은 버린다(같은 입력을 새 번호로 다시 보내면 이중 기록 위험).
            // 최신 목록으로 바꾸고, 저장된 기록을 펼쳐 그 행으로 포커스한다(보이지 않으면 목록 제목)
            lastDraft.current = null;
            if (d) feed.replace(d); else feed.refresh();
            if (existingId != null) setOpen((o) => ({ ...o, [existingId]: true }));
            closeSheet({ toast: t, focus: existingId != null ? [listRowIds(existingId).head, tableRowIds(existingId).head, LIST_TITLE_ID] : [LIST_TITLE_ID] });
          }}
        />
      );
    } else if (sheet.type === 'cancel' || sheet.type === 'restore') {
      const e = data.entries.find((x) => x.id === sheet.target) ?? sheet.entry;
      sheetEl = sheet.type === 'cancel'
        ? <CancelSheet {...common} feed={data} entry={e} onClose={() => closeSheet()} onDone={(d, t) => done(d, t)} />
        : <RestoreSheet {...common} feed={data} entry={e} onClose={() => closeSheet()} onDone={(d, t) => done(d, t)} />;
    } else if (sheet.type === 'dismiss') {
      const c = data.candidates.find((x) => x.key === sheet.key) ?? sheet.candidate;
      sheetEl = <DismissSheet {...common} candidate={c} onClose={() => closeSheet()} onDone={(d, t) => done(d, t)} />;
    } else {
      sheetEl = <BaselineSheet {...common} feed={data} mode={sheet.mode} onClose={() => closeSheet()} onDone={(d, t) => done(d, t)} />;
    }
  }

  return (
    <div className="lg">
      <LedgerStyles />
      <div className="rp-head">
        <Link className="back" href="/settings" aria-label="설정으로 돌아가기">‹ 설정</Link>
        <h2>입출금 기록</h2>
        <LedgerBadge />
      </div>
      <div className="strip">
        <span>이 화면은 <b>계좌의 돈을 움직이지 않고 주문도 만들지 않습니다</b>. 넣고 뺀 돈을 적어 손익을 바르게 계산하는 기록장입니다.</span>
      </div>
      <main className="app-body">
        <LedgerBody
          feed={feed} open={open} showVoid={showVoid} busyCand={busyCand}
          onAdd={(t) => openEntry('new', t)}
          onToggle={onToggle}
          onToggleVoid={() => { setShowVoid((v) => !v); }}
          onAction={onAction}
          onGoEntry={onGoEntry}
          onCandRecord={onCandRecord}
          onCandDismiss={(c, t) => openSheet({ type: 'dismiss', key: c.key, candidate: c, trigger: t })}
          onCandUndo={(c) => { void onCandUndo(c); }}
          onBase={(mode, t) => openSheet({ type: 'base', mode, trigger: t })}
          onReload={onReload}
        />
      </main>
      <div className="toast" role="status" aria-live="polite">{toast}</div>
      {sheetEl}
    </div>
  );
}

export interface BodyProps {
  feed: LedgerFeedState;
  open: Record<number, boolean>;
  showVoid: boolean;
  busyCand?: string | null;
  onAdd: (trigger: string) => void;
  onToggle: (id: number, trigger: string) => void;
  onToggleVoid: () => void;
  onAction: (a: EntryAction, e: LedgerEntryView, trigger: string) => void;
  onGoEntry: (id: number) => void;
  onCandRecord: (c: CandidateView, trigger: string) => void;
  onCandDismiss: (c: CandidateView, trigger: string) => void;
  onCandUndo: (c: CandidateView, trigger: string) => void;
  onBase: (mode: BaseMode, trigger: string) => void;
  onReload: () => void;
}

/** 화면 본문 (데모 `ledgerBody`) — 시험에서 상태별로 직접 렌더한다 */
export function LedgerBody(p: BodyProps) {
  const { feed } = p;
  if (feed.load === 'loading') {
    return (
      <>
        <div className="sumcard" aria-busy="true">
          <span className="sr" role="status">입출금 기록을 불러오는 중…</span>
          <div className="skel s" aria-hidden="true" /><div className="skel big" aria-hidden="true" /><div className="skel m" aria-hidden="true" />
          <div className="skel" aria-hidden="true" /><div className="skel m" aria-hidden="true" />
        </div>
        <div className="sumcard" aria-hidden="true"><div className="skel m" /><div className="skel s" /><div className="skel m" /></div>
      </>
    );
  }
  const data = feed.data;
  if (feed.load === 'error' && feed.loadCode === 'not_migrated') {
    return <div className="sumcard" role="status"><St kind="na" icon="◌">{NOT_READY_TEXT}</St></div>;
  }
  if (feed.load === 'error' || !data) {
    return (
      <div className="sumcard" role="alert">
        <St kind="warn" icon="!">입출금 기록을 불러오지 못했습니다</St>
        <span className="muted" style={{ fontSize: 12 }}>이 화면이 값을 받지 못했을 뿐, 기록이 없어진 것이 아닙니다. 오류: {feed.loadError ?? '알 수 없음'}</span>
        <div><button type="button" className="btn pri" id={RETRY_ID} onClick={p.onReload}>다시 시도</button></div>
      </div>
    );
  }
  if (!data.baseline) {
    return (
      <>
        <section className="card nobase" aria-labelledby="lg-nb-t">
          <h3 id="lg-nb-t">손익 기준이 아직 없습니다</h3>
          <p>입출금을 빼고 계산하려면 먼저 <b>언제부터 셀지</b> 정해야 합니다. 그 시각의 총자산이 ‘기준 총자산’이 되고, 그 뒤에 넣고 뺀 돈만 기록합니다.</p>
          <button type="button" className="btn pri wide" id={NOBASE_SET_ID} onClick={() => p.onBase('set', NOBASE_SET_ID)}>기준 정하기</button>
          <p className="muted" style={{ fontSize: 12 }}>
            기준을 정하기 전에는 기록을 추가할 수 없습니다.{data.snapshot ? ` 지금 총자산: ${won(data.snapshot.totalKrw)} (${md(data.snapshot.ts)} 스냅샷)` : ''}
          </p>
        </section>
        <LedgerGuide rules={data.rules} />
      </>
    );
  }
  const c = data.summary;
  if (!c || !data.snapshot) {
    // 기준은 있는데 최신 스냅샷이 없다(계산 불가) — 데모에 없던 경우라 조회 오류 모양으로 알린다
    return (
      <div className="sumcard" role="alert">
        <St kind="warn" icon="!">입출금 기록을 불러오지 못했습니다</St>
        <span className="muted" style={{ fontSize: 12 }}>이 화면이 값을 받지 못했을 뿐, 기록이 없어진 것이 아닙니다. 오류: 최신 포트폴리오 스냅샷이 없어 손익을 계산하지 못했습니다</span>
        <div><button type="button" className="btn pri" id={RETRY_ID} onClick={p.onReload}>다시 시도</button></div>
      </div>
    );
  }
  return (
    <div className="lg-body">
      <div className="lg-top">
        <SummaryCard feed={data} c={c} />
        <FlowCandidates
          cands={data.candidates} P={c.P} rules={data.rules} busyKey={p.busyCand ?? null} scanTruncated={data.scanTruncated}
          onRecord={p.onCandRecord} onDismiss={p.onCandDismiss} onUndo={p.onCandUndo}
        />
        <TrustSignals feed={data} c={c} onBaseConfirm={(t) => p.onBase('confirm', t)} onGoEntry={p.onGoEntry} />
        <button type="button" className="btn pri wide" id={ADD_ID} onClick={() => p.onAdd(ADD_ID)}>+ 입출금 기록 추가</button>
      </div>
      <div className="lg-list">
        <LedgerList
          feed={data} c={c} open={p.open} showVoid={p.showVoid}
          onToggle={p.onToggle} onToggleVoid={p.onToggleVoid} onAction={p.onAction} onAdd={p.onAdd}
        />
      </div>
      <div className="lg-bot">
        <BaselineCard feed={data} c={c} onConfirm={(t) => p.onBase('confirm', t)} onChange={(t) => p.onBase('change', t)} />
        <LedgerGuide rules={data.rules} />
      </div>
    </div>
  );
}

export { SUM_TITLE_ID };
