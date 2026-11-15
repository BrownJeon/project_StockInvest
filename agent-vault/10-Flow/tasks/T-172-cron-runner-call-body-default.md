---
task_id: T-172
title: cron-runner call() 셋째 인자(본문) 끝에 } 가 하나 더 붙는 결함 고침 + 회귀 시험 + call() 비교 시험 정리
status: done
priority: medium
project: StockInvest
created: 2026-11-15
updated: 2026-11-15
base_ref: 683a5dccd5bd1a1a520d115bcde8237a01612494
risk_level: R1
roles_involved: [leader, developer, reviewer, qa]
related_tasks: [T-170-daily-bars-kr-evening-staleness-order, T-171-baseline-failing-tests-triage]
tags:
  - type/task
  - domain/cron
  - domain/test
aliases:
  - call본문기본값
execution_context:
  schema_version: 1
  origin_tool: claude
  current_tool: claude
  current_procedure: claude_standard
  current_scope: call() 본문 기본값 고침·회귀 시험·call() 을 기준 ref 와 비교하는 러너 시험 7개 정리·낡은 주석 갱신·감사·QA·서버 worktree 커밋. push(=운영 배포)는 사용자 승인 후
  last_event_id: E1
---

# T-172 cron-runner call() 셋째 인자 결함 고침

## 목표·배경 (Leader)

**한 문장**: `scripts/cron-runner.sh` 의 `call()` 첫머리 `local body="${3:-{}}"` 가 셋째 인자(요청 본문)를 받으면 끝에 `}` 를 하나 더 붙이는 결함을 고치고, 그 동작을 회귀 시험으로 고정하고, call() 을 기준 ref 와 비교하는 러너 시험들이 이 변경을 의도된 변경으로 다루게 한다.

**왜** [확실 — 서버 bash 5.1.16 재현]: bash 는 `${3:-{}}` 를 기본값 `{` 뒤 첫 `}` 에서 닫고 남은 `}` 를 글자로 붙인다. 셋째 인자가 없으면 `{}`(정상), 있으면 `<인자>}`(예 `{"market":"KR"}` → `{"market":"KR"}}`, 일봉 라우트는 400). 지금 러너에 셋째 인자를 넘기는 call 줄은 0개라 운영에서 드러나지 않았고, [[T-170-daily-bars-kr-evening-staleness-order]] 는 국내 저녁 실행의 시장을 쿼리(`?market=KR`)로 넘겨 피했다. 다음에 본문을 넘기는 잡을 만들면 바로 깨진다.

**하지 않는 것**: 국내 저녁 실행을 본문 방식으로 바꾸기(쿼리 그대로), 라우트·수집기 동작 변경, 다른 잡 추가, push·배포.

## 사용자 지시·승인 (원문 보존)

- 2026-11-15 (부모 세션 「daily-bars」가 넘긴 작업 지시): "scripts/cron-runner.sh 의 call() 결함(`local body="${3:-{}}"` — 셋째 인자를 주면 `}` 가 하나 더 붙음)을 고친다. 구현 전에 call() 을 기준 ref 와 비교하는 시험과 고정값 갱신 범위를 조사해 설계를 사용자에게 보인다. 끝: call() 수정 + 셋째 인자 회귀 시험 + 해시 고정값 정리, Reviewer·QA 통과, 커밋까지. push(=운영 배포)는 사용자 승인 후."
- 설계는 이 세션에서 사용자에게 보였다(기준 ref 별 비교 단언 표·수정 형태·주석 갱신 범위). 사용자에게 물은 것은 **순서** 하나(지금 착수 후 T-171 위로 리베이스 / T-171 커밋 뒤 착수)였고 답을 받기 전에 [[T-171-baseline-failing-tests-triage]] 가 origin/main 에 들어가(`683a5dc`) 두 선택지가 같은 결과가 됐다 — T-171 위에서 바로 착수했다.
- **허용하는 것**: 위 지시 범위의 구현·시험·주석 갱신·감사·QA·서버 worktree 커밋. **허용하지 않는 것**: push·배포(사용자 승인 대기 — `waiting: push_confirm`).

## 설계 (Leader — Developer 구현 사양)

1. **call() 고침** — 한 줄을 두 줄로(둘 다 `# T-172` 표지):
   `local body_default='{}'` + `local body="${3:-$body_default}"`. 셋째 인자 없음·빈 값 → `{}`(예전과 같음), 있으면 그대로. `"${3:-\{\}}"` 는 `\{}` 를 내므로 쓰지 않는다(재현 확인).
2. **운영 동작 불변 근거**: 셋째 인자를 넘기는 call 줄 = 0(기준·새 러너 모두). 그래서 지금 모든 호출의 curl 인자·본문은 바이트까지 같다 — 새 회귀 시험 B2·B3 이 고정한다.
3. **회귀 시험** `scripts/test-cron-runner-call-body.sh`(새 파일): 러너에서 잘라 낸 실제 call() 을 가짜 curl 로 돌려 본문을 본다(B1) · 기준 ref 의 call() 은 같은 하네스에서 `}` 를 덧붙임을 보여 민감도를 증명하고 인자 없음·curl 인자·로그가 기준과 같음을 본다(B2) · 정적 단언(B3).
4. **비교 시험 정리**: call() 을 기준 ref 와 비교하는 러너 시험 7개(daily-bars D6 · holdings-premarket H9 · job-run-log J8 · news-peek P7 · news-split E · overseas-universe U5 · daily-bars-kr K6)에 같은 도우미 `no_t172`(기본값 줄 삭제 + 본문 줄을 옛 형태로)를 두고, T-171 이 만든 비교 사슬의 `no_t160` 바로 뒤에 넣는다(call() 해시 · 「추가만」 대조 · 블록 밖 실행 줄 비교). 되돌리는 줄이 엉뚱한 곳에 생기면 범위가 무검사로 넓어지므로 각 시험에 「두 줄 = 파일 전체 각 1개 · 모두 call() 안 · 옛 줄 0」 단언(`t172_targets`)을 더한다(T-171 의 `t171_targets` 와 같은 방식). 기대값 약화 없음.
5. **낡은 주석**: 「call() 은 결함이 있다」고 현재형으로 쓴 주석을 과거형 + 「T-172 가 고쳤다」로 바꾼다 — 러너 국내 저녁 블록 머리 · 일봉 라우트 머리 · 라우트 시험 이름 1개 · 수집기·요청 파서 머리 · isolation 시험 주석 · daily-bars-kr 시험 머리·라벨. 동작·단언은 바꾸지 않는다.

## Developer

- [15:0x] 서버 worktree `~/.node-local/stockinvest-t172`(브랜치 `t172-call-body`, origin/main `683a5dc` 위). 실행 도구: claude(메인 세션이 developer 를 겸함).
- [15:0x] 바꾼 파일 13개 + 새 파일 1개: `scripts/cron-runner.sh`(call() 2줄 + 국내 저녁 블록 주석 2줄) · 러너 시험 7개(도우미·사슬·단언) · `scripts/test-cron-runner-call-body.sh`(새) · `src/app/api/cron/daily-bars/route.ts`·`__tests__/route.test.ts`(주석·시험 이름) · `src/lib/profit-engine/daily-bars-collector.ts`·`daily-bars-request.ts`·`__tests__/isolation.test.ts`(주석).
- [15:05] 새 시험: ok 20 · fail 0. 변이 2종 — 기준 러너(고치기 전)로 돌리면 fail 6(본문 4건 + 정적 2건), 기본값을 `{}}` 로 바꾼 변이는 fail 6(인자 없음 본문·기준 불변·정적). 두 변이 모두 잡는다.
- [19:01] 러너 시험 전체(`scripts/test-cron-runner-*.sh` 13개)를 이 worktree 와 기준 worktree(`683a5dc`, detached)에서 하나씩 돌렸다(무거운 시험 잠금 + nice, 15:05~19:01). 로그 `~/.node-local/t172-qa/{new,base}/`.
  - 새 쪽: 13개 모두 종료 0 · fail 0 — alert-ticker 106 · call-body 20(새) · daily-bars-kr 72 · daily-bars 84 · holdings-premarket 55 · job-run-log 213 · m40-forecast 0 · m40-forward 0 · news-peek 83 · news-split 121 · overseas-universe 31 · pmo-retry 76 · stop-alert 23.
  - 기준 쪽: 12개 모두 종료 0 · fail 0 — 고친 7개는 각각 새 쪽보다 1개 적다(71·83·54·212·82·120·30).
  - 단언 이름 대조(정렬 diff): 고치지 않은 5개(alert-ticker·m40-forecast·m40-forward·pmo-retry·stop-alert)는 같다. 고친 7개의 차이는 ① 라벨에 「T-172 … 되돌림」 문구가 붙은 것 ② 시험마다 `(T-172) no_t172 가 노리는 두 줄 = 파일 전체 각 1개 · 모두 call() 안 · 옛 줄 0` 단언 1개가 더해진 것뿐이다. 기준에 있던 단언이 빠지거나 실패로 바뀐 것 없음.
- [19:1x] jest 2개(`src/app/api/cron/daily-bars/__tests__/route.test.ts`·`src/lib/profit-engine/__tests__/isolation.test.ts`): 새 쪽·기준 쪽 모두 96 통과 · 3 실패, 실패 3개는 이름까지 같다(isolation — 「daily_bars 테이블 참조 0건」「import 대상은 허용 목록뿐」「"@/lib/strategy" 참조 0건」). 기준에서 이미 실패하는 경계 위반으로 [[T-171-baseline-failing-tests-triage]] 표(71·72행)에 사용자 결정 대기로 기록돼 있다 — T-172 가 바꾼 것은 그 파일의 주석 한 곳뿐이고 실패와 무관.

## Reviewer

- [15:10] 실행 도구: claude(reviewer 서브에이전트). 코드는 고치지 않았다. Codex 는 서버 모델 설정 오류로 호출하지 않음(생략 기록만).
- [15:10] call() 고침: `local body_default='{}'` + `local body="${3:-$body_default}"`. set -u 하에서 없음·빈 값 → `{}`, 중첩 JSON·`}` 한 글자·공백·`$(...)` 문자열 모두 바이트 그대로(직접 실행 확인). 셋째 인자를 넘기는 call 줄: 러너 0개(정규식 grep 0건). 옛 형태도 없을 때 `{}` 였고 curl 인자 순서가 같아 운영 호출 불변.
- [15:10] 새 시험 `bash scripts/test-cron-runner-call-body.sh` PASS=20 FAIL=0. 기준 ref 러너(`T172_RUNNER`)로 돌리면 7건 실패, L2 줄만 옛 형태로 되돌린 변이도 7건 실패 — 결함을 잡는다. 외부 호출 없음(curl 셸 함수 스텁, 서브셸), 실제 HOME 쓰기 없음(mktemp 디렉터리, trap 정리).
- [15:10] no_t172: L1 줄을 `grep -vxF` 정확 일치로 지우고 L2 줄을 `sed` 앵커로 옛 줄로 치환 — 지우는 줄이 파일에서 그 한 줄뿐. `t172_targets`(파일 전체 1 1 0 | call() 안 1 1)가 범위 확대를 막고, 옛 줄이 남은 변이도 이 단언이 잡는다.
- [15:10] 비교 사슬: call() 을 기준 ref 와 비교하는 7개 시험(D6·H9·J8·P7·E·U5·K6)은 모두 `no_t160` 뒤 `no_t172` 를 거침(grep으로 위치 확인; daily-bars-kr 는 no_t160 자체가 없고 no_t172 만 쓰는 K6 세 비교에 적용). m40-forward 는 call() 을 스텁/실제 본문 시험으로 쓰고 기준 ref 와 비교하지 않으며, m40-forecast·stop-alert·alert-ticker·pmo-retry 에는 call() 비교가 없다 — 빠진 자리 없음.
- [15:10] 주석 변경: route.ts·collector·request·isolation 은 주석뿐. jest 시험 이름 변경은 src·scripts·vault 어디서도 옛 이름을 참조하지 않음(grep). 기대값 약화 없음(K1 라벨 문구만 보강, 기대값 `{} {} ` 유지).
- [15:10] 미확인: 러너 시험 전체·jest 실행(메인 세션·QA 몫, 돌리지 않음). 훅의 scope 매칭은 미실행.
- [15:10] 발견 사항: LOW — 시험 3개가 `T172_L1` 문구 전체(긴 한글 주석 포함)에 의존해 call() 줄 주석을 고치면 7개 파일을 함께 고쳐야 함(유지보수 비용, 동작 영향 없음). 그 외 없음.
- [15:10] **최종 판정: PASS (scope: scripts/cron-runner.sh, scripts/test-cron-runner-call-body.sh, scripts/test-cron-runner-daily-bars.sh, scripts/test-cron-runner-daily-bars-kr.sh, scripts/test-cron-runner-holdings-premarket.sh, scripts/test-cron-runner-job-run-log.sh, scripts/test-cron-runner-news-peek.sh, scripts/test-cron-runner-news-split.sh, scripts/test-cron-runner-overseas-universe.sh, src/app/api/cron/daily-bars/route.ts, src/app/api/cron/daily-bars/__tests__/route.test.ts, src/lib/profit-engine/__tests__/isolation.test.ts)**

## QA

- [19:21] 실행 도구: claude (qa 서브에이전트). 코드·테스트 파일은 고치지 않았다. 커밋·push·stash·reset·브랜치 전환 없음. 무거운 시험은 공유 잠금(`/tmp/stockinvest-heavy-tests.lock`)과 nice 로 돌렸다.
- [19:21] 1. 새 시험 `scripts/test-cron-runner-call-body.sh` 를 worktree 에서 직접 재실행(QA 가 직접 실행): ok 20 · fail 0 · exit 0. 로그 `~/.node-local/t172-qa/qa-new-call-body.log`.
- [19:21] 2. 민감도(직접 실행): (a) 기준 ref 러너(`683a5dc`)를 `T172_RUNNER` 로 주면 fail 6 · exit 1. (b) 기본값 줄을 `body_default={}}` 로 바꾼 변이 사본을 만들어 주면 fail 6 · exit 1. 변이 사본 `qa-mut.sh` 는 실행 뒤 삭제했다(삭제 확인). 두 번째 시도는 grep 인용 오류로 변이 사본이 안 만들어져 실행하지 않았고, python 으로 다시 만들어 돌렸다.
- [19:21] 3. 개발자 로그 대조(QA 가 직접 비교, 재실행 아님): 양쪽에 공통인 로그 12개의 정렬된 ok/FAIL 줄을 비교. 양쪽 FAIL 0개(어느 쪽에도 실패 없음). 고치지 않은 5개(alert-ticker 106 · m40-forecast 0 · m40-forward 0 · pmo-retry 76 · stop-alert 23)는 줄 단위로 같다. 고친 7개(daily-bars 84/83 · daily-bars-kr 72/71 · holdings-premarket 55/54 · job-run-log 213/212 · news-peek 83/82 · news-split 121/120 · overseas-universe 31/30)는 차이가 (가) 라벨 문구 변경 (나) 「(T-172) no_t172 가 노리는 두 줄 = 파일 전체 각 1개 · 모두 call() 안 · 옛 줄 0」 단언 1개 추가뿐이다. 기준 쪽 단언이 빠진 것은 없다(제거된 줄 전부 같은 뜻의 relabel 짝이 새 쪽에 있다). daily-bars-kr 의 K1·K6 는 라벨 변경 외에 K6 비교 대상에 `no_t172` 정규화가 들어간 것으로, diff 로 확인했다(기대값 `{} {} ` 는 그대로).
- [19:21] 3-b. 로그 mtime: 신규 쪽 15:08:31 ~ 17:03:43, 기준 쪽 17:06:23 ~ 19:01:35. 모두 2026-11-15 15:05–19:02 범위 안.
- [19:21] 4. 수정된 러너 시험 재실행(QA 가 직접, lock 아래): `test-cron-runner-news-split.sh` → 결과 ok 121 · fail 0 · exit 0, 「E: (T-172) no_t172 …」 단언 ok. `test-cron-runner-daily-bars.sh` → ok 84 · fail 0 · exit 0, 「D6: (T-172) no_t172 …」 단언 ok. 로그 `qa-new-news-split.log`·`qa-new-daily-bars.log`.
- [19:21] 5. jest 재실행(QA 가 직접, lock 아래): `route.test.ts` + `isolation.test.ts` → Tests 96 통과 · 3 실패 · 99 전체. 실패 3개 이름(매매 경로 → profit-engine 「daily_bars 테이블 참조 0건」, profit-engine import 허용 목록, 「@/lib/strategy」 참조 0건)이 기준 쪽 jest 로그의 실패 3개와 정렬 diff 로 완전히 같다. T-171 표 71·72행 사용자 결정 대기 항목과 일치. 로그 `qa-new-jest.log`, 기준 `jest-base.log`.
- [19:21] 6. 정적 점검(QA 직접): `local body="${3:-{}}"` 가 cron-runner.sh 에 0개. call() 안 T-172 줄은 `body_default={}` 와 `body="${3:-$body_default}"` 각 1개. call 호출 28줄 중 본문(셋째 인자)을 넘기는 줄 0개 — 모두 경로·라벨 2개 인자뿐. `git diff --stat` 은 예상한 13개 파일(러너 1 · 러너 시험 7 · 라우트·테스트 2 · 수집기·요청 파서 2 · isolation 1), 미추적은 새 시험·task 파일·node_modules 심볼릭 링크뿐.
- [19:21] 미검증·남은 위험: (가) 운영 배포 전 실제 cron 호출 경로는 확인하지 않았다(본문을 넘기는 잡이 없으므로 운영 동작은 바이트 동일로 정적·시험으로만 확인). (나) 기준 ref 와의 비교 시험 7개는 call() 줄 변경에 묶여 있어 reviewer 가 짚은 LOW 유지보수 비용(긴 라벨 문구 의존)은 그대로 남는다. (다) jest 3건의 경계 위반은 T-172 와 무관하며 사용자 결정 대기다.
- [19:21] 판정 근거: 실매매 안전장치 영향 경로(주문·거래소·cron 호출)의 동작 변화 없음, 고침 시험과 민감도 확인, 수정 시험 재실행 모두 fail 0, jest 실패 집합 기준과 동일.
- [19:21] **최종 판정: PASS**

## 배포 기록

| 시각(KST) | 커밋 | 방식 | 포함 작업 | 결과 |
|---|---|---|---|---|
| 2026-11-15 19:34:08 push → 19:34:15 START → 19:35:05 END | `80ac44b` | `git push origin 80ac44b:main`(서버 clone worktree `stockinvest-t172`) → webhook blue/green | T-172 만(직전 배포 `4e34cd7` 뒤 새 커밋은 이것 하나) | 성공 — `RELEASE_RESULT status=ok`, 릴리스 `20261115-193418-80ac44bd`(이전 `20261115-151542-4e34cd7d`), `migrated=false`, 헬스체크 정상 |

- [19:3x] 실행: claude(메인 세션이 deployer 를 겸함). 사용자 승인("Yes, push") 뒤 push 전 점검 — origin/main 대비 앞선 커밋 `80ac44b` 하나·뒤처짐 0, origin 버전 0.12.0, `bash scripts/git-refs-clean.sh --check` 깨끗함, 직전 배포(`4e34cd7`) END exit=0 으로 진행 중 배포 없음.
- [20:5x] push 명령의 출력은 세션이 끊겨 기록되지 못했다. 그래서 결과를 따로 확인했다 — 서버 clone 의 `refs/remotes/origin/main` reflog 에 `80ac44b … 19:34:08 update by push`, webhook 로그 `START sha=80ac44b`(19:34:15) → `END exit=0`(19:35:05). 같은 사실을 부모 세션(「국내 일봉(daily_bars) 수집 중단 원인 조사」)도 20:53 에 독립 확인해 알려 왔다.
- [20:5x] 배포 뒤 확인: `current` → `releases/20261115-193418-80ac44bd`, 배포된 `scripts/cron-runner.sh` 에 `# T-172` 줄 있음·옛 `${3:-{}}` 줄 0, `package.json` 0.13.0. pm2 `stockinvest`·`stockinvest-cron` 둘 다 online(새 릴리스 경로, 재시작 0). cron 로그 19:35~20:54: 잡 줄 모두 `OK`, 예외는 `m40-forward ACCEPTED completed=false`(비동기 접수 표시) 1건과 20:45 job-run-log 기록 전송 timeout(HTTP 503) 1건 — 후자는 1분 뒤 「전송 회복」, call() 이 아니라 기록 전송 경로이고 오늘 배포 전에도 9번 있었던 현상이다.
- 실매매 영향: 없음(주문·청산·승인 경로·스위치 변경 없음).

## 실행 도구·절차 이력

| event | 시각 | 종류 | 도구 / 절차 | 범위 | 근거 |
|---|---|---|---|---|---|
| E1 | 2026-11-15 08:4x | start | claude / claude_standard | 조사·설계부터 구현·감사·QA·커밋까지 | 부모 세션(Claude 「daily-bars」)이 넘긴 작업 지시 |

## 최종 요약

### [T-172] cron 러너가 요청 본문을 넘기면 끝에 } 가 하나 더 붙던 결함 고침

- **상태**: 완료 · 운영 배포 완료(2026-11-15 19:35 KST).
- **무엇이 바뀌었나**: `scripts/cron-runner.sh` 의 `call()` 이 셋째 인자(요청 본문)를 받으면 끝에 `}` 를 하나 더 붙이던 줄(`local body="${3:-{}}"`)을 두 줄(`local body_default='{}'` + `local body="${3:-$body_default}"`)로 고쳤다. 본문이 없거나 빈 값이면 예전처럼 `{}`, 있으면 그대로 보낸다. 지금 러너에는 본문을 넘기는 호출이 하나도 없어(28개 모두 경로·라벨 2개 인자) **운영 동작은 바이트 단위로 같다** — 다음에 본문을 넘기는 잡을 만들 때 깨지지 않게 미리 고친 것이다. 새 회귀 시험 `scripts/test-cron-runner-call-body.sh`(실제 call() 을 가짜 curl 로 돌려 본문을 확인). call() 을 이전 커밋과 줄 단위로 비교하는 러너 시험 7개에 이 두 줄을 되돌려 비교하는 도우미와 「되돌리는 줄이 엉뚱한 곳에 없다」 단언을 더했다. 「call() 은 결함이 있다」고 현재형으로 쓴 주석 6곳을 과거형으로 바꿨다. 버전 0.12.0 → **0.13.0**.
- **배포**: 커밋 `80ac44b` · 2026-11-15 19:34 push → 19:35:05 webhook blue/green 배포 성공(릴리스 `20261115-193418-80ac44bd`, DB 변경 없음). 같은 배포에 실린 다른 작업: 없음.
- **실매매 영향**: 없음 — 주문·청산·승인 경로와 스위치를 건드리지 않았다. cron 잡의 현재 호출은 curl 인자·본문이 이전과 같다(새 시험 B2·B3 이 고정).
- **AI 가 검증한 것**: 새 시험 20/20 통과, 고치기 전 러너와 일부러 망가뜨린 변이 모두 실패로 잡음(각 6건) · 러너 시험 13개 전체를 고친 쪽과 기준(`683a5dc`) 양쪽에서 실행해 실패 0, 단언 이름 대조 차이는 라벨 문구와 시험마다 추가 단언 1개뿐 · jest 2개는 기준과 같은 결과(96 통과·3 실패, 실패 3개는 [[T-171-baseline-failing-tests-triage]] 71·72행의 기존 경계 위반으로 T-172 와 무관) · Reviewer PASS · QA PASS(재실행 포함).
- **AI 가 검증한 것(배포 뒤)**: 운영 릴리스에 고친 call() 이 들어감 · 웹·cron 프로세스 정상 · 배포 뒤 1시간 20분 동안 cron 잡 모두 OK(기록 전송 timeout 1건은 1분 뒤 회복, 기존 현상).
- **AI 가 못 한 것**: 본문을 넘기는 실제 잡이 아직 없어 고친 경로(셋째 인자 있음)는 운영에서 실행된 적이 없다 — 시험으로만 확인. Codex 외부 검토는 서버 모델 설정 오류로 생략.
- **👉 사용자가 확인할 것**: 없음 — 화면·알림 변화가 없다.
- **👉 사용자가 결정할 것**: 없음.
- **남은 일**: 없음. 이 배포 기록을 담은 문서 커밋은 push 하면 다시 배포되므로 사용자 승인 뒤 push 한다.
- **이슈·위험**: LOW — call() 의 새 주석 문구 전체가 시험 8개 파일에 그대로 들어 있어 그 주석을 고치면 8개를 함께 고쳐야 한다(동작 영향 없음, Reviewer 지적·수용). isolation 시험의 기존 실패 3건은 T-171 의 사용자 결정을 기다린다.
- 로드맵: 기능 추가가 없는 내부 결함 고침이라 `roadmap.md` 는 바꾸지 않았다.
