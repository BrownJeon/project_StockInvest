/**
 * T-143 C-3 — `loadUsTargetSymbols` 가 **목록 조회가 제대로 안 된 사실을 `errors` 에 남기는지**.
 *
 * 왜 이 시험이 필요한가(Reviewer C-3): high-1 의 핵심 연결이 **`universe_list` 를 `errors` 에 넣는 한 줄**인데
 * 거기에 직접 시험이 없었다. 이 배열은 호출자가 실행 기록에 `symbol_source_fail:*` 로 남기는 값이라
 * (`post-market-overseas.ts`), 연결이 끊기면 「사용자가 저장한 목록이 빠진 채 분석이 돌았다」가 **흔적 없이** 지나간다.
 *
 * 함께 고정하는 경계: **표가 없으면(errno 1146) 적용 전·후 모두 `errors` 에 남는다**(①). 정식 적용 순서는
 * **DDL 먼저 · 코드 나중**이라, 코드가 먼저 떠서 표를 못 찾는 구간의 흔적은 거짓 경보가 아니라 **순서 위반 신호**다.
 * 구분은 판독기의 `reason`(`not_migrated` ↔ `table_missing`)이 하고, `errors` 는 「목록을 제대로 못 읽었다」만 말한다.
 *
 * 이 파일은 `us-data-db` 를 **mock 하지 않고 실제 함수를 통과시킨다**(가짜 DB 로 네 출처에 응답한다).
 */
jest.mock('@/lib/db', () => ({ getPool: jest.fn(() => { throw new Error('pool must not be used in this test'); }) }));

import { loadUsTargetSymbols, type Queryable } from '../us-data-db';
import { __resetUniverseCacheForTest } from '@/lib/strategy/universe-overseas-static';

const ORIG_ENV = process.env.OVERSEAS_UNIVERSE_SYMBOLS;
const ORIG_ENV_B = process.env.ALLOWED_SYMBOLS_OVERSEAS;

beforeEach(() => {
  __resetUniverseCacheForTest();
  process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:ENV1,NAS:ENV2';
  delete process.env.ALLOWED_SYMBOLS_OVERSEAS;
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  if (ORIG_ENV === undefined) delete process.env.OVERSEAS_UNIVERSE_SYMBOLS; else process.env.OVERSEAS_UNIVERSE_SYMBOLS = ORIG_ENV;
  if (ORIG_ENV_B === undefined) delete process.env.ALLOWED_SYMBOLS_OVERSEAS; else process.env.ALLOWED_SYMBOLS_OVERSEAS = ORIG_ENV_B;
  jest.restoreAllMocks();
});

interface Opts {
  positions?: string[];
  favorites?: string[];
  manual?: string[] | null;
  auto?: string[];
  /** 이 표 조회를 실패시킨다 */
  throwOn?: 'revision' | 'auto' | 'position_state' | 'stock_favorites';
  errno?: number;
}

function db(o: Opts = {}): Queryable {
  const boom = () => {
    const e = new Error('boom') as Error & { errno?: number };
    if (o.errno != null) e.errno = o.errno;
    throw e;
  };
  return {
    async query<T>(sql: string): Promise<[T, unknown]> {
      const s = sql.replace(/\s+/g, ' ');
      if (s.includes('position_state')) {
        if (o.throwOn === 'position_state') boom();
        return [(o.positions ?? []).map((symbol) => ({ symbol })) as T, undefined];
      }
      if (s.includes('stock_favorites')) {
        if (o.throwOn === 'stock_favorites') boom();
        return [(o.favorites ?? []).map((symbol) => ({ symbol })) as T, undefined];
      }
      if (s.includes('overseas_universe_revision')) {
        if (o.throwOn === 'revision') boom();
        return [(o.manual == null ? [] : [{ symbols: JSON.stringify(o.manual) }]) as T, undefined];
      }
      if (s.includes('overseas_universe_auto')) {
        if (o.throwOn === 'auto') boom();
        return [(o.auto ?? []).map((symbol) => ({ symbol })) as T, undefined];
      }
      return [[] as unknown as T, undefined];
    },
  };
}

describe('🔴 C-3 — 목록 조회 실패가 errors 에 남는다', () => {
  it('목록 조회가 실패하면 `universe_list` 를 남긴다(흔적 없이 지나가지 않게)', async () => {
    const r = await loadUsTargetSymbols(db({ throwOn: 'revision' }));
    expect(r.errors).toContain('universe_list');
    expect(r.symbols).toEqual(['NAS:ENV1', 'NAS:ENV2']);   // 폴백으로 계속 돈다(분석을 멈추지 않는다)
  });

  it('자동 목록만 실패해도 남긴다(수동 목록은 그대로 쓰면서)', async () => {
    const r = await loadUsTargetSymbols(db({ manual: ['NAS:AAAA'], throwOn: 'auto' }));
    expect(r.errors).toContain('universe_list');
    expect(r.symbols).toEqual(['NAS:AAAA']);
  });

  it('해석 불가한 개정판 JSON 도 읽기 실패로 남긴다', async () => {
    const broken: Queryable = {
      async query<T>(sql: string): Promise<[T, unknown]> {
        if (sql.includes('overseas_universe_revision')) return [[{ symbols: 'not json' }] as unknown as T, undefined];
        return [[] as unknown as T, undefined];
      },
    };
    expect((await loadUsTargetSymbols(broken)).errors).toContain('universe_list');
  });

  it('🔴 ① 마이그레이션 적용 전(errno 1146)도 남긴다 — 코드가 DDL 보다 먼저 뜬 구간은 순서 위반 신호다', async () => {
    const r = await loadUsTargetSymbols(db({ throwOn: 'revision', errno: 1146 }));
    expect(r.errors).toContain('universe_list');
    expect(r.symbols).toEqual(['NAS:ENV1', 'NAS:ENV2']);   // 폴백으로 계속 돈다
  });

  it('🔴 ③ 개정판 원소가 손상되면(비문자열·형식 무효) 남긴다 — 걸러 내고 정상처럼 쓰지 않는다', async () => {
    const bad = (symbols: string): Queryable => ({
      async query<T>(sql: string): Promise<[T, unknown]> {
        if (sql.includes('overseas_universe_revision')) return [[{ symbols }] as unknown as T, undefined];
        return [[] as unknown as T, undefined];
      },
    });
    expect((await loadUsTargetSymbols(bad('["NAS:AAAA", 42]'))).errors).toContain('universe_list');
    expect((await loadUsTargetSymbols(bad('["AAPL"]'))).errors).toContain('universe_list');
  });

  it('🔴 C-1 — 표를 **본 적이 있는** 프로세스의 1146 은 표 소실이라 남긴다', async () => {
    await loadUsTargetSymbols(db({ manual: ['NAS:AAAA'] }));          // 1회차 성공
    const r = await loadUsTargetSymbols(db({ throwOn: 'revision', errno: 1146 }));
    expect(r.errors).toContain('universe_list');
    expect(r.symbols).toEqual(['NAS:AAAA']);                          // 마지막 성공 목록을 쓴다
  });

  it('정상이면 errors 가 비어 있다 — 「확인된 0」과 「못 읽음」을 섞지 않는다', async () => {
    const r = await loadUsTargetSymbols(db({ manual: ['NAS:AAAA'], auto: ['NYS:CAAA'] }));
    expect(r.errors).toEqual([]);
    expect(r.symbols).toEqual(['NAS:AAAA', 'NYS:CAAA']);
  });
});

describe('기존 계약은 그대로다 — 출처별 실패 이름·합집합·해외 형식 필터', () => {
  it('보유·즐겨찾기 조회 실패는 각자 이름으로 남고 나머지로 계속한다', async () => {
    const a = await loadUsTargetSymbols(db({ manual: ['NAS:AAAA'], throwOn: 'position_state' }));
    expect(a.errors).toEqual(['position_state']);
    const b = await loadUsTargetSymbols(db({ manual: ['NAS:AAAA'], throwOn: 'stock_favorites' }));
    expect(b.errors).toEqual(['stock_favorites']);
  });

  it('대상 = 보유 ∪ 즐겨찾기 ∪ 목록, 정렬되고 **해외 형식만** 남는다(국내 6자리 배제)', async () => {
    const r = await loadUsTargetSymbols(db({
      positions: ['NAS:SMH', '005930'], favorites: ['NAS:MU', '000660'],
      manual: ['NAS:AAAA'], auto: ['NYS:CAAA'],
    }));
    expect(r.symbols).toEqual(['NAS:AAAA', 'NAS:MU', 'NAS:SMH', 'NYS:CAAA']);
    expect(r.errors).toEqual([]);
  });
});
