/**
 * T-074 시험용 메모리 가짜 DB — store.ts 가 보내는 SQL 만 정확히 알아듣는다(모르는 SQL 은 던진다 → 새 SQL 이 몰래 생기면 시험이 깨진다).
 * 흉내 내는 의미: UNIQUE(uq_cfl_client_entry·uq_cfl_live_dup·uq_cfl_supersedes)·CHECK(금액>0·원 정수·분 단위)·조건부 UPDATE 영향 행 수·
 * system_config 버전 조건·트랜잭션 롤백(BEGIN 시점으로 되돌림). 값 모양은 mysql2 와 같게 DECIMAL = 문자열, DATETIME = 문자열(dateStrings).
 * 실제 MariaDB 의미는 `t074-disposable-mariadb.test.ts` 가 확인한다.
 */
import type { SnapshotRowLike } from '../../snapshots';

export interface LedgerDbRow {
  id: number;
  account_id: number;
  client_entry_id: string;
  kind: string;
  occurred_at: string;
  currency: string;
  amount: string;
  counter_currency: string | null;
  counter_amount: string | null;
  fx_rate_used: string | null;
  fx_source: string | null;
  krw_equiv: string | null;
  anchor_snapshot_id: number | null;
  anchor_snapshot_ts: string | null;
  anchor_status: string;
  anchor_detail: string | null;
  memo: string | null;
  source: string;
  supersedes_id: number | null;
  created_at: string;
  created_by_user_id: number | null;
  deleted_at: string | null;
  deleted_by_user_id: number | null;
  delete_reason: string | null;
}

const norm = (sql: string) => sql.replace(/\s+/g, ' ').trim();

function dupErr(key: string, entry = 'x'): Error {
  const msg = `Duplicate entry '${entry}' for key '${key}'`;
  return Object.assign(new Error(msg), { code: 'ER_DUP_ENTRY', errno: 1062, sqlMessage: msg });
}
function checkErr(name: string): Error {
  const msg = `CONSTRAINT \`${name}\` failed for \`t074\`.\`cash_flow_ledger\``;
  return Object.assign(new Error(msg), { code: 'ER_CONSTRAINT_FAILED', errno: 4025, sqlMessage: msg });
}

export class FakeDb {
  ledger: LedgerDbRow[] = [];
  config = new Map<string, string>();
  snapshots: SnapshotRowLike[] = [];
  nextId = 1;
  log: { sql: string; params: unknown[] }[] = [];
  /** cash_flow_ledger 테이블 없음(마이그레이션 전) */
  noTable = false;
  /** 이 정규식에 맞는 다음 SQL 1회를 실패시킨다 */
  failOnce: RegExp | null = null;
  /** 조건부 UPDATE 직전에 끼어드는 동작(경합 재현) */
  beforeUpdate: ((sql: string) => void) | null = null;
  private tx: { ledger: LedgerDbRow[]; config: Map<string, string>; nextId: number } | null = null;

  writes() {
    return this.log.filter((l) => /^\s*(INSERT|UPDATE|DELETE|REPLACE|ALTER|CREATE|DROP|TRUNCATE)/i.test(l.sql));
  }

  pool() {
    return {
      query: (sql: string, params: unknown[] = []) => this.query(sql, params),
      getConnection: async () => ({
        query: (sql: string, params: unknown[] = []) => this.query(sql, params),
        beginTransaction: async () => {
          this.log.push({ sql: 'BEGIN', params: [] });
          this.tx = { ledger: this.ledger.map((r) => ({ ...r })), config: new Map(this.config), nextId: this.nextId };
        },
        commit: async () => { this.log.push({ sql: 'COMMIT', params: [] }); this.tx = null; },
        rollback: async () => {
          this.log.push({ sql: 'ROLLBACK', params: [] });
          if (this.tx) { this.ledger = this.tx.ledger; this.config = this.tx.config; this.nextId = this.tx.nextId; }
          this.tx = null;
        },
        release: () => { /* noop */ },
      }),
    };
  }

  private liveConflict(row: Pick<LedgerDbRow, 'account_id' | 'kind' | 'currency' | 'amount' | 'occurred_at'>, exceptId: number | null): LedgerDbRow | undefined {
    return this.ledger.find((r) => r.id !== exceptId && r.deleted_at == null && r.account_id === row.account_id && r.kind === row.kind
      && r.currency === row.currency && Number(r.amount) === Number(row.amount) && r.occurred_at === row.occurred_at);
  }

  async query(sqlRaw: string, params: unknown[] = []): Promise<[unknown, unknown]> {
    const sql = norm(sqlRaw);
    this.log.push({ sql, params });
    if (this.failOnce && this.failOnce.test(sql)) {
      this.failOnce = null;
      throw Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });
    }
    if (this.noTable && /cash_flow_ledger/.test(sql)) {
      throw Object.assign(new Error("Table 't074.cash_flow_ledger' doesn't exist"), { code: 'ER_NO_SUCH_TABLE', errno: 1146 });
    }

    // ── system_config ──
    if (/^SELECT value FROM system_config WHERE `key` = \? LIMIT 1$/.test(sql)) {
      const v = this.config.get(String(params[0]));
      return [v === undefined ? [] : [{ value: v }], []];
    }
    if (/^INSERT INTO system_config \(`key`, value\) VALUES \(\?, \?\)$/.test(sql)) {
      const k = String(params[0]);
      if (this.config.has(k)) throw dupErr('PRIMARY', k);
      JSON.parse(String(params[1]));   // CHECK (json_valid(value))
      this.config.set(k, String(params[1]));
      return [{ affectedRows: 1, insertId: 0 }, []];
    }
    if (/^UPDATE system_config SET value = \? WHERE `key` = \? AND CAST\(JSON_EXTRACT\(value, '\$\.version'\) AS UNSIGNED\) = \?$/.test(sql)) {
      this.beforeUpdate?.(sql);
      const k = String(params[1]);
      const cur = this.config.get(k);
      if (cur === undefined || Number(JSON.parse(cur).version) !== Number(params[2])) return [{ affectedRows: 0 }, []];
      this.config.set(k, String(params[0]));
      return [{ affectedRows: 1 }, []];
    }

    // ── cash_flow_ledger 읽기 ──
    if (/^SELECT 1 FROM cash_flow_ledger LIMIT 0$/.test(sql)) return [[], []];   // 표 존재 확인(QA D-2)
    if (/^SELECT id, client_entry_id, .* FROM cash_flow_ledger WHERE account_id = \? ORDER BY occurred_at ASC, id ASC$/.test(sql)) {
      const rows = this.ledger.filter((r) => r.account_id === params[0]).sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : a.id - b.id));
      return [rows.map((r) => ({ ...r })), []];
    }
    if (/^SELECT id, client_entry_id, .* FROM cash_flow_ledger WHERE id = \? AND account_id = \? LIMIT 1( FOR UPDATE)?$/.test(sql)) {
      const r = this.ledger.find((x) => x.id === params[0] && x.account_id === params[1]);
      return [r ? [{ ...r }] : [], []];
    }
    if (/^SELECT id, client_entry_id, .* FROM cash_flow_ledger WHERE client_entry_id = \? LIMIT 1$/.test(sql)) {
      const r = this.ledger.find((x) => x.client_entry_id === params[0]);
      return [r ? [{ ...r }] : [], []];
    }
    if (/^SELECT id FROM cash_flow_ledger WHERE account_id = \? AND kind = \? AND currency = \? AND amount = \? AND occurred_at = \? AND deleted_at IS NULL LIMIT 1$/.test(sql)) {
      const r = this.liveConflict({ account_id: params[0] as number, kind: String(params[1]), currency: String(params[2]), amount: String(params[3]), occurred_at: String(params[4]) }, null);
      return [r ? [{ id: r.id }] : [], []];
    }
    if (/^SELECT id FROM cash_flow_ledger WHERE supersedes_id = \? LIMIT 1 LOCK IN SHARE MODE$/.test(sql)) {
      const r = this.ledger.find((x) => x.supersedes_id === params[0]);
      return [r ? [{ id: r.id }] : [], []];
    }

    // ── cash_flow_ledger 쓰기 ──
    if (/^INSERT INTO cash_flow_ledger \(account_id, client_entry_id, kind, occurred_at, currency, amount, counter_currency, counter_amount, memo, source, supersedes_id, created_at, created_by_user_id\) VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, \?, 'user', \?, \?, \?\)$/.test(sql)) {
      const [account_id, client_entry_id, kind, occurred_at, currency, amount, counter_currency, counter_amount, memo, supersedes_id, created_at, created_by_user_id] = params;
      const row: LedgerDbRow = {
        id: this.nextId, account_id: account_id as number, client_entry_id: String(client_entry_id), kind: String(kind), occurred_at: String(occurred_at),
        currency: String(currency), amount: Number(amount).toFixed(2), counter_currency: (counter_currency as string) ?? null,
        counter_amount: counter_amount == null ? null : Number(counter_amount).toFixed(2), fx_rate_used: null, fx_source: null, krw_equiv: null,
        anchor_snapshot_id: null, anchor_snapshot_ts: null, anchor_status: 'pending', anchor_detail: null, memo: (memo as string) ?? null, source: 'user',
        supersedes_id: (supersedes_id as number) ?? null, created_at: String(created_at), created_by_user_id: (created_by_user_id as number) ?? null,
        deleted_at: null, deleted_by_user_id: null, delete_reason: null,
      };
      if (!(Number(row.amount) > 0)) throw checkErr('chk_cfl_amount');
      if (row.currency === 'KRW' && !Number.isInteger(Number(amount))) throw checkErr('chk_cfl_krw_int');
      if (!/:00$/.test(row.occurred_at)) throw checkErr('chk_cfl_minute');
      if ((row.kind === 'exchange') !== (row.counter_currency != null && row.counter_amount != null)) throw checkErr('chk_cfl_exch');
      if (this.ledger.some((r) => r.client_entry_id === row.client_entry_id)) throw dupErr('uq_cfl_client_entry', row.client_entry_id);
      if (this.liveConflict(row, null)) throw dupErr('uq_cfl_live_dup');
      if (row.supersedes_id != null && this.ledger.some((r) => r.supersedes_id === row.supersedes_id)) throw dupErr('uq_cfl_supersedes');
      this.ledger.push(row);
      this.nextId++;
      return [{ affectedRows: 1, insertId: row.id }, []];
    }
    if (/^UPDATE cash_flow_ledger SET deleted_at = \?, deleted_by_user_id = \?, delete_reason = \? WHERE id = \? AND account_id = \? AND deleted_at IS NULL$/.test(sql)) {
      this.beforeUpdate?.(sql);
      const r = this.ledger.find((x) => x.id === params[3] && x.account_id === params[4] && x.deleted_at == null);
      if (!r) return [{ affectedRows: 0 }, []];
      r.deleted_at = String(params[0]); r.deleted_by_user_id = params[1] as number; r.delete_reason = String(params[2]);
      return [{ affectedRows: 1 }, []];
    }
    if (/^UPDATE cash_flow_ledger SET anchor_status = \?, anchor_snapshot_id = \?, anchor_snapshot_ts = \?, anchor_detail = \?, fx_rate_used = \?, fx_source = \?, krw_equiv = \? WHERE id = \? AND account_id = \? AND deleted_at IS NULL AND anchor_status = \? AND anchor_snapshot_id <=> \?$/.test(sql)) {
      this.beforeUpdate?.(sql);
      const [st, sid, sts, det, fx, fxs, krw, id, acct, oldSt, oldSid] = params;
      const r = this.ledger.find((x) => x.id === id && x.account_id === acct && x.deleted_at == null && x.anchor_status === oldSt && (x.anchor_snapshot_id ?? null) === (oldSid ?? null));
      if (!r) return [{ affectedRows: 0 }, []];
      Object.assign(r, {
        anchor_status: st, anchor_snapshot_id: sid ?? null, anchor_snapshot_ts: sts ?? null, anchor_detail: det ?? null,
        fx_rate_used: fx ?? null, fx_source: fxs ?? null, krw_equiv: krw == null ? null : Number(krw).toFixed(2),
      });
      return [{ affectedRows: 1 }, []];
    }
    if (/^UPDATE cash_flow_ledger SET deleted_at = NULL, anchor_status = 'pending', anchor_snapshot_id = NULL, anchor_snapshot_ts = NULL, anchor_detail = NULL, fx_rate_used = NULL, fx_source = NULL, krw_equiv = NULL WHERE id = \? AND account_id = \? AND deleted_at IS NOT NULL$/.test(sql)) {
      this.beforeUpdate?.(sql);
      const r = this.ledger.find((x) => x.id === params[0] && x.account_id === params[1] && x.deleted_at != null);
      if (!r) return [{ affectedRows: 0 }, []];
      if (this.liveConflict(r, r.id)) throw dupErr('uq_cfl_live_dup');
      Object.assign(r, { deleted_at: null, anchor_status: 'pending', anchor_snapshot_id: null, anchor_snapshot_ts: null, anchor_detail: null, fx_rate_used: null, fx_source: null, krw_equiv: null });
      return [{ affectedRows: 1 }, []];
    }

    // ── portfolio_snapshots (읽기 전용) ──
    const snaps = () => this.snapshots.slice().sort((a, b) => (String(a.ts) < String(b.ts) ? -1 : String(a.ts) > String(b.ts) ? 1 : Number(a.id) - Number(b.id)));
    if (/^SELECT id, ts, total_krw, positions FROM portfolio_snapshots ORDER BY ts DESC, id DESC LIMIT 1$/.test(sql)) {
      const s = snaps();
      return [s.length ? [s[s.length - 1]] : [], []];
    }
    if (/^SELECT id, ts, total_krw, positions FROM portfolio_snapshots WHERE id = \? LIMIT 1$/.test(sql)) {
      return [this.snapshots.filter((s) => s.id === params[0]), []];
    }
    if (/^SELECT id, ts, total_krw, positions FROM portfolio_snapshots WHERE ts >= \? ORDER BY ts DESC, id DESC LIMIT \?$/.test(sql)) {
      return [snaps().filter((s) => String(s.ts) >= String(params[0])).reverse().slice(0, Number(params[1])), []];
    }
    if (/^SELECT id, ts, total_krw, positions FROM portfolio_snapshots WHERE ts < \? ORDER BY ts DESC, id DESC LIMIT 1$/.test(sql)) {
      const s = snaps().filter((x) => String(x.ts) < String(params[0]));
      return [s.length ? [s[s.length - 1]] : [], []];
    }
    if (/^SELECT id, ts, total_krw, positions FROM portfolio_snapshots WHERE ts >= \? ORDER BY ts ASC, id ASC LIMIT 500$/.test(sql)) {
      return [snaps().filter((s) => String(s.ts) >= String(params[0])).slice(0, 500), []];
    }
    throw new Error(`fake-db: unexpected SQL: ${sql}`);
  }
}
