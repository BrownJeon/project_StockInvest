/**
 * /api/cron/trade-report — 전송 결과 정직성 (2026-08-06).
 *
 * 결함: 전송이 실패해도 `sent:true` 를 응답하고 `report_trade_last_sent_at` 을 갱신했다.
 *       2026-08-04 08:03 정기 리포트가 ETIMEDOUT 으로 유실됐는데 흔적이 남지 않았다.
 *
 * 규칙:
 *  · sent = 한 채널이라도 실제 배달됐는가
 *  · last_sent_at 은 "재시도로 달라질 수 있는 실패"(배달 0 + 실패 ≥1)일 때만 갱신 보류
 *    → 다음 5분 tick 이 자연 재시도. 부분 성공은 갱신(보류하면 성공 채널이 중복 발송된다)
 *  · force=1 은 어떤 경우에도 갱신하지 않는다
 */
import type { NextRequest } from 'next/server';
import type { NotifyResult } from '@/lib/notify/result';

const OK: NotifyResult      = { ok: true };
const SKIPPED: NotifyResult = { ok: false, skipped: true };
const FAIL = (e: string): NotifyResult => ({ ok: false, error: e });

const slackMock    = jest.fn<Promise<NotifyResult>, unknown[]>();
const telegramMock = jest.fn<Promise<NotifyResult>, unknown[]>();

/** system_config 대체 저장소 — 라우트가 실제로 쓰는 키만 담는다 */
let config: Record<string, string> = {};
const writes: { key: string; value: string }[] = [];

jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: () => undefined }));
jest.mock('@/lib/db', () => ({
  getPool: () => ({
    query: async (sql: string, params?: unknown[]) => {
      if (/SELECT/i.test(sql)) {
        return [Object.entries(config).map(([key, value]) => ({ key, value }))];
      }
      if (/INSERT INTO system_config/i.test(sql)) {
        const [key, value] = params as [string, string];
        writes.push({ key, value });
        config[key] = value;
        return [{}];
      }
      return [[]];
    },
  }),
}));
jest.mock('@/lib/notify/slack',    () => ({ sendSlackAlert:    (...a: unknown[]) => slackMock(...a) }));
jest.mock('@/lib/notify/telegram', () => ({
  sendTelegramAlert: (...a: unknown[]) => telegramMock(...a),
  mrkdwnToTelegramHtml: (s: string) => s,
}));
// T-056: 합계는 상태로 받는다(조회 불가면 null 로 표시) — 이 파일의 관심사는 발송·갱신 정책이라 정상값으로 고정한다.
jest.mock('@/lib/safety/portfolio-total', () => ({ getPortfolioTotalState: async () => ({ status: 'ok', krw: 1_000_000 }) }));
jest.mock('@/lib/reports/trading-day',    () => ({ isTradingDay: async () => true }));
// T-033 — 평가 깔때기는 리포트에서 빠졌다. `getEvalFunnelSummary` 를 부르지 않는지도 검증한다.
const funnelMock = jest.fn(async () => null);
jest.mock('@/lib/strategy/eval-funnel-query', () => ({ getEvalFunnelSummary: () => funnelMock() }));
const researchDigestMock = jest.fn(async () => EMPTY_DIGEST);
const signalCandidatesMock = jest.fn(async (_rangeStart?: Date) => EMPTY_CANDS);
const symbolLabelsMock = jest.fn(async (_symbols: string[]) => new Map<string, string>());
const formatMock = jest.fn(() => '리포트 본문');

const EMPTY_CANDS = { buyWatchlist: [], holdings: [], sellPnl: [] };
const EMPTY_DIGEST = { trackedCount: 0, activeCount: 0, items: [], note: 'note' };

jest.mock('@/lib/reports/trade-report', () => ({
  buildTradeReport: async (o: { rangeStart: Date; rangeEnd: Date }) => ({
    rangeStart: o.rangeStart, rangeEnd: o.rangeEnd,
    buys: 1, sells: 2, buysAmountKRW: 100, sellsAmountKRW: 200,
    headerPnlKRW: 100, lifoPnlKRW: 50, perSymbol: [], churnSymbols: [],
  }),
  formatReportMessage: (...a: unknown[]) => formatMock(...(a as [])),
  fetchPortfolioBaselineKRW: async () => 900_000,
  fetchSignalCandidates: (rangeStart?: Date) => signalCandidatesMock(rangeStart),
  fetchResearchDigest: () => researchDigestMock(),
  collectReportSymbols: () => ['005930'],
  // T-182 — 요약·보관 payload 조립. 이 파일의 관심사(발송·갱신 정책·합계 배선)와 무관해 최소 모양만 돌려준다.
  buildReportPayload: (a: { report: { rangeStart: Date; rangeEnd: Date }; totalKRW: number | null; baselineKRW: number | null; coverage: unknown }) => ({
    schemaVersion: 1, rangeStart: a.report.rangeStart.toISOString(), rangeEnd: a.report.rangeEnd.toISOString(),
    coverage: a.coverage, asset: { totalKRW: a.totalKRW, baselineKRW: a.baselineKRW },
    trade: { buys: 0, buysAmountKRW: 0, sells: 0, sellsAmountKRW: 0, lifoPnlKRW: 0, matchedSellCount: 0, unmatchedSellCount: 0, churnSymbols: [] },
    sellSignals: [], holdings: [], candidates: [], research: { trackedCount: 0, activeCount: 0, note: 'note', items: [] },
  }),
  EMPTY_CANDIDATES: { buyWatchlist: [], holdings: [], sellPnl: [] },
  EMPTY_RESEARCH_DIGEST: { trackedCount: 0, activeCount: 0, items: [], note: 'note' },
}));
jest.mock('@/lib/notify/symbol-name', () => ({
  getSymbolLabels: (symbols: string[]) => symbolLabelsMock(symbols),
}));

import { POST } from '@/app/api/cron/trade-report/route';

interface Body {
  ok: boolean; sent: boolean; partial: boolean;
  delivered: string[]; failed: { channel: string; error: string }[]; unconfigured: string[];
  lastSentAtAdvanced: boolean; rangeStart: string; rangeCapped: boolean;
  noTargetChannel: boolean;
  skipped?: string; channel?: string;
}

const TOKEN = '123456789:AAH-fake-token-for-test-only-xyz';

const HOUR = 3600_000;
/** 6시간 전 — interval(180분) 이 이미 지나 rolling 모드에서 발송 대상이 된다 */
const LAST_SENT = new Date(Date.now() - 6 * HOUR);

function setConfig(channel: string, lastSentAt: Date | null = LAST_SENT): void {
  config = {
    report_trade_enabled:      'true',
    report_trade_channel:      JSON.stringify(channel),
    report_trade_mode:         '"rolling"',
    report_trade_interval_min: '180',
    report_trade_anchor_kst:   'null',
    ...(lastSentAt ? { report_trade_last_sent_at: JSON.stringify(lastSentAt.toISOString()) } : {}),
  };
}

function makeReq(force = false): NextRequest {
  return {
    nextUrl: new URL(`http://localhost/api/cron/trade-report${force ? '?force=1' : ''}`),
  } as unknown as NextRequest;
}

const lastSentWrites = () => writes.filter(w => w.key === 'report_trade_last_sent_at');

let errSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;

beforeEach(() => {
  writes.length = 0;
  slackMock.mockResolvedValue(OK);
  telegramMock.mockResolvedValue(OK);
  formatMock.mockReturnValue('리포트 본문');
  researchDigestMock.mockResolvedValue(EMPTY_DIGEST);
  signalCandidatesMock.mockResolvedValue(EMPTY_CANDS);
  symbolLabelsMock.mockResolvedValue(new Map());
  errSpy  = jest.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  errSpy.mockRestore();
  warnSpy.mockRestore();
  jest.clearAllMocks();
});

describe('단일 채널(telegram) — 운영 현재 설정', () => {
  test('성공: sent=true, last_sent_at 갱신', async () => {
    setConfig('telegram');
    const b = await (await POST(makeReq())).json() as Body;
    expect(b.sent).toBe(true);
    expect(b.delivered).toEqual(['telegram']);
    expect(b.failed).toEqual([]);
    expect(b.lastSentAtAdvanced).toBe(true);
    expect(lastSentWrites()).toHaveLength(1);
  });

  test('실패: sent=false 이고 last_sent_at 을 갱신하지 않는다 — 2026-08-04 사고 재현', async () => {
    setConfig('telegram');
    telegramMock.mockResolvedValue(FAIL('fetch failed (ETIMEDOUT)'));
    const b = await (await POST(makeReq())).json() as Body;
    expect(b.sent).toBe(false);
    expect(b.delivered).toEqual([]);
    expect(b.failed).toEqual([{ channel: 'telegram', error: 'fetch failed (ETIMEDOUT)' }]);
    expect(b.lastSentAtAdvanced).toBe(false);
    expect(lastSentWrites()).toHaveLength(0);
  });

  test('실패 시 에러 로그에 채널·사유·갱신 보류가 남는다', async () => {
    setConfig('telegram');
    telegramMock.mockResolvedValue(FAIL('HTTP 401 Unauthorized'));
    await POST(makeReq());
    const out = errSpy.mock.calls.map(c => c.map(String).join(' ')).join('\n');
    expect(out).toContain('[cron/trade-report] 전송 실패');
    expect(out).toContain('telegram:HTTP 401 Unauthorized');
    expect(out).toContain('다음 tick 재시도');
  });

  test('갱신을 보류하면 다음 tick 이 같은 리포트를 재시도하고, 성공하면 그때 갱신된다', async () => {
    setConfig('telegram');
    telegramMock.mockResolvedValue(FAIL('ETIMEDOUT'));
    const first = await (await POST(makeReq())).json() as Body;
    expect(first.sent).toBe(false);

    telegramMock.mockResolvedValue(OK);           // 5분 뒤 tick — 텔레그램 회복
    const second = await (await POST(makeReq())).json() as Body;
    expect(second.sent).toBe(true);
    expect(second.rangeStart).toBe(first.rangeStart);   // 구간 시작은 그대로 (유실분 포함)
    expect(lastSentWrites()).toHaveLength(1);           // 배달된 tick 에서만 1회 갱신
  });

  test('자격증명 미설정은 sent=false 지만 last_sent_at 은 갱신한다 (무한 재시도 방지)', async () => {
    setConfig('telegram');
    telegramMock.mockResolvedValue(SKIPPED);
    const b = await (await POST(makeReq())).json() as Body;
    expect(b.sent).toBe(false);
    expect(b.unconfigured).toEqual(['telegram']);
    expect(b.failed).toEqual([]);
    expect(b.lastSentAtAdvanced).toBe(true);
    expect(lastSentWrites()).toHaveLength(1);
  });

  test('전송 함수가 예외를 던져도 500 이 아니라 sent=false 로 응답한다', async () => {
    setConfig('telegram');
    telegramMock.mockRejectedValue(new Error('boom'));
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const b = await res.json() as Body;
    expect(b.sent).toBe(false);
    expect(b.failed[0].channel).toBe('telegram');
    expect(b.lastSentAtAdvanced).toBe(false);
  });

  /**
   * `failed[].error` 는 HTTP 응답 JSON 으로 그대로 나간다 — 이 작업이 지키려는 바로 그 표면이다.
   * 전송 함수가 던지지 않는 계약이라 오늘은 도달 불가지만, 그건 계약이 아니라 현재 구현의 성질이다.
   */
  test('전송 함수가 비밀값이 든 예외를 던져도 응답 JSON 에 새지 않는다', async () => {
    setConfig('telegram');
    telegramMock.mockRejectedValue(
      new Error(`connect ETIMEDOUT https://api.telegram.org/bot${TOKEN}/sendMessage`),
    );
    const b = await (await POST(makeReq())).json() as Body;
    expect(b.failed[0].error).toContain('bot***');
    expect(JSON.stringify(b)).not.toContain(TOKEN);
    expect(JSON.stringify(b)).not.toContain('AAH-fake-token');
  });
});

describe("channel='both' — 부분 성공", () => {
  test('slack ✅ / telegram ❌ → sent=true + partial=true, 실패 채널을 그대로 노출', async () => {
    setConfig('both');
    telegramMock.mockResolvedValue(FAIL('ETIMEDOUT'));
    const b = await (await POST(makeReq())).json() as Body;
    expect(b.sent).toBe(true);
    expect(b.partial).toBe(true);
    expect(b.delivered).toEqual(['slack']);
    expect(b.failed).toEqual([{ channel: 'telegram', error: 'ETIMEDOUT' }]);
  });

  test('부분 성공은 last_sent_at 을 갱신한다 — 보류하면 slack 이 5분마다 중복 발송된다', async () => {
    setConfig('both');
    telegramMock.mockResolvedValue(FAIL('ETIMEDOUT'));
    await POST(makeReq());
    expect(lastSentWrites()).toHaveLength(1);
    expect(slackMock).toHaveBeenCalledTimes(1);

    // 다음 tick — interval 미도래로 발송 자체가 생략된다 (slack 중복 없음)
    const b = await (await POST(makeReq())).json() as Body;
    expect(b.skipped).toBe('too_early');
    expect(slackMock).toHaveBeenCalledTimes(1);
  });

  test('둘 다 실패하면 sent=false, partial=false, 갱신 보류', async () => {
    setConfig('both');
    slackMock.mockResolvedValue(FAIL('ECONNREFUSED'));
    telegramMock.mockResolvedValue(FAIL('ETIMEDOUT'));
    const b = await (await POST(makeReq())).json() as Body;
    expect(b.sent).toBe(false);
    expect(b.partial).toBe(false);
    expect(b.failed.map(f => f.channel).sort()).toEqual(['slack', 'telegram']);
    expect(lastSentWrites()).toHaveLength(0);
  });

  test('둘 다 성공하면 sent=true, partial=false', async () => {
    setConfig('both');
    const b = await (await POST(makeReq())).json() as Body;
    expect(b.sent).toBe(true);
    expect(b.partial).toBe(false);
    expect(b.delivered).toEqual(['slack', 'telegram']);
    expect(lastSentWrites()).toHaveLength(1);
  });
});

describe('force=1 — last_sent_at 은 어떤 경우에도 갱신하지 않는다', () => {
  test('성공해도 갱신하지 않는다', async () => {
    setConfig('telegram');
    const b = await (await POST(makeReq(true))).json() as Body;
    expect(b.sent).toBe(true);
    expect(b.lastSentAtAdvanced).toBe(false);
    expect(lastSentWrites()).toHaveLength(0);
  });

  test('실패해도 갱신하지 않고 sent=false 로 보고한다', async () => {
    setConfig('telegram');
    telegramMock.mockResolvedValue(FAIL('ETIMEDOUT'));
    const b = await (await POST(makeReq(true))).json() as Body;
    expect(b.sent).toBe(false);
    expect(b.lastSentAtAdvanced).toBe(false);
    expect(lastSentWrites()).toHaveLength(0);
  });
});

describe("fixed 모드(운영 설정: anchor 08:00) — 갱신 보류가 곧 자연 재시도", () => {
  /** 1시간 전 KST 시각을 anchor 로 — 이미 도래했으므로 발송 대상 */
  function anchorOneHourAgoKst(): string {
    const kst = new Date(Date.now() + 9 * HOUR - 1 * HOUR);
    const hh = String(kst.getUTCHours()).padStart(2, '0');
    const mm = String(kst.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  test('전송 실패 → 다음 tick 에서 anchor 게이트가 다시 통과해 재시도된다', async () => {
    config = {
      report_trade_enabled:      'true',
      report_trade_channel:      '"telegram"',
      report_trade_mode:         '"fixed"',
      report_trade_interval_min: '180',
      report_trade_anchor_kst:   JSON.stringify(anchorOneHourAgoKst()),
      report_trade_last_sent_at: JSON.stringify(new Date(Date.now() - 25 * HOUR).toISOString()),
    };

    telegramMock.mockResolvedValue(FAIL('ETIMEDOUT'));
    const first = await (await POST(makeReq())).json() as Body;
    expect(first.sent).toBe(false);
    expect(first.lastSentAtAdvanced).toBe(false);

    // 5분 뒤 tick — last_sent_at 이 그대로라 anchor 가 여전히 (last, now] 구간에 있다
    const second = await (await POST(makeReq())).json() as Body;
    expect(second.skipped).toBeUndefined();       // anchor_not_due 로 막히지 않음
    expect(telegramMock).toHaveBeenCalledTimes(2);

    // 세 번째 tick 에서 회복 → 그때 갱신되고, 이후 tick 은 anchor_not_due 로 멈춘다
    telegramMock.mockResolvedValue(OK);
    const third = await (await POST(makeReq())).json() as Body;
    expect(third.sent).toBe(true);
    expect(lastSentWrites()).toHaveLength(1);

    const fourth = await (await POST(makeReq())).json() as Body;
    expect(fourth.skipped).toBe('anchor_not_due');
    expect(telegramMock).toHaveBeenCalledTimes(3);   // 배달 성공 후 추가 발송 없음 = 스팸 없음
  });
});

describe('report_trade_channel 손상 — 조용히 지나가는 경로가 없어야 한다', () => {
  test.each(['sms', '', 'BOTH', 'slack,telegram', 'null'])(
    '%p 은 거절하고 전송·갱신 어느 것도 하지 않으며 로그를 남긴다',
    async (bad) => {
      setConfig(bad);
      const res = await POST(makeReq());
      const b = await res.json() as Body;

      expect(b.ok).toBe(false);
      expect(b.skipped).toBe('channel_invalid');
      expect(slackMock).not.toHaveBeenCalled();
      expect(telegramMock).not.toHaveBeenCalled();
      expect(lastSentWrites()).toHaveLength(0);   // 구간 이력 보존 — 고치면 그동안 분량까지 발송
      expect(errSpy.mock.calls.map(c => c.map(String).join(' ')).join('\n'))
        .toContain('report_trade_channel 값이 유효하지 않다');
    },
  );

  test('force=1 이어도 손상된 값은 거절한다', async () => {
    setConfig('sms');
    const b = await (await POST(makeReq(true))).json() as Body;
    expect(b.skipped).toBe('channel_invalid');
    expect(slackMock).not.toHaveBeenCalled();
  });

  test("정상 값 'none' 은 게이트를 통과하고 기존 동작을 유지한다 (force 시 slack 대체 발송)", async () => {
    setConfig('none');
    const nonForce = await (await POST(makeReq())).json() as Body;
    expect(nonForce.skipped).toBe('channel_none');

    const forced = await (await POST(makeReq(true))).json() as Body;
    expect(forced.sent).toBe(true);
    expect(forced.delivered).toEqual(['slack']);
    expect(forced.noTargetChannel).toBe(false);
  });
});

describe('장애 장기화 안전성', () => {
  test('rangeStart 는 14일 한도로 절단된다 — last_sent_at 이 오래 멈춰도 병리적 구간을 만들지 않는다', async () => {
    setConfig('telegram', new Date(Date.now() - 40 * 24 * HOUR));
    telegramMock.mockResolvedValue(FAIL('ETIMEDOUT'));
    const b = await (await POST(makeReq())).json() as Body;
    expect(b.rangeCapped).toBe(true);
    const ageDays = (Date.now() - new Date(b.rangeStart).getTime()) / (24 * HOUR);
    expect(ageDays).toBeLessThanOrEqual(14.01);
    expect(ageDays).toBeGreaterThan(13.99);
  });

  test('정상 공백(연휴 10일)은 절단하지 않는다', async () => {
    setConfig('telegram', new Date(Date.now() - 10 * 24 * HOUR));
    const b = await (await POST(makeReq())).json() as Body;
    expect(b.rangeCapped).toBe(false);
    const ageDays = (Date.now() - new Date(b.rangeStart).getTime()) / (24 * HOUR);
    expect(ageDays).toBeGreaterThan(9.99);
  });
});

// ─── T-033 — 리서치 요약 배선 (평가 깔때기 제거) ──────────────────────────────

describe('T-033 리포트 구성 변경', () => {
  test('평가 깔때기(getEvalFunnelSummary)를 더 이상 호출하지 않는다', async () => {
    setConfig('telegram');
    await POST(makeReq());
    expect(funnelMock).not.toHaveBeenCalled();
  });

  test('fetchSignalCandidates 가 rangeStart 를 받는다 (종목별 주기 변동률 기준 시점)', async () => {
    setConfig('telegram');
    const b = await (await POST(makeReq())).json() as Body;
    expect(signalCandidatesMock).toHaveBeenCalledTimes(1);
    const passed = signalCandidatesMock.mock.calls[0][0] as unknown as Date;
    expect(passed).toBeInstanceOf(Date);
    expect(passed.toISOString()).toBe(b.rangeStart);
  });

  test('리서치 다이제스트를 조회해 formatReportMessage 5번째 인자로 넘긴다', async () => {
    setConfig('telegram');
    await POST(makeReq());
    expect(researchDigestMock).toHaveBeenCalledTimes(1);
    expect(formatMock.mock.calls[0][4]).toEqual(EMPTY_DIGEST);
  });

  test('한글 종목명 Map 을 6번째 인자로 넘긴다', async () => {
    setConfig('telegram');
    symbolLabelsMock.mockResolvedValue(new Map([['005930', '삼성전자']]));
    await POST(makeReq());
    expect(symbolLabelsMock).toHaveBeenCalledWith(['005930']);
    expect(formatMock.mock.calls[0][5]).toEqual(new Map([['005930', '삼성전자']]));
  });

  test('리서치·후보 조회가 실패해도 리포트는 발송된다(빈 값 폴백)', async () => {
    setConfig('telegram');
    researchDigestMock.mockRejectedValue(new Error('research down'));
    signalCandidatesMock.mockRejectedValue(new Error('db down'));
    const b = await (await POST(makeReq())).json() as Body;
    expect(b.sent).toBe(true);
    expect(formatMock.mock.calls[0][3]).toEqual({ buyWatchlist: [], holdings: [], sellPnl: [] });
    expect(formatMock.mock.calls[0][4]).toEqual({ trackedCount: 0, activeCount: 0, items: [], note: 'note' });
  });
});
