import { kis } from '@/lib/exchanges/kis';
import { simpleRsiMomentum } from '@/lib/analyst/rules';
import { getRouterConfig, isEngineEnabled } from '@/lib/signals/router';
import { getEffectiveOrderMax } from '@/lib/safety/order-limits';
import { createSignal } from '@/lib/signals/service';
import { isDomesticOpen } from '@/lib/strategy/market-hours';

export const dynamic = 'force-dynamic';

const DEFAULT_SYMBOLS = ['005930', '000660', '035420', '035720', '051910', '000270', '005380', '066570', '373220', '207940'];

export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const force = searchParams.get('force') === 'true';

    if (!force && !(await isEngineEnabled())) {
      return Response.json({ ok: false, error: 'engine_disabled' }, { status: 403 });
    }
    if (!force && !(await isDomesticOpen())) {
      return Response.json({ ok: false, error: 'domestic_market_closed' }, { status: 409 });
    }
    const symbols = DEFAULT_SYMBOLS;

    const cfg = await getRouterConfig();
    const baseAmountKRW = await getEffectiveOrderMax('kis');
    // Phase 0 fail-safe: 0 = 한도 미설정(safety_order_max_pct 부재) 또는 포트폴리오 평가액 조회 실패.
    // 이전에는 Infinity가 그대로 amountKRW로 흘러 들어갔다. 이제 매수 후보 산정 자체를 스킵한다.
    if (!Number.isFinite(baseAmountKRW) || baseAmountKRW <= 0) {
      console.error('[api/analyst/run] 주문 한도 미설정(effectiveOrderMax=0) — 시그널 산정 스킵');
      return Response.json({
        ok: false,
        error: 'order_limit_unconfigured',
        detail: '주문 한도(safety_order_max_pct)가 설정되지 않았거나 포트폴리오 평가액을 조회할 수 없습니다. 설정 > 안전장치에서 1회 주문 한도(%)를 지정하세요.',
      }, { status: 409 });
    }
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
          // T-003 §1 `signal_create_failed` — createSignal 예외가 나머지 후보까지 죽이면 안 된다.
          // (구 코드는 심볼 단위 catch 뿐이라 같은 심볼의 후속 시그널이 통째로 유실됐다)
          try {
            const r = await createSignal(s, cfg);
            created.push({ symbol, signalId: r.signalId, autoSubmitted: r.autoSubmitted, orderId: r.orderId });
          } catch (e) {
            const err = e instanceof Error ? e.message : String(e);
            console.error(`[api/analyst/run] signal_create_failed ${symbol} ${s.side}: ${err}`);
            skipped.push({ symbol, reason: `signal_create_failed: ${err}` });
          }
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
