/**
 * POST /api/cron/broker-fills — 브로커 체결 원장 **"앞으로 수집"**(T-087 · T-081 WP-D1a). cron-runner.sh 가 매일 07:20 KST 이후 첫 틱에 1회 부른다.
 *
 * ⚠ 이 라우트는 **주문·취소·시그널을 만들지 않는다.** KIS 읽기 전용 GET(국내·해외 × 체결·기간손익·잔고) → 새 테이블 5개(broker_*)에만 쓴다.
 *   기존 테이블·킬스위치·안전장치는 건드리지 않는다. 알림(메신저)을 보내지 않는다 — 실패는 run.error 와 로그만. 본체 `src/lib/broker-ledger/collector.ts`.
 *
 * 인증: 다른 cron 라우트와 같은 `checkCronAuth()`(x-cron-secret, fail-closed). 미들웨어도 `/api/cron/*` 를 한 번 더 막는다.
 *
 * 스위치·실행 방식:
 *  - 스위치 `system_config.broker_fills_cron_enabled` — **JSON true 일 때만 켜짐. 키 없음·false·읽기 오류 = 꺼짐(기본 꺼짐).**
 *    꺼져 있으면 크론 호출은 `{ skipped: 'switch_off' }`(KIS 0·DB 쓰기 0).
 *  - 🔴 **`?trigger=manual` 은 스위치가 꺼져 있어도 1회 돈다.** 목적: 배포 뒤 스위치를 켜기 **전에** 사람이 첫 수집을 한 번 돌려 `complete` 여부를
 *    확인하는 것(T-087 단계 4). 같은 cron 인증(x-cron-secret)이 필요하고, 크론 러너는 이 쿼리를 붙이지 않는다. single-flight·run 당 호출 12·
 *    예산 75초·계좌 지문 검사는 manual 에도 똑같이 걸린다. 연속 실패 중단(halted)은 manual 에 걸리지 않는다(사람이 확인하려고 부르는 것이므로) —
 *    manual 이 성공하면 연속 실패가 끊겨 크론이 재개된다. 이 예외가 받아들일 수 없으면 manual 도 스위치를 요구하도록 바꾸면 된다(Reviewer 판단 사항).
 *  - `?trigger=backfill` 은 거부(400) — 과거 백필(D1b)은 이 작업의 승인 범위 밖이다.
 *  - `?market=domestic|overseas`·`?kind=fills|realized_pnl|position_snapshot` 로 일부만 돌릴 수 있다(기본 전부 — 하루 6 run, 실제 7~9 GET).
 *
 * 응답(건수·상태·사유 코드만 — 계좌·키·지문·금액 없음):
 *  - 200 `{ status:'skipped', skipped:'switch_off'|'in_progress' }` · 200 `{ status:'done', jobs:[…] }`(전 작업 complete/incomplete/skipped)
 *  - 503 `not_migrated`(표 없음 — DDL 적용 전) · 503 `preflight_failed`(지문 키 없음 `fingerprint_key_missing`·계좌 없음) ·
 *    503 `done` + 작업 중 failed/halted 가 있음 — cron-runner 가 200 이 아닌 응답의 본문을 로그에 남기므로 사람이 볼 수 있다.
 *  - 400 잘못된 파라미터 · 401 인증 실패 · 403 `non_production`(NODE_ENV≠production — 개발 서버가 같은 DB 에 지문 anchor 를 만드는 사고 방지,
 *    DB·KIS 접근 전에 거절) · 500 그 밖의 오류(코드만).
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cron-auth';
import { getPool } from '@/lib/db';
import { collectBrokerLedger, ROUTE_TIME_BUDGET_MS } from '@/lib/broker-ledger/collector';
import { errCode, isLedgerTableMissing, type SqlPool } from '@/lib/broker-ledger/store';
import { buildCollectorDeps, isProductionRuntime, parseParams, toHttp } from './wiring';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

/** 같은 프로세스 안 single-flight(프로세스 간은 수집기의 GET_LOCK + running 행이 막는다). */
let inFlight = false;

export async function POST(req: NextRequest) {
  const authErr = checkCronAuth(req);
  if (authErr) return authErr;
  if (!isProductionRuntime()) return NextResponse.json({ ok: false, error: 'non_production' }, { status: 403 });

  const startMs = Date.now();
  const params = parseParams(new URL(req.url));
  if (!params.ok) return NextResponse.json({ ok: false, error: params.error }, { status: 400 });
  if (inFlight) return NextResponse.json({ ok: true, status: 'skipped', skipped: 'in_progress', trigger: params.trigger }, { status: 200 });

  inFlight = true;
  try {
    const result = await collectBrokerLedger(buildCollectorDeps(getPool() as unknown as SqlPool), {
      trigger: params.trigger, markets: params.markets, kinds: params.kinds, deadlineMs: startMs + ROUTE_TIME_BUDGET_MS,
    });
    const http = toHttp(params.trigger, result);
    return NextResponse.json(http.body, { status: http.status });
  } catch (e) {
    if (isLedgerTableMissing(e)) return NextResponse.json({ ok: false, status: 'not_migrated', trigger: params.trigger }, { status: 503 });
    const code = errCode(e);
    console.error(`[cron/broker-fills] fatal error: ${code}`);
    return NextResponse.json({ ok: false, error: code }, { status: 500 });
  } finally {
    inFlight = false;
  }
}
