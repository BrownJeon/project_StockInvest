import type { ReactNode } from 'react';
import type { RiskComputed } from '@/lib/risk/compute';
import type { RiskPolicyEditable } from '@/lib/risk/defaults';
import { StatusText } from './StatusText';
import { p2, pv, shortSymbol, won } from './fmt';

export type PreviewTag = 'saving' | 'draft' | 'saved';

/** 이미 손절가 아래인 종목 경고 (데모 v3 `belowHtml`) */
export function BelowBox({ c }: { c: RiskComputed }) {
  if (c.belowCount === 0) return null;
  return (
    <div className="warnbox" role="note">
      <b>
        ! 이미 손절가 아래 {c.belowCount}종목 · 평가손 합계 {won(c.belowLossKrw)}
        {c.belowLossPct !== null ? ` (총자산의 ${p2(-c.belowLossPct)})` : ''}
      </b>
      <br />
      {c.belowSymbols.map(shortSymbol).join(' · ')} — 현재가가 예상 손절가보다 낮습니다. 실제 손실이 이미 손절 기준보다 큽니다.{' '}
      <b>자동 매도는 없습니다 — 직접 판단하세요.</b>
    </div>
  );
}

/** 손절 합 결과 (데모 v3 `resHtml`) */
export function RiskResult({ c, eff, tag, usedFallback }: {
  c: RiskComputed;
  eff: RiskPolicyEditable;
  tag: PreviewTag;
  usedFallback: boolean;
}) {
  const tagEl = tag === 'saving'
    ? <span className="pv">◌ 저장 중 — 서버 확인 전</span>
    : tag === 'draft'
      ? <span className="pv">◌ 저장 전 값 기준 미리보기</span>
      : <span className="pv saved">저장된 값 기준</span>;
  const known = c.heatPct !== null;
  const usage = c.usagePct ?? 0;
  const w = Math.min(usage, 100);
  const badge = !known
    ? <StatusText kind="na" icon="—">총자산을 몰라 비율 계산 불가</StatusText>
    : c.over
      ? <StatusText kind="warn" icon="!">한도 초과</StatusText>
      : <StatusText kind="ok" icon="✓">한도 이내</StatusText>;

  let inv: ReactNode;
  if (c.maxStopPct === null) {
    inv = <>{c.rows.length === 0 ? '보유 종목이 없어 손절 합이 0입니다.' : '역산할 수 있는 종목·총자산이 없습니다.'}</>;
  } else if (eff.stopBasis === 'avg') {
    inv = (
      <>
        한도 {pv(eff.heatCapPct)}%를 지키려면 <b>손절폭 ≤ {c.maxStopPct.toFixed(2)}%</b>
        <br />
        <span className="eq">= 한도 {pv(eff.heatCapPct)}% × 총자산 {won(c.totalKrw)} ÷ 취득원가 합 {won(c.costKrw)}</span>
      </>
    );
  } else if (c.maxStopPct >= 20) {
    inv = <>손절폭 20%까지 한도 {pv(eff.heatCapPct)}% 이내입니다(고점 기준).</>;
  } else {
    inv = <>한도 {pv(eff.heatCapPct)}%를 지키려면 <b>손절폭 ≤ {c.maxStopPct.toFixed(2)}%</b> (고점 기준, 수치 계산)</>;
  }
  const excluded = c.rows.length - c.computableCount;

  return (
    <div className="res">
      <div className="head">
        <h4 className="subh">손절 합 — 모든 종목이 예상 손절가에 닿을 때 손실 합</h4>
        {tagEl}
      </div>
      <div aria-live="polite">
        <span className="big num">{known ? p2(c.heatPct as number) : '—'}</span>{' '}
        <span className="num">(≈{won(c.heatKrw)})</span> {badge}
      </div>
      <div className="bar" aria-hidden="true">
        <span className={`fill ${c.over ? 'warnc' : 'okc'}`} style={{ width: `${w}%` }} />
      </div>
      <div className="bar-scale" aria-hidden="true">
        <span>0</span>
        <span>한도 {pv(eff.heatCapPct)}% · {won(c.capKrw)}</span>
      </div>
      <p>
        한도 사용률 <b className="num">{c.usagePct !== null ? `${c.usagePct.toFixed(0)}%` : '—'}</b>
        {known && (c.over
          ? <> · 초과 <b className="num">{won(c.heatKrw - c.capKrw)}</b></>
          : <> · 여유 <b className="num">{won(c.capKrw - c.heatKrw)}</b></>)}
      </p>
      {c.over
        ? <div className="inv"><StatusText kind="warn" icon="!">지금 보유 규모로는 한도를 넘습니다</StatusText><br />{inv}</div>
        : <div className="inv">{inv}</div>}
      {c.partial && (
        <p>
          <StatusText kind="na" icon="—">
            일부 계산 불가 — {excluded}종목은 평균단가·고점·현재가가 없어 손절 합 또는 거리에서 빠졌습니다
          </StatusText>
        </p>
      )}
      {usedFallback && (
        <p><StatusText kind="warn" icon="!">잘못된 입력값은 계산에 쓰지 않고 저장된 값으로 계산했습니다</StatusText></p>
      )}
    </div>
  );
}
