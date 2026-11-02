/**
 * T-143 WP-A — 산출 엔진의 단계·예산·이어받기 (사양 §3 · §12.3 「청크·예산」 · §12.4 QA A-1~A-6).
 *
 * 저장소(`refresh-store`)는 **메모리 모형**으로 바꿔 끼운다 — SQL 없이 엔진의 판단만 본다.
 * 외부(SEC·마스터·KIS)는 전부 주입이라 이 시험은 **네트워크에 나가지 않는다.**
 */
import { indexMaster, type OverseasMasterFile } from '../kis-overseas-master';
import type { CandidateVerdict, FinalizeRow, RunPhase } from '../refresh-store';
import { runKeyOf, runUniverseRefresh, type FetchPriceOutcome, type RefreshDeps } from '../refresh-engine';

// 저장소만 메모리 모형으로 바꿔 끼운다 — 엔진은 그대로 돈다(DB·네트워크 0).
jest.mock('../refresh-store', () => jest.requireActual('./helpers/fake-refresh-store'));

// eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
const fake = jest.requireActual('./helpers/fake-refresh-store') as typeof import('./helpers/fake-refresh-store');

const SEC_JSON = {
  fields: ['cik', 'name', 'ticker', 'exchange'],
  data: [
    [1, 'ALPHA', 'AAA', 'NYSE'],
    [2, 'BETA', 'BBB', 'NYSE'],
    [3, 'PREF', 'CCC-PA', 'NYSE'],          // 사전 제외
    [4, 'ETPCO', 'DDD', 'NYSE'],            // 마스터 stis=3
    [5, 'NOMASTER', 'EEE', 'NYSE'],         // 마스터에 없음
    [6, 'DRCO', 'FFF', 'NYSE'],             // DR — 스캔은 한다
    [7, 'NASCO', 'GGG', 'Nasdaq'],          // NYSE 아님
  ],
};

function masterOf(): OverseasMasterFile {
  const e = (symb: string, stis = '2', isdr = 'N', etyp = '') => ({
    // 🔴 `enam` 은 `symb` 와 **반드시 달라야** 한다(Reviewer r4) — 같으면 「kisEnam 을 kisSymb 에서
    //   가져온다」는 변이가 구별되지 않는다. 아래 listing 단언이 이 차이에 기댄다.
    symb, rsym: `NYS${symb}`, excd: 'NYS', enam: `${symb} HOLDINGS PLC`, stis, isdr, etyp,
  });
  return indexMaster({
    entries: [e('AAA'), e('BBB'), e('CCC/PA'), e('DDD', '3', 'N', '001'), e('FFF', '2', 'Y')],
    dropped: 0,
  }, 'm'.repeat(64));
}

interface Harness {
  deps: RefreshDeps;
  clock: { ms: number };
  calls: { sec: number; master: number; price: string[] };
  setPrice: (fn: (symb: string) => FetchPriceOutcome) => void;
  /** 한 종목 조회가 소모하는 가짜 시간(ms). */
  perCallMs: { v: number };
}

function harness(opts: { manual?: string[] } = {}): Harness {
  const clock = { ms: Date.parse('2026-12-06T01:10:00+09:00') };
  const calls = { sec: 0, master: 0, price: [] as string[] };
  const perCallMs = { v: 500 };
  let price: (symb: string) => FetchPriceOutcome = () => ({
    kind: 'ok', values: { tomv: 1e11, shar: 1e9, last: 100, curr: 'USD', etypNm: null, rsym: null },
  });
  const deps: RefreshDeps = {
    db: { query: async () => [[], null] },
    nowMs: () => clock.ms,
    fetchSecListing: async () => { calls.sec += 1; return { json: SEC_JSON, sha256: 's'.repeat(64) }; },
    fetchMaster: async () => { calls.master += 1; return masterOf(); },
    fetchPrice: async (symb) => {
      calls.price.push(symb);
      clock.ms += perCallMs.v;      // 가짜 시간 — 예산 판정이 실제로 걸리게 한다
      return price(symb);
    },
    readManualList: async () => opts.manual ?? [],
    secTickerOf: (s) => (s.includes(':') ? s.slice(s.indexOf(':') + 1).replace(/[./]/g, '-') : null),
  };
  return { deps, clock, calls, setPrice: (fn) => { price = fn; }, perCallMs };
}

const KEY = '2026-12';

beforeEach(() => fake.__reset());

describe('listing — 후보를 만들고 scan 으로 넘긴다', () => {
  it('사전 제외·마스터 제외·스캔 대상이 사유와 함께 남는다', async () => {
    const h = harness();
    const r = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect([r.status, r.phase, r.final]).toEqual(['listing', 'scan', false]);
    expect([h.calls.sec, h.calls.master, h.calls.price]).toEqual([1, 1, []]);

    const byS = new Map(fake.__candidates().map((c) => [c.symbol, c]));
    expect(byS.size).toBe(6);                                    // NYSE 6행만(Nasdaq 제외)
    expect(byS.get('NYS:AAA')).toMatchObject({ status: 'pending', kisSymb: 'AAA', exclusion: null });
    /**
     * 🔴 (Reviewer r4 E2) **listing 이 마스터 `enam` 을 후보 행에 싣는지** — 이 연결만 아무 시험도
     * 지키지 않아 「`kisEnam: null` 을 담는다」는 변이가 어디서도 잡히지 않았다. r2 high-1 과 같은
     * 자리다(출처가 틀려도 `count:0` 이라 아무것도 안 깨지던 그 구멍). 뒤쪽 의심 집계 시험들은
     * `toFinalize` 로 finalize 입력에 값을 **곧장** 넣어 listing 을 우회하고, DB 시험은
     * `saveListing` 을 직접 부른다 — 그 사이가 여기다.
     *
     * `enam` 은 fixture 에서 `'<SYMB> HOLDINGS PLC'` 라 `kisSymb` 와 구별된다 → 「symb 에서 가져오기」
     * 변이도 함께 걸린다.
     */
    expect(byS.get('NYS:AAA')!.kisEnam).toBe('AAA HOLDINGS PLC');
    expect(byS.get('NYS:BBB')!.kisEnam).toBe('BBB HOLDINGS PLC');
    expect(byS.get('NYS:FFF')!.kisEnam).toBe('FFF HOLDINGS PLC');       // DR 도 스캔하므로 이름이 필요하다
    // 마스터를 **찾은** 제외 분기도 이름을 남긴다(사람이 왜 빠졌는지 행에서 읽을 수 있어야 한다)
    const byX = new Map(fake.__candidates().map((c) => [c.exclusion, c]));
    expect(byX.get('master_type')!.kisEnam).toBe('DDD HOLDINGS PLC');
    // 마스터를 **보기 전에** 빠지는 분기는 null 이다(담을 이름이 없다 — 가짜 값을 만들지 않는다)
    expect(byX.get('master_missing')!.kisEnam).toBeNull();
    expect(byX.get('prefilter_noncommon')!.kisEnam).toBeNull();
    // 이름이 심볼과 뒤바뀌지 않았다
    expect(byS.get('NYS:AAA')!.kisEnam).not.toBe(byS.get('NYS:AAA')!.kisSymb);
    expect(byS.get('NYS:CCC.PA')).toMatchObject({ status: 'excluded', exclusion: 'prefilter_noncommon', kisSymb: null });
    expect(byS.get('NYS:DDD')).toMatchObject({ status: 'excluded', exclusion: 'master_type' });
    expect(byS.get('NYS:EEE')).toMatchObject({ status: 'excluded', exclusion: 'master_missing' });
    // 🔴 DR 은 스캔 대상이다(가상 순위를 알아야 한다 — L-A2)
    expect(byS.get('NYS:FFF')).toMatchObject({ status: 'pending', kisIsdr: 'Y' });
    expect(byS.get('NYS:GGG')).toBeUndefined();
  });

  it('🔴 내부 심볼 규약을 통과하지 못하는 티커는 보이게 뺀다(조용히 분석 대상에서 빠지지 않게)', async () => {
    const h = harness();
    // 숫자로 시작하는 티커는 `isOverseasSymbol`(/^[A-Z]{3}:[A-Z][A-Z0-9.]*$/)을 통과하지 못한다 →
    // 자동 목록에 넣으면 `loadUsTargetSymbols` 가 조용히 떨어뜨린다(「자동 50인데 분석 대상 49」)
    h.deps.fetchSecListing = async () => ({
      json: { fields: ['cik', 'name', 'ticker', 'exchange'], data: [[1, 'ODD', '3AAA', 'NYSE'], [2, 'OK', 'AAA', 'NYSE']] },
      sha256: 'x'.repeat(64),
    });
    await runUniverseRefresh(h.deps, { topN: 1, excludeDr: true }, KEY);
    const byS = new Map(fake.__candidates().map((c) => [c.symbol, c]));
    expect(byS.get('NYS:3AAA')).toMatchObject({ status: 'excluded', exclusion: 'symbol_format', kisSymb: null });
    expect(byS.get('NYS:AAA')).toMatchObject({ status: 'pending' });
    expect(JSON.parse(fake.__run()!.countsJson ?? '{}')).toMatchObject({ symbol_format: 1, scan_targets: 1 });
    expect(h.calls.price).toEqual([]);   // 마스터·KIS 를 보기 전에 빠진다
  });

  it('클래스주는 마스터의 슬래시 표기를 저장한다(내부 심볼은 점 그대로)', async () => {
    const h = harness();
    h.deps.fetchSecListing = async () => ({
      json: { fields: ['cik', 'name', 'ticker', 'exchange'], data: [[1, 'BRK', 'CCC-PA', 'NYSE']] },
      sha256: 'x'.repeat(64),
    });
    // CCC-PA 는 사전 제외라 kis_symb 가 없다 → 클래스주 예를 따로 본다
    h.deps.fetchSecListing = async () => ({
      json: { fields: ['cik', 'name', 'ticker', 'exchange'], data: [[1, 'X', 'CCC-A', 'NYSE']] },
      sha256: 'x'.repeat(64),
    });
    h.deps.fetchMaster = async () => indexMaster({
      entries: [{ symb: 'CCC/A', rsym: 'NYSCCC/A', excd: 'NYS', enam: 'X', stis: '2', isdr: 'N', etyp: '' }],
      dropped: 0,
    }, 'y'.repeat(64));
    await runUniverseRefresh(h.deps, { topN: 1, excludeDr: true }, KEY);
    expect(fake.__candidates()[0]).toMatchObject({ symbol: 'NYS:CCC.A', kisSymb: 'CCC/A', status: 'pending' });
  });

  it('run 에 SEC·마스터 해시와 행 수가 남는다(본문은 저장하지 않는다)', async () => {
    const h = harness();
    await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect(fake.__listingMeta()).toMatchObject({
      sec: { sha256: 's'.repeat(64), rows: 7 },
      master: { sha256: 'm'.repeat(64), rows: 5 },
    });
    const counts = JSON.parse(fake.__run()!.countsJson ?? '{}');
    expect(counts).toMatchObject({
      sec_rows: 7, sec_nyse: 6, master_rows: 5, master_missing: 1,
      prefiltered_noncommon: { total: 1, by_suffix: { PA: 1 } },
      dr_candidates: 1, scan_targets: 3, top_n: 2, exclude_dr: true,
    });
  });

  it('🔴 마스터를 못 받으면 failed — 추측 표기로 KIS 를 부르지 않는다', async () => {
    const h = harness();
    h.deps.fetchMaster = async () => { throw new Error('HTTP 503'); };
    const r = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect([r.status, r.final]).toEqual(['failed', true]);
    expect(r.lastError).toContain('master_unavailable');
    expect(h.calls.price).toEqual([]);
  });

  it('🔴 선언 User-Agent 가 없으면 SEC·마스터·KIS 를 아예 부르지 않는다', async () => {
    const h = harness();
    h.deps.fetchSecListing = null;
    const r = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect([r.status, r.lastError]).toEqual(['failed', 'sec_user_agent_missing']);
    expect([h.calls.master, h.calls.price.length]).toEqual([0, 0]);
  });

  it('SEC 응답 모양이 다르면 failed(엉뚱한 열을 읽지 않는다)', async () => {
    const h = harness();
    h.deps.fetchSecListing = async () => ({ json: { fields: ['cik'], data: [] }, sha256: 'z'.repeat(64) });
    const r = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect([r.status, r.final]).toEqual(['failed', true]);
    expect(r.lastError).toContain('sec_shape');
  });

  it('스캔 대상이 0이면 failed(원천이 깨진 것이다)', async () => {
    const h = harness();
    h.deps.fetchMaster = async () => indexMaster({ entries: [], dropped: 0 }, 'q'.repeat(64));
    // 빈 마스터는 parse 단계에서 못 만들지만, 색인만 비는 경우를 직접 넣어 본다
    const r = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect([r.status, r.lastError]).toEqual(['failed', 'no_scan_targets']);
  });
});

describe('scan — 100초 예산·커서·이어받기', () => {
  async function toScan(h: Harness) {
    await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
  }

  it('예산을 넘으면 그 자리에서 멈추고 다음 호출이 이어받는다', async () => {
    const h = harness();
    // 후보 300개를 직접 깔고 scan 단계로 둔다
    await toScan(h);
    fake.__seedPending(300);
    h.perCallMs.v = 1_000;                      // 한 건 1초 → 100건이면 예산 소진
    const t0 = h.clock.ms;

    const r1 = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect(r1.status).toBe('scan_partial');
    expect(r1.final).toBe(false);
    expect(h.clock.ms - t0).toBeLessThanOrEqual(102_000);       // 100초 예산 + 동시성 2의 마지막 한 쌍
    const done1 = h.calls.price.length;
    expect(done1).toBeGreaterThan(90);
    expect(done1).toBeLessThan(120);
    expect(fake.__run()!.cursorPos).toBeGreaterThan(0);

    const r2 = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect(r2.status).toBe('scan_partial');
    // 🔴 앞 청크가 끝낸 종목을 다시 부르지 않는다
    expect(new Set(h.calls.price).size).toBe(h.calls.price.length);
    expect(fake.__run()!.cursorPos).toBeGreaterThan(done1 - 1);
  });

  it('동시성은 2다 — 한 번에 셋 이상 날아가지 않는다', async () => {
    const h = harness();
    await toScan(h);
    fake.__seedPending(20);
    let live = 0;
    let peak = 0;
    h.deps.fetchPrice = async (symb) => {
      live += 1; peak = Math.max(peak, live);
      await Promise.resolve();
      live -= 1;
      h.calls.price.push(symb);
      return { kind: 'ok', values: { tomv: 1e11, shar: 1e9, last: 100, curr: 'USD', etypNm: null, rsym: null } };
    };
    await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('🔴 스로틀을 만나면 즉시 중단하고 그 종목은 pending 으로 남는다(증폭 방지)', async () => {
    const h = harness();
    await toScan(h);
    fake.__seedPending(50);
    let n = 0;
    h.setPrice(() => {
      n += 1;
      return n >= 3 ? { kind: 'throttled', error: 'queue full' } : {
        kind: 'ok', values: { tomv: 1e11, shar: 1e9, last: 100, curr: 'USD', etypNm: null, rsym: null },
      };
    });
    const r = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect(r.status).toBe('throttled');
    expect(r.final).toBe(false);
    expect(h.calls.price.length).toBeLessThan(6);               // 멈췄다 — 50건을 다 두드리지 않는다
    expect(fake.__progress().pending).toBeGreaterThan(44);

    // 다음 호출은 남은 것부터 재개한다
    h.setPrice(() => ({ kind: 'ok', values: { tomv: 1e11, shar: 1e9, last: 100, curr: 'USD', etypNm: null, rsym: null } }));
    const r2 = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect(r2.status).toBe('scan_partial');
    expect(fake.__progress().ok).toBeGreaterThan(2);
  });

  it('조회 불가는 kis_missing, 네트워크 오류는 kis_error 로 갈라 센다', async () => {
    const h = harness();
    await toScan(h);
    h.setPrice((symb) => (symb === 'AAA'
      ? { kind: 'missing', error: '판정 불가' }
      : symb === 'BBB' ? { kind: 'error', error: 'ECONNRESET' }
        : { kind: 'ok', values: { tomv: 1e11, shar: 1e9, last: 100, curr: 'USD', etypNm: null, rsym: null } }));
    await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    const p = fake.__progress();
    expect([p.kisMissing, p.kisError, p.ok]).toEqual([1, 1, 1]);
  });

  it('`kis_symb` 가 없는 후보는 부르지 않고 kis_missing 으로 둔다', async () => {
    const h = harness();
    await toScan(h);
    fake.__clearPending();
    fake.__seedPending(1, { kisSymb: null });
    await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect(h.calls.price).toEqual([]);
    expect(fake.__progress().kisMissing).toBe(1);
  });

  it('남은 pending 이 없으면 retry → finalize 로 단계가 넘어간다', async () => {
    const h = harness();
    await toScan(h);
    fake.__clearPending();
    const r1 = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect([r1.status, r1.phase]).toEqual(['scan_done', 'retry']);
    const r2 = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect([r2.status, r2.phase]).toEqual(['retry_done', 'finalize']);
  });

  it('retry 는 kis_error 만 한 번 더 본다(kis_missing 은 다시 부르지 않는다)', async () => {
    const h = harness();
    await toScan(h);
    fake.__clearPending();
    fake.__setStatus('NYS:AAA', 'kis_error', 1);
    fake.__setStatus('NYS:BBB', 'kis_missing', 1);
    await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);   // scan → retry
    h.calls.price.length = 0;
    await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);   // retry
    expect(h.calls.price).toEqual(['AAA']);
  });
});

describe('finalize — 자동 목록 교체·변동 계산', () => {
  async function toFinalize(
    h: Harness,
    rows: Array<{ symbol: string; cik: number; tomv: number | null; isDr?: boolean; secName?: string; kisEnam?: string }>,
  ) {
    await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    fake.__clearPending();
    const fin: FinalizeRow[] = rows.map((r, i) => ({
      ord: i, symbol: r.symbol, cik: r.cik, secName: r.secName ?? null, kisEnam: r.kisEnam ?? null,
      curr: 'USD', etypNm: null,
      tomv: r.tomv, shar: r.tomv == null ? null : r.tomv / 100, last: 100, isDr: r.isDr ?? false,
    }));
    fake.__setFinalizeRows(fin);
    fake.__setPhase('finalize');
  }

  it('상위 N 을 자동 목록으로 교체하고 computed_at 이 모두 같다', async () => {
    const h = harness();
    await toFinalize(h, [
      { symbol: 'NYS:A', cik: 1, tomv: 3e11 },
      { symbol: 'NYS:B', cik: 2, tomv: 2e11 },
      { symbol: 'NYS:C', cik: 3, tomv: 1e11 },
    ]);
    const r = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect([r.status, r.final, r.phase]).toEqual(['complete', true, 'complete']);
    expect(fake.__auto()).toEqual([
      { symbol: 'NYS:A', rankNo: 1, marketCap: 3e11 },
      { symbol: 'NYS:B', rankNo: 2, marketCap: 2e11 },
    ]);
    expect(fake.__autoComputedAtCount()).toBe(1);               // 한 트랜잭션·한 시각
  });

  it('🔴 상위 N 을 못 채우면 failed 이고 자동 목록을 건드리지 않는다', async () => {
    const h = harness();
    fake.__setAuto([{ symbol: 'NYS:OLD', rankNo: 1, marketCap: 1e12 }]);
    await toFinalize(h, [{ symbol: 'NYS:A', cik: 1, tomv: 3e11 }]);
    const r = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect([r.status, r.final]).toEqual(['failed', true]);
    expect(r.lastError).toContain('insufficient_candidates:1/2');
    expect(fake.__auto()).toEqual([{ symbol: 'NYS:OLD', rankNo: 1, marketCap: 1e12 }]);
  });

  it('🔴 1회차는 added·removed 가 비지만 **알릴 사건**으로 표시된다(firstRun·top) — 전에는 이 침묵을 의도로 고정했다', async () => {
    // Reviewer WP-A high-2: diff 가 없는 것은 맞다(직전 run 이 없다). 틀렸던 것은 그 빈 값 때문에
    // 「변화 0 = 침묵」이 **0 → 상위 N 이라는 가장 큰 변화를 유일하게 조용히** 만든 것이다(L-A1 과 어긋난다).
    const h = harness();
    await toFinalize(h, [{ symbol: 'NYS:A', cik: 1, tomv: 3e11 }, { symbol: 'NYS:B', cik: 2, tomv: 2e11 }]);
    const r = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect(r.changes).toMatchObject({
      added: [], removed: [],              // diff 는 없다(직전 run 이 없다)
      firstRun: true,                      // 그러나 알릴 사건이다
      top: ['NYS:A', 'NYS:B'],             // 알림 본문에 쓸 산출 결과
    });
    expect(JSON.parse(fake.__run()!.countsJson ?? '{}')).toMatchObject({ first_run: true, prev_top_n: 0 });
  });

  it('2회차는 firstRun=false 다(그때는 diff 가 알림의 근거다)', async () => {
    const h = harness();
    fake.__setPrevTop(['NYS:A', 'NYS:Z']);
    await toFinalize(h, [{ symbol: 'NYS:A', cik: 1, tomv: 3e11 }, { symbol: 'NYS:B', cik: 2, tomv: 2e11 }]);
    const r = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect(r.changes).toMatchObject({ firstRun: false, added: ['NYS:B'], removed: ['NYS:Z'] });
  });

  it('🔴 ADR 탐지의 한계를 수치와 같은 자리에 적는다 — 「ADR 은 걸러졌다」로 읽히지 않게(high-1)', async () => {
    // 🔴 이름은 **마스터 `kisEnam`** 에 둔다. 앞 판은 마스터 형식 이름을 `secName` 자리에 넣어 통과했는데,
    //   운영의 SEC `name` 에는 그 표지가 **0건**이라 실제로는 늘 count:0 이 됐다 — **거짓 통과**였다(Reviewer r2 ①).
    //   아래 `secName` 은 **운영에서 실제로 오는 모양**(표지 없음)을 그대로 쓴다.
    const h = harness();
    await toFinalize(h, [
      { symbol: 'NYS:TSM', cik: 1, tomv: 9e11, isDr: true, secName: 'Taiwan Semiconductor Manufacturing Company Ltd.', kisEnam: 'TAIWAN SEMICONDUCTOR MANUFACTURING SPON ADS' },
      { symbol: 'NYS:BABA', cik: 2, tomv: 8e11, secName: 'Alibaba Group Holding Ltd', kisEnam: 'ALIBABA GROUP HOLDING LTD SPON ADS EACH REP' },
      { symbol: 'NYS:JPM', cik: 3, tomv: 7e11, secName: 'JPMORGAN CHASE & CO', kisEnam: 'JPMORGAN CHASE & CO' },
    ]);
    await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    const counts = JSON.parse(fake.__run()!.countsJson ?? '{}');
    // isdr=Y 인 TSM 은 빠지고, isdr=N 인데 이름상 ADR 인 BABA 는 **상위에 남는다** — 그 사실을 센다
    expect(fake.__auto().map((a) => a.symbol)).toEqual(['NYS:BABA', 'NYS:JPM']);
    expect(counts.dr_detection).toMatchObject({ method: 'kis_master_isdr_only' });
    expect(counts.dr_detection.limitation).toContain('115');   // 힌트 정규식 기준 180/115 — 더 넓은 정규식의 183/118 이 아니다
    expect(counts.dr_detection.limitation).not.toContain('118');
    expect(counts.foreign_suspects_in_top).toMatchObject({
      method: 'name_hint_adr_ads_spon', source: 'kis_master_enam',
      estimate_only: true, excluded_by_this: false, count: 1,
    });
    expect(counts.foreign_suspects_in_top.items[0]).toMatchObject({ symbol: 'NYS:BABA', rank: 1 });
    expect(counts.foreign_suspects_in_top.items[0].enam).toContain('SPON ADS');
  });

  it('🔴 이미 DR 로 표시된 행은 **의심**으로 세지 않는다 — excludeDr:false 에서만 드러나는 자리(E3)', async () => {
    // 기존 시험은 전부 excludeDr:true 라 DR 행이 애초에 상위에 없었다 → `!r.isDr` 필터가 무용이었고
    // 그 필터를 지우는 변이가 통과했다(Reviewer r3 mut3). 2회차 선택지에서는 DR 이 상위에 남는다.
    const h = harness();
    await toFinalize(h, [
      { symbol: 'NYS:KNOWN', cik: 1, tomv: 9e11, isDr: true, kisEnam: 'KNOWN PLC SPON ADR' },
      { symbol: 'NYS:SUSP', cik: 2, tomv: 8e11, isDr: false, kisEnam: 'SUSPECT CO SPON ADS' },
    ]);
    await runUniverseRefresh(h.deps, { topN: 2, excludeDr: false }, KEY);
    const s = JSON.parse(fake.__run()!.countsJson ?? '{}').foreign_suspects_in_top;
    // 둘 다 이름 힌트에 걸리지만 **이미 아는 DR 은 의심이 아니다** — 의심 목록은 isdr 이 놓친 것만 말한다
    expect(s.count).toBe(1);
    expect(s.items.map((i: { symbol: string }) => i.symbol)).toEqual(['NYS:SUSP']);
    // excludeDr:false 이므로 DR 도 자동 목록에는 남는다(의심 집계가 목록을 바꾸지 않는다)
    expect(fake.__auto().map((a) => a.symbol)).toEqual(['NYS:KNOWN', 'NYS:SUSP']);
  });

  it('🔴 이름 힌트에 걸려도 **목록에서 빠지지 않는다** — 집계는 보고용이고 제외 근거가 아니다(E4)', async () => {
    const h = harness();
    await toFinalize(h, [
      { symbol: 'NYS:HINT', cik: 1, tomv: 9e11, isDr: false, kisEnam: 'HINT CORP SPON ADS EACH REP' },
      { symbol: 'NYS:PLAIN', cik: 2, tomv: 8e11, isDr: false, kisEnam: 'PLAIN CORP' },
    ]);
    await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect(JSON.parse(fake.__run()!.countsJson ?? '{}').foreign_suspects_in_top)
      .toMatchObject({ count: 1, excluded_by_this: false });
    // 🔴 필드만 보지 않는다 — 실제로 자동 목록에 **순위까지 그대로** 남아야 한다
    expect(fake.__auto()).toEqual([
      { symbol: 'NYS:HINT', rankNo: 1, marketCap: 9e11 },
      { symbol: 'NYS:PLAIN', rankNo: 2, marketCap: 8e11 },
    ]);
    // 그 후보의 판정에 제외 사유가 붙지 않았다
    expect(fake.__verdicts().find((x) => x.rankNo === 1)?.exclusion ?? null).toBeNull();
  });

  it('🔴 SEC 이름만 ADR 표지를 가져도 집계되지 않는다 — 출처는 마스터 enam 하나다(출처 되돌림 방지)', async () => {
    // 이 시험이 깨지면 누군가 출처를 SEC `name` 으로 되돌린 것이다 → 운영에서 늘 count:0 이 된다
    const h = harness();
    await toFinalize(h, [
      { symbol: 'NYS:A', cik: 1, tomv: 9e11, secName: 'FAKE SPON ADS CORP', kisEnam: 'FAKE CORP' },
      { symbol: 'NYS:B', cik: 2, tomv: 8e11, secName: 'PLAIN CO', kisEnam: 'PLAIN CO' },
    ]);
    await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect(JSON.parse(fake.__run()!.countsJson ?? '{}').foreign_suspects_in_top).toMatchObject({ count: 0, items: [] });
  });

  it('이름이 없으면(마스터 미보유) 집계하지 않는다 — 모름을 「의심 없음」으로도 「의심」으로도 바꾸지 않는다', async () => {
    const h = harness();
    await toFinalize(h, [
      { symbol: 'NYS:A', cik: 1, tomv: 9e11 },
      { symbol: 'NYS:B', cik: 2, tomv: 8e11 },
    ]);
    await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect(JSON.parse(fake.__run()!.countsJson ?? '{}').foreign_suspects_in_top.count).toBe(0);
  });

  it('실패는 분류어를 함께 낸다 — `lastError` 문장은 error_code 에 넣을 수 없다(M-2)', async () => {
    const h = harness();
    h.deps.fetchMaster = async () => { throw new Error('HTTP 503'); };
    const r = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect([r.status, r.failCode]).toEqual(['failed', 'master_unavailable']);
    expect(r.lastError).toContain('master_unavailable');
  });

  it('종결 단계 읽기도 분류어를 낸다(만료·실패가 기록에 남게)', async () => {
    for (const [phase, lastError, want] of [
      ['failed', 'insufficient_candidates:1/2', 'insufficient_candidates'],
      ['expired', 'window_passed', 'window_passed'],
      ['expired', null, 'expired'],
    ] as Array<[RunPhase, string | null, string]>) {
      fake.__reset();
      const h = harness();
      fake.__setRun({ runId: 1, runKey: KEY, phase, topN: 2, cursorPos: 0, secSha256: null, lastError, notifiedAt: null });
      const r = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
      expect([r.status, r.failCode]).toEqual([phase, want]);
    }
  });

  it('2회차는 직전 목록과 대조해 added·removed 를 낸다', async () => {
    const h = harness();
    fake.__setPrevTop(['NYS:A', 'NYS:Z']);
    await toFinalize(h, [{ symbol: 'NYS:A', cik: 1, tomv: 3e11 }, { symbol: 'NYS:B', cik: 2, tomv: 2e11 }]);
    const r = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect(r.changes).toMatchObject({ added: ['NYS:B'], removed: ['NYS:Z'] });
  });

  it('판정 결과가 후보 행에 되쓰인다(cap_flag·제외 사유·순위)', async () => {
    const h = harness();
    await toFinalize(h, [
      { symbol: 'NYS:A', cik: 1, tomv: 3e11 },
      { symbol: 'NYS:B', cik: 2, tomv: 2e11 },
      { symbol: 'NYS:NUL', cik: 9, tomv: null },
    ]);
    await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    const v = new Map(fake.__verdicts().map((x: CandidateVerdict) => [x.ord, x]));
    expect(v.get(0)).toMatchObject({ rankNo: 1, capFlag: 'consistent', exclusion: null });
    expect(v.get(2)).toMatchObject({ rankNo: null, capFlag: 'tomv_null', exclusion: 'tomv_null' });
  });

  it('DR 가상 순위를 counts 에 남긴다(L-A2)', async () => {
    const h = harness();
    await toFinalize(h, [
      { symbol: 'NYS:A', cik: 1, tomv: 3e11 },
      { symbol: 'NYS:DR', cik: 2, tomv: 2.5e11, isDr: true },
      { symbol: 'NYS:B', cik: 3, tomv: 2e11 },
    ]);
    await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect(fake.__auto().map((a) => a.symbol)).toEqual(['NYS:A', 'NYS:B']);
    expect(JSON.parse(fake.__run()!.countsJson ?? '{}')).toMatchObject({
      dr_excluded: 1, dr_in_virtual_top: 1, dr_virtual_ranks: { 'NYS:DR': 2 },
    });
  });

  it('제안 생성이 실패해도 complete 를 되돌리지 않는다', async () => {
    const h = harness({ manual: ['NYS:AAA'] });
    await toFinalize(h, [{ symbol: 'NYS:A', cik: 1, tomv: 3e11 }, { symbol: 'NYS:B', cik: 2, tomv: 2e11 }]);
    h.deps.readManualList = async () => { throw new Error('db down'); };
    const r = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect([r.status, r.final]).toEqual(['complete', true]);
    expect(r.changes?.proposalsCreated).toBe(0);
  });
});

describe('run 상태 — 같은 달에 두 번 끝내지 않는다 (QA A-6)', () => {
  it('이달 run 이 complete 면 외부 호출 0건으로 final:true 다', async () => {
    const h = harness();
    fake.__setRun({ runId: 1, runKey: KEY, phase: 'complete', topN: 2, cursorPos: 0, secSha256: null, lastError: null, notifiedAt: null });
    const r = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect([r.ok, r.status, r.final]).toEqual([true, 'complete', true]);
    expect([h.calls.sec, h.calls.master, h.calls.price.length]).toEqual([0, 0, 0]);
  });

  it('failed·expired 도 final:true 다(그 달은 더 부르지 않는다)', async () => {
    for (const phase of ['failed', 'expired'] as RunPhase[]) {
      fake.__reset();
      const h = harness();
      fake.__setRun({ runId: 1, runKey: KEY, phase, topN: 2, cursorPos: 0, secSha256: null, lastError: 'x', notifiedAt: null });
      const r = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
      expect([r.ok, r.status, r.final]).toEqual([false, phase, true]);
      expect(h.calls.sec).toBe(0);
    }
  });

  it('표가 없으면 외부 호출 0건으로 final:true (QA A-10 전 상태)', async () => {
    const h = harness();
    fake.__setNotMigrated(true);
    const r = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect([r.ok, r.status, r.final]).toEqual([true, 'tables_missing', true]);
    expect([h.calls.sec, h.calls.master]).toEqual([0, 0]);
  });

  it('알 수 없는 예외는 failed 로 닫고 메시지를 남긴다', async () => {
    const h = harness();
    fake.__setRun({ runId: 1, runKey: KEY, phase: 'scan', topN: 2, cursorPos: 0, secSha256: null, lastError: null, notifiedAt: null });
    fake.__throwOnPending(new Error('boom'));
    const r = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect([r.status, r.final]).toEqual(['failed', true]);
    expect(r.lastError).toContain('boom');
  });
});

describe('run_key', () => {
  it('KST 벽시계의 YYYY-MM 이다(UTC 가 아니다)', () => {
    expect(runKeyOf(Date.parse('2026-12-01T00:30:00+09:00'))).toBe('2026-12');
    // UTC 로는 11-30 이지만 KST 로는 12-01 이다
    expect(runKeyOf(Date.parse('2026-11-30T16:30:00Z'))).toBe('2026-12');
  });
});
