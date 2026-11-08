import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';

export const PREFIX = 't156_research_';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function identifier(value) {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(value)) throw new Error('invalid_identifier');
  return '`' + value + '`';
}
export function mapStatement(sql, tables) {
  // Only an operator-created mariadb-dump is supported, never arbitrary SQL.
  if (/^\s*(?:--|\/\*!)/.test(sql)) return null;
  if (/^SET\s/i.test(sql)) {
    if (!/^SET (?:@OLD_|SQL_MODE|TIME_ZONE|FOREIGN_KEY_CHECKS|UNIQUE_CHECKS|CHARACTER_SET_CLIENT|CHARACTER_SET_RESULTS|COLLATION_CONNECTION|NAMES)/i.test(sql)) throw new Error('unsupported_dump_set');
    return sql;
  }
  const m = sql.match(/^(CREATE TABLE|INSERT INTO) `([a-z][a-z0-9_]*)`/);
  if (!m || !tables.includes(m[2])) throw new Error('unsupported_dump_statement');
  let mapped = sql.replace(/^(CREATE TABLE|INSERT INTO) `([a-z][a-z0-9_]*)`/, (_whole, verb, name) => verb + ' ' + identifier(PREFIX + name));
  if (m[1] === 'CREATE TABLE') {
    mapped = mapped.replace(/REFERENCES `([a-z][a-z0-9_]*)`/g, (_whole, name) => {
      if (!tables.includes(name)) throw new Error('unmapped_foreign_key');
      return 'REFERENCES ' + identifier(PREFIX + name);
    }).replace(/CONSTRAINT `([a-z][a-z0-9_]*)`/g, (_whole, name) => 'CONSTRAINT ' + identifier(PREFIX + name));
  }
  return mapped;
}
export async function* statements(path) {
  const input = createReadStream(path).pipe(createGunzip());
  const lines = createInterface({ input, crlfDelay: Infinity });
  let statement = '';
  for await (const line of lines) {
    if (!statement && (!line.trim() || /^--/.test(line) || /^\/\*M!/.test(line))) continue;
    if (!statement && /^\/\*!.*;\s*$/.test(line)) continue;
    statement += line + '\n';
    if (/;\s*$/.test(line)) { yield statement.trim(); statement = ''; }
  }
  if (statement.trim()) throw new Error('incomplete_dump');
}
export async function executeDumpStatement(db, sql) {
  // A full SEC body can exceed max_allowed_packet after HEX encoding. Use
  // session variables for large blobs; every wire statement stays below 1MiB.
  let seq = 0;
  const pieces = [];
  // Scan SQL tokens so HEX-like text inside a quoted source document is untouched.
  let rewritten = '', start = 0, i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch; i++;
      while (i < sql.length) {
        if (sql[i] === '\\') { i += 2; continue; }
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) { i += 2; continue; }
          i++; break;
        }
        i++;
      }
      continue;
    }
    if (ch === '0' && sql[i + 1] === 'x' && (i === 0 || !/[A-Za-z0-9_]/.test(sql[i - 1]))) {
      let end = i + 2;
      while (end < sql.length && /[0-9a-fA-F]/.test(sql[end])) end++;
      if (end - i - 2 >= 1048576) {
        const variable = '@t156_part_' + seq++;
        pieces.push({ variable, hex: sql.slice(i + 2, end) });
        rewritten += sql.slice(start, i) + variable;
        start = end;
      }
      i = end; continue;
    }
    i++;
  }
  rewritten += sql.slice(start);
  for (const { variable, hex } of pieces) {
    await db.query(`SET ${variable}=UNHEX('')`);
    for (let i = 0; i < hex.length; i += 524288) {
      await db.query(`SET ${variable}=CONCAT(${variable},UNHEX(?))`, [hex.slice(i, i + 524288)]);
    }
  }
  try { await db.query(rewritten); }
  finally { for (const { variable } of pieces) await db.query(`SET ${variable}=NULL`); }
}
