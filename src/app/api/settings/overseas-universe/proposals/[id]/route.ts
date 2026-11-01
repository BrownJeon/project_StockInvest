/**
 * T-143 WP-B — `POST /api/settings/overseas-universe/proposals/[id]` (구현 가이드 §4.2). 제안 1건 처리.
 *
 * `do` 4종: `act`(빼기·넣기·코드 바꾸기 — **수동 목록을 바꾼다**) · `hold`(보류) · `ignore`(무시) · `reopen`(되돌리기).
 *
 * **멱등·충돌**: `baseState` 가 현재 상태와 다르면 **409 이고 아무것도 바꾸지 않는다** — 다른 기기·텔레그램에서 먼저
 * 처리한 경우다(리스크 정책 저장이 쓰는 `baseVersion` → 409 와 같은 방식 — 그 경로 이름은 적지 않는다:
 * `risk/__tests__/isolation.test.ts` 가 허용 목록 밖 파일의 그 문자열을 0건으로 고정한다). 같은 `do` 를 두 번 보내면 두 번째는
 * 409 라서 **중복 클릭이 목록을 두 번 바꾸지 않는다**. 409 는 오류가 아니다 — 화면이 `role="status"` 로 알린다.
 *
 * 경계: DB 만 쓴다(T-143 전용 표 2개). 주문·시그널·알림 0건. 외부 호출 0건.
 * 「삭제」는 하지 않는다 — 제안은 상태만 바뀌고 행은 남는다(가이드 §5.2).
 */
import { NextRequest, NextResponse } from 'next/server';
import { actorLabel } from '@/lib/universe/actor';
import { actOnProposal } from '@/lib/universe/store';
import type { ProposalDo, ProposalState } from '@/lib/universe/types';

export const dynamic = 'force-dynamic';

const DOS: readonly ProposalDo[] = ['act', 'hold', 'ignore', 'reopen'];
const BASE_STATES: readonly ProposalState[] = ['open', 'held', 'ignored'];

interface PostBody { do?: unknown; baseState?: unknown }

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
/**
 * 🔴 500 응답 본문에 **오류 원문을 싣지 않는다**(QA low-1). `errText(e)`·`store` 의 `error` 에는 mysql2 메시지가 담겨
 * **DB 호스트·포트·사용자 이름이 섞일 수 있다**(`connect ECONNREFUSED 192.168.0.x:3306`). 인증된 사용자만 보더라도
 * 응답 본문은 브라우저 개발자 도구·확장·프록시 로그에 남는다.
 *
 * 관용구는 이 저장소의 기존 라우트와 같다 — 본문에는 **짧은 분류어**, 원문은 **`console.error` 로만**
 * (`/api/ops/home` 의 `error: 'home_unavailable'` · 감시 경로인 `auth/signup-request` 의 `error: 'internal_error'`).
 * 화면은 이 값을 **읽어서 `loadError` 상태에 담지만**(`useUniverseFeed.ts:57` — `loadErrorText(status, body.error)`)
 * **어느 universe 화면도 `loadError` 를 그리지 않는다**(조회 실패는 고정 문구 + 「다시 시도」로 그린다).
 * 저장 실패 문구도 `view.ts` 의 상수라 Designer 가 정한 「저장 실패 / 저장은 됐음」 2갈래는 이 변경에 영향받지 않는다.
 * ⚠ 「읽지 않는다」가 아니다 — 나중에 `loadError` 를 화면에 그리게 되면 **이 분류어가 사용자에게 보인다.**
 */
const INTERNAL_ERROR = 'internal_error';


export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ ok: false, error: '요청 본문이 JSON 이 아닙니다' }, { status: 400 });
  }
  const action = body?.do;
  const baseState = body?.baseState;
  const fieldErrors: Record<string, string> = {};
  if (typeof action !== 'string' || !DOS.includes(action as ProposalDo)) {
    fieldErrors.do = `do 는 ${DOS.join(' · ')} 중 하나입니다.`;
  }
  // `done` 을 baseState 로 받지 않는다 — 처리된 제안은 되돌리지 않는다(목록이 이미 바뀌었다, 가이드 §4.2)
  if (typeof baseState !== 'string' || !BASE_STATES.includes(baseState as ProposalState)) {
    fieldErrors.baseState = `baseState 는 ${BASE_STATES.join(' · ')} 중 하나입니다.`;
  }
  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json(
      { ok: false, error: Object.entries(fieldErrors).map(([k, v]) => `${k}: ${v}`).join(' · '), fieldErrors },
      { status: 400 },
    );
  }

  try {
    const actor = await actorLabel(req.cookies);
    const r = await actOnProposal({
      id, action: action as ProposalDo, baseState: baseState as ProposalState, actor,
    });
    if (r.kind === 'not_migrated') {
      return NextResponse.json({ ok: false, error: 'not_migrated', code: 'not_migrated' }, { status: 503 });
    }
    if (r.kind === 'not_found') {
      return NextResponse.json({ ok: false, error: '그 변경 제안을 찾을 수 없습니다', code: 'not_found' }, { status: 404 });
    }
    if (r.kind === 'bad_request') {
      return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    }
    if (r.kind === 'conflict') {
      return NextResponse.json(
        {
          ok: false,
          error: '이 제안은 이미 처리됐습니다 — 최신 상태로 다시 그렸습니다',
          code: 'state_changed',
          data: { proposal: r.proposal },
        },
        { status: 409 },
      );
    }
    if (r.kind === 'error') {
      // 원문은 `store` 가 이미 로그로 남겼다. 본문에는 분류어만 싣는다(QA low-1)
      console.error('[api/settings/overseas-universe/proposals POST] 처리 실패:', r.error.slice(0, 200));
      return NextResponse.json({ ok: false, error: INTERNAL_ERROR }, { status: 500 });
    }
    // 🔴 m-2 — 상태 전이·목록 변경은 커밋됐고 재조회만 실패한 경우. **성공으로 응답한다**
    //   (500 을 돌려주면 카드가 「목록은 바뀌지 않았습니다」라고 거짓을 말한다). 두 값이 null 이 그 사실을 알린다
    if (r.kind === 'saved_unreadable') {
      return NextResponse.json(
        { ok: true, data: { proposal: null, summary: null }, warning: 'reload_failed' },
        { headers: { 'cache-control': 'no-store' } },
      );
    }
    return NextResponse.json(
      { ok: true, data: { proposal: r.proposal, summary: r.summary } },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    console.error('[api/settings/overseas-universe/proposals POST]', errText(e).slice(0, 200));
    return NextResponse.json({ ok: false, error: INTERNAL_ERROR }, { status: 500 });
  }
}
