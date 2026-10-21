/**
 * 시험 전용 — `INSERT … ON DUPLICATE KEY UPDATE` 한 문장을 MariaDB 의미대로 흉내 내는 작은 해석기 (T-059 C-2·C-4).
 *
 * 코드의 **실제 SQL 문자열**을 그대로 해석한다(조건을 시험에 다시 적지 않는다 — 조건이 바뀌면 결과가 바뀐다).
 * 지원 범위: 컬럼 목록 + `VALUES (?, CURDATE(), 'lit', NOW(), …)` 또는 대량 `VALUES ?`,
 * 대입식의 `VALUES(c)`·열 이름·`COALESCE(a,b)`·`IF(cond,a,b)`·`GREATEST(a,b)`·`NOW()`, 조건의 `> >= = OR AND ()`.
 * MariaDB 처럼 대입은 **왼쪽부터** 적용되고 뒤 식은 앞에서 갱신된 값을 본다.
 */
type Row = Record<string, unknown>;

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, quote = false, cur = '';
  for (const ch of s) {
    if (ch === "'") quote = !quote;
    if (!quote && ch === '(') depth++;
    if (!quote && ch === ')') depth--;
    if (!quote && depth === 0 && ch === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function toJs(expr: string, cols: Set<string>): string {
  let e = expr.replace(/\s+/g, ' ');
  e = e.replace(/\bNOW\(\)/g, "'@now'").replace(/\bCURDATE\(\)/g, "'@today'");
  e = e.replace(/\bVALUES\((\w+)\)/g, (_m, c) => `N[${JSON.stringify(c)}]`);
  e = e.replace(/\bCOALESCE\(/g, '__co(').replace(/\bIF\(/g, '__if(').replace(/\bGREATEST\(/g, '__gr(');
  e = e.replace(/\bOR\b/g, '||').replace(/\bAND\b/g, '&&');
  e = e.replace(/(^|[^<>=!])=(?!=)/g, '$1===');
  e = e.replace(/(^|[^\w"[.])([a-z_][a-z0-9_]*)\b(?!\s*\(|")/g, (m, pre, id) => (cols.has(id) ? `${pre}O[${JSON.stringify(id)}]` : m));
  return e;
}

const helpers = {
  __co: (a: unknown, b: unknown) => (a ?? b),
  __if: (c: unknown, a: unknown, b: unknown) => (c ? a : b),
  __gr: (a: unknown, b: unknown) => (a == null || b == null ? null : (a > b ? a : b)),   // MariaDB: NULL 이면 NULL
};

export class UpsertSim {
  rows = new Map<string, Row>();
  constructor(private readonly keyCols: string[]) {}

  exec(sql: string, params: unknown[]): void {
    const s = sql.replace(/\s+/g, ' ').trim();
    const m = /^INSERT INTO \w+ \(([^)]*)\) VALUES (\?|\((.*?)\)) ON DUPLICATE KEY UPDATE (.*)$/.exec(s);
    if (!m) throw new Error(`UpsertSim: 해석할 수 없는 SQL — ${s.slice(0, 80)}`);
    const cols = m[1].split(',').map((c) => c.trim());
    const colSet = new Set(cols);
    const assigns = splitTop(m[4]).map((a) => {
      const i = a.indexOf('=');
      return { col: a.slice(0, i).trim(), fn: new Function('O', 'N', '__co', '__if', '__gr', `return (${toJs(a.slice(i + 1), colSet)});`) };
    });
    const tuples: unknown[][] = [];
    if (m[2] === '?') {
      tuples.push(...(params[0] as unknown[][]));
    } else {
      const tmpl = splitTop(m[3]);
      let pi = 0;
      tuples.push(tmpl.map((t) => (t === '?' ? params[pi++] : t === 'CURDATE()' ? '@today' : t === 'NOW()' ? '@now' : t.replace(/^'(.*)'$/, '$1'))));
    }
    for (const t of tuples) {
      const N: Row = Object.fromEntries(cols.map((c, i) => [c, t[i] ?? null]));
      const key = this.keyCols.map((k) => String(N[k])).join('|');
      const O = this.rows.get(key);
      if (!O) { this.rows.set(key, { ...N }); continue; }
      for (const a of assigns) O[a.col] = a.fn(O, N, helpers.__co, helpers.__if, helpers.__gr);
    }
  }

  only(): Row {
    if (this.rows.size !== 1) throw new Error(`rows=${this.rows.size}`);
    return [...this.rows.values()][0];
  }
}
