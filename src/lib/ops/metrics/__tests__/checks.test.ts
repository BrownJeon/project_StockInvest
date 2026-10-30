/**
 * T-108 홈 「확인 필요」 — 조건·순서 고정 (가이드 §2.3.2 표).
 */
jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));

import { buildChecks, checkCoverage, type CheckInput } from '../checks';
import { metric } from '../metric';
import type { ExitLines, SafetyStateDTO } from '../types';

const SAFETY: SafetyStateDTO = {
  readAt: 'x', stage: 'observe', liveTrading: false, killSwitch: false,
  exitEngine: { enabled: true, hardStopEnabled: false, source: 'config' },
  strategies: { total: 16, enabled: 3, validated: 0, validatedEnabled: 0 }, notifyAutoSubmit: false, errors: [],
};
const judg = (hit: number, days = 1) => metric('available', {
  noFire: 0, hardStopOffHit: hit, hardStopOffDays: days, dataErrors: 0, fired: 0, trailingActive: 0, hardStopOffTicks: hit * 55, hardStopOffDaysCapped: false, createFailed: 0,
  engineOffHit: 0, cooldown: 0,
}, 'x');
function exit(over: Partial<ExitLines> = {}): ExitLines {
  return {
    engine: metric('available', { enabled: true, hardStopEnabled: false }, 'x'),
    lastEval: { domestic: metric('off_hours', null), overseas: metric('off_hours', null) },
    nextOverseasOpenKst: null, nextOverseasOpenChange: null,
    judgments: { domestic: judg(1, 2), overseas: metric('off_hours', null) },
    proposals: metric('available', { total: 1, virtual: 1, awaitingApproval: 0, submittedLive: 0, blockedByKill: 0, filled: 0, firstKind: 'eod_loss_cut', firstAt: '2026-10-30T15:26:00+09:00', expired: 0, rejected: 0, other: 0 }, 'x'),
    ...over,
  };
}
function input(over: Partial<CheckInput> = {}): CheckInput {
  return {
    stage: 'observe', safety: SAFETY, killSwitchSince: null,
    approval: { approval: { domestic: 0, overseas: 0 }, earliestExpiry: null },
    rejected: { count: 0, latest: null }, blocked: { count: 0, latest: null }, exit: exit(), exitFillsToday: null,
    anomalies: metric('zero', { total: 0, sourcesChecked: 7, items: [], analysisFailureKnown: true }, 'x'),
    slotUnrecorded: { domestic: null, overseas: null }, ...over,
  };
}

describe('buildChecks', () => {
  it('관찰 단계 첫 배포 모양 — 손실한도 손절 OFF 한도 도달·가상 청산·분석 기록 없음', () => {
    const c = buildChecks(input({ slotUnrecorded: { domestic: null, overseas: '2026-10-30T08:00:00+09:00' } }));
    expect(c.map((x) => x.kind)).toEqual(['hard_stop_off_hit', 'virtual_exit', 'analysis_unknown']);
    expect(c[0]).toMatchObject({ count: 1, params: { symbols: 1, days: 2, daysCapped: 0 }, href: '/analytics?tab=verify', severity: 'w' });
    expect(c[1]).toMatchObject({ params: { exitKind: 'eod_loss_cut', notifyAutoSubmit: 0 }, severity: 'i' });
    expect(c[2]).toMatchObject({ market: 'overseas', severity: 'n', href: '/analytics?tab=data' });
  });

  it('표 순서 고정 — 9종이 모두 나오는 합성 입력', () => {
    const items = [1, 2, 3, 4].map((i) => ({ source: 'news_domestic' as const, state: 'partial' as const, label: `원천${i}`, streak: 2 }));
    const c = buildChecks(input({
      stage: 'halt',
      approval: { approval: { domestic: 2, overseas: 1 }, earliestExpiry: { symbol: '005930', at: 'x' } },
      rejected: { count: 1, latest: { symbol: 'NAS:AAPL', side: 'buy', reason: 'kis_rejected', market: 'overseas' } },
      anomalies: metric('available', { total: 4, sourcesChecked: 7, items, analysisFailureKnown: true }, 'x'),
      slotUnrecorded: { domestic: 'a', overseas: 'b' },
    }));
    expect(c.map((x) => x.kind)).toEqual([
      'kill_switch_on', 'awaiting_approval', 'order_rejected', 'hard_stop_off_hit', 'virtual_exit',
      'data_anomaly', 'data_anomaly', 'data_anomaly', 'analysis_unknown', 'analysis_unknown',
    ]);
    expect(c[1]).toMatchObject({ count: 3, params: { domestic: 2, overseas: 1, earliestSymbol: '005930' } });
    expect(c[7].params.more).toBe(1);
    expect(c[5].params.more).toBeNull();
  });

  it('혼합 단계 — 청산 실주문(엔진 ON) + 신규 매수 차단, 가상 청산 줄은 없다', () => {
    const c = buildChecks(input({ stage: 'mixed', exitFillsToday: 2, exit: exit({ engine: metric('available', { enabled: true, hardStopEnabled: true }, 'x') }) }));
    expect(c.map((x) => x.kind)).toEqual(['exit_live_orders', 'buy_blocked']);
    expect(c[0].params.exitFillsToday).toBe(2);
    expect(c[1].params).toEqual({ validatedEnabled: 0, total: 16 });
  });

  it('손실한도 손절 ON 이면 #6 없음 · 엔진 OFF 면 #2·#6 없음 · 한도 도달 0 이면 #6 없음', () => {
    expect(buildChecks(input({ exit: exit({ engine: metric('available', { enabled: true, hardStopEnabled: true }, 'x') }) })).map((x) => x.kind)).not.toContain('hard_stop_off_hit');
    expect(buildChecks(input({ stage: 'mixed', exit: exit({ engine: metric('available', { enabled: false, hardStopEnabled: false }, 'x') }) })).map((x) => x.kind))
      .toEqual(['buy_blocked', 'virtual_exit'].filter((k) => k !== 'virtual_exit'));
    expect(buildChecks(input({ exit: exit({ judgments: { domestic: judg(0), overseas: judg(0) } }) })).map((x) => x.kind)).not.toContain('hard_stop_off_hit');
  });

  it('승인 대기 1건이어도 줄이 생긴다(≥1)', () => {
    const c = buildChecks(input({ approval: { approval: { domestic: 0, overseas: 1 }, earliestExpiry: null } }));
    expect(c.find((x) => x.kind === 'awaiting_approval')).toMatchObject({ count: 1, params: { domestic: 0, overseas: 1 } });
  });

  it('아무 조건도 없으면 빈 목록', () => {
    const c = buildChecks(input({
      exit: exit({ judgments: { domestic: judg(0), overseas: judg(0) }, proposals: metric('zero', { total: 0, virtual: 0, awaitingApproval: 0, submittedLive: 0, blockedByKill: 0, filled: 0, firstKind: null, firstAt: null, expired: 0, rejected: 0, other: 0 }, 'x') }),
    }));
    expect(c).toEqual([]);
  });

  it('단계 unknown → 맨 앞 safety_unknown 줄(빈 목록이 되지 않는다)', () => {
    const c = buildChecks(input({ stage: 'unknown', safety: { ...SAFETY, stage: 'unknown', errors: ['strategies_error', 'kill_switch_mismatch'] },
      exit: exit({ judgments: { domestic: judg(0), overseas: judg(0) } }) }));
    expect(c[0]).toMatchObject({ kind: 'safety_unknown', severity: 'e', params: { errors: 'strategies_error, kill_switch_mismatch' }, href: '/settings' });
  });

  it('안전장치 차단 주문 — 주문 거부 바로 뒤', () => {
    const c = buildChecks(input({
      rejected: { count: 1, latest: { symbol: 'A', side: 'buy', reason: 'kis_rejected', market: 'domestic' } },
      blocked: { count: 2, latest: { symbol: 'B', side: 'buy', reason: 'daily_limit', market: 'domestic' } },
    }));
    const kinds = c.map((x) => x.kind);
    expect(kinds.indexOf('order_blocked')).toBe(kinds.indexOf('order_rejected') + 1);
    expect(c.find((x) => x.kind === 'order_blocked')).toMatchObject({ count: 2, params: { reason: 'daily_limit' }, severity: 'w' });
  });
});

describe('checkCoverage — 빈 상태 문장의 근거', () => {
  it('데이터 이상이 partial(분석 실패 모름)이면 anomalies=false, 엔진 OFF·장외면 exitConditions=false', () => {
    const cov = checkCoverage(input({
      anomalies: metric('partial', { total: 0, sourcesChecked: 7, items: [], analysisFailureKnown: false }, 'x'),
      exit: exit({ judgments: { domestic: metric('off_hours', null), overseas: metric('off_hours', null) } }),
    }));
    expect(cov).toEqual({ approval: true, orders: true, anomalies: false, exitConditions: false, safety: true });
  });
  it('모두 평가됨', () => {
    expect(checkCoverage(input({ exit: exit({ judgments: { domestic: judg(0), overseas: metric('off_hours', null) } }) })))
      .toEqual({ approval: true, orders: true, anomalies: true, exitConditions: true, safety: true });
  });
  it('단계 unknown → safety=false · 엔진 OFF → exitConditions=false', () => {
    expect(checkCoverage(input({ stage: 'unknown' })).safety).toBe(false);
    expect(checkCoverage(input({ exit: exit({ engine: metric('available', { enabled: false, hardStopEnabled: true }, 'x') }) })).exitConditions).toBe(false);
  });
});
