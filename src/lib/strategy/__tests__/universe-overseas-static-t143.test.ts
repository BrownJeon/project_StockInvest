/**
 * T-143 WP-B0 — 해외 분석 대상 목록 판독기: **DB > 환경변수 > 코드 하드코딩** (구현 가이드 §8.1 B0 · 부록 2).
 *
 * 🔴 이 시험이 지키는 것:
 *   ① 화면이 DB 에 저장한 목록이 **실제로 분석 대상이 된다**(그러지 않으면 화면의 「다음 장마감 분석부터 반영됩니다」가 거짓).
 *   ② **빈 목록(일부러 비움)과 기록 없음(아직 전환 전)을 구분한다** — 빈 목록을 환경변수로 되돌리면
 *      「전부 비우기」가 조용히 무시되고 확인 시트에서 한 말이 거짓이 된다.
 *   ③ 어떤 DB 실패에도 **던지지 않고** 떨어진다 — 목록을 못 읽는다고 그날 분석을 비우지 않는다.
 *   ⑤ (T-145 ③) **자동 목록은 스위치가 켜져 있을 때만** 합집합에 들어간다 — 꺼짐이면 표에 행이 있어도 질의조차
 *      보내지 않는다. 꺼짐은 `degraded` 가 아니고(`autoDisabled` 로만 말한다), 설정 **판독 실패**는 「꺼짐 + degraded」다.
 *   ④ (Reviewer high-1) 실패하면 **마지막으로 제대로 읽은 목록**을 환경변수·하드코딩보다 먼저 쓰고, `degraded` 로 알리고,
 *      경고를 **실패마다** 남긴다. 해석 불가한 JSON 은 「일부러 비움」이 아니라 읽기 실패다.
 *      — 대상이 조용히 줄어드는 것(운영에서 확인된 WMT·BRK.B 12일 침묵과 같은 유형)을 막는 장치다.
 */
jest.mock('@/lib/db', () => ({ getPool: jest.fn(() => { throw new Error('pool not available in test'); }) }));

import {
  SP500_TOP50, __resetUniverseCacheForTest, envOverseasUniverse, getStaticOverseasUniverse, parseRevisionSymbols,
  readOverseasUniverse, type Queryable,
} from '../universe-overseas-static';

/** `system_config.overseas_universe_refresh` 의 **켜짐** 값. 아래 대역들의 기본값이다. */
const SWITCH_ON = JSON.stringify({ enabled: true, topN: 50 });

const ORIG_A = process.env.OVERSEAS_UNIVERSE_SYMBOLS;
const ORIG_B = process.env.ALLOWED_SYMBOLS_OVERSEAS;

// 🔴 마지막 성공 목록이 프로세스 메모리에 남으므로 시험마다 비운다(시험 간 오염 금지)
beforeEach(() => { __resetUniverseCacheForTest(); });

afterEach(() => {
  if (ORIG_A === undefined) delete process.env.OVERSEAS_UNIVERSE_SYMBOLS; else process.env.OVERSEAS_UNIVERSE_SYMBOLS = ORIG_A;
  if (ORIG_B === undefined) delete process.env.ALLOWED_SYMBOLS_OVERSEAS; else process.env.ALLOWED_SYMBOLS_OVERSEAS = ORIG_B;
  jest.restoreAllMocks();
});

type Rows = Record<string, unknown>[];

/**
 * 수동 개정판·자동 목록·**자동 산출 스위치** 응답을 흉내 내는 대역. `manual=null` 이면 개정판 0건,
 * `throwOn` 이면 그 조회가 실패한다.
 *
 * 🔴 `refresh` 를 생략하면 스위치는 **켜짐**이다(T-145 ③). 이 파일의 종전 시험들은 「자동 목록이 합집합에
 * 들어간다」를 단언하므로 그 전제를 그대로 둔다 — 꺼짐·키 없음·해석 불가·판독 실패는 아래 ⑤ describe 가 본다.
 * `refresh: null` = 키 없음(행 0건) · 그 밖의 값 = 그 값이 `system_config.value` 로 온다.
 */
function db(opts: {
  manual?: string[] | null; auto?: string[]; throwOn?: 'revision' | 'auto' | 'config';
  errno?: number; refresh?: unknown;
}): Queryable {
  return {
    async query<T>(sql: string): Promise<[T, unknown]> {
      const s = sql.replace(/\s+/g, ' ');
      if (s.includes('system_config')) {
        if (opts.throwOn === 'config') {
          const e = new Error('boom') as Error & { errno?: number };
          if (opts.errno != null) e.errno = opts.errno;
          throw e;
        }
        const v = opts.refresh === undefined ? SWITCH_ON : opts.refresh;
        return [(v === null ? [] : [{ value: v }]) as T, undefined];
      }
      if (s.includes('overseas_universe_revision')) {
        if (opts.throwOn === 'revision') {
          const e = new Error('boom') as Error & { errno?: number };
          if (opts.errno != null) e.errno = opts.errno;
          throw e;
        }
        const rows: Rows = opts.manual == null ? [] : [{ symbols: JSON.stringify(opts.manual) }];
        return [rows as T, undefined];
      }
      if (s.includes('overseas_universe_auto')) {
        if (opts.throwOn === 'auto') {
          const e = new Error('boom') as Error & { errno?: number };
          if (opts.errno != null) e.errno = opts.errno;
          throw e;
        }
        return [(opts.auto ?? []).map((symbol) => ({ symbol })) as T, undefined];
      }
      return [[] as unknown as T, undefined];
    },
  };
}

describe('DB 가 있으면 DB 를 쓴다', () => {
  it('🔴 수동 목록이 그대로 분석 대상이 된다(화면 저장 → 분석 반영의 유일한 경로)', async () => {
    const r = await getStaticOverseasUniverse(db({ manual: ['NAS:AAAA', 'NAS:ABBB'] }));
    expect(r).toEqual(['NAS:AAAA', 'NAS:ABBB']);
  });

  it('수동 ∪ 자동 — 수동이 앞(사용자가 고른 것이 먼저), 중복은 1번만', async () => {
    const r = await getStaticOverseasUniverse(db({ manual: ['NAS:AAAA', 'NAS:ABBB'], auto: ['NYS:CAAA', 'NAS:AAAA'] }));
    expect(r).toEqual(['NAS:AAAA', 'NAS:ABBB', 'NYS:CAAA']);
  });

  it('DB 목록이 있으면 환경변수를 **쓰지 않는다**(우선순위 DB > env)', async () => {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:ZZZZ';
    expect(await getStaticOverseasUniverse(db({ manual: ['NAS:AAAA'] }))).toEqual(['NAS:AAAA']);
  });

  it('🔴 빈 목록으로 저장했으면 빈 목록이다 — 환경변수로 되돌아가지 않는다(「전부 비우기」를 무시하지 않는다)', async () => {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:ZZZZ';
    expect(await getStaticOverseasUniverse(db({ manual: [] }))).toEqual([]);
  });

  it('🔴 high-1 ④ — 해석 불가한 JSON 은 「일부러 비움」이 아니라 **읽기 실패**다(빈 목록으로 보면 대상이 조용히 사라진다)', async () => {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:ZZZZ';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken: Queryable = { async query<T>(): Promise<[T, unknown]> { return [[{ symbols: 'not json' }] as unknown as T, undefined]; } };
    const r = await readOverseasUniverse(broken);
    expect(r.symbols).toEqual(['NAS:ZZZZ']);        // 빈 목록이 아니다
    expect(r.degraded).toBe(true);
    expect(r.reason).toBe('bad_json');
    expect(warn).toHaveBeenCalled();
  });
});

describe('폴백 — 던지지 않는다', () => {
  it('개정판이 0건이면(아직 DB 로 전환 전) 환경변수를 쓴다', async () => {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:AAPL, NAS:INTC';
    expect(await getStaticOverseasUniverse(db({ manual: null }))).toEqual(['NAS:AAPL', 'NAS:INTC']);
  });

  it('🔴 W-3 — 개정판이 0건이어도 **자동 목록은 반영한다**(폴백 ∪ 자동). 12월 교체 전에 WP-A 가 채운 목록이 무시되지 않게', async () => {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:AAPL';
    expect(await getStaticOverseasUniverse(db({ manual: null, auto: ['NYS:CAAA', 'NYS:CBBB'] })))
      .toEqual(['NAS:AAPL', 'NYS:CAAA', 'NYS:CBBB']);
  });

  it('W-3 — 개정판 0건 + 환경변수 없음이어도 자동 목록이 붙는다(하드코딩 ∪ 자동, 중복 1번만)', async () => {
    delete process.env.OVERSEAS_UNIVERSE_SYMBOLS;
    delete process.env.ALLOWED_SYMBOLS_OVERSEAS;
    const r = await getStaticOverseasUniverse(db({ manual: null, auto: ['NYS:CAAA', 'NAS:AAPL'] }));
    expect(r).toHaveLength(SP500_TOP50.length + 1);          // NAS:AAPL 은 이미 있어 1개만 늘어난다
    expect(r.slice(0, SP500_TOP50.length)).toEqual([...SP500_TOP50]);
    expect(r[r.length - 1]).toBe('NYS:CAAA');
  });

  it('개정판 0건 + 환경변수 없음이면 코드 하드코딩 50종목(종전 동작 그대로)', async () => {
    delete process.env.OVERSEAS_UNIVERSE_SYMBOLS;
    delete process.env.ALLOWED_SYMBOLS_OVERSEAS;
    expect(await getStaticOverseasUniverse(db({ manual: null }))).toEqual([...SP500_TOP50]);
  });

  it('호환 폴백 ALLOWED_SYMBOLS_OVERSEAS 도 그대로 인정한다', async () => {
    delete process.env.OVERSEAS_UNIVERSE_SYMBOLS;
    process.env.ALLOWED_SYMBOLS_OVERSEAS = 'NAS:MU';
    expect(envOverseasUniverse()).toEqual(['NAS:MU']);
    expect(await getStaticOverseasUniverse(db({ manual: null }))).toEqual(['NAS:MU']);
  });

  it('W-3 — 개정판 **조회가 실패**하면 자동 목록도 보지 않는다(두 표는 같은 마이그레이션이다)', async () => {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:AAPL';
    const seen: string[] = [];
    const spy: Queryable = {
      async query<T>(sql: string): Promise<[T, unknown]> {
        // 🔴 `overseas_universe_*` 질의만 센다 — 스위치(`system_config`)는 이 단언의 대상이 아니다(T-145 ③)
        if (sql.includes('overseas_universe')) seen.push(sql.replace(/\s+/g, ' ').trim());
        if (sql.includes('system_config')) return [[{ value: SWITCH_ON }] as unknown as T, undefined];
        if (sql.includes('overseas_universe_revision')) { const e = new Error('boom') as Error & { errno?: number }; e.errno = 1146; throw e; }
        return [[{ symbol: 'NYS:CAAA' }] as unknown as T, undefined];
      },
    };
    expect(await getStaticOverseasUniverse(spy)).toEqual(['NAS:AAPL']);
    expect(seen).toHaveLength(1);                            // 자동 목록 조회를 보내지 않았다
  });

  it('🔴 ① 마이그레이션 전(errno 1146)도 폴백하되 **경고를 남긴다** — 정식 순서는 DDL 먼저라 이 구간은 순서 위반 신호다', async () => {
    delete process.env.OVERSEAS_UNIVERSE_SYMBOLS;
    delete process.env.ALLOWED_SYMBOLS_OVERSEAS;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await getStaticOverseasUniverse(db({ throwOn: 'revision', errno: 1146 }))).toEqual([...SP500_TOP50]);
    expect(warn).toHaveBeenCalled();
  });

  it('🔴 그 밖의 DB 오류도 던지지 않고 폴백한다(분석을 멈추지 않는다) + degraded 로 알린다', async () => {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:AAPL';
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await readOverseasUniverse(db({ throwOn: 'revision' }));
    expect(r.symbols).toEqual(['NAS:AAPL']);
    expect(r).toMatchObject({ degraded: true, reason: 'db_error', manualSource: 'env' });
  });

  it('🔴 high-1 ① — 실패하면 **마지막으로 제대로 읽은 목록**을 환경변수보다 먼저 쓴다', async () => {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:ZZZZ';
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    // 1회차: 성공 — 사용자가 저장한 ~2종목을 기억한다
    expect(await getStaticOverseasUniverse(db({ manual: ['NAS:AAAA', 'NAS:ABBB'] }))).toEqual(['NAS:AAAA', 'NAS:ABBB']);
    // 2회차: DB 가 아프다 — 코드 하드코딩 50개로 갈아타지 않고 방금 읽은 목록을 쓴다
    const r = await readOverseasUniverse(db({ throwOn: 'revision' }));
    expect(r.symbols).toEqual(['NAS:AAAA', 'NAS:ABBB']);
    expect(r).toMatchObject({ degraded: true, manualSource: 'last_good' });
  });

  it('high-1 ① — 자동 목록도 따로 기억한다(수동만 성공한 회차가 옛 자동 값을 지우지 않는다)', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await getStaticOverseasUniverse(db({ manual: ['NAS:AAAA'], auto: ['NYS:CAAA'] }));
    const r = await readOverseasUniverse(db({ manual: ['NAS:AAAA'], throwOn: 'auto' }));
    expect(r.symbols).toEqual(['NAS:AAAA', 'NYS:CAAA']);
    expect(r).toMatchObject({ degraded: true, autoDegraded: true, reason: 'auto_db_error' });
  });

  it('🔴 high-1 ③ — 경고는 **실패마다** 남는다(프로세스당 1회로 줄이지 않는다)', async () => {
    delete process.env.OVERSEAS_UNIVERSE_SYMBOLS;
    delete process.env.ALLOWED_SYMBOLS_OVERSEAS;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (let i = 0; i < 3; i += 1) await readOverseasUniverse(db({ throwOn: 'revision' }));
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('🔴 ① 마이그레이션 전도 degraded 다 — 사유만 `not_migrated` 로 가른다(조용히 넘기지 않는다)', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await readOverseasUniverse(db({ throwOn: 'revision', errno: 1146 }));
    expect(r).toMatchObject({ degraded: true, reason: 'not_migrated', autoDegraded: true });
  });

  it('🔴 C-1 — **표 조회에 성공한 뒤**의 1146 은 「표가 사라졌다」다(degraded · table_missing · 마지막 성공 목록 우선)', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    // 1회차: 성공 — 이 프로세스가 표를 봤다
    expect(await getStaticOverseasUniverse(db({ manual: ['NAS:AAAA', 'NAS:ABBB'] }))).toEqual(['NAS:AAAA', 'NAS:ABBB']);
    // 2회차: 표가 사라졌다(롤백 DROP·잘못된 DB·백업 복원) — 조용히 넘기지 않는다
    const r = await readOverseasUniverse(db({ throwOn: 'revision', errno: 1146 }));
    expect(r).toMatchObject({ degraded: true, reason: 'table_missing', manualSource: 'last_good' });
    expect(r.symbols).toEqual(['NAS:AAAA', 'NAS:ABBB']);     // 하드코딩 50개로 조용히 줄지 않는다
  });

  it('🔴 C-1 — 개정판이 **0건이어도** 조회 성공이므로 그 뒤의 1146 은 degraded 다', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await readOverseasUniverse(db({ manual: null }));          // 행 0건 = 성공
    const r = await readOverseasUniverse(db({ throwOn: 'revision', errno: 1146 }));
    expect(r).toMatchObject({ degraded: true, reason: 'table_missing' });
    expect(warn).toHaveBeenCalled();
  });

  it('🔴 ① **새 프로세스**(깃발 초기화)의 1146 도 degraded 다 — 사유만 `not_migrated` 로 바뀐다', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await readOverseasUniverse(db({ manual: ['NAS:AAAA'] }));
    __resetUniverseCacheForTest();                            // = 프로세스 재시작(적용 뒤 재시작은 일상이다)
    const r = await readOverseasUniverse(db({ throwOn: 'revision', errno: 1146 }));
    expect(r).toMatchObject({ degraded: true, reason: 'not_migrated' });
    expect(warn).toHaveBeenCalled();
  });

  it('① 자동 표의 1146 도 degraded 다 — 수동 조회가 성공해 깃발이 섰으면 `auto_table_missing`', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await readOverseasUniverse(db({ manual: ['NAS:AAAA'], throwOn: 'auto', errno: 1146 }));
    // 수동 조회가 성공하면 그 자리에서 깃발이 서므로 자동 1146 은 「가동 중 소실」로 읽힌다
    expect(r).toMatchObject({ degraded: true, autoDegraded: true, reason: 'auto_table_missing' });
  });

  it('① 수동이 비-1146 로 실패한 뒤 자동이 1146 이면 — 자동도 degraded 이고 사유는 **수동 쪽을 먼저** 말한다', async () => {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:ENV1';
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const q: Queryable = {
      async query<T>(sql: string): Promise<[T, unknown]> {
        if (sql.includes('system_config')) return [[{ value: SWITCH_ON }] as unknown as T, undefined];
        if (sql.includes('overseas_universe_revision')) throw new Error('boom');          // db_error — 깃발이 서지 않는다
        if (sql.includes('overseas_universe_auto')) {
          const e = new Error('no table') as Error & { errno?: number };
          e.errno = 1146;
          throw e;
        }
        return [[] as unknown as T, undefined];
      },
    };
    const r = await readOverseasUniverse(q);
    // 자동 쪽 사유는 `auto_not_migrated` 지만 응답의 `reason` 은 더 중대한 수동 쪽(`db_error`)이다
    expect(r).toMatchObject({ degraded: true, autoDegraded: true, reason: 'db_error' });
    expect(r.symbols).toEqual(['NAS:ENV1']);
  });

  it('C-1 — 자동 표만 사라진 경우도 degraded(auto_table_missing). 수동 목록은 그대로 쓴다', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await readOverseasUniverse(db({ manual: ['NAS:AAAA'], auto: ['NYS:CAAA'] }));
    const r = await readOverseasUniverse(db({ manual: ['NAS:AAAA'], throwOn: 'auto', errno: 1146 }));
    expect(r).toMatchObject({ degraded: true, autoDegraded: true, reason: 'auto_table_missing' });
    expect(r.symbols).toEqual(['NAS:AAAA', 'NYS:CAAA']);      // 마지막 성공 자동 목록을 쓴다
  });

  it('성공한 조회는 캐시가 아니라 늘 DB 값을 쓴다(캐시가 최신 값을 가리지 않는다)', async () => {
    await getStaticOverseasUniverse(db({ manual: ['NAS:AAAA'] }));
    expect(await getStaticOverseasUniverse(db({ manual: ['NAS:BBBB'] }))).toEqual(['NAS:BBBB']);
  });

  it('자동 목록만 실패하면 **수동 목록은 그대로 쓴다**(사용자가 직접 정한 값을 버리지 않는다)', async () => {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:ZZZZ';
    expect(await getStaticOverseasUniverse(db({ manual: ['NAS:AAAA'], throwOn: 'auto' }))).toEqual(['NAS:AAAA']);
  });

  it('연결 자체를 못 얻어도(풀 예외) 폴백하고 degraded 로 알린다', async () => {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:AAPL';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await readOverseasUniverse();
    expect(r.symbols).toEqual(['NAS:AAPL']);
    expect(r).toMatchObject({ degraded: true, reason: 'pool' });
    expect(warn).toHaveBeenCalled();
  });
});

describe('🔴 ② 자동 조회 건너뛰기는 1146 계열뿐이다', () => {
  /** 보낸 질의를 기록하는 대역 — 수동 쪽을 지정한 방식으로 실패시키고 자동 표는 정상으로 응답한다. */
  function spyDb(manualFail: 'bad_json' | 'db_error', auto: string[]): { q: Queryable; seen: string[] } {
    const seen: string[] = [];
    const q: Queryable = {
      async query<T>(sql: string): Promise<[T, unknown]> {
        const t = sql.replace(/\s+/g, ' ').trim();
        // `overseas_universe_*` 질의만 센다(스위치 질의는 이 단언의 대상이 아니다 — T-145 ③)
        if (t.includes('overseas_universe')) seen.push(t);
        if (t.includes('system_config')) return [[{ value: SWITCH_ON }] as unknown as T, undefined];
        if (t.includes('overseas_universe_revision')) {
          if (manualFail === 'db_error') throw new Error('boom');
          return [[{ symbols: 'not json' }] as unknown as T, undefined];
        }
        if (t.includes('overseas_universe_auto')) return [auto.map((symbol) => ({ symbol })) as T, undefined];
        return [[] as unknown as T, undefined];
      },
    };
    return { q, seen };
  }

  it('`bad_json` + 자동 정상 → **자동 목록을 읽어 합친다**(수동 손상 때문에 WP-A 결과가 사라지지 않게)', async () => {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:ENV1';
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { q, seen } = spyDb('bad_json', ['NYS:CAAA', 'NYS:CBBB']);
    const r = await readOverseasUniverse(q);
    expect(seen).toHaveLength(2);                                    // 자동 조회를 보냈다
    expect(r.symbols).toEqual(['NAS:ENV1', 'NYS:CAAA', 'NYS:CBBB']);
    expect(r).toMatchObject({ degraded: true, reason: 'bad_json', autoDegraded: false });
  });

  it('`db_error` + 자동 정상 → 같은 규칙(자동을 읽고 사유는 수동 쪽을 먼저 말한다)', async () => {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:ENV1';
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { q, seen } = spyDb('db_error', ['NYS:CAAA']);
    const r = await readOverseasUniverse(q);
    expect(seen).toHaveLength(2);
    expect(r.symbols).toEqual(['NAS:ENV1', 'NYS:CAAA']);
    expect(r).toMatchObject({ degraded: true, reason: 'db_error', autoDegraded: false });
  });

  it('1146 계열은 여전히 건너뛴다 — 두 표는 같은 마이그레이션에 있다', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const seen: string[] = [];
    const q: Queryable = {
      async query<T>(sql: string): Promise<[T, unknown]> {
        const t = sql.replace(/\s+/g, ' ').trim();
        if (t.includes('overseas_universe')) seen.push(t);
        if (t.includes('system_config')) return [[{ value: SWITCH_ON }] as unknown as T, undefined];
        if (t.includes('overseas_universe_revision')) {
          const e = new Error('no table') as Error & { errno?: number };
          e.errno = 1146;
          throw e;
        }
        return [[] as unknown as T, undefined];
      },
    };
    await readOverseasUniverse(q);
    expect(seen).toHaveLength(1);
  });
});

describe('🔴 ③ 개정판 원소는 전부 아니면 전무로 읽는다', () => {
  const rev = (symbols: unknown): Queryable => ({
    async query<T>(sql: string): Promise<[T, unknown]> {
      if (sql.includes('overseas_universe_revision')) return [[{ symbols }] as unknown as T, undefined];
      return [[] as unknown as T, undefined];
    },
  });

  it('`parseRevisionSymbols` — 정상 배열만 통과하고 하나라도 어긋나면 null', () => {
    expect(parseRevisionSymbols('["NAS:AAPL","NYS:BRK.B"]')).toEqual(['NAS:AAPL', 'NYS:BRK.B']);
    expect(parseRevisionSymbols(['NAS:AAPL'])).toEqual(['NAS:AAPL']);
    expect(parseRevisionSymbols('[]')).toEqual([]);                  // 일부러 비운 목록은 유효하다
    expect(parseRevisionSymbols('["NAS:AAPL", 42]')).toBeNull();     // 비문자열 원소
    expect(parseRevisionSymbols('["NAS:AAPL", null]')).toBeNull();
    expect(parseRevisionSymbols('["AAPL"]')).toBeNull();             // 형식 무효(거래소 접두사 없음 — 시드 오타)
    expect(parseRevisionSymbols('["nas:aapl"]')).toBeNull();
    expect(parseRevisionSymbols('not json')).toBeNull();
    expect(parseRevisionSymbols('{"a":1}')).toBeNull();
  });

  it('🔴 **비문자열 원소** 하나면 개정판 전체가 읽기 실패다(`bad_symbols`) — 걸러 내고 정상처럼 쓰지 않는다', async () => {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:ENV1';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await readOverseasUniverse(rev('["NAS:AAAA", 42, "NAS:ABBB"]'));
    expect(r).toMatchObject({ degraded: true, reason: 'bad_symbols', manualSource: 'env' });
    expect(r.symbols).toEqual(['NAS:ENV1']);                         // 살아남은 두 개를 쓰지 않는다
    expect(warn).toHaveBeenCalled();
  });

  it('🔴 **형식 무효 원소**(시드 오타 `AAPL`)도 같다', async () => {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:ENV1';
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await readOverseasUniverse(rev('["NAS:AAAA","AAPL"]'));
    expect(r).toMatchObject({ degraded: true, reason: 'bad_symbols' });
    expect(r.symbols).toEqual(['NAS:ENV1']);
  });

  it('🔴 손상된 값은 **캐시를 갱신하지 않는다** — 마지막 성공 목록이 복구 기준으로 남는다', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await getStaticOverseasUniverse(rev('["NAS:GOOD1","NAS:GOOD2"]'));        // 1회차 성공
    const bad = await readOverseasUniverse(rev('["NAS:GOOD1", 42]'));        // 2회차 손상
    expect(bad).toMatchObject({ degraded: true, manualSource: 'last_good' });
    expect(bad.symbols).toEqual(['NAS:GOOD1', 'NAS:GOOD2']);                 // 손상 값이 캐시를 덮지 않았다
    const again = await readOverseasUniverse(rev('["NAS:GOOD1", 42]'));
    expect(again.symbols).toEqual(['NAS:GOOD1', 'NAS:GOOD2']);
  });

  it('JSON 자체를 못 읽은 것과 원소가 어긋난 것을 사유로 가른다(고치는 방법이 다르다)', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect((await readOverseasUniverse(rev('not json'))).reason).toBe('bad_json');
    expect((await readOverseasUniverse(rev('["AAPL"]'))).reason).toBe('bad_symbols');
  });
});

describe('안전 경계', () => {
  it('주문·안전장치를 건드리지 않는다 — 이 모듈은 DB SELECT 3개만 보낸다(개정판·스위치·자동)', async () => {
    const seen: string[] = [];
    const spy: Queryable = {
      async query<T>(sql: string): Promise<[T, unknown]> {
        seen.push(sql.replace(/\s+/g, ' ').trim());
        // 스위치 질의에 **켜짐**을 돌려줘야 자동 질의까지 간다(T-145 ③)
        if (sql.includes('system_config')) return [[{ value: SWITCH_ON }] as unknown as T, undefined];
        return [[] as unknown as T, undefined];
      },
    };
    await getStaticOverseasUniverse(spy);
    expect(seen).toHaveLength(3);                       // 개정판 → 스위치 → 자동(W-3 — 0건이어도 자동은 읽는다)
    expect(seen[0]).toMatch(/^SELECT symbols FROM overseas_universe_revision /);
    expect(seen[1]).toMatch(/^SELECT value FROM system_config /);
    expect(seen[2]).toMatch(/^SELECT symbol FROM overseas_universe_auto /);
    for (const s of seen) expect(s).not.toMatch(/\b(INSERT|UPDATE|DELETE|orders|signals)\b/i);
  });

  it('🔴 꺼짐이면 질의가 2개다 — 자동 표를 **아예 부르지 않는다**(T-145 ③-1)', async () => {
    const seen: string[] = [];
    const spy: Queryable = {
      async query<T>(sql: string): Promise<[T, unknown]> {
        seen.push(sql.replace(/\s+/g, ' ').trim());
        return [[] as unknown as T, undefined];       // 스위치 키 없음 = 꺼짐
      },
    };
    await getStaticOverseasUniverse(spy);
    expect(seen).toHaveLength(2);
    expect(seen.some((s) => s.includes('overseas_universe_auto'))).toBe(false);
  });

  it('🔴 F-1 — SP500_TOP50 의 월마트는 NAS:WMT 다(2024-12 나스닥 이전). NYS:BRK.B 는 그대로 둔다(표기 미정)', () => {
    expect(SP500_TOP50).toContain('NAS:WMT');
    expect(SP500_TOP50).not.toContain('NYS:WMT');
    expect(SP500_TOP50).toContain('NYS:BRK.B');
    expect(SP500_TOP50).toHaveLength(50);
    expect(new Set(SP500_TOP50).size).toBe(50);              // 중복 없음
  });
});

/**
 * 🔴 ⑤ (T-145 ③) **스위치가 자동 목록을 실제로 끈다.**
 *
 * 고치는 결함: `enabled` 를 보는 곳이 산출 라우트의 관문 하나뿐이어서, 끄면 **다음 산출만** 멈추고
 * 이미 `overseas_universe_auto` 에 들어간 행은 **계속 분석 대상**이었다 → 「켜 보고 끈다」가 불가능했고
 * 되돌리려면 사람이 운영 DB 에 `DELETE` 를 쳐야 했다(그 절차는 어느 문서에도 없다).
 */
describe('🔴 ⑤ 자동 산출 스위치 (T-145 ③)', () => {
  const MANUAL = ['NAS:AAAA'];
  const AUTO = ['NYS:CAAA', 'NYS:CBBB'];

  it('🔴 **이것이 이 조건의 본질** — 꺼짐인데 자동 표에 행이 있어도 합집합에 들어가지 않는다', async () => {
    const r = await readOverseasUniverse(db({ manual: MANUAL, auto: AUTO, refresh: JSON.stringify({ enabled: false }) }));
    expect(r.symbols).toEqual(MANUAL);                       // 자동 2종목이 들어오지 않았다
    expect(r.autoDisabled).toBe(true);
    // 꺼짐은 고장이 아니다 — 홈 「데이터 이상」이 상시 켜지면 경보 피로가 된다(③-3)
    expect(r.degraded).toBe(false);
    expect(r.autoDegraded).toBe(false);
    expect(r.reason).toBeNull();
  });

  it('켜짐이면 자동 목록이 합집합에 들어간다(종전 동작)', async () => {
    const r = await readOverseasUniverse(db({ manual: MANUAL, auto: AUTO }));
    expect(r.symbols).toEqual([...MANUAL, ...AUTO]);
    expect(r).toMatchObject({ autoDisabled: false, degraded: false, autoDegraded: false, reason: null });
  });

  it('키가 없으면 꺼짐이다(새 기능 = 꺼짐) — 저하는 아니다', async () => {
    const r = await readOverseasUniverse(db({ manual: MANUAL, auto: AUTO, refresh: null }));
    expect(r.symbols).toEqual(MANUAL);
    expect(r).toMatchObject({ autoDisabled: true, degraded: false, reason: null });
  });

  it('해석 불가(비-JSON·`enabled` 가 true 아님)도 꺼짐이다 — 저하는 아니다', async () => {
    for (const v of ['on', 'true', '{', JSON.stringify({ enabled: 'true' }), JSON.stringify({ enabled: 1 }), JSON.stringify([])]) {
      const r = await readOverseasUniverse(db({ manual: MANUAL, auto: AUTO, refresh: v }));
      expect(r.symbols).toEqual(MANUAL);
      expect(r).toMatchObject({ autoDisabled: true, degraded: false, reason: null });
    }
  });

  it('🔴 설정 **판독 실패**는 「꺼짐 + degraded」다(③-4) — 조용히 빠지면 대상이 줄어든 줄 아무도 모른다', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await readOverseasUniverse(db({ manual: MANUAL, auto: AUTO, throwOn: 'config' }));
    expect(r.symbols).toEqual(MANUAL);
    expect(r).toMatchObject({ autoDisabled: true, autoDegraded: true, degraded: true, reason: 'auto_config_error' });
    expect(warn).toHaveBeenCalled();
  });

  it('설정 판독 실패 + 수동도 실패면 사유는 **수동 쪽**을 먼저 말한다(더 중대하다)', async () => {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:ENV1';
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const q: Queryable = {
      async query<T>(sql: string): Promise<[T, unknown]> {
        throw new Error('boom');                            // 모든 질의 실패
      },
    };
    const r = await readOverseasUniverse(q);
    expect(r).toMatchObject({ degraded: true, reason: 'db_error', autoDegraded: true, autoDisabled: true });
    expect(r.symbols).toEqual(['NAS:ENV1']);
  });

  it('🔴 꺼짐일 때 `lastGoodAuto` 폴백을 타지 않는다(③-5) — 캐시로 되살아나면 스위치가 다시 거짓말을 한다', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    // 1회차: 켜짐 — 자동 목록을 읽어 프로세스 메모리에 기억한다
    expect(await getStaticOverseasUniverse(db({ manual: MANUAL, auto: AUTO }))).toEqual([...MANUAL, ...AUTO]);
    // 2회차: 껐다 — 기억해 둔 목록도 쓰지 않는다
    const off = await readOverseasUniverse(db({ manual: MANUAL, auto: AUTO, refresh: JSON.stringify({ enabled: false }) }));
    expect(off.symbols).toEqual(MANUAL);
    // 3회차: 꺼짐 + 자동 표 1146 — 그래도 캐시를 쓰지 않는다(꺼짐 분기가 1146 분기보다 앞이다)
    const gone = await readOverseasUniverse(db({ manual: MANUAL, throwOn: 'auto', errno: 1146, refresh: JSON.stringify({ enabled: false }) }));
    expect(gone.symbols).toEqual(MANUAL);
    expect(gone.autoDisabled).toBe(true);
  });

  it('🔴 꺼짐 + **수동 표 1146** 이어도 자동 캐시가 새지 않는다(③-5 — 그 분기는 켜짐일 때 캐시를 합친다)', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    delete process.env.OVERSEAS_UNIVERSE_SYMBOLS;
    delete process.env.ALLOWED_SYMBOLS_OVERSEAS;
    await getStaticOverseasUniverse(db({ manual: MANUAL, auto: AUTO }));          // 수동·자동 캐시를 채운다
    const r = await readOverseasUniverse(db({ throwOn: 'revision', errno: 1146, refresh: JSON.stringify({ enabled: false }) }));
    // 수동은 마지막 성공 목록으로 되돌아간다(종전 동작) — 거기에 **자동 2종목이 섞이지 않는 것**이 ③-5 다
    expect(r.symbols).toEqual(MANUAL);
    for (const a of AUTO) expect(r.symbols).not.toContain(a);
    expect(r).toMatchObject({ degraded: true, reason: 'table_missing', manualSource: 'last_good', autoDisabled: true });
  });

  it('연결을 못 얻으면 스위치도 모른다 → 자동 쪽을 빼고 표시한다(③-5)', async () => {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:ENV1';
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await getStaticOverseasUniverse(db({ manual: MANUAL, auto: AUTO }));          // 수동·자동 캐시를 채운다
    const r = await readOverseasUniverse();                                       // 풀 예외
    // 수동은 마지막 성공 목록(종전 동작), 자동은 **빠진다** — 전에는 `lastGoodAuto` 를 합쳤다
    expect(r.symbols).toEqual(MANUAL);
    for (const a of AUTO) expect(r.symbols).not.toContain(a);
    expect(r).toMatchObject({ degraded: true, reason: 'pool', autoDisabled: true, autoDegraded: true });
  });
});
