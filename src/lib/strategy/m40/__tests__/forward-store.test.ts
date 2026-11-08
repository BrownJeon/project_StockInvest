import type { ArchiveQueryable } from '@/lib/analysis-data/types';
import type { ForwardPolicy } from '../forward-types';
import { PAPER_ACCOUNT_ID, PAPER_STRATEGY_ID, type PaperBook, type PaperIntent } from '../paper-ledger';
import { acquirePaperLease, commitPaperCycle, FORWARD_POLICY_ID, initializePaperAccount,
  loadPaperAccount, loadPendingPaperIntents, requirePaperDryRun, type PaperCommit } from '../forward-store';

jest.mock('@/lib/db', () => ({ getPool: () => { throw new Error('unexpected_real_database'); } }));

const policy = (): ForwardPolicy => ({ policyId: FORWARD_POLICY_ID, strategyId: PAPER_STRATEGY_ID,
  registeredAt: '2026-11-08T03:00:00Z', referenceSymbols: ['NAS:TEST'], frozenCohort: null, epochSession: null });
const positions = () => [{ currency: 'USD', qty: 100, price: 1400, src: 'CTRP6504R' },
  { currency: 'NAS:TEST', qty: 2, price: 140000 }];
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** Small in-memory transactional double. Every unrecognized SQL fails closed. */
class Fixture {
  dry: unknown = true;
  source = positions();
  account: Record<string, any> | null = null;
  cycles: Record<string, any>[] = [];
  signals: Record<string, any>[] = [];
  calls: string[] = [];
  failSignalInsert = false;
  backup: { account: Record<string, any> | null; cycles: Record<string, any>[]; signals: Record<string, any>[] } | null = null;
  db = this as unknown as ArchiveQueryable;
  async getConnection() { return this; }
  async beginTransaction() { this.backup = copy({ account: this.account, cycles: this.cycles, signals: this.signals }); }
  async commit() { this.backup = null; }
  async rollback() { if (this.backup) Object.assign(this, this.backup); this.backup = null; }
  release() {} destroy() {}
  async query(sql: string, p: any[] = []): Promise<any> {
    this.calls.push(sql);
    if (sql.includes('FROM system_config')) return [this.dry === undefined ? [] : [{ value: JSON.stringify(this.dry) }], []];
    if (sql.includes('FROM portfolio_snapshots')) return [[{ id: 1, source_at: '2026-11-08T11:00:00+09:00', positions: JSON.stringify(this.source) }], []];
    if (sql.startsWith('SELECT id,policy_json')) return [this.account ? [copy(this.account)] : [], []];
    if (sql.startsWith('SELECT intent_json')) return [this.signals.filter(s => s.status === 'awaiting_open').map(s => ({ intent_json: s.payload, recorded_at: s.recordedAt })), []];
    if (sql.startsWith('INSERT INTO t156_paper_account')) {
      if (!this.account) this.account = { id: p[0], status: 'active', policy_json: p[1], clone_json: p[2], state_json: p[3], revision: 0, lease_token: null, busy: 0, lease_valid: 0 };
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes('FROM t156_paper_account WHERE') && sql.includes('FOR UPDATE')) return [this.account ? [copy(this.account)] : [], []];
    if (sql.startsWith('UPDATE t156_paper_account SET lease_token=?')) {
      Object.assign(this.account!, { lease_token: p[0], busy: 1, lease_valid: 1 }); return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('SELECT id FROM t156_paper_cycle')) return [this.cycles.filter(c => c.session === p[1] && c.mode === p[2]), []];
    if (sql.startsWith('INSERT INTO t156_paper_cycle')) {
      this.cycles.push({ id: p[0], session: p[2], mode: p[4], payload: p[5] }); return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('INSERT INTO t156_paper_signal')) {
      if (this.failSignalInsert) throw new Error('fixture_signal_insert_failed');
      this.signals.push({ id: p[0], status: p[6], payload: p[7], scope: 'paper_only' }); return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('UPDATE t156_paper_signal SET')) {
      const item = this.signals.find(s => s.id === p[2] && s.scope === 'paper_only' && s.status === 'awaiting_open');
      if (item) { item.status = p[0]; item.outcome = p[1]; }
      return [{ affectedRows: item ? 1 : 0 }, []];
    }
    if (sql.startsWith('UPDATE t156_paper_account SET policy_json')) {
      Object.assign(this.account!, { policy_json: p[0], state_json: p[1], revision: this.account!.revision + 1, lease_token: null, busy: 0, lease_valid: 0 });
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`unexpected_fixture_sql: ${sql}`);
  }
}

const baseBook = (): PaperBook => ({ cashUsd: 100, receivables: [], holdings: [], initialEquityUsd: 100,
  peakEquityUsd: 100, lastForwardSession: null, splitBasis: {} });
function request(lease: NonNullable<Awaited<ReturnType<typeof acquirePaperLease>>>, overrides: Partial<PaperCommit> = {}): PaperCommit {
  return { lease, policy: policy(), book: baseBook(), cycle: { id: 'a'.repeat(64), session: '2026-11-09',
    decisionAt: '2026-11-09T22:00:00Z', mode: 'forward', payload: {} }, signals: [], outcomes: [], ...overrides };
}
function intent(cycleId: string): PaperIntent { return { id: 'm40p_test', accountId: PAPER_ACCOUNT_ID, cycleId,
  session: '2026-11-09', createdAt: '2026-11-09T22:00:00Z', symbol: 'NAS:TEST', side: 'buy', quantity: 1,
  executeSession: '2026-11-10', executionScope: 'paper_only', status: 'awaiting_open', maxDebitUsd: 100,
  sourceRunId: 'test', inputSha256: 'b'.repeat(64), reason: 'fixture', feePerSide: .0025, fillModel: 'next_open_fixed_quantity_or_expire' }; }

test.each([false, undefined, 'true', 1, null])('only literal DB boolean true permits paper processing (%p)', async value => {
  const f = new Fixture(); f.dry = value;
  await expect(requirePaperDryRun(f.db)).rejects.toThrow('m40_forward_requires_dry_run');
  await expect(initializePaperAccount(policy(), f.db)).rejects.toThrow('m40_forward_requires_dry_run');
  expect(f.account).toBeNull();
});

test('initial copy is independent and initialization never recopies a changed live snapshot', async () => {
  const f = new Fixture(); const first = await initializePaperAccount(policy(), f.db);
  f.source[0].qty = 999; f.source[1].qty = 99;
  const second = await initializePaperAccount(policy(), f.db);
  expect(second).toEqual(first); expect(second.book.cashUsd).toBe(100); expect(second.cloneSha256).toBe(first.cloneSha256);
  expect(f.calls.filter(s => s.includes('FROM portfolio_snapshots'))).toHaveLength(1);
});

test('lease prevents a second worker; expired token, changed revision and DRY_RUN change cannot commit', async () => {
  const f = new Fixture(); await initializePaperAccount(policy(), f.db);
  const lease = (await acquirePaperLease(f.db))!; expect(await acquirePaperLease(f.db)).toBeNull();
  f.account!.lease_valid = 0;
  await expect(commitPaperCycle(request(lease), f.db)).rejects.toThrow('paper_lease_or_revision_conflict');
  f.account!.lease_valid = 1; f.account!.revision++;
  await expect(commitPaperCycle(request(lease), f.db)).rejects.toThrow('paper_lease_or_revision_conflict');
  f.account!.revision--; f.dry = false;
  await expect(commitPaperCycle(request(lease), f.db)).rejects.toThrow('m40_forward_requires_dry_run');
  expect(f.cycles).toHaveLength(0);
});

test('paused accounts cannot acquire a lease or commit after a mid-flight pause', async () => {
  const f = new Fixture(); await initializePaperAccount(policy(), f.db);
  f.account!.status = 'paused';
  await expect(acquirePaperLease(f.db)).rejects.toThrow('paper_account_paused');
  expect(f.account!.lease_token).toBeNull();
  f.account!.status = 'active'; const lease = (await acquirePaperLease(f.db))!;
  f.account!.status = 'paused';
  await expect(commitPaperCycle(request(lease), f.db)).rejects.toThrow('paper_lease_or_revision_conflict');
  expect(f.cycles).toHaveLength(0); expect(f.signals).toHaveLength(0);
});

test('frozen cohort and T0 cannot be changed and a duplicate cycle never mutates the book', async () => {
  const f = new Fixture(); await initializePaperAccount(policy(), f.db);
  const lease = (await acquirePaperLease(f.db))!;
  const fixed = { ...policy(), epochSession: '2026-11-09', epochLockedAt: '2026-11-09T22:00:00Z', frozenCohort: { symbols: ['NAS:TEST'], excluded: [], asOfSession: '2026-11-09', frozenAt: '2026-11-09T22:00:00Z' } };
  expect(await commitPaperCycle(request(lease, { policy: fixed }), f.db)).toBe(true);
  const next = (await acquirePaperLease(f.db))!; const before = copy(f.account);
  await expect(commitPaperCycle(request(next, { policy: { ...fixed, epochSession: '2026-11-10' } }), f.db)).rejects.toThrow('paper_fixed_policy_changed');
  await expect(commitPaperCycle(request(next, { policy: { ...fixed, epochLockedAt: '2026-11-10T22:00:00Z' } }), f.db)).rejects.toThrow('paper_fixed_policy_changed');
  await expect(commitPaperCycle(request(next, { policy: { ...fixed, frozenCohort: { ...fixed.frozenCohort, symbols: ['NAS:OTHER'] } } }), f.db)).rejects.toThrow('paper_fixed_policy_changed');
  await expect(commitPaperCycle(request(next, { policy: { ...fixed, referenceSymbols: ['NAS:OTHER'] } }), f.db)).rejects.toThrow('paper_fixed_policy_changed');
  await expect(commitPaperCycle(request(next, { policy: { ...fixed, strategyId: 'other' as never } }), f.db)).rejects.toThrow('paper_fixed_policy_changed');
  expect(await commitPaperCycle(request(next, { policy: fixed, book: { ...baseBook(), cashUsd: 999 } }), f.db)).toBe(false);
  expect(f.account).toEqual(before); expect(f.cycles).toHaveLength(1);
});

test('a changed clone source is rejected at read and lease acquisition', async () => {
  const f = new Fixture(); await initializePaperAccount(policy(), f.db);
  const clone = JSON.parse(f.account!.clone_json);
  clone.source.positions[0].qty = 999;
  f.account!.clone_json = JSON.stringify(clone);
  await expect(loadPaperAccount(f.db)).rejects.toThrow('paper_clone_hash_mismatch');
  await expect(acquirePaperLease(f.db)).rejects.toThrow('paper_clone_hash_mismatch');
  expect(f.account!.lease_token).toBeNull(); expect(f.account!.busy).toBe(0);
});

test('T0 requires a matching forward cycle and the exact persisted decision clock', async () => {
  const f = new Fixture(); await initializePaperAccount(policy(), f.db); const lease = (await acquirePaperLease(f.db))!;
  const c = request(lease);
  for (const p of [
    { ...policy(), epochSession: c.cycle.session },
    { ...policy(), epochSession: '2026-11-10', epochLockedAt: c.cycle.decisionAt },
    { ...policy(), epochSession: c.cycle.session, epochLockedAt: '2026-11-09T21:59:59Z' },
  ]) await expect(commitPaperCycle({ ...c, policy: p }, f.db)).rejects.toThrow('paper_epoch_not_first_eligible');
  await expect(commitPaperCycle({ ...c, cycle: { ...c.cycle, mode: 'rehearsal' },
    policy: { ...policy(), epochSession: c.cycle.session, epochLockedAt: c.cycle.decisionAt } }, f.db)).rejects.toThrow('paper_epoch_not_first_eligible');
  expect(f.cycles).toHaveLength(0); expect((await loadPaperAccount(f.db))?.policy.epochSession).toBeNull();
});

test('pending signals use DB insertion time instead of an untrusted intent clock', async () => {
  const f = new Fixture(); const saved = intent('a'.repeat(64));
  saved.createdAt = '2026-11-09T22:00:00Z';
  f.signals.push({ id: saved.id, status: 'awaiting_open', payload: JSON.stringify(saved), recordedAt: '2026-11-10T14:30:00.123456Z' });
  const rows = await loadPendingPaperIntents(f.db);
  expect(rows).toHaveLength(1); expect(rows[0].createdAt).toBe('2026-11-10T14:30:00.123456Z');
});

test('cycle, signal and book revision roll back together if signal insertion fails', async () => {
  const f = new Fixture(); await initializePaperAccount(policy(), f.db); const lease = (await acquirePaperLease(f.db))!;
  const c = request(lease); c.signals = [intent(c.cycle.id)]; const before = await loadPaperAccount(f.db);
  f.failSignalInsert = true;
  await expect(commitPaperCycle(c, f.db)).rejects.toThrow('fixture_signal_insert_failed');
  expect(f.cycles).toHaveLength(0); expect(f.signals).toHaveLength(0); expect(await loadPaperAccount(f.db)).toEqual(before);
});

test('a successful outcome and revised book are committed together with the new cycle', async () => {
  const f = new Fixture(); await initializePaperAccount(policy(), f.db); const lease = (await acquirePaperLease(f.db))!;
  f.signals.push({ id: 'm40p_old', status: 'awaiting_open', scope: 'paper_only' });
  const c = request(lease, { book: { ...baseBook(), cashUsd: 90 } });
  c.signals = [intent(c.cycle.id)];
  c.outcomes = [{ id: 'm40p_old', status: 'filled', reason: 'modeled_open_not_broker_execution', quantity: 1, observedAt: '2026-11-10T22:00:00Z' }];
  expect(await commitPaperCycle(c, f.db)).toBe(true);
  expect(f.cycles).toHaveLength(1); expect(f.signals).toHaveLength(2);
  expect(f.signals.find(s => s.id === 'm40p_old')?.status).toBe('filled');
  expect((await loadPaperAccount(f.db))?.book.cashUsd).toBe(90);
  expect((await loadPaperAccount(f.db))?.revision).toBe(1);
});

test('stale outcome or non-paper signal cannot partially commit a cycle', async () => {
  const f = new Fixture(); await initializePaperAccount(policy(), f.db); const lease = (await acquirePaperLease(f.db))!;
  const c = request(lease); c.signals = [intent(c.cycle.id)];
  c.outcomes = [{ id: 'missing', status: 'filled', reason: 'fixture', quantity: 1, observedAt: '2026-11-10T22:00:00Z' }];
  await expect(commitPaperCycle(c, f.db)).rejects.toThrow('paper_fill_revision_conflict');
  expect(f.cycles).toHaveLength(0); expect(f.signals).toHaveLength(0);
  c.outcomes = []; c.signals[0].executionScope = 'live' as never;
  await expect(commitPaperCycle(c, f.db)).rejects.toThrow('paper_signal_scope_invalid');
  expect(f.cycles).toHaveLength(0); expect(f.signals).toHaveLength(0);
});

test('forecast sidecar storage failure cannot undo a committed paper cycle or request a second pool connection', async()=>{
 const f=new Fixture();await initializePaperAccount(policy(),f.db);
 const lease=await acquirePaperLease(f.db);expect(lease).not.toBeNull();
 const getConnection=jest.spyOn(f,'getConnection');
 const revision=f.account!.revision;
 await expect(commitPaperCycle(request(lease!),f.db)).resolves.toBe(true);
 expect(f.account!.revision).toBe(revision+1);expect(f.cycles).toHaveLength(1);
 expect(f.calls.some(sql=>sql.startsWith('INSERT INTO t156_forecast_continuation'))).toBe(true);
 // Fixture rejects the new INSERT. It must run on the committed dedicated connection.
 expect(getConnection).toHaveBeenCalledTimes(1);expect(f.backup).toBeNull();
});

test('permanently waiting sidecar is bounded and destroys rather than releases its in-use connection',async()=>{
 jest.useFakeTimers();try{
 const f=new Fixture();await initializePaperAccount(policy(),f.db);const lease=await acquirePaperLease(f.db);
 const original=f.query.bind(f);jest.spyOn(f,'query').mockImplementation((sql:string,p:any[]=[])=>sql.startsWith('INSERT INTO t156_forecast_continuation')?new Promise(()=>{}):original(sql,p));
 const destroy=jest.spyOn(f,'destroy'),release=jest.spyOn(f,'release');
 const pending=commitPaperCycle(request(lease!),f.db);await jest.advanceTimersByTimeAsync(1501);
 await expect(pending).resolves.toBe(true);expect(f.cycles).toHaveLength(1);expect(destroy).toHaveBeenCalledTimes(1);expect(release).not.toHaveBeenCalled();
 }finally{jest.useRealTimers();}
});
