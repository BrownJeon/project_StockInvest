---
task_id: T-135
title: T-112 기록기(judgment-recorder·job-run-log)의 매달린 INSERT 풀 연결 점유 상한 + 크론 러너 call() 의 /tmp 본문 파일(644) 보호
status: in-progress
priority: medium
project: StockInvest
created: 2026-10-31
updated: 2026-10-31
base_ref: c593300 (로컬 main — origin/main ad45efc 의 문서 1커밋 앞)
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa]
related_tasks: [T-131-t126-t130-followup-candidates, T-126-exit-judgment-persistence, T-127-job-run-spool-hardening, T-112-run-judgment-record-foundation, T-134-exit-engine-state-load-isolation]
tags:
  - type/task
  - domain/safety
  - domain/records
aliases:
  - 기록기풀점유러너tmp
waiting: []
demo_gate:
  required: false
  level: "none"
  status: "not_required"
  version: 0
  repo_path: ""
  artifact_url: ""
  content_sha256: ""
  decided_by: "judge"
  rule_id: ""
  approved_by: ""
  approved_at: ""
  approval_quote: ""
  waived_by: ""
  waived_at: ""
  waiver_quote: ""
  active: false
---

## 발단

[[T-131-t126-t130-followup-candidates]] 4번·15번 — 사용자 지시 「권고대로 착수」(2026-10-31, 후속 우선순위 3순위 묶음). 둘 다 이미 운영에 켜져 있거나 모든 크론 잡의 경로에 있는 코드다.

### A. 매달린 INSERT 가 풀 연결을 잡고 있는 문제 (T-131 4번)

[[T-126-exit-judgment-persistence]] Reviewer R1 이 **재현**했다: 기록기가 `getPool().query` 로 INSERT 를 보내고 4초 상한(`withDeadline`)은 **호출자의 기다림만** 끊는다. DB 쪽에서 INSERT 가 멈추면(메타데이터 잠금·디스크 정지 등) 연결은 응답이 올 때까지 풀로 돌아오지 않는다(풀 `connectionLimit: 10`, `queueLimit: 0` — `src/lib/db.ts`). 풀은 주문 승인·`submitOrder`·UI 와 공유다. 운영 `lock_wait_timeout` GLOBAL 은 86400초(읽기 SELECT 로 확인)라 대기는 하루까지 갈 수 있다. T-126 은 `getConnection()` + 상한 시 `destroy()` 로 고쳤고(`exit-judgment.ts:326-430`), **T-112 기록기는 같은 성질 그대로**다:

| 기록기 | 상한 | 풀 사용 위치(HEAD c593300, 줄은 근사) |
|---|---|---|
| `src/lib/strategy/records/judgment-recorder.ts` (`judgment_*`, **스위치 아직 꺼짐**) | `JUDGMENT_RECORD_TIMEOUT_MS=4000` | `lookupCardIds`·`readLlmSetting` 조회(~275), `judgment_run` INSERT(~307-320), 이후 후보 INSERT |
| `src/lib/strategy/records/job-run-log.ts` (`job_run_log`, **스위치 켜짐 — 10-30 21:05**) | `JRL_DEADLINE_MS` | `recordSpoolBatch` 안 `upsertAll` 의 `db.query`(~582·589), `getPool()` ~618 |

`job_run_log` 는 러너가 틱마다 POST 하므로(약 분당 1회) 켜져 있는 지금 가장 빈도가 높다. [가능성 높음] 지금까지 문제가 없었던 것은 표가 잠기는 사건이 없었기 때문이다(재현은 일회용 DB 에서만).

### B. 러너 `call()` 의 `/tmp/cron-runner-$$.out` (T-131 15번, [[T-127-job-run-spool-hardening]] Reviewer L-1)

`scripts/cron-runner.sh` `call()`(~62)이 응답 본문을 **umask 기본값(보통 022) → 644** 로 `/tmp/cron-runner-<pid>.out` 에 쓴다. 이 파일은 호출 동안(수 초~수십 초) 남고, 본문에는 금액을 싣는 라우트(`portfolio-snapshot`·`trade-report`)의 JSON 이 들어갈 수 있다. T-127 이 스풀(마스킹 후)은 0600 으로 만들었지만 **마스킹 전 원문이 이 임시 파일에 world-readable 로 남는다.** 또 응답이 200 이 아니면 러너 로그에 본문 앞 200자가 그대로 찍힌다(~70).

## 관련 과거 이력 요약 (Leader)

- 승인된 교훈(`issues related safety strategy cron`): **없음**.
- T-126 Reviewer R1/R3/R4: 연결 수명주기 규칙 — 기록 1회가 받는 연결은 하나, `connDone` 으로 한 번만 끝냄, 상한이 **연결을 기다리는 중에** 오면 나중에 받은 연결로 INSERT 하지 않고 즉시 release, 오류·상한 시 `destroy()`, 정상만 `release()`. 이중 destroy 는 실 mysql2 에서 무해하지만 시험이 잡았다. mysql2 쿼리 옵션 `timeout` 은 처방이 아니다(연결이 안 돌아옴 — 재현됨).
- T-126 시험 방식(재사용): 일회용 MariaDB(docker)에서 **표를 잠근 채 12틱 이상 → 풀 busy 0·무관한 쿼리 통과·서버 대기 INSERT 가 몇 초 안에 사라짐·잠금 해제 뒤 늦게 써진 행 0**. 참고 파일: 스크래치패드 `rev-t126/`(`rev-t126-pool3.test.ts`·`run-db3.sh`·`run-db4.sh`), 저장소 `src/lib/strategy/records/__tests__/exit-judgment-disposable-mariadb.test.ts`.
- T-127: 러너 umask 는 **전체를 바꾸지 않고** 함수 안에서만 077 로 두었다(`jrl_hook`·`jrl_flush` 겉함수, 서브셸 금지 — `JRL_FAILING` 유지). 새 시험은 `scripts/test-cron-runner-job-run-log.sh`(J1~J11), 기존 러너 시험 6종 약 40분, 무거운 시험은 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10` 직렬.

## 범위 (이번에 한다)

**A. 기록기 풀 점유 상한**
1. 공용 헬퍼 **새 파일**(예: `src/lib/strategy/records/bounded-conn.ts`)로 T-126 의 연결 수명주기(받기·상한 시 destroy·늦게 받으면 INSERT 없이 release·한 번만 끝내기)를 구현하고 `judgment-recorder.ts`·`job-run-log.ts` 의 **쓰기 경로**가 쓴다. 한 기록(판단 1회 / 스풀 배치 1회)이 연결을 **하나**만 잡고 그 연결로 모든 문장을 보낸다.
2. 정상 경로의 결과는 달라지지 않는다: 반환 status 값·행 수·`rejected`/`rowErrors` 집계·ODKU 문장·값 오류 시 한 줄씩 재시도·`no_table`/`skipped_*` 분기·경고 문구·상한 값.
3. 시험: 단위(목 풀) + **일회용 MariaDB**(위 T-126 방식) — 각 기록기마다 「표 잠금 + 12회 이상 → 풀 여유·무관한 쿼리 통과·서버 대기 INSERT 소멸·늦은 행 0」과 정상 경로 동치(변경 전 트리 대조) + 변이 시험(연결 destroy 삭제, 늦게 받은 연결 INSERT 허용 등이 시험을 깨뜨리는지).

**B. 러너 임시 본문 파일**
4. `call()` 의 본문 파일을 **생성 시점부터 0600**(`mktemp` + 함수 안에서만 umask 077, 러너 전체 umask 불변, 서브셸 금지)으로 만들고, `jrl_hook` 이 하드코딩된 `/tmp/cron-runner-$$.out`(~241·245) 대신 같은 변수를 읽게 한다. 정상 반환 뒤 파일 잔존 0. 러너가 호출 중 죽어도 잔존이 **누적되지 않는** 방법(예: 시작 시 오래된 임시 파일 정리, 고정 이름 유지, 0700 로컬 디렉터리) 중 하나를 고르고 이유를 적는다.
5. 비-200 응답의 로그 `body=` 줄은 금액 키 마스킹(`jrl_mask_money`)을 **거친 뒤** 앞 200자를 찍는다(모든 라벨 — 로그 줄만 대상이고 스풀 경로의 라벨 구분은 건드리지 않는다).
6. 시험: `test-cron-runner-job-run-log.sh` 에 케이스 추가(umask 022 로 시작해도 파일 600, 정상·비정상 응답 뒤 잔존 0, 로그 `body=` 마스킹, 호출 중 kill 뒤 잔존이 다음 정리로 사라짐/누적 안 됨) + 변이 시험. 기존 러너 시험 6종 전부 재실행.

## 불변 조건 (바꾸지 않는다)

- `call()` 의 반환값·`CALL_LAST_CODE`·로그 줄 형식(`[ts] <label> OK` / `HTTP=<code> body=…`)·`curl` 인자·`--max-time` 처리·`jrl_hook` 호출 위치와 인자·스풀 줄 형식 `v1\t…`·스풀 0600 은 그대로다. 모든 크론 잡이 이 경로를 쓰므로 한 줄 차이가 전 잡 영향이다.
- 기록기: 스위치 판정·캐시(`record-switch.ts`), 스키마·DDL, 서버 라우트(`/api/cron/job-run-log`) 응답 형식, 분석 엔진 파일(`post-market-*.ts`)은 건드리지 않는다.
- **`exit-judgment.ts`·`engine.ts` 는 건드리지 않는다**(방금 배포돼 곧 스위치가 켜진다 — 공용 헬퍼로 합치는 정리는 별도 후속). `src/lib/exchanges/*`(다른 세션 T-133 작업 중)도 금지.
- 운영 DB 쓰기·`system_config`·pm2·push·배포 금지. 시험 DB 는 일회용 docker MariaDB 만.

## 하지 않는 것 (범위 밖 — 「범위 밖 발견」에만 적는다)

- **T-131 16번(마스킹 라벨이 두 개로 고정)은 이번에 하지 않는다.** Reviewer(T-127) 판단: 현재 금액을 싣는 라우트는 그 두 개뿐이고 새 라벨이 생길 때 발생하는 잠재 문제다. 라벨 목록을 바꾸면 변이 시험이 이미 「모든 라벨 마스킹 = 비금액 라벨 진단 본문 손실」을 막고 있어 의미 변경이 크다. 새 call 라벨 추가 시 점검 항목으로 T-131 에 남긴다.
- `record-switch.ts` 의 스위치 읽기(`pool.query` 2초 대기 상한)의 풀 점유, 롤업 `runs` 중복(17번), `exit-judgment.ts` 와의 헬퍼 통합, pm2 로그 회전, 숫자 문자열·줄바꿈 마스킹(L-2).

## 판단 기록 (judge)

- [2026-10-31 15:19] intake engine=jev → task_type=local_fix · risk=R2 · developer_model=opus · next=assign · demo=none/- · actions=assign_developer | overrides=- | fallback=- | tokens=1422

## 진행 기록

- [2026-10-31 15:2x] 등록(Leader). 사용자 「권고대로 착수」. [[T-134-exit-engine-state-load-isolation]] 와 파일이 겹치지 않아 병행. 러너 시험이 약 40분 + 일회용 DB 시험이라 가장 오래 걸린다.

## Developer

## Reviewer

## QA

## Codex 검토

- [2026-10-31] 호출 생략 예정 — Codex 모델 설정 장애([[T-131-t126-t130-followup-candidates]] 19번). judge 가 `codex_required: true` 를 내면 `override: Codex 모델 설정 장애(실패 확인됨)` 로 기록하고 진행한다.

## 최종 요약

(미작성)

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 해당없음 | - | - | judge: none | 10-31 15:21 |
