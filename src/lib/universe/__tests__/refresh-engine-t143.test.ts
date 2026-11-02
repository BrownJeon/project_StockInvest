/**
 * T-143 WP-A — 산출 엔진의 단계·예산·이어받기 (사양 §3 · §12.3 「청크·예산」 · §12.4 QA A-1~A-6).
 *
 * 저장소(`refresh-store`)는 **메모리 모형**으로 바꿔 끼운다 — SQL 없이 엔진의 판단만 본다.
 * 외부(SEC·마스터·KIS)는 전부 주입이라 이 시험은 **네트워크에 나가지 않는다.**
 *
 * 🔴 T-145 ⑥-4 로 **일시 오류는 그 달을 닫지 않는다**(`final:false`, run 은 그 단계 그대로). 그래서
 * 「실패 = `final:true`」를 단언하던 시험 둘(마스터 못 받음·알 수 없는 예외)이 **의도적으로** 바뀌었다 —
 * 아래 그 자리에 근거를 적었고, 「영구 실패만 닫는다」는 `일시/영구` describe 가 양쪽을 함께 고정한다.
 */
import { indexMaster, type OverseasMasterFile } from '../kis-overseas-master';
import type { CandidateVerdict, FinalizeRow, RunPhase } from '../refresh-store';
import { runKeyOf, runUniverseRefresh, snapshotUsable, type FetchPriceOutcome, type RefreshDeps } from '../refresh-engine';

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

/**
 * listing 을 통과시킨 뒤 finalize 입력을 **곧장** 꽂는다(모듈 수준 — T-145 에서 `일시/영구` describe 도 쓴다).
 */
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
    // 🔴 T-145 ⑥-4 — 가져오기 실패는 **일시**다(HTTP·네트워크). 그 달을 닫지 않고 다음 틱이 다시 받는다.
    //   전에는 `final:true` 였다 — 503 한 번이 그 달 산출을 영구히 버렸다.
    expect([r.status, r.final]).toEqual(['failed', false]);
    expect(r.lastError).toContain('master_unavailable');
    expect(h.calls.price).toEqual([]);
    expect(fake.__run()!.phase).toBe('listing');        // 단계가 그대로다(닫지 않았다)
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

  it('알 수 없는 예외는 failed 로 보고하되 **그 달을 닫지 않는다**(T-145 ⑥-4 — 모르면 일시)', async () => {
    const h = harness();
    fake.__setRun({ runId: 1, runKey: KEY, phase: 'scan', topN: 2, cursorPos: 0, secSha256: null, lastError: null, notifiedAt: null });
    fake.__throwOnPending(new Error('boom'));
    const r = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    // 분류를 모르는 예외다 → 영구로 보면 버그 하나가 그 달을 삼킨다. 전에는 `final:true` 였다
    expect([r.status, r.final]).toEqual(['failed', false]);
    expect(r.lastError).toContain('boom');
    expect(r.failCode).toBe('fatal');                   // 그 회차는 실패로 기록된다(조용하지 않다)
    expect(fake.__run()!.phase).toBe('scan');           // 단계가 그대로다
  });
});

/**
 * 🔴 T-145 ⑥-4 — **일시 오류는 그 달을 닫지 않고, 영구 오류만 닫는다.**
 *
 * 고치는 결함: 전에는 모든 실패가 `closeRun('failed')` + `final:true` 였다. 네트워크 블립 한 번,
 * 후보 한 행의 값 하나로 그 달 산출이 영구히 닫히고 다음 창은 **한 달 뒤**였다(Reviewer 가 실 DB 로 재현).
 */
describe('🔴 일시/영구 — 그 달을 언제 닫나 (T-145 ⑥-4)', () => {
  const scanRun = () => fake.__setRun({
    runId: 1, runKey: KEY, phase: 'scan', topN: 2, cursorPos: 0, secSha256: null, lastError: null, notifiedAt: null,
  });

  it('저장소가 **일시**라고 하면 닫지 않는다 — `final:false` 이고 단계가 그대로다', async () => {
    const h = harness();
    scanRun();
    fake.__failPending({ error: 'Lock wait timeout exceeded', retryable: true });
    const r = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect([r.ok, r.status, r.final]).toEqual([false, 'failed', false]);
    expect(r.phase).toBe('scan');
    expect(fake.__run()!.phase).toBe('scan');
    expect(fake.__run()!.lastError).toBeNull();          // 닫지 않았으므로 last_error 를 덮지 않는다
  });

  it('저장소가 **영구**라고 하면 닫는다 — `final:true` 이고 phase=failed', async () => {
    const h = harness();
    scanRun();
    fake.__failPending({ error: "Unknown column 'x'", retryable: false });
    const r = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect([r.ok, r.status, r.final]).toEqual([false, 'failed', true]);
    expect(r.phase).toBe('failed');
    expect(fake.__run()!.phase).toBe('failed');
    expect(fake.__run()!.lastError).toContain('Unknown column');
  });

  it('🔴 일시 실패 뒤 다음 호출이 **이어서 진행한다** — 그 달이 살아 있다(이것이 ⑥-4 의 목적이다)', async () => {
    const h = harness();
    scanRun();
    fake.__seedPending(2);
    fake.__failPending({ error: 'ECONNRESET', retryable: true });
    const r1 = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect([r1.final, fake.__run()!.phase]).toEqual([false, 'scan']);
    expect(h.calls.price).toEqual([]);                  // 대상을 못 읽었으니 KIS 를 부르지 않았다
    // 다음 틱 — 저장소가 회복되면 그대로 스캔을 잇는다(전에는 run 이 이미 닫혀 여기서 final:true 였다)
    fake.__failPending(null);
    const r2 = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect([r2.ok, r2.status, r2.final]).toEqual([true, 'scan_partial', false]);
    expect(h.calls.price).toHaveLength(2);
  });

  it('형식·논리 오류는 영구다 — `sec_shape`·`no_scan_targets`·`insufficient_candidates`', async () => {
    // sec_shape
    fake.__reset();
    const h1 = harness();
    h1.deps.fetchSecListing = async () => ({ json: { fields: ['cik'], data: [] }, sha256: 'z'.repeat(64) });
    const r1 = await runUniverseRefresh(h1.deps, { topN: 2, excludeDr: true }, KEY);
    expect([r1.final, r1.failCode]).toEqual([true, 'sec_shape']);
    // no_scan_targets
    fake.__reset();
    const h2 = harness();
    h2.deps.fetchMaster = async () => indexMaster({ entries: [], dropped: 0 }, 'q'.repeat(64));
    const r2 = await runUniverseRefresh(h2.deps, { topN: 2, excludeDr: true }, KEY);
    expect([r2.final, r2.failCode]).toEqual([true, 'no_scan_targets']);
    // insufficient_candidates — 상위 N 을 못 채운다
    fake.__reset();
    const h3 = harness();
    await toFinalize(h3, [{ symbol: 'NYS:A', cik: 1, tomv: 3e11 }]);
    const r3 = await runUniverseRefresh(h3.deps, { topN: 5, excludeDr: true }, KEY);
    expect([r3.final, r3.failCode]).toEqual([true, 'insufficient_candidates']);
  });

  /**
   * 🔴 (Reviewer M-2) 일시/영구 배선은 **세 자리** 전부 고정한다. 전에는 `scan_read` 한 곳만 있어서
   * `listing_save`·`finalize_write` 가 저장소의 `retryable` 을 무시하고 항상 영구로 닫아도 이 파일이 전부 통과했다.
   * ⑥ 이 고친 결함은 **finalize 쪽**(`cap_ratio` 범위 초과가 트랜잭션을 깨 그 달을 영구 종결)이다.
   */
  it('🔴 `listing_save` 가 저장소 분류를 따른다 — 일시는 단계 유지·final:false', async () => {
    const h = harness();
    fake.__failListing({ error: 'Lock wait timeout exceeded', retryable: true });
    const r = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect([r.ok, r.status, r.final]).toEqual([false, 'failed', false]);
    expect(r.lastError).toContain('listing_save');
    expect([r.phase, fake.__run()!.phase]).toEqual(['listing', 'listing']);
    expect(fake.__run()!.lastError).toBeNull();          // 닫지 않았다
  });

  it('🔴 `listing_save` 영구는 그 달을 닫는다 — final:true·phase=failed', async () => {
    const h = harness();
    fake.__failListing({ error: "Out of range value for column 'cik'", retryable: false });
    const r = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect([r.ok, r.status, r.final, r.phase]).toEqual([false, 'failed', true, 'failed']);
    expect(fake.__run()!.phase).toBe('failed');
    expect(fake.__run()!.lastError).toContain('listing_save');
  });

  it('🔴 `finalize_write` 가 저장소 분류를 따른다 — 일시는 단계 유지·final:false(⑥ 이 고친 그 자리)', async () => {
    const h = harness();
    await toFinalize(h, [{ symbol: 'NYS:A', cik: 1, tomv: 3e11 }, { symbol: 'NYS:B', cik: 2, tomv: 2e11 }]);
    fake.__failFinalize({ error: 'ECONNRESET', retryable: true });
    const r = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect([r.ok, r.status, r.final]).toEqual([false, 'failed', false]);
    expect(r.lastError).toContain('finalize_write');
    expect([r.phase, fake.__run()!.phase]).toEqual(['finalize', 'finalize']);
    expect(fake.__run()!.lastError).toBeNull();
    expect(fake.__auto()).toEqual([]);                   // 자동 목록을 건드리지 않았다
  });

  it('🔴 `finalize_write` 영구는 그 달을 닫는다 — final:true·phase=failed', async () => {
    const h = harness();
    await toFinalize(h, [{ symbol: 'NYS:A', cik: 1, tomv: 3e11 }, { symbol: 'NYS:B', cik: 2, tomv: 2e11 }]);
    fake.__failFinalize({ error: "Data too long for column 'cap_source'", retryable: false });
    const r = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect([r.ok, r.status, r.final, r.phase]).toEqual([false, 'failed', true, 'failed']);
    expect(fake.__run()!.phase).toBe('failed');
    expect(fake.__run()!.lastError).toContain('finalize_write');
    expect(fake.__auto()).toEqual([]);
  });

  it('일시 `finalize_write` 뒤 다음 호출이 **그 자리에서 이어 확정한다**(그 달이 살아 있다)', async () => {
    const h = harness();
    await toFinalize(h, [{ symbol: 'NYS:A', cik: 1, tomv: 3e11 }, { symbol: 'NYS:B', cik: 2, tomv: 2e11 }]);
    fake.__failFinalize({ error: 'Deadlock found', retryable: true });
    expect((await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY)).final).toBe(false);
    fake.__failFinalize(null);                           // 저장소 회복
    const r2 = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect([r2.ok, r2.status, r2.final]).toEqual([true, 'complete', true]);
    expect(fake.__auto().map((a) => a.symbol)).toEqual(['NYS:A', 'NYS:B']);
  });

  /**
   * 🔴 (Codex C2 지적 2 — Reviewer 채택) **종결 기록이 실패하면 「종결됐다」고 말하지 않는다.**
   * 전에는 `closeRun(...).catch(() => undefined)` 로 삼키고 무조건 `final:true`·`phase:'failed'` 였다 →
   * DB 의 run 은 이전 단계에 남는데 응답은 영구 종결을 단정해 응답·`job_run_log` 와 DB 가 어긋났다.
   * 모형이 `closeRun` 에서 던질 수 없어 **어떤 시험도 이 경로를 보지 못했다**(M-1 과 같은 계열).
   */
  it('🔴 영구 실패 + 종결 기록 실패 → `final:false`·원래 단계. 던지지 않고 회차는 실패로 남는다', async () => {
    const h = harness();
    fake.__setRun({ runId: 1, runKey: KEY, phase: 'scan', topN: 2, cursorPos: 0, secSha256: null, lastError: null, notifiedAt: null });
    fake.__failPending({ error: "Unknown column 'x'", retryable: false });   // 영구 실패
    fake.__failClose({ code: 'ER_LOCK_WAIT_TIMEOUT' });                      // 그 종결 기록이 실패한다
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);   // 던지지 않는다
    expect([r.ok, r.status]).toEqual([false, 'failed']);
    expect(r.final).toBe(false);                      // 🔴 「닫혔다」고 말하지 않는다
    expect(r.phase).toBe('scan');                     // 응답이 DB 와 같다
    expect(fake.__run()!.phase).toBe('scan');         // DB 도 그대로다
    expect(r.failCode).toBe('scan_read');             // 회차는 실패로 기록된다(job_run_log 가 침묵하지 않는다)
    expect(r.lastError).toContain('Unknown column');
    // 로그 1줄 — runId 와 오류 code 만(값·본문 없음)
    expect(err).toHaveBeenCalledTimes(1);
    const msg = err.mock.calls.flat().join(' ');
    expect(msg).toContain('runId=1');
    expect(msg).toContain('ER_LOCK_WAIT_TIMEOUT');
    expect(msg).not.toContain('Unknown column');
    err.mockRestore();
  });

  it('🔴 종결 기록이 회복되면 다음 호출이 닫는다 — `final:true`·phase=failed(자가 치유)', async () => {
    const h = harness();
    fake.__setRun({ runId: 1, runKey: KEY, phase: 'scan', topN: 2, cursorPos: 0, secSha256: null, lastError: null, notifiedAt: null });
    fake.__failPending({ error: "Unknown column 'x'", retryable: false });
    fake.__failClose({ code: 'ER_LOCK_WAIT_TIMEOUT' });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY)).final).toBe(false);
    fake.__failClose(null);                           // DB 회복
    const r2 = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect([r2.final, r2.phase]).toEqual([true, 'failed']);
    expect(fake.__run()!.phase).toBe('failed');
    jest.restoreAllMocks();
  });

  it('영구 실패 + 종결 **성공**은 종전과 같다 — `final:true`·phase=failed·로그 없음', async () => {
    const h = harness();
    fake.__setRun({ runId: 1, runKey: KEY, phase: 'scan', topN: 2, cursorPos: 0, secSha256: null, lastError: null, notifiedAt: null });
    fake.__failPending({ error: "Unknown column 'x'", retryable: false });
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect([r.ok, r.final, r.phase]).toEqual([false, true, 'failed']);
    expect(fake.__run()!.phase).toBe('failed');
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it('🔴 일시 경로는 `closeRun` 을 **부르지도 않는다** — 종결 실패 주입이 있어도 종전과 같다', async () => {
    const h = harness();
    fake.__setRun({ runId: 1, runKey: KEY, phase: 'scan', topN: 2, cursorPos: 0, secSha256: null, lastError: null, notifiedAt: null });
    fake.__failPending({ error: 'Lock wait timeout exceeded', retryable: true });
    fake.__failClose({ code: 'ER_LOCK_WAIT_TIMEOUT' });   // 불리면 던지는데, 불리지 않아야 한다
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect([r.ok, r.status, r.final, r.phase]).toEqual([false, 'failed', false, 'scan']);
    expect(fake.__run()!.phase).toBe('scan');
    expect(err).not.toHaveBeenCalled();                   // 종결을 시도하지 않았다
    err.mockRestore();
  });

  it('🔴 선언 User-Agent 가 없는 것은 **일시**다 — 창 안에 고치면 그 달이 살아난다', async () => {
    const h = harness();
    h.deps.fetchSecListing = null;
    const r = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
    expect([r.status, r.lastError, r.final]).toEqual(['failed', 'sec_user_agent_missing', false]);
    expect([h.calls.master, h.calls.price.length]).toEqual([0, 0]);   // 외부 호출 0건은 그대로다
  });
});

describe('run_key', () => {
  it('KST 벽시계의 YYYY-MM 이다(UTC 가 아니다)', () => {
    expect(runKeyOf(Date.parse('2026-12-01T00:30:00+09:00'))).toBe('2026-12');
    // UTC 로는 11-30 이지만 KST 로는 12-01 이다
    expect(runKeyOf(Date.parse('2026-11-30T16:30:00Z'))).toBe('2026-12');
  });
});

/**
 * 🔴 T-145 ⑧ — **「KIS 조회 불가」 제안이 쏟아지지 않게** 한다.
 *
 * 고치는 결함: `kisOk` 가 「최근 3일 `us_fundamentals_snapshot` 행 존재」인데 **빈 집합을 「전부 실패」로** 읽었다.
 * 스냅샷 잡이 멈추면 수동 목록 **전체**에 「빼기」 제안이 생기고, 지문에 달이 없어 `INSERT IGNORE` 로
 * **영구 소비**된다 — 그 뒤 진짜 실패가 와도 다시 올라오지 않는다.
 */
describe('🔴 스냅샷 대리값 — 빈 집합·저커버리지는 「모름」이다 (T-145 ⑧)', () => {
  const MANUAL = ['NAS:AAAA', 'NAS:ABBB', 'NAS:ACCC', 'NAS:ADDD'];

  describe('snapshotUsable (순수 함수)', () => {
    it('조회 실패(null)·빈 집합은 쓸 수 없다 — 이것이 「전부 실패」로 읽혔던 자리다', () => {
      expect(snapshotUsable(null, MANUAL)).toBe(false);
      expect(snapshotUsable(new Set(), MANUAL)).toBe(false);
    });
    it('수동 목록의 **절반 미만**만 보이면 쓸 수 없다', () => {
      expect(snapshotUsable(new Set(['NAS:AAAA']), MANUAL)).toBe(false);          // 1/4
    });
    it('**절반 이상**이면 쓴다(경계 포함)', () => {
      expect(snapshotUsable(new Set(['NAS:AAAA', 'NAS:ABBB']), MANUAL)).toBe(true);        // 2/4
      expect(snapshotUsable(new Set(MANUAL), MANUAL)).toBe(true);                          // 4/4
      expect(snapshotUsable(new Set(['NAS:AAAA', 'NAS:ABBB']), MANUAL.slice(0, 3))).toBe(true);   // 2/3
    });
    it('집합에 수동 목록 밖 종목만 많아도 쓸 수 없다(수 가 아니라 **겹치는 수**를 본다)', () => {
      expect(snapshotUsable(new Set(['NYS:Z1', 'NYS:Z2', 'NYS:Z3', 'NYS:Z4', 'NYS:Z5']), MANUAL)).toBe(false);
    });
    it('수동 목록이 비면 판단할 것이 없다', () => {
      expect(snapshotUsable(new Set(['NAS:AAAA']), [])).toBe(false);
    });
  });

  describe('엔진 배선', () => {
    /** 수동 목록이 SEC 에 있고 거래소도 맞게 보이는 상태 — 그러면 제안은 `kisOk === false` 일 때만 생긴다(규칙 E). */
    const SEC = {
      fields: ['cik', 'name', 'ticker', 'exchange'],
      data: [
        [1, 'ALPHA', 'AAA', 'NYSE'], [2, 'BETA', 'BBB', 'NYSE'],
        [11, 'MA', 'AAAA', 'Nasdaq'], [12, 'MB', 'ABBB', 'Nasdaq'],
        [13, 'MC', 'ACCC', 'Nasdaq'], [14, 'MD', 'ADDD', 'Nasdaq'],
      ],
    };
    async function run(opts: { recent: Set<string> | null; scanned?: Map<string, boolean> }): Promise<number> {
      fake.__reset();
      const h = harness({ manual: MANUAL });
      h.deps.fetchSecListing = async () => ({ json: SEC, sha256: 's'.repeat(64) });
      fake.__setRecentSnapshot(opts.recent);
      if (opts.scanned) fake.__setRunKisStatus(opts.scanned);
      await toFinalize(h, [{ symbol: 'NYS:A', cik: 1, tomv: 3e11 }, { symbol: 'NYS:B', cik: 2, tomv: 2e11 }]);
      const r = await runUniverseRefresh(h.deps, { topN: 2, excludeDr: true }, KEY);
      expect(r.status).toBe('complete');
      return r.changes?.proposalsCreated ?? -1;
    }

    it('🔴 **빈 집합이면 제안 0건** — 전에는 수동 목록 전체에 「빼기」가 생겼다', async () => {
      expect(await run({ recent: new Set() })).toBe(0);
      expect(fake.__proposalsInserted()).toBe(0);
    });

    it('조회 실패(null)도 제안 0건(종전 동작 유지)', async () => {
      expect(await run({ recent: null })).toBe(0);
    });

    it('🔴 커버리지가 절반 미만이면 제안 0건 — 「몇 종목 빠짐」과 「원천 멈춤」을 가르는 선', async () => {
      expect(await run({ recent: new Set(['NAS:AAAA']) })).toBe(0);
    });

    it('커버리지가 충분하고 **정말 안 보이는 종목**이 있으면 그 종목만 제안한다', async () => {
      // 4종목 중 3종목이 보인다(3/4 ≥ 1/2) → 안 보이는 ADDD 하나만 「KIS 조회 불가」
      expect(await run({ recent: new Set(['NAS:AAAA', 'NAS:ABBB', 'NAS:ACCC']) })).toBe(1);
    });

    it('커버리지가 충분하고 전부 보이면 제안 0건(침묵이 맞다)', async () => {
      expect(await run({ recent: new Set(MANUAL) })).toBe(0);
    });

    it('🔴 이 run 의 **스캔 결과를 먼저 본다**(⑧-2) — 스냅샷에 없어도 KIS 가 답했으면 제안하지 않는다', async () => {
      const scanned = new Map<string, boolean>([['NAS:ADDD', true]]);
      expect(await run({ recent: new Set(['NAS:AAAA', 'NAS:ABBB', 'NAS:ACCC']), scanned })).toBe(0);
    });

    it('스캔 결과가 **실패**라고 하면 스냅샷이 못 쓸 상태여도 그 종목은 제안한다(직접 관측이 우선)', async () => {
      const scanned = new Map<string, boolean>([['NAS:ADDD', false]]);
      expect(await run({ recent: new Set(), scanned })).toBe(1);
    });
  });
});
