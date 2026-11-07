import { ANALYSIS_REASON_KO, jobNameText } from '@/lib/ops/reason-dictionary';
import { anomalySources, DATA_SOURCE_LABEL, JOB_FAILURES_SCOPE_SQL } from './anomalies';
import type { OpsReader } from './read-only';
import { isoOrNull, kstDateOf, kstIso, toMs } from './sessions';
import type { AnalysisAnomalyRow, DataSourceRow } from './types';

const CUTOFF = 'COALESCE(f.ended_at, f.started_at, f.scheduled_slot_at)';
const VERIFIED_OK_START = "CAST(JSON_VALUE(n.counts_json, '$.lastOkStartMs') AS UNSIGNED)";

export const ANOMALY_DETAILS_SQL = `SELECT f.run_id, f.job_id, f.status, f.started_at,
    f.scheduled_slot_at, f.ended_at, f.http_code, f.error_code, f.degraded_reason,
    (SELECT MIN(${VERIFIED_OK_START}) FROM job_run_log n
      WHERE n.session_date_kst = f.session_date_kst AND n.job_id = f.job_id AND n.market = f.market
        AND (n.recorder = 'runner_rollup' OR (n.recorder IN ('runner_hook', 'route') AND n.status = 'ok'))
        AND ${VERIFIED_OK_START} >= TIMESTAMPDIFF(MICROSECOND, '1970-01-01 09:00:00', ${CUTOFF}) DIV 1000 + 1000) AS later_ok_ms
    FROM (SELECT run_id, job_id, market, status, session_date_kst, started_at, scheduled_slot_at,
      ended_at, http_code, error_code, degraded_reason ${JOB_FAILURES_SCOPE_SQL}) f
    ORDER BY f.started_at DESC, f.run_id DESC`;

const SOURCE_SUMMARY = {
  stale: ['최신 데이터 지연', '기준 시각까지 새 데이터가 확인되지 않았습니다.'],
  error: ['원천 조회 실패', '이 데이터 원천을 조회하지 못했습니다.'],
  unknown: ['최신 상태 미확인', '이 데이터 원천의 상태를 확인할 기록이 없습니다.'],
  partial: ['일부 데이터 부족', '수집 기록에서 일부 데이터가 확인되지 않았습니다.'],
} as const;

function sourceDetail(s: DataSourceRow): AnalysisAnomalyRow {
  const [summary, message] = SOURCE_SUMMARY[s.state as keyof typeof SOURCE_SUMMARY];
  const last = s.dateRef ?? s.lastOkAt;
  return {
    id: s.id, kind: 'source', label: DATA_SOURCE_LABEL[s.id], at: null, summary,
    reason: s.reason === 'zero_streak' && s.streak ? `뉴스 0건이 ${s.streak}일 연속 기록됐습니다.` : message,
    evidence: last ? `마지막 확인 기록 ${last}` : null,
    laterOkAt: null,
  };
}

const CURL_REASONS: Partial<Record<number, readonly [string, string]>> = {
  6: ['서버 주소 확인 실패', '작업 대상 서버의 주소를 확인하지 못했습니다.'],
  7: ['연결 실패', '작업 요청을 서버에 연결하지 못했습니다.'],
  28: ['제한 시간 초과', '제한 시간 안에 작업 응답을 받지 못했습니다.'],
  52: ['응답 없음', '서버 연결 뒤 빈 응답을 받았습니다.'],
  55: ['요청 전송 실패', '서버에 요청을 전송하는 도중 오류가 발생했습니다.'],
  56: ['응답 수신 실패', '서버 응답을 받는 도중 오류가 발생했습니다.'],
};

const JOB_REASONS: Readonly<Record<string, string>> = {
  ...ANALYSIS_REASON_KO,
  ai_fail: 'AI 응답을 받거나 해석하지 못했습니다.',
  insert_fail: '분석 결과를 저장하지 못했습니다.',
  'capture=partial': '뉴스는 저장됐으며 수집 상태 기록 단계가 제한 시간에 걸렸습니다.',
  'capture=fetch_failed': '뉴스 수집 요청에 실패했습니다.',
  'capture=no_items': '뉴스 응답에 수집 항목 목록이 없었습니다.',
  'capture=skipped_no_table': '뉴스 수집 기록을 저장할 테이블이 준비되지 않았습니다.',
  'capture=failed': '뉴스 캡처에 실패했습니다.',
  'news=0': '처리된 뉴스가 0건으로 기록됐습니다.',
};

function jobReason(r: Record<string, unknown>): Pick<AnalysisAnomalyRow, 'summary' | 'reason' | 'evidence'> {
  if (r.status === 'missing') return { summary: '실행 기록 없음', reason: '예정 시각의 실행 기록을 찾지 못했습니다.', evidence: null };

  const error = String(r.error_code ?? '');
  const transport = /^HTTP=000(?:\/curl=(\d{1,3}))?$/.exec(error);
  if (transport || r.http_code === 0) {
    const exit = Number(transport?.[1]);
    const detail = CURL_REASONS[exit];
    if (exit >= 1 && exit <= 255) {
      return { summary: detail?.[0] ?? '요청 실패', reason: detail?.[1] ?? '작업 요청 중 통신 오류가 발생했습니다.', evidence: `요청 도구 종료 코드 ${exit}` };
    }
    return { summary: '응답 없음', reason: '응답 없음 · 세부 원인 미기록', evidence: '기존 실행 기록에는 응답을 받지 못한 사실만 남아 있습니다.' };
  }

  const httpError = /^HTTP=([1-5]\d{2})(?::([a-z][a-z0-9_]{0,47}))?$/.exec(error);
  const candidates = [String(r.degraded_reason ?? ''), httpError?.[2] ?? error];
  const code = candidates.find((value) => Object.prototype.hasOwnProperty.call(JOB_REASONS, value));
  const summary = r.status === 'degraded' ? '일부 완료' : '실행 실패';
  return {
    summary,
    reason: code ? JOB_REASONS[code] : httpError ? '서버가 작업 실패 응답을 반환했습니다.' : `${summary} · 세부 원인 미기록`,
    evidence: [httpError ? `HTTP ${httpError[1]}` : null, code].filter(Boolean).join(' · ') || null,
  };
}

export async function readAnomalyDetails(r: OpsReader, sourcesPromise: Promise<readonly DataSourceRow[]>) {
  const date = kstDateOf(r.nowMs);
  const [sources, failed] = await Promise.all([sourcesPromise, r.rows(ANOMALY_DETAILS_SQL, [date])]);
  const rows = anomalySources(sources).map(sourceDetail);
  for (const f of failed) {
    const cutoff = toMs(f.ended_at ?? f.started_at ?? f.scheduled_slot_at);
    const later = Number(f.later_ok_ms);
    const confirmedLater = cutoff !== null && Number.isSafeInteger(later) && later >= cutoff + 1000 && later <= r.nowMs;
    rows.push({
      id: `run-${f.run_id}`, kind: 'job', label: jobNameText(String(f.job_id ?? '')),
      at: isoOrNull(f.started_at ?? f.scheduled_slot_at), ...jobReason(f),
      laterOkAt: confirmedLater ? kstIso(later) : null,
    });
  }
  return { date, rows };
}
