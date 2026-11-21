/**
 * T-182 `GET /api/reports/trade[?id=<숫자>]` — 보관된 거래 리포트 한 회차 + 회차 목록(화면 `/report`).
 *
 * 접근 모델: 운용현황과 같다(로그인 사용자 전원 — 미들웨어 보호) + 이 라우트가 `requireUserId` 로 다시 검증한다
 * (미들웨어 matcher 가 바뀌어도 무방비가 되지 않게).
 * 읽기 전용(SELECT 만), 외부 호출 없음, 캐시 없음.
 *
 * 응답:
 *  - 200 `{ ok:true, data:{ status:'ok'|'not_found'|'empty', report, history } }`
 *    · `history` 는 발송 성공·시험 아님 회차 최근 60개(최신 먼저) — 시험·발송 실패 회차는 목록에서 빠진다.
 *    · `id` 를 직접 주면 시험·발송 실패 회차도 돌려준다(`report.isTest`·`report.delivered` 로 화면이 표시).
 *  - 400 `invalid_id` — 불투명 양의 정수가 아니다.
 *  - 503 `archive_not_ready`(테이블 없음 — 마이그레이션 전) / `report_unavailable`(그 밖의 조회 실패)
 *    → 화면은 「불러오지 못했습니다 · 비어 있는 것이 아닙니다」.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { requireUserId } from '@/lib/auth/current-user';
import { getReportArchiveView, isMissingTableError } from '@/lib/reports/trade-report-archive';
import { parseReportId } from '@/lib/reports/trade-report-view';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(req: NextRequest) {
  const me = await requireUserId(req);
  if (!me.ok) return me.res;

  const rawId = req.nextUrl.searchParams.get('id');
  let id: number | null = null;
  if (rawId != null && rawId !== '') {
    id = parseReportId(rawId);
    if (id == null) {
      return NextResponse.json({ ok: false, error: 'invalid_id' }, { status: 400, headers: NO_STORE });
    }
  }

  try {
    const data = await getReportArchiveView(id);
    return NextResponse.json({ ok: true, data }, { headers: NO_STORE });
  } catch (e) {
    const missing = isMissingTableError(e);
    console.error('[api/reports/trade]', missing ? '보관 테이블 없음(마이그레이션 T-182 적용 전)' : (e instanceof Error ? e.message : String(e)));
    return NextResponse.json(
      { ok: false, error: missing ? 'archive_not_ready' : 'report_unavailable' },
      { status: 503, headers: NO_STORE },
    );
  }
}
