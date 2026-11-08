/** Resumable import orchestration; no connection or filesystem mutation at import. */
import { PREFIX, executeDumpStatement, identifier, mapStatement, statements } from './archive-lib.mjs';

export const IMPORT_BATCH_LIMITS = Object.freeze({ bytes: 8 * 1024 * 1024, statements: 100 });

async function assertOwned(db, datasetId, dumpSha, lock = false) {
  const [rows] = await db.query(
    'SELECT content_sha256,status FROM t156_dataset WHERE id=?' + (lock ? ' FOR UPDATE' : ''), [datasetId],
  );
  if (rows.length !== 1 || rows[0].content_sha256 !== dumpSha || rows[0].status !== 'staged') {
    throw new Error('dataset_already_published_or_conflict');
  }
}

/** Source/target content comparison is required; equal row count alone cannot skip. */
async function completedTables(db, manifest) {
  const names = manifest.tables.map(t => PREFIX + t.table);
  const [existing] = await db.query(
    'SELECT TABLE_NAME AS table_name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?)', [names],
  );
  const have = new Set(existing.map(t => t.table_name));
  const complete = new Set();
  for (const source of manifest.tables) {
    if (!have.has(PREFIX + source.table)) continue;
    const table = identifier(PREFIX + source.table);
    const [[count]] = await db.query(`SELECT COUNT(*) AS n FROM ${table}`);
    if (Number(count.n) !== source.rows) continue;
    const [[check]] = await db.query(`CHECKSUM TABLE ${table} EXTENDED`);
    if (!check || !/^\d+$/.test(String(check.Checksum))) throw new Error('invalid_target_checksum');
    if (String(check.Checksum) === String(source.checksum)) complete.add(source.table);
  }
  return complete;
}

/**
 * Batch byte limit is a soft group budget: a single larger original INSERT is
 * committed alone, preserving the previous importer's supported input range.
 * Large HEX preparation remains in executeDumpStatement, without modifying data.
 */
export async function importDump(db, {
  manifest, dumpPath, datasetId, dumpSha, onProgress = () => {},
  maxBatchBytes = IMPORT_BATCH_LIMITS.bytes, maxBatchStatements = IMPORT_BATCH_LIMITS.statements,
}) {
  if (manifest.dumpSha256 !== dumpSha || !/^[a-f0-9]{64}$/.test(dumpSha)
    || !Number.isInteger(maxBatchBytes) || maxBatchBytes < 1 || maxBatchBytes > IMPORT_BATCH_LIMITS.bytes
    || !Number.isInteger(maxBatchStatements) || maxBatchStatements < 1 || maxBatchStatements > IMPORT_BATCH_LIMITS.statements) {
    throw new Error('invalid_import_configuration');
  }
  const tables = manifest.tables.map(t => t.table);
  if (!tables.length || new Set(tables).size !== tables.length
    || manifest.tables.some(t => !Number.isSafeInteger(t.rows) || t.rows < 0 || !/^\d+$/.test(String(t.checksum)))) {
    throw new Error('invalid_manifest_checksum_or_count');
  }
  tables.forEach(t => identifier(PREFIX + t));
  await assertOwned(db, datasetId, dumpSha);
  const complete = await completedTables(db, manifest);
  for (const table of complete) onProgress({ event: 'resume_table_complete', table });
  const [[session]] = await db.query('SELECT @@foreign_key_checks AS fk_checks');
  const originalForeignKeys = Number(session.fk_checks);
  if (originalForeignKeys !== 0 && originalForeignKeys !== 1) throw new Error('invalid_foreign_key_session_state');
  const stats = {
    statements: 0, insertedStatements: 0, skippedInsertStatements: 0, skippedTables: [...complete],
    committedBatches: 0, committedSqlBytes: 0, oversizedStatements: 0,
  };
  let active = false, batchBytes = 0, batchStatements = 0;
  let primaryError;
  const commit = async () => {
    if (!active) return;
    await db.commit();
    active = false;
    stats.committedBatches++;
    stats.committedSqlBytes += batchBytes;
    batchBytes = 0; batchStatements = 0;
  };
  const insertDb = {
    async query(sql, values) {
      if (!/^INSERT IGNORE INTO /i.test(sql)) return db.query(sql, values);
      const bytes = Buffer.byteLength(sql, 'utf8');
      if (active && (batchStatements >= maxBatchStatements || batchBytes + bytes > maxBatchBytes)) await commit();
      if (!active) {
        await db.beginTransaction(); active = true;
        // Withdrawal can run between bounded batches; never resurrect a rejected dataset.
        await assertOwned(db, datasetId, dumpSha, true);
      }
      const result = await db.query(sql, values);
      batchStatements++; batchBytes += bytes; stats.insertedStatements++;
      if (bytes > maxBatchBytes) {
        stats.oversizedStatements++;
        onProgress({ event: 'single_oversized_insert', bytes });
      }
      if (batchStatements >= maxBatchStatements || batchBytes >= maxBatchBytes) await commit();
      return result;
    },
  };
  try {
    await db.query('SET FOREIGN_KEY_CHECKS=0');
    for await (const source of statements(dumpPath)) {
      let sql = mapStatement(source, tables);
      if (!sql) continue;
      const insert = source.match(/^INSERT INTO `([a-z][a-z0-9_]*)`/);
      if (insert && complete.has(insert[1])) { stats.skippedInsertStatements++; continue; }
      sql = sql.replace(/^CREATE TABLE /, 'CREATE TABLE IF NOT EXISTS ').replace(/^INSERT INTO /, 'INSERT IGNORE INTO ');
      if (insert) {
        // Prepare any large HEX session variables outside the preceding batch;
        // then isolate this source row even if its rewritten INSERT is short.
        const largeSourceRow = Buffer.byteLength(sql, 'utf8') > maxBatchBytes;
        if (largeSourceRow) await commit();
        await executeDumpStatement(insertDb, sql);
        if (largeSourceRow) await commit();
      } else {
        // DDL implicitly commits in MariaDB, so close the batch explicitly first.
        await commit();
        await assertOwned(db, datasetId, dumpSha);
        await executeDumpStatement(db, sql);
      }
      if (++stats.statements % 500 === 0) onProgress({ event: 'import_progress', ...stats });
    }
    await commit();
    await assertOwned(db, datasetId, dumpSha);
    return stats;
  } catch (error) {
    primaryError = error;
    if (active) {
      try { await db.rollback(); }
      catch { onProgress({ event: 'rollback_failed' }); }
      active = false;
    }
    throw error;
  } finally {
    try { await db.query(`SET FOREIGN_KEY_CHECKS=${originalForeignKeys}`); }
    catch (error) { if (!primaryError) throw error; }
  }
}
