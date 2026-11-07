import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { isDryRun } from '@/lib/safety/dry-run';
import { parseBuyLimit, UNLIMITED_BUY_LIMIT } from '@/lib/safety/buy-limit-config';
import { isOverseasEnabled } from '@/lib/exchanges/market-flags';
import { syncEngineSwitchesFromLegacy } from '@/lib/signals/router';
import { readExitEngineSwitch, describeExitEngineSwitch } from '@/lib/strategy/exit-switch';
import {
  KIS_RATE_LIMIT_KEY, DEFAULT_RATE_PER_SEC, clampRatePerSec, describeKisThrottle,
} from '@/lib/exchanges/kis-throttle';

export const dynamic = 'force-dynamic';

/**
 * T-101 — 해외 장마감 후 분석 스위치 키. 엔진 상수(`POST_MARKET_OVERSEAS_SWITCH_KEY`)와 같은 문자열을
 * **리터럴로** 둔다 — 이 라우트(KILL_SWITCH·DRY_RUN 긴급 제어)가 엔진 모듈 트리(llm·rag·텔레그램·시그널)를
 * 정적으로 끌어오지 않게 하려는 것. 두 값의 일치는 시험이 고정한다(PATCH 가 쓴 키 == 엔진 상수, 어긋나면 실패).
 * export 하지 않는다 — App Router route 파일은 HTTP 메서드·라우트 설정 외의 export 를 빌드 타입 검사에서 거부한다.
 */
const POST_MARKET_OVERSEAS_KEY = 'post_market_overseas_enabled';

// Match parseBuyLimit on persisted JSON. Compare strings case-sensitively.
const STORED_UNLIMITED = `(JSON_TYPE(value) = 'STRING' AND BINARY JSON_UNQUOTE(value) = '${UNLIMITED_BUY_LIMIT}')
  OR (JSON_TYPE(value) = 'OBJECT' AND JSON_LENGTH(value) = 1
      AND JSON_TYPE(JSON_EXTRACT(value, '$.unlimitedPrevious')) = 'STRING')`;

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
  const orderLimit = parseBuyLimit(overrides['safety_order_max_pct']);
  const dailyLimit = parseBuyLimit(overrides['safety_daily_order_max_pct']);
  const orderMaxPct = orderLimit === UNLIMITED_BUY_LIMIT ? 0 : orderLimit;
  const dailyOrderMaxPct = dailyLimit === UNLIMITED_BUY_LIMIT ? 0 : dailyLimit;
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
  // (T-143 WP-A) 해외 분석 대상(수동 목록 변경 제안 · 자동 NYSE 상위 목록 변동) 알림. 꺼져 있으면 **텔레그램만** 멈춘다 —
  //   홈 「확인 필요」의 제안 줄은 제안 행 존재로 독립 동작하므로 이 토글과 무관하게 늘 나온다(가이드 §7.3).
  //   키 이름은 `notify_signal_%` LIKE 패턴 안이라 `getOverrides()` 가 이미 읽어 온다(별도 조회 없음).
  const notifySignalUniverse   = overrides['notify_signal_universe']    !== undefined ? Boolean(overrides['notify_signal_universe'])    : true;

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

  /**
   * T-101 — 해외 장마감 후 분석 스위치. **엔진(`runPostMarketOverseas`)이 부르는 판독기 그대로** 읽는다
   * (키 없음·정확히 JSON `true` 외 값·읽기 오류 = 꺼짐). `getOverrides()` 를 거치지 않는 이유: 거기서
   * 한 번 `JSON.parse` 한 값을 다시 판정하면 문자열 `"true"`(저장 값 `"\"true\""`)가 켜짐으로 읽혀
   * 화면과 엔진이 갈라진다.
   */
  //   엔진 모듈은 **GET 안에서만 지연 import** 한다. import·판독이 어떤 이유로든 실패하면 꺼짐(false)으로
  //   보여 주고 나머지 응답(긴급 제어 값)은 그대로 돌려준다 — 이 라우트의 성공을 엔진 모듈 로드에 묶지 않는다.
  let postMarketOverseasEnabled = false;
  try {
    const engine = await import('@/lib/strategy/post-market-overseas');
    postMarketOverseasEnabled = (await engine.readPostMarketOverseasSwitch()).enabled === true;
  } catch (e) {
    postMarketOverseasEnabled = false;
    console.error(`[settings:safety] 해외 장마감 후 분석 스위치 판독 실패 — 꺼짐으로 표시: ${e instanceof Error ? e.message : String(e)}`);
  }

  /**
   * T-017 — KIS 요청 유량. `getOverrides()` 의 LIKE 패턴(safety_%/strategy_%/…) 밖의 키라
   * 별도로 읽는다. **재배포 없이 조정**하기 위한 값이며 KIS 공표 한도가 아니다.
   */
  let kisRateLimitPerSec = DEFAULT_RATE_PER_SEC;
  try {
    const [rows] = await pool.query<(RowDataPacket & { value: string })[]>(
      'SELECT value FROM system_config WHERE `key` = ? LIMIT 1', [KIS_RATE_LIMIT_KEY],
    );
    if (rows.length > 0) {
      let decoded: unknown = String(rows[0].value);
      try { decoded = JSON.parse(String(rows[0].value)); } catch { /* 비 JSON 원문 */ }
      const n = Number(decoded);
      if (Number.isFinite(n) && n > 0) kisRateLimitPerSec = clampRatePerSec(n);
    }
  } catch { /* 조회 실패 시 코드 기본값 표시 */ }

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
      orderMaxUnlimited: orderLimit === UNLIMITED_BUY_LIMIT,
      dailyOrderMaxUnlimited: dailyLimit === UNLIMITED_BUY_LIMIT,
      universeEnabled,
      analystEnabled,
      /** T-101 — 해외 장마감 후 분석(미국 정규장이 열린 날의 다음 날 아침 08:00 KST 미국 시나리오) on/off. 엔진과 같은 판정. */
      postMarketOverseasEnabled,
      blockedSymbols,
      blockedSymbolsOverseas,
      volGuardEnabled,
      volGuardWindowMin,
      volGuardWarnPct,
      volGuardBlockPct,
      volGuardPanicPct,
      /** KIS 초당 요청 상한 — **검증되지 않은 추정치**. 조정 후 EGW00201 발생량을 보고 단계적으로 올린다. */
      kisRateLimitPerSec,
      kisRateLimitSummary: describeKisThrottle(),
    },
    notifySignal: {
      autoSubmit: notifySignalAutoSubmit,
      pending:    notifySignalPending,
      entry:      notifySignalEntry,
      manual:     notifySignalManual,
      universe:   notifySignalUniverse,
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
        overseasEnabled: isOverseasEnabled(),   // T-056 — 잔고·스냅샷 가드와 같은 판정식 하나
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
  // T-101 — 해외 장마감 후 분석 스위치. 키는 엔진 상수와 같은 리터럴(위 POST_MARKET_OVERSEAS_KEY, 시험이 일치 고정).
  postMarketOverseasEnabled: POST_MARKET_OVERSEAS_KEY,
  blockedSymbols:          'safety_blocked_symbols',
  blockedSymbolsOverseas:  'safety_blocked_symbols_overseas',
  volGuardEnabled:         'vol_guard_enabled',
  volGuardWindowMin:       'vol_guard_window_min',
  volGuardWarnPct:         'vol_guard_warn_pct',
  volGuardBlockPct:        'vol_guard_block_pct',
  volGuardPanicPct:        'vol_guard_panic_pct',
  // T-017 — 재배포 없이 KIS 유량을 조정하는 유일한 지원 경로 (수기 DB 수정 대신 이 API 사용).
  kisRateLimitPerSec:      'kis_rate_limit_per_sec',
  reportEnabled:           'report_trade_enabled',
  reportChannel:           'report_trade_channel',
  reportMode:              'report_trade_mode',
  reportIntervalMin:       'report_trade_interval_min',
  reportAnchorKst:         'report_trade_anchor_kst',
  notifySignalAutoSubmit:  'notify_signal_auto_submit',
  notifySignalPending:     'notify_signal_pending',
  notifySignalEntry:       'notify_signal_entry',
  notifySignalManual:      'notify_signal_manual',
  // (T-143 WP-A) 판독기는 `src/lib/universe/refresh-notify.ts` 의 NOTIFY_UNIVERSE_KEY — 같은 리터럴이어야 한다
  notifySignalUniverse:    'notify_signal_universe',
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
const PATCH_STRICT_BOOLEANS = ['exitEngineEnabled', 'postMarketOverseasEnabled'] as const;

/**
 * 수치 도메인이 고정된 필드 — 저장 전 검증.
 *
 * `kisRateLimitPerSec` 는 오타 하나로 시스템을 멈추거나(`0`) 레이트리밋을 다시 유발할
 * 수(`500`) 있다. 판독기(`kis-throttle.clampRatePerSec`)가 방어하긴 하지만, **저장된 값과
 * 실제 동작이 달라지는 상태**를 애초에 만들지 않는다.
 */
const PATCH_NUMBER_RANGES: Record<string, { min: number; max: number }> = {
  kisRateLimitPerSec: { min: 0.2, max: 50 },
};

export async function PATCH(req: NextRequest) {
  const body = await req.json() as Record<string, unknown>;
  const pool = getPool();

  // 검증을 전량 선행한다 — 중간에 거절하면 앞 필드만 저장된 부분 반영 상태가 남는다.
  const invalid = Object.entries(PATCH_ENUMS)
    .filter(([field]) => field in body)
    .filter(([field, allowed]) => !allowed.includes(String(body[field])))
    .map(([field, allowed]) => `${field}=${JSON.stringify(body[field])} (허용: ${allowed.join('|')})`);
  const limitFields = ['orderMaxPct', 'dailyOrderMaxPct'];
  const explicitEdits = body.buyLimitEdits;
  const limitWrites: Array<[string, string]> = [];
  if ('buyLimitEdits' in body) {
    if (req.headers.get('sec-fetch-site') !== 'same-origin') {
      return NextResponse.json({ ok: false, error: '같은 사이트의 설정 화면에서 매수 한도를 변경하세요.' }, { status: 403 });
    }
    const separateFields = [...limitFields, 'dryRun', 'killSwitch', 'exitEngineEnabled', 'postMarketOverseasEnabled'];
    if (separateFields.some(field => field in body) || !explicitEdits || typeof explicitEdits !== 'object' || Array.isArray(explicitEdits)
      || Object.keys(explicitEdits).length === 0) {
      invalid.push('buyLimitEdits 형식 오류');
    } else {
      for (const [field, value] of Object.entries(explicitEdits)) {
        if (!limitFields.includes(field) || typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
          invalid.push('매수 한도는 0 이상의 유한한 숫자로 지정하세요.');
        } else {
          limitWrites.push([ALLOWED_PATCH_KEYS[field], JSON.stringify(value === 0 ? UNLIMITED_BUY_LIMIT : value)]);
        }
      }
    }
  }
  for (const field of limitFields) {
    if (!(field in body)) continue;
    const value = body[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) invalid.push(`${field} 형식 오류`);
  }
  for (const field of PATCH_STRICT_BOOLEANS) {
    if (field in body && typeof body[field] !== 'boolean') {
      invalid.push(`${field}=${JSON.stringify(body[field])} (허용: true|false)`);
    }
  }
  for (const [field, range] of Object.entries(PATCH_NUMBER_RANGES)) {
    if (!(field in body)) continue;
    const n = Number(body[field]);
    if (typeof body[field] !== 'number' || !Number.isFinite(n) || n < range.min || n > range.max) {
      invalid.push(`${field}=${JSON.stringify(body[field])} (허용: ${range.min}~${range.max} 사이 숫자)`);
    }
  }
  if (invalid.length > 0) {
    return NextResponse.json(
      { ok: false, error: `잘못된 설정 값 — ${invalid.join(', ')}` },
      { status: 400 },
    );
  }

  if (limitWrites.length > 0) {
    // The settings save button can apply both limits and other safety settings.
    // One statement makes that save atomic if any row fails validation in MariaDB.
    const writes = [...limitWrites];
    for (const [field, key] of Object.entries(ALLOWED_PATCH_KEYS)) {
      if (field in body) writes.push([key, JSON.stringify(body[field])]);
    }
    await pool.query(
      `INSERT INTO system_config (\`key\`, value) VALUES ${writes.map(() => '(?, ?)').join(', ')}
       ON DUPLICATE KEY UPDATE value = CASE
         WHEN VALUES(\`key\`) NOT IN ('safety_order_max_pct', 'safety_daily_order_max_pct')
           OR BINARY JSON_UNQUOTE(VALUES(value)) <> '${UNLIMITED_BUY_LIMIT}' THEN VALUES(value)
         WHEN ${STORED_UNLIMITED} THEN value
         WHEN VALUES(\`key\`) = 'safety_order_max_pct' THEN JSON_OBJECT('unlimitedPrevious', CAST(value AS CHAR))
         ELSE VALUES(value)
       END`,
      writes.flat(),
    );
    if (Object.keys(body).length === 1) return NextResponse.json({ ok: true });
  } else {
    for (const [field, dbKey] of Object.entries(ALLOWED_PATCH_KEYS)) {
      if (field in body) {
        const val = body[field];
        // A stale bulk save may carry either zero or the old positive limit.
        await pool.query(
          `INSERT INTO system_config (\`key\`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value =
            ${limitFields.includes(field) ? `CASE WHEN ${STORED_UNLIMITED} THEN value ELSE VALUES(value) END` : 'VALUES(value)'}`,
          [dbKey, JSON.stringify(val)],
        );
      }
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

  // T-101 — 해외 장마감 후 분석 스위치 변경도 서버 로그에 남긴다(주문은 하지 않음 — 시나리오 카드 생성 여부만).
  if ('postMarketOverseasEnabled' in body) {
    console.warn(
      `[settings:safety] 해외 장마감 후 분석 ${body['postMarketOverseasEnabled'] === true ? 'ON — 미국 정규장이 열린 날의 다음 날 아침 08:00(KST) 미국 종목 시나리오 생성' : 'OFF — 미국 종목 시나리오 생성 중단'}`
      + ` (system_config.${POST_MARKET_OVERSEAS_KEY})`,
    );
  }

  // T-017 — 유량 변경은 KIS 호출 실패율에 직결되므로 서버 로그에 남긴다.
  //   실제 반영은 kis-throttle 이 최대 15초 주기로 재조회하며 자동으로 이뤄진다(재배포 불필요).
  if ('kisRateLimitPerSec' in body) {
    console.warn(
      `[settings:safety] KIS 요청 유량 → ${Number(body['kisRateLimitPerSec'])} req/s `
      + `(system_config.${'kis_rate_limit_per_sec'}) — 최대 15초 내 반영. `
      + '※ 공표 한도가 아닌 추정치이므로 상향 후 EGW00201/EGW00215 발생량을 확인할 것.',
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
