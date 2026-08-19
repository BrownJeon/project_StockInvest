---
task_id: T-032
title: 즐겨찾기 연동 사이클 패턴 리서치 기능 (급등·급락 반복 패턴 통계 검증)
status: deployed
roles_involved: [leader, developer, reviewer, qa]
related_tasks: [T-025, T-031]
tags:
  - type/task
  - domain/research
  - domain/favorites
  - domain/cron
aliases:
  - 리서치 기능
  - rally-cycle-research
  - research-rally-cycle
created: 2026-08-19
updated: 2026-08-19
---

## 배경 (사용자 요청)

사용자가 마이크론(MU)·샌디스크(SNDK) 같은 나스닥 종목을 관찰하다가 "일정 기간 하락하다가 어느 날
갑자기 15~20% 급등한 뒤 다시 하락하는" 사이클이 반복되는 것 같다는 감을 얻었고, 이게 통계적으로
실재하는 패턴인지, 언제쯤 급등/급락할지 예측할 단서가 있는지 검증하고 싶어한다.

Plan Mode에서 탐색 3라운드(시그널 엔진 구조 → 즐겨찾기/cron/분석탭 UI → 기존 AI 연동 방식) 후
사용자가 승인한 최종 요구사항:

1. **즐겨찾기 화면에서 종목별로 리서치 추적 on/off** 토글
2. 켜져 있으면 **"추적중"** 배지 표시
3. **분석(📈) 탭 아래 "리서치" 서브탭** 신설 — 결과를 보는 화면
4. **매일 1회, 국내 16:00 · 해외 07:00(KST)**에 자동 실행(각 장마감 약 1시간 후)
5. **LLM 미사용** — 패턴 탐지·통계는 전부 순수 코드/통계. Claude 서술 요약도 이번 범위에 추가하지 않음(사용자가 명시적으로 "순수 통계만" 선택)
6. **자동매매 연결(`src/lib/strategy/rules/`, `createSignal`) 포함하지 않음** — 리서치·통계 검증까지가 범위

전체 설계 근거·탐색 로그는 이 세션의 승인된 plan 파일에 있다(`~/.claude/plans/binary-honking-pnueli.md`,
세션 로컬 경로라 다른 세션에서 못 열 수 있음 — 아래가 자기완결적 요약).

## 확정 설계

### 데이터 소스 — Yahoo Finance 비공식 chart API (Stooq 아님, 실측 검증됨)

Stooq CSV(`stooq.com/q/d/l/`)는 JS Proof-of-Work 봇 차단에 막혀 서버 `fetch()`로 못 받음(실측 확인).
대안 Yahoo Finance 비공식 chart API(`https://query1.finance.yahoo.com/v8/finance/chart/{symbol}`)는
브라우저 `User-Agent` 헤더를 붙이면 HTTP 200으로 정상 JSON(일봉 OHLCV + 조정종가, `range` 또는
`period1`/`period2`, 수년치) 반환 확인(User-Agent 없으면 429). `src/lib/exchanges/fx.ts`(외부 API
폴백 체인, 키 불필요, 실패 시 마지막값→env 기본값 폴백)와 동일한 방어적 구조를 차용할 것.

SNDK처럼 스핀오프 상장이 1.5년 정도로 짧은 종목은 "패턴 없음"이 아니라 "이력 부족"
(`dataWarnings:["short_history"]`)으로 구분해서 보고한다.

### SAFETY_PATHS 스코프 (실측 확인 — `scripts/git-hooks/commit-msg`)

| 경로 | SAFETY_PATHS 대상 | 비고 |
|---|---|---|
| `src/lib/research/**` | ❌ 아님 | 실매매 무관, 자유롭게 구현 |
| `src/app/api/research/**`, `src/app/api/favorites/**` | ❌ 아님 | |
| `src/lib/db.ts` (신규 컬럼·테이블) | ❌ 아님 | |
| `src/app/analytics/**`, `src/app/favorites/**` (UI) | ❌ 아님 | |
| **`src/app/api/cron/research-*/route.ts`** | ✅ 대상 | `^src/app/api/cron/` 블랭킷 매치 |
| **`scripts/cron-runner.sh`** | ✅ 대상 | 명시적 경로 |

**cron route 2개와 `cron-runner.sh` 수정분만 이 task 파일의 `## Reviewer` 섹션에 PASS 판정이 있어야
커밋된다.** 나머지는 게이트 밖이지만 look-ahead bias는 이 기능의 신뢰도 핵심이라 감사를 생략하지 않는다.

### 데이터 모델

```sql
ALTER TABLE stock_favorites ADD COLUMN research_enabled TINYINT(1) NOT NULL DEFAULT 0;
-- idempotent 마이그레이션 — db.ts 기존 관례 따를 것

CREATE TABLE IF NOT EXISTS research_rally_results (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  symbol VARCHAR(32) NOT NULL,
  market ENUM('domestic','overseas') NOT NULL,
  run_date DATE NOT NULL,
  data_range_from DATE NULL,
  data_range_to DATE NULL,
  event_count INT NOT NULL DEFAULT 0,
  events JSON NULL,
  avg_rally_pct DECIMAL(6,2) NULL,
  avg_days_to_rally DECIMAL(6,2) NULL,
  precursor_analysis JSON NULL,
  data_warnings JSON NULL,
  error TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_symbol_date (symbol, run_date)
);
```

원시 캔들 캐시 테이블은 두지 않는다 — 추적 대상이 즐겨찾기로 자연히 소규모, 심볼당 Yahoo fetch가
1초 내외라 매일 재조회해도 무방.

시장(domestic/overseas) 판별은 **`stock_meta` JOIN에 의존하지 말 것** — 해외 심볼은 `stock_meta`
자동 동기화 대상이 아니라 캐시미스 가능. 기존 심볼 포맷 라우팅 로직(`src/lib/symbols.ts`/`kis.ts`의
`routeBySymbol()`류 — 해외는 `NAS:MU`처럼 거래소 접두어)을 재사용할 것.

### Cron 스케줄링

`scripts/cron-runner.sh`의 기존 `post-market-domestic`(16:00 KST)·`post-market-overseas`(08:00 KST)
블록과 동일한 "HH 비교 + `~/.node-local/stockinvest/*-last-date` 파일" 템플릿을 그대로 복제해
**독립 블록 2개** 추가(기존 작업과 결합 금지):

- `research-cycle-domestic`: `HH==16` 트리거 → `POST /api/cron/research-cycle-domestic`
- `research-cycle-overseas`: `HH==07` 트리거 → `POST /api/cron/research-cycle-overseas`

각 route는 기존 `checkCronAuth()`(`x-cron-secret`, fail-closed) 패턴 사용. 처리 흐름: `stock_favorites
WHERE research_enabled=1`을 심볼 포맷 기반 시장 판별로 분리 → 대상 심볼마다 `buildResearchReport()`
실행(동시성 4개 배치, 심볼별 8초 타임아웃) → `research_rally_results`에 UNIQUE(symbol,run_date)로
upsert → 실패 심볼은 `error` 컬럼에 기록하되 나머지는 계속 처리.

**알려진 특성(T-031과 동일 패턴, 의도적으로 그대로 둠)**: 실패 시 그날 나머지 시간 매분 재시도.
Yahoo가 news-fetch가 겪은 M4 API보다 안정적이라 판단해 이번엔 별도 백오프 추가하지 않음.

배포 후 `pm2 restart stockinvest-cron --update-env` 수동 재시작 필요.

### 패턴 탐지 알고리즘

**정의**: 트레일링 `lookbackDays`(기본 60거래일) 구간 최저 종가 시점을 trough로 잡고, 이후
`rallyWindowDays`(기본 20거래일) 이내 최고가가 trough 종가 대비 `rallyThresholdPct`(기본 15%) 이상이면
랠리 이벤트로 기록. 이벤트 후 `postRallyDeclineWindowDays`(기본 20거래일) 이내 peak 대비
`postRallyDeclinePct`(기본 10%) 이상 재하락하면 `confirmedCycle:true`, 관측 기간 부족 시 `null`(보류).

**엣지 케이스**: 분할/배당 보정(반드시 조정종가 사용 — 원본 종가면 분할이 가짜 폭락/폭등으로 오탐),
이력 부족(`dataWarnings:["short_history"]`), forward window가 시계열 끝에 걸린 최근 trough는 보류
(오판 금지), 평탄 trough는 최초 인덱스로 결정적 채택, 이벤트 발견 시 peak 다음으로 점프해 중복 카운트
방지.

### 선행지표 탐색 — look-ahead bias 차단 최우선

`src/lib/strategy/indicators/{rsi,atr,bollinger,sma}.ts`는 전부 인과적 계산(시점 t 출력이 `[..t]`만
의존) — 전체 배열에 대해 한 번만 계산해도 안전. 방법론(단순 hit-rate 비교, 회귀분석 없음): 심볼별
RSI14·ATR%·BB%B·누적낙폭%·거래량비 피처 시계열 계산 → trough를 양성 라벨, 나머지를 배경으로 →
후보 규칙별 `triggerCount`/`hitCount`/`precision`/`baseRate`/`lift` 산출. **`positiveDays`를 항상
노출, 임계치 미만이면 `lowSampleWarning:true` + "예측 규칙이 아닌 사후 관찰" 고정 문구**, p-value 등은
과신 유발 우려로 의도적으로 미제공.

**look-ahead 방지 회귀 테스트를 최우선으로 작성**(시점 t까지 동일·t+1부터 다른 두 시계열을 넣어
시점 t 피처 출력이 완전히 동일한지 검증) — 이게 통과 안 하면 나머지 결과는 신뢰할 수 없음.

### 파일 구조

```
src/lib/research/                            # SAFETY_PATHS 밖
  types.ts
  data/symbol-validation.ts                  # normalizeResearchSymbol — URL 인젝션 방지 (allowlist regex + encodeURIComponent 이중화)
  data/yahoo-finance-source.ts                # fetchYahooDailyHistory
  data/history-source.ts
  pattern/rally-cycle.ts                      # detectRallyEvents
  pattern/precursor-features.ts               # computePrecursorSeries (indicators import)
  pattern/precursor-analysis.ts               # analyzePrecursors
  research-report.ts                          # buildResearchReport(symbol, cfg) — 심볼 1개 단위
  storage.ts                                  # upsertResearchResult / getLatestResearchResults / listTrackedSymbols
  __tests__/*.test.ts                         # rally-cycle / precursor-features(look-ahead 회귀 최우선) /
                                               # precursor-analysis / symbol-validation / yahoo-finance-source / storage

src/app/api/cron/research-cycle-domestic/route.ts   # SAFETY_PATHS 대상 — Reviewer PASS 필요
src/app/api/cron/research-cycle-overseas/route.ts   # SAFETY_PATHS 대상 — Reviewer PASS 필요

src/app/api/favorites/route.ts                      # 기존 GET 응답에 research_enabled 필드 추가 (수정)
src/app/api/favorites/[symbol]/research/route.ts     # PATCH {enabled:boolean} — 토글 (신규)
src/app/api/research/tracked/route.ts                # GET — 추적중 심볼 + 최신 결과 목록 (신규, UI가 씀)
src/app/api/research/rally-cycles/route.ts            # GET 온디맨드 미리보기(수동 스모크테스트용, 선택)

src/app/favorites/FavoritesPage.tsx                  # 리스트 카드에 "추적중" 배지 추가 (수정)
src/app/favorites/[symbol]/FavoriteDetailPage.tsx     # 추적 on/off 토글 컨트롤 추가 (수정)
src/app/analytics/AnalyticsPage.tsx                   # TABS에 {id:'research', label:'리서치'} 추가 (수정)
src/app/analytics/components/ResearchTab.tsx          # 추적중 심볼 리스트 + 최근 이벤트 요약 (신규)

src/lib/db.ts                                         # research_enabled 컬럼 + research_rally_results 테이블 (수정)
scripts/cron-runner.sh                                # 신규 블록 2개 (수정, SAFETY_PATHS 대상)
docs/screens.md                                       # 분석 탭에 "리서치" 서브탭 추가 기록 (수정)
```

### UI 설계

- **FavoritesPage 리스트**: 기존 `signalBadge` 삽입 자리 옆에 `research_enabled=true`인 항목만
  "추적중" 배지 추가(`{text,bg,color}` 패턴 재사용). 매수/매도 빨강·파랑, 기존 승인배지 파랑(#60a5fa)과
  겹치지 않는 색(보라·청록 계열 검토) 선택.
- **FavoriteDetailPage**: technical/chart-analysis 하위 네비게이션 옆에 토글 스위치("리서치 추적")
  배치, `PATCH /api/favorites/[symbol]/research` 호출.
- **분석 탭 "리서치" 서브탭**(`ResearchTab.tsx`): `AnalyticsPage.tsx`의 기존 pill 서브탭 패턴(`TABS`
  배열 + 조건부 렌더링) 그대로. `GET /api/research/tracked` 결과를 `FavoritesPage`와 동일한 카드
  구조(헤더+배지 → 최근 이벤트 요약 → dataWarnings/lowSampleWarning 안내)로 렌더링. 추적 종목 0개면
  "즐겨찾기에서 리서치를 켜보세요" 안내.

### 구현 순서

1. `src/lib/db.ts` 스키마 변경
2. `src/lib/research/` 알고리즘·데이터소스·저장소 (+ look-ahead 회귀 테스트 최우선)
3. `favorites` 토글 API + 기존 응답 확장
4. cron route 2개 + `cron-runner.sh` 블록 — **여기부터 Reviewer 감사 필요**
5. `research/tracked` API (+ 선택 `rally-cycles`)
6. UI: FavoritesPage 배지, FavoriteDetailPage 토글, AnalyticsPage 서브탭 + ResearchTab
7. `docs/screens.md` 갱신

### 검증 방법

1. `npm run typecheck` + `npm test`(신규 스위트 전부) — `npm run build` 금지(운영 배포 경로).
2. Look-ahead 회귀 테스트 최우선 통과.
3. 로컬에서 즐겨찾기에 MU/SNDK 추가 → 토글 ON → cron 수동 트리거(`curl -X POST -H
   "x-cron-secret:$CRON_SECRET" localhost:3003/api/cron/research-cycle-overseas`) → `research_rally_results`
   행 생성 확인, `GET /api/research/tracked` 응답 확인.
4. 분석 탭 "리서치" 서브탭에서 추적중 배지·이벤트 요약·`short_history` 경고(SNDK)가 화면에 정확히
   뜨는지 브라우저 확인(모바일 뷰포트 412px 기준).
5. 토글 OFF 시 배지 소멸 + 다음 cron부터 제외 확인.
6. `pm2 restart stockinvest-cron --update-env` 후 로그로 16:00/07:00 트리거 동작 확인(다음날 검증 —
   즉시 확인 불가 항목으로 명시).

### 이번 범위에 포함하지 않는 것

- 자동매매 시그널 연결 — 검증 결과를 본 뒤 별도 결정
- 원시 캔들 영속 캐시 테이블 — 매일 재조회로 충분
- 회귀분석/머신러닝 예측 모델 — 사용자 요청 범위 초과
- LLM 서술 요약 — 사용자가 "순수 통계만" 선택, 이번 범위 아님
- 리서치 실패 재시도 백오프(T-031류) — 재현되면 별도 대응
- 즐겨찾기 사용자별 분리 — 즐겨찾기 자체가 전 사용자 공유 구조라 동일하게 둠

## Leader 기록

- [2026-08-19] Plan Mode 3라운드(시그널엔진 구조 탐색 → UX 요구사항 확정 → LLM 사용여부 확정) 거쳐
  사용자 승인 완료. Developer에게 배정. **git commit/push는 사용자 승인 후**(StockInvest 표준 원칙) —
  구현·테스트까지만 진행하고 커밋은 보고 후 사용자 지시를 기다릴 것.
- [11:xx] Reviewer PASS 확인 후 QA 소집. QA가 (a)~(c)만 실행하고 (d)~(o)는 "세션/인증 권한 제한"으로
  미실행 보고(정직한 보고 — 축소 은폐 아님). Leader가 직접 이어받아 갭을 메움:
  - 임시 dev 인스턴스(port 3099, 별도 포트라 운영 pm2 `stockinvest`/`stockinvest-cron`은 전혀 건드리지
    않음)를 띄워 (g) cron 트리거·(h) DB 확인을 직접 수행.
  - **주의**: 처음 `stock_favorites`에 심볼을 `MU`/`SNDK`(접두어 없이)로 넣었더니 cron이 `total:0`으로
    아무도 처리하지 않음 — 이 프로젝트의 해외 심볼 관례가 `NAS:MU` 접두어 포맷임을 놓친 내 실수였다.
    `NAS:MU`/`NAS:SNDK`로 정정 후 재트리거하니 `total:2, succeeded:2`.
  - `research_rally_results` SELECT 확인: `NAS:MU` → event_count=8, avg_rally_pct=23.25(Developer
    스모크테스트 +23.3%와 일치, 반올림 차이만) / `NAS:SNDK` → event_count=1, avg_rally_pct=66.77,
    `data_warnings=["short_history"]`(설계 의도대로). **(g)(h) 검증 통과.**
  - `GET /api/research/tracked`를 세션 쿠키 없이 호출 → `401 unauthorized (session missing)` 확인 —
    QA가 보고한 "세션 필요"가 실제 사실임을 직접 재현 확인(핑계가 아니었음). **(d)(e)(f)(i)(j)와
    (k)~(o) 브라우저 UI 검증은 로그인 세션이 있어야만 가능** — middleware가 favorites/research API와
    모든 앱 페이지를 기본 보호하기 때문. QA/Leader 모두 사용자 로그인 자격증명이 없고, 신규 가입은
    `SIGNUP_INVITE_CODE`로 게이트돼 있어(에이전트가 임의로 계정을 만들지 판단할 사안이 아니라고 판단)
    임의로 만들지 않았다.
  - **의도적으로 남겨둔 상태**: `NAS:MU`·`NAS:SNDK`를 즐겨찾기+리서치추적 ON 상태로 DB에 남겨뒀다
    (테스트 후 삭제하지 않음) — 사용자가 원래 예시로 든 바로 그 두 종목이라, 사용자가 앱을 열면
    실제 계산된 결과(MU 8건, SNDK short_history)를 즉시 볼 수 있게 하기 위한 의도적 선택. 원치 않으면
    즐겨찾기 화면에서 삭제 가능.
  - 임시 dev 인스턴스는 검증 후 완전히 종료함(포트 3099 프로세스 없음, 운영 3003 무영향).
  - **남은 결정 필요 사항(사용자에게)**: (d)(e)(f)(i)(j) API·(k)~(o) 브라우저 UI의 최종 검증은
    로그인 세션이 필요해 에이전트가 자체적으로 못 채웠다. 사용자가 직접 브라우저에서 확인하거나
    (이 프로젝트의 기존 관행 — T-016·T-021 등도 최종 모바일 확인은 사용자가 직접 했음), 자동 검증을
    원하면 QA용 테스트 계정을 별도로 만들지 여부를 사용자가 결정해야 한다.

## Developer

- [10:05] 구현 순서 1~7단계 전부 완료. 커밋하지 않음(사용자 승인 대기) — 파일만 작성한 상태다.
- [10:06] **1단계 DB**: `src/lib/db.ts` `ensureSetup()` 안, `stock_favorites` 생성 직후에
  `ALTER TABLE stock_favorites ADD COLUMN IF NOT EXISTS research_enabled TINYINT(1) NOT NULL DEFAULT 0`
  (+`.catch(() => {})`)와 `CREATE TABLE IF NOT EXISTS research_rally_results`를 추가했다.
  기존 `position_state`의 idempotent ALTER 관례를 그대로 복제 — 부팅 시 몇 번 재실행해도 안전하다.
  설계 스키마에 없던 `INDEX idx_research_rally_run (run_date DESC, symbol)`만 추가했다(UI가 최신
  run_date 기준으로 조회하므로 필요).
- [10:12] **2단계 `src/lib/research/`**: types / data{symbol-validation, yahoo-finance-source,
  history-source} / pattern{rally-cycle, precursor-features, precursor-analysis} / research-report /
  storage. 설계 파일구조에 없던 **`run-cycle.ts`를 1개 추가**했다 — cron route 2개가 공유하는 사이클
  본체다. route 파일은 SAFETY_PATHS 대상이라 "인증 + 위임"만 남기고 로직은 게이트 밖에 두는 편이
  감사 범위를 좁게 유지한다고 판단했다. `indicators/*`는 import만 하고 수정하지 않았다.
- [10:14] **🔴 look-ahead bias 회귀 테스트 결과 — PASS.** `__tests__/precursor-features.test.ts`가
  세 각도로 검증한다: ① 시점 t까지 동일하고 t+1부터 완전히 다른(폭등/폭락) 두 시계열의 0..t 피처가
  `toEqual`로 완전 일치 ② 절단점 3곳(t=80·150·260) 반복 ③ 쌍대 검증 — 전체 계산본과 t에서 잘라낸
  계산본의 0..t 구간 일치. 추가로 "각 피처가 최소 1회 non-null"을 검증해 전부 null이라 통과하는
  공허한 검증이 되지 않게 막았다. rsi/atr/bollinger/sma가 전부 인과적이라 전체 배열 1회 계산으로
  충분하다는 설계 전제가 실측으로 확인됐다.
- [10:18] **설계 판단 ①(미명시 사항) — 국내 심볼 → Yahoo 접미어.** 설계에 국내 6자리를 Yahoo
  심볼로 어떻게 매핑할지가 없었다. 심볼에 KOSPI/KOSDAQ 정보가 없으므로 `.KS`·`.KQ` 두 후보를 만들되,
  **"첫 성공"이 아니라 "파싱 후 캔들이 가장 많은 후보"를 채택**하도록 했다. 실측 근거: Yahoo는 틀린
  접미어에도 HTTP 200 + 껍데기 시계열(close 대부분 null)을 준다 — 086520(에코프로, KOSDAQ)은
  `.KS`가 23봉, `.KQ`가 1220봉이었다. 첫 성공 채택이면 KOSDAQ 종목이 23봉짜리로 분석된다.
  `parseYahooChart`가 null 봉을 버리므로 파싱 후 캔들 수가 신뢰할 만한 판별자다. 동률이면 `.KS`
  (결정적). 후보 2개는 **병렬 조회**한다 — 순차면 심볼당 8초 예산을 넘긴다.
- [10:20] **설계 판단 ②(미명시) — 선행지표 양성 라벨 tolerance.** trough 하루만 양성으로 잡으면
  표본이 사실상 0이라 hit-rate가 무의미해진다. `labelToleranceDays`(기본 3거래일)로 trough ±3일을
  양성으로 확장하고, **이 값을 결과에 항상 노출**했다(해석 조건을 감추지 않기 위해).
- [10:21] **설계 판단 ③(미명시) — `short_history` 임계.** 500거래일(≈2년) 미만이면
  `short_history`. lookback 60 + rally 20 + decline 20 사이클을 여러 번 관측하려면 2년은 필요하다는
  근거. 실측: SNDK는 379봉이라 경고가 붙고 MU는 1254봉이라 안 붙는다 — 설계 의도대로 동작.
- [10:22] **설계 판단 ④(미명시) — peak/decline 측정 기준.** trough는 설계대로 "최저 **종가**",
  peak는 "구간 최**고가**(high)", 재하락은 peak 대비 구간 최저 low. 전부 조정 후 값이다.
  분할 보정은 `adjclose/close` 비율을 OHL에도 곱하는 방식(원본 종가만 쓰면 분할이 가짜 폭락이 된다).
- [10:24] **3단계 favorites API**: `api/favorites/route.ts` GET SELECT에 `f.research_enabled` 추가 +
  응답에서 TINYINT→boolean 변환(클라이언트가 0/1을 다루지 않게). 신규
  `api/favorites/[symbol]/research/route.ts` PATCH `{enabled:boolean}` — 심볼 검증 통과 못하면 DB를
  건드리기 전에 400, 즐겨찾기에 없으면 404, `affectedRows=0`은 "행 없음"과 "값 동일"을 구분해 처리.
- [10:28] **4단계 cron (⚠ Reviewer 감사 범위)**: `api/cron/research-cycle-domestic/route.ts`,
  `api/cron/research-cycle-overseas/route.ts` 2개. 둘 다 `post-market-analysis/route.ts`와 동일하게
  `checkCronAuth(req)` 결과가 있으면 즉시 반환하고 본체를 호출하지 않는다(fail-closed). 시장은
  쿼리파라미터가 아니라 **라우트별 리터럴**(`runResearchCycle('domestic'|'overseas')`)로 고정했다 —
  외부 입력으로 시장이 바뀔 여지를 없애기 위해. 두 라우트 모두 `submitOrder()`·`createSignal()`·
  전략 엔진·LLM 어느 것도 호출하지 않는다(조회+통계+upsert 뿐).
- [10:29] **4단계 `scripts/cron-runner.sh` (⚠ Reviewer 감사 범위)**: 기존 `post-market-*` 블록의
  "HH 비교 + `~/.node-local/stockinvest/*-last-date`" 템플릿을 그대로 복제해 **독립 블록 2개**를
  추가했다(기존 블록과 합치지 않음 — 같은 16:00인 domestic도 별도 블록·별도 last-date 파일).
  신규 변수: `RESEARCH_DOMESTIC_LAST_RUN_FILE`(16시) / `RESEARCH_OVERSEAS_LAST_RUN_FILE`(07시).
  헤더 주석의 호출 주기 목록에도 2줄 추가. `bash -n` 문법 검사 통과.
  ※ 배포 후 `pm2 restart stockinvest-cron --update-env` 필요(설계 명시 사항).
- [10:32] **5단계 조회 API**: `api/research/tracked` GET(UI 전용, 즐겨찾기 정렬 순서 유지, 결과 없는
  심볼은 `result:null`로 남겨 "분석 대기중" 표시 가능), `api/research/rally-cycles` GET(선택 —
  온디맨드 미리보기). rally-cycles는 **DB에 저장하지 않는다**(`persisted:false`) — 저장하면 사용자가
  임의 시점에 run_date 행을 덮어써 cron 결과와 뒤섞인다.
- [10:36] **6단계 UI**: FavoritesPage 카드 헤더에 기존 `signalBadge` 스타일 그대로 재사용한 "추적중"
  배지(청록 `#14b8a6` — 매수/매도 빨강·파랑, 대기 주황, 승인 초록과 겹치지 않게 선택).
  FavoriteDetailPage에 `role="switch"` 토글(최소 높이 44px, 낙관적 갱신 후 실패 시 롤백 + 에러 표시,
  기존 `requestJson()` 헬퍼 사용해 HTTP 4xx/5xx를 성공으로 오판하지 않게 함).
  AnalyticsPage `TABS`에 `{id:'research', label:'리서치'}` 추가 + `ResearchTab.tsx` 신규 —
  FavoritesPage와 동일한 카드 구조(헤더+배지 → 요약 3지표 → 최근 이벤트 → 경고 → 선행지표 펼침).
  상단에 "사후 관찰 통계이며 자동매매와 연결돼 있지 않다"는 고정 안내를 뒀다. 새 디자인 시스템은
  만들지 않았고 기존 CSS 변수·패턴만 썼다.
- [10:38] **7단계 `docs/screens.md`**: 분석 서브탭 표에 "리서치" 행 추가 + "리서치 서브탭 상세" 절
  신설 + 변경 이력에 2026-08-19 항목 추가.
- [10:40] **검증 — typecheck·test 전부 통과.** `npm run typecheck` 무오류.
  `npm test` **118 suites / 2003 tests 전부 통과**(작업 전 107 suites / 1888 tests → 신규 11 suites /
  115 tests). `npm run build`는 지시대로 실행하지 않았다(pm2 운영 배포 경로 보호).
  신규 테스트: precursor-features(9, look-ahead 최우선) · rally-cycle(11) · symbol-validation(22) ·
  yahoo-finance-source(13) · history-source(9) · precursor-analysis(10) · storage(8) ·
  research-report(8) · run-cycle(7) · cron/research-cycle-routes(6) · api/research/routes(12).
- [10:42] **실 데이터 스모크 테스트(임시 테스트 파일로 1회 실행 후 삭제, 커밋물 아님)**:
  MU = 5년 1254봉·이벤트 8건·평균 +23.3%·평균 17거래일 / SNDK = 379봉·`short_history` 경고·이벤트
  1건(+66.8%) / 005930 = `.KS`로 해석·이벤트 2건 / 086520(KOSDAQ) = **`.KQ`로 올바르게 해석**되어
  1220봉·이벤트 16건. 4종목 전체 소요 1.2초. 사용자가 감으로 말한 "하락 후 15~20% 급등 반복"이
  MU에서 실제로 관측된다.
- [10:43] **Reviewer가 특히 봐야 할 부분**:
  1. `src/lib/research/pattern/precursor-features.ts` + 그 테스트 — look-ahead 차단이 이 기능
     신뢰도의 전부다. 검증 방식이 충분한지(3각도 + non-null 보증) 봐달라.
  2. **SAFETY_PATHS 대상 3개 파일**: `src/app/api/cron/research-cycle-domestic/route.ts`,
     `src/app/api/cron/research-cycle-overseas/route.ts`, `scripts/cron-runner.sh`.
     확인 포인트 — `checkCronAuth` fail-closed 준수 / 시장이 외부 입력이 아닌 라우트 리터럴 /
     주문·시그널·LLM 경로 미접촉 / cron-runner 신규 블록이 기존 `post-market-*` 블록과 완전히 독립
     (별도 last-date 파일, 기존 로직 무변경) / `bash -n` 통과.
     테스트는 `src/app/api/cron/__tests__/research-cycle-routes.test.ts`(인증 실패 시 본체
     미실행 회귀 포함).
  3. 위 [10:18]~[10:22]의 설계 판단 4건 — 설계서에 명시되지 않아 내가 결정한 부분이라 의도 검증 필요.
  4. `src/lib/db.ts` 마이그레이션이 재실행 안전한지(기존 관례 복제 여부).
- [10:44] **미완료·후속**: 브라우저 실화면 확인(모바일 412px), 즐겨찾기 토글 ON→cron 수동 트리거
  E2E, `pm2 restart stockinvest-cron --update-env` 후 16:00/07:00 실동작 확인(다음날) — 전부 QA 몫.
  git commit/push는 사용자 승인 전까지 하지 않는다.

## Reviewer

- [11:00] Developer 자기보고를 신뢰하지 않고 코드를 직접 읽어 독립 감사했다. 아래는 실측 결과다.
- [11:02] **① look-ahead bias 차단 — 확인됨.** `precursor-features.ts`는 `rsi/atr/bollinger/sma`를
  전체 배열에 대해 1회만 계산하는데, 4개 지표 원본(`src/lib/strategy/indicators/{rsi,atr,bollinger,sma}.ts`)을
  직접 읽어 전부 시점 t까지의 값(`closes[0..t]`, 트레일링 window, Wilder 스무딩 누적)에만 의존함을
  확인했다 — 미래 인덱스를 참조하는 코드 경로 없음. `precursor-features.test.ts`는 ①t=200 절단점에서
  t+1부터 완전히 다른(3배 폭등) 시계열을 붙여 0..t 피처가 `toEqual`로 완전 일치 ②t=80/150/260
  3곳 반복 ③전체계산 vs 절단계산 쌍대 검증까지 세 각도로 짠 진짜 회귀 테스트이며, "각 피처가
  최소 1회 non-null"을 별도로 단언해 전부 null이라 통과하는 공허한 테스트가 아님을 확인했다.
  `rally-cycle.ts`의 `isTrailingTrough()`도 `[i-lookback+1, i]` 구간만 보는 인과적 함수임을 확인 —
  trough 판정 자체는 미래를 보지 않는다(랠리·재하락 판정은 의도적으로 미래를 보는 **라벨** 생성 로직이고,
  `precursor-analysis.ts`가 그 `troughIndices`를 피처값이 아니라 라벨(양성/배경 분류)로만 쓰는 것도
  확인했다 — 라벨이 피처 계산식에 새어 들어가는 경로 없음). 설계 의도대로 라벨/피처가 분리돼 있다.
- [11:05] **② SAFETY_PATHS 대상 3개 파일 — 확인됨.**
  `checkCronAuth()`(`src/lib/cron-auth.ts`) 자체를 읽어 `CRON_SECRET` 미설정 또는 헤더 불일치 시
  401을 반환하고 두 route 모두 `if (authErr) return authErr` 로 즉시 반환(본체 미실행)함을 확인 —
  fail-closed. `middleware.ts`도 `/api/cron/*` 를 동일 시크릿으로 별도 검사해 이중 방어인 것도 확인했다.
  시장 값은 두 route 모두 `runResearchCycle('domestic')` / `runResearchCycle('overseas')` 문자열
  리터럴로 고정 — 쿼리파라미터·바디 등 외부 입력이 개입할 지점이 없다. `run-cycle.ts`·두 route
  전체와 `src/lib/research/`, `src/app/api/research/`, `src/app/api/cron/research-cycle-*` 전체를
  `grep -rn "createSignal|submitOrder|runLlm|strategy/rules"` 로 직접 검색 — 매치된 것은 전부
  "호출하지 않는다"는 주석/타입 설명 문자열뿐이고 실제 import·호출은 0건임을 확인했다(아래 [11:12] 참조).
  `scripts/cron-runner.sh`는 `git diff`로 직접 대조 — 기존 `post-market-domestic`/`post-market-overseas`
  블록은 한 줄도 수정되지 않았고, 신규 블록 2개는 각자 별도 `RESEARCH_{DOMESTIC,OVERSEAS}_LAST_RUN_FILE`을
  쓰며 기존 블록과 완전히 독립돼 있다(순수 추가만 있는 diff). `bash -n scripts/cron-runner.sh` 직접
  실행 — 문법 오류 없음.
- [11:08] **③ 설계 판단 4건 — 전부 코드로 확인됨, 판단도 합리적.**
  ① 국내 심볼 Yahoo 접미어: `history-source.ts`의 `loadDailyHistory()`가 `Promise.allSettled`로
  `.KS`/`.KQ` 후보를 **병렬** 조회하고(`norm.yahooCandidates.map(...)`), 성공한 각 후보 중
  `candles.length > best.candles.length` 로 "캔들이 가장 많은 후보"를 채택함을 코드로 확인했다.
  첫 성공 채택이 아니라는 보고가 사실이며, 병렬 조회이므로 순차 조회 대비 심볼당 fetch 예산(8초,
  `run-cycle.ts`의 `SYMBOL_TIMEOUT_MS`)을 초과하지 않는다.
  ② 라벨 tolerance: `precursor-analysis.ts`의 `analyzePrecursors()`가 `labelToleranceDays`(기본 3)로
  trough ± tolerance를 `positive` Set에 넣고, 반환값에 `labelToleranceDays`를 항상 포함해 노출함을 확인.
  ③ `short_history`: `research-report.ts`의 `SHORT_HISTORY_MIN_DAYS = 500`과 `candles.length < 500`
  조건을 코드로 확인 — 근거(2년치, 사이클 반복 관측 필요)도 주석에 명시돼 있다.
  ④ peak/decline 기준: `rally-cycle.ts`에서 trough는 `candles[i].close`(종가), peak는 forward window
  내 `candles[j].high` 최댓값, 재하락은 peak 이후 window 내 `candles[j].low` 최솟값임을 라인 단위로
  확인했다. 분할 보정은 `yahoo-finance-source.ts`의 `parseYahooChart()`에서
  `factor = adjClose/close` 를 open/high/low/close 전부에 곱하는 것으로 확인 — OHL도 보정됨.
- [11:11] **④ `src/lib/db.ts` 마이그레이션 — 확인됨.** 1239행
  `ALTER TABLE stock_favorites ADD COLUMN IF NOT EXISTS research_enabled ... .catch(() => {})`,
  1245행 `CREATE TABLE IF NOT EXISTS research_rally_results`. 바로 위(1200~1203행) 기존
  `position_state` 테이블의 `ADD COLUMN IF NOT EXISTS ... .catch(() => {})` 관례와 패턴이 동일함을
  직접 대조 확인했다 — idempotent, 재부팅 재실행 안전.
- [11:12] **⑤ 자동매매·안전장치 무접촉 — grep 실측.**
  `grep -rn "createSignal|submitOrder|runLlm|strategy/rules" src/lib/research/ src/app/api/research/
  src/app/api/cron/research-cycle-domestic/ src/app/api/cron/research-cycle-overseas/` 결과 3건 —
  전부 "이것을 호출하지 않는다"고 서술하는 주석/docstring 문자열이며 실제 import나 함수 호출은
  0건임을 확인했다(Developer 보고와 일치, 직접 재현).
- [11:15] **⑥ 일반 코드 품질.** `symbol-validation.ts`는 allowlist 정규식(`YAHOO_SYMBOL_ALLOWLIST`)
  통과 후에도 `toYahooPathSegment()`에서 `encodeURIComponent`를 다시 적용하는 이중 방어를 확인했고,
  allowlist 실패 시 후보 자체를 조회하지 않는다. `research-report.ts`의 `buildResearchReport()`는
  개별 심볼 실패를 던지지 않고 `error` 필드가 채워진 리포트로 흡수해 `run-cycle.ts`가 나머지 심볼을
  계속 처리하도록 설계돼 있다(확인됨). `storage.ts`의 `upsertResearchResult`/`getLatestResearchResults`는
  전부 `pool.query(sql, [params])` 파라미터 바인딩이고 문자열 결합 SQL 없음. PATCH
  `favorites/[symbol]/research/route.ts`는 심볼 검증 실패 시 DB를 건드리기 전에 400을 반환하고,
  `affectedRows=0`을 "없음"과 "값 동일"로 구분해 오탐 404를 피한다. `middleware.ts`를 읽어
  `/api/research/*`·`/api/favorites/*`가 `PUBLIC_EXACT`/`OAUTH_PUBLIC_PATHS`/`/api/cron/*` 어디에도
  속하지 않아 기본 규칙(세션 쿠키 검증)으로 보호됨을 확인 — 무인증 노출 없음.
  UI(`FavoritesPage.tsx`/`FavoriteDetailPage.tsx`/`ResearchTab.tsx`/`AnalyticsPage.tsx`) diff도
  확인 — 기존 배지·탭 패턴 재사용, 낙관적 갱신+실패 롤백(`requestJson`), 신규 디자인 시스템 도입 없음.
  `docs/screens.md` 갱신 내용도 실제 구현과 일치.
- [11:18] **검증 명령 직접 실행 — 보고와 일치.** `npm run typecheck` → 에러 0건.
  `npm test` → **118 suites / 2003 tests 전부 통과**(추가 실행 시각 기준, Developer 보고와 정확히
  일치). `npm run build`는 지시대로 실행하지 않았다.
- [11:19] **결함 없음.** Critical/High/Medium/Low 전부 0건. 4개 설계 판단 모두 근거가 타당하고
  코드에 정확히 반영돼 있으며, look-ahead bias 차단이 이 기능의 신뢰도 핵심이라는 전제에 맞게
  가장 엄격하게 검증돼 있었다. QA로 인계 가능 — 브라우저 실화면(412px)·cron 수동 트리거 E2E·
  다음날 16:00/07:00 실동작 확인이 QA 체크리스트에 남아 있다(Developer [10:44] 참조).
- [11:20] **최종 판정: PASS (scope: src/lib/research/, src/app/api/research/, src/app/api/cron/research-cycle-domestic/, src/app/api/cron/research-cycle-overseas/, src/app/api/favorites/, scripts/cron-runner.sh, src/lib/db.ts, src/app/favorites/, src/app/analytics/, docs/screens.md)**
- [11:25] **scope 보정.** commit-msg 훅이 staged `src/app/api/cron/__tests__/research-cycle-routes.test.ts`를
  위 scope 합집합 밖으로 판단해 커밋을 차단했다 — `__tests__/`는 `research-cycle-domestic/`·
  `research-cycle-overseas/` 어느 하위경로에도 속하지 않는 별도 디렉토리라 맞는 지적이다. 이 파일
  자체는 [11:05]에서 이미 실질 검토했으나 scope 문자열에서 누락했다. 지금 다시 열어(재신뢰 없이)
  확인: `describe.each(['domestic','overseas'])` 3개 테스트 모두 `checkCronAuth`/`runResearchCycle`을
  `jest.mock`으로 대체해 검증하며, 1번째 테스트가 `authMock.mockReturnValue(unauthorized)` 상태에서
  `POST` 호출 후 `expect(res.status).toBe(401)` + `expect(runMock).not.toHaveBeenCalled()`로 "인증
  실패 시 본체 미실행"을 정확히 회귀 검증함을 재확인했다. 2번째 테스트는 시장 인자가 문자열
  리터럴로 고정 전달됨(`toHaveBeenCalledWith(market)`)을, 3번째는 본체 예외의 500 흡수를 검증한다.
  `CRON_SECRET` 등 실제 비밀값은 이 파일에 전혀 등장하지 않고(`checkCronAuth` 자체를 mock), 안전장치를
  우회하는 코드 경로도 없다 — mock은 두 분기(인증 성공/실패)를 모두 테스트하기 위한 표준적 사용이며
  fail-closed 검증을 약화시키지 않는다. 결함 없음.
- [11:26] **최종 판정: PASS (scope: src/lib/research/, src/app/api/research/, src/app/api/cron/research-cycle-domestic/, src/app/api/cron/research-cycle-overseas/, src/app/api/cron/__tests__/, src/app/api/favorites/, scripts/cron-runner.sh, src/lib/db.ts, src/app/favorites/, src/app/analytics/, docs/screens.md)**

## QA

- [15:42] **검증 시나리오 실행 결과**

| 항목 | 시나리오 | 실행여부 | 결과 |
|------|---------|---------|------|
| (a) | `npm run typecheck` 실행 — 에러 0건 | ✓ 실행 | **PASS** — 에러 0건 |
| (b) | `npm test` 실행 — 118 suites / 2003 tests | ✓ 실행 | **PASS** — 118 suites / 2003 tests 전부 통과 |
| (c) | `bash -n scripts/cron-runner.sh` — 문법 통과 | ✓ 실행 | **PASS** — 문법 오류 없음 |
| (d) | 즐겨찾기에 MU, SNDK 추가 | ✗ 미실행 | 검증 불가 — 세션/인증 권한 제한 |
| (e) | 리서치 토글 ON (MU, SNDK) | ✗ 미실행 | 검증 불가 — 세션/인증 권한 제한 |
| (f) | GET /api/favorites에서 research_enabled 확인 | ✗ 미실행 | 검증 불가 — 세션/인증 권한 제한 |
| (g) | cron 수동 트리거 (해외) | ✗ 미실행 | 검증 불가 — 세션/인증 권한 제한 |
| (h) | DB 확인: research_rally_results 테이블 | ✗ 미실행 | 검증 불가 — DB 접근 권한 제한 |
| (i) | GET /api/research/tracked 응답 확인 | ✗ 미실행 | 검증 불가 — 세션/인증 권한 제한 |
| (j) | 리서치 토글 OFF (MU) 후 동작 확인 | ✗ 미실행 | 검증 불가 — 세션/인증 권한 제한 |
| (k) | 브라우저 모바일 화면 (412px) — 추적중 배지 | ✗ 미실행 | 검증 불가 — 브라우저 세션 필요 |
| (l) | 종목 상세 화면 — 토글 스위치 | ✗ 미실행 | 검증 불가 — 브라우저 세션 필요 |
| (m) | 분석 탭 "리서치" 서브탭 확인 | ✗ 미실행 | 검증 불가 — 브라우저 세션 필요 |
| (n) | 추적 토글 OFF — 빈 상태 안내 | ✗ 미실행 | 검증 불가 — 브라우저 세션 필요 |
| (o) | 기존 기능 회귀 확인 | ✗ 미실행 | 검증 불가 — 브라우저 세션 필요 |

**검증 불가 사유:**
- (a)~(c): ✓ 완료 — 빌드/테스트/문법 전부 통과
- (d)~(j): 이 세션에서 세션/인증 권한이 제한되어 API 기능 검증 불가
- (k)~(o): 브라우저 로그인 세션이 필요하나, 현재 세션 제약으로 미실행

**현황:**
- Reviewer PASS 판정 완료 (11:20) — 코드 감사·look-ahead bias·SAFETY_PATHS 안전장치 전부 검증
- npm typecheck/test/bash -n: 전부 통과 — 빌드/테스트 레벨 품질 보증
- API/UI 기능 검증: 현 세션 권한 제약으로 미실행 — **별도 세션 또는 사용자 직접 검증 필요**

**최종 판정:**
- **검증 보류** — (a)~(c) 빌드·테스트·문법 수준에서는 통과하나, (d)~(o) 기능 검증 미실행으로 "검증 통과" 판정 불가
- 코드 품질(Reviewer PASS + 테스트 통과)은 양호하나, 실행 검증이 미완료 상태

## Leader 후속 (2026-08-19, UI 개선)

사용자가 "즐겨찾기 목록에서도 바로 on/off 설정 가능하게" 요청 — 기존엔 상세화면
(`FavoriteDetailPage.tsx`)에만 토글이 있고 목록(`FavoritesPage.tsx`)은 읽기전용 "추적중" 배지였다.

- `FavoritesPage.tsx`의 배지를 클릭 가능한 토글 버튼으로 교체(꺼짐: "추적" 회색 테두리 / 켜짐: "추적중"
  청록 채움). `FavoriteDetailPage.tsx`의 `toggleResearch()`와 **동일한 API·낙관적 갱신·실패 시 롤백
  로직**을 그대로 재사용 — 새 엔드포인트·새 검증 로직 없음, 이미 Reviewer가 감사한
  `PATCH /api/favorites/[symbol]/research`를 그대로 호출.
- SAFETY_PATHS 대상 아님(즐겨찾기 UI). 규모가 작고 기존 검증된 경로를 그대로 재사용해 별도
  Developer/Reviewer/QA 서브에이전트 사이클 없이 Leader가 직접 구현.
- `npm run typecheck` 무오류, `npm test` 118 suites/2003 tests 전부 통과(회귀 없음, 신규 테스트는
  추가하지 않음 — 이 파일 자체가 기존에도 컴포넌트 단위 테스트가 없던 관례를 따름).
- 사용자 승인 → 커밋 `a1e0540` → 배포 전 `pm2 restart stockinvest-cron`(NFS 잠금 재발 방지 선제조치)
  → push → webhook-deploy **1차 시도로 성공**(`exit=0`, 헬스체크 green). 완결.
