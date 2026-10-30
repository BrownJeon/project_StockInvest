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

## 5. 11-23 킬스위치 판단 증거 3종 — 계산 정의와 소급 가능 범위

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
| D1 | 홈 「분석」의 범위 | (a) 장마감 AI 분석만 (b) 장중 룰 엔진 포함 | **(a)** — 11-23 증거 대상·사용자 발화 "종목분석"과 일치. 룰 엔진은 거래>신호 진단 |
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
1. **[확실] 전제가 바뀌었다 — 킬스위치 `false` · DRY_RUN `true` · 청산 엔진 `true`(10-30 09:08, 사용자 의도 변경 — 답 "의도한 변경").** 이 문서 §2 "관찰 기간 = 킬스위치 ON·D5 차단"은 더 이상 사실이 아니다. 현재 유효 상태는 health 로도 확인했다(`dryRun true · killSwitch false · safetyStatus green`). **홈의 단계(관찰/실거래)는 수동 플래그가 아니라 `safety_kill_switch`·`safety_dry_run`·검증 관문(Q4)의 조합으로 파생**해야 한다 — 1.1 "검증 차단" 상태 어휘와 §2 제목·본문의 "킬스위치 ON" 서술은 구현 전에 이 파생 규칙으로 다시 쓴다. 신규 매수는 여전히 D5 관문(전략 16개 `unvalidated`)과 DRY_RUN 이 막는다.
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
