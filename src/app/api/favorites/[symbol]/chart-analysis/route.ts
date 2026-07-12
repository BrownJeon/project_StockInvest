import { getPool } from '@/lib/db';
import { runLlm } from '@/lib/llm/provider';
import type { RowDataPacket } from 'mysql2';
import type { TechnicalData } from '../technical/route';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 30 * 60 * 1000; // 30분

export async function GET(
  _req: Request,
  { params }: { params: { symbol: string } },
) {
  const pool = getPool();
  const { symbol } = params;

  if (!symbol) return Response.json({ ok: false, error: 'symbol required' }, { status: 400 });

  try {
    // 캐시 확인
    const [cached] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM stock_chart_analysis WHERE symbol = ? AND interval_str = '30m' LIMIT 1",
      [symbol],
    );
    const cacheRow = cached[0];
    if (cacheRow?.updated_at) {
      const age = Date.now() - new Date(cacheRow.updated_at as string).getTime();
      const isStale = age >= CACHE_TTL_MS;
      const isEmptyAnalysis = !cacheRow.ai_analysis;
      if (!isStale && !isEmptyAnalysis) {
        return Response.json({
          ok: true,
          data: { symbol, aiAnalysis: cacheRow.ai_analysis, updatedAt: cacheRow.updated_at },
          cached: true,
        });
      }
    }

    // 종목명 조회
    const [metaRows] = await pool.query<RowDataPacket[]>(
      'SELECT name FROM stock_meta WHERE symbol = ? LIMIT 1',
      [symbol],
    );
    const name = (metaRows[0]?.name as string) ?? symbol;

    // 기술 지표 조회 (internal fetch)
    const port = process.env.PORT ?? '3003';
    const techResponse = await fetch(
      `http://localhost:${port}/api/favorites/${encodeURIComponent(symbol)}/technical`,
    );
    if (!techResponse.ok) {
      return Response.json({ ok: false, error: 'technical_data_unavailable' });
    }
    const techJson = await techResponse.json() as { ok: boolean; data: TechnicalData };
    if (!techJson.ok) {
      return Response.json({ ok: false, error: 'technical_data_unavailable' });
    }
    const td = techJson.data;

    const {
      rsi14, macd, macdSignal, macdHistogram,
      ema20, ema60, bbPosition,
      volumeRatio, priceChange5,
      poc, vah, val,
      marketState,
    } = td;

    const prompt = `당신은 주식 기술 분석 전문가입니다.
아래는 ${name}(${symbol})의 현재 기술 지표입니다:
- RSI 14: ${rsi14 ?? '—'} (과매도 30 이하 / 과매수 70 이상)
- MACD: ${macd ?? '—'} / Signal: ${macdSignal ?? '—'} / Histogram: ${macdHistogram ?? '—'}
- EMA20: ${ema20 ?? '—'}, EMA60: ${ema60 ?? '—'}
- 볼린저밴드 위치: ${bbPosition != null ? Math.round(bbPosition * 100) + '%' : '—'}
- 최근 거래량 비율(20봉 대비): ${volumeRatio.toFixed(1)}배
- 최근 5봉 가격 변화: ${priceChange5.toFixed(2)}%
- 매물대 POC: ${poc ?? '—'}, VAH: ${vah ?? '—'}, VAL: ${val ?? '—'}
- 시장 분류: ${marketState}

위 지표를 바탕으로 다음 세 가지를 한국어로 3~5문장 이내로 설명하세요:
1. 현재 기술적 상태 (추세·모멘텀·과매수/과매도)
2. 주목해야 할 이유나 리스크
3. 단기 관전 포인트

JSON 형식 없이 순수 텍스트로만 답하세요.`;

    let aiAnalysis: string;
    try {
      aiAnalysis = await runLlm(prompt, { responseFormat: 'text', timeoutMs: 90000 });
    } catch (e) {
      console.error('[chart-analysis] LLM error:', e);
      return Response.json({ ok: false, error: 'llm_error' });
    }

    if (!aiAnalysis) {
      return Response.json({ ok: false, error: 'claude_empty_response' });
    }

    // DB upsert
    const now = new Date();
    await pool.query(
      `INSERT INTO stock_chart_analysis (symbol, interval_str, ai_analysis, data_source, updated_at)
       VALUES (?, '30m', ?, 'claude_ai', NOW())
       ON DUPLICATE KEY UPDATE
         ai_analysis = VALUES(ai_analysis),
         data_source = VALUES(data_source),
         updated_at = NOW()`,
      [symbol, aiAnalysis],
    );

    return Response.json({
      ok: true,
      data: { symbol, aiAnalysis, updatedAt: now.toISOString() },
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/chart-analysis]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { symbol: string } },
) {
  const pool = getPool();
  const { symbol } = params;
  try {
    await pool.query('DELETE FROM stock_chart_analysis WHERE symbol = ?', [symbol]);
    return Response.json({ ok: true });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
