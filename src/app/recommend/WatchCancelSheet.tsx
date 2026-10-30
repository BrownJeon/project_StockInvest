'use client';

/**
 * T-108 §2.4.2 — 진입 감시 취소 확인 대화상자. 지금까지의 `window.confirm` + `alert` 를 대신한다.
 *
 * **요청은 이전과 한 글자도 같다**: `DELETE /api/signals/{id}` (본문 없음). 바뀌는 것은 확인·결과 표시뿐이다.
 *  - 처리 중: 두 버튼 비활성 · Esc·닫기 무시(Sheet `busy`).
 *  - 성공(`ok: true`): 닫고 목록에서 제거 + 토스트 「진입 감시를 취소했습니다」, 포커스는 세그먼트 「운용 현황」.
 *  - 404(`not found or not cancellable` — 이미 사라졌거나 주문 처리 중으로 바뀜): 「이미 사라졌거나 …」 + 목록 다시 읽기.
 *    이때는 「감시는 그대로입니다」라고 말하지 않는다(R-UI ⑧).
 *  - 그 밖의 거부(4xx): 「! 취소하지 못했습니다 · 잠시 후 다시 시도하세요 — 감시는 그대로입니다」. 서버 원문(영문)은 보이지 않는다.
 *  - 5xx·연결 끊김·응답을 읽지 못함: 「! 연결이 끊겼습니다 — 취소됐는지 알 수 없습니다. 목록을 새로 고쳐 확인하세요.」
 *    (서버에 닿았을 수도 있어 「그대로」라고 말하지 않는다).
 * `executing`(주문 선점 중) 행에는 이 대화상자를 여는 버튼이 없다 — 목록이 `approved_pending_entry` 만 대상이다.
 */
import { useState } from 'react';
import { Sheet } from '@/components/ui/Sheet';
import { cx, ops } from '@/components/ops/ui/styles';

export interface WatchCancelTarget {
  id: number;
  /** 화면 이름(useSymbolMeta displaySymbol) */
  name: string;
  market: string;
  side: string;
}

export type WatchCancelOutcome =
  | { kind: 'ok' }
  /** 서버가 거부(4xx, 404 제외) — 감시는 그대로 */
  | { kind: 'fail' }
  /** 404 — 이미 사라졌거나 취소할 수 없는 상태(주문 처리 중 등)로 바뀜 */
  | { kind: 'gone' }
  /** 결과를 알 수 없음(5xx·연결 끊김·본문 못 읽음) */
  | { kind: 'unknown' };

/** 취소 요청 1회 — 이전 `handleCancelPending` 과 같은 URL·메서드. 결과를 세 갈래로 읽는다(순수 판정 + fetch 주입). */
export async function cancelWatch(id: number, fetchImpl: typeof fetch = fetch): Promise<WatchCancelOutcome> {
  let res: Response;
  try {
    res = await fetchImpl(`/api/signals/${id}`, { method: 'DELETE' });
  } catch {
    return { kind: 'unknown' };
  }
  let data: { ok?: unknown } | null;
  try { data = await res.json(); } catch { return { kind: 'unknown' }; }
  if (data && data.ok === true) return { kind: 'ok' };
  if (res.status === 404) return { kind: 'gone' };
  if (res.status >= 500 || !data) return { kind: 'unknown' };
  return { kind: 'fail' };
}

export const WATCH_CANCEL_TITLE = '진입 감시를 취소하고 시나리오를 삭제할까요?';

export function watchCancelBody(t: Pick<WatchCancelTarget, 'name' | 'market' | 'side'>): string {
  const mk = t.market === 'overseas' ? '해외' : '국내';
  const side = t.side === 'sell' ? '매도' : '매수';
  return `${t.name} ${mk} ${side} 감시 · 취소하면 이 시나리오로는 주문이 나가지 않습니다.`;
}

export function watchCancelErrorText(out: Exclude<WatchCancelOutcome, { kind: 'ok' }>): string {
  if (out.kind === 'fail') return '! 취소하지 못했습니다 · 잠시 후 다시 시도하세요 — 감시는 그대로입니다';
  if (out.kind === 'gone') return '이미 사라졌거나 주문 처리 중이라 취소할 수 없는 감시입니다 — 목록을 새로 고쳤습니다.';
  return '! 연결이 끊겼습니다 — 취소됐는지 알 수 없습니다. 목록을 새로 고쳐 확인하세요.';
}

/** 대화상자 안쪽(포털·효과 없음) — 정적 렌더 시험이 문구·결과를 이것으로 본다. */
export function WatchCancelBody(p: { target: WatchCancelTarget; busy: boolean; error: string | null }) {
  return (
    <>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--muted)', wordBreak: 'keep-all' }}>{watchCancelBody(p.target)}</p>
      {p.busy ? (
        <div className={ops.res} tabIndex={-1} id="watch-cancel-res">
          <span className={ops.spin} aria-hidden="true" /> 처리 중… (다시 누를 수 없음)
        </div>
      ) : p.error ? (
        <div className={cx(ops.res, ops.e)} tabIndex={-1} id="watch-cancel-res">{p.error}</div>
      ) : null}
    </>
  );
}

/** 버튼 두 개 — [취소하지 않음](보통) · [감시 취소](위험). 처리 중엔 둘 다 비활성. */
export function WatchCancelButtons(p: { busy: boolean; onKeep: () => void; onConfirm: () => void }) {
  return (
    <div className={ops.btrow} style={{ marginTop: 0 }}>
      <button type="button" className={ops.btn} onClick={p.onKeep} disabled={p.busy}>취소하지 않음</button>
      <button type="button" className={cx(ops.btn, ops.dz)} onClick={p.onConfirm} disabled={p.busy}>감시 취소</button>
    </div>
  );
}

export function WatchCancelSheet(p: {
  target: WatchCancelTarget;
  onClose: () => void;
  /** 취소 성공 — 부모가 목록에서 지우고 토스트를 띄운다 */
  onCancelled: (id: number) => void;
  /** 404(이미 사라짐·취소 불가) — 부모가 목록을 다시 읽는다 */
  onGone?: () => void;
  /** 닫힐 때 포커스 후보 id(세그먼트 「운용 현황」 버튼 등) */
  returnFocusIds?: () => readonly (string | null | undefined)[];
  cancelImpl?: typeof cancelWatch;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusReq, setFocusReq] = useState<{ id: string; seq: number } | null>(null);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const out = await (p.cancelImpl ?? cancelWatch)(p.target.id);
    setBusy(false);
    if (out.kind === 'ok') { p.onCancelled(p.target.id); return; }
    if (out.kind === 'gone') p.onGone?.();
    setError(watchCancelErrorText(out));
    setFocusReq((f) => ({ id: 'watch-cancel-res', seq: (f?.seq ?? 0) + 1 }));
  }

  return (
    <Sheet
      title={WATCH_CANCEL_TITLE}
      onClose={p.onClose}
      busy={busy}
      initialFocus="title"
      focusRequest={focusReq}
      returnFocusIds={p.returnFocusIds}
      footer={<WatchCancelButtons busy={busy} onKeep={p.onClose} onConfirm={confirm} />}
    >
      <WatchCancelBody target={p.target} busy={busy} error={error} />
    </Sheet>
  );
}
