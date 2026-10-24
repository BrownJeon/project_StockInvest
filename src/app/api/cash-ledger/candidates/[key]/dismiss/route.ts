/**
 * T-074 — POST /api/cash-ledger/candidates/:key/dismiss — 기록 안 된 입출금 후보를 '입출금 아님'으로 표시(사유 필수).
 * 처리는 `src/lib/ledger/handlers.ts`(인증 이중 확인·응답 봉투)·`service.ts`(흐름)·`store.ts`(DB). 이 파일은 연결만 한다.
 * 인증은 전역 미들웨어 세션(공개 경로 아님). KIS·주문·시그널·안전장치 호출 없음.
 */
import type { NextRequest } from 'next/server';
import { handleDismissCandidate } from '@/lib/ledger/handlers';

export const dynamic = 'force-dynamic';

export function POST(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  return handleDismissCandidate(req, ctx.params);
}
