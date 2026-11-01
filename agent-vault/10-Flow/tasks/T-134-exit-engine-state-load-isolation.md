---
task_id: T-134
title: 청산 엔진 — 보유 종목 상태 조회(loadPositionState) 실패 한 번이 그 시장 틱의 남은 종목 손절·익절 평가를 통째로 멈추는 문제 (종목 단위 격리)
status: deployed
priority: high
project: StockInvest
created: 2026-10-31
updated: 2026-10-31
base_ref: c593300 (로컬 main — origin/main ad45efc 의 문서 1커밋 앞)
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa]
related_tasks: [T-131-t126-t130-followup-candidates, T-126-exit-judgment-persistence, T-128-t108-followups, T-133-ticker-business-failure-retry, T-135-recorder-pool-hold-and-runner-tmp]
tags:
  - type/task
  - domain/safety
  - domain/strategy
aliases:
  - 청산상태조회격리
waiting: [배포 후 관찰: 홈 「데이터 이상」 이 0 이 아닐 때 새 게이트 「청산: 포지션 조회 실패」 확인 — 실패가 실제로 나야 운영에서 볼 수 있다]
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

[[T-131-t126-t130-followup-candidates]] 3번 — 사용자 지시 「권고대로 착수」(2026-10-31, 후속 우선순위 1순위 묶음). T-126 Reviewer·Developer 가 변경 전 트리에서도 재현된다고 확인한 **기존 결함**이다.

`src/lib/strategy/engine.ts` 의 청산 평가 루프(`runExitEngine`)는 종목마다 이웃 호출을 격리한다.

| 호출 | 위치(HEAD c593300 기준 줄은 근사) | 실패 시 |
|---|---|---|
| `kis.getTicker` | ~863 | try/catch → `exit_ticker_error` 기록 → `continue` |
| `upsertPositionState` | ~879 | try/catch → `exit_state_upsert_failed` 기록 → `continue` |
| **`loadPositionState`** | **~888** | **try/catch 없음** — 예외가 루프 밖으로 나간다 |

`loadPositionState`(`src/lib/strategy/position-state.ts:73`)는 `getPool().query` 한 번이고 자체 catch 가 없다. 풀 대기 초과·연결 끊김·DB 일시 정지처럼 **한 번의 조회 실패**가 나면 예외가 `for` 루프를 끊어, 그 틱에서 **아직 평가하지 않은 보유 종목의 손절·익절 평가가 건너뛰어진다**(다음 틱 약 5분 뒤에 다시 시도). 같은 틱에 `exit_judgment` 수집기 flush(T-126)도 건너뛰어져 그 틱의 행이 남지 않는다. 상위에서 예외를 어떻게 받는지(라우트 500 → `job_run_log` failed 로 보이는지)는 **Developer 가 코드로 확인해 이력서에 적는다.**

[가능성 높음] 이웃 호출과 같은 형태로 종목 단위 격리가 맞다 — 실제 DB 조회 한 번 실패가 얼마나 자주 나는지는 운영 데이터로 확인하지 않았다(오늘 NAS DB `ECONNREFUSED` 사례가 22:56 에 1회 있었다는 기록이 T-112 관찰에 있다).

## 관련 과거 이력 요약 (Leader)

- 승인된 교훈(`issues related safety strategy cron`): **없음**.
- [[T-126-exit-judgment-persistence]]: 루프 안 결론 지점마다 `noteExitJudgment(exitJudg, decision, gate, ctx)` 가 있고(1:1 정적 시험 + 동적 20장면 + 변경 전 트리 대조 하네스 329건), 기록 스위치는 곧(15:41 예약) 켜진다. 새 격리 지점도 **같은 규칙으로** 결론을 기록해야 한다(`decision='error'`).
- [[T-128-t108-followups]]·T-130: 게이트 이름의 한국어 문구는 `src/lib/ops/reason-dictionary.ts` 한 출처이고, 키 일치 시험(`KNOWN_UNMAPPED` 등)이 있다 — 새 게이트 ID 를 만들면 문구·시험을 함께 맞춘다.
- Reviewer 가 쓴 변경 전/후 동치 하네스: 스크래치패드 `rev-t126/`(`rev-t126-equiv2.test.ts`·`mutate3.py`) — 참고용 (Mac 세션 스크래치패드라 서브에이전트가 읽을 수 있다).

## 범위 (이번에 한다)

1. `engine.ts` 의 `loadPositionState` 호출을 이웃과 같은 형태로 격리한다: `console.warn`(종목·메시지, 비밀·금액 없음) + `rec.error('exit_state_load_failed', { symbol, side: 'sell', detail: { error: String(e).slice(0, 300) } })` + `noteExitJudgment(exitJudg, 'error', 'exit_state_load_failed', { symbol, entry, ticker })` + `continue`.
2. 새 게이트 ID `exit_state_load_failed` 가 **나열된 모든 곳**을 맞춘다: 사유 사전(`reason-dictionary.ts` 한국어 문구), eval_funnel 게이트 타입/목록이 있으면 그곳, T-126 배선 시험의 게이트↔기록 호출 1:1 목록, 키 일치 시험. 어디에 나열돼 있는지 **grep 으로 전부 찾아 Developer 절에 표로 남긴다.**
3. 시험: (a) `loadPositionState` 가 throw(Error·문자열·undefined)해도 같은 틱의 나머지 종목이 평가되고 청산 시그널이 만들어진다 (b) 실패 종목은 `exit_state_load_failed` 가 `rec` 에 1회, `exit_judgment` 수집기에 `decision='error'`·`decision_code='exit_state_load_failed'` 1행 (c) 실패하지 않는 모든 기존 장면은 **변경 전과 바이트 단위로 같다**(반환값·`rec.*` 호출 순서·내용·`createSignal` 인자·쿨다운·`position_state` 쓰기·경보 — T-126 동치 하네스 방식) (d) 실패 시 쿨다운·`position_state` 쓰기·경보가 새로 생기지 않는다.

## 불변 조건 (바꾸지 않는다)

- 정상 경로(조회 성공)의 동작은 한 바이트도 달라지지 않는다. 호출 순서·`await` 개수·분기 순서 불변.
- 조회 실패 종목은 **평가하지 않는다**(진입가를 KIS 평단으로 대체하는 등 새 청산 경로를 만들지 않는다) — 보수적으로 건너뛰고 기록만 한다.
- `safety/`·`orders/`·`exchanges/` 는 건드리지 않는다. `src/lib/exchanges/*` 는 **다른 세션(T-133)이 작업 중**이므로 절대 건드리지 않는다.
- 기록 스위치·DDL·`system_config` 는 건드리지 않는다. 운영 DB 쓰기·pm2·push·배포 금지.

## 하지 않는 것 (범위 밖 — 발견하면 `## Developer` 의 「범위 밖 발견」에만 적는다)

- `reconcilePositionState`·`upsertPositionState` 등 다른 호출의 보호 점검, `loadPositionState` 자체의 재시도/타임아웃 추가, 풀 설정 변경.
- 루프 밖 호출(잔고 조회 등)의 격리, `engine.ts` 의 다른 구조 변경, 화면 문구 변경(사유 사전 한국어 문구 한 줄 추가만 허용).

## 판단 기록 (judge)

- [2026-10-31 15:19] intake engine=jev → task_type=local_fix · risk=R2 · developer_model=opus · next=demo_first · demo=delta/designer · actions=prepare_demo,request_demo_approval,assign_developer | overrides=MD-r2-opus,DM-kw-risky-cta | fallback=- | tokens=1341
- [2026-10-31 15:23] intake engine=jev → task_type=local_fix · risk=R1 · developer_model=sonnet · next=assign · demo=none/- · actions=assign_developer | overrides=- | fallback=- | tokens=1342
- [2026-10-31 15:30] **Leader 채택·override 기록.** ① 재접수 이유: 첫 요약의 부정문(「화면 없음」·「주문 로직 변경 없음」)이 `rules.mjs` 의 `DM-kw-risky-cta`(`UI_CONTEXT` 91행 + `RISKY_OBJECT` 96행 + `RISKY_CHANGE` 97행, 119행)에 걸린 오탐 — 규칙은 부정 표현을 구분하지 않는다 [확실: 정규식 직접 확인, `ui_change`=none 0.94]. 같은 사실을 부정문 없이 쓴 요약으로 재실행했다. ② **데모: none 채택**(`check.mjs init` → `not_required`) — 이 task 의 사용자 가시 변화는 사유 사전 한국어 문구 한 줄뿐이고 레이아웃·흐름 변경 없음. ③ **`override: risk R2 · developer opus 유지`** — 재접수의 R1/sonnet 은 요약 표현이 바뀌어 `MD-r2-opus` 가 빠진 결과이고(judge 보고: 판정이 입력 표현에 따라 달라짐), 이 task 는 청산 평가 루프(손절·익절, 자금 직결, 커밋 훅 `SAFETY_PATHS` 의 `src/lib/strategy/`)를 고친다. 리더 규칙 「R2 보강」에 따라 judge 결과와 무관하게 R2. 이 task 의 Developer 는 Opus 다.

## 배포 기록

- [2026-10-31 19:27] **배포 완료.** 사용자 승인: 배포 시점 질문(「T-134·T-135 배포 시점을 정해 주세요」)에 대한 답 **「오늘 검증 통과 시」** — 합친 상태 검증이 통과하면 20:00 창 안에서 배포. 사전 검증(19:11~19:12, 별도 worktree `stockinvest-integ2` = 당시 `main` d454414 위에 두 커밋을 얹음): `tsc` 오류 0 · jest 149 스위트 4442 통과·실패 0(제 시험 + T-133 시세 시험 + 격리 시험 포함) · `next build` 컴파일·타입 검사 통과(`.next` 323MB). 배포 직전 가드 7개 통과(시각 19:27 · `origin/main`=`90f858f` · push 가 실을 코드는 이 두 건뿐 · 메인 체크아웃 작업 트리 깨끗 · **`main` 트리 해시 = 검증한 트리 해시 `dd1cb3bd…`** · 안전 키 불변 · health green).
- push `90f858f..8ed1ba7`(19:27:34): 코드 커밋 `c1e8aea`(T-134)·`8ed1ba7`(T-135) — 별도 브랜치의 `bf9980a`·`0957125` 를 cherry-pick 한 것 — 과 문서 커밋 2개. webhook blue/green 19:27:54 시작 → 19:30:17 종료 `exit=0`, `RELEASE_RESULT {"status":"ok","release":"20261031-192807-8ed1ba7b",…,"migrated":false}`. 이전 릴리스 `20261031-185943-90f858f5`(롤백 대상). 마이그레이션·DDL·스위치 변경 없음. **같은 배포에 실린 다른 작업**: T-134 ↔ T-135 서로, 문서 커밋(T-133 배포 기록 `8f2d71a`·이 task 들의 마감 `d454414`).
- 배포 후 읽기 확인(19:30~19:32): `current` → 새 릴리스 · 새 릴리스에 `bounded-conn.ts` 존재, `engine.ts` 의 `exit_state_load_failed` 2곳, `cron-runner.sh` 의 `call-tmp` 2곳 · pm2 `stockinvest`·`stockinvest-cron` 둘 다 online·restarts 0·exec cwd 새 릴리스 · 러너 프로세스 1개(pid 1720751, 19:28:37 시작, cwd 새 릴리스) · `call-tmp` 디렉터리 `drwx------`(0700)·잔존 파일 0 · `/tmp/cron-runner-*` 잔존 0 · 스풀 파일 없음(재전송 완료) · `job_run_log` 222행·마지막 기록 19:31:45 로 틱마다 증가 · 배포 후 non-ok 1건(`portfolio-snapshot` skipped `markets_closed` — 토요일 휴장) · `SHOW PROCESSLIST` 에 기록 표 INSERT 체류 없음 · 안전 키 5개 값·시각 불변, `exit_judgment_record_enabled` true 유지, `exit_judgment` 행 0(토요일) · health green(`safety.dryRun true`·`killSwitch false`).
- 컷오버 순간 관찰(이상 아님): 19:28:37 `job-run-log 전송 실패 HTTP=000`(웹 재기동 중 연결 거부), 19:28:42 `HTTP=503 reason=timeout`(웹 프로세스 콜드 스타트) — 스풀에 남겨 다음 틱에 재전송돼 비워졌다. **`reason=` 형식을 운영에서 처음 관찰**([[T-127-job-run-spool-hardening]] 의 「운영 미관찰」 항목 중 하나 해소). 오늘 같은 `503 reason=timeout (deadline=2500ms)` 서버 로그는 15:44:48·19:08:27·19:27:41(배포 시작 직전, 옛 코드)에도 있었고 이전 관찰의 기저선(하루 약 16건)과 같아 **이번 변경 때문이라는 증거는 없다** [가능성 높음].
- **운영에서 못 본 것**: `exit_state_load_failed` 가 실제로 발생하는 경우(조회 실패가 나야 한다 — 시험으로만 확인) · 홈 「데이터 이상」 건수·분석 퍼널의 새 문구 렌더. 다음 개장(11-02 월) 장중에 홈에서 「데이터 이상」 이 0 이 아니면 그 게이트를 눌러 본다.

## 진행 기록

- [2026-10-31 15:2x] 등록(Leader). 사용자 「권고대로 착수」. 같은 묶음의 [[T-135-recorder-pool-hold-and-runner-tmp]] 와 **파일이 겹치지 않아 병행**(T-134 = `engine.ts`·사유 사전·시험 / T-135 = `records/`·`cron-runner.sh`). `getTicker` 쪽(T-131 후보 ① = T-132 보고 결정 ①)은 다른 세션이 [[T-133-ticker-business-failure-retry]] 로 이미 진행 중이라 이 task 에 넣지 않는다.

## Developer

- [15:20] 착수(Opus). 작업 위치 서버 worktree `~/.node-local/stockinvest-t134`(분리 HEAD `c593300`). 커밋·push·배포·운영 DB·pm2·`system_config` 손대지 않음. `src/lib/exchanges/*`·T-135 파일(`judgment-recorder.ts`·`job-run-log.ts`·`cron-runner.sh`)·`exit-judgment.ts`·`record-switch.ts` 무변경.
- [15:28] **결함 재현(변경 전 엔진, 새 시험 파일만 추가한 상태)** — 3종목 중 2번째 상태 조회가 거부되는 장면: `runAll` 이 그 오류(`pool queue timeout`)로 던졌고, 3번째 종목은 시세 조회·상태 조회·시그널·쿨다운이 **하나도 없었다**(1번째만 시그널 1건). 같은 틱의 eval_funnel run 행 0건(틱 끝 flush 미도달)·청산 판단 기록 INSERT 0건. 그때 새 시험 파일 16건 전부 실패 [확실: 시험 출력 `~/.node-local/t134-logs/repro-before*.log`].
- [15:32] **상위 호출자의 예외 처리(코드로 확인, 실행은 안 함)** — `runExitEngine` 예외 → `runMarket`(engine.ts:1277 `await runExitEngine`, catch 없음) → 아래 `rec.flush()`(eval_funnel)·신규 진입 평가·미리보기 요약·마스터 OFF 경보 전부 건너뜀(루프 뒤 `flushExitJudgment` 도 못 감) → `runAll`(시장 지정·현재 시장 경로는 그대로 전파, `force` 일 때만 시장별 `.catch`) → `src/app/api/cron/strategy-eval/route.ts` try/catch → `console.error` + **HTTP 500** `{ok:false,error}` → 크론 러너 `call /api/cron/strategy-eval` 가 500 을 실행 기록 스풀에 남김 → `classifyRun`(records/job-run-log.ts:316~320, http≠200) → `job_run_log` **status=failed, error_code=`HTTP=500:<첫 단어>`**. 주문 동기화(`syncPendingOrders`)는 runAll 앞에서 분리 실행이라 영향 없음 [확실: 코드 읽기 / 미실행].
- [15:34] **구현** — `engine.ts` 루프의 `const state = await loadPositionState(...)` 를 이웃(`exit_state_upsert_failed`)과 같은 모양으로 감쌌다: `let state: PositionState | null; try { state = await loadPositionState(symbol, market); } catch (e) { console.warn(\`[exit-engine] state 조회 실패 ${symbol}: …\`); rec.error('exit_state_load_failed', { symbol, side: 'sell', detail: { error: String(e).slice(0, 300) } }); noteExitJudgment(exitJudg, 'error', 'exit_state_load_failed', { symbol, entry, ticker }); continue; }`. 실패 종목은 평가하지 않는다(새 청산 경로 없음 — 진입가 대체 평가는 변이 M8 로 막힘을 확인).
- [15:34] 변경 파일 (worktree, 커밋 안 함 — `git diff --numstat` 기준)

| 파일 | 역할 | 줄(+/−) |
|---|---|---|
| `src/lib/strategy/engine.ts` | 상태 조회 종목 단위 격리(위) + `type PositionState` 타입 전용 import | +14/−2 |
| `src/lib/strategy/eval-funnel-labels.ts` | `FUNNEL_GATES` 끝에 `exit_state_load_failed` append · `GATE_STAGE` 23 · `GATE_LABEL_KO` 「청산: 포지션 조회 실패」 | +7 |
| `src/lib/ops/metrics/exit-lines.ts` | `DATA_ERROR_GATES` 에 추가(홈 청산 판정 줄 「데이터 이상」 집계) | +2 |
| `src/lib/strategy/__tests__/engine-exit-state-load-isolation.test.ts` | **신규** 18건 — 정적 형태 2·결함 재현 1·던지는 값 7종·판단 기록 행 1·나머지 종목 동일 4·전부 실패 1·해외 1·마스터 OFF 1 | 411(신규) |
| `src/lib/strategy/records/__tests__/exit-judgment-engine-wiring.test.ts` | T-126 배선 시험 — 정적 rec 게이트 11→12·D1 표·`exitJudg` 15→16·장면 합집합·장면 2개(`state_load_failed`·`multi_state_load`) | +21/−6 |
| `src/lib/strategy/__tests__/engine-insufficient-cash.test.ts` | `FUNNEL_GATES` 꼬리 단언에 새 게이트 포함 | +2/−2 |
| `src/lib/strategy/__tests__/engine-validation-gate.test.ts` | 꼬리 단언 `slice(-2)` → `slice(-3)`(T-072 두 게이트 순서 그대로 + 새 게이트) | +2/−1 |
| `src/lib/ops/metrics/__tests__/exit-and-sources.test.ts` | `groupExitGates` 가 새 게이트를 데이터 이상으로 세는지 1건 | +10 |

- [15:36] 게이트 ID 나열 위치 (grep `exit_state_upsert_failed`·`exit_state_missing`·`exit_ticker_error`·`exit_create_failed`·`FUNNEL_GATES`·`GATE_LABEL_KO` 로 전수 조사)

| 위치 | 무엇 | 조치 |
|---|---|---|
| `eval-funnel-labels.ts` `FUNNEL_GATES` | 게이트 ID 목록 = `FunnelGate` 타입 원천(`rec.error` 인자 타입 — 빠지면 tsc 실패, 변이 M4 로 확인) | 목록 **끝** append(파일 머리 규칙) |
| 같은 파일 `GATE_STAGE` | 단계 | 23(`exit_state_upsert_failed`·`exit_state_missing` 과 같은 단계) |
| 같은 파일 `GATE_LABEL_KO` | 한국어 라벨 — `gateLabelKo` → 정기 리포트·깔때기 「⚠ 이상」 | 「청산: 포지션 조회 실패」 1줄 |
| `ops/metrics/exit-lines.ts` `DATA_ERROR_GATES` | 홈 청산 판정 「데이터 이상」 종목 수 | 추가 — 빠지면 그 종목은 「판정함」에만 들어가고 어느 묶음에도 안 잡힌다(지표 계약 §11.3 「stage 21~24 error = 데이터 이상」) |
| T-126 배선 시험 | 정적 1:1 목록·D1 표·`exitJudg` 개수·장면 합집합 | 갱신 + 장면 2 |
| `engine-insufficient-cash.test.ts:64` · `engine-validation-gate.test.ts:89` | 목록 꼬리(append 순서) 단언 | 새 꼬리로 갱신 — T-072(`fa0669c`)가 T-058 꼬리 단언을 같은 방식으로 고친 선례 |
| 해당 없음(확인만) | `ops/reason-dictionary.ts`(사전 = 주문·분석·안전 상태·지표 조회 실패 코드뿐, eval_funnel 게이트 키 없음) · `ops/__tests__/reason-dictionary-keys.test.ts`(수집기가 그 4종만 모은다 — `KNOWN_UNMAPPED` 변경 불필요, 통과 확인) · `signals/exit-reason-display.ts`(시그널 사유 앞머리 별칭 — 무관) · `records/exit-judgment.ts`(`decision_code` 는 정규식 `^[a-z0-9_]{1,48}$` 만, 목록 없음) · DB `eval_funnel.gate`·`exit_judgment.decision_code` 둘 다 VARCHAR(48)(ENUM 아님 → DDL 불필요, 새 ID 22자) | 무변경 |

- [15:37] 설계 결정과 이유 — ① `const` 를 `let` + try/catch 로: catch 안에서 `continue` 해야 하므로 `.catch()` 연결(마이크로태스크 추가·continue 불가)은 쓰지 않았다. 바뀐 영역의 `await` 는 1→1, 호출 순서·분기 순서 그대로(정적 시험이 블록 전문을 고정). ② 경고·detail·기록 입력을 바로 위 이웃과 같은 모양으로(`{ symbol, entry, ticker }` — 판단 기록 행이 `exit_state_upsert_failed` 행과 `decision_code` 만 다름을 시험으로 고정). 행의 `entry_price` 는 기록기 규칙대로 KIS 평단(관찰 전용 — 평가에 쓰지 않는다). ③ 브리프의 「사유 사전 한국어 문구」는 게이트 라벨의 실제 출처가 `reason-dictionary.ts` 가 아니라 `GATE_LABEL_KO` 라서 거기에 한 줄 넣었다. 문구는 이웃 「청산: 포지션 갱신 실패」·「청산: 포지션 없음」 형식을 따랐다(designer 검토는 받지 않음 — 바꾸려면 1줄, 변이 M15 시험이 고정). ④ 실패를 `RunAllResult.errors` 에 넣지 않았다 — 이웃도 넣지 않고, 넣으면 라우트 로그·실행 기록 분류가 바뀐다. ⑤ 실패 종목에 쿨다운·position_state 추가 쓰기·경보를 만들지 않는다(조회 앞의 기존 upsert 1회는 원래 동작). 마스터 OFF 틱의 「막힌 청산 N건」 경보 수에서도 빠진다(시험으로 고정).
- [15:45] **기존 동작이 같다는 증거(변경 전 트리 대조 하네스)** — T-126 Reviewer 하네스 `rev-t126-equiv2` 를 그대로 가져와 장면 9개를 더했다(실패 없는 이웃 5: 가운데 행 없음·가운데 upsert 실패·느린 조회·마스터 OFF 3종목·해외 3종목 / 조회 실패 4). 장면 56 × 기록 상태 7(off·on·hang·failins·swhang·throwy·openthrow). 변경 전 = `git archive c593300`, 변경 후 = worktree 사본(두 트리 차이는 위 8파일뿐 — `diff -rq` 확인). 비교 대상 = 반환값/던짐 + 전역 순서 이벤트 로그(엔진 SQL·시세·upsert·reconcile·조회·createSignal·sendAlert·sendAlertThrottled·쿨다운 조회/설정·미리보기·console.log/warn/error·eval_funnel 기록) + 판단 기록 I/O 문장·값. **실패 없는 51장면 × 7 = 357건 비교, 차이 0**. 실패 5장면 × 7 = 35건은 예상대로 다름(변경 전 던짐 / 변경 후 정상 반환, 실패 종목에만 `exit_state_load_failed`). 하네스 민감도 점검: 변경 후 사본의 `exit_state_missing` 분기 detail 한 칸만 바꾸자 정확히 그 분기를 타는 2장면(`state_null`·`state_null_mid`)에서만 차이가 났다. 한계: 이 하네스는 마이크로태스크 수를 보지 못한다 — `await` 수 불변은 diff 와 정적 시험으로 확인. 스크립트 `~/.node-local/t134-equiv-src/`(t134-equiv.test.ts·setup.sh·run.sh·cmp.js·mutate.py), 결과 `~/.node-local/t134-equiv/out/`, Mac 사본 스크래치패드 `t134-equiv/` [확실].
- [15:50] **변이 시험 18개 — 전부 적발**(worktree 를 임시 사본에 복사해 사본에서만 변이, 사본 삭제함. 기준선 317건 통과): M1 try/catch 삭제(변경 전 코드) · M2 `continue` 삭제 · M3 `noteExitJudgment` 삭제 · M4 `rec.error` 코드 오타(시험 + tsc TS2345 둘 다) · M5 기록 코드 오타 · M6 결론 error→no_fire · M7 rec.error→rec.skip · M8 실패 시 KIS 평단으로 대체 평가(새 청산 경로) · M9 300자 자름 삭제 · M10 경고 로그에 가격 추가 · M11 실패 시 쿨다운 설정 · M12 기록 순서 뒤집기 · M13 기록 입력에서 ticker 뺌 · M14 stage 23→22 · M15 라벨 문구 변경 · M16 `DATA_ERROR_GATES` 에서 뺌 · M17 게이트를 목록 중간에 끼움 · M18 catch 를 기록 없는 `continue` 로. 결과 `~/.node-local/t134-logs/mutate.log` [확실].
- [15:52] **시험 실행 결과 (Node 24.22.2, 무거운 명령은 전부 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10`)** — ① 직접 관련 5스위트: 317 통과·1 건너뜀(T-126 덤프용 describe.skip)·실패 0. ② 범위 시험 `src/lib/strategy` + `src/lib/ops` + `src/lib/signals` + 엔진 소스를 읽는 울타리 6개(`src/__tests__/t129-alert-terms-fence`·`corp-intel`/`profit-engine`/`risk` 격리 시험·`usd-cash-balance-fence`·`api/cron/__tests__/strategy-eval-lane`): 98스위트(95 통과·3 건너뜀 = 일회용 MariaDB 스위트 `ops-disposable-mariadb`·`t072-disposable-mariadb`·`judgment-disposable-mariadb`), 시험 3219 통과·92 건너뜀·**실패 0**, 약 14초. ③ 바뀐 모듈을 import 하는 범위 밖 시험(trade-report 라우트 2·ops-routes·home-render-t108·t108-analytics/trade-render·t108/t130 용어 울타리): 8스위트 326 통과·실패 0. ④ `tsc --noEmit` exit 0. 로그 `~/.node-local/t134-logs/` [확실].
- [15:53] 파일·줄 감시 시험 — T-119 격리 시험(`corp-intel/__tests__/isolation.test.ts` 의 `HP_LABEL_FILES`)·profit-engine·risk 격리·USD 현금 울타리·T-129 용어 울타리 모두 **허용 목록 변경 없이 통과**(새 import 는 이미 import 하던 `position-state` 의 타입뿐, 새 문자열 리터럴에 옛 용어 없음). 커밋 훅: `SAFETY_PATHS` `^src/lib/strategy/` 가 engine.ts·eval-funnel-labels.ts·strategy 시험 4개(신규 포함)·배선 시험을 덮는다 → Reviewer 판정 `scope` 에 이 경로들이 들어가야 커밋된다. `src/lib/ops/metrics/exit-lines.ts`·그 시험은 감시 밖. Mac 에서는 훅이 돌지 않으므로 커밋은 서버에서.
- [15:54] **범위 밖 발견(고치지 않음)** — ① `runMarket` 에서 청산 엔진 **뒤**의 `SELECT … FROM strategies WHERE enabled = 1`(engine.ts:1347~1351)·`refreshUniverse`(1353) 호출부에 try 가 없다 — 여기서 던지면 청산 시그널·판단 기록은 이미 끝났지만 그 틱의 eval_funnel 행 전체(청산 트랙 행 포함)가 flush 되지 않고 라우트가 500 이 된다(보호 약화가 아니라 관측 손실) [가능성 높음: 호출부 코드 읽기, `refreshUniverse` 내부 처리는 미확인, 재현 안 함]. ② 같은 청산 루프의 다른 await(`getTicker`·`upsertPositionState`·`createSignalGuarded`·`setCooldown`)는 호출부 또는 함수 안에서 이미 막혀 있다 — 루프 안 무방비 호출은 이번 것이 마지막이었다 [확실: 코드 읽기]. ③ 문서 `docs/design/2026-10-30-t108-metrics-contract-draft.md:263` 의 청산 게이트 나열에 새 게이트가 없다 — 문서 갱신은 Leader 판단. ④ 배선 시험 머리 주석의 「19장면」은 원래부터 실제(20)와 달랐다 — 「19장면 + T-134 2장면」으로만 고쳤다.
- [15:55] **확인하지 못한 것** — 실제 mysql2 오류 객체·풀 대기 초과로의 재현(목만 사용, 일회용 MariaDB 미사용 — SQL 변경 없음), 라우트→크론→`job_run_log` 경로의 실행(코드 읽기만), 저장소 전체 jest(범위·인접만), 운영에서 조회 실패가 얼마나 자주 나는지(운영 DB 미조회), 라벨 문구의 designer 검토. 상태: 구현·자체 검증 완료, Reviewer 인계 대기(커밋 안 함).
- [15:57] 운영 상태와의 관계 — 15:41 에 `exit_judgment` DDL 이 적용되고 기록 스위치가 켜졌다(진행 기록·20-Log). 그 표의 CHECK 는 `chk_xj_code CHAR_LENGTH(decision_code) > 0`·`chk_xj_pnl pnl_pct IS NULL OR ≥ −100` 둘뿐이고 코드 목록 제약이 없어(`scripts/migrations/T-126-exit-judgment.sql:57·64·65`) 새 코드 `exit_state_load_failed` 행이 틱 묶음 INSERT 를 깨지 않는다 [확실: DDL 파일 읽기 / 운영 표는 조회하지 않음]. 이 변경은 아직 배포 전이라 운영 동작은 그대로다.

## Reviewer

- [16:20] 착수(Reviewer, 독립 감사). 대상 = 서버 worktree `~/.node-local/stockinvest-t134` 미커밋 변경(기준 c593300) 8파일. Developer 절은 주장으로만 읽고 코드·시험을 직접 읽고 직접 실행했다. 감사가 끝난 시점에 worktree 8파일이 감사한 사본과 바이트 동일함을 `cmp` 로 확인했다. 코드 수정·커밋·push·운영 DB·pm2·`system_config` 조작 없음(감사용 사본·하네스는 `~/.node-local/rev-t134-*` 아래에만 만들었다).
- [16:30] 코드 읽기 — `engine.ts` 변경은 `const state = await loadPositionState(…)` 를 `let state: PositionState | null; try { state = await loadPositionState(…) } catch (e) { warn; rec.error('exit_state_load_failed', …); noteExitJudgment(exitJudg, 'error', 'exit_state_load_failed', { symbol, entry, ticker }); continue; }` 로 바꾼 것 하나(+타입 전용 import). try 안에는 조회 await 하나뿐이라 조회 밖 코드의 예외를 삼키지 않는다. 수집기에 넘기는 ctx 는 그 지점에 이미 있는 `symbol`·`entry`·`ticker` 뿐이고 바로 위 이웃(`exit_state_upsert_failed`)과 글자까지 같은 모양이다. catch 안에 새 쓰기·쿨다운·경보·재평가가 없다. `continue` 는 `if (!state)` 앞이라 실패 종목은 미리보기 observe·`evaluateExit`·마스터 OFF 「막힌 청산」 카운트에 들어가지 않는다. 진입가를 KIS 평단으로 대체하는 새 청산 경로 없음.
- [16:50] **정상 경로 불변(직접 만든 하네스, Developer 하네스 미사용)** — 스크래치패드 `rev-t134/rev-equiv.test.ts`: 변경 전(`git archive c593300`)과 변경 후 두 트리에 같은 파일을 두고 장면 21 × 기록 모드 2(off·on)를 돌려 전역 순서 이벤트 로그(엔진 SQL·시세·upsert·reconcile·조회·`createSignal` 인자·쿨다운 조회/설정·경보·console·eval_funnel 기록 순서/내용·exit_judgment INSERT 값)에 **마이크로태스크 틱 번호**를 붙여 비교했다(`await` 개수가 하나라도 달라지면 이후 모든 이벤트의 번호가 어긋난다). 실패 없는 장면 13 × 2 = 26건 중 24건은 틱 번호까지 바이트 동일. 나머지 2건은 같은 장면 하나(조회가 5ms 타이머로 늦게 오는 장면)가 두 모드에서 다른 것인데, 원인은 하네스 틱 카운터가 타이머 대기 동안 도는 횟수(1024 배수 36864 대 38912)뿐이었다 — 타이머 앞 틱 접두·틱 번호를 뺀 전체 로그·반환값·기록 결과는 동일(결함 아님, 하네스 한계). 실패 장면 8 × 2: 변경 전은 던짐(첫 종목 실패는 시그널 0건·가운데 실패는 1건에서 끊김), 변경 후는 정상 반환 — 실패 종목에만 `exit_state_load_failed` 1행, 나머지 종목 시그널 생성, 쿨다운·경보·추가 쓰기 없음, 기록 on 이면 exit_judgment INSERT 문장 1개. [확실]
- [16:52] **변이 시험(직접, 새 변이 10개)** — 감사 사본에서만 바꿔 직접 관련 5스위트(기준선 317 통과·1 건너뜀)로 확인, 전부 적발: R1 catch `continue`→`break` · R2 `continue`→`state = null`(exit_state_missing 으로 떨어져 2행) · R3 catch 에 경보 추가 · R4 상태 조회를 upsert 앞으로 옮김(호출 순서) · R5 catch 에서 position_state 추가 쓰기 · R6 비 Error 값은 다시 던짐 · R7 `GATE_STAGE` 23→29 · R8 exit-lines 에서 생성 실패로 분류 · R9 기록 입력에서 `entry`·`ticker` 제거 · R10 `rec.error` 의 detail 누락. Developer 의 18개와 겹치지 않는 부류(break·fallthrough·경보·재upsert·순서·비 Error 재던짐)다. 변경 전 엔진 + 새 시험 2개: 42건 실패(`oldeng.log`) — 결함 재현 시험이 변경 전 트리에서 실제로 실패한다. 시험은 거부 Promise·동기 throw·Error·문자열·undefined·300자 초과를 다 넣는다(실제 mysql2 오류 객체/풀 대기 초과 자체는 목이라 못 본다).
- [16:57] **재실행(Node 24.22.2, 락 안)** — `tsc --noEmit` exit 0. 범위 jest: `src/lib/strategy`·`src/lib/ops`·`src/lib/signals` + 엔진/라벨을 읽는 울타리·격리 시험(corp-intel·profit-engine·risk 격리, usd-cash-balance-fence, t129·t130 용어 울타리, strategy-eval-lane, backtest-runner) + 바뀐 모듈을 import 하는 화면/라우트 시험(t108 analytics/trade render, home-render-t108, ops-routes, trade-report): 106스위트(103 통과·3 건너뜀 = 일회용 MariaDB), 시험 3730(3638 통과·92 건너뜀), 실패 0, 허용 목록 변경 없이 통과.
- [16:58] **상위 호출자 주장 확인** — 코드로 따라가 맞다: `runMarket` 의 `await runExitEngine(…)`(engine.ts:1277)는 try 밖(첫 try 는 1425)이고 `runAll` 은 시장 지정 경로에서 그대로 전파, `force` 일 때만 시장별 `.catch`. `strategy-eval/route.ts` 가 catch → `console.error` + HTTP 500 `{ok:false}`. `classifyRun`(job-run-log.ts) 은 http≠200 이면 failed(`HTTP=500:…`). 크론 러너가 실제로 500 을 스풀에 쓰는 부분(`cron-runner.sh`)은 읽지 않았고 실행도 안 했다.
- [16:59] **범위 판단 (a) `FUNNEL_GATES` 단계 23 / 라벨 위치 — 옳다.** 사전(`reason-dictionary.ts`)에는 eval_funnel 게이트 키가 하나도 없고(청산 관련은 `exit_switch_db_error` 뿐) 게이트 한국어 라벨의 실제 출처가 `GATE_LABEL_KO` 라 거기가 맞는 자리다. 단계 23 은 `exit_state_upsert_failed`·`exit_state_missing` 과 같고 지표 계약 §11.3 「stage 21~24 error = 데이터 이상」과 맞는다. production 전체 grep: `FUNNEL_GATES` 는 타입 원천으로만 쓰이고 순서/마지막 원소를 보는 곳이 없다(보는 곳은 시험 두 곳뿐). `GATE_STAGE` 는 `eval-funnel.ts:136`(행의 기본 stage)과 `exit-lines.ts` 의 `stage BETWEEN 21 AND 29` 질의뿐이고, `kill/advance` 결과 추적기는 진입 경로 전용이라 청산 게이트가 영향을 주지 않는다. 라벨 문구는 이웃 형식이고 t129 용어 울타리 통과. 결론: 영향 없음, 유지.
- [17:00] **범위 판단 (b) `DATA_ERROR_GATES` 추가 — 범위 안이고 필요하다, 유지(제거 권고 안 함).** 빠지면 실패 종목은 `judged` 에만 들어가고 어느 묶음에도 안 잡혀, 그 종목만 있는 틱의 홈 줄이 `quiet`(=「확인된 0」, `metric('zero')`)으로 계산된다 — 평가가 건너뛰어졌는데 0 으로 보이는 거짓 정상이다(R8·Developer M16 변이로 시험이 고정). 계약 §11.3 표의 `exit_state_*`(error) → 데이터 이상 행과 그대로 맞는다. `dataErrors` 소비자는 `ExitLogicSection`·`VerifyPanel` 의 건수 표기와 `coverage.dataErrors` 뿐이고, `sourcesChecked` 는 `anomalies.ts`(데이터 원천 신선도)에서만 만들어져 `DATA_ERROR_GATES` 를 읽지 않으므로 의미가 바뀌지 않는다. 이중 집계 없음(같은 종목은 Set 한 곳). `exit-lines.ts` 와 그 시험은 커밋 훅 감시 밖이다.
- [17:01] **범위 판단 (c) 기존 시험 2개의 「마지막 게이트」 단언 수정 — 단언 약화가 아니라 정당한 갱신.** `fa0669c`(T-072)가 T-058 의 「목록 마지막 원소」 단언을 `slice(indexOf('insufficient_cash'))` 정확 일치로 바꾼 선례와 같은 종류다. 이번 변경도 꼬리 원소 목록을 정확 일치(`toEqual`)로 유지하고(`insufficient-cash`: 3개→4개 꼬리, `validation-gate`: `slice(-2)`→`slice(-3)`) 기존 게이트의 상대 순서 단언은 그대로라 같은 강도다. 다만 이런 꼬리 단언은 게이트를 추가할 때마다 고쳐야 하는 취약한 형태다(기존 설계, 이번 범위 밖).
- [17:02] **게이트 어휘 동기** — `exit_state_missing`·`exit_state_upsert_failed`·`exit_ticker_error`·`exit_price_invalid`·`exit_avg_price_missing`·`exit_unit_mismatch`·`exit_create_failed`·`exit_no_fire` 를 저장소 전체(node_modules·.git 제외)에서 grep 해 이웃이 나오는 파일을 새 게이트와 대조했다: `eval-funnel-labels.ts`(목록·단계·라벨 3곳) · `engine.ts` · `exit-lines.ts`(`DATA_ERROR_GATES`) · T-126 배선 시험(정적 목록·D1 표·`exitJudg` 개수 16·장면 합집합) 모두 반영. 빠진 곳 없음 — 사전·`KNOWN_UNMAPPED`·`exit-reason-display.ts`·`exit-judgment.ts`(정규식만)·`ExitLogicSection`/`types.ts`(주석)은 새 ID 를 나열하지 않는다. 컬럼: `eval_funnel.gate` VARCHAR(48)(db.ts:1367), `exit_judgment.decision_code` VARCHAR(48) + CHECK 는 길이>0 과 pnl 하한뿐(DDL 파일 직접 확인), `verdict`/`decision` 의 `'error'` 는 ENUM 에 있다. 새 ID 22자. DDL 불필요. 코드 쪽 정규식 `^[a-z0-9_]{1,48}$` 통과.
- [17:03] 발견 — F-1 (Low, `engine.ts` catch 안 `String(e)`) 던진 값이 null-프로토타입 객체이거나 `toString` 이 던지면 catch 안에서 TypeError 가 나 루프 밖으로 새어 나간다(하네스 장면 `load_throw_weird_object` 로 재현: 변경 전도 던지므로 퇴보는 아님, 바로 위 이웃 catch 들도 같은 모양). mysql2·풀은 Error 객체만 던져 현실성이 낮다. 권고: 조치 불필요(원하면 후속에서 세 catch 를 한 번에 안전 문자열 변환기로).
- [17:03] 발견 — F-2 (Low, 문서) `docs/design/2026-10-30-t108-metrics-contract-draft.md:263` 의 청산 게이트 나열에 `exit_state_load_failed` 가 없다(Developer 가 Leader 판단으로 넘긴 것과 같음). 같은 문서 §11.3 표는 `exit_state_*` 와일드카드라 동작 정합은 이미 맞다. 권고: Leader 가 문서 한 줄 추가 여부 결정.
- [17:04] 발견 — F-3 (Info, 관측 방식 변화) 이 실패는 이전에는 크론 500 → `job_run_log` failed 로 눈에 띄었으나 이제 HTTP 200 으로 끝난다. 흔적은 eval_funnel stage 23 error 행(깔때기 이상 목록·`funnel.ts` 「이상 n」), 홈 「데이터 이상」 건수, exit_judgment `error` 행, `console.warn` 이다. 이웃 실패(시세·upsert)와 같은 방식이고 task 시험 (d)가 「경보 새로 안 생김」을 요구한 설계대로다. 반복 실패 전용 경보는 없다. 실제로 이 조회만 단독 실패하는 구간은 좁다(바로 앞 upsert 가 이미 격리돼 DB 전체 장애면 upsert 에서 먼저 걸림).
- [17:05] 발견 목록 요약 — Critical 0 · High 0 · Medium 0 · Low 2(F-1·F-2) · Info 1(F-3). 안전장치 우회 경로 없음(`submitOrder` 경로·`safety/`·`orders/`·`exchanges/` 무변경, 실패 종목에 시그널·쿨다운·경보·추가 쓰기 새로 생기지 않음). 커밋 훅 감시 경로(`src/lib/strategy/`)는 아래 판정 줄 scope 로 덮는다.
- [17:05] **확인하지 못한 것** — 실제 mysql2 오류 객체·풀 대기 초과 재현(목만 사용, 일회용 MariaDB 미사용 — SQL 무변경), `next build` 번들에서의 await 동작(swc 시험 환경과 Next 번들 target 은 다르지만 try/catch 는 틱 수를 바꾸지 않는다고 추론, 미실행), 크론 러너→`job_run_log` 실행 경로, 저장소 전체 jest(범위·인접만), 운영 DB 조회, Mac 에서의 커밋 훅 작동(Mac 에서는 훅이 안 돈다 — 커밋은 서버에서), 데모 게이트 `check.mjs`(이 task 는 `not_required` 이고 화면 변경이 없어 해당 없음, 실행 안 함), 라벨 문구의 designer 검토.
- [17:06] **최종 판정: PASS (scope: src/lib/strategy/engine.ts, src/lib/strategy/eval-funnel-labels.ts, src/lib/strategy/__tests__/engine-exit-state-load-isolation.test.ts, src/lib/strategy/records/__tests__/exit-judgment-engine-wiring.test.ts, src/lib/strategy/__tests__/engine-insufficient-cash.test.ts, src/lib/strategy/__tests__/engine-validation-gate.test.ts)**

## QA

- [17:21] 대상: 서버 worktree `~/.node-local/stockinvest-t134`, HEAD `bf9980a`(기준 `c593300`). QA 는 worktree 를 읽기만 했고 코드·커밋·push·운영 DB·pm2·`system_config` 를 건드리지 않았다. 변이·덤프 시험은 `~/.node-local/t134-qa/` 아래 임시 사본(`before`=c593300, `after`=bf9980a, `mut-*`)에서만 돌렸고, 무거운 명령은 전부 `/tmp/stockinvest-heavy-tests.lock` 아래 한 번에 하나씩 실행했다(Node 24.22.2).
- [17:21] 체크 1 변경 범위: `git diff c593300 bf9980a --stat` = 8파일 (+469/−11, 신규 시험 1 포함). `src/lib/safety/`·`src/app/api/orders/`·`src/lib/exchanges/`·`scripts/` diff 0줄. worktree `git status` 비어 있음.
- [17:21] 체크 2 타입: `./node_modules/.bin/tsc --noEmit` exit 0.
- [17:22] 체크 3 결함 재현: 변경 전 엔진(c593300 사본) + 새 시험 파일 → **18 실패 / 18** (첫 실패 사유 `pool queue timeout` 이 `runAll` 밖으로 던져짐, 판단 기록 INSERT 0건, errors null). 변경 후(bf9980a) → 18 통과.
- [17:23] 체크 4 범위 jest (`src/lib/strategy src/lib/ops src/lib/signals src/__tests__ src/app/api/cron`, bf9980a): 123 suite 통과 · 3 suite 건너뜀(일회용 MariaDB 3개) · 시험 3759 통과 · 92 건너뜀 · **0 실패** (7.7s). 시험 파일 단독: 신규 18건 + QA 추가 2건 전부 통과.
- [17:24] 체크 5 엣지케이스:
  - (a)(b) 첫·가운데·마지막·두 종목 실패 → 나머지 종목 시그널 생성, 실패 종목 eval_funnel 1행·판단 기록 1행 — 통과.
  - (c) 전 종목 실패 → 시그널 0, 종목마다 1행, run 행 1 — 통과.
  - (d) 같은 종목 연속 틱(QA 추가 `QA-d`: 틱1 실패 → 틱2 성공) → 틱2에서 3종목 전부 시그널·쿨다운, 틱1 경보 0 — 통과.
  - (e) 변경 전/후 덤프 대조(QA `QA-e`, 가운데 종목 실패 틱): 변경 전이 던지기 전까지 본 관찰(funnel 1·createSignal 1·setCooldown 1·upsert 2·getTicker 2·load 2)이 변경 후 로그의 접두와 **9개 키 전부 동일** — 첫 종목 시그널·쿨다운·경보가 변경 전과 같다.
  - 정상 경로 동일성(QA `QA-f`, 실패 없음, 국내 혼합 발화·미발화·발화 + 해외 혼합): 변경 전/후 관찰 로그 **11개 키 전부 동일**(국내·해외 각각). 바뀐 것은 실패 경로뿐이다.
  - (f) 해외 시장 실패 종목 격리 — 통과. (g) 던지는 값 Error 거부·문자열 거부·undefined 거부·동기 throw 3종·300자 초과 — 7종 전부 통과. (h) 마스터 OFF 틱 실패 → 막힌 청산 2, 경보 1회(2건) — 통과. (i) 판단 기록 행 `decision='error'`·`decision_code='exit_state_load_failed'`(길이 22 ≤ 48), 입력은 이웃 `exit_state_upsert_failed` 와 열 단위 동일 — 통과.
- [17:25] 체크 6 홈 집계: `groupExitGates` 에서 신규 게이트(error)는 `dataErrors`·`judged` 에 들어가고 정상 게이트(`exit_no_fire`) 집계는 그대로 — 기존 `exit-and-sources` 시험 통과. 변이 M3(목록에서 제거)를 이 시험이 잡는다. 홈 화면 렌더까지는 실행하지 않았다.
- [17:25] 체크 7 어휘: `exit_state_load_failed` 전수 grep — `eval-funnel-labels.ts`(FUNNEL_GATES 끝·GATE_STAGE 23·GATE_LABEL_KO), `exit-lines.ts`(DATA_ERROR_GATES), 배선 시험(정적 목록·D1 표·장면·합집합), 꼬리 단언 2곳, `exit-and-sources` 시험. 오타 변형(`exit_state_load_fail` 등) 0건(부정 전방탐색 grep). 사유 사전 `reason-dictionary.ts` 에는 추가되지 않았다(게이트 라벨 출처가 `GATE_LABEL_KO` 라는 Developer 판단, 확인함).
- [17:26] 체크 8 안전 불변: `engine.ts` diff 는 `type PositionState` import 1줄과 격리 블록 한 곳뿐. 안전 토큰(`submitOrder`·`createOrder`·`DRY_RUN`·`KILL_SWITCH`·`ORDER_MAX`·`createSignal`·`setCooldown`·`sendAlert`) 추가·삭제 0줄. `await` 44→44, `loadPositionState(` 1→1. 새 catch 블록에는 시그널·주문·쿨다운·경보 호출이 없다(경고·`rec.error`·판단 기록·`continue`뿐).
- [17:28] 체크 9 변이 (사본에서만, 직접 관련 5스위트 기준 — 기준선 bf9980a 통과): M1 catch 의 `continue` 삭제 → 13 실패 · M2 판단 기록 호출 삭제 → 25 실패 · M3 `DATA_ERROR_GATES` 에서 제거 → 1 실패(exit-and-sources) · M4 단계 23→22 → 8 실패 · M5 catch 를 `throw e`(예전 동작) → 40 실패. **5/5 적발.** worktree 는 원복 상태 그대로다.
- [17:28] 검증하지 못한 것(NOT_VERIFIED): 일회용 MariaDB 시험 3 suite(`ops-disposable`·`t072-disposable`·`judgment-disposable`) 미실행 — SQL 변경이 없어 영향은 없다고 보나 돌리지 않았다 · 실제 mysql2 오류 객체·풀 대기 초과 재현(전부 모의 throw) · 크론 러너 → `job_run_log` 경로(HTTP 200 전환 뒤 실패가 보이는 곳) 미실행 · `next build` 번들의 await 동작 · 운영 DB 조회(실제 조회 실패 빈도) · 홈 화면 렌더 end-to-end · 저장소 전체 jest(범위만) · 커밋 훅(Mac 에서는 훅이 돌지 않으므로 커밋은 서버에서 해야 한다).
- [17:28] 이월 항목(QA 결함 아님, Reviewer 기록 그대로): F-1 던진 값의 `String(e)` 실패 시 catch 밖 TypeError(Low, 현실성 낮음) · F-2 `docs/design/2026-10-30-t108-metrics-contract-draft.md:263` 게이트 나열에 신규 ID 없음(Leader 판단) · F-3 실패가 이제 HTTP 200 으로 끝나 `job_run_log` failed 로는 안 보인다 — 흔적은 eval_funnel stage 23 error·홈 「데이터 이상」·exit_judgment error·`console.warn` 뿐(관측 방식 변화, Leader 인지 필요). Developer 범위 밖 ①(엔진 뒤 `strategies` 조회·`refreshUniverse` 에 try 없음)은 이번 QA 에서 재현하지 않았다.
- [17:29] 결함: **0건** (Critical 0 · High 0 · Medium 0 · Low 0 신규).
- [17:29] QA 판정: PASS

## Codex 검토

- [2026-10-31 16:58] **호출하지 않았다.** 사용자 전역 `~/.codex/config.toml` 의 `model = "gpt-6.1-sol"` 이 ChatGPT 계정에서 지원되지 않아 호출하면 즉시 실패한다 — T-126·T-127·T-128 에서 세 번 실패를 기록했고(확인에 호출당 약 7분), 16:58 에 설정이 그대로임을 읽어 확인했다. judge 의 `codex_gate` C1·C2 도 돌리지 않았다(호출할 수 없는 상태에서 개입 판정만 받는 것은 비용만 든다). 이 task 의 독립 감사는 Reviewer(PASS)와 QA(PASS)가 맡았다. [[T-131-t126-t130-followup-candidates]] 19번 — 사용자가 모델 설정을 고치면 소급 검토할 수 있다.
- [2026-10-31 21:2x] **정정 — 위 Codex 실패 원인 진단(「모델이 계정에서 지원되지 않는다」)은 틀렸다.** 사용자가 「계정은 `gpt-6.1-sol` 사용 가능」이라고 알려 재점검했다. 계정 모델 목록 캐시(`~/.codex/models_cache.json`, 21:09 갱신)에 `gpt-6.1-sol` 이 `visibility=list`·`priority 1` 로 있고, 같은 사소한 프롬프트로 CLI 만 바꿔 대조했다: ① PATH 의 `codex` = npm 전역 **CLI 0.156.1** + `gpt-6.1-sol` → 400 `model_not_found`(「not supported when using Codex with a ChatGPT account」, 「모델 메타데이터를 찾지 못했다」 경고 동반) ② 같은 CLI + `gpt-5.6-sol` → OK ③ ChatGPT 앱 번들 CLI **0.166.0-alpha.5.1** + `gpt-6.1-sol` → OK. **원인은 계정·모델이 아니라 `codex` 가 가리키는 CLI 가 낡아 새 모델을 모르는 것**이다(npm 최신 0.166.0). 10-30 14:49·16:04 까지 성공한 실행은 CLI 0.157.1 + `gpt-5.6-sol` 이었고 21:58 에 CLI 0.156.1 + `gpt-6.1-sol` 로 바뀌며 실패했다. 해결 후보는 [[T-131-t126-t130-followup-candidates]] 19번.

- [2026-10-31 23:00] **소급 Codex 검토 결과 — done, 지적 0건** (사용자 지시 10-31 22:3x · judge `codex_gate` 는 `user_requested` 로 생략 · Codex CLI v0.166.0 · `gpt-6.1-sol` · reasoning high · mode adversarial-review · focus 「error_handling and behavior preservation of the exit loop」 · Codex 실행 142초 · 토큰 86,148 · `files_modified_in_snapshot` [] · parsed True · run `20261031T135157Z-T-134-C2`). 미니 저장소(변경 전 상태 커밋 + 변경 후 작업 트리, src·scripts·설정만) 대비 diff 검토.
- 지적 없음 (Codex 가 빈 findings 를 반환).
- Codex 가 검토하지 못했다고 밝힌 범위: ['node_modules 미설치로 Jest·TypeScript 검사를 실행하지 못함', '운영 DB 장애와 크론 HTTP 응답의 실환경 재현']
- Codex 요약: 확인한 범위에서 구체적인 결함을 찾지 못했습니다. 새 import와 조회 try/catch만 되돌리면 engine.ts는 기준 커밋과 바이트 단위로 같습니다. 정상 경로의 호출 순서·await 수·분기·반환 코드는 유지되며, state는 반복문 내부 선언이고 catch가 continue하므로 이전 종목 값이 누출되지 않습니다. catch는 프로그래밍 오류도 포착하지만 현재 조회 경로에는 취소 신호 전달이나 AbortError를 특별히 전파해야 하는 계약이 없습니다. 게이트 목록·단계 23·한국어 라벨·데이터 이상 집계·배선 시험이 연결돼 있고, 코드 길이는 22자로 제한 48 이내입니다. 기존 시험 두 개는 정확한 목록 비교를 유지하므로 단언 약화가 아닙니다. 실패 종목도 조회 전에 기존 upsert는 실행되지만 catch 이후 추가 쓰기·시그널·쿨다운은 없습니다. evaluateExit와 쿨다운 조회는 호출부에서 별도 격리하지 않지만, 현재 구현에서 구체적인 예외 시나리오는 확인하지 못했고 setCooldown은 내부에서 DB 예외를 처리합니다.
- **판정: 지적 0건 → 채택·오탐 판정 대상 없음.** Codex 요약의 부수 언급(「`evaluateExit` 와 쿨다운 조회는 호출부에서 격리하지 않지만 구체적 예외 시나리오는 확인하지 못했다」)을 Leader 가 코드로 확인했다 — 쿨다운 *확인*(`cooldowns.isActive`)은 틱 시작에 `loadActiveCooldowns()` 로 한 번 읽은 **메모리 집합** 조회라 루프 안에서 DB 를 읽지 않고(로드 실패는 `loadError` 로 fail-open), 쿨다운 *쓰기* `setCooldown` 은 내부 `try/catch` 로 DB 오류를 삼켜 `false` 를 반환한다(`src/lib/strategy/cooldowns.ts`). `evaluateExit` 는 순수 함수다. 즉 T-134 가 고친 것과 같은 계열(루프 안 DB 조회 1회가 예외로 번짐)의 남은 결함은 없다. Codex 가 검토하지 못한 것: Jest·TypeScript 실행(node_modules 없음) — 이는 QA 가 이미 실행했다(범위 jest 123 스위트 통과·`tsc` 0). 토큰 86,148.

## 최종 요약

### [T-134] 청산 평가 — 보유 종목 상태 조회 실패 한 번이 그 시장 틱의 남은 종목 평가를 멈추던 문제

- **상태**: 구현·Reviewer(PASS, Critical·High·Medium 0)·QA(PASS, 결함 0) 완료 → **배포 승인 대기**(`ready-to-deploy`). 코드는 서버 worktree 의 별도 브랜치 `wip/T-134-state-load-isolation`(커밋 `bf9980a`)에만 있고 `main`·운영에는 없다.
- **무엇이 바뀌었나**: 청산 평가 루프에서 `loadPositionState`(보유 종목의 저장 상태 조회) 한 번이 실패하면 예외가 루프 밖으로 나가 **그 틱에서 아직 평가하지 않은 종목의 손절·익절 평가가 건너뛰어졌다**(다음 틱 약 5분 뒤 재시도). 이제 이웃 호출(`getTicker`·`upsertPositionState`)과 같은 모양으로 종목 단위로 격리한다 — 실패 종목은 평가하지 않고 `exit_state_load_failed` 로 기록만 하며, 나머지 종목은 계속 평가된다. 실패 종목에는 시그널·쿨다운·`position_state` 쓰기·경보가 새로 생기지 않는다(새 청산 경로 없음). 화면 변화: 홈 「데이터 이상」 건수와 분석 퍼널에 새 게이트 「청산: 포지션 조회 실패」(단계 23)가 실패했을 때만 나타난다.
- **배포**: 미배포. 이유: 사용자 배포 승인 전(push=배포). 승인되면 `main` 으로 옮겨 push 한다. **같은 배포에 실릴 다른 작업**: [[T-135-recorder-pool-hold-and-runner-tmp]](함께 승인 요청 예정) · 같은 `main` 에 이미 쌓인 문서 커밋 3개(`84f8d7c`·`6c8f88c` 등 — push 하면 문서만으로도 재배포가 일어난다).
- **AI 가 검증한 것**: 변경 전 트리(`c593300`)에서 결함을 재현(3종목 중 2번째 실패 시 3번째가 시세·상태·시그널을 못 받고 그 틱의 `eval_funnel`·`exit_judgment` 기록이 쓰이지 않음, 시험 18/18 실패 → 변경 후 18/18 통과) · 정상 경로 불변(Developer 하네스 357건 차이 0, Reviewer 가 새로 만든 하네스 장면 21×2 에서 `await` 틱 번호까지 동일, QA 관찰 로그 11키 바이트 동일) · 변이 시험(Developer 18 + Reviewer 10 + QA 5 전부 적발) · `tsc` 0 · 범위 jest 123 스위트 3759 통과·실패 0 · 안전 토큰(`submitOrder`·`createOrder`·`DRY_RUN`·`KILL_SWITCH`·`ORDER_MAX`·`createSignal`·`setCooldown`·`sendAlert`) 변경 0줄 · 커밋 훅 실제 통과.
- **AI 가 못 한 것**: 실제 mysql2 오류·풀 대기 초과로 재현(목 throw 만) · 운영 DB 에서 이 조회가 얼마나 자주 실패하는지(미측정) · 크론 러너 → `job_run_log` 실행 경로·`next build` 번들·홈 화면 렌더 · 일회용 MariaDB 3 스위트 · 전체 저장소 jest · lint(설정 없음) · Codex 외부 검토(모델 설정 장애) · 새 문구의 designer 검토.
- **👉 사용자가 확인할 것**: 배포 후에는 특별히 볼 것이 없다. 이 실패는 이전엔 크론 500 → `job_run_log` failed 로 눈에 띄었지만 **이제는 HTTP 200 으로 끝난다**(Reviewer F-3) — 흔적은 홈 「데이터 이상」 건수·분석 퍼널의 새 게이트·`exit_judgment` 의 `error` 행·`console.warn` 이다. 홈에서 「데이터 이상」이 0 이 아니면 그 게이트를 눌러 본다. 반복 실패 전용 경보는 없다.
- **👉 사용자가 결정할 것**: ① 새 문구 「청산: 포지션 조회 실패」가 마음에 드는지(한 줄, designer 미검토) ② 반복 실패 전용 경보가 필요한지(권고: 지금은 불필요 — 홈 숫자로 보이고 실패 빈도를 아직 모른다).
- **남은 일**: [[T-131-t126-t130-followup-candidates]] 에 추가할 것 — ① Developer 범위 밖 발견: `runMarket` 이 청산 엔진 뒤에 부르는 `strategies` 조회(`engine.ts:1347-1351`)와 `refreshUniverse`(1353)에 호출부 try 가 없어 던지면 그 틱의 `eval_funnel` 행이 사라지고 라우트가 500(시그널·판단 기록은 이미 써진 뒤라 보호가 아니라 관찰 손실) ② Reviewer F-1: 이상한 형태의 예외 값에서 `String(e)` 가 다시 던질 수 있음(Low, 변경 전에도 동일) ③ Reviewer F-2: 지표 계약 `docs/design/2026-10-30-t108-metrics-contract-draft.md:263` 청산 게이트 나열에 새 게이트 한 줄 누락(동작은 §11.3 와일드카드로 맞음).
- **이슈·위험**: 낮음. 정상 경로 동작이 달라지지 않는다는 증거가 세 겹(하네스 3종)으로 있다. 주의할 점은 위의 관측 방식 변화(500 → 200) 하나다.

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 해당없음 | - | - | judge: none | 10-31 15:23 |
