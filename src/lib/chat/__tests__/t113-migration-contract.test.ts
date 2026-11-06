/** T-113: source-level migration guard only. No database is contacted here.
 * Actual MariaDB DDL semantics, restart, old/new coexistence and owner isolation
 * require separately isolated integration tests and are not established by this file.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const schema = fs.readFileSync(path.join(root, 'src/lib/db.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'scripts/migrations/T-113-chat-ownership.sql'), 'utf8');
const create = schema.match(/CREATE TABLE IF NOT EXISTS chat_threads\s*\(([\s\S]*?)\) ENGINE=InnoDB/)?.[1];
const statements = migration
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')
  .split(';')
  .map((statement) => statement.trim())
  .filter(Boolean);

describe('T-113 chat ownership migration source contract', () => {
  test('new databases get a nullable owner and owner-scoped listing index', () => {
    expect(create).toBeDefined();
    expect(create).toMatch(/\buser_id\s+INT\s+UNSIGNED\s+NULL\s+DEFAULT\s+NULL\b/i);
    expect(create).toMatch(/INDEX\s+idx_chat_threads_user_archived_updated\s*\(\s*user_id\s*,\s*archived\s*,\s*updated_at\s*\)/i);
  });

  test('manual migration is a single schema change and does not assign or delete legacy rows', () => {
    expect(statements).toHaveLength(2);
    expect(statements[0]).toMatch(/^SET SESSION lock_wait_timeout\s*=\s*5$/i);
    expect(statements[1]).toMatch(/^ALTER TABLE chat_threads\b/i);
    expect(statements[1]).toMatch(/ADD COLUMN user_id\s+INT\s+UNSIGNED\s+NULL\s+DEFAULT\s+NULL/i);
    expect(statements[1]).toMatch(/ADD INDEX idx_chat_threads_user_archived_updated\s*\(\s*user_id\s*,\s*archived\s*,\s*updated_at\s*\)/i);
    expect(statements.join('\n')).not.toMatch(/\b(?:UPDATE|DELETE|INSERT|DROP|TRUNCATE|REPLACE)\s+(?:INTO\s+|FROM\s+)?(?:chat_threads|chat_messages)\b/i);
    expect(statements[1]).not.toMatch(/\bIF\s+NOT\s+EXISTS\b/i);
  });

  test('startup schema does not automatically alter existing chat tables or assign owners', () => {
    expect(schema).not.toMatch(/ALTER\s+TABLE\s+chat_threads\b/i);
    expect(schema).not.toMatch(/UPDATE\s+chat_threads\s+SET\s+user_id\b/i);
  });
});
