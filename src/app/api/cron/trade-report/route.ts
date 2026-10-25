import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { getPortfolioTotalState } from '@/lib/safety/portfolio-total';
import { sendSlackAlert } from '@/lib/notify/slack';
import { sendTelegramAlert, mrkdwnToTelegramHtml } from '@/lib/notify/telegram';
import { notifyFailed, redactSecrets, type NotifyResult } from '@/lib/notify/result';
import {
  buildTradeReport,
  formatReportMessage,
  fetchPortfolioBaselineKRW,
  fetchSignalCandidates,
  fetchResearchDigest,
  collectReportSymbols,
  EMPTY_CANDIDATES,
  EMPTY_RESEARCH_DIGEST,
} from '@/lib/reports/trade-report';
import { getSymbolLabels } from '@/lib/notify/symbol-name';
import { parseAnchorList, shouldFireAtAnchorList } from '@/lib/reports/anchor';
import { isTradingDay } from '@/lib/reports/trading-day';

export const dynamic = 'force-dynamic';

import { checkCronAuth } from '@/lib/cron-auth';

const REPORT_CHANNELS = ['slack', 'telegram', 'both', 'none'] as const;
type ReportChannel = (typeof REPORT_CHANNELS)[number];
type ReportMode = 'rolling' | 'fixed';

/**
 * `report_trade_channel` 은 DB 문자열이라 `parse<ReportChannel>()` 의 타입 단언만으로는
 * 실제 값이 보장되지 않는다. 알 수 없는 값이면 전송 대상 채널이 0개가 되어
 * **아무것도 하지 않고 성공처럼 끝나는** 상태가 된다 — 이 작업이 없애려는 바로 그 실패 양식이다.
 */
function isReportChannel(v: unknown): v is ReportChannel {
  return typeof v === 'string' && (REPORT_CHANNELS as readonly string[]).includes(v);
}

interface ReportConfig {
  enabled: boolean;
  channel: ReportChannel;
  mode: ReportMode;
  intervalMin: number;
  anchorKst: string | null;
  lastSentAt: Date | null;
}

async function readConfig(): Promise<ReportConfig> {
  const pool = getPool();
  const [rows] = await pool.query<(RowDataPacket & { key: string; value: string })[]>(
    "SELECT `key`, value FROM system_config WHERE `key` LIKE 'report_trade_%'",
  );
  const map = new Map(rows.map(r => [r.key, r.value]));
  const parse = <T,>(k: string, fallback: T): T => {
    const raw = map.get(k);
    if (raw == null) return fallback;
    try { return JSON.parse(raw) as T; } catch { return fallback; }
  };
  const lastRaw = parse<string | null>('report_trade_last_sent_at', null);
  return {
    enabled:     parse<boolean>('report_trade_enabled', false),
    channel:     parse<ReportChannel>('report_trade_channel', 'slack'),
    mode:        parse<ReportMode>('report_trade_mode', 'rolling'),
    intervalMin: parse<number>('report_trade_interval_min', 180),
    anchorKst:   parse<string | null>('report_trade_anchor_kst', null),
    lastSentAt:  lastRaw ? new Date(lastRaw) : null,
  };
}

type SendTarget = 'slack' | 'telegram';

/**
 * 리포트 구간(rangeStart) 최대 소급 한도.
 *
 * 전송 실패 시 `report_trade_last_sent_at` 을 갱신하지 않으므로(= 다음 tick 자연 재시도),
 * 장애가 길어지면 `rangeStart = last` 가 계속 과거로 남아 구간이 무한히 넓어진다.
 * 정상 운영에서 가장 긴 공백은 연휴(추석·설 최장 ~10일)이므로 14일이면 정상 케이스를
 * 절대 건드리지 않으면서, 영구 실패(토큰 폐기 등) 시 eval_funnel 집계가 몇 달치를
 * 5분마다 스캔하는 병리적 상태만 차단한다.
 */
const MAX_RANGE_LOOKBACK_MS = 14 * 24 * 3600_000;

/**
 * 전송 함수가 (계약을 어기고) 던져도 라우트가 500 으로 죽지 않게 감싼다.
 *
 * 여기서 만든 문자열은 HTTP 응답의 `failed[].error` 로 그대로 나가므로 **반드시 redact** 한다.
 * 이 경로는 오늘 도달 불가능하지만(두 전송 함수 모두 던지지 않음) 그건 현재 구현의 성질일 뿐
 * 계약이 아니다 — 방어선에 구멍을 하나라도 남기면 다음 사고가 그리로 들어온다.
 */
async function trySend(fn: () => Promise<NotifyResult>): Promise<NotifyResult> {
  try {
    return await fn();
  } catch (e) {
    return notifyFailed(redactSecrets(e instanceof Error ? e.message : String(e)));
  }
}

async function setLastSent(now: Date): Promise<void> {
  const pool = getPool();
  await pool.query(
    'INSERT INTO system_config (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
    ['report_trade_last_sent_at', JSON.stringify(now.toISOString())],
  );
}

export async function POST(req: NextRequest) {
  const authErr = checkCronAuth(req);
  if (authErr) return authErr;

  const force = req.nextUrl.searchParams.get('force') === '1';

  try {
    const cfg = await readConfig();

    // 손상된 채널 값은 일을 다 해놓고 아무 데도 보내지 않는 상태로 이어진다.
    // 작업 시작 전에 잘라내고(KIS·DB 낭비 방지) 흔적을 남긴다. last_sent_at 은 건드리지 않으므로
    // 설정이 고쳐지면 다음 tick 이 그동안의 구간까지 포함해 정상 발송한다.
    if (!isReportChannel(cfg.channel)) {
      console.error(
        `[cron/trade-report] 🚨 report_trade_channel 값이 유효하지 않다: ${JSON.stringify(cfg.channel)} ` +
        `— 허용: ${REPORT_CHANNELS.join('|')}. 리포트를 전송하지 않고 last_sent_at 도 갱신하지 않는다`,
      );
      return NextResponse.json({ ok: false, skipped: 'channel_invalid', channel: cfg.channel });
    }

    if (!force) {
      if (!cfg.enabled) return NextResponse.json({ ok: true, skipped: 'disabled' });
      if (cfg.channel === 'none') return NextResponse.json({ ok: true, skipped: 'channel_none' });
      // 주말·공휴일(한국 거래 비개장일) → 발송 생략
      if (!await isTradingDay(new Date())) {
        return NextResponse.json({ ok: true, skipped: 'non_trading_day' });
      }
    }

    const now = new Date();
    const intervalMs = Math.max(1, cfg.intervalMin) * 60_000;
    const last = cfg.lastSentAt;

    if (!force) {
      if (cfg.mode === 'fixed') {
        const anchors = parseAnchorList(cfg.anchorKst);
        if (anchors.length === 0) {
          return NextResponse.json({ ok: true, skipped: 'fixed_mode_no_anchor' });
        }
        if (!shouldFireAtAnchorList(anchors, last, now)) {
          return NextResponse.json({ ok: true, skipped: 'anchor_not_due' });
        }
      } else {
        if (last && now.getTime() - last.getTime() < intervalMs) {
          return NextResponse.json({ ok: true, skipped: 'too_early', lastSentAt: last.toISOString() });
        }
      }
    }

    const rawRangeStart = last ?? new Date(now.getTime() - intervalMs);
    const lookbackFloor = new Date(now.getTime() - MAX_RANGE_LOOKBACK_MS);
    const rangeCapped = rawRangeStart.getTime() < lookbackFloor.getTime();
    if (rangeCapped) {
      console.warn(
        `[cron/trade-report] rangeStart ${rawRangeStart.toISOString()} 가 ${MAX_RANGE_LOOKBACK_MS / 86_400_000}일 한도를 초과 — ${lookbackFloor.toISOString()} 로 절단`,
      );
    }
    const rangeStart = rangeCapped ? lookbackFloor : rawRangeStart;
    const rangeEnd = now;

    // T-033 — 평가 깔때기(`getEvalFunnelSummary`)를 리포트에서 제거하고 리서치분석 요약으로 교체.
    // 깔때기 자체는 대시보드가 `eval-funnel-query` 로 계속 소비하므로 그 모듈은 그대로 둔다.
    // 🔴 여기서 오는 리서치 추천은 **메시지 문자열로만** 흘러간다 —
    //    `createSignal()`·`submitOrder()`·전략 엔진 어디에도 연결되지 않는다.
    const [totalKRW, baselineKRW, candidates, research] = await Promise.all([
      // T-056: 모르면 null — 예전 `.catch(() => 0)` 은 "총 자산 0원(-100%)"을 리포트에 적을 수 있었다.
      getPortfolioTotalState(true).then(t => (t.status === 'ok' ? t.krw : null)).catch(() => null),
      fetchPortfolioBaselineKRW(rangeStart),
      fetchSignalCandidates(rangeStart).catch(() => EMPTY_CANDIDATES),
      fetchResearchDigest().catch(() => EMPTY_RESEARCH_DIGEST),
    ]);

    const report = await buildTradeReport({ rangeStart, rangeEnd, totalKRW, baselineKRW });
    // 한글 종목명은 쿼리 1번으로 모아 받는다. 실패해도 던지지 않고 심볼 코드로 폴백한다.
    const labels = await getSymbolLabels(collectReportSymbols(report, candidates, research));
    const body = formatReportMessage(report, totalKRW, baselineKRW, candidates, research, labels);
    const hours = Math.round((rangeEnd.getTime() - rangeStart.getTime()) / 3600_000);
    const title = `거래 리포트 (${hours}h)`;

    const sendChannel: ReportChannel = force ? (cfg.channel === 'none' ? 'slack' : cfg.channel) : cfg.channel;
    const sendTitle = force ? `[테스트] ${title}` : title;
    const attempts: { channel: SendTarget; result: NotifyResult }[] = [];

    if (sendChannel === 'slack' || sendChannel === 'both') {
      attempts.push({ channel: 'slack', result: await trySend(() => sendSlackAlert('info', sendTitle, body)) });
    }
    if (sendChannel === 'telegram' || sendChannel === 'both') {
      // body 는 Slack mrkdwn(`*굵게*`) 포맷이라 텔레그램(parse_mode=HTML)에선 별표가 그대로 노출된다.
      // Slack 으로 가는 body 는 손대지 않고, 텔레그램 전송분만 HTML 로 변환한다.
      attempts.push({ channel: 'telegram', result: await trySend(() => sendTelegramAlert('info', sendTitle, mrkdwnToTelegramHtml(body))) });
    }

    const delivered    = attempts.filter(a => a.result.ok).map(a => a.channel);
    const failed       = attempts.filter(a => !a.result.ok && !a.result.skipped)
                                 .map(a => ({ channel: a.channel, error: a.result.error ?? 'unknown' }));
    const unconfigured = attempts.filter(a => a.result.skipped).map(a => a.channel);

    // `sent` = **실제로 사용자에게 도달했는가**. 한 채널이라도 배달되면 true.
    // 'both' 부분 성공(slack ✅ / telegram ❌)은 sent:true + partial:true 로 표기하고
    // 실패 채널을 `failed[]` 로 그대로 노출한다.
    const sent = delivered.length > 0;

    // 전송 대상 채널이 0개 — 위 isReportChannel 게이트를 통과했다면 도달 불가능한 상태다.
    // 그래도 조용히 넘기지 않는다: 도달했다는 건 게이트와 분기 조건이 어긋났다는 뜻이고,
    // 증상은 "아무것도 안 보냈는데 정상 종료"라 추적 불가능해진다.
    const noTarget = attempts.length === 0;
    if (noTarget) {
      console.error(
        `[cron/trade-report] 🚨 전송 대상 채널 0개 — sendChannel=${JSON.stringify(sendChannel)}. ` +
        '리포트를 아무 데도 보내지 않았다. last_sent_at 을 갱신하지 않아 구간 이력은 보존된다',
      );
    }

    // last_sent_at 갱신 규칙 — "재시도로 달라질 수 있는 실패"일 때만 갱신을 보류한다.
    //  · 하나라도 배달됨            → 갱신. (보류하면 성공한 채널이 5분마다 중복 발송되어 스팸이 된다)
    //  · 전부 미설정(skipped)       → 갱신. 재시도해도 결과가 같아 무한 재시도만 남는다.
    //  · 배달 0 + 실패 1건 이상     → **보류**. 다음 5분 tick 이 자연스럽게 재시도한다.
    //  · 전송 시도 자체가 0건       → **보류**. 도달 불가 상태이므로 재시도 비용 논거가 성립하지 않고,
    //                                구간 이력을 버리지 않는 쪽(보수적)으로 실패한다.
    const retryable = delivered.length === 0 && failed.length > 0;
    const advanced = !force && !retryable && !noTarget;
    if (advanced) await setLastSent(now);

    if (failed.length > 0 || (attempts.length > 0 && !sent)) {
      console.error(
        `[cron/trade-report] 전송 실패 — sent=${sent} ` +
        `delivered=[${delivered.join(',') || '-'}] ` +
        `failed=[${failed.map(f => `${f.channel}:${f.error}`).join(' | ') || '-'}] ` +
        `unconfigured=[${unconfigured.join(',') || '-'}] ` +
        `last_sent_at=${advanced ? '갱신' : force ? '미갱신(force)' : '미갱신 — 다음 tick 재시도'}`,
      );
    }

    return NextResponse.json({
      ok: true, sent, channel: cfg.channel,
      partial: sent && failed.length > 0,
      delivered, failed, unconfigured,
      noTargetChannel: noTarget,
      lastSentAtAdvanced: advanced,
      rangeStart: rangeStart.toISOString(), rangeEnd: rangeEnd.toISOString(),
      rangeCapped,
      buys: report.buys, sells: report.sells,
      headerPnlKRW: Math.round(report.headerPnlKRW),
      // T-086 — lifoPnlKRW 는 원가를 아는 매도분만의 합이다. 부분합인지 아래 두 값으로 함께 드러낸다.
      lifoPnlKRW: Math.round(report.lifoPnlKRW),
      unmatchedSellCount: report.unmatchedSellCount,
      matchedSellCount: report.matchedSellCount,
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[cron/trade-report]', error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
