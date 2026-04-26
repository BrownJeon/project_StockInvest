import { ping } from '@/lib/db';
import { isDryRun } from '@/lib/safety/dry-run';
import { isKillSwitchActive } from '@/lib/safety/kill-switch';
import { getRouterConfig, isAnalystEnabled } from '@/lib/signals/router';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [dbOk, signalCfg, analystOn] = await Promise.all([
    ping(),
    getRouterConfig(),
    isAnalystEnabled(),
  ]);
  return Response.json({
    ok: true,
    db: dbOk,
    safety: {
      dryRun: await isDryRun(),
      killSwitch: await isKillSwitchActive(),
      orderMaxKRW: Number(process.env.ORDER_MAX_KRW ?? 0),
      dailyOrderMaxKRW: Number(process.env.DAILY_ORDER_MAX_KRW ?? 0),
      blockedSymbols: [],
    },
    signal: {
      defaultTtlMin: signalCfg.defaultTtlMin,
      analystEnabled: analystOn,
    },
    time: new Date().toISOString(),
  });
}
