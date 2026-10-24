/**
 * T-074 — 신뢰도 표지 (데모 `signalsHtml`): 기준 미확정 · 스냅샷 오래됨 · 밤 스냅샷(달러 일부 안 보임) · 반영 대기 · 불일치
 * + 환율 없음(designer 구현 점검 P2-6). 해당할 때만 보인다. 반영 대기는 "지금 손익에는 빠져 있습니다"를 그 자리에 적는다.
 * 밤 표지의 "(16~06시)" 괄호는 그 스냅샷 시각이 실제로 그 시간대일 때만 붙인다(P2-5 — 판정은 데이터로 하므로 낮 시각과 모순되지 않게).
 */
import type { ReactElement } from 'react';
import type { LedgerFeed, LedgerSummary } from '@/lib/ledger/types';
import { ago, hm, md, swon, usd, won } from './view';

/** '16~06' 같은 시간대(KST, 자정 넘김 허용)에 'YYYY-MM-DD HH:mm[:ss]' 시각이 들어가는가 */
export function inHourRange(ts: string, range: string): boolean {
  const m = /^(\d{1,2})~(\d{1,2})$/.exec(range.trim());
  const h = Number(ts.slice(11, 13));
  if (!m || !Number.isFinite(h)) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a <= b ? h >= a && h < b : h >= a || h < b;
}

export const SIG_IDS = { base: 'lg-sig-base', unmatched: 'lg-sig-un' } as const;

export function TrustSignals(p: {
  feed: LedgerFeed;
  c: LedgerSummary;
  onBaseConfirm: (triggerId: string) => void;
  onGoEntry: (id: number) => void;
}) {
  const { feed, c } = p;
  const S = feed.snapshot!;
  const rules = feed.rules;
  const out: ReactElement[] = [];
  if (c.unconfirmed) {
    out.push(
      <div className="warnbox" role="note" key="unconf">
        <b>! 기준 미확정</b> — 기준 시각의 현금을 아직 확인하지 않아, 지금 손익은 스냅샷 값으로 낸 <b>임시 계산</b>입니다.
        <div className="btns" style={{ marginTop: 8 }}>
          <button type="button" className="btn sec" id={SIG_IDS.base} onClick={() => p.onBaseConfirm(SIG_IDS.base)}>기준 현금 확인</button>
        </div>
      </div>,
    );
  }
  if (S.stale) {
    out.push(
      <div className="warnbox" role="note" key="stale">
        <b>! 현재 총자산이 {ago(S.ageMin)}({md(S.ts)}) 스냅샷 값입니다.</b> 그 뒤 변화는 아직 손익에 없습니다. 스냅샷은 보통 1시간마다 생기고, {rules.staleH}시간이 넘으면 이 표시가 뜹니다.
      </div>,
    );
  }
  if (S.usdGapHint) {
    out.push(
      <div className="warnbox" role="note" key="gap">
        <b>! 이 시각({hm(S.ts)}) 스냅샷은 달러 현금 약 {usd(S.usdGapHint.usd)}이 빠져 보이는 시간대입니다{inHourRange(S.ts, rules.usdGapHoursKst) ? `(${rules.usdGapHoursKst}시)` : ''}.</b> 손익이 약 {won(S.usdGapHint.krw)} 작게 보일 수 있습니다. 아침 07~09시 값과 비교하세요.
      </div>,
    );
  }
  if (c.pending.count) {
    out.push(
      <div className="infobox" role="note" key="pend">
        <span className="ic" aria-hidden="true">◌</span>
        <div><b>반영 대기 {c.pending.count}건 · {swon(c.pending.krw)}</b> — 다음 스냅샷(보통 1시간 안)에서 맞는 현금 변화가 보이면 계산에 넣습니다. <b>지금 손익에는 빠져 있습니다.</b></div>
      </div>,
    );
  }
  if (c.unmatched) {
    const u = feed.entries.find((e) => !e.void && e.kind !== 'exchange' && e.anchor.status === 'unmatched' && !e.beforeBaseline);
    out.push(
      <div className="warnbox" role="note" key="unm">
        <b>! 불일치 {c.unmatched}건</b> — 기록한 금액과 맞는 현금 변화를 스냅샷에서 찾지 못했습니다. 기록대로 계산에 넣었으니 금액·시각을 확인하세요.
        {u && <>{' '}<button type="button" className="lnk" id={SIG_IDS.unmatched} onClick={() => p.onGoEntry(u.id)}>#{u.id} 기록 보기</button></>}
      </div>,
    );
  }
  if (c.fxMissing > 0) {
    out.push(
      <div className="warnbox" role="note" key="fx">
        <b>! 환율이 없어 계산에서 뺀 달러 기록 {c.fxMissing}건</b> — 다음 스냅샷에서 다시 계산합니다
      </div>,
    );
  }
  return out.length ? <div className="sigs">{out}</div> : null;
}
