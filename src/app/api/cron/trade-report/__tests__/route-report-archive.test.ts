/**
 * T-182 — 거래 리포트 발송 흐름: 보관 INSERT → 요약 + 「👉 앱에서 자세히 보기」 버튼 → delivered 갱신 → 1년 정리.
 *
 * 고정하는 것(설계 2항·6항):
 *  - 보관 성공 + https app_public_url → 버튼 발송(sendTelegramMessage), 링크 = 루트 + ?open=report&id=<id>
 *  - 보관 실패(테이블 없음 포함) → 버튼 없는 요약(sendTelegramAlert)으로 **리포트를 잃지 않는다**
 *  - app_public_url 없음·http → 버튼 생략
 *  - 버튼 발송 400 → 버튼 없이 1회 재시도 / 그 밖의 실패 → 재시도 없음, last_sent_at 보류(기존 규칙)
 *  - force=1 → is_test=1, [테스트] 제목, last_sent_at 미갱신
 *  - 슬랙은 같은 요약 + 링크 한 줄(버튼 없음)
 *  - 섹션 조회 실패는 payload coverage 에 failed 로 남는다
 * 요약·payload 조립은 실제 함수(`buildReportPayload`·`formatReportSummary`)를 탄다 — 데이터 조회만 가짜.
 */
import type { NextRequest } from 'next/server';
import type { NotifyResult } from '@/lib/notify/result';

let config: Record<string, string> = {};
let appUrl: string | null = null;
let archiveMode: 'ok' | 'missing' | 'no_id' = 'ok';
const archiveInserts: unknown[][] = [];
const archiveUpdates: unknown[][] = [];
const archiveDeletes: string[] = [];
const configWrites: { key: string; value: string }[] = [];

jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: () => undefined }));
jest.mock('@/lib/db', () => ({
  getPool: () => ({
    query: async (sql: string, params?: unknown[]) => {
      if (/LIKE 'report_trade_%'/.test(sql)) return [Object.entries(config).map(([key, value]) => ({ key, value }))];
      if (/FROM system_config WHERE `key` = \?/.test(sql)) {
        return [appUrl == null ? [] : [{ key: 'app_public_url', value: JSON.stringify(appUrl) }]];
      }
      if (/INSERT INTO system_config/.test(sql)) {
        const [key, value] = params as [string, string];
        configWrites.push({ key, value });
        config[key] = value;
        return [{}];
      }
      if (/INSERT INTO trade_report_archive/.test(sql)) {
        archiveInserts.push(params ?? []);
        if (archiveMode === 'missing') throw Object.assign(new Error("Table 'x.trade_report_archive' doesn't exist"), { code: 'ER_NO_SUCH_TABLE', errno: 1146 });
        return [archiveMode === 'no_id' ? {} : { insertId: 42 }];
      }
      if (/UPDATE trade_report_archive/.test(sql)) { archiveUpdates.push(params ?? []); return [{ affectedRows: 1 }]; }
      if (/DELETE FROM trade_report_archive/.test(sql)) { archiveDeletes.push(sql); return [{ affectedRows: 0 }]; }
      return [[]];
    },
  }),
}));

const slackMock = jest.fn<Promise<NotifyResult>, unknown[]>();
const alertMock = jest.fn<Promise<NotifyResult>, unknown[]>();
const botMock = jest.fn();
jest.mock('@/lib/notify/slack', () => ({ sendSlackAlert: (...a: unknown[]) => slackMock(...a) }));
jest.mock('@/lib/notify/telegram', () => ({
  sendTelegramAlert: (...a: unknown[]) => alertMock(...a),
  // 폴백(전문) 경로용 — 변환 여부가 보이게 표지를 붙인다
  mrkdwnToTelegramHtml: (s: string) => `HTML(${s})`,
}));
jest.mock('@/lib/notify/telegram-api', () => ({ sendTelegramMessage: (...a: unknown[]) => botMock(...a) }));
jest.mock('@/lib/credentials', () => ({ getCredential: async (k: string) => (k === 'NOTIFY_PROJECT_TAG' ? 'StockInvest' : '') }));
jest.mock('@/lib/safety/portfolio-total', () => ({ getPortfolioTotalState: async () => ({ status: 'ok', krw: 12_480_000 }) }));
jest.mock('@/lib/reports/trading-day', () => ({ isTradingDay: async () => true }));
jest.mock('@/lib/notify/symbol-name', () => ({ getSymbolLabels: async () => new Map([['005930', '삼성전자']]) }));
jest.mock('@/lib/exchanges/kis', () => ({ getKisTickers: async () => [], getKisOverseasTickers: async () => [] }));
jest.mock('@/lib/research/storage', () => ({ getLatestResearchResults: async () => ({ tracked: [], results: [] }) }));

const candidatesMock = jest.fn();
const researchMock = jest.fn();
/** T-182 폴백 시험용 — 설정하면 실제 조립 함수 대신 던진다 */
let payloadThrows = false;
jest.mock('@/lib/reports/trade-report', () => {
  const actual = jest.requireActual('@/lib/reports/trade-report');
  return {
    ...actual,
    buildTradeReport: async (o: { rangeStart: Date; rangeEnd: Date }) => ({
      rangeStart: o.rangeStart, rangeEnd: o.rangeEnd,
      buys: 0, sells: 0, buysAmountKRW: 0, sellsAmountKRW: 0, headerPnlKRW: 0, lifoPnlKRW: 0,
      unmatchedSellCount: 0, matchedSellCount: 0, perSymbol: [], churnSymbols: [],
    }),
    fetchPortfolioBaselineKRW: async () => 12_950_000,
    fetchSignalCandidates: () => candidatesMock(),
    fetchResearchDigest: () => researchMock(),
    buildReportPayload: (...a: unknown[]) => {
      if (payloadThrows) throw new Error('payload boom');
      return actual.buildReportPayload(...a);
    },
  };
});

const summaryThrows = { on: false };
jest.mock('@/lib/reports/trade-report-view', () => {
  const actual = jest.requireActual('@/lib/reports/trade-report-view');
  return {
    ...actual,
    formatReportSummary: (...a: unknown[]) => {
      if (summaryThrows.on) throw new Error('summary boom');
      return actual.formatReportSummary(...a);
    },
  };
});

import { POST } from '@/app/api/cron/trade-report/route';
import { EMPTY_RESEARCH_DIGEST } from '@/lib/reports/trade-report';

const HOUR = 3600_000;
const CANDS = {
  buyWatchlist: [],
  holdings: [],
  sellPnl: [{ symbol: '005930', exitKind: 'eod_loss_cut', pnlPct: -22.94, pnlKRW: -709_800, sellAmountKRW: 1, signalId: 9, signalAt: null, filled: false }],
};
const DIGEST = { trackedCount: 0, activeCount: 0, items: [], note: 'note' };

function setConfig(channel = 'telegram'): void {
  config = {
    report_trade_enabled: 'true',
    report_trade_channel: JSON.stringify(channel),
    report_trade_mode: '"rolling"',
    report_trade_interval_min: '180',
    report_trade_anchor_kst: 'null',
    report_trade_last_sent_at: JSON.stringify(new Date(Date.now() - 24 * HOUR).toISOString()),
  };
}
const makeReq = (force = false) =>
  ({ nextUrl: new URL(`http://localhost/api/cron/trade-report${force ? '?force=1' : ''}`) }) as unknown as NextRequest;
const lastSentWrites = () => configWrites.filter((w) => w.key === 'report_trade_last_sent_at');

let errSpy: jest.SpyInstance;
beforeEach(() => {
  setConfig();
  appUrl = 'https://stock.example.com/';
  archiveMode = 'ok';
  payloadThrows = false;
  summaryThrows.on = false;
  archiveInserts.length = 0; archiveUpdates.length = 0; archiveDeletes.length = 0; configWrites.length = 0;
  slackMock.mockReset().mockResolvedValue({ ok: true });
  alertMock.mockReset().mockResolvedValue({ ok: true });
  botMock.mockReset().mockResolvedValue({ ok: true, result: { message_id: 1, chat: { id: 1 } } });
  candidatesMock.mockReset().mockResolvedValue(CANDS);
  researchMock.mockReset().mockResolvedValue(DIGEST);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('정상 — 보관 + 버튼', () => {
  test('보관 행 id 로 버튼 링크를 달아 보내고, delivered=1·정리·last_sent_at 갱신', async () => {
    const b = await (await POST(makeReq())).json();
    expect(b).toMatchObject({ ok: true, sent: true, reportId: 42, reportLink: true, lastSentAtAdvanced: true });

    expect(botMock).toHaveBeenCalledTimes(1);
    const [text, keyboard] = botMock.mock.calls[0] as [string, { inline_keyboard: { text: string; url: string }[][] }];
    expect(keyboard).toEqual({ inline_keyboard: [[{ text: '👉 앱에서 자세히 보기', url: 'https://stock.example.com/?open=report&id=42' }]] });
    // sendTelegramAlert 와 같은 모양: <b>[태그] ℹ️ 제목</b> · 본문 · 🕐 … KST
    expect(text).toMatch(/^<b>\[StockInvest\] ℹ️ 거래 리포트 · \d\d\/\d\d \d\d:\d\d \(최근 24시간\) · ⚠️ 확인 1<\/b>\n💰 총자산 ₩12,480,000/);
    expect(text).toContain('<b>⚠️ 확인 필요 1</b>\n• 삼성전자 매도 신호 1건 미체결 (마감손절 · 신호 기준 −₩709,800)');
    expect(text).toMatch(/\n\n🕐 .+ KST$/);
    expect(text).not.toContain('매도 손익');
    expect(alertMock).not.toHaveBeenCalled();

    expect(archiveInserts).toHaveLength(1);
    const [sentAt, rangeStart, rangeEnd, isTest, summaryText, fullText, payloadJson] = archiveInserts[0] as [Date, Date, Date, number, string, string, string];
    expect(sentAt).toBeInstanceOf(Date);
    expect(rangeEnd.getTime()).toBe(sentAt.getTime());
    expect(rangeStart.getTime()).toBeLessThan(rangeEnd.getTime());
    expect(isTest).toBe(0);
    expect(summaryText.startsWith('[StockInvest] ℹ️ 거래 리포트 · ')).toBe(true);
    expect(summaryText).not.toMatch(/<\/?b>/);                   // 보관 원문은 평문
    expect(fullText).toContain('📊 거래 리포트');                  // 지금 형식 전문은 보존용으로 그대로
    const payload = JSON.parse(payloadJson);
    expect(payload.coverage).toEqual({ asset: 'ok', holdings: 'ok', candidates: 'ok', research: 'ok', signals: 'ok' });
    expect(payload.sellSignals[0]).toMatchObject({ name: '삼성전자', filled: false, signalId: 9 });

    expect(archiveUpdates).toEqual([[1, 42]]);
    expect(archiveDeletes).toHaveLength(1);
    expect(archiveDeletes[0]).toMatch(/INTERVAL 365 DAY/);
    expect(archiveDeletes[0]).toMatch(/LIMIT 500/);
    expect(lastSentWrites()).toHaveLength(1);
  });
});

describe('리포트를 잃지 않는다 — 보관·링크 실패', () => {
  test.each<['missing' | 'no_id']>([['missing'], ['no_id']])('보관 INSERT 실패(%s) → 버튼 없는 요약, last_sent_at 갱신', async (mode) => {
    archiveMode = mode;
    const b = await (await POST(makeReq())).json();
    expect(b).toMatchObject({ sent: true, reportId: null, reportLink: false, lastSentAtAdvanced: true });
    expect(botMock).not.toHaveBeenCalled();
    expect(alertMock).toHaveBeenCalledTimes(1);
    const [level, title, body] = alertMock.mock.calls[0] as [string, string, string];
    expect(level).toBe('info');
    expect(title).toMatch(/^거래 리포트 · .+ · ⚠️ 확인 1$/);
    expect(body).toContain('<b>⚠️ 확인 필요 1</b>');
    expect(archiveUpdates).toHaveLength(0);
    expect(archiveDeletes).toHaveLength(0);
    expect(errSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n')).toContain('버튼 없는 요약으로 발송한다');
  });

  test.each<[string, string | null]>([['없음', null], ['http', 'http://stock.example.com/'], ['공백', 'https://a b/']])(
    'app_public_url %s → 버튼 생략(보관은 그대로)', async (_n, url) => {
      appUrl = url;
      const b = await (await POST(makeReq())).json();
      expect(b).toMatchObject({ sent: true, reportId: 42, reportLink: false });
      expect(botMock).not.toHaveBeenCalled();
      expect(alertMock).toHaveBeenCalledTimes(1);
      expect(archiveUpdates).toEqual([[1, 42]]);
    },
  );

  test('버튼 포함 발송이 400 → 버튼 없이 1회 재시도해 전달', async () => {
    botMock.mockResolvedValue({ ok: false, status: 400, error: 'HTTP 400 Bad Request: BUTTON_URL_INVALID' });
    const b = await (await POST(makeReq())).json();
    expect(botMock).toHaveBeenCalledTimes(1);
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(b).toMatchObject({ sent: true, lastSentAtAdvanced: true });
    expect(archiveUpdates).toEqual([[1, 42]]);
  });

  test('400 재시도도 실패하면 sent=false, last_sent_at 보류, delivered=0, 정리 안 함', async () => {
    botMock.mockResolvedValue({ ok: false, status: 400, error: 'HTTP 400' });
    alertMock.mockResolvedValue({ ok: false, error: 'HTTP 400' });
    const b = await (await POST(makeReq())).json();
    expect(b).toMatchObject({ sent: false, lastSentAtAdvanced: false });
    expect(lastSentWrites()).toHaveLength(0);
    expect(archiveUpdates).toEqual([[0, 42]]);
    expect(archiveDeletes).toHaveLength(0);
  });

  test('400 이 아닌 실패(네트워크·5xx)는 버튼 없이 재시도하지 않고 다음 tick 에 맡긴다', async () => {
    botMock.mockResolvedValue({ ok: false, status: 502, error: 'HTTP 502' });
    const b = await (await POST(makeReq())).json();
    expect(alertMock).not.toHaveBeenCalled();
    expect(b).toMatchObject({ sent: false, lastSentAtAdvanced: false, failed: [{ channel: 'telegram', error: 'HTTP 502' }] });
    expect(archiveUpdates).toEqual([[0, 42]]);
  });

  test('자격증명 미설정(skipped)은 기존 규칙 그대로 — 미설정으로 보고하고 last_sent_at 갱신', async () => {
    botMock.mockResolvedValue({ ok: false, skipped: true, error: 'telegram_not_configured' });
    const b = await (await POST(makeReq())).json();
    expect(b).toMatchObject({ sent: false, unconfigured: ['telegram'], lastSentAtAdvanced: true });
  });
});

describe('force · 채널 · coverage', () => {
  test('force=1 → is_test=1, [테스트] 제목, last_sent_at 미갱신(버튼은 단다)', async () => {
    const b = await (await POST(makeReq(true))).json();
    expect((archiveInserts[0] as unknown[])[3]).toBe(1);
    expect(botMock.mock.calls[0][0]).toMatch(/^<b>\[StockInvest\] ℹ️ \[테스트\] 거래 리포트 · /);
    expect(b).toMatchObject({ sent: true, lastSentAtAdvanced: false });
    expect(lastSentWrites()).toHaveLength(0);
  });

  test('슬랙: 같은 요약(mrkdwn) + 링크 한 줄, 버튼 없음', async () => {
    setConfig('slack');
    await POST(makeReq());
    expect(botMock).not.toHaveBeenCalled();
    const [, title, body] = slackMock.mock.calls[0] as [string, string, string];
    expect(title).toMatch(/^거래 리포트 · /);
    expect(body).toContain('*⚠️ 확인 필요 1*');
    expect(body.endsWith('\n\n👉 앱에서 자세히 보기: https://stock.example.com/?open=report&id=42')).toBe(true);
  });

  test('후보 조회가 던지고 리서치가 실패 표지를 돌려주면 coverage 에 failed 로 남고 요약에 드러난다', async () => {
    candidatesMock.mockRejectedValue(new Error('db down'));
    researchMock.mockResolvedValue(EMPTY_RESEARCH_DIGEST);
    await POST(makeReq());
    const payload = JSON.parse((archiveInserts[0] as string[])[6]);
    expect(payload.coverage).toEqual({ asset: 'ok', holdings: 'failed', candidates: 'failed', research: 'failed', signals: 'failed' });
    const text = botMock.mock.calls[0][0] as string;
    expect(text).toContain('• 보유 정보를 읽지 못함 — 0건이 아님');
    expect(text).toContain('• 리서치 정보를 읽지 못함 — 0건이 아님');
  });
});

describe('조립 실패 폴백 — 보관·버튼 없이 기존 전문 발송', () => {
  test('요약 조립(formatReportSummary) 예외 → 전문을 sendTelegramAlert 로, last_sent_at 전진', async () => {
    summaryThrows.on = true;
    const b = await (await POST(makeReq())).json();
    expect(b).toMatchObject({ ok: true, sent: true, summaryFallback: true, reportId: null, reportLink: false, lastSentAtAdvanced: true });
    expect(botMock).not.toHaveBeenCalled();
    expect(archiveInserts).toHaveLength(0);
    expect(archiveUpdates).toHaveLength(0);
    expect(alertMock).toHaveBeenCalledTimes(1);
    const [level, title, body] = alertMock.mock.calls[0] as [string, string, string];
    expect(level).toBe('info');
    expect(title).toBe('거래 리포트 (24h)');
    expect(body.startsWith('HTML(*📊 거래 리포트 (24h)*')).toBe(true);    // 전문을 mrkdwn→HTML 로 변환해 보냄
    expect(lastSentWrites()).toHaveLength(1);
    expect(errSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n')).toContain('요약·보관 데이터 조립 실패');
  });

  test('payload 조립(buildReportPayload) 예외 → 같은 폴백(보관 없이 전문), 슬랙은 전문 mrkdwn 그대로', async () => {
    payloadThrows = true;
    setConfig('both');
    const b = await (await POST(makeReq())).json();
    expect(b).toMatchObject({ sent: true, summaryFallback: true, reportId: null, lastSentAtAdvanced: true });
    expect(archiveInserts).toHaveLength(0);
    expect(botMock).not.toHaveBeenCalled();
    const [, sTitle, sBody] = slackMock.mock.calls[0] as [string, string, string];
    expect(sTitle).toBe('거래 리포트 (24h)');
    expect(sBody.startsWith('*📊 거래 리포트 (24h)*')).toBe(true);
    expect(alertMock).toHaveBeenCalledTimes(1);
  });

  test('폴백 + force=1 → [테스트] 제목, last_sent_at 미갱신', async () => {
    summaryThrows.on = true;
    const b = await (await POST(makeReq(true))).json();
    expect(alertMock.mock.calls[0][1]).toBe('[테스트] 거래 리포트 (24h)');
    expect(b).toMatchObject({ sent: true, summaryFallback: true, lastSentAtAdvanced: false });
    expect(lastSentWrites()).toHaveLength(0);
  });

  test('폴백 발송도 실패하면 기존 규칙대로 last_sent_at 보류(다음 tick 재시도)', async () => {
    summaryThrows.on = true;
    alertMock.mockResolvedValue({ ok: false, error: 'ETIMEDOUT' });
    const b = await (await POST(makeReq())).json();
    expect(b).toMatchObject({ sent: false, summaryFallback: true, lastSentAtAdvanced: false });
    expect(lastSentWrites()).toHaveLength(0);
  });

  test('정상 경로는 summaryFallback=false', async () => {
    const b = await (await POST(makeReq())).json();
    expect(b.summaryFallback).toBe(false);
  });
});
