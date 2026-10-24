/**
 * T-074 — `/api/cash-ledger/*` HTTP 처리 (서버 전용). 라우트 파일은 이 함수만 부른다.
 *
 * - 인증: 전역 미들웨어가 세션으로 막고(`OAUTH_PUBLIC_PATHS` 에 넣지 않는다), 여기서도 `requireUserId` 로 한 번 더 확인한다
 *   (이중 방어 — current-user.ts 머리말). 회원 id 는 감사 열(created_by·deleted_by·표시한 사람)에만 쓴다.
 * - 응답 봉투: 성공 `{ ok: true, data, ... }`, 실패 `{ ok: false, code, error, fieldErrors?, existingId?, latest?, retrySafe?, data? }`
 *   (`LedgerErrorBody`). 상태 코드: 400 본문 · 404 · 409 충돌·중복 · 422 검증 · 503 마이그레이션 전 · 500 서버 오류.
 * - 500 은 입력을 지우지 말라는 뜻으로 `retrySafe: true` 를 싣는다(기록 추가·정정 — 같은 clientEntryId 로 다시 보내면 두 번 기록되지 않는다).
 * - 이 라우트들은 KIS·주문·시그널·안전장치를 부르지 않는다. 쓰는 곳은 store.ts 머리말의 세 군데뿐이다.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { requireUserId } from '@/lib/auth/current-user';
import * as svc from './service';
import { isNoTable, LedgerDataError } from './store';

/** 500 응답 문장 — 원문 오류는 싣지 않는다 */
export const SERVER_ERROR_TEXT = '서버 오류로 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.';

const NO_STORE = { 'cache-control': 'no-store' };

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function errorResponse(e: unknown, label: string, retrySafe = false): NextResponse {
  if (isNoTable(e)) {
    return NextResponse.json(
      { ok: false, code: 'not_migrated', error: '입출금 원장 테이블이 아직 없습니다 — 마이그레이션(T-074) 적용 전입니다. 기록이 없어진 것이 아닙니다.' },
      { status: 503, headers: NO_STORE },
    );
  }
  console.error(`[api/cash-ledger ${label}]`, errorText(e));
  // 응답에는 원문(DB 주소·SQL 조각)을 싣지 않는다(Reviewer L2) — 원문은 위 서버 로그로만. 우리가 만든 데이터 오류(복구 안내)만 그대로 보인다
  const error = e instanceof LedgerDataError ? `서버 오류로 처리하지 못했습니다: ${e.message}` : SERVER_ERROR_TEXT;
  return NextResponse.json(
    { ok: false, code: 'server_error', error, ...(retrySafe ? { retrySafe: true } : {}) },
    { status: 500, headers: NO_STORE },
  );
}

async function body(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;   // service 가 400 bad_request 로 답한다
  }
}

async function run(
  req: NextRequest, label: string, fn: (userId: number) => Promise<svc.ServiceResult>, retrySafe = false,
): Promise<NextResponse> {
  const auth = await requireUserId(req);
  if (!auth.ok) return auth.res;
  try {
    const r = await fn(auth.userId);
    return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
  } catch (e) {
    return errorResponse(e, label, retrySafe);
  }
}

type Params<K extends string> = Promise<Record<K, string>>;

export function handleGet(req: NextRequest) {
  return run(req, 'GET', () => svc.getFeed(new Date()));
}

export function handleCreateEntry(req: NextRequest) {
  return run(req, 'POST entries', async (uid) => svc.createEntry(await body(req), uid, new Date()), true);
}

export function handleCorrectEntry(req: NextRequest, params: Params<'id'>) {
  return run(req, 'POST correct', async (uid) => svc.correctEntry((await params).id, await body(req), uid, new Date()), true);
}

export function handleCancelEntry(req: NextRequest, params: Params<'id'>) {
  return run(req, 'POST cancel', async (uid) => svc.cancelEntry((await params).id, await body(req), uid, new Date()));
}

export function handleRestoreEntry(req: NextRequest, params: Params<'id'>) {
  return run(req, 'POST restore', async () => svc.restoreEntry((await params).id, new Date()));
}

export function handlePutBaseline(req: NextRequest) {
  return run(req, 'PUT baseline', async () => svc.putBaseline(await body(req), new Date()));
}

export function handleDismissCandidate(req: NextRequest, params: Params<'key'>) {
  return run(req, 'POST dismiss', async (uid) => svc.dismissCandidate((await params).key, await body(req), uid, new Date()));
}

export function handleReopenCandidate(req: NextRequest, params: Params<'key'>) {
  return run(req, 'POST reopen', async (uid) => svc.reopenCandidate((await params).key, uid, new Date()));
}

export function handleRematch(req: NextRequest) {
  return run(req, 'POST rematch', () => svc.rematch(new Date()));
}
