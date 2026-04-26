import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Market = 'domestic' | 'overseas';

function dbKey(market: Market): string {
  return market === 'overseas' ? 'safety_blocked_symbols_overseas' : 'safety_blocked_symbols';
}

function envFallback(market: Market): string[] {
  const envKey = market === 'overseas' ? 'BLOCKED_SYMBOLS_OVERSEAS' : 'BLOCKED_SYMBOLS_DOMESTIC';
  return (process.env[envKey] ?? '').split(',').map(s => s.trim()).filter(Boolean);
}

async function readList(market: Market): Promise<string[]> {
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { value: string })[]>(
      'SELECT value FROM system_config WHERE `key` = ? LIMIT 1',
      [dbKey(market)],
    );
    if (rows.length > 0) {
      const parsed = JSON.parse(rows[0].value);
      if (Array.isArray(parsed)) return parsed as string[];
    }
  } catch { /* fall through */ }
  return envFallback(market);
}

/** GET — 양 시장 블랙리스트 반환 */
export async function GET() {
  const [domestic, overseas] = await Promise.all([readList('domestic'), readList('overseas')]);
  return NextResponse.json({ ok: true, domestic, overseas });
}

/**
 * PUT — 시장별 블랙리스트 일괄 교체.
 * body: { market: 'domestic'|'overseas', symbols: string[] }
 */
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { market?: unknown; symbols?: unknown };
  const market = body.market === 'overseas' ? 'overseas' : 'domestic';
  if (!Array.isArray(body.symbols)) {
    return NextResponse.json({ ok: false, error: 'symbols must be array' }, { status: 400 });
  }
  const symbols = (body.symbols as unknown[])
    .filter((s): s is string => typeof s === 'string')
    .map(s => s.trim())
    .filter(Boolean);

  try {
    const pool = getPool();
    await pool.query(
      'INSERT INTO system_config (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      [dbKey(market), JSON.stringify(symbols)],
    );
    return NextResponse.json({ ok: true, market, count: symbols.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

/**
 * PATCH — 단일 추가/제거.
 * body: { market, action: 'add'|'remove', symbol: string }
 */
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { market?: unknown; action?: unknown; symbol?: unknown };
  const market: Market = body.market === 'overseas' ? 'overseas' : 'domestic';
  const symbol = typeof body.symbol === 'string' ? body.symbol.trim() : '';
  if (!symbol) return NextResponse.json({ ok: false, error: 'symbol required' }, { status: 400 });

  const list = await readList(market);
  let next: string[];
  if (body.action === 'remove') {
    next = list.filter(s => s !== symbol);
  } else {
    next = list.includes(symbol) ? list : [...list, symbol];
  }

  try {
    const pool = getPool();
    await pool.query(
      'INSERT INTO system_config (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      [dbKey(market), JSON.stringify(next)],
    );
    return NextResponse.json({ ok: true, market, symbols: next });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
