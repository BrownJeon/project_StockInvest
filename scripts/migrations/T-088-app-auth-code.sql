-- T-088 — 앱 "주식캐기" Google 로그인용 1회용 코드 (가산 전용: 새 테이블 1개. 기존 테이블·행 변경 없음)
--
-- app_auth_code — 앱 흐름의 OAuth 콜백이 세션 대신 발급하는 60초·1회용 코드의 **결속값**을 담는다(src/lib/auth/oauth/app-code.ts).
--   - 발급  : GET /api/auth/google/callback (서명된 state 에 앱 표지가 있고 기존 회원일 때만)
--             INSERT INTO app_auth_code (code, user_id, expires_at) VALUES (?, ?, NOW(3) + INTERVAL 60 SECOND)
--             딥링크 stockinvest://auth/callback?code=<code_r> 에는 랜덤 code_r(64 hex)만 싣고, 이 표의 code 열에는
--             sha256hex(code_r + ':' + PKCE challenge) 를 넣는다 — code_r·verifier 는 DB 에 없다(DB 가 새도 되돌릴 수 없다).
--   - 소각  : POST /api/auth/app-exchange — 조건부 UPDATE 한 방, 영향 행이 정확히 1 일 때만 세션 발급
--             UPDATE app_auth_code SET used_at = NOW(3) WHERE code = ? AND used_at IS NULL AND expires_at > NOW(3)
--   - 청소  : 발급 때마다 DELETE … WHERE expires_at < NOW(3) - INTERVAL 3600 SECOND (만료 + 1시간 지난 행)
--   시각은 DB 시계(NOW(3)) 하나만 쓴다 — 앱 서버 시계·풀 timezone 과 무관하게 TTL 이 지켜진다.
--
-- 열 설계 근거:
--   - code       : 결속 sha256 소문자 hex 64자. UNIQUE(조회 키). 열 단위 CHARACTER SET ascii COLLATE ascii_bin —
--                  테이블 기본(utf8mb4_general_ci)은 대소문자를 무시해 REGEXP CHECK 가 대문자 hex 를 통과시키고 UNIQUE 도 대소문자만 다른 값을 같게 본다.
--                  CHAR(64) 는 64자를 넘는 끝 공백류(개행 포함)를 조용히 잘라 저장한다(T-084 R2 관찰과 같음) — 저장값은 언제나 CHECK 를 통과한 64 hex 라 무해하다.
--   - user_id    : users.id 와 같은 타입 INT UNSIGNED — users.id int(10) unsigned(src/lib/db.ts CREATE TABLE users ·
--                  T-074-cash-flow-ledger.sql 머리 주석의 운영 SHOW CREATE TABLE 실측). FK 는 두지 않는다(수명 1시간짜리 행이고,
--                  교환 라우트가 소각 뒤 users 를 다시 조회해 없으면 실패로 수렴한다).
--   - expires_at : 발급 시각 + 60초. **CHECK(chk_app_auth_code_ttl)가 created_at 뒤 10분 이내로 상한**을 건다 — 코드 버그·손으로 쓴 INSERT 로
--                  긴 수명의 코드가 생기지 않게(앱 TTL 60초는 src/lib/auth/oauth/app-code.ts APP_AUTH_CODE_TTL_SEC).
--   - used_at    : 소각 시각. NULL = 아직 안 씀.
--
-- 작성 규칙 — **백슬래시를 쓰지 않는다**(T-084 관례): 세션 sql_mode 에 NO_BACKSLASH_ESCAPES 가 있어도 없어도 같은 제약이 만들어진다.
--   정규식은 '^[0-9a-f]{64}$' 하나뿐이고 ascii_bin 열이라 대소문자를 구분한다. (운영 sql_mode 는 확인하지 못했다 — 일회용 MariaDB 에서 두 모드 모두 시험:
--   src/lib/auth/__tests__/t088-disposable-mariadb.test.ts)
--
-- ⚠ 이 파일은 **앱 부팅 때 실행되지 않는다**(src/lib/db.ts setupDB 에 넣지 않았다 — T-059·T-070·T-072·T-074·T-084 선례). 개발·운영이 같은 NAS MariaDB 라
--   배포만으로 DDL 이 돌면 "--with-migrate 는 사용자 승인" 원칙이 무력화되기 때문이다. Reviewer·QA 통과 뒤 **사용자 별도 명시 승인** 하에 적용한다
--   (T-084 의 "DB 관련 승인"은 이 적용의 승인이 아니다 — T-088 Leader 방침 5):
--     mysql -h <DB_HOST> -u <DB_USER> -p <DB_NAME> < scripts/migrations/T-088-app-auth-code.sql
--   `CREATE TABLE IF NOT EXISTS` 라 두 번 실행해도 안전하다(멱등). MariaDB 10.2+ 의 CHECK·REGEXP(PCRE) 를 쓴다(운영 10.11.11).
--
-- 호환(양방향 무해):
--   - 구 코드 + 새 테이블: 읽는 코드 없음.
--   - 새 코드 + 테이블 없음: **앱 로그인만** 실패한다 — 콜백이 앱 딥링크로 error=not_configured 를 돌려주고(서버 로그에 "테이블 없음"),
--     교환은 400 app_code_invalid. 웹 로그인(이메일·Google·GitHub)·주문·시그널·cron 은 이 테이블을 모른다.
--   → 순서는 자유지만, 앱 1.0.1 을 공개하기 전에 적용해야 앱 로그인이 된다.
--
-- 적용 후 확인:
--   SHOW CREATE TABLE app_auth_code;     -- PRIMARY, uq_app_auth_code_code(UNIQUE), idx_app_auth_code_expires, CHECK 4개(chk_app_auth_code_*), code 열 ascii_bin
--   SELECT COUNT(*) FROM app_auth_code;  -- 0 (행은 앱 로그인 때 생기고 1시간 뒤 청소된다)

SET SESSION lock_wait_timeout = 5;

CREATE TABLE IF NOT EXISTS app_auth_code (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  code        CHAR(64)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL, -- sha256hex(code_r + ':' + challenge) — 딥링크 값이 아니다
  user_id     INT UNSIGNED NOT NULL,                                       -- users.id (FK 없음)
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at  DATETIME(3)  NOT NULL,                                       -- 발급 + 60초 (DB 시계)
  used_at     DATETIME(3)  NULL,                                           -- 소각 시각, NULL = 미사용
  PRIMARY KEY (id),
  UNIQUE KEY uq_app_auth_code_code (code),
  KEY idx_app_auth_code_expires (expires_at),
  CONSTRAINT chk_app_auth_code_code CHECK (code REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_app_auth_code_user CHECK (user_id > 0),
  CONSTRAINT chk_app_auth_code_ttl  CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL 10 MINUTE),
  CONSTRAINT chk_app_auth_code_used CHECK (used_at IS NULL OR used_at >= created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 되돌리기(테이블째 제거 — 앱 로그인 기능을 철회할 때만. 남은 행은 1시간짜리 1회용 코드뿐이라 잃는 것이 없다):
-- DROP TABLE IF EXISTS app_auth_code;
