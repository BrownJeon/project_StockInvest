/**
 * T-143 WP-B — `PUT /api/settings/overseas-universe/manual` (구현 가이드 §4.3). 12월 일괄 교체.
 *
 * **전부 아니면 전무.** 한 종목이라도 형식 검사에 걸리면 400 이고 DB 는 그대로다(부분 반영 없음) —
 * 화면 실패 문구가 「전부 반영되거나 전부 안 되거나 둘 중 하나입니다」라고 **단정**하므로 이 보장이 깨지면 화면이 거짓말을 한다.
 * 저장은 개정판 1행 INSERT 한 문장이라 구조적으로 쪼개지지 않는다(`store.replaceManualList`).
 *
 * **서버가 다시 검사한다** — 화면의 `parse-manual-list.ts` 와 **같은 규칙**(§2.6.2)을 서버도 적용한다. 화면 검사를 신뢰하지 않는다.
 * **멱등**: `baseVersion` 이 현재 개정판 번호와 다르면 409 — 같은 교체가 두 벌 이력에 남지 않는다.
 *
 * 경계: DB 만 쓴다. 주문·시그널·알림 0건. `실거래여부`·`모든거래차단` 을 읽지 않는다 —
 * **차단 상태에서도 목록은 바꿀 수 있다**(이 화면은 주문을 만들지 않는다 — 데모 §4 주의, 가이드 §0.3).
 */
import { NextRequest, NextResponse } from 'next/server';
import { actorLabel } from '@/lib/universe/actor';
import { MANUAL_LIST_MAX, checkManualSymbols } from '@/lib/universe/parse-manual-list';
import { replaceManualList } from '@/lib/universe/store';

export const dynamic = 'force-dynamic';

interface PutBody { symbols?: unknown; baseVersion?: unknown }

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


export async function PUT(req: NextRequest) {
  let body: PutBody;
  try {
    body = (await req.json()) as PutBody;
  } catch {
    return NextResponse.json({ ok: false, error: '요청 본문이 JSON 이 아닙니다' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: '요청 본문이 비어 있습니다' }, { status: 400 });
  }

  const baseVersion = body.baseVersion;
  if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion) || baseVersion < 0) {
    return NextResponse.json(
      { ok: false, error: 'baseVersion 은 0 이상의 정수입니다', fieldErrors: { baseVersion: '0 이상의 정수를 보내세요.' } },
      { status: 400 },
    );
  }

  const check = checkManualSymbols(body.symbols);
  if (!check.ok) {
    if (check.reason === 'not_array') {
      return NextResponse.json(
        { ok: false, error: 'symbols 는 종목 코드 배열입니다', fieldErrors: { symbols: [] } },
        { status: 400 },
      );
    }
    if (check.reason === 'too_many') {
      return NextResponse.json(
        { ok: false, error: `종목이 너무 많습니다 — 한 번에 ${MANUAL_LIST_MAX}개까지입니다`, fieldErrors: { symbols: [] } },
        { status: 400 },
      );
    }
    // 형식 오류 — 어느 줄이 틀렸는지 그대로 돌려준다(화면이 대조 목록에서 그 줄을 짚는다)
    return NextResponse.json(
      { ok: false, error: '형식이 잘못된 종목이 있습니다', fieldErrors: { symbols: check.invalid } },
      { status: 400 },
    );
  }

  try {
    const actor = await actorLabel(req.cookies);
    const r = await replaceManualList({ symbols: check.symbols, baseVersion, actor });
    if (r.kind === 'not_migrated') {
      return NextResponse.json({ ok: false, error: 'not_migrated', code: 'not_migrated' }, { status: 503 });
    }
    if (r.kind === 'conflict') {
      return NextResponse.json(
        {
          ok: false,
          error: '다른 기기에서 먼저 저장했습니다 — 최신 목록을 확인한 뒤 다시 저장하세요',
          code: 'version_changed',
          data: { version: r.version, summary: r.summary },
        },
        { status: 409 },
      );
    }
    if (r.kind === 'error') {
      // 원문은 `store` 가 이미 로그로 남겼다. 본문에는 분류어만 싣는다(QA low-1)
      console.error('[api/settings/overseas-universe/manual PUT] 저장 실패:', r.error.slice(0, 200));
      return NextResponse.json({ ok: false, error: INTERNAL_ERROR }, { status: 500 });
    }
    // 🔴 m-2 — 저장은 끝났고 요약 조회만 실패한 경우. **성공으로 응답한다** — 500 을 돌려주면 화면이
    //   「목록은 바뀌지 않았습니다」라고 거짓을 말한다. `summary: null` 이 그 사실을 알린다
    if (r.kind === 'saved_unreadable') {
      return NextResponse.json(
        { ok: true, data: { summary: null, applied: r.applied, version: r.version }, warning: 'summary_unavailable' },
        { headers: { 'cache-control': 'no-store' } },
      );
    }
    return NextResponse.json({ ok: true, data: r.data }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    console.error('[api/settings/overseas-universe/manual PUT]', errText(e).slice(0, 200));
    return NextResponse.json({ ok: false, error: INTERNAL_ERROR }, { status: 500 });
  }
}
