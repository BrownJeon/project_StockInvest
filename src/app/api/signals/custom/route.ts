/**
 * POST /api/signals/custom
 * 사용자가 직접 입력한 시나리오 수치에 대해 AI 분석 결과를 반환 (DB 저장 없음).
 * 설정된 LLM provider(로컬 LLM / Claude CLI)로 지표 분석을 보완.
 *
 * Body: { symbol, direction, currentPrice?, entryZonePct?, splits?, holdingDeadline }
 * 반환: { grade, ev, pWin, rr, buyRationale, risks, aiSuggestedScenario, llmEnhanced }
 */
import { kis } from '@/lib/exchanges/kis';
import { rsi, macd, bollinger, atr } from '@/lib/strategy/indicators';
import { gradeFromEv } from '@/lib/signals/scenario-builder';
import { runLlm, getActiveProvider } from '@/lib/llm/provider';
import { isFiniteNumber } from '@/lib/safety/numeric-fields';
import type { Candle } from '@/lib/exchanges/types';

interface LlmAnalysis {
  why_now: string;
  risk_factors: string[];
  grade?: string;
  entry_comment?: string;
}

async function enhanceWithLlm(params: {
  symbol: string;
  direction: 'buy' | 'sell';
  currentPrice: number;
  rsiLast: number;
  macdSignalDiff: number;
  bbWidth: number;
  atrLast: number;
  ev: number;
  pWin: number;
  holdingDeadline: string;
  market: string;
}): Promise<LlmAnalysis | null> {
  try {
    const { symbol, direction, currentPrice, rsiLast, macdSignalDiff, bbWidth, atrLast, ev, pWin, holdingDeadline, market } = params;
    const dir = direction === 'buy' ? '매수(BUY)' : '매도(SELL)';
    const mkt = market === 'overseas' ? '미국주식' : '국내주식';
    const atrPct = currentPrice > 0 ? ((atrLast / currentPrice) * 100).toFixed(2) : '—';

    const prompt = `당신은 ${mkt} 퀀트 트레이더입니다. 아래 종목의 기술 지표를 분석하고 JSON으로만 응답하세요.

## 종목 정보
- 종목코드: ${symbol}
- 방향: ${dir}
- 현재가: ${currentPrice > 0 ? `₩${Math.round(currentPrice).toLocaleString('ko-KR')}` : '미상'}
- 보유 마감기한: ${holdingDeadline}

## 기술 지표 (일봉 기준)
- RSI(14): ${rsiLast.toFixed(1)}
- MACD-Signal 차이: ${macdSignalDiff.toFixed(4)} (양수=정배열, 음수=역배열)
- 볼린저 밴드 폭: ${bbWidth.toFixed(2)}% (6% 초과 시 고변동성)
- ATR(14): ${atrPct}% (현재가 대비)

## 규칙 기반 예비 평가
- EV 점수: ${(ev * 100).toFixed(0)}%
- P(win) 추정: ${(pWin * 100).toFixed(0)}%

## 응답 형식 (JSON만, 다른 텍스트 금지)
{
  "why_now": "지금 이 ${dir} 시나리오가 타당한 이유 또는 부적합한 이유 (2~4문장, 한국어)",
  "risk_factors": ["리스크1", "리스크2"],
  "grade": "A|B+|B|C 중 하나",
  "entry_comment": "진입 시 주의사항 또는 조언 (1문장, 한국어)"
}

## 언어 규칙
- 모든 텍스트는 반드시 한국어로만 작성
- JSON 외 텍스트(json 마크다운 포함) 출력 금지`;

    const raw = await runLlm(prompt, { timeoutMs: 60000, responseFormat: 'json' });

    // JSON 파싱 — 마크다운 펜스 제거 후 추출
    const cleaned = raw.replace(/```(?:json)?/g, '').replace(/```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) return null;

    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;

    const validGrades = ['A', 'B+', 'B', 'C'];
    return {
      why_now: typeof parsed.why_now === 'string' ? parsed.why_now : '',
      risk_factors: Array.isArray(parsed.risk_factors)
        ? (parsed.risk_factors as unknown[]).filter((r): r is string => typeof r === 'string')
        : [],
      grade: typeof parsed.grade === 'string' && validGrades.includes(parsed.grade)
        ? parsed.grade : undefined,
      entry_comment: typeof parsed.entry_comment === 'string' ? parsed.entry_comment : undefined,
    };
  } catch (e) {
    console.warn('[api/signals/custom] LLM enhance failed (fallback to rule-based):', e instanceof Error ? e.message : e);
    return null;
  }
}

export const dynamic = 'force-dynamic';

interface CustomBody {
  market?: 'domestic' | 'overseas';
  symbol: string;
  direction: 'buy' | 'sell';
  currentPrice?: number;
  /**
   * ⚠️ T-029 실측: `entryZonePct`·`splits` 는 **선언만 있고 이 라우트가 전혀 사용하지 않는다**
   * (호출자는 `splits` 를 보내지만 무시된다). 값이 소비되지 않으므로 수치 가드도 두지 않는다 —
   * 소비하기 시작하는 순간 `currentPrice` 와 같은 검증이 필요하다.
   */
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

    // 🔴 T-029 — confirm 라우트와 **같은 클래스**의 문자열 연결 사고가 여기에도 있었다.
    //   `currentPrice='70000'` 이면 아래 `price_zone` 조립에서
    //     `${Math.round(currentPrice - aiDelta)}~${Math.round(currentPrice + aiDelta)}`
    //   의 `-` 는 강제변환되지만 `+` 는 **연결**이라 `'70000' + 210` → `'70000210'` →
    //   `'69790~70000210'` 이라는 오염된 구간 문자열이 나온다.
    //
    //   이 라우트는 DB 에 쓰지 않지만, 이 `aiSuggestedScenario` 가 그대로
    //   `POST /api/signals/custom/confirm` 의 `scenario` 로 실려 가고, 거기서
    //   `scenario.entry.price_zone` 은 **confirm 의 수치 가드가 닿지 않는 유일한 가격 원천**이다
    //   (`currentPrice <= 0` 폴백 경로에서 파싱되어 price 컬럼이 된다).
    //   → 오염이 만들어지는 지점에서 막는다.
    if (body.currentPrice !== undefined && body.currentPrice !== null
        && !isFiniteNumber(body.currentPrice)) {
      console.warn(
        `[api/signals/custom POST] 비-number currentPrice 거절 — symbol=${String(symbol)} ` +
        `type=${typeof body.currentPrice}`,
      );
      return Response.json(
        { ok: false, error: 'currentPrice must be a finite number' },
        { status: 400 },
      );
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

    // 규칙 기반 기본값
    const ruleRiskFactors = [
      rsiLast > 70 ? '과매수 구간 (RSI > 70)' : null,
      bbWidth > 6 ? '볼린저 밴드 확장 — 변동성 주의' : null,
      rr < 1.5 ? `R/R ${rr.toFixed(2)} — 목표 대비 손절 비율 낮음` : null,
    ].filter(Boolean) as string[];

    const ruleTrigger = `RSI ${rsiLast.toFixed(0)} · MACD ${macdSignalDiff >= 0 ? '양수' : '음수'} · 현재가 기준 진입`;
    const ruleWhyNow = `RSI ${rsiLast.toFixed(0)}, MACD ${macdSignalDiff >= 0 ? '정배열' : '역배열'}, R/R ${rr.toFixed(2)} 기준 EV ${(ev * 100).toFixed(0)}%`;

    // LLM provider 설정 확인 후 보완 호출
    const provider = await getActiveProvider();
    const llmResult = provider
      ? await enhanceWithLlm({ symbol, direction, currentPrice, rsiLast, macdSignalDiff, bbWidth, atrLast, ev, pWin, holdingDeadline, market })
      : null;

    const finalGrade = llmResult?.grade ?? grade;
    const finalRiskFactors = llmResult?.risk_factors?.length ? llmResult.risk_factors : ruleRiskFactors;
    const finalWhyNow = llmResult?.why_now || ruleWhyNow;
    const finalTrigger = llmResult?.entry_comment
      ? `${ruleTrigger} · ${llmResult.entry_comment}`
      : ruleTrigger;

    const aiSuggestedScenario = {
      grade: finalGrade,
      entry: {
        trigger: finalTrigger,
        price_zone: `${Math.round(currentPrice - aiDelta)}~${Math.round(currentPrice + aiDelta)}`,
      },
      exit: {
        trailing_activate_pct: 0,
        holding_deadline: holdingDeadline,
        holding_days: holdingDeadline,
      },
      risk_factors: finalRiskFactors,
      why_now: finalWhyNow,
      context: `P(win) 추정 ${(pWin * 100).toFixed(0)}% · R/R ${rr.toFixed(2)}`,
      ev,
    };

    const buyRationale = [
      `RSI: ${rsiLast.toFixed(1)} (${rsiLast < 40 ? '과매도' : rsiLast < 60 ? '중립' : '과매수'})`,
      `MACD: ${macdSignalDiff >= 0 ? '매수 신호 (정배열)' : '매도 신호 (역배열)'}`,
      currentPrice > 0 ? `현재가: ₩${Math.round(currentPrice).toLocaleString('ko-KR')}` : null,
    ].filter(Boolean) as string[];

    const risks = finalRiskFactors.length > 0
      ? finalRiskFactors
      : ['리스크 요인 없음 (지표 정상 범위)'];

    // defaultStopPct 사용 (린터 경고 방지)
    void defaultStopPct;

    return Response.json({
      ok: true,
      market,
      grade: finalGrade,
      ev,
      pWin: Math.round(pWin * 1000) / 1000,
      rr: Math.round(rr * 100) / 100,
      buyRationale,
      risks,
      aiSuggestedScenario,
      currentPrice,
      priceUnit,
      llmEnhanced: llmResult !== null,
      llmProvider: provider,
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/signals/custom POST]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
