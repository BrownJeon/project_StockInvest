---
task_id: T-121
title: 시스템 Node 20→24 전환 영향 정리 — 골든 시험 1건 실패 + 다음 배포부터 StockInvest 가 Node 24 로 기동
status: deployed
priority: medium
project: StockInvest
created: 2026-10-29
updated: 2026-10-29
base_ref: 0761fec
risk_level: R1
roles_involved: [leader, developer, reviewer, qa, deployer]
related_tasks: [T-117-daily-bars-cron-registration, T-062-card-ui]
tags:
  - type/task
  - domain/infra
  - domain/test
aliases:
  - Node24전환
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

# T-121 시스템 Node 20→24 전환 영향 정리

## 목표·배경 (Leader)
- 2026-10-29 사용자가 PC 를 업데이트하면서(08:35 전후) 시스템 Node 가 **20.20.2 → 24.22.2** 로 바뀌었다 [가능성 높음 — `node -v`=24.22.2, `dpkg -l nodejs`=24.22.2-1nodesource1, `/usr/lib/node_modules/corepack` 변경 08:35. 정확한 업그레이드 시각은 확인 못 함].
- 07:18 재부팅 때 기동한 `stockinvest`·`stockinvest-cron` 은 **아직 Node 20.20.2 로 돌고 있다**(`pm2 jlist` 09:3x 실측). 같은 서버에서 그 뒤에 재시작된 `odinue`·`theroute-api`·`bjj`·`webhook-deploy` 는 이미 24.22.2 다. 즉 **webhook 배포가 `next build` 와 재기동을 Node 24 로 하게 된다.** 이번 오늘 배포(T-117 → T-118/T-119)가 StockInvest 의 첫 Node 24 기동이 된다.

## 확인된 영향 (실측)
1. 전체 jest(Node 24, maxWorkers=3): 302 스위트 중 1 실패 — `src/components/__tests__/scenario-card-domestic-golden.test.ts` "국내 3장 → 정렬 라벨 바". 기준 트리에서도 동일 재현(T-117 무관). 골든 `진입 가능: 10. 21. AM 12:00 KST` 대 실제 `오전 12:00 KST`. 원인 코드 `src/components/dashboard/Dashboard.tsx:1164` (`toLocaleString('ko-KR', …, hour:'2-digit')`).
2. tsc `--noEmit` 은 Node 24 에서 통과(10:15 실측, T-117 QA 보강 — 06:47 의 통과는 업그레이드 08:35 전이라 Node 20 결과였다). 러너 쉘 시험·훅 시험 전부 통과. 같은 시험 파일 A/B: 골든 시험은 Node 20.20.2 에서 7/7 통과, Node 24.22.2 에서 6/7 — 원인이 런타임임을 실측으로 확정했고, Node 20 으로 돌린 전체 jest 는 8429 통과·0 실패다.
3. **확인 못 한 것**: `next build` 와 운영 런타임(mysql2·Next 15.5.27) 의 Node 24 동작. blue/green 이라 build 실패는 컷오버 전에 중단되어 운영 영향이 없다(release.sh 의 build → 헬스체크 → 컷오버 순서). 컷오버 뒤 런타임 문제는 헬스체크와 첫 크론 틱으로 관측한다.

## 결정이 필요한 것 (Leader 권고)
| 항목 | 선택지 | 권고 |
|---|---|---|
| 골든 시험 | (a) 골든을 "오전"으로 갱신 (b) 시각 서식을 로케일 독립으로 고정 (c) 둔다 | **(b) 또는 (a)** — 화면 문구가 `AM`→`오전` 으로 바뀌는 것은 사용자 가시 변화이므로 (b) 로 현행 표기 유지 여부는 사용자 확인. 이 건은 화면 구조 변경이 아니라 표기 고정이라 데모 게이트 대상 아님 [추측 — judge 접수에서 확정]. 우선순위 낮음 |
| 운영 Node | (a) Node 24 로 간다 (b) 20 으로 고정 | **(a)** — 다른 4개 앱이 이미 24 로 정상. 단 첫 배포에서 build·헬스체크 결과를 Deployer 가 기록한다(T-117 Deployer 조건 (f)) |
| 나머지 앱 | 재시작 때마다 24 로 바뀐다 | 정보 — `thecareer`·`themeal`·`voicevault`·`thekaiwa`·`thethinker` 는 아직 20.20.2 로 돌고 있어 다음 재시작 때 24 로 바뀐다(HOME-SERVER 세션 소관, 알림만) |

## 진행 기록
- [2026-10-29 09:32] T-117 QA 보류 해소 중 발견·재현 확인(Leader). 코드 변경 없음, 미착수. 사용자 지시 "승인 묻지 않고 진행"에 따라 시험 수정은 T-117·T-118·T-119 배포 이후 judge 접수 → Developer → Reviewer → QA 로 처리한다.

- [2026-10-29 10:16] 업그레이드 근거 보강(QA): `/var/log/apt/history.log` 08:35:01 `Commandline: apt-get install -y nodejs`, `Requested-By: brownjeon (1000)`, nodejs 20.20.2-1nodesource1 → 24.22.2-1nodesource1(End 08:35:05). 위 「목표·배경」 의 "PC 업데이트"는 추정이다 — apt 로그로는 누가(사용자 직접·에이전트 세션) 실행했는지 알 수 없다. 사용자 확인 후보. 코드 변경 없음.
- [2026-10-29 11:20] **Node 24 전환 전체 점검(사용자 요청, 서버 읽기 전용 + 격리 시험 빌드, 변경 0)** — 업그레이드는 **사용자 본인이 실행**했다고 확인(채팅; apt 08:35 `apt-get install -y nodejs`)하여 위 "추정" 표기를 확정으로 바꾼다. ① 기본 Node 24.22.2·npm 11.19.1·OpenSSL 3.5.9·ICU 78.3, pm2 CLI 6.0.14(데몬은 아직 삭제된 Node 20 바이너리). ② pm2 앱: Node 24 구동 10개(odinue·theroute-api·thecareer·themeal·voicevault·bjj·thekaiwa·thethinker·webhook-deploy·n8n), Node 20 구동은 stockinvest·stockinvest-cron(bash 러너라 무관) 외 python 3개. ③ 헬스 전부 정상(200/307). ④ 네이티브 linux gnu x64 전부 로드 OK(타 플랫폼·musl 오류는 무관), 홈 `node_modules` 의 ssh2·cpu-features 만 Node 20 ABI(선택 가속 모듈). ⑤ mysql2→MariaDB 10.11.11 OK, TLS(KIS·SEC·환율) Node 20/24 동일. ⑥ 시장 시간 판정 패턴 9종×9시각 Node 20/24 동일, 달라지는 것은 12시간제 ko-KR 표기(`AM/PM`→`오전/오후`)뿐. ⑦ odinue 09:29 시작 실패 흔적(swc 매핑 실패 → 10:28 파일 재생성 → 10:35 Ready, 원인 미확정). ⑧ **StockInvest 시험 빌드(커밋 159c4a7, Node 24, 별도 폴더·`.env` 없음·서버 미기동): `npm ci` exit 0(642 패키지), `next build` exit 0(컴파일 8.4초, 타입 검사 포함, BUILD_ID 생성)** — npm 11 설치 스크립트 경고(allowScripts)만 있고 sharp·@swc/core·next-swc 로드 OK. 미검증: `.env` 포함 빌드·런타임 기동·운영 부하, 다른 앱의 Node 24 빌드. 로그 `~/.node-local/t117-qa/node24-*.log`, 시험 폴더는 삭제함.

## 착수 조건·절차 (대기 중 — 2026-10-29 사용자 지시: "T-118·T-119 를 다른 세션이 끝낸 뒤 자연스럽게 이어서 작업")

**왜 기다리나** (10:55~11:05 실측)
- T-118·T-119 worktree 의 변경 파일(`cron-runner.sh`, `scripts/test-cron-runner-*.sh`, `src/lib/corp-intel/*`, `src/app/api/cron/news-fetch/*`, `holdings-premarket/*`)과 T-121 후보 파일(`Dashboard.tsx:1164`, `src/lib/time.ts`, 골든 시험·픽스처)은 **겹치지 않는다** → 코드 충돌은 없다. 기다리는 이유는 ① **서버 시험 락 경쟁**(락 대기열 4건, 전체 jest ≈14분·tsc ≈9분이 T-118·T-119 QA 를 밀어낸다)과 ② 오늘 15:40~20:00 push 창 안에 T-118·T-119 의 Reviewer·병합·Codex·QA 를 마쳐야 하는 일정이다.
- 골든 실패는 표시 문구(`AM`→`오전`)만 바뀌는 것이고 시장 시간 판정 패턴 9종은 Node 20·24 결과가 같다(10:4x 실측) → 급하지 않다. `Dashboard.tsx` 는 `'use client'` 라 사용자 브라우저(Chrome)가 이 문구를 그릴 가능성이 높다 [가능성 높음 — 이 탭 데이터가 서버 선렌더(SSR)에 들어가는지는 미확인]. 그렇다면 사용자 화면은 Node 업그레이드 전후 같다.

**착수 조건 (전부 참일 때)**
1. T-118·T-119 task frontmatter `status: done`(또는 `## 최종 요약` 작성) — 두 task 모두.
2. 두 작업의 커밋이 `origin/main` 에 있다(`git log origin/main --oneline | grep -E "T-118|T-119"` 각각 1건 이상) 또는 사용자가 다음 창(10-30 05:10~06:50)으로 이월을 확정했다.
3. 서버 시험 락 대기열에 `stockinvest-t118|t119|m118|m119`(m118·m119 = 병합 후보 worktree, 11:53 에 생긴 것을 확인) worktree 시험이 없다(`ps -eo args | grep "flock /tmp/stockinvest-heavy"` 와 해당 프로세스 cwd 확인).
- 오늘 창에 못 끝나면 10-30 배포 뒤로 자연히 밀린다. 조건이 거짓인 동안 T-121 코드·시험은 시작하지 않는다(읽기 전용 조사는 가능).

**절차**
1. judge 접수(Jev) — 유형·복잡도·데모 필요 여부 판정(표기만 고정 → none 예상 [추측], 화면 구조 변경 아님).
2. 결정 기본값 — 골든: **(a) 골든을 Node 24 출력(`오전`)에 맞춘다**. (b) 로케일 독립 고정은 사용자 가시 표기를 유지해야 할 근거가 나올 때만. 사용자 화면의 문구가 실제로 바뀐다고 확인되면 구현 전에 사용자에게 묻는다.
3. Developer — **별도 worktree** `~/.node-local/stockinvest-t121`(그 시점 `origin/main` 기준 새로 생성). 수정은 골든 픽스처·시험 1~2개(필요 시 `Dashboard.tsx:1164`). 시험은 전부 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10`, 먼저 골든 1파일 jest, 전체 jest(Node 24, `--maxWorkers=3`)는 마지막 1회.
4. Reviewer → QA(Node 24 에서 전체 jest 0 실패 확인) → 로컬 커밋(명시 경로만, `node_modules` 링크 스테이징 0 확인).
5. push 는 새 배포가 필요하므로 **다른 묶음과 섞지 않고** 15:40~20:00 창(또는 05:10~06:50)에 단독으로. 이 push 는 사용자 확인 후 한다(기존 위임은 T-117·T-118·T-119 에 대한 것이었다).
- 이 task 범위 밖: `thecareer`·`themeal`·`voicevault`·`thekaiwa`·`thethinker`·`odinue` 등 다른 앱의 다음 배포는 각각 첫 Node 24 빌드가 된다(HOME-SERVER 소관, 알림만).

**자동 점검**: 이 세션에 예약이 하나 있다(매일 08:23~20:23 사이 3시간마다 :23, 세션 전용·7일 후 만료). 조건이 거짓이면 한 줄만 남기고, 참이면 위 절차 1 부터 시작한다. 세션이 끝나 예약이 사라지면 새 세션이 위 착수 조건을 직접 확인하고 시작한다.
- [2026-10-29 13:55] **사용자 확인**: Node 20→24 업그레이드는 사용자가 오전에 **다른 세션에서 의도해 진행한 정상 작업**이며 그 세션에서 검증도 끝났다("버전 업그레이드는 내가 오전에 다른 세션에서 진행했으며 정상적인 작업"). 위 「목표·배경」의 "원인 불명/주체 미확인" 표현은 이로써 해소 — 의도된 변경이다.
- [2026-10-29 13:51~13:58] **첫 Node 24 배포 결과(T-117·T-118·T-119 한 번에)**: 릴리스 `20261029-134931-5ca78174` build·헬스체크 ok(`next build` 가 Node 24 에서 성공), `stockinvest`(Next 15.5.27) **Node 24.22.2 로 정상 기동·restarts 0**, `/api/health` 200, `stockinvest-cron`(bash 러너, pm2 node_version 표시는 데몬 값 20.20.2 — 러너는 Node 를 쓰지 않음) 매분 틱 정상. 위 「확인 못 한 것」 3번(`next build`·운영 런타임 Node 24 동작)은 **해소**. 남은 것: 골든 시험 1건(`scenario-card-domestic-golden`, `AM 12:00`↔`오전 12:00`) 정리 — 배포와 무관한 시험 정리라 우선순위 낮음, judge 접수 후 Developer→Reviewer→QA.

- [2026-10-29 14:12~14:45] **착수·구현·검증 완료(Leader)**: 사용자 지시("T-118·T-119 작업은 완료했으니 T-121 부터 이어서")로 착수. 착수 조건 3개 확인(T-118 done·T-119 deployed+최종 요약, 두 커밋이 `origin/main` 에 있음, 락 대기열 비어 있음 — 13:49 배포로 T-117 도 함께 나갔다). judge intake(규칙 엔진 fallback: Jev 예산 창 만료) → Developer(픽스처 Node 24 재생성) → Reviewer PASS → QA 통과 → 로컬 커밋 `c872f6f`(미배포). 결정 기본값 (a) 로 진행: 운영 소스 불변, 시험 픽스처 1개만 변경. 자세한 내용은 아래 각 절·최종 요약.

## 판단 기록 (judge)

- [2026-10-29 14:16] intake engine=rules → task_type=null · risk=R1 · developer_model=opus · next=demo_first · demo=delta/designer(DM-kw-delta) · actions=prepare_demo,request_demo_approval,assign_developer | overrides=MD-judge-failed-opus,DM-kw-delta | fallback=budget_window_closed | tokens=0
- [2026-10-29 14:18] intake [재실행] engine=rules → task_type=null · risk=R1 · developer_model=opus · next=assign · demo=none/- · actions=assign_developer | overrides=MD-judge-failed-opus | fallback=budget_window_closed | tokens=0 | 재실행 사유: 첫 판정의 demo delta(DM-kw-delta)가 요약 속 부정문 '화면 구조 변경 없음'의 문자열에 걸린 오탐이라는 Leader 판단. 요약 문구만 Leader 지정으로 교체, changed_paths·사실관계는 동일

## Developer
- [14:19] 착수: 서버 `node -v`=v24.22.2·ICU 78.3 확인. 작업 폴더 `~/.node-local/stockinvest-t121`(origin/main `5ca7817` detached), 시험 락 대기 0. 데모 게이트 `check.mjs check` 첫 두 줄 `DEMO_GATE_BLOCKED` / `task: T-121`(frontmatter 에 demo_gate 없음) — 단 변경 파일은 `projects.mjs isUiPath()`=false(`**/__tests__/**` 제외 규칙)라 화면 파일이 아니다. 운영 소스·주문 경로 변경 없음 → 안전장치 self-check 해당 없음.
- [14:20] 기준선(Node 24, flock 1파일): 6/7 — 실패 1건 "국내 3장(이미 평가등급순 입력) → 정렬 라벨 바 + 진입줄 style 외 동일", 기대 `진입 가능: 10. 21. AM 12:00 KST` 2곳 대 실제 `오전 12:00 KST`. 배정 설명과 같음. 로그 `~/.node-local/t121/baseline-golden.log`.
- [14:22] 재생성(픽스처 머리말 절차 재현, 손으로 고치지 않음): `git archive 7cd47e7 src jest.config.js package.json tsconfig.json` → 스크래치 `~/.node-local/t121-golden/head`, `Dashboard.tsx` 1024행 `function TomorrowScenarioTab(` 앞에 `export` 한 단어만(원본과 diff 1줄 확인). 입력·`host-sim.ts` 는 현 worktree 사본(0e9991c 이후 변경 없음), mock 6개·`useForeignHost()`·`globalThis.React` 는 골든 시험 파일과 같게 둔 생성 시험으로 `renderToStaticMarkup`(7cd47e7 자체 jest 설정). React·react-dom 18.3.1(7cd47e7 lock 과 같음), @swc/jest 0.2.37. 로그 `~/.node-local/t121/regen-golden.log`, 생성·비교·조립 스크립트 `~/.node-local/t121/gen-scripts/`.
- [14:22] 바이트 비교(문자 단위, `~/.node-local/t121/compare.log`): `HEAD_CARDS[0..4]`·`HEAD_TOMORROW_EMPTY` 바이트 동일. `HEAD_TOMORROW` 만 차이 2곳(UTF-16 위치 1064·1960, 둘 다 `진입 가능: 10. 21. ` 바로 뒤) `AM`→`오전`, 그 밖 차이 0(UTF-8 2733→2741바이트). 기존 리터럴 7개는 모두 `JSON.stringify(값)` 과 파일 안에서 정확히 1회 일치 → 리터럴 교체는 재생성 값의 `JSON.stringify` 로 1곳만.
- [14:23] 변경 파일 1개 `src/components/__tests__/fixtures/t062-domestic-golden-head.ts`(+7 −2): ① 머리말 7행 `AM 12:00`→`오전 12:00` ② 8행 뒤 재생성 설명 5줄(2026-10-29·Node 24.22.2/ICU 78.3·차이 2곳·나머지 바이트 동일·Node 20 에서는 `AM 12:00` 으로 그려져 1건 실패) ③ `HEAD_TOMORROW` 리터럴. 시험 파일·입력 파일·`Dashboard.tsx` 변경 없음.
- [14:23] 검증: 골든 시험 7/7 통과(Node 24, flock, `~/.node-local/t121/after-golden.log`). eslint 는 프로젝트에 설정 파일이 없어 실행 불가(`eslint` exit 2 "couldn't find a configuration file", `~/.node-local/t121/eslint.log`) — 린트는 못 했다. 대신 TypeScript 5.5.3 `transpileModule` 구문 진단 0(`~/.node-local/t121/syntax-check.log`). `git status`: 변경은 픽스처 1개 + untracked `node_modules` 링크, 스테이징 0. 커밋·push·stash 안 함. 전체 jest·tsc 는 실행 안 함(QA 몫).
- [14:24] 정리: 스크래치 `~/.node-local/t121-golden/` 삭제(안의 `node_modules` 링크를 먼저 unlink, NFS `node_modules` 무사 확인). 로그·스크립트는 `~/.node-local/t121/` 에 남김.
- [14:25] 남은 위험: (1) 이 골든은 이제 Node 24 ICU 기준 — Node 20 환경에서 돌리면 같은 1건이 반대로 실패한다. (2) 시험이 고정하는 `오전 12:00` 은 host-sim(UTC·ko-KR) 아래 시험용 표기라 사용자 브라우저 화면의 표기를 보증하지 않는다(그 줄이 UTC 벽시계에 KST 를 붙이는 기존 표시 문제는 범위 밖, 그대로). (3) 생성 시험은 골든 시험 파일의 mock·흉내 구성을 옮긴 것이라, 2026-10-21 원 생성 때 쓴 하네스와 완전히 같은지는 기록이 없어 확인 못 했다 — 다만 결과가 6개 리터럴 바이트 동일·차이 2곳 예상대로라 동등하다고 본다.

## Reviewer
- [14:35] 범위·방법: 서버 worktree `~/.node-local/stockinvest-t121`(HEAD `5ca7817`)의 working-tree `git diff` 와 연관 파일을 독립 검토했다. 읽기 + 격리 스크래치 재현(`~/.node-local/t121-review/`, 끝나서 삭제)만 했고 코드·시험·픽스처 수정 0, commit·push·stash 0, pm2 명령·DB·다른 worktree 접근 0. 증거 요약 `~/.node-local/t121/review-evidence.log`, 골든 실행 로그 `~/.node-local/t121/review-golden-node24.log`. (공개: Node 20.20.2 재현용으로, 08:35 apt 업그레이드 때 파일은 지워졌지만 기존 프로세스가 쥐고 있는 바이너리 이미지를 `/proc/<pid>/exe` 에서 스크래치로 복사해 실행했다 — 읽기 전용 복사이며 해당 프로세스에는 영향이 없다.)
- [14:35] [확실] 항목1 diff 범위: 변경 파일은 `src/components/__tests__/fixtures/t062-domestic-golden-head.ts` 1개(+7 −2)뿐이고 스테이징 0. 리터럴 바이트 비교(HEAD blob 대 working tree): `HEAD_CARDS[0..4]`·`HEAD_TOMORROW_EMPTY` 는 바이트 동일, `HEAD_TOMORROW` 는 UTF-16 위치 1064·1960 두 곳의 `AM`→`오전` 뿐이며 `old.replaceAll('AM 12:00','오전 12:00') === new` 가 참(UTF-8 2733→2741바이트). 리터럴 밖 변경은 머리말 주석뿐(7행 `AM`→`오전` 1줄 교체 + 설명 5줄 추가).
- [14:35] [확실] 머리말 서술 대조: 날짜(2026-10-29)·Node 24.22.2/ICU 78.3(`process.versions.icu` 실측)·"2곳"·"나머지 리터럴 바이트 동일"·"Node 20(20.20.2)에서 `AM 12:00` 으로 그려져 '내일' 탭 시험 1건 실패" 모두 실측과 일치한다. Node 20.20.2 이미지(ICU 78.2/CLDR 48.0)로 골든 시험을 돌리면 6/7 이고 실패는 그 1건뿐이다. 정밀도 지적 1건은 아래 L-1.
- [14:35] [확실] 항목2 재생성 충실도(독립 재현): `git archive 7cd47e7`(src·jest.config.js·package.json·tsconfig.json) → `Dashboard.tsx:1024` 선언 줄에 `export` 한 단어만 추가(순정본 대비 diff 정확히 1줄) → 골든 시험 파일의 mock 6개·`useForeignHost()`·`globalThis.React` 를 그대로 옮긴, 내가 새로 쓴 렌더 시험(Developer 의 `regen.test.ts` 미사용)을 7cd47e7 자체 jest 설정으로 실행. 결과 — Node 24.22.2: 7개 리터럴 전부 새 픽스처와 일치(기존 픽스처와는 `HEAD_TOMORROW` 만 불일치). Node 20.20.2: 7개 리터럴 전부 기존(HEAD) 픽스처와 일치(새 픽스처와는 `HEAD_TOMORROW` 만 불일치). 즉 10-21 원 골든이 Node 20.20.2 산출물이었다는 점과 이번 재생성 하네스가 원 생성 하네스와 출력 동등하다는 점이 둘 다 확인돼, Developer 가 남긴 "원 하네스와 같은지 확인 못 함" 위험 (3)은 해소된다. 입력·`host-sim.ts` 는 커밋 `0e9991c` 본과 바이트 동일(`cmp`), react·react-dom 18.3.1·jest 29.7.0·@swc/jest 0.2.37 은 7cd47e7 과 현재가 같다(7cd47e7 이후 `jest.config.js` 에 `setupFilesAfterEnv` 가 추가됐으나 7cd47e7 자체 설정을 써서 무관).
- [14:35] [확실] 시험 의도 보존(골든은 HEAD 출력이지 현재 코드 출력이 아님): 재생성은 7cd47e7 의 `Dashboard.tsx`·`ScenarioCard.tsx` 로 했다. "진입 가능" 서식 코드 `new Date(sig.valid_from).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })` 는 `7cd47e7:Dashboard.tsx:1121` 과 현재 `Dashboard.tsx:1164` 가 글자 그대로 같다 — 따라서 `AM`→`오전` 은 코드 회귀가 아니라 순수 런타임(ICU) 차이다.
- [14:35] [확실] 항목3 파급: 픽스처를 import 하는 곳은 `scenario-card-domestic-golden.test.ts` 1곳(grep, node_modules·.git·.next 제외; 나머지는 주석·vault 문서)이다. 골든 시험 파일·`t062-domestic-golden-inputs.ts`·`host-sim.ts`·`Dashboard.tsx`·`ScenarioCard.tsx` 는 HEAD 와 diff 없음. 운영 소스 변경 0, 픽스처는 `__tests__/` 아래라 `tsconfig.json` exclude 대상이고, 이 저장소의 `scripts/*.sh`·`scripts/git-hooks`·`.github` 에는 jest 를 배포·커밋 게이트로 호출하는 곳이 없다(워크스페이스 공용 deploy.sh·release.sh 는 저장소 밖이라 미확인). untracked 는 `node_modules` 심볼릭 링크(→ NFS 절대경로) 하나뿐이고 스테이징된 것은 없다. 내 실행 뒤에도 `git status` 는 같고(수정 1 + untracked 1) 픽스처 sha256 은 불변이다.
- [14:35] [확실] SAFETY_PATHS 해당 여부: `awk '/^SAFETY_PATHS=\(/,/^\)/' scripts/git-hooks/commit-msg` 에서 76개 패턴을 추출해 대조했다(양성 대조 `src/lib/safety/dry-run.ts` 는 매치 확인). 이 픽스처 경로는 매치 0 이라 커밋 훅의 Reviewer 판정 요구 대상은 아니다(이 기록은 task 규약상 수행).
- [14:35] [확실] 항목5 실행: 지정 명령대로 골든 시험 1파일을 서버 Node 24.22.2 에서 실행 — 7/7 통과, exit 0, 0.16초(`~/.node-local/t121/review-golden-node24.log`). 전체 jest·tsc 는 실행하지 않았다(QA 몫).
- [14:35] 항목4 시험 의도 의견(채택은 Leader 판단): [가능성 높음] 이번 선택(골든을 Node 24/ICU 78.3 출력에 고정)은 허용 가능하다. 근거 ① 이 토큰은 코드가 아니라 로케일 데이터가 정하고, 이 줄의 서식 코드는 HEAD 와 같아 정규화해도 잃는 회귀 감지력이 사실상 없다 — 반대로 고정하면 바이트 엄격성이 유지된다. ② 새 값 `오전` 이 장기적으로 더 안정적인 쪽일 가능성이 높다 — 서버에 남은 ICU 70.1·72.1·73.1·73.2·75.1(Node 16·18·20.15.1)과 78.3 은 모두 `오전` 이고 `AM` 은 ICU 78.2(Node 20.20.2, Mac 의 Node 22.22.0)에서만 관측했다(ICU 76·77 은 미관측). ③ 변경이 픽스처 1개·시험 로직 0 이라 되돌리기 쉽다. 한계: (a) 같은 CLDR 48.0 인데 ICU 패치(78.2→78.3)로 출력이 바뀌었으므로 골든은 ICU 패치 단위로 다시 깨질 수 있다 — Mac 에서 jest 를 로컬로 돌린다면(Node 22.22.0/ICU 78.2) 새 골든이 반대로 실패할 가능성이 높다(실행은 안 해 봄). (b) 재생성마다 같은 수작업 절차가 든다. 대안 비교: 시험이 `(AM|PM|오전|오후)` 를 정규화해 비교하거나 같은 `Intl` 호출로 기대 토큰을 계산하면 ICU 에 무관해지지만, 시험 파일 수정이 필요하고 "골든은 HEAD 렌더 바이트" 원칙을 그 토큰 한정으로 느슨하게 만든다. 이번 변경을 막을 사유는 아니며, 같은 ICU 흔들림이 재발하면 정규화로 전환하길 권한다(그때는 시험 파일 수정이라 Reviewer 재감사 대상).
- [14:35] 발견 사항(심각도 순, critical 0 · high 0 · medium 0 · low 3). L-1 [LOW·문서] 머리말은 원인을 "Node 24 ICU" 대 "Node 20" 으로 서술하지만 실제 변수는 ICU 패치 78.2(`AM`) 대 78.3(`오전`)이다. "Node 20 에서는 … 실패" 는 20.20.2 한정으로만 참이고 Node 20.15.1(ICU 75.1)은 `오전` 을 낸다. 권고(선택): "ICU 78.2(Node 20.20.2)는 `AM`, ICU 78.3(Node 24.22.2)은 `오전`" 으로 한 줄 보정. L-2 [LOW·설계] 골든이 ICU 패치에 민감함(위 한계 a). L-3 [LOW·절차] `.gitignore` 가 `node_modules/`(끝 슬래시)라 심볼릭 링크 `node_modules` 는 무시되지 않고 `?? node_modules` 로 보인다 — `git add -A`·`git add .` 를 쓰면 NFS 절대경로 링크가 스테이징된다. 계획대로 파일 경로를 명시해 add 하고 커밋 직전 `git diff --cached --name-only` 가 픽스처 1줄인지 확인할 것.
- [14:35] Developer 보고와의 차이: 없음(주장한 사실 전부 재현). 다만 "Node 20 에서는 실패" 의 근거가 QA A/B 기록뿐이었는데 Node 20.20.2 이미지로 직접 재현해 독립 보강됐다. eslint 미실행(설정 파일 부재)은 Developer 가 공개한 대로이며, 골든 시험 실행이 이 파일을 swc 로 변환해 통과했으므로 구문 문제는 없다.
- [14:35] 확인하지 못한 것: ① ICU 76·77 에서의 출력, ICU 78.2→78.3 이 출력을 바꾼 원인(CLDR 데이터인지 ICU 코드인지 [추측]) ② 실제 사용자 브라우저(Chrome, 갤럭시 S25+)의 "진입 가능" 표기와 이 탭이 서버 선렌더(SSR)를 타는지 ③ 전체 jest·tsc(QA 몫) ④ 원격 최신 여부(worktree 의 로컬 `origin/main` 참조는 `5ca7817` 로 HEAD 와 같으나 fetch 하지 않았다) ⑤ 다른 앱의 Node 24 영향(범위 밖).
- [14:36] **최종 판정: PASS (scope: src/components/__tests__/fixtures/t062-domestic-golden-head.ts)**

## QA

- [14:36~14:39] QA(Leader 직접 실행, T-117 QA 와 같은 방식 — 서버 `~/.node-local/t121/qa-run.sh`, flock 직렬, 읽기 전용): worktree `~/.node-local/stockinvest-t121`(base `5ca7817` = T-117·T-118·T-119 포함 `origin/main`), Node 24.22.2·ICU 78.3. 변경 파일은 `src/components/__tests__/fixtures/t062-domestic-golden-head.ts` 1개(sha256 앞 16자 `b7ec7c810ede3fd2`, 실행 전후 동일), 스테이징 0 → 실행 후에도 0.
- [14:39] **전체 jest(Node 24, `--maxWorkers=3`)**: Test Suites 306 passed·4 skipped(310) / Tests 8532 passed·149 skipped(8681) / **실패 0**, 161초. `scenario-card-domestic-golden.test.ts` PASS. 비교: T-117 QA 때 Node 20 전체는 302 suites·8429 passed·4 skipped·149 skipped — 늘어난 4 suites·103 tests 는 그사이 병합된 T-118·T-119 시험이고 skip 수(4·149)는 같다. Node 24 에서 이 task 착수 전 실패하던 1건은 사라졌다.
- [14:39] **tsc `--noEmit`(Node 24)**: exit 0, 출력 0줄. 단 이 변경 파일은 `tsconfig.json` 의 `exclude`(`**/__tests__/**/*`) 대상이라 tsc 가 보지 않는다 — 이 변경에 대한 검증력은 없고, 운영 소스가 base 와 동일하다는 보조 확인이다(`--listFilesOnly` 로 `src/` 510개 포함·픽스처 0개 확인). 실행이 5초로 짧은 것은 증분(`incremental: true`) 설정 때문일 수 있다 [추측].
- [확인] Reviewer PASS(scope 픽스처 1개, 독립 재현으로 Node 24 출력 = 새 픽스처·Node 20.20.2 출력 = 기존 픽스처 확인)를 QA 가 전제로 삼았다. 이후 코드 변경 없음 → Reviewer 재순환 불필요.
- [QA 판정] **통과**. 운영 영향 없음(시험 파일만 변경, 운영 소스·DB·cron·pm2 호출 0). 못 한 것: Mac 등 다른 ICU 환경의 jest 실행, 실제 Chrome 의 "진입 가능" 표기 확인(서버 선렌더 여부 포함).

## 배포 기록

- [15:42] 사용자 지시("오늘 단독 push")로 push. 사전 점검(15:41) — `origin/main` `5ca7817` 불변·ahead 4(코드 변경은 시험 픽스처 1개, 나머지 `agent-vault` 문서)·미커밋 0, `safety_kill_switch`=true, 최근 3시간 주문 0건·최대 order id 3229, `/api/health` 200, pm2 두 앱 online·`stockinvest-cron` 1행, 배포 진행 프로세스 없음, 시각이 15:40~20:00 창 안(07:35~07:57 수집 구간 아님). 명령: `git push origin 99104fb:main` (정확한 SHA) → `5ca7817..99104fb`. `deploy.sh --yes` 는 따로 돌리지 않았다(webhook 이 release.sh 로 배포 — 이중 배포 방지).
- [15:42~15:44] 웹훅 배포(서버 로그 UTC 06:42:34~06:44:03 = KST 15:42:34~15:44:03, 약 1분 30초). `RELEASE_RESULT {"status":"ok","release":"20261029-154239-99104fbe","sha":"99104fbe3b5a3879ed5e6c2e04fdc41e36d29429","previous":"/home/brownjeon/apps/stockinvest/releases/20261029-134931-5ca78174","migrated":false}` — 헬스체크 정상, 오래된 릴리스 `20261028-190713-a16bc0cb` 삭제.
- [15:44] `scripts/deploy.sh StockInvest --status`: current `20261029-154239-99104fbe`, releases 5개, pm2 `stockinvest`·`stockinvest-cron` online(cwd 새 릴리스), health ✅ 200.
- [15:44~15:46] **배포 후 확인(실측)**: ① `stockinvest-cron` **정확히 1행** ② 재시작 횟수 두 앱 모두 0(배포 전 0 → 후 0), `stockinvest` pm2 `node_version` **24.22.2**(Deployer 조건 (f): 13:49 첫 Node 24 기동에 이어 두 번째 기동·build 성공; `stockinvest-cron` 의 20.20.2 표시는 pm2 데몬 값이고 러너는 bash 라 Node 를 쓰지 않는다) ③ `/api/health` 본문 `ok:true db:true schemaFatal:false safetyStatus:green`, `killSwitch:true`, `dryRun:false`, 한도 설정 true — 배포 전과 동일(`system_config.safety_kill_switch`=true 불변, 최대 order id 3229 불변 → 신규 주문 0) ④ 운영 도메인 307(로그인 리다이렉트, 정상) ⑤ 크론 틱 15:43·15:44·15:45 `strategy-eval`·`signal-followup`·`signal-expiry`·`portfolio-snapshot`·`trade-report`·`entry-watcher`·`holding-checker`·`stop-alert` 전부 OK ⑥ `pm2-out.log` ERROR 0건. 참고(이상 아님): `daily-bars skipped — 07:40~07:54 에 부르지 못해…` 는 T-117 설계대로 창 밖 첫 틱의 건너뛰기 로그이고 첫 실제 실행은 내일 07:40~07:54 다. `pm2-err.log` 의 "자동 청산 엔진 OFF" 안내는 기존 설정(`exit_engine_enabled`=false, 2026-10-18 이후 불변)이 기동 때마다 찍는 문구다.
- **미확인**: 로그인 후 메인 화면 렌더링(비로그인 307 까지만), KIS OpenAPI 개별 연동 호출(health·안전장치 green 으로만 확인), 앱(APK) — 해당 없음.
- [15:46] 내가 만든 worktree `~/.node-local/stockinvest-t121` 정리(심볼릭 링크만 지움 — NFS `node_modules` 무사, 변경은 `c872f6f` 로 main 에 있음). 증거 로그는 서버 `~/.node-local/t121/` 에 보존.

## 최종 요약

- **상태**: **배포 완료** — 2026-10-29 15:44 KST, 릴리스 `20261029-154239-99104fbe`(status ok). 운영 이상 징후 없음.
- **무엇이 바뀌었나**: 서버 Node 가 24 로 바뀐 뒤 실패하던 시험 1건(`scenario-card-domestic-golden`)을 고쳤다. 원인은 시험 환경의 12시간제 표기가 `AM 12:00` 에서 `오전 12:00` 으로 바뀐 것뿐이었고, 시험 기대값 파일 1개(`src/components/__tests__/fixtures/t062-domestic-golden-head.ts`)를 머리말의 생성 절차대로 Node 24 에서 다시 만들어 해당 2곳만 바꿨다. **운영 소스·화면·동작 변화 없음.**
- **배포**: push 15:42:22(`5ca7817..99104fb`) → 웹훅 blue/green 15:42:34~15:44:03, `RELEASE_RESULT` ok, migrated false. **같은 배포에 실린 다른 작업**: 코드는 없고, 로컬에만 있던 문서 커밋 3개(`ac4fd25`·`5da008a`·`99104fb`)가 함께 나갔다. 이 최종 요약을 담은 문서 커밋은 push 하지 않았다(문서만 push 해도 재배포가 일어나므로 다음 배포에 묶는다).
- **AI 가 검증한 것**: ① Developer — 재생성 값과 기존 값을 바이트 비교해 차이가 `AM`→`오전` 2곳뿐. ② Reviewer PASS — 별도 렌더 시험으로 독립 재현(Node 24 출력 = 새 픽스처, Node 20.20.2 출력 = 기존 픽스처). ③ QA — Node 24 전체 jest 306 suites·8532 통과·실패 0. ④ 배포 후 — cron 1행, 재시작 0, health green·킬스위치 true 불변, 주문 0건 증가, 크론 틱 정상, `stockinvest` Node 24.22.2 두 번째 정상 기동.
- **AI 가 못 한 것**: 로그인 후 메인 화면 렌더링·KIS 개별 연동 호출 확인, eslint(프로젝트에 설정 없음), 다른 ICU 환경의 jest, 실제 Chrome 의 "진입 가능" 표기. judge 는 Jev 없이 규칙 엔진으로만 판정했다.
- 👉 **확인할 것**: 없음 — 운영 영향이 없다.
- 👉 **결정할 것**: **Jev 예산 창 갱신 여부** — `.claude/tools/jev-judge/config.json` 의 창이 2026-09-27 부터 28일이라 10-25 에 끝나 judge 가 규칙 엔진 fallback 으로만 동작한다(사용 $0.016/상한 $5). 판정 실패 시 developer 는 Opus 로 간다. 갱신은 사용자 결정이라 손대지 않았다.
- **남은 일**: 없음(이 task 는 닫을 수 있다 — 사용자 확인 전이라 status 는 `deployed`). 후속 T-122·T-123 은 별개.
- **이슈·위험**: ⓐ 이 골든은 이제 **ICU 78.3(Node 24.22.2) 표기**가 기준이다 — ICU 78.2(Node 20.20.2)나 Mac 로컬 Node 22 에서 jest 를 돌리면 같은 1건이 반대로 실패할 수 있고, ICU 패치만 바뀌어도 다시 깨질 수 있다. 재발하면 시험에서 `AM/PM/오전/오후` 를 정규화하는 방식으로 바꾸길 권한다(Reviewer 의견). ⓑ 절차 순서 1건: demo_gate 기록(`init`)을 Developer 시작 뒤에 했다(결과 `not_required`, 영향 없음). judge 첫 판정은 요약문의 부정문 "화면 구조 변경 없음" 에 키워드 규칙이 걸려 `delta` 였고, 사실 그대로 쓴 요약으로 재실행해 `none` 을 얻었다(두 기록 모두 `## 판단 기록 (judge)` 에 남김). ⓒ Reviewer low 3건 중 머리말 서술 보정(원인이 "Node 24 대 20" 이 아니라 ICU 78.2 대 78.3)은 선택 사항으로 두었다.

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 해당없음 | - | - | judge: none | 10-29 14:26 |
