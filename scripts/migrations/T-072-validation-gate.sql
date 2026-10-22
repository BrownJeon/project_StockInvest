-- T-072 (D5) — 검증 상태 관문 + 가상 체결 저장소 (가산 전용: 기존 컬럼·행 변경 없음)
--
-- 1) strategies.validation_status ENUM('unvalidated','backtested','paper_validated') NOT NULL DEFAULT 'unvalidated'
--    (+ 승급 감사용 validation_changed_at·validation_evidence). 기존 행은 전부 'unvalidated' 가 된다 — 승급 경로는 없다.
--    상태 승급은 코드가 하지 않는다: 사전 등록 합격 기준 통과 + 증거 링크가 있을 때 **사용자 승인 SQL 로만**(설계 F-10).
--    `PATCH /api/strategies/[id]` 는 이 컬럼을 받지 않는다.
-- 2) paper_fills — 검증 관문에 막힌 매수의 가상 체결(진입만). 실 장부(orders·executions·position_state·portfolio_snapshots·holdings)와
--    분리한다(설계 L-3: executions 는 order_id NOT NULL + FK → 가짜 orders 행이 필요하고, 그 행이 일일 한도·종목 한도·손익을 오염시킨다).
--
-- ⚠ 이 파일은 **앱 부팅 때 실행되지 않는다**(src/lib/db.ts 의 setupDB 에 넣지 않았다 — T-059·T-070 선례). 개발·운영이 같은 NAS MariaDB 라서
--   배포만으로 DDL 이 돌면 "--with-migrate 는 사용자 승인" 원칙이 무력화되기 때문이다. Reviewer·QA 통과 뒤 오프아워(국내·미국 모두 폐장,
--   F-14)에 **코드 배포보다 먼저** 적용한다:
--     mysql -h <DB_HOST> -u <DB_USER> -p <DB_NAME> < scripts/migrations/T-072-validation-gate.sql
--   `ADD COLUMN IF NOT EXISTS`·`CREATE TABLE IF NOT EXISTS` 라 두 번 실행해도 안전하다(멱등). strategies 는 16행(10-23 실측)이라 즉시 끝난다.
--
-- 호환(양방향 무해):
--   - 구 코드 + 새 컬럼/테이블: 읽는 코드 없음. 시드 INSERT IGNORE 는 열 목록을 명시하므로 DEFAULT 'unvalidated' 로 채워진다.
--   - 새 코드 + 컬럼 없음: 조회 오류(ER_BAD_FIELD_ERROR) → lookup_error → 매수 차단(fail-closed, 의도와 같다).
--   - 새 코드 + 테이블 없음: 가상 체결 INSERT 실패 → 삼키고 차단 유지(던지지 않음). 그 기간 가상 체결 데이터만 유실된다.
--   → 마이그레이션을 먼저 하는 이유는 안전이 아니라 **가상 체결 데이터 완전성**이다.
--
-- 적용 후 확인:
--   SELECT id, validation_status FROM strategies;           -- 전부 'unvalidated'
--   SHOW CREATE TABLE paper_fills;                          -- uq_paper_fills_signal 존재
--
-- 롤백 주의: 코드 revert 는 관문을 없애므로 **신규 매수를 다시 연다**(운영 safety_dry_run=false). 매수를 계속 막아야 하면
--   킬스위치/DRY_RUN 판단을 함께 해야 한다. 컬럼·테이블은 존치해도 무해하다.

SET SESSION lock_wait_timeout = 5;

ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS validation_status ENUM('unvalidated','backtested','paper_validated')
      NOT NULL DEFAULT 'unvalidated' AFTER enabled,
  ADD COLUMN IF NOT EXISTS validation_changed_at DATETIME NULL AFTER validation_status,      -- 승급·강등 시각(KST) — 사용자 SQL 이 채운다
  ADD COLUMN IF NOT EXISTS validation_evidence VARCHAR(255) NULL AFTER validation_changed_at; -- 증거 링크(T-064·T-070 결과)

CREATE TABLE IF NOT EXISTS paper_fills (
  id                BIGINT        NOT NULL AUTO_INCREMENT,
  signal_id         BIGINT        NOT NULL,        -- 원 시그널(승인 불가 감사 행·카드 행) id — 멱등 키. FK 없음(signals 는 쓰기가 잦다)
  strategy_id       VARCHAR(64)   NULL,            -- 귀속 전략, NULL = 귀속 없음
  gate_reason       VARCHAR(32)   NOT NULL,        -- unvalidated|unregistered|null_strategy|invalid_status|lookup_error
  origin            VARCHAR(16)   NOT NULL,        -- engine|post_market|api_signals|analyst_run|unspecified
  market            ENUM('domestic','overseas') NOT NULL,
  symbol            VARCHAR(32)   NOT NULL,
  side              ENUM('buy','sell') NOT NULL DEFAULT 'buy',   -- 이번 범위는 buy 만(L-6)
  order_type        ENUM('limit','market') NOT NULL,
  currency          CHAR(3)       NOT NULL,        -- 지정가 통화 KRW|USD
  limit_price       DECIMAL(36,8) NULL,            -- 현지 통화 지정가(해외 = 어댑터와 같은 USD 단가 overseasLimitUnitUsd). 모르면 NULL
  limit_price_krw   DECIMAL(36,8) NULL,            -- 원화 지정가(해외는 환산값, 호가 추격 반영)
  fx_usdkrw         DECIMAL(18,6) NULL,            -- 해외 환산 환율(fx_rates 1시간 이내만), 국내 NULL
  zone_lo           DECIMAL(36,8) NULL,            -- 구간 진입형(카드) — 현지 통화
  zone_hi           DECIMAL(36,8) NULL,
  quantity          DECIMAL(36,18) NULL,           -- 실제 주문과 같은 사이징(정수 주). 0 = 1주 미만(주문 불성립), NULL = 미확정(시장가 등)
  amount_krw        DECIMAL(18,2) NOT NULL,        -- 의도 금액(시그널 amount_krw, 재계산 안 함)
  fee_rate_pct      DECIMAL(8,5)  NOT NULL,        -- 진입 편도 수수료율 % (해외 0.25 · 국내 0.014)
  fee_est_krw       DECIMAL(18,2) NULL,
  fill_model        VARCHAR(32)   NOT NULL,        -- signal_limit_immediate | signal_market_immediate | zone_touch_pending
  valid_from        DATETIME      NULL,            -- KST (카드)
  valid_until       DATETIME      NULL,            -- KST (시그널 expires_at)
  signal_created_at DATETIME      NOT NULL,        -- KST
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_paper_fills_signal (signal_id),
  KEY idx_pf_strategy (strategy_id, signal_created_at),
  KEY idx_pf_symbol (symbol, signal_created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 되돌리기(데이터 함께 삭제 — 사용자 승인 사항. 코드 revert 와 무관하게 존치해도 무해하다):
-- ALTER TABLE strategies DROP COLUMN IF EXISTS validation_evidence, DROP COLUMN IF EXISTS validation_changed_at, DROP COLUMN IF EXISTS validation_status;
-- DROP TABLE IF EXISTS paper_fills;
