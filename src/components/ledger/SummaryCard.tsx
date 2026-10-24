/**
 * T-074 — 요약 카드 (데모 `summaryHtml`): 입출금 뺀 투자 손익 · 수익률(근사) · 공식 줄 · 기준/현재/순입금/마지막 기록/기록 수.
 * 손익 숫자는 서버가 `compute.ts` 로 낸 `summary` 그대로다(화면 미리보기와 같은 함수). 빨강/파랑은 이 손익에만 쓴다.
 */
import type { LedgerEntryView, LedgerFeed, LedgerSummary } from '@/lib/ledger/types';
import { St } from './Parts';
import { ago, entryOne, md, plCls, plWord, spct, statusParts, swon, won } from './view';

export const SUM_TITLE_ID = 'lg-sum-t';

export function SummaryCard({ feed, c }: { feed: LedgerFeed; c: LedgerSummary }) {
  const B = feed.baseline!;
  const S = feed.snapshot!;
  const unconf = c.unconfirmed;
  const lastEntry: LedgerEntryView | undefined = c.last ? feed.entries.find((e) => e.id === c.last!.id) : undefined;
  return (
    <section className="sumcard" aria-labelledby={SUM_TITLE_ID}>
      <div className="sc-top">
        <h3 id={SUM_TITLE_ID} tabIndex={-1}>입출금 뺀 투자 손익</h3>
        {unconf && <span className="ptag">임시 · 기준 미확정</span>}
      </div>
      {/* 결과 변화는 토스트(role=status)가 읽는다 — 요약 숫자는 live 영역으로 두지 않는다(designer 점검 a11y Minor-2, 이중 낭독 방지) */}
      <div className="sc-big">
        <span className={`pl ${plCls(c.P)}`}>{swon(c.P)}</span><span className="w">{plWord(c.P)}</span>
      </div>
      <div className="sc-r">
        <span className="muted">수익률(근사)</span>
        {c.R == null ? <b>계산 불가</b> : <b className="num">{spct(c.R, 2)}</b>}
        <span className="muted">· {c.days > 0 ? `기준부터 ${c.days}일` : '기준 당일'}</span>
      </div>
      <details className="mini">
        <summary>이 숫자의 뜻</summary>
        <p>기준 시각 뒤 <b>넣은 돈과 뺀 돈을 빼고</b> 투자로 늘어나거나 줄어든 돈입니다. 원화 기준이라 환율 변동이 함께 들어 있습니다. 수익률(근사)은 기간 중 평균적으로 투자돼 있던 돈 대비 값으로, 입금 시점을 반영한 근사 계산입니다. 반영 대기 기록은 아직 빠져 있습니다.</p>
      </details>
      <div className="formula">
        현재 총자산 {won(c.v)} − 기준 총자산 {won(c.b0)} − 순입금(넣은 돈 − 뺀 돈) {won(c.net)} = <b className="num">{swon(c.P)}</b>
      </div>
      <dl className="sc-dl">
        <div><dt>기준일</dt><dd>{md(B.at)}<small>스냅샷 #{B.snapshotId}</small></dd></div>
        <div>
          <dt>기준 총자산</dt>
          <dd>{won(c.b0)}<small>{unconf ? <St kind="warn" icon="!">현금 미확정 — 스냅샷 값</St> : <St kind="ok" icon="✓">현금 확인됨</St>}</small></dd>
        </div>
        <div><dt>현재 총자산</dt><dd>{won(c.v)}<small>{md(S.ts)} 스냅샷 · {ago(S.ageMin)}</small></dd></div>
        <div><dt>순입금</dt><dd>{swon(c.net)}<small>넣은 돈 {won(c.inflow)} · 뺀 돈 {won(c.outflow)}</small></dd></div>
        <div>
          <dt>마지막 기록</dt>
          {c.last
            ? <dd>{md(c.last.occurredAt)}<small>{entryOne(c.last)} · {lastEntry ? statusParts(lastEntry)[2] : ''}</small></dd>
            : <dd>없음<small>아직 기록이 없습니다</small></dd>}
        </div>
        <div><dt>기록</dt><dd>{c.live}건<small>{c.voids ? `취소·정정 ${c.voids}건 별도` : '취소·정정 없음'}</small></dd></div>
      </dl>
    </section>
  );
}
