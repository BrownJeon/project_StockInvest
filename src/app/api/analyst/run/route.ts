import { kis } from '@/lib/exchanges/kis';
import { simpleRsiMomentum } from '@/lib/analyst/rules';
import { getRouterConfig, isEngineEnabled } from '@/lib/signals/router';
import { getEffectiveOrderMax, getLegacyAnalystSellAmount } from '@/lib/safety/order-limits';
import { createSignal, getEffectiveChasePct } from '@/lib/signals/service';
import { isDomesticOpen } from '@/lib/strategy/market-hours';
import { isBuyLimitConfigured, UNLIMITED_BUY_LIMIT } from '@/lib/safety/buy-limit-config';
import { allocateAdaptiveBuys } from '@/lib/strategy/adaptive-buy-sizing';
import { getStyleConfig } from '@/lib/strategy/style';
import type { SignalInput } from '@/lib/signals/router';

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
    const limit = await getEffectiveOrderMax('kis');
    const adaptive = limit === UNLIMITED_BUY_LIMIT;
    if (!isBuyLimitConfigured(limit)) {
      console.error('[api/analyst/run] 주문 한도 미설정(effectiveOrderMax=0) — 시그널 산정 스킵');
      return Response.json({
        ok: false,
        error: 'order_limit_unconfigured',
        detail: '주문 한도(safety_order_max_pct)가 설정되지 않았거나 포트폴리오 평가액을 조회할 수 없습니다. 설정 > 안전장치에서 1회 주문 한도(%)를 지정하세요.',
      }, { status: 409 });
    }
    const baseAmountKRW = adaptive ? await getLegacyAnalystSellAmount() : limit;
    const created: unknown[] = [];
    const skipped: Array<{ symbol: string; reason: string }> = [];

    const candidates: SignalInput[] = [];
    async function publish(s: SignalInput) {
      const { symbol } = s;
      // T-003 §1 `signal_create_failed` — createSignal 예외가 나머지 후보까지 죽이면 안 된다.
      // (구 코드는 심볼 단위 catch 뿐이라 같은 심볼의 후속 시그널이 통째로 유실됐다)
      try {
        const r = await createSignal(s, cfg, { origin: 'analyst_run' });   // T-072 — 막힌 매수의 가상 체결 출처
        // T-058 — 현금 부족 매수는 시그널이 만들어지지 않았다(signalId 0). 생성 성공처럼 `created` 에 넣지 않는다.
        // (다른 `ok:false` 코드의 기존 취급은 이 task 범위 밖이라 그대로 둔다)
        if (!r.ok && r.errorCode === 'insufficient_cash') {
          skipped.push({ symbol, reason: 'insufficient_cash' });
          return;
        }
        // T-072 — 검증 상태 관문(G1)에 막힌 매수도 승인 가능한 시그널이 아니다(signalId 0, 감사 행·가상 체결만). 같은 이유로 skipped.
        //   (`rsi_momentum_v1` 은 strategies 에 없는 ID 라 매수는 전부 여기로 온다 — 미등록 fail-closed)
        if (!r.ok && (r.errorCode === 'validation_gate' || r.errorCode === 'validation_lookup_error')) {
          skipped.push({ symbol, reason: r.errorCode });
          return;
        }
        created.push({ symbol, signalId: r.signalId, autoSubmitted: r.autoSubmitted, orderId: r.orderId });
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        console.error(`[api/analyst/run] signal_create_failed ${symbol} ${s.side}: ${err}`);
        skipped.push({ symbol, reason: `signal_create_failed: ${err}` });
      }
    }

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
          if (adaptive && s.side === 'buy') candidates.push(s);
          else if (baseAmountKRW > 0) await publish(s);
          else skipped.push({ symbol, reason: 'sell_amount_unavailable' });
        }
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        skipped.push({ symbol, reason: err });
      }
    }

    if (candidates.length > 0) {
      const style = await getStyleConfig();
      const chasePct = await getEffectiveChasePct(style.limitChasePct);
      const allocation = await allocateAdaptiveBuys('domestic', candidates, chasePct);
      for (const candidate of candidates) {
        const order = allocation.orders.get(candidate);
        if (order) await publish(order);
        else skipped.push({ symbol: candidate.symbol, reason: allocation.reason === 'allocated' ? 'candidate_not_allocated' : allocation.reason });
      }
    }

    return Response.json({ ok: true, data: { created, skipped } });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/analyst/run]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
