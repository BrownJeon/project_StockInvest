-- T-143 WP-B — 해외 분석 대상: 수동 목록(나스닥100)·변경 제안·변경 확인 기록·자동 목록(NYSE 상위 N)
--   표 4개, **가산 전용**: 기존 테이블·행·인덱스를 건드리지 않는다. ALTER 0건, DROP 0건, UPDATE 0건.
--
-- ⚠ 이 파일은 **앱 부팅 때 실행되지 않는다**(src/lib/db.ts 의 setupDB 에 넣지 않았다). 개발과 운영이 같은 NAS MariaDB 라서
--   배포만으로 DDL 이 돌면 "DDL 은 사용자 건별 승인" 원칙(T-059·T-112·T-116·T-126 선례)이 무력화된다.
--   **적용은 사용자 승인 사항이다** — Reviewer PASS·QA PASS 뒤, 웹 코드 배포보다 **먼저**, 사람이 직접 적용한다:
--     mysql -h <DB_HOST> -u <DB_USER> -p <DB_NAME> < scripts/migrations/T-143-overseas-universe.sql
--   적용 직전 확인(운영 조회라 같은 승인 게이트에 포함):
--     SHOW TABLES LIKE 'overseas_universe\_%';    -- 빈 결과여야 한다(있으면 SHOW CREATE TABLE 을 아래 정의와 대조한 뒤 중단)
--     SELECT @@GLOBAL.sql_mode;                   -- strict(STRICT_TRANS_TABLES) 인지 기록(비strict 면 길이 위반이 잘려 저장된다)
--   적용 직후 `SHOW CREATE TABLE` 4개를 task 이력서에 남긴다.
--   CREATE TABLE IF NOT EXISTS 라 두 번 실행해도 안전하다(2차 적용 = Note 1050, 정의 불변).
--   ⚠ 수동 목록의 **실질 상한은 앱의 150**(`src/lib/universe/parse-manual-list.ts` `MANUAL_LIST_MAX`)이고 표의 CHECK 500 은
--     백스톱이다(아래 `chk_rev_count` 주석 — 두 수가 다른 것은 의도된 설계다). 상한만으로 분석 시간 예산이 보증되지 않는다 —
--     실제 대상은 목록 ∪ 자동 ∪ 보유 ∪ 즐겨찾기라 **거래일 1회 실측(WP-C)이 운영 관문으로 남는다**.
--
-- ## 적용 전 동작 (화면·분석이 깨지지 않는다)
--   - API 3개는 ER_NO_SUCH_TABLE(errno 1146)을 받아 `503 { ok:false, error:'not_migrated' }` 를 돌려주고,
--     화면은 「◌ 준비 중 — 서버 준비 뒤 쓸 수 있습니다」를 그린다(T-074 CashLedgerSummaryRow 선례와 같은 문구).
--   - 수동 목록 판독기 `getStaticOverseasUniverse()` 는 **DB > 마지막 성공 > 환경변수 > 코드 하드코딩** 순으로 보고,
--     표가 없으면 환경변수(OVERSEAS_UNIVERSE_SYMBOLS)·`SP500_TOP50` 으로 떨어진다 → **분석 대상은 적용 전과 같지만
--     조용하지는 않다**: 표가 없는 것도 `degraded` 라(사유 `not_migrated`) **요청마다 pm2 경고**가 남고 해외 장마감
--     분석의 `errors` 에 `universe_list` 가 실린다. 정식 적용 순서는 **DDL 먼저 · 코드 나중**이므로, 코드가 먼저 떠서
--     이 경고가 보이는 구간은 **순서 위반 신호**다(거짓 경보가 아니다 — 그 구간을 짧게 하는 것이 맞다).
--   - 홈 「확인 필요」의 「해외 분석 대상 변경 제안」 줄은 조회가 실패하면 **그 줄만 빠진다**(섹션 전체를 오류로 만들지 않는다 — 가이드 §3.4).
--
-- ## 적용 뒤 첫 상태 (씨앗 INSERT 는 이 파일에 없다 — 사용자 승인 범위를 넘지 않는다)
--   표 4개 모두 **빈 상태**로 시작한다. 그러면:
--     - 수동 목록 revision 이 0건 → 판독기는 여전히 환경변수·하드코딩을 쓴다(동작 불변).
--     - 화면 「수동」 칸은 0종목 · 「갱신」 구절 없음. 12월 일괄 교체를 한 번 저장하면 revision 1 이 생기고
--       그때부터 DB 가 분석 대상을 정한다. **그 첫 저장이 실질적인 전환점**이다.
--     - 「자동 — NYSE 상위 N」 칸과 변경 제안은 **WP-A(2차) 가 채운다**. 그때까지 제안 0건·자동 0종목이고,
--       빈 상태 문구는 「3곳 모두 확인」을 쓰지 않는다(확인 기록이 없으므로 — 가이드 §2.7).
--   첫 수동 목록을 DDL 로 미리 넣고 싶으면 **별도 승인**으로 아래 한 줄을 쓴다(이 파일에서는 실행하지 않는다):
--     INSERT INTO overseas_universe_revision (revision_no, symbols, symbol_count, change_source, updated_by, created_at)
--       VALUES (1, '["NAS:AAPL", ...]', <개수>, 'seed', 'manual-sql', NOW());
--
-- ## 설정 키 (DDL 아님 — 앱이 키 없음을 기본값으로 처리한다)
--   system_config.overseas_universe_refresh =
--     JSON `{"enabled":false,"topN":50,"weekday":0,"nth":1,"windowStart":"01:10","windowEnd":"05:50","excludeDr":true}`
--     enabled = 자동 산출 켜짐(**기본 꺼짐** — 새 기능 = 꺼짐, WP-A 가 켜질 때 사용자 승인) · topN = Q4 개수(기본 50) ·
--     weekday/nth = Q2 주기(0=일요일, 1=첫째 → **매월 첫째 일요일**) · windowStart/End = 그날 산출 창(KST) · excludeDr = DR 제외
--   ⚠ 「매월 1일 02시 KST」를 쓰지 않는다(W-1, 2026-11-01): 평일이면 **미국 정규장 한가운데**(KST 23:30~06:00)이고
--     KIS 유량이 가장 빡빡해, 산출이 길어지면 종목마다 다른 시각의 가격으로 순위를 매기게 된다. 첫째 일요일 01:10~05:50 은
--     미국·국내 모두 휴장이고 금요일 종가로 가격 단면이 통일되며 06~08시 무거운 틱과 겹치지 않는다.
--   키가 없거나 해석 불가면 앱이 위 기본값을 쓴다 → **재배포 없이 값만 바꿔 조정**할 수 있다(Leader 11:14 결정).
--   이 키를 넣거나 바꾸는 것은 DDL 이 아니라 설정 변경이라 이 파일에 없다.
--
-- 정본: 구현 가이드 `docs/design/2026-11-01-t143-implementation-guide.md` §5(DB 가 담아야 할 것)·§4(API 계약),
--       승인 데모 `mockups/T-143-universe-watch-v1.html` v1(2026-11-01 11:14 사용자 승인).
-- 시각 규칙(T-046·T-059·T-112 과 같다): DB·앱 풀 모두 KST. 모든 DATETIME = KST 벽시계(앱이 문자열·NOW() 로 바인딩, 초 단위).
-- 외래키 없음: 쓰기 경합·잠금 전파 방지(기존 표들과 같은 규칙). proposal_id 는 외래키 없이 가리킨다.
-- 이 표들은 **주문·시그널·안전장치와 무관하다** — 주문을 만들지 않고 `orders`·`signals`·`position_state` 에 쓰지 않는다.
-- 되돌리기: 표 4개를 DROP 하면 적용 전 상태로 돌아간다(쌓인 기록 함께 삭제 — 되살릴 수 없다, 사용자 승인 사항).
--   DROP TABLE IF EXISTS overseas_universe_watch, overseas_universe_auto, overseas_universe_proposal, overseas_universe_revision;
--   DROP 뒤에도 분석은 환경변수·하드코딩으로 계속 돈다(위 「적용 전 동작」과 같다).
--   ⚠ **DROP 뒤에는 요청마다 경고가 남는다 — 재시작해도 멈추지 않는다.** 표가 없는 것은 언제나 `degraded` 이고
--     (`[universe-overseas] 수동 목록 조회 실패(...)`) 해외 장마감 분석의 `errors` 에 `universe_list` 가 실린다.
--     사유만 갈린다 — 그 프로세스가 표를 읽어 본 적이 있으면 `table_missing`, 재시작한 뒤라면 `not_migrated`.
--     이것은 **의도된 동작**이다(사용자 목록이 조용히 사라지는 것을 막는다). 로그를 조용히 하려면 **표를 되살리거나**
--     (이 파일을 다시 적용) T-143 코드를 되돌려야 한다 — 재시작으로는 없앨 수 없다.
-- (T-112 F9 · T-126 선례) 잠금을 5초 넘게 기다리지 않는다 — 새 표 CREATE 4개라 위험은 낮지만 같은 규칙을 둔다.

SET SESSION lock_wait_timeout = 5;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) 수동 목록 — **가산 전용 개정판(revision)**. 현재 목록 = revision_no 최댓값 행.
--    왜 "현재 1행 + 이력 1표" 가 아니라 이 모양인가:
--      · 「직전 목록으로 되돌릴 수 있다」(가이드 §5.1)가 성립하려면 **직전 목록 1벌이 통째로** 남아야 한다 → 개정판마다 전체 목록을 담는다.
--      · 409 충돌 판정(가이드 §4.3)을 **잠금 없이** 한다 — 앱이 `revision_no = baseVersion + 1` 을 **명시해** INSERT 하므로
--        두 기기가 동시에 저장하면 둘째가 중복키(errno 1062)로 실패한다. "전부 아니면 전무" 가 한 문장으로 보장된다.
--      · 같은 교체를 두 번 보내도 두 번째는 409 다 → 변경 이력이 두 벌 늘지 않는다.
--    개정판은 지우지 않는다(「삭제」라는 말을 쓰지 않는 이유와 같다). 행 크기는 목록 상한 500종목 × ~12자 ≈ 6KB.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS overseas_universe_revision (
  revision_no       INT UNSIGNED   NOT NULL,              -- 1부터. 앱이 baseVersion+1 을 명시해 INSERT (중복 = 409 충돌)
  symbols           TEXT           NOT NULL,              -- 이 개정판의 목록 1벌 (JSON 배열, 예 ["NAS:AAPL","NYS:BRK.B"])
  symbol_count      SMALLINT UNSIGNED NOT NULL,           -- symbols 의 길이(화면 숫자 칸 — JSON 을 파싱하지 않고 세게)
  added_symbols     TEXT           NULL,                  -- 직전 개정판 대비 넣은 것 (JSON 배열). 첫 개정판·모를 때 NULL
  removed_symbols   TEXT           NULL,                  -- 직전 개정판 대비 뺀 것 (JSON 배열)
  kept_count        SMALLINT UNSIGNED NOT NULL DEFAULT 0, -- 그대로인 수 (성공 문구 「넣기 N · 빼기 N」의 짝)
  change_source     VARCHAR(16)    NOT NULL,              -- 'bulk'(일괄 교체) | 'proposal'(제안 1건 처리) | 'seed'(최초 주입)
  proposal_id       BIGINT UNSIGNED NULL,                 -- change_source='proposal' 일 때 그 제안(외래키 없음)
  updated_by        VARCHAR(64)    NOT NULL DEFAULT 'web',-- 누가 — 'web'·'user:<users.id>'·'job:<job_id>'·'manual-sql'
  created_at        DATETIME       NOT NULL,              -- 언제 (KST 벽시계)
  PRIMARY KEY (revision_no),
  KEY idx_rev_created (created_at),
  -- ⚠ 이 500 은 **표 차원의 백스톱**이고 **앱 상한과 같은 수가 아니다**(앱 150 — `MANUAL_LIST_MAX`).
  --   불일치는 **의도된 설계**다: 정책 수치(150, WP-C 시간 예산 목표치)를 표에 박으면 실측 뒤 상한을 올릴 때마다
  --   ALTER 가 필요하고 DDL 은 사용자 건별 승인이라 조정이 막힌다. 그래서 **표 = 사고 방지 백스톱 · 앱 = 정책**으로 나눈다.
  --   앱이 먼저 거부하므로 보통 이 CHECK 에 닿지 않는다(닿는 경로는 직접 SQL 시드뿐이다).
  CONSTRAINT chk_rev_count CHECK (symbol_count <= 500),
  CONSTRAINT chk_rev_source CHECK (change_source IN ('bulk', 'proposal', 'seed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='T-143 해외 수동 분석 대상 목록 개정판(가산 전용, 현재=최댓값)';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) 변경 제안 — 상태 4종(open·held·ignored·done). **제안을 지우지 않는다**(처리·보류·무시도 상태일 뿐이다).
--    카드의 다섯째 상태 `failed` 는 화면 전용이라 이 표에 없다(저장 요청이 실패한 화면 상태 — 가이드 §2.4.1).
--    행을 만드는 주체는 **WP-A(2차)의 변경 확인 잡**이다. 1차(WP-B)에서는 화면·API 가 읽고 상태만 바꾼다.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS overseas_universe_proposal (
  proposal_id       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  symbol            VARCHAR(32)    NOT NULL,              -- 전체 코드('NAS:AAAA') — 이 화면은 거래소 접두사가 뜻을 가진다
  kind              VARCHAR(32)    NOT NULL,              -- 'delisting'|'acquisition'|'exchange_move'|'add_candidate' 등(앱이 이름표로 바꾼다)
  basis_text        VARCHAR(255)   NOT NULL,              -- 근거 한 줄 — 「미국 공시 Form 25 (12-01 수집) · 해외 뉴스 2건」
  basis_source      VARCHAR(32)    NOT NULL,              -- 'us_filings'|'news_overseas'|'listing' (변경 확인이 읽는 원천 3곳)
  basis_fingerprint VARCHAR(190)   NOT NULL,              -- 근거 지문: 원천 + 종목 + 근거 식별자. 「무시 — 같은 근거로는 다시 제안하지 않습니다」의 근거
  collected_at      DATETIME       NULL,                  -- 근거를 수집한 시각. 모르면 NULL
  recommendation    VARCHAR(255)   NULL,                  -- 권고 한 줄. NULL 이면 화면이 주 행동 이름을 쓴다
  action_type       VARCHAR(16)    NOT NULL,              -- 'remove'(빼기)|'add'(넣기)|'recode'(코드 바꾸기)
  next_symbol       VARCHAR(32)    NULL,                  -- action_type='recode' 일 때 바꿀 코드. 그 밖은 NULL
  state             VARCHAR(16)    NOT NULL DEFAULT 'open',
  held_until        DATETIME       NULL,                  -- state='held' 해제 시각 = 다음 월간 산출(D4). 화면이 계산하지 않는다
  decided_at        DATETIME       NULL,                  -- 처리·보류·무시한 시각
  decided_by        VARCHAR(64)    NULL,                  -- 처리한 사람('web'·'user:<users.id>')
  notified_at       DATETIME       NULL,                  -- 텔레그램으로 「알렸음」(§7.1) — 같은 제안이 두 번 알림을 내지 않게. 발송은 2차
  created_at        DATETIME       NOT NULL,
  updated_at        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- 같은 근거로 두 번 만들어지지 않게. 공시가 **갱신되면 지문이 달라져 다시 올라와야** 한다(보류 문구가 그렇게 약속한다)
  -- → 지문에 공시 버전·수집 식별자를 넣는 책임은 WP-A 에 있다. 190자 = utf8mb4 UNIQUE 인덱스 안전 상한(190×4=760바이트)
  UNIQUE KEY uq_prop_fingerprint (basis_fingerprint),
  KEY idx_prop_state (state, created_at),
  KEY idx_prop_symbol (symbol),
  CONSTRAINT chk_prop_state CHECK (state IN ('open', 'held', 'ignored', 'done')),
  CONSTRAINT chk_prop_action CHECK (action_type IN ('remove', 'add', 'recode'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='T-143 해외 분석 대상 변경 제안(상태 4종, 지우지 않는다)';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) 자동 목록 — NYSE 시가총액 상위 N(Q4, 기본 50). **WP-A(2차)가 채운다.**
--    1차(WP-B)에서는 화면이 읽기만 하고, 비어 있으면 「자동」 칸이 0종목이다(0 을 「확인된 0」으로 꾸미지 않는다 —
--    화면은 산출 기록이 없으면 「산출」·「다음」 구절을 뺀다).
--    현재 목록만 둔다(순위 이력은 이 task 의 화면이 요구하지 않는다 — 필요해지면 그때 표를 더한다).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS overseas_universe_auto (
  symbol         VARCHAR(32)       NOT NULL,
  rank_no        SMALLINT UNSIGNED NOT NULL,              -- 시가총액 내림차순 순위(1부터) — 목록 탭 칩 「자동 n위」
  market_cap     DECIMAL(24,2)     NULL,                  -- KIS 해외 현재가상세 tomv 원값(USD). 모르면 NULL
  computed_at    DATETIME          NOT NULL,              -- 이 행을 만든 산출 시각 — 「산출 12-01 02:40」은 최댓값
  PRIMARY KEY (symbol),
  KEY idx_auto_rank (rank_no),
  KEY idx_auto_computed (computed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='T-143 해외 자동 분석 대상(NYSE 시총 상위 N) — WP-A 가 채운다';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) 변경 확인 실행 기록 — 「마지막 확인 12-02 02:10 · 3곳 모두 확인했습니다」의 **유일한 근거**(가이드 §5.3).
--    `all_checked` 는 **잡이 단정한 값**이다 — 화면이 원천 수를 세어 「3곳 모두 확인」을 쓰지 않는다(§2.7).
--    이 값 없이 「모두 확인」을 쓰면 거짓이 되므로, 기록이 0건이면 화면은 빈 문구 대신 「아직 확인 기록이 없습니다」를 쓴다.
--    잡의 성공·실패 자체는 기존 `job_run_log`(T-112)가 남기고, 실패하면 홈 「데이터 이상」 줄로 올라온다(§3.4 ②).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS overseas_universe_watch (
  run_id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  checked_at        DATETIME       NOT NULL,              -- 확인을 끝낸 시각(KST) — 「마지막 확인」은 최댓값 행
  coverage          TEXT           NOT NULL,              -- 원천별 결과 JSON: [{"source":"us_filings","ok":true,"failedAt":null}, ...]
  all_checked       TINYINT(1)     NOT NULL DEFAULT 0,    -- 원천 3곳을 **다 읽었는가**. 1 일 때만 화면이 「3곳 모두 확인」을 쓴다
  proposals_created SMALLINT UNSIGNED NOT NULL DEFAULT 0, -- 이 회차에 새로 만든 제안 수(알림 1회 발송 판정의 짝 — 발송은 2차)
  KEY idx_watch_checked (checked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='T-143 해외 분석 대상 변경 확인 실행 기록(원천 3곳 커버리지)';
