'use client';

/**
 * T-143 WP-B — 설정 › 해외 분석 대상 (`/settings/overseas-universe`).
 * 승인 데모 v1 `mockups/T-143-universe-watch-v1.html` §3·§5 · 구현 가이드 §2.2~§2.8.
 *
 * 머리 숫자 4칸 + 탭 2개(변경 제안 · 목록) + 패널 + 확인 시트. **조회는 1회 — 주기 재조회 없음**(데모 §5).
 *
 * 경계(가이드 §0.3):
 *  - 이 화면은 **주문을 만들지 않는다.** `실거래여부`·`모든거래차단`·주문 한도·시그널·보유를 쓰지도 읽지도 않는다
 *    — 차단 상태에서도 목록은 바꿀 수 있고, 시트 꼬리말이 그 사실을 말한다.
 *  - 종목 코드는 **전체 코드**로 보인다(`formatSymbolShort` 를 쓰지 않는다 — 거래소 이동 제안을 다루므로 접두사가 뜻을 가진다).
 *  - 종목 이름은 서버가 준 것만 쓴다 — 이름 조회를 위해 `/api/ticker/*`·외부를 부르지 않는다(홈 규칙과 같다).
 *  - 탭은 기존 `SegmentControl`(`role="group"` + `aria-pressed`)이다 — 데모의 `role="tablist"` 와 다르게 쓰는 것은
 *    designer 가 가이드 §2.3 에서 선언한 결정이다(거래·분석의 같은 부품과 읽기 도구에서 같게 들리게).
 *
 * 섹션 단위 실패 격리: 제안 패널과 목록 패널은 **따로 실패**한다(한쪽이 죽어도 다른 쪽은 보인다).
 */
import { Suspense, useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { UrlQuerySync } from '@/app/recommend/InPageRow';
import {
  CheckRow, EmptyNote, MetricTile, RetryButton, Rows, SegmentControl, SkeletonRows, SkeletonTile, StatusChip, TileGrid,
  ValueUnit, cx, ops,
} from '@/components/ops/ui';
import { Sheet } from '@/components/ui/Sheet';
import { ProposalCard, actButtonId, type CardBusy } from '@/components/universe/ProposalCard';
import { UniverseStyles } from '@/components/universe/UniverseStyles';
import { useUniverseFeed } from '@/components/universe/useUniverseFeed';
import {
  BULK_ENTRY_LABEL, DECEMBER_NOTE, NOT_READY_TEXT, SHEET_TAIL, autoTileLabel, autoTileMeta, effectText, emptyLeadText,
  listFoot, manualSourceLabel, manualTileLabel, manualTileMeta, mdhm, partialWatchRow, proposalTileMeta, watchSummaryText,
} from '@/components/universe/view';
import type { ManualSource } from '@/components/universe/view';
import type { Proposal, ProposalDo, UniverseRow, UniverseSource } from '@/lib/universe/types';

const TABS = [
  { id: 'proposals' as const, text: '변경 제안' },
  { id: 'list' as const, text: '목록' },
];
type TabId = (typeof TABS)[number]['id'];

/**
 * 출처 걸러보기 버튼·줄 칩의 글자. `manual` 만 `manualSource` 에 따라 「수동」·「기본」으로 갈린다(부록 B.5 #4).
 * `UniverseSource` 타입에 **다섯째 값을 넣지 않는다** — 수동 목록은 「저장된 개정판」이거나 「폴백」이고
 * 둘이 동시에 있을 수 없어, 한 자리의 **이름만** 갈라면 충분하다(타입·필터·칩 클래스·시험이 그대로다).
 */
function sourceText(src: UniverseSource, manualSource: ManualSource): string {
  if (src === 'manual') return manualSourceLabel(manualSource);
  return src === 'auto' ? '자동' : src === 'favorite' ? '즐겨찾기' : '보유';
}
const FILTER_IDS: readonly ('all' | UniverseSource)[] = ['all', 'manual', 'auto', 'favorite', 'held'];
const filterText = (id: 'all' | UniverseSource, manualSource: ManualSource): string =>
  (id === 'all' ? '전체' : sourceText(id, manualSource));

/** 모르는 `?tab=` 은 **조용히** 기본값(T-108 §1.2 규칙). */
function tabOf(v: string | null): TabId {
  return v === 'list' ? 'list' : 'proposals';
}

interface Pending { p: Proposal; openerId: string }

export function OverseasUniversePage() {
  const router = useRouter();
  const feed = useUniverseFeed();
  const [tab, setTab] = useState<TabId>('proposals');
  const [filter, setFilter] = useState<'all' | UniverseSource>('all');
  const [pending, setPending] = useState<Pending | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyById, setBusyById] = useState<Record<string, CardBusy>>({});
  /** 「저장은 끝났고 못 읽었다」 줄 앞에 붙일 완료 문구 — `act` 만(부록 B.3 C) */
  const [savedPrefixById, setSavedPrefixById] = useState<Record<string, string | null>>({});

  const onQuery = useCallback((q: URLSearchParams) => { setTab(tabOf(q.get('tab'))); }, []);
  const goTab = useCallback((id: TabId) => {
    setTab(id);
    router.replace(`?tab=${id}`, { scroll: false });   // 히스토리를 쌓지 않는다
  }, [router]);

  const d = feed.data;
  const summary = d?.summary.state === 'ok' ? d.summary.data : null;
  const proposals = d?.proposals.state === 'ok' ? d.proposals.data : null;
  const rows = d?.list.state === 'ok' ? d.list.data : null;
  const watch = d?.watch.state === 'ok' ? d.watch.data : null;

  const open = proposals ? proposals.filter((p) => p.state === 'open').length : null;
  const touched = proposals ? proposals.filter((p) => p.state !== 'open').length : 0;

  const setBusy = useCallback((id: string, v: CardBusy) => {
    setBusyById((m) => ({ ...m, [id]: v }));
  }, []);

  /** 보류·무시·되돌리기 — 시트 없이 바로 보낸다(되돌릴 수 있고 목록을 바꾸지 않는다). */
  const send = useCallback(async (p: Proposal, action: ProposalDo) => {
    setBusy(p.id, 'saving');
    try {
      const res = await fetch(`/api/settings/overseas-universe/proposals/${encodeURIComponent(p.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ do: action, baseState: p.state }),
      });
      const body = await res.json().catch(() => null) as
        { ok?: boolean; data?: { proposal?: Proposal; summary?: Parameters<typeof feed.patch>[0]['summary'] }; code?: string } | null;
      if (res.status === 409) {
        // 이미 처리됨 — 오류가 아니다. 서버가 돌려준 상태로 카드를 다시 그린다
        if (body?.data?.proposal) feed.patch({ proposal: body.data.proposal });
        else feed.refresh();
        setBusy(p.id, 'conflict');
        return;
      }
      if (!res.ok || !body?.ok) {
        setBusy(p.id, 'failed');
        return;
      }
      // 🔴 m-2 — 성공했지만 서버가 최신 값을 못 읽은 경우(`proposal: null`). 실패로 쓰지 않고 조용히 다시 읽는다
      if (!body.data?.proposal) {
        // 목록을 바꾸는 `act` 만 완료 문구를 앞에 붙인다(보류·무시·되돌리기는 뒤 문장만)
        setSavedPrefixById((m) => ({ ...m, [p.id]: action === 'act' ? p.doneText : null }));
        setBusy(p.id, 'saved_unreadable');
        feed.refresh();
        return;
      }
      feed.patch({ proposal: body.data.proposal, summary: body.data.summary });
      setBusy(p.id, 'idle');
      // 🔴 m-6 — `act` 는 수동 목록을 바꾼다. 목록 탭·출처 칩을 조용히 다시 읽어야 같은 화면에서 숫자가 어긋나지 않는다
      //   (보류·무시·되돌리기는 목록을 바꾸지 않으므로 재조회하지 않는다)
      if (action === 'act') feed.refresh();
    } catch {
      setBusy(p.id, 'failed');
    }
  }, [feed, setBusy]);

  const onQuick = useCallback((p: Proposal, action: Extract<ProposalDo, 'hold' | 'ignore' | 'reopen'>) => {
    void send(p, action);
  }, [send]);

  const onAct = useCallback((p: Proposal, openerId: string) => {
    setBusy(p.id, 'idle');
    setPending({ p, openerId });
  }, [setBusy]);

  const closeSheet = useCallback(() => { if (!saving) setPending(null); }, [saving]);

  const confirmAct = useCallback(async () => {
    if (!pending) return;
    setSaving(true);
    await send(pending.p, 'act');
    setSaving(false);
    setPending(null);
  }, [pending, send]);

  const cancelAct = useCallback(() => {
    if (saving || !pending) return;
    const id = pending.p.id;
    setPending(null);
    setBusy(id, 'cancelled');
    // 「취소했습니다 — 목록은 그대로입니다.」를 4초 보이고 지운다(데모 sh3no)
    setTimeout(() => setBusyById((m) => (m[id] === 'cancelled' ? { ...m, [id]: 'idle' } : m)), 4000);
  }, [pending, saving, setBusy]);

  const counts = useMemo(() => {
    if (!rows) return null;
    const c: Record<'all' | UniverseSource, number> = { all: rows.length, manual: 0, auto: 0, favorite: 0, held: 0 };
    for (const r of rows) for (const s of r.sources) c[s] += 1;
    return c;
  }, [rows]);

  const shownRows = useMemo(
    () => (rows ? (filter === 'all' ? rows : rows.filter((r) => r.sources.includes(filter))) : null),
    [rows, filter],
  );

  const loading = feed.load === 'loading';
  const notMigrated = feed.load === 'error' && feed.loadCode === 'not_migrated';
  const unauthorized = feed.load === 'error' && feed.loadCode === 'unauthorized';
  const loadFailed = feed.load === 'error' && !notMigrated && !unauthorized;
  const partial = partialWatchRow(watch);

  return (
    <div className="uv">
      <UniverseStyles />
      <Suspense fallback={null}><UrlQuerySync onChange={onQuery} /></Suspense>

      <div className="uv-head">
        <Link className="back" href="/settings" aria-label="설정으로 돌아가기">‹ 설정</Link>
        <h2>해외 분석 대상</h2>
        {d ? <span className="at">{mdhm(d.generatedAt)}</span> : null}
      </div>

      {notMigrated ? (
        <EmptyNote><StatusChip kind="prep">◌ {NOT_READY_TEXT}</StatusChip></EmptyNote>
      ) : unauthorized ? (
        <EmptyNote>
          로그인 필요 · 비어 있는 것이 아닙니다<br />
          <Link href="/login">다시 로그인해 주세요</Link>
        </EmptyNote>
      ) : (
        <>
          <TileGrid>
            {loading ? (
              <>
                <SkeletonTile /><SkeletonTile /><SkeletonTile /><SkeletonTile />
              </>
            ) : (
              <>
                <MetricTile
                  label="분석 대상"
                  value={summary ? <ValueUnit n={summary.total} unit="종목" /> : '—'}
                  meta={summary ? '보유 ∪ 즐겨찾기 ∪ 목록' : undefined}
                  chip={summary ? undefined : <StatusChip kind="error">! 조회 실패</StatusChip>}
                />
                <MetricTile
                  label="변경 제안"
                  value={open != null ? <ValueUnit n={open} unit="건" /> : '—'}
                  meta={open != null ? proposalTileMeta(open) : undefined}
                  chip={open != null ? undefined : <StatusChip kind="error">! 조회 실패</StatusChip>}
                />
                <MetricTile
                  label={manualTileLabel(summary?.manualSource ?? 'db')}
                  value={summary ? <ValueUnit n={summary.manual} unit="종목" /> : '—'}
                  meta={summary ? manualTileMeta(summary) : undefined}
                />
                <MetricTile
                  label={autoTileLabel(summary?.autoTopN ?? null)}
                  value={summary ? <ValueUnit n={summary.auto} unit="종목" /> : '—'}
                  meta={summary ? autoTileMeta(summary) : undefined}
                />
              </>
            )}
          </TileGrid>

          <div className="tabwrap">
            <SegmentControl
              label="해외 분석 대상 보기"
              idPrefix="uv-seg"
              items={[
                { id: 'proposals' as TabId, text: `변경 제안 ${loading ? '' : open ?? '?'}`.trim() },
                { id: 'list' as TabId, text: `목록 ${loading ? '' : rows?.length ?? '?'}`.trim() },
              ]}
              value={tab}
              onChange={goTab}
            />
          </div>

          {/* 두 패널을 동시에 마운트하지 않는다 — 목록 150행을 숨겨 두지 않는다(가이드 §2.3) */}
          <div hidden={tab !== 'proposals'}>
            {tab === 'proposals' ? (
              <ProposalsPanel
                loading={loading}
                failed={loadFailed || d?.proposals.state === 'error'}
                onRetry={feed.reload}
                proposals={proposals}
                busyById={busyById}
                savedPrefixById={savedPrefixById}
                onAct={onAct}
                onQuick={onQuick}
                open={open}
                touched={touched}
                watchText={watchSummaryText(watch)}
                partial={partial}
              />
            ) : null}
          </div>

          <div hidden={tab !== 'list'}>
            {tab === 'list' ? (
              <ListPanel
                loading={loading}
                failed={loadFailed || d?.list.state === 'error'}
                onRetry={feed.reload}
                rows={shownRows}
                counts={counts}
                filter={filter}
                onFilter={setFilter}
                manualSource={summary?.manualSource ?? 'db'}
              />
            ) : null}
          </div>
        </>
      )}

      {pending ? (
        <Sheet
          className="uv-sheet"
          title={pending.p.action.label}
          busy={saving}
          onClose={closeSheet}
          /*
            🔴 초기 포커스는 **제목**이다 — 확정 버튼에 포커스하지 않는다.
            고위험 시트에서 확정 버튼을 자동 포커스하면 **반사적 Enter·Space 가 저장을 실행**시킨다.
            `title` 을 고른 이유(앱 관례와 일치): 기존 호출처 **7곳 중 6곳이 `initialFocus="title"`** 이고
            1곳(`ledger/EntrySheet.tsx:259`)만 입력 폼이라 입력 칸을 가리킨다(「6곳이 모두」가 아니다 — 2026-11-01 정정).
            제목은 이미 `tabIndex={-1}` 이라 **새 id 가 필요 없다**. `취소` 로 하면 T-143 만 또 다른 방식이 된다.
            이 선택은 시험이 고정한다(`__tests__/sheet-focus.test.ts`) — 「편하게」 되돌리는 것을 막는 자리다.
          */
          initialFocus="title"
          returnFocusIds={() => [pending.openerId, actButtonId(pending.p.id), 'uv-seg-proposals']}
          footer={
            <div className="bt">
              <button type="button" className={ops.btn} disabled={saving} onClick={cancelAct}>취소</button>
              <button
                type="button" id="uv-sheet-yes" className={cx(ops.btn, ops.pri)} disabled={saving}
                onClick={() => { void confirmAct(); }}
              >
                {saving ? '저장 중…' : pending.p.action.verb}
              </button>
            </div>
          }
        >
          <p><b>{pending.p.symbol}</b> · {pending.p.kindLabel}</p>
          {/* 효과 숫자는 서버가 준 값으로만 만든다 — 모르면 그 줄을 뺀다(화면이 더하지 않는다) */}
          {effectText(pending.p.action.type, pending.p.effect)
            ? <p>{effectText(pending.p.action.type, pending.p.effect)}</p>
            : null}
          {/* 🔴 보유 중 경고 — 가이드 §2.4.2 의 4곳 중 셋째(시트 본문) */}
          {pending.p.warn ? <p className="warnline">{pending.p.warn}</p> : null}
          <p className="tail">{SHEET_TAIL}</p>
        </Sheet>
      ) : null}
    </div>
  );
}

// ── 제안 패널 ───────────────────────────────────────────────────────────────

function ProposalsPanel(p: {
  loading: boolean; failed: boolean; onRetry: () => void;
  proposals: Proposal[] | null; busyById: Record<string, CardBusy>; savedPrefixById: Record<string, string | null>;
  onAct: (p: Proposal, buttonId: string) => void;
  onQuick: (p: Proposal, action: Extract<ProposalDo, 'hold' | 'ignore' | 'reopen'>) => void;
  open: number | null; touched: number; watchText: string;
  partial: { title: string; sub: string } | null;
}) {
  if (p.loading) return <SkeletonRows />;
  if (p.failed || !p.proposals) {
    return (
      <EmptyNote>
        변경 제안을 불러오지 못했습니다.<br />
        <span style={{ fontSize: 12 }}>조회 실패 — 잠시 뒤 다시 해 보세요.</span><br /><br />
        <RetryButton onClick={p.onRetry} />
      </EmptyNote>
    );
  }
  return (
    <>
      {/* 「일부만 확인」 — 읽은 제안은 그대로 보인다(일부만 확인했어도 찾은 것은 보여 준다) */}
      {p.partial ? (
        <Rows>
          <CheckRow severity="e" glyph="!" title={p.partial.title} sub={p.partial.sub} />
        </Rows>
      ) : null}

      {p.proposals.map((x) => (
        <ProposalCard
          key={x.id} p={x} busy={p.busyById[x.id] ?? 'idle'} savedPrefix={p.savedPrefixById[x.id] ?? null}
          onAct={p.onAct} onQuick={p.onQuick}
        />
      ))}

      {/* 빈 상태 — 처리할 것이 없을 때만. 「3곳 모두 확인」은 서버가 그렇게 말할 때만 쓴다(§2.7) */}
      {(p.open ?? 0) === 0 ? (
        <EmptyNote>
          {emptyLeadText(p.touched)}<br />
          <span style={{ fontSize: 12 }}>{p.watchText}</span><br />
          {/* 🔴 12월 안내는 제안 0건에도 남는다 — 알림이 조용한 것은 목록이 맞다는 뜻이 아니다(§8.3 T-2) */}
          <span style={{ fontSize: 12 }}>{DECEMBER_NOTE}</span>
        </EmptyNote>
      ) : null}
    </>
  );
}

// ── 목록 패널 ───────────────────────────────────────────────────────────────

function ListPanel(p: {
  loading: boolean; failed: boolean; onRetry: () => void;
  rows: UniverseRow[] | null;
  counts: Record<'all' | UniverseSource, number> | null;
  filter: 'all' | UniverseSource;
  onFilter: (v: 'all' | UniverseSource) => void;
  manualSource: ManualSource;
}) {
  if (p.loading) return <SkeletonRows />;
  if (p.failed || !p.rows) {
    return (
      <EmptyNote>
        목록을 불러오지 못했습니다.<br />
        <span style={{ fontSize: 12 }}>조회 실패 — 잠시 뒤 다시 해 보세요.</span><br /><br />
        <RetryButton onClick={p.onRetry} />
      </EmptyNote>
    );
  }
  return (
    <>
      {/* 화면의 유일한 가로 스크롤(의도 — 가이드 §9.1). 한 번에 하나만 선택 */}
      <div className="filters" role="group" aria-label="출처로 걸러보기">
        {FILTER_IDS.map((id) => (
          <button
            key={id} type="button" aria-pressed={p.filter === id} onClick={() => p.onFilter(id)}
          >
            {filterText(id, p.manualSource)} {p.counts ? p.counts[id] : ''}
          </button>
        ))}
      </div>

      {p.rows.length === 0 ? (
        <EmptyNote>이 출처에 해당하는 종목이 없습니다.</EmptyNote>
      ) : (
        <div className="ulist">
          {p.rows.map((r) => (
            <div className="urow" key={r.symbol}>
              <span className="sy">
                {r.symbol}
                {r.name ? <small>{r.name}</small> : null}
              </span>
              <span className="tags">
                {r.sources.map((s) => (
                  <span key={s} className={cx('chip', s === 'favorite' ? 'fav' : s)}>
                    {s === 'auto' && r.autoRank != null ? `자동 ${r.autoRank}위`
                      : s === 'held' ? (r.heldQty != null && r.heldQty > 0 ? `보유 ${Number.isInteger(r.heldQty) ? r.heldQty : Number(r.heldQty.toFixed(4))}주` : '보유')
                        : sourceText(s, p.manualSource)}
                  </span>
                ))}
                {r.hasProposal ? <span className="chip prop">제안 있음</span> : null}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className={ops['sec-foot']}>{listFoot(p.manualSource)}</div>
      <div className="listfoot">
        <Link className={cx(ops.btn)} href="/settings/overseas-universe/bulk">{BULK_ENTRY_LABEL}</Link>
      </div>
    </>
  );
}
