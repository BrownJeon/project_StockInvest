'use client';

/**
 * T-143 WP-B — 변경 제안 카드 1개 (구현 가이드 §2.4, 승인 데모 §3 `.pcard`).
 *
 * 카드 1개 = 제안 1건. 상태 5종(§2.4.1): `open`(버튼 3개) · `held` · `ignored`(되돌리기) · `done`(초록 줄) ·
 * `failed`(**화면 전용** — 저장 요청이 실패한 상태, 새로 고치면 `open` 으로 돌아온다. DB 에 `failed` 를 만들지 않는다).
 *
 * 🔴 보유 중 경고는 **카드 머리 칩 · 경고 줄 · 완료 문구**에 남는다(가이드 §2.4.2 의 4곳 중 셋. 넷째는 일괄 교체 대조,
 * 시트 본문은 부모가 그린다). 이 문구가 사라지면 결함이다(§8.3 T-1 회귀 시험 대상) —
 * 「뺐으니 끝」으로 오해하지 않게, 보유 중이면 **분석이 계속된다는 사실**을 완료 시점에도 말한다.
 *
 * 보류·무시·되돌리기는 **시트를 거치지 않는다**(되돌릴 수 있고 목록을 바꾸지 않는다 — 데모 동작).
 * 주 행동(빼기·넣기·코드 바꾸기)만 확인 시트를 거친다 — 부모가 `onAct` 에서 시트를 연다.
 */
import { cx, ops } from '@/components/ops/ui/styles';
import type { Proposal, ProposalDo } from '@/lib/universe/types';
import {
  PROPOSAL_CANCEL_TEXT, PROPOSAL_CONFLICT_TEXT, PROPOSAL_DONE_TAIL, PROPOSAL_FAILED_TEXT, PROPOSAL_IGNORED_TEXT,
  PROPOSAL_SAVED_UNREADABLE_TEXT, heldChipText, proposalHeldText,
} from './view';

/** 저장 요청의 화면 쪽 상태 — DB 상태가 아니다. */
export type CardBusy = 'idle' | 'saving' | 'failed' | 'cancelled' | 'conflict' | 'saved_unreadable';

export interface ProposalCardProps {
  p: Proposal;
  busy: CardBusy;
  /**
   * `busy === 'saved_unreadable'` 일 때 앞에 붙일 완료 문구(부록 B.3 C — 카드가 `{doneText} · {문장}` 으로 그린다).
   * 목록을 바꾸지 않는 조작(보류·무시·되돌리기)의 조회 실패에는 null — 그때는 뒤 문장만 쓴다.
   */
  savedPrefix?: string | null;
  /** 주 행동 — 부모가 확인 시트를 연다. 두 번째 인자는 포커스 복귀용 버튼 id. */
  onAct: (p: Proposal, buttonId: string) => void;
  /** 보류·무시·되돌리기 — 시트 없이 바로 보낸다. */
  onQuick: (p: Proposal, action: Extract<ProposalDo, 'hold' | 'ignore' | 'reopen'>) => void;
}

/** 카드 안 버튼 id — 시트를 닫은 뒤 포커스를 돌려줄 대상(`Sheet returnFocusIds`). */
export function actButtonId(id: string): string {
  return `uv-act-${id}`;
}

export function ProposalCard({ p, busy, savedPrefix, onAct, onQuick }: ProposalCardProps) {
  const settled = p.state === 'done' || p.state === 'ignored';
  const saving = busy === 'saving';
  const heldChip = p.held ? heldChipText(p.held.qty) : null;
  return (
    <div className={cx('pcard', settled && 'settled')} data-proposal={p.id}>
      <div className="ph">
        <span className="sym">{p.symbol}</span>
        <span className={cx('chip', p.action.type === 'remove' ? 'prop' : undefined)}>{p.kindLabel}</span>
        {heldChip ? <span className="chip held">{heldChip}</span> : null}
      </div>

      <dl>
        <dt>근거</dt>
        <dd>{p.basis}</dd>
        <dt>권고</dt>
        {/* 권고가 없으면 주 행동 이름을 쓴다 — 빈 줄을 남기지 않는다(데모 `p.rec || p.act`) */}
        <dd>{p.recommendation ?? p.action.label}</dd>
      </dl>

      {/* 🔴 보유 중 경고 — 가이드 §2.4.2 #2. 서버가 완성해 준 평문을 그대로 그린다 */}
      {p.warn ? <div className="warnline">{p.warn}</div> : null}

      {busy === 'failed' ? (
        <div className="rl bad" role="alert">{PROPOSAL_FAILED_TEXT}</div>
      ) : null}
      {busy === 'cancelled' ? (
        <div className="rl" role="status">{PROPOSAL_CANCEL_TEXT}</div>
      ) : null}
      {/* 409(이미 처리됨)는 오류가 아니다 — role="status", 빨강으로 쓰지 않는다(가이드 §9.2) */}
      {busy === 'conflict' ? (
        <div className="rl" role="status">{PROPOSAL_CONFLICT_TEXT}</div>
      ) : null}
      {/*
        🔴 B.3 C — 처리는 됐고 다시 읽기만 실패했다. **실패로 쓰지 않고**(「처리되지 않았다」가 거짓이 된다)
        `.ok`(초록)도 붙이지 않는다 — 일부만 끝난 상태라 중립 꼴(`.rl`)이다.
      */}
      {busy === 'saved_unreadable' ? (
        <div className="rl" role="status">
          {savedPrefix ? `${savedPrefix} · ` : ''}{PROPOSAL_SAVED_UNREADABLE_TEXT}
        </div>
      ) : null}

      {p.state === 'held' ? (
        <div className="rl" role="status">{proposalHeldText(p.heldUntil)}</div>
      ) : null}
      {p.state === 'ignored' ? (
        <div className="rl" role="status">{PROPOSAL_IGNORED_TEXT}</div>
      ) : null}
      {p.state === 'done' ? (
        <div className="rl ok" role="status">{`${p.doneText} · ${PROPOSAL_DONE_TAIL}`}</div>
      ) : null}

      {p.state === 'open' ? (
        <div className="acts">
          <button
            type="button" id={actButtonId(p.id)} className={cx(ops.btn, ops.pri, 'wide')}
            disabled={saving} onClick={() => onAct(p, actButtonId(p.id))}
          >
            {busy === 'failed' ? '다시 시도' : p.action.label}
          </button>
          <button type="button" className={ops.btn} disabled={saving} onClick={() => onQuick(p, 'hold')}>보류</button>
          <button type="button" className={ops.btn} disabled={saving} onClick={() => onQuick(p, 'ignore')}>무시</button>
        </div>
      ) : null}

      {p.state === 'held' || p.state === 'ignored' ? (
        <div className="acts">
          <button type="button" className={cx(ops.btn, 'wide')} disabled={saving} onClick={() => onQuick(p, 'reopen')}>
            되돌리기
          </button>
        </div>
      ) : null}
    </div>
  );
}
