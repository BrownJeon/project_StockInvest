/**
 * T-145 ⑥ — **단일 행의 흠이 그 달을 버리게 하지 않는다.** 저장소가 보내는 **파라미터 자리**를 고정한다.
 *
 * 왜 이 파일인가(Reviewer 가 STRICT 실 DB 로 재현한 결함): `cap_ratio DECIMAL(12,6)` 에 `2e7`(→ "Out of range")·
 * `kis_stis CHAR(1)` 에 2자(→ "Data too long")·같은 심볼 두 행(→ `uq_cand_symbol` 1062)이 **트랜잭션 전체**를
 * 깨고, 호출부가 그 달을 `failed` 로 **영구** 종결했다.
 *
 * 여기서는 가짜 `Queryable`·`TxConnection` 으로 **앱이 무엇을 보내는지**를 본다(DB 없이 늘 돈다).
 * STRICT DB 가 실제로 받아 주는지는 `refresh-store-disposable-mariadb.test.ts`(`T143_WPA_DB_PORT`)가 왕복으로 본다 —
 * 두 층이 다 필요하다: 여기만 있으면 「열 폭을 내가 잘못 알았다」를 못 잡고, 저기만 있으면 평소 실행에서 건너뛴다.
 */
jest.mock('@/lib/db', () => ({
  getPool: () => { throw new Error('운영 풀 사용 금지(시험) — db·getConnection 을 인자로 넘겨라'); },
}));

import {
  DECIMAL_COLS, applyScanOutcome, finalizeRun, isRetryableDbError, readPendingCandidates, readRunKisStatus,
  saveListing, type CandidateInsert, type CandidateVerdict, type Queryable, type TxConnection,
} from '../refresh-store';

const NOW = Date.parse('2026-12-06T04:10:00+09:00');

interface Q { sql: string; params: unknown[] }

function recorder(): { log: Q[]; conn: TxConnection; events: string[] } {
  const log: Q[] = [];
  const events: string[] = [];
  const conn: TxConnection = {
    async query<T>(sql: string, params: unknown[] = []): Promise<[T, unknown]> {
      log.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      return [[] as unknown as T, undefined];
    },
    async beginTransaction() { events.push('begin'); },
    async commit() { events.push('commit'); },
    async rollback() { events.push('rollback'); },
    release() { events.push('release'); },
    destroy() { events.push('destroy'); },
  };
  return { log, conn, events };
}

function cand(over: Partial<CandidateInsert> = {}): CandidateInsert {
  return {
    ord: 0, symbol: 'NYS:AAA', secTicker: 'AAA', cik: 1, secName: 'ALPHA',
    kisSymb: 'AAA', kisEnam: 'ALPHA HOLDINGS', kisStis: '2', kisIsdr: 'N', kisEtyp: null,
    status: 'pending', exclusion: null, ...over,
  };
}
function verdict(over: Partial<CandidateVerdict> = {}): CandidateVerdict {
  return {
    ord: 0, capUsed: 1e11, capAlt: null, capSource: 'tomv', capRatio: 1,
    capFlag: 'consistent', exclusion: null, rankNo: 1, ...over,
  };
}

/** `saveListing` 의 후보 INSERT 한 행을 열 이름으로 읽는다(열 순서는 `CANDIDATE_COLS` 와 같다). */
const CAND_COLS = [
  'run_id', 'ord', 'symbol', 'sec_ticker', 'cik', 'sec_name',
  'kis_symb', 'kis_enam', 'kis_stis', 'kis_isdr', 'kis_etyp', 'status', 'exclusion',
] as const;
function candRows(log: Q[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const q of log) {
    if (!q.sql.startsWith('INSERT INTO overseas_universe_candidate')) continue;
    for (let i = 0; i < q.params.length; i += CAND_COLS.length) {
      const row: Record<string, unknown> = {};
      CAND_COLS.forEach((c, j) => { row[c] = q.params[i + j]; });
      out.push(row);
    }
  }
  return out;
}

describe('🔴 ⑥-2 CHAR 열은 앱이 먼저 맞춘다', () => {
  it('kis_stis CHAR(1)·kis_isdr CHAR(1)·kis_etyp CHAR(3) 을 넘치면 자른다(Reviewer 가 2자로 재현한 자리)', async () => {
    const { log, conn } = recorder();
    const r = await saveListing({
      runId: 9,
      candidates: [cand({ kisStis: '23', kisIsdr: 'YN', kisEtyp: '0012' })],
      sec: { fetchedAtMs: NOW, sha256: 's'.repeat(64), rows: 1 },
      master: { fetchedAtMs: NOW, sha256: 'm'.repeat(64), rows: 1 },
      countsJson: '{}', nowMs: NOW, getConnection: async () => conn,
    });
    expect(r.kind).toBe('ok');
    const row = candRows(log)[0];
    expect([row.kis_stis, row.kis_isdr, row.kis_etyp]).toEqual(['2', 'Y', '001']);
  });

  it('null·빈값·정상 값은 그대로 간다(자르기가 멀쩡한 값을 바꾸지 않는다)', async () => {
    const { log, conn } = recorder();
    await saveListing({
      runId: 9,
      candidates: [cand({ kisStis: '3', kisIsdr: null, kisEtyp: '001' })],
      sec: { fetchedAtMs: NOW, sha256: 's'.repeat(64), rows: 1 },
      master: { fetchedAtMs: NOW, sha256: 'm'.repeat(64), rows: 1 },
      countsJson: '{}', nowMs: NOW, getConnection: async () => conn,
    });
    const row = candRows(log)[0];
    expect([row.kis_stis, row.kis_isdr, row.kis_etyp]).toEqual(['3', null, '001']);
  });
});

describe('🔴 ⑥-3 같은 run 에 같은 심볼이 두 번 오면 첫 행만', () => {
  it('중복 심볼이 빠지고 **첫 행**(SEC 순서가 앞)이 남는다 — 1062 로 트랜잭션이 깨지지 않는다', async () => {
    const { log, conn, events } = recorder();
    const r = await saveListing({
      runId: 9,
      candidates: [
        cand({ ord: 0, symbol: 'NYS:AAA', secTicker: 'AAA', status: 'pending' }),
        cand({ ord: 1, symbol: 'NYS:BBB', secTicker: 'BBB' }),
        cand({ ord: 2, symbol: 'NYS:AAA', secTicker: 'AAA-DUP', status: 'excluded', exclusion: 'master_type' }),
      ],
      sec: { fetchedAtMs: NOW, sha256: 's'.repeat(64), rows: 3 },
      master: { fetchedAtMs: NOW, sha256: 'm'.repeat(64), rows: 3 },
      countsJson: '{}', nowMs: NOW, getConnection: async () => conn,
    });
    expect(r).toEqual({ kind: 'ok', data: { inserted: 2 } });
    const rows = candRows(log);
    expect(rows.map((x) => x.symbol)).toEqual(['NYS:AAA', 'NYS:BBB']);
    expect(rows[0].sec_ticker).toBe('AAA');          // 뒤 행이 아니라 앞 행이 남았다(`ord` 가 커서 기준이다)
    expect(rows[0].ord).toBe(0);
    expect(events).toEqual(['begin', 'commit', 'release']);
  });
});

describe('🔴 ⑥-1 DECIMAL 열 — 범위 밖은 null + 플래그', () => {
  async function fin(v: Partial<CandidateVerdict>, marketCap: number | null = 1e11) {
    const { log, conn } = recorder();
    const r = await finalizeRun({
      runId: 9, verdicts: [verdict(v)],
      auto: [{ symbol: 'NYS:AAA', rankNo: 1, marketCap }],
      countsJson: '{}', added: [], removed: [], nowMs: NOW, getConnection: async () => conn,
    });
    const upd = log.find((q) => q.sql.startsWith('UPDATE overseas_universe_candidate'))!;
    const auto = log.find((q) => q.sql.startsWith('INSERT INTO overseas_universe_auto'))!;
    // UPDATE 파라미터 순서: cap_used, cap_alt, cap_source, cap_ratio, cap_flag, exclusion, exclusion, rank_no, run_id, ord
    return {
      r,
      capUsed: upd.params[0], capAlt: upd.params[1], capRatio: upd.params[3], capFlag: upd.params[4],
      autoMarketCap: auto.params[2],
    };
  }

  it('🔴 `cap_ratio` 가 DECIMAL(12,6) 을 넘으면 null + `+oob`(Reviewer 가 `2e7` 로 깨뜨린 그 값)', async () => {
    const o = await fin({ capRatio: 2e7, capFlag: 'basis_mismatch' });
    expect(o.r.kind).toBe('ok');
    expect(o.capRatio).toBeNull();
    expect(o.capFlag).toBe('basis_mismatch+oob');
    expect(String(o.capFlag).length).toBeLessThanOrEqual(24);      // cap_flag VARCHAR(24)
  });

  it('경계: 999999.999999 는 그대로 · 1e6 과 999999.9999996(반올림으로 넘침)은 null', async () => {
    expect((await fin({ capRatio: 999999.999999 })).capRatio).toBe(999999.999999);
    expect((await fin({ capRatio: 1e6 })).capRatio).toBeNull();
    expect((await fin({ capRatio: 999999.9999996 })).capRatio).toBeNull();
    expect((await fin({ capRatio: -2e7 })).capRatio).toBeNull();   // 음수 쪽도 같다
  });

  it('`cap_used`·`cap_alt` 가 DECIMAL(28,4) 을 넘으면 null + `+oob`(shar × last 가 폭주할 수 있다)', async () => {
    const o1 = await fin({ capUsed: 1e30, capFlag: 'basis_mismatch', exclusion: 'implausible', rankNo: null });
    expect([o1.capUsed, o1.capFlag]).toEqual([null, 'basis_mismatch+oob']);
    const o2 = await fin({ capUsed: null, capAlt: 1e26, capFlag: 'tomv_null', exclusion: 'tomv_null', rankNo: null });
    expect([o2.capAlt, o2.capFlag]).toEqual([null, 'tomv_null+oob']);
  });

  it('NaN·Infinity 도 null 이다(STRICT DB 가 거부한다)', async () => {
    expect((await fin({ capRatio: Number.NaN })).capRatio).toBeNull();
    expect((await fin({ capUsed: Number.POSITIVE_INFINITY })).capUsed).toBeNull();
  });

  it('범위 안이면 플래그를 건드리지 않는다(`+oob` 가 멀쩡한 행에 붙지 않는다)', async () => {
    const o = await fin({ capRatio: 1.000001, capFlag: 'consistent' });
    expect([o.capRatio, o.capFlag]).toEqual([1.000001, 'consistent']);
  });

  it('자동 목록의 `market_cap` 도 맞춘다(한 행이 목록 교체를 깨지 않게)', async () => {
    expect((await fin({}, 1e30)).autoMarketCap).toBeNull();
    expect((await fin({}, 1e11)).autoMarketCap).toBe(1e11);
  });

  it('열 폭 표가 DDL 과 같다(여기 숫자가 틀리면 가드가 엉뚱한 값을 버린다)', () => {
    expect(DECIMAL_COLS).toEqual({
      tomv: { intDigits: 24, scale: 4 },          // DECIMAL(28,4)
      shar: { intDigits: 22, scale: 2 },          // DECIMAL(24,2)
      lastPrice: { intDigits: 14, scale: 6 },     // DECIMAL(20,6)
      capRatio: { intDigits: 6, scale: 6 },       // DECIMAL(12,6)
      marketCap: { intDigits: 22, scale: 2 },     // DECIMAL(24,2)
    });
  });
});

describe('🔴 ⑥-1 스캔 원값도 열 폭을 먼저 맞춘다', () => {
  async function apply(o: { tomv: number | null; shar: number | null; last: number | null }) {
    const log: Q[] = [];
    const db: Queryable = {
      async query<T>(sql: string, params: unknown[] = []): Promise<[T, unknown]> {
        log.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
        return [[] as unknown as T, undefined];
      },
    };
    await applyScanOutcome({
      runId: 9, nowMs: NOW, db,
      outcome: { ord: 3, status: 'ok', curr: 'USD', etypNm: null, rsym: 'AAA', ...o },
    });
    // 파라미터 순서: tomv, shar, last_price, curr, etyp_nm, rsym, fetched_at, run_id, ord
    return { tomv: log[0].params[0], shar: log[0].params[1], last: log[0].params[2], sql: log[0].sql };
  }

  it('🔴 범위를 넘으면 null 로 두고 **진행시킨다** — 그 행이 영원히 pending 으로 남아 창을 다 쓰지 않게', async () => {
    const o = await apply({ tomv: 1e30, shar: 1e30, last: 1e20 });
    expect([o.tomv, o.shar, o.last]).toEqual([null, null, null]);
  });

  it('멀쩡한 값은 그대로 간다', async () => {
    const o = await apply({ tomv: 1.2345e12, shar: 5e9, last: 123.456789 });
    expect([o.tomv, o.shar, o.last]).toEqual([1.2345e12, 5e9, 123.456789]);
  });

  it('🔴 `error` 열에는 적지 않는다 — 그 열이 비어 있는 것이 「KIS 가 답했다」의 표식이다(⑧-2 와의 충돌 방지)', async () => {
    const o = await apply({ tomv: 1e30, shar: null, last: null });
    expect(o.sql).toContain('error = NULL');
    expect(o.sql).not.toMatch(/error = \?/);
  });
});

describe('🔴 ⑥-4 일시/영구 분류', () => {
  const err = (over: { errno?: number; code?: string }) => Object.assign(new Error('x'), over);

  it('값·스키마·제약·권한 오류는 **영구**다', () => {
    for (const e of [1264, 1406, 1062, 1048, 1054, 1064, 3819, 4025, 1044, 1142, 1146]) {
      expect(isRetryableDbError(err({ errno: e }))).toBe(false);
    }
    for (const c of ['ER_WARN_DATA_OUT_OF_RANGE', 'ER_DATA_TOO_LONG', 'ER_DUP_ENTRY', 'ER_PARSE_ERROR']) {
      expect(isRetryableDbError(err({ code: c }))).toBe(false);
    }
  });

  it('잠금·연결·타임아웃은 **일시**다', () => {
    for (const e of [1205, 1213, 1040, 1053, 2002, 2006, 2013, 1317]) {
      expect(isRetryableDbError(err({ errno: e }))).toBe(true);
    }
    for (const c of ['PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'ETIMEDOUT', 'ER_LOCK_DEADLOCK']) {
      expect(isRetryableDbError(err({ code: c }))).toBe(true);
    }
  });

  it('🔴 **모르면 일시**다 — 영구로 잘못 보면 그 달이 통째로 날아간다', () => {
    expect(isRetryableDbError(new Error('무엇인지 모를 오류'))).toBe(true);
    expect(isRetryableDbError(null)).toBe(true);
    expect(isRetryableDbError('문자열')).toBe(true);
    expect(isRetryableDbError(err({ errno: 99999 }))).toBe(true);
  });

  it('저장소 결과가 그 분류를 **싣고 돌아온다**(엔진이 그 값으로 그 달을 닫을지 정한다)', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const boom = (over: { errno?: number }): Queryable => ({
      async query<T>(): Promise<[T, unknown]> { throw Object.assign(new Error('x'), over); },
    });
    const perm = await readPendingCandidates({ runId: 1, limit: 10, db: boom({ errno: 1264 }) });
    expect(perm).toMatchObject({ kind: 'error', retryable: false });
    const tmp = await readPendingCandidates({ runId: 1, limit: 10, db: boom({ errno: 1205 }) });
    expect(tmp).toMatchObject({ kind: 'error', retryable: true });
    // 1146 은 분류 이전에 `not_migrated` 로 갈린다(종전 규약)
    const nm = await readPendingCandidates({ runId: 1, limit: 10, db: boom({ errno: 1146 }) });
    expect(nm).toEqual({ kind: 'not_migrated' });
    jest.restoreAllMocks();
  });

  it('상위 N 이 비면 **영구**다(원천이 깨진 논리 상태 — 자동 목록을 바꾸지 않는다)', async () => {
    const { conn } = recorder();
    const r = await finalizeRun({
      runId: 9, verdicts: [], auto: [], countsJson: '{}', added: [], removed: [],
      nowMs: NOW, getConnection: async () => conn,
    });
    expect(r).toMatchObject({ kind: 'error', retryable: false });
    expect(String((r as { error: string }).error)).toContain('empty_top');
  });

  it('연결을 못 얻은 것은 **일시**다(풀 소진·네트워크는 그 달을 닫을 이유가 아니다)', async () => {
    const fail = async (): Promise<TxConnection> => { throw new Error('pool exhausted'); };
    const a = await saveListing({
      runId: 9, candidates: [cand()],
      sec: { fetchedAtMs: NOW, sha256: 's'.repeat(64), rows: 1 },
      master: { fetchedAtMs: NOW, sha256: 'm'.repeat(64), rows: 1 },
      countsJson: '{}', nowMs: NOW, getConnection: fail,
    });
    expect(a).toMatchObject({ kind: 'error', retryable: true });
    const b = await finalizeRun({
      runId: 9, verdicts: [verdict()], auto: [{ symbol: 'NYS:AAA', rankNo: 1, marketCap: 1e11 }],
      countsJson: '{}', added: [], removed: [], nowMs: NOW, getConnection: fail,
    });
    expect(b).toMatchObject({ kind: 'error', retryable: true });
  });
});

describe('🔴 (Reviewer M-3) `readRunKisStatus` — 질의 모양과 실패 처리', () => {
  it('🔴 **부른 적 없는 행을 빼는 조건**이 질의에 있다 — 빠지면 pending 행이 「답했다」로 들어온다', async () => {
    const seen: string[] = [];
    const db: Queryable = {
      async query<T>(sql: string): Promise<[T, unknown]> {
        seen.push(sql.replace(/\s+/g, ' ').trim());
        return [[] as unknown as T, undefined];
      },
    };
    await readRunKisStatus({ runId: 7, db });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('fetched_at IS NOT NULL');
    expect(seen[0]).toMatch(/^SELECT symbol, error FROM overseas_universe_candidate WHERE run_id = \? AND fetched_at IS NOT NULL$/);
    expect(seen[0]).not.toMatch(/\bstatus\b/);     // status 로 판정하지 않는다(finalize 가 덮어쓴다)
  });

  it('🔴 조회가 실패하면 **빈 맵**이다(모름) — 추측해서 true·false 를 만들지 않는다', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db: Queryable = {
      async query<T>(): Promise<[T, unknown]> { throw Object.assign(new Error('x'), { code: 'ER_LOCK_WAIT_TIMEOUT' }); },
    };
    const m = await readRunKisStatus({ runId: 7, db });
    expect(m.size).toBe(0);
    jest.restoreAllMocks();
  });

  it('`error` 가 비어 있으면 true, 값이 있으면 false — 같은 심볼이 두 번이면 첫 행', async () => {
    const db: Queryable = {
      async query<T>(): Promise<[T, unknown]> {
        return [[
          { symbol: 'NYS:A', error: null },
          { symbol: 'NYS:B', error: 'HTTP 500' },
          { symbol: 'NYS:C', error: '   ' },        // 공백만 = strOf 가 null 로 본다 → 답했다
          { symbol: 'NYS:B', error: null },         // 둘째 행은 무시한다
          { symbol: '', error: null },              // 빈 심볼은 넣지 않는다
        ] as unknown as T, undefined];
      },
    };
    const m = await readRunKisStatus({ runId: 7, db });
    expect([...m.entries()].sort()).toEqual([['NYS:A', true], ['NYS:B', false], ['NYS:C', true]]);
    expect(m.has('')).toBe(false);
  });
});
