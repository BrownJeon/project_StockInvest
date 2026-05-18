import { ping } from '@/lib/db';
import { isDryRun } from '@/lib/safety/dry-run';
import { isKillSwitchActive } from '@/lib/safety/kill-switch';
import { getEffectiveDailyMax, getEffectiveOrderMax } from '@/lib/safety/order-limits';
import { getRouterConfig, isAnalystEnabled } from '@/lib/signals/router';

export const dynamic = 'force-dynamic';

function fmtLimit(v: number): number | null {
  return v === Infinity ? null : Math.round(v);
}

export async function GET() {
  const [dbOk, signalCfg, analystOn, dryRun, killSwitch,
    orderMaxDom, orderMaxOvs, dailyMaxDom, dailyMaxOvs] = await Promise.all([
    ping(),
    getRouterConfig(),
    isAnalystEnabled(),
    isDryRun(),
    isKillSwitchActive(),
    getEffectiveOrderMax(undefined, 'domestic').catch(() => Infinity),
    getEffectiveOrderMax(undefined, 'overseas').catch(() => Infinity),
    getEffectiveDailyMax(undefined, 'domestic').catch(() => Infinity),
    getEffectiveDailyMax(undefined, 'overseas').catch(() => Infinity),
  ]);
  return Response.json({
    ok: true,
    db: dbOk,
    safety: {
      dryRun,
      killSwitch,
      orderMax: {
        domestic: fmtLimit(orderMaxDom),
        overseas: fmtLimit(orderMaxOvs),
      },
      dailyMax: {
        domestic: fmtLimit(dailyMaxDom),
        overseas: fmtLimit(dailyMaxOvs),
      },
    },
    signal: {
      defaultTtlMin: signalCfg.defaultTtlMin,
      analystEnabled: analystOn,
    },
    time: new Date().toISOString(),
  });
}
