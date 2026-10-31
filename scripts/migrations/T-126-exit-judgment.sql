-- T-126 — 청산 판단 영구 기록 exit_judgment: 청산 엔진(runExitEngine)이 보유 종목마다 내린 결론 하나를 감사 기간 뒤에도 남긴다
--   (테이블 1개, 가산 전용: 기존 테이블·행 변경 없음. 사용자 승인 2026-10-31 06:50 "T-126 승인하니 DDL작업 진행해줘" — Leader 해석: 가산 전용 새 테이블
--   1개 CREATE TABLE IF NOT EXISTS 만. 기존 테이블 ALTER·행 변경·기록 스위치 켜기는 이 승인에 들지 않는다. 이 범위를 벗어나면 적용을 멈추고 다시 묻는다)
--
-- ⚠ 이 파일은 **앱 부팅 때 실행되지 않는다**(src/lib/db.ts 의 setupDB 에 넣지 않았다). 개발·운영이 같은 NAS MariaDB 라서
--   배포만으로 DDL 이 돌면 "DDL 은 사용자 건별 승인" 원칙(T-059·T-112·T-116 선례)이 무력화되기 때문이다.
--   QA PASS 뒤, 웹 코드 배포보다 **먼저**, 장외 창에서 사람이 직접 적용한다(T-112 와 같은 절차):
--     mysql -h <DB_HOST> -u <DB_USER> -p <DB_NAME> < scripts/migrations/T-126-exit-judgment.sql
--   적용 직전 확인(운영 조회라 사용자 승인 게이트에 포함):
--     SHOW TABLES LIKE 'exit_judgment';                                  -- 빈 결과여야 한다(있으면 SHOW CREATE TABLE 을 아래 정의와 대조 후 중단)
--     SELECT @@GLOBAL.sql_mode;                                          -- strict(STRICT_TRANS_TABLES) 인지 기록(비strict 면 ENUM·길이 위반이 잘려 저장된다)
--   적용 직후 `SHOW CREATE TABLE exit_judgment` 를 task 이력서에 남긴다.
--   CREATE TABLE IF NOT EXISTS 라 두 번 실행해도 안전하다(2차 적용 = Note 1050, 정의 불변 — 일회용 MariaDB 10.11 시험).
--   적용 전에는 기록 코드가 ER_NO_SUCH_TABLE(errno 1146)을 받아 조용히 건너뛴다(프로세스당 경고 1줄). 청산 평가·시그널·주문 동작은 그대로다.
--   기록 스위치 system_config.exit_judgment_record_enabled 는 **키 없음 = 꺼짐**이다 — 이 DDL 을 적용해도 스위치를 켜기 전에는 아무것도 쓰지 않는다.
--   켜기는 DDL 적용 뒤 별도 승인(DDL → 배포 → 스위치 순, T-112·T-116 선례). 정확히 JSON true 만 켜짐, DB 오류·2초 초과 = 꺼짐(30초 캐시).
--
-- 정본: T-126 task 「설계」 D1(무엇을)·D2(열)·D3(쓰기 방식)·D5(안전·경계), 지표 계약 docs/design/2026-10-30-t108-metrics-contract-draft.md §11.3·§11.4.
-- 쓰기 주체: src/lib/strategy/records/exit-judgment.ts — 엔진 루프의 결론 지점마다 메모리에 한 줄 모으고, 틱 끝에 분리 실행으로 multi-row INSERT 1문장
--   (기다리지 않음·상한 4초·절대 던지지 않음). 1행 = (청산 평가 틱 run_id, 보유 종목). 하루 상한 ≈ 보유 종목 수 × 시장 2 × 틱 약 80 = 수백 행.
--   남기지 않는 것: 잔고 미확인 틱(balances_unknown — 보유 목록을 모르면 종목 행이 없다, eval_funnel·job_run_log 가 증거)·보유 0종목 틱·
--   매수(진입) 판단·루프 중간에 예외가 나서 엔진이 그 틱을 끝내지 못한 경우(그때까지 모은 행도 남지 않는다).
-- 시각 규칙(T-046·T-059·T-112): DB·앱 풀 모두 KST. evaluated_at DATETIME = KST 벽시계(앱이 문자열로 바인딩, 초 단위). session_date_et = America/New_York 날짜(해외만).
-- 외래키 없음: 쓰기 경합·잠금 전파 방지. signal_id 는 signals.id(부호 있는 BIGINT)를 외래키 없이 가리킨다 — 주문은 signals.consumed_order_id 로 잇는다.
-- 가상 주문(DRY_RUN) 여부는 이 표에 두지 않는다 — signal_id → signals.consumed_order_id → orders.status('dry_run') 로 본다(청산 평가 틱은 그 값을 읽지 않는다).
-- 인덱스는 설계 D2 의 두 개뿐이다. run_id 는 eval_funnel.run_id 와 같은 값(buildRunId — '<market>-YYYYMMDDHHMM', **분 단위**)이라
--   같은 분에 틱이 두 번 돌면 겹친다 → (run_id, symbol) UNIQUE 를 걸지 않는다(걸면 두 번째 틱 기록이 문장째 실패한다). 구분은 evaluated_at(초)와 함께 본다.
-- CHECK 는 최소로 둔다(과한 CHECK 는 기록 실패를 부르고, 기록은 던지지 않으니 행이 조용히 사라진다): decision_code 비어 있지 않음 · pnl_pct ≥ −100.
--   열 범위·형식은 앱이 넣기 전에 맞춘다(문자열 코드포인트 절단·거부, 숫자 유한성·범위, ENUM 값 검사 — exit-judgment.ts 머리 주석).
-- 되돌리기: **먼저 기록 스위치를 끄는 것이 롤백이다**(즉시, 데이터 보존). 테이블 삭제는 CREATE 아래 주석의 DROP 줄(쌓인 기록 함께 삭제 — 되살릴 수 없다, 사용자 승인 사항).
-- (T-112 구현 규칙 F9 · T-072·T-074·T-081·T-084·T-088 선례) 잠금을 5초 넘게 기다리지 않는다 — 새 테이블 CREATE 1개라 위험은 낮지만 같은 규칙을 둔다.

SET SESSION lock_wait_timeout = 5;

CREATE TABLE IF NOT EXISTS exit_judgment (
  judgment_id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  run_id                 VARCHAR(40)    NOT NULL,          -- eval_funnel.run_id 와 같은 값(분 단위 — 겹칠 수 있다, UNIQUE 없음)
  evaluated_at           DATETIME       NOT NULL,          -- 그 종목의 결론 시각(KST 벽시계, 초)
  session_date_kst       DATE           NOT NULL,          -- evaluated_at 의 KST 날짜
  session_date_et        DATE           NULL,              -- 해외만: 같은 시각의 America/New_York 날짜
  market                 ENUM('domestic','overseas') NOT NULL,
  symbol                 VARCHAR(32)    NOT NULL,          -- 앱 심볼('005930','NAS:MU') = signals.symbol·position_state.symbol 과 같은 형식
  position_qty           DECIMAL(36,18) NULL,              -- 엔진이 본 KIS 잔고 수량
  entry_price            DECIMAL(36,8)  NULL,              -- 엔진이 평가에 쓴 진입가(position_state.entry_price, 행을 읽기 전 지점은 KIS 평단). 원값 그대로
  peak_price             DECIMAL(36,8)  NULL,              -- position_state.peak_price(행을 읽은 뒤 지점만)
  price                  DECIMAL(36,8)  NULL,              -- 엔진이 본 현재가(원값 그대로 — 0 이하 등 이상 값도, 해석은 읽는 쪽)
  currency               CHAR(3)        NULL,              -- 위 가격 열의 통화. 국내 = 항상 'KRW'. 해외도 어댑터(kis-overseas getTicker·getBalances)가 시세·평단을 원화로 환산해 주므로 'KRW' —
                                                            --   단 price/entry_price 비율이 엔진 단위 검사 범위 [0.3, 3.0] 밖이거나 price 가 없으면 NULL.
                                                            --   (환율 함수 fetchUsdKrwRate 는 던지지 않고, 환율을 못 얻으면 1 을 돌려준다 — 그때 그 값은 달러 원값이다. 드물다:
                                                            --   getUsdKrwRate 가 외부 → DB 캐시 → 상수 폴백 순이다. 한쪽만 1 이면 비율이 범위 밖이라 NULL, 시세·평단이 둘 다 1 이면
                                                            --   달러끼리라 단위 검사를 통과해 'KRW' 로 잘못 남는다 — 이 규칙으로는 못 거르는 알려진 한계)
  pnl_pct                DECIMAL(10,4)  NULL,              -- (price − entry_price) / entry_price × 100 — 비율이 단위 검사 범위 [0.3, 3.0] 안일 때만
  trigger_kind           ENUM('eod_loss_cut','hard_stop','target_profit','trailing_stop','none') NOT NULL DEFAULT 'none',   -- evaluateExit 가 고른 청산 종류. 발화 조건 미충족·평가 전 오류 = none
  threshold_pct          DECIMAL(10,4)  NULL,              -- 적용 임계, pnl_pct 와 같은 부호: 손절 = 음수(eod_loss_cut = −eodLossCutPct, hard_stop = −hardStopPct), 익절 = 양수(target_profit = +targetProfitPct).
                                                            --   trailing_stop(손익률이 아니라 고점 대비 되돌림 조건)·시나리오 포지션(stopHi/stopLo·targetHi/targetLo 중 무엇인지 재계산 필요)·none = NULL
  decision               ENUM('fired','skip_policy','skip_cooldown','error','no_fire') NOT NULL,   -- 설계 D1 표
  decision_code          VARCHAR(48)    NOT NULL,          -- 게이트 ID 그대로(eval_funnel.gate 와 같은 어휘). 예: exit_no_fire·exit_engine_disabled·quantity_below_min
  exit_engine_enabled    TINYINT(1)     NULL,              -- 그 틱에 엔진이 적용한 마스터 스위치. 스위치 조회 실패 틱 = NULL
  exit_hard_stop_enabled TINYINT(1)     NULL,              -- 그 틱에 엔진이 적용한 하위 스위치(손실한도 손절). 스위치 조회 실패 틱 = NULL
  signal_id              BIGINT         NULL,              -- decision = fired 일 때 만든 signals.id
  engine_release         VARCHAR(48)    NULL,              -- 릴리스 디렉터리 이름(process.cwd() 의 releases/<이름>) — T-112 judgment_run.engine_release 와 같은 정의
  KEY idx_evaluated_market (evaluated_at, market),         -- 기간·시장별 조회, 보존 정리
  KEY idx_symbol_evaluated (symbol, evaluated_at),         -- 종목별 이력
  CONSTRAINT chk_xj_code CHECK (CHAR_LENGTH(decision_code) > 0),
  CONSTRAINT chk_xj_pnl  CHECK (pnl_pct IS NULL OR pnl_pct >= -100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 되돌리기(쌓인 청산 판단 기록 함께 삭제 — 사용자 승인 사항, 되살릴 수 없음):
-- DROP TABLE IF EXISTS exit_judgment;
