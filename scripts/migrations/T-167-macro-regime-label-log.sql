-- T-167 — 거시 레짐 라벨 장기 보관 표 macro_regime_label_log: strategy-eval 런(runMarket)이 최종 pass run 행에 남기는 거시 레짐 라벨 기록 객체
--   (T-165 MacroRegimeRecord)를 eval_funnel 30일 삭제를 넘어 보관한다. 1행 = 런 1회(국내·미국 모두).
--   사용자 승인 범위: T-165 최종 요약 결정 항목 「라벨 기록 보관 기간」 → (a) 전용 테이블 신설 + 삭제 전 기존 행 이관(사용자 지시 「전용 표로 준비」, 2026-11-12).
--   이 파일은 **가산 전용 새 테이블 1개 CREATE TABLE IF NOT EXISTS 만** 한다. 기존 테이블 ALTER·행 변경·이관은 이 파일 범위가 아니다
--   (이관은 별도 파일 T-167-macro-regime-label-backfill.sql). 이 범위를 벗어나면 적용을 멈추고 다시 묻는다.
--
-- ⚠ 이 파일은 **앱 부팅 때 실행되지 않는다**(src/lib/db.ts 의 setupDB 에 넣지 않았다). 개발·운영이 같은 NAS MariaDB 라서
--   배포만으로 DDL 이 돌면 "DDL 은 사용자 건별 승인" 원칙(T-059·T-112·T-116·T-126 선례)이 무력화되기 때문이다.
--   장외 창에서 사람이 직접 적용한다:
--     mysql -h <DB_HOST> -u <DB_USER> -p <DB_NAME> < scripts/migrations/T-167-macro-regime-label-log.sql
--   적용 직전 확인(운영 조회라 사용자 승인 게이트에 포함):
--     SHOW TABLES LIKE 'macro_regime_label_log';                         -- 빈 결과여야 한다(있으면 SHOW CREATE TABLE 을 아래 정의와 대조 후 중단)
--     SELECT @@GLOBAL.sql_mode;                                          -- strict(STRICT_TRANS_TABLES) 인지 기록(비strict 면 길이·ENUM 위반이 잘려 저장된다)
--   적용 직후 `SHOW CREATE TABLE macro_regime_label_log` 를 task 이력서에 남긴다.
--   CREATE TABLE IF NOT EXISTS 라 두 번 실행해도 안전하다(2차 적용 = Note 1050, 정의 불변 — 일회용 MariaDB 10.11.11 시험).
--
-- 🔴 기록 스위치가 따로 없다(키 없음 = 켜짐): 웹 코드(0.8.0)가 이미 배포돼 있으면 **이 DDL 을 적용하는 즉시 다음 런부터 런마다 1행씩 기록이 시작된다.**
--   적용 전에는 기록 코드가 ER_NO_SUCH_TABLE(errno 1146)을 받아 조용히 건너뛴다(경고는 프로세스 첫 1회 + 이후 24시간에 1회). 엔진 판단·시그널·주문 동작은 그대로다.
--   끄는 법: 환경변수 MACRO_REGIME_LABEL_LOG_ENABLED=false(앞뒤 공백·대소문자 무시, false 만 끔) + `pm2 restart stockinvest --update-env`(사용자 승인 사항).
--   EVAL_FUNNEL_ENABLED 와 독립이다(그것이 꺼져도 이 표는 쓴다). 끈 기간은 eval_funnel 이 30일 남아 있는 동안 이관 파일을 다시 돌려 메울 수 있다(멱등).
--
-- 🔴 이관 마감: 운영 첫 라벨 행 = eval_funnel id 904956(2026-11-12 10:20:40 KST). eval_funnel 은 30일 지난 행을 지우므로(eval-funnel.ts RETENTION_DAYS = 30,
--   프로세스당 6시간 간격 prune) **2026-12-12 10:20 KST 이후 첫 prune 부터 라벨 행이 사라진다.** 이 DDL 과 이관 1차는 그 전에 적용한다(권장 여유: 2026-12-05 이전).
--   표가 생기기 전 구간의 런은 eval_funnel 에 그 런의 run 행이 **실제로 써졌을 때만** 이관으로 되살릴 수 있다(EVAL_FUNNEL_ENABLED=false·flush 실패·
--   8000행 상한으로 run 행이 없으면 원본이 없다 — 되살릴 수 없다). 표가 생긴 뒤의 실시간 기록은 eval_funnel 과 독립이므로(같은 객체를 직접 받는다)
--   이 손실 경로는 DDL 적용 전 구간에만 있다 → DDL 을 먼저·빨리 적용한다.
-- 권장 적용 순서(T-167 Leader G6): ① 이 DDL(장외 창) → ② 이관 1차 → ③ push(웹 0.8.0 배포) → ④ 배포 뒤 첫 장중 런 기록 확인 →
--   ⑤ 이관 2차(멱등 — ①~③ 사이 런을 메운다) → ⑥ 이관 파일의 확인·대조 쿼리(삭제 전 마지막 대조 포함).
--
-- 정본: T-167 task Analyst A1~A7(행 단위·열·유일 키·시각·보관·지표 정의·이관 변환) · Leader L1~L4·G2~G9.
-- 쓰기 주체: src/lib/strategy/macro-regime/label-log.ts — eval_funnel flush 뒤 분리 실행으로 1행 INSERT 1문장(기다리지 않음·상한 4초·상한/오류 시 연결 destroy·
--   절대 던지지 않음, INSERT IGNORE·ON DUPLICATE KEY 없음). 같은 런이 이미 이관돼 있으면 1062 를 무해한 중복으로 보고 경고 없이 건너뛴다.
-- 행 단위: run 1회 = 1행. 중복 제거·일 요약은 필요하면 뷰/쿼리로 만든다(저장 단위를 줄이지 않는다 — 오류율 분모·플립 순서·런별 수집 상태 보존).
-- 유일 키 (run_id, as_of_utc): 실시간 행과 이관 행은 같은 기록 객체(같은 asOfUtc)라 같은 런이면 한 행이 된다. run_id 는 분 단위('<market>-YYYYMMDDHHMM')라
--   단독 UNIQUE 불가(T-126). 알려진 한계(Codex C1 지적 1 — Leader 부분 채택): 같은 시장의 두 런이 **같은 분에 시작해 같은 초에 끝나면**(수동 force 실행이
--   cron 과 겹칠 때 정도) 두 번째 실시간 행이 1062 로 건너뛰어진다 — 이관 파일의 대조 쿼리 ⓑ 가 그 충돌을 숫자로 드러낸다.
--   source_eval_funnel_id 는 이관 행만 아는 값이라 보조 UNIQUE(NULL 복수 허용)로만 둔다.
-- 시각 규칙(T-046·T-059·T-112): DB·앱 풀 모두 KST. 이름이 _utc 인 열은 UTC 벽시계, _kst 인 열은 KST 벽시계(초 단위). as_of_kst = as_of_utc + 9시간(판정 시각 —
--   실시간·이관 같은 의미). eval_funnel.ts(flush 시각)는 이관 행만 source_ts_kst 로 보존한다. inserted_at 은 행이 쓰인 DB 시각(감사용, 지표에 쓰지 않는다).
-- 어휘: ENUM 은 source·market 둘뿐이다. 라벨·사유·수집 상태·방향·규칙 버전은 VARCHAR — 규칙 버전이 바뀌면 값이 늘고, strict 에서 ENUM 밖 값은 INSERT 전체 실패인데
--   기록기는 예외를 삼키므로 행이 조용히 사라진다(= 이 표가 막으려는 증거 소실). CHECK 는 최소(label·rule_version 비어 있지 않음 · record_json JSON 형식).
-- record_json = 기록 객체 전체(앱 JSON.stringify 원문 — 이관은 JSON_COMPACT(JSON_EXTRACT(detail,'$.macroRegime')) 로 같은 바이트). 행만으로 당시 판정을 재현할 수 있다.
-- 보관: **자동 삭제 없음**(이 표의 존재 이유). 어떤 코드에도 이 표를 대상으로 한 DELETE 가 없다(eval_funnel prune 은 표 이름 고정).
--   추정: 하루 약 120행(국내 ≈ 60 런 + 미국 정규장 ≈ 60 런), 연 약 3만 행, 행당 ≈ 1.1~1.3 KB → 연 ≈ 35~40 MB.
-- 외래키 없음: 쓰기 경합·잠금 전파 방지. source_eval_funnel_id 는 eval_funnel.id 를 외래키 없이 가리킨다(원본은 30일 뒤 사라진다).
-- 되돌리기: 아래 주석의 DROP 줄(쌓인 기록 함께 삭제 — 되살릴 수 없다, 사용자 승인 사항). 기록만 멈추려면 위 환경변수가 먼저다.
-- (T-112 구현 규칙 F9 · T-126 선례) 잠금을 5초 넘게 기다리지 않는다 — 새 테이블 CREATE 1개라 위험은 낮지만 같은 규칙을 둔다.

SET SESSION lock_wait_timeout = 5;

CREATE TABLE IF NOT EXISTS macro_regime_label_log (
  id                            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source                        ENUM('live','backfill') NOT NULL,               -- live = 엔진 실시간 기록, backfill = eval_funnel 이관
  source_eval_funnel_id         BIGINT UNSIGNED NULL,                           -- 이관 행만: 원본 eval_funnel.id. 실시간 NULL
  source_ts_kst                 DATETIME NULL,                                  -- 이관 행만: 원본 eval_funnel.ts(flush 시각, KST). 실시간 NULL
  run_id                        VARCHAR(40) NOT NULL,                           -- = eval_funnel.run_id('<market>-YYYYMMDDHHMM', 분 단위)
  market                        ENUM('domestic','overseas') NOT NULL,
  as_of_utc                     DATETIME NOT NULL,                              -- 기록 객체 asOfUtc(판정 시각, 초) 의 UTC 벽시계
  as_of_kst                     DATETIME NOT NULL,                              -- as_of_utc + 9시간(판정 시각 KST — 실시간·이관 같은 의미)
  as_of_et_date                 DATE NULL,                                      -- 기록 객체 asOfEtDate(미 동부 달력일). 빈 값 = NULL
  inserted_at                   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,    -- 행이 쓰인 DB 시각(KST) — 감사용, 지표에 쓰지 않는다
  rule_version                  VARCHAR(32) NOT NULL,                           -- 예: macro-regime-c0@1 (지표는 이 값 하나로 좁혀 센다)
  label                         VARCHAR(24) NOT NULL,                           -- hot_tightening·hot_hold·hot_easing·normal_tightening·normal_hold·normal_easing·unknown
  is_type5                      TINYINT(1) NOT NULL,                            -- label = hot_tightening
  reason_codes                  VARCHAR(200) NOT NULL DEFAULT '',               -- unknown 사유 쉼표 결합(기록 순서 유지), 없으면 ''
  reason_first                  VARCHAR(32) NULL,                               -- 첫 사유(없으면 NULL)
  reason_count                  TINYINT UNSIGNED NOT NULL DEFAULT 0,            -- 사유 개수
  cpi_fetch_status              VARCHAR(24) NOT NULL,                           -- 가장 최근 BLS 수집 시도의 결과(ok·http_error·…·not_attempted·disabled)
  cpi_reference_month           CHAR(7) NULL,                                   -- 라벨에 쓴 CPI 기준월 'YYYY-MM'
  cpi_expected_reference_month  CHAR(7) NULL,                                   -- 일정표상 발표가 지난 최신 기준월
  cpi_lags_schedule             TINYINT(1) NOT NULL,                            -- 사용 기준월이 예정 기준월보다 이르다(또는 없다)
  cpi_release_at_utc            DATETIME NULL,                                  -- 사용 기준월의 발표 시각(UTC 벽시계)
  cpi_index                     DECIMAL(12,4) NULL,
  cpi_base_month                CHAR(7) NULL,
  cpi_base_index                DECIMAL(12,4) NULL,
  cpi_yoy_pct_raw               DECIMAL(10,4) NULL,
  cpi_yoy_pct                   DECIMAL(6,1) NULL,                              -- 임계 비교값(소수 1자리)
  cpi_hot                       TINYINT(1) NULL,
  cpi_month_gap                 SMALLINT NULL,
  cpi_fetched_at_utc            DATETIME NULL,                                  -- 마지막 성공 수집 시각(UTC 벽시계)
  cpi_cache_age_sec             INT NULL,                                       -- 판정 시각 − 마지막 성공 수집(초, 부호 있음)
  rate_upper_pct                DECIMAL(6,2) NULL,                              -- 판정일(ET) 정책금리 목표 범위 상단
  rate_upper_effective_from     DATE NULL,
  rate_compare_date             DATE NULL,                                      -- 판정일(ET) − 6 달력월
  rate_upper_6m_ago_pct         DECIMAL(6,2) NULL,
  rate_delta_pct                DECIMAL(6,2) NULL,
  rate_direction                VARCHAR(12) NULL,                               -- tightening·hold·easing
  rate_table_verified_through   DATE NULL,                                      -- 금리 정적 표 확인일(빈 값 방어로 NULL 허용)
  rate_next_known_decision_date DATE NULL,
  engine_release                VARCHAR(48) NULL,                               -- 실시간만: 릴리스 디렉터리 이름(process.cwd() 의 releases/<이름>) — T-112·T-126 과 같은 정의. 이관 NULL
  record_json                   LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(record_json)),   -- 기록 객체 전체(공백 없는 JSON)
  UNIQUE KEY uq_mrl_run_asof (run_id, as_of_utc),                               -- 같은 런 = 한 행(실시간·이관 공통 키)
  UNIQUE KEY uq_mrl_source_ef (source_eval_funnel_id),                          -- 이관 행 보조 키(NULL 복수 허용)
  KEY idx_mrl_asof (as_of_utc),
  KEY idx_mrl_et_label (as_of_et_date, label),
  KEY idx_mrl_market_asof (market, as_of_utc),
  CONSTRAINT chk_mrl_label CHECK (CHAR_LENGTH(label) > 0),
  CONSTRAINT chk_mrl_rule_version CHECK (CHAR_LENGTH(rule_version) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 되돌리기(쌓인 라벨 장기 보관 기록 함께 삭제 — 사용자 승인 사항, 되살릴 수 없음):
-- DROP TABLE IF EXISTS macro_regime_label_log;
