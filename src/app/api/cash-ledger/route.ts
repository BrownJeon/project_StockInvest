/**
 * T-074 — GET /api/cash-ledger — 입출금 기록 화면 데이터(기준·최신 스냅샷·기록·요약·후보·규칙). 조회 때 지연 매칭 결과를 저장한다.
 * 처리는 `src/lib/ledger/handlers.ts`(인증 이중 확인·응답 봉투)·`service.ts`(흐름)·`store.ts`(DB). 이 파일은 연결만 한다.
 * 인증은 전역 미들웨어 세션(공개 경로 아님). KIS·주문·시그널·안전장치 호출 없음.
 */
import type { NextRequest } from 'next/server';
import { handleGet } from '@/lib/ledger/handlers';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return handleGet(req);
}
