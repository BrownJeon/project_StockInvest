/**
 * T-108 A-6 — 「0」 vs 「모름」 vs 「조회 실패」 vs 「준비 중」 (가이드 §4.0 · §4.7 A1·A2 · §6 A-6).
 * 행 없음 unknown / 오류 error / 0 zero(실행 ok 일 때만) / 1146 prep:not_migrated / 스위치 꺼짐 prep:record_off /
 * 판단 기록은 baseline ∧ 운영 릴리스 행만 / 헤더 후보 수 불일치 partial.
 * (판단 기록 표 이름은 이 파일에 쓰지 않는다 — 기록 모듈 경계 시험이 src 전체 문자열을 본다. SQL 은 reader 상수로 고른다.)
 */
jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
const switchState = jest.fn();
jest.mock('@/lib/strategy/records/record-switch', () => ({ readRecordSwitchState: (k: string) => switchState(k) }));

import { buildRunRow, readAnalysisRuns, type JobRowView } from '../analysis-runs';
import { JUDGMENT_COUNTS_SQL, JUDGMENT_RUN_SQL, TOP_EXCLUSION_SQL } from '../judgment-read';
import type { ClosedDays } from '../sessions';
import { dbError, fakeReader, kst } from './fake-reader';

const NO_SIGNALS = { created: 0, blocked: 0, pending: 0 };
const NONE_J = { kind: 'none' as const, why: 'record_off' as const };

function job(over: Partial<JobRowView> = {}): JobRowView {
  return {
    status: 'ok', slotMs: kst('2026-11-02 16:00'), startedMs: kst('2026-11-02 16:00'),
    counts: { evaluated: 44, candidates: 5 }, degradedReason: null, sessionKst: '2026-11-02', sessionEt: null, ...over,
  };
}
const base = { market: 'domestic' as const, sessionDate: '2026-11-02', stale: false, nextRunAt: null };

describe('buildRunRow — 상태 규칙', () => {
  it('실행 기록 없음(켜짐) → unknown, 시그널 0 을 0 으로 쓰지 않는다', () => {
    const row = buildRunRow({ ...base, job: null, why: 'no_record', signals: NO_SIGNALS, judgment: NONE_J });
    expect(row.evaluated).toMatchObject({ state: 'unknown', value: null, reason: 'no_record' });
    expect(row.signalsCreated.state).toBe('unknown');
    expect(row.signalsCreated.value).toBeNull();
    expect(row.signalsBlocked.value).toBeNull();
  });
  it('표 없음 → prep:not_migrated, 기록 스위치 꺼짐 → prep:record_off', () => {
    expect(buildRunRow({ ...base, job: null, why: 'not_migrated', signals: NO_SIGNALS, judgment: NONE_J }).evaluated)
      .toMatchObject({ state: 'prep', reason: 'not_migrated' });
    expect(buildRunRow({ ...base, job: null, why: 'record_off', signals: NO_SIGNALS, judgment: NONE_J }).ruleCandidates)
      .toMatchObject({ state: 'prep', reason: 'record_off' });
  });
  it('실행 기록 없음 + 시그널 있음 → 시그널 partial(no_candidate_counts) — 「부분 — 시그널만」', () => {
    const row = buildRunRow({ ...base, job: null, why: 'no_record', signals: { created: 1, blocked: 1, pending: 0 }, judgment: NONE_J });
    expect(row.signalsCreated).toMatchObject({ state: 'partial', value: 1, reason: 'no_candidate_counts' });
    expect(row.signalsBlocked).toMatchObject({ state: 'available', value: 1 });
    expect(row.signalsPending).toMatchObject({ state: 'zero', value: 0 });
    expect(row.ruleCandidates.state).toBe('unknown');
  });
  it('실행 ok + 시그널 0 → 확인된 0', () => {
    const row = buildRunRow({ ...base, job: job(), why: null, signals: NO_SIGNALS, judgment: NONE_J });
    expect(row.evaluated).toMatchObject({ state: 'available', value: 44 });
    expect(row.signalsCreated).toMatchObject({ state: 'zero', value: 0 });
    expect(row.runStartedAt).toBe('2026-11-02T16:00:00+09:00');
  });
  it('후보 0 은 ok 일 때만 zero, partial 실행이면 partial', () => {
    expect(buildRunRow({ ...base, job: job({ counts: { evaluated: 44, candidates: 0 } }), why: null, signals: NO_SIGNALS, judgment: NONE_J }).ruleCandidates.state).toBe('zero');
    expect(buildRunRow({ ...base, job: job({ status: 'partial', counts: { evaluated: 44, candidates: 0 } }), why: null, signals: NO_SIGNALS, judgment: NONE_J }).ruleCandidates)
      .toMatchObject({ state: 'partial', value: 0 });
  });
  it('평가 0종목은 실패로 본다(evaluated_zero)', () => {
    expect(buildRunRow({ ...base, job: job({ counts: { evaluated: 0, candidates: 0 } }), why: null, signals: NO_SIGNALS, judgment: NONE_J }).evaluated)
      .toMatchObject({ state: 'error', reason: 'evaluated_zero' });
  });
  it('실패 → error, 건너뜀 → off_hours(사유), counts 없음 → unknown', () => {
    expect(buildRunRow({ ...base, job: job({ status: 'failed' }), why: null, signals: NO_SIGNALS, judgment: NONE_J }).evaluated.state).toBe('error');
    const sk = buildRunRow({ ...base, job: job({ status: 'skipped', degradedReason: 'holiday' }), why: null, signals: NO_SIGNALS, judgment: NONE_J });
    expect(sk.evaluated).toMatchObject({ state: 'off_hours', reason: 'holiday' });
    expect(sk.signalsCreated.state).toBe('off_hours');
    expect(sk.aiBuy.state).toBe('off_hours');
    expect(buildRunRow({ ...base, job: job({ counts: null }), why: null, signals: NO_SIGNALS, judgment: NONE_J }).evaluated)
      .toMatchObject({ state: 'unknown', reason: 'no_counts' });
  });
  it('건너뜀 사유 코드(skipReason)는 skip: 접두를 떼서 준다 · 실패 사유는 failReason', () => {
    const sk = buildRunRow({ ...base, job: job({ status: 'skipped', degradedReason: 'skip:weekend' }), why: null, signals: NO_SIGNALS, judgment: NONE_J });
    expect(sk.skipReason).toBe('weekend');
    expect(sk.failReason).toBeNull();
    expect(sk.evaluated).toMatchObject({ state: 'off_hours', reason: 'weekend' });
    expect(buildRunRow({ ...base, job: job({ status: 'skipped', degradedReason: 'skip' }), why: null, signals: NO_SIGNALS, judgment: NONE_J }).skipReason).toBeNull();
    const fl = buildRunRow({ ...base, job: job({ status: 'failed', degradedReason: 'fx_unknown' }), why: null, signals: NO_SIGNALS, judgment: NONE_J });
    expect(fl).toMatchObject({ skipReason: null, failReason: 'fx_unknown' });
    expect(buildRunRow({ ...base, job: job(), why: null, signals: NO_SIGNALS, judgment: NONE_J })).toMatchObject({ skipReason: null, failReason: null });
  });

  it('마지막 예정 슬롯보다 오래된 행 → available/zero 가 stale 로 낮아진다', () => {
    const row = buildRunRow({ ...base, job: job(), why: null, stale: true, signals: NO_SIGNALS, judgment: NONE_J });
    expect(row.evaluated).toMatchObject({ state: 'stale', value: 44, reason: 'older_than_last_slot' });
    expect(row.signalsCreated.state).toBe('stale');
  });
  it('판단 기록: 헤더 후보 수 = 패턴 행 수 → counted, 불일치 → partial', () => {
    const ok = buildRunRow({ ...base, job: job(), why: null, signals: NO_SIGNALS,
      judgment: { kind: 'found', id: 1, buy: 0, withPattern: 5, candidateCount: 5, top: { code: 'low_confidence', count: 3 }, startedMs: kst('2026-11-02 16:01') } });
    expect(ok.aiBuy).toMatchObject({ state: 'zero', value: 0 });
    expect(ok.topExclusion).toMatchObject({ state: 'available', value: { code: 'low_confidence', count: 3 } });
    const part = buildRunRow({ ...base, job: job(), why: null, signals: NO_SIGNALS,
      judgment: { kind: 'found', id: 1, buy: 2, withPattern: 4, candidateCount: 5, top: null, startedMs: null } });
    expect(part.aiBuy).toMatchObject({ state: 'partial', value: 2, reason: 'incomplete_candidates' });
    expect(part.topExclusion.state).toBe('partial');
  });
  it('판단 기록 없음 — 스위치 꺼짐 prep, 켜짐 unknown', () => {
    expect(buildRunRow({ ...base, job: job(), why: null, signals: NO_SIGNALS, judgment: { kind: 'none', why: 'record_off' } }).aiBuy)
      .toMatchObject({ state: 'prep', reason: 'record_off' });
    expect(buildRunRow({ ...base, job: job(), why: null, signals: NO_SIGNALS, judgment: { kind: 'none', why: 'no_record' } }).aiBuy)
      .toMatchObject({ state: 'unknown', reason: 'no_record' });
  });
});

describe('판단 기록 reader SQL — 집계 규칙', () => {
  it('baseline ∧ engine_release IS NOT NULL 만', () => {
    expect(JUDGMENT_RUN_SQL).toMatch(/judgment_role = 'baseline' AND engine_release IS NOT NULL/);
    expect(JUDGMENT_COUNTS_SQL).toMatch(/judgment_role = 'baseline'/);
    expect(TOP_EXCLUSION_SQL).toMatch(/judgment_role = 'baseline'/);
  });
});

describe('readAnalysisRuns — 첫 배포 상태(실데이터 모양)', () => {
  const closed: ClosedDays = { domestic: new Set(), overseas: new Set() };
  beforeEach(() => switchState.mockReset());

  it('실행 기록 표 없음(1146) → prep:not_migrated, 판단 기록 표 없음 → prep:not_migrated, 확인 필요 #9 슬롯 표시', async () => {
    switchState.mockResolvedValue({ enabled: false, source: 'missing' });
    const r = fakeReader(kst('2026-10-30 22:00'), [
      ['FROM job_run_log', dbError(1146)],
      [JUDGMENT_RUN_SQL.slice(0, 40), dbError(1146)],
      ["scenario_source = 'post-market'", []],
    ]);
    const res = await readAnalysisRuns(r, closed);
    expect(res.rows.domestic.evaluated).toMatchObject({ state: 'prep', reason: 'not_migrated' });
    expect(res.rows.domestic.aiBuy).toMatchObject({ state: 'prep', reason: 'not_migrated' });
    expect(res.slotUnrecorded.domestic).toBe('2026-10-30T16:00:00+09:00');
    expect(res.slotUnrecorded.overseas).toBe('2026-10-30T08:00:00+09:00');
    expect(res.bothRecorded).toBe(false);
  });

  it('실행 기록 켜짐·행 없음 + 판단 기록 스위치 꺼짐 → A1 unknown · AI 매수 판단 prep:record_off', async () => {
    switchState.mockImplementation(async (k: string) => (k === 'job_run_log_enabled' ? { enabled: true, source: 'value' } : { enabled: false, source: 'value' }));
    const r = fakeReader(kst('2026-10-30 22:00'), [
      ['FROM job_run_log', []],
      [JUDGMENT_RUN_SQL.slice(0, 40), []],
      ["scenario_source = 'post-market'", (p) => (p[1] === 'domestic' ? [{ status: 'skipped', n: 1, live_pending: 0 }] : [])],
    ]);
    const res = await readAnalysisRuns(r, closed);
    expect(res.rows.domestic.evaluated).toMatchObject({ state: 'unknown', reason: 'no_record' });
    expect(res.rows.domestic.aiBuy).toMatchObject({ state: 'prep', reason: 'record_off' });
    expect(res.rows.domestic.signalsCreated).toMatchObject({ state: 'partial', value: 1 });
    expect(res.rows.domestic.signalsBlocked).toMatchObject({ state: 'available', value: 1 });
    expect(res.rows.overseas.signalsCreated.state).toBe('unknown');
    // 국내 세션일 = KST 날짜, 해외 = 08:00 KST 슬롯의 ET 날짜(직전 날)
    expect(res.rows.domestic.session).toEqual({ market: 'domestic', sessionDate: '2026-10-30', tz: 'KST' });
    expect(res.rows.overseas.session).toEqual({ market: 'overseas', sessionDate: '2026-10-29', tz: 'ET' });
    // 시그널 창: 예정 슬롯 ~ +2시간, KST 벽시계 바인딩
    const sig = r.calls.find((c) => c.sql.includes("scenario_source = 'post-market'") && c.params[1] === 'domestic');
    expect(sig?.params.slice(2)).toEqual(['2026-10-30 16:00:00', '2026-10-30 18:00:00']);
  });

  it('실행 기록 행이 있으면 그 행의 세션일·시작 시각 창을 쓴다(해외 ET 세션일)', async () => {
    switchState.mockResolvedValue({ enabled: true, source: 'value' });
    const r = fakeReader(kst('2026-10-31 09:00'), [
      ['FROM job_run_log', (p) => (p[0] === 'post-market-overseas'
        ? [{ status: 'ok', scheduled_slot_at: new Date(kst('2026-10-31 08:00')), started_at: new Date(kst('2026-10-31 08:00:05')), counts_json: '{"evaluated":51,"candidates":3}', degraded_reason: null, sdk: '2026-10-31', sde: '2026-10-30' }]
        : [])],
      [JUDGMENT_RUN_SQL.slice(0, 40), []],
      ["scenario_source = 'post-market'", []],
    ]);
    const res = await readAnalysisRuns(r, closed);
    expect(res.rows.overseas.session.sessionDate).toBe('2026-10-30');
    expect(res.rows.overseas.evaluated).toMatchObject({ state: 'available', value: 51 });
    expect(res.rows.overseas.signalsCreated).toMatchObject({ state: 'zero', value: 0 });
    expect(res.slotUnrecorded.overseas).toBeNull();
  });
});
