/**
 * T-167 — 거시 레짐 라벨 장기 보관 기록기(`label-log.ts`) 단위 시험. DB 는 목 풀(공유 DB·`.env` 접근 0).
 *
 *  A. 열 목록 상수 = DDL 파일의 열(순서 포함, `id`·`inserted_at` 만 제외) · VARCHAR 길이 = 상수 · INSERT 문장 모양
 *  B. 행 만들기(순수) — 운영 형태 `ok` 기록(eval_funnel id 904956 의 기록 객체 그대로)·`unknown`(cpi_not_loaded 단독·null 다수)·
 *     internalErrorRecord·복수 사유 결합 순서·불리언 0/1·DECIMAL 반올림·범위 밖/NaN/Infinity → NULL·긴 문자열 절단·
 *     잘못된 날짜 → NULL·asOfUtc 폴백·record_json === JSON.stringify(record)·행을 만들 수 없는 입력 → null(던지지 않음)
 *  C. 기록 1회 — written · duplicate(1062, 경고 0) · no_table(1146, 첫 1회 → 24시간 안 무음 → 24시간 뒤 1회) · error(1시간 스로틀, 원문 미포함) ·
 *     timeout(끝나지 않는 INSERT → 4초에 끝, 연결 destroy) · getConnection 매달림 · getPool 이 동기로 던짐 → 무예외 · invalid 스로틀
 *  D. 엔진 진입점 — 동기 반환 시점에 DB I/O 0(다음 마이크로태스크) · 절대 던지지 않음 · L1 스위치 · 시험 환경 기본 차단
 *  E. 소스 고정 — DELETE·UPDATE·DDL·INSERT IGNORE·ON DUPLICATE KEY 없음 · pool.query 직접 사용 없음
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const queryMock = jest.fn();
const releaseMock = jest.fn();
const destroyMock = jest.fn();
const poolQueryMock = jest.fn(() => { throw new Error('pool.query 직접 사용 금지'); });
const getConnectionMock = jest.fn(async () => ({ query: (...a: unknown[]) => queryMock(...a), release: releaseMock, destroy: destroyMock }));
const getPoolMock = jest.fn(() => ({ query: poolQueryMock, getConnection: getConnectionMock }));
jest.mock('@/lib/db', () => ({ getPool: () => getPoolMock() }));

import {
  MACRO_REGIME_LABEL_LOG_COLUMNS,
  MACRO_REGIME_LABEL_LOG_COLUMN_LIMITS,
  MACRO_REGIME_LABEL_LOG_ENV_KEY,
  MACRO_REGIME_LABEL_LOG_INSERT_SQL,
  MACRO_REGIME_LABEL_LOG_TIMEOUT_MS,
  __resetMacroRegimeLabelLogWarningsForTest,
  __setMacroRegimeLabelLogForTest,
  buildMacroRegimeLabelRow,
  classifyMacroRegimeLabelLogError,
  isMacroRegimeLabelLogEnabled,
  isMacroRegimeLabelLogTestEnv,
  macroRegimeLabelLogParams,
  recordMacroRegimeLabel,
  recordMacroRegimeLabelRow,
  waitForMacroRegimeLabelLogForTest,
  type MacroRegimeLabelLogRow,
} from '../label-log';
import { classifyMacroRegime, internalErrorRecord } from '../classify';
import type { MacroRegimeRecord } from '../types';

const REPO = join(__dirname, '..', '..', '..', '..', '..');
const DDL = readFileSync(join(REPO, 'scripts', 'migrations', 'T-167-macro-regime-label-log.sql'), 'utf8');
const SOURCE = readFileSync(join(__dirname, '..', 'label-log.ts'), 'utf8');

/** 운영 eval_funnel id 904956(2026-11-12 10:20:40 KST) 의 detail.macroRegime 그대로 */
const OK_RECORD: MacroRegimeRecord = {
  ruleVersion: 'macro-regime-c0@1', label: 'normal_tightening', isType5: false, reasonCodes: [],
  asOfUtc: '2026-11-12T01:20:40Z', asOfEtDate: '2026-11-11',
  cpi: {
    seriesId: 'CUUR0000SA0', referenceMonth: '2026-09', releaseAtUtc: '2026-10-14T12:30:00Z', index: 336.94, baseMonth: '2025-09', baseIndex: 324.8,
    yoyPctRaw: 3.7377, yoyPct: 3.7, hot: false, monthGap: 2, expectedReferenceMonth: '2026-10', lagsSchedule: true,
    fetchedAtUtc: '2026-11-12T01:18:14Z', cacheAgeSec: 145, fetchStatus: 'ok',
  },
  rate: {
    upperPct: 4, upperEffectiveFrom: '2026-09-17', compareDate: '2026-05-11', upper6mAgoPct: 3.75, deltaPct: 0.25, direction: 'tightening',
    tableVerifiedThrough: '2026-11-11', nextKnownDecisionDate: '2026-12-09',
  },
};
const RUN = 'domestic-202611121018';
const NOW = Date.parse('2026-11-12T01:20:41.789Z');
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const mustRow = (...a: Parameters<typeof buildMacroRegimeLabelRow>): MacroRegimeLabelLogRow => {
  const r = buildMacroRegimeLabelRow(...a);
  if (!r) throw new Error('row');
  return r;
};

const warns = () => (console.warn as jest.Mock).mock.calls.map((c) => c.map(String).join(' '));
const ownWarns = () => warns().filter((w) => w.startsWith('[strategy/macro-regime/label-log]'));
const inserts = () => queryMock.mock.calls.filter((c) => String(c[0]).startsWith('INSERT INTO macro_regime_label_log'));
const flush = () => new Promise((r) => setImmediate(r));
const ENV_KEYS = [MACRO_REGIME_LABEL_LOG_ENV_KEY] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue([{ affectedRows: 1 }, []]);
  releaseMock.mockReset();
  destroyMock.mockReset();
  poolQueryMock.mockClear();
  getConnectionMock.mockReset();
  getConnectionMock.mockImplementation(async () => ({ query: (...a: unknown[]) => queryMock(...a), release: releaseMock, destroy: destroyMock }));
  getPoolMock.mockReset();
  getPoolMock.mockImplementation(() => ({ query: poolQueryMock, getConnection: getConnectionMock }));
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  __setMacroRegimeLabelLogForTest({ enabled: true });
  __resetMacroRegimeLabelLogWarningsForTest();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  __setMacroRegimeLabelLogForTest(null);
  __resetMacroRegimeLabelLogWarningsForTest();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('A. 열·DDL 대조', () => {
  /** DDL 의 CREATE TABLE 본문에서 열 정의 줄만(이름·정의) */
  const ddlColumns = (): Array<{ name: string; def: string }> => {
    const body = DDL.slice(DDL.indexOf('CREATE TABLE IF NOT EXISTS macro_regime_label_log ('));
    const out: Array<{ name: string; def: string }> = [];
    for (const line of body.split('\n').slice(1)) {
      if (/^\)/.test(line)) break;
      const m = /^ {2}([a-z0-9_]+)\s+(.+)$/.exec(line);
      if (!m || ['UNIQUE', 'KEY', 'CONSTRAINT', 'PRIMARY'].includes(m[1].toUpperCase())) continue;
      out.push({ name: m[1], def: m[2].replace(/--.*$/, '').trim() });
    }
    return out;
  };

  test('INSERT 열 상수 = DDL 열 순서 그대로(id·inserted_at 만 제외)', () => {
    const cols = ddlColumns().map((c) => c.name);
    expect(cols[0]).toBe('id');
    expect(cols).toContain('inserted_at');
    expect(cols.filter((c) => c !== 'id' && c !== 'inserted_at')).toEqual([...MACRO_REGIME_LABEL_LOG_COLUMNS]);
    expect(cols).toHaveLength(MACRO_REGIME_LABEL_LOG_COLUMNS.length + 2);
  });

  test('VARCHAR 길이 = 상수 · ENUM 은 source·market 둘뿐 · 유일 키 2개 · CHECK 3개', () => {
    const defs = new Map(ddlColumns().map((c) => [c.name, c.def]));
    for (const [col, n] of Object.entries(MACRO_REGIME_LABEL_LOG_COLUMN_LIMITS)) {
      expect(defs.get(col)).toMatch(new RegExp(`^VARCHAR\\(${n}\\)`));
    }
    const varchars = [...defs].filter(([, d]) => /^VARCHAR\(/.test(d)).map(([c]) => c).sort();
    expect(varchars).toEqual(Object.keys(MACRO_REGIME_LABEL_LOG_COLUMN_LIMITS).sort());
    const enums = [...defs].filter(([, d]) => /^ENUM\(/.test(d)).map(([c]) => c);
    expect(enums).toEqual(['source', 'market']);
    expect(DDL).toMatch(/UNIQUE KEY uq_mrl_run_asof \(run_id, as_of_utc\)/);
    expect(DDL).toMatch(/UNIQUE KEY uq_mrl_source_ef \(source_eval_funnel_id\)/);
    expect((DDL.match(/\bCHECK \(/g) ?? [])).toHaveLength(3);
  });

  test('INSERT 문장 — 열 목록·자리표시 수, IGNORE·ON DUPLICATE KEY 없음', () => {
    expect(MACRO_REGIME_LABEL_LOG_INSERT_SQL).toBe(
      `INSERT INTO macro_regime_label_log (${MACRO_REGIME_LABEL_LOG_COLUMNS.join(', ')}) VALUES (${MACRO_REGIME_LABEL_LOG_COLUMNS.map(() => '?').join(', ')})`,
    );
    expect(MACRO_REGIME_LABEL_LOG_INSERT_SQL).not.toMatch(/IGNORE|DUPLICATE/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('B. 행 만들기', () => {
  test('운영 형태 ok 기록 — 열 값 전부', () => {
    const row = mustRow(RUN, 'domestic', OK_RECORD, NOW, '20261112-102751-d1fb57b5');
    expect(row).toEqual({
      source: 'live', source_eval_funnel_id: null, source_ts_kst: null,
      run_id: RUN, market: 'domestic',
      as_of_utc: '2026-11-12 01:20:40', as_of_kst: '2026-11-12 10:20:40', as_of_et_date: '2026-11-11',
      rule_version: 'macro-regime-c0@1', label: 'normal_tightening', is_type5: 0,
      reason_codes: '', reason_first: null, reason_count: 0,
      cpi_fetch_status: 'ok', cpi_reference_month: '2026-09', cpi_expected_reference_month: '2026-10', cpi_lags_schedule: 1,
      cpi_release_at_utc: '2026-10-14 12:30:00', cpi_index: 336.94, cpi_base_month: '2025-09', cpi_base_index: 324.8,
      cpi_yoy_pct_raw: 3.7377, cpi_yoy_pct: 3.7, cpi_hot: 0, cpi_month_gap: 2,
      cpi_fetched_at_utc: '2026-11-12 01:18:14', cpi_cache_age_sec: 145,
      rate_upper_pct: 4, rate_upper_effective_from: '2026-09-17', rate_compare_date: '2026-05-11', rate_upper_6m_ago_pct: 3.75,
      rate_delta_pct: 0.25, rate_direction: 'tightening', rate_table_verified_through: '2026-11-11', rate_next_known_decision_date: '2026-12-09',
      engine_release: '20261112-102751-d1fb57b5',
      record_json: JSON.stringify(OK_RECORD),
    });
    expect(Object.keys(row)).toEqual([...MACRO_REGIME_LABEL_LOG_COLUMNS]);
    expect(macroRegimeLabelLogParams(row)).toEqual(MACRO_REGIME_LABEL_LOG_COLUMNS.map((c) => row[c]));
    // 운영 원문 바이트(eval_funnel 의 JSON_COMPACT 결과와 같은 문자열)
    expect(row.record_json).toBe(
      '{"ruleVersion":"macro-regime-c0@1","label":"normal_tightening","isType5":false,"reasonCodes":[],"asOfUtc":"2026-11-12T01:20:40Z","asOfEtDate":"2026-11-11",' +
      '"cpi":{"seriesId":"CUUR0000SA0","referenceMonth":"2026-09","releaseAtUtc":"2026-10-14T12:30:00Z","index":336.94,"baseMonth":"2025-09","baseIndex":324.8,' +
      '"yoyPctRaw":3.7377,"yoyPct":3.7,"hot":false,"monthGap":2,"expectedReferenceMonth":"2026-10","lagsSchedule":true,"fetchedAtUtc":"2026-11-12T01:18:14Z",' +
      '"cacheAgeSec":145,"fetchStatus":"ok"},"rate":{"upperPct":4,"upperEffectiveFrom":"2026-09-17","compareDate":"2026-05-11","upper6mAgoPct":3.75,' +
      '"deltaPct":0.25,"direction":"tightening","tableVerifiedThrough":"2026-11-11","nextKnownDecisionDate":"2026-12-09"}}',
    );
  });

  test('unknown — cpi_not_loaded 단독(실제 분류기), null 다수', () => {
    const rec = classifyMacroRegime({ asOf: new Date('2026-11-12T01:20:40Z'), cpiIndex: null, fetchedAt: null, fetchStatus: 'not_attempted' });
    expect(rec.label).toBe('unknown');
    expect(rec.reasonCodes).toEqual(['cpi_not_loaded']);
    const row = mustRow('overseas-202611122335', 'overseas', rec, NOW);
    expect(row).toMatchObject({
      market: 'overseas', label: 'unknown', is_type5: 0,
      reason_codes: 'cpi_not_loaded', reason_first: 'cpi_not_loaded', reason_count: 1,
      cpi_fetch_status: 'not_attempted', cpi_reference_month: null, cpi_release_at_utc: null, cpi_index: null, cpi_base_month: null,
      cpi_base_index: null, cpi_yoy_pct_raw: null, cpi_yoy_pct: null, cpi_hot: null, cpi_month_gap: null,
      cpi_fetched_at_utc: null, cpi_cache_age_sec: null, cpi_lags_schedule: 1, cpi_expected_reference_month: '2026-10',
      rate_direction: 'tightening', engine_release: null,
    });
    expect(row.record_json).toBe(JSON.stringify(rec));
  });

  test('internalErrorRecord — 사유 internal_error · 빈 asOfUtc 는 호출 시각(초 내림)으로 폴백, asOfEtDate 빈 값 = NULL', () => {
    const ok = mustRow(RUN, 'domestic', internalErrorRecord(new Date('2026-11-12T01:20:40Z'), 'http_error'), NOW);
    expect(ok).toMatchObject({ as_of_utc: '2026-11-12 01:20:40', reason_codes: 'internal_error', cpi_fetch_status: 'http_error', cpi_lags_schedule: 0 });
    const bad = internalErrorRecord(new Date(Number.NaN));
    expect([bad.asOfUtc, bad.asOfEtDate]).toEqual(['', '']);
    const row = mustRow(RUN, 'domestic', bad, NOW);
    expect(row).toMatchObject({
      as_of_utc: '2026-11-12 01:20:41', as_of_kst: '2026-11-12 10:20:41', as_of_et_date: null,
      rate_table_verified_through: bad.rate.tableVerifiedThrough, cpi_fetch_status: 'not_attempted',
    });
    expect(buildMacroRegimeLabelRow(RUN, 'domestic', bad, Number.NaN)).toBeNull();   // 폴백 시각도 없으면 행 없음
  });

  test('복수 사유 — 기록 순서 그대로 쉼표 결합, 첫 사유·개수', () => {
    const rec = { ...clone(OK_RECORD), label: 'unknown' as const, reasonCodes: ['cpi_cache_stale', 'rate_table_stale', 'rate_schedule_exhausted'] as MacroRegimeRecord['reasonCodes'] };
    expect(mustRow(RUN, 'domestic', rec, NOW)).toMatchObject({
      reason_codes: 'cpi_cache_stale,rate_table_stale,rate_schedule_exhausted', reason_first: 'cpi_cache_stale', reason_count: 3,
    });
  });

  test('불리언 — true/false → 1/0, NOT NULL 열은 true 만 1, NULL 허용 열(cpi_hot)은 불리언이 아니면 NULL', () => {
    const r = clone(OK_RECORD) as unknown as Record<string, Record<string, unknown> | unknown>;
    (r as { isType5: unknown }).isType5 = true;
    (r.cpi as Record<string, unknown>).hot = true;
    (r.cpi as Record<string, unknown>).lagsSchedule = false;
    expect(mustRow(RUN, 'domestic', r, NOW)).toMatchObject({ is_type5: 1, cpi_hot: 1, cpi_lags_schedule: 0 });
    (r as { isType5: unknown }).isType5 = 'true';
    (r.cpi as Record<string, unknown>).hot = 'yes';
    (r.cpi as Record<string, unknown>).lagsSchedule = 1;
    expect(mustRow(RUN, 'domestic', r, NOW)).toMatchObject({ is_type5: 0, cpi_hot: null, cpi_lags_schedule: 0 });
  });

  test('DECIMAL — 열 소수 자리로 반올림, 범위 밖·NaN·Infinity·문자열 → NULL, 정수 열은 안전한 정수·범위 안만', () => {
    const r = clone(OK_RECORD) as unknown as { cpi: Record<string, unknown>; rate: Record<string, unknown> };
    Object.assign(r.cpi, { index: 336.94449, baseIndex: 99_999_999.99994, yoyPctRaw: 3.73771, yoyPct: 3.66, monthGap: 2.5, cacheAgeSec: -12 });
    Object.assign(r.rate, { upperPct: 4.005, upper6mAgoPct: 9_999.999, deltaPct: -0.004 });
    expect(mustRow(RUN, 'domestic', r, NOW)).toMatchObject({
      cpi_index: 336.9445, cpi_base_index: 99_999_999.9999, cpi_yoy_pct_raw: 3.7377, cpi_yoy_pct: 3.7, cpi_month_gap: null, cpi_cache_age_sec: -12,
      rate_upper_pct: Number((4.005).toFixed(2)), rate_upper_6m_ago_pct: null, rate_delta_pct: 0,
    });
    Object.assign(r.cpi, { index: Number.NaN, baseIndex: 1e8, yoyPctRaw: Infinity, yoyPct: -Infinity, monthGap: 40_000, cacheAgeSec: 2 ** 31 });
    Object.assign(r.rate, { upperPct: '4', upper6mAgoPct: null, deltaPct: undefined });
    expect(mustRow(RUN, 'domestic', r, NOW)).toMatchObject({
      cpi_index: null, cpi_base_index: null, cpi_yoy_pct_raw: null, cpi_yoy_pct: null, cpi_month_gap: null, cpi_cache_age_sec: null,
      rate_upper_pct: null, rate_upper_6m_ago_pct: null, rate_delta_pct: null,
    });
  });

  test('긴 문자열 — 코드포인트 단위 절단(서로게이트 쌍을 쪼개지 않음), engine_release 48', () => {
    const r = clone(OK_RECORD) as unknown as Record<string, unknown> & { cpi: Record<string, unknown>; rate: Record<string, unknown> };
    r.label = '😀'.repeat(30);
    r.ruleVersion = 'v'.repeat(40);
    r.reasonCodes = Array.from({ length: 30 }, (_, i) => `code_${String(i).padStart(2, '0')}`);
    r.cpi.fetchStatus = 'x'.repeat(30);
    r.rate.direction = 'tightening_and_more';
    const row = mustRow(RUN, 'domestic', r, NOW, 'r'.repeat(60));
    expect(row.label).toBe('😀'.repeat(24));
    expect(row.rule_version).toBe('v'.repeat(32));
    expect(Array.from(row.reason_codes)).toHaveLength(200);
    expect(row.reason_codes.startsWith('code_00,code_01,')).toBe(true);
    expect(row.reason_count).toBe(30);
    expect(row.cpi_fetch_status).toBe('x'.repeat(24));
    expect(row.rate_direction).toBe('tightening_a');
    expect(row.engine_release).toBe('r'.repeat(48));
    expect(row.record_json).toBe(JSON.stringify(r));   // 원본 JSON 은 자르지 않는다
  });

  test('날짜·월·시각 — 형식·달력이 맞을 때만, 아니면 NULL(0000-00-00 을 만들지 않는다)', () => {
    const r = clone(OK_RECORD) as unknown as Record<string, unknown> & { cpi: Record<string, unknown>; rate: Record<string, unknown> };
    r.asOfEtDate = '2026-02-30';
    Object.assign(r.cpi, { referenceMonth: '2026-13', expectedReferenceMonth: '', baseMonth: '2025-9', releaseAtUtc: '2026-10-14T12:30:00.000Z', fetchedAtUtc: '2026-11-12T24:00:00Z' });
    Object.assign(r.rate, { upperEffectiveFrom: '', compareDate: '0000-00-00', tableVerifiedThrough: '2026-11-11 ', nextKnownDecisionDate: null });
    expect(mustRow(RUN, 'domestic', r, NOW)).toMatchObject({
      as_of_et_date: null, cpi_reference_month: null, cpi_expected_reference_month: null, cpi_base_month: null,
      cpi_release_at_utc: null, cpi_fetched_at_utc: null,
      rate_upper_effective_from: null, rate_compare_date: null, rate_table_verified_through: null, rate_next_known_decision_date: null,
    });
  });

  test('asOfUtc 형식 밖(소수 초·오프셋·빈 값) → 호출 시각 초 내림 폴백', () => {
    for (const bad of ['2026-11-12T01:20:40.000Z', '2026-11-12T10:20:40+09:00', '', 'not-a-date', 20261112]) {
      const r = { ...clone(OK_RECORD), asOfUtc: bad } as unknown;
      expect(mustRow(RUN, 'domestic', r, NOW)).toMatchObject({ as_of_utc: '2026-11-12 01:20:41', as_of_kst: '2026-11-12 10:20:41' });
    }
  });

  test('행을 만들 수 없는 입력 → null, 던지지 않는다', () => {
    const cases: Array<[unknown, unknown, unknown]> = [
      [RUN, 'domestic', null], [RUN, 'domestic', undefined], [RUN, 'domestic', 'x'], [RUN, 'domestic', [OK_RECORD]],
      ['', 'domestic', OK_RECORD], ['x'.repeat(41), 'domestic', OK_RECORD], [42, 'domestic', OK_RECORD],
      [RUN, 'common', OK_RECORD], [RUN, undefined, OK_RECORD],
      [RUN, 'domestic', { ...OK_RECORD, label: '' }], [RUN, 'domestic', { ...OK_RECORD, label: 7 }],
      [RUN, 'domestic', { ...OK_RECORD, ruleVersion: '' }], [RUN, 'domestic', { ...OK_RECORD, ruleVersion: undefined }],
      [RUN, 'domestic', { ...OK_RECORD, pad: 'p'.repeat(60_001) }],
    ];
    for (const [runId, market, rec] of cases) expect(buildMacroRegimeLabelRow(runId, market, rec, NOW)).toBeNull();
    expect(buildMacroRegimeLabelRow('x'.repeat(40), 'domestic', OK_RECORD, NOW)).not.toBeNull();   // 40자 경계는 들어간다(자르지 않는다)
    const circular: Record<string, unknown> = { ...clone(OK_RECORD) };
    circular.self = circular;
    expect(buildMacroRegimeLabelRow(RUN, 'domestic', circular, NOW)).toBeNull();
    const hostile = Object.defineProperty({ ...clone(OK_RECORD) }, 'label', { enumerable: true, get() { throw new Error('getter'); } });
    expect(() => buildMacroRegimeLabelRow(RUN, 'domestic', hostile, NOW)).not.toThrow();
    expect(buildMacroRegimeLabelRow(RUN, 'domestic', hostile, NOW)).toBeNull();
  });

  test('cpi·rate 가 없거나 객체가 아니어도 행은 남는다(값은 NULL·기본값, 원본 JSON 은 그대로)', () => {
    const r = { ...clone(OK_RECORD), cpi: null, rate: 'x' } as unknown;
    expect(mustRow(RUN, 'domestic', r, NOW)).toMatchObject({ cpi_fetch_status: '', cpi_index: null, cpi_lags_schedule: 0, rate_upper_pct: null, record_json: JSON.stringify(r) });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C. 기록 1회', () => {
  const row = () => mustRow(RUN, 'domestic', OK_RECORD, NOW, 'rel-1');
  const err = (errno: number, msg = 'secret SECRET_DB_TEXT 005930') => Object.assign(new Error(msg), { errno });
  const leaks = (w: string) => /SECRET_DB_TEXT|005930|secret/.test(w);

  test('written — 받은 연결 1개로 INSERT 1문장, release 1·destroy 0, pool.query 직접 사용 0, 경고 0', async () => {
    const r = row();
    await expect(recordMacroRegimeLabelRow(r, 'domestic')).resolves.toEqual({ status: 'written' });
    expect(inserts()).toEqual([[MACRO_REGIME_LABEL_LOG_INSERT_SQL, macroRegimeLabelLogParams(r)]]);
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect([getConnectionMock.mock.calls.length, releaseMock.mock.calls.length, destroyMock.mock.calls.length]).toEqual([1, 1, 0]);
    expect(poolQueryMock).not.toHaveBeenCalled();
    expect(ownWarns()).toEqual([]);
  });

  test('duplicate(1062 — 이미 이관된 런) → 경고 0, 몇 번이라도', async () => {
    queryMock.mockRejectedValue(err(1062));
    for (let i = 0; i < 3; i++) await expect(recordMacroRegimeLabelRow(row(), 'domestic')).resolves.toEqual({ status: 'duplicate', reason: 'duplicate errno=1062' });
    expect(ownWarns()).toEqual([]);
    expect(destroyMock).toHaveBeenCalledTimes(3);   // 문장 오류가 난 연결은 상태를 믿지 않고 뺀다(bounded-conn 규칙)
  });

  test('no_table(1146) — 프로세스 첫 1회 경고 → 24시간 안 무음 → 24시간 뒤 1회(막힌 횟수·마감 문구 포함)', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(Date.parse('2026-11-12T01:00:00Z'));
    queryMock.mockRejectedValue(err(1146));
    await expect(recordMacroRegimeLabelRow(row(), 'domestic')).resolves.toEqual({ status: 'no_table', reason: 'no_table errno=1146' });
    expect(ownWarns()).toHaveLength(1);
    expect(ownWarns()[0]).toMatch(/macro_regime_label_log 테이블이 없어 .*DDL 적용 전.*라벨 장기 보관 표 없음.*이관 마감 2026-12-12 10:20 KST.* market=domestic/);
    for (const h of [1, 12, 23.9]) {
      jest.setSystemTime(Date.parse('2026-11-12T01:00:00Z') + h * 3600_000);
      await recordMacroRegimeLabelRow(row(), 'overseas');
    }
    expect(ownWarns()).toHaveLength(1);
    jest.setSystemTime(Date.parse('2026-11-13T01:00:00Z'));
    await recordMacroRegimeLabelRow(row(), 'overseas');
    expect(ownWarns()).toHaveLength(2);
    expect(ownWarns()[1]).toMatch(/market=overseas \(직전 경고 뒤 3회 더\)/);
    expect(ownWarns().some(leaks)).toBe(false);
  });

  test('error(다른 DB 오류) — 분류어·errno 만, 1시간에 1회(분류어별), 원문 미포함', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const t0 = Date.parse('2026-11-12T01:00:00Z');
    jest.setSystemTime(t0);
    queryMock.mockRejectedValue(err(1205));
    await expect(recordMacroRegimeLabelRow(row(), 'domestic')).resolves.toEqual({ status: 'error', reason: 'db_error errno=1205' });
    queryMock.mockRejectedValue(err(4025));
    jest.setSystemTime(t0 + 30 * 60_000);
    await expect(recordMacroRegimeLabelRow(row(), 'domestic')).resolves.toEqual({ status: 'error', reason: 'check_violation errno=4025' });
    expect(ownWarns()).toEqual([expect.stringContaining('라벨 장기 보관 기록 실패(error: db_error errno=1205) market=domestic')]);
    jest.setSystemTime(t0 + 60 * 60_000);
    queryMock.mockRejectedValue(new Error('no errno SECRET_DB_TEXT'));
    await expect(recordMacroRegimeLabelRow(row(), 'domestic')).resolves.toEqual({ status: 'error', reason: 'exception' });
    expect(ownWarns()).toHaveLength(2);
    expect(ownWarns()[1]).toMatch(/실패\(error: exception\) market=domestic \(직전 경고 뒤 1회 더\)/);
    expect(ownWarns().some(leaks)).toBe(false);
  });

  test(`timeout — 끝나지 않는 INSERT → ${MACRO_REGIME_LABEL_LOG_TIMEOUT_MS}ms 에 끝, 그 자리에서 연결 destroy, 늦은 실패는 흡수`, async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    let rejectLate!: (e: unknown) => void;
    queryMock.mockImplementation(() => new Promise((_, rej) => { rejectLate = rej; }));
    let done = false;
    const p = recordMacroRegimeLabelRow(row(), 'overseas').then((v) => { done = true; return v; });
    await flush();
    expect(inserts()).toHaveLength(1);
    jest.advanceTimersByTime(MACRO_REGIME_LABEL_LOG_TIMEOUT_MS - 1);
    await flush();
    expect(done).toBe(false);
    expect(destroyMock).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await expect(p).resolves.toEqual({ status: 'timeout', reason: 'timeout' });
    expect([releaseMock.mock.calls.length, destroyMock.mock.calls.length]).toEqual([0, 1]);
    rejectLate(err(2013));
    await flush();
    expect(ownWarns()).toEqual([expect.stringContaining('라벨 장기 보관 기록 실패(timeout: timeout) market=overseas')]);
    expect([releaseMock.mock.calls.length, destroyMock.mock.calls.length]).toEqual([0, 1]);
  });

  test('getConnection 이 매달림 → 상한에 timeout, 늦게 받은 연결은 쓰지 않고 release(INSERT 0)', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    let give!: (c: unknown) => void;
    getConnectionMock.mockImplementation(() => new Promise((r) => { give = r; }) as never);
    const p = recordMacroRegimeLabelRow(row(), 'domestic');
    await flush();
    jest.advanceTimersByTime(MACRO_REGIME_LABEL_LOG_TIMEOUT_MS);
    await expect(p).resolves.toEqual({ status: 'timeout', reason: 'timeout' });
    give({ query: (...a: unknown[]) => queryMock(...a), release: releaseMock, destroy: destroyMock });
    await flush();
    expect(inserts()).toHaveLength(0);
    expect([releaseMock.mock.calls.length, destroyMock.mock.calls.length]).toEqual([1, 0]);
  });

  test('getConnection 실패 → error(분류어), INSERT 0', async () => {
    getConnectionMock.mockImplementation(async () => { throw err(2013); });
    await expect(recordMacroRegimeLabelRow(row(), 'domestic')).resolves.toEqual({ status: 'error', reason: 'db_error errno=2013' });
    expect(inserts()).toHaveLength(0);
  });

  test('getPool() 이 동기로 던져도 무예외 — error(exception)', async () => {
    getPoolMock.mockImplementation(() => { throw new Error('getPool boom SECRET_DB_TEXT'); });
    await expect(recordMacroRegimeLabelRow(row(), 'domestic')).resolves.toEqual({ status: 'error', reason: 'exception' });
    expect(ownWarns().some(leaks)).toBe(false);
  });

  test('invalid(행 없음) — DB 접근 0, 1시간에 1회 경고', async () => {
    await expect(recordMacroRegimeLabelRow(null, 'domestic')).resolves.toEqual({ status: 'invalid', reason: 'invalid_row' });
    await expect(recordMacroRegimeLabelRow(null, 'domestic')).resolves.toEqual({ status: 'invalid', reason: 'invalid_row' });
    expect(getPoolMock).not.toHaveBeenCalled();
    expect(ownWarns()).toEqual([expect.stringContaining('라벨 장기 보관 기록 실패(invalid: invalid_row) market=domestic')]);
  });

  test('시장 문자열은 domestic·overseas 외에는 unknown 으로만 적는다', async () => {
    queryMock.mockRejectedValue(err(1205));
    await recordMacroRegimeLabelRow(row(), 'NAS:SECRET');
    expect(ownWarns()).toEqual([expect.stringContaining('market=unknown')]);
  });

  test('오류 분류어', () => {
    expect([1146, 1062, 4025, 1406, 1205].map((n) => classifyMacroRegimeLabelLogError(err(n)))).toEqual([
      'no_table errno=1146', 'duplicate errno=1062', 'check_violation errno=4025', 'row_data errno=1406', 'db_error errno=1205',
    ]);
    expect(classifyMacroRegimeLabelLogError(null)).toBe('exception');
    expect(classifyMacroRegimeLabelLogError('x')).toBe('exception');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('D. 엔진 진입점 recordMacroRegimeLabel', () => {
  test('동기 반환 시점에 DB I/O 0 — 다음 마이크로태스크에서 시작, 엔진에 아무것도 돌려주지 않는다', async () => {
    jest.spyOn(process, 'cwd').mockReturnValue('/home/brownjeon/apps/stockinvest/releases/20261112-102751-d1fb57b5');
    const ret = recordMacroRegimeLabel(RUN, 'domestic', OK_RECORD);
    expect(ret).toBeUndefined();
    expect(getPoolMock).not.toHaveBeenCalled();
    expect(getConnectionMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
    expect(await waitForMacroRegimeLabelLogForTest()).toEqual([{ status: 'written' }]);
    const [, params] = inserts()[0] as [string, unknown[]];
    const byCol = Object.fromEntries(MACRO_REGIME_LABEL_LOG_COLUMNS.map((c, i) => [c, params[i]]));
    expect(byCol).toMatchObject({ run_id: RUN, market: 'domestic', engine_release: '20261112-102751-d1fb57b5', record_json: JSON.stringify(OK_RECORD) });
  });

  test('기록 객체는 호출 시점에 굳힌다 — 호출 뒤 바뀌어도 record_json 은 호출 때 값', async () => {
    const rec = clone(OK_RECORD);
    const before = JSON.stringify(rec);
    recordMacroRegimeLabel(RUN, 'domestic', rec);
    (rec as { label: string }).label = 'hot_hold';
    await waitForMacroRegimeLabelLogForTest();
    const [, params] = inserts()[0] as [string, unknown[]];
    expect(params[MACRO_REGIME_LABEL_LOG_COLUMNS.indexOf('record_json')]).toBe(before);
    expect(params[MACRO_REGIME_LABEL_LOG_COLUMNS.indexOf('label')]).toBe('normal_tightening');
  });

  test('절대 던지지 않는다 — 적대적 입력·Date.now 예외·process.cwd 예외', async () => {
    const hostile = Object.defineProperty({}, 'label', { enumerable: true, get() { throw new Error('getter'); } });
    expect(() => recordMacroRegimeLabel(RUN, 'domestic', hostile as never)).not.toThrow();
    expect(() => recordMacroRegimeLabel(undefined as never, 'x' as never, null as never)).not.toThrow();
    const cwdSpy = jest.spyOn(process, 'cwd').mockImplementation(() => { throw new Error('cwd'); });
    expect(() => recordMacroRegimeLabel(RUN, 'domestic', OK_RECORD)).not.toThrow();
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => { throw new Error('now'); });
    expect(() => recordMacroRegimeLabel(RUN, 'domestic', OK_RECORD)).not.toThrow();
    nowSpy.mockRestore();
    cwdSpy.mockRestore();
    const res = await waitForMacroRegimeLabelLogForTest();
    expect(res.map((r) => r.status)).toEqual(['invalid', 'invalid', 'written']);   // Date.now 예외 호출은 시작 전에 흡수(기록 없음)
  });

  test('L1 스위치 — 미설정·빈 값 = 켜짐, false(공백·대소문자 무시)만 끔', async () => {
    const cases: Array<[string | undefined, string]> = [
      [undefined, 'written'], ['', 'written'], ['   ', 'written'], ['true', 'written'], ['0', 'written'], ['no', 'written'],
      ['false', 'disabled'], ['FALSE ', 'disabled'], ['  False', 'disabled'],
    ];
    for (const [v, want] of cases) {
      if (v === undefined) delete process.env[MACRO_REGIME_LABEL_LOG_ENV_KEY]; else process.env[MACRO_REGIME_LABEL_LOG_ENV_KEY] = v;
      expect(isMacroRegimeLabelLogEnabled()).toBe(want === 'written');
      queryMock.mockClear();
      recordMacroRegimeLabel(RUN, 'domestic', OK_RECORD);
      expect(await waitForMacroRegimeLabelLogForTest()).toEqual([{ status: want }]);
      expect(inserts()).toHaveLength(want === 'written' ? 1 : 0);
    }
    expect(ownWarns()).toEqual([]);   // disabled 는 무음
  });

  test('L1 스위치는 EVAL_FUNNEL_ENABLED 와 독립', async () => {
    const saved = process.env.EVAL_FUNNEL_ENABLED;
    process.env.EVAL_FUNNEL_ENABLED = 'false';
    try {
      recordMacroRegimeLabel(RUN, 'domestic', OK_RECORD);
      expect(await waitForMacroRegimeLabelLogForTest()).toEqual([{ status: 'written' }]);
    } finally {
      if (saved === undefined) delete process.env.EVAL_FUNNEL_ENABLED; else process.env.EVAL_FUNNEL_ENABLED = saved;
    }
  });

  test('🔴 시험 환경 기본 차단 — 훅 없이(또는 enabled:false) getPool 호출 0, disabled_in_test', async () => {
    expect(isMacroRegimeLabelLogTestEnv()).toBe(true);   // 지금 jest 안이다
    __setMacroRegimeLabelLogForTest(null);
    recordMacroRegimeLabel(RUN, 'domestic', OK_RECORD);
    __setMacroRegimeLabelLogForTest({ enabled: false });
    recordMacroRegimeLabel(RUN, 'domestic', OK_RECORD);
    __setMacroRegimeLabelLogForTest({});
    recordMacroRegimeLabel(RUN, 'domestic', OK_RECORD);
    expect(await waitForMacroRegimeLabelLogForTest()).toEqual([{ status: 'disabled_in_test' }, { status: 'disabled_in_test' }, { status: 'disabled_in_test' }]);
    expect(getPoolMock).not.toHaveBeenCalled();
    expect(ownWarns()).toEqual([]);
  });

  test('시험 환경 판정 — NODE_ENV=test 또는 JEST_WORKER_ID, 둘 다 없으면 운영', () => {
    expect(isMacroRegimeLabelLogTestEnv({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isMacroRegimeLabelLogTestEnv({ NODE_ENV: 'production', JEST_WORKER_ID: '3' } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(isMacroRegimeLabelLogTestEnv({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isMacroRegimeLabelLogTestEnv({} as NodeJS.ProcessEnv)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('E. 소스 고정', () => {
  /** 주석을 뗀 코드 */
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  test('🔴 자동 삭제·변경·DDL 없음(A5) — DELETE·UPDATE·DROP·ALTER·TRUNCATE·CREATE·REPLACE INTO·INSERT IGNORE·ON DUPLICATE KEY', () => {
    expect(code).toMatch(/INSERT INTO \$\{MACRO_REGIME_LABEL_LOG_TABLE\}/);   // 빈 스캔 방지 — 쓰기 문장은 이 INSERT 하나다
    // SQL 키워드는 대문자로만 찾는다(`pending.delete(p)` 같은 JS 메서드 이름은 SQL 이 아니다)
    expect(code).not.toMatch(/\b(DELETE|UPDATE|DROP|ALTER|TRUNCATE|CREATE|RENAME)\b/);
    expect(code).not.toMatch(/\b(delete\s+from|update\s+\w+\s+set|drop\s+table|alter\s+table|create\s+table)\b/i);
    expect(code).not.toMatch(/REPLACE\s+INTO|INSERT\s+IGNORE|ON\s+DUPLICATE\s+KEY/i);
  });

  test('pool.query 를 직접 부르지 않는다 — 쓰기는 withBoundedConn 안의 bc.use(getPool()) 하나', () => {
    expect(code).not.toMatch(/getPool\(\)\s*\.\s*query/);
    expect(code.match(/getPool\(\)/g)).toHaveLength(1);
    expect(code).toMatch(/bc\.use\(getPool\(\) as unknown as BoundedPool\)/);
    expect(code).toMatch(/withBoundedConn\(ms, \(bc\) => writeRow\(row, bc\)\)/);
  });
});
