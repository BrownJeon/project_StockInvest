import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { getPortfolioTotalKRW } from '@/lib/safety/portfolio-total';
import { sendSlackAlert } from '@/lib/notify/slack';
import { sendTelegramAlert } from '@/lib/notify/telegram';
import { buildTradeReport, formatReportMessage, fetchPortfolioBaselineKRW, fetchSignalCandidates } from '@/lib/reports/trade-report';
import { parseAnchorList, shouldFireAtAnchorList } from '@/lib/reports/anchor';
import { isTradingDay } from '@/lib/reports/trading-day';

export const dynamic = 'force-dynamic';

import { checkCronAuth } from '@/lib/cron-auth';

type ReportChannel = 'slack' | 'telegram' | 'both' | 'none';
type ReportMode = 'rolling' | 'fixed';

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

    const rangeStart = last ?? new Date(now.getTime() - intervalMs);
    const rangeEnd = now;

    const [totalKRW, baselineKRW, candidates] = await Promise.all([
      getPortfolioTotalKRW(true).catch(() => 0),
      fetchPortfolioBaselineKRW(rangeStart),
      fetchSignalCandidates().catch(() => ({ buyWatchlist: [], holdings: [], sellPnl: [] })),
    ]);

    const report = await buildTradeReport({ rangeStart, rangeEnd, totalKRW, baselineKRW });
    const body = formatReportMessage(report, totalKRW, baselineKRW, candidates);
    const hours = Math.round((rangeEnd.getTime() - rangeStart.getTime()) / 3600_000);
    const title = `거래 리포트 (${hours}h)`;

    const sendChannel: ReportChannel = force ? (cfg.channel === 'none' ? 'slack' : cfg.channel) : cfg.channel;
    if (sendChannel === 'slack' || sendChannel === 'both') {
      await sendSlackAlert('info', force ? `[테스트] ${title}` : title, body).catch(e => console.error('[trade-report] slack:', e));
    }
    if (sendChannel === 'telegram' || sendChannel === 'both') {
      await sendTelegramAlert('info', force ? `[테스트] ${title}` : title, body).catch(e => console.error('[trade-report] telegram:', e));
    }

    if (!force) await setLastSent(now);

    return NextResponse.json({
      ok: true, sent: true, channel: cfg.channel,
      rangeStart: rangeStart.toISOString(), rangeEnd: rangeEnd.toISOString(),
      buys: report.buys, sells: report.sells,
      headerPnlKRW: Math.round(report.headerPnlKRW),
      lifoPnlKRW: Math.round(report.lifoPnlKRW),
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[cron/trade-report]', error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
