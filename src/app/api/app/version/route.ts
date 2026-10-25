/**
 * T-084 — GET /api/app/version — 최신 앱 배포본(app_release 최신 행). 앱 업데이트 띠가 쓴다.
 * 로그인 필요(전역 미들웨어 세션 + 라우트 이중 확인). 공개 경로가 아니다.
 * 응답: `{ ok:true, latest: {...}|null }` / 테이블 없음 503 `not_migrated` / 그 밖 500 `server_error`.
 * 처리는 `src/lib/app-release/handlers.ts`. KIS·주문·시그널·안전장치 호출 없음.
 */
import type { NextRequest } from 'next/server';
import { handleAppVersion } from '@/lib/app-release/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return handleAppVersion(req);
}
