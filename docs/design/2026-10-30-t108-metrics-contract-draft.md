---
project: StockInvest
task: T-108
created: 2026-10-30
status: draft-v1
author: analyst
related: [T-112, T-104, T-114, T-095, T-096, T-100, T-081, T-074, T-072]
tags: [type/design, domain/analytics, domain/ui]
---

# T-108 운용 지표 계약 초안 (1단계, 문서 전용)

**범위**: 홈 운용현황 지표의 의미·데이터 계약만 정한다. 화면·코드·DDL·운영 설정은 바꾸지 않는다. **운영 DB 조회 0건**(U6 승인 전) — 모든 사실은 저장소 파일(`src/lib/db.ts` 부팅 DDL·`scripts/migrations/*.sql`·`docs/db-schema.md`·소스)과 인계서·task 기록에서 왔고, 그래서 이 문서에는 **운영 수치가 없다.** 확신 태그: `[확실]` 파일에서 직접 읽음 · `[가능성 높음]` 강한 추론 · `[추측]` 미확인. 공통 어휘는 공동 인계서 §5(`judgment_role ∈ {baseline, shadow}`, run status, 데이터 상태)를 그대로 쓴다.

## 0. 먼저 — 불편한 사실

1. **[확실] 11-23 증거 3종 중 2종은 기록이 없어 지금부터만 쌓인다.** 장마감 분석은 후보 전체·AI 의 BUY/SKIP·제외 사유를 저장하지 않고 **카드(`signals`, `scenario_source='post-market'`)만** 남긴다(`post-market-engine.ts` 548~600행: SKIP·confidence<60·entry_zone 없음은 `signalsSkipped++` 만). 잡 실행 기록도 없다(날짜파일·pm2 로그만, 2차 설계서 §9.5). → 「후보 사후 성과」「제외 사유 추이」는 **LLM BUY 통과 카드에 한해** 소급 가능(선택 편향), 「가동률」은 소급 불가. T-112 기록이 하루 늦을수록 11-23 까지의 증거가 하루 줄어든다.
2. **[확실] 홈 「승인 대기」는 장마감 카드의 기본 상태 `pending` 을 빼고 센다.** `Dashboard.tsx:199` 는 `awaiting_approval,pending_approval`, `/recommend` 는 `awaiting_approval,pending,pending_approval,detected`. 카드는 `status='pending'` 으로 INSERT 되므로(`post-market-engine.ts:322`) 홈 숫자와 추천 화면 숫자가 다르다. 둘 다 "조회 결과 길이(limit 100)" 이지 COUNT 가 아니다.
3. **[확실] 환율 폴백이 조용하다.** `fx.ts getUsdKrwRate()` 는 외부 실패 → 24h 넘은 DB 값 → `FX_USDKRW_FALLBACK`(기본 1380)을 **경고 로그만 남기고 숫자로 반환**한다. `/api/portfolio`·`portfolio-snapshot` 은 그 값을 그대로 USD 환산에 쓴다(스냅샷은 `rate>0` 만 검사). → USD 금액의 KRW 환산에는 반드시 `fx_rates.fetched_at` 기준 시각과 `stale/fallback` 표지를 붙여야 하며, 이것은 코드 변경 항목이다.
4. **[가능성 높음] 「자동매매 손익」「운용 포지션」은 정의해도 당장 표본이 0 이다.** T-081 기록: 2026-05-27 이후 모든 거래가 앱 밖, 현재 보유 미국 3종목은 10월 앱 밖 취득, `executions` 0행. `position_state` 는 KIS 잔고 전체를 복제하므로(`position-state.ts` 헤더) 자동 귀속 원천이 아니다. 실거래 지표는 전환 뒤에야 채워진다 — 데모에는 "표본 없음" 상태를 기본으로 둬야 한다.
5. **[확실] 「오늘 체결」은 체결이 아니다.** `EXECUTED_STATUSES = accepted·filled·partially_filled·dry_run`, 최근 20건 중 KST 오늘 생성분 길이(`Dashboard.tsx:665~692`). 접수·모의 주문이 섞이고 20건 초과는 잘린다.
6. **[확실] `eval_funnel` 은 장중 룰 엔진(`strategy-eval`)만 기록하고 30일 롤링 삭제다**(`db.ts:1365`, `engine.ts` 가 유일한 작성자). 장마감 분석은 깔때기에 없다. 11-23 시점에는 10-24 이전 행이 사라져 있다.
7. **[확실] 거래일 판정 규칙이 두 갈래다.** `market-hours.isHoliday` 는 휴장표 로드 실패 시 빈 집합(= 휴장 아님, fail-open), `us-session.loadUsClosedDaysStrict` 는 해당 연도 0행이면 던진다(fail-closed). 홈의 "세션일" 계산은 후자(엄격) 규약을 따라야 한다.
8. **[확실] `chat_threads` 에 소유자 열이 없다**(`db.ts:1002~1012`). 비서 지표·조회 범위는 T-113 전에는 "계정 1명 전제"를 넘어 정의할 수 없다.

## 1. 공통 계약

### 1.1 상태 어휘와 「실패 vs 0」 규칙

| 표시 상태 | 인계서 어휘 | 판정 근거(구체) | 숫자 표시 |
|---|---|---|---|
| 정상(값) | `available` | 원천 조회 성공 + 기준 시각이 신선도 한도 안 + 완전성 조건 충족 | 값. **0 은 `available` 이면서 건수 0 일 때만** |
| 미수집 | `unknown` | 그 세션일에 기록·행이 전혀 없음(테이블 없음 1146 포함, 예정 슬롯인데 `job_run_log` 행 없음 = `missing`) | `—` + "미수집" |
| 조회 실패 | `error` | API/DB 오류, KIS `state!='known'`, 분석 run `status=failed`/HTTP≠200 | `—` + 사유 코드 |
| 오래됨 | `stale` | 원천의 마지막 시각이 한도 초과: 스냅샷 >3h(`monthly-return.ts END_MAX_AGE_MS`), 환율 >5분(TTL)·>24h(차단선), 일봉 최신 `trade_date` < 마지막 완료 세션일 | 마지막 값 **회색 + "기준 HH:MM"** — 현재값처럼 보이게 하지 않음 |
| 표본 부족 | `partial` | n < 임계(사후 성과 n<30 — T-095 경고 규칙 재사용), 추적 미완(D+10 봉 미도달) | 값 + "n=…, 부족" |
| 검증 차단 | (상태 아님 — 정책) | D5 관문 `validation_status ∉ {backtested, paper_validated}` 또는 킬스위치 `true` | "차단" 라벨 — **0 으로 쓰지 않는다** |

- 집계는 **서버 COUNT/SUM** 으로만 한다. 목록 API 의 `limit` 결과 길이로 건수를 만들지 않는다(인계서 §6.3).
- `degraded`(실행됐으나 품질 저하, 예 `news=0`)는 정상 가동으로 세지 않고 별도 선으로 표시한다(§5 E2).

### 1.2 시각·거래일·DST

- **세션일**: 국내 = KST 달력일, 해외 = **ET 세션일**(`us-session.etDateOf`·`lastCompletedSessionEt`). 홈은 두 시장을 각자 세션일로 집계하고 KST 표시 시각을 병기한다. KST 자정(`kstTodayStart`)은 미국 정규장 한가운데(지금 22:30~05:00 KST, **11-01 DST 종료 뒤 23:30~06:00**)를 가르므로 해외 지표의 "오늘" 경계로 쓰지 않는다(결정 D2).
- 분석 run 의 기준 시각 = 분석이 쓴 마지막 확정봉 날짜(D0)와 실행 시각(`started_at`)을 둘 다 적는다. 다음 분석 예정 시각은 하드코딩하지 않고 T-104 스케줄(없으면 현행 표 + "확인 시각")에서 읽는다(통합 계획 §5-2).
- 휴장·반일: `market_holidays`(시장·날짜). 해외 세션 계산은 엄격 로더(§0-7)로 — 표에 그 연도가 없으면 "세션일 미확정" 상태.

### 1.3 통화·환율

- USD 원값과 KRW 환산을 **다른 필드**로 저장·표시한다(`daily_bars.currency`·`paper_fills.limit_price/limit_price_krw` 규약 재사용). 환산에 쓴 `fx_usdkrw`·`fx_at`(`fx_rates.fetched_at`)·출처(`fx_rates`/`snapshot`/`fallback`)를 함께 둔다. 폴백·24h 초과면 환산값 대신 `stale` 표시(§0-3).
- "주문 가능 금액"·"순예수금"·"총예수금"은 다른 값이다: 국내 `prvs_rcdl_excc_amt`(결제 완료)·`dnca_tot_amt`(총), 해외 `frcr_dncl_amt_2 − 미결제 매수증거금 = net`(T-102, `kis-overseas.ts:185~`). 홈 「신규 매수 가능 금액」은 **결제 완료/순예수금** 기준.

### 1.4 귀속과 구분

| 구분 | 정의 | 원천 |
|---|---|---|
| 계좌 전체 | KIS 잔고 전부(수동 보유 포함) | `portfolio_snapshots.positions`·KIS 잔고 |
| 자동매매 귀속 | 앱 주문 `orders.source ∈ ('signal','auto')` 로 체결된 포지션·손익 | `orders`+`executions`, 보강 `broker_fills.app_order_id`(`reconcile_state='linked'`) |
| 관찰(판단 기록) | 후보·BUY/SKIP·카드 — 주문 없음 | `signals`(카드), **T-112 baseline 기록** |
| 가상(진입만) | D5 차단 매수의 가상 체결. **청산·손익은 없다** | `paper_fills`(`quantity>0` 필터 필수, `fill_model` 층화 — db-schema R-5) |
| 실거래 | 체결 증거가 있는 것만(`executions` 행 또는 `broker_fills.filled_qty>0`) | — |

- 홈 지표는 **baseline 만**(J4). `shadow` 는 분석>추이·검증. 수동 보유를 자동 관리로 편입하는 것은 이 계약이 아니라 T-100 결정(D3).
- 관찰 기간에 `DRY_RUN` 이나 모의 체결 엔진이 있다고 가정하지 않는다 — `orders.status='dry_run'` 은 안전장치 차단 기록이지 체결이 아니다.

### 1.5 시작점(기준 재설정)

- 재사용: `system_config.cash_ledger_baseline`(T-074, `version`·`baselineAt`·`snapshotId`·동결 스냅샷·`confirmed` 현금) + `computeSummary()`(`ledger/compute.ts`: P = (V_t − B₀) − Σ순입금, 환전은 0). 사용자가 "해외 분석 뒤 다시 잡는다" 고 했으므로(T-108 0단계 표) **실거래 홈의 손익 기준 = 재설정된 baseline**, 재설정 전에는 손익을 `unknown` 으로 둔다.
- 권고 재설정 시각: 킬스위치 해제·실거래 전환 당일 **07:00~09:00 KST 첫 스냅샷**(T-074 Analyst Q1 — 미국장 마감 뒤·USD 표시 완전한 시간대). 월 수익률(`computeMonthlyReturn`)은 **연결 선결조건 C1~C4 미충족**이라 홈에 연결하지 않는다(T-081 Leader 기록).

## 2. (A) 분석 관찰 기간 홈 지표 — 킬스위치 ON·D5 차단 상태의 기본 4종

대상 "분석" = **장마감 AI 분석**(국내 16:00 `post-market-domestic`·해외 08:00 `post-market-overseas`) 으로 정의한다(결정 D1). 장중 룰 엔진(`strategy-eval`, 5분)은 거래>신호 진단에서 `eval_funnel` 로 따로 본다.

| # | 지표 | 대상 집합 | 기간/거래일 | 집계 단위 | 데이터 출처 | 통화 | 비용 | 기준 시각 | 완전성·상태 | 분류 |
|---|---|---|---|---|---|---|---|---|---|---|
| A1 | 분석 완료 종목 | run 이 평가한 종목(`symbolsEvaluated` — 유니버스 ∪ 보유 ∪ 즐겨찾기) | 시장별 마지막 세션일 run | run 당 종목 수, 시장 2줄 | **없음**(HTTP 응답·로그만) → `job_run_log.counts_json.evaluated` / baseline 기록 행 수 | — | — | run `started_at` + D0 | run `status`: ok/partial/failed/skipped(휴장·스위치 꺼짐)/missing | **새 연결**(T-112) |
| A2 | 분석 후보 종목 | ① 규칙 후보(3규칙 통과, dedupe 후 `candidatesFound`) ② LLM BUY 카드 ③ 그중 승인 가능 `pending` / 차단 `skipped` | 같은 세션일(카드는 `valid_from` = 다음 세션 09:00 KST / 해외 세션) | 종목 수(카드는 종목당 1 — 유니크 키 `(symbol,side,valid_from,scenario_source)`) | ② ③ `signals WHERE scenario_source='post-market' AND market=? AND valid_from=?` **기존 가능** · ① baseline 기록 **새 연결** | — | — | 카드 `created_at`, 분석 D0 | ① 없으면 `unknown`; ②③ 는 run 이 돌았는지 모르면 "0 vs 미실행" 구분 불가 → A1 과 묶어 표시 | **부분 가능** |
| A3 | 사후 결과 추적 표본 | baseline 후보 전체(SKIP 포함) → 현재는 카드만 | 최근 N 세션일(기본 20) | n = D0 확정봉 + D+k(`is_final=1`) 존재 건수 / 전체, 시장별 | `signals`(카드) + `daily_bars`(T-117 로 하루 1회 증분) ; 계산 정의는 `postmortem-core.js`(D0 = 생성 시각의 현지 날짜, D+k = D0 봉 다음 k번째 확정봉, HORIZONS 1·3·5·10) | 현지 통화 원값(진입 모델 `d1open`/`d0close` — 환율 무관) | registry `costs`(미국 편도 0.25%·슬리피지) — J3 | `daily_bars.MAX(fetched_at)`·최신 `trade_date` | 추적 완료(D+10)/추적 중/가격 없음(`price_missing`)/일봉 오래됨(최신 trade_date < 마지막 완료 세션일 → `stale`)/n<30 `partial` | **기존 가능(카드 한정)** — 앱 내 집계 API 는 없음(스크립트만) |
| A4 | 데이터 이상·분석 실패 | 세션일의 잡 실행 중 `failed·missing·degraded` + 데이터 신선도 위반 | 세션일(해외 ET) | 건수 + 사유 코드 목록 | 완전판 `job_run_log` **새 연결**; 지금 가능한 부분: `system_config.news_zero_streak:*`(T-106), `portfolio_snapshots` 시간당 행 공백, `fx_rates.fetched_at` 24h 초과, `daily_bars` 최신일, 해외 run `skipped` 사유(`PostMarketOverseasSkip` — 응답에만 있음) | — | — | 각 원천의 마지막 시각 | 원천별 `available/stale/error/unknown` 을 합쳐 "이상 N건" | **부분 가능** |

## 3. (B) 실거래 단계 홈 지표 — 5종 + 자금 2종

| # | 지표 | 대상 집합 | 기간/거래일 | 집계 단위 | 데이터 출처 | 통화 | 비용 | 기준 시각 | 완전성·상태 | 분류 |
|---|---|---|---|---|---|---|---|---|---|---|
| B1 | 진입 감시 | `signals.status='approved_pending_entry'` AND `(valid_from IS NULL OR valid_from<=NOW())` AND `(expires_at IS NULL OR expires_at>=NOW())`; `executing`(주문 선점 중)은 별도 1줄; `valid_from` 미래는 "다음 세션 예정" | 현재 시점 | COUNT, 시장별 | `signals` | 카드 `price` 는 KRW 환산값·`indicators.price_zone_usd`(해외) | — | 조회 시각 | 기존 가능 — limit 길이 금지 | **기존 가능** |
| B2 | 운용 포지션 | 자동 귀속(§1.4) 보유: `orders(source∈signal,auto, status∈filled,partially_filled)`+`executions` 로 수량 재구성 ∩ 현재 KIS 보유 ; 계좌 전체 보유 수 병기 | 현재 | 종목 수 + 평가액 | `orders`·`executions`·KIS 잔고/최신 스냅샷 ; 보강 `broker_fills(app_order_id, reconcile_state)` — D2 대사 **미구현** | 원값 + KRW(환율 시각) | — | 잔고 조회 시각·스냅샷 ts | 자동 귀속 집합이 비어 있으면 **"자동 운용 0 / 계좌 보유 N"** 로 두 줄 — 0 을 숨기지 않음 | **기존 가능(정의) / 새 연결(대사)** |
| B3 | 오늘 실체결 | 체결 증거만: `executions.executed_at ∈ 세션일` (부분체결은 수량 합, 주문 1건=1건으로 중복 금지) ; 브로커 원장 `broker_fills.filled_qty>0 AND order_date=세션일` (⚠ KIS 는 체결 시각을 주지 않아 **주문일 기준**) ; `accepted·dry_run·blocked·rejected·cancelled` 제외 | 시장별 세션일 | 건수·수량·대금 | `executions`(`order-sync.ts` 작성) · `broker_fills`(수집 스위치 `broker_fills_cron_enabled` 상태 미확인) | 원값 + KRW | `executions.fee`(앱) / `broker_fills.fee_kind`(`unknown` 이면 비용 미상 표기) | 체결 시각(앱) / 주문일(브로커) | 앱 체결 0 이고 브로커 원장도 없으면 `unknown`, 둘 중 하나라도 조회 성공이면 값 | **기존 가능(앱 체결) / 부분(브로커)** |
| B4 | 자동매매 손익 | 자동 귀속 체결의 실현손익(이동평균 원가, KIS 기간손익과 교차검증) + 운용 포지션 평가손익 ; **비용 분리 표기** | 기준(§1.5) 이후 누적 + 세션일 | 실현/평가/비용 3분리, 통화별 | 실현: `broker_realized_pnl`·`broker_fills` → **T-081 D2 미구현** ; 평가: 보유 × 현재가 − 원가 ; 계좌 전체 손익은 `computeSummary()`(T-074) — 이것은 자동매매 손익이 아니므로 **라벨 분리** | 원값 + KRW(기준 환율 시각) | `fee_kind` actual>allocated>estimated(0.25%)>unknown — 미상이면 "비용 미상" | baseline `baselineAt`, 환율 `fx_at` | 원가 미상 거래는 손익 제외 + "원가 미상 N주 제외"(T-081 M10 — 현행 `computeLifoPnl` 은 재고 없으면 매도대금 전액 이익) | **새 연결** |
| B5 | 계좌 전체 손익(보조) | 입출금 보정 P·R(Modified Dietz) | 기준 이후 | KRW | `cash_ledger_baseline`+`cash_flow_ledger`+스냅샷 → `computeSummary()` | KRW | — | baseline·최신 스냅샷 ts | `pending` 앵커·`unmatched`·`fxMissing` 표기 그대로 | **기존 가능(기준 설정 뒤)** |
| B6 | 운용액(자금) | 자동매매에 배정된 금액 — **정의 없음** | — | KRW(+USD) | 후보: (a) 사용자 입력 설정 (b) 일일 한도 `daily_order_max_pct`×기준 (c) 카드 금액×슬롯 | — | — | — | 정의 전 "미설정" | **정의 불가·결정 D4** |
| B7 | 신규 매수 가능 금액 | min(결제 완료 KRW 예수금 / USD 순예수금, 1회 한도 `order_max_pct`, 일일 잔여 = 한도 − 오늘 사용·자기 외 `pending`(`checkDailyMax`, T-081 WP-B)) ; 킬스위치·D5 차단이면 금액 대신 **"차단(사유)"** | 세션일 | 통화별 | KIS 잔고 `getBalancesDetailed()`·`order-limits.ts`·`system_config` 스위치 | KRW·USD 각각(환산 병기) | — | 잔고 조회 시각 | `cash.USD.state!='known'` 이면 `error`(0 금지 — T-056) | **기존 가능(조합)** |

## 4. 현재 카드 4종 — 의미 문제와 재정의

| 카드 | 지금(`Dashboard.tsx`) | 문제 | 재정의 |
|---|---|---|---|
| 승인 대기 | `status IN (awaiting_approval, pending_approval)` limit 100 길이, 만료 제외(`/api/signals` 기본) | `pending`(카드) 누락 → `/recommend` 와 불일치 ; 길이=건수 | **승인 대기 = `AWAITING_APPROVAL_STATUSES`(`awaiting_approval`·`pending_approval`·`pending`) ∧ 미만료**, 서버 COUNT, 시장별. `detected`(manual 관측 — 승인 버튼 없음)는 "관측 기록"으로 **분리**(/recommend 도 같은 분리 권고 — 결정 D8). `valid_from` 미래 카드는 포함(승인은 지금, 감시는 valid_from 부터) |
| 진입 감시 중 | `approved_pending_entry` limit 100 길이 | 길이 ; `executing`·만료·미래 valid_from 미구분 | B1 |
| 오늘 체결 | 최근 20건 ∩ KST 오늘 ∩ `accepted/filled/partially_filled/dry_run` | 접수·모의 포함, 20건 상한, KST 경계 | 관찰 기간: **「오늘 주문 시도」**(status 별 건수: 차단·dry_run·거부·체결) / 실거래: B3 |
| 포트폴리오 오늘 | KIS 현재 총평가 − `ts <= KST 자정` 최신 스냅샷 `total_krw` | 입출금·환율·수동 보유 포함, 기준 스냅샷이 자정 직전이 아니라 "자정 이전 최신"(보류 시 더 과거), 스냅샷 보류(`holdForCash`)면 공백 | 관찰 기간: **표시하지 않음** / 실거래: B5(계좌 전체, 기준 시각 표기) + B4(자동 귀속) 분리 |

**깔때기 시장 토글**: `EvalFunnelCard` 가 `market=domestic` 고정 [확실]. API(`/api/dashboard/eval-funnel?market=`)는 `overseas` 를 이미 받는다. 토글 정의 = `eval_funnel.market` 별, 범위 = **해당 시장의 마지막 세션일**(해외는 ET 세션일 — KST 날짜 경계 금지), 단위 = `run_id` 수와 게이트별 skip/pass 심볼 수. 라벨은 "장중 룰 평가 깔때기"로 — 장마감 AI 분석은 이 표에 없다(§0-6). 해외 룰 엔진이 실제로 돌고 있는지(스위치)는 미확인 → 행이 없으면 `unknown`.

## 5. 11-23 감사 기간 종료 판단 증거 3종 — 계산 정의와 소급 가능 범위 (제목 정정 10-30: 킬스위치는 이미 해제, 11-23 은 남은 감사 기간 종료 시점)

| 증거 | 계산 정의 | 지금 소급 가능 | 기록 시작 뒤에만 | 태그 |
|---|---|---|---|---|
| E1 후보의 사후 성과 | 모집단 = baseline 판단 기록 **전체**(BUY·SKIP·차단). 수익 = T-095 정의(D0 = 판단 시각의 현지 날짜, 진입 `d1open` 권고·`d0close` 보조, D+1·3·5·10 확정봉 종가, 비용 registry `costs`, 같은 D0 유니버스 평균 대비 초과수익). 보고 = 시장 × 주 × 진입모델, n·중앙값·평균·구간, n<30 경고, 단일 주 집중 경고 | **카드(LLM BUY 통과분, `pending`+`skipped`)에 한해** — `signals` 보존 + `daily_bars`(2023~) 로 계산 가능. **SKIP 은 복원 불가** → "BUY 통과분의 사후 성과"로 라벨 | 후보 전체·SKIP 포함 성과, BUY vs SKIP 비교 | [확실] 구조 / 행 수·기간은 미조회 |
| E2 분석·데이터 정상 가동률 | 분모 = 예정 슬롯(T-104 스케줄, 없으면 현행 표) − `skipped`(휴장·스위치 꺼짐). 분자 = `status='ok'`. `partial`·`degraded` 는 별도 비율. 잡 그룹: 분석(`post-market-domestic`·`post-market-overseas`) / 데이터(`news-fetch-*`·`daily-bars`·`portfolio-snapshot`·`edgar-sync`·`kis-fundamentals-snapshot`·`broker-fills`). 세션일 기준, 주 단위 추이 | **거의 불가.** 간접 대리만: `portfolio_snapshots.ts` 시간당 행 공백(이 잡만 확실), `daily_bars.fetched_at`, `ci_raw_item.first_seen_at`(10-28 21:16~, 뉴스 수집 흔적), `research_rally_results.run_date`, `signals` 카드 존재(0건이 실패인지 후보 없음인지 **구분 불가**). 날짜파일은 성공 증거 아님(10-26 edgar-sync) | 전부 | [확실] |
| E3 후보·제외 사유 추이 | 세션일별: 규칙 후보 → 사전 필터(블랙아웃·금액) → LLM 입력 → BUY/SKIP(사유·confidence) → 카드 생성/중복/차단(D5 `gate_reason`) 각 단계 건수와 사유 분포 | 카드 단계만: `signals.status(pending/skipped)`·`indicators.gate='validation_gate'`·`paper_fills.gate_reason/origin`(**모집단은 `signals`, `paper_fills` 는 LEFT JOIN** — 고아 행 규칙), 장중 룰은 `eval_funnel`(30일) | 규칙 후보 수·LLM SKIP 사유·confidence·중복·사전 필터 | [확실] |

## 6. 새 연결이 필요한 기록 필드 — T-112 가 소비할 명세

**`job_run_log`**(2차 설계서 §9.5 확정안을 그대로 쓴다. 이 계약이 추가로 요구하는 것만):
- `counts_json` 키 고정: 분석 run `{evaluated, candidates, llm_input, created, blocked, duplicate, skipped}`, 수집 run `{fetched, new, processed}`. 홈 A1·A2·E2 가 읽는다.
- `degraded_reason` 에 해외 `PostMarketOverseasSkip` 사유(`holidays_unknown`·`fx_unknown`·`candles_unavailable`…)를 그대로 적고, 그 경우 status 는 `failed` 가 아니라 `skipped`(정상 판정 건너뜀: `overseas_disabled`·`no_new_session`·`us_session_open`) 또는 `degraded`(데이터 일시 모름 503) 로 구분.
- `session_date_et` 는 해외 run 필수(홈·E2 의 세션일 집계 키). 매분 잡 롤업은 홈 지표 대상이 아니다(E2 분모에서 제외).

**기준 판단(baseline) 기록** — 2차 설계서 §7 단계 3 필수 필드(후보 전체·BUY/SKIP·신뢰도·프롬프트 해시·RAG 문맥 ID·자료 상태·`as_of`·`judgment_role`)에 이 계약이 더하는 것:

| 필드 | 왜 필요한가 |
|---|---|
| `run_id`(→`job_run_log`) · `market` · `session_date_kst/et` · `as_of` | A1·A2·E2 와 같은 세션 키 |
| `symbol` · `rule_hits`(eod_high_close/inside_bar/oversold_bounce_daily) · `stage` ∈ {rule_candidate, prefilter_excluded, llm_input, llm_buy, llm_skip, card_created, card_blocked, duplicate} · `reject_reason` | E3 깔때기 |
| `decision`(BUY/SKIP/NA) · `confidence` · `prompt_hash` · `model` · `rag_context_ids` · `news_count` | E1 모집단·E3, T-109/shadow 비교 짝 |
| `ref_price_native` · `currency` · `fx_usdkrw` · `fx_at` · `d0_trade_date` | E1 진입 모델(d0close) 재계산 없이 사후 성과 산출, 환율 시각 표기 |
| `data_status_json`(candles/fx/earnings/news: available·stale·unknown) | A4 와 E1 표본 상태 |
| `signal_id`(NULL 허용) | 카드로 이어진 행 연결(모집단은 기록, 카드는 보강) |
| `judgment_role='baseline'` · `engine_version`(git sha) | J4, 기준선 변경 대장(§10)과 대조 |

기록은 관찰 전용(실패해도 분석 결과 불변). 보존·롤업은 T-112 DDL 초안에서 — 이 계약은 **90일 이상**(11-23 판단 뒤 재검토 가능하게)을 요청한다.

## 7. 사용자에게 물을 결정 (Analyst 가 정할 수 없는 것만)

| # | 결정 | 선택지 | 권고 |
|---|---|---|---|
| D1 | 홈 「분석」의 범위 | (a) 장마감 AI 분석만 (b) 장중 룰 엔진 포함 | **(a)** — 11-23 증거 대상·사용자 발화 "종목분석"과 일치. 룰 엔진은 거래>신호 진단 | **→ 14:45 사용자 결정(원문 "(c) 청산 로직 지표 신설"): (a) 유지 + 「청산 로직」 관찰 지표 신설 — §11. 이 행의 권고 (a) 근거 중 "룰 엔진은 진단"은 킬스위치 해제 전 전제였다.**
| D2 | 「오늘」 경계 | (a) KST 달력일 (b) 시장별 세션일(해외 ET) | **(b)** — 11-01 DST 종료 뒤 KST 자정이 미국장 중간을 가름 |
| D3 | 앱 밖 취득 보유 3종목의 홈 귀속 | (a) 계좌 전체로만 (b) 자동 관리 편입 | **(a)** — 편입은 T-100 Q1~Q8 과 함께. 홈은 "자동 운용 0 / 계좌 보유 N" 두 줄 |
| D4 | 운용액 정의 | (a) 설정에서 사용자가 배정액 입력 (b) 일일 한도 기준 파생 (c) 숨김 | **(a)**, 입력 전 "미설정" |
| D5 | 손익 기준 재설정 시점 | (a) 지금 (b) 실거래 전환일 07~09시 첫 스냅샷 | **(b)** — 관찰 기간 홈은 손익 미표시 |
| D6 | 가동률 분자 | (a) `ok` 만 (b) `ok+partial` (c) `ok+partial+degraded` | **(a)** 정상, 나머지는 별도 선 |
| D7 | 사후 성과 홈 기본 진입 모델 | `d1open` / `d0close` | **`d1open`**(T-095 권고, 환율 무관) — 상세에서 전환 |
| D8 | `detected` 관측 기록을 승인 대기에 넣는가 | (a) 넣음(/recommend 현행) (b) 분리 | **(b)** — 승인 버튼이 없는 행을 "대기"로 세지 않는다. /recommend 도 같이 바꾸면 "통일" |
| D9 | USD 환산 표기 | (a) 최신 환율(5분 TTL)만 (b) 환율 시각 + stale/fallback 표지 필수 | **(b)** — §0-3 결함 때문에 코드 변경 1건 수반 |

## 8. 열린 질문·미확인 (확인한 것처럼 쓰지 않았다)

- 운영 값 전부 미조회: 스위치 상태, `signals` 카드 행 수·기간, `paper_fills`·`broker_*`·`cash_flow_ledger`·`daily_bars` 존재/행 수, `eval_funnel` 실제 보존, `users`·`chat_threads` 행 수 → §9.
- `broker-fills` 수집이 켜져 있는지(`broker_fills_cron_enabled`), T-081 D2(대사·원가) 착수 여부 — B2·B3·B4 분류가 바뀔 수 있다.
- pm2 로그 보존 기간 — E2 의 "evaluated=" 로그 파싱 소급 가능성 [추측].
- 해외 장중 룰 엔진 가동 여부(깔때기 토글 해외 행의 존재).
- `market_holidays` 2026-11~2027 커버리지(엄격 로더가 던지면 해외 세션일 미확정).
- 기록 명세와 T-112 DDL 초안의 필드 대조(G-J1)는 두 문서가 나온 뒤 Leader 가 한다 — 이 문서 §6 이 Analyst 측 입력이다.

## 9. U6 읽기 전용 SELECT 후보 목록 (실행하지 않았다 — 사용자 승인 뒤 Leader 실행)

규칙: SELECT 만 · `cred_*`·`kis_access_token`·계좌 금액 열 제외 · 집계·존재 확인 위주 · 컬럼명은 스키마 파일로 확인한 이름. Q6 결과에 없는 테이블의 쿼리(Q11~Q13)는 건너뛴다.

| # | 목적 | SQL | 읽는 테이블 | 출력 |
|---|---|---|---|---|
| Q1 | 스위치 키 현재값(홈 "현재 상태"·B7 차단 판정 입력) | ``SELECT `key`, value, updated_at FROM system_config WHERE `key` IN ('safety_kill_switch','safety_dry_run','hybrid_mode_enabled','autopilot_mode','engine_enabled','strategy_analyst_enabled','post_market_overseas_enabled','exit_engine_enabled','exit_hard_stop_enabled','broker_fills_cron_enabled','ci_capture_enabled','holdings_premarket_enabled','vol_guard_enabled','signal_cash_gate_domestic_enabled','signal_cash_gate_overseas_enabled','rag_enabled') ORDER BY `key` `` | system_config | 키·JSON 값·시각 (≤16행) |
| Q2 | 뉴스 0건 감시 키(A4 입력) | ``SELECT `key`, value, updated_at FROM system_config WHERE `key` LIKE 'news_zero_streak:%' ORDER BY `key` `` | system_config | 키·값 |
| Q3 | 손익 기준 존재·버전(금액 제외) | ``SELECT `key`, JSON_EXTRACT(value,'$.version') AS version, JSON_UNQUOTE(JSON_EXTRACT(value,'$.baselineAt')) AS baseline_at, JSON_EXTRACT(value,'$.snapshotId') AS snapshot_id, updated_at FROM system_config WHERE `key` = 'cash_ledger_baseline' `` | system_config | 1행, 금액 없음 |
| Q4 | 전략 검증 상태 분포(D5 차단 표시) | `SELECT validation_status, enabled, COUNT(*) AS n FROM strategies GROUP BY validation_status, enabled` | strategies | 분포 |
| Q5 | 회원·대화 행 수(T-113 입력) | `SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM chat_threads) AS threads, (SELECT COUNT(*) FROM chat_threads WHERE archived = 0) AS threads_active, (SELECT COUNT(*) FROM chat_messages) AS messages` | users·chat_threads·chat_messages | 건수 4개 |
| Q6 | 테이블 존재·행 수 추정(`job_run_log` 는 부재 기대) | `SELECT TABLE_NAME, TABLE_ROWS, UPDATE_TIME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('job_run_log','paper_fills','daily_bars','cash_flow_ledger','broker_fill_runs','broker_fills','broker_fill_revisions','broker_realized_pnl','broker_position_snapshots','ci_raw_item','eval_funnel','position_state','market_holidays','fx_rates','research_rally_results','executions','orders','signals','portfolio_snapshots') ORDER BY TABLE_NAME` | information_schema | 존재 여부·추정 행 수(InnoDB 추정치) |
| Q7 | 장마감 카드 소급 범위(E1·E3) | `SELECT market, status, COUNT(*) AS n, MIN(created_at) AS first_at, MAX(created_at) AS last_at FROM signals WHERE scenario_source = 'post-market' GROUP BY market, status` | signals | 분포·기간 |
| Q8 | 승인 대기 집합 차이 실측(§4) | `SELECT status, market, COUNT(*) AS n FROM signals WHERE status IN ('awaiting_approval','pending_approval','pending','detected','approved_pending_entry','executing') AND (expires_at IS NULL OR expires_at >= NOW()) GROUP BY status, market` | signals | 상태별 건수 |
| Q9 | 가상 체결 표본 구조(E3·A3) | `SELECT market, origin, gate_reason, COUNT(*) AS n, SUM(quantity > 0) AS n_qty_pos, MIN(signal_created_at) AS first_at, MAX(signal_created_at) AS last_at FROM paper_fills GROUP BY market, origin, gate_reason` | paper_fills | 분포 |
| Q10 | 주문 귀속·상태 분포(B2·B3 모집단) | `SELECT market, source, status, COUNT(*) AS n, MAX(created_at) AS last_at FROM orders GROUP BY market, source, status` + `SELECT COUNT(*) AS n, MIN(executed_at) AS first_at, MAX(executed_at) AS last_at FROM executions` | orders·executions | 분포·건수 |
| Q11 | 브로커 원장 수집 상태(B3·B4, Q6 에 있을 때만) | `SELECT market, kind, status, COUNT(*) AS n, MAX(window_to) AS last_window_to, MAX(started_at) AS last_started FROM broker_fill_runs GROUP BY market, kind, status` | broker_fill_runs | 분포 |
| Q12 | 입출금 원장 상태(B5, Q6 에 있을 때만) | `SELECT kind, currency, anchor_status, COUNT(*) AS n FROM cash_flow_ledger WHERE deleted_at IS NULL GROUP BY kind, currency, anchor_status` | cash_flow_ledger | 건수만(금액 없음) |
| Q13 | 일봉 신선도(A3 `stale` 판정) | `SELECT market, COUNT(DISTINCT symbol) AS symbols, MAX(trade_date) AS last_trade_date, MAX(fetched_at) AS last_fetched, SUM(is_final = 0) AS n_unfinal FROM daily_bars GROUP BY market` | daily_bars | 시장별 4값 |
| Q14 | 스냅샷 가동 공백(E2 대리지표) — 금액 제외 | `SELECT DATE(ts) AS d, COUNT(*) AS n, SUM(source = 'hourly') AS n_hourly FROM portfolio_snapshots WHERE ts >= NOW() - INTERVAL 14 DAY GROUP BY DATE(ts) ORDER BY d` | portfolio_snapshots | 일별 건수 |
| Q15 | 깔때기 보존 범위·시장(§4 토글) | `SELECT market, MIN(ts) AS first_ts, MAX(ts) AS last_ts, COUNT(DISTINCT run_id) AS runs FROM eval_funnel GROUP BY market` | eval_funnel | 시장별 3값 |
| Q16 | 포지션 상태 행 수(B2 — 종목명 없이) | `SELECT market, COUNT(*) AS n, MIN(first_seen_at) AS first_seen FROM position_state GROUP BY market` | position_state | 건수 |
| Q17 | 휴장표·환율 신선도(§1.2·§1.3) | `SELECT market, YEAR(holiday_date) AS y, COUNT(*) AS n FROM market_holidays GROUP BY market, YEAR(holiday_date)` + `SELECT pair, fetched_at, (rate BETWEEN 100 AND 10000) AS plausible FROM fx_rates` | market_holidays·fx_rates | 연도별 건수·환율 시각 |
| Q18 | 리서치 통계 최신일(A4 대리·분석 메뉴 입력) | `SELECT market, MAX(run_date) AS last_run, COUNT(DISTINCT symbol) AS symbols FROM research_rally_results GROUP BY market` | research_rally_results | 시장별 2값 |

총 18건(Q10·Q17 은 각 2문장). 전부 집계·존재 확인이며 종목명·수량·금액·비밀 키는 출력하지 않는다.

---

## 10. 사용자 확정 기록과 U6 실행 결과 (2026-10-30 12:22 추가 — Leader)

### 10.1 사용자 확정
- 질문: "위 결정을 권고안으로 일괄 확정하고 U6 SELECT 18건도 지금 실행해도 될까요?" → 사용자 답(원문): **"권고안 일괄 확정"**.
- 확정 범위: ① **U6 읽기 전용 SELECT 18건 실행**(이 문서 §9 목록 그대로, 실행 결과는 아래) ② 이 문서 §7 **D1~D9 를 권고안으로 확정**(D1 장마감 AI 분석만 · D2 시장별 세션일 · D3 계좌 전체로만 표시 · D4 설정에서 배정액 입력 · D5 실거래 전환일 첫 스냅샷 · D6 `ok` 만 · D7 `d1open` · D8 `detected` 분리 · D9 환율 시각+stale/fallback 표지) ③ T-112 DDL 결정 U1~U5 권고안 ④ T-112 G-J1 Leader 제안 채택(해외 503 `failed`+`error_code` · 재시도 성공은 최종 `ok` · `rule_hits`·`run_id`·기준가/환율 열 v1 미포함 · `engine_release` 1열 가산).
- **확정은 문서 결정이다.** 화면 코드·DDL 적용·운영 변경·데모는 시작하지 않았다.

### 10.2 U6 실행 결과 (읽기 전용 SELECT 18건 · 건 수만, 비밀·금액·종목명 출력 없음 · 실행 2026-10-30 12:2x)
| 쿼리 | 결과 요약 |
|---|---|
| Q1 스위치 | `safety_kill_switch=false`(**10-30 09:08:18 변경**) · `safety_dry_run=true`(09:08:14) · `exit_engine_enabled=true`(09:08:29) · `exit_hard_stop_enabled=false` · `autopilot_mode="assist"` · `engine_enabled`·`hybrid_mode_enabled`·`strategy_analyst_enabled`·`vol_guard_enabled`·`post_market_overseas_enabled`(10-28 13:33)·`broker_fills_cron_enabled`·`ci_capture_enabled`·`holdings_premarket_enabled` = true · `rag_enabled="true"`(문자열). `signal_cash_gate_domestic/overseas_enabled` 는 **행 없음**(기본값 의존) |
| Q2 뉴스 감시 | 국내 `retrieval` streak 2(lastDate 10-29), 해외 `retrieval` streak 0(10-30 `lastCount 1`), 수집·검색 오류 채널 streak 0 |
| Q3 손익 기준 | `cash_ledger_baseline` version 2 · baselineAt 10-25 08:19:43 · snapshotId 5462 |
| Q4 전략 검증 | **16개 전부 `unvalidated`**(enabled 8 · disabled 8) → D5 관문이 신규 매수를 막는다 |
| Q5 | users 1 · chat_threads 13(활성 13) · chat_messages 32 — "계정 1명 전제"가 현재 사실 |
| Q6 테이블 | `job_run_log` **없음**(기대대로). 행 수(추정치): signals 18,023 · eval_funnel 260,043 · daily_bars 75,256 · portfolio_snapshots 4,365 · orders 3,028 · paper_fills 295 · ci_raw_item 1,139 · market_holidays 164 · research_rally_results 190 · broker_fill_runs 37 · broker_position_snapshots 36 · position_state 5 · cash_flow_ledger 2 · broker_fills 2 · broker_realized_pnl 1 · **executions 0** · fx_rates "0"(추정치 — Q17 에는 1행 있음) |
| Q7 장마감 카드 | domestic: approved 2(8월) · rejected 2(10-21~22) · expired 43(05-27~10-19) · skipped 6(10-26~29) / overseas: skipped 2(10-29·10-30). **총 55장**, 관찰 시작(10-26) 이후는 skipped 8장 |
| Q8 승인 대기 | **0건**(해당 상태 행 없음) — 홈과 /recommend 의 정의 불일치(§0-2)는 지금은 숫자로 보이지 않는다 |
| Q9 paper_fills | domestic engine `unvalidated` 210(수량>0 94, 10-23~) · domestic post_market `unregistered` 6 · overseas engine `unvalidated` 77(수량>0 56) · overseas post_market `unregistered` 2 |
| Q10 주문·체결 | orders 마지막: 국내 2026-08-12, 해외 2026-05-29. 최근 72시간 주문 0. **executions 0행** → B3·B4 표본 0 확정 |
| Q11 브로커 원장 | fills·realized_pnl·position_snapshot × 국내/해외 전부 `complete`, 마지막 실행 10-30 07:20 → 수집 가동 중 |
| Q12 입출금 | withdrawal KRW 1 · USD 1, 둘 다 `matched` |
| Q13 일봉 | KR 44종목 마지막 10-30(미확정 43) · US 51종목 마지막 10-29(미확정 1) |
| Q14 스냅샷 | 최근 14일 하루 7~18건 전부 `hourly` — **24건 미만인 날이 모두**(가동 공백의 대리 신호이지 원인은 미확인) |
| Q15 깔때기 | eval_funnel 국내 1,311 run · 해외 1,383 run, **첫 행이 정확히 30일 전(09-30)** → 30일 롤링 삭제 확인, 11-23 에는 10-24 이전 행이 없다 |
| Q16 포지션 | position_state 국내 1 · 해외 4 |
| Q17 휴장·환율 | market_holidays 2025~2030 전 연도 존재(국내 연 15 · 해외 연 11~13) → **엄격 로더가 던질 연도 공백 우려 해소**. fx_rates USD_KRW 최신 12:20 · plausible |
| Q18 리서치 | 국내 마지막 10-29(2종목) · 해외 10-30(3종목) |

### 10.3 이 결과가 바꾸는 것 (Leader 판단)
1. **[확실] 전제가 바뀌었다 — 킬스위치 `false` · DRY_RUN `true` · 청산 엔진 `true`(10-30 09:08, 사용자 의도 변경 — 답 "의도한 변경").** 사용자 설명(원문): "실거래만 막아놓고 킬스위치는 해제해서 시그널생성과 청산관련 로직은 켜놓은채로 남은 감사기간 지켜보기위해서 옵션을 변경했어" — **11-23 = 남은 감사(관찰) 기간 종료 시점**이고, 감사 대상은 DRY_RUN 으로 켜 둔 **시그널 생성과 청산 관련 로직**이다. 11-23 에 무엇을 결정하는지(실거래 전환 포함 여부)는 사용자가 그때 정하며 문서는 단정하지 않는다. 이 문서 §2 "관찰 기간 = 킬스위치 ON·D5 차단"은 더 이상 사실이 아니다. 현재 유효 상태는 health 로도 확인했다(`dryRun true · killSwitch false · safetyStatus green`). **홈의 단계(관찰/실거래)는 수동 플래그가 아니라 `safety_kill_switch`·`safety_dry_run`·검증 관문(Q4)의 조합으로 파생**해야 한다 — 1.1 "검증 차단" 상태 어휘와 §2 제목·본문의 "킬스위치 ON" 서술은 구현 전에 이 파생 규칙으로 다시 쓴다. 신규 매수는 여전히 D5 관문(전략 16개 `unvalidated`)과 DRY_RUN 이 막는다.
2. **[확실] 11-23 증거 풀이 얇다.** 장마감 카드는 총 55장이고 관찰 시작 이후는 skipped 8장뿐이다(Q7). `executions` 0·최근 72시간 주문 0(Q10) — §5 의 "BUY 통과 카드 한정 소급"이 실제로는 매우 작은 표본이다. 가동률(E2)은 `job_run_log` 가 없어 여전히 소급 불가.
3. **[확실] 스냅샷이 매일 24건 미만이다(Q14).** E2 의 대리 지표로 쓰려면 "정상 건수"의 기준 자체를 먼저 정해야 한다(하루 몇 건이 정상인지는 이 계약에서 미정 — 가동 스케줄 표 확인 필요).
4. **[확실] `signal_cash_gate_*` 키가 없다(Q1).** B7 의 "신규 매수 가능 금액" 차단 판정은 코드 기본값에 의존한다 — 구현 때 기본값을 코드에서 읽어 화면 문구에 반영한다.
5. 분류 변경 없음: B3·B4 "표본 0"과 A1·B4 "새 연결 필요"는 그대로 확정, B2 는 `position_state`(국내 1·해외 4)가 KIS 잔고 복제라는 점이 그대로. 휴장표 연도 공백 우려(§8)는 해소.
6. **[Leader 제안 — Analyst·사용자 확인 필요] 홈 단계 파생 규칙** (12:47): 단계는 수동 플래그가 아니라 아래 조합에서 계산한다.
   - **관찰(DRY_RUN) 단계**: `safety_dry_run=true` **또는** `safety_kill_switch=true` **또는** 검증 통과 전략(`backtested`·`paper_validated`) 0개. 지표 A 4종을 쓰고 가상 체결(`paper_fills`)은 별도 라벨, 손익은 표시하지 않는다(D5).
   - **실거래 단계**: `safety_dry_run=false` **그리고** `safety_kill_switch=false` **그리고** enabled 전략 중 검증 통과 ≥ 1. 지표 B 를 쓴다.
   - **혼합(예: DRY_RUN `false` 인데 전략이 전부 `unvalidated`)**: "실거래 준비 — 매수 차단"으로 표시한다(0 으로 쓰지 않는다).
   - **청산 엔진은 단계와 별개 항목**(`exit_engine_enabled`·`exit_hard_stop_enabled`)으로 표시한다 — DRY_RUN 이 `false` 가 되면 검증 관문과 무관하게 실주문을 낼 수 있기 때문이다.
   - 현재(10-30 12시대) 값은 관찰(DRY_RUN) 단계다(Q1·Q4).
7. **[확실 — 10-30 13:44 읽기 전용 관측] 감사 기간 증거에는 장중 룰 엔진 시그널과 청산 엔진 판단이 들어간다.** 09:08 이후: ① 장중 룰 엔진 buy 시그널 22건 생성, **전부 `skipped`**(D5 관문, 마지막 13:32) ② 청산 엔진은 `eval_funnel` stage 25 `exit_hard_stop_disabled` 40건뿐(09:14~13:39) — pm2 로그 `[exit-engine] 005930 hard_stop 스킵 (exit_hard_stop_enabled=false)`: 삼성전자(005930)가 하드스톱 조건에 걸리는데 `exit_hard_stop_enabled=false` 라 매 평가 주기(약 6~7분)마다 스킵된다. 다른 청산 종류(`eod_loss_cut`·`trailing_stop`·`target_profit`)의 기록은 없다(발화하지 않았거나 발화 시에만 기록되는지는 미확인). 주문은 0이다.
8. **D1 재확인 필요**: D1 은 "홈 분석 범위 = 장마감 AI 분석만"으로 확정됐지만, 그 근거가 "킬스위치 ON·룰 엔진은 진단"이었다. 사용자의 감사 목적(시그널 생성 + 청산 로직 관찰)은 **장중 룰 엔진 시그널과 청산 엔진 판단을 증거에 포함**시킨다. 선택지: (a) 유지(장마감 AI 만 — 시그널·청산 관찰은 분석 메뉴 상세에서) · (b) 홈 분석에 장중 룰 엔진 시그널 포함 · (c) (a) 유지 + **「청산 로직」 관찰 지표 신설**(평가 건수·스킵 사유·가상 청산 제안; 원천은 `eval_funnel` stage 21~29 이며 **30일 롤링 삭제**라 11-23 까지는 남지만 영구 증거는 아니다). 권고: **(c)** [추측 — 사용자 확인 필요].

---

## 11. 청산 로직 관찰 지표 (2026-10-30 14:4x 추가 — Analyst, 사용자 결정 「(c) 청산 로직 지표 신설」)

**범위**: D1(홈 분석 = 장마감 AI 분석만)은 그대로 두고, DRY_RUN 으로 켜 둔 **청산 엔진의 판단**을 관찰하는 지표를 새로 정의한다. 코드·DB·운영 설정은 바꾸지 않는다. 근거는 저장소 소스(`exit-engine.ts`·`exit-switch.ts`·`engine.ts` `runExitEngine`·`eval-funnel*.ts`·`position-state.ts`·`signals/router.ts`·`signals/service.ts`·`safety/dry-run.ts`·`db.ts` DDL)와 서버 pm2 **로그 파일 grep(건수만, 종목·금액 마스킹)**이다. 운영 DB 조회 0건 — 운영 수치는 §10 의 U6 결과와 Leader 관측(§10.3-7)만 인용한다.

### 11.0 먼저 — 불편한 사실

1. **[가능성 높음] 오늘(10-30) 15:20~15:29 KST 에 국내 보유 1종목(§10.3-7)의 `eod_loss_cut` 이 발화해 DRY_RUN 매도 주문 1건이 기록될 것이다.** `exit_hard_stop_enabled=false` 는 **`hard_stop` 한 종류만** 끊고(`engine.ts:911`), `eod_loss_cut` 은 평가 우선순위 1번(`exit-engine.ts:92`)이며 모드 무관 **강제 자동 제출**(`router.ts:253`)이다. 그 종목은 하드손절 구간(손실 ≥ 1.5% 기본값)에 있으므로 EOD 임계(기본 1.5%)도 넘는다. 경로: `signals`(`auto_submitted`) → `submitOrder` → 킬스위치 false → 블랙리스트 → (매도는 1회·일일 한도·변동폭 가드 **제외**, `dry-run.ts:195~222`) → DRY_RUN → `orders.status='dry_run'`·`trade_logs.event='dry_run'`·텔레그램 「✅ 자동 제출」(기본 on). 실 송신은 없다. pm2-err 로그에 마스터 OFF 기간의 `eod_loss_cut 발화 조건 충족` 줄이 62건 있다 — 조건은 반복 성립해 왔다. 운영 임계 override(`style_default_*`)는 미조회(U7-7). **→ 관측(16:11): 15:26:55 `eod_loss_cut` 발화(signalId=19743), 매도 주문 1건 `dry_run`(15:26:51), 실 송신 0 — 예측 적중.**
2. **[확실] 하드손절 OFF 상태에서는 그 종목의 다른 청산 종류도 평가되지 않는다.** `evaluateExit` 는 첫 매칭만 반환하므로 하드손절 구간 종목은 `hard_stop` 에서 끝나고(`exit_hard_stop_disabled` skip → `continue`), 익절·트레일링은 도달 불가다. 즉 지금 관찰 가능한 판정은 「하드손절 비활성 N틱」의 반복뿐이고, 이 skip 행에는 **손익률이 기록되지 않는다**(`engine.ts:913` detail 은 `exitKind` 만). 임계 대비 거리는 다른 원천(X5)으로 봐야 한다.
3. **[확실] 영구 증거가 없다.** 청산 판단은 `eval_funnel`(30일 롤링, §0-6)과 pm2 로그 파일(`/home/brownjeon/apps/stockinvest/shared/logs/pm2-out.log`·`pm2-err.log`, 2026-09-19 22:47 컷오버부터 **회전 설정 없음** — `~/.pm2/module_conf.json` 은 `{}`, `/etc/logrotate.d` 에 항목 없음)에만 남는다. 엔진이 웹 프로세스 안에서 돌아 `cron-out.log` 에는 0건이고, `console.log`(hard_stop 스킵 48건, 09:12~14:33) 는 out, `console.warn`(마스터 OFF 차단·단위 불일치) 은 err 로 갈라져 있다. T-112 기록 대상에도 없다(T-112 task 13:44 기록).
4. **[확실] 해외 청산 평가는 미국 정규장에만 돈다**(`runMarket` 의 `isOverseasOpen` 가드 — 09:30~16:00 ET = 22:30~05:00 KST, 11-01 DST 종료 뒤 23:30~06:00). 09:08~13:39 관측에 해외 행이 0건인 것은 「이상 없음」이 아니라 **「미평가」**다. 해외 `position_state` 4행(Q16)과 T-100 의 보유 3종목 수가 다른 이유는 미확인.

### 11.1 청산 엔진이 실제로 하는 일 (코드 근거)

- **실행**: `cron-runner.sh` 가 5분마다 `POST /api/cron/strategy-eval` → `runAll` → 시장별 `runMarket` → 장 열림 확인 뒤 **어떤 엔진 스위치보다 앞에서** `runExitEngine`(`engine.ts:1201~1214`). 실측 간격 6~7분(§10.3-7)은 러너 루프 지연으로 보인다 [추측]. `ENGINE_ENABLED=false` 여도 청산 트랙은 돈다(`engine.ts:1192~1196`).
- **두 스위치의 의미 차이** [확실]:

| 키 | 끊는 것 | 끊지 않는 것 | 기본 방향 |
|---|---|---|---|
| `exit_engine_enabled`(마스터, `exit-switch.ts`) | 4종 청산 시그널 **생성** 전부(→ 주문도 없음). 차단 시 `exit_engine_disabled` skip 행 + `exitKind·pnlPct·wouldHaveFired` 기록 + 12h 스로틀 경보 | `position_state` 진입가·고점 갱신, reconcile, 룰 전략의 일반 매도 시그널 | 정확히 `true` 만 ON(fail-closed) |
| `exit_hard_stop_enabled`(하위, `engine.ts:911`) | `hard_stop` 시그널 생성만. 차단 시 `exit_hard_stop_disabled` skip 행(손익률 없음) | `eod_loss_cut`·`target_profit`·`trailing_stop`, 고점 갱신 | 명시적 `false` 만 OFF(DB 오류 시 ON). 설정 API PATCH 대상 아님(읽기 표기만, `safety/route.ts:190`) |

- **트리거 4종** [확실] — `price`·`entry`(KIS 잔고 avgPrice)·`peak`(`position_state`), `pnl = (price−entry)/entry×100`, 임계는 `style`(코드 기본값, 운영값은 `system_config.style_default_*` override — 미조회):

| 우선순위 | exit_kind | 조건 | 시장 | 라우팅(`routeSignal`) | DRY_RUN 에서 끝나는 자리 |
|---|---|---|---|---|---|
| 1 | `eod_loss_cut` | KST 15:20~15:29 평일 ∧ pnl ≤ −eodLossCutPct(1.5) | 국내만 | **강제 `auto_submit`** → `auto_submitted` | `orders.status='dry_run'`(`source='auto'`) |
| 2·3 | `hard_stop` | pnl ≤ −hardStopPct(1.5) / 시나리오 `stopHi`·`stopLo` | 둘 다 | **강제 `auto_submit`** | 지금은 하위 스위치가 생성 전에 차단 |
| 4·5 | `target_profit` | pnl ≥ targetProfitPct(2.5) / 시나리오 `targetHi`·`targetLo` | 둘 다 | `autopilot_mode='assist'` → **`awaiting_approval`** + 텔레그램 승인 요청 | 승인하면 `submitOrder` → `dry_run`; 미승인은 TTL 뒤 `expired` |
| 6 | `trailing_stop` | (peak−entry)/entry ≥ trailingActivatePct(2.5) ∧ (peak−price)/peak ≥ trailingDrawdownPct(1.5) | 둘 다 | 같음(`awaiting_approval`) | 같음 |

- **생성 전 공통 관문**(종목당 매 틱, `engine.ts:818~931`): avgPrice 결손 → `exit_avg_price_missing`(error) / 시세 실패·0 → `exit_ticker_error`·`exit_price_invalid`(error) / `upsertPositionState` 실패 → `exit_state_upsert_failed`(error) / 행 없음 → `exit_state_missing`(error) / price/entry 비율 ∉ [0.3, 3.0] → `exit_unit_mismatch`(error, 시그널 거부 — 2026-05-13 USD/KRW 오발화 재발 방지) / 조건 미충족 → **`exit_no_fire`(pass, detail.pnlPct)** / 같은 (종목, 종류) 15분 쿨다운 → `cooldown_exit`(skip, 생성 **성공** 시에만 설정) / `createSignal` 정책 스킵은 stage 11 게이트(`quantity_below_min`·`duplicate_active_signal`…)로 1회만, 진짜 실패는 `exit_create_failed`(error, stage 29). 성공은 `signal_created`(strategy_id `exit-engine-v1`). 잔고 조회 실패 틱은 `balances_unknown`(error) 하나로 끝나고 reconcile 도 건너뛴다(고점 보호).
- **`position_state`**: 매 틱 `entry_price=KIS avgPrice`, `peak_price=GREATEST(이전, 현재가)`, `qty` upsert; 미보유 행은 시장 단위 reconcile 삭제. **스위치 상태와 무관**하게 갱신된다(§11.1 표). `run` 행 detail 에 `exitSignalsCreated·exitEngineEnabled·exitBlockedByDisable·exitSwitchSource` 가 매 틱 들어간다(`engine.ts:1217~1222`, 4개 종료 경로 모두) — 단 `exitBlockedByDisable` 는 **마스터 OFF 차단만** 세고 하위 스위치 스킵은 세지 않는다.
- **지금 닫힌 것**: T-055 매도 제안 미리보기(`sell_proposal_preview`)는 마스터 OFF 일 때만 열린다(`engine.ts:809`) → 10-30 09:08 이후 기록되지 않는다.
- **미확인**: 해외 청산 시그널의 `price`·`amount_krw` 통화 단위(§1.3 규약 적용 여부), `createSignalGuarded` 가 stage 11 행에 `strategy_id` 를 채우는지, `stop-alert`(T-068, 알림 전용) 손절선과 이 엔진 임계의 관계, 운영 `style_default_*` 값, 해외 4행 중 보유 3종목 외 1행의 정체.

### 11.2 「청산 로직」 관찰 지표 — 8항목 계약과 분류

| # | 지표 | 대상 집합 | 기간/세션 | 집계 단위 | 데이터 출처 | 통화 | 비용 | 기준 시각 | 완전성·상태 | 분류 |
|---|---|---|---|---|---|---|---|---|---|---|
| X1 | 청산 엔진 가동 | 시장별 마지막 `run` 행 + 스위치 2개 | 시장 세션(국내 KST·해외 ET, D2) | 시장 2줄: ON/OFF(마스터·하드손절)·마지막 평가 시각·세션 내 run 수 | `GET /api/settings/safety`(`exitEngineEnabled`·`exitHardStopEnabled`·`exitSwitchSource`) + `eval_funnel gate='run'` detail(`exitEngineEnabled`) | — | — | `run.ts`(KST) | 장중인데 마지막 run > 15분 → `stale`; 장외는 「휴장/장외」(0 아님); `balances_unknown` run → `error` | **기존 가능** |
| X2 | 평가 대상 포지션 | `position_state` 행 중 그 틱에 평가된 종목(= 종목 단위 exit 행이 있는 심볼) | 세션일 | 시장별 종목 수: 평가됨 / 데이터 이상(stage 21~24 error) / 미평가(행만 있음) | `position_state` ∩ `eval_funnel` stage 21~29 `COUNT(DISTINCT symbol)` | — | — | `position_state.updated_at` 최대 | 해외 장외 = 「미평가」; `qty IS NULL` 행 별표 | **기존 가능** |
| X3 | 트리거별 판정 현황 | 종목 단위 exit 행(`exit_no_fire`·`exit_hard_stop_disabled`·`cooldown_exit`·`signal_created`·error 게이트) | 세션일 · 최근 30일 추이 | **종목 수**(틱 수 병기) × {정상 0, 정책 스킵, 데이터 이상, 발화}, `detail.exitKind` 별 | `eval_funnel` stage 21~29 (+ stage 11 `strategy_id='exit-engine-v1'`) | — | — | 행 `ts` | 11.3 규칙으로 분류; 30일 이전은 `unknown` | **기존 가능(30일 한정)** |
| X4 | 가상 청산 제안 | `signals.strategy_id='exit-engine-v1'` 와 `consumed_order_id` 로 이어진 `orders` | 세션일 · 10-30 09:08 이후 누적 | 건수 × exit_kind × `signals.status`(`auto_submitted`/`awaiting_approval`/`expired`/`rejected`/`skipped`) × `orders.status`(`dry_run`/`blocked`+`blocked_by`) | `signals`·`orders`·`trade_logs(event in dry_run,blocked)` | 원통화 + KRW 환산은 **상세만**(§1.3 표기 규칙) | 없음(가상) | `signals.created_at`·`orders.created_at` | `dry_run` 은 「가상 체결」이 아니라 **차단 기록**(§1.4) — 홈 「오늘 체결」(§0-5)에서 분리(D13) | **기존 가능** |
| X5 | 임계 대비 현재 상태 | 보유 포지션 전체(계좌 전체, D3) | 최신 스냅샷 시각 | **홈: 종목 수**만 — {하드손절 구간, EOD 구간(국내), 익절 구간, 트레일링 활성, 중립}; **상세: 종목별 pnl·임계까지 거리** | `position_state(entry_price·peak_price)` + 현재가(`portfolio_snapshots.positions` 최신 또는 `exit_no_fire.detail.pnlPct`) + 임계(`style` 기본값 ⊕ `style_default_*`) | 원통화(비율이라 환율 무관) | — | 스냅샷 `ts`(>3h `stale`, §1.1) | 하드손절 스킵 종목은 깔때기에 pnl 이 없어 스냅샷 필수; 스냅샷 공백(Q14)이면 `stale` | **기존 가능(스냅샷 신선도 종속)** · 임계 운영값은 **U7-7 뒤 확정** |
| X6 | 청산 기록 공백 | 장중 세션의 5분 슬롯 | 세션일 | 슬롯 수: 기대 − `run` 행 수; `balances_unknown` 틱 수 | `eval_funnel gate='run'` + 세션 길이(§1.2) | — | — | — | 해외 11-01 DST 뒤 슬롯 수 변경; 러너 지연으로 기대치는 근사 | **부분 가능** → 완전판은 T-112 `job_run_log`(`strategy-eval` 잡) |

**홈에 종목 수만 두는 근거**: ① 보유는 자동 귀속이 아니라 계좌 전체다(D3 — 홈은 「자동 운용 0 / 계좌 보유 N」 두 줄) ② T-100 보고서가 종목·수량·평단 때문에 커밋에서 제외된 것과 같은 민감도이고 홈은 412px 앱 WebView 첫 화면이다 ③ 임계까지 거리는 종목별로만 뜻이 있어 상세(분석>보유)에 둔다.

### 11.3 상태 어휘와 「실패 vs 0 vs 스킵」 (§1.1 과 같은 어휘)

| 깔때기 게이트 (verdict) | 분류 | 홈 표시 | 0 으로 쓰는가 |
|---|---|---|---|
| `exit_no_fire` (pass) | **정상 0** — 평가했고 조건 미충족 | 「청산 조건 해당 없음 N종목」 | 예 — 유일하게 0 인 상태 |
| `exit_hard_stop_disabled` (skip) | **정책 스킵** — 조건 충족, 하위 스위치로 생성 안 함 | 「하드손절 OFF — 조건 충족 N종목」(틱 수 아님, D12) | 아니오 |
| `exit_engine_disabled` (skip) | **정책 스킵(상위)** — 09-30~10-30 09:08 소급 이력(pnlPct 있음) | 「자동 청산 OFF 기간 조건 충족 N종목·N틱」 | 아니오 |
| `cooldown_exit` (skip) | **정책 스킵** — 직전 생성 뒤 15분 | 발화 건수에 합산하지 않음(중복 억제) | 아니오 |
| `quantity_below_min`·`duplicate_active_signal`·`symbol_blacklisted` (skip, stage 11) | **정책 스킵** — 생성 단계 | 「생성 보류 N건(사유)」 | 아니오 |
| `exit_avg_price_missing`·`exit_ticker_error`·`exit_price_invalid`·`exit_state_*`·`exit_unit_mismatch` (error) | **데이터 이상** | 「데이터 이상 N종목」+ 사유 코드 | 아니오 — `error` |
| `exit_create_failed`·`signal_create_failed` (error) | **실패** | 「생성 실패 N건」 경보 | 아니오 |
| `balances_unknown` (error, run) | **미수집/실패** — 그 틱 평가 자체 없음 | 「잔고 미확인 N틱」 | 아니오 — `error` |
| 장외·휴장(run 행 없음) | **해당 없음** | 「장외」(해외는 ET 세션 기준) | 아니오 — `unknown` 과도 구분 |
| `signal_created` (pass) + `orders.dry_run` | **발화(가상)** | 「DRY_RUN 청산 N건」 — 「체결」 어휘 금지 | — |

### 11.4 기록 공백·소급 범위와 T-112 확장 **후보**(제안 — DDL v1.1 은 바꾸지 않는다)

| 사실 | 남는 곳 | 11-23 시점 |
|---|---|---|
| 틱별 판정(게이트·exitKind·pnlPct(no_fire·engine_disabled 만)) | `eval_funnel`(30일) | 10-24 이전 소실. 09-30~10-30 09:08 의 `exit_engine_disabled` 이력도 11-23 에는 대부분 사라짐 |
| 하드손절 스킵 종목의 손익률 | **없음**(skip 행에 pnl 없음, out 로그에도 없음) | 복원 불가 — 스냅샷으로 근사만 |
| 마스터 OFF 기간 조건 충족(09-19~10-30) | `pm2-err.log` — `hard_stop` 7,284 · `target_profit` 670 · `eod_loss_cut` 62 줄, 배너 국내 1,337·해외 1,837 | 회전 없음이라 남지만 파일 1개·stderr·종목이 평문 — 증거로 쓰려면 별도 보존 결정 필요 |
| 가상 청산 제안·DRY_RUN 주문 | `signals`·`orders`·`trade_logs`(영구) | 남음 — 단 「발화 안 한 틱」은 여기 없음 |
| 스위치 변경 이력 | `system_config.updated_at`(마지막 값만) | 09:08 변경 외 이전 이력 없음 |

**확장 후보 — `exit_judgment`(가칭, 가산 전용·외래키 없음·실패 시 영향 0, T-112 와 같은 원칙)**: 1행 = (틱 run_id, 시장, 종목) — `evaluated_at`(KST)·`market`·`symbol`·`position_qty`·`entry_price`·`peak_price`·`price`·`currency`·`pnl_pct`·`trigger_kind`(eod_loss_cut/hard_stop/target_profit/trailing_stop/none)·`threshold_pct`(적용 임계)·`decision`(fired/skip_policy/skip_cooldown/error/no_fire)·`decision_code`(게이트 ID 그대로)·`exit_engine_enabled`·`exit_hard_stop_enabled`·`dry_run`·`signal_id`·`order_id`·`engine_release`(T-112 와 같은 정의). 하루 상한 ≈ 보유 5종목 × 2시장 × 80틱 ≈ 수백 행. 쓰기 지점은 `runExitEngine` 루프 끝(`rec.*` 호출 자리) 1곳. **이것은 제안이다** — T-112 범위에 넣을지, 별도 task 로 할지, 안 할지는 D10.

### 11.5 사용자에게 물을 결정 (D10~D14)

| # | 결정 | 선택지 | 권고 |
|---|---|---|---|
| D10 | **오늘 15:20 `eod_loss_cut` DRY_RUN 발화 예상**(11.0-1) — 의도한 관찰인가 | (a) 그대로 두고 DRY_RUN 기록을 관찰 증거로 쓴다 (b) `exit_engine_enabled=false` 로 되돌린다(하위 스위치처럼 EOD 만 끄는 키는 **없다**) | **(a)** — 실 송신 0 이고 가상 청산 1건이 X4 의 첫 표본이 된다. 단 승인 요청이 아니라 「자동 제출」 알림이 온다는 점을 미리 알 것 |
| D11 | 청산 판단 영구 보존 | (a) `eval_funnel` 30일 그대로 (b) T-112 범위에 `exit_judgment` 추가 (c) 별도 task 로 11.4 후보안 | **(c)** — T-112 는 이미 Judge 접수 대기라 범위 확장이 일정을 밀고, 청산 기록은 쓰기 지점·주기가 다르다. 11-23 까지 쌓이는 양을 생각하면 빨라야 한다 |
| D12 | 하드손절 비활성 기간의 표현 | (a) 스킵 틱 수 (b) 「하드손절 OFF — 조건 충족 N종목」+ 지속 일수 (c) 숨김 | **(b)** — 틱 수는 5분마다 부풀고, 종목 수가 위험의 크기다 |
| D13 | DRY_RUN 청산 주문의 홈 표기 | (a) 현행 「오늘 체결」에 포함(`EXECUTED_STATUSES` 에 `dry_run`) (b) 「DRY_RUN 청산 N건」으로 분리 | **(b)** — §1.4 「`dry_run` 은 체결이 아니다」와 §0-5 정정 |
| D14 | 홈 표기 수준 | (a) X1+X3 요약+X4 건수(3줄) (b) 트리거별 상세까지 (c) 설정 화면만 | **(a)** — 상세는 분석>보유 |

### 11.6 U7 읽기 전용 SELECT 후보 (실행하지 않았다 — 사용자 승인 뒤 Leader 실행)

규칙은 §9 와 같다(SELECT 만·집계 위주·종목명·수량·금액·비밀 출력 없음). 컬럼명은 `db.ts` DDL 에서 확인했다. JSON 접근은 `JSON_VALUE`(MariaDB 10.2.3+) — 버전이 낮으면 `JSON_UNQUOTE(JSON_EXTRACT(...))` 로 바꾼다.

| # | 목적 | SQL | 읽는 테이블 | 출력 |
|---|---|---|---|---|
| U7-1 | 09:08 이후 exit 트랙 게이트 분포(X3) | `SELECT market, gate, verdict, COUNT(*) AS n, COUNT(DISTINCT symbol) AS symbols, COUNT(DISTINCT run_id) AS runs, MIN(ts) AS first_ts, MAX(ts) AS last_ts FROM eval_funnel WHERE stage BETWEEN 21 AND 29 AND ts >= '2026-10-30 09:08:00' GROUP BY market, gate, verdict` | eval_funnel | 게이트별 건수·종목 수 |
| U7-2 | 30일 스킵·차단 행의 exit_kind 분포(소급 이력) | `SELECT market, gate, JSON_VALUE(detail,'$.exitKind') AS exit_kind, COUNT(*) AS n, COUNT(DISTINCT symbol) AS symbols, MIN(ts) AS first_ts, MAX(ts) AS last_ts FROM eval_funnel WHERE gate IN ('exit_hard_stop_disabled','exit_engine_disabled','cooldown_exit','exit_create_failed') GROUP BY market, gate, exit_kind` | eval_funnel | 종류별 건수 |
| U7-3 | run 행의 청산 트랙 요약(X1·X6) | `SELECT market, DATE(ts) AS d, COUNT(*) AS runs, SUM(JSON_VALUE(detail,'$.exitEngineEnabled') = 'true') AS runs_exit_on, SUM(CAST(JSON_VALUE(detail,'$.exitSignalsCreated') AS UNSIGNED)) AS created, SUM(CAST(JSON_VALUE(detail,'$.exitBlockedByDisable') AS UNSIGNED)) AS blocked_master_off, SUM(reason = 'balances_unknown') AS balances_unknown, MAX(ts) AS last_run FROM eval_funnel WHERE gate = 'run' AND ts >= NOW() - INTERVAL 14 DAY GROUP BY market, DATE(ts) ORDER BY market, d` | eval_funnel | 일별 run 수·생성·차단 |
| U7-4 | `exit_no_fire` 손익 구간 분포(X5 근사, 종목명 없음) | `SELECT market, COUNT(DISTINCT symbol) AS symbols, SUM(CAST(JSON_VALUE(detail,'$.pnlPct') AS DECIMAL(10,2)) <= -1.5) AS ticks_below_hs, SUM(CAST(JSON_VALUE(detail,'$.pnlPct') AS DECIMAL(10,2)) >= 2.5) AS ticks_above_tp, COUNT(*) AS ticks FROM eval_funnel WHERE gate = 'exit_no_fire' AND ts >= '2026-10-30 09:08:00' GROUP BY market` | eval_funnel | 구간별 틱 수(임계는 코드 기본값 — U7-7 뒤 재계산) |
| U7-5 | 가상 청산 제안 현황(X4) | `SELECT market, status, JSON_VALUE(indicators,'$.exit_kind') AS exit_kind, COUNT(*) AS n, SUM(consumed_order_id IS NOT NULL) AS with_order, MIN(created_at) AS first_at, MAX(created_at) AS last_at FROM signals WHERE strategy_id = 'exit-engine-v1' GROUP BY market, status, exit_kind` | signals | 상태·종류별 건수(전 기간) |
| U7-6 | 청산 시그널이 만든 주문의 상태(X4) | `SELECT o.market, o.status, o.blocked_by, COUNT(*) AS n, MIN(o.created_at) AS first_at, MAX(o.created_at) AS last_at FROM orders o JOIN signals s ON s.consumed_order_id = o.id WHERE s.strategy_id = 'exit-engine-v1' AND o.side = 'sell' GROUP BY o.market, o.status, o.blocked_by` | orders·signals | `dry_run`/`blocked` 건수 |
| U7-7 | 운영 임계 override·관련 키(X5 임계 확정) | ``SELECT `key`, value, updated_at FROM system_config WHERE (`key` LIKE 'style_%' AND (`key` LIKE '%hardStop%' OR `key` LIKE '%eodLossCut%' OR `key` LIKE '%targetProfit%' OR `key` LIKE '%trailing%')) OR `key` IN ('sell_proposal_preview_enabled','notify_signal_auto_submit','notify_signal_pending') ORDER BY `key` `` | system_config | 키·값(비율·불리언) |
| U7-8 | `position_state` 신선도·구조(X2, 가격 없음) | `SELECT market, COUNT(*) AS n, MIN(updated_at) AS oldest_update, MAX(updated_at) AS last_update, SUM(scenario_exit IS NOT NULL) AS with_scenario, SUM(qty IS NULL) AS qty_null, MIN(first_seen_at) AS first_seen FROM position_state GROUP BY market` | position_state | 시장별 6값 |
| U7-9 | 오늘 이후 DRY_RUN·차단 감사 이벤트(매도만, X4 교차 확인) | `SELECT t.event, DATE(t.occurred_at) AS d, COUNT(*) AS n FROM trade_logs t JOIN orders o ON o.id = t.order_id WHERE t.event IN ('dry_run','blocked') AND o.side = 'sell' AND t.occurred_at >= '2026-10-30' GROUP BY t.event, DATE(t.occurred_at)` | trade_logs·orders | 이벤트별 건수 |

총 9건. U7-4 의 손익 구간은 비율이고 종목이 1개인 시장에서는 그 종목의 구간이 드러난다 — 출력을 문서에 옮길 때는 구간 수만 적는다.

### 11.7 열린 질문·미확인

- 11.0-1 의 15:20 발화는 임계 운영값(U7-7)·그 시각의 손익률에 달려 있다 — **예측이고 관측이 아니다.** 15:30 뒤 U7-5·U7-6·U7-9 로 확인한다.
- 해외 보유의 하드손절 구간 여부(T-100 10-27 기준 3종목 전부)는 10-30 밤 22:30 KST 첫 해외 틱 뒤에야 `exit_hard_stop_disabled` 행으로 드러난다. 해외는 EOD 손절이 코드상 없다(`exit-engine.ts:15`) — 해외 X3 에서 `eod_loss_cut` 은 「해당 없음」.
- pm2 로그 회전이 없어 `pm2-out.log` 8.2MB·`pm2-err.log` 3.7MB 가 계속 자란다 — 보존 결정(D11)과 별개로 운영 위험이며 이 문서 범위 밖(Leader 에 전달).
- `exit_engine_disabled` 행의 `reason` 은 스위치 판독 출처(`config/absent/…`)다 — 「차단 사유」로 읽으면 틀린다.
- 룰 전략의 일반 매도 시그널(`ma-cross` 데드크로스 등, 승인 경로)은 이 절의 대상이 아니다 — 홈에 섞이면 X4 가 부푼다. `strategy_id='exit-engine-v1'` 필터가 경계다.
- 확인하지 않은 것: `createSignalGuarded` 의 stage 11 기록 필드, 해외 시그널 통화 단위, `stop-alert` 임계와의 관계, 해외 `position_state` 4행의 정체, 운영 `style_default_*`, `sell_proposal_preview_enabled` 과거 값.

### 11.8 사용자 확정(D11~D14)과 U7 실행 결과 (2026-10-30 16:16 추가 — Leader)

**사용자 확정**: 질문 "D11~D14 를 권고안으로 확정하고 U7 읽기 전용 SELECT 9건을 실행해도 될까요?" → 답(원문) **"권고안 확정"**. D10 은 답을 받기 전에 15:26 에 발생했다(§11.0-1 관측 주석). 확정: **D11 (c)** 청산 판단 영구 보존은 별도 task([[T-126-exit-judgment-persistence]], 후보) · **D12 (b)** 하드손절 비활성 표현 = 「하드손절 OFF — 조건 충족 N종목」+ 지속 일수 · **D13 (b)** DRY_RUN 청산을 「오늘 체결」에서 분리(「DRY_RUN 청산 N건」) · **D14 (a)** 홈 표기 = X1 + X3 요약 + X4 건수의 3줄(상세는 분석>보유). 문서 결정만 — 화면·데모·DDL·코드 변경은 시작하지 않았다.

**U7 실행 결과**(읽기 전용 SELECT 9건, 종목명·금액·비밀 출력 없음, 실행 16:16):
| 쿼리 | 결과 요약 |
|---|---|
| U7-1 오늘 exit 트랙 | domestic `exit_hard_stop_disabled`/skip **55행**(종목 1·run 55, 09:14:44~15:21:46). 해외 0행(미평가) |
| U7-2 30일 스킵·차단(소급) | **마스터 OFF 기간 "발화했을 조건"**: domestic `exit_engine_disabled` — hard_stop 1,845행(종목 2, 09-30~10-30 09:07)·eod_loss_cut 50행(종목 2, 09-30~10-29) / overseas — hard_stop 3,432행(종목 5, 09-30~10-30 04:56)·target_profit 219행(종목 2, 09-30~10-12) |
| U7-3 run 요약 | domestic 하루 약 57~63 run(10-30: 57, 청산 시그널 생성 1·마스터 차단 1[09:07 이전]) · overseas 하루 15~67 run · `balances_unknown` 은 10-28 국내 1회뿐 · `runs_exit_on` 전부 0(run 행의 `exitEngineEnabled` 필드는 값이 비어 이 집계로는 마스터 ON 구분 불가 — 미해결) |
| U7-4 `exit_no_fire` | **0행** — 오늘 국내 유일 보유가 하드손절 구간이라 평가가 `hard_stop` 에서 끝난다 [가능성 높음]. 해외는 오늘 밤 첫 틱 뒤 확인 |
| U7-5 청산 시그널(`exit-engine-v1`) | domestic: `auto_submitted` eod_loss_cut **5건**(주문 5, 08-06~**10-30 15:26:49**)·hard_stop 1건(05-12) · `expired` 33건 · `rejected`/`approved` 3건(07-02) / overseas: **`auto_submitted` 2,680건**(hard_stop 1,065·target_profit 1,494·trailing_stop 121, **05-11~05-22**) · `expired` 69 · `superseded` 10 |
| U7-6 청산 주문 상태 | domestic: `dry_run` **1건**(10-30 15:26:51)·`blocked`/`kill_switch` 4건(08-06~08-07)·`filled` 1건(05-12) / overseas: `rejected`/`kis_rejected` **1,360**·`rejected`/`kis_5xx` 39·`blocked`/`kill_switch` 790·`dry_run` 485·`filled` 14 |
| U7-7 임계·알림 키 | override 는 **`style_default_trailingActivatePct`=3.5 · `style_default_trailingDrawdownPct`=1.2** 둘뿐(05-11). 하드손절·EOD 손절·익절 override 키 **없음 → 코드 기본값 적용**. **`notify_signal_auto_submit`=false**(05-11) · `notify_signal_pending`=true · `sell_proposal_preview_enabled`=true(10-20) |
| U7-8 포지션 | domestic 1행(`updated_at` 10-29 10:11) · overseas 4행(마지막 갱신 10-30 00:09) · 시나리오 연결 0 · `qty` 결손 0 |
| U7-9 감사 이벤트 | 오늘 매도 `dry_run` 이벤트 1건 — U7-6 과 일치 |

**이 결과가 바꾸는 것**
1. **[확실] 15:26 DRY_RUN 청산 건의 텔레그램 "자동 제출" 알림은 꺼져 있다** — `notify_signal_auto_submit=false`. 앞서 "알림이 올 수 있다"고 한 안내(§11.5 D10 행 포함)는 **정정**: 알림은 오지 않았을 가능성이 높다 [가능성 높음 — 다른 알림 경로 미확인]. 확인은 DB(`orders`·`signals`)로만 가능하다.
2. **[확실] X5 임계**: 하드손절·EOD 손절·익절은 코드 기본값(§11.1 표), 트레일링만 활성 3.5% · 되돌림 1.2% 로 override 되어 있다 — 지표 정의에 쓸 때 코드 기본값과 override 를 구분해 표기한다.
3. **[확실] 소멸 전 보존**: U7-2 의 "마스터 OFF 기간 발화했을 조건" 행은 30일 롤링으로 가장 오래된 것(09-30)부터 지워진다. 위 합계를 이 절에 옮겨 두었다. 원천 행은 T-126 이 없으면 사라진다.
4. **[확실] 과거 이력 — 5월 해외 청산 폭주**: 05-11~05-22 해외 청산 시그널이 자동 제출 2,680건이었고 주문은 거부 1,399건(`kis_rejected` 1,360·`kis_5xx` 39)·체결 14건·DRY_RUN 485건·킬스위치 차단 790건이었다. 원인은 이번에 조사하지 않았다(15분 쿨다운 `cooldown_exit` 이 이후 도입됐는지는 미확인). **DRY_RUN 을 `false` 로 바꾸기 전 감사 항목 후보**다 [추측: 같은 조건 반복 제출].
5. **[가능성 높음] 오늘 밤 해외 첫 틱(22:30 KST)**: 해외 보유 4행 중 하드손절 구간이 아닌 종목에서 `target_profit`·`trailing_stop` 이 발화하면 `awaiting_approval` + 텔레그램 승인 요청(`notify_signal_pending=true`)이 올 수 있다 — 승인해도 DRY_RUN 이라 주문은 `dry_run` 으로 끝난다. 해외는 EOD 손절이 없다.
6. U7-3 의 `runs_exit_on` 이 전부 0 인 것은 값 자체가 아니라 필드 비어 있음 가능성이 크다(미해결) — 구현 때 코드로 확인.

