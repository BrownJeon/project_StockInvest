/**
 * T-143 WP-B — `GET /api/settings/overseas-universe` (구현 가이드 §4.1).
 *
 * 화면 1회 조회. 머리 숫자 4칸 · 변경 확인 기록 · 변경 제안 · 목록을 **섹션 단위 실패 격리**로 돌려준다
 * (한 섹션 실패는 그 섹션만 `error` 이고 HTTP 200 — `/api/ops/home` 선례).
 *
 * 경계:
 *  - **DB 만 읽는다** — KIS·SEC·외부 호출 0, 쓰기 0, 주문·시그널·알림 생성 0.
 *  - `실거래여부`·`모든거래차단`·주문 한도·시그널·보유를 **쓰지도 읽지도 않는다**(가이드 §0.3).
 *  - 인증은 전역 미들웨어(`src/middleware.ts`)가 다른 `/api/settings/*` 와 같이 세션으로 막는다 —
 *    라우트 안에서 다시 세션을 검사하지 않고, `window.Capacitor` 같은 앱 판별을 권한 판단에 쓰지 않는다.
 *  - 마이그레이션(`scripts/migrations/T-143-overseas-universe.sql`) 적용 전에는 `503 not_migrated` →
 *    화면은 중립 「◌ 준비 중」(T-074 `CashLedgerSummaryRow` 선례와 같은 처리).
 */
import { NextResponse } from 'next/server';
import { readUniverseScreen } from '@/lib/universe/store';

export const dynamic = 'force-dynamic';

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


export async function GET() {
  try {
    const r = await readUniverseScreen();
    if (r.kind === 'not_migrated') {
      return NextResponse.json(
        { ok: false, error: 'not_migrated', code: 'not_migrated' },
        { status: 503, headers: { 'cache-control': 'no-store' } },
      );
    }
    return NextResponse.json({ ok: true, data: r.dto }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    // 섹션별로 걸러지지 않은 전체 실패만 여기로 온다(예: 설정 조회 자체가 터진 경우)
    console.error('[api/settings/overseas-universe GET]', errText(e).slice(0, 200));
    return NextResponse.json({ ok: false, error: INTERNAL_ERROR }, { status: 500 });
  }
}
