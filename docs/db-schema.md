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

---

## 자금 이동 원장 — `cash_flow_ledger` + `system_config` 키 2개 (T-074, 2026-10-23)

> **부팅 DDL 이 아니다.** 앱 시작 때 자동으로 만들지 않는다(`src/lib/db.ts` `setupDB()` 에 넣지 않았다 — 정적 시험 고정). 정본 DDL 은
> [`scripts/migrations/T-074-cash-flow-ledger.sql`](../scripts/migrations/T-074-cash-flow-ledger.sql) 이고 **사용자 명시 승인 후 오프아워에 사람이 직접 적용**한다
> (`CREATE TABLE IF NOT EXISTS` — 멱등, MariaDB 10.2+ 의 CHECK·PERSISTENT 생성열). 적용 전에는 `/api/cash-ledger/*` 가 503 `not_migrated`(원장 표가 없을 때만 —
> 다른 표의 1146 은 500)로 답하고 화면은 중립 '준비 중'이다. 새 테이블 1개 추가뿐이라 기존 테이블·행은 바뀌지 않는다. 롤백 SQL 은 파일 끝 주석(표 삭제 + 키 2개 삭제).
> 쓰기 경로는 `src/lib/ledger/store.ts` 하나이고 주문·시그널·안전장치 경로는 이 테이블을 모른다.

### `cash_flow_ledger` — 사용자가 직접 적는 입금·출금·환전 기록
"입출금 뺀 투자 손익"(`src/lib/ledger/compute.ts`)의 순입금 원천. **추가 전용** — 금액·종류·통화·시각·메모는 UPDATE 하지 않는다(정정 = 새 행 + 원래 행 소프트 삭제, 취소 = 소프트 삭제·복구 가능). 앱이 UPDATE 하는 열은 `deleted_*`(취소·복구)와 `anchor_*`·`fx_rate_used`·`fx_source`·`krw_equiv`(스냅샷 매칭 파생값)뿐이다(정적 시험 고정).

| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | BIGINT PK AUTO | |
| account_id | INT NOT NULL DEFAULT 1 | FK → `accounts(id)`. 계좌 1 전역(회원별 아님 — 회원 1명 전제, Reviewer L3) |
| client_entry_id | VARCHAR(36) NOT NULL **UNIQUE** | 폼이 만든 이중 제출 멱등키(8~36자). 같은 키로 **같은 내용**이 다시 오면 저장된 기록을 돌려주고(`replayed`), 내용이 다르면 409 `client_entry_conflict` |
| kind | ENUM('deposit','withdrawal','exchange') NOT NULL | 방향은 이 값(금액은 항상 양수) |
| occurred_at | DATETIME NOT NULL | KST 벽시계(`portfolio_snapshots.ts` 와 같은 규약), **분 단위**(CHECK) |
| currency | CHAR(3) NOT NULL | `KRW`·`USD`(CHECK). 환전은 낸 통화 |
| amount | DECIMAL(18,2) NOT NULL | > 0(CHECK), 원화는 정수(CHECK) |
| counter_currency / counter_amount | CHAR(3) / DECIMAL(18,2) NULL | 환전 전용 받은 쪽(양수, 낸 통화와 달라야 함, 원화는 정수). 입출금이면 둘 다 NULL(CHECK). 환율은 저장하지 않고 원화 ÷ 달러로 유도 |
| fx_rate_used | DECIMAL(12,4) NULL | USD 입출금 원화 환산 환율(반영 스냅샷 USD 행 `price`, 불일치면 기록 뒤 첫 스냅샷) / 환전은 비용 추정용 |
| fx_source | ENUM('snapshot','user') NULL | |
| krw_equiv | DECIMAL(18,2) NULL | 순입금용 원화 환산. KRW = 금액, USD = 금액 × `fx_rate_used`, 환전 = NULL |
| anchor_snapshot_id / anchor_snapshot_ts | BIGINT / DATETIME NULL | 처음 반영된 `portfolio_snapshots` 행(FK 없음 — 정리된 적 있는 로그 테이블) |
| anchor_status | ENUM('pending','matched','unmatched') NOT NULL DEFAULT 'pending' | 반영 대기(순입금 제외) · 반영됨 · 불일치(기록대로 포함). 조회 때 지연 매칭으로 바뀐다(크론 무관) |
| anchor_detail | VARCHAR(200) NULL | 반영 근거·불일치 사유(한국어 문장) |
| memo | VARCHAR(200) NULL | |
| source | ENUM('user','import') NOT NULL DEFAULT 'user' | `import` = 향후 KIS 입출금 조회 자리 |
| supersedes_id | BIGINT NULL **UNIQUE** | 정정: 이 행이 대체한 행(FK 자기 참조). 한 기록은 한 번만 정정 |
| created_at | DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP | |
| created_by_user_id / deleted_by_user_id | INT UNSIGNED NULL | 감사 열(`users.id` 타입, FK 없음) |
| deleted_at / delete_reason | DATETIME / VARCHAR(200) NULL | 소프트 삭제(복구 = NULL), 마지막 취소 사유 |
| live | TINYINT AS (IF(deleted_at IS NULL, 1, NULL)) PERSISTENT | 살아 있는 행만 중복 검사(삭제 행 = NULL 은 충돌 안 함) |

- **CHECK 5개**: `chk_cfl_amount`(amount > 0) · `chk_cfl_ccy`(KRW·USD) · `chk_cfl_krw_int`(원화 정수) · `chk_cfl_minute`(초 = 0) · `chk_cfl_exch`(환전이면 counter_* 필수·다른 통화·양수·원화 정수 — `IS NOT NULL` 명시로 NULL 통과 구멍을 막았다 / 입출금이면 counter_* NULL).
- **UNIQUE 3개**: `uq_cfl_client_entry(client_entry_id)` · `uq_cfl_live_dup(account_id, kind, currency, amount, occurred_at, live)` — 살아 있는 같은 (종류·통화·금액·분) 기록 중복 금지(409 `duplicate`) · `uq_cfl_supersedes(supersedes_id)`.
- **인덱스**: `idx_cfl_account_time(account_id, deleted_at, occurred_at)`, `idx_cfl_anchor(anchor_snapshot_id)`.
- **FK 2개**: `fk_cfl_account → accounts(id)`, `fk_cfl_super → cash_flow_ledger(id)`. 이 표를 참조하는 다른 객체는 없다(표 삭제 한 문장으로 되돌려진다).
- 콜레이션 `utf8mb4_general_ci` 명시(운영 서버 기본은 utf8mb3 — 운영 테이블과 맞춤). 마이그레이션을 바꾸면 일회용 DB 시험(`T074_TEST_DB_PORT` 를 준 `t074-disposable-mariadb.test.ts`, 24건)을 반드시 돌린다 — 기본 `npm test` 에서는 건너뛴다(Reviewer L6).

### `system_config` 새 키 2개 (DDL 없음, 첫 저장 때 생긴다)
| 키 | 값(JSON) | 쓰는 곳 |
|------|------|------|
| `cash_ledger_baseline` | 손익 기준: `version`·`updatedAt`·`baselineAt`(기준 스냅샷 ts)·`snapshotId`·`snapshot{totalKrw,krwCash,usdCash,fx}`(동결)·`confirmed{krwCash,usdCash,at,note}`(사용자 확인 현금, 없으면 null)·`baselineTotalKrw`·`history[]`(최근 20) | `PUT /api/cash-ledger/baseline` — `version` 낙관적 잠금(불일치 409 `version`). 손상되면 조회가 500 + 복구 안내("키를 삭제한 뒤 기준을 다시 정하세요") |
| `cash_ledger_candidate_marks` | '입출금 아님' 표시: `version`·`marks{"<스냅샷 id>-<통화>": {state,reason,at,byUserId}}`(최대 1,000)·`log[]`(최대 200) | `POST /api/cash-ledger/candidates/:key/{dismiss,reopen}` — 낙관적 잠금 + 재시도 3회 |

---

## 청산 판단 영구 기록 — `exit_judgment` (T-126, 2026-10-31)

> **부팅 DDL 이 아니다.** 정본 DDL 은 [`scripts/migrations/T-126-exit-judgment.sql`](../scripts/migrations/T-126-exit-judgment.sql)(새 테이블 1개, 가산 전용·외래키 없음)이고
> `setupDB()` 에 넣지 않았다 — QA PASS 뒤 웹 배포보다 먼저 장외 창에서 사람이 직접 적용한다(적용 전후 확인 쿼리는 파일 머리 주석). 1행 = 청산 평가 틱(`run_id` — `eval_funnel.run_id`
> 와 같은 분 단위 값이라 **UNIQUE 없음**) × 보유 종목의 결론 하나: `decision`(fired·skip_policy·skip_cooldown·error·no_fire) + `decision_code`(eval_funnel 게이트 ID 그대로) +
> 엔진이 그 지점까지 가진 값(수량·진입가·고점·현재가·`pnl_pct`·`trigger_kind`·적용 임계 `threshold_pct`·스위치 상태·`signal_id`·`engine_release`). 가격은 국내·해외 모두
> **원화**다 — 해외도 어댑터(`kis-overseas` getTicker·getBalances)가 시세·평단을 원화로 환산해 주므로 `currency='KRW'`. 국내는 항상 'KRW', 해외는 price/entry_price 비율이
> 엔진 단위 검사 범위 [0.3, 3.0] 밖이거나 시세가 없으면 `currency`·`pnl_pct` NULL. 환율 함수(`fetchUsdKrwRate`)는 던지지 않고 환율을 못 얻으면 1 을 돌려주는데(드묾 —
> 외부 → DB 캐시 → 상수 폴백), 그때 값은 달러 원값이다: 한쪽만 1 이면 범위 밖이라 NULL, 시세·평단이 둘 다 1 이면 단위 검사를 통과해 `'KRW'` 로 잘못 남는다(알려진 한계).
> 기록 INSERT 는 풀에서 받은 연결로 보내고 4초 상한을 넘기면 그 연결을 버린다(`destroy` — 표가 잠겨도 풀이 바닥나지 않게, T-126 R1). `threshold_pct` 는 `pnl_pct` 와 같은 부호
> (손절 음수·익절 양수, 트레일링·시나리오 포지션 NULL). 가상 주문(DRY_RUN) 열은 없다 — `signal_id → signals.consumed_order_id → orders.status` 로 본다.
> 쓰는 곳은 `src/lib/strategy/records/exit-judgment.ts` 하나(틱 끝 분리 실행 multi-row INSERT, 4초 상한, 실패는 경고 1줄 — 청산 평가에 영향 없음).
> 기록 스위치 `system_config.exit_judgment_record_enabled` 는 **키 없음 = 꺼짐**(정확히 JSON `true` 만 켜짐, 30초 캐시) — 켜기는 DDL·배포 뒤 별도 승인이고, 끄는 것이 곧 롤백이다.
> 남지 않는 것: 잔고 미확인 틱·보유 0종목 틱·매수 판단·틱 도중 예외로 끝나지 않은 틱. 보존 기간 삭제는 아직 없다(별도 승인 사안). 마이그레이션을 바꾸면 일회용 DB 시험
> (`T126_DB_PORT` 를 준 `src/lib/strategy/records/__tests__/exit-judgment-disposable-mariadb.test.ts`)을 반드시 돌린다 — 기본 `npm test` 에서는 정적 검사만 돈다.

---

## 거시 레짐 라벨 기록 — `eval_funnel` 최종 run 행 `detail.macroRegime` (T-165, 2026-11-12)

> **DDL 없음.** `strategy-eval` 런(`runMarket`)의 최종 pass run 행(`gate='run'`, `verdict='pass'`) `detail` JSON 끝에 `macroRegime` 객체 하나가 더해진다(약 1KB, 60,000자 한도 안). 조기 종료 run 행 3곳에는 넣지 않는다 — 한 런에 한 번.
> 매매 판단·게이트·사이징·AI 프롬프트에 **쓰지 않는다**(C0 = 기록만, 판단 영향 0 — 의존 경계·불변식 시험이 고정). 규칙 버전 `ruleVersion = "macro-regime-c0@1"`.
> 필드: `label`(`hot_tightening`=유형⑤ · `hot_hold` · `hot_easing` · `normal_tightening` · `normal_hold` · `normal_easing` · `unknown`)·`isType5`·`reasonCodes[]`(`cpi_not_loaded`·`cpi_cache_stale`·`cpi_stale`·`rate_table_before_start`·`rate_table_stale`·`rate_schedule_exhausted`·`internal_error`)·`asOfUtc`·`asOfEtDate`·
> `cpi{seriesId, referenceMonth, releaseAtUtc, index, baseMonth, baseIndex, yoyPctRaw, yoyPct, hot, monthGap, expectedReferenceMonth, lagsSchedule, fetchedAtUtc, cacheAgeSec, fetchStatus}`·
> `rate{upperPct, upperEffectiveFrom, compareDate, upper6mAgoPct, deltaPct, direction, tableVerifiedThrough, nextKnownDecisionDate}`. 기록은 **자기완결적**이다 — 라벨 판정에 쓴 입력(지수·기준지수·기준월·발표 시각·수집 시각·수집 상태·금리 상단 2개)이 행 안에 모두 있어 그 행만으로 당시 판정을 재현할 수 있다.
> ⚠ **보관 한계 30일**: `eval_funnel` 은 30일 지난 행을 배치 삭제한다(`eval-funnel.ts` `RETENTION_DAYS = 30`). 그래서 T-164 의 C0→C1 승격 조건(라벨 60거래일·오류율·월 플립)을 이 행만으로는 셀 수 없다. **장기 보관은 전용 표 `macro_regime_label_log`(T-167 — 아래 절, DDL 적용 후)가 맡는다**(사용자 선택 (a) 전용 테이블 + 삭제 전 이관, 2026-11-12. JSONL·30일 롤링은 기각). DDL 적용 전 구간의 라벨은 이 행이 30일 안에 그 표로 이관돼야만 남는다 — **마감 2026-12-12 10:20 KST**(첫 라벨 행 id 904956 + 30일).
> **사후 재계산값을 운영 관측의 대체 증거로 쓰지 않는다.** 라벨 규칙은 순수 함수라 과거 날짜의 라벨은 언제든 다시 계산할 수 있지만(과거 재계산은 `releaseBasis: 'confirmed_only'` 로만), 재계산은 당시의 캐시 상태·수집 실패·미로딩을 재현하지 못한다 — 운영 지표(수집 실패·미로딩 비율·실제 기록 라벨)는 이 행(과 그것을 그대로 옮긴 `macro_regime_label_log` 행)이 유일한 증거다.

---

## 거시 레짐 라벨 장기 보관 — `macro_regime_label_log` (T-167, 2026-11-12)

> **부팅 DDL 이 아니다.** 정본 DDL 은 [`scripts/migrations/T-167-macro-regime-label-log.sql`](../scripts/migrations/T-167-macro-regime-label-log.sql)(새 테이블 1개, 가산 전용·외래키 없음), 이관은 [`scripts/migrations/T-167-macro-regime-label-backfill.sql`](../scripts/migrations/T-167-macro-regime-label-backfill.sql)(멱등 `INSERT … SELECT` 1문장 — 다시 돌려도 같은 결과)이다. 둘 다 `setupDB()` 에 넣지 않았고 장외 창에서 사람이 직접 적용한다(사용자 승인 사항, 적용 전후 확인 쿼리는 각 파일 머리 주석).
> **1행 = strategy-eval 런 1회**(국내·미국 모두) — 최종 pass run 행(`eval_funnel` `gate='run'`, `verdict='pass'`)의 `detail.macroRegime` 과 **같은 기록 객체**를 그대로 남긴다. 조기 종료 run 행·휴장에는 행이 없다(라벨을 만들지 않는다). 열은 기록 객체의 스칼라 전부(`cpi.seriesId` 상수 제외)를 조회용 열로 펼치고 원본 전체를 `record_json`(공백 없는 JSON — 앱 `JSON.stringify` 원문, 이관은 `JSON_COMPACT(JSON_EXTRACT(…))` 로 같은 바이트)에 둔다 — 행만으로 당시 판정을 재현할 수 있다. 출처 `source`(`live` 실시간 · `backfill` 이관), 이관 행만 `source_eval_funnel_id`(원본 id)·`source_ts_kst`(원본 flush 시각), 실시간 행만 `engine_release`(릴리스 디렉터리 이름 — T-112·T-126 과 같은 정의).
> **시각**: 이름이 `_utc` 인 열은 UTC 벽시계, `_kst` 는 KST 벽시계(초). `as_of_utc` = 기록 객체 `asOfUtc`(판정 시각), `as_of_kst` = 그 + 9시간(실시간·이관 같은 의미), `as_of_et_date` = `asOfEtDate`(미 동부 달력일). `inserted_at` 은 행이 쓰인 DB 시각(감사용 — 지표에 쓰지 않는다).
> **어휘**: ENUM 은 `source`·`market` 둘뿐이다. 라벨·사유·수집 상태·방향·규칙 버전은 VARCHAR — 규칙 버전이 바뀌면 값이 늘고, strict 에서 ENUM 밖 값은 INSERT 전체 실패인데 기록기는 예외를 삼키므로 행이 조용히 사라지기 때문이다. `reason_codes` 는 사유를 기록 순서대로 쉼표 결합(없으면 `''`)하고 `reason_first`·`reason_count` 를 함께 둔다 — `FIND_IN_SET('cpi_stale', reason_codes)`·`reason_codes = 'cpi_not_loaded'`(단독 판별)로 조회한다.
> **유일 키 `(run_id, as_of_utc)`**: 실시간 행과 이관 행은 같은 기록 객체(같은 `asOfUtc`)라 같은 런이면 한 행이 된다 — 엔진은 기록 객체를 **한 번만** 만들어 run 행 detail 과 기록기에 같은 참조를 넘긴다(불변식 시험이 고정). `run_id` 는 분 단위라 단독 UNIQUE 를 걸 수 없다(T-126). ⚠ 알려진 한계(Codex C1 지적 1 — 부분 채택): 같은 시장의 두 런이 **같은 분에 시작해 같은 초에 끝나면**(수동 force 실행이 cron 과 겹칠 때 정도) 두 번째 실시간 행은 1062 로 건너뛰어진다 — 이관 파일의 대조 쿼리 ⓑ 가 그 충돌 수를 드러낸다. `asOfUtc` 가 비어 있는 기록(내부 오류 경로 — 실질 도달 불가)은 실시간이 호출 시각, 이관이 `eval_funnel.ts − 9h` 로 대신하므로 몇 초 달라 두 행이 될 수 있다.
> **쓰는 곳**은 `src/lib/strategy/macro-regime/label-log.ts` 하나 — 엔진이 그 런의 `eval_funnel` flush **뒤** `recordMacroRegimeLabel()` 을 부르면(동기·무예외·기다리지 않음) 다음 마이크로태스크에서 1행 INSERT 1문장을 보낸다(풀에서 받은 연결로, 4초 상한 — 넘거나 오류면 그 연결을 `destroy`, `INSERT IGNORE`·`ON DUPLICATE KEY` 없음). 결과: `written` · `duplicate`(1062 — 이미 이관된 런, 경고 없음) · `no_table`(1146 — DDL 적용 전, 경고는 프로세스 첫 1회 + 이후 24시간에 1회) · `disabled` · `disabled_in_test` · `invalid` · `error` · `timeout`(셋은 분류어별 1시간에 1회 경고 — 분류어·errno·시장만, DB 원문 없음). 판단·게이트·사이징·AI 프롬프트 영향 0 (T-165 그대로 — 불변식 시험이 기록기 실패·예외·표 없음·끝나지 않는 INSERT 에도 엔진 출력이 바이트 단위로 같음을 고정). 관찰(일회용 DB): 표가 잠겨 4초에 포기한 INSERT 는 연결을 끊어도 서버 쪽에서 잠금이 풀린 뒤 늦게 써질 수 있다(같은 행 — 유일 키 때문에 중복은 없다).
> **스위치** `MACRO_REGIME_LABEL_LOG_ENABLED`(환경변수, `.env.example`) — 키 없음·빈 값 = **켜짐**, 앞뒤 공백 제거·대소문자 무시 `false` 만 끈다. `EVAL_FUNNEL_ENABLED` 와 독립(그것이 꺼져도 이 표는 쓴다 — 그때는 이 표가 라벨의 유일한 기록이다). 끄고 켜기는 `pm2 restart stockinvest --update-env`(사용자 승인 사항)이고, **끈 사실과 기간은 운영자가 운영 기록에 남긴다** — 끈 기간은 증거 공백이며 `eval_funnel` 이 30일 남아 있는 동안 이관 파일을 다시 돌리면 메워진다. 시험 환경(`NODE_ENV=test` 또는 `JEST_WORKER_ID`)에서는 시험 훅으로 켜지 않는 한 DB 에 닿지 않는다.
> **보관: 자동 삭제 없음.** 어떤 코드에도 이 표를 대상으로 한 DELETE 가 없다(`eval_funnel` 정리는 표 이름 고정). 추정: 하루 약 120행(국내 ≈ 60 런 + 미국 정규장 ≈ 60 런 — `isOverseasOpen` 은 09:30~16:00 ET 정규장만), 연 약 3만 행, 행당 ≈ 1.1~1.3 KB → **연 ≈ 35~40 MB**. 되돌리기는 DDL 파일 끝 주석의 DROP 줄(쌓인 기록 함께 삭제 — 사용자 승인 사항).
> **이관·적용 순서**(T-167 Leader G6): ① DDL(장외 창) → ② 이관 1차 → ③ push(웹 0.8.0 배포) → ④ 배포 뒤 첫 장중 런 기록 확인 → ⑤ 이관 2차(멱등 — ①~③ 사이 런을 메운다) → ⑥ 이관 파일의 확인·대조 쿼리(①②ⓐⓑⓒ — 원본 삭제 전 마지막 대조 포함). **마감 2026-12-12 10:20 KST**(그 뒤 첫 prune 부터 첫 라벨 행이 지워진다, 권장 여유 12-05 이전). 이관 대상 = `gate='run'`·`verdict='pass'`·`ts >= '2026-11-12'`·**`ts < NOW() − 2분`**(막 끝난 런은 실시간 기록기가 쓰는 중일 수 있어 집지 않는다)·`detail.macroRegime` 이 JSON 객체 · 같은 `(run_id, as_of_utc)` 행이 아직 없는 것. 이관 세션은 `READ COMMITTED`·잠금 대기 5초 — 원본 `eval_funnel` 을 잠그지 않아 엔진의 flush 를 막지 않는다(일회용 DB 관찰: RC 는 열린 이관 트랜잭션 중에도 엔진 INSERT 가 즉시 통과, REPEATABLE READ 는 1205 로 막혔다). 실시간 기록과 경합하면 1062 로 **문장 전체가 0행으로 롤백**되고, 그대로 다시 실행하면 된다(일회용 DB 재현). **원본 중복은 가장 작은 id 하나만 옮긴다**(대조 쿼리 ⓑ 로 수 확인 — G10 R-1: 같은 분 시작·같은 초 종료 두 런이 `eval_funnel` 에 같은 `(run_id, as_of_utc)` 로 남으면 둘 다 옮기려다 매번 1062 로 이관 전체가 막히므로 키마다 `eval_funnel.id` 가 가장 작은 행만 옮기고 나머지 관측은 남기지 않는다). 그래도 1062 가 반복되면 장중 실시간 경합이다 — 장외에 다시 실행한다.
> **반올림 경로**(G10 R-2 — 수정하지 않음): 조회용 DECIMAL 열은 실시간이 JS(`toFixed`), 이관이 SQL(`CAST … AS DECIMAL`)로 반올림해 정확한 반올림 경계에서는 두 출처가 1단위 갈릴 수 있다. 그러나 기록 객체의 숫자는 분류 단계에서 이미 열 소수 자리 이하로 만들어지므로(지수는 BLS 3자리 ≤ 열 4자리 · `yoyPctRaw` 4자리 · `yoyPct` 1자리 · `deltaPct`·금리 2자리 — T-165 `classify.ts`) 이 표에 들어오는 값으로는 그 경계에 도달하지 않는다[가능성 높음]. `record_json` 은 두 경로가 바이트 동일이라 원본 정보 손실은 없다.
> ⚠ **무손실은 조건부다**(Codex C1 지적 2 — 채택): 표가 생기기 **전** 구간의 런은 `eval_funnel` 에 그 런의 run 행이 **실제로 써졌을 때만** 이관으로 되살린다 — `EVAL_FUNNEL_ENABLED=false`·flush 실패·런당 8000행 상한으로 run 행이 없으면 원본이 없고 되살릴 수 없다(`await flush()` 완료는 저장 영수증이 아니다). 표가 생긴 **뒤**의 실시간 기록은 `eval_funnel` 과 독립이라(같은 객체를 직접 받는다) 이 손실 경로는 DDL 적용 전 구간에만 있다 → DDL 을 먼저·빨리 적용한다.
> 마이그레이션·기록기를 바꾸면 일회용 DB 시험(`T167_DB_PORT` 를 준 `src/lib/strategy/macro-regime/__tests__/label-log-disposable-mariadb.test.ts`)을 반드시 돌린다 — 기본 `npm test` 에서는 정적 검사만 돈다.

### 승격 지표 계산 정의 (T-164 C0→C1 — Analyst A6 + Leader L2 + G9-4)

모두 `rule_version` 하나로 좁혀 센다(버전이 바뀌면 라벨 어휘·순서가 바뀔 수 있어 창을 끊는다). 아래 SQL 은 정의이며 이 task 에서 실행하지 않았다. 이 표의 어떤 수치도 전략 성과·에지를 뜻하지 않는다(라벨은 기록용).

- **관측 거래일 — 주 지표 = 미국 거래일**(L2): `market='overseas'` 행의 서로 다른 `as_of_et_date` 중 `label <> 'unknown'` 행이 1개 이상인 날의 수. 양 시장 합산 ET 날짜는 **보조로만** 보고한다 — 국내 런(09:00~15:30 KST)의 `asOfEtDate` 는 미 동부 기준 전날 저녁이라 월요일 국내 장이 일요일 ET 날짜로 찍혀, 합산하면 한 주에 6개 날짜가 생겨 「거래일」이 부풀려진다. 국내는 `DATE(as_of_kst)` 기준 국내 거래일로 따로 센다. 승격 판정 자체는 그때 사용자가 한다.
  ```sql
  SELECT COUNT(DISTINCT as_of_et_date) AS us_observed_days FROM macro_regime_label_log
  WHERE rule_version = 'macro-regime-c0@1' AND market = 'overseas' AND label <> 'unknown' AND as_of_et_date BETWEEN :from AND :to;
  -- 보조: 양 시장 합산 ET 날짜(market 조건 없이 같은 식) · 국내 거래일: COUNT(DISTINCT DATE(as_of_kst)) … WHERE market = 'domestic'
  ```
- **오류율** = (`label='unknown'` 이고 `reason_codes <> 'cpi_not_loaded'` 인 행 수) / 전체 행 수, 60거래일 창 전체로 **< 5%**. `cpi_not_loaded` **단독**은 「미로딩」으로 따로 세고 오류에 넣지 않는다(미로딩 때 `cpi_stale` 을 겹쳐 적지 않으므로 단독 판별이 가능하다). `cpi_not_loaded` 에 다른 사유가 함께 있으면 오류다. `internal_error` 는 오류. 끄기 손잡이(`cpi_fetch_status='disabled'`)로 생긴 `cpi_not_loaded` 단독 unknown 도 미로딩이다(운영 결정 — 보고서에 그 기간을 적는다). `cpi_fetch_status` 비-ok 는 라벨과 독립이라(수집 실패는 캐시를 덮지 않는다) 오류율에 넣지 않고 「마지막 시도 결과의 런 가중 노출」로 따로 보고한다.
  ```sql
  SELECT COUNT(*) AS runs,
         SUM(label = 'unknown' AND reason_codes = 'cpi_not_loaded') AS unloaded_runs,
         SUM(label = 'unknown' AND reason_codes <> 'cpi_not_loaded') AS error_runs,
         SUM(label = 'unknown' AND reason_codes <> 'cpi_not_loaded') / COUNT(*) AS error_rate,
         SUM(cpi_fetch_status NOT IN ('ok', 'not_attempted', 'disabled')) AS fetch_fail_exposed_runs,
         SUM(cpi_fetch_status = 'ok' AND label <> 'unknown' AND cpi_cache_age_sec > 86400) AS stale_cache_runs
  FROM macro_regime_label_log
  WHERE rule_version = 'macro-regime-c0@1' AND as_of_et_date BETWEEN :from AND :to;
  ```
- **월 플립** = `label <> 'unknown'` 행만 `as_of_utc, id` 순으로 늘어놓고(국내·미국 섞어 시간순 — 라벨은 전역 값) 직전 행과 라벨이 다르면 1회, **뒤 행의 ET 달력월**에 귀속. unknown 을 빼고 이어 붙이므로 「A→unknown→A」는 0회, 「A→unknown→B」는 1회. 조건: 창 안 **모든** 달이 ≤ 2회. 🔴 `LAG` 는 **같은 `rule_version` 전체 행에서 먼저 계산한 뒤** 바깥에서 날짜 창을 거른다(G9-4 — 창 안에서만 계산하면 창 직전 마지막 라벨을 못 보고 창 경계의 플립을 놓친다. 예: 11/30=A, 12/01=B, 12/10=A, 12/20=B 를 12/01 부터 보면 12월 플립은 3회다). 검산: 플립 시각은 CPI 발표(08:30 ET)나 FOMC 효력일 직후여야 하고 다른 시각의 플립은 결함 신호다.
  ```sql
  WITH seq AS (
    SELECT id, as_of_utc, as_of_et_date, label,
           LAG(label) OVER (ORDER BY as_of_utc, id) AS prev_label
    FROM macro_regime_label_log
    WHERE rule_version = 'macro-regime-c0@1' AND label <> 'unknown'
  )
  SELECT DATE_FORMAT(as_of_et_date, '%Y-%m') AS et_month,
         SUM(prev_label IS NOT NULL AND label <> prev_label) AS flips
  FROM seq
  WHERE as_of_et_date BETWEEN :from AND :to
  GROUP BY 1 ORDER BY 1;
  ```
