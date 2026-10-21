-- T-059 Part A — 미국 종목 데이터 수집기 P1 테이블 5개 (가산 전용: 기존 테이블 변경 없음)
--
-- ⚠ 이 파일은 **앱 부팅 때 실행되지 않는다**(src/lib/db.ts 의 setupDB 에 넣지 않았다). 개발·운영이 같은 NAS MariaDB 라서
--   배포만으로 DDL 이 돌면 "--with-migrate 는 사용자 승인" 원칙이 무력화되기 때문이다.
--   deploy.yml 에는 migrate 단계가 없어서 `scripts/deploy.sh --with-migrate` 는 거부된다(의도된 상태) — 사용자 승인 후 사람이 직접 적용한다:
--     mysql -h <DB_HOST> -u <DB_USER> -p <DB_NAME> < scripts/migrations/T-059-us-data-collector.sql
--   전부 CREATE TABLE IF NOT EXISTS 라 두 번 실행해도 안전하다. 되돌리기: 맨 아래 주석의 DROP 5줄(데이터 함께 삭제).
--   적용 전에는 cron 두 개가 `skipped:'tables_missing'` 로 끝나고, /api/fundamentals 해외 심볼은 기존 LLM 경로 그대로다.
--
-- 시각 규칙(T-046 재발 방지): DB·앱 풀 모두 KST. *_at DATETIME 은 KST 벽시계(NOW() 또는 toKstDatetime 문자열).
--   SEC 의 날짜(filed·report_date·period_*)와 event/window_*_et 는 **DATE**(미국 동부 현지 날짜, 시각 없음) — 시각을 지어내지 않는다.

CREATE TABLE IF NOT EXISTS symbol_cik_map (
  symbol                 VARCHAR(32)  NOT NULL PRIMARY KEY,          -- 앱 심볼 'NAS:INTC'
  cik                    BIGINT UNSIGNED NOT NULL,
  sec_ticker             VARCHAR(16)  NOT NULL,                       -- SEC 표기 'BRK-B'
  entity_title           VARCHAR(200) NULL,
  source                 VARCHAR(32)  NOT NULL DEFAULT 'sec_company_tickers',
  verified_at            DATETIME     NOT NULL,                       -- 마지막으로 company_tickers 에서 확인한 시각(KST)
  -- 증분 동기화 상태(같은 CIK 를 공유하는 심볼 — GOOG/GOOGL — 은 같은 값을 갖는다)
  submissions_sha256     CHAR(64)     NULL,
  submissions_synced_at  DATETIME     NULL,
  facts_sha256           CHAR(64)     NULL,
  facts_filed_watermark  DATE         NULL,                           -- 이 날짜까지 접수된 정기보고서는 companyfacts 에 반영됨
  facts_synced_at        DATETIME     NULL,
  last_attempt_at        DATETIME     NULL,
  last_error             VARCHAR(255) NULL,
  INDEX idx_cik (cik),
  INDEX idx_last_attempt (last_attempt_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS us_filings (
  accession          VARCHAR(20)  NOT NULL PRIMARY KEY,               -- '0000050863-26-000155'
  cik                BIGINT UNSIGNED NOT NULL,
  form               VARCHAR(16)  NOT NULL,
  items              VARCHAR(128) NOT NULL DEFAULT '',
  report_date        DATE         NULL,
  filed              DATE         NOT NULL,                           -- SEC filingDate(동부 접수일)
  accepted_at        DATETIME     NULL,                               -- SEC acceptanceDateTime(UTC) → KST 변환
  primary_doc_url    VARCHAR(512) NULL,
  is_earnings_release TINYINT(1)  NOT NULL DEFAULT 0,                 -- 원본 8-K + items 2.02
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_cik_filed (cik, filed),
  INDEX idx_earnings (cik, is_earnings_release, filed)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS us_financial_facts (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  cik           BIGINT UNSIGNED NOT NULL,
  taxonomy      VARCHAR(16)  NOT NULL,                                -- us-gaap / dei / ifrs-full
  tag           VARCHAR(160) NOT NULL,
  unit          VARCHAR(32)  NOT NULL,
  frame         VARCHAR(12)  NOT NULL,                                -- CY2026Q2 / CY2025 / CY2026Q2I (frame 없는 YTD 행은 적재 안 함)
  period_start  DATE         NULL,                                    -- 시점(…I) 값은 NULL
  period_end    DATE         NOT NULL,
  val           DECIMAL(30,6) NOT NULL,
  fy            SMALLINT     NULL,
  fp            VARCHAR(4)   NULL,
  form          VARCHAR(16)  NOT NULL,
  filed         DATE         NOT NULL,
  accn          VARCHAR(20)  NOT NULL,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fact (cik, taxonomy, tag, unit, frame),
  INDEX idx_cik_end (cik, period_end)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS us_earnings_events (
  id               BIGINT PRIMARY KEY AUTO_INCREMENT,
  symbol           VARCHAR(32)  NOT NULL,
  cik              BIGINT UNSIGNED NULL,
  fiscal_period    VARCHAR(32)  NOT NULL,                             -- estimated: 'after-YYYY-MM-DD'(직전 발표일 다음 발표) / confirmed·manual: 사람이 적는 값
  event_date_et    DATE         NULL,                                 -- confirmed·manual 만. estimated 는 반드시 NULL(아래 CHECK)
  window_start_et  DATE         NULL,
  window_end_et    DATE         NULL,
  event_time_class ENUM('BMO','AMC','unknown') NOT NULL DEFAULT 'unknown',
  status           ENUM('confirmed','estimated','manual') NOT NULL,
  source_kind      VARCHAR(32)  NOT NULL,                             -- 'edgar_8k_202_pattern' / 'ir_press_release' / 'user' …
  source_url       VARCHAR(512) NULL,
  basis            JSON         NULL,                                 -- 추정 근거(방법·기준 발표일)
  observed_at      DATETIME     NOT NULL,
  superseded_by    BIGINT       NULL,
  UNIQUE KEY uq_event (symbol, fiscal_period, status),
  INDEX idx_symbol_active (symbol, superseded_by),
  CONSTRAINT chk_estimated_is_window CHECK (
    status <> 'estimated'
    OR (event_date_et IS NULL AND window_start_et IS NOT NULL AND window_end_et IS NOT NULL AND window_start_et <= window_end_et)
  ),
  CONSTRAINT chk_dated_status CHECK (status = 'estimated' OR event_date_et IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS us_fundamentals_snapshot (
  id             BIGINT PRIMARY KEY AUTO_INCREMENT,
  symbol         VARCHAR(32)  NOT NULL,
  snapshot_date  DATE         NOT NULL,                               -- KST 날짜(하루 1행, 재실행 시 덮어씀)
  per            DECIMAL(20,6) NULL,                                  -- KIS perx 원값 = 현재가 ÷ epsx (2026-10-21 INTC 실응답으로 확인). 회계 기준은 EDGAR GAAP 과 다르다(epsx 2.12 vs GAAP 음수)
  pbr            DECIMAL(20,6) NULL,                                  -- pbrx
  eps            DECIMAL(20,6) NULL,                                  -- epsx
  bps            DECIMAL(20,6) NULL,                                  -- bpsx
  market_cap     DECIMAL(28,4) NULL,                                  -- tomv 원값 = 달러(USD) 단위 시가총액 (2026-10-21 INTC 실응답: shar × last = tomv 일치). 화면의 '억원' 필드에 넣지 않는다
  shares         DECIMAL(24,2) NULL,                                  -- shar 상장주수
  h52            DECIMAL(20,6) NULL,                                  -- h52p
  l52            DECIMAL(20,6) NULL,                                  -- l52p
  h52_date       DATE         NULL,
  l52_date       DATE         NULL,
  last_price     DECIMAL(20,6) NULL,                                  -- last(현지 통화)
  currency       VARCHAR(8)   NULL,                                   -- curr
  sector         VARCHAR(64)  NULL,                                   -- e_icod
  etp_type       VARCHAR(64)  NULL,                                   -- etyp_nm(ETF 등)
  raw_output     JSON         NULL,                                   -- KIS output 원문(감사·단위 확인용, 시세 정보만)
  source         VARCHAR(32)  NOT NULL DEFAULT 'kis_price_detail',
  observed_at    DATETIME     NOT NULL,
  UNIQUE KEY uq_symbol_day (symbol, snapshot_date),
  INDEX idx_symbol_observed (symbol, observed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 되돌리기(데이터 함께 삭제 — 사용자 승인 사항):
-- DROP TABLE IF EXISTS us_fundamentals_snapshot;
-- DROP TABLE IF EXISTS us_earnings_events;
-- DROP TABLE IF EXISTS us_financial_facts;
-- DROP TABLE IF EXISTS us_filings;
-- DROP TABLE IF EXISTS symbol_cik_map;
