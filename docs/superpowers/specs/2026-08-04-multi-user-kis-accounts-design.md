# 회원별 KIS 계좌 — 멀티테넌트 전환 설계

- 작성일: 2026-08-04
- 상태: 승인됨 (사용자 승인 완료, 구현 대기)

## 배경·동기

StockInvest는 지금까지 `AUTH_PIN` 하나로 접근을 통제하는 1인 홈서버 전제 앱이었다. 매매·안전장치·DB 스키마 전부가 "`.env`에 등록된 KIS 계좌 1개"를 암묵적으로 가정한다.

이번 변경의 목적: **가족·지인 등 소규모(2~10명)가 각자 자신의 KIS 브로커리지 계좌로 이 앱을 함께 쓸 수 있게 한다.** 로그인 방식을 PIN에서 이메일 회원가입/로그인으로 바꾸는 것이 출발점이지만, 실제로는 회원가입 시점부터 각 계정이 자기 자신의 KIS API 키로 매매하는 것이 목표이므로 인증 계층뿐 아니라 매매 엔진·DB·안전장치 전반의 멀티테넌트 전환이 필요하다.

## 범위

**포함**:
- 이메일 회원가입(비밀번호 + KIS API 키 동시 입력, 가입 시 KIS 실제 토큰 발급으로 키 검증) / 로그인 / 프로필에서 비밀번호·KIS 키 수정
- 회원별 KIS 자격증명 암호화 저장 + 회원별 KIS 토큰 캐시
- 매매 엔진(strategy-eval·exit-engine 등 전 cron)의 회원별 순회 실행
- 안전장치(Kill Switch·DRY_RUN·주문한도)의 회원별 분리
- 거래 관련 DB 테이블 전체에 `user_id` 스코핑
- API 라우트의 로그인 회원 기준 데이터 필터링
- 기존 `.env` 계좌 거래 기록의 첫 가입자 귀속

**명시적으로 범위 밖 (향후 별도 작업)**:
- 이메일 인증(확인 메일 발송) — 스키마만 준비(`email_verified` 컬럼), 실제 발송 인프라는 미구현
- 회원별 전략 커스터마이징(어떤 전략을 쓸지) — 전략 룰셋은 전 회원 공통
- 회원별 종목 유니버스(관심종목은 있으나 전략 후보 산정 유니버스는 공통 계산)
- cron 병렬 처리 — 소규모(2~10명) 전제로 순차 처리, 병렬화·큐 인프라 불필요
- 관리자 승인제 가입 — KIS 키 실검증이 사실상의 가입 제한 역할
- KIS 암호화 키 로테이션

## 데이터 모델

### `users` (신규)

```sql
CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,          -- scrypt (형식: scrypt$<saltHex>$<hashHex>)
  kis_app_key_enc TEXT NOT NULL,                 -- AES-256-GCM 암호화
  kis_app_secret_enc TEXT NOT NULL,               -- AES-256-GCM 암호화
  kis_account_no_enc TEXT NOT NULL,               -- AES-256-GCM 암호화
  kis_account_product VARCHAR(4) NOT NULL DEFAULT '01',
  kis_mock TINYINT(1) NOT NULL DEFAULT 1,         -- 1=모의투자, 0=실전투자
  kis_access_token TEXT NULL,                     -- 회원별 토큰 캐시 (평문 — 만료 짧아 암호화 불필요, 기존 관례와 동일)
  kis_access_token_expires_at DATETIME NULL,
  email_verified TINYINT(1) NOT NULL DEFAULT 0,   -- 향후 이메일 인증용, 현재 미사용
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### `user_settings` (신규 — 회원별 안전장치)

`system_config`과 동일한 key-value 패턴이지만 `user_id`로 스코핑된다.

```sql
CREATE TABLE IF NOT EXISTS user_settings (
  id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  `key` VARCHAR(64) NOT NULL,
  value TEXT NOT NULL,                            -- system_config과 동일: JSON 문자열 규약
  UNIQUE KEY uq_user_key (user_id, `key`),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

키: `dry_run`, `kill_switch`, `order_max_pct`, `daily_order_max_pct`. 가입 시 4개 키를 모두 시드한다: **`dry_run=true`**(모의 매매 — 이 프로젝트의 기존 원칙 "DRY_RUN → 소액 실매매 → 자동화" 단계적 도입을 회원별로도 그대로 적용, 회원이 프로필에서 명시적으로 해제해야 실거래 전환), `kill_switch=false`, `order_max_pct=5`, `daily_order_max_pct=10`(Phase 0가 정한 기존 전역 기본값과 동일 — dry_run이 실거래를 이미 막고 있으므로 나머지 값은 "모의 매매 체험이 곧바로 되게" 하는 목적. 미시드 상태를 절대 만들지 않는다 — order-limits.ts의 fail-safe 원칙(미설정 시 0=거부)은 유지하되, 신규 가입 시점에 반드시 위 4개 값을 INSERT한다).

`safety_blocked_symbols`류(시장 전체 차단 종목)는 회원과 무관하므로 기존 `system_config`에 유지.

### 기존 테이블에 `user_id` 추가

`orders`, `signals`, `executions`, `trade_logs`, `position_state`, `portfolio_snapshots`, `eval_funnel`, `stock_favorites`, `trade_notes`, `trade_journals`, `trade_journal_entries`, `chat_threads`, `chat_messages`.

각 테이블: `user_id INT UNSIGNED NOT NULL` + 인덱스. 기존 행은 마이그레이션 시 첫 가입자 id로 일괄 UPDATE.

### 공유 유지 (변경 없음)

`strategies`, `symbol_universe`, `stock_meta`, `stock_fundamentals`, `stock_chart_analysis`, `backtests`, `system_config`(시장 전체 설정만).

## 인증 계층

### 비밀번호·암호화 (신규 의존성 없음)

이 프로젝트는 과거 SWC 네이티브 바이너리가 Windows/Linux 공유 마운트에서 깨진 전례가 있어(RESUME.md), 네이티브 바인딩 패키지(bcrypt, argon2)를 피하고 Node 내장 `crypto`만 사용한다.

- 비밀번호: `crypto.scrypt` (OWASP 인정 KDF), 검증은 `crypto.timingSafeEqual`
- KIS 자격증명: AES-256-GCM, 키는 신규 env `CREDENTIALS_ENCRYPTION_KEY`(32바이트, base64). 이 키를 분실/교체하면 저장된 KIS 키 전부 복호화 불가 — 재입력 필요(로테이션 절차는 범위 밖).

### 세션

기존 HMAC 서명 쿠키(Edge Runtime 호환, Web Crypto)를 그대로 쓰되:
- payload `sub`: 고정 문자열 `"owner"` → 회원 `id`(숫자)
- 서명 키: `AUTH_PIN` → 신규 전용 env `AUTH_SESSION_SECRET`로 분리(기존 "PIN이 서명 키를 겸함" 문제가 자연 해소됨 — RESUME.md 개선 메모 항목)
- 포맷이 바뀌므로(sub 타입 변경) 기존 세션 쿠키는 전부 무효 — 배포 후 재로그인 필요(예상된 동작)

`AUTH_PIN`은 완전히 제거, `.env.example`에서 deprecated 표기. Middleware의 "미설정 시 전면 차단(fail-closed)" 원칙은 `AUTH_SESSION_SECRET` 기준으로 동일하게 유지.

### 로그인 시도 제한

`login-gate.ts`는 현재 프로세스 전역 카운터 1개(1인 PIN 시절 설계) — 회원이 여럿이면 한 명의 실패가 전원을 잠근다. **이메일(정규화: lowercase+trim) 기준 `Map<string, GateState>`**로 전환. 정책(5회 자유시도, 이후 지수 백오프 1분→최대 1시간)은 동일하게 유지.

### 가입 검증

1. 이메일 형식·중복(UNIQUE 제약과 사전 조회), 비밀번호 8자 이상
2. 입력된 KIS 키로 `POST {kisBaseUrl}/oauth2/tokenP` 실제 토큰 발급 시도(`kis-auth.ts`의 기존 로직 재사용, `kis_mock` 토글로 base URL 결정) — 실패 시 가입 거부
3. 성공 시 비밀번호 scrypt 해싱 + KIS 키 AES-GCM 암호화 후 `users` INSERT, `user_settings`에 `dry_run=true` 기본값 시드, 세션 발급(자동 로그인)

## KIS 클라이언트 리팩터

`kis-auth.ts`/`kis-domestic.ts`/`kis-overseas.ts`/`kis.ts`가 현재 `.env`/`getCredential()`을 전역으로 읽는다(30개 파일이 `kis` 객체를 직접 import). 모든 함수가 **회원의 복호화된 자격증명을 명시적 파라미터로 받도록** 변경한다. 토큰 캐시도 `system_config.kis_access_token`(전역 1개) 대신 `users.kis_access_token`(회원별)을 사용한다.

이 리팩터는 함수 시그니처 변경이 핵심이라 호출부 30곳 전부 영향을 받지만, **동작 자체는 바뀌지 않는(순수 리팩터) 단계로 분리**해 위험을 낮춘다(아래 구현 순서 참조).

## 엔진·cron 구조

`runMarket`/`runAll`/`runExitEngine`/모든 cron 라우트(strategy-eval, portfolio-snapshot, rs-update, trade-report, post-market-analysis 등)가 현재 "계좌 1개, 1회 실행"을 전제한다. **활성 회원 목록을 순회하며 회원마다 완전히 독립적으로 실행**하도록 바뀐다:

```ts
for (const user of activeUsers) {
  await runMarketForUser(user, market);  // 그 회원의 KIS 키·user_settings 안전장치로 독립 실행
}
```

소규모(2~10명) 전제로 순차 처리. 회원 간 실패는 격리(한 회원의 KIS API 오류가 다른 회원 실행을 막지 않음 — try/catch로 회원 단위 격리).

## API 라우트

대시보드·주문·시그널·포지션·즐겨찾기·메모·일지·채팅 등 전 API가 세션에서 얻은 로그인 회원 `id` 기준으로 `WHERE user_id = ?`를 추가한다.

## 기존 데이터 마이그레이션

`.env` 계좌로 이미 쌓인 거래 기록(orders·signals·position_state·portfolio_snapshots 등)은 **첫 가입자에게 일괄 귀속**(UPDATE ... SET user_id = <첫 가입자 id> WHERE user_id IS NULL, 컬럼 추가 후 1회성 처리).

## 구현 순서 (단계별 검증)

실거래 앱이므로 한 번에 전체를 바꾸지 않는다. 각 단계는 그 자체로 빌드·테스트 통과 + (필요시) 배포·라이브 확인이 가능해야 다음 단계로 넘어간다.

1. **인증 기반** — `users`/`user_settings` 테이블(스키마만), 회원가입(KIS 키 검증 포함)·로그인·프로필 UI+API, 세션 모델 교체(`AUTH_SESSION_SECRET`), `login-gate.ts` 이메일별 전환, middleware `/signup` 공개 경로 추가. **이 시점까지 매매는 여전히 기존 `.env` 계좌로 무변경 동작** — 회귀 위험 없음.
2. **KIS 클라이언트 파라미터화** — `kis-auth.ts` 등 함수 시그니처를 자격증명 파라미터 받도록 리팩터. 순수 리팩터(동작 불변) — 이 시점엔 여전히 단일 계좌(마이그레이션 전 임시로 `.env` 값 또는 첫 가입자 키를 하드코딩 경유)로 호출. 테스트로 무결성 검증.
3. **DB `user_id` 마이그레이션** — 전 테이블 컬럼 추가 + 기존 데이터 첫 가입자 귀속.
4. **엔진·cron 멀티테넌트 전환** — 실제 회원별 반복 실행 시작. **가장 위험한 단계** — 회원별 격리(한 명 실패가 전체를 막지 않음), 회원별 안전장치(`user_settings`) 배선, 신규 회원 기본 `dry_run=true` 확인을 중점 검증.
5. **API 라우트 회원별 스코핑** — 대시보드 등 화면단 마무리.

## 테스트 전략

- 단계 1: users/user_settings CRUD, 비밀번호 scrypt 해시·검증 왕복, AES-GCM 암복호화 왕복, login-gate 이메일별 격리, KIS 검증 호출은 mock으로 성공/실패 케이스
- 단계 2: kis-auth 등 리팩터 전후 동일 동작 회귀 테스트(기존 테스트 스위트가 캐치해야 함)
- 단계 3: 마이그레이션 스크립트를 스테이징 데이터로 사전 검증(가능하면), UPDATE 결과 행 수 확인
- 단계 4: 회원 A 실패가 회원 B 실행에 영향 없음을 검증하는 격리 테스트, 신규 회원 기본 dry_run=true 검증
- 단계 5: 회원 A가 회원 B의 데이터를 조회할 수 없음을 검증하는 API 테스트(가장 중요 — 데이터 격리 실패는 심각한 정보 노출)

## 열린 리스크

- **KIS API 종당 거래건수 제한**: 회원마다 별도 앱키이므로 회원 간 rate limit은 분리되지만(오히려 개선), 같은 회원이 여러 요청을 동시에 보내는 경우의 기존 "1분 내 재발급 불가" 제약은 회원별로 여전히 적용됨.
- **`CREDENTIALS_ENCRYPTION_KEY` 분실 시** 전 회원 KIS 키 재입력 필요 — 백업·보관 절차는 이 설계 밖(운영 문서화 필요).
- 4번 단계(엔진 멀티테넌트 전환)는 규모상 여러 세션에 걸쳐 진행될 가능성이 높음 — 세션 경계에서 agent-vault에 정확한 중단 지점을 남길 것.
