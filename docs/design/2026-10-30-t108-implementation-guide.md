---
project: StockInvest
task: T-108
created: 2026-10-30
status: guide-v1
author: designer
approved_demo: mockups/T-108-menu-home-v3.html
approved_demo_sha256: f3230e69cd05df1c7c7fdcfab74aad20a048a33dc5f740d63a6775f144d8a0a5
tags: [type/design, domain/ui, domain/analytics]
---

# T-108 메뉴·홈·거래·분석·설정 개편 — 구현 가이드

승인 데모: `mockups/T-108-menu-home-v3.html` (v3, sha256 `f3230e69cd05…` — 이 가이드 작성 중 다시 계산해 일치 확인 [확실]) · 사용자 승인 2026-10-30 21:05 · 「결정 필요」 7건 전부 A 확정 21:15.
적용 토큰(이름만, 값은 `src/app/globals.css`): `--bg` `--bg2` `--bg3` `--bg4` `--border` `--border2` `--text` `--muted` `--up` `--down` `--accent` `--ok` `--warn` `--danger` `--safe-top` `--safe-bottom` `--nav-h`. 데모 토큰 스냅샷 해시 `04e7b5bc8394` = 현재 `globals.css` sha256 앞 12자 [확실]. **새 토큰 없음 — `globals.css` 는 바꾸지 않는다.**

이 문서가 Developer 의 유일한 설계 입력이다. 데모와 이 문서가 다르면 **이 문서**(데모를 코드로 옮길 때의 해석)를 따르고, 이 문서와 데모가 둘 다 말하지 않는 것은 §8 「정해도 되는 것」 범위 안에서만 정한다. 확신 태그: `[확실]` 이번에 직접 읽거나 실행해 확인 · `[가능성 높음]` 강한 추론 · `[추측]` 미확인.

---

## 0. 머리말

### 0.1 먼저 — 불편한 사실 6개

1. **[확실] 데모의 「승인 시트」는 지금 코드에 없는 화면이다. 지금 웹 승인은 `/recommend/[id]`(`ScenarioDetail`, 전체 화면)에서 회차·수량을 편집한 뒤 `POST /api/signals/custom/confirm` 으로 나간다**(`ScenarioDetail.tsx:337`). 데모 E 절 「행동」 행은 "승인·거절·감시 취소는 … 기존 흐름 그대로"라고 적었고 시트 안에도 "진입 구간·수량 편집은 기존 시나리오 상세 화면 그대로"라고 적었다. → **이 가이드는 시트를 새로 만들지 않는다.** [상세 · 승인] 은 기존 `/recommend/[id]` 로 이동하고, 데모 시트의 결과 상태 6종(처리 중·성공·실패·네트워크 오류·차단·거절)과 문구는 `ScenarioDetail` 의 승인·거절 결과 표시에 옮긴다(§2.4.3). API·요청 본문은 한 글자도 바꾸지 않는다. 감시 취소만 `window.confirm` → 확인 대화상자(`components/ui/Sheet.tsx`)로 바뀐다(같은 `DELETE /api/signals/{id}`).
2. **[확실] 데모가 그린 탭만으로는 지금 분석 8탭 중 5개(포트폴리오·포지션 추적·투자일지·놓친 기회·신호 진단)로 가는 입구가 없다.** 데모는 거래·분석을 "정보 구조와 주요 영역 수준"으로만 그렸다. 기능을 잃지 않게 §1.2 에 상세 보기 입구(행 링크 5개)를 Designer 가 정했다 — 새 시각 요소가 아니라 데모의 `row()`·`lnk()` 모양 그대로다. **`/markets`(시장 상태 상세)는 지금 홈의 시장 배지가 유일한 입구인데 승인 데모 홈에 배지가 없다** → v1 은 입구가 사라진다(URL 직접 접근만). §9 L-1 에서 Leader 가 정한다.
3. **[확실] 설정 화면은 통합 계획상 T-104 WP5 가 먼저 고치기로 돼 있다**(T-104 task 135행 · `status: planned`, 미구현). T-108 을 오늘 밤 먼저 하면 순서가 뒤집힌다 → T-108 은 `SettingsPage.tsx` 에서 **문구 줄만** 바꾸고(구조·토글·저장 흐름 0), T-104 WP5 가 그 위에 다시 얹는다(충돌 최소화).
4. **[확실] 텔레그램·경보 문구(「킬스위치」「하드 손절」「EOD 손절」「DRY_RUN」)는 전부 커밋 훅 `SAFETY_PATHS` 안 파일(`src/lib/signals/`·`src/lib/safety/`·`src/lib/strategy/`)에 있다.** 문구만 바꿔도 Reviewer 판정 줄(scope)이 필요하고 기존 시험(`approval-message.test.ts`·`telegram-approval.test.ts`)의 기대 문자열이 바뀐다. 화면 작업과 섞지 않고 **WP-D 로 따로 커밋**한다(§3.3). 오늘 밤 범위에 넣을지는 §9 L-2.
5. **[확실] 지금 운영 데이터로는 홈 관찰 지표의 절반이 「◌ 미수집/준비 중」으로 나온다.** `job_run_log` 는 10-30 21:05:27 부터만 쌓이고(장마감 분석 첫 행: 해외 10-31 08:00, 국내 11-02(월) 16:00), `judgment_record_enabled` 는 꺼져 있어 `judgment_run`·`judgment_candidate` 는 비어 있다. 배포 직후 홈은 데모 「첫 배포」 상태에 가깝다 — 이것이 정상이며 빈 칸을 0 으로 채우면 결함이다.
6. **[확실] `GET /api/settings/safety` 는 읽기 라우트가 아니다** — `seedIfEmpty()`(34~54행)가 `safety_%` 키가 0개면 INSERT 한다. 홈·거래의 안전 상태 띠는 이 라우트를 **부르지 않고** 새 읽기 전용 라우트(§4.2)를 쓴다. 기존 설정 화면은 그대로 이 라우트를 쓴다.

### 0.2 확정 결정 요약 (다시 묻지 않는다)

| 구분 | 확정 내용 | 근거 |
|---|---|---|
| ① 하단 탭 | 홈·거래·분석·(비서)·설정. **T-113 배포 전 4칸** = 홈·거래·분석·설정 | 데모 D ①A, task 21:15 |
| ② 홈 순서 | 띠 → 확인 필요 → 운용현황 → 청산 로직 → 오늘의 분석 → 최근 활동. 지표 2×2, 칸 안 국내·해외 두 줄 | D ②A |
| ③ 분석 3분류 | 오늘 분석 · 검증·성과 · 데이터 상태 | D ③A |
| ④ 거래 하위 | 운용 현황 · 보유·주문 · 운영 기록, 기본 = 운용 현황, `?tab=` 딥링크 | D ④A |
| ⑤ 비서 범위 | 운영 기록만, 계좌 보유는 종목 수까지 — **이번 구현 범위 밖(탭 숨김)** | D ⑤A |
| ⑥ 청산 로직 | 운용현황 바로 아래 독립 영역, 0 이어도 항상 | D ⑥A |
| ⑦ 깔때기 토글 | 거래 › 운영 기록 머리 국내/해외 세그먼트, 기본 = 마지막 세션이 더 최근인 시장 | D ⑦A |
| D1 | 홈 「분석」 = 장마감 AI 분석만 + 「청산 로직」 지표 신설 | 계약 §7·§11 |
| D2 | 「오늘」 = 시장별 세션일(국내 KST, 해외 ET) | 계약 §7 |
| D3 | 앱 밖 보유는 계좌 전체로만 — 「자동 운용 0 / 계좌 보유 N」 | 계약 §7 |
| D4 | 운용액 = 설정에서 사용자가 배정, 입력 전 「미설정」 (입력 화면은 이번 범위 밖) | 계약 §7 |
| D5 | 손익 기준 = 실거래 전환일 첫 스냅샷, 관찰 기간 홈 손익 미표시 | 계약 §7 |
| D6 | 가동률 분자 = `ok` 만 | 계약 §7 |
| D7 | 사후 성과 기본 진입 = `d1open` | 계약 §7 |
| D8 | `detected` 는 승인 대기에서 분리(「관측 기록」) — 홈·거래 같은 집합 | 계약 §7 |
| D9 | USD 환산엔 환율 시각 + stale/fallback 표지 필수 | 계약 §7 |
| D11 | 청산 판단 영구 보존은 T-126(이번 아님) | 계약 §11.8 |
| D12 | 「손실한도 손절 OFF — 한도 도달 N종목 · N일째」(틱 수 아님) | 계약 §11.8 |
| D13 | 가상 청산은 「오늘 체결」에서 분리 | 계약 §11.8 |
| D14 | 홈 청산 = X1 + X3 요약 + X4 건수 3줄 | 계약 §11.8 |
| 용어 7건 | 시그널 · 건수 적음 · 장마감 전 손절 · AI 매수 판단 · 실거래여부 · 모든거래차단 · 손실한도 손절 (+ 가상 주문·가상 청산) | 계약 §12, 데모 F 절 |

### 0.3 하지 않는 것

- **비서 탭 노출 없음**(T-113 대화 소유권 전). `/ai` 라우트·`ChatPage.tsx`·채팅 API 는 그대로 두고 손대지 않는다.
- **주문·승인·거절·취소·스위치·설정의 쓰기 동작 변경 없음.** 기존 API(`/api/signals/custom/confirm`·`/api/signals/[id]/reject`·`DELETE /api/signals/[id]`·`PATCH /api/settings/safety` 등) 호출 지점·요청 본문·확인 단계 그대로. 새 라우트는 전부 `GET` 읽기 전용.
- **DDL·새 테이블·마이그레이션·`db.ts` 변경 없음.** 이미 있는 `job_run_log`·`judgment_run`·`judgment_candidate` 를 읽기만 한다.
- **안전 로직 변경 없음** — `src/lib/safety/**`·`src/lib/strategy/**`·`src/lib/signals/**` 의 판정 코드는 바꾸지 않는다(예외: §3.5 의 순수 표시 함수 신규 1파일, WP-D 의 문구 문자열).
- **새 URL 은 `src/app/api/ops/*` 읽기 라우트 5개뿐.** 화면 경로는 새로 만들지 않는다(`/trade` 없음).
- **네이티브 변경 없음** — `capacitor.config.ts`·`android/**`·`public/app-shell/index.html` 변경 0 (§1.3).
- `lucide-react` 의존성 추가 없음(§1.1 — 원본 경로 인라인).
- 운용액 입력 화면, 손익 기준 재설정 흐름 신설, 자동매매 손익(B4) 원가·대사 연결(T-081 D2), 청산 판단 영구 기록(T-126) — 모두 이번 범위 밖.

### 0.4 레이아웃 설계 (page-layout-designer 7항목 — 데모 E 절을 구현 언어로)

| 항목 | 내용 |
|---|---|
| 목표 | 「분석이 정상으로 도는가 → 무엇을 확인해야 하나 → 자금·거래·보유 위험」을 홈 한 화면에서. 종목 탐색·조작은 다른 탭 |
| 첫 위계 | 안전 상태 띠(단계·실거래여부·모든거래차단·검증 통과·청산 엔진·손실한도 손절) → 확인 필요 → 단계별 지표 |
| 영역 | 홈 6영역 · 거래 3칸 · 분석 3칸 · 설정 1페이지(기존) |
| 컴포넌트 | §2.0 목록 |
| 상태 | 단계 4종(관찰·중지·혼합·실거래) + 확인 실패 × 데이터 상태(정상·첫 배포·빈·로딩·조회 실패·오래됨) + 인증 만료(401) · 연결 끊김(네트워크) |
| 행동 | 홈 = 이동만(위험 CTA 없음). 승인·거절 = 기존 `ScenarioDetail`. 감시 취소 = 확인 대화상자 |
| 반응형 | 360~412px 한 열·2×2 칸. `@media (min-width: 900px)` 두 열(왼쪽 확인 필요·운용현황·청산 / 오른쪽 분석·활동), 하단 바 가운데 720px, 대화상자 가운데. 데모의 `@container app` 은 `@media` 로 바꾼다(T-084 선례) |

---

## 1. 내비게이션·라우트

### 1.1 하단 탭 — `src/components/BottomTabs.tsx` (WP-B 단독 소유)

| 순서 | 라벨 | 경로 | 활성 조건(`pathname`) | 아이콘(Lucide 원본) |
|---|---|---|---|---|
| 1 | 홈 | `/` | `=== '/'` | `stone` |
| 2 | 거래 | `/recommend` | `startsWith('/recommend')` · `startsWith('/strategy')` · `=== '/order'` | `handshake` |
| 3 | 분석 | `/analytics` | `startsWith('/analytics')` · `startsWith('/favorites')` | `scan-search` |
| 4 | 설정 | `/settings` | `startsWith('/settings')` · `startsWith('/profile')` | `settings` |

- 4칸 `grid-template-columns: repeat(4, 1fr)`. 비서(`brain`) 정의는 배열에 **두지 않는다**(데모의 「보류」 칸은 비교용 — E 절 8). T-113 때 4번째에 끼운다.
- 아이콘: 데모 v3 529~534행의 SVG `<path>`·`<circle>` 를 그대로 옮긴 `src/components/nav/NavIcons.tsx`(신규, WP-B). 파일 머리에 `lucide-react 1.24.0 (ISC) 원본 경로` 주석. 도형 수 stone 3·handshake 5·scan-search 6·settings 2 [확실: 데모 소스]. `viewBox 0 0 24 24`, 22px, `fill:none; stroke:currentColor; stroke-width:2; round`.
- 스타일(데모 236~242행): 라벨 **11px**(지금 10px — E 절 7), `font-weight:600`, 비활성 `--muted`, 활성 `--accent` + 위쪽 2px 막대(`::before` 대신 `<span aria-hidden>` 로 그려도 됨). `aria-current="page"` 는 활성 링크에만. `nav aria-label="주 메뉴"`.
- `≥900px`: 바를 가운데 720px, 위 모서리 둥글게(데모 280행).
- **그대로 둘 것**: `HIDDEN_PATHS` 배열 값·export 이름(`app-shell-render.test.ts:84` 가 동일성 검사), `position: fixed`, 높이 `calc(var(--nav-h) + var(--safe-bottom))`, `emphasize` 개념은 삭제(가운데 강조 없음).

### 1.2 라우트 매핑 — 기존 URL 은 하나도 404 가 되지 않는다

| 기존 URL | 새 위치 | 처리 |
|---|---|---|
| `/` | 홈 | 같은 경로, `Dashboard` → `HomeScreen` 교체 |
| `/recommend` | 거래 › 운용 현황 | 같은 경로, 페이지 본문을 세그먼트 컨테이너로 |
| `/recommend?tab=now\|hold\|log` | 거래 › 각 세그먼트 | 새 파라미터(없으면 `now`) |
| `/recommend?tab=log&detail=orders` | 거래 › 운영 기록 › 주문 기록 전체(`OrderHistoryTab`) | 새 |
| `/recommend?tab=log&detail=notes` | 거래 › 운영 기록 › 투자일지(`TradeJournalTab`) | 새 |
| `/recommend?tab=hold&detail=trailing` | 거래 › 보유·주문 › 포지션 추적(`TrailingStopTab`) | 새 |
| `/recommend/[id]`, `/recommend/build` | 그대로(거래 탭 활성) | 변경 없음(§2.4.3 결과 표시만) |
| `/strategy`, `/order`(→`/strategy`) | 그대로(거래 탭 활성) | 변경 없음 |
| `/analytics` | 분석 › 오늘 분석 | 기본 세그먼트가 `research` → `today` 로 바뀜 |
| `/analytics?tab=today\|verify\|data` | 분석 › 각 세그먼트 | 새 |
| `/analytics?tab=research` · `leaderboard` | 분석(오늘 분석 강조) › 상세: 리서치분석 · 주도주 | 기존 컴포넌트 그대로 |
| `/analytics?tab=missed` · `diagnostics` · `portfolio` | 분석(검증·성과 강조) › 상세: 놓친 기회 · 신호 진단 · 포트폴리오 | 기존 컴포넌트 그대로 |
| `/analytics?tab=orders` | → `/recommend?tab=log&detail=orders` | 클라이언트 `router.replace` |
| `/analytics?tab=notes` | → `/recommend?tab=log&detail=notes` | 〃 |
| `/analytics?tab=trailing` | → `/recommend?tab=hold&detail=trailing` | 〃 |
| `/analytics?tab=<그 밖>` | 분석 › 오늘 분석 | 조용히 기본값 |
| `/favorites`, `/favorites/[symbol]` | 그대로(분석 탭 활성) | 입구 = 분석 › 오늘 분석 › 종목별 「관심 종목 관리」 |
| `/ai` | 그대로(탭 없음, 활성 없음) | 변경 없음 |
| `/settings`, `/settings#app`, `/settings/*`, `/profile` | 그대로 | 문구만 |
| `/markets` | 그대로(탭 활성 없음) | **입구 없음 — §9 L-1** |

- 해석은 순수 함수 2개로 한다(WP-C, 시험 대상): `resolveAnalyticsRoute(tab: string | null): { kind:'segment', seg } | { kind:'detail', seg, detail } | { kind:'redirect', href }` · `resolveTradeRoute(tab, detail)`. 지금처럼 **마운트 후 `window.location.search` 1회 읽기**(`AnalyticsPage.tsx` 주석의 hydration 이유 유지)로 시작하고, 세그먼트를 누르면 `router.replace('?tab=…', { scroll: false })` 로 URL 을 맞춘다(뒤로 가기 이력 쌓지 않음).
- 상세 보기 머리: `‹ {세그먼트 이름}` 버튼(44px, 누르면 `?tab={seg}`) + 제목. 상세 안은 기존 컴포넌트를 **수정 없이** 렌더(문구 정정 §3 만 예외).
- 상세 입구(불편한 사실 2 — Designer 결정, 데모의 행 모양 그대로):
  - 분석 › 검증·성과 「사후 성과」 foot 아래 행: `놓친 기회 — AI 매수 안 함·거절 시그널의 이후 가격 ›` → `?tab=missed`
  - 분석 › 검증·성과 「후보·제외 사유 추이」 행: `신호 진단 ›` → `?tab=diagnostics`
  - 분석 › 검증·성과 「실거래 성과」 행: `포트폴리오 · 자산 추이 (계좌 전체) ›` → `?tab=portfolio`
  - 거래 › 운영 기록 「주문 기록」 머리 `전체 ›` → `?tab=log&detail=orders`, 「내 결정」 아래 행 `투자일지 ›` → `?tab=log&detail=notes`
  - 거래 › 보유·주문 「보유」 foot 아래 행 `포지션 추적 (청산 기준·고점) ›` → `?tab=hold&detail=trailing`

### 1.3 텔레그램·앱 링크·앱 셸 영향 — 네이티브 변경 0

- [확실] 서버가 만드는 앱 링크는 `system_config.app_public_url`(사이트 루트) 하나뿐이다(`approval-message.ts:183·285` 「🔗 앱에서 자세히」, `approval-notify.ts:280`, `telegram-poller.ts:220`). 경로를 붙이지 않는다 → 홈 `/` 유지로 호환.
- [확실] App Links intent-filter 는 `android:path="/"` 정확 일치 하나(`AndroidManifest.xml:83`), `appLink.ts` `APP_LINK_PATH='/'`. 이 개편은 `/` 를 유지하므로 Manifest·assetlinks·`appLink.ts` 를 건드리지 않는다.
- [확실] 지금 작업 트리에서 `capacitor.config.ts`·`android/**`·`public/app-shell/index.html` 의 `git diff` 는 비어 있다. **완료 기준**: 커밋 전 `git diff --stat main -- capacitor.config.ts android public/app-shell` 결과 0줄(§7).
- 앱 분기(`window.Capacitor`): 새 화면은 앱/웹을 가르지 않는다. `AppUpdateBanner`(레이아웃, 문서 흐름 맨 위)·`AppLinkNavigator`(레이아웃 `{children}` 뒤) 배치는 그대로 — `layout.tsx` 는 바꾸지 않는다. 안전 띠는 `position: sticky; top: 0` 이고 업데이트 띠는 문서 흐름이라 겹치지 않는다(띠가 스크롤되어 지나간 뒤 안전 띠가 붙는다).
- safe-area: [확실] 지금 홈 상단(`Dashboard.tsx` `sx.top`)은 `--safe-top` 을 쓰지 않는다. 안전 띠도 쓰지 않는다(같은 동작 유지). 하단은 기존 `--safe-bottom` 그대로.

---

## 2. 화면별 사양

### 2.0 공용 컴포넌트 (WP-B 가 먼저 만든다 — `src/components/ops/ui/`)

스타일은 CSS Module 하나 `src/components/ops/ops.module.css` 에 데모 140~286행의 **앱 화면 클래스**(`.strip` `.stage` `.sw` `.scr` `.col` `.sec` `.sec-h` `.lnk` `.grid2` `.tile` `.st` `.rows` `.rowl` `.empty` `.lines` `.ln` `.mt` `.act` `.seg2` `.subnav` `.btn` `.card` `.pill` `.kv` `.retry` `.skel` `.spin` …)를 이름 그대로 옮긴다(데모 문서 틀 `.page` `.controls` `.decide` 등은 옮기지 않음). 데모의 리터럴 색(`#fca5a5` `#86efac` `#2a1416` `rgba(…)`)은 그대로 — 새 토큰이 아니라 모듈 내부 값. `.num` 은 `globals.css` 에 이미 있으니 전역 클래스를 쓴다.

| 컴포넌트 | props (초안) | 데모 출처 | 비고 |
|---|---|---|---|
| `SafetyStrip` | `{ state: SafetyStateView }` | `strip()` 568~602 | 홈·거래 공통, sticky |
| `MiniStrip` | `{ title: string; state: SafetyStateView }` | `miniStrip()` 729~735 | 분석·설정 머리, 단계 배지 누르면 `/` |
| `Section` | `{ id; title; small?; link?: ReactNode; foot?: ReactNode; children }` | `sec()` 562 | `<section aria-labelledby>` |
| `SectionLink` | `{ href; children; ariaLabel? }` | `lnk()` 565 | `next/link`, 44px, 끝에 ` ›` |
| `MetricTile` | `{ label; value?: ReactNode; lines?: ReactNode[]; chip?: ReactNode; meta?: ReactNode; wide?; dim? }` | `tile()` 542 | 로딩은 `SkeletonTile` |
| `StatusChip` | `{ kind: ChipKind; children }` — `ChipKind = 'zero'\|'unknown'\|'error'\|'stale'\|'partial'\|'blocked'\|'off'\|'prep'` | `st()` 538 · C 절 | 글자+테두리 모양, 색만 쓰지 않음 |
| `CheckRow` | `{ severity: 'e'\|'w'\|'i'\|'n'; glyph; title; sub?; href? }` | `row()` 555 | href 있으면 `<Link>` 56px |
| `LineList` | `{ lines: { k: string; d: ReactNode }[] }` | `.lines/.ln` | 청산 로직 3줄 |
| `StageTable` | `{ caption; head: [string, string?, string?]; rows; dim? }` | `anaTable()` 689 | 국내·해외 두 열 |
| `ActivityList` | `{ items: { time; title; sub }[] }` | `actSec()` 708 | |
| `SegmentControl` | `{ label; items: {id; text}[]; value; onChange }` | `subnav()` 724 · `.seg2` | `role="group"` + `aria-pressed`, 44px |
| `RetryButton` | `{ onClick }` | `.retry` | 「다시 시도」 |

### 2.1 공통 서식

| 대상 | 규칙 | 예 |
|---|---|---|
| 원화 | `₩` + `toLocaleString('ko-KR')`, 소수 없음 | `₩1,240,000` |
| 달러 | `$` + 소수 2자리 | `$310.00` |
| 원화 환산 | `≈ ₩…` 를 달러 뒤에, **환율 시각이 있을 때만**. fallback·24h 초과면 환산 숨기고 meta 에 사유 | `$310.00 ≈ ₩431,600` / `환율 1,380.0 기본값(fallback) — 원화 환산 숨김` |
| 손익 금액 | 부호 + 색(`--up`/`--down`) + 글자 `(이익)`/`(손실)` — 색만으로 구분 금지 | `+₩12,300 (이익)` |
| 손익률 | 소수 1자리, 음수는 `−`(U+2212) | `−2.1%` |
| 시각 | KST `HH:MM`. 날짜가 오늘이 아니면 `MM-DD HH:MM` | `16:00` · `10-29 16:05` |
| 해외 세션일 | `ET MM-DD` | `ET 10-29` |
| 건수 | 정수 + 단위(`건`/`종목`) | `44종목` |
| 「확인된 0」 | 값 `0` + `StatusChip zero` `✓ 확인된 0`(또는 문맥 문구 `✓ 이상 없음`) | |
| 값 없음 | 값 자리 `—` + 사유 칩. **0 으로 쓰지 않는다** | |

상태 칩 문구(데모 C 절 그대로): `✓ 확인된 0` · `◌ 미수집` · `! 조회 실패 · {code}` · `오래됨 · 기준 {시각}` · `건수 적음 · {n}건 (30건 미만)` · `⊘ 차단 · {사유}` · `장외 · 개장 {시각} KST` · `준비 중 · {무엇} 뒤`.

### 2.2 안전 상태 띠 — 단계 파생과 문구

단계는 서버가 정한다(§4.2 `deriveOpsStage`, 우선순위 위→아래, 첫 일치):

| 단계 | 조건 | 배지(`.stage` 클래스) | 요약 문구 | 칩(순서대로) |
|---|---|---|---|---|
| `unknown` | 안전 값 중 하나라도 읽기 실패 | `err` `! 확인 실패` | **안전 상태를 불러오지 못했습니다** — 주문 송신 여부를 알 수 없습니다 · 마지막 확인 {HH:MM} | 4칩 모두 `—`, [다시] 버튼 (`role="alert"`) |
| `halt` | `killSwitch === true` | `halt` `중지 (모든거래차단)` | **모든 주문 차단** — 매수·매도·청산 송신 안 함 | 모든거래차단 `ON · 모든 주문 차단`(bad) · 실거래여부 · 검증 통과 · 청산 엔진 `ON (송신 차단)` · 손실한도 손절 |
| `observe` | `liveTrading === false` | `obs` `관찰 (실거래 차단)` | **신규 매수 차단** — 검증 통과 전략 {v}/{t} · 주문은 기록만(실거래여부 OFF) — 검증 통과 ≥1 이면 앞부분 대신 **신규 매수 기록만** | 실거래여부 `OFF · 실거래 차단` · 모든거래차단 `OFF` · 검증 통과 `{v}/{t}`(v=0 이면 warn) · 청산 엔진 · 손실한도 손절(OFF 면 warn) |
| `mixed` | `liveTrading === true` ∧ `validatedEnabled === 0` | `mixed` `실거래 준비 — 매수 차단` | 검증 통과 전략 {v}/{t} 이라 **신규 매수 차단** | 실거래여부 `ON · 실거래 가능`(bad) · … · 청산 엔진 `ON · 실주문`(bad) + 아래 빨간 줄 「**청산 주문은 실제로 송신됩니다.** 청산 엔진은 검증 관문과 무관합니다 — 원치 않으면 설정 › 안전장치.」(청산 엔진 ON 일 때만) |
| `live` | 나머지(`liveTrading` ∧ ¬kill ∧ `validatedEnabled ≥ 1`) | `live` `실거래` | **실거래 가능** — 검증 통과 {v}/{t} 전략만 신규 매수 | 실거래여부 `ON · 실거래 가능`(bad) · 모든거래차단 `OFF` · 검증 통과 · 청산 엔진 · 손실한도 손절 |

- 청산 엔진 칩: `exitEngine.enabled` ON/OFF. OFF 는 `bad` 테두리 + `OFF · 자동 청산 없음`. `source==='db_error'` 면 `—`.
- 손실한도 손절 칩: 청산 엔진 ON 일 때만 의미 — 엔진 OFF 면 칩 `— (엔진 OFF)`.
- 우측 `설정 ›` 링크(44px) → `/settings`. 로딩: 스피너 + 「안전 상태 확인 중…」(`aria-busy`). 30초마다 다시 읽고, 실패하면 마지막 값을 쓰지 않고 `unknown` 으로 바꾼다(안전 표시는 오래된 값을 보여 주지 않는다 — 다른 지표의 「오래됨」 규칙과 다름).
- **[확실] `halt` 가 `observe` 보다 앞**: 모든거래차단 ON 이면 실거래여부와 무관하게 모든 송신이 막힌다(`dry-run.ts:180` 이 DRY_RUN 분기보다 앞). 데모 DESC 의 "관찰 = 실거래여부 OFF 또는 모든거래차단 ON 또는 검증 통과 0" 은 지표 세트(A) 기준이고, 띠 라벨은 이 표가 정본이다(E 절 3).

### 2.3 홈 — `src/components/home/HomeScreen.tsx` (WP-B)

**섹션 순서(고정)**: `SafetyStrip` → 확인 필요 → 운용현황 → 청산 로직 → 오늘의 분석·판단 → 최근 활동. `≥900px` 은 왼쪽 열(확인 필요·운용현황·청산) / 오른쪽 열(분석·활동).
**데이터**: `GET /api/ops/home`(§4.3) 하나 + `GET /api/ops/safety-state`(§4.2). 60초 재조회 + `visibilitychange`(보일 때) + 각 섹션 [다시 시도]. **KIS 호출 없음**(관찰·중지 단계) — 지금 홈의 `/api/portfolio`·`/api/ticker/*`·`/api/candles` 호출은 모두 사라진다.
**지표 세트 선택**: `stage ∈ {observe, halt, unknown}` → 관찰 세트(A), `stage ∈ {mixed, live}` → 실거래 세트(B).

#### 2.3.1 데이터 상태 6종 — 실제 앱에서 무엇이 그 상태를 만드는가

데모의 「데이터 상태」 버튼은 앱에 없다. 각 상태는 섹션·지표마다 독립으로 생긴다.

| 데모 상태 | 앱에서의 조건 | 표시 |
|---|---|---|
| 정상 | 지표 `state='available'` | 값 |
| 첫 배포 | 원천 테이블은 있으나 해당 세션 행 없음(`unknown`) 또는 기능 스위치 꺼짐(`prep`) | `◌ 미수집 — 실행 기록 전` / `준비 중 · T-112 기록 뒤` |
| 빈 | `state='zero'` — 조회 성공 + 0 | `0` + `✓ 확인된 0` |
| 로딩 | 첫 응답 전 | `SkeletonTile`·`aria-busy` |
| 조회 실패 | HTTP 오류·`section.state='error'`·네트워크 오류 | `—` + `! 조회 실패 · {code}` + [다시 시도]. 「비어 있는 것이 아닙니다」 문구는 확인 필요에만 |
| 오래됨 | 지표 `state='stale'` | 값 회색(`.tile.dim`) + `오래됨 · 기준 {asOf}` |

- 재조회가 실패하면 마지막 성공 응답을 **오래됨으로** 남긴다(값 회색 + `오래됨 · 기준 {마지막 성공 시각}` + foot `새로 고치지 못했습니다`). 첫 응답부터 실패면 조회 실패.
- `401` → 칩 `! 조회 실패 · unauthorized` + foot 「다시 로그인해 주세요」 링크(`/login`). 네트워크 오류 코드 `network`.

#### 2.3.2 확인 필요 — 줄 규칙 (서버 `checks[]` → 클라이언트 문구)

순서는 아래 표 순서 고정. 줄 높이 56px, `href` 로 이동. 0 건이면 빈 상태 문구 한 줄.

| # | `kind` (서버) | 조건 | glyph·severity | 제목 / 부제 (데모 문구) | 이동 |
|---|---|---|---|---|---|
| 1 | `kill_switch_on` | stage=halt | `!` e | 모든거래차단 ON — 모든 주문 차단 / 오늘 {HH:MM} 부터 · 청산 시그널 {n}건도 송신 안 됨 | `/settings` |
| 2 | `exit_live_orders` | stage=mixed ∧ 청산 엔진 ON | `!` e | 청산 주문이 실제로 송신됩니다 / 실거래여부 ON · 오늘 청산 체결 {n}건 | `/recommend?tab=log` |
| 3 | `buy_blocked` | stage=mixed | `⊘` w | 신규 매수 차단 — 검증 통과 전략 {v}/{t} / 매수 시그널은 차단 기록으로만 남습니다 | `/recommend?tab=now` |
| 4 | `awaiting_approval` | 승인 대기 COUNT ≥1 (**모든 단계**) | `{n}` w | 승인 대기 {n}건 — 국내 {d} · 해외 {o} / 가장 빨리 만료: {종목} {MM-DD HH:MM} | `/recommend?tab=now` |
| 5 | `order_rejected` | 오늘(세션일) `orders.status IN ('rejected','failed')` ≥1 | `!` e | 주문 거부 {n}건 — {종목} {매수/매도} / {사유 요약} · 재시도하지 않음 | `/recommend?tab=log` |
| 6 | `hard_stop_off_hit` | 손실한도 손절 OFF ∧ 오늘 `exit_hard_stop_disabled` 종목 ≥1 | `⊘` w | 손실한도 손절 OFF — 한도 도달 {n}종목 · {d}일째 / 손실 한도에 닿았지만 스위치가 꺼져 손절 시그널을 만들지 않습니다 | `/analytics?tab=verify` |
| 7 | `virtual_exit` | stage ∈ {observe, halt} ∧ 오늘 청산 엔진 시그널의 `orders.status='dry_run'` ≥1 | `D` i | 가상 청산 {n}건 — 오늘 {HH:MM} {종류 표시 이름} / 주문은 기록만, 송신 없음 · 텔레그램 자동 제출 알림은 {꺼져/켜져} 있음 | `/recommend?tab=log` |
| 8 | `data_anomaly` | A4 원천별 이상 1건마다 1줄(최대 3줄, 넘으면 마지막 줄 「외 {n}건」) | `!` w | 예: 국내 뉴스 0건 {n}일 연속 / 장마감 분석 입력 품질 저하(degraded) | `/analytics?tab=data` |
| 9 | `analysis_unknown` | 마지막 예정 장마감 분석 슬롯에 `job_run_log` 행 없음(시장별) | `◌` n | 분석 실패 여부는 아직 알 수 없습니다 / 실행 기록(T-112)이 쌓인 뒤부터 보입니다 | `/analytics?tab=data` |

- 0건: 「**지금 확인할 것 없음** — 승인 대기 0 · 주문 오류 0 · 데이터 이상 0 · 청산 조건 해당 없음」(데모 609행).
- foot: 관찰·중지 단계 `승인 대기 {n} · 주문 오류 {n} · 기준 {HH:MM}`, 실거래·혼합 `기준 {HH:MM}`.
- 조회 실패: 줄 1개 「확인 필요 목록을 불러오지 못했습니다 / {code} · 비어 있는 것이 아닙니다」 + [다시 시도].
- 6번은 E 절 5 그대로(청산 3줄과 중복 — 위험 신호라 둘 다). 「{d}일째」 = 오늘부터 거꾸로 연속으로 그 skip 이 있었던 세션일 수(`eval_funnel` 30일 안, 30 초과면 「30일 이상」).
- 7번 알림 문구의 {꺼져/켜져} = `notify_signal_auto_submit`(없으면 켜짐 — `settings/safety/route.ts:76` 기본값과 같은 규칙).

#### 2.3.3 운용현황 — 관찰 세트 A (머리 `운용현황` + small `관찰 기간` + 링크 `분석 ›` → `/analytics?tab=today`)

2×2 `MetricTile`. 각 칸 안 두 줄 `<i>국내</i>…` / `<i>해외</i>…`.

| 칸 | 정상(available) | 첫 배포 / 미수집 | 확인된 0 | 그 밖 |
|---|---|---|---|---|
| A1 분석 완료 종목 | `국내 44종목 · 10-30 16:00` / `해외 51종목 · ET 10-29 · 08:00`, meta `장마감 AI 분석 · D0 확정봉 기준` | 값 `—`, 칩 `◌ 미수집 — 실행 기록 전`, meta `지금은 응답·로그에만 남아 셀 수 없음(T-112)`. **시장별**: 한 시장만 있으면 그 줄은 값, 다른 줄은 `◌ 미수집` | (해당 없음 — 0종목 평가는 실패로 본다: `state='error'`, `evaluated_zero`) | run `status='skipped'` → 그 줄 `휴장 · 건너뜀`; `failed` → `! 분석 실패` |
| A2 분석 후보 종목 | `국내 후보 5 → 시그널 1` / `해외 후보 3 → 시그널 1`, 칩 `⊘ 시그널 {n}건 모두 차단`(전부 skipped 일 때) / `승인 가능 {n}`(pending 있을 때), meta `차단 = 검증 관문(전략 미검증)` | 후보 수 없음(job_run_log counts 없음): `국내 시그널 1 · 차단 1`, 칩 `부분 — 시그널만`, meta `규칙 후보 수는 T-112 기록 뒤` | `국내 후보 0` / `해외 후보 0`, 칩 `✓ 확인된 0`, meta `분석이 정상 완료된 날에만 0` — **그 시장 run `ok` 일 때만** | run 모름이면 시그널 0 을 0 으로 쓰지 않는다(`◌`) |
| A3 사후 결과 추적 | 값 `{n}건`, 줄 `추적 완료 {a} · 추적 중 {b}`, 칩 n<30 이면 `건수 적음 (30건 미만)`, meta `30건 이상 쌓여야 성과를 판단할 수 있어 지금은 참고용 · 진입 d1open · D+1·3·5·10` (+ 판단 기록 없으면 ` · AI 매수 판단 시그널 한정`) | — | `0건` + `✓ 확인된 0`, meta `추적할 시그널 없음` | 일봉 최신일 < 마지막 완료 세션일 → `오래됨 · 일봉 {MM-DD}` |
| A4 데이터 이상·분석 실패 | 값 `{n}건`, 줄 = 첫 이상 1개, meta `원천 {k}개 중 {n} · {대표 상태}` | 칩 `부분 — 원천 {k}개만 확인`, meta `분석 실패는 실행 기록 뒤` | `0건` + `✓ 이상 없음`, meta `원천 {k}개 정상` | |

foot: 「손익은 표시하지 않습니다 — 실거래 전환일 첫 스냅샷에서 기준을 잡습니다(D5). 가상 진입(paper_fills)은 분석 › 검증·성과에 따로.」

#### 2.3.4 운용현황 — 실거래 세트 B (small `실거래` / `실거래 준비`, 링크 `거래 ›` → `/recommend?tab=now`)

2열 그리드 순서: B1 · B2 / B3 · B6 / B4(wide) / B7 (데모 660행 순서).

| 칸 | 실거래 | 혼합(mixed) | 0·빈 |
|---|---|---|---|
| B1 진입 감시 | `국내 1 감시 중` / `해외 0 · 주문 선점 1`, meta `다음 세션 예정 {n} · 서버 COUNT` | 값 `—`, `⊘ 매수 차단`, meta `검증 통과 전략 0` | `0` + `✓ 확인된 0` |
| B2 운용 포지션 | `자동 {n}종목 · ₩{평가액}` / `계좌 보유 {N}종목`, meta `평가 {HH:MM} 스냅샷 · 수동 보유는 자동 관리 아님(D3)` | `자동 운용 0` / `계좌 보유 {N}종목`, `✓ 자동 운용 0` | 같음 |
| B3 오늘 실체결 | `국내 {n}건 · {MM-DD} 세션` / `해외 {n}건 · ET {MM-DD}`, meta `체결 증거만 · 접수·가상 주문·거부 제외` | 국내 줄에 `· 청산 매도` 같은 종류 표시 | 두 줄 0 + `✓ 확인된 0` |
| B6 운용액 (배정) | 값 `미설정`, `◌ 설정에서 배정`, meta `사용자가 정한 금액만 씀(D4)` — **v1 은 항상 이 상태**(입력 화면 범위 밖) | 같음 | 같음 |
| B4 자동매매 손익 (wide) | **v1 = 항상 `—` + `◌ 기준 미설정`**, meta `기준은 실거래 전환일 첫 스냅샷(D5) — 자동 귀속 손익(원가·대사)은 연결 뒤` | 같음(데모 문구 `혼합 단계는 전환으로 볼지 결정 전`) | 자동 귀속 체결 0 이면 `✓ 자동 귀속 체결 0 · 손익 없음` |
| B7 신규 매수 가능 | `국내 ₩{n}` / `해외 ${n} ≈ ₩{n}`, meta `결제 완료 예수금 · 1회 한도 · 환율 {HH:MM}` | 값 `—`, `⊘ 차단 — 검증 통과 0`, meta `금액 대신 사유를 표시` | — |

foot(실거래): 「계좌 전체 손익(보조) — 자산 기록에서 보기 ›」(`/settings/cash-ledger`). **v1 은 숫자를 그리지 않는다** — 데모는 숫자를 보였지만 그 숫자를 만드는 `GET /api/cash-ledger`(`getFeed`→`buildFeed`)가 조회 중 대조 상태를 저장할 수 있어(`service.ts` `persisted` 플래그 [가능성 높음]) 홈 60초 재조회에 붙일 수 없다. 혼합 foot: 「계좌 전체 손익(보조): 기준 미설정」. (§8 E-4)

B 세트는 **지금 운영 단계(관찰)에서는 그려지지 않는다** — 실거래 전환 전까지 실데이터 확인이 불가능하므로 시험은 합성 DTO 렌더 시험으로 한다(§6).

#### 2.3.5 청산 로직 — 3줄 (머리 `청산 로직` + small `감사 관찰 대상` + `상세 ›` → `/analytics?tab=verify`)

`LineList` 3줄, 키 열 64px: `가동` · `판정` · `청산`. 0 이어도 항상 그린다(⑥).

| 줄 | 관찰·중지 | 혼합 | 실거래 |
|---|---|---|---|
| 가동(X1) | `청산 엔진 ON · **손실한도 손절 OFF**` + m `국내 마지막 평가 {HH:MM}(장 마감) · 해외 [장외] 개장 {HH:MM} KST ({MM-DD}부터 {HH:MM})` | `… · 손실한도 손절 ON · [실주문]` | `청산 엔진 ON · 손실한도 손절 ON` |
| 판정(X3) | 조건 충족 있으면 `손실한도 손절 OFF — 한도 도달 **{n}종목** · {d}일째` + m `해당 없음 {n}종목 · 데이터 이상 {n} · 해외 미평가(장외)` (+ 첫 배포·30일 한정 m ` · 30일 보존(영구 기록은 T-126)`); 없으면 `청산 조건 해당 없음 {n}종목 ✓ 확인된 0` | `손실한도 손절 발동 {n}종목` | `해당 없음 {n}종목 · 트레일링 활성 {n}` |
| 청산(X4) | `**가상 청산 {n}건** — {종류} {HH:MM}`(중지 단계: `청산 시그널 {n}건 — **주문 차단**(모든거래차단)`) + m `승인 대기 청산 {n} · 실 송신 0`; 0 이면 `청산 제안 0 ✓ 확인된 0` | `청산 주문 {n}건 송신 → 체결 {n}` | `청산 주문 {n} · 승인 대기 청산 {n}` + m `익절 조건 — 거래 › 운용 현황에서 승인` |

- 엔진 OFF: 가동 줄 `청산 엔진 OFF — 자동 손절·익절 없음`(e), 판정·청산 줄은 `—`(엔진 꺼짐 — 0 아님).
- 장외·휴장(그 시장 세션 run 행 없음): `장외` 칩, **「이상 없음」과 다르게**. 국내 X3 의 0 은 오늘 국내 세션 run 이 있었을 때만.
- 조회 실패: 가동 줄 `— ! 조회 실패` + m 「청산 엔진이 꺼진 것이 아닙니다 — 상태를 모릅니다」.
- 해외 개장 시각은 하드코딩하지 않는다 — `us-session` 으로 다음 세션 개장(09:30 ET)을 KST 로 바꿔 쓴다. [확실] 2026-11-01(일) 미국 DST 종료 → 11-02(월) 세션부터 23:30 KST.

#### 2.3.6 오늘의 분석·판단 (머리 + `전체 ›` → `/analytics?tab=today`)

`StageTable` 3열(단계 / 국내 `{MM-DD} · {HH:MM} 실행` / 해외 `ET {MM-DD} · {HH:MM} 실행`). 행:

| 행 | 출처 | 값 없을 때 |
|---|---|---|
| 평가 종목 | `job_run_log.counts_json.evaluated` | `◌` |
| 규칙 후보 | `counts_json.candidates` | `◌` |
| AI 매수 판단 | `judgment_candidate.ai_decision='BUY'` COUNT(baseline·`engine_release IS NOT NULL`) | `◌`(기록 켜짐·행 없음) / `준비 중`(스위치 꺼짐) |
| 시그널 생성 | `signals` 장마감 시그널 COUNT(§4.7 A2) | `0` 은 run `ok` 일 때만 |
| 검증 차단 (관찰) / 승인 대기 (실거래) | `signals.status='skipped'` / `pending` | |
| 제외 사유 1위 | `judgment_candidate.exclusion_code` 최빈 + 건수, 없으면 SKIP `ai_reasoning` 사용 안 함 | `준비 중` |

caption(데모 700행): 「**AI 매수 판단** = AI 가 「지금 살 만하다」고 본 종목 수(그 외는 「매수 안 함」) · 장마감 AI 분석만(D1) · 국내 = KST 세션일, 해외 = ET 세션일 · 다음 분석 국내 {MM-DD} 16:00 · 해외 {MM-DD} 08:00 KST(스케줄 표에서 읽음)」. 다음 분석 시각은 `job-slots.ts` `JOB_SPECS`(`post-market-domestic` 16:00·`post-market-overseas` 08:00)와 휴장표로 계산 — 화면 상수 금지.

#### 2.3.7 최근 활동 (머리 + `기록 ›` → `/recommend?tab=log`)

`ActivityList` 최대 4건, 최신순. 원천(E 절 6): ① `job_run_log` 장마감 분석 행(`post-market-*`) ② 오늘 `orders`(가상·체결·거부·차단) ③ 오늘 장중 매수 시그널 차단 요약 1줄(`signals` skipped COUNT, 마지막 시각). 문구 예(데모 714행): `국내 장마감 분석 완료 / 44종목 · 시그널 1건 → 검증 관문 차단` · `가상 청산 기록 — 종목 A 매도 / 장마감 전 손절 · 주문 송신 없음` · `장중 매수 시그널 차단 / 검증 관문 · 오늘 {n}건 모두 차단`. ①이 없으면(첫 배포) ②③만.

### 2.4 거래 — `/recommend` (WP-C)

`SafetyStrip` → `SegmentControl`(운용 현황 · 보유·주문 · 운영 기록, sticky `top: var(--strip-h)` — 띠 높이를 측정해 CSS 변수로, 데모 991행) → 본문. `detail` 이 있으면 세그먼트 아래에 상세 머리 + 기존 컴포넌트.

#### 2.4.1 운용 현황

| 영역 | 내용 | 데이터 |
|---|---|---|
| 승인 대기 (small `{n}건 · 홈과 같은 집합`) | 기존 `ScenarioCard` 목록·정렬 그대로(`sortScenarioCards`, 정렬 라벨 줄). 카드 클릭 → `/recommend/{id}`. 관찰 단계이고 0건이면 「**승인 대기 없음** — 검증 통과 전략이 없어 새 매수 시그널은 차단 기록으로 남습니다(승인 버튼 없음).」 + 오늘 차단된 장마감 시그널 카드(최대 2, `⊘ 차단`, 데모 749행 문구) | 목록: `GET /api/signals?status=awaiting_approval,pending,pending_approval&limit=100` (**`detected` 제거**), 숫자: `/api/ops/trade` `approval` COUNT |
| 관측 기록 (small `승인 버튼 없음`) | 한 줄 `{n}건 — 수동 관측용 기록(detected)` / `승인 대기 숫자에 넣지 않습니다(D8)`. 펼침 없음(v1) | `/api/ops/trade` `detected` COUNT |
| 진입 감시 (small `감시 중 {n} · 선점 {n}`) | 기존 「👁 진입 감시 중」 목록 그대로 + `executing` 은 「주문 선점 중 — 진입 구간 도달 — 주문 처리 중, 결과 확인 전 (취소 불가)」 줄, `valid_from` 미래는 「다음 세션 예정」. [감시 취소] → **확인 대화상자**(§2.4.2) | 목록: 기존 `approved_pending_entry&limit=50` 유지 + `executing` 은 `/api/ops/trade` 에서 |
| 전략 상태 | 한 줄 `켜진 전략 {e} · 검증 통과 {v}/{t}` (v=0 이면 `→ 신규 매수 차단`, ⊘ w) / `전략 편집·세부 정책은 상세(기존 /strategy)`, 머리 `관리 ›` → `/strategy` | `/api/ops/safety-state` `strategies` |
| (유지) 차단 배너 | 지금의 `blockBanner`(역추세 80%↑) 그대로 — 승인 대기 위 | 기존 `signal-quality` |
| (유지) 내 시나리오 만들기 | 지금 페이지 맨 아래 버튼 그대로 → `/recommend/build` | — |

> ⚠ `scenario-pages-wiring.test.ts` 는 `recommend/page.tsx` 의 **useState 순서(signals → pendingEntry → loading → blockBanner)** 와 문구 「👁 진입 감시 중」「정렬: 평가등급순 (같은 등급은 신뢰도 높은 순)」에 기대 있다 [확실]. 세그먼트 컨테이너를 `page.tsx` 에 두면 순서가 깨진다 → **지금 `page.tsx` 본문을 `src/app/recommend/TradeNowPanel.tsx` 로 옮기고(useState 순서 그대로 — 새 useState 는 이 4개 **뒤에만**), 시험의 import 를 그 파일로 바꾼다.** 문구 두 개는 유지. 시험이 목으로 바꾸는 `useSymbolMeta`·`useFxRate` 외의 새 훅(예: ops 조회)은 `TradeNowPanel` 밖(`TradePage`)에서 불러 props 로 넘긴다.

#### 2.4.2 감시 취소 확인 대화상자

- `components/ui/Sheet.tsx` 재사용. 제목(포커스 대상) 「진입 감시를 취소하고 시나리오를 삭제할까요?」, 본문 「{종목} {시장} 매수 감시 · 취소하면 이 시나리오로는 주문이 나가지 않습니다.」, 버튼 [취소하지 않음](보통) · [감시 취소](`.btn.dz`).
- [감시 취소] → 지금과 같은 `DELETE /api/signals/{id}`. 처리 중엔 두 버튼 비활성·Esc 무시. 성공 → 닫고 목록에서 제거 + 토스트 「진입 감시를 취소했습니다」, 포커스는 세그먼트 「운용 현황」. 실패 → 대화상자 안 `.res.e` 「! 취소하지 못했습니다: {error} — 감시는 그대로입니다」(지금의 `alert` 대체). 네트워크 오류 → 「! 연결이 끊겼습니다 — 취소됐는지 알 수 없습니다. 목록을 새로 고쳐 확인하세요.」
- `executing` 행에는 버튼 없음(지금도 취소 대상이 아님 — 목록 쿼리가 `approved_pending_entry` 만).

#### 2.4.3 승인·거절 — 기존 `ScenarioDetail` 에 결과 상태만 (WP-C)

API·본문·편집 폼·확인 단계 변경 0. `handleApprove`/`handleReject` 의 **결과 표시**만 데모 시트 문구로 바꾼다(지금은 토스트 1줄).

| 상태 | 조건 | 표시(버튼 위 `.res`, `tabIndex=-1` 포커스) |
|---|---|---|
| 처리 중 | 요청 중 | 스피너 + 「처리 중… (다시 누를 수 없음)」, 승인·거절 비활성(지금 `submitting`·`rejecting` 재사용) |
| 성공 | `data.ok` | 「✓ 진입 감시가 시작됐습니다」(매도 시그널은 「✓ 매도 주문을 제출했습니다 — 결과(체결·거부)는 운영 기록에서 확인」 — **현재 응답으로 구분 가능한 경우만**, 모르면 공통 「✓ 승인했습니다」). 1.8초 뒤 `/recommend` 이동은 그대로 |
| 실패 | `!data.ok` ∧ 4xx | 「! 오류: {data.error} — 승인되지 않았습니다. 목록으로 돌아가 다시 확인하세요.」 |
| 차단 | `data.errorCode ∈ {validation_gate, validation_lookup_error}` 또는 `blockedBy`/`kill_switch` 표지 | 「⊘ 차단: {data.error} — 승인되지 않았습니다.」 |
| 네트워크 오류 | `fetch` 예외 | 「! 오류: 연결이 끊겼습니다 — 승인됐는지 알 수 없습니다. 목록을 새로 고쳐 상태를 확인한 뒤 다시 시도하세요.」 |
| 거절 | 거절 응답 | 「거절했습니다 — 놓친 기회(사후 추적)에 기록됩니다」 후 지금처럼 `/recommend` 이동. 거절 실패는 「! 거절하지 못했습니다 — 시그널은 그대로입니다」(지금은 결과를 안 봄 → 응답을 읽어 분기만 추가) |

- 승인 버튼 위 안내(데모 `.gate`): 매수 「승인하면 **진입 감시가 시작**됩니다 — 이 단계에서는 주문이 나가지 않습니다. 주문은 진입 구간에 닿을 때 안전장치(모든거래차단·한도·실거래여부)를 거쳐 나갑니다.」 + 실거래여부 ON 이면 「 — 지금 실거래여부 ON = **실제 주문**.」(빨강 `.gate.bad`). 매도 시그널의 안내는 **현재 코드가 매도 승인 때 실제로 어떤 경로를 타는지 Developer 가 확인한 뒤**(`custom/confirm` 의 `direction:'sell'` 처리 — 미확인) 그 사실대로 쓴다. 확인 못 하면 매도 안내 문구를 넣지 않는다.
- 실거래여부 값은 `/api/ops/safety-state` 의 `liveTrading` 으로.

#### 2.4.4 보유·주문

| 영역 | 내용 | 데이터 |
|---|---|---|
| 보유 (small `계좌 {N} · 자동 운용 {n} (D3)`) | 종목마다 56px 행: `종목 {이름} [국내/해외] [자동/수동 보유]` / 상태(X5): `손실한도 구간 (임계 −1.5%) — 손실한도 손절 OFF` · `익절 조건 충족 (임계 +2.5%)` · `트레일링 활성 · 고점 대비 −0.6% (되돌림 1.2%)` · `장마감 전 손절 구간` · `중립` · `미평가 — 장외`, 오른쪽 손익률(색+부호). foot 「기준 {HH:MM} 스냅샷 · 청산 임계: 손실한도 손절·장마감 전 손절·익절 = 코드 기본값, 트레일링 = 운영 설정(활성 {a}% · 되돌림 {b}%). 손익률이라 환율 무관」, 3시간 초과면 앞에 「오래됨 — 기준 스냅샷 {MM-DD HH:MM} (3시간 초과) · 」 | `/api/ops/trade` `holdings` |
| 미체결 주문 | `{종목} {시장} · 매수 {q}주 중 {f}주 체결` / `잔량 {r}주 · 부분 체결 — 체결 수는 1건으로 셈`. 0 → `미체결 없음 ✓ 확인된 0` | `/api/ops/trade` `openOrders` |

종목 이름 표시는 기존 `useSymbolMeta()` `displaySymbol`. 수량·평단·평가금은 이 화면에 두지 않는다(데모에도 없음).

#### 2.4.5 운영 기록

| 영역 | 내용 | 데이터 |
|---|---|---|
| 장중 룰 평가 깔때기 | 머리 아래 `SegmentControl` `국내 · {MM-DD}{ · 이상 n}` / `해외 · ET {MM-DD}{ · 이상 n}`, 기본 = `/api/ops/funnel` 의 `defaultMarket`. 표 caption 「장중 룰 엔진(eval_funnel, 30일 보존) · 세션일 기준(해외 ET) · 장마감 AI 분석은 이 표에 없음 · 청산 트랙은 별도(분석 › 검증·성과)」. **기존 `EvalFunnelCard` 를 재사용**하되 props 를 `{ market; reloadKey; source: 'session' }` 로 넓혀 새 라우트를 읽는다(기존 라우트는 그대로 둠) | `GET /api/ops/funnel?market=` |
| 주문 기록 (small `오늘 · 세션일`, `전체 ›`) | 필터 `SegmentControl` 전체·체결·가상·차단·거부 + 목록(시각 / `{매수/매도} {종목} {수량}` / `{상태 표시}`). 맨 위에 오늘 「주문 전 단계에서 차단된 매수 시그널 {n}건 — 주문 기록 없음」 줄(n≥1). foot 「「체결」은 체결 증거가 있는 것만 · 가상 주문·차단·거부는 체결에 넣지 않음」 | 목록 `GET /api/orders?limit=50` 를 세션일로 거름(목록이라 limit 허용, 숫자는 ops COUNT) |
| 내 결정 | 기존 `MyDecisionSection` 그대로 이동(요약 줄·펼침·재조회 동작 동일, 재조회 주기만 이 화면의 60초) | 기존 |
| 투자일지 › | 행 링크 → `?tab=log&detail=notes` | — |

상태 표시 매핑(주문, `OrderStatus` 9종 전부 [확실: `src/types/order.ts`]): `filled`·`partially_filled` → 체결 / `dry_run` → 가상 / `blocked` → 차단 / `rejected`·`failed` → 거부 / `pending`·`accepted` → 접수 / `cancelled` → 취소. 필터 「체결」은 `filled`·`partially_filled` 만. 「DRY_RUN」 글자는 쓰지 않는다.

### 2.5 분석 — `/analytics` (WP-C)

`MiniStrip('분석')` → `SegmentControl`(오늘 분석 · 검증·성과 · 데이터 상태) → 본문 / 상세.

| 세그먼트 | 영역 (데모 함수) | 데이터 |
|---|---|---|
| 오늘 분석 | ① `장마감 AI 분석`(small `시장별 세션일`) = 홈과 같은 `StageTable` ② `후보`(small `오늘`) — 시그널로 이어진 종목 행(`⊘` `종목 C 국내 · AI 매수 판단 · 신뢰도 72` / `시그널 생성 → 검증 관문 차단`) + 마지막 행 `AI 매수 안 함 · 제외 사유 목록` / `준비 중 기준 판단 기록(T-112) 뒤 — 지금은 시그널로 이어진 것만 남습니다`(판단 기록이 있으면 SKIP 종목 목록으로 대체) ③ `종목별` — `리서치 추적 {n}종목 ›`(`?tab=research`) · `주도주 ›`(`?tab=leaderboard`) · `관심 종목 관리 (현재 즐겨찾기) ›`(`/favorites`) | `/api/ops/analysis?part=today` |
| 검증·성과 | 왼쪽: `사후 성과`(small `건수 적음 · {n}건`) 표 기간/건수/초과수익 중앙값 + foot 「30건 미만 — 성과 판단 근거로 쓰지 마세요(T-095 경고 규칙)」 + `놓친 기회 ›` · `후보·제외 사유 추이`(준비 중 문구) + `신호 진단 ›` · `실거래 성과`(실거래 전: 「실거래 전환 뒤 — 지금은 체결 0이라 표시할 것이 없습니다 ✓ 체결 0」) + `포트폴리오 · 자산 추이 (계좌 전체) ›` / 오른쪽: `청산 로직 (X1~X6)` `kv` 6행 + foot(데모 866행) | `/api/ops/analysis?part=verify` |
| 데이터 상태 | `가동률`(small `세션일 · 주 단위`) 2행: 장마감 분석(국내·해외), 데이터 수집 — `ok/예정` 비율 또는 `준비 중`(기록 첫날부터 7일 미만이면 「기록 {n}일째 — 주 단위 비율은 7일 뒤」) · `원천별 신선도` kv: 포트폴리오 스냅샷 · 환율 USD/KRW · 일봉 국내 · 일봉 해외 · 뉴스 국내 · 뉴스 해외 · 브로커 원장 — 마지막 성공 시각 + 칩. foot 「「날짜 파일이 있다」는 성공 증거가 아닙니다 — 마지막 성공 시각 기준」 | `/api/ops/analysis?part=data` |

- 사후 성과 표 「초과수익 중앙값」: §4.6 의 계산이 오늘 밤 안 되면 그 열만 `준비 중` 칩(건수 열은 채운다). 0.4% 같은 숫자 뒤에 `초과`/`미달` 글자(색 단독 금지, 데모 849행).
- X1~X6 칩: 데모 852~857행 문구 그대로(`연결 가능` 대신 실제 상태 칩 — `available` 이면 칩 없음, 30일 한정은 `30일 보존 한정`, X6 은 `준비 중 — 완전판 T-112`).

### 2.6 설정 — `/settings` (WP-C, **문구만** — 불편한 사실 3)

- 머리에 `MiniStrip('설정')` **넣지 않는다**(v1). 이유: 설정 페이지 맨 위엔 sticky 저장 바가 이미 있고 두 개의 sticky 가 412px 높이를 먹는다. 데모는 미니 띠를 그렸지만, 안전 카드 자체가 같은 정보를 보여 준다 → §8 E-9(Leader 확인).
- 안전장치 (공통) 카드: **토글 위치·확인 흐름·저장 함수(`autoSave`)·PATCH 본문 키(`dryRun`·`killSwitch`)는 그대로**. 바뀌는 것:

| 줄 | 지금 | 바뀜 |
|---|---|---|
| 494 제목 | `실거래 여부` | `실거래여부` |
| 496 설명 | `OFF — 실제 거래소 API 차단 (안전, DRY_RUN)` / `ON — 실제 주문 전송 중` | `OFF — 실거래 차단(기록만)` / `ON — 실거래 가능(실제 주문)` + 둘째 줄 「ON 이면 주문이 거래소로 나가고, OFF 이면 기록만 남깁니다」 |
| 500~509 값·토글 | `safety?.dryRun ? 'OFF':'ON'`, `checked={!(safety?.dryRun ?? true)}`, `update({dryRun:!v})` | 같은 동작을 §3.5 함수로: `liveTradingFromDryRun(safety?.dryRun ?? true)` / `dryRunFromLiveTrading(v)`. 토스트 라벨 인자 `'DRY_RUN'` → `'실거래여부'` |
| 517 제목 | `KILL_SWITCH` | `모든거래차단` |
| 519 설명 | `모든 주문 즉시 차단 중` / `OFF — 주문 정상 처리` | `ON — 모든 주문 차단` / `OFF — 차단 안 함` + 「ON 이면 매수·매도·청산 모두 송신하지 않습니다」. 토스트 라벨 `'KILL_SWITCH'` → `'모든거래차단'` |
| 546 자동 청산 엔진 ON 설명 | `ON — 하드손절·EOD손절·트레일링스탑·목표익절 … (하드손절만 개별 OFF)` | `ON — 손실한도 손절·장마감 전 손절·트레일링·익절 자동 매도 동작 중 (손실한도 손절만 개별 OFF)` |
| 신규 줄 | — | 자동 청산 엔진 아래 읽기 전용 줄 `손실한도 손절 ON/OFF` + 「손실이 한도(−1.5%)에 닿으면 바로 매도 · 읽기 전용 표시 — 설정 API 대상 아님」(값 `safety.exitHardStopEnabled`, 이미 GET 응답에 있음) |
| 153·154·155 | `미국 종목 시나리오 카드를 만듭니다` · `승인·킬스위치·검증 관문` | `미국 종목 매수 시그널을 만듭니다` · `승인·모든거래차단·검증 관문` |
| 455·465·573 | `하드 손절·장마감 손실 차단` | `손실한도 손절·장마감 전 손절` |
| 935 | `실거래 여부 / KILL_SWITCH / 주문 한도` | `실거래여부 / 모든거래차단 / 주문 한도` |

- 「자동매매 자금」 새 영역(데모 915~917행): 안전장치 카드 **아래**에 두 행, 둘 다 **이동 전용**: `운용액 배정 — 미설정` / 「자동매매에 쓸 금액을 직접 정합니다(D4). 입력 화면은 다음 범위」(href 없음, 비활성 행 — 누를 곳 없음), `손익 기준 — 실거래 전환일 첫 스냅샷` / 「자산 기록의 「기준 정하기」를 재사용(D5) · 관찰 기간엔 홈 손익 미표시」 → `/settings/cash-ledger`. 데이터 조회 없음.
- `RiskPolicySummaryRow`·`CashLedgerSummaryRow`·`AppSection` 등 나머지 순서·내용 변경 없음.

### 2.7 비서

하단 탭에 없음. `/ai` 그대로. 이번 구현에서 비서 관련 파일 변경 0.

---

## 3. 용어 변경 전수 계획

### 3.1 표시 이름 (정본: 계약 §12 · 데모 F 절)

| 표시 | 대신 쓰던 말 (화면에서 0건이어야 함) | 내부 이름 (바꾸지 않음) |
|---|---|---|
| 시그널 | 카드(시그널 뜻일 때만 — UI 카드·「이 카드의 설정」 같은 화면 상자 뜻은 유지) | `signals` |
| 건수 적음 · N건 (30건 미만) | 표본 부족 · 표본부족 · n=N | n<30 |
| 장마감 전 손절 | EOD 손절 · EOD손절 · 장마감 손실 차단 | `eod_loss_cut` |
| AI 매수 판단 · 매수 안 함 | AI BUY · AI SKIP | `BUY`/`SKIP` |
| 실거래여부 (ON=실거래 가능) | DRY_RUN · DRY RUN · 실거래 여부 | `safety_dry_run`(반대 방향) |
| 모든거래차단 | 킬스위치 · KILL_SWITCH · Kill Switch | `safety_kill_switch` |
| 손실한도 손절 | 하드손절 · 하드 손절 | `hard_stop`·`exit_hard_stop_enabled` |
| 가상 주문 · 가상 청산 | DRY_RUN 주문 · DRY_RUN 청산 | `orders.status='dry_run'` |

### 3.2 화면 소스 변경 위치 (WP-C 소유, grep 확인 [확실] — 줄 번호는 10-30 `a39612a` 기준)

| 파일 | 줄 | 지금 → 바뀜 |
|---|---|---|
| `src/app/settings/SettingsPage.tsx` | 153·154·155·455·465·494·496·508·517·531·546·573·935 | §2.6 표 |
| `src/app/analytics/components/OrderHistoryTab.tsx` | 31 필터 `DRY_RUN` · 42 `DRY RUN` · 156 `DRY_RUN` | `가상` · `가상` · `가상 주문` |
| `src/app/analytics/components/AuditLog.tsx` | 41 `Kill Switch 발동` | `모든거래차단 발동` |
| `src/app/analytics/components/TrailingStopTab.tsx` | 83 `하드 손절·장마감 손실 차단` | `손실한도 손절·장마감 전 손절` |
| `src/app/analytics/components/ResearchTab.tsx` | 345 `판단 보류(표본부족)` | `판단 보류(건수 적음)` |
| `src/app/strategy/components/AnalystStatusBanner.tsx` | 60 `!safety.dryRun` · 133 `하드 손절·장마감 손실` | §3.5 함수 · `손실한도 손절·장마감 전 손절` |
| `src/app/settings/risk-policy/RiskPolicyPage.tsx` | 180 `기본 하드 손절 …` | `기본 손실한도 손절 …` (⚠ risk 격리 시험 대상 파일 — 문구만, import 추가 금지) |
| `src/app/profile/ProfilePage.tsx` | 162 `서버 공용 DRY_RUN 값` | `서버 공용 실거래여부 값` |
| `src/components/SafetyBar.tsx` | 72·82·157·174 `DRY_RUN`·`KILL` | `실거래여부 OFF` 등(화면 사용처 0 — 문구만 맞춰 두고 컴포넌트는 살려 둠, `safety-bar-outcome.test.ts` 가 import) |
| `src/components/scenario-card-display.ts` | 226 `카드 환율` · 295 `카드 금액` · 296 `미국 카드는` | `시그널 환율` · `시그널 금액` · `미국 시그널은` (`scenario-card-display.test.ts`·`scenario-card-render.test.ts` 기대값 같이 수정) |
| `src/components/ScenarioCard.tsx`·`ScenarioDetail.tsx`·`ScenarioBuilder.tsx`·`dashboard/MyDecisionSection.tsx`·`dashboard/EvalFunnelCard.tsx`·`dashboard/decision-outcome.ts` | grep 에 걸린 1~4줄 | Developer 가 grep 으로 줄을 열어 시그널 뜻이면 바꾸고, 주석이면 둔다 |
| `src/app/settings/__tests__/settings-post-market-overseas.test.ts` | 기대 문자열 3곳 | 153~155 변경에 맞춤 |

grep 명령(Developer 가 커밋 전 다시 실행해 이 표를 확정):
```bash
grep -rnE --include='*.ts' --include='*.tsx' 'DRY_RUN|DRY RUN|킬스위치|KILL_SWITCH|Kill Switch|하드 ?손절|EOD ?손절|장마감 손실 차단|표본 ?부족|AI BUY|실거래 여부' src/app src/components | grep -v '/__tests__/' | grep -v '^src/app/api/'
```
그 뒤 남는 줄은 주석(`//`·`*`·`{/* */}`)과 내부 키(`'dry_run'` 상태값·`dryRun` 식별자·`blockedBy:'kill_switch'` 비교)뿐이어야 한다.

### 3.3 서버 쪽 사용자 문구 — WP-D (SAFETY_PATHS, 별도 커밋·별도 Reviewer scope)

포함(사용자가 텔레그램·화면에서 읽는 문자열):

| 파일 | 줄 | 지금 → 바뀜 |
|---|---|---|
| `src/lib/signals/approval-message.ts` | 42 `'하드 손절'` · 45 `'EOD 손절'` · 220 `'킬스위치가 켜져 있음'` · 236 `(DRY_RUN — 실…)` · 258 `킬스위치가 켜져 있어 승인하지 않았습니다` | `손실한도 손절` · `장마감 전 손절` · `모든거래차단이 켜져 있음` · `(가상 주문 — 실…)` · `모든거래차단이 켜져 있어 …` |
| `src/lib/signals/approval-notify.ts` | 142 `'🔴 하드 손절 (자금보호)'` · 145 `'🔴 EOD 손절'` | `'🔴 손실한도 손절 (자금보호)'` · `'🔴 장마감 전 손절'` |
| `src/lib/signals/telegram-approval.ts` | 223 `⛔ 킬스위치가 켜져 있어 …` | `⛔ 모든거래차단이 켜져 있어 …` |
| `src/lib/strategy/eval-funnel-labels.ts` | 318 `'청산: 하드손절 비활성'` | `'청산: 손실한도 손절 꺼짐'` (깔때기 화면 라벨) |
| `src/lib/strategy/exit-switch.ts` | 142·145 `describeExitEngineSwitch` | `손실한도 손절·장마감 전 손절·트레일링·익절` (설정 응답 `exitSwitchSummary` 로 화면에 나감) |
| `src/lib/reports/trade-report.ts` | 613 `표본부족` | `건수 적음` (정기 리포트 텔레그램) |
| `src/lib/safety/kill-switch.ts` | 121·252·277·383·388·455·459·491 `sendAlert` 제목·본문의 `Kill Switch`·`킬스위치`·`KILL_SWITCH` | `모든거래차단` |
| 각 파일의 기존 시험 | `approval-message.test.ts`(5)·`telegram-approval.test.ts`(7)·`kill-switch*.test.ts` 의 기대 문자열 | 같이 수정 — 기대값 변경 외 시험 논리 변경 금지 |

제외(바꾸지 않음 — 회귀 시험 허용 목록):
- `console.log/warn/error` 로그 문구 전부(pm2 로그 grep·운영 점검 문구가 기대함 — 예: `[exit-engine] … hard_stop 스킵`).
- `exit-engine.ts:95·108` `reasonHead: '[EOD 손절]'`·`'[하드 손절]'` — **DB `signals.reason` 에 저장되는 텍스트**이고 신호 생성 경로다. 바꾸면 새 행만 바뀌어 과거·현재 문구가 섞인다. 화면은 저장된 이유를 그대로 보여 준다(옛 표기가 화면에 남는 유일한 허용 경로 — 회귀 시험 예외 목록에 「저장 데이터」로 명시).
- 오류 코드·필드(`KILL_SWITCH_ACTIVE`·`blockedBy:'kill_switch'`·`dry_run`)·env 이름(`DRY_RUN`·`KILL_SWITCH`)·`dry-run.ts` 경고 로그.
- `post-market-engine.ts:622`·`post-market-overseas.ts:728`·`judgment-recorder.ts:287`·`volatility-guard.ts`·`portfolio-snapshot/route.ts` — 로그·경보 내부 설명(`volatility-guard`·`portfolio-snapshot` 의 `sendAlert` 본문 속 `킬스위치 24h 기준선`은 **포함 후보**지만 WP-D 범위를 줄이려 v1 제외 — §9 L-2 에 같이).

### 3.4 회귀 시험 (WP-C) — `src/__tests__/t108-terms-fence.test.ts`

- 대상: `src/app/**`(단 `src/app/api/**` 제외) + `src/components/**`, `__tests__`·`.test.` 제외.
- 처리: 파일마다 주석(`//…`, `/* … */`, JSX `{/* … */}`)을 지운 뒤 정규식 `/DRY_RUN|DRY RUN|킬스위치|KILL_SWITCH|Kill Switch|하드 ?손절|EOD ?손절|장마감 손실 차단|표본 ?부족|AI BUY|실거래 여부/` 일치 0건.
- 허용 예외: 없음으로 시작한다. 생기면 `{ file, count, reason }` 정확 일치 목록(`usd-cash-balance-fence.test.ts` 방식).
- 「카드」는 정규식으로 못 거른다(화면 상자 뜻과 겹침) → §3.2 의 3곳(`scenario-card-display.ts`)만 고정 문자열로 「0건」 검사.
- WP-D 를 하면 같은 시험에 `src/lib/signals/approval-message.ts`·`approval-notify.ts`·`telegram-approval.ts`·`eval-funnel-labels.ts` 의 **문자열 리터럴**만 대상으로 하는 두 번째 describe 를 추가(로그 줄은 `console.` 포함 줄 제외).

### 3.5 실거래여부 방향 변환 — 한 함수에만

- 신규 `src/lib/safety/live-trading.ts`(WP-A 소유, **SAFETY_PATHS 안** — 일부러 Reviewer scope 에 걸리게): import 0개 순수 모듈.
```ts
/** 화면 「실거래여부」 ON = 실거래 가능 ⇔ 내부 safety_dry_run=false. 방향 변환은 이 두 함수로만 한다. */
export function liveTradingFromDryRun(dryRun: boolean): boolean { return dryRun === false; }
export function dryRunFromLiveTrading(liveTrading: boolean): boolean { return liveTrading !== true; }
export const LIVE_TRADING_LABEL = '실거래여부';
export function liveTradingText(live: boolean): 'ON · 실거래 가능' | 'OFF · 실거래 차단' { return live ? 'ON · 실거래 가능' : 'OFF · 실거래 차단'; }
```
  - `dryRun === false` 만 실거래(값이 이상하면 실거래 아님 — fail-closed), 역변환도 `true` 만 실거래.
- 사용처: `/api/ops/safety-state`(서버), `SettingsPage.tsx` 실거래여부 토글, `AnalystStatusBanner.tsx:60`, `ScenarioDetail` 안내. **다른 곳에서 `!dryRun`·`!safety.dryRun` 으로 뒤집는 코드를 새로 쓰지 않는다** — 회귀 시험(§6 A-2)이 `src/app`·`src/components` 의 `!\s*(safety\??\.)?dryRun` 패턴 0건을 검사.
- 시험 `src/lib/safety/__tests__/live-trading.test.ts`: (dryRun true→false, false→true) · (live true→false, false→true) · 왕복 2방향 항등 · 이상한 입력(`undefined as any`·`'false'`) → 실거래 아님 · 라벨 문자열.

---

## 4. 데이터·API 계약 (WP-A)

### 4.0 공통 규칙

- **읽기 전용**: 새 코드(`src/lib/ops/metrics/**`·`src/app/api/ops/**`)에 `INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE` 0건, `submitOrder`·`createOrder`·`@/lib/exchanges/kis*` import 0건, `getUsdKrwRate`(외부 조회 가능) 호출 0건 — 환율은 `fx_rates` 행을 직접 읽는다. 시험이 소스를 읽어 강제(§6 A-3).
- 인증: 새 라우트는 미들웨어 기본 보호를 받는다(공개 경로 추가 없음, `middleware.ts` 변경 0). `export const dynamic = 'force-dynamic'`.
- 봉투: `{ ok: true, data }` / `{ ok: false, error: string }`(5xx). **섹션 단위 실패 격리**: 한 섹션의 쿼리 실패는 그 섹션만 `{ state: 'error', error: code }` 로 두고 HTTP 200. 전체 실패(풀 생성 실패 등)만 503.
- 시간 상한: 쿼리마다 2.5초(`withDeadlineSafe` — `src/lib/strategy/records/safe-text.ts` 재사용, import 만), 섹션 병렬(`Promise.allSettled`), 라우트 전체 목표 < 4초. 상한 초과 섹션 = `error`/`timeout`.
- **캐시 없음(v1)** — 사용자 1명, 홈 60초·띠 30초 재조회. 서버 메모리 캐시·`revalidate` 쓰지 않는다. (NAS DB 가 느린 구간이 실측돼 있으므로 쿼리는 인덱스 경로만: `eval_funnel` `idx_ef_market(market, ts, stage)`, `job_run_log` `idx_session_market`, `signals` `idx_signals_market`.)
- 세션일: 국내 = KST 날짜, 해외 = ET 날짜(`us-session.etDateOf`·`lastCompletedSessionEt`·`loadUsClosedDaysStrict` — 엄격 로더, 연도 0행이면 그 섹션 `unknown`/`holidays_unknown`). KST 자정으로 해외를 자르지 않는다.
- `judgment_run`·`judgment_candidate` 집계는 **`judgment_role='baseline' AND engine_release IS NOT NULL`** 만(개발 서버 행 제외 — T-112 Reviewer Info ②). `candidate_count ≠ 후보 행 수` 인 run 은 불완전 → `partial`.
- `job_run_log` 에는 `engine_release` 열이 없다 [확실: DDL]. 쓰는 쪽은 운영 러너 후크·기록 라우트뿐이라 개발 행 혼입은 [가능성 높음] 없음, **열로 구분할 수는 없다**(미확인으로 남김).
- `job_run_log` 롤업 행(`recorder='runner_rollup'`)의 `counts_json.runs` 는 **근사값**(503 재전송 시 두 배 가능 — T-112 Reviewer Minor-2). 화면에 롤업 runs 를 숫자로 쓰지 않는다. X6 의 「실행 n」은 `eval_funnel gate='run'` 행 수로 센다. 가동률(E2) 분모에서 롤업 잡은 뺀다.
- 테이블 없음(errno 1146): 그 섹션 `prep` + `reason:'not_migrated'`. 기록 스위치 꺼짐(`readRecordSwitchState('judgment_record_enabled')`): `prep` + `reason:'record_off'`. 켜짐 + 해당 세션 행 없음: `unknown`.

### 4.1 공유 타입 — `src/lib/ops/metrics/types.ts` (WP-A 가 **첫 커밋 전 단계에서 먼저 확정**, B·C 는 import 만)

```ts
export type Market = 'domestic' | 'overseas';
export type OpsStage = 'observe' | 'halt' | 'mixed' | 'live' | 'unknown';
export type MetricState = 'available' | 'zero' | 'unknown' | 'error' | 'stale' | 'partial' | 'blocked' | 'off_hours' | 'prep';
export interface Metric<T> { state: MetricState; value: T | null; asOf: string | null; reason?: string }
//  asOf = ISO 8601 +09:00 (서버가 만든 KST 표기). reason = 짧은 분류어(db_error, timeout, not_migrated, record_off, holidays_unknown, fx_fallback …)
export interface ByMarket<T> { domestic: T; overseas: T }
export interface SessionRef { market: Market; sessionDate: string /* YYYY-MM-DD, 국내 KST·해외 ET */; tz: 'KST' | 'ET' }
export type Section<T> = { state: 'ok'; data: T } | { state: 'error'; error: string };

export interface SafetyStateDTO {
  readAt: string;
  stage: OpsStage;
  liveTrading: boolean | null;          // liveTradingFromDryRun(isDryRun()) — null = 읽기 실패
  killSwitch: boolean | null;           // isKillSwitchActive()
  exitEngine: { enabled: boolean; hardStopEnabled: boolean; source: 'config' | 'absent' | 'unparsable' | 'db_error' } | null;
  strategies: { total: number; enabled: number; validated: number; validatedEnabled: number } | null;
  notifyAutoSubmit: boolean | null;     // notify_signal_auto_submit (없으면 true)
  errors: string[];                     // db_unreachable | strategies_error | exit_switch_db_error
}

export type CheckKind = 'kill_switch_on' | 'exit_live_orders' | 'buy_blocked' | 'awaiting_approval' | 'order_rejected'
  | 'hard_stop_off_hit' | 'virtual_exit' | 'data_anomaly' | 'analysis_unknown';
export interface CheckItem { kind: CheckKind; severity: 'e' | 'w' | 'i' | 'n'; count?: number; market?: Market;
  params: Record<string, string | number | null>; href: string }

export interface AnalysisRunRow {           // 장마감 AI 분석 1회 (시장별 마지막 세션)
  session: SessionRef; runStartedAt: string | null; runStatus: 'ok' | 'partial' | 'failed' | 'skipped' | 'missing' | 'degraded' | null;
  evaluated: Metric<number>; ruleCandidates: Metric<number>; aiBuy: Metric<number>;
  signalsCreated: Metric<number>; signalsBlocked: Metric<number>; signalsPending: Metric<number>;
  topExclusion: Metric<{ code: string; label: string; count: number }>;
  nextRunAt: string | null;               // KST ISO
}
export interface ObserveSet {               // A1~A4
  analysis: ByMarket<AnalysisRunRow>;
  postmortem: Metric<{ total: number; done: number; tracking: number; cardsOnly: boolean; lastBarDate: ByMarket<string | null> }>;
  anomalies: Metric<{ total: number; sourcesChecked: number; items: { source: DataSourceId; state: MetricState; label: string }[]; analysisFailureKnown: boolean }>;
}
export interface LiveSet {                  // B1~B7 (B4·B6 은 v1 고정 상태)
  watch: ByMarket<Metric<{ watching: number; executing: number; nextSession: number }>>;
  positions: Metric<{ autoCount: number; autoValueKrw: number | null; accountCount: number; snapshotAt: string | null }>;
  fillsToday: ByMarket<Metric<{ fills: number; session: SessionRef; exitSells: number }>>;
  allocation: Metric<null>;               // v1 항상 { state:'unknown', reason:'not_set' }
  autoPnl: Metric<null>;                  // v1 항상 { state:'unknown', reason:'baseline_unset' }
  buyable: ByMarket<Metric<{ native: number; currency: 'KRW' | 'USD'; krw: number | null; fxAt: string | null; fxSource: 'fx_rates' | 'fallback' | null }>>;
}
export interface ExitLines {                // X1·X3·X4 (홈 3줄)
  engine: Metric<{ enabled: boolean; hardStopEnabled: boolean }>;
  lastEval: ByMarket<Metric<{ at: string; runsToday: number }>>;        // off_hours = 장외
  nextOverseasOpenKst: string | null;
  judgments: ByMarket<Metric<{ noFire: number; hardStopOffHit: number; hardStopOffDays: number; dataErrors: number; fired: number; trailingActive: number }>>;  // 종목 수
  proposals: Metric<{ virtual: number; awaitingApproval: number; submittedLive: number; blockedByKill: number; filled: number; firstKind: string | null; firstAt: string | null }>;
}
export interface ActivityItem { at: string; kind: 'analysis' | 'order' | 'signal_block'; title: string; sub: string }
export interface HomeDTO {
  generatedAt: string; stage: OpsStage;
  checks: Section<CheckItem[]>;
  counts: Section<{ approval: ByMarket<number>; earliestExpiry: { symbol: string; at: string } | null; rejectedToday: number }>;
  observe: Section<ObserveSet> | null;     // stage ∈ observe|halt|unknown 일 때만
  live: Section<LiveSet> | null;           // stage ∈ mixed|live 일 때만
  exit: Section<ExitLines>;
  activity: Section<ActivityItem[]>;
}
export type DataSourceId = 'portfolio_snapshot' | 'fx_usdkrw' | 'daily_bars_kr' | 'daily_bars_us' | 'news_domestic' | 'news_overseas' | 'broker_ledger';
```
`TradeDTO`·`FunnelDTO`·`AnalysisDTO` 는 아래 각 절의 모양대로 같은 파일에 둔다. **필드 이름을 바꿀 때는 WP-A 가 바꾸고 B·C 에 알린다**(B·C 가 이 파일을 고치지 않는다).

### 4.2 `GET /api/ops/safety-state` → `SafetyStateDTO`

- 파일: `src/app/api/ops/safety-state/route.ts` + `src/lib/ops/metrics/safety-state.ts`(로직) + `stage.ts`(`deriveOpsStage`, 순수).
- 순서: `ping()` 실패 → `errors:['db_unreachable']`, 나머지 null, `stage:'unknown'`. 성공 → 병렬로 `isDryRun()`·`isKillSwitchActive()`·`readExitEngineSwitch()`·`SELECT validation_status, enabled, COUNT(*) FROM strategies GROUP BY 1,2`·`notify_signal_auto_submit` 1행.
- **같은 판독기**: 주문 경로가 쓰는 `isDryRun`(`safety/dry-run.ts`)·`isKillSwitchActive`(`safety/kill-switch.ts`)·`readExitEngineSwitch`(`strategy/exit-switch.ts`)를 그대로 부른다(설정 GET 의 `overrides` 재해석을 따라 하지 않는다 — 설정 라우트 주석 89~95행의 이유). 검증 통과 = `VALIDATED_STATUSES`(`safety/validation-gate.ts`) import.
- `deriveOpsStage({ liveTrading, killSwitch, validatedEnabled }, errors)` = §2.2 표. 하나라도 null → `unknown`.
- [가능성 높음] `isDryRun`·`isKillSwitchActive` 는 읽기 실패 때 예외 대신 안전 쪽 값(DRY_RUN ON·킬 ON)을 돌려준다 → 그 경우 띠는 「관찰」/「중지」로 보이며 **틀린 쪽으로 위험하지는 않다**. 단 `ping()` 을 먼저 봐서 DB 자체가 안 되면 `unknown` 으로 정직하게 보인다.
- 부작용: `isKillSwitchActive` 는 값 해석 불가 때 `sendAlert`(경보)를 낼 수 있다 — 기존 `/api/health` 도 같은 판독기라 새 동작이 아니다. 띠는 30초 재조회이므로 경보 스로틀에 기댄다 [확실: `kill-switch.ts:118` `reportUnparsableKillSwitch` 가 `shouldReportUnparsable` 로 먼저 거른다].

### 4.3 `GET /api/ops/home` → `HomeDTO`

파일: `src/app/api/ops/home/route.ts` + `src/lib/ops/metrics/{home,checks,analysis-runs,postmortem-sample,anomalies,exit-lines,activity,signal-counts,live-set,sessions}.ts`. 안에서 `safety-state` 로직을 한 번 부르고 단계로 세트를 고른다.

### 4.4 `GET /api/ops/trade` → `TradeDTO`

```ts
export interface TradeDTO {
  counts: Section<{ approval: ByMarket<number>; detected: number; watching: ByMarket<number>; executing: number; nextSession: number; preOrderBlockedToday: number }>;
  holdings: Section<{ snapshotAt: string | null; stale: boolean; trailing: { activatePct: number; drawdownPct: number; source: 'override' | 'default' };
    rows: { symbol: string; market: Market; auto: boolean; pnlPct: number | null; zone: 'hard_stop' | 'eod_cut' | 'take_profit' | 'trailing_active' | 'neutral' | 'not_evaluated'; detail: { thresholdPct?: number; fromPeakPct?: number } }[] }>;
  openOrders: Section<{ symbol: string; market: Market; side: 'buy' | 'sell'; qty: number; filled: number }[]>;
}
```
- `holdings.rows`: 계좌 전체(D3) = 최신 `portfolio_snapshots.positions`(현금 행 제외) ∩ `position_state`(entry·peak). `auto` = 자동 귀속(§4.7 B2) 종목이면 true. `zone` 판정 = 청산 엔진과 같은 임계 — **엔진의 판정 함수(`evaluateExit`)를 부르지 말고**(부작용·의존 회피) 스타일 기본값(`src/lib/strategy/style.ts` — `hardStopPct`·`eodLossCutPct`·`targetProfitPct`·`trailing*` 정의 위치 [확실: grep]) + `system_config.style_default_*` override(운영은 트레일링 3.5/1.2 만 — 계약 §11.8)를 읽어 순수 함수 `classifyExitZone()`(신규, `src/lib/ops/metrics/exit-zone.ts`)로 계산하고, 시험에서 `style.ts` 기본값을 import 해 같은 값인지 대조한다(드리프트 방지). 국내 `eod_cut` 은 평일 15:20~15:29 KST 에만, 해외는 미국 정규장이 아니면 `not_evaluated`.
- `openOrders`: `orders WHERE status IN ('accepted','partially_filled') AND created_at >= 세션 시작` + `executions` 수량 합.

### 4.5 `GET /api/ops/funnel?market=domestic|overseas` → `FunnelDTO`

```ts
export interface FunnelDTO {
  defaultMarket: Market;                       // MAX(eval_funnel.ts) 가 더 최근인 시장
  sessions: ByMarket<{ session: SessionRef; anomalies: number; lastRunAt: string | null }>;
  market: Market; summary: Section<ReturnType<typeof getEvalFunnelSummary> extends Promise<infer R> ? R : never>;
}
```
- 범위: 국내 = 마지막 국내 세션일 00:00~24:00 KST, 해외 = 마지막(또는 진행 중) ET 세션일 00:00~24:00 ET 를 KST 로 바꾼 구간. `getEvalFunnelSummary(market, start, end)`(`strategy/eval-funnel-query.ts`, import 만) 그대로 호출.
- `anomalies` = 그 범위 `verdict='error'` 행의 `COUNT(DISTINCT symbol)` — 세그먼트 글자 「이상 n」.
- 기존 `/api/dashboard/eval-funnel`(KST 자정 기준)은 **그대로 둔다**(다른 사용처 대비). `EvalFunnelCard` 만 새 라우트로.

### 4.6 `GET /api/ops/analysis?part=today|verify|data` → `AnalysisDTO`

- `today`: `ByMarket<AnalysisRunRow>` + 후보 행(`signals` 장마감 시그널: symbol·confidence(화면과 같은 해석 — `scenario-card-display.ts` `parseIndicators`·`confidenceOf` 를 서버에서도 쓰거나 같은 키를 읽는다)·status, 판단 기록이 있으면 `judgment_candidate` SKIP 행 symbol·exclusion_code) + 리서치 추적 종목 수(`stock_favorites.research_enabled=1` COUNT).
- `verify`: 사후 성과 표 `{ horizon: 1|3|5|10; n: number; medianExcessPct: number | null }[]` + 모집단 n + `x: { X1..X6 }`(§4.7) + `paperFills` 건수(라벨만).
  - 초과수익 계산 정의 = T-095 `scripts/profit-engine/postmortem-core.js`(D0 = 시그널 생성 시각의 현지 날짜, 진입 `d1open`, D+k 확정봉 종가, 비용 미국 편도 0.25%·슬리피지, 같은 D0 유니버스 평균 대비). **스크립트를 `src` 에서 import 하지 않는다**(빌드 경계) — 같은 식을 `src/lib/ops/metrics/postmortem.ts` 순수 함수로 옮기고, 시험에서 `postmortem-core.js` 와 같은 입력 3개로 같은 출력인지 대조. 오늘 밤 범위가 안 되면 `medianExcessPct: null` + 화면 `준비 중`(§2.5).
- `data`: 원천 7개 `{ id: DataSourceId; lastOkAt: string | null; state: MetricState; detail: string }` + 가동률 `{ group: 'analysis' | 'collection'; days: number; ok: number; expected: number | null; state }`.

### 4.7 지표별 출처·쿼리 요지·상태 규칙

| 지표 | 쿼리 요지 (전부 SELECT) | 0 vs 모름 vs 실패 | 기준 시각 / 오래됨 |
|---|---|---|---|
| A1 평가 종목 | `job_run_log WHERE job_id='post-market-{domestic\|overseas}' AND recorder IN ('runner_hook','route') ORDER BY scheduled_slot_at DESC LIMIT 1` → `counts_json.evaluated` | 행 없음 → `unknown`(기록 시작 21:05 전 세션 포함) · `status='failed'` → `error` · `skipped` → `off_hours`(휴장·스위치 꺼짐, `degraded_reason`) · counts 없음 → `unknown` | `started_at` · 마지막 완료 세션 슬롯보다 오래된 행이면 `stale` |
| A2 후보·시그널 | 규칙 후보 = 같은 행 `counts_json.candidates` · 시그널 = `signals WHERE scenario_source='post-market' AND market=? AND created_at >= run.started_at AND created_at < run.started_at + INTERVAL 2 HOUR GROUP BY status` (run 없으면 예정 슬롯 기준 같은 창) · AI 매수 = `judgment_candidate` BUY COUNT | 시그널 0 은 run `ok` 일 때만 `zero` · run 모름 → `unknown` · 후보 counts 없고 시그널만 있으면 `partial` | 시그널 `created_at` |
| A3 사후 추적 | 최근 20 세션일 장마감 시그널(`pending`·`skipped`·`approved*`·`expired`) × `daily_bars(is_final=1)` D0 이후 봉 수 → D+10 도달 = 추적 완료, 아니면 추적 중 · 판단 기록이 있으면 모집단 = baseline 후보 전체 | 0건 → `zero` · n<30 → `partial` | `daily_bars` 시장별 `MAX(trade_date)` < 마지막 완료 세션일 → `stale` |
| A4 데이터 이상 | 원천 7개(§4.6 data) 중 `stale/error/unknown` + `job_run_log` 오늘 세션 `status IN ('failed','missing','degraded')` + `system_config news_zero_streak:*` streak ≥2 | 원천별 상태 합. 하나도 못 읽으면 `error` · job_run_log 행이 없으면 「분석 실패는 실행 기록 뒤」(`analysisFailureKnown:false`) | 각 원천 마지막 시각 |
| 원천 신선도 한도 | 스냅샷 `MAX(ts)` > 3h(`END_MAX_AGE_MS`) · 환율 `fx_rates.fetched_at` > 24h · 일봉 위 · 뉴스 streak · 브로커 원장 `broker_fill_runs MAX(started_at)` > 26h | | |
| B1 진입 감시 | `signals WHERE status='approved_pending_entry' AND (expires_at IS NULL OR expires_at>=NOW())` 를 `valid_from<=NOW()` 감시 중 / 미래 = 다음 세션 예정, `executing` 별도, `GROUP BY market` | COUNT 0 → `zero` | 조회 시각 |
| 승인 대기 | `signals WHERE status IN (AWAITING_APPROVAL_STATUSES) AND (expires_at IS NULL OR expires_at>=NOW()) GROUP BY market` — `sqlStatusList(AWAITING_APPROVAL_STATUSES)`(`signals/statuses.ts`, import 만). `detected` 는 따로 COUNT | 0 → `zero` | |
| B2 운용 포지션 | 자동 = `orders(source IN ('signal','auto'), status IN ('filled','partially_filled'))` ⋈ `executions` 수량 합 > 0 인 종목 ∩ 최신 스냅샷 보유 · 계좌 = 최신 스냅샷 보유 종목 수 | 자동 0 은 `zero`(지금 `executions` 0행 [확실: 계약 §10.2]) | 스냅샷 `ts` |
| B3 오늘 실체결 | `executions WHERE executed_at ∈ 세션일 범위 GROUP BY market` (주문 1건 = 1건) · 청산 매도 = 그 주문의 시그널 `strategy_id='exit-engine-v1'` | 0 → `zero` | |
| B7 신규 매수 가능 | **v1 = 최신 `portfolio_snapshots` 현금 행(KRW·USD) 기준**(KIS 실시간 호출 없음) ∧ `getEffectiveOrderMax(undefined, market)`(`safety/order-limits.ts`, 읽기) 중 작은 값 · USD 환산 = `fx_rates` 행 | 스냅샷 USD 현금 행 없음 → `unknown`(0 금지 — T-056) · 환율 24h 초과·없음 → `krw:null`·`fxSource:'fallback'` | 스냅샷 `ts`(3h 초과 `stale`) |
| X1 가동 | 스위치 = safety-state · 시장별 오늘 세션 `eval_funnel WHERE gate='run' AND market=?` `MAX(ts)`, `COUNT(*)` | 장외(세션 run 0행) → `off_hours` · 장중인데 마지막 run > 15분 → `stale` · `reason='balances_unknown'` run → 그 틱 `error` | run `ts` |
| X3 판정 | 오늘 세션 `eval_funnel WHERE market=? AND stage BETWEEN 21 AND 29 AND ts ∈ 범위` 를 gate 별 `COUNT(DISTINCT symbol)` — 계약 §11.3 분류표 그대로(`exit_no_fire`=정상 0 · `exit_hard_stop_disabled`=정책 스킵 · error 게이트=데이터 이상 · `signal_created`=발화) · 일수 = 같은 gate 가 연속으로 있었던 세션일 수(30일 안) | 장외 → `off_hours` | |
| X4 제안 | `signals WHERE strategy_id='exit-engine-v1' AND created_at ∈ 세션` ⋈ `orders ON signals.consumed_order_id = orders.id` → `orders.status='dry_run'` 가상 · `blocked`+`blocked_by='kill_switch'` 차단 · `filled` 체결 · `signals.status='awaiting_approval'` 승인 대기 | 0 → `zero` | `signals.created_at` |
| X6 공백 | 오늘 국내 세션 장중 5분 슬롯 수(09:00~15:30 = 78) − `gate='run'` 행 수 | 근사 — 화면 「약」 | |
| 최근 활동 | `job_run_log` analysis 행 2 + 오늘 `orders` 최신 3 + 오늘 장중 `signals(status='skipped', scenario_source IS NULL OR <> 'post-market')` COUNT·MAX(created_at) → 4건으로 자름 | | |

### 4.8 승인 대기 숫자 불일치 수정 위치 [확실]

| 위치 | 지금 | 바뀜 |
|---|---|---|
| `src/components/dashboard/Dashboard.tsx:199` | `status=awaiting_approval,pending_approval` 목록 길이(`pending` 누락) | 파일 자체가 홈에서 빠짐 — 홈 숫자는 `/api/ops/home` `counts.approval`(서버 COUNT) |
| `src/app/recommend/page.tsx:45` | `awaiting_approval,pending,pending_approval,detected` 목록 | 목록 = `awaiting_approval,pending,pending_approval`(→ `TradeNowPanel.tsx`), `detected` 는 「관측 기록」 COUNT 로 분리, 머리 숫자 = `/api/ops/trade` COUNT |
| 서버 COUNT | 없음 | `src/lib/ops/metrics/signal-counts.ts` — `AWAITING_APPROVAL_STATUSES` 한 곳에서만 집합을 가져온다(홈·거래 같은 함수) |

`/api/signals` 라우트(`SAFETY_PATHS`)는 바꾸지 않는다.

---

## 5. 작업 패키지

| WP | 담당 | 소유 파일(신규 N / 수정 M) | 주는 것 → 받는 것 | 규모(추정) |
|---|---|---|---|---|
| **WP-A 지표 읽기 계층·API** | Developer 1 | N `src/lib/ops/metrics/types.ts`(**T+0 먼저**) · `stage.ts` · `safety-state.ts` · `sessions.ts` · `signal-counts.ts` · `analysis-runs.ts` · `postmortem-sample.ts` · `postmortem.ts` · `anomalies.ts` · `exit-lines.ts` · `exit-zone.ts` · `live-set.ts` · `checks.ts` · `activity.ts` · `home.ts` · `trade.ts` · `funnel.ts` · `analysis.ts` · `read-only.ts`(쿼리 래퍼·상한) · `__tests__/*` · `src/app/api/ops/{safety-state,home,trade,funnel,analysis}/route.ts` · `src/lib/safety/live-trading.ts` + 시험 | → `types.ts`·`live-trading.ts` 를 B·C 에 먼저 | 신규 ~25파일, 약 1,800~2,400줄(시험 포함) |
| **WP-B 내비·홈·공용 UI** | Developer 2 | N `src/components/nav/NavIcons.tsx` · `src/components/ops/ops.module.css` · `src/components/ops/ui/*.tsx`(§2.0 12개) · `src/components/ops/useOpsPoll.ts`(재조회·오래됨 훅) · `src/components/ops/format.ts`(§2.1) · `src/components/home/{HomeScreen,CheckSection,OpsSection,ExitLogicSection,AnalysisSection,ActivitySection}.tsx` · `src/components/home/check-copy.ts`(kind→문구) · 시험 / M `src/components/BottomTabs.tsx` · `src/app/page.tsx` | ← `types.ts` / → 공용 UI·`format.ts`·`useOpsPoll` 을 C 에 (**B1 단계에서 먼저 커밋 전 공유**) | 신규 ~22, 약 1,500줄 |
| **WP-C 거래·분석·설정·용어** | Developer 3 | N `src/app/recommend/TradeNowPanel.tsx`(page 본문 이동) · `src/app/recommend/TradePage.tsx` · `TradeHoldPanel.tsx` · `TradeLogPanel.tsx` · `src/app/recommend/route-resolve.ts` · `src/app/analytics/route-resolve.ts` · `src/app/analytics/{TodayPanel,VerifyPanel,DataPanel}.tsx` · `src/app/recommend/WatchCancelSheet.tsx` · `src/__tests__/t108-terms-fence.test.ts` · 라우트·화면 시험 / M `src/app/recommend/page.tsx` · `src/app/analytics/AnalyticsPage.tsx` · `src/components/ScenarioDetail.tsx`(결과 표시만) · `src/components/dashboard/EvalFunnelCard.tsx`(props) · `MyDecisionSection.tsx`(재조회 주기 prop 만, 필요 시) · §3.2 표의 문구 파일들 · `scenario-pages-wiring.test.ts`(import 경로) · `scenario-card-display.test.ts`·`scenario-card-render.test.ts`·`settings-post-market-overseas.test.ts`(기대 문구) | ← `types.ts`·`live-trading.ts`·공용 UI | 신규 ~14, 수정 ~20, 약 1,600줄 |
| **WP-D 서버 문구(선택)** | Developer 1(WP-A 끝난 뒤) 또는 별도 | M §3.3 포함 표의 7파일 + 그 시험 | 독립 | 수정 ~12파일, 약 80줄 |

**단일 소유(충돌 방지)**: `BottomTabs.tsx`·`ops.module.css`·`src/app/page.tsx` = WP-B 만. `layout.tsx`·`globals.css`·`middleware.ts`·`db.ts` = **아무도 바꾸지 않음**. `types.ts`·`live-trading.ts` = WP-A 만(B·C 는 필요 필드를 WP-A 에 요청).

**Dashboard.tsx 처리** (WP-B): 홈에서 import 를 끊는다. 파일은 **지우지 않는다** — `TomorrowScenarioTab`(export)을 `scenario-card-domestic-golden.test.ts`·`scenario-card-render.test.ts` 가 import 하고, `usd-cash-balance-fence.test.ts:71` 이 이 파일의 `currency === 'USD'` 2건을 정확히 센다 [확실]. v1 은 `Dashboard.tsx` 를 그대로 두고(사용처 0) 후속 정리 task 로 넘긴다(삭제·이동 시 두 시험을 함께 고쳐야 함).

**순서**:
```
T+0   WP-A: types.ts·live-trading.ts·stage.ts 확정(공유) ─┐
T+0   WP-B: B1 = NavIcons·BottomTabs·ops.module.css·공용 UI·format.ts·useOpsPoll ─┐
T+0   WP-C: C1 = 문구 변경(§3.2)·route-resolve 2개·용어 회귀 시험(데이터 무관)     │
T+1h  WP-A: safety-state·home 라우트 ─→ WP-B: B2 = HomeScreen(합성 DTO 로 먼저, 라우트 나오면 연결)
T+2h  WP-A: trade·funnel·analysis ─→ WP-C: C2 = 거래·분석 패널(공용 UI 사용)·ScenarioDetail 결과·감시 취소
T+3h  통합: tsc·jest·next build → Reviewer(scope 는 WP 별) → QA
WP-D: A 완료 뒤, 별도 커밋·별도 Reviewer 줄
```

---

## 6. 시험 계획

환경 [확실]: jest 29 + `testEnvironment: 'node'` + swc, **jsdom·@testing-library 없음**. 화면 시험은 기존 방식대로 `react-dom/server` `renderToStaticMarkup`(+ 필요하면 `useState` 초기값 주입 목 — `scenario-pages-wiring.test.ts` 방식). 클릭·포커스·스크롤은 jest 로 못 본다 → QA 브라우저 확인.

| # | WP | 시험 | 통과 조건 |
|---|---|---|---|
| A-1 | A | `live-trading.test.ts` | §3.5 6가지 |
| A-2 | A | `stage.test.ts` | 16조합 표(dryRun·kill·validatedEnabled 0/1 · null) → 기대 단계, `halt` 우선 |
| A-3 | A | `ops-read-only-fence.test.ts` | `src/lib/ops/metrics/**`·`src/app/api/ops/**` 소스에 쓰기 SQL 키워드 0 · `submitOrder`/`createOrder`/`@/lib/exchanges/kis`/`getUsdKrwRate` 0 · `src/app`·`src/components` 에 `!\s*(safety\??\.)?dryRun` 0 |
| A-4 | A | `signal-counts.test.ts`(목 pool) | SQL 에 `'pending'` 포함·`'detected'` 미포함·만료 절 포함, market 별 GROUP BY |
| A-5 | A | `sessions.test.ts` | 해외 세션 범위 — 10-30(금) ET·10-31(토) 08:00 KST 에 마지막 세션 ET 10-30 · DST 종료(11-01) 뒤 11-02 개장 23:30 KST · 휴장표 연도 없음 → `holidays_unknown` |
| A-6 | A | `metric-state.test.ts` | 행 없음 `unknown` / 오류 `error` / 0 `zero` / 1146 `prep:not_migrated` / 스위치 꺼짐 `prep:record_off` / `engine_release IS NULL` 행 제외 / candidate_count 불일치 `partial` |
| A-7 | A | `exit-zone.test.ts` | 임계 경계(−1.5 정확히·+2.5 정확히)·트레일링 override 3.5/1.2 · 기본값이 `style.ts` 값과 같음 · 경계 비교 방향(`≤`·`≥`)이 `exit-engine.ts` 조건과 같음(계약 §11.1 표) |
| A-8 | A | `postmortem.test.ts` | `postmortem-core.js` 와 같은 입력 3개 → 같은 출력(구현했을 때) |
| A-9 | A | 라우트 5개 `route.test.ts` | 봉투·섹션 실패 격리(한 섹션 throw → HTTP 200 + 그 섹션 error)·전체 실패 503·`dynamic` |
| B-1 | B | `bottom-tabs-t108.test.ts` | 링크 4개 순서·라벨·href, 비서 없음, 활성 규칙(`/strategy`→거래, `/favorites`→분석, `/ai`→없음), `aria-current` 1개, 라벨 11px, SVG 도형 수 3·5·6·2, `HIDDEN_PATHS` 값 불변 |
| B-2 | B | `home-render-t108.test.ts` | 합성 DTO × 단계 4 × 데이터 상태 6 → 섹션 순서·데모 핵심 문구(§2.2~2.3.7 표의 굵은 문구) 존재, 「0」 은 `zero` 일 때만, 관찰 단계에 손익 숫자 없음, 띠 `unknown` 문구 |
| B-3 | B | `format.test.ts` | §2.1 각 행, U+2212, fallback 환산 숨김 |
| C-1 | C | `route-resolve.test.ts` | §1.2 표의 모든 행(옛 `?tab=` 8종 포함) |
| C-2 | C | `t108-terms-fence.test.ts` | §3.4 |
| C-3 | C | `scenario-pages-wiring.test.ts`(경로만 수정) | 기존 기대 전부 통과 |
| C-4 | C | `scenario-detail-result-t108.test.ts` | 결과 상태 6종 문구(목 응답: ok·400·403 validation_gate·네트워크 throw·거절 ok/실패) — 승인 요청 URL·본문이 지금과 같음(`/api/signals/custom/confirm` 키 목록 스냅샷) |
| C-5 | C | `watch-cancel-sheet.test.ts` | 제목·버튼 문구·`DELETE /api/signals/{id}` 그대로 |
| 전체 | — | 기존 시험 전부 | `node ./node_modules/jest/bin/jest.js` 실패 0 — 특히 `app-shell-render`·`app-version-gate-t091`·`usd-cash-balance-fence`·`risk/isolation`·`scenario-*` |

**412px·360px 가로 넘침 검사(QA, 수동+스크립트)**: 개발 서버에서 Chrome DevTools 장치 모드 360·412·1280, 화면마다(홈·거래 3·분석 3·설정) 콘솔에서 `document.documentElement.scrollWidth > innerWidth` false, `[...document.querySelectorAll('button,a')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&(r.height<44||r.width<44)})` 0(하단 탭·행 링크), 11px 미만 글자 0(`getComputedStyle(el).fontSize`). 데모 대조 체크리스트 = §2 표의 문구·순서.

**딥링크 호환(QA)**: §1.2 표의 URL 을 하나씩 열어 도착 화면·활성 탭 확인. 텔레그램 「앱에서 자세히」 → `/` 홈(앱·웹 둘 다 — 앱은 실기기 확인 대기 상태라 웹 확인으로 대신 가능).

**Reviewer·QA 가 볼 위험 지점**:
1. 실거래여부 방향 — 설정 토글을 켜고 끌 때 PATCH 본문 `dryRun` 값(ON→`false`, OFF→`true`)을 네트워크 탭으로 확인, 화면 문구·띠·ScenarioDetail 안내가 모두 같은 방향(2×2).
2. 승인·거절·감시 취소의 요청 URL·본문이 이전과 같은지(diff 로 `fetch(` 줄 비교).
3. 새 라우트가 쓰기를 하지 않는지(A-3 + 리뷰) · `/api/settings/safety` GET 을 새 화면이 부르지 않는지.
4. 「0」 이 `unknown`·`error` 대신 나오는 곳이 없는지(특히 A2·X3 장외·B7 USD).
5. 세션일 — 해외를 KST 자정으로 자른 쿼리가 없는지.
6. `job_run_log` 롤업 runs 를 숫자로 그린 곳이 없는지.
7. `risk/isolation.test.ts` — 새 파일이 `risk_policy`·`@/lib/risk`·`/api/settings/risk-policy` 를 참조하지 않는지.

---

## 7. 구현 순서·완료 기준·롤백

| 단계 | 내용 | 중간 검증 |
|---|---|---|
| 1 | WP-A `types.ts`·`live-trading.ts`·`stage.ts` + 시험 | `npm run typecheck` 0 · A-1·A-2 |
| 2 | WP-B B1 · WP-C C1(병렬) | typecheck · B-1·B-3·C-1·C-2 |
| 3 | WP-A safety-state·home | A-3~A-6·A-9 · 개발 서버에서 `curl -b 세션 /api/ops/home` 응답이 §4.1 모양 |
| 4 | WP-B HomeScreen 연결 | B-2 · 개발 서버 412px 홈 |
| 5 | WP-A trade·funnel·analysis → WP-C C2 | A-7(~A-8) · C-3~C-5 |
| 6 | 통합 | `typecheck` 0 · `jest` 전체 실패 0 · `npm run build` 성공 · `git diff --stat main -- capacitor.config.ts android public/app-shell` **0줄** · `git diff --stat main -- src/lib/db.ts scripts/migrations src/middleware.ts src/app/globals.css src/app/layout.tsx` **0줄** |
| 7 | Reviewer — 판정 줄 scope 는 실제 검토 경로: 최소 `src/lib/safety/live-trading.ts`(+시험), WP-D 를 하면 그 파일들. `src/app/api/ops/**`·`src/lib/ops/**` 는 SAFETY_PATHS 밖이지만 **검토 대상**(읽기 전용 경계) | |
| 8 | QA — §6 수동 항목 + 첫 배포 상태 확인(아래) | |
| 9 | 배포 — **웹 배포만**(push = blue/green). `--with-migrate` 없음(DDL 없음). APK 재빌드·`versionCode` 변경 없음 | `/api/health` · 운영 홈 |

**완료 기준(DONE WHEN)**
- 승인 데모 v3 의 홈·거래·분석·설정 구조와 §2 문구가 화면에 있고, 비서는 없다(4칸).
- **첫 배포 상태가 빈 화면이 아니다**: 운영 DB 그대로에서 홈이 — 띠 「관찰 (실거래 차단)」·칩 실거래여부 OFF·모든거래차단 OFF·검증 통과 0/16·청산 엔진 ON·손실한도 손절 OFF — 를 보이고, A1 은 배포 시각에 따라 해외/국내 줄이 `◌ 미수집 — 실행 기록 전` 또는 값, AI 매수 판단·제외 사유는 `준비 중`(판단 기록 꺼짐), 청산 로직은 국내 마지막 평가 시각 또는 `장외`, 확인 필요에 「손실한도 손절 OFF — 한도 도달 n종목」(조건 충족 중이면)과 「분석 실패 여부는 아직 알 수 없습니다」(해당 시장 기록 전이면)가 보인다. 「0」 이 아닌 곳에 0 이 없다.
- 옛 URL(§1.2) 전부 도착, 텔레그램 링크 `/` 정상.
- 360·412px 가로 넘침 0, 1280px 두 열.
- 네이티브·DB·미들웨어·토큰 변경 0.

**롤백**: 문제 커밋을 `git revert <sha>`(WP 별 커밋이면 그 커밋만) → push → blue/green 재배포. DB·네이티브 변경이 없으므로 코드 되돌림으로 끝난다. 새 라우트가 남아도 읽기 전용이라 해가 없다.

---

## 8. 데모 E 절 8곳 · 자체 점검 · Developer 재량 경계

### 8.1 E 절 Designer 판단 8곳 — 처리

| E | 데모 판단 | 구현 처리 |
|---|---|---|
| 1 | 청산 상세: 판정(X1·X3·X4·X6) → 분석 › 검증·성과, X2·X5 → 거래 › 보유·주문 | 그대로(§2.4.4·§2.5) |
| 2 | 장중 룰 깔때기를 홈에서 뺌 | 그대로 — 홈에 `EvalFunnelCard` 없음, 거래 › 운영 기록에만 |
| 3 | 「중지」 띠 라벨 | 그대로 + §2.2 우선순위(`halt` > `observe`)를 정본으로 |
| 4 | 혼합 단계 B4 「◌ 기준 미설정」 | 그대로. 추가로 v1 은 **실거래 단계도** B4 를 같은 상태로 둔다(자동 귀속 손익 연결 전 — §2.3.4). 계좌 전체 손익(B5) 숫자는 v1 에서 링크로 대체(§2.3.4 foot) |
| 5 | 손실한도 손절 한도 도달을 확인 필요에도 | 그대로(§2.3.2 #6) |
| 6 | 최근 활동 원천 | §2.3.7 — 첫 배포엔 `orders`·`signals` 만, 분석 완료 줄은 `job_run_log` 행이 생긴 뒤 |
| 7 | 하단 탭 글자 11px | 그대로 |
| 8 | 비서 5칸 「보류」 표지 | 구현하지 않음 — 4칸(①A) |
| 9 (신규) | 설정 머리 미니 띠 | v1 생략(§2.6 이유) — Leader 확인 |

### 8.2 자체 점검 P2 3건 · a11y Minor 3건

- **[확실] 항목 내용이 기록돼 있지 않다** — task 이력서 Designer 기록(17:25)과 데모 파일에는 건수만 있고 항목이 없다. 지어내지 않는다.
- 대신 이 가이드에서 구현 단계로 넘어가며 다시 본 것(같은 등급으로 처리):
  - (P2) 거래·분석 세그먼트가 URL 을 바꾸는데 `aria-pressed` 버튼이다 → 데모대로 버튼 + `aria-pressed` 를 유지하고, 상세 보기 머리의 `‹` 버튼에 `aria-label="{세그먼트} 목록으로"` 를 단다.
  - (P2) 띠 칩 영역은 가로 스크롤인데 스크롤바가 숨겨져 넘친 칩이 안 보일 수 있다 → 412px 에서 칩 5개가 한 줄에 들어가는지 QA 확인, 안 들어가면 오른쪽 끝 페이드(`mask-image`) — 숨김 그대로는 안 된다.
  - (P2) 「최근 활동」 시각만 있고 날짜가 없는 줄이 자정을 넘으면 오해 → 오늘이 아니면 `MM-DD HH:MM`(§2.1).
  - (Minor) 확인 필요 0건일 때 섹션 제목 small 이 비어 「확인 필요」만 남음 → small 에 `0건` 을 쓰지 않는다(데모 625행 그대로) — 빈 상태 문장이 대신한다.
  - (Minor) `.sw i`(칩 안 회색 이름)는 `--muted` on `--bg3`, 대비 [가능성 높음] 약 5:1 — QA 가 실측.
  - (Minor) 승인 결과 `.res` 로 포커스를 옮길 때 `aria-live` 가 함께 읽혀 두 번 읽힐 수 있다 → `.res` 는 `role="status"` 없이 `tabIndex=-1` 포커스만(데모 944행과 같음).

### 8.3 Developer 가 정하면 **안 되는** 것

- 단계 파생 규칙·우선순위, 「0」 표시 조건, 상태 칩 문구·모양, 용어 표기(§3.1), 섹션 순서, 탭 순서·라벨·아이콘.
- 승인·거절·취소의 API·요청 본문·확인 단계, 안전 토글의 위치·저장 흐름.
- 새 URL 경로(화면), 새 토큰·색 의미, 손익 숫자를 관찰 단계에 보이는 것.
- 쓰기 SQL, 외부 호출(KIS·FX) 추가, `/api/settings/safety` GET 을 새 화면에서 부르는 것.
- 데이터가 없을 때 그럴듯한 숫자(예: 기본 환율 1380 으로 환산)를 보이는 것.

### 8.4 Developer 가 정해도 **되는** 것

- 컴포넌트 내부 분해·파일 이름(§5 표의 소유 경계 안에서), 훅 구조, CSS Module 안의 선택자 정리(시각 결과가 데모와 같을 때).
- 쿼리 세부(인덱스를 타는 한), 섹션 병렬화 방식, 시험 파일 배치.
- 데모 문구의 조사 처리(`{n}건`·`이/가`), 숫자가 길 때 줄바꿈 위치(`word-break: keep-all` 유지).
- 오류 코드 짧은 분류어 이름(§4.0 예와 같은 결이면).

---

## 9. 열린 질문

**사용자에게 물을 것: 0건.** 아래는 Leader 결정(권고안 포함).

| # | 결정 | 권고 | 이유 |
|---|---|---|---|
| L-1 | `/markets`(시장 상태 상세) 입구가 사라진다 | (a) **분석 › 데이터 상태 「원천별 신선도」 아래 행 `시장 개장 상태 ›` 1줄 추가**(데모의 행 모양 그대로) / (b) v1 은 입구 없음 | 기능 손실을 막는 가장 작은 변경. 승인 범위 해석상 Leader 판단 |
| L-2 | WP-D(텔레그램·경보 문구)를 오늘 밤 범위에 넣나 | **(b) 별도 커밋으로 내일 이후** — 오늘은 화면만 | SAFETY_PATHS 시험 7개+ 기대값 변경 + Reviewer scope 분리. 사용자 요청은 「모든 화면」이라 화면만으로 요청은 충족, 텔레그램은 그 다음. 미루면 며칠간 화면 「모든거래차단」 / 텔레그램 「킬스위치」 혼재(알려 둘 것) |
| L-3 | 사후 성과 「초과수익 중앙값」을 오늘 밤 하나 | 시간이 모자라면 **건수 열만, 중앙값은 `준비 중`** | 정의 이식 + 대조 시험이 필요(§4.6) — 틀린 숫자보다 빈 칸 |
| L-4 | 설정 화면 T-104 선행 합의를 깨도 되나 | **문구만 바꾸는 조건으로 진행** | 불편한 사실 3 |
| L-5 | B5(계좌 전체 손익) 숫자 → 링크 대체 | **대체**(§2.3.4) | 조회가 쓰기를 할 수 있는 경로를 60초 재조회에 붙이지 않는다. 실거래 전환 전엔 보이지 않는 칸 |
| L-6 | `Dashboard.tsx` 를 남겨 둘지 | **남김 + 후속 정리 task** | 시험 3개가 의존(§5) |
| L-7 | 설정 머리 미니 띠 생략(E-9) | **생략** | §2.6 |

## 10. `docs/screens.md` 갱신 범위 (이 가이드와 함께 Designer 가 직접 반영함)

`screens.md` 는 "문서를 먼저 고친 뒤 코드를 맞춘다"는 단일 진실 문서라 구현 전에 새 구조로 바꾼다. 반영 범위:

| 절 | 바꾼 것 |
|---|---|
| 머리 | T-108 구현 진행 중 표지 — 배포 전까지 운영 화면은 이전 구조(대시보드·즐겨찾기·추천·분석·설정)라는 한 줄 |
| §1 | 하단 탭 표를 4칸(홈 `/` stone · 거래 `/recommend` handshake · 분석 `/analytics` scan-search · 설정 `/settings` settings)으로, 비서는 T-113 뒤 4번째. 활성 규칙·라벨 11px·안전 상태 띠. **옛 문서의 5탭(채팅 포함)이 실제 코드(즐겨찾기·추천)와 달랐다는 정정** 포함 |
| §2 | 워크플로우 그림의 「💡 추천 탭」 → 「거래 › 운용 현황」 |
| §3 | 대시보드 절 → **홈** 절(6영역 요약), 추천 절 → **거래** 절(3칸·딥링크), 분석 절 머리에 **3분류 + 옛 8탭 상세 매핑**, 설정 절에 용어 변경·자동매매 자금 2행. 옛 상세 서술(리서치분석·거래 이력·설정 카드 등)은 그대로 둔다(상세 보기 안에서 같은 화면) |
| §4 | 이동 경로: `/analytics?tab=orders` → `/recommend?tab=log&detail=orders` 등 새 딥링크 · 공용 컴포넌트 표에 `SafetyStrip`·`MetricTile`·`StatusChip`·`SegmentControl` 추가, `SafetyBar` 「사용처 0」 정정 |
| §7 | 이력 한 줄(2026-10-30 T-108 승인 데모 v3) |

§5(앱 전용 화면)·§6 은 바꾸지 않는다.

## 부록 — 이 가이드에서 확인하지 못한 것

- `ScenarioDetail` 의 매도(청산 익절) 시그널 승인이 실제로 어떤 경로·응답을 내는지(`custom/confirm` 의 `direction:'sell'`) — §2.4.3 매도 안내 문구는 Developer 확인 뒤.
- `isDryRun`·`isKillSwitchActive` 의 DB 오류 시 반환값(코드 머리만 읽음) — §4.2 [가능성 높음].
- `GET /api/cash-ledger` 가 조회 중 실제로 쓰는지(`persisted` 플래그만 봄).
- `portfolio_snapshots.positions` 에 현재가·현금 행(USD)이 어떤 모양으로 있는지 — B7·X5 쿼리 작성 때 확인(현금 행 판별은 `kill-switch.ts isUsdRow` 와 같은 식).
- `job_run_log` 개발 행 혼입 가능성(열 없음).
- 앱(WebView) 실기기에서 sticky 띠 + 업데이트 띠의 겹침 — 웹 브라우저 확인만 가능.
- 운영 DB 조회·서버 명령은 이 가이드 작성에서 하지 않았다(지시대로) — 운영 수치는 계약 §10.2·§11.8 인용뿐.
