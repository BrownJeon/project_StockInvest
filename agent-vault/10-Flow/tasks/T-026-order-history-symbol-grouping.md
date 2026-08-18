---
task_id: T-026
title: 주문 내역 종목별 그룹핑·접기펼치기 — 거래이력·대시보드 최근주문 가독성 개선
status: review
roles_involved: [leader, developer, reviewer, qa]
related_tasks: [T-021-recommend-detail-client-crash]
tags:
  - type/task
  - domain/ui
  - domain/analytics
aliases:
  - 주문내역 종목별 그룹핑
  - order-history-symbol-grouping
created: 2026-08-16
updated: 2026-08-16
---

## 목표 (Leader 작성 — 사용자 요청 원문 기반)

> "분석 메뉴의 거래이력과 대시보드메뉴에서의 최근주문 내역이 다수일 경우 보기가 어려워. 이에 대하여
> 날짜별로 주문건을 주식종목별로 그룹핑해주고 펼쳐서 볼수있는 형태로 변경해줘. 그룹핑한 건에
> 대해서는 몇건이고 몇시부터 몇시까지의 내역인지를 간략하게 표기해줘"

주문 건수가 많아지면 두 화면 모두 평면 리스트라 스크롤이 길어지고 같은 종목의 주문이 흩어져 보인다.
**날짜 → 종목** 2단 그룹으로 묶고, 종목 그룹은 접힘 상태에서 요약만 보여주고 탭하면 펼쳐서
개별 주문을 보게 한다.

**요구사항**:
1. 대상 화면 2곳: 분석 탭 "거래 이력"(`OrderHistoryTab`), 대시보드 "최근 주문"(`RecentExecutionsSection`)
2. 그룹 계층: **날짜(1차) → 종목(2차)**. 날짜 라벨은 기존 "오늘/어제/M월 D일" 규칙 유지
3. 종목 그룹 헤더에 **요약 표기**: ① 종목명(한글명 포함) ② 주문 **건수** ③ **시각 범위**(`HH:MM~HH:MM`)
4. 종목 그룹은 **접기/펼치기** 가능. 펼치면 기존 주문 카드 그대로 노출
5. 모바일 우선(갤럭시 S25+, 폭 ~412px) — 요약 한 줄이 412px에서 잘리지 않아야 함

## 관련 과거 이력 요약 (Leader 작성)

- [[T-021-recommend-detail-client-crash]]: UI 컴포넌트가 API 응답 형태를 무가드로 신뢰해 크래시난
  사례. 이번 그룹핑 로직도 `order.symbol`·`created_at` 결측/이상값에 방어가 필요하다는 선례.
- 화면 사양 단일 진실 문서: `docs/screens.md` §3 "분석 탭 → 거래 이력 서브탭 상세", "대시보드 →
  최근 체결 타임라인". **구현 전 이 문서를 먼저 고치고 코드를 맞춘다**(CLAUDE.md 원칙).

## 사전 조사 결과 (Leader, 2026-08-16 코드 실측)

### ① 분석 탭 거래 이력 — `src/app/analytics/components/OrderHistoryTab.tsx` (271줄)

- 이미 **날짜 그룹핑은 존재**한다 — `groupByDate()` (L51-66), KST 기준 "오늘/어제/M월 D일" 라벨
- 데이터: `/api/orders?limit=100` → 종료 상태(`TERMINAL_STATUSES`)만 필터
- 필터 칩 5종(전체/체결/DRY_RUN/차단/실패), 오늘 요약 바(체결·DRY_RUN·차단·합계)
- 주문 카드는 클릭 시 `OrderDetail` 바텀시트 오픈

> 🔴 **반드시 먼저 해결해야 할 구조 문제 — 페이지네이션이 그룹핑보다 먼저 적용된다**
> ```
> L121  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);   // PAGE_SIZE = 7
> L122  const paged  = filtered.slice(page * PAGE_SIZE, (page+1) * PAGE_SIZE);
> L123  const groups = groupByDate(paged);   // ← 7건으로 자른 뒤에 그룹핑
> ```
> 지금은 **7건씩 자른 뒤 그룹핑**하므로, 여기에 종목 그룹을 얹으면 같은 날 같은 종목의 주문이
> 페이지 경계에서 쪼개져 "3건(09:12~09:20)" 같은 요약이 **실제와 다른 수치**를 보여주게 된다.
> → 그룹핑을 페이지네이션보다 **먼저** 수행하고 페이지 단위를 "주문 7건"이 아니라 "날짜 그룹" 또는
> "종목 그룹" 기준으로 바꿀지 결정해야 한다. **이건 UI 취향이 아니라 정확성 문제다.**

### ② 대시보드 최근 주문 — `src/components/dashboard/Dashboard.tsx` L804-870 `RecentExecutionsSection`

- **그룹핑이 전혀 없다** — `orders.slice(0, 10)` 평면 리스트, 날짜 구분선도 없음
- 각 행: 매수/매도 뱃지 + 종목 + 금액 + 상태 + `formatDateTimeKST` 전체 일시
- `Dashboard.tsx`가 **1257줄**이라 이미 비대함 → 이번에 이 섹션을 별도 파일로 분리하는 것을 권장
- 헤더의 "전체 보기 →"가 `/order`로 링크(L820)되는데, board.md 기록상 `/order`는 `/strategy`로 즉시
  redirect된다. **부수 결함 — 이번에 `/analytics`(거래 이력 탭)로 고칠지 함께 판단할 것**

### ③ 공통

- 종목 한글명 변환: 거래 이력은 `useSymbolMeta()`의 `displaySymbol`/`marketFlag`, 대시보드는
  자체 `fmtSymbol()`(L805-811) — **두 곳이 서로 다른 방식**. 그룹 헤더 종목명 표기 시 통일 검토
- 시각 포맷: 거래 이력 `formatTimeKST`, 대시보드 `formatDateTimeKST` (`src/lib/time.ts`)

## 🟡 사용자 결정 필요 (구현 착수 전 — UI 목업 합의 필수)

CLAUDE.md 금기: **"UI 목업 합의 없이 화면을 즉흥 구현 금지"**. 아래를 정한 뒤 Developer 착수한다.

1. **그룹 접힘 기준**: 항상 접힘 / 항상 펼침 / **N건 이상일 때만 접힘**(예: 2건 이하면 그냥 펼쳐 표시)
   — 하루 1~2건뿐인 날까지 접으면 오히려 탭이 늘어 불편할 수 있음
2. **단일 주문 종목 처리**: 그 종목 주문이 1건뿐이면 그룹 헤더 없이 주문 카드를 바로 보여줄지
3. **페이지네이션 재설계**(위 🔴 항목): 페이지 단위를 무엇으로 할지 — 날짜 그룹 / 종목 그룹 / 주문 건수 유지
4. **대시보드 범위**: 현재 `slice(0,10)` 10건 유지할지, 그룹핑 도입하면서 건수를 늘릴지
5. **그룹 요약에 넣을 정보**: 건수·시각범위 외에 **매수/매도 구성**이나 **합계 금액**도 넣을지
6. **시각 범위 표기**: 주문이 1건이면 `09:12~09:12`가 어색 → `09:12` 단독 표기로 처리할지

## Leader 지시사항 (역할별) — 위 6개 결정 후 확정 예정

### Developer (예정)

- `docs/screens.md` 선(先)수정 후 코드 반영
- 그룹핑 로직은 **순수 함수로 분리**(예: `src/lib/orders/group-orders.ts`)해 두 화면이 공유하고
  단위 테스트가 가능하게 할 것 — 같은 로직을 두 컴포넌트에 복붙하지 않는다
- `created_at` 파싱 실패·`symbol` 결측 시 크래시하지 않도록 방어([[T-021-recommend-detail-client-crash]] 선례)
- 접기/펼치기 상태는 컴포넌트 로컬 state로 충분(서버 저장 불필요)
- 접근성: 그룹 헤더는 `<button>` + `aria-expanded`로 구현
- **주문·자금 경로 파일(`src/lib/safety/`, `src/lib/exchanges/`, `src/app/api/orders/`)은 일절 수정 금지** — 순수 표시 계층 작업

### Reviewer (예정)

- 그룹 요약 수치(건수·시각범위)가 **필터·페이지네이션 적용 후 데이터와 일치**하는지 (위 🔴 문제의 재발 여부)
- 순수 함수 분리가 실제로 두 화면에서 공유되는지, 로직 중복이 남지 않았는지
- `Dashboard.tsx` 비대화가 완화됐는지(섹션 분리 여부)

### QA (예정)

- 주문 0건 / 1건 / 같은 종목 다건 / 여러 종목 혼재 / 날짜 경계(자정 전후) 각 케이스 표시 확인
- 폭 412px에서 그룹 헤더 요약이 잘리지 않는지
- 접기/펼치기 토글 후에도 `OrderDetail` 바텀시트가 정상 오픈되는지
- 기존 필터 칩 5종 + 오늘 요약 바가 그룹핑 도입 후에도 정상 동작하는지

## Developer 기록

- [15:06] **T-026 구현 완료 → Reviewer 인계.** 확정 결정 6건 전부 반영. 커밋 없음(HEAD `2fbfefb` 유지).

### 설계 판단 (근거)

- **페이지당 날짜 그룹 수 = 5** (`DATE_PAGE_SIZE`, `OrderHistoryTab.tsx`)
  종목 그룹이 기본 접힘이라 날짜 1개 = 헤더 몇 줄(각 44px). 412px 기준 날짜 5개 ×
  평균 3~5 종목 ≈ 15~25행 ≈ 2~3 스크린 이내로 유지된다. 기존 `PAGE_SIZE=7`은
  단위가 "주문 건수"였으므로 그대로 쓰지 않고 단위 변경에 맞춰 상수도 새로 뒀다.
- **🔴 선결 과제 해소**: `filtered` → `groupByDateThenSymbol()` → **날짜 그룹 slice** 순서로 교체.
  기존 `paged → groupByDate(paged)`(L121-123)는 같은 날 같은 종목이 페이지 경계에서
  쪼개져 그룹 요약이 실제와 다른 값을 표시했다. 회귀 방지용 테스트 케이스 2건 추가
  (`페이징 정확성 (T-026 선결 과제)` describe).
  추가로 데이터 새로고침으로 페이지 수가 줄 때 빈 화면이 되지 않도록 `safePage` 클램프.
- **`/order` 링크 판단 → `/analytics?tab=orders` 로 수정.**
  `src/app/order/page.tsx`는 `redirect('/strategy')`뿐이라 "최근 주문 전체 보기"가
  전략 탭으로 튀었다. 단 `AnalyticsPage`는 탭이 로컬 state뿐이라 `/analytics`로만 보내면
  포트폴리오 탭에 떨어진다 → `AnalyticsPage.tsx`에 **마운트 후 1회** `window.location.search`를
  읽어 초기 탭만 맞추는 `useEffect` 추가(6줄). `useSearchParams()`는 Suspense 경계를
  요구하고 정적 렌더를 깨므로 쓰지 않았고, `useState` 초기화식으로 읽으면 hydration
  mismatch가 나므로 마운트 후 처리했다. 화이트리스트(`TAB_IDS`) 검증 후에만 적용.
- **방어 처리(관측 가능하게, 버리지 않음)** — [[T-021-recommend-detail-client-crash]] 선례
  - `created_at` 파싱 실패/결측/공백/NaN/비문자열 → `(날짜 미상)` 날짜 그룹, 항상 맨 뒤 정렬
  - `symbol` null/빈문자/공백/비문자열/필드 자체 부재 → `(알 수 없음)` 종목 그룹
  - `orders` 자체가 null/undefined/비배열 → `[]` (throw 없음), 배열 내 null 원소는 skip
  - `(알 수 없음)` 그룹은 `marketFlag()`가 🇰🇷를 잘못 붙이지 않도록 국기 표시를 억제
  - 시각을 전부 모르면 요약은 `N건 · 시각 미상`
- **시각 표기 24시간제**: 그룹 헤더 요약은 리더 사양(`09:12~14:30`)대로 24h.
  기존 `formatTimeKST`는 로케일 기본이 12시간제라 `AM 09:12`로 나와 폭도 넓다
  → `src/lib/time.ts`에 `formatTimeKST24()`(hourCycle h23) **신규 추가**(기존 함수 무변경).
  ⚠️ **주문 카드/행 내부의 개별 시각은 기존 `formatTimeKST`(`AM 09:12`) 그대로 뒀다** —
  리더 사양에 없는 변경이라 임의로 바꾸지 않음. 결과적으로 한 화면에서 헤더는 24h,
  카드는 12h가 섞인다. 두 화면 모두 동일하게 섞이므로 화면 간 불일치는 없다.
  → **Reviewer 판단 요청 ①** (아래)
- **JSX 중복 제거**: 그룹 헤더는 공용 컴포넌트 `src/components/orders/SymbolGroupHeader.tsx`로
  분리해 두 화면이 공유(aria 배선·요약 포맷 단일 지점). 여백/배경만 `style` prop으로 override.
  `OrderHistoryTab`의 주문 카드도 중첩 깊이가 5단이 되어 로컬 `OrderCard` 컴포넌트로 분리
  (마크업은 기존 그대로, 배경만 `--bg2`→`--bg3`으로 바꿔 그룹 카드 안에서 대비 확보).
- **대시보드 그룹 요약의 의미**: `slice(0,10)` **후** 그룹핑한다. 즉 요약은 "최근 10건 범위
  안에서의" 건수·시각범위이며 그날 전체가 아니다(가장 오래된 그룹은 10건 컷에서 잘릴 수 있음).
  "최근 N건" 섹션의 본질상 불가피하고, 헤더 요약과 펼친 행이 **항상 일치**한다는 성질은 유지된다.
  `docs/screens.md`에 이 한계를 명시하고 "그날 전체는 전체 보기 →"로 안내.

### 변경 파일

**신규**
- `src/lib/orders/group-orders.ts` — 순수 함수 `groupByDateThenSymbol()` + `formatGroupTimeRange()`
  / `formatGroupSummary()` / `countOrdersInDateGroup()`. 두 화면 공유
- `src/lib/orders/__tests__/group-orders.test.ts` — 35 케이스
- `src/components/orders/SymbolGroupHeader.tsx` — 공용 접기/펼치기 헤더(`<button aria-expanded aria-controls>`, minHeight 44px)
- `src/components/dashboard/RecentExecutionsSection.tsx` — `Dashboard.tsx`에서 분리 + 그룹핑 적용

**수정**
- `docs/screens.md` — **코드보다 먼저 수정**. §3 거래 이력 서브탭 상세(2단 그룹·페이지 단위·
  방어 규칙·정확성 요건), §3 대시보드 최근 주문, §4 이동 경로·공용 컴포넌트 표, §6 문서 이력
- `src/app/analytics/components/OrderHistoryTab.tsx` — 그룹핑 선(先)적용, 날짜 단위 페이징,
  로컬 `groupByDate`/`kstDateLabel` 제거, `OrderCard` 분리
- `src/components/dashboard/Dashboard.tsx` — 1257줄 → **1171줄**(-86). `RecentExecutionsSection`·
  `ORDER_STATUS_META`·`fmtOrderAmount`·자체 `fmtSymbol()` 제거, 미사용 `formatDateTimeKST` import 정리
- `src/app/analytics/AnalyticsPage.tsx` — `?tab=` 딥링크 지원(+12줄)
- `src/lib/time.ts` — `formatTimeKST24()` 추가(+9줄, 기존 함수 무변경)

### 테스트 결과 (있는 그대로)

| 항목 | 기준선 | 결과 |
|---|---|---|
| jest 전체 | 99 suites / 1478 tests | **100 suites / 1513 tests 전부 통과** (+1 suite, +35 tests, 회귀 0) |
| `npm run typecheck` (tsc --noEmit) | — | **0 에러** |
| `npm run build` (next build) | — | **✓ Compiled successfully**, `/analytics` 정적(○) 유지 |
| `npm run lint` | — | ⚠️ **실행 불가** — `next lint`가 ESLint 미설정 상태라 대화형 설정 프롬프트를 띄운다. **기존부터 그런 상태이고 이번 변경과 무관**. 합리화하지 않고 그대로 보고함 |

신규 테스트 35건 커버리지: 0건 / null·undefined·비배열 입력 / 1건 / 같은 종목 다건 /
여러 종목 혼재 / KST 자정 경계(UTC 00:00·UTC 익일·KST 00:30 포함) / now 이동에 따른 오늘·어제 라벨 /
`created_at` 이상값(문자열·빈문자·null·undefined·NaN·Date('garbage')) / `symbol` 결측(null·빈문자·
공백·비문자열·필드 부재) / 페이징 정확성 회귀 / 정렬 결정성 / 원본 배열 불변.

### Self-check

- 주문·자금 경로 무변경 확인 (지시받은 명령 그대로 실행):
  ```
  $ git status --porcelain -- src/lib/safety src/lib/exchanges src/lib/signals src/lib/strategy src/app/api
  (출력 없음 — 공백)
  ```
- `git log --oneline -1` → `2fbfefb` (HEAD 유지, **commit/push 하지 않음**)
- npm 신규 의존성 추가 없음 (`package.json` 무변경)
- 안전장치 self-check 5항목: **해당 없음** — 순수 표시 계층 작업으로 주문 송신 경로
  (`submitOrder()`·거래소 어댑터·`/api/orders`) 코드를 한 줄도 건드리지 않았다.
  `src/lib/orders/`는 SAFETY_PATHS 밖이라 commit-msg 훅 게이트 대상도 아니다.
- 참고: `git status`에 보이는 `CLAUDE.md`·`ACTIVE.md`·`board.md`·`scripts/git-hooks/` 변경은
  **[[T-025-commit-reviewer-safeguard]] 세션 산출물이며 이번 작업과 무관**하다(Developer 미변경).

### Reviewer 판단 요청

1. **시각 표기 혼재** — 그룹 헤더 24h(`09:12~14:30`) vs 주문 카드 12h(`AM 09:12`).
   리더 사양 준수(헤더만 24h) + 임의 변경 금지를 우선해 카드는 그대로 뒀다.
   카드도 `formatTimeKST24`로 통일할지 판단 요청(각 화면 1줄 변경).
   덧붙여 현재 `formatTimeKST`가 ko-KR인데도 `오전`이 아니라 **영문 `AM`**을 뱉는다
   (ICU 78.2 실측). 이번 범위 밖이라 손대지 않았으나 별도 백로그 후보.
2. **`AnalyticsPage` 딥링크 방식** — `useSearchParams()` 대신 마운트 후 `window.location.search`
   1회 읽기. Suspense/정적렌더/hydration 세 제약을 동시에 피하려는 선택인데,
   첫 페인트에 포트폴리오 탭이 한 프레임 보였다가 전환되는 점은 감수했다. 수용 가능한지.
3. **`DATE_PAGE_SIZE = 5`** 적정성 — 실데이터 기준으로 한 페이지가 너무 짧/긴지.
4. **대시보드 그룹 요약 범위** — `slice(0,10)` 후 그룹핑이라 요약이 "그날 전체"가 아님.
   `docs/screens.md`에 명시했으나 UI에 별도 문구가 필요한지.

- [16:04] **Reviewer LOW 2건 수정 완료** (사용자 "둘 다 지금 처리" 확정 건). 커밋 없음(HEAD `2fbfefb` 유지).

  **LOW-1 · `normalizeSymbol()` trim 반환** — `src/lib/orders/group-orders.ts`
  기존 `typeof v === 'string' && v.trim() !== '' ? v : UNKNOWN_SYMBOL` 은 공백 유무만 검사하고
  **원본을 그대로 반환**해 `'005930'` 과 `' 005930 '` 이 서로 다른 그룹으로 쪼개졌다.
  `trim()` 한 값을 그룹 키로 쓰도록 수정(early-return 형태로 풀어 써 trim 을 1회만 계산).
  Reviewer 권고안과 동작은 동일하다. trim 결과가 빈 문자열이면 기존대로 `UNKNOWN_SYMBOL` 로 떨어진다.
  → 이건 스타일 보강이 아니라 **"같은 종목을 묶어 본다"는 이 task 의 목적을 직접 깨던 동작**이라
  의도 주석을 함수 위에 남겨 회귀 시 이유가 보이게 했다.

  **테스트 4건 추가** (`describe('symbol 공백 정규화 (Reviewer LOW)')`, 총 35 → 39):
  - `' 005930 '` / `'005930\n'` / `'\t005930'` / `'005930'` 4건이 **한 그룹**으로 묶이고
    반환 `symbol` 도 `'005930'`(trim 된 값)이며 요약이 `4건 · 09:12~14:30` 인지
  - 해외 심볼(`' NAS:AAPL'` vs `'NAS:AAPL'`)도 한 그룹인지 — 콜론 포함 심볼 회귀 방지
  - **공백만 있는 심볼**(`'   '`, `'\t\n'`)이 trim 후 빈 문자열이므로 `(알 수 없음)` 으로 떨어지고,
    `''` 이 그룹 키로 남지 않으며, 총 건수는 보존되는지(`countOrdersInDateGroup`)
  - 정규화가 **그룹 요약 수치를 정확하게** 만드는지 (정규화 전이면 1건/2건으로 쪼개져 요약이 틀어짐)

  **LOW-2 · 대시보드 "최근 N건" 보조 표기** — `src/components/dashboard/RecentExecutionsSection.tsx`
  섹션 헤더를 `최근 주문` 단독 → `최근 주문 · 최근 {RECENT_LIMIT}건` 으로. **하드코딩 `10` 이 아니라
  실제 표시 상수 `RECENT_LIMIT` 을 참조**하므로 나중에 건수를 바꿔도 표기가 어긋나지 않는다.
  - 톤: 기존 관행대로 `var(--muted)`, 11px(우측 "전체 보기 →" 와 동일 크기)에 `opacity:.75` 를 더해
    주 라벨(12px)보다 한 단계 약하게. 신규 색 토큰 도입 없음
  - 412px 오버플로 방지: 좌측 두 라벨을 `display:flex, alignItems:'baseline', gap:6, minWidth:0` 로 묶고
    양쪽 라벨과 우측 링크 전부 `whiteSpace:'nowrap'`, 링크에 `flexShrink:0`.
    412px 기준 헤더 내부 가용폭 384px 에 대해 실제 소요는 `최근 주문`(~55px) + `· 최근 10건`(~60px)
    + `전체 보기 →`(~62px) + gap ≈ 185px 로 여유가 충분하다(한 줄 유지)
  - `docs/screens.md` 대시보드 절에 이 보조 표기를 사양으로 추가하고, §6 문서 이력 2026-08-16 행에
    LOW 2건 후속을 덧붙였다(문서가 화면 사양의 단일 진실)

  **검증 결과 (있는 그대로)**
  | 항목 | 기준선 | 결과 |
  |---|---|---|
  | `npm test` | 100 suites / 1513 tests | **100 suites / 1517 tests 전부 통과** (+4 tests, 회귀 0, 실패 0) |
  | `npm run typecheck` | — | **0 에러** |
  | `npm run build` | — | **✓ Compiled successfully**, `/analytics` **정적(○) 유지**(16.2 kB) |

  **Self-check**
  ```
  $ git status --porcelain -- src/lib/safety src/lib/exchanges src/lib/signals src/lib/strategy src/app/api
  (출력 없음 — 공백)
  $ git status --porcelain -- package.json package-lock.json
  (출력 없음 — 공백, 신규 의존성 없음)
  $ git log --oneline -1
  2fbfefb  (HEAD 유지, commit/push 하지 않음)
  ```
  변경 파일 3개: `src/lib/orders/group-orders.ts` · `src/lib/orders/__tests__/group-orders.test.ts` ·
  `src/components/dashboard/RecentExecutionsSection.tsx` (+ 문서 `docs/screens.md`).
  순수 표시 계층으로 안전장치 self-check 5항목은 해당 없음(주문 송신 경로 무변경).

  **Reviewer 재검증 요청** — 검증 순환 정책에 따라 QA 직행이 아니라 Reviewer 의도 재검증부터.
  LOW-2 의 412px 한 줄 유지는 폰트 폭 추정치 기반이라 **실기기(S25+ 크롬) 육안 확인은 QA 단계 필요**.

## Reviewer 기록

- [15:13] T-026 독립 감사 착수. task 이력서 전체 정독(목표·사전조사·확정 결정 6건·Developer 기록).
  워킹트리 diff 실측, HEAD `2fbfefb` 불변 확인. 안전경로 무변경 재확인 —
  `git status --porcelain -- src/lib/safety src/lib/exchanges src/lib/signals src/lib/strategy src/app/api`
  출력 없음(공백). Developer의 self-check 그대로 재현됨.
- [15:13] **🔴 최우선 — 그룹 요약 정확성 검증.** `OrderHistoryTab.tsx` L108-125:
  `filtered(필터 적용 후) → groupByDateThenSymbol(filtered) → 날짜그룹 slice(페이징)` 순서를 코드로
  직접 확인. 기존 `paged → groupByDate(paged)`(7건 자른 뒤 그룹핑) 결함이 실제로 역순으로 교체됐다.
  `group-orders.test.ts` "페이징 정확성 (T-026 선결 과제)" describe 2건을 포함해 전체 35건을 직접
  `npx jest`로 재실행 — 전부 pass(같은 날 같은 종목 5건이 한 그룹으로 유지되고, 날짜 단위로 잘라도
  각 날짜 그룹의 요약이 온전함을 검증하는 케이스 포함). 필터 칩이 걸린 상태에서도 그룹핑 입력이
  `filtered`(필터 후 데이터)이므로 필터+그룹+페이징 전 구간에서 요약이 실데이터와 일치한다.
  대시보드는 `orders.slice(0, RECENT_LIMIT)` **후** 그룹핑(`RecentExecutionsSection.tsx` L71-74)이라
  "그날 전체"가 아닌 "최근 10건 범위 내" 요약이지만, 이는 페이지 경계에서 그룹이 쪼개지며 잘못된
  수치를 보이던 원래 결함과는 성격이 다르다(그룹과 표시 행이 항상 1:1로 일치, 상한 컷일 뿐 오염 아님).
  `docs/screens.md`에 이 한계가 명시돼 있음도 확인. → 판단 요청 ④ 참고.
- [15:13] 순수 함수 공유 여부 — `OrderHistoryTab.tsx`·`RecentExecutionsSection.tsx` 둘 다
  `@/lib/orders/group-orders`의 `groupByDateThenSymbol`을 그대로 임포트해 사용. 기존 로컬
  `groupByDate`/`kstDateLabel`(구 `OrderHistoryTab.tsx`)은 diff로 제거 확인. `SymbolGroupHeader.tsx`도
  두 화면이 공유하며 로직 중복 없음.
- [15:13] 방어 처리 — `group-orders.ts` 코드 검증: `created_at` 파싱 실패/null/undefined/공백/
  `NaN` Date → `UNKNOWN_DATE_KEY`로 수집(버리지 않음), `symbol` 결측/공백/비문자열/필드 부재 →
  `UNKNOWN_SYMBOL`. `orders` 자체가 null/undefined/비배열이면 `[]`(throw 없음), 배열 내 `null` 원소는
  skip. 관련 테스트(이상값·결측 전 케이스) 직접 실행 확인 — "조용히 사라지는" 주문 없음, 전부
  관측 가능한 그룹으로 귀속됨. T-021 선례 대응 적절.
- [15:13] 범위 이탈 검토 — `AnalyticsPage.tsx`: `?tab=orders` 딥링크(+12줄)는 `window.location.search`
  1회 읽기 + `TAB_IDS` 화이트리스트 검증 후에만 `setState`, 임의 값 주입 경로 없음(코드 확인).
  Leader 사전조사 ②에 "부수 결함 — 함께 판단할 것"으로 명시된 `/order`(→`/strategy` redirect) 깨진
  링크를 고치기 위한 필연적 변경이므로 스코프 이탈이 아니라 정당한 부수 변경으로 판단.
  `src/lib/time.ts`: `formatTimeKST24` 순수 추가, 기존 함수(`formatTimeKST` 등) diff상 무변경 확인.
- [15:13] `Dashboard.tsx` 비대화 완화 — `wc -l` 실측 1257→1171(-86), Developer 보고와 정확히 일치.
  `RecentExecutionsSection`·`ORDER_STATUS_META`·`fmtOrderAmount`·자체 `fmtSymbol()` 완전 제거를 diff로
  확인. `symbolMeta` state는 다른 용도(관심종목 등)로 계속 쓰이므로 orphan 아님.
- [15:13] 접근성·모바일 — `SymbolGroupHeader.tsx`: `<button aria-expanded aria-controls>`,
  `minHeight:44` 터치 타겟. 종목명 span은 `flex:'1 1 auto', minWidth:0, overflow:hidden,
  textOverflow:'ellipsis'`, 요약 span은 `flexShrink:0` — 긴 종목명이 있어도 412px에서 요약이
  밀려나지 않고 이름 쪽이 말줄임 처리되는 구조(코드상 타당, 실기기 렌더 미실측).
- [15:13] 사양 준수 — 요약은 건수+시각범위만(`formatGroupSummary` 구현에 매수/매도·합계 없음),
  1건이면 단일 시각(`1건 · 10:05`, 테스트로 확인), 두 컴포넌트 모두 초기 `expanded` state가 빈
  `Set`이라 기본 접힘, 1건짜리 종목도 예외 없이 그룹(테스트 확인), 대시보드 `RECENT_LIMIT=10` 유지.
  확정 결정 6건 전부 반영 확인.
- [15:13] 기존 기능 회귀 — 필터 칩 5종 로직·오늘 요약 바 로직(필터/페이지 무관, `orders` 기준) diff상
  무변경. `OrderDetail` 바텀시트 연결(`onSelect={setSelectedId}`)도 `OrderCard` 분리 과정에서 그대로
  유지. 대시보드 최근 주문은 `git show HEAD:...Dashboard.tsx`로 원본을 직접 대조한 결과 원래도
  행 클릭·`OrderDetail` 연동이 없었음 — 이번 분리로도 그대로 없음, 회귀 아님.
- [15:13] 독립 실행 검증(있는 그대로) — `npx jest` 전체 **100 suites / 1513 tests 전부 통과**(신규
  `group-orders.test.ts` 35건 포함, 회귀 0) / `npm run typecheck` **0 에러** / `npm run build`
  **성공**, `/analytics` 정적(○) 유지 — 전부 Developer 보고와 동일한 수치로 재현. `next lint`는
  기존부터 미설정 상태라 실행 불가(이번 변경과 무관, 별개 사안 — 합리화 아님).
- [15:13] **판단 요청 ① (시각 표기 혼재)**: 현행 유지 권장(수용). 리더 사양은 헤더 요약만
  `HH:MM~HH:MM`로 명시했고 카드 내부 개별 시각은 범위 밖이었다 — 지금 임의로 카드까지 24h로
  바꾸면 오히려 지시받지 않은 변경이 된다. `formatTimeKST`의 "AM"(로케일 `오전` 아님) 표기는 이번
  범위 밖이 맞고 별도 백로그가 타당.
- [15:13] **판단 요청 ② (AnalyticsPage 딥링크 방식)**: 수용 가능. `TAB_IDS` 화이트리스트로 안전하게
  검증되고, `useSearchParams()`의 Suspense 경계·정적 렌더 제약을 피하려는 근거가 타당하며 `/analytics`가
  정적(○)으로 유지되는 핵심 이점을 지킨다. 첫 페인트 한 프레임 포트폴리오 탭 노출은 마운트 직후
  `useEffect`로 즉시 전환되는 수준이라 실사용 체감 영향이 낮다.
- [15:13] **판단 요청 ③ (DATE_PAGE_SIZE=5)**: 수용. 근거(종목 그룹 기본 접힘 시 헤더 44px 기준 412px
  화면 2~3 스크린)가 타당하고, 상수 하나라 실사용 피드백 후 조정도 쉽다. 지금 확정할 필요 없음.
- [15:13] **판단 요청 ④ (대시보드 그룹 요약이 "그날 전체" 아님)**: `docs/screens.md`에 이미 명시했고
  "전체 보기 →" 도선도 갖춰져 있어 현재로선 문서화로 충분하다고 판단(차단 사유 아님). 다만 헤더 옆에
  "최근 10건" 같은 보조 텍스트가 있으면 문서를 안 본 사용자도 즉시 알 수 있다 — LOW 개선 제안으로
  남긴다.
- [15:13] 추가 발견(LOW, 차단 아님) — `group-orders.ts` L83-85 `normalizeSymbol()`이 공백 유무만
  `v.trim() !== ''`으로 검사하고 반환값은 trim 하지 않은 원본 `v`를 그대로 쓴다. DB에 앞뒤 공백이
  섞인 동일 심볼(예: `"005930"`과 `" 005930"`)이 존재하면 서로 다른 종목 그룹으로 쪼개질 수 있다.
  KIS 연동 데이터 경로상 발생 가능성은 낮으나(API 응답을 그대로 저장하는 컬럼) 완전 배제는 아니다.
  수정 권고: `return typeof v === 'string' && v.trim() !== '' ? v.trim() : UNKNOWN_SYMBOL;`
  — 자금·정확성 영향 없는 방어적 보강이라 이번 릴리스 차단 사유는 아님.
- [15:13] 요약: CRITICAL 0 · HIGH 0 · MEDIUM 0 · LOW 2(판단④ UI 힌트 제안 / `normalizeSymbol` trim
  보강 제안). 주문·자금 경로(`src/lib/safety/`, `src/lib/exchanges/`, `src/app/api/orders/`) 코드
  변경 없음을 grep으로 재확인 — 순수 표시 계층 작업이라는 Developer 주장과 일치.

최종 판정: PASS (scope: src/lib/orders/, src/components/orders/, src/components/dashboard/, src/app/analytics/, src/lib/time.ts, docs/screens.md)

- [16:09] **라운드2 재검증 착수** — 사용자가 라운드1 LOW 2건을 "둘 다 지금 처리"로 확정, Developer가
  `src/lib/orders/group-orders.ts` · `src/lib/orders/__tests__/group-orders.test.ts` ·
  `src/components/dashboard/RecentExecutionsSection.tsx` · `docs/screens.md` 4개 파일만 수정. `git status`로
  변경 파일 집합이 정확히 이 4개(+ round1과 동일한 나머지)와 일치함을 재확인. HEAD `2fbfefb` 불변,
  안전경로(`src/lib/safety` `src/lib/exchanges` `src/lib/signals` `src/lib/strategy` `src/app/api`) 무변경
  재확인.
- [16:09] **LOW-1 해소 확인** — `group-orders.ts` L83-93 `normalizeSymbol()`을 직접 대조: 기존
  `typeof v === 'string' && v.trim() !== '' ? v : UNKNOWN_SYMBOL`(원본 반환)에서
  `typeof v !== 'string' → UNKNOWN_SYMBOL`, 그 외 `const trimmed = v.trim(); return trimmed === '' ?
  UNKNOWN_SYMBOL : trimmed;`로 교체돼 **trim된 값을 그룹 키·반환값 양쪽에 사용**하도록 바뀜을 확인 —
  라운드1 권고안과 동일한 동작. 신규 테스트 `describe('symbol 공백 정규화 (Reviewer LOW)')` 4건을
  `npx jest src/lib/orders`로 직접 재실행 — 전부 pass: ① `' 005930 '`/`'005930\n'`(개행)/`'\t005930'`
  (탭)/`'005930'` 4건이 한 그룹으로 묶이고 반환 `symbol`도 trim된 `'005930'`인지 ② 콜론 포함 해외
  심볼(`' NAS:AAPL'`)도 동일 처리 ③ 공백만 있는 값(`'   '`, `'\t\n'`)은 trim 후 빈 문자열이 되어
  `''`가 아니라 `UNKNOWN_SYMBOL`로 정확히 떨어지고 총 건수는 보존되는지 ④ 정규화가 실제로 그룹 요약
  건수·시각범위를 정확하게 만드는지(정규화 전이면 1건/2건으로 쪼개져 틀어졌을 값). 공백/탭/개행 등
  다양한 공백 문자로 커버돼 단순 스페이스만 처리하는 얕은 수정이 아님을 확인.
- [16:09] **trim 정규화의 부작용 점검** — trim된 값은 `SymbolGroup.symbol`(그룹 헤더 식별자·
  `useSymbolMeta().displaySymbol`/`marketFlag` 조회 키·React key 일부)에만 쓰인다. 개별 주문 카드
  (`OrderHistoryTab.tsx`의 `OrderCard`)는 `order.symbol`(원본, 그룹 키와 무관한 개별 필드)을 직접
  참조해 `displaySymbol`/`marketFlag`를 호출하므로 trim 변경의 영향권 밖 — 회귀 없음. `RecentExecutionsSection`
  펼침 행은 애초에 심볼 텍스트를 표시하지 않음(매수/매도·금액·상태·시각만) — 영향 없음.
  `OrderDetail` 바텀시트는 `orderId`로 조회하지 symbol 문자열로 조회하지 않으므로 무관. 즉 trim은
  "그룹 묶기 식별자"에만 국한되고, 개별 주문의 원본 표시 경로를 오염시키지 않음 — 의도한 범위로 정확히
  한정됨을 코드 추적으로 확인.
- [16:09] **LOW-2 해소 확인** — `RecentExecutionsSection.tsx`: `RECENT_LIMIT = 10` 상수를 헤더 문구
  (`· 최근 {RECENT_LIMIT}건`)가 템플릿 리터럴로 직접 참조 — 하드코딩 아님, 표시 건수를 바꾸면 문구가
  자동으로 따라감을 코드로 확인(`orders.slice(0, RECENT_LIMIT)`과 동일 상수 공유). `docs/screens.md`에도
  "이 범위 제한을 문서 없이도 알 수 있게 섹션 헤더에 `· 최근 N건` 보조 표기를 둔다"로 반영됨을 diff로
  확인 — 코드·문서 일치.
- [16:09] **412px 한 줄 유지 — 구조적 검토(코드 한정)** — `cardHeader`(flex, `justifyContent:space-between`)
  아래 좌측 `<div flex, alignItems:baseline, gap:6, minWidth:0>`에 "최근 주문"(12px, nowrap)과
  "· 최근 10건"(11px, opacity .75, nowrap) 두 span, 우측 `<Link>`(11px, nowrap, `flexShrink:0`).
  좌측 div는 `minWidth:0`으로 축소는 허용되지만 내부 두 span 자체에는 개별 `overflow:hidden`/
  `textOverflow:ellipsis`/`flexShrink:0`가 없다 — 즉 **가용폭이 실제로 부족해지면** 두 span이 축소
  대신 넘칠 구조적 여지가 이론상 있다(기존 `SymbolGroupHeader`가 종목명에 `minWidth:0`+`ellipsis`를
  명시적으로 준 것과 대비됨). 다만 이 헤더의 텍스트는 사용자 가변 데이터(종목명)가 아니라 고정
  한국어 라벨이라 실제 폭이 짧고(Developer 추정 좌측+우측 합 ≈185px vs 412px 기준 가용폭 ≈384px,
  여유 ≈199px), 여유폭이 넉넉해 실사용에서 넘칠 가능성은 낮다고 판단 — **코드 감사로는 여기까지만
  확정 가능**하고, Developer가 이미 명시했듯 실기기(S25+ 크롬) 육안 확인은 QA 몫으로 정확히
  분리돼 있다. 차단 사유 아님(LOW 유지 없음 — 새 이슈로 격상하지 않음, QA 체크리스트에만 반영 권고).
- [16:09] **회귀 재확인** — 라운드1에서 검증한 항목 재점검: 그룹 요약 정확성(필터→그룹핑→페이징
  순서, `OrderHistoryTab.tsx` 무변경 확인), 순수 함수 공유(두 화면 모두 여전히
  `groupByDateThenSymbol` import), 사양 준수 6건(코드 무변경 부분은 라운드1 그대로 유효,
  `RECENT_LIMIT=10` 유지) 전부 이번 diff 범위 밖이라 깨지지 않음. `npx jest` 전체
  **100 suites / 1517 tests 전부 통과**(1513→1517, +4, 회귀 0), `npm run typecheck` **0 에러**,
  `npm run build` **성공**(`/analytics` 16.2 kB, 정적 ○ 유지) — 전부 Developer 보고와 동일한 수치로
  직접 재현.
- [16:09] **신규 발견**: 없음. 라운드1 LOW 2건 모두 코드·테스트로 해소 확인, 신규 결함 없음.

최종 판정: PASS (scope: src/lib/orders/, src/components/dashboard/, docs/screens.md)

## QA 기록

- [15:18] T-026 최종 QA 검증 착수. 지시받은 18개 항목 전부 실행 계획 수립.

### 커버리지 표

| # | 지시받은 항목 | 실행 여부 | 결과 |
|---|---|---|---|
| A1 | npm test (jest 전체) | ✓ | 100 suites / 1513 tests 전부 통과 |
| A2 | npm run typecheck | ✓ | 0 에러 |
| A3 | npm run build + `/analytics` 정적 렌더 | ✓ | ✓ Compiled successfully, ○ (정적) 유지 |
| B4 | 종목 그룹 **기본 접힘** | ✓ | OrderHistoryTab.tsx L62 `useState<Set<string>>(() => new Set())` |
| B5 | 주문 1건인 종목도 **예외 없이 그룹** | ✓ | group-orders.test.ts "1건짜리 종목도 예외 없이 그룹" 테스트 통과 |
| B6 | 거래이력 페이징이 **날짜 단위**, 그룹핑이 **먼저** | ✓ | OrderHistoryTab.tsx L120-125: `filtered → groupByDateThenSymbol → slice(날짜 그룹)` |
| B7 | 대시보드 표시 **10건 유지** | ✓ | RecentExecutionsSection.tsx L26 `RECENT_LIMIT=10` |
| B8 | 그룹 요약이 **건수 + 시각범위만** | ✓ | group-orders.ts L202 `formatGroupSummary` = `${count}건 · ${timeRange}` (매수/매도·합계 없음) |
| B9 | 주문 1건일 때 범위 대신 **단일 시각** | ✓ | group-orders.ts L196 `a === b` → 단일 시각 표기, 테스트 "요약은 단일 시각" 통과 |
| C10 | 주문 0건 / 1건 / 같은 종목 다건 / 여러 종목 혼재 | ✓ | group-orders.test.ts 관련 17개 테스트 전부 통과 |
| C11 | 자정 경계(KST) | ✓ | group-orders.test.ts "날짜 경계" describe 6개 테스트 전부 통과 |
| C12 | `created_at` 이상값 / `symbol` 결측 — 조용히 사라지지 않는지 | ✓ | 그룹-orders.test.ts "created_at 이상값" 6개 + "symbol 결측" 3개 테스트 전부 통과. 버려지지 않고 `(날짜 미상)` / `(알 수 없음)` 그룹으로 수집됨 |
| D13 | 필터 칩 5종(전체/체결/DRY_RUN/차단/실패) 정상 동작 | ✓ | OrderHistoryTab.tsx L129-142 필터 칩 로직 무변경, 필터 버튼 클릭 → `setFilter` → `filtered` 재계산 파이프라인 유지 |
| D14 | 오늘 요약 바(체결·DRY_RUN·차단·합계) 정상 | ✓ | OrderHistoryTab.tsx L101-166 요약 바 로직 무변경. `todayOrders` 필터링 로직 그대로 |
| D15 | `OrderDetail` 바텀시트가 그룹 펼친 뒤에도 정상 오픈 | ✓ | OrderHistoryTab.tsx L224 `onSelect={setSelectedId}` 무변경, L239-243 `OrderDetail` 태그 무변경. 그룹 토글이 `selected` 상태에 영향 없음 |
| D16 | **필터가 걸린 상태에서 그룹 요약 건수가 필터 결과와 일치** (이 task의 존재 이유) | ✓ | OrderHistoryTab.tsx L108-125: `filtered(필터 적용) → groupByDateThenSymbol → slice(페이징)` 순서. 필터된 데이터만 그룹핑되므로 요약이 필터 결과와 항상 일치. Reviewer 재현 완료 |
| E17 | `git status --porcelain -- src/lib/safety src/lib/exchanges ...` → 공백 | ✓ | 실제 실행 → 공백 |
| E18 | HEAD `2fbfefb` 불변, 실 커밋 0회 | ✓ | `git log --oneline -1` → `2fbfefb` |

- [15:19] 빌드·테스트 실행: `npm test` (100/100 suites, 1513/1513 tests PASS) / `npm run typecheck` (0 에러) / `npm run build` (성공, `/analytics` 정적○ 유지)
- [15:19] A. 빌드·테스트 3개 항목: 모두 통과 ✓
- [15:19] B. 사양 준수 6개 항목: OrderHistoryTab·RecentExecutionsSection·SymbolGroupHeader·group-orders.ts 코드 직접 검증 완료. 모두 확정 결정 6건 반영됨 ✓
- [15:19] C. 엣지케이스 3개 항목: group-orders.test.ts의 35개 테스트 전부 통과. 0건·1건·혼재·날짜경계·이상값·결측 케이스 모두 커버 ✓
- [15:19] D. 회귀 4개 항목: 필터 칩·요약 바·바텀시트 로직 무변경 재확인. **필터 상태에서 그룹 요약 정확성**(T-026 핵심) = `filtered → group → slice` 순서로 재해석 완료 ✓
- [15:19] E. 무결성 2개 항목: 안전경로 무변경(git status 공백), HEAD 불변(2fbfefb), 커밋 0회 ✓

**18개 지시받은 항목 100% 실행 완료.**

**검증 판정: ✅ 검증 통과**

발견된 결함: 0건 (Critical 0 / High 0 / Medium 0 / Low 0)
- Reviewer가 발견한 LOW 2건(UI 힌트 제안 & `normalizeSymbol` trim 보강)은 이번 릴리스 차단 사유 아님. 기존 스코프 준수.

**다음 단계**: Leader에게 최종 보고, 사용자 승인 대기 후 배포.

## 최종 요약 (사용자용 — Leader가 전체 작업 종료 후 한 번에 작성)

## 🟢 사용자 결정 확정 (2026-08-16, Leader)

착수 전 UI 목업 합의 완료. 결정 6건 확정:

| # | 항목 | 결정 |
|---|---|---|
| 1 | 그룹 접힘 기준 | **항상 그룹 + 기본 접힘** (1건짜리도 그룹으로) |
| 2 | 단일 주문 종목 | 1번 결정으로 해소 — 예외 없이 그룹 |
| 3 | 페이지네이션 단위 | **날짜 단위 페이징** (그룹핑을 페이징보다 먼저) |
| 4 | 대시보드 표시 범위 | 현행 10건 유지 (Leader 기본값, 사용자 이의 없음) |
| 5 | 그룹 요약 정보 | **건수 + 시각범위만** (매수/매도 구성·합계금액 미포함) |
| 6 | 1건일 때 시각 표기 | 범위 대신 **단일 시각** (`1건 · 10:05`) |

**확정 설계**: 그룹핑을 순수 함수 `src/lib/orders/group-orders.ts` 로 분리해 두 화면이 공유.
`RecentExecutionsSection` 을 `Dashboard.tsx`(1257줄)에서 별도 파일로 분리. 종목명 표기는
`useSymbolMeta()` 로 통일하고 대시보드 자체 `fmtSymbol()` 은 제거. 그룹 헤더는
`<button aria-expanded>`. `docs/screens.md` 선수정 후 코드 반영.

참고: `src/lib/orders/` 는 SAFETY_PATHS 에 없어 이 작업은 commit-msg 훅 게이트 대상이 아니다
(순수 표시 계층). 그래도 프로젝트 표준 순환(Developer→Reviewer→QA)은 그대로 따른다.

---

## 최종 요약 (사용자용 — Leader 작성, 2026-08-16)

주문이 많아지면 거래이력·대시보드가 평면 리스트라 같은 종목이 흩어져 보이던 문제를,
**날짜 → 종목 2단 그룹 + 접기/펼치기**로 바꿨다. 그룹 헤더에 `3건 · 09:12~14:30`처럼
건수와 시각범위를 요약해 펼치지 않아도 그날 그 종목에 무슨 일이 있었는지 보이게 했다.

**핵심은 화면이 아니라 정확성이었다.** 거래이력은 원래 주문 7건씩 자른 **뒤에** 그룹핑해서,
종목 그룹을 그대로 얹었으면 "3건(09:12~09:20)" 같은 요약이 **페이지 경계 때문에 실제와 다른
값**을 보여줬을 것이다. 순서를 뒤집어 `필터 → 그룹핑 → 날짜 단위 페이징`으로 바꿨고, 필터가
걸린 상태에서도 요약 수치가 필터 결과와 일치하는 것을 회귀 테스트로 고정했다.

그룹핑 로직은 순수 함수(`src/lib/orders/group-orders.ts`)로 분리해 두 화면이 공유한다.
`created_at`이 깨졌거나 `symbol`이 비어 있어도 **주문이 조용히 사라지지 않고** `(날짜 미상)`
`(알 수 없음)` 그룹으로 모인다. 감사 중 나온 지적으로 공백 섞인 동일 심볼(`' 005930 '`)이
다른 그룹으로 쪼개지던 것도 함께 고쳤다. 곁들여 `Dashboard.tsx`를 1257→1171줄로 줄였다.

**검증**: 100 suites / 1517 tests 전부 통과(신규 39건, 회귀 0) · typecheck 0에러 · build 성공
(`/analytics` 정적 유지). 실매매 코드(`src/lib/safety/`·`exchanges/`·`signals/`·`strategy/`·
`src/app/api/`)는 전 과정에서 **한 줄도 바뀌지 않았다**. 순환은 Developer 2라운드 →
Reviewer 2라운드(둘 다 pass) → QA(검증 통과) 완료.

### ✅ 사용자 확인 완료 (2026-08-18)

**갤럭시 S25+ 크롬 실기기 육안 확인 — 헤더 줄바꿈 없이 한 줄 정상 표시.** Reviewer의 폭 추정
(소요폭 ≈185px vs 가용폭 ≈384px)이 실측으로도 확인됐다. 이 task의 마지막 미확인 항목이 해소돼
완전히 종결됐다.

### Leader 판단 — QA 전체 재순환 생략

LOW 2건 수정 후 QA 전체 재순환은 **하지 않았다.** 사유: ① 변경이 파일 2개 + 문서 1개의 표시
계층 미세 보강 ② Reviewer 라운드2가 전체 스위트·typecheck·build를 **독립 실행**해 수치까지
대조했고 Leader 도 `npx jest src/lib/orders`(39/39)·typecheck 를 직접 재현 ③ QA 가 추가로
확정할 수 있었던 유일한 항목(412px 육안)은 **에이전트가 원래 수행 불가**하고 위와 같이
사용자에게 넘겼다. 재순환을 원하면 알려주면 QA 를 다시 돌린다.
