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
| symbol | VARCHAR(32) | `KRW-BTC` 등 |
| side | ENUM('buy','sell') | |
| type | ENUM('limit','market') | |
| price | DECIMAL(36,8) NULL | |
| quantity | DECIMAL(36,18) NULL | |
| amount_krw | DECIMAL(18,2) NULL | 시장가 매수 등 |
| status | ENUM('pending','accepted','partially_filled','filled','cancelled','rejected','failed','dry_run') | |
| blocked_by | VARCHAR(32) NULL | safety 거부 사유 |
| created_at | DATETIME | |
| updated_at | DATETIME | |

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
pending → accepted → partially_filled → filled
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
