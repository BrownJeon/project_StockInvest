/**
 * T-108 B-2 홈 화면 시험용 합성 DTO — 데모 v3 의 합성 하루(가정 시각 2026-10-30(목) 16:20 KST)와 같은 숫자.
 * 단계 4종(observe·halt·mixed·live) × 데이터 모드(ok·first·empty). 로딩·조회 실패·오래됨은 PollState 로 만든다.
 * 시험 파일이 아니다(이름이 *.test.ts 가 아님) — home-render-t108.test.ts 가 import 한다.
 */
import type {
  ActivityItem, AnalysisRunRow, ByMarket, CheckItem, ExitLines, HomeDTO, LiveSet, Market, Metric, MetricState, ObserveSet,
  OpsStage, SafetyStateDTO,
} from '@/lib/ops/metrics/types';

export const T = '2026-10-30T16:20:00+09:00';
export const NOW = Date.parse(T);
export type Stage4 = Exclude<OpsStage, 'unknown'>;
export type Mode = 'ok' | 'first' | 'empty';

export const M = <V,>(state: MetricState, value: V | null, reason?: string): Metric<V> => ({ state, value, asOf: T, ...(reason ? { reason } : {}) });
const av = <V,>(v: V) => M<V>('available', v);
const z = () => M<number>('zero', 0);
const unk = <V,>() => M<V>('unknown', null);
const prep = <V,>(reason = 'record_off') => M<V>('prep', null, reason);
const by = <V,>(d: V, o: V): ByMarket<V> => ({ domestic: d, overseas: o });

export function safety(stage: Stage4 | 'unknown'): SafetyStateDTO {
  const base: SafetyStateDTO = {
    readAt: '2026-10-30T16:19:40+09:00', stage,
    liveTrading: false, killSwitch: false,
    exitEngine: { enabled: true, hardStopEnabled: false, source: 'config' },
    strategies: { total: 16, enabled: 8, validated: 0, validatedEnabled: 0 },
    notifyAutoSubmit: false, errors: [],
  };
  switch (stage) {
    case 'halt': return { ...base, killSwitch: true };
    case 'mixed': return { ...base, liveTrading: true, exitEngine: { enabled: true, hardStopEnabled: true, source: 'config' } };
    case 'live': return { ...base, liveTrading: true, exitEngine: { enabled: true, hardStopEnabled: true, source: 'config' }, strategies: { total: 16, enabled: 8, validated: 2, validatedEnabled: 2 } };
    case 'unknown': return { ...base, liveTrading: null, killSwitch: null, exitEngine: null, strategies: null, notifyAutoSubmit: null, errors: ['db_unreachable'] };
    default: return base;
  }
}

function run(m: Market, mode: Mode, live: boolean): AnalysisRunRow {
  const dom = m === 'domestic';
  const session = dom ? { market: m, sessionDate: '2026-10-30', tz: 'KST' as const } : { market: m, sessionDate: '2026-10-29', tz: 'ET' as const };
  const runStartedAt = dom ? '2026-10-30T16:00:00+09:00' : '2026-10-30T08:00:00+09:00';
  const nextRunAt = dom ? '2026-10-31T16:00:00+09:00' : '2026-10-31T08:00:00+09:00';
  if (mode === 'first') {
    return {
      session, runStartedAt: null, runStatus: null, skipReason: null, failReason: null,
      evaluated: unk(), ruleCandidates: unk(), aiBuy: prep(),
      signalsCreated: M('partial', 1, 'no_candidate_counts'), signalsBlocked: live ? z() : av(1), signalsPending: live ? (dom ? av(1) : z()) : z(),
      topExclusion: prep(), nextRunAt,
    };
  }
  if (mode === 'empty') {
    return {
      session, runStartedAt, runStatus: 'ok', skipReason: null, failReason: null,
      evaluated: av(dom ? 44 : 51), ruleCandidates: z(), aiBuy: z(), signalsCreated: z(), signalsBlocked: z(), signalsPending: z(),
      topExclusion: M('zero', null), nextRunAt,
    };
  }
  return {
    session, runStartedAt, runStatus: 'ok', skipReason: null, failReason: null,
    evaluated: av(dom ? 44 : 51), ruleCandidates: av(dom ? 5 : 3), aiBuy: av(1), signalsCreated: av(1),
    signalsBlocked: live ? z() : av(1), signalsPending: live ? (dom ? av(1) : z()) : z(),
    topExclusion: av(dom ? { code: 'low_conf', label: '신뢰도 60 미만', count: 3 } : { code: 'no_zone', label: '진입 구간 없음', count: 2 }),
    nextRunAt,
  };
}

export function analysis(mode: Mode, live = false): ByMarket<AnalysisRunRow> {
  return by(run('domestic', mode, live), run('overseas', mode, live));
}

export function observeSet(mode: Mode): ObserveSet {
  const a = analysis(mode);
  if (mode === 'empty') {
    return {
      analysis: a,
      postmortem: M('zero', { total: 0, done: 0, tracking: 0, cardsOnly: false, lastBarDate: by('2026-10-30', '2026-10-29') }),
      anomalies: M('zero', { total: 0, sourcesChecked: 6, items: [], analysisFailureKnown: true }),
    };
  }
  return {
    analysis: a,
    postmortem: M('partial', { total: 8, done: 2, tracking: 6, cardsOnly: mode === 'first', lastBarDate: by('2026-10-30', '2026-10-29') }),
    anomalies: av({
      total: 1, sourcesChecked: mode === 'first' ? 4 : 6,
      items: [{ source: 'news_domestic', state: 'partial', label: '뉴스 국내', streak: 2 }],
      analysisFailureKnown: mode !== 'first',
    }),
  };
}

export function liveSet(mode: Mode, mixed: boolean): LiveSet {
  const sess = (m: Market) => (m === 'domestic' ? { market: m, sessionDate: '2026-10-30', tz: 'KST' as const } : { market: m, sessionDate: '2026-10-29', tz: 'ET' as const });
  const empty = mode === 'empty';
  return {
    watch: empty
      ? by(M('zero', { watching: 0, executing: 0, nextSession: 0 }), M('zero', { watching: 0, executing: 0, nextSession: 0 }))
      : by(av({ watching: 1, executing: 0, nextSession: 0 }), av({ watching: 0, executing: 1, nextSession: 0 })),
    positions: (empty || mixed)
      ? av({ autoCount: 0, autoValueKrw: null, accountCount: 6, snapshotAt: '2026-10-30T16:15:00+09:00' })
      : av({ autoCount: 2, autoValueKrw: 1240000, accountCount: 6, snapshotAt: '2026-10-30T16:15:00+09:00' }),
    fillsToday: empty
      ? by(M('zero', { fills: 0, session: sess('domestic'), exitSells: 0 }), M('zero', { fills: 0, session: sess('overseas'), exitSells: 0 }))
      : by(av({ fills: 1, session: sess('domestic'), exitSells: mixed ? 1 : 0 }), M('zero', { fills: 0, session: sess('overseas'), exitSells: 0 })),
    allocation: M('unknown', null, 'not_set'),
    autoPnl: M('unknown', null, 'baseline_unset'),
    buyable: by(
      av({ native: 480000, currency: 'KRW', krw: 480000, fxAt: null, fxSource: null }),
      av({ native: 310, currency: 'USD', krw: 431600, fxAt: '2026-10-30T16:15:00+09:00', fxSource: 'fx_rates' }),
    ),
  };
}

export function exitLines(mode: Mode, stage: Stage4): ExitLines {
  const liveish = stage === 'mixed' || stage === 'live';
  const j = (v: Partial<{ noFire: number; hardStopOffHit: number; hardStopOffDays: number; dataErrors: number; fired: number; trailingActive: number; createFailed: number }>) =>
    ({ noFire: 0, hardStopOffHit: 0, hardStopOffDays: 0, dataErrors: 0, fired: 0, trailingActive: 0, hardStopOffTicks: 0, hardStopOffDaysCapped: false, createFailed: 0, engineOffHit: 0, cooldown: 0, ...v });
  const domJ = mode === 'empty'
    ? M('zero', j({ noFire: 2 }))
    : liveish
      ? av(stage === 'mixed' ? j({ noFire: 2, fired: 1 }) : j({ noFire: 4, trailingActive: 1 }))
      : M(mode === 'first' ? 'partial' : 'available', j({ noFire: 1, hardStopOffHit: 1, hardStopOffDays: 1, hardStopOffTicks: 57 }));
  const zp = { total: 0, virtual: 0, awaitingApproval: 0, submittedLive: 0, blockedByKill: 0, filled: 0, firstKind: null, firstAt: null, expired: 0, rejected: 0, other: 0 };
  const proposals = mode === 'empty'
    ? M('zero', zp)
    : stage === 'observe' ? av({ ...zp, total: 1, virtual: 1, firstKind: 'eod_loss_cut', firstAt: '2026-10-30T15:26:00+09:00' })
    : stage === 'halt' ? av({ ...zp, total: 1, blockedByKill: 1, firstKind: 'eod_loss_cut', firstAt: '2026-10-30T15:26:00+09:00' })
    : stage === 'mixed' ? av({ ...zp, total: 1, submittedLive: 1, filled: 1 })
    : av({ ...zp, total: 1, awaitingApproval: 1 });
  return {
    engine: av({ enabled: true, hardStopEnabled: liveish }),
    lastEval: by(av({ at: '2026-10-30T15:21:00+09:00', runsToday: 78, sessionOpen: false }), M('off_hours', { at: null, runsToday: 0, sessionOpen: false })),
    nextOverseasOpenKst: '2026-10-30T22:30:00+09:00',
    nextOverseasOpenChange: { sessionDate: '2026-11-02', openKst: '23:30' },
    judgments: by(domJ, M('off_hours', null)),
    proposals,
  };
}

export function checks(stage: Stage4, mode: Mode): CheckItem[] {
  if (mode === 'empty') return [];
  const out: CheckItem[] = [];
  // 일부러 표 순서와 다르게 넣는다(화면이 다시 정렬해야 한다)
  out.push({ kind: 'data_anomaly', severity: 'w', params: { source: 'news_domestic', label: '뉴스 국내', state: 'partial', streak: 2, jobId: null, jobStatus: null, more: null }, href: '/analytics?tab=data' });
  if (stage === 'halt') out.push({ kind: 'kill_switch_on', severity: 'e', params: { since: '2026-10-30T09:08:00+09:00', exitSignalsBlocked: 1 }, href: '/settings' });
  if (stage === 'mixed') {
    out.push({ kind: 'buy_blocked', severity: 'w', params: { validatedEnabled: 0, total: 16 }, href: '/recommend?tab=now' });
    out.push({ kind: 'exit_live_orders', severity: 'e', params: { exitFillsToday: 1 }, href: '/recommend?tab=log' });
  }
  if (stage === 'live') {
    out.push({ kind: 'awaiting_approval', severity: 'w', count: 3, params: { domestic: 1, overseas: 2, earliestSymbol: 'NAS:BBBB', earliestAt: '2026-10-31T09:00:00+09:00' }, href: '/recommend?tab=now' });
    out.push({ kind: 'order_rejected', severity: 'e', count: 1, params: { symbol: '000660', side: 'buy', reason: 'kis_rejected', market: 'domestic' }, href: '/recommend?tab=log' });
  }
  if (stage === 'observe' || stage === 'halt') {
    out.push({ kind: 'hard_stop_off_hit', severity: 'w', count: 1, params: { symbols: 1, days: 1, daysCapped: 0 }, href: '/analytics?tab=verify' });
  }
  if (stage === 'observe') {
    out.push({ kind: 'virtual_exit', severity: 'i', count: 1, params: { at: '2026-10-30T15:26:00+09:00', exitKind: 'eod_loss_cut', notifyAutoSubmit: 0 }, href: '/recommend?tab=log' });
  }
  if (mode === 'first') {
    out.push({ kind: 'analysis_unknown', severity: 'n', market: 'domestic', params: { market: 'domestic', slotAt: '2026-10-30T16:00:00+09:00' }, href: '/analytics?tab=data' });
    out.push({ kind: 'analysis_unknown', severity: 'n', market: 'overseas', params: { market: 'overseas', slotAt: '2026-10-30T08:00:00+09:00' }, href: '/analytics?tab=data' });
  }
  return out;
}

export function activity(mode: Mode, stage: Stage4): ActivityItem[] {
  if (mode === 'empty') {
    return [
      { at: '2026-10-30T08:00:00+09:00', kind: 'analysis', title: '해외 장마감 분석 완료 (ET 10-29)', sub: '51종목 · 후보 0', params: {} },
      { at: '2026-10-30T16:00:00+09:00', kind: 'analysis', title: '국내 장마감 분석 완료', sub: '44종목 · 후보 0', params: {} },
    ];
  }
  const list: ActivityItem[] = [
    { at: '2026-10-30T15:26:00+09:00', kind: 'order', title: '가상 청산 기록 — 종목 A 매도', sub: '장마감 전 손절 · 주문 송신 없음', params: {} },
    { at: '2026-10-30T13:32:00+09:00', kind: 'signal_block', title: '장중 매수 시그널 차단', sub: '검증 관문 · 오늘 22건 모두 차단', params: {} },
    { at: '2026-10-29T16:05:00+09:00', kind: 'order', title: '어제 기록', sub: '날짜가 붙어야 한다', params: {} },
    { at: '2026-10-29T10:00:00+09:00', kind: 'order', title: '다섯째 — 잘려야 한다', sub: '', params: {} },
  ];
  if (mode === 'ok') list.push({ at: '2026-10-30T16:00:00+09:00', kind: 'analysis', title: '국내 장마감 분석 완료', sub: stage === 'live' ? '44종목 · 시그널 1 → 승인 대기' : '44종목 · 시그널 1건 → 검증 관문 차단', params: {} });
  return list;
}

export function homeDTO(stage: Stage4, mode: Mode): HomeDTO {
  const liveish = stage === 'mixed' || stage === 'live';
  return {
    generatedAt: '2026-10-30T16:20:00+09:00', stage, safety: safety(stage),
    checks: { state: 'ok', data: checks(stage, mode) },
    checkCoverage: { approval: true, orders: true, anomalies: true, exitConditions: true, safety: true },
    anomalies: { state: 'ok', data: observeSet(mode).anomalies },
    counts: { state: 'ok', data: { approval: by(stage === 'live' ? 1 : 0, stage === 'live' ? 2 : 0), earliestExpiry: null, rejectedToday: stage === 'live' ? 1 : 0 } },
    observe: liveish ? null : { state: 'ok', data: observeSet(mode) },
    live: liveish ? { state: 'ok', data: liveSet(mode, stage === 'mixed') } : null,
    exit: { state: 'ok', data: exitLines(mode, stage) },
    activity: { state: 'ok', data: activity(mode, stage) },
    analysis: { state: 'ok', data: analysis(mode, liveish) },
  };
}
