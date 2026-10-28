-- T-116 — 기업정보 통합 단계 1b: 뉴스 최초 관측 증거 테이블 ci_raw_item 1개 (가산 전용: 기존 테이블 변경 없음)
--
-- ⚠ 이 파일은 **앱 부팅 때 실행되지 않는다**(src/lib/db.ts 의 setupDB 에 넣지 않았다). 개발·운영이 같은 NAS MariaDB 라서
--   배포만으로 DDL 이 돌면 "--with-migrate 는 사용자 승인" 원칙이 무력화되기 때문이다(T-059 와 같은 방식).
--   사용자 승인 후 사람이 직접 적용한다:
--     mysql -h <DB_HOST> -u <DB_USER> -p <DB_NAME> < scripts/migrations/T-116-ci-raw-item.sql
--   적용 직전 `SHOW TABLES LIKE 'ci_raw_item'` 로 없음을 확인하고(있으면 `SHOW CREATE TABLE ci_raw_item` 을 아래 정의와 대조),
--   적용 직후 `SHOW CREATE TABLE ci_raw_item` 을 task 이력서에 남긴다. CREATE TABLE IF NOT EXISTS 라 두 번 실행해도 안전하다.
--   되돌리기: 맨 아래 주석의 DROP 1줄(쌓인 증거 데이터 함께 삭제 — 되살릴 수 없다. 먼저 스위치 ci_capture_enabled 를 끄는 것이 롤백이다).
--   적용 전에는 캡처 코드(src/lib/corp-intel/raw-capture.ts)가 ER_NO_SUCH_TABLE 을 받아 `skipped_no_table` 로 건너뛰고(프로세스당 경고 1회),
--   뉴스 수집·분석·T-106 감시 동작은 그대로다. 스위치 system_config.ci_capture_enabled 가 없거나 true 가 아니면 이 테이블에 아무것도 쓰지 않는다.
--
-- 정본: docs/design/2026-10-28-corporate-intelligence-second-design.md §5(스키마 초안)·§6.1(전달 경로)·§6.2(멱등 키).
--   §5 초안과 다른 점은 하나 — `guid VARCHAR(300) NULL` 열을 url 바로 뒤에 더했다(T-116 Leader 결정 Q1, 2026-10-28). 이 task 의 목적이
--   "링크·GUID·제목·발행시각·피드·처음 본 시각" 보존인데 초안에는 GUID 를 담을 열이 없어 source_key 해시에만 들어가고 원문은 되살릴 수
--   없었다(링크가 없거나 검증에서 버려진 항목). 적용 뒤 ALTER 를 피하려고 첫 적용에 넣는다. 앱은 M4 가 준 guid 를 검증(300자 이하·
--   제어/서식 문자 없음)한 뒤 원문 그대로 저장하고, 링크를 버려도 guid 는 저장한다.
-- 시각 규칙(T-046·T-059 재발 방지): DB·앱 풀 모두 KST. *_at DATETIME 은 KST 벽시계(앱이 toKstDatetime 문자열로 바인딩).
--   published_at = M4 가 준 ISO UTC 발행시각을 KST 로 바꾼 값(해석 못 하면 NULL — 시각을 지어내지 않는다).
--   first_seen_at = 우리가 이 항목을 처음 본 시각 — 앱은 INSERT … ON DUPLICATE KEY UPDATE last_seen_at 만 하므로 **덮어쓰지 않는다**.
-- 외래키 없음: ci_* 는 us_*·거래 테이블(orders·signals 등)에 외래키를 걸지 않는다(쓰기 경합·잠금 전파 방지, 설계서 §5).
--   run_id 는 공유 job_run_log(아직 없음, 설계서 §9.5)를 가리킬 자리 — 지금은 항상 NULL, 외래키 없음.
-- source_kind 의 'rss' 외 값(sec_filing·sec_exhibit·kis_snapshot·earnings_calendar)은 후속 단계용 자리다 — T-116 은 'rss' 만 쓴다.

CREATE TABLE IF NOT EXISTS ci_raw_item (
  raw_id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_kind    ENUM('rss','sec_filing','sec_exhibit','kis_snapshot','earnings_calendar') NOT NULL,
  source_key     VARCHAR(190) NOT NULL,       -- rss: sha256 16진(keys.ts rssSourceKey — feed_host·guid 또는 link·title·발행시각)
  version        INT NOT NULL DEFAULT 1,      -- 내용 해시가 바뀌면 +1 (정정·재게시) — T-116 은 항상 1
  content_sha256 CHAR(64) NOT NULL,
  availability   ENUM('captured','historical_import','reconstructed') NOT NULL,   -- T-116 은 항상 'captured'
  published_at   DATETIME NULL,
  first_seen_at  DATETIME NOT NULL,
  last_seen_at   DATETIME NOT NULL,
  url            VARCHAR(512) NULL,           -- 신뢰할 수 없는 외부 데이터 — 저장만 한다(이 앱은 이 링크로 요청을 보내지 않는다)
  guid           VARCHAR(300) NULL,           -- RSS <guid> 원문(검증 통과분만, 없으면 NULL) — §5 초안에 없던 열(Leader 결정 Q1)
  feed_host      VARCHAR(120) NULL,
  publisher      VARCHAR(80)  NULL,
  title          VARCHAR(400) NULL,
  snippet        TEXT NULL,                   -- 허용된 짧은 발췌만 (T-116 은 쓰지 않음)
  payload_ref    VARCHAR(190) NULL,           -- 본문 보관 위치(허용된 원천만, T-116 은 쓰지 않음)
  parser_version VARCHAR(24) NOT NULL,
  run_id         BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_item_version (source_kind, source_key, version),
  KEY idx_first_seen (first_seen_at),
  KEY idx_published (published_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 되돌리기(쌓인 증거 데이터 함께 삭제 — 사용자 승인 사항, 되살릴 수 없음):
-- DROP TABLE IF EXISTS ci_raw_item;
