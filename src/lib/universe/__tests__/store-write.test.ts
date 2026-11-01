/**
 * T-143 m-1 — `store.ts` 쓰기 경로 시험: **전부 아니면 전무 · 409 충돌 · 롤백 · 서버 재검사**.
 *
 * 왜 이 시험이 필요한가(Reviewer m-1): 이 경로에 직접 시험이 0건이었고, DDL 이 적용되지 않아 QA 도 돌릴 수 없다.
 * 즉 **「부분 저장이 안 된다」를 아무도 확인하지 못한 상태**였다. 가짜 `Queryable`·`TxConnection` 으로
 * 질의 순서·트랜잭션 경계·충돌 분기를 고정해 Reviewer·QA 의 근거로 삼는다.
 *
 * 고정하는 것:
 *  - 수동 목록은 **개정판 번호를 명시한 INSERT 한 문장** — 부분 저장이 구조적으로 불가능하다.
 *  - `baseVersion` 불일치·중복키(1062) → **409 이고 쓰기 0건**.
 *  - 제안 `act` → `begin → INSERT 개정판 → UPDATE 제안 → commit` 순서. 그 사이 상태가 바뀌면 **rollback**(개정판도 남지 않는다).
 *  - 커밋 뒤 재조회 실패는 `saved_unreadable` — 「저장되지 않았다」고 말하지 않는다(m-2).
 *  - 제안 적용 결과를 **서버가 다시 형식 검사**한다(m-5).
 */
jest.mock('@/lib/db', () => ({ getPool: jest.fn(() => { throw new Error('pool must not be used in this test'); }) }));

import { actOnProposal, replaceManualList, type Queryable, type TxConnection } from '../store';

const NOW = Date.parse('2026-12-02T09:14:00+09:00');

interface Row { [k: string]: unknown }
interface State {
  /** 개정판: revision_no → 저장된 행 */
  revisions: Map<number, Row>;
  proposal: Row | null;
  /** 보낸 질의(정규화) */
  log: string[];
  /** 트랜잭션 사건 순서 */
  events: string[];
  /** 이 SQL 조각이 들어간 질의를 실패시킨다 */
  failOn?: string;
  /** readUniverseParts 를 몇 번째 호출부터 실패시킨다(1 부터) */
  failPartsFrom?: number;
  partsCalls: number;
  /** UPDATE 가 0행을 고친 것으로 흉내 낸다(그 사이 다른 기기가 처리) */
  updateAffectsZero?: boolean;
}

function newState(over: Partial<State> = {}): State {
  return { revisions: new Map(), proposal: null, log: [], events: [], partsCalls: 0, ...over };
}

const norm = (sql: string) => sql.replace(/\s+/g, ' ').trim();

/** 읽기·쓰기 질의를 흉내 내는 대역. mysql2 의 `[rows, fields]` 모양을 지킨다. */
function makeDb(st: State): Queryable {
  return {
    async query<T>(sql: string, params: unknown[] = []): Promise<[T, unknown]> {
      const q = norm(sql);
      st.log.push(q);
      if (st.failOn && q.includes(st.failOn)) throw new Error(`fail:${st.failOn}`);

      if (q.startsWith('SELECT value FROM system_config')) return [[] as unknown as T, undefined];

      if (q.includes('FROM overseas_universe_revision')) {
        const latest = [...st.revisions.keys()].sort((a, b) => b - a)[0];
        return [(latest == null ? [] : [st.revisions.get(latest)]) as unknown as T, undefined];
      }
      if (q.includes('FROM overseas_universe_auto')) {
        st.partsCalls += 1;
        if (st.failPartsFrom != null && st.partsCalls >= st.failPartsFrom) throw new Error('fail:parts');
        return [[] as unknown as T, undefined];
      }
      if (q.includes('FROM stock_favorites')) return [[] as unknown as T, undefined];
      if (q.includes('FROM position_state')) return [[] as unknown as T, undefined];
      if (q.includes('FROM stock_meta')) return [[] as unknown as T, undefined];
      if (q.includes('FROM overseas_universe_proposal')) {
        return [(st.proposal ? [st.proposal] : []) as unknown as T, undefined];
      }

      if (q.startsWith('INSERT INTO overseas_universe_revision')) {
        const no = Number(params[0]);
        if (st.revisions.has(no)) {
          const e = new Error('dup') as Error & { errno?: number };
          e.errno = 1062;
          throw e;
        }
        st.revisions.set(no, {
          revision_no: no, symbols: params[1], symbol_count: params[2],
          added_symbols: params[3], removed_symbols: params[4], kept_count: params[5],
          created_at: '2026-12-02 09:14:00', updated_by: params[8],
        });
        st.events.push(`insert:${no}`);
        return [{ affectedRows: 1 } as unknown as T, undefined];
      }
      if (q.startsWith('UPDATE overseas_universe_proposal')) {
        st.events.push('update');
        if (st.updateAffectsZero) return [{ affectedRows: 0 } as unknown as T, undefined];
        if (st.proposal) st.proposal = { ...st.proposal, state: q.includes("state = 'done'") ? 'done' : String(params[0]) };
        return [{ affectedRows: 1 } as unknown as T, undefined];
      }
      return [{ affectedRows: 0 } as unknown as T, undefined];
    },
  };
}

function makeConn(st: State, db: Queryable): TxConnection {
  return {
    query: db.query.bind(db),
    async beginTransaction() { st.events.push('begin'); },
    async commit() { st.events.push('commit'); },
    async rollback() {
      st.events.push('rollback');
      // 롤백 = 이 트랜잭션에서 넣은 개정판이 없어진다
      for (const no of [...st.revisions.keys()]) if (st.events.includes(`insert:${no}`)) st.revisions.delete(no);
    },
    release() { st.events.push('release'); },
    destroy() { st.events.push('destroy'); },
  };
}

const proposalRow = (over: Row = {}): Row => ({
  proposal_id: 7, symbol: 'NAS:AAAA', kind: 'delisting', basis_text: '미국 공시 Form 25', basis_source: 'us_filings',
  collected_at: null, recommendation: null, action_type: 'remove', next_symbol: null, state: 'open', held_until: null,
  ...over,
});

// ── 일괄 교체 ───────────────────────────────────────────────────────────────

describe('replaceManualList — 전부 아니면 전무', () => {
  it('🔴 저장은 INSERT **한 문장**이다 — 부분 저장이 구조적으로 불가능하다', async () => {
    const st = newState();
    const r = await replaceManualList({ symbols: ['NAS:AAAA', 'NAS:ABBB'], baseVersion: 0, actor: 'web', nowMs: NOW, db: makeDb(st) });
    expect(r.kind).toBe('ok');
    const inserts = st.log.filter((q) => q.startsWith('INSERT'));
    expect(inserts).toHaveLength(1);
    expect(st.log.filter((q) => q.startsWith('UPDATE') || q.startsWith('DELETE'))).toEqual([]);
    expect(st.revisions.get(1)?.symbols).toBe(JSON.stringify(['NAS:AAAA', 'NAS:ABBB']));
  });

  it('개정판 번호를 **명시**한다(baseVersion + 1) — 잠금 없이 충돌을 판정하는 근거', async () => {
    const st = newState({ revisions: new Map([[4, { revision_no: 4, symbols: '["NAS:AAAA"]', created_at: 'x' }]]) });
    const r = await replaceManualList({ symbols: ['NAS:ABBB'], baseVersion: 4, actor: 'web', nowMs: NOW, db: makeDb(st) });
    expect(r.kind === 'ok' && r.data.version).toBe(5);
    expect([...st.revisions.keys()].sort()).toEqual([4, 5]);
  });

  it('넣기·빼기·그대로 수를 센다(성공 문구의 짝)', async () => {
    const st = newState({ revisions: new Map([[1, { revision_no: 1, symbols: '["NAS:AAAA","NAS:ABBB"]', created_at: 'x' }]]) });
    const r = await replaceManualList({ symbols: ['NAS:ABBB', 'NAS:ACCC'], baseVersion: 1, actor: 'web', nowMs: NOW, db: makeDb(st) });
    expect(r.kind === 'ok' && r.data.applied).toEqual({ added: 1, removed: 1, kept: 1 });
  });

  it('🔴 baseVersion 이 다르면 409 이고 **쓰기 0건**', async () => {
    const st = newState({ revisions: new Map([[3, { revision_no: 3, symbols: '["NAS:AAAA"]', created_at: 'x' }]]) });
    const r = await replaceManualList({ symbols: ['NAS:ABBB'], baseVersion: 1, actor: 'web', nowMs: NOW, db: makeDb(st) });
    expect(r).toMatchObject({ kind: 'conflict', version: 3 });
    expect(st.log.filter((q) => q.startsWith('INSERT'))).toEqual([]);
  });

  it('🔴 같은 교체를 두 번 보내면 두 번째는 409(중복키 1062) — 이력이 두 벌 늘지 않는다', async () => {
    const st = newState();
    const db = makeDb(st);
    const a = await replaceManualList({ symbols: ['NAS:AAAA'], baseVersion: 0, actor: 'web', nowMs: NOW, db });
    const b = await replaceManualList({ symbols: ['NAS:AAAA'], baseVersion: 0, actor: 'web', nowMs: NOW, db });
    expect(a.kind).toBe('ok');
    expect(b.kind).toBe('conflict');
    expect(st.revisions.size).toBe(1);
  });

  it('🔴 C-2 — **첫 저장**의 기준선은 빈 목록이 아니라 폴백 목록이다(시트의 「뺄 것 N」과 결과·이력이 어긋나지 않게)', async () => {
    const ORIG = process.env.OVERSEAS_UNIVERSE_SYMBOLS;
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:AAAA,NAS:ABBB,NAS:ACCC';
    try {
      const st = newState();                        // 개정판 0건 = 전환 전
      const r = await replaceManualList({ symbols: ['NAS:ABBB', 'NAS:ZZZZ'], baseVersion: 0, actor: 'web', nowMs: NOW, db: makeDb(st) });
      expect(r.kind).toBe('ok');
      // 폴백 3종목 기준: 넣기 1(ZZZZ) · 빼기 2(AAAA·ACCC) · 그대로 1(ABBB) — 「빼기 0」이 아니다
      expect(r.kind === 'ok' && r.data.applied).toEqual({ added: 1, removed: 2, kept: 1 });
      // 개정판 1 의 이력에 **무엇이 빠졌는지**가 남는다(전환점의 유일한 기록)
      const row = st.revisions.get(1)!;
      expect(JSON.parse(String(row.removed_symbols))).toEqual(['NAS:AAAA', 'NAS:ACCC']);
      expect(JSON.parse(String(row.added_symbols))).toEqual(['NAS:ZZZZ']);
      expect(row.kept_count).toBe(1);
    } finally {
      if (ORIG === undefined) delete process.env.OVERSEAS_UNIVERSE_SYMBOLS; else process.env.OVERSEAS_UNIVERSE_SYMBOLS = ORIG;
    }
  });

  it('C-2 — 개정판이 있으면 기준선은 그 개정판이다(폴백을 섞지 않는다)', async () => {
    const ORIG = process.env.OVERSEAS_UNIVERSE_SYMBOLS;
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:ZZZZ';
    try {
      const st = newState({ revisions: new Map([[1, { revision_no: 1, symbols: '["NAS:AAAA"]', created_at: 'x' }]]) });
      const r = await replaceManualList({ symbols: ['NAS:AAAA', 'NAS:ABBB'], baseVersion: 1, actor: 'web', nowMs: NOW, db: makeDb(st) });
      expect(r.kind === 'ok' && r.data.applied).toEqual({ added: 1, removed: 0, kept: 1 });
    } finally {
      if (ORIG === undefined) delete process.env.OVERSEAS_UNIVERSE_SYMBOLS; else process.env.OVERSEAS_UNIVERSE_SYMBOLS = ORIG;
    }
  });

  it('빈 목록도 저장된다(막지 않되 화면이 경고한다 — 규칙 6)', async () => {
    const st = newState();
    const r = await replaceManualList({ symbols: [], baseVersion: 0, actor: 'web', nowMs: NOW, db: makeDb(st) });
    expect(r.kind).toBe('ok');
    expect(st.revisions.get(1)?.symbols).toBe('[]');
  });

  it('표가 없으면 not_migrated(화면은 「준비 중」)', async () => {
    const st = newState();
    const db: Queryable = {
      async query<T>(sql: string): Promise<[T, unknown]> {
        if (sql.includes('system_config')) return [[] as unknown as T, undefined];
        const e = new Error('no table') as Error & { errno?: number };
        e.errno = 1146;
        throw e;
      },
    };
    void st;
    expect(await replaceManualList({ symbols: ['NAS:AAAA'], baseVersion: 0, actor: 'web', nowMs: NOW, db })).toEqual({ kind: 'not_migrated' });
  });

  it('🔴 m-2 — 저장 뒤 요약 조회만 실패하면 `saved_unreadable`(「바뀌지 않았다」고 말하지 않는다)', async () => {
    // 일괄 교체는 INSERT 전에 개정판만 읽는다(자동 목록 조회는 저장 **뒤** 요약 때 처음 나온다) → 1번째부터 실패시킨다
    const st = newState({ failPartsFrom: 1 });
    const warn = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    // 개정판 0건이면 기준선이 폴백이다(C-2) → 수가 흔들리지 않게 환경변수를 고정한다
    const ORIG = process.env.OVERSEAS_UNIVERSE_SYMBOLS;
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:OLD1';
    try {
      const r = await replaceManualList({ symbols: ['NAS:AAAA'], baseVersion: 0, actor: 'web', nowMs: NOW, db: makeDb(st) });
      expect(r).toMatchObject({ kind: 'saved_unreadable', version: 1, applied: { added: 1, removed: 1, kept: 0 } });
      expect(st.revisions.size).toBe(1);          // 실제로 저장돼 있다
    } finally {
      if (ORIG === undefined) delete process.env.OVERSEAS_UNIVERSE_SYMBOLS; else process.env.OVERSEAS_UNIVERSE_SYMBOLS = ORIG;
      warn.mockRestore();
    }
  });
});

// ── 제안 처리 ───────────────────────────────────────────────────────────────

describe('actOnProposal — 트랜잭션·충돌·롤백', () => {
  function run(st: State, over: Partial<Parameters<typeof actOnProposal>[0]> = {}) {
    const db = makeDb(st);
    return actOnProposal({
      id: '7', action: 'act', baseState: 'open', actor: 'web', nowMs: NOW,
      db, getConnection: async () => makeConn(st, db), ...over,
    });
  }

  it('🔴 act — begin → INSERT 개정판 → UPDATE 제안 → commit 순서로 한 트랜잭션', async () => {
    const st = newState({ proposal: proposalRow(), revisions: new Map([[1, { revision_no: 1, symbols: '["NAS:AAAA","NAS:ABBB"]', created_at: 'x' }]]) });
    const r = await run(st);
    expect(r.kind).toBe('ok');
    expect(st.events.filter((e) => e !== 'release')).toEqual(['begin', 'insert:2', 'update', 'commit']);
    expect(st.events).toContain('release');
    expect(st.events).not.toContain('destroy');
    // 빼기였으므로 개정판 2 의 목록에서 그 종목이 빠진다
    expect(st.revisions.get(2)?.symbols).toBe(JSON.stringify(['NAS:ABBB']));
  });

  it('🔴 그 사이 다른 기기가 처리했으면(UPDATE 0행) **rollback** — 개정판도 남지 않는다', async () => {
    const st = newState({
      proposal: proposalRow(), updateAffectsZero: true,
      revisions: new Map([[1, { revision_no: 1, symbols: '["NAS:AAAA"]', created_at: 'x' }]]),
    });
    const r = await run(st);
    expect(r.kind).toBe('conflict');
    expect(st.events).toContain('rollback');
    expect(st.events).not.toContain('commit');
    expect([...st.revisions.keys()]).toEqual([1]);     // 목록이 바뀌지 않았다
  });

  it('🔴 baseState 가 현재 상태와 다르면 409 이고 **쓰기 0건**(트랜잭션을 열지도 않는다)', async () => {
    const st = newState({ proposal: proposalRow({ state: 'held', held_until: '2027-01-03 01:10:00' }) });
    const r = await run(st, { baseState: 'open' });
    expect(r.kind).toBe('conflict');
    expect(st.events).toEqual([]);
    expect(st.log.filter((q) => q.startsWith('INSERT') || q.startsWith('UPDATE'))).toEqual([]);
  });

  it('없는 제안은 not_found, id 가 숫자가 아니면 bad_request', async () => {
    expect((await run(newState({ proposal: null }))).kind).toBe('not_found');
    expect((await run(newState({ proposal: proposalRow() }), { id: 'abc' })).kind).toBe('bad_request');
  });

  it('🔴 ⑤ — 저장된 개정판을 읽을 수 없으면 `act` 는 **트랜잭션을 열기 전에 중단**한다(빈 목록을 확정하지 않는다)', async () => {
    const st = newState({
      proposal: proposalRow(),
      // 손상된 개정판(비문자열 원소) — 전에는 `[]` 로 읽혀 「거의 빈 개정판」이 확정될 수 있었다
      revisions: new Map([[1, { revision_no: 1, symbols: '["NAS:AAAA", 42]', created_at: 'x' }]]),
    });
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await run(st);
    expect(r.kind).toBe('bad_request');
    expect(st.events).toEqual([]);                                   // begin·insert·update·commit 0건
    expect([...st.revisions.keys()]).toEqual([1]);                   // 새 개정판이 생기지 않았다
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('🔴 ⑤ — **일괄 교체는 막지 않는다**: 손상된 개정판의 복구 경로다', async () => {
    const st = newState({ revisions: new Map([[1, { revision_no: 1, symbols: '["NAS:AAAA", 42]', created_at: 'x' }]]) });
    const r = await replaceManualList({ symbols: ['NAS:BBBB'], baseVersion: 1, actor: 'web', nowMs: NOW, db: makeDb(st) });
    expect(r.kind).toBe('ok');
    expect(st.revisions.has(2)).toBe(true);
    // 읽지 못한 옛 목록을 「빼기」로 적지 않는다 — 빈 기준선이 그 상황에서 가장 정직한 값이다
    expect(r.kind === 'ok' && r.data.applied).toEqual({ added: 1, removed: 0, kept: 0 });
  });

  it('🔴 m-5 — 제안 행의 코드 형식이 깨져 있으면 **서버가 거부**한다(클라이언트를 믿지 않는다)', async () => {
    const st = newState({
      proposal: proposalRow({ action_type: 'recode', symbol: 'NAS:AAAA', next_symbol: 'bad code' }),
      revisions: new Map([[1, { revision_no: 1, symbols: '["NAS:AAAA"]', created_at: 'x' }]]),
    });
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await run(st);
    expect(r.kind).toBe('bad_request');
    expect(st.events).toEqual([]);                      // 트랜잭션을 열지 않았다
    expect([...st.revisions.keys()]).toEqual([1]);
    err.mockRestore();
  });

  it('보류는 목록을 바꾸지 않고 상태만 바꾼다 — 해제 시각은 예정표에서 온다(화면이 계산하지 않는다)', async () => {
    const st = newState({ proposal: proposalRow() });
    const r = await run(st, { action: 'hold' });
    expect(r.kind).toBe('ok');
    expect(st.log.filter((q) => q.startsWith('INSERT'))).toEqual([]);
    const upd = st.log.find((q) => q.startsWith('UPDATE overseas_universe_proposal'));
    expect(upd).toContain('held_until = ?');
    expect(st.events).not.toContain('begin');           // 트랜잭션 없이 UPDATE 하나
  });

  it('무시·되돌리기도 목록을 바꾸지 않는다', async () => {
    const ign = newState({ proposal: proposalRow() });
    expect((await run(ign, { action: 'ignore' })).kind).toBe('ok');
    expect(ign.log.filter((q) => q.startsWith('INSERT'))).toEqual([]);
    const reo = newState({ proposal: proposalRow({ state: 'ignored' }) });
    expect((await run(reo, { action: 'reopen', baseState: 'ignored' })).kind).toBe('ok');
    expect(reo.log.filter((q) => q.startsWith('INSERT'))).toEqual([]);
  });

  it('되돌리기는 보류·무시만 — 열린 제안에 보내면 bad_request', async () => {
    const st = newState({ proposal: proposalRow() });
    expect((await run(st, { action: 'reopen', baseState: 'open' })).kind).toBe('bad_request');
    expect(st.events).toEqual([]);
  });

  it('🔴 m-2 — 커밋 뒤 재조회만 실패하면 `saved_unreadable`(「처리되지 않았다」고 말하지 않는다)', async () => {
    const st = newState({
      proposal: proposalRow(), failPartsFrom: 2,
      revisions: new Map([[1, { revision_no: 1, symbols: '["NAS:AAAA"]', created_at: 'x' }]]),
    });
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await run(st);
    expect(r).toEqual({ kind: 'saved_unreadable' });
    expect(st.events).toContain('commit');              // 실제로 커밋됐다
    expect(st.revisions.has(2)).toBe(true);
    err.mockRestore();
  });

  it('주문·시그널 표에 쓰지 않는다 — 보낸 질의 전체를 확인한다', async () => {
    const st = newState({ proposal: proposalRow(), revisions: new Map([[1, { revision_no: 1, symbols: '["NAS:AAAA"]', created_at: 'x' }]]) });
    await run(st);
    for (const q of st.log) {
      expect(q).not.toMatch(/\b(orders|signals|trade_logs|executions)\b/i);
      if (/^(INSERT|UPDATE|DELETE)/.test(q)) expect(q).toMatch(/overseas_universe_(revision|proposal)/);
    }
  });
});
