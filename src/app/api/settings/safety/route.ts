import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { isDryRun } from '@/lib/safety/dry-run';
import { syncEngineSwitchesFromLegacy } from '@/lib/signals/router';
import { readExitEngineSwitch, describeExitEngineSwitch } from '@/lib/strategy/exit-switch';

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

  /**
   * 🔕 자동 청산 마스터 스위치 — **엔진이 쓰는 것과 똑같은 판독기**로 읽는다.
   *
   * `overrides` 를 통해 원시 값을 따로 해석하지 않는 이유: 그러면 화면이 "키가 없으니 기본
   * 활성이겠지" 같은 자기만의 추정을 하게 되고, 그 추정이 엔진과 어긋나는 순간 화면이
   * **손절이 지켜주고 있다고 거짓말**한다. 판독 로직은 단 하나여야 한다.
   */
  const exitSwitch = await readExitEngineSwitch();

  return NextResponse.json({
    ok: true,
    safety: {
      dryRun,
      killSwitch,
      /** 자동 청산(하드손절·EOD손절·트레일링·목표익절) 전체 on/off */
      exitEngineEnabled: exitSwitch.enabled,
      /** 마스터가 ON 일 때의 하위 hard_stop 스위치 (읽기 전용 표기) */
      exitHardStopEnabled: exitSwitch.hardStopEnabled,
      /** config / absent / unparsable / db_error — 화면이 사유를 그대로 보여줄 수 있게 */
      exitSwitchSource: exitSwitch.source,
      exitSwitchSummary: describeExitEngineSwitch(exitSwitch),
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
  // 🔕 T-015 — 자동 청산 마스터. 되돌릴 수 있어야 스위치다. 다만 **명시적 opt-in** 이라
  //    `true` 로 기입될 때만 자동 매도가 살아난다 (판독은 exit-switch.ts 가 단독 담당).
  //    `exit_hard_stop_enabled`(하위 스위치)는 의도적으로 PATCH 대상에서 제외 — 이번 작업의
  //    범위가 아니고, 값 변경 권한을 넓히지 않는다.
  exitEngineEnabled:       'exit_engine_enabled',
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

/**
 * 값의 도메인이 고정된 필드 — 저장 전 검증.
 *
 * UI `<select>` 는 4개 값으로 제한하지만 PATCH 는 아무 문자열이나 받아 그대로 저장했다.
 * `report_trade_channel` 이 이 목록 밖의 값이 되면 /api/cron/trade-report 가 전송 대상
 * 채널 0개 상태로 빠져 **아무것도 안 보내고 정상 종료**한다 — 흔적 없는 리포트 유실.
 * 라우트 쪽에도 방어 게이트를 뒀지만, 애초에 손상된 값이 써지지 못하게 여기서 막는다.
 */
const PATCH_ENUMS: Record<string, readonly string[]> = {
  reportChannel: ['slack', 'telegram', 'both', 'none'],
  reportMode:    ['rolling', 'fixed'],
};

/**
 * 반드시 순수 불리언으로만 저장되어야 하는 필드.
 *
 * `exit_engine_enabled` 는 "자동 매도를 할 것인가"를 결정한다. `"true"`(문자열)이나 `1` 이
 * 들어가도 판독기(`exit-switch.ts`)가 안전하게 해석하긴 하지만, **자금 스위치의 저장 값이
 * 무엇인지 눈으로 확인 불가능해지는 상태를 애초에 만들지 않는다.**
 */
const PATCH_STRICT_BOOLEANS = ['exitEngineEnabled'] as const;

export async function PATCH(req: NextRequest) {
  const body = await req.json() as Record<string, unknown>;
  const pool = getPool();

  // 검증을 전량 선행한다 — 중간에 거절하면 앞 필드만 저장된 부분 반영 상태가 남는다.
  const invalid = Object.entries(PATCH_ENUMS)
    .filter(([field]) => field in body)
    .filter(([field, allowed]) => !allowed.includes(String(body[field])))
    .map(([field, allowed]) => `${field}=${JSON.stringify(body[field])} (허용: ${allowed.join('|')})`);
  for (const field of PATCH_STRICT_BOOLEANS) {
    if (field in body && typeof body[field] !== 'boolean') {
      invalid.push(`${field}=${JSON.stringify(body[field])} (허용: true|false)`);
    }
  }
  if (invalid.length > 0) {
    return NextResponse.json(
      { ok: false, error: `잘못된 설정 값 — ${invalid.join(', ')}` },
      { status: 400 },
    );
  }

  for (const [field, dbKey] of Object.entries(ALLOWED_PATCH_KEYS)) {
    if (field in body) {
      const val = body[field];
      await pool.query(
        'INSERT INTO system_config (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [dbKey, JSON.stringify(val)],
      );
    }
  }

  // 🔕 자동 청산 스위치 변경은 자금이 오가는 결정이라 서버 로그에 반드시 남긴다.
  if ('exitEngineEnabled' in body) {
    const on = body['exitEngineEnabled'] === true;
    console.warn(
      `[settings:safety] 자동 청산 엔진 ${on ? 'ON — 하드손절·EOD손절·트레일링·목표익절 자동 매도가 다시 활성화됨' : 'OFF — 자동 매도 주문 전면 중단'}`
      + ' (system_config.exit_engine_enabled)',
    );
  }

  // 엔진 마스터 스위치를 바꿨으면 신규 키(engine_enabled·autopilot_mode)도 같은 의미로 맞춘다.
  // 안 하면 UI 토글이 파이프라인에 반영되지 않는 무반응 스위치가 된다 (T-003 D2).
  if ('analystEnabled' in body) {
    await syncEngineSwitchesFromLegacy();
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
