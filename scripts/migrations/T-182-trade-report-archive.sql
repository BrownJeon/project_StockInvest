-- T-182: 거래 리포트 원문 보관 테이블. 명시 적용 전용 — 앱 부팅(ensureSetup) 때 실행하지 않는다.
-- 운영 적용은 사용자 승인 사항이다(deployer --with-migrate 또는 수동).
-- 기존 테이블·행은 바꾸지 않는다(추가 전용). 롤백 = 이 테이블 DROP(앱은 테이블이 없으면 버튼 없는 요약으로 계속 발송한다).
--
-- *_at 컬럼은 기존 관례대로 KST 벽시계 값이다(mysql2 pool timezone '+09:00' 이 Date 를 KST 로 바인딩·해석).
-- 보관 기간 1년: 크론이 발송 성공 뒤 `sent_at < NOW() - 365일` 행을 한 번에 최대 500행씩 지운다.
--
-- 컬럼
--   sent_at      발송(=분석 기간 끝) 시각
--   range_start  분석 기간 시작
--   range_end    분석 기간 끝
--   is_test      1 = force=1 시험 발송(화면 목록·회차 이동에서 제외)
--   delivered    1 = 텔레그램/슬랙 중 1곳 이상 전달 성공(0 이면 목록에서 제외)
--   summary_text 실제로 보낸 요약(평문)
--   full_text    기존 형식 전문(formatReportMessage) — 보존용
--   payload      화면 렌더용 구조화 데이터(JSON, schemaVersion 1 — src/lib/reports/trade-report-view.ts)

CREATE TABLE IF NOT EXISTS trade_report_archive (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sent_at DATETIME(3) NOT NULL,
  range_start DATETIME(3) NOT NULL,
  range_end DATETIME(3) NOT NULL,
  is_test TINYINT(1) NOT NULL DEFAULT 0,
  delivered TINYINT(1) NOT NULL DEFAULT 0,
  summary_text MEDIUMTEXT NOT NULL,
  full_text MEDIUMTEXT NOT NULL,
  payload LONGTEXT NOT NULL CHECK (JSON_VALID(payload)),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_trade_report_list (is_test, delivered, sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
