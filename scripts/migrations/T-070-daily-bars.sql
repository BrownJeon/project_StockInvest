-- T-070 Phase 0 — 일봉 저장소 최소판 `daily_bars` 1개 (가산 전용: 기존 테이블 변경 없음)
--
-- 승인 범위(사용자 결정 2026-10-22 D2·D15): 이 테이블 **한 개**. T-064 §5.2 의 `universe_snapshots`·`bar_fetch_state` 는 Phase 1 이다
--   (백필 재개는 종목별 MIN/MAX(trade_date) 와 flags 의 'adj_stale' 로 한다 — src/lib/profit-engine/daily-bars-collector.ts).
--
-- ⚠ 이 파일은 **앱 부팅 때 실행되지 않는다**(src/lib/db.ts 의 setupDB 에 넣지 않았다 — T-059 선례). 개발·운영이 같은 NAS MariaDB 라서
--   배포만으로 DDL 이 돌면 "--with-migrate 는 사용자 승인" 원칙이 무력화되기 때문이다. Reviewer·QA 통과 뒤 Leader 가 오프아워에 직접 적용한다:
--     mysql -h <DB_HOST> -u <DB_USER> -p <DB_NAME> < scripts/migrations/T-070-daily-bars.sql
--   CREATE TABLE IF NOT EXISTS 라 두 번 실행해도 안전하다. 적용 전에는 POST /api/cron/daily-bars 가 `skipped:'tables_missing'`(KIS 호출 0)로 끝난다.
--   되돌리기: 맨 아래 주석의 DROP 1줄(데이터 함께 삭제).
--
-- 값 규칙:
--   - 가격은 **거래소 현지 통화 원값**(미국 USD, 국내 KRW). KRW 환산 금지 — `currency` 가 행마다 명시한다(한 종목 안에서 통화 혼합 금지).
--   - `adj_mode` = 'adjusted'(KIS 수정주가: 해외 MODP=1, 국내 FID_ORG_ADJ_PRC=0) | 'raw'.
--   - `is_final` = 0 은 장중(미확정) 봉. 확정 판정: 미국 ET 16:30 이후·국내 KST 15:40 이후 또는 지난 날짜. 신호·사후검증은 1 만 쓴다.
--   - `flags` = 쉼표 목록. 'corp_action_suspect'(전일 대비 종가 비율 [0.70,1.43] 밖 — **제외가 아니라 표시**), 'zero_volume',
--     'adj_stale'(중첩 재조회에서 과거 종가가 바뀜 → 이 종목 전체 재수집 대기), 'dup_conflict'(같은 날짜가 서로 다른 값으로 두 번 옴).
--   - `trade_date` 는 거래소 현지 거래일(KR=KST, US=ET). `fetched_at` 은 KST 벽시계(T-046 규칙).

CREATE TABLE IF NOT EXISTS daily_bars (
  market      VARCHAR(8)    NOT NULL,            -- 'KR' | 'US'
  symbol      VARCHAR(32)   NOT NULL,            -- 앱 심볼 ('005930', 'NAS:MU')
  trade_date  DATE          NOT NULL,            -- 거래소 현지 거래일(KR=KST, US=ET)
  open        DECIMAL(18,4) NULL,
  high        DECIMAL(18,4) NULL,
  low         DECIMAL(18,4) NULL,
  close       DECIMAL(18,4) NOT NULL,
  volume      BIGINT        NOT NULL,
  turnover    DECIMAL(24,2) NULL,                -- 거래대금(제공될 때, 현지 통화)
  currency    CHAR(3)       NOT NULL,            -- 'KRW' | 'USD' — 통화 혼합 방지
  adj_mode    VARCHAR(12)   NOT NULL,            -- 'adjusted' | 'raw' (KIS 수정주가 여부 기록)
  is_final    TINYINT(1)    NOT NULL DEFAULT 1,  -- 장중 봉은 0, 확정 후 갱신
  flags       VARCHAR(64)   NULL,                -- 품질 게이트 결과(위 값 규칙)
  source      VARCHAR(32)   NOT NULL,            -- 'kis_dailyprice'(해외 HHDFS76240000) | 'kis_itemchartprice'(국내 FHKST03010100)
  fetched_at  DATETIME      NOT NULL,            -- KST 벽시계
  PRIMARY KEY (market, symbol, trade_date),
  KEY idx_date (trade_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 되돌리기(데이터 함께 삭제 — 사용자 승인 사항):
-- DROP TABLE IF EXISTS daily_bars;
