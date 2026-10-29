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
2. tsc `--noEmit` 은 Node 24 에서 통과(T-117 QA 06:47). 러너 쉘 시험·훅 시험 전부 통과.
3. **확인 못 한 것**: `next build` 와 운영 런타임(mysql2·Next 15.5.27) 의 Node 24 동작. blue/green 이라 build 실패는 컷오버 전에 중단되어 운영 영향이 없다(release.sh 의 build → 헬스체크 → 컷오버 순서). 컷오버 뒤 런타임 문제는 헬스체크와 첫 크론 틱으로 관측한다.

## 결정이 필요한 것 (Leader 권고)
| 항목 | 선택지 | 권고 |
|---|---|---|
| 골든 시험 | (a) 골든을 "오전"으로 갱신 (b) 시각 서식을 로케일 독립으로 고정 (c) 둔다 | **(b) 또는 (a)** — 화면 문구가 `AM`→`오전` 으로 바뀌는 것은 사용자 가시 변화이므로 (b) 로 현행 표기 유지 여부는 사용자 확인. 이 건은 화면 구조 변경이 아니라 표기 고정이라 데모 게이트 대상 아님 [추측 — judge 접수에서 확정]. 우선순위 낮음 |
| 운영 Node | (a) Node 24 로 간다 (b) 20 으로 고정 | **(a)** — 다른 4개 앱이 이미 24 로 정상. 단 첫 배포에서 build·헬스체크 결과를 Deployer 가 기록한다(T-117 Deployer 조건 (f)) |
| 나머지 앱 | 재시작 때마다 24 로 바뀐다 | 정보 — `thecareer`·`themeal`·`voicevault`·`thekaiwa`·`thethinker` 는 아직 20.20.2 로 돌고 있어 다음 재시작 때 24 로 바뀐다(HOME-SERVER 세션 소관, 알림만) |

## 진행 기록
- [2026-10-29 09:32] T-117 QA 보류 해소 중 발견·재현 확인(Leader). 코드 변경 없음, 미착수. 사용자 지시 "승인 묻지 않고 진행"에 따라 시험 수정은 T-117·T-118·T-119 배포 이후 judge 접수 → Developer → Reviewer → QA 로 처리한다.

## 최종 요약
(미작성)
