/**
 * T-084 — GET|HEAD /app/download/<file> — APK 배포본 내려받기(**공개**: 안드로이드 Custom Tab 은 앱 WebView 의 세션 쿠키를 쓰지 못한다).
 *
 * 공개 범위는 미들웨어 `PUBLIC_PREFIX` 의 `/app/download/` 한 항목이고, 이 라우트가 내보내는 것은
 *   - `latest.apk`(최신 행) 또는 `stockinvest-<x.y.z>.apk`(apk_file 이 정확히 같은 행) 이름 요청만,
 *   - 릴리스 디렉터리(APP_RELEASE_DIR) 바로 아래의 일반 파일(심볼릭 링크·디렉터리 이탈 거부) 중
 *   - 크기·sha256 이 등록값과 같은 파일뿐이다. 그 밖은 전부 같은 404(원인은 서버 로그), IP 별 요청 제한 초과는 429.
 * 처리는 `src/lib/app-release/handlers.ts`. nginx 는 이 경로를 프록시만 한다(www-data 가 /home/brownjeon 을 못 읽음 — Kaiwa 실측).
 */
import type { NextRequest } from 'next/server';
import { handleApkDownload } from '@/lib/app-release/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ file: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { file } = await ctx.params;
  return handleApkDownload(req, file, 'GET');
}

export async function HEAD(req: NextRequest, ctx: Ctx) {
  const { file } = await ctx.params;
  return handleApkDownload(req, file, 'HEAD');
}
