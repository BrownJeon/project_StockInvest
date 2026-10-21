import { getPool } from '@/lib/db';
import { kis } from '@/lib/exchanges/kis';
import { runLlm } from '@/lib/llm/provider';
import { isOverseasSymbol } from '@/lib/exchanges/kis-symbols';
import { isNoSuchTableError } from '@/lib/data/us-data-db';
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

/**
 * T-059 Part A — 해외 심볼 응답에 KIS 현재가상세 **관측값**(`us_fundamentals_snapshot` 최신 행)을 **별도 필드 `observed`** 로 덧붙인다.
 *
 *  - 기존 응답(`data`·`cached`)과 기존 해외 LLM 경로·`stock_fundamentals` 캐시 동작은 **그대로**다. 이 블록은 `stock_fundamentals` 를
 *    읽지도 쓰지도 않는다(R-1, Leader 10-21: 캐시를 관측값으로 덮으면 ROE·배당·AI 요약이 화면에서 사라지는 사용자 화면 변경이라
 *    데모 게이트 대상 → 범위에서 뺐다). 화면은 아직 `observed` 를 읽지 않으므로 사용자에게 보이는 변화가 없다.
 *  - 스냅샷이 있으면 `observed: { …원값, observed_at, data_source:'kis_price_detail' }`, 없거나 테이블이 없으면(마이그레이션 전) `observed:false`.
 *    스냅샷 조회가 그 밖의 이유로 실패해도 기존 경로는 막지 않고 `observed:false, observed_error:'snapshot_read_failed'` 로 표시한다.
 *  - `market_cap_raw` 는 KIS `tomv` 원값(단위 미확인 — 화면의 '억원' 필드 `market_cap_bn` 과 섞지 않는다).
 *  - 국내 심볼은 스냅샷을 조회하지 않고 응답에 `observed` 키도 없다(형식 불변).
 *  - 분석가·P3 는 이 응답이 아니라 `us_fundamentals_snapshot` 테이블을 직접 읽는다.
 */
async function readLatestUsSnapshot(
  pool: ReturnType<typeof getPool>,
  symbol: string,
): Promise<RowDataPacket | null> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT symbol, per, pbr, eps, bps, market_cap, shares, h52, l52, last_price, currency, sector, etp_type, observed_at
         FROM us_fundamentals_snapshot WHERE symbol = ? ORDER BY observed_at DESC LIMIT 1`,
      [symbol],
    );
    return rows[0] ?? null;
  } catch (e) {
    if (isNoSuchTableError(e)) return null;   // 마이그레이션 전 — 기존 경로로
    throw e;
  }
}

const numOrNull = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function fetchFromClaude(symbol: string, name: string): Promise<Partial<FundamentalsResult>> {
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
    const text = await runLlm(prompt, { responseFormat: 'json', timeoutMs: 90000 });
    // 코드블록 제거 후 첫 번째 { ... } 블록만 추출 (JSON 뒤 추가 텍스트 무시)
    const stripped = text.replace(/```json?\n?/g, '').replace(/```/g, '');
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON object found in response');
    const parsed = JSON.parse(match[0]) as Partial<FundamentalsResult>;
    return parsed;
  } catch (e) {
    console.error('[fundamentals] Claude parse error:', e);
    return {};
  }
}

type ObservedPart = { observed?: false | Record<string, unknown>; observed_error?: string };

/** 해외 심볼이면 스냅샷을 읽어 `observed` 부분을 만든다. 국내는 빈 객체(응답 형식 불변). 던지지 않는다. */
async function buildObserved(pool: ReturnType<typeof getPool>, symbol: string, overseas: boolean): Promise<ObservedPart> {
  if (!overseas) return {};
  let snap: RowDataPacket | null;
  try {
    snap = await readLatestUsSnapshot(pool, symbol);
  } catch (e) {
    console.error('[api/fundamentals] us_fundamentals_snapshot 조회 실패:', e instanceof Error ? e.message : String(e));
    return { observed: false, observed_error: 'snapshot_read_failed' };
  }
  if (!snap) return { observed: false };
  return {
    observed: {
      per: numOrNull(snap.per),
      pbr: numOrNull(snap.pbr),
      eps: numOrNull(snap.eps),
      bps: numOrNull(snap.bps),
      market_cap_raw: numOrNull(snap.market_cap),
      shares: numOrNull(snap.shares),
      high_52w: numOrNull(snap.h52),
      low_52w: numOrNull(snap.l52),
      last_price: numOrNull(snap.last_price),
      currency: (snap.currency as string | null) ?? null,
      sector: (snap.sector as string | null) ?? null,
      etp_type: (snap.etp_type as string | null) ?? null,
      observed_at: snap.observed_at,
      data_source: 'kis_price_detail',
    },
  };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const pool = getPool();
  const { symbol } = await params;

  if (!symbol) return Response.json({ ok: false, error: 'symbol required' }, { status: 400 });
  const overseas = isOverseasSymbol(symbol);

  try {
    const observedPart = await buildObserved(pool, symbol, overseas);

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
        return Response.json({ ok: true, data: cacheRow, cached: true, ...observedPart });
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
        return Response.json({ ok: true, data: cacheRow, cached: true, ...observedPart });
      }
      return Response.json({ ok: false, error: 'claude_unavailable', ...observedPart });
    }

    const toNum = (v: unknown): number | null => {
      const n = Number(v);
      return v != null && v !== '' && isFinite(n) ? n : null;
    };
    const fundamentals: FundamentalsResult = {
      pbr: toNum(aiData.pbr),
      per: toNum(aiData.per),
      eps: toNum(aiData.eps),
      market_cap_bn: toNum(aiData.market_cap_bn),
      dividend_yield: toNum(aiData.dividend_yield),
      roe: toNum(aiData.roe),
      key_factors: (aiData.key_factors as KeyFactor[]) ?? [],
      ai_summary: (aiData.ai_summary as string) ?? '',
      data_source: 'claude_ai',
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

    return Response.json({ ok: true, data: { symbol, ...fundamentals }, cached: false, ...observedPart });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/fundamentals]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const pool = getPool();
  const { symbol } = await params;
  try {
    await pool.query('DELETE FROM stock_fundamentals WHERE symbol = ?', [symbol]);
    return Response.json({ ok: true });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
