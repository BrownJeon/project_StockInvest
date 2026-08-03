import { ping } from '@/lib/db';
import { isAuthConfigured } from '@/lib/auth/session';
import { isDryRun } from '@/lib/safety/dry-run';
import { isKillSwitchActive } from '@/lib/safety/kill-switch';
import {
  getDailyMaxPct,
  getEffectiveDailyMax,
  getEffectiveOrderMax,
  getOrderMaxPct,
} from '@/lib/safety/order-limits';
import { getRouterConfig, isAnalystEnabled } from '@/lib/signals/router';

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
  const [dbOk, signalCfg, analystOn, dryRun, killSwitch,
    orderMaxPct, dailyMaxPct,
    orderMaxDom, orderMaxOvs, dailyMaxDom, dailyMaxOvs] = await Promise.all([
    ping(),
    getRouterConfig(),
    isAnalystEnabled(),
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
  const limitsConfigured     = orderMaxPct > 0 && dailyMaxPct > 0;
  const authConfigured       = isAuthConfigured();
  const cronSecretConfigured = !!(process.env.CRON_SECRET ?? '').trim();

  // 실효 한도가 실제로 산출되는가 (0 이면 포트폴리오 평가액 조회 실패 등으로 매수 전면 차단 상태).
  // 금액은 노출하지 않고 "양수인지" 여부만 시장별로 알린다.
  const effectiveLimitsResolved = {
    domestic: orderMaxDom > 0 && dailyMaxDom > 0,
    overseas: orderMaxOvs > 0 && dailyMaxOvs > 0,
  };

  // green/red 종합 판정. 값이 아니라 "구성 결함"만 본다.
  // dryRun/killSwitch 는 안전 방향의 상태이므로 red 사유로 삼지 않는다.
  const reasons: string[] = [];
  if (!limitsConfigured)     reasons.push('order_limits_unconfigured');
  if (!authConfigured)       reasons.push('auth_pin_unconfigured');
  if (!cronSecretConfigured) reasons.push('cron_secret_unconfigured');
  if (!dbOk)                 reasons.push('db_unreachable');
  const safetyStatus: 'green' | 'red' = reasons.length === 0 ? 'green' : 'red';

  return Response.json({
    ok: true,
    db: dbOk,
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
      analystEnabled: analystOn,
    },
    time: new Date().toISOString(),
  });
}
