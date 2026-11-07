import { ANOMALY_DETAILS_SQL, readAnomalyDetails } from '../anomaly-details';
import type { OpsReader } from '../read-only';

const nowMs = Date.parse('2026-11-07T00:33:00+09:00');
const time = (value: string) => `2026-11-07 ${value}`;
const kstMs = (value: string) => Date.parse(`2026-11-07T${value}+09:00`);

it('홈 집계 날짜의 이상 원천과 기록만 읽고, 기록에서 입증된 이후 실행을 표시한다', async () => {
  const rows = jest.fn().mockResolvedValue([
    { run_id: 3, job_id: 'stop-alert', status: 'failed', http_code: 0, error_code: 'HTTP=000/curl=28',
      started_at: time('00:25:00'), ended_at: time('00:25:20'), later_ok_ms: kstMs('00:26:00') },
    { run_id: 2, job_id: 'strategy-eval', status: 'failed', http_code: 0, error_code: 'HTTP=000',
      started_at: time('00:24:00'), ended_at: time('00:24:01'), later_ok_ms: kstMs('00:24:01.900') },
    { run_id: 1, job_id: 'news-peek-overseas-00', status: 'degraded', http_code: 200, degraded_reason: 'capture=partial',
      started_at: time('00:00:06'), ended_at: time('00:00:10'), later_ok_ms: kstMs('00:00:30') },
  ]);
  const result = await readAnomalyDetails({ nowMs, rows } as unknown as OpsReader, Promise.resolve([
    { id: 'daily_bars_us', state: 'stale', reason: 'bars_old', dateRef: '2026-11-04', lastOkAt: null, streak: null },
    { id: 'fx_usdkrw', state: 'available', dateRef: null, lastOkAt: null, streak: null },
  ]));
  expect(rows).toHaveBeenCalledWith(ANOMALY_DETAILS_SQL, ['2026-11-07']);
  expect(result.date).toBe('2026-11-07');
  expect(result.rows).toMatchObject([
    { id: 'daily_bars_us', kind: 'source', laterOkAt: null },
    { id: 'run-3', summary: '제한 시간 초과', evidence: '요청 도구 종료 코드 28', laterOkAt: '2026-11-07T00:26:00+09:00' },
    { id: 'run-2', reason: '응답 없음 · 세부 원인 미기록', laterOkAt: null },
    { id: 'run-1', summary: '일부 완료', evidence: 'capture=partial', laterOkAt: '2026-11-07T00:00:30+09:00' },
  ]);
});

it('DB의 분류되지 않은 오류 본문을 전달하지 않고 실행 시각이 없는 경우 슬롯을 사용한다', async () => {
  const rows = jest.fn().mockResolvedValue([
    { run_id: 2, job_id: 'not-in-dictionary', status: 'failed', error_code: 'unexpected raw text',
      degraded_reason: 'unexpected raw text', started_at: time('00:24:00') },
    { run_id: 1, job_id: 'post-market-overseas', status: 'missing', scheduled_slot_at: time('00:00:00') },
  ]);
  const result = await readAnomalyDetails({ nowMs, rows } as unknown as OpsReader, Promise.resolve([]));
  expect(JSON.stringify(result)).not.toMatch(/unexpected raw text|not-in-dictionary/);
  expect(result.rows[1]).toMatchObject({ at: '2026-11-07T00:00:00+09:00', summary: '실행 기록 없음', laterOkAt: null });
});
