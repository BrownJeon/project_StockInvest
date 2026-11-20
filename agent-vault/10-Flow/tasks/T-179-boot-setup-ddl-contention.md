---
task_id: T-179
title: 앱 시작 시 DB 준비(setupDB) 지연 — 한 프로세스에서 여러 벌 동시 실행·매번 도는 ALTER 로 인한 잠금 대기 해소
status: done
priority: high
project: StockInvest
created: 2026-11-20
updated: 2026-11-20
base_ref: 2a3ae448e72259c4f0577fb89e587702d339096e
branch: t179-boot-setup-ddl
pr: https://git.xn--lh0b87pnudm10a4vd.com/brownjeon/project_StockInvest/pulls/3
risk_level: R2
roles_involved: [leader, developer, reviewer, qa, deployer]
related_tasks: [T-177-cron-runner-deploy-connect-fail, T-175-outbound-connect-timeout-and-alert-retry, T-156-us-stock-entry-exit-forecast-design]
tags:
  - type/task
  - domain/db
  - domain/deploy
aliases:
  - 시작 시 DB 준비 지연
  - setupDB 잠금 대기
execution_context:
  schema_version: 1
  origin_tool: claude
  current_tool: claude
  current_procedure: claude_standard
  current_scope: 원인 확인·설계부터 구현·감사·QA·PR 생성까지. main 머지(=운영 배포)는 PR 검토 후 사용자 승인
  last_event_id: E4
---

# T-179 앱 시작 시 DB 준비(setupDB) 지연 해소

작업 worktree: 서버 `~/.node-local/stockinvest-t179` (브랜치 `t179-boot-setup-ddl`, base `2a3ae44` = origin/main = 운영 릴리스 `20261120-105307-2a3ae448`). `node_modules` 는 t177 worktree 로의 심볼릭 링크 — **스테이징하지 않는다.** 커밋은 이 worktree(서버)에서 한다(`commit-msg` 훅 — `src/lib/db.ts`·`src/lib/db/bootstrap-presence.ts`·`src/instrumentation.ts` 는 SAFETY_PATHS). **이번 task 는 PR 로 관리한다**(사용자 지시 2026-11-20): 브랜치 push → Gitea PR → 검토 → 사용자 승인 후 머지.

## 목표·배경 (Leader)

2026-11-20 10:42 문서만 바뀐 커밋(`2a3ae44`) 배포가 헬스체크(120초) 실패로 자동 롤백됐다. 새 릴리스 시작 중 `setupDB()` 가 끝나지 않아 `/api/health` 가 응답하지 못했다(`health_setup_wait` 가 이를 기다림). 10:53 재배포는 통과했지만 DB 준비에 79.6초가 걸렸다(제한까지 40초 여유).

### 확인한 사실 (Leader, 2026-11-20 서버 실측)

- 운영 `pm2-out.log` boot-diagnostics(11-08~11-20): `ensure_setup complete` 평시 13~26초, 11-20 은 70~124초.
- 느린 문장(≥5초만 기록, 실패는 항상 기록): ordinal 9 `ALTER` n=33 median 7.8초 max 30.2초 · ordinal 8 `CREATE` max 21.0초 · ordinal 259/260/270 `ALTER` 6~10초 · ordinal 57 `CREATE` 5.1초.
- **매번 실패로 끝나는 문장**도 4~9초씩 걸린다: ordinal 10·61·62·65 `ALTER`, 63·66 `CREATE` — 각 36회(`error_code` OTHER). 실패하는 문장까지 오래 기다린다 = 테이블 메타데이터 잠금(MDL) 대기 [가능성 높음].
- **한 프로세스에서 setupDB 가 여러 벌 동시에 돈다**: 웹 프로세스는 1개(`instances: 1`)인데 배포마다 `ensure_setup start` 가 약 3회(예 11-20 10:43 3회·10:45 2회·10:46 1회), 같은 ordinal 이 두 번씩 complete 된다(10:53:58·10:54:25 ordinal 9). `pool`·`setupPromise` 가 `src/lib/db.ts` 모듈 변수라 Next 의 번들 단위(instrumentation·라우트 청크)마다 따로 생기는 것으로 본다 [가능성 높음 — Developer 가 코드·빌드 산출물로 확정]. 결과: 같은 DDL 묶음(약 70문장, ALTER 포함)이 같은 테이블에 동시에 나가 서로의 MDL 을 기다린다. 풀도 번들마다 따로(각 connectionLimit 10) 생길 수 있다.
- 시작 이후에는 다시 돌지 않는다(배포 시각에만 몰려 있음).
- 운영 DB(NAS MariaDB 10.11, 15개 앱 공유): `lock_wait_timeout`=86400(MDL 대기 상한 하루), `innodb_lock_wait_timeout`=50, `innodb_flush_log_at_trx_commit`=1, `sync_binlog`=1.
- 조건 없이 매번 도는 ALTER 가 있다: `strategies MODIFY COLUMN backtest_interval_h …`(db.ts ~301), `ALTER TABLE strategies …`(~308), `users MODIFY COLUMN password_hash …`(~1729) 등. 일부는 T-156 의 `bootstrap-presence.ts` 로 이미 존재 확인 후 건너뛴다(signals·orders·symbol_universe 의 일부 컬럼·인덱스만).
- 관련 맥락: 11-20 조사에서 공유 DB 가 수 초씩 멈추는 순간이 있고(디스크 동기화 초당 1~4회), 기록 쓰기 시간 초과(job-run-log 503)가 매일 난다. 이 task 는 **시작 시 DDL** 만 다룬다.

## 사용자 지시·승인 (원문 보존)

- 2026-11-20 10:5x 「이슈기록 등록 및 작업 진행해줘. 이번에는 PR등록해서 관리하도록 해주는데 …」 → 진행 작업 선택: 「시작 시 DB 준비 지연」
- main 머지(=운영 배포)는 이 승인 범위가 아니다 — PR 검토 후 별도 승인.

- 2026-11-20 16:5x 후속 1: 「커밋 훅 감시 목록에 새 시험 추가 PR로 진행」

## 설계 (Leader — Developer 구현 사양)

화면 변경 없음. 운영 DB 쓰기·DDL 실행 금지(시험은 임시 DB/목). 버전: 웹 `package.json`·`package-lock.json` 0.18.0 → **0.19.0**(마이너). 앱(APK) 무관.

### WP-0 확정 조사 (구현 전, 보고 필수)
- setupDB 가 한 프로세스에서 몇 벌 도는지와 그 이유를 코드·`.next` 빌드 산출물(서버 청크 구조)로 확정한다. 운영 로그의 ordinal 8·9·10·57·61~66·259·260·270 이 **어느 문장인지** 대응표를 만든다(빌드 산출물의 문장 순서 또는 ordinal 계산 방식으로).
- 풀이 번들마다 따로 생기는지(연결 수)도 확인한다.

### WP-1 프로세스당 한 번만 (single-flight)
- `pool`·`setupPromise`·`setupFatalError` 를 프로세스 전역(`globalThis` 의 `Symbol.for(...)` 키 등)에 두어, 번들이 여러 벌이어도 **풀 1개·setupDB 1회**가 되게 한다. fail-closed(`setupFatalError` 가 서면 모든 `getPool()` 이 던짐)는 모든 번들에 똑같이 적용돼야 한다 — 한 번들에서만 막히는 상태가 생기면 안 된다.
- 핫 리로드(dev)에서 이중 생성되지 않는지, 시험이 모듈 상태를 초기화하는 기존 방식과 충돌하지 않는지 확인한다.

### WP-2 필요 없는 DDL 을 보내지 않는다
- 조건 없이 매번 도는 ALTER(MODIFY COLUMN 등)와 매번 실패하는 문장(ordinal 10·61·62·63·65·66)을 대응표로 확인하고, **이미 원하는 상태면 보내지 않도록** 존재·정의 확인을 앞에 둔다(INFORMATION_SCHEMA 읽기 1~2회로 묶기 — 문장마다 조회하지 않는다). `bootstrap-presence.ts` 를 확장하거나 같은 원칙의 새 도우미를 둔다. 확인에 실패하면 지금처럼 DDL 을 보낸다(보수적).
- 스키마 결과는 지금과 같아야 한다 — 새 DB(빈 스키마)에서 setupDB 를 돌린 결과와, 기존 운영 스키마에서 돌린 결과가 변경 전과 같음을 시험으로 보인다.
- signals.status ENUM 검증·자동 확장(fail-closed) 경로의 의미를 바꾸지 않는다.

### WP-3 잠금 대기 상한 (선택 — 근거와 함께 판단)
- 시작 시 DDL 세션에 `SET SESSION lock_wait_timeout = <짧은 값>` 를 둘지 판단한다. 장점: MDL 을 못 얻은 ALTER 가 하루까지 기다리며 뒤의 모든 쿼리를 막는 일을 끊는다. 위험: 필수 DDL 이 시간 초과로 실패하면 fail-closed 가 서서 DB 접근 전체가 막힐 수 있다 → 필수 DDL 과 선택 DDL 을 구분하고, 필수 쪽 실패는 지금과 같은 처리인지 확인한다. 도입하지 않기로 하면 근거를 적는다.

### 범위 밖 (하지 않는다)
- 배포 스크립트(release.sh)의 헬스 제한 시간 변경 — 공용 인프라(HOME-SERVER_CONFIG).
- 운영 DB 설정 변경(fsync·lock_wait_timeout GLOBAL), 느린 쿼리 로그 — 사용자 별도 진행.
- 시작 이외의 DB 지연(기록 쓰기 503 등).

### 시험·검증 요구
- WP-1: 모듈을 두 번 불러온 상황(별도 모듈 인스턴스 흉내)에서 풀 1개·setupDB 1회, fail-closed 가 양쪽에 같이 적용되는 시험.
- WP-2: 문장별 건너뛰기 조건 시험(이미 있음 → 안 보냄 / 없음 → 보냄 / 확인 실패 → 보냄), 빈 스키마·현행 스키마 결과 동일(가능하면 임시 MariaDB 컨테이너 — 서버에 `mariadb:10.11` 이미지 있음, 기존 `t108-qa-db` 등은 건드리지 않는다).
- 시작 시 보내는 DDL 문장 수가 변경 전 대비 얼마나 줄었는지 숫자로 보고.
- 전체 `tsc`·jest·`next build` — 무거운 시험은 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10 …`, Node `~/.node-local/v24.22.2/bin`. 기존 실패 묶음과 새 실패를 이름으로 구분.
- 운영 DB 쓰기·DDL·`/api/cron/*` 호출·pm2 조작 금지.

## Developer

- [11:36] (실행 도구: claude, developer) WP-0 결론 — **Leader 추정은 절반만 맞다.** [확실] 한 프로세스 안의 setupDB 는 **2벌**이다(3벌이 아니다). 배포 때 보이는 3번째 `ensure_setup start` 는 **다른 프로세스**다. 근거는 아래 두 줄. 설계(WP-1)는 그대로 유효하다 — 프로세스 안 2벌을 1벌로 줄인다. 3번째(배포 절차가 만드는 짧은 프로세스)는 이 task 범위(release.sh·공용 인프라) 밖이라 Leader 에게 넘긴다.
- [11:36] WP-0 근거① 빌드 산출물(운영 릴리스 `20261120-105307-2a3ae448` 의 `.next/server`, 읽기만): setupDB 코드는 `chunks/1835.js`(모듈 id 95192 — `instrumentation.js` 만 `c.e(1835)` 로 부름)와 `chunks/5589.js`(모듈 id 65179 — API 라우트 엔트리 123개가 부름) 두 곳에만 있다. 두 엔트리 모두 같은 `webpack-runtime.js` 를 require 하지만 **모듈 id 가 달라** 모듈 캐시가 따로다 → `pool`·`setupPromise`·`setupFatalError` 가 2벌, 풀도 2개(각 connectionLimit 10, 프로세스당 최대 20연결). 라우트 쪽은 첫 `/api/health` 요청이, instrumentation 쪽은 기동 30초 뒤 텔레그램 폴러의 첫 DB 접근이 시작시킨다(로그: 두 번째 start 가 매번 `[telegram-poller] 락 획득` 과 같은 초, 그리고 `[boot] KIS 요청 유량 … 출처: 코드 기본값` 이 그 인스턴스에서 한 번 더 찍힘).
- [11:36] WP-0 근거② 3번째 start 의 정체 [확실]: 배포 로그(`~/.local/webhook-deploy/logs/project_StockInvest.log` 11-20)에서 release.sh 가 `▶ 프로세스 reload`(pm2 가 **옛 릴리스 경로**로 새 프로세스를 띄움) 직후 `▶ 실제 구동 경로 확인 → pm2 'stockinvest' 이 아직 옛 경로를 잡고 있다 → delete 후 재등록` 을 매 배포마다 한다. pm2-out.log 에도 매 배포 `▲ Next.js … Ready` 와 `[cron-watchdog] 시작` 이 3~4초 간격으로 **두 번** 찍힌다(10:43:21·10:43:25 / 10:45:32·10:45:36 / 10:53:37·10:53:40). 즉 배포 1회 = 프로세스 A(직전 릴리스 코드, 3~4초 만에 delete) + 프로세스 B(새 코드, 번들 2벌). A 의 setupDB 는 첫 문장들을 보낸 채 죽는다 — 이미 DB 서버에 들어간 문장이 클라이언트 종료 뒤에도 MDL 을 기다리며 남는지는 [추측](서버 processlist 미확인). ⚠️ 이 구조 때문에 **이번 수정을 처음 배포할 때는 A 가 아직 옛 코드(ALTER 18개)** 를 돈다 — 효과는 그 다음 배포부터 온전하다.
- [11:36] WP-0 ordinal↔문장 대응표 — 일회용 MariaDB(10.11.19)에서 변경 전 코드로 setupDB 를 3회(빈 DB → 2회차 → 3회차=운영 재시작 상태) 돌려 운영과 같은 방식(setupDB facade 의 query/execute 호출 순서)으로 셌다. 3회차의 ordinal 1~66 종류·성공/실패가 운영 로그와 **전부 일치**한다: 8 = `CREATE TABLE IF NOT EXISTS strategies`(성공, 뒤 ALTER 의 MDL 대기에 걸려 최대 21초) · 9 = `ALTER TABLE strategies MODIFY COLUMN backtest_interval_h FLOAT NOT NULL DEFAULT 6`(매번 성공 — 같은 정의로 바꾸는 무의미한 ALTER, 중앙값 7.8초·최대 30.2초) · 10 = `ALTER TABLE strategies ADD COLUMN applicable_styles …`(매번 실패: Duplicate column) · 57 = `CREATE TABLE IF NOT EXISTS signals` · 58·59 = T-156 메타데이터 조회 2개(INFORMATION_SCHEMA, sql_class OTHER) · 60 = signals.status COLUMN_TYPE 조회 · 61 = `ALTER TABLE signals ADD COLUMN scenario_source`(매번 실패) · 62 = `ALTER TABLE signals ADD COLUMN valid_from`(매번 실패) · 63 = `CREATE INDEX idx_signals_valid_from`(매번 실패: Duplicate key) · 64 = `CREATE TABLE IF NOT EXISTS symbol_universe` · 65 = `ALTER TABLE symbol_universe ADD COLUMN tier`(매번 실패) · 66 = `CREATE INDEX idx_universe_tier`(매번 실패) · 259 = `ALTER TABLE symbol_universe ADD COLUMN IF NOT EXISTS rs_rating` · 260 = 같은 형태 `near_52w_high`(둘 다 11-20 10:47 롤백 프로세스에서 6~10초). 270(11-11 19:12 1회)은 T-156 이전 코드(메타데이터 조회 2개 대신 ALTER 12개 → ordinal +10)라 현 코드의 260 = `near_52w_high` 에 해당 [가능성 높음]. 운영 로그의 58~76 ALTER 실패 묶음(11-08~11-11)도 T-156 이전 코드의 signals 컬럼 ALTER 들이다.
- [11:36] WP-0 보충 — Leader 기록 중 정정 1건 [확실]: `users MODIFY COLUMN password_hash`(db.ts ~1729)는 조건 없이 도는 문장이 아니다. `ensureUsersOAuthColumns` 가 INFORMATION_SCHEMA 로 nullable 여부를 먼저 보고 아닐 때만 보낸다(운영 로그에도 이 문장의 지연 기록 없음). 그래서 손대지 않았다. 또 하나 [확실]: **빈 DB 첫 기동은 symbol_universe.market 을 만들지 못한다** — `ALTER TABLE symbol_universe ADD COLUMN market` 이 `CREATE TABLE IF NOT EXISTS symbol_universe` 보다 앞에 있어 실패·무시되고 두 번째 기동에서 붙는다. T-179 이전부터의 순서이고 운영은 이미 붙어 있다. "스키마 결과를 바꾸지 않는다"는 사양에 따라 순서는 그대로 두고 주석과 시험으로만 고정했다(별도 task 후보).
- [11:36] 변경 파일 — `src/lib/db.ts`(WP-1·2·3) · `src/lib/db/bootstrap-presence.ts`(WP-2 확장) · `src/lib/diagnostics/boot-diagnostics.ts`(sql_class 분류 1줄) · `src/lib/db/__tests__/bootstrap-presence.test.ts`(시험 4개 추가) · 신규 `src/lib/db/__tests__/process-state.test.ts` · 신규 `src/lib/db/__tests__/setup-ddl-disposable-mariadb.test.ts` · `package.json`·`package-lock.json` 0.18.0 → 0.19.0. 화면 파일 변경 없음. 커밋·push 하지 않음(Leader 몫). `node_modules` 심볼릭 링크는 건드리지 않음.
- [11:36] WP-1 구현 — `pool`·`setupPromise`·`setupFatalError`·`oauthSchemaReady` 를 `globalThis[Symbol.for('stockinvest.db.state')]` 객체 하나로 옮겼다(cron-watchdog·telegram-poller 와 같은 방식). 번들이 몇 벌이든 풀 1개·setupDB 1회, fail-closed 는 어느 번들의 getPool() 에서나 같이 던진다. `oauthSchemaReady` 도 옮긴 이유: setupDB 를 실제로 돈 번들만 값을 알기 때문에 그대로 두면 다른 번들의 `isOAuthSchemaReady()` 가 영원히 null 이 된다(oauth-complete 라우트가 읽음). dev 핫리로드: 풀을 새로 만들지 않고(예전엔 리로드마다 풀 증가) setupDB 도 다시 돌지 않는다 — 주석에 "스키마 코드 수정 시 dev 서버 재시작" 명시. 시험의 모듈 초기화 방식과의 충돌: 기존 시험은 전부 `@/lib/db` 를 mock 하거나 runOnceMigration 만 쓰므로 영향 없음(전체 jest 로 확인, 아래).
- [11:36] WP-2 구현 — setupDB **맨 앞에서** INFORMATION_SCHEMA 를 2회(COLUMNS·STATISTICS) 읽어 판단한다(T-156 은 signals 생성 뒤에 읽었음 — setupDB 는 더하기만 하므로 "시작 때 있으면 끝까지 있다", 빈 DB 면 전부 "없음"이라 지금처럼 다 보냄). `bootstrap-presence.ts` 허용 목록을 strategies·signals·orders·symbol_universe·position_state·stock_favorites·research_rally_results 의 컬럼 24개·인덱스 6개로 넓히고, 정의 완전 일치 비교 `columnIs`(COLUMN_TYPE·IS_NULLABLE·COLUMN_DEFAULT 세 값 모두 같을 때만 참)를 backtest_interval_h 하나에만 쓴다(일회용 DB 실측: `float`/`NO`/`6`). 조회 실패·3초 초과·낯선 응답은 "모름" → 지금처럼 보낸다. 선택 DDL 30개(T-156 이 이미 조건부로 만든 signals·orders·market 12개 + 이번에 새로 조건부로 만든 18개 — 운영에서 매 기동 나가던 ALTER·CREATE INDEX 전부)를 `optionalDdl()` 로 감쌌다 — 이미 있으면 안 보냄, 없거나 모르면 보냄, 실패는 지금처럼 무시(30개 모두 변경 전에도 catch 로 무시하던 문장). 단, 조회가 성공해 "없다"를 확인하고 보냈는데 실패하면 `console.warn` 한 줄을 남긴다(새 동작 — 잠금 시간 초과로 컬럼이 빠진 채 뜨는 걸 조용히 넘기지 않으려고). signals.status ENUM 확장·검증(fail-closed)과 users OAuth 경로는 **손대지 않았다**.
- [11:36] WP-3 판단 — **도입, 선택 DDL 30개에만.** 방식: `SET STATEMENT lock_wait_timeout=5 FOR <문장>`(MariaDB 문장 단위 설정 — 그 문장에만 적용, 풀 연결의 세션 값은 86400 그대로라 뒤 쿼리에 새지 않음. 일회용 10.11 에서 ALTER·CREATE INDEX 모두 동작 확인). 5초 = T-088 마이그레이션 선례. 근거: 이 30개는 원래 실패를 무시하던 문장이라 상한을 둬도 실패 처리가 같다(무시하고 계속, 다음 기동에 재시도). 반면 상한이 없으면 MDL 을 못 얻은 ALTER 가 최대 하루 기다리며 그 테이블의 모든 새 쿼리를 뒤에 세운다. **필수 DDL 에는 두지 않았다**: `CREATE TABLE IF NOT EXISTS`(실패하면 setupDB 실패 → 새 실패 경로가 생김), signals.status ENUM 확장(fail-closed 의미 유지), users OAuth alterPinned(인증 경로, 이미 조건부·알림 있음). 정상 상태(3회차)에서는 30개가 하나도 나가지 않으므로 이 상한은 메타데이터 조회 실패 같은 예외 상황의 안전망이다. 부수 변경: boot-diagnostics 의 sql_class 정규식이 `SET STATEMENT … FOR` 앞머리를 건너뛰게 1줄 고침(안 고치면 선택 DDL 이 OTHER 로 찍혀 운영 진단이 흐려짐).
- [11:36] 시작 시 DDL 문장 수(일회용 DB, 같은 코드 경로·같은 세는 법) — 3회차=운영 재시작 상태: **DDL 47 → 29**(남은 29개는 전부 `CREATE TABLE IF NOT EXISTS`), ALTER·CREATE INDEX **18 → 0**, 실패하는 DDL **6 → 0**, 전체 쿼리 268 → 250. 2회차: DDL 48 → 30(그중 ALTER 1개 = 빈 DB 순서 문제로 늦게 붙는 symbol_universe.market, 실패 6 → 0). 빈 DB: 64 → 64(같음 — 전부 보내야 하므로). 프로세스 단위로는 번들 2벌 → 1벌이라 배포 1회의 새 프로세스가 보내는 DDL 이 **94 → 29**, ALTER·CREATE INDEX 36 → 0, 풀 2개(최대 20연결) → 1개(최대 10연결). 남은 29개 CREATE TABLE IF NOT EXISTS 도 MDL 을 잡고 (binlog 가 켜져 있으면) 기록을 남긴다 — 존재 확인 뒤 건너뛰는 것은 사양 범위 밖이라 하지 않았고, 다음 후보로 남긴다.
- [11:36] 새 시험 — `process-state.test.ts`: 「두 번들 인스턴스 — 풀 1개, setupDB 1회(같은 약속), OAuth 상태도 공유」·「fail-closed — 한 번들에서 선 스키마 치명 오류가 다른 번들의 getPool() 도 막는다」(isolateModules 로 db.ts 를 두 번 평가 — 운영의 두 모듈 id 흉내. **변경 전 db.ts 로 돌리면 둘 다 실패**함을 확인: createPool 2회·strategies 생성 3회). `bootstrap-presence.test.ts` 추가 4개: 「T-179 columnIs — 세 값이 모두 같을 때만 참」·「T-179 columnIs — 정의 필드가 없거나 형태가 낯설면 이름만 인정하고 정의는 모름」·「T-179 known — 조회 실패·낯선 형태면 false」·「T-179 새로 판단하는 객체 — 허용 목록에 정확한 이름으로 들어 있다」(기존 9개 그대로 통과). `setup-ddl-disposable-mariadb.test.ts`(T179_TEST_DB_PORT 없으면 건너뜀): A 빈 스키마 성공·B 2회차는 symbol_universe.market 만 늘어남(기존 동작 보존)·C 3회차 스키마 불변 + ALTER/CREATE INDEX 0개 + 실패 DDL 0개·D 변경 전 코드로 만든 스키마 스냅샷과 같음.
- [11:36] 스키마 동일성 [확실] — 일회용 MariaDB(127.0.0.1:33179, 컨테이너 `t179-mariadb`, 끝나고 삭제)에서 변경 전 코드로 빈 DB→2회차→3회차를 돌려 스냅샷(SHOW CREATE TABLE 전 테이블 + system_config 키 목록 + strategies id·enabled·backtest_interval_h + market_holidays 행 수)을 저장하고, 변경 후 코드로 같은 순서를 돌려 대조 → 세 단계 모두 **완전히 같다**(시험 D 통과). 재실행 방법은 시험 파일 머리 주석.
- [11:36] 전체 시험 — `jest` 전체: 변경 전(base `2a3ae44` 를 git archive 로 푼 사본) 13009개 중 실패 416(스위트 27) / 변경 후 13019개 중 실패 416(스위트 27). 실패 이름 집합을 JSON 으로 대조: **새 실패 0건, 사라진 실패 0건**(실패 416건은 전부 기존 것 — t108 화면 렌더·용어 울타리·currency/usd/corp-intel/profit-engine 격리·job-slots 등, 이 task 와 무관). 추가된 10개 = 통과 6 + 일회용 DB 시험 4(건너뜀). `tsc --noEmit` 종료 0. `next build` 종료 0. lint: 이 저장소에 eslint 설정 파일이 없어 `eslint` 단독 실행 불가(next build 의 "Linting and checking validity of types" 단계는 통과). 무거운 시험은 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10` 로 돌렸고 로그는 서버 `~/.node-local/t179-{jest-base,jest-new,tsc,build}.log`·`t179-jest-{base,new}.json`, 문장 기록은 `t179-baseline-trace.keep.json`·`t179-after-trace.json`.
- [11:36] 안전장치 self-check — 주문·체결 경로(submitOrder·어댑터·safety/*)는 바꾸지 않았다. 바뀐 것은 DB 풀·부팅 DDL 이며 fail-closed 는 오히려 넓어졌다(모든 번들 공통). DRY_RUN·KILL_SWITCH·한도·심볼 차단·orders 기록 경로는 코드 변경 없음(전체 jest 에서 해당 시험 새 실패 0). 운영 DB 쓰기·DDL·`/api/cron/*` 호출·pm2 조작 하지 않음. 운영 로그·릴리스 산출물·배포 로그는 읽기만 했다.
- [11:36] 미검증·남은 위험 — ① 실제 Next 서버에서 두 번들이 같은 상태를 보는지는 **빌드 산출물 분석 + 단위 시험(isolateModules)으로만** 확인했고, `next start` 를 띄워 ensure_setup start 가 1회인지 본 것은 아니다(QA 가 임시 DB 로 기동해 boot-diagnostics 의 `ensure_setup start` 가 1줄인지 보면 확정된다). ② dev 핫리로드 동작은 실행해 보지 않음. ③ 배포 절차의 프로세스 A(옛 코드, 3~4초 생존)는 남는다 — 이번 수정의 첫 배포에서 A 는 아직 ALTER 18개를 보낸다. release.sh 의 reload→delete/재등록 이중 기동을 없애는 것은 HOME-SERVER_CONFIG 범위라 Leader 판단 필요. ④ 남은 `CREATE TABLE IF NOT EXISTS` 29개도 다른 세션이 그 테이블에 배타 잠금을 기다리게 하면 같이 기다린다 — 정상 상태에선 ALTER 가 없어 기다릴 일이 줄지만 0 은 아니다. ⑤ 새 시험 두 파일(`process-state.test.ts`·`setup-ddl-disposable-mariadb.test.ts`)은 커밋 훅 SAFETY_PATHS 밖이다 — T-156 이 `bootstrap-presence.test.ts` 를 넣은 것과 같은 이유로 추가할지 Leader·Reviewer 판단(훅 파일은 손대지 않았다). ⑥ `boot-diagnostics.ts` 도 SAFETY_PATHS 밖이다(변경은 분류 정규식 1줄).
- [11:45] (실행 도구: claude, developer) **Medium-1 후속** — `src/lib/db.ts` 만 수정 + 새 시험 1개. ① `optionalDdl()`(db.ts:299~) catch 를 셋으로 나눴다: 잠금 대기 초과(errno 1205 / code `ER_LOCK_WAIT_TIMEOUT` — MariaDB 는 MDL 대기 초과도 이 번호)면 메타데이터를 알든 모르든 `console.error` 한 줄(라벨 = 테이블.컬럼/인덱스 이름, 5초, 사전 확인 없음/모름 — SQL·값 없음)을 남기고 전역 상태 `optionalDdlLockTimeouts` 에 라벨을 쌓는다 · 중복(1060 ER_DUP_FIELDNAME·1061 ER_DUP_KEYNAME)은 메타데이터를 알아도 조용히 넘긴다(변경 전 T-179 코드는 known 이면 이것도 warn 했다) · 그 밖의 실패는 기존 그대로(known 일 때만 warn). ② `flushOptionalDdlLockTimeouts()`(db.ts:265~)를 setupDB 의 `finally`(db.ts:1724)에서 불러, 쌓인 라벨을 기존 `notifyCritical`(같은 파일, 동적 import `sendAlert('critical', …)`)로 **알림 1건**에 묶어 보낸다. 간격 제한 30분(전역 `optionalDdlAlertAt`) — 안이면 알림 생략, 라벨 목록 로그만. 본문은 이름·개수·조치 안내(SHOW PROCESSLIST 확인 후 재시작)뿐. 새 의존성 없음. ③ setupDB 맨 앞 `readBootstrapPresence` 직후(db.ts:342~): 컬럼·인덱스 조회 중 하나라도 「모름」이면 `console.warn` 한 줄(컬럼=확인/모름, 인덱스=확인/모름 — 원 오류 문구·값 없음). ④ optionalDdl 머리 주석에 "처음 추가하는 컬럼을 코드가 곧바로 필수로 읽는다면 이 함수에 넣지 말고 배포 전 마이그레이션으로" 를 추가(Reviewer 권고). 시간 초과 시 5초 뒤 포기하는 동작 자체(WP-3)와 필수 DDL·fail-closed 경로·스키마 결과는 바꾸지 않았다. `bootstrap-presence.ts`·`boot-diagnostics.ts` 무변경.
- [11:45] Medium-1 시험 — 신규 `src/lib/db/__tests__/optional-ddl-alerts.test.ts` 5개(가짜 풀, process-state.test 와 같은 방식, 알림은 제목으로 걸러 셈 — 가짜 DB 에선 OAuth 경로도 알림을 보내므로): 「1205 두 문장(symbol_universe.tier·idx_universe_tier) → 라벨 로그 2줄 + 알림 1건(본문에 두 이름, SQL·비밀 없음), 부팅 계속·뒤 문장도 전송」·「setupDB 재실행 → 알림 여전히 1건, 로그 2줄 + 생략 로그 1줄」·「1060·1061 → 알림·경고·error 0」·「COLUMNS 조회 실패 → 「모름」 warn 1줄(컬럼=모름·인덱스=확인, 원 오류 문구 없음), DDL 은 전송, 알림 0」·「조회 성공 → 「모름」 로그 없음」. **변경 전 db.ts(Medium-1 직전)로 돌리면 4개 실패·1개 통과**(마지막 것만 통과 — 정상 대조군)를 확인하고 되돌림(cmp 일치). `npx jest src/lib/db src/lib/diagnostics`: 스위트 4 통과·1 건너뜀(일회용 DB), 시험 25 통과·4 건너뜀. `tsc --noEmit` 종료 0. 전체 jest·`next build`·일회용 MariaDB 시험은 이번엔 돌리지 않음(QA 몫 — 스키마 결과를 바꾸는 줄은 없음). 로그: 서버 `~/.node-local/t179-medium1-{jest,jest-before,tsc}.log`, 수정 전 사본 `~/.node-local/t179-db.ts.before-medium1`.
- [11:45] Medium-1 남은 점 — ① 이 알림은 「5초 안에 못 붙였다」를 알릴 뿐 컬럼을 붙이지는 않는다(다음 기동에 재시도). 기다림을 늘리거나 재시도하는 안(Reviewer ②의 「더 긴 상한 1회 재시도」)은 MDL 대기열을 다시 길게 만드는 쪽이라 택하지 않았다 — 필요하면 Leader 판단. ② 메타데이터를 「모름」인 채 1205 가 나면 실제로는 이미 있던 컬럼이어도 알림이 간다(오탐 쪽 — 잠금 경합 자체는 사실이라 알릴 가치가 있다고 봄). ③ 빈 DB 첫 기동의 symbol_universe.market warn(Low-1, ER_NO_SUCH_TABLE)은 그대로다. ④ 새 시험 파일도 커밋 훅 SAFETY_PATHS 밖이다(Reviewer 의견 5와 같은 판단 대상). 커밋·push 하지 않음.

- [17:0x] (실행 도구: claude, 메인 세션이 developer 겸임) **후속 1 — 커밋 훅 감시 목록에 새 시험 3개 추가.** 서버 worktree `~/.node-local/stockinvest-t179s`(브랜치 `t179-safety-tests`, 기준 `origin/main` `cbe24e2`). 바꾼 파일 2개: `scripts/git-hooks/commit-msg` — `SAFETY_PATHS` 에 `src/lib/db/__tests__/process-state.test.ts`·`optional-ddl-alerts.test.ts`·`setup-ddl-disposable-mariadb.test.ts` 정확 일치 3줄 + 항목별 근거 주석(「T-179 추가」 블록, 넣지 않은 것 `boot-diagnostics.ts` 포함). `scripts/test-git-hooks.sh` — T-156 블록과 같은 형식의 T-179 블록(이웃 3경로 통과 1건 + 항목마다 실제 커밋 미검토 차단·이웃 scope 차단·정확 scope 통과 = 9건). `bash -n` 두 파일 통과, `bash scripts/test-git-hooks.sh` 종료 0·「전체 검증 통과」(T-179 10건 포함, 로그 `~/.node-local/t179s-hooktest.log`). 앱 코드·시험 본문·배포 대상 파일 무변경.

## Reviewer

- [11:41] (실행 도구: claude, reviewer) 감사 범위: `src/lib/db.ts`(전체 diff + 호출 경로), `src/lib/db/bootstrap-presence.ts`, `src/lib/diagnostics/boot-diagnostics.ts`, `src/lib/db/__tests__/{process-state,setup-ddl-disposable-mariadb,bootstrap-presence}.test.ts`, `package.json`·`package-lock.json`. 변경 파일 8개는 설계 범위와 일치(범위 밖 변경 없음, 버전 0.18.0 → 0.19.0 외 package 변경 없음). 주문·체결·safety 경로 무변경. 직접 재실행: `jest src/lib/db src/lib/diagnostics` 3개 스위트 통과(20 통과·4 건너뜀=일회용 DB 시험). 변경 전 `2a3ae44` 를 `git archive` 로 임시 디렉터리에 풀어 `process-state.test.ts` 만 넣고 실행 → 2개 모두 실패(createPool 3회·strategies 생성 3회 등), 임시 디렉터리 삭제 확인. 즉 "변경 전 코드에서 실패" 주장은 사실. 일회용 MariaDB 시험은 직접 재실행하지 않음(개발자 실행 결과와 시험 코드 구조만 확인 — 미검증).
- [11:41] 1) fail-closed 보존 — 통과. `setupFatalError` 가 `globalThis[Symbol.for("stockinvest.db.state")]` 한 객체에 있고(db.ts:40-56) `getPool()`·`getSetupFatalError()`·`ensureSetup()` 모두 `dbState()` 경유(db.ts:88-90,134-165)라 어느 번들에서도 같은 상태를 본다. signals.status ENUM 검증·자동 확장(`assertSignalStatusEnum`)은 diff 에 손댄 줄이 없다. `lock_wait_timeout=5` 는 `optionalDdl()` 이 감싼 30개에만 붙고, 이 30개는 전부 변경 전에도 `.catch(()=>{})`/빈 `catch` 로 실패를 무시하던 문장이다(diff 로 하나씩 확인) — CREATE TABLE IF NOT EXISTS·ENUM 확장·users OAuth alterPinned 에는 없다. 필수 DDL 이 5초에 조용히 건너뛰어지는 경로는 없음. 다만 아래 Medium-1 참고.
- [11:41] 2) 건너뛰기 판정 — 통과(오탐 경로 없음). 존재 확인은 허용 목록 이름 정확 일치 + `TABLE_SCHEMA=DATABASE()`, 조회 실패·3초 초과·낯선 행 형태는 `EMPTY()`(known=false)로 떨어져 DDL 을 보낸다(bootstrap-presence.ts:75-95, 시험 확인). 정의 비교(`columnIs`)는 backtest_interval_h 하나뿐이고 column_type·is_nullable·column_default 세 값이 모두 같을 때만 참, `IS_NULLABLE` 은 대문자 YES/NO 만 인정(소문자·숫자 default 는 모름 처리). 불일치하면 ALTER 를 보내므로 안전한 쪽으로 실패. 인덱스는 이름만 비교하는데, 변경 전 `CREATE INDEX`/`ADD INDEX IF NOT EXISTS` 도 이름 충돌로만 걸러졌으므로 의미가 같다. 메타데이터를 setupDB 맨 앞으로 옮긴 것도, setupDB 가 객체를 더하기만 하므로 건너뛰기 판단에는 영향 없음(빈 DB 는 전부 "없음").
- [11:41] 3) globalThis 상태 — 이상 없음, Low 1건. 키는 Symbol.for 로 충돌 가능성 낮고 타입(`DbProcessState`)도 안전하다. 핫리로드에서 풀 증가가 사라지는 대신 스키마 코드 수정이 재시작 전엔 반영되지 않는 점이 주석에 명시돼 있다. 여러 DB 설정은 프로세스당 하나뿐이라(환경변수 고정) 운영에서는 문제 없고, 시험이 한 jest 파일 안에서 설정을 바꾸는 경우만 낡은 풀 위험이 있는데 새 시험 두 개는 모두 전역 키를 지운다(process-state.test.ts beforeEach/afterEach, disposable `freshProcessDbModule`). `pool.end()` 뒤에도 `state.pool` 이 끝난 풀을 가리키는 것은 변경 전 모듈 변수와 같은 동작.
- [11:41] **Medium-1 (db.ts:236-261, optionalDdl)**: "선택 DDL" 이라는 이름과 달리 이 30개 중 다수는 코드가 읽는 컬럼이다(signals.market·valid_from·scenario_source, orders.market, symbol_universe.tier·market, position_state.scenario_exit 등). 컬럼이 실제로 없고(새 컬럼을 추가하는 배포) 5초 안에 MDL 을 못 얻으면 변경 전에는 얻을 때까지 기다렸지만(하루 상한), 이제는 `console.warn` 한 줄만 남기고 컬럼이 빠진 채 부팅이 끝난다 — health 는 200, fail-closed·알림 없음. 해당 컬럼을 SELECT 하는 쿼리가 이후 런타임에 개별 실패한다. 실패 무시 자체는 변경 전과 같지만 "기다림 → 즉시 포기" 로 바뀌어 새 컬럼 배포 시 빈도가 올라간다(공유 NAS DB 에서 MDL 대기 중앙값이 7.8초였음). 또 메타데이터 조회가 3초 초과로 "모름" 이 된 경우도 DDL 이 5초 상한으로 나가며 warn 도 없다(`metadataKnown=false`). 권고: ① 현 정상 상태(모든 컬럼 존재)에서는 문장이 하나도 안 나가므로 이번 배포 위험은 낮다 — 차단 사유 아님 ② 다만 "known 인데 없어서 보냈고 실패" 경우는 warn 대신 `notifyCritical` 급 알림 또는 1회 더 긴 상한(예: 30초) 재시도로 올리고, "모름" 경우에도 실패 로그를 남길 것. 새 컬럼 task 가 이 패턴을 복사할 때를 대비해 주석에 "코드가 필수로 읽는 새 컬럼은 이 함수에 넣지 말 것" 을 추가하길 권한다.
- [11:41] **Low-1**: 빈 DB 첫 기동에서 symbol_universe 가 아직 없어 market ALTER 가 실패하는데 이제는 known=true 라 매번 warn 이 찍힌다(운영 영향 없음, 로그 소음). **Low-2**: `boot-diagnostics.ts` 의 sql_class 정규식 변경은 직접 단위 시험이 없다(기존 boot-diagnostics.test 는 통과). 수동 확인에서 `SET STATEMENT … FOR` 줄바꿈 포함 3개 입력이 기대대로 분류됨(ALTER/ALTER/undefined=OTHER). 시험 1건 추가 권장. **Low-3**: 개발자 기록의 미검증 항목(실제 `next start` 로 `ensure_setup start` 1회 확인, dev 핫리로드)은 여전히 미검증 — QA 몫. **Low-4**: 배포 절차의 프로세스 A(옛 코드, 3~4초 생존)는 첫 배포에서 ALTER 18개를 계속 보낸다는 개발자 기록에 동의 — 첫 배포 직후 효과는 제한적.
- [11:41] 5) 커밋 훅 감시 목록 의견: `scripts/git-hooks/commit-msg` SAFETY_PATHS 에 `src/lib/db/__tests__/process-state.test.ts` 는 **추가 권장**(fail-closed 가 번들 간 공유되는지를 지키는 유일한 회귀망이고, 같은 논리로 `bootstrap-presence.test.ts` 가 이미 들어 있음). `setup-ddl-disposable-mariadb.test.ts` 는 T-088 일회용 DB 시험(목록 45줄)이 선례라 추가해도 일관되나 평소 건너뛰므로 선택. `boot-diagnostics.ts` 는 관측 분류 전용이라 불필요. 훅 파일 자체가 SAFETY_PATHS 이므로 이번 task 와 분리된 별도 커밋·감사로 처리할 것.
- [11:41] high_risk_areas(QA 집중): db.ts:236-261 optionalDdl 의 실패·경고 경로, db.ts:380-392 backtest_interval_h 건너뛰기 조건(`columnIs`), db.ts:1590-1597 rs_* 루프, 임시 DB 로 `next start` 기동 시 boot-diagnostics `ensure_setup start` 1줄 여부, 메타데이터 조회 실패(3초 초과) 시 DDL 이 전부 나가는 폴백. 발견 요약: Critical 0 · High 0 · Medium 1 · Low 4. 판정 기준상 pass 이나 Medium-1 은 Developer 가 알림 강화 또는 사유를 기록해 주면 좋다(차단 아님).
- [11:41] **최종 판정: PASS (scope: src/lib/db.ts, src/lib/db/bootstrap-presence.ts, src/lib/diagnostics/boot-diagnostics.ts, src/lib/db/__tests__/process-state.test.ts, src/lib/db/__tests__/bootstrap-presence.test.ts, src/lib/db/__tests__/setup-ddl-disposable-mariadb.test.ts, package.json, package-lock.json)**
- [11:48] (실행 도구: claude, reviewer) **재검증(Medium-1 후속, 수정 부분만)** — 1차 이후 바뀐 파일은 `src/lib/db.ts`·신규 `src/lib/db/__tests__/optional-ddl-alerts.test.ts` 둘뿐(나머지는 수정 시각이 1차 11:41 이전, 수정 전 사본과 diff 로 확인). `npx jest src/lib/db src/lib/diagnostics` 직접 재실행: 스위트 4 통과·1 건너뜀, 시험 25 통과·4 건너뜀.
- [11:48] ① 알림 내용·throttle — 통과. 본문은 `labels`(테이블.컬럼/인덱스 이름)·개수·상수 5초·고정 안내문뿐이고 SQL·오류 문구·접속 정보가 없다(시험이 `ALTER TABLE|CREATE INDEX|password` 부재까지 확인). throttle 시각 `optionalDdlAlertAt`·누적 목록은 `dbState()`(`Symbol.for` 전역 객체)에 있어 번들이 두 벌이어도 한 값을 본다 — 게다가 setupDB 자체가 전역 `setupPromise` 로 프로세스당 1회라 이중 알림 경로가 거의 없다. 재실행 시험(알림 1건·로그 2줄·생략 로그 1줄)도 통과. Low: 알림 전송이 실패해도 throttle 시각은 이미 갱신된다(`notifyCritical` 이 오류를 삼킴) — 30분 안 재시도는 로그만 남는다. 허용 범위.
- [11:48] ② 1060·1061 조용히 넘김 — 안전. 판별은 숫자 errno 정확 일치(1060·1061)뿐이고, 그 밖의 오류는 기존 경로(알려진 경우 warn)로 간다. optionalDdl 로 보내는 문장은 전부 ALTER 한 절(ADD COLUMN 또는 ADD INDEX 하나)이라 1060·1061 이 나면 「이미 있음」이 곧 결과이고, 다른 절이 함께 버려지는 경우가 없음을 문장 목록(db.ts:460~1670)으로 확인했다. 대부분 `IF NOT EXISTS` 라 애초에 거의 안 난다.
- [11:48] ③ finally 알림 — 통과. `flushOptionalDdlLockTimeouts()` 는 `splice`·`Date.now()`·`console.error`·`notifyCritical`(동적 import, `void`, 내부 `.catch` 로 비동기 실패 삼킴)뿐이라 동기 예외 경로가 없고 await 하지 않는다. finally 순서도 flush → `observation.close()` 라 close 를 건너뛰지 않는다. try 본문의 예외·`isSchemaFatal` 전파(`ensureSetup` 의 catch)는 finally 가 바꾸지 않는다. 알림 실패는 부팅을 막지 않는다. 선택 DDL 의 1205 는 try 안에서 삼키므로 fail-closed(필수 DDL·ENUM 검증)는 손대지 않았다.
- [11:48] ④ 재시도 안 넣음 — 동의. 5초 포기는 MDL 대기열 연쇄(WP-3)를 막으려는 설계라 더 긴 재시도는 같은 문제를 되살린다. 대신 알림 + 「필수로 읽는 신규 컬럼은 배포 전 마이그레이션」 주석(db.ts:238 부근)으로 위험을 사람이 보게 했으므로 Medium-1 의 요구(실패가 조용하지 않을 것)를 충족한다. 한계: 알림은 사실 통지일 뿐 컬럼을 붙이지 않는다(다음 기동까지) — Developer 도 명시했다.
- [11:48] ⑤ 범위 — 이상 없음. 변경은 db.ts 의 상태 필드 2개·상수·헬퍼 3개·optionalDdl catch 분기·setupDB 의 reset/「모름」 로그/finally flush 뿐이며 스키마 결과·필수 DDL·fail-closed 로직·주문 안전장치는 건드리지 않았다. 새 시험의 「모름」 로그 시험은 원 오류 문구가 안 실림을 확인한다. Low(차단 아님): 메타데이터를 「모름」인 채 1205 가 나면 이미 있던 컬럼이어도 알림이 가는 오탐 쪽 — 잠금 경합은 사실이므로 허용. 신규 시험 파일은 commit-msg 훅 `SAFETY_PATHS` 밖 — 1차 의견 5와 같이 추가 여부는 Leader 판단. 요약: Critical 0 · High 0 · Medium 0(Medium-1 해소) · Low 신규 1(throttle 시각 선갱신) 포함 기존 Low 유지.
- [11:48] **최종 판정: PASS (scope: src/lib/db.ts, src/lib/db/bootstrap-presence.ts, src/lib/diagnostics/boot-diagnostics.ts, src/lib/db/__tests__/process-state.test.ts, src/lib/db/__tests__/bootstrap-presence.test.ts, src/lib/db/__tests__/setup-ddl-disposable-mariadb.test.ts, src/lib/db/__tests__/optional-ddl-alerts.test.ts, package.json, package-lock.json)**
- [17:05] (실행 도구: claude, reviewer) 후속 1(커밋 훅 감시 목록 보강) 독립 감사. 범위: `scripts/git-hooks/commit-msg`(SAFETY_PATHS 추가 3줄·근거 주석), `scripts/test-git-hooks.sh`(T-179 블록), 이 이력서 diff. 파일 3개 외 변경 없음(git diff --stat 56줄 추가, 삭제 0).
- [17:05] 1) 정규식 — 통과. 3개 모두 `^…\.test\.ts$` 정확 일치. 후보 10개(원본 3개, `.snap`·`.bak`·`.tsx`·하위 디렉토리·접두 `x`·같은 디렉토리의 bootstrap-presence/other 시험)를 grep -E 로 대조: 원본 3개만 1건씩, 나머지는 0건. 대상 3개 파일은 worktree 에 실재하고 `git ls-files` 에도 추적 중이다.
- [17:05] 2) 근거 주석 사실관계 — 통과. ① db.ts 가 `Symbol.for(stockinvest.db.state)` 한 객체에 pool·setupPromise·setupFatalError·oauthSchemaReady 를 두고, process-state.test 가 `jest.isolateModules` 로 두 벌 평가해 풀 1개·setupDB 1회·fail-closed 공유를 단언한다. ② 알림 본문은 `labels`(테이블.컬럼/인덱스 이름)와 고정 안내문뿐이고 시험이 `ALTER TABLE|CREATE INDEX|DB_PWD|password` 부재를 단언한다. ③ t088-disposable-mariadb 는 commit-msg 에 이미 정확 일치로 있고(T-093 주석), 같은 `describe.skip`(포트 환경변수 없으면 건너뜀) 구조다. 주석의 「잠금 대기 5초」도 db.ts 상수와 같다. Low: 주석 표현 「SQL·오류 원문·접속 정보를 싣지 않는다」 중 오류 원문 부재는 다른 시험(optional-ddl-alerts 163-165행, 로그 쪽)이 확인하고 알림 본문은 코드로 확인했다 — 사실과 어긋나지 않는다.
- [17:05] 3) 변이 시험 — 통과. 임시 저장소 사본(worktree 밖, 작업 트리 미수정)에서 process-state 줄 하나만 뺀 사본은 `bash scripts/test-git-hooks.sh` 가 533 통과/3 실패로 종료 1, 실패는 정확히 `(t179) process-state.test.ts` 의 ①미검토 ②이웃 scope ③정확 scope 3건이다. 원본 사본은 install-git-hooks.sh 설치 뒤 536 통과/0 실패, 종료 0, 「전체 검증 통과」. 단 임시 저장소에 hooksPath 가 없으면 E2E 단계가 안내만 내고 종료 1 이 된다 — 설치 전제 문제이지 이번 변경 결함이 아니다.
- [17:05] 4) 범위·fixture — 통과. T-179 블록은 항목마다 T-980 fixture 를 덮어쓴 뒤 끝에서 원래 내용(`scope: src/app/api/auth/`)으로 복원하고, 이후 T-092 시나리오가 그대로 통과했다(원본 사본 536/0). 기존 시험 블록 수정 없음. 이번 worktree 에서는 test-git-hooks.sh 를 돌리지 않았고 git status 는 감사 전과 같다.
- [17:05] 미확인: 실제 worktree 의 core.hooksPath 설치 상태에서의 E2E 단계, setup-ddl-disposable-mariadb 실제 DB 실행, 서버 외 머신(Mac) 훅 무검사 문제(CLAUDE.md 에 기록된 기존 한계). 발견 사항: Critical 0, High 0, Medium 0, Low 1(위 주석 표현).
- [17:05] **최종 판정: PASS (scope: scripts/git-hooks/commit-msg, scripts/test-git-hooks.sh, src/lib/db/__tests__/process-state.test.ts, src/lib/db/__tests__/optional-ddl-alerts.test.ts, src/lib/db/__tests__/setup-ddl-disposable-mariadb.test.ts)**

## QA
- [12:01] (실행 도구: claude, qa) 환경 — 서버 home-dev-x600, worktree `~/.node-local/stockinvest-t179` (HEAD 2a3ae44 + 미커밋 9파일), node v24.22.2. 일회용 컨테이너 `t179-qa-db`(mariadb:10.11.19, 127.0.0.1:33179 만 리슨, 임시 비밀번호는 실행 후 삭제). 변경 후 DB `si_qa_w`, 변경 전 DB `si_base_w`(git archive 2a3ae44 사본을 next build 해 실행). 운영 DB·pm2·`/api/cron/*`·운영 `.env` 미사용. 기동 env 는 KIS·텔레그램·메일·OAuth·LLM 키 없음, 요청 목록에 없던 `CRON_WATCHDOG_ENABLED=false` 를 추가했다(하트비트 없는 상태의 정지 알림을 막기 위함, DB 설정 횟수에는 영향 없음).
- [12:01] 1) 전체 jest — `flock /tmp/stockinvest-heavy-tests.lock nice -n 10 node ./node_modules/jest/bin/jest.js --json` 종료 1(실패 존재에 따른 정상 종료 코드). 결과 Tests 13024 total / 12318 passed / 416 failed / 290 skipped, Suites 27 failed · 449 passed. 기준(변경 전 사본, `t179-jest-base.json`): 13009 / 12307 / 416 / 286, 실패 스위트 27. 실패 이름 집합 대조(서버 경로 정규화 후) 기준 416건과 변경 후 416건 **완전 일치** → 새 실패 0, 사라진 실패 0, 실패 스위트 목록 동일. 추가 스위트 3개(optional-ddl-alerts · process-state · setup-ddl-disposable-mariadb)는 통과 또는 DB 미지정 skip. 이름 목록 `~/.node-local/t179-qa-fail-names-base.txt`·`…-new.txt`, 로그 `~/.node-local/t179-qa-jest.log`. 기존 416건의 원인은 QA 가 조사하지 않았고 이 변경과 무관함을 집합 비교로만 확인했다.
- [12:01] 2) `node node_modules/typescript/bin/tsc --noEmit` 종료 0, 출력 0줄 (`~/.node-local/t179-qa-tsc.log`). `node node_modules/next/dist/bin/next build` 종료 0 (`t179-qa-build.exit`=0, `t179-qa-build.log`). 변경 전 사본 빌드도 종료 0 (`t179-qa-base-build.exit`).
- [12:01] 3) 실기동 1회차, 빈 DB `si_qa_w`, 변경 후 — `~/.node-local/t179-qa-boot.sh` 실행(`next start -p 3179`). 리슨 확인 후 첫 `/api/health` 200 (spawn 후 1.63초, setup 완료 대기 포함), 이어서 health 2회 모두 200. `ensure_setup start` **1줄**, `complete` 1줄 (elapsed 898 ms). 실패 DDL 이벤트 2건(ordinal 79·282, ALTER — 빈 DB 첫 기동에서 symbol_universe 가 아직 없음, 로그 `[db] 부팅 DDL 실패 (symbol_universe.market) — 다음 기동에 다시 시도`). MariaDB general_log 기동 구간 집계: Connect 11, CREATE TABLE 29, ALTER 5, `SET STATEMENT … FOR ALTER` 30 (CREATE·ALTER 계열 합 64문). 로그 `~/.node-local/t179-qa-nw1.log`·`.gl`·`.result`. 종료는 PID 로 SIGTERM 후 확인.
- [12:01] 4) 실기동 2회차, 같은 DB, 재시작 — 변경 후: `ensure_setup start` 1줄, complete 394 ms, **실패 DDL 이벤트 0건**, general_log CREATE TABLE 29 + `SET STATEMENT … FOR ALTER` 1(symbol_universe.market) = 30문, Connect 11. health 3회 모두 200, 추가 start 줄 없음. 로그 `~/.node-local/t179-qa-nw2.log`.
- [12:01] 5) 변경 전 비교 — 같은 절차를 2a3ae44 사본에서 빈 DB 부터 2회 (`t179-qa-bw1`·`bw2`, DB `si_base_w`). `ensure_setup start` **2줄** (두 기동 모두), complete 2줄(1회차 847·91 ms, 2회차 394·84 ms). 실패 DDL 이벤트: 1회차 8건, 2회차 **12건**(ordinal 10·61·62·63·65·66 이 두 벌에서 각각 실패 — 매번 실패하던 문장 재현). 기동 구간 CREATE·ALTER 계열 문: 1회차 112, 2회차 94. Connect 13.
- [12:01] 6) 한 프로세스의 setupDB 2벌 — 변경 전 `start` 2줄, 변경 후 1줄을 같은 조건(health 응답 뒤 50초 대기, 텔레그램 폴러 30초 지연 시작 포함)에서 확인. 로그에는 번들 출처가 없어 두 번째 시작의 출처는 코드 근거(`telegram-poller.ts` START_DELAY_MS=30s → 첫 getPool() → ensureSetup)로만 본다 [가능성 높음]. 변경 후에는 같은 폴러 호출이 두 번째 setup 을 만들지 않았다(관측).
- [12:01] 7) 스키마 동일성 — 변경 전 `si_base_w`(2회 기동)와 변경 후 `si_qa_w`(2회 기동)의 테이블 목록(29개)과 `SHOW CREATE TABLE` 전문(AUTO_INCREMENT 값 제외)을 비교 → **완전 일치**, diff 0 (`~/.node-local/t179-qa-schema-si_base_w.sql` · `…si_qa_w.sql`). Developer 의 `setup-ddl-disposable-mariadb.test.ts` 를 같은 컨테이너에 대고 실행 → 4 passed (`t179-qa-disposable.log`). 다만 그 시험의 D(변경 전 스냅샷 대조)는 `T179_COMPARE_SCHEMA` 를 주지 않아 실질 검증이 아니며, 위 직접 비교가 그 역할을 대신한다.
- [12:01] 8) 기동 구간 DDL 문 수(general_log, CREATE·ALTER 계열): 변경 전 2회차 94 → 변경 후 2회차 30 (−64). 실패 DDL 6종×2벌 → 0. 1회차(빈 DB) 112 → 64. Developer 의 「47 → 29」는 3회차 기준 다른 측정이라 숫자를 맞춰 보지 않았다(QA 는 2회 기동만 측정).
- [12:01] 9) 시간 — 로컬 DB 에서 setupDB 는 394~898 ms 로 변경 전과 차이가 작다(회귀로 볼 만한 차이 없음). 운영의 79.6초 지연(메타데이터 잠금 대기)은 로컬에서 재현하지 못했다 → **운영 시간 개선은 NOT_VERIFIED**.
- [12:01] 10) 범위 밖 변경 없음 — `git status` 대조: 수정 6 (`package.json` · `package-lock.json` · `src/lib/db.ts` · `src/lib/db/bootstrap-presence.ts` · `src/lib/db/__tests__/bootstrap-presence.test.ts` · `src/lib/diagnostics/boot-diagnostics.ts`) + 신규 3 (`optional-ddl-alerts.test.ts` · `process-state.test.ts` · `setup-ddl-disposable-mariadb.test.ts`) = 9파일, Reviewer 최종 PASS scope 9개와 일치. `package.json`·`package-lock.json` 은 `0.18.0 → 0.19.0` 외 변경 없음. `node_modules`(t177 심볼릭 링크)는 미추적 상태 그대로 두었고 스테이징 대상이 아니다. QA 가 추가로 바꾼 파일은 없다(agent-vault 기록 제외).
- [12:01] 11) 안전장치 관찰 — health 응답 실측: `dryRun: true`, `killSwitch: true` 가 환경변수대로 반영. KIS 키 미설정으로 `[kis] … KIS_APP_KEY / KIS_APP_SECRET not set` 만 나오고 KIS 호출 없음. 주문 엔드포인트·주문 한도·심볼 차단·감사 로그 체크리스트는 **실행 검증하지 않았다** — 이 변경은 주문 경로 diff 가 0 이어서 해당 없음으로 보지만 실행 근거는 없다(NOT_VERIFIED). 외부 호출 관측: `[fx] fetched USD/KRW=1328.45 from frankfurter` 1회(health 가 기존대로 공개 환율을 읽은 것, 키·사용자 데이터 없음). 네트워크 오류 문구 0건.
- [12:01] 12) 미검증·남은 위험 — ① 운영 시간 개선(79.6초 지연 감소)은 재현하지 못했다 ② 운영 `release.sh` blue/green 재배포 경로(pm2 reload 가 만드는 세 번째 start 가 별도 프로세스인지)는 실행하지 않았다 ③ 두 번째 setup 의 번들 출처는 확정하지 않았다 ④ 빈 DB 첫 기동의 실패 2건(symbol_universe.market)은 Reviewer Low-1 그대로 남는다(로그 소음, 운영 영향 없음 — 운영 DB 는 이미 스키마가 있다) ⑤ 워치독을 끈 상태로 측정했다.
- [12:01] 13) 정리 — 컨테이너 `t179-qa-db` 제거(`docker rm -f`, 남은 수 0), 변경 전 사본 `~/.node-local/t179-qa-base` 제거, 임시 비밀번호 파일 제거. 띄운 next 4기동(변경 후 2 · 변경 전 2)은 모두 PID 로 종료했고 `t179-qa-*.result` 에 `stopped … alive_after=no` 기록, 3179·3180·33179 포트는 비어 있다. 다른 프로젝트의 `next-server`(운영 pm2) 프로세스는 건드리지 않았다. 로그·.gl·.result·스키마 파일은 `~/.node-local/` 에 남김.
- [12:01] QA 판정: pass — 전체 jest 새 실패 0(416 = 기준, 이름 집합 일치), tsc·next build 종료 0, 실기동 2회에서 ensure_setup 1회·재기동 시 실패 DDL 0, 변경 전 2벌·실패 12건과 대비, 스키마 동일. 미검증: 운영 시간 개선, 주문 경로 실행 검증, release.sh 재배포 경로(위 9·11·12 참고).
- [17:05] (실행 도구: claude, qa) 후속 1 — 환경: 서버 `~/.node-local/stockinvest-t179s`(브랜치 `t179-safety-tests`, HEAD `cbe24e2`, 미커밋 M 3개 + `node_modules`). 운영 pm2·운영 DB·`.env` 미사용. 훅 시험의 실 커밋 시나리오는 스크립트 안의 `mktemp -d` 일회용 저장소에서 수행됨을 스크립트로 확인.
- [17:05] 1) `bash scripts/test-git-hooks.sh > ~/.node-local/t179s-qa-hooktest.log 2>&1` — 종료 코드 0, 마지막 줄 「✅ 전체 검증 통과.」, 결과 `536 통과 / 0 실패`. 로그의 ❌ 줄 0건. `(t179` 로 시작하는 10건(`(t179-neighbor)` 1건 + `(t179)` 9건) 전부 통과 표시. 세 신규 시험 파일 각각에 대해 「미검토 차단 · 이웃 scope 차단 · 정확 scope 통과」가 확인됐다(`process-state` · `optional-ddl-alerts` · `setup-ddl-disposable-mariadb`, 로그 159–167행).
- [17:05] 2) 실행 전 `git status --short` = 실행 후 동일: `M agent-vault/10-Flow/tasks/T-179-boot-setup-ddl-contention.md` · `M scripts/git-hooks/commit-msg` · `M scripts/test-git-hooks.sh` · `?? node_modules`. fixture 잔존 없음. 실행 후 HEAD 는 `cbe24e2` 그대로이고 reflog 최신 항목은 16:58:21(실행 전부터 있던 기록)이라, 이 worktree 에 커밋이 만들어지지 않았다.
- [17:05] 3) 훅 적용 확인 — `git config --get core.hooksPath` = `scripts/git-hooks`(상대 경로, 이 worktree 기준). `scripts/git-hooks/commit-msg` 존재, 권한 `-rwxrwxr-x`, 실행 가능(`test -x` 통과). 시험 로그의 E2E 에서 실 `git commit` 이 훅에 의해 차단됨(exit 1, HEAD 변동 없음)을 확인했다. 따라서 이 worktree 의 커밋에는 훅이 실제로 적용된다.
- [17:05] 4) 감시 목록 — `scripts/git-hooks/commit-msg` 의 `SAFETY_PATHS` 에 세 시험 파일이 정확 일치 항목(라인 703–705, 경로 정확 일치 형식)으로 들어 있음을 확인. diff 는 `scripts/git-hooks/commit-msg` 21행 추가, `scripts/test-git-hooks.sh` 29행 추가, 기록 파일 13행 추가로 설명된 범위와 일치.
- [17:05] 범위 메모 — 이번 QA 는 커밋 훅 시험과 훅 적용만 검증했다. 앱 코드 변경의 검증은 위 12:01 기록(전체 jest 새 실패 0, tsc·build, 실기동)이 맡으며 이번에 다시 실행하지 않았다.
- [17:05] 미검증 — ① 다른 worktree·다른 머신에서의 훅 적용. 특히 Mac 세션은 `core.hooksPath` 경로가 서버에만 있어 CLAUDE.md 기록대로 커밋이 무검사일 수 있다(이번 확인 범위 밖) ② 훅 시험이 통과해도 실제 Reviewer 판정 줄(scope)은 이 QA 가 판정하지 않는다 ③ 앱 기능 자체는 이번에 실행하지 않았다.
- [17:05] QA 판정: pass — 훅 시험 536 통과 / 0 실패, `(t179` 10건 전부 통과, 실행 전후 워킹트리 동일(fixture 잔존 0), 실 커밋 차단과 `commit-msg` 실행 가능 확인, 신규 시험 3개 감시 등록 확인. 미검증 항목은 위 ①~③.

## Leader 판단

- [12:2x] Medium-1 후속에서 「더 긴 상한으로 1회 재시도」는 넣지 않는다 — 재시도가 MDL 대기열을 다시 길게 만들 수 있다. 대신 1205 실패를 알림으로 알리고, 앱이 바로 필수로 읽는 새 컬럼은 배포 전 마이그레이션으로 넣는다(db.ts 주석).
- [12:2x] 커밋 훅 감시 목록(SAFETY_PATHS)에 새 시험 `process-state.test.ts`(권고)·`setup-ddl-disposable-mariadb.test.ts`·`optional-ddl-alerts.test.ts`(선택)를 넣는 일은 훅 파일 자체가 감시 대상이라 이 PR 과 섞지 않고 후속으로 분리한다.
- [12:2x] 배포 스크립트(release.sh)가 매 배포마다 옛 경로로 프로세스를 잠깐 띄웠다 지우는 동작(3번째 setupDB)은 공용 인프라(HOME-SERVER_CONFIG) 범위라 이 task 밖이다 — 사용자 결정 후보.

- [17:0x] 후속 1 범위: Reviewer 의견 5의 권고(process-state)와 선택 2개(optional-ddl-alerts·setup-ddl-disposable-mariadb)를 모두 넣는다 — 둘 다 이번 변경의 안전 주장(5초 포기가 조용하지 않음·스키마 결과 동일)을 지키는 시험이고, 넣어도 평소 커밋 마찰은 이 시험을 고칠 때만 생긴다. 디렉토리 단위가 아니라 파일 정확 일치(T-156 방식). `boot-diagnostics.ts` 는 넣지 않는다.

## 배포 기록

- [12:10] PR #3 머지 — 머지 커밋 `a6125c8`(한글 문구, Gitea API). 머지 직전 main `08657ef`(T-178) 와 바뀐 파일 겹침 없음, mergeable=true.
- [12:11] webhook blue/green 배포 `RELEASE_RESULT ok` — 릴리스 `20261120-121047-a6125c85`(이전 `20261120-115721-08657efd`). DB 마이그레이션 없음. 같은 배포에 실린 다른 작업: 없음(main 은 T-178 병합 `08657ef` 위에 이 머지만).
- [12:11] 운영 시작 진단: 새 프로세스의 `ensure_setup` **5.1초** 완료(변경 전 배포들 13~124초), complete 1건. `ensure_setup start` 2줄 중 1줄은 release.sh 가 옛 경로(옛 코드)로 잠깐 띄운 프로세스(예상대로). 헬스 200·db true·schemaFatal false·safety green·DRY_RUN 켜짐·Kill Switch 꺼짐. `1205`·부팅 DDL 알림 0건.
- [12:3x] 미배포 — PR #3(https://git.xn--lh0b87pnudm10a4vd.com/brownjeon/project_StockInvest/pulls/3) 생성, 브랜치 `t179-boot-setup-ddl`(`c01b6bd`). 머지(=운영 배포)는 사용자 승인 대기. 생성 시 Gitea mergeable=true, 그 사이 main 에 들어온 T-178(`08657ef`)과 바뀐 파일이 겹치지 않음.

## 실행 도구·절차 이력

| event | 시각 | 종류 | 도구 / 절차 | 범위 | 근거 |
|---|---|---|---|---|---|
| E1 | 2026-11-20 11:1x | start | claude / claude_standard | 원인 확인·설계부터 구현·감사·QA·PR 생성까지(머지 제외) | 사용자 「이슈기록 등록 및 작업 진행해줘. 이번에는 PR등록해서 관리」 + 작업 선택 「시작 시 DB 준비 지연」 |
| E2 | 2026-11-20 12:2x | handoff | claude / claude_standard | Reviewer PASS(재검증 포함)·QA pass 후 브랜치 커밋·push·Gitea PR 생성. 머지는 사용자 승인 대기 | 사용자 「이번에는 PR등록해서 관리」 |
| E3 | 2026-11-20 12:10 | deploy | claude / claude_standard | PR #3 검토·한글 문구로 머지(=운영 배포)·배포 확인 | 사용자 「검토 후 머지해주고 머지할 때의 문구도 한글로 기록해줘」 |
| E4 | 2026-11-20 17:0x | resume | claude / claude_standard | 후속 1 — 커밋 훅 감시 목록에 새 시험 3개 추가(구현·Reviewer·QA·브랜치 커밋·PR 생성). 머지는 PR 검토 후 | 사용자 「커밋 훅 감시 목록에 새 시험 추가 PR로 진행」 |

## 최종 요약

### [T-179] 앱 시작 시 DB 준비 지연 해소

- **상태**: 완료(배포됨, 2026-11-20 12:11 KST)
- **무엇이 바뀌었나**: 앱이 시작할 때 DB 준비가 한 프로세스에서 두 번 동시에 돌며 같은 테이블의 잠금을 서로 기다리던 문제를 고쳤다. 이제 프로세스당 한 번만 돌고, 이미 있는 컬럼·인덱스는 다시 만들지 않는다. 운영 시작 시 DB 준비가 13~124초 → 5.1초.
- **배포**: PR #3 머지 `a6125c8` → 릴리스 `20261120-121047-a6125c85`, ok. 같은 배포의 다른 작업 없음. 웹 버전 0.19.0. 앱(APK) 무관.
- **AI 가 검증한 것**: Reviewer PASS(재검증 포함) · QA pass(전체 jest 새 실패 0, tsc·build 0, 임시 DB 실기동 2회) · 운영 시작 진단 5.1초·헬스 정상.
- **AI 가 검증하지 못한 것**: 공유 DB 가 바쁜 시각(장중·다른 앱 부하)의 시작 시간 — 다음 배포들의 시작 진단으로 확인.
- **👉 사용자가 확인할 것**: 없음.
- **👉 사용자가 결정할 것**: release.sh 가 배포마다 옛 경로로 프로세스를 잠깐 띄우는 동작을 고칠지(공용 인프라, 다른 앱에도 영향).
- **남은 일**: 새 필수 컬럼은 배포 전 마이그레이션으로. (후속 1 — 커밋 훅 감시 목록에 새 시험 3개 추가: Reviewer PASS·QA pass 후 PR 로 진행, 머지 결과는 배포 기록에 적는다.)
- **이슈·위험**: 실패 무시 DDL 묶음에 앱이 읽는 컬럼이 섞여 있다 — 잠금 대기 5초 초과로 빠지면 알림이 간다(30분 간격).
