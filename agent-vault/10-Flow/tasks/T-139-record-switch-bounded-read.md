---
task_id: T-139
title: 기록 스위치 읽기(record-switch.ts)가 멈춘 조회로 공용 풀 연결을 붙잡는 문제 — 연결 상한(destroy)과 같은 키 조회 합치기
status: deployed
priority: medium
project: StockInvest
created: 2026-10-31
updated: 2026-10-31
base_ref: 287b637 (로컬 main)
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa]
related_tasks: [T-126-exit-judgment-persistence, T-135-recorder-pool-hold-and-runner-tmp, T-112-run-judgment-record-foundation, T-131-t126-t130-followup-candidates]
tags:
  - type/task
  - domain/safety
  - domain/records
aliases:
  - 기록스위치읽기상한
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

사용자 지시(2026-10-31 「다섯 건 전부 검토진행해주고 검토사항에 대하여 결과에 따라서 후속 작업 진행하도록 하자」)로 이미 배포된 T-126·T-127·T-128·T-134·T-135 를 Codex(`gpt-6.1-sol`, adversarial-review)로 소급 검토했다. T-126 검토에서 **high 1건**: 「기록 스위치 읽기(`record-switch.ts`)가 공용 풀의 `query()` 를 `withDeadline()` 으로 기다리기만 해서, 조회가 멈추면 2초 뒤 꺼짐으로 돌아와도 연결은 풀에 안 돌아온다」([[T-126-exit-judgment-persistence]] `## Codex 검토`).

독립 Reviewer 판정(같은 절 `[23:15]`): **부분 채택, 실제 심각도 Low(상한 Medium)**.
- 메커니즘은 사실이다 — 일회용 MariaDB 10.11.19 + 실제 mysql2 3.11.3 풀(연결 10·대기열 제한 없음)에서 `LOCK TABLES system_config WRITE` 를 걸면 단일 호출은 2004ms 에 `timeout`(꺼짐)으로 돌아오지만 풀 busy 1 이 유지되고, 같은 키 10건 동시는 busy 10·free 0. 조회 합치기 없음(동시 10건 = 조회 10번). 새는 곳은 INSERT 연결이 아니라 `pool.query` 안쪽의 SELECT 연결이다.
- 이번 변경이 만든 퇴보가 아니다 — T-112(`df4b4a2`)부터의 동작이고 `job_run_log_enabled` 가 10-30 21:05 부터 분당 약 1회 이 경로를 실행 중이다(운영 로그의 스위치 timeout 경고 0줄).
- 같은 장애(`system_config` 읽기 정체)에서는 기록기가 없어도 엔진의 `readExitEngineSwitch`(`engine.ts:785`)·`isKillSwitchActive`·`isDryRun`·`/api/health`(한 호출에 8건 이상)가 상한 없이 멈춘다 → 이 읽기만 고쳐도 시스템이 살아남지는 않는다. 그래도 **고칠 가치는 있다**(T-131 23번 ①과 같은 뿌리, `exit_judgment_record_enabled` 켜기의 선결 조건은 아님).

## 관련 과거 이력 요약 (Leader)
- 승인된 교훈(`issues related safety strategy`): 없음.
- [[T-135-recorder-pool-hold-and-runner-tmp]]: 신규 `src/lib/strategy/records/bounded-conn.ts`(`withBoundedConn`) — 기록 1회가 풀 연결 하나를 받아 문장을 그 연결로 보내고 상한에서 destroy, 늦게 받은 연결은 쓰기 없이 release, 한 번만 끝냄. 이 헬퍼 주석이 스위치 읽기를 「범위 밖」으로 명시했다 — 이제 그 범위 밖을 처리한다.
- 독립 Reviewer 재현·시험 원본(재사용 가능): 스크래치패드 `adj126/adj126-pool.test.ts`·`run-adj126.sh` (`/private/tmp/claude-501/-Volumes-homes-brownjeon-project-StockInvest/baa36395-8323-4715-ae34-352cdf8305c1/scratchpad/adj126/`).

## 범위 (이번에 한다)
1. `src/lib/strategy/records/record-switch.ts` 의 `readOnce` 가 스위치 SELECT 를 `withBoundedConn`(T-135)으로 보내 상한(기존 `RECORD_SWITCH_TIMEOUT_MS` 2초)에서 **연결을 destroy** 하고, 늦게 받은 연결은 쓰기 없이 release 한다.
2. **같은 키의 진행 중 조회를 합친다**(single-flight): 같은 키로 동시에 N번 불러도 조회는 1번.
3. 시험: 단위(목 풀) — 상한 뒤 busy 0, 동시 10건 → 조회 1, 늦은 연결, 오류 분기. 일회용 MariaDB(`LOCK TABLES system_config WRITE`) — 단일 호출 상한 후 풀 0, 동시 10건 busy 0, 장시간 모사(분당 1.2건 × 14분) busy 0, 서버의 대기 SELECT 소멸. 변이 시험(destroy 삭제·single-flight 삭제·늦은 연결 release 삭제). 이 파일을 목으로 쓰는 기존 시험(약 6개: `record-switch.test.ts`·`exit-judgment*.test.ts`·`job-run-log.test.ts`·`judgment-*.test.ts`·`ops-routes.test.ts` 등)은 새 경로에 맞게 **단언을 약화하지 않고** 갱신.

## 불변 조건 (바꾸지 않는다)
- 반환 모양·`RecordSwitchSource` 5값(`missing`·`value`·`read_error`·`timeout`·`unknown_key`)·키별 30초 캐시·**꺼짐(fail-closed) 판정**: 키 없음=꺼짐, 정확히 JSON `true` 만 켜짐, 읽기 오류·2초 초과=꺼짐.
- 기록기들(`exit-judgment.ts`·`judgment-recorder.ts`·`job-run-log.ts`)의 동작·반환값·경고 문구·상한은 그대로. 스위치를 읽는 호출부는 수정하지 않는다(필요하면 시험의 목만).
- 정상 경로(조회 성공)의 결과는 변경 전과 같다 — 변경 전/후 동일 입력 동치 시험.

## 하지 않는 것 (범위 밖 — 발견하면 `## Developer` 의 「범위 밖 발견」에만)
- **엔진·주문·`/api/health` 의 스위치 읽기**(`readExitEngineSwitch`·`isKillSwitchActive`·`isDryRun` 등)에 상한을 거는 것 — 타임아웃이 「안전한 쪽」으로 떨어지는 방향(자동 매도 안 함 vs 계속 진행)을 정해야 하는 **별도 설계 결정**이라 사용자·Leader 결정 전에는 건드리지 않는다.
- 공용 풀(`db.ts`) 설정 변경, 기록 전용 풀, `SET STATEMENT max_statement_time`(MariaDB 전용·죽은 TCP 못 구함), `lookupCardIds` 등 다른 풀 사용 지점.

## 판단 기록 (judge)
- [2026-10-31 23:16] intake engine=jev → task_type=local_fix · risk=R1 · developer_model=opus · next=assign · demo=none/- | overrides=MD-judge-failed-opus | fallback=- | tokens=1323
- [2026-10-31 23:5x] **Leader 채택·override 기록.** judge 결과 `risk=R1 · developer_model=opus · demo=none`(`overrides=MD-judge-failed-opus` — 엔진 폴백이 아니라 complexity 신뢰도 0.08 이 임계 미만이라 `failed` 로 처리된 결과; Jev risk 확률 high 0.53/normal 0.47). **`override: risk R2 유지`** — 대상 `record-switch.ts` 는 커밋 훅 `SAFETY_PATHS`(`src/lib/strategy/`) 파일이고 스위치 3개와 상시 켜진 `job_run_log` 가 모두 읽는 경로이며 실거래 전 안전 인프라다. Developer 는 Opus. 데모 none 채택(`check.mjs init` → `not_required`).

## 진행 기록
- [2026-10-31 23:4x] 등록(Leader). 소급 Codex 검토(T-126) 지적 + 독립 Reviewer 판정(부분 채택·Low~Medium)에서 파생. 코드는 서버 worktree 별도 브랜치(`wip/T-139-…`)에만 두고 `main`·운영에 올리지 않는다(사용자 배포 승인 뒤 cherry-pick).

## Developer
- [23:55] 구현 완료 — **미커밋**, 서버 worktree `~/.node-local/stockinvest-t139`(base `a064722`). 변경 9개(코드 1·시험 8), 모두 커밋 훅 `^src/lib/strategy/` 감시 대상 → Reviewer 판정 scope 는 `src/lib/strategy/records/` 가 필요하다. 수정 금지 파일(`bounded-conn.ts`·`exit-judgment.ts`·`judgment-recorder.ts`·`job-run-log.ts`·`engine.ts`·`src/lib/exchanges/*`·`ops/metrics/anomalies.ts`) 무변경을 `git diff --quiet` 로 확인.
- [23:55] 변경 파일 ① `src/lib/strategy/records/record-switch.ts`(101→148줄, +62/−15) — 스위치 SELECT 를 `withBoundedConn` 으로, 같은 키 진행 중 조회 합치기, 시험용 초기화 훅이 진행 중 표지·세대도 비움 ② `__tests__/record-switch.test.ts`(+301/−2, 463줄) — 목 풀에 `getConnection` 추가(기존 18건 단언 무변경) + 동치 표 23 + 연결 상한 6 + 조회 합치기 11 ③ `__tests__/record-switch-disposable-mariadb.test.ts`(신규 308줄, `T139_DB_PORT` 있을 때만 — 없으면 건너뜀) — 실 DB 동치 S 11 + L1~L4 ④ 목 갱신 6개: `exit-judgment.test.ts`(+55/−11)·`judgment-recorder.test.ts`(+66/−12)·`exit-judgment-engine-wiring.test.ts`(+29/−6)·`judgment-engine-wiring.test.ts`(+19/−8)·`job-run-log-disposable-mariadb.test.ts`(+16/−9)·`judgment-disposable-mariadb.test.ts`(+16/−9).
- [23:55] 설계 결정 ① 연결 수명주기를 새로 쓰지 않고 T-135 `withBoundedConn` 을 그대로 쓴다(본문은 `selectSwitch(bc, key)` 1문장) — 상한이면 그 자리에서 destroy, 받는 중이었으면 도착 즉시 SELECT 없이 release, 상한 전 문장 오류도 destroy(헬퍼 규칙 「상태를 믿지 않는다」 — 예전 `pool.query` 는 오류 때 release 했다. 결과는 같은 read_error. 부수 효과: 1146 같은 지속 오류 상태에서는 키마다 30초에 한 번 연결을 버리고 다시 맺는다 — 키 3개면 분당 최대 6회 재접속) ② `getPool()` 은 본문 안에서 부른다 — 던지면 예전처럼 read_error·같은 경고 문구 ③ 결과 해석은 예전 `.then(([rows]) => …)` 규칙 그대로(행 묶음이 배열이 아니거나 첫 행이 없으면 missing, 응답을 풀 수 없으면 read_error) ④ 조회 합치기는 키별 `Map<key, Promise>` — 진행 중이면 그 약속을 같이 기다리고, 캐시는 조회가 끝난 시각으로 조회 쪽에서 한 번 쓰며(예전에는 호출자마다 썼다 — 단일 호출 결과는 같다), 표지는 `finally` 에서 **자기 표지일 때만** 지운다(`readOnce` 는 던지지 않으므로 값으로 끝남) ⑤ 시험용 초기화 훅은 캐시 + 진행 중 표지 + 세대를 비운다 — 초기화 전에 시작한 조회가 늦게 끝나도 새 캐시를 덮지 않게(운영 경로에서는 세대가 바뀌지 않는다) ⑥ 의도한 동작 차이: 같은 키 동시 N건이면 조회 1·초과/오류 경고 1줄(예전 N줄), 늦게 합류한 호출은 남은 시간만 기다린다(결과는 같다). 반환 모양·`RecordSwitchSource` 5값·키별 30초 캐시·fail-closed 판정·경고 문구는 그대로 ⑦ 기록기(판단·실행 기록)는 스위치를 자기 상한 본문 안에서 **먼저** await 하므로 스위치 연결은 INSERT 연결을 받기 전에 끝난다 — 기록 1회의 동시 점유는 여전히 최대 1개(기존 일회용 DB 시험 E·G 관찰: 연결 25 → 24 + 스위치 연결 분리).
- [23:55] 변경 전 재현(일회용 MariaDB 10.11.19 · mysql2 풀 연결 10·대기열 무제한 · lock_wait_timeout 86400 · `LOCK TABLES system_config WRITE`) — L1 단일 호출 2000ms 에 timeout 으로 돌아오지만 **busy 1**, 서버 대기 SELECT 10초 안에 안 사라짐 · L2 같은 키 10건 동시 → 조회 10·**busy 10**·무관한 표 조회 1초 안에 안 끝남·경고 10줄 · L3 14분 17건(분당 1.21) → busy 1,2,…,10 (10분째 고갈, 대기열 8) · L4 풀이 바쁜 동안 읽기 → 늦게 받은 연결로 SELECT 를 보내 서버 대기 1·busy 1. 단위 시험: 기존 18 + 동치 23 은 통과, 새 동작 13건 실패(= 재현). 로그 `~/.node-local/t139-logs/before-db.log`·`before-unit.log`.
- [23:55] 변경 후 — L1 2001ms timeout, 돌려줄 때 **busy 0**(all 0), 서버 대기 SELECT 1016ms 에 소멸, 잠금 해제 뒤 곧바로 켜짐(value) · L2 조회 1·busy 0·무관한 조회 통과·서버 1007ms 소멸·경고 1줄 · L3 17번 모두 busy 0, 조회 17(캐시가 매번 지남), 서버 대기 0 · L4 늦은 연결로 SELECT 안 보냄(서버 대기 0)·busy 0. 15/15.
- [23:55] 동치 증거 ① 단위 동치 표 23건(키 없음·첫 행 null·행 묶음 배열 아님·'true'·true·' true '·'false'·false·'"true"'·'TRUE'·'1'·1·'yes'·잘못된 JSON·NULL·value 열 없음·응답 해체 불가·DB 오류 2013·1146·getPool 예외·2초 초과(1ms 전에는 미결)·허용 밖 키 4종·오류 결과 30초 캐시)이 **변경 전 코드에서도** 같은 (enabled, source)·같은 경고 줄로 통과 — 목이 풀 query·받은 연결 어느 창구든 같은 `queryMock` 으로 가게 짰다 ② 기존 record-switch 시험 18건은 단언 무변경으로 전·후 통과 ③ 실 DB 동치 S 11건(키 없음·'true'·' true '·'false'·'"true"'·'TRUE'·'1'·잘못된 JSON·NULL·허용 밖 키·표 없음)이 전·후 모두 통과(정상 경로는 전·후 모두 busy 0).
- [23:55] 시험 결과(Node 24.22.2, 무거운 명령은 전부 flock) — record-switch.test.ts 58/58(변경 전 45/58) · 신규 일회용 DB 15/15(변경 전 11/15) · records 디렉토리 12 스위트 627 통과·90 건너뜀 · 기존 일회용 DB 4종(exit-judgment 42·job-run-log 32·judgment 9·ops 6) 모두 통과 · **전체 jest 362 스위트 10430 통과 · 실패 0 · 245 건너뜀(288초)** · `tsc --noEmit` 오류 0 · 바뀐 시험 8개 별도 tsc(strict·jest 타입) 오류 0 · eslint(next core-web-vitals + typescript — 저장소에 설정 파일이 없어 임시 설정) 바뀐 9개 0.
- [23:55] 변이 시험(worktree 를 복사한 샌드박스 `~/.node-local/t139-mut` 에서만 적용, 끝나고 삭제 — worktree 파일은 건드리지 않음) 9개 모두 잡힘: M1 destroy 삭제 → 단위 4·DB 5(L1~L4·표 없음 busy) · M2 조회 합치기 삭제 → 단위 5·DB L2 · M3 표지 정리 삭제 → 단위 7·DB L3(조회 2/17) · M4 늦은 연결 release 삭제(bounded-conn **사본**) → 단위 1·DB L4(busy 1) · M5a 초과→켜짐 8 · M5b 읽기 오류→켜짐 14 · M5c 키 없음→켜짐 9 · M6 세대 확인 삭제 1 · M7 초기화가 표지를 남김 1.
- [23:55] 목 갱신과 단언이 약해지지 않은 근거 — 6개 파일 모두 받은 연결을 **처음 보낸 문장**으로 갈라 스위치 SELECT 연결을 따로 센다. 기존 INSERT 연결 단언 값([1,1,0]·[1,0,1]·[0,2]·conns 30/5 등)은 숫자 그대로 두고, 스위치 연결 단언(release 1·destroy 0, 읽기 오류면 destroy 1)을 **추가**했다. 연결 받기 실패·늦은 연결 주입은 첫 연결(스위치)을 정상으로 두고 그 뒤에만 적용(`insertConnWith`) — 첫 연결이 정말 스위치였는지 `swEnds` 로 확인. `judgment-engine-wiring` ④ 는 via 기대값을 `['poolconn','pool','poolconn','poolconn']` 로 바꾸고 연결 번호로 「INSERT 2문장은 같은 연결 · 스위치는 다른 연결 · 둘 다 트랜잭션 연결 아님」을 추가. `judgment-recorder` 「진입점 동기 반환」은 연결 받기가 마이크로태스크 뒤라 스위치 SELECT 가 나간 것을 확인한 뒤 푼다, 「getPool 이 스위치 뒤에 던짐」은 첫 풀이 `getConnection` 도 주게 했다. 의미가 바뀐 단언은 「꺼짐·형식 밖 → 연결을 받지 않는다」 1건뿐 → 「INSERT 연결 0 · 스위치 연결 2(release)」로 정확한 수를 단언. 지우거나 느슨하게 바꾼 단언 없음.
- [23:55] 범위 밖 발견 ① `bounded-conn.ts` 머리 주석(23~24·31행)이 스위치 읽기를 「풀 query 그대로 / 범위 밖」으로 적어 이제 낡았다 — 수정 금지 파일이라 그대로 둠(후속 주석 정정 필요) ② 엔진·주문·`/api/health` 의 스위치 읽기는 여전히 상한 없음(task 「하지 않는 것」·T-131 23번 ①, 별도 설계) ③ 저장소에 eslint 설정 파일이 없어 `npm run lint`(next lint)는 대화형 설정을 요구한다.
- [23:55] 확인하지 못한 것 — 죽은 TCP(블랙홀 프록시) 장면은 이 구현으로 직접 돌리지 않았다(Reviewer F6 이 같은 설계의 복제본으로 확인, 내 L 시험은 표 잠금만) · 운영 DB·운영 풀 동작(금지 범위) · `next build` 미실행(바뀐 코드는 라이브러리 1파일, tsc 통과) · 시계가 뒤로 가는 캐시 경계는 예전과 같은 분기(`now - hit.at >= 0`)라 별도 시험 안 함.
- [23:55] Reviewer 가 먼저 볼 곳 — `record-switch.ts:92`(withBoundedConn — 상한 전 오류도 destroy, 지속 오류 시 재접속) · `:109-122`(readShared — `finally` 표지 정리·세대 확인·`.then` 이 던지면 합류자 전원 read_error) · `:62-66`(초기화 훅 확장) · `:135`(캐시 쓰기 위치 이동). 시험: `exit-judgment.test.ts:31·51`(newConn·insertConnWith — 첫 연결=스위치 가정), `judgment-recorder.test.ts:52·66`(makeConn·insertConnWith), `judgment-engine-wiring.test.ts:703-705`(연결 번호).
- [23:55] 재현 방법(서버) — 신규 DB 시험 `bash ~/.node-local/t139-run-db.sh <로그이름>` · 기존 일회용 DB 4종 `bash ~/.node-local/t139-run-existing-db.sh <로그이름>` · 변이 `bash ~/.node-local/t139-run-mutants.sh <로그이름> <DB 0|1> <변이ID…>`(변이 정의 `~/.node-local/t139-mutate.py`) · 로그 `~/.node-local/t139-logs/`. 컨테이너는 이름에 t139, 끝나면 제거(남은 것 0 확인).
- [00:24] Reviewer F-1/F-2/F-4 반영 — `record-switch.ts` 동작 코드 무변경(sha256 앞 16자 `327c290ebd6bca3e` 전·후 같음). ① F-1 시험 `record-switch.test.ts:465` 「🔴 캐시 시각은 조회가 끝난 시각 — 1.5초 걸린 값·2000ms 초과 결과 모두 끝난 뒤 29999ms 까지 hit, 30000ms 에 만료」(가짜 시계: 값 조회는 시작 1.5초 뒤, 멈춘 조회는 2초 뒤 timeout — 끝난 시각 +29,999ms 는 연결·SELECT 추가 0, +30,000ms 는 새 연결로 새 값) ② F-2 시험 `record-switch.test.ts:506` 「🔴 초기화 → 새 조회 진행 중 → 낡은 조회가 먼저 끝나도 새 표지·새 캐시를 지우거나 덮지 않는다(세 번째 호출은 새 조회에 합류)」(연결 2개·SELECT 2·세 번째 호출과 캐시 모두 새 조회 결과, 연결 2개 모두 release) ③ 변이(샌드박스 복사본에서만, 끝나고 원복 확인·삭제): M8 캐시 시각을 조회 시작으로 → F-1 시험만 깨짐(:489 에서 hit 여야 할 호출이 새 값으로 감) · M9 자기 표지 확인 삭제(무조건 삭제) → F-2 시험만 깨짐(:525 연결 받기 2 기대·3 실제). 둘 다 다른 58건은 통과 — 새 시험이 그 불변을 단독으로 고정 ④ F-4 주석 `bounded-conn.ts` 주석만 +5/−3(24행 1줄 · 31~34행 범위 밖 항목 재작성 — 스위치 읽기는 이제 이 헬퍼로 따로 2초 상한·destroy, 쓰기 연결과 다른 연결·동시 점유 1개), `git diff -w -U0` 의 바뀐 줄이 전부 ` *` 주석 줄(코드 줄 0) ⑤ 실행(Node 24.22.2·flock): record-switch.test.ts 60/60 · `src/lib/strategy` 46 스위트 1405 통과·90 건너뜀·실패 0 · `tsc --noEmit`(전체, 비증분) 오류 0 · 바뀐 시험 8개 별도 tsc(strict·jest 타입) 오류 0 · eslint(임시 설정) 바뀐 2개 0. ⚠ `bounded-conn.ts` 가 이번에 처음 바뀌었다 — 커밋 훅 감시 경로이고 Reviewer 판정 scope(00:18)에 없으므로, 커밋 전에 Reviewer 가 이 주석 diff 와 새 시험 2건을 포함한 scope 로 판정을 다시 남겨야 훅을 통과한다.

## Reviewer

- [00:18] 독립 감사 요약 — 결함 critical 0·high 0·medium 0·low 2·info 4, 의도(스위치 읽기가 멈춘 조회로 풀 연결을 붙잡지 않는다 + 같은 키 조회 합치기) 충족, 불변 조건(반환 모양·5값·키별 30초 캐시·꺼짐 판정·경고 문구) 유지, 범위 위반 없음. Developer 의 주장은 전부 직접 읽고 실행해 대조했다(아래). 화면 변경 없음 — 데모 게이트 해당 없음.
- [00:18] 방법·격리 — 서버 worktree `stockinvest-t139`(detached `a064722` 위 미커밋 9개)는 `git diff` 전체를 읽기만 했고 파일 9개 sha256 이 감사 전후 같다. 변이·재현·차분은 별도 복사본 worktree 2개(변경 후 `review-t139-tmp` · 변경 전 `review-t139-base`, `node_modules` 심볼릭 링크)와 일회용 MariaDB 10.11.19(`rev139-db`·`rev139-churn`, 127.0.0.1·임의 포트/비밀번호)에서만 했다. 운영 DB·pm2·`system_config` 는 건드리지 않았다. 끝나고 복사본 2개·임시 디렉터리·컨테이너 전부 제거(남은 것 0 확인).
- [00:18] 1) 범위 — `git diff --stat` 8개 변경 + 신규 1개 = 정확히 `record-switch.ts` · 그 시험 2개(`record-switch.test.ts`·신규 `record-switch-disposable-mariadb.test.ts`) · 목만 갱신한 시험 6개. `bounded-conn.ts`·`exit-judgment.ts`·`engine.ts`·`job-run-log.ts`·`judgment-recorder.ts`·`src/lib/exchanges/*`·엔진/주문/`/api/health` 의 스위치 읽기는 diff 에 없다. 새 파일은 시험 1개뿐이고 비밀번호는 환경변수(`T139_DB_*`)로만, 값은 합성값 — 비밀·보유 정보·금액 없음. 9개 전부 커밋 훅 감시 경로 `^src/lib/strategy/` 아래.
- [00:18] 2) 수명주기 정확성 — `record-switch.ts` 전체를 한 줄씩 읽고 `withBoundedConn`·`withDeadline`(`safe-text.ts:106`)과 맞춰 봤다. 진행 중 표지(`inflight`)는 `readOnce` 가 던지지 않으므로 값·오류·상한 초과·`getPool()` 예외·`getConnection` 동기 예외 어느 경로로 끝나도 `.finally`(`:118-120`)가 지운다. 세대(`generation`)는 운영 경로에서 바뀌지 않는다(`resetRecordSwitchCacheForTest` 는 시험 전용 — 운영 import 0건 grep 확인). 직접 만든 경계 시험(`.then` 안 `Date.now()` 예외 · 낡은 조회가 새 조회보다 늦게 끝남 · `release` 던짐 → `destroy` 대체 · `destroy` 도 던짐 → 흡수 · `getConnection` 동기 throw · 상한 1999ms/2000ms 경계)이 모두 기대대로: 결과 처리에서 예외가 나도 합류 5건 전원 `read_error`·표지 정리·다음 호출은 새 조회, 연결은 정확히 한 번 끝남. jest 안에서는 처리되지 않은 거부 감지기가 양성 대조에서 잡히지 않아(감지기 무효) 일반 node 하네스(swc 로 3파일 변환, 양성 대조 통과)로 따로 10개 장면 — 늦은 응답·늦은 실패·늦게 받은 연결·늦게 거부된 `getConnection`·동시 10건 포함 — 을 돌려 `unhandledRejection`·`uncaughtException` 0, 연결 끝내기 장면별 정확히 1회, 동시 10건 = SELECT 1·경고 1줄 확인.
- [00:18] 2-b) 캐시 쓰기 위치 이동 — 예전은 호출자마다 `cache.set`, 지금은 조회 쪽에서 한 번(`:115`). 동시 호출이 없으면 결과 동일(차분 시험), 합류 호출은 같은 객체 참조를 받는다(예전에도 캐시 hit 는 같은 참조였고 소비자 `job-run-log.ts:617`·`ops/metrics/analysis-runs.ts:71` 은 읽기만 한다). 시간 기준은 조회가 끝난 시각(`Date.now()` 를 `.then` 안에서 부름)으로 예전과 같다.
- [00:18] 3) 의도한 동작 차이 — (a) 같은 키 동시 N회 = 조회 1·경고 1줄: 7개 응답 종류(값 true/false·키 없음·문장 오류·멈춤·`getPool` 예외·응답 해체 불가) × 키 3개에서 동시 7건의 결과가 변경 전 단일 호출 결과와 같고 SELECT 는 1(`getPool` 예외는 0), 경고 줄 수는 변경 전 단일 호출과 같았다. (b) 상한 전 문장 오류도 `destroy` — 맞다(`withBoundedConn` 의 `catch → bc.abort() → end('destroy')`). 실측(일회용 DB, 표 이름을 바꿔 1146 을 지속, 키 3개를 캐시가 매번 만료되는 61초 간격으로 20바퀴=60읽기): 변경 후 서버 새 연결 59·`Aborted_clients` +60·MariaDB 로그 `Aborted connection` 60줄·풀 `all` 0 으로 줄었다가 필요할 때 다시 늘어남, 변경 전은 새 연결 0·+0·0줄. 즉 「키마다 30초에 한 번」은 상한이고 호출 주기(크론 매분)로는 키당 매분 1회 안팎 — 부담은 사소하지만 지속 오류 동안 DB 로그에 경고가 쌓이고 `Aborted_clients` 카운터가 오른다(발견 F-3, 정보). 연결을 못 받은 오류(`getConnection` 거부)는 destroy 할 연결이 없고, 예전 `pool.query` 도 같은 연결을 다시 맺으려 했으므로 새 부담이 아니다.
- [00:18] 4) 차분(differential) 시험 — 변경 전 파일(`git show a064722:…record-switch.ts` 사본)과 변경 후를 같은 프로세스에 올려 같은 목 풀(풀 query·받은 연결이 같은 응답기)에 대고 무작위 연산 열 400개×60연산(키 3종+허용 밖 키 3종·값 18종·행 없음/null/배열 아님/해체 불가·오류 4종+문자열·undefined 거부·`getPool` 예외·멈춤, 시간 경과 1ms~61s)을 순차로 돌려 반환값·보낸 SELECT(SQL·파라미터)·경고 줄을 비교: 호출 14,722건(value 5871·read_error 4693·missing 2329·timeout 938·unknown_key 891)에서 차이 0. 단 하나, 드라이버가 해체할 수 없는 값(undefined/null)을 줄 때 경고 줄 끝의 V8 오류 문구가 다르다(`undefined is not iterable (…)` ↔ `(intermediate value) is not iterable`) — enabled·source 는 같고 실제 mysql2 는 그런 값을 주지 않는다(발견 F-5, 정보). 의도한 차이(동시 합치기)만 달랐다.
- [00:18] 5) 결함 수정 확인(일회용 MariaDB, 실제 mysql2 풀 연결 10·대기열 무제한, `LOCK TABLES system_config WRITE`) — 변경 후: 단일 호출 2001ms 에 timeout·돌려줄 때 busy 0·서버의 대기 SELECT 1010ms 에 소멸·잠금 해제 뒤 곧바로 켜짐(value) · 동시 10건 SELECT 1·busy 0·무관한 표 조회 통과·경고 1줄 · 14분 17건(분당 1.21) busy 추이 전부 0 · 풀 10개가 바쁜 동안 읽기 → 2001ms timeout, 풀이 풀린 뒤 서버 대기 0·busy 0. 변경 전(`a064722` worktree, 같은 시험 파일): 15건 중 4건 실패 — 단일 busy 1·서버 대기 안 사라짐 · 동시 10건 SELECT 10·busy 10·무관한 조회 pending·경고 10줄 · 14분 추이 1,2,…,10(10번째 읽기부터 고갈, 대기열 8) · 늦은 연결이 SELECT 를 보내 서버 대기 1·busy 1. 이전 Reviewer 재현 원본(adj126 E1~E4·X1)도 변경 전에서 같은 점유(E1 +2.5초 뒤에도 busy 1, E2 busy 10·무관한 쿼리 pending)를 보이고 변경 후엔 busy 0(E3 은 청산 기록 경로 `recordExitJudgments` 포함 14분 busy 0, E4 disabled 2003ms·busy 0). 기존 일회용 DB 시험 4종(exit-judgment 42·job-run-log 32·judgment 9·ops 6)도 변경 후 전부 통과.
- [00:18] 6) 목 갱신 단언 약화 여부 — 6개 시험의 diff 를 줄 단위로 읽었다. 삭제된 줄은 목 구성 교체(`connMock` → 받을 때마다 새 연결)와 연결 수 단언의 재표현뿐이고, 재표현은 INSERT 쪽 값([1,1,0]·[1,0,1]·[0,2]·conns 30/5 등)을 숫자 그대로 두고 스위치 연결 단언을 추가했다. 확인을 위해 변경 전 시험 4개(`orig-` 사본)를 변경 후 코드로 돌리니 391건 중 197건 실패·193 통과, 실패는 서로 다른 단언 줄 18곳에 몰렸고 전부 받은 연결 수·`via`·`getConnection` 호출 수·release/destroy 수 단언이다(176건이 `exit-judgment-engine-wiring` 의 `expect(acq).toBe(ins.length)` 한 줄 — 스위치 연결이 받은 연결로 세어져서). 나머지 193건은 단언 변경 없이 통과 → Developer 의 「의미가 바뀐 단언 1건(연결을 받지 않는다 → INSERT 연결 0·스위치 연결 2)」과 일치하고 그 외 완화 없음. 반대로 변경 후 시험 5개를 변경 전 코드로 돌리면 449건 중 208건 실패 — 새 단언이 실제로 변경을 검출한다. 순서 의존: 「첫 연결=스위치」 가정(`exit-judgment.test.ts` newConn·insertConnWith, `judgment-recorder.test.ts` makeConn·insertConnWith)은 스위치가 캐시되어 있으면 어긋나지만, 각 시험이 `swEnds()` 로 첫 연결이 정말 스위치 SELECT 였는지 확인하고 시험마다 캐시를 비우므로 어긋나면 조용히 통과하지 않고 크게 실패한다. 실제 mysql2 와 다른 가정은 `release`/`destroy` 가 던지지 않는다는 점 정도이고 이는 경계 시험으로 따로 확인. (변경 전 `record-switch.test.ts` 는 풀 목에 `getConnection` 이 없어 변경 후 코드에서 시험 자체가 처리되지 않은 거부로 프로세스를 죽이므로 비교에서 뺐다 — 목 모양 차이이지 코드 결함이 아니다.)
- [00:18] 7) 변이 시험 — 복사본에서 15종(Developer 의 9종과 별개): 키 간 합침 · 합치기 삭제 · 표지 정리를 value 일 때만 · timeout 일 때만 안 지움 · 표지 무조건 삭제(자기 표지 확인 삭제) · 캐시 시각을 조회 시작으로 · 상한 무시(1e9) · 오류/초과 결과 캐시 안 함 · 연결 우회(풀 query) · 참 판정 완화(truthy) · 초기화가 표지를 남김 · 초기화가 캐시를 남김 · timeout 을 missing 으로 · `getPool()` 을 본문 밖으로 · 호출자마다 캐시 쓰기. Developer 시험이 12종을 잡았고 3종 생존: 표지 무조건 삭제(F-2) · 캐시 시각을 시작으로(F-1) · `getPool()` 위치(결과·경고가 같아 동치 변이로 판단). 생존 2종은 제가 만든 경계 시험(낡은 조회 후 세 번째 호출 합류 / 상한 초과 결과의 29,999ms 뒤 hit·30,000ms 뒤 만료)이 각각 잡는다.
- [00:18] 8) 시험 실행(Node 24.22.2, 전부 `flock /tmp/stockinvest-heavy-tests.lock` 직렬) — 전체 jest 362 스위트 통과(7 건너뜀)·10430 통과·245 건너뜀·실패 0(288.5초, Developer 보고와 건수까지 같다; 내 임시 시험 제외) · `tsc --noEmit -p tsconfig.json` 오류 0 · 바뀐 9개 파일만 따로 strict+jest 타입으로 `tsc` 오류 0(변이 복원 뒤 재실행). 이 파일을 목으로 쓰는 시험(ops-routes·metric-state·job-run-log)은 모듈 전체를 목으로 대체하므로 영향 없고, 실물을 쓰는 시험(engine-exit-state-load-isolation·ops/exit-judgment 일회용 DB)은 `resetRecordSwitchCacheForTest` 를 불러 새 표지도 같이 비운다.
- [00:18] 발견 F-1 (low) `src/lib/strategy/records/record-switch.ts:115` — 캐시 시각이 「조회가 끝난 시각」이라는 불변을 지키는 시험이 없다. 변이로 `at` 를 조회 시작 시각으로 바꾸면 Developer 의 시험 58건이 전부 통과한다. 운영 영향: 되돌아가면 상한 초과(2초) 결과의 캐시가 최대 2초 짧아질 뿐 안전 영향 없음. 권고: 「2000ms 초과로 끝난 결과가 끝난 뒤 29,999ms 까지 hit·30,000ms 에 만료」 시험 1건 추가(내가 쓴 시험으로 잡힘 확인).
- [00:18] 발견 F-2 (low) `record-switch.ts:119` — `if (inflight.get(key) === flight)` 자기 표지 확인이 무조건 삭제로 바뀌어도 시험이 통과한다(초기화 뒤 새 조회가 진행 중일 때 낡은 조회가 끝나면 새 조회의 표지를 지워 그 사이 세 번째 호출이 조회를 중복한다). 운영에서는 세대가 바뀌지 않아 이 분기가 일어나지 않으므로(시험 전용 초기화 훅에서만) 영향은 시험 안정성뿐. 권고: 「초기화 → 새 조회 진행 중 → 낡은 조회 종료 → 세 번째 호출이 새 조회에 합류(연결 2개)」 시험 1건 추가(내 시험으로 잡힘 확인).
- [00:18] 발견 F-3 (info) 문장 오류에도 연결 `destroy`(`bounded-conn.ts:177-179` — 본문이 던지면 abort → destroy)의 부수 효과 — 지속 오류 동안 DB 서버에 `Aborted connection` 경고 로그와 `Aborted_clients` 증가가 호출 주기만큼 쌓인다(위 3 실측). 풀·DB 부하나 안전 위험은 아니고 DB 운영 알림이 그 카운터를 보면 거짓 경보가 될 수 있다. 수정 불필요(공용 `bounded-conn.ts` 는 이 task 의 수정 금지) — 배포 뒤 DB 로그에서 확인할 항목으로만 남긴다.
- [00:18] 발견 F-4 (info) `bounded-conn.ts:30-33` 머리 주석이 여전히 스위치 읽기를 「풀 query / 범위 밖」으로 적어 낡았다(Developer 도 같은 지적). 후속 주석 정정 필요(별도 변경).
- [00:18] 발견 F-5 (info) 위 4 의 V8 오류 문구 차이 — 해체 불가 드라이버 값에서만 경고 줄 끝 문구가 다르다. 조치 불필요. 발견 F-6 (info) `withDeadline` 타이머가 `unref()` 라서(`safe-text.ts:95-97`) 다른 핸들이 없는 일반 node 스크립트에서는 대기 중 프로세스가 끝날 수 있다 — 운영 서버(Next.js)에는 다른 핸들이 있어 해당 없음, 이 변경이 만든 것도 아님.
- [00:18] 확인하지 못한 것 — (1) 죽은 TCP(블랙홀 프록시) 장면은 이 구현으로 돌리지 않았다(이전 Reviewer 의 같은 설계 복제본 확인과 같은 수준에서 신뢰) (2) 정지 유형은 `LOCK TABLES WRITE`(메타데이터 잠금)만 — 디스크 정지·ALTER 의 메타데이터 잠금 대기 등은 재현하지 않았다. 클라이언트 쪽 슬롯 반환은 정지 원인과 무관하게 `destroy` 로 보장되지만 서버 쪽 정리 시간(여기서는 약 1초)은 원인마다 다를 수 있다 (3) 운영 DB·운영 풀·실제 크론 주기의 장시간 거동(금지 범위) (4) `next build` 미실행(라이브러리 1파일, `tsc` 통과) (5) 갤럭시/모바일 화면 해당 없음. 엔진·주문·`/api/health` 의 스위치 읽기 상한 없음(`readExitEngineSwitch`·`isKillSwitchActive`·`isDryRun`)은 task 「하지 않는 것」이라 이번 판정 밖이고 여전히 남아 있다.
- [00:18] QA 인계 high_risk_areas — `src/lib/strategy/records/record-switch.ts:92`(withBoundedConn — 상한 전 오류도 destroy) · `:109-123`(readShared — 표지/세대/캐시 쓰기) · `:62-66`(시험용 초기화 훅) · `:135`(합류 진입) · 기록기가 스위치를 읽은 뒤 쓰기 연결을 받는 순서: `judgment-recorder.ts:297→기록 INSERT`, `exit-judgment.ts:354→:363`(`getPool().getConnection()`), `job-run-log.ts:617→upsert`(기록 1회의 동시 점유 최대 1개 유지 확인). 배포 뒤 관찰 제안: `pm2 logs` 의 `[strategy/records/switch]` 경고 0줄 유지(지금 `job_run_log_enabled` 가 분당 약 1회 이 경로를 실행), DB 서버 `Aborted_clients` 가 평시에 늘지 않는지.
- [00:18] **최종 판정: PASS (scope: src/lib/strategy/records/record-switch.ts, src/lib/strategy/records/__tests__/record-switch.test.ts, src/lib/strategy/records/__tests__/record-switch-disposable-mariadb.test.ts, src/lib/strategy/records/__tests__/exit-judgment.test.ts, src/lib/strategy/records/__tests__/exit-judgment-engine-wiring.test.ts, src/lib/strategy/records/__tests__/judgment-recorder.test.ts, src/lib/strategy/records/__tests__/judgment-engine-wiring.test.ts, src/lib/strategy/records/__tests__/job-run-log-disposable-mariadb.test.ts, src/lib/strategy/records/__tests__/judgment-disposable-mariadb.test.ts)**
- [00:29] 재검토(Developer 가 F-1·F-2 시험 2건과 F-4 주석 정정 반영, 변경 파일 10개) — 결론: 위 발견 F-1·F-2 해소 확인, F-4 부분 해소(같은 종류 낡은 주석 2곳이 남아 F-7 로 추가, 정보), 동작 코드 무변경, 결함 critical 0·high 0·medium 0·low 0·info 6. 이전 bullet·이전 판정 줄은 그대로 두고 아래에 이어 적는다. 검증은 별도 복사본 worktree(`a064722` + 현재 10개 파일 diff 적용, 시작·종료에 Developer worktree 와 파일 10개 sha256 일치 확인)에서 했고 끝나고 제거했다.
- [00:29] 1) 동작 코드 불변 — `record-switch.ts` sha256 앞 20자 `327c290ebd6bca3ebb2e`(요청에 적힌 `327c290e…` 와 일치, mtime 23:30:47 = 감사 시작 전). 달라진 파일은 `record-switch.test.ts`(mtime 00:22:45, 변경 줄 303 → 375) 와 `bounded-conn.ts`(mtime 00:23:03, 8줄) 둘뿐. 정직한 한계: 감사 때 만든 sha256 목록은 정리하며 지워서 나머지 7개 파일의 값을 목록과 대조하지는 못했다 — 대신 (a) 7개 파일 mtime 전부 감사 시작 전(23:28~23:42) (b) `git diff --stat` 줄 수가 감사 때와 모두 같음(exit-judgment-engine-wiring 35 · exit-judgment 66 · job-run-log-disposable 25 · judgment-disposable 25 · judgment-engine-wiring 27 · judgment-recorder 78 · record-switch.ts 77, 신규 일회용 DB 시험 308줄) (c) 이번 재검토 내내 10개 파일 sha256 이 시작·종료에 같음으로 갈음한다.
- [00:29] 2) `bounded-conn.ts` — `git diff -w -U0` 는 hunk 2개(24행 1줄 · 31-34행 2줄→4줄)이고 전부 머리 주석 블록(1-36행) 안이다. 코드 줄 변화 0 을 더 확실히 하려고 TypeScript `transpileModule`(removeComments)로 `a064722` 판과 현재 판을 각각 변환해 비교하니 출력 JS 가 완전히 같다(3347자). 새 주석의 사실 대조: 스위치 SELECT 1문장을 `withBoundedConn` 으로 따로 보내 2초 상한에 destroy(`record-switch.ts:92`) · 기록기의 쓰기 연결과 다른 연결(감사 때 목·실 DB 로 확인) · 기록기가 스위치를 먼저 await(`judgment-recorder.ts:297`·`exit-judgment.ts:354`·`job-run-log.ts:617`)해서 기록 1회 동시 점유 1개 — 모두 T-139 이후 사실과 맞고 같은 헤더의 다른 규칙·「쓰는 법」 예시와 모순 없다. 사소한 어색함 하나: 「범위 밖 (그대로 둔다)」 소제목 아래에 「이제 범위 밖이 아니다」 항목이 놓였지만 `(T-139 정정)` 표기가 있어 모순은 아니다.
- [00:29] 발견 F-7 (info) 같은 종류의 낡은 주석이 수정되지 않은 파일에 2곳 더 있다 — `judgment-recorder.ts:15`(「스위치 읽기·카드 id 조회는 예전처럼 풀 query 다」) · `job-run-log.ts:35`(「스위치 읽기는 예전처럼 풀 query 다」). 동작 영향 0, 이 task 의 수정 금지 파일이므로 후속 주석 정정으로 남긴다(`rg "예전처럼 풀 query"`).
- [00:29] 3) 새 시험 2건 품질 — 복사본에 변이를 직접 넣어 `record-switch.test.ts`(60건)를 돌렸다. F-1(`:465` 캐시 시각 = 끝난 시각): 캐시 시각을 조회 시작으로 → F-1 시험만 실패(1건, 새 시험이 유일하게 잡음) · 시간 초과 결과를 캐시하지 않음 → F-1 만 실패 · 캐시 판정 `<` → `<=` → F-1 + 기존 1건 · 캐시 시각 +1초 → F-1·F-2 포함 11건 · TTL 20초 → F-1 포함 4건. F-2(`:506` 자기 표지만 지움): 자기 표지 확인 삭제(무조건 삭제) → F-2 시험만 실패(1건) · 세대 확인 삭제 → F-2 + 기존 1건 · 초기화가 표지를 남김 → F-2 + 기존 1건 · 자기 표지 확인 반전 → 9건(F-1·F-2 포함). 생존 2종: TTL 상수를 31초로 바꾸는 변이 — 시험이 상수 `RECORD_SWITCH_CACHE_MS` 를 import 해 쓰므로 어느 시험도 못 잡지만 변경 전 시험(`a064722`)도 같은 방식이라 기존 속성이다(정보) · 자기 표지 확인을 세대 확인으로 바꾸는 변이 — 동작 동치. 시험 설계: F-1 은 가짜 시계 + `setSystemTime` 으로 값(1.5초 걸림)과 시간 초과(2초) 두 경로를 키 2개로 각각 끝난 시각 +29,999ms hit·+30,000ms 만료로 단언하고 SELECT 수·연결 수까지 확인해 가짜 시계 없이는 성립하지 않는다. F-2 는 `Date.now` 고정만 쓰고 순서(낡은 조회가 먼저 끝남 → 세 번째 호출이 새 조회에 합류)와 연결 2개·SELECT 2번·각 release 1회까지 단언한다.
- [00:29] 3-b) 가짜 시계 누출·기존 단언 — 새 시험도 기존 `afterEach`(`jest.useRealTimers()` + `jest.restoreAllMocks()`) 안에서 돌고 `beforeEach` 가 `queryMock.mockReset()` 한다. 확인을 위해 파일 끝에 「실제 시계/타이머 상태(Date.now 비목·타이머 시계 없음·심은 기준 시각 1.8e12 에서 1시간 넘게 떨어짐)」 probe 를 붙인 사본을 기본 순서와 `--randomize` 시드 4개(11·222·3333·44444)로 돌려 모두 61/61 통과, F-1·F-2 를 각각 단독(`-t`)으로 돌려도 통과 → 순서 의존·누출 없음. (첫 probe 는 내가 쓴 하한값이 틀려서(실제 현재 시각 약 1.79e12 < 내 하한 1.9e12) 실패했고 고쳐서 다시 돌렸다 — 코드 결함 아님.) 기존 단언은 약해지지 않았다: `record-switch.test.ts` diff 의 삭제 줄은 감사 때와 같은 2줄(`getPoolMock` 정의·재설정)뿐이고 기존 시험 줄 변경 0, 변경은 추가뿐.
- [00:29] 4) 실행(Node 24.22.2, 전부 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10` 직렬, 복사본에서) — `record-switch.test.ts` 60/60 통과 · `src/lib/strategy` 46 스위트 통과(일회용 DB 2 스위트 건너뜀)·1405 통과·90 건너뜀·실패 0(Developer 보고와 같음) · `tsc --noEmit -p tsconfig.json` 오류 0 · 바뀐 10개 파일만 따로 strict+jest 타입 `tsc` 오류 0. 전체 jest(362 스위트)와 일회용 DB 시험은 이번에는 다시 돌리지 않았다 — 동작 코드(`record-switch.ts`) 해시가 감사 때와 같고 추가 변경은 시험 2건과 주석뿐이라 앞선 결과(전체 10430 통과·일회용 DB 결함 수정 확인)를 유지한다.
- [00:29] 발견 갱신 — F-1·F-2 해소(시험 추가 확인, 변이로 각각 새 시험이 잡음) · F-3 정보 유지 · F-4 부분 해소(`bounded-conn.ts` 정정 확인) → F-7 로 남은 낡은 주석 2곳 · F-5·F-6 정보 유지. 확인하지 못한 것은 앞 bullet 과 같고 추가로 위 1)의 sha256 목록 대조 한계가 있다.
- [00:29] **최종 판정: PASS (scope: src/lib/strategy/records/record-switch.ts, src/lib/strategy/records/bounded-conn.ts, src/lib/strategy/records/__tests__/record-switch.test.ts, src/lib/strategy/records/__tests__/record-switch-disposable-mariadb.test.ts, src/lib/strategy/records/__tests__/exit-judgment.test.ts, src/lib/strategy/records/__tests__/exit-judgment-engine-wiring.test.ts, src/lib/strategy/records/__tests__/judgment-recorder.test.ts, src/lib/strategy/records/__tests__/judgment-engine-wiring.test.ts, src/lib/strategy/records/__tests__/job-run-log-disposable-mariadb.test.ts, src/lib/strategy/records/__tests__/judgment-disposable-mariadb.test.ts)**

## QA

- [00:45] 실행 환경: 서버 worktree `/home/brownjeon/.node-local/stockinvest-t139` (detached `d14ac78`, `git status --short` 0, untracked 0 — worktree 수정 없음). 무거운 명령은 전부 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10`, Node v24.22.2. 병합 상태는 별도 worktree `/home/brownjeon/.node-local/stockinvest-integ3` 에서 봤다(B 절).
- [00:45] A1 범위: `git diff --name-only a064722 d14ac78` = 10개 전부 `src/lib/strategy/records/` 아래(record-switch.ts · bounded-conn.ts · 시험 8개). `src/lib/exchanges/*`·`engine.ts`·`exit-judgment.ts`·`judgment-recorder.ts`·`job-run-log.ts`·`src/lib/safety/`·`ops/metrics/anomalies.ts`·`src/app/api/health` diff 0. bounded-conn.ts 의 바뀐 줄은 전부 주석(`*`·`//`), 코드 줄 0. 새 파일 0. 추가 줄 비밀 검사 — 매치는 시험 환경변수 이름(`T139_DB_PASSWORD`)·문서 셸 예시·시험 리터럴 `Pool is closed NAS:SECRET`(실제 값 아님). 실제 자격증명·계좌·금액 없음. **PASS**
- [00:45] A2 `npx jest src/lib/strategy/records/__tests__/record-switch.test.ts`: Tests 60 passed / 60 (0.145s). **PASS**
- [00:46] A2 `npx jest src/lib/strategy src/lib/ops src/lib/signals src/__tests__`: Suites 102 passed · 4 skipped(환경변수 없는 일회용 DB 시험) / Tests 3457 passed · 113 skipped · 0 failed (14.7s). `tsc --noEmit -p tsconfig.json` exit 0, 출력 0바이트. **PASS**
- [00:46] A3 일회용 MariaDB 10.11 신규 시험(`bash ~/.node-local/t139-run-db.sh qa-A3-newdb`, 127.0.0.1 임의 포트 컨테이너): 15/15 passed. 시험 파일은 `@/lib/db` 를 목으로 바꾸고 목 없이 운영 풀을 부르면 던지도록 되어 있어, 운영 DB 접속 경로는 없다(파일 읽어 확인). L1 단일 호출 1999ms 에 timeout·돌려줄 때 busy 0·서버 대기 SELECT 255ms 에 소멸·잠금 해제 뒤 value. L2 같은 키 동시 SELECT 1·busy 0·무관한 표 조회 통과·서버 대기 0·경고 1줄. L3 17회(분당 1.21) busy 추이 전부 0·서버 대기 1010ms 에 소멸·무관한 조회 통과. L4 풀 10개가 모두 바쁜 동안 읽기 2003ms timeout, 풀이 풀린 뒤 서버 대기 SELECT 0·busy 0. **PASS**
- [00:47] A3 기존 일회용 DB 4종(`bash ~/.node-local/t139-run-existing-db.sh qa-A3-existing`, 컨테이너 4회 각각 생성·제거): exit-judgment 42/42 · job-run-log 32/32 · judgment 9/9 · ops 6/6 전부 통과, jest exit 0 ×4. **PASS**
- [00:47] A3 정리: `docker ps -a` 의 t139 컨테이너 0(runner 종료 시 `container removed` 출력 확인).
- [00:47] A4 fail-closed 코드 읽기(`record-switch.ts` 148줄 전체): 키 없음 = `missing`·꺼짐 · 켜짐은 raw 가 `true` 이거나 문자열을 JSON 으로 읽은 값이 `true` 일 때만 · DB 오류·테이블 없음 = `read_error`·꺼짐 · 2초 초과 = `timeout`·꺼짐 · 허용 밖 키 = `unknown_key`·DB 를 건드리지 않음·꺼짐 · 캐시 30초(오류·초과 결과도 30초). `RecordSwitchSource` 5값 그대로 — 구현 파일에 전부 존재, 시험 파일에서 참조 횟수 missing 11 · value 31 · read_error 14 · timeout 10 · unknown_key 2. **PASS**
- [00:47] A4 관찰(정보, 비차단): `recordSwitchValueEnabled` 가 `JSON.parse` 를 쓰므로 앞뒤 공백이 있는 `" true "` 도 켜짐이 된다. 이번 변경 전부터 같은 규칙(T-112 시그널 게이트 복제본)이고 시험 표의 ` true ` 항목도 변경 전과 같은 결과다. 이번 task 범위 밖이라 기록만 남긴다.
- [00:47] 확인하지 못한 것(NOT_VERIFIED): ① 변경 전 코드(`a064722`)로 같은 시험을 돌리는 재현은 이 QA 에서 하지 않았다 — 변경 전 4건 실패는 Developer·Reviewer 기록 값이다. ② 죽은 TCP(블랙홀) 장면 미실행. ③ 엔진·주문·`/api/health` 의 스위치 읽기는 여전히 상한 없음(task「하지 않는 것」, 별도 설계). ④ 운영 DB·운영 풀·실 cron 장시간 동작(금지 범위) — 배포 뒤 `[strategy/records/switch]` 경고 0줄과 DB `Aborted_clients` 관찰은 배포 후 확인 항목(Reviewer F-3). ⑤ 화면 변경 없음(demo none) — 브라우저 검증 해당 없음. ⑥ eslint 설정 파일 없음 → 린트 미실행.
- [00:48] B 병합 상태(T-139 + T-140): `/home/brownjeon/.node-local/stockinvest-integ3`(detached `d14ac78`) 에 `git cherry-pick cbc85ee` 충돌 없이 적용 → HEAD `44d6011f2b866e307cacc74d7c45d6bc652e00b4`, tree `5379d79a0028e398ac969ba21a3aff117d887547`. `node_modules` 는 NFS 원본 심볼릭 링크. `.env` 없음(`.env.example` 만) — 운영 환경변수를 쓰지 않았다. status 0.
- [00:48] B1 full jest(`--forceExit --maxWorkers=4`, flock): Suites 362 passed · 7 skipped / Tests 10445 passed · 245 skipped · 0 failed (160.6s). **PASS**
- [00:49] B2 `tsc --noEmit -p tsconfig.json`: exit 0, 출력 0바이트. **PASS**
- [00:49] B3 `next build`(`NEXT_TELEMETRY_DISABLED=1`, `.env` 없이): exit 0, 경로 표 정상 출력. **PASS**
- [00:49] 배포 인계 참고(QA 판단, 결정은 Leader): 이 task 는 아직 커밋·push 되지 않은 `wip/T-139-…` 브랜치 상태다. 운영 반영은 커밋·push 뒤 deployer 인계, 사용자 배포 승인 뒤 cherry-pick 순서. 병합본을 올릴 때 tree `5379d79a0028e398ac969ba21a3aff117d887547` 와 같은 내용인지 대조한다.
- [00:49] **QA 최종: PASS**

## Codex 검토

- [2026-10-31] 이 task 의 변경은 Codex 로 검토하지 않는다(소급 검토 5건이 한도를 소진시키는 중이고, 독립 Reviewer·QA 가 있다). 필요하면 judge `codex_gate` 판정을 따른다.

## 최종 요약

### [T-139] 기록 스위치 읽기가 멈춘 DB 조회로 공용 풀 연결을 붙잡던 문제 정정

- **상태**: ✅ 운영 반영 완료 (2026-11-01 09:41 KST) — 구현·Reviewer·QA 완료, 배포 직후 점검 이상 없음(아래 「배포 기록」)
- **무엇이 바뀌었나**: 판단 기록·잡 실행 기록의 켜짐/꺼짐 스위치를 DB 에서 읽는 조회가 멈춰도 2초 뒤 연결을 끊어 공용 풀(연결 10개)을 붙잡지 않는다. 같은 키의 동시 조회는 1번으로 합친다. 켜짐/꺼짐 판정 규칙(키 없음=꺼짐, 정확히 JSON `true` 만 켜짐, 오류·2초 초과=꺼짐)과 30초 캐시는 그대로다. 화면 변화는 없다.
- **배포**: ✅ 2026-11-01 09:39 push(`d0d203c..81a1aab`) → 09:41:41 완료, 릴리스 `20261101-094008-81a1aabe`, `RELEASE_RESULT ok`, 마이그레이션 없음. 이 작업의 코드 커밋은 `3d40f6a`(side branch `d14ac78` 을 T-141 `d0d203c` 위에 cherry-pick). 같은 배포에 실린 것: T-140 `967259f`, 문서 커밋 `81a1aab`. 롤백 대상 `20261101-093319-d0d203cf`.
- **AI 가 검증한 것**: 독립 Reviewer PASS(결함 critical~low 0 — 시험 공백 Low 2건은 시험 추가로 해소). 일회용 MariaDB 10.11 + 실제 mysql2 풀(연결 10)에서 `LOCK TABLES system_config WRITE` 재현 — 변경 전: 단일 호출 연결 점유 지속·동시 10건 연결 10개 점유·14분 모사 10분째 풀 고갈 → 변경 후 전 장면 점유 0, 서버의 대기 SELECT 약 1초 안에 소멸. 변경 전후 차분 시험 14,722호출 동치(차이는 의도한 합치기뿐), 변이 시험 15종 중 12종 검출(생존 3종은 시험 보강 2건과 동치 1건). 병합 상태(origin/main `18896a8` + T-139 + T-140, tree `83f87014`): 전체 jest 10449 통과·실패 0, `tsc` 0, `next build` 0.
  - 검증 못 한 것: 죽은 TCP(블랙홀) 장면 · 디스크 정지/DDL 메타데이터 잠금 같은 다른 정지 유형 · 운영 풀의 장시간 거동.
- **👉 사용자가 확인할 것**: 배포 직후(09:42~09:45) 점검은 AI 가 마쳤다(기록 스위치 경고 0줄·health green·`Aborted_clients` 불변). 남은 확인: ① 약 1시간 뒤(10:45 이후)와 월요일 개장 후  `grep -c "\[strategy/records/switch\]" /home/brownjeon/apps/stockinvest/shared/logs/pm2-err.log` 증가분 0줄(기록 스위치 경고 없음) ② `/api/health` 200·`safetyStatus` green ③ 평시 DB `SHOW GLOBAL STATUS LIKE 'Aborted_clients'` 가 분당 수 개 이상 늘지 않는지(문장 오류가 지속될 때만 늘도록 설계) — 오늘 오전부터.
- **👉 사용자가 결정할 것**: 없음(배포 완료).
- **남은 일**: 엔진·주문·`/api/health` 의 스위치 읽기(`readExitEngineSwitch`·`isKillSwitchActive`·`isDryRun`)에는 여전히 상한이 없다 — T-131 #28 설계 결정. `judgment-recorder.ts:15`·`job-run-log.ts:35` 의 낡은 주석 2곳 정정(후속, 동작 무관).
- **이슈·위험**: 문장 오류가 지속되는 동안 키마다 30초에 한 번 재접속(키 3개 → 분당 최대 6회)하고 DB 로그에 `Aborted connection` 경고가 쌓일 수 있다(풀·DB 부하 아님, DB 알림이 `Aborted_clients` 를 보면 거짓 경보 가능). 롤백: `git revert` 후 push, 또는 기록 스위치 3개 중 필요한 것만 `false`.

## 배포 기록

- [2026-11-01 09:39] **배포 완료.** 사용자 지시 「T-139,T-140 푸시 및 배포 진행해줘」. 서버 체크아웃에서 `git push origin main`(`d0d203c..81a1aab`, 커밋 3개: T-139 `3d40f6a` · T-140 `967259f` · 문서 `81a1aab`). webhook blue/green 09:39:59 시작 → 09:41:41 완료(`exit=0`). `RELEASE_RESULT {"status":"ok","release":"20261101-094008-81a1aabe","sha":"81a1aabe0da0d0b3fe9d5d5f038b7569cd4de2b9","previous":"…/releases/20261101-093319-d0d203cf","migrated":false}`. DDL·스위치 변경 없음.
- 병합 상태 재검증(배포 전): 승인 후 확인해 보니 그 사이 다른 세션이 T-141(`d0d203c`)을 push·배포(09:33~09:34)해 base 가 바뀌어 있었다. 그 위에 cherry-pick 한 상태(HEAD `967259f`, tree `8ec03ee8`)로 전체 jest **10455 통과·실패 0**(7 suite·245 시험 건너뜀), `tsc` 0, `next build` 0 을 다시 돌렸고, 직전 검증본(tree `83f87014`)과 T-139/T-140 14개 파일의 차이는 0 이다. 검증한 commit 을 그대로 `git merge --ff-only` 로 main 에 올려 push 했다(tree 일치 확인).
- 배포 시각: 승인 시점의 계획은 05:10~08:30 창이었으나 승인 응답이 09:3x 에 와서 **창 밖(일요일 09:39, 양 시장 휴장일)** 에 나갔다. 영향은 휴장일이라 없었고, 이 점은 사용자에게 보고했다.
- 배포 후 점검(09:42~09:45, 읽기 전용): ① `current` → 새 릴리스, 소스에 `withBoundedConn` 반영 ② pm2 `stockinvest`·`stockinvest-cron` online·restarts 0·unstable 0·`pm_cwd` 새 릴리스(시작 09:40:41/42) ③ `cron-runner.sh` 1개, 분당 잡 중복 없음 ④ `/api/health` `ok:true`·`db:true`·`schemaFatal:false`·`safetyStatus:"green"`·`dryRun:true`·`killSwitch:false` ⑤ `system_config` 안전 키 6개 값·`updated_at` 전부 불변 ⑥ **`pm2-err.log`·`pm2-out.log`·`cron-err.log` 에 `[strategy/records/switch]` 경고 0줄**, 배포 이후(09:41:30~) `pm2-err.log` 새 줄 0·`cron-err.log` 0B ⑦ `Aborted_clients` 2652(09:42) → 2652(09:43) → 2654(09:44) → 2654(09:44:54) — 공용 MariaDB 전체 카운터(업타임 약 34.7시간에 2,652 ≒ 시간당 76)라 다른 앱 접속 포함, 증가 미미 ⑧ 배포 순간(09:40:41) 새 크론 러너가 웹 기동 전에 부른 4건이 `HTTP=000` 으로 실패해 스풀에 남았고 웹이 뜬 뒤 재전송되어 `job_run_log` 에 기록됐다(run_id 7588~7591, `signal-followup`·`signal-expiry`·`trade-report` 는 `failed/HTTP=000`, `portfolio-snapshot` 은 `skipped`) — **이 기록이 새 웹의 새 스위치 읽기 경로(`job_run_log_enabled`)를 거쳐 들어갔으므로 운영에서 스위치가 켜짐으로 읽힌다는 증거**다. `HTTP=000` 3건은 웹 재시작 순간의 연결 거부로 판단한다(가능성 높음 — 이 배포에서만 확인했고 이전 배포와 비교하지는 않았다). 이 변경과 무관한 재시작 구간의 일시 현상이며, 같은 잡의 다음 주기 정상 기록은 아직 확인하지 않았다.
- 관찰(이상 아님, 이 변경과 무관): 배포 전 `pm2-err.log` 에 `[strategy/records/job-run-log] 503 reason=timeout (deadline=2500ms)` 가 05:09~06:04 사이 13줄, 06:00:08 `corp-intel` DB 대기 상한 2줄 — DB 가 느렸던 창으로 보이고 배포 이후엔 0건. 옛 코드에는 스위치 읽기에 경고가 없어서 그 창에 스위치 읽기가 멈췄었는지는 알 수 없다.
- **확인하지 못한 것**: 장중(월요일 개장 후) 엔진·주문 경로의 스위치 읽기 거동 · 평시 1시간 뒤 재측정 · 홈 A4 화면(로그인 필요 — T-140 쪽) · 문장 오류가 지속될 때의 재접속(시험으로만 확인).

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 해당없음 | - | - | judge: none | 10-31 23:17 |
