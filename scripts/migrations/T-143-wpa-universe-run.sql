-- T-143 WP-A — NYSE 시가총액 상위 N 월간 산출: 실행 1건(`run`)과 후보·원값·판정(`candidate`)
--   표 2개, **가산 전용**: 기존 테이블·행·인덱스를 건드리지 않는다. ALTER 0건, DROP 0건, UPDATE 0건.
--
-- ⚠ 이 파일은 **앱 부팅 때 실행되지 않는다**(`src/lib/db.ts` 의 setupDB 에 넣지 않았다). 개발과 운영이 같은 NAS MariaDB 라서
--   배포만으로 DDL 이 돌면 "DDL 은 사용자 건별 승인" 원칙(T-059·T-112·T-116·T-126·T-143 WP-B 선례)이 무력화된다.
--   **적용은 사용자 승인 사항이다** — Reviewer PASS·QA PASS 뒤, 웹 코드 배포보다 **먼저**, 사람이 직접 적용한다:
--     mysql -h <DB_HOST> -u <DB_USER> -p <DB_NAME> < scripts/migrations/T-143-wpa-universe-run.sql
--   적용 직전 확인(운영 조회라 같은 승인 게이트에 포함):
--     SHOW TABLES LIKE 'overseas_universe\_%';   -- WP-B 의 4개만 보여야 한다(run·candidate 가 이미 있으면 SHOW CREATE TABLE 을 아래와 대조한 뒤 중단)
--     SELECT @@GLOBAL.sql_mode;                  -- strict(STRICT_TRANS_TABLES) 인지 기록(비strict 면 길이 위반이 잘려 저장된다)
--   적용 직후 `SHOW CREATE TABLE` 2개를 task 이력서에 남긴다.
--   CREATE TABLE IF NOT EXISTS 라 두 번 실행해도 안전하다(2차 적용 = Note 1050, 정의 불변).
--
-- ## WP-B 의 표 4개와의 관계 — **WP-A 가 WP-B 스키마에 맞춘다**(Leader 2026-11-01)
--   - `overseas_universe_auto`(현재 자동 목록) 에 **열을 더하지 않는다.** 산출 run 과 시총 출처를 그 표에 연결하는
--     제안(W-4: `run_id`·`cap_source`)은 **채택하지 않았다** — 이미 만든 스키마를 흔들지 않는다. 산출 근거는
--     아래 `overseas_universe_candidate` 가 종목마다 갖고 있고, `auto.computed_at` 으로 run 을 찾을 수 있다.
--   - `overseas_universe_proposal` 도 그대로 쓴다(열 추가 0). WP-A 가 만드는 `otc_move`·`kis_unavailable` 두 종류는
--     `kind VARCHAR(32)` 의 값일 뿐이고 이름표는 앱(`proposal-copy.ts` `PROPOSAL_KIND_KO`)이 이미 갖고 있다(W-2).
--     `basis_source` 는 전부 `'listing'` 이다 — `WatchSourceId` 에 `'kis'` 가 없어 타입을 바꾸지 않고(W-6)
--     KIS 에서 비롯한 사실인지는 지문·근거 문장이 구분한다.
--   - `overseas_universe_watch`(일간 확인 기록)에 **쓰지 않는다.** 월간 산출의 기록은 아래 `run` 표다.
--
-- ## 적용 전 동작 (아무것도 깨지지 않는다)
--   산출 라우트(`/api/cron/overseas-universe-refresh`)가 표 없음(errno 1146)을 받아
--   `{ ok:true, status:'tables_missing', final:true }` 로 **아무 외부 호출 없이** 끝낸다. 러너는 `final:true` 를 보고
--   그 달 다시 부르지 않는다. 자동 목록은 비어 있고 분석 대상은 수동 목록 ∪ 폴백 그대로다(종전과 같다).
--   ⚠ 산출 스위치(`system_config.overseas_universe_refresh.enabled`)는 **기본 꺼짐**이라, 표를 적용해도
--   그 값을 `true` 로 바꾸기 전까지는 산출이 돌지 않는다(그 설정 변경도 사용자 승인 사항이다).
--
-- ## 적용 뒤 첫 상태
--   표 2개 모두 **빈 상태**. 씨앗 INSERT 는 이 파일에 없다(사용자 승인 범위를 넘지 않는다).
--   첫 산출은 **2026-12-06(일) 01:10 KST**(매월 첫째 일요일 창)이고, 그 전에 결과를 보려면 일요일 창 안에서의
--   수동 호출이 필요하다 — 사용자 승인 사항이다.
--
-- 행 수 전망: 후보 ≈ 2,763행/월(제외분 포함) ≈ 3.3만 행/년. 보존 13개월 정리는 **별도 승인**이다(이 파일에 없다).
-- 시각 규칙(T-046·T-059·T-112·WP-B 와 같다): DB·앱 풀 모두 KST. 모든 DATETIME = KST 벽시계(앱이 문자열로 바인딩, 초 단위).
-- 외래키 없음: 쓰기 경합·잠금 전파 방지(기존 표들과 같은 규칙). `candidate.run_id` 는 외래키 없이 가리킨다.
-- 이 표들은 **주문·시그널·안전장치와 무관하다** — 주문을 만들지 않고 `orders`·`signals`·`position_state` 에 쓰지 않는다.
-- 되돌리기: 표 2개를 DROP 하면 적용 전 상태로 돌아간다(쌓인 산출 기록 함께 삭제 — 되살릴 수 없다, 사용자 승인 사항).
--   DROP TABLE IF EXISTS overseas_universe_candidate, overseas_universe_run;
--   DROP 뒤 자동 목록(`overseas_universe_auto`)은 **마지막 산출 결과가 그대로 남는다** — 그 표는 WP-B 소유라 지우지 않는다.
--   산출을 멈추려면 표를 지우는 것이 아니라 설정 `enabled` 를 false 로 둔다(그쪽이 외부 호출 0으로 멈춘다).
-- (T-112 F9 · T-126 선례) 잠금을 5초 넘게 기다리지 않는다 — 새 표 CREATE 2개라 위험은 낮지만 같은 규칙을 둔다.

SET SESSION lock_wait_timeout = 5;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) 산출 실행 — **한 달에 1건**(`run_key` UNIQUE). 창 안에서 러너가 매 틱 라우트를 부르고 라우트는
--    100초 예산 안에서 한 단계만 처리하므로, 같은 run 이 **여러 번의 호출에 걸쳐** 진행된다.
--    `phase` 와 `cursor_pos` 가 그 이어받기의 유일한 상태다(프로세스 재기동을 넘어서 살아 있어야 해서 DB 에 둔다).
--
--    왜 「월 1건」인가: 2,763개 후보를 KIS 현재가상세로 훑는 데 실측 0.46~0.93초/건 → 23~41분이 걸린다.
--    300초 하트비트에 한 번으로는 절대 안 들어가고, 평일 야간은 전부 미국 장중이라 종목마다 다른 시각의 가격으로
--    순위를 매기게 된다. **첫째 일요일 01:10~05:50 KST** 는 미국·국내 모두 휴장이라 모든 종목의 가격 단면이
--    금요일 종가 하나로 통일된다.
--    ⚠ **「다음 주 일요일에 이어간다」는 구현에 없다.** 러너는 `UNIV_DOM -le 7`(그 달 첫째 일요일)만 부른다 —
--      사양 §4.3 산문에는 이어받기가 적혀 있지만 같은 사양 §4.4 의 러너 코드가 첫째 일요일만이고, Leader 가
--      코드 쪽을 채택했다(닿지 않는 경로를 안전 경로에 미검증 코드로 더하지 않는다). 창 안에 못 끝내면
--      그 달 run 은 `phase='scan'` 등으로 남고, **다음 달 창이 열릴 때** `expired` 로 닫힌다. 그 사실은
--      다음 달 창의 **모든 호출**이 응답에 싣는 `prevMonthIncomplete`(= 직전 달 run 이 complete 가 아니다)로
--      `classifyRun` → `job_run_log`(degraded `universe_run_expired`)에 남는다.
--      ⚠ 「닫은 수(`expiredRuns`)로 올라온다」고 적었던 앞 판은 **사실이 아니었다** — 그 값은 단 한 호출에서만
--        0보다 크고 창 안 호출이 전부 같은 슬롯(01:10)으로 모여 ODKU 가 마지막 호출로 덮어쓴다(Reviewer r2 ②).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS overseas_universe_run (
  run_id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  run_key           CHAR(7)           NOT NULL,              -- 'YYYY-MM'(KST, 창이 열린 달) — 한 달 1건
  phase             VARCHAR(16)       NOT NULL,              -- listing|scan|retry|finalize|complete|failed|expired
  top_n             SMALLINT UNSIGNED NOT NULL,              -- 이 run 에 적용한 설정값(topN). 나중에 설정이 바뀌어도 이 run 의 기준은 남는다
  cursor_pos        INT UNSIGNED      NOT NULL DEFAULT 0,    -- scan 이 처리한 마지막 candidate.ord(이어받기 지점)
  sec_fetched_at    DATETIME          NULL,
  sec_sha256        CHAR(64)          NULL,                  -- SEC 응답 본문의 sha256. **본문은 저장하지 않는다**(해시·행 수만)
  sec_rows          INT UNSIGNED      NULL,
  master_fetched_at DATETIME          NULL,
  master_sha256     CHAR(64)          NULL,                  -- KIS 종목 마스터(nysmst.cod) 원본 바이트의 sha256
  master_rows       INT UNSIGNED      NULL,
  counts_json       TEXT              NULL,                  -- 단계별 집계(제외 사유별 수·cap_flag 분포·DR 가상 순위 등) — 1회차 검토의 근거
  added_symbols     TEXT              NULL,                  -- 직전 complete run 의 상위 N 대비 들어온 종목(JSON 배열). 1회차는 NULL
  removed_symbols   TEXT              NULL,                  -- 〃 나간 종목
  notified_at       DATETIME          NULL,                  -- 자동 목록 변동을 알린 시각(같은 run 이 두 번 알리지 않게)
  last_error        VARCHAR(255)      NULL,
  started_at        DATETIME          NOT NULL,
  updated_at        DATETIME          NOT NULL,
  finished_at       DATETIME          NULL,
  UNIQUE KEY uq_run_key (run_key),
  KEY idx_run_phase (phase, started_at),
  CONSTRAINT chk_run_phase CHECK (phase IN ('listing', 'scan', 'retry', 'finalize', 'complete', 'failed', 'expired'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='T-143 WP-A NYSE 상위 N 월간 산출 실행(월 1건, 여러 호출에 걸쳐 진행)';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) 후보 — SEC NYSE 행 하나당 1행. **제외된 것도 남긴다.**
--    왜 제외분을 지우지 않나: 「왜 이 종목이 상위 50 에 없나」를 사람이 SELECT 로 답할 수 있어야 한다.
--    사전 제외(우선주·워런트)·마스터 제외(ETP·KIS 미취급)·조회 실패·시총 판정까지 전부 이 표에 사유로 남는다.
--
--    `ord` = SEC 파일의 순서다. 스캔 커서가 이 값을 기준으로 전진하므로 **run 안에서 바뀌지 않아야** 한다
--    (PRIMARY KEY 에 넣어 그 불변을 표가 보장한다).
--
--    `rank_no` 는 **complete 뒤 상위 N 에만** 채운다 → 「직전 목록」 = 직전 complete run 의 `rank_no IS NOT NULL`.
--    그래서 자동 목록의 월별 이력을 따로 저장하는 표가 필요 없다.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS overseas_universe_candidate (
  run_id       BIGINT UNSIGNED   NOT NULL,
  ord          INT UNSIGNED      NOT NULL,                   -- SEC 파일 안의 순서(스캔 커서 기준, run 안에서 불변)
  symbol       VARCHAR(32)       NOT NULL,                   -- 내부 표기 'NYS:BRK.B'(점) — KIS 요청 표기는 kis_symb 에 따로 둔다
  sec_ticker   VARCHAR(16)       NOT NULL,                   -- SEC 표기 'BRK-B'(하이픈)
  cik          BIGINT UNSIGNED   NOT NULL,
  sec_name     VARCHAR(200)      NULL,
  -- KIS 종목 마스터(nysmst.cod)에서 읽은 값. 🔴 `kis_symb` 가 **KIS 가 받는 표기**다(클래스주는 'BRK/B' — 슬래시).
  --   내부 심볼의 점 표기를 KIS 가 거부해 NYS:BRK.B 가 11일 연속 조회 실패한 것이 이 열을 둔 이유다(2026-10-21~11-01).
  kis_symb     VARCHAR(16)       NULL,
  -- 마스터의 영문 종목명. **ADR·ADS 표지가 실제로 들어 있는 유일한 출처**다(보고용 — 제외 근거로 쓰지 않는다).
  --   SEC `name` 에는 그 표지가 없다(2026-11-01 보관본 실측: NYSE 3,269행 중 적중 0, ADR 10종 0/10).
  --   마스터 `enam` 에서는 적중 180행(ADR 10종 중 9종) → 이름 신호를 볼 곳은 이 열이다. 되돌리지 말 것.
  kis_enam     VARCHAR(200)      NULL,
  kis_stis     CHAR(1)           NULL,                       -- 1=지수 2=주식 3=ETP 4=워런트
  kis_isdr     CHAR(1)           NULL,                       -- DR(주식예탁증서) 여부 Y/N
  kis_etyp     CHAR(3)           NULL,                       -- ETP 분류(001 ETF·002 ETN…). 보통주는 마스터에서 공백이라 NULL 로 넣는다
  status       VARCHAR(16)       NOT NULL DEFAULT 'pending',  -- pending|ok|kis_missing|kis_error|excluded
  exclusion    VARCHAR(32)       NULL,                       -- 왜 뺐나(아래 CHECK 목록). status='excluded' 일 때만 채운다
  -- KIS 현재가상세 원값만 담는다(해석·환산 없음). `raw` 전체는 저장하지 않는다 — 2,700행 × JSON 은 불필요하다.
  tomv         DECIMAL(28,4)     NULL,                       -- 시가총액 원값(USD). **클래스 단위다**(GOOGL ≠ Alphabet 전체)
  shar         DECIMAL(24,2)     NULL,                       -- 상장주수
  last_price   DECIMAL(20,6)     NULL,
  curr         VARCHAR(8)        NULL,
  etyp_nm      VARCHAR(64)       NULL,                       -- ETP 분류명. 비어 있지 않으면 제외(마스터가 놓친 것을 여기서 받는다)
  rsym         VARCHAR(32)       NULL,                       -- 응답의 실시간 심볼 — 참고용(run 을 실패시키지 않는다)
  -- 시총 판정 결과(`src/lib/universe/cap-rule.ts`). cap_source 가 'tomv' 가 아니면 KIS 값을 쓰지 않았다는 뜻이다.
  cap_used     DECIMAL(28,4)     NULL,                       -- 순위에 쓴 값
  cap_alt      DECIMAL(28,4)     NULL,                       -- tomv 가 없을 때의 shar×last(순위에 쓰지 않고 크기만 기록)
  cap_source   VARCHAR(16)       NULL,                       -- tomv|shares_x_last
  cap_ratio    DECIMAL(12,6)     NULL,                       -- tomv ÷ (shar×last)
  cap_flag     VARCHAR(24)       NULL,                       -- consistent|minor_mismatch|unit_mismatch|basis_mismatch|unverified|tomv_null
  rank_no      SMALLINT UNSIGNED NULL,                       -- complete 뒤 상위 N 에만 1..N(= 그 run 의 자동 목록)
  attempts     TINYINT UNSIGNED  NOT NULL DEFAULT 0,
  error        VARCHAR(160)      NULL,
  fetched_at   DATETIME          NULL,
  PRIMARY KEY (run_id, ord),
  UNIQUE KEY uq_cand_symbol (run_id, symbol),
  KEY idx_cand_status (run_id, status),
  KEY idx_cand_rank (run_id, rank_no),
  KEY idx_cand_symbol (symbol, run_id),
  CONSTRAINT chk_cand_status CHECK (status IN ('pending', 'ok', 'kis_missing', 'kis_error', 'excluded')),
  CONSTRAINT chk_cand_exclusion CHECK (exclusion IS NULL OR exclusion IN (
    'prefilter_noncommon',   -- SEC 티커 접미사가 우선주·워런트·유닛·권리(KIS 호출 0)
    'symbol_format',         -- 내부 심볼 규약(kis-symbols 의 해외 패턴)을 통과하지 못하는 티커. 넣으면 분석 대상에서 조용히 빠진다
    'master_missing',        -- KIS 종목 마스터에 없음(미취급·상장 직후·NYSE American·마스터 지연)
    'master_other_exchange', -- 마스터에 있으나 다른 거래소(amsmst 등)
    'master_type',           -- stis != 2 (지수·ETP·워런트)
    'master_dr',             -- DR(주식예탁증서) — 실적 블랙아웃이 8-K 기반이라 1회차 제외(L-A2)
    'master_etp',            -- 마스터 etyp 가 비어 있지 않음(ETF·ETN)
    'etp',                   -- 현재가상세 etyp_nm 이 비어 있지 않음
    'tomv_null',             -- 시가총액 원값 없음(승인 정책 — 추정값으로 순위에 넣지 않는다)
    'currency',              -- curr != USD (NYSE 방어)
    'implausible',           -- 0 이하·20조 USD 이상
    'cik_dup'                -- 같은 CIK 의 다른 클래스가 더 큼(L-A3)
  ))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='T-143 WP-A 월간 산출 후보·원값·판정(직전 목록 = 직전 complete run 의 rank_no IS NOT NULL)';
