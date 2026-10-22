import type { RiskComputed } from '@/lib/risk/compute';
import type { RiskPolicyEditable } from '@/lib/risk/defaults';
// 알림 규칙 숫자와 말풍선 문구는 알림 cron 이 실제로 쓰는 순수 모듈에서 얻는다(화면에 문구를 복제하지 않는다).
// stop-alert.ts 는 compute·defaults 만 import 하는 순수 모듈 — DB·fetch·notify·exchanges 없음(isolation.test.ts 가 단언).
import {
  STOP_ALERT_RULES, emptyStopAlertState, formatStopAlert, planStopAlerts, symbolKey,
  type StopAlertHoldingInput, type StopAlertPolicy,
} from '@/lib/risk/stop-alert';
import { pv } from './fmt';

/**
 * T-068 — 손절가 도달 알림 안내 + 텔레그램 메시지 미리보기 (승인 데모 v5 `alertHtml` 의 모양·배치·접근성).
 *
 * **정적 안내**다(데모 결정 D3 = A 안): 알림 켜짐·꺼짐 상태를 읽거나 보이지 않고, 토글도 없다.
 * 실제 발송은 cron `stop-alert` 가 한다.
 *
 * 말풍선 텍스트는 Leader 결정(10-22)으로 **실제 발송 문구**다 — 아래 합성 입력을 실제 판정(`planStopAlerts`)과
 * 포맷(`formatStopAlert`)에 넣어 나온 제목·본문을 그대로 보인다(데모 v5 의 예시 문구는 WP-C 문구 전에 쓴 것이라 대체).
 * 입력은 **합성값 고정**(가상 종목 AAA·BBB·CCC, 합성 금액, 환율 1,250) — 실제 보유 종목명·금액은 쓰지 않는다.
 * 지금 입력한 손절폭·기준가만 반영해 손절가가 다시 계산된다.
 */
// 가격 필드 이름은 일부러 `pxUsd` — 합성 표시 입력이라 실제 USD 원가 필드 이름을 쓰지 않아 통화 경계 시험(currency-mixing-fence)의
// 'USD 원가 독자' 목록에서 의도적으로 제외한다(실제 USD 원가를 읽는 지점이 아님, T-068 Reviewer 검토). 그 이름으로 바꾸면 새 지점으로 잡힌다.
export const STOP_ALERT_EXAMPLE = Object.freeze({
  /** 판정 시각(합성, 고정) — 쿨다운·일일 건수 판정에만 쓰이고 문구에는 나오지 않는다 */
  now: '2026-10-22T01:31:00.000Z',
  fx: 1250,
  /** 도달 알림 예시 — 손절가 위(직전 상태 above)였다가 현재가 = 예상 손절가 − $0.10 */
  cross: { symbol: 'NAS:AAA', label: '가상종목A (AAA)', qty: 80, avgUsd: 132, peakUsd: 140 },
  /** 처음 요약 예시 — 상태 없는 미국 2종목이 이미 손절가 아래 (손절폭 최대 20% 에서도 아래인 가격) */
  summary: [
    { symbol: 'NAS:BBB', label: '가상종목B (BBB)', qty: 20, avgUsd: 60, peakUsd: 62, pxUsd: 45 },
    { symbol: 'NAS:CCC', label: '가상종목C (CCC)', qty: 30, avgUsd: 50, peakUsd: 52, pxUsd: 36 },
  ],
});

export interface StopAlertMessage { title: string; body: string }

const cents = (n: number) => Math.round(n * 100) / 100;

/** 합성 입력으로 실제 판정·포맷을 돌려 말풍선 2개의 제목·본문을 만든다 (순수, 시험이 같은 함수를 직접 호출해 대조) */
export function stopAlertExamples(eff: RiskPolicyEditable): { cross: StopAlertMessage | null; summary: StopAlertMessage | null } {
  const E = STOP_ALERT_EXAMPLE;
  const now = new Date(E.now);
  const policy: StopAlertPolicy = { stopPct: eff.stopPct, heatCapPct: eff.heatCapPct, stopBasis: eff.stopBasis, version: 1 };
  const overseas = (symbol: string, qty: number, avgUsd: number, peakUsd: number, pxUsd: number): StopAlertHoldingInput => ({
    symbol, market: 'overseas', qty, avgKrw: avgUsd * E.fx, peakKrw: peakUsd * E.fx, priceKrw: pxUsd * E.fx, fx: E.fx,
  });
  const labels: Record<string, string> = {};
  for (const x of [E.cross, ...E.summary]) labels[symbolKey('overseas', x.symbol)] = x.label;

  // 도달 알림: 직전 평가에서 손절가 위였던 AAA 가 이번 틱에 손절가 − $0.10
  const c = E.cross;
  const refUsd = eff.stopBasis === 'avg' ? c.avgUsd : c.peakUsd;
  const pxUsd = cents(refUsd * (1 - eff.stopPct / 100)) - 0.1;
  const prev = emptyStopAlertState(now);
  prev.policyVersion = policy.version;
  prev.symbols[symbolKey('overseas', c.symbol)] = {
    state: 'above', since: new Date(now.getTime() - 3_600_000).toISOString(), lastAlertAt: null, rearm: 0, pv: policy.version,
  };
  const crossPlan = planStopAlerts({ now, policy, prev, holdings: [overseas(c.symbol, c.qty, c.avgUsd, c.peakUsd, pxUsd)] });
  const crossAlert = crossPlan.alerts.find(a => a.kind === 'cross');

  // 처음 요약: 상태 없음(평가를 처음 시작) + 이미 손절가 아래 2종목
  const sumPlan = planStopAlerts({
    now, policy, prev: null,
    holdings: E.summary.map(s => overseas(s.symbol, s.qty, s.avgUsd, s.peakUsd, s.pxUsd)),
  });
  const sumAlert = sumPlan.alerts.find(a => a.kind === 'summary');

  return {
    cross: crossAlert ? formatStopAlert(crossAlert, labels) : null,
    summary: sumAlert ? formatStopAlert(sumAlert, labels) : null,
  };
}

/** 말풍선 — 제목 + 본문 줄 그대로. 본문의 빈 줄 뒤(안내·주의 문구)는 데모처럼 굵은 `.foot` 으로 */
function Bubble({ msg, label, time }: { msg: StopAlertMessage; label: string; time: string }) {
  const lines = msg.body.split('\n');
  const cut = lines.indexOf('');
  const main = cut >= 0 ? lines.slice(0, cut) : lines;
  const foot = cut >= 0 ? lines.slice(cut + 1).filter(l => l !== '') : [];
  return (
    <div className="bubble" role="img" aria-label={label}>
      <div className="bt">{msg.title}</div>
      {main.map((l, i) => <div key={i} className="ln">{l}</div>)}
      {foot.length > 0 && <div className="foot">{foot.map((l, i) => <div key={i}>{l}</div>)}</div>}
      <span className="tm">{time}</span>
    </div>
  );
}

export function StopAlertNotice({ c, eff }: { c: RiskComputed; eff: RiskPolicyEditable }) {
  const belowRows = c.rows.filter(r => r.below);
  const bu = belowRows.filter(r => r.market === 'overseas').length;
  const bk = belowRows.length - bu;
  const summaries = (bu ? 1 : 0) + (bk ? 1 : 0);
  const ex = stopAlertExamples(eff);

  return (
    <section className="alertbox" aria-labelledby="rp-al-t">
      <h4><span id="rp-al-t">🔔 손절가 도달 알림 — 텔레그램</span><span className="mode disp">주문·매도 없음</span></h4>
      <ul>
        <li>보유 종목 현재가가 <b>예상 손절가에 닿거나 아래로</b> 내려가면 텔레그램으로 알립니다(장이 열린 시장만, 약 1분마다 확인).</li>
        <li>평가를 처음 시작할 때 이미 손절가 아래에 있는 보유 종목은 <b>시장별로 요약 1건</b>만 알리고, 그 뒤에는 손절가 위로 올라갔다가 다시 내려올 때 종목별로 알립니다.</li>
        <li>같은 종목은 <b>{STOP_ALERT_RULES.cooldownMin}분 안에 다시 알리지 않습니다</b> · 하루 최대 <b>{STOP_ALERT_RULES.dailyMax}건</b>.</li>
        <li>손절 설정을 저장한 직후 첫 확인은 알림 없이 기준만 새로 맞춥니다.</li>
      </ul>
      <div className="now" aria-live="polite">
        {belowRows.length
          ? <>현재 입력 기준 예상: 손절가 아래 <b className="num">{belowRows.length}</b>종목(미국 {bu} · 국내 {bk}). 평가를 처음 시작할 때 이런 종목은 종목별이 아니라 <b>시장별 요약 {summaries}건</b>으로 알립니다.</>
          : <>현재 입력 기준 예상: 손절가 아래 종목은 없습니다. 손절가에 처음 닿는 종목부터 1건씩 알립니다.</>}
      </div>
      <div className="tgprev">
        <span className="cap">메시지 예시 — AAA 가 손절가 위에 있다가 막 닿은 경우 (합성값 · 지금 입력한 손절폭 {pv(eff.stopPct)}% 기준)</span>
        {ex.cross && <Bubble msg={ex.cross} label="텔레그램 손절가 도달 알림 예시" time="10:31" />}
        {ex.summary && <Bubble msg={ex.summary} label="텔레그램 첫 평가 요약 알림 예시" time="09:31" />}
      </div>
    </section>
  );
}
