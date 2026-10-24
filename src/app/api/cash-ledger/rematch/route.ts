/**
 * T-074 — POST /api/cash-ledger/rematch — 살아 있는 기록 전부를 스냅샷과 처음부터 다시 맞춘다(저장 실패는 500).
 * 처리는 `src/lib/ledger/handlers.ts`(인증 이중 확인·응답 봉투)·`service.ts`(흐름)·`store.ts`(DB). 이 파일은 연결만 한다.
 * 인증은 전역 미들웨어 세션(공개 경로 아님). KIS·주문·시그널·안전장치 호출 없음.
 */
import type { NextRequest } from 'next/server';
import { handleRematch } from '@/lib/ledger/handlers';

export const dynamic = 'force-dynamic';

export function POST(req: NextRequest) {
  return handleRematch(req);
}
