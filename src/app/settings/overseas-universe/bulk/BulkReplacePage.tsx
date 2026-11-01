'use client';

/**
 * T-143 WP-B — 12월 정기 재구성: 수동 목록 한 번에 바꾸기 (`/settings/overseas-universe/bulk`).
 * 승인 데모 v1 §4 · 구현 가이드 §2.6.
 *
 * **고위험 취급**(데모 §4 주의). 주문은 아니지만 분석 대상이 통째로 바뀌므로 네 겹을 둔다:
 *   ① 저장 전 **대조 화면**(넣을 것·뺄 것·그대로) ② **확인 시트**(바뀌는 수와 그 결과를 글로)
 *   ③ 성공·실패·취소 표시 ④ **형식 오류가 1건이라도 있으면 저장 버튼이 꺼진다** — 일부만 반영되는 상태를 만들지 않는다.
 *
 * 왜 별 화면인가(가이드 §1.1): 데모 §4 가 자기 앱바(`‹ 수동 목록 한 번에 바꾸기`)를 그렸고, 한 화면에 붙이면
 * 세로 스크롤이 2곳이 되며(모바일 원칙 위반) 뒤로 가기가 설정 허브까지 튄다.
 *
 * 붙여넣은 내용은 **저장 실패 뒤에도 지우지 않는다**(실패 문구가 그렇게 약속한다).
 * 소문자는 **자동 대문자로 바꾸지 않고 형식 오류로 막는다**(Leader L-3 — 입력한 것과 저장된 것이 달라지지 않게).
 */
import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { EmptyNote, RetryButton, StatusChip, cx, ops } from '@/components/ops/ui';
import { Sheet } from '@/components/ui/Sheet';
import { DIFF_SAVE_BUTTON_ID, ManualListDiff } from '@/components/universe/ManualListDiff';
import { UniverseStyles } from '@/components/universe/UniverseStyles';
import { useUniverseFeed } from '@/components/universe/useUniverseFeed';
import {
  BULK_CONFLICT_TEXT, BULK_FAIL_TEXT, BULK_HINT_1, BULK_SHEET_TAIL, NOT_READY_TEXT, bulkConfirmVerb,
  bulkEmptyConfirmText, bulkHint2, bulkRemovedExplainText, bulkSavedUnreadableText, bulkSheetLead, bulkSheetTitle,
  bulkSuccessText,
} from '@/components/universe/view';
import { buildManualListDiff, type ManualListDiffResult } from '@/lib/universe/parse-manual-list';

/**
 * `'ok_unreadable'` = **저장은 끝났고 화면만 못 불러온 상태**(부록 B.3 경우 B). `'ok'`(초록)·`'failed'`(빨강)와
 * 따로 두는 이유: 일부만 끝난 상태라 성공 꼴로 쓰면 과장이고 실패 꼴로 쓰면 거짓이다 → **중립 꼴**로 그린다.
 */
type SaveState = 'idle' | 'saving' | 'ok' | 'ok_unreadable' | 'failed' | 'conflict';

export function BulkReplacePage() {
  const feed = useUniverseFeed();
  const [text, setText] = useState('');
  const [diff, setDiff] = useState<ManualListDiffResult | null>(null);
  const [sheet, setSheet] = useState<{ openerId: string } | null>(null);
  const [save, setSave] = useState<SaveState>('idle');
  const [result, setResult] = useState<string | null>(null);

  const summary = feed.data?.summary.state === 'ok' ? feed.data.summary.data : null;
  const rows = feed.data?.list.state === 'ok' ? feed.data.list.data : null;
  // 모든 「기본 목록」 분기의 조건은 이 값 하나다(부록 B.5) — 화면이 따로 판단하지 않는다
  const manualSource = summary?.manualSource ?? 'db';

  /** 현재 수동 목록 — 목록 조회가 성공했을 때만 대조할 수 있다(대조 상대를 모르면 「전부 넣기」로 보인다). */
  const current = useMemo(
    () => (rows ? rows.filter((r) => r.sources.includes('manual')).map((r) => r.symbol) : null),
    [rows],
  );
  const heldQty = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const r of rows ?? []) if (r.sources.includes('held')) m.set(r.symbol, r.heldQty);
    return m;
  }, [rows]);

  const compare = useCallback(() => {
    if (!current) return;
    setDiff(buildManualListDiff(current, text));
    setSave('idle');
    setResult(null);
  }, [current, text]);

  const openSheet = useCallback((openerId: string) => {
    setSheet({ openerId });
  }, []);

  const closeSheet = useCallback(() => { if (save !== 'saving') setSheet(null); }, [save]);

  const cancel = useCallback(() => {
    if (save === 'saving') return;
    setSheet(null);
    setResult('취소했습니다 — 목록은 그대로입니다.');
    setSave('idle');
    setTimeout(() => setResult((r) => (r === '취소했습니다 — 목록은 그대로입니다.' ? null : r)), 4000);
  }, [save]);

  const confirm = useCallback(async () => {
    if (!diff || !summary) return;
    setSave('saving');
    try {
      const res = await fetch('/api/settings/overseas-universe/manual', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ symbols: diff.next, baseVersion: summary.manualVersion }),
      });
      const body = await res.json().catch(() => null) as
        { ok?: boolean; warning?: string; data?: { summary?: unknown; applied?: { added: number; removed: number; kept: number }; version?: number } } | null;
      setSheet(null);
      if (res.status === 409) {
        setSave('conflict');
        setResult(BULK_CONFLICT_TEXT);
        feed.refresh();   // 최신 목록으로 다시 대조할 수 있게
        return;
      }
      if (!res.ok || !body?.ok || !body.data?.applied) {
        setSave('failed');
        setResult(BULK_FAIL_TEXT);
        return;
      }
      const a = body.data.applied;
      // 🔴 B.3 — 저장은 됐고 요약만 못 읽은 경우(`summary: null`)는 **중립 꼴 + 「다시 저장하지 않아도 된다」**다.
      //   「목록은 바뀌지 않았습니다」를 쓰면 사용자가 같은 저장을 다시 눌러 409(또는 두 벌 이력)로 간다
      const unreadable = body.data.summary == null;
      setSave(unreadable ? 'ok_unreadable' : 'ok');
      setResult(unreadable
        ? bulkSavedUnreadableText(diff.next.length, a.added, a.removed)
        : bulkSuccessText(diff.next.length, a.added, a.removed));
      feed.refresh();
    } catch {
      setSheet(null);
      setSave('failed');
      setResult(BULK_FAIL_TEXT);
    }
  }, [diff, summary, feed]);

  const loading = feed.load === 'loading';
  const notMigrated = feed.load === 'error' && feed.loadCode === 'not_migrated';
  const unauthorized = feed.load === 'error' && feed.loadCode === 'unauthorized';
  const listFailed = !loading && !notMigrated && !unauthorized && (feed.load === 'error' || !current);
  const empty = diff != null && diff.next.length === 0;

  return (
    <div className="uv">
      <UniverseStyles />

      <div className="uv-head">
        <Link className="back" href="/settings/overseas-universe?tab=list" aria-label="해외 분석 대상으로 돌아가기">‹ 해외 분석 대상</Link>
        <h2>수동 목록 한 번에 바꾸기</h2>
      </div>

      {notMigrated ? (
        <EmptyNote><StatusChip kind="prep">◌ {NOT_READY_TEXT}</StatusChip></EmptyNote>
      ) : unauthorized ? (
        <EmptyNote>
          로그인 필요 · 비어 있는 것이 아닙니다<br />
          <Link href="/login">다시 로그인해 주세요</Link>
        </EmptyNote>
      ) : (
        <div className="bulk">
          <label htmlFor="uv-ta">새 나스닥100 목록 붙여넣기</label>
          <p className="hint" id="uv-tahelp">{BULK_HINT_1}<br />{bulkHint2(manualSource)}</p>
          <textarea
            id="uv-ta" rows={9} spellCheck={false} aria-describedby="uv-tahelp"
            value={text} onChange={(e) => setText(e.target.value)}
            disabled={save === 'saving'}
          />

          {listFailed ? (
            <EmptyNote>
              현재 수동 목록을 불러오지 못해 대조할 수 없습니다.<br />
              <span style={{ fontSize: 12 }}>조회 실패 — 무엇이 바뀌는지 모르는 상태로 저장하지 않습니다.</span><br /><br />
              <RetryButton onClick={feed.reload} />
            </EmptyNote>
          ) : (
            <div className="bar1">
              <button
                type="button" className={cx(ops.btn, ops.pri)}
                disabled={loading || save === 'saving'} onClick={compare}
              >
                {loading ? '현재 목록 불러오는 중…' : '대조하기'}
              </button>
            </div>
          )}

          {diff && current ? (
            <ManualListDiff
              diff={diff}
              currentCount={current.length}
              heldQty={heldQty}
              heldOrFavoritesOnlyCount={summary?.heldOrFavoritesOnlyCount ?? null}
              manualSource={manualSource}
              busy={save === 'saving'}
              onRecompare={compare}
              onSave={openSheet}
            />
          ) : null}

          {result ? (
            <div
              /* 'ok_unreadable' 은 ops.ok·ops.e 를 **둘 다 붙이지 않는다**(중립 꼴 — 새 CSS 가 필요 없다, 부록 B.3) */
              className={cx(ops.res, save === 'ok' ? ops.ok : save === 'failed' || save === 'conflict' ? ops.e : undefined)}
              role={save === 'failed' || save === 'conflict' ? 'alert' : 'status'}
            >
              {result}
            </div>
          ) : null}
        </div>
      )}

      {sheet && diff && current ? (
        <Sheet
          className="uv-sheet"
          title={bulkSheetTitle(empty, manualSource)}
          busy={save === 'saving'}
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
          returnFocusIds={() => [sheet.openerId, DIFF_SAVE_BUTTON_ID]}
          footer={
            <div className="bt">
              <button type="button" className={ops.btn} disabled={save === 'saving'} onClick={cancel}>취소</button>
              <button
                type="button" id="uv-bulk-yes" className={cx(ops.btn, empty ? ops.dz : ops.pri)}
                disabled={save === 'saving'} onClick={() => { void confirm(); }}
              >
                {save === 'saving' ? '저장 중…' : bulkConfirmVerb(diff.next.length)}
              </button>
            </div>
          }
        >
          {/* 저장 전에는 「0 → 100」이 아니라 **교체**라고 말한다(부록 B.2.1) */}
          {manualSource === 'fallback'
            ? <p>{bulkSheetLead(current.length, diff.next.length)}</p>
            : <p>수동 목록을 <b>{current.length} → {diff.next.length}종목</b>으로 바꿉니다.</p>}
          <p>넣을 것 <b>{diff.add.length}</b> · 뺄 것 <b>{diff.rm.length}</b> · 그대로 <b>{diff.same.length}</b></p>
          {/* 🔴 저장 전 **뺄 것이 무엇인지** — Reviewer 가 짚은 「말하지 않는 사실」(부록 B.2.1) */}
          {manualSource === 'fallback' && diff.rm.length > 0 ? (
            <p>{bulkRemovedExplainText(diff.rm.length)}</p>
          ) : null}
          {empty ? (
            <p className="alertline">{bulkEmptyConfirmText(summary?.heldOrFavoritesOnlyCount ?? null, manualSource)}</p>
          ) : null}
          {/* 🔴 보유 중 경고 — 가이드 §2.4.2 의 4곳 중 넷째(일괄 교체) */}
          {diff.rm.some((s) => heldQty.has(s)) ? (
            <p className="warnline">빼는 종목 중 보유 중인 것이 있습니다 — 목록에서 빠져도 분석은 계속됩니다.</p>
          ) : null}
          <p className="tail">{BULK_SHEET_TAIL}</p>
        </Sheet>
      ) : null}
    </div>
  );
}
