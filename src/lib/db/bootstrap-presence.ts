/** Positive name-presence optimization only; not a schema-definition validator. */
export interface BootstrapMetadataQuery {
  query(options: {sql: string; timeout: number}): Promise<unknown>;
}
const COLUMNS: Readonly<Record<string, readonly string[]>> = {
  signals: ['price_at_skip','price_1h_after','price_change_pct','price_4h_after','price_change_pct_4h','price_24h_after','price_change_pct_24h','market'],
  orders: ['market'], symbol_universe: ['market'],
};
const INDEXES: Readonly<Record<string, readonly string[]>> = {
  signals: ['idx_signals_market'], orders: ['idx_orders_market'],
};
const TIMEOUT_MS = 3000;
async function present(db: BootstrapMetadataQuery, kind: 'COLUMN'|'INDEX', targets: Readonly<Record<string, readonly string[]>>): Promise<Set<string>> {
  const sql = kind === 'COLUMN'
    ? "SELECT TABLE_NAME AS table_name, COLUMN_NAME AS object_name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('signals','orders','symbol_universe')"
    : "SELECT TABLE_NAME AS table_name, INDEX_NAME AS object_name FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('signals','orders')";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Driver timeout bounds SQL execution; race also bounds pool acquisition. A late read
    // cannot mutate this returned snapshot or suppress any subsequent DDL.
    const result = await Promise.race([db.query({sql, timeout: TIMEOUT_MS}), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('bootstrap_metadata_timeout')), TIMEOUT_MS);
    })]);
    if (!Array.isArray(result) || !Array.isArray(result[0])) return new Set();
    const found = new Set<string>();
    for (const row of result[0]) {
      if (!row || typeof row !== 'object' || typeof row.table_name !== 'string' || typeof row.object_name !== 'string') return new Set();
      if (Object.prototype.hasOwnProperty.call(targets,row.table_name) && targets[row.table_name].includes(row.object_name)) found.add(row.table_name+'.'+row.object_name);
    }
    return found;
  } catch { return new Set(); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
export async function readBootstrapPresence(db: BootstrapMetadataQuery) {
  const columns = await present(db,'COLUMN',COLUMNS);
  const indexes = await present(db,'INDEX',INDEXES);
  return {
    hasColumn: (table: string, column: string) => columns.has(table+'.'+column),
    hasIndex: (table: string, index: string) => indexes.has(table+'.'+index),
  };
}
