-- T-084 — 안드로이드 앱 "주식캐기" 배포본 기록 (가산 전용: 새 테이블 1개. 기존 테이블·행 변경 없음)
--
-- app_release — deployer 가 APK 를 공개할 때 1행씩 적는 배포본 기록. 앱(웹 서버)은 이 테이블을 **읽기만** 한다.
--   - GET /api/app/version   (로그인 필요) : 최신 행(version_code 최댓값)을 앱 업데이트 띠에 알려 준다.
--   - GET /app/download/<f>  (공개)        : 등록된 apk_file 과 이름이 같고, 디스크 파일의 sha256 이 sha256 열과 같을 때만 내보낸다.
--     파일은 APP_RELEASE_DIR(기본 /home/brownjeon/apps/stockinvest/shared/app-releases) 바로 아래에 있어야 한다 — apk_file 은 **파일 이름만** 담는다.
--   - 쓰기(INSERT)는 deployer 가 **사람 승인 후** 직접 한다. 앱 코드에는 INSERT·UPDATE·DELETE 경로가 없다.
--   - 롤백(직전 배포본으로 되돌리기) = 최신 행 삭제. 그러면 그 아래 행이 다시 '최신'이 되고 업데이트 띠도 그쪽을 가리킨다.
--       DELETE FROM app_release WHERE version_code = <되돌릴 version_code>;
--     파일은 지우지 않아도 된다(행이 없으면 /app/download 는 404).
--
-- 열 설계 근거:
--   - version_code : 안드로이드 versionCode(정수). 비교는 이 정수로만 한다(문자열 버전 비교는 1.10.0 < 1.9.0 류 오판). UNIQUE.
--                    **1 이상 2100000000 이하**(chk_app_release_code) — 안드로이드 versionCode 최댓값이자 앱이 받아들이는 상한이다. 열 타입(INT UNSIGNED)만으로는
--                    4294967295 까지 들어가고, 그런 행이 최신이 되면 앱은 그 행을 무효로 보고 latest:null·latest.apk 404 가 된다(Codex C2 지적 → R4).
--                    min_supported 는 chk_app_release_min(min ≤ version_code)이 같은 상한 안에 가둔다.
--   - size_bytes   : APK 크기(바이트). **1 이상 9007199254740991(2^53-1) 이하**(chk_app_release_size) — 앱이 다루는 안전 정수 범위(Number.MAX_SAFE_INTEGER).
--                    이 두 상한은 src/lib/app-release/version.ts 의 MAX_VERSION_CODE·Number.MAX_SAFE_INTEGER 와 같아야 하며,
--                    version-paths.test.ts 가 SQL 텍스트와 코드 상수의 드리프트를 감시한다. (이미 만든 테이블에는 이 CHECK 가 자동 반영되지 않는다 —
--                    CREATE TABLE IF NOT EXISTS 는 기존 테이블을 건드리지 않으므로, 적용된 DB 에는 ALTER TABLE 로 따로 바꿔야 한다.)
--   - version_name : 사람이 읽는 버전. **정확히 x.y.z(각 1~4자리 숫자)** — 다운로드 이름 stockinvest-<version_name>.apk 의 근거라
--                    다운로드 라우트 정규식과 구성요소 수가 같아야 한다(정본: src/lib/app-release/version.ts VERSION_NAME_PATTERN, build-apk.sh 도 같은 문자열).
--   - apk_file     : 파일 이름만(경로 금지). 영숫자로 시작 + [A-Za-z0-9._-] + '.apk'. UNIQUE.
--                    경로 구분자(/ \)·공백·NUL·그 밖의 문자는 정규식 CHECK 가 거부하고, **끝 개행**은 별도 CHECK(chk_*_nl)가 거부한다 —
--                    MariaDB 정규식(PCRE)의 `$` 는 마지막 개행 바로 앞에서도 일치해서 'x.apk' + 개행 을 정규식만으로는 못 막는다(R1 실측).
--
-- 정규식·문자열 작성 규칙 — **백슬래시를 쓰지 않는다**: 점은 `[.]`, 개행은 CHAR(10). 그래서 세션 sql_mode 에 NO_BACKSLASH_ESCAPES 가
--   있어도 없어도 같은 제약이 만들어진다(운영 sql_mode 는 확인하지 못했다 — 일회용 MariaDB 에서 두 모드 모두 시험).
--   - sha256       : 소문자 hex 64자. 다운로드 라우트가 파일 내용과 대조한다.
--   - cert_sha256  : (선택) APK 서명 인증서 SHA-256 지문 — M2 assetlinks 와 대조용 기록. 앱 코드는 읽지 않는다.
--   - apk_file·sha256·cert_sha256 은 열 단위 CHARACTER SET ascii COLLATE ascii_bin 이다: 테이블 기본(utf8mb4_general_ci)은 대소문자를 무시해서
--     REGEXP CHECK 가 '.APK'·대문자 hex 를 통과시키고, UNIQUE 도 대소문자만 다른 이름을 같은 값으로 본다. 바이너리 비교로 정확히 한 가지 표기만 받는다.
--     (근거: 일회용 MariaDB 시험 src/lib/app-release/__tests__/t084-disposable-mariadb.test.ts)
--
-- ⚠ 이 파일은 **앱 부팅 때 실행되지 않는다**(src/lib/db.ts 의 setupDB 에 넣지 않았다 — T-059·T-070·T-072·T-074 선례). 개발·운영이 같은 NAS MariaDB 라서
--   배포만으로 DDL 이 돌면 "--with-migrate 는 사용자 승인" 원칙이 무력화되기 때문이다. Reviewer·QA 통과 뒤 **사용자 승인(2026-10-25 DB 관련 승인 — Leader 확인)** 하에 적용한다:
--     mysql -h <DB_HOST> -u <DB_USER> -p <DB_NAME> < scripts/migrations/T-084-app-release.sql
--   `CREATE TABLE IF NOT EXISTS` 라 두 번 실행해도 안전하다(멱등). MariaDB 10.2+ 의 CHECK·REGEXP(PCRE) 를 쓴다(운영 10.11.11).
--
-- 호환(양방향 무해):
--   - 구 코드 + 새 테이블: 읽는 코드 없음.
--   - 새 코드 + 테이블 없음: GET /api/app/version 은 503 `not_migrated`, /app/download/* 는 404(공개 경로라 내부 상태를 드러내지 않는다 — 서버 로그에만 남긴다).
--     다른 화면·주문·시그널·cron 경로는 이 테이블을 모른다.
--   - 테이블은 있고 행이 없음: version 은 `latest: null`, download 는 404.
--   → 순서는 자유. 행(INSERT)은 APK 파일을 APP_RELEASE_DIR 에 올리고 sha256 을 확인한 **뒤에** 넣는다.
--
-- 행 추가 예(deployer — 사람 승인 후. 값은 build-apk.sh 출력에서 옮긴다):
--   INSERT INTO app_release (version_code, version_name, apk_file, sha256, size_bytes, min_supported, notes, cert_sha256)
--   VALUES (1, '1.0.0', 'stockinvest-1.0.0.apk', '<sha256sum 소문자 64자>', <바이트 수>, 0, '첫 배포', '<서명 인증서 SHA-256 소문자 64자 또는 NULL>');
--
-- 적용 후 확인:
--   SHOW CREATE TABLE app_release;     -- PRIMARY, uq_app_release_code, uq_app_release_file, CHECK 9개
--   SELECT COUNT(*) FROM app_release;  -- 0 (행은 deployer 가 APK 공개 때 넣는다)

SET SESSION lock_wait_timeout = 5;

CREATE TABLE IF NOT EXISTS app_release (
  id            BIGINT          NOT NULL AUTO_INCREMENT,
  version_code  INT UNSIGNED    NOT NULL,                                   -- 안드로이드 versionCode (정수 비교의 유일한 기준)
  version_name  VARCHAR(32)     NOT NULL,                                   -- 사람이 읽는 버전 (예: 1.0.0)
  apk_file      VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, -- 파일 이름만 (APP_RELEASE_DIR 바로 아래)
  sha256        CHAR(64)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL, -- 파일 내용 SHA-256 (소문자 hex)
  size_bytes    BIGINT UNSIGNED NOT NULL,                                   -- 파일 크기(바이트)
  min_supported INT UNSIGNED    NOT NULL DEFAULT 0,                         -- 이 값보다 낮은 versionCode 앱은 필수 업데이트
  notes         VARCHAR(500)    NULL,                                       -- 변경 요약(업데이트 띠에 보일 수 있음 — 비밀 금지)
  cert_sha256   CHAR(64)     CHARACTER SET ascii COLLATE ascii_bin NULL,     -- 서명 인증서 SHA-256 지문(기록용)
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_app_release_code (version_code),
  UNIQUE KEY uq_app_release_file (apk_file),
  CONSTRAINT chk_app_release_code    CHECK (version_code > 0 AND version_code <= 2100000000),
  CONSTRAINT chk_app_release_name    CHECK (version_name REGEXP '^[0-9]{1,4}[.][0-9]{1,4}[.][0-9]{1,4}$'),
  CONSTRAINT chk_app_release_name_nl CHECK (INSTR(version_name, CHAR(10)) = 0),
  CONSTRAINT chk_app_release_file    CHECK (apk_file REGEXP '^[A-Za-z0-9][A-Za-z0-9._-]{0,123}[.]apk$'),
  CONSTRAINT chk_app_release_file_nl CHECK (INSTR(apk_file, CHAR(10)) = 0),
  CONSTRAINT chk_app_release_sha     CHECK (sha256 REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_app_release_size    CHECK (size_bytes > 0 AND size_bytes <= 9007199254740991),
  CONSTRAINT chk_app_release_min     CHECK (min_supported <= version_code),
  CONSTRAINT chk_app_release_cert    CHECK (cert_sha256 IS NULL OR cert_sha256 REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 되돌리기(테이블째 제거 — 앱 기능을 통째로 철회할 때만. 평소 롤백은 위의 '최신 행 삭제'):
-- DROP TABLE IF EXISTS app_release;
