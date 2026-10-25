/**
 * T-084 — `/api/app/version`·`/app/download/[file]` 처리. 라우트 파일은 연결만 한다(라우트 파일엔 Next 가 허용한 export 만 둘 수 있어서
 * 요청 제한기·시험 훅을 여기에 둔다).
 *
 * KIS·주문·시그널·안전장치·cron 호출 없음. DB 는 `app_release` SELECT 만.
 */
import { Readable } from 'node:stream';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/current-user';
import { clientIpKey } from '@/lib/auth/signup-request';
import { openVerifiedApk } from './file';
import { classifyDownloadRequest, LATEST_DOWNLOAD_URL, resolveReleaseDir } from './paths';
import { createFixedWindowLimiter } from './rate-limit';
import { AppReleaseNotMigratedError, getLatestRelease, getReleaseByFile, type AppReleaseRow } from './store';

// ─── GET /api/app/version (로그인 필요) ───────────────────────────────────

export interface AppVersionLatest {
  versionCode: number;
  versionName: string;
  sizeBytes: number;
  sha256: string;
  notes: string | null;
  minSupported: number;
  downloadUrl: string;
}

export function toLatestPayload(row: AppReleaseRow | null): AppVersionLatest | null {
  if (!row) return null;
  return {
    versionCode: row.versionCode,
    versionName: row.versionName,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    notes: row.notes,
    minSupported: row.minSupported,
    downloadUrl: LATEST_DOWNLOAD_URL,
  };
}

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function handleAppVersion(req: NextRequest): Promise<Response> {
  // 미들웨어가 이미 세션을 확인하지만 라우트도 스스로 확인한다(이중 방어 — current-user.ts 원칙).
  const auth = await requireUserId(req);
  if (!auth.ok) return auth.res;
  try {
    const row = await getLatestRelease();
    return NextResponse.json({ ok: true, latest: toLatestPayload(row) }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof AppReleaseNotMigratedError) {
      return NextResponse.json({ ok: false, error: 'not_migrated' }, { status: 503, headers: NO_STORE });
    }
    console.error('[app-release] version 조회 실패:', e instanceof Error ? e.name : typeof e);
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500, headers: NO_STORE });
  }
}

// ─── GET|HEAD /app/download/[file] (공개) ─────────────────────────────────

/** IP 별 10분에 20회. 한계는 rate-limit.ts 머리 주석. */
export const DOWNLOAD_LIMIT = 20;
export const DOWNLOAD_WINDOW_MS = 10 * 60 * 1000;
export const downloadLimiter = createFixedWindowLimiter({ limit: DOWNLOAD_LIMIT, windowMs: DOWNLOAD_WINDOW_MS });

function notFound(): Response {
  return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export async function handleApkDownload(req: Request, file: unknown, method: 'GET' | 'HEAD'): Promise<Response> {
  const limited = downloadLimiter.hit(clientIpKey(req.headers));
  if (!limited.ok) {
    return new Response(null, {
      status: 429,
      headers: { 'Retry-After': String(limited.retryAfterSec), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  }

  const want = classifyDownloadRequest(file);
  if (!want) return notFound();

  const dir = resolveReleaseDir();
  if (!dir) {
    console.error('[app-release] APP_RELEASE_DIR 가 절대 경로가 아님 — 다운로드 404');
    return notFound();
  }

  let row: AppReleaseRow | null;
  try {
    row = want.kind === 'latest' ? await getLatestRelease() : await getReleaseByFile(want.apkFile);
  } catch (e) {
    // 공개 경로 — 내부 상태(마이그레이션 전·DB 장애)를 드러내지 않고 같은 404. 원인은 서버 로그.
    console.error('[app-release] download 조회 실패:', e instanceof AppReleaseNotMigratedError ? 'not_migrated' : e instanceof Error ? e.name : typeof e);
    return notFound();
  }
  if (!row) return notFound();

  const opened = await openVerifiedApk(dir, row);
  if (!opened.ok) return notFound();
  const { handle, fileName, size, sha256 } = opened.apk;

  const headers = new Headers({
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Content-Length': String(size),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'none',
    'X-Content-SHA256': sha256,
    'X-App-Version-Code': String(row.versionCode),
  });

  if (method === 'HEAD') {
    await handle.close().catch(() => {});
    return new Response(null, { status: 200, headers });
  }

  const nodeStream = handle.createReadStream({ start: 0, end: size - 1, autoClose: true });
  const body = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
  return new Response(body, { status: 200, headers });
}
