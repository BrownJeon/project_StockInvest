/**
 * T-074 — PUT /api/cash-ledger/baseline — 손익 기준 정하기·바꾸기·현금 확인(system_config.cash_ledger_baseline, 낙관적 잠금 409 version).
 * 처리는 `src/lib/ledger/handlers.ts`(인증 이중 확인·응답 봉투)·`service.ts`(흐름)·`store.ts`(DB). 이 파일은 연결만 한다.
 * 인증은 전역 미들웨어 세션(공개 경로 아님). KIS·주문·시그널·안전장치 호출 없음.
 */
import type { NextRequest } from 'next/server';
import { handlePutBaseline } from '@/lib/ledger/handlers';

export const dynamic = 'force-dynamic';

export function PUT(req: NextRequest) {
  return handlePutBaseline(req);
}
