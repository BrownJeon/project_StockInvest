import { ensureSetup, getSetupFatalError, ping } from '@/lib/db';
import { isAuthConfigured } from '@/lib/auth/session';
import { isDryRun } from '@/lib/safety/dry-run';
import { isKillSwitchActive } from '@/lib/safety/kill-switch';
import { isBuyLimitConfigured } from '@/lib/safety/buy-limit-config';
import {
  getDailyMaxPct,
  getEffectiveDailyMax,
  getEffectiveOrderMax,
  getOrderMaxPct,
} from '@/lib/safety/order-limits';
import { getEngineSwitches, getRouterConfig } from '@/lib/signals/router';

export const dynamic = 'force-dynamic';

/**
 * GET /api/health — 무인증 통과 라우트 (middleware 예외).
 *
 * CI health check + 외부 모니터가 호출하므로 **수치는 일절 노출하지 않는다**.
 *  - 크리덴셜 값은 물론이고, 실효 한도 "금액"(KRW)과 한도 pct 도 제외한다.
 *    (2026-08-02 감사 지적: 한도금액 ÷ (pct/100) 로 포트폴리오 총 평가액을 역산할 수 있었다)
 *  - 대신 "설정됨/미설정" boolean 과 종합 green/red 만 노출한다.
 */
export async function GET() {
  // 부팅 검증(signals.status ENUM 대조)이 끝난 뒤 판정해야 schemaFatal 이 첫 호출부터 보인다.
  await ensureSetup().catch(() => { /* 실패 사유는 getSetupFatalError 로 읽는다 */ });

  const [dbOk, signalCfg, switches, dryRun, killSwitch,
    orderMaxPct, dailyMaxPct,
    orderMaxDom, orderMaxOvs, dailyMaxDom, dailyMaxOvs] = await Promise.all([
    ping(),
    getRouterConfig(),
    getEngineSwitches(),
    isDryRun(),
    isKillSwitchActive(),
    getOrderMaxPct().catch(() => 0),
    getDailyMaxPct().catch(() => 0),
    getEffectiveOrderMax(undefined, 'domestic').catch(() => 0),
    getEffectiveOrderMax(undefined, 'overseas').catch(() => 0),
    getEffectiveDailyMax(undefined, 'domestic').catch(() => 0),
    getEffectiveDailyMax(undefined, 'overseas').catch(() => 0),
  ]);

  // 한도 pct가 DB에 설정돼 있는가 (값 자체는 노출하지 않는다)
  const limitsConfigured     = isBuyLimitConfigured(orderMaxPct) && isBuyLimitConfigured(dailyMaxPct);
  const authConfigured       = isAuthConfigured();
  const cronSecretConfigured = !!(process.env.CRON_SECRET ?? '').trim();

  // 실효 한도가 실제로 산출되는가 (0 이면 포트폴리오 평가액 조회 실패 등으로 매수 전면 차단 상태).
  // 금액은 노출하지 않고 "양수인지" 여부만 시장별로 알린다.
  const effectiveLimitsResolved = {
    domestic: isBuyLimitConfigured(orderMaxDom) && isBuyLimitConfigured(dailyMaxDom),
    overseas: isBuyLimitConfigured(orderMaxOvs) && isBuyLimitConfigured(dailyMaxOvs),
  };

  // green/red 종합 판정. 값이 아니라 "구성 결함"만 본다.
  // dryRun/killSwitch 는 안전 방향의 상태이므로 red 사유로 삼지 않는다.
  // 코드-DB 스키마 불일치로 부팅 검증이 실패하면 이 프로세스는 아무것도 쓰지 못한다 (fail-closed).
  const schemaFatal = getSetupFatalError() != null;
  const reasons: string[] = [];
  if (schemaFatal)           reasons.push('schema_verification_failed');
  if (!limitsConfigured)     reasons.push('order_limits_unconfigured');
  if (!authConfigured)       reasons.push('auth_pin_unconfigured');
  if (!cronSecretConfigured) reasons.push('cron_secret_unconfigured');
  if (!dbOk)                 reasons.push('db_unreachable');
  const safetyStatus: 'green' | 'red' = reasons.length === 0 ? 'green' : 'red';

  // ⚠️ `ok` 는 스키마 치명 상태를 반드시 반영해야 한다 (reviewer #3).
  //    HTTP 200 + ok:true 만 보는 단순 모니터가 "DB 계층이 죽은 앱"을 정상으로 읽으면 안 된다.
  return Response.json({
    ok: !schemaFatal,
    db: dbOk,
    schemaFatal,
    safetyStatus,
    safetyReasons: reasons,
    safety: {
      dryRun,
      killSwitch,
      limitsConfigured,
      effectiveLimitsResolved,
      authConfigured,
      cronSecretConfigured,
    },
    signal: {
      defaultTtlMin: signalCfg.defaultTtlMin,
      /** @deprecated engine.enabled 로 대체 — 기존 모니터 호환용으로 유지 */
      analystEnabled: switches.engineEnabled,
    },
    engine: {
      enabled: switches.engineEnabled,
      autopilotMode: switches.autopilotMode,
      switchSource: switches.source,
    },
    time: new Date().toISOString(),
  }, { status: schemaFatal ? 503 : 200 });
}
