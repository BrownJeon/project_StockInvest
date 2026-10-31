---
task_id: T-135
title: T-112 기록기(judgment-recorder·job-run-log)의 매달린 INSERT 풀 연결 점유 상한 + 크론 러너 call() 의 /tmp 본문 파일(644) 보호
status: deployed
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
waiting: [배포 후 관찰: 상한 타임아웃이 실제로 났을 때 PROCESSLIST 로 서버 쪽 정리 확인 · 다음 전송 실패 때 스풀 파일 0600 확인]
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

## 배포 기록

- [2026-10-31 19:27] **배포 완료.** 사용자 승인: 배포 시점 질문(「T-134·T-135 배포 시점을 정해 주세요」)에 대한 답 **「오늘 검증 통과 시」** — 합친 상태 검증이 통과하면 20:00 창 안에서 배포. 사전 검증(19:11~19:12, 별도 worktree `stockinvest-integ2` = 당시 `main` d454414 위에 두 커밋을 얹음): `tsc` 오류 0 · jest 149 스위트 4442 통과·실패 0(제 시험 + T-133 시세 시험 + 격리 시험 포함) · `next build` 컴파일·타입 검사 통과(`.next` 323MB). 배포 직전 가드 7개 통과(시각 19:27 · `origin/main`=`90f858f` · push 가 실을 코드는 이 두 건뿐 · 메인 체크아웃 작업 트리 깨끗 · **`main` 트리 해시 = 검증한 트리 해시 `dd1cb3bd…`** · 안전 키 불변 · health green).
- push `90f858f..8ed1ba7`(19:27:34): 코드 커밋 `c1e8aea`(T-134)·`8ed1ba7`(T-135) — 별도 브랜치의 `bf9980a`·`0957125` 를 cherry-pick 한 것 — 과 문서 커밋 2개. webhook blue/green 19:27:54 시작 → 19:30:17 종료 `exit=0`, `RELEASE_RESULT {"status":"ok","release":"20261031-192807-8ed1ba7b",…,"migrated":false}`. 이전 릴리스 `20261031-185943-90f858f5`(롤백 대상). 마이그레이션·DDL·스위치 변경 없음. **같은 배포에 실린 다른 작업**: T-134 ↔ T-135 서로, 문서 커밋(T-133 배포 기록 `8f2d71a`·이 task 들의 마감 `d454414`).
- 배포 후 읽기 확인(19:30~19:32): `current` → 새 릴리스 · 새 릴리스에 `bounded-conn.ts` 존재, `engine.ts` 의 `exit_state_load_failed` 2곳, `cron-runner.sh` 의 `call-tmp` 2곳 · pm2 `stockinvest`·`stockinvest-cron` 둘 다 online·restarts 0·exec cwd 새 릴리스 · 러너 프로세스 1개(pid 1720751, 19:28:37 시작, cwd 새 릴리스) · `call-tmp` 디렉터리 `drwx------`(0700)·잔존 파일 0 · `/tmp/cron-runner-*` 잔존 0 · 스풀 파일 없음(재전송 완료) · `job_run_log` 222행·마지막 기록 19:31:45 로 틱마다 증가 · 배포 후 non-ok 1건(`portfolio-snapshot` skipped `markets_closed` — 토요일 휴장) · `SHOW PROCESSLIST` 에 기록 표 INSERT 체류 없음 · 안전 키 5개 값·시각 불변, `exit_judgment_record_enabled` true 유지, `exit_judgment` 행 0(토요일) · health green(`safety.dryRun true`·`killSwitch false`).
- 컷오버 순간 관찰(이상 아님): 19:28:37 `job-run-log 전송 실패 HTTP=000`(웹 재기동 중 연결 거부), 19:28:42 `HTTP=503 reason=timeout`(웹 프로세스 콜드 스타트) — 스풀에 남겨 다음 틱에 재전송돼 비워졌다. **`reason=` 형식을 운영에서 처음 관찰**([[T-127-job-run-spool-hardening]] 의 「운영 미관찰」 항목 중 하나 해소). 오늘 같은 `503 reason=timeout (deadline=2500ms)` 서버 로그는 15:44:48·19:08:27·19:27:41(배포 시작 직전, 옛 코드)에도 있었고 이전 관찰의 기저선(하루 약 16건)과 같아 **이번 변경 때문이라는 증거는 없다** [가능성 높음].
- **운영에서 못 본 것**: ① 호출 중 응답 임시 파일의 실제 모드(0600) — 파일이 호출 동안(수 ms~수 초)만 존재해 점검 시 디렉터리가 비어 있었다(QA 가 임시 HOME 에서 실제 curl 로 확인) ② 시작 시 죽은 러너 파일 정리 — 새 디렉터리가 비어 있었으므로 정리할 대상이 없었다 ③ 상한이 실제로 나서 폐기된 연결의 **서버 쪽 대기 문장이 운영 MariaDB 에서 거둬지는지**(일회용 10.11 에서만 확인) — 평시 PROCESSLIST 는 비어 있었고 폐기 경로가 실제로 돈 증거는 아직 없다 ④ 스풀 파일 0600 — 스풀이 5초 안에 비워져 파일을 못 봤다. 20:07 후속 점검(예약, 세션 한정)과 다음 전송 실패 때 읽는다.
- **롤백**: 이전 릴리스 `20261031-185943-90f858f5` 로(코드만, DDL·데이터 변경 없음). 사용자 승인 사항.
- [2026-10-31 20:07] **배포 후 40분 점검(읽기 전용) — 이상 없음.** ① pm2 두 앱 online·restarts 0·uptime 38분·cwd 새 릴리스, 러너 단일(pid 1720751) ② health green(`dryRun true`·`killSwitch false`) ③ `job_run_log` 마지막 기록 시각이 틱마다 전진(20:07:12 → 20:08:13), 19:31 이후 non-ok 0행. **점검 기준 정정**: 행 수(228)는 68초 동안 그대로였다 — 이 표는 롤업 행을 제자리에서 갱신하므로 「행 수 증가」가 아니라 「마지막 기록 시각 전진」이 올바른 기준이다(이상이 아니라 점검 문구의 오류) ④ `SHOW PROCESSLIST` 에 기록 표 INSERT 체류 없음 ⑤ `call-tmp` 0700 · **호출 중 임시 파일을 표본 추출(68초, 0.05초 간격)로 1건 포착해 모드 600 확인**(`cron-runner-<pid>.<랜덤>`) — 배포 직후 못 본 항목 해소 · 잔존 0 · `/tmp/cron-runner-*` 0 · 스풀 파일 없음 ⑥ 19:31 이후 새 오류 0(감시 키워드 `청산 판단 기록`·`exit_state_load_failed`·`call-tmp` 0건, `pm2-err.log` 마지막 수정 19:28:42, `cron-err.log` 04:44 이후 무변) ⑦ 안전 키 6개 값·시각 불변 ⑧ `exit_judgment` 0행(토요일). **아직 미관찰**: 상한 타임아웃이 실제로 났을 때 폐기된 연결의 서버 쪽 정리(운영 MariaDB), 스풀 파일 0600, 시작 시 죽은 러너 파일 정리, `exit_state_load_failed` 실제 발생.

## 진행 기록

- [2026-10-31 15:2x] 등록(Leader). 사용자 「권고대로 착수」. [[T-134-exit-engine-state-load-isolation]] 와 파일이 겹치지 않아 병행. 러너 시험이 약 40분 + 일회용 DB 시험이라 가장 오래 걸린다.

## Developer

- [17:18] 구현·자체 검증 완료 — 서버 worktree `~/.node-local/stockinvest-t135`(HEAD `c593300`)에 변경으로만 남김(**커밋·push·배포·운영 DB 쓰기·pm2 없음**). 변경 파일(+추가/−삭제 줄): 새 `src/lib/strategy/records/bounded-conn.ts`(184줄, 공용 연결 수명주기) · `judgment-recorder.ts`(+14/−7) · `job-run-log.ts`(+12/−4) · `scripts/cron-runner.sh`(+66/−5) / 시험: 새 `__tests__/bounded-conn.test.ts`(313줄) · `judgment-recorder.test.ts`(+111/−1) · `job-run-log.test.ts`(+119/−1) · `judgment-disposable-mariadb.test.ts`(+149/−1) · `job-run-log-disposable-mariadb.test.ts`(+158/−2) · `judgment-engine-wiring.test.ts`(+23/−5) · `scripts/test-cron-runner-job-run-log.sh`(+176/−7) · `test-cron-runner-{daily-bars,holdings-premarket,news-peek,news-split}.sh`(각 +10~12/−2~3). SAFETY_PATHS: `src/lib/strategy/`·`scripts/cron-runner.sh` 해당(테스트 셸 스크립트는 목록 밖).
- [17:18] 설계 A(기록기 풀 점유): `withBoundedConn(ms, body)` = 예전 `withDeadline(body(), ms)` 와 같은 계약(시간 안 값 / 넘으면 undefined / 시간 안 거부는 던짐)에 연결 끝내기를 더했다. 본문은 `bc.use(getPool())` 로 창구를 열고(**getPool() 호출 자리는 예전 그대로** — 던지는 위치·경고 불변) 첫 문장에서 연결을 **한 번만** 받는다(문장이 없으면 안 받음). 끝내기 한 번: 상한 전 정상 = release, 그 연결에서 문장 오류가 한 번이라도 났으면 destroy(T-126 의 "오류 = destroy" — job-run-log 의 값 오류 한 줄씩 재시도는 같은 연결에서 계속하고 끝에 destroy), 상한·예외 = 잡고 있던 연결 그 자리에서 destroy, 연결을 기다리는 중 상한 = 도착하면 문장 없이 release. 상한 뒤에는 새 문장을 보내지 않고, 상한 뒤 끝난 문장의 결과·오류는 `BoundedConnLateError` 로 바꿔 본문 catch 가 **경고 없이** 끝낸다(바깥이 이미 timeout 한 줄을 남김 — 상한에 연결을 닫으면 매달린 문장이 곧바로 실패하므로 이 처리가 없으면 "기록 실패" 줄이 하나 더 생긴다). 상한 값(4000ms·2500ms)·결과 객체·경고 문구 불변.
- [17:18] 설계 A 범위 판단: 쓰기 문장(판단 기록 INSERT 2개 / job_run_log 묶음·재시도 upsert)만 연결 하나로 묶었다. 판단 기록기의 카드 id 조회(`lookupCardIds`, SELECT)는 **풀 query 그대로** — 같은 연결에 묶으면 조회의 연결 오류가 그 연결을 망가뜨려 "조회가 실패해도 판단 기록은 signal_id NULL 로 남긴다"(T-112 규칙)가 깨진다. 스위치 읽기(`record-switch.ts`)도 그대로(범위 밖). `exit-judgment.ts`·`engine.ts`·`src/lib/exchanges/*` 는 열지도 않았다.
- [17:18] 설계 B(러너 임시 본문 파일) — 고른 방법: **0700 전용 디렉터리 + mktemp(생성 시점 0600·무작위 이름) + 러너 시작 시 정리**. 경로 `CALL_TMP_DIR=~/.node-local/stockinvest/call-tmp`(로컬 디스크), 이름 `cron-runner-<러너pid>.<무작위6>`. 시작 시(`call_tmp_init`) 그 디렉터리를 0700 으로 만들고/맞추고, 이름의 pid 가 **살아 있지 않은**(kill -0 실패) 파일만 지운다 → 호출 도중 죽어도 남는 것은 "직전에 죽은 러너 몫" 하나뿐이고 다음 시작에 사라진다. 다른 안을 버린 이유: trap 은 bash 가 전경 curl 이 끝날 때까지 미루고 pm2 는 kill_timeout(기본 1.6초) 뒤 SIGKILL 이며, 트랩을 걸면 TERM 에 바로 죽던 러너 동작(시험 하네스도 이것으로 러너를 끝낸다)이 바뀐다 · pid 없는 고정 이름은 배포 때 겹친 두 러너(1~3초)가 같은 파일을 덮어써 본문이 섞인다 · /tmp 대신 전용 디렉터리인 이유는 정리 대상을 이 러너 파일로만 좁히려고(같은 사용자의 다른 러너와 /tmp/cron-runner-* 이름이 겹칠 수 있음). umask 077 은 `call_tmp_open` 안에서만, curl 앞에서 되돌린다(잡 curl 은 0022 그대로 — J10·J12 로 확인, 서브셸 없음). mktemp 가 실패하면 예전 이름 `/tmp/cron-runner-<pid>.out` 을 umask 077 아래 미리 만들어(0600) 쓴다 — 본문 파일 실패가 잡 호출·응답 코드를 바꾸지 않는 것이 우선. 비-200 로그 `body=` 는 `head -c 2048 | jrl_mask_money | head -c 200`(모든 라벨, 마스킹 실패 = 빈 값). `jrl_hook` 은 `"${CALL_BODY_FILE:-}"` 를 읽는다(인자·위치 불변). T-131 16번(마스킹 라벨 2개 고정)은 손대지 않았다 — 스풀 라벨 규칙은 그대로(J12 가 strategy-eval 스풀 본문이 원문 그대로임을 확인).
- [17:18] 불변 확인: `call()` 은 `# T-135` 표지 1줄(call_tmp_open) 추가 + 경로 3줄(curl `-o`·로그 body=·rm) 변경뿐 — curl 인자·`--max-time`·`CALL_LAST_CODE`·로그 줄 형식·`jrl_hook` 줄·반환값(마지막 rm)은 그대로. 이 세 줄만 되돌리는 정규화(`no_t135`)를 하면 `call()` 이 러너 시험 5종의 기준 ref(f218430·faf8bc3·0761fec·bf8450d·f91cd94) 전부와 sha256 동일. 실제 curl 7.81.0(서버)으로 확인: mktemp 0600 파일에 `-o` 하면 200·404·연결 거부(000, 0바이트) 모두 600 유지(새로 만들지 않고 덮어씀).
- [17:18] 동치(변경 전 c593300 vs 후, 같은 하네스·같은 입력 33개, 반환값·보낸 문장(SQL·값·순서)·경고 줄 비교): **동치 31 · 차이 0 · 의도된 차이 2**. 의도된 차이는 둘 다 "상한 뒤 첫 문장이 늦게 성공" — 변경 전은 그 뒤 다음 문장(후보 INSERT / 롤업 upsert)을 늦게 보냈고 변경 후는 보내지 않는다(반환값·경고 줄은 같음). 정상·꺼짐·스위치 못 읽음·no_table(2회 경고 1)·4025·1406·ECONNRESET·insertId 없음·카드 조회 실패·설정 실패·중복/형식 밖 행·getPool 예외·상한·150행 분할·값 오류 재시도 모두 동일.
- [17:18] 시험 결과(Node 24.22.2, 무거운 명령은 전부 flock): 기록기 단위 3종 145건 통과(bounded-conn 20 포함) · `src/lib/strategy/records` 전체 564 통과/0 실패 · `tsc --noEmit`(프로젝트) 0 · 시험 파일 타입 검사(records 전체, 임시 tsconfig) 오류 0 · 관련 범위 jest(`src/lib/strategy`·`src/app/api/cron`·`src/__tests__`·corp-intel·profit-engine 격리 시험) 2094 통과·실패 2(아래 감시 시험 2건 — 하나는 고쳤음) · 일회용 MariaDB 10.11(lock_wait_timeout 86400 = 운영과 같음) 기록기 DB 시험 2종 41건 통과 · 러너 시험 7종: daily-bars 81/0(317초) · holdings-premarket 53/0(재실행 1223초) · job-run-log 208/0(682초, J12·J13 포함) · news-peek 81/0(1151초) · news-split 119/0(427초) · pmo-retry 76/0 · stop-alert 22/0.
- [17:18] 일회용 DB 관찰값: 표 잠금(`LOCK TABLES … WRITE`) + 12회 동시 × 2회 — 판단 기록 4003ms·잡 기록 2504ms 에 전부 timeout · 매번 바쁜 연결 0(풀 all 1~2) · 무관한 SELECT 1 1ms · 서버 대기 INSERT/upsert 직후 10~12개 → **잠금을 쥔 채로 0개(소멸)** · 잠금 해제 뒤 늦게 써진 행 **0**(시도 24회) · 연결 24획득 = destroy 22 + release 2(풀 10 < 12 — 상한 뒤 받은 2개는 문장 없이 release), 두 번 끝난 연결 0·안 끝난 연결 0. 정상 30회 release 30·destroy 0, 테이블 없음 5회 destroy 5·바쁜 연결 0.
- [17:18] 변이 시험: A(TS, 단위+DB) **12/12 잡힘** — 상한에 연결 안 버림(수정 전 동작)·destroy 대신 release·상한 뒤 받은 연결로 전송·끝내기 한 번 가드 제거·판단/잡 기록을 풀 query 로 되돌림·상한 뒤 새 문장 전송·상한 뒤 실패에 경고 더함(2종)·오류 연결도 release·상한 뒤 결과 반환·받은 직후 상한 확인 제거(처음엔 살아남아 시험 1건 추가 후 잡힘). B(러너, J5·J9·J10·J12) **11/11 잡힘** — -o 예전 경로·umask 077 제거(대체 경로에서 잡힘)·umask 안 되돌림·시작 정리 제거·살아 있는 pid 도 지움·로그 마스킹 제거·jrl_hook 예전 경로(2종)·rm 제거·자른 뒤 마스킹·대체 경로 미리 안 만듦. 기준선 둘 다 0 실패. 스크립트: 서버 `~/.node-local/t135-out/mutate-a.py`·`mutate-b.sh`, 동치 하네스 `~/.node-local/t135-eq-in/`, 로그 `~/.node-local/t135-out/`.
- [17:18] 🔴 파일/줄 감시 시험 보고(Reviewer 먼저 볼 것): ① `src/app/api/cron/broker-fills/__tests__/cron-runner-block.test.ts` 「기존 줄 변경 0 — HEAD 대비 추가만」 **실패 — 고치지 않음**. T-135 가 `call()`·`jrl_hook` 의 경로 줄 5개를 의도해 바꿨으므로 커밋 전에는 반드시 실패한다(T-103·T-127 선례 — 커밋 뒤 HEAD 가 바뀌면 통과). ② `judgment-engine-wiring.test.ts` ④ 「judgment_* 문장은 모두 풀(pool)」 실패 → **시험 목을 고쳤다**: 그 목의 `getConnection` 이 매번 엔진의 카드 트랜잭션 연결 객체를 돌려줘, 기록기가 풀에서 따로 받은 연결과 구별이 안 됐다(운영 mysql2 는 다른 연결을 준다). 목을 "getConnection 마다 다른 연결, beginTransaction 을 부른 것만 'conn'" 으로 바꾸고 ④ 를 「트랜잭션 연결에는 signals INSERT 만 · 스위치·조회 = pool · judgment INSERT 2개 = poolconn(트랜잭션 아닌 풀 연결) · 전부 커밋 뒤」로 단언(의도 유지, 더 엄격). ③ 러너 시험 5종의 「call() 본문 = 기준 ref」·「추가만」·「블록 밖 실행 줄」 비교와 J8 의 umask 범위 검사는 T-112 선례(`# T-112 jrl` 줄 제외)처럼 T-135 정규화(`no_t135`: call-body-tmp 블록·`# T-135` 줄 제외 + 경로 3줄 되돌림)를 거쳐 비교하도록 고쳤다 — 되돌림이 정확히 그 세 줄만 바꾸는지는 J13 이 줄 수·흔적으로 고정. T-119 격리 시험(corp-intel·profit-engine)·`src/__tests__/` 는 통과(영향 없음).
- [17:18] 범위 밖 발견(고치지 않음): ⓐ 판단 기록기 `lookupCardIds` SELECT 와 스위치 읽기는 여전히 풀 query — signals·system_config 에 DDL(메타데이터 잠금)이 걸리면 그 연결은 상한 뒤에도 묶일 수 있다(쓰기 경로만큼 흔하지는 않음, T-131 후보). ⓑ 배포 순간 옛(T-135 전) 러너가 호출 도중 죽으면 `/tmp/cron-runner-<pid>.out`(644) 하나가 남을 수 있다 — 새 러너의 시작 정리는 전용 디렉터리만 본다(17:2x 서버 /tmp 에 해당 파일 0개). ⓒ `cron-runner.sh` news-fetch-split 주석 「call() 병렬화는 하지 않는다(임시 파일명 $$ 충돌)」 는 이제 파일명 이유가 사라졌다(CALL_LAST_CODE 등 전역 상태 때문에 병렬 금지는 여전히 맞음 — 주석만 낡음). ⓓ job-run-log 의 상한 뒤 재전송 과대 집계(T-127 Minor-2)는 줄지만 0 은 아니다(상한 순간 서버가 이미 실행한 문장은 남음 — 주석에 적음). ⓔ `exit-judgment.ts` 를 이 헬퍼로 합치는 정리(과제 문서대로 별도 후속).
- [17:18] 확인하지 못한 것: 실제 pm2 러너·운영 NAS MariaDB 에서의 동작(배포 안 함 — 서버 대기 문장 소멸은 일회용 10.11 에서만 관찰, 운영 버전에서 같은지는 미확인) · 실제 pm2 재시작 도중 죽은 러너의 잔존 파일이 다음 시작에 지워지는지(시험은 SIGKILL 하네스로 확인) · 전체 jest(관련 범위만 돌림) · Mac 세션 커밋 훅(커밋은 Leader 가 서버에서). 정리: 변이 B 실행이 망가뜨린 러너로 남긴 /tmp/cron-runner-*.out 21개(17:15~17:17 생성, 운영 러너 pid 아님, 내용은 시험 스텁 본문)를 지웠고 mutate-b.sh 에 같은 정리를 넣었다. 일회용 컨테이너 전부 제거(남은 t135 컨테이너 0).
- [17:18] Reviewer 인계: 먼저 볼 곳 — `bounded-conn.ts` 의 `acquire`(113행 closed 분기)·`query`(125~146행 상한 판정 순서)·`withBoundedConn`(172행) / `job-run-log.ts:624·634·647` / `judgment-recorder.ts:311·327·356·371` / `cron-runner.sh:78~106`(시작 정리·call_tmp_open)·`119·122·130·133`(call 변경)·`302·306`(jrl_hook) / `judgment-engine-wiring.test.ts` 목 변경. 재현: 동치 `bash ~/.node-local/t135-eq-in/eq-setup.sh && bash ~/.node-local/t135-eq-in/eq-run.sh`, DB `bash ~/.node-local/t135-out/run-db.sh <worktree> <출력접두>`, 러너 `T112_ONLY="J8 J12 J13" bash scripts/test-cron-runner-job-run-log.sh`.

## Reviewer

- [17:50] 독립 감사 범위 — worktree `~/.node-local/stockinvest-t135`(HEAD c593300, 미커밋)의 변경 전체: 훅 감시 경로 10개(`bounded-conn.ts`·`judgment-recorder.ts`·`job-run-log.ts`·`scripts/cron-runner.sh`·시험 6개) + 감시 밖 러너 시험 스크립트 5개. Developer 보고는 근거로 쓰지 않고 코드·diff 를 직접 읽고 아래를 직접 실행했다. 코드 수정·커밋·push·운영 DB 접속·pm2 조작 없음(일회용 docker `rev135-db-*` 2회 사용 후 제거 확인, 스크래치는 `~/.node-local/rev135/`).
- [17:50] 직접 재실행 결과 — `tsc --noEmit` exit 0(113초) · `src/lib/strategy/records` 전체 jest 565 통과/0 실패(75 skip = DB 시험, env 없을 때) · 일회용 MariaDB 10.11(lock_wait_timeout 86400) 기록기 DB 시험 2종 41 통과(표 잠금 + 12회 동시 ×2: 판단 4002ms·잡 2503ms 에 전부 timeout, 바쁜 연결 0, 무관한 SELECT 1 0~1ms, 서버 대기 문장 소멸, 늦게 써진 행 0, 연결 24획득 = release 3 + destroy 21, 두 번 끝난 연결 0) · 러너 `test-cron-runner-job-run-log.sh` 전체 208/0(499초, J12·J13 포함) · daily-bars 81/0 · pmo-retry 76/0 · stop-alert 22/0 · 동치 하네스(변경 전 c593300 vs 후, 내 경로에서 재실행) 동치 31 · 차이 0 · 의도된 차이 2.
- [17:50] 항목1(bounded-conn 수명주기) — 결함 없음. `conn=null` 선행 후 끝내기라 release/destroy 중복 불가, 상한이 연결 대기 중·첫 문장 중·문장 사이·성공 직후에 겹쳐도 연결은 정확히 한 번 끝남(대기 중 상한 = 도착 시 문장 없이 release, 실행 중 상한 = 그 자리 destroy, 상한 뒤 새 문장 없음). getConnection 이 동기 throw·reject·풀 없음일 때와 release/destroy 가 던질 때도 흡수(단위 시험 20건 + 내 프로브). T-126(`exit-judgment.ts:326~430`)과 비교: 받기·late 확인·오류 destroy·늦게 받은 연결 release 는 같고, 차이 둘은 의도로 설명됨(문장이 여럿이라 오류 즉시 destroy 대신 finish 시 destroy, late 이후 결과·오류를 LateError 로 바꿔 경고 중복 방지). unhandledRejection 프로브 6종(대기 중 abort 후 reject·resolve, 문장 중 abort 후 reject, 영구 대기, 동기 throw, 동시 2문장) 모두 0건 — Node 24 에서 프로세스 종료로 이어질 경로 없음. 오류 시 destroy 의 풀 재생성 비용은 호출 빈도(잡 기록 약 분당 1회, 판단 기록 분석당 1회)로 묶여 폭주 없음(DB 시험에서 풀 all 1~2).
- [17:50] 항목2(정상 경로 불변) — 반환 status·집계(runRows·rollupRows·rowErrors·rejected)·ODKU/INSERT 문장·값 오류 한 줄씩 재시도·no_table/skipped_* 분기·경고 문구·상한 값 4000/2500 은 diff 에서 바뀐 줄이 없고 동치 하네스로도 같음. 한 연결로 순차 전송은 풀 `query` 가 내부적으로 getConnection→query→release 인 것과 같은 의미(autocommit·세션 상태·lock_wait_timeout 차이 없음, 연결은 모두 같은 풀 설정). 목 ④ 변경은 약화가 아니다: 원래 단언은 기록기 문장이 전부 풀 query 일 것이었고, 새 목은 beginTransaction 을 부른 연결만 'conn' 으로 구별해 「트랜잭션 연결에는 signals INSERT 만 · judgment_* 4문장 = [pool, pool, poolconn, poolconn] · 전부 커밋 뒤」를 단언(순서까지 더 엄격, ② 영향 0 비교의 conn.commit/rollback 횟수·카드 INSERT via 는 그대로 유지, release/destroy 횟수를 단언하는 곳 없음). 카드 조회 SELECT 를 풀에 둔 결정은 타당 — 같은 연결에 묶으면 조회 오류가 쓰기 연결을 오염시켜 「조회가 실패해도 signal_id NULL 로 남긴다」 규칙이 깨진다. 남는 위험(조회·스위치 읽기는 상한 뒤에도 풀 연결을 잡을 수 있음)은 범위 밖 발견 ⓐ 로 Developer 가 적었고 쓰기 경로보다 드물어 수용.
- [17:50] 항목3(cron-runner.sh) — 결함 없음. `call()` 은 변경 전과 정확히 5줄 차이(T-135 표지 1·curl -o·로그 body=·rm + 호출 자리)이고 5개 기준 ref(f218430·faf8bc3·0761fec·bf8450d·f91cd94)와 c593300 의 `call()`(T-112 표지 제외)이 모두 같은 sha256(b3011a29…)임을 직접 확인. 격리 실험: 시작 정리는 죽은 pid 파일만 지우고 살아 있는 pid·숫자 아닌 이름·디렉터리·다른 파일·심볼릭 링크 대상은 건드리지 않음(링크 자체만 삭제), 살아 있는 pid 파일 보존 = 배포 겹침 안전, 변수가 비어도 `rm` 인자는 항상 `$d/cron-runner-*` 로 한정, umask 077 은 call_tmp_open 안에서만 적용·0022/0027 모두 복원·서브셸 아님(`CALL_BODY_FILE` 이 함수 밖에서 유지됨), mktemp 실패 시 폴백 `/tmp/cron-runner-<pid>.out` 이 600 으로 미리 만들어져 stdout·호출이 기준 러너와 같음(J12 대체 시나리오), `set -u` 상 `${HOME}` 은 기존 코드(328행 등)도 이미 전제하므로 새 실패 방식이 아니다. jrl_hook 의 읽기 2곳 모두 `${CALL_BODY_FILE:-}` 로 변경됨. `grep cron-runner-$$` 전수: 옛 경로 실행 참조는 폴백 1곳뿐(나머지는 주석·시험·T-112 설계 초안 문서). 호출당 추가 비용 약 1.8ms(open+rm). 마스킹은 빈 본문·2048 경계·멀티바이트(바이트 단위, 이전과 같은 head -c 200)에서 안전.
- [17:50] 항목4(러너 시험 스크립트 정당성) — 약화 없음. 5개 스크립트의 변경은 `call()` 비교 앞에 `no_t135`(call-body-tmp 블록·`# T-135` 줄 제외 + 정확히 그 세 줄 되돌림)를 끼운 것뿐이고 eq 라벨·기대값은 그대로. 되돌린 결과가 5개 기준 ref 와 같음을 내가 독립 계산으로 재현(위 sha256). 이 정규화는 블록 내부를 보지 않지만 그 안은 J12(동작 37줄)·J13(정적 14줄)이 고정. 변이 시험(내가 만든 것): TS 12/12 적발, 러너 R1(생존 검사 반전)·R2(숫자 검사 제거)·R3(umask 미복원)·R4(rm 제거)·R5(chmod 700 제거)·R6(예측 가능한 고정 이름)·R7(자른 뒤 마스킹)·R9(자기 pid 제외 제거) 8/8 적발. `cron-runner-block.test.ts` 「기존 줄 변경 0」 시험은 diff 상 미수정이며, 커밋 전 worktree 에서는 예상대로 실패(1 failed) → 스크래치 저장소에 baseline 커밋 후 새 러너를 커밋하자 10/10 통과(T-127 선례 재현). QA 는 반드시 커밋 뒤에 이 시험을 돌려야 한다.
- [17:50] 항목5(범위 준수) — `exit-judgment.ts`·`engine.ts`·`record-switch.ts`·`src/lib/exchanges/*`·`safety/`·`orders/`·서버 라우트·DDL diff 0줄. T-131 16번(마스킹 라벨 2개 고정) 미변경(jrl_hook 의 case 라벨 줄 무변경). 변경 파일 15개가 task 「범위」와 일치.
- [17:50] 항목6(시험의 질) — 내 변이 TS 12개(늦게 받은 연결 사용, abort 시 release, 상한 뒤 새 문장 허용, finish 항상 release, 상한에 abort 안 함, conn 미비움, 상한 뒤 결과 반환, 후보 INSERT 를 풀로 되돌림, late 분기 제거, 업서트를 풀로 되돌림, errored 표시 제거, late 매핑 제거) 전부 적발. 추가로 내가 만든 프로브 — 후보 표만 잠그고 판단 기록 12회×2: 첫 문장은 성공·둘째 문장이 매달리는 경우도 전부 timeout, 바쁜 연결 0, 서버 대기 문장 소멸, 후보 행 0(헤더 행 20은 기존 설계상 「헤더 id 만 남음」과 같은 부분 기록) — Developer 시험이 놓친 「문장 사이 상한」 경로를 실 풀로 확인. 목 풀이 실제 mysql2 와 다르게 가정하는 곳: `getConnection` 이 일반 객체를 줌(실물 PromisePoolConnection 은 release/destroy 가 다른 구현) — 실 풀 DB 시험이 이를 덮는다.
- [17:50] 항목7·8 — 위 직접 재실행 결과 참조. 감시 시험 `src/__tests__` 전부 통과(14 suites 중 위 cron-runner-block 만 커밋 전 실패). 배포 겹침: 새 러너의 정리는 `~/.node-local/stockinvest/call-tmp/` 만 보므로 옛(T-135 전) 러너의 `/tmp/cron-runner-<pid>.out` 을 건드릴 수 없고, 새 러너끼리 겹쳐도 생존 pid 파일은 보존됨(격리 실험으로 확인). 옛 러너가 호출 도중 죽어 남기는 644 파일 1개는 새 러너가 정리하지 못한다(Developer ⓑ 와 같음, 서버 /tmp 에 현재 0개).
- [17:50] 발견 R-1(Low) `scripts/cron-runner.sh` news-fetch-split 블록 주석 「call() 병렬화는 하지 않는다(임시 파일명 $$ 충돌)」(약 606행)의 파일명 이유가 이제 낡음(CALL_LAST_CODE 등 전역 상태 때문에 금지는 여전히 맞음). 권고: 주석 한 줄 정정(기능 영향 없음, 커밋 전 또는 후속).
- [17:50] 발견 R-2(Low) 비-200 로그 줄이 모든 라벨에서 `"detail":"…"` 문자열 값을 지운다(사양 그대로). 확인한 범위(cron 라우트 grep, 전수 아님)에서 비-200 응답에 detail 을 싣는 라우트는 못 찾았으나, 새 오류 응답에 detail 을 두면 러너 로그에서 사라진다. 권고: T-131 16번 점검 항목(새 call 라벨·응답 키 추가 시)에 한 줄 추가.
- [17:50] 발견 R-3(Low) 시작 정리의 생존 판정은 같은 PID 네임스페이스 가정이다 — 같은 HOME 을 공유하는 컨테이너·다른 네임스페이스에서 러너를 띄우면 살아 있는 러너의 본문 파일을 죽은 것으로 보고 지울 수 있고, PID 가 재사용되면 죽은 러너 파일 1개가 그 PID 가 끝날 때까지 남는다. 현재 pm2 호스트 직접 실행이라 해당 없음. 권고: 코드 변경 없이 운영 문서에 가정으로 한 줄.
- [17:50] 발견 R-4(Low, 기존 동작과 동일) mktemp 까지 실패하는 폴백 경로의 `/tmp/cron-runner-<pid>.out` 은 예측 가능한 이름이다 — 다른 사용자가 같은 이름의 심볼릭 링크를 미리 만들어 두면 `rm -f` 가 실패해 curl 이 그 링크를 따라 쓴다. 변경 전 경로도 같았고 이번 변경으로 악화되지 않음(600 으로 미리 만드는 개선만 있음). 단일 사용자 호스트라 수용.
- [17:50] 확인하지 못한 것 — 운영 NAS MariaDB 버전에서 destroy 뒤 서버 쪽 대기 문장이 거둬지는지(10.11 일회용에서만 관찰 — 운영 DB 접속 금지라 미확인. InnoDB 행 잠금 대기는 기본 50초에 끝나지만 MDL·표 잠금 대기는 lock_wait_timeout 86400 이라, 서버가 안 거두면 풀 슬롯 대신 서버 스레드가 분당 하나씩 남을 수 있음 — T-126 과 같은 가정이며 배포 후 QA 가 `SHOW PROCESSLIST` 읽기로 한 번 확인 권고) · 실제 pm2 재시작 중 죽은 러너 파일의 정리(시험은 SIGKILL 하네스) · 러너 시험 중 holdings-premarket·news-peek·news-split 스위트와 전체 jest·`next build` 는 실행하지 않음(call() 정규화는 5개 ref sha 로 직접 확인) · Mac 세션 커밋 훅(커밋은 서버에서) · Codex 검토는 task 에 장애로 생략 예정이라고 되어 있어 판정 대상 없음.
- [17:50] 커밋 시 주의(Leader) — 훅 감시 경로 10개를 한 커밋에 정확한 경로로 스테이징하고, 감시 밖이지만 함께 바뀐 `scripts/test-cron-runner-{daily-bars,holdings-premarket,job-run-log,news-peek,news-split}.sh` 5개도 같은 커밋에 넣어야 한다(빠지면 러너 시험의 call() 비교가 새 러너와 어긋나 실패). 이 task 의 변경으로 rows/DDL/설정 변경은 없고 배포는 push=blue/green 이며 러너 교체 시점에 `call-tmp` 디렉터리가 처음 만들어진다.
- [17:50] **최종 판정: PASS (scope: src/lib/strategy/records/bounded-conn.ts, src/lib/strategy/records/judgment-recorder.ts, src/lib/strategy/records/job-run-log.ts, scripts/cron-runner.sh, src/lib/strategy/records/__tests__/bounded-conn.test.ts, src/lib/strategy/records/__tests__/judgment-recorder.test.ts, src/lib/strategy/records/__tests__/job-run-log.test.ts, src/lib/strategy/records/__tests__/judgment-disposable-mariadb.test.ts, src/lib/strategy/records/__tests__/job-run-log-disposable-mariadb.test.ts, src/lib/strategy/records/__tests__/judgment-engine-wiring.test.ts)**

## QA

- [19:08] 검증 환경: 서버 worktree `~/.node-local/stockinvest-t135` HEAD `0957125`(기준 `c593300`), status 0줄. Node v24.22.2. 무거운 시험은 공유 flock 직렬. 운영 러너·pm2·system_config·운영 DB 는 건드리지 않았다. 러너 시나리오는 케이스별 임시 HOME·가짜 CRON_SECRET(`qa-dummy`)·에페메럴 포트 임시 서버로만 돌렸다.
- [19:08] 1 변경 범위: `git diff c593300 0957125 --stat` 15파일(task 범위와 일치). exit-judgment·engine·record-switch·src/lib/exchanges·src/lib/safety·src/app/api/orders·서버 라우트·DDL 변경 0줄.
- [19:08] 2 tsc: 프로젝트 `tsc --noEmit --incremental false` rc=0, Files 1194, 오류 0, 검사 5.0초. 시험 파일(records, 임시 tsconfig) rc=0, Files 432, 오류 0.
- [19:08] 3 러너 시험 7종(직렬): daily-bars 81/0 · holdings-premarket 53/0 · job-run-log 208/0 · news-peek 81/0 · news-split 119/0 · pmo-retry 76/0 · stop-alert 22/0. 실패 0.
- [19:08] 4 cron-runner-block(커밋 0957125 상태): 10/10 통과. 주의: 이 시험은 `git show HEAD:` 와 현재 파일을 비교하므로 커밋 뒤에는 구조적으로 통과한다. T-135 가 바꾼 5줄은 이 시험이 보호하지 않는다(보호는 러너 시험의 no_t135 정규화와 J13 정적 검사).
- [19:08] 5 jest: records 전체 565 통과·75 건너뜀(DB 환경 변수 없음) · src/lib/strategy·ops·signals·src/__tests__ 3374 통과·98 건너뜀 · 실패 0. 건너뛴 DB 시험은 6번에서 따로 실행.
- [19:08] 6 일회용 MariaDB 10.11.19(lock_wait_timeout 86400, 컨테이너 제거 확인): judgment·job-run-log 디스포저블 시험 41/41 통과. 표 잠금 12회×2 → 판단 4002ms·잡 2504ms 전부 timeout, 바쁜 연결 0, 무관한 SELECT 1 1ms, 대기 INSERT 소멸, 늦은 행 0.
- [19:08] 6 추가 프로브(QA 임시 사본 전용, 후보 표만 잠금 = 첫 문장 성공 + 둘째 문장 매달림): P1 단건 — 헤더 1행 기록, 후보 0행, 상한 4004ms timeout, 바쁜 연결 0, 대기 후보 INSERT 소멸, 잠금 해제 뒤 늦은 행 0 → 통과. P2 12×2 — 전부 timeout, 바쁜 연결 0, 대기 소멸, 늦은 후보 0, 연결 두 번 끝남 0 → 통과. 단 헤더 행 +20(QA 기대값 24 는 제 프로브의 기대 오류). 라운드마다 풀 10개만 헤더를 보냈고 나머지 2개는 상한 뒤에야 연결을 받아 문장을 보내지 않았다(가능성 높음).
- [19:08] 7 러너 실동작(임시 HOME, 로컬 http 서버, 요청 시점 권한 기록): (a) 호출 중 응답 파일 0600·디렉터리 0700 · (b) 정상·비-200·연결 거부 뒤 잔존 0 · (c) 비-200 body= 의 totalKRW·KRW·USD·headerPnlKRW 는 0, detail 은 빈 문자열, 200바이트 이내 · (d) 200·404·000·대용량 200 의 로그 줄은 c593300 러너와 같다(타임스탬프 제외). 차이는 금액 500 응답 1건뿐(의도된 마스킹) · (e) 시작 정리: 죽은 pid 파일과 죽은 pid 심볼릭 링크만 삭제, 살아 있는 pid·숫자 아닌 이름·디렉터리·다른 파일·링크 대상 보존, 디렉터리 755→700 · (f) umask 022 로 시작해도 호출 중 파일 600, 호출 뒤 umask 022 복원 · (g) mktemp 실패(디렉터리 500) → 폴백 `/tmp/cron-runner-<pid>.out` 이 호출 중 600, 호출 뒤 제거, stdout 은 기준과 같음 · 호출 도중 kill -9 → 잔존 1개(600, 20바이트) 후 다음 시작에서 삭제, 누적 없음.
- [19:08] 8 배포 겹침: NOT_VERIFIED. 실제 `/tmp` 에 옛 러너 파일을 만드는 실험은 하지 않았다(TMPDIR 로 격리되지 않음). 대체 확인: 시작 정리 함수는 CALL_TMP_DIR 만 순회하고 `/tmp` 는 폴백 1곳에서만 쓴다(정적 확인). 옛 러너가 호출 도중 죽어 남긴 644 파일은 새 러너가 지우지 않는다(Developer ⓑ·Reviewer R-3 와 같음).
- [19:08] 9 엣지: 스위치 꺼짐 시 연결 미획득 · no_table · 값 오류 한 줄씩 재시도 · 연결 획득 실패 · 상한 timeout 은 기존 명명 시험으로 통과 확인. 첫 문장 성공 + 둘째 문장 매달림은 6번 프로브 P1 로 확인. NOT_VERIFIED: 상한과 완료가 같은 밀리초에 겹치는 정확한 경계.
- [19:08] 10 변이(임시 사본, 원본 불변): M1 bounded-conn 의 늦은 연결 release 삭제 → jest 4건 실패(늦은 연결 release 시험 4개), 기준 145/145 통과 · M2 call_tmp_init 의 살아 있는 pid 검사 삭제 → J12 정리 시험 1건·J13 정적 1건 실패 · M3 call_tmp_open 의 umask 077 삭제 → J8·J12 대체 경로(권한 불일치 17개)·J13 3건 실패. 셸 기준본(J8·J10·J12·J13) 99/0.
- [19:08] 11 안전 불변: diff 에서 submitOrder·DRY_RUN·KILL_SWITCH·ORDER_MAX·DAILY_ORDER·createSignal·ALLOWED_SYMBOLS 는 bounded-conn.ts 머리말 주석 1줄에만 나온다(코드 0줄). 러너 `call "…"` 호출 줄과 `jrl_hook` 호출 줄 변경 0. `/tmp` 참조는 주석과 폴백 1곳뿐.
- [19:08] 잔여 관찰(결함 0건으로 판정, Leader 판단 대상): (i) 마스킹 목록(totalKRW·KRW·USD·headerPnlKRW·lifoPnlKRW) 밖의 금액 키는 비-200 로그 줄에 원문으로 남는다. 라우트 코드에 usdValueKRW·baselineKRW·usdCashRequired·cash 가 있으나, 실제 비-200 본문에 실리는지는 미확인. (ii) 줄바꿈이 낀 JSON 은 마스킹을 통과한다(시험 `/pretty` 에서 12345678 노출, 옛 러너와 같음). 현재 라우트는 compact JSON 으로 보이나 미확인. (iii) cron-runner.sh 607행 주석 「임시 파일명 $$ 충돌」은 낡았다(Reviewer R-1).
- [19:08] 운영 변화(QA 가 한 일 아님): 운영 cron 러너가 19:00:11 에 `releases/20261031-185943-90f858f5` 로 교체됐다(옛 PID 3345996 소멸). 20-Log 19:01 기록(Leader)에 따르면 이는 T-133 운영 배포(push `ad45efc..90f858f`)다. QA 는 그 PID·pm2 를 건드리지 않았다. T-135 커밋 `0957125` 는 wip 로컬 브랜치라 push 되지 않았으므로 이 릴리스에 T-135 코드는 없다고 본다(일지 기준, 서버 파일 직접 확인은 SSH 끊김으로 미확인).
- [19:08] 산출물 정리: 임시 사본 트리·케이스 디렉터리 삭제, 임시 서버·자식 프로세스 종료 확인, 일회용 MariaDB 컨테이너 제거 확인(남은 qa135·t135 컨테이너 0). 드라이버 로그는 `~/.node-local/t135-qa/out/` 에 근거용으로 보존.
- [19:08] QA 판정: PASS

## Codex 검토

- [2026-10-31 16:58] **호출하지 않았다.** 사용자 전역 `~/.codex/config.toml` 의 `model = "gpt-6.1-sol"` 이 ChatGPT 계정에서 지원되지 않아 호출하면 즉시 실패한다 — T-126·T-127·T-128 에서 세 번 실패를 기록했고(확인에 호출당 약 7분), 16:58 에 설정이 그대로임을 읽어 확인했다. judge 의 `codex_gate` C1·C2 도 돌리지 않았다. 이 task 의 독립 감사는 Reviewer(PASS)와 QA(PASS)가 맡았다. [[T-131-t126-t130-followup-candidates]] 19번.

## 최종 요약

### [T-135] T-112 기록기의 매달린 INSERT 풀 연결 점유 상한 + 크론 러너 응답 임시 파일 보호

- **상태**: 구현·Reviewer(PASS, Critical·High 0, Low 4)·QA(PASS, 결함 0) 완료 → **배포 승인 대기**(`ready-to-deploy`). 코드는 서버 worktree 의 별도 브랜치 `wip/T-135-recorder-pool-runner-tmp`(커밋 `0957125`, 15파일)에만 있고 `main`·운영에는 없다(19:09 확인: `origin/main` 에 없음, 운영 릴리스 `20261031-185943-90f858f5` 에 `bounded-conn.ts`·`call-tmp` 없음).
- **무엇이 바뀌었나**
  - **A. 기록기 풀 점유.** 판단 기록기(`judgment_*`, 스위치 아직 꺼짐)와 잡 실행 기록기(`job_run_log`, **스위치 켜짐 — 러너가 틱마다 쓴다**)의 DB 쓰기가 매달려도, 상한(4초/2.5초)이 되면 그 풀 연결을 폐기하고 상한 뒤 늦게 받은 연결은 아무것도 쓰지 않고 반납한다. 이전에는 상한이 **기다림만** 끊고 연결은 응답이 올 때까지 잡고 있어, 기록 표가 잠기면 약 10틱에 풀 10개(주문 승인·UI 와 공유)가 마를 수 있었다(T-126 Reviewer 가 일회용 DB 에서 재현). 정상 경로의 결과·집계·문장·경고·상한 값은 불변.
  - **B. 러너 임시 파일.** 크론 러너 `call()` 의 응답 본문 파일이 `/tmp/cron-runner-<pid>.out`(**644, 다른 계정이 읽을 수 있음**, 금액 JSON 이 호출 동안 남음)이던 것을 전용 0700 디렉터리(`~/.node-local/stockinvest/call-tmp`)의 0600 으로. 러너 시작 때 죽은 러너가 남긴 파일만 정리(살아 있는 러너의 파일은 보존). 비정상 응답 로그의 `body=` 는 금액 키 마스킹 뒤 200바이트.
- **배포**: 미배포(승인 전, push=배포). **같은 배포에 실릴 다른 작업**: [[T-134-exit-engine-state-load-isolation]](함께 승인 요청). **이 배포는 `cron-runner.sh` 가 바뀌므로 `stockinvest-cron` 프로세스가 새 릴리스로 교체된다** — 모든 크론 잡이 거치는 경로다.
- **AI 가 검증한 것**: 러너 시험 **7종 전부 실패 0**(daily-bars 81·holdings-premarket 53·job-run-log 208·news-peek 81·news-split 119·pmo-retry 76·stop-alert 22, QA 직접 실행) · 일회용 MariaDB 10.11 41건(표 잠금 12동시×2 → 모든 기록이 제때 포기, 풀 점유 0, 무관한 쿼리 0~1ms, 서버 대기 INSERT 소멸, 늦은 행 0) · 변경 전/후 동일 입력 33건 중 31 동일·2 는 의도된 차이 · `tsc` 비증분 1194파일 오류 0(시험 432파일도 0) · jest `records` 565·넓은 범위 3374 통과·실패 0 · 변이 시험 Developer 23(A 12·B 11) + Reviewer 20(TS 12·러너 8) + QA 3 전부 적발 · 러너 시나리오(임시 HOME): 호출 중 파일 0600·디렉터리 0700, 호출 뒤 잔존 0, 죽은 pid 파일만 정리, `umask 022` 시작에서도 0600 및 복원, mktemp 실패 폴백, 호출 중 `kill -9` 뒤 다음 시작에서 정리 · `call()` 이 변경 전과 정확히 5줄만 다르고 5개 기준 ref 에서 같은 sha256 · 안전 토큰 변경 0줄 · 커밋 훅 실제 통과.
- **AI 가 못 한 것**: 운영 MariaDB(10.11.11)에서 폐기한 연결의 서버 쪽 대기 문장이 거둬지는지(일회용 10.11.19 에서만) · 실제 pm2 재시작 뒤 잔존 정리(SIGKILL 하네스만) · 배포 겹침 구간 실측(옛 러너의 `/tmp` 파일을 실제 `/tmp` 에 만드는 실험은 안 함 — 코드·정적 확인만) · 상한과 완료가 같은 밀리초에 겹치는 정확한 경계 · 전체 저장소 jest·`next build`·lint · Codex 외부 검토(모델 설정 장애).
- **👉 사용자가 확인할 것(배포 후)**: 특별히 눈으로 볼 것은 없다. 서버 쪽 읽기 확인은 내가 한다 — ① `SHOW PROCESSLIST` 에 `INSERT INTO job_run_log/judgment_*` 장기 체류 없음 ② `call-tmp` 디렉터리 0700 ③ `/tmp/cron-runner-*` 잔존 0 ④ `job_run_log` 가 계속 쌓임 ⑤ 러너가 새 릴리스에서 돌고 `stockinvest-cron` restarts 0.
- **👉 사용자가 결정할 것**: 비정상(비-200) 응답의 로그 `body=` 마스킹 범위. QA 관찰: 마스킹 키 목록 밖의 금액성 키(`usdValueKRW`·`baselineKRW`·`usdCashRequired`·`cash` 등)와 줄바꿈이 들어간 JSON 의 숫자는 로그에 남을 수 있다. **퇴보는 아니다**(옛 러너는 모든 본문을 원문 그대로 찍었다 — 이번 변경이 범위를 넓혔다). 그래도 남는 틈을 어떻게 할지: (a) **이번엔 그대로 배포**(권고 — 실제 비-200 본문에 금액이 실리는지 미확인이고 기록은 서버 로컬 로그 파일뿐) (b) 비정상 응답 로그에서 본문을 아예 안 찍고 분류어·길이만 남기도록 추가 수정(작은 변경이지만 러너 시험 재순환 약 2시간).
- **남은 일**: [[T-131-t126-t130-followup-candidates]] 23·24·25번 — 카드 조회와 스위치 읽기의 일반 풀 사용, 낡은 주석(`cron-runner.sh` ~607행), `exit-judgment.ts` 를 새 헬퍼로 합치는 정리, 배포 후 `SHOW PROCESSLIST` 점검.
- **이슈·위험**: 중간(모든 크론 잡이 거치는 경로를 바꾼다). 완화: 러너 시험 7종·정규화 비교(5개 ref 동일 sha256)·폴백 경로·변이 시험. 배포 순간 옛 러너가 `/tmp` 에 644 파일을 하나 남길 수 있다(일회성, 새 러너 정리는 자기 디렉터리만 본다). 롤백은 이전 릴리스로(코드만 — DDL 없음, 데이터 변경 없음).

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 해당없음 | - | - | judge: none | 10-31 15:21 |
