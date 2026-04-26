import { getAccountId, getPool } from '@/lib/db';
import { kis } from '@/lib/exchanges/kis';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const balances = await kis.getBalances();
    const accountId = await getAccountId('kis');
    const pool = getPool();

    if (balances.length > 0) {
      const rows = balances.map((b) => [accountId, b.currency, b.free, b.locked]);
      await pool.query(
        'INSERT INTO holdings (account_id, currency, balance, locked) VALUES ?',
        [rows],
      );
    }

    return Response.json({ ok: true, data: balances, snapshot_count: balances.length });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[api/balances]', error);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
