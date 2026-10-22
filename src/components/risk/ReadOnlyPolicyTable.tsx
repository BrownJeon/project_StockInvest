import type { ReactNode } from 'react';
import type { RiskComputed } from '@/lib/risk/compute';
import type { PolicySource, RiskExecutionLimits, RiskPolicyReadOnly, RiskPolicySources } from '@/lib/risk/defaults';
import { SourceBadge } from './SourceBadge';
import { StatusText } from './StatusText';
import { shortSymbol, won } from './fmt';

function Row({ name, source, value, cur }: { name: string; source: PolicySource; value: ReactNode; cur: ReactNode }) {
  return (
    <tr>
      <th scope="row"><div className="name">{name}</div><SourceBadge source={source} /></th>
      <td className="v num">{value}</td>
      <td className="cur">{cur}</td>
    </tr>
  );
}

function Grp({ t }: { t: string }) {
  return <tr className="grp"><th colSpan={3} scope="colgroup">{t}</th></tr>;
}

const na = (t: string) => <StatusText kind="na" icon="—">{t}</StatusText>;

/**
 * 분할 매수 행 '현재 상태' — 실제로 집행 중인 제한 2가지 + 아직 없는 것 1줄 (데모 T-068 v5 `execHtml`).
 * 초록 '● 집행 중' 배지는 쓰지 않는다(안전장치 카드 전용 표식). 각 값이 정책값과 다르면 그 줄만 '! … 정책과 다름'.
 */
export function ExecutionLimits({ policyMax, exec }: { policyMax: number; exec: RiskExecutionLimits }) {
  const cap = exec.scenarioSplitCap;
  const dom = exec.domesticMaxBuysPerSymbol24h;
  const differs = `정책(${policyMax}회)과 다름`;
  return (
    <div className="exl">
      <small>집행 중인 제한</small>
      <div>
        {cap === policyMax
          ? <StatusText kind="info" icon="ⓘ">확정 1회당 조각 최대 {cap}개</StatusText>
          : <StatusText kind="warn" icon="!">확정 1회당 조각 최대 {cap}개 — {differs}</StatusText>}
        <small>시나리오 확정 요청마다 서버가 검사 · 시장 무관</small>
      </div>
      <div>
        {dom === null
          ? <><StatusText kind="na" icon="—">국내 자동 매수 한도 확인 불가</StatusText><small>엔진 설정을 읽지 못했습니다</small></>
          : <>
              {dom === policyMax
                ? <StatusText kind="info" icon="ⓘ">국내 자동 매수 같은 종목 24시간 내 {dom}건</StatusText>
                : <StatusText kind="warn" icon="!">국내 자동 매수 같은 종목 24시간 내 {dom}건 — {differs}</StatusText>}
              <small>국내 룰 엔진만 · 체결·접수된 매수 주문 수</small>
            </>}
      </div>
      <small>여러 번에 나눠 확정하는 누적 횟수는 아직 제한이 없습니다(후속 결정).</small>
    </div>
  );
}

/** 그 밖의 정책 (읽기 전용) — 데모 v3 `roHtml` + T-068 v5(현금 비중 정보 표시 · 분할 최대 4회 + 집행 중인 제한) */
export function ReadOnlyPolicyTable({ c, ro, sources, exec }: {
  c: RiskComputed;
  ro: RiskPolicyReadOnly;
  sources: RiskPolicySources;
  exec: RiskExecutionLimits;
}) {
  const t = c.totalKrw;
  const known = t > 0;
  const amt = (pct: number) => (known ? `≈${won(t * Math.abs(pct) / 100)}` : '총자산 미확인');
  const comp = c.composition;
  const prio = ro.marketPriority.map(m => (m === 'overseas' ? '미국' : '국내')).join(' → ');

  return (
    <>
      <table className="pol">
        <caption>
          그 밖의 정책 (읽기 전용)
          <small>{known ? `기준 총자산 ${won(t)}(스냅샷)으로 환산` : '총자산을 몰라 금액 환산 없음'}</small>
        </caption>
        <colgroup><col className="c-name" /><col className="c-val" /><col className="c-cur" /></colgroup>
        <thead><tr><th scope="col">항목 · 출처</th><th scope="col">정책값</th><th scope="col">현재 상태</th></tr></thead>
        <tbody>
          <Grp t="손실 한도" />
          <Row name="거래당 리스크" source={sources.tradeRiskPct}
            value={<>총자산의 {ro.tradeRiskPct}%<small>{amt(ro.tradeRiskPct)} · 손절폭으로 매수 금액 산출</small></>}
            cur={na('신규 진입 때 적용')} />
          <Row name="주간 손실 한도" source={sources.weeklyLossPct}
            value={<>{ro.weeklyLossPct}%<small>{amt(ro.weeklyLossPct)}</small></>}
            cur={na('주간 기준선 미산출')} />
          <Row name="월간 / 연간 손실 한도" source={sources.monthlyLossPct}
            value={<>{ro.monthlyLossPct}% / {ro.annualLossPct}%<small>{known ? `≈${won(t * Math.abs(ro.monthlyLossPct) / 100)} / ${won(t * Math.abs(ro.annualLossPct) / 100)}` : '총자산 미확인'}</small></>}
            cur={na('미산출')} />
          <Grp t="포지션 구성" />
          <Row name="보유 종목 최대 수" source={sources.maxHoldings}
            value={<>{ro.maxHoldings}종목</>}
            cur={comp.holdingsCount > ro.maxHoldings
              ? <StatusText kind="warn" icon="!">초과 — {comp.holdingsCount}종목</StatusText>
              : <><StatusText kind="ok" icon="✓">{comp.holdingsCount}종목</StatusText><small>{ro.maxHoldings - comp.holdingsCount}개 더 가능</small></>} />
          <Row name="심볼당 최대 비중" source={sources.symbolMaxPct}
            value={<>{ro.symbolMaxPct}%<small>문서 정책은 30%</small></>}
            cur={comp.topPct === null || !comp.topSymbol ? na('미산출')
              : comp.topPct > ro.symbolMaxPct
                ? <StatusText kind="warn" icon="!">초과 — {shortSymbol(comp.topSymbol)} {comp.topPct.toFixed(1)}%</StatusText>
                : <StatusText kind="ok" icon="✓">최대 {comp.topPct.toFixed(1)}%</StatusText>} />
          {/* T-068 — 현금은 규칙이 아니라 정보: 경고 기호·'미달'·초록 ✓ 없이 중립 숫자만 */}
          <Row name="현금 비중 (정보 표시, 하한 없음)" source={sources.cashFloorPct}
            value={<>하한 없음<small>규칙 아님 · 표시만</small></>}
            cur={comp.cashPct === null ? na('미산출')
              : <><span className="num" style={{ fontWeight: 700 }}>{comp.cashPct.toFixed(1)}%</span><small>총자산 대비 현금</small></>} />
          <Row name="분할 매수" source={sources.splitBuy}
            value={<>최대 {ro.splitBuy.max}회<small>비율 고정 없음 · 구간·수량은 시나리오에서 정함</small></>}
            cur={<ExecutionLimits policyMax={ro.splitBuy.max} exec={exec} />} />
          <Grp t="시장" />
          <Row name="시장 우선순위" source={sources.marketPriority}
            value={<>{prio}</>}
            cur={comp.overseasPct === null ? na('보유 없음')
              : <><StatusText kind="info" icon="ⓘ">미국 {comp.overseasPct.toFixed(0)}% · 국내 {(100 - comp.overseasPct).toFixed(0)}%</StatusText><small>주식 평가액 기준</small></>} />
        </tbody>
      </table>
      <p className="ro-foot">
        <b>위 정책 값은 읽기 전용입니다. 변경은 사용자 승인 후 반영됩니다.</b> 이 화면에서 바꿀 수 있는 것은 손절 설정 3개뿐입니다.
      </p>
    </>
  );
}
