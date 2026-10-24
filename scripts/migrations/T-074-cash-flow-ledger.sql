-- T-074 — 자금 이동(입금·출금·환전) 원장 (가산 전용: 새 테이블 1개. 기존 테이블·행 변경 없음)
--
-- cash_flow_ledger — 사용자가 앱에서 직접 적는 입출금·환전 기록. "입출금 뺀 투자 손익"(src/lib/ledger/compute.ts)의 순입금 원천.
--   - 금액은 항상 양수, 방향은 kind. 환전은 양쪽 금액(currency/amount = 낸 쪽, counter_* = 받은 쪽)을 저장하고 환율은 유도한다.
--   - 추가 전용: 금액·종류·통화·시각·메모는 고치지 않는다. 정정 = 새 행(supersedes_id) + 원래 행 소프트 삭제, 취소 = 소프트 삭제(복구 가능).
--     앱이 UPDATE 하는 열은 deleted_at·deleted_by_user_id·delete_reason(취소·복구)과 anchor_*·fx_rate_used·fx_source·krw_equiv(스냅샷 매칭 파생값)뿐이다.
--   - 손익 기준(opening)과 '입출금 아님' 표시는 DDL 없이 system_config 키 2개(cash_ledger_baseline·cash_ledger_candidate_marks)에 둔다.
--
-- Analyst Q2 초안 대비 바꾼 것 (근거는 일회용 MariaDB 시험 `src/lib/ledger/__tests__/t074-disposable-mariadb.test.ts`):
--   1) chk_cfl_exch — 초안은 `counter_currency IN (...) AND ... OR (...)` 라 환전인데 counter_* 가 NULL 이면 식 전체가 NULL(UNKNOWN)이 되어
--      CHECK 를 **통과**했다(SQL 의 CHECK 는 FALSE 만 거부). IS NOT NULL 을 명시해 FALSE 로 만든다.
--   2) chk_cfl_krw_int·chk_cfl_minute 추가 — 원화는 1원 단위(소수 금지, 앱 검증과 같은 규칙), 발생 시각은 분 단위(중복 키가 '분' 기준이다).
--   3) uq_cfl_supersedes 추가 — 한 기록은 한 번만 정정된다(동시 정정 두 건이 둘 다 들어가는 것을 DB 가 막는다). fk_cfl_super 의 인덱스를 겸한다.
--   4) client_entry_id CHAR(36) → VARCHAR(36) — 폼 키는 8~36자(UUID 권장)라 고정폭이 필요 없다.
--   5) COLLATE=utf8mb4_general_ci 명시 — 운영 서버 기본은 utf8mb3_general_ci(실측 10-23)이고 운영 테이블은 전부 utf8mb4_general_ci 다(T-072 선례).
--   그대로 둔 것: live 생성열 UNIQUE(살아 있는 행 = 1, 삭제 행 = NULL → NULL 끼리는 충돌하지 않는다), fk_cfl_super 자기 참조(CREATE 한 번에 만들어진다),
--   created_by_user_id·deleted_by_user_id INT UNSIGNED = users.id int(10) unsigned(운영 SHOW CREATE TABLE 실측) — FK 는 두지 않는다(감사 열, 회원 정리와 무관하게 남긴다),
--   account_id INT = accounts.id int(11), anchor_snapshot_id BIGINT = portfolio_snapshots.id bigint(20) — 스냅샷은 정리된 적이 있는 로그라 FK 를 두지 않는다.
--
-- ⚠ 이 파일은 **앱 부팅 때 실행되지 않는다**(src/lib/db.ts 의 setupDB 에 넣지 않았다 — T-059·T-070·T-072 선례). 개발·운영이 같은 NAS MariaDB 라서
--   배포만으로 DDL 이 돌면 "--with-migrate 는 사용자 승인" 원칙이 무력화되기 때문이다. QA 통과 뒤 **사용자 명시 승인** 후 오프아워에 적용한다:
--     mysql -h <DB_HOST> -u <DB_USER> -p <DB_NAME> < scripts/migrations/T-074-cash-flow-ledger.sql
--   `CREATE TABLE IF NOT EXISTS` 라 두 번 실행해도 안전하다(멱등). MariaDB 10.2+ 의 CHECK·PERSISTENT 생성열을 쓴다(운영 10.11.11).
--
-- 호환(양방향 무해):
--   - 구 코드 + 새 테이블: 읽는 코드 없음.
--   - 새 코드 + 테이블 없음: /api/cash-ledger/* 가 503 `not_migrated` 로 답한다(화면은 오류 상태). 다른 화면·주문·시그널 경로는 이 테이블을 모른다.
--   → 순서는 자유지만, 화면을 바로 쓰려면 DDL 을 코드 배포보다 먼저 적용한다.
--
-- 적용 후 확인:
--   SHOW CREATE TABLE cash_flow_ledger;     -- uq_cfl_client_entry·uq_cfl_live_dup·uq_cfl_supersedes, CHECK 5개, FK 2개
--   SELECT COUNT(*) FROM cash_flow_ledger;  -- 0

SET SESSION lock_wait_timeout = 5;

CREATE TABLE IF NOT EXISTS cash_flow_ledger (
  id                 BIGINT        NOT NULL AUTO_INCREMENT,
  account_id         INT           NOT NULL DEFAULT 1,           -- accounts(id). orders 와 같은 범위(현재 1행)
  client_entry_id    VARCHAR(36)   NOT NULL,                     -- 폼이 만든 키 — 이중 제출 멱등키
  kind               ENUM('deposit','withdrawal','exchange') NOT NULL,
  occurred_at        DATETIME      NOT NULL,                     -- KST 벽시계(portfolio_snapshots.ts 와 같은 규약), 분 단위
  currency           CHAR(3)       NOT NULL,                     -- 입출금: 통화 / 환전: 낸 통화
  amount             DECIMAL(18,2) NOT NULL,                     -- 항상 양수. 방향은 kind
  counter_currency   CHAR(3)       NULL,                         -- 환전 전용: 받은 통화
  counter_amount     DECIMAL(18,2) NULL,                         -- 환전 전용: 받은 금액(양수). 환율 = 원화 ÷ 달러 로 유도(저장 안 함)
  fx_rate_used       DECIMAL(12,4) NULL,                         -- USD 입출금 원화 환산 환율(반영 스냅샷 USD 행 price) / 환전은 비용 추정용 반영 스냅샷 환율
  fx_source          ENUM('snapshot','user') NULL,
  krw_equiv          DECIMAL(18,2) NULL,                         -- 순입금용 원화 환산(원). KRW 흐름 = amount, USD 흐름 = amount × fx_rate_used, 환전 = NULL
  anchor_snapshot_id BIGINT        NULL,                         -- 처음 반영된 portfolio_snapshots.id (FK 없음 — 스냅샷은 정리된 적 있는 로그 테이블)
  anchor_snapshot_ts DATETIME      NULL,
  anchor_status      ENUM('pending','matched','unmatched') NOT NULL DEFAULT 'pending',
  anchor_detail      VARCHAR(200)  NULL,                         -- 매칭 근거 또는 불일치 사유
  memo               VARCHAR(200)  NULL,
  source             ENUM('user','import') NOT NULL DEFAULT 'user',   -- import = 향후 KIS 입출금 조회(D18 ②) 자리
  supersedes_id      BIGINT        NULL,                         -- 정정: 이 행이 대체한 행(그 행은 deleted_at 이 찍힌다)
  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id INT UNSIGNED  NULL,                         -- users(id) — 감사용
  deleted_at         DATETIME      NULL,                         -- 소프트 삭제(복구 = NULL 로 되돌림)
  deleted_by_user_id INT UNSIGNED  NULL,
  delete_reason      VARCHAR(200)  NULL,
  live               TINYINT AS (IF(deleted_at IS NULL, 1, NULL)) PERSISTENT,   -- 살아 있는 행만 중복 검사(NULL 끼리는 충돌 안 함)
  PRIMARY KEY (id),
  UNIQUE KEY uq_cfl_client_entry (client_entry_id),
  UNIQUE KEY uq_cfl_live_dup (account_id, kind, currency, amount, occurred_at, live),
  UNIQUE KEY uq_cfl_supersedes (supersedes_id),
  KEY idx_cfl_account_time (account_id, deleted_at, occurred_at),
  KEY idx_cfl_anchor (anchor_snapshot_id),
  CONSTRAINT fk_cfl_account FOREIGN KEY (account_id) REFERENCES accounts (id),
  CONSTRAINT fk_cfl_super FOREIGN KEY (supersedes_id) REFERENCES cash_flow_ledger (id),
  CONSTRAINT chk_cfl_amount CHECK (amount > 0),
  CONSTRAINT chk_cfl_ccy CHECK (currency IN ('KRW','USD')),
  CONSTRAINT chk_cfl_krw_int CHECK (currency <> 'KRW' OR amount = TRUNCATE(amount, 0)),
  CONSTRAINT chk_cfl_minute CHECK (SECOND(occurred_at) = 0),
  CONSTRAINT chk_cfl_exch CHECK (
       (kind = 'exchange' AND counter_currency IS NOT NULL AND counter_amount IS NOT NULL
         AND counter_currency IN ('KRW','USD') AND counter_currency <> currency AND counter_amount > 0
         AND (counter_currency <> 'KRW' OR counter_amount = TRUNCATE(counter_amount, 0)))
    OR (kind <> 'exchange' AND counter_currency IS NULL AND counter_amount IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 되돌리기(데이터 함께 삭제 — 사용자 승인 사항. 코드 revert 와 무관하게 존치해도 무해하다):
-- DROP TABLE IF EXISTS cash_flow_ledger;
-- DELETE FROM system_config WHERE `key` IN ('cash_ledger_baseline', 'cash_ledger_candidate_marks');
