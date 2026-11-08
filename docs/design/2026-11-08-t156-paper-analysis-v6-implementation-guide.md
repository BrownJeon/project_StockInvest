# 모의분석 v6 구현 가이드

상태: 승인 v6 구현 가이드 확정. 사용자 native 응답 `v6 승인`과 정본 데모 해시 연결로 공식 record/check/activate가 2026-11-08 19:52:09 KST 통과했음을 부모가 확인했다(source: codex_native_transcript). 이 세션에서도 절대경로 check를 읽기 전용으로 재확인했다. 승인본문·게이트·앱·API·DB는 이 문서 최종화에서 수정하지 않았다.

승인 대상 데모: `mockups/T-156-paper-analysis-v6.html` (v6), SHA256 `cce67b2f0350406f2296f1495fbf446e0597a3e1cc1259f9d4f98554531758ed`.
적용 토큰: --bg/--bg2/--bg3/--bg4, --text, --muted, --accent, --border/--border2, --up/--down, --nav-h, --safe-bottom. 데모의 검토 도구·합성 숫자/날짜/경로·가상 ID는 제품에 옮기지 않는다.

## 1. 실제 코드와 범위

직접 확인한 기준: AnalyticsPage.tsx, TodayPanel.tsx/route-resolve.ts(기존 확인), M40PaperPanel.tsx/module.css, paper-view-types.ts, paper-view.ts, api/research/t156/paper/route.ts.

현재 화면은 4개 앵커(모바일2열)와 4패널 동시 노출이다. 현재 GET은 로그인 후 명시 t156_paper_viewer 검사를 거쳐 READ ONLY consistent snapshot으로 계좌 범위 자료를 읽고 private/no-store 응답을 반환한다. useOpsPoll의 keepLastOnError:false와 error일 때 data=null 처리를 유지해야 한다.

허용 구현은 명칭·고정4탭·10개 페이지·관측기간·4 horizon의 저장 미래예측 조회·사후비교 UI다. 실제 예측 엔진/agent 거래반영/운영 설정/실거래를 켜지 않는다. 현재 예측 DTO/저장 원본은 없으므로 기본 제품 상태는 `미지원 · 미검증 · 저장된 예측 없음`이다. 0%/40%/USD12,343 등 합성 예시나 경로 배열을 fallback으로 넣지 않는다. 테스트용 fixture는 격리 테스트에서만 사용한다.

## 2. UI 구조와 기존 셸 보존

- TodayPanel 입구와 route-resolve의 상세 title만 `모의분석`으로 바꾼다. 기존 URL `?tab=m40`과 딥링크는 유지한다. M40은 정책 이름이다.
- AnalyticsPage의 MiniStrip, 오늘 분석/검증·성과/데이터 상태 및 BottomTabs의 홈/거래/분석/비서/설정을 보존한다. 다른 상세/페이지에는 스타일을 전파하지 않는다.
- 상세 제목/뒤로 포커스 로직을 유지한다. M40만 전용 wrapper/측정 props를 사용해 전체 세로 스크롤 안에 둔다.
- 순서: 상세 제목 → 모의전용/회차 상태 → 저장 정책 상태 → 상위4탭 → 단일 활성 패널. 탭은 `수집상태/종목판단/모의시그널/모의성과` 한 줄, grid repeat(4,minmax(0,1fr)), min-height44px.
- 4탭 sticky top은 띠 실제 높이 + 3분류 실제 높이다. AnalyticsPage의 --strip-h만으로는 부족하므로 해당 SegmentControl wrapper 높이를 ResizeObserver로 측정해 전달한다. mount/resize/띠 갱신/폰트 변화에 갱신한다. sticky 조상이 짧은 별도 section이나 overflow:auto가 되지 않게 한다.
- 모의성과 내부는 관측된 성과/향후 예상성과/예측 사후비교 보기 버튼. aria-pressed 활성에 기존 accent 테두리·3px 하단선·bg4 배경. 모바일 내부 버튼 줄바꿈은 허용하되 상위4탭은 한 줄이다.
- 본문·페이지·포커스의 scroll-margin은 띠+3분류+4탭 실제 높이 아래로 둔다. 하단 고정 메뉴와 safe-area 여백을 보존한다.

## 3. 상태·포커스·페이지

상위4탭은 tablist/tab/tabpanel, aria-selected/controls/labelledby, 활성 tabIndex0 하나. Left/Right 순환·Home/End·Tab을 지원한다. 탭 선택 후 탭 포커스를 유지하며 폴링은 포커스를 이동시키지 않는다. 내부보기는 버튼+aria-pressed를 유지한다.

각 실제 목록은 독립 page와 최대10개 행을 가진다. 필터 변경은 해당 page1, 공유 관측기간 변경은 signals/performance page1, snapshot 만료는 해당 새 조회 page1. 페이지 범위를 clamp하며 탭 전환은 개별 페이지를 보존한다. 이전/다음은 범위·현재/전체 페이지를 표시한다. 이동 후 같은 버튼(끝에서 disabled면 반대 버튼/패널)로 포커스를 복귀하고 목록 시작을 sticky 아래로 보인다. 로딩/권한 변경은 이전 account/snapshot 데이터를 지운다.

수집 출처 집계/종목판단/시그널/평가점/사후비교 각각 목록과 요약을 구별한다. summary·정책·성과지표는 페이지 처리하지 않는다. 페이지별 결과로 전체 성과를 재계산하지 않는다. 0/1/10/11/23 행 경계에서 다음/이전/empty를 확인한다.

로딩은 status/aria-busy, 오류는 alert와 저장조회 재시도만. 401/403은 허용된 비공개 DTO·정책·예측/비교 값을 모두 제거한다. 기록 없음은 값 미확인이지 0수익이 아니다. 알려진0건과 저장응답 부재를 구별한다. 최신 blocked 회차와 lastUsableCycle의 이전 저장분 경고를 유지하며 최신으로 오인시키지 않는다.

## 4. 관측기간과 실제 DTO 연결

현재 points는 전진 평가의 session/equityUsd뿐이다. first forward→last 기준이며 0~1점은 수익률/MDD 없음, 365일 이상 완전 이력만 CAGR, realized/unrealized는 미지원이다. 현재 gapLabel은 미관측 세션 미확인을 뜻한다. cloneInvestmentUsd/registeredAt/currentEquityUsd를 forward T0·직전 확인 평가·관측 완결로 바꾸어 해석하지 않는다.

관측 보기에는 계좌 전체 기간, 선택한 전체/주간/월간, 실제 평가관측 첫/끝·관측수, 예상/관측 거래일과 기준일, 직전 확인 기준평가·마지막 평가를 분리한다. 주는 미국 세션 월~일, 월은 달력월. canonical exchange calendar가 없거나 원장 coverage가 미확인이면 예상/누락 수를 임의 평일수로 확정하지 않는다. 날짜 변환은 session_date와 실제 UTC 기록 시각을 구별해 ET 표시한다.

기간성과는 저장 확인된 직전 baseline→last에서 같은 창 수익률/평가손익/MDD를 사용한다. baseline 없음·0/1점·과거 공백·잘림은 미확인. 진행 중 주/월이 기준일까지 완전한 경우만 부분기간 성과다. 원래 투자금과 기간 시작평가는 별도이며 baseline을 clone금액으로 보충하지 않는다. 기존 보유 포함 계좌성과이며 생성기간 시그널만의 수익으로 귀속시키지 않는다.

시그널은 기본 decision session 기준 생성 필터(사용 필드 의미를 API와 일치)와 createdAt 실제 기록시각, buy/sell, executeSession 예정개장, outcome 관측을 보존한다. 현재 DTO만으로 지속 보유의 추적 시작/끝·완결·귀속손익을 알 수 없으면 미확인/미지원으로 표시한다. outcome 하나를 포지션 청산 완료·승리·추적완결로 승격하지 않는다. 개별 손익은 `집계 연결 전`이다.

## 5. 저장 예측과 사후비교

선택기는 항상 1주/1개월/3개월/1년을 보여준다. 저장예측이 없으면 선택한 기간 이름과 저장예측없음·미지원/검증전 상태를 보이되 기준일·baseline·targetEnd·평가예정일·분포를 합성하지 않는다. 확인된 저장 기준평가/발행 원본이 있을 때만 해당 ID의 날짜와 수치를 표시한다. 로컬 현재날짜나 clone금액에서 새 예측을 만들지 않는다.

horizonLabel 공통 매핑을 선택기/기준/ID/비교행/원본에 적용한다. 저장된 기간 규칙은 1주+7달력일, 나머지는 원래 기준일에서 달력1/3/12개월을 한 번에 더해 월말clamp. 다음달 함수를 반복해 날짜 drift를 만들지 않는다. 예정평가는 범위 마지막 canonical 세션. 관측 과거주월과 미래 horizon은 독립이다.

원본에 baseline/account/policy/data/model/prompt/fee/calendar/issuedAt/availableAt/targetEnd가 있으면 조회한다. 편도0.25%는 예측구간 신규 매수/매도대금 각각 차감, 과거 보유 매수비용 중복 차감 금지. 저장 모델의 gross/net·경로수·분모·quantile 방법이 없으면 수익률/손실확률을 추정하지 않는다. %는 원본 baseline 대비 해당기간 누적값이며 에이전트 확신도나 보장수익이 아니다.

사후비교는 immutable forecastId 원본과 동일조건의 관측을 연결한다. 완료는 target/evaluation 도래·관측2점 이상 완전·동일 account/policy/baseline/fee인 때만. 미도래 대기, 부족/잘림/기준없음 미확인, 조건변경 비교불가. pending에는 미래 actual/error를 넣지 않는다. actual−forecastMean과 범위 안/밖은 원본 숫자가 확인될 때만. 단일 확률을 정답/오답으로 판정하지 않는다. 새 예측은 새ID이고 과거 원본을 덮지 않는다. 저장 원본이 없는 현재 제품은 사후비교 empty가 정상이다.

## 6. 서버 조회 계약과 제한

현재 `/api/research/t156/paper?limit=`은 신호 기본20/max100, cycles1001 조회 후 성과1000cap이다. 현재 응답에 totalCount/cursor/기간 완결/직전baseline/예측이 없다. 이 일부에 클라이언트 slice만 적용한 경우 반드시 `조회된 최근 N개`로 한정하고 전체이력 페이지/전체기간성과라 부르지 않는다. 모든 이력·기간기능을 완성하려면 읽기 전용 서버 계약이 필요하다.

| 조회 영역 | 필요 계약 |
|---|---|
| 신호 페이지 | owner/account·snapshotVersion·generation session range/filter/sort 고정, ID tie-breaker, pageSize10,totalCount,nextCursor/hasNext |
| 계좌 기간집계 | 별도 full-range aggregate, 확인 baseline/time, first/last actualvaluation, expected/observed canonical sessions/gaps, partial/truncated, return/P&L/MDD/CAGR eligibility |
| 평가점 페이지 | 위 집계와 같은 snapshot/range, 독립10행 cursor; 현재페이지로 집계하지 않음 |
| 정책 상태 | 선택 run의 영속 policy/model/prompt/reflection 상태. mutable account.revision/current env로 과거 정책판을 확정하지 않음 |
| 저장예측·비교 | 미지원 capability를 명시. 실원본이 있으면 immutable forecast metadata/분포와 같은 조건 관측, count/cursor/summary. 원본없음은 empty |

API는 기존 로그인+명시 viewer 검사를 조회·count·summary 모두보다 먼저 수행하고 account 범위를 유지한다. 읽기전용 consistent snapshot, private/no-store, 오류시 비공개 폐기를 보존한다. cursor에 snapshot/range/filter/sort를 결속하고 만료는 새snapshot page1. 원본 payload/account/raw credentials를 DTO로 노출하지 않는다. 새 테이블/엔진/수집/모델 실행을 이 UI 범위에서 임의 만들지 않는다. 서버 기간집계 구현이 현재 범위를 넘으면 부모에게 명시해 조회부분/미지원 상태를 정확히 완결한다.

현재 연결은 M40 기본 매매이며 agent는 참고전용이고 판단이 매매를 바꾸지 않는다. 미호출/상태는 선택 run의 기록을 읽는다. 누락은 미확인. 실제 거래선택 연결은 미구현이고 전역 DRY_RUN을 켜고 끄는 UI를 추가하지 않는다.

## 7. 예정 수정 파일과 검증

승인된 제품 변경 대상: TodayPanel.tsx/route-resolve.ts 이름, AnalyticsPage.tsx M40 전용 높이전달, M40PaperPanel.tsx/module.css UI, 필요시 m40-paper-copy와 순수 기간/페이지 helper. API/reader/DTO 변경은 위 read-only 계약에 한정해 부모·Reviewer 범위를 특정한다. BottomTabs/다른3분류 구성·매매/runner/collector는 바꾸지 않는다. docs/screens.md는 새 명칭·실제 지원범위만 맞춘다.

검증: 360/412/1280px 가로넘침0, 모바일4탭 한 줄/44px·sticky scroll/resize, 내부 active/포커스 가시, 키보드탭/방향키/뒤로복귀, 독립목록 0/1/10/11/23건, period/reset/clamp, 403이전자료폐기, read-only 권한·count누출없음. 날짜는 월말/윤년/연교차, baseline부재/gap/cap/0~1점/부분기간 구별을 검증한다. 저장예측없음에서도4horizon과 미지원상태가 보이며 가짜 수치/날짜가 없는지 확인한다. 엔진/모델/주문 호출0 및 기존3분류/5메뉴 회귀도 확인한다. 제품에 합성 fixture/고정금액/고정확률/가상ID가 들어가지 않았는지 대조한다.

독립 Reviewer와 QA 및 승인 v6 대비 디자이너 검토 후 부모가 후속 배포 범위를 판단한다. 이 가이드는 배포·DB 변경 승인이 아니다.
