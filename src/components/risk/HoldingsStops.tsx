import type { HoldingRow, RiskComputed } from '@/lib/risk/compute';
import type { RiskPolicyEditable } from '@/lib/risk/defaults';
import { StatusText } from './StatusText';
import { basisLabel } from './draft';
import { price, pv, shortSymbol, sp, swon } from './fmt';

const REASON: Record<string, string> = {
  no_avg: '평균단가 없음',
  no_peak: '고점 기록 없음',
  no_price: '현재가 없음',
};

function qtyText(q: number): string {
  return Number.isInteger(q) ? String(q) : String(Math.round(q * 10000) / 10000);
}

function RowStatus({ r }: { r: HoldingRow }) {
  if (r.stopKrw === null) return <StatusText kind="na" icon="—">계산 불가</StatusText>;
  if (r.priceKrw === null) return <StatusText kind="na" icon="—">현재가 없음</StatusText>;
  if (r.below) return <StatusText kind="warn" icon="!">이미 손절가 아래</StatusText>;
  if (r.near) return <StatusText kind="warn" icon="!">손절가 근접</StatusText>;
  return <StatusText kind="ok" icon="✓">손절가 위</StatusText>;
}

/** 보유 종목 예상 손절가 — 모바일 3열 dl 목록 + 900px 이상 표 (데모 v3 `holdHtml`) */
export function HoldingsStops({ c, eff, fx }: { c: RiskComputed; eff: RiskPolicyEditable; fx: number | null }) {
  const refLbl = basisLabel(eff.stopBasis);
  const formula = `${refLbl} × (1 − ${pv(eff.stopPct)}%) · 실시간 계산 · 읽기 전용`;
  const px = (r: HoldingRow, v: number | null) => (v === null ? '—' : price(r.market, v, fx));
  const mk = (r: HoldingRow) => `${r.market === 'overseas' ? '미국' : '국내'} · ${qtyText(r.qty)}주`;
  const why = (r: HoldingRow) => (r.reason ? REASON[r.reason] : '');

  if (c.rows.length === 0) {
    return (
      <div>
        <h4 className="subh" style={{ marginBottom: 8 }}>보유 종목 예상 손절가<small>{formula}</small></h4>
        <div className="infobox" role="note"><span className="ic" aria-hidden="true">ⓘ</span><div>보유 종목이 없습니다.</div></div>
      </div>
    );
  }

  const dist = (r: HoldingRow, short: boolean) => {
    if (r.below && r.underPct !== null) return <>이미 아래<small>손절가보다 {r.underPct.toFixed(1)}% 낮음</small></>;
    if (r.distPct !== null) return <>-{r.distPct.toFixed(1)}%<small>{short ? '남은 폭' : '현재가에서 남은 폭'}</small></>;
    return <>—{why(r) && <small>{why(r)}</small>}</>;
  };
  const pnlStop = (r: HoldingRow) =>
    r.pnlAtStopKrw === null ? <>—{why(r) && <small>{why(r)}</small>}</> : <>{swon(r.pnlAtStopKrw)}<small>{sp(r.pnlAtStopPct as number)}</small></>;

  const list = (
    <div className="only-m">
      <h4 className="subh" style={{ marginBottom: 8 }}>보유 종목 예상 손절가<small>{formula}</small></h4>
      <div className="hlist">
        {c.rows.map(r => (
          <div key={`${r.market}:${r.symbol}`} className={`hrow${r.below ? ' below' : ''}`}>
            <div className="t">
              <div><b>{shortSymbol(r.symbol)}</b><span className="mk">{mk(r)}</span></div>
              <RowStatus r={r} />
            </div>
            <dl>
              <div><dt>예상 손절가</dt><dd>{px(r, r.stopKrw)}{r.stopKrw === null && why(r) && <small>{why(r)}</small>}</dd></div>
              <div><dt>현재가</dt><dd>{px(r, r.priceKrw)}</dd></div>
              <div><dt>손절가까지</dt><dd>{dist(r, false)}</dd></div>
              <div><dt>{refLbl}</dt><dd>{px(r, r.refKrw)}</dd></div>
              <div><dt>손절 시 손익</dt><dd>{pnlStop(r)}</dd></div>
              <div><dt>지금 평가손익</dt><dd>{r.unrealKrw === null ? '—' : <>{swon(r.unrealKrw)}<small>{sp(r.unrealPct as number)}</small></>}</dd></div>
            </dl>
            {r.below && (
              <div className="why"><StatusText kind="warn" icon="!">현재가가 예상 손절가보다 낮습니다 — 자동 매도 없음, 직접 판단</StatusText></div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  const table = (
    <div className="only-d">
      <table className="hold">
        <caption>보유 종목 예상 손절가 — {formula}</caption>
        <thead>
          <tr>
            <th scope="col" className="l">종목</th><th scope="col">{refLbl}</th><th scope="col">예상 손절가</th>
            <th scope="col">현재가</th><th scope="col">손절가까지</th><th scope="col">손절 시 손익</th><th scope="col" className="l">상태</th>
          </tr>
        </thead>
        <tbody>
          {c.rows.map(r => (
            <tr key={`${r.market}:${r.symbol}`} className={r.below ? 'below' : undefined}>
              <td><b>{shortSymbol(r.symbol)}</b><small>{mk(r)}</small></td>
              <td>{px(r, r.refKrw)}</td>
              <td><b>{px(r, r.stopKrw)}</b></td>
              <td>{px(r, r.priceKrw)}</td>
              <td>{dist(r, true)}</td>
              <td>{pnlStop(r)}</td>
              <td className="l">
                <RowStatus r={r} />
                {r.below && <small>평가손익 {sp(r.unrealPct as number)} · 자동 매도 없음</small>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return <div>{list}{table}</div>;
}
