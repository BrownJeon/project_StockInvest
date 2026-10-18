---
task_id: T-048
title: signals 유니크 인덱스 마이그레이션 — post-market 카드 (symbol·side·valid_from·scenario_source) 구조적 유일성 (사용자 승인 대기)
status: done
priority: high
roles_involved: [leader]
related_tasks: [T-045, T-046, T-043]
tags:
  - type/task
  - domain/safety
  - domain/db
aliases:
  - signals 유니크 인덱스
  - signals unique index migration
created: 2026-10-18
updated: 2026-10-18
---

# T-048 — signals 유니크 인덱스 (운영 DB 스키마 변경, **사용자 승인 전 실행 금지**)

## 왜

T-045 의 `INSERT … WHERE NOT EXISTS` 는 운영 격리수준(REPEATABLE READ)에 기대는 방어일 뿐 구조적 유일성이 아니다(READ COMMITTED 면 300/300 중복 — T-045 Reviewer 실험). T-046(카드 시각 수정)으로 카드가 **실제로 주문을 내기 시작하기 전에** 구조적 방어가 필요하다(T-045·T-043 감사의 순서 게이트). 유니크 인덱스가 그 구조적 방어다.

## 실측 (2026-10-18 읽기 전용)

- 운영 DB: MariaDB **10.11.11**, REPEATABLE-READ, `signals` 19,075행, InnoDB. `symbol varchar(32) NOT NULL`, `side enum NOT NULL`, **`valid_from datetime NULL`**, **`scenario_source varchar(32) NULL`**.
- 키 컬럼이 전부 채워진 행은 **post-market 카드 46행뿐**(나머지 19,029행은 둘 다 `NULL`, 사용자 시나리오 `user` 9행은 `valid_from NULL`). MariaDB 유니크 인덱스는 `NULL` 을 서로 다른 값으로 취급하므로 **이 인덱스가 실제로 제약하는 것은 그 46행뿐**이다.
- 중복 그룹 **4개, 초과 6행** — 전부 `expired`/`superseded`, **`consumed_order_id` 가 있는 행 0건**:

| 그룹 | 행 | 남길 행 | 정리할 행 |
|---|---|---|---|
| 005380 buy @2026-07-20 | 12342·12363·12364 (모두 expired) | 12342 | 12363, 12364 |
| 347700 buy @2026-08-17 | 17240·17243·17244 (모두 expired) | 17240 | 17243, 17244 |
| 005380 buy @2026-10-19 | 19077 (pending) · 19100 (superseded) | 19077 | 19100 |
| 055550 buy @2026-10-19 | 19078 (pending) · 19099 (superseded) | 19078 | 19099 |

- `scenario_source` 사용처: `varchar(32)` 라 값 제약 없음. 코드는 `'user'` 일 때만 따로 처리(그 외는 AI 시나리오), `/api/signals` 필터가 정확 일치로 거를 뿐 — `post-market-dup-<id>` 로 바꿔도 화면·로직에 영향 없음.

## 제안 (Leader 권고)

**1단계 — 중복 6행의 키를 비운다(행은 보존).** 같은 값으로 바꾸면 3행 그룹의 초과 2행이 서로 충돌하므로 **행마다 다른 값**:

```sql
START TRANSACTION;
UPDATE signals
   SET scenario_source = CONCAT('post-market-dup-', id)
 WHERE id IN (12363, 12364, 17243, 17244, 19099, 19100)
   AND scenario_source = 'post-market'
   AND status IN ('expired', 'superseded')
   AND consumed_order_id IS NULL;
-- affectedRows 가 정확히 6 이 아니면 ROLLBACK, 맞으면 COMMIT
```

**2단계 — 유니크 인덱스 생성 (온라인, 약 10ms 규모):**

```sql
SET SESSION lock_wait_timeout = 5;      -- 메타데이터 락 대기가 길어지면 쓰기들이 줄줄이 막히므로 5초 만에 포기
ALTER TABLE signals
  ADD UNIQUE INDEX uq_signals_scenario_card (symbol, side, valid_from, scenario_source),
  ALGORITHM = INPLACE, LOCK = NONE;
```

**3단계 — 확인:** `SHOW INDEX`, 롤백되는 트랜잭션에서 기존 키 중복 INSERT 가 `1062` 로 거부되는지, `/api/health`.

**롤백(언제든):**

```sql
ALTER TABLE signals DROP INDEX uq_signals_scenario_card;
UPDATE signals SET scenario_source = 'post-market'
 WHERE id IN (12363, 12364, 17243, 17244, 19099, 19100) AND scenario_source = CONCAT('post-market-dup-', id);
```

실행 도구: 1회성 스크립트(드라이런 기본, `--apply` 로 실행). 사전 점검(대상 행이 위 표와 정확히 같은지·긴 트랜잭션 없음·장외)에 하나라도 어긋나면 중단, 1단계 후 2단계가 실패하면 **자동으로 1단계를 되돌린다**. 실행 전 6행 전체와 `SHOW CREATE TABLE` 을 백업한다.

## 일회용 DB 사전 시험 (2026-10-18, MariaDB 11.8.8 — 운영 10.11.11 과 버전이 다름)

| 시험 | 결과 |
|---|---|
| 정리 전 인덱스 생성 | `1062` 로 실패 (정리 선행 필요 확인) |
| **같은 값 `post-market-dup` 으로 정리** | 3행 그룹의 초과 2행이 서로 충돌 → 인덱스 생성 실패 — **이 시험이 초안의 결함을 잡아 행별 값(`-<id>`)으로 수정** |
| 수정한 정리 SQL | 6행 정확히 갱신 |
| 인덱스 생성 `INPLACE, LOCK=NONE` | 성공 10ms, `Non_unique=0` |
| `NULL × NULL` 행 | 허용 (나머지 19,029행 영향 없음) |
| 중복 카드 직접 INSERT | `ER_DUP_ENTRY (1062)` |
| T-045 의 `NOT EXISTS` 문장 | 그대로 정상 (중복 0행 / 다른 날짜 1행) |
| **동시 삽입 12연결 × 150키** | REPEATABLE READ·**READ COMMITTED 모두 중복 0건**, 150행 정확히 — 패배 쪽은 오류(1467/1062) |
| 롤백 | 정상 |

→ 인덱스가 생기면 T-045 문서의 "DB 격리수준을 READ COMMITTED 로 바꾸지 말 것" 조건이 사라진다.

## 알려진 한계·결정 사항

1. **버전 차이**: 시험은 11.8.8, 운영은 10.11.11. 유니크 인덱스 온라인 생성·`NULL` 의미는 두 버전 공통 표준 동작이지만 **운영에서의 DDL 은 마지막까지 실측되지 않는다**(그래서 `lock_wait_timeout`·자동 되돌리기를 둔다).
2. **이 인덱스는 지금 `valid_from` 정확 일치를 막는다.** T-046 이 `valid_from` 값(00:00 → 09:00)을 바꾸면 같은 거래일의 구·신 카드는 인덱스가 서로 못 알아본다 → T-046 은 앱 쪽 `NOT EXISTS` 를 `DATE(valid_from)` 기준으로 하고 배포 전 구 `pending` 카드를 정리해야 한다(전환일 한정, 동시 실행 구멍은 그날만). 대안(생성 컬럼 `DATE(valid_from)` 위의 유니크 인덱스)은 컬럼 추가라 변경이 크다 — **권고하지 않음**.
3. **코드는 `ER_DUP_ENTRY` 를 duplicate 로 처리하지 않는다** — 동시 삽입에서 진 쪽이 `insert_fail` 로 보고될 뿐 중복은 생기지 않는다. 매핑(errno 1062 → duplicate)은 엔진을 건드리는 T-046 에 묶는다(코드 → 마이그레이션 순서는 어느 쪽이든 안전).
4. **부팅 시 자동 `ALTER`(db.ts) 방식을 쓰지 않는다**: 정리가 선행돼야 하고, 생성 실패를 삼키는 `try/catch` 관행과 맞지 않으며, 개발·운영이 같은 DB 라 배포가 곧 스키마 변경이 된다. 새 환경 부트스트랩 반영은 별도 판단.

## 사용자 결정 (미응답)

- [ ] 실행 승인 (장외인 지금~일요일 중. 월요일 09:00 전)
- [ ] 정리 방식: **권고 = 행 보존(scenario_source 변경)** / 대안 = 삭제 / `valid_from` NULL
- [ ] 인덱스 형태: **권고 = (symbol, side, valid_from, scenario_source)** / 대안 = 생성 컬럼 기반

## Leader 기록

- [10-18] 사용자 "진행해줘" — 직전 제안(**읽기 전용 조사**)에 대한 승인으로 읽음. 운영 DB 쓰기 없음. 실행은 위 결정 후.
- [10-18 16:4x] **사용자 승인 "실행해줘"**(권고안: 행 보존·인덱스 `(symbol, side, valid_from, scenario_source)`). `migrate-t048.js --apply` 실행이 Claude Code 자동 권한 분류기에 "공유 자원 수정"(운영 DB 스키마 변경)으로 **거부됨** — 우회하지 않고 중단. 거부 직후 드라이런으로 **DB 불변 확인**(인덱스 없음·중복 4그룹 그대로·백업 파일 0개·`signals` 19,075행). 사용자가 직접 실행하거나 권한 규칙을 허용해야 진행된다(명령은 아래).
  - 직접 실행: `cd /tmp/claude-1000/-home-brownjeon-NFS-homes-brownjeon-project/79cdec39-27b7-459c-a488-3c4755cd39d0/scratchpad && node migrate-t048.js --apply` (사전 점검 → 백업 → 정리 → 인덱스 → 검증, 실패 시 자동 되돌림) · 되돌리기 `node migrate-t048.js --rollback`.
- [10-18 17:46] **적용 완료**: 사용자가 `node migrate-t048.js --apply` 를 직접 실행(자동 권한 분류기가 Leader 실행을 거부한 뒤). 출력: 사전 점검 전부 ✔ · 백업 `t048-backup-2026-10-18T08-46-11-309Z.json`(6행+SHOW CREATE TABLE) · 1단계 affectedRows 6 · **2단계 인덱스 생성 13,621ms**(제안서의 "약 10ms 규모"는 일회용 DB(수백 행) 값이라 운영(19,075행·큰 JSON 컬럼·NAS)에서는 약 1000배 걸렸다 — `LOCK=NONE` 온라인 DDL 이라 앱 오류 로그 0건·헬스 정상) · 3단계 컬럼 `symbol, side, valid_from, scenario_source` `Non_unique=0` · 중복 INSERT `1062` 거부.
- [10-18 17:47] **Leader 독립 검증(읽기 전용 + 롤백 트랜잭션)**: 인덱스 BTREE·unique ✔ · 정리 6행이 각각 `post-market-dup-<id>` · 유지 6행(12342·17240·19077~19080) 상태 불변(카드 4장 pending) · 남은 중복 그룹 0 · T-045 `NOT EXISTS` 문장(기존 키 0행 / 새 종목 1행) 정상 · 직접 중복 INSERT `1062` · 롤백 후 `signals` 19,075행·잔여 가짜 행 0 · 백업 6행+DDL 포함 · `/api/health` ok.
- [10-18] 일회용 DB 시험 중 정리 SQL 결함 발견·수정(위). 컨테이너(`t-ddl-scratch`, 기존 `mariadb:11` 이미지, 127.0.0.1 전용·볼륨 없음)는 정리 확인.
