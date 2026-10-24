'use client';

/**
 * T-074 — 설정 > '자산 기록' 섹션의 '입출금 기록' 요약 행 (승인 데모 v1 `settingsFrame`·`rowSummary`).
 * 누르면 /settings/cash-ledger. 자체 조회(`GET /api/cash-ledger`) — SettingsPage 의 Promise.all·저장 흐름과 섞지 않는다
 * (T-066 RiskPolicySummaryRow 와 같은 방식). 기록·계산 전용 — 계좌의 돈을 움직이지 않고 주문도 만들지 않는다.
 */
import Link from 'next/link';
import type { LedgerFeed } from '@/lib/ledger/types';
import { LedgerStyles } from '@/components/ledger/LedgerStyles';
import { LedgerBadge, St } from '@/components/ledger/Parts';
import { useLedgerFeed, type LoadState } from '@/components/ledger/useLedgerFeed';
import { md, NOT_READY_TEXT, plCls, spct, swon } from '@/components/ledger/view';

export function CashLedgerRowSummary({ load, data, code = null }: { load: LoadState; data: LedgerFeed | null; code?: string | null }) {
  if (load === 'loading') return <span role="status">불러오는 중…</span>;
  // 마이그레이션 전(503 not_migrated) — 고장이 아니라 준비 중(designer 구현 점검 P1-2). 다른 오류는 아래 경고 그대로
  if (load === 'error' && code === 'not_migrated') return <St kind="na" icon="◌">{NOT_READY_TEXT}</St>;
  if (load === 'error' || !data) return <St kind="warn" icon="!">불러오지 못했습니다 — 눌러서 다시 확인</St>;
  if (!data.baseline) {
    return (
      <>
        <St kind="na" icon="—">손익 기준이 아직 없습니다</St>
        <span className="muted">눌러서 기준을 정하면 입출금을 기록할 수 있습니다</span>
      </>
    );
  }
  const c = data.summary;
  if (!c) return <St kind="warn" icon="!">불러오지 못했습니다 — 눌러서 다시 확인</St>;
  const openCand = data.candidates.filter((x) => x.state === 'open').length;
  const chips = [];
  if (openCand) chips.push(<St kind="warn" icon="!" key="cand">기록 안 된 변화 {openCand}건</St>);
  if (c.unmatched) chips.push(<St kind="warn" icon="!" key="unm">불일치 {c.unmatched}건</St>);
  if (c.pending.count) chips.push(<St kind="na" icon="◌" key="pend">반영 대기 {c.pending.count}건</St>);
  if (c.unconfirmed) chips.push(<St kind="warn" icon="!" key="unc">기준 미확정</St>);
  return (
    <>
      <div>
        입출금 뺀 손익 <b className={`pl ${plCls(c.P)}`}>{swon(c.P)}</b>
        {c.R != null && <> <span className="num">({spct(c.R, 1)})</span></>}
        {' '}<span className="muted" style={{ whiteSpace: 'nowrap' }}>· {md(data.baseline.at).slice(0, 5)}부터</span>
        {c.unconfirmed && <> <span className="ptag">임시</span></>}
      </div>
      {chips.length > 0 && <div className="chips">{chips}</div>}
      <div className="muted" style={{ fontSize: 12 }}>기록 {c.live}건{c.last ? ` · 마지막 ${md(c.last.occurredAt)}` : ''}</div>
    </>
  );
}

export function CashLedgerSummaryRow() {
  const feed = useLedgerFeed();
  return (
    <div className="lg" style={{ marginBottom: 16 }}>
      <LedgerStyles />
      <Link className="riskrow" href="/settings/cash-ledger" aria-labelledby="cl-row-t cl-row-sum">
        <div className="top"><b id="cl-row-t">입출금 기록</b><LedgerBadge /></div>
        <div className="rk-sum" id="cl-row-sum"><CashLedgerRowSummary load={feed.load} data={feed.data} code={feed.loadCode} /></div>
        <div className="go"><span>입출금 기록 · 손익 보기</span><span className="chev" aria-hidden="true">›</span></div>
      </Link>
    </div>
  );
}
