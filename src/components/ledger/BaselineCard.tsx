/**
 * T-074 — 손익 기준 카드 (데모 `baseCardHtml`): 기준 시각·스냅샷 id·기준 총자산·원화/달러 현금(✓확인 / !스냅샷 값)·환율·버전
 * + [기준 현금 확인] [기준 바꾸기]. 스냅샷에 달러 현금 행이 없으면(해외 미사용) 달러·환율 줄을 그리지 않는다.
 */
import type { LedgerFeed, LedgerSummary } from '@/lib/ledger/types';
import { St } from './Parts';
import { isoMin, rt, usd, won } from './view';

export const BASE_IDS = { title: 'lg-bs-t', confirm: 'lg-bs-conf', change: 'lg-bs-chg' } as const;

export function BaselineCard(p: {
  feed: LedgerFeed;
  c: LedgerSummary;
  onConfirm: (triggerId: string) => void;
  onChange: (triggerId: string) => void;
}) {
  const B = p.feed.baseline!;
  const cf = B.confirmed;
  return (
    <section className="card basecard" aria-labelledby={BASE_IDS.title}>
      <div className="bc-h"><h3 id={BASE_IDS.title}>손익 기준</h3><span className="muted" style={{ fontSize: 12 }}>버전 {B.version}</span></div>
      <dl className="kd">
        <dt>기준 시각</dt><dd>{isoMin(B.at)} <span className="muted">(스냅샷 #{B.snapshotId})</span></dd>
        <dt>기준 총자산</dt><dd><b className="num">{won(p.c.b0)}</b></dd>
        <dt>원화 현금</dt>
        <dd>{cf.krwCash != null ? <>{won(cf.krwCash)} <St kind="ok" icon="✓">확인</St></> : <>{won(B.krwCash)} <St kind="warn" icon="!">스냅샷 값</St></>}</dd>
        {B.usdCash != null && <>
          <dt>달러 현금</dt>
          <dd>{cf.usdCash != null ? <>{usd(cf.usdCash)} <St kind="ok" icon="✓">확인 (외화예수금)</St></> : <>{usd(B.usdCash)} <St kind="warn" icon="!">스냅샷 값</St></>}</dd>
        </>}
        {B.fx != null && <><dt>환율</dt><dd>{rt(B.fx)}원/$ <span className="muted">(그 스냅샷의 앱 환율)</span></dd></>}
      </dl>
      <div className="btns">
        <button type="button" className="btn sec" id={BASE_IDS.confirm} onClick={() => p.onConfirm(BASE_IDS.confirm)}>기준 현금 확인</button>
        <button type="button" className="btn sec" id={BASE_IDS.change} onClick={() => p.onChange(BASE_IDS.change)}>기준 바꾸기</button>
      </div>
    </section>
  );
}
