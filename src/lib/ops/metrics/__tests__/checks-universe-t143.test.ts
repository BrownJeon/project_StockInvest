/**
 * T-143 — 홈 「확인 필요」의 해외 분석 대상 변경 제안 줄 (구현 가이드 §3.1·§3.2·§3.4).
 *
 * 🔴 핵심은 **fail-closed 를 깨지 않는다**는 것이다(§0.1 불편한 사실 6): 제안 건수를 못 읽었을 때(`null`)
 * 그 줄만 빠지고 「모든거래차단 ON」 같은 급한 줄은 그대로 보여야 한다. 0 건과 「못 읽음」을 섞지 않는다.
 */
jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));

import { buildChecks, type CheckInput } from '../checks';
import { metric } from '../metric';
import { CHECK_ORDER, checkLine, checkLines } from '@/components/home/check-copy';
import type { CheckItem, ExitLines, SafetyStateDTO } from '../types';

const SAFETY: SafetyStateDTO = {
  readAt: 'x', stage: 'observe', liveTrading: false, killSwitch: false,
  exitEngine: { enabled: false, hardStopEnabled: true, source: 'config' },
  strategies: { total: 16, enabled: 3, validated: 0, validatedEnabled: 0 }, notifyAutoSubmit: false, errors: [],
};

function exitLines(): ExitLines {
  return {
    engine: metric('available', { enabled: false, hardStopEnabled: true }, 'x'),
    lastEval: { domestic: metric('off_hours', null), overseas: metric('off_hours', null) },
    nextOverseasOpenKst: null, nextOverseasOpenChange: null,
    judgments: { domestic: metric('off_hours', null), overseas: metric('off_hours', null) },
    proposals: metric('zero', { total: 0, virtual: 0, awaitingApproval: 0, submittedLive: 0, blockedByKill: 0, filled: 0, firstKind: null, firstAt: null, expired: 0, rejected: 0, other: 0 }, 'x'),
  };
}

function input(over: Partial<CheckInput> = {}): CheckInput {
  return {
    stage: 'observe', safety: SAFETY, killSwitchSince: null,
    approval: { approval: { domestic: 0, overseas: 0 }, earliestExpiry: null },
    rejected: { count: 0, latest: null }, blocked: { count: 0, latest: null },
    exit: exitLines(), exitFillsToday: null,
    anomalies: metric('zero', { total: 0, sourcesChecked: 7, items: [], analysisFailureKnown: true }, 'x'),
    slotUnrecorded: { domestic: null, overseas: null },
    universeProposals: null,
    ...over,
  };
}

describe('buildChecks — universe_change_proposed', () => {
  it('제안 1건 이상이면 줄이 생긴다 — severity w · 건수 · 이동 경로', () => {
    const c = buildChecks(input({ universeProposals: { open: 3, first: 'NAS:AAAA 상장폐지 예정' } }));
    expect(c.map((x) => x.kind)).toEqual(['universe_change_proposed']);
    expect(c[0]).toMatchObject({
      severity: 'w', count: 3, market: 'overseas',
      params: { first: 'NAS:AAAA 상장폐지 예정', more: 2 },
      href: '/settings/overseas-universe?tab=proposals',
    });
  });

  it('0 건이면 줄이 없다 — 「확인된 0」이라 줄을 만들지 않는다', () => {
    expect(buildChecks(input({ universeProposals: { open: 0, first: null } }))).toEqual([]);
  });

  it('🔴 못 읽었으면(null) 줄만 빠지고 다른 줄은 그대로 — 섹션을 오류로 만들지 않는다(§3.4)', () => {
    const halted = buildChecks(input({ stage: 'halt', killSwitchSince: '2026-12-02T08:00:00+09:00', universeProposals: null }));
    expect(halted.map((x) => x.kind)).toEqual(['kill_switch_on']);
    // 같은 입력에 제안만 생기면 두 줄이 되고, 급한 줄이 먼저다
    const both = buildChecks(input({ stage: 'halt', killSwitchSince: 'x', universeProposals: { open: 1, first: 'NAS:AAAA 인수 합의' } }));
    expect(both.map((x) => x.kind)).toEqual(['kill_switch_on', 'universe_change_proposed']);
    expect(CHECK_ORDER.indexOf('kill_switch_on')).toBeLessThan(CHECK_ORDER.indexOf('universe_change_proposed'));
  });

  it('순서 — 가상 청산 뒤, 데이터 이상 앞(가이드 §3.2)', () => {
    const i = CHECK_ORDER.indexOf('universe_change_proposed');
    expect(CHECK_ORDER[i - 1]).toBe('virtual_exit');
    expect(CHECK_ORDER[i + 1]).toBe('data_anomaly');
  });
});

describe('checkLine — 문구', () => {
  const item = (open: number, first: string | null): CheckItem => ({
    kind: 'universe_change_proposed', severity: 'w', count: open, market: 'overseas',
    params: { first, more: open - 1 }, href: '/settings/overseas-universe?tab=proposals',
  });

  it('제목·부제 — 「해외 분석 대상 변경 제안 3건」 / 「NAS:AAAA 상장폐지 예정 · 외 2건」', () => {
    const ln = checkLine(item(3, 'NAS:AAAA 상장폐지 예정'), Date.now());
    expect(ln).toEqual({
      key: 'universe-proposed', severity: 'w', glyph: '3',
      title: '해외 분석 대상 변경 제안 3건',
      sub: 'NAS:AAAA 상장폐지 예정 · 외 2건',
      href: '/settings/overseas-universe?tab=proposals',
    });
  });

  it('1건이면 「외 n건」을 붙이지 않는다', () => {
    expect(checkLine(item(1, 'NAS:AJJJ 거래소 이동 (→ NYSE)'), Date.now())?.sub).toBe('NAS:AJJJ 거래소 이동 (→ NYSE)');
  });

  it('first 가 null 이면 부제를 비운다 — 0 이나 빈 문자열로 채우지 않는다', () => {
    expect(checkLine(item(2, null), Date.now())?.sub).toBeNull();
  });

  it('🔴 종목 코드를 줄이지 않는다 — 거래소 접두사가 뜻을 가진다(§2.5·§3.1)', () => {
    const ln = checkLine(item(1, 'NAS:AJJJ 거래소 이동 (→ NYSE)'), Date.now());
    expect(ln?.sub).toContain('NAS:AJJJ');
    expect(ln?.sub).not.toBe('AJJJ 거래소 이동 (→ NYSE)');
  });

  it('홈 목록에서 데이터 이상 줄보다 앞에 온다(서버가 보낸 순서와 무관하게 다시 정렬)', () => {
    const anomaly: CheckItem = {
      kind: 'data_anomaly', severity: 'w',
      params: { source: 'fx_usdkrw', label: '환율 USD/KRW', state: 'stale', streak: null, more: null },
      href: '/analytics?tab=data',
    };
    const lines = checkLines([anomaly, item(2, 'NAS:AAAA 상장폐지 예정')], Date.now());
    expect(lines.map((l) => l.key)).toEqual(['universe-proposed', 'anomaly-group']);
  });
});
