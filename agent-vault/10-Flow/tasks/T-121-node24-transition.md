---
task_id: T-121
title: 시스템 Node 20→24 전환 영향 정리 — 골든 시험 1건 실패 + 다음 배포부터 StockInvest 가 Node 24 로 기동
status: planned
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

## 최종 요약
(미작성)
