/**
 * PATCH /api/favorites/[symbol]/research — 리서치 추적 on/off 토글 (T-032).
 *
 * body: { enabled: boolean }
 * 즐겨찾기에 없는 종목은 404 — 추적은 즐겨찾기 종속 기능이다.
 * 실매매와 무관한 조회 전용 플래그라 안전장치 경로를 타지 않는다.
 */
import { NextRequest } from 'next/server';
import type { ResultSetHeader } from 'mysql2';
import { getPool } from '@/lib/db';
import { normalizeResearchSymbol } from '@/lib/research/data/symbol-validation';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol: rawSymbol } = await params;
  const symbol = decodeURIComponent(rawSymbol ?? '').trim();
  if (!symbol) {
    return Response.json({ ok: false, error: 'symbol required' }, { status: 400 });
  }

  // 지원하지 않는 심볼 포맷은 켜봐야 cron이 조회에 실패한다 — 입구에서 막는다.
  const norm = normalizeResearchSymbol(symbol);
  if (!norm.ok) {
    return Response.json(
      { ok: false, error: `unsupported symbol for research (${norm.reason})` },
      { status: 400 },
    );
  }

  try {
    const body = await req.json().catch(() => null);
    const enabled = (body as { enabled?: unknown } | null)?.enabled;
    if (typeof enabled !== 'boolean') {
      return Response.json({ ok: false, error: 'enabled must be boolean' }, { status: 400 });
    }

    const pool = getPool();
    const [result] = await pool.query<ResultSetHeader>(
      'UPDATE stock_favorites SET research_enabled = ? WHERE symbol = ?',
      [enabled ? 1 : 0, norm.symbol],
    );
    // affectedRows=0 은 "행 없음"과 "값이 이미 같음" 둘 다일 수 있어 존재 여부를 따로 본다.
    if (result.affectedRows === 0) {
      const [rows] = await pool.query<ResultSetHeader[]>(
        'SELECT 1 FROM stock_favorites WHERE symbol = ? LIMIT 1',
        [norm.symbol],
      );
      if (!Array.isArray(rows) || rows.length === 0) {
        return Response.json({ ok: false, error: 'favorite not found' }, { status: 404 });
      }
    }

    return Response.json({ ok: true, data: { symbol: norm.symbol, enabled } });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/favorites/research PATCH]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
