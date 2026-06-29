import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { isDryRun } from '@/lib/safety/dry-run';

export const dynamic = 'force-dynamic';

async function getOverrides(): Promise<Record<string, unknown>> {
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { key: string; value: string })[]>(
      "SELECT `key`, value FROM system_config WHERE `key` LIKE 'safety_%' OR `key` LIKE 'strategy_%' OR `key` LIKE 'vol_guard_%' OR `key` LIKE 'report_trade_%' OR `key` LIKE 'notify_signal_%'",
    );
    return Object.fromEntries(rows.map(r => [r.key, JSON.parse(r.value)]));
  } catch {
    return {};
  }
}

async function seedIfEmpty(pool: ReturnType<typeof import('@/lib/db')['getPool']>, resolved: Record<string, unknown>): Promise<void> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS cnt FROM system_config WHERE `key` LIKE 'safety_%'",
    );
    if (Number((rows[0] as { cnt: number }).cnt) > 0) return;
    const seedKeys: Record<string, unknown> = {
      safety_dry_run:            resolved['dryRun'],
      safety_kill_switch:        resolved['killSwitch'],
      safety_order_max_pct:      resolved['orderMaxPct'],
      safety_daily_order_max_pct: resolved['dailyOrderMaxPct'],
      safety_blocked_symbols:    resolved['blockedSymbols'],
    };
    for (const [k, v] of Object.entries(seedKeys)) {
      await pool.query(
        'INSERT INTO system_config (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [k, JSON.stringify(v)],
      );
    }
  } catch { /* non-fatal */ }
}

export async function GET() {
  const overrides = await getOverrides();
  const pool = getPool();

  // isDryRun() 가 DB override → env 폴백 순서로 SSOT 처리함 (직접 env 비교 제거)
  const dryRun           = await isDryRun();
  const killSwitch       = overrides['safety_kill_switch']       !== undefined ? Boolean(overrides['safety_kill_switch'])       : (process.env.KILL_SWITCH === 'true');
  // 정책: 한도는 무조건 설정 메뉴(DB) 값만 기준. .env fallback 제거.
  const orderMaxPct      = overrides['safety_order_max_pct']     !== undefined ? Number(overrides['safety_order_max_pct'])      : 0;
  const dailyOrderMaxPct = overrides['safety_daily_order_max_pct'] !== undefined ? Number(overrides['safety_daily_order_max_pct']) : 0;
  const universeEnabled          = overrides['strategy_universe_enabled']           !== undefined ? Boolean(overrides['strategy_universe_enabled'])           : (process.env.UNIVERSE_ENABLED === 'true');
  const analystEnabled           = overrides['strategy_analyst_enabled']            !== undefined ? Boolean(overrides['strategy_analyst_enabled'])            : (process.env.ANALYST_ENABLED === 'true');
  const blockedSymbols   = overrides['safety_blocked_symbols'] !== undefined
    ? (overrides['safety_blocked_symbols'] as string[])
    : (process.env.BLOCKED_SYMBOLS_DOMESTIC ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const blockedSymbolsOverseas = overrides['safety_blocked_symbols_overseas'] !== undefined
    ? (overrides['safety_blocked_symbols_overseas'] as string[])
    : (process.env.BLOCKED_SYMBOLS_OVERSEAS ?? '').split(',').map(s => s.trim()).filter(Boolean);

  // 시그널 알람 on/off (기본 true — 없으면 알람 발송)
  const notifySignalAutoSubmit = overrides['notify_signal_auto_submit'] !== undefined ? Boolean(overrides['notify_signal_auto_submit']) : true;
  const notifySignalPending    = overrides['notify_signal_pending']     !== undefined ? Boolean(overrides['notify_signal_pending'])     : true;
  const notifySignalEntry      = overrides['notify_signal_entry']       !== undefined ? Boolean(overrides['notify_signal_entry'])       : true;
  const notifySignalManual     = overrides['notify_signal_manual']      !== undefined ? Boolean(overrides['notify_signal_manual'])      : true;

  const volGuardEnabled   = overrides['vol_guard_enabled']    !== undefined ? Boolean(overrides['vol_guard_enabled'])    : (process.env.VOL_GUARD_ENABLED === 'true');
  const volGuardWindowMin = overrides['vol_guard_window_min'] !== undefined ? Number(overrides['vol_guard_window_min'])  : Number(process.env.VOL_GUARD_WINDOW_MIN ?? 60);
  const volGuardWarnPct   = overrides['vol_guard_warn_pct']   !== undefined ? Number(overrides['vol_guard_warn_pct'])   : Number(process.env.VOL_GUARD_WARN_PCT   ?? -2);
  const volGuardBlockPct  = overrides['vol_guard_block_pct']  !== undefined ? Number(overrides['vol_guard_block_pct'])  : Number(process.env.VOL_GUARD_BLOCK_PCT  ?? -4);
  const volGuardPanicPct  = overrides['vol_guard_panic_pct']  !== undefined ? Number(overrides['vol_guard_panic_pct'])  : Number(process.env.VOL_GUARD_PANIC_PCT  ?? -7);

  await seedIfEmpty(pool, { dryRun, killSwitch, orderMaxPct, dailyOrderMaxPct, blockedSymbols });

  return NextResponse.json({
    ok: true,
    safety: {
      dryRun,
      killSwitch,
      orderMaxPct,
      dailyOrderMaxPct,
      universeEnabled,
      analystEnabled,
      blockedSymbols,
      blockedSymbolsOverseas,
      volGuardEnabled,
      volGuardWindowMin,
      volGuardWarnPct,
      volGuardBlockPct,
      volGuardPanicPct,
    },
    notifySignal: {
      autoSubmit: notifySignalAutoSubmit,
      pending:    notifySignalPending,
      entry:      notifySignalEntry,
      manual:     notifySignalManual,
    },
    report: {
      enabled:     overrides['report_trade_enabled']      !== undefined ? Boolean(overrides['report_trade_enabled'])    : false,
      channel:     overrides['report_trade_channel']      !== undefined ? String(overrides['report_trade_channel'])     : 'slack',
      mode:        overrides['report_trade_mode']         !== undefined ? String(overrides['report_trade_mode'])        : 'rolling',
      intervalMin: overrides['report_trade_interval_min'] !== undefined ? Number(overrides['report_trade_interval_min']): 180,
      anchorKst:   overrides['report_trade_anchor_kst']   !== undefined ? (overrides['report_trade_anchor_kst'] as string | null) : null,
      lastSentAt:  overrides['report_trade_last_sent_at'] !== undefined ? (overrides['report_trade_last_sent_at'] as string | null) : null,
    },
    exchanges: {
      kis: {
        configured: !!(process.env.KIS_APP_KEY && process.env.KIS_APP_SECRET && process.env.KIS_ACCOUNT_NO),
        mock: String(process.env.KIS_MOCK ?? 'true').toLowerCase() === 'true',
        overseasEnabled: String(process.env.KIS_OVERSEAS_ENABLED ?? 'true').toLowerCase() === 'true',
      },
    },
  });
}

const ALLOWED_PATCH_KEYS: Record<string, string> = {
  dryRun:                  'safety_dry_run',
  killSwitch:              'safety_kill_switch',
  orderMaxPct:             'safety_order_max_pct',
  dailyOrderMaxPct:        'safety_daily_order_max_pct',
  universeEnabled:         'strategy_universe_enabled',
  analystEnabled:          'strategy_analyst_enabled',
  blockedSymbols:          'safety_blocked_symbols',
  blockedSymbolsOverseas:  'safety_blocked_symbols_overseas',
  volGuardEnabled:         'vol_guard_enabled',
  volGuardWindowMin:       'vol_guard_window_min',
  volGuardWarnPct:         'vol_guard_warn_pct',
  volGuardBlockPct:        'vol_guard_block_pct',
  volGuardPanicPct:        'vol_guard_panic_pct',
  reportEnabled:           'report_trade_enabled',
  reportChannel:           'report_trade_channel',
  reportMode:              'report_trade_mode',
  reportIntervalMin:       'report_trade_interval_min',
  reportAnchorKst:         'report_trade_anchor_kst',
  notifySignalAutoSubmit:  'notify_signal_auto_submit',
  notifySignalPending:     'notify_signal_pending',
  notifySignalEntry:       'notify_signal_entry',
  notifySignalManual:      'notify_signal_manual',
};

// 시장별·KRW 고정 한도 키는 정책 변경(2026-04-26)으로 폐기. 한도는 단일 pct만 사용.
// PATCH 시점에 저장된 값 자동 정리.
const RETIRED_KEYS = [
  'safety_order_max_krw', 'safety_daily_order_max_krw',
  'safety_order_max_domestic_krw', 'safety_order_max_overseas_krw',
  'safety_daily_order_max_domestic_krw', 'safety_daily_order_max_overseas_krw',
  'safety_order_max_domestic_pct', 'safety_order_max_overseas_pct',
  'safety_daily_order_max_domestic_pct', 'safety_daily_order_max_overseas_pct',
];

export async function PATCH(req: NextRequest) {
  const body = await req.json() as Record<string, unknown>;
  const pool = getPool();

  for (const [field, dbKey] of Object.entries(ALLOWED_PATCH_KEYS)) {
    if (field in body) {
      const val = body[field];
      await pool.query(
        'INSERT INTO system_config (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [dbKey, JSON.stringify(val)],
      );
    }
  }

  // 폐기된 시장별·pct 키가 DB에 남아있으면 일괄 삭제 (idempotent)
  if (RETIRED_KEYS.length > 0) {
    await pool.query(
      `DELETE FROM system_config WHERE \`key\` IN (${RETIRED_KEYS.map(() => '?').join(',')})`,
      RETIRED_KEYS,
    ).catch(() => { /* non-fatal */ });
  }

  return NextResponse.json({ ok: true });
}
