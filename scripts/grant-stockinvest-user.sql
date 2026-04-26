-- StockInvest 전용 DB 사용자 생성 + 권한 부여
-- 실행 위치: NAS MariaDB root 또는 admin 권한 계정
--
-- 실행 예:
--   mysql -h 192.168.219.154 -u root -p < scripts/grant-stockinvest-user.sql
--
-- 비밀번호: 아래 PLACEHOLDER를 .env의 DB_PWD와 동일한 값으로 교체 후 실행
--           (또는 운영자가 임의 강력 비번 사용 후 .env에 반영)

-- 1) DB 보장 (이미 있으면 skip)
CREATE DATABASE IF NOT EXISTS stockinvest
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 2) 사용자 생성 (외부 접속 허용 — Synology 정책에 따라 IP 한정 가능)
CREATE USER IF NOT EXISTS 'stockinvest_user'@'%'
  IDENTIFIED BY 'rOsKYF_DyDcbz42';

-- 3) stockinvest DB 전체 권한 (DDL 포함 — db.ts ensureSetup이 ALTER·CREATE·INDEX 수행)
GRANT ALL PRIVILEGES ON stockinvest.* TO 'stockinvest_user'@'%';

-- 4) 반영
FLUSH PRIVILEGES;

-- 5) 검증 출력
SHOW GRANTS FOR 'stockinvest_user'@'%';
