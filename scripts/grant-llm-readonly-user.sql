-- home-m4-api 서버용 read-only DB 사용자 생성
--
-- 목적: Phase 3 RAG 인덱싱·Phase 2 학습 데이터 export 시
--       home-m4-api 서버가 StockInvest DB를 읽기 전용으로 직접 접근.
--       기존 stockinvest_user는 ALL PRIVILEGES (DDL 포함) → 외부 서버에 노출 시 위험.
--
-- 실행 위치: NAS MariaDB root 또는 admin 권한 계정
--   mysql -h 192.168.219.154 -u root -p < scripts/grant-llm-readonly-user.sql
--
-- 권장 비밀번호: 운영자가 강력 비번 생성 (예: openssl rand -base64 24)
-- 생성된 비번은 home-m4-api 서버의 .env에 STOCKINVEST_DB_RO_PWD로 저장
-- (StockInvest 프로젝트와 분리 — 양쪽이 서로의 비번을 모름)
--
-- 보안 강화 (선택):
--   - 호스트 한정: 'stockinvest_ro'@'192.168.0.0/255.255.255.0' (LAN만)
--   - SSL 강제: REQUIRE SSL 추가
--   - 만료일 설정: PASSWORD EXPIRE INTERVAL 90 DAY

-- 1) read-only 사용자 생성 (PLACEHOLDER → 운영 시 강력 비번으로 교체)
CREATE USER IF NOT EXISTS 'stockinvest_ro'@'%'
  IDENTIFIED BY 'CHANGE_ME_TO_STRONG_PASSWORD';

-- 2) SELECT 권한만 부여 — INSERT/UPDATE/DELETE/DDL 전부 차단
GRANT SELECT ON stockinvest.* TO 'stockinvest_ro'@'%';

-- 3) (선택) JSON_EXTRACT 등 함수 사용 권한 — SELECT에 포함됨 (별도 grant 불필요)

-- 4) 반영
FLUSH PRIVILEGES;

-- 5) 검증 출력
SHOW GRANTS FOR 'stockinvest_ro'@'%';

-- ─────────────────────────────────────────────────────────────────
-- 비번 변경 시:
--   ALTER USER 'stockinvest_ro'@'%' IDENTIFIED BY '<new_password>';
--   FLUSH PRIVILEGES;
--
-- 사용자 제거 시:
--   DROP USER 'stockinvest_ro'@'%';
--
-- 호스트 한정으로 보안 강화:
--   1. 위 'stockinvest_ro'@'%'를 DROP
--   2. CREATE USER 'stockinvest_ro'@'192.168.219.%' IDENTIFIED BY '...';
--      (LAN 서브넷만 허용)
-- ─────────────────────────────────────────────────────────────────
