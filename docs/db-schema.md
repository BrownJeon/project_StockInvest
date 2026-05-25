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
