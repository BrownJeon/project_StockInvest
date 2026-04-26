import { kis } from '@/lib/exchanges/kis';
import { simpleRsiMomentum } from '@/lib/analyst/rules';
import { getRouterConfig, isAnalystEnabled } from '@/lib/signals/router';
import { getEffectiveOrderMax } from '@/lib/safety/order-limits';
import { createSignal } from '@/lib/signals/service';

export const dynamic = 'force-dynamic';

const DEFAULT_SYMBOLS = ['005930', '000660'];

export async function POST() {
  try {
    if (!(await isAnalystEnabled())) {
      return Response.json({ ok: false, error: 'ANALYST_ENABLED=false' }, { status: 403 });
    }
    const symbols = DEFAULT_SYMBOLS;

    const cfg = await getRouterConfig();
    const baseAmountKRW = await getEffectiveOrderMax('kis');
    const created: unknown[] = [];
    const skipped: Array<{ symbol: string; reason: string }> = [];

    for (const symbol of symbols) {
      try {
        const [ticker, candles] = await Promise.all([
          kis.getTicker(symbol),
          kis.getCandles(symbol, '1h', 60),
        ]);
        const signals = simpleRsiMomentum(
          { symbol, ticker, candles },
          { baseAmountKRW, strategyId: 'rsi_momentum_v1' },
        );
        if (signals.length === 0) {
          skipped.push({ symbol, reason: 'no_signal' });
          continue;
        }
        for (const s of signals) {
          const r = await createSignal(s, cfg);
          created.push({ symbol, signalId: r.signalId, autoSubmitted: r.autoSubmitted, orderId: r.orderId });
        }
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        skipped.push({ symbol, reason: err });
      }
    }

    return Response.json({ ok: true, data: { created, skipped } });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/analyst/run]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
