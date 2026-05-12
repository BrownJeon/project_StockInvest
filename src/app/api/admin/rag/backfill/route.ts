/**
 * Phase AB — 90일 RAG 백필 라우트.
 *
 * POST /api/admin/rag/backfill?days=90&dryRun=false
 * 인증: x-cron-secret (CRON_SECRET 일치)
 *
 * 동작:
 *   1. signals 테이블에서 days일 전~현재까지 조회 (price_1h_after IS NOT NULL OR status='ai_skipped')
 *   2. 200건 batch로 M4 /v1/kb/signals.stockinvest/upsert (server-side embedding)
 *   3. dryRun=true → 카운트만 보고 (upsert 안 함)
 *
 * 실행 예:
 *   curl -sX POST "http://localhost:3003/api/admin/rag/backfill?days=90&dryRun=true" \
 *     -H "x-cron-secret: $CRON_SECRET" | jq
 */
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { upsertSignalsBatch, SIGNALS_COLLECTION } from '@/lib/rag/signals-upsert';
import { getKbClient } from '@/lib/rag/m4-kb';
import type { SignalForEmbedding } from '@/lib/rag/format';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CRON_SECRET = process.env.CRON_SECRET;
const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 50; // M4 부하 분산

async function getAvailableColumns(): Promise<Set<string>> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(`SHOW COLUMNS FROM signals`);
  return new Set(rows.map(r => String(r.Field)));
}

function rowToSignal(r: RowDataPacket, cols: Set<string>): SignalForEmbedding & { id: number } {
  let indicators: Record<string, unknown> | null = null;
  if (r.indicators) {
    try { indicators = typeof r.indicators === 'string' ? JSON.parse(r.indicators) : r.indicators; }
    catch { indicators = null; }
  }
  const has = (k: string) => cols.has(k);
  const num = (v: unknown): number | null =>
    v == null ? null : (Number.isFinite(Number(v)) ? Number(v) : null);
  const hitOf = (after: unknown): boolean | null => {
    const a = num(after);
    const p = num(r.price);
    if (a == null || p == null) return null;
    return (r.side === 'buy' && a > p) || (r.side === 'sell' && a < p);
  };
  return {
    id: r.id as number,
    symbol: r.symbol as string,
    side: r.side as 'buy' | 'sell',
    strategyId: (r.strategy_id ?? null) as string | null,
    market: has('market') ? ((r.market ?? null) as string | null) : null,
    status: (r.status ?? null) as string | null,
    price: num(r.price),
    reasoning: (r.reasoning ?? null) as string | null,
    indicators,
    createdAt: (r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at ?? '')) || null,
    priceChangePct1h:  has('price_change_pct_1h')  ? num(r.price_change_pct_1h)  : null,
    priceChangePct4h:  has('price_change_pct_4h')  ? num(r.price_change_pct_4h)  : null,
    priceChangePct24h: has('price_change_pct_24h') ? num(r.price_change_pct_24h) : null,
    hit1h:  has('price_1h_after')  ? hitOf(r.price_1h_after)  : null,
    hit4h:  has('price_4h_after')  ? hitOf(r.price_4h_after)  : null,
    hit24h: has('price_24h_after') ? hitOf(r.price_24h_after) : null,
  };
}

/** 사용 가능한 컬럼만 골라 SELECT 절 빌드. */
function buildSelectClause(cols: Set<string>): { selectCols: string[]; whereClause: string } {
  const baseCols = ['id', 'strategy_id', 'symbol', 'side', 'price', 'reasoning', 'indicators', 'status', 'created_at'];
  const optionalCols = [
    'market',
    'price_1h_after', 'price_change_pct_1h',
    'price_4h_after', 'price_change_pct_4h',
    'price_24h_after', 'price_change_pct_24h',
  ];
  const selectCols = [...baseCols, ...optionalCols.filter(c => cols.has(c))];

  // WHERE: price_1h_after 컬럼 있으면 라벨 있는 것 우선, 없으면 모든 시그널
  const whereClause = cols.has('price_1h_after')
    ? `created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) AND (price_1h_after IS NOT NULL OR status = 'ai_skipped')`
    : `created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`;

  return { selectCols, whereClause };
}

export async function POST(req: NextRequest) {
  if (CRON_SECRET) {
    const auth = req.headers.get('x-cron-secret');
    if (auth !== CRON_SECRET) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  const url = new URL(req.url);
  const days = Math.max(1, Math.min(365, Number(url.searchParams.get('days') ?? 90)));
  const dryRun = String(url.searchParams.get('dryRun') ?? 'false').toLowerCase() === 'true';

  const startedAt = Date.now();
  const pool = getPool();

  // 1. signals 컬럼 자동 감지 + SELECT 빌드
  const cols = await getAvailableColumns();
  const { selectCols, whereClause } = buildSelectClause(cols);
  const sql = `SELECT ${selectCols.join(', ')} FROM signals WHERE ${whereClause} ORDER BY id ASC`;

  const [rows] = await pool.query<RowDataPacket[]>(sql, [days]);

  const signals = rows.map(r => rowToSignal(r, cols));
  const plannedCount = signals.length;
  const batchCount = Math.ceil(plannedCount / BATCH_SIZE);

  if (dryRun) {
    // D-9: dryRun 강화 — 첫 1건 실제 upsert 시도해서 임베딩·네트워크·권한 신뢰도 측정
    let smoke: { ok: boolean; status?: number; elapsedMs?: number; error?: string } = { ok: false };
    if (signals.length > 0) {
      const sampleStart = Date.now();
      try {
        const client = await getKbClient();
        await client.ensureCollection(SIGNALS_COLLECTION);   // env (M4_DEFAULT_EMBED_MODEL) 또는 bge-m3
        const r = await upsertSignalsBatch([signals[0]]);
        smoke = { ok: r.upserted > 0, elapsedMs: Date.now() - sampleStart };
      } catch (e) {
        smoke = { ok: false, elapsedMs: Date.now() - sampleStart, error: e instanceof Error ? e.message : String(e) };
      }
    }
    return NextResponse.json({
      ok: true,
      mode: 'dryRun',
      collection: SIGNALS_COLLECTION,
      plannedCount,
      batchCount,
      estimatedSeconds: Math.round(batchCount * 1.5),
      detectedColumns: Array.from(cols).sort(),
      sample: signals.slice(0, 2),
      smoke,   // D-9: 첫 1건 실 upsert 결과 — 운영자가 backfill 시작 전 신뢰도 측정
    });
  }

  // 2. ensureCollection (멱등 — 이미 있으면 무동작)
  let collectionEnsured = false;
  try {
    const client = await getKbClient();
    await client.ensureCollection(SIGNALS_COLLECTION);   // D-8: env 또는 bge-m3 default
    collectionEnsured = true;
  } catch (e) {
    console.warn(`[rag-backfill] ensureCollection failed (continuing): ${e instanceof Error ? e.message : String(e)}`);
  }

  // 3. 배치 upsert
  let upserted = 0;
  const errors: string[] = [];
  for (let i = 0; i < batchCount; i++) {
    const batch = signals.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    try {
      const r = await upsertSignalsBatch(batch);
      upserted += r.upserted;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`batch ${i + 1}: ${msg}`);
      console.error(`[rag-backfill] batch ${i + 1}/${batchCount} failed: ${msg}`);
    }
    if (i < batchCount - 1) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  const elapsedMs = Date.now() - startedAt;
  return NextResponse.json({
    ok: errors.length === 0,
    mode: 'backfill',
    collection: SIGNALS_COLLECTION,
    collectionEnsured,
    plannedCount,
    upserted,
    batchCount,
    elapsedMs,
    errors: errors.length > 0 ? errors : undefined,
  });
}
