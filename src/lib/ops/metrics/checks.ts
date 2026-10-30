/**
 * T-108 홈 「확인 필요」 줄 — 서버 `checks[]` (가이드 §2.3.2 표, 순서 고정). **순수 함수.**
 *
 * 문구는 화면(`components/home/check-copy.ts`)이 kind 로 정한다 — 여기는 조건·건수·빈칸 값(params)·이동 경로만.
 * 입력이 하나라도 「모름」이면 호출자(home.ts)가 이 함수를 부르지 않고 섹션을 error 로 둔다 — 빈 목록이
 * 「지금 확인할 것 없음」으로 읽히기 때문이다(비어 있는 것과 조회 실패를 섞지 않는다).
 */
import type { ApprovalCounts } from './signal-counts';
import type { ByMarket, CheckCoverage, CheckItem, ExitLines, Market, ObserveSet, OpsStage, SafetyStateDTO } from './types';

export const MAX_ANOMALY_LINES = 3;

export interface RejectedToday {
  count: number;
  /** 가장 최근 거부 1건 */
  latest: { symbol: string; side: string; reason: string | null; market: Market } | null;
}

export interface CheckInput {
  stage: OpsStage;
  safety: SafetyStateDTO;
  killSwitchSince: string | null;
  approval: ApprovalCounts;
  rejected: RejectedToday;
  /** 오늘 안전장치(한도·관문 등 — 모든거래차단 제외)에 막힌 주문 */
  blocked: RejectedToday;
  exit: ExitLines;
  /** 오늘 청산 체결 건수(혼합 단계 #2) — 모르면 null */
  exitFillsToday: number | null;
  /** 데이터 이상 — 모든 단계에서 계산한다(실거래·혼합 단계에서도 「데이터 이상 0」이 평가된 사실이어야 한다) */
  anomalies: ObserveSet['anomalies'] | null;
  /** 시장별 「마지막 예정 장마감 분석 슬롯에 기록 없음」 — 그 슬롯 ISO */
  slotUnrecorded: ByMarket<string | null>;
}

export function buildChecks(x: CheckInput): CheckItem[] {
  const out: CheckItem[] = [];
  const eng = x.exit.engine.value;
  const engineOn = x.exit.engine.state === 'available' && eng?.enabled === true;
  const prop = x.exit.proposals.value;

  // 0. 안전 상태 일부를 못 읽음(단계 unknown) — 맨 앞. 이 줄이 있으면 화면은 「지금 확인할 것 없음」을 쓰지 않는다.
  if (x.stage === 'unknown') {
    out.push({ kind: 'safety_unknown', severity: 'e', params: { errors: x.safety.errors.join(', ') || null }, href: '/settings' });
  }
  // 1. 모든거래차단 ON
  if (x.stage === 'halt') {
    out.push({ kind: 'kill_switch_on', severity: 'e', params: { since: x.killSwitchSince, exitSignalsBlocked: prop ? prop.blockedByKill : null }, href: '/settings' });
  }
  // 2. 혼합 단계 — 청산 주문이 실제로 나간다
  if (x.stage === 'mixed' && engineOn) {
    out.push({ kind: 'exit_live_orders', severity: 'e', params: { exitFillsToday: x.exitFillsToday }, href: '/recommend?tab=log' });
  }
  // 3. 혼합 단계 — 신규 매수 차단
  if (x.stage === 'mixed') {
    const s = x.safety.strategies;
    out.push({ kind: 'buy_blocked', severity: 'w', params: { validatedEnabled: s?.validatedEnabled ?? null, total: s?.total ?? null }, href: '/recommend?tab=now' });
  }
  // 4. 승인 대기 (모든 단계)
  const approvalTotal = x.approval.approval.domestic + x.approval.approval.overseas;
  if (approvalTotal >= 1) {
    out.push({
      kind: 'awaiting_approval', severity: 'w', count: approvalTotal,
      params: {
        domestic: x.approval.approval.domestic, overseas: x.approval.approval.overseas,
        earliestSymbol: x.approval.earliestExpiry?.symbol ?? null, earliestAt: x.approval.earliestExpiry?.at ?? null,
      },
      href: '/recommend?tab=now',
    });
  }
  // 5. 오늘 주문 거부
  if (x.rejected.count >= 1) {
    const l = x.rejected.latest;
    out.push({
      kind: 'order_rejected', severity: 'e', count: x.rejected.count, market: l?.market,
      params: { symbol: l?.symbol ?? null, side: l?.side ?? null, reason: l?.reason ?? null, market: l?.market ?? null },
      href: '/recommend?tab=log',
    });
  }
  // 5b. 오늘 안전장치에 막힌 주문(한도·관문 등). 모든거래차단 차단은 #1 이 말하므로 뺀다.
  if (x.blocked.count >= 1) {
    const l = x.blocked.latest;
    out.push({
      kind: 'order_blocked', severity: 'w', count: x.blocked.count, market: l?.market,
      params: { symbol: l?.symbol ?? null, side: l?.side ?? null, reason: l?.reason ?? null, market: l?.market ?? null },
      href: '/recommend?tab=log',
    });
  }
  // 6. 손실한도 손절 OFF ∧ 오늘 한도 도달 종목
  if (engineOn && eng?.hardStopEnabled === false) {
    let symbols = 0; let days = 0; let capped = false;
    for (const m of ['domestic', 'overseas'] as const) {
      const j = x.exit.judgments[m];
      if (j.value && (j.state === 'available' || j.state === 'zero' || j.state === 'partial')) {
        symbols += j.value.hardStopOffHit;
        if (j.value.hardStopOffHit > 0 && j.value.hardStopOffDays > days) { days = j.value.hardStopOffDays; capped = j.value.hardStopOffDaysCapped; }
      }
    }
    if (symbols >= 1) out.push({ kind: 'hard_stop_off_hit', severity: 'w', count: symbols, params: { symbols, days, daysCapped: capped ? 1 : 0 }, href: '/analytics?tab=verify' });
  }
  // 7. 관찰·중지 단계 — 오늘 가상 청산
  if ((x.stage === 'observe' || x.stage === 'halt') && prop && prop.virtual >= 1) {
    out.push({
      kind: 'virtual_exit', severity: 'i', count: prop.virtual,
      params: { at: prop.firstAt, exitKind: prop.firstKind, notifyAutoSubmit: x.safety.notifyAutoSubmit == null ? null : x.safety.notifyAutoSubmit ? 1 : 0 },
      href: '/recommend?tab=log',
    });
  }
  // 8. 데이터 이상 — 1건마다 1줄, 최대 3줄. 넘치면 마지막 줄 params.more = 잘린 수
  const items = x.anomalies?.value?.items ?? [];
  const shown = items.slice(0, MAX_ANOMALY_LINES);
  shown.forEach((it, i) => {
    const more = i === shown.length - 1 && items.length > MAX_ANOMALY_LINES ? items.length - MAX_ANOMALY_LINES : null;
    out.push({
      kind: 'data_anomaly', severity: 'w', market: it.market === 'domestic' || it.market === 'overseas' ? it.market : undefined,
      params: { source: it.source, label: it.label, state: it.state, streak: it.streak ?? null, jobId: it.jobId ?? null, jobStatus: it.jobStatus ?? null, more },
      href: '/analytics?tab=data',
    });
  });
  // 9. 분석 실행 기록 없음(시장별)
  for (const m of ['domestic', 'overseas'] as const) {
    const slot = x.slotUnrecorded[m];
    if (slot) out.push({ kind: 'analysis_unknown', severity: 'n', market: m, params: { market: m, slotAt: slot }, href: '/analytics?tab=data' });
  }
  return out;
}

/** 빈 상태 문장의 근거 — 항목별로 실제 평가했는가(가이드 §2.3.2 0건 문구가 사실일 조건). 순수. */
export function checkCoverage(x: CheckInput): CheckCoverage {
  const eng = x.exit.engine;
  const engineOn = eng.state === 'available' && eng.value?.enabled === true;
  const judged = (['domestic', 'overseas'] as const).some((m) => {
    const st = x.exit.judgments[m].state;
    return st === 'zero' || st === 'available' || st === 'partial';
  });
  const a = x.anomalies;
  return {
    approval: true,
    orders: true,
    anomalies: !!a && (a.state === 'zero' || a.state === 'available'),
    exitConditions: engineOn && judged,
    safety: x.stage !== 'unknown',
  };
}
