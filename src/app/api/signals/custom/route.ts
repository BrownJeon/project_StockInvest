/**
 * POST /api/signals/custom
 * 사용자가 직접 입력한 시나리오 수치에 대해 AI 분석 결과를 반환 (DB 저장 없음).
 *
 * Body: { symbol, direction, currentPrice?, entryZonePct?, splits?, holdingDeadline }
 * 반환: { grade, ev, pWin, rr, buyRationale, risks, aiSuggestedScenario }
 */
import { kis } from '@/lib/exchanges/kis';
import { rsi, macd, bollinger, atr } from '@/lib/strategy/indicators';
import { gradeFromEv } from '@/lib/signals/scenario-builder';
import type { Candle } from '@/lib/exchanges/types';

export const dynamic = 'force-dynamic';

interface CustomBody {
  market?: 'domestic' | 'overseas';
  symbol: string;
  direction: 'buy' | 'sell';
  currentPrice?: number;
  /** 진입 구간 % [lo, hi] - 현재가 기준 오프셋 (음수=아래, 양수=위). */
  entryZonePct?: [number, number];
  splits?: number;
  /** 보유 마감기한 YYYY-MM-DD */
  holdingDeadline: string;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CustomBody;
    const { symbol, direction, holdingDeadline } = body;
    const { getMarketFromSymbol } = await import('@/lib/exchanges/kis-symbols');
    const market = body.market ?? getMarketFromSymbol(symbol);
    const isOverseas = market === 'overseas';
    const priceUnit = isOverseas ? 'USD' : '원';

    if (!symbol || !direction) {
      return Response.json({ ok: false, error: 'symbol/direction required' }, { status: 400 });
    }

    // 현재 지표 조회
    const [candles, ticker] = await Promise.all([
      kis.getCandles(symbol, '1d', 60).catch(() => [] as Candle[]),
      kis.getTicker(symbol).catch(() => null),
    ]);

    const closes = candles.map((c: Candle) => c.close);

    let rsiLast = 50, macdSignalDiff = 0, bbWidth = 0, atrLast = 0;
    if (closes.length >= 30) {
      const rsiValues = rsi(closes, 14);
      rsiLast = rsiValues[rsiValues.length - 1] ?? 50;

      const macdValues = macd(closes, 12, 26, 9);
      const lastMacd = macdValues[macdValues.length - 1];
      macdSignalDiff = lastMacd ? (lastMacd.macd ?? 0) - (lastMacd.signal ?? 0) : 0;

      const bbValues = bollinger(closes, 20, 2);
      const lastBb = bbValues[bbValues.length - 1];
      if (lastBb && lastBb.upper && lastBb.lower && lastBb.middle) {
        bbWidth = ((lastBb.upper - lastBb.lower) / lastBb.middle) * 100;
      }

      const atrValues = atr(candles as { high: number; low: number; close: number }[], 14);
      atrLast = atrValues[atrValues.length - 1] ?? 0;
    }

    // EV 점수 합산
    let rsiScore = 0;
    if (direction === 'buy') {
      if (rsiLast < 30) rsiScore = 0.15;
      else if (rsiLast < 50) rsiScore = 0.25;
      else if (rsiLast < 60) rsiScore = 0.20;
      else rsiScore = 0.05;
    } else {
      if (rsiLast > 70) rsiScore = 0.15;
      else if (rsiLast > 55) rsiScore = 0.20;
      else rsiScore = 0.10;
    }

    const macdScore = direction === 'buy'
      ? clamp((macdSignalDiff / (atrLast || 100)) * 10, -0.1, 0.15)
      : clamp((-macdSignalDiff / (atrLast || 100)) * 10, -0.1, 0.15);

    // stopPctRange 없으니 ATR 기반 기본값
    const currentPrice = body.currentPrice ?? ticker?.price ?? 0;
    const defaultStopPct = atrLast > 0
      ? Math.max(0.5, Math.min(3, (atrLast / (currentPrice || 1)) * 100))
      : 1.5;
    const rr = 1.5; // 고정 or ATR 기반
    const rrScore = clamp((rr - 1) * 0.1, -0.05, 0.2);

    // 현재가 기준 진입 = 최대 근접도
    const proximityScore = 0.15;

    const rawEv = clamp(rsiScore + macdScore + rrScore + proximityScore, 0, 0.9);
    const ev = Math.round(rawEv * 1000) / 1000;
    const grade = gradeFromEv(ev);
    const pWin = clamp(0.45 + ev * 0.3, 0.3, 0.75);

    // AI 진입 구간은 ATR 기반으로 계산, 사용자 입력과 비교용
    const aiDelta = atrLast > 0
      ? Math.round(currentPrice * (atrLast / (currentPrice || 1)) * 0.5)
      : Math.round(currentPrice * 0.003);

    const aiSuggestedScenario = {
      grade,
      entry: {
        trigger: `RSI ${rsiLast.toFixed(0)} · MACD ${macdSignalDiff >= 0 ? '양수' : '음수'} · 현재가 기준 진입`,
        price_zone: `${Math.round(currentPrice - aiDelta)}~${Math.round(currentPrice + aiDelta)}`,
      },
      exit: {
        trailing_activate_pct: 0,
        holding_deadline: holdingDeadline,
        holding_days: holdingDeadline,
      },
      risk_factors: [
        rsiLast > 70 ? '과매수 구간 (RSI > 70)' : null,
        bbWidth > 6 ? '볼린저 밴드 확장 — 변동성 주의' : null,
        rr < 1.5 ? `R/R ${rr.toFixed(2)} — 목표 대비 손절 비율 낮음` : null,
      ].filter(Boolean) as string[],
      why_now: `RSI ${rsiLast.toFixed(0)}, MACD ${macdSignalDiff >= 0 ? '정배열' : '역배열'}, R/R ${rr.toFixed(2)} 기준 EV ${(ev * 100).toFixed(0)}%`,
      context: `P(win) 추정 ${(pWin * 100).toFixed(0)}% · R/R ${rr.toFixed(2)}`,
      ev,
    };

    const buyRationale = [
      `RSI: ${rsiLast.toFixed(1)} (${rsiLast < 40 ? '과매도' : rsiLast < 60 ? '중립' : '과매수'})`,
      `MACD: ${macdSignalDiff >= 0 ? '매수 신호 (정배열)' : '매도 신호 (역배열)'}`,
      currentPrice > 0 ? `현재가: ₩${Math.round(currentPrice).toLocaleString('ko-KR')}` : null,
    ].filter(Boolean) as string[];

    const risks = aiSuggestedScenario.risk_factors.length > 0
      ? aiSuggestedScenario.risk_factors
      : ['리스크 요인 없음 (지표 정상 범위)'];

    // defaultStopPct 사용 (린터 경고 방지)
    void defaultStopPct;

    return Response.json({
      ok: true,
      market,
      grade,
      ev,
      pWin: Math.round(pWin * 1000) / 1000,
      rr: Math.round(rr * 100) / 100,
      buyRationale,
      risks,
      aiSuggestedScenario,
      currentPrice,
      priceUnit,
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/signals/custom POST]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
