/**
 * POST /api/cron/job-run-log — 크론 잡 실행·상태 기록 수신 (T-112, DDL 초안 §5.2).
 *
 * `scripts/cron-runner.sh` 가 `call()` 마다 서버 로컬 스풀 파일에 한 줄을 쓰고, 틱 경과 150초 미만인 가벼운 틱에서만 최대 200줄을 묶어
 * 이 라우트로 보낸다(`curl --max-time 3`, `call()` 을 거치지 않는다 — 이 라우트 호출은 기록되지 않는다). 줄 형식·분류·슬롯·롤업은
 * `src/lib/strategy/records/job-run-log.ts`.
 *
 * ⚠ 이 라우트는 **관찰 전용**이다 — 주문·시그널·알림·외부 호출이 없고 `job_run_log` 한 테이블에만 쓴다. 실패해도 크론 잡·분석·수집에는
 *   영향이 없다(러너는 응답 코드만 보고 스풀을 비울지 남길지 정한다).
 *
 * 인증: 다른 cron 라우트와 같은 `checkCronAuth()`(x-cron-secret, fail-closed). 미들웨어도 `/api/cron/*` 를 한 번 더 막는다.
 *
 * 응답(러너는 **200 일 때만** 보낸 줄을 지운다):
 *  - 200 `{ ok:true, status:'ok', received, rejected, runRows, rollupRows, rowErrors }` — 형식이 틀린 줄(rejected)·값 오류 행(rowErrors)은
 *    다시 보내도 같으므로 버린다.
 *  - 200 `{ ok:true, status:'skipped_disabled' }` — 스위치 `system_config.job_run_log_enabled` 가 없거나 true 가 아님(키 없음 = 꺼짐).
 *  - 200 `{ ok:true, status:'skipped_no_table' }` — DDL 적용 전(ER_NO_SUCH_TABLE).
 *  - 503 `{ ok:false, status:'failed', reason }` — 스위치를 읽지 못함·처리 2.5초 초과·DB 오류 → 러너가 스풀을 남겨 다음 틱에 다시 보낸다.
 *  - 413 — 본문 1MiB 초과 또는 500줄 초과. 401 — 인증 실패.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cron-auth';
import { JRL_MAX_BODY_BYTES, JRL_MAX_LINES, recordSpoolBatch } from '@/lib/strategy/records/job-run-log';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const authErr = checkCronAuth(req);
  if (authErr) return authErr;

  try {
    const declared = Number(req.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > JRL_MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false, error: 'payload_too_large' }, { status: 413 });
    }
    const text = await req.text();
    if (Buffer.byteLength(text, 'utf8') > JRL_MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false, error: 'payload_too_large' }, { status: 413 });
    }
    let lines = 0;
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
    if (text.length > 0 && text.charCodeAt(text.length - 1) !== 10) lines++;
    if (lines > JRL_MAX_LINES) {
      return NextResponse.json({ ok: false, error: 'too_many_lines' }, { status: 413 });
    }

    const result = await recordSpoolBatch(text);
    if (result.status === 'failed') {
      return NextResponse.json({ ok: false, ...result }, { status: 503 });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    // recordSpoolBatch 는 던지지 않는다 — 본문 읽기 실패 등. 원문 오류는 로그에만(응답에는 분류어).
    console.error('[cron/job-run-log] 요청 처리 실패:', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, status: 'failed', reason: 'request_error' }, { status: 503 });
  }
}
