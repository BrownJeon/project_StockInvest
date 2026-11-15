---
task_id: T-171
title: 기준 커밋에서 이미 실패하던 시험 정리 — 판정표 + 「시험 낡음」 러너 시험 6개 갱신
status: review
priority: high
project: StockInvest
created: 2026-11-15
updated: 2026-11-15
base_ref: c29e6858763d4e76e483a7c48dfad5c465ceae93
risk_level: R1
roles_involved: [leader, developer, reviewer, qa]
related_tasks: [T-170-daily-bars-kr-evening-staleness-order, T-156-us-stock-entry-exit-forecast-design, T-160-home-anomaly-diagnostics]
tags:
  - type/task
  - domain/test
  - domain/cron
aliases:
  - 기준실패시험정리
waiting: [user_decision, push_confirm]
execution_context:
  schema_version: 1
  origin_tool: claude
  current_tool: claude
  current_procedure: claude_standard
  current_scope: 실패 시험 판정(읽기 전용)·「시험 낡음」 러너 시험 6개 갱신·감사·QA·커밋. 그 밖의 갱신·코드 수정·환경 변경·push 는 사용자 결정 후
  last_event_id: E1
---

# T-171 기준 커밋에서 이미 실패하던 시험 정리

## 목표·배경 (Leader)

**한 문장**: `main`(T-170 `c29e685`)에서 이미 실패하는 시험 단언을 하나씩 「시험이 낡음」 / 「실제 회귀·경계 위반」 / 「환경 문제」로 판정해 표로 남기고, 시험이 낡은 것만 기대값을 약화하지 않고 갱신한다.

**왜**: 기준에서 이미 실패하는 단언은 새 회귀를 같은 이름으로 가린다. T-170 의 Reviewer·QA 가 이 한계를 기록했다(로그: 서버 `~/.node-local/t170-logs/base/`·`r2/`·`qa/`). 실패 목록은 T-170 세션이 넘겨 준 실측(러너 30단언 + jest 5파일)을 출발점으로 하고, 이 task 에서 전체 jest 를 한 번 돌려 **실패 스위트 26개**(목록 밖 21개 포함)를 확인했다.

**하지 않는 것(별도 결정)**: 제품 코드 수정(job-slots 표·T-156 경계 위반 정리), 경계 시험 허용 목록 확장, 공유 `node_modules` 변경, push·배포.

## 사용자 지시·승인 (원문 보존)

- 2026-11-15 08:2x (T-170 세션이 넘긴 작업 지시): "각 실패가 「시험이 낡음」인지 「실제 회귀」인지 판정해 사용자에게 표로 보여 주고, 시험 갱신이 맞는 것만 기대값 근거를 적어 고친다(기대값 약화 금지). 끝: 표 + 승인된 갱신, Reviewer·QA 통과, 커밋(서버 worktree), push 는 사용자 승인 후."
- **이 지시가 허용하는 것**: 판정 조사(읽기 전용), 「시험 낡음」으로 판정한 시험의 갱신·감사·QA·서버 worktree 커밋.
- **허용하지 않는 것**: push·배포, 제품 코드 수정, 경계 허용 목록 확장, 공유 환경 변경 — 아래 「사용자 결정 필요」 표.

## 판정표 (Leader — 2026-11-15, 기준 `c29e685`)

### A. 러너 시험 — 시험 낡음 (이 task 에서 갱신)

공통 원인 [확실]: 기준 ref 와 비교하는 러너 시험들은 러너를 바꾼 task 마다 자기 블록·호출을 비교 범위에서 빼 왔다(T-118·T-119·T-135·T-143·T-145·T-147·T-149·T-170 선례). **T-160(`f712c1b`, call() 3줄)과 T-156(`c296116`·`2411627`·`04afa34`, m40 블록 2개·최상위 함수 블록·선언 1·call() 분기 2줄·호출 3경로)은 이 일을 하지 않았다**(T-160 은 job-run-log J8 한 곳만 고쳤다). 두 변경은 각각 Reviewer PASS(scope 에 `scripts/cron-runner.sh` 포함)·운영 반영됐다. 범위를 맞추면 나머지는 기준과 한 글자도 같다(D6·H9·P7·E·F7·U5 정적 실측 통과).

| 시험 | 실패 단언 | 직접 원인 | 조치 |
|---|---|---|---|
| daily-bars | D1 호출 목록 · D1 --max-time | T-156 m40 호출 3경로(call() 경유 2 + 상태 확인 curl 1)·상한 10/150/5 | 비교에서 뺌 |
| daily-bars | D6 블록 밖 · D6 추가만 · D6 call() | T-156 블록·선언·분기 / T-160 call() 줄 | 빼거나 되돌려 비교 + 대상 줄 수 고정 단언 추가 |
| job-run-log | J1 호출(새·끔) · --max-time · stdout ×2 · 날짜파일 · 경로별 줄 수 | T-156 호출·로그 줄·상태 파일 2개 | **기준 러너와 비교할 때만** 뺌(⑨·T-170 방식) |
| job-run-log | 🔴 J1 「받은 줄 + 남은 스풀 = call() 호출 수」 기대 5137 / 실제 5129 | 상태 확인 curl 8건은 **call() 밖 직접 호출**이라 후크 줄이 없다 | 그 경로를 call() 호출 수에서 뺌(자기 정합 검사는 그대로) |
| job-run-log | 🔴 J8 call() | T-156 분기 2줄 | 뺌 |
| job-run-log | 🔴 J13 CALL_BODY_FILE 읽기 2 → 3 · 되돌린 러너 흔적 2 → 3 | T-160 이 jrl_hook 에 성공 마커 읽기 1줄 추가 | 기대 3 + 「셋 다 head -c 상한 읽기」 단언 추가(강화) |
| news-split | D 호출·상한 · E 정적·call() · F6 호출·상한 · F7 정적 | 위와 같음 | 빼거나 되돌림 |
| overseas-universe | U4 호출·상한 · U5 call() | 위와 같음(U5 는 기준 ref 가 T-112 뒤라 T-160 의 후크 호출 줄 인자도 보인다) | 빼거나 되돌림 |
| holdings-premarket | H9 call() · H9 블록 밖 | 위와 같음 | 빼거나 되돌림 |
| news-peek | P7 블록 밖 · P7 call() | 위와 같음 | 빼거나 되돌림 |

### B. jest — 실제 결함·경계 위반 (시험이 옳다 — 사용자 결정 필요, 이 task 에서 고치지 않음)

전부 T-156 이 코드를 더하면서 경계 시험을 갱신하지 않은 것이다. 시험은 설계대로 새 지점을 잡았다.

| 시험 | 실패 내용 | 판정 | 선택지 |
|---|---|---|---|
| `strategy/records/__tests__/job-slots.test.ts` E11 | 러너 정적 라벨 `m40-forward`·`m40-forecast` 가 `JOB_SPECS` 에 없음 | **실제 누락** [확실] — `fallbackSpec` 주석이 「러너에 새 잡이 생겼는데 표를 안 고친 경우 … 정합 시험이 이 경우를 막는다」고 적어 둔 그 경우. 지금은 두 잡 기록이 `other/common/periodic`(슬롯 없음)으로 분류된다 | ① `job-slots.ts` 에 ET 기준(`et_daily`) 2행 추가(코드, SAFETY_PATHS) ② 그대로 둠 |
| `profit-engine/__tests__/isolation.test.ts` ①② | `daily-bars-store.ts` → `@/lib/strategy/universe-overseas-static` import(51d0105) | **경계 위반** [확실] — 규칙 1 「profit-engine 은 전략 경로를 참조하지 않는다」(예외는 지표 5개뿐, 사용자 승인 목록) | ① 정확 경로 1개를 예외로 승인(그 모듈이 읽기 전용임을 같은 시험에서 단언) ② 코드에서 분리 |
| 같은 파일 ③ | 매매 경로의 `daily_bars` 참조: `analysis-data/capture-operating-data.ts`(+시험), `strategy/m40/__tests__/archive-reader.test.ts`·`operating-evidence.test.ts` | 경계 위반 | ① 파일 단위 정확 일치 예외 승인 ② 코드 이동 |
| `corp-intel/__tests__/isolation.test.ts` | `analysis-data/capture-operating-data.ts`(+시험)·`strategy/m40/operating-evidence.ts`(+시험)가 corp-intel·`ci_raw_item` 언급 | 경계 위반 | ① 예외 승인 ② 코드 이동 |
| `lib/__tests__/currency-mixing-fence.test.ts` | `priceUsd` 읽는 새 파일 5개(`M40PaperPanel.tsx`·`m40/forecast-continuation.ts`·`paper-ledger.ts`·`paper-view-types.ts`·`paper-view.ts`) | 경계 위반 — 지점마다 원화·달러 섞임 검토가 필요 | ① 지점별 검토 후 허용 목록 ② 수정 |
| `lib/__tests__/usd-cash-balance-fence.test.ts` | `m40/paper-ledger.ts` 의 USD 같음 비교 1곳 | 경계 위반 | ① 검토 후 허용 ② 수정 |
| `__tests__/t108-terms-fence.test.ts` | `M40PaperPanel.tsx` 에 옛 용어 「표본 부족」「모의 매매」 | 화면 용어 회귀 | ① 문구 수정(designer) ② 허용 |
| `ops/__tests__/reason-dictionary-keys.test.ts` | 주문 사유 `paper_only`(dry-run.ts 의 m40 모의 차단) 가 사전·허용 목록에 없음 | 누락 — 단 그 차단은 `orders` 행을 쓰기 전에 끝나 화면 주문 목록에는 오지 않는다(시그널 오류 문자열에는 남을 수 있다) [가능성 높음] | ① 한국어 문구 추가(designer) ② `KNOWN_UNMAPPED` 에 이유와 함께 |

### C. jest — 환경 문제 (코드·시험 아님)

| 시험 | 실패 내용 | 원인 | 선택지 |
|---|---|---|---|
| 렌더 시험 20개 — `components/home/__tests__/home-render-t108.test.ts` 와 목록 밖 19개(`components/ui/__tests__/sheet`·`ledger-render`·`login-screen-t088`·`app-shell-render`·`order-detail-blocked-reason-t130`·`scenario-pages-wiring`, `app/settings/**` 7개, `src/__tests__/t108-*` 4개·`t156-paper-view-render`·`t162-entry-watch-render`) | `Invalid hook call` / `Cannot read properties of null (reading 'useRef'·'useState')` | 공유 `node_modules` 안에 잘못 생긴 심볼릭 링크 `StockInvest/node_modules/node_modules → /tmp/stockinvest-t113-qa.2NLEmQgW/node_modules → ~/.node-local/stockinvest/node_modules`(= 같은 디렉터리, 2026-11-04 23:21 생성 — T-113 QA 임시 폴더). jest 의 모듈 경로 탐색은 `node_modules` 이름 구간을 건너뛰지 않아 `react-dom` 이 그 링크 경로의 React 를 따로 적재한다 [가능성 높음] → React 두 벌 | ① 그 링크 하나 삭제(대상 디렉터리는 그대로) ② 그대로 둠 |

근거 [확실]: React 를 한 경로로 고정한 임시 jest 설정(`moduleNameMapper ^react$`)으로 `home-render-t108`(213)·`sheet`(19) 가 전부 통과. 같은 시험을 고정 없이 돌리면 실패. 링크를 지운 뒤의 재실행은 아직 하지 않았다(공유 환경 변경이라 결정 대기).

## 설계 (Leader — Developer 구현 사양, A 절만)

1. 6개 러너 시험에 같은 도우미(T-171 블록)를 둔다: `M40RE`(호출 줄)·`M40MT`(상한 줄)·`no_t156`(m40 블록 3개·선언 1·call() 분기 2줄)·`no_t156_call`(분기 2줄만)·`no_t160`(call() 3줄 되돌림 — job-run-log J8 의 원래 2치환 + 후크 호출 줄 인자)·`t171_targets`(빼거나 되돌리는 5줄이 파일 전체에 각 1개이고 모두 call() 안인지).
2. 동적 비교는 m40 3경로를 **새 러너 쪽 비교에서만** 뺀다. job-run-log 는 상태 확인 curl(call() 밖)만 `nojrl` 에서 빼고, call() 경유 2경로는 `nojrl_cmp`(기준 비교)에서만 뺀다 — 「call() 마다 한 줄」 자기 정합 검사는 그 두 경로를 그대로 센다.
3. 정적 비교는 새 러너 쪽에서만 no_t160·no_t156 을 적용한다. call() 해시 비교는 no_t160·no_t156_call 을 더한다.
4. 기존 기대값·단언은 바꾸지 않는다. 바뀌는 기대값은 J13 두 줄(2 → 3, T-160 의 성공 마커 읽기 — 「셋 다 head -c 상한 읽기」 단언을 함께 둔다)뿐이다. 새 단언: 각 시험 정적 절의 `t171_targets` 1개(J13 은 위 결합 단언).
5. 빼는 줄이 엉뚱한 곳에 생기면 범위가 무검사로 넓어지므로(T-149 감사 L-7 선례) `t171_targets` 로 막는다.

## Developer

- [09:0x] (메인 세션 겸 Developer, claude) 서버 worktree `~/.node-local/stockinvest-t171`(detached, `c29e685`)에서 6개 시험 수정. 편집은 Mac scratch 사본 → scp.
- 정적 절만 따로 실행(하네스 1440틱 생략): daily-bars D6 18/18 · holdings H9 15/15 · news-peek P7 14/14 · news-split E 11/11 · overseas U5 11/11 · job-run-log `T112_ONLY="J8 J13"` 35/35.
- 변이 확인(정적): ⓐ call() 의 `$label OK` 줄 변경 → D6 3건·J8 2건 fail ⓑ call() 밖 선언 1줄 변경 → D6 2건·J8 1건 fail ⓒ T-156 분기 줄을 call() 밖에 복제 → `t171_targets`(+bash -n) fail. 셋 다 잡힌다.
- 전체 실행(6개, flock 직렬): 로그 `~/.node-local/t171-logs/r1/` — 결과는 아래 QA 전 기록에 덧붙인다.
- [10:35] 전체 실행 r1 결과(08:46~10:29, flock 직렬, 1440틱 포함): daily-bars PASS=83 FAIL=0 · job-run-log 212/0 · news-split 120/0 · overseas-universe 30/0 · holdings-premarket 54/0 · news-peek 82/0 — 합계 581 / 0, 종료 코드 모두 0. 실행 전후 입력(러너 + 시험 12개) sha256 이 `r1/inputs.sha256` 과 같다(실행 중 파일 변경 없음).
- [10:36] 기준 이동: origin/main 이 `bd65785`(T-169·T-170 문서)로 나아갔다. `git diff c29e685 bd65785 -- scripts/` 가 비어 있어(러너·시험 동일) worktree 를 `bd65785` 로 옮겼다(미커밋 변경 그대로). r1 결과는 같은 러너·시험 바이트에 대한 것이라 그대로 유효하다.
- 설계상 확인: 상태 확인 curl 은 하네스 스텁에서 `200` 을 받아 JSON 이 아니므로 관측값 없음 → `m40-forward` call() 호출(200 → state failed) → 30분 간격 4회. forecast 는 준비 안 됨 → call() 없이 확인만 4회. 하루 전체 시나리오에서 확인 8 + 호출 4 = 12건, J1 의 차이 8건과 맞다.

## Reviewer

- [08:49] (Reviewer, claude) 검토 범위: 서버 worktree `~/.node-local/stockinvest-t171`(base `c29e685`) 미커밋 diff 6개 시험 전체 + `git show f712c1b c296116 2411627 04afa34 -- scripts/cron-runner.sh` 대조. 제품 코드·시험 파일은 수정하지 않았다. 변이용 사본은 `~/.node-local/t171-logs/rev/` 에만 두고 삭제했다. 전체 시나리오(1440틱)는 돌리지 않았다(r1 진행 중).
- [08:49] 1) 범위 일치 [확실]: 네 커밋의 러너 diff 를 직접 읽었다. f712c1b = call() 3줄(`local code curl_exit=0`, `|| { curl_exit=$?; code="000"; }`, jrl_hook 호출 줄 인자) + jrl_hook 본문(call() 밖). c296116/2411627/04afa34 = 선언 `M40_FORWARD_LAST_RUN_FILE`, 메인 루프 블록 `m40-forward-daily`·`m40-forecast-daily`, 최상위 블록 `m40-state-write`, call() 의 `elif`·`echo ACCEPTED` 2줄이 전부이고 그 밖의 줄 변경은 없다. 도우미가 빼는 것(no_t156 = 위 3블록 + 선언 1줄 + 분기 2줄, no_t160 = 위 3줄 되돌림)은 이 목록과 정확히 같다. 기대값을 바꾼 곳은 J13 두 줄뿐이다.
- [08:49] 2) job-run-log 의 `nojrl`/`nojrl_cmp` 분리 [확실, 정적 읽기]: 상태 확인 curl(`?status=1`)은 call() 밖 직접 호출이라 후크 줄이 없다. `nojrl` 을 쓰는 곳(251~)은 모두 call() 항목의 개수·순서 정합이다(J1 NCALLS, J2 받은 순서, J3 spool 수, J5, J7, 653 NJ). 프로브가 이 집합에 들어 있으면 오히려 잘못 어긋난다. call() 경유 2경로는 `nojrl` 에 남아 `nojrl_cmp`(기준 비교)에서만 빠지므로 「호출마다 한 줄」 자기 정합은 약해지지 않는다. 만약 프로브가 call() 을 거치게 바뀌면 스풀이 nojrl 보다 많아져 J1 정합이 깨진다. J2~J12 약화 없음으로 판단한다(동적 재실행은 미확인 — r1 결과 대기).
- [08:49] 3) no_t160(치환 3개)·`grep -vxF` 2줄·`t171_targets` [확실]: 3번째 sed 는 줄 전체 앵커(`^…$`)라 후크 호출 줄 1곳만 바꾼다. `-xF` 는 전체 줄 고정 문자열이라 부분 일치로 번지지 않는다. `t171_targets` 가 「파일 전체 = call() 안 = 5개 각 1」을 단언한다. 변이 확인(정적 절 6개): call() 에 무관한 줄 추가 → 6개 시험 모두 FAIL(ou 포함), `rm -f "$CALL_BODY_FILE"` 줄 변경 → 5개 FAIL, `elif` 조건 변경(202→203) → 5개 FAIL, 후크 호출 줄에 인자 추가 → 6개 중 db/hp/np/ou/jrl FAIL, `local code curl_exit=0 zzz=1` → 5개 FAIL, 기준(변이 없음) → db 18/18·hp 15/15·np 14/14·ns E 11/11·ou 11/11·jrl `J8 J13` 35/35.
- [08:49] 4) J13 강화 단언 [확실]: 읽기 곳 3개, 셋 다 `b64=$(head -c "$JRL_BODY_MAX_BYTES" 또는 "$((JRL_BODY_MAX_BYTES + 1))" "${CALL_BODY_FILE:-}" … | ` 형태여야 `0` 이 나온다. 변이: jrl_hook 에 4번째 CALL_BODY_FILE 언급 추가 → FAIL 2, 일반 경로 읽기를 `cat` 으로 교체 → FAIL 1. 둘 다 잡는다. 기대값 2→3 은 T-160 의 성공 마커 읽기(`head -c 2049`)와 맞는다.
- [08:49] 5) 숨을 수 있는 범위(수용 가능, 결함 아님) [확실, 변이]: (a) m40 블록 안쪽의 내용 변경은 이 6개 시험에서 보이지 않는다 — 프로브 `--max-time` 5→6 변경은 6개 모두 통과했다. 블록 본문은 `test-cron-runner-m40-forward.sh`·`m40-forecast.sh` 몫이라는 주석 설명과 일치하고, 블록 안에서 m40 이 아닌 경로를 새로 호출하면(변이 A: stop-alert 호출 추가) 동적 호출 비교가 잡는다는 점은 이번에 정적 절만 돌려 확인하지 못했다. (b) overseas-universe U5 는 call() 외 줄을 정적으로 비교하지 않아 선언 줄 뒤 최상위 한 줄 추가·`m40-forecast-daily` 시작 표지 이름 변경을 못 잡는다(db/hp/np/ns 는 잡음). 이는 U5 의 기존 설계(T-171 이전과 동일)이며 이번 변경이 약화시킨 것이 아니다. (c) `m40-forward-daily` 종료 표지를 없애도 awk 가 다음 `<<<`(forecast) 까지 한 구간으로 지워 통과한다 — 두 블록이 연속이라 실제로 가려지는 줄은 사이의 공백뿐이다.
- [08:49] 6) 주석 정확성 [확실]: ET 06:45~09:00 창(forward 405~525분, forecast 420~540분) → KST 19:45~22:00(EDT)·20:45~23:00(EST) 환산이 맞다. 상한 10/150/5, 「call() 경유 2 + 직접 curl 1」, 「T-156 은 줄을 더하기만 해 되돌릴 것이 없다」 모두 diff 와 일치한다. 오해 소지 있는 문구 없음. 경미: 시험 주석의 「Reviewer PASS·운영 반영」은 task 이력서 근거이며 이 감사에서 독립 확인하지 않았다(코드 판단에는 영향 없음).
- [08:49] 미확인: 6개 시험의 동적(1440틱) 절 — 특히 J1 「받은 줄 + 남은 스풀 = call() 호출 수」, `nokfout`·`dfiles`·`nojrlmt` 의 새 필터가 기준 비교를 잘 맞추는지, ns F6, ou U4 — 은 r1 전체 실행 결과로 확인해야 한다(내가 돌리지 않음). news-split F7 정적은 개별 실행하지 않았다(E 절만). 이 판정은 정적 절·변이로 확인한 범위에 한정되며 동적 PASS 를 대신하지 않는다.
- [08:49] **최종 판정: PASS (scope: scripts/test-cron-runner-daily-bars.sh, scripts/test-cron-runner-holdings-premarket.sh, scripts/test-cron-runner-job-run-log.sh, scripts/test-cron-runner-news-peek.sh, scripts/test-cron-runner-news-split.sh, scripts/test-cron-runner-overseas-universe.sh)**

## QA
- [10:59] (QA, claude) 1) r1 로그 6개 확인 [확실, 파일 읽기]: 각 `<test>.log` 마지막 줄이 `결과: PASS=N FAIL=0`(daily-bars 83 · job-run-log 212 · news-split 120 · overseas-universe 30 · holdings-premarket 54 · news-peek 82 = 581). 실패 줄 `  FAIL `은 6개 모두 0건, `  ok ` 줄 수가 각 PASS 와 일치. all.log 의 exit=0 6개 확인. 실패 marker 는 eq()→bad() 가 찍는 `  FAIL ` 줄이다.
- [10:59] 1-b) `sha256sum -c ~/.node-local/t171-logs/r1/inputs.sha256` → 13개 파일 전부 OK, rc=0. 경고 1건은 기대대로 commit sha 줄(`improperly formatted`).
- [10:59] 2) 약화 여부 [확실, diff 읽기]: 6개 파일 모두 `eq ` 줄 수 기준선 대비 정확히 +1(T-171 가드). diff 의 삭제된 단언 11개는 전부 같은 이름의 단언으로 1:1 대체됐다(D1·D6·H9·J8·J13·P7·D·E·F6·U5 의 call()/--max-time 비교). 기대값 변경은 J13 jrl_hook 읽기 2→3 하나뿐이며, 셋 다 head -c 상한 읽기인지 함께 단언해 오히려 조였다.
- [10:59] 2-b) 제외 범위 교차 대조 [확실]: `git show c296116 2411627 04afa34 f712c1b -- scripts/cron-runner.sh` 의 +/- 줄을 전부 읽었다. 추가·삭제 줄은 ① m40-forward-daily·m40-forecast-daily 블록 ② m40-state-write 블록 ③ 선언 M40_FORWARD_LAST_RUN_FILE ④ call() 의 ACCEPTED 분기 2줄 ⑤ call() 의 T-160 줄 3개(local/|| 치환·jrl_hook 인자) ⑥ jrl_hook 본문(job-run-log-spool 블록 안)뿐이며, 제외 도우미(no_t156·no_t156_call·no_t160·nojrl 의 M40P_RE)가 이 집합과 일치한다. 제외가 그 밖의 줄(다른 잡 호출·상한)에 닿지 않는다.
- [10:59] 2-c) 시험 목록의 추가 제외 `nojrl`(상태 확인 curl `?status=1`)은 후크 줄이 없는 직접 호출이라 「호출 = 스풀」 자기 정합에서 빼는 것이 맞다 [확실, 러너 코드 확인]. 기대값은 바뀌지 않았다.
- [10:59] 3) 동적 변이 실행 [확실, 실행]. 사본은 `~/.node-local/t171-logs/qa.MIJb/` 에만 두었고 worktree 는 건드리지 않았다. 명령: `T117_RUNNER=<사본> flock /tmp/stockinvest-heavy-tests.lock nice -n 10 timeout 3000 bash scripts/test-cron-runner-daily-bars.sh`. 
  - a. 대조(무변경 사본): `결과: PASS=83 FAIL=0`, exit 0.
  - b. 블록 안 변이: `# >>> m40-forward-daily` 바로 아래 `  call /api/cron/entry-watcher "entry-watcher"` 1줄 추가(매 틱 실행되는 비-m40 호출): `결과: PASS=79 FAIL=4`, exit 1. 실패 단언: `D1: daily-bars 를 뺀 호출 목록이 변경 전과 다르다`, `d2-409`·`d2-503` 의 호출 목록 비교, `d2-timeout`(기대 07:43 실제 07:38). 정적 D6 은 블록 안 줄을 제외하므로 통과했다(기대된 한계).
  - c. 블록 밖 변이: `  # <<< m40-forecast-daily` 바로 아래 같은 entry-watcher 줄 추가(main loop, m40 블록 밖): `결과: PASS=78 FAIL=5`, exit 1. 실패 단언: 위 b 와 같은 4개 + `D6: 블록 밖 실행 줄이 바뀌었다`(정적).
  - 두 변이 모두 FAIL>0 이므로 시험이 잡는다. d2-timeout 실패는 추가 호출이 틱 시각 관찰에도 영향을 준 결과로 보이나 원인 분석은 하지 않았다[추측].
- [10:59] 4) 미검증: 변이는 비-m40 호출 1종 추가 두 종류만 시험했다. m40 블록 본문 내부의 다른 변경(상한·창·상태 파일 조작)은 이 6개 시험이 보지 않는 설계상 범위다(Reviewer 도 같은 결론). 나머지 5개 시험의 변이는 실행하지 않았다. 다른 시험(m40-forward·m40-forecast·stop-alert·alert-ticker·daily-bars-kr·pmo-retry 등)은 이 task 범위 밖이라 돌리지 않았다.
- [10:59] 5) 산출물 정리: 사본·로그 디렉터리 `~/.node-local/t171-logs/qa.MIJb/` 와 임시 삽입 파일 `/tmp/t171-qa-ins.txt` 는 이 기록 직후 삭제했다. 커밋·push·reset 없음, 다른 worktree·NFS 트리 미접촉.
- [10:59] **QA 판정: PASS**

## 실행 도구·절차 이력

| event | 시각 | 종류 | 도구 / 절차 | 범위 | 근거 |
|---|---|---|---|---|---|
| E1 | 2026-11-15 08:2x | start | claude / claude_standard | 판정 조사부터 A 절 갱신·감사·QA·커밋까지 | T-170 세션(Claude)이 넘긴 작업 지시 |

## 최종 요약
