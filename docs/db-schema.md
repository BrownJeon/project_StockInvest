# DB Schema (MariaDB)

NAS MariaDB에 `tradinginvest` DB를 생성해 사용한다. 테이블 생성은 Phase 2에서 마이그레이션 스크립트로 실행한다.

## 테이블 초안

### accounts — 거래소 계정
| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | INT PK AUTO | |
| exchange | VARCHAR(16) | `coinone` / `upbit` / `binance` / `kis` |
| label | VARCHAR(64) | 사용자 구분용 |
| created_at | DATETIME | |

### holdings — 보유 자산 스냅샷
| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | BIGINT PK AUTO | |
| account_id | INT FK | |
| currency | VARCHAR(16) | `BTC`, `ETH`, `KRW` … |
| balance | DECIMAL(36,18) | free |
| locked | DECIMAL(36,18) | 주문 걸린 물량 |
| avg_buy_price | DECIMAL(36,8) | |
| snapshot_at | DATETIME | 스냅샷 시각 |

### orders — 주문 상태 머신
| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | BIGINT PK AUTO | |
| account_id | INT FK | |
| client_order_id | VARCHAR(64) UNIQUE | 멱등성 키 |
| exchange_order_id | VARCHAR(64) | 거래소 응답 ID |
| asset_class | VARCHAR(16) | 기본 `stock` |
| symbol | VARCHAR(32) | 국내 6자리(`005930`)·해외 `NAS:AAPL` |
| side | ENUM('buy','sell') | |
| type | ENUM('limit','market') | **요청 유형.** 해외는 브로커에 항상 지정가로 나간다(`market` = ±0.5% 마케터블 지정가) — 체결 판정은 `order-sync.brokerOrderType` 기준 (T-071) |
| price | DECIMAL(36,8) NULL | 원화 기준가(해외도 송신 시 환율로 USD 환산) |
| quantity | DECIMAL(36,18) NULL | 요청 원본(해외 송신 수량은 정수로 버림 — `submittedQuantity`) |
| amount_krw | DECIMAL(18,2) NULL | 시장가 매수 등 |
| status | ENUM('pending','accepted','partially_filled','filled','cancelled','rejected','failed','dry_run','blocked') | 새 값 추가는 DDL(사용자 승인) |
| blocked_by | VARCHAR(32) NULL | safety 거부 사유 |
| source | ENUM('manual','signal','auto') | 기본 `manual` |
| market | ENUM('domestic','overseas') | 생성 시 심볼에서 유도한 사본 |
| created_at | DATETIME | |
| updated_at | DATETIME | |

- `filled` + `executions` 수량 < 송신 수량 = **부분체결로 종결**(잔량은 브로커에서 취소·만료, `trade_logs.partial_fill_settled`). 해외 행의 `executions.price` 는 WP-2 전까지 `orders.price`(원화 기준가, 근사)다 (T-019·T-071).
- order-sync 가 부재 추론으로 쓴 `cancelled` 는 `trade_logs.cancel_inferred` 가 근거다(브로커 확인 아님). 해외 market 은 연속 2회차 부재 뒤에만 쓴다 (T-071).

### executions — 개별 체결
| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | BIGINT PK AUTO | |
| order_id | BIGINT FK | |
| price | DECIMAL(36,8) | |
| quantity | DECIMAL(36,18) | |
| fee | DECIMAL(36,8) | |
| executed_at | DATETIME | |

### trade_logs — 감사 로그 (성공·거부·에러 모두)
| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | BIGINT PK AUTO | |
| order_id | BIGINT FK NULL | 주문 진입 전 거부는 NULL 허용 |
| event | VARCHAR(32) | `submit_attempt` / `blocked` / `accepted` / `filled` / `error` |
| payload | JSON | 요청·응답·에러 원문 |
| occurred_at | DATETIME | |

### strategies — 전략 정의 (Phase 4+)
| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | INT PK AUTO | |
| name | VARCHAR(64) | |
| params | JSON | |
| enabled | TINYINT | |

### signals — 분석가가 생성한 매매 시그널 (Phase 3B-4A 구현)
| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | BIGINT PK AUTO | |
| strategy_id | VARCHAR(64) NULL | 전략 식별자 (예: `rsi_momentum_v1`) |
| symbol | VARCHAR(32) | `KRW-BTC` 등 |
| side | ENUM('buy','sell') | |
| order_type | ENUM('limit','market') | |
| price | DECIMAL(36,8) NULL | |
| quantity | DECIMAL(36,18) NULL | |
| amount_krw | DECIMAL(18,2) | 라우팅 기준값(자동/승인) |
| reasoning | TEXT NULL | 분석가 자연어 근거 |
| indicators | JSON NULL | RSI·MA·가격 스냅샷 |
| status | ENUM | `pending` / `pending_approval` / `approved` / `rejected` / `auto_submitted` / `expired` / `superseded` / `ai_skipped` / `approved_pending_entry` / `executing` |
| expires_at | DATETIME NULL | TTL (기본 `SIGNAL_DEFAULT_TTL_MIN`) |
| consumed_order_id | BIGINT NULL | 승인·자동 제출 시 orders.id (FK 아님) |
| created_at | DATETIME | |
| updated_at | DATETIME | |

라우팅: `amount_krw <= SIGNAL_AUTO_SUBMIT_MAX_KRW`면 자동 제출(`source='auto'`) + `status='auto_submitted'`, 초과 시 승인 대기(`status='pending'`). 승인 시 `submitOrder(source='signal')` 호출.

### backtests — 백테스트 결과 (Phase 6)
| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | INT PK AUTO | |
| strategy_id | INT FK | |
| period_from | DATE | |
| period_to | DATE | |
| metrics | JSON | 샤프·MDD·승률 등 |
| created_at | DATETIME | |

## 상태 머신

```
pending → accepted → partially_filled → filled   (해외 market 도 지정가 규칙 — T-071)
       ↘ rejected (거래소 거부)
       ↘ failed   (네트워크/예외)
       ↘ cancelled
       ↘ dry_run  (safety에서 DRY_RUN으로 차단)
       ↘ blocked  (kill_switch / order_limit / symbol_not_allowed)
```

---

## 미국 종목 데이터 수집 P1 — 테이블 5개 (T-059 Part A, 2026-10-21)

> **부팅 DDL 이 아니다.** 위 테이블들과 달리 `src/lib/db.ts` 의 `setupDB()` 에 넣지 않았다. 정본 DDL 은
> [`scripts/migrations/T-059-us-data-collector.sql`](../scripts/migrations/T-059-us-data-collector.sql) 이고 **사용자 승인 후 사람이 직접 적용**한다
> (`deploy.yml` 에 migrate 단계가 없어 `--with-migrate` 는 거부된다). 적용 전에는 `edgar-sync`·`kis-fundamentals-snapshot` cron 이
> `skipped:'tables_missing'` 로 끝나고 `/api/fundamentals` 해외 심볼은 기존 LLM 경로 그대로다. 전부 신규 테이블(가산)이라 기존 테이블은 바뀌지 않는다.
>
> 시각: `*_at` DATETIME 은 KST(DB `NOW()` 또는 `toKstDatetime`). SEC 날짜(`filed`·`report_date`·`period_*`)와 `*_et` 는 **DATE**(미국 동부 현지 날짜, 시각 없음).

| 테이블 | 키 | 채우는 곳 | 핵심 컬럼 |
|---|---|---|---|
| `symbol_cik_map` | PK `symbol` | edgar-sync (SEC `company_tickers.json`) | `cik`, `sec_ticker`(BRK-B 형식), `verified_at` + 증분 상태 `submissions_sha256`·`facts_sha256`·`facts_filed_watermark`·`last_attempt_at`·`last_error` |
| `us_filings` | PK `accession` | edgar-sync (submissions `filings.recent`) | `form`(8-K·10-Q·10-K·20-F·6-K 등만), `items`, `report_date`, `filed`, `accepted_at`(KST), `primary_doc_url`, `is_earnings_release`(원본 8-K + item 2.02) |
| `us_financial_facts` | UQ `(cik, taxonomy, tag, unit, frame)` | edgar-sync (companyfacts) | **`frame` 있는 사실만**(YTD 누적 배제), 10-Q·10-K(+/A·20-F·40-F)만, 화이트리스트 태그만(`src/lib/data/us-edgar/xbrl-facts.ts` `XBRL_CONCEPTS`), `period_start`·`period_end`·`val`·`fy`·`fp`(제출 문서 기준)·`form`·`filed`·`accn`. 같은 키는 늦은 `filed` 가 이긴다 |
| `us_earnings_events` | UQ `(symbol, fiscal_period, status)` | edgar-sync(`estimated`) / 사람(`confirmed`·`manual`) | `status`, `event_date_et`(confirmed·manual 만), `window_start_et`·`window_end_et`(estimated — ±7일), `event_time_class`, `source_kind`, `source_url`, `basis`, `observed_at`, `superseded_by`. CHECK: estimated 는 날짜 NULL·창 필수 |
| `us_fundamentals_snapshot` | UQ `(symbol, snapshot_date)` | kis-fundamentals-snapshot (KIS `HHDFS76200200`) | `per`·`pbr`·`eps`·`bps`·`market_cap`(tomv 원값 = **달러(USD) 단위 시가총액**, 2026-10-21 INTC 실응답으로 확인)·`shares`·`h52`·`l52`·`last_price`·`currency`·`sector`·`etp_type`·`raw_output`·`observed_at` |

- 매출 등 대체 태그는 **원래 태그 이름으로 전부 저장**하고 읽을 때 `pickConceptValue()` 가 frame 마다 우선순위로 고른다.
- 회계연도 4분기 단독 frame 은 보통 없다(10-K 는 연간만) — **"최근 4개 분기 frame 합 = TTM" 은 틀린다.** P1 은 파생값을 만들지 않는다.
- `confirmed`/`manual` 실적 일정은 관리 SQL 로 넣는다(예: `INSERT INTO us_earnings_events (symbol, fiscal_period, event_date_et, event_time_class, status, source_kind, source_url, observed_at) VALUES ('NAS:INTC','FY2026Q3','2026-10-29','AMC','confirmed','ir_press_release','<보도자료 URL>',NOW())`).

---

## 검증 상태 관문 — `strategies.validation_*` + `paper_fills` (T-072, 2026-10-23)

> **부팅 DDL 이 아니다.** 정본 DDL 은 [`scripts/migrations/T-072-validation-gate.sql`](../scripts/migrations/T-072-validation-gate.sql) 이고
> `setupDB()` 에 넣지 않았다 — **사용자 승인 후 오프아워에 사람이 직접 적용**한다(멱등: `ADD COLUMN IF NOT EXISTS`·`CREATE TABLE IF NOT EXISTS`).
> 코드가 먼저 나가도 안전하다(열이 없으면 조회 오류 → 매수 차단, fail-closed) — 순서는 가상 체결 데이터 완전성 때문이다. 롤백 SQL 은 파일 끝 주석.
> 위 "strategies — 전략 정의" 초안 표는 옛 설계다(실제 `id` 는 `VARCHAR(64)` PK, `src/lib/db.ts` 시드).

### `strategies` 에 더해지는 열 3개
| 컬럼 | 타입 | 비고 |
|------|------|------|
| validation_status | ENUM('unvalidated','backtested','paper_validated') NOT NULL DEFAULT 'unvalidated' | **신규 매수 실주문 허용 = `backtested`·`paper_validated` 뿐**. 그 밖(unvalidated·행 없음·전략 귀속 없음·이상값·조회 실패)은 매수 차단. 매도는 이 값과 무관. 끄는 스위치·캐시 없음 |
| validation_changed_at | DATETIME NULL | 승급·강등 시각(KST) — 사람이 승인 SQL 로 채운다 |
| validation_evidence | VARCHAR(255) NULL | 승급 근거 링크(T-064·T-070 검증 결과) |

- **코드는 상태를 바꾸지 않는다.** 승급·강등은 사전 등록 합격 기준 통과 + 증거 확인 후 **사용자 승인 SQL 로만**(`PATCH /api/strategies/[id]` 는 이 열을 받지 않는다 — 시험 고정). 강등 SQL 은 폐장 시간대에 실행한다.
- 판정 지점(G1~G6): `createSignal` · post-market 카드 INSERT · `custom/confirm` · `approveSignal`/`approveSignalHybrid` · `entry-watcher` · `submitOrder`(최후 방어선 + 송신 직전 재검증). 판정 함수는 `src/lib/safety/validation-gate.ts` 하나다.

### `paper_fills` — 관문에 막힌 매수의 가상 체결(진입만)
실 장부(`orders`·`executions`·`position_state`·`portfolio_snapshots`·`holdings`)와 **분리한** 테이블이다 — 가상 행이 일일·종목 한도, 체결 손익, 킬스위치 낙폭 계산에 섞이지 않게(가짜 `orders` 행을 만들지 않는다). 청산·손익은 여기서 계산하지 않고 평가 단계(T-070/T-064)가 일봉으로 계산한다.

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | BIGINT PK AUTO | |
| signal_id | BIGINT NOT NULL **UNIQUE** | 원 시그널 id — 룰·API 시그널이면 승인 불가 감사 행(`signals.status='skipped'` + `indicators.gate='validation_gate'`), post-market 카드면 그 카드 행(역시 `skipped`). 멱등 키(중복 INSERT 는 1062 → "이미 있음"). FK 없음 |
| strategy_id | VARCHAR(64) NULL | 귀속 전략, NULL = 귀속 없음 |
| gate_reason | VARCHAR(32) | `null_strategy` · `unregistered` · `unvalidated` · `invalid_status` · `lookup_error` |
| origin | VARCHAR(16) | `engine` · `post_market` · `api_signals` · `analyst_run` · `unspecified` |
| market | ENUM('domestic','overseas') | |
| symbol | VARCHAR(32) | |
| side | ENUM('buy','sell') DEFAULT 'buy' | 이번 범위는 매수만 |
| order_type | ENUM('limit','market') | |
| currency | CHAR(3) | 지정가 통화 `KRW`·`USD` |
| limit_price | DECIMAL(36,8) NULL | **현지 통화** 지정가(해외 = 어댑터와 같은 USD 단가). 모르면 NULL |
| limit_price_krw | DECIMAL(36,8) NULL | 원화 지정가(해외는 환산값, 호가 추격 반영) |
| fx_usdkrw | DECIMAL(18,6) NULL | 해외 환산 환율(`fx_rates` 1시간 이내만, 외부 조회 없음), 국내 NULL |
| zone_lo / zone_hi | DECIMAL(36,8) NULL | 카드(구간 진입형)의 진입 구간 — **현지 통화** |
| quantity | DECIMAL(36,18) NULL | 실제 주문과 같은 사이징의 정수 주식 수. **`0` = 1주 가격 > 시그널 금액(실주문이었다면 `quantity_below_min` 으로 주문 불성립)**, **`NULL` = 미확정(시장가 등)** |
| amount_krw | DECIMAL(18,2) | 의도 금액(시그널 `amount_krw`, 재계산 안 함) |
| fee_rate_pct | DECIMAL(8,5) | 진입 편도 수수료율 % — 해외 0.25 · 국내 0.014(행마다 기록, 평가 때 보수 값으로 바꿀 수 있다) |
| fee_est_krw | DECIMAL(18,2) NULL | 수량 0 이면 0 |
| fill_model | VARCHAR(32) | `signal_limit_immediate`(룰 시그널 — "즉시 승인했다면", 승인 지연·TTL 무시한 **낙관 가정**) · `signal_market_immediate` · `zone_touch_pending`(카드 — 체결 여부는 `valid_from`~`valid_until` 일봉 고저와 구간으로 판정) |
| valid_from / valid_until | DATETIME NULL | KST. 카드는 카드 행과 같은 값, 시그널은 `valid_until` = 막히지 않았다면 받았을 만료 |
| signal_created_at | DATETIME | KST |
| created_at | DATETIME DEFAULT CURRENT_TIMESTAMP | |

인덱스: `UNIQUE uq_paper_fills_signal(signal_id)`, `idx_pf_strategy(strategy_id, signal_created_at)`, `idx_pf_symbol(symbol, signal_created_at)`. 콜레이션 `utf8mb4_general_ci`(운영 테이블과 같다).

> 🔴 **분석 쿼리 주의(Reviewer R-5)**: 승률·기대값·수익률을 낼 때는 **`quantity > 0` 필터를 명시**한다. `quantity = 0` 행(주문 불성립)과
> `NULL` 행(수량 미확정)은 체결로 셀 수 없다 — 그대로 두면 표본이 부풀고 수수료 0 인 행이 섞인다. `fill_model`(낙관 가정 정도가 다르다)과
> `gate_reason`·`origin` 별로 층화해서 본다. 엔진 경로는 진입 쿨다운 선점으로 실제 시그널과 같은 빈도로만 쌓이지만, 사람이 부르는
> `api_signals`·`analyst_run` 은 호출마다 1행이라 같은 요청 반복이 중복 표본이 될 수 있다.

> **기록 대상 범위(Codex C2 지적 1 판정, 2026-10-23)**: 가상 체결은 **시그널이 있는 G1(룰·API 시그널의 skipped 감사 행)과 G2(skipped 카드)에서만** 만들어진다.
> G3(사용자 시나리오 확정)·G4(승인)·G5(진입 감시)·G6(`submitOrder` 최후 방어선)과 전략 귀속 없는 직접 주문(`POST /api/orders`)의 차단은
> `orders`(`blocked_by='validation_gate'`)·`trade_logs` 흔적만 남기고 `paper_fills` 는 만들지 않는다. G6 발동은 '앞단을 우회한 버그'의 신호이고,
> 전략 귀속이 없는 주문은 검증할 가설이 없기 때문이다. 필요하면 `orders` 에서 재구성한다.

> 🔴 **고아 행과 소비 규칙(Codex C2 지적 2 판정)**: `paper_fills` INSERT 가 감사 행/카드 INSERT 뒤에 별도 문장이라, 마이그레이션보다 코드가 먼저 나가
> 테이블이 없던 기간처럼 쓰기가 실패하면 `signals` 에는 있는데 `paper_fills` 에는 없는 **고아 행**이 남고, 엔진은 쿨다운 때문에, 카드는 중복 판정
> (`post-market-engine.ts` 의 조기 `duplicate`) 때문에 **재실행해도 보충되지 않는다.** 실패 방향은 과소계상이다.
> - **소비 규칙**: 모집단은 `signals` 기준으로 정의하고 `paper_fills` 는 `LEFT JOIN` 으로 보강한다(`INNER JOIN` 으로 모집단을 정의하면 표본이 조용히 줄어든다).
> - **탐지(읽기 전용, 기대값 0)**:
>   `SELECT s.id, s.symbol, s.scenario_source, JSON_UNQUOTE(JSON_EXTRACT(s.indicators,'$.validation_gate.origin')) AS origin FROM signals s LEFT JOIN paper_fills p ON p.signal_id = s.id WHERE s.status = 'skipped' AND JSON_UNQUOTE(JSON_EXTRACT(s.indicators,'$.gate')) = 'validation_gate' AND p.id IS NULL`
> - **재조정**: 감사 행이 재조정에 필요한 정보를 모두 갖고 있어 멱등 재조정이 가능하다. 재조정 작업은 이 테이블을 처음 소비하는 task(T-064/T-070 후속)의 **착수 조건**이다.
