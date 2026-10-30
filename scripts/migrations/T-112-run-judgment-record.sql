-- T-112 — 실행·판단 기록 기반: 크론 잡 실행·상태 기록 job_run_log + 장마감 분석 기준 판단 기록 judgment_run·judgment_candidate
--   (테이블 3개, 가산 전용: 기존 테이블·행 변경 없음. 사용자 결정 U3 — DDL 파일 1개·승인 1회)
--
-- ⚠ 이 파일은 **앱 부팅 때 실행되지 않는다**(src/lib/db.ts 의 setupDB 에 넣지 않았다). 개발·운영이 같은 NAS MariaDB 라서
--   배포만으로 DDL 이 돌면 "DDL 은 사용자 건별 승인" 원칙(공동 인계서 J2, T-059·T-116 선례)이 무력화되기 때문이다.
--   사용자 승인 후 사람이 직접 적용한다(T-116 과 같은 절차):
--     mysql -h <DB_HOST> -u <DB_USER> -p <DB_NAME> < scripts/migrations/T-112-run-judgment-record.sql
--   적용 직전 확인(운영 조회라 사용자 승인 게이트에 포함 — T-112 구현 규칙 F8):
--     SHOW TABLES LIKE 'job_run_log';  SHOW TABLES LIKE 'judgment%';    -- 빈 결과여야 한다(있으면 SHOW CREATE TABLE 을 아래 정의와 대조 후 중단)
--     SELECT @@GLOBAL.sql_mode;                                          -- strict(STRICT_TRANS_TABLES) 인지 기록(비strict 면 ENUM·길이 위반이 잘려 저장된다)
--   적용 직후 `SHOW CREATE TABLE` 3개(job_run_log·judgment_run·judgment_candidate)를 task 이력서에 남긴다.
--   CREATE TABLE IF NOT EXISTS 라 두 번 실행해도 안전하다(2차 적용 = Note 1050 ×3, 정의 불변 — 일회용 MariaDB 10.11 시험).
--   적용 전에는 기록 코드가 ER_NO_SUCH_TABLE(errno 1146)을 받아 조용히 건너뛴다. 크론·분석·카드·주문 동작은 그대로다.
--   기록 스위치 system_config.job_run_log_enabled · judgment_record_enabled 는 **키 없음 = 꺼짐**이다 — 이 DDL 을 적용해도 스위치를
--   켜기 전에는 아무것도 쓰지 않는다. 켜기는 DDL 적용 뒤 별도 승인(DDL → 배포 → 스위치 순, T-116 선례).
--
-- 정본: docs/design/2026-10-30-t112-record-ddl-draft.md §2.1(job_run_log)·§3.2(judgment_run·judgment_candidate) 의 DDL 블록 —
--   아래 CREATE 문 3개와 그 안의 열 주석·되돌리기 주석은 **문서 블록과 한 글자도 다르지 않다.** 다른 것은 이 머리 주석(문서 블록 첫머리의
--   "초안·이 문서 단계" 주석을 이 파일에 맞게 다시 쓴 것)과 아래 SET SESSION 한 줄뿐이다.
--   2차 설계서(docs/design/2026-10-28-corporate-intelligence-second-design.md) §9.5 대비 변경 4건(D-a recorder 2값 · D-b attempt ·
--   D-c started_at NULL(missing 만) · D-d run_id UNSIGNED)은 DDL 초안 §0 — 사용자 확정 U1(2026-10-30 12:22 "권고안 일괄 확정").
--   judgment_run.engine_release 는 G-J1 #7 채택분(같은 확정).
-- DDL 은 일회용 MariaDB 10.11.19 에서 두 sql_mode(서버 기본 strict / NO_BACKSLASH_ESCAPES 추가) 90/90 통과했다(초안 §10). DDL 은 고치지 않았고
--   시험에서 나온 규칙은 앱 코드가 지킨다(T-112 「구현 규칙」 F1~F10):
--   F1 재시도·재전송 ODKU 는 b′ 식(IFNULL 비교·ended_at 대입 맨 마지막 — src/lib/strategy/records/job-run-log.ts) · F3 모든 문자열 열을
--   코드포인트 단위로 미리 자른다 · F5 종목 정규화·중복 제거 · F6 CHECK 위반 판별은 errno 4025 · F7 JSON 크기 CHECK 는 글자 수(2048자·
--   4096자·1024자)다 · F4 인덱스 열 순서는 바꾸지 않는다(느려지면 가산 ALTER).
-- 시각 규칙(T-046·T-059): DB·앱 풀 모두 KST. *_at DATETIME = KST 벽시계(앱이 toKstDatetime 문자열로 바인딩). *_et DATE = America/New_York 날짜.
--   session_d0 DATE = 거래소 현지 거래일(KR=KST, US=ET) — daily_bars.trade_date 와 같은 규약.
-- 외래키 없음: 쓰기 경합·잠금 전파 방지(설계서 §5). ci_raw_item.run_id 가 job_run_log.run_id 를, judgment_candidate.judgment_run_id 가
--   judgment_run 을 외래키 없이 가리킨다.
-- 쓰기 주체: job_run_log = POST /api/cron/job-run-log(크론 러너 스풀 일괄 전송) · judgment_* = 장마감 분석 엔진의 판단 기록기(분석이 끝난 뒤
--   한 번, 절대 던지지 않고 상한 안에서, 해외 카드 트랜잭션 연결은 쓰지 않는다). 읽기: 홈·분석 지표(baseline 만)·사후 성과·T-104 표시용 사본
--   (T-104 실행 판정은 이 테이블을 읽지 않는다 — E8). shadow 기록은 시그널·승인·주문 경로로 전달 금지(설계서 §6.8).
-- 되돌리기: **먼저 두 기록 스위치를 끄는 것이 롤백이다**(즉시, 데이터 보존). 테이블 삭제는 각 CREATE 아래 주석의 DROP 줄
--   (쌓인 기록 함께 삭제 — 되살릴 수 없다, 사용자 승인 사항).
-- (T-112 구현 규칙 F9 · T-072·T-074·T-081·T-084·T-088 선례) 잠금을 5초 넘게 기다리지 않는다 — 새 테이블 CREATE 3개라 위험은 낮지만 같은 규칙을 둔다.

SET SESSION lock_wait_timeout = 5;

CREATE TABLE IF NOT EXISTS job_run_log (
  run_id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_id            VARCHAR(64)  NOT NULL,             -- 러너 라벨 그대로(T-104 §7-1: 라벨 불변). 예: news-peek-overseas-23
  run_kind          VARCHAR(24)  NOT NULL,             -- ingest·peek·drain·reconcile·analysis·other (앱이 허용 목록 검사)
  market            ENUM('domestic','overseas','common') NOT NULL,
  target            VARCHAR(64)  NULL,                 -- 원천: rss·sec·kis·llm·m4 (없으면 NULL)
  scheduled_slot_at DATETIME     NULL,                 -- 예정 슬롯(KST). NULL = 슬롯 밖 임의 실행. 롤업 행은 그 시각의 정시
  started_at        DATETIME     NULL,                 -- 실제 시작(KST). 재시도는 첫 시도 시각 유지. NULL 은 missing 행만
  ended_at          DATETIME     NULL,                 -- 실제 종료(KST). 재시도는 마지막 시도 종료
  status            ENUM('ok','partial','failed','skipped','missing','degraded') NOT NULL,   -- 공동 인계서 §5 어휘 그대로
  attempt           TINYINT UNSIGNED NOT NULL DEFAULT 1,  -- (D-b) 같은 슬롯 시도 횟수. missing 은 0
  http_code         SMALLINT UNSIGNED NULL,            -- 러너가 본 응답 코드. 000(연결 끊김·curl 상한) → 0
  counts_json       JSON NULL,                         -- {fetched,new,processed,candidates} 또는 롤업 {runs,failed,maxMs} — 있는 키만, 2KB 이하
  error_code        VARCHAR(64)  NULL,                 -- 짧은 분류어. 예: HTTP=000/curl=28, HTTP=503:in_progress, ai_fail
  degraded_reason   VARCHAR(128) NULL,                 -- 짧은 분류어. 예: news=0, skip:weekend (skipped 사유도 여기 — 초안 문서 §4.3 E7)
  session_date_kst  DATE NOT NULL,                     -- 슬롯(없으면 시작) 시각의 KST 날짜
  session_date_et   DATE NULL,                         -- 미국 잡만: 같은 시각의 America/New_York 날짜
  recorder          ENUM('runner_hook','route','runner_rollup','reconciler') NOT NULL,   -- (D-a)
  UNIQUE KEY uq_job_slot_recorder (job_id, scheduled_slot_at, recorder),   -- §9.5 중복 기록 방지 키(재시도·재전송이 한 줄 갱신)
  KEY idx_job_started (job_id, started_at),            -- 잡별 "마지막 실행"
  KEY idx_session_market (session_date_kst, market),   -- 날짜·시장별 가동률, 보존 정리
  CONSTRAINT chk_jrl_started CHECK (status = 'missing' OR started_at IS NOT NULL),
  CONSTRAINT chk_jrl_missing CHECK (status <> 'missing'
                                    OR (scheduled_slot_at IS NOT NULL AND started_at IS NULL AND recorder = 'reconciler')),
  CONSTRAINT chk_jrl_counts  CHECK (counts_json IS NULL OR CHAR_LENGTH(counts_json) <= 2048),
  CONSTRAINT chk_jrl_http    CHECK (http_code IS NULL OR http_code <= 999)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 되돌리기(쌓인 기록 함께 삭제 — 사용자 승인 사항, 되살릴 수 없음):
-- DROP TABLE IF EXISTS job_run_log;

CREATE TABLE IF NOT EXISTS judgment_run (
  judgment_run_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  market           ENUM('domestic','overseas') NOT NULL,
  judgment_role    ENUM('baseline','shadow') NOT NULL,
  session_d0       DATE NULL,                    -- 분석한 마지막 일봉의 현지 거래일(해외 = 엔진의 d0). 국내는 엔진이 아직 보유하지 않음(§3.5)
  valid_from       DATETIME NOT NULL,            -- 카드가 겨냥한 다음 세션 시작(KST) = signals.valid_from
  started_at       DATETIME NOT NULL,
  ended_at         DATETIME NULL,
  as_of            DATETIME NULL,                -- 판단 입력을 고정한 시각(RAG 조회 직전, KST). LLM 전에 끝나면 NULL
  candidate_count  SMALLINT UNSIGNED NOT NULL DEFAULT 0,   -- 종목당 1개로 줄인 후보 수(엔진의 candidatesFound 와 같은 정의)
  llm_provider     VARCHAR(24) NULL,             -- claude·home-m4-api·hybrid — 설정 기준(§3.5)
  llm_model        VARCHAR(64) NULL,             -- 설정 기준. 모르면 NULL
  prompt_sha256    CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,   -- runLlm 에 넘긴 프롬프트 문자열 그대로의 sha256 16진
  rag_context_ids  JSON NULL,                    -- {"news":[KbHit.id…],"signals":[…],"macro":[…]} — 4KB 이하
  data_status      JSON NULL,                    -- {"candles":"available|partial|…","news":…,"earnings":…,"fx":…,"llm":…} — J5 어휘, 1KB 이하
  engine_release   VARCHAR(48) NULL,             -- v1.1 추가(G-J1 #7): 릴리스 디렉터리 이름(process.cwd() 의 마지막 경로, 예 20261030-051343-9d087a4d). 기준선 변경 대장(공동 인계서 §10) 대조용
  KEY idx_market_session (market, session_d0, judgment_role),
  KEY idx_started (started_at),
  CONSTRAINT chk_jr_prompt CHECK (prompt_sha256 IS NULL OR prompt_sha256 REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_jr_rag    CHECK (rag_context_ids IS NULL OR CHAR_LENGTH(rag_context_ids) <= 4096),
  CONSTRAINT chk_jr_status CHECK (data_status IS NULL OR CHAR_LENGTH(data_status) <= 1024)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS judgment_candidate (
  candidate_id     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,   -- ci_decision_snapshot.baseline_record_id 가 가리킬 단일 키(설계서 §5)
  judgment_run_id  BIGINT UNSIGNED NOT NULL,                     -- judgment_run 참조(외래키 없음)
  judgment_role    ENUM('baseline','shadow') NOT NULL,           -- 헤더와 같은 값(앱이 보장). 후보 단위 집계를 조인 없이
  symbol           VARCHAR(32) NOT NULL,                         -- 앱 심볼('005930','NAS:MU') = signals.symbol·daily_bars.symbol 과 같은 형식
  pattern          VARCHAR(32) NULL,                             -- eod-high-close·inside-bar·oversold-bounce. 종목 단계 제외면 NULL
  exclusion_code   VARCHAR(40) NULL,                             -- §3.4 어휘. NULL = 끝까지 통과(BUY → 카드) 또는 AI 가 SKIP
  sent_to_llm      TINYINT(1) NOT NULL DEFAULT 0,
  ai_decision      ENUM('BUY','SKIP','NONE','INVALID') NULL,     -- NONE = LLM 응답에 이 종목 결정이 없음, INVALID = 형식 불량. 미전송·LLM 실패면 NULL
  confidence       DECIMAL(5,2) NULL,                            -- LLM 이 준 0~100
  ai_reasoning     VARCHAR(500) NULL,                            -- LLM 판단 근거(SKIP 포함). 500자에서 자른다. 외부 데이터로만 취급
  signal_id        BIGINT NULL,                                  -- signals.id(BIGINT 부호 있음 [확실: db.ts 782행]). 카드가 없으면 NULL
  UNIQUE KEY uq_run_symbol (judgment_run_id, symbol),            -- 종목당 1행(엔진이 종목당 후보 1개로 줄인다)
  KEY idx_symbol (symbol),                                       -- 종목별 이력·사후 성과
  KEY idx_signal (signal_id),                                    -- 카드 → 판단 역조회
  CONSTRAINT chk_jc_sent     CHECK (sent_to_llm IN (0,1)),
  CONSTRAINT chk_jc_decision CHECK (sent_to_llm = 1 OR ai_decision IS NULL),
  CONSTRAINT chk_jc_conf     CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 되돌리기(쌓인 판단 기록 함께 삭제 — 사용자 승인 사항, 되살릴 수 없음):
-- DROP TABLE IF EXISTS judgment_candidate;
-- DROP TABLE IF EXISTS judgment_run;
