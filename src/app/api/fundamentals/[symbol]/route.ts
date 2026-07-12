import { getPool } from '@/lib/db';
import { kis } from '@/lib/exchanges/kis';
import type { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1일

interface KeyFactor {
  label: string;
  value: string;
  description: string;
}

interface FundamentalsResult {
  pbr: number | null;
  per: number | null;
  eps: number | null;
  market_cap_bn: number | null;
  dividend_yield: number | null;
  roe: number | null;
  key_factors: KeyFactor[];
  ai_summary: string;
  data_source: string;
}

async function fetchFromClaude(symbol: string, name: string): Promise<Partial<FundamentalsResult>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[fundamentals] ANTHROPIC_API_KEY not set — skipping Claude call');
    return {};
  }

  const prompt = `당신은 주식 투자 분석 전문가입니다.

기업명: ${name} (종목코드: ${symbol})

다음 JSON 형식으로 정확하게 답변해주세요. 수치는 가장 최근 공시 기준으로 작성하고, 모르면 null로 표기하세요.

{
  "pbr": <주가순자산비율, 숫자>,
  "per": <주가수익비율, 숫자>,
  "eps": <주당순이익 원화, 숫자>,
  "market_cap_bn": <시가총액 억원, 숫자>,
  "dividend_yield": <배당수익률%, 숫자>,
  "roe": <자기자본이익률%, 숫자>,
  "key_factors": [
    {"label": "핵심지표명", "value": "현재수치", "description": "이 지표가 중요한 이유 한 문장"},
    {"label": "핵심지표명", "value": "현재수치", "description": "이 지표가 중요한 이유 한 문장"},
    {"label": "핵심지표명", "value": "현재수치", "description": "이 지표가 중요한 이유 한 문장"}
  ],
  "ai_summary": "이 기업의 현재 가치와 투자 판단에 필요한 핵심 내용을 3~4문장으로 요약. 업종 특성상 가장 중요한 외부 지표(예: DRAM 가격, 금리, 환율 등)를 반드시 언급."
}

중요: key_factors는 이 기업 주가에 가장 직결되는 지표 3개여야 합니다. 예를 들어 삼성전자·SK하이닉스는 DRAM/NAND 가격이 연준금리보다 중요합니다. 기업의 실제 비즈니스 드라이버에 집중해주세요.
JSON만 반환하고 다른 텍스트는 없이.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error('[fundamentals] Claude API error:', res.status);
      return {};
    }

    const data = await res.json() as { content: Array<{ text: string }> };
    const text = data.content?.[0]?.text ?? '';

    // JSON 파싱 (마크다운 코드블록 제거)
    const jsonStr = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(jsonStr) as Partial<FundamentalsResult>;
    return parsed;
  } catch (e) {
    console.error('[fundamentals] Claude parse error:', e);
    return {};
  }
}

export async function GET(
  req: Request,
  { params }: { params: { symbol: string } },
) {
  const pool = getPool();
  const { symbol } = params;

  if (!symbol) return Response.json({ ok: false, error: 'symbol required' }, { status: 400 });

  try {
    // 캐시 확인
    const [cached] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM stock_fundamentals WHERE symbol = ? LIMIT 1',
      [symbol],
    );

    const cacheRow = cached[0];
    if (cacheRow?.updated_at) {
      const age = Date.now() - new Date(cacheRow.updated_at as string).getTime();
      const isStale = age >= CACHE_TTL_MS;
      const isEmpty = !cacheRow.pbr && !cacheRow.per && !cacheRow.roe;  // 핵심 필드 모두 null
      if (!isStale && !isEmpty) {
        return Response.json({ ok: true, data: cacheRow, cached: true });
      }
    }

    // 종목명 조회
    const [metaRows] = await pool.query<RowDataPacket[]>(
      'SELECT name FROM stock_meta WHERE symbol = ? LIMIT 1',
      [symbol],
    );
    const name = (metaRows[0]?.name as string) ?? symbol;

    // 현재가 (시총 계산용)
    let currentPrice: number | null = null;
    try {
      const ticker = await kis.getTicker(symbol);
      currentPrice = ticker.price ?? null;
    } catch { /* ignore */ }

    // Claude AI 호출
    const aiData = await fetchFromClaude(symbol, name);

    // Claude 호출 실패 시 빈 객체 반환 — DB에 기존 데이터가 있으면 그대로 반환, 없으면 에러
    const isAiEmpty = !aiData.pbr && !aiData.per && !aiData.roe;
    if (isAiEmpty) {
      if (cacheRow && (cacheRow.pbr || cacheRow.per || cacheRow.roe)) {
        return Response.json({ ok: true, data: cacheRow, cached: true });
      }
      return Response.json({ ok: false, error: 'claude_unavailable' });
    }

    const fundamentals: FundamentalsResult = {
      pbr: (aiData.pbr as number) ?? null,
      per: (aiData.per as number) ?? null,
      eps: (aiData.eps as number) ?? null,
      market_cap_bn: (aiData.market_cap_bn as number) ?? null,
      dividend_yield: (aiData.dividend_yield as number) ?? null,
      roe: (aiData.roe as number) ?? null,
      key_factors: (aiData.key_factors as KeyFactor[]) ?? [],
      ai_summary: (aiData.ai_summary as string) ?? '',
      data_source: process.env.ANTHROPIC_API_KEY ? 'claude_ai' : 'unavailable',
    };

    // DB 캐시 저장
    await pool.query(
      `INSERT INTO stock_fundamentals
         (symbol, pbr, per, eps, market_cap_bn, dividend_yield, roe,
          key_factors, ai_summary, data_source, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         pbr=VALUES(pbr), per=VALUES(per), eps=VALUES(eps),
         market_cap_bn=VALUES(market_cap_bn), dividend_yield=VALUES(dividend_yield),
         roe=VALUES(roe), key_factors=VALUES(key_factors),
         ai_summary=VALUES(ai_summary), data_source=VALUES(data_source),
         updated_at=NOW()`,
      [
        symbol, fundamentals.pbr, fundamentals.per, fundamentals.eps,
        fundamentals.market_cap_bn, fundamentals.dividend_yield, fundamentals.roe,
        JSON.stringify(fundamentals.key_factors), fundamentals.ai_summary,
        fundamentals.data_source,
      ],
    );

    void currentPrice; // suppress unused warning

    return Response.json({ ok: true, data: { symbol, ...fundamentals }, cached: false });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/fundamentals]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { symbol: string } },
) {
  const pool = getPool();
  const { symbol } = params;
  try {
    await pool.query('DELETE FROM stock_fundamentals WHERE symbol = ?', [symbol]);
    return Response.json({ ok: true });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
